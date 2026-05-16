"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.emailService = exports.EmailService = void 0;
const imap_1 = __importDefault(require("imap"));
const mailparser_1 = require("mailparser");
const agentService_1 = require("./agentService");
const databaseService_1 = require("./databaseService");
const feishuService_1 = require("../integrations/feishu/feishuService");
// 自动推断 IMAP 配置的辅助函数
function resolveImapConfig(email, envHost, envPort) {
    if (envHost) {
        return {
            host: envHost,
            port: envPort ? parseInt(envPort, 10) : 993
        };
    }
    const domain = email.split('@')[1]?.toLowerCase();
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
            return { host: `imap.${domain}`, port: 993 };
    }
}
class EmailService {
    imap = null;
    isConnecting = false;
    PROCESSED_FLAG = 'CLAWED'; // 自定义标记，防止重复处理
    DEFAULT_USER_ID = 'default-user-id'; // 演示用，实际应从配置或数据库获取
    ARCHIVE_BOX = process.env.IMAP_ARCHIVE_BOX || 'Archive';
    connect() {
        if (this.isConnecting)
            return;
        this.isConnecting = true;
        console.log('🔄 正在加载配置，准备连接 IMAP 服务器...');
        const userEmail = process.env.IMAP_USER || '';
        const userPassword = process.env.IMAP_PASSWORD || '';
        const imapConfig = resolveImapConfig(userEmail, process.env.IMAP_HOST, process.env.IMAP_PORT);
        console.log(`📡 识别到邮箱，目标 IMAP 服务器: ${imapConfig.host}:${imapConfig.port}`);
        this.imap = new imap_1.default({
            user: userEmail,
            password: userPassword,
            host: imapConfig.host,
            port: imapConfig.port,
            tls: true,
            tlsOptions: {
                rejectUnauthorized: false,
                servername: imapConfig.host
            },
            authTimeout: 15000,
            keepalive: {
                interval: 10000,
                idleInterval: 300000,
                forceNoop: true
            }
        });
        this.initListeners();
        this.imap.connect();
    }
    initListeners() {
        if (!this.imap)
            return;
        this.imap.once('ready', () => {
            this.isConnecting = false;
            console.log('✅ IMAP 连接成功，鉴权通过！');
            this.imap?.openBox('INBOX', false, (err, box) => {
                if (err) {
                    console.error('❌ 打开 INBOX 失败:', err);
                    return;
                }
                console.log(`📂 成功打开 INBOX，当前共有 ${box.messages.total} 封邮件。`);
                // 初次连接时，可以先扫描未标记过的历史邮件
                this.scanUnprocessedEmails();
                this.imap?.on('mail', (numNewMsgs) => {
                    console.log(`📬 检测到 ${numNewMsgs} 封新邮件到达！`);
                    this.fetchLatestEmails();
                });
            });
        });
        this.imap.on('error', (err) => {
            this.isConnecting = false;
            console.error('❌ IMAP 错误:', err.message);
            this.reconnect();
        });
        this.imap.once('end', () => {
            this.isConnecting = false;
            console.log('⚠️ IMAP 连接已断发，准备重连...');
            this.reconnect();
        });
    }
    reconnect() {
        setTimeout(() => {
            console.log('🔄 正在尝试重新连接...');
            this.connect();
        }, 5000);
    }
    scanUnprocessedEmails() {
        if (!this.imap)
            return;
        // 仅搜索未读邮件，之后在代码中过滤已处理过的标记
        this.imap.search(['UNSEEN'], (err, uids) => {
            if (err) {
                console.error('❌ 搜索邮件失败:', err);
                return;
            }
            if (uids.length > 0) {
                console.log(`🔎 发现 ${uids.length} 封待处理的未读邮件。`);
                this.fetchEmailsByUids(uids);
            }
        });
    }
    fetchLatestEmails() {
        setTimeout(() => {
            this.scanUnprocessedEmails();
        }, 1000);
    }
    fetchEmailsByUids(uids) {
        if (!this.imap || uids.length === 0)
            return;
        // 获取邮件内容和标记
        const f = this.imap.fetch(uids, { bodies: '', struct: true });
        f.on('message', (msg, seqno) => {
            let buffer = '';
            let uid;
            let flags = [];
            msg.on('body', (stream) => {
                stream.on('data', (chunk) => {
                    buffer += chunk.toString('utf8');
                });
            });
            msg.once('attributes', (attrs) => {
                uid = attrs.uid;
                flags = attrs.flags || [];
            });
            msg.once('end', async () => {
                // 如果已经包含处理标记，跳过
                if (flags.includes(this.PROCESSED_FLAG) || flags.includes(`\\${this.PROCESSED_FLAG}`)) {
                    console.log(`⏩ 邮件 UID:${uid} 已有处理标记，跳过。`);
                    return;
                }
                try {
                    const parsed = await (0, mailparser_1.simpleParser)(buffer);
                    const simpleEmail = {
                        uid,
                        messageId: parsed.messageId || `uid-${uid}`,
                        subject: parsed.subject || '(无主题)',
                        from: parsed.from?.text || 'Unknown',
                        to: Array.isArray(parsed.to) ? parsed.to.map(t => t.text).join(', ') : (parsed.to?.text || 'Unknown'),
                        date: parsed.date || new Date(),
                        text: parsed.text || '',
                        html: parsed.html || undefined,
                        attachments: parsed.attachments.map(a => ({
                            filename: a.filename,
                            contentType: a.contentType,
                            size: a.size
                        }))
                    };
                    this.processEmail(simpleEmail);
                }
                catch (error) {
                    console.error(`❌ 解析邮件失败 (UID: ${uid}):`, error);
                }
            });
        });
        f.once('error', (err) => {
            console.error('❌ Fetch 过程中出错:', err);
        });
    }
    /**
     * 核心业务逻辑：保存到数据库并交由 Agent 处理
     */
    async processEmail(email) {
        console.log(`🤖 正在处理邮件: [${email.subject}] 来自 ${email.from}`);
        try {
            // 1. 保存到数据库
            const saved = await databaseService_1.databaseService.upsertEmail(this.DEFAULT_USER_ID, {
                uid: email.uid,
                messageId: email.messageId,
                from: email.from,
                to: email.to,
                subject: email.subject,
                body: email.text,
                html: email.html,
                receivedAt: email.date,
            });
            console.log(`💾 邮件 UID:${email.uid} 已保存到数据库 (id=${saved.id})。`);
            // 2. 调用 Agent 进行基础分类、重要性判断和摘要生成
            const analysis = await agentService_1.agentService.analyzeEmail({
                userId: this.DEFAULT_USER_ID,
                email,
            });
            console.log(`🧠 Agent 分析完成: 分类=${analysis.classification.category}, 重要性=${analysis.importance.score}/10`);
            // 3. 推送飞书卡片通知
            await feishuService_1.feishuService.pushEmailCard({
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
            });
            // 4. 处理完成后，打上已处理标记
            this.markAsProcessed(email.uid);
        }
        catch (error) {
            console.error(`❌ 处理邮件失败 (UID: ${email.uid}):`, error);
        }
    }
    markAsProcessed(uid) {
        if (!this.imap)
            return;
        this.imap.addFlags(uid, [this.PROCESSED_FLAG], (err) => {
            if (err)
                console.error(`❌ 标记邮件 UID:${uid} 失败:`, err);
            else
                console.log(`✅ 邮件 UID:${uid} 已成功标记为处理过。`);
        });
    }
    // ========== 飞书回调触发的公开方法 ==========
    async markReadByEmailId(emailId) {
        const uid = await this.getUidByEmailIdOrThrow(emailId);
        await this.runImapOperation((imap, done) => {
            imap.addFlags(uid, ['\\Seen'], done);
        });
        console.log(`✅ 邮件 UID:${uid} 已标记为已读`);
    }
    async markImportantByEmailId(emailId) {
        const uid = await this.getUidByEmailIdOrThrow(emailId);
        await this.runImapOperation((imap, done) => {
            imap.addFlags(uid, ['\\Flagged'], done);
        });
        console.log(`✅ 邮件 UID:${uid} 已标记为重点`);
    }
    async archiveByEmailId(emailId) {
        const uid = await this.getUidByEmailIdOrThrow(emailId);
        await this.runImapOperation((imap, done) => {
            imap.move(uid, this.ARCHIVE_BOX, done);
        });
        console.log(`✅ 邮件 UID:${uid} 已归档到 ${this.ARCHIVE_BOX}`);
    }
    async deleteByEmailId(emailId) {
        const uid = await this.getUidByEmailIdOrThrow(emailId);
        await this.runImapOperation((imap, done) => {
            imap.addFlags(uid, ['\\Deleted'], done);
        });
        await this.runImapOperation((imap, done) => {
            imap.expunge(uid, done);
        });
        console.log(`✅ 邮件 UID:${uid} 已删除`);
    }
    async reanalyzeByEmailId(emailId) {
        const email = await databaseService_1.databaseService.getEmailById(emailId);
        if (!email) {
            throw new Error(`找不到邮件 emailId=${emailId}，无法重新分析`);
        }
        const simpleEmail = {
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
        const analysis = await agentService_1.agentService.analyzeEmailDraft({
            userId: email.userId,
            email: simpleEmail,
        });
        const duration = Date.now() - startedAt;
        const updatedEmail = await databaseService_1.databaseService.updateEmailAnalysisById(emailId, email.userId, {
            ...analysis,
            duration,
        });
        return { analysis, email: updatedEmail };
    }
    async runImapOperation(operation) {
        if (!this.imap) {
            throw new Error('IMAP 未连接，无法执行邮箱操作');
        }
        await new Promise((resolve, reject) => {
            operation(this.imap, (err) => {
                if (err)
                    reject(err);
                else
                    resolve();
            });
        });
    }
    async getUidByEmailIdOrThrow(emailId) {
        const email = await databaseService_1.databaseService.getEmailById(emailId);
        if (!email) {
            throw new Error(`找不到邮件 emailId=${emailId}`);
        }
        return email.uid;
    }
}
exports.EmailService = EmailService;
exports.emailService = new EmailService();
