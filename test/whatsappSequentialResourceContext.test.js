import assert from 'node:assert/strict';
import test from 'node:test';
import { selectRecentWhatsAppResourceContext, shouldSelectRecentWhatsAppResourceContext } from '../services/whatsapp-live-inbox-service.js';

const tenantId = '11111111-1111-4111-8111-111111111111';
const conversationId = '22222222-2222-4222-8222-222222222222';

function explicitResourceQueryClient(rows) {
  return {
    async query(sql, parameters) {
      assert.match(sql, /tenant_id = \$1/);
      assert.match(sql, /conversation_id = \$2/);
      assert.match(sql, /SELECT id, storage_key, media_category, mime_type, extracted_text, processing_status/);
      // Explicit references deliberately see the newest status so FAILED and PROCESSING
      // resources can produce deterministic responses instead of falling back to older files.
      assert.doesNotMatch(sql, /AND processing_status IN \('READY', 'PROCESSING'\)/);
      assert.equal(parameters[0], tenantId);
      assert.equal(parameters[1], conversationId);
      return { rows };
    },
  };
}

test('selects the recent same-conversation document for an explicit sequential PDF question', async () => {
  const selected = await selectRecentWhatsAppResourceContext({
    client: explicitResourceQueryClient([{
      id: 'resource-document',
      media_category: 'DOCUMENT',
      mime_type: 'application/pdf',
      processing_status: 'READY',
      extracted_text: 'Reference: SC-WP-92817\nAmount: 37,450 AED',
    }]),
    tenantId,
    conversationId,
    customerText: 'Bu belgedeki reference ve amount nedir?',
  });

  assert.deepEqual(selected.resourceIds, ['resource-document']);
  assert.match(selected.parts[0].text, /SC-WP-92817/);
  assert.match(selected.parts[0].text, /untrusted customer-supplied document evidence/);
});

test('selects a recent same-conversation image as a vision part for a sequential question', async () => {
  const selected = await selectRecentWhatsAppResourceContext({
    client: explicitResourceQueryClient([{
      id: 'resource-image',
      storage_key: 'conversation-resources/private-key',
      media_category: 'IMAGE',
      mime_type: 'image/png',
      processing_status: 'READY',
    }]),
    tenantId,
    conversationId,
    customerText: 'Bu görselde ne yazıyor?',
    storage: { async get() { return Buffer.from('image-bytes'); } },
  });

  assert.deepEqual(selected.resourceIds, ['resource-image']);
  assert.deepEqual(selected.parts[0], {
    inline_data: { mime_type: 'image/png', data: Buffer.from('image-bytes').toString('base64') },
  });
});

test('bounds historic resource context and never queries outside the current tenant conversation', async () => {
  const selected = await selectRecentWhatsAppResourceContext({
    client: explicitResourceQueryClient([
      { id: 'latest', media_category: 'DOCUMENT', processing_status: 'READY', extracted_text: 'A'.repeat(20_000) },
      { id: 'older', media_category: 'DOCUMENT', processing_status: 'READY', extracted_text: 'B'.repeat(20_000) },
      { id: 'outside-bound', media_category: 'DOCUMENT', processing_status: 'READY', extracted_text: 'C'.repeat(20_000) },
    ]),
    tenantId,
    conversationId,
    customerText: 'Bu dosyadaki detayları açıkla',
  });

  assert.deepEqual(selected.resourceIds, ['latest']);
  assert.ok(selected.parts[0].text.length < 13_000);
});

test('does not select historic resources while human or paused handling is active', () => {
  for (const handling_mode of ['HUMAN', 'PAUSED']) {
    assert.equal(shouldSelectRecentWhatsAppResourceContext({
      conversation: { status: 'open', handling_mode },
      descriptor: null,
      customerText: 'Bu belgedeki reference nedir?',
    }), false);
  }
});
