import cron from 'node-cron';
import { THREAT_CATALOGUE } from '../config/threatCatalogue';
import { ANNEX_A } from '../config/annexA';
import { REGISTERS, REGISTER_MAP } from '../config/isms';
import { RULES } from '../services/isms/automation';
import { compute, guardStatus } from '../services/isms/records.service';
import { evaluate, AUTO_MIN_EXPOSURE } from '../services/assetRisk.service';
import { statusOf } from '../services/evidence.service';

const asset = (o: any = {}) => ({ _id: 'a1', assetId: 'GSJX/T/1', title: 'Test', category: 'hardware', lifecycleStatus: 'active', confidentiality: 'Medium', integrity: 'Medium', availability: 'Medium', ...o });

describe('threat catalogue', () => {
  it('has unique keys and complete text', () => {
    expect(new Set(THREAT_CATALOGUE.map((t) => t.key)).size).toBe(THREAT_CATALOGUE.length);
    expect(THREAT_CATALOGUE.length).toBeGreaterThanOrEqual(30);
    for (const t of THREAT_CATALOGUE) {
      expect(t.name.length).toBeGreaterThan(5); expect(t.vulnerability.length).toBeGreaterThan(5); expect(t.controls.length).toBeGreaterThan(5);
      expect(t.soa).toMatch(/A\.[5-8]\.\d+/);
    }
  });
  it('only names Annex A controls that exist', () => {
    const refs = new Set(ANNEX_A.map((a) => a.ref));
    for (const t of THREAT_CATALOGUE) for (const r of t.soa.match(/A\.[5-8]\.\d+/g) || []) expect(refs.has(r)).toBe(true);
  });
});

describe('asset exposure engine', () => {
  it('gives nothing for assets that are not in service', () => {
    for (const s of ['planned', 'retired', 'in_disposal', 'disposed']) expect(evaluate(asset({ lifecycleStatus: s }) as any)).toEqual([]);
  });
  it('scores exposure as impact x likelihood', () => {
    const rows = evaluate(asset({ category: 'information', confidentiality: 'High', integrity: 'High', availability: 'High', description: 'customer personal data' }) as any);
    expect(rows.length).toBeGreaterThan(3);
    for (const r of rows) { expect(r.exposure).toBe(r.impact * r.likelihood); expect(r.impact).toBeLessThanOrEqual(5); expect(r.likelihood).toBeLessThanOrEqual(5); }
    expect(rows.some((r) => /personal/i.test(r.name))).toBe(true);
  });
  it('rates High-CIA above Low-CIA', () => {
    const hi = evaluate(asset({ confidentiality: 'High', integrity: 'High', availability: 'High' }) as any);
    const lo = evaluate(asset({ confidentiality: 'Low', integrity: 'Low', availability: 'Low' }) as any);
    const max = (r: any[]) => Math.max(...r.map((x) => x.exposure));
    expect(max(hi)).toBeGreaterThan(max(lo));
  });
  it('uses live threat intelligence', () => {
    const a = asset({ category: 'software', title: 'Apache web server' }) as any;
    const base = evaluate(a); const live = evaluate(a, [{ reference: 'TI-1', title: 'Apache zero-day vulnerability', category: 'vulnerability', severity: 'high' }]);
    expect(live.some((r) => r.intel.length)).toBe(true);
    expect(Math.max(...live.map((r) => r.exposure))).toBeGreaterThanOrEqual(Math.max(...base.map((r) => r.exposure)));
    expect(AUTO_MIN_EXPOSURE).toBeGreaterThanOrEqual(1);
  });
});

describe('Annex A', () => {
  it('has all 93 controls in the 37/8/14/34 split', () => {
    expect(ANNEX_A).toHaveLength(93); expect(new Set(ANNEX_A.map((a) => a.ref)).size).toBe(93);
    const n = (t: string) => ANNEX_A.filter((a) => a.theme === t).length;
    expect([n('Organizational'), n('People'), n('Physical'), n('Technological')]).toEqual([37, 8, 14, 34]);
  });
  it('numbers each theme consecutively', () => {
    for (const [prefix, count] of [['A.5.', 37], ['A.6.', 8], ['A.7.', 14], ['A.8.', 34]] as const) {
      const nums = ANNEX_A.filter((a) => a.ref.startsWith(prefix)).map((a) => Number(a.ref.slice(prefix.length))).sort((a, b) => a - b);
      expect(nums).toEqual(Array.from({ length: count }, (_, i) => i + 1));
    }
  });
  it('gives every control a test and a retest cycle', () => { for (const a of ANNEX_A) { expect(a.test.length).toBeGreaterThan(10); expect([3, 6, 12]).toContain(a.months); } });
});

describe('new registers', () => {
  const keys = ['annex_a', 'retention', 'legal_hold', 'deletion', 'bia', 'backup', 'restore_test', 'capacity', 'baseline', 'log_review', 'maintenance'];
  it('are defined consistently', () => {
    for (const k of keys) {
      const d = REGISTER_MAP[k]; expect(d).toBeDefined();
      expect(d.cols.some((c) => c.key === d.titleKey)).toBe(true);
      if (d.dueKey) expect(d.cols.some((c) => c.key === d.dueKey && c.type === 'date')).toBe(true);
      expect(d.statuses).toContain(d.defaultStatus);
      for (const s of d.closedStatuses) expect(d.statuses).toContain(s);
    }
    expect(new Set(REGISTERS.map((r) => r.prefix)).size).toBe(REGISTERS.length);
    expect(new Set(REGISTERS.map((r) => r.key)).size).toBe(REGISTERS.length);
  });
  it('computes capacity state and restore-time compliance', () => {
    expect(compute(REGISTER_MAP.capacity, { usage: 90, threshold: 85 }).state).toBe('Breach');
    expect(compute(REGISTER_MAP.capacity, { usage: 70, threshold: 85 }).state).toBe('Watch');
    expect(compute(REGISTER_MAP.capacity, { usage: 20, threshold: 85 }).state).toBe('OK');
    expect(compute(REGISTER_MAP.restore_test, { hoursTaken: 3, rtoHours: 4 }).withinRto).toBe('Yes');
    expect(compute(REGISTER_MAP.restore_test, { hoursTaken: 5, rtoHours: 4 }).withinRto).toBe('No');
    expect(compute(REGISTER_MAP.restore_test, { hoursTaken: 5 }).withinRto).toBe('');
  });
  it('enforces separation of duties and justification', () => {
    const g = (k: string, d: any, next: string, rec: any = {}) => guardStatus(REGISTER_MAP[k], d, next, { name: 'x' }, rec);
    expect(g('deletion', { deletedBy: 'A', deletedOn: 'x', method: 'm', verifiedBy: 'a' }, 'Verified')).toMatch(/someone other/);
    expect(g('deletion', { deletedBy: 'A', deletedOn: 'x', method: 'm', verifiedBy: 'B' }, 'Verified')).toBeNull();
    expect(g('deletion', {}, 'Deleted', { status: 'Approved' })).toMatch(/who deleted/);
    expect(g('legal_hold', { releasedBy: 'Z', releaseReason: 'Settled in writing', placedBy: 'z' }, 'Released')).toMatch(/someone other/);
    expect(g('restore_test', { result: 'Pass', hoursTaken: 1, testedBy: 'T', verifiedBy: 't' }, 'Done')).toMatch(/someone other/);
    expect(g('annex_a', { justification: 'no' }, 'Not applicable')).toMatch(/justification/);
    expect(g('annex_a', { justification: 'Fully cloud hosted so not relevant' }, 'Not applicable')).toBeNull();
    expect(g('annex_a', { implementation: '' }, 'Implemented')).toMatch(/Describe how/);
  });
});

describe('automation rules and evidence', () => {
  it('registers the Phase 9 rules with valid cron expressions', () => {
    expect(new Set(RULES.map((r) => r.key)).size).toBe(RULES.length);
    for (const k of ['asset_risk_sweep', 'soa_sync', 'ops_cycle', 'evidence_watch']) { const r = RULES.find((x) => x.key === k)!; expect(r).toBeDefined(); expect(cron.validate(r.cron)).toBe(true); }
  });
  it('classifies evidence expiry', () => {
    const d = (n: number) => new Date(Date.now() + n * 86400000);
    expect(statusOf({})).toBe('current'); expect(statusOf({ validUntil: d(90) })).toBe('current'); expect(statusOf({ validUntil: d(10) })).toBe('expiring');
    expect(statusOf({ validUntil: d(-1) })).toBe('expired'); expect(statusOf({ validUntil: d(-1), supersededById: 'x' })).toBe('superseded');
  });
});
