/**
 * 用户注册 / 登录
 *
 * POST /api/auth/register  { email, password }
 * POST /api/auth/login     { email, password }
 */

import { Router, Request, Response } from 'express';
import { databaseService } from '../../services/databaseService';
import { hashPassword, signToken, verifyPassword } from '../../utils/auth';

const router = Router();

function isValidEmail(s: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

router.post('/register', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: '缺少 email 或 password' });
    }
    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'email 格式不合法' });
    }
    if (typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({ error: '密码至少 8 位' });
    }

    const existing = await databaseService.getUserByEmail(email);
    if (existing) {
      return res.status(409).json({ error: 'email 已注册' });
    }

    const hash = await hashPassword(password);
    const user = await databaseService.createUser({ email, passwordHash: hash });
    const token = signToken({ userId: user.id, email: user.email });
    res.status(201).json({
      token,
      user: { id: user.id, email: user.email },
    });
  } catch (e: any) {
    console.error('register error:', e);
    res.status(500).json({ error: e.message });
  }
});

router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: '缺少 email 或 password' });
    }
    const user = await databaseService.getUserByEmail(email);
    if (!user) {
      return res.status(401).json({ error: '账号或密码错误' });
    }
    const ok = await verifyPassword(password, user.password);
    if (!ok) {
      return res.status(401).json({ error: '账号或密码错误' });
    }
    const token = signToken({ userId: user.id, email: user.email });
    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        feishuUserId: user.feishuUserId,
        hasMailbox: !!(user.imapHost && user.imapUser && user.imapPassword),
      },
    });
  } catch (e: any) {
    console.error('login error:', e);
    res.status(500).json({ error: e.message });
  }
});

export default router;
