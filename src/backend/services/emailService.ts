import Imap from 'imap';

export class EmailService {
  private imap: Imap | null = null;

  // 将初始化逻辑移到 connect 方法中
  public connect() {
    console.log('🔄 正在加载配置，准备连接 IMAP 服务器...');

    // 此时 .env 已经被 server.ts 加载，可以安全读取
    this.imap = new Imap({
      user: process.env.IMAP_USER || '',
      password: process.env.IMAP_PASSWORD || '',
      host: process.env.IMAP_HOST || 'imap.qq.com',
      port: parseInt(process.env.IMAP_PORT || '993', 10),
      
      tls: true, // 强制开启 TLS
      tlsOptions: { 
        rejectUnauthorized: false,
        servername: process.env.IMAP_HOST || 'imap.qq.com' 
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
      // 下一步：打开 INBOX
    });

    this.imap.once('error', (err: Error) => {
      console.error('❌ IMAP 连接或鉴权失败:', err.message);
    });

    this.imap.once('end', () => {
      console.log('⚠️ IMAP 连接已断开');
    });
  }
}

export const emailService = new EmailService();