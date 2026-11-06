import { test, expect } from '@playwright/test';
import { ready } from './helpers';

test('the optional battery prompt appears while the playback clock keeps ticking and requests permission only on tap', async ({ page }) => {
  await page.route('**/src/platform/playback-power.ts*', route => route.fulfill({ contentType: 'application/javascript', body: `export function createPlaybackPower() { return { async getStatus() { return { unrestricted: false, powerSave: false }; }, async request() { window.__powerRequested = true; }, subscribe() { return () => {}; } }; }` }));
  await ready(page);
  await page.getByTestId('mini-player').getByRole('button', { name: 'Воспроизвести', exact: true }).click();
  const prompt = page.getByRole('dialog', { name: 'Воспроизведение в фоне', exact: true });
  await expect(prompt).toBeVisible({ timeout: 4000 });
  expect(await page.evaluate(() => (window as unknown as { __powerRequested?: boolean }).__powerRequested)).toBeUndefined();
  await prompt.getByRole('button', { name: 'Настроить фоновую работу', exact: true }).click();
  await expect(prompt).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { __powerRequested?: boolean }).__powerRequested)).toBe(true);
  await page.waitForTimeout(1700); await expect(prompt).toHaveCount(0);
});
