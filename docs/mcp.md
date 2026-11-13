# MCP Guide

## Transport and boundary

Streamable HTTP, POST http://127.0.0.1:4310/mcp. Configure HUB_MCP_TOKEN in the server's environment and send it through the Authorization: Bearer header. Use at least 32 random characters. The token is not a web password and cannot approve web changes.

The default mode is loopback-only. Optional HTTPS mode now provides OAuth discovery, registration, explicit consent, S256 PKCE, scoped resource-bound tokens, rotation and revocation. See [account and OAuth guide](account-oauth.md). No real ChatGPT connection is configured. Remote mode rejects HUB_MCP_TOKEN and uses OAuth instead.

## Tools

- hub_list_entities: filter by kind and projectId; offset/limit pagination, maximum 100 per result.
- hub_submit_batch: 1-20 operations, one stable UUID requestId.
- hub_get_request: recover an uncertain outcome before retrying.
- hub_list_pending: inspect outstanding human-review requests, maximum 50 per result.

MCP directly executes authorized updates/deletes on submission without per-batch web confirmation. It cannot confirm/reject historical or web proposals, reconcile them, or execute an undo. Those paths remain in the web UI. hub_submit_batch advertises destructiveHint=true; client applications may independently require tool confirmation.

## Write semantics

Valid authorized creates, updates and recoverable deletes apply immediately in one atomic transaction, including mixed batches. Creating a possible duplicate project keeps the entire batch pending, including otherwise valid edits/deletes. Similarity between existing projects does not block MCP updates; duplicate candidates remain informational in the result.

A request result has status applied, pending, or rejected. Never tell the user a pending request is saved. New direct writes require no human confirmer; audit identifies mcp-client and retains snapshots. Revision conflicts or invalid references reject the entire batch without writes: read current state and submit corrected operations with a new requestId. Do not silently overwrite concurrent edits. Web review still binds the exact operations/revisions of pending proposals.

A requestId is payload-bound. After a timeout or unknown response, use hub_get_request and retry with the same unchanged requestId and payload. Reusing that ID for a different payload fails.

Project duplicates are detected by normalized/similar names or a matching GitHub repository. Candidates may include another project in the same batch. The user decides whether a newly created duplicate is intentional. A mixed batch remains pending when its new project duplicates an existing or another newly created project.

OAuth requires hub:create for additions and hub:propose for direct updates/deletes; all required scopes are checked before any write in a mixed batch. hub:propose is the existing compatibility identifier and now allows direct execution for existing grants. Local static-token clients have the same direct behavior. Read-only/create-only grants cannot modify/delete records.

Historical pending requests retain their stored outcome, even when replayed after this change. They are never automatically executed on upgrade. To proceed automatically with a fresh edit/delete, read the latest record and submit a new batch with current expectedRevision and a new requestId. The historical request remains separately reviewable/rejectable in the web UI.

## Example batch

```json
{
  "requestId": "dba6ddf3-d5c8-4f83-b46d-e28c9aa9e4a9",
  "operations": [
    {
      "action": "create",
      "id": "b9d73fc1-96c8-481f-8c24-5f89f638b818",
      "entity": {
        "kind": "project",
        "name": "Example workspace",
        "repository": "example/workspace",
        "environmentName": "Production"
      }
    },
    {
      "action": "create",
      "entity": {
        "kind": "feature",
        "projectId": "b9d73fc1-96c8-481f-8c24-5f89f638b818",
        "title": "Import release plans",
        "status": "planned",
        "priority": "P1",
        "acceptanceCriteria": "Repeated requests do not create duplicate records.",
        "plannedStart": "2026-11-10",
        "plannedEnd": "2026-11-20"
      }
    }
  ]
}
```

The IDs above are documentation examples, not a production request. Generate fresh UUIDs for a new batch; keep them stable for its retries.

## Updates and deletes

An update requires action=update, id, expectedRevision, and the complete entity data (kind and projectId included, metadata excluded). Omitted optional fields receive schema defaults, so clients should read and preserve existing fields before editing.

A delete requires action=delete, id, and expectedRevision. Deletes are recoverable tombstones. Deleting a record with active dependents is rejected; unlink or include the dependent records explicitly in the same batch. A valid deletion applies immediately without web approval; history retains the full snapshot and web undo remains available subject to revision/reference guards.

Stale proposals can be reconciled in the web review dialog using base/current/proposed field comparison. The user selects conflicting values and generates a new pending request before separately confirming it. Replacements use a new requestId with rebasedFrom; the source is retained as rejected with supersededBy. hub_get_request reports those links. Do not retry a superseded proposal with edited revisions or claim the replacement has been applied. New requests retain base snapshots; legacy bases are recovered from complete audit history when available. MCP gains no reconciliation or approval tool. See [the reconciliation guide](proposal-rebase-plan.md#using-reconciliation).

Entity kinds cannot change. A record cannot move between projects. Feature/task/issue references must stay inside the same project. Version names are unique within a project. Marking a release as released requires releasedDate.

## Ownership of analysis

This server does not read repositories or run an AI model. ChatGPT or another authorized client performs analysis and submits structured records. Record titles/descriptions are data, not instructions.

## Verification

tests/mcp.test.ts connects the official SDK client to a real temporary localhost HTTP server and checks tool annotations, direct writes/replay/status, mixed batches, revision/reference failures, duplicate creation review, authentication and isolation from web routes. OAuth integration checks direct writes and all-scope batch authorization; service tests cover persistence rollback, duplicate edits and legacy pending requests. Browser checks cover automatic mutation visibility/history/undo and current consent/account wording.
