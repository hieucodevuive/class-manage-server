import type { RequestHandler } from 'express';
import { classIdSchema } from '../classes/class.schema';
import { studentIdSchema } from '../students/student.schema';
import { createEnrollmentSchema } from './enrollment.schema';
import { createEnrollment, leaveClass, listClassEnrollments } from './enrollment.service';
import { serializeEnrollment, serializeEnrollmentWithStudent } from './enrollment.response';

export const createEnrollmentController: RequestHandler = async (req, res) => {
  const classIdResult = classIdSchema.safeParse(req.params.classId);

  if (!classIdResult.success) {
    res.status(400).json({
      success: false,
      message: 'ID lớp phải là số nguyên dương không vượt quá 2147483647',
    });
    return;
  }

  const bodyResult = createEnrollmentSchema.safeParse(req.body);

  if (!bodyResult.success) {
    res.status(400).json({
      success: false,
      message: 'Thông tin ghi danh không hợp lệ',
      errors: bodyResult.error.issues.map(issue => ({
        field: issue.path.join('.') || 'body',
        message: issue.message,
      })),
    });
    return;
  }

  const result = await createEnrollment(classIdResult.data, res.locals.auth.userId, bodyResult.data);

  if (result.status === 'class_not_found') {
    res.status(404).json({ success: false, message: 'Không tìm thấy lớp' });
    return;
  }

  if (result.status === 'student_not_found') {
    res.status(404).json({ success: false, message: 'Không tìm thấy học sinh' });
    return;
  }

  if (result.status === 'parent_not_found') {
    res.status(404).json({ success: false, message: 'Không tìm thấy lớp hoặc học sinh' });
    return;
  }

  if (result.status === 'already_enrolled') {
    res.status(409).json({ success: false, message: 'Học sinh đã từng được ghi danh vào lớp này' });
    return;
  }

  res.status(201).json({
    success: true,
    message: 'Ghi danh học sinh thành công',
    data: { enrollment: serializeEnrollment(result.enrollment) },
  });
};

export const listEnrollmentsController: RequestHandler = async (req, res) => {
  const classIdResult = classIdSchema.safeParse(req.params.classId);

  if (!classIdResult.success) {
    res.status(400).json({
      success: false,
      message: 'ID lớp phải là số nguyên dương không vượt quá 2147483647',
    });
    return;
  }

  const result = await listClassEnrollments(classIdResult.data, res.locals.auth.userId);

  if (result.status === 'not_found') {
    res.status(404).json({ success: false, message: 'Không tìm thấy lớp' });
    return;
  }

  res.json({
    success: true,
    data: { enrollments: result.enrollments.map(serializeEnrollmentWithStudent) },
  });
};

export const leaveClassController: RequestHandler = async (req, res) => {
  const classIdResult = classIdSchema.safeParse(req.params.classId);

  if (!classIdResult.success) {
    res.status(400).json({
      success: false,
      message: 'ID lớp phải là số nguyên dương không vượt quá 2147483647',
    });
    return;
  }

  const studentIdResult = studentIdSchema.safeParse(req.params.studentId);

  if (!studentIdResult.success) {
    res.status(400).json({ success: false, message: 'ID học sinh phải là UUID hợp lệ' });
    return;
  }

  const result = await leaveClass(classIdResult.data, studentIdResult.data, res.locals.auth.userId);

  if (result.status === 'not_found') {
    res.status(404).json({ success: false, message: 'Không tìm thấy ghi danh' });
    return;
  }

  if (result.status === 'invalid_leave_date') {
    res.status(400).json({ success: false, message: 'Ngày nghỉ không được trước ngày vào lớp' });
    return;
  }

  res.json({
    success: true,
    message: 'Học sinh đã rời lớp',
    data: { enrollment: serializeEnrollment(result.enrollment) },
  });
};
