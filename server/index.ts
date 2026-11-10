import { resolve } from 'node:path';
import { runtimeConfig } from './config';
import { Repository } from './infrastructure/database';
import { createApp } from './http/app';
import { GitHubActionsService } from './integrations/github';
import { HubService } from './application/hub';
import { createMcpHandler } from './mcp/handler';
const { port, host } = runtimeConfig();
const repository = new Repository(resolve(process.env.HUB_DATA_DIR ?? 'data', 'hub.db'));
const github = new GitHubActionsService(repository, process.env.GITHUB_TOKEN);
const hub = new HubService(repository);
const { app } = createApp({
  repository,
  refreshActions: (id) => github.refresh(id),
  mcpHandler: createMcpHandler(hub, process.env.HUB_MCP_TOKEN),
});
const server = app.listen(port, host, () =>
  console.log(`Zhixu (知序): http://127.0.0.1:${port} (bind: ${host}; local-use only)`),
);
const stop = () =>
  server.close(() => {
    repository.close();
    process.exit(0);
  });
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
