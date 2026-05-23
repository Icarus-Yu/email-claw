/**
 * 飞书 Webhook 回调路由
 *
 * POST /api/feishu/webhook
 *
 * 接收飞书卡片按钮点击事件回调（由 email_claw_bot 转发），
 * 执行对应的邮箱和数据库操作。
 */

import { Router, Request, Response } from 'express';
import { feishuService } from '../../integrations/feishu/feishuService';

const router = Router();

router.post('/webhook', async (req: Request, res: Response) => {
  try {
    const { action, emailId, expectedCategory, comment } = req.body;

    if (!action || !emailId) {
      return res.status(400).json({
        success: false,
        error: '缺少必填字段 action 或 emailId',
      });
    }

    // 同步等待业务处理完成，返回完整结果给 bot
    // 飞书 3 秒超时由 bot 端"先返回 toast、再异步 updateCard"模式兜底，
    // 因此这里不需要急着把 res 提前返回
    const result = await feishuService.handleCallback({
      action,
      emailId,
      expectedCategory,
      comment,
    });

    if (result.success) {
      console.log(`✅ ${action} 操作成功`);
    } else {
      console.warn(`⚠️ ${action} 操作未完成: ${result.message}`);
    }

    res.status(200).json(result);
  } catch (error: any) {
    console.error('❌ 飞书 webhook 处理失败:', error);
    res.status(500).json({
      success: false,
      message: `内部错误: ${error.message}`,
    });
  }
});

export default router;
