import { Schema, model } from 'mongoose';
import { softDeletePlugin } from '../utils/softDeletePlugin';

const ref = (to: string, extra: object = {}) => ({ type: Schema.Types.ObjectId, ref: to, ...extra });

export const LAYERS = ['strategic', 'tactical', 'operational'] as const;
export const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
export const TLPS = ['CLEAR', 'GREEN', 'AMBER', 'RED'] as const;
export const INTEL_STATUSES = ['new', 'triaged', 'analysed', 'actioned', 'shared', 'closed', 'dismissed'] as const;
export const CATEGORIES = ['threat_actor', 'malware', 'ransomware', 'phishing', 'vulnerability', 'ddos', 'web_application', 'supply_chain', 'zero_day', 'insider', 'apt', 'fraud', 'other'] as const;
export const ACTOR_TYPES = ['nation_state', 'organised_crime', 'hacktivist', 'insider', 'apt', 'unknown'] as const;
export const INDICATOR_TYPES = ['ipv4', 'ipv6', 'domain', 'url', 'email', 'md5', 'sha1', 'sha256', 'cve', 'filename', 'registry_key', 'other'] as const;
export const ACTION_TYPES = ['risk_assessment', 'control_update', 'test_input', 'threat_hunt', 'incident_response', 'awareness', 'third_party_review', 'patch', 'other'] as const;
export const SOURCE_TYPES = ['osint', 'government', 'isac', 'commercial', 'vendor', 'community', 'internal', 'other'] as const;
export const FEED_FORMATS = ['none', 'cisa_kev', 'stix', 'csv', 'text'] as const;

/* ---------------------------------- Sources -------------------------------- */
const sourceSchema = new Schema(
  {
    organizationId: ref('Organization', { required: true, index: true }),
    name: { type: String, required: true, trim: true },
    type: { type: String, enum: SOURCE_TYPES, default: 'osint' },
    url: String,
    description: String,
    /** Admiralty reliability of the source: A completely reliable … F cannot be judged. */
    reliability: { type: String, enum: ['A', 'B', 'C', 'D', 'E', 'F'], default: 'F' },
    vetted: { type: Boolean, default: false },
    vettedById: ref('User'), vettedByName: String, vettedAt: Date, vettingNotes: String,
    nextReviewDate: Date,
    active: { type: Boolean, default: true },
    defaultTlp: { type: String, enum: TLPS, default: 'GREEN' },
    defaultLayer: { type: String, enum: LAYERS, default: 'tactical' },
    feedFormat: { type: String, enum: FEED_FORMATS, default: 'none' },
    feedUrl: String,
    autoCollect: { type: Boolean, default: false },
    lastCollectedAt: Date, lastCollectStatus: String, lastCollectCount: Number,
    createdByName: String,
  },
  { timestamps: true }
);
sourceSchema.index({ organizationId: 1, name: 1 }, { unique: true });
sourceSchema.plugin(softDeletePlugin);
export const ThreatSource = model('ThreatSource', sourceSchema);

/* ---------------------------------- Intelligence --------------------------- */
const actionSchema = new Schema({
  type: { type: String, enum: ACTION_TYPES, default: 'other' },
  text: { type: String, required: true },
  ownerId: ref('User'), ownerName: String, dueDate: Date,
  done: { type: Boolean, default: false }, doneAt: Date,
  taskId: ref('Task'), riskId: ref('Risk'),
  createdAt: { type: Date, default: Date.now },
});
const shareSchema = new Schema({ at: { type: Date, default: Date.now }, byId: ref('User'), byName: String, recipient: String, method: String, tlp: String, anonymised: Boolean, note: String }, { _id: false });
const noteSchema = new Schema({ at: { type: Date, default: Date.now }, byId: ref('User'), byName: String, text: String }, { _id: false });

const intelSchema = new Schema(
  {
    organizationId: ref('Organization', { required: true, index: true }),
    reference: { type: String, required: true },
    externalId: { type: String, index: true }, // e.g. CVE id from a feed — de-duplicates re-imports
    title: { type: String, required: true, trim: true },
    summary: { type: String, default: '' },
    layer: { type: String, enum: LAYERS, default: 'tactical', index: true },
    category: { type: String, enum: CATEGORIES, default: 'other', index: true },
    actorType: { type: String, enum: ACTOR_TYPES },
    actorName: String,
    severity: { type: String, enum: SEVERITIES, default: 'medium', index: true },
    confidence: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
    /** Admiralty credibility of THIS item: 1 confirmed … 6 cannot be judged. */
    credibility: { type: Number, min: 1, max: 6, default: 3 },
    tlp: { type: String, enum: TLPS, default: 'GREEN', index: true },
    restrictedTo: [ref('User')],
    sourceId: ref('ThreatSource'),
    sourceName: String,
    sourceUrl: String,
    origin: { type: String, enum: ['manual', 'import', 'feed', 'incident', 'asset'], default: 'manual' },
    observedAt: { type: Date, default: Date.now },
    validUntil: Date,
    status: { type: String, enum: INTEL_STATUSES, default: 'new', index: true },
    ttps: [String], // MITRE ATT&CK technique IDs, e.g. T1566.001
    cves: [String],
    affectedProducts: [String],
    tags: [String],
    relevance: { type: String, enum: ['unassessed', 'not_relevant', 'low', 'medium', 'high'], default: 'unassessed', index: true },
    analysis: { type: String, default: '' }, // how this relates to us and why it matters
    recommendations: { type: String, default: '' }, // remediation, incident-response guidance, defensive measures
    matchedAssetIds: [ref('Asset')],
    exposureCheckedAt: Date,
    actions: [actionSchema],
    incidentId: ref('Incident'),
    shares: [shareSchema],
    notes: [noteSchema],
    createdById: ref('User'), createdByName: String,
    analystId: ref('User'), analystName: String,
    reviewedAt: Date,
    nextReviewDate: Date,
    closedAt: Date,
  },
  { timestamps: true }
);
intelSchema.index({ organizationId: 1, reference: 1 }, { unique: true });
intelSchema.index({ organizationId: 1, createdAt: -1 });
intelSchema.plugin(softDeletePlugin);
export const ThreatIntel = model('ThreatIntel', intelSchema);

/* --------------------------------- Indicators ------------------------------ */
const indicatorSchema = new Schema(
  {
    organizationId: ref('Organization', { required: true, index: true }),
    intelId: ref('ThreatIntel', { index: true }),
    type: { type: String, enum: INDICATOR_TYPES, required: true, index: true },
    value: { type: String, required: true },
    confidence: { type: Number, min: 0, max: 100, default: 60 },
    severity: { type: String, enum: SEVERITIES, default: 'medium' },
    tlp: { type: String, enum: TLPS, default: 'GREEN' },
    status: { type: String, enum: ['active', 'expired', 'revoked', 'allowlisted'], default: 'active', index: true },
    description: String,
    tags: [String],
    sourceName: String,
    validFrom: { type: Date, default: Date.now },
    validUntil: Date,
    firstSeen: { type: Date, default: Date.now },
    lastSeen: { type: Date, default: Date.now },
    sightings: { type: Number, default: 0 },
    lastSightingAt: Date,
    lastSightingNote: String,
    createdByName: String,
  },
  { timestamps: true }
);
indicatorSchema.index({ organizationId: 1, type: 1, value: 1 }, { unique: true });
export const ThreatIndicator = model('ThreatIndicator', indicatorSchema);
