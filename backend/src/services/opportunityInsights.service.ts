import { CLOSED_STAGES, OPEN_STAGES, PIPELINE_STAGES } from '../config/pipeline';

const DAY = 86400000;
export interface OppLike {
  _id: any; title: string; stage: string; value?: number; probability?: number; createdAt?: any; closedAt?: any; salespersonId?: any; clientName?: string;
  nextAction?: string; nextActionDate?: any; lostReason?: string; winReason?: string; contacts?: any[]; source?: string; documentCount?: number; competitors?: string[];
  stageHistory?: Array<{ stage?: string; from?: string; changedAt?: any; comment?: string; byName?: string }>;
}
export interface Insight { area: 'current' | 'happened' | 'convert' | 'improve'; severity: 'info' | 'warn' | 'good'; text: string; oppId?: string }

const idx = (s?: string) => PIPELINE_STAGES.indexOf((s || '') as any);
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
const days = (a: any, b: any) => Math.max(0, Math.round((+new Date(b) - +new Date(a)) / DAY));

/** The furthest open stage an opportunity ever reached (closed-lost deals keep the stage they died in). */
function furthest(o: OppLike): number {
  let best = idx(o.stage);
  if (o.stage === 'Closed Lost') best = -1;
  for (const h of o.stageHistory || []) { const i = idx(h.stage); if (i >= 0 && OPEN_STAGES.includes(h.stage!) && i > best) best = i; if (h.from && OPEN_STAGES.includes(h.from) && idx(h.from) > best) best = idx(h.from); }
  if (o.stage === 'Closed Won') best = idx('Documentation');
  return best < 0 ? 0 : best;
}

/** Turns the list of opportunities into: what we are doing now, what happened, how to convert, how to improve. Pure, so it can be tested. */
export function buildInsights(opps: OppLike[], names: Record<string, string> = {}, now = new Date()) {
  const open = opps.filter((o) => OPEN_STAGES.includes(o.stage));
  const won = opps.filter((o) => o.stage === 'Closed Won');
  const lost = opps.filter((o) => o.stage === 'Closed Lost');
  const sum = (l: OppLike[], f: (o: OppLike) => number) => l.reduce((n, o) => n + f(o), 0);
  const openValue = sum(open, (o) => o.value || 0);
  const overview = {
    total: opps.length, open: open.length, won: won.length, lost: lost.length, openValue, weightedValue: Math.round(sum(open, (o) => (o.value || 0) * ((o.probability || 0) / 100))),
    wonValue: sum(won, (o) => o.value || 0), lostValue: sum(lost, (o) => o.value || 0), winRate: pct(won.length, won.length + lost.length),
    avgDealSize: won.length ? Math.round(sum(won, (o) => o.value || 0) / won.length) : 0,
    avgCycleDays: won.length ? Math.round(sum(won, (o) => days(o.createdAt, o.closedAt || now)) / won.length) : 0,
  };

  // Funnel: how many ever reached each open stage, and the step-to-step conversion.
  const reached = OPEN_STAGES.map((_, i) => opps.filter((o) => furthest(o) >= i).length);
  const funnel = OPEN_STAGES.map((stage, i) => ({
    stage, reached: reached[i], now: open.filter((o) => o.stage === stage).length, value: sum(open.filter((o) => o.stage === stage), (o) => o.value || 0),
    toNextPct: i < OPEN_STAGES.length - 1 ? pct(reached[i + 1], reached[i]) : pct(won.length, reached[i]), 
  }));
  const drops = funnel.slice(0, -1).filter((f) => f.reached >= 3).map((f, i) => ({ from: f.stage, to: OPEN_STAGES[i + 1], lostPct: 100 - f.toNextPct, count: f.reached - funnel[i + 1].reached })).sort((a, b) => b.lostPct - a.lostPct);

  // Time in each stage, from the history.
  const spent: Record<string, number[]> = {};
  for (const o of opps) {
    const h = [...(o.stageHistory || [])].filter((x) => x.changedAt).sort((a, b) => +new Date(a.changedAt) - +new Date(b.changedAt));
    for (let i = 0; i < h.length; i++) {
      const end = h[i + 1]?.changedAt || (OPEN_STAGES.includes(o.stage) ? now : null);
      if (end && h[i].stage && OPEN_STAGES.includes(h[i].stage!)) (spent[h[i].stage!] ||= []).push(days(h[i].changedAt, end));
    }
  }
  const timeInStage = OPEN_STAGES.map((stage) => ({ stage, avgDays: spent[stage]?.length ? Math.round(spent[stage].reduce((a, b) => a + b, 0) / spent[stage].length) : 0, samples: spent[stage]?.length || 0 }));

  const lastMove = (o: OppLike) => { const h = o.stageHistory || []; return h.length ? h[h.length - 1].changedAt : o.createdAt; };
  const stalled = open.map((o) => ({ o, idle: days(lastMove(o), now) })).filter((x) => x.idle >= (['Negotiation', 'Documentation'].includes(x.o.stage) ? 14 : 30)).sort((a, b) => b.o.value! - a.o.value! || b.idle - a.idle);
  const overdueActions = open.filter((o) => o.nextActionDate && new Date(o.nextActionDate) < now);
  const noNextAction = open.filter((o) => !(o.nextAction || '').trim());
  const noContacts = open.filter((o) => !(o.contacts || []).length);
  const lateNoDocs = open.filter((o) => ['Documentation'].includes(o.stage) && !(o.documentCount || 0));

  const rank = (list: string[]) => Object.entries(list.filter(Boolean).reduce((m: Record<string, number>, r) => ((m[r] = (m[r] || 0) + 1), m), {})).sort((a, b) => b[1] - a[1]).map(([reason, count]) => ({ reason, count }));
  const lostReasons = rank(lost.map((o) => o.lostReason || ''));
  const winReasons = rank(won.map((o) => o.winReason || ''));
  const bySource = Object.entries(opps.reduce((m: Record<string, { won: number; lost: number; total: number }>, o) => { const k = o.source || 'manual'; const r = (m[k] ||= { won: 0, lost: 0, total: 0 }); r.total++; if (o.stage === 'Closed Won') r.won++; if (o.stage === 'Closed Lost') r.lost++; return m; }, {})).map(([source, r]) => ({ source, ...r, winRate: pct(r.won, r.won + r.lost) })).sort((a, b) => b.total - a.total);
  const people = Array.from(new Set(opps.map((o) => String(o.salespersonId?._id || o.salespersonId || '')).filter(Boolean)));
  const bySalesperson = people.map((id) => {
    const mine = opps.filter((o) => String(o.salespersonId?._id || o.salespersonId) === id);
    const w = mine.filter((o) => o.stage === 'Closed Won').length, l = mine.filter((o) => o.stage === 'Closed Lost').length, op = mine.filter((o) => OPEN_STAGES.includes(o.stage));
    return { id, name: names[id] || 'Unknown', won: w, lost: l, winRate: pct(w, w + l), open: op.length, openValue: sum(op, (o) => o.value || 0), wonValue: sum(mine.filter((o) => o.stage === 'Closed Won'), (o) => o.value || 0) };
  }).sort((a, b) => b.wonValue - a.wonValue || b.openValue - a.openValue);

  // What happened: the latest stage changes, newest first.
  const happened = opps.flatMap((o) => (o.stageHistory || []).filter((h) => h.changedAt).map((h) => ({ oppId: String(o._id), title: o.title, client: o.clientName, from: h.from || '', to: h.stage || '', comment: h.comment || '', by: h.byName || '', at: h.changedAt })))
    .sort((a, b) => +new Date(b.at) - +new Date(a.at)).slice(0, 30);

  const I: Insight[] = [];
  const money = (n: number) => `₦${Math.round(n).toLocaleString()}`;
  // CURRENT
  I.push({ area: 'current', severity: 'info', text: `${open.length} open opportunit${open.length === 1 ? 'y' : 'ies'} worth ${money(openValue)} (${money(overview.weightedValue)} weighted by probability).` });
  const biggest = [...open].sort((a, b) => (b.value || 0) - (a.value || 0))[0];
  if (biggest) I.push({ area: 'current', severity: 'info', text: `Largest open deal: “${biggest.title}”${biggest.clientName ? ` (${biggest.clientName})` : ''}, ${money(biggest.value || 0)}, at ${biggest.stage}.`, oppId: String(biggest._id) });
  if (open.length) { const heavy = funnel.slice().sort((a, b) => b.value - a.value)[0]; if (heavy.value) I.push({ area: 'current', severity: 'info', text: `Most of the open value (${money(heavy.value)}) sits at ${heavy.stage}.` }); }
  // HAPPENED
  if (overview.won + overview.lost) I.push({ area: 'happened', severity: overview.winRate >= 40 ? 'good' : 'warn', text: `Of ${overview.won + overview.lost} closed deals, ${overview.won} were won (${overview.winRate}%) and ${overview.lost} lost. Won value ${money(overview.wonValue)}, lost value ${money(overview.lostValue)}.` });
  if (overview.won) I.push({ area: 'happened', severity: 'info', text: `Won deals averaged ${money(overview.avgDealSize)} and took ${overview.avgCycleDays} days from first contact to close.` });
  if (lostReasons[0]) I.push({ area: 'happened', severity: 'warn', text: `Most common reason for losing: “${lostReasons[0].reason}” (${lostReasons[0].count} of ${lost.length}).` });
  if (winReasons[0]) I.push({ area: 'happened', severity: 'good', text: `Most common reason for winning: “${winReasons[0].reason}” (${winReasons[0].count} of ${won.length}).` });
  // CONVERT (the open deals, one by one)
  for (const x of stalled.slice(0, 5)) I.push({ area: 'convert', severity: 'warn', text: `“${x.o.title}” (${x.o.stage}, ${money(x.o.value || 0)}) has not moved for ${x.idle} days. Call the primary contact today and agree a next step with a date.`, oppId: String(x.o._id) });
  for (const o of overdueActions.slice(0, 5)) I.push({ area: 'convert', severity: 'warn', text: `“${o.title}”: the next action “${o.nextAction || 'follow up'}” was due ${new Date(o.nextActionDate).toISOString().slice(0, 10)}. Do it or reschedule it.`, oppId: String(o._id) });
  for (const o of lateNoDocs.slice(0, 5)) I.push({ area: 'convert', severity: 'warn', text: `“${o.title}” is at Documentation with nothing attached. Upload the contract or purchase order so it can be closed.`, oppId: String(o._id) });
  const ripe = open.filter((o) => o.stage === 'Negotiation' && !stalled.some((s) => s.o === o));
  if (ripe.length) I.push({ area: 'convert', severity: 'good', text: `${ripe.length} deal${ripe.length === 1 ? ' is' : 's are'} in Negotiation and moving. Prepare the contract now so Documentation does not slow the close.` });
  // IMPROVE
  if (drops[0] && drops[0].lostPct >= 40) I.push({ area: 'improve', severity: 'warn', text: `Biggest leak: ${drops[0].lostPct}% of deals that reach ${drops[0].from} never reach ${drops[0].to}. Review what is said at that step and tighten the qualification before it.` });
  if (noNextAction.length) I.push({ area: 'improve', severity: 'warn', text: `${noNextAction.length} open deal${noNextAction.length === 1 ? ' has' : 's have'} no next action. Every open deal should always have one dated step.` });
  if (noContacts.length) I.push({ area: 'improve', severity: 'warn', text: `${noContacts.length} open deal${noContacts.length === 1 ? ' has' : 's have'} no contact person recorded. Add the decision maker and a champion.` });
  const lostPrice = lostReasons.find((r) => /price|budget/i.test(r.reason));
  if (lostPrice && lostPrice.count >= 2) I.push({ area: 'improve', severity: 'warn', text: `${lostPrice.count} deals were lost on price or budget. Qualify budget earlier and offer phased scopes.` });
  const lostComp = lostReasons.find((r) => /competitor/i.test(r.reason));
  if (lostComp && lostComp.count >= 2) I.push({ area: 'improve', severity: 'warn', text: `${lostComp.count} deals were lost to competitors. Record who they were and write up what we say against them.` });
  const slow = timeInStage.slice().sort((a, b) => b.avgDays - a.avgDays)[0];
  if (slow && slow.avgDays >= 21 && slow.samples >= 2) I.push({ area: 'improve', severity: 'info', text: `Deals spend the longest at ${slow.stage} (${slow.avgDays} days on average). Look for a way to shorten it.` });
  const bestSrc = bySource.filter((s) => s.won + s.lost >= 3).sort((a, b) => b.winRate - a.winRate)[0];
  if (bestSrc && bestSrc.winRate >= 50) I.push({ area: 'improve', severity: 'good', text: `Deals from “${bestSrc.source}” close best (${bestSrc.winRate}%). Put more effort there.` });
  if (!opps.length) I.push({ area: 'improve', severity: 'info', text: 'No opportunities in this period yet. Start by recording every serious enquiry.' });

  return { overview, funnel, drops, timeInStage, stalled: stalled.slice(0, 10).map((x) => ({ oppId: String(x.o._id), title: x.o.title, stage: x.o.stage, value: x.o.value || 0, idleDays: x.idle, client: x.o.clientName })), overdueActions: overdueActions.length, noNextAction: noNextAction.length, noContacts: noContacts.length, lostReasons, winReasons, bySource, bySalesperson, happened, insights: I, stages: PIPELINE_STAGES, closed: CLOSED_STAGES };
}
