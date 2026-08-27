import { type ReactNode } from 'react';
import { findSearchTokenRanges } from './conversation-search-utils';

const blocked = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'SVG', 'MATH', 'TEMPLATE']);
const allowed = new Set(['P', 'UL', 'OL', 'LI', 'B', 'STRONG', 'BR', 'A']);

function highlightedText(value: string, key: string, highlightTokens: string[]): ReactNode {
  const ranges = findSearchTokenRanges(value, highlightTokens);
  if (ranges.length === 0) return value;
  const nodes: ReactNode[] = [];
  let cursor = 0;
  ranges.forEach((range, index) => {
    if (cursor < range.start) nodes.push(value.slice(cursor, range.start));
    nodes.push(<mark key={key + '-match-' + index} className="rounded bg-amber-300/45 px-0.5 text-inherit">{value.slice(range.start, range.end)}</mark>);
    cursor = range.end;
  });
  if (cursor < value.length) nodes.push(value.slice(cursor));
  return nodes;
}

function renderNode(node: Node, key: string, highlightTokens: string[]): ReactNode {
  if (node.nodeType === Node.TEXT_NODE) return highlightedText(node.textContent ?? '', key, highlightTokens);
  if (node.nodeType !== Node.ELEMENT_NODE) return null;
  const element = node as HTMLElement;
  if (blocked.has(element.tagName)) return null;
  const children = Array.from(element.childNodes).map((child, index) => renderNode(child, `${key}-${index}`, highlightTokens));
  if (!allowed.has(element.tagName)) return <span key={key}>{children}</span>;
  if (element.tagName === 'BR') return <br key={key} />;
  if (element.tagName === 'A') {
    try {
      const url = new URL(element.getAttribute('href') || '', window.location.origin);
      if (url.protocol === 'http:' || url.protocol === 'https:') return <a key={key} href={url.href} target="_blank" rel="noreferrer" className="underline">{children}</a>;
    } catch { /* Unsafe URLs remain plain text. */ }
    return <span key={key}>{children}</span>;
  }
  const tag = element.tagName.toLowerCase();
  if (tag === 'p') return <p key={key} className="mb-2 last:mb-0">{children}</p>;
  if (tag === 'ul') return <ul key={key} className="list-disc space-y-1 pl-5">{children}</ul>;
  if (tag === 'ol') return <ol key={key} className="list-decimal space-y-1 pl-5">{children}</ol>;
  if (tag === 'li') return <li key={key}>{children}</li>;
  if (tag === 'strong' || tag === 'b') return <strong key={key}>{children}</strong>;
  return <span key={key}>{children}</span>;
}

export function SafeRichMessage({ content, highlightTokens = [] }: { content: string; highlightTokens?: string[] }) {
  const document = new DOMParser().parseFromString(content, 'text/html');
  return <>{Array.from(document.body.childNodes).map((node, index) => renderNode(node, String(index), highlightTokens))}</>;
}