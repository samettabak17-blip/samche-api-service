import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { analyzeLogoPalette } from './web-chat-theme-service.js';

export const MAX_WEB_CHAT_ASSET_BYTES = 2 * 1024 * 1024; // 2 MB limit
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const SUPPORTED_MIME_TYPES = Object.freeze({
  'image/png': {
    extension: 'png',
    matches: (buffer) =>
      buffer.length >= 8 &&
      buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  'image/jpeg': {
    extension: 'jpg',
    matches: (buffer) =>
      buffer.length >= 3 &&
      buffer[0] === 0xff &&
      buffer[1] === 0xd8 &&
      buffer[2] === 0xff,
  },
  'image/webp': {
    extension: 'webp',
    matches: (buffer) =>
      buffer.length >= 12 &&
      buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buffer.subarray(8, 12).toString('ascii') === 'WEBP',
  },
  'image/svg+xml': {
    extension: 'svg',
    matches: (buffer) => {
      const text = buffer.toString('utf8').trim();
      return (
        (text.startsWith('<svg') || text.startsWith('<?xml') || text.includes('<svg')) &&
        text.includes('</svg>')
      );
    },
  },
});

export class WebChatAssetError extends Error {
  constructor(code, message = 'Web Chat branding asset is invalid.') {
    super(message);
    this.name = 'WebChatAssetError';
    this.code = code;
  }
}

function normalizeMime(value) {
  return String(value ?? '').split(';', 1)[0].trim().toLowerCase();
}

/**
 * Validates SVG content against XSS / script injection / dangerous vectors
 */
export function sanitizeSvgBuffer(buffer) {
  const content = buffer.toString('utf8');

  // Reject DOCTYPE / entity attacks
  if (/<!ENTITY/i.test(content) || /<!DOCTYPE[^>]*SYSTEM/i.test(content)) {
    throw new WebChatAssetError('WEB_CHAT_ASSET_SVG_UNSAFE', 'SVG contains unsafe entity declarations.');
  }

  // Reject script tags and dangerous HTML elements
  if (/<script/i.test(content) || /<iframe/i.test(content) || /<object/i.test(content) || /<embed/i.test(content)) {
    throw new WebChatAssetError('WEB_CHAT_ASSET_SVG_UNSAFE', 'SVG contains embedded executable elements.');
  }

  // Reject inline event handlers (onload, onerror, onclick, etc.)
  if (/\son[a-zA-Z]+\s*=/i.test(content)) {
    throw new WebChatAssetError('WEB_CHAT_ASSET_SVG_UNSAFE', 'SVG contains active event handlers.');
  }

  // Reject javascript: URLs in href or xlink:href
  if (/javascript\s*:/i.test(content)) {
    throw new WebChatAssetError('WEB_CHAT_ASSET_SVG_UNSAFE', 'SVG contains JavaScript URIs.');
  }

  return true;
}

/**
 * Validates uploaded branding file (size, MIME type, magic bytes, SVG sanitization)
 */
export function validateWebChatAssetUpload(file) {
  const buffer = file?.buffer;
  if (!Buffer.isBuffer(buffer)) {
    throw new WebChatAssetError('WEB_CHAT_ASSET_REQUIRED', 'An image file is required.');
  }

  const mimeType = normalizeMime(file?.mimetype);
  const definition = SUPPORTED_MIME_TYPES[mimeType];
  if (!definition) {
    throw new WebChatAssetError(
      'WEB_CHAT_ASSET_TYPE_UNSUPPORTED',
      'Supported formats: PNG, JPEG, WEBP, and SVG.'
    );
  }

  const sizeBytes = Number(file?.size ?? buffer.length);
  if (
    !Number.isInteger(sizeBytes) ||
    sizeBytes <= 0 ||
    sizeBytes > MAX_WEB_CHAT_ASSET_BYTES ||
    sizeBytes !== buffer.length
  ) {
    throw new WebChatAssetError(
      'WEB_CHAT_ASSET_SIZE_INVALID',
      `File size exceeds limit of ${MAX_WEB_CHAT_ASSET_BYTES / (1024 * 1024)}MB.`
    );
  }

  if (!definition.matches(buffer)) {
    throw new WebChatAssetError(
      'WEB_CHAT_ASSET_TYPE_MISMATCH',
      'File content does not match the provided MIME type.'
    );
  }

  if (mimeType === 'image/svg+xml') {
    sanitizeSvgBuffer(buffer);
  }

  return {
    buffer,
    mimeType,
    extension: definition.extension,
    sizeBytes,
  };
}

/**
 * Decodes uncompressed pixel colors directly from standard PNG buffers using node:zlib
 */
export function decodePngColors(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 33) return null;
  if (!buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return null;
  }

  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  const bitDepth = buffer[24];
  const colorType = buffer[25];

  if (width === 0 || height === 0 || bitDepth !== 8) return null;

  let plte = null;
  const idatBuffers = [];
  let offset = 8;
  while (offset < buffer.length - 8) {
    const len = buffer.readUInt32BE(offset);
    if (offset + 8 + len > buffer.length) break;
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
    if (type === 'PLTE') {
      plte = buffer.subarray(offset + 8, offset + 8 + len);
    } else if (type === 'IDAT') {
      idatBuffers.push(buffer.subarray(offset + 8, offset + 8 + len));
    }
    offset += 8 + len + 4;
  }

  if (idatBuffers.length === 0) return null;

  let decompressed;
  try {
    decompressed = zlib.inflateSync(Buffer.concat(idatBuffers));
  } catch {
    return null;
  }

  let bytesPerPixel = 0;
  if (colorType === 2) bytesPerPixel = 3; // RGB
  else if (colorType === 6) bytesPerPixel = 4; // RGBA
  else if (colorType === 3) bytesPerPixel = 1; // Indexed
  else if (colorType === 0) bytesPerPixel = 1; // Grayscale
  else if (colorType === 4) bytesPerPixel = 2; // Grayscale + Alpha
  else return null;

  const stride = width * bytesPerPixel;
  if (width * height > 4096 * 4096) return null;
  const rawData = Buffer.alloc(width * height * bytesPerPixel);
  let srcOffset = 0;
  let dstOffset = 0;

  for (let y = 0; y < height; y++) {
    if (srcOffset >= decompressed.length) break;
    const filter = decompressed[srcOffset++];
    for (let x = 0; x < stride; x++) {
      let val = decompressed[srcOffset++];
      const a = x >= bytesPerPixel ? rawData[dstOffset - bytesPerPixel] : 0;
      const b = y > 0 ? rawData[dstOffset - stride] : 0;
      const c = (x >= bytesPerPixel && y > 0) ? rawData[dstOffset - stride - bytesPerPixel] : 0;

      if (filter === 1) val = (val + a) & 0xff;
      else if (filter === 2) val = (val + b) & 0xff;
      else if (filter === 3) val = (val + Math.floor((a + b) / 2)) & 0xff;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        const pr = (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
        val = (val + pr) & 0xff;
      }
      rawData[dstOffset++] = val;
    }
  }

  const hexCounts = new Map();

  if (colorType === 6) { // RGBA
    for (let i = 0; i < rawData.length; i += 4) {
      const alpha = rawData[i + 3];
      if (alpha < 64) continue; // skip transparent pixel
      const r = (rawData[i] >> 3) << 3;
      const g = (rawData[i + 1] >> 3) << 3;
      const b = (rawData[i + 2] >> 3) << 3;
      const hex = '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
      hexCounts.set(hex, (hexCounts.get(hex) || 0) + 1);
    }
  } else if (colorType === 2) { // RGB
    for (let i = 0; i < rawData.length; i += 3) {
      const r = (rawData[i] >> 3) << 3;
      const g = (rawData[i + 1] >> 3) << 3;
      const b = (rawData[i + 2] >> 3) << 3;
      const hex = '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
      hexCounts.set(hex, (hexCounts.get(hex) || 0) + 1);
    }
  } else if (colorType === 3 && plte) { // Indexed
    for (let i = 0; i < rawData.length; i++) {
      const idx = rawData[i];
      if (idx * 3 + 2 < plte.length) {
        const r = (plte[idx * 3] >> 3) << 3;
        const g = (plte[idx * 3 + 1] >> 3) << 3;
        const b = (plte[idx * 3 + 2] >> 3) << 3;
        const hex = '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
        hexCounts.set(hex, (hexCounts.get(hex) || 0) + 1);
      }
    }
  }

  return hexCounts;
}


/**
 * Extracts normalized color candidate palette from real image buffers.
 * For PNG: Decodes actual uncompressed scanline pixels.
 * For SVG: Parses XML color styling.
 * For unsupported/failed raster decoding: returns explicit safe fallback state.
 */
export function extractColorCandidatesFromBuffer(buffer, mimeType) {
  const candidates = new Set();
  let dominant = null;
  let isFallback = false;

  if (mimeType === 'image/svg+xml') {
    const text = buffer.toString('utf8');
    const hexMatches = text.match(/#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})\b/g) || [];
    for (const h of hexMatches) {
      const normalized = h.length === 4
        ? `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}`.toUpperCase()
        : h.toUpperCase();
      candidates.add(normalized);
    }

    const rgbMatches = text.matchAll(/rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/gi);
    for (const match of rgbMatches) {
      const r = Math.min(255, parseInt(match[1], 10)).toString(16).padStart(2, '0');
      const g = Math.min(255, parseInt(match[2], 10)).toString(16).padStart(2, '0');
      const b = Math.min(255, parseInt(match[3], 10)).toString(16).padStart(2, '0');
      candidates.add(`#${r}${g}${b}`.toUpperCase());
    }

    const list = [...candidates];
    dominant = list[0] || null;
    if (list.length === 0) {
      isFallback = true;
    }
  } else if (mimeType === 'image/png') {
    const hexCounts = decodePngColors(buffer);
    if (hexCounts && hexCounts.size > 0) {
      const sorted = [...hexCounts.entries()].sort((a, b) => b[1] - a[1]);
      dominant = sorted[0]?.[0] || null;
      for (const [hex] of sorted.slice(0, 8)) {
        candidates.add(hex);
      }
    } else {
      isFallback = true;
    }
  } else {
    // For JPEG / WEBP without native image decoding libraries,
    // do NOT pretend random byte stream values are valid colors.
    // Return an explicit safe fallback state with WCAG compliant defaults.
    isFallback = true;
  }

  let candidateList = [...candidates];
  if (candidateList.length === 0) {
    candidateList = ['#2563EB', '#3B82F6'];
    isFallback = true;
  }

  return {
    candidates: candidateList,
    dominant: dominant || candidateList[0] || '#2563EB',
    isFallback,
  };
}

export function buildWebChatAssetStorageKey({ tenantId, assetId, extension = 'png' }) {
  if (!UUID_REGEX.test(String(tenantId ?? '')) || !UUID_REGEX.test(String(assetId ?? ''))) {
    throw new WebChatAssetError('WEB_CHAT_ASSET_KEY_INVALID', 'Invalid tenant or asset identifier.');
  }
  return `web-chat/${tenantId}/logo-${assetId}.${extension}`;
}

export async function storeWebChatAsset({

  database,
  storage,
  tenantId,
  actorUserId = null,
  file,
  kind = 'LOGO',
}) {
  if (!['LOGO', 'ICON', 'AVATAR'].includes(String(kind))) {
    throw new WebChatAssetError('WEB_CHAT_ASSET_KIND_INVALID', 'Asset kind must be LOGO, ICON, or AVATAR.');
  }

  const upload = validateWebChatAssetUpload(file);
  const assetId = crypto.randomUUID();
  const storageKey = buildWebChatAssetStorageKey({
    tenantId,
    assetId,
    extension: upload.extension,
  });

  const extraction = extractColorCandidatesFromBuffer(upload.buffer, upload.mimeType);
  const derivedTheme = analyzeLogoPalette({ candidates: extraction.candidates, mode: 'dark' });

  const normalizedPalette = {
    dominant: extraction.dominant,
    primary: derivedTheme.primary,
    accent: derivedTheme.accent,
    candidates: extraction.candidates,
    is_fallback: extraction.isFallback,
  };

  if (storage && typeof storage.put === 'function') {
    await storage.put({
      key: storageKey,
      body: upload.buffer,
      mimeType: upload.mimeType,
    });
  }

  const publicUrl = `/api/v1/public/web-chat/assets/${assetId}`;

  if (database && typeof database.query === 'function') {
    try {
      const result = await database.query(
        `INSERT INTO tenant_web_chat_assets (
          id, tenant_id, asset_kind, storage_key, mime_type, size_bytes, extracted_palette, created_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
        RETURNING id, tenant_id, asset_kind, storage_key, mime_type, size_bytes, extracted_palette, created_at`,
        [
          assetId,
          tenantId,
          kind,
          storageKey,
          upload.mimeType,
          upload.sizeBytes,
          JSON.stringify(normalizedPalette),
          actorUserId,
        ]
      );

      return {
        ...result.rows[0],
        public_url: publicUrl,
        palette: normalizedPalette,
        theme: derivedTheme,
      };
    } catch (dbError) {
      if (storage && typeof storage.remove === 'function') {
        await storage.remove({ key: storageKey }).catch(() => {});
      }
      throw dbError;
    }
  }

  return {
    id: assetId,
    tenant_id: tenantId,
    asset_kind: kind,
    storage_key: storageKey,
    mime_type: upload.mimeType,
    size_bytes: upload.sizeBytes,
    public_url: publicUrl,
    palette: normalizedPalette,
    theme: derivedTheme,
    created_at: new Date().toISOString(),
  };
}

export async function getPublicWebChatAsset({ database, assetId, tenantId = null }) {
  if (!UUID_REGEX.test(String(assetId ?? ''))) return null;

  if (database && typeof database.query === 'function') {
    const query = tenantId
      ? `SELECT id, tenant_id, asset_kind, storage_key, mime_type, size_bytes, status FROM tenant_web_chat_assets WHERE id = $1 AND tenant_id = $2 AND status = 'ACTIVE'`
      : `SELECT id, tenant_id, asset_kind, storage_key, mime_type, size_bytes, status FROM tenant_web_chat_assets WHERE id = $1 AND status = 'ACTIVE'`;
    const params = tenantId ? [assetId, tenantId] : [assetId];

    const result = await database.query(query, params);
    return result.rows[0] ?? null;
  }

  return null;
}

export async function deleteWebChatAsset({ database, storage, tenantId, assetId }) {
  if (!UUID_REGEX.test(String(tenantId ?? '')) || !UUID_REGEX.test(String(assetId ?? ''))) {
    throw new WebChatAssetError('WEB_CHAT_ASSET_ID_INVALID', 'Invalid tenant or asset identifier.');
  }

  if (database && typeof database.query === 'function') {
    const existing = await database.query(
      `SELECT storage_key FROM tenant_web_chat_assets WHERE id = $1 AND tenant_id = $2 AND status = 'ACTIVE'`,
      [assetId, tenantId]
    );

    if (existing.rowCount > 0) {
      const storageKey = existing.rows[0].storage_key;
      await database.query(
        `UPDATE tenant_web_chat_assets SET status = 'DELETED', deleted_at = NOW() WHERE id = $1 AND tenant_id = $2`,
        [assetId, tenantId]
      );

      if (storage && typeof storage.remove === 'function' && storageKey) {
        await storage.remove({ key: storageKey }).catch(() => {});
      }
      return true;
    }
  }

  return false;
}

