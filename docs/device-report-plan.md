# Device report authorization increment

## Decision and boundary

The existing OAuth resource is `/mcp`, while `/api/snapshot` requires a browser session. Neither is an appropriate glasses credential. Do not copy a browser session, administrator token, or unrestricted MCP credential onto a device.

This increment provides a testable, opt-in router factory and separate grant store for a future report transport. It is deliberately **not mounted by the application**. No production settings, live grants, existing OAuth behavior, or database startup schema are changed. Tests mount the router against synthetic in-memory records only.

A trusted future consent controller may call `createApprovedGrant` only after authenticated, CSRF-protected owner consent to the exact device and project selection. The method is not an HTTP endpoint and does not itself prove consent. The only scope is `reports:read`; tokens last at most 15 minutes, have no refresh mechanism, are stored hashed, and are bound to this server's report resource and account authentication version. A future unbinding controller must call `revokeDevice` to revoke all grants for that device; no unbinding UI or route is connected yet. Password changes invalidate grants. Reconnection must reauthenticate every request, never infer authorization from a previous connection.

The GET-only router returns a deliberately reduced flat entity shape: project name/status and task/feature/issue title/status/update time, limited to authorized, nondeleted projects. It does not return descriptions, repository/environment URLs, history, pending changes, releases, or Actions metadata. A missing project after issuance removes its children too. Empty project selection is invalid; it never means all projects. The server selects the resource, not a client query parameter. Responses and errors are non-cacheable. Write methods are rejected.

## Verification and remaining work

Synthetic HTTP integration tests cover grant issuance to read, project isolation, field minimization, no cookie fallback, token hashing, expiry, revocation, password invalidation, resource separation, and method rejection. No device acceptance or live OAuth integration is claimed.

Before mounting: implement owner-facing consent/pairing with CSRF and rate limits, audited issuance/revocation and a bounded expired-grant retention policy; securely deliver the short-lived secret to the exact device; decide explicit renewal/reapproval UX; integrate the device transport; review canonical HTTPS/proxy settings and report compatibility; perform authorized staging and physical-device tests. Push notification transport remains separate. Do not expose `createApprovedGrant` as an unauthenticated issuance API.

## Subsequent isolated pairing increment

`device-pairing-plan.md` describes the opt-in lifecycle router now joining synthetic owner approval to claim, scoped read, renewal and unbinding. It remains unmounted; the browser consent UI, production guard/rate limits, and device credential persistence are still rollout gates. The earlier no-refresh description applies to the foundation alone, not the new opt-in lifecycle.
