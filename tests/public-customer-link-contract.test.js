import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const appSource = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const webChatSource = fs.readFileSync(new URL('../public/web-chat.js', import.meta.url), 'utf8');

test('customer-facing Guide and Web Chat runtime sources contain no dead chatbot hostname', () => {
  const customerRuntime = `${appSource}\n${webChatSource}`;
  assert.doesNotMatch(customerRuntime, /https?:\/\/aichatbot\.samchecompany\.com\/?/i);
});

test('chatbot demo actions use the independently verified live demo destination', () => {
  const verifiedDestination = 'https://ai.samchecompany.com/#live-demo';
  const occurrences = appSource.split(verifiedDestination).length - 1;
  assert.equal(occurrences, 2);
});
