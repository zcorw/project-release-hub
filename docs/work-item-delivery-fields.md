# Work-item delivery fields

[简体中文](work-item-delivery-fields.zh-CN.md)

Confirmed request: all projects' tasks and issues have independent development/verification and GitHub submission fields. Existing workflow status remains unchanged.

Implementation defaults: `developmentStatus` = `unknown | not_developed | unverified | verified`; `githubStatus` = `unknown | not_submitted | submitted`. Unknown is an explicit compatibility state, never inferred from done/resolved. Submitted means pushed to GitHub, not just a local commit, merge, or deployment. Verification scope and commit/PR evidence remain in description rather than adding more base fields.

Shared optional wire fields preserve legacy request fingerprints and omitted values on updates. New manual records default to not_developed/not_submitted; omitted API values default to unknown. Schema v3 migrates only missing current-record values; history and request payloads are immutable. Historical reads/undo normalize missing values to unknown. No production database is opened during development.

Verification on November 17, 2026: full `npm run check` passed (format, TypeScript, 159 unit/integration tests, production build). All 15 Chrome browser tests passed, including task/issue field display, filters, edit cancellation/reopening, submitted values and mobile viewport. New field browser cases use mocked transport; existing browser suites exercise real local API workflows. Migration checks use disposable SQLite databases. No production data was opened and no deployment was performed. The user subsequently authorized a source commit, push and pull request; merging and deployment remain out of scope.
