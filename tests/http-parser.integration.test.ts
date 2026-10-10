import 'dotenv/config';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { test } from 'node:test';
import app from '../src/app';
import { env } from '../src/config/env';
import { prisma } from '../src/config/prisma';

test('HTTP parser giữ lỗi 400/413/415 và CORS trước parser, validation, auth, 404', { timeout: 30000 }, async () => {
  let server: Server | undefined;

  function assertCors(response: Response) {
    assert.equal(response.headers.get('access-control-allow-origin'), env.FRONTEND_ORIGIN);
    assert.equal(response.headers.get('access-control-allow-credentials'), 'true');
  }

  async function readJson(response: Response) {
    assertCors(response);
    assert.match(response.headers.get('content-type') ?? '', /^application\/json\b/i);
    const text = await response.text();
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(text);
    } catch {
      assert.fail('Response phải là JSON hợp lệ');
    }
    assert.ok(body && typeof body === 'object' && !Array.isArray(body));
    assert.equal('body' in body, false);
    assert.equal('stack' in body, false);
    return body;
  }

  async function assertError(response: Response, status: number, message: string) {
    assert.equal(response.status, status);
    const body = await readJson(response);
    assert.deepEqual(Object.keys(body).sort(), ['message', 'success']);
    assert.equal(body.success, false);
    assert.ok(body.message === message, 'Response phải dùng thông báo lỗi chung đã quy định');
  }

  try {
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const baseUrl = `http://127.0.0.1:${address.port}/api`;

    function post(body: string, headers: Record<string, string> = {}) {
      return fetch(`${baseUrl}/auth/register`, {
        method: 'POST',
        headers: { Origin: env.FRONTEND_ORIGIN, 'Content-Type': 'application/json', ...headers },
        body,
      });
    }

    await assertError(await post('{"parserTest":'), 400, 'Body JSON không hợp lệ');
    const oversized = JSON.stringify({ parserTest: 'x'.repeat(101 * 1024) });
    assert.ok(Buffer.byteLength(oversized, 'utf8') > 100 * 1024);
    await assertError(await post(oversized), 413, 'Body JSON vượt quá giới hạn cho phép');
    await assertError(await post('{}', { 'Content-Type': 'application/json; charset=iso-8859-1' }),
      415, 'Charset hoặc encoding của body không được hỗ trợ');
    await assertError(await post('{}', { 'Content-Encoding': 'unsupported' }),
      415, 'Charset hoặc encoding của body không được hỗ trợ');

    // Body JSON sai cố ý: preflight phải kết thúc trước khi parser đọc body.
    const preflight = await fetch(`${baseUrl}/auth/register`, {
      method: 'OPTIONS',
      headers: {
        Origin: env.FRONTEND_ORIGIN,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type',
        'Content-Type': 'application/json',
      },
      body: '{',
    });
    assert.equal(preflight.status, 204);
    assertCors(preflight);
    assert.ok(preflight.headers.get('access-control-allow-methods')?.split(',').includes('POST'));
    assert.equal(preflight.headers.get('access-control-allow-headers'), 'content-type');
    assert.equal(await preflight.text(), '');

    // JSON hợp lệ nhưng thiếu dữ liệu: dừng ở validation, không tạo tài khoản.
    const validationResponse = await post('{}');
    assert.equal(validationResponse.status, 400);
    const validation = await readJson(validationResponse);
    assert.equal(validation.success, false);
    assert.ok(validation.message === 'Thông tin đăng ký không hợp lệ');
    assert.ok(Array.isArray(validation.errors) && validation.errors.length > 0);
    assert.deepEqual(Object.keys(validation).sort(), ['errors', 'message', 'success']);

    await assertError(await fetch(`${baseUrl}/classes`, { headers: { Origin: env.FRONTEND_ORIGIN } }),
      401, 'Thiếu access token');
    await assertError(await fetch(`${baseUrl}/http-parser-test-not-found`, { headers: { Origin: env.FRONTEND_ORIGIN } }),
      404, 'Không tìm thấy API');
  } finally {
    try {
      if (server) {
        await new Promise<void>((resolve, reject) => {
          server!.close(error => error ? reject(error) : resolve());
        });
      }
    } finally {
      await prisma.$disconnect();
    }
  }
});
