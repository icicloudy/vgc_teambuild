/**
 * Verifies the single-file build survives the environment a sandboxed embed
 * imposes: no external requests at all, and localStorage that throws on access.
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://localhost:5190/';
const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  args: ['--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

const external = [];
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

// Deny everything that is not the page itself, the way a strict CSP would.
await page.route('**/*', (route) => {
  const url = route.request().url();
  if (url.startsWith(BASE) || url.startsWith('data:') || url.startsWith('blob:')) {
    return route.continue();
  }
  external.push(url);
  return route.abort();
});

// localStorage that throws on read, not just on write.
await page.addInitScript(() => {
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    get() { throw new Error('localStorage is blocked in this context'); },
  });
});

await page.goto(BASE, { waitUntil: 'load' });
await page.waitForSelector('.slot-add', { timeout: 20000 });

const checks = [];
const check = (n, ok) => checks.push([n, ok]);

check('app boots with localStorage blocked', true);
check('no external requests attempted', external.length === 0);

// Build a set and confirm the engine actually computes.
await page.click('.slot-add');
await page.click('.field:has-text("Pokémon") .combo-value');
await page.fill('.combo-pop .combo-input', 'Incineroar');
await page.waitForTimeout(200);
await page.keyboard.press('Enter');
await page.waitForTimeout(400);
await page.click('.move-slot >> nth=0 >> .combo-value');
await page.fill('.combo-pop .combo-input', 'Flare Blitz');
await page.waitForTimeout(200);
await page.keyboard.press('Enter');
await page.waitForTimeout(800);

check('learnset data available offline', (await page.locator('.move-slot').count()) === 4);
check('damage calcs render', (await page.locator('.matchup-row').count()) > 0);

await page.click('.tab:has-text("Threat matrix")');
await page.waitForTimeout(1200);
check('threat matrix computes', (await page.locator('.mx-cell').count()) > 0);

await page.click('.tab:has-text("Coach")');
await page.waitForTimeout(1200);
check('coach runs', (await page.locator('.advice, .issue').count()) > 0);

// The drafter is the heaviest thing in the app: thousands of damage calculations
// with no network and no storage. It has to survive the sandbox too.
await page.click('.tab:has-text("Draft")');
await page.waitForSelector('.draft-controls');
await page.getByRole('button', { name: 'Draft the rest' }).click();
await page.waitForSelector('.draft-card', { timeout: 180000 });
check('drafter runs in the sandbox', (await page.locator('.draft-card').count()) >= 5);
check('drafted sets are complete', await page.evaluate(() =>
  [...document.querySelectorAll('.draft-card')].every((c) => c.querySelectorAll('.draft-move').length === 4)));
await page.click('.tab:has-text("Coach")');
await page.waitForTimeout(400);

// Sprites must render as the type-coloured fallback, never a broken image.
const sprites = await page.evaluate(() => ({
  imgs: document.querySelectorAll('img.sprite').length,
  fallbacks: document.querySelectorAll('.sprite-fallback').length,
}));
check('no remote <img> sprites emitted', sprites.imgs === 0);
check('type-coloured fallbacks render', sprites.fallbacks > 0);

await page.screenshot({ path: `${process.env.SHOT_DIR || 'screenshots'}/artifact-sandboxed.png` });

let failed = 0;
for (const [n, ok] of checks) {
  console.log(`${ok ? '  ✓' : '  ✗'} ${n}`);
  if (!ok) failed++;
}
if (external.length) console.log('  external attempts:', [...new Set(external)].slice(0, 5));
if (errors.length) {
  console.log('  page errors:');
  for (const e of [...new Set(errors)].slice(0, 5)) console.log('    ! ' + e);
}
await browser.close();
console.log(failed || errors.length ? `\n${failed} failed, ${errors.length} error(s)` : '\nArtifact build OK.');
process.exit(failed || errors.length ? 1 : 0);
