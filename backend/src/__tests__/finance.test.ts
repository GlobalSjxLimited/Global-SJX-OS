import { computeInvoice, round2 } from '../models/Finance';
import { computeExpenseClaim } from '../models/Expense';
import { encryptField, decryptField, blindIndex, last4, maskAccount, generatePassword } from '../utils/crypto';
import { toCsv, csvSafe } from '../utils/csv';
import { passwordProblems } from '../middleware/security';
import { REPORTS, REPORT_MAP, reportModules } from '../services/reports.service';
import { MODULE_KEYS } from '../config/modules';
import { amountInWords } from '../utils/words';
import { buildDoc, invoiceHtml } from '../services/invoiceDocument.service';
import { invoiceCreatedMail } from '../services/invoiceMail.service';
import { BUILTIN_CONTROLS } from '../services/controls.service';

describe('invoice maths', () => {
  it('NGN invoices keep 2 decimals; computes VAT, WHT, balance', () => {
    const inv: any = { items: [{ quantity: 2, unitFee: 1000 }, { quantity: 1, unitFee: 500.5 }], vatRate: 7.5, whtRate: 5, currency: 'NGN', exchangeRate: 1, payments: [{ amount: 1000, whtDeducted: 100 }] };
    computeInvoice(inv);
    expect(inv.subtotal).toBe(2500.5);
    expect(inv.vatAmount).toBe(187.54);
    expect(inv.whtAmount).toBe(125.03);
    expect(inv.total).toBe(2688.04);
    expect(inv.balance).toBe(1588.04);
  });
  it('foreign-currency invoices keep 3 decimals (legacy behaviour) and convert to NGN', () => {
    const inv: any = { items: [{ quantity: 120000, unitFee: 0.045 }, { quantity: 1, unitFee: 2500 }], vatRate: 7.5, whtRate: 5, currency: 'USD', exchangeRate: 1500, payments: [{ amount: 1000, whtDeducted: 100 }] };
    computeInvoice(inv);
    expect(inv.subtotal).toBe(7900);
    expect(inv.vatAmount).toBe(592.5);
    expect(inv.total).toBe(8492.5);
    expect(inv.totalNgn).toBe(round2(8492.5 * 1500));
    expect(inv.balance).toBe(7392.5);
    const odd: any = { items: [{ quantity: 3, unitFee: 0.045 }], vatRate: 7.5, whtRate: 0, currency: 'USD', exchangeRate: 1500, payments: [] };
    computeInvoice(odd);
    expect(odd.subtotal).toBe(0.135); // not rounded up to 0.14
  });
});

describe('amount in words', () => {
  it('spells out amounts with currency names', () => {
    expect(amountInWords(8492.5, 'USD')).toBe('Eight Thousand, Four Hundred and Ninety-Two United States Dollars and Fifty Cents Only');
    expect(amountInWords(100000, 'NGN')).toBe('One Hundred Thousand Naira Only');
    expect(amountInWords(0, 'GBP')).toBe('Zero Pounds Sterling Only');
  });
});

describe('expense claim maths', () => {
  const claim = (): any => ({
    status: 'submitted',
    items: [
      { amount: 1000, decision: 'pending', paymentMode: 'paid_personally', tax: { vatEnabled: true, vatRate: 7.5 } },
      { amount: 2000, decision: 'pending', paymentMode: 'awaiting_disbursement', tax: { whtEnabled: true, whtRate: 10 } },
      { amount: 500, decision: 'pending', paymentMode: 'company_paid', tax: {} },
      { quantity: 3, unitAmount: 100, amount: 0, decision: 'pending', paymentMode: 'paid_personally' },
    ],
  });
  it('splits totals by payment mode and nets WHT', () => {
    const c = claim(); computeExpenseClaim(c);
    expect(c.items[3].amount).toBe(300);
    expect(c.totals.total).toBe(1075 + 2000 + 500 + 300);
    expect(c.totals.reimbursable).toBe(1075 + 300);
    expect(c.totals.toDisburse).toBe(2000);
    expect(c.totals.companyPaid).toBe(500);
    expect(c.totals.wht).toBe(200);
    expect(c.totals.payable).toBe(1075 + 300 + 2000 - 200);
  });
  it('excludes rejected items once decided', () => {
    const c = claim(); c.status = 'approved';
    c.items[0].decision = 'approved'; c.items[1].decision = 'rejected'; c.items[2].decision = 'approved'; c.items[3].decision = 'rejected';
    computeExpenseClaim(c);
    expect(c.totals.approvedTotal).toBe(1075 + 500);
    expect(c.totals.toDisburse).toBe(0);
    expect(c.totals.payable).toBe(1075);
  });
});

describe('data protection helpers', () => {
  it('round-trips encrypted fields and never stores plaintext', () => {
    const enc = encryptField('0123456789')!;
    expect(enc).not.toContain('0123456789');
    expect(decryptField(enc)).toBe('0123456789');
    expect(encryptField('0123456789')).not.toBe(enc); // random IV
  });
  it('rejects tampered ciphertext', () => {
    const enc = encryptField('secret')!;
    const parts = enc.split('.');
    parts[parts.length - 1] = Buffer.from('tampered').toString('base64url');
    expect(decryptField(parts.join('.'))).toBe(''); // authentication fails -> never returns garbage
  });
  it('has a deterministic blind index and masks account numbers', () => {
    expect(blindIndex('123')).toBe(blindIndex('123'));
    expect(blindIndex('123')).not.toBe(blindIndex('124'));
    expect(last4('0123456789')).toBe('6789');
    expect(maskAccount('6789')).toContain('6789');
    expect(maskAccount('6789')).not.toContain('0123');
  });
  it('generates passwords that satisfy the policy', () => {
    for (let i = 0; i < 50; i++) expect(passwordProblems(generatePassword(16))).toEqual([]);
  });
  it('neutralises CSV formula injection', () => {
    expect(csvSafe('=HYPERLINK("http://x")')).toMatch(/^"?'=/);
    expect(csvSafe('+1')).toBe("'+1");
    expect(toCsv([{ key: 'a', label: 'A' }], [{ a: '@cmd' }])).toContain("'@cmd");
  });
});

describe('report catalogue', () => {
  it('has unique keys and only references real modules', () => {
    const keys = REPORTS.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.length).toBeGreaterThanOrEqual(30);
    for (const r of REPORTS) for (const m of reportModules(r)) expect(MODULE_KEYS).toContain(m);
    expect(REPORT_MAP.get('security_scorecard')).toBeDefined();
  });
});

describe('invoice document & e-mails', () => {
  const inv: any = { invoiceNo: 'INV-1', currency: 'USD', exchangeRate: 1500, includeNaira: true, invoiceType: 'Managed Services', issueDate: new Date(), dueDate: new Date(), vatRate: 7.5, whtRate: 0, status: 'approved', subtotal: 100, vatAmount: 7.5, total: 107.5, totalNgn: 161250, balance: 107.5,
    items: [{ group: 'A', description: '<script>alert(1)</script>', quantity: 1, unitFee: 100, amount: 100 }, { group: 'B', description: 'Hosting', quantity: 1, unitFee: 0, amount: 0 }], splitAmounts: [] };
  const client = { name: 'Evil <img src=x onerror=alert(1)>', contacts: [{ email: 'a@b.com' }] };
  it('escapes every dynamic value in the invoice HTML and in e-mails', () => {
    const html = invoiceHtml(buildDoc(inv, client, { accountName: 'GSJX', bankName: 'GT' }, '0123456789'), { fullDocument: true });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('Sub-Total – A');
    const mail = invoiceCreatedMail({ ...inv, _id: 'x' }, client, { audience: 'client' });
    expect(mail.html).not.toContain('<img src=x');
    expect(mail.html).toContain('#964FFE');
  });
});

describe('recurring controls catalogue', () => {
  it('ships the password rotations (90d) and a yearly risk assessment owned by the risk manager', () => {
    const by = Object.fromEntries(BUILTIN_CONTROLS.map((c) => [c.key, c]));
    for (const k of ['wifi_password', 'router_password', 'laptop_passwords']) { expect(by[k].frequencyDays).toBe(90); expect(by[k].ownerPref).toBe('it'); }
    expect(by.risk_assessment.frequencyDays).toBe(365);
    expect(by.risk_assessment.ownerPref).toBe('risk_manager');
    expect(new Set(BUILTIN_CONTROLS.map((c) => c.key)).size).toBe(BUILTIN_CONTROLS.length);
  });
});
