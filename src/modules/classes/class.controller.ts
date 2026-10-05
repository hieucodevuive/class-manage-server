import type { RequestHandler } from 'express';
import { classIdSchema, createClassSchema, updateClassSchema } from './class.schema';
import { createClass, deleteClass, getClassById, listClasses, updateClass } from './class.service';
import { serializeClass } from './class.response';

export const createClassController: RequestHandler = async (req, res) => {
  const result = createClassSchema.safeParse(req.body);

  if (!result.success) {
    res.status(400).json({
      success: false,
      message: 'Thông tin lớp không hợp lệ',
      errors: result.error.issues.map(issue => ({
        field: issue.path.join('.') || 'body',
        message: issue.message,
      })),
    });
    return;
  }

  const classRecord = await createClass(result.data, res.locals.auth.userId);

  res.status(201).json({
    success: true,
    message: 'Tạo lớp thành công',
    data: { class: serializeClass(classRecord) },
  });
};

export const listClassesController: RequestHandler = async (_req, res) => {
  const classes = await listClasses(res.locals.auth.userId);

  res.json({
    success: true,
    data: { classes: classes.map(serializeClass) },
  });
};

export const getClassByIdController: RequestHandler = async (req, res) => {
  const result = classIdSchema.safeParse(req.params.id);

  if (!result.success) {
    res.status(400).json({
      success: false,
      message: 'ID lớp phải là số nguyên dương không vượt quá 2147483647',
    });
    return;
  }

  const classRecord = await getClassById(result.data, res.locals.auth.userId);

  if (!classRecord) {
    res.status(404).json({
      success: false,
      message: 'Không tìm thấy lớp',
    });
    return;
  }

  res.json({
    success: true,
    data: { class: serializeClass(classRecord) },
  });
};

export const updateClassController: RequestHandler = async (req, res) => {
  const idResult = classIdSchema.safeParse(req.params.id);

  if (!idResult.success) {
    res.status(400).json({
      success: false,
      message: 'ID lớp phải là số nguyên dương không vượt quá 2147483647',
    });
    return;
  }

  const bodyResult = updateClassSchema.safeParse(req.body);

  if (!bodyResult.success) {
    res.status(400).json({
      success: false,
      message: 'Thông tin lớp không hợp lệ',
      errors: bodyResult.error.issues.map(issue => ({
        field: issue.path.join('.') || 'body',
        message: issue.message,
      })),
    });
    return;
  }

  const result = await updateClass(idResult.data, res.locals.auth.userId, bodyResult.data);

  if (result.status === 'not_found') {
    res.status(404).json({
      success: false,
      message: 'Không tìm thấy lớp',
    });
    return;
  }

  if (result.status === 'invalid_dates') {
    res.status(400).json({
      success: false,
      message: 'Thông tin lớp không hợp lệ',
      errors: [{
        field: 'endDate',
        message: 'Ngày kết thúc không được trước ngày bắt đầu',
      }],
    });
    return;
  }

  res.json({
    success: true,
    message: 'Cập nhật lớp thành công',
    data: { class: serializeClass(result.classRecord) },
  });
};

export const deleteClassController: RequestHandler = async (req, res) => {
  const result = classIdSchema.safeParse(req.params.id);

  if (!result.success) {
    res.status(400).json({
      success: false,
      message: 'ID lớp phải là số nguyên dương không vượt quá 2147483647',
    });
    return;
  }

  const deletion = await deleteClass(result.data, res.locals.auth.userId);

  if (deletion.status === 'not_found') {
    res.status(404).json({
      success: false,
      message: 'Không tìm thấy lớp',
    });
    return;
  }

  if (deletion.status === 'has_enrollments') {
    res.status(409).json({
      success: false,
      message: 'Không thể xóa lớp đã có học sinh ghi danh',
    });
    return;
  }

  res.json({
    success: true,
    message: 'Xóa lớp thành công',
  });
};
