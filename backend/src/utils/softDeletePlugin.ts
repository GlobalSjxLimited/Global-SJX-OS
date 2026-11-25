import { Schema } from 'mongoose';

/**
 * Soft-delete plugin. Applied to every model in the platform.
 *
 * Why this instead of cascade-delete logic per relation: hard-deleting a
 * Project left Tasks with a dangling projectId that would either 404 on
 * populate or silently show nothing. Soft-deleting means the referenced
 * document still physically exists, so every populate() across every module
 * keeps working — the "cascade" problem disappears because there's nothing
 * left dangling. Callers who need to hide deleted records filter on
 * isDeleted: false (the CRUD factory and every bespoke list handler do this
 * by default); a small number of privileged routes can pass
 * ?includeDeleted=true to see everything, and admins can restore.
 */
export function softDeletePlugin(schema: Schema): void {
  schema.add({
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date },
    deletedById: { type: Schema.Types.ObjectId, ref: 'User' },
  });

  schema.methods.softDelete = function softDelete(userId?: string) {
    this.isDeleted = true;
    this.deletedAt = new Date();
    if (userId) this.deletedById = userId;
    return this.save();
  };

  schema.methods.restore = function restore() {
    this.isDeleted = false;
    this.deletedAt = undefined;
    this.deletedById = undefined;
    return this.save();
  };

  /**
   * Defense in depth: automatically exclude soft-deleted documents from every
   * find/findOne/count query, even ones written before this plugin existed or
   * ones a future contributor forgets to filter manually. A query that
   * genuinely needs deleted records (the restore endpoints) passes
   * `.setOptions({ withDeleted: true })`, or explicitly filters
   * `{ isDeleted: true }` — both are detected below and skip the injection.
   */
  const autoExclude = function (this: any) {
    const query = this.getQuery();
    const opts = this.getOptions ? this.getOptions() : {};
    if (opts.withDeleted) return;
    if (Object.prototype.hasOwnProperty.call(query, 'isDeleted')) return;
    this.where({ isDeleted: { $ne: true } });
  };

  schema.pre('find', autoExclude);
  schema.pre('findOne', autoExclude);
  schema.pre('findOneAndUpdate', autoExclude);
  schema.pre('countDocuments', autoExclude);
}

/** Merges a caller-supplied filter with the standard "hide deleted records" clause. */
export function excludeDeleted(filter: Record<string, unknown> = {}, includeDeleted = false) {
  if (includeDeleted) return filter;
  return { ...filter, isDeleted: { $ne: true } };
}
