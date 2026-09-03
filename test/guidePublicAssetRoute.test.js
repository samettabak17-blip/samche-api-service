import assert from 'node:assert/strict';
import test from 'node:test';
import { isSharedPublicGuideAssetPath } from '../services/guide-public-asset-route-service.js';

test('identifies only shared public Guide runtime assets as scope-independent', () => {
  assert.equal(isSharedPublicGuideAssetPath('/guide.js'), true);
  assert.equal(isSharedPublicGuideAssetPath('/guide.css'), true);
  assert.equal(isSharedPublicGuideAssetPath('/assets/tenant-logo'), false);
  assert.equal(isSharedPublicGuideAssetPath('/bootstrap'), false);
  assert.equal(isSharedPublicGuideAssetPath('/index.html'), false);
});
