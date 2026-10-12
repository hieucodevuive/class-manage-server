import { z } from 'zod';

const optionalSetting = z.preprocess(
  value => typeof value === 'string' && !value.trim() ? undefined : value,
  z.string().trim().min(1).optional(),
);
const optionalHttpUrl = z.preprocess(
  value => typeof value === 'string' && !value.trim() ? undefined : value,
  z.url().refine(value => {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
  }, 'URL phải dùng HTTP/HTTPS và không chứa thông tin đăng nhập').optional(),
);

export const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  FRONTEND_ORIGIN: z.url(),
  CLOUDINARY_CLOUD_NAME: optionalSetting,
  CLOUDINARY_API_KEY: optionalSetting,
  CLOUDINARY_API_SECRET: optionalSetting,
  PUBLIC_API_ORIGIN: optionalHttpUrl,
  DEFAULT_AVATAR_URL: optionalHttpUrl,
}).superRefine((settings, ctx) => {
  if (settings.PUBLIC_API_ORIGIN) {
    const url = new URL(settings.PUBLIC_API_ORIGIN);
    if (url.pathname !== '/' || url.search || url.hash) {
      ctx.addIssue({ code: 'custom', path: ['PUBLIC_API_ORIGIN'], message: 'PUBLIC_API_ORIGIN chỉ chứa origin HTTP/HTTPS, không có path/query/hash' });
    }
  }
  if (settings.NODE_ENV === 'production' && !settings.PUBLIC_API_ORIGIN && !settings.DEFAULT_AVATAR_URL) {
    ctx.addIssue({ code: 'custom', path: ['PUBLIC_API_ORIGIN'], message: 'Production cần PUBLIC_API_ORIGIN hoặc DEFAULT_AVATAR_URL để phục vụ ảnh mặc định' });
  }
});

export const env = envSchema.parse(process.env);
