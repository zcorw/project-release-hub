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

## Failed-update retry follow-up (2026-11-12)

The operator reported that a corrected .env could not be applied through the updater while an unhealthy pending attempt existed. The existing --recover only verifies a container, and a normal update correctly refuses to discard an unfinished journal. Recommending manual edits to selected-image.json leaves the recovery workflow incomplete.

Decisions recorded before implementation:

- Add an explicit --retry mode under the existing host-wide lock. Read the candidate image ID from pending-update.json, validate its local image and volume, then recreate app with the current reviewed .env. Rewrite the image overlay automatically from that record; do not select a different image, build, pull or restore SQLite.
- Accept only the pending candidate or its recorded predecessor as the existing container. Reject unrelated container/image changes, missing persisted data volumes and missing required backups. A first-install retry may proceed without a preexisting backup only when its journal has no predecessor or prior successful installation.
- Back up a running container before retry. Preserve the original pre-update backupPath; track any fresh retry backup separately. A stopped/missing container requires a retained backup except for a genuine first-install journal.
- Recheck source, configuration and container identity before replacement. Persist retry metadata before recreating; only matching image, environment, volume and healthy status can advance latest-image.json. Failure keeps the journal and backups.
- Keep --recover as verification only and retain the guard on starting an unrelated update while pending. Document --retry as the supported configuration-repair path. Implementation and isolated tests are in scope; no live VPS operation or remote publication is performed by this change.

## Configurable deployment port follow-up (2026-11-12)

The operator reported that .env PORT was still ignored because Compose and the updater pinned 4310. The implementation must now honor that setting as well. This supersedes the earlier fixed-port decision while preserving loopback publication, the fixed container bind address and SQLite directory.

Decisions recorded before implementation:

- Resolve PORT from the normal Compose .env/shell inputs, defaulting to 4310. Use the same port for the application environment, container target and host publication. Keep the host address at 127.0.0.1 and require an integer from 1024 through 65535.
- Keep HUB_BIND_HOST=0.0.0.0 and HUB_DATA_DIR=/app/data fixed inside Docker. An image's default port/EXPOSE metadata does not override Compose; the existing healthcheck already reads runtime PORT.
- Apply the configured port in normal updates and pending --retry operations. Verify environment and mapping consistency without blocking replacement of an old container that used the previous port.
- Test default/custom/invalid ports, mapping mismatches, configuration changes during retry and actual isolated container startup/health at a custom port. The operator must update any existing Nginx upstream to the chosen host port; this task does not modify a real proxy or VPS.
