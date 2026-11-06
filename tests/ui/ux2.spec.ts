import { test, expect } from '@playwright/test';
import { ready, goTab, openPlayer, chooseAppearance } from './helpers';
test.beforeEach(async ({ page }) => { await page.addInitScript(() => document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.setProperty('--inset-top', '48px'); document.documentElement.style.setProperty('--inset-bottom', '24px'); })); });
test.use({ video: { mode: 'on', size: { width: 412, height: 915 } } });
test('first launch picks colors live, then imports, and both steps can be skipped', async ({ page }) => {
  await page.goto('/?demo=1'); await expect(page.getByTestId('onboarding-colors')).toBeVisible();
  await expect(page.getByRole('option', { name: 'Обложка', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.screenshot({ path: 'docs/screens/ux2/first-run-colors.png' });
  await page.getByRole('option', { name: 'Аметист', exact: true }).click(); await expect(page.locator('html')).toHaveAttribute('data-colors', 'amethyst');
  await page.getByRole('button', { name: 'Дальше', exact: true }).click(); await expect(page.getByTestId('onboarding-home')).toBeVisible(); await page.getByRole('switch', { name: 'Рекомендации по моему вкусу' }).click(); await page.getByRole('button', { name: 'Spotify', exact: true }).click(); await page.screenshot({ path: 'docs/screens/ux2/first-run-home.png' }); await page.getByRole('button', { name: 'Дальше', exact: true }).click(); await expect(page.getByTestId('onboarding-import')).toBeVisible();
  await page.screenshot({ path: 'docs/screens/ux2/first-run-import.png' }); await page.getByRole('button', { name: 'Пропустить', exact: true }).click();
  await page.reload(); await expect(page.locator('[data-testid^="onboarding-"]')).toHaveCount(0); await expect(page.getByTestId('for-you')).toHaveCount(0);
});
test('skip works for each first-launch step', async ({ page }) => { await page.goto('/?demo=1'); await page.getByRole('button', { name: 'Пропустить', exact: true }).click(); await expect(page.getByTestId('onboarding-home')).toBeVisible(); await page.getByRole('button', { name: 'Пропустить', exact: true }).click(); await expect(page.getByTestId('onboarding-import')).toBeVisible(); await page.getByRole('button', { name: 'Пропустить', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Главная', exact: true })).toBeVisible(); });
test('capture new color palettes on home and player', async ({ page }) => {
  test.setTimeout(60000); await ready(page); await goTab(page, 'Настройки'); await chooseAppearance(page, 'Анимации', 'Выкл');
  for (const [id, label] of [['amethyst','Аметист'], ['silver','Серебро'], ['lime','Лайм'], ['gold','Золото']]) {
    await chooseAppearance(page, 'Цвета', label!); await expect(page.locator('html')).toHaveAttribute('data-colors', id!);
    await goTab(page, 'Главная'); await page.screenshot({ path: `docs/screens/ux2/${id}-home.png` }); await openPlayer(page); await page.screenshot({ path: `docs/screens/ux2/${id}-player.png` }); await goTab(page, 'Настройки');
  }
});
test('crossfade changes artwork, title and waveform during the overlap', async ({ page }) => {
  await ready(page); await openPlayer(page); const player = page.getByTestId('player'), slider = player.getByRole('slider');
  await slider.focus(); await page.keyboard.press('End'); await page.keyboard.press('ArrowLeft'); await player.getByRole('button', { name: 'Воспроизвести', exact: true }).click();
  await expect(player).toHaveAttribute('data-crossfade', /0\./);
  await expect(player.getByRole('heading', { name: 'Как ты там?', exact: true })).toBeVisible();
  expect(Number(await page.getByTestId('track-artwork').getAttribute('data-transition-progress'))).toBeLessThan(.4);
  expect(Number(await page.getByTestId('waveform').getAttribute('data-morph-progress'))).toBeLessThan(.4);
  await page.screenshot({ path: 'docs/screens/ux2/crossfade-start.png' });
  await expect.poll(async () => Number(await player.getAttribute('data-crossfade'))).toBeGreaterThan(.45);
  await page.screenshot({ path: 'docs/screens/ux2/crossfade-middle.png' });
  await expect(player).not.toHaveAttribute('data-crossfade', /./);
  await expect(page.getByTestId('waveform')).toHaveAttribute('data-morph-progress', '1.000'); await page.screenshot({ path: 'docs/screens/ux2/crossfade-end.png' });
});
test('cover follows the finger and release completes switching', async ({ page }) => {
  await ready(page); await openPlayer(page); const artwork = page.getByTestId('track-artwork'), bounds = (await artwork.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2); await page.mouse.down(); await page.mouse.move(bounds.x + bounds.width / 2 - 95, bounds.y + bounds.height / 2, { steps: 10 });
  await expect(artwork.locator('.current')).toHaveAttribute('style', /translateX\(-95px\)/); await page.screenshot({ path: 'docs/screens/ux2/cover-drag.png' }); await page.mouse.up();
  await expect(page.getByTestId('player').getByRole('heading', { name: 'Как ты там?', exact: true })).toBeVisible();
});
test('zoomed wave scrolls under a fixed centre playhead and ticks bar by bar', async ({ page }) => {
  await ready(page); await openPlayer(page); const wave = page.getByTestId('waveform'), bounds = (await wave.boundingBox())!;
  const before = Number(await wave.getAttribute('aria-valuenow'));
  await page.mouse.move(bounds.x + bounds.width - 20, bounds.y + 15); await page.mouse.down(); await page.mouse.move(bounds.x + 20, bounds.y + 15, { steps: 12 });
  const capsule = (await wave.locator('.time').boundingBox())!; expect(Math.abs(capsule.x + capsule.width / 2 - (bounds.x + bounds.width / 2))).toBeLessThan(4);
  await page.mouse.up();
  await expect.poll(async () => Number(await wave.getAttribute('aria-valuenow'))).toBeGreaterThan(before + 40);
});
test.describe('record motion', () => {
  test.afterEach(async ({ page }, info) => { const video = page.video(); await page.close(); if (video) await video.saveAs(`docs/screens/ux2/video/${info.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.webm`); });
  for (const [name, preset] of [['smooth', 'Плавный'], ['retro', 'Ретро']]) test(`record ${name} track switch`, async ({ page }) => { await ready(page); await goTab(page, 'Настройки'); await chooseAppearance(page, 'Анимации', preset!); await openPlayer(page); await page.getByTestId('player').getByRole('button', { name: 'Следующий трек', exact: true }).click(); await expect(page.getByTestId('player').getByRole('heading', { name: 'Как ты там?', exact: true })).toBeVisible(); await page.waitForTimeout(1000); });
  test('record waveform seek', async ({ page }) => { await ready(page); await openPlayer(page); const rect = (await page.getByTestId('waveform').boundingBox())!; await page.mouse.move(rect.x + 5, rect.y + 15); await page.mouse.down(); await page.mouse.move(rect.x + rect.width - 5, rect.y + 15, { steps: 45 }); await page.mouse.up(); await page.waitForTimeout(300); });
  test('record mini player flight', async ({ page }) => { await ready(page); await openPlayer(page); await page.waitForTimeout(600); await page.getByRole('button', { name: 'Свернуть плеер', exact: true }).click(); await expect(page.getByTestId('mini-player')).toBeVisible(); await page.waitForTimeout(600); });
});
