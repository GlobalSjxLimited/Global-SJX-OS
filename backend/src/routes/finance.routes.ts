import { Router } from 'express';
import mongoose from 'mongoose';
import { requireAuth } from '../middleware/auth';
import { requireModule, hasModule } from '../middleware/modules';
import { asyncHandler } from '../utils/asyncHandler';
import { ApiError } from '../utils/ApiError';
import { BankAccount, ExchangeRate, TaxRate, TaxRecord, ServiceItem, Invoice, computeInvoice, round2, CURRENCIES, INVOICE_TYPES } from '../models/Finance';
import { Client } from '../models/Client';
import { User } from '../models/User';
import { nextNumber } from '../models/Access';
import { encryptField, decryptField, blindIndex, last4, maskAccount } from '../utils/crypto';
import { audit } from '../services/audit.service';
import { verifyOrgUpload } from '../services/fileCheck';
import { ExpenseClaim } from '../models/Expense';
import { notify } from '../services/notify.service';
import { usersWithModule } from '../services/access.service';
import { sendMail } from '../services/email.service';
import { renderEmail, kvTable, callout, esc, money, fmtDate } from '../services/mail.templates';
import { invoicePdf } from '../services/pdf.service';
import { buildDoc, invoiceHtml } from '../services/invoiceDocument.service';
import { invoiceCreatedMail, invoiceUpdatedMail, invoiceStatusMail, paymentAckMail, invoiceChaseMail } from '../services/invoiceMail.service';
import { amountInWords } from '../utils/words';
import { toCsv } from '../utils/csv';
import { excludeDeleted } from '../utils/softDeletePlugin';
import { env } from '../config/env';

const num = (v: any, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const oid = (s: string) => new mongoose.Types.ObjectId(s);
const pick = (o: any, keys: string[]) => Object.fromEntries(keys.filter((k) => o?.[k] !== undefined).map((k) => [k, o[k]]));

/* =============================== Bank accounts ============================== */
export const bankAccountsRouter = Router();
bankAccountsRouter.use(requireAuth);

const maskBank = (a: any) => ({ ...(a.toObject?.() || a), accountNumberEnc: undefined, accountNumberHash: undefined, accountMasked: maskAccount(a.accountLast4) });

bankAccountsRouter.get('/', requireModule('bank_accounts', 'invoices'), asyncHandler(async (req, res) => {
  const rows = await BankAccount.find(excludeDeleted({ organizationId: req.user!.organizationId })).sort('bankName');
  res.json({ success: true, data: rows.map(maskBank) });
}));

bankAccountsRouter.post('/', requireModule('bank_accounts'), asyncHandler(async (req, res) => {
  const b = req.body || {};
  if (!b.bankName || !b.accountName || !b.accountNumber) throw ApiError.badRequest('Bank name, account name and account number are required.');
  const digits = String(b.accountNumber).replace(/\s+/g, '');
  if (!/^[A-Za-z0-9]{6,34}$/.test(digits)) throw ApiError.badRequest('Account number looks invalid.');
  const hash = blindIndex(digits);
  if (await BankAccount.findOne(excludeDeleted({ organizationId: req.user!.organizationId, accountNumberHash: hash }))) throw ApiError.conflict('This account number is already registered.');
  const acc = await BankAccount.create({
    organizationId: req.user!.organizationId, bankName: b.bankName, accountName: b.accountName,
    accountNumberEnc: encryptField(digits), accountNumberHash: hash, accountLast4: last4(digits),
    ...pick(b, ['accountType', 'currency', 'purpose', 'sortCode', 'swiftCode']),
    status: 'pending', createdById: req.user!.id,
  });
  await audit(req, 'bank_account.created', 'BankAccount', String(acc._id), { module: 'bank_accounts', severity: 'high', summary: `Bank account ${acc.bankName} ••••${acc.accountLast4} added (pending approval)` });
  const approvers = (await usersWithModule(req.user!.organizationId, 'bank_accounts')).filter((u) => String(u._id) !== req.user!.id);
  await notify({ organizationId: req.user!.organizationId, userIds: approvers.map((u) => String(u._id)), title: 'Bank account awaiting approval', body: `${acc.bankName} ••••${acc.accountLast4} added by ${req.user!.name}. A second person must approve it before it can be used on invoices.`, link: '/accounts', type: 'finance', severity: 'warning' });
  res.status(201).json({ success: true, data: maskBank(acc) });
}));

bankAccountsRouter.post('/:id/approve', requireModule('bank_accounts'), asyncHandler(async (req, res) => {
  const acc = await BankAccount.findOne(excludeDeleted({ _id: req.params.id, organizationId: req.user!.organizationId }));
  if (!acc) throw ApiError.notFound('Account not found');
  if (acc.status !== 'pending') throw ApiError.conflict('This account is not pending.');
  if (env.fourEyes && String(acc.createdById) === req.user!.id) throw ApiError.forbidden('Four-eyes control: someone other than the creator must approve this account.');
  acc.status = 'active'; acc.approvedById = req.user!.id as any; acc.approvedAt = new Date();
  await acc.save();
  await audit(req, 'bank_account.approved', 'BankAccount', String(acc._id), { module: 'bank_accounts', severity: 'high', summary: `Bank account ••••${acc.accountLast4} approved` });
  res.json({ success: true, data: maskBank(acc) });
}));

bankAccountsRouter.patch('/:id', requireModule('bank_accounts'), asyncHandler(async (req, res) => {
  const acc = await BankAccount.findOne(excludeDeleted({ _id: req.params.id, organizationId: req.user!.organizationId }));
  if (!acc) throw ApiError.notFound('Account not found');
  const b = req.body || {};
  const changedNumber = !!b.accountNumber;
  Object.assign(acc, pick(b, ['bankName', 'accountName', 'accountType', 'currency', 'purpose', 'sortCode', 'swiftCode']));
  if (changedNumber) {
    const digits = String(b.accountNumber).replace(/\s+/g, '');
    if (!/^[A-Za-z0-9]{6,34}$/.test(digits)) throw ApiError.badRequest('Account number looks invalid.');
    acc.accountNumberEnc = encryptField(digits) as string; acc.accountNumberHash = blindIndex(digits); acc.accountLast4 = last4(digits);
    acc.status = 'pending'; acc.approvedById = undefined; acc.approvedAt = undefined; acc.createdById = req.user!.id as any; // changing the number needs fresh approval
  }
  if (b.status && ['active', 'inactive'].includes(b.status) && !changedNumber) {
    if (b.status === 'inactive') acc.inactiveReason = String(b.inactiveReason || 'Deactivated').slice(0, 200);
    if (b.status === 'active' && acc.status === 'pending') throw ApiError.badRequest('Use the approve action for pending accounts.');
    acc.status = b.status;
  }
  await acc.save();
  await audit(req, 'bank_account.updated', 'BankAccount', String(acc._id), { module: 'bank_accounts', severity: changedNumber ? 'critical' : 'high', summary: `Bank account ••••${acc.accountLast4} updated${changedNumber ? ' (account number changed — re-approval required)' : ''}` });
  res.json({ success: true, data: maskBank(acc) });
}));

bankAccountsRouter.post('/:id/reveal', requireModule('bank_accounts'), asyncHandler(async (req, res) => {
  const acc = await BankAccount.findOne(excludeDeleted({ _id: req.params.id, organizationId: req.user!.organizationId })).select('+accountNumberEnc');
  if (!acc) throw ApiError.notFound('Account not found');
  await audit(req, 'bank_account.revealed', 'BankAccount', String(acc._id), { module: 'bank_accounts', severity: 'high', summary: `Full account number of ${acc.bankName} ••••${acc.accountLast4} viewed` });
  res.json({ success: true, data: { accountNumber: decryptField(acc.accountNumberEnc) } });
}));

bankAccountsRouter.delete('/:id', requireModule('bank_accounts'), asyncHandler(async (req, res) => {
  const inUse = await Invoice.countDocuments(excludeDeleted({ organizationId: req.user!.organizationId, bankAccountId: req.params.id, status: { $in: ['pending_approval', 'approved', 'sent', 'partially_paid'] } }));
  if (inUse) throw ApiError.conflict(`${inUse} open invoice(s) use this account. Deactivate it instead.`);
  const acc = await BankAccount.findOne(excludeDeleted({ _id: req.params.id, organizationId: req.user!.organizationId }));
  if (!acc) throw ApiError.notFound('Account not found');
  (acc as any).isDeleted = true; (acc as any).deletedAt = new Date(); (acc as any).deletedById = req.user!.id;
  acc.accountNumberHash = `deleted:${acc._id}`; // frees the number for re-registration
  await acc.save();
  await audit(req, 'bank_account.deleted', 'BankAccount', String(acc._id), { module: 'bank_accounts', severity: 'high', summary: `Bank account ••••${acc.accountLast4} deleted` });
  res.json({ success: true, data: { id: acc._id } });
}));

/* ============================ Rates, services, tax rates ==================== */
export const ratesRouter = Router();
ratesRouter.use(requireAuth);

ratesRouter.get('/exchange', requireModule('taxes', 'invoices', 'expenses'), asyncHandler(async (req, res) => {
  const rows = await ExchangeRate.find(excludeDeleted({ organizationId: req.user!.organizationId })).sort('-rateDate').limit(200);
  const current: Record<string, number> = {};
  for (const r of rows) if (r.status === 'active' && current[r.currency] === undefined) current[r.currency] = r.rate;
  res.json({ success: true, data: rows, current });
}));
ratesRouter.post('/exchange', requireModule('taxes'), asyncHandler(async (req, res) => {
  const { currency, rate, rateDate, source } = req.body || {};
  if (!['USD', 'GBP', 'EUR'].includes(currency)) throw ApiError.badRequest('currency must be USD, GBP or EUR');
  if (!(num(rate) > 0)) throw ApiError.badRequest('rate must be greater than zero');
  await ExchangeRate.updateMany({ organizationId: req.user!.organizationId, currency, status: 'active' }, { status: 'superseded' });
  const row = await ExchangeRate.create({ organizationId: req.user!.organizationId, currency, rate: num(rate), rateDate: rateDate ? new Date(rateDate) : new Date(), source: source || 'CBN', createdById: req.user!.id });
  await audit(req, 'exchange_rate.created', 'ExchangeRate', String(row._id), { module: 'taxes', summary: `1 ${currency} = NGN ${row.rate}` });
  res.status(201).json({ success: true, data: row });
}));

ratesRouter.get('/tax', requireModule('taxes', 'invoices', 'expenses'), asyncHandler(async (req, res) => {
  const { kind } = req.query as Record<string, string>;
  const q: any = { organizationId: req.user!.organizationId }; if (kind) q.kind = kind;
  res.json({ success: true, data: await TaxRate.find(excludeDeleted(q)).sort({ kind: 1, rate: 1 }) });
}));
ratesRouter.post('/tax', requireModule('taxes'), asyncHandler(async (req, res) => {
  const b = req.body || {};
  if (!['VAT', 'WHT', 'OTHER'].includes(b.kind) || !b.name || !(num(b.rate, -1) >= 0 && num(b.rate) <= 100)) throw ApiError.badRequest('kind, name and a rate between 0 and 100 are required.');
  if (b.isDefault) await TaxRate.updateMany({ organizationId: req.user!.organizationId, kind: b.kind }, { isDefault: false });
  const row = await TaxRate.create({ organizationId: req.user!.organizationId, ...pick(b, ['kind', 'name', 'isDefault', 'appliesTo']), rate: num(b.rate), effectiveFrom: b.effectiveFrom ? new Date(b.effectiveFrom) : undefined });
  await audit(req, 'tax_rate.created', 'TaxRate', String(row._id), { module: 'taxes', summary: `${row.kind} ${row.name} ${row.rate}%` });
  res.status(201).json({ success: true, data: row });
}));
ratesRouter.patch('/tax/:id', requireModule('taxes'), asyncHandler(async (req, res) => {
  const row = await TaxRate.findOne(excludeDeleted({ _id: req.params.id, organizationId: req.user!.organizationId }));
  if (!row) throw ApiError.notFound('Tax rate not found');
  const b = req.body || {};
  Object.assign(row, pick(b, ['name', 'appliesTo', 'status', 'inactiveReason']));
  if (b.rate !== undefined) { if (!(num(b.rate, -1) >= 0 && num(b.rate) <= 100)) throw ApiError.badRequest('rate must be 0–100'); row.rate = num(b.rate); }
  if (b.isDefault) { await TaxRate.updateMany({ organizationId: req.user!.organizationId, kind: row.kind }, { isDefault: false }); row.isDefault = true; }
  await row.save();
  await audit(req, 'tax_rate.updated', 'TaxRate', String(row._id), { module: 'taxes', summary: `${row.kind} ${row.name} → ${row.rate}% (${row.status})` });
  res.json({ success: true, data: row });
}));

ratesRouter.get('/services', requireModule('invoices', 'taxes'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await ServiceItem.find(excludeDeleted({ organizationId: req.user!.organizationId })).sort('name') });
}));
ratesRouter.post('/services', requireModule('invoices'), asyncHandler(async (req, res) => {
  if (!req.body?.name) throw ApiError.badRequest('name is required');
  const row = await ServiceItem.create({ organizationId: req.user!.organizationId, ...pick(req.body, ['name', 'type', 'description', 'currency', 'active']), defaultUnitFee: num(req.body.defaultUnitFee) });
  await audit(req, 'service.created', 'ServiceItem', String(row._id), { module: 'invoices', summary: row.name });
  res.status(201).json({ success: true, data: row });
}));
ratesRouter.patch('/services/:id', requireModule('invoices'), asyncHandler(async (req, res) => {
  const row = await ServiceItem.findOneAndUpdate(excludeDeleted({ _id: req.params.id, organizationId: req.user!.organizationId }), { $set: { ...pick(req.body, ['name', 'type', 'description', 'currency', 'active']), ...(req.body.defaultUnitFee !== undefined ? { defaultUnitFee: num(req.body.defaultUnitFee) } : {}) } }, { new: true });
  if (!row) throw ApiError.notFound('Service not found');
  res.json({ success: true, data: row });
}));

/* ================================== Tax records ============================= */
export const taxesRouter = Router();
taxesRouter.use(requireAuth, requireModule('taxes'));

/** Writes VAT/WHT records for an invoice payment or expense so the tax returns reconcile to source documents. */
export async function recordTax(orgId: string, rec: { nature: string; kind: 'VAT' | 'WHT'; sourceType: 'invoice' | 'expense' | 'manual'; sourceId?: any; sourceRef?: string; partyName?: string; transDate: Date; baseAmount: number; rate: number; amount: number; currency?: string }) {
  if (!(rec.amount > 0)) return;
  const exists = rec.sourceId ? await TaxRecord.findOne({ organizationId: orgId, sourceId: rec.sourceId, nature: rec.nature, transDate: rec.transDate, amount: rec.amount }) : null;
  if (exists) return;
  await TaxRecord.create({ organizationId: orgId, taxId: await nextNumber(orgId, rec.kind === 'VAT' ? 'VAT' : 'WHT', { pad: 6 }), ...rec });
}

taxesRouter.get('/records', asyncHandler(async (req, res) => {
  const { nature, status, year, month, q } = req.query as Record<string, string>;
  const f: any = { organizationId: req.user!.organizationId };
  if (nature) f.nature = nature; if (status) f.status = status; if (year) f.year = num(year); if (month) f.month = num(month);
  if (q) f.$or = [{ partyName: { $regex: String(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } }, { sourceRef: { $regex: String(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } }];
  const rows = await TaxRecord.find(f).sort('-transDate').limit(500);
  res.json({ success: true, data: rows });
}));

taxesRouter.post('/records', asyncHandler(async (req, res) => {
  const b = req.body || {};
  if (!['output_vat', 'input_vat', 'wht_withheld_by_us', 'wht_credit'].includes(b.nature)) throw ApiError.badRequest('Invalid tax nature.');
  const base = num(b.baseAmount), rate = num(b.rate);
  if (!(base > 0) || !(rate > 0)) throw ApiError.badRequest('baseAmount and rate must be greater than zero.');
  const kind = b.nature.includes('vat') ? 'VAT' : 'WHT';
  const amount = round2((base * rate) / 100);
  const rec = await TaxRecord.create({ organizationId: req.user!.organizationId, taxId: await nextNumber(req.user!.organizationId, kind, { pad: 6 }), kind, nature: b.nature, sourceType: 'manual', sourceRef: b.sourceRef, partyName: b.partyName, transDate: b.transDate ? new Date(b.transDate) : new Date(), baseAmount: base, rate, amount });
  await audit(req, 'tax_record.created', 'TaxRecord', String(rec._id), { module: 'taxes', summary: `${rec.nature} ${rec.amount}` });
  res.status(201).json({ success: true, data: rec });
}));

taxesRouter.post('/records/mark-paid', asyncHandler(async (req, res) => {
  const ids: string[] = Array.isArray(req.body.ids) ? req.body.ids : [];
  if (!ids.length) throw ApiError.badRequest('Select at least one record.');
  const result = await TaxRecord.updateMany({ organizationId: req.user!.organizationId, _id: { $in: ids }, status: 'unpaid', nature: { $in: ['output_vat', 'wht_withheld_by_us'] } }, { status: 'paid', paidAt: new Date(), paidById: req.user!.id, paymentRef: req.body.paymentRef ? String(req.body.paymentRef).slice(0, 100) : undefined });
  await audit(req, 'tax_record.remitted', 'TaxRecord', undefined, { module: 'taxes', severity: 'high', summary: `${result.modifiedCount} tax record(s) marked remitted`, meta: { ids, paymentRef: req.body.paymentRef } });
  res.json({ success: true, data: { updated: result.modifiedCount } });
}));

taxesRouter.post('/records/:id/void', asyncHandler(async (req, res) => {
  if (!req.body?.reason) throw ApiError.badRequest('A reason is required to void a tax record.');
  const rec = await TaxRecord.findOneAndUpdate({ _id: req.params.id, organizationId: req.user!.organizationId, status: 'unpaid' }, { status: 'void' }, { new: true });
  if (!rec) throw ApiError.notFound('Unpaid tax record not found');
  await audit(req, 'tax_record.voided', 'TaxRecord', String(rec._id), { module: 'taxes', severity: 'high', summary: `Voided: ${req.body.reason}` });
  res.json({ success: true, data: rec });
}));

/** Tax return summary for a period: payable VAT = output − input; WHT to remit; WHT credits claimable. */
taxesRouter.get('/return', asyncHandler(async (req, res) => {
  const year = num(req.query.year, new Date().getFullYear());
  const month = req.query.month ? num(req.query.month) : undefined;
  const match: any = { organizationId: oid(req.user!.organizationId), year, status: { $ne: 'void' } };
  if (month) match.month = month;
  const grouped = await TaxRecord.aggregate([{ $match: match }, { $group: { _id: { nature: '$nature', status: '$status', month: '$month' }, amount: { $sum: '$amount' }, base: { $sum: '$baseAmount' }, n: { $sum: 1 } } }]);
  const sum = (nature: string, status?: string) => round2(grouped.filter((g) => g._id.nature === nature && (!status || g._id.status === status)).reduce((s, g) => s + g.amount, 0));
  const outputVat = sum('output_vat'), inputVat = sum('input_vat');
  const byMonth = Array.from({ length: 12 }, (_, i) => {
    const m = i + 1; const f = (nature: string) => round2(grouped.filter((g) => g._id.month === m && g._id.nature === nature).reduce((s, g) => s + g.amount, 0));
    return { month: m, outputVat: f('output_vat'), inputVat: f('input_vat'), whtWithheld: f('wht_withheld_by_us'), whtCredit: f('wht_credit') };
  });
  res.json({ success: true, data: { year, month: month || null, outputVat, inputVat, vatPayable: round2(outputVat - inputVat), vatUnremitted: sum('output_vat', 'unpaid'), whtWithheldByUs: sum('wht_withheld_by_us'), whtUnremitted: sum('wht_withheld_by_us', 'unpaid'), whtCredits: sum('wht_credit'), byMonth, dueDate: `${month ? (month === 12 ? year + 1 : year) : year}-${String(month ? (month === 12 ? 1 : month + 1) : 1).padStart(2, '0')}-21`, note: 'VAT and WHT are due by the 21st of the following month.' } });
}));

taxesRouter.get('/export.csv', asyncHandler(async (req, res) => {
  const rows = await TaxRecord.find({ organizationId: req.user!.organizationId, ...(req.query.year ? { year: num(req.query.year) } : {}) }).sort('transDate').lean();
  await audit(req, 'tax_record.exported', 'TaxRecord', undefined, { module: 'taxes', summary: `${rows.length} tax records exported` });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename=tax-records-${Date.now()}.csv`);
  const cols = [['taxId', 'Tax ID'], ['kind', 'Kind'], ['nature', 'Nature'], ['date', 'Date'], ['partyName', 'Party'], ['sourceRef', 'Source'], ['baseAmount', 'Base (NGN)'], ['rate', 'Rate %'], ['amount', 'Amount (NGN)'], ['status', 'Status'], ['paymentRef', 'Payment ref']].map(([key, label]) => ({ key, label }));
  res.send(toCsv(cols, rows.map((r: any) => ({ ...r, date: new Date(r.transDate).toISOString().slice(0, 10) }))));
}));

/* ================================== Invoices ================================ */
export const invoicesRouter = Router();
invoicesRouter.use(requireAuth, requireModule('invoices'));

invoicesRouter.get('/meta', asyncHandler(async (req, res) => {
  const rates: any[] = [];
  for (const c of ['USD', 'GBP', 'EUR']) {
    const r = await ExchangeRate.findOne({ organizationId: req.user!.organizationId, currency: c, status: 'active' }).sort('-rateDate');
    if (r) rates.push({ currency: c, rate: r.rate, rateDate: r.rateDate, source: r.source });
  }
  const vat = await TaxRate.findOne(excludeDeleted({ organizationId: req.user!.organizationId, kind: 'VAT', status: 'active', isDefault: true }));
  res.json({ success: true, data: { currencies: CURRENCIES, types: INVOICE_TYPES, termsDays: env.invoiceTermsDays, rates, defaultVat: vat?.rate ?? 7.5 } });
}));

/** Best-effort e-mail to staff (never blocks or fails the request). */
async function mailStaff(userIds: string[], mail: { subject: string; html: string }) {
  const ids = Array.from(new Set(userIds.filter(Boolean).map(String)));
  if (!ids.length) return;
  const users = await User.find({ _id: { $in: ids }, isActive: true }).select('email');
  await Promise.all(users.map((u) => sendMail({ to: u.email, subject: mail.subject, html: mail.html }).catch(() => undefined)));
}
const clientEmails = (client: any): string[] => (client?.contacts || []).map((c: any) => c.email).filter((e: string) => e && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)).slice(0, 10);

invoicesRouter.post('/preview', asyncHandler(async (req, res) => {
  const org = req.user!.organizationId;
  const input = buildInvoiceInput(req.body || {});
  const [client, bank] = await Promise.all([Client.findOne(excludeDeleted({ _id: input.clientId, organizationId: org })), BankAccount.findOne(excludeDeleted({ _id: input.bankAccountId, organizationId: org })).select('+accountNumberEnc')]);
  if (!client) throw ApiError.badRequest('Client not found.');
  if (!bank) throw ApiError.badRequest('Bank account not found.');
  const { manualRate, ...rest } = input as any;
  const fx = await fxFor(org, input.currency, manualRate);
  const inv: any = new Invoice({ ...rest, ...fx, organizationId: org, invoiceNo: req.body?.invoiceNo || 'PREVIEW', status: 'draft', payments: [] });
  computeInvoice(inv);
  const model = buildDoc(inv, client, bank, bank.accountNumberEnc ? decryptField(bank.accountNumberEnc) : '');
  res.json({ success: true, data: { html: invoiceHtml(model, { fullDocument: true }), subtotal: inv.subtotal, vatAmount: inv.vatAmount, total: inv.total, totalNgn: inv.totalNgn, exchangeRate: inv.exchangeRate, rateSource: inv.rateSource, inWords: model.inWords, client: { name: client.name, email: model.client.email, phone: model.client.phone }, bank: { accountName: bank.accountName, bankName: bank.bankName, accountMasked: maskAccount(bank.accountLast4) } } });
}));

function buildInvoiceInput(b: any) {
  if (!b.clientId) throw ApiError.badRequest('Choose a client.');
  if (!b.bankAccountId) throw ApiError.badRequest('Choose the bank account for payment.');
  if (!Array.isArray(b.items) || !b.items.length) throw ApiError.badRequest('Add at least one line item.');
  const items = b.items.map((it: any, i: number) => {
    if (!it.description || !String(it.description).trim()) throw ApiError.badRequest(`Line ${i + 1}: add a description.`);
    return { group: it.group ? String(it.group).trim().slice(0, 160) : undefined, description: String(it.description).trim().slice(0, 400), quantity: num(it.quantity, 1), unitFee: num(it.unitFee) };
  });
  const issueDate = b.issueDate ? new Date(b.issueDate) : new Date();
  const dueDate = b.dueDate ? new Date(b.dueDate) : new Date(issueDate.getTime() + env.invoiceTermsDays * 86400000);
  if (isNaN(+issueDate) || isNaN(+dueDate)) throw ApiError.badRequest('Enter valid dates.');
  if (dueDate < issueDate) throw ApiError.badRequest('Due date cannot be before the issue date.');
  const periodStart = b.periodStart ? new Date(b.periodStart) : undefined, periodEnd = b.periodEnd ? new Date(b.periodEnd) : undefined;
  if (periodStart && periodEnd && periodEnd < periodStart) throw ApiError.badRequest('The period end cannot be before the period start.');
  const splitAmounts = Array.isArray(b.splitAmounts) ? b.splitAmounts.slice(0, 6).filter((x: any) => x && x.label && num(x.amount) > 0).map((x: any) => ({
    label: String(x.label).slice(0, 80), amount: num(x.amount), inWords: x.inWords ? String(x.inWords).slice(0, 300) : undefined, kind: x.kind === 'wire' ? 'wire' : 'local',
    wire: Array.isArray(x.wire) ? x.wire.slice(0, 12).filter((w: any) => w?.label).map((w: any) => ({ label: String(w.label).slice(0, 60), value: String(w.value ?? '').slice(0, 120) })) : [],
  })) : [];
  return {
    clientId: b.clientId, bankAccountId: b.bankAccountId, items, issueDate, dueDate, periodStart, periodEnd, splitAmounts,
    ...pick(b, ['referenceNo', 'poNumber', 'invoiceType', 'periodLabel', 'notes', 'documentTitle']),
    templateType: b.templateType === 'split' ? 'split' : 'standard',
    includeNaira: !!b.includeNaira,
    instructions: Array.isArray(b.instructions) ? b.instructions.slice(0, 8).map((x: any) => String(x).slice(0, 300)).filter(Boolean) : [],
    currency: CURRENCIES.includes(b.currency) ? b.currency : 'NGN',
    vatRate: Math.min(Math.max(num(b.vatRate, 7.5), 0), 100),
    whtRate: Math.min(Math.max(num(b.whtRate, 0), 0), 100),
    // a typed-in rate is only honoured with a reason (it is audited); otherwise the CBN rate from the database is used
    manualRate: b.rateSource === 'manual' && num(b.exchangeRate) > 0 ? { rate: num(b.exchangeRate), reason: String(b.rateOverrideReason || '').slice(0, 200), date: b.rateDate ? new Date(b.rateDate) : undefined } : undefined,
  };
}

async function fxFor(orgId: string, currency: string, manual?: { rate: number; reason: string; date?: Date }) {
  if (currency === 'NGN') return { exchangeRate: 1, rateDate: undefined as Date | undefined, rateSource: 'database' as const, rateOverrideReason: undefined as string | undefined };
  if (manual) {
    if (!manual.reason) throw ApiError.badRequest('Give a reason for using a manual exchange rate (it is recorded in the audit log).');
    return { exchangeRate: manual.rate, rateDate: manual.date || new Date(), rateSource: 'manual' as const, rateOverrideReason: manual.reason };
  }
  const r = await ExchangeRate.findOne({ organizationId: orgId, currency, status: 'active' }).sort('-rateDate');
  if (!r) throw ApiError.badRequest(`No active ${currency} exchange rate. Add one under Taxes → Rates, or switch to a manual rate.`);
  return { exchangeRate: r.rate, rateDate: r.rateDate, rateSource: 'database' as const, rateOverrideReason: undefined as string | undefined };
}

async function activeBank(orgId: string, id: string) {
  const bank = await BankAccount.findOne(excludeDeleted({ _id: id, organizationId: orgId }));
  if (!bank) throw ApiError.badRequest('Bank account not found.');
  if (bank.status !== 'active') throw ApiError.badRequest('Only approved, active bank accounts can be used on invoices.');
  return bank;
}

invoicesRouter.get('/', asyncHandler(async (req, res) => {
  const { status, clientId, q, overdue, page = '1', limit = '25' } = req.query as Record<string, string>;
  const f: any = { organizationId: req.user!.organizationId };
  if (status) f.status = status; if (clientId) f.clientId = clientId;
  if (overdue === 'true') { f.dueDate = { $lt: new Date() }; f.status = { $in: ['sent', 'partially_paid'] }; }
  if (q) f.$or = [{ invoiceNo: { $regex: String(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } }, { referenceNo: { $regex: String(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } }];
  const p = Math.max(num(page, 1), 1), l = Math.min(Math.max(num(limit, 25), 1), 100);
  const [items, total, agg] = await Promise.all([
    Invoice.find(excludeDeleted(f)).populate('clientId', 'name').sort('-issueDate').skip((p - 1) * l).limit(l).select('-history -payments'),
    Invoice.countDocuments(excludeDeleted(f)),
    // Totals are summed in code (an arithmetic $group would not run on every MongoDB-compatible database).
    Invoice.find(excludeDeleted({ organizationId: req.user!.organizationId, status: { $nin: ['draft', 'void', 'rejected'] } })).select('totalNgn balance currency exchangeRate').limit(50000).lean().then((rows: any[]) => [rows.reduce((a, r) => ({ billed: a.billed + (r.totalNgn || 0), outstanding: a.outstanding + (r.balance || 0) * (r.currency === 'NGN' ? 1 : r.exchangeRate || 1), n: a.n + 1 }), { _id: null, billed: 0, outstanding: 0, n: 0 })]),
  ]);
  res.json({ success: true, data: items, summary: agg[0] || { billed: 0, outstanding: 0, n: 0 }, pagination: { page: p, limit: l, total, pages: Math.ceil(total / l) } });
}));

invoicesRouter.post('/', asyncHandler(async (req, res) => {
  const input = buildInvoiceInput(req.body || {});
  await activeBank(req.user!.organizationId, input.bankAccountId);
  if (!(await Client.findOne(excludeDeleted({ _id: input.clientId, organizationId: req.user!.organizationId })))) throw ApiError.badRequest('Client not found.');
  const { manualRate, ...rest } = input as any;
  const fx = await fxFor(req.user!.organizationId, input.currency, manualRate);
  const inv: any = new Invoice({ ...rest, ...fx, organizationId: req.user!.organizationId, invoiceNo: await nextNumber(req.user!.organizationId, 'INV', { yearly: true, pad: 4 }), createdById: req.user!.id, status: 'draft', payments: [] });
  computeInvoice(inv);
  inv.history.push({ byId: req.user!.id, byName: req.user!.name, action: 'created' });
  await inv.save();
  await audit(req, 'invoice.created', 'Invoice', String(inv._id), { module: 'invoices', summary: `${inv.invoiceNo} · ${inv.total} ${inv.currency}${inv.rateSource === 'manual' ? ` · MANUAL RATE ${inv.exchangeRate} (${inv.rateOverrideReason})` : ''}`, severity: inv.rateSource === 'manual' ? 'medium' : undefined });
  res.status(201).json({ success: true, data: inv });
}));

async function loadInvoice(req: any, id?: string) {
  const inv: any = await Invoice.findOne(excludeDeleted({ _id: id ?? req.params.id, organizationId: req.user.organizationId }));
  if (!inv) throw ApiError.notFound('Invoice not found');
  return inv;
}

invoicesRouter.get('/:id', asyncHandler(async (req, res) => {
  const inv = await loadInvoice(req);
  const [client, bank] = await Promise.all([Client.findById(inv.clientId).select('name contacts country'), BankAccount.findById(inv.bankAccountId)]);
  res.json({ success: true, data: inv, client, bank: bank ? maskBank(bank) : null });
}));

invoicesRouter.put('/:id', asyncHandler(async (req, res) => {
  const inv = await loadInvoice(req);
  if (!['draft', 'rejected'].includes(inv.status)) throw ApiError.conflict('Only draft or rejected invoices can be edited.');
  const input = buildInvoiceInput({ ...inv.toObject(), ...req.body, rateSource: req.body?.rateSource ?? (inv.rateSource === 'manual' ? 'manual' : undefined), rateOverrideReason: req.body?.rateOverrideReason ?? inv.rateOverrideReason });
  await activeBank(req.user!.organizationId, input.bankAccountId);
  const { manualRate, ...rest } = input as any;
  Object.assign(inv, rest, await fxFor(req.user!.organizationId, input.currency, manualRate));
  inv.status = 'draft'; inv.rejectionReason = undefined;
  computeInvoice(inv);
  inv.history.push({ byId: req.user!.id, byName: req.user!.name, action: 'edited' });
  await inv.save();
  await audit(req, 'invoice.updated', 'Invoice', String(inv._id), { module: 'invoices', summary: inv.invoiceNo });
  res.json({ success: true, data: inv });
}));

invoicesRouter.post('/:id/submit', asyncHandler(async (req, res) => {
  const inv = await loadInvoice(req);
  if (!['draft', 'rejected'].includes(inv.status)) throw ApiError.conflict('Only drafts can be submitted for approval.');
  inv.status = 'pending_approval'; inv.submittedAt = new Date();
  inv.history.push({ byId: req.user!.id, byName: req.user!.name, action: 'submitted' });
  await inv.save();
  await audit(req, 'invoice.submitted', 'Invoice', String(inv._id), { module: 'invoices', summary: inv.invoiceNo });
  const clientDoc: any = await Client.findById(inv.clientId).select('name contacts');
  const resub = (inv.history || []).some((h: any) => h.action === 'rejected');
  const approverIds = (await usersWithModule(req.user!.organizationId, 'invoices')).filter((u) => ['finance', 'coo', 'ceo', 'super_admin'].includes(u.role) && String(u._id) !== req.user!.id).map((u) => String(u._id));
  await mailStaff(approverIds, resub ? invoiceUpdatedMail(inv, clientDoc, req.user!.name) : invoiceCreatedMail(inv, clientDoc, { audience: 'internal', byName: req.user!.name }));
  const approvers = (await usersWithModule(req.user!.organizationId, 'invoices')).filter((u) => ['finance', 'coo', 'ceo', 'super_admin'].includes(u.role) && String(u._id) !== req.user!.id);
  await notify({ organizationId: req.user!.organizationId, userIds: approvers.map((u) => String(u._id)), title: `Invoice ${inv.invoiceNo} awaiting approval`, body: `${money(inv.total, inv.currency)} · submitted by ${req.user!.name}`, link: `/invoices?invoice=${inv._id}`, type: 'finance', severity: 'warning' });
  res.json({ success: true, data: inv });
}));

invoicesRouter.post('/:id/approve', asyncHandler(async (req, res) => {
  if (!['finance', 'coo', 'ceo', 'super_admin'].includes(req.user!.role)) throw ApiError.forbidden('Only finance leadership can approve invoices.');
  const inv = await loadInvoice(req);
  if (inv.status !== 'pending_approval') throw ApiError.conflict('This invoice is not awaiting approval.');
  if (env.fourEyes && String(inv.createdById) === req.user!.id) throw ApiError.forbidden('Four-eyes control: the creator cannot approve their own invoice.');
  inv.status = 'approved'; inv.approvedById = req.user!.id; inv.approvedAt = new Date();
  inv.history.push({ byId: req.user!.id, byName: req.user!.name, action: 'approved' });
  await inv.save();
  await audit(req, 'invoice.approved', 'Invoice', String(inv._id), { module: 'invoices', severity: 'medium', summary: inv.invoiceNo });
  await mailStaff([String(inv.createdById)], invoiceStatusMail(inv, 'approved', { byName: req.user!.name }));
  await notify({ organizationId: req.user!.organizationId, userIds: [String(inv.createdById)], title: `Invoice ${inv.invoiceNo} approved`, body: 'You can now send it to the client.', link: `/invoices?invoice=${inv._id}`, type: 'finance' });
  res.json({ success: true, data: inv });
}));

invoicesRouter.post('/:id/reject', asyncHandler(async (req, res) => {
  if (!['finance', 'coo', 'ceo', 'super_admin'].includes(req.user!.role)) throw ApiError.forbidden('Only finance leadership can reject invoices.');
  if (!req.body?.reason) throw ApiError.badRequest('Give a reason.');
  const inv = await loadInvoice(req);
  if (inv.status !== 'pending_approval') throw ApiError.conflict('This invoice is not awaiting approval.');
  inv.status = 'rejected'; inv.rejectionReason = String(req.body.reason).slice(0, 500);
  inv.history.push({ byId: req.user!.id, byName: req.user!.name, action: 'rejected', note: inv.rejectionReason });
  await inv.save();
  await audit(req, 'invoice.rejected', 'Invoice', String(inv._id), { module: 'invoices', summary: `${inv.invoiceNo}: ${inv.rejectionReason}` });
  await mailStaff([String(inv.createdById)], invoiceStatusMail(inv, 'rejected', { byName: req.user!.name, reason: inv.rejectionReason }));
  await notify({ organizationId: req.user!.organizationId, userIds: [String(inv.createdById)], title: `Invoice ${inv.invoiceNo} rejected`, body: inv.rejectionReason, link: `/invoices?invoice=${inv._id}`, type: 'finance', severity: 'warning' });
  res.json({ success: true, data: inv });
}));

async function pdfFor(inv: any) {
  const [client, bank] = await Promise.all([Client.findById(inv.clientId), BankAccount.findById(inv.bankAccountId).select('+accountNumberEnc')]);
  return { client, bank, buffer: await invoicePdf(inv, client, bank, bank?.accountNumberEnc ? decryptField(bank.accountNumberEnc) : '') };
}

invoicesRouter.get('/:id/html', asyncHandler(async (req, res) => {
  const inv = await loadInvoice(req);
  const [client, bank] = await Promise.all([Client.findById(inv.clientId), BankAccount.findById(inv.bankAccountId).select('+accountNumberEnc')]);
  res.json({ success: true, data: { html: invoiceHtml(buildDoc(inv, client, bank, bank?.accountNumberEnc ? decryptField(bank.accountNumberEnc) : ''), { fullDocument: true }) } });
}));

invoicesRouter.get('/:id/pdf', asyncHandler(async (req, res) => {
  const inv = await loadInvoice(req);
  if (['draft', 'pending_approval', 'rejected'].includes(inv.status)) throw ApiError.conflict('Approve the invoice before downloading the PDF.');
  const { buffer } = await pdfFor(inv);
  await audit(req, 'invoice.pdf_downloaded', 'Invoice', String(inv._id), { module: 'invoices', summary: inv.invoiceNo });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${inv.invoiceNo.replace(/[^\w.-]/g, '_')}.pdf"`);
  res.send(buffer);
}));

invoicesRouter.post('/:id/send', asyncHandler(async (req, res) => {
  const inv = await loadInvoice(req);
  if (!['approved', 'sent', 'partially_paid'].includes(inv.status)) throw ApiError.conflict('Invoice must be approved before it is sent.');
  const client: any = await Client.findById(inv.clientId);
  const recipients: string[] = (Array.isArray(req.body.to) && req.body.to.length ? req.body.to : (client?.contacts || []).map((c: any) => c.email).filter(Boolean)).filter((e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)).slice(0, 10);
  if (!recipients.length) throw ApiError.badRequest('No valid recipient email. Add a client contact email or pass "to".');
  const { buffer } = await pdfFor(inv);
  const mail = invoiceCreatedMail(inv, client, { audience: 'client', message: req.body.message ? String(req.body.message).slice(0, 1000) : undefined });
  const result = await sendMail({ to: recipients, subject: mail.subject, html: mail.html, attachments: [{ filename: `${inv.invoiceNo}.pdf`, content: buffer, contentType: 'application/pdf' }] });
  if (inv.status === 'approved') { inv.status = 'sent'; inv.sentAt = new Date(); }
  inv.history.push({ byId: req.user!.id, byName: req.user!.name, action: result.delivered ? 'emailed' : 'email_attempted', note: recipients.join(', ') });
  await inv.save();
  await audit(req, 'invoice.sent', 'Invoice', String(inv._id), { module: 'invoices', summary: `${inv.invoiceNo} sent to ${recipients.length} recipient(s)`, meta: { delivered: result.delivered } });
  res.json({ success: true, data: inv, delivered: result.delivered });
}));

invoicesRouter.post('/:id/payments', asyncHandler(async (req, res) => {
  const inv = await loadInvoice(req);
  if (!['sent', 'partially_paid', 'approved'].includes(inv.status)) throw ApiError.conflict('Payments can only be recorded on sent invoices.');
  const amount = num(req.body.amount), wht = num(req.body.whtDeducted);
  if (!(amount >= 0) || !(wht >= 0) || amount + wht <= 0) throw ApiError.badRequest('Enter the amount received and/or WHT deducted.');
  if (round2(amount + wht) > round2(inv.balance) + 0.005) throw ApiError.badRequest(`Payment exceeds the balance of ${inv.balance}.`);
  const paidOn = req.body.paidOn ? new Date(req.body.paidOn) : new Date();
  let receipt: any;
  if (req.body.receiptUrl) {
    const f = verifyOrgUpload(req.user!.organizationId, String(req.body.receiptUrl));
    receipt = { url: String(req.body.receiptUrl), name: String(req.body.receiptName || f.filename).slice(0, 200), size: f.size, addedById: req.user!.id, addedAt: new Date() };
  }
  inv.payments.push({ amount, whtDeducted: wht, paidOn, method: req.body.method || 'bank_transfer', reference: req.body.reference ? String(req.body.reference).slice(0, 100) : undefined, receipt, recordedById: req.user!.id });
  computeInvoice(inv);
  if (inv.balance <= 0.005) { inv.status = 'paid'; inv.paidAt = paidOn; } else inv.status = 'partially_paid';
  inv.history.push({ byId: req.user!.id, byName: req.user!.name, action: 'payment_recorded', note: `${amount}${wht ? ` + WHT ${wht}` : ''}` });
  await inv.save();
  const rate = inv.currency === 'NGN' ? 1 : inv.exchangeRate || 1;
  const client: any = await Client.findById(inv.clientId).select('name');
  if (wht > 0) await recordTax(req.user!.organizationId, { nature: 'wht_credit', kind: 'WHT', sourceType: 'invoice', sourceId: inv._id, sourceRef: inv.invoiceNo, partyName: client?.name, transDate: paidOn, baseAmount: round2((inv.subtotal * (wht / (inv.whtAmount || wht)))) * rate, rate: inv.whtRate || 0, amount: round2(wht * rate) });
  if (inv.vatAmount > 0 && inv.status === 'paid') await recordTax(req.user!.organizationId, { nature: 'output_vat', kind: 'VAT', sourceType: 'invoice', sourceId: inv._id, sourceRef: inv.invoiceNo, partyName: client?.name, transDate: paidOn, baseAmount: round2(inv.subtotal * rate), rate: inv.vatRate, amount: round2(inv.vatAmount * rate) });
  await audit(req, 'invoice.payment_recorded', 'Invoice', String(inv._id), { module: 'invoices', severity: 'medium', summary: `${inv.invoiceNo}: ${amount} received${wht ? `, WHT ${wht}` : ''}` });
  if (req.body.notifyClient !== false) { const to = clientEmails(client); if (to.length) { const m = paymentAckMail(inv, client, { amount, whtDeducted: wht, paidOn, reference: req.body.reference }); await sendMail({ to, subject: m.subject, html: m.html }).catch(() => undefined); } }
  res.json({ success: true, data: inv });
}));

/** Attach (or replace) the proof of payment on a payment that was recorded without one. */
invoicesRouter.post('/:id/payments/:paymentId/receipt', asyncHandler(async (req, res) => {
  const inv = await loadInvoice(req);
  const pay: any = inv.payments.id(req.params.paymentId);
  if (!pay) throw ApiError.notFound('Payment not found');
  const url = String(req.body?.url || '');
  const f = verifyOrgUpload(req.user!.organizationId, url);
  pay.receipt = { url, name: String(req.body?.name || f.filename).slice(0, 200), size: f.size, addedById: req.user!.id, addedAt: new Date() };
  inv.history.push({ byId: req.user!.id, byName: req.user!.name, action: 'receipt_attached', note: pay.receipt.name });
  await inv.save();
  await audit(req, 'invoice.receipt_attached', 'Invoice', String(inv._id), { module: 'invoices', summary: `${inv.invoiceNo}: payment receipt "${pay.receipt.name}" attached` });
  res.json({ success: true, data: inv });
}));

/** Expense claims raised against this invoice — only the ones the caller is allowed to see. */
invoicesRouter.get('/:id/expenses', asyncHandler(async (req, res) => {
  const inv = await loadInvoice(req);
  const approver = hasModule(req as any, 'expense_approvals');
  const filter: any = { organizationId: req.user!.organizationId, invoiceId: inv._id };
  filter.$or = approver ? [{ submittedById: req.user!.id }, { status: { $ne: 'draft' } }] : [{ submittedById: req.user!.id }]; // drafts stay private to their author
  const rows = await ExpenseClaim.find(excludeDeleted(filter)).select('claimNo title status totals.total currency submittedByName createdAt').sort('-createdAt').limit(50);
  res.json({ success: true, data: rows });
}));

invoicesRouter.post('/:id/void', asyncHandler(async (req, res) => {
  if (!['finance', 'coo', 'ceo', 'super_admin'].includes(req.user!.role)) throw ApiError.forbidden('Only finance leadership can void invoices.');
  if (!req.body?.reason) throw ApiError.badRequest('A reason is required to void an invoice.');
  const inv = await loadInvoice(req);
  if (inv.status === 'paid' || inv.payments.length) throw ApiError.conflict('Invoices with payments cannot be voided — raise a credit note instead.');
  inv.status = 'void'; inv.voidReason = String(req.body.reason).slice(0, 300);
  inv.history.push({ byId: req.user!.id, byName: req.user!.name, action: 'void', note: inv.voidReason });
  await inv.save();
  await TaxRecord.updateMany({ organizationId: req.user!.organizationId, sourceId: inv._id, status: 'unpaid' }, { status: 'void' });
  await audit(req, 'invoice.voided', 'Invoice', String(inv._id), { module: 'invoices', severity: 'high', summary: `${inv.invoiceNo}: ${inv.voidReason}` });
  res.json({ success: true, data: inv });
}));

invoicesRouter.post('/:id/remind', asyncHandler(async (req, res) => {
  const inv = await loadInvoice(req);
  if (!['sent', 'partially_paid'].includes(inv.status)) throw ApiError.conflict('Only sent, unpaid invoices can be chased.');
  const client: any = await Client.findById(inv.clientId);
  const to = (client?.contacts || []).map((c: any) => c.email).filter(Boolean);
  if (!to.length) throw ApiError.badRequest('The client has no contact email.');
  const overdue = inv.dueDate < new Date();
  const mail = invoiceChaseMail(inv, client, overdue ? Math.max(1, Math.floor((Date.now() - inv.dueDate.getTime()) / 86400000)) : 0);
  const { buffer } = await pdfFor(inv);
  await sendMail({ to, subject: mail.subject, html: mail.html, attachments: [{ filename: `${inv.invoiceNo}.pdf`, content: buffer, contentType: 'application/pdf' }] });
  inv.reminders = { count: (inv.reminders?.count || 0) + 1, lastAt: new Date() };
  inv.history.push({ byId: req.user!.id, byName: req.user!.name, action: 'reminder_sent' });
  await inv.save();
  await audit(req, 'invoice.reminder_sent', 'Invoice', String(inv._id), { module: 'invoices', summary: inv.invoiceNo });
  res.json({ success: true, data: inv });
}));
