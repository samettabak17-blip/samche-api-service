import { describe, expect, it } from 'vitest';
import { formatDate, formatDateTime } from './format';

describe('date formatting', () => {
  it('formats valid backend timestamps', () => {
    expect(formatDate('2026-08-22T02:55:30.000Z')).not.toBe('Not available');
    expect(formatDateTime('2026-08-22T02:55:30.000Z')).not.toBe('Not available');
  });

  it('uses an explicit unavailable state when the API has no timestamp', () => {
    expect(formatDate(undefined)).toBe('Not available');
    expect(formatDateTime(undefined)).toBe('Not available');
  });
});

