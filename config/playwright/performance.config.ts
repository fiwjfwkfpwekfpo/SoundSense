import { defineConfig } from '@playwright/test';
import base, { projectRoot } from './ui.config';

/** Measure the production bundle used by the APK, without trace screenshots competing for frame time. */
export default defineConfig({
  ...base,
  testDir: '../../tests/performance', outputDir: '../../artifacts/tests/performance',
  projects: [{ name: 'stable' }],
  use: { ...base.use, baseURL: 'http://127.0.0.1:4173', trace: 'off', video: 'off' },
  webServer: { command: 'npm run build && npm run preview -- --port 4173', cwd: projectRoot, url: 'http://127.0.0.1:4173', reuseExistingServer: false, timeout: 120000 },
});
