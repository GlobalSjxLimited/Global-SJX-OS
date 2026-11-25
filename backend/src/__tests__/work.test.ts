import { parseQuarter, normaliseQuarter, quarterOf, overlapFilter, rangeFromQuery, quarterOptions } from '../utils/quarter';
import { evaluateRule, stripQuoted, cleanSubject, wordMatch, isAutomated } from '../services/emailIntake.service';
import { submissionProblems, certificateNumber, ribbonFor } from '../services/approval.service';
import { buildIcs, uploadRemindersStart, joinRows } from '../services/meeting.service';
import { visibleTasksFilter, canViewTask, taskPermissions } from '../services/work.access';

const rule = (o: any = {}) => ({ _id: 'r', name: 'R', keywords: ['task', 'training', 'audit'], matchMode: 'any', organisations: ['Opex'], requireOrganisation: true, senderDomains: [], allowUnknownSenders: false, ...o });
const ctx = (o: any = {}) => ({ text: 'Task: please help Opex', domain: 'opex.com', known: true, ...o });

describe('quarters', () => {
  it('parses and normalises', () => {
    expect(parseQuarter('2026-Q4')!.from.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(parseQuarter('2026-Q4')!.to.toISOString()).toBe('2026-12-31T23:59:59.999Z');
    expect(normaliseQuarter('q1 2027')).toBe('2027-Q1');
    expect(parseQuarter('2026-Q5')).toBeNull();
    expect(parseQuarter('nonsense')).toBeNull();
    expect(quarterOf(new Date('2026-02-10T00:00:00Z'))).toBe('2026-Q1');
  });
  it('builds filters and options', () => {
    const r = rangeFromQuery({ quarter: '2026-Q2' })!;
    expect(r.from.getUTCMonth()).toBe(3);
    expect(JSON.stringify(overlapFilter(r))).toContain('$or');
    expect(rangeFromQuery({})).toBeNull();
    expect(rangeFromQuery({ from: '2026-01-01', to: '2026-01-31' })!.to.getUTCDate()).toBe(31);
    const opts = quarterOptions(4, new Date('2026-10-27T00:00:00Z'));
    expect(opts[0]).toBe('2027-Q1'); expect(opts).toHaveLength(4);
  });
});

describe('e-mail intake matching', () => {
  it('matches whole words only, case-insensitively', () => {
    expect(wordMatch('Please AUDIT us', 'audit')).toBe(true);
    expect(wordMatch('auditor visit', 'audit')).toBe(false);
    expect(wordMatch('Opex Ltd.', 'Opex')).toBe(true);
    expect(wordMatch('see you (training)', 'training')).toBe(true);
  });
  it('needs a keyword and, when required, an organisation', () => {
    expect(evaluateRule(rule(), ctx()).passed).toBe(true);
    expect(evaluateRule(rule(), ctx({ text: 'Lunch with Opex' })).passed).toBe(false);
    expect(evaluateRule(rule(), ctx({ text: 'Task for somebody else' })).reason).toMatch(/organisation/i);
    expect(evaluateRule(rule({ requireOrganisation: false }), ctx({ text: 'a task' })).passed).toBe(true);
  });
  it('matches the organisation through the sender client record', () => {
    expect(evaluateRule(rule(), ctx({ text: 'task please', clientName: 'opex' })).passed).toBe(true);
  });
  it('supports match-all, domains and unknown senders', () => {
    expect(evaluateRule(rule({ matchMode: 'all' }), ctx({ text: 'task training audit Opex' })).passed).toBe(true);
    expect(evaluateRule(rule({ matchMode: 'all' }), ctx({ text: 'task Opex' })).passed).toBe(false);
    expect(evaluateRule(rule({ senderDomains: ['opex.com'] }), ctx({ domain: 'evil.com' })).passed).toBe(false);
    expect(evaluateRule(rule(), ctx({ known: false })).passed).toBe(false);
    expect(evaluateRule(rule({ allowUnknownSenders: true }), ctx({ known: false })).passed).toBe(true);
    expect(evaluateRule(rule({ keywords: [] }), ctx()).passed).toBe(false);
  });
  it('cleans subjects and quoted replies, detects automated mail', () => {
    expect(cleanSubject('RE: Fwd: Task audit')).toBe('Task audit');
    expect(stripQuoted('Please do this task\n\nOn Mon, 5 Oct, Bob wrote:\n> old\n> older')).toBe('Please do this task');
    expect(isAutomated({ from: 'noreply@x.com', subject: 'Task' })).toBe(true);
    expect(isAutomated({ from: 'dele@opex.com', subject: 'Automatic reply: away' })).toBe(true);
    expect(isAutomated({ from: 'dele@opex.com', subject: 'Task audit' })).toBe(false);
  });
});

describe('completion rules', () => {
  it('lists every reason a piece of work cannot be submitted', () => {
    const p = submissionProblems({ requireEvidence: true, evidenceCount: 0, criteria: [{ text: 'A', met: false }, { text: 'B', met: true }], openChildren: 2 });
    expect(p).toHaveLength(3);
    expect(submissionProblems({ requireEvidence: false, evidenceCount: 0, criteria: [], openChildren: 0 })).toEqual([]);
    expect(submissionProblems({ requireEvidence: true, evidenceCount: 1, criteria: [{ text: 'A', met: true }] })).toEqual([]);
  });
  it('issues certificate numbers and ribbons', () => {
    expect(certificateNumber('TASK')).toMatch(/^SJX-TASK-\d{4}-[0-9A-F]{6}$/);
    expect(ribbonFor({ onTime: true, evidenceCount: 3 })).toBe('Gold standard');
    expect(ribbonFor({ severity: 'show_stopper', onTime: false, evidenceCount: 1 })).toBe('Critical delivery');
  });
});

describe('meetings', () => {
  it('writes a valid calendar invite with join details', () => {
    const ics = buildIcs({ _id: 'abc', title: 'Kick-off; "plan"', date: new Date('2026-10-28T10:00:00Z'), durationMins: 30, provider: 'zoom', providerDetails: { meetingId: '123', passcode: 'p', url: 'https://zoom.us/j/123' } }, { name: 'Joe', email: 'joe@x.com' });
    expect(ics).toContain('BEGIN:VCALENDAR'); expect(ics).toContain('DTSTART:20261028T100000Z'); expect(ics).toContain('DTEND:20261028T103000Z');
    expect(ics).toContain('SUMMARY:Kick-off\; "plan"'); expect(ics).toContain('METHOD:REQUEST');
    expect(buildIcs({ _id: 'abc', title: 'x', date: new Date() }, {}, 'CANCEL')).toContain('STATUS:CANCELLED');
    expect(joinRows({ provider: 'teams', providerDetails: { meetingId: '9' } }).find(([k]) => k === 'Meeting ID')![1]).toBe('9');
  });
  it('starts the daily upload reminders at 09:00 Lagos on the next day', () => {
    expect(uploadRemindersStart(new Date('2026-10-27T14:00:00Z')).toISOString()).toBe('2026-10-28T08:00:00.000Z');
    expect(uploadRemindersStart(new Date('2026-10-27T23:30:00Z')).toISOString()).toBe('2026-10-29T08:00:00.000Z'); // 00:30 Lagos on the 28th is already "the next day"
  });
});

describe('task visibility', () => {
  const scope = (id: string, role: string, member: string[] = [], managed: string[] = []) => ({ actor: { id, role, organizationId: 'o' }, memberProjectIds: member, managedProjectIds: managed });
  const P = 'a'.repeat(24); const U = 'b'.repeat(24); const V = 'c'.repeat(24);
  const task = (o: any = {}) => ({ ownerId: U, creatorId: U, projectId: P, confidential: false, status: 'todo', ...o });
  it('project members see normal tasks but not confidential ones', () => {
    expect(canViewTask(scope(V, 'employee', [P]), task())).toBe(true);
    expect(canViewTask(scope(V, 'employee', [P]), task({ confidential: true }))).toBe(false);
    expect(canViewTask(scope(V, 'employee'), task())).toBe(false);
  });
  it('owner, project manager and CEO see confidential tasks; COO does not unless involved', () => {
    expect(canViewTask(scope(U, 'employee'), task({ confidential: true }))).toBe(true);
    expect(canViewTask(scope(V, 'project_manager', [P], [P]), task({ confidential: true }))).toBe(true);
    expect(canViewTask(scope(V, 'ceo'), task({ confidential: true }))).toBe(true);
    expect(canViewTask(scope(V, 'coo'), task({ confidential: true }))).toBe(false);
    expect(canViewTask(scope(V, 'coo'), task())).toBe(true);
  });
  it('shared users can view, but never confidential sharing', () => {
    expect(canViewTask(scope(V, 'employee'), task({ sharedWith: [V] }))).toBe(true);
    expect(taskPermissions(scope(U, 'employee'), task({ confidential: true })).share).toBe(false);
  });
  it('the assignee can never approve their own work', () => {
    const t = task({ status: 'to_be_reviewed', approverId: U });
    expect(taskPermissions(scope(U, 'employee', [P]), t).approve).toBe(false);
    expect(taskPermissions(scope(V, 'employee', [P]), { ...t, approverId: V }).approve).toBe(true);
  });
  it('builds a mongo filter that matches the rule', () => {
    expect(visibleTasksFilter(scope(V, 'ceo'))).toEqual({});
    expect(JSON.stringify(visibleTasksFilter(scope(V, 'employee', [P])))).toContain('"confidential":{"$ne":true}');
  });
});
