import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import {
  listOpportunities,
  pipelineBoard,
  getOpportunity,
  createOpportunity,
  updateOpportunity,
  deleteOpportunity,
  restoreOpportunity,
  pipelineMeta,
  opportunityReport,
  addContact,
  updateContact,
  removeContact,
} from '../controllers/opportunities.controller';

const router = Router();
router.use(requireAuth);

const manageOpportunities = requireRole('sales', 'coo', 'ceo');

router.get('/meta', pipelineMeta);
router.get('/report', opportunityReport);
router.get('/board', pipelineBoard);
router.get('/', listOpportunities);
router.get('/:id', getOpportunity);
router.post('/', manageOpportunities, createOpportunity);
router.patch('/:id', manageOpportunities, updateOpportunity);
router.post('/:id/contacts', manageOpportunities, addContact);
router.patch('/:id/contacts/:cid', manageOpportunities, updateContact);
router.delete('/:id/contacts/:cid', manageOpportunities, removeContact);
router.delete('/:id', manageOpportunities, deleteOpportunity);
router.post('/:id/restore', manageOpportunities, restoreOpportunity);

export default router;
