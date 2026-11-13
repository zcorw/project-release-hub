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

## Native accounts and OAuth follow-up

Date: 2026-11-10. Existing data/passwords are preserved; all automated tests use disposable databases, servers and volumes.

- npm run check passed: formatting, strict TypeScript, 97 unit/integration tests across 10 files, and production build.
- Six isolated Chrome tests passed. Four mock account API edge states; one exercises real OAuth login, consent denial/allow, cross-origin loopback callback and code exchange; the existing workspace scenario now also exercises real password change, cancellation, other-session revocation and logout-all.
- Official MCP SDK tests exercise actual Express routes through a simulated HTTPS proxy: discovery, consent/PKCE, scoped reads/writes, pending edits/deletes, bearer/web separation, token refresh, revocation and persistence. The SDK's resource-aware refresh helper passes.
- Account tests cover v1 hash migration, stable-secret restart, current/other session revocation, offline reset, expiry, stale session saves, CSRF and Host/Origin/proxy/Secure-cookie rules.
- Security review found and resolved same-client reconsent scope inconsistency; replacement consent now revokes prior credentials. Real Chrome verification found and resolved consent form referrer/CSP callback restrictions.
- A fresh Linux image built successfully, and its isolated non-root/read-only container smoke passed: health on default/custom ports, hostile Host, login/setup, disabled local MCP, SQLite persistence and restart isolation. Native Node 22.12 initially exited with unsettled top-level await in the existing smoke harness. A wrapper keeping the event loop alive and bounding HTTP to five seconds passed, without changing production code or the harness. Temporary containers/volumes were removed.
- Desktop/mobile account layout checked for horizontal overflow and screenshots inspected. No real user database was opened by tests.

Not performed: real TLS/Nginx/firewall deployment, external ChatGPT onboarding, independent penetration/load testing, production restore, or remote updater adaptation. The VPS helper still rejects extra remote environment overrides. Source push and hosted CI status are separate verification steps.

## Private GHCR workflow follow-up

Date: 2026-11-11. This update supersedes the earlier source-private/IMAGE_PUBLISH_REPOSITORY activation requirements; historical verification above remains a record of the earlier revisions.

- npm run check passed: formatting (including workflow YAML parsing), strict TypeScript, 97 unit/integration tests across 10 files, and production build.
- All six isolated Chrome scenarios passed.
- The Python updater suite passed 20 tests and skipped the Linux-only flock case on Windows; Ubuntu CI covers that case.
- Docker Compose configuration validation passed. Local image build/container smoke were not rerun because the Docker Desktop Linux engine was not running; the unchanged application/container inputs are still checked by the full Ubuntu workflow after push.
- Eighteen isolated Bash checks passed: syntax of all four run blocks; user/organization target derivation; invalid target rejection; private/public/internal/404/403/network visibility results; existing/absent/unauthorized/network/unexpected commit-tag inspection results. Registry commands were mocked, and temporary outputs were removed. An initial test-harness attempt used /dev/stdout, unavailable under this Git Bash session; it was corrected to a temporary output file and the complete suite passed.
- Official action.yml manifests verified Node 24 for checkout/setup-node/upload-artifact v7, setup-buildx/login v4, and build-push v7. Application Node 22.23.4 and the local Node installation were not changed.
- Independent read-only review found no blocking workflow or documentation issue. Manual/default-branch dispatch, reusable checks, scoped token permissions, dynamic image targets, private-package checks, and commit-tag protection remain intact.

Not performed: a real GHCR publication, package visibility change, registry-permission setup, or VPS deployment. New packages rely on GHCR's private-by-default behavior and require a first-publication visibility check by the operator. Preflight visibility/tag checks cannot prevent simultaneous external administrator or writer changes. Hosted CI results for the exact pushed commit are separate evidence; a green run with a skipped publishing job is not a successful publication.

## Compose and VPS .env follow-up

Date: 2026-11-11. This supersedes the earlier claim that the updater rejects all remote environment settings. The documented GitHub/MCP/OAuth variables are now supported; actual remote deployment remains unperformed.

- npm run check passed: formatting, strict TypeScript, all 97 application unit/integration tests and production build. The initial sandbox attempt could not connect to temporary localhost services; the unrestricted local rerun passed without changing application code.
- All six isolated Chrome scenarios passed, including OAuth login/consent/callback, account controls, and workspace CRUD/review/undo.
- The Python suite contains 32 tests. Windows with ZHIXU_TEST_IMAGE=zhixu:env-ci passed 31 and skipped only Linux flock. A networkless Linux build-stage container with a read-only repository mount passed all 27 updater tests including real flock; its five Docker CLI/container checks were skipped because no Docker CLI/socket was supplied.
- Real Compose tests use disposable .env fixtures and copied Compose files, covering absent settings, the native example, shell precedence, literal dollar signs, local-token and OAuth settings, and fixed container paths/ports. A UUID-named Compose project created real containers for both local and OAuth configurations, checked actual Docker environment values and removed only its own containers/volume/network. No real operator .env was read.
- Build and container smoke passed for the fresh Linux image. The existing Node 22.12 smoke harness again exited with unsettled top-level await on its first direct attempt; the documented keep-alive wrapper with five-second HTTP timeouts passed non-root/read-only startup, health on default/custom ports, Host validation, setup/authentication, SQLite persistence and restart isolation. Production code and the harness were unchanged.
- Updater regressions cover the selected .env for build/pull/status/recovery, rejected environment overrides, configuration changes before replacement, stale-environment recovery refusal and secret-free command/state/status output, including failed replacement journals. CI runs the real container injection check after building its local image.
- Bash syntax and final formatting/diff checks passed. Windows sandbox restrictions on atomic replacement in its temporary directory were avoided by using a workspace-owned disposable test directory or the unrestricted local test process.

Not performed: a live VPS install/update, real GHCR pull/authentication/publication, public TLS/Nginx validation or ChatGPT onboarding. Source commit/push was separately authorized after this verification; remote delivery results must be checked separately.

## Pending-update retry follow-up

Date: 2026-11-12. --retry now recreates the journal's candidate with corrected configuration and regenerates a stale/missing selected-image.json. --recover still only verifies a candidate that is already healthy.

- Updater suite: 48 tests total. Windows with the local test image passed 47 and skipped Linux flock. A networkless Linux container with the repository mounted read-only passed 43 including flock and skipped the five Docker CLI/container checks. Those environments jointly exercised all cases.
- Sixteen new retry regressions passed: corrected settings, stale overlay repair, retained original/fresh backups, healthy/unhealthy/start-failure retries, first-install retries, stopped/missing containers, missing backups/volumes, unexpected image identities, backup failure and concurrent source/configuration/journal/container changes. Normal update/recovery/rollback regressions still passed.
- npm run check passed formatting, strict TypeScript, 97 application tests and production build. All six isolated Chrome scenarios passed. CLI help, Bash entry-point syntax and final diff checks passed.
- Real Compose/container environment checks used the existing unchanged application image and UUID-named disposable resources, which were removed after inspection. Actual retry lifecycle failures are tested with the fake Docker adapter; no real VPS recovery or production data was exercised.

The user subsequently authorized this verified retry change as its own source commit and a normal shared-branch push. No image publication or live VPS operation is included; remote delivery results are verified separately.

## Configurable Docker port follow-up

Date: 2026-11-12. PORT is now interpolated into the Compose application environment and matching loopback host/container mapping. The updater validates the selected port instead of requiring 4310 and reports configuredPort.

- The suite now has 52 tests: Windows with the local application test image passed 51 and skipped Linux flock; a networkless Linux container passed 45 and skipped the seven Docker CLI/container cases. Together they exercise all cases.
- Real Compose resolution verifies default 4310, .env custom ports and shell precedence across the app and both mapping endpoints. Invalid ranges/formats and mappings inconsistent with PORT are rejected by the updater. The repaired-environment retry case also changes PORT and verifies it reaches the recreated candidate.
- A separate UUID-named Compose test started the existing application image on a free non-default loopback port, checked Docker health, queried /api/health through that published port and inspected the effective PORT/mapping. Its independent container, network and data volume were removed. This demonstrates that the existing image's default/EXPOSE 4310 does not prevent runtime port selection.
- npm run check passed formatting, strict TypeScript, all 97 application tests and production build. All six isolated Chrome flows passed; final formatting/diff checks also passed.

No real .env, VPS, proxy or registry was changed. The user subsequently authorized separate commits for retry and port changes on one working branch and a normal push. Remote delivery results are verified separately.

## Container administrator initialization

Date: 2026-11-12. Added npm run init-admin for local operator initialization in the running application container. The decision record is admin-initialization-plan.md.

- npm run check passed formatting, strict TypeScript, all 115 tests across 11 files and production build. The 18 new cases cover password validation/confirmation, shared hashing, preserved business data, existing-owner/race guards, audit rollback, CLI input/no-echo errors, hidden terminal editing, Ctrl-C/EOF and raw-mode restoration.
- An integration test initialized a separate connection to a live HTTPS-mode app's database through the real CLI subprocess. The app reported configured and accepted login without restart, while remote web setup remained forbidden. All six existing isolated Chrome flows also passed.
- A fresh Linux runtime image built successfully with the npm alias, initialization script and terminal helper. Its smoke test passed as UID 1000 with a read-only root filesystem and disposable data volume: a real Linux pseudo-terminal tested hidden confirmation, Ctrl-C, mismatch and success against an independent temporary database; stdin initialized the running app's database; repeated initialization was refused; login worked immediately. Default/custom-port health, UI, Host checks, disabled local MCP and persistence/restart isolation also passed. Resources were removed.
- The local Node 22.12 smoke used the previously documented keep-alive wrapper with five-second fetch timeouts. A sandboxed HTTP attempt was denied by local network restrictions; the authorized unrestricted test process passed. No real operator database or .env was read.

No source commit/push, image publication, live VPS operation, proxy configuration or ChatGPT connection was performed. Old published images do not acquire the new script from a source-only pull; an image containing this change is required.

## Stale proposal reconciliation

Date: 2026-11-12. Decisions and user steps are recorded in proposal-rebase-plan.md. Generation creates a new pending proposal with a supersession link; application remains a separate authenticated web confirmation.

- npm run check passed formatting, strict TypeScript, all 131 tests across 12 files and production build. Fifteen new service cases and one HTTP case cover three-way field comparison, both conflict choices, missing/duplicate/extra resolutions, legacy bases beyond 100 audit events, missing/deleted targets, changed deletions, create-only remainders, empty results, schema/reference/duplicate validation, preview/confirmation races, idempotency, supersession rollback and session/CSRF isolation.
- npm run test:e2e passed all 11 isolated Chrome scenarios. Five new real-backend flows cover legacy nonconflicting reconciliation/cancellation, conflict selection and live merged preview, changed-preview refresh, interrupted-response stable retry, changed deletion retention, missing-base/deleted-target blockers and a retry after another window confirms the replacement. Existing account, OAuth, CRUD and undo checks remain green.
- Inspected mobile conflict and desktop confirmation screenshots. The mobile page has no horizontal overflow; dialog actions remain reachable. Final diff review and whitespace checks passed. No database migration is needed: new base snapshots and links use optional request JSON properties.
- The initial sandboxed aggregate check could not connect to temporary localhost services (EACCES); rerunning with local network access passed. Browser tests used a fresh temporary workspace database plus separate in-memory reconciliation databases. No normal user database or operator .env was read.

Text conflicts are whole-field selections. Unavailable historical bases/deleted targets block automatic reconciliation; combined invalid dates or references prevent generation without changing the original request. Container smoke was not rerun for this application-only feature. No source commit/push, image publication or live deployment was requested or performed.

## Direct MCP edits and deletes

Date: 2026-11-13. The owner's instruction supersedes per-batch MCP human confirmation. See mcp-direct-writes-plan.md for scope and compatibility decisions.

- npm run check passed formatting, strict TypeScript, all 136 tests across 12 files and production build.
- Official-SDK local-token and OAuth integration verifies immediate updates/deletes, mixed-batch atomic writes, replay/status, destructiveHint=true and no fabricated human confirmer. Scope-denied mixed requests, stale revisions and reference errors leave data/history unchanged.
- Service regressions verify informational existing-project duplicates versus pending duplicate creations, historical pending MCP replay/reconciliation and rollback of entities/audit/request when request persistence fails. Existing web confirmation, undo and reconciliation tests remain green with web proposal fixtures.
- npm run test:e2e passed all 12 Chrome scenarios. The new SDK/browser flow checks direct create/update/delete, refreshed task display, no pending request, MCP history and web-confirmed undo. Updated OAuth consent/account text and existing web/account/reconciliation flows passed.
- The initial sandboxed targeted HTTP tests hit localhost EACCES; the rerun with local network access passed. Tests used temporary/in-memory databases. Final diff and whitespace review passed.

Existing hub:propose grants now permit direct edits/deletes. Historical pending requests are not automatically applied. Browser/manual proposals and undo still require web confirmation; new duplicate-project creation still keeps a whole batch pending. Clients may independently require tool confirmation. Container smoke and live client connection were not rerun; no commit/push, image publication, deployment or persistent external access was performed.
