export function runtimeConfig(env: NodeJS.ProcessEnv = process.env) {
  const port = Number(env.PORT ?? 4310);
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error('PORT must be an integer between 1024 and 65535.');
  const host = env.HUB_BIND_HOST ?? '127.0.0.1';
  if (host !== '127.0.0.1' && host !== '0.0.0.0')
    throw new Error(
      'HUB_BIND_HOST must be 127.0.0.1, or 0.0.0.0 inside a loopback-published container.',
    );
  return { port, host };
}
