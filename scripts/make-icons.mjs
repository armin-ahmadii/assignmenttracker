// Renders the app icons from the brand mark (a pill with a lowercase "d").
// Usage: npm run icons   (needs Playwright's Chromium)
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const font = readFileSync(fileURLToPath(new URL('../node_modules/@fontsource/inter/files/inter-latin-600-normal.woff2', import.meta.url))).toString('base64');

function html(size, { maskable = false } = {}) {
  // Maskable icons keep the mark inside the central 80% safe zone.
  const scale = maskable ? 0.62 : 0.78;
  const pillW = size * scale;
  const pillH = pillW * 0.52;
  return `<!doctype html><html><head><style>
    @font-face { font-family: Inter; src: url(data:font/woff2;base64,${font}) format('woff2'); font-weight: 600; }
    html, body { margin: 0; width: ${size}px; height: ${size}px; background: #171717; }
    body { display: grid; place-items: center; }
    .pill { width: ${pillW}px; height: ${pillH}px; border-radius: ${pillH}px; background: #fff; color: #171717;
      display: grid; place-items: center; font: 600 ${pillH * 0.78}px/1 Inter; letter-spacing: -0.02em; padding-bottom: ${pillH * 0.06}px; box-sizing: border-box; }
  </style></head><body><div class="pill">d</div></body></html>`;
}

const out = (name) => fileURLToPath(new URL(`../public/${name}`, import.meta.url));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
const page = await browser.newPage();
for (const [name, size, opts] of [
  ['icon-192.png', 192, {}],
  ['icon-512.png', 512, {}],
  ['icon-maskable-512.png', 512, { maskable: true }],
  ['apple-touch-icon.png', 180, {}],
]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(html(size, opts));
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: out(name) });
  console.log('wrote', name);
}
await browser.close();
