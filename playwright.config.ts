import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  reporter: 'html',
  use: {
    baseURL: process.env.API_BASE_URL ?? 'https://localhost:5199',
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: {
      accept: 'text/plain'
    }
  }
});