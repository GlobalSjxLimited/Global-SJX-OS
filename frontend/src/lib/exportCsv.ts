import { saveBlob } from '@/lib/format';

/** Cells that start with = + - @ are prefixed so a spreadsheet never runs them as formulas. */
const cell = (v: unknown) => {
  let s = v === null || v === undefined ? '' : v instanceof Date ? v.toISOString() : typeof v === 'object' ? JSON.stringify(v) : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Download rows as a spreadsheet-ready CSV (opens correctly in Excel, with accents). */
export function exportCsv(filename: string, columns: Array<{ label: string; value: (row: any) => unknown }>, rows: any[]) {
  const body = [columns.map((c) => cell(c.label)).join(','), ...rows.map((r) => columns.map((c) => cell(c.value(r))).join(','))].join('\r\n');
  saveBlob(new Blob([`﻿${body}`], { type: 'text/csv;charset=utf-8' }), filename.endsWith('.csv') ? filename : `${filename}.csv`);
}
export const isoDate = (d: unknown) => (d ? new Date(d as any).toISOString().slice(0, 10) : '');
