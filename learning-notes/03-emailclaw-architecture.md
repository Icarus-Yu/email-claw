# 03. EmailClaw 项目架构说明

## 1. 项目一句话介绍

EmailClaw 是一个基于 TypeScript / Node.js 的智能邮件管家系统。

它通过 IMAP 长连接监听用户邮箱，收到新邮件后解析 MIME 内容，先走用户自定义规则引擎，如果规则未命中，再交给本地 Agent 或 OpenClaw Agent 做分类、重要性评分和摘要生成。

分析结果会存入 PostgreSQL，并通过飞书机器人卡片推送给用户。用户可以直接在飞书卡片上完成已读、重点、归档、删除、反馈分类、查看详情、重新分析等操作，这些操作会同步更新数据库和真实邮箱状态。

## 2. 总体架构

```text
IMAP 邮箱
  -> UserMailbox
  -> EmailService
  -> RuleEngine
  -> AgentService
       -> ClassificationSkill
       -> OpenClawClient
  -> DatabaseService / Prisma / PostgreSQL
  -> FeishuService
  -> 飞书机器人卡片
  -> 用户点击卡片
  -> Feishu webhook
  -> 邮箱状态和数据库状态同步更新
```

代码层级：

```text
src/server.ts
  -> authRoutes / userRoutes / emailRoutes / ruleRoutes / feishuRoutes
  -> emailService
      -> imapManager
          -> UserMailbox
      -> ruleEngine
      -> agentService
          -> ClassificationSkill
          -> OpenClawClient
      -> databaseService
      -> feishuService
```

## 3. 入口文件

入口是：

```text
src/server.ts
```

因为 `package.json` 中：

```json
{
  "scripts": {
    "dev": "ts-node-dev --respawn --transpile-only src/server.ts"
  }
}
```

`src/server.ts` 主要做：

```text
1. dotenv.config() 加载环境变量
2. 创建 Express app
3. 注册 JSON 中间件
4. 注册 API 路由
5. 启动 HTTP 服务
6. 运行 bootstrap
7. 启动 emailService，开始监听邮箱
```

## 4. 路由层

路由目录：

```text
src/backend/api/routes/
```

主要路由：

```text
authRoutes.ts
  注册 / 登录

userRoutes.ts
  用户信息、偏好、飞书绑定、邮箱绑定

emailRoutes.ts
  邮件搜索、邮件详情

ruleRoutes.ts
  用户规则 CRUD

feishuRoutes.ts
  飞书 bot webhook
```

路由层职责：

```text
接收 HTTP 请求
校验必要参数
调用 service
返回 JSON 响应
```

## 5. 邮件监听层

### 5.1 ImapManager

文件：

```text
src/backend/services/imapManager.ts
```

职责：

```text
管理所有用户的 IMAP 连接
启动所有已绑定邮箱用户的监听
按 userId 找到对应 UserMailbox
按 emailId 路由到正确用户的邮箱连接
```

核心思想：

```text
一个用户一个 UserMailbox
ImapManager 用 Map<userId, UserMailbox> 保存连接
```

### 5.2 UserMailbox

文件：

```text
src/backend/services/userMailbox.ts
```

职责：

```text
连接 IMAP 服务器
打开 INBOX
监听新邮件
轮询未读邮件作为兜底
fetch 邮件原文
用 mailparser 解析 MIME
触发 onIncomingEmail 回调
提供已读、重点、归档、删除等真实邮箱操作
```

工程亮点：

```text
自动重连：
  IMAP 断开后 5 秒重连。

IDLE + 轮询兜底：
  有些邮箱 IMAP IDLE 不稳定，所以每 30 秒轮询未读邮件。

内存级去重：
  claimedUids 防止同一 UID 被并发重复处理。

IMAP flag 去重：
  CLAWED 标记表示邮件已被处理。
```

## 6. 邮件处理主流程

文件：

```text
src/backend/services/emailService.ts
```

`EmailService` 是业务编排层。

主流程：

```text
新邮件进入
  -> upsertEmail 入库
  -> 如果 saved.notifiedAt 存在，说明处理过，跳过
  -> ruleEngine.evaluate
  -> 命中规则：保存规则结果，执行副作用
  -> 未命中：agentService.analyzeEmail
  -> 根据用户偏好决定是否推送飞书
  -> markNotified 标记已处理
```

为什么 `EmailService` 是 facade？

```text
它对外暴露 markRead / archive / delete / reanalyze 等方法。
内部会根据 emailId 找到正确用户的邮箱连接。
调用者不需要知道 IMAP 连接怎么管理。
```

## 7. 规则引擎

文件：

```text
src/backend/services/ruleEngine.ts
```

规则结构：

```text
conditions:
  field: from | to | subject | body
  operator: contains | equals | startsWith | endsWith | regex
  value: string
  caseSensitive?: boolean

actions:
  category
  importance
  summary
  sideEffects: mark_read | archive | delete
```

执行逻辑：

```text
按 priority 降序取用户启用规则
多个 conditions 是 AND 关系
命中第一条规则就停止
命中规则后跳过 Agent
生成统一的 EmailAgentResult
```

设计价值：

```text
用户确定性规则优先
减少 AI 调用成本
提高可解释性
和 Agent 结果保持统一输出结构
```

## 8. Agent 分析层

### 8.1 类型协议

文件：

```text
src/agents/types/emailAgent.ts
```

核心类型：

```ts
export type EmailCategory =
  | 'work'
  | 'personal'
  | 'shopping'
  | 'marketing'
  | 'spam'
  | 'other';

export interface EmailAgentResult {
  classification: EmailClassificationResult;
  importance: EmailImportanceResult;
  summary: EmailSummaryResult;
}
```

意义：

```text
无论结果来自规则引擎、本地 Agent、OpenClaw Agent，
最终都必须返回统一的 EmailAgentResult。
```

### 8.2 本地规则 Agent

文件：

```text
src/agents/skills/classificationSkill.ts
```

能力：

```text
关键词分类
关键词重要性评分
正文摘要截取
```

优点：

```text
不依赖外部大模型
稳定
成本为零
可以作为 OpenClaw 失败时的兜底
```

局限：

```text
分类质量受关键词限制
不能真正理解复杂语义
```

### 8.3 AgentService

文件：

```text
src/backend/services/agentService.ts
```

职责：

```text
判断是否启用 OpenClaw
调用 OpenClaw 分析
失败时回退本地规则 Agent
保存分析结果和 AgentLog
```

核心设计：

```text
业务层只依赖 AgentService.analyzeEmail
不关心底层是本地规则还是 OpenClaw
```

这是一种解耦。

## 9. OpenClaw 接入

文件：

```text
src/backend/services/openClawClient.ts
```

调用方式：

```text
openclaw agent
  --agent email-claw
  --session-key <每封唯一>
  --message <邮件分析 prompt>
  --json
  --local
```

### 9.1 为什么用子进程

项目没有直接接大模型 SDK，而是通过 OpenClaw CLI。

好处：

```text
后端不关心具体模型 provider
OpenClaw 管理模型配置和 agent
EmailClaw 只负责传 prompt 和解析结果
```

### 9.2 可靠性处理

OpenClawClient 做了几个关键适配：

```text
1. 每封邮件独立 session key
   避免多个 local 子进程抢同一个 session 文件锁。

2. 解析 OpenClaw JSON 信封
   OpenClaw --json 返回的是 { payloads, meta }，
   真正的分析 JSON 在 payloads[0].text。

3. 剥除 markdown 代码围栏
   LLM 可能返回 ```json ... ```。

4. 正则兜底提取 JSON
   如果直接 JSON.parse 失败，尝试从文本中提取 {...}。

5. 字段归一化
   category 必须落在六个合法分类中。
   importance / confidence 必须裁剪到合法范围。

6. 失败重试一次
   两次失败后交给 AgentService 回退本地规则。
```

面试可说：

```text
我做 AI 接入时重点考虑可靠性。
因为 LLM 输出不稳定，所以做了结构化 prompt、JSON 解析容错、字段归一化、失败重试和本地规则回退。
```

## 10. 数据库层

文件：

```text
prisma/schema.prisma
src/backend/services/databaseService.ts
```

核心表：

```text
User
Email
Classification
Contact
Rule
AgentLog
```

关键设计：

```prisma
@@unique([userId, uid])
```

为什么不是单独 `uid` 唯一？

```text
IMAP UID 只在单个邮箱内有意义。
不同用户邮箱里可能有相同 UID。
所以要用 userId + uid 做联合唯一键。
```

`databaseService.ts` 负责：

```text
邮件 upsert
保存分析结果
保存 AgentLog
邮件搜索
规则 CRUD
用户查询
飞书回调状态更新
ownership 校验
```

## 11. 飞书交互闭环

文件：

```text
src/backend/integrations/feishu/feishuService.ts
src/backend/api/routes/feishuRoutes.ts
```

流程：

```text
后端分析邮件
  -> feishuService.pushEmailCard
  -> bot 发送飞书卡片
  -> 用户点击按钮
  -> bot 转发到 /api/feishu/webhook
  -> requireBotSecret 校验
  -> openId 查询 userId
  -> assertEmailOwnership
  -> 执行动作
  -> 更新数据库和真实邮箱
  -> 返回结果给 bot 刷新卡片
```

支持 action：

```text
mark_read
mark_important
archive
delete
feedback_correct
feedback_wrong
view_detail
reanalyze
```

## 12. 多用户隔离和安全

安全链路：

```text
HTTP 层：
  用户 API 使用 JWT。
  飞书 webhook 使用 X-Bot-Secret。

业务层：
  飞书 openId 必须绑定到 User.feishuUserId。

数据层：
  操作邮件前调用 assertEmailOwnership(emailId, userId)。
```

为什么需要 ownership 校验？

```text
不能只信任飞书回调里的 emailId。
如果攻击者构造别人的 emailId，就可能越权操作。
所以必须确认 emailId 属于当前 userId。
```

## 13. MCP 相关理解

当前代码中没有直接实现 MCP Server，也没有使用 MCP SDK。

面试时不要说：

```text
项目已经实现 MCP 协议。
```

更稳妥的说法：

```text
当前项目没有直接实现 MCP Server，而是通过 OpenClaw Agent 接入 AI 能力。
但项目已经把邮件搜索、邮件操作、规则管理、重新分析等能力封装成 service，
后续可以比较自然地包装成 MCP tools。
```

如果改造成 MCP Server，可以暴露：

```text
Tools:
  search_emails
  get_email_detail
  mark_email_read
  archive_email
  delete_email
  reanalyze_email
  list_rules
  create_rule

Resources:
  email detail
  user rules
  classification history
  agent logs

Prompts:
  email analysis prompt
```

## 14. 项目核心价值总结

EmailClaw 不只是一个“调用大模型分类邮件”的项目。

真正值得讲的是：

```text
1. IMAP 长连接和兜底轮询
2. 多用户邮箱连接管理
3. 数据库持久化去重
4. 用户规则优先，Agent 兜底
5. OpenClaw / LLM 输出的工程化容错
6. 飞书卡片交互闭环
7. 真实邮箱状态同步
8. 多用户安全隔离
```

