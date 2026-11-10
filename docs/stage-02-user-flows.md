# Stage 02-user-flows - User Flows

Status: recorded on 2026-11-10 before implementation.

## Objective

Record this stage using the conversation requirements and the user's delegated non-critical decisions.

## Confirmed Facts

- Manual management and MCP management share the same records.
- New MCP records save directly; updates and deletes need human confirmation.
- Possible duplicate projects require clarification before creating.

## Implementation Decisions

- Start with first-run single-user password setup, then session login.
- Project creation opens project details; tabs manage concrete features, tasks, issues, and versions.
- Review pending changes in the web interface, approve or reject them, inspect history, and undo without overwriting newer work.

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
