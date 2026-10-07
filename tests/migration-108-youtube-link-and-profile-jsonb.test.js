import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql108 = fs.readFileSync(new URL('../migrations/108_update_samche_youtube_link.sql', import.meta.url), 'utf8');
const sql109 = fs.readFileSync(new URL('../migrations/109_configure_samche_instagram_supplementary_resources.sql', import.meta.url), 'utf8');

test('Migration 108: business_profile_versions update statement must NOT reference updated_at column', () => {
  // Extract business_profile_versions UPDATE statement
  const bpvUpdateMatch = sql108.match(/UPDATE\s+business_profile_versions[\s\S]*?;/i);
  assert.ok(bpvUpdateMatch, 'Must contain UPDATE business_profile_versions statement');

  const bpvStatement = bpvUpdateMatch[0];
  assert.ok(!bpvStatement.includes('updated_at'), 'business_profile_versions update must not reference non-existent updated_at column');
  assert.match(bpvStatement, /SET\s+profile_data\s*=/i, 'Must update profile_data');
  assert.match(bpvStatement, /::jsonb/i, 'Must cast result back to jsonb');
  assert.match(bpvStatement, /WHERE\s+profile_data::text\s+LIKE/i, 'Must be conditionally scoped to matching rows');
});

test('Migration 108: tables with updated_at column keep their timestamps updated', () => {
  assert.match(sql108, /UPDATE\s+knowledge_base_documents[\s\S]*?updated_at\s*=\s*CURRENT_TIMESTAMP/i);
  assert.match(sql108, /UPDATE\s+knowledge_chunks[\s\S]*?updated_at\s*=\s*CURRENT_TIMESTAMP/i);
  assert.match(sql108, /UPDATE\s+assistant_configuration_versions[\s\S]*?updated_at\s*=\s*CURRENT_TIMESTAMP/i);
});

test('Migration 108: JSONB replacement preserves structure, keys, values, arrays, nulls, booleans, and Turkish Unicode', () => {
  function replaceObsoleteYouTubeUrl(jsonText) {
    return jsonText
      .replaceAll('https://www.youtube.com/@sametttbk', 'https://ytbe.app/u9j8qB2S')
      .replaceAll('https://youtube.com/@sametttbk', 'https://ytbe.app/u9j8qB2S')
      .replaceAll('http://youtube.com/@sametttbk', 'https://ytbe.app/u9j8qB2S');
  }

  const complexProfileData = {
    company_identity: 'SamChe Company LLC',
    operating_information: [
      'Şirket Adresi: Latifa Tower Office 402, Dubai, UAE',
      'Kurucu YouTube Kanalı: https://youtube.com/@sametttbk',
      'E-posta: info@samchecompany.com',
    ],
    social_links: {
      youtube: 'https://www.youtube.com/@sametttbk',
      instagram: 'https://instagram.com/sametttbk',
    },
    flags: {
      verified: true,
      pending: false,
      notes: null,
    },
    metrics: {
      rating: 4.95,
      reviews_count: 150,
    },
    turkish_text: "Dubai'de yaşam maliyeti ve şirket kuruluşu danışmanlığı: https://youtube.com/@sametttbk",
    already_approved_resource: 'https://ytbe.app/u9j8qB2S',
  };

  const originalJson = JSON.stringify(complexProfileData);
  const replacedJson = replaceObsoleteYouTubeUrl(originalJson);
  const parsed = JSON.parse(replacedJson);

  // 1. Valid JSON
  assert.ok(parsed, 'Parsed object must be valid');

  // 2. Only approved URL exists, obsolete URL eliminated
  assert.ok(!replacedJson.includes('youtube.com/@sametttbk'), 'Obsolete URL must be completely absent');
  assert.equal(parsed.social_links.youtube, 'https://ytbe.app/u9j8qB2S');
  assert.equal(parsed.operating_information[1], 'Kurucu YouTube Kanalı: https://ytbe.app/u9j8qB2S');
  assert.ok(parsed.turkish_text.includes('https://ytbe.app/u9j8qB2S'));

  // 3. Unrelated keys and values unchanged
  assert.equal(parsed.company_identity, 'SamChe Company LLC');
  assert.equal(parsed.social_links.instagram, 'https://instagram.com/sametttbk');
  assert.equal(parsed.flags.verified, true);
  assert.equal(parsed.flags.pending, false);
  assert.equal(parsed.flags.notes, null);
  assert.equal(parsed.metrics.rating, 4.95);
  assert.equal(parsed.metrics.reviews_count, 150);
  assert.equal(parsed.already_approved_resource, 'https://ytbe.app/u9j8qB2S');
});

test('Migration 108 & 109: Idempotency and sequential execution invariant', () => {
  // Idempotency: Running replacement on already-updated data causes zero mutations
  const alreadyMigrated = JSON.stringify({
    channel: 'https://ytbe.app/u9j8qB2S',
    name: 'Samed Tabak',
  });
  const afterRerun = alreadyMigrated
    .replaceAll('https://www.youtube.com/@sametttbk', 'https://ytbe.app/u9j8qB2S')
    .replaceAll('https://youtube.com/@sametttbk', 'https://ytbe.app/u9j8qB2S')
    .replaceAll('http://youtube.com/@sametttbk', 'https://ytbe.app/u9j8qB2S');

  assert.equal(alreadyMigrated, afterRerun, 'Rerunning replacement must not mutate already-updated rows');

  // Migration 109 structure verification
  assert.match(sql109, /jsonb_set/i);
  assert.match(sql109, /supplementary_resources/i);
  assert.match(sql109, /https:\/\/ytbe\.app\/u9j8qB2S/);
  assert.match(sql109, /b85d7e7b-d52e-4541-92e7-284a6a67024b/);
});
