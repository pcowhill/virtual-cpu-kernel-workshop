import { expect, test } from '@playwright/test';

test('the application loads and the CPU core runs in the browser', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByRole('heading', { name: /Virtual CPU/ })).toBeVisible();
  await expect(page.getByTestId('demo-output')).toHaveText('Hello from the VC-8 CPU.');
});
