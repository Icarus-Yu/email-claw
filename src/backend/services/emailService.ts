import Imap from 'imap';

// 新增：自动推断 IMAP 配置的辅助函数
function resolveImapConfig(email: string, envHost?: string, envPort?: string) {
  // 1. 如果环境变量中明确指定了 host，优先使用环境变量（保留用户自定义的权利）
  if (envHost) {
    return {
      host: envHost,
      port: envPort ? parseInt(envPort, 10) : 993
    };
  }

  // 2. 提取邮箱的域名部分并转为小写 (例如 user@qq.com -> qq.com)
  const domain = email.split('@')[1]?.toLowerCase();

  // 3. 根据常见域名匹配对应的 IMAP 服务器地址
  switch (domain) {
    case 'qq.com':
    case 'foxmail.com':
      return { host: 'imap.qq.com', port: 993 };
    case '163.com': // 考虑到你可能还会用到网易云音乐等网易系产品，顺便加上 163 邮箱支持
      return { host: 'imap.163.com', port: 993 };
    case '126.com':
      return { host: 'imap.126.com', port: 993 };
    case 'gmail.com':
      return { host: 'imap.gmail.com', port: 993 };
    case 'outlook.com':
    case 'hotmail.com':
      return { host: 'outlook.office365.com', port: 993 };
    default:
      // 如果不在常见列表内，兜底策略：盲猜格式为 imap.xxx.com（常见于企业邮箱）
      return { host: `imap.${domain}`, port: 993 };
  }
}

export class EmailService {
  private imap: Imap | null = null;

  public connect() {
    console.log('🔄 正在加载配置，准备连接 IMAP 服务器...');

    const userEmail = process.env.IMAP_USER || '';
    const userPassword = process.env.IMAP_PASSWORD || '';

    // 调用解析函数，自动识别主机和端口
    const imapConfig = resolveImapConfig(userEmail, process.env.IMAP_HOST, process.env.IMAP_PORT);

    console.log(`📡 识别到邮箱，目标 IMAP 服务器: ${imapConfig.host}:${imapConfig.port}`);

    this.imap = new Imap({
      user: userEmail,
      password: userPassword,
      host: imapConfig.host,
      port: imapConfig.port,
      
      tls: true, // 强制开启 TLS
      tlsOptions: { 
        rejectUnauthorized: false,
        servername: imapConfig.host // 这里也要同步改为动态获取的主机名
      }, 
      
      authTimeout: 10000, 
      debug: console.log 
    });

    // 绑定事件
    this.initListeners();

    // 发起连接
    this.imap.connect();
  }

  private initListeners() {
    if (!this.imap) return;

    this.imap.once('ready', () => {
      console.log('✅ IMAP 连接成功，鉴权通过！');
      
      // 下一步：打开 INBOX 文件夹
      // false 表示以读写模式打开（因为我们后续需要标记已读等操作）
      this.imap?.openBox('INBOX', false, (err, box) => {
        if (err) {
          console.error('❌ 打开 INBOX 失败:', err);
          return;
        }
        
        console.log(`📂 成功打开 INBOX，当前邮箱共有 ${box.messages.total} 封邮件。`);
        console.log('🎧 进入 IDLE 模式，开始实时监听新邮件...');

        // 监听新邮件到达事件
        this.imap?.on('mail', (numNewMsgs: number) => {
          console.log(`📬 叮！检测到 ${numNewMsgs} 封新邮件到达！`);
          this.fetchLatestEmails(numNewMsgs);
        });
        
        // 监听邮件被删除/移出事件 (可选，但有助于了解邮箱状态变化)
        this.imap?.on('expunge', (seqno: number) => {
          console.log(`🗑️ 序号为 ${seqno} 的邮件已被彻底删除或移出 INBOX。`);
        });
      });
    });

    this.imap.once('error', (err: Error) => {
      console.error('❌ IMAP 连接或鉴权失败:', err.message);
    });

    this.imap.once('end', () => {
      console.log('⚠️ IMAP 连接已断开');
    });
  }
  private fetchLatestEmails(numNewMsgs: number) 
{
 if (!this.imap)return ;
 //获取最新到达的邮件('*'代表最新的一份,如果是多份可以根据业务需求计算seq范围)
  const fetch= this.imap.seq.fetch('*',{
    bodies:''
  });
  
}

}

export const emailService = new EmailService();