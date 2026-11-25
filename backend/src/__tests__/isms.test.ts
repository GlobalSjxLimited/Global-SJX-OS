import cron from 'node-cron';
import { REGISTERS, REGISTER_MAP } from '../config/isms';
import { COVERAGE } from '../config/ismsCoverage';
import { compute, riskClass, mapStatus, guardStatus, toDate, cleanData } from '../services/isms/records.service';
import { assetSheet, GENERATORS } from '../services/isms/generators';
import { RULES } from '../services/isms/automation';
import { DEFAULT_ROLE_MODULES } from '../config/modules';

describe('ISMS register catalogue', () => {
  it('every register has a title column, unique column keys, valid statuses and a due column that exists', () => {
    for (const r of REGISTERS) {
      const keys = r.cols.map((c) => c.key);
      expect(new Set(keys).size).toBe(keys.length);
      expect(keys).toContain(r.titleKey);
      if (r.dueKey) expect(keys).toContain(r.dueKey);
      expect(r.statuses).toContain(r.defaultStatus);
      for (const s of r.closedStatuses) expect(r.statuses).toContain(s);
      for (const c of r.cols) if (c.type === 'select') expect((c.options || []).length).toBeGreaterThan(0);
    }
  });
  it('every register has a generator and generator keys are unique', () => {
    const keys = GENERATORS.map((g) => g.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const r of REGISTERS) expect(keys).toContain(r.key);
  });
  it('automation rules have unique keys and valid cron expressions', () => {
    expect(new Set(RULES.map((r) => r.key)).size).toBe(RULES.length);
    for (const r of RULES) expect(cron.validate(r.cron)).toBe(true);
  });
  it('coverage matrix has no duplicate documents and every level is known', () => {
    expect(new Set(COVERAGE.map((c) => c.document)).size).toBe(COVERAGE.length);
    for (const c of COVERAGE) expect(['enforced', 'automated', 'recorded', 'manual']).toContain(c.level);
  });
});

describe('calculated columns', () => {
  it('uses the company risk matrix (1-4 Minor, 5-9 Moderate, 10+ Major)', () => {
    expect([riskClass(0), riskClass(4), riskClass(5), riskClass(9), riskClass(10), riskClass(25)]).toEqual(['', 'Minor', 'Moderate', 'Moderate', 'Major', 'Major']);
  });
  it('risk: impact is the highest of C/I/A and exposure is impact × likelihood', () => {
    const x = compute(REGISTER_MAP.risk, { cImpact: 3, iImpact: 5, aImpact: 2, likelihood: 4, rImpact: 2, rLikelihood: 2, frequency: 'Bi-annual', lastAssessment: new Date('2026-01-31') });
    expect(x.impact).toBe(5); expect(x.exposure).toBe(20); expect(x.classification).toBe('Major'); expect(x.rClassification).toBe('Minor');
    expect(new Date(x.nextAssessment).getUTCMonth()).toBeGreaterThanOrEqual(6);
  });
  it('metric: target met only when actual reaches target; blank until measured', () => {
    expect(compute(REGISTER_MAP.metric, { target: 0.9, actual: 0.95 }).targetMet).toBe('Yes');
    expect(compute(REGISTER_MAP.metric, { target: 0.9, actual: 0.5 }).targetMet).toBe('No');
    expect(compute(REGISTER_MAP.metric, { target: 0.9 }).targetMet).toBe('');
  });
  it('BYOD: any N fails, all Y/NA passes, blank is incomplete; review is 12 months after approval', () => {
    const base = { chkOs: 'Y', chkLock: 'Y', chkEnc: 'Y', chkAv: 'N/A', chkRoot: 'Y', chkMfa: 'Y' };
    expect(compute(REGISTER_MAP.byod, base).checks).toBe('PASS');
    expect(compute(REGISTER_MAP.byod, { ...base, chkEnc: 'N' }).checks).toBe('FAIL');
    expect(compute(REGISTER_MAP.byod, { ...base, chkMfa: '' }).checks).toBe('INCOMPLETE');
    expect(toDate(compute(REGISTER_MAP.byod, { ...base, approved: new Date('2026-03-10') }).nextReview)!.getUTCFullYear()).toBe(2027);
  });
});

describe('workflow guards', () => {
  const me = { id: 'u1', name: 'Joe' };
  it('CAR cannot close without root cause, verification, or an independent verifier', () => {
    const d: any = { responsible: 'Ada', nonConformity: 'x' };
    expect(guardStatus(REGISTER_MAP.car, d, 'Closed', me, {})).toMatch(/root cause/i);
    d.rootCause = 'r'; d.correctiveAction = 'a';
    expect(guardStatus(REGISTER_MAP.car, d, 'Closed', me, {})).toMatch(/effectiveness/i);
    d.verification = 'v'; expect(guardStatus(REGISTER_MAP.car, d, 'Closed', me, {})).toMatch(/Verified by/);
    d.verifiedBy = 'ada'; expect(guardStatus(REGISTER_MAP.car, d, 'Closed', me, {})).toMatch(/someone other/);
    d.verifiedBy = 'Joe'; expect(guardStatus(REGISTER_MAP.car, d, 'Closed', me, {})).toBeNull();
  });
  it('change: requester cannot approve; implemented needs approval; review needs reviewer and date', () => {
    expect(guardStatus(REGISTER_MAP.change, { signoffBy: 'CEO' }, 'Approved', me, { createdBy: { id: 'u1' }, status: 'Assessed' })).toMatch(/requested/);
    expect(guardStatus(REGISTER_MAP.change, { signoffBy: 'CEO' }, 'Approved', me, { createdBy: { id: 'u2' }, status: 'Assessed' })).toBeNull();
    expect(guardStatus(REGISTER_MAP.change, {}, 'Implemented', me, { status: 'Requested' })).toMatch(/approved/);
    expect(guardStatus(REGISTER_MAP.change, {}, 'Reviewed', me, { status: 'Implemented' })).toMatch(/Reviewed By/);
  });
  it('BYOD: approval needs PASS + signed agreement; removal needs verified wipe', () => {
    expect(guardStatus(REGISTER_MAP.byod, { checks: 'FAIL', agreement: 'Y' }, 'Approved', me, {})).toMatch(/FAIL/);
    expect(guardStatus(REGISTER_MAP.byod, { checks: 'PASS', agreement: 'N' }, 'Approved', me, {})).toMatch(/agreement/);
    expect(guardStatus(REGISTER_MAP.byod, { checks: 'PASS', agreement: 'Y' }, 'Approved', me, {})).toBeNull();
    expect(guardStatus(REGISTER_MAP.byod, {}, 'Removed', me, {})).toMatch(/removed/i);
  });
  it('rejects a status that does not belong to the register', () => {
    expect(guardStatus(REGISTER_MAP.car, {}, 'Approved', me, {})).toMatch(/not a status/);
  });
});

describe('importing company spreadsheets', () => {
  it('maps free-text statuses to register statuses', () => {
    expect(mapStatus(REGISTER_MAP.car, 'Closed')).toBe('Closed');
    expect(mapStatus(REGISTER_MAP.car, 'Ongoing')).toBe('In progress');
    expect(mapStatus(REGISTER_MAP.car, 'Delayed')).toBe('Overdue');
    expect(mapStatus(REGISTER_MAP.training, 'Done ')).toBe('Done');
    expect(mapStatus(REGISTER_MAP.training, 'Yet to be done')).toBe('Planned');
    expect(mapStatus(REGISTER_MAP.legal, 'Not Compliant')).toBe('Non-compliant');
    expect(mapStatus(REGISTER_MAP.legal, 'Valid')).toBe('Valid');
    expect(mapStatus(REGISTER_MAP.byod, 'Approved')).toBe('Approved');
  });
  it('reads Excel serials, dd/mm/yyyy and ISO dates', () => {
    expect(toDate('25/03/2022')!.toISOString().slice(0, 10)).toBe('2022-03-25');
    expect(toDate(45000)!.toISOString().slice(0, 10)).toBe('2023-03-15');
    expect(toDate('2026-11-05')!.toISOString().slice(0, 10)).toBe('2026-11-05');
    expect(toDate('n/a')).toBeUndefined();
  });
  it('strict mode rejects a value outside the list, lenient mode keeps it', () => {
    expect(() => cleanData(REGISTER_MAP.risk, { likelihood: '9' }, true)).toThrow();
    expect(cleanData(REGISTER_MAP.risk, { likelihood: '9' }, false).likelihood).toBe('9');
    expect(cleanData(REGISTER_MAP.risk, { exposure: 99 }, true).exposure).toBeUndefined(); // calculated columns cannot be typed
  });
});

describe('asset register placement', () => {
  it('puts each asset on the company sheet that matches it', () => {
    expect(assetSheet({ category: 'hardware', subCategory: 'Laptop' })).toBe('DesktopsLaptops');
    expect(assetSheet({ category: 'hardware', title: 'Dell PowerEdge server' })).toBe('Servers');
    expect(assetSheet({ category: 'hardware', subCategory: 'USB drive' })).toBe('Storage Media');
    expect(assetSheet({ category: 'hardware', title: 'HP LaserJet printer' })).toBe('Support Utilities');
    expect(assetSheet({ category: 'software', title: 'Google Chrome' })).toBe('Software');
    expect(assetSheet({ category: 'software', title: 'GitHub repository' })).toBe('Source Code');
    expect(assetSheet({ category: 'information', title: 'Customer database' })).toBe('Business Databases');
    expect(assetSheet({ category: 'network', title: 'Firewall' })).toBe('Network Devices');
    expect(assetSheet({ category: 'people', title: 'CEO' })).toBe('People Assets');
  });
});

describe('access to the hub', () => {
  it('only leadership roles hold the isms module by default', () => {
    for (const r of ['super_admin', 'ceo', 'coo']) expect(DEFAULT_ROLE_MODULES[r]).toContain('isms');
    for (const r of ['employee', 'engineer', 'hr', 'finance', 'sales', 'project_manager', 'client', 'vendor']) expect(DEFAULT_ROLE_MODULES[r]).not.toContain('isms');
  });
});
