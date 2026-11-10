import { expect, test, type Page } from '@playwright/test';

const auth = {
  configured: true,
  authenticated: true,
  csrfToken: 'test-csrf',
  setupAllowed: false,
  oauthEnabled: true,
};
const timestamp = '2026-11-10T10:00:00.000Z';
async function mockAccount(page: Page, status = auth) {
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const body =
      path === '/api/auth/status'
        ? status
        : path === '/api/snapshot'
          ? { entities: [], requests: [], history: [], actions: [] }
          : path === '/api/account/security'
            ? {
                sessions: [
                  {
                    id: 'current',
                    current: true,
                    createdAt: timestamp,
                    lastSeenAt: timestamp,
                    expiresAt: timestamp,
                  },
                  {
                    id: 'other',
                    current: false,
                    createdAt: timestamp,
                    lastSeenAt: timestamp,
                    expiresAt: timestamp,
                  },
                ],
                grants: [
                  {
                    id: 'grant',
                    clientName: '测试 MCP 客户端',
                    scope: 'mcp',
                    createdAt: timestamp,
                  },
                ],
                events: [
                  {
                    id: 'event',
                    event: 'password_changed',
                    createdAt: timestamp,
                    detail: 'DO_NOT_RENDER_RAW_DETAIL',
                  },
                ],
              }
            : {};
    await route.fulfill({ json: body });
  });
}

test('account password confirmation, CSRF rotation, and logout-all', async ({ page }) => {
  await mockAccount(page);
  let changed = false;
  await page.route('**/api/account/password', async (route) => {
    expect(route.request().headers()['x-csrf-token']).toBe('test-csrf');
    expect(route.request().postDataJSON()).toEqual({
      currentPassword: 'Old-test-password-123',
      newPassword: 'New-test-password-456',
    });
    changed = true;
    await route.fulfill({ json: { ...auth, csrfToken: 'rotated-csrf' } });
  });
  await page.route('**/api/account/logout-all', async (route) => {
    expect(route.request().headers()['x-csrf-token']).toBe('rotated-csrf');
    await route.fulfill({ json: { ...auth, authenticated: false, csrfToken: 'logged-out' } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: '账户与安全', exact: true }).click();
  await expect(page.getByText('当前会话', { exact: true })).toBeVisible();
  await expect(page.getByText('测试 MCP 客户端', { exact: true })).toBeVisible();
  await expect(page.getByText('DO_NOT_RENDER_RAW_DETAIL')).toHaveCount(0);
  await page.getByLabel('当前密码', { exact: true }).fill('Old-test-password-123');
  await page.getByLabel('新密码', { exact: true }).fill('New-test-password-456');
  await page.getByLabel('确认新密码', { exact: true }).fill('mismatch');
  await page.getByRole('button', { name: '修改密码', exact: true }).click();
  await expect(page.getByText('两次新密码不一致')).toBeVisible();
  await page.getByLabel('确认新密码', { exact: true }).fill('New-test-password-456');
  await page.getByRole('button', { name: '修改密码', exact: true }).click();
  expect(changed).toBe(false);
  await page.getByRole('button', { name: '取消', exact: true }).click();
  expect(changed).toBe(false);
  await page.getByRole('button', { name: '修改密码', exact: true }).click();
  await page.getByRole('button', { name: '确认操作', exact: true }).click();
  await expect(
    page.getByText('密码已更新，其他会话与 OAuth 授权已撤销。', { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('当前密码', { exact: true })).toHaveValue('');
  await page.getByRole('button', { name: '退出全部会话', exact: true }).click();
  await page.getByRole('button', { name: '确认操作', exact: true }).click();
  await expect(page.getByRole('button', { name: '进入工作空间' })).toBeVisible();
});

test('remote fresh service never exposes password setup', async ({ page }) => {
  await mockAccount(page, { ...auth, configured: false, authenticated: false });
  await page.goto('/');
  await expect(page.getByText(/网页不开放首次设置/)).toBeVisible();
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
});

test('OAuth resume accepts only opaque request IDs and fixed same-origin destination', async ({
  page,
}) => {
  await mockAccount(page);
  await page.goto('/?oauth_request=https%3A%2F%2Fevil.example%2F');
  await expect(page.getByRole('button', { name: '账户与安全', exact: true })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/');
  await page.route('**/oauth/authorize?request_id=*', (route) =>
    route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<h1>测试授权页</h1>' }),
  );
  await page.goto('/?oauth_request=opaque_request_123456789');
  await expect(page).toHaveURL(/\/oauth\/authorize\?request_id=opaque_request_123456789$/);
  await expect(page.getByRole('heading', { name: '测试授权页' })).toBeVisible();
});

test('session and grant revocations require confirmation and display retryable errors', async ({
  page,
}) => {
  await mockAccount(page);
  let grantCalls = 0;
  await page.route('**/api/account/grants/grant/revoke', async (route) => {
    grantCalls++;
    await route.fulfill({
      status: 503,
      json: { error: { code: 'UNAVAILABLE', message: '测试服务暂不可用' } },
    });
  });
  await page.route('**/api/account/sessions/other/revoke', async (route) => {
    expect(route.request().headers()['x-csrf-token']).toBe('test-csrf');
    await route.fulfill({ json: auth });
  });
  await page.goto('/');
  await page.getByRole('button', { name: '账户与安全', exact: true }).click();
  await page.getByRole('button', { name: '撤销授权', exact: true }).click();
  expect(grantCalls).toBe(0);
  await page.getByRole('button', { name: '确认操作', exact: true }).click();
  await expect(page.getByText('测试服务暂不可用')).toBeVisible();
  await expect(page.getByRole('button', { name: '撤销授权', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '撤销会话', exact: true }).click();
  await page.getByRole('button', { name: '确认操作', exact: true }).click();
  await expect(page.getByText('会话已撤销。', { exact: true })).toBeVisible();
});
