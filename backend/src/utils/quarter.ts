/** Calendar quarters ("2026-Q4"), used by every module's quarter filter. UTC-based so servers in any zone agree. */
export interface Range { from: Date; to: Date }

export function quarterOf(d: Date = new Date()): string {
  return `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
}

/** Accepts "2026-Q4", "Q4 2026", "2026 Q4" (case-insensitive). Returns null when it is not a quarter. */
export function parseQuarter(q?: string | null): Range | null {
  if (!q) return null;
  const m = String(q).trim().match(/^(?:(\d{4})[\s-]*Q([1-4])|Q([1-4])[\s-]*(\d{4}))$/i);
  if (!m) return null;
  const year = Number(m[1] || m[4]);
  const quarter = Number(m[2] || m[3]);
  const from = new Date(Date.UTC(year, (quarter - 1) * 3, 1));
  const to = new Date(Date.UTC(year, quarter * 3, 1) - 1); // last millisecond of the quarter
  return { from, to };
}

export function normaliseQuarter(q?: string | null): string | undefined {
  const r = parseQuarter(q);
  if (!r) return undefined;
  return quarterOf(r.from);
}

/** Resolve ?quarter=2026-Q4 or ?from=&to= into a date range (quarter wins). */
export function rangeFromQuery(query: Record<string, any>): Range | null {
  const byQuarter = parseQuarter(query.quarter);
  if (byQuarter) return byQuarter;
  const from = query.from ? new Date(String(query.from)) : null;
  const to = query.to ? new Date(String(query.to)) : null;
  const okFrom = from && !isNaN(+from) ? from : null;
  const okTo = to && !isNaN(+to) ? new Date(+to + (String(query.to).length <= 10 ? 86399999 : 0)) : null;
  if (!okFrom && !okTo) return null;
  return { from: okFrom || new Date(0), to: okTo || new Date(8.64e15) };
}

/**
 * Mongo filter for "this item overlaps the range". An item with only a due date counts at that date;
 * an item with no dates at all falls back to its createdAt, so nothing silently disappears from a quarter view.
 */
export function overlapFilter(range: Range, fields: { start?: string; end?: string; due?: string } = {}): Record<string, unknown> {
  const start = fields.start || 'startDate';
  const end = fields.end || 'endDate';
  const due = fields.due || 'dueDate';
  const { from, to } = range;
  return {
    $or: [
      { [start]: { $lte: to }, [end]: { $gte: from } },
      { [start]: { $gte: from, $lte: to }, [end]: { $exists: false } },
      { [start]: { $exists: false }, [due]: { $gte: from, $lte: to } },
      { [start]: { $exists: false }, [end]: { $gte: from, $lte: to } },
      { [start]: { $exists: false }, [due]: { $exists: false }, [end]: { $exists: false }, createdAt: { $gte: from, $lte: to } },
    ],
  };
}

export function quarterOptions(count = 8, from: Date = new Date()): string[] {
  const out: string[] = [];
  let y = from.getUTCFullYear();
  let q = Math.floor(from.getUTCMonth() / 3) + 1 + 1; // start one quarter ahead
  if (q > 4) { q = 1; y += 1; }
  for (let i = 0; i < count; i++) {
    out.push(`${y}-Q${q}`);
    q -= 1;
    if (q < 1) { q = 4; y -= 1; }
  }
  return out;
}
