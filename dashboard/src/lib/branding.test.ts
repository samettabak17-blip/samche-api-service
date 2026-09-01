import { beforeEach, describe, expect, it } from 'vitest';
import { setSamCheFavicon } from './branding';

describe('SamChe branding', () => {
  beforeEach(() => { document.head.innerHTML = '<link rel="icon" href="/samche-logo.png">'; });

  it('uses the canonical full SamChe logo for every app surface', () => {
    setSamCheFavicon('/assets/samche-company-llc-logo.png');
    const favicon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    expect(favicon?.href).toContain('/assets/samche-company-llc-logo.png');
    expect(favicon?.dataset.normalHref).toBe('/assets/samche-company-llc-logo.png');
  });
});
