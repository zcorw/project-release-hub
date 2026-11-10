# Verification Report

Date: 2026-11-10. Platform: Windows, Node 22.12.0, npm 10.9.0.

## Verified so far

- TypeScript strict check: passed.
- SQLite restart persistence and transaction rollback: passed.
- Atomic batches, payload-bound idempotency, project duplicates, confirmation/rejection, optimistic conflicts, relation integrity, release/date validation, audit, and guarded undo: passed.
- Password setup/login/logout, hashing, session rotation, CSRF, host checks, and isolation of bearer tokens from approval routes: passed.
- GitHub read-only GET, failure/cache behavior, authorization/rate-limit/not-found failures, unsafe output-link rejection, repository cache separation, and concurrent-refresh guard: passed with fixtures.
- Official MCP SDK client against real localhost transport: passed.
- Automated Chrome workflow: passed. Setup validation, login, project/feature/task/issue/release creation, feature plan dates, link selection, deferred approval, rejection, duplicate review, cancel, deletion/undo, desktop and mobile layout.
- Desktop and 390px screenshots were visually inspected.

## Final aggregate results

Final npm run check: passed formatting, strict TypeScript, 40 unit/integration tests across six files, and production build. Final npm run test:e2e: one comprehensive Chrome scenario passed, including an interrupted request whose server write succeeded and a close/reopen retry that reused the original request ID. Production dependency audit: zero known vulnerabilities. Online backup consistency and overwrite refusal were tested using an isolated database.

## Not performed

- No real private GitHub repository or user token was configured.
- No cloud ChatGPT connector/OAuth flow was exercised.
- No public hosting, penetration test, multi-user load test, push, or deployment.
- No automatic backup schedule or production recovery rehearsal using actual user records.

## Runtime compatibility finding

better-sqlite3 13.0.3 crashed with an access violation on the installed Node 22.12.0. It was replaced with pinned 11.10.0, which passed all runtime tests. No Node upgrade or system permission change was made.

## Zhixu naming and GitHub Actions follow-up

Date: 2026-11-10. Product name: 知序 (Zhixu). Existing technical identifiers and native data location were preserved.

- Aggregate check passed again: formatting, strict TypeScript, 45 unit/integration tests across seven files, and production build.
- Complete isolated local Chrome scenario passed again, including the new page-title/brand assertions, CRUD, confirmation, duplicate review, undo, interrupted-submit recovery, desktop, and 390px layout.
- Desktop and mobile screenshots were inspected after the branding change.
- Docker Compose configuration validation passed.
- Linux/amd64 image built successfully with Node 22.23.4 and production dependencies, including the native SQLite adapter and runtime tsx.
- Isolated container smoke test passed: UID 1000, Chinese UI, health, unauthenticated 401, hostile Host 403, disabled MCP 503, password setup, SQLite persistence, session isolation, and Docker health on both default and custom internal ports.
- Static review found a hard-coded container healthcheck port; it was changed to use PORT and verified by the custom-port smoke test.
- The initial smoke harness used fetch to override Host, but that client did not send the intended header. It now uses node:http, and the real Host rejection passes.
- Workflow YAML was parsed by Prettier; workflow structure and publication guards were independently reviewed.

No repository remote/initial commit, GitHub-hosted Actions run, Actions variable/secret setup, registry login, GHCR publication, or deployment was performed. Ubuntu-hosted CI browser behavior and registry permissions remain to be verified in the first separately authorized GitHub run; local Windows Chrome and Linux container checks are not a claim that hosted CI passed.

The smoke test used only its own random temporary volume and container. The native data directory was not changed.

## Source publication authorization

After local verification, the user authorized committing and pushing the completed source to https://github.com/zcorw/project-release-hub. The existing destination was verified empty, public, and writable; its reported default branch was main. The local commit convention requires a feature branch, so source delivery uses feat/zhixu-workflows. A source-only scan of all 67 candidate files found no database, backup, log, private key, token, credential URL, or personal machine path. The public destination does not satisfy the private GHCR publication gate. No visibility, variables, secrets, package publishing, or deployment changes are included. Push and hosted CI results must be verified separately.
