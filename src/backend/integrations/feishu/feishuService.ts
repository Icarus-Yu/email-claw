/**
 * 飞书推送服务
 *
 * 将邮件分析结果推送给飞书机器人（lark-samples-main/email_claw_bot），
 * 由机器人负责构建并发送飞书卡片给用户。
 *
 * 同时处理飞书卡片按钮回调，执行对应的邮箱和数据库操作。
 */

const BOT_URL = process.env.FEISHU_BOT_URL || 'http://localhost:3001';

/** 飞书推送的邮件数据结构 */
export interface FeishuEmailNotify {
  emailId: string;
  from: string;
  to: string;
  subject: string;
  receivedAt: string;
  category: string;
  importance: number;
  summary: string;
  classificationReasoning: string;
  confidence: number;
  isRead: boolean;
  isArchived: boolean;
  openId?: string; // 目标用户 open_id，缺省使用机器人默认用户
}

/** 卡片按钮回调 payload */
export interface FeishuCardCallback {
  action: string;
  emailId: string;
  expectedCategory?: string;
  comment?: string;
  openId?: string;
}

export class FeishuService {
  /**
   * 推送邮件分析结果到飞书机器人
   */
  async pushEmailCard(data: FeishuEmailNotify): Promise<void> {
    try {
      const response = await fetch(`${BOT_URL}/api/notify-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Bot returned ${response.status}: ${errorText}`);
      }

      const result = await response.json();
      console.log(`📤 邮件卡片已推送至飞书: messageId=${result.messageId}`);
    } catch (error) {
      console.error('❌ 推送飞书卡片失败:', error);
      // 不抛异常，避免阻塞邮件处理主流程
    }
  }

  /**
   * 处理飞书卡片按钮回调
   * 根据 action 类型执行对应的业务操作
   *
   * @returns 处理结果描述
   */
  async handleCallback(callback: FeishuCardCallback): Promise<{
    success: boolean;
    message: string;
  }> {
    const { action, emailId, expectedCategory, comment } = callback;

    console.log(`📥 收到飞书回调: action=${action}, emailId=${emailId}`);

    // 动态导入 databaseService 避免循环依赖
    const { databaseService } = await import('../../services/databaseService');
    const { emailService } = await import('../../services/emailService');

    switch (action) {
      case 'mark_read':
        return this.handleMarkRead(emailId, databaseService, emailService);

      case 'mark_important':
        return this.handleMarkImportant(emailId, databaseService, emailService);

      case 'archive':
        return this.handleArchive(emailId, databaseService, emailService);

      case 'delete':
        return this.handleDelete(emailId, databaseService, emailService);

      case 'feedback_correct':
        return this.handleFeedbackCorrect(emailId, databaseService);

      case 'feedback_wrong':
        return this.handleFeedbackWrong(emailId, expectedCategory, comment, databaseService);

      case 'view_detail':
        return this.handleViewDetail(emailId, databaseService);

      case 'reanalyze':
        return this.handleReanalyze(emailId, databaseService, emailService);

      default:
        console.warn(`⚠️ 未知 action: ${action}`);
        return { success: false, message: `未知操作: ${action}` };
    }
  }

  // ========== 各 action 处理逻辑 ==========

  private async handleMarkRead(
    emailId: string,
    db: any,
    emailSvc: any
  ): Promise<{ success: boolean; message: string }> {
    await db.markEmailRead(emailId);
    try { await emailSvc.markReadByEmailId(emailId); } catch { /* IMAP 操作可选 */ }
    return { success: true, message: '已标记为已读' };
  }

  private async handleMarkImportant(
    emailId: string,
    db: any,
    emailSvc: any
  ): Promise<{ success: boolean; message: string }> {
    await db.markEmailImportant(emailId);
    try { await emailSvc.markImportantByEmailId(emailId); } catch { /* IMAP 操作可选 */ }
    return { success: true, message: '已标为重点' };
  }

  private async handleArchive(
    emailId: string,
    db: any,
    emailSvc: any
  ): Promise<{ success: boolean; message: string }> {
    await db.archiveEmail(emailId);
    try { await emailSvc.archiveByEmailId(emailId); } catch { /* IMAP 操作可选 */ }
    return { success: true, message: '已归档' };
  }

  private async handleDelete(
    emailId: string,
    db: any,
    emailSvc: any
  ): Promise<{ success: boolean; message: string }> {
    await db.markEmailDeleted(emailId);
    try { await emailSvc.deleteByEmailId(emailId); } catch { /* IMAP 操作可选 */ }
    return { success: true, message: '已删除' };
  }

  private async handleFeedbackCorrect(
    emailId: string,
    db: any
  ): Promise<{ success: boolean; message: string }> {
    await db.saveClassificationFeedback(emailId, 'correct');
    return { success: true, message: '感谢反馈！分类正确已记录' };
  }

  private async handleFeedbackWrong(
    emailId: string,
    expectedCategory: string | undefined,
    comment: string | undefined,
    db: any
  ): Promise<{ success: boolean; message: string }> {
    if (!expectedCategory) {
      return { success: false, message: '请提供期望的分类' };
    }
    await db.saveClassificationFeedback(emailId, 'incorrect', expectedCategory, comment);
    return { success: true, message: `纠错已记录，正确分类: ${expectedCategory}` };
  }

  private async handleViewDetail(
    emailId: string,
    db: any
  ): Promise<{ success: boolean; message: string }> {
    const email = await db.getEmailById(emailId);
    if (!email) {
      return { success: false, message: '邮件不存在' };
    }
    return {
      success: true,
      message: JSON.stringify({
        subject: email.subject,
        from: email.from,
        to: email.to,
        body: email.body?.slice(0, 2000),
        html: email.html?.slice(0, 5000),
        category: email.category,
        importance: email.importance,
      }),
    };
  }

  private async handleReanalyze(
    emailId: string,
    db: any,
    emailSvc: any
  ): Promise<{ success: boolean; message: string }> {
    try {
      await emailSvc.reanalyzeByEmailId(emailId);
      return { success: true, message: '重新分析已触发' };
    } catch {
      return { success: false, message: '重新分析触发失败' };
    }
  }
}

export const feishuService = new FeishuService();
