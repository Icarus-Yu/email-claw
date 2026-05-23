import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import { emailService } from './backend/services/emailService';
import { runBootstrap } from './backend/services/bootstrap';
import feishuRoutes from './backend/api/routes/feishuRoutes';
import authRoutes from './backend/api/routes/authRoutes';
import userRoutes from './backend/api/routes/userRoutes';
import emailRoutes from './backend/api/routes/emailRoutes';
import ruleRoutes from './backend/api/routes/ruleRoutes';

const app = express();
app.use(express.json({ limit: '2mb' }));

const PORT = process.env.PORT || 3000;

app.get('/ping', (_req, res) => {
  res.json({ message: '🏓 EmailClaw 已启动' });
});

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/emails', emailRoutes);
app.use('/api/rules', ruleRoutes);
app.use('/api/feishu', feishuRoutes);

async function start() {
  // 启动前自检：必填环境
  if (!process.env.JWT_SECRET) {
    console.warn('⚠️ JWT_SECRET 未配置，认证 API 将无法使用');
  }
  if (!process.env.ENCRYPTION_KEY) {
    console.warn('⚠️ ENCRYPTION_KEY 未配置，绑定邮箱将失败');
  }
  if (!process.env.FEISHU_BOT_SHARED_SECRET && process.env.NODE_ENV === 'production') {
    console.warn('⚠️ FEISHU_BOT_SHARED_SECRET 未配置（生产环境必填）');
  }

  app.listen(PORT, () => {
    console.log(`🚀 EmailClaw 后端: http://localhost:${PORT}`);
  });

  try {
    await runBootstrap();
  } catch (e: any) {
    console.error('❌ Bootstrap 失败:', e.message);
  }

  try {
    await emailService.start();
  } catch (e: any) {
    console.error('❌ ImapManager 启动失败:', e.message);
  }
}

start().catch((e) => {
  console.error('❌ 启动失败:', e);
  process.exit(1);
});
