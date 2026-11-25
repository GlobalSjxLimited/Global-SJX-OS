import { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { ApiError } from '../utils/ApiError';
import { Task } from '../models/Task';
import { Certification } from '../models/Certification';
import { Project } from '../models/Project';
import { Client } from '../models/Client';
import { Opportunity } from '../models/Opportunity';
import { Course } from '../models/Course';
import { Enrollment } from '../models/Enrollment';
import { EmployeeSkill } from '../models/Skill';
import { Meeting } from '../models/Meeting';
import { Risk } from '../models/Risk';
import { OPEN_FILTER, isFinished, isOpenStatus } from '../config/taskStatus';

/**
 * SJX AI — intentionally rule-based rather than a wrapper around a hosted LLM,
 * so every answer is grounded in this organization's real data with no risk of
 * fabrication. Each intent below queries MongoDB directly. Swapping in a hosted
 * model for open-ended questions (and keeping these as verified "tools" the
 * model can call) is the natural next step.
 */

type Intent =
  | 'today'
  | 'overdue'
  | 'certifications_expiring'
  | 'projects_at_risk'
  | 'client_summary'
  | 'contracts_expiring'
  | 'opportunities_closing'
  | 'recommend_training'
  | 'project_status_report'
  | 'unknown';

function detectIntent(message: string): Intent {
  const m = message.toLowerCase();
  if (m.includes('today') && (m.includes('work') || m.includes('do'))) return 'today';
  if (m.includes('overdue')) return 'overdue';
  if (m.includes('certificat') && m.includes('expir')) return 'certifications_expiring';
  if (m.includes('project') && m.includes('risk')) return 'projects_at_risk';
  if (m.includes('summar') && (m.includes('client') || m.includes('relationship'))) return 'client_summary';
  if (m.includes('contract') && m.includes('expir')) return 'contracts_expiring';
  if (m.includes('opportunit') && (m.includes('close') || m.includes('likely'))) return 'opportunities_closing';
  if (m.includes('recommend') && m.includes('training')) return 'recommend_training';
  if (m.includes('status report') || (m.includes('project') && m.includes('report'))) return 'project_status_report';
  return 'unknown';
}

export const ask = asyncHandler(async (req: Request, res: Response) => {
  const { message, clientId, projectId } = req.body as { message: string; clientId?: string; projectId?: string };
  if (!message) throw ApiError.badRequest('message is required');

  const orgId = req.user!.organizationId;
  const userId = req.user!.id;
  const intent = detectIntent(message);

  switch (intent) {
    case 'today': {
      const start = new Date(); start.setHours(0, 0, 0, 0);
      const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
      const tasks = await Task.find({ organizationId: orgId, ownerId: userId, dueDate: { $gte: start, $lt: end } }).sort('priority');
      return res.json({
        success: true,
        data: {
          reply: tasks.length
            ? `You have ${tasks.length} task${tasks.length > 1 ? 's' : ''} due today: ${tasks.map((t) => t.title).join(', ')}.`
            : 'Nothing is due today — a good moment to get ahead on upcoming work.',
          items: tasks,
        },
      });
    }
    case 'overdue': {
      const tasks = await Task.find({ organizationId: orgId, $or: [{ ownerId: userId }, { coOwnerIds: userId }], status: OPEN_FILTER, dueDate: { $lt: new Date() } }).sort('dueDate');
      return res.json({
        success: true,
        data: {
          reply: tasks.length ? `You have ${tasks.length} overdue task${tasks.length > 1 ? 's' : ''}: ${tasks.map((t) => t.title).join(', ')}.` : 'No overdue tasks — you are on track.',
          items: tasks,
        },
      });
    }
    case 'certifications_expiring': {
      const in30 = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      const certs = await Certification.find({ organizationId: orgId, expiryDate: { $lte: in30 } }).populate('employeeId', 'name');
      return res.json({
        success: true,
        data: {
          reply: certs.length
            ? `${certs.length} certification${certs.length > 1 ? 's' : ''} expire within 30 days: ${certs.map((c: any) => `${c.name} (${c.employeeId?.name})`).join(', ')}.`
            : 'No certifications expire in the next 30 days.',
          items: certs,
        },
      });
    }
    case 'projects_at_risk': {
      const projects = await Project.find({ organizationId: orgId, health: { $in: ['at_risk', 'off_track'] } });
      return res.json({
        success: true,
        data: {
          reply: projects.length ? `${projects.length} project${projects.length > 1 ? 's are' : ' is'} flagged at risk: ${projects.map((p) => p.name).join(', ')}.` : 'No projects are currently flagged at risk.',
          items: projects,
        },
      });
    }
    case 'client_summary': {
      if (!clientId) throw ApiError.badRequest('clientId is required for a client summary');
      const client = await Client.findOne({ _id: clientId, organizationId: orgId });
      if (!client) throw ApiError.notFound('Client not found');
      const [projects, opps] = await Promise.all([
        Project.find({ organizationId: orgId, clientId }).select('name status'),
        Opportunity.find({ organizationId: orgId, clientId }).select('title stage value'),
      ]);
      const activeContracts = client.contracts.filter((c: any) => c.status === 'active').length;
      return res.json({
        success: true,
        data: {
          reply: `${client.name} is a ${client.status} ${client.industry || ''} client with ${projects.length} project(s), ${activeContracts} active contract(s), and ${opps.length} open sales opportunit${opps.length === 1 ? 'y' : 'ies'}. Lifetime revenue on record: ${client.revenue.toLocaleString()}.`,
          items: { client, projects, opportunities: opps },
        },
      });
    }
    case 'contracts_expiring': {
      const in90 = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
      const clients = await Client.find({ organizationId: orgId, 'contracts.endDate': { $lte: in90 } }).select('name contracts');
      const expiring = clients.flatMap((c: any) =>
        c.contracts.filter((ct: any) => ct.endDate && ct.endDate <= in90 && ct.status === 'active').map((ct: any) => ({ client: c.name, ...ct.toObject() }))
      );
      return res.json({
        success: true,
        data: {
          reply: expiring.length ? `${expiring.length} contract(s) expire within 90 days: ${expiring.map((e: any) => `${e.title} (${e.client})`).join(', ')}.` : 'No contracts expire in the next 90 days.',
          items: expiring,
        },
      });
    }
    case 'opportunities_closing': {
      const opps = await Opportunity.find({ organizationId: orgId, stage: { $in: ['Proposal', 'Negotiation'] } })
        .sort('-probability')
        .populate('clientId', 'name');
      return res.json({
        success: true,
        data: {
          reply: opps.length ? `${opps.length} opportunit${opps.length === 1 ? 'y is' : 'ies are'} in late stage and likely to close: ${opps.map((o) => `${o.title} (${o.probability}%)`).join(', ')}.` : 'No opportunities are currently in Proposal or Negotiation.',
          items: opps,
        },
      });
    }
    case 'recommend_training': {
      const mySkills = await EmployeeSkill.find({ organizationId: orgId, userId }).select('skillId');
      const skillIds = mySkills.map((s) => s.skillId);
      const courses = await Course.find({
        organizationId: orgId,
        status: 'published',
        $or: [{ requiredForSkillIds: { $in: skillIds } }, { requiredForRoles: req.user!.role }],
      }).limit(5);
      const fallback = courses.length ? courses : await Course.find({ organizationId: orgId, status: 'published' }).limit(5);
      return res.json({
        success: true,
        data: {
          reply: fallback.length ? `Based on your role and skills, consider: ${fallback.map((c) => c.title).join(', ')}.` : 'No published courses are available yet.',
          items: fallback,
        },
      });
    }
    case 'project_status_report': {
      if (!projectId) throw ApiError.badRequest('projectId is required for a status report');
      const project = await Project.findOne({ _id: projectId, organizationId: orgId }).populate('clientId', 'name');
      if (!project) throw ApiError.notFound('Project not found');
      const tasks = await Task.find({ organizationId: orgId, projectId });
      const done = tasks.filter((t) => isFinished(t.status)).length;
      const overdue = tasks.filter((t) => t.dueDate && t.dueDate < new Date() && isOpenStatus(t.status)).length;
      const milestonesDone = project.milestones.filter((m: any) => m.status === 'completed').length;
      const reply = [
        `Status report — ${project.name} (${(project.clientId as any)?.name || 'internal'}):`,
        `Health: ${project.health}. Status: ${project.status}.`,
        `Tasks: ${done}/${tasks.length} complete, ${overdue} overdue.`,
        `Milestones: ${milestonesDone}/${project.milestones.length} complete.`,
        `Budget vs revenue: ${project.budget.toLocaleString()} / ${project.revenue.toLocaleString()} ${project.currency}.`,
      ].join(' ');
      return res.json({ success: true, data: { reply, items: { project, tasks } } });
    }
    default:
      return res.json({
        success: true,
        data: {
          reply:
            "I can help with: today's tasks, overdue tasks, certifications expiring, projects at risk, a client summary (pass clientId), contracts expiring, opportunities likely to close, training recommendations, or a project status report (pass projectId).",
          items: null,
        },
      });
  }
});

export const meetingNotesToTasks = asyncHandler(async (req: Request, res: Response) => {
  const { Meeting: MeetingModel } = { Meeting };
  const meeting = await MeetingModel.findOne({ _id: req.params.meetingId, organizationId: req.user!.organizationId });
  if (!meeting) throw ApiError.notFound('Meeting not found');

  const created = [];
  for (const item of meeting.actionItems) {
    if (item.convertedTaskId) continue;
    const task = await Task.create({
      organizationId: req.user!.organizationId,
      title: item.description,
      ownerId: item.assigneeId || req.user!.id,
      dueDate: item.dueDate,
      status: 'open',
      priority: 'medium',
      tags: ['from-meeting', String(meeting._id)],
    });
    item.convertedTaskId = task._id as any;
    created.push(task);
  }
  await meeting.save();
  res.json({ success: true, data: { created, reply: `Created ${created.length} task(s) from this meeting's action items.` } });
});

export const riskFromOverdueMilestones = asyncHandler(async (req: Request, res: Response) => {
  // Manually-triggerable version of the automation job (see jobs/automationJobs.ts) for demo/testing.
  const projects = await Project.find({ organizationId: req.user!.organizationId, 'milestones.status': { $ne: 'completed' } });
  const createdRisks = [];
  for (const project of projects) {
    for (const milestone of project.milestones as any) {
      if (milestone.status !== 'completed' && milestone.dueDate && milestone.dueDate < new Date()) {
        const exists = await Risk.findOne({ organizationId: req.user!.organizationId, relatedProjectId: project._id, title: `Overdue milestone: ${milestone.title}` });
        if (!exists) {
          const risk = await Risk.create({
            organizationId: req.user!.organizationId,
            title: `Overdue milestone: ${milestone.title}`,
            category: 'project',
            relatedProjectId: project._id,
            ownerId: project.projectManagerId,
            severity: 'high',
            impact: 'medium',
            autoGenerated: true,
          });
          createdRisks.push(risk);
        }
      }
    }
  }
  res.json({ success: true, data: { createdRisks, reply: `Created ${createdRisks.length} risk record(s) from overdue milestones.` } });
});
