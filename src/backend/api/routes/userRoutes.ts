/**
 * 用户自身相关：profile / 偏好 / 绑定邮箱 / 绑定飞书
 *
 * 所有路由都需要 JWT。
 */

import { Router, Request, Response } from 'express';
import { databaseService } from '../../services/databaseService';
import { requireAuth } from '../../middleware/authMiddleware';
import { encrypt } from '../../utils/crypto';
import { imapManager } from '../../services/imapManager';

const router = Router();

router.use(requireAuth);

router.get('/me', async (req: Request, res: Response) => {
  const user = await databaseService.getUserById(req.auth!.userId);
  if (!user) return res.status(404).json({ error: '用户不存在' });
  res.json({
    id: user.id,
    email: user.email,
    feishuUserId: user.feishuUserId,
    preferences: user.preferences,
    hasMailbox: !!(user.imapHost && user.imapUser && user.imapPassword),
    imapUser: user.imapUser,
    imapHost: user.imapHost,
  });
});

/**
 * 设置/更新偏好
 * Body: { importanceThreshold?: number, pushAllEmails?: boolean }
 */
router.patch('/me/preferences', async (req: Request, res: Response) => {
  try {
    const { importanceThreshold, pushAllEmails } = req.body || {};
    const current = (await databaseService.getUserById(req.auth!.userId))?.preferences || {};
    const next: any = { ...(current as object) };
    if (importanceThreshold !== undefined) {
      const n = Number(importanceThreshold);
      if (!Number.isInteger(n) || n < 1 || n > 10) {
        return res.status(400).json({ error: 'importanceThreshold 需为 1-10 整数' });
      }
      next.importanceThreshold = n;
    }
    if (pushAllEmails !== undefined) {
      next.pushAllEmails = !!pushAllEmails;
    }
    const user = await databaseService.updateUser(req.auth!.userId, { preferences: next });
    res.json({ preferences: user.preferences });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * 绑定飞书 openId
 * Body: { feishuUserId: string }
 */
router.patch('/me/feishu', async (req: Request, res: Response) => {
  try {
    const { feishuUserId } = req.body || {};
    if (!feishuUserId || typeof feishuUserId !== 'string') {
      return res.status(400).json({ error: '缺少 feishuUserId' });
    }
    const user = await databaseService.updateUser(req.auth!.userId, { feishuUserId });
    res.json({ feishuUserId: user.feishuUserId });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * 绑定 IMAP 邮箱
 * Body: { imapHost, imapPort?, imapUser, imapPassword (明文授权码), tls? }
 *
 * 密码会被 AES-256-GCM 加密后入库。
 * 绑定成功后会立即尝试启动该用户的 IMAP 连接。
 */
router.post('/me/mailbox', async (req: Request, res: Response) => {
  try {
    const { imapHost, imapUser, imapPassword } = req.body || {};
    if (!imapHost || !imapUser || !imapPassword) {
      return res.status(400).json({ error: '缺少 imapHost / imapUser / imapPassword' });
    }
    if (typeof imapPassword !== 'string' || imapPassword.length < 4) {
      return res.status(400).json({ error: 'imapPassword 不合法' });
    }

    const encrypted = encrypt(imapPassword);
    const user = await databaseService.updateUser(req.auth!.userId, {
      imapHost,
      imapUser,
      imapPassword: encrypted,
    });

    // 启动该用户的 IMAP 连接（异步，不阻塞响应）
    imapManager.startForUser(user.id).catch((err) => {
      console.error(`❌ 启动用户 ${user.id} 的 IMAP 失败:`, err.message);
    });

    res.json({
      hasMailbox: true,
      imapUser: user.imapUser,
      imapHost: user.imapHost,
      message: 'IMAP 邮箱已绑定，正在后台启动连接',
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * 解绑邮箱（断开 IMAP 连接，清空凭据，不删邮件历史）
 */
router.delete('/me/mailbox', async (req: Request, res: Response) => {
  try {
    await imapManager.stopForUser(req.auth!.userId);
    await databaseService.updateUser(req.auth!.userId, {
      imapHost: null,
      imapUser: null,
      imapPassword: null,
    });
    res.json({ hasMailbox: false });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
