import crypto from 'crypto';

/**
 * Marketing rules in one place (pure, unit-tested): goals, channels, the approval gate and what may be posted.
 * Nothing is posted anywhere until a different person has approved the exact content, with evidence.
 */

export const GOAL_KINDS = ['traffic', 'hiring', 'monetary', 'leads', 'awareness', 'event', 'other'] as const;
export type GoalKind = (typeof GOAL_KINDS)[number];

/** What each goal is measured in, and which result figure counts as progress towards it. */
export const GOAL_META: Record<GoalKind, { label: string; unit: string; metric: 'clicks' | 'hires' | 'revenue' | 'leads' | 'reach' | 'conversions'; help: string }> = {
  traffic: { label: 'Generate traffic', unit: 'visits', metric: 'clicks', help: 'Visits to a page, site or sign-up form.' },
  hiring: { label: 'Employ staff', unit: 'hires', metric: 'hires', help: 'People hired because of this campaign.' },
  monetary: { label: 'Monetary value', unit: 'revenue', metric: 'revenue', help: 'Sales or revenue the campaign brings in.' },
  leads: { label: 'Generate leads', unit: 'leads', metric: 'leads', help: 'New enquiries or sign-ups.' },
  awareness: { label: 'Awareness', unit: 'people reached', metric: 'reach', help: 'How many people saw it.' },
  event: { label: 'Fill an event', unit: 'registrations', metric: 'conversions', help: 'Registrations or attendees.' },
  other: { label: 'Other goal', unit: 'units', metric: 'conversions', help: 'Anything else; say how you will measure it.' },
};

export interface ChannelSpec {
  key: string;
  label: string;
  /** true = the app can post for you once credentials are set up; false = always done by hand by the social media manager */
  api: boolean;
  maxChars: number;
  maxImages: number;
  needsImage?: boolean;
  maxHashtags?: number;
  social: boolean;
}

export const CHANNELS: ChannelSpec[] = [
  { key: 'facebook', label: 'Facebook', api: true, maxChars: 5000, maxImages: 10, social: true },
  { key: 'instagram', label: 'Instagram', api: true, maxChars: 2200, maxImages: 10, needsImage: true, maxHashtags: 30, social: true },
  { key: 'linkedin', label: 'LinkedIn', api: true, maxChars: 3000, maxImages: 9, social: true },
  { key: 'x', label: 'X (Twitter)', api: false, maxChars: 280, maxImages: 4, social: true },
  { key: 'tiktok', label: 'TikTok', api: false, maxChars: 2200, maxImages: 10, social: true },
  { key: 'youtube', label: 'YouTube', api: false, maxChars: 5000, maxImages: 1, social: true },
  { key: 'whatsapp', label: 'WhatsApp', api: false, maxChars: 4000, maxImages: 10, social: true },
  { key: 'website', label: 'Website / banner', api: false, maxChars: 5000, maxImages: 12, social: false },
  { key: 'email', label: 'E-mail newsletter', api: false, maxChars: 20000, maxImages: 12, social: false },
  { key: 'other', label: 'Other', api: false, maxChars: 5000, maxImages: 12, social: false },
];
export const CHANNEL_KEYS = CHANNELS.map((c) => c.key);
export const channelSpec = (k: string) => CHANNELS.find((c) => c.key === k);

export const APPROVAL_STATUSES = ['draft', 'pending', 'changes_requested', 'approved', 'rejected'] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];
export const POSTING_STATUSES = ['sent_to_manager', 'posted', 'failed', 'returned', 'cancelled'] as const;

export const MAX_MEDIA = 12;

export interface CampaignContent {
  headline?: string; body?: string; callToAction?: string; linkUrl?: string; hashtags?: string[];
}
export interface MediaItem { url: string; kind?: string }

/** Text as it will be published on a channel. */
export function composeText(c: CampaignContent, channel?: string): string {
  const parts = [c.headline, c.body, c.callToAction, channel === 'x' ? '' : c.linkUrl].map((x) => (x || '').trim()).filter(Boolean);
  const tags = (c.hashtags || []).map((h) => `#${String(h).replace(/^#+/, '').replace(/\s+/g, '')}`).filter((h) => h.length > 1);
  let text = parts.join('\n\n');
  if (tags.length) text += `${text ? '\n\n' : ''}${tags.join(' ')}`;
  return text;
}

/** Stable fingerprint of what the approver actually saw: copy, link, pictures and where it goes. Any change means approval no longer applies. */
export function contentHash(c: { content?: CampaignContent; media?: MediaItem[]; channels?: string[] }): string {
  const norm = {
    h: (c.content?.headline || '').trim(), b: (c.content?.body || '').trim(), c: (c.content?.callToAction || '').trim(), l: (c.content?.linkUrl || '').trim(),
    t: (c.content?.hashtags || []).map((x) => String(x).toLowerCase()).sort(),
    m: (c.media || []).map((m) => `${m.kind || 'image'}:${m.url}`),
    ch: [...(c.channels || [])].sort(),
  };
  return crypto.createHash('sha256').update(JSON.stringify(norm)).digest('hex');
}

/** Problems with the content for one channel (length, pictures). */
export function channelProblems(c: CampaignContent, media: MediaItem[], channel: string): string[] {
  const spec = channelSpec(channel);
  if (!spec) return [`Unknown channel "${channel}"`];
  const out: string[] = [];
  const text = composeText(c, channel);
  if (text.length > spec.maxChars) out.push(`${spec.label}: the post is ${text.length} characters; the limit is ${spec.maxChars}.`);
  if (spec.needsImage && media.length === 0) out.push(`${spec.label}: add at least one image or banner.`);
  if (media.length > spec.maxImages) out.push(`${spec.label}: at most ${spec.maxImages} images (you have ${media.length}).`);
  if (spec.maxHashtags && (c.hashtags || []).length > spec.maxHashtags) out.push(`${spec.label}: at most ${spec.maxHashtags} hashtags.`);
  if (c.linkUrl && !/^https?:\/\/\S+$/i.test(c.linkUrl.trim())) out.push('The link must start with http:// or https://');
  return out;
}

export interface SubmitInput {
  name?: string; goal?: { kind?: string; target?: number; description?: string };
  channels?: string[]; content?: CampaignContent; media?: MediaItem[]; status?: string;
}
/** Reasons a campaign cannot be sent for approval yet. */
export function submitProblems(c: SubmitInput): string[] {
  const out: string[] = [];
  if (!(c.name || '').trim()) out.push('Give the campaign a name.');
  if (!c.goal?.kind || !(GOAL_KINDS as readonly string[]).includes(c.goal.kind)) out.push('Choose what the campaign is for (traffic, hiring, monetary value …).');
  else if (c.goal.kind !== 'awareness' && !(Number(c.goal.target) > 0)) out.push('Set a target number so success can be measured.');
  if (!(c.channels || []).length) out.push('Choose at least one channel to post on.');
  if (!(c.content?.body || '').trim() && !(c.content?.headline || '').trim()) out.push('Write the post: add a headline or the main text.');
  for (const ch of c.channels || []) out.push(...channelProblems(c.content || {}, c.media || [], ch));
  if (c.status === 'cancelled') out.push('A cancelled campaign cannot be sent for approval.');
  return out;
}

export interface DecideInput {
  decision: 'approve' | 'reject' | 'changes'; note?: string; evidenceCount: number;
  isSubmitter: boolean; isTopLeader: boolean; status: string;
}
/** Reasons an approval decision must be refused. */
export function decisionProblems(i: DecideInput): string[] {
  const out: string[] = [];
  if (i.status !== 'pending') out.push('This campaign is not waiting for approval.');
  const note = (i.note || '').trim();
  if (note.length < 3) out.push(i.decision === 'approve' ? 'Add a comment about what you checked.' : 'Say what is wrong so it can be fixed.');
  if (i.decision === 'approve' && i.evidenceCount < 1) out.push('Attach the evidence for this approval (a sign-off e-mail, signed brief or screenshot) or paste a link to it.');
  if (i.isSubmitter && !i.isTopLeader) out.push('You cannot approve a campaign you sent for approval yourself. Ask someone else.');
  return out;
}

/** Reasons a campaign may not be handed over or posted right now. Checked again at the moment of posting. */
export function postingProblems(c: { approval?: { status?: string; contentHash?: string }; status?: string }, currentHash: string): string[] {
  const out: string[] = [];
  if (c.status === 'cancelled') out.push('This campaign is cancelled.');
  if (c.approval?.status !== 'approved') out.push('Nothing can be posted until the campaign is approved.');
  else if (c.approval.contentHash !== currentHash) out.push('The content changed after it was approved. It needs approving again.');
  return out;
}

export interface Metrics { reach?: number; clicks?: number; leads?: number; conversions?: number; spend?: number; revenue?: number; hires?: number }
/** Progress towards the goal as a whole-number percentage (may pass 100). */
export function goalProgress(goal: { kind?: string; target?: number } | undefined, m: Metrics | undefined): { current: number; target: number; percent: number } {
  const kind = (goal?.kind && (GOAL_KINDS as readonly string[]).includes(goal.kind) ? goal.kind : 'other') as GoalKind;
  const current = Number((m || {})[GOAL_META[kind].metric] || 0);
  const target = Number(goal?.target || 0);
  return { current, target, percent: target > 0 ? Math.round((current / target) * 100) : 0 };
}

/** Rule-based "how is it going" lines for a campaign. */
export function campaignInsights(c: { goal?: { kind?: string; target?: number }; metrics?: Metrics; postings?: Array<{ status: string }>; budget?: number; approval?: { status?: string } }): string[] {
  const out: string[] = [];
  const g = goalProgress(c.goal, c.metrics);
  const m = c.metrics || {};
  const posted = (c.postings || []).filter((p) => p.status === 'posted').length;
  if (c.approval?.status !== 'approved') out.push('Not approved yet, so nothing has gone out.');
  else if (!posted) out.push('Approved but not posted yet. Hand it to the social media manager.');
  if (posted && g.target > 0) out.push(`${g.percent}% of the target (${g.current} of ${g.target}).`);
  if (posted && (m.reach || 0) > 0 && (m.clicks || 0) / (m.reach || 1) < 0.01) out.push('Fewer than 1 in 100 people who saw it clicked. Try a clearer call to action or a stronger image.');
  if ((m.clicks || 0) > 0 && !(m.leads || m.conversions || m.hires || m.revenue)) out.push('People are clicking but nothing is converting. Check the page the link goes to.');
  if (c.budget && (m.spend || 0) > c.budget) out.push('Spend is over budget.');
  if (c.budget && (m.spend || 0) > 0 && (m.revenue || 0) > 0) out.push(`Return so far: ${((m.revenue || 0) / (m.spend || 1)).toFixed(2)} per 1 spent.`);
  return out;
}
