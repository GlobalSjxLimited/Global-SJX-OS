/**
 * Legacy Global-SJX  →  GLOBAL SJX OS migration.
 *
 *   npm run migrate:legacy -- inspect                       what is in the old DB (fields, counts, samples)
 *   npm run migrate:legacy -- dry-run                       do everything EXCEPT write; validates every record and prints a report
 *   npm run migrate:legacy -- apply --confirm-backup        write to the new DB (idempotent — safe to re-run)
 *   npm run migrate:legacy -- verify                        reconcile counts and money totals between old and new
 *   npm run migrate:legacy -- rollback --batch <id>         remove exactly what one apply run created
 *
 * Options: --org <organizationId>  --only clients,invoices  --create-missing-clients  --force (rollback records edited since import)
 *
 * Safety: the old DB is only ever READ (use a read-only Mongo user). Passwords and 2FA secrets are never copied. Every old
 * document is also kept, encrypted, in `legacyarchives`, so nothing is lost even where there is no matching field yet.
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { env } from '../src/config/env';
import { encryptField, blindIndex, last4 } from '../src/utils/crypto';
import { Organization } from '../src/models/Organization';
import { User } from '../src/models/User';
import { Client } from '../src/models/Client';
import { BankAccount, ExchangeRate, TaxRate, TaxRecord, ServiceItem, Invoice, computeInvoice, round2 } from '../src/models/Finance';
import { ExpenseClaim, computeExpenseClaim, EXPENSE_CATEGORIES } from '../src/models/Expense';
import { Asset, CATEGORIES } from '../src/models/Asset';
import { LegacyMap, LegacyArchive } from '../src/models/Controls';
import { nextNumber } from '../src/models/Access';
import { appendEvent } from '../src/utils/assetAudit';

/* ================================ configuration ============================ */
/** Old role → new role. Edit to taste. Anything not listed becomes "employee". */
const ROLE_MAP: Record<string, string> = {
  superadmin: 'super_admin', super_admin: 'super_admin', admin: 'coo', ceo: 'ceo', coo: 'coo',
  backoffice: 'finance', back_office: 'finance', 'back office': 'finance', frontoffice: 'finance', front_office: 'finance', finance: 'finance', hr: 'hr', sales: 'sales',
};
/** Printed on legacy "fcmb"/split invoices for the foreign beneficiary (taken from your old EJS template). Edit if it has changed. */
const LEGACY_WIRE = [
  { label: 'PAY TO:', value: 'CITIBANK N.A, DELAWARE, USA' }, { label: 'ROUTING & TRANSIT #:', value: 'FW: 031100209' },
  { label: 'SWIFT CODE:', value: 'CITIUS33' }, { label: 'FOR CREDIT OF:', value: 'WIBMO INC' }, { label: 'FINAL CREDIT ACCOUNT #:', value: '54185434' },
];
const SKIP_COLLECTIONS = ['sessions', 'joblocks', 'notifications']; // noise — not archived unless --archive-all
const SECRET_KEYS = /pass(word)?|secret|token|otp|twofactor|2fa|hash|salt|apikey|authorization/i;

/* ================================ CLI ====================================== */
const argv = process.argv.slice(2);
const mode = argv[0] || '';
const flag = (n: string) => argv.includes(`--${n}`);
const opt = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const ONLY = opt('only')?.split(',').map((s) => s.trim());
const OLD_URI = process.env.OLD_MONGO_URI || '';
const APPLY = mode === 'apply';

/* ================================ helpers ================================== */
const pick = (d: any, keys: string[]) => { for (const k of keys) { const v = d?.[k]; if (v !== undefined && v !== null && v !== '') return v; } return undefined; };
const num = (v: any, def = 0) => { const n = typeof v === 'string' ? Number(v.replace(/[, ]/g, '')) : Number(v); return Number.isFinite(n) ? n : def; };
const str = (v: any) => (v === undefined || v === null ? undefined : String(v).trim() || undefined);
const dt = (v: any) => { if (!v) return undefined; const d = new Date(v); return isNaN(+d) ? undefined : d; };
const lid = (v: any) => (v === undefined || v === null ? '' : String(v));
const first = (v: any) => (Array.isArray(v) ? v.find(Boolean) : v);
const arr = (v: any): any[] => (Array.isArray(v) ? v : v ? [v] : []);
const ymd = (d?: Date) => (d ? d.toISOString().slice(0, 10) : '');

interface Stat { read: number; created: number; skipped: number; failed: number; warnings: number }
const stats: Record<string, Stat> = {};
const issues: Array<{ source: string; legacyId: string; level: 'error' | 'warn' | 'info'; msg: string }> = [];
const S = (k: string) => (stats[k] ||= { read: 0, created: 0, skipped: 0, failed: 0, warnings: 0 });
const issue = (source: string, legacyId: string, level: 'error' | 'warn' | 'info', msg: string) => { issues.push({ source, legacyId, level, msg }); if (level === 'error') S(source).failed++; if (level === 'warn') S(source).warnings++; };

const BATCH = opt('batch') || `${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}-${crypto.randomBytes(2).toString('hex')}`;
const idMap = new Map<string, mongoose.Types.ObjectId>(); // `${source}:${legacyId}` → new _id
const key = (s: string, l: string) => `${s}:${l}`;
const mapped = (s: string, l: any) => idMap.get(key(s, lid(l)));
let ORG = '';
let ACTOR: any = null;
let oldDb: mongoose.mongo.Db;

async function save(source: string, legacyId: string, target: string, doc: any, checksum?: string) {
  const err = doc.validateSync?.();
  if (err) throw new Error(`validation: ${Object.values((err as any).errors || {}).map((e: any) => e.message).join('; ') || err.message}`);
  if (APPLY) {
    await doc.save();
    await LegacyMap.create({ organizationId: ORG, source, legacyId, target, targetId: doc._id, batchId: BATCH, checksum });
  }
  idMap.set(key(source, legacyId), doc._id);
  S(source).created++;
}

function clean(v: any, depth = 0): any {
  if (v === null || v === undefined) return v;
  if (v instanceof Date) return v.toISOString();
  if (v && typeof v === 'object' && (v as any)._bsontype === 'ObjectId') return String(v);
  if (typeof v === 'string') return v.length > 2000 && /^data:/.test(v) ? '[file stored separately]' : v;
  if (Array.isArray(v)) return depth > 6 ? '[…]' : v.map((x) => clean(x, depth + 1));
  if (typeof v === 'object') { const o: any = {}; for (const [k, x] of Object.entries(v)) o[k] = SECRET_KEYS.test(k) ? '[removed]' : clean(x, depth + 1); return o; }
  return v;
}
async function archive(source: string, d: any) {
  if (!APPLY) return;
  const legacyId = lid(d._id);
  try { await LegacyArchive.updateOne({ organizationId: ORG, source, legacyId }, { $setOnInsert: { organizationId: ORG, source, legacyId, payloadEnc: encryptField(JSON.stringify(clean(d))), batchId: BATCH } }, { upsert: true }); }
  catch (e: any) { issue(source, legacyId, 'warn', `archive failed: ${e.message}`); }
}

const MIME_OK: Record<string, { ext: string; sig: string }> = { 'image/png': { ext: 'png', sig: '89504e47' }, 'image/jpeg': { ext: 'jpg', sig: 'ffd8ff' }, 'application/pdf': { ext: 'pdf', sig: '25504446' }, 'image/webp': { ext: 'webp', sig: '52494646' }, 'image/gif': { ext: 'gif', sig: '47494638' } };
function storeDataUrl(legacyId: string, n: number, v: any, kind = 'receipt') {
  if (typeof v !== 'string' || !v.startsWith('data:')) return undefined;
  const m = /^data:([\w.+/-]+);base64,(.+)$/s.exec(v);
  if (!m || !MIME_OK[m[1]]) { issue('expenses', legacyId, 'warn', `attachment ${n}: unsupported or malformed file type`); return undefined; }
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 12 * 1024 * 1024) { issue('expenses', legacyId, 'warn', `attachment ${n}: larger than 12 MB — kept only in the archive`); return undefined; }
  if (!buf.subarray(0, 4).toString('hex').startsWith(MIME_OK[m[1]].sig.slice(0, 6))) { issue('expenses', legacyId, 'warn', `attachment ${n}: file content does not match its declared type — skipped`); return undefined; }
  const name = `legacy-${legacyId.slice(-10)}-${n}.${MIME_OK[m[1]].ext}`;
  if (APPLY) { const dir = path.resolve(__dirname, '../uploads', ORG); fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, name), buf); }
  return { url: `/api/uploads/${ORG}/${name}`, name, mimeType: m[1], size: buf.length, kind };
}

const col = (name: string) => oldDb.collection(name);
async function* each(name: string) {
  const cursor = col(name).find({}, { sort: { _id: 1 } });
  for await (const d of cursor) { S(name).read++; yield d; }
}
const enabled = (name: string) => !ONLY || ONLY.includes(name);

/* ================================ INSPECT ================================== */
async function inspect() {
  const names = (await oldDb.listCollections().toArray()).map((c) => c.name).sort();
  const out: any = {};
  for (const n of names) {
    const total = await col(n).countDocuments();
    const sample = await col(n).find({}).sort({ _id: -1 }).limit(200).toArray(); // newest 200 documents
    const fields: Record<string, { seen: number; types: Set<string>; example?: any }> = {};
    for (const d of sample) for (const [k, v] of Object.entries(d)) {
      const f = (fields[k] ||= { seen: 0, types: new Set() });
      f.seen++; f.types.add(Array.isArray(v) ? 'array' : v === null ? 'null' : (v as any)?._bsontype || typeof v);
      if (f.example === undefined && v !== null && v !== '') f.example = SECRET_KEYS.test(k) ? '[hidden]' : typeof v === 'string' ? (v.length > 40 ? v.slice(0, 37) + '…' : v) : Array.isArray(v) ? `[${v.length} items]` : typeof v === 'object' ? '{…}' : v;
    }
    out[n] = { count: total, fields: Object.fromEntries(Object.entries(fields).map(([k, f]) => [k, { pct: Math.round((f.seen / Math.max(sample.length, 1)) * 100), types: [...f.types].join('|'), example: f.example }])) };
    console.log(`\n■ ${n}  (${total} documents)`);
    for (const [k, f] of Object.entries<any>(out[n].fields)) console.log(`    ${k.padEnd(28)} ${String(f.pct).padStart(3)}%  ${String(f.types).padEnd(18)} ${f.example === undefined ? '' : JSON.stringify(f.example)}`);
  }
  writeReport('inspect', out);
}

/* ================================ MAPPERS ================================== */
const roleOf = (r: any) => ROLE_MAP[String(r || '').toLowerCase().replace(/[\s-]/g, '_')] || ROLE_MAP[String(r || '').toLowerCase()] || 'employee';
function departmentOf(v: any) {
  const s = String(v || '').toLowerCase();
  if (!s) return undefined;
  if (/govern|\bit\b|information tech|infosec/.test(s)) return 'IT & Governance';
  if (/risk|compliance/.test(s)) return 'Risk & Compliance';
  if (/cyber|security/.test(s)) return 'Cybersecurity';
  if (/cloud|infra/.test(s)) return 'Cloud & Infrastructure';
  if (/pay/.test(s)) return 'Payments';
  if (/financ|account|back/.test(s)) return 'Finance';
  if (/\bhr\b|human|people/.test(s)) return 'HR';
  if (/sale|business dev|front/.test(s)) return 'Sales';
  if (/market/.test(s)) return 'Marketing';
  if (/oper/.test(s)) return 'Operations';
  if (/exec|director|ceo|md/.test(s)) return 'Executive';
  return undefined;
}
const CAT_RULES: Array<[RegExp, string]> = [[/travel|transport|fuel|flight|uber|taxi|bolt/i, 'Travel & Transport'], [/hotel|accommodation|lodg/i, 'Accommodation'], [/meal|food|lunch|dinner|restaurant|entertain/i, 'Meals & Entertainment'], [/stationer|office|supply|supplies/i, 'Office Supplies'], [/laptop|hardware|computer|equipment|device|phone/i, 'IT Equipment & Hardware'], [/software|subscription|licen[cs]e|saas/i, 'Software & Subscriptions'], [/cloud|hosting|server|aws|azure|domain/i, 'Cloud & Hosting'], [/data|airtime|internet|telecom|mtn|glo|airtel/i, 'Telecoms & Internet'], [/train|cert|course|exam/i, 'Training & Certification'], [/legal|audit|consult|professional|fee/i, 'Professional Fees'], [/market|advert|event|promo/i, 'Marketing & Events'], [/rent|electric|utilit|power|nepa|diesel|water/i, 'Utilities & Rent'], [/insur/i, 'Insurance'], [/bank|charge/i, 'Bank Charges'], [/repair|maint/i, 'Maintenance & Repairs'], [/secur/i, 'Security Services'], [/tax|levy|vat|wht/i, 'Taxes & Levies']];
const expenseCategory = (v: any) => { const s = String(v || ''); const exact = EXPENSE_CATEGORIES.find((c) => c.toLowerCase() === s.toLowerCase()); if (exact) return exact; for (const [rx, c] of CAT_RULES) if (rx.test(s)) return c; return 'Other'; };
const INV_TYPE: Record<string, string> = { ACS_RBA: 'Managed Services', RBA_ACS: 'Managed Services', ACS_RENTAL: 'Managed Services', RBA_RENTAL: 'Managed Services', OUTSOURCING: 'Outsourcing', CONSULTATION: 'Consultation', TRAINING: 'Training', LICENSE: 'Licence', LICENCE: 'Licence', OTHER_INVOICES: 'Other' };
const currencyOf = (v: any) => { const c = String(v || 'NGN').toUpperCase(); return c === 'GDP' ? 'GBP' : ['NGN', 'USD', 'GBP', 'EUR'].includes(c) ? c : 'NGN'; };

/* ================================ STEPS ==================================== */
async function stepUsers(name: 'users' | 'employees') {
  const seen = new Set<string>();
  for await (const d of each(name)) {
    const id = lid(d._id);
    await archive(name, d);
    try {
      if (mapped(name, id)) { S(name).skipped++; continue; }
      const email = str(pick(d, ['email', 'Email', 'workEmail']))?.toLowerCase();
      if (!email) { issue(name, id, 'warn', 'no e-mail — kept in archive only'); S(name).skipped++; continue; }
      const existing = seen.has(email) || (await User.exists({ email }));
      if (existing) {
        const ex: any = await User.findOne({ email }).select('_id');
        if (ex) idMap.set(key(name, id), ex._id);
        S(name).skipped++; issue(name, id, 'info', `${email} already exists — linked to the existing account`); continue;
      }
      seen.add(email);
      const fullName = [str(pick(d, ['firstname', 'firstName'])), str(pick(d, ['surname', 'lastname', 'lastName']))].filter(Boolean).join(' ') || str(pick(d, ['name', 'fullName'])) || email.split('@')[0];
      const gone = ['inactive', 'deleted', 'disabled', 'terminated'].includes(String(d.status || '').toLowerCase()) || d.isActive === false || d.active === false || d.inactive === true || d.isDeleted === true;
      const role = name === 'users' ? roleOf(d.role) : 'employee';
      const u = new User({
        organizationId: ORG, name: fullName, email, role, jobTitle: str(pick(d, ['position', 'jobTitle', 'title'])), department: departmentOf(d.department),
        phone: str(pick(d, ['phoneNumber', 'phone'])), employeeNo: str(pick(d, ['userId', 'employeeId', 'employeeNo'])),
        passwordHash: bcrypt.hashSync(crypto.randomBytes(24).toString('hex'), 10), // never usable — credentials are re-issued from the Employees page
        loginEnabled: false, mustChangePassword: true, isActive: !gone, employmentStatus: gone ? 'offboarded' : 'active', dateJoined: dt(d.createdAt), createdAt: dt(d.createdAt),
      });
      await save(name, id, 'User', u);
      if (d.salary !== undefined) issue(name, id, 'info', 'salary kept encrypted in the archive (no salary field in the new system)');
    } catch (e: any) { issue(name, id, 'error', e.message); }
  }
}

async function stepClients() {
  for await (const d of each('clients')) {
    const id = lid(d._id);
    await archive('clients', d);
    try {
      if (mapped('clients', id)) { S('clients').skipped++; continue; }
      const name = str(pick(d, ['name', 'clientName', 'companyName']));
      if (!name) throw new Error('client has no name');
      const emails = arr(d.email).map(str).filter(Boolean) as string[], phones = arr(d.phone).map(str).filter(Boolean) as string[];
      const contacts = (emails.length ? emails : [undefined]).slice(0, 10).map((e, i) => ({ name, email: e, phone: phones[i] || (i === 0 ? phones[0] : undefined), isPrimary: i === 0 })).filter((c) => c.email || c.phone);
      const status = String(d.status || 'active').toLowerCase();
      const c = new Client({
        organizationId: ORG, name, address: str(d.address), contacts, status: status === 'inactive' || status === 'deleted' ? 'inactive' : status === 'pending' ? 'prospect' : 'active',
        isDeleted: status === 'deleted', createdAt: dt(d.createdAt), country: 'Nigeria',
      });
      await save('clients', id, 'Client', c);
    } catch (e: any) { issue('clients', id, 'error', e.message); }
  }
}

const bankByHash = new Map<string, any>();
async function stepAccounts() {
  for await (const d of each('accounts')) {
    const id = lid(d._id);
    await archive('accounts', d);
    try {
      if (mapped('accounts', id)) { S('accounts').skipped++; continue; }
      const number = str(pick(d, ['accountNumber', 'number']));
      if (!number) throw new Error('no account number');
      const hash = blindIndex(number);
      if (bankByHash.has(hash) || (await BankAccount.exists({ organizationId: ORG, accountNumberHash: hash }))) {
        const ex: any = bankByHash.get(hash) || (await BankAccount.findOne({ organizationId: ORG, accountNumberHash: hash }).select('_id'));
        idMap.set(key('accounts', id), ex._id); S('accounts').skipped++; issue('accounts', id, 'info', 'duplicate account number — linked to existing'); continue;
      }
      const st = String(d.status || 'active').toLowerCase();
      const b = new BankAccount({
        organizationId: ORG, bankName: str(d.bankName) || 'Unknown bank', accountName: str(d.accountName) || 'Unknown', accountNumberEnc: encryptField(number), accountNumberHash: hash, accountLast4: last4(number),
        currency: currencyOf(d.currency), status: st === 'active' ? 'active' : st === 'inactive' || st === 'deleted' ? 'inactive' : 'pending', approvedById: st === 'active' ? ACTOR?._id : undefined, approvedAt: st === 'active' ? new Date() : undefined,
        createdById: ACTOR?._id, isDeleted: st === 'deleted', createdAt: dt(d.createdAt),
      });
      await save('accounts', id, 'BankAccount', b);
      bankByHash.set(hash, b);
    } catch (e: any) { issue('accounts', id, 'error', e.message); }
  }
}

async function stepRates() {
  const rows: any[] = [];
  for await (const d of each('rates')) { await archive('rates', d); rows.push(d); }
  const live = rows.filter((d) => String(d.status || '').toLowerCase() !== 'deleted' && !d.isDeleted);
  const newest = live.reduce((m, d) => ((dt(pick(d, ['cbnratedate', 'rateDate', 'createdAt']))?.getTime() || 0) > (m ? dt(pick(m, ['cbnratedate', 'rateDate', 'createdAt']))!.getTime() : 0) ? d : m), null as any);
  for (const d of rows) {
    const id = lid(d._id);
    try {
      if (mapped('rates', id)) { S('rates').skipped++; continue; }
      const v = num(pick(d, ['value', 'rate']));
      if (v <= 0) throw new Error('rate is not a positive number');
      const r = new ExchangeRate({ organizationId: ORG, currency: currencyOf(pick(d, ['currency'])) === 'NGN' ? 'USD' : currencyOf(d.currency), rate: v, rateDate: dt(pick(d, ['cbnratedate', 'rateDate', 'createdAt'])) || new Date(), source: 'CBN (legacy)', status: newest && lid(newest._id) === id ? 'active' : 'superseded', isDeleted: String(d.status || '').toLowerCase() === 'deleted', createdAt: dt(d.createdAt) });
      await save('rates', id, 'ExchangeRate', r);
    } catch (e: any) { issue('rates', id, 'error', e.message); }
  }
}

async function stepVats() {
  for await (const d of each('vats')) {
    const id = lid(d._id);
    await archive('vats', d);
    try {
      if (mapped('vats', id)) { S('vats').skipped++; continue; }
      const kind = String(d.type || 'VAT').toUpperCase() === 'WHT' ? 'WHT' : String(d.type || 'VAT').toUpperCase() === 'VAT' ? 'VAT' : 'OTHER';
      const rate = num(d.value);
      const st = String(d.status || 'active').toLowerCase();
      await save('vats', id, 'TaxRate', new TaxRate({ organizationId: ORG, kind, name: `${kind} ${rate}%`, rate, isDefault: kind === 'VAT' && rate === 7.5 && st === 'active', status: st === 'active' ? 'active' : 'inactive', isDeleted: st === 'deleted', createdAt: dt(d.createdAt) }));
    } catch (e: any) { issue('vats', id, 'error', e.message); }
  }
}

async function stepServices() {
  for await (const d of each('services')) {
    const id = lid(d._id);
    await archive('services', d);
    try {
      if (mapped('services', id)) { S('services').skipped++; continue; }
      const name = str(pick(d, ['name', 'servicename', 'serviceName', 'title']));
      if (!name) throw new Error('service has no name');
      await save('services', id, 'ServiceItem', new ServiceItem({ organizationId: ORG, name, description: str(pick(d, ['description', 'servicedescription'])), defaultUnitFee: num(pick(d, ['unitFee', 'unit_fee', 'unitfee', 'price', 'fee', 'amount'])), active: String(d.status || 'active').toLowerCase() !== 'inactive', createdAt: dt(d.createdAt) }));
    } catch (e: any) { issue('services', id, 'error', e.message); }
  }
}

let placeholderBank: any = null;
async function bankFor(d: any) {
  const number = str(pick(d, ['accountNumber']));
  if (number) { const hash = blindIndex(number); const b = bankByHash.get(hash) || (await BankAccount.findOne({ organizationId: ORG, accountNumberHash: hash }).select('_id')); if (b) return b._id; }
  const any: any = [...bankByHash.values()][0] || (await BankAccount.findOne({ organizationId: ORG, isDeleted: { $ne: true } }).select('_id'));
  if (any && !number) return any._id;
  if (!placeholderBank) {
    const hash = blindIndex(`LEGACY-UNSPECIFIED-${ORG}`);
    placeholderBank = (await BankAccount.findOne({ organizationId: ORG, accountNumberHash: hash }).select('_id')) || new BankAccount({ organizationId: ORG, bankName: 'Legacy (unspecified)', accountName: 'Legacy invoices — account not recorded', accountNumberEnc: encryptField('0000000000'), accountNumberHash: hash, accountLast4: '0000', status: 'inactive' });
    if (APPLY && placeholderBank.isNew) await placeholderBank.save();
    issue('invoices', '-', 'warn', 'some invoices had no matching bank account — they point to the inactive placeholder "Legacy (unspecified)"; review them');
  }
  return placeholderBank._id;
}

async function clientFor(d: any) {
  const m = mapped('clients', d.clientId);
  if (m) return m;
  const name = str(pick(d, ['companyName', 'clientName']));
  if (name) {
    const ex: any = await Client.findOne({ organizationId: ORG, name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }).select('_id');
    if (ex) return ex._id;
    if (flag('create-missing-clients')) { const c = new Client({ organizationId: ORG, name, status: 'inactive', contacts: [] }); if (APPLY) await c.save(); idMap.set(key('clients', `name:${name}`), c._id); if (APPLY) await LegacyMap.create({ organizationId: ORG, source: 'clients-placeholder', legacyId: `name:${name}`, target: 'Client', targetId: c._id, batchId: BATCH }); issue('invoices', lid(d._id), 'warn', `client "${name}" not found — created a placeholder`); return c._id; }
  }
  return undefined;
}

const invSeen = new Set<string>();
const invoiceByNo = new Map<string, any>();
async function stepInvoices() {
  const actorId = ACTOR?._id;
  for await (const d of each('invoices')) {
    const id = lid(d._id);
    await archive('invoices', d);
    try {
      if (mapped('invoices', id)) { S('invoices').skipped++; continue; }
      const cur = currencyOf(d.currency);
      const clientId = await clientFor(d);
      if (!clientId) throw new Error(`client not found (clientId=${lid(d.clientId)}, companyName=${d.companyName || '-'}) — re-run with --create-missing-clients to create placeholders`);
      const start = dt(d.startDate), end = dt(d.endDate);
      const period = start && end ? `${start.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })} – ${end.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}` : '';
      const items: any[] = [];
      const addTx = (svc: any, label: string) => { for (const t of arr(svc?.transactions)) { const desc = str(pick(t, ['description', 'name'])); if (!desc) continue; items.push({ group: `${label}${period ? ` FOR PERIOD: ${period}` : ''}`, description: desc, quantity: num(pick(t, ['volume', 'quantity']), 1), unitFee: num(pick(t, ['unitfee_usd', 'unit_fee', 'unitFee'])) }); } };
      addTx(d.service1, 'AUTHENTICATION FEE'); addTx(d.service2, 'MONTHLY HOSTING FEE');
      for (const r of arr(d.roles)) if (str(r?.name)) items.push({ group: 'ROLES', description: str(r.name), quantity: num(r.count, 1), unitFee: num(r.unit_fee) });
      for (const s of arr(d.otherInvoiceServices)) { const n = [str(s.servicename), str(s.servicedescription)].filter(Boolean).join(' — '); if (n) items.push({ description: n, quantity: num(pick(s, ['trans_Count', 'quantity']), 1), unitFee: num(pick(s, ['unit_Fee', 'unitFee'])) }); }
      const legacyTotal = num(pick(d, d.taxOption === false ? ['totalInvoiceFee_usd', 'amountDue'] : ['totalInvoiceFeePlusVat_usd', 'totalInvoiceFee_usd', 'amountDue']));
      if (!items.length) { items.push({ description: `Legacy invoice ${d.invoiceNo || id} (line items not recorded)`, quantity: 1, unitFee: num(pick(d, ['totalInvoiceFee_usd', 'amountDue'])) }); issue('invoices', id, 'warn', 'no line items in the old record — created a single summary line'); }

      let no = str(d.invoiceNo) || `LEG-${id.slice(-8).toUpperCase()}`;
      if (invSeen.has(no) || (await Invoice.exists({ organizationId: ORG, invoiceNo: no }))) { const old = no; no = `${no}-L${id.slice(-4)}`; issue('invoices', id, 'warn', `invoice number ${old} already used — imported as ${no}`); }
      invSeen.add(no);

      const issueDate = dt(pick(d, ['transactionDate', 'createdAt'])) || new Date();
      const dueDate = dt(d.transactionDueDate) || new Date(issueDate.getTime() + 14 * 86400000);
      const vatRate = d.taxOption === false ? 0 : (num(d.vat) > 0 && num(d.vat) <= 100 ? num(d.vat) : d.taxOption ? 7.5 : 0);
      const split = String(d.templateType || '').toLowerCase() === 'fcmb';
      const splitAmounts = split ? [
        ...(num(d.wibmoAmount) > 0 ? [{ label: 'Wibmo Inc', amount: num(d.wibmoAmount), inWords: str(d.wibmoAmountInWords), kind: 'wire', wire: LEGACY_WIRE }] : []),
        ...(num(d.gsjxAmount) > 0 ? [{ label: 'Global SJX Limited', amount: num(d.gsjxAmount), inWords: str(d.gsjxAmountInWords), kind: 'local', wire: [] }] : []),
      ] : [];
      const legacyStatus = String(d.status || 'pending').toLowerCase();
      const type = String(d.invoiceType || 'OTHER_INVOICES');
      const creator = mapped('users', d.userId) || mapped('employees', d.userId) || actorId;

      const inv: any = new Invoice({
        organizationId: ORG, invoiceNo: no, referenceNo: str(d.referenceNumber), clientId, bankAccountId: await bankFor(d), invoiceType: INV_TYPE[type] || 'Other',
        documentTitle: /^(ACS|RBA)_/.test(type) ? 'AUTHENTICATION SERVICES INVOICE' : undefined, templateType: split ? 'split' : 'standard', splitAmounts,
        currency: cur, exchangeRate: cur === 'NGN' ? 1 : num(pick(d, ['rate']), 1), rateDate: dt(pick(d, ['cbnratedate', 'rateDate'])), rateSource: 'manual', rateOverrideReason: 'Rate recorded on the legacy invoice',
        includeNaira: !!d.includeNairaAmount, items, vatRate, whtRate: Math.min(Math.max(num(d.wht), 0), 100), issueDate, dueDate, periodStart: start, periodEnd: end, periodLabel: str(d.period),
        payments: [], createdById: creator, legacy: { source: 'invoices', invoiceNo: str(d.invoiceNo), status: legacyStatus, referenceNumber: str(d.referenceNumber) },
        isDeleted: legacyStatus === 'deleted', createdAt: dt(d.createdAt) || issueDate,
      });
      computeInvoice(inv);
      const paid = num(d.amountPaid);
      if (paid > 0 || legacyStatus === 'paid') {
        const amt = round2(Math.min(paid > 0 ? paid : inv.total, inv.total));
        inv.payments.push({ amount: amt, whtDeducted: 0, paidOn: dt(d.paymentDate) || dt(d.updatedAt) || issueDate, method: 'bank_transfer', reference: 'Imported from legacy system', recordedById: creator });
        computeInvoice(inv);
      }
      inv.status = legacyStatus === 'deleted' ? 'void' : legacyStatus === 'rejected' ? 'rejected' : legacyStatus === 'pending' ? 'pending_approval' : inv.balance <= 0.005 && inv.payments.length ? 'paid' : inv.payments.length ? 'partially_paid' : legacyStatus === 'paid' ? 'paid' : 'approved';
      if (legacyStatus === 'deleted') inv.voidReason = 'Deleted in the legacy system';
      if (legacyStatus === 'rejected') inv.rejectionReason = str(pick(d, ['reasonForRejection', 'rejectionReason'])) || 'Rejected in the legacy system';
      if (inv.status === 'paid') inv.paidAt = inv.payments[0]?.paidOn;
      if (['approved', 'paid', 'partially_paid'].includes(inv.status)) { inv.approvedAt = issueDate; inv.approvedById = actorId; }
      if (inv.status === 'pending_approval') inv.submittedAt = issueDate;
      inv.history.push({ byName: 'Legacy import', action: 'imported', note: `From legacy invoice ${d.invoiceNo || id} (status "${legacyStatus}")` });
      if (legacyStatus === 'paid' && inv.balance > 0.005) issue('invoices', id, 'warn', `legacy says paid but computed balance is ${inv.balance} ${cur}; status set to ${inv.status}`);
      if (legacyTotal > 0 && Math.abs(legacyTotal - inv.total) > 0.011) issue('invoices', id, 'warn', `total differs from legacy: legacy ${legacyTotal} vs new ${inv.total} ${cur} — check the line items`);
      await save('invoices', id, 'Invoice', inv, `${legacyTotal}|${cur}`);
      invoiceByNo.set(lid(d.invoiceNo), { _id: inv._id, cur, rate: inv.exchangeRate, party: undefined, date: issueDate });
    } catch (e: any) { issue('invoices', id, 'error', e.message); }
  }
}

async function taxRow(source: 'taxes' | 'whts', d: any, build: (d: any, id: string) => any) {
  const id = lid(d._id);
  await archive(source, d);
  try {
    if (mapped(source, id)) { S(source).skipped++; return; }
    const rec = build(d, id);
    if (!rec) { S(source).skipped++; return; }
    await save(source, id, 'TaxRecord', new TaxRecord({ organizationId: ORG, ...rec, createdAt: dt(d.createdAt) }));
  } catch (e: any) { issue(source, id, 'error', e.message); }
}
async function stepTaxes() {
  for await (const d of each('taxes')) await taxRow('taxes', d, (x, id) => {
    const inv = invoiceByNo.get(lid(x.invoiceNo)) || (x.sourceId && idMap.get(key('invoices', lid(x.sourceId))) ? { _id: idMap.get(key('invoices', lid(x.sourceId))), rate: 1, date: dt(x.createdAt) } : undefined);
    const rate = inv?.cur && inv.cur !== 'NGN' ? inv.rate || 1 : 1; // legacy tax amounts are in the invoice currency; the new tax ledger is NGN
    return { taxId: `L-${str(x.taxId) || id}`, kind: 'VAT', nature: 'output_vat', sourceType: 'invoice', sourceId: inv?._id, sourceRef: str(x.invoiceNo), transDate: inv?.date || dt(x.createdAt) || new Date(), baseAmount: round2(num(x.totalAmount) * rate), rate: num(x.taxRate), amount: round2(num(pick(x, ['taxAmountDeducted', 'taxAmount'])) * rate), currency: 'NGN', status: String(x.status || '').toLowerCase() === 'paid' ? 'paid' : 'unpaid' };
  });
}
async function stepWhts() {
  for await (const d of each('whts')) await taxRow('whts', d, (x, id) => {
    const expense = String(x.sourceType || '').toLowerCase() === 'expense' || /^WHT-EXP/i.test(String(x.whtId || ''));
    const inv = invoiceByNo.get(lid(x.invoiceNo));
    const rate = !expense && inv?.cur && inv.cur !== 'NGN' ? inv.rate || 1 : 1;
    return { taxId: `L-${str(x.whtId) || id}`, kind: 'WHT', nature: expense ? 'wht_withheld_by_us' : 'wht_credit', sourceType: expense ? 'expense' : 'invoice', sourceId: expense ? idMap.get(key('expenses', lid(x.sourceId))) : inv?._id, sourceRef: str(x.invoiceNo) || str(x.whtId), partyName: str(x.companyName), transDate: dt(pick(x, ['transDate', 'createdAt'])) || new Date(), baseAmount: round2(num(x.totalTransactionAmount) * rate), rate: num(x.whtRate), amount: round2(num(x.whtAmount) * rate), currency: 'NGN', status: String(x.status || '').toLowerCase() === 'paid' ? 'paid' : 'unpaid' };
  });
}

async function stepExpenses() {
  let n = 0;
  for await (const d of each('expenses')) {
    const id = lid(d._id);
    await archive('expenses', d);
    try {
      if (mapped('expenses', id)) { S('expenses').skipped++; continue; }
      const amount = num(d.amount);
      if (!(amount >= 0)) throw new Error('amount is not a number');
      const by = mapped('users', d.createdBy) || mapped('employees', d.createdBy) || ACTOR?._id;
      const byName = by ? (await User.findById(by).select('name'))?.name || ACTOR?.name : ACTOR?.name;
      const att = [storeDataUrl(id, 1, d.image), storeDataUrl(id, 2, d.receipt)].filter(Boolean) as any[];
      const vatRate = num(d.vatRate), whtRate = num(d.whtRate), date = dt(pick(d, ['date', 'createdAt'])) || new Date();
      const desc = str(d.description) || str(d.category) || 'Legacy expense';
      const claim: any = new ExpenseClaim({
        organizationId: ORG, claimNo: `LEG-${id.slice(-8).toUpperCase()}`, title: desc.slice(0, 120), purpose: 'Imported from legacy system', submittedById: by, submittedByName: byName, currency: 'NGN', exchangeRate: 1,
        items: [{ category: expenseCategory(d.category), description: desc, vendor: str(d.companyName), date, quantity: 1, unitAmount: amount, amount, boughtBy: { kind: 'employee', employeeId: by, name: byName }, paymentMode: 'company_paid', tax: { whtEnabled: !!d.enableWHT && whtRate > 0, whtRate, vatEnabled: vatRate > 0, vatRate, payeeCompany: str(d.companyName) }, attachments: att, decision: 'approved', decisionNote: 'Imported — already recorded in the legacy system' }],
        status: 'paid', submittedAt: date, decidedAt: date, decidedById: ACTOR?._id, decisionNote: 'Imported from legacy system', settlement: { required: false, paidAt: date, method: 'other', reference: 'Legacy import' },
        history: [{ byName: 'Legacy import', action: 'imported', note: `Legacy status "${d.status || 'created'}"` }], createdAt: dt(d.createdAt) || date,
      });
      computeExpenseClaim(claim);
      const legacyDue = num(pick(d, ['amountDue']), NaN);
      if (Number.isFinite(legacyDue)) { const mine = round2(amount - claim.items[0].tax.whtAmount + claim.items[0].tax.vatAmount); if (Math.abs(mine - legacyDue) > 0.011) issue('expenses', id, 'warn', `amount due differs: legacy ${legacyDue} vs recomputed ${mine}`); }
      await save('expenses', id, 'ExpenseClaim', claim, String(Number.isFinite(legacyDue) ? legacyDue : amount));
      if (vatRate > 0 && claim.items[0].tax.vatAmount > 0) {
        const taxId = `L-IVAT-${id.slice(-10)}`;
        if (!(APPLY && (await TaxRecord.exists({ organizationId: ORG, taxId })))) { const t = new TaxRecord({ organizationId: ORG, taxId, kind: 'VAT', nature: 'input_vat', sourceType: 'expense', sourceId: claim._id, sourceRef: claim.claimNo, partyName: str(d.companyName), transDate: date, baseAmount: amount, rate: vatRate, amount: claim.items[0].tax.vatAmount, status: 'unpaid' }); if (APPLY) { await t.save(); await LegacyMap.create({ organizationId: ORG, source: 'expense-vat', legacyId: id, target: 'TaxRecord', targetId: t._id, batchId: BATCH }); } S('expense-vat').created++; }
      }
      n++;
    } catch (e: any) { issue('expenses', id, 'error', e.message); }
  }
}

function assetCategory(d: any) { const s = String(pick(d, ['category', 'type', 'assetType']) || '').toLowerCase(); if (/soft|licen/.test(s)) return 'software'; if (/cloud|host/.test(s)) return 'cloud'; if (/network|router|switch|firewall/.test(s)) return 'network'; if (/info|data|document/.test(s)) return 'information'; if (/facil|office|furnit|vehicle|generator/.test(s)) return 'facilities'; if (/service|supplier/.test(s)) return 'services'; return 'hardware'; }
async function stepAssets() {
  for await (const d of each('assets')) {
    const id = lid(d._id);
    await archive('assets', d);
    try {
      if (mapped('assets', id)) { S('assets').skipped++; continue; }
      const title = str(pick(d, ['name', 'title', 'assetName', 'description', 'item']));
      if (!title) throw new Error('asset has no name/title');
      const category = assetCategory(d);
      const assetId = APPLY ? `GSJX/${CATEGORIES[category].prefix}/${(await nextNumber(ORG, `AST-${CATEGORIES[category].prefix}`, { yearly: false, pad: 4 })).split('-').pop()}` : `GSJX/${CATEGORIES[category].prefix}/DRY-${id.slice(-4)}`;
      const gone = ['disposed', 'retired', 'inactive', 'deleted'].includes(String(d.status || '').toLowerCase());
      const a: any = new Asset({ organizationId: ORG, assetId, title, category, classification: 'Internal', lifecycleStatus: gone ? 'retired' : 'active', serialNumber: str(pick(d, ['serialNumber', 'serialNo', 'serial'])), vendor: str(pick(d, ['vendor', 'supplier', 'brand', 'make'])), location: str(d.location), owner: str(pick(d, ['owner', 'assignedTo', 'custodian'])), createdBy: 'Legacy import', updatedBy: 'Legacy import', createdAt: dt(d.createdAt) });
      await save('assets', id, 'Asset', a);
      if (APPLY) await appendEvent({ asset: a, action: 'imported_from_legacy', actor: { id: String(ACTOR?._id), name: 'Legacy import', role: 'system' }, note: `Imported from legacy asset ${id}. The legacy event history is in the archive.` }).catch((e: any) => issue('assets', id, 'warn', `event chain: ${e.message}`));
    } catch (e: any) { issue('assets', id, 'error', e.message); }
  }
}

async function stepArchiveOnly(name: string) { for await (const d of each(name)) { await archive(name, d); S(name).skipped++; } }

/* ================================ VERIFY =================================== */
async function verify() {
  const names = (await oldDb.listCollections().toArray()).map((c) => c.name).sort();
  const rows: any[] = [];
  for (const n of names) {
    const legacy = await col(n).countDocuments();
    const archived = await LegacyArchive.countDocuments({ organizationId: ORG, source: n });
    const migrated = await LegacyMap.countDocuments({ organizationId: ORG, source: n });
    rows.push({ collection: n, legacy, archived, migrated, status: SKIP_COLLECTIONS.includes(n) ? 'skipped (noise)' : archived >= legacy ? 'archived ✔' : `archive missing ${legacy - archived}` });
  }
  console.table(rows);
  // money reconciliation
  const money: any = {};
  for (const src of ['invoices', 'expenses']) {
    const maps = await LegacyMap.find({ organizationId: ORG, source: src }).select('targetId checksum legacyId').lean();
    if (src === 'invoices') {
      const docs = await Invoice.find({ _id: { $in: maps.map((m) => m.targetId) } }).select('total currency').lean();
      const by = new Map(docs.map((x: any) => [String(x._id), x]));
      const agg: Record<string, { legacy: number; migrated: number; diff: number }> = {};
      const mism: any[] = [];
      for (const m of maps) { const [lt, cur] = String(m.checksum).split('|'); const nw: any = by.get(String(m.targetId)); const a = (agg[cur] ||= { legacy: 0, migrated: 0, diff: 0 }); a.legacy += num(lt); a.migrated += nw?.total || 0; if (nw && Math.abs(num(lt) - nw.total) > 0.011) mism.push({ legacyId: m.legacyId, legacy: num(lt), migrated: nw.total, cur }); }
      for (const a of Object.values(agg)) { a.legacy = round2(a.legacy); a.migrated = round2(a.migrated); a.diff = round2(a.migrated - a.legacy); }
      money.invoices = { byCurrency: agg, mismatches: mism };
    } else {
      const docs = await ExpenseClaim.find({ _id: { $in: maps.map((m) => m.targetId) } }).select('totals').lean();
      const legacy = round2(maps.reduce((s, m) => s + num(m.checksum), 0));
      const migrated = round2(docs.reduce((s: number, x: any) => s + (x.totals?.total || 0) - (x.totals?.wht || 0), 0));
      money.expenses = { legacyAmountDue: legacy, migratedNetOfWht: migrated, diff: round2(migrated - legacy) };
    }
  }
  console.log('\nMoney reconciliation'); console.dir(money, { depth: 5 });
  writeReport('verify', { rows, money });
}

/* ================================ ROLLBACK ================================= */
async function rollback() {
  const batch = opt('batch');
  if (!batch) throw new Error('rollback needs --batch <id> (printed at the end of an apply run)');
  const maps = await LegacyMap.find({ organizationId: ORG, batchId: batch });
  if (!maps.length) { console.log('Nothing recorded for that batch.'); return; }
  const models: Record<string, mongoose.Model<any>> = { User, Client, BankAccount, ExchangeRate, TaxRate, ServiceItem, Invoice, ExpenseClaim, TaxRecord, Asset };
  let removed = 0, kept = 0;
  for (const m of maps.reverse()) {
    const M = models[m.target];
    const doc: any = M ? await M.findById(m.targetId) : null;
    if (doc) {
      const touched = doc.updatedAt && doc.createdAt && doc.updatedAt.getTime() - m.createdAt!.getTime() > 120000;
      if (touched && !flag('force')) { kept++; console.log(`kept (edited since import): ${m.target} ${m.targetId}`); continue; }
      await M.deleteOne({ _id: m.targetId }); removed++;
    }
    await LegacyMap.deleteOne({ _id: m._id });
  }
  const files = fs.existsSync(path.resolve(__dirname, '../uploads', ORG)) ? fs.readdirSync(path.resolve(__dirname, '../uploads', ORG)).filter((f) => f.startsWith('legacy-')) : [];
  console.log(`Rollback: removed ${removed}, kept ${kept} edited record(s). ${files.length} imported file(s) remain in uploads/${ORG} (delete the legacy-* files manually if you want them gone).`);
  await LegacyArchive.deleteMany({ organizationId: ORG, batchId: batch });
}

/* ================================ REPORT / MAIN ============================ */
function writeReport(kind: string, extra: any = {}) {
  const dir = path.resolve(__dirname, '../migration-reports'); fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${kind}-${BATCH}.json`);
  fs.writeFileSync(file, JSON.stringify({ kind, batch: BATCH, at: new Date().toISOString(), org: ORG, stats, issues, ...extra }, null, 2));
  console.log(`\nReport written: ${file}`);
}

async function main() {
  if (!['inspect', 'dry-run', 'apply', 'verify', 'rollback'].includes(mode)) { console.log('Usage: migrate-legacy <inspect|dry-run|apply|verify|rollback> [--org id] [--only a,b] [--create-missing-clients] [--confirm-backup] [--batch id] [--force]'); process.exit(1); }
  if (!OLD_URI) throw new Error('Set OLD_MONGO_URI to the old database (use a READ-ONLY user), e.g. mongodb+srv://reader:…@cluster/Global-SJX');
  if (OLD_URI.replace(/\/\?.*$/, '') === env.mongoUri.replace(/\/\?.*$/, '')) throw new Error('OLD_MONGO_URI and MONGO_URI are the same database — refusing to continue.');
  if (APPLY && !flag('confirm-backup')) throw new Error('apply needs --confirm-backup (you have taken a mongodump of BOTH databases and tested dry-run).');
  if (APPLY && env.appEnv === 'production' && !flag('i-know-this-is-production')) throw new Error('Refusing to apply on APP_ENV=production without --i-know-this-is-production. Rehearse on staging first.');
  if (APPLY && !process.env.DATA_ENCRYPTION_KEY) throw new Error('DATA_ENCRYPTION_KEY must be set (bank numbers and the archive are encrypted with it).');

  mongoose.set('strictQuery', true);
  await mongoose.connect(env.mongoUri);
  const oldConn = await mongoose.createConnection(OLD_URI, { readPreference: 'secondaryPreferred', appName: 'gsjx-legacy-migration' }).asPromise();
  oldDb = oldConn.db as any;
  console.log(`Old DB: ${oldConn.name} → New DB: ${mongoose.connection.name} · mode: ${mode} · batch: ${BATCH}`);

  const orgArg = opt('org');
  const orgs = orgArg ? await Organization.find({ _id: orgArg }) : await Organization.find().limit(2);
  if (orgs.length !== 1) throw new Error(orgArg ? 'Organisation not found.' : 'Pass --org <organizationId> (zero or several organisations found).');
  ORG = String(orgs[0]._id);
  ACTOR = await User.findOne({ organizationId: ORG, role: 'super_admin', isActive: true }).select('name');
  if (!ACTOR) console.warn('! no active super_admin found — approvals will have no approver recorded');

  if (mode === 'inspect') await inspect();
  else if (mode === 'verify') await verify();
  else if (mode === 'rollback') await rollback();
  else {
    for (const m of await LegacyMap.find({ organizationId: ORG }).select('source legacyId targetId').lean()) idMap.set(key(m.source, m.legacyId), m.targetId as any);
    const steps: Array<[string, () => Promise<any>]> = [
      ['users', () => stepUsers('users')], ['employees', () => stepUsers('employees')], ['clients', stepClients], ['accounts', stepAccounts], ['rates', stepRates], ['vats', stepVats], ['services', stepServices],
      ['invoices', stepInvoices], ['taxes', stepTaxes], ['expenses', stepExpenses], ['whts', stepWhts], ['assets', stepAssets],
    ];
    for (const [name, fn] of steps) if (enabled(name)) { process.stdout.write(`→ ${name} … `); await fn(); console.log(`${S(name).created} created, ${S(name).skipped} skipped, ${S(name).failed} failed`); }
    const known = new Set(steps.map((s) => s[0]));
    for (const c of (await oldDb.listCollections().toArray()).map((c) => c.name)) {
      if (known.has(c) || (SKIP_COLLECTIONS.includes(c) && !flag('archive-all')) || (ONLY && !ONLY.includes(c))) continue;
      process.stdout.write(`→ ${c} (archive only) … `); await stepArchiveOnly(c); console.log('done');
    }
    console.log(`\n${APPLY ? 'APPLIED' : 'DRY-RUN (nothing was written)'}`);
    console.table(Object.fromEntries(Object.entries(stats).map(([k, v]) => [k, v])));
    const errs = issues.filter((i) => i.level === 'error'), warns = issues.filter((i) => i.level === 'warn');
    console.log(`${errs.length} error(s), ${warns.length} warning(s). First problems:`);
    issues.filter((i) => i.level !== 'info').slice(0, 15).forEach((i) => console.log(`  [${i.level}] ${i.source} ${i.legacyId}: ${i.msg}`));
    writeReport(APPLY ? 'apply' : 'dry-run');
    if (APPLY) console.log(`\nBatch id: ${BATCH}   (rollback:  npm run migrate:legacy -- rollback --batch ${BATCH})\nNext: npm run migrate:legacy -- verify`);
    else console.log('\nFix any [error] lines (or accept them), then run:  npm run migrate:legacy -- apply --confirm-backup');
  }
  await oldConn.close(); await mongoose.disconnect();
}

main().catch(async (e) => { console.error(`\n✖ ${e.message}`); try { await mongoose.disconnect(); } catch { /* */ } process.exit(1); });
