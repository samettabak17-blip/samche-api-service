import crypto from 'node:crypto';
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
 * Extracts potential hex color palette from SVG or raster buffers
 */
export function extractColorCandidatesFromBuffer(buffer, mimeType) {
  const candidates = new Set();

  if (mimeType === 'image/svg+xml') {
    const text = buffer.toString('utf8');
    const hexMatches = text.match(/#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})\b/g) || [];
    for (const h of hexMatches) {
      candidates.add(h.toUpperCase());
    }

    const rgbMatches = text.matchAll(/rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)/gi);
    for (const match of rgbMatches) {
      const r = Math.min(255, parseInt(match[1], 10)).toString(16).padStart(2, '0');
      const g = Math.min(255, parseInt(match[2], 10)).toString(16).padStart(2, '0');
      const b = Math.min(255, parseInt(match[3], 10)).toString(16).padStart(2, '0');
      candidates.add(`#${r}${g}${b}`.toUpperCase());
    }
  } else {
    const step = Math.max(1, Math.floor(buffer.length / 2500));
    const counts = new Map();

    for (let i = 0; i < buffer.length - 3; i += step) {
      const r = buffer[i];
      const g = buffer[i + 1];
      const b = buffer[i + 2];

      const qr = r & 0xf0;
      const qg = g & 0xf0;
      const qb = b & 0xf0;

      const max = Math.max(qr, qg, qb);
      const min = Math.min(qr, qg, qb);
      const diff = max - min;
      if (diff > 25 && max > 30 && min < 240) {
        const hex = `#${qr.toString(16).padStart(2, '0')}${qg.toString(16).padStart(2, '0')}${qb.toString(16).padStart(2, '0')}`.toUpperCase();
        counts.set(hex, (counts.get(hex) || 0) + 1);
      }
    }

    const sorted = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([color]) => color);

    for (const c of sorted.slice(0, 5)) {
      candidates.add(c);
    }
  }

  const list = [...candidates];
  if (list.length === 0) {
    list.push('#2563EB');
  }
  return list;
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

  const candidates = extractColorCandidatesFromBuffer(upload.buffer, upload.mimeType);
  const derivedTheme = analyzeLogoPalette({ candidates, mode: 'dark' });

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
          JSON.stringify(candidates),
          actorUserId,
        ]
      );

      return {
        ...result.rows[0],
        public_url: publicUrl,
        palette: candidates,
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
    palette: candidates,
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

