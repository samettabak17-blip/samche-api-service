import { describe, expect, it } from 'vitest';
import { formatOverviewValue } from './overview-page';

describe('Overview analytics presentation', () => {
  it('uses an honest empty state rather than fabricated performance values', () => {
    expect(formatOverviewValue(null, '%')).toBe('—');
    expect(formatOverviewValue(42, '%')).toBe('42%');
  });
});
