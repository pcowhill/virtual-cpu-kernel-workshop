/**
 * End-to-end workflows in a real browser against the production build.
 * The machine runs in a Web Worker; every value checked here is read from
 * the rendered UI, which only shows what the emulated machine produced.
 */
import { expect, test, type Page } from '@playwright/test';

const dockReg = (page: Page, r: string) => page.locator(`.dock [data-testid=reg-${r}]`);

async function step(page: Page, times = 1): Promise<void> {
  for (let i = 0; i < times; i++) {
    const before = await page.getByTestId('cycle').textContent();
    await page.getByTestId('step').click();
    await expect(page.getByTestId('cycle')).not.toHaveText(before ?? '');
  }
}

test('the workbench loads, runs the machine in a Web Worker and builds the default program', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Virtual CPU & Kernel Workshop' })).toBeVisible();
  await expect(page.getByTestId('machine-label')).toContainText('bare metal');
  await expect(page.getByTestId('machine-status')).toHaveText('Paused');
  expect(await page.evaluate(() => typeof Worker)).toBe('function');
});

test('assemble, inspect bytes, step, breakpoint, run to it, inspect registers and memory', async ({ page }) => {
  await page.goto('./');
  await page.getByTestId('quick-start').click();
  await expect(page.getByTestId('machine-label')).toContainText('first-program');

  // First step completes the reset micro-sequence: PC comes from the vector.
  await step(page);
  await expect(page.getByTestId('pc')).toHaveText('0100');

  // MOV R0,#0 ; MOV R1,#10 ; ADD R0,R1
  await step(page, 3);
  await expect(dockReg(page, 'R0')).toHaveText('0A');
  await expect(dockReg(page, 'R1')).toHaveText('0A');

  // Editor: assemble and see the bytes of the first instruction.
  await page.getByTestId('nav-editor').click();
  await page.getByTestId('assemble').click();
  await expect(page.getByTestId('build-status')).toHaveText('build OK');
  await page.locator('.inspector tr.clickable', { hasText: '0100' }).first().click();
  await expect(page.getByTestId('line-bytes')).toContainText('0100:');

  // Breakpoint by clicking the gutter of line 20 ("ST [result], R0").
  await page.locator('.gline.code').filter({ hasText: /^●20/ }).click();
  await expect(page.locator('.gline').nth(19).locator('.bp')).toHaveClass(/on/);

  await page.getByTestId('run-pause').click();
  await expect(page.getByTestId('machine-status')).toHaveText('Paused at breakpoint');
  await expect(dockReg(page, 'R0')).toHaveText('37');

  // Memory before and after the store executes.
  await page.getByTestId('nav-memory').click();
  await page.getByTestId('mem-goto').fill('0x2000');
  await page.getByTestId('mem-goto').press('Enter');
  const cell = page.locator('[data-addr="8192"]');
  await expect(cell).toHaveText('00');
  await step(page);
  await expect(cell).toHaveText('37');

  // Run to completion: the terminal shows the program's output.
  await page.getByTestId('run-pause').click();
  await expect(page.getByTestId('machine-status')).toHaveText('Halted');
  await expect(page.getByTestId('terminal')).toContainText('1 + 2 + ... + 10 = 0x37');
});

test('an assembler error is reported and does not change the loaded machine', async ({ page }) => {
  await page.goto('./');
  await page.getByTestId('nav-editor').click();
  const editor = page.getByTestId('code-editor');
  await editor.click();
  await editor.press('Control+End');
  await editor.pressSequentially('\n        FROB R0\n');
  await page.getByTestId('assemble').click();
  await expect(page.getByTestId('build-status')).toContainText('error');
  await expect(page.getByTestId('diagnostic').first()).toContainText('FROB');
  await expect(page.getByText('sources changed since load')).toBeVisible();
  await expect(page.getByTestId('machine-status')).toHaveText('Paused');
});

test('boot the operating system and observe preemptive process switching', async ({ page }) => {
  await page.goto('./');
  await page.getByTestId('boot-full-os').click();
  await expect(page.getByTestId('machine-label')).toContainText(/OS|operating/i);

  // The firmware loads the kernel by executing instructions; the stages complete in order.
  await expect(page.getByTestId('stage-hdr')).toHaveClass(/done/, { timeout: 20_000 });
  await expect(page.getByTestId('stage-jump')).toHaveClass(/done/, { timeout: 20_000 });
  await expect(page.getByTestId('stage-user')).toHaveClass(/done/, { timeout: 20_000 });

  await page.getByTestId('nav-processes').click();
  const rows = page.locator('[data-testid=process-table] tbody tr');
  await expect(rows).toHaveCount(4);

  // Several processes have been dispatched more than once: the timer preempts them.
  await expect
    .poll(
      async () => {
        const counts = await rows.evaluateAll((trs) => trs.map((tr) => Number(tr.children[7]?.textContent ?? 0)));
        return counts.filter((n) => n >= 2).length;
      },
      { timeout: 30_000 },
    )
    .toBeGreaterThanOrEqual(2);
  await expect(page.getByText(/timer ticks since boot: [1-9]/)).toBeVisible();

  // Keyboard input reaches the echo program through IRQ1 and the kernel driver.
  await page.getByTestId('terminal').click();
  await page.keyboard.type('hi');
  await expect(page.getByTestId('terminal')).toContainText('hi', { timeout: 20_000 });

  await page.getByTestId('run-pause').click();
  await expect(page.getByTestId('machine-status')).not.toContainText('Running');
});

test('the reference lab and the example catalog run checks on the real machine', async ({ page }) => {
  await page.goto('./');
  await page.getByTestId('nav-reference').click();
  await page.getByTestId('isa-search').fill('MOVP');
  await page.locator('tbody tr.clickable').first().click();
  await expect(page.getByTestId('isa-detail')).toContainText('Micro-program');

  await page.getByTestId('nav-examples').click();
  await page.getByTestId('check-register-arithmetic').click();
  await expect(page.getByTestId('result-register-arithmetic')).toContainText(/pass/i, { timeout: 30_000 });
  await expect(page.getByTestId('result-register-arithmetic')).not.toContainText(/fail/i);
});
