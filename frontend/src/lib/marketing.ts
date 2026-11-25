/** Mirrors backend/src/config/marketing.ts so screens can check as people type. The server checks again. */
export const GOAL_KINDS = ['traffic', 'hiring', 'monetary', 'leads', 'awareness', 'event', 'other'] as const;
export const GOAL_META: Record<string, { label: string; unit: string; help: string }> = {
  traffic: { label: 'Generate traffic', unit: 'visits', help: 'Visits to a page, site or sign-up form.' },
  hiring: { label: 'Employ staff', unit: 'hires', help: 'People hired because of this campaign.' },
  monetary: { label: 'Monetary value', unit: 'revenue', help: 'Sales or revenue the campaign brings in.' },
  leads: { label: 'Generate leads', unit: 'leads', help: 'New enquiries or sign-ups.' },
  awareness: { label: 'Awareness', unit: 'people reached', help: 'How many people saw it.' },
  event: { label: 'Fill an event', unit: 'registrations', help: 'Registrations or attendees.' },
  other: { label: 'Other goal', unit: 'units', help: 'Anything else; say how you will measure it.' },
};
export interface ChannelSpec { key: string; label: string; api: boolean; maxChars: number; maxImages: number; needsImage?: boolean; maxHashtags?: number; social: boolean }
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
export const channelLabel = (k: string) => CHANNELS.find((c) => c.key === k)?.label || k;
export const MAX_MEDIA = 12;
export const APPROVAL_LABEL: Record<string, string> = { draft: 'Not sent for approval', pending: 'Waiting for approval', changes_requested: 'Changes requested', approved: 'Approved', rejected: 'Rejected' };
export const APPROVAL_TONE: Record<string, 'neutral' | 'gold' | 'danger' | 'success' | 'accent'> = { draft: 'neutral', pending: 'gold', changes_requested: 'gold', approved: 'success', rejected: 'danger' };
export const POSTING_LABEL: Record<string, string> = { sent_to_manager: 'With the social media manager', posted: 'Posted', failed: 'Failed', returned: 'Sent back', cancelled: 'Cancelled' };

/** The text exactly as the backend composes it for a channel. */
export function composeText(c: { headline?: string; body?: string; callToAction?: string; linkUrl?: string; hashtags?: string[] }, channel?: string): string {
  const parts = [c.headline, c.body, c.callToAction, channel === 'x' ? '' : c.linkUrl].map((x) => (x || '').trim()).filter(Boolean);
  const tags = (c.hashtags || []).map((h) => `#${String(h).replace(/^#+/, '').replace(/\s+/g, '')}`).filter((h) => h.length > 1);
  let text = parts.join('\n\n');
  if (tags.length) text += `${text ? '\n\n' : ''}${tags.join(' ')}`;
  return text;
}
