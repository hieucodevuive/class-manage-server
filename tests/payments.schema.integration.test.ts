import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { Pool, type PoolClient } from 'pg';
import { env } from '../src/config/env';

test('Payment giữ schema tiền/tháng và bảo vệ lịch sử Enrollment', { timeout: 30000 }, async () => {
  const pool = new Pool({ connectionString: env.DATABASE_URL, connectionTimeoutMillis: 5000, statement_timeout: 5000 });
  let client: PoolClient | undefined;
  const prefix = `payment-schema-test-${randomUUID()}`;

  try {
    client = await pool.connect();
    const db = client;
    await db.query('BEGIN');

    async function expectPgError(sql: string, values: unknown[], expectedCode: string | string[]) {
      await db.query('SAVEPOINT payment_invalid_query');
      let code: string | undefined;
      try {
        await db.query(sql, values);
      } catch (error) {
        code = (error as { code?: string }).code;
      } finally {
        await db.query('ROLLBACK TO SAVEPOINT payment_invalid_query');
        await db.query('RELEASE SAVEPOINT payment_invalid_query');
      }
      assert.ok((Array.isArray(expectedCode) ? expectedCode : [expectedCode]).includes(code ?? ''),
        `SQLSTATE ${code} không khớp lỗi ràng buộc mong đợi`);
    }

    const columns = await db.query(`
      SELECT column_name, data_type, udt_name, is_nullable, numeric_precision, numeric_scale,
        datetime_precision, column_default
      FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'Payment'
      ORDER BY ordinal_position
    `);
    assert.deepEqual(columns.rows.map(row => [
      row.column_name, row.data_type, row.udt_name, row.is_nullable,
      row.numeric_precision, row.numeric_scale, row.datetime_precision,
    ]), [
      ['id', 'uuid', 'uuid', 'NO', null, null, null],
      ['classStudentId', 'uuid', 'uuid', 'NO', null, null, null],
      ['billingPeriod', 'date', 'date', 'NO', null, null, 0],
      ['amountDue', 'numeric', 'numeric', 'NO', 12, 2, null],
      ['amountPaid', 'numeric', 'numeric', 'NO', 12, 2, null],
      ['paidAt', 'timestamp with time zone', 'timestamptz', 'YES', null, null, 3],
      ['paymentMethod', 'USER-DEFINED', 'PaymentMethod', 'YES', null, null, null],
      ['note', 'text', 'text', 'YES', null, null, null],
      ['createdAt', 'timestamp with time zone', 'timestamptz', 'NO', null, null, 3],
      ['updatedAt', 'timestamp with time zone', 'timestamptz', 'NO', null, null, 3],
    ]);
    for (const column of columns.rows) {
      if (column.column_name === 'createdAt') {
        assert.match(column.column_default, /^(CURRENT_TIMESTAMP|now\(\))$/i);
      } else if (column.column_name === 'amountPaid') {
        assert.match(column.column_default, /^'?0(?:\.0+)?'?(?:::numeric)?$/i);
      } else {
        assert.equal(column.column_default, null, column.column_name);
      }
    }

    const methods = await db.query(`
      SELECT e.enumlabel FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE t.typname = 'PaymentMethod' AND n.nspname = current_schema()
      ORDER BY e.enumsortorder
    `);
    assert.deepEqual(methods.rows.map(row => row.enumlabel), ['CASH', 'BANK_TRANSFER', 'OTHER']);

    const constraints = await db.query(`
      SELECT c.conname, c.contype, c.confdeltype, c.confupdtype,
        c.confrelid::regclass::text AS target, pg_get_constraintdef(c.oid) AS definition,
        ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY k(attnum, position)
          JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum ORDER BY k.position) AS columns
      FROM pg_constraint c
      WHERE c.conrelid = '"Payment"'::regclass AND c.contype IN ('p', 'f', 'c', 'u', 'x')
      ORDER BY c.conname
    `);
    assert.deepEqual(constraints.rows.map(row => [row.conname, row.contype]), [
      ['Payment_amountDue_check', 'c'],
      ['Payment_amountPaid_check', 'c'],
      ['Payment_billingPeriod_check', 'c'],
      ['Payment_classStudentId_fkey', 'f'],
      ['Payment_pkey', 'p'],
    ]);
    assert.deepEqual(constraints.rows.find(row => row.contype === 'p').columns, ['id']);
    const foreignKey = constraints.rows.find(row => row.contype === 'f');
    assert.deepEqual(foreignKey.columns, ['classStudentId']);
    assert.equal(foreignKey.target, '"ClassStudent"');
    assert.equal(foreignKey.confdeltype, 'r');
    assert.equal(foreignKey.confupdtype, 'c');
    assert.match(foreignKey.definition, /REFERENCES "ClassStudent"\(id\)/);
    const periodCheck = constraints.rows.find(row => row.conname === 'Payment_billingPeriod_check');
    assert.deepEqual(periodCheck.columns, ['billingPeriod']);
    assert.match(periodCheck.definition, /isfinite\("billingPeriod"\)/i);
    assert.match(periodCheck.definition, /EXTRACT\(day FROM "billingPeriod"\)/i);
    for (const field of ['amountDue', 'amountPaid']) {
      const check = constraints.rows.find(row => row.conname === `Payment_${field}_check`);
      assert.deepEqual(check.columns, [field]);
      assert.match(check.definition, />=/);
      assert.match(check.definition, /<=/);
      assert.match(check.definition, /9999999999\.99/);
    }

    const indexes = await db.query(`
      SELECT idx.relname AS name, i.indisunique, i.indisprimary, i.indisvalid, i.indisready,
        pg_get_expr(i.indpred, i.indrelid) AS predicate,
        pg_get_expr(i.indexprs, i.indrelid) AS expressions,
        ARRAY(SELECT a.attname::text FROM unnest(i.indkey::smallint[]) WITH ORDINALITY k(attnum, position)
          JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum ORDER BY k.position) AS columns
      FROM pg_index i JOIN pg_class idx ON idx.oid = i.indexrelid
      WHERE i.indrelid = '"Payment"'::regclass ORDER BY idx.relname
    `);
    assert.deepEqual(indexes.rows.map(row => [row.name, row.indisunique, row.indisprimary, row.columns]), [
      ['Payment_classStudentId_billingPeriod_key', true, false, ['classStudentId', 'billingPeriod']],
      ['Payment_pkey', true, true, ['id']],
    ]);
    for (const index of indexes.rows) {
      assert.equal(index.indisvalid, true);
      assert.equal(index.indisready, true);
      assert.equal(index.predicate, null);
      assert.equal(index.expressions, null);
    }

    async function createEnrollment(suffix: string) {
      const user = await db.query(`
        INSERT INTO "User" ("email", "passwordHash", "role", "status", "createdAt", "updatedAt")
        VALUES ($1, 'test-fixture-no-login', 'TEACHER', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        RETURNING "id"
      `, [`${prefix}-${suffix}@example.test`]);
      const teacherId: number = user.rows[0].id;
      const classRecord = await db.query(`
        INSERT INTO "Class" ("teacher_id", "name", "grade", "schoolYear", "subject", "tuitionFee", "startDate", "status", "createdAt", "updatedAt")
        VALUES ($1, $2, 10, '2026-2027', 'Ngữ Văn', 500000.00, '2026-09-01', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        RETURNING "id"
      `, [teacherId, `${prefix}-${suffix}`]);
      const classId: number = classRecord.rows[0].id;
      const studentId = randomUUID();
      const enrollmentId = randomUUID();
      await db.query(`
        INSERT INTO "Student" ("id", "teacher_id", "fullName", "status", "createdAt", "updatedAt")
        VALUES ($1, $2, $3, 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `, [studentId, teacherId, `${prefix}-${suffix}-student`]);
      await db.query(`
        INSERT INTO "ClassStudent" ("id", "classId", "studentId", "joinedAt", "status", "createdAt", "updatedAt")
        VALUES ($1, $2, $3, '2026-09-01', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `, [enrollmentId, classId, studentId]);
      return { teacherId, classId, studentId, enrollmentId };
    }
    const fixtureA = await createEnrollment('a');
    const fixtureB = await createEnrollment('b');
    const unpaidId = randomUUID();
    const unpaid = await db.query(`
      INSERT INTO "Payment" ("id", "classStudentId", "billingPeriod", "amountDue", "updatedAt")
      VALUES ($1, $2, '2026-09-01', '500000.00', CURRENT_TIMESTAMP) RETURNING *
    `, [unpaidId, fixtureA.enrollmentId]);
    assert.equal(unpaid.rows[0].id, unpaidId);
    assert.equal(unpaid.rows[0].amountDue, '500000.00');
    assert.equal(unpaid.rows[0].amountPaid, '0.00');
    assert.equal(unpaid.rows[0].paidAt, null);
    assert.equal(unpaid.rows[0].paymentMethod, null);
    assert.equal(unpaid.rows[0].note, null);
    assert.ok(unpaid.rows[0].createdAt instanceof Date);
    assert.ok(unpaid.rows[0].updatedAt instanceof Date);

    const insertPayment = `
      INSERT INTO "Payment" ("id", "classStudentId", "billingPeriod", "amountDue", "amountPaid", "paidAt", "paymentMethod", "note", "updatedAt")
      VALUES ($1, $2, $3::date, $4::numeric, $5::numeric, $6::timestamptz, $7::"PaymentMethod", $8, CURRENT_TIMESTAMP)
      RETURNING *
    `;
    const secondMonth = await db.query(insertPayment, [randomUUID(), fixtureA.enrollmentId, '2026-10-01', '0.00', '9999999999.99', null, null, null]);
    assert.equal(secondMonth.rows[0].amountDue, '0.00');
    assert.equal(secondMonth.rows[0].amountPaid, '9999999999.99');
    const otherEnrollment = await db.query(insertPayment, [randomUUID(), fixtureB.enrollmentId, '2026-09-01', '9999999999.99', '9999999999.99', null, null, null]);
    assert.equal(otherEnrollment.rows[0].amountDue, '9999999999.99');
    for (const [index, method] of ['CASH', 'BANK_TRANSFER', 'OTHER'].entries()) {
      const paid = await db.query(insertPayment, [randomUUID(), fixtureA.enrollmentId, `2027-0${index + 1}-01`, '500000.00', '0.00', '2027-01-15T12:34:56.789+07:00', method, 'fixture-note']);
      assert.equal(paid.rows[0].paymentMethod, method);
      assert.equal(paid.rows[0].paidAt.toISOString(), '2027-01-15T05:34:56.789Z');
      assert.equal(paid.rows[0].note, 'fixture-note');
    }
    // Schema không đặt chính sách amountPaid <= amountDue hay bắt metadata phụ thuộc số tiền.
    function validValues(): unknown[] {
      return [randomUUID(), fixtureA.enrollmentId, '2027-04-01', '500000.00', '0.00', null, null, null];
    }
    const duplicatePeriod = validValues();
    duplicatePeriod[2] = '2026-09-01';
    await expectPgError(insertPayment, duplicatePeriod, '23505');
    await expectPgError('UPDATE "Payment" SET "billingPeriod" = $1::date WHERE "id" = $2', ['2026-09-01', secondMonth.rows[0].id], '23505');
    for (const fieldIndex of [3, 4]) {
      for (const [amount, code] of [['-0.01', '23514'], ['NaN', '23514'], ['10000000000.00', '22003']]) {
        const values = validValues();
        values[fieldIndex] = amount;
        await expectPgError(insertPayment, values, code);
      }
    }
    await expectPgError('UPDATE "Payment" SET "amountDue" = $1::numeric WHERE "id" = $2', ['-0.01', unpaidId], '23514');
    await expectPgError('UPDATE "Payment" SET "amountPaid" = $1::numeric WHERE "id" = $2', ['NaN', unpaidId], '23514');
    for (const period of ['2026-09-02', 'infinity', '-infinity']) {
      const values = validValues();
      values[2] = period;
      await expectPgError(insertPayment, values, '23514');
    }
    for (const [index, value, code] of [[1, randomUUID(), '23503'], [6, 'CARD', '22P02'], [2, null, '23502'], [0, null, '23502']] as const) {
      const values = validValues();
      values[index] = value;
      await expectPgError(insertPayment, values, code);
    }

    const selectPayments = 'SELECT * FROM "Payment" WHERE "classStudentId" IN ($1, $2) ORDER BY "id"';
    const enrollmentIds = [fixtureA.enrollmentId, fixtureB.enrollmentId];
    const snapshot = (await db.query(selectPayments, enrollmentIds)).rows;
    assert.equal(snapshot.length, 6);
    assert.deepEqual(snapshot.find(row => row.id === unpaidId), unpaid.rows[0]);
    const periods = await db.query('SELECT "billingPeriod"::text AS period FROM "Payment" WHERE "classStudentId" = $1 ORDER BY "billingPeriod"', [fixtureA.enrollmentId]);
    assert.deepEqual(periods.rows.map(row => row.period), ['2026-09-01', '2026-10-01', '2027-01-01', '2027-02-01', '2027-03-01']);
    const ownershipSql = `
      SELECT p."id" FROM "Payment" p
      JOIN "ClassStudent" e ON e."id" = p."classStudentId"
      JOIN "Class" c ON c."id" = e."classId"
      WHERE p."classStudentId" IN ($1, $2) AND c."teacher_id" = $3 ORDER BY p."id"
    `;
    for (const fixture of [fixtureA, fixtureB]) {
      assert.deepEqual((await db.query(ownershipSql, [...enrollmentIds, fixture.teacherId])).rows.map(row => row.id),
        snapshot.filter(row => row.classStudentId === fixture.enrollmentId).map(row => row.id));
    }

    await db.query('UPDATE "Class" SET "tuitionFee" = $1::numeric WHERE "id" = $2', ['600000.00', fixtureA.classId]);
    await db.query('UPDATE "ClassStudent" SET "status" = $1, "leftAt" = $2::date WHERE "id" = $3', ['LEFT', '2026-10-01', fixtureA.enrollmentId]);
    assert.deepEqual((await db.query(selectPayments, enrollmentIds)).rows, snapshot);
    const enrollmentSnapshot = (await db.query('SELECT * FROM "ClassStudent" WHERE "id" = $1', [fixtureA.enrollmentId])).rows[0];
    assert.equal(enrollmentSnapshot.status, 'LEFT');
    for (const [sql, id] of [
      ['DELETE FROM "ClassStudent" WHERE "id" = $1', fixtureA.enrollmentId],
      ['DELETE FROM "Class" WHERE "id" = $1', fixtureA.classId],
      ['DELETE FROM "Student" WHERE "id" = $1', fixtureA.studentId],
    ]) {
      await expectPgError(sql as string, [id], ['23001', '23503']);
    }
    assert.deepEqual((await db.query(selectPayments, enrollmentIds)).rows, snapshot);
    assert.deepEqual((await db.query('SELECT * FROM "ClassStudent" WHERE "id" = $1', [fixtureA.enrollmentId])).rows[0], enrollmentSnapshot);
    assert.equal((await db.query('SELECT "id" FROM "Class" WHERE "id" = $1', [fixtureA.classId])).rowCount, 1);
    assert.equal((await db.query('SELECT "id" FROM "Student" WHERE "id" = $1', [fixtureA.studentId])).rowCount, 1);
    console.log('PASS: Payment UUID/DATE/Decimal/enum, default, unique, CHECK và history RESTRICT; rollback fixture');
  } finally {
    try {
      if (client) await client.query('ROLLBACK');
    } finally {
      client?.release();
      await pool.end();
    }
  }
});
