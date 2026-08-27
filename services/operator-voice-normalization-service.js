import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ffmpegPath = require('ffmpeg-static');

export class OperatorVoiceNormalizationError extends Error {
  constructor(code = 'VOICE_MEDIA_FORMAT_MISMATCH') { super('Voice recording format is not supported'); this.code = code; }
}

/** Converts only dashboard-generated WebM/Opus operator voice notes to real Ogg/Opus bytes. */
export async function normalizeOperatorVoiceNote(file, { spawnImpl = spawn } = {}) {
  if (String(file?.mimetype).toLowerCase() !== 'audio/webm' || file?.originalname !== 'voice-note.webm') return file;
  if (!ffmpegPath || !Buffer.isBuffer(file.buffer) || !file.buffer.length) throw new OperatorVoiceNormalizationError();
  const output = await new Promise((resolve, reject) => {
    const child = spawnImpl(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-vn', '-c:a', 'libopus', '-b:a', '32k', '-f', 'ogg', 'pipe:1']);
    const chunks = []; let stderr = '';
    child.stdout.on('data', (chunk) => chunks.push(chunk));
    child.stderr.on('data', (chunk) => { stderr += String(chunk).slice(0, 256); });
    child.on('error', () => reject(new OperatorVoiceNormalizationError()));
    child.on('close', (code) => code === 0 && chunks.length ? resolve(Buffer.concat(chunks)) : reject(new OperatorVoiceNormalizationError()));
    child.stdin.end(file.buffer);
  });
  if (output.subarray(0, 4).toString('ascii') !== 'OggS') throw new OperatorVoiceNormalizationError();
  return { ...file, buffer: output, size: output.length, mimetype: 'audio/ogg', originalname: 'voice-note.ogg' };
}
