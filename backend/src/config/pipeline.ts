/** Sales pipeline. "Documentation" is the paperwork stage between agreeing terms and closing. */
export const PIPELINE_STAGES = ['Lead', 'Qualified', 'Discovery', 'Proposal', 'Negotiation', 'Documentation', 'Closed Won', 'Closed Lost'] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];
export const OPEN_STAGES: string[] = ['Lead', 'Qualified', 'Discovery', 'Proposal', 'Negotiation', 'Documentation'];
export const CLOSED_STAGES: string[] = ['Closed Won', 'Closed Lost'];
export const isClosedStage = (s?: string) => CLOSED_STAGES.includes(s || '');
export const DEFAULT_PROBABILITY: Record<string, number> = { Lead: 10, Qualified: 25, Discovery: 40, Proposal: 55, Negotiation: 70, Documentation: 90, 'Closed Won': 100, 'Closed Lost': 0 };
export const LOST_REASONS = ['Price', 'Chose a competitor', 'No budget', 'No decision / went quiet', 'Requirements changed', 'Timing', 'Not a fit', 'Other'];

/** Pure: why a stage change must be refused. Every change needs a comment. */
export function stageProblems(i: { from: string; to: string; comment?: string; lostReason?: string; documentCount: number; hasClientOrProspect: boolean; value: number; skipDocuments?: boolean; canSkip?: boolean }): string[] {
  const out: string[] = [];
  if (i.from === i.to) return out;
  if (!PIPELINE_STAGES.includes(i.to as PipelineStage)) return ['That is not a pipeline stage.'];
  if ((i.comment || '').trim().length < 3) out.push('Write a comment: what happened to move it?');
  if (i.to === 'Closed Lost' && !(i.lostReason || '').trim()) out.push('Say why it was lost. It feeds the improvement report.');
  if (i.to === 'Closed Won') {
    if (!i.hasClientOrProspect) out.push('Link the opportunity to a client (or name the prospect) before winning it.');
    if (!(i.value > 0)) out.push('Enter the deal value before winning it.');
    if (i.documentCount < 1 && !(i.skipDocuments && i.canSkip)) out.push('Attach the signed documentation (contract, signed proposal or purchase order) before closing as won.');
  }
  return out;
}
