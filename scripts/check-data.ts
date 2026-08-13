/**
 * Offline sanity check for the bundled data + engine.
 * Run with: npm run check
 */
import { BUILT_IN_THREATS } from '../src/data/threats.ts';
import { FORMATS, getFormat } from '../src/data/formats.ts';
import {
  abilitiesFor, allItems, allSelectableSpecies, getItem, getMove, getSpecies,
  loadLearnset, megaFromItem, megasFor, toID,
} from '../src/data/dex.ts';
import { threatToSet, buildMatrix, summariseThreats } from '../src/engine/matrix.ts';
import { calcDamage, defaultField, displayName } from '../src/engine/calc.ts';
import { resolveForm, evTotal } from '../src/engine/stats.ts';
import { exportTeam, importTeam } from '../src/engine/showdown.ts';
import { minEVsToSurvive, minEVsToKO, minEVsToOutspeed } from '../src/engine/optimizer.ts';
import { validateTeam } from '../src/engine/legality.ts';
import { rosterConfidence } from '../src/data/roster.ts';

const format = getFormat('champs-mb-doubles');
let failures = 0;
const fail = (msg: string) => { console.error('  ✗ ' + msg); failures++; };
const ok = (msg: string) => console.log('  ✓ ' + msg);

console.log('\n=== Threat database ===');
for (const t of BUILT_IN_THREATS) {
  const species = getSpecies(t.species);
  if (!species) { fail(`${t.name}: unknown species ${t.species}`); continue; }

  if (!abilitiesFor(t.species).some((a) => toID(a) === toID(t.ability))) {
    fail(`${t.name}: ${t.species} cannot have ${t.ability} (legal: ${abilitiesFor(t.species).join(', ')})`);
  }
  if (t.item && !getItem(t.item)) fail(`${t.name}: unknown item ${t.item}`);

  const total = Object.values(t.evs).reduce((a, b) => a + (b ?? 0), 0);
  if (total > 508) fail(`${t.name}: ${total} EVs`);

  const conf = rosterConfidence(t.species, format, null);
  if (conf === 'excluded') fail(`${t.name}: ${t.species} is illegal in ${format.shortName}`);

  const learnset = await loadLearnset(t.species);
  for (const m of t.moves) {
    const move = getMove(m);
    if (!move) { fail(`${t.name}: unknown move ${m}`); continue; }
    if (!learnset.some((l) => toID(l) === move.id)) {
      fail(`${t.name}: ${t.species} does not learn ${move.name}`);
    }
  }

  const set = threatToSet(t, 50);
  const form = resolveForm(set, format);
  if (t.item && getItem(t.item)?.megaStone) {
    if (!form?.mega) fail(`${t.name}: ${t.item} did not resolve to a Mega forme`);
    else if (!megaFromItem(t.species, t.item)) fail(`${t.name}: stone/species mismatch`);
  }
}
if (!failures) ok(`${BUILT_IN_THREATS.length} threat sets are internally consistent`);

console.log('\n=== Roster coverage ===');
{
  // The dex marks anything absent from Scarlet/Violet as "Past", which covers 22
  // Mega base species and every legacy Mega Stone. Champions is fed from HOME and
  // is built around those Megas, so they must all be reachable in the builder.
  const selectable = new Set(allSelectableSpecies().map((s) => s.id));
  const missing = [];
  for (const s of allSelectableSpecies()) void s;
  const stones = allItems().filter((i) => i.megaStone);
  const bases = new Set();
  for (const stone of stones) for (const b of Object.keys(stone.megaStone!)) bases.add(toID(b));
  for (const b of bases) {
    if (!selectable.has(b as string)) missing.push(b);
  }
  if (missing.length) fail(`Mega base species not selectable: ${missing.join(', ')}`);
  else ok(`all ${bases.size} Mega base species are selectable`);

  for (const name of ['Mawile', 'Kangaskhan', 'Absol', 'Steelix', 'Alakazam']) {
    if (!getSpecies(name)) fail(`${name} is missing from the dataset`);
    else if (!allSelectableSpecies().some((s) => s.name === name)) fail(`${name} is not selectable`);
  }
  ok('pre-Gen-9 Mega bases (Mawile, Kangaskhan, Absol, Steelix, Alakazam) are selectable');

  const stoneNames = ['Charizardite Y', 'Mawilite', 'Metagrossite', 'Staraptite'];
  const listed = new Set(allItems().map((i) => i.name));
  const absent = stoneNames.filter((n) => !listed.has(n));
  if (absent.length) fail(`Mega Stones missing from the item list: ${absent.join(', ')}`);
  else ok('legacy and Champions-era Mega Stones both appear in the item list');

  if (megasFor('Mawile').length !== 1) fail('Mawile lost its Mega');
  const learn = await loadLearnset('Mawile');
  if (!learn.some((m) => toID(m) === 'playrough')) fail('Mawile learnset missing Play Rough');
  else ok(`learnsets resolve for pre-Gen-9 species (Mawile: ${learn.length} moves)`);

  // Aliases keep Showdown pastes importable.
  for (const [alias, expected] of [['Mega Charizard Y', 'Charizard-Mega-Y'], ['Ttar', 'Tyranitar'], ['Landorus-T', 'Landorus-Therian']]) {
    const got = getSpecies(alias)?.name;
    if (got !== expected) fail(`alias "${alias}" resolved to ${got} (expected ${expected})`);
  }
  ok('name aliases resolve');
}

console.log('\n=== Damage calculation ===');
{
  const chomp = threatToSet(BUILT_IN_THREATS.find((t) => t.id === 'garchomp-sash')!, 50);
  const incin = threatToSet(BUILT_IN_THREATS.find((t) => t.id === 'incineroar-support')!, 50);
  const field = defaultField('Doubles');
  const r = calcDamage(chomp, incin, 'Earthquake', format, field);
  if (!r || r.max === 0) fail('Garchomp Earthquake into Incineroar did no damage');
  else ok(r.desc);

  const zardy = threatToSet(BUILT_IN_THREATS.find((t) => t.id === 'charizard-megay')!, 50);
  const zForm = resolveForm(zardy, format);
  if (zForm?.species.name !== 'Charizard-Mega-Y') fail('Charizardite Y did not produce Mega Charizard Y');
  else ok(`Mega resolution: ${displayName(zForm.species.name)} (${zForm.ability}, ${zForm.types.join('/')})`);

  const sun = { ...field, weather: 'Sun' as const };
  const noSun = calcDamage(zardy, incin, 'Heat Wave', format, field)!;
  const withSun = calcDamage(zardy, incin, 'Heat Wave', format, sun)!;
  if (withSun.max <= noSun.max) fail('Sun did not increase Heat Wave damage');
  else ok(`Heat Wave vs Incineroar: ${noSun.maxPct.toFixed(1)}% → ${withSun.maxPct.toFixed(1)}% in sun`);

  // Spread reduction must apply in doubles.
  const single = calcDamage(chomp, incin, 'Earthquake', format, defaultField('Singles'))!;
  const dbl = calcDamage(chomp, incin, 'Earthquake', format, field)!;
  if (!(dbl.max < single.max)) fail('Spread move was not reduced in doubles');
  else ok(`Earthquake spread reduction: ${single.max} → ${dbl.max}`);

  const mawile = threatToSet(BUILT_IN_THREATS.find((t) => t.id === 'mawile-mega')!, 50);
  const mForm = resolveForm(mawile, format);
  if (mForm?.ability !== 'Huge Power') fail(`Mega Mawile ability was ${mForm?.ability}`);
  else ok('Mega Mawile picks up Huge Power');
}

console.log('\n=== Threat matrix ===');
{
  const team = BUILT_IN_THREATS.slice(0, 6).map((t) => threatToSet(t, 50));
  const threats = BUILT_IN_THREATS.map((t) => threatToSet(t, 50));
  const start = Date.now();
  const matrix = buildMatrix(team, threats, { format, field: defaultField('Doubles') });
  const summaries = summariseThreats(matrix, team, format, BUILT_IN_THREATS.map((t) => t.usage));
  const ms = Date.now() - start;
  if (matrix.cells.length !== 6) fail('matrix row count wrong');
  if (matrix.cells[0].length !== threats.length) fail('matrix column count wrong');
  ok(`${6 * threats.length} matchups (${6 * threats.length * 8} calcs) in ${ms}ms`);
  const worst = [...summaries].sort((a, b) => b.pressure - a.pressure)[0];
  ok(`highest-pressure threat: ${worst.name} (${worst.pressure})`);
}

console.log('\n=== Optimizer ===');
{
  const field = defaultField('Doubles');
  const incin = threatToSet(BUILT_IN_THREATS.find((t) => t.id === 'incineroar-support')!, 50);
  const chomp = threatToSet(BUILT_IN_THREATS.find((t) => t.id === 'garchomp-sash')!, 50);
  const bare = { ...incin, evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 } };

  const survive = minEVsToSurvive({ defender: bare, attacker: chomp, move: 'Earthquake', format, field });
  if (!survive.best) fail('no survive solution found');
  else if (survive.best.worstCasePct >= 100) fail('survive solution does not actually survive');
  else ok(`Incineroar survives Life Orb Garchomp Earthquake with ${survive.best.hpEV} HP / ${survive.best.defEV} Def (${survive.best.worstCasePct.toFixed(1)}% max roll)`);

  const ko = minEVsToKO(chomp, incin, 'Earthquake', format, field, { guaranteed: false });
  ok(ko ? `Garchomp needs ${ko.atkEV} Atk EVs for a chance to OHKO the bulky Incineroar` : 'Earthquake cannot OHKO Incineroar');

  const speed = minEVsToOutspeed(bare, 100, format);
  if (!speed.withCurrentNature) fail('no speed solution for a reachable benchmark');
  else ok(`Incineroar needs ${speed.withCurrentNature.evs} Spe EVs to pass 100 Speed (reaches ${speed.withCurrentNature.speed})`);
}

console.log('\n=== Showdown import/export ===');
{
  const original = BUILT_IN_THREATS.slice(0, 4).map((t) => threatToSet(t, 50));
  const text = exportTeam(original);
  const back = importTeam(text);
  if (back.errors.length) fail(`import errors: ${back.errors.join('; ')}`);
  if (back.sets.length !== original.length) fail(`round trip lost sets: ${back.sets.length}/${original.length}`);
  for (let i = 0; i < original.length; i++) {
    const a = original[i];
    const b = back.sets[i];
    if (!b) continue;
    if (toID(a.species) !== toID(b.species)) fail(`species mismatch ${a.species} → ${b.species}`);
    if (toID(a.item) !== toID(b.item)) fail(`item mismatch ${a.item} → ${b.item}`);
    if (a.nature !== b.nature) fail(`nature mismatch ${a.nature} → ${b.nature}`);
    if (evTotal(a.evs) !== evTotal(b.evs)) fail(`EV mismatch on ${a.species}`);
    if (a.moves.filter(Boolean).join() !== b.moves.filter(Boolean).join()) fail(`move mismatch on ${a.species}`);
  }
  if (!failures) ok('round trip preserved species, item, nature, EVs and moves');

  const paste = `Mega Charizard Y\nAbility: Blaze\nLevel: 50\nEVs: 4 HP / 252 SpA / 252 Spe\nModest Nature\n- Heat Wave\n- Protect`;
  const mega = importTeam(paste);
  if (mega.sets[0]?.species !== 'Charizard') fail('Mega paste did not fold back to the base species');
  else if (toID(mega.sets[0].item) !== 'charizarditey') fail('Mega paste did not infer the stone');
  else ok('pasting "Mega Charizard Y" yields Charizard @ Charizardite Y');
}

console.log('\n=== Legality ===');
{
  const team = {
    id: 't', name: 'test', formatId: format.id, notes: '', updatedAt: 0,
    members: [
      threatToSet(BUILT_IN_THREATS[0], 50),
      { ...threatToSet(BUILT_IN_THREATS[1], 50), item: 'Safety Goggles' },
    ],
  };
  for (const m of team.members) await loadLearnset(m.species);
  const issues = validateTeam(team, format, null);
  const itemClause = issues.find((i) => i.code === 'item-clause');
  if (!itemClause) fail('item clause not detected');
  else ok('item clause detected');

  const illegal = {
    ...team,
    members: [{ ...threatToSet(BUILT_IN_THREATS[0], 50), species: 'Koraidon' }],
  };
  const catIssue = validateTeam(illegal, format, null).find((i) => i.code === 'category');
  if (!catIssue) fail('restricted legendary not rejected');
  else ok(`restricted rejected: ${catIssue.message}`);
}

console.log('\n=== Formats ===');
for (const f of FORMATS) {
  if (!f.name || !f.sourceNotes) fail(`format ${f.id} missing metadata`);
}
ok(`${FORMATS.length} formats defined`);

console.log(failures ? `\n${failures} FAILURE(S)\n` : '\nAll checks passed.\n');
process.exit(failures ? 1 : 0);
