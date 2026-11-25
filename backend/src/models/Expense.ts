import { Schema, model } from 'mongoose';
import { stampPlugin } from '../utils/stampPlugin';
import { softDeletePlugin } from '../utils/softDeletePlugin';
import { round2 } from './Finance';

const ref = (to: string, extra: object = {}) => ({ type: Schema.Types.ObjectId, ref: to, ...extra });

export const EXPENSE_CATEGORIES = [
  'Travel & Transport', 'Accommodation', 'Meals & Entertainment', 'Office Supplies', 'IT Equipment & Hardware', 'Software & Subscriptions',
  'Cloud & Hosting', 'Telecoms & Internet', 'Training & Certification', 'Professional Fees', 'Marketing & Events', 'Utilities & Rent',
  'Insurance', 'Bank Charges', 'Client Entertainment', 'Maintenance & Repairs', 'Security Services', 'Taxes & Levies', 'Other',
] as const;

export const PAYMENT_MODES = ['company_paid', 'paid_personally', 'awaiting_disbursement'] as const;

const attachmentSchema = new Schema(
  {
    url: { type: String, required: true },
    name: { type: String },
    mimeType: { type: String },
    size: { type: Number },
    kind: { type: String, enum: ['receipt', 'image', 'invoice', 'other'], default: 'receipt' },
  },
  { _id: true }
);

const itemSchema = new Schema({
  category: { type: String, enum: EXPENSE_CATEGORIES, required: true },
  description: { type: String, required: true, trim: true },
  vendor: { type: String, trim: true },
  date: { type: Date, required: true },
  quantity: { type: Number, default: 1, min: 0 },
  unitAmount: { type: Number, default: 0, min: 0 },
  amount: { type: Number, required: true, min: 0 }, // net line amount in claim currency (quantity × unitAmount unless entered directly)
  // Who bought / did it. "employee" = pick a person from the directory, "other" = type a name.
  boughtBy: {
    kind: { type: String, enum: ['employee', 'other'], default: 'employee' },
    employeeId: ref('User'),
    name: { type: String }, // snapshot of the employee name, or the typed name for "other"
    contact: { type: String },
  },
  // How it was paid: company already paid · the person paid personally (reimburse) · awaiting company to disburse funds
  paymentMode: { type: String, enum: PAYMENT_MODES, default: 'paid_personally' },
  // Payee account — used when the person is "other" (employees use the encrypted account on their profile)
  payee: {
    bankName: String,
    accountName: String,
    accountNumberEnc: { type: String, select: false },
    accountLast4: String,
  },
  tax: {
    whtEnabled: { type: Boolean, default: false },
    whtRate: { type: Number, default: 0 },
    vatEnabled: { type: Boolean, default: false },
    vatRate: { type: Number, default: 0 },
    payeeCompany: { type: String },
    whtAmount: { type: Number, default: 0 },
    vatAmount: { type: Number, default: 0 },
  },
  projectId: ref('Project'),
  clientId: ref('Client'),
  notes: { type: String },
  attachments: [attachmentSchema], // multiple receipts / photos per item
  decision: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  decisionNote: { type: String },
  flags: [{ type: String }], // possible_duplicate | missing_receipt | over_threshold
});

const expenseClaimSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    claimNo: { type: String, required: true },
    title: { type: String, required: true, trim: true },
    purpose: { type: String },
    /** an expense raised against an invoice (cost of delivering it) */
    invoiceId: ref('Invoice', { index: true }),
    invoiceNo: { type: String },
    submittedById: ref('User', { required: true, index: true }),
    submittedByName: { type: String },
    currency: { type: String, enum: ['NGN', 'USD', 'GBP', 'EUR'], default: 'NGN' },
    exchangeRate: { type: Number, default: 1 },
    items: [itemSchema],
    attachments: [attachmentSchema], // claim-level documents (e.g. consolidated statement)
    totals: {
      total: { type: Number, default: 0 },
      approvedTotal: { type: Number, default: 0 },
      companyPaid: { type: Number, default: 0 },
      reimbursable: { type: Number, default: 0 }, // paid personally
      toDisburse: { type: Number, default: 0 }, // awaiting company disbursement
      wht: { type: Number, default: 0 },
      vat: { type: Number, default: 0 },
      payable: { type: Number, default: 0 }, // approved reimbursable + disbursable, net of WHT
    },
    status: { type: String, enum: ['draft', 'submitted', 'approved', 'partially_approved', 'rejected', 'paid', 'cancelled'], default: 'draft', index: true },
    submittedAt: { type: Date },
    decidedById: ref('User'),
    decidedAt: { type: Date },
    decisionNote: { type: String },
    settlement: {
      required: { type: Boolean, default: false },
      paidById: ref('User'),
      paidAt: { type: Date },
      method: { type: String, enum: ['bank_transfer', 'cash', 'payroll', 'other'] },
      reference: { type: String },
      amount: { type: Number },
    },
    history: [{ at: { type: Date, default: Date.now }, byId: ref('User'), byName: String, action: String, note: String }],
  },
  { timestamps: true }
);
expenseClaimSchema.index({ organizationId: 1, claimNo: 1 }, { unique: true });
expenseClaimSchema.index({ organizationId: 1, submittedById: 1, createdAt: -1 });
expenseClaimSchema.plugin(softDeletePlugin);
expenseClaimSchema.plugin(stampPlugin);

export function computeExpenseClaim(claim: any) {
  const t = { total: 0, approvedTotal: 0, companyPaid: 0, reimbursable: 0, toDisburse: 0, wht: 0, vat: 0, payable: 0 };
  for (const it of claim.items) {
    if (it.unitAmount && (!it.amount || it.amount === 0)) it.amount = round2((it.quantity || 1) * it.unitAmount);
    it.amount = round2(it.amount || 0);
    if (it.tax?.whtEnabled) it.tax.whtAmount = round2((it.amount * (it.tax.whtRate || 0)) / 100);
    else if (it.tax) it.tax.whtAmount = 0;
    if (it.tax?.vatEnabled) it.tax.vatAmount = round2((it.amount * (it.tax.vatRate || 0)) / 100);
    else if (it.tax) it.tax.vatAmount = 0;
    // amount = net of VAT; VAT (if enabled) is added on top and WHT is deducted from the net — same arithmetic as the legacy app (amountDue = amount − WHT + VAT).
    const gross = round2(it.amount + (it.tax?.vatAmount || 0));
    t.total += gross;
    if (it.decision === 'rejected') continue;
    const counted = claim.status === 'draft' || claim.status === 'submitted' || it.decision === 'approved';
    if (!counted) continue;
    if (it.decision === 'approved') t.approvedTotal += gross;
    t.wht += it.tax?.whtAmount || 0;
    t.vat += it.tax?.vatAmount || 0;
    if (it.paymentMode === 'company_paid') t.companyPaid += gross;
    else if (it.paymentMode === 'paid_personally') t.reimbursable += gross;
    else t.toDisburse += gross;
    if (it.paymentMode !== 'company_paid') t.payable += gross - (it.tax?.whtAmount || 0);
  }
  Object.keys(t).forEach((k) => ((t as any)[k] = round2((t as any)[k])));
  claim.totals = t;
}

export const ExpenseClaim = model('ExpenseClaim', expenseClaimSchema);
