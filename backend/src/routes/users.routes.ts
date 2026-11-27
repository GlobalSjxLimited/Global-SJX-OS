import { Router, Request } from 'express';
import { Offboarding } from '../models/Offboarding';
import { revokeAccess, startOffboarding } from '../services/offboarding.service';
import bcrypt from 'bcryptjs';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { requireModule, hasModule } from '../middleware/modules';
import { asyncHandler } from '../utils/asyncHandler';
import { ApiError } from '../utils/ApiError';
import { User } from '../models/User';
import { Certification } from '../models/Certification';
import { Enrollment } from '../models/Enrollment';
import { UserSession } from '../models/Access';
import { ActivityLog } from '../models/ActivityLog';
import { escapeRegex } from '../utils/escapeRegex';
import { stripProtected, passwordProblems } from '../middleware/security';
import { excludeDeleted } from '../utils/softDeletePlugin';
import { encryptField, decryptField, last4, generatePassword } from '../utils/crypto';
import { MODULE_KEYS, ALWAYS_ON, ADMIN_ONLY_MODULES, ADMIN_ONLY_ROLES } from '../config/modules';
import { effectiveModules } from '../services/access.service';
import { audit } from '../services/audit.service';
import { sendMail } from '../services/email.service';
import { logger } from '../utils/logger';
import { renderEmail, kvTable, callout, esc } from '../services/mail.templates';
import { env } from '../config/env';

const router = Router();
router.use(requireAuth);

const PRIVILEGED = ['super_admin', 'ceo'];
const HR_ROLES = ['hr', 'coo', 'ceo', 'super_admin'] as const;
const SAFE_SELECT = '-passwordHash -passwordHistory -tokenVersion -failedLoginCount -lockUntil -lastLoginIp -mfaSecret -mfaPendingSecret';
const PROTECTED_FIELDS = [
  'passwordHash', 'passwordHistory', 'tokenVersion', 'failedLoginCount', 'lockUntil', 'mfaEnabled', 'mfaSecret', 'mfaPendingSecret',
  'passwordChangedAt', 'lastLoginAt', 'lastLoginIp', 'securityAcknowledgedAt', 'credentialsIssuedAt', 'credentialsIssuedById',
  'loginEnabled', 'mustChangePassword', 'moduleGrant', 'moduleDeny', 'role', 'bankAccount', 'offboardedAt',
];

function cleanModules(list: unknown, allowAdminOnly: boolean): string[] {
  if (!Array.isArray(list)) return [];
  return Array.from(new Set((list as string[]).filter((m) => MODULE_KEYS.includes(m) && !ALWAYS_ON.includes(m) && (allowAdminOnly || !ADMIN_ONLY_MODULES.includes(m)))));
}

/** Writes bank details with the account number encrypted; only last4 is stored in clear. */
function applyBank(user: any, bank: any) {
  if (!bank || typeof bank !== 'object') return;
  user.bankAccount = user.bankAccount || {};
  if (bank.bankName !== undefined) user.bankAccount.bankName = String(bank.bankName).slice(0, 120);
  if (bank.accountName !== undefined) user.bankAccount.accountName = String(bank.accountName).slice(0, 120);
  if (bank.accountNumber) {
    const digits = String(bank.accountNumber).replace(/\s+/g, '');
    if (!/^[A-Za-z0-9]{6,34}$/.test(digits)) throw ApiError.badRequest('Account number looks invalid (6–34 letters/digits).');
    user.bankAccount.accountNumberEnc = encryptField(digits);
    user.bankAccount.accountLast4 = last4(digits);
  }
}

async function sendCredentialsEmail(user: any, password: string, createdBy: string, reason: 'new' | 'reset') {
  const body =
    kvTable([
      ['Sign-in address', `${env.appUrl}/login`],
      ['Email', user.email],
      ['Temporary password', password],
    ]) + callout('You will be asked to choose a new password the first time you sign in. Never share this password — Global SJX staff will never ask for it.', 'warn');
  const { html, attachments } = renderEmail({
    title: reason === 'new' ? 'Your Global SJX OS account' : 'Your password was reset',
    intro: `Hello ${esc(user.name)}, ${reason === 'new' ? `${esc(createdBy)} created your sign-in for Global SJX OS.` : `${esc(createdBy)} reset your password.`}`,
    body,
    cta: { label: 'Sign in', path: '/login' },
  });
  // A mail failure must never lose the temporary password or turn a saved account into a 500: report "not delivered" so the caller shows the password once.
  try {
    const r = await sendMail({ to: user.email, subject: reason === 'new' ? 'Your Global SJX OS account' : 'Your Global SJX OS password was reset', html, attachments });
    logger.info({ to: user.email, delivered: r.delivered, reason }, 'credentials e-mail handed to the mail server (this is not proof of inbox delivery)');
    return r;
  } catch (err) {
    logger.error({ err, to: user.email, reason }, 'credentials e-mail FAILED to send');
    return { delivered: false };
  }
}

/* --------------------------------- List ------------------------------------ */
router.get('/', asyncHandler(async (req, res) => {
  const { q, department, role, status, page = '1', limit = '20' } = req.query as Record<string, string>;
  let filter: Record<string, unknown> = { organizationId: req.user!.organizationId };
  if (department) filter.department = department;
  if (role) filter.role = role;
  if (status === 'no_login') filter.loginEnabled = false;
  else if (status) filter.employmentStatus = status;
  if (q) filter.name = { $regex: escapeRegex(q), $options: 'i' };
  filter = excludeDeleted(filter);
  const pageNum = Math.max(parseInt(page, 10) || 1, 1);
  const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
  const [items, total] = await Promise.all([
    User.find(filter).select(SAFE_SELECT).sort('name').skip((pageNum - 1) * limitNum).limit(limitNum),
    User.countDocuments(filter),
  ]);
  res.json({ success: true, data: items, pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) } });
}));

/* ------------------------------ Lightweight picker -------------------------- */
// Used by the expense form's "bought by" selector — names only, no personal data.
router.get('/directory/list', asyncHandler(async (req, res) => {
  const data = await User.find(excludeDeleted({ organizationId: req.user!.organizationId, isActive: true, role: { $nin: ['client', 'vendor', 'training_customer'] } })).select('name jobTitle department').sort('name');
  res.json({ success: true, data });
}));

/* -------------------------------- Onboard ----------------------------------- */
router.post('/', requireRole('hr', 'coo', 'ceo', 'super_admin'), asyncHandler(async (req, res) => {
  const b = req.body || {};
  const { name, email, role = 'employee', jobTitle, department, managerId } = b;
  if (!name || !email) throw ApiError.badRequest('name and email are required');
  if (await User.findOne({ email: String(email).toLowerCase().trim() })) throw ApiError.conflict('A user with this email already exists');
  if (PRIVILEGED.includes(role) && !PRIVILEGED.includes(req.user!.role)) throw ApiError.forbidden('Only the CEO or an administrator can create this role.');

  // Step 1 of the onboarding wizard: should this person get a sign-in at all?
  const createLogin = b.createLogin === true || b.createLogin === 'true';
  let plain = '';
  let showOnce: string | undefined;
  if (createLogin) {
    if (b.password) {
      const problems = passwordProblems(String(b.password));
      if (problems.length) throw ApiError.badRequest(`Password must contain ${problems.join(', ')}.`);
      plain = String(b.password);
    } else plain = generatePassword(16);
  } else plain = generatePassword(32); // unusable — the record exists but nobody knows this value

  const allowAdmin = ADMIN_ONLY_ROLES.includes(role as any) || req.user!.role === 'super_admin';
  const user: any = new User({
    organizationId: req.user!.organizationId,
    name, email, role, jobTitle, department, managerId: managerId || undefined,
    phone: b.phone, address: b.address, workLocation: b.workLocation, employmentType: b.employmentType || 'full_time',
    employeeNo: b.employeeNo, dateJoined: b.dateJoined ? new Date(b.dateJoined) : new Date(), dateOfBirth: b.dateOfBirth ? new Date(b.dateOfBirth) : undefined,
    emergencyContact: b.emergencyContact,
    passwordHash: await bcrypt.hash(plain, 12),
    loginEnabled: createLogin,
    mustChangePassword: createLogin,
    credentialsIssuedAt: createLogin ? new Date() : undefined,
    credentialsIssuedById: createLogin ? req.user!.id : undefined,
    moduleGrant: cleanModules(b.moduleGrant, allowAdmin),
    moduleDeny: cleanModules(b.moduleDeny, true),
    passwordChangedAt: createLogin ? undefined : new Date(),
  });
  applyBank(user, b.bankAccount);
  await user.save();

  // Certifications captured during onboarding
  const certs = Array.isArray(b.certifications) ? b.certifications.filter((c: any) => c?.name && c?.provider && c?.dateObtained).slice(0, 25) : [];
  for (const c of certs) {
    await Certification.create({ organizationId: req.user!.organizationId, employeeId: user._id, name: c.name, provider: c.provider, dateObtained: new Date(c.dateObtained), expiryDate: c.expiryDate ? new Date(c.expiryDate) : undefined, renewalRequired: c.renewalRequired !== false });
  }

  let emailed = false;
  if (createLogin) {
    if (b.delivery === 'show') showOnce = plain;
    else emailed = (await sendCredentialsEmail(user, plain, req.user!.name, 'new')).delivered;
    // If email isn't configured, show the password once so the account is never stranded.
    if (!emailed && !showOnce) showOnce = plain;
  }
  await audit(req, 'employee.created', 'User', String(user._id), { module: 'employees', severity: createLogin ? 'high' : 'info', summary: `Employee ${user.name} created (${role}, login ${createLogin ? 'enabled' : 'not created'})`, meta: { role, createLogin, certifications: certs.length } });

  const safe = user.toObject();
  delete safe.passwordHash; delete safe.passwordHistory;
  if (safe.bankAccount) delete safe.bankAccount.accountNumberEnc;
  res.status(201).json({ success: true, data: safe, credentials: createLogin ? { emailed, temporaryPassword: showOnce, mustChangePassword: true, note: showOnce ? 'Shown once only — copy it now and share it securely.' : undefined } : undefined });
}));

/* ------------------------------- Profile (aggregate) ------------------------ */
router.get('/:id/profile', asyncHandler(async (req, res) => {
  const isSelf = req.params.id === req.user!.id;
  const hr = hasModule(req, 'employees');
  if (!isSelf && !hr) throw ApiError.forbidden('You cannot view this profile.');
  const user = await User.findOne({ _id: req.params.id, organizationId: req.user!.organizationId }).select(SAFE_SELECT).populate('managerId', 'name jobTitle').populate('skills');
  if (!user) throw ApiError.notFound('Employee not found');
  const [certifications, enrollments, sessions, activity] = await Promise.all([
    Certification.find({ organizationId: req.user!.organizationId, employeeId: user._id }).sort('-dateObtained'),
    Enrollment.find({ organizationId: req.user!.organizationId, userId: user._id }).populate('courseId', 'title category').sort('-updatedAt'),
    isSelf || hasModule(req, 'security') ? UserSession.find({ userId: user._id, isActive: true }).select('device browser ip lastSeenAt createdAt').sort('-lastSeenAt') : [],
    hasModule(req, 'audit_log') ? ActivityLog.find({ organizationId: req.user!.organizationId, actorId: user._id }).sort('-createdAt').limit(15).select('action summary severity createdAt ip') : [],
  ]);
  const now = Date.now();
  const certSummary = {
    total: certifications.length,
    expired: certifications.filter((c) => c.expiryDate && c.expiryDate.getTime() < now).length,
    expiring30: certifications.filter((c) => c.expiryDate && c.expiryDate.getTime() >= now && c.expiryDate.getTime() < now + 30 * 86400000).length,
  };
  const obj: any = user.toObject();
  // Account information is shown masked unless the viewer is the owner or holds employee_sensitive.
  if (obj.bankAccount) obj.bankAccount = { bankName: obj.bankAccount.bankName, accountName: obj.bankAccount.accountName, accountMasked: obj.bankAccount.accountLast4 ? `••••••${obj.bankAccount.accountLast4}` : undefined, hasAccountNumber: !!obj.bankAccount.accountLast4 };
  const mods = hr ? await effectiveModules({ role: user.role, organizationId: String(user.organizationId), moduleGrant: user.moduleGrant as string[], moduleDeny: user.moduleDeny as string[] }) : undefined;
  res.json({ success: true, data: { employee: obj, certifications, certSummary, trainings: enrollments, sessions, activity, modules: mods, canRevealAccount: isSelf || hasModule(req, 'employee_sensitive') } });
}));

/** Reveal the full account number — always audited. */
router.post('/:id/reveal-account', asyncHandler(async (req, res) => {
  const isSelf = req.params.id === req.user!.id;
  if (!isSelf && !hasModule(req, 'employee_sensitive')) throw ApiError.forbidden('You are not allowed to view account numbers.');
  const user = await User.findOne({ _id: req.params.id, organizationId: req.user!.organizationId }).select('name bankAccount');
  if (!user?.bankAccount?.accountNumberEnc) throw ApiError.notFound('No account number on file');
  await audit(req, 'employee.account_revealed', 'User', String(user._id), { module: 'employee_sensitive', severity: isSelf ? 'info' : 'high', summary: `${req.user!.name} viewed the bank account of ${user.name}` });
  res.json({ success: true, data: { bankName: user.bankAccount.bankName, accountName: user.bankAccount.accountName, accountNumber: decryptField(user.bankAccount.accountNumberEnc) } });
}));

/** Employees update their own payment details; HR can too. */
router.put('/:id/bank-account', asyncHandler(async (req, res) => {
  const isSelf = req.params.id === req.user!.id;
  if (!isSelf && !hasModule(req, 'employee_sensitive')) throw ApiError.forbidden('You cannot change these details.');
  const user: any = await User.findOne({ _id: req.params.id, organizationId: req.user!.organizationId }).select('+bankAccount.accountNumberEnc name');
  if (!user) throw ApiError.notFound('Employee not found');
  applyBank(user, req.body);
  await user.save();
  await audit(req, 'employee.account_changed', 'User', String(user._id), { module: 'employee_sensitive', severity: 'high', summary: `Bank details updated for ${user.name}` });
  res.json({ success: true, data: { bankName: user.bankAccount.bankName, accountName: user.bankAccount.accountName, accountMasked: `••••••${user.bankAccount.accountLast4}` } });
}));

/* ----------------------------- Credentials management ----------------------- */
async function targetForCredentials(req: Request) {
  const target: any = await User.findOne({ _id: req.params.id, organizationId: req.user!.organizationId }).select('+passwordHash +passwordHistory');
  if (!target) throw ApiError.notFound('Employee not found');
  if (target.id === req.user!.id) throw ApiError.forbidden('Use Settings → Security to manage your own password.');
  if (PRIVILEGED.includes(target.role) && !PRIVILEGED.includes(req.user!.role)) throw ApiError.forbidden('Only the CEO or an administrator can manage this user.');
  return target;
}

/** Create a login for an employee who was onboarded without one. */
router.post('/:id/credentials', requireRole(...HR_ROLES), asyncHandler(async (req, res) => {
  const target = await targetForCredentials(req);
  if (target.loginEnabled) throw ApiError.conflict('This employee already has a login. Use reset password instead.');
  if (req.body.role && req.body.role !== target.role) {
    if (PRIVILEGED.includes(req.body.role) && !PRIVILEGED.includes(req.user!.role)) throw ApiError.forbidden('Only the CEO or an administrator can grant this role.');
    target.role = req.body.role;
  }
  if (req.body.moduleGrant !== undefined) target.moduleGrant = cleanModules(req.body.moduleGrant, ADMIN_ONLY_ROLES.includes(target.role) || req.user!.role === 'super_admin');
  if (req.body.moduleDeny !== undefined) target.moduleDeny = cleanModules(req.body.moduleDeny, true);
  const plain = generatePassword(16);
  target.passwordHash = await bcrypt.hash(plain, 12);
  target.loginEnabled = true;
  target.isActive = true;
  target.mustChangePassword = true;
  target.credentialsIssuedAt = new Date();
  target.credentialsIssuedById = req.user!.id;
  target.tokenVersion = (target.tokenVersion || 0) + 1;
  await target.save();
  const emailed = req.body.delivery === 'show' ? false : (await sendCredentialsEmail(target, plain, req.user!.name, 'new')).delivered;
  await audit(req, 'employee.credentials_created', 'User', String(target._id), { module: 'employees', severity: 'high', summary: `Login created for ${target.name}` });
  res.json({ success: true, data: { emailed, temporaryPassword: emailed ? undefined : plain, mustChangePassword: true } });
}));

router.post('/:id/reset-password', requireRole(...HR_ROLES), asyncHandler(async (req, res) => {
  const target = await targetForCredentials(req);
  if (!target.loginEnabled) throw ApiError.badRequest('This employee has no login yet. Create credentials first.');
  const plain = generatePassword(16);
  target.passwordHash = await bcrypt.hash(plain, 12);
  target.mustChangePassword = true;
  target.failedLoginCount = 0;
  target.lockUntil = undefined;
  target.tokenVersion = (target.tokenVersion || 0) + 1;
  await target.save();
  await UserSession.updateMany({ userId: target._id, isActive: true }, { isActive: false, terminatedAt: new Date(), terminationReason: 'Password reset by administrator' });
  const emailed = req.body.delivery === 'show' ? false : (await sendCredentialsEmail(target, plain, req.user!.name, 'reset')).delivered;
  await audit(req, 'employee.password_reset', 'User', String(target._id), { module: 'employees', severity: 'high', summary: `Password reset for ${target.name}` });
  res.json({ success: true, data: { emailed, temporaryPassword: emailed ? undefined : plain, mustChangePassword: true } });
}));

router.post('/:id/revoke-access', requireRole(...HR_ROLES), asyncHandler(async (req, res) => {
  const target = await targetForCredentials(req);
  target.loginEnabled = false;
  target.tokenVersion = (target.tokenVersion || 0) + 1;
  await target.save();
  await UserSession.updateMany({ userId: target._id, isActive: true }, { isActive: false, terminatedAt: new Date(), terminationReason: 'Access revoked' });
  await audit(req, 'employee.access_revoked', 'User', String(target._id), { module: 'employees', severity: 'high', summary: `Login revoked for ${target.name}` });
  res.json({ success: true, data: { id: target._id, loginEnabled: false } });
}));

/* ---------------------------------- Detail ---------------------------------- */
/**
 * Department heads. People named here receive "to be reviewed" tasks, delayed-task escalations and marketing/other approvals for their department.
 * A department can have more than one head. HR, COO, CEO and admin can change it.
 */
router.get('/department-heads/list', asyncHandler(async (req, res) => {
  const departments: string[] = (User.schema.path('department') as any).enumValues || [];
  const people: any[] = await User.find(excludeDeleted({ organizationId: req.user!.organizationId, isActive: true })).select('name jobTitle department headOfDepartments role').sort('name').lean();
  const rows = departments.map((name) => ({
    department: name,
    heads: people.filter((u) => (u.headOfDepartments || []).includes(name)).map((u) => ({ _id: String(u._id), name: u.name, jobTitle: u.jobTitle })),
    members: people.filter((u) => u.department === name).length,
  }));
  res.json({ success: true, data: { departments: rows, people: people.filter((u) => !['client', 'vendor', 'training_customer'].includes(u.role)).map((u) => ({ _id: String(u._id), name: u.name, department: u.department, jobTitle: u.jobTitle })), canEdit: (HR_ROLES as readonly string[]).includes(req.user!.role) } });
}));

router.put('/department-heads/:department', requireRole(...HR_ROLES), asyncHandler(async (req, res) => {
  const departments: string[] = (User.schema.path('department') as any).enumValues || [];
  const department = decodeURIComponent(req.params.department);
  if (!departments.includes(department)) throw ApiError.badRequest('Unknown department');
  const ids: string[] = Array.isArray(req.body?.userIds) ? Array.from(new Set(req.body.userIds.map(String))) as string[] : [];
  if (ids.length > 6) throw ApiError.badRequest('A department can have up to 6 heads');
  if (ids.some((x) => !/^[a-f\d]{24}$/i.test(x))) throw ApiError.badRequest('Invalid person');
  const org = req.user!.organizationId;
  const chosen: any[] = await User.find(excludeDeleted({ _id: { $in: ids }, organizationId: org, isActive: true })).select('name headOfDepartments');
  if (chosen.length !== ids.length) throw ApiError.badRequest('Every head must be an active person in your organisation');
  const current: any[] = await User.find(excludeDeleted({ organizationId: org, headOfDepartments: department })).select('name headOfDepartments');
  // load → change → save per person (the database layer behind this app has no positional array updates)
  for (const u of current) if (!ids.includes(String(u._id))) { u.headOfDepartments = (u.headOfDepartments || []).filter((d: string) => d !== department); await u.save(); }
  for (const u of chosen) if (!(u.headOfDepartments || []).includes(department)) { u.headOfDepartments = [...(u.headOfDepartments || []), department]; await u.save(); }
  await audit(req, 'department.heads_changed', 'User', ids[0] || department, { module: 'users', severity: 'medium', summary: `${department} heads: ${chosen.map((u) => u.name).join(', ') || 'none'}` });
  res.json({ success: true, data: { department, heads: chosen.map((u) => ({ _id: String(u._id), name: u.name })) } });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const user = await User.findOne({ _id: req.params.id, organizationId: req.user!.organizationId }).select(SAFE_SELECT).populate('managerId', 'name jobTitle').populate('skills');
  if (!user) throw ApiError.notFound('Employee not found');
  const obj: any = user.toObject();
  if (obj.bankAccount) obj.bankAccount = { bankName: obj.bankAccount.bankName, accountName: obj.bankAccount.accountName, accountMasked: obj.bankAccount.accountLast4 ? `••••••${obj.bankAccount.accountLast4}` : undefined };
  res.json({ success: true, data: obj });
}));

/* ---------------------------------- Update ---------------------------------- */
router.patch('/:id', requireRole(...HR_ROLES), asyncHandler(async (req, res) => {
  const updates: any = stripProtected(req.body, PROTECTED_FIELDS);
  delete updates.password;
  const target: any = await User.findOne({ _id: req.params.id, organizationId: req.user!.organizationId });
  if (!target) throw ApiError.notFound('Employee not found');
  if (PRIVILEGED.includes(target.role) && !PRIVILEGED.includes(req.user!.role)) throw ApiError.forbidden('Only the CEO or an administrator can change this user.');

  const role = req.body.role;
  let revoke = updates.isActive === false;
  if (role !== undefined && role !== target.role) {
    if (req.params.id === req.user!.id) throw ApiError.forbidden('You cannot change your own role.');
    if (PRIVILEGED.includes(role) && !PRIVILEGED.includes(req.user!.role)) throw ApiError.forbidden('Only the CEO or an administrator can grant this role.');
    updates.role = role;
    revoke = true;
  }
  if (req.body.moduleGrant !== undefined || req.body.moduleDeny !== undefined) {
    if (!hasModule(req, 'access_control')) throw ApiError.forbidden('Changing module access requires the Access Control module.');
    const finalRole = updates.role || target.role;
    if (req.body.moduleGrant !== undefined) updates.moduleGrant = cleanModules(req.body.moduleGrant, ADMIN_ONLY_ROLES.includes(finalRole) || req.user!.role === 'super_admin');
    if (req.body.moduleDeny !== undefined) updates.moduleDeny = cleanModules(req.body.moduleDeny, true);
  }
  if (req.body.bankAccount) {
    if (!hasModule(req, 'employee_sensitive')) throw ApiError.forbidden('Changing bank details requires the Sensitive Employee Data module.');
    const full: any = await User.findById(target._id).select('+bankAccount.accountNumberEnc');
    applyBank(full, req.body.bankAccount);
    await full.save();
  }
  Object.assign(target, updates);
  if (revoke) target.tokenVersion = (target.tokenVersion || 0) + 1;
  await target.save();
  if (revoke) await UserSession.updateMany({ userId: target._id, isActive: true }, { isActive: false, terminatedAt: new Date(), terminationReason: 'Account or role changed' });
  await audit(req, 'employee.updated', 'User', String(target._id), { module: 'employees', severity: role ? 'high' : 'info', summary: `Employee ${target.name} updated`, meta: { fields: Object.keys(updates) } });
  const safe: any = (await User.findById(target._id).select(SAFE_SELECT))!.toObject();
  if (safe.bankAccount) delete safe.bankAccount.accountNumberEnc;
  res.json({ success: true, data: safe });
}));

/* -------------------------------- Offboard ---------------------------------- */
/**
 * "Offboard now": opens a Return of Asset case (so every asset, task and responsibility the person holds is listed
 * and has to be reclaimed or handed over) and revokes access immediately. For a planned exit with a notice period use
 * POST /api/offboarding with a last working day instead.
 */
router.delete('/:id', requireRole('hr', 'ceo', 'super_admin'), asyncHandler(async (req, res) => {
  if (req.params.id === req.user!.id) throw ApiError.forbidden('You cannot offboard yourself.');
  const target = await User.findOne({ _id: req.params.id, organizationId: req.user!.organizationId });
  if (!target) throw ApiError.notFound('Employee not found');
  if (PRIVILEGED.includes(target.role) && !PRIVILEGED.includes(req.user!.role)) throw ApiError.forbidden('Only the CEO or an administrator can offboard this user.');
  const by = { id: req.user!.id, name: req.user!.name, role: req.user!.role };
  let c: any = await Offboarding.findOne({ organizationId: req.user!.organizationId, employeeId: target._id, status: 'open' });
  if (c) {
    if (!c.access?.revokedAt) { await revokeAccess(c, by, 'immediate'); await c.save(); }
  } else {
    c = await startOffboarding({ organizationId: req.user!.organizationId, employeeId: String(target._id), by, lastWorkingDay: new Date(), type: 'other', reason: String(req.body?.reason || '').slice(0, 300) || undefined, immediate: true });
  }
  await audit(req, 'employee.offboarded', 'User', String(target._id), { module: 'employees', severity: 'high', summary: `${target.name} offboarded — login revoked, sessions ended, ${c.items.length} item(s) to reclaim or hand over (${c.reference})` });
  res.json({ success: true, data: { id: req.params.id, deactivated: true, offboardingId: c._id, reference: c.reference, items: c.items.length } });
}));

export default router;
