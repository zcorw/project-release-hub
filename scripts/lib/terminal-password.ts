import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';

export class PasswordInputError extends Error {}

export async function readConfirmedPassword(
  input: NodeJS.ReadableStream = process.stdin,
  output: NodeJS.WritableStream = process.stdout,
): Promise<{ password: string; confirmation: string }> {
  // Readline handles editing and raw-mode restoration; its echo goes only to this sink.
  const muted = new Writable({ write: (_chunk, _encoding, done) => done() });
  const terminal = createInterface({ input, output: muted, terminal: true, historySize: 0 });
  const controller = new AbortController();
  const cancel = () => controller.abort();
  terminal.on('SIGINT', cancel);
  terminal.on('close', cancel);
  try {
    output.write('Administrator password (12-128 characters, hidden): ');
    const password = await terminal.question('', { signal: controller.signal });
    output.write('\nConfirm password (hidden): ');
    const confirmation = await terminal.question('', { signal: controller.signal });
    output.write('\n');
    return { password, confirmation };
  } catch {
    output.write('\n');
    throw new PasswordInputError('Initialization cancelled; no account was created.');
  } finally {
    terminal.close();
    terminal.removeListener('SIGINT', cancel);
    terminal.removeListener('close', cancel);
    muted.destroy();
  }
}

export async function readPasswordStdin(
  input: NodeJS.ReadableStream = process.stdin,
): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of input) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > 1024) throw new PasswordInputError('Password input is too long.');
    chunks.push(bytes);
  }
  const password = Buffer.concat(chunks)
    .toString('utf8')
    .replace(/\r?\n$/, '');
  if (/[\r\n]/.test(password))
    throw new PasswordInputError('--password-stdin requires exactly one password line.');
  return password;
}
