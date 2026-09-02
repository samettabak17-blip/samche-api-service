import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GuideExperienceAssetError,
  buildGuideExperienceAssetStorageKey,
  validateGuideExperienceAssetUpload,
} from '../services/guide-experience-asset-service.js';

const scope = {
  tenantId: '212cf7a1-fd1e-493e-a25e-ccdce2897fc7',
  assistantId: '39fd2c12-49b9-4556-aa2a-e94c8471bb0a',
  assetId: '11111111-1111-4111-8111-111111111111',
};

test('Guide experience asset upload accepts only safe verified raster images', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
  const upload = validateGuideExperienceAssetUpload({ buffer: png, size: png.length, mimetype: 'image/png', originalname: 'brand.png' });
  assert.deepEqual(upload, { buffer: png, mimeType: 'image/png', extension: 'png', sizeBytes: png.length });
  assert.equal(buildGuideExperienceAssetStorageKey(scope), `guide-experience/${scope.tenantId}/${scope.assistantId}/${scope.assetId}.png`);
});

test('Guide experience asset upload rejects SVG, mismatched MIME and oversized files', () => {
  const svg = Buffer.from('<svg onload="alert(1)"></svg>');
  assert.throws(() => validateGuideExperienceAssetUpload({ buffer: svg, size: svg.length, mimetype: 'image/svg+xml' }), (error) => error instanceof GuideExperienceAssetError && error.code === 'GUIDE_EXPERIENCE_ASSET_TYPE_UNSUPPORTED');
  assert.throws(() => validateGuideExperienceAssetUpload({ buffer: svg, size: svg.length, mimetype: 'image/png' }), (error) => error instanceof GuideExperienceAssetError && error.code === 'GUIDE_EXPERIENCE_ASSET_TYPE_MISMATCH');
  const webp = Buffer.from('RIFF____WEBPVP8 ', 'ascii');
  assert.throws(() => validateGuideExperienceAssetUpload({ buffer: webp, size: 5 * 1024 * 1024 + 1, mimetype: 'image/webp' }), (error) => error instanceof GuideExperienceAssetError && error.code === 'GUIDE_EXPERIENCE_ASSET_SIZE_INVALID');
});
