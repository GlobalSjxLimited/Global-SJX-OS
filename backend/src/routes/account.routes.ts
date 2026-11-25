import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { ApiError } from '../utils/ApiError';
import { User } from '../models/User';
import { UserSession, nextNumber } from '../models/Access';
import { Certification } from '../models/Certification';
import { Enrollment } from '../models/Enrollment';
import { Notification } from '../models/Notification';
import { ActivityLog } from '../models/ActivityLog';
import { ExpenseClaim } from '../models/Expense';
import { PolicyAcknowledgement, DataSubjectRequest } from '../models/Governance';
import { audit } from '../services/audit.service';
import { notify } from '../services/notify.service';
import { usersWithModule } from '../services/access.service';
import { Asset } from '../models/Asset';

const router = Router();
router.use(requireAuth);

/* ------------------------------ Sessions & devices ------------------------- */
router.get('/sessions', asyncHandler(async (req, res) => {
  const rows = await UserSession.find({ userId: req.user!.id, isActive: true, expiresAt: { $gt: new Date() } }).sort('-lastSeenAt').select('device browser ip lastSeenAt createdAt');
  res.json({ success: true, data: rows.map((r) => ({ ...r.toObject(), current: String(r._id) === req.user!.sessionId })) });
}));

router.delete('/sessions/:id', asyncHandler(async (req, res) => {
  const s = await UserSession.findOneAndUpdate({ _id: req.params.id, userId: req.user!.id, isActive: true }, { isActive: false, terminatedAt: new Date(), terminationReason: 'Ended by user' });
  if (!s) throw ApiError.notFound('Session not found');
  await audit(req, 'auth.session_revoked', 'UserSession', String(s._id), { module: 'security', summary: `Device ${s.device || ''} signed out` });
  res.json({ success: true, data: { id: s._id } });
}));

router.post('/sessions/revoke-others', asyncHandler(async (req, res) => {
  const r = await UserSession.updateMany({ userId: req.user!.id, isActive: true, _id: { $ne: req.user!.sessionId } }, { isActive: false, terminatedAt: new Date(), terminationReason: 'Signed out of other devices' });
  await audit(req, 'auth.sessions_revoked', 'User', req.user!.id, { module: 'security', severity: 'high', summary: `${r.modifiedCount} other session(s) ended` });
  res.json({ success: true, data: { ended: r.modifiedCount } });
}));

router.patch('/security-prefs', asyncHandler(async (req, res) => {
  const b = req.body || {};
  const user = await User.findById(req.user!.id);
  if (!user) throw ApiError.notFound('User not found');
  user.securityPrefs = user.securityPrefs || ({} as any);
  if (typeof b.loginNotifications === 'boolean') user.securityPrefs!.loginNotifications = b.loginNotifications;
  if (typeof b.suspiciousActivityAlerts === 'boolean') user.securityPrefs!.suspiciousActivityAlerts = b.suspiciousActivityAlerts;
  if (b.sessionTimeoutMinutes !== undefined) {
    const m = Number(b.sessionTimeoutMinutes);
    if (!Number.isFinite(m) || m < 5 || m > 480) throw ApiError.badRequest('Session timeout must be between 5 and 480 minutes.');
    user.securityPrefs!.sessionTimeoutMinutes = Math.round(m);
  }
  await user.save();
  await audit(req, 'auth.security_prefs_changed', 'User', req.user!.id, { module: 'security', summary: 'Security preferences updated' });
  res.json({ success: true, data: user.securityPrefs });
}));

router.get('/my-activity', asyncHandler(async (req, res) => {
  const rows = await ActivityLog.find({ organizationId: req.user!.organizationId, actorId: req.user!.id, action: { $regex: /^auth\./ } }).sort('-createdAt').limit(30).select('action summary status ip createdAt');
  res.json({ success: true, data: rows });
}));

/* -------------------------- Data protection: own data ---------------------- */
// Right of access / portability (NDPA & GDPR): everything we hold about the signed-in user, as JSON.
router.get('/export', asyncHandler(async (req, res) => {
  const uid = req.user!.id;
  const [user, certs, enrol, notes, acks, claims, assets, activity, sessions] = await Promise.all([
    User.findById(uid).select('-passwordHash -passwordHistory -mfaSecret -mfaPendingSecret -tokenVersion').lean(),
    Certification.find({ employeeId: uid }).lean(),
    Enrollment.find({ userId: uid }).populate('courseId', 'title').lean(),
    Notification.find({ userId: uid }).sort('-createdAt').limit(500).lean(),
    PolicyAcknowledgement.find({ userId: uid }).lean(),
    ExpenseClaim.find({ submittedById: uid }).select('claimNo title status totals createdAt items.description items.amount items.category').lean(),
    Asset.find({ assignedToId: uid }).select('assetId title category').lean(),
    ActivityLog.find({ actorId: uid }).sort('-createdAt').limit(1000).select('action summary ip createdAt').lean(),
    UserSession.find({ userId: uid }).select('device browser ip createdAt terminatedAt').lean(),
  ]);
  await audit(req, 'privacy.data_exported', 'User', uid, { module: 'security', severity: 'high', summary: 'Personal data export downloaded' });
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename=my-data-${new Date().toISOString().slice(0, 10)}.json`);
  res.send(JSON.stringify({ exportedAt: new Date().toISOString(), note: 'Bank account numbers are encrypted at rest and are not included in self-service exports.', profile: user, certifications: certs, trainings: enrol, notifications: notes, policyAcknowledgements: acks, expenseClaims: claims, assignedAssets: assets, activity, sessions }, null, 2));
}));

// Right to erasure: never deletes immediately (legal retention of tax/audit records) — it opens a tracked DSAR for the DPO.
router.post('/erasure-request', asyncHandler(async (req, res) => {
  const user = await User.findById(req.user!.id).select('name email');
  const open = await DataSubjectRequest.findOne({ organizationId: req.user!.organizationId, userId: req.user!.id, type: 'erasure', status: { $nin: ['completed', 'rejected'] } });
  if (open) throw ApiError.conflict(`You already have an open request (${open.reference}).`);
  const dsr = await DataSubjectRequest.create({
    organizationId: req.user!.organizationId, reference: await nextNumber(req.user!.organizationId, 'DSR', { yearly: true, pad: 4 }), type: 'erasure',
    requester: { name: user!.name, email: user!.email, relationship: 'employee' }, userId: req.user!.id, details: String(req.body?.reason || '').slice(0, 1000), source: 'self_service', identityVerified: true,
    dueAt: new Date(Date.now() + 30 * 86400000), timeline: [{ at: new Date(), byId: req.user!.id, byName: user!.name, text: 'Submitted by the data subject from their account (identity verified by sign-in)' }],
  });
  await audit(req, 'privacy.erasure_requested', 'DataSubjectRequest', String(dsr._id), { module: 'data_protection', severity: 'high', summary: dsr.reference });
  const dpo = await usersWithModule(req.user!.organizationId, 'data_protection');
  await notify({ organizationId: req.user!.organizationId, userIds: dpo.map((u) => String(u._id)), title: `Erasure request ${dsr.reference}`, body: `${user!.name} asked for their data to be erased. Respond within 30 days.`, link: '/privacy', type: 'dsar', severity: 'high', email: {} });
  res.status(201).json({ success: true, data: { reference: dsr.reference, dueAt: dsr.dueAt } });
}));

export default router;
