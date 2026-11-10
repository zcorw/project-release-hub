# Zhixu (知序)

**知序** keeps personal projects, feature plans, tasks, versions, and releases in a clear order. The existing project-release-hub folder/package identifiers remain stable for compatibility.

A local-first web workspace for personal software projects, concrete feature plans, tasks, issues, versions, and release tracking.

## What works in this version

- Chinese responsive dashboard with cross-project feature progress and one environment per project.
- Manual create, edit, and recoverable delete for projects, features, tasks, issues, and releases.
- Feature acceptance criteria, planned dates, priorities, and target releases; tasks/issues can link to a feature.
- Single-user password setup and login, hashed passwords, session rotation, and CSRF-protected web writes.
- Atomic batches, stable request IDs, optimistic revisions, duplicate-project review, and human confirmation.
- Audit snapshots and conflict-aware undo. Undo never silently overwrites a newer record or leaves dangling references.
- Explicit, read-only GitHub Actions refresh with last-successful cache and clear failure states. CI success never changes release or environment state.
- A real local Streamable HTTP MCP endpoint, tested using the official MCP client SDK. New records can save directly; edits/deletes are proposals that only the web user can approve.
- SQLite persistence, an online backup command, automated tests, and browser workflow checks.

## Requirements

- Node.js 22.12 or newer and npm.
- Windows is the verified local platform.
- Google Chrome is used by local browser tests; GitHub Actions installs Playwright Chromium. Running the application needs only a normal browser.
- Docker Desktop with Linux containers is optional for local image checks.

The SQLite adapter is pinned to better-sqlite3 11.10.0. The latest 13.0.3 adapter crashed on the installed Node 22.12 runtime; 11.10.0 passed persistence, transactions, API tests, and browser verification. No system Node upgrade was performed.

## Start development

From this repository:

```powershell
npm ci
npm run dev
```

Open http://127.0.0.1:5173. The API runs on port 4310. On the first visit, choose an administrator password of at least 12 characters. There is no built-in account or default password.

## Start the built app

```powershell
npm run build
npm start
```

Open http://127.0.0.1:4310. Both startup modes bind locally; neither publishes the app.

Data defaults to data/hub.db and is ignored by Git. Stop the app with Ctrl+C. Sessions are kept in memory and expire on server restart. The account and project records persist in SQLite.

## Optional configuration

Set variables in the same terminal before starting the server:

- PORT: API/built-app port, default 4310. The development proxy assumes the default port.
- HUB_DATA_DIR: directory containing hub.db, default ./data.
- HUB_BIND_HOST: defaults to 127.0.0.1. The Dockerfile alone opts into 0.0.0.0 inside a container whose host port must remain loopback-only.
- GITHUB_TOKEN: optional GitHub token. Public repositories can work without a token; private repositories require access with read-only Actions permission.
- HUB_MCP_TOKEN: a separate random token of at least 32 characters. MCP is disabled when absent.

.env.example is a reference only; the app does not automatically load .env. Never paste tokens into a project description or commit them.

GitHub repository values use owner/repo. Refresh runs only when you click “手动刷新”. This version does not trigger workflows, deploy releases, or write to GitHub.

## GitHub Actions and container packaging

The repository now includes automatic checks and a separate manually triggered private-GHCR image workflow, following Zhijiao. Publication is gated by the exact IMAGE_PUBLISH_REPOSITORY repository variable, private visibility, the default branch, and successful checks. Only the publishing job receives packages:write on the automatic GITHUB_TOKEN; no extra secrets are needed.

The user subsequently authorized committing and pushing the source to [zcorw/project-release-hub](https://github.com/zcorw/project-release-hub). This repository is public: checks can run, but the private-image publication workflow deliberately refuses publication from it. Repository visibility, Actions variables, and secrets are not changed. See [workflow setup and local Docker guide](docs/github-actions.md) for the gates and storage precautions.

## VPS image update helper

After updating a clean, committed checkout on an independently prepared Linux VPS, run `bash scripts/update-vps.sh`. It builds locally by default, backs up the existing SQLite database, updates the exact image ID, and records the latest verified image in `.deploy/latest-image.json` only after health succeeds. Use `bash scripts/update-vps.sh --status` to inspect actual versus saved state.

This is operator tooling, not a live deployment or permission to expose the MVP publicly. Keep loopback-only access. See the [VPS update and recovery guide](docs/vps-update.md) for prerequisites, immutable digest pulls, failures, backups, and explicit image-only rollback.

## MCP and ChatGPT

The implemented endpoint is http://127.0.0.1:4310/mcp with an Authorization: Bearer token header. It exposes read tools, idempotent batch submission, and request-status lookup. It intentionally exposes no approval tool.

See [MCP guide](docs/mcp.md) for contracts and examples.

**The local endpoint has not been connected to ChatGPT cloud.** ChatGPT cloud cannot reach this computer's loopback address. A real remote connection needs a separately authorized hosted HTTPS endpoint and suitable authentication. This delivery does not deploy, create a ChatGPT plugin, configure OAuth, or expose a port to the internet.

## Verification

```powershell
npm run check
npm run test:e2e
```

check runs formatting, TypeScript, unit/integration tests, and a production build. Browser tests start an isolated instance on port 4311 using a fresh temporary database, never the normal data directory.

See [verification report](docs/verification.md).

## Backup and recovery

For a consistent online SQLite backup:

```powershell
npm run backup -- .\backups\hub-2026-11-10.db
```

Choose a new filename every time. The command refuses to overwrite an existing file. Backups include project history and the account password hash; treat them as private.

To restore:

1. Stop every running instance of this app.
2. Move the current data directory to a separate recovery location so the current state is preserved.
3. Create a fresh data directory and copy the chosen backup into it as hub.db. Do not carry old hub.db-wal or hub.db-shm files into the restored directory.
4. Start the app and verify the records before discarding any recovery copy.

Alternatively, stop the app and copy the entire data directory. Do not copy just hub.db while WAL writes are active.

To reset a forgotten password, stop the server, set HUB_RESET_PASSWORD to the new password in the local terminal, run npm run reset-password, then clear that variable and restart. Use the same HUB_DATA_DIR as the app. Do not share the password in chat.

## Scope and limitations

- Local single-user MVP, not a hardened publicly hosted service.
- No repository-analysis AI inside the app. ChatGPT prepares structured data outside it.
- No GitHub login/token setup, Issues/PR synchronization, auto-refresh, or deployment execution.
- No remote ChatGPT connection has been provisioned.
- GitHub adapter tests use fixtures; real private-repository access is not verified.
- The web audit view shows the latest 100 events. Earlier events remain in SQLite; all pending requests remain discoverable.
- Undo is refused if newer revisions or reference constraints make it unsafe.
- No multi-user permissions, password recovery email, automatic backup schedule, or public-service OAuth.
- Source commit/push is authorized to zcorw/project-release-hub only. No image publication, deployment, or changes to persistent computer permissions are included.

## Engineering documents

- [Project overview](docs/project-overview.md)
- [Architecture](docs/architecture.md)
- [Conventions](docs/project-conventions.md)
- [MVP plan](docs/mvp-development-plan.md)
- [Development checklist](TODO.md)
- [MCP guide](docs/mcp.md)
- [Verification](docs/verification.md)
- [GitHub Actions and local container](docs/github-actions.md)
- [Naming and workflow plan](docs/naming-and-ci-plan.md)
- [VPS image updates](docs/vps-update.md)
