import { test, expect, type Page, type Route } from '@playwright/test';
import { actualApp, importFiles, goTab, chooseAppearance } from '../ui/helpers';

test.use({ trace: 'off', deviceScaleFactor: 3 });

async function largeLibrary(page: Page) {
  await actualApp(page);
  await importFiles(page, ['one.mp3', 'two.flac']);
  await page.getByRole('button', { name: 'Добавить треки · 2', exact: true }).click();
  await page.getByTestId('import-result').getByRole('button', { name: 'Открыть результат', exact: true }).click();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('ss_library_v2') ?? '{}').tracks?.length === 2);
  const snapshot = await page.evaluate(() => JSON.parse(localStorage.getItem('ss_library_v2')!));
  const originals = snapshot.tracks;
  // Real decoded fixtures remain in IndexedDB; only library/queue metadata is
  // multiplied. This does not simulate thousands of independent audio files.
  snapshot.tracks = Array.from({ length: 2087 }, (_, index) => ({ ...originals[index % 2], id: `stress-${index}`, title: `Performance ${index}`, liked: true, addedAt: 2087 - index }));
  await page.addInitScript(({ snapshot }) => {
    localStorage.setItem('ss_library_v2', JSON.stringify(snapshot));
    localStorage.setItem('ss_player_v2', JSON.stringify({ queue: snapshot.tracks.map((track: { id: string }, index: number) => ({ id: `queue-${index + 1}`, trackId: track.id })), trackId: snapshot.tracks[0].id, currentIndex: 0, position: 0, playing: false, shuffle: false, repeat: 'off' }));
  }, { snapshot });
  await page.reload();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  return cdp;
}

async function startFrames(page: Page) {
  await page.evaluate(() => {
    const recording = { intervals: [] as number[], running: true };
    (window as any).__stressFrames = recording;
    let previous = performance.now();
    const frame = (now: number) => { if (!recording.running) return; recording.intervals.push(now - previous); previous = now; requestAnimationFrame(frame); };
    requestAnimationFrame(frame);
  });
}
async function endFrames(page: Page) {
  return page.evaluate(() => {
    const recording = (window as any).__stressFrames;
    recording.running = false;
    const values = (recording.intervals as number[]).sort((a, b) => a - b);
    return { frames: values.length, p95: values[Math.floor(values.length * .95)] ?? 0, max: Math.max(0, ...values), over50ms: values.filter(value => value > 50).length };
  });
}

test('sustained library and queue scrolling stays virtualized with 2087 real records, DPR 3 and CPU 4x', async ({ page }, testInfo) => {
  test.setTimeout(60000);
  await largeLibrary(page);
  await goTab(page, 'Мне нравится');
  await expect(page.getByTestId('virtual-list')).toHaveAttribute('data-total', '2087');
  for (const selector of ['main', '.queue-scroll']) {
    if (selector === '.queue-scroll') {
      await page.getByTestId('mini-player').getByRole('button', { name: 'Воспроизвести', exact: true }).click();
      await page.getByTestId('mini-player').getByRole('button', { name: 'Открыть плеер', exact: true }).click();
      await page.getByTestId('player').getByRole('button', { name: /^Очередь/ }).click();
      await expect(page.locator('.queue-scroll')).toBeVisible();
    }
    await page.waitForTimeout(400);
    await startFrames(page);
    await page.locator(selector).evaluate(host => new Promise<void>(resolve => {
      const start = performance.now(), initial = host.scrollTop;
      const frame = (now: number) => {
        const progress = Math.min(1, (now - start) / 3100);
        host.scrollTop = initial + progress * 34000;
        if (progress < 1) requestAnimationFrame(frame); else resolve();
      };
      requestAnimationFrame(frame);
    }));
    const timing = await endFrames(page);
    console.log(`${selector} sustained scroll / DPR 3 / CPU 4x`, timing);
    await testInfo.attach(`${selector} sustained scroll frame timings`, { body: JSON.stringify(timing), contentType: 'application/json' });
    expect(timing.p95).toBeLessThan(85); expect(timing.max).toBeLessThan(220); expect(timing.frames).toBeGreaterThan(100);
    expect(await page.locator(`${selector} [data-track-id]`).count()).toBeLessThan(35);
    await page.locator(selector).evaluate(host => host.scrollTop = host.scrollHeight);
    await expect(page.locator(`${selector} [data-track-id="stress-2086"]`)).toBeAttached();
    expect(await page.locator(`${selector} [data-track-id]`).count()).toBeLessThan(35);
  }
});

test('rapid full-player and mini-player gestures cancel cleanly under CPU 4x without losing live drag', async ({ page }, testInfo) => {
  test.setTimeout(60000);
  const cdp = await largeLibrary(page);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.getByTestId('mini-player').getByRole('button', { name: 'Открыть плеер', exact: true }).click();
  await page.waitForTimeout(450);
  await startFrames(page);
  for (let index = 0; index < 6; index++) {
    const next = index % 2 === 0;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: next ? 270 : 115, y: 400 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: next ? 180 : 205, y: 400 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(70);
  }
  await page.waitForTimeout(450);
  await expect(page.getByTestId('player').getByRole('heading', { name: 'Performance 0', exact: true })).toBeVisible();
  const artwork = page.getByTestId('track-artwork');
  await expect(artwork.locator('.outgoing')).toHaveCount(0);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 220, y: 400 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 190, y: 400 }] });
  await expect(artwork.locator('.current')).toHaveAttribute('style', /translateX\(-30px\)/);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  await expect(artwork.locator('.current')).toHaveAttribute('style', /translateX\(0px\)/);
  await page.getByTestId('player').getByRole('button', { name: 'Свернуть плеер', exact: true }).click();
  const box = (await page.getByTestId('mini-player').boundingBox())!;
  for (let index = 0; index < 4; index++) {
    const start = box.x + (index % 2 === 0 ? 260 : 95), end = start + (index % 2 === 0 ? -100 : 100);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: start, y: box.y + 25 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: end, y: box.y + 25 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(70);
  }
  await expect(page.locator('.mini-outgoing')).toHaveCount(0);
  const timing = await endFrames(page);
  await expect(page.getByTestId('mini-player').locator('strong')).toHaveText('Performance 0');
  console.log('rapid full/mini gesture frames / DPR 3 / CPU 4x', timing);
  await testInfo.attach('rapid gesture frame timings', { body: JSON.stringify(timing), contentType: 'application/json' });
  expect(timing.p95).toBeLessThan(85); expect(timing.max).toBeLessThan(220); expect(errors).toEqual([]);
});

test('theme changes and long lyrics navigation stay responsive under CPU 4x', async ({ page }, testInfo) => {
  test.setTimeout(60000);
  await largeLibrary(page);
  await page.route('https://lrclib.net/api/get?**', route => route.fulfill({ json: { syncedLyrics: Array.from({ length: 160 }, (_, index) => `[0:${(index * .04).toFixed(2).padStart(5, '0')}]Performance lyrics line ${index}`).join('\n') } }));
  await startFrames(page);
  await goTab(page, 'Настройки');
  await chooseAppearance(page, 'Цвета', 'Аметист');
  await chooseAppearance(page, 'Цвета', 'Серебро');
  await chooseAppearance(page, 'Цвета', 'Обложка');
  await page.getByTestId('mini-player').getByRole('button', { name: 'Открыть плеер', exact: true }).click();
  await page.getByTestId('player').getByRole('button', { name: 'Текст песни', exact: true }).click();
  const line = page.getByRole('button', { name: 'Performance lyrics line 100', exact: true });
  await line.click(); await expect(line).toHaveAttribute('aria-current', 'true');
  await page.locator('.lyrics-scroll').evaluate(host => host.scrollTop = host.scrollHeight);
  await expect(page.getByRole('button', { name: 'Performance lyrics line 159', exact: true })).toBeVisible();
  const timing = await endFrames(page);
  console.log('theme and long lyrics frames / DPR 3 / CPU 4x', timing);
  await testInfo.attach('theme and lyrics frame timings', { body: JSON.stringify(timing), contentType: 'application/json' });
  expect(timing.p95).toBeLessThan(85); expect(timing.max).toBeLessThan(220);
});

test('a late next-cover decode preserves the original outgoing background until the crossfade ends', async ({ page }) => {
  test.setTimeout(45000);
  await largeLibrary(page);
  let accept: (route: Route) => void;
  const pending = new Promise<Route>(resolve => accept = resolve);
  await page.route('https://artwork.example/late.svg', route => accept(route));
  await page.addInitScript(() => {
    const library = JSON.parse(localStorage.getItem('ss_library_v2')!);
    library.tracks[1].artwork.url = 'https://artwork.example/late.svg';
    localStorage.setItem('ss_library_v2', JSON.stringify(library));
    localStorage.setItem('ss_settings_v1', JSON.stringify({ ...JSON.parse(localStorage.getItem('ss_settings_v1')!), appearanceColors: 'cover' }));
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByTestId('mini-player').getByRole('button', { name: 'Воспроизвести', exact: true }).click();
  await page.getByTestId('mini-player').getByRole('button', { name: 'Открыть плеер', exact: true }).click();
  const route = await pending;
  const slider = page.getByTestId('player').getByRole('slider');
  await slider.press('Home'); await slider.press('ArrowRight');
  await expect(page.getByTestId('player')).toHaveAttribute('data-crossfade', /0\./, { timeout: 15000 });
  const outgoing = page.locator('.background .outgoing .backdrop .cover');
  const marker = () => outgoing.evaluate(node => node.querySelector('img')?.getAttribute('src') ?? node.querySelector('linearGradient')?.id ?? null);
  const old = await marker(); expect(old).not.toBeNull();
  await expect(page.locator('html')).toHaveAttribute('data-artwork-sampled', 'false');
  await route.fulfill({ contentType: 'image/svg+xml', headers: { 'access-control-allow-origin': '*' }, body: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><path fill="red" d="M0 0h32v32H0z"/></svg>' });
  await expect(page.locator('html')).toHaveAttribute('data-artwork-sampled', 'true');
  expect(await marker()).toBe(old);
  await expect(outgoing).toHaveCount(0);
});
