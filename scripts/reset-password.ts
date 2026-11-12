import { resolve } from 'node:path';
import { Repository } from '../server/infrastructure/database';
import { passwordSchema } from '../shared/schema';
import { hashPassword } from '../server/http/auth';
const password = passwordSchema.parse(process.env.HUB_RESET_PASSWORD);
const repository = new Repository(resolve(process.env.HUB_DATA_DIR ?? 'data', 'hub.db'));
if (!repository.account()) {
  repository.close();
  throw new Error('No account exists. Run npm run init-admin first.');
}
const { salt, hash } = hashPassword(password);
repository.setPassword(salt, hash);
repository.close();
console.log('Password reset. All browser sessions and OAuth credentials have been invalidated.');
