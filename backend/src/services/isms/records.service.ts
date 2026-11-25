import ExcelJS from 'exceljs';
import { REGISTERS, REGISTER_MAP, FREQ_MONTHS, Col, RegisterDef } from '../../config/isms';
import { IsmsRecord } from '../../models/Isms';
import { nextNumber } from '../../models/Access';
import { ApiError } from '../../utils/ApiError';

export interface Actor { id?: string; name: string }
const DAY = 86400000;
const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const blank = (v: unknown) => v === undefined || v === null || String(v).trim() === '';
const addMonths = (d: Date, m: number) => { const x = new Date(d); x.setMonth(x.getMonth() + m); return x; };

export function toDate(v: unknown): Date | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  if (v instanceof Date) return isNaN(+v) ? undefined : v;
  if (typeof v === 'number') return v > 20000 && v < 80000 ? new Date(Math.round((v - 25569) * DAY)) : undefined; // Excel serial
  const s = String(v).trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); // dd/mm/yyyy (the company's format)
  if (m) { const d = new Date(Date.UTC(+m[3], +m[2] - 1, +m[1])); return isNaN(+d) ? undefined : d; }
  const d = new Date(s);
  return isNaN(+d) ? undefined : d;
}

/** Risk classification used in the company's risk matrix: 1-4 Minor, 5-9 Moderate, 10+ Major. */
export const riskClass = (score: number) => (!score ? '' : score <= 4 ? 'Minor' : score <= 9 ? 'Moderate' : 'Major');
const num = (v: unknown) => { const n = Number(String(v ?? '').replace('%', '')); return Number.isFinite(n) && !blank(v) ? n : 0; };

/** Calculated columns. Pure, so it is unit-tested. */
export function compute(def: RegisterDef, d: Record<string, any>): Record<string, any> {
  const x = { ...d };
  if (def.key === 'risk') {
    x.impact = Math.max(num(x.cImpact), num(x.iImpact), num(x.aImpact)) || num(x.impact);
    x.exposure = x.impact && num(x.likelihood) ? x.impact * num(x.likelihood) : 0;
    x.classification = riskClass(x.exposure);
    x.rExposure = num(x.rImpact) && num(x.rLikelihood) ? num(x.rImpact) * num(x.rLikelihood) : 0;
    x.rClassification = riskClass(x.rExposure);
    const last = toDate(x.lastAssessment); const months = FREQ_MONTHS[norm(x.frequency)] || 12;
    x.nextAssessment = last ? addMonths(last, months) : undefined;
  } else if (def.key === 'opportunity') {
    x.score = num(x.likelihood) && num(x.benefit) ? num(x.likelihood) * num(x.benefit) : 0;
    x.level = !x.score ? '' : x.score <= 4 ? 'Low' : x.score <= 9 ? 'Medium' : 'High';
  } else if (def.key === 'metric') {
    const t = num(x.target); const hasA = !blank(x.actual);
    x.targetMet = blank(x.target) || !hasA ? '' : num(x.actual) >= t ? 'Yes' : 'No';
    const last = toDate(x.lastMeasured);
    x.nextMeasurement = last ? addMonths(last, FREQ_MONTHS[norm(x.frequency)] || 12) : x.nextMeasurement;
  } else if (def.key === 'capacity') {
    const u = num(x.usage); const t = num(x.threshold);
    x.state = blank(x.usage) || !t ? '' : u >= t ? 'Breach' : u >= t * 0.8 ? 'Watch' : 'OK';
  } else if (def.key === 'restore_test') {
    x.withinRto = blank(x.hoursTaken) || blank(x.rtoHours) ? '' : num(x.hoursTaken) <= num(x.rtoHours) ? 'Yes' : 'No';
  } else if (def.key === 'byod') {
    const vals = ['chkOs', 'chkLock', 'chkEnc', 'chkAv', 'chkRoot', 'chkMfa'].map((k) => String(x[k] || '').toUpperCase());
    x.checks = vals.includes('N') ? 'FAIL' : vals.some((v) => v === '') ? 'INCOMPLETE' : 'PASS';
    const base = toDate(x.lastReview) || toDate(x.approved);
    if (base) x.nextReview = addMonths(base, 12);
  }
  return x;
}

/** Coerce a submitted value to the column type. strict = reject select values that are not in the list. */
function coerce(col: Col, v: unknown, strict: boolean): any {
  if (blank(v)) return undefined;
  switch (col.type) {
    case 'date': { const d = toDate(v); if (!d) { if (strict) throw ApiError.badRequest(`"${col.label}" is not a valid date`); return undefined; } return d; }
    case 'number': { const n = Number(String(v).replace('%', '')); if (!Number.isFinite(n)) { if (strict) throw ApiError.badRequest(`"${col.label}" must be a number`); return undefined; } return n; }
    case 'select': case 'yn': {
      const hit = (col.options || []).find((o) => norm(o) === norm(v) || (o !== '' && norm(String(v)).startsWith(norm(o)) && norm(o).length > 3));
      if (hit) return hit;
      if (strict) throw ApiError.badRequest(`"${col.label}" must be one of: ${(col.options || []).filter(Boolean).join(', ')}`);
      return String(v).trim().slice(0, 500);
    }
    default: return String(v).trim().slice(0, col.type === 'longtext' ? 8000 : 1000);
  }
}

export function cleanData(def: RegisterDef, input: Record<string, any>, strict: boolean): Record<string, any> {
  const out: Record<string, any> = {};
  for (const col of def.cols) {
    if (col.computed || !(col.key in input)) continue;
    const v = coerce(col, input[col.key], strict);
    if (v !== undefined) out[col.key] = v;
  }
  return out;
}

/** Rules that stop a record moving forward without the evidence the procedure asks for. Returns the problem, or null. */
export function guardStatus(def: RegisterDef, d: Record<string, any>, next: string, actor: Actor, rec: any): string | null {
  if (!def.statuses.includes(next)) return `"${next}" is not a status of ${def.title}`;
  void actor;
  if (def.key === 'car') {
    if (['Implemented', 'Verified', 'Closed'].includes(next) && (blank(d.rootCause) || blank(d.correctiveAction))) return 'Record the root cause and the corrective action before moving the CAR on (clause 10.2).';
    if (['Verified', 'Closed'].includes(next) && blank(d.verification)) return 'Write how effectiveness was verified before verifying or closing the CAR.';
    if (['Verified', 'Closed'].includes(next)) {
      if (blank(d.verifiedBy)) return 'Name who verified the corrective action ("Verified by").';
      if (norm(d.verifiedBy) === norm(d.responsible)) return 'The corrective action must be verified by someone other than the person responsible for it.';
    }
  }
  if (def.key === 'change') {
    if (next === 'Approved' && blank(d.signoffBy)) return 'Name who signs the change off before approving it.';
    if (next === 'Approved' && rec?.createdBy?.id && actor.id && String(rec.createdBy.id) === String(actor.id)) return 'Whoever requested the change cannot approve it (change management procedure).';
    if (next === 'Implemented' && !['Approved', 'Implementing'].includes(rec?.status)) return 'A change must be approved before it is marked implemented.';
    if (next === 'Reviewed' && (blank(d.reviewedBy) || blank(d.dateResolved))) return 'Fill in "Date Work Resolved" and "Reviewed By" to complete the post-implementation review.';
  }
  if (def.key === 'byod') {
    if (next === 'Approved') {
      if (d.checks !== 'PASS') return `Device security checks are ${d.checks || 'INCOMPLETE'} – every check must pass before approval (BYOD policy 2.3).`;
      if (String(d.agreement || '').toUpperCase() !== 'Y') return 'The BYOD user agreement must be signed before approval.';
    }
    if (next === 'Removed' && String(d.dataRemoved || '').toUpperCase() !== 'Y') return 'Confirm company data was removed ("Company data removed & verified" = Y) before the device is removed.';
  }
  if (def.key === 'annex_a') {
    if (next === 'Not applicable' && String(d.justification || '').trim().length < 15) return 'A control can only be excluded with a written justification (clause 6.1.3 d) – at least a sentence.';
    if (next === 'Implemented' && String(d.implementation || '').trim().length < 10) return 'Describe how the control is implemented before marking it implemented.';
    if (next !== 'Not applicable' && String(d.applicable || '').toLowerCase() === 'no') return 'This control is marked as not applicable – change "Applicable" to Yes first.';
  }
  if (def.key === 'legal_hold' && next === 'Released') {
    if (blank(d.releasedBy) || String(d.releaseReason || '').trim().length < 10) return 'Name who releases the hold and give the reason (at least a sentence).';
    if (norm(d.releasedBy) === norm(d.placedBy)) return 'A hold must be released by someone other than the person who placed it.';
  }
  if (def.key === 'deletion') {
    if (['Deleted', 'Verified'].includes(next) && (blank(d.deletedBy) || blank(d.deletedOn) || blank(d.method))) return 'Record who deleted it, when and by which method before marking it deleted.';
    if (next === 'Deleted' && !['Approved', 'Blocked'].includes(rec?.status)) return 'A deletion must be approved first.';
    if (next === 'Verified') {
      if (blank(d.verifiedBy)) return 'Name who independently verified the deletion.';
      if (norm(d.verifiedBy) === norm(d.deletedBy)) return 'The deletion must be verified by someone other than the person who did it.';
    }
  }
  if (def.key === 'restore_test' && next === 'Done') {
    if (blank(d.result) || blank(d.hoursTaken) || blank(d.testedBy)) return 'Record the result, the time taken and who tested before marking the restore test done.';
    if (blank(d.verifiedBy)) return 'Name who verified the restore ("Verified by").';
    if (norm(d.verifiedBy) === norm(d.testedBy)) return 'The restore must be verified by someone other than the person who ran it.';
  }
  if (def.key === 'audit_plan' && next === 'Reported' && blank(d.reportLink)) return 'Add the audit report link before marking the audit reported.';
  if (def.key === 'training' && next === 'Done' && blank(d.attendance)) return 'Enter how many people attended before marking the training done.';
  return null;
}

export async function listRecords(orgId: string, key: string, q: { status?: string; q?: string; page?: number; limit?: number; overdue?: boolean; owner?: string }) {
  const def = REGISTER_MAP[key]; if (!def) throw ApiError.notFound('Unknown register');
  const filter: any = { organizationId: orgId, register: key, isDeleted: { $ne: true } };
  if (q.status) filter.status = q.status;
  if (q.owner) filter.ownerId = q.owner;
  if (q.overdue) { filter.dueDate = { $lt: new Date() }; filter.status = { $nin: def.closedStatuses }; }
  if (q.q) { const rx = new RegExp(String(q.q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'); filter.$or = [{ title: rx }, { refNo: rx }, { ownerName: rx }]; }
  const limit = Math.min(Math.max(Number(q.limit) || 50, 1), 200); const page = Math.max(Number(q.page) || 1, 1);
  const [rows, total] = await Promise.all([
    IsmsRecord.find(filter).sort(key === 'annex_a' ? { refNo: 1 } : { createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    IsmsRecord.countDocuments(filter),
  ]);
  return { rows, total, page, pages: Math.ceil(total / limit) || 1 };
}

export async function createRecord(orgId: string, key: string, body: { data?: Record<string, any>; status?: string; ownerId?: string; ownerName?: string; evidenceUrl?: string }, actor: Actor, opts: { source?: 'manual' | 'auto' | 'import'; sourceRef?: { type: string; id: string }; strict?: boolean } = {}) {
  const def = REGISTER_MAP[key]; if (!def) throw ApiError.notFound('Unknown register');
  const strict = opts.strict !== false && opts.source !== 'import';
  const data = compute(def, cleanData(def, body.data || {}, strict));
  const title = String(data[def.titleKey] || '').slice(0, 300);
  if (!title) throw ApiError.badRequest(`"${def.cols.find((c) => c.key === def.titleKey)?.label || 'Title'}" is required`);
  const status = body.status && def.statuses.includes(body.status) ? body.status : def.defaultStatus;
  const refNo = await nextNumber(orgId, def.prefix, { yearly: false, pad: 4 });
  const rec = await IsmsRecord.create({
    organizationId: orgId, register: key, refNo, title, status, data, ownerId: body.ownerId || undefined, ownerName: body.ownerName || undefined,
    dueDate: def.dueKey ? toDate(data[def.dueKey]) : undefined, evidenceUrl: body.evidenceUrl,
    source: opts.source || 'manual', sourceRef: opts.sourceRef,
    history: [{ at: new Date(), byId: actor.id, byName: actor.name, action: 'created', note: opts.source === 'auto' ? 'Created automatically' : undefined }],
  });
  if (key === 'restore_test' || key === 'backup') await (await import('./dr.service')).afterSave(orgId, key, rec, actor);
  return rec;
}

export async function updateRecord(orgId: string, key: string, id: string, body: { data?: Record<string, any>; ownerId?: string | null; ownerName?: string; evidenceUrl?: string; status?: string; note?: string }, actor: Actor) {
  const def = REGISTER_MAP[key]; if (!def) throw ApiError.notFound('Unknown register');
  const rec: any = await IsmsRecord.findOne({ _id: id, organizationId: orgId, register: key, isDeleted: { $ne: true } });
  if (!rec) throw ApiError.notFound('Record not found');
  const merged = compute(def, { ...(rec.data || {}), ...cleanData(def, body.data || {}, true) });
  // fields cleared on purpose
  for (const col of def.cols) if (!col.computed && body.data && col.key in body.data && blank(body.data[col.key])) delete merged[col.key];
  const finalData = compute(def, merged);
  if (key === 'deletion' && body.status && ['Approved', 'Deleted', 'Verified'].includes(body.status)) await (await import('./dr.service')).blockedByHold(orgId, rec, finalData, actor);
  if (body.status && body.status !== rec.status) {
    const problem = guardStatus(def, finalData, body.status, actor, rec);
    if (problem) throw ApiError.badRequest(problem);
    rec.history.push({ at: new Date(), byId: actor.id, byName: actor.name, action: `status: ${rec.status} → ${body.status}`, note: body.note });
    rec.status = body.status;
    rec.closedAt = def.closedStatuses.includes(body.status) ? new Date() : undefined;
  } else if (body.data) {
    rec.history.push({ at: new Date(), byId: actor.id, byName: actor.name, action: 'edited', note: body.note });
  }
  rec.data = finalData; rec.markModified('data');
  rec.title = String(finalData[def.titleKey] || rec.title).slice(0, 300);
  rec.dueDate = def.dueKey ? toDate(finalData[def.dueKey]) : undefined;
  if (body.ownerId !== undefined) rec.ownerId = body.ownerId || undefined;
  if (body.ownerName !== undefined) rec.ownerName = body.ownerName;
  if (body.evidenceUrl !== undefined) rec.evidenceUrl = body.evidenceUrl;
  await rec.save();
  if (['restore_test', 'deletion', 'backup'].includes(key)) await (await import('./dr.service')).afterSave(orgId, key, rec, actor);
  return rec;
}

/* ------------------------------------------------------------------ import */
export interface ImportResult { sheets: Array<{ sheet: string; register: string; created: number; skipped: number; duplicates: number }>; ignored: string[] }

const cellText = (c: ExcelJS.Cell): any => {
  const v: any = c.value;
  if (v === null || v === undefined) return undefined;
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    if ('result' in v) return (v as any).result;
    if ('richText' in v) return (v as any).richText.map((t: any) => t.text).join('');
    if ('text' in v) return (v as any).text;
    if ('hyperlink' in v) return (v as any).hyperlink;
    return undefined;
  }
  return v;
};

/** Map the free-text status in an old spreadsheet ("Done", "Ongoing", "Delayed" …) to a status of the register. */
export function mapStatus(def: RegisterDef, raw: unknown): string | undefined {
  const v = norm(raw); if (!v) return undefined;
  const exact = def.statuses.find((x) => norm(x) === v); if (exact) return exact;
  const has = (s: string) => def.statuses.includes(s);
  const closed = def.closedStatuses.find((s) => ['Closed', 'Done', 'Compliant', 'Reviewed'].includes(s)) || def.closedStatuses[0];
  if (/^(closed|done|completed|complete|implemented|resolved|compliant|yes|valid)$/.test(v) || v.startsWith('done') || v.startsWith('closed') || v.startsWith('complet')) return def.key === 'legal' && /valid/.test(v) ? 'Valid' : def.key === 'change' ? (has('Implemented') ? 'Implemented' : closed) : closed;
  if (/(ongoing|inprogress|progress|wip|workinprogress|partial|started)/.test(v)) return has('In progress') ? 'In progress' : has('Work in progress') ? 'Work in progress' : has('Treatment in progress') ? 'Treatment in progress' : has('Implementing') ? 'Implementing' : undefined;
  if (/(delay|overdue|late)/.test(v)) return has('Overdue') ? 'Overdue' : undefined;
  if (/^not?compliant/.test(v)) return has('Non-compliant') ? 'Non-compliant' : undefined;
  if (/(cancel|rejected|notapplicable|^na$|^nanot)/.test(v)) return has('Cancelled') ? 'Cancelled' : has('Rejected') ? 'Rejected' : has('Not applicable') ? 'Not applicable' : undefined;
  if (/^(open|new|pending|planned|notdone|yettobedone|notstarted)/.test(v)) return def.defaultStatus;
  return undefined;
}

/** The company risk sheet has a two-row, merged heading, so it is read by column position. */
async function importRiskSheet(orgId: string, ws: ExcelJS.Worksheet, actor: Actor) {
  const def = REGISTER_MAP.risk; let start = 0;
  for (let r = 1; r <= Math.min(ws.rowCount, 10); r++) if (norm(cellText(ws.getRow(r).getCell(1))).startsWith('riskref')) { start = r + 2; break; }
  if (!start) return null;
  const existing = new Set((await IsmsRecord.find({ organizationId: orgId, register: 'risk', isDeleted: { $ne: true } }).select('data.legacyRef title').lean()).map((x: any) => norm(`${x.data?.legacyRef}|${x.title}`)));
  let created = 0, skipped = 0, duplicates = 0;
  for (let r = start; r <= ws.rowCount; r++) {
    const g = (c: number) => cellText(ws.getRow(r).getCell(c));
    const ticks = ['LR', 'CO', 'BP'].filter((_, i) => !blank(g(18 + i)));
    const summary = String(g(5) ?? '').trim();
    if (summary.length < 3 || blank(g(3))) { skipped++; continue; }
    const data = cleanData(def, { legacyRef: g(1), asset: g(2), threat: g(3), vulnerability: g(4), riskSummary: summary, cImpact: g(8), iImpact: g(9), aImpact: g(10), likelihood: g(12), treatment: g(15), existingControl: g(16), requirement: ticks.join(', '), treatmentPlan: g(21), newControl: g(22), soa: g(23), rImpact: g(24), rLikelihood: g(25), frequency: g(29), lastAssessment: g(31), notes: [g(34), g(28) ? `Residual risk: ${g(28)}` : ''].filter((x) => !blank(x)).join(' – ') }, false);
    const key = norm(`${data.legacyRef}|${summary}`);
    if (existing.has(key)) { duplicates++; continue; }
    const st = mapStatus(def, g(33));
    await createRecord(orgId, 'risk', { data, ownerName: String(g(7) ?? '').trim() || undefined, status: st }, actor, { source: 'import', strict: false });
    existing.add(key); created++;
  }
  return { sheet: ws.name.trim(), register: 'risk', created, skipped, duplicates };
}

/** SWOT (columns of bullets under Strengths/Weaknesses/…) and PESTLE (category in column A, bullets in column B) are lists, not tables. */
async function importContextSheet(orgId: string, ws: ExcelJS.Worksheet, actor: Actor) {
  const def = REGISTER_MAP.context; const isSwot = /swot/i.test(ws.name); const isPestle = /pestle/i.test(ws.name);
  if (!isSwot && !isPestle) return null;
  const existing = new Set((await IsmsRecord.find({ organizationId: orgId, register: 'context', isDeleted: { $ne: true } }).select('title').lean()).map((x: any) => norm(x.title)));
  let created = 0, skipped = 0, duplicates = 0; const cols = new Map<number, string>(); let cat = '';
  const kinds: Record<string, string> = { strengths: 'Strength', weaknesses: 'Weakness', opportunities: 'Opportunity', threats: 'Threat', political: 'Political', economic: 'Economic', social: 'Social', technological: 'Technological', legal: 'Legal', environmental: 'Environmental' };
  const add = async (kind: string, raw: string) => {
    const text = raw.replace(/^[\s●•·\-–\u00a0]+/, '').replace(/\s+/g, ' ').trim();
    if (text.length < 4) { skipped++; return; }
    if (existing.has(norm(text))) { duplicates++; return; }
    await createRecord(orgId, 'context', { data: { kind, issue: text.slice(0, 280), description: text }, status: 'Monitoring' }, actor, { source: 'import', strict: false });
    existing.add(norm(text)); created++;
  };
  for (let r = 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r); let header = false;
    if (isSwot) {
      row.eachCell({ includeEmpty: false }, (cell, idx) => { const t = norm(cellText(cell)); const k = Object.keys(kinds).find((x) => t.startsWith(x)); if (k && t.length < 40 && isNaN(+t)) { cols.set(idx, kinds[k]); header = true; } });
      if (header) continue;
      for (const [idx, kind] of cols) { const v = cellText(row.getCell(idx)); if (!blank(v)) await add(kind, String(v)); }
    } else {
      const vals: string[] = []; row.eachCell({ includeEmpty: false }, (cell) => { const v = cellText(cell); if (!blank(v)) vals.push(String(v)); });
      if (!vals.length) continue;
      const k = kinds[norm(vals[0])]; if (k) cat = k;
      for (const v of k ? vals.slice(1) : vals) if (cat && norm(v) !== 'pestle') await add(cat, v);
    }
  }
  void def; return { sheet: ws.name.trim(), register: 'context', created, skipped, duplicates };
}

export async function importWorkbook(orgId: string, buffer: Buffer, actor: Actor, only?: string): Promise<ImportResult> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as any);
  const result: ImportResult = { sheets: [], ignored: [] };
  for (const ws of wb.worksheets) {
    if ((!only || only === 'risk') && /^ISMS Risk Assessment/i.test(ws.name.trim())) { const x = await importRiskSheet(orgId, ws, actor); if (x) { result.sheets.push(x); continue; } }
    if ((!only || only === 'context') && /^(swot|pestle)/i.test(ws.name.trim())) { const x = await importContextSheet(orgId, ws, actor); if (x) { result.sheets.push(x); continue; } }
    const defs = REGISTERS.filter((d) => (!only || d.key === only) && d.sheetMatch.some((rx) => new RegExp(rx, 'i').test(ws.name.trim())));
    let done = false;
    for (const def of defs) {
      const labelMap = new Map<string, Col>();
      for (const c of def.cols) { if (c.computed && def.key !== 'byod') continue; labelMap.set(norm(c.label), c); for (const a of c.aliases || []) labelMap.set(norm(a), c); }
      // header row = the first row (within 12) where at least 2 cells match known headings
      let headerRow = 0; let cols: Array<{ idx: number; col: Col }> = [];
      for (let r = 1; r <= Math.min(ws.rowCount, 12) && !headerRow; r++) {
        const found: Array<{ idx: number; col: Col }> = [];
        ws.getRow(r).eachCell({ includeEmpty: false }, (cell, idx) => { const h = norm(cellText(cell)); const col = labelMap.get(h) || (h.length >= 8 ? Array.from(labelMap.entries()).find(([k]) => k.length >= 8 && h.startsWith(k))?.[1] : undefined); if (col && !found.find((f) => f.col.key === col.key)) found.push({ idx, col }); });
        if (found.length >= 2) { headerRow = r; cols = found; }
      }
      if (!headerRow) continue;
      let statusIdx = 0;
      ws.getRow(headerRow).eachCell({ includeEmpty: false }, (cell, idx) => { if (!statusIdx && /^status/.test(norm(cellText(cell)))) statusIdx = idx; });
      const existing = new Set((await IsmsRecord.find({ organizationId: orgId, register: def.key, isDeleted: { $ne: true } }).select('title').lean()).map((x: any) => norm(x.title)));
      let created = 0, skipped = 0, duplicates = 0;
      for (let r = headerRow + 1; r <= ws.rowCount; r++) {
        const row = ws.getRow(r); const data: Record<string, any> = {};
        for (const { idx, col } of cols) { const v = cellText(row.getCell(idx)); if (!blank(v)) data[col.key] = v; }
        if (def.key === 'contact') data.group = /authorit/i.test(ws.name) ? 'Authority' : /interest/i.test(ws.name) ? 'Special interest group' : 'Contact';
        if (def.key === 'legal') data.kind = /standard/i.test(ws.name) ? 'Applicable Standard' : /regulat/i.test(ws.name) ? 'Regulatory' : /contract/i.test(ws.name) ? 'Contractual' : /certif/i.test(ws.name) ? 'Certificate' : 'Legal';
        if (def.key === 'context') data.kind = data.kind || (/swot/i.test(ws.name) ? 'Strength' : /pestle/i.test(ws.name) ? 'Political' : 'Internal issue');
        if (def.key === 'training' && /^20\d\d/.test(ws.name.trim())) data.comment = [`Plan year ${ws.name.trim().slice(0, 4)}`, data.comment].filter(Boolean).join(' – ');
        const cleaned = cleanData(def, data, false);
        const title = String(cleaned[def.titleKey] || '').trim();
        if (!title || title.length < 3 || /^[\d.]+$/.test(title)) { skipped++; continue; }
        if (existing.has(norm(title.slice(0, 300)))) { duplicates++; continue; }
        await createRecord(orgId, def.key, { data: cleaned, status: statusIdx ? mapStatus(def, cellText(row.getCell(statusIdx))) : undefined }, actor, { source: 'import', strict: false });
        existing.add(norm(title.slice(0, 300))); created++;
      }
      result.sheets.push({ sheet: ws.name.trim(), register: def.key, created, skipped, duplicates });
      done = true; break;
    }
    if (!done) result.ignored.push(ws.name.trim());
  }
  return result;
}
