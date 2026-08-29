import { describe, expect, it } from 'vitest';

const productionSources = import.meta.glob(['./**/*.ts', './**/*.tsx', '!./**/*.test.ts', '!./**/*.test.tsx'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

describe('English-only Dashboard product UI', () => {
  it('contains no known Turkish platform-control copy', () => {
    const forbidden = ['Dosya Seç', 'Seçilen dosya yok', 'Yükle', 'Gönder', 'Onayla', 'Reddet', 'Arşivle', 'İptal', 'Kaydet', 'Lütfen', 'Bir hata oluştu'];
    for (const [path, source] of Object.entries(productionSources)) {
      for (const phrase of forbidden) expect(source, `${phrase} found in ${path}`).not.toContain(phrase);
    }
  });

  it('keeps every native file input visually hidden behind application-controlled copy', () => {
    const fileInputs = Object.entries(productionSources).flatMap(([path, source]) => {
      return [...source.matchAll(/<input\b[\s\S]*?\/>/g)]
        .map((match) => match[0])
        .filter((markup) => /type="file"/.test(markup))
        .map((markup) => ({ path, markup }));
    });
    expect(fileInputs.length).toBeGreaterThan(0);
    for (const input of fileInputs) expect(input.markup, input.path).toMatch(/className="(?:hidden|sr-only)"/);
  });
});
