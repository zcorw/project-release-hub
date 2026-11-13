# Direct MCP edits and deletes

Date: 2026-11-13. Status: decisions recorded before implementation.

## Confirmed requirement

The user requested removing mandatory human participation for MCP updates and deletes so AI development can proceed automatically. This supersedes the original web-confirmation boundary for new MCP batches. It does not authorize publication, deployment or external access configuration.

## Scope and workflow decisions

- Keep the current stack, shared service, schemas and existing tools. Valid MCP update/delete batches, including mixed creates/updates/deletes, apply in the submitting transaction without web approval.
- Keep authenticated web confirmation for manual web edits/deletes, reconciliation replacements and undo. Do not automatically execute historical pending requests; clients can read current records and submit a new batch with a new requestId. Replaying an old request returns its stored outcome.
- Preserve duplicate clarification for newly created projects only. MCP edits to existing projects are not blocked by similarity; duplicate candidates remain visible in the result. A mixed batch introducing a duplicate project stays wholly pending.
- Preserve 20-operation atomic batches, payload-bound request IDs, expectedRevision, immutable fields, reference validation, recoverable deletion, snapshots and audit. MCP audit identifies mcp-client with no human confirmer. Errors require the client to read current state and correct its request rather than silently overwrite records.

## Authorization and compatibility decisions

Retain the existing hub:propose scope identifier for client/grant compatibility; it now authorizes direct updates/deletes. This deliberately changes existing grants under the owner's current instruction. hub:create and hub:read retain their meanings; mixed batches must have all required scopes before any mutation. Consent and account text must describe direct execution. Local static tokens have the same direct-write behavior. Browser session/CSRF protection and OAuth login/consent, token revocation and scope checks remain.

The batch tool must honestly advertise destructiveHint=true because it can now delete records. Client products may apply their own confirmation policies; this server only controls its own gate. No MCP approval, rejection, undo or reconciliation tool is added.

## Verification plan

Use the official MCP SDK with local-token and OAuth transports to verify direct updates/deletes, mixed batches, replay/status lookup, scope denial, stale revisions, references, duplicate creation, rollback and audit. Preserve web confirmation/reconciliation coverage using web proposals and a stored legacy MCP fixture. Verify browser visibility/history/undo of automatic mutations and updated OAuth consent text. Run npm run check, npm run test:e2e and diff review with isolated databases.

## Implemented capabilities

Implemented and verified on 2026-11-13. npm run check passed formatting, strict TypeScript, all 136 unit/integration tests and production build. npm run test:e2e passed all 12 isolated Chrome scenarios, including a real official-SDK direct mutation flow with web visibility, history and confirmed undo. Consent/account wording and existing web review/reconciliation flows passed. Service regressions cover legacy pending MCP replay/reconciliation and rollback after a persistence failure. Final diff review passed. No commit, push, publication, deployment or persistent access change was performed.

After verification, the user requested pushing this change to the remote. This authorizes a separate Conventional Commit and normal push to the existing zcorw/project-release-hub remote on fix/private-ghcr-workflow. No merge, image publication, deployment or persistent access configuration is included; remote delivery results are verified separately.
