import assert from 'node:assert/strict';
import test from 'node:test';
import { buildGuideExperienceRecommendation, classifyGuideSector, generateGuideExperienceRecommendation } from '../services/guide-experience-recommendation-service.js';
import { GuideExperienceError, normalizeGuideExperience } from '../services/guide-experience-service.js';
import { deriveAccessibleGuideTheme } from '../services/guide-theme-service.js';
import { normalizeGuideSessionContext } from '../services/guide-session-context-service.js';

test('generates a sector-aware event Guide only from approved tenant intelligence', () => {
  const result = buildGuideExperienceRecommendation({ activeProfile: { company_identity: 'Example Events', services: ['corporate event planning', 'venue and catering'] }, activeConfiguration: { assistant_identity: 'Example Event Assistant' }, assistantName: 'Fallback' });
  assert.equal(result.recommendation.classification.sector, 'EVENT_MANAGEMENT');
  assert.equal(result.experience.roadmap.title, 'Event Planning Roadmap');
  assert.equal(result.experience.interactive_tool.title, 'Event Budget Estimator');
  assert.equal(result.experience.assistant_display_name, 'Example Event Assistant');
  assert.ok(result.experience.roadmap.steps.some((step) => step.id === 'guest_count'));
  assert.ok(result.experience.interactive_tool.fields.some((item) => item.id === 'production'));
});

test('different approved sectors receive materially different declarative Guide recommendations', () => {
  assert.equal(classifyGuideSector({ profile: { offering: 'mortgage and off-plan property investment' } }), 'REAL_ESTATE');
  const property = buildGuideExperienceRecommendation({ activeProfile: { offering: 'mortgage and off-plan property investment' }, activeConfiguration: { assistant_identity: 'Advisor' } });
  const events = buildGuideExperienceRecommendation({ activeProfile: { offering: 'conference and event production' }, activeConfiguration: { assistant_identity: 'Advisor' } });
  assert.notEqual(property.experience.roadmap.title, events.experience.roadmap.title);
  assert.notEqual(property.experience.interactive_tool.title, events.experience.interactive_tool.title);
});

test('event and professional recommendations choose non-commerce layouts while ecommerce remains commerce', () => {
  const event = buildGuideExperienceRecommendation({ activeProfile: { offering: 'conference and event production' }, activeConfiguration: { assistant_identity: 'Advisor' }, currentExperience: { layout: { preset: 'COMMERCE' } } });
  const commerce = buildGuideExperienceRecommendation({ activeProfile: { offering: 'ecommerce shopping catalog' }, activeConfiguration: { assistant_identity: 'Advisor' } });
  assert.notEqual(event.experience.layout.preset, 'COMMERCE');
  assert.equal(commerce.experience.layout.preset, 'COMMERCE');
});

test('event recommendation without approved pricing is quotation-required rather than a zero currency estimate', () => {
  const experience = buildGuideExperienceRecommendation({ activeProfile: { offering: 'event management and catering' }, activeConfiguration: { assistant_identity: 'Advisor' } }).experience;
  assert.equal(experience.interactive_tool.pricing_mode, 'QUOTE_REQUIRED');
  assert.equal(experience.interactive_tool.approved_pricing_source, '');
});

test('approved deterministic pricing requires an explicit tenant-approved pricing source', () => {
  assert.throws(() => normalizeGuideExperience({ interactive_tool: { pricing_mode: 'APPROVED_PRICING', fields: [{ id: 'guests', label: 'Guests', input_type: 'NUMBER' }], calculation: { base_amount: 0, terms: [] } } }), GuideExperienceError);
  const approved = normalizeGuideExperience({ interactive_tool: { pricing_mode: 'APPROVED_PRICING', approved_pricing_source: 'Approved rate card', fields: [{ id: 'guests', label: 'Guests', input_type: 'NUMBER' }], calculation: { base_amount: 0, terms: [] } } });
  assert.equal(approved.interactive_tool.pricing_mode, 'APPROVED_PRICING');
});

test('legacy valid non-zero deterministic pricing remains renderable without mutating its stored version', () => {
  const legacy = normalizeGuideExperience({ interactive_tool: { fields: [{ id: 'guests', label: 'Guests', input_type: 'NUMBER' }], calculation: { base_amount: 100, terms: [{ field_id: 'guests', kind: 'NUMBER_MULTIPLIER', multiplier: 10 }] } } });
  assert.equal(legacy.interactive_tool.pricing_mode, 'APPROVED_PRICING');
});

test('active tenant intelligence can generate a recommendation from a serialized legacy published Experience', async () => {
  const legacyPublished = normalizeGuideExperience({ interactive_tool: { fields: [{ id: 'guests', label: 'Guests', input_type: 'NUMBER' }], calculation: { base_amount: 100, terms: [{ field_id: 'guests', kind: 'NUMBER_MULTIPLIER', multiplier: 10 }] } } });
  const database = { query: async () => ({ rows: [{ id: '55555555-5555-4555-8555-555555555555', configuration_data: { assistant_identity: 'Event Assistant' }, assistant_metadata_name: 'Event Assistant', active_business_profile_version_id: '44444444-4444-4444-8444-444444444444', active_business_profile: { company_identity: 'Example Events', services: ['event planning'] }, profile_schema_version: 2, configuration_schema_version: 2 }] }) };
  const result = await generateGuideExperienceRecommendation({ database, tenantId: '11111111-1111-4111-8111-111111111111', assistantId: '22222222-2222-4222-8222-222222222222', currentExperience: legacyPublished });
  assert.equal(result.recommendation.classification.sector, 'EVENT_MANAGEMENT');
  assert.equal(result.experience.layout.preset, 'SERVICE');
  assert.equal(result.experience.interactive_tool.pricing_mode, 'QUOTE_REQUIRED');
});

test('recommended event context remains validated and tenant identifiers are not client fields', () => {
  const experience = buildGuideExperienceRecommendation({ activeProfile: { offering: 'event management' }, activeConfiguration: { assistant_identity: 'Advisor' } }).experience;
  const context = normalizeGuideSessionContext({ experience, context: { roadmap: { event_type: 'option_corporate_event_1', guest_count: 200 }, tool: { guest_count: 200, catering: true } } });
  assert.equal(context.roadmap.guest_count, 200);
  assert.throws(() => normalizeGuideSessionContext({ experience, context: { tenant_id: 'other-tenant' } }));
});

test('validates declarative conditional steps and rejects unsafe calculator payloads', () => {
  const valid = normalizeGuideExperience({ roadmap: { steps: [{ id: 'type', label: 'Type', input_type: 'SELECT', options: [{ value: 'yes', label: 'Yes' }] }, { id: 'detail', label: 'Detail', input_type: 'TEXT', visible_when: { field_id: 'type', equals: 'yes' } }] } });
  assert.equal(valid.roadmap.steps[1].visible_when.equals, 'yes');
  assert.throws(() => normalizeGuideExperience({ interactive_tool: { fields: [{ id: 'total', label: 'Total', input_type: 'NUMBER' }], calculation: { javascript: 'alert(1)', terms: [] } } }), (error) => error instanceof GuideExperienceError);
});

test('derives an accessible palette and corrects low-contrast logo candidates', () => {
  const palette = deriveAccessibleGuideTheme({ candidates: ['#FFFFFF', '#FFFFFF', '#E41B4B', '#E41B4B', '#080808'] });
  assert.equal(/^#[0-9A-F]{6}$/.test(palette.primary_color), true);
  assert.ok(palette.contrast.primary >= 4.5);
  assert.ok(palette.contrast.surface >= 4.5);
  assert.throws(() => deriveAccessibleGuideTheme({ candidates: Array(65).fill('#112233') }));
});

test('recommendations preserve a current logo but never inherit a historical assistant avatar', () => {
  const current = normalizeGuideExperience({
    logo_url: '/guide/assets/11111111-1111-4111-8111-111111111111',
    avatar_url: '/guide/assets/22222222-2222-4222-8222-222222222222',
  });
  const result = buildGuideExperienceRecommendation({ activeProfile: { offering: 'event planning' }, activeConfiguration: { assistant_identity: 'Advisor' }, currentExperience: current });
  assert.equal(result.experience.logo_url, current.logo_url);
  assert.equal(result.experience.avatar_url, null);
});

test('theme recommendations preserve brand candidates and choose accessible dark or light tokens deterministically', () => {
  const darkCandidates = ['#090909', '#090909', '#090909', '#C8A44B', '#C8A44B'];
  const dark = deriveAccessibleGuideTheme({ candidates: darkCandidates });
  const light = deriveAccessibleGuideTheme({ candidates: ['#F9FAFB', '#F9FAFB', '#1D6EC8', '#1D6EC8'] });
  assert.deepEqual(darkCandidates, ['#090909', '#090909', '#090909', '#C8A44B', '#C8A44B']);
  assert.equal(dark.mode, 'DARK');
  assert.equal(light.mode, 'LIGHT');
  assert.ok(dark.contrast.surface >= 4.5);
  assert.ok(light.contrast.surface >= 4.5);
  assert.ok(dark.contrast.button >= 4.5);
});
