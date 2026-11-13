# Zhixu (知序)

**知序** keeps personal projects, feature plans, tasks, versions, and releases in a clear order. The existing project-release-hub folder/package identifiers remain stable for compatibility.

A local-first web workspace for personal software projects, concrete feature plans, tasks, issues, versions, and release tracking.

## What works in this version

- Chinese responsive dashboard with per-project feature, task and issue progress and one environment per project.
- Manual create, edit, and recoverable delete for projects, features, tasks, issues, and releases.
- Feature acceptance criteria, planned dates, priorities, and target releases; tasks/issues can link to a feature.
- Single-owner accounts with persistent sessions, password changes, session/grant revocation, and CSRF-protected web writes.
- Optional HTTPS/OAuth mode with explicit consent, S256 PKCE, scoped tokens, rotation, and revocation.
- Atomic batches, stable request IDs, optimistic revisions, duplicate-project creation review, and web confirmation for manual proposals/undo.
- Browser reconciliation of stale proposals: preserve applied fields, choose conflicts, generate a fresh pending proposal, then confirm separately.
- Audit snapshots and conflict-aware undo. Undo never silently overwrites a newer record or leaves dangling references.
- Explicit, read-only GitHub Actions refresh with last-successful cache and clear failure states. CI success never changes release or environment state.
- A real local Streamable HTTP MCP endpoint, tested using the official MCP client SDK. Authorized additions, edits and recoverable deletes apply directly, including mixed batches; creating a possible duplicate project still requires web review.
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

For a running VPS Docker container, initialize the administrator from the project directory:

```bash
docker compose -p zhixu -f compose.yml exec app npm run init-admin
```

Enter the password twice when prompted; input is hidden. Keep the interactive terminal (do not add -T). This uses the running container's database and also works with HTTPS/OAuth enabled. Refresh the web page and log in after success; no restart is needed. Existing accounts are never overwritten. See the [initialization guide](docs/account-oauth.md#initialize-the-first-administrator) for stdin automation and image requirements.

## Start the built app

```powershell
npm run build
npm start
```

Open http://127.0.0.1:4310. Both startup modes bind locally; neither publishes the app.

Data defaults to data/hub.db and is ignored by Git. Stop the app with Ctrl+C. Sessions, account and project records persist in SQLite. A stable HUB_SESSION_SECRET preserves browser login across restarts; local mode without one still requires login after restart.

## Optional configuration

Set variables in the same terminal before starting the server:

- PORT: API/built-app port, default 4310. The development proxy assumes the default port.
- HUB_DATA_DIR: directory containing hub.db, default ./data.
- HUB_BIND_HOST: defaults to 127.0.0.1. Dockerfile and Compose pin 0.0.0.0 inside a container whose host port must remain loopback-only.
- GITHUB_TOKEN: optional GitHub token. Public repositories can work without a token; private repositories require access with read-only Actions permission.
- HUB_MCP_TOKEN: local-only static token of at least 32 characters.
- HUB_PUBLIC_URL, HUB_SESSION_SECRET, HUB_TRUST_PROXY: optional HTTPS/OAuth mode; see [account and OAuth guide](docs/account-oauth.md). MCP is disabled unless a local token or remote OAuth is configured.

For Docker Compose and scripts/update-vps.sh, copy .env.example to a private .env in the repository root. Both read PORT and the five optional GitHub/MCP/OAuth settings; shell values take precedence. PORT controls both app listening and loopback host publication, defaults to 4310 and accepts integers from 1024 through 65535. For PORT=54321 the mapping is 127.0.0.1:54321:54321. Keep an existing Nginx upstream aligned with that host port. Compose keeps the container bind address and data directory fixed at 0.0.0.0 and /app/data. Keep unused optional settings commented out. Native npm startup still requires shell variables and does not automatically load .env. Never paste tokens into a project description or commit them.

GitHub repository values use owner/repo. Refresh runs only when you click “手动刷新”. This version does not trigger workflows, deploy releases, or write to GitHub.

## GitHub Actions and container packaging

The repository includes automatic checks and a separately dispatched private-GHCR image workflow. Publication requires manual dispatch from the repository's default branch, successful checks, a private existing package (or a new package), and an unused commit tag. No IMAGE_PUBLISH_REPOSITORY variable is required. Only the publishing job receives packages:write on the automatic GITHUB_TOKEN; no extra secrets are needed.

The source repository [zcorw/project-release-hub](https://github.com/zcorw/project-release-hub) is public. Source and GHCR package visibility are separate: public source may publish a private image. Existing non-private packages are rejected; new GHCR packages are private by default and must be verified after their first publication. This workflow never changes package visibility or deploys the application.

Image names follow the repository executing the workflow: ghcr.io/<lowercase-owner>/<lowercase-repository>. Running a copied workflow in a separate GitHub repository therefore targets that repository's package, not the original package. See [workflow setup, copy/fork behavior, and local Docker guide](docs/github-actions.md). The JavaScript Actions use Node 24; the application and container remain on their existing Node 22 versions.

## VPS image update helper

After updating a clean, committed checkout on an independently prepared Linux VPS, run `bash scripts/update-vps.sh`. It builds locally by default, backs up the existing SQLite database, updates the exact image ID, and records the latest verified image in `.deploy/latest-image.json` only after health succeeds. Use `bash scripts/update-vps.sh --status` to inspect actual versus saved state.

The updater reads the project-root .env for both local builds and --image digest pulls. Keep the backend port loopback-only; optional HTTPS/OAuth uses an independently configured reverse proxy. This source change does not operate a VPS or provision public access. See the [VPS update and recovery guide](docs/vps-update.md) for environment setup, prerequisites, immutable digest pulls, failures, backups, and explicit image-only rollback.

After a failed update caused by incorrect environment settings, fix .env and run `bash scripts/update-vps.sh --retry`. It recreates the image recorded in the pending journal with the corrected settings, repairs the image-selection file automatically and records success only after health verification. `--recover` only verifies an already healthy candidate. Keep deployment state files intact; do not edit them to bypass an unfinished attempt.

## MCP and ChatGPT

The implemented endpoint is http://127.0.0.1:4310/mcp with an Authorization: Bearer token header. It exposes read tools, idempotent direct batch writes, and request-status lookup. MCP edits/deletes no longer require human confirmation. Existing hub:propose OAuth grants now permit direct edits/deletes. Historical pending requests retain their stored outcome; clients can read current records and submit a fresh batch. No approval tool is needed for new edits/deletes. Client applications may still apply their own tool-confirmation policies.

See [MCP guide](docs/mcp.md) for contracts and examples.

**No real ChatGPT connection has been provisioned.** ChatGPT cloud cannot reach loopback. Optional HTTPS/OAuth is now implemented for a separately configured endpoint. See [account and OAuth guide](docs/account-oauth.md) for setup, scopes and live verification. This source change does not deploy, configure a real proxy/domain, create a connector, or expose a port.

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

- Single-owner application with opt-in HTTPS/OAuth; no independent penetration test or live public deployment is claimed.
- No repository-analysis AI inside the app. ChatGPT prepares structured data outside it.
- No GitHub login/token setup, Issues/PR synchronization, auto-refresh, or deployment execution.
- No remote ChatGPT connection has been provisioned.
- GitHub adapter tests use fixtures; real private-repository access is not verified.
- The web audit view shows the latest 100 events. Earlier events remain in SQLite; all pending requests remain discoverable.
- Undo is refused if newer revisions or reference constraints make it unsafe.
- Proposal reconciliation compares whole fields (including text); missing historical bases or deleted targets require manual handling. See the [reconciliation guide](docs/proposal-rebase-plan.md#using-reconciliation).
- No multi-user permissions, password recovery email, or automatic backup schedule.
- Source commit/push is authorized to zcorw/project-release-hub only. No image publication, deployment, or changes to persistent computer permissions are included.

## Engineering documents

- [Project overview](docs/project-overview.md)
- [Architecture](docs/architecture.md)
- [Conventions](docs/project-conventions.md)
- [MVP plan](docs/mvp-development-plan.md)
- [Development checklist](TODO.md)
- [MCP guide](docs/mcp.md)
- [Account and OAuth guide](docs/account-oauth.md)
- [Verification](docs/verification.md)
- [GitHub Actions and local container](docs/github-actions.md)
- [Naming and workflow plan](docs/naming-and-ci-plan.md)
- [VPS image updates](docs/vps-update.md)
