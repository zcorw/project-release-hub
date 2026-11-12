# Development Execution Log

## Step 1: Discovery and plan

Scope: requirements, stages, static preview, and TODO.
Result: English stage records and a Chinese static preview were created; explicit requirements and delegated implementation defaults are separated.
Review: PASS. All stages were recorded before implementation, following the user's authorization to handle remaining details.

## Step 2: Foundation

Scope: package/config files, shared schema, SQLite repository, foundation tests.
Result: created the React/TypeScript and Express/TypeScript foundation.
Validation: typecheck, two persistence/transaction tests, and production build passed.
Review: PASS. Latest SQLite adapter was incompatible with the installed Node runtime; pinned 11.10.0 works.

## Step 3: Shared mutation workflow

Scope: domain rules, application service, mutation tests.
Result: atomic batches, idempotency, duplicate review, confirmation, revisions, audit, and undo.
Validation: 15 tests passed at the checkpoint.
Review: PASS. A read-only independent review found no actionable safety bugs in the reviewed core/auth scope.

## Step 4: Authenticated manual UI

Scope: HTTP/auth, frontend, and browser workflow.
Result: Chinese dashboard and all management forms, pending reviews, history, setup/login, CSRF.
Validation: 22 backend tests passed, typecheck/build passed, and a full automated Chrome workflow passed on an isolated database.
Review: PASS. Uncertain-submit IDs survive modal close/reopen; the UI does not offer blind undo approval without a visible audit snapshot.

## Step 5: Read-only GitHub Actions

Scope: GitHub adapter and fixture tests.
Result: explicit GET refresh, bounded results, safe links, retained successful cache, and error messages.
Validation: 30 tests passed at the checkpoint. No real token or private repository was used.
Review: PASS. CI results do not mutate deployment/release state.

## Step 6: MCP

Scope: official SDK transport, bounded read tools, batch proposals, request recovery.
Result: local bearer-authenticated endpoint; no approval tools.
Validation: 35 tests passed, including a real official SDK client connection.
Review: PASS. Remote ChatGPT connection remains out of scope and is documented.

## Step 7: Delivery

Scope: documentation, backup tooling, final validation, local launch.
Result: startup, MCP, limitations, password reset, and backup/recovery documentation completed. Online backup and overwrite refusal tested. Final validation: formatting, strict TypeScript, 40 tests, production build, comprehensive Chrome workflow including uncertain retry recovery, and production dependency audit all passed. Review: PASS. The reviewed in-flight GitHub cache race was fixed and regression-tested. No commit or publication was performed.

## Step 8: Zhixu branding and guarded repository workflows

Scope: product naming, UI/static preview, documentation, automatic/reusable checks, manual private GHCR publishing, and local container packaging.

Result: applied 知序 (Zhixu) while preserving technical identifiers. Adapted the local Zhijiao workflow model to SQLite, browser tests, and a non-root container. Publication requires a matching IMAGE_PUBLISH_REPOSITORY variable, a private repository, the default branch, successful checks, and an unused commit tag. It only uses the automatic GITHUB_TOKEN and records an immutable digest; it never deploys.

Validation: formatting, TypeScript, 45 tests, production build, complete local Chrome scenario, inspected desktop/mobile screenshots, Compose validation, Linux image build, and isolated container security/persistence smoke test passed. Static review's custom-port healthcheck issue was fixed and covered by the smoke test. Hosted Actions and GHCR publication were not run.

Review: local implementation checks passed. The existing checkout remains uncommitted with no remote; no persistent external access or repository settings were changed. See github-actions.md for activation prerequisites and verification.md for limits.

## Source publication authorization

After local verification, the user authorized committing and pushing the completed source to https://github.com/zcorw/project-release-hub. The existing destination was verified empty, public, and writable; its reported default branch was main. The local commit convention requires a feature branch, so source delivery uses feat/zhixu-workflows. A source-only scan of all 67 candidate files found no database, backup, log, private key, token, credential URL, or personal machine path. The public destination does not satisfy the private GHCR publication gate. No visibility, variables, secrets, package publishing, or deployment changes are included. Push and hosted CI results must be verified separately.

## Step 9: Verified VPS image update helper

Scope: scripts/update-vps.sh and its Python standard-library implementation, isolated regression tests, private ignored state, English operator/recovery documentation, and the Ubuntu checks workflow.

Result: local VPS builds by default, optional immutable-digest pulls, actual Docker image-ID pinning, SQLite online backup plus private host copy, fixed named-volume/loopback guards, and health-gated atomic latest-image.json records. Failed or interrupted replacement retains a pending journal; explicit recovery reverifies the candidate. Explicit image-only rollback preserves the database and backup references without automatically reversing schema changes. The updater does not log into servers, publish packages, or enable public access.

Review: PASS after fixing absent-container/persisted-volume backup bypass, preserving interrupted rollback backup references, ignoring updater state before the clean-tree check, and using a host-wide Linux lock. Independent read-only review found no remaining blocking defect in those paths. Manual Docker changes are outside the lock and are prohibited concurrently. Atomic replacement covers process interruption; power-loss durability is not claimed.

Validation on 2026-11-10: 21 updater regressions passed in a networkless Python 3.12 Linux container with the repository mounted read-only, including actual flock contention. The Windows Python run passed 20 tests and skipped the Linux-only lock test. Bash syntax, CLI help, ignored-state checks, Compose configuration, npm run check (formatting, TypeScript, 45 application tests, production build), the existing disposable Linux container smoke test, and the complete isolated Chrome workflow passed. Container smoke used the previously built zhixu:ci image because application/runtime image inputs were unchanged by this task. No live VPS upgrade, registry publication/pull integration, or full real-Docker updater replacement is claimed; updater command/failure coverage uses a fake Docker adapter. Hosted CI for the eventual source commit must be checked separately.

The user subsequently authorized committing and pushing this script work to the existing source remote. Only this task's source/tests/docs/configuration are included; parallel account/OAuth changes remain separate. No deployment or image publication is included.

## Step 10: Native accounts and MCP OAuth

Scope: additive SQLite account/session migration, account security UI, canonical HTTPS/proxy/Origin handling, OAuth provider, MCP scope enforcement, isolated tests, and operator docs. The user chose not to use nest-account and explicitly authorized source push after completion.

Result: existing single-owner password/data retained; persistent bounded sessions, password change and revocation, protected remote initialization, explicit consent, S256 PKCE, resource-bound hashed credentials, refresh rotation/replay revocation, grants/security audit, and read/create/propose scopes. MCP still cannot approve its own updates/deletes. Reconsent replaces prior client authority rather than leaving hidden broad tokens active.

Validation: npm run check passed with 97 tests, six Chrome scenarios passed including real OAuth callback and account-security flows, and a freshly built disposable Linux container passed smoke checks. Independent source review's confirmed scope-display issue was fixed and reproduced as resolved. Browser verification fixed same-origin form Origin/referrer and cross-origin callback CSP handling. See verification.md for the local Node smoke-harness workaround and unrun live checks.

No real account/data migration, domain/proxy/firewall change, ChatGPT connection, or deployment was performed. The existing VPS updater remains loopback-only and rejects remote overrides. New source is intended for an authorized normal push, without force or automatic merge/deployment.

## Step 11: Private GHCR publishing from public source

Date: 2026-11-11. The user approved removing the remaining source-repository variable/private-visibility gates, updating deployment documentation, and committing/pushing the changes. Their existing removal of the repository-name comparison was preserved. This supersedes the original private-source gate recorded in Steps 8-9 and the source-publication notes.

The workflow still requires manual dispatch on the default branch and complete checks. Image/package names follow the executing repository; existing packages must be private, existing commit tags are refused, and no package visibility change or deployment is performed. All six JavaScript Actions were updated to official Node 24 versions without changing application Node 22. The operator guide now covers public source/private images, copied repositories, and authenticated immutable-digest pulls.

Validation: independent static review found no blocking issue. Local aggregate checks, all six Chrome scenarios, the Windows updater suite, Compose configuration, and 18 isolated workflow syntax/target/privacy/tag checks passed; see verification.md for exact coverage and limits. No GHCR login, package publication, workflow dispatch, or live VPS operation was performed. Source delivery uses a feature branch from current origin/main; hosted CI must be checked for the pushed commit separately.

## Step 12: Compose and VPS .env integration

Date: 2026-11-11. The user explicitly requested that compose.yml and the updater consume the operator's .env. Decisions were recorded in vps-update-plan.md before implementation. This supersedes the original blanket runtime-environment rejection in Steps 9-10; actual VPS operation and source/image publication were not requested.

Result: Compose forwards only the documented GitHub/MCP/OAuth settings from .env or the shell, while pinning container port, bind address and SQLite path. The updater explicitly selects the checkout's .env (or an empty file when absent), allows those keys, rechecks resolved configuration before replacement and verifies effective environment before declaring health/recovery success. Status exposes only environmentMatches. Secret values stay out of commands, overlays, journals, success records and status output. Compose's serialized dollar escaping is decoded for accurate comparison with Docker inspect. Operator docs and .env.example now explain the supported path and unused-variable handling.

Validation: aggregate application checks passed with 97 tests and production build; all six isolated Chrome scenarios passed. The 32-case Python suite passed 31 cases on Windows including real Compose/container environment checks, with the Linux-only lock case skipped; a networkless Linux container passed the 27 updater cases including that lock and skipped the five Docker-CLI-dependent cases. The newly built Linux image passed the existing container smoke using the previously documented Node 22.12 event-loop/HTTP-timeout wrapper. Bash syntax, workflow formatting and diff checks passed. CI now also checks injection into UUID-named disposable Compose containers after its image build.

Review: PASS after reviewing environment resolution, fixed storage/network settings, configuration drift, secret-free failure/success records and recovery behavior. Test fixtures did not read an operator .env or open real user databases. No source commit/push, GHCR publication, live VPS operation, Nginx configuration or ChatGPT connection was performed.

After the implementation and verification report, the user authorized committing and pushing this .env integration to the existing zcorw/project-release-hub remote. Delivery reuses the current non-protected fix/private-ghcr-workflow branch, with a normal Conventional Commit and push. No merge, image publication or live VPS operation is included; remote delivery results are verified separately.

## Step 13: Retry a pending update after configuration repair

Date: 2026-11-12. The operator reported an unhealthy candidate caused by incorrect environment settings and questioned why applying a correction required manual image-selection edits. The missing retry path was recorded in vps-update-plan.md before implementation. This change adds a supported recovery operation without discarding the pending journal or weakening its existing update guard.

Result: --retry reads and validates the pending candidate, applies current .env through the existing Compose path and regenerates the overlay automatically. It runs under the host-wide lock, checks data-volume and backup availability, accepts only the recorded candidate/predecessor, rechecks source/configuration/container/journal identity and records success only after image/environment/volume/health verification. A running candidate is backed up again; retryBackupPath tracks the fresh snapshot while backupPath preserves the pre-update snapshot. Stopped/missing candidates use a retained backup, with a bounded exception for a genuine failed first installation. Retry performs no build, pull or database restore. --recover remains verification-only.

Validation: the 48-case updater suite passed 47 cases on Windows including actual Compose/container environment checks and skipped Linux flock; a networkless read-only-mounted Linux container passed all 43 updater/retry cases including flock and skipped the five Docker-CLI-dependent cases. All 97 application tests, production build and six isolated Chrome flows passed. CLI help exposes the mutually exclusive --retry mode; Bash syntax, formatting and diff checks passed. The 16 new regressions cover configuration repair, stale overlays, repeated failures, retained/fresh backups, first install, stopped/missing candidates, unrelated images, source/configuration/journal/container changes and blocked backup operations.

Review: PASS. The previous manual-edit advice is superseded by --retry. No operator .env, live VPS, actual user database, image publication or remote source write was used for this follow-up.

After verification, the user authorized a separate Conventional Commit for this retry change and a normal push on the existing working branch. Image publication and live VPS operations remain outside that source-delivery authorization.

## Step 14: Honor the configured application port in Docker

Date: 2026-11-12. The operator reported that PORT in .env remained ineffective. Compose still supplied a literal 4310 and the updater required a 4310:4310 mapping. Decisions were recorded before implementation; this follow-up supersedes that earlier fixed-port default while preserving loopback publication and fixed SQLite storage.

Result: Compose resolves PORT from .env/the shell, defaults to 4310 and uses it for app listening plus both ends of the 127.0.0.1 mapping. The updater checks the supported 1024-65535 range and mapping consistency, includes PORT in environment verification and reports configuredPort. An image's default PORT/EXPOSE metadata no longer determines deployment port. Existing images work because the application's config and image healthcheck already read runtime PORT. Pending --retry can move the candidate from its old port to the corrected one. Operator docs explain that an existing Nginx upstream must follow the selected port; no real proxy was changed.

Validation: the 52-case updater/configuration suite passed 51 tests on Windows and skipped Linux flock. A networkless Linux container passed the 45 updater/retry cases including flock and skipped seven Docker CLI/container cases. Real Compose tests verified shell/file precedence and matching ports; a UUID-named isolated container actually started at a dynamically selected non-default port, passed Docker health and returned HTTP 200 from /api/health, then its resources were removed. Default behavior, invalid ports, mismatched mappings and port changes during pending retry also passed. Aggregate checks (97 application tests and production build), all six Chrome flows, formatting and diff checks passed.

Review: PASS. Neither user .env contents nor live VPS data were accessed. The retry and configurable-port changes remain local source work; no commit/push, registry publication or live deployment was performed.

After verification, the user authorized a separate Conventional Commit for the port change, following the retry commit on the same working branch, and a normal push to the existing remote. Remote delivery results are checked separately; no merge into the default branch, registry publication or VPS operation is included.

## Step 15: Initialize the administrator inside the container

Date: 2026-11-12. The user requested a short script for the VPS Docker container instead of a long inline initialization command. Scope and implementation decisions were recorded in admin-initialization-plan.md before generating code.

Result: npm run init-admin uses the current HUB_DATA_DIR/hub.db and requires an existing application database. Default terminal input hides and confirms the password; explicit --password-stdin supports controlled automation without password arguments/environment variables. Shared validation and scrypt hashing are reused. Account insertion and the account_created event share a transaction; preflight and insertion guards refuse an existing owner, including a stale preflight read. Failures and cancellation leave the account absent; no secret is echoed. HTTPS/OAuth may already be enabled and remote web setup remains disabled. Refreshing the running app recognizes the account without restart. Docker's build allowlist includes both new files, and the forgotten-password tool points an absent owner to the new command.

Validation: aggregate checks passed formatting, strict TypeScript, all 115 tests and production build; all six isolated Chrome flows passed. Eighteen new regressions verify validation/confirmation, hashing/audit, preserved records, existing-owner/race protection, audit rollback, real CLI subprocess use, missing database/help, non-TTY/stdin/error behavior and hidden/cancelled terminal input. A live HTTPS app accepted the CLI-created account without restart while refusing remote setup. A fresh Linux image passed non-root/read-only smoke, real pseudo-terminal cancellation/mismatch/hidden confirmation, stdin initialization, refusal to overwrite and immediate login, plus existing container startup/persistence checks. Temporary resources were removed; the local Node 22.12 test harness used its documented bounded-fetch keep-alive wrapper.

Review: PASS after inspecting secret handling, transaction boundaries, database targeting, TTY restoration and Docker packaging. Documentation includes the host/container commands and the image-version requirement. No source commit/push, image publication or live VPS operation was requested or performed.

After verification, the user explicitly included the administrator initialization script, its tests and operator documentation in the authorized source commit/push. Delivery uses a separate Conventional Commit on the existing working branch. No image publication or live VPS operation is included.

## Step 16: Reuse the generated Zhixu icon as the favicon

Date: 2026-11-12. Confirmed request: use the selected ChatGPT plugin icon as the website icon. Implementation defaults recorded before changes: reuse assets/branding/zhixu-plugin-icon.png without altering its artwork, reference it from the HTML favicon link so Vite includes a fingerprinted asset, and allow only that PNG through the Docker build context. Existing unrelated work remains outside this change.

Result: index.html now declares the selected PNG as the favicon. Vite emits a fingerprinted PNG and rewrites the production link; the Docker build allowlist includes the original image without admitting its generation prompt or unrelated assets.

Validation: npm run check passed formatting, strict TypeScript, all 115 tests and production build. The initial sandboxed run failed on local HTTP connections with EACCES; the unrestricted rerun passed. All six existing isolated Chrome flows passed. A separate one-off Chrome check used an in-memory database and temporary local development/production servers: both pages returned the expected title and an image/png favicon with HTTP 200, the browser decoded it as 1254 x 1254, and its bytes matched the original artwork. The production URL contains the generated asset fingerprint. Final formatting and diff checks passed. Docker image build/container smoke were not rerun for this asset integration.

Review: PASS for the HTML reference, production asset and Docker allowlist. No persistent user data, source commit/push or deployment was involved.

After verification, the user authorized committing and pushing the favicon integration and generated branding assets to the existing remote on the current working branch. This is separate from the administrator initialization commit; no merge, image publication or deployment is included.

## Step 17: Reconcile stale proposals in the browser

Date: 2026-11-12. Confirmed request: generate a fresh proposal from current records, preserve previously applied edits, let the user choose conflicts and retain final web confirmation. Scope and merge semantics were recorded in proposal-rebase-plan.md before implementation. T016 is complete.

Result: new proposals retain base snapshots; old proposals recover bases from complete audit history. Base/current/proposed comparisons preserve nonconflicting fields and require explicit choices for field conflicts or changed deletion targets. Read-only previews bind generation to target snapshots. Generation reuses shared schema/domain validation, remains atomic/idempotent, supersedes the original with links and always creates a pending replacement, including create-only remainders. The normal confirmation still checks revisions and newly discovered duplicates. Missing bases/deleted targets cannot be silently overwritten. No MCP approval/reconciliation capability was introduced.

The existing dialog now offers 基于最新记录重新合并, displays original/latest/proposed conflict values and a merged preview, and opens the standard review after generation. Preview races require explicit refresh/reselection; interrupted generation retries preserve the request ID. If another window already applied or rejected the replacement, retry shows that final status instead of claiming it is still pending. Canceling before generation changes nothing.

Validation: npm run check passed formatting, strict TypeScript, all 131 service/integration tests and production build. npm run test:e2e passed all 11 Chrome scenarios, including five real-backend reconciliation scenarios. Mobile conflict and desktop confirmation screenshots were visually reviewed; whitespace/diff checks passed. The first sandboxed check hit localhost EACCES, and the run with local network access passed. Tests used temporary/in-memory databases, not user data.

Review: PASS after inspecting comparison semantics, historical lookup, atomic supersession, immutable/reference/schema/duplicate rules, preview and confirmation races, web-only auth/CSRF, retry outcomes and final UI. Text conflicts are resolved per whole field; unavailable bases/deleted targets and invalid combined constraints require manual adjustment. No commit/push, registry publication, persistent external access or live deployment was requested or performed.

After verification, the user authorized a separate Conventional Commit for stale proposal reconciliation and a normal push to the existing zcorw/project-release-hub remote. Delivery reuses fix/private-ghcr-workflow. The source implementation and verification are unchanged; only this authorization record is added. Remote delivery results are verified separately. No merge, image publication or deployment is included.
