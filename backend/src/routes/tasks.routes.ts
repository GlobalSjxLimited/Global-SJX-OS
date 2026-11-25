import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import {
  listTasks, getTask, createTask, updateTask, deleteTask, addComment, kanbanBoard, restoreTask,
  postUpdate, requestUpdate, shareTask, unshareTask, addDocument, removeDocument, addEvidence, removeEvidence,
  setCriterion, submitTask, approveTask, rejectTask, taskCertificate, raiseTaskRisk, changeTaskStatus, setProgress, exportTasks,
} from '../controllers/tasks.controller';

const router = Router();
router.use(requireAuth);

router.get('/board', kanbanBoard);
router.get('/export.csv', exportTasks);
router.get('/', listTasks);
router.post('/', createTask);
router.get('/:id', getTask);
router.patch('/:id', updateTask);
router.delete('/:id', deleteTask);
router.post('/:id/restore', restoreTask);

// status workflow (every change carries a comment) and progress
router.post('/:id/status', changeTaskStatus);
router.post('/:id/progress', setProgress);

// conversation + updates
router.post('/:id/comments', addComment);
router.post('/:id/updates', postUpdate);
router.post('/:id/request-update', requestUpdate);

// sharing (blocked for confidential tasks inside the handler)
router.post('/:id/share', shareTask);
router.delete('/:id/share/:userId', unshareTask);

// documents, evidence, criteria
router.post('/:id/documents', addDocument);
router.delete('/:id/documents/:docId', removeDocument);
router.post('/:id/evidence', addEvidence);
router.delete('/:id/evidence/:evidenceId', removeEvidence);
router.patch('/:id/criteria/:criterionId', setCriterion);

// completion workflow
router.post('/:id/submit', submitTask);
router.post('/:id/approve', approveTask);
router.post('/:id/reject', rejectTask);
router.get('/:id/certificate', taskCertificate);

// risks / blockers
router.post('/:id/risks', raiseTaskRisk);

export default router;
