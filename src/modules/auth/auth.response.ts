import type { User } from '../../generated/prisma/client';
import { env } from '../../config/env';

export function getDefaultAvatarUrl() {
  return env.DEFAULT_AVATAR_URL
    ?? new URL('/api/assets/default-avatar.svg', env.PUBLIC_API_ORIGIN ?? `http://localhost:${env.PORT}`).href;
}

export function serializeUser(user: Pick<User, 'id' | 'email' | 'name' | 'avatar' | 'role'>) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatar: user.avatar ?? getDefaultAvatarUrl(),
    role: user.role,
  };
}
