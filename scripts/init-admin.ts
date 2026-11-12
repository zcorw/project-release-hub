import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Repository } from '../server/infrastructure/database';
import { hashPassword } from '../server/http/auth';
import { passwordSchema } from '../shared/schema';
import {
  PasswordInputError,
  readConfirmedPassword,
  readPasswordStdin,
} from './lib/terminal-password';

export class AdminInitializationError extends Error {}

const existingAccount = 'Administrator already exists; initialization will not overwrite it.';
const usage = `Usage: npm run init-admin [-- --password-stdin]

Create the first administrator in the existing HUB_DATA_DIR/hub.db.
From the VPS project directory: docker compose -p zhixu -f compose.yml exec app npm run init-admin
The default interactive mode hides the password and asks for confirmation.
For automation, --password-stdin reads one password line until EOF without confirmation.
Passwords must be 12-128 characters. Password arguments/environment variables are not accepted.
Existing accounts are never replaced. Refresh the web page after success; no restart is needed.`;

export function initializeAdministrator(
  repository: Repository,
  password: string,
  confirmation: string,
): void {
  if (repository.account()) throw new AdminInitializationError(existingAccount);
  const parsed = passwordSchema.safeParse(password);
  if (!parsed.success)
    throw new AdminInitializationError('Password must contain 12-128 characters.');
  if (password !== confirmation) throw new AdminInitializationError('Passwords do not match.');
  const { salt, hash } = hashPassword(parsed.data);
  repository.transaction(() => {
    if (!repository.createAccount(salt, hash)) throw new AdminInitializationError(existingAccount);
    repository.securityEvent('account_created');
  });
}

export async function runInitAdmin(args = process.argv.slice(2)): Promise<void> {
  if (args.length === 1 && args[0] === '--help') {
    console.log(usage);
    return;
  }
  const fromStdin = args.length === 1 && args[0] === '--password-stdin';
  if (args.length && !fromStdin)
    throw new AdminInitializationError('Unsupported arguments. Run npm run init-admin -- --help.');
  const path = resolve(process.env.HUB_DATA_DIR ?? 'data', 'hub.db');
  if (!existsSync(path))
    throw new AdminInitializationError(
      'Application database not found. Start the app first and use its HUB_DATA_DIR/container.',
    );
  const repository = new Repository(path);
  try {
    if (repository.account()) throw new AdminInitializationError(existingAccount);
    if (!fromStdin && (!process.stdin.isTTY || !process.stdout.isTTY))
      throw new AdminInitializationError(
        'An interactive terminal is required. Use docker compose exec without -T, or explicitly use --password-stdin for automation.',
      );
    const credentials = fromStdin
      ? await readPasswordStdin().then((password) => ({ password, confirmation: password }))
      : await readConfirmedPassword();
    initializeAdministrator(repository, credentials.password, credentials.confirmation);
    console.log(
      'Administrator initialized. Refresh the web page and log in; no restart is needed.',
    );
  } finally {
    repository.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runInitAdmin().catch((error: unknown) => {
    console.error(
      error instanceof AdminInitializationError || error instanceof PasswordInputError
        ? error.message
        : 'Initialization failed. Check database access, permissions and schema compatibility.',
    );
    process.exitCode = 1;
  });
}
