import { describe, expect, it } from 'vitest';
import { formatOverviewValue, overviewWorkspaceName } from './overview-page';

describe('Overview analytics presentation', () => {
  it('uses an honest empty state rather than fabricated performance values', () => {
    expect(formatOverviewValue(null, '%')).toBe('—');
    expect(formatOverviewValue(42, '%')).toBe('42%');
  });
  it('renders a safe workspace label while tenant context is resolving', () => {
    expect(overviewWorkspaceName(undefined)).toBe('your workspace');
    expect(overviewWorkspaceName('SamChe Company LLC')).toBe('SamChe Company LLC');
  });
});
