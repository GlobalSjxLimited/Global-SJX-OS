export const SYMBOL: Record<string, string> = { NGN: '₦', USD: '$', GBP: '£', EUR: '€' };
export function money(n: number | undefined | null, currency = 'NGN'): string {
  const v = Number(n || 0);
  return `${SYMBOL[currency] ?? currency + ' '}${v.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
export function fdate(d?: string | Date | null): string {
  return d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
}
export function fdatetime(d?: string | Date | null): string {
  return d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
}
export const toInputDate = (d?: string | Date | null) => (d ? new Date(d).toISOString().slice(0, 10) : '');
export const label = (s?: string) => (s ? s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) : '');
export function daysLeft(d?: string | Date | null): number | null {
  return d ? Math.ceil((new Date(d).getTime() - Date.now()) / 86400000) : null;
}
/** Triggers a download for a blob returned by the API (authenticated). */
export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
export function filenameFrom(disposition?: string, fallback = 'download'): string {
  const m = /filename="?([^";]+)"?/i.exec(disposition || '');
  return m ? m[1] : fallback;
}
