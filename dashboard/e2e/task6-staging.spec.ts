import { expect, test } from '@playwright/test';

const dashboardUrl = 'https://samche-dashboard-staging.onrender.com';
const tenantId = process.env.TASK6_E2E_TENANT_ID ?? '';
const token = process.env.STAGING_ADMIN_TOKEN ?? '';
const routes = ['knowledge-base', 'knowledge-base/intelligence', 'knowledge-base/sources', 'knowledge-base/candidates', 'knowledge-base/gaps', 'knowledge-base/profile', 'knowledge-base/configurations', 'knowledge-base/retrieval'];
const viewports = [{ width: 1440, height: 900 }, { width: 1024, height: 768 }, { width: 390, height: 844 }];

test.beforeEach(async ({ page }) => {
  if (!tenantId || !token) throw new Error('TASK6_DASHBOARD_E2E_ENV_MISSING');
  await page.addInitScript((sessionToken) => window.sessionStorage.setItem('samche.dashboard.session.v1', sessionToken), token);
});

for (const viewport of viewports) {
  test(`Task 6 routes remain usable at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    for (const route of routes) {
      await page.goto(`${dashboardUrl}/app/${tenantId}/${route}`, { waitUntil: 'networkidle' });
      await expect(page).not.toHaveURL(/\/login/);
      await expect(page.locator('body')).not.toContainText('Unable to load');
      if (route === 'knowledge-base') await expect(page.getByRole('heading', { name: /Knowledge Base/i })).toBeVisible();
      else {
        await expect(page.getByRole('heading', { name: 'Knowledge Intelligence' })).toBeVisible();
        await expect(page.getByRole('navigation', { name: 'Knowledge Intelligence sections' })).toBeVisible();
      }
      await page.reload({ waitUntil: 'networkidle' });
      await expect(page).not.toHaveURL(/\/login/);
    }
  });
}

test('profile and configuration lifecycle controls are reachable with real staging data', async ({ page }) => {
  await page.goto(`${dashboardUrl}/app/${tenantId}/knowledge-base/profile`, { waitUntil: 'networkidle' });
  await expect(page.getByRole('button', { name: /Edit|Approve|Activate|Rollback/ }).first()).toBeVisible();
  await page.goto(`${dashboardUrl}/app/${tenantId}/knowledge-base/configurations`, { waitUntil: 'networkidle' });
  const assistant = page.getByLabel('Assistant').first();
  await assistant.selectOption({ index: 1 });
  await expect(page.getByText('Configurations', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Edit|Approve|Activate|Rollback|Generate configuration/ }).first()).toBeVisible();
});
