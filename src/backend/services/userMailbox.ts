/**
 * 单个用户的 IMAP 连接与邮件操作
 *
 * 一个 User 对应一个 UserMailbox 实例。封装了：
 *   - 长连接 + 自动重连
 *   - 监听 new mail 并触发 onIncomingEmail 回调
 *   - 已读 / 重点 / 归档 / 删除 等 IMAP 操作
 *   - 自定义 PROCESSED 标记防止重复处理
 *
 * 所有写操作都隔离在本用户的 IMAP 连接上，不会跨用户串扰。
 */

import Imap from 'imap';
import { simpleParser } from 'mailparser';

export interface SimpleEmail {
  uid: number;
  messageId: string;
  subject: string;
  from: string;
  to: string;
  date: Date;
  text: string;
  html?: string;
  attachments: Array<{ filename?: string; contentType: string; size: number }>;
}

export interface MailboxConfig {
  host: string;
  port: number;
  user: string;
  password: string; // 已解密的明文授权码
  tls?: boolean;
  archiveBox?: string;
}

export interface MailboxDeps {
  onIncomingEmail: (userId: string, email: SimpleEmail) => Promise<void>;
}

const PROCESSED_FLAG = 'CLAWED';

export function resolveImapConfig(email: string, envHost?: string, envPort?: string) {
  if (envHost) {
    return { host: envHost, port: envPort ? parseInt(envPort, 10) : 993 };
  }
  const domain = email.split('@')[1]?.toLowerCase() || '';
  switch (domain) {
    case 'qq.com':
    case 'foxmail.com':
      return { host: 'imap.qq.com', port: 993 };
    case '163.com':
    case '126.com':
      return { host: `imap.${domain}`, port: 993 };
    case 'gmail.com':
      return { host: 'imap.gmail.com', port: 993 };
    case 'outlook.com':
    case 'hotmail.com':
      return { host: 'outlook.office365.com', port: 993 };
    default:
      return { host: domain ? `imap.${domain}` : '', port: 993 };
  }
}

export class UserMailbox {
  private imap: Imap | null = null;
  private isConnecting = false;
  private archiveBoxEnsured = false;
  private stopped = false;
  private readonly archiveBox: string;
  private pollTimer: NodeJS.Timeout | null = null;
  /** IDLE 不靠谱时的兜底轮询间隔（毫秒） */
  private readonly POLL_INTERVAL_MS = 30_000;
  /** 正在处理 / 已处理的 UID，内存级去重，挡住 CLAWED 标记写入前的并发重复扫描 */
  private readonly claimedUids = new Set<number>();
  /** 扫描重入锁，避免多个触发源同时跑 search/fetch */
  private scanning = false;

  constructor(
    public readonly userId: string,
    private config: MailboxConfig,
    private readonly deps: MailboxDeps
  ) {
    this.archiveBox = config.archiveBox || 'Archive';
  }

  // ===== 生命周期 =====

  connect() {
    if (this.stopped || this.isConnecting || this.imap) return;
    this.isConnecting = true;

    console.log(`🔄 [user=${this.userId}] 连接 IMAP ${this.config.host}:${this.config.port}`);

    this.imap = new Imap({
      user: this.config.user,
      password: this.config.password,
      host: this.config.host,
      port: this.config.port,
      tls: this.config.tls !== false,
      tlsOptions: { rejectUnauthorized: false, servername: this.config.host },
      authTimeout: 15000,
      keepalive: { interval: 10000, idleInterval: 300000, forceNoop: true },
    });

    this.initListeners();
    this.imap.connect();
  }

  async disconnect(): Promise<void> {
    this.stopped = true;
    this.stopPolling();
    if (!this.imap) return;
    try {
      this.imap.end();
    } catch {}
    this.imap = null;
  }

  private startPolling() {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => {
      if (this.stopped || !this.imap) return;
      this.scanUnprocessedEmails();
    }, this.POLL_INTERVAL_MS);
  }

  private stopPolling() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private initListeners() {
    if (!this.imap) return;

    this.imap.once('ready', async () => {
      this.isConnecting = false;
      console.log(`✅ [user=${this.userId}] IMAP 鉴权成功`);

      try {
        await this.ensureArchiveBox();
      } catch (err: any) {
        console.error(`⚠️ [user=${this.userId}] 归档文件夹检查失败:`, err.message);
      }

      this.imap?.openBox('INBOX', false, (err, box) => {
        if (err) {
          console.error(`❌ [user=${this.userId}] 打开 INBOX 失败:`, err);
          return;
        }
        console.log(`📂 [user=${this.userId}] INBOX 共 ${box.messages.total} 封`);
        this.scanUnprocessedEmails();
        this.imap?.on('mail', () => {
          setTimeout(() => this.scanUnprocessedEmails(), 1000);
        });
        // 兜底轮询（应对 QQ 等不可靠的 IMAP IDLE 推送）
        this.startPolling();
      });
    });

    this.imap.on('error', (err: any) => {
      this.isConnecting = false;
      console.error(`❌ [user=${this.userId}] IMAP 错误:`, err.message);
      this.scheduleReconnect();
    });

    this.imap.once('end', () => {
      this.isConnecting = false;
      this.imap = null;
      this.stopPolling();
      if (this.stopped) return;
      console.log(`⚠️ [user=${this.userId}] IMAP 断开，准备重连`);
      this.scheduleReconnect();
    });
  }

  private scheduleReconnect() {
    if (this.stopped) return;
    setTimeout(() => this.connect(), 5000);
  }

  // ===== 邮件抓取 =====

  private scanUnprocessedEmails() {
    if (!this.imap || this.scanning) return;
    this.scanning = true;
    this.imap.search(['UNSEEN'], (err, uids) => {
      this.scanning = false;
      if (err) {
        console.error(`❌ [user=${this.userId}] 搜索失败:`, err);
        return;
      }
      if (uids.length > 0) this.fetchEmailsByUids(uids);
    });
  }

  private fetchEmailsByUids(uids: number[]) {
    if (!this.imap || uids.length === 0) return;
    // 内存级去重：只 fetch 尚未占用的 UID，并立刻占位，挡住 CLAWED 标记写入前的并发重复
    const fresh = uids.filter((u) => !this.claimedUids.has(u));
    if (fresh.length === 0) return;
    fresh.forEach((u) => this.claimedUids.add(u));
    const f = this.imap.fetch(fresh, { bodies: '', struct: true });

    f.on('message', (msg) => {
      let buffer = '';
      let uid: number;
      let flags: string[] = [];

      msg.on('body', (stream) => {
        stream.on('data', (chunk) => (buffer += chunk.toString('utf8')));
      });
      msg.once('attributes', (attrs) => {
        uid = attrs.uid;
        flags = attrs.flags || [];
      });
      msg.once('end', async () => {
        if (
          flags.includes(PROCESSED_FLAG) ||
          flags.includes(`\\${PROCESSED_FLAG}`)
        ) {
          // 服务器侧已标记处理过：保留占用，不再重复处理
          return;
        }
        try {
          const parsed = await simpleParser(buffer);
          const simple: SimpleEmail = {
            uid,
            messageId: parsed.messageId || `uid-${uid}`,
            subject: parsed.subject || '(无主题)',
            from: parsed.from?.text || 'Unknown',
            to: Array.isArray(parsed.to)
              ? parsed.to.map((t: any) => t.text).join(', ')
              : parsed.to?.text || 'Unknown',
            date: parsed.date || new Date(),
            text: parsed.text || '',
            html: typeof parsed.html === 'string' ? parsed.html : undefined,
            attachments: parsed.attachments.map((a) => ({
              filename: a.filename,
              contentType: a.contentType,
              size: a.size,
            })),
          };
          await this.deps.onIncomingEmail(this.userId, simple);
          this.markProcessed(uid);
        } catch (e) {
          // 处理失败：释放占用，让后续轮询可以重试这封邮件
          this.claimedUids.delete(uid);
          console.error(`❌ [user=${this.userId}] 解析 UID ${uid} 失败:`, e);
        }
      });
    });

    f.once('error', (err) => {
      console.error(`❌ [user=${this.userId}] fetch 错误:`, err);
    });
  }

  private markProcessed(uid: number) {
    if (!this.imap) return;
    this.imap.addFlags(uid, [PROCESSED_FLAG], (err) => {
      if (err) console.error(`❌ [user=${this.userId}] 标记 UID ${uid} 失败:`, err);
    });
  }

  // ===== 邮件操作（被飞书回调调用） =====

  async markRead(uid: number) {
    await this.runOp((imap, done) => imap.addFlags(uid, ['\\Seen'], done));
  }

  async markFlagged(uid: number) {
    await this.runOp((imap, done) => imap.addFlags(uid, ['\\Flagged'], done));
  }

  async archive(uid: number) {
    await this.ensureArchiveBox();
    await this.runOp((imap, done) => imap.move(uid, this.archiveBox, done));
  }

  async deleteMail(uid: number) {
    await this.runOp((imap, done) => imap.addFlags(uid, ['\\Deleted'], done));
    await this.runOp((imap, done) => imap.expunge(uid, done));
  }

  // ===== 归档文件夹自动创建 =====

  private async ensureArchiveBox(): Promise<void> {
    if (this.archiveBoxEnsured) return;
    const folders = await this.listFolders();
    const exists = folders.some(
      (f) => f.name === this.archiveBox || f.path === this.archiveBox
    );
    if (!exists) {
      console.log(`📁 [user=${this.userId}] 创建归档目录 "${this.archiveBox}"`);
      await new Promise<void>((resolve, reject) => {
        if (!this.imap) return reject(new Error('IMAP 未连接'));
        this.imap.addBox(this.archiveBox, (err) => (err ? reject(err) : resolve()));
      });
    }
    this.archiveBoxEnsured = true;
  }

  private listFolders(): Promise<Array<{ name: string; path: string }>> {
    return new Promise((resolve, reject) => {
      if (!this.imap) return reject(new Error('IMAP 未连接'));
      this.imap.getBoxes((err, boxes) => {
        if (err) return reject(err);
        resolve(flattenBoxes(boxes));
      });
    });
  }

  // ===== 工具 =====

  private async runOp(
    op: (imap: Imap, done: (err?: Error | null) => void) => void
  ): Promise<void> {
    if (!this.imap) throw new Error(`[user=${this.userId}] IMAP 未连接`);
    await new Promise<void>((resolve, reject) => {
      op(this.imap as Imap, (err) => (err ? reject(err) : resolve()));
    });
  }
}

function flattenBoxes(boxes: any, parentPath = ''): Array<{ name: string; path: string }> {
  const result: Array<{ name: string; path: string }> = [];
  for (const [name, box] of Object.entries(boxes || {})) {
    const b: any = box;
    const fullPath = parentPath ? `${parentPath}${b.delimiter || '/'}${name}` : name;
    result.push({ name, path: fullPath });
    if (b.children) result.push(...flattenBoxes(b.children, fullPath));
  }
  return result;
}
