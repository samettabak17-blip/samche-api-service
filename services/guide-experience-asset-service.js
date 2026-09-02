const MAX_GUIDE_EXPERIENCE_ASSET_BYTES = 5 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const RASTER_TYPES = Object.freeze({
  'image/png': { extension: 'png', matches: (buffer) => buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  'image/jpeg': { extension: 'jpg', matches: (buffer) => buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff },
  'image/webp': { extension: 'webp', matches: (buffer) => buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP' },
});

export class GuideExperienceAssetError extends Error {
  constructor(code, message = 'Guide branding asset is invalid.') {
    super(message);
    this.code = code;
  }
}

function normalizedMime(value) {
  return String(value ?? '').split(';', 1)[0].trim().toLowerCase();
}

export function validateGuideExperienceAssetUpload(file) {
  const buffer = file?.buffer;
  if (!Buffer.isBuffer(buffer)) throw new GuideExperienceAssetError('GUIDE_EXPERIENCE_ASSET_REQUIRED');
  const mimeType = normalizedMime(file?.mimetype);
  const definition = RASTER_TYPES[mimeType];
  if (!definition) throw new GuideExperienceAssetError('GUIDE_EXPERIENCE_ASSET_TYPE_UNSUPPORTED');
  const sizeBytes = Number(file?.size ?? buffer.length);
  if (!Number.isInteger(sizeBytes) || sizeBytes <= 0 || sizeBytes > MAX_GUIDE_EXPERIENCE_ASSET_BYTES || sizeBytes !== buffer.length) {
    throw new GuideExperienceAssetError('GUIDE_EXPERIENCE_ASSET_SIZE_INVALID');
  }
  if (!definition.matches(buffer)) throw new GuideExperienceAssetError('GUIDE_EXPERIENCE_ASSET_TYPE_MISMATCH');
  return { buffer, mimeType, extension: definition.extension, sizeBytes };
}

export function buildGuideExperienceAssetStorageKey({ tenantId, assistantId, assetId, extension = 'png' }) {
  if (![tenantId, assistantId, assetId].every((value) => UUID.test(String(value ?? ''))) || !/^(png|jpg|webp)$/.test(String(extension))) {
    throw new GuideExperienceAssetError('GUIDE_EXPERIENCE_ASSET_KEY_INVALID');
  }
  return `guide-experience/${tenantId}/${assistantId}/${assetId}.${extension}`;
}

export const GUIDE_EXPERIENCE_ASSET_LIMITS = Object.freeze({
  maxUploadBytes: MAX_GUIDE_EXPERIENCE_ASSET_BYTES,
  supportedMimeTypes: Object.freeze(Object.keys(RASTER_TYPES)),
});

export async function storeGuideExperienceAsset({ database, storage, tenantId, assistantId, actorUserId, file, kind }) {
  if (!['LOGO', 'AVATAR'].includes(String(kind))) throw new GuideExperienceAssetError('GUIDE_EXPERIENCE_ASSET_KIND_INVALID');
  if (!storage || typeof storage.put !== 'function') throw new GuideExperienceAssetError('GUIDE_EXPERIENCE_ASSET_STORAGE_UNAVAILABLE');
  const upload = validateGuideExperienceAssetUpload(file);
  const id = crypto.randomUUID();
  const storageKey = buildGuideExperienceAssetStorageKey({ tenantId, assistantId, assetId: id, extension: upload.extension });
  await storage.put({ key: storageKey, body: upload.buffer, mimeType: upload.mimeType });
  try {
    const result = await database.query(
      `INSERT INTO guide_experience_assets (id, tenant_id, assistant_id, asset_kind, storage_key, mime_type, size_bytes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id, asset_kind, mime_type, size_bytes, created_at`,
      [id, tenantId, assistantId, kind, storageKey, upload.mimeType, upload.sizeBytes, actorUserId ?? null],
    );
    await database.query(`INSERT INTO guide_experience_audit_events (tenant_id, assistant_id, actor_user_id, event_type, metadata) VALUES ($1,$2,$3,'ASSET_CHANGED',$4::jsonb)`, [tenantId, assistantId, actorUserId ?? null, JSON.stringify({ asset_kind: kind, asset_id: id })]);
    return result.rows[0];
  } catch (error) {
    await storage.remove?.({ key: storageKey }).catch(() => {});
    throw error;
  }
}

export async function getPublicGuideExperienceAsset({ database, assetId }) {
  const result = await database.query(
    `SELECT id, tenant_id, assistant_id, storage_key, mime_type, size_bytes
       FROM guide_experience_assets
      WHERE id=$1 AND status='ACTIVE'`,
    [assetId],
  );
  return result.rows[0] ?? null;
}
import crypto from 'node:crypto';
