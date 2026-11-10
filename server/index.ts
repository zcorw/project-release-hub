import { resolve } from 'node:path';
import { runtimeConfig } from './config';
import { Repository } from './infrastructure/database';
import { createApp } from './http/app';
import { GitHubActionsService } from './integrations/github';
import { HubService } from './application/hub';
import { createMcpHandler } from './mcp/handler';
import { securityConfig } from './http/security';
import { OAuthService } from './oauth/service';
const { port, host } = runtimeConfig();
const security = securityConfig();
if (security.publicUrl && process.env.HUB_MCP_TOKEN)
  throw new Error('HUB_MCP_TOKEN is local-only. Remove it when enabling OAuth remote mode.');
const repository = new Repository(resolve(process.env.HUB_DATA_DIR ?? 'data', 'hub.db'));
const github = new GitHubActionsService(repository, process.env.GITHUB_TOKEN);
const hub = new HubService(repository);
const oauth = security.publicUrl
  ? new OAuthService(repository, { issuer: security.publicUrl })
  : undefined;
const { app } = createApp({
  security,
  oauth,
  repository,
  refreshActions: (id) => github.refresh(id),
  mcpHandler: createMcpHandler(hub, process.env.HUB_MCP_TOKEN, oauth),
});
const server = app.listen(port, host, () =>
  console.log(
    'Zhixu: ' + (security.publicUrl ?? 'http://127.0.0.1:' + port) + ' (bind: ' + host + ')',
  ),
);
const stop = () =>
  server.close(() => {
    repository.close();
    process.exit(0);
  });
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
