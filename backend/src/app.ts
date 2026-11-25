import goalsRoutes from './routes/goals.routes';
import risksRoutes from './routes/risks.routes';
import workReportsRoutes from './routes/workReports.routes';
import intakeRoutes from './routes/intake.routes';
import express, { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import pinoHttp from 'pino-http';
import rateLimit from 'express-rate-limit';
import { env } from './config/env';
import { logger } from './utils/logger';
import { notFoundHandler, errorHandler } from './middleware/errorHandler';

import authRoutes from './routes/auth.routes';
import usersRoutes from './routes/users.routes';
import { requestContext } from './utils/requestContext';
import discussionRoutes from './routes/discussions.routes';
import entityDocumentRoutes from './routes/entityDocuments.routes';
import notificationPrefRoutes from './routes/notificationPrefs.routes';
import tasksRoutes from './routes/tasks.routes';
import projectsRoutes from './routes/projects.routes';
import clientsRoutes from './routes/clients.routes';
import opportunitiesRoutes from './routes/opportunities.routes';
import ideasRoutes from './routes/ideas.routes';
import dashboardRoutes from './routes/dashboard.routes';
import aiRoutes from './routes/ai.routes';
import meetingsRoutes from './routes/meetings.routes';
import searchRoutes from './routes/search.routes';
import notificationsRoutes from './routes/notifications.routes';
import knowledgeRoutes from './routes/knowledge.routes';
import automationRoutes from './routes/automation.routes';
import uploadsRoutes from './routes/uploads.routes';
import offboardingRoutes from './routes/offboarding.routes';
import threatIntelRoutes from './routes/threatIntel.routes';
import hubRoutes from './routes/hub.routes';
import academyRoutes from './routes/academy.routes';
import enrollmentsRoutes from './routes/enrollments.routes';
import courseContentRoutes from './routes/courseContent.routes';
import groupsRoutes from './routes/groups.routes';
import ticketsRoutes from './routes/tickets.routes';
import securityRoutes from './routes/security.routes';
import accessRoutes from './routes/access.routes';
import accountRoutes from './routes/account.routes';
import auditRoutes from './routes/audit.routes';
import expensesRoutes from './routes/expenses.routes';
import assetsRoutes from './routes/assets.routes';
import assetRiskRoutes from './routes/assetRisk.routes';
import evidenceRoutes from './routes/evidence.routes';
import publicDsarRoutes from './routes/publicDsar.routes';
import supplierRoutes from './routes/supplier.routes';
import publicSupplierRoutes from './routes/publicSupplier.routes';
import { staff as signatureRoutes, pub as publicSignatureRoutes } from './routes/signature.routes';
import importRoutes from './routes/import.routes';
import visitorsRoutes from './routes/visitors.routes';
import publicVisitRoutes from './routes/publicVisit.routes';
import { auditorAdminRouter, auditorPublicRouter } from './routes/auditorAccess.routes';
import remindersRoutes from './routes/reminders.routes';
import reportingRoutes from './routes/reporting.routes';
import { bankAccountsRouter, invoicesRouter, taxesRouter, ratesRouter } from './routes/finance.routes';
import controlsRoutes from './routes/controls.routes';
import { incidentsRouter, dsarRouter, ropaRouter, policiesRouter, obligationsRouter } from './routes/governance.routes';
import { requireModule } from './middleware/modules';
import consentRoutes from './routes/consent.routes';
import certUpdatesRoutes from './routes/certUpdates.routes';
import { requestId, sanitizeInput, sanitizeMarkup, noStoreApi } from './middleware/security';
import {
  vendorsRouter,
  sponsorsRouter,
  documentsRouter,
  certificationsRouter,
  coursesRouter,
  skillsRouter,
  employeeSkillsRouter,
  leadsRouter,
  reportsRouter,
  complianceRouter,
} from './routes/generic.routes';
import { campaignsRouter, socialQueueRouter } from './routes/campaigns.routes';
import ismsRoutes from './routes/isms.routes';
import awarenessRoutes, { publicPhishRouter } from './routes/awareness.routes';
import { servePublicMedia } from './controllers/campaigns.controller';
import { storage } from './services/storage.service';

export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  // Behind a reverse proxy (nginx / load balancer) so rate limiting and audit logs see the real client IP.
  if (env.isHardened) app.set('trust proxy', 1);

  app.use(requestId);
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'default-src': ["'none'"],
          'frame-ancestors': ["'none'"],
          'base-uri': ["'none'"],
          'form-action': ["'none'"],
        },
      },
      hsts: env.isHardened ? { maxAge: 31536000, includeSubDomains: true, preload: true } : false,
      referrerPolicy: { policy: 'no-referrer' },
      crossOriginResourcePolicy: { policy: 'same-site' },
    })
  );
  const allowed = new Set(env.clientOrigins);
  app.use(
    cors({
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      origin: (origin, cb) => {
        // Non-browser clients (curl, server-to-server, health checks) send no Origin header.
        if (!origin || allowed.has(origin)) return cb(null, true);
        // The public contact form and consent endpoint may be called from the marketing site.
        cb(null, false);
      },
    })
  );
  app.use(compression());
  app.use(requestContext);
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: false, limit: '200kb' }));
  app.use(sanitizeInput);
  app.use('/api', noStoreApi);
  app.use('/api', sanitizeMarkup);
  if (env.nodeEnv !== 'test') {
    app.use(
      pinoHttp({
        logger,
        autoLogging: { ignore: (req) => req.url === '/health' },
        customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
      })
    );
  }

  const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 600, standardHeaders: true, legacyHeaders: false });
  app.use('/api', apiLimiter);

  // Brute-force protection: login/register/MFA-challenge get a much tighter
  // limit than general API traffic, keyed to survive the general limiter
  // above (this one applies in addition, not instead of it).
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Too many attempts. Please wait a few minutes and try again.' },
  });
  app.use('/api/auth/login', authLimiter);
  app.use('/api/auth/register', authLimiter);
  app.use('/api/auth/mfa/challenge', authLimiter);

  app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'gsjx-os-backend', time: new Date().toISOString() }));

  // Short-lived, signed picture links so Facebook/Instagram can fetch an approved campaign image at the moment of posting (no sign-in; the signature is the key).
  app.get('/api/public-media/:org/:file', servePublicMedia(storage.uploadsRoot));

  app.use('/api/auth', authRoutes);
  app.use('/api/employees', usersRoutes);
  app.use('/api/tasks', tasksRoutes);
  app.use('/api/projects', projectsRoutes);
  app.use('/api/clients', requireModule('clients'), clientsRoutes);
  app.use('/api/opportunities', requireModule('sales'), opportunitiesRoutes);
  app.use('/api/ideas', ideasRoutes);
  app.use('/api/dashboard', dashboardRoutes);
  app.use('/api/ai', aiRoutes);
  app.use('/api/meetings', meetingsRoutes);
  app.use('/api/search', searchRoutes);
  app.use('/api/notifications', notificationsRoutes);
  app.use('/api/knowledge', knowledgeRoutes);
  app.use('/api/automation', automationRoutes);
  app.use('/api/public/phish', publicPhishRouter);
  app.use('/api/public/dsar', publicDsarRoutes);
  app.use('/api/import', importRoutes);
  app.use('/api/public/sign', publicSignatureRoutes);
  app.use('/api/signatures', signatureRoutes);
  app.use('/api/public/supplier', publicSupplierRoutes);
  app.use('/api/supplier-assessments', supplierRoutes);
  app.use('/api/public/visit', publicVisitRoutes);
  app.use('/api/visitors', visitorsRoutes);
  app.use('/api/public/auditor', auditorPublicRouter);
  app.use('/api/auditor-access', auditorAdminRouter);
  app.use('/api/awareness', awarenessRoutes);
  app.use('/api/isms', ismsRoutes);
  app.use('/api/uploads', uploadsRoutes);
  app.use('/api/offboarding', offboardingRoutes);
  app.use('/api/discussions', discussionRoutes);
  app.use('/api/entity-documents', entityDocumentRoutes);
  app.use('/api/notification-prefs', notificationPrefRoutes);
  app.use('/api/threat-intel', threatIntelRoutes);
  app.use('/api/hub', hubRoutes);
  app.use('/api/academy', academyRoutes);

  app.use('/api/vendors', requireModule('vendors'), vendorsRouter);
  app.use('/api/sponsors', requireModule('sponsors'), sponsorsRouter);
  app.use('/api/documents', documentsRouter);
  app.use('/api/certifications', certUpdatesRoutes);
  app.use('/api/certifications', certificationsRouter);
  app.use('/api/courses', courseContentRoutes);
  app.use('/api/courses', coursesRouter);
  app.use('/api/enrollments', enrollmentsRoutes);
  app.use('/api/skills', skillsRouter);
  app.use('/api/employee-skills', employeeSkillsRouter);
  app.use('/api/goals', requireModule('goals'), goalsRoutes);
  app.use('/api/campaigns', requireModule('marketing'), campaignsRouter);
  app.use('/api/social-queue', socialQueueRouter);
  app.use('/api/leads', requireModule('marketing'), leadsRouter);
  app.use('/api/reports', requireModule('reports'), reportsRouter);
  app.use('/api/risks', requireModule('risks'), risksRoutes);
  app.use('/api/compliance', requireModule('compliance'), complianceRouter);
  app.use('/api/tickets', ticketsRoutes);
  app.use('/api/security', securityRoutes);
  app.use('/api/consent', consentRoutes);
  app.use('/api/groups', groupsRoutes);

  // ---- Modules added when the legacy finance/ISMS app was absorbed ----
  app.use('/api/access', accessRoutes);
  app.use('/api/account', accountRoutes);
  app.use('/api/audit', auditRoutes);
  app.use('/api/expenses', expensesRoutes);
  app.use('/api/bank-accounts', bankAccountsRouter);
  app.use('/api/invoices', invoicesRouter);
  app.use('/api/taxes', taxesRouter);
  app.use('/api/rates', ratesRouter);
  app.use('/api/asset-risk', assetRiskRoutes);
  app.use('/api/evidence', evidenceRoutes);
  app.use('/api/assets', assetsRoutes);
  app.use('/api/incidents', incidentsRouter);
  app.use('/api/dsar', dsarRouter);
  app.use('/api/ropa', ropaRouter);
  app.use('/api/policies', policiesRouter);
  app.use('/api/obligations', obligationsRouter);
  app.use('/api/reporting', reportingRoutes);
  app.use('/api/reminders', remindersRoutes);
  app.use('/api/controls', controlsRoutes);
  app.use('/api/work-reports', workReportsRoutes);
  // The intake router authenticates its webhook by secret and gates its admin API by module inside the router.
  app.use('/api/intake', intakeRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
