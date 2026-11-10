# Naming and GitHub Actions Plan

Date: 2026-11-10.

## Current request and decision

The user requested a project name and GitHub Actions workflows following the same approach as Zhijiao. The selected product name is **知序 (Zhixu)**: keeping projects, feature plans, tasks, versions, and releases in a clear order. The Chinese product name continues the user's 知交 / 知声 / 知产 naming family.

Apply the name to the live UI, browser title, static preview, startup message, and documentation. Keep the existing folder, package identifier, SQLite location, HUB_* variables, cookie, and MCP tool identifiers stable to avoid breaking local consumers.

## Reference reviewed

The local Zhijiao repository has .github/workflows/check.yml and image.yml. Its pattern is automatic/reusable checks, followed by manually requested publication of a private GHCR image on the default branch. Publication waits for checks, refuses public packages and overwritten commit tags, records the resulting digest, and never connects to a VPS.

## Adaptation

- Use the same Ubuntu and Node pins as the reference.
- Replace PostgreSQL and Zhijiao-specific scripts with this project's SQLite tests, aggregate check, browser tests, and container smoke test.
- Add a non-root local-use container and a loopback-only Compose port mapping. Native startup remains bound to 127.0.0.1 by default. A container-specific bind override does not relax the HTTP Host check or web-only approval boundary.
- Keep publication disabled until an explicit repository variable matches the current repository. This checkout has no remote or commits, so no destination can be assumed.
- Reuse GitHub's automatic GITHUB_TOKEN for GHCR, scoped to the publishing job. No PAT, SSH, VPS, application password, or MCP token belongs in CI.
- Exclude local databases, backups, environment files, credentials, and local tooling from the image context.
- The initial naming/workflow request covered local files only. The later instruction authorizes source commit/push to zcorw/project-release-hub; it does not authorize manual dispatch, deployment, external settings changes, or persistent access.

## Verification plan

Run formatting, TypeScript, all unit/integration tests, production build, the isolated desktop/mobile browser scenario, container build, Compose validation, and an isolated container smoke test when Docker is available. Check default binding, container opt-in validation, branding, and unchanged authentication/confirmation behavior. Record any unrun Linux/GitHub steps separately.
