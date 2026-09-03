const sharedPublicGuideAssets = new Set(['/guide.js', '/guide.css']);

export function isSharedPublicGuideAssetPath(pathname) {
  return sharedPublicGuideAssets.has(String(pathname ?? ''));
}
