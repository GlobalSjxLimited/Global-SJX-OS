import dotenv from 'dotenv';

dotenv.config();

/**
 * Environment separation (ISO 27001:2022 A.8.31)
 * ----------------------------------------------
 * APP_ENV names the *deployment* environment (development | test | staging |
 * production) and is deliberately separate from NODE_ENV (which build tools
 * use). Each environment must use its own database, secrets and origins; the
 * guards below make a mis-configured production/staging process refuse to
 * start instead of silently running with development defaults.
 */
export type AppEnv = 'development' | 'test' | 'staging' | 'production';

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const rawNodeEnv = process.env.NODE_ENV || 'development';
const rawAppEnv = (process.env.APP_ENV || (rawNodeEnv === 'production' ? 'production' : rawNodeEnv)) as AppEnv;
const appEnv: AppEnv = (['development', 'test', 'staging', 'production'] as const).includes(rawAppEnv) ? rawAppEnv : 'development';
const isHardened = appEnv === 'production' || appEnv === 'staging';

const DEV_JWT = 'dev-only-insecure-secret-change-me';
const jwtSecret = required('JWT_SECRET', DEV_JWT);
const mongoUri = required('MONGO_URI', 'mongodb://127.0.0.1:27017/gsjx_os');
const clientOrigins = (process.env.CLIENT_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function dbNameFromUri(uri: string): string {
  const m = uri.match(/^mongodb(?:\+srv)?:\/\/[^/]+\/([^?]*)/);
  return (m && m[1]) || '';
}

export const startupProblems: string[] = [];
if (isHardened) {
  if (jwtSecret === DEV_JWT || jwtSecret.length < 32 || /replace-this/i.test(jwtSecret)) {
    startupProblems.push('JWT_SECRET must be a random string of at least 32 characters in staging/production.');
  }
  if (clientOrigins.some((o) => o === '*' || /localhost|127\.0\.0\.1/.test(o))) {
    startupProblems.push('CLIENT_ORIGIN must be an explicit, non-localhost HTTPS origin list in staging/production.');
  }
  if (!process.env.MONGO_URI) startupProblems.push('MONGO_URI must be set explicitly in staging/production.');
  const dbName = dbNameFromUri(mongoUri);
  if (appEnv === 'production' && /(dev|test|staging)/i.test(dbName)) {
    startupProblems.push(`Production must not use a dev/test/staging database (found "${dbName}").`);
  }
  if (appEnv === 'staging' && /prod/i.test(dbName) && !/non-?prod/i.test(dbName)) {
    startupProblems.push(`Staging must not point at a production database (found "${dbName}").`);
  }
  if ((process.env.SEED_ADMIN_PASSWORD || 'ChangeMe123!') === 'ChangeMe123!' && process.env.ALLOW_SEED === 'true') {
    startupProblems.push('Refusing to seed with the default admin password.');
  }
}
// Field-level encryption key (bank account numbers, employee payment details). Data protection: A.8.24.
const DEV_DATA_KEY = 'dev-only-data-encryption-key-do-not-use-in-prod';
const dataEncryptionKey = process.env.DATA_ENCRYPTION_KEY || DEV_DATA_KEY;
if (isHardened && (dataEncryptionKey === DEV_DATA_KEY || dataEncryptionKey.length < 32)) {
  startupProblems.push('DATA_ENCRYPTION_KEY must be set to a random string of at least 32 characters in staging/production (it encrypts bank and payment details at rest).');
}
if (appEnv === 'production' && startupProblems.length) {
  // eslint-disable-next-line no-console
  console.error('\n[security] Refusing to start:\n - ' + startupProblems.join('\n - ') + '\n');
  process.exit(1);
}

export const env = {
  nodeEnv: rawNodeEnv,
  appEnv,
  isProduction: appEnv === 'production',
  isHardened,
  port: parseInt(process.env.PORT || '5000', 10),
  clientOrigin: clientOrigins[0],
  clientOrigins,
  mongoUri,
  dbName: dbNameFromUri(mongoUri),
  jwtSecret,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  seedAdminEmail: process.env.SEED_ADMIN_EMAIL || 'admin@globalsjxltd.com',
  seedAdminPassword: process.env.SEED_ADMIN_PASSWORD || 'ChangeMe123!',
  allowSeed: process.env.ALLOW_SEED === 'true',
  lockout: {
    maxAttempts: parseInt(process.env.LOCKOUT_MAX_ATTEMPTS || '5', 10),
    minutes: parseInt(process.env.LOCKOUT_MINUTES || '15', 10),
  },
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || 'Global SJX OS <no-reply@globalsjxltd.com>',
  },
  mfaIssuer: process.env.MFA_ISSUER || 'Global SJX OS',
  appUrl: (process.env.APP_URL || clientOrigins[0] || 'http://localhost:5173').replace(/\/$/, ''),
  /** Public address of this API, used for the short-lived picture links handed to Facebook/Instagram. Defaults to APP_URL (same address when /api is proxied). */
  publicApiUrl: (process.env.PUBLIC_API_URL || process.env.APP_URL || clientOrigins[0] || 'http://localhost:5055').replace(/\/$/, ''),
  dataEncryptionKey,
  // Finance controls
  fourEyes: process.env.FOUR_EYES !== 'false', // the person who creates an invoice / account cannot approve it
  invoiceTermsDays: parseInt(process.env.INVOICE_TERMS_DAYS || '14', 10),
  receiptRequiredAbove: parseFloat(process.env.EXPENSE_RECEIPT_REQUIRED_ABOVE || '5000'), // NGN-equivalent
  expenseEmailFullAccount: process.env.EXPENSE_EMAIL_FULL_ACCOUNT !== 'false', // full account number in the finance e-mail (set false to mask)
  // Session / password controls
  sessionIdleMinutes: parseInt(process.env.SESSION_IDLE_MINUTES || '60', 10),
  passwordMaxAgeDays: parseInt(process.env.PASSWORD_MAX_AGE_DAYS || '90', 10),
  dormantAccountDays: parseInt(process.env.DORMANT_ACCOUNT_DAYS || '90', 10),
};
