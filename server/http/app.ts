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

export interface AppOptions {
  repository: Repository;
  sessionSecret?: string;
  disableRateLimit?: boolean;
  refreshActions?: (projectId: string) => Promise<ActionsSnapshot>;
  mcpHandler?: RequestHandler;
}
export function createApp(options: AppOptions) {
  const app = express(),
    hub = new HubService(options.repository);
  app.disable('x-powered-by');
  app.use((request, response, next) => {
    if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(request.hostname))
      return next(new AppError('INVALID_HOST', '此服务仅供本机访问', 403));
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'same-origin');
    response.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; connect-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    );
    next();
  });
  app.use(express.json({ limit: '1mb' }));
  app.all(
    '/mcp',
    options.mcpHandler ??
      ((_req, _res, next) =>
        next(new AppError('MCP_DISABLED', 'MCP 未启用；请按本地配置说明设置令牌', 503))),
  );
  // Memory sessions are deliberately local-only and expire on process restart.
  app.use(
    session({
      name: 'hub.sid',
      secret: options.sessionSecret ?? randomBytes(48).toString('hex'),
      resave: false,
      saveUninitialized: false,
      rolling: true,
      cookie: { httpOnly: true, sameSite: 'strict', secure: false, maxAge: 12 * 60 * 60 * 1000 },
    }),
  );
  const auth: RequestHandler = (req, _res, next) =>
    req.session.authenticated ? next() : next(new AppError('UNAUTHORIZED', '请先登录', 401));
  const csrf: RequestHandler = (req, _res, next) => {
    const given = req.get('X-CSRF-Token') ?? '',
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
    authenticated: !!req.session.authenticated,
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
  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.get('/api/auth/status', (req, res) => {
    res.set('Cache-Control', 'no-store').json(status(req));
  });
  app.post('/api/auth/setup', csrf, limiter, async (req, res) => {
    const password = passwordSchema.parse(req.body?.password);
    if (options.repository.account())
      throw new AppError('ALREADY_CONFIGURED', '本机账户已经设置，请登录', 409);
    const hashed = hashPassword(password);
    if (!options.repository.createAccount(hashed.salt, hashed.hash))
      throw new AppError('ALREADY_CONFIGURED', '本机账户已经设置，请登录', 409);
    await newSession(req, true);
    res.json(status(req));
  });
  app.post('/api/auth/login', csrf, limiter, async (req, res) => {
    const { password } = loginSchema.parse(req.body),
      account = options.repository.account();
    if (!account || !verifyPassword(password, account))
      throw new AppError('INVALID_CREDENTIALS', '密码不正确', 401);
    await newSession(req, true);
    res.json(status(req));
  });
  app.post('/api/auth/logout', csrf, async (req, res) => {
    await newSession(req, false);
    res.json(status(req));
  });
  app.use('/api', auth, (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (!['GET', 'HEAD'].includes(req.method)) csrf(req, res, next);
    else next();
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
  return { app, hub };
}
