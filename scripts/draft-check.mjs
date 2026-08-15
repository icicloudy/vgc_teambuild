/**
 * Drives the Draft Table in a real browser: the drafter has to finish a partial
 * team, explain itself, and produce sets the app itself considers legal.
 * Run with: npm run smoke:draft
 */
import { chromium } from 'playwright';

const OUT = process.env.SHOT_DIR || 'screenshots';
const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  args: ['--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1500, height: 1200 }, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error' && !/ERR_TUNNEL|Failed to load resource/.test(m.text())) errors.push(m.text());
});

await page.goto(process.env.BASE_URL || 'http://localhost:5180', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.slot-add');

const checks = [];
const check = (n, ok) => checks.push([n, ok]);

/* A half-built team: two Pokémon, one of them missing everything. */
await page.evaluate(() => {
  const blank = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
  const team = {
    id: 'd1', name: 'Draft', formatId: 'champs-mb-doubles', notes: '', updatedAt: Date.now(),
    members: [
      {
        id: 'd-1', species: 'Incineroar', nickname: '', item: 'Safety Goggles',
        ability: 'Intimidate', level: 50, nature: 'Careful',
        sp: { ...blank, hp: 32, spd: 32 },
        moves: ['Fake Out', 'Knock Off', 'Parting Shot', 'Flare Blitz'],
      },
      {
        id: 'd-2', species: 'Amoonguss', nickname: '', item: '',
        ability: 'Effect Spore', level: 50, nature: 'Serious',
        sp: { ...blank }, moves: ['', '', '', ''],
      },
    ],
  };
  localStorage.setItem('champions-teambuilder', JSON.stringify({
    state: { teams: [team], activeTeamId: 'd1', formatId: 'champs-mb-doubles' }, version: 2,
  }));
});
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('.slot');

/* ---- the tab exists and opens ---- */
await page.getByRole('button', { name: 'Draft', exact: true }).click();
await page.waitForSelector('.draft-controls');
check('Draft tab opens', await page.locator('.draft-controls').isVisible());

/* ---- drafting fills every open slot ---- */
await page.getByRole('button', { name: 'Draft the rest' }).click();
await page.waitForSelector('.draft-card', { timeout: 120000 });
await page.waitForFunction(
  () => document.querySelectorAll('.draft-card').length >= 5,
  null,
  { timeout: 120000 },
);
const cards = await page.locator('.draft-card').count();
check('every open slot is drafted (4 new + 1 completed)', cards === 5);

/* ---- the half-finished Pokémon is completed, not replaced ---- */
const completed = await page.locator('.draft-card.is-completed').count();
check('the half-finished Pokémon is finished rather than replaced', completed === 1);
const completedText = await page.locator('.draft-card.is-completed').innerText();
check('completion says what it filled in', /finished:/i.test(completedText));

/* ---- every card explains itself, and carries a full set ---- */
const cardData = await page.evaluate(() => [...document.querySelectorAll('.draft-card')].map((c) => ({
  reasons: c.querySelectorAll('.draft-reasons li').length,
  moves: c.querySelectorAll('.draft-move').length,
  sp: c.querySelector('.draft-sp')?.textContent ?? '',
  nature: c.querySelector('.draft-spread .muted')?.textContent ?? '',
  item: c.querySelector('.draft-card-title .muted')?.textContent ?? '',
})));
check('every pick is explained', cardData.every((c) => c.reasons >= 1));
check('every pick has four moves', cardData.every((c) => c.moves === 4));
check('every pick has a Nature', cardData.every((c) => /\(/.test(c.nature)));
check('every pick has an item', cardData.every((c) => !/no item/.test(c.item)));
check('every pick spends its Stat Points', cardData.every((c) => /6[0-6]\/66/.test(c.sp)));

/* ---- every move says whether it is physical, special or status ---- */
const categories = await page.evaluate(() => {
  const chips = [...document.querySelectorAll('.draft-move')];
  return {
    total: chips.length,
    labelled: chips.filter((c) => c.querySelector('.cat')).length,
    kinds: [...new Set(chips.map((c) => c.querySelector('.cat')?.textContent))],
  };
});
check('every move chip shows its category', categories.total > 0 && categories.labelled === categories.total);
check('categories are distinguished', categories.kinds.length >= 2);

/* ---- the shape read-out is before → after ---- */
const shape = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('.shape-row')];
  return rows.map((r) => ({
    label: r.querySelector('.shape-label')?.textContent,
    hasTick: !!r.querySelector('.shape-tick'),
    value: r.querySelector('.shape-values strong')?.textContent,
  }));
});
check('shape chart has all seven axes', shape.length === 7);
check('cohesion is one of them', shape.some((s) => /Cohesion/.test(s.label ?? '')));
check('shape chart marks where the team is today', shape.some((s) => s.hasTick));
check('shape chart reports a drafted value', shape.every((s) => Number(s.value) >= 0));

/* ---- the cards explain how the team fits together, not only what it beats ---- */
const reasonKinds = await page.evaluate(() =>
  [...document.querySelectorAll('.draft-reason-kind')].map((k) => k.textContent.trim()));
check('at least one pick is justified by team synergy', reasonKinds.includes('synergy'));

/* ---- no set carries two moves that do the same job ---- */
const roleDupes = await page.evaluate(() => {
  const roles = {
    'Parting Shot': 'pivot', 'U-turn': 'pivot', 'Volt Switch': 'pivot', 'Flip Turn': 'pivot',
    Tailwind: 'speed', 'Icy Wind': 'speed', Electroweb: 'speed', 'Thunder Wave': 'speed',
    'Follow Me': 'redirect', 'Rage Powder': 'redirect',
  };
  return [...document.querySelectorAll('.draft-card')].filter((card) => {
    const seen = [...card.querySelectorAll('.draft-move .move-chip-name')]
      .map((m) => roles[m.textContent.trim()])
      .filter(Boolean);
    return seen.some((r, i) => seen.indexOf(r) !== i);
  }).length;
});
check('no set carries two moves doing the same job', roleDupes === 0);

/* ---- justifications are not all the same shape ---- */
const kindVariety = new Set(reasonKinds);
check('reasons come in several kinds', kindVariety.size >= 3);
check('no pick is justified by a missing screens or recovery slot',
  !(await page.locator('.draft-reasons').allInnerTexts())
    .some((t) => /brings screens|brings recovery/.test(t)));

/* ---- alternates are offered ---- */
check('alternates are offered', (await page.locator('.draft-alts .mon-chip').count()) > 0);

await page.screenshot({ path: `${OUT}/draft.png`, fullPage: false });

/* ---- rejecting a pick redraws it ---- */
const firstNew = page.locator('.draft-card:not(.is-completed)').first();
const rejected = (await firstNew.locator('h3').innerText()).trim();
await firstNew.getByRole('button', { name: 'Not this one' }).click();
await page.waitForSelector('.chip-x');
await page.waitForFunction(
  (name) => {
    const cards = [...document.querySelectorAll('.draft-card:not(.is-completed) h3')];
    return cards.length > 0 && !cards.some((h) => h.textContent.trim() === name);
  },
  rejected,
  { timeout: 120000 },
);
check('a rejected Pokémon is not drafted again', true);

/* ---- applying the draft produces a legal, complete team ---- */
await page.getByRole('button', { name: 'Apply the whole team' }).click();
await page.waitForSelector('.slot-name');
const applied = await page.evaluate(() => {
  const saved = JSON.parse(localStorage.getItem('champions-teambuilder')).state;
  const team = saved.teams.find((t) => t.id === saved.activeTeamId) ?? saved.teams[0];
  return team.members.map((m) => ({
    species: m.species,
    item: m.item,
    ability: m.ability,
    moves: m.moves.filter(Boolean).length,
    sp: Object.values(m.sp).reduce((a, b) => a + b, 0),
    maxStat: Math.max(...Object.values(m.sp)),
  }));
});
check('applying fills the team to six', applied.length === 6);
check('every applied set is complete', applied.every(
  (m) => m.item && m.ability && m.moves === 4,
));
check('no applied set breaks the 66-point budget', applied.every((m) => m.sp <= 66));
check('no applied set breaks the 32-per-stat cap', applied.every((m) => m.maxStat <= 32));
check('species clause holds', new Set(applied.map((m) => m.species)).size === 6);
check('item clause holds', new Set(applied.map((m) => m.item)).size === 6);
check('the applied team is legal', !(await page.locator('.pill-error').count()));

/* ---- the item picker is curated and grouped ---- */
await page.getByRole('button', { name: 'Build', exact: true }).click();
await page.waitForSelector('.slot-editor, .panel');
const itemCombo = page.locator('.field', { hasText: 'Item' }).locator('.combo-value').first();
await itemCombo.click();
await page.waitForSelector('.combo-pop .combo-group');
const itemList = await page.evaluate(() => ({
  groups: [...document.querySelectorAll('.combo-pop .combo-group')].map((g) => g.textContent),
  first: [...document.querySelectorAll('.combo-pop .combo-opt-label')].slice(0, 6).map((o) => o.textContent),
  all: [...document.querySelectorAll('.combo-pop .combo-opt-label')].map((o) => o.textContent),
}));
check('items are grouped by category', itemList.groups.length >= 3);
check('commonly used items come first', /Commonly used/.test(itemList.groups[0] ?? ''));
check('the staples are at the top', itemList.first.includes('Sitrus Berry'));
check('items Champions does not have are gone', !itemList.all.includes('Assault Vest'));
check('dead items are gone (no evolution stones)', !itemList.all.includes('Fire Stone'));
check('dead items are gone (no Poké Balls)', !itemList.all.some((i) => /Poke Ball|Ultra Ball/.test(i)));
check('dead items are gone (no Z-Crystals)', !itemList.all.some((i) => / Z$/.test(i)));
await page.screenshot({ path: `${OUT}/items.png` });

/* ---- the move picker is ordered and grouped like the item picker ---- */
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
const moveCombo = page.locator('.move-slot .combo-value').first();
if (await moveCombo.count()) {
  await moveCombo.click();
  await page.waitForSelector('.combo-pop');
  const moveList = await page.evaluate(() => ({
    groups: [...document.querySelectorAll('.combo-pop .combo-group')].map((g) => g.textContent),
    first: [...document.querySelectorAll('.combo-pop .combo-opt-label')].slice(0, 8).map((o) => o.textContent),
  }));
  check('moves are grouped', moveList.groups.length >= 2);
  check('the moves the format runs come first', /Commonly used/.test(moveList.groups[0] ?? ''));
  check('Protect is near the top', moveList.first.includes('Protect'));
  await page.keyboard.press('Escape');
}

/* ---- report ---- */
console.log('\nDraft checks');
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
