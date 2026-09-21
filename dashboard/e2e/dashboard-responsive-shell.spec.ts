import { expect, test } from '@playwright/test';

const dashboardUrl = 'https://samche-dashboard-staging.onrender.com';
const tenantId = process.env.TASK6_E2E_TENANT_ID ?? '';
const token = process.env.STAGING_ADMIN_TOKEN ?? '';
const viewportMatrix = [
  { width: 320, height: 568 },
  { width: 360, height: 800 },
  { width: 375, height: 812 },
  { width: 390, height: 844 },
  { width: 393, height: 852 },
  { width: 414, height: 896 },
  { width: 430, height: 932 },
  { width: 768, height: 1024 },
  { width: 820, height: 1180 },
  { width: 1024, height: 768 },
  { width: 1280, height: 900 },
] as const;

test.beforeEach(async ({ page }) => {
  if (!tenantId || !token) throw new Error('DASHBOARD_RESPONSIVE_E2E_ENV_MISSING');
  await page.addInitScript((sessionToken) => window.sessionStorage.setItem('samche.dashboard.session.v1', sessionToken), token);
});

for (const viewport of viewportMatrix) {
  test(`Dashboard shell has no structural horizontal overflow at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto(`${dashboardUrl}/app/${tenantId}/overview`, { waitUntil: 'networkidle' });
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.locator('.dashboard-shell')).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    const actionTrigger = page.getByRole('button', { name: 'Workspace actions' });
    await expect(actionTrigger).toBeVisible();
    await actionTrigger.click();
    const dialog = page.getByRole('dialog', { name: 'Workspace actions' });
    await expect(dialog).toBeVisible();
    await expect.poll(() => dialog.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    await expect(dialog.getByRole('combobox', { name: 'Selected tenant' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });
}
