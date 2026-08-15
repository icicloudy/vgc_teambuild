/**
 * Drives Ninety in a real browser: the solve has to render, the payoff grid has
 * to be a grid, and the drill has to run its clock and grade an answer.
 * Run with: npm run smoke:ninety
 */
import { chromium } from 'playwright';

const OUT = process.env.SHOT_DIR || 'screenshots';
const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  args: ['--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1240, height: 1400 }, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error' && !/ERR_TUNNEL|Failed to load resource/.test(m.text())) errors.push(m.text());
});

const checks = [];
const check = (n, ok) => checks.push([n, ok]);

await page.goto(process.env.BASE_URL || 'http://localhost:5274', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.crux', { timeout: 30000 });

/* ---- the solve renders an answer ---- */
const crux = (await page.locator('.crux').innerText()).trim();
check('the crux is a real sentence', crux.length > 40 && /[.!]$/.test(crux));

const brought = await page.locator('.mon.picked').count();
check('four Pokémon are recommended', brought >= 4);
// The leads are marked twice on purpose — once on your six, once on the four it
// recommends — so this counts them where they mean "lead", on your own team.
check('two of them are marked as leads',
  (await page.locator('.panel').first().locator('.mon.lead').count()) === 2);

const reasons = await page.locator('.reasons .reason').count();
check('every pick and every bench slot is explained', reasons >= 6);

const figures = await page.locator('.reason-fig').allInnerTexts();
check('every reason carries the number it came from', figures.length >= 6 && figures.every((f) => /[0-9]/.test(f)));

const body = await page.locator('body').innerText();
check('no NaN reaches the page', !/NaN/.test(body));
check('no undefined reaches the page', !/undefined/.test(body));

/* ---- damage claims are real percentages, not placeholders ---- */
const dmg = body.match(/\d+–\d+%/g) ?? [];
check('reasons quote real damage ranges', dmg.length >= 2);
check('the ranges are the right way round', dmg.every((d) => {
  const [lo, hi] = d.replace('%', '').split('–').map(Number);
  return lo <= hi;
}));

/* ---- the payoff grid is the full game ---- */
const grid = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('.grid tbody tr')];
  return {
    rows: rows.length,
    cols: rows[0] ? rows[0].querySelectorAll('td.cell').length : 0,
    shades: new Set(rows.flatMap((r) =>
      [...r.querySelectorAll('td.cell')].map((c) => getComputedStyle(c).backgroundColor))).size,
    mixBars: document.querySelectorAll('.mixbar').length,
  };
});
check('the grid is fifteen fours by fifteen fours', grid.rows === 15 && grid.cols === 15);
check('the heatmap actually varies', grid.shades >= 4);
check('the equilibrium mix is drawn', grid.mixBars === 15);
check('a legend is present', await page.locator('.legend').isVisible());
check('a table view exists for the colour-blind case',
  (await page.locator('details.table-view').count()) > 0);

/* ---- the risk panel prices what cannot be seen ---- */
const risks = await page.locator('.risk').count();
check('the app names what it cannot see, or says there is nothing',
  risks > 0 || /Nothing they could be running/.test(body));

await page.screenshot({ path: `${OUT}/ninety-solve.png`, fullPage: false });

/* ---- changing the opponent changes the answer ---- */
const namesOf = () => page.locator('.six.compact .mon-name').allInnerTexts();
const equityOf = () => page.locator('.figure b').first().innerText();
const before = (await namesOf()).join() + (await equityOf());
await page.locator('.six .mon').first().click();
await page.waitForSelector('.picker');
await page.getByRole('button', { name: 'Gholdengo', exact: true }).first().click();
await page.waitForTimeout(500);
const after = (await namesOf()).join() + (await equityOf());
check('swapping one of their six re-solves the matchup', after !== before);

/* ---- the drill ---- */
await page.getByRole('button', { name: 'Drill', exact: true }).click();
await page.waitForSelector('.clock');
const clock = await page.locator('.clock').innerText();
check('the drill starts a ninety-second clock', /0:(9|8)\d/.test(clock));
check('locking in is refused before four are picked',
  await page.getByRole('button', { name: 'Lock it in' }).isDisabled());

const mine = page.locator('.six').nth(1).locator('.mon');
for (let i = 0; i < 4; i++) await mine.nth(i).click();
check('picking four numbers them in order',
  (await page.locator('.mon-order').count()) === 4);
check('the first two are marked as the leads',
  (await page.locator('.six').nth(1).locator('.mon.lead').count()) === 2);

await page.getByRole('button', { name: 'Lock it in' }).click();
await page.waitForSelector('.score-hero');
const score = Number((await page.locator('.score-hero b').innerText()).trim());
check('the answer is graded out of a hundred', Number.isFinite(score) && score >= 0 && score <= 100);
check('and the grade comes with the solver\'s own answer',
  (await page.locator('.crux').count()) > 0);
check('the clock stops once you have answered',
  (await page.locator('.clock').innerText()).includes('—'));

await page.screenshot({ path: `${OUT}/ninety-drill.png`, fullPage: false });

await page.getByRole('button', { name: 'Next matchup' }).click();
await page.waitForTimeout(500);
check('the next matchup deals a fresh clock',
  /0:(9|8)\d/.test(await page.locator('.clock').innerText()));

/* ---- it works on a phone, because preview happens on a phone ---- */
await page.setViewportSize({ width: 390, height: 844 });
await page.getByRole('button', { name: 'Solve', exact: true }).click();
await page.waitForSelector('.crux');
const overflow = await page.evaluate(() =>
  document.documentElement.scrollWidth - document.documentElement.clientWidth);
check('nothing overflows the viewport on a phone', overflow <= 1);
await page.screenshot({ path: `${OUT}/ninety-mobile.png`, fullPage: false });

/* ---- report ---- */
console.log('\nNinety checks');
let failed = 0;
for (const [name, ok] of checks) {
  console.log(`  ${ok ? '✓' : '✗'} ${name}`);
  if (!ok) failed++;
}
if (errors.length) {
  failed++;
  console.log('\nPage errors:');
  for (const e of errors.slice(0, 8)) console.log('  ! ' + e);
}
console.log(failed ? `\n${failed} FAILURE(S)\n` : `\nAll ${checks.length} checks passed.\n`);
await browser.close();
process.exit(failed ? 1 : 0);
