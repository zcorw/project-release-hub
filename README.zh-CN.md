# 知序 Zhixu

[English](README.md) | [简体中文](README.zh-CN.md)

**知序**让个人项目、功能计划、任务、版本和发布有序推进。为兼容现有使用方式，保留 project-release-hub 目录名和包标识。

这是一个本地优先的 Web 工作台，用于管理个人软件项目、具体功能计划、任务、问题、版本与发布进度。

## 当前版本能力

- 中文响应式看板，按项目分别展示功能、任务和问题进度，每个项目维护一个运行环境。
- 首页卡片使用独立的项目简介；完整说明和历史日志仍可在项目详情中查看。
- 手动新增、编辑和可恢复删除项目、功能、任务、问题及发布记录。
- 功能支持验收标准、计划日期、优先级和目标版本；任务和问题可关联功能。
- 单所有者账户、持久化会话、密码修改、会话与授权撤销，以及受 CSRF 保护的 Web 写入。
- 可选 HTTPS/OAuth 模式，提供显式授权同意、S256 PKCE、权限范围限定、令牌轮换与撤销。
- 原子批次、稳定请求 ID、乐观修订检查、重复项目创建审核，以及手动提案和撤销的 Web 确认。
- 在浏览器中协调过期提案：保留已应用字段、选择冲突值、生成新的待确认提案，再单独确认。
- 审计快照和冲突安全撤销；撤销不会静默覆盖较新记录或留下悬空引用。
- 显式、只读的 GitHub Actions 刷新，保留最近成功缓存并清楚展示失败状态。CI 成功不会改变发布或环境状态。
- 实际可用的本地 Streamable HTTP MCP 端点，并使用官方 MCP 客户端 SDK 测试。授权的新增、编辑和可恢复删除直接应用，支持混合批次；疑似重复项目的创建仍需 Web 审核。
- SQLite 持久化、在线备份命令、自动化测试及浏览器流程检查。

## 环境要求

- Node.js 22.12 或更新版本，以及 npm。
- Windows 是已经验证的本地平台。
- 本地浏览器测试使用 Google Chrome；GitHub Actions 安装 Playwright Chromium。运行应用只需要普通浏览器。
- 本地镜像检查可选用启用 Linux 容器的 Docker Desktop。

SQLite 适配器固定为 better-sqlite3 11.10.0。最新的 13.0.3 适配器曾在已安装的 Node 22.12 运行时崩溃；11.10.0 已通过持久化、事务、API 测试和浏览器验证。没有升级系统 Node。

## 启动开发环境

在本仓库目录中运行：

```powershell
npm ci
npm run dev
```

打开 http://127.0.0.1:5173。API 使用 4310 端口。首次访问时设置至少 12 个字符的管理员密码；没有内置账户或默认密码。

对于 VPS 上正在运行的 Docker 容器，在项目目录初始化管理员：

```bash
docker compose -p zhixu -f compose.yml exec app npm run init-admin
```

按提示输入两次密码，输入内容会隐藏。保留交互终端，不要添加 -T。命令使用运行中容器的数据库，启用 HTTPS/OAuth 时也适用。成功后刷新页面并登录，无需重启。已有账户不会被覆盖。标准输入自动化和镜像要求见[初始化指南](docs/account-oauth.md#initialize-the-first-administrator)。

## 启动构建后的应用

```powershell
npm run build
npm start
```

打开 http://127.0.0.1:4310。两种启动方式都绑定本地地址，不会发布应用。

数据默认保存在 data/hub.db，Git 会忽略该文件。按 Ctrl+C 停止应用。会话、账户和项目记录持久化于 SQLite。稳定的 HUB_SESSION_SECRET 可使浏览器登录在重启后继续有效；本地模式没有该配置时，重启后需要重新登录。

## 可选配置

启动服务器前，在同一个终端中设置变量：

- PORT：API 与构建后应用的端口，默认 4310。开发代理使用该默认端口。
- HUB_DATA_DIR：hub.db 所在目录，默认 ./data。
- HUB_BIND_HOST：默认 127.0.0.1。Dockerfile 和 Compose 在容器内固定使用 0.0.0.0，宿主机发布端口必须只绑定回环地址。
- GITHUB_TOKEN：可选 GitHub 令牌。公开仓库可以不使用令牌；私有仓库需要具备 Actions 只读权限的访问凭据。
- HUB_MCP_TOKEN：仅用于本地模式的静态令牌，至少 32 个字符。
- HUB_PUBLIC_URL、HUB_SESSION_SECRET、HUB_TRUST_PROXY：可选 HTTPS/OAuth 模式配置，见[账户与 OAuth 指南](docs/account-oauth.md)。未配置本地令牌或远程 OAuth 时，MCP 禁用。

使用 Docker Compose 和 scripts/update-vps.sh 时，将 .env.example 复制为仓库根目录中私有的 .env。两者都会读取 PORT 和文档列出的五项可选 GitHub/MCP/OAuth 设置，终端变量优先。PORT 同时控制应用监听端口和宿主机回环发布端口，默认 4310，接受 1024 至 65535 的整数。设置 PORT=54321 时，映射为 127.0.0.1:54321:54321。已有 Nginx upstream 应与该宿主机端口一致。Compose 固定容器绑定地址为 0.0.0.0、数据目录为 /app/data。未使用的可选配置保持注释。直接通过 npm 启动时仍需设置终端变量，不会自动加载 .env。不要把令牌粘贴到项目说明中或提交到仓库。

GitHub 仓库填写为 owner/repo。仅在点击“手动刷新”时获取运行记录。当前版本不会触发工作流、执行部署或写入 GitHub。

## GitHub Actions 与容器打包

仓库包含自动检查和单独手动触发的私有 GHCR 镜像工作流。发布要求从仓库默认分支手动触发、检查成功、已有包为私有或创建新包，并且对应提交标签尚未使用。不需要 IMAGE_PUBLISH_REPOSITORY 变量。只有发布任务会获得自动 GITHUB_TOKEN 的 packages:write 权限，不需要额外密钥。

源码仓库 [zcorw/project-release-hub](https://github.com/zcorw/project-release-hub) 是公开的。源码与 GHCR 包的可见性互相独立，公开源码也可发布私有镜像。工作流拒绝已有的非私有包；新 GHCR 包默认为私有，首次发布后仍须核实。该工作流不会改变包可见性，也不会部署应用。

镜像名称取决于执行工作流的仓库：ghcr.io/<小写所有者>/<小写仓库名>。将工作流复制到另一个 GitHub 仓库后，会使用该仓库的包，而不是原仓库的包。见[工作流配置、复制或 fork 行为与本地 Docker 指南](docs/github-actions.md)。JavaScript Actions 使用 Node 24，应用和容器继续使用现有 Node 22 版本。

## VPS 镜像更新工具

在独立准备的 Linux VPS 上，将干净且已提交的检出目录更新后，运行 `bash scripts/update-vps.sh`。工具默认在本地构建、备份现有 SQLite 数据库、更新到精确镜像 ID，并且只在健康检查成功后将最近验证的镜像记录到 `.deploy/latest-image.json`。使用 `bash scripts/update-vps.sh --status` 比较实际状态与已保存状态。

无论本地构建还是通过 --image 拉取 digest，更新工具都会读取项目根目录 .env。后端端口须保持仅绑定回环地址；可选 HTTPS/OAuth 使用独立配置的反向代理。本次源码变更不操作 VPS，也不开通公开访问。环境配置、前置条件、不可变 digest 拉取、失败、备份及显式镜像回滚见 [VPS 更新与恢复指南](docs/vps-update.md)。

若更新因环境设置错误失败，修正 .env 后运行 `bash scripts/update-vps.sh --retry`。工具会使用修正后的设置重新创建待处理日志记录的镜像，自动修复镜像选择文件，并只在健康验证后记录成功。`--recover` 仅验证已经健康的候选容器。请保持部署状态文件完整，不要编辑它们来绕过未完成的尝试。

## MCP 与 ChatGPT

已实现端点为 http://127.0.0.1:4310/mcp，使用 Authorization: Bearer 令牌请求头。提供读取工具、幂等的直接批量写入及请求状态查询。MCP 编辑和删除不再要求人工确认。已有 hub:propose OAuth 授权现在也允许直接编辑和删除。历史待处理请求保留原有结果；客户端可以读取当前记录并提交新批次。新的编辑和删除不需要批准工具。客户端应用仍可使用自己的工具确认策略。

契约和示例见 [MCP 指南](docs/mcp.md)。

**尚未配置实际 ChatGPT 连接。** ChatGPT 云端无法访问回环地址。已经实现可选 HTTPS/OAuth，可用于另行配置的端点。设置、权限范围及实际连接验证见[账户与 OAuth 指南](docs/account-oauth.md)。本次源码变更不部署、不配置真实代理或域名、不创建连接器，也不开放端口。

## 验证

```powershell
npm run check
npm run test:e2e
```

check 执行格式检查、TypeScript 检查、单元及集成测试和生产构建。浏览器测试使用新的临时数据库，在 4311 端口启动隔离实例，不使用正常数据目录。

见[验证报告](docs/verification.md)。

## 备份与恢复

生成一致的在线 SQLite 备份：

```powershell
npm run backup -- .\backups\hub-2026-11-10.db
```

每次选择新文件名，命令拒绝覆盖已有文件。备份包含项目历史和账户密码哈希，请按私密数据保管。

恢复步骤：

1. 停止此应用的所有运行实例。
2. 将当前数据目录移至单独的恢复位置，保留现有状态。
3. 创建新的数据目录，将选定备份复制为其中的 hub.db。不要把旧 hub.db-wal 或 hub.db-shm 文件带入恢复后的目录。
4. 启动应用并核实记录，再决定是否丢弃恢复副本。

也可以先停止应用，再复制整个数据目录。WAL 仍在写入时，不要只复制 hub.db。

忘记密码时，先停止服务器，在本地终端将 HUB_RESET_PASSWORD 设置为新密码，运行 npm run reset-password，然后清除该变量并重启。使用与应用相同的 HUB_DATA_DIR。不要在聊天中分享密码。

## 范围与限制

- 单所有者应用，支持选择启用 HTTPS/OAuth；不声称已完成独立渗透测试或真实公开部署。
- 应用内没有仓库分析 AI；ChatGPT 在外部准备结构化数据。
- 没有 GitHub 登录或令牌配置流程、Issues/PR 同步、自动刷新或部署执行。
- 尚未配置远程 ChatGPT 连接。
- GitHub 适配器测试使用固定数据，尚未验证真实私有仓库访问。
- Web 审计视图显示最近 100 个事件。更早的事件保留在 SQLite 中，所有待处理请求仍可查找。
- 较新修订或引用约束使撤销不安全时，系统拒绝撤销。
- 提案协调按整个字段比较，包括文本；缺少历史基准或目标已删除时需要手动处理。见[协调指南](docs/proposal-rebase-plan.md#using-reconciliation)。
- 没有多用户权限、密码恢复邮件或自动备份计划。
- 源码提交和推送仅授权至 zcorw/project-release-hub。不包括镜像发布、部署或修改计算机的持久权限。

## 工程文档

- [项目概述](docs/project-overview.md)
- [架构](docs/architecture.md)
- [约定](docs/project-conventions.md)
- [MVP 计划](docs/mvp-development-plan.md)
- [开发清单](TODO.md)
- [MCP 指南](docs/mcp.md)
- [账户与 OAuth 指南](docs/account-oauth.md)
- [验证](docs/verification.md)
- [GitHub Actions 与本地容器](docs/github-actions.md)
- [命名与工作流计划](docs/naming-and-ci-plan.md)
- [VPS 镜像更新](docs/vps-update.md)

## 任务与问题的交付状态

所有项目的任务和问题均有独立的开发验证状态和 GitHub 提交字段。见[字段含义与升级计划](docs/work-item-delivery-fields.md)和[中文说明](docs/work-item-delivery-fields.zh-CN.md)。已有完成状态不能作为已验证或已提交远端的证据。本次变更不部署应用。

## 项目简介

编辑项目的 `summary` 设置首页简介，最多 500 个字符，自动去除首尾空白。卡片只显示此字段；为空时显示“暂无项目简介”。完整 `description`、任务、问题、进度和审计历史均保留。已有项目初始没有简介，不从历史日志猜测或复制文本。Web、API 和 MCP 使用同一字段。旧客户端更新时省略该字段会保留已有值；发送空字符串可清空。见[简介方案](docs/project-card-introduction.md)和[中文说明](docs/project-card-introduction.zh-CN.md)。本次本地变更不部署，也不回填生产记录。
