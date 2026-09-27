import bcrypt from 'bcryptjs';
import { findUserByEmail } from './auth.repository';

export async function authenticateUser(email: string, password: string) {
  const user = await findUserByEmail(email);

  if (!user) {
    return null;
  }

  const passwordMatches = await bcrypt.compare(password, user.passwordHash);

  if (!passwordMatches) {
    return null;
  }

  return {
    id: user.id,
    email: user.email,
    role: user.role,
    };
}