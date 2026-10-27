/**
 * Workspaces (IndexedDB, snapshots, export/import) and offline operation in a
 * real browser against the production build.
 */
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

async function step(page: Page, times: number): Promise<void> {
  for (let i = 0; i < times; i++) {
    const before = await page.getByTestId('cycle').textContent();
    await page.getByTestId('step').click();
    await expect(page.getByTestId('cycle')).not.toHaveText(before ?? '');
  }
}

test('save a workspace with machine state, snapshot and restore, reload and reopen, export and import', async ({
  page,
}, testInfo) => {
  await page.goto('./');
  await page.getByTestId('quick-start').click();
  await expect(page.getByTestId('machine-label')).toContainText('first-program');
  await step(page, 4); // reset + MOV R0 + MOV R1 + ADD
  const pcSaved = await page.getByTestId('pc').textContent();
  const cycleSaved = await page.getByTestId('cycle').textContent();

  await page.getByTestId('nav-workspaces').click();
  await page.getByTestId('ws-name').fill('E2E experiment');
  await page.getByTestId('ws-notes').fill('R0 holds 10 after the first ADD.');
  await expect(page.getByTestId('ws-dirty')).toBeVisible();
  await page.getByTestId('ws-save').click();
  await expect(page.getByTestId('ws-saved')).toBeVisible();
  await expect(page.getByTestId('ws-list')).toContainText('E2E experiment');

  // Snapshot, run on, restore.
  await page.getByTestId('snap-name').fill('after ADD');
  await page.getByTestId('snap-take').click();
  await expect(page.getByTestId('snap-list')).toContainText('after ADD');
  await step(page, 3); // DEC, JNE, ADD: back at the same PC, but later and with R0 = 0x13
  await expect(page.getByTestId('cycle')).not.toHaveText(cycleSaved ?? '');
  await expect(page.locator('.dock [data-testid=reg-R0]')).toHaveText('13');
  await page.getByTestId('snap-restore-after ADD').click();
  await expect(page.getByTestId('pc')).toHaveText(pcSaved ?? '');
  await expect(page.getByTestId('cycle')).toHaveText(cycleSaved ?? '');
  await expect(page.locator('.dock [data-testid=reg-R0]')).toHaveText('0A');

  // A fresh page load: nothing in memory, the workspace comes back from IndexedDB.
  await page.reload();
  await page.getByTestId('nav-workspaces').click();
  await page.getByTestId('ws-open-E2E experiment').click();
  await expect(page.getByTestId('machine-label')).toContainText('first-program');
  await expect(page.getByTestId('pc')).toHaveText(pcSaved ?? '');
  await expect(page.getByTestId('cycle')).toHaveText(cycleSaved ?? '');
  await expect(page.getByTestId('ws-notes')).toHaveValue('R0 holds 10 after the first ADD.');
  await expect(page.locator('.dock [data-testid=reg-R0]')).toHaveText('0A');
  // Execution continues deterministically from the restored state.
  await page.getByTestId('run-pause').click();
  await expect(page.getByTestId('machine-status')).toHaveText('Halted');
  await expect(page.locator('.dock [data-testid=reg-R0]')).toHaveText('37');

  // Export, then import the file back.
  const download = page.waitForEvent('download');
  await page.getByTestId('ws-export-current').click();
  const file = testInfo.outputPath('exported.vc8.json');
  await (await download).saveAs(file);
  const exported = JSON.parse(readFileSync(file, 'utf8')) as { format: string; version: number };
  expect(exported.format).toBe('vc8-workspace');
  expect(exported.version).toBe(1);
  await page.getByTestId('ws-import-file').setInputFiles(file);
  await expect(page.getByTestId('ws-list')).toContainText('E2E experiment (imported)');

  // A malformed file is rejected with a reason and nothing is added.
  await page.getByTestId('ws-import-file').setInputFiles({
    name: 'bad.vc8.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ format: 'vc8-workspace', version: 99, workspace: {} })),
  });
  await expect(page.getByTestId('ws-import-error')).toContainText('unsupported workspace version 99');

  // Deleting asks for confirmation. The dialog takes focus on Cancel, keeps Tab inside, and Escape closes it,
  // returning focus to the button that opened it.
  const del = page.getByTestId('ws-delete-E2E experiment (imported)');
  await del.click();
  await expect(page.getByTestId('confirm-dialog')).toBeVisible();
  await expect(page.getByTestId('confirm-no')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByTestId('confirm-yes')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByTestId('confirm-no')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('confirm-dialog')).toBeHidden();
  await expect(del).toBeFocused();
  await del.click();
  await page.getByTestId('confirm-no').click();
  await expect(page.getByTestId('ws-list')).toContainText('E2E experiment (imported)');
  await page.getByTestId('ws-delete-E2E experiment (imported)').click();
  await page.getByTestId('confirm-yes').click();
  await expect(page.getByTestId('ws-list')).not.toContainText('(imported)');
});

test('works offline after the first visit', async ({ page, context }) => {
  await page.goto('./');
  await expect(page.getByTestId('offline-ready')).toBeVisible({ timeout: 30_000 });
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Virtual CPU & Kernel Workshop' })).toBeVisible();
  // The machine worker, the bundled sources and the assembler all work without a network.
  await page.getByTestId('quick-start').click();
  await expect(page.getByTestId('machine-label')).toContainText('first-program');
  await page.getByTestId('run-pause').click();
  await expect(page.getByTestId('machine-status')).toHaveText('Halted');
  await expect(page.getByTestId('terminal')).toContainText('1 + 2 + ... + 10 = 0x37');
  // Lessons and reference documentation are bundled too.
  await page.getByTestId('nav-reference').click();
  await page.getByTestId('ref-arch').click();
  await expect(page.locator('.doc h1').first()).toBeVisible();
  await page.getByTestId('nav-lessons').click();
  await page.getByTestId('lesson-registers').click();
  await page.getByTestId('lesson-start').click();
  await page.getByTestId('lesson-show-me').click();
  await expect(page.getByTestId('lesson-check')).toContainText('Observed');
  await context.setOffline(false);
});
