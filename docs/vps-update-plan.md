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
