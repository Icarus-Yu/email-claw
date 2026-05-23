# EmailClaw 智能邮件管家

EmailClaw 是一个基于 IMAP、Agent 分析和飞书机器人卡片的多用户邮件处理系统。它会实时监听用户邮箱，分析邮件分类、重要性和摘要，将结果推送到飞书卡片，并允许用户在飞书里完成已读、重点、归档、删除、分类反馈、查看详情和重新分析等操作。

完整数据流：

```text
IMAP 邮箱（每个用户独立长连接）
  -> EmailClaw 后端抓取与解析邮件
  -> 用户规则引擎（命中则跳过 Agent）
  -> Agent 分析分类、重要性、摘要
  -> PostgreSQL 持久化（按用户隔离）
  -> 按用户偏好推送飞书机器人卡片（重要邮件高亮）
  -> 用户点击卡片按钮
  -> bot 转发到后端（X-Bot-Secret + openId→userId 双重鉴权）
  -> 后端 ownership 校验 + 同步数据库和真实邮箱状态
  -> 飞书卡片异步刷新（updateCard）或新发详情卡片
```

## 当前能力

### 用户与鉴权
- 用户注册 / 登录（bcrypt 哈希 + JWT）。
- IMAP 凭据 AES-256-GCM 加密入库。
- 多用户 IMAP 长连接管理：每个用户独立的 IMAP 实例和邮件抓取。
- 三层防御性鉴权：HTTP（JWT / X-Bot-Secret）/ 业务（openId→userId）/ 数据（emailId ownership）。
- 引导用户：`.env` 配置的 IMAP 账号会在启动时自动注册并加密绑定。

### 邮件处理
- IMAP 长连接监听邮箱并抓取未读邮件，断线自动重连。
- 使用 `mailparser` 解析邮件正文、HTML 和附件。
- 邮件、分析结果、反馈、操作状态全部按 `userId` 隔离存入 PostgreSQL。
- 自定义 `CLAWED` IMAP flag 防止重复处理。

### 智能分析
- 内置本地规则 Agent：关键词驱动的分类 / 重要性 / 摘要（不调大模型）。
- 用户规则引擎：可配置 `from / to / subject / body` × `contains / equals / startsWith / endsWith / regex` 条件 + 分类 / 重要性 / 摘要 / 副作用动作。命中规则跳过 Agent。
- 可选接入 OpenClaw：由 OpenClaw 调用外部大模型增强分析质量；失败时自动回退本地规则。

### 飞书交互
- 重要邮件主动推送（按用户阈值，默认 importance ≥ 7 触发红色 header + 🔥 前缀）。
- 卡片交互闭环：标为已读 / 重点 / 归档 / 删除 / 分类正确 / 分类错误 / 查看详情 / 重新分析。
- "先 toast 再 updateCard" 模式：毫秒级响应飞书 3 秒回调超时 + 异步主动刷新卡片状态。
- 查看详情时新发一张详情卡片，保留原邮件卡片的操作按钮。

### REST API
- 完整的认证、用户管理、邮箱绑定、规则 CRUD、邮件搜索 / 过滤 API（见下方 API 速查）。

## 技术栈

- Node.js 20+ / TypeScript 5
- Express 5
- Prisma 7 + PostgreSQL
- `imap` + `mailparser`
- `bcryptjs` + `jsonwebtoken`（鉴权）
- AES-256-GCM（IMAP 凭据加密，Node 内置 `crypto`）
- 飞书开放平台 Node SDK（`@larksuiteoapi/node-sdk`）
- 可选：OpenClaw

## 项目结构

```text
.
├── src/
│   ├── server.ts                              # 后端入口（端口 3000）
│   ├── backend/
│   │   ├── api/routes/                        # REST 路由
│   │   │   ├── authRoutes.ts                  #   注册 / 登录
│   │   │   ├── userRoutes.ts                  #   用户自管理 / 绑定邮箱
│   │   │   ├── emailRoutes.ts                 #   邮件搜索 / 详情
│   │   │   ├── ruleRoutes.ts                  #   规则 CRUD
│   │   │   └── feishuRoutes.ts                #   飞书 webhook（带共享密钥校验）
│   │   ├── middleware/authMiddleware.ts       # requireAuth / requireBotSecret
│   │   ├── services/
│   │   │   ├── emailService.ts                #   facade：注册 IMAP 回调 + 写操作路由
│   │   │   ├── userMailbox.ts                 #   单用户 IMAP 长连接封装
│   │   │   ├── imapManager.ts                 #   多用户 IMAP 连接注册表
│   │   │   ├── ruleEngine.ts                  #   规则匹配引擎
│   │   │   ├── databaseService.ts             #   Prisma 数据访问
│   │   │   ├── agentService.ts                #   本地规则 Agent + OpenClaw 调度
│   │   │   ├── bootstrap.ts                   #   启动自检 / 引导用户
│   │   │   └── openClawClient.ts              #   OpenClaw CLI 适配
│   │   ├── integrations/feishu/feishuService.ts  # 飞书推送 + 回调分发
│   │   └── utils/
│   │       ├── auth.ts                        #   bcrypt + JWT 工具
│   │       └── crypto.ts                      #   AES-256-GCM 加解密
│   └── agents/                                # 本地规则 Agent、Skill 和工具
├── email_claw_bot/
│   └── src/
│       ├── server.js                          # 飞书 bot HTTP + WebSocket（端口 3001）
│       ├── cards/emailCard.js                 # 邮件卡片 / 详情卡片 / 分类选择卡片
│       ├── handlers/cardHandler.js            # 按钮事件转发 + updateCard 刷新
│       └── services/feishuClient.js           # 飞书 OpenAPI 封装
├── prisma/
│   ├── schema.prisma                          # 数据模型（User / Email / Classification / Rule / Contact / AgentLog）
│   └── migrations/                            # 数据库迁移
├── .env.example                               # 完整环境变量模板
└── dist/                                      # TypeScript 编译产物
```

> 仓库里 `src/cards`、`src/handlers`、`src/server.js` 是历史遗留的 bot 代码副本，实际不会被主后端引用。可以删除或保留供参考。

## 运行前准备

- Node.js 18+，建议 20+
- 本地或可访问的 PostgreSQL（默认假设 `localhost:5432`）
- 支持 IMAP 的邮箱账号 + 授权码（不是登录密码）
- 飞书企业自建应用（如需走飞书交互），开启机器人能力和事件订阅
- 可选：OpenClaw CLI + 大模型 API

## 安装依赖

```bash
# 主后端
npm install

# 飞书 bot
cd email_claw_bot && npm install && cd ..
```

## 环境变量

### 主后端 `.env`

从模板复制：

```bash
cp .env.example .env
```

关键字段：

```env
PORT=3000
DATABASE_URL="postgresql://USER:PASSWORD@localhost:5432/emailclaw?schema=public"

# ===== 安全 / 鉴权（必填）=====
JWT_SECRET=                  # ≥16 位，建议 openssl rand -hex 32
ENCRYPTION_KEY=              # 任意字符串，会经 sha-256 派生为 AES 密钥；一旦设置不要轻易更改
FEISHU_BOT_SHARED_SECRET=    # 与 bot 端必须一致；生产环境强制要求

# ===== 引导用户（可选）=====
# 如果设了下面 IMAP_* 且 BOOTSTRAP_PASSWORD 不为空，启动时若数据库还没有这个邮箱用户，
# 会自动注册一个并加密绑定邮箱；后续可用 IMAP_USER + BOOTSTRAP_PASSWORD 登录
BOOTSTRAP_PASSWORD=          # ≥8 位
IMAP_USER=
IMAP_PASSWORD=
IMAP_HOST=
IMAP_PORT=993
IMAP_TLS=true
IMAP_ARCHIVE_BOX=Archive
DEFAULT_FEISHU_OPEN_ID=      # 可选：引导用户默认绑定的飞书 openId

# ===== 飞书 bot 地址 =====
FEISHU_BOT_URL=http://localhost:3001

# ===== OpenClaw 可选 =====
OPENCLAW_ENABLED=false
OPENCLAW_COMMAND=openclaw
OPENCLAW_AGENT_ID=email-claw
OPENCLAW_TIMEOUT_MS=30000
```

注意：
- `IMAP_PASSWORD` 通常是邮箱服务商生成的 **IMAP 授权码**，不是邮箱登录密码（QQ / 163 / Gmail 都需要单独生成）。
- `IMAP_USER` + `BOOTSTRAP_PASSWORD` 只用来"开箱即用"地造一个引导用户，方便单机调试；生产环境应让真实用户走 `/api/auth/register` 注册。
- `IMAP_ARCHIVE_BOX` 不存在时系统会自动创建。

### 飞书 bot `.env`

```bash
cp email_claw_bot/.env.example email_claw_bot/.env
```

填写：

```env
APP_ID=cli_xxx
APP_SECRET=xxx
PORT=3001
BACKEND_URL=http://localhost:3000
DEFAULT_OPEN_ID=ou_xxx                  # 用户未绑定飞书时的默认接收者
FEISHU_BOT_SHARED_SECRET=               # 必须与主后端一致
```

- `APP_ID` / `APP_SECRET` 来自飞书开放平台企业自建应用
- 飞书应用需要：发送消息、接收消息 / 卡片事件等权限，并配置事件订阅
- `FEISHU_BOT_SHARED_SECRET` 用于 bot → 后端的 webhook 调用鉴权，防止外部恶意请求伪装成 bot 操作邮件

## 数据库初始化

生成 Prisma Client：

```bash
npx prisma generate
```

把 schema 同步到数据库：

```bash
npx prisma db push
```

> ⚠️ 当前仓库的 `prisma/migrations/` 只有一个增量 ALTER 迁移（add summary + isDeleted），缺初始 CREATE TABLE migration。所以**不要用 `prisma migrate deploy`**（会报 `relation "Email" does not exist`）。新机器请用 `db push`，或者自己补一个 `0_init` 初始迁移。

Schema 包含 6 张表：`User` / `Email` / `Classification` / `Contact` / `Rule` / `AgentLog`。

## 启动服务

```bash
# 终端 1：主后端
npm run dev
# → http://localhost:3000

# 终端 2：飞书 bot
cd email_claw_bot && npm run dev
# → http://localhost:3001
```

健康检查：

```bash
curl http://localhost:3000/ping
curl http://localhost:3001/ping
```

## REST API 速查

所有 `[JWT]` 标记的接口需要 `Authorization: Bearer <token>` 请求头。

### 认证

| Method | Path | Body | 说明 |
|---|---|---|---|
| POST | `/api/auth/register` | `{email, password}` | 注册（密码 ≥8 位），返回 `{token, user}` |
| POST | `/api/auth/login` | `{email, password}` | 登录，返回 `{token, user}` |

### 用户自管理 `[JWT]`

| Method | Path | Body | 说明 |
|---|---|---|---|
| GET | `/api/users/me` | — | 获取当前用户信息 + 偏好 + 邮箱绑定状态 |
| PATCH | `/api/users/me/preferences` | `{importanceThreshold?, pushAllEmails?}` | 设置重要性阈值（1–10）和是否推送全部邮件 |
| PATCH | `/api/users/me/feishu` | `{feishuUserId}` | 绑定飞书 openId（决定接收卡片的目标） |
| POST | `/api/users/me/mailbox` | `{imapHost, imapUser, imapPassword}` | 绑定 IMAP，密码会被加密入库并立即启动连接 |
| DELETE | `/api/users/me/mailbox` | — | 解绑邮箱并断开 IMAP（不删历史邮件） |

### 邮件搜索 `[JWT]`

| Method | Path | 说明 |
|---|---|---|
| GET | `/api/emails` | 分页搜索。query 参数：`category` / `sender` / `dateFrom` / `dateTo` / `importanceMin` / `importanceMax` / `q`（subject/from/body 关键词模糊匹配）/ `isRead` / `isArchived` / `isDeleted` / `page` / `pageSize`（默认 20，上限 100）|
| GET | `/api/emails/:id` | 单封详情（自动校验 ownership） |

返回：`{items, total, page, pageSize, totalPages}`

### 规则 CRUD `[JWT]`

| Method | Path | 说明 |
|---|---|---|
| GET | `/api/rules` | 列出本人规则（按 priority 降序） |
| POST | `/api/rules` | 创建规则，见下方 schema |
| PATCH | `/api/rules/:id` | 部分更新（name / description / conditions / actions / priority / isEnabled） |
| DELETE | `/api/rules/:id` | 删除 |

规则 schema：

```json
{
  "name": "校招邮件标重要",
  "description": "可选说明",
  "priority": 10,
  "isEnabled": true,
  "conditions": [
    {
      "field": "from|to|subject|body",
      "operator": "contains|equals|startsWith|endsWith|regex",
      "value": "hrzhaopin",
      "caseSensitive": false
    }
  ],
  "actions": {
    "category": "work|personal|shopping|marketing|spam|other",
    "importance": 8,
    "summary": "可选自定义摘要",
    "sideEffects": ["mark_read", "archive", "delete"]
  }
}
```

- 多个 `conditions` 之间是 AND 关系
- 按 `priority` 降序匹配，首个命中即终止；**命中后跳过 Agent**
- `actions.category` 必填，`importance` 默认 5，`summary` 默认走自动摘要
- `sideEffects` 会调真实 IMAP 执行

### 飞书 webhook `[X-Bot-Secret]`

| Method | Path | 说明 |
|---|---|---|
| POST | `/api/feishu/webhook` | bot 转发卡片按钮事件。需 `X-Bot-Secret` 头 + body 带 `openId`（用于解析 userId） |

请求体：`{action, emailId, openId, expectedCategory?, comment?}`

## 飞书卡片效果

```text
🔥 邮件主题（重要邮件红色 header + 🔥 前缀）

发件人 / 收件人
收到时间

📂 分类：工作 / 个人 / 购物 / 营销 / 垃圾 / 其他
置信度
⭐ 重要性 ★★★★★★★★ (8/10)
📝 摘要
💡 分类理由
状态：未读 / 已读 / 已归档 / 已删除

[📖 标为已读] [⭐ 标为重点] [📦 归档]
[✅ 分类正确] [❌ 分类错误] [🔍 查看详情]
[🗑 删除] [🔄 重新分析]
```

按钮行为：

- **标为已读**：IMAP 加 `\Seen`，DB `isRead=true`，**异步 updateCard 刷新状态**
- **标为重点**：IMAP 加 `\Flagged`，DB `importance=10`
- **归档**：IMAP `MOVE` 到 `IMAP_ARCHIVE_BOX`，DB `isArchived=true`
- **删除**：IMAP `\Deleted` + `expunge`，DB `isDeleted=true`，卡片按钮区消失
- **分类正确**：写 `Classification.feedback='correct'`
- **分类错误**：展示分类选择卡片 → 选择后写正确分类并刷新原卡片
- **查看详情**：**新发**一张详情卡片（保留原邮件卡片）
- **重新分析**：不重新走规则，只重跑 Agent，更新当前卡片

> 所有按钮采用 "先返回 toast 让飞书停止倒计时 → 后台 await 后端 → 主动 updateCard / sendCard 刷新" 的模式，所以不会出现飞书 3 秒红色超时错误。

## 快速验证

启动 bot 后可以用 mock 接口发一张测试卡片：

```bash
curl -X POST http://localhost:3001/api/mock-card \
  -H "Content-Type: application/json" \
  -d '{}'
```

> 注意：mock 卡片的 `emailId='mock-email-001'` 在数据库不存在，按钮操作会走失败兜底路径。要测真实按钮交互需要发一封真邮件。

## Agent 与 OpenClaw

OpenClaw 是可选增强，不是项目运行的硬依赖。

默认使用本地规则 Agent（关键词驱动）：

- `src/backend/services/agentService.ts`
- `src/agents/skills/classificationSkill.ts`
- `src/agents/tools/emailTextTools.ts`

如果设置 `OPENCLAW_ENABLED=true`，后端会尝试调用：

```text
openclaw agent --agent email-claw --message ... --json --local
```

OpenClaw 侧需另配大模型 API。失败时自动回退本地规则。

## 常见问题

### 1. `relation "Email" does not exist`

仓库缺初始 CREATE TABLE migration。用 `npx prisma db push` 直接同步 schema 即可，不要用 `migrate deploy`。

### 2. `ENCRYPTION_KEY 未配置：请在 .env 设置一个长度 >= 32 的随机字符串`

`.env` 加：

```env
ENCRYPTION_KEY=$(openssl rand -hex 32)
```

⚠️ 一旦设置切勿更改，否则已加密的 IMAP 凭据无法解密，所有已绑定用户都得重绑邮箱。

### 3. `JWT_SECRET 未配置或长度不足 16`

`.env` 加：

```env
JWT_SECRET=$(openssl rand -hex 32)
```

### 4. 飞书卡片按钮提示"操作失败 (xxx): bot 共享密钥校验失败"

主后端和 bot 两边的 `FEISHU_BOT_SHARED_SECRET` 不一致。两边都要设、且必须相同。

### 5. 飞书卡片按钮提示"该飞书账号未绑定 EmailClaw 用户"

点击按钮的飞书用户的 `open_id` 在数据库里没匹配的 `User.feishuUserId`。两种解决方案：
- 登录该用户后调 `PATCH /api/users/me/feishu  {"feishuUserId":"ou_xxx"}`
- 或在 `.env` 设 `DEFAULT_FEISHU_OPEN_ID=ou_xxx`（仅影响引导用户）

### 6. 引导用户登录账号 / 密码？

账号 = `.env` 里 `IMAP_USER`，密码 = `.env` 里 `BOOTSTRAP_PASSWORD`。如果忘了，可以直接连数据库改：

```sql
-- 重置引导用户密码（先用 bcrypt 算好哈希，或者直接删了重新让 bootstrap 跑）
DELETE FROM "User" WHERE email = 'your-imap@example.com';
-- 重启后端，bootstrap 会重新建
```

### 7. 服务启动了，但一处理邮件就失败

依次排查：
- `pg_isready -h localhost -p 5432` 数据库是否运行
- `.env` 的 `DATABASE_URL` 是否正确
- IMAP 授权码是否过期 / 是否开启了 IMAP 服务

### 8. 飞书 bot 启动失败

检查 `email_claw_bot/.env` 是否齐全：`APP_ID` / `APP_SECRET` / `DEFAULT_OPEN_ID` / `FEISHU_BOT_SHARED_SECRET`，并确认 `email_claw_bot/` 下执行过 `npm install`。

### 9. 不接 OpenClaw 可以吗

可以。`OPENCLAW_ENABLED=false` 或不配置时，系统会使用本地规则 Agent。缺点是分类基于关键词匹配，质量偏基础，但能跑通完整流程。建议结合用户规则引擎补强（规则命中跳过 Agent）。

## 防御性鉴权三层防线

按邮件多账号场景的安全需求专门设计：

| 层 | 位置 | 内容 |
|---|---|---|
| **HTTP** | `requireAuth` / `requireBotSecret` 中间件 | 所有用户 API 强制 JWT；飞书 webhook 必须带 `X-Bot-Secret` |
| **业务** | `feishuRoutes.ts` | 先 `openId → userId`，未绑定飞书的请求直接 403 |
| **数据** | `databaseService.assertEmailOwnership(emailId, userId)` | 每次写操作前校验 emailId 归属；规则 CRUD 用 `updateMany / deleteMany where userId` 防越权 |

实测越权拦截：
- 攻击者读他人邮件 → `{"error":"无权操作此邮件"}`
- 攻击者列邮件 → 空集
- 无 `X-Bot-Secret` 调 webhook → 401

## 当前状态

已覆盖能力（对应需求规格说明书）：

- ✅ FR-1 邮件实时接收与存储 + 多用户支持
- ✅ FR-2 AI 智能分类（本地规则 + 可选 OpenClaw）
- ✅ FR-3 重要性评分 + 主动推送（阈值可配）
- ✅ FR-4 邮件摘要生成
- ✅ FR-5 用户交互与反馈 + 规则自定义
- ✅ FR-6 邮件搜索与过滤
- ⏳ FR-7 每日摘要与统计（未实现）

剩余 TODO：

- 真正接入 LLM（当前是关键词匹配，分类质量受限）
- Agent 反馈学习闭环（用户纠错只写入了 `Classification.feedback`，没喂回 Agent）
- 每日摘要 cron + 统计聚合
- 补一个 Prisma `0_init` 初始 migration
- 飞书 webhook 签名校验（如果 bot 不在内网）
- 自动化测试覆盖
