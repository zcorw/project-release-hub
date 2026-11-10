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

## Acceptance Criteria

All implemented features are described accurately; checks distinguish pass/fail/not run; no push, publication, deployment, or secrets in source.

## Suggested Execution Order

Execute T001 through T007 in order, reviewing one task at a time. T005 and T006 may be verified independently after their dependencies are complete. Do not commit without authorization and the required review gates.
