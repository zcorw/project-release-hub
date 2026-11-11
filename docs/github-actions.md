# GitHub Actions and Local Container

## Workflow model

Zhixu (知序) follows the existing Zhijiao pattern: automatic checks and a separate manual image publication workflow. Neither workflow deploys the application, connects to a VPS, or changes the project's release/deployment records.

### Checks

.github/workflows/check.yml runs on pushes, pull requests, manual dispatch, and workflow_call. It uses Ubuntu 24.04 and application Node 22.23.4, the same application/runtime pins as the reviewed Zhijiao configuration. The JavaScript Actions themselves use Node 24: checkout/setup-node/upload-artifact v7, setup-buildx/login v4, and build-push v7. Updating the Actions runtime does not upgrade the application runtime or the local computer.

Checks install the locked dependencies, run npm run check (formatting, TypeScript, unit/integration tests, and build), install Playwright Chromium, run the browser scenario against a fresh temporary database, validate Compose, build the image without pushing, and run the isolated container smoke test.

No secrets are required. The job has read-only repository permission. Pull requests do not publish packages. Local browser tests continue to use installed Chrome; CI uses the Playwright-managed Chromium build.

### Publish approved image

.github/workflows/image.yml runs only by workflow_dispatch. It calls the complete checks workflow before its publishing job.

The source destination is [zcorw/project-release-hub](https://github.com/zcorw/project-release-hub), a public repository. Source repository visibility and GHCR package visibility are separate. Public or private source repositories can use this workflow to publish a private image. There is no repository-name allowlist, private-source requirement, or IMAGE_PUBLISH_REPOSITORY variable gate.

Before an authorized publication:

1. Review and merge the intended workflow/source revision into the repository's default branch. Feature-branch dispatches run checks but skip the publishing job.
2. Confirm that repository/organization policy permits the publishing job's packages:write permission. If the target package already exists, it must be private and grant this repository Actions access. Do not change a public package's visibility to bypass a failed check.
3. Manually dispatch Publish approved image from the default branch for that specific revision. A normal source push or pull request only runs Checks; it does not publish an image.
4. Confirm the publish job actually succeeded, not merely that the workflow was green with publication skipped. Check the recorded digest and, after the first publication, verify the package is private in GitHub Packages.

The only publishing credential is GitHub's automatically supplied GITHUB_TOKEN. Do not add a PAT, SSH key, VPS password, application login password, GITHUB_TOKEN value, or HUB_MCP_TOKEN to these workflows. An old IMAGE_PUBLISH_REPOSITORY variable is ignored; no variable or secret needs to be created, changed, or removed for this update.

The image is ghcr.io/<lowercase-owner>/<lowercase-repository>:sha-<full-commit-sha>, for linux/amd64. Existing commit tags are not overwritten. A visible existing package must report private; a non-private package or an unexpected visibility API error blocks publication. An HTTP 404 permits the new-package path but does not grant access to an inaccessible existing package. Registry authentication/permission errors still block the push. Repository and organization policies may prevent publication.

New GHCR packages are private by default. The workflow does not call a visibility-changing API. Verify the package remains private after first publication and do not change it to public. The workflow attaches provenance and an SBOM, then records the immutable ghcr.io/...@sha256:... reference in the run summary and an image-reference artifact. No latest tag is published and no deployment is performed. A public source repository's Actions logs, summaries, and image reference may be visible publicly; knowing a private image's name or digest does not grant pull access.

### Copies and forks

The image target and package visibility API path are derived from github.repository, not a hard-coded upstream destination. A workflow running in another owner/repository writes to that repository's GHCR namespace. It does not change the original repository, its Actions variables, or its image tags. Merely cloning locally while retaining the original Git remote is different: pushes still go to that remote, and this workflow runs in whichever GitHub repository receives the source.

GitHub forks/new repositories do not automatically copy the original repository's Actions secrets or variables. GITHUB_TOKEN is issued for the repository running the job; existing package access must be granted to that repository. A fork may also need Actions enabled before its owner can manually dispatch the workflow. There is no pull_request_target trigger, and pull requests never run the publishing job.

This isolation depends on preserving the dynamic target and scoped token. A later change that hard-codes the original package and supplies credentials or package permissions able to write it could affect that package. Do not copy a broad PAT or grant a copied repository access to the original package for this workflow.

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

The later request adds a manually invoked updater in scripts/update-vps.sh. It uses local builds by default, keeps the existing loopback-only Compose/SQLite boundary, and records verified immutable image IDs. It does not connect to or deploy a server during implementation. See [the operator guide](vps-update.md). A separately authorized private GHCR publication can now originate from the public source repository; the updater still does not publish or authenticate to GHCR. Ubuntu Checks also runs the isolated Python updater regression suite.
