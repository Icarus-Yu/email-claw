/**
 * 多用户 IMAP 连接管理器
 *
 * - 启动时为所有已绑定邮箱的用户拉起 IMAP 长连接
 * - 提供按 userId / emailId 路由邮件操作的接口
 * - 单一 onIncomingEmail 入口将新邮件转交给 incomingEmailPipeline
 */

import { databaseService } from './databaseService';
import { decrypt } from '../utils/crypto';
import {
  resolveImapConfig,
  UserMailbox,
  type SimpleEmail,
} from './userMailbox';

class ImapManager {
  private mailboxes = new Map<string, UserMailbox>();
  private incomingHandler:
    | ((userId: string, email: SimpleEmail) => Promise<void>)
    | null = null;

  /** 由 server.ts 在启动时注册新邮件处理回调，避免循环依赖 */
  registerIncomingHandler(
    handler: (userId: string, email: SimpleEmail) => Promise<void>
  ) {
    this.incomingHandler = handler;
  }

  async startForAllBoundUsers(): Promise<void> {
    const users = await databaseService.listUsersWithMailbox();
    console.log(`📦 发现 ${users.length} 个已绑定邮箱的用户，准备拉起 IMAP 连接`);
    for (const u of users) {
      try {
        await this.startForUser(u.id);
      } catch (err: any) {
        console.error(`❌ 启动用户 ${u.id} 的 IMAP 失败:`, err.message);
      }
    }
  }

  async startForUser(userId: string): Promise<void> {
    if (!this.incomingHandler) {
      throw new Error('incomingHandler 未注册，无法启动 IMAP');
    }
    if (this.mailboxes.has(userId)) {
      console.log(`ℹ️ user ${userId} 的 IMAP 已在运行，跳过`);
      return;
    }
    const user = await databaseService.getUserById(userId);
    if (!user) throw new Error(`用户不存在: ${userId}`);
    if (!user.imapHost || !user.imapUser || !user.imapPassword) {
      throw new Error(`用户 ${userId} 未绑定邮箱`);
    }

    let plainPassword: string;
    try {
      plainPassword = decrypt(user.imapPassword);
    } catch (e: any) {
      throw new Error(
        `用户 ${userId} 的 IMAP 凭据解密失败（密钥变更或数据损坏）: ${e.message}`
      );
    }

    const cfg = resolveImapConfig(user.imapUser, user.imapHost);
    const mailbox = new UserMailbox(
      userId,
      {
        host: cfg.host,
        port: cfg.port,
        user: user.imapUser,
        password: plainPassword,
        archiveBox: process.env.IMAP_ARCHIVE_BOX || 'Archive',
      },
      {
        onIncomingEmail: (uid, email) => this.incomingHandler!(uid, email),
      }
    );
    this.mailboxes.set(userId, mailbox);
    mailbox.connect();
  }

  async stopForUser(userId: string): Promise<void> {
    const mb = this.mailboxes.get(userId);
    if (!mb) return;
    await mb.disconnect();
    this.mailboxes.delete(userId);
  }

  getByUserId(userId: string): UserMailbox | undefined {
    return this.mailboxes.get(userId);
  }

  /**
   * 给定 emailId，找出归属用户的 mailbox。
   * 调用方需要保证已经做过 ownership 校验（这里再防御性校验一次）。
   */
  async getMailboxForEmail(
    emailId: string,
    expectedUserId?: string
  ): Promise<{ mailbox: UserMailbox; uid: number; userId: string }> {
    const email = await databaseService.getEmailById(emailId);
    if (!email) throw new Error(`邮件不存在: ${emailId}`);
    if (expectedUserId && email.userId !== expectedUserId) {
      throw new Error('无权操作此邮件');
    }
    const mailbox = this.mailboxes.get(email.userId);
    if (!mailbox) {
      throw new Error(`用户 ${email.userId} 的 IMAP 连接未就绪`);
    }
    return { mailbox, uid: email.uid, userId: email.userId };
  }
}

export const imapManager = new ImapManager();
