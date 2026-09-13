# Agent API Hub ⚡

把任意 **OpenAI / Anthropic / Gemini 兼容 API**(官方或中转站)一键接入本地 CLI Agent 的管理面板,支持 **Claude Code、Codex CLI、Gemini CLI**。

一个理解"配置切换器"原理的练手小项目:cc-switch 的核心逻辑 + 供应商连通性测试,零依赖、单命令运行。

## 快速开始

```bash
node server.js        # 或 npm start,要求 Node 18+
# 打开 http://127.0.0.1:8317
```

1. 点「＋ 添加供应商」,选择接入目标、填 Base URL 和 API Key;
2. 点「测试」验证鉴权是否通过(发一个近乎零成本的真实请求);
3. 点「预览」确认将要写入的内容,点「启用」写入对应 CLI 的配置文件;
4. 重启 CLI 会话即生效。点状态徽章上的 ↺ 可恢复 CLI 官方默认。

## 工作原理

CLI 工具本身不知道"供应商"的存在——它们只是从固定路径的配置文件读取上游地址和密钥。本工具做的就是**管理这些文件的写入**:

| 目标 CLI | 配置文件 | 写入的键 |
|---|---|---|
| Claude Code | `~/.claude/settings.json` | `env.ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN / ANTHROPIC_MODEL` |
| Codex CLI | `~/.codex/config.toml` + `auth.json` | 顶部管理块 `model_provider` + `[model_providers.apihub]`;`auth.json` 的 `OPENAI_API_KEY` |
| Gemini CLI | `~/.gemini/.env` | `GEMINI_API_KEY / GOOGLE_GEMINI_BASE_URL / GEMINI_MODEL` |

```
你的 CLI Agent ──读取──► 配置文件 ◄──合并写入(写前自动备份)── Agent API Hub
                                                           │
                                              供应商列表 data/providers.json
```

### 关键设计

- **合并写入,不破坏现有配置**:只增改本工具管理的键。Claude 的 `settings.json` 按 JSON 解析后原样合并;Codex 的 TOML 只在顶部插入带标记的管理块(顶层 `model_provider`/`model` 键会被替换,因为 TOML 出现 `[table]` 后无法回到顶层,且重复键非法);Gemini 的 `.env` 按行 upsert。
- **写前备份**:每次写入/恢复前,把原文件复制为 `*.apihub.bak`(滚动保留最近一份)。
- **幂等**:管理块带起止标记,重复启用不会产生重复块;损坏的 JSON 会被检测并中止写入。
- **原子写入**:先写临时文件再 rename,避免写一半崩溃留下损坏配置。
- **连通性测试**:Anthropic 协议先试 `GET /v1/models`,404/405 则退化为 1 token 的对话请求;OpenAI/Gemini 协议各自走 models 列表接口。
- **状态检测**:面板实时读取三个配置文件,显示当前上游和归属(本工具管理 / 手动配置 / 默认)。

## 项目结构

```
agent-api-hub/
├── server.js          # 零依赖后端:HTTP + 存储 + 三个 CLI 的配置写入引擎
├── public/
│   ├── index.html     # 单页面板
│   ├── style.css      # 深色主题
│   └── app.js         # 前端逻辑(原生 JS,无构建步骤)
├── test/smoke.js      # 沙盒冒烟测试(不触碰真实配置)
└── data/providers.json  # 供应商数据(首次运行生成)
```

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `APIHUB_PORT` | `8317` | 监听端口(仅绑定 127.0.0.1) |
| `APIHUB_HOME` | 用户主目录 | 配置文件定位根目录(测试用) |
| `APIHUB_DATA_DIR` | `./data` | 供应商存储目录(测试用) |

## 测试

```bash
npm test   # 在 .sandbox-home 沙盒里预置假配置,跑完 27 项断言后自动清理
```

覆盖:合并写入保留用户原配置、备份生成、幂等启用、TOML 顶层键清理、`.env` upsert、失败请求的优雅处理、恢复默认。

## 安全须知

- API Key 以**明文**存储在 `data/providers.json`,这是单机小工具的取舍,请勿分享该目录;
- 所有 prompt 与代码上下文会发往你配置的上游——接中转站前想清楚信任问题;
- 服务只监听回环地址,不对局域网开放。

## 可以继续扩展的方向

- 请求日志 / 用量统计(本地起代理转发,顺带实现热切换,即 cc-switch 的 Proxy 模式)
- 导入 / 导出供应商配置,扫码同步
- 更多 CLI:OpenCode、Cursor、Zed 等(各自找配置文件加一个 target 即可)
- 托盘常驻、开机自启(可迁移到 Tauri/Electron)
