# Stage 00-platform-stack - Platform and Stack

Status: recorded on 2026-11-10 before implementation.

## Objective

Record this stage using the conversation requirements and the user's delegated non-critical decisions.

## Confirmed Facts

- Web application for a single user.
- SQLite explicitly selected by the user.

## Implementation Decisions

- React 19 with TypeScript and Vite; Node.js 22 with TypeScript and Express.
- Use better-sqlite3 rather than Node's experimental SQLite interface on the installed Node 22.12 runtime.
- Reuse React Hook Form, Zod, zodResolver, and Radix Dialog patterns from tts-workbench. No MUI dependency is needed.

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
