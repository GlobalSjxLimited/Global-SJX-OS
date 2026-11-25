import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { asyncHandler } from '../utils/asyncHandler';
import { ApiError } from '../utils/ApiError';
import { User } from '../models/User';
import { Organization } from '../models/Organization';
import { env } from '../config/env';
import { passwordProblems } from '../middleware/security';
import { signMfaChallengeToken, verifyMfaChallengeToken } from '../utils/token';
import { effectiveModules } from '../services/access.service';
import { issueSession, endSession } from '../services/session.service';
import { UserSession } from '../models/Access';
import { logActivity } from '../models/ActivityLog';
import { generateSecret, buildOtpAuthUrl, buildQrCodeDataUrl, verifyCode } from '../services/mfa.service';

const registerSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
  role: z.string().optional(),
  jobTitle: z.string().optional(),
  department: z.string().optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

async function publicUser(user: any) {
  const modules = await effectiveModules({ role: user.role, organizationId: String(user.organizationId), moduleGrant: user.moduleGrant, moduleDeny: user.moduleDeny });
  const ageDays = user.passwordChangedAt ? Math.floor((Date.now() - new Date(user.passwordChangedAt).getTime()) / 86400000) : 0;
  return {
    modules,
    mustChangePassword: !!user.mustChangePassword,
    passwordExpiresInDays: user.passwordChangedAt ? Math.max(env.passwordMaxAgeDays - ageDays, 0) : null,
    id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    avatarUrl: user.avatarUrl,
    jobTitle: user.jobTitle,
    department: user.department,
    organizationId: user.organizationId,
    mfaEnabled: user.mfaEnabled,
    securityAcknowledgedAt: user.securityAcknowledgedAt,
  };
}

export const register = asyncHandler(async (req: Request, res: Response) => {
  // Public self-registration is OFF unless explicitly enabled, and can never choose a role.
  if (process.env.ALLOW_SELF_REGISTRATION !== 'true') {
    throw ApiError.forbidden('Self-registration is disabled. Ask an administrator to invite you.');
  }
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) throw ApiError.badRequest('Invalid registration payload', parsed.error.flatten());
  const { name, email, password, jobTitle, department } = parsed.data;
  const pwProblems = passwordProblems(password);
  if (pwProblems.length) throw ApiError.badRequest(`Password must contain ${pwProblems.join(', ')}.`);

  const existing = await User.findOne({ email });
  if (existing) throw ApiError.conflict('An account with this email already exists');

  // For this seeded single-tenant deployment, new registrations join the primary org.
  const org = await Organization.findOne({ isInternal: true });
  if (!org) throw ApiError.badRequest('Organization not initialized — run the seed script first');

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await User.create({
    organizationId: org._id,
    name,
    email,
    passwordHash,
    role: 'employee',
    jobTitle,
    department,
    dateJoined: new Date(),
  });

  await logActivity({ organizationId: String(org._id), actorId: String(user._id), action: 'auth.register', entityType: 'User', entityId: String(user._id) });

  const token = await issueSession(req, user);
  res.status(201).json({ success: true, data: { token, user: await publicUser(user) } });
});

export const login = asyncHandler(async (req: Request, res: Response) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) throw ApiError.badRequest('Invalid login payload');
  const { email, password } = parsed.data;

  const user = await User.findOne({ email }).select('+passwordHash +mfaSecret');
  if (!user || !user.isActive || user.loginEnabled === false) throw ApiError.unauthorized('Invalid email or password');

  if (user.lockUntil && user.lockUntil.getTime() > Date.now()) {
    const mins = Math.ceil((user.lockUntil.getTime() - Date.now()) / 60000);
    throw new ApiError(423, `Account temporarily locked after repeated failed sign-ins. Try again in ${mins} minute(s).`);
  }

  const match = await bcrypt.compare(password, user.passwordHash);
  if (!match) {
    user.failedLoginCount = (user.failedLoginCount || 0) + 1;
    if (user.failedLoginCount >= env.lockout.maxAttempts) {
      user.lockUntil = new Date(Date.now() + env.lockout.minutes * 60000);
      user.failedLoginCount = 0;
      await logActivity({ organizationId: String(user.organizationId), actorId: String(user._id), action: 'auth.account_locked', entityType: 'User', entityId: String(user._id), meta: { ip: req.ip } });
    }
    await user.save();
    await logActivity({ organizationId: String(user.organizationId), actorId: String(user._id), action: 'auth.login_failed', entityType: 'User', entityId: String(user._id), meta: { ip: req.ip } });
    throw ApiError.unauthorized('Invalid email or password');
  }
  user.failedLoginCount = 0;
  user.lockUntil = undefined;

  if (user.mfaEnabled) {
    // Password is correct, but the session token isn't issued until the TOTP
    // code is verified — a compromised password alone can't complete login.
    const challengeToken = signMfaChallengeToken(String(user._id));
    return res.json({ success: true, data: { mfaRequired: true, challengeToken } });
  }

  // Password expiry policy (A.5.17): force a change once the password is older than PASSWORD_MAX_AGE_DAYS.
  if (user.passwordChangedAt && Date.now() - user.passwordChangedAt.getTime() > env.passwordMaxAgeDays * 86400000) user.mustChangePassword = true;
  user.lastLoginAt = new Date();
  user.lastLoginIp = req.ip;
  await user.save();

  await logActivity({ organizationId: String(user.organizationId), actorId: String(user._id), actorName: user.name, action: 'auth.login', entityType: 'User', entityId: String(user._id), ip: req.ip, userAgent: String(req.headers['user-agent'] || '').slice(0, 300), module: 'auth' });

  const token = await issueSession(req, user);
  res.json({ success: true, data: { token, user: await publicUser(user) } });
});

const mfaChallengeSchema = z.object({
  challengeToken: z.string(),
  code: z.string().min(6).max(6),
});

/** POST /auth/mfa/challenge — redeems a password-verified challenge token + TOTP code for a real session token. */
export const mfaChallenge = asyncHandler(async (req: Request, res: Response) => {
  const parsed = mfaChallengeSchema.safeParse(req.body);
  if (!parsed.success) throw ApiError.badRequest('challengeToken and a 6-digit code are required');

  let payload;
  try {
    payload = verifyMfaChallengeToken(parsed.data.challengeToken);
  } catch {
    throw ApiError.unauthorized('This login attempt has expired. Please sign in again.');
  }

  const user = await User.findById(payload.sub).select('+mfaSecret');
  if (!user || !user.isActive || user.loginEnabled === false || !user.mfaEnabled || !user.mfaSecret) throw ApiError.unauthorized('Invalid session');

  if (!verifyCode(parsed.data.code, user.mfaSecret)) throw ApiError.unauthorized('Incorrect authentication code');

  user.lastLoginAt = new Date();
  user.lastLoginIp = req.ip;
  await user.save();
  await logActivity({ organizationId: String(user.organizationId), actorId: String(user._id), actorName: user.name, action: 'auth.login_mfa', entityType: 'User', entityId: String(user._id), ip: req.ip, module: 'auth' });

  if (user.passwordChangedAt && Date.now() - user.passwordChangedAt.getTime() > env.passwordMaxAgeDays * 86400000 && !user.mustChangePassword) {
    user.mustChangePassword = true;
    await user.save();
  }
  const token = await issueSession(req, user);
  res.json({ success: true, data: { token, user: await publicUser(user) } });
});

/** POST /auth/mfa/setup — generates a pending secret + QR code. Not yet enabled until /mfa/verify confirms a code. */
export const mfaSetup = asyncHandler(async (req: Request, res: Response) => {
  const user = await User.findById(req.user!.id);
  if (!user) throw ApiError.notFound('User not found');
  if (user.mfaEnabled) throw ApiError.conflict('MFA is already enabled on this account');

  const secret = generateSecret();
  user.mfaPendingSecret = secret;
  await user.save();

  const otpAuthUrl = buildOtpAuthUrl(user.email, secret);
  const qrCodeDataUrl = await buildQrCodeDataUrl(otpAuthUrl);

  res.json({ success: true, data: { secret, otpAuthUrl, qrCodeDataUrl } });
});

const mfaVerifySchema = z.object({ code: z.string().min(6).max(6) });

/** POST /auth/mfa/verify — confirms the pending secret with a real code and turns MFA on. */
export const mfaVerify = asyncHandler(async (req: Request, res: Response) => {
  const parsed = mfaVerifySchema.safeParse(req.body);
  if (!parsed.success) throw ApiError.badRequest('A 6-digit code is required');

  const user = await User.findById(req.user!.id).select('+mfaPendingSecret');
  if (!user) throw ApiError.notFound('User not found');
  if (!user.mfaPendingSecret) throw ApiError.badRequest('No MFA setup in progress — call /auth/mfa/setup first');

  if (!verifyCode(parsed.data.code, user.mfaPendingSecret)) throw ApiError.unauthorized('Incorrect code — please try again');

  user.mfaSecret = user.mfaPendingSecret;
  user.mfaPendingSecret = undefined;
  user.mfaEnabled = true;
  await user.save();

  await logActivity({ organizationId: String(user.organizationId), actorId: String(user._id), action: 'auth.mfa_enabled', entityType: 'User', entityId: String(user._id) });
  res.json({ success: true, data: { mfaEnabled: true } });
});

const mfaDisableSchema = z.object({ code: z.string().min(6).max(6) });

/** POST /auth/mfa/disable — requires a valid current code, so a stolen session token alone can't turn MFA off. */
export const mfaDisable = asyncHandler(async (req: Request, res: Response) => {
  const parsed = mfaDisableSchema.safeParse(req.body);
  if (!parsed.success) throw ApiError.badRequest('A 6-digit code is required to disable MFA');

  const user = await User.findById(req.user!.id).select('+mfaSecret');
  if (!user || !user.mfaEnabled || !user.mfaSecret) throw ApiError.badRequest('MFA is not enabled on this account');

  if (!verifyCode(parsed.data.code, user.mfaSecret)) throw ApiError.unauthorized('Incorrect code');

  user.mfaEnabled = false;
  user.mfaSecret = undefined;
  await user.save();

  await logActivity({ organizationId: String(user.organizationId), actorId: String(user._id), action: 'auth.mfa_disabled', entityType: 'User', entityId: String(user._id) });
  res.json({ success: true, data: { mfaEnabled: false } });
});

export const me = asyncHandler(async (req: Request, res: Response) => {
  const user = await User.findById(req.user!.id);
  if (!user) throw ApiError.notFound('User not found');
  res.json({ success: true, data: await publicUser(user) });
});


/** POST /auth/revoke-sessions — signs out every device (including this one) by bumping the token version. */
export const revokeSessions = asyncHandler(async (req: Request, res: Response) => {
  const user = await User.findById(req.user!.id);
  if (!user) throw ApiError.unauthorized();
  user.tokenVersion = (user.tokenVersion || 0) + 1;
  await user.save();
  await UserSession.updateMany({ userId: user._id, isActive: true }, { isActive: false, terminatedAt: new Date(), terminationReason: 'Signed out all devices' });
  await logActivity({ organizationId: String(user.organizationId), actorId: String(user._id), actorName: user.name, action: 'auth.sessions_revoked', entityType: 'User', entityId: String(user._id), ip: req.ip, module: 'auth' });
  const token = await issueSession(req, user);
  res.json({ success: true, data: { token, message: 'All other sessions have been signed out.' } });
});

const changePasswordSchema = z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(12) });
const PASSWORD_HISTORY = 5;

/** POST /auth/change-password — enforces the password policy, revokes other sessions, returns a fresh token. */
export const changePassword = asyncHandler(async (req: Request, res: Response) => {
  const parsed = changePasswordSchema.safeParse(req.body);
  if (!parsed.success) throw ApiError.badRequest('New password must be at least 12 characters');
  const user = await User.findById(req.user!.id).select('+passwordHash +passwordHistory');
  if (!user) throw ApiError.unauthorized();
  if (!(await bcrypt.compare(parsed.data.currentPassword, user.passwordHash))) throw ApiError.unauthorized('Current password is incorrect');
  const problems = passwordProblems(parsed.data.newPassword);
  if (problems.length) throw ApiError.badRequest(`Password must contain ${problems.join(', ')}.`);
  if (await bcrypt.compare(parsed.data.newPassword, user.passwordHash)) throw ApiError.badRequest('New password must differ from the current one');
  // Password history (A.5.17): the last 5 passwords cannot be reused. Stored as bcrypt hashes only.
  const history: string[] = (user.passwordHistory as string[]) || [];
  for (const old of history) if (await bcrypt.compare(parsed.data.newPassword, old)) throw ApiError.badRequest('You have used this password recently. Choose one you have not used before.');
  history.unshift(user.passwordHash);
  user.passwordHistory = history.slice(0, PASSWORD_HISTORY);
  user.passwordHash = await bcrypt.hash(parsed.data.newPassword, 12);
  user.passwordChangedAt = new Date();
  user.mustChangePassword = false;
  user.tokenVersion = (user.tokenVersion || 0) + 1;
  await user.save();
  await UserSession.updateMany({ userId: user._id, isActive: true }, { isActive: false, terminatedAt: new Date(), terminationReason: 'Password changed' });
  await logActivity({ organizationId: String(user.organizationId), actorId: String(user._id), actorName: user.name, action: 'auth.password_changed', entityType: 'User', entityId: String(user._id), ip: req.ip, module: 'auth' });
  const token = await issueSession(req, user);
  res.json({ success: true, data: { token, user: await publicUser(user) } });
});

/** POST /auth/acknowledge-security-policy — records that the user has read and accepted the information security policy. */
export const acknowledgeSecurityPolicy = asyncHandler(async (req: Request, res: Response) => {
  await User.findByIdAndUpdate(req.user!.id, { securityAcknowledgedAt: new Date() });
  await logActivity({ organizationId: req.user!.organizationId, actorId: req.user!.id, action: 'security.policy_acknowledged', entityType: 'User', entityId: req.user!.id });
  res.json({ success: true, data: { acknowledgedAt: new Date() } });
});

/** POST /auth/logout — ends only the current device's session. */
export const logout = asyncHandler(async (req: Request, res: Response) => {
  await endSession(req.user!.sessionId, 'Signed out');
  await logActivity({ organizationId: req.user!.organizationId, actorId: req.user!.id, actorName: req.user!.name, action: 'auth.logout', entityType: 'User', entityId: req.user!.id, ip: req.ip, module: 'auth' });
  res.json({ success: true, data: { loggedOut: true } });
});
