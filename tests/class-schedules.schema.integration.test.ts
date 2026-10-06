import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { Pool, type PoolClient } from 'pg';
import { env } from '../src/config/env';

test('ClassSchedule có schema TIME đúng và bảo vệ quan hệ Class/Enrollment', { timeout: 30000 }, async () => {
  const pool = new Pool({ connectionString: env.DATABASE_URL, connectionTimeoutMillis: 5000, statement_timeout: 5000 });
  let client: PoolClient | undefined;
  const prefix = `schedule-schema-test-${randomUUID()}`;

  try {
    client = await pool.connect();
    const db = client;
    await db.query('BEGIN');

    async function expectPgError(sql: string, values: unknown[], expectedCode: string | string[]) {
      await db.query('SAVEPOINT schedule_invalid_query');
      let code: string | undefined;
      try {
        await db.query(sql, values);
      } catch (error) {
        code = (error as { code?: string }).code;
      } finally {
        await db.query('ROLLBACK TO SAVEPOINT schedule_invalid_query');
        await db.query('RELEASE SAVEPOINT schedule_invalid_query');
      }
      assert.ok((Array.isArray(expectedCode) ? expectedCode : [expectedCode]).includes(code ?? ''),
        `SQLSTATE ${code} không khớp lỗi ràng buộc mong đợi`);
    }

    const columns = await db.query(`
      SELECT column_name, data_type, udt_name, is_nullable, datetime_precision, column_default
      FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'ClassSchedule'
      ORDER BY ordinal_position
    `);
    assert.deepEqual(columns.rows.map(({ column_name, data_type, udt_name, is_nullable, datetime_precision }) => (
      [column_name, data_type, udt_name, is_nullable, datetime_precision]
    )), [
      ['id', 'uuid', 'uuid', 'NO', null],
      ['classId', 'integer', 'int4', 'NO', null],
      ['dayOfWeek', 'USER-DEFINED', 'DayOfWeek', 'NO', null],
      ['startTime', 'time without time zone', 'time', 'NO', 0],
      ['endTime', 'time without time zone', 'time', 'NO', 0],
      ['createdAt', 'timestamp with time zone', 'timestamptz', 'NO', 3],
      ['updatedAt', 'timestamp with time zone', 'timestamptz', 'NO', 3],
    ]);
    for (const column of columns.rows) {
      if (column.column_name === 'createdAt') {
        assert.match(column.column_default, /^(CURRENT_TIMESTAMP|now\(\))$/i);
      } else {
        assert.equal(column.column_default, null, column.column_name);
      }
    }

    const weekdays = await db.query(`
      SELECT e.enumlabel
      FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE t.typname = 'DayOfWeek' AND n.nspname = current_schema()
      ORDER BY e.enumsortorder
    `);
    assert.deepEqual(weekdays.rows.map(row => row.enumlabel), [
      'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY',
    ]);

    const constraints = await db.query(`
      SELECT c.conname, c.contype, c.confdeltype, c.confupdtype,
        c.confrelid::regclass::text AS target,
        pg_get_constraintdef(c.oid) AS definition,
        ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY k(attnum, position)
          JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum ORDER BY k.position) AS columns
      FROM pg_constraint c
      WHERE c.conrelid = '"ClassSchedule"'::regclass AND c.contype IN ('p', 'f', 'c', 'u', 'x')
      ORDER BY c.conname
    `);
    assert.deepEqual(constraints.rows.map(row => [row.conname, row.contype]), [
      ['ClassSchedule_classId_fkey', 'f'],
      ['ClassSchedule_pkey', 'p'],
      ['ClassSchedule_times_check', 'c'],
    ]);
    const primaryKey = constraints.rows.find(row => row.contype === 'p');
    assert.deepEqual(primaryKey.columns, ['id']);
    const foreignKey = constraints.rows.find(row => row.contype === 'f');
    assert.deepEqual(foreignKey.columns, ['classId']);
    assert.equal(foreignKey.target, '"Class"');
    assert.equal(foreignKey.confdeltype, 'c');
    assert.equal(foreignKey.confupdtype, 'c');
    assert.match(foreignKey.definition, /REFERENCES "Class"\(id\)/);

    const indexes = await db.query(`
      SELECT indexname, indexdef FROM pg_indexes
      WHERE schemaname = current_schema() AND tablename = 'ClassSchedule'
      ORDER BY indexname
    `);
    assert.deepEqual(indexes.rows.map(row => row.indexname), ['ClassSchedule_classId_idx', 'ClassSchedule_pkey']);
    assert.match(indexes.rows[0].indexdef, /CREATE INDEX .* USING btree \("classId"\)$/);

    const user = await db.query(`
      INSERT INTO "User" ("email", "passwordHash", "role", "status", "createdAt", "updatedAt")
      VALUES ($1, 'test-fixture-no-login', 'TEACHER', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      RETURNING "id"
    `, [`${prefix}@example.test`]);
    const teacherId: number = user.rows[0].id;
    async function createClass(suffix: string) {
      const result = await db.query(`
        INSERT INTO "Class" ("teacher_id", "name", "grade", "schoolYear", "subject", "tuitionFee", "startDate", "status", "createdAt", "updatedAt")
        VALUES ($1, $2, 10, '2026-2027', 'Ngữ Văn', 500000.00, '2026-09-01', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        RETURNING "id"
      `, [teacherId, `${prefix}-${suffix}`]);
      return result.rows[0].id as number;
    }
    const classId = await createClass('unused');
    const protectedClassId = await createClass('history');
    const insertSchedule = `
      INSERT INTO "ClassSchedule" ("id", "classId", "dayOfWeek", "startTime", "endTime", "updatedAt")
      VALUES ($1, $2, 'MONDAY', $3::time, $4::time, CURRENT_TIMESTAMP)
      RETURNING *
    `;
    const firstId = randomUUID();
    const secondId = randomUUID();
    const protectedScheduleId = randomUUID();
    const first = await db.query(insertSchedule, [firstId, classId, '19:00:00', '21:00:00']);
    assert.equal(first.rows[0].id, firstId);
    assert.equal(first.rows[0].startTime, '19:00:00');
    assert.equal(first.rows[0].endTime, '21:00:00');
    assert.ok(first.rows[0].createdAt instanceof Date);
    assert.ok(first.rows[0].updatedAt instanceof Date);
    // Cùng thứ, có giờ giao nhau vẫn được phép ở bước schema này.
    await db.query(insertSchedule, [secondId, classId, '19:30:00', '20:30:00']);
    await db.query(insertSchedule, [protectedScheduleId, protectedClassId, '19:00:00', '21:00:00']);
    assert.equal((await db.query('SELECT "id" FROM "ClassSchedule" WHERE "classId" = $1', [classId])).rowCount, 2);

    for (const [start, end] of [['19:00:00', '19:00:00'], ['23:00:00', '01:00:00']]) {
      await expectPgError(insertSchedule, [randomUUID(), classId, start, end], '23514');
      await expectPgError(`
        UPDATE "ClassSchedule" SET "startTime" = $1::time, "endTime" = $2::time WHERE "id" = $3
      `, [start, end, firstId], '23514');
    }
    assert.deepEqual((await db.query('SELECT * FROM "ClassSchedule" WHERE "id" = $1', [firstId])).rows[0], first.rows[0]);
    await expectPgError(insertSchedule, [randomUUID(), classId, null, '21:00:00'], '23502');

    const studentId = randomUUID();
    const enrollmentId = randomUUID();
    await db.query(`
      INSERT INTO "Student" ("id", "teacher_id", "fullName", "status", "createdAt", "updatedAt")
      VALUES ($1, $2, $3, 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `, [studentId, teacherId, `${prefix}-student`]);
    await db.query(`
      INSERT INTO "ClassStudent" ("id", "classId", "studentId", "joinedAt", "leftAt", "status", "createdAt", "updatedAt")
      VALUES ($1, $2, $3, '2026-09-01', '2026-10-01', 'LEFT', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `, [enrollmentId, protectedClassId, studentId]);
    await expectPgError('DELETE FROM "Class" WHERE "id" = $1', [protectedClassId], ['23001', '23503']);
    assert.equal((await db.query('SELECT "id" FROM "Class" WHERE "id" = $1', [protectedClassId])).rowCount, 1);
    assert.equal((await db.query('SELECT "id" FROM "ClassStudent" WHERE "id" = $1', [enrollmentId])).rowCount, 1);
    assert.equal((await db.query('SELECT "id" FROM "ClassSchedule" WHERE "id" = $1', [protectedScheduleId])).rowCount, 1);

    assert.equal((await db.query('DELETE FROM "Class" WHERE "id" = $1', [classId])).rowCount, 1);
    assert.equal((await db.query('SELECT "id" FROM "ClassSchedule" WHERE "id" IN ($1, $2)', [firstId, secondId])).rowCount, 0);
    assert.equal((await db.query('SELECT "id" FROM "ClassSchedule" WHERE "id" = $1', [protectedScheduleId])).rowCount, 1);
    await expectPgError(insertSchedule, [randomUUID(), classId, '19:00:00', '21:00:00'], '23503');
    console.log('PASS: ClassSchedule UUID/enum/TIME/timestamps, CHECK, index, cascade và Enrollment RESTRICT; rollback fixture');
  } finally {
    try {
      if (client) await client.query('ROLLBACK');
    } finally {
      client?.release();
      await pool.end();
    }
  }
});
