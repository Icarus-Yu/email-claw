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

    // ⭐ 关键改变 1：立刻响应飞书！
    // 只要参数没问题，立刻给飞书返回 200 和一个空对象。
    // 这句话执行后，飞书的倒计时就停止了，卡片再也不会报红色的错误！
    res.status(200).json({});

    // ⭐ 关键改变 2：拿掉 await，放入后台执行
    // 让 feishuService 自己在后台慢慢连邮箱、改数据库
    feishuService.handleCallback({
      action,
      emailId,
      expectedCategory,
      comment,
    })
    .then((result) => {
      // 这里的逻辑会在 3~4 秒后执行完毕，我们只需在终端打印一下结果即可
      if (result.success) {
        console.log(`✅ 后台执行完毕: ${action} 操作成功`);
      } else {
        console.warn(`⚠️ 后台执行提示: ${result.message}`);
      }
    })
    .catch((error: any) => {
      console.error('❌ 飞书回调后台处理崩溃:', error);
    });
  } catch (error: any) {
    console.error('❌ 飞书 webhook 处理失败:', error);
    res.status(500).json({
      success: false,
      message: `内部错误: ${error.message}`,
    });
  }
});

export default router;
