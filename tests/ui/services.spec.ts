import { test, expect } from '@playwright/test';
import { actualApp, goTab } from './helpers';
import { resolve } from 'node:path';

for (const kind of ['likes', 'playlist'] as const) test(`public Yandex ${kind} imports by link without account authorization`, async ({ page }) => {
  let authentication = 0;
  await page.route('**/public/yandex-oauth/**', route => { authentication++; return route.fulfill({ status: 500, json: {} }); });
  await page.route('**/public/yandex/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/account/status')) authentication++;
    return route.fulfill({ json: { result: { title: 'Public collection', trackCount: 2, tracks: ['7', '8'].map(id => ({ id, track: { id, title: `Public song ${id}`, artists: [{ id: '1', name: 'Artist' }], durationMs: 180000 } })) } } });
  });
  await actualApp(page); await page.getByRole('button', { name: 'Импорт музыки', exact: true }).click();
  await page.getByRole('button', { name: 'Яндекс', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Войти в Яндекс', exact: true })).not.toBeVisible();
  await page.getByRole('textbox', { name: 'Ссылка', exact: true }).fill(kind === 'likes' ? 'https://music.yandex.ru/playlists/lk.12345678-aaaa' : 'https://music.yandex.ru/users/public/playlists/100');
  await page.getByRole('button', { name: 'Показать коллекции', exact: true }).click();
  await expect(page.getByRole('checkbox')).toBeChecked(); await page.getByRole('button', { name: 'Импортировать', exact: true }).click();
  await expect(page.getByTestId('import-result')).toContainText('Импортировано 2 из 2'); expect(authentication).toBe(0);
  await page.getByTestId('import-result').getByRole('button', { name: 'Открыть результат', exact: true }).click();
  await expect(page.locator('main .track-row')).toHaveCount(2);
});

test('Yandex is in the search selector and a false WebView offline flag does not block a working stream', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'onLine', { get: () => false }));
  await page.route('**/public/yandex/**', route => route.fulfill({ json: new URL(route.request().url()).pathname.endsWith('/search') ? { result: { tracks: { results: [{ id: 7, title: 'Signal', artists: [{ id: 1, name: 'Artist' }], durationMs: 8000 }] } } } : {} }));
  await actualApp(page);
  const sc = { id: 123, title: 'Signal', duration: 8000, user: { id: 1, username: 'Artist' }, media: { transcodings: [{ preset: 'mp3_0_1', url: 'https://api-v2.soundcloud.com/stream/123', format: { protocol: 'progressive', mime_type: 'audio/mpeg' } }] } };
  await page.route('**/public/sc-api/**', route => { const path = new URL(route.request().url()).pathname; return route.fulfill({ json: path.includes('/search/') ? { collection: [sc] } : path.endsWith('/tracks/123') ? sc : path.endsWith('/stream/123') ? { url: 'https://audio.test/full.mp3' } : {} }); });
  await page.route('https://audio.test/full.mp3', route => route.fulfill({ path: resolve('tests/fixtures/audio/one.mp3'), contentType: 'audio/mpeg', headers: { 'Access-Control-Allow-Origin': '*' } }));
  await goTab(page, 'Поиск'); await page.getByRole('button', { name: 'Музыкальный сервис', exact: true }).click();
  for (const name of ['SoundCloud', 'YouTube', 'YouTube Music', 'Яндекс', 'Apple Music', 'Deezer', 'Файлы']) await expect(page.getByRole('option', { name, exact: true })).toBeVisible();
  await page.getByRole('option', { name: 'Яндекс', exact: true }).click();
  await page.getByRole('textbox', { name: 'Поиск музыки' }).fill('Signal');
  await page.getByRole('button', { name: 'Воспроизвести: Signal, Artist', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __media: HTMLAudioElement[] }).__media.some(media => !media.paused && media.currentTime > .2))).toBe(true);
  await expect(page.locator('.offline-banner')).toHaveCount(0);
});

test('settings import signs into Yandex, selects likes and playlists and keeps both destinations', async ({ page }) => {
  let pollCount = 0;
  await page.route('**/public/yandex-oauth/**', route => route.fulfill({ json: route.request().url().includes('/device/code') ? { device_code: 'test_device', user_code: 'TEST-CODE', verification_url: 'https://oauth.yandex.ru/device', interval: 1, expires_in: 600 } : (++pollCount, { access_token: 'test_access', expires_in: 3600 }) }));
  const item = (id: string) => ({ id, title: `Yandex song ${id}`, artists: [{ id: 1, name: 'Artist' }], durationMs: 180000 });
  await page.route('**/public/yandex/**', route => {
    const path = new URL(route.request().url()).pathname;
    const result = path.endsWith('/account/status') ? { account: { uid: 55, displayName: 'Test account' } }
      : path.endsWith('/playlists/list') ? [{ kind: 100, owner: { uid: 55 }, title: 'Road', trackCount: 2 }]
      : path.endsWith('/likes/tracks') ? { library: { tracks: [{ id: '1' }, { id: '2' }] } }
      : path.endsWith('/playlists/100') ? { title: 'Road', tracks: [{ id: '2' }, { id: '3' }] }
      : path.endsWith('/tracks') ? new URLSearchParams(route.request().postData()!).get('track-ids')!.split(',').map(item) : {};
    return route.fulfill({ json: { result } });
  });
  await actualApp(page); await goTab(page, 'Настройки');
  await page.getByRole('button', { name: 'Импорт музыки', exact: true }).click();
  await page.getByRole('button', { name: 'Яндекс', exact: true }).click();
  await page.getByText('Личный аккаунт · необязательно', { exact: true }).click();
  await page.getByRole('button', { name: 'Войти в Яндекс', exact: true }).click();
  await expect(page.getByLabel('Код входа Яндекс', { exact: true })).toHaveText('TEST-CODE');
  await expect(page.getByRole('checkbox', { name: /Мне нравится/ })).toBeChecked(); await expect(page.getByRole('checkbox', { name: /Road/ })).toBeChecked();
  await page.getByRole('button', { name: 'Импортировать', exact: true }).click();
  await expect(page.getByTestId('import-result')).toContainText('Импортировано 3 из 3');
  await page.getByTestId('import-result').getByRole('button', { name: /Road/ }).click();
  await expect(page.locator('main .track-row')).toHaveCount(2); expect(pollCount).toBe(1);
  await goTab(page, 'Библиотека'); await page.getByTestId('library-liked').click(); await expect(page.locator('main .track-row')).toHaveCount(2);
});

test('a signed-in Yandex track plays through the raw endpoint when legacy variants are empty', async ({ page }) => {
  let rawRequests = 0;
  await page.route('**/public/yandex-oauth/**', route => route.fulfill({ json: route.request().url().includes('/device/code') ? { device_code: 'test_device', user_code: 'TEST-CODE', verification_url: 'https://ya.ru/device', interval: 1, expires_in: 600 } : { access_token: 'test_access', expires_in: 3600 } }));
  await page.route('**/public/yandex/**', route => {
    const path = new URL(route.request().url()).pathname;
    const result = path.endsWith('/account/status') ? { account: { uid: 55, displayName: 'Test account' } }
      : path.endsWith('/playlists/list') || path.endsWith('/download-info') ? []
      : path.endsWith('/likes/tracks') ? { library: { tracks: [] } }
      : path.endsWith('/search') ? { tracks: { results: [{ id: 7, title: 'Full Yandex audio', artists: [{ id: 1, name: 'Artist' }], durationMs: 8000 }] } }
      : path.endsWith('/get-file-info') ? (++rawRequests, { downloadInfo: { codec: 'mp3', transport: 'raw', urls: ['https://strm.yandex.net/full-qa.mp3'] } }) : {};
    if (path.endsWith('/get-file-info')) expect(route.request().headers().authorization).toBe('OAuth test_access');
    return route.fulfill({ json: { result } });
  });
  await page.route('https://strm.yandex.net/full-qa.mp3', route => {
    expect(route.request().headers().authorization).toBeUndefined();
    return route.fulfill({ path: resolve('tests/fixtures/audio/one.mp3'), contentType: 'audio/mpeg', headers: { 'Access-Control-Allow-Origin': '*' } });
  });
  await actualApp(page); await page.getByRole('button', { name: 'Импорт музыки', exact: true }).click();
  await page.getByRole('button', { name: 'Яндекс', exact: true }).click();
  await page.getByText('Личный аккаунт · необязательно', { exact: true }).click();
  await page.getByRole('button', { name: 'Войти в Яндекс', exact: true }).click();
  await expect(page.getByText('Аккаунт: Test account', { exact: true })).toBeVisible();
  await goTab(page, 'Поиск'); await page.getByRole('button', { name: 'Музыкальный сервис', exact: true }).click();
  await page.getByRole('option', { name: 'Яндекс', exact: true }).click();
  await page.getByRole('textbox', { name: 'Поиск музыки' }).fill('Full Yandex audio');
  await page.getByRole('button', { name: 'Воспроизвести: Full Yandex audio, Artist', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __media: HTMLAudioElement[] }).__media.some(media => !media.paused && media.currentTime > .2))).toBe(true);
  expect(rawRequests).toBe(1);
});

test('Apple export allows several named playlists without mixing their membership', async ({ page }) => {
  await actualApp(page); await page.getByRole('button', { name: 'Импорт музыки', exact: true }).click();
  await page.getByRole('button', { name: 'Apple Music', exact: true }).click(); await page.getByRole('tab', { name: 'Из экспорта', exact: true }).click();
  await page.getByLabel('Выбрать файлы экспорта', { exact: true }).setInputFiles({ name: 'Apple.csv', mimeType: 'text/csv', buffer: Buffer.from('Title,Artist,Playlist Name,Duration\nOne,Artist,Road,3:00\nTwo,Artist,Night,4:00') });
  await expect(page.getByRole('checkbox')).toHaveCount(2);
  await page.getByRole('checkbox', { name: /Night/ }).uncheck(); await page.getByRole('button', { name: 'Импортировать', exact: true }).click();
  await expect(page.getByTestId('import-result')).toContainText('Импортировано 1 из 1');
  await page.getByTestId('import-result').getByRole('button', { name: 'Открыть результат', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Road', exact: true })).toBeVisible(); await expect(page.locator('main .track-row')).toHaveCount(1);
});
