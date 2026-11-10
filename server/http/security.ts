import { isIP } from 'node:net';
import type { RequestHandler } from 'express';
import { AppError } from '../domain/errors';

export interface SecurityConfig {
  publicUrl?: string;
  sessionSecret?: string;
  trustedProxies: string[];
}
export function securityConfig(env: NodeJS.ProcessEnv = process.env): SecurityConfig {
  const publicUrl = env.HUB_PUBLIC_URL;
  const sessionSecret = env.HUB_SESSION_SECRET;
  const trustedProxies = (env.HUB_TRUST_PROXY ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  for (const entry of trustedProxies) {
    const [ip, prefix, extra] = entry.split('/');
    const version = isIP(ip);
    if (
      !version ||
      extra !== undefined ||
      (prefix !== undefined &&
        (!/^(0|[1-9]\d*)$/.test(prefix) || +prefix < 0 || +prefix > (version === 4 ? 32 : 128)))
    )
      throw new Error(
        'HUB_TRUST_PROXY must be an explicit list of proxy IP addresses or CIDRs, not true or hop counts.',
      );
    if (prefix === '0') throw new Error('HUB_TRUST_PROXY must not trust all internet addresses.');
  }
  if (publicUrl !== undefined) {
    let url: URL;
    try {
      url = new URL(publicUrl);
    } catch {
      throw new Error('HUB_PUBLIC_URL must be a canonical HTTPS origin.');
    }
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash ||
      publicUrl.replace(/\/$/, '') !== url.origin
    )
      throw new Error(
        'HUB_PUBLIC_URL must be a canonical HTTPS origin without a path, credentials, query or fragment.',
      );
    if (!sessionSecret || sessionSecret.length < 48)
      throw new Error(
        'Remote mode requires HUB_SESSION_SECRET with at least 48 random characters.',
      );
    if (!trustedProxies.length)
      throw new Error(
        'Remote mode requires explicit HUB_TRUST_PROXY IP addresses or CIDRs for the HTTPS reverse proxy.',
      );
    return { publicUrl: url.origin, sessionSecret, trustedProxies };
  }
  if (trustedProxies.length) throw new Error('HUB_TRUST_PROXY requires HUB_PUBLIC_URL.');
  if (sessionSecret !== undefined && sessionSecret.length < 48)
    throw new Error('HUB_SESSION_SECRET must contain at least 48 characters.');
  return { sessionSecret, trustedProxies };
}

function hostUrl(host: string | undefined): URL | undefined {
  if (!host || /[\s,/@?#\\]/.test(host)) return;
  try {
    const url = new URL('http://' + host);
    if (url.pathname !== '/' || !url.hostname) return;
    return url;
  } catch {
    return;
  }
}
const localHost = (hostname: string) => ['127.0.0.1', 'localhost', '[::1]'].includes(hostname);
export function requestSecurity(config: SecurityConfig): RequestHandler {
  return (req, res, next) => {
    const rawHost = hostUrl(req.get('Host'));
    const health = req.path === '/api/health' && ['GET', 'HEAD'].includes(req.method);
    if (
      !rawHost ||
      (config.publicUrl
        ? rawHost.host !== new URL(config.publicUrl).host &&
          !(health && localHost(rawHost.hostname))
        : !localHost(rawHost.hostname))
    )
      return next(new AppError('INVALID_HOST', '请求主机不在允许范围内', 403));
    // Host is checked directly; X-Forwarded-Host never selects the origin or issuer.
    if (config.publicUrl && !health && !req.secure)
      return next(new AppError('HTTPS_REQUIRED', '此服务必须通过可信 HTTPS 代理访问', 400));
    const origin = req.get('Origin');
    if (origin) {
      let valid = false;
      try {
        const url = new URL(origin);
        valid =
          origin === url.origin &&
          (config.publicUrl
            ? origin === config.publicUrl
            : url.protocol === 'http:' && localHost(url.hostname));
      } catch {
        /* Invalid origins are rejected. */
      }
      // Token clients normally have no Origin. Browser cross-origin requests are not supported.
      if (!valid) return next(new AppError('INVALID_ORIGIN', '请求来源不在允许范围内', 403));
    }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; connect-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    if (config.publicUrl && req.secure)
      res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    next();
  };
}
