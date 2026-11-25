import crypto from 'crypto';
import { User } from '../models/User';
import { Project } from '../models/Project';
import { excludeDeleted } from '../utils/softDeletePlugin';

const oid = (v: unknown) => (v == null ? '' : String((v as any)._id || v));

/**
 * Who signs off on a piece of work. In order: the person named as approver, whoever created
 * it (if that is not the person doing the work), the project manager, then HR / CEO / admin.
 * The person doing the work can never approve their own work.
 */
export async function resolveApprover(opts: { organizationId: string; ownerId: string; approverId?: unknown; creatorId?: unknown; projectId?: unknown }): Promise<string | null> {
  const owner = oid(opts.ownerId);
  const candidates: string[] = [oid(opts.approverId), oid(opts.creatorId)];
  if (opts.projectId) {
    const p = await Project.findOne(excludeDeleted({ _id: opts.projectId, organizationId: opts.organizationId })).select('projectManagerId').lean();
    if (p) candidates.push(oid((p as any).projectManagerId));
  }
  for (const c of candidates) if (c && c !== owner) {
    const u = await User.findOne({ _id: c, organizationId: opts.organizationId, isActive: true }).select('_id');
    if (u) return String(u._id);
  }
  for (const role of ['hr', 'ceo', 'super_admin']) {
    const u = await User.findOne({ organizationId: opts.organizationId, role, isActive: true, _id: { $ne: owner } }).select('_id').sort('createdAt');
    if (u) return String(u._id);
  }
  return null;
}

export interface SubmitCheckInput {
  requireEvidence?: boolean;
  evidenceCount: number;
  criteria?: Array<{ met?: boolean; text?: string }>;
  openChildren?: number; // unfinished subtasks / tasks
  childLabel?: string;
}

/** The rules that stop work being marked complete early. Returns human-readable problems; empty = good to submit. */
export function submissionProblems(i: SubmitCheckInput): string[] {
  const out: string[] = [];
  if (i.requireEvidence && i.evidenceCount < 1) out.push('Attach at least one piece of evidence (file, image, recording or link).');
  const unmet = (i.criteria || []).filter((c) => !c.met);
  if (unmet.length) out.push(`${unmet.length} acceptance criteri${unmet.length === 1 ? 'on is' : 'a are'} not met yet: ${unmet.slice(0, 3).map((c) => `"${c.text}"`).join(', ')}${unmet.length > 3 ? '…' : ''}`);
  if ((i.openChildren || 0) > 0) out.push(`${i.openChildren} ${i.childLabel || 'subtask'}${i.openChildren === 1 ? ' is' : 's are'} still open.`);
  return out;
}

/** Short readable number printed on the certificate, e.g. SJX-CERT-2026-8F3A1C. */
export function certificateNumber(kind: 'TASK' | 'MILE' | 'GOAL'): string {
  return `SJX-${kind}-${new Date().getUTCFullYear()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

export function ribbonFor(opts: { severity?: string; onTime: boolean; evidenceCount: number }): string {
  if (opts.severity === 'show_stopper' || opts.severity === 'critical') return opts.onTime ? 'Critical delivery — on time' : 'Critical delivery';
  if (opts.onTime && opts.evidenceCount >= 3) return 'Gold standard';
  if (opts.onTime) return 'Delivered on time';
  return opts.evidenceCount ? 'Delivered with evidence' : 'Delivered';
}
