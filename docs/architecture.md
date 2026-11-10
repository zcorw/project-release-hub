# Architecture

Status: local MVP design, 2026-11-10.

- React + TypeScript + Vite client with Radix Dialog, React Hook Form and Zod.
- Express + TypeScript HTTP server and the official MCP SDK.
- A shared application service validates writes, resolves references, detects duplicates, stages changes, applies approvals, and records audit snapshots.
- SQLite via better-sqlite3 provides local persistence, transactions, sessions, and audit history.

## Boundaries

shared/ contains entity contracts. server/domain/ owns entity invariants. server/application/ owns workflows. server/infrastructure/ owns persistence. server/http/ and server/mcp/ are transport adapters. web/ owns presentation.

## Local security

The server binds to loopback. First-run setup creates one hashed-password account. Authenticated web sessions receive a CSRF token for writes. MCP uses a separately configured token and has no approval tool. Public HTTPS, OAuth, multi-user access, and production hardening are separate future work.

## State distinctions

Feature completion, CI success, and release/deployment status are independent. Refreshing Actions never writes a release state. All environment/release states are manually recorded facts.

## Recovery

All user records and history are in the SQLite database. Take an offline copy of the data directory after stopping the server, or use an online SQLite-aware backup process. Do not copy only the main file while WAL writes are active. Restore only while the server is stopped.
