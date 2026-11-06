import { test, expect } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import { ready, goTab, openPlayer, chooseAppearance, choose } from './helpers';

test.beforeEach(async ({ page }) => { await ready(page); });

test('style recommendations, manual selections and custom reset stay independent', async ({ page }) => {
  await goTab(page, 'Настройки'); await chooseAppearance(page, 'Стиль', 'Ретро');
  await expect(page.locator('html')).toHaveAttribute('data-colors', 'lime');
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'retro');
  await chooseAppearance(page, 'Цвета', 'Светлая фикстура'); await chooseAppearance(page, 'Анимации', 'Пружинный');
  await chooseAppearance(page, 'Стиль', 'Стандарт'); await chooseAppearance(page, 'Стиль', 'Ретро');
  await expect(page.locator('html')).toHaveAttribute('data-colors', 'custom');
  await expect(page.locator('html')).toHaveAttribute('data-color-scheme', 'light');
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'spring');
  await page.getByRole('button', { name: 'Стиль', exact: true }).click(); await page.getByRole('option', { name: 'Свой', exact: true }).click();
  const radius = page.getByRole('slider', { name: 'Средний радиус' }); await radius.focus(); await page.keyboard.press('ArrowRight');
  await expect.poll(() => page.locator('html').evaluate(element => element.style.getPropertyValue('--radius-m'))).toBe('1px');
  await page.getByRole('button', { name: 'Сбросить к пресету' }).click();
  await expect.poll(() => page.locator('html').evaluate(element => element.style.getPropertyValue('--radius-m'))).toBe('0px');
  expect(await page.locator('html').evaluate(element => element.style.getPropertyValue('--chrome-borders'))).toBe('1');
  await page.getByRole('dialog').getByRole('button', { name: 'Закрыть', exact: true }).click();
  await page.getByRole('button', { name: 'Вернуть по стилю: Цвета', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-colors', 'lime');
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'spring');
});

test('system reduced motion yields to manual presets and group overrides', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'minimal');
  await goTab(page, 'Настройки'); await chooseAppearance(page, 'Анимации', 'Пружинный');
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'spring');
  await expect(page.locator('html')).toHaveAttribute('data-motion-player', 'expand');
  await page.getByRole('button', { name: 'Анимации', exact: true }).click();
  await choose(page, 'Пресет: Название трека', 'Ретро');
  await expect(page.locator('html')).toHaveAttribute('data-motion-title', 'split-flap');
  await expect(page.locator('html')).toHaveAttribute('data-motion-player', 'expand');
  await page.getByRole('button', { name: 'Показать анимацию: Название трека' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Закрыть', exact: true }).click();
  await page.reload(); await expect(page.locator('html')).toHaveAttribute('data-motion-title', 'split-flap');
});

test('artwork extraction remains stable across tracks and palette round trips', async ({ page }) => {
  await goTab(page, 'Настройки'); await chooseAppearance(page, 'Цвета', 'Обложка');
  await expect(page.locator('html')).toHaveAttribute('data-artwork-sampled', 'true');
  const palette = () => page.locator('html').evaluate(element => ['mainBg', 'cardBg', 'accent'].map(role => element.style.getPropertyValue(`--palette-${role}`)));
  const initial = await palette();
  await openPlayer(page); await page.getByRole('button', { name: 'Следующий трек', exact: true }).click();
  await expect.poll(palette).not.toEqual(initial);
  await page.getByRole('button', { name: 'Предыдущий трек', exact: true }).click();
  await expect.poll(palette).toEqual(initial);
  await goTab(page, 'Настройки'); await chooseAppearance(page, 'Цвета', 'Светлая фикстура'); await chooseAppearance(page, 'Цвета', 'Обложка');
  await expect.poll(palette).toEqual(initial);
});

test('retro density resolves row pixels and reaches the final item with safe dock bounds', async ({ page }) => {
  await goTab(page, 'Настройки'); await chooseAppearance(page, 'Стиль', 'Ретро'); await goTab(page, 'Мне нравится');
  const row = page.locator('main [data-track-id]').first();
  await row.locator('.track-main').click({ trial: true });
  const height = (await row.boundingBox())!.height;
  expect(height).toBeGreaterThanOrEqual(56); expect(height).toBeLessThan(68);
  await page.locator('main').evaluate(element => element.scrollTop = element.scrollHeight);
  const end = page.locator('main [data-track-id="collection-2024"]'); await expect(end).toBeVisible();
  const bottom = (await end.boundingBox())!; const dock = (await page.getByTestId('dock').boundingBox())!;
  expect(bottom.y + bottom.height).toBeLessThanOrEqual(dock.y + 1);
  expect(await page.locator('main [data-track-id]').count()).toBeLessThan(40);
});

test('custom editor survives nested selectors and keeps exact JSON draft and cursor', async ({ page }) => {
  await goTab(page, 'Настройки'); await page.getByRole('button', { name: 'Цвета', exact: true }).click();
  await page.getByRole('option', { name: 'Свой', exact: true }).click();
  await choose(page, 'Схема интерфейса', 'Светлая');
  await expect(page.getByRole('button', { name: 'Сбросить к пресету' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-color-scheme', 'light');
  const input = page.getByRole('textbox', { name: 'JSON пакета' });
  const draft = '{\n "version":1,\n "name":"Exact draft",\n "scheme":"dark",\n "palette":{"mainBg":"#202020"}\n}';
  await input.fill(draft); await expect(input).toHaveValue(draft);
  const index = draft.indexOf('Exact') + 2;
  await input.evaluate((element, position) => { const field = element as HTMLTextAreaElement; field.focus(); field.setSelectionRange(position, position); }, index);
  await page.keyboard.type('X'); await expect(input).toHaveValue(draft.slice(0, index) + 'X' + draft.slice(index));
  expect(await input.evaluate(element => (element as HTMLTextAreaElement).selectionStart)).toBe(index + 1);
});

test('all three axes export valid independent browser JSON files', async ({ page }) => {
  await goTab(page, 'Настройки');
  for (const [axis, label, payload] of [['style', 'Стиль', 'tokens'], ['colors', 'Цвета', 'palette'], ['motion', 'Анимации', 'groups']]) {
    await page.getByRole('button', { name: label!, exact: true }).click();
    const downloadPromise = page.waitForEvent('download'); await page.getByRole('button', { name: 'Экспорт JSON', exact: true }).click();
    const download = await downloadPromise; expect(download.suggestedFilename()).toBe(`${axis}.json`);
    const data = JSON.parse(await readFile((await download.path())!, 'utf8'));
    expect(data.version).toBe(1); expect(data[payload!]).toBeDefined();
    for (const other of ['tokens', 'palette', 'groups'].filter(key => key !== payload)) expect(data[other]).toBeUndefined();
    await page.getByRole('dialog').getByRole('button', { name: 'Закрыть', exact: true }).click();
  }
});

test('capture independent styles, colors, mixing and editors', async ({ page }) => {
  test.setTimeout(120000);
  await mkdir('docs/screens/appearance', { recursive: true });
  await goTab(page, 'Настройки'); await chooseAppearance(page, 'Анимации', 'Выкл'); await chooseAppearance(page, 'Цвета', 'Монохром');
  const shot = async (name: string) => { await page.screenshot({ path: `docs/screens/appearance/${name}.png`, animations: 'disabled' }); };
  const screens = async (name: string) => { await goTab(page, 'Главная'); await shot(`${name}-home`); await openPlayer(page); await shot(`${name}-player`); await goTab(page, 'Настройки'); };
  for (const [id, label] of [['standard', 'Стандарт'], ['retro', 'Ретро'], ['flat', 'Плоский']]) { await chooseAppearance(page, 'Стиль', label!); await screens(`style-${id}`); }
  await chooseAppearance(page, 'Стиль', 'Стандарт');
  for (const [id, label] of [['mono', 'Монохром'], ['amethyst', 'Аметист'], ['silver', 'Серебро'], ['lime', 'Лайм'], ['gold', 'Золото'], ['amoled', 'AMOLED'], ['high-contrast', 'Высокий контраст'], ['cover', 'Обложка']]) {
    await chooseAppearance(page, 'Цвета', label!); if (id === 'cover') await expect(page.locator('html')).toHaveAttribute('data-artwork-sampled', 'true'); await screens(`colors-${id}`);
  }
  await chooseAppearance(page, 'Стиль', 'Ретро'); await chooseAppearance(page, 'Цвета', 'Светлая фикстура'); await screens('mixed-retro-linen');
  await chooseAppearance(page, 'Стиль', 'Стандарт'); await chooseAppearance(page, 'Цвета', 'Монохром');
  await page.getByRole('button', { name: 'Стиль', exact: true }).click(); await shot('style-picker'); await page.getByRole('dialog').getByRole('button', { name: 'Закрыть', exact: true }).click();
  await page.getByRole('button', { name: 'Цвета', exact: true }).click(); await shot('colors-picker'); await page.getByRole('option', { name: 'Свой', exact: true }).click(); await shot('colors-editor'); await page.getByRole('dialog').getByRole('button', { name: 'Закрыть', exact: true }).click();
  await page.getByRole('button', { name: 'Стиль', exact: true }).click(); await page.getByRole('option', { name: 'Свой', exact: true }).click(); await shot('style-editor'); await page.getByRole('dialog').getByRole('button', { name: 'Закрыть', exact: true }).click();
  await page.getByRole('button', { name: 'Анимации', exact: true }).click(); await page.locator('.sheet-body').evaluate(element => element.scrollTop = 0); await shot('motion-settings'); await page.locator('.sheet-body').evaluate(element => element.scrollTop = element.scrollHeight); await shot('motion-groups');
});
