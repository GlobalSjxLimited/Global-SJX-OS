import { Router } from 'express';
import { register, login, me, mfaChallenge, mfaSetup, mfaVerify, mfaDisable, revokeSessions, changePassword, acknowledgeSecurityPolicy, logout } from '../controllers/auth.controller';
import { requireAuth } from '../middleware/auth';

const router = Router();

router.post('/register', register);
router.post('/login', login);
router.post('/mfa/challenge', mfaChallenge);
router.get('/me', requireAuth, me);
router.post('/mfa/setup', requireAuth, mfaSetup);
router.post('/mfa/verify', requireAuth, mfaVerify);
router.post('/mfa/disable', requireAuth, mfaDisable);

router.post('/revoke-sessions', requireAuth, revokeSessions);
router.post('/logout', requireAuth, logout);
router.post('/change-password', requireAuth, changePassword);
router.post('/acknowledge-security-policy', requireAuth, acknowledgeSecurityPolicy);

export default router;
