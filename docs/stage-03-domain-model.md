# Stage 03-domain-model - Domain Model and Rules

Status: recorded on 2026-11-10 before implementation.

## Objective

Record this stage using the conversation requirements and the user's delegated non-critical decisions.

## Confirmed Facts

- Feature completion and deployment are separate states.
- Each project has one environment, and development plans describe concrete features.

## Implementation Decisions

- Project fields include repository slug and an environment label, URL, and manually recorded status/version.
- Features include priority, status, acceptance criteria, planned dates, and optional target release.
- Tasks and issues may link to a feature and release within the same project.
- Batch writes are atomic, max 20 operations, with stable request IDs and optimistic revisions.
- Use tombstones for recoverable deletes; reject deleting records still referenced by active records.

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
