# Architecture

Status: single-owner application with optional HTTPS/OAuth and direct MCP writes, 2026-11-13.

- React + TypeScript + Vite client with Radix Dialog, React Hook Form and Zod.
- Express + TypeScript HTTP server and the official MCP SDK.
- A shared application service validates writes, resolves references, detects duplicates, applies authorized MCP batches directly, stages manual web changes, applies approvals, and records audit snapshots. MCP duplicate review gates only newly created projects; existing-project similarity is informational. Both direct and confirmed writes use the same transactional plan/apply path.
- SQLite via better-sqlite3 provides local persistence, transactions, sessions, and audit history.
- Proposal reconciliation stores base snapshots in request JSON, recovers legacy bases from complete audit snapshots, and compares base/current/proposed fields. Authenticated web preview/generation routes create a linked pending replacement atomically; those replacements still require separate web confirmation. Historical pending requests are never automatically applied. No database schema migration or new MCP tool is required for direct writes.

## Boundaries

shared/ contains entity contracts. server/domain/ owns entity invariants. server/application/ owns workflows. server/infrastructure/ owns persistence. server/http/ and server/mcp/ are transport adapters. web/ owns presentation.

## Account and transport security

Loopback remains the default. Local setup creates one owner; remote setup is disabled. SQLite sessions have idle/absolute expiry and account-version revocation. Browser writes require CSRF. Optional HTTPS mode requires a canonical origin, stable session secret, explicit proxy trust and Secure cookies. server/oauth owns discovery, consent, PKCE, scoped resource-bound credentials and revocation. Local MCP may use a static token; remote MCP uses OAuth. hub:propose now permits direct updates/deletes, including existing grants, under the owner's superseding instruction. Neither transport grants web account/approval privileges. Multi-user isolation and live deployment verification are not implemented. See account-oauth.md and mcp-direct-writes-plan.md.

## State distinctions

Feature completion, CI success, and release/deployment status are independent. Refreshing Actions never writes a release state. All environment/release states are manually recorded facts.

## Recovery

All user records and history are in the SQLite database. Take an offline copy of the data directory after stopping the server, or use an online SQLite-aware backup process. Do not copy only the main file while WAL writes are active. Restore only while the server is stopped.
