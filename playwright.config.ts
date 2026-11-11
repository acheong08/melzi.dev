import { defineConfig } from '@playwright/test';
const chromium = process.env.PLAYWRIGHT_CHROMIUM;
export default defineConfig({
  testDir:'./tests', fullyParallel:true, workers:2, timeout:30000,
  use:{
    baseURL:'http://localhost:4174',headless:true,
    ...(chromium?{launchOptions:{executablePath:chromium}}:{channel:'chromium'})
  }, reporter:'list',
  webServer:{command:'npm run dev -- --host 0.0.0.0 --port 4174 --strictPort',url:'http://localhost:4174',reuseExistingServer:true}
});
