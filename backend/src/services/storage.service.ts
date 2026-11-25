import fs from 'fs';
import path from 'path';

/**
 * Storage adapter interface. Today only LocalDiskStorage is implemented — it
 * writes to backend/uploads/<organizationId>/ and files are served back
 * through an authenticated Express route (see routes/uploads.routes.ts),
 * not express.static, so access control is enforced per-request rather than
 * relying on obscure filenames.
 *
 * To move to S3/GCS in production: implement StorageAdapter against the SDK
 * of choice (upload -> return a signed or public URL, remove -> delete the
 * object) and swap the export at the bottom of this file. Nothing else in
 * the codebase needs to change — every caller goes through `storage`.
 */
export interface StoredFile {
  key: string; // relative path used to retrieve/delete the file later
  url: string; // URL the frontend should use to fetch the file
  originalName: string;
  mimeType: string;
  size: number;
}

export interface StorageAdapter {
  uploadsRoot: string;
  buildDestination(organizationId: string): string;
  buildUrl(organizationId: string, filename: string): string;
  delete(organizationId: string, filename: string): Promise<void>;
}

class LocalDiskStorageAdapter implements StorageAdapter {
  uploadsRoot = path.resolve(__dirname, '../../uploads');

  constructor() {
    if (!fs.existsSync(this.uploadsRoot)) {
      fs.mkdirSync(this.uploadsRoot, { recursive: true });
    }
  }

  buildDestination(organizationId: string): string {
    const dir = path.join(this.uploadsRoot, organizationId);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  buildUrl(organizationId: string, filename: string): string {
    return `/api/uploads/${organizationId}/${filename}`;
  }

  async delete(organizationId: string, filename: string): Promise<void> {
    const filePath = path.join(this.uploadsRoot, organizationId, filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
}

export const storage: StorageAdapter = new LocalDiskStorageAdapter();
