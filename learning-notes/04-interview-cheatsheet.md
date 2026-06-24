# 04. EmailClaw 面试速记

## 1. 一分钟项目介绍

EmailClaw 是一个 TypeScript 写的智能邮件管家系统。

它通过 IMAP 给每个用户建立独立长连接，监听新邮件并用 mailparser 解析 MIME 内容。邮件入库后先经过用户规则引擎，如果规则命中就直接生成分类、重要性和摘要；如果没命中，就交给 AgentService 分析。

AgentService 支持两种模式：默认是本地关键词规则 Agent，开启 OpenClaw 后会通过 CLI 拉起 OpenClaw Agent 调大模型。为了保证稳定性，项目做了 JSON 输出约束、OpenClaw 信封解析、markdown 围栏剥离、字段归一化、失败重试和本地规则回退。

分析结果会保存到 PostgreSQL，并通过飞书机器人卡片推送给用户。用户可以在飞书里点按钮完成已读、重点、归档、删除、分类反馈和重新分析，这些操作会同时更新真实邮箱和数据库。

安全上，系统通过 JWT、bot 共享密钥、openId 到 userId 映射、email ownership 校验来保证多用户隔离。

## 2. 项目入口怎么讲

```text
我先看 package.json 的 scripts。
EmailClaw 的 dev 命令是 ts-node-dev 运行 src/server.ts，
所以 src/server.ts 是后端入口。
```

`src/server.ts` 做：

```text
加载 .env
创建 Express app
注册 JSON 中间件
注册 auth/users/emails/rules/feishu 路由
启动 HTTP 服务
执行 bootstrap
启动 emailService，开始监听 IMAP
```

## 3. TypeScript 怎么讲

```text
这个项目使用 TypeScript 的主要价值是建立模块之间的数据契约。
比如 EmailCategory 用联合类型限制分类只能是 work/personal/shopping/marketing/spam/other。
EmailAgentResult 统一约束 Agent 输出必须包含 classification、importance、summary。
这样无论结果来自规则引擎、本地 Agent 还是 OpenClaw Agent，后续入库和飞书展示都可以统一处理。
```

加分点：

```text
TypeScript 是编译期类型系统，不能替代运行时校验。
所以对 OpenClaw / LLM 这种外部输出，项目仍然做了 parseJson、normalizeCategory、clampNumber 等运行时防御。
```

## 4. 主业务链路

```text
新邮件进入
  -> UserMailbox 通过 IMAP fetch 邮件
  -> mailparser 解析 MIME
  -> EmailService.processIncomingEmail
  -> databaseService.upsertEmail
  -> ruleEngine.evaluate
  -> 命中规则则跳过 Agent
  -> 未命中则 agentService.analyzeEmail
  -> 保存分类、重要性、摘要和 AgentLog
  -> 按用户偏好推送飞书卡片
  -> markNotified 标记已处理
```

## 5. 为什么规则引擎放在 Agent 前

回答：

```text
规则是用户明确配置的确定性意图，优先级应该高于 AI 判断。
规则命中后跳过 Agent，可以降低延迟和 AI 调用成本。
同时规则引擎输出的也是统一的 EmailAgentResult，所以后续入库和推送逻辑不需要区分来源。
```

## 6. OpenClaw / AI Harness 怎么讲

```text
我没有把大模型调用散落在业务代码里，而是封装成 AgentService 和 OpenClawClient。
业务层只依赖 analyzeEmail 返回统一的 EmailAgentResult。
底层到底是 OpenClaw 调大模型，还是本地规则兜底，对上层透明。
```

可靠性设计：

```text
结构化 prompt
OpenClaw JSON 信封解析
剥除 markdown 代码围栏
非法 JSON 正则兜底
每封邮件独立 session key
失败重试一次
字段归一化和范围裁剪
失败后回退本地规则 Agent
```

## 7. 为什么每封邮件要独立 session key

回答：

```text
OpenClaw local 模式下多个子进程如果共用默认 session，可能抢同一个 session 文件锁。
后端可能并发处理多封邮件，所以每封邮件生成唯一 session key，让不同分析任务互相隔离。
```

## 8. 怎么防重复处理邮件

回答：

```text
有三层去重：

1. 内存层 claimedUids
   防止同一轮扫描里 UID 被并发重复处理。

2. IMAP 自定义 flag CLAWED
   标记服务器侧邮件已经处理过。

3. 数据库 notifiedAt
   用于跨重启持久化去重。
   因为有些邮箱不会稳定保存自定义 IMAP flag，所以最终以数据库状态兜底。
```

## 9. 怎么保证多用户隔离

回答：

```text
所有核心数据表都有 userId。
Email 表用 userId + uid 做联合唯一约束，因为 IMAP UID 只在单个邮箱内唯一。
所有邮件搜索、规则 CRUD、状态更新都带 userId 条件。
飞书回调还会先用 openId 映射到 userId，再调用 assertEmailOwnership 校验 emailId 是否属于该用户。
```

## 10. 飞书交互闭环怎么讲

```text
系统不是只发通知，而是支持交互闭环。

后端分析完邮件后推送飞书卡片。
用户点击卡片按钮后，bot 把 action、emailId、openId 转发给后端。
后端校验 X-Bot-Secret、openId 绑定和 email ownership。
然后执行对应 IMAP 操作，并更新数据库。
最后 bot 刷新卡片状态。
```

支持：

```text
标为已读
标为重点
归档
删除
分类正确
分类错误
查看详情
重新分析
```

## 11. MCP 怎么诚实回答

不要说：

```text
项目已经实现 MCP。
```

应该说：

```text
当前项目没有直接实现 MCP Server，也没有使用 MCP SDK。
目前是通过 OpenClaw Agent 接入 AI 能力。
不过项目的 service 抽象比较清楚，后续可以把邮件搜索、邮件详情、标已读、归档、删除、重新分析、规则管理这些能力包装成 MCP tools，让外部 Agent 通过标准 MCP 协议调用 EmailClaw。
```

可扩展 MCP tools：

```text
search_emails
get_email_detail
mark_email_read
archive_email
delete_email
reanalyze_email
list_rules
create_rule
```

## 12. 常见追问短答

### Q1：TypeScript 类型有什么用？

```text
用于建立模块之间的数据契约，减少字段错误和非法状态。
例如 EmailCategory 限制分类枚举，EmailAgentResult 统一 Agent 输出结构。
```

### Q2：TS 类型能保证外部数据一定安全吗？

```text
不能。TS 类型编译后会消失。
HTTP 请求、数据库、LLM 返回都需要运行时校验。
```

### Q3：为什么用 Prisma？

```text
Prisma 提供类型安全的数据库访问和清晰的数据模型。
schema.prisma 能直接表达 User、Email、Classification、Rule 等实体关系。
```

### Q4：为什么 OpenClaw 失败不能影响主流程？

```text
邮件接收和通知是主流程，AI 增强只是提升分类质量。
如果 AI 失败就丢邮件，系统可靠性会很差。
所以失败时回退本地规则，保证邮件仍然能处理和推送。
```

### Q5：删除邮件怎么实现？

```text
通过 IMAP 给邮件加 \Deleted flag，然后 expunge。
数据库里同步标记 isDeleted=true、isArchived=true。
```

### Q6：这个项目最大的技术亮点是什么？

```text
不是简单调用大模型，而是把邮件监听、规则引擎、Agent 分析、飞书交互、真实邮箱操作和多用户安全隔离做成了完整闭环。
AI 接入也做了容错、重试和本地兜底。
```

## 13. 可直接背诵的总结

```text
EmailClaw 是一个 TypeScript + Node.js 的智能邮件管理系统。
它通过 IMAP 实时监听多用户邮箱，用 mailparser 解析邮件，
先走用户规则引擎，再走 AgentService 做分类、重要性评分和摘要。
AgentService 支持本地规则 Agent 和 OpenClaw Agent，大模型失败时自动回退本地规则。
结果通过 Prisma 存入 PostgreSQL，并通过飞书卡片推送给用户。
用户在飞书上的操作会通过 webhook 回到后端，同步更新真实邮箱和数据库。
系统在多用户场景下通过 JWT、X-Bot-Secret、openId 绑定和 email ownership 校验保证安全隔离。
```

