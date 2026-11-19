# Project detail navigation and reading

[简体中文](project-detail-navigation.zh-CN.md)

## Confirmed requirements

The 2026-11-19 request authorizes development of the remaining Zhixu records:

- Feature `a7fb529a-683d-444a-9b65-6d176437ddbb`: opening a project records its ID in the URL; refresh and direct links restore it; switching projects updates the URL. Invalid or missing projects show an explanation and a way back to the overview.
- Task `6e5958b6-312a-48d3-95d6-454916492f77`: project details show the independent introduction immediately. The full description starts collapsed on each visit, can be expanded and collapsed, and retains its complete original content. Overview cards keep their current introduction behavior.

## Implementation decisions

These are implementation defaults within the existing React application, recorded before code changes:

- Use `?project=<id>` for project details. Use `?view=pending` and `?view=history` for the existing workspace views so browser Back/Forward restores the matching view. The overview omits both parameters. Preserve unrelated query parameters and the fragment; do not add a router dependency or change server endpoints.
- Keep URL and rendered navigation in one state, write browser history only for explicit navigation, and read it on `popstate`. Opening a project resets its record tab and transient filters/dialogs.
- Restore a deep link through authentication. Determine a missing project only after a successful authenticated snapshot, never from an empty loading/error snapshot. A failed refresh keeps the selected URL and permits retry. A project deleted after review shows the same missing-project state.
- Render summaries and descriptions as text. Use native accessible disclosure for the complete description, keyed to the selected project so a new visit starts closed. Refreshing the same project's data need not close a disclosure the user already opened. Empty introductions and descriptions have explicit placeholders.
- Keep shared schemas, persistence, existing manual confirmation, audit, and home-page card rules unchanged. No migration is needed.

## Delivery and verification

Implement the URL feature and reading task in separate review steps. Verify refresh/direct links, A/B switching, Back/Forward, login, unavailable projects, loading/error retry, and actual project deletion with isolated browser data. Verify disclosure defaults, full original text, repeat visits, edits and narrow layouts. Run repository checks and affected browser flows, then record actual results in the development log.

This request authorizes local development and updates to the existing Zhixu work records. Source commit/push, publication, deployment and production acceptance are separate actions. A locally verified task remains `githubStatus=not_submitted` until a remote push is verified.

## Local verification result

On 2026-11-19, both work items passed source review. `npm run check` passed formatting, TypeScript, all 178 unit/integration tests and the production build. `npm run test:e2e` passed all 28 isolated Chrome scenarios, including seven new navigation scenarios and three new description/disclosure scenarios. Desktop and 390-pixel screenshots were visually reviewed. Tests used temporary or in-memory databases; delayed and failed responses were injected only into the isolated browser tests.

The navigation review also verified that responses from an earlier navigation visit cannot reopen its review dialog or close a newer project's editor. Those requests remain discoverable through the existing pending view. Original descriptions, editor contents and card introduction rules passed the regression checks. No source commit/push or deployment was performed; the deployed website requires a separately authorized update and production acceptance.

After reviewing the implementation report, the user authorized committing and pushing the source changes on the existing working branch. Remote delivery will be verified before the original Zhixu records are updated with the commit link and submitted state. This authorization does not include merging, image publication or deployment.
