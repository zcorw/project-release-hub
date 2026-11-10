# VPS image updates

The updater is a manually invoked operator tool for a **Linux VPS with loopback-only access**. It does not make this MVP a hardened public service. Do not publish port 4310 on all interfaces or put a public reverse proxy in front of it. Use an independently configured SSH tunnel if remote browser access is needed.

Implementation and source publication do not deploy anything. The script never connects to a server, logs into a registry, runs git pull, pushes an image, changes repository settings, or updates application release records.

## Requirements and fixed target

- Bash, Python 3.9+, Git, Docker Engine, and Docker Compose v2 on the VPS.
- Run from a clean, committed clone as the same Linux operator each time. This account must already be allowed to use Docker. Docker access is privileged; the script does not grant it.
- Use the local Unix-socket Docker context. Remote Docker contexts and DOCKER_HOST/DOCKER_CONTEXT overrides are refused.
- Use the repository's reviewed compose.yml: project zhixu, service app, volume zhixu_zhixu-data, and 127.0.0.1:4310:4310. Custom runtime environment, extra services, alternative mounts, or public ports require a separate deployment design.
- Keep enough disk space for the new image and two backup copies. No image pruning, backup retention, or volume deletion is performed.
- Keep one canonical deployment checkout. All copies on this host share /tmp/zhixu-image-update.lock, but their records remain local to each checkout. Never delete the lock file or run direct Docker/Compose mutation commands while an update is active. A lock owned by a different operator fails closed; coordinate that operator change manually.

The script creates .deploy/ with private permissions. If that directory already exists with broader permissions, inspect it and use chmod 700 .deploy before proceeding. State, database backups, and Python caches are ignored by Git, and the Docker build allowlist excludes deployment state.

## Normal update after changing code

Update and review the desired Git branch/revision first. For example, on the already selected deployment branch:

```bash
git pull --ff-only
bash scripts/update-vps.sh
```

The default path builds the checked-out code locally on the VPS. It does not depend on GHCR. This is the usable path for the current public source repository because the existing GHCR workflow deliberately requires a separately approved private repository. The script does not alter that gate.

The update sequence is:

1. Acquire the host-wide lock and validate the Compose/local-engine configuration.
2. Refuse an unfinished attempt or dirty checkout. Build a uniquely tagged image from the current code, then resolve its immutable local Docker image ID.
3. Inspect the actual existing container and confirm its named SQLite volume. Create a consistent online SQLite backup with the existing backup tool, then copy it into .deploy/backups/ on the host. Failure stops before replacement.
4. Recheck source and container identity, then write .deploy/pending-update.json before replacement.
5. Recreate only app with the exact image ID, --no-build, and --pull never. Keep the same volume and loopback binding.
6. Verify the actual container's image ID, volume identity, and Docker health. Only then atomically replace .deploy/latest-image.json and remove the pending journal.

The app will be briefly unavailable during replacement. In-memory sessions expire and users must sign in again. A local health check is evidence of startup health, not full application/schema compatibility or security approval.

A genuine first install is allowed only when neither the app container nor the named volume exists. Set up the initial administrator password through loopback/tunnel access. If a volume exists but the container was removed with compose down, the updater refuses to skip backup. Recreate the **previously verified image** using its saved overlay first, check the app, then update. Do not remove the data volume to bypass this guard.

## Read the image record

```bash
bash scripts/update-vps.sh --status
cat .deploy/latest-image.json
```

Status compares the actual container with the last successful record and any unfinished attempt. latest-image.json is a record of the last verified success, not a live source of truth after a failed update or an external manual change.

The record includes:

- imageId: the immutable local Docker image ID actually verified in the running container.
- requestedReference: the unique build tag, requested digest, or explicit rollback ID.
- registryDigest and repoDigests: registry references when available. A local image ID is **not** falsely labeled a registry manifest digest.
- imageRevision: the image's own OCI revision label, or null if absent. checkoutCommit describes the local checkout/configuration and does not claim a pulled image was built from it.
- verifiedAt, operation, volume, backupPath, previousImageId, and a bounded previousSuccessful record.

Keep .deploy/ private and preserve it across source updates. Do not commit it or print its backup contents in logs. It contains local paths and backup copies with project data and the password hash.

## Optional immutable registry image

Only use an image from a separately approved and trusted registry destination. Authenticate outside this script when necessary; never pass a token in the image reference or commit credentials.

```bash
bash scripts/update-vps.sh --image registry.example/team/zhixu@sha256:<64-hex-manifest-digest>
```

Replace the example with a real immutable digest. Mutable tags such as latest are rejected. The pull resolves the platform-specific local image ID, and the container is started with that exact ID. An inaccessible registry fails before replacement. This mode does not publish anything or bypass the current GHCR guard.

## Interrupted or failed updates

Build, pull, and backup failures leave the existing container untouched. A failure after replacement may leave a failed or still-starting candidate. The script deliberately does **not** automatically downgrade an image: a new version may already have migrated SQLite.

Inspect first:

```bash
bash scripts/update-vps.sh --status
docker compose --project-name zhixu -f compose.yml logs --tail 100 app
```

Review logs locally because they may contain private application data. Check pendingAttempt.previousImageId, pendingAttempt.backupPath, and latestSuccessful. Do not remove the journal just to retry.

If the recorded candidate has become healthy and uses the expected image/volume, this verifies it again and completes its record without recreating it:

```bash
bash scripts/update-vps.sh --recover
```

For an **explicit image-only rollback**, first confirm that the old application version can use the current database schema. Then copy the exact old sha256 image ID from status:

```bash
bash scripts/update-vps.sh --rollback sha256:<64-hex-local-image-id>
```

Rollback never pulls a missing old image, never restores SQLite, and never reverses a migration. It uses the current reviewed Compose configuration, so it is not a full configuration rollback. A running candidate is backed up before rollback. For an interrupted attempt with a stopped/missing container, the recorded pre-update backup must still exist; its reference is retained. All current database files remain in place.

If the database requires restoration, stop all writers, preserve the current volume/data separately, and follow the manual backup/restore procedure in README.md. Choose whether to lose any writes made after the snapshot yourself. A pre-update snapshot is not necessarily the state immediately before container shutdown.

## Later lifecycle operations

Use the updater for image changes. Do not run plain docker compose up --build after an update: compose.yml still names zhixu:local and that would bypass the saved immutable selection and verification.

A normal restart keeps the current container/image:

```bash
docker compose --project-name zhixu -f compose.yml restart app
```

If the container was deliberately removed and no pending attempt exists, the successful selection can be recreated without changing its image:

```bash
docker compose --project-name zhixu -f compose.yml -f .deploy/selected-image.json up -d --no-build --pull never app
bash scripts/update-vps.sh --status
```

Do not use that overlay after a failed attempt without reviewing it: it may select the failed candidate. Never run compose down --volumes or volume prune against the database. Preserve old images needed for rollback. Export a backup to independent private storage for disaster recovery; both copies created here still live on the same host.

## Verification scope

Run the fake-Docker regression suite with:

```bash
python3 -m unittest discover -s tests -p 'test_update_vps.py' -v
```

The suite exercises preparation/start/health/state-write failures, real Linux file locking, immutable identities, volume guards, backup retention, rollback, and interruption recovery without touching a real Docker service. Ubuntu CI runs it before the existing application checks. See development-log.md for actual local results and remaining limits. No live VPS update is claimed by these tests.
