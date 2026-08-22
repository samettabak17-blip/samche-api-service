import { describe, expect, it } from 'vitest';
import { canManageTenant } from './permissions';

describe('canManageTenant', () => {
  it('allows ADMIN mutations and keeps AGENT read-only', () => {
    expect(canManageTenant('ADMIN')).toBe(true);
    expect(canManageTenant('AGENT')).toBe(false);
  });

  it('does not grant mutations for an unknown role', () => {
    expect(canManageTenant(undefined)).toBe(false);
  });
});

