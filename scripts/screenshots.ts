// Скриншоты для README на демо-данных (scripts/demo-data.ts), через установленный Google Chrome.
//   1) поднять сервер с пустой базой: DB_PATH=.scratch/demo.sqlite PORT=5070 HTTPS_PORT=0 AUTO_SYNC=off npm start
//   2) node scripts/demo-data.ts | curl -s -X POST localhost:5070/api/import -H 'Content-Type: application/json' --data @-
//   3) DEMO_URL=http://localhost:5070 node scripts/screenshots.ts   → docs/screenshots/*.png
// Вход и Enable Banking подменяются (облачная установка «как настроенная»), время зафиксировано.
import { mkdirSync } from 'node:fs';
import { type BrowserContext, chromium, type Page } from 'playwright-core';

const BASE = process.env.DEMO_URL || 'http://localhost:5070';
const OUT = new URL('../docs/screenshots/', import.meta.url).pathname;
const NOW = new Date('2026-10-05T17:40:00Z');
const MONTH = '/?period=2026-09';
mkdirSync(OUT, { recursive: true });

const SETUP = {
  auth: true,
  authConfigured: true,
  login: 'demo',
  eb: true,
  redirectUrl: 'https://cashflow-demo.vercel.app/enablebanking/auth_callback',
  mcpUrl: 'https://cashflow-demo.vercel.app/mcp',
  baseUrl: 'https://cashflow-demo.vercel.app',
  githubCallbackUrl: 'https://cashflow-demo.vercel.app/api/auth/callback/github',
};
const EB = {
  configured: true,
  source: 'ui',
  redirectUrl: SETUP.redirectUrl,
  app: { name: 'Cash Flow', environment: 'PRODUCTION', active: true },
  redirectRegistered: true,
};

async function context(opts: { width: number; height: number; scale: number; mobile?: boolean }) {
  const ctx = await browser.newContext({
    viewport: { width: opts.width, height: opts.height },
    deviceScaleFactor: opts.scale,
    isMobile: opts.mobile,
    hasTouch: opts.mobile,
    colorScheme: 'dark',
    locale: 'ru-RU',
    timezoneId: 'Europe/Warsaw',
  });
  await ctx.route('**/api/setup', (r) => r.fulfill({ json: SETUP }));
  await ctx.route('**/api/eb', (r) => r.fulfill({ json: EB }));
  await ctx.route('**/api/auth/oauth2/public-client**', (r) =>
    r.fulfill({ json: { client_id: 'demo', client_name: 'Claude', client_uri: 'https://claude.ai' } }),
  );
  return ctx;
}

async function open(ctx: BrowserContext, path: string) {
  const page = await ctx.newPage();
  await page.clock.setFixedTime(NOW);
  await page.goto(BASE + path, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1800); // анимации recharts
  return page;
}

const shot = (page: Page, name: string) => page.screenshot({ path: `${OUT}${name}.png` }).then(() => console.log('✓', name));

const browser = await chromium.launch({ channel: 'chrome' });
try {
  const desktop = await context({ width: 1440, height: 900, scale: 2 });

  // Cash Flow за сентябрь
  let page = await open(desktop, MONTH);
  await shot(page, 'dashboard');

  // траты по дням с подсказкой «на что»
  await page.getByRole('radio', { name: 'Траты/день' }).click();
  await page.waitForTimeout(1200);
  const bars = page.locator('.recharts-bar-rectangle');
  await bars.nth(Math.floor((await bars.count()) * 0.62)).hover();
  await page.waitForTimeout(400);
  await shot(page, 'spending');

  // карточка операции
  await page.goto(BASE + MONTH, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.getByText('Wolt', { exact: true }).first().click();
  await page.waitForTimeout(500);
  await shot(page, 'transaction');

  for (const [path, name] of [
    ['/capital', 'capital'],
    ['/banks', 'banks'],
    ['/settings', 'settings'],
  ] as const) {
    page = await open(desktop, path);
    await shot(page, name);
  }

  // экран согласия коннектора — небольшое окно, без пустого поля вокруг
  const small = await context({ width: 760, height: 500, scale: 2 });
  page = await open(small, '/consent?client_id=demo&scope=openid');
  await shot(page, 'consent');

  // телефон: Cash Flow, капитал, операция шторкой снизу
  const phone = await context({ width: 390, height: 844, scale: 3, mobile: true });
  page = await open(phone, MONTH);
  await shot(page, 'mobile');
  page = await open(phone, '/capital');
  await shot(page, 'mobile-capital');
  page = await open(phone, MONTH);
  await page.getByText('Wolt', { exact: true }).first().click();
  await page.waitForTimeout(600);
  await shot(page, 'mobile-sheet');
} finally {
  await browser.close();
}
