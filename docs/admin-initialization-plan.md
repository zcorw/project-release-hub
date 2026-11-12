# Local administrator initialization

## Confirmed request

Provide a short script command for creating the first administrator directly inside the VPS Docker container, replacing the long inline operator command. This authorizes local implementation and isolated verification, not operating a live VPS, publishing an image or pushing source.

## Decisions recorded before implementation

- Add scripts/init-admin.ts and npm run init-admin. Use the existing container user, HUB_DATA_DIR and hub.db; require the application database to exist so a mistyped directory cannot silently create a separate owner database.
- Default to an interactive terminal with hidden password and confirmation. Reuse the shared 12-128 character password schema and existing scrypt hashing. Do not accept passwords in arguments or environment variables. Provide an explicit --password-stdin option for controlled automation; never echo input.
- Refuse existing accounts before prompting and check atomic insertion again inside a transaction. Create the account and its account_created security event together. Preserve existing passwords, sessions, OAuth credentials and business records on refusal/failure.
- Keep remote web setup disabled. This is a privileged local operator path and may be used when HTTPS/OAuth is already enabled. The running application reads the account from SQLite on subsequent requests, so successful initialization needs only a page refresh.
- Include the script and terminal helper in the Docker build allowlist. Document a TTY-based docker compose exec command and make non-TTY misuse fail clearly. Existing images need a rebuild/republication before they contain the new script; this implementation does not publish them.
- Verify validation/confirmation, hashing/audit, existing-account protection, transaction rollback, remote status/login without restart, hidden/cancelled terminal input, stdin failure handling and the packaged command in an isolated container. Use disposable databases/volumes only.
