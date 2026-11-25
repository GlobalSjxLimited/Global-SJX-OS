import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuid } from 'uuid';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { ApiError } from '../utils/ApiError';
import { storage } from '../services/storage.service';

const router = Router();

const ALLOWED_MIME = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/csv',
  'image/png',
  'image/jpeg',
  'image/webp',
];

const ALLOWED_EXT = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.csv', '.png', '.jpg', '.jpeg', '.webp'];

const makeUpload = (maxMb: number) => multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => {
      // requireAuth runs before this middleware in the route chain, so req.user is set.
      const orgId = (req as any).user.organizationId;
      cb(null, storage.buildDestination(orgId));
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '');
      cb(null, `${uuid()}${ext}`);
    },
  }),
  limits: { fileSize: maxMb * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME.includes(file.mimetype)) {
      return cb(new Error(`File type ${file.mimetype} is not allowed`));
    }
    // Extension must agree with the MIME type (blocks "invoice.pdf.exe"-style tricks) and SVG (script-capable) is never accepted.
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXT.includes(ext)) return cb(new Error(`File extension ${ext || '(none)'} is not allowed`));
    cb(null, true);
  },
});

const upload = makeUpload(20);
/** Contracts, signed documents and record attachments: 10 MB at most. */
const uploadTen = makeUpload(10);

/** POST /api/uploads — multipart/form-data with a "file" field. Returns metadata to attach to any record (Document.url, Certification.certificateDocumentId's document, etc). */
router.post(
  '/',
  requireAuth,
  (req, res, next) => {
    upload.single('file')(req, res, (err) => {
      if (err) return next(ApiError.badRequest(err.message));
      next();
    });
  },
  asyncHandler(async (req, res) => {
    if (!req.file) throw ApiError.badRequest('No file provided (expected multipart field "file")');
    const orgId = req.user!.organizationId;
    res.status(201).json({
      success: true,
      data: {
        url: storage.buildUrl(orgId, req.file.filename),
        filename: req.file.filename,
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
        size: req.file.size,
      },
    });
  })
);


/** POST /api/uploads/document — like the general upload but capped at 10 MB, for signed contracts and attachments on records. */
router.post(
  '/document',
  requireAuth,
  (req, res, next) => {
    uploadTen.single('file')(req, res, (err) => {
      if (!err) return next();
      const e = ApiError.badRequest((err as any).code === 'LIMIT_FILE_SIZE' ? 'That file is larger than 10 MB. Compress it or split it and try again.' : err.message);
      // Let the browser finish sending before we answer, otherwise it sees a dropped connection instead of our message.
      let done = false; const go = () => { if (!done) { done = true; next(e); } };
      req.on('end', go); req.on('close', go); req.on('error', go); req.resume();
      setTimeout(go, 15000);
    });
  },
  asyncHandler(async (req, res) => {
    if (!req.file) throw ApiError.badRequest('No file provided (expected multipart field "file")');
    const orgId = req.user!.organizationId;
    res.status(201).json({ success: true, data: { url: storage.buildUrl(orgId, req.file.filename), filename: req.file.filename, originalName: req.file.originalname, mimeType: req.file.mimetype, size: req.file.size } });
  })
);

/* ---------------------------------------------------------------------------
 * Rich-text media (images embedded in articles, announcements, replies …).
 * Stored in a shared "_media" folder under unguessable UUID names and served
 * publicly so published website articles can display them. Images only.
 * ------------------------------------------------------------------------- */
const MEDIA_EXT = ['.png', '.jpg', '.jpeg', '.webp'];
const mediaUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, storage.buildDestination('_media')),
    filename: (_req, file, cb) => cb(null, `${uuid()}${path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '')}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = ['image/png', 'image/jpeg', 'image/webp'].includes(file.mimetype) && MEDIA_EXT.includes(path.extname(file.originalname).toLowerCase());
    if (!ok) return cb(new Error('Only PNG, JPEG or WebP images up to 5 MB are allowed'));
    cb(null, true);
  },
});

router.post(
  '/media',
  requireAuth,
  (req, res, next) => {
    mediaUpload.single('file')(req, res, (err) => (err ? next(ApiError.badRequest(err.message)) : next()));
  },
  asyncHandler(async (req, res) => {
    if (!req.file) throw ApiError.badRequest('No image provided');
    res.status(201).json({ success: true, data: { url: `/api/uploads/media/${req.file.filename}` } });
  })
);

router.get(
  '/media/:file',
  asyncHandler(async (req, res) => {
    const file = req.params.file;
    if (!/^[\w-]+\.(png|jpe?g|webp)$/i.test(file)) throw ApiError.notFound('File not found');
    const filePath = path.join(storage.uploadsRoot, '_media', file);
    if (!fs.existsSync(filePath)) throw ApiError.notFound('File not found');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.sendFile(filePath);
  })
);

/**
 * Meeting recordings (audio / video) are far larger than documents, so they have their own endpoint,
 * allow-list and size cap (RECORDING_MAX_MB, default 500 MB). The same authenticated download route serves them.
 */
const REC_MIME = ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-matroska', 'audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/m4a', 'audio/wav', 'audio/x-wav', 'audio/webm', 'audio/ogg', 'application/octet-stream'];
const REC_EXT = ['.mp4', '.webm', '.mov', '.mkv', '.mp3', '.m4a', '.wav', '.ogg', '.oga'];
const recMaxMb = Math.min(Math.max(Number(process.env.RECORDING_MAX_MB) || 500, 20), 4096);
const recordingUpload = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => cb(null, storage.buildDestination((req as any).user.organizationId)),
    filename: (_req, file, cb) => cb(null, `${uuid()}${path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '')}`),
  }),
  limits: { fileSize: recMaxMb * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!REC_EXT.includes(ext)) return cb(new Error(`Recordings must be one of: ${REC_EXT.join(', ')}`));
    if (!REC_MIME.includes(file.mimetype)) return cb(new Error(`File type ${file.mimetype} is not allowed for recordings`));
    cb(null, true);
  },
});

router.post(
  '/recording',
  requireAuth,
  (req, res, next) => {
    recordingUpload.single('file')(req, res, (err) => {
      if (err) return next(ApiError.badRequest((err as any).code === 'LIMIT_FILE_SIZE' ? `Recording is larger than ${recMaxMb} MB` : err.message));
      next();
    });
  },
  asyncHandler(async (req, res) => {
    if (!req.file) throw ApiError.badRequest('No file provided (expected multipart field "file")');
    res.status(201).json({ success: true, data: { url: storage.buildUrl(req.user!.organizationId, req.file.filename), filename: req.file.filename, originalName: req.file.originalname, mimeType: req.file.mimetype, size: req.file.size } });
  })
);

/** POST /api/uploads/multi — multipart/form-data with a repeated "files" field. Returns an array of the same metadata shape as POST /api/uploads, one entry per file. */
router.post(
  '/multi',
  requireAuth,
  (req, res, next) => {
    upload.array('files', 20)(req, res, (err) => {
      if (err) return next(ApiError.badRequest(err.message));
      next();
    });
  },
  asyncHandler(async (req, res) => {
    const files = (req.files as Express.Multer.File[]) || [];
    if (files.length === 0) throw ApiError.badRequest('No files provided (expected multipart field "files")');
    const orgId = req.user!.organizationId;
    res.status(201).json({
      success: true,
      data: files.map((f) => ({
        url: storage.buildUrl(orgId, f.filename),
        filename: f.filename,
        originalName: f.originalname,
        mimeType: f.mimetype,
        size: f.size,
      })),
    });
  })
);

/** GET /api/uploads/:orgId/:filename — authenticated download/view, scoped to the requester's own organization. */
router.get(
  '/:orgId/:filename',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { orgId, filename } = req.params;
    if (orgId !== req.user!.organizationId && req.user!.role !== 'super_admin') {
      throw ApiError.forbidden('You do not have access to this file');
    }
    if (filename.includes('..') || filename.includes('/')) throw ApiError.badRequest('Invalid filename');

    const filePath = path.join(storage.uploadsRoot, orgId, filename);
    if (!fs.existsSync(filePath)) throw ApiError.notFound('File not found');
    const ext = path.extname(filePath).toLowerCase();
    const inline = ['.png', '.jpg', '.jpeg', '.webp', '.pdf'].includes(ext);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Content-Disposition', inline ? 'inline' : 'attachment');
    res.sendFile(filePath);
  })
);

/** DELETE /api/uploads/:orgId/:filename */
router.delete(
  '/:orgId/:filename',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { orgId, filename } = req.params;
    if (orgId !== req.user!.organizationId && req.user!.role !== 'super_admin') {
      throw ApiError.forbidden('You do not have access to this file');
    }
    if (filename.includes('..') || filename.includes('/')) throw ApiError.badRequest('Invalid filename');
    await storage.delete(orgId, filename);
    res.json({ success: true, data: { deleted: true } });
  })
);

export default router;
