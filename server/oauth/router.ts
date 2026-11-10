import express, { type Request, type RequestHandler, type ErrorRequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import { OAuthError, OAuthService, OAUTH_SCOPES, field } from './service';
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
export interface OAuthRouterOptions {
  service: OAuthService;
  authenticate: RequestHandler;
  isAuthenticated: (req: Request) => boolean;
  csrf: RequestHandler;
  userId: (req: Request) => string;
  csrfToken: (req: Request) => string;
  disableRateLimit?: boolean;
}
export function createOAuthRouter(options: OAuthRouterOptions) {
  const router = express.Router(),
    s = options.service;
  const limiter = (limit: number) =>
    options.disableRateLimit
      ? (((_req, _res, next) => next()) as RequestHandler)
      : rateLimit({
          windowMs: 600_000,
          limit,
          standardHeaders: 'draft-8',
          legacyHeaders: false,
          message: { error: 'temporarily_unavailable', error_description: 'Too many requests' },
        });
  router.use(
    ['/oauth', '/.well-known/oauth-authorization-server', '/.well-known/oauth-protected-resource'],
    (_req, res, next) => {
      res.set('Cache-Control', 'no-store');
      res.set('Pragma', 'no-cache');
      next();
    },
  );
  router.get('/.well-known/oauth-authorization-server', (_req, res) =>
    res.json({
      issuer: s.issuer,
      authorization_endpoint: `${s.issuer}/oauth/authorize`,
      token_endpoint: `${s.issuer}/oauth/token`,
      registration_endpoint: `${s.issuer}/oauth/register`,
      revocation_endpoint: `${s.issuer}/oauth/revoke`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      revocation_endpoint_auth_methods_supported: ['none'],
      scopes_supported: OAUTH_SCOPES,
    }),
  );
  router.get(
    ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp'],
    (_req, res) =>
      res.json({
        resource: s.resource,
        authorization_servers: [s.issuer],
        scopes_supported: OAUTH_SCOPES,
        bearer_methods_supported: ['header'],
        resource_name: 'Zhixu MCP',
      }),
  );
  router.post('/oauth/register', limiter(20), express.json({ limit: '16kb' }), (req, res) =>
    res.status(201).json(s.register(req.body ?? {})),
  );
  router.get('/oauth/authorize', limiter(60), (req, res) => {
    const id =
      req.query.request_id === undefined
        ? s.begin(req.query as Record<string, unknown>)
        : field(req.query as Record<string, unknown>, 'request_id');
    if (!options.isAuthenticated(req))
      return res.redirect(303, `/?oauth_request=${encodeURIComponent(id)}`);
    const consent = s.consent(id, options.userId(req), req.sessionID);
    // Chromium applies form-action to redirect destinations as well as the form POST.
    // The source comes only from the server-stored registered URI, never request query data.
    const callbackOrigin = new URL(consent.redirectUri).origin;
    if (!/^https?:\/\/(?:[a-z0-9.-]+|\[[a-f0-9:]+\])(?::\d+)?$/i.test(callbackOrigin))
      throw new OAuthError('invalid_request', 'Invalid callback origin');
    res.set(
      'Content-Security-Policy',
      `default-src 'none'; style-src 'unsafe-inline'; form-action 'self' ${callbackOrigin}; frame-ancestors 'none'; base-uri 'none'`,
    );
    // Preserve same-origin POST Origin while suppressing Referer at the external callback.
    res.set('Referrer-Policy', 'same-origin');
    res
      .type('html')
      .send(
        `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>授权 MCP 应用 · 知序</title><style>body{font:18px system-ui;max-width:620px;margin:60px auto;padding:24px;line-height:1.7}button{padding:12px 24px;margin:12px 12px 0 0}code{overflow-wrap:anywhere}</style><h1>授权 MCP 应用</h1><p><strong>${escape(consent.clientName)}</strong> 请求访问你的知序账户。应用名称由申请方提供，并非已验证身份。</p><p>授权后将返回：<code>${escape(consent.redirectUri)}</code></p><ul>${consent.scopes.map((scope) => `<li>${escape(scope)}：${({ 'hub:read': '读取项目与记录', 'hub:create': '创建新记录', 'hub:propose': '提交修改或删除提案，仍需你在网页确认' } as Record<string, string>)[scope]}</li>`).join('')}</ul><p>仅在你信任此应用且主动发起连接时允许。可在账户页面撤销授权。</p><p>本次允许将替换此应用之前的授权，并使旧连接凭证失效。</p><form method="post" action="/oauth/authorize"><input type="hidden" name="request_id" value="${escape(id)}"><input type="hidden" name="csrfToken" value="${escape(options.csrfToken(req))}"><button name="decision" value="deny">拒绝</button><button name="decision" value="allow">允许授权</button></form></html>`,
      );
  });
  router.post(
    '/oauth/authorize',
    limiter(60),
    express.urlencoded({ extended: false, limit: '8kb' }),
    options.authenticate,
    options.csrf,
    (req, res) => {
      const decision = field(req.body ?? {}, 'decision');
      if (!['allow', 'deny'].includes(decision)) throw new OAuthError('invalid_request');
      res.redirect(
        303,
        s.decide(
          field(req.body ?? {}, 'request_id'),
          options.userId(req),
          req.sessionID,
          decision === 'allow',
        ),
      );
    },
  );
  router.post(
    '/oauth/token',
    limiter(100),
    express.urlencoded({ extended: false, limit: '8kb' }),
    (req, res) => res.json(s.token(req.body ?? {})),
  );
  router.post(
    '/oauth/revoke',
    limiter(100),
    express.urlencoded({ extended: false, limit: '8kb' }),
    (req, res) => {
      s.revoke(req.body ?? {});
      res.status(200).end();
    },
  );
  const errorHandler: ErrorRequestHandler = (error, _req, res, next) => {
    if (error instanceof OAuthError)
      res.status(error.status).json({ error: error.error, error_description: error.message });
    else next(error);
  };
  router.use(errorHandler);
  return router;
}
