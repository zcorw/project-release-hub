# Project card introduction

[English](project-card-introduction.md) | [简体中文](project-card-introduction.zh-CN.md)

## Confirmed requirement

Zhixu task `84ddc9b8-cddd-4b87-9dab-7b825f093976` requests that the text below each home-page project name show the project introduction, without task logs, commit/test/deployment updates, or removal of existing history and progress information.

## Implementation decisions (2026-11-17)

- Add an explicit project `summary` field (trimmed, up to 500 characters), editable through the existing shared Web/API/MCP contract. This is an implementation default chosen to separate introductions from the existing mixed-purpose `description`.
- Cards display only `summary`, or `暂无项目简介` when empty. Do not guess an introduction by truncating or filtering historical descriptions.
- Preserve `description`, work items, progress, audit snapshots and request payloads. Project details continue to expose the full description.
- Keep the wire field optional so legacy request hashes remain stable. Omitted fields in old-client updates preserve an existing summary; an explicit empty string clears it. Legacy projects have an empty summary until explicitly supplied. No production backfill is included.
- Retain existing Web proposal/confirmation, MCP authorization, revisions, replay and undo rules. No new service or database table is needed.

## Verification and delivery

Verification passed: `npm run check` (formatting, strict TypeScript, 178 unit/integration tests across 18 files, production build) and `npm run test:e2e` (18 Chrome scenarios, including three new real-backend introduction flows). Coverage includes legacy persistence/replay and updates, explicit clearing, validation, audit/undo/reconciliation, real HTTP/MCP reads and writes, and browser card/edit/detail behavior with preserved progress and a narrow viewport. Desktop/mobile screenshots and an independent diff review passed. Old-client proposal previews now show the preserved introduction consistently with the actual update.

Windows checkout initially converted unchanged source files to CRLF and blocked Prettier. Repository attributes now retain LF for text, with no semantic changes to those otherwise untouched files. The first sandboxed browser run stalled during local-service startup and was stopped; the complete checks passed with temporary local-process/network permission. Tests used isolated databases, not production data.

After local verification, the user authorized a source commit, push and pull request targeting main. Delivery uses feat/project-card-introduction. This requests review/merge; it does not perform the merge, publish an image, deploy or rewrite production data. Remote delivery results are verified separately.
