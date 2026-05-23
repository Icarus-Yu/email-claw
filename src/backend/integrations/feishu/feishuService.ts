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
  isDeleted?: boolean;
  isImportant?: boolean; // 是否触发重要性高亮（决定 header 颜色和前缀）
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

export interface FeishuCallbackResult {
  success: boolean;
  message: string;
  action?: string;
  email?: FeishuEmailNotify;
  detail?: {
    subject: string;
    from: string;
    to: string;
    receivedAt: string;
    body: string;
    html?: string;
    category?: string | null;
    importance?: number | null;
    summary?: string | null;
  };
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
  async handleCallback(callback: FeishuCardCallback & { userId: string }): Promise<FeishuCallbackResult> {
    const { action, emailId, expectedCategory, comment, userId } = callback;

    console.log(`📥 飞书回调: action=${action}, emailId=${emailId}, userId=${userId}`);

    const { databaseService } = await import('../../services/databaseService');
    const { emailService } = await import('../../services/emailService');

    // ⛑ 防御性 ownership 校验：emailId 必须属于该 userId
    try {
      await databaseService.assertEmailOwnership(emailId, userId);
    } catch (e: any) {
      console.warn(`🚫 越权拦截: user=${userId} emailId=${emailId}: ${e.message}`);
      return { success: false, message: e.message };
    }

    switch (action) {
      case 'mark_read':
        return this.handleMarkRead(emailId, userId, databaseService, emailService);
      case 'mark_important':
        return this.handleMarkImportant(emailId, userId, databaseService, emailService);
      case 'archive':
        return this.handleArchive(emailId, userId, databaseService, emailService);
      case 'delete':
        return this.handleDelete(emailId, userId, databaseService, emailService);
      case 'feedback_correct':
        return this.handleFeedbackCorrect(emailId, databaseService);
      case 'feedback_wrong':
        return this.handleFeedbackWrong(emailId, expectedCategory, comment, databaseService);
      case 'view_detail':
        return this.handleViewDetail(emailId, databaseService);
      case 'reanalyze':
        return this.handleReanalyze(emailId, userId, databaseService, emailService);
      default:
        return { success: false, message: `未知操作: ${action}` };
    }
  }

  // ========== 各 action 处理逻辑 ==========

  private async handleMarkRead(emailId: string, userId: string, db: any, emailSvc: any): Promise<FeishuCallbackResult> {
    await emailSvc.markReadByEmailId(emailId, userId);
    await db.markEmailRead(emailId);
    const fullEmail = await db.getEmailById(emailId);
    return { success: true, action: 'mark_read', message: '已标记为已读', email: this.toNotifyEmail(fullEmail) };
  }

  private async handleMarkImportant(emailId: string, userId: string, db: any, emailSvc: any): Promise<FeishuCallbackResult> {
    await emailSvc.markImportantByEmailId(emailId, userId);
    await db.markEmailImportant(emailId);
    const fullEmail = await db.getEmailById(emailId);
    return { success: true, action: 'mark_important', message: '已标为重点', email: this.toNotifyEmail(fullEmail) };
  }

  private async handleArchive(emailId: string, userId: string, db: any, emailSvc: any): Promise<FeishuCallbackResult> {
    await emailSvc.archiveByEmailId(emailId, userId);
    await db.archiveEmail(emailId);
    const fullEmail = await db.getEmailById(emailId);
    return { success: true, action: 'archive', message: '已归档', email: this.toNotifyEmail(fullEmail) };
  }

  private async handleDelete(emailId: string, userId: string, db: any, emailSvc: any): Promise<FeishuCallbackResult> {
    await emailSvc.deleteByEmailId(emailId, userId);
    await db.markEmailDeleted(emailId);
    const fullEmail = await db.getEmailById(emailId);
    return { success: true, action: 'delete', message: '已删除', email: this.toNotifyEmail(fullEmail) };
  }

  private async handleFeedbackCorrect(
    emailId: string,
    db: any
  ): Promise<FeishuCallbackResult> {
    await db.saveClassificationFeedback(emailId, 'correct');
    const email = await db.getEmailById(emailId);
    return {
      success: true,
      action: 'feedback_correct',
      message: '感谢反馈！分类正确已记录',
      email: this.toNotifyEmail(email),
    };
  }

  private async handleFeedbackWrong(
    emailId: string,
    expectedCategory: string | undefined,
    comment: string | undefined,
    db: any
  ): Promise<FeishuCallbackResult> {
    if (!expectedCategory) {
      return { success: false, message: '请提供期望的分类' };
    }
    await db.saveClassificationFeedback(emailId, 'incorrect', expectedCategory, comment);
    const email = await db.getEmailById(emailId);
    return {
      success: true,
      action: 'feedback_wrong',
      message: `纠错已记录，正确分类: ${expectedCategory}`,
      email: this.toNotifyEmail(email),
    };
  }

  private async handleViewDetail(
    emailId: string,
    db: any
  ): Promise<FeishuCallbackResult> {
    const email = await db.getEmailById(emailId);
    if (!email) {
      return { success: false, message: '邮件不存在' };
    }
    return {
      success: true,
      action: 'view_detail',
      message: '详情已获取',
      detail: {
        subject: email.subject,
        from: email.from,
        to: email.to,
        receivedAt: email.receivedAt.toISOString(),
        body: email.body?.slice(0, 2000),
        html: email.html?.slice(0, 5000),
        category: email.category,
        importance: email.importance,
        summary: email.summary,
      },
    };
  }

  private async handleReanalyze(
    emailId: string,
    userId: string,
    db: any,
    emailSvc: any
  ): Promise<FeishuCallbackResult> {
    try {
      const result = await emailSvc.reanalyzeByEmailId(emailId, userId);
      return {
        success: true,
        action: 'reanalyze',
        message: '重新分析已完成',
        email: this.toNotifyEmail(result.email),
      };
    } catch (error: any) {
      return { success: false, message: `重新分析失败: ${error.message}` };
    }
  }

  private toNotifyEmail(email: any): FeishuEmailNotify {
    const classification = email?.classification;
    const importance = email.importance ?? 0;

    return {
      emailId: email.id,
      from: email.from,
      to: email.to,
      subject: email.subject,
      receivedAt: email.receivedAt instanceof Date ? email.receivedAt.toISOString() : email.receivedAt,
      category: email.category || classification?.category || 'other',
      importance,
      summary: email.summary || this.extractSummary(classification?.reasoning) || '暂无摘要',
      classificationReasoning: classification?.reasoning || '',
      confidence: classification?.confidence ?? 0,
      isRead: email.isRead,
      isArchived: email.isArchived,
      isDeleted: email.isDeleted,
      isImportant: importance >= 7,
    };
  }

  private extractSummary(reasoning?: string | null): string | undefined {
    if (!reasoning) return undefined;
    const summaryLine = reasoning.split('\n').find((line) => line.startsWith('摘要:'));
    return summaryLine?.replace(/^摘要:\s*/, '').trim();
  }
}

export const feishuService = new FeishuService();
