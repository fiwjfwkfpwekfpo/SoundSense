#!/usr/bin/env node
/**
 * Desktop screenshots on the built-in demo library (no accounts, no personal data):
 *   node scripts/desktop-screenshots.mjs [outputFolder]
 * Starts the beta dev server, opens it in Chromium at 1440 × 900 and writes PNG files without metadata.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';

const out = process.argv[2] ?? 'docs/screens/desktop';
mkdirSync(out, { recursive: true });
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || ['/usr/bin/thorium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(path => existsSync(path));
const server = spawn('npm', ['run', 'dev:beta', '--', '--port', '5183'], { stdio: 'ignore', detached: true });
const base = 'http://127.0.0.1:5183';
for (let i = 0; i < 60; i++) { try { if ((await fetch(base)).ok) break; } catch {} await new Promise(r => setTimeout(r, 500)); }
const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] });
try {
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, reducedMotion: 'reduce' })).newPage();
  await page.addInitScript(() => localStorage.setItem('ss_settings_v1', JSON.stringify({ onboardingDone: true })));
  await page.goto(`${base}/?demo=1`);
  await page.getByRole('heading', { name: 'Главная', exact: true }).waitFor();
  await page.waitForTimeout(1500);
  const shot = async name => { await page.waitForTimeout(700); await page.screenshot({ path: `${out}/${name}.png`, animations: 'disabled' }); console.log(name); };
  const nav = async name => page.getByRole('navigation').getByRole('button', { name, exact: true }).click();
  await shot('home');
  await nav('Поиск'); await page.getByRole('textbox', { name: 'Поиск музыки' }).fill('lunar'); await shot('search');
  await nav('Библиотека'); await shot('library');
  await page.getByTestId('library-liked').click(); await shot('liked');
  await page.getByTestId('mini-player').getByRole('button', { name: 'Открыть плеер' }).click(); await shot('player');
  await page.getByRole('button', { name: 'Текст песни', exact: true }).click().catch(() => undefined); await shot('lyrics');
  await page.getByRole('button', { name: 'Свернуть плеер', exact: true }).click().catch(() => undefined);
  await nav('Настройки'); await shot('settings');
} finally { await browser.close(); try { process.kill(-server.pid); } catch {} }
