import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import * as c from '../controllers/campaigns.controller';

/**
 * /api/campaigns — Marketing module. Everything about a campaign: content, pictures, approval, hand-over and results.
 * Mounted behind requireModule('marketing') in app.ts.
 */
export const campaignsRouter: Router = Router();
campaignsRouter.use(requireAuth);
campaignsRouter.get('/', c.listCampaigns);
campaignsRouter.get('/export.csv', c.exportCampaigns);
campaignsRouter.get('/overview', c.marketingOverview);
campaignsRouter.get('/accounts', c.listAccounts);
campaignsRouter.post('/accounts', c.createAccount);
campaignsRouter.patch('/accounts/:id', c.updateAccount);
campaignsRouter.delete('/accounts/:id', c.deleteAccount);
campaignsRouter.post('/', c.createCampaign);
campaignsRouter.get('/:id', c.getCampaign);
campaignsRouter.patch('/:id', c.updateCampaign);
campaignsRouter.delete('/:id', c.deleteCampaign);
campaignsRouter.post('/:id/submit', c.submitForApproval);
campaignsRouter.post('/:id/decision', c.decideApproval);
campaignsRouter.post('/:id/send-to-manager', c.sendToManager);
campaignsRouter.post('/:id/metrics', c.recordMetrics);

/**
 * /api/social-queue — the social media manager's list. Needs only a sign-in, not the Marketing module,
 * because the manager can be anyone on the team. Each action checks the post is assigned to the caller (or the caller is in Marketing).
 */
export const socialQueueRouter: Router = Router();
socialQueueRouter.use(requireAuth);
socialQueueRouter.get('/', c.myQueue);
socialQueueRouter.post('/:campaignId/postings/:postingId/publish', c.publishPosting);
socialQueueRouter.post('/:campaignId/postings/:postingId/mark-posted', c.markPosted);
socialQueueRouter.post('/:campaignId/postings/:postingId/return', c.returnPosting);
