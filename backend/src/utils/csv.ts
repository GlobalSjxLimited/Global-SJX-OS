/** CSV-injection-safe cell encoder: values that start with = + - @ are prefixed so spreadsheets never execute them. */
export function csvSafe(v: unknown): string {
  if (v === null || v === undefined) return '';
  let s = v instanceof Date ? v.toISOString() : typeof v === 'object' ? JSON.stringify(v) : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(columns: Array<{ key: string; label: string }>, rows: Array<Record<string, any>>): string {
  const head = columns.map((c) => csvSafe(c.label)).join(',');
  const body = rows.map((r) => columns.map((c) => csvSafe(r[c.key])).join(','));
  return `﻿${[head, ...body].join('\r\n')}`;
}
