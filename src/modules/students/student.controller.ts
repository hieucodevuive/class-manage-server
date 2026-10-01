import type { RequestHandler } from 'express';
import { createStudentSchema, studentIdSchema, updateStudentSchema } from './student.schema';
import {
  createStudent,
  deleteStudent,
  getStudentById,
  listStudents,
  updateStudent,
} from './student.service';
import { serializeStudent } from './student.response';

export const createStudentController: RequestHandler = async (req, res) => {
  const result = createStudentSchema.safeParse(req.body);

  if (!result.success) {
    res.status(400).json({
      success: false,
      message: 'Thông tin học sinh không hợp lệ',
      errors: result.error.issues.map(issue => ({
        field: issue.path.join('.') || 'body',
        message: issue.message,
      })),
    });
    return;
  }

  const student = await createStudent(result.data, res.locals.auth.userId);

  res.status(201).json({
    success: true,
    message: 'Tạo học sinh thành công',
    data: { student: serializeStudent(student) },
  });
};

export const listStudentsController: RequestHandler = async (_req, res) => {
  const students = await listStudents(res.locals.auth.userId);

  res.json({
    success: true,
    data: { students: students.map(serializeStudent) },
  });
};

export const getStudentByIdController: RequestHandler = async (req, res) => {
  const result = studentIdSchema.safeParse(req.params.id);

  if (!result.success) {
    res.status(400).json({
      success: false,
      message: 'ID học sinh phải là UUID hợp lệ',
    });
    return;
  }

  const student = await getStudentById(result.data, res.locals.auth.userId);

  if (!student) {
    res.status(404).json({
      success: false,
      message: 'Không tìm thấy học sinh',
    });
    return;
  }

  res.json({
    success: true,
    data: { student: serializeStudent(student) },
  });
};

export const updateStudentController: RequestHandler = async (req, res) => {
  const idResult = studentIdSchema.safeParse(req.params.id);

  if (!idResult.success) {
    res.status(400).json({
      success: false,
      message: 'ID học sinh phải là UUID hợp lệ',
    });
    return;
  }

  const bodyResult = updateStudentSchema.safeParse(req.body);

  if (!bodyResult.success) {
    res.status(400).json({
      success: false,
      message: 'Thông tin học sinh không hợp lệ',
      errors: bodyResult.error.issues.map(issue => ({
        field: issue.path.join('.') || 'body',
        message: issue.message,
      })),
    });
    return;
  }

  const student = await updateStudent(idResult.data, res.locals.auth.userId, bodyResult.data);

  if (!student) {
    res.status(404).json({
      success: false,
      message: 'Không tìm thấy học sinh',
    });
    return;
  }

  res.json({
    success: true,
    message: 'Cập nhật học sinh thành công',
    data: { student: serializeStudent(student) },
  });
};

export const deleteStudentController: RequestHandler = async (req, res) => {
  const result = studentIdSchema.safeParse(req.params.id);

  if (!result.success) {
    res.status(400).json({
      success: false,
      message: 'ID học sinh phải là UUID hợp lệ',
    });
    return;
  }

  const student = await deleteStudent(result.data, res.locals.auth.userId);

  if (!student) {
    res.status(404).json({
      success: false,
      message: 'Không tìm thấy học sinh',
    });
    return;
  }

  res.json({
    success: true,
    message: 'Xóa học sinh thành công',
  });
};
