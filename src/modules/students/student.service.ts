import type { CreateStudentInput, UpdateStudentInput } from './student.schema';
import {
  deleteStudentById,
  findStudentById,
  findStudents,
  insertStudent,
  updateStudentById,
} from './student.repository';

export function createStudent(data: CreateStudentInput, teacherId: number) {
  return insertStudent({
    teacher: { connect: { id: teacherId } },
    fullName: data.fullName,
    phone: data.phone ?? null,
    parentName: data.parentName ?? null,
    parentPhone: data.parentPhone ?? null,
    school: data.school ?? null,
    grade: data.grade ?? null,
    dateOfBirth: data.dateOfBirth
      ? new Date(`${data.dateOfBirth}T00:00:00.000Z`)
      : null,
    address: data.address ?? null,
    status: data.status,
    note: data.note ?? null,
  });
}

export function listStudents(teacherId: number) {
  return findStudents(teacherId);
}

export function getStudentById(id: string, teacherId: number) {
  return findStudentById(id, teacherId);
}

export function updateStudent(id: string, teacherId: number, data: UpdateStudentInput) {
  return updateStudentById(id, teacherId, {
    fullName: data.fullName,
    phone: data.phone,
    parentName: data.parentName,
    parentPhone: data.parentPhone,
    school: data.school,
    grade: data.grade,
    dateOfBirth: data.dateOfBirth === undefined
      ? undefined
      : data.dateOfBirth === null ? null : new Date(`${data.dateOfBirth}T00:00:00.000Z`),
    address: data.address,
    status: data.status,
    note: data.note,
  });
}

export function deleteStudent(id: string, teacherId: number) {
  return deleteStudentById(id, teacherId);
}
