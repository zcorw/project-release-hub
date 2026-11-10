# Stage 06-dependencies - Dependencies and Cost

Status: recorded on 2026-11-10 before implementation.

## Objective

Record this stage using the conversation requirements and the user's delegated non-critical decisions.

## Confirmed Facts

- Do not deploy, publish, push, or store secrets in source.
- GitHub credentials are configured by the user.

## Implementation Decisions

- Use public npm packages from the official registry and commit a lockfile only if later asked to commit.
- No paid dependency or external AI service.
- GitHub uses server-side GITHUB_TOKEN when configured; never return it to the UI or MCP.
- MCP is local-only by default and optionally enabled with a separately configured token. Production HTTPS/OAuth is outside this delivery.

## Assumptions and Risks

- This is a local single-user MVP, not a hardened public service.
- A delegated default is not represented as a separate explicit user selection.

## Review Questions Resolved

1. What must this stage deliver? The objective and facts above.
2. Which details are explicit versus delegated? Confirmed facts and implementation decisions are separate.
3. Does this stage authorize deployment or external persistent access? No.

## Open Questions

No blocking question remains for the local MVP. Remote deployment and authentication require a separate task.

## Artifacts

- docs/mvp-development-plan.md
- TODO.md

## Next Stage Inputs

Use these decisions with the next recorded stage. Implementation begins only after Stage 09.
