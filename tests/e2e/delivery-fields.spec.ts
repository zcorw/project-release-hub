import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import {
  projectSchema,
  taskSchema,
  issueSchema,
  type ChangeRequest,
  type Operation,
} from '../../shared/schema';

for (const kind of ['task', 'issue'] as const) {
  test(`${kind} delivery fields: display, filter, cancel and submit`, async ({ page }) => {
    const metadata = {
      revision: 1,
      createdAt: '2026-11-17T00:00:00Z',
      updatedAt: '2026-11-17T00:00:00Z',
    };
    const project = {
      ...projectSchema.parse({ kind: 'project', name: 'Delivery UI' }),
      ...metadata,
      id: randomUUID(),
    };
    const item = {
      ...(kind === 'task' ? taskSchema : issueSchema).parse({
        kind,
        projectId: project.id,
        title: 'Existing delivery',
        developmentStatus: 'unverified',
        githubStatus: 'submitted',
      }),
      ...metadata,
      id: randomUUID(),
    };
    let pending: ChangeRequest | undefined;
    let current = item;
    let submitted: Record<string, unknown> | undefined;
    await page.route('**/api/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (route.request().method() === 'POST') {
        if (path.endsWith('/confirm')) {
          current = { ...item, developmentStatus: 'verified', revision: 2 };
          pending = { ...pending!, status: 'applied' };
        } else {
          submitted = route.request().postDataJSON();
          pending = {
            id: String(submitted!.requestId),
            mode: 'batch',
            source: 'web',
            createdAt: metadata.createdAt,
            status: 'pending',
            duplicates: [],
            operations: submitted!.operations as Operation[],
            baseEntities: { [item.id]: item },
          };
        }
        await route.fulfill({ json: pending });
      } else
        await route.fulfill({
          json:
            path === '/api/auth/status'
              ? { configured: true, authenticated: true, csrfToken: 'fixture', setupAllowed: false }
              : {
                  entities: [project, current],
                  requests: pending ? [pending] : [],
                  history: [],
                  actions: [],
                },
        });
    });
    await page.goto('/');
    await page.getByRole('button', { name: '查看项目 →', exact: true }).click();
    await page.getByRole('tab', { name: kind === 'task' ? /任务/ : /问题/ }).click();
    await expect(page.locator('.record')).toContainText('未验证');
    await expect(page.locator('.record')).toContainText('已提交');
    await page.getByLabel('开发验证状态筛选').selectOption('verified');
    await expect(page.locator('.record')).toHaveCount(0);
    await page.getByLabel('开发验证状态筛选').selectOption('');
    await page.getByLabel('GitHub 提交状态筛选').selectOption('not_submitted');
    await expect(page.locator('.record')).toHaveCount(0);
    await page.getByLabel('GitHub 提交状态筛选').selectOption('submitted');
    await expect(page.locator('.record')).toHaveCount(1);
    await page.locator('.record').getByRole('button', { name: '编辑', exact: true }).click();
    let dialog = page.getByRole('dialog');
    await expect(dialog.getByLabel('开发验证状态', { exact: true })).toHaveValue('unverified');
    await dialog.getByLabel('开发验证状态', { exact: true }).selectOption('verified');
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
    expect(submitted).toBeUndefined();
    await page.locator('.record').getByRole('button', { name: '编辑', exact: true }).click();
    dialog = page.getByRole('dialog');
    await expect(dialog.getByLabel('开发验证状态', { exact: true })).toHaveValue('unverified');
    await dialog.getByLabel('开发验证状态', { exact: true }).selectOption('verified');
    await dialog.getByRole('button', { name: '生成变更提案', exact: true }).click();
    await expect.poll(() => submitted).toBeTruthy();
    expect(submitted).toMatchObject({
      operations: [
        { action: 'update', entity: { developmentStatus: 'verified', githubStatus: 'submitted' } },
      ],
    });
    await expect(page.getByRole('heading', { name: '确认变更提案', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '确认并应用', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('.record')).toContainText('已验证');
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByLabel('开发验证状态筛选')).toBeVisible();
    await page.screenshot({ path: `test-results/delivery-${kind}-mobile.png`, fullPage: true });
  });
}
