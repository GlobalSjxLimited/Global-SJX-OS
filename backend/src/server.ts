import { createApp } from './app';
import { connectDB } from './config/db';
import { env } from './config/env';
import { startAutomationEngine } from './jobs/automationJobs';
import { Organization } from './models/Organization';
import { ensureSecurityControls } from './services/securityControls.seed';
import { ensureAnnexA } from './services/isms/soa.service';
import { ensureGovernanceDefaults } from './services/governance.seed';
import { runMigrations } from './services/migrations.service';
import { logger } from './utils/logger';

async function main() {
  await connectDB();
  // Make sure the security-controls register exists (idempotent; never overwrites edits).
  await runMigrations();
  const internalOrg = await Organization.findOne({ isInternal: true });
  if (internalOrg) {
    await ensureSecurityControls(String(internalOrg._id));
    await ensureAnnexA(String(internalOrg._id)).catch(() => undefined);
    await ensureGovernanceDefaults(String(internalOrg._id));
  }
  const app = createApp();
  startAutomationEngine();

  app.listen(env.port, () => {
    logger.info({ port: env.port, env: env.nodeEnv }, 'GLOBAL SJX OS API listening');
  });
}

main().catch((err) => {
  logger.error({ err }, 'fatal startup error');
  process.exit(1);
});
