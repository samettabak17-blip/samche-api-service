import { beforeEach, describe, expect, it } from 'vitest';
import { resolveWebChatAssetUrl, setSamCheFavicon } from './branding';

describe('SamChe branding', () => {
  beforeEach(() => { document.head.innerHTML = '<link rel="icon" href="/samche-logo.png">'; });

  it('uses the canonical full SamChe logo for every app surface', () => {
    setSamCheFavicon('/assets/samche-company-llc-logo.png');
    const favicon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    expect(favicon?.href).toContain('/assets/samche-company-llc-logo.png');
    expect(favicon?.dataset.normalHref).toBe('/assets/samche-company-llc-logo.png');
  });

  it('resolves relative branding asset URLs against configured API base URL', () => {
    const apiBase = 'https://api.example.com';
    expect(resolveWebChatAssetUrl('/api/v1/public/web-chat/assets/logo-123', apiBase))
      .toBe('https://api.example.com/api/v1/public/web-chat/assets/logo-123');
    expect(resolveWebChatAssetUrl('/api/v1/public/web-chat/wch_123/logo', apiBase))
      .toBe('https://api.example.com/api/v1/public/web-chat/wch_123/logo');
  });

  it('preserves external absolute URLs, data URIs, and empty inputs', () => {
    expect(resolveWebChatAssetUrl('https://cdn.example.com/logo.png'))
      .toBe('https://cdn.example.com/logo.png');
    expect(resolveWebChatAssetUrl('http://cdn.example.com/logo.png'))
      .toBe('http://cdn.example.com/logo.png');
    expect(resolveWebChatAssetUrl('data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=='))
      .toBe('data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==');
    expect(resolveWebChatAssetUrl(null)).toBe('');
    expect(resolveWebChatAssetUrl(undefined)).toBe('');
    expect(resolveWebChatAssetUrl('')).toBe('');
  });
});

