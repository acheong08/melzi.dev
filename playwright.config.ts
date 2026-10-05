import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir:'./tests', fullyParallel:true, workers:2, timeout:30000,
  use:{baseURL:'http://localhost:4174',headless:true,channel:'chromium'}, reporter:'list',
  webServer:{command:'npm run dev -- --host 0.0.0.0 --port 4174 --strictPort',url:'http://localhost:4174',reuseExistingServer:true}
});
