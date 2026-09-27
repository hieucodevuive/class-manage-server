import { z } from 'zod';

export const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32),
});

export const env = envSchema.parse(process.env);