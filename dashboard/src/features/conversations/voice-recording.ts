export type WhatsAppVoiceRecordingFormat = {
  recorderMime: string;
  uploadMime: 'audio/ogg' | 'audio/mp4' | 'audio/webm';
  filename: 'voice-note.ogg' | 'voice-note.m4a' | 'voice-note.webm';
  container: 'OGG_OPUS' | 'MP4' | 'WEBM';
};

const whatsappVoiceFormats: readonly WhatsAppVoiceRecordingFormat[] = [
  { recorderMime: 'audio/ogg;codecs=opus', uploadMime: 'audio/ogg', filename: 'voice-note.ogg', container: 'OGG_OPUS' },
  { recorderMime: 'audio/webm;codecs=opus', uploadMime: 'audio/webm', filename: 'voice-note.webm', container: 'WEBM' },
  { recorderMime: 'audio/mp4;codecs=mp4a.40.2', uploadMime: 'audio/mp4', filename: 'voice-note.m4a', container: 'MP4' },
  { recorderMime: 'audio/mp4', uploadMime: 'audio/mp4', filename: 'voice-note.m4a', container: 'MP4' },
];

export function selectWhatsAppVoiceRecordingFormat(isTypeSupported: (mimeType: string) => boolean): WhatsAppVoiceRecordingFormat | null {
  return whatsappVoiceFormats.find((format) => isTypeSupported(format.recorderMime)) ?? null;
}

export function detectedVoiceContainer(bytes: Uint8Array): 'OGG_OPUS' | 'MP4' | 'WEBM' | 'UNKNOWN' {
  if (bytes.length >= 4 && String.fromCharCode(...bytes.subarray(0, 4)) === 'OggS'
    && new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.length, 64 * 1024))).includes('OpusHead')) return 'OGG_OPUS';
  if (bytes.length >= 12 && String.fromCharCode(...bytes.subarray(4, 8)) === 'ftyp') return 'MP4';
  if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return 'WEBM';
  return 'UNKNOWN';
}

async function readBlobPrefix(blob: Blob): Promise<Uint8Array> {
  const prefix = blob.slice(0, 64 * 1024);
  if (typeof prefix.arrayBuffer === 'function') return new Uint8Array(await prefix.arrayBuffer());
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('VOICE_FORMAT_INVALID'));
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.readAsArrayBuffer(prefix);
  });
}

/**
 * Preserves browser-produced bytes. A format is selected before recording and
 * its physical container is verified before the type/filename are used for Meta.
 */
export async function buildVerifiedWhatsAppVoiceFile(parts: BlobPart[], format: WhatsAppVoiceRecordingFormat, actualRecorderMime: string): Promise<{ file: File; detectedContainer: 'OGG_OPUS' | 'MP4' | 'WEBM' }> {
  if (!String(actualRecorderMime).toLowerCase().startsWith(format.uploadMime)) throw new Error('VOICE_FORMAT_INVALID');
  const blob = new Blob(parts, { type: actualRecorderMime });
  const detectedContainer = detectedVoiceContainer(await readBlobPrefix(blob));
  if (detectedContainer !== format.container) throw new Error('VOICE_FORMAT_INVALID');
  return { file: new File([blob], format.filename, { type: format.uploadMime }), detectedContainer };
}
