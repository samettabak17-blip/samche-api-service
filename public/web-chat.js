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
        if ((type === 'ItemList' || Array.isArray(item.itemListElement)) && Array.isArray(item.itemListElement)) {
          var itemsList = item.itemListElement.map(function(el) {
            var itemObj = (el && typeof el === 'object') ? (el.item || el) : el;
            return safeString(itemObj.name || itemObj.title || itemObj, 120);
          }).filter(Boolean);
          if (itemsList.length > 0) {
            attributes.catalog_items = itemsList.slice(0, 10);
          }
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
    var currentPath = safeString(window.location.pathname + (window.location.hash || ''), 1024);
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

    if (!safeAttributes.visible_products && !safeAttributes.catalog_items && typeof document !== 'undefined') {
      try {
        var productEls = document.querySelectorAll('.product-card .product-title, .product-title, [itemprop="name"]');
        if (productEls && productEls.length > 0) {
          var foundNames = [];
          for (var p = 0; p < productEls.length && foundNames.length < 10; p++) {
            var pText = safeString(productEls[p].textContent, 120);
            if (pText && foundNames.indexOf(pText) === -1) {
              foundNames.push(pText);
            }
          }
          if (foundNames.length > 0) {
            safeAttributes.visible_products = foundNames;
            if (!summary || summary === 'PAGE' || summary === 'Catalog') {
              summary = 'Bu sayfada görüntülenen ürünler: ' + foundNames.join(', ');
            }
          }
        }
      } catch (domErr) {}
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

    var lastUrl = (window.location)
      ? (window.location.pathname + window.location.search + window.location.hash)
      : '';
    function checkNavigation() {
      if (!window.location) return;
      var currentUrl = window.location.pathname + window.location.search + window.location.hash;
      if (currentUrl !== lastUrl) {
        lastUrl = currentUrl;
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
    currentEntityId: null,
    lastAcknowledgedEntityId: null,
    acknowledgedEntityIds: {},
    isContextualOpeningInProgress: false,
    entityDwellStartedAt: null,
    entityDwellStartPerf: null,
    isEvaluating: false,
    hasUserMessaged: false,
    hasProactivelyEngaged: false,
    dismissedAt: 0,
    dwellTimer: null,
    dwellSeconds: 0,
    lastCheckedDwell: -1,
    intervalTimer: null,
    cooldownSeconds: 300,
    dwellThresholdSeconds: 15,
    renderedMessageIds: {},
    onAutoOpen: null,
    onNudge: null,
    onProactiveMessage: null,
  };

  function configureProactive(opts) {
    if (!opts) return;
    if (opts.sessionToken) proactiveState.sessionToken = opts.sessionToken;
    if (typeof opts.cooldownSeconds === 'number') proactiveState.cooldownSeconds = opts.cooldownSeconds;
    if (typeof opts.dwellThresholdSeconds === 'number') proactiveState.dwellThresholdSeconds = opts.dwellThresholdSeconds;
    if (typeof opts.hasProactivelyEngaged === 'boolean') proactiveState.hasProactivelyEngaged = opts.hasProactivelyEngaged;
    if (typeof opts.dismissedAt === 'number') proactiveState.dismissedAt = opts.dismissedAt;
    if (typeof opts.onAutoOpen === 'function') proactiveState.onAutoOpen = opts.onAutoOpen;
    if (typeof opts.onNudge === 'function') proactiveState.onNudge = opts.onNudge;
    if (typeof opts.onProactiveMessage === 'function') proactiveState.onProactiveMessage = opts.onProactiveMessage;
  }

  function clearTimers() {
    if (proactiveState.dwellTimer) clearTimeout(proactiveState.dwellTimer);
    if (proactiveState.intervalTimer) clearInterval(proactiveState.intervalTimer);
    proactiveState.dwellTimer = null;
    proactiveState.intervalTimer = null;
    proactiveState.dwellSeconds = 0;
    proactiveState.lastCheckedDwell = -1;
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

    // Only run discrete entity dwell tracker if on a discrete entity
    if (!proactiveState.currentEntityId) return;

    if (proactiveState.intervalTimer) clearInterval(proactiveState.intervalTimer);
    proactiveState.intervalTimer = null;
    var threshold = customDwellSeconds || proactiveState.dwellThresholdSeconds;

    proactiveState.intervalTimer = setInterval(function() {
      if (proactiveState.hasUserMessaged || proactiveState.hasProactivelyEngaged) {
        clearTimers();
        return;
      }
      if (!proactiveState.currentEntityId || !proactiveState.entityDwellStartedAt) {
        clearTimers();
        return;
      }

      if (proactiveState.isEvaluating) return; // In-flight lock!

      var elapsedMs = Date.now() - proactiveState.entityDwellStartedAt;
      var elapsedSec = Math.floor(elapsedMs / 1000);
      proactiveState.dwellSeconds = elapsedSec;

      if (elapsedSec >= threshold) {
        // Qualified threshold reached! Clear interval immediately so no concurrent requests fire!
        clearInterval(proactiveState.intervalTimer);
        proactiveState.intervalTimer = null;
        checkDwellIntent(elapsedSec);
      } else if (elapsedSec > 0 && elapsedSec % 5 === 0 && elapsedSec !== proactiveState.lastCheckedDwell) {
        proactiveState.lastCheckedDwell = elapsedSec;
        checkDwellIntent(elapsedSec);
      }
    }, 500);
  }

  function checkDwellIntent(seconds) {
    if (!proactiveState.sessionToken || proactiveState.hasUserMessaged || proactiveState.hasProactivelyEngaged) return;
    if (proactiveState.isEvaluating) return; // In-flight mutex!

    var cooldownMs = proactiveState.cooldownSeconds * 1000;
    if (proactiveState.dismissedAt && (Date.now() - proactiveState.dismissedAt < cooldownMs)) {
      return;
    }

    var dwellToSend = typeof seconds === 'number' && seconds >= 0
      ? seconds
      : (proactiveState.dwellSeconds || 0);

    proactiveState.isEvaluating = true;

    fetch('/api/chat/evaluate-intent', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Samche-Web-Chat-Session': proactiveState.sessionToken,
      },
      body: JSON.stringify({
        dwell_seconds: dwellToSend,
      }),
    })
    .then(function(res) { return res.json(); })
    .then(function(data) {
      proactiveState.isEvaluating = false;
      handleProactiveResult(data);
    })
    .catch(function() {
      proactiveState.isEvaluating = false;
    });
  }

  function handleProactiveResult(data) {
    if (!data || !data.proactive_engagement) return;
    var pe = data.proactive_engagement;
    if (proactiveState.hasUserMessaged || proactiveState.hasProactivelyEngaged) return;

    var cooldownMs = proactiveState.cooldownSeconds * 1000;
    if (proactiveState.dismissedAt && (Date.now() - proactiveState.dismissedAt < cooldownMs)) {
      return;
    }

    if (pe.should_open && pe.message) {
      var eventId = pe.event_id || ('pe_' + (proactiveState.currentEntityId || 'entity'));
      if (proactiveState.renderedMessageIds[eventId]) {
        return; // Idempotency: Already rendered!
      }
      proactiveState.renderedMessageIds[eventId] = true;
      proactiveState.hasProactivelyEngaged = true;
      clearTimers();
      if (typeof proactiveState.onAutoOpen === 'function') {
        proactiveState.onAutoOpen(pe.message, pe);
      }
      if (typeof proactiveState.onProactiveMessage === 'function') {
        proactiveState.onProactiveMessage(pe.message, pe);
      }
    } else if (pe.should_nudge || pe.intent_state === 'MEDIUM') {
      if (typeof proactiveState.onNudge === 'function') {
        proactiveState.onNudge(pe.message, pe);
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
  function buildSafeDefaultGreeting(data) {
    var lang = (data && data.behavior && data.behavior.language) || 'tr';
    if (lang === 'en') return 'Hello! How can I help you today?';
    if (lang === 'ar') return 'مرحباً! كيف يمكنني مساعدتك اليوم؟';
    return 'Merhaba! Size nasıl yardımcı olabilirim?';
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
    // Encapsulated directly inside Shadow DOM CANONICAL_WIDGET_CSS to prevent host page CSS pollution.
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
    recordConversationReset: function(widgetKey) {
      var key = 'samche_webchat_reset_' + encodeURIComponent(widgetKey || 'default');
      var ts = String(Date.now());
      memStore[key] = ts;
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          window.localStorage.setItem(key, ts);
        }
      } catch (e) {}
      return ts;
    },
    getLastResetTime: function(widgetKey) {
      var key = 'samche_webchat_reset_' + encodeURIComponent(widgetKey || 'default');
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          var val = window.localStorage.getItem(key);
          if (val) return parseInt(val, 10);
        }
      } catch (e) {}
      return memStore[key] ? parseInt(memStore[key], 10) : 0;
    },
    hydrateHistory: function(container, messages, appendFn) {
      if (!container || !Array.isArray(messages)) return 0;
      var count = 0;
      var seenGreeting = false;
      var seenProactive = {};
      var seenContextual = {};
      for (var i = 0; i < messages.length; i++) {
        var item = messages[i];
        if (!item) continue;
        var role = (item.role === 'user' || item.sender_type === 'CUSTOMER') ? 'user' : 'bot';
        var text = typeof item.content === 'string' ? item.content : (item.text || '');
        var isGreeting = Boolean(item.message_type === 'INITIAL_GREETING' || item.is_greeting);
        var isProactive = Boolean(item.message_type === 'PROACTIVE' || item.is_proactive || item.proactive_event_id);
        var isContextual = Boolean(item.message_type === 'CONTEXTUAL_OPEN');

        if (isGreeting) {
          if (seenGreeting) continue;
          seenGreeting = true;
        }
        if (isProactive) {
          var pKey = item.proactive_event_id || 'proactive_history';
          if (seenProactive[pKey]) continue;
          seenProactive[pKey] = true;
          proactiveState.hasProactivelyEngaged = true;
          if (item.entity_id) {
            proactiveState.acknowledgedEntityIds[String(item.entity_id)] = true;
            proactiveState.lastAcknowledgedEntityId = String(item.entity_id);
          }
          if (item.proactive_event_id) {
            proactiveState.renderedMessageIds[item.proactive_event_id] = true;
          }
        }
        if (isContextual) {
          var cKey = item.contextual_event_id || item.id || ('ctx_open_' + item.entity_id);
          if (seenContextual[cKey]) continue;
          seenContextual[cKey] = true;
          if (item.entity_id) {
            proactiveState.acknowledgedEntityIds[String(item.entity_id)] = true;
            proactiveState.lastAcknowledgedEntityId = String(item.entity_id);
          }
          if (cKey) {
            proactiveState.renderedMessageIds[cKey] = true;
          }
        }
        if (typeof appendFn === 'function') {
          appendFn(role, text, item);
          count++;
        }
      }
      return count;
    }
  };
  function computeClientContrastForeground(hex) {
    if (!hex || typeof hex !== 'string') return '#FFFFFF';
    var clean = hex.replace('#', '').trim();
    if (clean.length === 3) clean = clean[0] + clean[0] + clean[1] + clean[1] + clean[2] + clean[2];
    if (clean.length !== 6) return '#FFFFFF';
    var r = parseInt(clean.slice(0, 2), 16);
    var g = parseInt(clean.slice(2, 4), 16);
    var b = parseInt(clean.slice(4, 6), 16);
    var sRGB = [r, g, b].map(function(v) {
      var c = v / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    var lum = 0.2126 * sRGB[0] + 0.7152 * sRGB[1] + 0.0722 * sRGB[2];
    var whiteRatio = (1.0 + 0.05) / (lum + 0.05);
    return whiteRatio >= 4.5 ? '#FFFFFF' : '#0F172A';
  }

  /* Canonical Shared Web Chat Runtime & Isolated Shadow DOM Renderer */
  var CANONICAL_WIDGET_CSS_A = [
    ':host { all: initial; position: fixed; bottom: 0; right: 0; width: 0; height: 0; z-index: 2147483640; pointer-events: none; overflow: visible; display: block; }',
    '.samche-wrap { all: initial; position: fixed; bottom: 0; right: 0; width: 0; height: 0; z-index: 2147483640; pointer-events: none; overflow: visible; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: var(--chat-text, #F8FAFC); font-size: 14px; line-height: 1.5; text-align: left; letter-spacing: normal; direction: ltr; }',
    '.samche-pos-left.samche-wrap { right: auto; left: 0; }',
    '*, *::before, *::after { box-sizing: border-box !important; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; }',
    'svg { display: block; flex-shrink: 0; box-sizing: content-box; }',
    'button { background: none; border: none; outline: none; cursor: pointer; padding: 0; margin: 0; font-family: inherit; color: inherit; line-height: 1; }',
    'textarea, input { font-family: inherit; font-size: 14px; line-height: 1.4; box-sizing: border-box; }',
    '.samche-launcher { position: fixed; bottom: 24px; right: 24px; width: 60px !important; height: 60px !important; min-width: 60px !important; min-height: 60px !important; max-width: 60px !important; max-height: 60px !important; border-radius: 50% !important; background: var(--chat-primary, #2563EB); color: var(--chat-primary-foreground, #FFFFFF); border: 1px solid var(--chat-border, rgba(255,255,255,0.15)); box-shadow: 0 8px 28px -4px var(--chat-glow, rgba(37,99,235,0.4)), 0 4px 12px rgba(0,0,0,0.25); cursor: pointer; display: flex !important; align-items: center; justify-content: center; pointer-events: auto; transition: transform .2s cubic-bezier(.16,1,.3,1), box-shadow .2s ease; outline: none; animation: samche-glow-breathe 4s infinite ease-in-out; z-index: 2147483641; padding: 0 !important; margin: 0 !important; overflow: hidden; }',
    '.samche-pos-left .samche-launcher { right: auto; left: 24px; }',
    '.samche-launcher:hover { transform: scale(1.05); }',
    '.samche-launcher:focus-visible { outline: 2px solid var(--chat-accent, #60A5FA); outline-offset: 3px; }',
    '.samche-launcher-icon { width: 28px !important; height: 28px !important; display: flex; align-items: center; justify-content: center; fill: currentColor; }',
    '.samche-launcher-icon svg { width: 28px !important; height: 28px !important; max-width: 28px !important; max-height: 28px !important; fill: currentColor; }',
    '.samche-launcher-logo { width: 36px; height: 36px; border-radius: 50%; object-fit: contain; }',
    '.samche-intent-pulse { animation: samche-intent-pulse 2s infinite ease-in-out !important; }',
    '@keyframes samche-glow-breathe { 0%, 100% { box-shadow: 0 8px 28px -4px var(--chat-glow, rgba(37,99,235,0.3)), 0 4px 12px rgba(0,0,0,0.2); } 50% { box-shadow: 0 12px 36px -2px var(--chat-glow, rgba(37,99,235,0.55)), 0 4px 16px rgba(0,0,0,0.3); } }',
    '@keyframes samche-intent-pulse { 0% { transform: scale(1); box-shadow: 0 0 0 0 var(--chat-glow, rgba(37,99,235,0.6)); } 50% { transform: scale(1.08); box-shadow: 0 0 0 14px rgba(37,99,235,0); } 100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(37,99,235,0); } }',
    '.samche-panel { position: fixed; bottom: 96px; right: 24px; width: 400px; max-width: calc(100vw - 32px); height: 600px; max-height: calc(100vh - 120px); border-radius: 20px; background: var(--chat-surface-glass, rgba(18,20,26,0.92)); color: var(--chat-text, #F8FAFC) !important; backdrop-filter: blur(24px) saturate(180%); -webkit-backdrop-filter: blur(24px) saturate(180%); border: 1px solid var(--chat-border, rgba(255,255,255,0.12)); box-shadow: 0 24px 64px -12px rgba(0,0,0,0.55), 0 0 0 1px var(--chat-border, rgba(255,255,255,0.08)); display: flex; flex-direction: column; overflow: hidden; pointer-events: none; opacity: 0; transform: translateY(16px) scale(0.96); visibility: hidden; transition: transform .28s cubic-bezier(.16,1,.3,1), opacity .25s ease-out; z-index: 2147483642; }',
    '.samche-pos-left .samche-panel { right: auto; left: 24px; }',
    '.samche-panel.samche-open { opacity: 1; transform: translateY(0) scale(1); visibility: visible !important; pointer-events: auto; }',
    '@supports not (backdrop-filter: blur(10px)) { .samche-panel { background: var(--chat-surface-solid, #12141a) !important; } }'
  ].join('\n');


  var CANONICAL_WIDGET_CSS_B = [
    '.samche-header { padding: 16px 20px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--chat-border, rgba(255,255,255,0.08)); background: rgba(255,255,255,0.03); flex-shrink: 0; }',
    '.samche-header-info { display: flex; align-items: center; gap: 12px; }',
    '.samche-header-avatar { width: 36px; height: 36px; border-radius: 10px; background: var(--chat-surface-tint, #1E293B); border: 1px solid var(--chat-border, rgba(255,255,255,0.12)); display: flex; align-items: center; justify-content: center; overflow: hidden; flex-shrink: 0; }',
    '.samche-header-avatar img { width: 100%; height: 100%; object-fit: contain; }',
    '.samche-header-avatar svg, .samche-avatar-icon svg { width: 20px !important; height: 20px !important; max-width: 20px !important; max-height: 20px !important; fill: var(--chat-primary, #2563EB); }',
    '.samche-header-titles { display: flex; flex-direction: column; }',
    '.samche-header-title { font-size: 15px; font-weight: 600; color: var(--chat-text, #F8FAFC); line-height: 1.25; }',
    '.samche-header-status { font-size: 12px; color: var(--chat-muted, #94A3B8); display: flex; align-items: center; gap: 5px; margin-top: 2px; }',
    '.samche-status-dot { width: 7px; height: 7px; border-radius: 50%; background: #22C55E; box-shadow: 0 0 8px #22C55E; display: inline-block; }',
    '.samche-header-context-badge { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 6px; background: rgba(96,165,250,0.15); color: var(--chat-accent, #60A5FA); font-size: 11px; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 200px; }',
    '.samche-close-btn { width: 32px; height: 32px; border-radius: 8px; border: 1px solid var(--chat-border, rgba(255,255,255,0.1)); background: rgba(255,255,255,0.05); color: var(--chat-muted, #94A3B8); cursor: pointer; display: flex; align-items: center; justify-content: center; outline: none; transition: background .15s ease, color .15s ease; flex-shrink: 0; padding: 0; }',
    '.samche-close-btn:hover { background: rgba(255,255,255,0.12); color: var(--chat-text, #F8FAFC); }',
    '.samche-close-btn:focus-visible { outline: 2px solid var(--chat-accent, #60A5FA); }',
    '.samche-close-btn svg { width: 14px !important; height: 14px !important; max-width: 14px !important; max-height: 14px !important; }',
    '.samche-header-actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }',
    '.samche-clear-btn { width: 32px; height: 32px; border-radius: 8px; border: 1px solid var(--chat-border, rgba(255,255,255,0.1)); background: rgba(255,255,255,0.05); color: var(--chat-muted, #94A3B8); cursor: pointer; display: flex; align-items: center; justify-content: center; outline: none; transition: background .15s ease, color .15s ease, opacity .15s ease; flex-shrink: 0; padding: 0; }',
    '.samche-clear-btn:hover:not(:disabled) { background: rgba(255,255,255,0.12); color: var(--chat-text, #F8FAFC); }',
    '.samche-clear-btn:focus-visible { outline: 2px solid var(--chat-accent, #60A5FA); }',
    '.samche-clear-btn:disabled { opacity: 0.35; cursor: not-allowed; }',
    '.samche-clear-btn svg { width: 15px !important; height: 15px !important; max-width: 15px !important; max-height: 15px !important; }',
    '.samche-confirm-dialog { position: absolute; inset: 0; background: rgba(10, 12, 16, 0.78); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); display: flex; align-items: center; justify-content: center; padding: 24px; z-index: 100; animation: samche-msg-fadein .18s ease-out; }',
    '.samche-confirm-content { background: var(--chat-surface-solid, #1E2330); border: 1px solid var(--chat-border, rgba(255,255,255,0.15)); border-radius: 16px; padding: 20px 18px 16px; width: 100%; max-width: 300px; box-shadow: 0 16px 36px rgba(0,0,0,0.5); display: flex; flex-direction: column; align-items: center; text-align: center; gap: 14px; }',
    '.samche-confirm-message { font-size: 13.5px; font-weight: 500; color: var(--chat-text, #F8FAFC); line-height: 1.45; margin: 0; }',
    '.samche-confirm-buttons { display: flex; gap: 10px; width: 100%; margin-top: 4px; }',
    '.samche-confirm-btn { flex: 1; padding: 9px 12px; font-size: 13px; font-weight: 600; border-radius: 10px; cursor: pointer; transition: all .15s ease; display: inline-flex; align-items: center; justify-content: center; outline: none; }',
    '.samche-confirm-cancel { background: rgba(255,255,255,0.08); border: 1px solid var(--chat-border, rgba(255,255,255,0.12)); color: var(--chat-muted, #94A3B8); }',
    '.samche-confirm-cancel:hover:not(:disabled) { background: rgba(255,255,255,0.14); color: var(--chat-text, #F8FAFC); }',
    '.samche-confirm-proceed { background: #DC2626; border: 1px solid rgba(220, 38, 38, 0.4); color: #FFFFFF; }',
    '.samche-confirm-proceed:hover:not(:disabled) { background: #B91C1C; }',
    '.samche-confirm-btn:focus-visible { outline: 2px solid var(--chat-accent, #60A5FA); outline-offset: 2px; }',
    '.samche-confirm-btn:disabled { opacity: 0.5; cursor: not-allowed; }',
    '.samche-panel[dir="rtl"] .samche-confirm-buttons { flex-direction: row-reverse; }',
    '.samche-panel[dir="rtl"] .samche-header-actions { flex-direction: row-reverse; }',
    '.samche-messages { flex: 1; overflow-y: auto; padding: 18px 20px; display: flex; flex-direction: column; gap: 12px; -webkit-overflow-scrolling: touch; overscroll-behavior: contain; }',
    '.samche-msg { animation: samche-msg-fadein .24s cubic-bezier(.16,1,.3,1); max-width: 85%; font-size: 14px; line-height: 1.5; word-break: break-word; }',
    '.samche-msg-user { align-self: flex-end; background: var(--chat-primary, #2563EB); color: var(--chat-primary-foreground, #FFFFFF) !important; padding: 10px 14px; border-radius: 16px 16px 4px 16px; box-shadow: 0 4px 14px -3px var(--chat-glow, rgba(37,99,235,0.3)); font-weight: 500; }',
    '.samche-msg-bot { align-self: flex-start; background: rgba(255,255,255,0.07); color: var(--chat-text, #F8FAFC) !important; border: 1px solid var(--chat-border, rgba(255,255,255,0.08)); padding: 12px 16px; border-radius: 16px 16px 16px 4px; }',
    '.samche-msg-bot a { color: var(--chat-accent, #60A5FA); text-decoration: underline; }',
    '.samche-chips { display: flex; flex-wrap: wrap; gap: 6px; padding: 8px 16px; border-top: 1px solid var(--chat-border, rgba(255,255,255,0.06)); background: rgba(0,0,0,0.1); max-height: 90px; overflow-y: auto; flex-shrink: 0; }',
    '.samche-chip { font-size: 12px; padding: 6px 12px; border-radius: 9999px; background: rgba(255,255,255,0.08); color: var(--chat-text, #F8FAFC); border: 1px solid var(--chat-border, rgba(255,255,255,0.12)); cursor: pointer; transition: background .15s ease, transform .15s ease; outline: none; white-space: nowrap; }',
    '.samche-chip:hover { background: rgba(255,255,255,0.15); transform: translateY(-1px); }',
    '.samche-composer { padding: 14px 16px; border-top: 1px solid var(--chat-border, rgba(255,255,255,0.08)); background: rgba(0,0,0,0.15); display: flex; align-items: flex-end; gap: 10px; flex-shrink: 0; }',
    '.samche-composer-input { flex: 1; background: var(--chat-input-bg, rgba(255,255,255,0.06)); border: 1px solid var(--chat-input-border, rgba(255,255,255,0.14)); border-radius: 12px; color: var(--chat-text, #F8FAFC) !important; padding: 10px 14px; font-size: 14px; line-height: 1.4; resize: none; max-height: 110px; min-height: 42px; outline: none; }',
    '.samche-composer-input:focus { border-color: var(--chat-accent, #60A5FA); }',
    '.samche-composer-input::placeholder { color: var(--chat-muted, #94A3B8) !important; }',
    '.samche-send-btn { width: 42px !important; height: 42px !important; border-radius: 12px; background: var(--chat-primary, #2563EB); color: var(--chat-primary-foreground, #FFFFFF) !important; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0; outline: none; transition: opacity .15s, transform .15s; padding: 0; }',
    '.samche-send-btn:hover:not(:disabled) { transform: scale(1.05); }',
    '.samche-send-btn:disabled { opacity: 0.45; cursor: not-allowed; }',
    '.samche-send-btn svg { width: 18px !important; height: 18px !important; max-width: 18px !important; max-height: 18px !important; fill: currentColor; }',
    '.msg-typing-indicator { display: inline-flex !important; align-items: center; gap: 4px; min-height: 20px; padding: 0.6rem 0.9rem !important; }',
    '.typing-dots { display: inline-flex; align-items: center; gap: 4px; }',
    '.typing-dot { width: 6px; height: 6px; border-radius: 50%; background-color: var(--chat-muted, #94a3b8); display: inline-block; animation: samche-typing-bounce 1.4s infinite ease-in-out both; }',
    '.typing-dot:nth-child(1) { animation-delay: -0.32s; }',
    '.typing-dot:nth-child(2) { animation-delay: -0.16s; }',
    '.typing-dot:nth-child(3) { animation-delay: 0s; }',
    '@keyframes samche-typing-bounce { 0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; } 40% { transform: scale(1.1); opacity: 1; } }',
    '@keyframes samche-msg-fadein { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }',
    '.samche-widget-inline .samche-wrap { position: absolute !important; inset: 0 !important; width: 100% !important; height: 100% !important; }',
    '.samche-widget-inline .samche-launcher { position: absolute !important; bottom: 16px !important; right: 16px !important; }',
    '.samche-widget-inline .samche-panel { position: absolute !important; bottom: 84px !important; right: 16px !important; width: calc(100% - 32px) !important; max-width: 360px !important; height: calc(100% - 100px) !important; max-height: 480px !important; }',
    '@media (max-width: 640px), (max-height: 500px) and (orientation: landscape) { .samche-launcher { bottom: 16px; right: 16px; width: 52px !important; height: 52px !important; min-width: 52px !important; min-height: 52px !important; } .samche-pos-left .samche-launcher { right: auto; left: 16px; } .samche-panel.samche-open { position: fixed !important; inset: 0 !important; width: 100vw !important; height: 100% !important; height: 100dvh !important; max-height: 100dvh !important; max-width: 100vw !important; border-radius: 0 !important; border: none !important; margin: 0 !important; padding-top: env(safe-area-inset-top, 0); padding-bottom: env(safe-area-inset-bottom, 0); } }',
    '@media (max-height: 500px) and (orientation: landscape) { .samche-panel.samche-open { position: fixed !important; inset: 0 !important; width: 100vw !important; height: 100vh !important; max-height: 100vh !important; max-width: 100vw !important; border-radius: 0 !important; border: none !important; } }',
    '.samche-panel[dir="rtl"] { direction: rtl; text-align: right; }',
    '.samche-panel[dir="rtl"] .samche-msg-user { align-self: flex-start; border-radius: 16px 16px 16px 4px; }',
    '.samche-panel[dir="rtl"] .samche-msg-bot { align-self: flex-end; border-radius: 16px 16px 4px 16px; }',
    '.samche-panel[dir="rtl"] .samche-composer-input { text-align: right; }',
    '@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important; transition-duration: .01ms !important; } }'
  ].join('\n');
  var CANONICAL_WIDGET_CSS = CANONICAL_WIDGET_CSS_A + '\n' + CANONICAL_WIDGET_CSS_B;
  var CHAT_ICON_SVG = '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.477 2 2 6.477 2 12c0 1.821.487 3.53 1.338 5L2.5 21.5l4.646-.82A9.957 9.957 0 0012 22c5.523 0 10-4.477 10-10S17.523 2 12 2zm0 18a7.96 7.96 0 01-4.07-1.11l-.29-.17-2.76.49.5-2.69-.19-.3A7.963 7.963 0 014 12c0-4.411 3.589-8 8-8s8 3.589 8 8-3.589 8-8 8z"/></svg>';
  var CLOSE_ICON_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
  var SEND_ICON_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>';
  var TRASH_ICON_SVG = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"></path><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>';

  var I18N = {
    tr: {
      clearBtnLabel: 'Sohbeti Temizle',
      confirmText: 'Sohbet geçmişini temizlemek istediğinize emin misiniz?',
      cancelBtn: 'İptal',
      clearBtn: 'Temizle',
      clearingText: 'Temizleniyor...',
      cannotClearHuman: 'Canlı destek temsilcisi görüşmesinde sohbet temizlenemez.',
      cannotClearSending: 'Mesaj iletilirken sohbet temizlenemez.',
      browsingPrefix: 'Gözatılan: ',
    },
    en: {
      clearBtnLabel: 'Clear Conversation',
      confirmText: 'Are you sure you want to clear this conversation?',
      cancelBtn: 'Cancel',
      clearBtn: 'Clear',
      clearingText: 'Clearing...',
      cannotClearHuman: 'Cannot clear conversation while human support is active.',
      cannotClearSending: 'Cannot clear conversation while sending a message.',
      browsingPrefix: 'Viewing: ',
    },
    ar: {
      clearBtnLabel: 'مسح المحادثة',
      confirmText: 'هل أنت متأكد أنك تريد مسح هذه المحادثة؟',
      cancelBtn: 'إلغاء',
      clearBtn: 'مسح',
      clearingText: 'جارٍ المسح...',
      cannotClearHuman: 'لا يمكن مسح المحادثة أثناء اتصال الدعم البشري.',
      cannotClearSending: 'لا يمكن مسح المحادثة أثناء إرسال الرسالة.',
      browsingPrefix: 'المعروض: ',
    },
  };

  function isDiscreteContext(ctx) {
    if (!ctx || !ctx.entity_type) return false;
    var isNonDiscrete = /^(?:PAGE|GENERIC_PAGE|CATALOG|CATALOGUE|HOME|HOMEPAGE|LANDING|SEARCH|CATEGORY|CATEGORIES|COLLECTION|COLLECTIONS|ABOUT|SECURITY|CONTACT|TERMS|PRIVACY|FAQ)/i.test(ctx.entity_type)
      || /^(?:catalog|home|pricing|security|about)/i.test(ctx.page_type || '');
    return !isNonDiscrete && Boolean(ctx.entity_id);
  }

  var SamcheCanonicalWidget = {
    instances: {},
    mount: function(options) {
      if (typeof document === 'undefined') return null;
      options = options || {};
      var widgetKey = options.widgetKey;
      if (!widgetKey && typeof window !== 'undefined' && window.location) {
        try {
          var urlKey = new URLSearchParams(window.location.search).get('widget_key');
          if (urlKey && urlKey.trim()) widgetKey = urlKey.trim();
        } catch (e) {}
      }
      if (!widgetKey) {
        widgetKey = typeof document.currentScript === 'object' && document.currentScript ? document.currentScript.getAttribute('data-widget-key') : null;
      }
      if (!widgetKey) {
        var scriptTag = document.querySelector('script[data-widget-key]');
        if (scriptTag) widgetKey = scriptTag.getAttribute('data-widget-key');
      }
      if (!widgetKey && typeof window !== 'undefined' && window.__SAMCHE_WEB_CHAT_KEY__) {
        widgetKey = window.__SAMCHE_WEB_CHAT_KEY__;
      }
      if (!widgetKey && typeof window !== 'undefined' && window.location && window.location.pathname && window.location.pathname.indexOf('/task8-demo') !== -1) {
        widgetKey = 'wch_staging_task8_demo';
      }
      if (!widgetKey) return null;
      if (this.instances[widgetKey]) return this.instances[widgetKey];

      var isInline = Boolean(options.inline || options.container);
      var host = document.createElement('div');
      host.id = options.container ? 'samche-webchat-preview-container' : 'samche-webchat-container';
      host.className = 'samche-widget-host' + (isInline ? ' samche-widget-inline' : '');
      if (isInline) {
        host.style.position = 'absolute';
        host.style.inset = '0';
        host.style.width = '100%';
        host.style.height = '100%';
        host.style.pointerEvents = 'none';
        host.style.overflow = 'hidden';
      } else {
        host.style.position = 'fixed';
        host.style.bottom = '0';
        host.style.right = '0';
        host.style.width = '0';
        host.style.height = '0';
        host.style.overflow = 'visible';
        host.style.pointerEvents = 'none';
        host.style.zIndex = '2147483640';
      }
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
        '<div class="samche-header-actions">',
        '  <button type="button" class="samche-clear-btn" aria-label="Sohbeti Temizle" title="Sohbeti Temizle">' + TRASH_ICON_SVG + '</button>',
        '  <button type="button" class="samche-close-btn" aria-label="Kapat" title="Kapat">' + CLOSE_ICON_SVG + '</button>',
        '</div>'
      ].join('');
      panel.appendChild(header);

      var confirmDialog = document.createElement('div');
      confirmDialog.className = 'samche-confirm-dialog';
      confirmDialog.setAttribute('role', 'alertdialog');
      confirmDialog.setAttribute('aria-modal', 'true');
      confirmDialog.setAttribute('aria-describedby', 'samche-confirm-desc');
      confirmDialog.style.display = 'none';
      confirmDialog.innerHTML = [
        '<div class="samche-confirm-content">',
        '  <div class="samche-confirm-text">',
        '    <p id="samche-confirm-desc" class="samche-confirm-message">Sohbet geçmişini temizlemek istediğinize emin misiniz?</p>',
        '  </div>',
        '  <div class="samche-confirm-buttons">',
        '    <button type="button" class="samche-confirm-btn samche-confirm-cancel">İptal</button>',
        '    <button type="button" class="samche-confirm-btn samche-confirm-proceed">Temizle</button>',
        '  </div>',
        '</div>'
      ].join('');
      panel.appendChild(confirmDialog);

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

      if (options.container) {
        options.container.appendChild(host);
      } else {
        document.body.appendChild(host);
      }
      var isOpen = false;
      var sessionToken = null;
      var isSending = false;
      var isResetting = false;
      var isHumanTakeoverActive = false;
      var currentLang = 'tr';
      var lastKnownResetTime = SamcheChatPersistence.getLastResetTime(widgetKey);
      var contextBadgeEl = header.querySelector('.samche-header-context-badge');
      var textarea = composer.querySelector('.samche-composer-input');
      var sendBtn = composer.querySelector('.samche-send-btn');
      var closeBtn = header.querySelector('.samche-close-btn');
      var clearBtn = header.querySelector('.samche-clear-btn');
      var confirmDescEl = confirmDialog.querySelector('.samche-confirm-message');
      var confirmCancelBtn = confirmDialog.querySelector('.samche-confirm-cancel');
      var confirmProceedBtn = confirmDialog.querySelector('.samche-confirm-proceed');

      function setLanguage(lang) {
        if (!lang || typeof lang !== 'string') return;
        var l = lang.toLowerCase();
        if (l.startsWith('ar')) currentLang = 'ar';
        else if (l.startsWith('en')) currentLang = 'en';
        else currentLang = 'tr';

        var dict = I18N[currentLang] || I18N.tr;
        clearBtn.setAttribute('aria-label', dict.clearBtnLabel);
        clearBtn.setAttribute('title', isHumanTakeoverActive ? dict.cannotClearHuman : dict.clearBtnLabel);
        confirmDescEl.textContent = dict.confirmText;
        confirmCancelBtn.textContent = dict.cancelBtn;
        confirmProceedBtn.textContent = dict.clearBtn;

        if (currentLang === 'ar') {
          panel.setAttribute('dir', 'rtl');
        } else {
          panel.removeAttribute('dir');
        }
      }

      clearBtn.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        if (isResetting || isSending || isHumanTakeoverActive) return;
        confirmDialog.style.display = 'flex';
        confirmCancelBtn.focus();
      });

      confirmCancelBtn.addEventListener('click', function(e) {
        e.preventDefault();
        confirmDialog.style.display = 'none';
        clearBtn.focus();
      });

      confirmDialog.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
          e.preventDefault();
          confirmDialog.style.display = 'none';
          clearBtn.focus();
        } else if (e.key === 'Tab') {
          var focusable = [confirmCancelBtn, confirmProceedBtn];
          var activeEl = shadow.activeElement || document.activeElement;
          var idx = focusable.indexOf(activeEl);
          if (e.shiftKey) {
            if (idx <= 0) {
              e.preventDefault();
              focusable[focusable.length - 1].focus();
            }
          } else {
            if (idx >= focusable.length - 1) {
              e.preventDefault();
              focusable[0].focus();
            }
          }
        }
      });

      confirmProceedBtn.addEventListener('click', function(e) {
        e.preventDefault();
        handleClearConversation();
      });

      function handleClearConversation() {
        if (isResetting || isSending || isHumanTakeoverActive) return Promise.resolve(null);
        isResetting = true;
        var dict = I18N[currentLang] || I18N.tr;
        confirmProceedBtn.textContent = dict.clearingText;
        confirmProceedBtn.disabled = true;
        confirmCancelBtn.disabled = true;
        clearBtn.disabled = true;
        sendBtn.disabled = true;
        textarea.disabled = true;

        var currentCtx = capturePageContext();
        var rHeaders = { 'Content-Type': 'application/json' };
        if (sessionToken) rHeaders['X-Samche-Web-Chat-Session'] = sessionToken;

        return fetch('/api/chat/reset', {
          method: 'POST',
          headers: rHeaders,
          body: JSON.stringify({
            page_context: currentCtx || undefined,
          }),
        })
        .then(function(res) {
          if (!res.ok) {
            if (res.status === 409) {
              throw new Error('HUMAN_TAKEOVER_ACTIVE');
            }
            throw new Error('RESET_FAILED');
          }
          return res.json();
        })
        .then(function(data) {
          confirmDialog.style.display = 'none';
          confirmProceedBtn.textContent = dict.clearBtn;
          confirmProceedBtn.disabled = false;
          confirmCancelBtn.disabled = false;
          isResetting = false;
          clearBtn.disabled = false;
          textarea.disabled = false;
          sendBtn.disabled = !textarea.value.trim();

          if (!data || data.status !== 'ok') return data;

          // 1. Clear visible messages
          messages.innerHTML = '';

          // 2. Reset message deduplication state
          proactiveState.renderedMessageIds = {};
          proactiveState.hasUserMessaged = false;
          proactiveState.isContextualOpeningInProgress = false;

          // 3. Keep current entity acknowledged so we do NOT trigger an immediate loop on current entity
          if (proactiveState.currentEntityId) {
            proactiveState.acknowledgedEntityIds[proactiveState.currentEntityId] = true;
            proactiveState.lastAcknowledgedEntityId = proactiveState.currentEntityId;
          }

          // 4. Append exactly the single new greeting from server
          var newGreeting = (data.history && data.history[0]) ? data.history[0] : null;
          var greetingText = (newGreeting && newGreeting.content)
            || (data.appearance && data.appearance.greeting)
            || (data.assistant && data.assistant.greeting)
            || 'Merhaba! Size nasıl yardımcı olabilirim?';

          appendMessage('bot', greetingText, {
            message_type: 'INITIAL_GREETING',
            is_greeting: true,
            id: (newGreeting && newGreeting.id) || ('greeting_' + (sessionToken || 'reset')),
          });

          // 5. Notify persistence for multi-tab sync
          lastKnownResetTime = Date.now();
          SamcheChatPersistence.recordConversationReset(widgetKey);

          // 6. Context badge remains current entity badge
          if (currentCtx && currentCtx.entity_name && isDiscreteContext(currentCtx)) {
            setContextBadge(dict.browsingPrefix + currentCtx.entity_name);
          }

          // 7. Focus textarea
          setTimeout(function() { textarea.focus(); }, 80);
          smartScrollToBottom(messages, false);
          return data;
        })
        .catch(function(err) {
          confirmDialog.style.display = 'none';
          confirmProceedBtn.textContent = dict.clearBtn;
          confirmProceedBtn.disabled = false;
          confirmCancelBtn.disabled = false;
          isResetting = false;
          textarea.disabled = false;
          sendBtn.disabled = !textarea.value.trim();

          if (err && err.message === 'HUMAN_TAKEOVER_ACTIVE') {
            isHumanTakeoverActive = true;
            clearBtn.disabled = true;
            clearBtn.setAttribute('title', dict.cannotClearHuman);
          } else {
            clearBtn.disabled = false;
          }
          throw err;
        });
      }

      function syncResetIfOccurred() {
        var latestReset = SamcheChatPersistence.getLastResetTime(widgetKey);
        if (latestReset > lastKnownResetTime) {
          lastKnownResetTime = latestReset;
          var bSyncHeaders = { 'Content-Type': 'application/json' };
          if (sessionToken) bSyncHeaders['X-Samche-Web-Chat-Session'] = sessionToken;
          fetch('/api/chat/bootstrap', {
            method: 'POST',
            headers: bSyncHeaders,
            body: JSON.stringify({ widget_key: widgetKey, session_token: sessionToken || undefined }),
          })
          .then(function(res) { return res.json(); })
          .then(function(bData) {
            if (!bData || bData.error) return;
            messages.innerHTML = '';
            proactiveState.renderedMessageIds = {};
            proactiveState.hasUserMessaged = false;
            var cleanHistory = Array.isArray(bData.history) ? bData.history : [];
            SamcheChatPersistence.hydrateHistory(messages, cleanHistory, function(role, text, item) {
              appendMessage(role, text, item);
            });
            smartScrollToBottom(messages, false);
          })
          .catch(function() {});
        }
      }

      if (typeof window !== 'undefined') {
        window.addEventListener('storage', function(e) {
          if (e.key === 'samche_webchat_reset_' + encodeURIComponent(widgetKey)) {
            syncResetIfOccurred();
          }
        });
        window.addEventListener('focus', function() {
          syncResetIfOccurred();
        });
      }

      function handleManualContextualOpen() {
        if (proactiveState.isContextualOpeningInProgress) return;
        var currentCtx = capturePageContext();
        if (!currentCtx || !isDiscreteContext(currentCtx)) return;

        var currentEntityId = String(currentCtx.entity_id);

        if (proactiveState.lastAcknowledgedEntityId === currentEntityId) return;
        if (proactiveState.acknowledgedEntityIds[currentEntityId]) return;

        var hasPriorContextual = Boolean(proactiveState.lastAcknowledgedEntityId) ||
          Boolean(messages.querySelector('.samche-msg[data-message-type="PROACTIVE"], .samche-msg[data-message-type="CONTEXTUAL_OPEN"]'));
        if (!hasPriorContextual) return;

        proactiveState.isContextualOpeningInProgress = true;
        var indicator = createTypingIndicator({ className: 'samche-msg samche-msg-bot' });
        messages.appendChild(indicator);
        smartScrollToBottom(messages, true);

        var headers = { 'Content-Type': 'application/json' };
        if (sessionToken) headers['X-Samche-Web-Chat-Session'] = sessionToken;

        fetch('/api/chat/contextual-open', {
          method: 'POST',
          headers: headers,
          body: JSON.stringify({
            page_context: currentCtx,
            entity_id: currentEntityId,
            entity_name: currentCtx.entity_name,
            entity_type: currentCtx.entity_type,
          }),
        })
        .then(function(res) { return res.json(); })
        .then(function(data) {
          clearTypingIndicator(messages);
          proactiveState.isContextualOpeningInProgress = false;
          if (!data || data.status === 'noop' || !data.message) {
            return;
          }
          var eventId = data.event_id || ('ctx_open_' + (sessionToken || 'init') + '_' + currentEntityId);
          if (proactiveState.renderedMessageIds[eventId]) {
            return;
          }
          proactiveState.renderedMessageIds[eventId] = true;
          proactiveState.lastAcknowledgedEntityId = currentEntityId;
          proactiveState.acknowledgedEntityIds[currentEntityId] = true;

          var botBubble = appendMessage('bot', '', {
            message_type: 'CONTEXTUAL_OPEN',
            contextual_event_id: eventId,
            entity_id: currentEntityId,
            entity_name: data.entity_name || currentCtx.entity_name,
            entity_type: data.entity_type || currentCtx.entity_type,
            id: eventId,
          });
          progressiveReveal(botBubble, data.message, { container: messages });
        })
        .catch(function() {
          clearTypingIndicator(messages);
          proactiveState.isContextualOpeningInProgress = false;
        });
      }

      function openPanel(isManual) {
        if (isOpen) return;
        isOpen = true;
        panel.classList.add('samche-open');
        launcher.setAttribute('aria-expanded', 'true');
        panel.setAttribute('aria-modal', 'true');
        launcher.classList.remove('samche-intent-pulse');
        setTimeout(function() { textarea.focus(); }, 120);
        smartScrollToBottom(messages, true);
        if (isManual) {
          handleManualContextualOpen();
        }
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
        if (isOpen) closePanel(); else openPanel(true);
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
        } else {
          launcher.innerHTML = '<span class="samche-launcher-icon">' + CHAT_ICON_SVG + '</span>';
        }
        if (appearance.logo_url) {
          var avatarWrap = header.querySelector('.samche-header-avatar');
          if (avatarWrap) avatarWrap.innerHTML = '<img src="' + appearance.logo_url + '" alt="Logo" />';
        }
        if (appearance.theme) {
          var t = appearance.theme;
          var target = shadow.host || host;
          if (t.primary_color) target.style.setProperty('--chat-primary', t.primary_color);
          var fg = t.primary_foreground || (t.primary_color ? computeClientContrastForeground(t.primary_color) : '#FFFFFF');
          target.style.setProperty('--chat-primary-foreground', fg);
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

      if (options.appearance) {
        applyTheme(options.appearance);
      }
      if (options.initialOpen) {
        openPanel();
      }

      function appendMessage(role, text, meta) {
        var msg = document.createElement('div');
        var msgType = (meta && meta.message_type) || (role === 'user' ? 'USER' : 'ASSISTANT');
        if (meta && (meta.is_greeting || meta.message_type === 'INITIAL_GREETING')) msgType = 'INITIAL_GREETING';
        if (meta && (meta.is_proactive || meta.proactive_event_id || meta.message_type === 'PROACTIVE')) msgType = 'PROACTIVE';
        if (meta && meta.message_type === 'CONTEXTUAL_OPEN') msgType = 'CONTEXTUAL_OPEN';

        msg.className = 'samche-msg ' + (role === 'user' ? 'samche-msg-user' : 'samche-msg-bot');
        msg.setAttribute('data-message-type', msgType);
        if (meta && meta.proactive_event_id) {
          msg.setAttribute('data-proactive-event-id', meta.proactive_event_id);
        }
        if (meta && meta.contextual_event_id) {
          msg.setAttribute('data-contextual-event-id', meta.contextual_event_id);
        }
        if (meta && meta.entity_id) {
          msg.setAttribute('data-entity-id', meta.entity_id);
        }
        if (meta && meta.id) {
          msg.setAttribute('data-message-id', meta.id);
        }
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
        if (!text || isSending || isResetting) return;
        isSending = true;
        clearBtn.disabled = true;
        textarea.value = '';
        textarea.style.height = 'auto';
        sendBtn.disabled = true;
        recordUserMessage();

        appendMessage('user', text, { message_type: 'USER' });
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
              page_context: ctx,
              current_url: ctx.url,
              canonical_url: ctx.canonical_url,
              entity_id: ctx.entity_id,
              entity_type: ctx.entity_type,
              entity_name: ctx.entity_name,
            }),
          });
          var rawText = await res.text();
          var data;
          try {
            data = JSON.parse(rawText);
          } catch (e) {
            data = { reply: rawText };
          }
          clearTypingIndicator(messages);

          if (!res.ok && !data.reply && !data.response && !data.text) {
            appendMessage('bot', data.error || 'Üzgünüm, şu anda yanıt verilemiyor. Lütfen tekrar deneyin.', { message_type: 'ASSISTANT' });
            return;
          }

          if (data && (data.handling_mode === 'HUMAN' || (data.reply && data.reply.indexOf('Temsilcimiz şu anda görüşmede') !== -1))) {
            isHumanTakeoverActive = true;
            clearBtn.disabled = true;
            clearBtn.setAttribute('title', (I18N[currentLang] || I18N.tr).cannotClearHuman);
          }

          var reply = data.reply || data.response || data.text || 'Anlaşıldı, size nasıl yardımcı olabilirim?';
          var botBubble = appendMessage('bot', '', { message_type: 'ASSISTANT' });
          await progressiveReveal(botBubble, reply, { container: messages });
        } catch (err) {
          clearTypingIndicator(messages);
          appendMessage('bot', 'Üzgünüm, şu anda yanıt verilemiyor. Lütfen tekrar deneyin.', { message_type: 'ASSISTANT' });
        } finally {
          isSending = false;
          sendBtn.disabled = !textarea.value.trim();
          if (!isHumanTakeoverActive && !isResetting) {
            clearBtn.disabled = false;
          }
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

          var initialCtx = capturePageContext();
          if (initialCtx) {
            fetch('/api/chat/page-context', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-Samche-Web-Chat-Session': sessionToken,
              },
              body: JSON.stringify({ page_context: initialCtx }),
            }).catch(function() {});
          }
        }
        if (data.appearance) applyTheme(data.appearance);
        if (data.behavior && data.behavior.language) {
          setLanguage(data.behavior.language);
        }
        if (data.handling_mode === 'HUMAN') {
          isHumanTakeoverActive = true;
          clearBtn.disabled = true;
          clearBtn.setAttribute('title', (I18N[currentLang] || I18N.tr).cannotClearHuman);
        } else {
          isHumanTakeoverActive = false;
          clearBtn.disabled = false;
          clearBtn.setAttribute('title', (I18N[currentLang] || I18N.tr).clearBtnLabel);
        }

        var historyList = Array.isArray(data.history) ? data.history.slice() : [];
        var hasGreetingInHistory = historyList.some(function(item) {
          return item && (item.message_type === 'INITIAL_GREETING' || item.is_greeting);
        });

        var welcomeText = (data.appearance && data.appearance.greeting)
          || (data.assistant && data.assistant.greeting)
          || buildSafeDefaultGreeting(data);

        if (!hasGreetingInHistory && welcomeText) {
          historyList.unshift({
            role: 'assistant',
            content: welcomeText,
            message_type: 'INITIAL_GREETING',
            is_greeting: true,
            id: 'greeting_' + (sessionToken || 'init'),
          });
        }

        SamcheChatPersistence.hydrateHistory(messages, historyList, function(role, text, item) {
          var msgType = (item && item.message_type)
            || (item && (item.is_proactive || item.proactive_event_id) ? 'PROACTIVE' : (item && item.is_greeting ? 'INITIAL_GREETING' : (role === 'user' ? 'USER' : 'ASSISTANT')));
          var eventId = item && (item.proactive_event_id || item.contextual_event_id || item.event_id || item.id);
          appendMessage(role, text, {
            message_type: msgType,
            is_greeting: msgType === 'INITIAL_GREETING',
            is_proactive: msgType === 'PROACTIVE',
            proactive_event_id: (msgType === 'PROACTIVE') ? eventId : undefined,
            contextual_event_id: (msgType === 'CONTEXTUAL_OPEN') ? (item.contextual_event_id || eventId) : undefined,
            entity_id: item && item.entity_id,
            entity_name: item && item.entity_name,
            entity_type: item && item.entity_type,
            id: item && item.id,
          });
        });

        if (messages.querySelectorAll('.samche-msg').length === 0 && welcomeText) {
          appendMessage('bot', welcomeText, {
            message_type: 'INITIAL_GREETING',
            is_greeting: true,
            id: 'greeting_' + (sessionToken || 'init'),
          });
        }

        var initCtx = capturePageContext();
        if (initCtx && isDiscreteContext(initCtx) && initCtx.entity_id) {
          proactiveState.currentEntityId = String(initCtx.entity_id);
          proactiveState.entityDwellStartedAt = Date.now();
          proactiveState.entityDwellStartPerf = (typeof performance !== 'undefined') ? performance.now() : Date.now();
        } else {
          proactiveState.currentEntityId = null;
          proactiveState.entityDwellStartedAt = null;
          proactiveState.entityDwellStartPerf = null;
        }

        var initialBadge = null;
        if (initCtx && isDiscreteContext(initCtx) && initCtx.entity_name) {
          initialBadge = (I18N[currentLang] || I18N.tr).browsingPrefix + initCtx.entity_name;
        } else if (data.browsing_state && data.browsing_state.current_entity && data.browsing_state.current_entity.entity_name) {
          var initEnt = data.browsing_state.current_entity;
          if (isDiscreteContext(initEnt)) {
            initialBadge = (I18N[currentLang] || I18N.tr).browsingPrefix + initEnt.entity_name;
          }
        }
        if (initialBadge) {
          setContextBadge(initialBadge);
        }

        var engagementState = (data.browsing_state && data.browsing_state.engagement_state) || {};
        var alreadyEngaged = Boolean(engagementState.proactiveMessageSent || engagementState.proactiveEngagedAt);
        var dismissedTime = engagementState.dismissedAt ? new Date(engagementState.dismissedAt).getTime() : 0;

        if (alreadyEngaged) {
          proactiveState.hasProactivelyEngaged = true;
          if (engagementState.proactiveEventId) {
            proactiveState.renderedMessageIds[engagementState.proactiveEventId] = true;
          }
        }
        if (engagementState.lastAcknowledgedEntityId) {
          proactiveState.lastAcknowledgedEntityId = String(engagementState.lastAcknowledgedEntityId);
          proactiveState.acknowledgedEntityIds[String(engagementState.lastAcknowledgedEntityId)] = true;
        }
        if (engagementState.proactiveEntityId) {
          proactiveState.acknowledgedEntityIds[String(engagementState.proactiveEntityId)] = true;
          if (!proactiveState.lastAcknowledgedEntityId) {
            proactiveState.lastAcknowledgedEntityId = String(engagementState.proactiveEntityId);
          }
        }
        if (Array.isArray(engagementState.acknowledgedEntityIds)) {
          engagementState.acknowledgedEntityIds.forEach(function(id) {
            if (id) proactiveState.acknowledgedEntityIds[String(id)] = true;
          });
        }
        if (dismissedTime > 0) {
          proactiveState.dismissedAt = dismissedTime;
        }

        if (data.behavior && data.behavior.proactive_enabled && !alreadyEngaged) {
          configureProactive({
            sessionToken: sessionToken,
            dwellThresholdSeconds: data.behavior.dwell_threshold_seconds || 15,
            cooldownSeconds: data.behavior.cooldown_seconds || 300,
            hasProactivelyEngaged: alreadyEngaged,
            dismissedAt: dismissedTime,
            onAutoOpen: function(msg, pe) {
              launcher.classList.add('samche-intent-pulse');
              if (data.behavior.high_intent_activation) {
                openPanel();
                var eventId = (pe && pe.event_id) || ('pe_' + (proactiveState.currentEntityId || 'entity'));
                if (proactiveState.renderedMessageIds[eventId]) {
                  return;
                }
                proactiveState.renderedMessageIds[eventId] = true;
                proactiveState.hasProactivelyEngaged = true;

                var botBubble = appendMessage('bot', '', {
                  message_type: 'PROACTIVE',
                  is_proactive: true,
                  proactive_event_id: eventId,
                });
                progressiveReveal(botBubble, msg, { container: messages });
              }
            },
            onNudge: function() {
              launcher.classList.add('samche-intent-pulse');
            },
          });
          if (proactiveState.currentEntityId) {
            startDwellTracker(sessionToken, data.behavior.dwell_threshold_seconds || 15);
          }
        }
      })
      .catch(function() {});

      initSpaNavigationListener(function(newContext) {
        var isDiscrete = isDiscreteContext(newContext);
        var newEntityId = isDiscrete ? String(newContext.entity_id) : null;
        var entityChanged = newEntityId !== proactiveState.currentEntityId;

        if (newEntityId && isDiscrete) {
          setContextBadge((I18N[currentLang] || I18N.tr).browsingPrefix + newContext.entity_name);
        } else {
          setContextBadge(null);
        }

        if (entityChanged) {
          proactiveState.currentEntityId = newEntityId;
          clearTimers();
          proactiveState.dwellSeconds = 0;
          proactiveState.lastCheckedDwell = -1;

          if (newEntityId) {
            proactiveState.entityDwellStartedAt = Date.now();
            proactiveState.entityDwellStartPerf = (typeof performance !== 'undefined') ? performance.now() : Date.now();
            if (!isOpen && !proactiveState.hasUserMessaged && !proactiveState.hasProactivelyEngaged) {
              startDwellTracker(sessionToken, proactiveState.dwellThresholdSeconds);
            }
          } else {
            proactiveState.entityDwellStartedAt = null;
            proactiveState.entityDwellStartPerf = null;
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
          .then(function(respData) {
            if (respData && respData.proactive_engagement) {
              var pe = respData.proactive_engagement;
              if (pe.should_open && pe.message) {
                var cooldownMs = proactiveState.cooldownSeconds * 1000;
                var isCooldown = proactiveState.dismissedAt && (Date.now() - proactiveState.dismissedAt < cooldownMs);
                var eventId = pe.event_id || ('pe_' + (proactiveState.currentEntityId || 'entity'));
                if (!isOpen && !proactiveState.hasUserMessaged && !proactiveState.hasProactivelyEngaged && !isCooldown && !proactiveState.renderedMessageIds[eventId]) {
                  proactiveState.renderedMessageIds[eventId] = true;
                  proactiveState.hasProactivelyEngaged = true;
                  clearTimers();
                  launcher.classList.add('samche-intent-pulse');
                  openPanel();
                  var botBubble = appendMessage('bot', '', {
                    message_type: 'PROACTIVE',
                    is_proactive: true,
                    proactive_event_id: eventId,
                  });
                  progressiveReveal(botBubble, pe.message, { container: messages });
                }
              } else if (pe.should_nudge || pe.intent_state === 'MEDIUM') {
                launcher.classList.add('samche-intent-pulse');
              }
            }
          })
          .catch(function() {});
        }
      });

      var inst = {
        host: host,
        shadow: shadow,
        open: function() { openPanel(true); },
        close: closePanel,
        toggle: function() { if (isOpen) closePanel(); else openPanel(true); },
        applyTheme: applyTheme,
        appendMessage: appendMessage,
        setChips: setChips,
        setContextBadge: setContextBadge,
        sendMessage: function(text) {
          textarea.value = text;
          handleSend();
        },
        clearConversation: function() { return handleClearConversation(); },
        showClearConfirmation: function() {
          if (isResetting || isSending || isHumanTakeoverActive) return false;
          confirmDialog.style.display = 'flex';
          confirmCancelBtn.focus();
          return true;
        },
        hideClearConfirmation: function() {
          confirmDialog.style.display = 'none';
          clearBtn.focus();
        },
        isResetting: function() { return isResetting; },
        isSending: function() { return isSending; },
        isHumanTakeoverActive: function() { return isHumanTakeoverActive; },
        getLanguage: function() { return currentLang; },
        setLanguage: function(l) { setLanguage(l); },
        isOpen: function() { return isOpen; },
        getSessionToken: function() { return sessionToken; },
      };
      this.instances[widgetKey] = inst;
      if (pendingChips) {
        inst.setChips(pendingChips);
      }
      if (pendingContextBadge) {
        inst.setContextBadge(pendingContextBadge);
      }
      return inst;
    }
  };

  var pendingChips = null;
  var pendingContextBadge = null;

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
    clearConversation: function(key) {
      var i = this.getInstance(key);
      if (i) return i.clearConversation();
    },
    showClearConfirmation: function(key) {
      var i = this.getInstance(key);
      if (i) return i.showClearConfirmation();
    },
    setChips: function(chips, key) {
      var i = this.getInstance(key);
      if (i) {
        i.setChips(chips);
      } else {
        pendingChips = chips;
      }
    },
    setContextBadge: function(text, key) {
      var i = this.getInstance(key);
      if (i) {
        i.setContextBadge(text);
      } else {
        pendingContextBadge = text;
      }
    },
    sendMessage: function(text, key) {
      var i = this.getInstance(key);
      if (i) i.sendMessage(text);
    },
  };

  if (typeof document !== 'undefined') {
    function autoInit() {
      var key = null;
      if (typeof window !== 'undefined' && window.location) {
        try {
          var urlKey = new URLSearchParams(window.location.search).get('widget_key');
          if (urlKey && urlKey.trim()) key = urlKey.trim();
        } catch (e) {}
      }
      if (!key) {
        var scriptTag = document.querySelector('script[data-widget-key]');
        if (scriptTag) {
          var k = scriptTag.getAttribute('data-widget-key');
          if (k && k.trim()) key = k.trim();
        }
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
    I18N: I18N,
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
  if (typeof window !== 'undefined') {
    window.__SAMCHE_PROACTIVE_TIMING__ = {
      getElapsedMs: function() {
        return proactiveState.entityDwellStartedAt ? (Date.now() - proactiveState.entityDwellStartedAt) : 0;
      },
      getElapsedSec: function() {
        return Math.floor(this.getElapsedMs() / 1000);
      },
      getEntityFirstSeenAt: function() {
        return proactiveState.entityDwellStartedAt;
      },
      getCurrentEntityId: function() {
        return proactiveState.currentEntityId;
      },
      hasProactivelyEngaged: function() {
        return proactiveState.hasProactivelyEngaged;
      },
      isEvaluating: function() {
        return proactiveState.isEvaluating;
      },
      getProactiveCount: function() {
        var container = document.querySelector('samche-web-chat')?.shadowRoot?.querySelector('.samche-messages');
        if (!container) return 0;
        return container.querySelectorAll('.samche-msg-bot[data-proactive-event-id]').length;
      },
      getAllBotMessageCount: function() {
        var container = document.querySelector('samche-web-chat')?.shadowRoot?.querySelector('.samche-messages');
        if (!container) return 0;
        return container.querySelectorAll('.samche-msg-bot').length;
      },
    };
  }

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
