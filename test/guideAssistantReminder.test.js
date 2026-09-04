import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const jsSource = fs.readFileSync(new URL('../public-guide/guide.js', import.meta.url), 'utf8');
const cssSource = fs.readFileSync(new URL('../public-guide/guide.css', import.meta.url), 'utf8');

test('1. New Guide session with Roadmap active and no Assistant conversation displays "Ask the Assistant"', () => {
  assert.match(jsSource, /hasAssistantConversationStarted\(\)/);
  assert.match(jsSource, /'Ask the Assistant'/);
  assert.match(jsSource, /reminderText = hasAssistantConversationStarted\(\)\s*\?\s*'Continue your Assistant conversation'\s*:\s*'Ask the Assistant'/);
});

test('2. Bubble timing lifecycle uses 5 second show/hide intervals', () => {
  assert.match(jsSource, /scheduleAssistantReminderCycle\('hide'\)/);
  assert.match(jsSource, /scheduleAssistantReminderCycle\('show'\)/);
  assert.match(jsSource, /5000/);
});

test('3. Switching between Roadmap and Planning shares single timer lifecycle without duplicates', () => {
  assert.match(jsSource, /clearAssistantReminderTimer\(\)/);
  assert.match(jsSource, /let assistantReminderTimeout = null/);
  assert.match(jsSource, /let assistantReminderCycle = 'idle'/);
  assert.match(jsSource, /syncAssistantReminder\(\)/);
});

test('4. Opening Assistant immediately hides the reminder bubble and stops outside cycle', () => {
  assert.match(jsSource, /guideState\?\.active_module === MODULES\.AI_ASSISTANT/);
  assert.match(jsSource, /removeAssistantReminderBubble\(\)/);
  assert.match(jsSource, /clearAssistantReminderTimer\(\)/);
});

test('5. Leaving Assistant without starting a conversation allows "Ask the Assistant" reminder to resume', () => {
  assert.match(jsSource, /hasAssistantConversationStarted\(\)/);
  assert.match(jsSource, /messages\.some\(\(message\) => message\.kind === 'user' && text\(message\.value\)\.trim\(\)\.length > 0\)/);
});

test('6. Genuine Assistant conversation triggers "Continue your Assistant conversation" on Roadmap/Planning', () => {
  assert.match(jsSource, /'Continue your Assistant conversation'/);
  assert.match(jsSource, /hasAssistantConversationStarted/);
});

test('7. Switch to Planning retains continuation message when Assistant conversation has started', () => {
  assert.match(jsSource, /syncAssistantReminder/);
  assert.match(jsSource, /textNode\.textContent = reminderText/);
});

test('8. Clicking reminder bubble navigates directly to Assistant without state reset or page reload', () => {
  assert.match(jsSource, /actionButton\.addEventListener\('click'/);
  assert.match(jsSource, /guideState\.active_module = MODULES\.AI_ASSISTANT/);
  assert.match(jsSource, /persistState\(\)/);
  assert.match(jsSource, /renderActiveModule\(\)/);
});

test('9. Clicking close (×) dismisses reminder, stops timer, and persists dismissal in sessionStorage', () => {
  assert.match(jsSource, /dismissAssistantReminder\(\)/);
  assert.match(jsSource, /closeButton\.addEventListener\('click'/);
  assert.match(jsSource, /window\.sessionStorage\?\.setItem\(reminderDismissalStorageKey\(\), 'true'\)/);
  assert.match(jsSource, /samcheguide-reminder-dismissed:/);
});

test('10. Navigating Roadmap <-> Planning after dismissal does not bring back the reminder', () => {
  assert.match(jsSource, /if \(isAssistantReminderDismissed\(\)/);
  assert.match(jsSource, /isAssistantReminderDismissed\(\)/);
});

test('11. Refresh during same session preserves dismissal via sessionStorage check', () => {
  assert.match(jsSource, /reminderDismissalStorageKey/);
  assert.match(jsSource, /window\.sessionStorage\?\.getItem\(reminderDismissalStorageKey\(\)\) === 'true'/);
});

test('12. Refresh with existing Assistant conversation and without dismissal restores continuation text', () => {
  assert.match(jsSource, /messages = history\.messages/);
  assert.match(jsSource, /syncAssistantReminder\(\)/);
});

test('13. Roadmap state remains unchanged when interacting with Assistant reminder', () => {
  assert.match(jsSource, /roadmap_category/);
  assert.match(jsSource, /roadmap_goal/);
  assert.match(jsSource, /roadmap_result/);
  assert.match(jsSource, /roadmap_messages/);
});

test('14. Planning state remains unchanged', () => {
  assert.match(jsSource, /guideState\.tool/);
});

test('15. Assistant visible thread remains separate from Roadmap visible thread', () => {
  assert.match(jsSource, /preservedAssistantChat/);
  assert.match(jsSource, /guide-roadmap-result/);
});

test('16. Accessible attributes and semantic buttons used for reminder controls', () => {
  assert.match(jsSource, /aria-label', 'Dismiss Assistant reminder'/);
  assert.match(jsSource, /role', 'status'/);
});

test('17. Visual styles for tooltip bubble, pointer tail, and responsive layout are defined', () => {
  assert.match(cssSource, /\.guide-assistant-reminder\{/);
  assert.match(cssSource, /\.guide-assistant-reminder::after\{/);
  assert.match(cssSource, /\.guide-assistant-reminder__button/);
  assert.match(cssSource, /\.guide-assistant-reminder__close/);
  assert.match(cssSource, /position:absolute/);
  assert.match(cssSource, /bottom:calc\(100%/);
  assert.match(cssSource, /transform:translateX\(-50%\)/);
});
