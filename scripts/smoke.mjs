import { chromium } from 'playwright';

const OUT = process.env.SHOT_DIR || 'screenshots';
const BASE = process.env.BASE_URL || 'http://localhost:5180';
const errors = [];

// CHROMIUM_PATH lets CI point at a preinstalled browser; otherwise Playwright resolves its own.
const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  args: ['--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.on('console', (m) => {
  // Sprites come from an external host; failures there are expected offline and
  // the UI falls back to a monogram, so they are not smoke-test failures.
  if (m.type() === 'error' && !/ERR_TUNNEL_CONNECTION_FAILED|Failed to load resource/.test(m.text())) {
    errors.push(m.text());
  }
});
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForSelector('.slot-add', { timeout: 10000 });

async function pick(triggerSel, text) {
  await page.click(triggerSel);
  await page.waitForSelector('.combo-pop .combo-input');
  await page.fill('.combo-pop .combo-input', text);
  await page.waitForTimeout(150);
  await page.locator('.combo-pop .combo-opt', { hasText: text }).first().click();
  await page.waitForSelector('.combo-pop', { state: 'detached' });
}

// Build a real team through the UI.
const picks = ['Incineroar', 'Rillaboom', 'Charizard', 'Garchomp', 'Amoonguss', 'Kingambit'];
for (const name of picks) {
  await page.click('.slot-add');
  await pick('.field:has-text("Pok\u00e9mon") .combo-value', name);
  await page.waitForTimeout(80);
}

// Give the first slot a full set.
await page.click('.rail-list .slot >> nth=0');
await page.waitForTimeout(200);
await pick('.field:has-text("Item") .combo-value', 'Safety Goggles');

const moves = ['Fake Out', 'Knock Off', 'Parting Shot', 'Flare Blitz'];
for (let i = 0; i < moves.length; i++) {
  await pick(`.move-slot >> nth=${i} >> .combo-value`, moves[i]);
}
await page.selectOption('.field:has-text("Ability") select', 'Intimidate').catch(() => {});
await page.waitForTimeout(500);

const checks = [];
const shot = async (name) => {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
};

checks.push(['build tab renders sets', (await page.locator('.move-slot').count()) === 4]);
checks.push(['matchup preview computed', (await page.locator('.matchup-row').count()) > 0]);
await shot('01-build');

// Mega chips
const zardTab = await page.locator('.rail-list .slot', { hasText: 'Charizard' }).first();
await zardTab.click();
await page.waitForTimeout(300);
const megaChips = await page.locator('.mega-chip').count();
checks.push(['mega chips shown for Charizard', megaChips >= 3]);
await page.locator('.mega-chip', { hasText: 'Mega Charizard Y' }).first().click();
await page.waitForTimeout(400);
checks.push(['mega applied', (await page.locator('.pill-mega').count()) > 0]);
await shot('02-mega');

for (const [tab, file, sel] of [
  ['Threat matrix', '03-threats', '.matrix'],
  ['Speed', '04-speed', '.speed-ladder'],
  ['Analysis', '05-analysis', '.typegrid'],
  ['Coach', '06-coach', '.advice-list'],
  ['Calculator', '07-calc', '.result-table'],
  ['Metagame', '08-metagame', '.threat-card'],
  ['Roster', '09-roster', '.species-grid'],
]) {
  await page.click(`.tab:has-text("${tab}")`);
  await page.waitForTimeout(700);
  const ok = (await page.locator(sel).count()) > 0;
  checks.push([`${tab} tab renders`, ok]);
  await shot(file);
}

// Import/export round trip through the UI.
await page.click('.tab:has-text("Build")');
await page.click('button:has-text("Import / Export")');
await page.waitForSelector('.modal');
const exported = await page.locator('.modal textarea[readonly]').inputValue();
checks.push(['export produced a paste', exported.includes('Incineroar') && exported.includes('Charizardite Y')]);
await shot('10-io');
await page.click('.modal-head .btn');

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}`);
  if (!ok) failed++;
}
if (errors.length) {
  console.log('\nConsole errors:');
  for (const e of [...new Set(errors)].slice(0, 10)) console.log('  ! ' + e);
}
await browser.close();
console.log(failed || errors.length ? `\n${failed} failed, ${errors.length} console error(s)` : '\nSmoke test passed.');
process.exit(failed || errors.length ? 1 : 0);
