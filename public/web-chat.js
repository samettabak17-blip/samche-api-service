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
    };
  }
})(typeof window !== 'undefined' ? window : globalThis);
