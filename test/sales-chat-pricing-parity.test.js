import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { salesChatCommercialFacts } from '../config/sales-chat-commercial.js';

const websiteData = await import(pathToFileURL('C:/Users/smttb/Documents/Codex/2026-09-15/referenced-chatgpt-conversation-this-is-an-11/lib/site-data.mjs').href);

test('Sales Chat server plan facts match the approved website pricing exactly', () => {
  const normalize = (plan) => ({ slug: plan.slug, name: plan.name, monthly: plan.monthly, setup: plan.setup, yearly: plan.yearly, interactions: plan.interactions, from: Boolean(plan.from), features: plan.features });
  assert.deepEqual(salesChatCommercialFacts.plans.map(normalize), websiteData.plans.map(normalize));
});

test('Sales Chat server product facts match the approved website modules exactly', () => {
  const expected = [
    { name: 'Web Chatbot', status: 'Available' },
    { name: 'WhatsApp AI', status: 'Available' },
    ...websiteData.productModules.map(({ name, status }) => ({ name, status })),
  ];
  assert.deepEqual(salesChatCommercialFacts.products, expected);
});
