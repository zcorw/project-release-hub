# MVP Development Plan

Status: requirements reconciled on 2026-11-10. The local MVP is implemented; see verification.md for passed checks and remaining integration boundaries.

## Confirmed requirements

- Chinese user-facing conversation and interface; English development documentation and comments.
- A web application for manual management of personal software projects.
- Each project has concrete features and development plans, tasks, issues, versions, release states, and one environment.
- The home page summarizes feature progress and environment state across projects.
- GitHub Actions information is refreshed only on explicit request and is read-only. The application does not trigger workflows or deployments.
- ChatGPT performs AI repository analysis. This application stores and manages the resulting structured records.
- MCP batch additions save directly, except possible duplicate projects require human clarification first.
- MCP updates and deletes require human confirmation. Changes must be auditable and reversible.
- SQLite is explicitly selected for the first version.
- Reuse the form and validation components commonly used in existing local projects, after checking their actual dependencies and code.
- Deliver a runnable local version with basic tests, startup instructions, backup instructions, and an honest limitations list.
- Initial MVP delivery was local-only. A later instruction authorizes source commit/push to zcorw/project-release-hub. Image publication, deployment, persistent external access, and committing secrets remain excluded.

## Proposed implementation defaults

The earlier proposal used React and TypeScript for the web client, Node.js and TypeScript for the server, and a single-user login. The latest explicit database decision is SQLite. Do not present the remaining proposal details as separate, explicit user choices.

- Keep presentation, application rules, and persistence separate.
- Use shared runtime validation for manual and MCP writes.
- Store timestamps in UTC; use optimistic concurrency for updates and undo.
- Treat feature completion, workflow success, and actual release/deployment as different facts.
- Limit and atomically validate batches. Use idempotency keys to avoid duplicate writes on retry.
- Keep MCP confirmation capability out of AI-accessible tools; confirmations happen in the authenticated web interface.
- Reject linked-record deletion that would leave dangling references.
- Keep the default server local-only. A production remote MCP connection needs a separate HTTPS/authentication/deployment task.

## Open decisions and workflow gates

- Resolved: reuse Radix Dialog and React Hook Form/Zod from tts-workbench; MUI was not added.
- Completed: discovery stage records and the static UI prototype preceded implementation.
- Completed: the user delegated remaining details and explicitly instructed development to proceed.

## Verification target

- Type checking and production build.
- Domain tests for validation, duplicate handling, batch atomicity/idempotency, human confirmation, concurrency, reference integrity, audit, and undo.
- API tests for login/session protection and separation between web confirmation and MCP tools.
- UI checks for empty states, creation, validation, cancel/retry, confirmation, and history.
- Read-only GitHub refresh tested with fixtures; disclose whether a real authorized GitHub repository was tested.
