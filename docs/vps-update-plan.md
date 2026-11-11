# VPS image update plan

## User request and boundary

The user requested a script under scripts/ to update a Docker image after code changes on a VPS and record the latest image. This authorizes implementation and tests, not connecting to a VPS, deploying, pushing source, publishing images, or changing network exposure.

## Implementation decisions

- Provide a Bash entry point with a Python 3 standard-library implementation for robust Docker JSON inspection, atomic state files, and argument-safe subprocess calls.
- Default to a local Docker build from a clean, committed checkout after the operator updates code. Do not run git pull or use GHCR implicitly. The current public repository does not meet the existing private-GHCR publication gate.
- Support an explicitly supplied immutable registry digest, or an explicitly selected local image ID for image-only rollback. Resolve every candidate to a Docker image ID and start that exact ID without a build or pull during replacement.
- Reuse the existing Compose project and named SQLite volume. Reject non-loopback publication, missing health checks, mismatched storage, dirty source, and ambiguous service instances. Never remove volumes or prune images.
- Take a consistent SQLite backup before replacing an existing container and copy it into the private host state directory. Keep the online backup's writer alive only until a successful snapshot has been copied. Preserve all backups; retention is an operator decision.
- Serialize updates with a Linux advisory file lock. Save an attempt journal before replacement, then replace latest-image.json atomically only after Docker health, image identity, and volume identity are verified. Interrupted/failed attempts retain a journal and do not advance the successful record.
- Do not automatically downgrade an image after a failed startup: the candidate may already have migrated SQLite. Provide an explicit image-only rollback command and report the backup/previous image. Never automatically restore a database. Verify application/schema compatibility before rollback.
- Keep the host port on 127.0.0.1. The script does not harden the MVP for public hosting or permit a public reverse proxy. Access a remote host through an independently arranged SSH tunnel.

## Verification

Use Python unit tests with a fake Docker adapter for success, build/pull/backup/start failures, immutable identity, storage safety, state-write failures, rollback, and concurrency. Include them in the Ubuntu checks workflow. Run the repository aggregate checks and existing browser/container checks where supported. A real VPS update is not part of verification.

## Environment support follow-up (2026-11-11)

Confirmed request: Compose and the VPS updater must consume the operator's project-root .env, including when an immutable GHCR image is selected. This supersedes the original blanket rejection of runtime environment configuration. Implementation/testing is authorized; source publication, image publication and operating a live VPS are separate actions.

Implementation decisions recorded before changes:

- Let Compose resolve its normal shell-over-.env precedence. Explicitly pass only GITHUB_TOKEN, HUB_MCP_TOKEN, HUB_PUBLIC_URL, HUB_SESSION_SECRET and HUB_TRUST_PROXY into the app. Leave unset optional variables absent, so existing images retain local-mode behavior. Unused optional settings should stay commented out.
- Pin container PORT=4310, HUB_BIND_HOST=0.0.0.0 and HUB_DATA_DIR=/app/data in Compose. Native settings in the same .env must not redirect SQLite or alter the reviewed loopback port mapping.
- Have the updater explicitly select the project-root .env when present and otherwise use an empty environment file. Keep explicit Compose files/project names and reject arbitrary container environment keys, entrypoints, commands, storage changes and public port bindings.
- Preserve existing application configuration validation, OAuth consent/scopes, local-token/remote-OAuth exclusivity and web-only confirmation. Remote configuration uses the already implemented HTTPS/proxy validation; privately initialize the owner before enabling OAuth.
- Capture resolved configuration in memory, recheck it before replacement and verify effective container configuration without writing secrets into records, overlays, logs or command arguments. Keep .env outside Git and build inputs.
- Verify real Compose resolution with disposable fixture files, updater failure/recovery regressions, application checks, browser account/OAuth flows and container checks when the local engine is available. No real operator .env or live VPS is needed.
