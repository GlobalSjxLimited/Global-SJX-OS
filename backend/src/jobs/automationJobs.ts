import { PROJECT_RUNNING } from '../config/projectStatus';
import cron from 'node-cron';
import { Certification } from '../models/Certification';
import { Client } from '../models/Client';
import { Project } from '../models/Project';
import { Task } from '../models/Task';
import { Risk } from '../models/Risk';
import { Notification } from '../models/Notification';
import { Organization } from '../models/Organization';
import { User } from '../models/User';
import { sendMail, certificationExpiryEmail, contractExpiryEmail } from '../services/email.service';
import { logger } from '../utils/logger';
import { runAllReminders } from '../services/reminders.service';
import { runDueSchedules } from '../services/reportDelivery.service';
import { runRecordingReminders } from '../services/meeting.service';
import { pollImapOnce } from '../services/emailIntake.service';
import { runTaskEscalations } from '../services/taskWorkflow.service';
import { runAccessReviewJobs } from '../services/accessCadence.service';
import { runOffboardingJobs } from '../services/offboarding.service';
import { runThreatIntelJobs } from '../services/threatIntel.service';
import { RULES, runScheduled } from '../services/isms/automation';

async function notifyUser(organizationId: string, userId: string, title: string, body: string, link?: string, type = 'automation') {
  await Notification.create({ organizationId, userId, title, body, link, type });
}

/** Certification expires in 60 days -> create renewal task + notify employee/manager (in-app + email). */
async function runCertificationExpiryCheck() {
  const in60Days = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);
  const soonToExpire = await Certification.find({ expiryDate: { $lte: in60Days, $gte: new Date() }, status: { $ne: 'expiring_soon' } });

  for (const cert of soonToExpire) {
    cert.status = 'expiring_soon';
    await cert.save();

    const existingTask = await Task.findOne({ organizationId: cert.organizationId, tags: `cert-renewal-${cert._id}` });
    if (!existingTask) {
      await Task.create({
        organizationId: cert.organizationId,
        title: `Renew certification: ${cert.name}`,
        ownerId: cert.employeeId,
        priority: 'high',
        status: 'open',
        dueDate: cert.expiryDate,
        tags: ['auto-generated', `cert-renewal-${cert._id}`],
      });
    }
    await notifyUser(String(cert.organizationId), String(cert.employeeId), 'Certification expiring soon', `${cert.name} expires on ${cert.expiryDate?.toDateString()}.`, '/certifications', 'certification');

    const employee = await User.findById(cert.employeeId).select('name email');
    if (employee?.email && cert.expiryDate) {
      const email = certificationExpiryEmail(employee.name, cert.name, cert.expiryDate);
      await sendMail({ to: employee.email, ...email }).catch((err) => logger.warn({ err }, 'certification expiry email failed'));
    }
  }

  // Mark hard-expired certifications.
  await Certification.updateMany({ expiryDate: { $lt: new Date() }, status: { $ne: 'expired' } }, { status: 'expired' });
}

/** Contract expires in 90 days -> notify account manager + COO, flag for renewal (in-app + email). */
async function runContractExpiryCheck() {
  const in90Days = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
  const clients = await Client.find({ 'contracts.endDate': { $lte: in90Days, $gte: new Date() }, 'contracts.status': 'active' });

  for (const client of clients) {
    const expiring = client.contracts.filter((c: any) => c.status === 'active' && c.endDate && c.endDate <= in90Days && c.endDate >= new Date());
    for (const contract of expiring) {
      if (client.accountOwnerId) {
        await notifyUser(String(client.organizationId), String(client.accountOwnerId), 'Contract renewal due', `${contract.title} for ${client.name} expires ${contract.endDate?.toDateString()}.`, `/clients/${client._id}`, 'contract');

        const owner = await User.findById(client.accountOwnerId).select('name email');
        if (owner?.email && contract.endDate) {
          const email = contractExpiryEmail(client.name, contract.title as string, contract.endDate as Date);
          await sendMail({ to: owner.email, ...email }).catch((err) => logger.warn({ err }, 'contract expiry email failed'));
        }
      }
    }
  }
}

/** Project milestone becomes overdue -> notify PM + create project risk. */
async function runOverdueMilestoneCheck() {
  const projects = await Project.find({ status: { $in: PROJECT_RUNNING } });
  for (const project of projects) {
    for (const milestone of project.milestones as any) {
      if (!['completed', 'overdue', 'awaiting_approval'].includes(milestone.status) && (milestone.endDate || milestone.dueDate) && (milestone.endDate || milestone.dueDate) < new Date()) {
        milestone.status = 'overdue';
        const existingRisk = await Risk.findOne({ organizationId: project.organizationId, relatedProjectId: project._id, title: `Overdue milestone: ${milestone.title}` });
        if (!existingRisk) {
          await Risk.create({
            organizationId: project.organizationId,
            title: `Overdue milestone: ${milestone.title}`,
            category: 'project',
            relatedProjectId: project._id,
            ownerId: project.projectManagerId,
            severity: 'high',
            impact: 'medium',
            autoGenerated: true,
          });
        }
        await notifyUser(String(project.organizationId), String(project.projectManagerId), 'Milestone overdue', `${milestone.title} on ${project.name} is overdue.`, `/projects/${project._id}`, 'project');
      }
    }
    await project.save();
  }
}

/** Client has no activity for 60 days -> flag relationship as requiring attention. */
async function runStaleClientCheck() {
  const cutoff = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
  const staleClients = await Client.find({ status: 'active', lastActivityAt: { $lt: cutoff } });
  for (const client of staleClients) {
    if (client.accountOwnerId) {
      await notifyUser(String(client.organizationId), String(client.accountOwnerId), 'Client relationship needs attention', `${client.name} has had no recorded activity in over 60 days.`, `/clients/${client._id}`, 'system');
    }
  }
}

async function runAllChecks() {
  const orgs = await Organization.find({ isActive: true });
  if (!orgs.length) return;
  await Promise.all([runCertificationExpiryCheck(), runContractExpiryCheck(), runOverdueMilestoneCheck(), runStaleClientCheck()]);
  logger.info('automation checks completed');
}

/** Registers the daily automation cron job. Call once from server.ts after DB connects. */
export function startAutomationEngine(): void {
  // Runs once daily at 02:00 server time. Also exposed for manual trigger via /api/ai/automation/*.
  cron.schedule('0 2 * * *', () => {
    runAllChecks().catch((err) => logger.error({ err }, 'automation job failed'));
  });
  // Reminders, audit sealing/verification and the Monday digest: every morning at 06:30 Lagos time.
  cron.schedule('30 6 * * *', () => {
    runAllReminders().catch((err) => logger.error({ err }, 'reminder run failed'));
  }, { timezone: 'Africa/Lagos' });
  // Offboarding: revoke access on the last working day, remind leavers, escalate unreturned assets (06:45 Lagos).
  cron.schedule('45 6 * * *', () => {
    runOffboardingJobs().catch((err) => logger.error({ err }, 'offboarding job failed'));
    runTaskEscalations().catch((err) => logger.error({ err }, 'task escalation job failed'));
    runAccessReviewJobs().catch((err) => logger.error({ err }, 'access review cadence job failed'));
  }, { timezone: 'Africa/Lagos' });
  // Threat intelligence: expire indicators, collect from automatic feeds, flag stale sources (every morning 05:30 Lagos).
  cron.schedule('30 5 * * *', () => {
    runThreatIntelJobs().catch((err) => logger.error({ err }, 'threat intelligence job failed'));
  }, { timezone: 'Africa/Lagos' });
  // ISMS automation rules (registers, audits, metrics, evidence packs). Each rule has its own cron expression (see RULES).
  for (const rule of RULES) {
    cron.schedule(rule.cron, () => { runScheduled([rule.key]).catch((err) => logger.error({ err, rule: rule.key }, 'isms rule failed')); }, { timezone: 'Africa/Lagos' });
  }
  // Scheduled reports are checked hourly so they land close to their due time.
  cron.schedule('5 * * * *', () => {
    runDueSchedules().catch((err) => logger.error({ err }, 'scheduled reports failed'));
  });
  // Meeting-recording reminders (5 minutes before, then daily from the next day until uploaded or cancelled). Cheap and idempotent.
  cron.schedule('*/2 * * * *', () => {
    runRecordingReminders().catch((err) => logger.error({ err }, 'recording reminders failed'));
  });
  // Optional: pull the intake mailbox when IMAP is configured (see .env.example).
  if (process.env.INTAKE_IMAP_HOST) {
    cron.schedule('*/2 * * * *', () => {
      (process.env.INTAKE_IMAP_ORG_ID ? Organization.findById(process.env.INTAKE_IMAP_ORG_ID) : Organization.findOne({ isInternal: true })).select('_id').then((org) => (org ? pollImapOnce(String(org._id)) : 0)).catch((err) => logger.error({ err }, 'intake mailbox poll failed'));
    });
  }
  logger.info('automation engine scheduled (checks 02:00 · reminders 06:30 Lagos · report schedules hourly · meeting recording reminders every 2 min)');
}

export const automationChecks = {
  runCertificationExpiryCheck,
  runContractExpiryCheck,
  runOverdueMilestoneCheck,
  runStaleClientCheck,
  runAllChecks,
};
