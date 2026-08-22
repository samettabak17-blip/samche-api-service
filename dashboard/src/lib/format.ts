function toDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export function formatDate(value: string | undefined): string {
  const date = toDate(value);
  return date ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date) : 'Not available';
}

export function formatDateTime(value: string | undefined): string {
  const date = toDate(value);
  return date ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date) : 'Not available';
}

