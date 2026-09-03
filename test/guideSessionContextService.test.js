import assert from 'node:assert/strict';
import test from 'node:test';
import { buildGuideSessionContextSummary, loadGuideSessionContext, normalizeGuideSessionContext, saveGuideSessionContext } from '../services/guide-session-context-service.js';
import { normalizeGuideExperience } from '../services/guide-experience-service.js';

const experience = normalizeGuideExperience({
  roadmap: { enabled: true, steps: [
    { id: 'event_type', label: 'Event type', input_type: 'SELECT', options: [{ value: 'corporate', label: 'Corporate event' }] },
    { id: 'attendees', label: 'Guests', input_type: 'NUMBER', min: 1, max: 1000 },
  ] },
  interactive_tool: { enabled: true, currency: 'AED', fields: [
    { id: 'attendees', label: 'Guests', input_type: 'NUMBER', min: 1, max: 1000 },
    { id: 'venue', label: 'Venue', input_type: 'SELECT', options: [{ value: 'hotel', label: 'Hotel' }] },
  ], calculation: { base_amount: 100, terms: [
    { field_id: 'attendees', kind: 'NUMBER_MULTIPLIER', multiplier: 25 },
    { field_id: 'venue', kind: 'SELECT_AMOUNT', amounts: { hotel: 500 } },
  ] } },
});

test('accepts only values defined by the published roadmap and calculator configuration', () => {
  const context = normalizeGuideSessionContext({ experience, context: {
    active_module: 'TOOL',
    roadmap: { event_type: 'corporate', attendees: 200 },
    tool: { attendees: 200, venue: 'hotel' },
  } });
  assert.equal(context.roadmap.event_type, 'corporate');
  assert.equal(context.tool_result.amount, 5600);
  assert.match(buildGuideSessionContextSummary({ experience, context }), /Corporate event/);
  assert.match(buildGuideSessionContextSummary({ experience, context }), /5,600 AED/);
});

test('rejects tenant-spoofed fields, invalid option values, and unbounded text from Guide session context', () => {
  for (const invalid of [
    { tenant_id: 'other', roadmap: { unowned_field: 'x' } },
    { roadmap: { event_type: 'wrong-option' } },
    { tool: { attendees: 999999 } },
  ]) {
    assert.throws(() => normalizeGuideSessionContext({ experience, context: invalid }), { code: 'GUIDE_SESSION_CONTEXT_INVALID' });
  }
});

test('partitions stored Guide context by tenant, assistant, channel, session, and Experience version', () => {
  const scope = { tenant_id: 'tenant-a', assistant_id: 'assistant-a', channel_id: 'channel-a' };
  saveGuideSessionContext({ scope, sessionId: 'session-1', experience: { ...experience, version: 4 }, context: { roadmap: { attendees: 20 } }, now: 1 });
  assert.equal(loadGuideSessionContext({ scope, sessionId: 'session-1', experience: { ...experience, version: 4 }, now: 2 }).roadmap.attendees, 20);
  assert.equal(loadGuideSessionContext({ scope: { ...scope, tenant_id: 'tenant-b' }, sessionId: 'session-1', experience: { ...experience, version: 4 }, now: 2 }), null);
  assert.equal(loadGuideSessionContext({ scope, sessionId: 'session-1', experience: { ...experience, version: 5 }, now: 2 }), null);
});
