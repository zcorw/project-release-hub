# Zhixu (知序) Development TodoList

## Project Summary

Build a local-first web MVP for personal project features, concrete development plans, tasks, issues, versions, and release tracking. Manual and MCP operations share validation, persistence, and audit rules.

## Source Documents Reviewed

- AGENTS.md: staged discovery and publication constraints.
- docs/project-overview.md: original product intent.
- docs/architecture.md: shared business-service direction.
- docs/project-conventions.md: distinction between completion and deployment.
- docs/stage-setup-language.md: original setup questions, now superseded by the latest conversation.
- docs/mvp-development-plan.md: current requirements, proposals, and verification goals.

## Key Requirements

Concrete feature plans, single-environment project summaries, manually refreshed read-only GitHub Actions, direct MCP additions, duplicate clarification, human-confirmed edits/deletes, audit, undo, SQLite, and English engineering documentation.

## Questions / Assumptions

See docs/mvp-development-plan.md. The UI/form stack reuses verified Radix Dialog and React Hook Form/Zod patterns from existing local projects. No remote access or deployment is included.

## Development TodoList

- [x] T001 [P0] Reconcile discovery and implementation decisions
      Goal: Record current requirements, chosen defaults, and stage evidence without inventing approval.
      Modules: docs/, TODO.md, ui-static/.
      Depends on: None.
      Verify: Review every stage record and outstanding confirmation gate.
- [x] T002 [P0] Create the application foundation and SQLite data layer
      Goal: Start the app locally and persist validated records.
      Modules: package.json, server/, shared/, tests/.
      Depends on: T001.
      Verify: Type checking and persistence/restart tests.
- [x] T003 [P0] Implement safe shared write workflows
      Goal: Support atomic additions, duplicate review, pending edits/deletes, audit, and guarded undo.
      Modules: server/application/, server/domain/, tests/.
      Depends on: T002.
      Verify: Domain tests for atomicity, idempotency, confirmation, references, and conflicts.
- [x] T004 [P0] Build authenticated manual project management
      Goal: Show project summaries and create/manage projects, features/plans, tasks, issues, and releases.
      Modules: web/, server/http/.
      Depends on: T003.
      Verify: Login, empty state, forms, cancel/retry, confirmation, and history checks.
- [x] T005 [P1] Add explicit read-only GitHub Actions refresh
      Goal: Store and display the latest workflow facts without triggering workflows or changing release status.
      Modules: server/integrations/, web/.
      Depends on: T004.
      Verify: Mocked GitHub success, authentication failure, rate-limit, and network-error tests.
- [x] T006 [P1] Add MCP tools using the shared application service
      Goal: Support discovery/read and idempotent batch additions; stage destructive changes for web confirmation.
      Modules: server/mcp/, docs/.
      Depends on: T003.
      Verify: Protocol tests and assertions that MCP cannot approve its own changes.
- [x] T007 [P0] Verify and document local delivery
      Goal: Deliver a working local MVP with startup, backup/recovery, and limitation documentation.
      Modules: README.md, docs/, tests/.
      Depends on: T004, T005, T006.
      Verify: Run all type checks, tests, production build, and relevant UI checks against final files.

- [x] T008 [P1] Name Zhixu and add guarded GitHub Actions workflows
      Goal: Apply the product name and adapt Zhijiao checks/manual GHCR publishing without publication.
      Modules: UI, docs, .github/, container files, runtime configuration, and tests.
      Depends on: T007.
      Verify: Aggregate checks, browser branding, container safety, and workflow review.

- [x] T009 [P1] Add a verified VPS image update helper
      Goal: Build or select immutable images after source updates, preserve and back up SQLite, and record only verified successful updates.
      Modules: scripts/update-vps.*, tests/test_update_vps.py, docs/, and check workflow.
      Depends on: T008.
      Verify: Linux lock/failure regression tests, aggregate checks, Compose configuration, and container/browser smoke checks. No live VPS deployment.

## Acceptance Criteria

All implemented features are described accurately; checks distinguish pass/fail/not run; no push, publication, deployment, or secrets in source.

## Suggested Execution Order

Execute T001 through T007 in order, reviewing one task at a time. T005 and T006 may be verified independently after their dependencies are complete. Do not commit without authorization and the required review gates.

## Account and MCP OAuth follow-up

- [x] T010 [P0] Complete native single-owner accounts and MCP OAuth
      Goal: Preserve data/passwords; add persistent/revocable sessions, canonical HTTPS, consent, PKCE, scopes, credential rotation and revocation.
      Modules: server/http, server/oauth, server/mcp, web, tests and docs.
      Verify: Aggregate checks, migration/session/proxy/CSRF tests, OAuth + official SDK integration, isolated Chrome account flows.
      Publication: Normal source commit/push authorized after completion. No deployment.

## Compose and VPS environment follow-up

- [x] T011 [P0] Pass project-root .env settings through Compose and the VPS updater
      Goal: Apply GitHub/MCP/OAuth configuration during first install and immutable-image updates while preserving SQLite storage, loopback ports and secret handling.
      Modules: compose.yml, scripts/update-vps.py, tests, .env.example and operator docs.
      Verify: Real Compose resolution, updater environment/failure regressions, aggregate checks, affected browser flows and available isolated container checks.
      Publication: Source commit/push authorized after verification. No image publication or live VPS operation requested.

## Failed VPS update retry

- [x] T012 [P0] Retry a pending image after repairing environment configuration
      Goal: Recreate the recorded candidate through the updater without manual state edits, preserve backups, and verify before recording success.
      Modules: scripts/update-vps.py, tests/test_update_vps.py and operator docs.
      Verify: Healthy/unhealthy retry, repaired environment, stale overlay, running/stopped/missing containers, first install, backup/volume/image guards, configuration drift and isolated checks.
      Publication: Separate source commit and shared-branch push authorized. No live VPS operation or image publication requested.

## Configurable deployment port

- [x] T013 [P0] Honor .env PORT in Compose and VPS updates
      Goal: Use the selected port for application listening and loopback host publication, including pending retries, with validated defaults and persistent data preserved.
      Modules: compose.yml, scripts/update-vps.py, tests, .env.example and operator docs.
      Verify: Default/custom/invalid port resolution, mismatched mapping rejection, normal update/retry and real isolated custom-port startup/health.
      Publication: Separate source commit and shared-branch push authorized. No live VPS/proxy operation or image publication requested.
