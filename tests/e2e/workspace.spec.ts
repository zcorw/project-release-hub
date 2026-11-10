import { test, expect } from '@playwright/test';
test('local workspace: validation, CRUD, review, duplicates, undo, login, and responsive layout', async ({
  page,
}) => {
  const password = 'temporary-browser-test-password';
  const snapshot = async () => await (await page.request.get('/api/snapshot')).json();
  await page.goto('/');
  await expect(page).toHaveTitle('知序 · 个人项目工作空间');
  await expect(page.locator('.brand')).toContainText('知序');
  await expect(page.getByRole('heading', { name: '创建你的工作空间' })).toBeVisible();
  await page.getByLabel('密码', { exact: true }).fill('short');
  await page.getByLabel('确认密码', { exact: true }).fill('different');
  await page.getByRole('button', { name: '创建工作空间', exact: true }).click();
  await expect(page.getByText('密码至少 12 位')).toBeVisible();
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByLabel('确认密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '创建工作空间', exact: true }).click();
  await expect(page.getByRole('heading', { name: '项目总览', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '＋ 新建项目', exact: true }).first().click();
  let dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: '保存记录', exact: true }).click();
  await expect(dialog.getByText('请填写名称或标题')).toBeVisible();
  await dialog.getByLabel('项目名称', { exact: false }).fill('知序验收项目');
  await dialog.getByLabel('说明', { exact: true }).fill('仅用于自动化浏览器验收，非真实用户项目');
  await dialog.getByRole('button', { name: '保存记录', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect((await snapshot()).entities).toHaveLength(1);
  await page.getByRole('button', { name: '查看项目 →', exact: true }).click();
  await page.getByRole('button', { name: '＋ 新建功能计划', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('标题', { exact: false }).fill('完成批量导入');
  await dialog.getByLabel('验收标准', { exact: false }).fill('同一请求重试不产生重复数据');
  await dialog.getByLabel('计划开始日期').fill('2026-11-10');
  await dialog.getByLabel('计划完成日期').fill('2026-11-09');
  await dialog.getByRole('button', { name: '保存记录', exact: true }).click();
  await expect(dialog.getByText('结束日期不能早于开始日期')).toBeVisible();
  await dialog.getByLabel('计划完成日期').fill('2026-11-15');
  await dialog.getByRole('button', { name: '保存记录', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole('tab', { name: /任务/ }).click();
  await page.getByRole('button', { name: '＋ 新建任务', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('标题', { exact: false }).fill('验证请求幂等');
  await dialog.getByLabel('关联功能').selectOption({ label: '完成批量导入' });
  await dialog.getByRole('button', { name: '保存记录', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole('tab', { name: /问题/ }).click();
  await page.getByRole('button', { name: '＋ 新建问题', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('标题', { exact: false }).fill('测试问题');
  await dialog.getByRole('button', { name: '保存记录', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole('tab', { name: /版本/ }).click();
  await page.getByRole('button', { name: '＋ 新建版本', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('版本号', { exact: false }).fill('v0.1.0');
  await dialog.getByRole('button', { name: '保存记录', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole('tab', { name: /功能计划/ }).click();
  await page
    .locator('.record')
    .filter({ hasText: '完成批量导入' })
    .getByRole('button', { name: '编辑', exact: true })
    .click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('状态', { exact: true }).selectOption('done');
  await dialog.getByLabel('目标版本').selectOption({ label: 'v0.1.0' });
  await dialog.getByRole('button', { name: '生成变更提案', exact: true }).click();
  await expect(page.getByRole('heading', { name: '确认变更提案', exact: true })).toBeVisible();
  expect(
    (await snapshot()).entities.find((e: { kind: string }) => e.kind === 'feature').status,
  ).toBe('backlog');
  await page.getByRole('button', { name: '稍后处理', exact: true }).click();
  await page
    .getByRole('navigation', { name: '主导航' })
    .getByRole('button', { name: /待确认变更/ })
    .click();
  await page.getByRole('button', { name: '查看并确认 →', exact: true }).click();
  await page.getByRole('button', { name: '确认并应用', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(
    (await snapshot()).entities.find((e: { kind: string }) => e.kind === 'feature').status,
  ).toBe('done');
  await page
    .getByRole('navigation', { name: '主导航' })
    .getByRole('button', { name: /项目总览/ })
    .click();
  await page.getByRole('button', { name: '＋ 新建项目', exact: true }).first().click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('项目名称', { exact: false }).fill('知序验收项目');
  await dialog.getByRole('button', { name: '保存记录', exact: true }).click();
  await expect(page.getByText('发现疑似重复项目')).toBeVisible();
  await page.getByRole('button', { name: '拒绝此变更', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(
    (await snapshot()).entities.filter((e: { kind: string }) => e.kind === 'project'),
  ).toHaveLength(1);
  await page.getByRole('button', { name: '＋ 新建项目', exact: true }).first().click();
  await page.getByRole('dialog').getByLabel('项目名称', { exact: false }).fill('不会保存的取消项');
  await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click();
  expect(
    (await snapshot()).entities.filter((e: { kind: string }) => e.kind === 'project'),
  ).toHaveLength(1);
  await page.getByRole('button', { name: '查看项目 →', exact: true }).click();
  await page.getByRole('tab', { name: /问题/ }).click();
  await page
    .locator('.record')
    .filter({ hasText: '测试问题' })
    .getByRole('button', { name: '删除', exact: true })
    .click();
  await page.getByRole('button', { name: '确认并应用', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect((await snapshot()).entities.some((e: { kind: string }) => e.kind === 'issue')).toBe(false);
  await page
    .getByRole('navigation', { name: '主导航' })
    .getByRole('button', { name: /操作历史/ })
    .click();
  await page
    .locator('.history-card')
    .filter({ has: page.getByRole('heading', { name: '删除「测试问题」', exact: true }) })
    .getByRole('button', { name: '预览撤销', exact: true })
    .click();
  await page.getByRole('button', { name: '确认并应用', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect((await snapshot()).entities.some((e: { kind: string }) => e.kind === 'issue')).toBe(true);
  await page
    .getByRole('navigation', { name: '主导航' })
    .getByRole('button', { name: /项目总览/ })
    .click();
  await page.screenshot({ path: 'test-results/overview.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
    ),
  ).toBe(true);
  await page.screenshot({ path: 'test-results/mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: /退出登录/ }).click();
  await expect(page.getByRole('heading', { name: '欢迎回来', exact: true })).toBeVisible();
  await page.getByLabel('密码', { exact: true }).fill('wrong');
  await page.getByRole('button', { name: '进入工作空间', exact: true }).click();
  await expect(page.getByText('密码不正确')).toBeVisible();
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '进入工作空间', exact: true }).click();
  await expect(page.getByRole('heading', { name: '项目总览', exact: true })).toBeVisible();

  await page
    .getByRole('navigation', { name: '主导航' })
    .getByRole('button', { name: /项目总览/ })
    .click();
  const sentIds: string[] = [];
  let interrupted = false;
  await page.route('**/api/changes', async (route) => {
    const body = route.request().postDataJSON();
    if (body.operations?.[0]?.entity?.name === '网络重试项目') {
      sentIds.push(body.requestId);
      if (!interrupted) {
        interrupted = true;
        await route.fetch();
        await route.abort('failed');
        return;
      }
    }
    await route.continue();
  });
  await page.getByRole('button', { name: '＋ 新建项目', exact: true }).first().click();
  await page.getByRole('dialog').getByLabel('项目名称', { exact: false }).fill('网络重试项目');
  await page.getByRole('dialog').getByRole('button', { name: '保存记录', exact: true }).click();
  await expect(page.getByRole('dialog').getByText(/连接中断，操作结果尚未确认/)).toBeVisible();
  const historyLength = await page.evaluate(() => history.length);
  await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click();
  expect(await page.evaluate(() => history.length)).toBe(historyLength);
  await page.getByRole('button', { name: '＋ 新建项目', exact: true }).first().click();
  await page.getByRole('dialog').getByLabel('项目名称', { exact: false }).fill('网络重试项目');
  await page.getByRole('dialog').getByRole('button', { name: '保存记录', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(sentIds).toHaveLength(2);
  expect(sentIds[1]).toBe(sentIds[0]);
  expect(
    (await snapshot()).entities.filter(
      (e: { kind: string; name?: string }) => e.kind === 'project' && e.name === '网络重试项目',
    ),
  ).toHaveLength(1);
  await page.unroute('**/api/changes');
  // Real backend account flow on this test's disposable database.
  const otherContext = await page
    .context()
    .browser()!
    .newContext({ baseURL: 'http://127.0.0.1:4311' });
  const other = await otherContext.newPage();
  await other.goto('/');
  await other.getByLabel('密码', { exact: true }).fill(password);
  await other.getByRole('button', { name: '进入工作空间', exact: true }).click();
  await expect(other.getByRole('heading', { name: '项目总览', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '账户与安全', exact: true }).click();
  dialog = page.getByRole('dialog');
  await expect(dialog.getByText('当前会话', { exact: true })).toBeVisible();
  await expect(dialog.getByText('其他会话', { exact: true })).toBeVisible();
  await page.screenshot({
    path: 'test-results/account-security.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
    ),
  ).toBe(true);
  await page.screenshot({
    path: 'test-results/account-security-mobile.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await dialog.getByLabel('当前密码', { exact: true }).fill(password);
  await dialog.getByLabel('新密码', { exact: true }).fill('updated-browser-test-password');
  await dialog.getByLabel('确认新密码', { exact: true }).fill('updated-browser-test-password');
  await dialog.getByRole('button', { name: '修改密码', exact: true }).click();
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  expect((await other.request.get('/api/snapshot')).status()).toBe(200);
  await dialog.getByRole('button', { name: '修改密码', exact: true }).click();
  await dialog.getByRole('button', { name: '确认操作', exact: true }).click();
  await expect(
    dialog.getByText('密码已更新，其他会话与 OAuth 授权已撤销。', { exact: true }),
  ).toBeVisible();
  expect((await other.request.get('/api/snapshot')).status()).toBe(401);
  expect((await page.request.get('/api/snapshot')).status()).toBe(200);
  await dialog.getByRole('button', { name: '退出全部会话', exact: true }).click();
  await dialog.getByRole('button', { name: '确认操作', exact: true }).click();
  await expect(page.getByRole('heading', { name: '欢迎回来', exact: true })).toBeVisible();
  await page.getByLabel('密码', { exact: true }).fill('updated-browser-test-password');
  await page.getByRole('button', { name: '进入工作空间', exact: true }).click();
  await expect(page.getByRole('heading', { name: '项目总览', exact: true })).toBeVisible();
  await otherContext.close();
});
