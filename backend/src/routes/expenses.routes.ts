import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireModule, hasModule } from '../middleware/modules';
import { asyncHandler } from '../utils/asyncHandler';
import { ApiError } from '../utils/ApiError';
import { ExpenseClaim, computeExpenseClaim, EXPENSE_CATEGORIES, PAYMENT_MODES } from '../models/Expense';
import { ExchangeRate, Invoice } from '../models/Finance';
import { User } from '../models/User';
import { nextNumber } from '../models/Access';
import { encryptField, decryptField, last4, maskAccount } from '../utils/crypto';
import { audit } from '../services/audit.service';
import { notify } from '../services/notify.service';
import { usersWithModule } from '../services/access.service';
import { sendMail } from '../services/email.service';
import { renderEmail, kvTable, dataTable, callout, esc, money, fmtDate } from '../services/mail.templates';
import { env } from '../config/env';
import { excludeDeleted } from '../utils/softDeletePlugin';
import { recordTax } from './finance.routes';

const router = Router();
router.use(requireAuth, requireModule('expenses', 'expense_approvals'));

const canApprove = (req: any) => hasModule(req, 'expense_approvals');
const num = (v: any, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

router.get('/meta', asyncHandler(async (_req, res) => {
  res.json({ success: true, data: { categories: EXPENSE_CATEGORIES, paymentModes: PAYMENT_MODES, currencies: ['NGN', 'USD', 'GBP', 'EUR'], receiptRequiredAbove: env.receiptRequiredAbove } });
}));

/** Attachments may only point at files this organisation uploaded through /api/uploads. */
function cleanAttachments(list: any, orgId: string) {
  if (!Array.isArray(list)) return [];
  const prefix = `/api/uploads/${orgId}/`;
  return list
    .filter((a) => a && typeof a.url === 'string' && a.url.startsWith(prefix) && !a.url.includes('..'))
    .slice(0, 20)
    .map((a) => ({ url: a.url, name: String(a.name || a.originalName || 'file').slice(0, 160), mimeType: a.mimeType, size: num(a.size), kind: ['receipt', 'image', 'invoice', 'other'].includes(a.kind) ? a.kind : /^image\//.test(a.mimeType || '') ? 'image' : 'receipt' }));
}

async function buildItems(rawItems: any[], req: any, existing?: any[]) {
  if (!Array.isArray(rawItems) || rawItems.length === 0) throw ApiError.badRequest('Add at least one expense item.');
  if (rawItems.length > 100) throw ApiError.badRequest('A claim can hold up to 100 items.');
  const orgId = req.user.organizationId;
  const items: any[] = [];
  for (let i = 0; i < rawItems.length; i++) {
    const r = rawItems[i] || {};
    const n = i + 1;
    if (!EXPENSE_CATEGORIES.includes(r.category)) throw ApiError.badRequest(`Item ${n}: choose a category.`);
    if (!r.description || !String(r.description).trim()) throw ApiError.badRequest(`Item ${n}: add a description.`);
    if (!r.date || Number.isNaN(new Date(r.date).getTime())) throw ApiError.badRequest(`Item ${n}: add the date.`);
    const quantity = num(r.quantity, 1);
    const unitAmount = num(r.unitAmount);
    const amount = r.amount !== undefined && r.amount !== '' ? num(r.amount) : quantity * unitAmount;
    if (!(amount > 0)) throw ApiError.badRequest(`Item ${n}: amount must be greater than zero.`);

    // Who bought / did it
    const bb = r.boughtBy || {};
    const boughtBy: any = { kind: bb.kind === 'other' ? 'other' : 'employee' };
    if (boughtBy.kind === 'employee') {
      const empId = bb.employeeId || req.user.id;
      const emp = await User.findOne(excludeDeleted({ _id: empId, organizationId: orgId })).select('name');
      if (!emp) throw ApiError.badRequest(`Item ${n}: the selected employee was not found.`);
      boughtBy.employeeId = emp._id;
      boughtBy.name = emp.name;
    } else {
      if (!bb.name || !String(bb.name).trim()) throw ApiError.badRequest(`Item ${n}: write the name of the person who bought it.`);
      boughtBy.name = String(bb.name).trim().slice(0, 120);
      boughtBy.contact = bb.contact ? String(bb.contact).slice(0, 120) : undefined;
    }
    const paymentMode = PAYMENT_MODES.includes(r.paymentMode) ? r.paymentMode : 'paid_personally';

    // Payee account is only captured for people outside the directory who need to be paid.
    const prev = existing?.find((e) => String(e._id) === String(r._id));
    let payee: any;
    if (paymentMode !== 'company_paid' && boughtBy.kind === 'other' && r.payee) {
      payee = { bankName: r.payee.bankName ? String(r.payee.bankName).slice(0, 120) : undefined, accountName: r.payee.accountName ? String(r.payee.accountName).slice(0, 120) : undefined };
      if (r.payee.accountNumber) {
        const digits = String(r.payee.accountNumber).replace(/\s+/g, '');
        if (!/^[A-Za-z0-9]{6,34}$/.test(digits)) throw ApiError.badRequest(`Item ${n}: payee account number looks invalid.`);
        payee.accountNumberEnc = encryptField(digits);
        payee.accountLast4 = last4(digits);
      } else if (prev?.payee?.accountNumberEnc) {
        payee.accountNumberEnc = prev.payee.accountNumberEnc;
        payee.accountLast4 = prev.payee.accountLast4;
      }
    }
    const t = r.tax || {};
    items.push({
      category: r.category,
      description: String(r.description).trim().slice(0, 300),
      vendor: r.vendor ? String(r.vendor).slice(0, 160) : undefined,
      date: new Date(r.date),
      quantity, unitAmount, amount,
      boughtBy, paymentMode, payee,
      tax: {
        whtEnabled: !!t.whtEnabled, whtRate: Math.min(Math.max(num(t.whtRate), 0), 100),
        vatEnabled: !!t.vatEnabled, vatRate: Math.min(Math.max(num(t.vatRate), 0), 100),
        payeeCompany: t.payeeCompany ? String(t.payeeCompany).slice(0, 160) : undefined,
      },
      projectId: r.projectId || undefined,
      clientId: r.clientId || undefined,
      notes: r.notes ? String(r.notes).slice(0, 1000) : undefined,
      attachments: cleanAttachments(r.attachments, orgId),
      decision: 'pending',
    });
  }
  return items;
}

/** Flags: missing receipt above threshold, possible duplicate (same vendor, amount and date for the same buyer). */
async function flagItems(claim: any, rate: number) {
  for (const it of claim.items) {
    const flags: string[] = [];
    if ((it.attachments || []).length === 0 && it.amount * rate >= env.receiptRequiredAbove) flags.push('missing_receipt');
    // Dotted-path equality (portable across MongoDB and FerretDB), then the exact same-line check in code.
    const sameDay = (a: any, b: any) => a && b && new Date(a).getTime() === new Date(b).getTime();
    const candidates: any[] = await ExpenseClaim.find(excludeDeleted({
      organizationId: claim.organizationId, _id: { $ne: claim._id }, status: { $nin: ['draft', 'cancelled', 'rejected'] },
      'items.amount': it.amount, 'items.date': it.date,
    })).select('claimNo items.amount items.date items.vendor items.boughtBy.name').limit(20);
    const dupe = candidates.find((c) => (c.items || []).some((o: any) => o.amount === it.amount && sameDay(o.date, it.date) && (o.vendor || null) === (it.vendor || null) && (o.boughtBy?.name || null) === (it.boughtBy?.name || null)));
    if (dupe) flags.push('possible_duplicate');
    it.flags = flags;
  }
}

async function resolveRate(currency: string) {
  if (currency === 'NGN') return 1;
  const r = await ExchangeRate.findOne({ currency, status: 'active' }).sort('-rateDate').lean().catch(() => null);
  return (r as any)?.rate || 1;
}

/* ------------------------------- Notification e-mail ----------------------- */
async function notifyFinance(claim: any, submitter: any, req: any) {
  const approvers = await usersWithModule(String(claim.organizationId), 'expense_approvals');
  const to = approvers.filter((u) => String(u._id) !== String(claim.submittedById));
  if (!to.length) return;
  const cur = claim.currency;
  const awaiting = claim.items.filter((i: any) => i.paymentMode === 'awaiting_disbursement');
  const personal = claim.items.filter((i: any) => i.paymentMode === 'paid_personally');

  // Account information — employees' details come from their profile (decrypted only here, for this e-mail).
  const full = await User.findById(claim.submittedById).select('+bankAccount.accountNumberEnc name email phone jobTitle department employeeNo bankAccount').lean() as any;
  const acct = (bank: any) => {
    if (!bank?.accountLast4 && !bank?.accountNumberEnc) return 'No account on file';
    const number = env.expenseEmailFullAccount && bank.accountNumberEnc ? decryptField(bank.accountNumberEnc) : maskAccount(bank.accountLast4);
    return `${esc(bank.bankName || '—')} · ${esc(bank.accountName || '—')} · ${esc(number)}`;
  };

  const rows = claim.items.map((it: any, i: number) => [
    String(i + 1),
    `${esc(it.category)}<br><span style="color:#6b6478">${esc(it.description)}</span>`,
    esc(it.boughtBy?.name || '—') + (it.boughtBy?.kind === 'other' ? ' <em>(external)</em>' : ''),
    esc({ company_paid: 'Company paid', paid_personally: 'Paid personally — reimburse', awaiting_disbursement: 'Awaiting company to disburse' }[it.paymentMode as string] || it.paymentMode),
    `${(it.attachments || []).length}${(it.flags || []).length ? ' ⚠' : ''}`,
    esc(money(it.amount + (it.tax?.vatAmount || 0), cur)),
  ]);

  let body =
    kvTable([
      ['Claim', claim.claimNo],
      ['Title', claim.title],
      ['Employee', `${full?.name || submitter.name}${full?.employeeNo ? ` (${full.employeeNo})` : ''}`],
      ['Role / department', `${full?.jobTitle || '—'} · ${full?.department || '—'}`],
      ['Email / phone', `${full?.email || ''} ${full?.phone ? `· ${full.phone}` : ''}`],
      ['Submitted', fmtDate(claim.submittedAt)],
      ['Total', money(claim.totals.total, cur)],
      ['Company paid', money(claim.totals.companyPaid, cur)],
      ['Paid personally (reimburse)', money(claim.totals.reimbursable, cur)],
      ['Awaiting company to disburse', money(claim.totals.toDisburse, cur)],
    ]) +
    `<h3 style="margin:18px 0 6px;font-size:15px">Items (${claim.items.length})</h3>` +
    dataTable(['#', 'Category / description', 'Bought / done by', 'Payment', 'Receipts', 'Amount'], rows);

  if (personal.length || awaiting.length) {
    body += `<h3 style="margin:18px 0 6px;font-size:15px">Account information</h3>` + kvTable([['Employee account', acct(full?.bankAccount)]]);
    const external = claim.items.filter((i: any) => i.boughtBy?.kind === 'other' && i.paymentMode !== 'company_paid' && (i.payee?.accountLast4 || i.payee?.bankName));
    if (external.length) {
      const exWithSecret = await ExpenseClaim.findById(claim._id).select('+items.payee.accountNumberEnc').lean() as any;
      body += kvTable(external.map((i: any) => {
        const src = exWithSecret.items.find((x: any) => String(x._id) === String(i._id));
        return [`${i.boughtBy.name} (item ${claim.items.indexOf(i) + 1})`, acct(src?.payee)] as [string, string];
      }));
    }
  }
  if (awaiting.length) body += callout(`<strong>Awaiting company to disburse:</strong> ${awaiting.length} item(s) totalling ${esc(money(claim.totals.toDisburse, cur))} were requested as funds the company must release to the employee before/for purchase.`, 'warn');
  if (personal.length) body += callout(`<strong>Paid personally:</strong> ${personal.length} item(s) totalling ${esc(money(claim.totals.reimbursable, cur))} were paid from the employee's own money and need reimbursing once approved.`, 'info');
  const flagged = claim.items.filter((i: any) => (i.flags || []).length).length;
  if (flagged) body += callout(`${flagged} item(s) carry review flags (missing receipt or possible duplicate). Check them before approving.`, 'danger');
  if (env.expenseEmailFullAccount && (personal.length || awaiting.length)) body += `<p style="font-size:12px;color:#8a8398">This e-mail contains full bank details. Treat it as confidential and delete it after payment.</p>`;

  const mail = renderEmail({
    title: `${awaiting.length ? 'Disbursement requested · ' : ''}New expense claim ${claim.claimNo}`,
    intro: `${esc(submitter.name)} submitted an expense claim for review.`,
    body, cta: { label: 'Review claim', path: `/expenses?claim=${claim._id}` },
  });
  const subject = `${awaiting.length ? '[Awaiting disbursement] ' : ''}Expense claim ${claim.claimNo} — ${submitter.name} — ${money(claim.totals.total, cur)}`;
  await Promise.all(to.map((u) => sendMail({ to: u.email, subject, html: mail.html, attachments: mail.attachments }).catch(() => undefined)));
  await notify({
    organizationId: String(claim.organizationId), userIds: to.map((u) => String(u._id)),
    title: `Expense claim ${claim.claimNo} awaiting review`, body: `${submitter.name} · ${money(claim.totals.total, cur)}${awaiting.length ? ' · disbursement requested' : ''}`,
    link: `/expenses?claim=${claim._id}`, type: 'expense', severity: awaiting.length ? 'warning' : 'info',
  });
}

/* ---------------------------------- Create / list -------------------------- */
router.post('/', asyncHandler(async (req, res) => {
  const b = req.body || {};
  if (!b.title || !String(b.title).trim()) throw ApiError.badRequest('Give the claim a title.');
  const currency = ['NGN', 'USD', 'GBP', 'EUR'].includes(b.currency) ? b.currency : 'NGN';
  const rate = await resolveRate(currency);
  let invoiceLink: { invoiceId?: string; invoiceNo?: string } = {};
  if (b.invoiceId) {
    if (!/^[a-f\d]{24}$/i.test(String(b.invoiceId))) throw ApiError.badRequest('That invoice link is not valid.');
    const inv: any = await Invoice.findOne(excludeDeleted({ _id: b.invoiceId, organizationId: req.user!.organizationId })).select('invoiceNo');
    if (!inv) throw ApiError.badRequest('The invoice for this expense was not found.');
    invoiceLink = { invoiceId: String(inv._id), invoiceNo: inv.invoiceNo };
  }
  const claim: any = new ExpenseClaim({
    ...invoiceLink,
    organizationId: req.user!.organizationId,
    claimNo: await nextNumber(req.user!.organizationId, 'EXP', { yearly: true }),
    title: String(b.title).trim().slice(0, 160),
    purpose: b.purpose ? String(b.purpose).slice(0, 1000) : undefined,
    submittedById: req.user!.id, submittedByName: req.user!.name,
    currency, exchangeRate: rate,
    items: await buildItems(b.items, req),
    attachments: cleanAttachments(b.attachments, req.user!.organizationId),
    status: 'draft',
  });
  const submit = b.submit === true || b.submit === 'true';
  if (submit) { claim.status = 'submitted'; claim.submittedAt = new Date(); }
  computeExpenseClaim(claim);
  claim.settlement = { required: claim.totals.reimbursable + claim.totals.toDisburse > 0 };
  await flagItems(claim, rate);
  claim.history.push({ byId: req.user!.id, byName: req.user!.name, action: submit ? 'submitted' : 'created_draft' });
  await claim.save();
  await audit(req, submit ? 'expense.submitted' : 'expense.draft_created', 'ExpenseClaim', String(claim._id), { module: 'expenses', summary: `${claim.claimNo} · ${claim.items.length} item(s) · ${claim.totals.total} ${currency}` });
  if (submit) await notifyFinance(claim, { name: req.user!.name }, req);
  res.status(201).json({ success: true, data: claim });
}));

router.get('/', asyncHandler(async (req, res) => {
  const { status, scope, q, page = '1', limit = '20' } = req.query as Record<string, string>;
  const filter: any = { organizationId: req.user!.organizationId };
  const all = canApprove(req) && scope !== 'mine';
  if (!all) filter.submittedById = req.user!.id;
  else filter.status = { $ne: 'draft' }; // drafts stay private to their author
  if (status) filter.status = status;
  if (q) filter.$or = [{ claimNo: { $regex: String(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } }, { title: { $regex: String(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } }];
  const p = Math.max(parseInt(page, 10) || 1, 1), l = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
  const [items, total, summary] = await Promise.all([
    ExpenseClaim.find(excludeDeleted(filter)).select('-items.attachments').sort('-createdAt').skip((p - 1) * l).limit(l),
    ExpenseClaim.countDocuments(excludeDeleted(filter)),
    ExpenseClaim.aggregate([{ $match: { organizationId: new (require('mongoose').Types.ObjectId)(req.user!.organizationId), isDeleted: { $ne: true }, ...(all ? { status: { $ne: 'draft' } } : { submittedById: new (require('mongoose').Types.ObjectId)(req.user!.id) }) } }, { $group: { _id: '$status', n: { $sum: 1 }, total: { $sum: '$totals.total' }, payable: { $sum: '$totals.payable' } } }]),
  ]);
  res.json({ success: true, data: items, summary, scope: all ? 'all' : 'mine', pagination: { page: p, limit: l, total, pages: Math.ceil(total / l) } });
}));

async function loadClaim(req: any, id: string) {
  const claim: any = await ExpenseClaim.findOne(excludeDeleted({ _id: id, organizationId: req.user.organizationId }));
  if (!claim) throw ApiError.notFound('Expense claim not found');
  const own = String(claim.submittedById) === req.user.id;
  if (!own && !(canApprove(req) && claim.status !== 'draft')) throw ApiError.forbidden('You cannot view this claim.');
  return { claim, own };
}

router.get('/:id', asyncHandler(async (req, res) => {
  const { claim, own } = await loadClaim(req, req.params.id);
  const obj = claim.toObject();
  const submitter = await User.findById(claim.submittedById).select('name email phone jobTitle department employeeNo bankAccount.bankName bankAccount.accountName bankAccount.accountLast4');
  res.json({ success: true, data: obj, submitter, canDecide: canApprove(req) && !own && ['submitted', 'partially_approved'].includes(claim.status) });
}));

/** Full payee account — audited. Needs the approvals module (or the owner). */
router.post('/:id/reveal-account', asyncHandler(async (req, res) => {
  const { claim, own } = await loadClaim(req, req.params.id);
  if (!own && !hasModule(req, 'expense_approvals', 'employee_sensitive')) throw ApiError.forbidden('Not allowed.');
  const emp: any = await User.findById(claim.submittedById).select('+bankAccount.accountNumberEnc name bankAccount');
  const withSecret: any = await ExpenseClaim.findById(claim._id).select('+items.payee.accountNumberEnc').lean();
  await audit(req, 'expense.account_revealed', 'ExpenseClaim', String(claim._id), { module: 'expenses', severity: 'high', summary: `Account details viewed on ${claim.claimNo}` });
  res.json({
    success: true,
    data: {
      employee: emp?.bankAccount?.accountNumberEnc ? { name: emp.name, bankName: emp.bankAccount.bankName, accountName: emp.bankAccount.accountName, accountNumber: decryptField(emp.bankAccount.accountNumberEnc) } : null,
      external: withSecret.items.filter((i: any) => i.payee?.accountNumberEnc).map((i: any) => ({ itemId: i._id, name: i.boughtBy?.name, bankName: i.payee.bankName, accountName: i.payee.accountName, accountNumber: decryptField(i.payee.accountNumberEnc) })),
    },
  });
}));

/* --------------------------------- Edit / submit --------------------------- */
router.put('/:id', asyncHandler(async (req, res) => {
  const { claim, own } = await loadClaim(req, req.params.id);
  if (!own) throw ApiError.forbidden('Only the author can edit a claim.');
  if (!['draft', 'rejected'].includes(claim.status)) throw ApiError.conflict('Only drafts or rejected claims can be edited.');
  const b = req.body || {};
  const withSecret: any = await ExpenseClaim.findById(claim._id).select('+items.payee.accountNumberEnc');
  if (b.title !== undefined) claim.title = String(b.title).trim().slice(0, 160);
  if (b.purpose !== undefined) claim.purpose = String(b.purpose).slice(0, 1000);
  if (b.currency && ['NGN', 'USD', 'GBP', 'EUR'].includes(b.currency)) { claim.currency = b.currency; claim.exchangeRate = await resolveRate(b.currency); }
  if (b.items) claim.items = await buildItems(b.items, req, withSecret.items);
  if (b.attachments) claim.attachments = cleanAttachments(b.attachments, req.user!.organizationId);
  const submit = b.submit === true || b.submit === 'true';
  claim.status = submit ? 'submitted' : 'draft';
  if (submit) claim.submittedAt = new Date();
  computeExpenseClaim(claim);
  claim.settlement.required = claim.totals.reimbursable + claim.totals.toDisburse > 0;
  await flagItems(claim, claim.exchangeRate);
  claim.history.push({ byId: req.user!.id, byName: req.user!.name, action: submit ? 'resubmitted' : 'edited' });
  await claim.save();
  await audit(req, submit ? 'expense.submitted' : 'expense.edited', 'ExpenseClaim', String(claim._id), { module: 'expenses', summary: claim.claimNo });
  if (submit) await notifyFinance(claim, { name: req.user!.name }, req);
  res.json({ success: true, data: claim });
}));

router.post('/:id/submit', asyncHandler(async (req, res) => {
  const { claim, own } = await loadClaim(req, req.params.id);
  if (!own) throw ApiError.forbidden('Only the author can submit.');
  if (claim.status !== 'draft') throw ApiError.conflict('Only drafts can be submitted.');
  claim.status = 'submitted';
  claim.submittedAt = new Date();
  computeExpenseClaim(claim);
  await flagItems(claim, claim.exchangeRate);
  claim.history.push({ byId: req.user!.id, byName: req.user!.name, action: 'submitted' });
  await claim.save();
  await audit(req, 'expense.submitted', 'ExpenseClaim', String(claim._id), { module: 'expenses', summary: claim.claimNo });
  await notifyFinance(claim, { name: req.user!.name }, req);
  res.json({ success: true, data: claim });
}));

router.post('/:id/cancel', asyncHandler(async (req, res) => {
  const { claim, own } = await loadClaim(req, req.params.id);
  if (!own) throw ApiError.forbidden('Only the author can cancel.');
  if (!['draft', 'submitted'].includes(claim.status)) throw ApiError.conflict('This claim can no longer be cancelled.');
  claim.status = 'cancelled';
  claim.history.push({ byId: req.user!.id, byName: req.user!.name, action: 'cancelled' });
  await claim.save();
  await audit(req, 'expense.cancelled', 'ExpenseClaim', String(claim._id), { module: 'expenses', summary: claim.claimNo });
  res.json({ success: true, data: claim });
}));

/* ---------------------------------- Decision ------------------------------- */
// body: { decisions: [{ itemId, decision: 'approved'|'rejected', note }], note }  or  { decision: 'approved'|'rejected', note } for all items
router.post('/:id/decision', requireModule('expense_approvals'), asyncHandler(async (req, res) => {
  const { claim, own } = await loadClaim(req, req.params.id);
  if (own && env.fourEyes) throw ApiError.forbidden('You cannot decide your own expense claim — another approver must.');
  if (!['submitted', 'partially_approved'].includes(claim.status)) throw ApiError.conflict('This claim is not awaiting a decision.');
  const b = req.body || {};
  const decisions: Array<{ itemId?: string; decision: string; note?: string }> = Array.isArray(b.decisions) ? b.decisions : claim.items.map((i: any) => ({ itemId: String(i._id), decision: b.decision, note: b.note }));
  for (const d of decisions) {
    if (!['approved', 'rejected'].includes(d.decision)) throw ApiError.badRequest('decision must be approved or rejected');
    const item = claim.items.id(d.itemId);
    if (!item) throw ApiError.badRequest('Unknown item in decision.');
    if (d.decision === 'rejected' && !(d.note || b.note)) throw ApiError.badRequest('Give a reason when rejecting an item.');
    item.decision = d.decision;
    item.decisionNote = d.note ? String(d.note).slice(0, 500) : undefined;
  }
  const states = claim.items.map((i: any) => i.decision);
  if (states.includes('pending')) claim.status = 'partially_approved';
  else if (states.every((s: string) => s === 'rejected')) claim.status = 'rejected';
  else claim.status = states.includes('rejected') ? 'partially_approved' : 'approved';
  // fully decided partial claims are treated as approved for the approved lines
  if (!states.includes('pending') && states.includes('approved') && states.includes('rejected')) claim.status = 'approved';
  claim.decidedById = req.user!.id; claim.decidedAt = new Date(); claim.decisionNote = b.note ? String(b.note).slice(0, 500) : undefined;
  computeExpenseClaim(claim);
  claim.settlement.required = claim.totals.payable > 0;
  claim.history.push({ byId: req.user!.id, byName: req.user!.name, action: `decision:${claim.status}`, note: b.note });
  await claim.save();
  await audit(req, `expense.${claim.status}`, 'ExpenseClaim', String(claim._id), { module: 'expense_approvals', severity: 'medium', summary: `${claim.claimNo} ${claim.status}`, meta: { approved: states.filter((s: string) => s === 'approved').length, rejected: states.filter((s: string) => s === 'rejected').length } });
  await notify({
    organizationId: String(claim.organizationId), userIds: [String(claim.submittedById)],
    title: `Expense claim ${claim.claimNo} ${claim.status.replace('_', ' ')}`, body: claim.decisionNote || `Approved total: ${money(claim.totals.approvedTotal, claim.currency)}`,
    link: `/expenses?claim=${claim._id}`, type: 'expense', severity: claim.status === 'rejected' ? 'warning' : 'info', email: { intro: `Your expense claim ${esc(claim.claimNo)} is now <strong>${esc(claim.status.replace('_', ' '))}</strong>.` },
  });
  res.json({ success: true, data: claim });
}));

/* ------------------------------ Mark reimbursed / disbursed ----------------- */
router.post('/:id/pay', requireModule('expense_approvals'), asyncHandler(async (req, res) => {
  const { claim, own } = await loadClaim(req, req.params.id);
  if (own && env.fourEyes) throw ApiError.forbidden('You cannot settle your own claim.');
  if (!['approved'].includes(claim.status)) throw ApiError.conflict('Only approved claims can be marked as paid.');
  const method = ['bank_transfer', 'cash', 'payroll', 'other'].includes(req.body.method) ? req.body.method : 'bank_transfer';
  claim.status = 'paid';
  claim.settlement = { ...(claim.settlement?.toObject?.() || {}), required: true, paidById: req.user!.id, paidAt: new Date(), method, reference: req.body.reference ? String(req.body.reference).slice(0, 120) : undefined, amount: claim.totals.payable };
  claim.history.push({ byId: req.user!.id, byName: req.user!.name, action: 'paid', note: req.body.reference });
  await claim.save();
  // Tax trail: input VAT is recoverable, WHT deducted from payees must be remitted (NGN-equivalent).
  const rate = claim.currency === 'NGN' ? 1 : claim.exchangeRate || 1;
  for (const it of claim.items as any[]) {
    if (it.decision !== 'approved') continue;
    const party = it.tax?.payeeCompany || it.vendor || it.boughtBy?.name;
    if (it.tax?.vatAmount > 0) await recordTax(String(claim.organizationId), { nature: 'input_vat', kind: 'VAT', sourceType: 'expense', sourceId: it._id, sourceRef: claim.claimNo, partyName: party, transDate: claim.settlement.paidAt, baseAmount: Math.round(it.amount * rate * 100) / 100, rate: it.tax.vatRate, amount: Math.round(it.tax.vatAmount * rate * 100) / 100 });
    if (it.tax?.whtAmount > 0) await recordTax(String(claim.organizationId), { nature: 'wht_withheld_by_us', kind: 'WHT', sourceType: 'expense', sourceId: it._id, sourceRef: claim.claimNo, partyName: party, transDate: claim.settlement.paidAt, baseAmount: Math.round(it.amount * rate * 100) / 100, rate: it.tax.whtRate, amount: Math.round(it.tax.whtAmount * rate * 100) / 100 });
  }
  await audit(req, 'expense.paid', 'ExpenseClaim', String(claim._id), { module: 'expense_approvals', severity: 'high', summary: `${claim.claimNo} settled (${claim.totals.payable} ${claim.currency})` });
  await notify({ organizationId: String(claim.organizationId), userIds: [String(claim.submittedById)], title: `Expense claim ${claim.claimNo} paid`, body: `${money(claim.totals.payable, claim.currency)} paid by ${method.replace('_', ' ')}.`, link: `/expenses?claim=${claim._id}`, type: 'expense', email: {} });
  res.json({ success: true, data: claim });
}));

export default router;
