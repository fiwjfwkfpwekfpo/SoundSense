import { test, expect } from '@playwright/test';
import { ready, goTab, openPlayer, chooseAppearance } from './helpers';
test.beforeEach(async ({ page }) => { await ready(page); });
test('native runtime never uses the development phone frame', async ({ page }) => {
  await page.setViewportSize({ width: 915, height: 1000 });
  expect((await page.getByTestId('app-shell').boundingBox())?.width).toBe(390);
  await page.evaluate(() => { document.documentElement.dataset.runtime = 'native'; });
  const bounds = await page.getByTestId('app-shell').boundingBox();
  expect(bounds).toMatchObject({ x: 0, y: 0, width: 915, height: 1000 });
});
test('safe areas are applied once and every scroll screen ends above the measured dock', async ({ page }) => {
  const initial = await page.locator('main').evaluate(element => ({ top: element.getBoundingClientRect().top, viewport: innerHeight }));
  expect(initial).toEqual({ top: 48, viewport: 915 });
  for (const tab of ['Мне нравится', 'Поиск', 'Настройки']) {
    await goTab(page, tab);
    if (tab === 'Поиск') { await page.getByRole('textbox', { name: 'Поиск музыки' }).fill('а'); await expect(page.locator('main [data-track-id]').first()).toBeVisible(); }
    await page.locator('main').evaluate(element => { element.scrollTop = element.scrollHeight; });
    const target = tab === 'Мне нравится' ? page.locator('main [data-track-id="collection-2024"]') : tab === 'Настройки' ? page.locator('main footer') : page.locator('main [data-track-id]').last();
    await expect(target).toBeVisible();
    const end = await target.boundingBox(); const dock = await page.getByTestId('dock').boundingBox();
    expect(end!.y + end!.height).toBeLessThanOrEqual(dock!.y + 1);
    const height = await page.getByTestId('app-shell').evaluate(element => parseFloat(getComputedStyle(element).getPropertyValue('--dock-height')));
    expect(height).toBeCloseTo(dock!.height, 1);
  }
  const nav = await page.getByRole('navigation').boundingBox(); expect(nav!.y + nav!.height).toBe(915 - 24 - 16);
});
test('selection sheets cover the dock and contain no native select controls', async ({ page }) => {
  await goTab(page, 'Настройки'); await page.getByRole('button', { name: 'Цвета', exact: true }).click();
  await expect(page.getByRole('option', { name: 'Обложка' })).toHaveAttribute('aria-selected', 'true');
  expect(await page.locator('select').count()).toBe(0);
  const dock = await page.getByTestId('dock').boundingBox();
  const hitDock = await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest('[data-testid="dock"]'), { x: dock!.x + 60, y: 860 });
  expect(hitDock).toBe(false);
  await page.getByRole('listbox').focus(); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
  await expect(page.getByRole('option').first()).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('dialog').getByRole('button', { name: 'Закрыть', exact: true }).click();
  await goTab(page, 'Мне нравится'); await page.getByRole('button', { name: 'Сортировка', exact: true }).click();
  await page.getByRole('option', { name: 'По названию' }).click(); expect(await page.locator('select').count()).toBe(0);
});
test('switches change knob position and palette in both themes', async ({ page }) => {
  await goTab(page, 'Настройки');
  for (const theme of ['Светлая фикстура', 'Монохром']) {
    await chooseAppearance(page, 'Цвета', theme);
    const toggle = page.getByRole('switch', { name: 'Вибрация', exact: true });
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    const before = await toggle.locator('i').boundingBox(); await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await expect.poll(async () => (await toggle.locator('i').boundingBox())!.x).toBeLessThan(before!.x - 10);
    await toggle.click(); await expect(toggle).toHaveAttribute('aria-checked', 'true');
  }
});
test('search focus stays on the capsule and empty query shows only recent searches', async ({ page }) => {
  await goTab(page, 'Поиск'); const input = page.getByRole('textbox', { name: 'Поиск музыки' });
  await input.focus(); await expect(input).toBeFocused(); await expect(page.locator('main [data-track-id]')).toHaveCount(0); await expect(page.locator('.result-heading')).toHaveCount(0);
  const styles = await input.evaluate(element => ({ outline: getComputedStyle(element).outlineStyle, border: getComputedStyle(element).borderWidth, radius: getComputedStyle(element).borderRadius, capsuleOutline: getComputedStyle(element.parentElement!).outlineStyle }));
  expect(styles.outline).toBe('none'); expect(styles.border).toBe('0px'); expect(styles.capsuleOutline).toBe('solid'); expect(parseFloat(styles.radius)).toBeGreaterThan(0);
});
test('mini progress is clipped and player has five controls with active shuffle', async ({ page }) => {
  const mini = page.getByTestId('mini-player'); const card = await mini.boundingBox(); const progress = await mini.locator('.progress').boundingBox();
  expect(progress!.y + progress!.height).toBeLessThanOrEqual(card!.y + card!.height); expect(progress!.x).toBeGreaterThanOrEqual(card!.x);
  await openPlayer(page); await expect(page.locator('.controls > button')).toHaveCount(5);
  const shuffle = page.getByRole('button', { name: 'Перемешивание', exact: true }); await shuffle.click(); await expect(shuffle).toHaveAttribute('aria-pressed', 'true');
  const canvas = page.getByRole('slider'); await canvas.click({ position: { x: 120, y: 30 } });
  expect(await canvas.evaluate(element => getComputedStyle(element).getPropertyValue('-webkit-tap-highlight-color'))).toMatch(/(?:,\s*0|\/\s*0)\)$/);
  await expect(page.locator('.toolbar')).not.toContainText('SoundSense');
});
