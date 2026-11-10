# GitHub Actions and Local Container

## Workflow model

Zhixu (知序) follows the existing Zhijiao pattern: automatic checks and a separate manual image publication workflow. Neither workflow deploys the application, connects to a VPS, or changes the project's release/deployment records.

### Checks

.github/workflows/check.yml runs on pushes, pull requests, manual dispatch, and workflow_call. It uses Ubuntu 24.04 and Node 22.23.4, the same pins as the reviewed Zhijiao configuration.

Checks install the locked dependencies, run npm run check (formatting, TypeScript, unit/integration tests, and build), install Playwright Chromium, run the browser scenario against a fresh temporary database, validate Compose, build the image without pushing, and run the isolated container smoke test.

No secrets are required. The job has read-only repository permission. Pull requests do not publish packages. Local browser tests continue to use installed Chrome; CI uses the Playwright-managed Chromium build.

### Publish approved image

.github/workflows/image.yml runs only by workflow_dispatch. It calls the complete checks workflow before its publishing job.

The selected source destination is [zcorw/project-release-hub](https://github.com/zcorw/project-release-hub), verified public on 2026-11-10. Source commit/push is authorized, but no visibility change or package publication is authorized. Checks can run in this public repository; image publication remains blocked by the private-repository guard. Do not set the gate to bypass this difference.

If a private publication destination is separately authorized later:

1. Choose and explicitly authorize the private GitHub repository. The current public source destination must not silently be made private or replaced.
2. After separately authorized publication of the source, set the repository Actions variable IMAGE_PUBLISH_REPOSITORY to the exact owner/repository string shown by GitHub. An absent/mismatched variable skips the publishing job.
3. Keep the repository private. The workflow also requires the default branch and refuses an existing GHCR package unless its visibility is private.
4. Allow the publishing job's packages:write permission through any organization policy. An existing package must grant this repository Actions access. Do not change a public package's visibility merely to work around a failed guard.
5. Manually dispatch Publish approved image from the default branch when ready to publish that specific revision.

The only credential used is GitHub's automatically supplied GITHUB_TOKEN. Do not add a PAT, SSH key, VPS password, application login password, GITHUB_TOKEN value, or HUB_MCP_TOKEN to this repository for these workflows. IMAGE_PUBLISH_REPOSITORY is a non-secret variable, not a secret.

The image is ghcr.io/<lowercase-owner>/<lowercase-repository>:sha-<full-commit-sha>, for linux/amd64. Existing commit tags are not overwritten. Visibility/registry failures block publication rather than guessing. The workflow attaches provenance and an SBOM, then records the immutable ghcr.io/...@sha256:... reference in the run summary and an image-reference artifact. No latest tag is published and no deployment is performed.

GHCR packages are private by default when first created. Verify the new package remains private after the first authorized run. Repository and organization policies may still prevent publication.

## Local container use

The container is a packaging option for local single-user use, not authorization or hardening for internet hosting. Docker Desktop must be running in Linux-container mode.

To build and start it locally:

```powershell
docker compose up --build -d
```

Open http://127.0.0.1:4310. Stop any native instance using that port first. Compose binds the host port to 127.0.0.1, runs as non-root, drops capabilities, uses a read-only root filesystem, and keeps SQLite in a named volume. The image is built from an explicit allowlist of source inputs, excluding data, backups, environment files, and credentials.

The container has its own initially empty database. It does not import or alter ./data/hub.db from the native application. Set up a password on the first container visit. Do not point multiple app instances at the same SQLite database.

Stop while preserving data:

```powershell
docker compose down
```

Do not use docker compose down --volumes for normal shutdown; it deletes the persistent database volume. Back up before changing or removing storage. The existing backup and restore precautions apply. A consistent backup can be created inside the persistent volume without exposing it publicly:

```powershell
docker compose exec app node --import tsx scripts/backup.ts /app/data/backup-2026-11-10.db
```

Choose a new filename for each backup. Export it to a separate private storage location for disaster recovery; a backup kept only in the same volume does not protect against volume loss.

For a disposable image test:

```powershell
docker build --tag zhixu:ci .
npm run test:container -- zhixu:ci
```

The smoke test uses a random container name, a fresh temporary volume, and an ephemeral loopback port. It checks non-root execution, the Chinese UI, health, unauthenticated rejection, the Host guard, disabled MCP, password setup, persistence across restart, and session isolation. It removes only its own temporary container and volume afterward.

## Runtime boundary

Native startup still defaults to 127.0.0.1. HUB_BIND_HOST=0.0.0.0 is an explicit container-only option set in the Dockerfile so host-to-container port forwarding works. The HTTP Host allowlist, login/CSRF checks, and web-only confirmation boundary remain unchanged. Binding all interfaces alone does not make this a safe public service. Never publish the Docker port on 0.0.0.0 or expose it through a public reverse proxy in this MVP.

Compose does not inject runtime GitHub/MCP credentials. Remote ChatGPT connectivity, OAuth, TLS/public hosting, and VPS deployment require a separate security design and authorization.

## Delivery boundary

The later user instruction authorizes committing and pushing the source to https://github.com/zcorw/project-release-hub. The existing repository was verified empty and public before the first push. The local commit workflow uses a feature branch rather than writing directly to main. Source pushes trigger Checks automatically. This authorization does not set Actions variables/secrets, change visibility, manually dispatch publication, log into GHCR, publish an image, or deploy to a server.

## Manual VPS update tooling

The later request adds a manually invoked updater in scripts/update-vps.sh. It uses local builds by default, keeps the existing loopback-only Compose/SQLite boundary, and records verified immutable image IDs. It does not connect to or deploy a server during implementation. See [the operator guide](vps-update.md). The current public repository still does not satisfy the private-image publication gate. Ubuntu Checks also runs the isolated Python updater regression suite.
