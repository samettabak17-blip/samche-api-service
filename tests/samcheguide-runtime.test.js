import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SAMCHEGUIDE_RUNTIME,
  isCompatibleSamcheguideRuntimeAssistant,
} from '../services/samcheguide-runtime.js';

test('Samcheguide runtime is represented by its actual Gemini model', () => {
  assert.equal(SAMCHEGUIDE_RUNTIME.provider, 'GEMINI');
  assert.equal(SAMCHEGUIDE_RUNTIME.model, 'gemini-3-flash-preview');
  assert.equal(SAMCHEGUIDE_RUNTIME.name, 'Samcheguide Runtime');
});

test('only an active assistant with the actual Gemini model is compatible', () => {
  assert.equal(isCompatibleSamcheguideRuntimeAssistant({ status: 'active', model: 'gemini-3-flash-preview' }), true);
  assert.equal(isCompatibleSamcheguideRuntimeAssistant({ status: 'active', model: 'gpt-4o-mini' }), false);
  assert.equal(isCompatibleSamcheguideRuntimeAssistant({ status: 'inactive', model: 'gemini-3-flash-preview' }), false);
});
