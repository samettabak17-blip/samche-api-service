import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { createGeminiImageKnowledgeExtractor } from '../services/image-knowledge-gemini-extractor.js';

const FONT = {
  A: ['01110','10001','10001','11111','10001','10001','10001'], B: ['11110','10001','10001','11110','10001','10001','11110'], C: ['01111','10000','10000','10000','10000','10000','01111'], D: ['11110','10001','10001','10001','10001','10001','11110'], E: ['11111','10000','10000','11110','10000','10000','11111'], F: ['11111','10000','10000','11110','10000','10000','10000'], G: ['01111','10000','10000','10111','10001','10001','01111'], H: ['10001','10001','10001','11111','10001','10001','10001'], I: ['11111','00100','00100','00100','00100','00100','11111'], J: ['00111','00010','00010','00010','10010','10010','01100'], K: ['10001','10010','10100','11000','10100','10010','10001'], L: ['10000','10000','10000','10000','10000','10000','11111'], M: ['10001','11011','10101','10101','10001','10001','10001'], N: ['10001','11001','10101','10011','10001','10001','10001'], O: ['01110','10001','10001','10001','10001','10001','01110'], P: ['11110','10001','10001','11110','10000','10000','10000'], Q: ['01110','10001','10001','10001','10101','10010','01101'], R: ['11110','10001','10001','11110','10100','10010','10001'], S: ['01111','10000','10000','01110','00001','00001','11110'], T: ['11111','00100','00100','00100','00100','00100','00100'], U: ['10001','10001','10001','10001','10001','10001','01110'], V: ['10001','10001','10001','10001','10001','01010','00100'], W: ['10001','10001','10001','10101','10101','10101','01010'], X: ['10001','10001','01010','00100','01010','10001','10001'], Y: ['10001','10001','01010','00100','00100','00100','00100'], Z: ['11111','00001','00010','00100','01000','10000','11111'], '?': ['01110','10001','00010','00100','00100','00000','00100'], ':': ['00000','00100','00000','00000','00100','00000','00000'], '.': ['00000','00000','00000','00000','00000','00100','00100'], ' ': ['00000','00000','00000','00000','00000','00000','00000'],
};

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

export function createSyntheticTextPng(lines) {
  const scale = 4; const padding = 16; const lineHeight = 9 * scale;
  const width = Math.max(...lines.map((line) => line.length)) * 6 * scale + padding * 2;
  const height = lines.length * lineHeight + padding * 2;
  const raw = Buffer.alloc((width * 3 + 1) * height, 255);
  for (let y = 0; y < height; y += 1) raw[y * (width * 3 + 1)] = 0;
  const pixel = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const offset = y * (width * 3 + 1) + 1 + x * 3;
    raw[offset] = 20; raw[offset + 1] = 20; raw[offset + 2] = 20;
  };
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    for (let index = 0; index < lines[lineIndex].length; index += 1) {
      const glyph = FONT[lines[lineIndex][index]] ?? FONT['?'];
      for (let gy = 0; gy < glyph.length; gy += 1) for (let gx = 0; gx < glyph[gy].length; gx += 1) if (glyph[gy][gx] === '1') for (let dy = 0; dy < scale; dy += 1) for (let dx = 0; dx < scale; dx += 1) pixel(padding + (index * 6 + gx) * scale + dx, padding + lineIndex * lineHeight + gy * scale + dy);
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

async function main() {
  const started = Date.now();
  let requestCount = 0;
  let httpStatus = null;
  try {
  if (!process.env.GEMINI_API_KEY) throw Object.assign(new Error('secret unavailable'), { code: 'SECRET_NOT_AVAILABLE' });
  const bytes = createSyntheticTextPng(['CUSTOMER:', 'DO YOU ORGANIZE OUTDOOR EVENTS?', 'BUSINESS:', 'YES. OUTDOOR EVENTS ARE AVAILABLE DURING THE COOLER MONTHS.', 'UNKNOWN:', 'FORWARDED MESSAGE']);
  const sourceHash = createHash('sha256').update(bytes).digest('hex');
  const extractor = createGeminiImageKnowledgeExtractor({
    env: process.env,
    fetchImpl: async (...args) => {
      requestCount += 1;
      const response = await fetch(...args);
      httpStatus = response.status;
      return response;
    },
  });
  const result = await extractor.extract({ bytes, mimeType: 'image/png', sourceHash });
    console.log(JSON.stringify({ request_count: requestCount, http_status: httpStatus, response_received: httpStatus !== null, canonical_validation: 'PASS', elapsed_ms: Date.now() - started, segment_count: result.segments.length, role_summary: [...new Set(result.segments.map((segment) => segment.role))], source_hash_preserved: result.sourceHash === sourceHash, mime_preserved: result.mimeType === 'image/png', extraction_method: result.extractionMethod, extraction_version: result.extractionVersion, classification: 'SUCCESS' }));
  } catch (error) {
    const classification = error?.code === 'SECRET_NOT_AVAILABLE' ? 'SECRET_NOT_AVAILABLE' : (error?.code || 'IMAGE_PROBE_FAILED');
    console.log(JSON.stringify({ request_count: requestCount, http_status: httpStatus, response_received: httpStatus !== null, canonical_validation: 'FAIL', elapsed_ms: Date.now() - started, classification }));
    process.exitCode = classification === 'SECRET_NOT_AVAILABLE' ? 2 : 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
