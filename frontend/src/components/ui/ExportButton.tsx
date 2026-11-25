import { useState } from 'react';
import { Download } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { useToast } from '@/context/ToastContext';
import { exportCsv, isoDate } from '@/lib/exportCsv';

export interface ExportColumn { label: string; value: (row: any) => unknown }
/** Common "when and by whom" columns every export ends with. */
export const STAMP_COLUMNS: ExportColumn[] = [
  { label: 'Created', value: (r) => isoDate(r.createdAt) }, { label: 'Created by', value: (r) => r.createdBy?.name ?? r.createdBy ?? '' },
  { label: 'Modified', value: (r) => isoDate(r.updatedAt) }, { label: 'Modified by', value: (r) => r.updatedBy?.name ?? r.updatedBy ?? '' },
];

/** Downloads every row that matches the filters on screen (all pages, up to 5,000) as a spreadsheet. */
export function ExportButton({ endpoint, params, columns, filename, label = 'Export' }: { endpoint: string; params?: Record<string, any>; columns: ExportColumn[]; filename: string; label?: string }) {
  const { showError } = useToast();
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    try {
      const rows: any[] = []; let page = 1; let pages = 1;
      do {
        const r = await api.get(endpoint, { params: { ...(params || {}), page, limit: 100 } });
        rows.push(...(r.data.data || []));
        pages = r.data.pagination?.pages || 1; page += 1;
      } while (page <= pages && page <= 50);
      exportCsv(filename, [...columns, ...STAMP_COLUMNS], rows);
    } catch (e) { showError(apiErrorMessage(e)); } finally { setBusy(false); }
  }
  return <button className="btn btn-ghost" disabled={busy} onClick={go}><Download size={15} /> {busy ? 'Exporting…' : label}</button>;
}
