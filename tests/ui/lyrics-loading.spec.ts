import { test, expect, type Route } from '@playwright/test';
import { actualApp, importFiles } from './helpers';

for (const outcome of ['content', 'absent', 'failure'] as const) {
  test(`lyrics keep checking visible until the provider returns ${outcome}`, async ({ page }) => {
    let accept: (route: Route) => void;
    const pending = new Promise<Route>(resolve => accept = resolve);
    await page.route('**/public/lyrics/api/get**', route => accept(route));
    await page.route('**/public/lyrics/api/search**', route => route.fulfill({ json: [] }));
    await page.route(/\/public\/(genius|musixmatch)\//, route => route.fulfill({ status: 404, body: '' }));
    await actualApp(page);
    await importFiles(page, ['one.mp3']);
    await page.getByRole('button', { name: 'Добавить треки · 1', exact: true }).click();
    await page.getByTestId('import-result').getByRole('button', { name: 'Открыть результат', exact: true }).click();
    await page.getByRole('button', { name: /^Воспроизвести: Тест локального импорта/ }).click();
    await page.getByTestId('mini-player').getByRole('button', { name: 'Открыть плеер', exact: true }).click();
    await page.getByTestId('player').getByRole('button', { name: 'Пауза', exact: true }).click();
    await page.getByTestId('player').getByRole('button', { name: 'Текст песни', exact: true }).click();
    const route = await pending;
    await expect(page.getByRole('status', { name: '' }).filter({ hasText: 'Проверка наличия текста…' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Нет текста', exact: true })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Не удалось проверить наличие текста', exact: true })).toHaveCount(0);
    await route.fulfill({ status: outcome === 'content' ? 200 : outcome === 'absent' ? 404 : 503, json: outcome === 'content' ? { syncedLyrics: '[00:00.00]A provider result after checking' } : {} });
    if (outcome === 'content') await expect(page.getByRole('button', { name: 'A provider result after checking', exact: true })).toBeVisible();
    else await expect(page.getByRole('heading', { name: outcome === 'absent' ? 'Нет текста' : 'Не удалось проверить наличие текста', exact: true })).toBeVisible();
    await expect(page.getByText('Проверка наличия текста…', { exact: true })).toHaveCount(0);
  });
}
