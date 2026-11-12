# Native account and MCP OAuth

## Scope

The user requested Zhixu's own account system and MCP OAuth without nest-account, then authorized source publication after completion. This preserves a single owner, existing scrypt passwords, SQLite, and project records. It does not deploy a service, provision a domain/certificate, connect ChatGPT, or provide multi-user isolation. Protocol tests are not an independent penetration test.

## Accounts and migration

- Schema version 2 adds authentication versions, persistent sessions and security events without replacing account or business records. Newer unsupported schema versions fail closed. Back up before upgrading.
- Setup is available only in local mode. Remote mode always rejects setup; initialize privately through loopback or an SSH tunnel before enabling HTTPS/OAuth. Existing databases need no password reset.
- Session identifiers are SHA-256-hashed in SQLite. Sessions expire after 12 hours idle or 7 days absolute. A stable HUB_SESSION_SECRET preserves login across restarts; without it local mode still requires login after restart.
- Login and password change rotate session IDs and CSRF tokens. Password change verifies the current password, retains the current browser under a new session, and invalidates other sessions and all OAuth credentials.
- Account security controls list/revoke sessions and OAuth grants. Logout-all ends the current browser and invalidates all OAuth credentials. Ordinary logout affects only its browser session.
- The existing offline reset-password command increments the same authentication version, invalidating browser and OAuth credentials. It never prints the password.
- Account security audit retains 1,000 events. OAuth audit retains the newest 1,000 events, at most 90 days; cleanup occurs on new events. The UI shows at most 100 combined events. Business mutation history is unchanged.

Backups include password hashes, session state and hashed OAuth credentials. Keep them private. A restored older backup can restore previously revoked state: reset the password and rotate HUB_SESSION_SECRET before exposing a restored instance. Image-only rollback is not a database migration rollback.

## Remote configuration

Native npm startup reads the shell/service environment, not .env. Docker Compose and scripts/update-vps.sh read the repository-root .env and forward PORT plus the five documented GitHub/MCP/OAuth settings, with shell values taking precedence. Keep unused optional settings commented out. Configure secrets outside Git and chat:

- HUB_PUBLIC_URL: canonical HTTPS origin, such as https://zhixu.example.com. No path, query, fragment or credentials.
- HUB_SESSION_SECRET: at least 48 cryptographically random characters, generated and securely stored once. Rotation logs out browsers; use logout-all to also revoke OAuth.
- HUB_TRUST_PROXY: comma-separated explicit proxy IP addresses/CIDRs. Never true, hop counts or /0.
- HUB_BIND_HOST: 127.0.0.1 natively, or 0.0.0.0 only inside a container published to host loopback.
- HUB_DATA_DIR: retain the existing persistent directory.
- Remove HUB_MCP_TOKEN. Combining local static credentials with remote OAuth is rejected at startup.

Compose and the VPS updater keep the backend loopback-only and accept PORT plus the documented GitHub/MCP/OAuth environment settings. PORT selects the same application/container/host port (default 4310, range 1024-65535); keep the reverse proxy upstream aligned with it. Container HUB_BIND_HOST and HUB_DATA_DIR stay fixed at 0.0.0.0 and /app/data. Other runtime environment keys, custom commands, storage changes and public port publication remain rejected. The operator still configures and validates the actual HTTPS proxy, domain and certificate independently; no live deployment is claimed.

The direct proxy seen inside Docker may be the bridge gateway, not 127.0.0.1. Inspect the actual topology and trust its narrow address, not a guessed subnet. Never publish the upstream port to the internet. Host filtering is not protection against a direct client forging Host: localhost in local mode.

Remote requests require the canonical Host and HTTPS reported by a trusted peer. Issuer URLs never come from Host or X-Forwarded-Host. Foreign/null Origin headers are rejected. The consent page uses same-origin Referrer-Policy to preserve same-origin form POST Origin and suppress Referer at the cross-origin callback; its CSP permits form redirects only to the registered callback origin. Cookies use __Host-hub.sid, Secure, HttpOnly, Path=/ and SameSite=Lax; Lax permits a client-to-consent navigation while CSRF remains required on browser writes and consent.

### Reverse proxy checklist

1. Initialize privately and take a consistent SQLite backup.
2. Configure a valid certificate for the canonical origin and HTTP-to-HTTPS redirects.
3. Keep the upstream loopback-only and explicitly configure the actual trusted proxy peer.
4. Forward the original Host, overwrite X-Forwarded-Proto with the verified scheme and X-Forwarded-For with the direct client address, and discard incoming X-Forwarded-Host/Forwarded. Do not rewrite Host to evade validation.
5. Apply edge request/body/rate/time limits. In-process rate limits reset on restart and do not replace edge abuse protection.
6. On the real deployment verify health, cookies, login/logout, password/session revocation, hostile Host/Origin rejection, consent, token refresh/revoke and MCP scopes.

For a controlled Nginx HTTPS server block, the relevant directives are proxy_pass http://127.0.0.1:4310, proxy_http_version 1.1, proxy_set_header Host $http_host, proxy_set_header X-Forwarded-Proto $scheme, proxy_set_header X-Forwarded-For $remote_addr, empty X-Forwarded-Host and Forwarded headers, and proxy_buffering off. Certificates, unknown-host rejection and the actual proxy topology still need operator validation. No live Nginx setup is claimed.

## OAuth endpoints

- GET /.well-known/oauth-authorization-server
- GET /.well-known/oauth-protected-resource and /.well-known/oauth-protected-resource/mcp
- POST /oauth/register
- GET/POST /oauth/authorize
- POST /oauth/token
- POST /oauth/revoke
- POST /mcp

Unauthenticated MCP returns WWW-Authenticate with its protected-resource metadata URL. The resource/audience is exactly HUB_PUBLIC_URL plus /mcp. The issuer is the configured origin.

Registration accepts public clients with token_endpoint_auth_method=none and no client secret. Supply redirect_uris and preferably client_name. Redirects must be exact registered HTTPS URLs, or explicit HTTP loopback URLs for native callbacks. Fragments, credentials and control characters are rejected. Client names are unverified display data. No arbitrary metadata URLs are fetched. Redirect matching includes the exact callback port; wildcards are not supported.

Authorization requires response_type=code, client_id, exact redirect_uri, scope, resource, code_challenge_method=S256 and code_challenge. State is returned unchanged when present. A 10-minute opaque server-side request carries validated fields through login. The browser resumes only a fixed same-origin route, never a client-supplied return URL. Rendered consent binds to the authenticated session/account version. Every grant requires explicit consent showing the application, redirect and scopes; allow/deny requires CSRF. Approval replaces earlier authorization for the same client, revoking its old credentials and bound consent requests before the new code is issued. The consent page states this replacement behavior.

Authorization codes last 60 seconds and are single-use. Form-encoded exchange requires grant_type=authorization_code, client_id, code, redirect_uri, code_verifier and resource. Refresh requires grant_type=refresh_token, client_id, refresh_token and resource. Optional scope can only narrow prior scope. Official SDK 1.32.2 resource-aware refresh is tested.

Access tokens last 10 minutes; refresh tokens last 7 days and rotate on refresh. Secrets are stored only as hashes. Reusing a consumed code/refresh token revokes its family, including issued access tokens. Normal refresh leaves existing unexpired access tokens valid. Revocation accepts client_id and token; it revokes the token family. Account grant revocation invalidates all credentials/consents for that client. Password/reset/logout-all invalidates the account's credentials.

Single-owner capacity guards: 1,000 clients, 1,000 live consent intents and 20,000 credential rows. Capacity returns temporarily_unavailable rather than growing indefinitely. Cleanup removes expired intents and expired/used access rows. Consumed code/refresh replay evidence remains until no usable family descendants exist. Unreferenced unused registrations older than 30 days may be removed. Client usage timestamps are updated on successful access-token verification.

## MCP scopes and human approval

- hub:read: list records, submitted-request outcomes and pending proposals.
- hub:create: submit additions; duplicate-project review remains.
- hub:propose: submit updates/deletes as pending proposals.
- Mixed batches require every corresponding scope.

No scope grants web account access, approval, rejection or undo. A bearer token cannot replace a web session/CSRF on web routes. MCP exposes no approval tool. Creates apply only under existing validation/duplicate rules; batches with updates/deletes remain pending until the owner approves the exact proposal in the web UI. Revisions, idempotency and business audit remain enforced.

## ChatGPT and verification limits

Once a real HTTPS endpoint has been independently verified, use its /mcp URL in the client's supported custom-connector flow with OAuth/discovery. Complete owner login and explicit consent. This server supports dynamic public registration, so it does not require a pre-created client secret.

No real ChatGPT connector, public domain, certificate, firewall or proxy was configured. Client-specific compatibility still needs a live connection test. See verification.md for isolated automated checks, including official SDK protocol integration and real-backend Chrome password/session flows.
