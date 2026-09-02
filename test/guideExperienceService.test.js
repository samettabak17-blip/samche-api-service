import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GuideExperienceError,
  normalizeGuideExperience,
  resolvePublishedGuideExperience,
  guideExperienceCacheKey,
} from '../services/guide-experience-service.js';

const tenantId = '11111111-1111-4111-8111-111111111111';
const assistantId = '22222222-2222-4222-8222-222222222222';

test('normalizes a bounded tenant guide experience without provider or executable fields', () => {
  const experience = normalizeGuideExperience({
    brand_name: 'Blue Dune Event Management LLC',
    assistant_display_name: 'Blue Dune Event Assistant',
    welcome_title: 'Plan an exceptional event',
    welcome_message: 'Tell us about your occasion.',
    theme: { primary_color: '#124E78', accent_color: '#C49743', font_family: 'Inter' },
    layout: { preset: 'PREMIUM', launcher_style: 'PILL' },
    modules: { chat: true, calculator: false },
  });
  assert.equal(experience.brand_name, 'Blue Dune Event Management LLC');
  assert.equal(experience.theme.primary_color, '#124E78');
  assert.equal(experience.layout.preset, 'PREMIUM');
  assert.equal('model' in experience, false);
  assert.equal('provider' in experience, false);
});

test('rejects unsafe assets, script-like copy, and arbitrary theme values', () => {
  for (const invalid of [
    { logo_url: 'data:image/png;base64,abc' },
    { logo_url: 'https://cdn.example.test/logo.svg' },
    { welcome_title: '<script>alert(1)</script>' },
    { theme: { primary_color: 'url(javascript:alert(1))' } },
  ]) {
    assert.throws(() => normalizeGuideExperience(invalid), (error) => error instanceof GuideExperienceError && error.code === 'GUIDE_EXPERIENCE_INVALID');
  }
});

test('published resolution selects only the exact tenant assistant active version and otherwise returns neutral fallback', async () => {
  const database = {
    async query(sql, params) {
      assert.match(sql, /tenant_id = \$1/i);
      assert.match(sql, /assistant_id = \$2/i);
      assert.deepEqual(params, [tenantId, assistantId]);
      return { rows: [] };
    },
  };
  const resolved = await resolvePublishedGuideExperience({ database, tenantId, assistantId });
  assert.equal(resolved.source, 'NEUTRAL_FALLBACK');
  assert.equal(resolved.experience.brand_name, 'AI Guide');
  assert.equal(resolved.experience.version, 0);
});

test('cache keys are partitioned by tenant assistant and published experience version', () => {
  const first = guideExperienceCacheKey({ tenantId, assistantId, version: 1 });
  const second = guideExperienceCacheKey({ tenantId, assistantId, version: 2 });
  const otherTenant = guideExperienceCacheKey({ tenantId: '33333333-3333-4333-8333-333333333333', assistantId, version: 1 });
  assert.notEqual(first, second);
  assert.notEqual(first, otherTenant);
});
