/**
 * EmailClaw 飞书机器人服务
 *
 * 职责：
 * 1. 接收后端推送的邮件分析数据 → 构建并发送飞书卡片
 * 2. 接收飞书卡片按钮点击事件 → 处理或转发给后端
 * 3. 提供 /api/notify-email 接口供 email-claw 后端调用
 *
 * 启动方式:
 *   npm run dev    # 开发模式（文件变更自动重启）
 *   npm start      # 生产模式
 */

require('dotenv').config();

const express = require('express');
const Lark = require('@larksuiteoapi/node-sdk');
const { buildEmailCard } = require('./cards/emailCard');
const { handleCardAction } = require('./handlers/cardHandler');
const feishuClient = require('./services/feishuClient');

// ========== 配置校验 ==========
const APP_ID = process.env.APP_ID;
const APP_SECRET = process.env.APP_SECRET;
const PORT = parseInt(process.env.PORT, 10) || 3001;
const DEFAULT_OPEN_ID = process.env.DEFAULT_OPEN_ID;

if (!APP_ID || !APP_SECRET) {
  console.error('❌ 请在 .env 文件中配置 APP_ID 和 APP_SECRET');
  process.exit(1);
}

// ========== 初始化飞书客户端 ==========
feishuClient.init(APP_ID, APP_SECRET);

const baseConfig = {
  appId: APP_ID,
  appSecret: APP_SECRET,
  domain: process.env.BASE_DOMAIN || 'https://open.feishu.cn',
};

const wsClient = new Lark.WSClient(baseConfig);

// ========== Express HTTP 服务 ==========
const app = express();
app.use(express.json());

/**
 * 健康检查
 */
app.get('/ping', (_req, res) => {
  res.json({ status: 'ok', service: 'EmailClaw Bot', timestamp: new Date().toISOString() });
});

/**
 * 接收后端推送的邮件分析数据，构建并发送飞书卡片
 *
 * POST /api/notify-email
 * Body: 邮件分析数据（与飞书前端对接文档约定的 JSON 结构一致）
 *   {
 *     emailId, from, to, subject, receivedAt,
 *     category, importance, summary, classificationReasoning,
 *     confidence, isRead, isArchived,
 *     openId (可选，指定接收用户)
 *   }
 */
app.post('/api/notify-email', async (req, res) => {
  try {
    const emailData = req.body;

    // 基础校验
    if (!emailData.emailId || !emailData.subject) {
      return res.status(400).json({
        error: '缺少必填字段 emailId 或 subject',
      });
    }

    console.log(`📧 收到邮件通知: [${emailData.subject}] from ${emailData.from}`);

    // 构建飞书卡片
    const cardJson = buildEmailCard(emailData);

    // 发送卡片到指定用户
    const openId = emailData.openId || DEFAULT_OPEN_ID;
    if (!openId) {
      return res.status(400).json({
        error: '未指定接收用户 openId，请在请求中提供或在 .env 中配置 DEFAULT_OPEN_ID',
      });
    }

    const result = await feishuClient.sendCard('open_id', openId, cardJson);
    console.log(`✅ 卡片已发送至 ${openId}, messageId=${result.message_id}`);

    res.json({
      success: true,
      messageId: result.message_id,
      message: '卡片已发送',
    });
  } catch (error) {
    console.error('❌ 发送卡片失败:', error.message);
    res.status(500).json({
      error: error.message,
    });
  }
});

/**
 * 向指定用户发送文本消息（用于测试）
 *
 * POST /api/send-text
 * Body: { openId, text }
 */
app.post('/api/send-text', async (req, res) => {
  try {
    const { openId, text } = req.body;
    if (!openId || !text) {
      return res.status(400).json({ error: '缺少 openId 或 text' });
    }

    const result = await feishuClient.sendText('open_id', openId, text);
    res.json({ success: true, messageId: result.message_id });
  } catch (error) {
    console.error('❌ 发送文本失败:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Mock 模式：无需后端，直接发送测试卡片
 *
 * POST /api/mock-card
 * Body: (可选，覆盖默认 mock 数据)
 */
app.post('/api/mock-card', async (req, res) => {
  try {
    const mockData = {
      emailId: 'mock-email-001',
      from: 'teacher@example.com',
      to: 'student@example.com',
      subject: '项目会议通知',
      receivedAt: '2026-04-25T10:00:00.000Z',
      category: 'work',
      importance: 8,
      summary: '明天下午三点讨论项目需求。',
      classificationReasoning: '邮件涉及项目会议和需求讨论。',
      confidence: 0.9,
      isRead: false,
      isArchived: false,
      ...req.body,
    };

    const cardJson = buildEmailCard(mockData);
    const openId = req.body.openId || DEFAULT_OPEN_ID;
    if (!openId) {
      return res.status(400).json({ error: '请提供 openId 或在 .env 中配置 DEFAULT_OPEN_ID' });
    }

    const result = await feishuClient.sendCard('open_id', openId, cardJson);

    res.json({
      success: true,
      messageId: result.message_id,
      message: 'Mock 卡片已发送',
      mockData,
    });
  } catch (error) {
    console.error('❌ 发送 Mock 卡片失败:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ========== 飞书事件处理（WebSocket 长连接） ==========
const eventDispatcher = new Lark.EventDispatcher({}).register({
  /**
   * 用户首次进入机器人单聊 → 发送欢迎消息
   */
  'im.chat.access_event.bot_p2p_chat_entered_v1': async (data) => {
    const {
      operator_id: { open_id },
    } = data;
    console.log(`👋 用户进入单聊: ${open_id}`);

    await feishuClient.sendText(
      'open_id',
      open_id,
      '欢迎使用 EmailClaw 智能邮件管家！\n\n当后端分析完邮件后，会通过本机器人向你推送邮件通知卡片。\n\n你也可以发送任意消息来触发测试。'
    );
  },

  /**
   * 接收用户消息
   */
  'im.message.receive_v1': async (data) => {
    const {
      message: { chat_type, chat_id },
      sender: {
        sender_id: { open_id },
      },
    } = data;
    console.log('Received message:', data);

    // 在单聊中收到消息时，回复提示
    if (chat_type === 'p2p') {
      await feishuClient.sendText(
        'open_id',
        open_id,
        '你好！我是 EmailClaw 邮件管家。\n\n当前机器人主要用于接收邮件通知卡片。请等待后端推送邮件分析结果，或使用 POST /api/mock-card 接口发送测试卡片。'
      );
    }
  },

  /**
   * 卡片按钮点击回调 —— 核心事件处理
   */
  'card.action.trigger': async (data) => {
    console.log('🃏 收到卡片按钮事件:', JSON.stringify(data, null, 2));

    try {
      const response = await handleCardAction(data, feishuClient);
      return response || {};
    } catch (error) {
      console.error('❌ 处理卡片事件失败:', error);
      return {
        toast: {
          type: 'error',
          content: `处理失败: ${error.message}`,
          i18n: {
            zh_cn: `处理失败: ${error.message}`,
            en_us: `Error: ${error.message}`,
          },
        },
      };
    }
  },
});

// ========== 启动服务 ==========
async function start() {
  // 启动 HTTP 服务
  app.listen(PORT, () => {
    console.log(`🚀 EmailClaw Bot HTTP 服务已启动: http://localhost:${PORT}`);
    console.log(`   POST /api/notify-email  - 接收后端数据并发送卡片`);
    console.log(`   POST /api/mock-card     - 发送测试卡片（无需后端）`);
    console.log(`   POST /api/send-text     - 发送文本消息`);
    console.log(`   GET  /ping              - 健康检查`);
  });

  // 启动飞书 WebSocket 长连接，接收事件
  console.log('🔌 正在连接飞书事件长连接...');
  wsClient.start({ eventDispatcher });
  console.log('✅ 飞书事件监听已启动');
}

start().catch((error) => {
  console.error('❌ 启动失败:', error);
  process.exit(1);
});
