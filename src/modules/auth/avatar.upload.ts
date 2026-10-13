import type { RequestHandler } from 'express';
import multer from 'multer';

export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
export const AVATAR_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

class UnsupportedAvatarType extends Error {}
const receiveAvatar = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_AVATAR_BYTES + 1, files: 1, fields: 1, parts: 2, fieldNameSize: 100 },
  fileFilter: (_req, file, callback) => {
    if (!(AVATAR_MIME_TYPES as readonly string[]).includes(file.mimetype)) {
      callback(new UnsupportedAvatarType());
      return;
    }
    callback(null, true);
  },
}).single('avatar');

export const parseProfileUploadMiddleware: RequestHandler = (req, res, next) => {
  if (!req.is('multipart/form-data')) {
    // Giữ JSON đổi tên hiện có; request không có body để Zod trả lỗi như trước.
    if (!req.headers['content-type'] || req.is('application/json')) {
      next();
      return;
    }
    res.status(415).json({ success: false, message: 'Cập nhật tài khoản phải dùng application/json hoặc multipart/form-data' });
    return;
  }
  receiveAvatar(req, res, error => {
    if (error instanceof UnsupportedAvatarType) {
      res.status(415).json({ success: false, message: 'Chỉ chấp nhận ảnh JPEG, PNG hoặc WebP' });
      return;
    }
    if (error) {
      if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
        res.status(413).json({ success: false, message: 'Ảnh không được vượt quá 2 MiB' });
      } else if (error instanceof multer.MulterError) {
        res.status(400).json({ success: false, message: 'Chỉ gửi field name và một file avatar' });
      } else {
        res.status(400).json({ success: false, message: 'Dữ liệu cập nhật tài khoản không hợp lệ' });
      }
      return;
    }
    if (req.file && req.file.size === 0) {
      res.status(400).json({ success: false, message: 'Vui lòng gửi một file avatar' });
      return;
    }
    if (req.file && req.file.size > MAX_AVATAR_BYTES) {
      res.status(413).json({ success: false, message: 'Ảnh không được vượt quá 2 MiB' });
      return;
    }
    if (Object.keys(req.body ?? {}).some(key => key !== 'name')) {
      res.status(400).json({ success: false, message: 'Chỉ gửi field name và một file avatar' });
      return;
    }
    next();
  });
};
