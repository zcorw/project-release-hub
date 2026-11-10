# Stage 07-api-data - API and Data Conventions

Status: recorded on 2026-11-10 before implementation.

## Objective

Record this stage using the conversation requirements and the user's delegated non-critical decisions.

## Confirmed Facts

- Batch additions, human-confirmed destructive changes, undo, and duplicate clarification are required.

## Implementation Decisions

- Use camelCase JSON contracts, UUID IDs, UTC ISO timestamps, and revision numbers.
- Web routes require session authentication; write routes require CSRF protection.
- MCP exposes read, submit-batch, and pending-request inspection. It cannot confirm or reject proposals.
- Pending confirmation binds the exact validated operations and revisions. Replays with the same request ID and same payload return the original result; different payloads are rejected.
- Return stable error codes and bounded errors; do not leak database or credential internals.

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
