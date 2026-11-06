import { defineConfig } from '@playwright/test';
import base from './ui.config';
import perf from './performance.config';
// SS_PROFILE_PROD=1 profiles an unminified production bundle (realistic timings, readable names).
const prod = { ...perf, webServer: { ...perf.webServer, command: 'npm run build:beta -- --minify false && npm run preview:beta -- --port 4173' } };
export default defineConfig({ ...(process.env.SS_PROFILE_PROD ? prod : base), projects: [{ name: 'beta-profile' }], testDir: '../../tests/performance', testMatch: 'profile-actions.spec.ts' });
