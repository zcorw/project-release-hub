import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
declare module 'express-session' {
  interface SessionData {
    authenticated?: boolean;
    csrfToken?: string;
  }
}
export function hashPassword(password: string): { salt: string; hash: string } {
  const salt = randomBytes(16).toString('hex');
  return { salt, hash: scryptSync(password, salt, 64).toString('hex') };
}
export function verifyPassword(password: string, account: { salt: string; hash: string }): boolean {
  const expected = Buffer.from(account.hash, 'hex'),
    actual = scryptSync(password, account.salt, 64);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
export function csrfToken(request: Request): string {
  return (request.session.csrfToken ??= randomBytes(32).toString('hex'));
}
export async function newSession(request: Request, authenticated: boolean): Promise<void> {
  await new Promise<void>((resolve, reject) =>
    request.session.regenerate((error) => (error ? reject(error) : resolve())),
  );
  request.session.authenticated = authenticated;
  csrfToken(request);
}
