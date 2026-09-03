import assert from 'node:assert/strict';
import test from 'node:test';
import { buildGuideExperienceRecommendation, classifyGuideSector } from '../services/guide-experience-recommendation-service.js';
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
