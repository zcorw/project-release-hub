# Project Conventions

## Language and encoding

Chinese UI; English documentation, comments, and identifiers. UTF-8 without BOM. TypeScript strict mode.

## Architecture

Presentation and transport adapters call the shared application service. Shared Zod schemas define contracts. Domain rules are independent of Express, MCP, and React. SQLite access is isolated behind the repository. Keep modules focused.

## Data and API

UUID identifiers; camelCase JSON; UTC ISO timestamps. Validate inputs before persistence. Maximum 20 operations per atomic batch. Request IDs are idempotent and payload-bound. Revisions protect against lost updates. Avoid cascades; block deletion of active referenced records.

## Write safety

Additions save directly except project duplicates. Updates/deletes and undo require authenticated web confirmation. MCP may propose changes, never approve them. Audit every applied mutation. Undo refuses to overwrite newer revisions or break references. Keep feature completion, CI success, and release/deployment state separate.

## Frontend

Reuse React Hook Form + Zod + zodResolver and Radix Dialog, as already used by tts-workbench. Include labeled fields, accessible errors, focus behavior, and submit locking. Model loading, empty, error, and retry states. Keep API access in a dedicated client.

## Security

Local loopback by default. Single-user password hashing and session auth. CSRF protection for web writes. MCP uses a separate configured token and never a web session. Never store secrets in source, logs, API results, or documentation. No arbitrary URL fetching: GitHub requests target api.github.com with validated owner/repo paths. Do not initiate deployments or workflow runs.

## Checks and delivery

Run format check, type check, unit/integration tests, build, and applicable browser checks. Report failures and unrun checks separately. Keep startup/backup/restore instructions current. No commit, push, publish, deployment, or persistent external access is included.

## Dependencies

Use maintained npm packages for HTTP, validation, forms, dialogs, MCP, and SQLite. Built-in cryptographic primitives are appropriate for password hashing. Lock exact resolved packages in package-lock.json.
