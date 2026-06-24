# 01. JavaScript / TypeScript 知识体系图谱

## 1. 先建立总认识

JavaScript、TypeScript、Node.js 三者的关系可以这样理解：

```text
JavaScript 语言本身
  ↓
运行环境：浏览器 / Node.js
  ↓
TypeScript：给 JavaScript 增加类型和工程化约束
```

也就是说：

```text
JS 是真正运行的语言
TS 是开发时写的语言
TS 最终会编译成 JS 再运行
```

EmailClaw 是一个：

```text
Node.js + TypeScript 后端项目
```

它不是浏览器前端项目，而是运行在 Node.js 上的服务端程序。

## 2. JavaScript 是什么

JavaScript 最早是浏览器脚本语言，用来操作网页。

后来 Node.js 出现后，JavaScript 也可以写后端服务、命令行工具、自动化脚本。

现在 JS 主要有两个运行环境：

```text
浏览器 JavaScript
  用于网页交互、DOM 操作、前端请求

Node.js JavaScript
  用于后端 API、文件处理、数据库连接、脚本工具
```

区别要记住：

```text
JS 语言本身提供：
  变量、函数、对象、数组、Promise、class 等

运行环境提供：
  浏览器：document、window、localStorage、DOM
  Node.js：fs、http、crypto、process、Buffer
```

例如：

```js
const name = 'EmailClaw';
```

这是 JS 语言本身。

```js
const fs = require('fs');
```

这是 Node.js 提供的文件系统能力。

```js
document.querySelector('#app');
```

这是浏览器提供的 DOM 能力，Node.js 后端里不能用。

## 3. JavaScript 核心知识地图

初学者可以先把 JS 拆成这些知识块：

```text
1. 值和类型
2. 变量
3. 函数
4. 对象
5. 数组
6. 控制流程
7. 模块
8. 异步
9. class
10. 事件循环
```

### 3.1 值和类型

JS 常见基础类型：

```text
string      字符串
number      数字
boolean     布尔值
null        空值
undefined   未定义
symbol      唯一标识
bigint      大整数
object      对象
```

例子：

```js
const subject = '项目会议';
const importance = 8;
const isRead = false;
const html = null;
let summary;
```

对应关系：

```text
subject 是 string
importance 是 number
isRead 是 boolean
html 是 null
summary 是 undefined
```

JS 是动态类型语言：

```js
let x = 1;
x = 'hello';
```

这在 JS 中可以运行。

但在 TypeScript 中，如果 `x` 被推断为 number，再赋值 string 通常会报错。

### 3.2 变量：const / let / var

现代 JS 主要使用：

```text
const
let
```

少用 `var`。

```js
const appName = 'EmailClaw';
let count = 0;

count = count + 1;
```

区别：

```text
const：变量不能重新赋值
let：变量可以重新赋值
var：老语法，有函数作用域和变量提升问题，现代项目少用
```

注意：

```js
const user = { name: 'Tom' };
user.name = 'Jerry';
```

这可以。因为 `const` 限制的是变量不能指向另一个对象，不是对象内部属性不能变。

### 3.3 函数

普通函数：

```js
function add(a, b) {
  return a + b;
}
```

箭头函数：

```js
const add = (a, b) => {
  return a + b;
};
```

简写：

```js
const add = (a, b) => a + b;
```

后端项目里大量使用回调函数。

例如 Express 路由：

```ts
app.get('/ping', (_req, res) => {
  res.json({ message: 'pong' });
});
```

意思是：

```text
当有人访问 GET /ping 时，执行这个函数。
```

### 3.4 对象

对象是 JS 中最核心的数据结构：

```js
const email = {
  subject: '会议通知',
  from: 'boss@example.com',
  importance: 8,
  isRead: false
};
```

读取：

```js
email.subject;
email['subject'];
```

修改：

```js
email.isRead = true;
```

EmailClaw 里邮件、用户、Agent 结果、飞书卡片数据，本质上都是对象。

### 3.5 数组

数组是一组值：

```js
const categories = ['work', 'personal', 'shopping'];
```

常见方法：

```js
categories.includes('work');
categories.map((item) => item.toUpperCase());
categories.filter((item) => item !== 'spam');
categories.find((item) => item === 'work');
```

EmailClaw 里常见例子：

```ts
const allowed = ['work', 'personal', 'shopping', 'marketing', 'spam', 'other'];
```

可以用于校验分类是否合法：

```ts
allowed.includes(category);
```

### 3.6 控制流程

常见控制流程：

```text
if / else
for
for...of
switch
try / catch
```

例子：

```js
if (importance >= 7) {
  console.log('重要邮件');
} else {
  console.log('普通邮件');
}
```

`switch` 常用于 action 分发：

```js
switch (action) {
  case 'mark_read':
    break;
  case 'delete':
    break;
  default:
    break;
}
```

EmailClaw 的飞书回调就是根据不同 action 执行不同邮件操作。

## 4. 模块系统

项目不可能只写一个文件，所以 JS / TS 需要模块系统。

导出：

```ts
export class AgentService {}
```

导入：

```ts
import { AgentService } from './agentService';
```

默认导出：

```ts
export default router;
```

默认导入：

```ts
import authRoutes from './backend/api/routes/authRoutes';
```

读项目时，看到 `import` 就顺着它找依赖。

例如 EmailClaw 的入口：

```ts
import { emailService } from './backend/services/emailService';
```

说明启动时依赖邮件服务。

## 5. 异步：后端 JS 最重要的一关

后端里大量操作都是异步：

```text
读数据库
请求外部 API
连接 IMAP
发送飞书消息
读取文件
调用 OpenClaw 子进程
```

JS 使用 Promise 和 async/await 处理异步。

```ts
async function getUser(userId: string) {
  const user = await databaseService.getUserById(userId);
  return user;
}
```

`await` 的意思是：

```text
等这个异步操作完成，再继续往下执行。
```

错误处理：

```ts
try {
  const result = await openClawClient.analyzeEmail(email);
  return result;
} catch (error) {
  console.warn('分析失败，回退本地规则');
}
```

EmailClaw 中 AI 调用、数据库操作、IMAP 连接、飞书请求都依赖 `async/await`。

## 6. 事件循环

JS 主线程一次只能执行一段 JS 代码，但 Node.js 可以同时处理很多网络连接。

可以这样理解：

```text
JS 主线程
  执行你的代码

Node.js 运行时
  处理网络、文件、定时器、子进程等等待型任务

事件循环
  把完成后的回调重新放回 JS 主线程执行
```

例子：

```js
setTimeout(() => {
  console.log('later');
}, 1000);

console.log('now');
```

输出：

```text
now
later
```

EmailClaw 为什么启动后不会退出？

因为事件循环里有：

```text
Express HTTP 服务监听端口
IMAP 长连接
定时轮询任务
```

## 7. class 和服务对象

JS / TS 支持 class：

```ts
class AgentService {
  async analyzeEmail() {
    // ...
  }
}
```

创建实例：

```ts
const agentService = new AgentService();
```

EmailClaw 常见模式：

```ts
export class AgentService {
  async analyzeEmail() {}
}

export const agentService = new AgentService();
```

意思是：

```text
定义一个服务类
创建一个单例对象
导出给其他模块复用
```

适合服务类保存状态。

例如 `ImapManager` 内部保存所有用户的邮箱连接：

```ts
private mailboxes = new Map<string, UserMailbox>();
```

## 8. TypeScript 是什么

TypeScript = JavaScript + 类型系统。

TS 写法：

```ts
const name: string = 'EmailClaw';
const importance: number = 8;
const isRead: boolean = false;
```

编译成 JS 后类型会消失：

```js
const name = 'EmailClaw';
const importance = 8;
const isRead = false;
```

TypeScript 的价值：

```text
提前发现错误
约束数据结构
提升 IDE 自动提示
帮助大型项目维护
让模块之间的契约更清晰
```

## 9. TypeScript 核心知识地图

先掌握：

```text
1. 基础类型
2. 数组类型
3. 对象类型
4. interface
5. type
6. 联合类型
7. 可选属性
8. 泛型
9. 类型导入导出
10. 类型收窄
```

### 9.1 基础类型

```ts
const subject: string = '会议通知';
const score: number = 8;
const isRead: boolean = false;
```

数组：

```ts
const scores: number[] = [1, 2, 3];
const categories: string[] = ['work', 'spam'];
```

### 9.2 interface

`interface` 用来描述对象结构。

```ts
interface Email {
  subject: string;
  from: string;
  importance: number;
  html?: string;
}
```

使用：

```ts
const email: Email = {
  subject: '会议',
  from: 'boss@example.com',
  importance: 8
};
```

`html?: string` 表示可选字段。

EmailClaw 里的简化邮件类型类似：

```ts
export interface SimpleEmail {
  uid: number;
  messageId: string;
  subject: string;
  from: string;
  to: string;
  date: Date;
  text: string;
  html?: string;
  attachments: Array<{ filename?: string; contentType: string; size: number }>;
}
```

### 9.3 type 和联合类型

`type` 可以定义类型别名。

EmailClaw 里：

```ts
export type EmailCategory =
  | 'work'
  | 'personal'
  | 'shopping'
  | 'marketing'
  | 'spam'
  | 'other';
```

这表示分类只能是这六种。

```ts
const c1: EmailCategory = 'work';   // 正确
const c2: EmailCategory = 'school'; // 错误
```

### 9.4 类型契约

大型项目里，类型就是模块之间的协议。

例如：

```ts
export interface EmailAgentResult {
  classification: EmailClassificationResult;
  importance: EmailImportanceResult;
  summary: EmailSummaryResult;
}
```

表示无论底层是本地规则 Agent、OpenClaw Agent，还是未来 MCP Agent，都必须返回这三个部分。

这样业务层就能统一处理。

## 10. TypeScript 类型在运行时不存在

这是非常重要的点。

```ts
interface User {
  id: string;
  email: string;
}
```

编译成 JS 后，`interface` 会消失。

所以：

```text
TypeScript 不能自动保证外部数据真的符合类型。
```

对这些外部输入必须运行时校验：

```text
HTTP 请求 body
数据库返回数据
第三方 API 返回
LLM / Agent 输出
环境变量
```

EmailClaw 的 OpenClaw 返回就做了运行时处理：

```text
parseJson
normalizeCategory
clampNumber
```

面试可说：

```text
TypeScript 是编译期类型系统，不能替代运行时校验。
对外部输入，仍然需要 validate 和 normalize。
```

## 11. JS / TS / Node.js 总图

```text
语言基础
  JavaScript
    变量
    函数
    对象
    数组
    模块
    异步
    class
    事件循环

类型系统
  TypeScript
    基础类型
    interface
    type
    联合类型
    泛型
    类型收窄
    类型导入导出
    编译配置

运行环境
  Node.js
    V8
    fs / http / crypto / process
    npm
    package.json
    node_modules

后端框架
  Express
    app
    middleware
    routes
    request / response

数据层
  Prisma
    schema.prisma
    model
    migration
    client

项目工程化
  tsconfig.json
  src/
  dist/
  .env
  scripts
  build / dev
```

