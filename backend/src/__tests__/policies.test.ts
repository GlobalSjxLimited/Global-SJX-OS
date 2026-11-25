import { DEFAULT_ASSET_POLICY } from '../models/AssetPolicy';
import { checkNaming, decideClassification, mergePolicy, suggestClassification } from '../services/assetPolicy.service';
import { clearanceBlockers, mediumForCategory, progressOf, reclaimProblems } from '../services/offboarding.service';
import { reviewsDue } from '../services/accessCadence.service';
import {
  assertShareable, classifyIndicator, isPrivateAddress, matchAssetsToProducts, parseCisaKev, parseCsvIocs, parseIocText, parseStixBundle, refang, sanitiseText, stixId, toStixBundle,
} from '../services/threatIntel.service';

const policy = mergePolicy(null);

describe('asset classification', () => {
  it('labels credentials as Restricted and published material as Public', () => {
    expect(suggestClassification(policy, { title: 'Production database password', description: '' }).classification).toBe('Restricted');
    expect(suggestClassification(policy, { title: 'Company brochure', description: 'published on our website' }).classification).toBe('Public');
  });
  it('falls back to the default when nothing matches', () => {
    const s = suggestClassification(policy, { title: 'Chairs', description: 'blue' });
    expect(s.usedDefault).toBe(true);
  });
  it('rejects blocked names and accepts a proper one', () => {
    expect(checkNaming(policy, { title: 'test' }).length).toBeGreaterThan(0);
    expect(checkNaming(policy, { title: 'my laptop' }).length).toBeGreaterThan(0);
    expect(checkNaming(policy, { title: 'Finance team HP EliteBook 840', description: 'Issued to finance' })).toEqual([]);
  });
  it('blocks a label below the minimum unless overridden with a reason', () => {
    const asset = { title: 'Customer database backup', description: 'contains customer personal data' };
    const sug = suggestClassification(policy, asset).classification;
    expect(['Confidential', 'Restricted']).toContain(sug);
    const blocked = decideClassification(policy, { chosen: 'Public' }, asset);
    expect(blocked.blocked).toBeTruthy();
    const ok = decideClassification(policy, { chosen: 'Public', overrideReason: 'Approved by ISMS manager', canOverride: true }, asset);
    expect(ok.blocked).toBeUndefined(); expect(ok.source).toBe('override');
    expect(decideClassification(policy, {}, asset).source).toBe('auto');
  });
  it('has sane defaults', () => { expect(DEFAULT_ASSET_POLICY.blockedNames.length).toBeGreaterThan(3); });
});

describe('return of asset', () => {
  it('requires condition, and a verified wipe for devices', () => {
    const dev = { kind: 'asset', requiresWipe: true, medium: 'physical' };
    expect(reclaimProblems(dev, {}).length).toBe(2);
    expect(reclaimProblems(dev, { condition: 'good', dataWipeVerified: true }).join()).toMatch(/how the data/);
    expect(reclaimProblems(dev, { condition: 'good', dataWipeVerified: true, wipeMethod: 'DBAN', accessoriesComplete: true })).toEqual([]);
    expect(reclaimProblems(dev, { condition: 'damaged', dataWipeVerified: true, wipeMethod: 'x' }).join()).toMatch(/damage/);
  });
  it('knows which categories need wiping', () => {
    expect(mediumForCategory('hardware')).toEqual({ medium: 'physical', requiresWipe: true });
    expect(mediumForCategory('software').requiresWipe).toBe(false);
  });
  it('computes progress and blockers', () => {
    const c: any = { lastWorkingDay: new Date(Date.now() - 3 * 86400000), items: [{ kind: 'asset', label: 'Laptop', status: 'submitted' }, { kind: 'task', label: 'T', status: 'transferred' }] };
    expect(progressOf(c).awaitingApproval).toBe(1); expect(progressOf(c).overdue).toBe(1);
    expect(clearanceBlockers(c).length).toBe(2); // item + missing inventory
    c.items[0].status = 'reclaimed'; c.inventory = { declaredAt: new Date() };
    expect(clearanceBlockers(c)).toEqual([]);
  });
});

describe('threat intelligence', () => {
  it('refangs and classifies indicators', () => {
    expect(refang('hxxps://evil[.]example[.]com/a')).toBe('https://evil.example.com/a');
    expect(classifyIndicator('1.2.3.4')).toEqual({ type: 'ipv4', value: '1.2.3.4' });
    expect(classifyIndicator('999.1.1.1')).toBeNull();
    expect(classifyIndicator('Evil[.]COM')).toEqual({ type: 'domain', value: 'evil.com' });
    expect(classifyIndicator('cve-2024-3094')!.type).toBe('cve');
    expect(classifyIndicator('d41d8cd98f00b204e9800998ecf8427e')!.type).toBe('md5');
    expect(classifyIndicator('bad@evil.com')!.type).toBe('email');
    expect(classifyIndicator('not an ioc')).toBeNull();
  });
  it('parses free text and CSV with de-duplication', () => {
    const p = parseIocText('1.1.1.1, 1.1.1.1\nevil[.]com garbage#');
    expect(p.indicators.length).toBe(2); expect(p.rejected).toContain('garbage#');
    const c = parseCsvIocs('value,confidence,tlp\n8.8.8.8,90,white\nbad.org,x,amber');
    expect(c.indicators[0].confidence).toBe(90); expect(c.indicators[0].tlp).toBe('CLEAR'); expect(c.indicators[1].tlp).toBe('AMBER');
  });
  it('round-trips STIX', () => {
    const intel = { _id: 'abc', reference: 'TI-1', title: 'Campaign at Global SJX', summary: 'mail admin@gsjx.com 10.0.0.5', tlp: 'GREEN', layer: 'tactical', severity: 'high', confidence: 'high', cves: ['CVE-2024-3094'], ttps: ['T1566.001'] };
    const b: any = toStixBundle(intel, [{ type: 'ipv4', value: '1.2.3.4' }, { type: 'domain', value: 'evil.com' }, { type: 'sha256', value: 'a'.repeat(64) }]);
    expect(b.objects.some((o: any) => o.type === 'indicator' && o.pattern === "[ipv4-addr:value = '1.2.3.4']")).toBe(true);
    const back = parseStixBundle(b);
    expect(back.indicators.map((i) => i.value).sort()).toEqual(['1.2.3.4', 'a'.repeat(64), 'evil.com']);
    expect(back.cves).toEqual(['CVE-2024-3094']); expect(back.ttps).toEqual(['T1566.001']);
    expect(stixId('indicator', 'x')).toBe(stixId('indicator', 'x'));
    const anon = JSON.stringify(toStixBundle(intel, [], { anonymise: true }));
    expect(anon).not.toMatch(/Global SJX|admin@gsjx|10\.0\.0\.5/);
    expect(sanitiseText('see 192.168.1.4')).toContain('[internal IP removed]');
  });
  it('parses the CISA KEV catalogue', () => {
    const r = parseCisaKev({ vulnerabilities: [{ cveID: 'CVE-2024-1111', vendorProject: 'Acme', product: 'Widget', vulnerabilityName: 'RCE', shortDescription: 'bad', dateAdded: '2026-10-01', requiredAction: 'Patch', knownRansomwareCampaignUse: 'Known' }, { cveID: 'junk' }] });
    expect(r.length).toBe(1); expect(r[0].severity).toBe('critical'); expect(r[0].affectedProducts).toEqual(['Acme', 'Widget']);
  });
  it('enforces TLP before sharing', () => {
    const base: any = { tlp: 'GREEN', analysis: 'It matters', status: 'analysed' };
    expect(() => assertShareable({ ...base, tlp: 'RED' }, { method: 'email', recipient: 'x' })).toThrow(/RED/);
    expect(() => assertShareable({ ...base, analysis: '' }, { method: 'email', recipient: 'x' })).toThrow(/Analyse/);
    expect(() => assertShareable({ ...base, tlp: 'AMBER' }, { method: 'email' })).toThrow(/named/);
    expect(() => assertShareable({ ...base, tlp: 'AMBER' }, { method: 'platform', recipient: 'x', anonymise: true })).toThrow(/AMBER/);
    expect(() => assertShareable(base, { method: 'platform', recipient: 'ISAC' })).toThrow(/Anonymise/);
    expect(() => assertShareable(base, { method: 'platform', recipient: 'ISAC', anonymise: true })).not.toThrow();
  });
  it('matches assets to affected products without generic words', () => {
    const assets = [{ _id: 1, title: 'Fortinet FortiGate 60F', vendor: 'Fortinet' }, { _id: 2, title: 'Dell laptop', vendor: 'Microsoft Windows' }];
    expect(matchAssetsToProducts(assets, ['Fortinet']).map((m) => m.id)).toEqual([1]);
    expect(matchAssetsToProducts(assets, ['Windows', 'Microsoft'])).toEqual([]);
  });
  it('blocks private addresses (SSRF)', () => {
    for (const a of ['127.0.0.1', '10.1.1.1', '192.168.0.9', '172.20.0.1', '169.254.169.254', '::1']) expect(isPrivateAddress(a)).toBe(true);
    expect(isPrivateAddress('8.8.8.8')).toBe(false);
  });
});

describe('access review cadence (POL-5016)', () => {
  const now = new Date('2026-10-30T00:00:00Z');
  const ago = (d: number) => new Date(now.getTime() - d * 86400000);
  it('is overdue when there has never been a review', () => { expect(reviewsDue(null, now)).toMatchObject({ privileged: 'overdue', user: 'overdue' }); });
  it('privileged access is due at 3 months, user access at 6', () => {
    expect(reviewsDue(ago(30), now)).toMatchObject({ privileged: 'ok', user: 'ok' });
    expect(reviewsDue(ago(80), now)).toMatchObject({ privileged: 'soon', user: 'ok' });
    expect(reviewsDue(ago(100), now)).toMatchObject({ privileged: 'overdue', user: 'ok' });
    expect(reviewsDue(ago(175), now)).toMatchObject({ privileged: 'overdue', user: 'soon' });
    expect(reviewsDue(ago(200), now)).toMatchObject({ privileged: 'overdue', user: 'overdue' });
  });
});

import { canClose, canMove, escalationLevel, normaliseStatus, transitionProblems } from '../config/taskStatus';
import { decideDelivery } from '../services/notify.service';
import { deviceLabel } from '../utils/requestContext';
import { stampLine } from '../utils/stampPlugin';

describe('task status rules', () => {
  it('maps the old statuses', () => {
    expect(normaliseStatus('todo')).toBe('open'); expect(normaliseStatus('blocked')).toBe('on_hold'); expect(normaliseStatus('done')).toBe('complete'); expect(normaliseStatus('awaiting_approval')).toBe('to_be_reviewed');
  });
  it('every change needs a comment', () => {
    expect(transitionProblems({ from: 'open', to: 'in_progress', comment: '' }).length).toBe(1);
    expect(transitionProblems({ from: 'open', to: 'in_progress', comment: 'Starting now' })).toEqual([]);
  });
  it('hold needs a reason, delayed needs a new date', () => {
    expect(transitionProblems({ from: 'in_progress', to: 'on_hold', comment: 'waiting' }).join()).toMatch(/waiting for/i);
    expect(transitionProblems({ from: 'in_progress', to: 'on_hold', comment: 'waiting', hasHoldReason: true })).toEqual([]);
    expect(transitionProblems({ from: 'in_progress', to: 'delayed', comment: 'late supplier' }).join()).toMatch(/new expected date/i);
  });
  it('cancelled / abandoned need a real explanation or evidence', () => {
    expect(transitionProblems({ from: 'open', to: 'abandoned', comment: 'no' }).length).toBeGreaterThan(0);
    expect(transitionProblems({ from: 'open', to: 'abandoned', comment: 'Out of context: client dropped the scope' })).toEqual([]);
    expect(transitionProblems({ from: 'open', to: 'cancelled', comment: 'dup', evidenceCount: 1 })).toEqual([]);
  });
  it('100% cannot be set while in progress; only valid moves are allowed', () => {
    expect(transitionProblems({ from: 'open', to: 'in_progress', comment: 'go', percent: 100 }).join()).toMatch(/review/);
    expect(canMove('open', 'closed')).toBe(false); expect(canMove('to_be_reviewed', 'complete')).toBe(true); expect(canMove('complete', 'closed')).toBe(true);
  });
  it('only the project owner closes', () => {
    expect(canClose({ userId: 'a', projectManagerId: 'a', hasProject: true, role: 'project_manager' })).toBe(true);
    expect(canClose({ userId: 'b', projectManagerId: 'a', hasProject: true, role: 'coo' })).toBe(false);
    expect(canClose({ userId: 'b', creatorId: 'b', hasProject: false, role: 'employee' })).toBe(true);
    expect(canClose({ userId: 'z', projectManagerId: 'a', hasProject: true, role: 'ceo' })).toBe(true);
  });
  it('escalation climbs with age', () => {
    expect([0, 1, 2, 3, 6, 7, 20].map(escalationLevel)).toEqual([0, 1, 1, 2, 2, 3, 3]);
  });
});

describe('notification preferences', () => {
  it('respects switched-off categories but never hides urgent or mandatory', () => {
    const pref = { categories: { comments: { inApp: false, email: false } }, mutes: [{ entityType: 'task', entityId: 'abc' }] };
    expect(decideDelivery(pref, { category: 'comments', wantsEmail: true })).toEqual({ inApp: false, email: false });
    expect(decideDelivery(pref, { category: 'comments', severity: 'high', wantsEmail: false }).inApp).toBe(true);
    expect(decideDelivery(pref, { category: 'tasks', entity: { type: 'task', id: 'abc' }, wantsEmail: true })).toEqual({ inApp: false, email: false });
    expect(decideDelivery(pref, { category: 'security', wantsEmail: false }).inApp).toBe(true);
    expect(decideDelivery(null, { category: 'tasks', wantsEmail: true })).toEqual({ inApp: true, email: true });
  });
});

describe('audit stamp', () => {
  it('labels devices and prints who / when / from where', () => {
    expect(deviceLabel('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120 Safari/537')).toBe('Chrome on macOS');
    const line = stampLine({ updatedBy: { name: 'Sina' }, updatedAt: new Date('2026-11-02T15:43:00Z'), updatedFrom: { ip: '1.2.3.4', device: 'Chrome on macOS' } });
    expect(line).toBe('Updated by Sina · 2026-11-02 15:43 · Chrome on macOS (1.2.3.4)');
  });
});

import { periodRange } from '../services/workReports.service';
describe('my report periods', () => {
  const now = new Date('2026-11-04T15:30:00Z');
  it('picks the right window', () => {
    expect(periodRange('daily', now).from.toISOString()).toBe('2026-11-04T00:00:00.000Z');
    expect(periodRange('weekly', now).from.toISOString()).toBe('2026-10-29T00:00:00.000Z');
    expect(periodRange('monthly', now).from.toISOString()).toBe('2026-11-01T00:00:00.000Z');
    expect(periodRange('quarterly', now).from.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    const c = periodRange('custom', now, '2026-09-15');
    expect(c.from.toISOString().slice(0, 10)).toBe('2026-09-15'); expect(c.to.getTime()).toBe(now.getTime());
  });
  it('rejects bad custom ranges', () => {
    expect(() => periodRange('custom', now, 'nonsense')).toThrow(/date/i);
    expect(() => periodRange('custom', now, '2026-11-10', '2026-11-01')).toThrow(/before/i);
  });
});

import { projectStatusProblems } from '../config/projectStatus';
import { stageProblems } from '../config/pipeline';
import { buildInsights } from '../services/opportunityInsights.service';

describe('project statuses', () => {
  it('needs a comment and only the owner can end a project', () => {
    expect(projectStatusProblems({ from: 'planning', to: 'execution', comment: '', isOwner: false, openTasks: 0 }).length).toBe(1);
    expect(projectStatusProblems({ from: 'planning', to: 'execution', comment: 'Kick-off done', isOwner: false, openTasks: 3 })).toEqual([]);
    expect(projectStatusProblems({ from: 'monitoring', to: 'closure', comment: 'All delivered', isOwner: false, openTasks: 0 })[0]).toMatch(/project owner/);
    expect(projectStatusProblems({ from: 'monitoring', to: 'closure', comment: 'All delivered', isOwner: true, openTasks: 2 })[0]).toMatch(/still open/);
    expect(projectStatusProblems({ from: 'monitoring', to: 'closure', comment: 'Closing with the rest moved', isOwner: true, openTasks: 2, force: true })).toEqual([]);
  });
});

describe('pipeline stage rules', () => {
  const base = { from: 'Negotiation', documentCount: 0, hasClientOrProspect: true, value: 5000000 };
  it('needs a comment for every move', () => { expect(stageProblems({ ...base, to: 'Documentation', comment: '' })[0]).toMatch(/comment/); expect(stageProblems({ ...base, to: 'Documentation', comment: 'Terms agreed' })).toEqual([]); });
  it('lost needs a reason; won needs signed documents', () => {
    expect(stageProblems({ ...base, to: 'Closed Lost', comment: 'They went quiet' }).join()).toMatch(/why it was lost/);
    expect(stageProblems({ ...base, to: 'Closed Won', comment: 'Signed' }).join()).toMatch(/signed documentation/);
    expect(stageProblems({ ...base, to: 'Closed Won', comment: 'Signed', documentCount: 1 })).toEqual([]);
    expect(stageProblems({ ...base, to: 'Closed Won', comment: 'Verbal yes, paperwork follows', skipDocuments: true, canSkip: true })).toEqual([]);
    expect(stageProblems({ ...base, to: 'Closed Won', comment: 'Signed', documentCount: 1, value: 0 }).join()).toMatch(/value/);
  });
});

describe('opportunity insights', () => {
  const now = new Date('2026-11-10T00:00:00Z');
  const d = (n: number) => new Date(now.getTime() - n * 86400000);
  const opp = (o: any) => ({ _id: Math.random().toString(16).slice(2, 10), title: 'Deal', value: 1000000, probability: 50, createdAt: d(60), contacts: [{ name: 'A' }], nextAction: 'Call', salespersonId: 'u1', ...o });
  it('computes win rate, funnel and flags stalled deals', () => {
    const list = [
      opp({ title: 'W1', stage: 'Closed Won', closedAt: d(10), stageHistory: [{ stage: 'Lead', changedAt: d(60) }, { stage: 'Proposal', from: 'Lead', changedAt: d(40) }, { stage: 'Closed Won', from: 'Documentation', changedAt: d(10) }], winReason: 'Trusted team' }),
      opp({ title: 'L1', stage: 'Closed Lost', lostReason: 'Price', closedAt: d(20), stageHistory: [{ stage: 'Lead', changedAt: d(50) }, { stage: 'Proposal', from: 'Lead', changedAt: d(35) }] }),
      opp({ title: 'L2', stage: 'Closed Lost', lostReason: 'Price', closedAt: d(15), stageHistory: [{ stage: 'Lead', changedAt: d(50) }] }),
      opp({ title: 'Old', stage: 'Negotiation', value: 9000000, stageHistory: [{ stage: 'Negotiation', changedAt: d(30) }], nextAction: '' }),
    ];
    const r = buildInsights(list as any, { u1: 'Amaka' }, now);
    expect(r.overview).toMatchObject({ won: 1, lost: 2, open: 1, winRate: 33 });
    expect(r.stalled[0].title).toBe('Old');
    expect(r.lostReasons[0]).toEqual({ reason: 'Price', count: 2 });
    expect(r.insights.some((i) => i.area === 'convert' && /has not moved/.test(i.text))).toBe(true);
    expect(r.insights.some((i) => i.area === 'improve' && /no next action/.test(i.text))).toBe(true);
    expect(r.insights.some((i) => i.area === 'happened' && /33%/.test(i.text))).toBe(true);
    expect(r.bySalesperson[0].name).toBe('Amaka');
  });
  it('handles an empty pipeline', () => { expect(buildInsights([], {}, now).insights[0].text).toMatch(/0 open/); });
});

/* ------------------------------------------------------------------ Phase 6: marketing */
import { composeText, contentHash, channelProblems, submitProblems, decisionProblems, postingProblems, goalProgress, campaignInsights } from '../config/marketing';
import { facebook } from '../services/social/facebook';
import { instagram } from '../services/social/instagram';
import { linkedin } from '../services/social/linkedin';
import { signedMediaUrl, verifyMediaSignature } from '../services/social/publicMedia';

describe('marketing approval rules', () => {
  const ok = { name: 'Hiring push', goal: { kind: 'hiring', target: 5 }, channels: ['linkedin'], content: { body: 'We are hiring engineers.' }, media: [] as any[] };
  it('accepts a complete campaign and names every gap otherwise', () => {
    expect(submitProblems(ok)).toEqual([]);
    expect(submitProblems({ ...ok, goal: { kind: 'traffic', target: 0 } })[0]).toMatch(/target/i);
    expect(submitProblems({ ...ok, channels: [] })[0]).toMatch(/channel/i);
    expect(submitProblems({ ...ok, content: {} })[0]).toMatch(/write the post/i);
    expect(submitProblems({ ...ok, goal: { kind: 'awareness', target: 0 } })).toEqual([]);
  });
  it('checks each channel: length, pictures, hashtags, link', () => {
    expect(channelProblems({ body: 'x'.repeat(300) }, [], 'x')[0]).toMatch(/280/);
    expect(channelProblems({ body: 'hi' }, [], 'instagram')[0]).toMatch(/image/i);
    expect(channelProblems({ body: 'hi', linkUrl: 'nope' }, [{ url: 'a' }], 'facebook')[0]).toMatch(/http/);
    expect(channelProblems({ body: 'hi' }, [{ url: 'a' }], 'instagram')).toEqual([]);
  });
  it('approval needs evidence and a second person', () => {
    const base = { decision: 'approve' as const, note: 'Checked copy and banner', evidenceCount: 1, isSubmitter: false, isTopLeader: false, status: 'pending' };
    expect(decisionProblems(base)).toEqual([]);
    expect(decisionProblems({ ...base, evidenceCount: 0 })[0]).toMatch(/evidence/i);
    expect(decisionProblems({ ...base, isSubmitter: true })[0]).toMatch(/cannot approve/i);
    expect(decisionProblems({ ...base, isSubmitter: true, isTopLeader: true })).toEqual([]);
    expect(decisionProblems({ ...base, decision: 'reject', evidenceCount: 0 })).toEqual([]);
    expect(decisionProblems({ ...base, note: '' })[0]).toMatch(/comment/i);
    expect(decisionProblems({ ...base, status: 'draft' })[0]).toMatch(/not waiting/i);
  });
  it('approval is bound to the exact content', () => {
    const a = { content: { body: 'Hello' }, media: [{ url: '/api/uploads/o/a.png' }], channels: ['facebook', 'linkedin'] };
    const h = contentHash(a);
    expect(contentHash({ ...a, channels: ['linkedin', 'facebook'] })).toBe(h);
    expect(contentHash({ ...a, content: { body: 'Hello!' } })).not.toBe(h);
    expect(contentHash({ ...a, media: [] })).not.toBe(h);
    expect(postingProblems({ approval: { status: 'approved', contentHash: h } }, h)).toEqual([]);
    expect(postingProblems({ approval: { status: 'approved', contentHash: h } }, 'other')[0]).toMatch(/changed/i);
    expect(postingProblems({ approval: { status: 'pending', contentHash: h } }, h)[0]).toMatch(/approved/i);
    expect(postingProblems({ approval: { status: 'approved', contentHash: h }, status: 'cancelled' }, h)[0]).toMatch(/cancelled/i);
  });
  it('composes text with a link and tidy hashtags, and tracks goal progress', () => {
    expect(composeText({ headline: 'H', body: 'B', callToAction: 'Apply', linkUrl: 'https://x.co', hashtags: ['#jobs', 'tech'] })).toBe('H\n\nB\n\nApply\n\nhttps://x.co\n\n#jobs #tech');
    expect(goalProgress({ kind: 'hiring', target: 4 }, { hires: 3 })).toEqual({ current: 3, target: 4, percent: 75 });
    expect(goalProgress({ kind: 'monetary', target: 1000 }, { revenue: 1500 }).percent).toBe(150);
    expect(campaignInsights({ approval: { status: 'draft' } })[0]).toMatch(/not approved/i);
  });
});

describe('social adapters (HTTP mocked)', () => {
  const mk = (replies: any[]) => {
    const calls: any[] = [];
    const http = async (url: string, init: any) => { calls.push({ url, init }); const r = replies.shift(); return { ok: r.ok !== false, status: r.status || 200, json: async () => r.body, text: async () => JSON.stringify(r.body) }; };
    return { http, calls };
  };
  it('facebook: text post, single photo, several photos', async () => {
    let m = mk([{ body: { id: '1_2' } }]);
    expect((await facebook.publish({ externalId: 'P', token: 'TKN', text: 'hi', link: 'https://x.co', imageUrls: [] }, m.http as any)).externalId).toBe('1_2');
    expect(m.calls[0].url).toMatch(/\/P\/feed$/); expect(m.calls[0].init.body).toMatch(/message=hi/);
    m = mk([{ body: { id: 'ph', post_id: 'P_9' } }]);
    expect((await facebook.publish({ externalId: 'P', token: 'TKN', text: 'cap', imageUrls: ['https://i/1.png'] }, m.http as any)).externalId).toBe('P_9');
    expect(m.calls[0].url).toMatch(/\/P\/photos$/);
    m = mk([{ body: { id: 'a' } }, { body: { id: 'b' } }, { body: { id: 'post' } }]);
    await facebook.publish({ externalId: 'P', token: 'TKN', text: 'cap', imageUrls: ['https://i/1.png', 'https://i/2.png'] }, m.http as any);
    expect(m.calls[2].init.body).toMatch(/attached_media%5B1%5D/);
  });
  it('instagram: needs a picture, publishes in two steps', async () => {
    expect(instagram.cannotPublish({ externalId: 'IG', text: 't', imageUrls: [] })).toMatch(/image/i);
    const m = mk([{ body: { id: 'c1' } }, { body: { id: 'm1' } }]);
    expect((await instagram.publish({ externalId: 'IG', token: 'TKN', text: 't', imageUrls: ['https://i/1.png'] }, m.http as any)).externalId).toBe('m1');
    expect(m.calls[1].url).toMatch(/media_publish$/);
  });
  it('linkedin: text with link, pictures are refused so they go to a person', async () => {
    expect(linkedin.cannotPublish({ externalId: '123', text: 't', imageUrls: ['u'] })).toMatch(/by hand/);
    const m = mk([{ body: { id: 'urn:li:share:1' } }]);
    await linkedin.publish({ externalId: '123', token: 'TKN', text: 'We are hiring', link: 'https://x.co', imageUrls: [] }, m.http as any);
    const body = JSON.parse(m.calls[0].init.body);
    expect(body.author).toBe('urn:li:organization:123'); expect(m.calls[0].init.headers['X-Restli-Protocol-Version']).toBe('2.0.0');
  });
  it('platform errors never leak the access token', async () => {
    const m = mk([{ ok: false, status: 401, body: { error: { message: 'Invalid OAuth access token TKN-SECRET-123' } } }]);
    await expect(facebook.publish({ externalId: 'P', token: 'TKN-SECRET-123', text: 'x', imageUrls: [] }, m.http as any)).rejects.toThrow(/refused/);
    const m2 = mk([{ ok: false, status: 401, body: { error: { message: 'Invalid OAuth access token TKN-SECRET-123' } } }]);
    try { await facebook.publish({ externalId: 'P', token: 'TKN-SECRET-123', text: 'x', imageUrls: [] }, m2.http as any); } catch (e: any) { expect(e.message).not.toContain('TKN-SECRET-123'); expect(e.status).toBe(401); }
  });
  it('picture links are signed, short-lived and image-only', () => {
    const org = 'a'.repeat(24);
    const url = signedMediaUrl(`/api/uploads/${org}/pic.png`, 60, 1_000_000)!;
    const q = new URL(url).searchParams; const exp = Number(q.get('exp')); const sig = q.get('sig')!;
    expect(verifyMediaSignature(org, 'pic.png', exp, sig, 1_000_000)).toBe(true);
    expect(verifyMediaSignature(org, 'other.png', exp, sig, 1_000_000)).toBe(false);
    expect(verifyMediaSignature(org, 'pic.png', exp, sig, 1_000_000 + 120_000)).toBe(false);
    expect(signedMediaUrl(`/api/uploads/${org}/contract.pdf`)).toBeNull();
  });
});
import { DEFAULT_ASSET_POLICY } from '../models/AssetPolicy';
import { checkNaming, decideClassification, mergePolicy, suggestClassification } from '../services/assetPolicy.service';
import { clearanceBlockers, mediumForCategory, progressOf, reclaimProblems } from '../services/offboarding.service';
import { reviewsDue } from '../services/accessCadence.service';
import {
  assertShareable, classifyIndicator, isPrivateAddress, matchAssetsToProducts, parseCisaKev, parseCsvIocs, parseIocText, parseStixBundle, refang, sanitiseText, stixId, toStixBundle,
} from '../services/threatIntel.service';

const policy = mergePolicy(null);

describe('asset classification', () => {
  it('labels credentials as Restricted and published material as Public', () => {
    expect(suggestClassification(policy, { title: 'Production database password', description: '' }).classification).toBe('Restricted');
    expect(suggestClassification(policy, { title: 'Company brochure', description: 'published on our website' }).classification).toBe('Public');
  });
  it('falls back to the default when nothing matches', () => {
    const s = suggestClassification(policy, { title: 'Chairs', description: 'blue' });
    expect(s.usedDefault).toBe(true);
  });
  it('rejects blocked names and accepts a proper one', () => {
    expect(checkNaming(policy, { title: 'test' }).length).toBeGreaterThan(0);
    expect(checkNaming(policy, { title: 'my laptop' }).length).toBeGreaterThan(0);
    expect(checkNaming(policy, { title: 'Finance team HP EliteBook 840', description: 'Issued to finance' })).toEqual([]);
  });
  it('blocks a label below the minimum unless overridden with a reason', () => {
    const asset = { title: 'Customer database backup', description: 'contains customer personal data' };
    const sug = suggestClassification(policy, asset).classification;
    expect(['Confidential', 'Restricted']).toContain(sug);
    const blocked = decideClassification(policy, { chosen: 'Public' }, asset);
    expect(blocked.blocked).toBeTruthy();
    const ok = decideClassification(policy, { chosen: 'Public', overrideReason: 'Approved by ISMS manager', canOverride: true }, asset);
    expect(ok.blocked).toBeUndefined(); expect(ok.source).toBe('override');
    expect(decideClassification(policy, {}, asset).source).toBe('auto');
  });
  it('has sane defaults', () => { expect(DEFAULT_ASSET_POLICY.blockedNames.length).toBeGreaterThan(3); });
});

describe('return of asset', () => {
  it('requires condition, and a verified wipe for devices', () => {
    const dev = { kind: 'asset', requiresWipe: true, medium: 'physical' };
    expect(reclaimProblems(dev, {}).length).toBe(2);
    expect(reclaimProblems(dev, { condition: 'good', dataWipeVerified: true }).join()).toMatch(/how the data/);
    expect(reclaimProblems(dev, { condition: 'good', dataWipeVerified: true, wipeMethod: 'DBAN', accessoriesComplete: true })).toEqual([]);
    expect(reclaimProblems(dev, { condition: 'damaged', dataWipeVerified: true, wipeMethod: 'x' }).join()).toMatch(/damage/);
  });
  it('knows which categories need wiping', () => {
    expect(mediumForCategory('hardware')).toEqual({ medium: 'physical', requiresWipe: true });
    expect(mediumForCategory('software').requiresWipe).toBe(false);
  });
  it('computes progress and blockers', () => {
    const c: any = { lastWorkingDay: new Date(Date.now() - 3 * 86400000), items: [{ kind: 'asset', label: 'Laptop', status: 'submitted' }, { kind: 'task', label: 'T', status: 'transferred' }] };
    expect(progressOf(c).awaitingApproval).toBe(1); expect(progressOf(c).overdue).toBe(1);
    expect(clearanceBlockers(c).length).toBe(2); // item + missing inventory
    c.items[0].status = 'reclaimed'; c.inventory = { declaredAt: new Date() };
    expect(clearanceBlockers(c)).toEqual([]);
  });
});

describe('threat intelligence', () => {
  it('refangs and classifies indicators', () => {
    expect(refang('hxxps://evil[.]example[.]com/a')).toBe('https://evil.example.com/a');
    expect(classifyIndicator('1.2.3.4')).toEqual({ type: 'ipv4', value: '1.2.3.4' });
    expect(classifyIndicator('999.1.1.1')).toBeNull();
    expect(classifyIndicator('Evil[.]COM')).toEqual({ type: 'domain', value: 'evil.com' });
    expect(classifyIndicator('cve-2024-3094')!.type).toBe('cve');
    expect(classifyIndicator('d41d8cd98f00b204e9800998ecf8427e')!.type).toBe('md5');
    expect(classifyIndicator('bad@evil.com')!.type).toBe('email');
    expect(classifyIndicator('not an ioc')).toBeNull();
  });
  it('parses free text and CSV with de-duplication', () => {
    const p = parseIocText('1.1.1.1, 1.1.1.1\nevil[.]com garbage#');
    expect(p.indicators.length).toBe(2); expect(p.rejected).toContain('garbage#');
    const c = parseCsvIocs('value,confidence,tlp\n8.8.8.8,90,white\nbad.org,x,amber');
    expect(c.indicators[0].confidence).toBe(90); expect(c.indicators[0].tlp).toBe('CLEAR'); expect(c.indicators[1].tlp).toBe('AMBER');
  });
  it('round-trips STIX', () => {
    const intel = { _id: 'abc', reference: 'TI-1', title: 'Campaign at Global SJX', summary: 'mail admin@gsjx.com 10.0.0.5', tlp: 'GREEN', layer: 'tactical', severity: 'high', confidence: 'high', cves: ['CVE-2024-3094'], ttps: ['T1566.001'] };
    const b: any = toStixBundle(intel, [{ type: 'ipv4', value: '1.2.3.4' }, { type: 'domain', value: 'evil.com' }, { type: 'sha256', value: 'a'.repeat(64) }]);
    expect(b.objects.some((o: any) => o.type === 'indicator' && o.pattern === "[ipv4-addr:value = '1.2.3.4']")).toBe(true);
    const back = parseStixBundle(b);
    expect(back.indicators.map((i) => i.value).sort()).toEqual(['1.2.3.4', 'a'.repeat(64), 'evil.com']);
    expect(back.cves).toEqual(['CVE-2024-3094']); expect(back.ttps).toEqual(['T1566.001']);
    expect(stixId('indicator', 'x')).toBe(stixId('indicator', 'x'));
    const anon = JSON.stringify(toStixBundle(intel, [], { anonymise: true }));
    expect(anon).not.toMatch(/Global SJX|admin@gsjx|10\.0\.0\.5/);
    expect(sanitiseText('see 192.168.1.4')).toContain('[internal IP removed]');
  });
  it('parses the CISA KEV catalogue', () => {
    const r = parseCisaKev({ vulnerabilities: [{ cveID: 'CVE-2024-1111', vendorProject: 'Acme', product: 'Widget', vulnerabilityName: 'RCE', shortDescription: 'bad', dateAdded: '2026-10-01', requiredAction: 'Patch', knownRansomwareCampaignUse: 'Known' }, { cveID: 'junk' }] });
    expect(r.length).toBe(1); expect(r[0].severity).toBe('critical'); expect(r[0].affectedProducts).toEqual(['Acme', 'Widget']);
  });
  it('enforces TLP before sharing', () => {
    const base: any = { tlp: 'GREEN', analysis: 'It matters', status: 'analysed' };
    expect(() => assertShareable({ ...base, tlp: 'RED' }, { method: 'email', recipient: 'x' })).toThrow(/RED/);
    expect(() => assertShareable({ ...base, analysis: '' }, { method: 'email', recipient: 'x' })).toThrow(/Analyse/);
    expect(() => assertShareable({ ...base, tlp: 'AMBER' }, { method: 'email' })).toThrow(/named/);
    expect(() => assertShareable({ ...base, tlp: 'AMBER' }, { method: 'platform', recipient: 'x', anonymise: true })).toThrow(/AMBER/);
    expect(() => assertShareable(base, { method: 'platform', recipient: 'ISAC' })).toThrow(/Anonymise/);
    expect(() => assertShareable(base, { method: 'platform', recipient: 'ISAC', anonymise: true })).not.toThrow();
  });
  it('matches assets to affected products without generic words', () => {
    const assets = [{ _id: 1, title: 'Fortinet FortiGate 60F', vendor: 'Fortinet' }, { _id: 2, title: 'Dell laptop', vendor: 'Microsoft Windows' }];
    expect(matchAssetsToProducts(assets, ['Fortinet']).map((m) => m.id)).toEqual([1]);
    expect(matchAssetsToProducts(assets, ['Windows', 'Microsoft'])).toEqual([]);
  });
  it('blocks private addresses (SSRF)', () => {
    for (const a of ['127.0.0.1', '10.1.1.1', '192.168.0.9', '172.20.0.1', '169.254.169.254', '::1']) expect(isPrivateAddress(a)).toBe(true);
    expect(isPrivateAddress('8.8.8.8')).toBe(false);
  });
});

describe('access review cadence (POL-5016)', () => {
  const now = new Date('2026-10-30T00:00:00Z');
  const ago = (d: number) => new Date(now.getTime() - d * 86400000);
  it('is overdue when there has never been a review', () => { expect(reviewsDue(null, now)).toMatchObject({ privileged: 'overdue', user: 'overdue' }); });
  it('privileged access is due at 3 months, user access at 6', () => {
    expect(reviewsDue(ago(30), now)).toMatchObject({ privileged: 'ok', user: 'ok' });
    expect(reviewsDue(ago(80), now)).toMatchObject({ privileged: 'soon', user: 'ok' });
    expect(reviewsDue(ago(100), now)).toMatchObject({ privileged: 'overdue', user: 'ok' });
    expect(reviewsDue(ago(175), now)).toMatchObject({ privileged: 'overdue', user: 'soon' });
    expect(reviewsDue(ago(200), now)).toMatchObject({ privileged: 'overdue', user: 'overdue' });
  });
});

import { canClose, canMove, escalationLevel, normaliseStatus, transitionProblems } from '../config/taskStatus';
import { decideDelivery } from '../services/notify.service';
import { deviceLabel } from '../utils/requestContext';
import { stampLine } from '../utils/stampPlugin';

describe('task status rules', () => {
  it('maps the old statuses', () => {
    expect(normaliseStatus('todo')).toBe('open'); expect(normaliseStatus('blocked')).toBe('on_hold'); expect(normaliseStatus('done')).toBe('complete'); expect(normaliseStatus('awaiting_approval')).toBe('to_be_reviewed');
  });
  it('every change needs a comment', () => {
    expect(transitionProblems({ from: 'open', to: 'in_progress', comment: '' }).length).toBe(1);
    expect(transitionProblems({ from: 'open', to: 'in_progress', comment: 'Starting now' })).toEqual([]);
  });
  it('hold needs a reason, delayed needs a new date', () => {
    expect(transitionProblems({ from: 'in_progress', to: 'on_hold', comment: 'waiting' }).join()).toMatch(/waiting for/i);
    expect(transitionProblems({ from: 'in_progress', to: 'on_hold', comment: 'waiting', hasHoldReason: true })).toEqual([]);
    expect(transitionProblems({ from: 'in_progress', to: 'delayed', comment: 'late supplier' }).join()).toMatch(/new expected date/i);
  });
  it('cancelled / abandoned need a real explanation or evidence', () => {
    expect(transitionProblems({ from: 'open', to: 'abandoned', comment: 'no' }).length).toBeGreaterThan(0);
    expect(transitionProblems({ from: 'open', to: 'abandoned', comment: 'Out of context: client dropped the scope' })).toEqual([]);
    expect(transitionProblems({ from: 'open', to: 'cancelled', comment: 'dup', evidenceCount: 1 })).toEqual([]);
  });
  it('100% cannot be set while in progress; only valid moves are allowed', () => {
    expect(transitionProblems({ from: 'open', to: 'in_progress', comment: 'go', percent: 100 }).join()).toMatch(/review/);
    expect(canMove('open', 'closed')).toBe(false); expect(canMove('to_be_reviewed', 'complete')).toBe(true); expect(canMove('complete', 'closed')).toBe(true);
  });
  it('only the project owner closes', () => {
    expect(canClose({ userId: 'a', projectManagerId: 'a', hasProject: true, role: 'project_manager' })).toBe(true);
    expect(canClose({ userId: 'b', projectManagerId: 'a', hasProject: true, role: 'coo' })).toBe(false);
    expect(canClose({ userId: 'b', creatorId: 'b', hasProject: false, role: 'employee' })).toBe(true);
    expect(canClose({ userId: 'z', projectManagerId: 'a', hasProject: true, role: 'ceo' })).toBe(true);
  });
  it('escalation climbs with age', () => {
    expect([0, 1, 2, 3, 6, 7, 20].map(escalationLevel)).toEqual([0, 1, 1, 2, 2, 3, 3]);
  });
});

describe('notification preferences', () => {
  it('respects switched-off categories but never hides urgent or mandatory', () => {
    const pref = { categories: { comments: { inApp: false, email: false } }, mutes: [{ entityType: 'task', entityId: 'abc' }] };
    expect(decideDelivery(pref, { category: 'comments', wantsEmail: true })).toEqual({ inApp: false, email: false });
    expect(decideDelivery(pref, { category: 'comments', severity: 'high', wantsEmail: false }).inApp).toBe(true);
    expect(decideDelivery(pref, { category: 'tasks', entity: { type: 'task', id: 'abc' }, wantsEmail: true })).toEqual({ inApp: false, email: false });
    expect(decideDelivery(pref, { category: 'security', wantsEmail: false }).inApp).toBe(true);
    expect(decideDelivery(null, { category: 'tasks', wantsEmail: true })).toEqual({ inApp: true, email: true });
  });
});

describe('audit stamp', () => {
  it('labels devices and prints who / when / from where', () => {
    expect(deviceLabel('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120 Safari/537')).toBe('Chrome on macOS');
    const line = stampLine({ updatedBy: { name: 'Sina' }, updatedAt: new Date('2026-11-02T15:43:00Z'), updatedFrom: { ip: '1.2.3.4', device: 'Chrome on macOS' } });
    expect(line).toBe('Updated by Sina · 2026-11-02 15:43 · Chrome on macOS (1.2.3.4)');
  });
});

import { periodRange } from '../services/workReports.service';
describe('my report periods', () => {
  const now = new Date('2026-11-04T15:30:00Z');
  it('picks the right window', () => {
    expect(periodRange('daily', now).from.toISOString()).toBe('2026-11-04T00:00:00.000Z');
    expect(periodRange('weekly', now).from.toISOString()).toBe('2026-10-29T00:00:00.000Z');
    expect(periodRange('monthly', now).from.toISOString()).toBe('2026-11-01T00:00:00.000Z');
    expect(periodRange('quarterly', now).from.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    const c = periodRange('custom', now, '2026-09-15');
    expect(c.from.toISOString().slice(0, 10)).toBe('2026-09-15'); expect(c.to.getTime()).toBe(now.getTime());
  });
  it('rejects bad custom ranges', () => {
    expect(() => periodRange('custom', now, 'nonsense')).toThrow(/date/i);
    expect(() => periodRange('custom', now, '2026-11-10', '2026-11-01')).toThrow(/before/i);
  });
});

import { projectStatusProblems } from '../config/projectStatus';
import { stageProblems } from '../config/pipeline';
import { buildInsights } from '../services/opportunityInsights.service';

describe('project statuses', () => {
  it('needs a comment and only the owner can end a project', () => {
    expect(projectStatusProblems({ from: 'planning', to: 'execution', comment: '', isOwner: false, openTasks: 0 }).length).toBe(1);
    expect(projectStatusProblems({ from: 'planning', to: 'execution', comment: 'Kick-off done', isOwner: false, openTasks: 3 })).toEqual([]);
    expect(projectStatusProblems({ from: 'monitoring', to: 'closure', comment: 'All delivered', isOwner: false, openTasks: 0 })[0]).toMatch(/project owner/);
    expect(projectStatusProblems({ from: 'monitoring', to: 'closure', comment: 'All delivered', isOwner: true, openTasks: 2 })[0]).toMatch(/still open/);
    expect(projectStatusProblems({ from: 'monitoring', to: 'closure', comment: 'Closing with the rest moved', isOwner: true, openTasks: 2, force: true })).toEqual([]);
  });
});

describe('pipeline stage rules', () => {
  const base = { from: 'Negotiation', documentCount: 0, hasClientOrProspect: true, value: 5000000 };
  it('needs a comment for every move', () => { expect(stageProblems({ ...base, to: 'Documentation', comment: '' })[0]).toMatch(/comment/); expect(stageProblems({ ...base, to: 'Documentation', comment: 'Terms agreed' })).toEqual([]); });
  it('lost needs a reason; won needs signed documents', () => {
    expect(stageProblems({ ...base, to: 'Closed Lost', comment: 'They went quiet' }).join()).toMatch(/why it was lost/);
    expect(stageProblems({ ...base, to: 'Closed Won', comment: 'Signed' }).join()).toMatch(/signed documentation/);
    expect(stageProblems({ ...base, to: 'Closed Won', comment: 'Signed', documentCount: 1 })).toEqual([]);
    expect(stageProblems({ ...base, to: 'Closed Won', comment: 'Verbal yes, paperwork follows', skipDocuments: true, canSkip: true })).toEqual([]);
    expect(stageProblems({ ...base, to: 'Closed Won', comment: 'Signed', documentCount: 1, value: 0 }).join()).toMatch(/value/);
  });
});

describe('opportunity insights', () => {
  const now = new Date('2026-11-10T00:00:00Z');
  const d = (n: number) => new Date(now.getTime() - n * 86400000);
  const opp = (o: any) => ({ _id: Math.random().toString(16).slice(2, 10), title: 'Deal', value: 1000000, probability: 50, createdAt: d(60), contacts: [{ name: 'A' }], nextAction: 'Call', salespersonId: 'u1', ...o });
  it('computes win rate, funnel and flags stalled deals', () => {
    const list = [
      opp({ title: 'W1', stage: 'Closed Won', closedAt: d(10), stageHistory: [{ stage: 'Lead', changedAt: d(60) }, { stage: 'Proposal', from: 'Lead', changedAt: d(40) }, { stage: 'Closed Won', from: 'Documentation', changedAt: d(10) }], winReason: 'Trusted team' }),
      opp({ title: 'L1', stage: 'Closed Lost', lostReason: 'Price', closedAt: d(20), stageHistory: [{ stage: 'Lead', changedAt: d(50) }, { stage: 'Proposal', from: 'Lead', changedAt: d(35) }] }),
      opp({ title: 'L2', stage: 'Closed Lost', lostReason: 'Price', closedAt: d(15), stageHistory: [{ stage: 'Lead', changedAt: d(50) }] }),
      opp({ title: 'Old', stage: 'Negotiation', value: 9000000, stageHistory: [{ stage: 'Negotiation', changedAt: d(30) }], nextAction: '' }),
    ];
    const r = buildInsights(list as any, { u1: 'Amaka' }, now);
    expect(r.overview).toMatchObject({ won: 1, lost: 2, open: 1, winRate: 33 });
    expect(r.stalled[0].title).toBe('Old');
    expect(r.lostReasons[0]).toEqual({ reason: 'Price', count: 2 });
    expect(r.insights.some((i) => i.area === 'convert' && /has not moved/.test(i.text))).toBe(true);
    expect(r.insights.some((i) => i.area === 'improve' && /no next action/.test(i.text))).toBe(true);
    expect(r.insights.some((i) => i.area === 'happened' && /33%/.test(i.text))).toBe(true);
    expect(r.bySalesperson[0].name).toBe('Amaka');
  });
  it('handles an empty pipeline', () => { expect(buildInsights([], {}, now).insights[0].text).toMatch(/0 open/); });
});

/* ------------------------------------------------------------------ Phase 6: marketing */
import { composeText, contentHash, channelProblems, submitProblems, decisionProblems, postingProblems, goalProgress, campaignInsights } from '../config/marketing';
import { facebook } from '../services/social/facebook';
import { instagram } from '../services/social/instagram';
import { linkedin } from '../services/social/linkedin';
import { signedMediaUrl, verifyMediaSignature } from '../services/social/publicMedia';

describe('marketing approval rules', () => {
  const ok = { name: 'Hiring push', goal: { kind: 'hiring', target: 5 }, channels: ['linkedin'], content: { body: 'We are hiring engineers.' }, media: [] as any[] };
  it('accepts a complete campaign and names every gap otherwise', () => {
    expect(submitProblems(ok)).toEqual([]);
    expect(submitProblems({ ...ok, goal: { kind: 'traffic', target: 0 } })[0]).toMatch(/target/i);
    expect(submitProblems({ ...ok, channels: [] })[0]).toMatch(/channel/i);
    expect(submitProblems({ ...ok, content: {} })[0]).toMatch(/write the post/i);
    expect(submitProblems({ ...ok, goal: { kind: 'awareness', target: 0 } })).toEqual([]);
  });
  it('checks each channel: length, pictures, hashtags, link', () => {
    expect(channelProblems({ body: 'x'.repeat(300) }, [], 'x')[0]).toMatch(/280/);
    expect(channelProblems({ body: 'hi' }, [], 'instagram')[0]).toMatch(/image/i);
    expect(channelProblems({ body: 'hi', linkUrl: 'nope' }, [{ url: 'a' }], 'facebook')[0]).toMatch(/http/);
    expect(channelProblems({ body: 'hi' }, [{ url: 'a' }], 'instagram')).toEqual([]);
  });
  it('approval needs evidence and a second person', () => {
    const base = { decision: 'approve' as const, note: 'Checked copy and banner', evidenceCount: 1, isSubmitter: false, isTopLeader: false, status: 'pending' };
    expect(decisionProblems(base)).toEqual([]);
    expect(decisionProblems({ ...base, evidenceCount: 0 })[0]).toMatch(/evidence/i);
    expect(decisionProblems({ ...base, isSubmitter: true })[0]).toMatch(/cannot approve/i);
    expect(decisionProblems({ ...base, isSubmitter: true, isTopLeader: true })).toEqual([]);
    expect(decisionProblems({ ...base, decision: 'reject', evidenceCount: 0 })).toEqual([]);
    expect(decisionProblems({ ...base, note: '' })[0]).toMatch(/comment/i);
    expect(decisionProblems({ ...base, status: 'draft' })[0]).toMatch(/not waiting/i);
  });
  it('approval is bound to the exact content', () => {
    const a = { content: { body: 'Hello' }, media: [{ url: '/api/uploads/o/a.png' }], channels: ['facebook', 'linkedin'] };
    const h = contentHash(a);
    expect(contentHash({ ...a, channels: ['linkedin', 'facebook'] })).toBe(h);
    expect(contentHash({ ...a, content: { body: 'Hello!' } })).not.toBe(h);
    expect(contentHash({ ...a, media: [] })).not.toBe(h);
    expect(postingProblems({ approval: { status: 'approved', contentHash: h } }, h)).toEqual([]);
    expect(postingProblems({ approval: { status: 'approved', contentHash: h } }, 'other')[0]).toMatch(/changed/i);
    expect(postingProblems({ approval: { status: 'pending', contentHash: h } }, h)[0]).toMatch(/approved/i);
    expect(postingProblems({ approval: { status: 'approved', contentHash: h }, status: 'cancelled' }, h)[0]).toMatch(/cancelled/i);
  });
  it('composes text with a link and tidy hashtags, and tracks goal progress', () => {
    expect(composeText({ headline: 'H', body: 'B', callToAction: 'Apply', linkUrl: 'https://x.co', hashtags: ['#jobs', 'tech'] })).toBe('H\n\nB\n\nApply\n\nhttps://x.co\n\n#jobs #tech');
    expect(goalProgress({ kind: 'hiring', target: 4 }, { hires: 3 })).toEqual({ current: 3, target: 4, percent: 75 });
    expect(goalProgress({ kind: 'monetary', target: 1000 }, { revenue: 1500 }).percent).toBe(150);
    expect(campaignInsights({ approval: { status: 'draft' } })[0]).toMatch(/not approved/i);
  });
});

describe('social adapters (HTTP mocked)', () => {
  const mk = (replies: any[]) => {
    const calls: any[] = [];
    const http = async (url: string, init: any) => { calls.push({ url, init }); const r = replies.shift(); return { ok: r.ok !== false, status: r.status || 200, json: async () => r.body, text: async () => JSON.stringify(r.body) }; };
    return { http, calls };
  };
  it('facebook: text post, single photo, several photos', async () => {
    let m = mk([{ body: { id: '1_2' } }]);
    expect((await facebook.publish({ externalId: 'P', token: 'TKN', text: 'hi', link: 'https://x.co', imageUrls: [] }, m.http as any)).externalId).toBe('1_2');
    expect(m.calls[0].url).toMatch(/\/P\/feed$/); expect(m.calls[0].init.body).toMatch(/message=hi/);
    m = mk([{ body: { id: 'ph', post_id: 'P_9' } }]);
    expect((await facebook.publish({ externalId: 'P', token: 'TKN', text: 'cap', imageUrls: ['https://i/1.png'] }, m.http as any)).externalId).toBe('P_9');
    expect(m.calls[0].url).toMatch(/\/P\/photos$/);
    m = mk([{ body: { id: 'a' } }, { body: { id: 'b' } }, { body: { id: 'post' } }]);
    await facebook.publish({ externalId: 'P', token: 'TKN', text: 'cap', imageUrls: ['https://i/1.png', 'https://i/2.png'] }, m.http as any);
    expect(m.calls[2].init.body).toMatch(/attached_media%5B1%5D/);
  });
  it('instagram: needs a picture, publishes in two steps', async () => {
    expect(instagram.cannotPublish({ externalId: 'IG', text: 't', imageUrls: [] })).toMatch(/image/i);
    const m = mk([{ body: { id: 'c1' } }, { body: { id: 'm1' } }]);
    expect((await instagram.publish({ externalId: 'IG', token: 'TKN', text: 't', imageUrls: ['https://i/1.png'] }, m.http as any)).externalId).toBe('m1');
    expect(m.calls[1].url).toMatch(/media_publish$/);
  });
  it('linkedin: text with link, pictures are refused so they go to a person', async () => {
    expect(linkedin.cannotPublish({ externalId: '123', text: 't', imageUrls: ['u'] })).toMatch(/by hand/);
    const m = mk([{ body: { id: 'urn:li:share:1' } }]);
    await linkedin.publish({ externalId: '123', token: 'TKN', text: 'We are hiring', link: 'https://x.co', imageUrls: [] }, m.http as any);
    const body = JSON.parse(m.calls[0].init.body);
    expect(body.author).toBe('urn:li:organization:123'); expect(m.calls[0].init.headers['X-Restli-Protocol-Version']).toBe('2.0.0');
  });
  it('platform errors never leak the access token', async () => {
    const m = mk([{ ok: false, status: 401, body: { error: { message: 'Invalid OAuth access token TKN-SECRET-123' } } }]);
    await expect(facebook.publish({ externalId: 'P', token: 'TKN-SECRET-123', text: 'x', imageUrls: [] }, m.http as any)).rejects.toThrow(/refused/);
    const m2 = mk([{ ok: false, status: 401, body: { error: { message: 'Invalid OAuth access token TKN-SECRET-123' } } }]);
    try { await facebook.publish({ externalId: 'P', token: 'TKN-SECRET-123', text: 'x', imageUrls: [] }, m2.http as any); } catch (e: any) { expect(e.message).not.toContain('TKN-SECRET-123'); expect(e.status).toBe(401); }
  });
  it('picture links are signed, short-lived and image-only', () => {
    const org = 'a'.repeat(24);
    const url = signedMediaUrl(`/api/uploads/${org}/pic.png`, 60, 1_000_000)!;
    const q = new URL(url).searchParams; const exp = Number(q.get('exp')); const sig = q.get('sig')!;
    expect(verifyMediaSignature(org, 'pic.png', exp, sig, 1_000_000)).toBe(true);
    expect(verifyMediaSignature(org, 'other.png', exp, sig, 1_000_000)).toBe(false);
    expect(verifyMediaSignature(org, 'pic.png', exp, sig, 1_000_000 + 120_000)).toBe(false);
    expect(signedMediaUrl(`/api/uploads/${org}/contract.pdf`)).toBeNull();
  });
});
