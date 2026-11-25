import { Schema, model } from 'mongoose';

/** Highest sensitivity wins. Index = rank. */
export const CLASS_ORDER = ['Public', 'Internal', 'Confidential', 'Restricted'] as const;
export type Classification = (typeof CLASS_ORDER)[number];

export interface ClassRule { name: string; keywords: string[]; classification: Classification; categories?: string[]; enabled?: boolean }
export interface BlockedName { term: string; matchType: 'word' | 'contains' | 'regex'; reason?: string; appliesTo?: 'title' | 'all'; enabled?: boolean }
export interface AssetPolicyData {
  autoLabel: boolean;
  enforceMinimum: boolean;
  defaultClassification: Classification;
  categoryDefaults: Record<string, Classification>;
  rules: ClassRule[];
  blockedNames: BlockedName[];
  naming: { minTitleLength: number; blockEmails: boolean; blockSecrets: boolean; blockCardNumbers: boolean; blockIpAddresses: boolean; blockPlaceholders: boolean };
}

/**
 * Built-in policy used until an administrator saves their own. Wording follows the keywords people actually
 * use when describing assets; every rule can be edited, disabled or added to in the UI.
 */
export const DEFAULT_ASSET_POLICY: AssetPolicyData = {
  autoLabel: true,
  enforceMinimum: true,
  defaultClassification: 'Internal',
  categoryDefaults: { network: 'Confidential', people: 'Confidential', information: 'Internal' },
  rules: [
    { name: 'Credentials & cryptographic material', classification: 'Restricted', keywords: ['password', 'passphrase', 'credential', 'private key', 'secret key', 'api key', 'token', 'vault', 'hsm', 'certificate authority', 'encryption key', 'mfa seed'] },
    { name: 'Personal & regulated data', classification: 'Restricted', keywords: ['personal data', 'pii', 'special category', 'medical', 'health record', 'biometric', 'passport', 'national id', 'bvn', 'nin', 'card holder', 'cardholder', 'pan data', 'payment card'] },
    { name: 'Source code & security configuration', classification: 'Confidential', keywords: ['source code', 'repository', 'firewall rule', 'vpn config', 'penetration test', 'pentest', 'vulnerability report', 'security assessment', 'network diagram', 'architecture diagram', 'incident report', 'siem'] },
    { name: 'Financial, HR & legal', classification: 'Confidential', keywords: ['payroll', 'salary', 'bank', 'invoice', 'tax', 'contract', 'nda', 'legal', 'disciplinary', 'performance review', 'employee record', 'board', 'm&a', 'merger', 'acquisition', 'audit report'] },
    { name: 'Customer & client information', classification: 'Confidential', keywords: ['customer data', 'client data', 'client list', 'customer list', 'customer database', 'crm', 'proposal', 'tender', 'pricing'] },
    { name: 'Everyday internal material', classification: 'Internal', keywords: ['internal', 'procedure', 'policy', 'handbook', 'minutes', 'roadmap', 'training material', 'laptop', 'desktop', 'workstation', 'phone', 'tablet'] },
    { name: 'Published material', classification: 'Public', keywords: ['public', 'brochure', 'press release', 'website content', 'marketing material', 'newsletter', 'published', 'case study', 'blog'] },
  ],
  blockedNames: [
    { term: 'test', matchType: 'word', reason: 'Placeholder names make the register unusable. Name the real asset.' },
    { term: 'untitled', matchType: 'word', reason: 'Placeholder names make the register unusable. Name the real asset.' },
    { term: 'asdf', matchType: 'contains', reason: 'Looks like keyboard mashing — give the asset a meaningful name.' },
    { term: 'xxx', matchType: 'contains', reason: 'Looks like a placeholder — give the asset a meaningful name.' },
    { term: 'password', matchType: 'word', reason: 'Never put a password (or the word) in an asset name — name the system it belongs to instead.', appliesTo: 'title' },
    { term: 'my laptop', matchType: 'contains', reason: 'Asset names must identify the device (make/model/owner code), not use pronouns.' },
  ],
  naming: { minTitleLength: 4, blockEmails: true, blockSecrets: true, blockCardNumbers: true, blockIpAddresses: false, blockPlaceholders: true },
};

const policySchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, unique: true },
    autoLabel: { type: Boolean, default: true },
    enforceMinimum: { type: Boolean, default: true },
    defaultClassification: { type: String, enum: CLASS_ORDER, default: 'Internal' },
    categoryDefaults: { type: Schema.Types.Mixed, default: {} },
    rules: [{ name: String, keywords: [String], classification: { type: String, enum: CLASS_ORDER }, categories: [String], enabled: { type: Boolean, default: true }, _id: false }],
    blockedNames: [{ term: String, matchType: { type: String, enum: ['word', 'contains', 'regex'], default: 'word' }, reason: String, appliesTo: { type: String, enum: ['title', 'all'], default: 'all' }, enabled: { type: Boolean, default: true }, _id: false }],
    naming: { type: Schema.Types.Mixed, default: {} },
    updatedById: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);
export const AssetPolicy = model('AssetPolicy', policySchema);
