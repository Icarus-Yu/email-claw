# EmailClaw 接入 OpenClaw + DeepSeek 配置文档（Linux）

> 本文面向 **Linux 部署机**（含 WSL2），讲清楚从「下载安装 OpenClaw」到「接入 EmailClaw 后端」的完整流程，
> 并给出 **配置 DeepSeek API Key 的两种方法**（交互式 / 非交互式）。
>
> 项目本身在 Linux 上开发，本文是 Linux 原生写法；
> Windows 版见 `OpenClaw接入文档（Windows）.md`，主要差异在「`OPENCLAW_COMMAND` 是否带 `.cmd`」、配置目录路径、shell 转义等几处，本文都会顺手指出。

---

## 0. 它是怎么工作的（先建立心智模型）

EmailClaw 后端每收到一封新邮件，会**临时拉起一个 OpenClaw 子进程**去调大模型分析（分类 / 重要性 / 摘要），命令形如：

```bash
openclaw agent --agent email-claw --session-key <每封唯一> --message <邮件内容> --json --local
```

- `--local`：把 agent 跑在**本机内嵌**模式，**不需要常驻 Gateway 服务**。子进程跑完一封邮件就退出，不占端口、不留后台进程。
- OpenClaw 内部用你配置的 **DeepSeek** Key 去调模型，把结果以 JSON 返回。
- 失败时后端会**自动回退**到内置的本地关键词规则，不会因此收不到邮件。

> 一句话：OpenClaw 在这里只是「后端 → DeepSeek」之间的一次性翻译器，按需启动、用完即走。

---

## 1. 前置条件

| 项 | 要求 |
|---|---|
| 操作系统 | 任意主流 Linux 发行版（Ubuntu / Debian / Arch / CentOS 等），或 WSL2 |
| Node.js | 20+（含 npm）。`node -v` / `npm -v` 能正常输出 |
| EmailClaw 后端 | 已能在本地跑通「本地规则版」（即不接 OpenClaw 也能收邮件、出分类） |
| PostgreSQL | 已运行，后端 `.env` 的 `DATABASE_URL` 可连通 |
| DeepSeek 账号 | 在 https://platform.deepseek.com 注册、充值（1~5 元即可测很久）、生成 API Key |
| 网络 | 部署机能访问 `https://api.deepseek.com`（国内直连无需代理） |

---

## 2. 下载安装 OpenClaw

打开终端，全局安装：

```bash
npm install -g openclaw
```

如果遇到权限错（`EACCES: permission denied`），有两种解法：

```bash
# 方法 A（推荐）：用 nvm 管理 Node，全局包装在用户目录，不用 sudo
# 用 nvm 装 Node 后，npm -g 默认就装到 ~/.nvm/versions/node/v.../lib/node_modules，无权限问题

# 方法 B：把 npm 全局前缀改到用户目录
mkdir -p ~/.npm-global
npm config set prefix ~/.npm-global
# 然后把 ~/.npm-global/bin 加到 PATH（写进 ~/.bashrc 或 ~/.zshrc）
echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.bashrc
source ~/.bashrc
npm install -g openclaw

# 方法 C（不推荐）：直接 sudo npm install -g openclaw
```

验证：

```bash
openclaw --version
```

能打印出 `OpenClaw 2026.x.x` 即安装成功。

> **Linux 关键点①｜全局包在哪：**
> 全局安装后会在 PATH 里出现 `openclaw` 可执行文件。查看实际路径：
>
> ```bash
> which openclaw
> # 例如：/home/<你的用户名>/.nvm/versions/node/v22.22.1/bin/openclaw
> # 或：/usr/local/bin/openclaw
> # 或：/home/<你的用户名>/.npm-global/bin/openclaw
> ```
>
> Linux 上**直接叫 `openclaw`**（无后缀），第 6 步接入后端时也只填 `openclaw`，
> **不要带 `.cmd`**（那是 Windows 才有的）。

---

## 3. 配置 DeepSeek API Key（两种方法，任选其一）

OpenClaw 的配置文件位于：

```
~/.openclaw/openclaw.json
```

> 想确认确切路径：`openclaw config file`

DeepSeek 是 OpenClaw **内置 provider**（id 就叫 `deepseek`，官方端点 `https://api.deepseek.com`），
所以**不用手填 baseUrl**，只需要把 Key 配进去、再把默认模型选成 `deepseek/deepseek-chat`。

---

### 方法一：交互式（向导，适合第一次、不熟命令的人）

```bash
openclaw configure
```

按向导提示操作：

1. 选择配置 **模型 / Provider 凭据**（credentials / model provider）。
2. 在 provider 列表里选 **deepseek**。
3. 粘贴你的 **DeepSeek API Key**（`sk-xxxxxxxx`）。
4. 把**默认 agent 模型**设为 `deepseek/deepseek-chat`。
5. 保存退出。

> 优点：有提示、不易填错。
> 缺点：每台机器都得手点一遍，不能脚本化。如果向导里没直接出现 deepseek，用下面的方法二。

---

### 方法二：非交互式（命令行，推荐，可脚本化、可重复）

直接两条命令搞定（把 `sk-你的key` 换成真实 Key）：

```bash
# 1) 写入 DeepSeek API Key
openclaw config set models.providers.deepseek.apiKey "sk-你的key"

# 2) 把默认 agent 模型设为 deepseek-chat（最便宜的非推理模型）
openclaw config set agents.defaults.model "deepseek/deepseek-chat"
```

校验配置合法 + 确认 provider 已就绪：

```bash
openclaw config validate
openclaw infer model providers | grep deepseek
```

看到 deepseek 那行里 `"configured":true,"selected":true` 就对了。

> **安全增强（可选）：Key 不落到配置文件**
> 如果不想把明文 Key 写进 `openclaw.json`，可以改用「环境变量引用」：
>
> ```bash
> # 1. 先把 API Key 写进 shell 启动文件（永久）
> echo 'export DEEPSEEK_API_KEY="sk-你的key"' >> ~/.bashrc   # 或 ~/.zshrc
> source ~/.bashrc
>
> # 2. 让 OpenClaw 引用环境变量而非明文
> openclaw config set models.providers.deepseek.apiKey \
>   --ref-source env --ref-id DEEPSEEK_API_KEY
> ```
>
> 这样配置文件里只存「环境变量名」，真实 Key 留在 shell 环境里。
>
> ⚠️ **注意**：如果后端是 systemd 启动的，环境变量必须写进 systemd unit file 的 `Environment=` 或 `EnvironmentFile=`，
> 否则 OpenClaw 子进程看不到该变量。

---

## 4. 创建 email-claw agent

后端固定用 `--agent email-claw`，所以要建一个同名 agent：

```bash
# 建工作目录
mkdir -p ~/.openclaw/workspaces/email-claw

# 创建 agent（非交互）
openclaw agents add email-claw \
  --model deepseek/deepseek-chat \
  --non-interactive \
  --workspace ~/.openclaw/workspaces/email-claw

# 确认
openclaw agents list
```

列表里出现 `email-claw`、`Model: deepseek/deepseek-chat` 即成功。

---

## 5. 先单独验证 OpenClaw 自己能通（强烈建议，别跳过）

**别急着接后端**，先确认 Key、模型、agent 三者本身能跑通。

### 5.1 验证 Key 连通

```bash
openclaw infer model run --model deepseek/deepseek-chat --prompt "reply with a single word: pong"
```

输出里看到 `pong`，说明 Key 有效、能调通 DeepSeek。

### 5.2 验证 agent 能产出分析 JSON

```bash
openclaw agent --agent email-claw --session-key test-1 --json --local \
  --message '只返回JSON:{"category":"work","confidence":0.8,"classificationReasoning":"x","importance":7,"importanceReasoning":"y","summary":"z"} 分析这封: Subject: 项目排期会议 明天下午开会 deadline 临近'
```

> bash/zsh 里**用单引号包裹**整个 message 即可，JSON 里的双引号不用转义。
> 如果消息里包含单引号，改用双引号包裹并对内部双引号做 `\"` 转义。

你会看到一个**信封结构**的 JSON：

```json
{ "payloads": [ { "text": "{\"category\":\"work\", ... }" } ], "meta": { ... } }
```

> ⚠️ **重点理解这个结构**：真正的分析 JSON **不在最外层**，而是套在 `payloads[0].text` 字符串里。
> 这正是下一步后端代码要适配的地方（见第 7 节）。

---

## 6. 接入 EmailClaw 后端（改 `.env`）

编辑后端根目录的 `.env`，加上 / 改成：

```env
OPENCLAW_ENABLED=true
OPENCLAW_COMMAND=openclaw
OPENCLAW_AGENT_ID=email-claw
OPENCLAW_TIMEOUT_MS=60000
```

> **Linux 关键点②｜与 Windows 的最大差异：**
> Linux 上 `OPENCLAW_COMMAND` **直接写 `openclaw`** 即可，不需要 `.cmd` 后缀。
> Windows 必须写 `openclaw.cmd`，这是两版文档之间最容易踩混的点。
>
> 如果写 `openclaw` 后端日志报 `ENOENT`（找不到命令），说明你的 PATH 里没有 openclaw。
> 两种解法：
>
> 1. 用绝对路径：
>    ```env
>    OPENCLAW_COMMAND=/home/你的用户名/.nvm/versions/node/v22.22.1/bin/openclaw
>    ```
>    （用 `which openclaw` 查到的真实路径替换）
>
> 2. 让后端继承登录 shell 的 PATH：
>    - 如果是 `npm run dev` 在终端启动，先 `source ~/.bashrc` 再启动
>    - 如果是 systemd / pm2 启动，要在 unit / 配置里显式加 `Environment=PATH=...` 包含 openclaw 所在目录
>
> nvm 装的 Node 在非 login shell 里 PATH 不一定包含 `~/.nvm/...`，这是 nvm 用户最常踩的坑。

---

## 7. 后端已做的代码适配（说明，便于排障）

OpenClaw 的真实返回结构和大模型的不稳定性，决定了**直接调是跑不通的**。
项目里 `src/backend/services/openClawClient.ts` 已经做了三处关键适配，了解它们有助于排障：

| # | 适配 | 解决什么问题 |
|---|---|---|
| 1 | **拆信封解析**：从 `payloads[0].text` 取真正的分析 JSON | OpenClaw `--json` 返回的是 `{payloads,meta}` 信封，不是裸的 `{category,...}`。不拆开会**静默拿到默认值**（每封都变 `other / 重要性3`） |
| 2 | **每封邮件独立 `--session-key`** | 后端并发处理多封邮件时，多个 `--local` 子进程会抢同一个会话文件锁，报 `EmbeddedAttemptSessionTakeoverError`，导致**并发时全部回退** |
| 3 | **失败重试一次 + 剥除 ```` ```json ```` 围栏 + 强化提示** | DeepSeek 偶发会无视指令，把 JSON 包进 markdown 围栏、或输出非法 JSON。重试 + 容错解析把成功率拉到接近 100% |

> 这三处是「能跑通」与「看起来配好了其实全是垃圾分类」的分水岭，已经在代码里处理好，**无需手动改**。
> 排障时如果在日志看到 `TakeoverError` 或 `OpenClaw 分析失败`，对照上表定位。

---

## 8. 启动并端到端验证

启动后端（在项目根目录）：

```bash
npm run dev
```

往绑定的邮箱发一封测试邮件，观察终端日志，应出现类似：

```
🤖 [user=...] 处理新邮件: <主题>
🧠 [user=...] [agent] 分类=work, 重要性=7/10
```

**判定标准**：

- 分类**不是**清一色 `other`、重要性不是清一色 `3` → DeepSeek 增强**已生效**。
- 日志里**没有** `TakeoverError`、**没有** `OpenClaw 分析失败` → 链路健康。
- 故意把 `OPENCLAW_ENABLED` 改成 `false` 重启，应回退本地规则且仍能正常收邮件 → 回退链路正常。

> 飞书相关的 `推送飞书卡片失败`（连不上 3001）在只测分析时是**预期的**，不影响分析与入库。

---

## 9. 邮件操作会真同步到邮箱吗？

会。飞书端点「已读 / 重点 / 归档 / 删除」走的都是 **IMAP 标准命令**，作用在真实邮箱服务器上：

| 操作 | IMAP 命令 | 你的邮箱客户端表现 |
|---|---|---|
| 标已读 | `+FLAGS \Seen` | 变已读 |
| 标重点 | `+FLAGS \Flagged` | 出现星标 |
| 归档 | `MOVE Archive` | 从收件箱移到 Archive |
| 删除 | `+FLAGS \Deleted` + `EXPUNGE` | **永久删除（不进废纸篓，不可恢复）** |

注意两点：
- **删除是永久的**，慎用。
- 同步是**单向**的（EmailClaw → 服务器 → 你的其它客户端）；你在邮箱 App 里手动改的状态**不会**自动回写 EmailClaw 数据库。

---

## 10. 关闭 / 卸载 / 常见问题

**临时关闭增强**：`.env` 把 `OPENCLAW_ENABLED=false`，重启后端即回退本地规则。OpenClaw 不常驻，无需额外关进程。

**停止后端**：在跑 `npm run dev` 的终端按 `Ctrl + C`。如果用 nohup / pm2 / systemd 启动，按对应方式停。

**卸载 OpenClaw**：`npm uninstall -g openclaw`（配置目录 `~/.openclaw` 可手动 `rm -rf` 删）。

| 现象 | 排查 |
|---|---|
| 每封都 `other / 重要性3` | `OPENCLAW_ENABLED` 是否为 `true`；是否漏了拆信封适配（第 7 节①） |
| 日志报 `ENOENT` / 找不到命令 | `which openclaw` 看看 PATH 里有没有；nvm 用户多半要在 `.env` 写绝对路径 |
| 日志报 `EACCES: permission denied` | OpenClaw 配置目录 `~/.openclaw` 权限不对，`chmod -R u+rw ~/.openclaw` |
| 日志报 `TakeoverError` | session-key 适配缺失（第 7 节②）；确认用的是仓库现有的 `openClawClient.ts` |
| `pong` 测试就失败 | DeepSeek Key 错 / 没充值 / 部署机访问不了 `api.deepseek.com`（curl 测试一下） |
| 偶发 `OpenClaw 分析失败` 后又恢复 | 模型偶发畸形，已有重试兜底，少量出现属正常 |
| systemd 启动后找不到命令 | systemd 不继承登录 shell 的 PATH，要在 unit file 显式 `Environment=PATH=...` 加上 openclaw 所在目录 |

---

## 11. 成本参考

- OpenClaw 本身**免费**（开源 npm 包）。
- 花钱的只有 **DeepSeek token**，按调用量计费，每封邮件约一次调用。
- 用 `deepseek-chat`，每封邮件成本约**几厘钱**，1~5 元够测很久。
- 余额用尽时调用失败，后端**自动回退本地规则**，不会漏收邮件。

---

## 12. WSL2 用户特别说明

WSL2 上跑 EmailClaw + OpenClaw 和原生 Linux **完全一致**，不需要任何特殊处理。几点小提醒：

- 配置目录 `~/.openclaw/openclaw.json` 在 WSL 文件系统里（`/home/<user>/.openclaw/`），不在 Windows 文件系统
- 不要把项目放在 `/mnt/c/...` 下，文件系统跨界访问会让 Node 文件监听器（ts-node-dev / node --watch）非常慢甚至失效
- DeepSeek API 是公网服务，WSL2 出网无障碍

---

## 附：一页速查（非交互式，复制即用）

```bash
# 1. 安装
npm install -g openclaw
openclaw --version

# 2. 配置 DeepSeek（换成你的 key）
openclaw config set models.providers.deepseek.apiKey "sk-你的key"
openclaw config set agents.defaults.model "deepseek/deepseek-chat"
openclaw config validate

# 3. 建 agent
mkdir -p ~/.openclaw/workspaces/email-claw
openclaw agents add email-claw \
  --model deepseek/deepseek-chat \
  --non-interactive \
  --workspace ~/.openclaw/workspaces/email-claw

# 4. 自测
openclaw infer model run --model deepseek/deepseek-chat --prompt "reply with: pong"

# 5. 后端 .env 写入：
#   OPENCLAW_ENABLED=true
#   OPENCLAW_COMMAND=openclaw              ← Linux 直接写 openclaw，不带 .cmd
#   OPENCLAW_AGENT_ID=email-claw
#   OPENCLAW_TIMEOUT_MS=60000
# 如果遇到 ENOENT，改写绝对路径：
#   OPENCLAW_COMMAND=$(which openclaw)

# 6. 启动
npm run dev
```
