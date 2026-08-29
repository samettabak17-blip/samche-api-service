import { describe, expect, it } from 'vitest';
import { formatGrowth, formatOverviewValue, overviewInsightText, overviewRangeRequest, overviewWorkspaceName } from './overview-page';

describe('Overview analytics presentation', () => {
  it('uses an honest empty state rather than fabricated performance values', () => {
    expect(formatOverviewValue(null, '%')).toBe('—');
    expect(formatOverviewValue(42, '%')).toBe('42%');
  });
  it('uses deterministic real metric summaries and honest empty states', () => {
    expect(overviewInsightText({ best_channel: 'WHATSAPP', growth: 18, growth_status: 'AVAILABLE' })).toBe('WhatsApp Chatbot is currently your highest-volume channel. Activity increased 18% compared with the previous period.');
    expect(overviewInsightText({ best_channel: null, growth: null, growth_status: 'INSUFFICIENT_DATA' })).toBe('No activity yet. More data is needed for a period comparison.');
    expect(formatGrowth(null, 'INSUFFICIENT_DATA')).toBe('Insufficient data');
    expect(formatGrowth(0, 'AVAILABLE')).toBe('0%');
  });
  it('renders a safe workspace label while tenant context is resolving', () => {
    expect(overviewWorkspaceName(undefined)).toBe('your workspace');
    expect(overviewWorkspaceName('SamChe Company LLC')).toBe('SamChe Company LLC');
  });
});

it('turns a calendar preset into explicit server-side start and end dates', () => {
  expect(overviewRangeRequest('today', new Date('2026-08-26T12:00:00.000Z'))).toEqual({ startDate: '2026-08-26', endDate: '2026-08-26', label: 'Today' });
  expect(overviewRangeRequest('last-7-days', new Date('2026-08-26T12:00:00.000Z'))).toEqual({ startDate: '2026-08-20', endDate: '2026-08-26', label: 'Last 7 days' });
});
