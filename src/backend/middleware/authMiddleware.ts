/**
 * JWT 鉴权中间件
 *
 * 从 Authorization: Bearer <token> 提取 token，校验后把 userId / email 挂到 req.auth。
 *
 * 内部服务调用（如飞书 bot → 后端）走另一个 internalSecretAuth，不走 JWT。
 */

import type { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../utils/auth';

export interface AuthContext {
  userId: string;
  email: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.header('authorization') || req.header('Authorization');
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: '未登录或缺少 token' });
  }
  const token = header.slice('Bearer '.length).trim();
  try {
    const payload = verifyToken(token);
    req.auth = { userId: payload.userId, email: payload.email };
    next();
  } catch (e: any) {
    return res.status(401).json({ error: 'token 无效或已过期' });
  }
}

/** 飞书 bot ↔ 后端的共享密钥校验 */
export function requireBotSecret(req: Request, res: Response, next: NextFunction) {
  const expected = process.env.FEISHU_BOT_SHARED_SECRET;
  if (!expected) {
    // 开发态可放宽：未配置时跳过（生产必须配置）
    if (process.env.NODE_ENV === 'production') {
      return res.status(500).json({ error: 'FEISHU_BOT_SHARED_SECRET 未配置' });
    }
    return next();
  }
  const got = req.header('x-bot-secret') || req.header('X-Bot-Secret');
  if (got !== expected) {
    return res.status(401).json({ error: 'bot 共享密钥校验失败' });
  }
  next();
}
