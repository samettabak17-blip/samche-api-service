/**
 * SamChe Universal Page Context Capture & Web Chat Client Companion
 * Bounded, safe, allowlisted metadata extraction for Web Chatbot.
 */
(function(global) {
  'use strict';

  var MAX_TEXT_LEN = 1000;
  var FORBIDDEN_ATTR = /password|token|secret|credit|card|cvv|cvc|auth|bearer|ssn|iban|cookie|api[_-]?key/i;

  function safeString(val, max) {
    if (val === null || val === undefined) return '';
    return String(val).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, max || MAX_TEXT_LEN);
  }

  function extractJsonLd() {
    if (typeof document === 'undefined') return null;
    try {
      var scripts = document.querySelectorAll('script[type="application/ld+json"]');
      for (var i = 0; i < scripts.length; i++) {
        var text = scripts[i].textContent || '';
        if (!text) continue;
        var parsed = JSON.parse(text);
        var item = Array.isArray(parsed) ? parsed[0] : (parsed['@graph'] ? parsed['@graph'][0] : parsed);
        if (!item || typeof item !== 'object') continue;

        var type = safeString(item['@type'], 64);
        var name = safeString(item.name || item.headline || item.title, 255);
        if (!name && !type) continue;

        var attributes = {};
        if (item.offers && typeof item.offers === 'object') {
          var offer = Array.isArray(item.offers) ? item.offers[0] : item.offers;
          if (offer.price !== undefined) attributes.price = offer.price;
          if (offer.priceCurrency) attributes.currency = safeString(offer.priceCurrency, 10);
        }
        if (item.brand) {
          attributes.brand = typeof item.brand === 'object' ? safeString(item.brand.name, 100) : safeString(item.brand, 100);
        }
        if (item.numberOfRooms) attributes.bedrooms = item.numberOfRooms;
        if (item.address && typeof item.address === 'object') {
          attributes.location = safeString(item.address.addressLocality || item.address.streetAddress, 150);
        }

        return {
          entity_type: type || 'ENTITY',
          entity_name: name || undefined,
          summary: safeString(item.description, 1000),
          attributes: attributes,
        };
      }
    } catch (e) {}
    return null;
  }

  function extractMetaTag(property) {
    if (typeof document === 'undefined') return '';
    var el = document.querySelector('meta[property="' + property + '"]') ||
             document.querySelector('meta[name="' + property + '"]');
    return el ? safeString(el.getAttribute('content'), 500) : '';
  }

  function capturePageContext() {
    if (typeof window === 'undefined' || typeof document === 'undefined') return null;

    var canonicalEl = document.querySelector('link[rel="canonical"]');
    var canonicalUrl = canonicalEl ? safeString(canonicalEl.getAttribute('href'), 2048) : '';
    var currentUrl = safeString(window.location.href, 2048);
    var currentPath = safeString(window.location.pathname, 1024);
    var docTitle = safeString(document.title, 300);
    var lang = safeString(document.documentElement.lang || navigator.language, 16);

    var hostExplicit = (typeof window.samchePageContext === 'object' && window.samchePageContext) || {};
    var jsonLdData = extractJsonLd() || {};

    var ogTitle = extractMetaTag('og:title');
    var ogDesc = extractMetaTag('og:description');
    var ogType = extractMetaTag('og:type');

    var entityType = hostExplicit.entity_type || jsonLdData.entity_type || (ogType ? ogType.toUpperCase() : 'PAGE');
    var entityName = hostExplicit.entity_name || hostExplicit.name || jsonLdData.entity_name || ogTitle || docTitle;
    var entityId = hostExplicit.entity_id || hostExplicit.id || currentPath;
    var summary = hostExplicit.summary || jsonLdData.summary || ogDesc || '';

    var attributes = Object.assign({}, jsonLdData.attributes || {}, hostExplicit.attributes || {});
    var safeAttributes = {};
    for (var k in attributes) {
      if (Object.prototype.hasOwnProperty.call(attributes, k) && !FORBIDDEN_ATTR.test(k)) {
        safeAttributes[k] = attributes[k];
      }
    }

    return {
      url: currentUrl,
      path: currentPath,
      canonical_url: canonicalUrl || currentUrl,
      title: docTitle,
      language: lang,
      entity_type: entityType,
      entity_id: String(entityId),
      entity_name: entityName,
      summary: summary,
      attributes: safeAttributes,
      referrer: safeString(document.referrer, 2048) || null,
      timestamp: new Date().toISOString(),
    };
  }

  function initSpaNavigationListener(onNavigate) {
    if (typeof window === 'undefined' || typeof onNavigate !== 'function') return;

    var lastPath = window.location.pathname;
    function checkNavigation() {
      var currentPath = window.location.pathname;
      if (currentPath !== lastPath) {
        lastPath = currentPath;
        setTimeout(function() { onNavigate(capturePageContext()); }, 60);
      }
    }

    var originalPush = window.history.pushState;
    if (originalPush) {
      window.history.pushState = function() {
        var res = originalPush.apply(this, arguments);
        checkNavigation();
        return res;
      };
    }

    var originalReplace = window.history.replaceState;
    if (originalReplace) {
      window.history.replaceState = function() {
        var res = originalReplace.apply(this, arguments);
        checkNavigation();
        return res;
      };
    }

    window.addEventListener('popstate', checkNavigation);
    window.addEventListener('hashchange', checkNavigation);
  }

  var proactiveState = {
    sessionToken: null,
    hasUserMessaged: false,
    hasProactivelyEngaged: false,
    dismissedAt: 0,
    dwellTimer: null,
    dwellSeconds: 0,
    intervalTimer: null,
    cooldownSeconds: 300,
    dwellThresholdSeconds: 15,
    onAutoOpen: null,
    onProactiveMessage: null,
  };

  function configureProactive(opts) {
    if (!opts) return;
    if (opts.sessionToken) proactiveState.sessionToken = opts.sessionToken;
    if (typeof opts.cooldownSeconds === 'number') proactiveState.cooldownSeconds = opts.cooldownSeconds;
    if (typeof opts.dwellThresholdSeconds === 'number') proactiveState.dwellThresholdSeconds = opts.dwellThresholdSeconds;
    if (typeof opts.onAutoOpen === 'function') proactiveState.onAutoOpen = opts.onAutoOpen;
    if (typeof opts.onProactiveMessage === 'function') proactiveState.onProactiveMessage = opts.onProactiveMessage;
  }

  function clearTimers() {
    if (proactiveState.dwellTimer) clearTimeout(proactiveState.dwellTimer);
    if (proactiveState.intervalTimer) clearInterval(proactiveState.intervalTimer);
    proactiveState.dwellTimer = null;
    proactiveState.intervalTimer = null;
    proactiveState.dwellSeconds = 0;
  }

  function recordUserMessage() {
    proactiveState.hasUserMessaged = true;
    clearTimers();
  }

  function recordDismissal() {
    proactiveState.dismissedAt = Date.now();
    clearTimers();
    if (proactiveState.sessionToken && typeof fetch === 'function') {
      fetch('/api/chat/dismiss-proactive', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Samche-Web-Chat-Session': proactiveState.sessionToken,
        },
      }).catch(function() {});
    }
  }

  function startDwellTracker(token, customDwellSeconds) {
    if (token) proactiveState.sessionToken = token;
    if (proactiveState.hasUserMessaged || proactiveState.hasProactivelyEngaged) return;

    var cooldownMs = proactiveState.cooldownSeconds * 1000;
    if (proactiveState.dismissedAt && (Date.now() - proactiveState.dismissedAt < cooldownMs)) {
      return;
    }

    clearTimers();
    var threshold = customDwellSeconds || proactiveState.dwellThresholdSeconds;

    proactiveState.intervalTimer = setInterval(function() {
      proactiveState.dwellSeconds += 1;
      if (proactiveState.dwellSeconds >= threshold) {
        clearTimers();
        checkDwellIntent();
      }
    }, 1000);
  }

  function checkDwellIntent() {
    if (!proactiveState.sessionToken || proactiveState.hasUserMessaged || proactiveState.hasProactivelyEngaged) return;
    var cooldownMs = proactiveState.cooldownSeconds * 1000;
    if (proactiveState.dismissedAt && (Date.now() - proactiveState.dismissedAt < cooldownMs)) {
      return;
    }

    fetch('/api/chat/evaluate-intent', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Samche-Web-Chat-Session': proactiveState.sessionToken,
      },
      body: JSON.stringify({
        dwell_seconds: proactiveState.dwellSeconds || proactiveState.dwellThresholdSeconds,
      }),
    })
    .then(function(res) { return res.json(); })
    .then(function(data) {
      handleProactiveResult(data);
    })
    .catch(function() {});
  }

  function handleProactiveResult(data) {
    if (!data || !data.proactive_engagement) return;
    var pe = data.proactive_engagement;
    if (pe.should_open && pe.message && !proactiveState.hasUserMessaged && !proactiveState.hasProactivelyEngaged) {
      var cooldownMs = proactiveState.cooldownSeconds * 1000;
      if (proactiveState.dismissedAt && (Date.now() - proactiveState.dismissedAt < cooldownMs)) {
        return;
      }
      proactiveState.hasProactivelyEngaged = true;
      if (typeof proactiveState.onAutoOpen === 'function') {
        proactiveState.onAutoOpen(pe.message, pe);
      }
      if (typeof proactiveState.onProactiveMessage === 'function') {
        proactiveState.onProactiveMessage(pe.message, pe);
      }
    }
  }

  /* Canonical Web Chat UX Primitives (Shared timing with AI Guide) */
  var PRESENTATION_TIMING = Object.freeze({
    chunk_words: 2,
    base_delay_ms: 36,
    comma_pause_ms: 80,
    sentence_pause_ms: 180,
    section_pause_ms: 220,
    list_item_pause_ms: 100,
    thinking_minimum_ms: 0,
  });

  function responseDelay(value) {
    var pause = typeof value === 'number' ? value : PRESENTATION_TIMING.base_delay_ms;
    try {
      if (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        return 0;
      }
    } catch (e) {
      return pause;
    }
    return pause;
  }

  function isNearBottom(container, threshold) {
    if (!container) return true;
    var th = typeof threshold === 'number' ? threshold : 60;
    var scrollDiff = container.scrollHeight - container.scrollTop - container.clientHeight;
    return scrollDiff <= th;
  }

  function smartScrollToBottom(container, force) {
    if (!container) return;
    if (force || isNearBottom(container)) {
      container.scrollTop = container.scrollHeight;
    }
  }

  function createTypingIndicator(options) {
    options = options || {};
    if (typeof document === 'undefined') {
      return {
        className: 'msg msg-bot msg-typing-indicator' + (options.className ? ' ' + options.className : ''),
        getAttribute: function(name) {
          if (name === 'role') return 'status';
          if (name === 'aria-live') return 'polite';
          if (name === 'aria-label') return options.label || 'Asistan yanıt hazırlıyor...';
          return null;
        },
      };
    }
    var el = document.createElement('div');
    el.className = 'msg msg-bot msg-typing-indicator' + (options.className ? ' ' + options.className : '');
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.setAttribute('aria-label', options.label || 'Asistan yanıt hazırlıyor...');

    var dotsWrap = document.createElement('span');
    dotsWrap.className = 'typing-dots';
    for (var i = 0; i < 3; i++) {
      var dot = document.createElement('span');
      dot.className = 'typing-dot';
      dotsWrap.appendChild(dot);
    }
    el.appendChild(dotsWrap);
    return el;
  }

  function clearTypingIndicator(container) {
    if (!container) return;
    var existing = container.querySelectorAll('.msg-typing-indicator');
    for (var i = 0; i < existing.length; i++) {
      existing[i].remove();
    }
  }

  async function progressiveText(node, value, options) {
    options = options || {};
    var signal = options.signal;
    var container = options.container;
    var words = String(value || '').split(/(\s+)/);
    var step = Math.max(2, (PRESENTATION_TIMING.chunk_words || 2) * 2);

    for (var index = 0; index < words.length; index += step) {
      if (signal && signal.aborted) return;
      if (node && typeof node.isConnected === 'boolean' && !node.isConnected) return;

      var chunk = words.slice(index, index + step).join('');
      node.textContent += chunk;

      if (container) {
        smartScrollToBottom(container, false);
      }

      var isSentenceEnd = /[.!?]\s*$/.test(chunk);
      var isClauseEnd = /[,;:]\s*$/.test(chunk);
      var pause = isSentenceEnd
        ? PRESENTATION_TIMING.sentence_pause_ms
        : isClauseEnd
          ? PRESENTATION_TIMING.comma_pause_ms
          : PRESENTATION_TIMING.base_delay_ms;

      var delay = responseDelay(pause);
      if (delay > 0 && typeof setTimeout !== 'undefined') {
        await new Promise(function(resolve) { setTimeout(resolve, delay); });
      }
    }
  }

  async function progressiveReveal(targetNode, content, options) {
    options = options || {};
    var container = options.container || null;
    var signal = options.signal || null;
    var onComplete = options.onComplete || null;

    if (!targetNode) return;
    var rawText = typeof content === 'string' ? content : String(content || '');
    targetNode.textContent = '';

    var hasHtml = /<[a-z][\s\S]*>/i.test(rawText);

    if (hasHtml && typeof document !== 'undefined') {
      var temp = document.createElement('div');
      temp.innerHTML = rawText;
      var children = Array.from(temp.childNodes);
      for (var i = 0; i < children.length; i++) {
        if (signal && signal.aborted) return;
        if (targetNode && typeof targetNode.isConnected === 'boolean' && !targetNode.isConnected) return;

        var child = children[i];
        if (child.nodeType === 3) {
          await progressiveText(targetNode, child.textContent, { signal: signal, container: container });
        } else if (child.nodeType === 1) {
          var clone = child.cloneNode(false);
          targetNode.appendChild(clone);
          if (child.childNodes && child.childNodes.length > 0) {
            await progressiveText(clone, child.textContent, { signal: signal, container: container });
          }
          if (container) {
            smartScrollToBottom(container, false);
          }
          var elDelay = responseDelay(PRESENTATION_TIMING.sentence_pause_ms);
          if (elDelay > 0 && typeof setTimeout !== 'undefined') {
            await new Promise(function(resolve) { setTimeout(resolve, elDelay); });
          }
        }
      }
    } else {
      await progressiveText(targetNode, rawText, { signal: signal, container: container });
    }

    if (container) {
      smartScrollToBottom(container, false);
    }
    if (typeof onComplete === 'function') {
      onComplete();
    }
  }

  function injectStyles() {
    if (typeof document === 'undefined') return;
    if (document.getElementById('samche-webchat-ux-styles')) return;
    var style = document.createElement('style');
    style.id = 'samche-webchat-ux-styles';
    style.textContent = [
      '.msg-typing-indicator { display: inline-flex !important; align-items: center; gap: 4px; min-height: 20px; padding: 0.6rem 0.9rem !important; }',
      '.typing-dots { display: inline-flex; align-items: center; gap: 4px; }',
      '.typing-dot { width: 6px; height: 6px; border-radius: 50%; background-color: #94a3b8; display: inline-block; animation: samche-typing-bounce 1.4s infinite ease-in-out both; }',
      '.typing-dot:nth-child(1) { animation-delay: -0.32s; }',
      '.typing-dot:nth-child(2) { animation-delay: -0.16s; }',
      '.typing-dot:nth-child(3) { animation-delay: 0s; }',
      '@keyframes samche-typing-bounce { 0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; } 40% { transform: scale(1.1); opacity: 1; } }',
      '.msg { animation: samche-msg-fadein 0.22s ease-out; }',
      '@keyframes samche-msg-fadein { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }'
    ].join('\n');
    if (document.head) {
      document.head.appendChild(style);
    }
  }
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', injectStyles);
    } else {
      injectStyles();
    }
  }



  var memStore = {};
  var SamcheChatPersistence = {
    getStorageKey: function(widgetKey) {
      return 'samche_webchat_session_' + encodeURIComponent(widgetKey || 'default');
    },
    getStoredSession: function(widgetKey) {
      var key = this.getStorageKey(widgetKey);
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          var val = window.localStorage.getItem(key);
          if (val) return val;
        }
      } catch (e) {}
      try {
        if (typeof window !== 'undefined' && window.sessionStorage) {
          var sVal = window.sessionStorage.getItem(key);
          if (sVal) return sVal;
        }
      } catch (e) {}
      return memStore[key] || null;
    },
    storeSession: function(widgetKey, token) {
      if (!token) return;
      var key = this.getStorageKey(widgetKey);
      memStore[key] = String(token);
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          window.localStorage.setItem(key, String(token));
        }
      } catch (e) {}
      try {
        if (typeof window !== 'undefined' && window.sessionStorage) {
          window.sessionStorage.setItem(key, String(token));
        }
      } catch (e) {}
    },
    clearStoredSession: function(widgetKey) {
      var key = this.getStorageKey(widgetKey);
      delete memStore[key];
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          window.localStorage.removeItem(key);
        }
      } catch (e) {}
      try {
        if (typeof window !== 'undefined' && window.sessionStorage) {
          window.sessionStorage.removeItem(key);
        }
      } catch (e) {}
    },
    hydrateHistory: function(container, messages, appendFn) {
      if (!container || !Array.isArray(messages)) return 0;
      var count = 0;
      for (var i = 0; i < messages.length; i++) {
        var item = messages[i];
        if (!item) continue;
        var role = (item.role === 'user' || item.sender_type === 'CUSTOMER') ? 'user' : 'bot';
        var text = typeof item.content === 'string' ? item.content : (item.text || '');
        if (typeof appendFn === 'function') {
          appendFn(role, text);
          count++;
        }
      }
      return count;
    }
  };
  /* Canonical Shared Web Chat Runtime & Isolated Shadow DOM Renderer */
  var CANONICAL_WIDGET_CSS_A = [
    '*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }',
    ':host { position: fixed; bottom: 0; right: 0; width: 0; height: 0; z-index: 2147483640; pointer-events: none; overflow: visible; display: block; }',
    '.samche-wrap { position: fixed; bottom: 0; right: 0; width: 0; height: 0; z-index: 2147483640; pointer-events: none; overflow: visible; }',
    '.samche-pos-left.samche-wrap { right: auto; left: 0; }',
    '.samche-launcher { position: fixed; bottom: 24px; right: 24px; width: 60px; height: 60px; border-radius: 50%; background: var(--chat-primary, #2563EB); color: var(--chat-primary-foreground, #FFF); border: 1px solid var(--chat-border, rgba(255,255,255,0.15)); box-shadow: 0 8px 28px -4px var(--chat-glow, rgba(37,99,235,0.4)), 0 4px 12px rgba(0,0,0,0.25); cursor: pointer; display: flex; align-items: center; justify-content: center; pointer-events: auto; transition: transform .2s cubic-bezier(.16,1,.3,1), box-shadow .2s ease; outline: none; animation: samche-glow-breathe 4s infinite ease-in-out; z-index: 2147483641; }',
    '.samche-pos-left .samche-launcher { right: auto; left: 24px; }',
    '.samche-launcher:hover { transform: scale(1.05); }',
    '.samche-launcher:focus-visible { outline: 2px solid var(--chat-accent, #60A5FA); outline-offset: 3px; }',
    '.samche-launcher-icon { width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; fill: currentColor; }',
    '.samche-launcher-icon svg { width: 100%; height: 100%; fill: currentColor; }',
    '.samche-launcher-logo { width: 34px; height: 34px; border-radius: 50%; object-fit: contain; }',
    '.samche-intent-pulse { animation: samche-intent-pulse 2s infinite ease-in-out !important; }',
    '@keyframes samche-glow-breathe { 0%, 100% { box-shadow: 0 8px 28px -4px var(--chat-glow, rgba(37,99,235,0.3)), 0 4px 12px rgba(0,0,0,0.2); } 50% { box-shadow: 0 12px 36px -2px var(--chat-glow, rgba(37,99,235,0.55)), 0 4px 16px rgba(0,0,0,0.3); } }',
    '@keyframes samche-intent-pulse { 0% { transform: scale(1); } 50% { transform: scale(1.08); box-shadow: 0 0 0 10px rgba(37,99,235,0.25); } 100% { transform: scale(1); } }',
    '.samche-panel { position: fixed; bottom: 96px; right: 24px; width: 400px; max-width: calc(100vw - 32px); height: 600px; max-height: calc(100vh - 120px); border-radius: 20px; background: var(--chat-surface-glass, rgba(18,20,26,0.92)); backdrop-filter: blur(24px) saturate(180%); -webkit-backdrop-filter: blur(24px) saturate(180%); border: 1px solid var(--chat-border, rgba(255,255,255,0.12)); box-shadow: 0 24px 64px -12px rgba(0,0,0,0.55), 0 0 0 1px var(--chat-border, rgba(255,255,255,0.08)); display: flex; flex-direction: column; overflow: hidden; pointer-events: none; opacity: 0; transform: translateY(16px) scale(0.96); visibility: hidden; transition: transform .28s cubic-bezier(.16,1,.3,1), opacity .25s ease-out; z-index: 2147483642; }',
    '.samche-pos-left .samche-panel { right: auto; left: 24px; }',
    '.samche-panel.samche-open { opacity: 1; transform: translateY(0) scale(1); visibility: visible !important; pointer-events: auto; }',
    '@supports not (backdrop-filter: blur(10px)) { .samche-panel { background: var(--chat-surface-solid, #12141a) !important; } }'
  ].join('\n');


  var CANONICAL_WIDGET_CSS_B = [
    '.samche-header { padding: 16px 20px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--chat-border, rgba(255,255,255,0.08)); background: rgba(255,255,255,0.03); flex-shrink: 0; }',
    '.samche-header-info { display: flex; align-items: center; gap: 12px; }',
    '.samche-header-avatar { width: 36px; height: 36px; border-radius: 10px; background: var(--chat-surface-tint, #1E293B); border: 1px solid var(--chat-border, rgba(255,255,255,0.12)); display: flex; align-items: center; justify-content: center; overflow: hidden; flex-shrink: 0; }',
    '.samche-header-avatar img { width: 100%; height: 100%; object-fit: contain; }',
    '.samche-header-avatar svg { width: 20px; height: 20px; fill: var(--chat-primary, #2563EB); }',
    '.samche-header-titles { display: flex; flex-direction: column; }',
    '.samche-header-title { font-size: 15px; font-weight: 600; color: var(--chat-text, #F8FAFC); line-height: 1.25; }',
    '.samche-header-status { font-size: 12px; color: var(--chat-muted, #94A3B8); display: flex; align-items: center; gap: 5px; margin-top: 2px; }',
    '.samche-status-dot { width: 7px; height: 7px; border-radius: 50%; background: #22C55E; box-shadow: 0 0 8px #22C55E; display: inline-block; }',
    '.samche-header-context-badge { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 6px; background: rgba(96,165,250,0.15); color: var(--chat-accent, #60A5FA); font-size: 11px; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 200px; }',
    '.samche-close-btn { width: 32px; height: 32px; border-radius: 8px; border: 1px solid var(--chat-border, rgba(255,255,255,0.1)); background: rgba(255,255,255,0.05); color: var(--chat-muted, #94A3B8); cursor: pointer; display: flex; align-items: center; justify-content: center; outline: none; transition: background .15s ease, color .15s ease; flex-shrink: 0; }',
    '.samche-close-btn:hover { background: rgba(255,255,255,0.12); color: var(--chat-text, #F8FAFC); }',
    '.samche-close-btn:focus-visible { outline: 2px solid var(--chat-accent, #60A5FA); }',
    '.samche-messages { flex: 1; overflow-y: auto; padding: 18px 20px; display: flex; flex-direction: column; gap: 12px; -webkit-overflow-scrolling: touch; overscroll-behavior: contain; }',
    '.samche-msg { animation: samche-msg-fadein .24s cubic-bezier(.16,1,.3,1); max-width: 85%; font-size: 14px; line-height: 1.5; word-break: break-word; }',
    '.samche-msg-user { align-self: flex-end; background: var(--chat-primary, #2563EB); color: var(--chat-primary-foreground, #FFF); padding: 10px 14px; border-radius: 16px 16px 4px 16px; box-shadow: 0 4px 14px -3px var(--chat-glow, rgba(37,99,235,0.3)); }',
    '.samche-msg-bot { align-self: flex-start; background: rgba(255,255,255,0.06); color: var(--chat-text, #F8FAFC); border: 1px solid var(--chat-border, rgba(255,255,255,0.08)); padding: 12px 16px; border-radius: 16px 16px 16px 4px; }',
    '.samche-msg-bot a { color: var(--chat-accent, #60A5FA); text-decoration: underline; }',
    '.samche-chips { display: flex; flex-wrap: wrap; gap: 6px; padding: 8px 16px; border-top: 1px solid var(--chat-border, rgba(255,255,255,0.06)); background: rgba(0,0,0,0.1); max-height: 90px; overflow-y: auto; flex-shrink: 0; }',
    '.samche-chip { font-size: 12px; padding: 6px 12px; border-radius: 9999px; background: rgba(255,255,255,0.08); color: var(--chat-text, #F8FAFC); border: 1px solid var(--chat-border, rgba(255,255,255,0.12)); cursor: pointer; transition: background .15s ease, transform .15s ease; outline: none; white-space: nowrap; }',
    '.samche-chip:hover { background: rgba(255,255,255,0.15); transform: translateY(-1px); }',
    '.samche-composer { padding: 14px 16px; border-top: 1px solid var(--chat-border, rgba(255,255,255,0.08)); background: rgba(0,0,0,0.15); display: flex; align-items: flex-end; gap: 10px; flex-shrink: 0; }',
    '.samche-composer-input { flex: 1; background: var(--chat-input-bg, rgba(255,255,255,0.06)); border: 1px solid var(--chat-input-border, rgba(255,255,255,0.14)); border-radius: 12px; color: var(--chat-text, #F8FAFC); padding: 10px 14px; font-size: 14px; line-height: 1.4; resize: none; max-height: 110px; min-height: 42px; outline: none; }',
    '.samche-composer-input:focus { border-color: var(--chat-accent, #60A5FA); }',
    '.samche-composer-input::placeholder { color: var(--chat-muted, #94A3B8); }',
    '.samche-send-btn { width: 42px; height: 42px; border-radius: 12px; background: var(--chat-primary, #2563EB); color: var(--chat-primary-foreground, #FFF); border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0; outline: none; transition: opacity .15s, transform .15s; }',
    '.samche-send-btn:hover:not(:disabled) { transform: scale(1.05); }',
    '.samche-send-btn:disabled { opacity: 0.45; cursor: not-allowed; }',
    '.samche-send-btn svg { width: 18px; height: 18px; fill: currentColor; }',
    '@media (max-width: 640px), (max-height: 500px) and (orientation: landscape) { .samche-launcher { bottom: 16px; right: 16px; width: 52px; height: 52px; } .samche-pos-left .samche-launcher { right: auto; left: 16px; } .samche-panel.samche-open { inset: 0 !important; width: 100vw !important; height: 100% !important; height: 100dvh !important; max-height: 100dvh !important; max-width: 100vw !important; border-radius: 0 !important; border: none !important; padding-top: env(safe-area-inset-top, 0); padding-bottom: env(safe-area-inset-bottom, 0); } }',
    '@media (max-height: 500px) and (orientation: landscape) { .samche-panel.samche-open { inset: 0 !important; width: 100vw !important; height: 100vh !important; max-height: 100vh !important; border-radius: 0 !important; border: none !important; } }',
    '.samche-panel[dir="rtl"] { direction: rtl; text-align: right; }',
    '.samche-panel[dir="rtl"] .samche-msg-user { align-self: flex-start; border-radius: 16px 16px 16px 4px; }',
    '.samche-panel[dir="rtl"] .samche-msg-bot { align-self: flex-end; border-radius: 16px 16px 4px 16px; }',
    '.samche-panel[dir="rtl"] .samche-composer-input { text-align: right; }',
    '@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important; transition-duration: .01ms !important; } }'
  ].join('\n');
  var CANONICAL_WIDGET_CSS = CANONICAL_WIDGET_CSS_A + '\n' + CANONICAL_WIDGET_CSS_B;
  var CHAT_ICON_SVG = '<svg viewBox="0 0 24 24"><path d="M12 2C6.477 2 2 6.477 2 12c0 1.821.487 3.53 1.338 5L2.5 21.5l4.646-.82A9.957 9.957 0 0012 22c5.523 0 10-4.477 10-10S17.523 2 12 2zm0 18a7.96 7.96 0 01-4.07-1.11l-.29-.17-2.76.49.5-2.69-.19-.3A7.963 7.963 0 014 12c0-4.411 3.589-8 8-8s8 3.589 8 8-3.589 8-8 8z"/></svg>';
  var CLOSE_ICON_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
  var SEND_ICON_SVG = '<svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>';

  var SamcheCanonicalWidget = {
    instances: {},
    mount: function(options) {
      if (typeof document === 'undefined') return null;
      options = options || {};
      var widgetKey = options.widgetKey || (typeof document.currentScript === 'object' && document.currentScript ? document.currentScript.getAttribute('data-widget-key') : null);
      if (!widgetKey) {
        var scriptTag = document.querySelector('script[data-widget-key]');
        if (scriptTag) widgetKey = scriptTag.getAttribute('data-widget-key');
      }
      if (!widgetKey && typeof window !== 'undefined' && window.location) {
        try {
          var urlKey = new URLSearchParams(window.location.search).get('widget_key');
          if (urlKey) widgetKey = urlKey.trim();
        } catch (e) {}
      }
      if (!widgetKey && typeof window !== 'undefined' && window.__SAMCHE_WEB_CHAT_KEY__) {
        widgetKey = window.__SAMCHE_WEB_CHAT_KEY__;
      }
      if (!widgetKey && typeof window !== 'undefined' && window.location && window.location.pathname && window.location.pathname.indexOf('/task8-demo') !== -1) {
        widgetKey = 'wch_staging_task8_demo';
      }
      if (!widgetKey) return null;
      if (this.instances[widgetKey]) return this.instances[widgetKey];

      var host = document.createElement('div');
      host.id = 'samche-webchat-container';
      host.className = 'samche-widget-host';
      host.style.position = 'fixed';
      host.style.bottom = '0';
      host.style.right = '0';
      host.style.width = '0';
      host.style.height = '0';
      host.style.overflow = 'visible';
      host.style.pointerEvents = 'none';
      host.style.zIndex = '2147483640';
      var shadow = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;

      var styleEl = document.createElement('style');
      styleEl.textContent = CANONICAL_WIDGET_CSS;
      shadow.appendChild(styleEl);

      var wrap = document.createElement('div');
      wrap.className = 'samche-wrap';
      shadow.appendChild(wrap);

      var launcher = document.createElement('button');
      launcher.className = 'samche-launcher';
      launcher.setAttribute('aria-label', 'Canlı Destek Asistanı');
      launcher.setAttribute('aria-expanded', 'false');
      launcher.setAttribute('aria-haspopup', 'dialog');
      launcher.innerHTML = '<span class="samche-launcher-icon">' + CHAT_ICON_SVG + '</span>';
      wrap.appendChild(launcher);

      var panel = document.createElement('div');
      panel.className = 'samche-panel';
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-modal', 'false');
      panel.setAttribute('aria-label', 'Canlı Destek');

      var header = document.createElement('div');
      header.className = 'samche-header';
      header.innerHTML = [
        '<div class="samche-header-info">',
        '  <div class="samche-header-avatar"><span class="samche-avatar-icon">' + CHAT_ICON_SVG + '</span></div>',
        '  <div class="samche-header-titles">',
        '    <span class="samche-header-title">Canlı Destek</span>',
        '    <span class="samche-header-status"><span class="samche-status-dot"></span><span class="samche-status-text">Çevrimiçi</span></span>',
        '    <span class="samche-header-context-badge" style="display: none;"></span>',
        '  </div>',
        '</div>',
        '<button class="samche-close-btn" aria-label="Kapat">' + CLOSE_ICON_SVG + '</button>'
      ].join('');
      panel.appendChild(header);

      var messages = document.createElement('div');
      messages.className = 'samche-messages';
      messages.setAttribute('role', 'log');
      messages.setAttribute('aria-live', 'polite');
      panel.appendChild(messages);

      var chipsContainer = document.createElement('div');
      chipsContainer.className = 'samche-chips';
      chipsContainer.style.display = 'none';
      panel.appendChild(chipsContainer);

      var composer = document.createElement('div');
      composer.className = 'samche-composer';
      composer.innerHTML = [
        '<textarea class="samche-composer-input" placeholder="Mesajınızı yazın..." rows="1" aria-label="Mesajınızı yazın"></textarea>',
        '<button class="samche-send-btn" aria-label="Gönder" disabled>' + SEND_ICON_SVG + '</button>'
      ].join('');
      panel.appendChild(composer);
      wrap.appendChild(panel);

      document.body.appendChild(host);
      var isOpen = false;
      var sessionToken = null;
      var contextBadgeEl = header.querySelector('.samche-header-context-badge');
      var textarea = composer.querySelector('.samche-composer-input');
      var sendBtn = composer.querySelector('.samche-send-btn');
      var closeBtn = header.querySelector('.samche-close-btn');

      function openPanel() {
        if (isOpen) return;
        isOpen = true;
        panel.classList.add('samche-open');
        launcher.setAttribute('aria-expanded', 'true');
        panel.setAttribute('aria-modal', 'true');
        launcher.classList.remove('samche-intent-pulse');
        setTimeout(function() { textarea.focus(); }, 120);
        smartScrollToBottom(messages, true);
      }

      function closePanel() {
        if (!isOpen) return;
        isOpen = false;
        panel.classList.remove('samche-open');
        launcher.setAttribute('aria-expanded', 'false');
        panel.setAttribute('aria-modal', 'false');
        recordDismissal();
      }

      launcher.addEventListener('click', function() {
        if (isOpen) closePanel(); else openPanel();
      });
      closeBtn.addEventListener('click', closePanel);

      textarea.addEventListener('input', function() {
        sendBtn.disabled = !textarea.value.trim();
        textarea.style.height = 'auto';
        textarea.style.height = Math.min(textarea.scrollHeight, 110) + 'px';
      });

      function applyTheme(appearance) {
        if (!appearance) return;
        if (appearance.launcher_position === 'left') {
          wrap.classList.add('samche-pos-left');
        } else {
          wrap.classList.remove('samche-pos-left');
        }
        if (appearance.title) {
          var titleEl = header.querySelector('.samche-header-title');
          if (titleEl) titleEl.textContent = appearance.title;
        }
        if (appearance.subtitle) {
          var statusText = header.querySelector('.samche-status-text');
          if (statusText) statusText.textContent = appearance.subtitle;
        }
        if (appearance.launcher_icon === 'logo' && appearance.logo_url) {
          launcher.innerHTML = '<img class="samche-launcher-logo" src="' + appearance.logo_url + '" alt="Logo" />';
        }
        if (appearance.logo_url) {
          var avatarWrap = header.querySelector('.samche-header-avatar');
          if (avatarWrap) avatarWrap.innerHTML = '<img src="' + appearance.logo_url + '" alt="Logo" />';
        }
        if (appearance.theme) {
          var t = appearance.theme;
          var target = shadow.host || host;
          if (t.primary_color) target.style.setProperty('--chat-primary', t.primary_color);
          if (t.primary_foreground) target.style.setProperty('--chat-primary-foreground', t.primary_foreground);
          if (t.accent_color) target.style.setProperty('--chat-accent', t.accent_color);
          if (t.surface_tint) target.style.setProperty('--chat-surface-tint', t.surface_tint);
          if (t.surface_glass) target.style.setProperty('--chat-surface-glass', t.surface_glass);
          if (t.surface_solid) target.style.setProperty('--chat-surface-solid', t.surface_solid);
          if (t.glow_color) target.style.setProperty('--chat-glow', t.glow_color);
          if (t.text_color) target.style.setProperty('--chat-text', t.text_color);
          if (t.muted_color) target.style.setProperty('--chat-muted', t.muted_color);
          if (t.border_color) target.style.setProperty('--chat-border', t.border_color);
        }
      }

      function appendMessage(role, text) {
        var msg = document.createElement('div');
        msg.className = 'samche-msg ' + (role === 'user' ? 'samche-msg-user' : 'samche-msg-bot');
        if (role === 'user') {
          msg.textContent = text;
        } else {
          var hasHtml = /<[a-z][\s\S]*>/i.test(text);
          if (hasHtml) msg.innerHTML = text; else msg.textContent = text;
        }
        messages.appendChild(msg);
        smartScrollToBottom(messages, true);
        return msg;
      }

      async function handleSend() {
        var text = textarea.value.trim();
        if (!text) return;
        textarea.value = '';
        textarea.style.height = 'auto';
        sendBtn.disabled = true;
        recordUserMessage();

        appendMessage('user', text);
        var indicator = createTypingIndicator({ className: 'samche-msg samche-msg-bot' });
        messages.appendChild(indicator);
        smartScrollToBottom(messages, true);

        try {
          var ctx = capturePageContext() || {};
          var headers = { 'Content-Type': 'application/json' };
          if (sessionToken) headers['X-Samche-Web-Chat-Session'] = sessionToken;

          var res = await fetch('/api/chat', {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({
              message: text,
              conversation_session: sessionToken,
              current_url: ctx.url,
              canonical_url: ctx.canonical_url,
              entity_id: ctx.entity_id,
              entity_type: ctx.entity_type,
              entity_name: ctx.entity_name,
            }),
          });
          var data = await res.json();
          clearTypingIndicator(messages);

          var reply = data.reply || data.response || data.text || 'Anlaşıldı, size nasıl yardımcı olabilirim?';
          var botBubble = document.createElement('div');
          botBubble.className = 'samche-msg samche-msg-bot';
          messages.appendChild(botBubble);
          await progressiveReveal(botBubble, reply, { container: messages });
        } catch (err) {
          clearTypingIndicator(messages);
          appendMessage('bot', 'Üzgünüm, şu anda yanıt verilemiyor. Lütfen tekrar deneyin.');
        } finally {
          sendBtn.disabled = !textarea.value.trim();
        }
      }

      function setChips(chipList) {
        chipsContainer.innerHTML = '';
        if (!chipList || !Array.isArray(chipList) || chipList.length === 0) {
          chipsContainer.style.display = 'none';
          return;
        }
        chipsContainer.style.display = 'flex';
        chipList.forEach(function(prompt) {
          var btn = document.createElement('button');
          btn.className = 'samche-chip';
          btn.type = 'button';
          btn.textContent = prompt;
          btn.addEventListener('click', function(ev) {
            ev.preventDefault();
            textarea.value = prompt;
            handleSend();
          });
          chipsContainer.appendChild(btn);
        });
      }

      function setContextBadge(text) {
        if (!contextBadgeEl) return;
        if (!text) {
          contextBadgeEl.style.display = 'none';
          contextBadgeEl.textContent = '';
        } else {
          contextBadgeEl.style.display = 'inline-flex';
          contextBadgeEl.textContent = text;
        }
      }

      sendBtn.addEventListener('click', handleSend);
      textarea.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          handleSend();
        }
      });

      var storedSession = SamcheChatPersistence.getStoredSession(widgetKey);
      var bHeaders = { 'Content-Type': 'application/json' };
      if (storedSession) bHeaders['X-Samche-Web-Chat-Session'] = storedSession;

      fetch('/api/chat/bootstrap', {
        method: 'POST',
        headers: bHeaders,
        body: JSON.stringify({ widget_key: widgetKey, session_token: storedSession || undefined }),
      })
      .then(function(res) { return res.json(); })
      .then(function(data) {
        if (!data || data.error) return;
        if (data.session) {
          sessionToken = data.session;
          SamcheChatPersistence.storeSession(widgetKey, sessionToken);
        }
        if (data.appearance) applyTheme(data.appearance);
        if (data.behavior && data.behavior.language === 'ar') panel.setAttribute('dir', 'rtl');

        if (data.history && data.history.length > 0) {
          SamcheChatPersistence.hydrateHistory(messages, data.history, function(role, text) {
            appendMessage(role, text);
          });
        } else if (messages.querySelectorAll('.samche-msg').length === 0) {
          var welcome = (data.appearance && data.appearance.greeting)
            || (data.assistant && data.assistant.greeting)
            || 'Merhaba! SamChe Mağaza Asistanıyım. Ürün özellikleri, kablosuz şarj desteği, su geçirmezlik veya sipariş süreçleri hakkında bana danışabilirsiniz. Nasıl yardımcı olabilirim?';
          appendMessage('bot', welcome);
        }

        if (data.browsing_state && data.browsing_state.current_entity && data.browsing_state.current_entity.entity_name) {
          setContextBadge('Gözatılan: ' + data.browsing_state.current_entity.entity_name);
        }

        if (data.behavior && data.behavior.proactive_enabled) {
          configureProactive({
            sessionToken: sessionToken,
            dwellThresholdSeconds: data.behavior.dwell_threshold_seconds || 15,
            cooldownSeconds: data.behavior.cooldown_seconds || 300,
            onAutoOpen: function(msg) {
              launcher.classList.add('samche-intent-pulse');
              if (data.behavior.high_intent_activation) {
                openPanel();
                appendMessage('bot', msg);
              }
            },
          });
          startDwellTracker(sessionToken, data.behavior.dwell_threshold_seconds || 15);
        }
      })
      .catch(function() {});

      initSpaNavigationListener(function(newContext) {
        if (newContext) {
          if (newContext.entity_name && newContext.entity_name !== 'SamChe Teknoloji Mağazası') {
            setContextBadge('Gözatılan: ' + newContext.entity_name);
          } else {
            setContextBadge(null);
          }
        }
        if (sessionToken && newContext) {
          fetch('/api/chat/page-context', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Samche-Web-Chat-Session': sessionToken,
            },
            body: JSON.stringify({ page_context: newContext }),
          })
          .then(function(res) { return res.json(); })
          .then(function(data) {
            if (data && data.proactive_engagement && data.proactive_engagement.should_open && data.proactive_engagement.message) {
              if (!isOpen && !proactiveState.hasUserMessaged) {
                openPanel();
                var botBubble = appendMessage('bot', '');
                progressiveReveal(botBubble, data.proactive_engagement.message, { container: messages });
              }
            }
          })
          .catch(function() {});
        }
      });

      var inst = {
        host: host,
        shadow: shadow,
        open: openPanel,
        close: closePanel,
        toggle: function() { if (isOpen) closePanel(); else openPanel(); },
        applyTheme: applyTheme,
        appendMessage: appendMessage,
        setChips: setChips,
        setContextBadge: setContextBadge,
        sendMessage: function(text) {
          textarea.value = text;
          handleSend();
        },
        isOpen: function() { return isOpen; },
        getSessionToken: function() { return sessionToken; },
      };
      this.instances[widgetKey] = inst;
      return inst;
    }
  };

  global.SamcheWebChat = {
    mount: SamcheCanonicalWidget.mount.bind(SamcheCanonicalWidget),
    instances: SamcheCanonicalWidget.instances,
    getInstance: function(key) {
      if (key) return SamcheCanonicalWidget.instances[key] || null;
      var keys = Object.keys(SamcheCanonicalWidget.instances);
      return keys.length > 0 ? SamcheCanonicalWidget.instances[keys[0]] : null;
    },
    open: function(key) {
      var i = this.getInstance(key);
      if (i) i.open();
    },
    close: function(key) {
      var i = this.getInstance(key);
      if (i) i.close();
    },
    toggle: function(key) {
      var i = this.getInstance(key);
      if (i) i.toggle();
    },
    setChips: function(chips, key) {
      var i = this.getInstance(key);
      if (i) i.setChips(chips);
    },
    setContextBadge: function(text, key) {
      var i = this.getInstance(key);
      if (i) i.setContextBadge(text);
    },
    sendMessage: function(text, key) {
      var i = this.getInstance(key);
      if (i) i.sendMessage(text);
    },
  };

  if (typeof document !== 'undefined') {
    function autoInit() {
      var scriptTag = document.querySelector('script[data-widget-key]');
      var key = scriptTag ? scriptTag.getAttribute('data-widget-key') : null;
      if (!key && typeof window !== 'undefined' && window.location) {
        try {
          var urlKey = new URLSearchParams(window.location.search).get('widget_key');
          if (urlKey) key = urlKey.trim();
        } catch (e) {}
      }
      if (!key && typeof window !== 'undefined' && window.__SAMCHE_WEB_CHAT_KEY__) {
        key = window.__SAMCHE_WEB_CHAT_KEY__;
      }
      if (!key && typeof window !== 'undefined' && window.location && window.location.pathname && window.location.pathname.indexOf('/task8-demo') !== -1) {
        key = 'wch_staging_task8_demo';
      }
      if (key) {
        SamcheCanonicalWidget.mount({ widgetKey: key });
      }
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', autoInit);
    } else {
      autoInit();
    }
  }



  global.SamcheChatPersistence = SamcheChatPersistence;
  global.SamcheChatUX = {
    PRESENTATION_TIMING: PRESENTATION_TIMING,
    responseDelay: responseDelay,
    isNearBottom: isNearBottom,
    smartScrollToBottom: smartScrollToBottom,
    createTypingIndicator: createTypingIndicator,
    clearTypingIndicator: clearTypingIndicator,
    progressiveText: progressiveText,
    progressiveReveal: progressiveReveal,
    injectStyles: injectStyles,
  };

  global.SamcheContextCapture = {
    capturePageContext: capturePageContext,
    initSpaNavigationListener: initSpaNavigationListener,
  };
  global.SamcheProactiveEngagement = {
    configure: configureProactive,
    startDwellTracker: startDwellTracker,
    handleProactiveResult: handleProactiveResult,
    recordUserMessage: recordUserMessage,
    recordDismissal: recordDismissal,
    getState: function() { return Object.assign({}, proactiveState); },
  };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      SamcheContextCapture: global.SamcheContextCapture,
      SamcheProactiveEngagement: global.SamcheProactiveEngagement,
      SamcheChatUX: global.SamcheChatUX,
      SamcheChatPersistence: global.SamcheChatPersistence,
      SamcheWebChat: global.SamcheWebChat,
    };
  }
})(typeof window !== 'undefined' ? window : globalThis);
