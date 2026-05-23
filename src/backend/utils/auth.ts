/**
 * 用户密码哈希 + JWT 签发/校验
 */

import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const BCRYPT_ROUNDS = 12;
const DEFAULT_TTL = '7d';

function getJwtSecret(): string {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 16) {
    throw new Error('JWT_SECRET 未配置或长度不足 16');
  }
  return s;
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export interface JwtPayload {
  userId: string;
  email: string;
}

export function signToken(payload: JwtPayload, ttl: string = DEFAULT_TTL): string {
  return jwt.sign(payload, getJwtSecret(), { expiresIn: ttl } as jwt.SignOptions);
}

export function verifyToken(token: string): JwtPayload {
  const decoded = jwt.verify(token, getJwtSecret());
  if (typeof decoded === 'string') {
    throw new Error('JWT payload 非对象');
  }
  return decoded as JwtPayload;
}
