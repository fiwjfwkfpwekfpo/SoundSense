import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { ready, goTab, openPlayer } from './helpers';
import { importErrorKinds } from '../../src/core/imports';
async function openImport(page: Page, scenario?: string) {
  await ready(page);
  if (scenario) await page.goto(`/?demo=1&scenario=${scenario}`);
  await page.getByRole('button', { name: 'Плейлисты', exact: true }).click();
  await page.getByRole('button', { name: 'Импорт музыки', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Импорт музыки', exact: true })).toBeVisible();
}
async function linkImport(page: Page) {
  await page.getByRole('textbox', { name: 'Ссылка', exact: true }).fill('https://soundcloud.com/user/sets/night');
  await page.getByRole('button', { name: 'Импортировать', exact: true }).click();
}
test('link import continues in the background and supports manual corrections and deduplication', async ({ page }) => {
  await openImport(page); await page.screenshot({ path: 'docs/screens/ux/import-link.png' }); await linkImport(page);
  await expect(page.getByTestId('import-progress')).toBeVisible(); await page.screenshot({ path: 'docs/screens/ux/import-progress.png' });
  await goTab(page, 'Поиск'); await expect(page.getByTestId('import-banner')).toBeVisible(); await page.getByTestId('import-banner').click();
  await expect(page.getByTestId('import-result')).toBeVisible(); await expect(page.getByTestId('import-result')).toContainText('Импортировано 6 из 12');
  await page.screenshot({ path: 'docs/screens/ux/import-result.png' });
  await page.getByTestId('import-uncertain').getByRole('button', { name: 'Верно', exact: true }).first().click();
  await expect(page.getByTestId('import-result')).toContainText('Импортировано 7 из 12');
  await page.getByTestId('import-missing').getByRole('button', { name: 'Найти вручную', exact: true }).first().click();
  await expect(page.getByRole('textbox', { name: 'Поиск музыки' })).toHaveValue('Unknown artist — Unreleased midnight');
  await page.getByRole('textbox', { name: 'Поиск музыки' }).fill('Полутона'); await page.getByRole('button', { name: 'Выбрать для импорта' }).click();
  await expect(page.getByTestId('import-result')).toContainText('Импортировано 8 из 12');
  for (const section of ['missing', 'uncertain', 'unavailable']) { await page.getByTestId(`import-${section}`).scrollIntoViewIfNeeded(); await page.screenshot({ path: `docs/screens/ux/result-${section}.png` }); }
  await page.getByRole('button', { name: 'Ещё один импорт' }).click(); await linkImport(page);
  await expect(page.getByTestId('import-result')).toContainText('Новых: 0, уже были: 6');
});
test('Spotify reads the chosen ZIP and imports selected collections', async ({ page }) => {
  await openImport(page); await page.getByRole('button', { name: 'Spotify', exact: true }).click();
  await page.getByRole('tab', { name: 'Из экспорта', exact: true }).click();
  await page.screenshot({ path: 'docs/screens/ux/import-spotify-instructions.png' });
  await page.getByLabel('Выбрать архив .zip', { exact: true }).setInputFiles('tests/fixtures/spotify-account.zip');
  await expect(page.getByRole('checkbox')).toHaveCount(2); await page.screenshot({ path: 'docs/screens/ux/import-spotify-selection.png' });
  await page.getByRole('button', { name: 'Импортировать', exact: true }).click(); await expect(page.getByTestId('import-result')).toBeVisible();
  await expect(page.getByTestId('import-missing')).toContainText('Unknown song');
});
test('Yandex mock account and device folder have separate entry points', async ({ page }) => {
  await openImport(page); await page.getByRole('button', { name: 'Яндекс', exact: true }).click(); await page.getByText('Личный аккаунт · необязательно', { exact: true }).click(); await page.getByRole('button', { name: 'Войти в Яндекс' }).click();
  await expect(page.getByRole('checkbox')).toHaveCount(2); await page.screenshot({ path: 'docs/screens/ux/import-yandex.png' });
  await page.getByRole('button', { name: 'Файлы', exact: true }).click(); await expect(page.getByRole('button', { name: 'Выбрать папку' })).toBeVisible(); await page.screenshot({ path: 'docs/screens/ux/import-folder.png' });
});
for (const kind of importErrorKinds) test(`import error ${kind} has its own text and recovery`, async ({ page }) => {
  await openImport(page, `import-${kind}`); await linkImport(page);
  const error = page.locator(`[data-error-kind="${kind}"]`); await expect(error).toBeVisible();
  await expect(error.getByRole('heading')).not.toContainText('import.error');
  if (!['empty', 'offline'].includes(kind)) await expect(error.getByRole('button').first()).toBeVisible();
  await error.scrollIntoViewIfNeeded(); await page.screenshot({ path: `docs/screens/ux/error-${kind}.png` });
});
test('an advisory offline flag does not display a global network banner or disable tracks', async ({ page }) => {
  await ready(page); await page.context().setOffline(true);
  await expect(page.locator('.offline-banner')).toHaveCount(0);
  await goTab(page, 'Мне нравится');
  await expect(page.locator('main .track-row.offline')).toHaveCount(0);
  const row = page.locator('main .track-row').first(); await row.locator('.track-main').click({ trial: true });
  await page.screenshot({ path: 'docs/screens/ux/offline.png' }); await page.context().setOffline(false); await expect(page.locator('.offline-banner')).toHaveCount(0);
});
test('list gestures, long press and large-font chips keep their bounds', async ({ page }) => {
  await ready(page); await goTab(page, 'Мне нравится');
  const row = page.locator('main .route-content:not([data-motion-exiting]) .swipe-row').first();
  await row.locator('.track-main').click({ trial: true });
  const bounds = (await row.boundingBox())!;
  const gesture = async (dx: number) => { await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2); await page.mouse.down(); await page.mouse.move(bounds.x + bounds.width / 2 + dx, bounds.y + bounds.height / 2, { steps: 8 }); };
  await gesture(95); await page.screenshot({ path: 'docs/screens/ux/swipe-next.png' }); await page.mouse.up(); await expect(page.locator('.toast')).toHaveText('Трек сыграет следующим');
  await gesture(-95); await page.mouse.up(); await expect(page.getByTestId('virtual-list')).toHaveAttribute('data-total', '2047');
  await row.locator('.track-main').first().click({ delay: 550 }); await expect(page.getByRole('dialog')).toBeVisible(); await page.keyboard.press('Escape');
  await goTab(page, 'Настройки'); await page.getByRole('slider', { name: 'Размер шрифта' }).fill('130');
  await goTab(page, 'Главная'); await page.getByRole('button', { name: 'Плейлисты', exact: true }).click();
  const dimensions = await page.locator('.chip').evaluateAll(nodes => nodes.map(node => ({ client: node.clientWidth, scroll: node.scrollWidth })));
  expect(dimensions.every(item => item.scroll <= item.client + 1)).toBe(true); await page.screenshot({ path: 'docs/screens/ux/library-130.png' });
});
test('tabs retain child routes and scroll, active-tab tap scrolls up then returns to root', async ({ page }) => {
  await ready(page); await goTab(page, 'Мне нравится'); await page.locator('main').evaluate(node => node.scrollTop = 150);
  const top = await page.locator('main').evaluate(node => node.scrollTop); await goTab(page, 'Поиск'); await page.getByRole('textbox', { name: 'Поиск музыки' }).fill('lunar');
  await goTab(page, 'Библиотека'); await expect(page.getByRole('heading', { name: 'Мне нравится', exact: true })).toBeVisible(); await expect.poll(() => page.locator('main').evaluate(node => node.scrollTop)).toBe(top);
  await goTab(page, 'Библиотека'); await expect.poll(() => page.locator('main').evaluate(node => node.scrollTop)).toBe(0); await goTab(page, 'Библиотека'); await expect(page.getByTestId('library-liked')).toBeVisible();
  await goTab(page, 'Главная'); await expect(page.getByRole('heading', { name: 'Главная', exact: true })).toBeVisible();
  await goTab(page, 'Поиск'); await expect(page.getByRole('textbox', { name: 'Поиск музыки' })).toHaveValue('lunar');
});
test('sleep timer is visible in the player menu', async ({ page }) => {
  await ready(page); await openPlayer(page); await page.getByRole('button', { name: 'Меню плеера' }).click(); await page.getByRole('button', { name: 'Таймер сна', exact: true }).click();
  await page.getByRole('button', { name: '15 мин', exact: true }).click(); await page.getByRole('button', { name: 'Меню плеера' }).click(); await page.getByRole('button', { name: /Таймер сна/ }).click();
  await expect(page.getByText(/Осталось (15:00|14:5\d)/)).toBeVisible(); await page.screenshot({ path: 'docs/screens/ux/sleep-timer.png' });
});
for (const scenario of ['empty', 'slow', 'errors']) test(`capture ${scenario} state`, async ({ page }) => { await ready(page); await page.goto(`/?demo=1&scenario=${scenario}`); if (scenario === 'slow') await expect(page.getByTestId('skeleton')).toBeVisible(); await page.screenshot({ path: `docs/screens/ux/state-${scenario}.png` }); });

test('first import onboarding can be skipped', async ({ page }) => { await page.goto('/?demo=1'); await page.getByRole('button', { name: 'Пропустить', exact: true }).click(); await page.getByRole('button', { name: 'Пропустить', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Перенеси свою музыку' })).toBeVisible(); await page.screenshot({ path: 'docs/screens/ux/first-run.png' }); await page.getByRole('button', { name: 'Пропустить', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Главная', exact: true })).toBeVisible(); });
