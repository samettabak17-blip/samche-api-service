import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ffmpegPath = require('ffmpeg-static');

function isMpegAudio(buffer) {
  return buffer.length >= 3 && (buffer.subarray(0, 3).toString('ascii') === 'ID3' || (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0));
}

export class OperatorVoiceNormalizationError extends Error {
  constructor(code = 'VOICE_MEDIA_FORMAT_MISMATCH') { super('Voice recording format is not supported'); this.code = code; }
}

/** Converts only dashboard-generated WebM/Opus operator voice notes to real MPEG audio bytes. */
export async function normalizeOperatorVoiceNote(file, { spawnImpl = spawn } = {}) {
  if (String(file?.mimetype).toLowerCase() !== 'audio/webm' || file?.originalname !== 'voice-note.webm') return file;
  if (!ffmpegPath || !Buffer.isBuffer(file.buffer) || !file.buffer.length) throw new OperatorVoiceNormalizationError();
  const output = await new Promise((resolve, reject) => {
    const child = spawnImpl(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-vn', '-c:a', 'libmp3lame', '-b:a', '64k', '-f', 'mp3', 'pipe:1']);
    const chunks = []; let stderr = '';
    child.stdout.on('data', (chunk) => chunks.push(chunk));
    child.stderr.on('data', (chunk) => { stderr += String(chunk).slice(0, 256); });
    child.on('error', () => reject(new OperatorVoiceNormalizationError()));
    child.on('close', (code) => code === 0 && chunks.length ? resolve(Buffer.concat(chunks)) : reject(new OperatorVoiceNormalizationError()));
    child.stdin.end(file.buffer);
  });
  if (!isMpegAudio(output)) throw new OperatorVoiceNormalizationError();
  return { ...file, buffer: output, size: output.length, mimetype: 'audio/mpeg', originalname: 'voice-note.mp3' };
}
