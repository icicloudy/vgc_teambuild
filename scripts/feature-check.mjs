import { chromium } from 'playwright';
const OUT = process.env.SHOT_DIR || 'screenshots';
const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  args: ['--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1500, height: 1100 }, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error' && !/ERR_TUNNEL|Failed to load resource/.test(m.text())) errors.push(m.text());
});
await page.goto(process.env.BASE_URL || 'http://localhost:5180', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.slot-add');

const checks = [];
const check = (n, ok) => checks.push([n, ok]);

await page.evaluate(() => {
  const team = {
    id: 'f1', name: 'Filters', formatId: 'champs-mb-doubles', notes: '', updatedAt: Date.now(),
    members: [{
      id: 'f-1', species: 'Incineroar', nickname: '', item: 'Safety Goggles',
      ability: 'Intimidate', level: 50, nature: 'Careful',
      sp: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
      moves: ['Fake Out', 'Knock Off', 'Parting Shot', 'Flare Blitz'],
    }],
  };
  localStorage.setItem('champions-teambuilder', JSON.stringify({
    state: { teams: [team], activeTeamId: 'f1', formatId: 'champs-mb-doubles' }, version: 2,
  }));
});
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('.survival-svg', { timeout: 15000 });

/* ---- 1. axes swapped ---- */
const axes = await page.evaluate(() => {
  const texts = [...document.querySelectorAll('.survival-axis')].map((t) => ({
    text: t.textContent, rotated: (t.getAttribute('transform') || '').includes('rotate'),
  }));
  return texts;
});
check('X axis is the defence stat', axes.some((a) => !a.rotated && /Def|SpD/.test(a.text)));
check('Y axis is HP', axes.some((a) => a.rotated && /HP/.test(a.text)));

/* ---- 2. no spurious over-budget ---- */
const budget = await page.evaluate(() => ({
  dim: [...document.querySelectorAll('.survival-svg rect')]
    .filter((r) => r.getAttribute('opacity') === '0.18').length,
  legendKeys: [...document.querySelectorAll('.survival-key')].map((k) => k.textContent.trim()),
}));
check('nothing dimmed when all 66 points are free', budget.dim === 0);
check('no over-budget legend key when nothing is over budget',
  !budget.legendKeys.some((k) => /points spent elsewhere/.test(k)));

/* ---- 3. species filters ---- */
const openPicker = async () => {
  await page.click('.field:has-text("Pokémon") .combo-value');
  await page.waitForSelector('.combo-pop .combo-input');
};
const filterCount = async (query) => {
  await page.fill('.combo-pop .combo-input', query);
  await page.waitForTimeout(400);
  return page.evaluate(() => ({
    n: document.querySelectorAll('.combo-pop .combo-opt').length,
    first: [...document.querySelectorAll('.combo-pop .combo-opt-label')].slice(0, 6).map((e) => e.textContent),
    chips: [...document.querySelectorAll('.filter-chip')].map((c) => c.textContent.trim()),
  }));
};
await openPicker();
const intimidate = await filterCount('intimidate');
check('ability filter works', intimidate.n > 5 && intimidate.n < 200 &&
  intimidate.chips.some((c) => /Intimidate/.test(c)));
const fakeOut = await filterCount('fake out');
check('multi-word move filter works', fakeOut.n > 5 && fakeOut.chips.some((c) => /Fake Out/.test(c)));
const stacked = await filterCount('fake out intimidate');
check('stacked filters intersect',
  stacked.n > 0 && stacked.n < Math.min(intimidate.n, fakeOut.n) + 1 && stacked.chips.length === 2);
await page.screenshot({ path: `${OUT}/filters.png`, clip: await page.locator('.combo-pop').boundingBox() });
const byType = await filterCount('steel');
check('type filter works', byType.n > 5);
await page.keyboard.press('Escape');

/* ---- 4. relevance ordering ---- */
await openPicker();
// Reopening must show the unfiltered list; the query does not survive a close.
const unfiltered = await page.evaluate(() =>
  [...document.querySelectorAll('.combo-pop .combo-opt')].slice(0, 40).map((o) => ({
    name: o.querySelector('.combo-opt-label')?.textContent,
    nfe: !!o.querySelector('.nfe-tag'),
  })));
check('no unevolved Pokémon in the first 40 results', !unfiltered.some((o) => o.nfe));
await page.keyboard.press('Escape');

/* ---- 5. any Pokémon in the calculator ---- */
await page.click('.tab:has-text("Calculator")');
await page.waitForSelector('.calc-grid');
await page.selectOption('.calc-grid .panel select.full >> nth=1', 'custom:custom');
await page.waitForTimeout(700);
check('custom set editor appears', (await page.locator('.custom-set').count()) === 1);
await page.click('.custom-set .field:has-text("Pokémon") .combo-value');
await page.fill('.combo-pop .combo-input', 'Ferrothorn');
await page.waitForTimeout(400);
await page.locator('.combo-pop .combo-opt', { hasText: 'Ferrothorn' }).first().click();
await page.waitForTimeout(800);
const custom = await page.evaluate(() => document.body.innerText);
check('arbitrary Pokémon becomes the defender', /Ferrothorn/.test(custom));
check('calc still produces damage rows', (await page.locator('.result-table tbody tr').count()) > 0);
await page.screenshot({ path: `${OUT}/custom-calc.png` });

let failed = 0;
for (const [n, ok] of checks) { console.log(`${ok ? '  ✓' : '  ✗'} ${n}`); if (!ok) failed++; }
if (errors.length) { console.log('  errors:'); for (const e of [...new Set(errors)].slice(0, 5)) console.log('    ! ' + e); }
await browser.close();
console.log(failed || errors.length ? `\n${failed} failed, ${errors.length} error(s)` : '\nAll feature checks passed.');
process.exit(failed || errors.length ? 1 : 0);
