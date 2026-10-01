import { Router } from 'express';
import { requireAuth, requireRole } from '../../middlewares/auth.middleware';
import {
  createStudentController,
  deleteStudentController,
  getStudentByIdController,
  listStudentsController,
  updateStudentController,
} from './student.controller';

const studentRouter = Router();

studentRouter.post(
  '/',
  requireAuth,
  requireRole(['TEACHER', 'ADMIN']),
  createStudentController,
);

studentRouter.get(
  '/',
  requireAuth,
  requireRole(['TEACHER', 'ADMIN']),
  listStudentsController,
);

studentRouter.get(
  '/:id',
  requireAuth,
  requireRole(['TEACHER', 'ADMIN']),
  getStudentByIdController,
);

studentRouter.patch(
  '/:id',
  requireAuth,
  requireRole(['TEACHER', 'ADMIN']),
  updateStudentController,
);

studentRouter.delete(
  '/:id',
  requireAuth,
  requireRole(['TEACHER', 'ADMIN']),
  deleteStudentController,
);

export default studentRouter;
