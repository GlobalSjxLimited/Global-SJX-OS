import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { listIdeas, getIdea, createIdea, updateIdea, deleteIdea, toggleVote, addComment, restoreIdea, addLink, removeLink, addAttachment, removeAttachment } from '../controllers/ideas.controller';

const router = Router();
router.use(requireAuth);

router.get('/', listIdeas);
router.get('/:id', getIdea);
router.post('/', createIdea);
router.patch('/:id', updateIdea);
router.delete('/:id', deleteIdea);
router.post('/:id/restore', restoreIdea);
router.post('/:id/vote', toggleVote);
router.post('/:id/comments', addComment);
router.post('/:id/links', addLink);
router.delete('/:id/links/:linkId', removeLink);
router.post('/:id/attachments', addAttachment);
router.delete('/:id/attachments/:attachmentId', removeAttachment);

export default router;
