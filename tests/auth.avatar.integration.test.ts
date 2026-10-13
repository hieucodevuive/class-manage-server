import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { Writable } from 'node:stream';
import { test } from 'node:test';
import type { Prisma, User } from '../src/generated/prisma/client';

test('PATCH hồ sơ gộp name/avatar, kiểm ảnh thật, CAS và giữ dữ liệu khi dịch vụ hoặc DB lỗi', { timeout: 45000 }, async t => {
  // Fake settings và SDK mock được đặt trước dynamic import app; không dùng credential thật hoặc gọi Cloudinary.
  const settings = {
    CLOUDINARY_CLOUD_NAME: 'avatar-integration-cloud', CLOUDINARY_API_KEY: 'avatar-test-key',
    CLOUDINARY_API_SECRET: 'avatar-test-secret', PUBLIC_API_ORIGIN: 'https://avatar-default.example.test',
    DEFAULT_AVATAR_URL: undefined,
  };
  const originalSettings = Object.fromEntries(Object.keys(settings).map(key => [key, process.env[key]]));
  for (const [key, value] of Object.entries(settings)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  const cloudinary = (await import('cloudinary')).v2;
  const sharp = (await import('sharp')).default;
  type UploadOptions = { public_id: string; cloud_name: string; overwrite: boolean; resource_type: string; format: string };
  type Upload = { publicId: string; url: string; image: Buffer; options: UploadOptions };
  type Mode = 'success' | 'failure' | 'collision' | 'bad-url' | 'race';
  const uploads: Upload[] = [];
  const destroys: string[] = [];
  const destroyFailures = new Set<string>();
  const pendingReplies: Array<() => void> = [];
  let mode: Mode = 'success';
  let beforeReply: (() => Promise<void>) | undefined;
  let barrierTimer: ReturnType<typeof setTimeout> | undefined;
  let hookFailed = false;
  const providerFailure = 'private-provider-error-avatar-test';

  const fakeUpload = (options: UploadOptions, callback: (error: unknown, result?: unknown) => void) => {
    const selectedMode = mode;
    const hook = beforeReply;
    beforeReply = undefined;
    const chunks: Buffer[] = [];
    return new Writable({
      write(chunk, _encoding, done) { chunks.push(Buffer.from(chunk)); done(); },
      final(done) {
        const upload = {
          publicId: options.public_id,
          url: `https://res.cloudinary.com/${options.cloud_name}/image/upload/v1/${options.public_id}.webp`,
          image: Buffer.concat(chunks), options,
        };
        uploads.push(upload);
        const complete = () => {
          if (selectedMode === 'failure') callback({ message: providerFailure });
          else callback(null, {
            public_id: upload.publicId,
            secure_url: selectedMode === 'bad-url' ? 'https://example.test/untrusted-provider-image.webp' : upload.url,
            existing: selectedMode === 'collision',
          });
          done();
        };
        if (selectedMode === 'race') {
          pendingReplies.push(complete);
          if (pendingReplies.length === 2) {
            if (barrierTimer) clearTimeout(barrierTimer);
            pendingReplies.splice(0).forEach(reply => reply());
          } else {
            barrierTimer = setTimeout(() => pendingReplies.splice(0).forEach(reply => reply()), 5000);
          }
          return;
        }
        Promise.resolve().then(() => hook?.()).then(complete, () => {
          hookFailed = true;
          callback({ message: 'Fixture hook failed' });
          done();
        });
      },
    });
  };
  t.mock.method(cloudinary.uploader, 'upload_stream', fakeUpload as unknown as typeof cloudinary.uploader.upload_stream);
  t.mock.method(cloudinary.uploader, 'destroy', (async (publicId: string) => {
    destroys.push(publicId);
    if (destroyFailures.has(publicId)) throw new Error(providerFailure);
    return { result: 'ok' };
  }) as unknown as typeof cloudinary.uploader.destroy);
  // Runtime chỉ warn thông báo cố định; giữ output test không có raw SDK/DB errors.
  t.mock.method(console, 'warn', () => {});

  const app = (await import('../src/app')).default;
  const { prisma } = await import('../src/config/prisma');
  const { env } = await import('../src/config/env');
  const { createAccessToken } = await import('../src/utils/jwt');
  const bcrypt = (await import('bcryptjs')).default;
  const prefix = `auth-avatar-${randomUUID()}`;
  const emails = ['a', 'b', 'admin', 'pending'].map(suffix => `${prefix}-${suffix}@example.test`);
  const password = 'Avatar-test-password-123!';
  const defaultAvatar = 'https://avatar-default.example.test/api/assets/default-avatar.svg';
  let server: Server | undefined;
  let restoreUserUpdate: (() => void) | undefined;

  function assertKeys(value: unknown, keys: string[], message: string): asserts value is Record<string, unknown> {
    assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value), message);
    assert.ok(Object.keys(value).sort().join('|') === [...keys].sort().join('|'), message);
  }
  function assertPublicUser(value: unknown, user: User, avatar: string, name = user.name) {
    assertKeys(value, ['id', 'email', 'name', 'avatar', 'role'], 'User chỉ có năm field công khai');
    assert.ok(value.id === user.id && value.email === user.email && value.name === name
      && value.role === user.role && value.avatar === avatar, 'Response phải đúng User và URL avatar hiện tại');
  }
  function sameUser(actual: User, expected: User) {
    return actual.id === expected.id && actual.email === expected.email && actual.name === expected.name
      && actual.avatar === expected.avatar && actual.role === expected.role && actual.status === expected.status
      && actual.passwordHash === expected.passwordHash && actual.createdAt.getTime() === expected.createdAt.getTime()
      && actual.updatedAt.getTime() === expected.updatedAt.getTime();
  }
  function preserveAccount(actual: User, before: User, name = before.name) {
    assert.ok(actual.id === before.id && actual.email === before.email && actual.name === name
      && actual.role === before.role && actual.status === before.status && actual.passwordHash === before.passwordHash
      && actual.createdAt.getTime() === before.createdAt.getTime(), 'Avatar chỉ được thay ảnh và updatedAt của tài khoản fixture');
  }

  try {
    const passwordHash = await bcrypt.hash(password, 4);
    const users: User[] = [];
    for (const [index, email] of emails.entries()) {
      users.push(await prisma.user.create({ data: {
        email, name: email, passwordHash, role: index === 2 ? 'ADMIN' : 'TEACHER',
        status: index === 3 ? 'PENDING' : 'ACTIVE',
      } }));
    }
    const [userA, userB, admin, pending] = users as [User, User, User, User];
    const tokenA = createAccessToken(userA);
    const tokenB = createAccessToken(userB);
    const tokenAdmin = createAccessToken(admin);
    const tokenPending = createAccessToken(pending);
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const baseUrl = `http://127.0.0.1:${address.port}`;

    async function send(body?: BodyInit, token?: string, contentType?: string, query = '') {
      const response = await fetch(`${baseUrl}/api/auth/me${query}`, {
        method: 'PATCH', body,
        headers: {
          Origin: env.FRONTEND_ORIGIN,
          ...(token === undefined ? {} : { Authorization: `Bearer ${token}` }),
          ...(contentType === undefined ? {} : { 'Content-Type': contentType }),
        },
      });
      assert.equal(response.headers.get('access-control-allow-origin'), env.FRONTEND_ORIGIN);
      assert.equal(response.headers.get('access-control-allow-credentials'), 'true');
      assert.ok(response.headers.get('set-cookie') === null, 'Upload avatar không được cấp refresh cookie');
      return { status: response.status, body: await response.json() };
    }
    function form(image: Buffer, mime = 'image/png', field = 'avatar', filename = 'avatar.png', name?: string) {
      const data = new FormData();
      data.append(field, new Blob([new Uint8Array(image)], { type: mime }), filename);
      if (name !== undefined) data.append('name', name);
      return data;
    }
    async function denied(body: BodyInit | undefined, status: number, message: string, token: string | null = tokenA, contentType?: string) {
      const result = await send(body, token ?? undefined, contentType);
      assert.equal(result.status, status);
      assertKeys(result.body, ['success', 'message'], 'Lỗi avatar phải có envelope cố định, không raw body/SDK/stack');
      assert.ok(result.body.success === false && result.body.message === message, 'Lỗi avatar phải dùng thông báo đã quy định');
      return result;
    }
    async function invalidProfile(body: FormData, field: string, issueMessage: string) {
      const result = await send(body, tokenA);
      assert.equal(result.status, 400);
      assertKeys(result.body, ['success', 'message', 'errors'], 'Validation hồ sơ phải trả errors, không raw input');
      assert.ok(result.body.success === false && result.body.message === 'Thông tin tài khoản không hợp lệ', 'Validation phải dùng thông báo cố định');
      assert.ok(Array.isArray(result.body.errors) && result.body.errors.some((issue: { field: string; message: string }) =>
        issue.field === field && issue.message === issueMessage), 'Validation phải chỉ đúng field và quy tắc');
    }
    async function success(image: Buffer, token: string, user: User, mime = 'image/png', query = '', name = user.name, inputName?: string) {
      const result = await send(form(image, mime, 'avatar', 'avatar.png', inputName), token, undefined, query);
      assert.equal(result.status, 200);
      assertKeys(result.body, ['success', 'message', 'data'], 'Upload thành công phải trả đúng envelope');
      assert.ok(result.body.success === true && result.body.message === 'Cập nhật thông tin tài khoản thành công', 'PATCH hồ sơ phải trả thông báo thành công');
      assertKeys(result.body.data, ['user'], 'Upload chỉ trả public User');
      const uploaded = uploads.at(-1)!;
      assertPublicUser(result.body.data.user, user, uploaded.url, name);
      const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      assert.ok(stored.avatar === uploaded.url, 'DB phải lưu URL ảnh riêng, không lưu bytes hoặc public ID');
      preserveAccount(stored, user, name);
      return uploaded;
    }
    const png = await sharp({ create: { width: 80, height: 60, channels: 4, background: '#33669988' } }).png().toBuffer();
    const jpeg = await sharp({ create: { width: 400, height: 300, channels: 3, background: '#aa7733' } })
      .withMetadata({ orientation: 6 }).jpeg().toBuffer();
    const webp = await sharp({ create: { width: 90, height: 120, channels: 3, background: '#557744' } }).webp().toBuffer();

    const asset = await fetch(`${baseUrl}/api/assets/default-avatar.svg`);
    assert.equal(asset.status, 200);
    assert.match(asset.headers.get('content-type') ?? '', /^image\/svg\+xml\b/);
    for (const [user, token] of [[userA, tokenA], [userB, tokenB], [admin, tokenAdmin]] as const) {
      const response = await fetch(`${baseUrl}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
      assert.equal(response.status, 200);
      assertPublicUser((await response.json()).data.user, user, defaultAvatar);
      assert.ok(user.avatar === null, 'Fixture chưa có ảnh phải lưu null');
    }
    await denied(form(png), 401, 'Thiếu access token', null);
    await denied(form(png), 401, 'Access token không hợp lệ hoặc đã hết hạn', 'invalid-token');
    await denied(form(png), 403, 'Tài khoản đang chờ duyệt', tokenPending);
    await denied('not-json-or-multipart', 415, 'Cập nhật tài khoản phải dùng application/json hoặc multipart/form-data', tokenA, 'text/plain');
    await invalidProfile(new FormData(), 'body', 'Cần gửi name hoặc một file avatar');
    await invalidProfile(form(png, 'image/png', 'avatar', 'avatar.png', ' \t '), 'name', 'Tên không được để trống');
    await invalidProfile(form(png, 'image/png', 'avatar', 'avatar.png', '😀'.repeat(151)), 'name', 'Tên không được vượt quá 150 ký tự');
    await denied(form(Buffer.alloc(0), 'image/png', 'avatar', 'avatar.png', 'Không được đổi tên'), 400, 'Vui lòng gửi một file avatar');
    await denied('not-a-multipart-body', 400, 'Dữ liệu cập nhật tài khoản không hợp lệ', tokenA, 'multipart/form-data; boundary=broken-avatar-boundary');
    await denied(form(png, 'image/png', 'photo'), 400, 'Chỉ gửi field name và một file avatar');
    const extra = form(png); extra.append('userId', String(userB.id));
    await denied(extra, 400, 'Chỉ gửi field name và một file avatar');
    const multiple = form(png); multiple.append('avatar', new Blob([new Uint8Array(png)], { type: 'image/png' }), 'second.png');
    await denied(multiple, 400, 'Chỉ gửi field name và một file avatar');
    const duplicatedName = new FormData(); duplicatedName.append('name', 'Tên thứ nhất'); duplicatedName.append('name', 'Tên thứ hai');
    await denied(duplicatedName, 400, 'Chỉ gửi field name và một file avatar');
    const textAvatar = new FormData(); textAvatar.append('avatar', 'https://example.test/avatar.webp');
    await denied(textAvatar, 400, 'Chỉ gửi field name và một file avatar');
    for (const mime of ['image/svg+xml', 'image/gif', 'application/octet-stream']) {
      await denied(form(png, mime), 415, 'Chỉ chấp nhận ảnh JPEG, PNG hoặc WebP');
    }
    await denied(form(Buffer.from('not an image'), 'image/png', 'avatar', 'avatar.png', 'Tên không được lưu khi ảnh sai'), 400, 'File ảnh không hợp lệ');
    await denied(form(png, 'image/jpeg', 'avatar', 'avatar.jpg', 'Tên không được lưu khi MIME sai'), 400, 'Nội dung file không khớp định dạng ảnh');
    const tooLarge = Buffer.concat([png, Buffer.alloc(2 * 1024 * 1024 + 1 - png.length)]);
    await denied(form(tooLarge, 'image/png', 'avatar', 'avatar.png', 'Tên không được lưu khi quá lớn'), 413, 'Ảnh không được vượt quá 2 MiB');
    const tooManyPixels = await sharp({ create: { width: 5000, height: 4001, channels: 3, background: '#ffffff' } }).png().toBuffer();
    await denied(form(tooManyPixels, 'image/png', 'avatar', 'avatar.png', 'Tên không được lưu khi quá nhiều pixels'), 400, 'File ảnh không hợp lệ');
    const secret = env.CLOUDINARY_API_SECRET;
    try {
      env.CLOUDINARY_API_SECRET = undefined;
      await denied(form(png, 'image/png', 'avatar', 'avatar.png', 'Tên không được lưu khi thiếu cấu hình'), 503, 'Dịch vụ avatar chưa được cấu hình');
    } finally { env.CLOUDINARY_API_SECRET = secret; }
    assert.ok(uploads.length === 0 && destroys.length === 0, 'Auth/validation/config lỗi không được gọi provider');
    for (const user of users) assert.ok(sameUser(await prisma.user.findUniqueOrThrow({ where: { id: user.id } }), user), 'Request bị từ chối không được sửa fixture');

    const first = await success(png, tokenA, userA, 'image/png', `?userId=${userB.id}&teacherId=${userB.id}`);
    assert.ok(destroys.length === 0, 'Ảnh mặc định không phải tài nguyên riêng để xóa');
    // Name + URL mới được gửi trong đúng một Prisma update sau khi upload thành công.
    const originalCombinedUpdate = prisma.user.update;
    const nativeCombinedUpdate = originalCombinedUpdate.bind(prisma.user);
    let combinedWrites = 0;
    restoreUserUpdate = () => { prisma.user.update = originalCombinedUpdate; };
    const combinedName = 'Tên và ảnh trong một lần lưu';
    prisma.user.update = (async (args: Prisma.UserUpdateArgs) => {
      if (args.where.id === userB.id && (args.data.name !== undefined || args.data.avatar !== undefined)) {
        combinedWrites += 1;
        assert.ok(args.data.name === combinedName && typeof args.data.avatar === 'string', 'Cả name/avatar phải cùng có trong một lần ghi');
      }
      return nativeCombinedUpdate(args);
    }) as unknown as typeof prisma.user.update;
    let bUpload: Upload;
    try { bUpload = await success(jpeg, tokenB, userB, 'image/jpeg', '', combinedName, `  ${combinedName}  `); }
    finally { restoreUserUpdate(); }
    assert.ok(combinedWrites === 1, 'Một request cập nhật cả name/avatar chỉ ghi User một lần');
    const adminUpload = await success(webp, tokenAdmin, admin, 'image/webp');
    const jpegOutput = await sharp(bUpload.image).metadata();
    assert.ok(jpegOutput.format === 'webp' && jpegOutput.width === 256 && jpegOutput.height === 256 && jpegOutput.exif === undefined,
      'Ảnh thật phải được chuẩn hóa 256x256 WebP và bỏ EXIF');
    for (const upload of uploads) {
      assert.ok(/^class-management\/avatars\/\d+\/[a-f0-9-]{36}$/.test(upload.publicId)
        && upload.options.overwrite === false && upload.options.resource_type === 'image' && upload.options.format === 'webp',
      'Public ID phải do server tạo trong namespace riêng với overwrite:false');
    }
    assert.ok(first.publicId.startsWith(`class-management/avatars/${userA.id}/`), 'Query không đổi target khỏi User JWT');
    assert.ok((await prisma.user.findUniqueOrThrow({ where: { id: userB.id } })).avatar === bUpload.url, 'Upload A không sửa ảnh B');
    // Multipart chỉ có name không phụ thuộc Cloudinary và giữ ảnh đã lưu.
    const beforeNameOnly = await prisma.user.findUniqueOrThrow({ where: { id: admin.id } });
    const nameOnly = '😀'.repeat(150);
    const nameOnlyForm = new FormData(); nameOnlyForm.append('name', `  ${nameOnly}  `);
    const beforeNameUploads = uploads.length;
    const beforeNameDeletes = destroys.length;
    try {
      env.CLOUDINARY_API_SECRET = undefined;
      const result = await send(nameOnlyForm, tokenAdmin);
      assert.equal(result.status, 200);
      assertKeys(result.body, ['success', 'message', 'data'], 'Name-only multipart phải trả đúng envelope');
      assert.ok(result.body.success === true && result.body.message === 'Cập nhật thông tin tài khoản thành công', 'Name-only multipart phải thành công khi thiếu Cloudinary');
      assertKeys(result.body.data, ['user'], 'Name-only multipart chỉ trả public User');
      assertPublicUser(result.body.data.user, admin, adminUpload.url, nameOnly);
    } finally { env.CLOUDINARY_API_SECRET = secret; }
    const afterNameOnly = await prisma.user.findUniqueOrThrow({ where: { id: admin.id } });
    preserveAccount(afterNameOnly, beforeNameOnly, nameOnly);
    assert.ok(afterNameOnly.avatar === beforeNameOnly.avatar && uploads.length === beforeNameUploads && destroys.length === beforeNameDeletes,
      'Không gửi file phải giữ avatar và không gọi upload/destroy');
    const atLimit = Buffer.concat([png, Buffer.alloc(2 * 1024 * 1024 - png.length)]);
    const replacement = await success(atLimit, tokenA, userA);
    assert.ok(destroys.includes(first.publicId) && !destroys.includes(replacement.publicId), 'Thay avatar chỉ xóa ảnh cũ đáng tin của chính User');

    // Ảnh cũ trỏ namespace của B không được xóa khi A thay ảnh.
    await prisma.user.update({ where: { id: userA.id }, data: { avatar: bUpload.url } });
    const deleteCount = destroys.length;
    const ownAgain = await success(png, tokenA, userA);
    assert.ok(destroys.length === deleteCount && !destroys.includes(bUpload.publicId), 'Không xóa asset của User khác dù URL có trong User A');
    destroyFailures.add(ownAgain.publicId);
    const retained = await success(png, tokenA, userA);
    destroyFailures.delete(ownAgain.publicId);
    assert.ok(destroys.includes(ownAgain.publicId) && !destroys.includes(retained.publicId), 'Cleanup ảnh cũ lỗi vẫn giữ ảnh mới đã lưu');

    const beforeProviderErrors = await prisma.user.findUniqueOrThrow({ where: { id: userA.id } });
    mode = 'failure';
    await denied(form(png, 'image/png', 'avatar', 'avatar.png', 'Tên không được lưu khi provider lỗi'), 502, 'Không thể upload avatar, vui lòng thử lại');
    const beforeCollision = destroys.length;
    mode = 'collision';
    await denied(form(png, 'image/png', 'avatar', 'avatar.png', 'Tên không được lưu khi ID trùng'), 502, 'Không thể upload avatar, vui lòng thử lại');
    assert.ok(destroys.length === beforeCollision, 'existing:true không được xóa asset có sẵn');
    mode = 'bad-url';
    await denied(form(png, 'image/png', 'avatar', 'avatar.png', 'Tên không được lưu khi URL sai'), 502, 'Không thể upload avatar, vui lòng thử lại');
    assert.ok(destroys.includes(uploads.at(-1)!.publicId), 'Response URL sai chỉ dọn ID mới đã xác nhận thuộc request');
    mode = 'success';
    assert.ok(sameUser(await prisma.user.findUniqueOrThrow({ where: { id: userA.id } }), beforeProviderErrors), 'Provider lỗi không được đổi User');

    // Hai upload đều đã đọc cùng avatar trước khi fake provider trả lời; ghi thật trong DB vẫn dùng CAS.
    const beforeRace = await prisma.user.findUniqueOrThrow({ where: { id: userA.id } });
    const raceStart = uploads.length;
    const raceDeletes = destroys.length;
    mode = 'race';
    const raceNames = ['Hồ sơ đồng thời thứ nhất', 'Hồ sơ đồng thời thứ hai'];
    const results = await Promise.all(raceNames.map(name => send(form(png, 'image/png', 'avatar', 'avatar.png', name), tokenA)));
    mode = 'success';
    assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
    const winnerIndex = results.findIndex(result => result.status === 200);
    const winner = results[winnerIndex]!;
    const loser = results.find(result => result.status === 409)!;
    assertKeys(loser.body, ['success', 'message'], 'CAS conflict phải trả envelope lỗi cố định');
    assert.ok(loser.body.message === 'Avatar đã thay đổi, vui lòng tải lại và thử lại' && loser.body.success === false, 'CAS conflict phải yêu cầu tải lại');
    const raceUploads = uploads.slice(raceStart);
    assert.ok(raceUploads.length === 2 && new Set(raceUploads.map(upload => upload.publicId)).size === 2, 'Mỗi upload đồng thời phải có public ID mới riêng');
    const winnerUpload = raceUploads.find(upload => upload.url === winner.body.data.user.avatar)!;
    const loserUpload = raceUploads.find(upload => upload !== winnerUpload)!;
    const afterRace = await prisma.user.findUniqueOrThrow({ where: { id: userA.id } });
    assertPublicUser(winner.body.data.user, userA, winnerUpload.url, raceNames[winnerIndex]!);
    assert.ok(afterRace.avatar === winnerUpload.url && afterRace.name === raceNames[winnerIndex] && !destroys.slice(raceDeletes).includes(winnerUpload.publicId)
      && destroys.slice(raceDeletes).includes(loserUpload.publicId), 'CAS chỉ giữ ảnh thắng và dọn candidate thua');
    preserveAccount(afterRace, beforeRace, raceNames[winnerIndex]!);

    // Name thay đổi trong lúc upload vẫn được giữ: CAS avatar không khóa updatedAt/name.
    const newName = 'Tên đổi trong lúc upload';
    beforeReply = async () => {
      const response = await fetch(`${baseUrl}/api/auth/me`, { method: 'PATCH', headers: {
        Authorization: `Bearer ${tokenA}`, 'Content-Type': 'application/json',
      }, body: JSON.stringify({ name: newName }) });
      assert.equal(response.status, 200);
    };
    await success(png, tokenA, userA, 'image/png', '', newName);
    assert.ok(!hookFailed, 'Hook đổi name phải hoàn tất');
    const namedUser = await prisma.user.findUniqueOrThrow({ where: { id: userA.id } });

    // Lỗi kết nối không rõ commit: giữ candidate; nếu DB đã commit thì reconcile trả success.
    // Prisma delegate là Proxy; assignment/restore giống seam dùng trong test Payment.
    const originalUpdate = prisma.user.update;
    const realUpdate = originalUpdate.bind(prisma.user);
    restoreUserUpdate = () => { prisma.user.update = originalUpdate; };
    const requestedName = 'Tên kèm avatar khi ghi';
    const renamedAfterCommit = 'Tên đổi sau khi đã ghi avatar';
    for (const committed of [false, true]) {
      const before = await prisma.user.findUniqueOrThrow({ where: { id: userA.id } });
      const destroyStart = destroys.length;
      prisma.user.update = (async (args: Prisma.UserUpdateArgs) => {
        if (args.where.id === userA.id && args.data.avatar !== undefined) {
          if (committed) {
            await realUpdate(args);
            // Một cập nhật tên sau commit không phủ nhận lần ghi name+URL trước đó.
            await realUpdate({ where: { id: userA.id }, data: { name: renamedAfterCommit } });
          }
          throw new Error('Private DB failure in fixture');
        }
        return realUpdate(args);
      }) as unknown as typeof prisma.user.update;
      try {
        if (committed) await success(png, tokenA, namedUser, 'image/png', '', renamedAfterCommit, requestedName);
        else await denied(form(png, 'image/png', 'avatar', 'avatar.png', requestedName), 500, 'Không thể lưu thông tin tài khoản');
      } finally { restoreUserUpdate(); }
      const candidate = uploads.at(-1)!;
      assert.ok(!destroys.slice(destroyStart).includes(candidate.publicId), 'Không xóa candidate khi commit chưa rõ hoặc URL đã được lưu');
      const after = await prisma.user.findUniqueOrThrow({ where: { id: userA.id } });
      if (committed) assert.ok(after.avatar === candidate.url, 'Reconcile phải giữ ảnh đã commit');
      else assert.ok(sameUser(after, before), 'DB thất bại trước ghi không được đổi User');
    }

    const avatarBeforePending = (await prisma.user.findUniqueOrThrow({ where: { id: admin.id } })).avatar;
    beforeReply = async () => { await prisma.user.update({ where: { id: admin.id }, data: { status: 'PENDING' } }); };
    await denied(form(png), 403, 'Tài khoản đang chờ duyệt', tokenAdmin);
    assert.ok(destroys.includes(uploads.at(-1)!.publicId)
      && (await prisma.user.findUniqueOrThrow({ where: { id: admin.id } })).avatar === avatarBeforePending, 'CAS phải chặn PENDING và dọn candidate');
    await prisma.user.update({ where: { id: admin.id }, data: { status: 'ACTIVE' } });
    beforeReply = async () => {
      await prisma.refreshToken.deleteMany({ where: { userId: userB.id } });
      await prisma.user.delete({ where: { id: userB.id } });
    };
    await denied(form(png), 401, 'Tài khoản không còn tồn tại', tokenB);
    assert.ok(destroys.includes(uploads.at(-1)!.publicId), 'User mất sau upload phải dọn candidate chưa được lưu');
    assert.ok(!hookFailed, 'Hook race chỉ được thao tác fixture của test');
    assert.ok(sameUser(await prisma.user.findUniqueOrThrow({ where: { id: pending.id } }), pending), 'PENDING fixture khác phải giữ nguyên');

    const login = await fetch(`${baseUrl}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: userA.email, password }) });
    assert.equal(login.status, 200);
    const loginBody = await login.json();
    assertKeys(loginBody.data, ['user', 'accessToken'], 'Login vẫn dùng data User/token hiện có');
    const current = await prisma.user.findUniqueOrThrow({ where: { id: userA.id } });
    assertPublicUser(loginBody.data.user, current, current.avatar!);
    const cookie = login.headers.get('set-cookie');
    assert.ok(typeof cookie === 'string' && cookie.startsWith('refreshToken='), 'Login vẫn cấp cookie phiên');
    const refresh = await fetch(`${baseUrl}/api/auth/refresh`, { method: 'POST', headers: { Cookie: cookie.split(';')[0]! } });
    assert.equal(refresh.status, 200);
    const refreshBody = await refresh.json();
    assertKeys(refreshBody.data, ['user', 'accessToken'], 'Refresh phải giữ cấu trúc data');
    assertPublicUser(refreshBody.data.user, current, current.avatar!);
  } finally {
    restoreUserUpdate?.();
    if (barrierTimer) clearTimeout(barrierTimer);
    pendingReplies.splice(0).forEach(reply => reply());
    try {
      // Exact email UUID vẫn tìm được User đã commit trước khi assertion/setup lỗi.
      const users = await prisma.user.findMany({ where: { email: { in: emails } }, select: { id: true } });
      const userIds = users.map(user => user.id);
      if (userIds.length) {
        await prisma.refreshToken.deleteMany({ where: { userId: { in: userIds } } });
        await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      }
    } finally {
      try {
        if (server) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
      } finally {
        await prisma.$disconnect();
        t.mock.restoreAll();
        for (const [key, value] of Object.entries(originalSettings)) {
          if (value === undefined) delete process.env[key];
          else process.env[key] = value;
        }
      }
    }
  }
});
