import { ChevronLeft, ChevronRight } from 'lucide-react';

interface PaginationProps {
  page: number;
  pages: number;
  total: number;
  onChange: (page: number) => void;
}

export function Pagination({ page, pages, total, onChange }: PaginationProps) {
  if (pages <= 1) return null;

  const nums: number[] = [];
  const start = Math.max(1, page - 2);
  const end = Math.min(pages, start + 4);
  for (let i = start; i <= end; i++) nums.push(i);

  return (
    <nav aria-label="Pagination" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 18, flexWrap: 'wrap', gap: 12 }}>
      <span style={{ fontSize: 12.5, color: 'var(--muted-2)' }}>{total} total</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <button className="icon-btn" style={{ width: 32, height: 32 }} disabled={page <= 1} onClick={() => onChange(page - 1)} aria-label="Previous page">
          <ChevronLeft size={15} />
        </button>
        {nums.map((n) => (
          <button
            key={n}
            onClick={() => onChange(n)}
            aria-current={n === page ? 'page' : undefined}
            className="btn-sm"
            style={{
              width: 32, height: 32, borderRadius: 8, border: '1px solid var(--line-strong)',
              background: n === page ? 'var(--accent)' : 'var(--surface)', color: n === page ? '#fff' : 'var(--text)',
              fontSize: 12.5, fontWeight: 600,
            }}
          >
            {n}
          </button>
        ))}
        <button className="icon-btn" style={{ width: 32, height: 32 }} disabled={page >= pages} onClick={() => onChange(page + 1)} aria-label="Next page">
          <ChevronRight size={15} />
        </button>
      </div>
    </nav>
  );
}
