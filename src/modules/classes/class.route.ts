import { Router } from 'express';
import { requireAuth, requireRole } from '../../middlewares/auth.middleware';
import {
  createEnrollmentController,
  leaveClassController,
  listEnrollmentsController,
} from '../enrollments/enrollment.controller';
import {
  createScheduleController,
  deleteScheduleController,
  getScheduleByIdController,
  listSchedulesController,
  updateScheduleController,
} from '../schedules/schedule.controller';
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

classRouter.post(
  '/:classId/students',
  requireAuth,
  requireRole(['TEACHER', 'ADMIN']),
  createEnrollmentController,
);

classRouter.post(
  '/:classId/schedules',
  requireAuth,
  requireRole(['TEACHER', 'ADMIN']),
  createScheduleController,
);

classRouter.get(
  '/',
  requireAuth,
  requireRole(['TEACHER', 'ADMIN']),
  listClassesController,
);

classRouter.get(
  '/:classId/students',
  requireAuth,
  requireRole(['TEACHER', 'ADMIN']),
  listEnrollmentsController,
);

classRouter.get(
  '/:classId/schedules',
  requireAuth,
  requireRole(['TEACHER', 'ADMIN']),
  listSchedulesController,
);

classRouter.get(
  '/:classId/schedules/:scheduleId',
  requireAuth,
  requireRole(['TEACHER', 'ADMIN']),
  getScheduleByIdController,
);

classRouter.get(
  '/:id',
  requireAuth,
  requireRole(['TEACHER', 'ADMIN']),
  getClassByIdController,
);

classRouter.patch(
  '/:classId/schedules/:scheduleId',
  requireAuth,
  requireRole(['TEACHER', 'ADMIN']),
  updateScheduleController,
);

classRouter.patch(
  '/:id',
  requireAuth,
  requireRole(['TEACHER', 'ADMIN']),
  updateClassController,
);

classRouter.delete(
  '/:classId/students/:studentId',
  requireAuth,
  requireRole(['TEACHER', 'ADMIN']),
  leaveClassController,
);

classRouter.delete(
  '/:classId/schedules/:scheduleId',
  requireAuth,
  requireRole(['TEACHER', 'ADMIN']),
  deleteScheduleController,
);

classRouter.delete(
  '/:id',
  requireAuth,
  requireRole(['TEACHER', 'ADMIN']),
  deleteClassController,
);

export default classRouter;
