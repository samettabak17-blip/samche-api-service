import { describe, expect, it } from 'vitest';
import { canManageTenant, canPerformWebChatAction } from './permissions';

describe('canManageTenant', () => {
  it('allows ADMIN mutations and keeps AGENT read-only', () => {
    expect(canManageTenant('ADMIN')).toBe(true);
    expect(canManageTenant('AGENT')).toBe(false);
  });

  it('does not grant mutations for an unknown role', () => {
    expect(canManageTenant(undefined)).toBe(false);
  });
});

describe('canPerformWebChatAction', () => {
  it('grants Platform Super OWNER full access to all Web Chat actions', () => {
    const owner = { systemRole: 'OWNER', tenantRole: undefined };
    const actions = [
      'view',
      'configure',
      'manage_appearance',
      'manage_behavior',
      'manage_integration',
      'view_installation',
    ] as const;

    for (const action of actions) {
      expect(canPerformWebChatAction({ ...owner, action })).toBe(true);
    }
  });

  it('grants tenant ADMIN full access to all Web Chat actions on their tenant', () => {
    const tenantAdmin = { systemRole: 'CUSTOMER', tenantRole: 'ADMIN' as const };
    const actions = [
      'view',
      'configure',
      'manage_appearance',
      'manage_behavior',
      'manage_integration',
      'view_installation',
    ] as const;

    for (const action of actions) {
      expect(canPerformWebChatAction({ ...tenantAdmin, action })).toBe(true);
    }
  });

  it('restricts tenant AGENT to read-only Web Chat actions (view, view_installation)', () => {
    const agent = { systemRole: 'CUSTOMER', tenantRole: 'AGENT' as const };

    expect(canPerformWebChatAction({ ...agent, action: 'view' })).toBe(true);
    expect(canPerformWebChatAction({ ...agent, action: 'view_installation' })).toBe(true);

    expect(canPerformWebChatAction({ ...agent, action: 'configure' })).toBe(false);
    expect(canPerformWebChatAction({ ...agent, action: 'manage_appearance' })).toBe(false);
    expect(canPerformWebChatAction({ ...agent, action: 'manage_behavior' })).toBe(false);
    expect(canPerformWebChatAction({ ...agent, action: 'manage_integration' })).toBe(false);
  });

  it('rejects unknown system roles or undefined actor', () => {
    expect(canPerformWebChatAction({ systemRole: 'UNKNOWN', tenantRole: 'ADMIN', action: 'view' })).toBe(false);
    expect(canPerformWebChatAction({ systemRole: undefined, action: 'view' })).toBe(false);
  });
});

