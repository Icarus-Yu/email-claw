/**
 * AES-256-GCM 对称加密工具
 *
 * 用途：在数据库里加密存储用户的 IMAP 授权码。
 *
 * 密钥来源：环境变量 ENCRYPTION_KEY（要求 32 字节的 hex / base64 字符串，
 * 或任意字符串经 sha-256 派生）。生产环境请用 KMS 管理。
 */

import crypto from 'crypto';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;

let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (cachedKey) return cachedKey;

  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      'ENCRYPTION_KEY 未配置：请在 .env 设置一个长度 >= 32 的随机字符串'
    );
  }
  // 任意长度字符串 → 32 字节 key
  cachedKey = crypto.createHash('sha256').update(raw).digest();
  return cachedKey;
}

/** 加密成 base64 字符串：iv || ciphertext || tag */
export function encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, getKey(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, enc, tag]).toString('base64');
}

export function decrypt(ciphertext: string): string {
  const buf = Buffer.from(ciphertext, 'base64');
  if (buf.length < IV_LEN + TAG_LEN) {
    throw new Error('密文格式不合法');
  }
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(buf.length - TAG_LEN);
  const enc = buf.subarray(IV_LEN, buf.length - TAG_LEN);
  const decipher = crypto.createDecipheriv(ALGO, getKey(), iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
  return dec.toString('utf8');
}

/** 判断字符串是否已经是加密格式（base64 + 长度合法） */
export function looksEncrypted(value: string): boolean {
  try {
    const buf = Buffer.from(value, 'base64');
    return buf.length >= IV_LEN + TAG_LEN + 1 && /^[A-Za-z0-9+/=]+$/.test(value);
  } catch {
    return false;
  }
}
