import { chromium } from 'playwright';
const OUT = process.env.SHOT_DIR || 'screenshots';
const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  args: ['--no-sandbox'],
});
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});
await page.goto(process.env.BASE_URL || 'http://localhost:5180', { waitUntil: 'networkidle' });
await page.waitForSelector('.slot-add, .rail, .app');

// Seed a team straight into local storage so we look at a realistic screen.
await page.evaluate(() => {
  const mk = (species, item, ability, nature, evs, moves, id) => ({
    id, species, nickname: '', item, ability, level: 50, nature,
    evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0, ...evs },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    moves,
  });
  const team = {
    id: 'm1', name: 'Mobile test', formatId: 'champs-mb-doubles', notes: '', updatedAt: Date.now(),
    members: [
      mk('Incineroar', 'Safety Goggles', 'Intimidate', 'Careful', { hp: 252, atk: 4, spd: 252 },
        ['Fake Out', 'Knock Off', 'Parting Shot', 'Flare Blitz'], 'm-1'),
      mk('Charizard', 'Charizardite Y', 'Blaze', 'Modest', { hp: 4, spa: 252, spe: 252 },
        ['Heat Wave', 'Solar Beam', 'Air Slash', 'Protect'], 'm-2'),
      mk('Rillaboom', 'Assault Vest', 'Grassy Surge', 'Adamant', { hp: 252, atk: 252, spd: 4 },
        ['Grassy Glide', 'Wood Hammer', 'U-turn', 'Fake Out'], 'm-3'),
      mk('Amoonguss', 'Rocky Helmet', 'Regenerator', 'Calm', { hp: 252, def: 4, spd: 252 },
        ['Spore', 'Rage Powder', 'Pollen Puff', 'Protect'], 'm-4'),
    ],
  };
  localStorage.setItem('champions-teambuilder', JSON.stringify({
    state: { teams: [team], activeTeamId: 'm1', formatId: 'champs-mb-doubles' },
    version: 1,
  }));
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1200);

const checks = [];
const check = (name, ok) => checks.push([name, ok]);

// The team strip must exist and expose every slot, or you are stranded on slot 1.
const geom = await page.evaluate(() => {
  const rail = document.querySelector('.rail');
  return {
    railShown: !!rail && getComputedStyle(rail).display !== 'none',
    slots: document.querySelectorAll('.rail-list .slot:not(.slot-add)').length,
    addButton: !!document.querySelector('.slot-add'),
    noHorizontalScroll: document.body.scrollWidth <= document.documentElement.clientWidth,
  };
});
check('team strip visible on a phone', geom.railShown);
check('every team slot reachable', geom.slots === 4);
check('add button present', geom.addButton);
check('page does not scroll sideways', geom.noHorizontalScroll);

// Tapping a card must actually switch which Pokémon the editor is editing.
await page.locator('.rail-list .slot').nth(1).tap();
await page.waitForTimeout(600);
const editing = await page.locator('.build-col .panel-head h2').first().innerText();
check('tapping a card switches the editor', /Charizard/i.test(editing));
await page.locator('.rail-list .slot').nth(0).tap();
await page.waitForTimeout(500);

// Delete stays reachable without hover; reorder arrows are desktop-only.
const tools = await page.evaluate(() => {
  const slot = document.querySelector('.rail-list .slot');
  const del = slot?.querySelector('.slot-tool-del');
  const move = slot?.querySelector('.slot-tool-move');
  return {
    delVisible: !!del && getComputedStyle(del).display !== 'none' &&
      getComputedStyle(del.parentElement).opacity !== '0',
    moveHidden: !!move && getComputedStyle(move).display === 'none',
  };
});
check('delete reachable without hover', tools.delVisible);
check('reorder arrows hidden on mobile', tools.moveHidden);

const shots = [
  ['Build', 'm-01-build'],
  ['Threat matrix', 'm-02-threats'],
  ['Coach', 'm-03-coach'],
];
for (const [tab, file] of shots) {
  await page.click(`.tab:has-text("${tab}")`).catch(() => {});
  await page.waitForTimeout(900);
  const wide = await page.evaluate(() =>
    document.body.scrollWidth <= document.documentElement.clientWidth);
  check(`${tab} tab fits the viewport`, wide);
  await page.screenshot({ path: `${OUT}/${file}.png` });
}

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}`);
  if (!ok) failed++;
}
await browser.close();
console.log(failed ? `\n${failed} failed` : '\nMobile layout OK.');
process.exit(failed ? 1 : 0);
