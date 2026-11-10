import { resolve } from 'node:path';
import { Repository } from '../server/infrastructure/database';
import { passwordSchema } from '../shared/schema';
import { hashPassword } from '../server/http/auth';
const password = passwordSchema.parse(process.env.HUB_RESET_PASSWORD);
const repository = new Repository(resolve(process.env.HUB_DATA_DIR ?? 'data', 'hub.db'));
if (!repository.account()) {
  repository.close();
  throw new Error('No account exists. Use the first-run setup page.');
}
const { salt, hash } = hashPassword(password);
repository.setPassword(salt, hash);
repository.close();
console.log('Password reset. Restart the server to revoke existing in-memory sessions.');
