import { Router } from 'express';
import { requireAuth, requireRole } from '../../middlewares/auth.middleware';
import {
  createClassController,
  deleteClassController,
  getClassByIdController,
  listClassesController,
  updateClassController,
} from './class.controller';

const classRouter = Router();

classRouter.post(
  '/',
  requireAuth,
  requireRole(['TEACHER', 'ADMIN']),
  createClassController,
);

classRouter.get(
  '/',
  requireAuth,
  requireRole(['TEACHER', 'ADMIN']),
  listClassesController,
);

classRouter.get(
  '/:id',
  requireAuth,
  requireRole(['TEACHER', 'ADMIN']),
  getClassByIdController,
);

classRouter.patch(
  '/:id',
  requireAuth,
  requireRole(['TEACHER', 'ADMIN']),
  updateClassController,
);

classRouter.delete(
  '/:id',
  requireAuth,
  requireRole(['TEACHER', 'ADMIN']),
  deleteClassController,
);

export default classRouter;
