# Project Overview

Zhixu (知序), originally Project Release Hub, manages personal software projects through a web interface and MCP tools. The name reflects ordered planning and progress across projects and releases. Existing technical identifiers remain compatible.

## Confirmed scope

- Projects with one environment each.
- Concrete feature development plans, tasks, issues, versions, and release tracking.
- Home-page feature and environment summaries.
- Explicit, read-only GitHub Actions refresh.
- ChatGPT performs repository analysis; this application stores structured results.
- Direct new-record writes, project duplicate clarification, human-confirmed edits/deletes, audit, and undo.
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

The user explicitly requested that Compose and the update script use the project-root .env. Both now forward the documented GitHub/MCP/OAuth settings, with shell precedence and fixed container storage/port/bind settings. The updater rechecks resolved configuration before replacement and verifies the running container environment without including secrets in its state or output. This supersedes the original blanket environment-override restriction; it does not provision a live VPS, proxy, domain or ChatGPT connection.

The subsequent failed-update follow-up adds --retry: after correcting .env, the updater recreates the pending candidate and repairs the selected-image overlay itself. It preserves the original backup and successful record until health verification completes. --recover remains verification-only; manual edits to deployment journals are unnecessary.
