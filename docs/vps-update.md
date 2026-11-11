# VPS image updates

The updater is a manually invoked operator tool for a **Linux VPS with a loopback-only backend port**. It reads the project-root .env for local MCP, GitHub access and optional HTTPS/OAuth configuration. Remote HTTPS uses an independently configured reverse proxy following account-oauth.md; keep the upstream port private. SSH tunnels remain available for private initialization and local-mode access. This tool does not provision a proxy, domain, certificate or ChatGPT connection.

Implementation and source publication do not deploy anything. The script never connects to a server, logs into a registry, runs git pull, pushes an image, changes repository settings, or updates application release records.

## Requirements and fixed target

- Bash, Python 3.9+, Git, Docker Engine, and Docker Compose v2 on the VPS.
- Run from a clean, committed clone as the same Linux operator each time. This account must already be allowed to use Docker. Docker access is privileged; the script does not grant it.
- Use the local Unix-socket Docker context. Remote Docker contexts and DOCKER_HOST/DOCKER_CONTEXT overrides are refused.
- Use the repository's reviewed compose.yml: project zhixu, service app, volume zhixu_zhixu-data, and 127.0.0.1:4310:4310. The five documented optional environment settings are supported; arbitrary runtime keys, commands, extra services, alternative mounts and public ports are rejected.
- Keep enough disk space for the new image and two backup copies. No image pruning, backup retention, or volume deletion is performed.
- Keep one canonical deployment checkout. All copies on this host share /tmp/zhixu-image-update.lock, but their records remain local to each checkout. Never delete the lock file or run direct Docker/Compose mutation commands while an update is active. A lock owned by a different operator fails closed; coordinate that operator change manually.

The script creates .deploy/ with private permissions. If that directory already exists with broader permissions, inspect it and use chmod 700 .deploy before proceeding. State, database backups, and Python caches are ignored by Git, and the Docker build allowlist excludes deployment state.

## Configure the application environment

Create .env in the deployment checkout before running either an initial install or an update:

```bash
cp .env.example .env
chmod 600 .env
```

Edit it locally. Both plain Docker Compose and the updater read it; no shell source command is needed. Existing shell values take precedence, so unset a stale shell setting when changing that value in .env. If .env is absent, optional application settings stay unset and the default local application still starts. The updater explicitly selects this checkout's .env, independent of the invoking directory, and retains its explicit Compose project/files.

Only these settings are forwarded:

- GITHUB_TOKEN: optional read-only GitHub Actions access.
- HUB_MCP_TOKEN: optional local-only bearer token, at least 32 random characters.
- HUB_SESSION_SECRET: optional local session persistence, required for HTTPS/OAuth; at least 48 random characters, retained across updates.
- HUB_PUBLIC_URL and HUB_TRUST_PROXY: opt-in remote HTTPS/OAuth origin and the actual trusted proxy peer(s). See account-oauth.md. Remove/comment HUB_MCP_TOKEN in this mode.

Keep unused optional settings commented out rather than assigning empty values. The application retains its existing validation for token length, canonical HTTPS, explicit proxy trust and credential-mode conflicts. Initialize the owner privately with HUB_PUBLIC_URL and HUB_TRUST_PROXY omitted before enabling remote mode. Existing initialized accounts do not need a password reset.

The container always uses PORT=4310, HUB_BIND_HOST=0.0.0.0 and HUB_DATA_DIR=/app/data. Native values in the same .env do not override these settings, the named data volume or loopback host binding. Unlisted .env keys are not passed into the container. Keep .env private and outside Git; do not print full docker compose config or Docker inspection results into shared logs because they can contain secrets. Use docker compose config --quiet for a syntax check.

Changing .env requires recreating the app through this updater; a normal container restart retains the old environment. The --image mode below applies the same .env without rebuilding the application image. Do not put credentials into an image tag, digest, command argument or deployment record.

## Normal update after changing code

Update and review the desired Git branch/revision first. For example, on the already selected deployment branch:

```bash
git pull --ff-only
bash scripts/update-vps.sh
```

The default path builds the checked-out code locally on the VPS and does not depend on GHCR. Alternatively, the public source repository can publish a private GHCR image through the separately dispatched workflow described in github-actions.md. Source visibility does not determine package visibility; this updater neither publishes images nor changes that workflow.

The update sequence is:

1. Acquire the host-wide lock and validate the Compose/local-engine configuration.
2. Refuse an unfinished attempt or dirty checkout. Resolve the reviewed Compose environment using .env and the shell. Build a uniquely tagged image from the current code, then resolve its immutable local Docker image ID.
3. Inspect the actual existing container and confirm its named SQLite volume. Create a consistent online SQLite backup with the existing backup tool, then copy it into .deploy/backups/ on the host. Failure stops before replacement.
4. Recheck source, resolved configuration and container identity, then write .deploy/pending-update.json before replacement. Changed configuration stops the operation; no secret values are written into that journal.
5. Recreate only app with the exact image ID, --no-build, and --pull never. Keep the same volume and loopback binding.
6. Verify the actual container's image ID, volume identity, effective application environment and Docker health. Only then atomically replace .deploy/latest-image.json and remove the pending journal.

The app will be briefly unavailable during replacement. Valid persistent sessions survive when HUB_SESSION_SECRET stays stable; without it local users must sign in again. A local health check is evidence of startup health, not full application/schema compatibility or security approval.

A genuine first install is allowed only when neither the app container nor the named volume exists. Set up the initial administrator password through loopback/tunnel access. If a volume exists but the container was removed with compose down, the updater refuses to skip backup. Recreate the **previously verified image** using its saved overlay first, check the app, then update. Do not remove the data volume to bypass this guard.

## Read the image record

```bash
bash scripts/update-vps.sh --status
cat .deploy/latest-image.json
```

Status compares the actual container with the last successful record and any unfinished attempt. latest-image.json is a record of the last verified success, not a live source of truth after a failed update or an external manual change.

environmentMatches compares the running container with the current .env/shell configuration without printing values. False commonly means .env was edited after the container was created; run a normal update with the desired image to apply it. Recovery also requires an environment match, so --recover cannot mark a stale configuration successful.

The record includes:

- imageId: the immutable local Docker image ID actually verified in the running container.
- requestedReference: the unique build tag, requested digest, or explicit rollback ID.
- registryDigest and repoDigests: registry references when available. A local image ID is **not** falsely labeled a registry manifest digest.
- imageRevision: the image's own OCI revision label, or null if absent. checkoutCommit describes the local checkout/configuration and does not claim a pulled image was built from it.
- verifiedAt, operation, volume, backupPath, previousImageId, and a bounded previousSuccessful record.

Keep .deploy/ private and preserve it across source updates. Do not commit it or print its backup contents in logs. It contains local paths and backup copies with project data and the password hash.

## Optional immutable registry image

Only use an image from an approved and trusted registry destination. For this repository, use the exact ghcr.io/zcorw/project-release-hub@sha256:... reference recorded by a successful publishing job. The package stays private: the VPS must already be authenticated to GHCR as an account allowed to read that package, with a classic PAT limited to read:packages where applicable. Authenticate outside this script using docker login ghcr.io with --password-stdin; never put a token in command arguments, an image reference, source, or deployment records. Source publication alone does not create an image or give the VPS registry access.

```bash
bash scripts/update-vps.sh --image registry.example/team/zhixu@sha256:<64-hex-manifest-digest>
```

Replace the example with a real immutable digest. Mutable tags such as latest are rejected. The pull resolves the platform-specific local image ID, and the container is started with that exact ID. An inaccessible registry fails before replacement. This mode does not publish anything, change package visibility, or bypass GHCR authentication. See github-actions.md for publication requirements and copy/fork behavior.

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
