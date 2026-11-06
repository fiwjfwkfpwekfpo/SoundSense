import { test, expect } from '@playwright/test';
import { ready, goTab, openPlayer, choose, chooseAppearance } from './helpers';
test.beforeEach(async ({ page }) => { await ready(page); });
test('all screens stay local and run without JavaScript errors', async ({ page }) => {
  const errors: string[] = []; const remote: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (!new URL(request.url()).hostname.match(/^(127\.0\.0\.1|localhost)$/)) remote.push(request.url()); });
  await goTab(page, 'Мне нравится'); await expect(page.getByTestId('virtual-list')).toHaveAttribute('data-total', '2048');
  await goTab(page, 'Поиск'); await page.getByRole('textbox', { name: 'Поиск музыки' }).fill('lunar');
  await expect(page.locator('[data-track-id]')).toHaveCount(3);
  await goTab(page, 'Настройки'); await expect(page.getByRole('button', { name: 'Анимации', exact: true })).toBeVisible();
  await openPlayer(page); await page.getByRole('button', { name: 'Текст песни', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Текст песни', exact: true })).toBeVisible();
  expect(errors).toEqual([]); expect(remote).toEqual([]);
});
test('virtualizes 2048 tracks and reaches the end without rendering the full library', async ({ page }) => {
  await goTab(page, 'Мне нравится'); const rows = page.locator('main [data-track-id]');
  await expect(rows.first()).toBeVisible(); expect(await rows.count()).toBeLessThan(35);
  await page.locator('main').evaluate(element => element.scrollTop = element.scrollHeight);
  await expect(page.locator('main [data-track-id="collection-2024"]')).toBeAttached();
  expect(await rows.count()).toBeLessThan(35);
  await page.locator('main').evaluate(element => element.scrollTop = 0);
  await page.getByRole('textbox', { name: 'Найти в плейлисте' }).fill('Полутона');
  await expect(page.getByTestId('virtual-list')).toHaveAttribute('data-total', '1');
});
test('theme, language and playback preferences persist and change immediately', async ({ page }) => {
  await goTab(page, 'Настройки'); await chooseAppearance(page, 'Цвета', 'Светлая фикстура');
  await expect(page.locator('html')).toHaveAttribute('data-color-scheme', 'light');
  expect(await page.locator('html').evaluate(element => element.style.getPropertyValue('--palette-mainBg').trim())).toBe('#f6f2ea');
  await page.getByRole('switch', { name: 'Вибрация', exact: true }).click();
  await choose(page, 'Язык', 'English');
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await page.reload(); await expect(page.locator('html')).toHaveAttribute('data-color-scheme', 'light');
  await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'My wave', exact: true })).toHaveCount(0);
});
test('waveform supports seek, playback, three repeat modes and progress fallback', async ({ page }) => {
  await openPlayer(page); const slider = page.getByRole('slider', { name: 'Позиция воспроизведения' });
  await slider.click({ position: { x: 300, y: 40 } }); expect(Number(await slider.getAttribute('aria-valuenow'))).toBeGreaterThan(10);
  await page.getByRole('button', { name: 'Воспроизвести', exact: true }).click(); await expect(page.getByRole('button', { name: 'Пауза', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Повтор выключен' }).click(); await page.getByRole('button', { name: 'Повтор всей очереди' }).click(); await expect(page.getByRole('button', { name: 'Повтор одного трека' })).toBeVisible();
  await slider.focus(); await page.keyboard.press('Home'); await expect(slider).toHaveAttribute('aria-valuenow', '0');
  await goTab(page, 'Настройки'); await page.getByRole('switch', { name: 'Волна вместо прогресс-бара' }).click(); await openPlayer(page);
  await expect(page.getByTestId('waveform')).toBeVisible(); await expect(page.getByTestId('waveform').locator('.times span')).toHaveCount(2);
});
test('browser back closes sheets before the full-screen player', async ({ page }) => {
  await openPlayer(page); await page.getByRole('button', { name: 'Меню плеера' }).click(); await expect(page.getByRole('dialog')).toBeVisible();
  await page.goBack(); await expect(page.getByRole('dialog')).toHaveCount(0); await expect(page.getByTestId('player')).toBeVisible();
  await page.goBack(); await expect(page.getByTestId('player')).toHaveCount(0); await expect(page.getByRole('heading', { name: 'Главная', exact: true })).toBeVisible();
});
test('track actions change likes, enqueue and add to a playlist', async ({ page }) => {
  await goTab(page, 'Мне нравится'); await page.getByRole('button', { name: 'Меню трека Полутона', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Играть следующим', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
  await openPlayer(page); await page.getByRole('button', { name: 'Очередь', exact: false }).click(); await expect(page.locator('[data-queue-id]').first()).toContainText('Полутона');
  await page.getByRole('button', { name: 'Назад', exact: true }).click(); await page.getByRole('button', { name: 'Свернуть плеер' }).click();
  await page.getByRole('button', { name: 'Меню трека Полутона', exact: true }).click(); await page.getByRole('dialog').getByRole('button', { name: 'Убрать из любимого', exact: true }).click();
  await expect(page.locator('main [data-testid="virtual-list"]')).toHaveAttribute('data-total', '2047');
  await expect(page.locator('main [data-track-id="track-1"]')).toHaveCount(0);
});
test('queue reorders by pointer and supports keyboard removal', async ({ page }) => {
  await openPlayer(page); await page.getByRole('button', { name: 'Очередь', exact: false }).click();
  const rows = page.locator('[data-queue-id]'); const firstId = await rows.first().getAttribute('data-queue-id');
  const grip = rows.first().getByRole('button', { name: /Переместить/ }); const start = await grip.boundingBox(); const target = await rows.nth(2).boundingBox();
  if (!start || !target) throw new Error('Missing queue row bounds');
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2); await page.mouse.down(); await page.mouse.move(start.x + start.width / 2, target.y + target.height / 2, { steps: 12 }); await page.mouse.up();
  await expect(rows.nth(2)).toHaveAttribute('data-queue-id', firstId!);
  await rows.nth(2).getByRole('button', { name: /Переместить/ }).focus(); await page.keyboard.press('Delete');
  await expect(page.locator(`[data-queue-id="${firstId}"]`)).toHaveCount(0);
});
test('lyrics seek and empty state follow the current track', async ({ page }) => {
  await openPlayer(page); await page.getByRole('button', { name: 'Текст песни', exact: true }).click();
  const line = page.getByRole('button', { name: 'Мы остаёмся в полутонах', exact: true }); await line.click(); await expect(line).toHaveAttribute('aria-current', 'true');
  await page.getByRole('button', { name: 'Назад', exact: true }).click(); await expect(page.getByRole('slider', { name: 'Позиция воспроизведения' })).toHaveAttribute('aria-valuenow', '72');
  await page.getByRole('button', { name: 'Следующий трек', exact: true }).click(); await page.getByRole('button', { name: 'Текст песни', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Нет текста' })).toBeVisible();
});
test('custom color JSON applies immediately and rejects unsafe values atomically', async ({ page }) => {
  await goTab(page, 'Настройки'); await page.getByRole('button', { name: 'Цвета', exact: true }).click(); await page.getByRole('option', { name: 'Свой', exact: true }).click();
  const editor = page.getByRole('textbox', { name: 'JSON пакета' });
  const previousBg = await page.locator('html').evaluate(element => element.style.getPropertyValue('--palette-mainBg'));
  await editor.fill(JSON.stringify({ version: 1, name: 'Unsafe', palette: { mainBg: 'url(https://example.com)' } }));
  await expect(page.getByRole('alert')).toBeVisible();
  expect(await page.locator('html').evaluate(element => element.style.getPropertyValue('--palette-mainBg'))).toBe(previousBg);
  await editor.fill(JSON.stringify({ version: 1, name: 'Custom', scheme: 'dark', palette: { mainBg: '#202020' } }));
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(await page.locator('html').evaluate(element => element.style.getPropertyValue('--palette-mainBg'))).toBe('#202020');
});
test('player and sheet dismiss with downward swipes', async ({ page }) => {
  await openPlayer(page);
  await page.mouse.move(160, 270); await page.mouse.down(); await page.mouse.move(160, 410, { steps: 12 }); await page.mouse.up();
  await expect(page.getByTestId('player')).toHaveCount(0);
  await goTab(page, 'Мне нравится'); await page.getByRole('button', { name: 'Меню трека Полутона', exact: true }).click();
  const handle = page.getByRole('button', { name: 'Свернуть шторку' }); const bounds = await handle.boundingBox();
  if (!bounds) throw new Error('Missing sheet handle');
  await page.mouse.move(bounds.x + 100, bounds.y + 10); await page.mouse.down(); await page.mouse.move(bounds.x + 100, bounds.y + 100, { steps: 12 }); await page.mouse.up();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
test('queue swipes remove songs and playlist actions update the destination', async ({ page }) => {
  await openPlayer(page); await page.getByRole('button', { name: 'Очередь', exact: false }).click();
  const row = page.locator('[data-queue-id]').first(); const id = await row.getAttribute('data-queue-id'); const bounds = await row.boundingBox();
  if (!bounds) throw new Error('Missing queue row');
  await page.mouse.move(bounds.x + 220, bounds.y + 34); await page.mouse.down(); await page.mouse.move(bounds.x + 70, bounds.y + 34, { steps: 12 }); await page.mouse.up();
  await expect(page.locator(`[data-queue-id="${id}"]`)).toHaveCount(0);
  await goTab(page, 'Поиск'); await page.getByRole('textbox', { name: 'Поиск музыки' }).fill('First Light');
  await page.getByRole('button', { name: 'Меню трека First Light', exact: true }).click(); await page.getByRole('button', { name: 'В плейлист', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: /Фон/ }).click();
  await goTab(page, 'Главная'); await page.getByRole('button', { name: /Фон, 38 треков/ }).click();
  await page.getByRole('textbox', { name: 'Найти в плейлисте' }).fill('First Light'); await expect(page.getByTestId('virtual-list')).toHaveAttribute('data-total', '1');
});
test('touch swipes change tracks on the mini and full player without opening or seeking accidentally', async ({ page }) => {
  const client = await page.context().newCDPSession(page);
  async function swipe(x1: number, y: number, x2: number) {
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x1, y }] });
    for (let step = 1; step <= 8; step++) {
      await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x1 + (x2 - x1) * step / 8, y }] });
    }
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }
  const mini = page.getByTestId('mini-player'); const bounds = await mini.boundingBox();
  await expect(mini.locator('.title-motion:not([data-motion-exiting]) strong')).toHaveText('Полутона');
  await swipe(bounds!.x + 220, bounds!.y + 30, bounds!.x + 50);
  await expect(mini.locator('.title-motion:not([data-motion-exiting]) strong')).toHaveText('Как ты там?'); await expect(page.getByTestId('player')).toHaveCount(0);
  await swipe(bounds!.x + 50, bounds!.y + 30, bounds!.x + 220);
  await expect(mini.locator('.title-motion:not([data-motion-exiting]) strong')).toHaveText('Полутона');
  await openPlayer(page); await swipe(310, 400, 80); await expect(page.getByTestId('player').getByRole('heading')).toContainText('Как ты там?');
  await page.getByRole('slider').click({ position: { x: 280, y: 35 } });
  await swipe(80, 400, 310); await expect(page.getByTestId('player').getByRole('heading')).toContainText('Полутона');
  await expect(page.getByRole('button', { name: 'Воспроизвести', exact: true })).toBeVisible();
});
