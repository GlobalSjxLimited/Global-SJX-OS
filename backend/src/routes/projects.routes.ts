import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import * as c from '../controllers/projects.controller';
import { createFromProject } from '../controllers/opportunities.controller';

const router = Router();
router.use(requireAuth);

const manageProjects = requireRole('project_manager', 'coo', 'ceo');

router.get('/', c.listProjects);
router.get('/:id', c.getProject);
router.get('/:id/hold-report', c.holdReport);
router.post('/', manageProjects, c.createProject);
router.patch('/:id', manageProjects, c.updateProject);
router.delete('/:id', manageProjects, c.deleteProject);
router.post('/:id/restore', manageProjects, c.restoreProject);
router.post('/:id/comments', c.addProjectComment);
router.post('/:id/request-closure', c.requestProjectClosure);
// raise an opportunity from this project — open to the project's own team as well as sales (checked in the handler)
router.post('/:id/opportunity', createFromProject);
router.post('/:id/risks', c.raiseProjectRisk);

// milestones — permissions are checked per action inside the handlers (owner / project manager / leadership)
router.post('/:id/milestones', c.addMilestone);
router.patch('/:id/milestones/:milestoneId', c.updateMilestone);
router.delete('/:id/milestones/:milestoneId', c.deleteMilestone);
router.post('/:id/milestones/:milestoneId/updates', c.milestoneUpdate);
router.post('/:id/milestones/:milestoneId/evidence', c.milestoneEvidence);
router.patch('/:id/milestones/:milestoneId/criteria/:criterionId', c.milestoneCriterion);
router.post('/:id/milestones/:milestoneId/submit', c.submitMilestone);
router.post('/:id/milestones/:milestoneId/approve', c.approveMilestone);
router.post('/:id/milestones/:milestoneId/reject', c.rejectMilestone);
router.get('/:id/milestones/:milestoneId/certificate', c.milestoneCertificate);
router.post('/:id/milestones/:milestoneId/risks', c.raiseMilestoneRisk);

export default router;
