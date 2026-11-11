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
