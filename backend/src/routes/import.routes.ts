import { Router } from 'express';
import multer from 'multer';
import { requireModule } from '../middleware/modules';
import { asyncHandler } from '../utils/asyncHandler';
import { ApiError } from '../utils/ApiError';
import { audit } from '../services/audit.service';
import * as imp from '../services/import.service';

/** Bulk import of the company's own files. Every endpoint supports dryRun=true (preview, writes nothing) and is safe to repeat. */
const router = Router();
const xlsx = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024, files: 1 }, fileFilter: (_r, f, cb) => cb(null, /\.xlsx$/i.test(f.originalname)) });
const docx = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 60 }, fileFilter: (_r, f, cb) => cb(null, /\.docx$/i.test(f.originalname)) });
const actor = (req: any) => ({ id: req.user.id as string, name: req.user.name as string, role: req.user.role as string });
const org = (req: any) => String(req.user.organizationId);
const dry = (req: any) => String(req.body?.dryRun) === 'true';

async function run(req: any, res: any, what: string, mod: string, fn: () => Promise<imp.ImportReport>) {
  const r = await fn();
  await audit(req, `import.${what}`, 'Import', what, { module: mod, severity: dry(req) ? 'info' : 'medium', summary: `${dry(req) ? 'preview' : 'imported'}: ${r.created} new, ${r.duplicates} already there` });
  res.json({ success: true, dryRun: dry(req), data: r });
}
const needFile = (req: any) => { if (!req.file) throw ApiError.badRequest('Attach an .xlsx workbook'); return req.file.buffer as Buffer; };

router.post('/assets', requireModule('assets'), xlsx.single('file'), asyncHandler(async (req, res) => run(req, res, 'assets', 'assets', () => imp.importAssets(org(req), needFile(req), actor(req), { dryRun: dry(req), defaultCategory: req.body?.category }))));
router.post('/vendors', requireModule('vendors', 'isms'), xlsx.single('file'), asyncHandler(async (req, res) => run(req, res, 'vendors', 'vendors', () => imp.importVendors(org(req), needFile(req), actor(req), { dryRun: dry(req) }))));
router.post('/maintenance', requireModule('isms'), xlsx.single('file'), asyncHandler(async (req, res) => run(req, res, 'maintenance', 'isms', () => imp.importMaintenance(org(req), needFile(req), actor(req), { dryRun: dry(req) }))));
router.post('/threats', requireModule('threat_intel', 'isms'), xlsx.single('file'), asyncHandler(async (req, res) => run(req, res, 'threats', 'threat_intel', () => imp.importThreatRegister(org(req), needFile(req), actor(req), { dryRun: dry(req) }))));
router.post('/policies', requireModule('policies'), docx.array('files', 60), asyncHandler(async (req, res) => {
  const files = ((req.files as Express.Multer.File[]) || []).map((f) => ({ name: f.originalname, buffer: f.buffer })); if (!files.length) throw ApiError.badRequest('Attach one or more .docx files');
  const publish = String(req.body?.publish) === 'true';
  if (publish && !['super_admin', 'ceo', 'coo'].includes(req.user!.role)) throw ApiError.forbidden('Only leadership can import policies as approved. Import them as drafts and approve each one.');
  await run(req, res, 'policies', 'policies', () => imp.importPolicyDocx(org(req), files, actor(req), { dryRun: dry(req), publish }));
}));
export default router;
