import { defineConfig } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  workers: 1,
  timeout: 60000,
  use: {
    baseURL: 'http://127.0.0.1:4311',
    channel: process.env.CI ? undefined : 'chrome',
    headless: true,
    viewport: { width: 1440, height: 1000 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm start',
    url: 'http://127.0.0.1:4311/api/health',
    reuseExistingServer: false,
    timeout: 30000,
    env: {
      PORT: '4311',
      HUB_BIND_HOST: '127.0.0.1',
      HUB_DATA_DIR: join(tmpdir(), 'release-hub-e2e-' + Date.now()),
    },
  },
  reporter: [['list']],
});
