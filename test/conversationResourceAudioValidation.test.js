import assert from 'node:assert/strict';
import test from 'node:test';
import { validateConversationUpload } from '../services/conversation-resource-validation.js';

test('accepts a WhatsApp Ogg/Opus voice resource and classifies it as AUDIO', () => {
  const buffer = Buffer.from('OggS' + 'voice-note');
  const result = validateConversationUpload({
    buffer,
    size: buffer.length,
    mimetype: 'audio/ogg',
    originalname: 'voice-note.ogg',
  });
  assert.equal(result.mediaCategory, 'AUDIO');
  assert.equal(result.mimeType, 'audio/ogg');
});

test('rejects an audio upload whose binary does not match its declared Ogg format', () => {
  const buffer = Buffer.from('not an ogg file');
  assert.throws(() => validateConversationUpload({
    buffer,
    size: buffer.length,
    mimetype: 'audio/ogg',
    originalname: 'voice-note.ogg',
  }), { code: 'RESOURCE_FILE_SIGNATURE_INVALID' });
});
