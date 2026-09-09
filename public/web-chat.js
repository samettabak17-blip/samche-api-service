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

  global.SamcheContextCapture = {
    capturePageContext: capturePageContext,
    initSpaNavigationListener: initSpaNavigationListener,
  };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = global.SamcheContextCapture;
  }
})(typeof window !== 'undefined' ? window : globalThis);
