# 02. 如何阅读和规划一个 TypeScript 项目

## 1. TypeScript 项目的本质

TypeScript 项目本质上还是 JavaScript 项目，只是开发时多了一层类型系统。

```text
写 .ts 文件
  ↓
TypeScript 编译器 tsc
  ↓
生成 .js 文件
  ↓
Node.js 或浏览器运行 JS
```

所以看 TS 项目时要同时关心：

```text
源码在哪里
入口在哪里
怎么运行
怎么编译
编译产物在哪里
项目如何分层
```

## 2. 拿到 TS 项目先看哪些文件

建议顺序：

```text
1. package.json
2. tsconfig.json
3. README.md
4. .env.example
5. src/server.ts 或 src/index.ts
6. src/ 下的目录结构
7. 数据库 schema，例如 prisma/schema.prisma
```

## 3. package.json 怎么看

`package.json` 是 Node.js 项目的说明书。

重点看：

```text
scripts
dependencies
devDependencies
main
name
version
```

EmailClaw 的关键 scripts：

```json
{
  "scripts": {
    "dev": "ts-node-dev --respawn --transpile-only src/server.ts",
    "build": "tsc"
  }
}
```

这说明：

```text
npm run dev
  开发环境直接运行 src/server.ts

npm run build
  调用 TypeScript 编译器 tsc，把 src 编译到 dist
```

所以开发入口是：

```text
src/server.ts
```

面试可说：

```text
我判断 TypeScript 项目入口时，首先看 package.json 的 scripts。
EmailClaw 的 dev 命令直接运行 src/server.ts，所以后端入口就是 src/server.ts。
```

## 4. dependencies 和 devDependencies

`dependencies` 是运行时依赖。

EmailClaw 里包括：

```text
express        HTTP 服务框架
prisma         ORM / 数据库工具
@prisma/client Prisma 客户端
pg             PostgreSQL 驱动
imap           IMAP 邮件连接
mailparser     邮件 MIME 解析
jsonwebtoken   JWT 登录
bcryptjs       密码哈希
dotenv         读取 .env
```

`devDependencies` 是开发期依赖：

```text
typescript      TypeScript 编译器
ts-node-dev     开发时直接运行 TS
@types/*        第三方库类型声明
```

通过依赖可以快速判断技术栈：

```text
EmailClaw 是 Express + Prisma + PostgreSQL + IMAP + TypeScript 的 Node 后端项目。
```

## 5. tsconfig.json 怎么看

EmailClaw 的配置：

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "moduleResolution": "node",
    "outDir": "./dist",
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "strict": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "**/*.test.ts"]
}
```

逐项理解：

```text
target: ES2022
  编译目标是现代 JavaScript，适合 Node 20+。

module: CommonJS
  编译后使用 Node 传统模块系统。

moduleResolution: node
  按 Node.js 的规则查找模块。

outDir: ./dist
  编译后的 JS 放到 dist。

strict: true
  开启严格类型检查。

include: ["src/**/*"]
  只编译 src 目录。

exclude
  不编译 node_modules、dist、测试文件。
```

总结：

```text
EmailClaw 的源码在 src，编译产物在 dist。
开发时跑 src/server.ts，构建时用 tsc 输出 JS。
```

## 6. 如何找入口

一个 TS 后端项目入口通常在：

```text
src/server.ts
src/index.ts
src/app.ts
```

找入口顺序：

```text
1. 看 package.json scripts.dev
2. 看 package.json scripts.start
3. 看 package.json main
4. 找 src/server.ts / src/index.ts / src/app.ts
```

EmailClaw：

```json
"dev": "ts-node-dev --respawn --transpile-only src/server.ts"
```

所以入口是：

```text
src/server.ts
```

读入口时问四个问题：

```text
1. 它加载了哪些配置？
2. 它创建了什么服务？
3. 它注册了哪些路由？
4. 它启动了哪些后台任务？
```

EmailClaw 的答案：

```text
1. dotenv 加载 .env
2. express 创建 HTTP 服务
3. 注册 auth/users/emails/rules/feishu 路由
4. 启动 bootstrap 和 emailService
```

## 7. 常见 TS 后端目录规划

一个清晰的 TS 后端可以这样规划：

```text
my-project/
  package.json
  tsconfig.json
  .env.example
  README.md

  src/
    server.ts
    app.ts

    config/
      env.ts

    api/
      routes/
      middleware/

    services/

    integrations/

    data/
      repositories/

    types/

    utils/

  tests/
```

职责：

```text
server.ts
  启动服务，监听端口。

app.ts
  创建 Express app，注册中间件和路由。

api/routes
  接 HTTP 请求。

api/middleware
  鉴权、日志、错误处理。

services
  业务逻辑。

integrations
  第三方平台和外部系统。

data/repositories
  数据库访问。

types
  共享类型。

utils
  纯工具函数。
```

## 8. EmailClaw 的实际目录结构

EmailClaw 的核心结构：

```text
src/
  server.ts

  backend/
    api/
      routes/
        authRoutes.ts
        userRoutes.ts
        emailRoutes.ts
        ruleRoutes.ts
        feishuRoutes.ts

    middleware/
      authMiddleware.ts

    services/
      emailService.ts
      imapManager.ts
      userMailbox.ts
      ruleEngine.ts
      databaseService.ts
      agentService.ts
      openClawClient.ts
      bootstrap.ts

    integrations/
      feishu/
        feishuService.ts

    utils/
      auth.ts
      crypto.ts

  agents/
    types/
      emailAgent.ts
    skills/
      classificationSkill.ts
    tools/
      emailTextTools.ts
```

可以理解成：

```text
server.ts
  入口层

api/routes
  HTTP 路由层

middleware
  请求中间件层

services
  业务服务层

integrations
  第三方集成层

utils
  工具函数层

agents
  AI / Agent 相关能力层
```

## 9. 读项目不要一口气读所有文件

推荐沿着一条业务流程读。

例如 EmailClaw 的主流程：

```text
新邮件进入
  -> UserMailbox
  -> EmailService.processIncomingEmail
  -> databaseService.upsertEmail
  -> ruleEngine.evaluate
  -> agentService.analyzeEmail
  -> feishuService.pushEmailCard
```

或者飞书按钮流程：

```text
用户点击飞书卡片
  -> bot 转发请求
  -> feishuRoutes
  -> requireBotSecret
  -> openId 查询 userId
  -> feishuService.handleCallback
  -> databaseService.assertEmailOwnership
  -> emailService 操作 IMAP
  -> databaseService 更新状态
```

通过业务流程读代码，比按文件名逐个读更容易理解项目。

## 10. TypeScript 项目里的类型应该怎么看

类型定义通常是项目最稳定的协议。

EmailClaw 的 Agent 类型：

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

这说明：

```text
所有邮件分析结果都必须包含：
  classification
  importance
  summary
```

这就是模块之间的契约。

## 11. 从零规划一个 TS 项目的步骤

### 11.1 初始化

```bash
mkdir my-api
cd my-api
npm init -y
npm install express dotenv
npm install -D typescript ts-node-dev @types/node @types/express
npx tsc --init
```

### 11.2 最小入口

`src/server.ts`：

```ts
import dotenv from 'dotenv';
dotenv.config();

import express from 'express';

const app = express();
app.use(express.json());

app.get('/ping', (_req, res) => {
  res.json({ message: 'pong' });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
```

### 11.3 package.json scripts

```json
{
  "scripts": {
    "dev": "ts-node-dev --respawn --transpile-only src/server.ts",
    "build": "tsc"
  }
}
```

### 11.4 后续拆分

从一个文件逐步拆成：

```text
src/
  server.ts
  api/routes/
  services/
  integrations/
  utils/
  types/
```

## 12. 一个 TS 项目的阅读口诀

```text
package.json 看怎么启动
tsconfig.json 看怎么编译
src/server.ts 看入口
routes 看对外 API
services 看业务逻辑
types 看数据契约
prisma/schema.prisma 看数据库模型
integrations 看外部系统
```

