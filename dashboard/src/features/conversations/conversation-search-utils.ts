export type SearchableMessage = { content?: string | null; resourceNames?: string[] };
export type SearchRange = { start: number; end: number };

function canonical(value: string): string {
  return value.toLocaleLowerCase('tr-TR').replaceAll('ı', 'i');
}

export function normalizeSearchTokens(query: string): string[] {
  return [...new Set(canonical(query).trim().split(/\s+/u).filter(Boolean))];
}

export function messageMatchesSearch(message: SearchableMessage, tokens: string[]): boolean {
  if (tokens.length === 0) return false;
  const haystack = canonical([message.content, ...(message.resourceNames ?? [])].filter(Boolean).join(' '));
  return tokens.every((token) => haystack.includes(token));
}

export function findSearchTokenRanges(value: string, tokens: string[]): SearchRange[] {
  const haystack = canonical(value);
  const ranges: SearchRange[] = [];
  for (const token of tokens) {
    let offset = 0;
    while (offset < haystack.length) {
      const start = haystack.indexOf(token, offset);
      if (start < 0) break;
      ranges.push({ start, end: start + token.length });
      offset = start + token.length;
    }
  }
  return ranges.sort((left, right) => left.start - right.start || right.end - left.end).reduce<SearchRange[]>((merged, range) => {
    const previous = merged.at(-1);
    if (!previous || range.start >= previous.end) merged.push(range);
    else if (range.end > previous.end) previous.end = range.end;
    return merged;
  }, []);
}

export function nextSearchMatchIndex(currentIndex: number, count: number, direction: 'next' | 'previous'): number {
  if (count <= 0) return 0;
  return direction === 'next' ? (currentIndex + 1) % count : (currentIndex - 1 + count) % count;
}
