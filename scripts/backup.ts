import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
const argument = process.argv[2];
if (!argument) throw new Error('Usage: npm run backup -- <new-backup-file.db>');
const source = resolve(process.env.HUB_DATA_DIR ?? 'data', 'hub.db'),
  target = resolve(argument);
if (source.toLocaleLowerCase() === target.toLocaleLowerCase())
  throw new Error('The backup destination must differ from the live database.');
if (existsSync(target))
  throw new Error('The backup destination already exists. Choose a new filename.');
mkdirSync(dirname(target), { recursive: true });
const database = new Database(source, { readonly: true, fileMustExist: true });
try {
  await database.backup(target);
  console.log(`SQLite backup created: ${target}`);
} finally {
  database.close();
}
