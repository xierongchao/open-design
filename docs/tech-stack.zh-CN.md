# Open Design 技术栈说明文档

> 本文档面向项目开发者，介绍 Open Design 的前后端架构、技术选型和关键约定。

---

## 项目简介

Open Design 是一个**本地优先（local-first）的开源设计工具**，定位为 Claude Design 的开源替代方案。它能检测本地安装的代码 Agent CLI（如 Claude Code、Cursor、Codex 等），通过设计技能（Skills）和设计系统（Design Systems）驱动 AI 生成网页原型、演示文稿、图片、视频等设计产物，并在沙箱 iframe 中实时预览。

采用 **pnpm monorepo** 管理，包含 6 个应用和 13 个共享包。

---

## 整体架构

```
┌─────────────────────────────────────────────────────────┐
│                    Electron 桌面端 (apps/desktop)         │
│                     Electron 41 — 薄壳，通过 Sidecar IPC  │
│                     发现 Web URL，负责窗口管理              │
├─────────────────────────┬───────────────────────────────┤
│   Web 前端               │   Daemon 后端                   │
│   apps/web               │   apps/daemon                   │
│   Next.js 16 + React 18  │   Express 5 + SQLite            │
│   Turbopack 构建          │   SSE 流式推送                   │
├─────────────────────────┴───────────────────────────────┤
│               packages/* — 共享层                          │
│   contracts (DTO) · components (UI) · sidecar · platform  │
├─────────────────────────────────────────────────────────┤
│               tools/* — 工具链                             │
│   tools-dev (开发管理) · tools-pack (打包) · tools-serve    │
├─────────────────────────────────────────────────────────┤
│               e2e — 端到端测试                              │
│   Playwright UI 自动化 + Vitest HTTP 级测试                 │
└─────────────────────────────────────────────────────────┘
```

**通信方式：** Web 前端通过 HTTP REST 和 SSE 与 Daemon 通信，两者之间无直接代码引用，所有共享类型定义在 `packages/contracts`。

---

## 应用层（apps/）

### 1. Web 前端 — `apps/web`

| 类别 | 技术选型 | 说明 |
|------|---------|------|
| **框架** | Next.js 16 (App Router) + React 18 | 使用 `[[...slug]]` 捕获所有路由 |
| **构建** | Turbopack (dev) / Next.js 内置 (prod) | 开发模式快速热更新 |
| **样式** | Tailwind CSS 4 + 全局 CSS + CSS Modules | `src/styles/` 下按功能域组织 |
| **图标** | Lucide React | 统一图标库 |
| **动画** | Motion 12 | 进入 200ms / 退出 140ms，ease-out |
| **代码高亮** | Shiki | 用于代码预览 |
| **富文本** | Lexical | 聊天输入等场景 |
| **终端** | xterm.js | 内置终端面板 |
| **AI SDK** | `@anthropic-ai/sdk` + `openai` | 支持 BYOK 模式 |
| **分析** | PostHog JS | 用户行为分析 |
| **测试** | Vitest + Testing Library + jsdom | 单元/组件测试 |
| **i18n** | 自建方案，18 种语言 | 类型安全的字典 |

**关键目录结构：**

```
apps/web/
├── app/                    # Next.js App Router
│   ├── layout.tsx          # 根布局（主题、i18n、分析）
│   ├── [[...slug]]/        # 捕获所有页面路由
│   └── desktop-pet/        # 桌面宠物功能
├── src/
│   ├── components/         # React 组件（按功能划分）
│   ├── styles/             # 全局样式（按域组织）
│   │   ├── viewer/         # 文件查看器样式
│   │   └── workspace/      # 工作区样式
│   ├── i18n/               # 国际化（18 种语言）
│   ├── edit-mode/          # HTML 编辑模式（bridge.ts）
│   ├── runtime/            # 运行时状态管理
│   ├── analytics/          # PostHog 分析
│   └── index.css           # 样式入口（仅 import）
└── tests/                  # 测试文件
```

**样式约定：**
- `index.css` 仅做 import，不添加选择器
- 新组件默认使用 CSS Modules（`Component.module.css`）
- 全局类名仅用于跨组件共享契约

### 2. Daemon 后端 — `apps/daemon`

| 类别 | 技术选型 | 说明 |
|------|---------|------|
| **运行时** | Node.js ~24 (ESM) | `engines: "node": "~24"` |
| **HTTP** | Express 5 | REST API + SSE 流式推送 |
| **数据库** | SQLite (better-sqlite3) | 本地存储，路径 `.od/app.sqlite` |
| **终端** | node-pty | Agent 进程管理 |
| **文件监听** | Chokidar | 产物文件变更监听 |
| **MCP** | `@modelcontextprotocol/sdk` | 模型上下文协议 |
| **HTML 解析** | Cheerio | HTML 内容处理 |
| **压缩** | JSZip + tar | 文件打包 |
| **监控** | OpenTelemetry + Prometheus | 可观测性 |
| **分析** | PostHog Node | 服务端分析 |
| **测试** | Vitest | 单元/集成测试 |

**API 路由（`src/routes/`）：**

| 路由文件 | 功能 |
|---------|------|
| `deploy.ts` | 部署相关 |
| `design-system-tool.ts` | 设计系统工具 |
| `handoff.ts` | 任务交接 |
| `host-tools.ts` | 宿主工具 |
| `live-artifact.ts` | 实时产物 |
| `memory.ts` | 记忆管理 |
| `routine.ts` | 自动化例程 |
| `static-resource.ts` | 静态资源 |
| `xai.ts` | XAI 集成 |

**支持的 Agent 运行时（`src/runtimes/defs/`）：**

Claude、Codex、Cursor Agent、Copilot、DeepSeek、Gemini、Grok、Hermes、Kimi、Kiro、OpenCode、Qwen、Aider、Antigravity、Devin、Kilo、Pi、Qoder、Reasonix、AMR 等 21 种。

### 3. Desktop 桌面端 — `apps/desktop`

| 类别 | 技术选型 |
|------|---------|
| **框架** | Electron 41 |
| **定位** | 薄壳，通过 Sidecar IPC 发现 Web URL |
| **职责** | 窗口管理、系统托盘、原生功能桥接 |

### 4. 其他应用

| 应用 | 说明 |
|------|------|
| `apps/landing-page` | 官网落地页 |
| `apps/packaged` | 打包版 Electron 入口，负责 `od://` 协议 |
| `apps/telemetry-worker` | 遥测数据 Worker |

---

## 共享包层（packages/）

| 包名 | 职责 | 关键依赖 |
|------|------|---------|
| **contracts** | 纯 TypeScript DTO 层（API 类型、SSE 事件、错误形状） | Zod（Schema 校验） |
| **components** | 共享 UI 组件库（Button、VisuallyHidden 等） | React |
| **sidecar-proto** | Sidecar 协议定义（常量、stamp 字段、IPC 消息 schema） | 无 |
| **sidecar** | 通用 Sidecar 运行时（启动、IPC 传输、路径解析） | sidecar-proto |
| **platform** | 通用 OS 进程原语（进程扫描、命令解析） | sidecar-proto |
| **host** | Host 层抽象 | — |
| **plugin-runtime** | 插件运行时 | — |
| **registry-protocol** | 注册表协议 | — |
| **agui-adapter** | AGUI 适配器 | — |
| **diagnostics** | 诊断工具 | — |
| **download** | 下载工具 | — |
| **launcher-proto** | 启动器协议 | — |
| **metatool** | 元工具 | — |

**关键约定：**
- `contracts` 必须保持纯 TypeScript，不能依赖 Next.js、Express、Node 文件系统、浏览器 API 等
- Web 和 Daemon 通过 `contracts` 共享类型，不直接导入对方的源码
- 使用 esbuild 构建 contracts，输出 `.mjs` 格式

---

## 工具链（tools/）

| 工具 | 说明 | 常用命令 |
|------|------|---------|
| **tools-dev** | 本地开发全生命周期管理 | `pnpm tools-dev`（统一入口） |
| **tools-pack** | 客户端打包构建 | `pnpm tools-pack mac build --to all` |
| **tools-serve** | Fixture 测试服务 | `pnpm tools-serve start updater` |

**tools-dev 支持的操作：**

```bash
pnpm tools-dev                    # 启动开发环境
pnpm tools-dev start web          # 启动 Web
pnpm tools-dev status --json      # 查看状态
pnpm tools-dev logs --json        # 查看日志
pnpm tools-dev inspect desktop status --json   # 检查桌面端状态
pnpm tools-dev inspect desktop screenshot      # 桌面端截图
pnpm tools-dev stop               # 停止
pnpm tools-dev check              # 检查
```

---

## 测试（e2e/）

| 类型 | 工具 | 范围 |
|------|------|------|
| **端到端测试** | Vitest | Daemon HTTP 边界测试 |
| **UI 自动化** | Playwright | 用户界面交互测试 |

测试文件位于 `e2e/tests/`，按功能域组织。

---

## 基础设施

### 包管理

- **pnpm 10.33.2**（通过 Corework 启用）
- Node.js ~24（ESM 模式）
- TypeScript 5.9（全项目统一）

### 数据存储

所有数据存储在本地：

```
.od/
├── app.sqlite              # SQLite 数据库
├── projects/<id>/          # Agent 工作目录
├── artifacts/              # 保存的渲染产物
└── media-config.json       # 媒体凭据
```

环境变量覆盖：`OD_DATA_DIR` > 项目根目录。

### 通信协议

- **REST API：** Web 通过 `/api/*` 访问 Daemon
- **SSE 流式推送：** `/api/chat` 实时流式输出 AI 对话
- **开发代理：** Next.js dev 模式通过 rewrites 代理 `/api/*`、`/artifacts/*`、`/frames/*` 到 Daemon 端口
- **生产模式：** 静态导出，由 Daemon 直接提供静态文件服务

### 国际化

支持 18 种语言：阿拉伯语、德语、英语、西班牙语、波斯语、法语、匈牙利语、印尼语、日语、韩语、波兰语、巴西葡萄牙语、俄语、泰语、土耳其语、乌克兰语、简体中文、繁体中文。

类型定义在 `apps/web/src/i18n/types.ts`，缺失翻译会产生 TypeScript 编译错误。

---

## 开发约束

| 约束 | 说明 |
|------|------|
| **统一入口** | 所有本地开发通过 `pnpm tools-dev`，不使用 `pnpm dev` |
| **包作用域** | 不添加根级 `pnpm build` / `pnpm test` 别名 |
| **边界隔离** | Web 不直接导入 Daemon 源码，通过 HTTP API 通信 |
| **UI/CLI 双轨** | 每个功能必须同时有 Web UI 和 `od` CLI 入口 |
| **测试位置** | 测试文件在 `tests/` 目录，不在 `src/` 内 |
| **CSS 规范** | 新组件使用 CSS Modules，全局样式按功能域组织 |
| **Git 提交** | 禁止 `Co-authored-by` 等署名信息 |
| **文件限制** | 单文件 < 800 行，函数 < 50 行，嵌套 < 4 层 |

---

## 常用命令速查

```bash
# 环境搭建
pnpm install

# 开发
pnpm tools-dev
pnpm tools-dev run web --daemon-port 17456 --web-port 17573

# 代码检查
pnpm guard
pnpm typecheck
pnpm --filter @open-design/web typecheck
pnpm --filter @open-design/web test
pnpm --filter @open-design/daemon test

# 构建
pnpm --filter @open-design/web build
pnpm --filter @open-design/daemon build

# 桌面端调试
pnpm tools-dev inspect desktop status --json
pnpm tools-dev inspect desktop screenshot --path /tmp/screenshot.png

# 打包客户端
pnpm tools-pack mac build --to all     # macOS
pnpm tools-pack win build --to nsis    # Windows
pnpm tools-pack linux build --to appimage  # Linux
```
