import { PROJECT_RUNNING } from '../config/projectStatus';
import { Request, Response } from 'express';
import { Types } from 'mongoose';
import { asyncHandler } from '../utils/asyncHandler';
import { Task } from '../models/Task';
import { Project } from '../models/Project';
import { Client } from '../models/Client';
import { Opportunity } from '../models/Opportunity';
import { Certification } from '../models/Certification';
import { Goal } from '../models/Goal';
import { Risk } from '../models/Risk';
import { Meeting } from '../models/Meeting';
import { Enrollment } from '../models/Enrollment';
import { User } from '../models/User';
import { LEADERSHIP_ROLES } from '../config/roles';
import { OPEN_FILTER } from '../config/taskStatus';

/** Widgets every employee sees, regardless of role. */
async function buildEmployeeWidgets(orgId: string, userId: string) {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfToday = new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000);
  const next7Days = new Date(startOfToday.getTime() + 7 * 24 * 60 * 60 * 1000);

  const [todayTasks, overdueTasks, upcomingTasks, activeProjects, upcomingMeetings, enrollments, myGoals] = await Promise.all([
    Task.find({ organizationId: orgId, ownerId: userId, dueDate: { $gte: startOfToday, $lt: endOfToday } }).sort('priority'),
    Task.find({ organizationId: orgId, $or: [{ ownerId: userId }, { coOwnerIds: userId }], dueDate: { $lt: startOfToday }, status: OPEN_FILTER }).sort('dueDate'),
    Task.find({ organizationId: orgId, $or: [{ ownerId: userId }, { coOwnerIds: userId }], dueDate: { $gte: endOfToday, $lt: next7Days }, status: OPEN_FILTER }).sort('dueDate'),
    Project.find({ organizationId: orgId, team: userId, status: 'active' }).limit(6),
    Meeting.find({ organizationId: orgId, participants: userId, date: { $gte: now }, status: 'scheduled' }).sort('date').limit(5),
    Enrollment.find({ organizationId: orgId, userId }).populate('courseId').limit(5),
    Goal.find({ organizationId: orgId, level: 'employee', ownerId: userId }),
  ]);

  const certifications = await Certification.find({ organizationId: orgId, employeeId: userId }).sort('expiryDate');

  return {
    todayTasks,
    overdueTasks,
    upcomingTasks,
    activeProjects,
    upcomingMeetings,
    myEnrollments: enrollments,
    certifications,
    goals: myGoals,
  };
}

async function buildCeoWidgets(orgId: string) {
  const orgObjectId = new Types.ObjectId(orgId);
  const [pipelineAgg, wonAgg, activeProjects, allProjects, clientCount, certExpiring, riskCount, companyGoals] = await Promise.all([
    Opportunity.aggregate([
      { $match: { organizationId: orgObjectId, stage: { $nin: ['Won', 'Lost'] } } },
      { $group: { _id: null, total: { $sum: '$value' }, count: { $sum: 1 } } },
    ]),
    Opportunity.aggregate([
      { $match: { organizationId: orgObjectId, stage: 'Won' } },
      { $group: { _id: null, total: { $sum: '$value' }, count: { $sum: 1 } } },
    ]),
    Project.countDocuments({ organizationId: orgId, status: 'active' }),
    Project.find({ organizationId: orgId }).select('revenue budget status health'),
    Client.countDocuments({ organizationId: orgId, status: 'active' }),
    Certification.countDocuments({ organizationId: orgId, expiryDate: { $lte: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000) } }),
    Risk.countDocuments({ organizationId: orgId, status: { $ne: 'closed' } }),
    Goal.find({ organizationId: orgId, level: 'company' }),
  ]);

  const revenue = allProjects.reduce((sum, p: any) => sum + (p.revenue || 0), 0);
  const budget = allProjects.reduce((sum, p: any) => sum + (p.budget || 0), 0);
  const atRisk = allProjects.filter((p: any) => p.health !== 'on_track').length;

  return {
    pipelineValue: pipelineAgg[0]?.total || 0,
    pipelineCount: pipelineAgg[0]?.count || 0,
    wonRevenue: wonAgg[0]?.total || 0,
    wonCount: wonAgg[0]?.count || 0,
    activeProjects,
    totalProjectRevenue: revenue,
    totalProjectBudget: budget,
    projectsAtRisk: atRisk,
    activeClients: clientCount,
    certificationsExpiringSoon: certExpiring,
    openRisks: riskCount,
    companyGoals,
  };
}

async function buildCooWidgets(orgId: string) {
  const [openTasks, overdueTasks, projects, certExpiring, coursesUpcoming, vendors, risks] = await Promise.all([
    Task.countDocuments({ organizationId: orgId, status: OPEN_FILTER }),
    Task.countDocuments({ organizationId: orgId, status: OPEN_FILTER, dueDate: { $lt: new Date() } }),
    Project.find({ organizationId: orgId, status: { $in: PROJECT_RUNNING } }).select('name health status endDate'),
    Certification.find({ organizationId: orgId, expiryDate: { $lte: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000) } }).populate('employeeId', 'name'),
    Enrollment.countDocuments({ organizationId: orgId, status: { $in: ['enrolled', 'in_progress'] } }),
    User.countDocuments({}), // placeholder metric; replace with Vendor.countDocuments in real deployment
    Risk.find({ organizationId: orgId, status: { $ne: 'closed' } }).limit(8),
  ]);

  return { openTasks, overdueTasks, projects, certExpiring, coursesUpcoming, vendorSignal: vendors, risks };
}

async function buildSalesWidgets(orgId: string, userId: string, role: string) {
  const filter: Record<string, unknown> = { organizationId: orgId };
  if (role === 'sales') filter.salespersonId = userId;

  const [byStage, opportunities] = await Promise.all([
    Opportunity.aggregate([
      { $match: filter as any },
      { $group: { _id: '$stage', count: { $sum: 1 }, value: { $sum: '$value' } } },
    ]),
    Opportunity.find(filter).sort('-expectedCloseDate').limit(10).populate('clientId', 'name'),
  ]);

  const won = byStage.find((s) => s._id === 'Won');
  const lost = byStage.find((s) => s._id === 'Lost');
  const total = won && lost ? won.count + lost.count : 0;
  const winRate = total ? Math.round(((won?.count || 0) / total) * 100) : 0;

  return { byStage, opportunities, winRate };
}

export const getDashboard = asyncHandler(async (req: Request, res: Response) => {
  const orgId = req.user!.organizationId;
  const userId = req.user!.id;
  const role = req.user!.role;

  const employee = await buildEmployeeWidgets(orgId, userId);

  const payload: Record<string, unknown> = { employee, role };

  if (LEADERSHIP_ROLES.includes(role as any)) {
    payload.ceo = await buildCeoWidgets(orgId);
  }
  if (role === 'coo' || role === 'super_admin') {
    payload.coo = await buildCooWidgets(orgId);
  }
  if (role === 'sales' || role === 'ceo' || role === 'super_admin') {
    payload.sales = await buildSalesWidgets(orgId, userId, role);
  }
  if (role === 'project_manager' || role === 'super_admin') {
    const myProjects = await Project.find({ organizationId: orgId, projectManagerId: userId });
    payload.projectManager = { myProjects };
  }

  res.json({ success: true, data: payload });
});
