import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatGeminiMultimodalParts,
  resolveConversationMultimodalContext,
} from '../services/conversation-multimodal-context-service.js';

const tenantId = '11111111-1111-4111-8111-111111111111';
const conversationId = '22222222-2222-4222-8222-222222222222';

test('AI GUIDE MULTIMODAL: Formats Gemini parts for image and document grounded answering', async () => {
  const fakePng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
  const parts = formatGeminiMultimodalParts({
    text: 'Explain this design diagram in terms of the tenant roadmap.',
    images: [{ mimeType: 'image/png', buffer: fakePng }],
    documentContext: '<customer_document_evidence>Requirements for Project Alpha</customer_document_evidence>',
  });

  assert.equal(parts.length, 2);
  assert.match(parts[0].text, /Requirements for Project Alpha/);
  assert.match(parts[0].text, /Explain this design diagram/);
  assert.ok(parts[1].inline_data);
  assert.equal(parts[1].inline_data.mime_type, 'image/png');
  assert.equal(parts[1].inline_data.data, fakePng.toString('base64'));
});

test('AI GUIDE MULTIMODAL: Does NOT expose or trigger visual AI generation', async () => {
  const database = {
    query: async () => ({
      rows: [
        { id: 'doc-1', original_filename: 'spec.txt', media_category: 'DOCUMENT', extracted_text: 'Specs' },
      ],
    }),
  };

  const context = await resolveConversationMultimodalContext({
    database,
    tenantId,
    conversationId,
  });

  assert.equal(context.documents.length, 1);
  // Assert no generation job or generation path is triggered
  assert.equal(context.promptSection.includes('VISUAL_AI_GENERATED'), false);
});
