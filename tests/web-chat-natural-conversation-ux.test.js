import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import '../public/web-chat.js';
import { PRESENTATION_TIMING as GUIDE_PRESENTATION_TIMING } from '../public-guide/guide.js';

const { SamcheChatUX, SamcheProactiveEngagement } = globalThis;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Minimal DOM mock for Node test environment
function createMockElement(tagName = 'div', className = '') {
  const children = [];
  return {
    tagName: tagName.toUpperCase(),
    className: className,
    textContent: '',
    children: children,
    parentNode: null,
    isConnected: true,
    attributes: {},
    scrollHeight: 500,
    clientHeight: 300,
    scrollTop: 200,
    setAttribute(name, val) { this.attributes[name] = String(val); },
    getAttribute(name) { return this.attributes[name] || null; },
    appendChild(child) {
      if (typeof child === 'string') {
        this.textContent += child;
      } else {
        child.parentNode = this;
        children.push(child);
      }
      return child;
    },
    remove() {
      if (this.parentNode) {
        const idx = this.parentNode.children.indexOf(this);
        if (idx !== -1) this.parentNode.children.splice(idx, 1);
        this.parentNode = null;
      }
      this.isConnected = false;
    },
    querySelectorAll(selector) {
      const matches = [];
      function search(node) {
        for (const c of node.children) {
          if (selector === '.msg-typing-indicator' && c.className && c.className.includes('msg-typing-indicator')) {
            matches.push(c);
          }
          search(c);
        }
      }
      search(this);
      return matches;
    },
  };
}

// ---------------------------------------------------------------------------
// 1. WEBCHAT_TYPING_INDICATOR
// ---------------------------------------------------------------------------
test('WEBCHAT_TYPING_INDICATOR: indicator element renders correctly with accessibility attributes', () => {
  globalThis.document = {
    createElement(tag) { return createMockElement(tag); },
  };

  const indicator = SamcheChatUX.createTypingIndicator();
  assert.ok(indicator.className.includes('msg-typing-indicator'));
  assert.ok(indicator.className.includes('msg-bot'));
  assert.equal(indicator.getAttribute('role'), 'status');
  assert.equal(indicator.getAttribute('aria-live'), 'polite');
  assert.ok(indicator.getAttribute('aria-label'));

  const dots = indicator.children[0]?.children || [];
  assert.equal(dots.length, 3);
  for (const dot of dots) {
    assert.ok(dot.className.includes('typing-dot'));
  }
});

test('WEBCHAT_TYPING_INDICATOR: prevents stuck or duplicate typing state', () => {
  const container = createMockElement('div', 'chat-messages');

  const ind1 = SamcheChatUX.createTypingIndicator();
  container.appendChild(ind1);
  assert.equal(container.children.length, 1);

  SamcheChatUX.clearTypingIndicator(container);
  assert.equal(container.children.length, 0);

  const a = SamcheChatUX.createTypingIndicator();
  const b = SamcheChatUX.createTypingIndicator();
  container.appendChild(a);
  container.appendChild(b);
  assert.equal(container.querySelectorAll('.msg-typing-indicator').length, 2);

  SamcheChatUX.clearTypingIndicator(container);
  assert.equal(container.querySelectorAll('.msg-typing-indicator').length, 0);
});

test('WEBCHAT_TYPING_INDICATOR: clears cleanly on both success and error simulation', async () => {
  const container = createMockElement('div', 'chat-messages');

  container.appendChild(SamcheChatUX.createTypingIndicator());
  assert.equal(container.querySelectorAll('.msg-typing-indicator').length, 1);
  await Promise.resolve({ ok: true });
  SamcheChatUX.clearTypingIndicator(container);
  assert.equal(container.querySelectorAll('.msg-typing-indicator').length, 0);

  container.appendChild(SamcheChatUX.createTypingIndicator());
  assert.equal(container.querySelectorAll('.msg-typing-indicator').length, 1);
  try {
    throw new Error('500 Internal Server Error');
  } catch (err) {
    SamcheChatUX.clearTypingIndicator(container);
  }
  assert.equal(container.querySelectorAll('.msg-typing-indicator').length, 0);
});

// ---------------------------------------------------------------------------
// 2. WEBCHAT_NATURAL_MESSAGE_FLOW
// ---------------------------------------------------------------------------
test('WEBCHAT_NATURAL_MESSAGE_FLOW: pacing constants share comfortable human-readable rhythm with AI Guide', () => {
  assert.equal(SamcheChatUX.PRESENTATION_TIMING.chunk_words, GUIDE_PRESENTATION_TIMING.chunk_words);
  assert.ok(SamcheChatUX.PRESENTATION_TIMING.base_delay_ms >= 30 && SamcheChatUX.PRESENTATION_TIMING.base_delay_ms <= 60);
  assert.ok(SamcheChatUX.PRESENTATION_TIMING.sentence_pause_ms >= 150 && SamcheChatUX.PRESENTATION_TIMING.sentence_pause_ms <= 300);
});

test('WEBCHAT_NATURAL_MESSAGE_FLOW: progressive reveal renders complete text without losing tokens', async () => {
  const node = createMockElement('div');
  const fullMessage = 'SamChe Titan Akıllı Saat Pro, IP68 su geçirmezlik ve 14 güne varan pil ömrü sunar. Kablosuz şarj desteği yoktur.';

  await SamcheChatUX.progressiveReveal(node, fullMessage);
  assert.equal(node.textContent, fullMessage);
});

test('WEBCHAT_NATURAL_MESSAGE_FLOW: reduced-motion preference bypasses delays immediately', () => {
  const normalDelay = SamcheChatUX.responseDelay(200);
  assert.equal(normalDelay, 200);

  const originalWindow = globalThis.window;
  globalThis.window = {
    matchMedia: (query) => ({
      matches: query.includes('prefers-reduced-motion: reduce'),
    }),
  };

  const reducedDelay = SamcheChatUX.responseDelay(200);
  assert.equal(reducedDelay, 0);

  globalThis.window = originalWindow;
});

test('WEBCHAT_NATURAL_MESSAGE_FLOW: abort signal stops revelation gracefully', async () => {
  const node = createMockElement('div');
  const controller = new AbortController();
  controller.abort();

  await SamcheChatUX.progressiveReveal(node, 'This text should not be revealed because signal is aborted.', {
    signal: controller.signal,
  });

  assert.equal(node.textContent, '');
});

// ---------------------------------------------------------------------------
// 3. WEBCHAT_AUTOSCROLL
// ---------------------------------------------------------------------------
test('WEBCHAT_AUTOSCROLL: detects whether visitor is near bottom or scrolled upward', () => {
  const container = createMockElement('div');
  container.scrollHeight = 1000;
  container.clientHeight = 400;

  container.scrollTop = 600;
  assert.equal(SamcheChatUX.isNearBottom(container), true);

  container.scrollTop = 560;
  assert.equal(SamcheChatUX.isNearBottom(container), true);

  container.scrollTop = 200;
  assert.equal(SamcheChatUX.isNearBottom(container), false);
});

test('WEBCHAT_AUTOSCROLL: does not force-scroll when visitor intentionally scrolls upward', () => {
  const container = createMockElement('div');
  container.scrollHeight = 1000;
  container.clientHeight = 400;
  container.scrollTop = 200;

  SamcheChatUX.smartScrollToBottom(container, false);
  assert.equal(container.scrollTop, 200);

  SamcheChatUX.smartScrollToBottom(container, true);
  assert.equal(container.scrollTop, 1000);
});

// ---------------------------------------------------------------------------
// 4. WEBCHAT_MOBILE_CONVERSATION_UX
// ---------------------------------------------------------------------------
test('WEBCHAT_MOBILE_CONVERSATION_UX: responsive viewport and RTL styles are preserved in demo storefront', () => {
  const demoHtmlPath = path.resolve(__dirname, '../public/task8-demo/index.html');
  const demoHtml = fs.readFileSync(demoHtmlPath, 'utf8');

  assert.ok(demoHtml.includes('@media (max-width: 640px)'), 'Mobile media query must be defined');
  assert.ok(demoHtml.includes('calc(100vw - 32px)'), 'Mobile widget must adapt to viewport width');
  assert.ok(demoHtml.includes('[dir="rtl"]'), 'RTL selector must be present');
  assert.ok(demoHtml.includes('direction: rtl;'), 'RTL direction must be declared');
  assert.ok(demoHtml.includes('.chat-input-area'), 'RTL input area flex reversal must be declared');
});

// ---------------------------------------------------------------------------
// 5. GUIDE_UX_REGRESSION
// ---------------------------------------------------------------------------
test('GUIDE_UX_REGRESSION: AI Guide timing constants remain intact and unmutated', () => {
  assert.equal(GUIDE_PRESENTATION_TIMING.chunk_words, 2);
  assert.equal(GUIDE_PRESENTATION_TIMING.base_delay_ms, 48);
  assert.equal(GUIDE_PRESENTATION_TIMING.sentence_pause_ms, 220);
  assert.equal(GUIDE_PRESENTATION_TIMING.section_pause_ms, 280);
});
