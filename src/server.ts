import express from 'express';
import dotenv from 'dotenv';
import { emailService } from './backend/services/emailService';
// 加载 .env 文件里的机密配置
dotenv.config();

const app = express();
app.use(express.json()); // 允许程序解析 JSON 格式的网络请求

const PORT = process.env.PORT || 3000;

app.get('/ping', (req, res) => {
  res.json({ message: '🏓 EmailClaw 服务器已启动，随时准备接管邮件！' });
});

app.listen(PORT, () => {
  console.log(`🚀 服务正在运行: http://localhost:${PORT}`);
  
  // 服务器启动后，立刻触发 IMAP 鉴权与连接测试
  emailService.connect();
});