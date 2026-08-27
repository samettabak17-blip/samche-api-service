export type WhatsAppVoiceRecordingFormat = {
  recorderMime: 'audio/ogg;codecs=opus';
  uploadMime: 'audio/ogg';
  filename: 'voice-note.ogg';
};

const whatsappVoiceFormats: readonly WhatsAppVoiceRecordingFormat[] = [
  { recorderMime: 'audio/ogg;codecs=opus', uploadMime: 'audio/ogg', filename: 'voice-note.ogg' },
];

export function selectWhatsAppVoiceRecordingFormat(isTypeSupported: (mimeType: string) => boolean): WhatsAppVoiceRecordingFormat | null {
  return whatsappVoiceFormats.find((format) => isTypeSupported(format.recorderMime)) ?? null;
}

export function isOggOpusHeader(bytes: Uint8Array): boolean {
  if (bytes.length < 4 || String.fromCharCode(...bytes.subarray(0, 4)) !== 'OggS') return false;
  return new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.length, 64 * 1024))).includes('OpusHead');
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

/** Keeps browser-produced bytes unchanged; labels them only after verification. */
export async function buildVerifiedWhatsAppVoiceFile(parts: BlobPart[], recorderMime: string): Promise<File> {
  const format = selectWhatsAppVoiceRecordingFormat((mimeType) => mimeType === recorderMime);
  if (!format) throw new Error('VOICE_FORMAT_UNSUPPORTED');
  const blob = new Blob(parts, { type: recorderMime });
  if (!isOggOpusHeader(await readBlobPrefix(blob))) throw new Error('VOICE_FORMAT_INVALID');
  return new File([blob], format.filename, { type: format.uploadMime });
}
