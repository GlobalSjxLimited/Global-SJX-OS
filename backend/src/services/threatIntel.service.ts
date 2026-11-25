import crypto from 'crypto';
import dns from 'dns/promises';
import net from 'net';
import { ActivityLog } from '../models/ActivityLog';
import { Asset } from '../models/Asset';
import { UserSession, nextNumber } from '../models/Access';
import { EmailIntakeLog } from '../models/EmailIntake';
import { Organization } from '../models/Organization';
import { ThreatIndicator, ThreatIntel, ThreatSource } from '../models/ThreatIntel';
import { User } from '../models/User';
import { excludeDeleted } from '../utils/softDeletePlugin';
import { ApiError } from '../utils/ApiError';
import { logger } from '../utils/logger';
import { usersWithModule } from './access.service';
import { notifyWork } from './work.notify';

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const DAY = 86400000;

/* ================================ indicators ================================ */
export type IndicatorType = 'ipv4' | 'ipv6' | 'domain' | 'url' | 'email' | 'md5' | 'sha1' | 'sha256' | 'cve' | 'filename' | 'registry_key' | 'other';

/** Undo the "defanging" analysts use to make IOCs safe to paste: hxxp, [.], (.), [@] … */
export function refang(v: string): string {
  return v.trim().replace(/^hxxp/i, 'http').replace(/\[\s*\.\s*\]|\(\s*\.\s*\)|\{\s*\.\s*\}/g, '.').replace(/\[\s*(?:@|at)\s*\]|\(\s*(?:@|at)\s*\)/gi, '@').replace(/\[\s*:\s*\]/g, ':').replace(/\[\s*\/\/\s*\]/g, '//').replace(/^[<"'`(\[]+|[>"'`)\].,;]+$/g, '');
}
const isIPv4 = (v: string) => /^(?:\d{1,3}\.){3}\d{1,3}$/.test(v) && v.split('.').every((o) => +o <= 255);
const HOST = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

/** Works out what kind of indicator a string is and returns it in canonical form, or null when it is none of them. */
export function classifyIndicator(raw: string): { type: IndicatorType; value: string } | null {
  const v = refang(String(raw ?? ''));
  if (!v || v.length > 2048) return null;
  if (/^cve-\d{4}-\d{4,7}$/i.test(v)) return { type: 'cve', value: v.toUpperCase() };
  if (/^[a-f0-9]{64}$/i.test(v)) return { type: 'sha256', value: v.toLowerCase() };
  if (/^[a-f0-9]{40}$/i.test(v)) return { type: 'sha1', value: v.toLowerCase() };
  if (/^[a-f0-9]{32}$/i.test(v)) return { type: 'md5', value: v.toLowerCase() };
  if (/^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(v)) { try { const u = new URL(v); return { type: 'url', value: `${u.protocol}//${u.host.toLowerCase()}${u.pathname}${u.search}${u.hash}` }; } catch { return null; } }
  if (isIPv4(v)) return { type: 'ipv4', value: v.split('.').map((o) => String(+o)).join('.') };
  if (net.isIPv6(v)) return { type: 'ipv6', value: v.toLowerCase() };
  if (/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(v)) return { type: 'email', value: v.toLowerCase() };
  if (/^(?:hkey_|hklm\\|hkcu\\)/i.test(v)) return { type: 'registry_key', value: v };
  if (HOST.test(v)) return { type: 'domain', value: v.toLowerCase() };
  return null;
}

/** Free text (one per line, or separated by commas / spaces) → unique, classified indicators. */
export function parseIocText(text: string): { indicators: Array<{ type: IndicatorType; value: string }>; rejected: string[] } {
  const seen = new Set<string>(); const indicators: Array<{ type: IndicatorType; value: string }> = []; const rejected: string[] = [];
  for (const tok of String(text || '').split(/[\s,;|]+/)) {
    if (!tok || tok.startsWith('#')) continue;
    const c = classifyIndicator(tok);
    if (!c) { if (rejected.length < 50) rejected.push(tok.slice(0, 80)); continue; }
    const k = `${c.type}:${c.value}`; if (seen.has(k)) continue; seen.add(k); indicators.push(c);
  }
  return { indicators, rejected };
}

/** Minimal RFC-4180 CSV reader. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); cell = ''; if (row.some((c) => c.trim())) rows.push(row); row = []; }
    else cell += ch;
  }
  row.push(cell); if (row.some((c) => c.trim())) rows.push(row);
  return rows;
}

export interface ParsedIoc { type: IndicatorType; value: string; confidence?: number; description?: string; tlp?: string; validUntil?: Date }
export function parseCsvIocs(text: string): { indicators: ParsedIoc[]; rejected: string[] } {
  const rows = parseCsv(text); if (!rows.length) return { indicators: [], rejected: [] };
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const col = (...names: string[]) => head.findIndex((h) => names.includes(h));
  const hasHeader = col('value', 'indicator', 'ioc', 'observable') >= 0;
  const iv = hasHeader ? col('value', 'indicator', 'ioc', 'observable') : 0;
  const ic = col('confidence'), id = col('description', 'comment', 'notes'), it = col('tlp'), ie = col('valid_until', 'expires', 'expiry');
  const out: ParsedIoc[] = []; const rejected: string[] = []; const seen = new Set<string>();
  for (const r of rows.slice(hasHeader ? 1 : 0)) {
    const c = classifyIndicator(r[iv] || ''); if (!c) { if (r[iv] && rejected.length < 50) rejected.push(String(r[iv]).slice(0, 80)); continue; }
    const k = `${c.type}:${c.value}`; if (seen.has(k)) continue; seen.add(k);
    const conf = ic >= 0 ? Math.max(0, Math.min(100, parseInt(r[ic], 10))) : NaN;
    const until = ie >= 0 && r[ie] ? new Date(r[ie]) : undefined;
    out.push({ ...c, confidence: Number.isNaN(conf) ? undefined : conf, description: id >= 0 ? r[id]?.slice(0, 300) : undefined, tlp: it >= 0 ? r[it]?.toUpperCase().replace('WHITE', 'CLEAR') : undefined, validUntil: until && !Number.isNaN(+until) ? until : undefined });
  }
  return { indicators: out, rejected };
}

/* ================================== STIX 2.1 ================================= */
export const TLP_MARKING: Record<string, string> = {
  CLEAR: 'marking-definition--613f2e26-407d-48c7-9eca-b8e91df99dc9',
  GREEN: 'marking-definition--34098fce-860f-48ae-8e50-ebd3cc5e41da',
  AMBER: 'marking-definition--f88d31f6-486f-44da-b317-01333bde0b82',
  RED: 'marking-definition--5e57c739-391a-4eb3-b6be-7d15ca92d5ed',
};
/** Deterministic UUID (v5-shaped) so re-exporting the same record yields the same STIX id. */
export function stixId(type: string, key: string): string {
  const h = crypto.createHash('sha1').update(`gsjx-os:${type}:${key}`).digest();
  h[6] = (h[6] & 0x0f) | 0x50; h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return `${type}--${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}
const q = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
export function stixPattern(type: string, value: string): string | null {
  switch (type) {
    case 'ipv4': return `[ipv4-addr:value = ${q(value)}]`;
    case 'ipv6': return `[ipv6-addr:value = ${q(value)}]`;
    case 'domain': return `[domain-name:value = ${q(value)}]`;
    case 'url': return `[url:value = ${q(value)}]`;
    case 'email': return `[email-addr:value = ${q(value)}]`;
    case 'md5': return `[file:hashes.MD5 = ${q(value)}]`;
    case 'sha1': return `[file:hashes.'SHA-1' = ${q(value)}]`;
    case 'sha256': return `[file:hashes.'SHA-256' = ${q(value)}]`;
    case 'filename': return `[file:name = ${q(value)}]`;
    case 'registry_key': return `[windows-registry-key:key = ${q(value)}]`;
    default: return null;
  }
}
/** Strip anything that would identify us or our estate before intelligence leaves the company. */
export function sanitiseText(t: string): string {
  return String(t || '')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[e-mail removed]')
    .replace(/\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b/g, '[internal IP removed]')
    .replace(/GSJX\/[A-Z]+\/\d+/g, '[asset removed]')
    .replace(/Global SJX(?: Limited)?/gi, 'the organisation');
}
export function toStixBundle(intel: any, indicators: any[], opts: { anonymise?: boolean } = {}) {
  const anon = !!opts.anonymise;
  const now = new Date().toISOString();
  const identity = { type: 'identity', spec_version: '2.1', id: stixId('identity', anon ? 'anonymous' : 'global-sjx'), created: now, modified: now, name: anon ? 'Anonymous community member' : 'Global SJX Limited', identity_class: 'organization' };
  const marking = [TLP_MARKING[intel.tlp] || TLP_MARKING.GREEN];
  const objs: any[] = [];
  const refs: string[] = [];
  for (const i of indicators) {
    const pattern = stixPattern(i.type, i.value); if (!pattern) continue;
    const id = stixId('indicator', `${i.type}:${i.value}`);
    refs.push(id);
    objs.push({ type: 'indicator', spec_version: '2.1', id, created: new Date(i.createdAt || Date.now()).toISOString(), modified: new Date(i.updatedAt || Date.now()).toISOString(), created_by_ref: identity.id, name: `${i.type}: ${i.value}`.slice(0, 120), description: i.description ? (anon ? sanitiseText(i.description) : i.description) : undefined, indicator_types: ['malicious-activity'], pattern, pattern_type: 'stix', valid_from: new Date(i.validFrom || Date.now()).toISOString(), valid_until: i.validUntil ? new Date(i.validUntil).toISOString() : undefined, confidence: i.confidence, object_marking_refs: marking });
  }
  for (const cve of intel.cves || []) {
    const id = stixId('vulnerability', cve); refs.push(id);
    objs.push({ type: 'vulnerability', spec_version: '2.1', id, created: now, modified: now, created_by_ref: identity.id, name: cve, external_references: [{ source_name: 'cve', external_id: cve }], object_marking_refs: marking });
  }
  for (const t of intel.ttps || []) {
    const id = stixId('attack-pattern', t); refs.push(id);
    objs.push({ type: 'attack-pattern', spec_version: '2.1', id, created: now, modified: now, created_by_ref: identity.id, name: t, external_references: [{ source_name: 'mitre-attack', external_id: t, url: `https://attack.mitre.org/techniques/${t.replace('.', '/')}/` }], object_marking_refs: marking });
  }
  const reportId = stixId('report', String(intel._id || intel.reference));
  const report = { type: 'report', spec_version: '2.1', id: reportId, created: new Date(intel.createdAt || Date.now()).toISOString(), modified: new Date(intel.updatedAt || Date.now()).toISOString(), created_by_ref: identity.id, name: anon ? sanitiseText(intel.title) : intel.title, description: anon ? sanitiseText(intel.summary) : intel.summary, published: new Date(intel.observedAt || intel.createdAt || Date.now()).toISOString(), report_types: [intel.layer === 'strategic' ? 'threat-report' : intel.layer === 'operational' ? 'attack-pattern' : 'indicator'], object_refs: refs.length ? refs : [identity.id], confidence: intel.confidence === 'high' ? 85 : intel.confidence === 'low' ? 25 : 55, labels: [`severity:${intel.severity}`, `layer:${intel.layer}`], object_marking_refs: marking };
  return { type: 'bundle', id: stixId('bundle', String(intel._id || intel.reference)), objects: [identity, report, ...objs] };
}

/** Parse an inbound STIX 2.1 bundle (or a bare list of objects). Only what we can use is kept. */
export function parseStixBundle(json: any): { indicators: ParsedIoc[]; cves: string[]; ttps: string[]; title?: string; description?: string } {
  const objs: any[] = Array.isArray(json) ? json : json?.objects || [];
  const indicators: ParsedIoc[] = []; const cves = new Set<string>(); const ttps = new Set<string>(); let title: string | undefined; let description: string | undefined;
  const seen = new Set<string>();
  const add = (type: IndicatorType, value: string, o: any) => { const c = classifyIndicator(value) || { type, value }; const k = `${c.type}:${c.value}`; if (seen.has(k)) return; seen.add(k); indicators.push({ type: c.type, value: c.value, confidence: typeof o.confidence === 'number' ? o.confidence : undefined, description: o.description?.slice?.(0, 300), validUntil: o.valid_until ? new Date(o.valid_until) : undefined }); };
  for (const o of objs) {
    if (!o || typeof o !== 'object') continue;
    if (o.type === 'indicator' && typeof o.pattern === 'string') {
      for (const m of o.pattern.matchAll(/\[?\s*([a-z0-9-]+):([a-z0-9_.'"-]+)\s*=\s*'((?:[^'\\]|\\.)*)'/gi)) {
        const obj = m[1].toLowerCase(); const path = m[2].toLowerCase().replace(/['"]/g, ''); const val = m[3].replace(/\\'/g, "'").replace(/\\\\/g, '\\');
        if (obj === 'ipv4-addr') add('ipv4', val, o); else if (obj === 'ipv6-addr') add('ipv6', val, o); else if (obj === 'domain-name') add('domain', val, o);
        else if (obj === 'url') add('url', val, o); else if (obj === 'email-addr') add('email', val, o);
        else if (obj === 'file' && path.startsWith('hashes.')) add(path.includes('256') ? 'sha256' : path.includes('sha-1') || path.includes('sha1') ? 'sha1' : 'md5', val, o);
        else if (obj === 'file' && path === 'name') add('filename', val, o);
        else if (obj === 'windows-registry-key') add('registry_key', val, o);
      }
    } else if (o.type === 'vulnerability') { const n = String(o.name || ''); if (/^cve-/i.test(n)) cves.add(n.toUpperCase()); for (const r of o.external_references || []) if (/^cve-/i.test(r.external_id || '')) cves.add(r.external_id.toUpperCase()); }
    else if (o.type === 'attack-pattern') { for (const r of o.external_references || []) if (/^T\d{4}(\.\d{3})?$/.test(r.external_id || '')) ttps.add(r.external_id); }
    else if (o.type === 'report' && !title) { title = String(o.name || '').slice(0, 200); description = String(o.description || '').slice(0, 5000); }
  }
  return { indicators, cves: Array.from(cves), ttps: Array.from(ttps), title, description };
}

/** CISA Known Exploited Vulnerabilities catalogue → intelligence items (one per CVE). */
export function parseCisaKev(json: any): Array<{ externalId: string; title: string; summary: string; cves: string[]; affectedProducts: string[]; severity: 'high' | 'critical'; observedAt?: Date; recommendations: string; tags: string[] }> {
  const list: any[] = Array.isArray(json?.vulnerabilities) ? json.vulnerabilities : [];
  return list.filter((v) => /^CVE-\d{4}-\d{4,7}$/i.test(v?.cveID || '')).map((v) => ({
    externalId: String(v.cveID).toUpperCase(),
    title: `${String(v.cveID).toUpperCase()} — ${String(v.vulnerabilityName || 'Known exploited vulnerability').slice(0, 160)}`,
    summary: `${v.shortDescription || ''}\n\nVendor/project: ${v.vendorProject || '—'} · Product: ${v.product || '—'}${v.dueDate ? ` · remediation due ${v.dueDate}` : ''}${v.knownRansomwareCampaignUse ? ` · ransomware use: ${v.knownRansomwareCampaignUse}` : ''}`.trim(),
    cves: [String(v.cveID).toUpperCase()], affectedProducts: [v.vendorProject, v.product].filter(Boolean).map(String),
    severity: v.knownRansomwareCampaignUse === 'Known' ? 'critical' : 'high',
    observedAt: v.dateAdded ? new Date(v.dateAdded) : undefined,
    recommendations: String(v.requiredAction || ''), tags: ['kev', 'actively-exploited'],
  }));
}

/* ================================ exposure ================================== */
const GENERIC = new Set(['windows', 'linux', 'server', 'client', 'office', 'software', 'microsoft', 'google', 'apple', 'cloud', 'web', 'network', 'application', 'system', 'enterprise', 'data', 'service', 'services', 'android', 'ios']);
/** Pure: which of our assets mention one of the affected products? Vendor-only generic words are ignored. */
export function matchAssetsToProducts(assets: Array<{ _id: any; assetId?: string; title?: string; vendor?: string; makeModel?: string; version?: string; subCategory?: string }>, products: string[]): Array<{ id: any; assetId?: string; title?: string; matched: string }> {
  const keys = Array.from(new Set(products.map((p) => p.trim().toLowerCase()).filter((p) => p.length >= 3)));
  const out: any[] = [];
  for (const a of assets) {
    const hay = [a.title, a.vendor, a.makeModel, a.version, a.subCategory].filter(Boolean).join(' ').toLowerCase();
    const hit = keys.find((k) => !GENERIC.has(k) && new RegExp(`(^|[^a-z0-9])${esc(k).replace(/\s+/g, '\\s+')}([^a-z0-9]|$)`).test(hay));
    if (hit) out.push({ id: a._id, assetId: a.assetId, title: a.title, matched: hit });
  }
  return out;
}
export async function checkExposure(organizationId: string, products: string[]) {
  if (!products.length) return [];
  const assets: any[] = await Asset.find(excludeDeleted({ organizationId, lifecycleStatus: { $nin: ['disposed', 'retired'] } })).select('assetId title vendor makeModel version subCategory classification criticality').limit(3000).lean();
  return matchAssetsToProducts(assets, products).map((m) => ({ ...m, ...(assets.find((a) => String(a._id) === String(m.id)) ? { classification: assets.find((a) => String(a._id) === String(m.id)).classification, criticality: assets.find((a) => String(a._id) === String(m.id)).criticality } : {}) }));
}

/* ================================== sharing ================================== */
export const SHARE_METHODS = ['stix_taxii', 'email', 'platform', 'verbal', 'public'] as const;
/** Traffic-light protocol: what may leave the company, to whom, and how. Throws with the reason. */
export function assertShareable(intel: any, s: { recipient?: string; method: string; anonymise?: boolean }) {
  if (intel.tlp === 'RED') throw ApiError.forbidden('TLP:RED — not for disclosure, restricted to the named recipients inside the company. It cannot be shared externally.');
  if (!(SHARE_METHODS as readonly string[]).includes(s.method)) throw ApiError.badRequest('Choose how it will be shared.');
  if (!intel.analysis?.trim() || ['new', 'triaged'].includes(intel.status)) throw ApiError.badRequest('Analyse the intelligence first — only analysed, contextualised intelligence is shared (policy 2.6).');
  if (intel.tlp === 'AMBER') {
    if (!s.recipient?.trim()) throw ApiError.badRequest('TLP:AMBER may only go to named recipients — enter who it is for.');
    if (['platform', 'public'].includes(s.method)) throw ApiError.badRequest('TLP:AMBER cannot be published to a community platform or publicly.');
  }
  if (intel.tlp === 'GREEN' && s.method === 'public') throw ApiError.badRequest('TLP:GREEN is for the community, not for public release.');
  if (!s.recipient?.trim() && s.method !== 'public') throw ApiError.badRequest('Say who you are sharing it with.');
  if (['stix_taxii', 'platform', 'public'].includes(s.method) && !s.anonymise) throw ApiError.badRequest('Anonymise before sharing outside the company (removes our names, e-mail addresses, internal IPs and asset ids).');
}

/* ================================== feeds ==================================== */
const PRIVATE_V4 = [/^10\./, /^127\./, /^169\.254\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^0\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./];
export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) return PRIVATE_V4.some((r) => r.test(ip));
  if (net.isIPv6(ip)) { const v = ip.toLowerCase(); return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80') || v.startsWith('::ffff:127.') || v.startsWith('::ffff:10.') || v.startsWith('::ffff:192.168.'); }
  return true;
}
/** Server-side request forgery guard: https only, public addresses only, every redirect re-checked. */
export async function safeFetchText(url: string, opts: { maxBytes?: number; timeoutMs?: number; headers?: Record<string, string> } = {}): Promise<string> {
  let current = url;
  for (let hop = 0; hop < 4; hop++) {
    const u = new URL(current);
    if (u.protocol !== 'https:') throw ApiError.badRequest('Feeds must use https://');
    if (u.username || u.password) throw ApiError.badRequest('Put credentials in a header, not in the URL.');
    const addrs = net.isIP(u.hostname) ? [{ address: u.hostname }] : await dns.lookup(u.hostname, { all: true });
    if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) throw ApiError.badRequest('That address is not allowed (private or internal network).');
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), opts.timeoutMs || 20000);
    try {
      const r = await fetch(current, { redirect: 'manual', signal: ctl.signal, headers: { 'User-Agent': 'GlobalSJX-OS-ThreatIntel/1.0', Accept: 'application/json,text/csv,text/plain,*/*', ...(opts.headers || {}) } });
      if ([301, 302, 303, 307, 308].includes(r.status)) { const loc = r.headers.get('location'); if (!loc) throw ApiError.badRequest('Bad redirect from feed'); current = new URL(loc, current).toString(); continue; }
      if (!r.ok) throw ApiError.badRequest(`The feed answered ${r.status}`);
      const max = opts.maxBytes || 15 * 1024 * 1024;
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > max) throw ApiError.badRequest('The feed is too large');
      return buf.toString('utf8');
    } finally { clearTimeout(t); }
  }
  throw ApiError.badRequest('Too many redirects');
}

/* ================================= persistence ================================= */
export async function upsertIndicators(organizationId: string, items: ParsedIoc[], ctx: { intelId?: any; tlp?: string; sourceName?: string; severity?: string; byName?: string; confidence?: number; validUntil?: Date }) {
  let created = 0, updated = 0;
  for (const i of items) {
    const found: any = await ThreatIndicator.findOne({ organizationId, type: i.type, value: i.value });
    if (found) {
      found.lastSeen = new Date(); if (found.status === 'expired') found.status = 'active';
      if (i.confidence !== undefined && i.confidence > (found.confidence || 0)) found.confidence = i.confidence;
      if (!found.intelId && ctx.intelId) found.intelId = ctx.intelId;
      await found.save(); updated++;
    } else {
      await ThreatIndicator.create({ organizationId, intelId: ctx.intelId, type: i.type, value: i.value, confidence: i.confidence ?? ctx.confidence ?? 60, severity: ctx.severity || 'medium', tlp: (['CLEAR', 'GREEN', 'AMBER', 'RED'].includes(i.tlp || '') ? i.tlp : ctx.tlp) || 'GREEN', description: i.description, sourceName: ctx.sourceName, validUntil: i.validUntil || ctx.validUntil, createdByName: ctx.byName });
      created++;
    }
  }
  return { created, updated };
}

export async function newReference(organizationId: string) { return nextNumber(organizationId, 'TI', { yearly: true, pad: 4 }); }

export async function ensureDefaultSources(organizationId: string) {
  if (await ThreatSource.exists({ organizationId })) return;
  const d = (name: string, type: string, url: string, description: string, extra: any = {}) => ({ organizationId, name, type, url, description, reliability: 'F', vetted: false, ...extra });
  await ThreatSource.insertMany([
    d('MITRE ATT&CK', 'osint', 'https://attack.mitre.org', 'Knowledge base of adversary tactics, techniques and procedures (TTPs) and mitigations.', { defaultLayer: 'operational' }),
    d('CISA Known Exploited Vulnerabilities', 'government', 'https://www.cisa.gov/known-exploited-vulnerabilities-catalog', 'Vulnerabilities known to be exploited in the wild. Can be collected automatically.', { feedFormat: 'cisa_kev', feedUrl: 'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json', defaultLayer: 'tactical', defaultTlp: 'CLEAR' }),
    d('National Vulnerability Database (NVD)', 'government', 'https://nvd.nist.gov', 'US government repository of publicly known vulnerabilities, severities and mitigations.', { defaultTlp: 'CLEAR' }),
    d('AlienVault Open Threat Exchange (OTX)', 'community', 'https://otx.alienvault.com', 'Collaborative platform for sharing threat indicators; API for integration.'),
    d('SANS Internet Storm Center', 'community', 'https://isc.sans.edu', 'Community-driven real-time information on threats, vulnerabilities and exploits.', { defaultTlp: 'CLEAR' }),
    d('VirusTotal', 'commercial', 'https://www.virustotal.com', 'Aggregates antivirus engine and threat-intel results for files, URLs, domains and IPs.'),
    d('Recorded Future', 'commercial', 'https://www.recordedfuture.com', 'Commercial threat-intelligence platform.', { active: false }),
    d('Anomali ThreatStream', 'commercial', 'https://www.anomali.com', 'Commercial platform that aggregates, normalises and enriches intelligence.', { active: false }),
    d('IBM X-Force Exchange', 'commercial', 'https://exchange.xforce.ibmcloud.com', 'Threat research, vulnerabilities and indicators with an API.'),
    d('Internal — incidents, logs and staff reports', 'internal', '', 'Intelligence produced from our own incidents, monitoring and staff reports.', { reliability: 'B', vetted: true, vettingNotes: 'Own data.' }),
  ]);
}

/** Pulls one source's feed and stores what is new. Returns counts. */
export async function collectSource(organizationId: string, source: any, by: { id?: string; name: string }) {
  if (!source.feedUrl || source.feedFormat === 'none') throw ApiError.badRequest('This source has no feed configured.');
  const text = await safeFetchText(source.feedUrl);
  const out = { intelCreated: 0, intelUpdated: 0, indicatorsCreated: 0, indicatorsUpdated: 0 };
  const tlp = source.defaultTlp || 'GREEN';
  if (source.feedFormat === 'cisa_kev') {
    let json: any; try { json = JSON.parse(text); } catch { throw ApiError.badRequest('The feed is not valid JSON.'); }
    const items = parseCisaKev(json);
    const existing = new Set((await ThreatIntel.find(excludeDeleted({ organizationId, externalId: { $in: items.map((i) => i.externalId) } })).select('externalId').lean()).map((e: any) => e.externalId));
    const fresh = items.filter((i) => !existing.has(i.externalId)).slice(0, 2000);
    const firstRun = !source.lastCollectedAt;
    const keep = firstRun ? fresh.filter((i) => i.observedAt && Date.now() - +i.observedAt < 90 * DAY) : fresh; // first collection: only the last 90 days, not the whole history
    for (const i of keep) {
      const exposure = await checkExposure(organizationId, i.affectedProducts);
      await ThreatIntel.create({ organizationId, reference: await newReference(organizationId), externalId: i.externalId, title: i.title, summary: i.summary, layer: 'tactical', category: 'vulnerability', severity: i.severity, confidence: 'high', credibility: 2, tlp, sourceId: source._id, sourceName: source.name, sourceUrl: source.url, origin: 'feed', observedAt: i.observedAt || new Date(), status: exposure.length ? 'triaged' : 'new', cves: i.cves, affectedProducts: i.affectedProducts, tags: i.tags, recommendations: i.recommendations, relevance: exposure.length ? 'high' : 'unassessed', matchedAssetIds: exposure.map((e: any) => e.id), exposureCheckedAt: new Date(), createdByName: by.name });
      if (exposure.length) { const { afterIntelMatched } = await import('./assetRisk.service'); await afterIntelMatched(organizationId, exposure.map((e: any) => e.id), `new exploited vulnerability ${i.cves?.[0] || i.title}`); }
      out.intelCreated++;
    }
  } else {
    let parsed: { indicators: ParsedIoc[]; cves?: string[]; ttps?: string[]; title?: string; description?: string };
    if (source.feedFormat === 'stix') { let json: any; try { json = JSON.parse(text); } catch { throw ApiError.badRequest('The feed is not valid JSON.'); } parsed = parseStixBundle(json); }
    else if (source.feedFormat === 'csv') parsed = parseCsvIocs(text);
    else parsed = parseIocText(text);
    if (parsed.indicators.length) {
      const intel: any = await ThreatIntel.create({ organizationId, reference: await newReference(organizationId), title: `${source.name} — feed import ${new Date().toISOString().slice(0, 10)}`, summary: parsed.description || `${parsed.indicators.length} indicators collected automatically from ${source.name}.`, layer: 'operational', category: 'other', severity: 'medium', confidence: 'medium', tlp, sourceId: source._id, sourceName: source.name, sourceUrl: source.url, origin: 'feed', cves: parsed.cves || [], ttps: parsed.ttps || [], createdByName: by.name });
      const r = await upsertIndicators(organizationId, parsed.indicators.slice(0, 20000), { intelId: intel._id, tlp, sourceName: source.name, byName: by.name });
      out.indicatorsCreated = r.created; out.indicatorsUpdated = r.updated; out.intelCreated++;
    }
  }
  source.lastCollectedAt = new Date(); source.lastCollectStatus = 'ok'; source.lastCollectCount = out.intelCreated + out.indicatorsCreated;
  await source.save();
  return out;
}

/* ================================== hunting =================================== */
export interface Hit { indicator: { id: any; type: string; value: string; severity: string }; where: string; detail: string; at?: Date; refId?: any }
/** Look for active indicators inside our own telemetry: sessions, sign-ins, audit log, e-mail intake log, user directory. */
export async function huntIndicators(organizationId: string, indicators: any[], days = 90): Promise<Hit[]> {
  const hits: Hit[] = []; const since = new Date(Date.now() - days * DAY);
  const ips = indicators.filter((i) => ['ipv4', 'ipv6'].includes(i.type)); const emails = indicators.filter((i) => i.type === 'email');
  const domains = indicators.filter((i) => ['domain', 'url'].includes(i.type));
  const ind = (i: any) => ({ id: i._id, type: i.type, value: i.value, severity: i.severity });
  if (ips.length) {
    const vals = ips.map((i) => i.value); const byVal = new Map(ips.map((i) => [i.value, i]));
    for (const s of await UserSession.find({ organizationId, ip: { $in: vals }, createdAt: { $gte: since } }).select('ip userId createdAt device').limit(200).lean() as any[]) hits.push({ indicator: ind(byVal.get(s.ip)), where: 'Sign-in session', detail: `${s.device || 'device'} from ${s.ip}`, at: s.createdAt, refId: s.userId });
    for (const u of await User.find({ organizationId, lastLoginIp: { $in: vals } }).select('name lastLoginIp lastLoginAt').limit(100).lean() as any[]) hits.push({ indicator: ind(byVal.get(u.lastLoginIp)), where: 'Last login of a user', detail: `${u.name} last signed in from ${u.lastLoginIp}`, at: u.lastLoginAt, refId: u._id });
    for (const l of await ActivityLog.find({ organizationId, ip: { $in: vals }, createdAt: { $gte: since } }).select('ip actorName action createdAt').limit(300).lean() as any[]) hits.push({ indicator: ind(byVal.get(l.ip)), where: 'Audit log', detail: `${l.actorName || 'unknown'} · ${l.action} from ${l.ip}`, at: l.createdAt, refId: l._id });
  }
  if (emails.length) {
    const vals = emails.map((i) => i.value);
    for (const u of await User.find({ organizationId, email: { $in: vals } }).select('name email').lean() as any[]) hits.push({ indicator: ind(emails.find((e) => e.value === String(u.email).toLowerCase()) || emails[0]), where: 'User directory', detail: `${u.name} uses ${u.email}`, refId: u._id });
    for (const m of await EmailIntakeLog.find({ organizationId, from: { $in: vals.map((v) => new RegExp(`^${esc(v)}$`, 'i')) }, receivedAt: { $gte: since } }).select('from subject receivedAt').limit(200).lean() as any[]) hits.push({ indicator: ind(emails.find((e) => e.value === String(m.from).toLowerCase()) || emails[0]), where: 'E-mail intake log', detail: `Mail from ${m.from}: “${String(m.subject || '').slice(0, 80)}”`, at: m.receivedAt, refId: m._id });
  }
  if (domains.length) {
    const hosts = Array.from(new Set(domains.map((d) => { if (d.type === 'domain') return d.value; try { return new URL(d.value).hostname; } catch { return ''; } }).filter(Boolean)));
    for (const h of hosts.slice(0, 500)) {
      const ind0 = domains.find((d) => d.value === h || d.value.includes(h))!;
      const rx = new RegExp(`@${esc(h)}$`, 'i');
      for (const m of await EmailIntakeLog.find({ organizationId, from: rx, receivedAt: { $gte: since } }).select('from subject receivedAt').limit(50).lean() as any[]) hits.push({ indicator: ind(ind0), where: 'E-mail intake log', detail: `Mail from ${m.from} (sender domain on the indicator list)`, at: m.receivedAt, refId: m._id });
      for (const u of await User.find({ organizationId, email: rx }).select('name email').limit(20).lean() as any[]) hits.push({ indicator: ind(ind0), where: 'User directory', detail: `${u.name} uses an address at a listed domain (${u.email})`, refId: u._id });
    }
  }
  return hits;
}

/* ==================================== jobs ==================================== */
export async function runThreatIntelJobs(now = new Date()) {
  const orgs = await Organization.find({ isActive: true }).select('_id');
  const res = { expired: 0, collected: 0, stale: 0 };
  for (const o of orgs) {
    const org = String(o._id);
    try {
      const r: any = await ThreatIndicator.updateMany({ organizationId: org, status: 'active', validUntil: { $lt: now } }, { status: 'expired' });
      res.expired += r.modifiedCount || 0;
      const sources: any[] = await ThreatSource.find(excludeDeleted({ organizationId: org, active: true, autoCollect: true, feedFormat: { $ne: 'none' } }));
      for (const s of sources) {
        if (s.lastCollectedAt && now.getTime() - +s.lastCollectedAt < 20 * 3600 * 1000) continue;
        try { await collectSource(org, s, { name: 'Automatic collection' }); res.collected++; }
        catch (err: any) { s.lastCollectStatus = `failed: ${String(err.message || err).slice(0, 160)}`; await s.save(); logger.warn({ err, source: s.name }, 'threat feed collection failed'); }
        if (s.lastCollectedAt && now.getTime() - +s.lastCollectedAt > 30 * DAY) {
          const mgrs = await usersWithModule(org, 'threat_intel_manage');
          await notifyWork({ organizationId: org, userIds: mgrs.map((u) => String(u._id)), type: 'threat_intel', severity: 'warning', dedupeKey: `ti-stale:${s._id}:${now.toISOString().slice(0, 7)}`, title: `Threat feed stale: ${s.name}`, summary: 'No successful collection for more than 30 days.', link: '/threat-intel?tab=sources', email: false });
          res.stale++;
        }
      }
      const due: any[] = await ThreatIntel.find(excludeDeleted({ organizationId: org, status: { $nin: ['closed', 'dismissed'] }, nextReviewDate: { $lt: now } })).select('reference title analystId createdById').limit(100);
      for (const t of due) await notifyWork({ organizationId: org, userIds: [String(t.analystId || t.createdById)].filter(Boolean), type: 'threat_intel', dedupeKey: `ti-review:${t._id}:${now.toISOString().slice(0, 7)}`, title: `Review due: ${t.reference} ${t.title}`, summary: 'This intelligence is due for review — is it still valid and relevant?', link: `/threat-intel?item=${t._id}`, email: false });
    } catch (err) { logger.error({ err, org }, 'threat intelligence job failed'); }
  }
  return res;
}
