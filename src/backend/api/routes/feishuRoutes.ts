/**
 * 飞书 Webhook 回调
 *
 * POST /api/feishu/webhook
 *   Headers:
 *     X-Bot-Secret: <FEISHU_BOT_SHARED_SECRET>     (生产环境必填)
 *   Body:
 *     { action, emailId, openId, expectedCategory?, comment? }
 *
 * 防御链路：
 *   1) X-Bot-Secret 校验，杜绝非 bot 来源请求
 *   2) openId → userId 解析（必须已在 User.feishuUserId 绑定）
 *   3) feishuService.handleCallback 内部还会再做 emailId ownership 校验
 */

import { Router, Request, Response } from 'express';
import { feishuService } from '../../integrations/feishu/feishuService';
import { requireBotSecret } from '../../middleware/authMiddleware';
import { databaseService } from '../../services/databaseService';

const router = Router();

router.post('/webhook', requireBotSecret, async (req: Request, res: Response) => {
  try {
    const { action, emailId, expectedCategory, comment, openId } = req.body;

    if (!action || !emailId) {
      return res.status(400).json({
        success: false,
        error: '缺少必填字段 action 或 emailId',
      });
    }
    if (!openId) {
      return res.status(400).json({
        success: false,
        error: '缺少 openId（bot 未传，无法确定操作者）',
      });
    }

    // openId → userId
    const user = await databaseService.getUserByFeishuOpenId(openId);
    if (!user) {
      return res.status(403).json({
        success: false,
        error: '该飞书账号未绑定 EmailClaw 用户',
      });
    }

    const result = await feishuService.handleCallback({
      action,
      emailId,
      expectedCategory,
      comment,
      userId: user.id,
    });

    if (result.success) {
      console.log(`✅ ${action} 成功 (user=${user.id})`);
    } else {
      console.warn(`⚠️ ${action} 未完成 (user=${user.id}): ${result.message}`);
    }

    res.status(200).json(result);
  } catch (error: any) {
    console.error('❌ 飞书 webhook 处理失败:', error);
    res.status(500).json({ success: false, message: `内部错误: ${error.message}` });
  }
});

export default router;
