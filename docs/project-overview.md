# Project Overview

Zhixu (知序), originally Project Release Hub, manages personal software projects through a web interface and MCP tools. The name reflects ordered planning and progress across projects and releases. Existing technical identifiers remain compatible.

## Confirmed scope

- Projects with one environment each.
- Concrete feature development plans, tasks, issues, versions, and release tracking.
- Home-page feature and environment summaries.
- Explicit, read-only GitHub Actions refresh.
- ChatGPT performs repository analysis; this application stores structured results.
- Direct MCP additions/edits/deletes, duplicate-project creation clarification, web-confirmed manual edits/deletes, audit, and undo. The 2026-11-13 instruction supersedes the original MCP confirmation requirement.
- SQLite for the first version.
- Reuse existing form validation components.
- Chinese UI/conversation and English engineering documentation/comments.

## Current state

The local MVP is implemented and verified. Manual management, read-only Actions, and local MCP are available. Remote ChatGPT connectivity is not provisioned. The user authorized development with: 好的，其他的交给你了，正式开始推进.

The repository also contains automatic checks and a guarded, manual private-image publication workflow following Zhijiao. Container packaging is for local use. The user later authorized source commit/push to the public zcorw/project-release-hub repository; image publication and deployment remain outside that authorization. See github-actions.md and naming-and-ci-plan.md.

## Delegated defaults

React/TypeScript, Node/TypeScript, simple single-user login, basic tests, and local-only delivery follow the proposed MVP direction. Radix Dialog and React Hook Form/Zod reuse actual patterns from tts-workbench. These are implementation decisions, not claims that the user separately selected every package.

## Non-goals

Remote deployment, GitHub writes or workflow triggers from inside the application, repository analysis AI, and multi-user accounts are not part of this version. Later authorized account/OAuth work adds optional HTTPS authentication; see account-oauth.md for behavior and live verification limits.

See mvp-development-plan.md, stage records, project-conventions.md, and TODO.md for decisions and verification.

## Account and OAuth follow-up

The user requested native account completion and MCP OAuth without nest-account, then authorized source push after completion. Existing owner/data/passwords are preserved. Persistent sessions, password changes, security controls and optional HTTPS OAuth are implemented. A real ChatGPT connection and deployment are not provisioned.

## Compose and VPS environment follow-up

The user explicitly requested that Compose and the update script use the project-root .env. Both now forward PORT and the documented GitHub/MCP/OAuth settings, with shell precedence and fixed container storage/bind settings. PORT selects the app listening port and matching loopback host/container mapping, defaulting to 4310. The updater rechecks resolved configuration before replacement and verifies the running container environment without including secrets in its state or output. This supersedes the original blanket environment-override restriction and fixed-port decision; it does not provision a live VPS, proxy, domain or ChatGPT connection.

The subsequent failed-update follow-up adds --retry: after correcting .env, the updater recreates the pending candidate and repairs the selected-image overlay itself. It preserves the original backup and successful record until health verification completes. --recover remains verification-only; manual edits to deployment journals are unnecessary.

## Local administrator initialization follow-up

The user requested a short command to create the initial administrator inside the VPS Docker container. npm run init-admin now hides and confirms terminal input, reuses shared validation/hashing and atomically creates the missing owner with a security event. It refuses existing accounts and works while remote web setup stays disabled. The running app recognizes the account without restart. Stdin automation is explicit. This is local source implementation; source/image publication and live VPS operations are not included. See admin-initialization-plan.md and account-oauth.md.

## Stale proposal reconciliation follow-up

The user requested rebasing stale proposals onto latest records while preserving applied changes, choosing conflicts and retaining final web confirmation. The implementation uses field-level three-way comparison, historical-base recovery, snapshot-bound previews and atomic linked pending replacements. Generating a replacement never applies records, including create-only remainders. Missing bases/deleted targets block reconciliation; text is resolved as a whole field. See proposal-rebase-plan.md for decisions, operator steps and verification. After verification, the user authorized a separate source commit and normal push on the existing working branch; no merge, image publication or deployment is included.

## Direct MCP edits and deletes follow-up

The user requested removing mandatory human participation for MCP updates/deletes. New authorized MCP batches apply directly, including mixed creates/updates/deletes, while retaining validation, scopes, revisions, atomicity, replay, audit and recoverable deletion. Duplicate clarification gates only newly created projects; existing-project edits are not blocked by similarity. hub:propose retains its identifier and now authorizes direct edits/deletes for existing grants. Web proposals, reconciliation replacements, undo and historical pending requests retain their review behavior. See mcp-direct-writes-plan.md for the superseding decisions. After verification, the user authorized a separate source commit and normal push on the existing working branch. No image publication or deployment is included.
