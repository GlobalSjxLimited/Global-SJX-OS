import fs from 'fs';
import path from 'path';
import { ApiError } from '../utils/ApiError';
import { storage } from './storage.service';

export const MAX_DOC_MB = 10;

/**
 * Checks a file somebody wants to attach to a record. It must be one of OUR uploads for THIS organisation, it must exist,
 * and its real size on disk (not the size the browser claims) must be within the limit. Returns the true size.
 */
export function verifyOrgUpload(organizationId: string, url: string, maxMb = MAX_DOC_MB): { size: number; filename: string; ext: string } {
  const m = /^\/api\/uploads\/([a-f\d]{24})\/([\w.-]+)$/i.exec(String(url || ''));
  if (!m || m[1] !== organizationId || m[2].includes('..')) throw ApiError.badRequest('Attach a file you uploaded here (not a link).');
  const full = path.join(storage.uploadsRoot, organizationId, m[2]);
  let size = 0;
  try { size = fs.statSync(full).size; } catch { throw ApiError.badRequest('That file could not be found. Upload it again.'); }
  if (size > maxMb * 1024 * 1024) throw ApiError.badRequest(`That file is ${(size / 1048576).toFixed(1)} MB. The limit is ${maxMb} MB.`);
  return { size, filename: m[2], ext: path.extname(m[2]).toLowerCase() };
}
