import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { buildGuideSessionContextSummary, calculateGuideToolResult, guideSessionStatePatch, loadGuideSessionContext, normalizeGuideSessionContext, saveGuideSessionContext } from '../services/guide-session-context-service.js';
import { normalizeGuideExperience } from '../services/guide-experience-service.js';

const experience = normalizeGuideExperience({
  roadmap: { enabled: true, steps: [
    { id: 'event_type', label: 'Event type', input_type: 'SELECT', options: [{ value: 'corporate', label: 'Corporate event' }] },
    { id: 'attendees', label: 'Guests', input_type: 'NUMBER', min: 1, max: 1000 },
  ] },
  interactive_tool: { enabled: true, currency: 'AED', pricing_mode: 'APPROVED_PRICING', approved_pricing_source: 'Approved tenant rate card', fields: [
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

test('quotation-required tools retain validated scope without inventing a zero-value estimate', () => {
  const quoteExperience = normalizeGuideExperience({
    interactive_tool: {
      enabled: true,
      currency: 'AED',
      pricing_mode: 'QUOTE_REQUIRED',
      result_label: 'Event planning scope',
      fields: [{ id: 'guests', label: 'Guests', input_type: 'NUMBER', min: 1, max: 1000 }],
      calculation: { base_amount: 0, terms: [{ field_id: 'guests', kind: 'NUMBER_MULTIPLIER', multiplier: 0 }] },
    },
  });
  const context = normalizeGuideSessionContext({ experience: quoteExperience, context: { tool: { guests: 200 } } });
  assert.equal(context.tool_result.pricing_mode, 'QUOTE_REQUIRED');
  assert.equal(context.tool_result.amount, null);
  assert.match(buildGuideSessionContextSummary({ experience: quoteExperience, context }), /commercial pricing requires review/i);
  assert.doesNotMatch(buildGuideSessionContextSummary({ experience: quoteExperience, context }), /0 AED/);
});

test('context normalization never treats process memory as durable Guide storage', () => {
  const scope = { tenant_id: 'tenant-a', assistant_id: 'assistant-a', channel_id: 'channel-a' };
  const normalized = saveGuideSessionContext({ scope, sessionId: 'session-1', experience: { ...experience, version: 4 }, context: { roadmap: { attendees: 20 } }, now: 1 });
  assert.equal(normalized.roadmap.attendees, 20);
  assert.equal(loadGuideSessionContext({ scope, sessionId: 'session-1', experience: { ...experience, version: 4 }, now: 2 }), null);
});
test('buildGuideSessionContextSummary safely handles Roadmap state containing messages array without throwing', () => {
  const summary = buildGuideSessionContextSummary({
    experience,
    context: {
      roadmap: {
        messages: [{ role: 'user', content: 'What is the schedule?' }],
        event_type: 'corporate',
        attendees: 150,
      },
      tool: {
        attendees: 150,
      },
    },
  });
  assert.match(summary, /Event type: Corporate event/);
  assert.match(summary, /Guests: 150/);
  assert.doesNotMatch(summary, /messages/i);
  assert.doesNotMatch(summary, /What is the schedule/i);
});

test('buildGuideSessionContextSummary safely ignores unknown Roadmap and Tool keys and handles missing tool context', () => {
  const summaryWithoutTool = buildGuideSessionContextSummary({
    experience,
    context: {
      roadmap: {
        event_type: 'corporate',
        unknown_roadmap_field: 'arbitrary_value',
        messages: [{ role: 'assistant', content: 'Hello' }],
      },
    },
  });
  assert.match(summaryWithoutTool, /Event type: Corporate event/);
  assert.doesNotMatch(summaryWithoutTool, /unknown_roadmap_field/);
  assert.doesNotMatch(summaryWithoutTool, /Interactive tool inputs/);

  const summaryWithUnknownToolKeys = buildGuideSessionContextSummary({
    experience,
    context: {
      roadmap: { event_type: 'corporate' },
      tool: { venue: 'hotel', unknown_planning_prop: 'val', metadata: { foo: 'bar' } },
    },
  });
  assert.match(summaryWithUnknownToolKeys, /Venue: Hotel/);
  assert.doesNotMatch(summaryWithUnknownToolKeys, /unknown_planning_prop/);
  assert.doesNotMatch(summaryWithUnknownToolKeys, /metadata/);
});

test('buildGuideSessionContextSummary correctly summarizes planning structured values under tool key', () => {
  const toolResult = calculateGuideToolResult({
    tool: experience.interactive_tool,
    values: { attendees: 100, venue: 'hotel' },
  });
  const summary = buildGuideSessionContextSummary({
    experience,
    context: {
      tool: { attendees: 100, venue: 'hotel' },
      tool_result: toolResult,
    },
  });
  assert.match(summary, /Interactive tool inputs.*Guests: 100.*Venue: Hotel/);
  assert.match(summary, /3,100 AED/);
});

test('canonical handoff patch preserves the Roadmap thread while exposing validated Roadmap and Planning facts', () => {
  const patch = guideSessionStatePatch({
    active_module: 'ASSISTANT',
    roadmap: { event_type: 'corporate' },
    tool: { attendees: 120 },
    tool_result: { pricing_mode: 'QUOTE_REQUIRED', amount: null },
  }, {
    roadmapState: { generatedAnalysis: 'Confirm venue and schedule.', messages: [{ role: 'assistant', content: 'Roadmap response' }] },
    planningState: { venue: 'hotel' },
    sharedContext: { existing: 'preserved' },
  });
  assert.equal(patch.active_module, 'AI_ASSISTANT');
  assert.deepEqual(patch.roadmapState.structuredInputs, { event_type: 'corporate' });
  assert.equal(patch.roadmapState.generatedAnalysis, 'Confirm venue and schedule.');
  assert.deepEqual(patch.roadmapState.messages, [{ role: 'assistant', content: 'Roadmap response' }]);
  assert.deepEqual(patch.planningState, { venue: 'hotel', attendees: 120 });
  assert.deepEqual(patch.sharedContext, { existing: 'preserved', roadmap: { event_type: 'corporate' }, planning: { attendees: 120 } });
});

test('canonical handoff patch initializes the Roadmap thread for a newly persisted session', () => {
  const patch = guideSessionStatePatch({
    active_module: 'ROADMAP',
    roadmap: { event_type: 'corporate' },
    tool: {},
    tool_result: { pricing_mode: 'QUOTE_REQUIRED', amount: null },
  });
  assert.deepEqual(patch.roadmapState.messages, []);
  assert.deepEqual(patch.roadmapState.structuredInputs, { event_type: 'corporate' });
});

test('Assistant context summary includes the persisted Roadmap result without copying the Roadmap thread', () => {
  const summary = buildGuideSessionContextSummary({
    experience,
    context: {
      roadmap: { event_type: 'corporate' },
      roadmap_goal: 'Plan a corporate event',
      roadmap_result: '## Recommended plan\n- Confirm the venue\n- Align attendees',
    },
  });
  assert.match(summary, /Event type: Corporate event/);
  assert.match(summary, /Plan a corporate event/);
  assert.match(summary, /Recommended plan/);
  assert.doesNotMatch(summary, /Roadmap thread|role:|assistantConversation/i);
});

test('app.js extracts canonical structured context and isolates conversation messages from field map', () => {
  const appSource = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  const chatRoute = appSource.slice(appSource.indexOf('app.post("/chat"'));

  // Proves messages are extracted/excluded from structured roadmap values
  assert.match(chatRoute, /const\s*\{\s*messages:\s*_roadmapMessages,\s*structuredInputs,\s*generatedAnalysis,\s*initialGoal,\s*\.\.\.structuredRoadmapValues\s*\}\s*=/);
  assert.match(chatRoute, /appendGuideModuleMessage\(guideSessionState, guideConversation\.module, userMessage\)/);
  assert.doesNotMatch(chatRoute, /roadmapState\.messages\.push\(userMessage\)/);
  // Proves canonical roadmap and tool keys are passed into buildGuideSessionContextSummary
  assert.match(chatRoute, /buildGuideSessionContextSummary\(\{[\s\S]*roadmap:\s*canonicalRoadmapValues,[\s\S]*roadmap_result:\s*typeof generatedAnalysis === 'string' \? generatedAnalysis : '',[\s\S]*tool:\s*structuredPlanningValues,/);
  // Proves safe error logging diagnostic with code, message, and location
  assert.match(chatRoute, /console\.error\(`Samcheguide Chat error: name=\$\{safeName\}/);
  // Proves no tenant or customer specific names are hardcoded
  assert.doesNotMatch(chatRoute, /blue dune|bluedune/i);
});
