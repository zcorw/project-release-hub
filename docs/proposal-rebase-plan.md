# Stale proposal reconciliation

Date: 2026-11-12.

## Confirmed request

The user requested rebasing stale proposals onto the latest records, preserving already applied changes, choosing conflicts in the browser, and retaining separate web confirmation before application. This authorizes local implementation and verification, not commit, push or deployment.

After verification, the user explicitly authorized committing and pushing this feature to the existing remote repository. Delivery uses a separate Conventional Commit on the current non-protected working branch with a normal push; no merge, image publication or deployment is included.

## Implementation decisions

- Keep the current stack, shared application validation, atomic batches and web-only confirmation. Add authenticated web preview/generation routes; expose no MCP approval or reconciliation tool.
- Store base snapshots for new update/delete proposals. Recover bases for existing requests from the complete SQLite audit history (not the latest-100 UI window). Missing bases or missing/deleted targets block automatic reconciliation with a useful explanation.
- Compare base, latest and proposed values per field. Preserve latest-only edits, carry proposal-only edits and accept identical edits. Conflicting fields require an explicit choice of current or proposed value; strings are compared as complete fields. A changed deletion target requires an explicit retain/delete choice. Do not resurrect deleted targets.
- Preview is read-only. Bind generation to its exact target snapshots and require a refreshed preview if those snapshots change. Revalidate schema, immutable fields, relationships and duplicates against current state. Unchanged updates/retained deletions are omitted; an empty result creates no request.
- Generate a new UUID/payload-bound pending request even if only creates remain. In the same transaction, mark the source rejected with a supersession link; keep original operations intact and link the new request to its source. Preserve stable retry behavior, including after the source has been superseded. Failures leave the source untouched.
- Show current/proposed/base conflict context and merged preview in the existing accessible dialog. Generation opens the normal confirmation dialog; confirmation rechecks revisions and duplicates as before. Cancellation changes nothing.

## Verification

Service regressions cover all merge branches, legacy bases beyond 100 events, deletion/missing targets, atomic validation, preview races, duplicate review, retry and supersession. HTTP tests cover session/CSRF isolation. Browser checks cover nonconflicting merge, explicit conflict choices, retry, cancellation, stale preview refresh, mobile layout and separate final confirmation. Run npm run check, npm run test:e2e and review the final diff before marking T016 complete.

Implemented and verified on 2026-11-12: npm run check passed all 131 tests, formatting, TypeScript and production build. npm run test:e2e passed all 11 Chrome scenarios, including five new reconciliation flows. Mobile conflict and desktop confirmation screenshots were inspected. Final diff review passed; no commit, push or deployment was performed.

## Using reconciliation

1. In Pending changes, open the proposal and click 基于最新记录重新合并. The server reads latest records even if the page was not refreshed.
2. Review latest records and the merged preview. For each conflict, inspect the original value and select 保留最新值 or 采用提案值. Text fields are selected in full; there is no line-level text merge. A changed deletion target requires choosing whether to retain or delete the latest record.
3. Click 生成新提案. No records change at this step. The original request is retained as rejected/superseded, and the replacement opens in the standard review dialog. Unchanged updates and retained deletions are omitted.
4. Review that dialog and click 确认并应用 to save, or 稍后处理 to leave the replacement pending. Rejecting the replacement leaves entity records unchanged.

Returning or closing before generation leaves the original proposal untouched. If records change after preview, choose 重新读取最新记录 and select conflicts again. If a generation response is interrupted, retry with unchanged choices; the same requestId returns the existing replacement. Revisions and duplicate detection are checked again at final confirmation.

Deleted/missing targets, occupied create IDs and unavailable bases block automatic reconciliation. Combined date/reference constraints may also prevent generation; the original stays pending and the error explains the constraint. Adjust records/proposals manually and preview again. If all intended changes are already applied or all conflicts retain current values, there is no new proposal to generate; return and reject the obsolete original.

## Web contract

- GET /api/changes/:id/rebase returns requestId, token, items (original operation, base, current, merged fields and conflicting field names) and blockers. It is read-only and requires the authenticated web session.
- POST /api/changes/:id/rebase requires the web session, CSRF and a strict body containing requestId, previewToken and resolutions: an array of id/field/choice objects. Choice is current or proposed; $delete identifies a changed deletion target. Missing, duplicate or extra resolutions are refused.
- The generation requestId is bound to its source ID, preview token and resolutions. Retry the exact body after an uncertain result. The new pending request has rebasedFrom; the rejected source has supersededBy. No entity audit is added until the normal confirmation applies the replacement.
