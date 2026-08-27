import { describe, expect, it } from 'vitest';
import { buildVerifiedWhatsAppVoiceFile, detectedVoiceContainer, selectWhatsAppVoiceRecordingFormat } from './voice-recording';

describe('WhatsApp operator voice recording contract', () => {
  it('prefers Ogg/Opus and otherwise permits an actually supported MP4 recorder', () => {
    expect(selectWhatsAppVoiceRecordingFormat((mime) => mime === 'audio/ogg;codecs=opus')?.container).toBe('OGG_OPUS');
    expect(selectWhatsAppVoiceRecordingFormat((mime) => mime === 'audio/mp4')?.container).toBe('MP4');
    expect(selectWhatsAppVoiceRecordingFormat(() => false)).toBeNull();
  });
  it('preserves verified Ogg/Opus bytes with a truthful upload MIME and filename', async () => {
    const format = selectWhatsAppVoiceRecordingFormat((mime) => mime === 'audio/ogg;codecs=opus')!;
    const source = new Blob([new TextEncoder().encode('OggS....OpusHead....voice')], { type: format.recorderMime });
    const { file, detectedContainer } = await buildVerifiedWhatsAppVoiceFile([source], format, format.recorderMime);
    expect(file.name).toBe('voice-note.ogg');
    expect(file.type).toBe('audio/ogg');
    expect(detectedContainer).toBe('OGG_OPUS');
  });
  it('permits MP4 only when the recorded bytes carry an MP4 container signature', async () => {
    const format = selectWhatsAppVoiceRecordingFormat((mime) => mime === 'audio/mp4')!;
    const bytes = new Uint8Array([0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20, 0, 0, 0, 0]);
    const { file, detectedContainer } = await buildVerifiedWhatsAppVoiceFile([new Blob([bytes], { type: format.recorderMime })], format, format.recorderMime);
    expect(file.name).toBe('voice-note.m4a');
    expect(file.type).toBe('audio/mp4');
    expect(detectedContainer).toBe('MP4');
  });
  it('never relabels non-MP4 bytes as an MP4/M4A voice note', async () => {
    const format = selectWhatsAppVoiceRecordingFormat((mime) => mime === 'audio/mp4')!;
    await expect(buildVerifiedWhatsAppVoiceFile([new Blob([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3])], { type: 'audio/webm' })], format, format.recorderMime)).rejects.toThrow('VOICE_FORMAT_INVALID');
    expect(detectedVoiceContainer(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]))).toBe('WEBM');
  });
});
