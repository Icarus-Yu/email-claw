# EmailClaw 智能邮件管家

EmailClaw 是一个基于 IMAP、Agent 分析和飞书机器人卡片的邮件处理系统。它会监听邮箱新邮件，分析邮件分类、重要性和摘要，将结果推送到飞书卡片，并允许用户在飞书里完成已读、重点、归档、删除、分类反馈、查看详情和重新分析等操作。

当前版本已经形成一条 MVP 闭环：

```text
IMAP 邮箱
  -> EmailClaw 后端抓取与解析邮件
  -> Agent 分析分类、重要性、摘要
  -> PostgreSQL 持久化
  -> 推送飞书机器人卡片
  -> 用户点击卡片按钮
  -> 后端同步数据库和真实邮箱状态
  -> 飞书卡片刷新状态或展示详情
```

## 当前能力

- IMAP 长连接监听邮箱，并抓取未处理邮件。
- 使用 `mailparser` 解析邮件正文、HTML 和附件信息。
- 邮件基础信息、分析结果、反馈和操作状态保存到 PostgreSQL。
- 内置本地规则 Agent，可在不接大模型的情况下完成基础分类、重要性判断和摘要生成。
- 可选接入 OpenClaw，由 OpenClaw 调用外部大模型增强分析质量。
- 飞书机器人发送交互式邮件卡片。
- 飞书卡片按钮回调后端，支持真实邮箱操作和数据库状态更新。
- 支持查看详情卡片、重新分析当前邮件、分类正确/错误反馈。

## 技术栈

- Node.js + TypeScript
- Express
- Prisma + PostgreSQL
- `imap` + `mailparser`
- 飞书开放平台 Node SDK
- 可选：OpenClaw

## 项目结构

```text
.
├── src/
│   ├── server.ts                         # 主后端入口，默认端口 3000
│   ├── backend/
│   │   ├── api/routes/feishuRoutes.ts    # 飞书按钮回调入口
│   │   ├── integrations/feishu/          # 主后端 -> 飞书 bot 的适配层
│   │   └── services/                     # 邮件、数据库、Agent 服务
│   ├── agents/                           # 本地规则 Agent、Skill 和工具
│   ├── cards/                            # 根目录 bot 代码副本
│   └── handlers/                         # 根目录 bot 代码副本
├── email_claw_bot/
│   └── src/
│       ├── server.js                     # 飞书 bot 服务入口，默认端口 3001
│       ├── cards/emailCard.js            # 飞书卡片构建器
│       ├── handlers/cardHandler.js       # 卡片按钮事件处理
│       └── services/feishuClient.js      # 飞书 OpenAPI 封装
├── prisma/
│   ├── schema.prisma                     # PostgreSQL 数据模型
│   └── migrations/                       # 数据库迁移
└── dist/                                 # TypeScript 编译产物
```

说明：当前仓库里 `src/cards`、`src/handlers`、`src/server.js` 与 `email_claw_bot` 下的 bot 代码存在重复。实际建议运行 `email_claw_bot/` 作为独立飞书机器人服务，主后端运行 `src/server.ts`。

## 运行前准备

需要准备以下外部环境：

- Node.js 18+，建议 Node.js 20+。
- PostgreSQL 数据库。
- 一个支持 IMAP 的邮箱账号和授权码。
- 飞书企业自建应用，并开启机器人能力和事件订阅。
- 可选：OpenClaw 及其大模型 API 配置。

## 安装依赖

主后端依赖：

```bash
npm install
```

飞书 bot 依赖：

```bash
cd email_claw_bot
npm install
cd ..
```

## 环境变量

### 主后端 `.env`

在项目根目录创建 `.env`：

```env
PORT=3000

DATABASE_URL="postgresql://USER:PASSWORD@localhost:5432/emailclaw?schema=public"

IMAP_USER=your-email@example.com
IMAP_PASSWORD=your-imap-authorization-code
IMAP_HOST=imap.example.com
IMAP_PORT=993
IMAP_TLS=true
IMAP_ARCHIVE_BOX=Archive

FEISHU_BOT_URL=http://localhost:3001

# OpenClaw 可选；不配置或不设为 true 时使用本地规则 Agent
OPENCLAW_ENABLED=false
OPENCLAW_COMMAND=openclaw
OPENCLAW_AGENT_ID=email-claw
OPENCLAW_TIMEOUT_MS=30000
```

注意：

- `DATABASE_URL` 当前使用 PostgreSQL。
- `IMAP_PASSWORD` 通常不是邮箱登录密码，而是邮箱服务商生成的 IMAP 授权码。
- `IMAP_ARCHIVE_BOX` 需要和邮箱里的归档文件夹名称一致，不同服务商可能不是 `Archive`。
- OpenClaw 不是必需项；关闭时系统会使用项目内置本地规则 Agent。

### 飞书 bot `.env`

可以从 `email_claw_bot/.env.example` 复制：

```bash
cp email_claw_bot/.env.example email_claw_bot/.env
```

填写：

```env
APP_ID=cli_xxx
APP_SECRET=xxx
PORT=3001
BACKEND_URL=http://localhost:3000
DEFAULT_OPEN_ID=ou_xxx
```

注意：

- `APP_ID` 和 `APP_SECRET` 来自飞书开放平台企业自建应用。
- `DEFAULT_OPEN_ID` 是默认接收邮件卡片的飞书用户 open_id。
- 飞书应用需要具备发送消息、接收消息/卡片事件等必要权限，并配置事件订阅。

## 数据库初始化

生成 Prisma Client：

```bash
npx prisma generate
```

开发环境可执行迁移：

```bash
npx prisma migrate dev
```

如果你只想把现有迁移应用到数据库：

```bash
npx prisma migrate deploy
```

当前 `Email` 模型包含关键状态字段：

- `category`
- `importance`
- `summary`
- `isRead`
- `isArchived`
- `isDeleted`

## 启动服务

启动主后端：

```bash
npm run dev
```

主后端默认地址：

```text
http://localhost:3000
```

健康检查：

```text
GET http://localhost:3000/ping
```

另开一个终端启动飞书 bot：

```bash
cd email_claw_bot
npm run dev
```

飞书 bot 默认地址：

```text
http://localhost:3001
```

健康检查：

```text
GET http://localhost:3001/ping
```

## 快速验证飞书卡片

在飞书 bot 启动后，可以先不等真实邮件，用 mock 接口发送一张测试卡片：

```bash
curl -X POST http://localhost:3001/api/mock-card \
  -H "Content-Type: application/json" \
  -d '{}'
```

如果 `DEFAULT_OPEN_ID` 正确、飞书应用权限正确，你会在飞书收到一张邮件通知卡片。

## 飞书卡片效果

卡片会展示：

```text
邮件主题

发件人 / 收件人
收到时间

分类：工作 / 个人 / 购物 / 营销 / 垃圾 / 其他
置信度
重要性评分
摘要
分类理由
状态：未读 / 已读 / 已归档 / 已删除

[标为已读] [标为重点] [归档]
[分类正确] [分类错误] [查看详情]
[删除] [重新分析]
```

按钮行为：

- 标为已读：IMAP 添加 `\Seen`，数据库 `isRead = true`，刷新卡片状态。
- 标为重点：IMAP 添加 `\Flagged`，数据库 `importance = 10`，刷新卡片。
- 归档：IMAP 移动到 `IMAP_ARCHIVE_BOX`，数据库 `isArchived = true`，刷新卡片。
- 删除：IMAP 标记 `\Deleted` 并 `expunge`，数据库 `isDeleted = true`，卡片显示已删除。
- 分类正确：记录分类反馈。
- 分类错误：先展示分类选择卡片，选择后记录正确分类并刷新卡片。
- 查看详情：展示详情卡片，包括正文预览。
- 重新分析：重新运行 Agent，只更新当前邮件分析结果和当前卡片，不重复推送新卡片。

## Agent 与 OpenClaw

OpenClaw 是可选增强，不是项目运行的硬依赖。

默认情况下，系统使用本地规则 Agent：

- `src/backend/services/agentService.ts`
- `src/agents/skills/classificationSkill.ts`
- `src/agents/tools/emailTextTools.ts`

本地规则 Agent 不调用大模型 API。它通过关键词和简单文本处理完成：

- 邮件分类
- 重要性评分
- 简短摘要

如果设置：

```env
OPENCLAW_ENABLED=true
```

后端会尝试调用：

```text
openclaw agent --agent email-claw --message ... --json --local
```

OpenClaw 侧通常需要另外配置可用的大模型 API。若 OpenClaw 调用失败，后端会回退到本地规则 Agent。

## 常见问题

### 1. 服务启动了，但一处理邮件就失败

优先检查 PostgreSQL 是否运行，以及 `DATABASE_URL` 是否正确。

```bash
pg_isready -h localhost -p 5432
```

### 2. 飞书 bot 启动失败

检查 `email_claw_bot/.env` 中是否配置：

- `APP_ID`
- `APP_SECRET`
- `DEFAULT_OPEN_ID`

同时确认已在 `email_claw_bot/` 下执行过 `npm install`。

### 3. 能收到卡片，但按钮操作失败

检查：

- 主后端是否运行在 `BACKEND_URL` 指向的地址。
- 主后端是否能访问数据库。
- IMAP 是否仍然连接。
- `IMAP_ARCHIVE_BOX` 是否是邮箱真实存在的文件夹。

### 4. 不接 OpenClaw 可以吗

可以。`OPENCLAW_ENABLED=false` 或不配置时，系统会使用本地规则 Agent。缺点是分析质量偏基础，但足够跑通完整流程。

## 当前状态

当前代码已覆盖 MVP 功能闭环。真正运行前还需要完成：

- 安装主后端和飞书 bot 依赖。
- 启动 PostgreSQL。
- 执行 Prisma migration。
- 配置主后端 `.env`。
- 配置飞书 bot `.env`。
- 在飞书开放平台配置应用权限和事件订阅。
- 配置邮箱 IMAP 授权码。
- 做一次真实端到端联调。
