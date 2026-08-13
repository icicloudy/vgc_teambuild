import { chromium } from 'playwright';
const OUT = process.env.SHOT_DIR || 'screenshots';
const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  args: ['--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1500, height: 1100 }, deviceScaleFactor: 2 });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message.slice(0, 200)));
await page.goto(process.env.BASE_URL || 'http://localhost:5180', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.slot-add');

// A defender with a real threshold structure: Incineroar taking Garchomp Earthquake.
await page.evaluate(() => {
  const team = {
    id: 'c1', name: 'Chart', formatId: 'champs-mb-doubles', notes: '', updatedAt: Date.now(),
    members: [{
      id: 'c-1', species: 'Incineroar', nickname: '', item: 'Safety Goggles',
      ability: 'Intimidate', level: 50, nature: 'Careful',
      sp: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
      moves: ['Fake Out', 'Knock Off', 'Parting Shot', 'Flare Blitz'],
    }],
  };
  localStorage.setItem('champions-teambuilder', JSON.stringify({
    state: { teams: [team], activeTeamId: 'c1', formatId: 'champs-mb-doubles' }, version: 2,
  }));
});
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('.survival-svg', { timeout: 15000 });

// Point the optimizer at Garchomp Earthquake.
await page.selectOption('.opt-controls .inline-field:has-text("Attacker") select', { label: 'Garchomp (Life Orb)' });
await page.waitForTimeout(600);
await page.selectOption('.opt-controls .inline-field:has-text("Move") select', 'Earthquake').catch(() => {});
await page.waitForTimeout(900);

const info = await page.evaluate(() => {
  const rects = [...document.querySelectorAll('.survival-svg rect')];
  const fills = {};
  for (const r of rects) {
    const f = r.getAttribute('fill');
    if (f && f !== 'none') fills[f] = (fills[f] || 0) + 1;
  }
  const dim = rects.filter((r) => r.getAttribute('opacity') === '0.18').length;
  return { total: rects.length, fills, dim, lines: document.querySelectorAll('.survival-svg line').length };
});
console.log(JSON.stringify(info, null, 1));
await page.locator('.survival').scrollIntoViewIfNeeded();
await page.waitForTimeout(300);
await page.locator('.survival').screenshot({ path: `${OUT}/chart.png` });
await page.locator('.build-col-side').screenshot({ path: `${OUT}/chart-panel.png` });
await browser.close();
