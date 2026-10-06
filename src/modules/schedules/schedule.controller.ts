import type { RequestHandler } from 'express';
import { classIdSchema } from '../classes/class.schema';
import { createScheduleSchema, scheduleIdSchema, updateScheduleSchema } from './schedule.schema';
import {
  createSchedule,
  deleteSchedule,
  getScheduleById,
  listClassSchedules,
  updateSchedule,
} from './schedule.service';
import { serializeSchedule } from './schedule.response';

export const createScheduleController: RequestHandler = async (req, res) => {
  const classIdResult = classIdSchema.safeParse(req.params.classId);

  if (!classIdResult.success) {
    res.status(400).json({
      success: false,
      message: 'ID lớp phải là số nguyên dương không vượt quá 2147483647',
    });
    return;
  }

  const bodyResult = createScheduleSchema.safeParse(req.body);

  if (!bodyResult.success) {
    res.status(400).json({
      success: false,
      message: 'Thông tin lịch học không hợp lệ',
      errors: bodyResult.error.issues.map(issue => ({
        field: issue.path.join('.') || 'body',
        message: issue.message,
      })),
    });
    return;
  }

  const result = await createSchedule(classIdResult.data, res.locals.auth.userId, bodyResult.data);

  if (result.status === 'class_not_found') {
    res.status(404).json({ success: false, message: 'Không tìm thấy lớp' });
    return;
  }

  res.status(201).json({
    success: true,
    message: 'Tạo lịch học thành công',
    data: { schedule: serializeSchedule(result.schedule) },
  });
};

export const listSchedulesController: RequestHandler = async (req, res) => {
  const classIdResult = classIdSchema.safeParse(req.params.classId);

  if (!classIdResult.success) {
    res.status(400).json({
      success: false,
      message: 'ID lớp phải là số nguyên dương không vượt quá 2147483647',
    });
    return;
  }

  const result = await listClassSchedules(classIdResult.data, res.locals.auth.userId);

  if (result.status === 'not_found') {
    res.status(404).json({ success: false, message: 'Không tìm thấy lớp' });
    return;
  }

  res.json({
    success: true,
    data: { schedules: result.schedules.map(serializeSchedule) },
  });
};

export const getScheduleByIdController: RequestHandler = async (req, res) => {
  const classIdResult = classIdSchema.safeParse(req.params.classId);

  if (!classIdResult.success) {
    res.status(400).json({
      success: false,
      message: 'ID lớp phải là số nguyên dương không vượt quá 2147483647',
    });
    return;
  }

  const scheduleIdResult = scheduleIdSchema.safeParse(req.params.scheduleId);

  if (!scheduleIdResult.success) {
    res.status(400).json({ success: false, message: 'ID lịch học phải là UUID hợp lệ' });
    return;
  }

  const schedule = await getScheduleById(classIdResult.data, scheduleIdResult.data, res.locals.auth.userId);

  if (!schedule) {
    res.status(404).json({ success: false, message: 'Không tìm thấy lịch học' });
    return;
  }

  res.json({ success: true, data: { schedule: serializeSchedule(schedule) } });
};

export const updateScheduleController: RequestHandler = async (req, res) => {
  const classIdResult = classIdSchema.safeParse(req.params.classId);

  if (!classIdResult.success) {
    res.status(400).json({
      success: false,
      message: 'ID lớp phải là số nguyên dương không vượt quá 2147483647',
    });
    return;
  }

  const scheduleIdResult = scheduleIdSchema.safeParse(req.params.scheduleId);

  if (!scheduleIdResult.success) {
    res.status(400).json({ success: false, message: 'ID lịch học phải là UUID hợp lệ' });
    return;
  }

  const bodyResult = updateScheduleSchema.safeParse(req.body);

  if (!bodyResult.success) {
    res.status(400).json({
      success: false,
      message: 'Thông tin lịch học không hợp lệ',
      errors: bodyResult.error.issues.map(issue => ({
        field: issue.path.join('.') || 'body',
        message: issue.message,
      })),
    });
    return;
  }

  const result = await updateSchedule(
    classIdResult.data,
    scheduleIdResult.data,
    res.locals.auth.userId,
    bodyResult.data,
  );

  if (result.status === 'not_found') {
    res.status(404).json({ success: false, message: 'Không tìm thấy lịch học' });
    return;
  }

  if (result.status === 'invalid_times') {
    res.status(400).json({
      success: false,
      message: 'Thông tin lịch học không hợp lệ',
      errors: [{ field: 'endTime', message: 'Giờ kết thúc phải sau giờ bắt đầu' }],
    });
    return;
  }

  res.json({
    success: true,
    message: 'Cập nhật lịch học thành công',
    data: { schedule: serializeSchedule(result.schedule) },
  });
};

export const deleteScheduleController: RequestHandler = async (req, res) => {
  const classIdResult = classIdSchema.safeParse(req.params.classId);

  if (!classIdResult.success) {
    res.status(400).json({
      success: false,
      message: 'ID lớp phải là số nguyên dương không vượt quá 2147483647',
    });
    return;
  }

  const scheduleIdResult = scheduleIdSchema.safeParse(req.params.scheduleId);

  if (!scheduleIdResult.success) {
    res.status(400).json({ success: false, message: 'ID lịch học phải là UUID hợp lệ' });
    return;
  }

  const result = await deleteSchedule(classIdResult.data, scheduleIdResult.data, res.locals.auth.userId);

  if (result.status === 'not_found') {
    res.status(404).json({ success: false, message: 'Không tìm thấy lịch học' });
    return;
  }

  res.json({ success: true, message: 'Xóa lịch học thành công' });
};
