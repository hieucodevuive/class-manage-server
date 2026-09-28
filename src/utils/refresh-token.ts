import { randomBytes, createHash } from 'node:crypto';

export function createRefreshToken() {
  return randomBytes(32).toString('hex');
}

export function hashRefreshToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}