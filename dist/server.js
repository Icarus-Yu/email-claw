"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
// 加载 .env 文件里的机密配置
dotenv_1.default.config();
const express_1 = __importDefault(require("express"));
const emailService_1 = require("./backend/services/emailService");
const feishuRoutes_1 = __importDefault(require("./backend/api/routes/feishuRoutes"));
const app = (0, express_1.default)();
app.use(express_1.default.json()); // 允许程序解析 JSON 格式的网络请求
const PORT = process.env.PORT || 3000;
app.get('/ping', (req, res) => {
    res.json({ message: '🏓 EmailClaw 服务器已启动，随时准备接管邮件！' });
});
// 飞书卡片按钮回调路由
app.use('/api/feishu', feishuRoutes_1.default);
app.listen(PORT, () => {
    console.log(`🚀 服务正在运行: http://localhost:${PORT}`);
    // 服务器启动后，立刻触发 IMAP 鉴权与连接测试
    emailService_1.emailService.connect();
});
