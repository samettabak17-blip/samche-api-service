import assert from 'node:assert/strict';
import test from 'node:test';
import { validateConversationUpload } from '../services/conversation-resource-validation.js';
import { normalizeOperatorVoiceNote } from '../services/operator-voice-normalization-service.js';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

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


test('normalizes a dashboard WebM voice note to actual MPEG bytes rather than relabeling it', async () => {
  const captured = [];
  const spawnImpl = (_binary, args) => {
    captured.push(args);
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    queueMicrotask(() => {
      child.stdout.end(Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00]));
      child.emit('close', 0);
    });
    return child;
  };
  const result = await normalizeOperatorVoiceNote({
    buffer: Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x01]),
    size: 5,
    mimetype: 'audio/webm',
    originalname: 'voice-note.webm',
  }, { spawnImpl });
  assert.equal(result.mimetype, 'audio/mpeg');
  assert.equal(result.originalname, 'voice-note.mp3');
  assert.deepEqual(result.buffer, Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00]));
  assert.ok(captured[0].includes('libmp3lame'));
  assert.ok(captured[0].includes('mp3'));
});
