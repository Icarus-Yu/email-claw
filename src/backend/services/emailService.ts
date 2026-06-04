/**
 * 邮件服务 facade
 *
 * 重构后：
 *   - 不再自己管理 IMAP 连接，全部交给 ImapManager
 *   - 对外暴露 markRead / markImportant / archive / delete / reanalyze
 *     这些原本的方法签名保持不变，但内部按 emailId → userId → 该用户的 UserMailbox 路由
 *   - 新邮件 pipeline（processIncomingEmail）注册给 imapManager
 *
 * 防御性：每个写操作都强制 ownership 校验，避免飞书回调中传入的 emailId 越权。
 */

import { agentService } from './agentService';
import { databaseService } from './databaseService';
import { feishuService } from '../integrations/feishu/feishuService';
import { imapManager } from './imapManager';
import { ruleEngine } from './ruleEngine';
import type { SimpleEmail } from './userMailbox';

export type { SimpleEmail } from './userMailbox';

const DEFAULT_IMPORTANCE_THRESHOLD = 7;

export class EmailService {
  /**
   * 启动入口：注册新邮件处理回调，并拉起所有已绑定用户的 IMAP
   */
  async start(): Promise<void> {
    imapManager.registerIncomingHandler((userId, email) =>
      this.processIncomingEmail(userId, email)
    );
    await imapManager.startForAllBoundUsers();
  }

  /** 单用户启动（注册或绑定邮箱后调用） */
  async startForUser(userId: string): Promise<void> {
    await imapManager.startForUser(userId);
  }

  // ========== 新邮件 pipeline ==========

  private async processIncomingEmail(userId: string, email: SimpleEmail): Promise<void> {
    console.log(`🤖 [user=${userId}] 处理新邮件: ${email.subject}`);

    try {
      // 1. 入库
      const saved = await databaseService.upsertEmail(userId, {
        uid: email.uid,
        messageId: email.messageId,
        from: email.from,
        to: email.to,
        subject: email.subject,
        body: email.text,
        html: email.html,
        receivedAt: email.date,
      });

      // 1.5 持久化去重：已处理过的邮件直接跳过，避免重启后重复发卡。
      // （QQ 等邮箱不持久化自定义 IMAP 关键字，故以 DB 的 notifiedAt 为准）
      if (saved.notifiedAt) {
        console.log(`⏭️ [user=${userId}] 邮件已处理过(UID ${email.uid})，跳过`);
        return;
      }

      // 2. 先跑规则引擎；命中则跳过 Agent
      const ruleHit = await ruleEngine.evaluate(userId, email);

      let analysis;
      let source: 'rule' | 'agent';

      if (ruleHit) {
        console.log(`📏 [user=${userId}] 命中规则 "${ruleHit.ruleName}" → category=${ruleHit.result.classification.category}`);
        analysis = ruleHit.result;
        source = 'rule';

        // 仍要写入 DB（updateEmailAnalysisById 内含 classification upsert + AgentLog）
        await databaseService.updateEmailAnalysisById(saved.id, userId, {
          ...analysis,
          duration: 0,
        });

        // 执行规则附带的副作用动作
        await this.applyRuleSideEffects(userId, saved.id, ruleHit.sideEffects);
      } else {
        const result = await agentService.analyzeEmail({ userId, email });
        analysis = result;
        source = 'agent';
      }

      console.log(
        `🧠 [user=${userId}] [${source}] 分类=${analysis.classification.category}, 重要性=${analysis.importance.score}/10`
      );

      // 3. 飞书推送（按用户偏好决定阈值与高亮）
      const user = await databaseService.getUserById(userId);
      const prefs = (user?.preferences as any) || {};
      const threshold = prefs.importanceThreshold ?? DEFAULT_IMPORTANCE_THRESHOLD;
      const pushAll = prefs.pushAllEmails !== false; // 默认 true
      const isImportant = analysis.importance.score >= threshold;

      let pushed = false;
      if (pushAll || isImportant) {
        await feishuService.pushEmailCard({
          emailId: saved.id,
          from: email.from,
          to: email.to,
          subject: email.subject,
          receivedAt: email.date.toISOString(),
          category: analysis.classification.category,
          importance: analysis.importance.score,
          summary: analysis.summary.summary,
          classificationReasoning: analysis.classification.reasoning,
          confidence: analysis.classification.confidence,
          isRead: false,
          isArchived: false,
          openId: user?.feishuUserId || undefined,
          isImportant,
        });
        pushed = true;
      }

      // 4. 标记已处理：无论是否推送都落 notifiedAt，重启后不再重复处理/发卡。
      //    推送失败会在上面抛错进入 catch，不会执行到这里，从而保留重试机会。
      await databaseService.markNotified(saved.id);
      if (!pushed) {
        console.log(`🔕 [user=${userId}] 未达推送阈值，仅标记已处理(UID ${email.uid})`);
      }
    } catch (error) {
      console.error(`❌ [user=${userId}] 处理邮件失败 (UID ${email.uid}):`, error);
    }
  }

  /**
   * 规则匹配后产生的副作用（mark_read / archive / delete）
   * 这些动作需要操作 IMAP，单独抽出来执行
   */
  private async applyRuleSideEffects(
    userId: string,
    emailId: string,
    actions: Array<'mark_read' | 'archive' | 'delete'>
  ) {
    for (const a of actions) {
      try {
        if (a === 'mark_read') await this.markReadByEmailId(emailId, userId);
        else if (a === 'archive') await this.archiveByEmailId(emailId, userId);
        else if (a === 'delete') await this.deleteByEmailId(emailId, userId);
      } catch (e: any) {
        console.warn(`⚠️ [user=${userId}] 规则副作用 ${a} 失败:`, e.message);
      }
    }
  }

  // ========== 被飞书回调调用的写操作（带 ownership 防御） ==========

  async markReadByEmailId(emailId: string, expectedUserId?: string) {
    const { mailbox, uid } = await imapManager.getMailboxForEmail(emailId, expectedUserId);
    await mailbox.markRead(uid);
    console.log(`✅ [user=${mailbox.userId}] UID ${uid} 已读`);
  }

  async markImportantByEmailId(emailId: string, expectedUserId?: string) {
    const { mailbox, uid } = await imapManager.getMailboxForEmail(emailId, expectedUserId);
    await mailbox.markFlagged(uid);
    console.log(`✅ [user=${mailbox.userId}] UID ${uid} 已标重点`);
  }

  async archiveByEmailId(emailId: string, expectedUserId?: string) {
    const { mailbox, uid } = await imapManager.getMailboxForEmail(emailId, expectedUserId);
    await mailbox.archive(uid);
    console.log(`✅ [user=${mailbox.userId}] UID ${uid} 已归档`);
  }

  async deleteByEmailId(emailId: string, expectedUserId?: string) {
    const { mailbox, uid } = await imapManager.getMailboxForEmail(emailId, expectedUserId);
    await mailbox.deleteMail(uid);
    console.log(`✅ [user=${mailbox.userId}] UID ${uid} 已删除`);
  }

  // ========== 重新分析（不操作 IMAP） ==========

  async reanalyzeByEmailId(emailId: string, expectedUserId?: string) {
    const email = await databaseService.getEmailById(emailId);
    if (!email) throw new Error(`找不到邮件 emailId=${emailId}`);
    if (expectedUserId && email.userId !== expectedUserId) {
      throw new Error('无权操作此邮件');
    }

    const simpleEmail: SimpleEmail = {
      uid: email.uid,
      messageId: email.messageId || emailId,
      subject: email.subject,
      from: email.from,
      to: email.to,
      date: email.receivedAt,
      text: email.body,
      html: email.html || undefined,
      attachments: [],
    };

    const startedAt = Date.now();
    const analysis = await agentService.analyzeEmailDraft({
      userId: email.userId,
      email: simpleEmail,
    });
    const duration = Date.now() - startedAt;

    const updatedEmail = await databaseService.updateEmailAnalysisById(emailId, email.userId, {
      ...analysis,
      duration,
    });

    return { analysis, email: updatedEmail };
  }
}

export const emailService = new EmailService();
