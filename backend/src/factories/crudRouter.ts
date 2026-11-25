import { Router } from 'express';
import { Model } from 'mongoose';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { Role } from '../config/roles';
import { buildCrudController } from './crudFactory';

interface RouterOptions {
  entityName: string;
  searchableFields?: string[];
  populate?: string | string[];
  defaultSort?: string;
  writeRoles?: Role[]; // roles allowed to create/update/delete; readable by any authenticated user if omitted
}

export function buildCrudRouter(model: Model<any>, options: RouterOptions): Router {
  const router = Router();
  const ctrl = buildCrudController(model, options);
  const writeGuard = options.writeRoles ? [requireRole(...options.writeRoles)] : [];

  router.use(requireAuth);
  router.get('/', ctrl.list);
  router.get('/:id', ctrl.getOne);
  router.post('/', ...writeGuard, ctrl.create);
  router.patch('/:id', ...writeGuard, ctrl.update);
  router.delete('/:id', ...writeGuard, ctrl.remove);
  router.post('/:id/restore', ...writeGuard, ctrl.restore);

  return router;
}
