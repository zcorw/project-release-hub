# Architecture

Status: single-owner application with optional HTTPS/OAuth, 2026-11-10.

- React + TypeScript + Vite client with Radix Dialog, React Hook Form and Zod.
- Express + TypeScript HTTP server and the official MCP SDK.
- A shared application service validates writes, resolves references, detects duplicates, stages changes, applies approvals, and records audit snapshots.
- SQLite via better-sqlite3 provides local persistence, transactions, sessions, and audit history.
- Proposal reconciliation stores base snapshots in request JSON, recovers legacy bases from complete audit snapshots, and compares base/current/proposed fields. Authenticated web preview/generation routes create a linked pending replacement atomically; the normal confirmation path remains the only application boundary. No database schema migration or new MCP capability is required.

## Boundaries

shared/ contains entity contracts. server/domain/ owns entity invariants. server/application/ owns workflows. server/infrastructure/ owns persistence. server/http/ and server/mcp/ are transport adapters. web/ owns presentation.

## Account and transport security

Loopback remains the default. Local setup creates one owner; remote setup is disabled. SQLite sessions have idle/absolute expiry and account-version revocation. Browser writes require CSRF. Optional HTTPS mode requires a canonical origin, stable session secret, explicit proxy trust and Secure cookies. server/oauth owns discovery, consent, PKCE, scoped resource-bound credentials and revocation. Local MCP may use a static token; remote MCP uses OAuth. Neither grants web approval privileges. Multi-user isolation and live deployment verification are not implemented. See account-oauth.md.

## State distinctions

Feature completion, CI success, and release/deployment status are independent. Refreshing Actions never writes a release state. All environment/release states are manually recorded facts.

## Recovery

All user records and history are in the SQLite database. Take an offline copy of the data directory after stopping the server, or use an online SQLite-aware backup process. Do not copy only the main file while WAL writes are active. Restore only while the server is stopped.
