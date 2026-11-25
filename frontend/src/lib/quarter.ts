/** Quarter helpers — the API uses "YYYY-Qn" strings (calendar quarters). */
export function quarterOf(d: Date = new Date()): string {
  return `${d.getFullYear()}-Q${Math.floor(d.getMonth() / 3) + 1}`;
}

export function quarterLabel(q: string): string {
  const m = /^(\d{4})-Q([1-4])$/.exec(q);
  if (!m) return q;
  const names = ['Jan–Mar', 'Apr–Jun', 'Jul–Sep', 'Oct–Dec'];
  return `Q${m[2]} ${m[1]} (${names[Number(m[2]) - 1]})`;
}

/** The current quarter, a few past ones and the next two — newest first. */
export function quarterOptions(past = 7, future = 2): Array<{ value: string; label: string }> {
  const now = new Date();
  let y = now.getFullYear();
  let q = Math.floor(now.getMonth() / 3) + 1;
  for (let i = 0; i < future; i++) { q += 1; if (q > 4) { q = 1; y += 1; } }
  const out: Array<{ value: string; label: string }> = [];
  for (let i = 0; i < past + future + 1; i++) {
    const v = `${y}-Q${q}`;
    out.push({ value: v, label: quarterLabel(v) });
    q -= 1; if (q < 1) { q = 4; y -= 1; }
  }
  return out;
}
