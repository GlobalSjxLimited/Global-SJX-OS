import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { hasModule } from '../middleware/modules';
import { asyncHandler } from '../utils/asyncHandler';
import { ApiError } from '../utils/ApiError';
import { audit } from '../services/audit.service';
import { Asset } from '../models/Asset';
import * as assetRisk from '../services/assetRisk.service';

/**
 * Threats and risks of an asset. Separate from /api/assets so that an asset's owner, custodian or holder can see and act on
 * the risks of what they look after even if their role has no access to the asset inventory itself.
 */
const router = Router();
router.use(requireAuth);

const isTeam = (req: any) => hasModule(req, 'isms') || hasModule(req, 'risks') || hasModule(req, 'assets');
const isKeeper = (req: any, a: any) => [a.ownerUser, a.custodianUser, a.assignedToId].filter(Boolean).map(String).includes(String(req.user.id));
async function load(req: any) {
  const a: any = await Asset.findOne({ _id: req.params.id, organizationId: req.user.organizationId });
  if (!a) throw ApiError.notFound('Asset not found');
  if (!isTeam(req) && !isKeeper(req, a)) throw ApiError.forbidden('You can only see the risks of assets you own, look after or hold.');
  return a;
}
const canManage = (req: any, a: any) => hasModule(req, 'isms') || hasModule(req, 'risks') || [a.ownerUser, a.custodianUser].filter(Boolean).map(String).includes(String(req.user.id));
const org = (req: any) => String(req.user.organizationId);

router.post('/backfill', asyncHandler(async (req, res) => {
  if (!hasModule(req, 'isms') && !hasModule(req, 'risks')) throw ApiError.forbidden('Only the ISMS team can evaluate the whole inventory.');
  const r = await assetRisk.evaluateAll(org(req), { reason: 'inventory backfill', force: !!req.body?.force });
  const sent = await assetRisk.notifyBulk(org(req), r, 'Inventory evaluated', `backfill:${Date.now()}`);
  await audit(req, 'asset.risk_backfill', 'Asset', 'all', { module: 'isms', severity: 'medium', summary: `${r.created} risks created from ${r.evaluated} assets` });
  const { perOwner, ...rest } = r;
  res.json({ success: true, data: { ...rest, owners: perOwner.size, notified: sent } });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const a = await load(req);
  res.json({ success: true, data: { ...(await assetRisk.profile(org(req), String(a._id))), canManage: canManage(req, a) } });
}));

router.post('/:id/evaluate', asyncHandler(async (req, res) => {
  const a = await load(req);
  if (!canManage(req, a)) throw ApiError.forbidden('Only the asset owner or the ISMS team can re-evaluate risks.');
  const r = await assetRisk.applyAsset(org(req), a, { reason: 'manual re-evaluation', notify: true, force: true });
  await audit(req, 'asset.risk_evaluated', 'Asset', String(a._id), { module: 'isms', summary: `${a.assetId}: ${r.created.length} created, ${r.rescored.length} re-scored` });
  res.json({ success: true, data: r });
}));

router.post('/:id/accept', asyncHandler(async (req, res) => {
  const a = await load(req);
  if (!canManage(req, a)) throw ApiError.forbidden('Only the asset owner or the ISMS team can add risks.');
  const rec = await assetRisk.acceptSuggestion(org(req), String(a._id), String(req.body?.key || ''), { id: req.user!.id, name: req.user!.name });
  await audit(req, 'asset.risk_accepted', 'Asset', String(a._id), { module: 'isms', summary: `${a.assetId} → ${rec.refNo}` });
  res.status(201).json({ success: true, data: rec });
}));

router.post('/:id/dismiss', asyncHandler(async (req, res) => {
  const a = await load(req);
  if (!canManage(req, a)) throw ApiError.forbidden('Only the asset owner or the ISMS team can mark a threat as not applicable.');
  await assetRisk.dismissThreat(org(req), String(a._id), String(req.body?.key || ''), String(req.body?.reason || ''), { id: req.user!.id, name: req.user!.name });
  await audit(req, 'asset.risk_dismissed', 'Asset', String(a._id), { module: 'isms', summary: `${a.assetId}: ${req.body?.key} not applicable – ${req.body?.reason}` });
  res.json({ success: true, data: { ok: true } });
}));

export default router;
