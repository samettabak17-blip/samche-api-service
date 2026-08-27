import { describe, expect, it } from 'vitest';
import { buildVerifiedWhatsAppVoiceFile, isOggOpusHeader, selectWhatsAppVoiceRecordingFormat } from './voice-recording';

describe('WhatsApp operator voice recording contract', () => {
  it('negotiates only a browser-native Ogg/Opus recorder format', () => {
    expect(selectWhatsAppVoiceRecordingFormat((mime) => mime === 'audio/ogg;codecs=opus')).toEqual({ recorderMime: 'audio/ogg;codecs=opus', uploadMime: 'audio/ogg', filename: 'voice-note.ogg' });
    expect(selectWhatsAppVoiceRecordingFormat(() => false)).toBeNull();
  });
  it('preserves verified Ogg/Opus bytes with a truthful upload MIME and filename', async () => {
    const source = new Blob([new TextEncoder().encode('OggS....OpusHead....voice')], { type: 'audio/ogg;codecs=opus' });
    const file = await buildVerifiedWhatsAppVoiceFile([source], 'audio/ogg;codecs=opus');
    expect(file.name).toBe('voice-note.ogg');
    expect(file.type).toBe('audio/ogg');
    expect(file.size).toBeGreaterThan(0);
  });
  it('never relabels non-Ogg bytes as an MP4/M4A voice note', async () => {
    await expect(buildVerifiedWhatsAppVoiceFile([new Blob([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3])], { type: 'audio/webm' })], 'audio/ogg;codecs=opus')).rejects.toThrow('VOICE_FORMAT_INVALID');
  });
});
