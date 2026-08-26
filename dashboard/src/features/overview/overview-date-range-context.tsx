import { createContext, type ReactNode, useContext, useMemo, useState } from 'react';

export type OverviewRangePreset = 'today' | 'last-7-days' | 'last-30-days' | 'this-month' | 'custom';
export type OverviewDateRange = { startDate: string; endDate: string; label: string };

const toDateInput = (date: Date) => date.toISOString().slice(0, 10);

export function overviewRangeRequest(preset: Exclude<OverviewRangePreset, 'custom'>, now = new Date()): OverviewDateRange {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  let start = new Date(end);
  let label = 'Today';
  if (preset === 'last-7-days') { start.setUTCDate(start.getUTCDate() - 6); label = 'Last 7 days'; }
  if (preset === 'last-30-days') { start.setUTCDate(start.getUTCDate() - 29); label = 'Last 30 days'; }
  if (preset === 'this-month') { start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1)); label = 'This month'; }
  return { startDate: toDateInput(start), endDate: toDateInput(end), label };
}

type OverviewDateRangeState = {
  preset: OverviewRangePreset;
  setPreset: (preset: OverviewRangePreset) => void;
  customStart: string;
  setCustomStart: (value: string) => void;
  customEnd: string;
  setCustomEnd: (value: string) => void;
  activeRange: OverviewDateRange;
};

const Context = createContext<OverviewDateRangeState | null>(null);

export function OverviewDateRangeProvider({ children }: { children: ReactNode }) {
  const initial = overviewRangeRequest('last-7-days');
  const [preset, setPreset] = useState<OverviewRangePreset>('last-7-days');
  const [customStart, setCustomStart] = useState(initial.startDate);
  const [customEnd, setCustomEnd] = useState(initial.endDate);
  const activeRange = useMemo(
    () => preset === 'custom' ? { startDate: customStart, endDate: customEnd, label: 'Custom range' } : overviewRangeRequest(preset),
    [preset, customStart, customEnd],
  );
  return <Context.Provider value={{ preset, setPreset, customStart, setCustomStart, customEnd, setCustomEnd, activeRange }}>{children}</Context.Provider>;
}

export function useOverviewDateRange() {
  const value = useContext(Context);
  if (!value) throw new Error('OverviewDateRangeProvider is required');
  return value;
}
