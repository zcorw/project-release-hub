import express, { type RequestHandler, type ErrorRequestHandler } from 'express';
import session from 'express-session';
import { rateLimit } from 'express-rate-limit';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z, ZodError } from 'zod';
import type { Repository } from '../infrastructure/database';
import { HubService } from '../application/hub';
import { AppError } from '../domain/errors';
import { loginSchema, passwordSchema } from '../../shared/schema';
import { csrfToken, hashPassword, verifyPassword, newSession } from './auth';
import type { ActionsSnapshot } from '../../shared/schema';
import { SqliteSessionStore, SESSION_IDLE_MS, sessionKey } from './session-store';
import { securityConfig, requestSecurity, type SecurityConfig } from './security';
import { OAuthService } from '../oauth/service';
import { createOAuthRouter } from '../oauth/router';
import { createMcpHandler } from '../mcp/handler';

export interface AppOptions {
  repository: Repository;
  sessionSecret?: string;
  security?: SecurityConfig;
  oauth?: OAuthService;
  disableRateLimit?: boolean;
  refreshActions?: (projectId: string) => Promise<ActionsSnapshot>;
  mcpHandler?: RequestHandler;
}
export function createApp(options: AppOptions) {
  const app = express(),
    hub = new HubService(options.repository);
  const security = options.security ?? securityConfig({});
  const oauth =
    options.oauth ??
    (security.publicUrl
      ? new OAuthService(options.repository, { issuer: security.publicUrl })
      : undefined);
  const store = new SqliteSessionStore(options.repository);
  app.disable('x-powered-by');
  app.set('trust proxy', security.trustedProxies);
  app.use(requestSecurity(security));
  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  if (!options.disableRateLimit)
    app.use(
      '/api/auth',
      rateLimit({
        windowMs: 15 * 60 * 1000,
        limit: 120,
        standardHeaders: 'draft-8',
        legacyHeaders: false,
      }),
    );
  app.use(express.json({ limit: '1mb' }));
  app.all(
    '/mcp',
    options.mcpHandler ??
      (oauth ? createMcpHandler(hub, undefined, oauth) : undefined) ??
      ((_req, _res, next) =>
        next(new AppError('MCP_DISABLED', 'MCP 未启用；请按本地配置说明设置令牌', 503))),
  );
  // Persist hashed session identifiers; the configured secret survives remote restarts.
  app.use(
    session({
      name: security.publicUrl ? '__Host-hub.sid' : 'hub.sid',
      store,
      secret: security.sessionSecret ?? options.sessionSecret ?? randomBytes(48).toString('hex'),
      resave: false,
      saveUninitialized: false,
      rolling: true,
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: !!security.publicUrl,
        path: '/',
        maxAge: SESSION_IDLE_MS,
      },
    }),
  );
  const authenticated = (req: express.Request) =>
    !!req.session.authenticated &&
    req.session.authVersion === options.repository.account()?.authVersion;
  app.use(async (req, _res, next) => {
    if (req.session.authenticated && !authenticated(req)) await newSession(req, false);
    next();
  });
  const auth: RequestHandler = (req, _res, next) =>
    authenticated(req) ? next() : next(new AppError('UNAUTHORIZED', '请先登录', 401));
  const csrf: RequestHandler = (req, _res, next) => {
    const given =
        req.get('X-CSRF-Token') ??
        (req.path === '/oauth/authorize' && typeof req.body?.csrfToken === 'string'
          ? req.body.csrfToken
          : ''),
      expected = req.session.csrfToken ?? '';
    if (
      !given ||
      !expected ||
      Buffer.byteLength(given) !== Buffer.byteLength(expected) ||
      !timingSafeEqual(Buffer.from(given), Buffer.from(expected))
    )
      return next(new AppError('CSRF_FAILED', '会话已更新，请刷新页面后重试', 403));
    next();
  };
  const status = (req: express.Request) => ({
    configured: !!options.repository.account(),
    authenticated: authenticated(req),
    setupAllowed: !security.publicUrl,
    oauthEnabled: !!oauth,
    ...(security.publicUrl ? { publicUrl: security.publicUrl } : {}),
    csrfToken: csrfToken(req),
  });
  const limiter = options.disableRateLimit
    ? (_req: express.Request, _res: express.Response, next: express.NextFunction) => next()
    : rateLimit({
        windowMs: 15 * 60 * 1000,
        limit: 10,
        standardHeaders: 'draft-8',
        legacyHeaders: false,
        message: { error: { code: 'RATE_LIMITED', message: '登录尝试过多，请 15 分钟后再试' } },
      });
  app.get('/api/auth/status', (req, res) => {
    res.set('Cache-Control', 'no-store').json(status(req));
  });
  app.post('/api/auth/setup', csrf, limiter, async (req, res) => {
    if (security.publicUrl)
      throw new AppError(
        'SETUP_DISABLED',
        '公网模式不允许初始化，请管理员先在本地完成账户设置',
        403,
      );
    const password = passwordSchema.parse(req.body?.password);
    if (options.repository.account())
      throw new AppError('ALREADY_CONFIGURED', '本机账户已经设置，请登录', 409);
    const hashed = hashPassword(password);
    if (!options.repository.createAccount(hashed.salt, hashed.hash))
      throw new AppError('ALREADY_CONFIGURED', '本机账户已经设置，请登录', 409);
    await newSession(req, true, options.repository.account()!.authVersion);
    options.repository.securityEvent('account_created');
    res.json(status(req));
  });
  app.post('/api/auth/login', csrf, limiter, async (req, res) => {
    const { password } = loginSchema.parse(req.body),
      account = options.repository.account();
    if (!account || !verifyPassword(password, account)) {
      options.repository.securityEvent('login_failed');
      throw new AppError('INVALID_CREDENTIALS', '密码不正确', 401);
    }
    await newSession(req, true, account.authVersion);
    options.repository.securityEvent('login_succeeded');
    res.json(status(req));
  });
  app.post('/api/auth/logout', csrf, async (req, res) => {
    await newSession(req, false);
    options.repository.securityEvent('logout');
    res.json(status(req));
  });
  if (oauth)
    app.use(
      createOAuthRouter({
        service: oauth,
        authenticate: auth,
        isAuthenticated: authenticated,
        csrf,
        csrfToken,
        userId: () => '1',
        disableRateLimit: options.disableRateLimit,
      }),
    );
  app.use('/api', auth, (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (!['GET', 'HEAD'].includes(req.method)) csrf(req, res, next);
    else next();
  });
  app.get('/api/account/security', (req, res) => {
    const grants = (oauth?.listGrants('1') ?? []).map((grant) => ({
      id: grant.clientId,
      clientName: grant.clientName,
      scope: grant.scope,
      createdAt: new Date(grant.createdAt).toISOString(),
      ...(grant.lastUsedAt ? { lastUsedAt: new Date(grant.lastUsedAt).toISOString() } : {}),
    }));
    const oauthEvents = (oauth?.securityEvents('1') ?? []).map((event) => ({
      id: String(event.id),
      event: event.event,
      createdAt: new Date(event.createdAt).toISOString(),
    }));
    res.json({
      sessions: store.list(req.sessionID),
      grants,
      events: [...options.repository.securityEvents(), ...oauthEvents]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 100),
    });
  });
  app.post('/api/account/password', limiter, async (req, res) => {
    const current = loginSchema.parse({ password: req.body?.currentPassword }).password;
    const password = passwordSchema.parse(req.body?.newPassword);
    const account = options.repository.account()!;
    if (!verifyPassword(current, account))
      throw new AppError('INVALID_CREDENTIALS', '密码不正确', 401);
    const hashed = hashPassword(password);
    options.repository.transaction(() => {
      options.repository.setPassword(hashed.salt, hashed.hash);
      oauth?.revokeUser('1');
    });
    await newSession(req, true, options.repository.account()!.authVersion);
    res.json(status(req));
  });
  app.post('/api/account/logout-all', async (req, res) => {
    options.repository.transaction(() => {
      options.repository.invalidateAuthentication();
      oauth?.revokeUser('1');
      options.repository.securityEvent('all_sessions_revoked');
    });
    await newSession(req, false);
    res.json(status(req));
  });
  app.post('/api/account/sessions/:id/revoke', async (req, res) => {
    const id = z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .parse(req.params.id);
    store.revoke(id);
    options.repository.securityEvent('session_revoked');
    if (id === sessionKey(req.sessionID)) await newSession(req, false);
    res.json(status(req));
  });
  app.post('/api/account/grants/:id/revoke', (req, res) => {
    if (!oauth) throw new AppError('NOT_AVAILABLE', 'OAuth 未启用', 404);
    oauth.revokeGrant('1', z.string().min(1).max(256).parse(req.params.id));
    res.json({ ok: true });
  });
  app.get('/api/snapshot', (_req, res) => res.json(hub.snapshot()));
  app.get('/api/changes/:id', (req, res) => res.json(hub.request(z.uuid().parse(req.params.id))));
  app.post('/api/changes', (req, res) => res.json(hub.submit(req.body, 'web')));
  app.post('/api/changes/:id/confirm', (req, res) =>
    res.json(hub.confirm(z.uuid().parse(req.params.id))),
  );
  app.post('/api/changes/:id/reject', (req, res) =>
    res.json(hub.reject(z.uuid().parse(req.params.id))),
  );
  app.post('/api/undo', (req, res) => res.json(hub.requestUndo(req.body)));
  app.post('/api/projects/:id/actions/refresh', async (req, res) => {
    if (!options.refreshActions)
      throw new AppError('NOT_AVAILABLE', 'GitHub Actions 刷新尚未启用', 503);
    res.json(await options.refreshActions(z.uuid().parse(req.params.id)));
  });
  app.use('/api', (_req, _res, next) => next(new AppError('NOT_FOUND', '接口不存在', 404)));
  const dist = resolve('dist');
  if (existsSync(resolve(dist, 'index.html'))) {
    app.use(express.static(dist));
    app.use((req, res, next) => {
      if (req.method === 'GET' && req.accepts('html')) res.sendFile(resolve(dist, 'index.html'));
      else next();
    });
  }
  app.use((_req, _res, next) => next(new AppError('NOT_FOUND', '页面不存在', 404)));
  const handleError: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
    if (error instanceof ZodError) {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: '请检查输入内容',
          details: error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        },
      });
      return;
    }
    if (error instanceof AppError) {
      res
        .status(error.status)
        .json({ error: { code: error.code, message: error.message, details: error.details } });
      return;
    }
    const statusCode =
      typeof error === 'object' && error !== null && 'status' in error ? Number(error.status) : 500;
    res.status(statusCode === 413 ? 413 : statusCode === 400 ? 400 : 500).json({
      error: {
        code:
          statusCode === 413
            ? 'PAYLOAD_TOO_LARGE'
            : statusCode === 400
              ? 'INVALID_JSON'
              : 'INTERNAL_ERROR',
        message:
          statusCode === 413
            ? '请求内容过大'
            : statusCode === 400
              ? '请求格式不正确'
              : '发生内部错误，请稍后重试',
      },
    });
  };
  app.use(handleError);
  return { app, hub, oauth, store };
}
