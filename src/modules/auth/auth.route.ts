import { Router } from 'express';
import { approveRegistrationController, listPendingRegistrationsController, loginController, logoutController, meController, refreshController, registerController, updateMeController } from './auth.controller';
import { requireAuth, requireRole } from '../../middlewares/auth.middleware';
import { parseProfileUploadMiddleware } from './avatar.upload';

const authRouter = Router();

authRouter.post('/register', registerController);
authRouter.post('/login', loginController);
authRouter.post('/refresh', refreshController);
authRouter.get('/me', requireAuth, meController);
authRouter.patch('/me', requireAuth, parseProfileUploadMiddleware, updateMeController);
authRouter.post('/logout', logoutController);
authRouter.get('/registrations/pending', requireAuth, requireRole(['ADMIN']), listPendingRegistrationsController);
authRouter.patch('/registrations/:id/approve', requireAuth, requireRole(['ADMIN']), approveRegistrationController);

export default authRouter;
