import test from 'node:test';
import assert from 'node:assert/strict';
import { sendInstagramMarkSeen } from '../services/instagram-delivery-service.js';
import {
  buildNaturalCustomerConversationPolicy,
  buildTenantRuntimeSystemInstruction,
} from '../services/tenant-runtime-persona-service.js';
import {
  buildInstagramPersonalPersonaInstruction,
  buildInstagramChannelRules,
} from '../services/instagram-ai-orchestrator.js';
import {
  SAMCHE_STAGING_BUSINESS_PROFILE,
  SAMCHE_STAGING_ASSISTANT_CONFIG,
} from '../services/samche-canonical-knowledge-data.js';

test('NATIVE SYNC — sendInstagramMarkSeen sends sender_action: mark_seen to Meta Graph endpoint', async () => {
  let capturedUrl = null;
  let capturedBody = null;
  let capturedParams = null;
  let capturedHeaders = null;

  const mockHttp = {
    post: async (url, body, options) => {
      capturedUrl = url;
      capturedBody = body;
      capturedParams = options?.params;
      capturedHeaders = options?.headers;
      return { status: 200, data: { success: true } };
    },
  };

  const result = await sendInstagramMarkSeen({
    recipientId: 'instagram:1234567890',
    accessToken: 'test_token_abc',
    pageId: 'page_999',
    instagramAccountId: 'ig_acc_999',
    authMode: 'FACEBOOK_LOGIN',
    http: mockHttp,
  });

  assert.equal(result.ok, true);
  assert.equal(capturedBody?.recipient?.id, '1234567890', 'Must strip instagram: prefix and use raw customer IGSID');
  assert.equal(capturedBody?.sender_action, 'mark_seen', 'Must send sender_action: mark_seen');
  assert.equal(capturedParams?.access_token, 'test_token_abc', 'Must pass access_token in URL params');
  assert.equal(capturedHeaders?.Authorization, 'Bearer test_token_abc', 'Must pass Authorization header');
  assert.ok(capturedUrl?.includes('/messages'), 'Target endpoint must be /messages');
});

test('NATIVE SYNC — sendInstagramMarkSeen handles failure safely without throwing', async () => {
  const mockHttpFail = {
    post: async () => {
      const error = new Error('Meta API error: (#100) Parameter sender_action is invalid');
      error.response = { status: 400, data: { error: { message: 'Invalid sender_action', code: 100 } } };
      throw error;
    },
  };

  const result = await sendInstagramMarkSeen({
    recipientId: 'instagram:1234567890',
    accessToken: 'test_token_abc',
    http: mockHttpFail,
  });

  assert.equal(result.ok, false);
  assert.ok(result.reason.includes('sender_action') || result.reason.includes('100') || result.reason.includes('FAILED'));
});

test('NATIVE SYNC — sendInstagramMarkSeen validates missing credentials fail closed without throwing', async () => {
  const result1 = await sendInstagramMarkSeen({ recipientId: null, accessToken: 'token' });
  assert.equal(result1.ok, false);
  assert.equal(result1.reason, 'CREDENTIALS_MISSING');

  const result2 = await sendInstagramMarkSeen({ recipientId: '12345', accessToken: null });
  assert.equal(result2.ok, false);
  assert.equal(result2.reason, 'CREDENTIALS_MISSING');
});
test('PERSONA RULE — buildNaturalCustomerConversationPolicy contains first-person direct voice and anti-narration rules', () => {
  const policy = buildNaturalCustomerConversationPolicy('SamChe Company LLC');

  assert.ok(policy.includes('FIRST-PERSON DIRECT PROSE'), 'Must enforce first-person prose');
  assert.ok(policy.includes('NOT NARRATION TEMPLATE'), 'Must instruct that knowledge is fact-only, not narrative template');
  assert.ok(policy.includes('NO UNSOLICITED FOUNDER OR SOCIAL PROMOTION'), 'Must prohibit unsolicited founder/social/YouTube promotion');
  assert.ok(policy.includes('TRUTHFUL AI IDENTITY DISCLOSURE'), 'Must retain truthful AI disclosure when explicitly asked');
});

test('PERSONAL PERSONA — buildInstagramPersonalPersonaInstruction generates first-person directives for personal account', () => {
  const instruction = buildInstagramPersonalPersonaInstruction({
    persona_type: 'PERSONAL',
    speaker_name: 'Samed Tabak',
  });

  assert.ok(instruction.includes('PERSONAL INSTAGRAM FIRST-PERSON SPEAKER DIRECTIVE'));
  assert.ok(instruction.includes('This Instagram account is the personal account of Samed Tabak'));
  assert.ok(instruction.includes('You MUST speak directly AS Samed Tabak in the first person'));
  assert.ok(instruction.includes('Do NOT say "kurucumuz Samed Tabak"'));
  assert.ok(instruction.includes('Do NOT say "[Company] olarak bizler..."'));
  assert.ok(instruction.includes('YouTube sayfamda da detaylı içerikler paylaşıyorum'));
  assert.ok(instruction.includes('EXISTING APPROVED PROMPT REMAINS AUTHORITATIVE'));
});

test('PERSONAL PERSONA — Corporate accounts or unconfigured personas omit personal directive cleanly', () => {
  const instruction1 = buildInstagramPersonalPersonaInstruction({});
  assert.equal(instruction1, '');

  const instruction2 = buildInstagramPersonalPersonaInstruction({ persona_type: 'CORPORATE' });
  assert.equal(instruction2, '');
});

test('PERSONA RULE — buildTenantRuntimeSystemInstruction integrates personal Instagram directive with highest precedence', () => {
  const persona = {
    available: true,
    companyIdentity: 'SamChe Company LLC',
    assistantIdentity: 'SamChe AI',
    profile: SAMCHE_STAGING_BUSINESS_PROFILE,
    configuration: SAMCHE_STAGING_ASSISTANT_CONFIG,
  };

  const channelRules = buildInstagramChannelRules({ persona });
  const systemInstruction = buildTenantRuntimeSystemInstruction({
    persona,
    channelRules,
    knowledgeContext: 'Dubai şirket kuruluşu maliyetleri 12.500 AED den başlar. Kurucu Samed Tabak Dubai de 5 yıldır yaşamaktadır.',
  });

  assert.ok(systemInstruction.includes('PERSONAL INSTAGRAM FIRST-PERSON SPEAKER DIRECTIVE'));
  assert.ok(systemInstruction.includes('You MUST speak directly AS Samed Tabak in the first person'));
  assert.ok(systemInstruction.includes('Do NOT say "kurucumuz Samed Tabak"'));
  assert.ok(systemInstruction.includes('YouTube sayfamda da detaylı içerikler paylaşıyorum'));
});

test('PERSONA TEST A — General inquiry ("Dubai\'de şirket kurmak istiyorum"): persona requires first-person Samed response and prohibits "kurucumuz Samed Tabak"', () => {
  const persona = {
    available: true,
    companyIdentity: 'SamChe Company LLC',
    assistantIdentity: 'SamChe AI',
    profile: SAMCHE_STAGING_BUSINESS_PROFILE,
    configuration: SAMCHE_STAGING_ASSISTANT_CONFIG,
  };

  const channelRules = buildInstagramChannelRules({ persona });
  assert.ok(channelRules.includes('Do NOT say "kurucumuz Samed Tabak"'));
  assert.ok(channelRules.includes('You MUST speak directly AS Samed Tabak in the first person'));
});

test('PERSONA TEST B — Earnings inquiry: persona requires first-person voice and prohibits "kurucumuzun deneyimleri" / "Samed Tabak\'ın deneyimleri"', () => {
  const persona = {
    available: true,
    companyIdentity: 'SamChe Company LLC',
    assistantIdentity: 'SamChe AI',
    profile: SAMCHE_STAGING_BUSINESS_PROFILE,
    configuration: SAMCHE_STAGING_ASSISTANT_CONFIG,
  };

  const channelRules = buildInstagramChannelRules({ persona });
  assert.ok(channelRules.includes('kurucumuzun deneyimleri'));
  assert.ok(channelRules.includes('Samed Tabak\'ın...'));
});

test('PERSONA TEST C & D — YouTube inquiries: clickable YouTube URL format is preserved with first-person wording ("YouTube sayfam...")', () => {
  const persona = {
    available: true,
    companyIdentity: 'SamChe Company LLC',
    assistantIdentity: 'SamChe AI',
    profile: SAMCHE_STAGING_BUSINESS_PROFILE,
    configuration: SAMCHE_STAGING_ASSISTANT_CONFIG,
  };

  const channelRules = buildInstagramChannelRules({ persona });
  assert.ok(channelRules.includes('YouTube sayfamda da detaylı içerikler paylaşıyorum: [Samed Tabak YouTube](https://youtube.com/@sametttbk)'));
  assert.ok(channelRules.includes('YouTube sayfamdan da detaylara ulaşabilirsiniz: [Samed Tabak YouTube](https://youtube.com/@sametttbk)'));
});

test('PERSONA TEST E — Explicit founder inquiry ("Samed Tabak kim?"): allowed to answer directly without awkward third-person narration', () => {
  const persona = {
    available: true,
    companyIdentity: 'SamChe Company LLC',
    assistantIdentity: 'SamChe AI',
    profile: SAMCHE_STAGING_BUSINESS_PROFILE,
    configuration: SAMCHE_STAGING_ASSISTANT_CONFIG,
  };

  const channelRules = buildInstagramChannelRules({ persona });
  assert.ok(channelRules.includes('EXPLICIT IDENTITY INQUIRIES'));
  assert.ok(channelRules.includes('asks "Samed Tabak kim?", answer directly and naturally using approved factual knowledge'));
});

test('PERSONA TEST F — Unsupported personal claims: instruction strictly forbids inventing ungrounded experiences', () => {
  const persona = {
    available: true,
    companyIdentity: 'SamChe Company LLC',
    assistantIdentity: 'SamChe AI',
    profile: SAMCHE_STAGING_BUSINESS_PROFILE,
    configuration: SAMCHE_STAGING_ASSISTANT_CONFIG,
  };

  const channelRules = buildInstagramChannelRules({ persona });
  assert.ok(channelRules.includes('NO INVENTED PERSONAL CLAIMS'));
  assert.ok(channelRules.includes('Only express personal experiences or achievements when grounded in approved assistant knowledge'));
});

test('PERSONA ISOLATION — WhatsApp, Web Chat, and AI Guide channel rules remain corporate and untouched', () => {
  const persona = {
    available: true,
    companyIdentity: 'SamChe Company LLC',
    assistantIdentity: 'SamChe AI',
    profile: SAMCHE_STAGING_BUSINESS_PROFILE,
    configuration: SAMCHE_STAGING_ASSISTANT_CONFIG,
  };

  const whatsappSystemInstruction = buildTenantRuntimeSystemInstruction({
    persona,
    channelRules: 'WHATSAPP_CHANNEL_RULES_ONLY',
  });

  assert.ok(!whatsappSystemInstruction.includes('PERSONAL INSTAGRAM FIRST-PERSON SPEAKER DIRECTIVE'));
  assert.ok(whatsappSystemInstruction.includes('WHATSAPP_CHANNEL_RULES_ONLY'));
});

