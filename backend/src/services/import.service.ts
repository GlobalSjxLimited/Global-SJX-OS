import ExcelJS from 'exceljs';
import mammoth from 'mammoth';
import { Asset, CATEGORIES, CATEGORY_KEYS, CLASSIFICATIONS } from '../models/Asset';
import { Policy } from '../models/Governance';
import { Vendor } from '../models/Vendor';
import { ThreatIntel } from '../models/ThreatIntel';
import { createRecord } from './isms/records.service';
import { nextNumber } from '../models/Access';
import { appendEvent } from '../utils/assetAudit';
import { cleanHtml } from '../utils/html';

/**
 * Import engines for the company's own files (asset register workbook, supplier list, policy documents).
 * Every importer is idempotent (running it twice creates nothing new) and supports a dry run that writes nothing.
 */
export interface Actor { id: string; name: string; role?: string }
export interface ImportReport { created: number; duplicates: number; skipped: number; ignored: string[]; samples: string[]; notes: string[] }
const emptyReport = (): ImportReport => ({ created: 0, duplicates: 0, skipped: 0, ignored: [], samples: [], notes: [] });
const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const txt = (v: any) => String(v ?? '').replace(/\s+/g, ' ').trim();
const isJunk = (s: string) => !s || s.length < 2 || /^(nil|n\/a|na|none|-|—|tbd|vacant)$/i.test(s) || /^[\d.]+$/.test(s);

function cellValue(c: ExcelJS.Cell): any {
  const v: any = c.value;
  if (v === null || v === undefined) return undefined;
  if (v instanceof Date) return v;
  if (typeof v === 'object') { if ('result' in v) return v.result; if ('richText' in v) return v.richText.map((t: any) => t.text).join(''); if ('text' in v) return v.text; if ('hyperlink' in v) return v.hyperlink; return undefined; }
  return v;
}
/** First row (within 10) that contains at least `min` non-empty cells whose normalised text is in `wanted` (or startsWith one). */
function findHeader(ws: ExcelJS.Worksheet, wanted: string[], min = 2) {
  for (let r = 1; r <= Math.min(ws.rowCount, 10); r++) {
    const cols: Record<number, string> = {}; const hit = new Set<string>();
    ws.getRow(r).eachCell({ includeEmpty: false }, (cell, idx) => { const h = norm(cellValue(cell)); if (h) { cols[idx] = h; if (wanted.some((w) => h === w || h.startsWith(w))) hit.add(h); } });
    if (hit.size >= min) return { row: r, cols };
  }
  return null;
}
async function load(buffer: Buffer) { const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buffer as any); return wb; }

/* ============================================================ assets */
const SHEET_CATEGORY: Array<[RegExp, string]> = [
  [/digital asset|business database|source code/i, 'information'], [/^software/i, 'software'], [/non.?digital|support utilit/i, 'facilities'], [/people/i, 'people'],
  [/server|desktop|laptop|storage media/i, 'hardware'], [/network/i, 'network'], [/cloud/i, 'cloud'], [/service|supplier/i, 'services'],
];
const FIELD_RULES: Array<[RegExp, string]> = [
  [/^(assettitle|title|devicename|servername|software|assetname|name)$/, 'title'], [/^assetid/, 'assetId'], [/^owner/, 'owner'], [/^custodian/, 'custodian'], [/^users?($|role|\[)|^userrole/, 'users'],
  [/^(asset)?location/, 'location'], [/^classification/, 'classification'], [/^(severity|criticality)/, 'criticality'], [/^serialnumber/, 'serialNumber'], [/^version/, 'version'],
  [/^(vendor|supplier|make)$/, 'vendor'], [/^(model|makemodel)/, 'makeModel'], [/^(type|typeformat)/, 'subCategory'], [/^(applicationbusiness|description|purpose)/, 'description'],
  [/^confidentiality/, 'c'], [/^integrity/, 'i'], [/^availability/, 'a'],
];
const CRIT: Record<string, string> = { moderate: 'Medium', medium: 'Medium', low: 'Low', high: 'High', critical: 'Critical', severe: 'Critical' };
const LVL = (v: any) => { const s = txt(v).toLowerCase(); return s.startsWith('h') ? 'High' : s.startsWith('l') ? 'Low' : s.startsWith('m') ? 'Medium' : undefined; };

export async function importAssets(orgId: string, buffer: Buffer, actor: Actor, opts: { dryRun?: boolean; defaultCategory?: string } = {}): Promise<ImportReport> {
  const rep = emptyReport(); const wb = await load(buffer);
  const existing = await Asset.find({ organizationId: orgId }).select('assetId title category').lean();
  const haveId = new Map<string, string>(existing.map((a: any) => [String(a.assetId), norm(a.title)] as [string, string]));
  /** Duplicates are counted, not just detected: three identical laptops in the file are three assets, and re-running never adds a fourth. */
  const dbCount = new Map<string, number>(); for (const a of existing as any[]) { const k = `${a.category}|${norm(a.title)}`; dbCount.set(k, (dbCount.get(k) || 0) + 1); } const seen = new Map<string, number>();
  for (const ws of wb.worksheets) {
    const name = ws.name.trim();
    const category = SHEET_CATEGORY.find(([rx]) => rx.test(name))?.[1] || (opts.defaultCategory && CATEGORY_KEYS.includes(opts.defaultCategory) ? opts.defaultCategory : '');
    const head = findHeader(ws, ['assettitle', 'title', 'devicename', 'servername', 'software', 'assetid', 'role', 'name']);
    if (!category || !head) { if (ws.rowCount > 3 && !/cover|control|legend|summary|front|how to|lists?$/i.test(name)) rep.ignored.push(name); continue; }
    const map: Array<{ idx: number; field: string }> = [];
    for (const [idxS, h] of Object.entries(head.cols)) { const rule = FIELD_RULES.find(([rx]) => rx.test(h)); if (rule) map.push({ idx: +idxS, field: rule[1] }); }
    const isPeople = category === 'people'; const roleIdx = isPeople ? +(Object.entries(head.cols).find(([, h]) => h === 'role')?.[0] || 0) : 0; const personIdx = isPeople ? +(Object.entries(head.cols).find(([, h]) => h === 'name')?.[0] || 0) : 0;
    let n = 0;
    for (let r = head.row + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r); const d: Record<string, any> = {};
      for (const { idx, field } of map) { const v = cellValue(row.getCell(idx)); if (v !== undefined && txt(v) !== '' && !(field in d)) d[field] = v instanceof Date ? v : txt(v); }
      if (isPeople) { const role = txt(cellValue(row.getCell(roleIdx))); const person = txt(cellValue(row.getCell(personIdx))); if (isJunk(role) || isJunk(person)) { rep.skipped++; continue; } d.title = `${role} – ${person}`; d.owner = person; }
      const title = txt(d.title); if (isJunk(title)) { if (title) rep.skipped++; continue; }
      const given = d.assetId ? txt(d.assetId).slice(0, 40) : '';
      const tkey = `${category}|${norm(title)}`; const nth = seen.get(tkey) || 0; seen.set(tkey, nth + 1);
      if (nth < (dbCount.get(tkey) || 0)) { rep.duplicates++; continue; }
      const cls = CLASSIFICATIONS.find((c) => c.toLowerCase() === txt(d.classification).toLowerCase()) || (/confid/i.test(txt(d.classification)) ? 'Confidential' : 'Internal');
      const doc: any = {
        organizationId: orgId, title: title.slice(0, 200), category, subCategory: d.subCategory ? txt(d.subCategory).slice(0, 80) : undefined, description: d.description ? txt(d.description).slice(0, 1000) : undefined,
        owner: d.owner, custodian: d.custodian, users: d.users, location: d.location, classification: cls, classificationSource: 'manual', criticality: CRIT[txt(d.criticality).toLowerCase()] || 'Medium',
        serialNumber: d.serialNumber && !isJunk(txt(d.serialNumber)) ? txt(d.serialNumber) : undefined, version: d.version, vendor: d.vendor, makeModel: d.makeModel, lifecycleStatus: 'active', createdBy: actor.name, updatedBy: actor.name,
      };
      for (const [k, f] of [['c', 'confidentiality'], ['i', 'integrity'], ['a', 'availability']] as const) { const l = LVL(d[k]); if (l) doc[f] = l; }
      n++; rep.created++; if (rep.samples.length < 8) rep.samples.push(`${category}: ${title}`);
      if (opts.dryRun) { if (given && !haveId.has(given)) haveId.set(given, norm(title)); continue; }
      let assetId = given && !haveId.has(given) ? given : '';
      for (let a = 0; !assetId && a < 50; a++) { const c = `GSJX/${CATEGORIES[category].prefix}/${(await nextNumber(orgId, `AST-${CATEGORIES[category].prefix}`, { yearly: false, pad: 4 })).split('-').pop()}`; if (!haveId.has(c) && !(await Asset.exists({ organizationId: orgId, assetId: c }))) assetId = c; }
      const asset = await Asset.create({ ...doc, assetId });
      haveId.set(assetId, norm(title));
      await appendEvent({ asset, action: 'created', actor: { id: actor.id, name: actor.name, role: actor.role || 'super_admin' }, note: `Imported from "${name}" sheet` });
    }
    rep.notes.push(`${name}: ${n} new`);
  }
  return rep;
}

/* ============================================================ vendors / suppliers */
export async function importVendors(orgId: string, buffer: Buffer, _actor: Actor, opts: { dryRun?: boolean } = {}): Promise<ImportReport> {
  const rep = emptyReport(); const wb = await load(buffer);
  const have = new Set((await Vendor.find({ organizationId: orgId, isDeleted: { $ne: true } }).select('name').lean()).map((v: any) => norm(v.name)));
  for (const ws of wb.worksheets) {
    if (!/supplier|vendor/i.test(ws.name) && wb.worksheets.length > 1) { if (ws.rowCount > 3) rep.ignored.push(ws.name.trim()); continue; }
    const head = findHeader(ws, ['fullnames', 'nameofcompany', 'company', 'vendor', 'supplier', 'name', 'primarycontact']); if (!head) { rep.ignored.push(ws.name.trim()); continue; }
    const col = (...keys: string[]) => +(Object.entries(head.cols).find(([, h]) => keys.some((k) => h.startsWith(k)))?.[0] || 0);
    const c = { name: col('fullnames', 'nameofcompany', 'company', 'vendor', 'supplier', 'name'), person: col('primarycontact', 'contactperson'), phone: col('phone'), email: col('email'), addr: col('valid', 'address', 'location'), purpose: col('purpose'), status: col('status') };
    for (let r = head.row + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r); const get = (i: number) => (i ? txt(cellValue(row.getCell(i))) : '');
      const name = get(c.name); if (isJunk(name) || /^(s\/?n|no|key|high|medium|low|active|inactive)$/i.test(name)) { if (name) rep.skipped++; continue; }
      if (!get(c.email) && !get(c.phone) && !get(c.person) && !get(c.addr)) { rep.skipped++; continue; }
      if (have.has(norm(name))) { rep.duplicates++; continue; }
      let phone = get(c.phone), email = get(c.email); if (/@/.test(phone) && !email) { email = phone; phone = ''; } if (/^[\d.]+$/.test(phone)) phone = phone.replace(/\.0$/, '');
      const em = email.match(/[^\s,;]+@[^\s,;]+\.[a-z]{2,}/i)?.[0]?.toLowerCase();
      const person = get(c.person); const purpose = get(c.purpose); const active = !/inactive|terminated|former/i.test(get(c.status));
      rep.created++; have.add(norm(name)); if (rep.samples.length < 8) rep.samples.push(name); if (opts.dryRun) continue;
      await Vendor.create({ organizationId: orgId, name: name.slice(0, 160), email: em, phone: phone || undefined, address: get(c.addr) || undefined, products: purpose ? [purpose.slice(0, 200)] : [], status: active ? 'active' : 'inactive', contacts: person && !isJunk(person) ? [{ name: person.slice(0, 120), email: em, phone: phone || undefined, isPrimary: true }] : [] });
    }
  }
  return rep;
}

/* ============================================================ policies from Word files */
const CATS: Array<[RegExp, string]> = [
  [/data protection|privacy|ndpa|pii|masking|retention|deletion|information deletion/i, 'Data Protection'], [/acceptable use|clear desk|clear screen|byod|personal device|use of ai|endpoint/i, 'Acceptable Use'],
  [/continuity|disruption|ict readiness|emergency|backup|incident/i, 'Business Continuity'], [/supplier|third party|cloud services|outsourc/i, 'Supplier'], [/human resource|onboarding|remote working|staff|handbook|competency|awareness/i, 'HR'],
];
const clean = (f: string) => f.replace(/\.(docx|pdf)$/i, '').replace(/[\s_-]*\b(achieved|archieved|tbd)\b\s*$/i, '').replace(/^draft[_:\s]+/i, '').replace(/\(\d+\)/g, '').replace(/^(global\s*sjx\s*(limited)?|gsjx)[\s_-]*/i, '').replace(/\s+/g, ' ').replace(/[_]+/g, ' ').trim();
export function policyTitle(filename: string) { const t = clean(filename.split('/').pop() || filename); return t.charAt(0).toUpperCase() + t.slice(1); }
export async function docxToPolicyParts(buffer: Buffer, filename: string) {
  const html = (await mammoth.convertToHtml({ buffer }, { convertImage: (mammoth as any).images.imgElement(async () => ({ src: '' })) })).value.replace(/<img[^>]*src=""[^>]*>/g, '');
  const text = html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  const title = policyTitle(filename); const version = text.slice(0, 2500).match(/version\s*(?:no\.?|number)?[:\s]*v?(\d+(?:\.\d+)?)/i)?.[1];
  const para = html.match(/<p>([^<]{80,400})<\/p>/)?.[1] || text.slice(0, 280);
  return { title, content: cleanHtml(html), text, version, summary: para.replace(/&amp;/g, '&').slice(0, 300), category: CATS.find(([rx]) => rx.test(title))?.[1] || 'Information Security' };
}
/** Policies the whole workforce must acknowledge. Everything else is imported as reference material that needs no acknowledgement. */
const ACK_ALL = /information security policy|isms policy statement|acceptable use|clear desk|use of ai|remote working policy|byod|human resource security/i;
export async function importPolicyDocx(orgId: string, files: Array<{ name: string; buffer: Buffer }>, actor: Actor, opts: { dryRun?: boolean; publish?: boolean } = {}): Promise<ImportReport> {
  const rep = emptyReport();
  const have = new Set((await Policy.find({ organizationId: orgId }).select('title').lean()).map((p: any) => norm(p.title)));
  for (const f of files) {
    if (!/\.docx$/i.test(f.name)) { rep.ignored.push(f.name); continue; }
    let p; try { p = await docxToPolicyParts(f.buffer, f.name); } catch { rep.skipped++; rep.notes.push(`Could not read ${f.name}`); continue; }
    if (p.text.length < 200) { rep.skipped++; continue; }
    if (have.has(norm(p.title))) { rep.duplicates++; continue; }
    have.add(norm(p.title)); rep.created++; if (rep.samples.length < 10) rep.samples.push(`${p.title}${p.version ? ` v${p.version}` : ''}`); if (opts.dryRun) continue;
    const doc: any = { organizationId: orgId, title: p.title.slice(0, 200), category: p.category, version: p.version || '1.0', status: opts.publish ? 'approved' : 'draft', summary: p.summary, content: p.content,
      reviewCycleMonths: 12, requiresAcknowledgement: !!opts.publish && ACK_ALL.test(p.title), ownerId: actor.id, createdById: actor.id, approvedAt: opts.publish ? new Date() : undefined, approvedById: opts.publish ? actor.id : undefined, effectiveDate: opts.publish ? new Date() : undefined };
    // policy codes are unique; numbers used by hand-made or seeded policies do not advance the counter, so skip any that are taken
    for (let attempt = 0; ; attempt++) {
      doc.code = await nextNumber(orgId, 'POL', { yearly: false, pad: 3 });
      try { await Policy.create(doc); break; } catch (e: any) { if (e?.code !== 11000 || attempt >= 60) throw e; }
    }
  }
  return rep;
}

/* ============================================================ equipment maintenance schedule (company workbook) */
const FREQ: Record<string, number> = { weekly: 1, monthly: 1, quarterly: 3, 'semi-annual': 6, semiannual: 6, biannual: 6, annual: 12, yearly: 12, biennial: 24 };
export async function importMaintenance(orgId: string, buffer: Buffer, actor: Actor, opts: { dryRun?: boolean } = {}): Promise<ImportReport> {
  const rep = emptyReport(); const wb = await load(buffer); const ws = wb.worksheets.find((w) => /maintenance schedule/i.test(w.name)); if (!ws) { rep.ignored.push('no "Maintenance Schedule" sheet'); return rep; }
  const head = findHeader(ws, ['taskid', 'equipment', 'maintenancetask', 'frequency', 'nextdue'], 3); if (!head) { rep.ignored.push(ws.name); return rep; }
  const col = (...k: string[]) => +(Object.entries(head.cols).find(([, h]) => k.some((x) => h.startsWith(x)))?.[0] || 0);
  const c = { id: col('taskid'), asset: col('assetid'), eq: col('equipment'), task: col('maintenancetask'), freq: col('frequency'), by: col('doneby'), last: col('lastdone'), next: col('nextdue'), notes: col('notes'), vendor: col('vendor') };
  const { IsmsRecord } = await import('../models/Isms'); const have = new Set((await IsmsRecord.find({ organizationId: orgId, register: 'maintenance', isDeleted: { $ne: true } }).select('title').lean()).map((x: any) => norm(x.title)));
  for (let r = head.row + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r); const g = (i: number) => (i ? cellValue(row.getCell(i)) : undefined);
    const eq = txt(g(c.eq)); const task = txt(g(c.task)); if (isJunk(eq)) continue; const title = `${eq}${task ? ` – ${task}` : ''}`.slice(0, 280);
    if (have.has(norm(title))) { rep.duplicates++; continue; }
    const aid = txt(g(c.asset)); const type = /inspect|check|test/i.test(task) ? 'Inspection' : 'Preventive';
    const d: any = { equipment: title, type, every: FREQ[txt(g(c.freq)).toLowerCase()] || undefined, vendor: txt(g(c.by)) || undefined, findings: txt(g(c.notes)) || undefined };
    if (aid && !/tbc|add to/i.test(aid)) d.assetId = aid;
    for (const [k, i] of [['lastDone', c.last], ['nextDue', c.next]] as const) { const v = g(i); if (v instanceof Date) d[k] = v; }
    have.add(norm(title)); rep.created++; if (rep.samples.length < 6) rep.samples.push(title); if (opts.dryRun) continue;
    await createRecord(orgId, 'maintenance', { data: d }, { id: actor.id, name: actor.name } as any, { source: 'import', strict: false });
  }
  return rep;
}

/* ============================================================ threat intelligence register (company workbook) */
export async function importThreatRegister(orgId: string, buffer: Buffer, actor: Actor, opts: { dryRun?: boolean } = {}): Promise<ImportReport> {
  const rep = emptyReport(); const wb = await load(buffer); const ws = wb.worksheets.find((w) => /threat intelligence/i.test(w.name)); if (!ws) { rep.ignored.push('no "Threat Intelligence" sheet'); return rep; }
  const head = findHeader(ws, ['threatid', 'threat', 'descriptionofthreat', 'severity'], 3); if (!head) { rep.ignored.push(ws.name); return rep; }
  const col = (...k: string[]) => +(Object.entries(head.cols).find(([, h]) => k.some((x) => h === x || h.startsWith(x)))?.[0] || 0);
  const c = { id: col('threatid'), t: col('threat'), desc: col('descriptionofthreat'), assets: col('likelyaffected'), sev: col('severity'), src: col('source'), app: col('applicability'), fix: col('remedation', 'remediation'), tools: col('threattools'), ctl: col('controltype'), status: col('status'), com: col('comments') };
  const have = new Set((await ThreatIntel.find({ organizationId: orgId }).select('externalId').lean()).map((x: any) => x.externalId).filter(Boolean));
  const { newReference } = await import('./threatIntel.service');
  for (let r = head.row + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r); const g = (i: number) => (i ? txt(cellValue(row.getCell(i))) : '');
    const ext = g(c.id); const title = g(c.t); if (isJunk(title) || !ext) continue; if (have.has(ext)) { rep.duplicates++; continue; }
    const sev = (['critical', 'high', 'medium', 'low'] as const).find((s) => g(c.sev).toLowerCase().startsWith(s)) || 'medium'; const st = g(c.status).toLowerCase();
    const cat = /phish|bec|email/i.test(title) ? 'phishing' : /ransom/i.test(title) ? 'ransomware' : /fraud|deepfake|impersonat/i.test(title) ? 'fraud' : /vulnerab|cve|patch/i.test(title) ? 'vulnerability' : /supply/i.test(title) ? 'supply_chain' : /insider/i.test(title) ? 'insider' : 'other';
    have.add(ext); rep.created++; if (rep.samples.length < 6) rep.samples.push(`${ext} ${title}`); if (opts.dryRun) continue;
    await ThreatIntel.create({ organizationId: orgId, reference: await newReference(orgId), externalId: ext, title: title.slice(0, 240), summary: g(c.desc).slice(0, 8000), layer: 'tactical', category: cat, severity: sev, tlp: 'AMBER', origin: 'import', sourceName: g(c.src).slice(0, 160) || undefined,
      status: /clos|resolv|done/.test(st) ? 'closed' : /action|mitigat/.test(st) ? 'actioned' : 'new', analysis: [g(c.assets) && `Likely affected: ${g(c.assets)}`, g(c.app) && `Applicability: ${g(c.app)}`].filter(Boolean).join('\n'), recommendations: [g(c.fix), g(c.tools) && `Tools: ${g(c.tools)}`, g(c.ctl) && `Control type: ${g(c.ctl)}`].filter(Boolean).join('\n').slice(0, 8000), createdById: actor.id, createdByName: actor.name });
  }
  return rep;
}
