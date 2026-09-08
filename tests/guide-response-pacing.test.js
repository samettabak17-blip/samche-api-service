import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalGuideResponseEvents, canonicalGuideResponseText } from '../services/guide-conversation-service.js';
import { playGuideResponseEvents, progressiveText, PRESENTATION_TIMING, responseDelay } from '../public-guide/guide.js';

// Minimal DOM mock for Node test environment
function createMockNode(tagName = 'div', className = '') {
  const children = [];
  return {
    tagName: tagName.toUpperCase(),
    className,
    textContent: '',
    children,
    isConnected: true,
    append(...nodes) {
      for (const node of nodes) {
        if (typeof node === 'string') {
          this.textContent += node;
        } else {
          children.push(node);
        }
      }
    },
    replaceChildren(...nodes) {
      children.length = 0;
      this.textContent = '';
      this.append(...nodes);
    },
    addEventListener() {},
    setAttribute() {},
    scrollIntoView() {},
  };
}

// Global browser mock setup
if (typeof globalThis.document === 'undefined') {
  globalThis.document = {
    createElement(tag) { return createMockNode(tag); },
    documentElement: { lang: 'en' },
    querySelector() { return null; },
  };
}
if (typeof globalThis.window === 'undefined') {
  globalThis.window = {
    matchMedia: () => ({ matches: false }),
    setTimeout: (fn) => { fn(); return 1; },
    clearTimeout: () => {},
  };
}

test('Workstream B - Timing: pacing constants provide comfortable, human-readable rhythm', () => {
  assert.equal(PRESENTATION_TIMING.chunk_words, 2);
  assert.ok(PRESENTATION_TIMING.base_delay_ms >= 40 && PRESENTATION_TIMING.base_delay_ms <= 60);
  assert.ok(PRESENTATION_TIMING.sentence_pause_ms >= 200 && PRESENTATION_TIMING.sentence_pause_ms <= 300);
  assert.ok(PRESENTATION_TIMING.section_pause_ms >= 250);
  assert.ok(PRESENTATION_TIMING.list_item_pause_ms >= 100);
});

test('Workstream B - Contract: Short answer progressive reveal renders complete text identically', async () => {
  const node = createMockNode('p');
  const content = 'This is a clear, concise answer.';
  await progressiveText(node, content);
  assert.equal(node.textContent, content);
});

test('Workstream B - Contract: Long answer progressive reveal renders complete text without losing words', async () => {
  const node = createMockNode('p');
  const sentences = [
    'We offer complete architectural landscape planning and irrigation engineering.',
    'Our team prepares detailed layout drawings, hydraulic load calculations, and automated zone scheduling.',
    'Every installation undergoes pressure testing and coverage alignment before handoff.',
  ];
  const content = sentences.join(' ');
  await progressiveText(node, content);
  assert.equal(node.textContent, content);
});

test('Workstream B - Contract: Numbered list and bullet list handling', async () => {
  const board = createMockNode('div');
  const numberedSource = '## Recommended steps\n1. Initial site survey\n2. Soil test and zone mapping\n3. System installation';
  const events = canonicalGuideResponseEvents(numberedSource);
  
  const listEvent = events.find((e) => e.type === 'LIST');
  assert.ok(listEvent);
  assert.equal(listEvent.ordered, true);
  assert.deepEqual(listEvent.items, ['Initial site survey', 'Soil test and zone mapping', 'System installation']);

  await playGuideResponseEvents(board, events);
  assert.equal(board.children.length, 2);
  assert.equal(board.children[0].tagName, 'H3');
  assert.equal(board.children[0].textContent, 'Recommended steps');
  assert.equal(board.children[1].tagName, 'OL');
  assert.equal(board.children[1].children.length, 3);
  assert.equal(board.children[1].children[0].textContent, 'Initial site survey');
  assert.equal(board.children[1].children[1].textContent, 'Soil test and zone mapping');
  assert.equal(board.children[1].children[2].textContent, 'System installation');
});

test('Workstream B - Contract: Unordered bullet list uses UL element', async () => {
  const board = createMockNode('div');
  const bulletSource = '- Native drought-tolerant flora\n- Drip emitters for trees';
  const events = canonicalGuideResponseEvents(bulletSource);
  const listEvent = events.find((e) => e.type === 'LIST');
  assert.ok(listEvent);
  assert.equal(listEvent.ordered, undefined);

  await playGuideResponseEvents(board, events);
  assert.equal(board.children[0].tagName, 'UL');
  assert.equal(board.children[0].children[0].textContent, 'Native drought-tolerant flora');
  assert.equal(board.children[0].children[1].textContent, 'Drip emitters for trees');
});

test('Workstream B - Contract: Markdown answer preserves sections, paragraphs, and list integrity', async () => {
  const board = createMockNode('div');
  const markdownSource = '## Garden Consultation\n\nWe provide professional guidance.\n\n- Site survey\n- Water balance analysis';
  const events = canonicalGuideResponseEvents(markdownSource);
  await playGuideResponseEvents(board, events);

  assert.equal(board.children.length, 3);
  assert.equal(board.children[0].tagName, 'H3');
  assert.equal(board.children[0].textContent, 'Garden Consultation');
  assert.equal(board.children[1].tagName, 'P');
  assert.equal(board.children[1].textContent, 'We provide professional guidance.');
  assert.equal(board.children[2].tagName, 'UL');
});

test('Workstream B - Contract: One large provider chunk progressive reveal preserves full text', async () => {
  const node = createMockNode('p');
  const largeChunk = 'Word '.repeat(120).trim();
  await progressiveText(node, largeChunk);
  assert.equal(node.textContent, largeChunk);
});

test('Workstream B - Contract: Rapid provider chunks handled cleanly without duplication or reordering', async () => {
  const board = createMockNode('div');
  const chunks = [
    { type: 'TEXT_DELTA', text: 'First part of the guidance.' },
    { type: 'TEXT_DELTA', text: 'Second part with more details.' },
    { type: 'TEXT_DELTA', text: 'Final concluding recommendations.' },
  ];
  await playGuideResponseEvents(board, chunks);
  assert.equal(board.children.length, 3);
  assert.equal(board.children[0].textContent, 'First part of the guidance.');
  assert.equal(board.children[1].textContent, 'Second part with more details.');
  assert.equal(board.children[2].textContent, 'Final concluding recommendations.');
});

test('Workstream B - Contract: Stream completion signals are safely ignored without DOM pollution', async () => {
  const board = createMockNode('div');
  const events = [
    { type: 'MESSAGE_START' },
    { type: 'THINKING' },
    { type: 'TEXT_DELTA', text: 'Hello.' },
    { type: 'MESSAGE_COMPLETE' },
  ];
  await playGuideResponseEvents(board, events);
  assert.equal(board.children.length, 1);
  assert.equal(board.children[0].textContent, 'Hello.');
});

test('Workstream B - Contract: Navigation or unmount during reveal aborts gracefully without error', async () => {
  const unmountedBoard = createMockNode('div');
  unmountedBoard.isConnected = false;
  
  await playGuideResponseEvents(unmountedBoard, [
    { type: 'TEXT_DELTA', text: 'Should not appear on unmounted board.' },
  ]);
  assert.equal(unmountedBoard.children.length, 0);

  const detachedNode = createMockNode('p');
  detachedNode.isConnected = false;
  await progressiveText(detachedNode, 'Detached content');
  assert.equal(detachedNode.textContent, '');
});

test('Workstream B - Contract: AbortSignal stops streaming immediately', async () => {
  const board = createMockNode('div');
  const controller = new AbortController();
  controller.abort();
  await playGuideResponseEvents(board, [
    { type: 'TEXT_DELTA', text: 'Aborted message' },
  ], { signal: controller.signal });
  assert.equal(board.children.length, 0);
});

test('Workstream B - Contract: Reduced-motion accessibility preference bypasses delay', () => {
  const origMatchMedia = globalThis.window.matchMedia;
  try {
    globalThis.window.matchMedia = (query) => ({
      matches: query.includes('prefers-reduced-motion: reduce'),
    });
    assert.equal(responseDelay(500), 0);
  } finally {
    globalThis.window.matchMedia = origMatchMedia;
  }
});

test('Workstream B - Contract: Persisted message equality - pacing does NOT mutate stored message content', () => {
  const originalResponse = '## Summary\n\nComprehensive planning advice.\n\n1. Survey\n2. Design';
  const canonicalText = canonicalGuideResponseText(originalResponse);
  
  assert.match(canonicalText, /Summary/);
  assert.match(canonicalText, /Comprehensive planning advice/);
  assert.match(canonicalText, /- Survey/);
  assert.match(canonicalText, /- Design/);
});
