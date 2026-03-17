# 📧 EmailClaw (智能邮件管家)

基于大语言模型与 Agentic Workflow 构建的自动化个人邮件处理系统。
本项目旨在通过 IMAP 协议实时抓取邮件，利用 OpenClaw 智能体进行意图识别与核心信息提取，并通过飞书 (Feishu) 机器人卡片与用户进行交互式闭环处理。

## 🛠 技术栈与核心依赖

本项目采用前后端分离与模块化解耦架构：

- **开发语言:** TypeScript (运行于 Node.js)
- **网络服务:** Express.js (处理飞书 Webhook 与 API 路由)
- **AI 大脑引擎:** OpenClaw (作为核心 Agent 调度大模型)
- **数据库 ORM:** Prisma (底层数据库选型待定)
- **邮件通信:** `imap` & `mailparser` (底层协议解析)
- **环境变量:** `dotenv`

## 🚀 本地开发与初始化指南

请在克隆项目后，按照以下步骤在本地完成基础环境的配置。

### 1. 克隆代码仓库

``` bash
git clone [https://github.com/Icarus-Yu/email-claw.git](https://github.com/Icarus-Yu/email-claw.git)
cd email-claw
```
2. 安装基础环境依赖
我们目前将“网络服务依赖”与“本地 AI 引擎源码”分开安装，以保证环境的纯净。
请在终端中执行：

```Bash
# 安装 TypeScript 运行环境及 Express、Prisma 等基础框架
npm install -D typescript ts-node ts-node-dev @types/node @types/express
npm install express dotenv prisma @prisma/client

# 链接本地的 OpenClaw 引擎源码 (假设 openclaw 文件夹与本项目同级)
npm install ../openclaw
```
3. 配置环境变量
在项目根目录下创建一个 .env 文件（请勿将其提交到 Git），并填入以下基础配置：

```Code snippet
# --- 基础服务配置 ---
PORT=3000

# --- 飞书开放平台凭证 (待申请填入) ---
FEISHU_APP_ID=
FEISHU_APP_SECRET=

# --- 数据库连接 (待定) ---
# DATABASE_URL=
4. 启动开发服务器
````
执行以下命令启动热更新开发服务器：

```Bash
npm run dev
```
当控制台打印出 🚀 服务正在运行: http://localhost:3000 时，说明基础网络服务已成功启动。您可以访问 http://localhost:3000/ping 测试连通性。