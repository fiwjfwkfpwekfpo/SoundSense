import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { actualApp, goTab } from './helpers';

test('a full playback journal downloads above the old 100 KB palette limit', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('ss_diagnostics_v1', JSON.stringify(Array.from({ length: 350 }, (_, id) => ({
      id, at: new Date().toISOString(), scope: 'player', event: 'prepare.failed', level: 'error',
      data: { trackId: `ya-${id}`, message: 'Подробная запись воспроизведения. '.repeat(20), status: 404 },
    }))));
  });
  await actualApp(page); await goTab(page, 'Настройки');
  await page.getByRole('button', { name: 'Диагностика и журнал', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Сохранить журнал', exact: true }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^SoundSense-diagnostics-\d{4}-\d{2}-\d{2}\.json$/);
  const bytes = await readFile((await file.path())!);
  expect(bytes.length).toBeGreaterThan(100_000);
  const data = JSON.parse(bytes.toString());
  expect(data.entries).toHaveLength(350); expect(data.entries.some((e: { event: string }) => e.event === 'prepare.failed')).toBe(true);
  await expect(page.getByText('Журнал сохранён', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Сохранить журнал', exact: true })).toBeEnabled();
});
