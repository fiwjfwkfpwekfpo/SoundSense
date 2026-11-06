#!/usr/bin/env node
/**
 * Desktop screenshots on the built-in demo library (no accounts, no personal data):
 *   node scripts/desktop-screenshots.mjs [outputFolder]
 * Starts the beta dev server and opens it in Chromium at 1440 × 900 with a stand-in for the Electron bridge,
 * so the real desktop layout is shown (side navigation, player bar, two-column player with lyrics).
 * The colour pack is "Amethyst". Plugin catalog requests are answered from the local plugins/ folder.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const out = process.argv[2] ?? 'docs/screens/desktop';
mkdirSync(out, { recursive: true });
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || ['/usr/bin/thorium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(path => existsSync(path));
const PORT = 5183, base = `http://127.0.0.1:${PORT}`;
const server = spawn('npm', ['run', 'dev:beta', '--', '--port', String(PORT)], { stdio: 'ignore', detached: true });
for (let i = 0; i < 80; i++) { try { if ((await fetch(base)).ok) break; } catch {} await new Promise(r => setTimeout(r, 500)); }

/** Minimal stand-in for desktop/preload.cjs: in-memory state, no files, no waveform backend. */
function fakeBridge() {
  const state = {}, none = async () => ({ error: 'UNAVAILABLE' });
  globalThis.soundsenseDesktop = {
    platform: 'linux', hostname: 'desktop',
    state: { read: async () => ({ ...state }), write: async (k, v) => { state[k] = v; }, remove: async k => { delete state[k]; } },
    http: { request: async (id, o) => { try { const r = await fetch(o.url, { method: o.method, headers: o.headers, body: o.body }); return { status: r.status, text: await r.text() }; } catch { return { status: 503, text: '' }; } }, cancel: async () => {} },
    secrets: { read: async () => ({ value: null }), write: async () => ({}), remove: async () => {}, encrypted: async () => true },
    accounts: { open: async () => {} },
    files: { pickAudio: async () => ({ files: null }), readAudioMetadata: async () => ({}), saveJson: async () => ({ status: 'cancelled' }) },
    clipboard: { read: async () => '' },
    waves: { read: none, readStream: none, register: async () => {}, cancel: async () => {}, stats: async () => ({ bytes: 0, count: 0, limit: 33554432 }), clear: async () => {}, setLimit: async () => {}, onProgress: () => () => {} },
    onFlush: () => {},
  };
}

const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] });
const failed = [];
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.addInitScript(fakeBridge);
  await page.addInitScript(() => localStorage.setItem('ss_settings_v1', JSON.stringify({ onboardingDone: true, appearanceColors: 'amethyst', appearanceColorsBase: 'amethyst', appearanceAutoSuggest: false })));
  // Colour grading for the demo shots: the built-in covers are monochrome and follow the palette,
  // so a saturated palette plus a per-cover hue shift keeps the screenshots lively.
  await page.addInitScript(() => {
    const css = ':root{--palette-mainBg:#120a2a!important;--palette-barBg:#1b0f45e8!important;--palette-cardBg:#24155a!important;--palette-cardHover:#37208a!important;--palette-border:#4a30a8!important;--palette-borderLight:#6a48d0!important;--palette-accent:#c98bff!important;--palette-text:#fbf7ff!important;--palette-textMuted:#b3a4ea!important;--palette-accentMutedText:#d6b8ff!important}.cover{filter:saturate(1.7) hue-rotate(var(--cover-hue,0deg))}';
    const hues = [0, 70, 120, 190, 250, 310, 340];
    const paint = () => document.querySelectorAll('.cover[data-artwork-key]').forEach(node => { const seed = parseInt(node.getAttribute('data-artwork-key') ?? '0', 10) || 0; node.style.setProperty('--cover-hue', `${hues[Math.abs(seed) % hues.length]}deg`); });
    document.addEventListener('DOMContentLoaded', () => { const style = document.createElement('style'); style.textContent = css; document.head.append(style); setInterval(paint, 150); });
  });
  await page.route('https://raw.githubusercontent.com/**/plugins/**', route => {
    const path = new URL(route.request().url()).pathname.split('/plugins/')[1];
    try { route.fulfill({ body: readFileSync(new URL(`../plugins/${path}`, import.meta.url)), contentType: 'text/plain', headers: { 'Access-Control-Allow-Origin': '*' } }); } catch { route.fulfill({ status: 404, body: '' }); }
  });
  await page.goto(`${base}/?demo=1`);
  await page.getByRole('heading', { name: 'Главная', exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelector('[data-testid="app-shell"]')?.classList.contains('wide'));
  await page.waitForTimeout(1500);

  const shot = async name => { await page.waitForTimeout(900); await page.screenshot({ path: `${out}/${name}.png`, animations: 'disabled' }); console.log('shot', name); };
  const step = async (name, fn) => { try { await fn(); } catch (error) { failed.push(name); console.log('FAILED', name, String(error).split('\n')[0]); } };
  const nav = name => page.getByRole('navigation').getByRole('button', { name, exact: true }).click();

  await step('home', async () => { await shot('home'); });
  await step('search', async () => { await nav('Поиск'); await page.getByRole('textbox', { name: 'Поиск музыки' }).fill('lunar'); await shot('search'); });
  await step('library', async () => { await nav('Библиотека'); await shot('library'); });
  await step('liked', async () => { await page.getByTestId('library-liked').click(); await shot('liked'); });
  await step('play', async () => { await page.getByTestId('virtual-list').getByRole('button').first().click(); await page.getByTestId('player-bar').waitFor({ timeout: 10000 }); await page.waitForTimeout(2500); });
  await step('player', async () => { await page.getByTestId('player-bar').getByRole('button', { name: 'Открыть плеер' }).click(); await page.getByTestId('player').waitFor(); await shot('player'); });
  await step('sound', async () => { await page.getByRole('button', { name: 'Меню плеера' }).click(); await page.getByRole('dialog').getByRole('button', { name: 'Звук', exact: false }).click(); await shot('sound'); await page.getByRole('dialog').getByRole('button', { name: 'Закрыть', exact: true }).click(); });
  await step('queue', async () => { await page.getByRole('button', { name: 'Очередь', exact: false }).first().click(); await shot('queue'); await page.getByRole('button', { name: 'Назад', exact: true }).first().click(); });
  await step('collapse', async () => { await page.getByTestId('player').getByRole('button', { name: 'Свернуть плеер' }).click(); });
  await step('settings', async () => { await nav('Настройки'); await shot('settings'); });
  await step('appearance', async () => { await page.getByRole('button', { name: 'Цвета', exact: true }).click(); await shot('appearance'); await page.getByRole('dialog').getByRole('button', { name: 'Закрыть', exact: true }).click(); });
  // The demo library has no plugin host, so the plugin screen is shot in the normal app (empty library is fine there).
  await step('plugins', async () => {
    await page.goto(`${base}/`); await page.getByRole('heading', { name: 'Главная', exact: true }).waitFor(); await page.waitForTimeout(1200);
    await nav('Настройки'); await page.getByRole('tab', { name: 'Приложение' }).click();
    await page.getByRole('button', { name: /Плагины/ }).first().click({ timeout: 8000 });
    const catalog = page.getByTestId('plugin-catalog'); await catalog.getByRole('article').first().waitFor({ timeout: 10000 });
    for (const name of ['Таймер сна', 'Now Playing в Discord']) { await catalog.locator('article', { hasText: name }).getByRole('button', { name: 'Скачать' }).click(); await page.waitForTimeout(700); }
    await page.evaluate(() => window.scrollTo(0, 0)); await shot('plugins');
  });
} finally { await browser.close(); try { process.kill(-server.pid); } catch {} }
if (failed.length) { console.log('Failed steps:', failed.join(', ')); process.exitCode = 2; }
