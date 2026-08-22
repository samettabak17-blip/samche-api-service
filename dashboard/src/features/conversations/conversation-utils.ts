export function senderLabel(senderType: string): string {
  return ({ CUSTOMER: 'Customer', ASSISTANT: 'Assistant', AGENT: 'Agent', SYSTEM: 'System' } as Record<string, string>)[senderType] ?? 'Unknown sender';
}

export function senderTone(senderType: string): string {
  return ({ CUSTOMER: 'bg-white border-line text-ink', ASSISTANT: 'bg-signal-soft border-emerald-100 text-ink', AGENT: 'bg-indigo-50 border-indigo-100 text-indigo-950', SYSTEM: 'bg-stone-100 border-stone-200 text-stone-700' } as Record<string, string>)[senderType] ?? 'bg-stone-100 border-stone-200 text-stone-700';
}

