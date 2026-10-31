import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
    launchOptions: process.env.CHROME_BIN
      ? { executablePath: process.env.CHROME_BIN, args: ['--no-sandbox'] }
      : {},
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: !process.env.CI,
    env: {
      VITE_SUPABASE_URL: 'https://wanrzgumoamryuybmopa.supabase.co',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_pZMuAvmUkmdmV9SFhHWj1A_vjL5c_wN',
    },
  },
});
