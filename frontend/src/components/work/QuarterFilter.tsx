import { quarterOptions } from '@/lib/quarter';

/** "All time" or a calendar quarter. `value` is '' for all time. */
export function QuarterFilter({ value, onChange, className = 'input' }: { value: string; onChange: (q: string) => void; className?: string }) {
  const opts = quarterOptions();
  // Keep a quarter selected from a deep link visible even if it is outside the default window.
  const has = !value || opts.some((o) => o.value === value);
  return (
    <select className={className} value={value} onChange={(e) => onChange(e.target.value)} aria-label="Filter by quarter">
      <option value="">All time</option>
      {!has && <option value={value}>{value}</option>}
      {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}
