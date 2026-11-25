import { Schema, model } from 'mongoose';
import { stampPlugin } from '../utils/stampPlugin';
import { softDeletePlugin } from '../utils/softDeletePlugin';

const ref = (to: string, extra: object = {}) => ({ type: Schema.Types.ObjectId, ref: to, ...extra });
const org = { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true };

export const CURRENCIES = ['NGN', 'USD', 'GBP', 'EUR'] as const;

/* ------------------------------ Bank accounts (legacy "Accounts") ---------- */
const bankAccountSchema = new Schema(
  {
    organizationId: org,
    bankName: { type: String, required: true, trim: true },
    accountName: { type: String, required: true, trim: true },
    accountNumberEnc: { type: String, required: true, select: false },
    accountNumberHash: { type: String, required: true, select: false },
    accountLast4: { type: String, required: true },
    accountType: { type: String, enum: ['Current', 'Savings', 'Domiciliary', 'Escrow', 'Other'], default: 'Current' },
    currency: { type: String, enum: CURRENCIES, default: 'NGN' },
    purpose: { type: String, enum: ['collections', 'operations', 'payroll', 'tax', 'other'], default: 'collections' },
    sortCode: { type: String },
    swiftCode: { type: String },
    status: { type: String, enum: ['pending', 'active', 'inactive'], default: 'pending', index: true },
    createdById: ref('User'),
    approvedById: ref('User'),
    approvedAt: { type: Date },
    inactiveReason: { type: String },
  },
  { timestamps: true }
);
bankAccountSchema.index({ organizationId: 1, accountNumberHash: 1 }, { unique: true, partialFilterExpression: { isDeleted: { $ne: true } } });
bankAccountSchema.plugin(softDeletePlugin);
export const BankAccount = model('BankAccount', bankAccountSchema);

/* ------------------------------- Exchange & tax rates ---------------------- */
const exchangeRateSchema = new Schema(
  {
    organizationId: org,
    currency: { type: String, enum: ['USD', 'GBP', 'EUR'], required: true },
    rate: { type: Number, required: true, min: 0 }, // NGN per 1 unit
    rateDate: { type: Date, required: true },
    source: { type: String, default: 'CBN' },
    status: { type: String, enum: ['active', 'superseded'], default: 'active' },
    createdById: ref('User'),
  },
  { timestamps: true }
);
exchangeRateSchema.index({ organizationId: 1, currency: 1, rateDate: -1 });
exchangeRateSchema.plugin(softDeletePlugin);
export const ExchangeRate = model('ExchangeRate', exchangeRateSchema);

const taxRateSchema = new Schema(
  {
    organizationId: org,
    kind: { type: String, enum: ['VAT', 'WHT', 'OTHER'], required: true },
    name: { type: String, required: true },
    rate: { type: Number, required: true, min: 0, max: 100 },
    isDefault: { type: Boolean, default: false },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
    appliesTo: { type: String, enum: ['invoices', 'expenses', 'both'], default: 'both' },
    effectiveFrom: { type: Date },
    inactiveReason: { type: String },
  },
  { timestamps: true }
);
taxRateSchema.plugin(softDeletePlugin);
export const TaxRate = model('TaxRate', taxRateSchema);

/* ----------------------------------- Tax records --------------------------- */
// nature: output_vat (charged on invoices, payable) | input_vat (paid on expenses, recoverable)
//         wht_withheld_by_us (deducted from vendor payments, must be remitted) | wht_credit (deducted by clients, claimable)
const taxRecordSchema = new Schema(
  {
    organizationId: org,
    taxId: { type: String, required: true },
    kind: { type: String, enum: ['VAT', 'WHT'], required: true },
    nature: { type: String, enum: ['output_vat', 'input_vat', 'wht_withheld_by_us', 'wht_credit'], required: true, index: true },
    sourceType: { type: String, enum: ['invoice', 'expense', 'manual'], required: true },
    sourceId: { type: Schema.Types.ObjectId, index: true },
    sourceRef: { type: String },
    partyName: { type: String }, // client / vendor / payee
    transDate: { type: Date, required: true, index: true },
    baseAmount: { type: Number, required: true }, // NGN
    rate: { type: Number, required: true },
    amount: { type: Number, required: true }, // NGN
    currency: { type: String, default: 'NGN' },
    status: { type: String, enum: ['unpaid', 'paid', 'void'], default: 'unpaid', index: true },
    paidAt: { type: Date },
    paidById: ref('User'),
    paymentRef: { type: String },
    year: { type: Number, index: true },
    month: { type: Number },
    quarter: { type: String },
  },
  { timestamps: true }
);
taxRecordSchema.index({ organizationId: 1, taxId: 1 }, { unique: true });
taxRecordSchema.pre('validate', function (next) {
  const d = new Date(this.transDate as any);
  this.year = d.getFullYear();
  this.month = d.getMonth() + 1;
  this.quarter = `Q${Math.floor(d.getMonth() / 3) + 1}`;
  next();
});
export const TaxRecord = model('TaxRecord', taxRecordSchema);

/* ----------------------------------- Service catalogue --------------------- */
const serviceItemSchema = new Schema(
  {
    organizationId: org,
    name: { type: String, required: true, trim: true },
    type: { type: String, enum: ['Managed Services', 'Outsourcing', 'Consultation', 'Training', 'Licence', 'Rental', 'Other'], default: 'Other' },
    description: { type: String },
    defaultUnitFee: { type: Number, default: 0 },
    currency: { type: String, enum: CURRENCIES, default: 'NGN' },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);
serviceItemSchema.plugin(softDeletePlugin);
export const ServiceItem = model('ServiceItem', serviceItemSchema);

/* ----------------------------------- Invoices ------------------------------ */
export const INVOICE_TYPES = ['Managed Services', 'Outsourcing', 'Consultation', 'Training', 'Licence', 'Rental', 'Other'] as const;

const invoiceSchema = new Schema(
  {
    organizationId: org,
    invoiceNo: { type: String, required: true },
    referenceNo: { type: String },
    poNumber: { type: String },
    clientId: ref('Client', { required: true, index: true }),
    bankAccountId: ref('BankAccount', { required: true }),
    invoiceType: { type: String, enum: INVOICE_TYPES, default: 'Other' },
    templateType: { type: String, enum: ['standard', 'split'], default: 'standard' }, // "split" = amounts split between parties (legacy FCMB-style template)
    splitAmounts: [{ label: String, amount: Number, inWords: String, kind: { type: String, enum: ['wire', 'local'], default: 'local' }, wire: [{ label: String, value: String }] }],
    documentTitle: { type: String }, // banner on the invoice, e.g. "AUTHENTICATION SERVICES INVOICE" (defaults from the invoice type)
    periodStart: { type: Date },
    periodEnd: { type: Date },
    includeNaira: { type: Boolean, default: false }, // show the NGN equivalent column (foreign-currency invoices)
    rateSource: { type: String, enum: ['database', 'manual'], default: 'database' },
    rateOverrideReason: { type: String },
    instructions: [{ type: String }], // extra payment instructions printed on page 2
    legacy: { source: String, invoiceNo: String, status: String, referenceNumber: String },
    currency: { type: String, enum: CURRENCIES, default: 'NGN' },
    exchangeRate: { type: Number, default: 1 }, // NGN per unit of invoice currency
    rateDate: { type: Date },
    items: [{ group: { type: String, trim: true }, description: { type: String, required: true }, quantity: { type: Number, default: 1, min: 0 }, unitFee: { type: Number, default: 0, min: 0 }, amount: { type: Number, default: 0 } }],
    subtotal: { type: Number, default: 0 },
    vatRate: { type: Number, default: 7.5 },
    vatAmount: { type: Number, default: 0 },
    whtRate: { type: Number, default: 0 }, // withholding the client is expected to deduct
    whtAmount: { type: Number, default: 0 },
    total: { type: Number, default: 0 }, // subtotal + VAT (invoice currency)
    totalNgn: { type: Number, default: 0 },
    amountPaid: { type: Number, default: 0 }, // cash received
    whtCredited: { type: Number, default: 0 }, // WHT deducted by client on payments
    balance: { type: Number, default: 0 }, // total - amountPaid - whtCredited
    issueDate: { type: Date, required: true },
    dueDate: { type: Date, required: true, index: true },
    periodLabel: { type: String },
    notes: { type: String },
    status: { type: String, enum: ['draft', 'pending_approval', 'approved', 'sent', 'partially_paid', 'paid', 'rejected', 'void'], default: 'draft', index: true },
    rejectionReason: { type: String },
    createdById: ref('User'),
    submittedAt: { type: Date },
    approvedById: ref('User'),
    approvedAt: { type: Date },
    sentAt: { type: Date },
    paidAt: { type: Date },
    voidReason: { type: String },
    reminders: { count: { type: Number, default: 0 }, lastAt: { type: Date } },
    payments: [
      {
        amount: { type: Number, required: true },
        whtDeducted: { type: Number, default: 0 },
        paidOn: { type: Date, required: true },
        method: { type: String, enum: ['bank_transfer', 'cheque', 'cash', 'card', 'other'], default: 'bank_transfer' },
        reference: { type: String },
        /** proof of payment (bank slip, transfer confirmation) */
        receipt: { url: String, name: String, size: Number, addedById: ref('User'), addedAt: Date },
        recordedById: ref('User'),
        recordedAt: { type: Date, default: Date.now },
      },
    ],
    history: [{ at: { type: Date, default: Date.now }, byId: ref('User'), byName: String, action: String, note: String }],
  },
  { timestamps: true }
);
invoiceSchema.index({ organizationId: 1, invoiceNo: 1 }, { unique: true });
invoiceSchema.plugin(softDeletePlugin);
invoiceSchema.plugin(stampPlugin);
export const Invoice = model('Invoice', invoiceSchema);

export function computeInvoice(inv: any) {
  // Foreign-currency invoices keep 3 decimals (unit fees such as 0.045), NGN keeps 2 — same as the legacy invoices.
  const r = inv.currency === 'NGN' ? round2 : round3;
  inv.items.forEach((it: any) => (it.amount = r((it.quantity || 0) * (it.unitFee || 0))));
  inv.subtotal = r(inv.items.reduce((s: number, it: any) => s + it.amount, 0));
  inv.vatAmount = r((inv.subtotal * (inv.vatRate || 0)) / 100);
  inv.whtAmount = r((inv.subtotal * (inv.whtRate || 0)) / 100);
  inv.total = r(inv.subtotal + inv.vatAmount);
  inv.totalNgn = round2(inv.total * (inv.currency === 'NGN' ? 1 : inv.exchangeRate || 1));
  inv.amountPaid = r(inv.payments.reduce((s: number, p: any) => s + p.amount, 0));
  inv.whtCredited = r(inv.payments.reduce((s: number, p: any) => s + (p.whtDeducted || 0), 0));
  inv.balance = r(Math.max(inv.total - inv.amountPaid - inv.whtCredited, 0));
}

export const round3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;
export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
