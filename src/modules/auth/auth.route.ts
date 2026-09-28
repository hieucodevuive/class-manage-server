import { Router } from 'express';
import { loginController, logoutController, meController, refreshController } from './auth.controller';
import { requireAuth } from '../../middlewares/auth.middleware';

const authRouter = Router();

authRouter.post('/login', loginController);
authRouter.post('/refresh', refreshController);
authRouter.get('/me', requireAuth, meController);
authRouter.post('/logout', logoutController);

export default authRouter;