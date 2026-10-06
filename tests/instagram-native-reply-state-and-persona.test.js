import test from 'node:test';
import assert from 'node:assert/strict';
import { sendInstagramMarkSeen } from '../services/instagram-delivery-service.js';
import {
  buildNaturalCustomerConversationPolicy,
  buildTenantRuntimeSystemInstruction,
} from '../services/tenant-runtime-persona-service.js';
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

test('PERSONA RULE — buildTenantRuntimeSystemInstruction integrates first-person rules into runtime instruction', () => {
  const persona = {
    available: true,
    companyIdentity: 'SamChe Company LLC',
    assistantIdentity: 'SamChe AI',
    profile: SAMCHE_STAGING_BUSINESS_PROFILE,
    configuration: SAMCHE_STAGING_ASSISTANT_CONFIG,
  };

  const systemInstruction = buildTenantRuntimeSystemInstruction({
    persona,
    knowledgeContext: 'Dubai şirket kuruluşu maliyetleri 12.500 AED den başlar. Kurucu Samed Tabak Dubai de 5 yıldır yaşamaktadır.',
  });

  assert.ok(systemInstruction.includes('FIRST-PERSON DIRECT PROSE'));
  assert.ok(systemInstruction.includes('NOT NARRATION TEMPLATE'));
  assert.ok(systemInstruction.includes('NO UNSOLICITED FOUNDER OR SOCIAL PROMOTION'));
  assert.ok(systemInstruction.includes('BİRİNCİ ŞAHIS DOĞRUDAN ANLATIM KURALI'));
  assert.ok(systemInstruction.includes('KURUCU / ÜÇÜNCÜ ŞAHIS ANLATIM YASAĞI'));
  assert.ok(systemInstruction.includes('UNSOLICITED YOUTUBE / VİDEO YÖNLENDİRME YASAĞI'));
});

test('PERSONA TEST A — General inquiry ("Dubai\'de şirket kurmak istiyorum"): instructions prohibit third-person founder reference', () => {
  const instructions = SAMCHE_STAGING_ASSISTANT_CONFIG.assistant_instructions;

  assert.ok(instructions.includes('KURUCU / ÜÇÜNCÜ ŞAHIS ANLATIM YASAĞI'));
  assert.ok(instructions.includes('SamChe Company olarak bizler'));
  assert.ok(instructions.includes('kurucumuz Samed Tabak'));
});

test('PERSONA TEST B — Uber inquiry: instruction requires first-person voice and forbids "kurucumuzun paylaştığı içerikler"', () => {
  const instructions = SAMCHE_STAGING_ASSISTANT_CONFIG.assistant_instructions;

  assert.ok(instructions.includes('kurucumuzun paylaştığı içerikler'));
  assert.ok(instructions.includes('BİRİNCİ ŞAHIS DOĞRUDAN ANLATIM KURALI'));
});

test('PERSONA TEST C — Explicit founder inquiry ("Samed Tabak kim?"): allowed to answer directly', () => {
  const instructions = SAMCHE_STAGING_ASSISTANT_CONFIG.assistant_instructions;

  assert.ok(instructions.includes('Kullanıcı doğrudan "Samed Tabak kim?", "Samed Tabak kimdir?"'));
});

test('PERSONA TEST D — Explicit YouTube inquiry ("YouTube kanalınız var mı?"): allowed to answer with approved link', () => {
  const instructions = SAMCHE_STAGING_ASSISTANT_CONFIG.assistant_instructions;

  assert.ok(instructions.includes('"YouTube kanalınız var mı?" diye sorarsa doğrudan, net ve onaylı bilgiye sadık kalarak cevap ver'));
});

