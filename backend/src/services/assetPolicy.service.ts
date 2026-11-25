import { AssetPolicy, AssetPolicyData, BlockedName, CLASS_ORDER, Classification, ClassRule, DEFAULT_ASSET_POLICY } from '../models/AssetPolicy';
import { ApiError } from '../utils/ApiError';

const rank = (c?: string) => Math.max(0, CLASS_ORDER.indexOf(c as Classification));
export const higher = (a?: string, b?: string): boolean => rank(a) > rank(b);
export const maxClass = (a?: string, b?: string): Classification => (rank(a) >= rank(b) ? (a as Classification) : (b as Classification)) || 'Internal';

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Whole-word, case-insensitive match; multi-word phrases and symbols (e.g. "m&a") are supported. */
export function hasWord(text: string, term: string): boolean {
  const t = term.trim();
  if (!t) return false;
  return new RegExp(`(^|[^a-z0-9])${esc(t.toLowerCase()).replace(/\s+/g, '\\s+')}([^a-z0-9]|$)`, 'i').test(text);
}

/** Merge stored policy over the built-in default so a partially configured org still works. */
export function mergePolicy(stored: any | null): AssetPolicyData {
  if (!stored) return structuredClone(DEFAULT_ASSET_POLICY);
  const d = DEFAULT_ASSET_POLICY;
  return {
    autoLabel: stored.autoLabel ?? d.autoLabel,
    enforceMinimum: stored.enforceMinimum ?? d.enforceMinimum,
    defaultClassification: stored.defaultClassification || d.defaultClassification,
    categoryDefaults: { ...d.categoryDefaults, ...(stored.categoryDefaults || {}) },
    rules: Array.isArray(stored.rules) && stored.rules.length ? stored.rules.map((r: any) => ({ ...(r.toObject?.() ?? r) })) : d.rules,
    blockedNames: Array.isArray(stored.blockedNames) ? stored.blockedNames.map((r: any) => ({ ...(r.toObject?.() ?? r) })) : d.blockedNames,
    naming: { ...d.naming, ...(stored.naming || {}) },
  };
}

export async function getPolicy(organizationId: string): Promise<AssetPolicyData> {
  return mergePolicy(await AssetPolicy.findOne({ organizationId }).lean());
}

export interface Suggestion { classification: Classification; matched: Array<{ rule: string; keyword: string; classification: Classification }>; reason: string; usedDefault: boolean }

/** Pure: label an asset from its description. The highest-sensitivity matching rule wins; otherwise the category default, then the org default. */
export function suggestClassification(policy: AssetPolicyData, a: { title?: string; description?: string; category?: string; tags?: string[]; subCategory?: string }): Suggestion {
  const text = [a.title, a.description, a.subCategory, ...(a.tags || [])].filter(Boolean).join(' \n ');
  const matched: Suggestion['matched'] = [];
  for (const r of policy.rules as ClassRule[]) {
    if (r.enabled === false) continue;
    if (r.categories?.length && a.category && !r.categories.includes(a.category)) continue;
    for (const k of r.keywords || []) if (hasWord(text, k)) { matched.push({ rule: r.name, keyword: k, classification: r.classification }); break; }
  }
  let best: Classification | undefined;
  for (const m of matched) if (!best || higher(m.classification, best)) best = m.classification;
  const floor = (a.category && policy.categoryDefaults[a.category]) || undefined;
  if (best) {
    const final = floor && higher(floor, best) ? floor : best;
    const top = matched.filter((m) => m.classification === best).map((m) => `“${m.keyword}”`).slice(0, 3).join(', ');
    return { classification: final, matched, usedDefault: false, reason: final === best ? `Description mentions ${top} (${matched.find((m) => m.classification === best)!.rule}).` : `Category minimum for ${a.category} assets.` };
  }
  const fallback = floor || policy.defaultClassification;
  return { classification: fallback, matched, usedDefault: true, reason: floor ? `No keyword matched; ${a.category} assets default to ${floor}.` : `No keyword matched; organisation default.` };
}

export interface NamingProblem { field: string; message: string; rule: string }
const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'a private key'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'an AWS access key'],
  [/\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{10,}\b/, 'an API secret key'],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}\b/, 'a GitHub token'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\b/, 'a JSON web token'],
  [/\b(?:password|passwd|pwd|passphrase|secret|api[_ -]?key)\s*[:=]\s*\S{3,}/i, 'a password or secret'],
  [/\b[A-Fa-f0-9]{40,}\b/, 'a long hexadecimal secret or hash'],
];
const luhn = (digits: string) => { let sum = 0, alt = false; for (let i = digits.length - 1; i >= 0; i--) { let n = +digits[i]; if (alt) { n *= 2; if (n > 9) n -= 9; } sum += n; alt = !alt; } return sum % 10 === 0; };
const PLACEHOLDER = /^(?:n\/?a|none|nil|tbd|todo|unknown|new asset|asset|item|thing|stuff|temp|temporary|sample|dummy|foo|bar|abc|abcd|1234|123)$/i;

/** Pure: why this text must not be entered. Empty array = acceptable. */
export function checkNaming(policy: AssetPolicyData, v: { title?: string; description?: string }): NamingProblem[] {
  const out: NamingProblem[] = [];
  const n = policy.naming;
  const title = String(v.title ?? '').trim();
  if (v.title !== undefined) {
    if (title.length < (n.minTitleLength || 1)) out.push({ field: 'title', rule: 'minimum length', message: `Name the asset properly — at least ${n.minTitleLength} characters.` });
    if (n.blockPlaceholders && PLACEHOLDER.test(title)) out.push({ field: 'title', rule: 'placeholder', message: `“${title}” is a placeholder. Use a name that identifies the asset.` });
    if (n.blockPlaceholders && /^(.)\1{3,}$/.test(title)) out.push({ field: 'title', rule: 'placeholder', message: 'Repeated characters are not a valid asset name.' });
  }
  const fields: Array<['title' | 'description', string]> = [['title', title], ['description', String(v.description ?? '')]];
  for (const [field, text] of fields) {
    if (!text) continue;
    if (n.blockEmails && /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(text)) out.push({ field, rule: 'e-mail address', message: `The ${field} contains an e-mail address. Put people in the owner / custodian fields instead.` });
    if (n.blockSecrets) for (const [re, what] of SECRET_PATTERNS) if (re.test(text)) { out.push({ field, rule: 'secret', message: `The ${field} appears to contain ${what}. Secrets must never be written into the register — store them in the password vault.` }); break; }
    if (n.blockCardNumbers) for (const m of text.matchAll(/\b(?:\d[ -]?){13,19}\b/g)) { const d = m[0].replace(/\D/g, ''); if (d.length >= 13 && d.length <= 19 && luhn(d)) { out.push({ field, rule: 'card number', message: `The ${field} contains what looks like a payment card number.` }); break; } }
    if (n.blockIpAddresses && /\b(?:\d{1,3}\.){3}\d{1,3}\b/.test(text)) out.push({ field, rule: 'ip address', message: `The ${field} contains an IP address.` });
    for (const b of policy.blockedNames as BlockedName[]) {
      if (b.enabled === false || !b.term) continue;
      if (b.appliesTo === 'title' && field !== 'title') continue;
      let hit = false;
      if (b.matchType === 'regex') { try { hit = new RegExp(b.term, 'i').test(text); } catch { hit = false; } }
      else if (b.matchType === 'contains') hit = text.toLowerCase().includes(b.term.toLowerCase());
      else hit = hasWord(text, b.term);
      if (hit) out.push({ field, rule: `blocked: ${b.term}`, message: b.reason || `“${b.term}” is not allowed in the ${field}.` });
    }
  }
  return out;
}

/** Throws a 422 listing every problem (so the person can fix them in one go). */
export function assertNaming(policy: AssetPolicyData, v: { title?: string; description?: string }) {
  const problems = checkNaming(policy, v);
  if (problems.length) throw new ApiError(422, problems.map((p) => p.message).join(' '), problems);
}

export interface Decision { classification: Classification; source: 'auto' | 'manual' | 'override'; reason?: string; suggestion: Suggestion; blocked?: string }

/**
 * What classification should an asset get?
 *  - nothing chosen (or `auto`) → the suggestion
 *  - chosen below the minimum the rules demand → rejected, unless the actor may override (with a reason)
 *  - chosen at or above the suggestion → kept as the person's own choice
 */
export function decideClassification(policy: AssetPolicyData, input: { chosen?: string; auto?: boolean; overrideReason?: string; canOverride?: boolean }, asset: Parameters<typeof suggestClassification>[1]): Decision {
  const suggestion = suggestClassification(policy, asset);
  const chosen = input.chosen && CLASS_ORDER.includes(input.chosen as Classification) ? (input.chosen as Classification) : undefined;
  if (!policy.autoLabel) return { classification: chosen || policy.defaultClassification, source: 'manual', suggestion };
  if (!chosen || input.auto) return { classification: suggestion.classification, source: 'auto', reason: suggestion.reason, suggestion };
  if (!higher(suggestion.classification, chosen) || suggestion.usedDefault) return { classification: chosen, source: 'manual', suggestion };
  // chosen is lower than what the description demands
  if (!policy.enforceMinimum) return { classification: chosen, source: 'manual', suggestion };
  if (input.canOverride && input.overrideReason?.trim()) return { classification: chosen, source: 'override', reason: `Override of ${suggestion.classification}: ${input.overrideReason.trim().slice(0, 300)}`, suggestion };
  return { classification: suggestion.classification, source: 'auto', suggestion, blocked: `Based on its description this asset must be at least ${suggestion.classification} (${suggestion.reason}) — you chose ${chosen}. ${input.canOverride ? 'Give an override reason to keep the lower label.' : 'Ask the ISMS owner / administrator to approve a lower label.'}` };
}

/** Validates administrator edits before they are saved. */
export function validatePolicyInput(body: any): Partial<AssetPolicyData> {
  const out: any = {};
  const cls = (c: any) => CLASS_ORDER.includes(c);
  if (body.autoLabel !== undefined) out.autoLabel = !!body.autoLabel;
  if (body.enforceMinimum !== undefined) out.enforceMinimum = !!body.enforceMinimum;
  if (body.defaultClassification !== undefined) { if (!cls(body.defaultClassification)) throw ApiError.badRequest('Invalid default classification'); out.defaultClassification = body.defaultClassification; }
  if (body.categoryDefaults !== undefined) {
    const m: any = {};
    for (const [k, v] of Object.entries(body.categoryDefaults || {})) { if (!v) continue; if (!cls(v)) throw ApiError.badRequest(`Invalid classification for ${k}`); m[k] = v; }
    out.categoryDefaults = m;
  }
  if (body.rules !== undefined) {
    if (!Array.isArray(body.rules) || body.rules.length > 100) throw ApiError.badRequest('Rules must be a list (max 100)');
    out.rules = body.rules.map((r: any, i: number) => {
      if (!r?.name || !String(r.name).trim()) throw ApiError.badRequest(`Rule ${i + 1} needs a name`);
      if (!cls(r.classification)) throw ApiError.badRequest(`Rule “${r.name}” needs a valid classification`);
      const keywords = (Array.isArray(r.keywords) ? r.keywords : String(r.keywords || '').split(',')).map((k: any) => String(k).trim()).filter(Boolean).slice(0, 80);
      if (!keywords.length) throw ApiError.badRequest(`Rule “${r.name}” needs at least one keyword`);
      return { name: String(r.name).trim().slice(0, 80), classification: r.classification, keywords, categories: Array.isArray(r.categories) ? r.categories.filter(Boolean) : [], enabled: r.enabled !== false };
    });
  }
  if (body.blockedNames !== undefined) {
    if (!Array.isArray(body.blockedNames) || body.blockedNames.length > 300) throw ApiError.badRequest('Blocked names must be a list (max 300)');
    out.blockedNames = body.blockedNames.map((b: any) => {
      const term = String(b?.term || '').trim();
      if (!term) throw ApiError.badRequest('Every blocked name needs a term');
      const matchType = ['word', 'contains', 'regex'].includes(b.matchType) ? b.matchType : 'word';
      if (matchType === 'regex') { if (term.length > 200) throw ApiError.badRequest('Pattern too long'); try { new RegExp(term); } catch { throw ApiError.badRequest(`“${term}” is not a valid pattern`); } }
      return { term: term.slice(0, 200), matchType, reason: b.reason ? String(b.reason).slice(0, 240) : undefined, appliesTo: b.appliesTo === 'title' ? 'title' : 'all', enabled: b.enabled !== false };
    });
  }
  if (body.naming !== undefined) {
    const n = body.naming || {};
    out.naming = { minTitleLength: Math.min(Math.max(parseInt(n.minTitleLength, 10) || 1, 1), 40), blockEmails: !!n.blockEmails, blockSecrets: !!n.blockSecrets, blockCardNumbers: !!n.blockCardNumbers, blockIpAddresses: !!n.blockIpAddresses, blockPlaceholders: !!n.blockPlaceholders };
  }
  return out;
}
