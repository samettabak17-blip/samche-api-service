import { describe, expect, it } from 'vitest';
import { liveSupportBrowserTitle, shouldRunLiveSupportAlarm } from './live-support-attention-provider';

describe('global Live Support coordinator decisions', () => {
  it('runs one alarm only for unmuted, armed waiting attention', () => {
    expect(shouldRunLiveSupportAlarm({ requestedCount: 1, muted: false, audioArmed: true })).toBe(true);
    expect(shouldRunLiveSupportAlarm({ requestedCount: 0, muted: false, audioArmed: true })).toBe(false);
    expect(shouldRunLiveSupportAlarm({ requestedCount: 1, muted: true, audioArmed: true })).toBe(false);
  });

  it('keeps the global browser title tenant-safe and free of customer data', () => {
    expect(liveSupportBrowserTitle(2)).toBe('(2) LIVE SUPPORT — SamChe Dashboard');
    expect(liveSupportBrowserTitle(0)).toBe('SamChe Dashboard');
  });
});
