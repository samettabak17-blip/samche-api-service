import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCustomerHumanSupportRequest } from '../services/human-support-intent.js';

test('bare customer support request has no meaningful topic and needs no topic-summary model call', () => {
  assert.deepEqual(parseCustomerHumanSupportRequest('canlı destek'), {
    requested: true,
    hasMeaningfulContext: false,
  });
});

test('customer support request with topic permits exactly one legacy topic-summary call', () => {
  assert.deepEqual(parseCustomerHumanSupportRequest('Dubai şirket kurulumu fiyatı için canlı destek istiyorum'), {
    requested: true,
    hasMeaningfulContext: true,
  });
});

test('business topic without an explicit support request stays on the normal AI route', () => {
  assert.deepEqual(parseCustomerHumanSupportRequest('Dubai şirket kurulumu fiyatı nedir?'), {
    requested: false,
    hasMeaningfulContext: false,
  });
});
