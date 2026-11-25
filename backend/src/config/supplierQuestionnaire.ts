/**
 * Supplier security questionnaire. Each question has a weight (1-3) and may be "critical":
 * a "no" on a critical question stops the supplier from being rated low risk, whatever the score.
 * Wording is a practical due-diligence list aligned to ISO/IEC 27001 Annex A.5.19-5.23 and NDPA obligations;
 * it is not a legal or audit standard, and a person must judge the answers.
 */
export interface SQ { id: string; domain: string; text: string; weight: 1 | 2 | 3; critical?: boolean; help?: string }
export const SQ_ANSWERS = ['yes', 'partial', 'no', 'na'] as const;
export const QUESTIONS: SQ[] = [
  { id: 'gov1', domain: 'Governance', text: 'Do you have a written information security policy approved by management and reviewed at least yearly?', weight: 2 },
  { id: 'gov2', domain: 'Governance', text: 'Is someone named as responsible for information security?', weight: 1 },
  { id: 'gov3', domain: 'Governance', text: 'Do you hold ISO/IEC 27001, SOC 2 or an equivalent independent certification?', weight: 2, help: 'Say which one in the note, with the expiry date.' },
  { id: 'hr1', domain: 'People', text: 'Are staff screened before hiring and bound by confidentiality terms?', weight: 2 },
  { id: 'hr2', domain: 'People', text: 'Do all staff receive security awareness training at least yearly?', weight: 2 },
  { id: 'acc1', domain: 'Access control', text: 'Is multi-factor authentication required for staff access to systems holding our data?', weight: 3, critical: true },
  { id: 'acc2', domain: 'Access control', text: 'Is access limited to people who need it and removed promptly when they leave?', weight: 3 },
  { id: 'acc3', domain: 'Access control', text: 'Are access rights reviewed at least every six months?', weight: 1 },
  { id: 'dat1', domain: 'Data protection', text: 'Is our data encrypted in transit and at rest?', weight: 3, critical: true },
  { id: 'dat2', domain: 'Data protection', text: 'Do you keep our data only as long as the contract needs and delete or return it when it ends?', weight: 2 },
  { id: 'dat3', domain: 'Data protection', text: 'Do you tell us where our data is stored and processed (country and provider)?', weight: 2, help: 'Name the countries in the note.' },
  { id: 'dat4', domain: 'Data protection', text: 'If you handle personal data for us, will you sign a data processing agreement and meet the Nigeria Data Protection Act?', weight: 3, critical: true },
  { id: 'sub1', domain: 'Sub-contractors', text: 'Do you tell us before using another company that will touch our data, and hold them to the same standards?', weight: 2 },
  { id: 'ops1', domain: 'Operations', text: 'Are systems patched on a defined schedule, with critical fixes applied within 30 days?', weight: 2 },
  { id: 'ops2', domain: 'Operations', text: 'Do you run anti-malware and keep security logs for at least 90 days?', weight: 2 },
  { id: 'ops3', domain: 'Operations', text: 'Are vulnerability scans or penetration tests done at least yearly, with findings fixed?', weight: 2 },
  { id: 'ops4', domain: 'Operations', text: 'Are production and test environments separated, and is our real data kept out of testing?', weight: 1 },
  { id: 'inc1', domain: 'Incidents', text: 'Do you have an incident response process and will you tell us within 72 hours of a breach that affects our data?', weight: 3, critical: true },
  { id: 'inc2', domain: 'Incidents', text: 'Have you had a security breach in the last 3 years that affected customer data?', weight: 2, help: 'Answer "no" only if there was none. Describe any in the note.' },
  { id: 'bcp1', domain: 'Continuity', text: 'Do you have a tested business continuity and disaster recovery plan?', weight: 2 },
  { id: 'bcp2', domain: 'Continuity', text: 'Are backups taken regularly, stored separately and restore-tested?', weight: 2 },
  { id: 'phy1', domain: 'Physical', text: 'Are the premises or data centres that hold our data physically access-controlled?', weight: 1 },
  { id: 'dev1', domain: 'Secure development', text: 'If you build software for us, do you follow secure coding practice with code review and security testing?', weight: 2 },
  { id: 'aud1', domain: 'Assurance', text: 'Will you let us (or an auditor we appoint) review your security controls on reasonable notice?', weight: 2 },
  { id: 'aud2', domain: 'Assurance', text: 'Can you provide evidence (policies, certificates, reports) for the answers above on request?', weight: 1 },
];
export const INVERTED_IDS = ['inc2'];
export const QMAP = new Map(QUESTIONS.map((q) => [q.id, q]));

/** For a "yes" to be bad (inc2 asks about a breach) the scoring is inverted. */
const INVERTED = new Set(['inc2']);
export function score(answers: { qid: string; answer: string }[]) {
  let got = 0, max = 0; const critFails: string[] = []; const gaps: string[] = [];
  for (const q of QUESTIONS) {
    const a = answers.find((x) => x.qid === q.id)?.answer; if (!a || a === 'na') continue;
    const v = INVERTED.has(q.id) ? (a === 'no' ? 1 : a === 'partial' ? 0.5 : 0) : a === 'yes' ? 1 : a === 'partial' ? 0.5 : 0;
    got += v * q.weight; max += q.weight;
    if (v === 0) { gaps.push(q.id); if (q.critical) critFails.push(q.id); }
  }
  const pct = max ? Math.round((got / max) * 100) : 0;
  const tier: 'low' | 'medium' | 'high' = critFails.length ? 'high' : pct >= 80 ? 'low' : pct >= 55 ? 'medium' : 'high';
  return { pct, tier, critFails, gaps };
}

/** A note is required when the answer is not the good one ("no" breach is good for inc2). */
export const needsNote = (qid: string, answer: string) => (INVERTED.has(qid) ? answer === 'yes' || answer === 'partial' : answer === 'no' || answer === 'partial');
