import { Schema, Types } from 'mongoose';
import { currentContext } from './requestContext';

/**
 * "Date created, date modified, and who changed it, when and from where."
 * Adds createdBy / updatedBy / updatedFrom to a schema; timestamps stay on the model's own `timestamps` option.
 * Values come from the request context, so no route has to remember to pass them.
 */
export function stampPlugin(schema: Schema) {
  schema.add({
    createdBy: { id: { type: Schema.Types.ObjectId }, name: String },
    updatedBy: { id: { type: Schema.Types.ObjectId }, name: String },
    updatedFrom: { ip: String, device: String },
  } as any);
  if (!schema.get('timestamps')) schema.set('timestamps', true);

  schema.pre('save', function (next) {
    const c = currentContext();
    const doc: any = this;
    if (c.userId) {
      const me = { id: new Types.ObjectId(c.userId), name: c.userName };
      if (doc.isNew && !doc.createdBy?.id) doc.createdBy = me;
      doc.updatedBy = me;
      doc.updatedFrom = { ip: c.ip, device: c.device };
    }
    next();
  });

  // Updates that bypass save() (findOneAndUpdate / updateOne) are stamped too.
  const stampUpdate = function (this: any, next: () => void) {
    const c = currentContext();
    if (c.userId) this.set({ updatedBy: { id: new Types.ObjectId(c.userId), name: c.userName }, updatedFrom: { ip: c.ip, device: c.device } });
    next();
  };
  schema.pre('findOneAndUpdate', stampUpdate);
  schema.pre('updateOne', stampUpdate);
  schema.pre('updateMany', stampUpdate);
}

/** What the screens show: "Updated by Sina Joseph · 02 Nov 2026 15:43 · Chrome on macOS (41.58.1.9)". */
export function stampLine(doc: any): string {
  const by = doc?.updatedBy?.name || doc?.createdBy?.name;
  if (!by) return '';
  const when = doc.updatedAt || doc.createdAt;
  const from = [doc?.updatedFrom?.device, doc?.updatedFrom?.ip && `(${doc.updatedFrom.ip})`].filter(Boolean).join(' ');
  return `${doc.updatedBy?.name ? 'Updated' : 'Created'} by ${by}${when ? ` · ${new Date(when).toISOString().replace('T', ' ').slice(0, 16)}` : ''}${from ? ` · ${from}` : ''}`;
}
