import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '../docs/screenshots');

const BASE = 'http://localhost:5173';
const VIEWPORT = { width: 390, height: 844 };

const TABS = [
  { name: 'track',    url: `${BASE}/`,        scrollTop: 0 },
  { name: 'weekly',   url: `${BASE}/weekly`,   scrollTop: 0 },
  { name: 'monthly',  url: `${BASE}/monthly`,  scrollTop: 0 },
  { name: 'settings', url: `${BASE}/settings`, scrollTop: 0 },
];

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  viewport: VIEWPORT,
  deviceScaleFactor: 2,
});

// Inject dark theme into localStorage before any page loads
await ctx.addInitScript(() => {
  localStorage.setItem('time-keeper-theme', 'dark');
});

const page = await ctx.newPage();

// Warm up — let React Query hydrate
await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });

for (const tab of TABS) {
  await page.goto(tab.url, { waitUntil: 'networkidle' });
  // Give charts time to paint
  await page.waitForTimeout(800);
  const dest = path.join(OUT, `${tab.name}.png`);
  await page.screenshot({ path: dest, fullPage: false });
  console.log(`✓ ${tab.name}.png`);
}

await browser.close();
console.log('Done.');
