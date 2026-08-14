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
import { calcDamage, defaultField, displayName, maxHPOf, toCalcPokemon } from '../src/engine/calc.ts';
import { computeStats } from '../src/engine/stats.ts';
import { STATS } from '../src/types.ts';
import { MAX_SP_PER_STAT, MAX_SP_TOTAL, resolveForm, spTotal, statAt, baseStatValue } from '../src/engine/stats.ts';
import { exportTeam, importTeam } from '../src/engine/showdown.ts';
import { minSPToSurvive, minSPToKO, minSPToOutspeed, survivalGrid } from '../src/engine/optimizer.ts';
import { validateTeam } from '../src/engine/legality.ts';
import { rosterConfidence } from '../src/data/roster.ts';
import { itemCatalogue, inChampionsPool } from '../src/data/items.ts';
import { moveIsJustified } from '../src/engine/setgen.ts';
import { NFE_EXCEPTIONS } from '../src/data/champions.ts';
import { draftTeam, prepareThreats, teamShape } from '../src/engine/autobuild.ts';
import type { PlanId } from '../src/engine/plans.ts';
import type { TypeName } from '../src/data/dex.ts';
import { emptySet } from '../src/engine/showdown.ts';
import { getNature, effectiveness } from '../src/data/dex.ts';

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

  const total = Object.values(t.sp).reduce((a, b) => a + (b ?? 0), 0);
  if (total > MAX_SP_TOTAL) fail(`${t.name}: ${total} Stat Points (max ${MAX_SP_TOTAL})`);
  for (const [stat, v] of Object.entries(t.sp)) {
    if ((v ?? 0) > MAX_SP_PER_STAT) fail(`${t.name}: ${v} ${stat} Stat Points (max ${MAX_SP_PER_STAT})`);
  }

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
  // Two exceptions, both deliberate: a base forme you can never bring to a battle
  // cannot be a choice in the builder, Mega Stone or not.
  const NOT_BUILDABLE = new Set([
    'zygardecomplete',  // battle-only forme, reached from Zygarde
  ]);
  const selectable = new Set(allSelectableSpecies().map((s) => s.id));
  const missing = [];
  const stones = allItems().filter((i) => i.megaStone);
  const bases = new Set<string>();
  for (const stone of stones) for (const b of Object.keys(stone.megaStone!)) bases.add(toID(b));
  for (const b of bases) {
    if (!selectable.has(b) && !NOT_BUILDABLE.has(b)) missing.push(b);
  }
  if (missing.length) fail(`Mega base species not selectable: ${missing.join(', ')}`);
  else ok(`all ${bases.size - NOT_BUILDABLE.size} Mega base species are selectable`);

  // Nothing that only exists mid-battle, or only while an item is held, may be
  // offered as a team member.
  const unbuildable = allSelectableSpecies().filter(
    (s) => /-(Gmax|Totem)$/.test(s.name) || !!s.requiredItem,
  );
  if (unbuildable.length) {
    fail(`battle-only formes are selectable: ${unbuildable.slice(0, 6).map((s) => s.name).join(', ')}`);
  } else {
    ok('no Gigantamax, Totem or item-locked formes in the builder');
  }

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
  const chomp = threatToSet(BUILT_IN_THREATS.find((t) => t.id === 'garchomp-lo')!, 50);
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

  const mawile = { ...emptySet('Mawile'), item: 'Mawilite', level: 50 };
  const mForm = resolveForm(mawile, format);
  if (mForm?.ability !== 'Huge Power') fail(`Mega Mawile ability was ${mForm?.ability}`);
  else ok('Mega Mawile picks up Huge Power');
}

console.log('\n=== Stat Points ===');
{
  const incin = getSpecies('Incineroar')!;
  // 1 SP is exactly +1 to the stat, and the Nature multiplier scales only the base.
  const bare = baseStatValue('atk', incin.baseStats.atk, 50, 'Adamant');
  const one = statAt('atk', incin.baseStats.atk, 1, 50, 'Adamant');
  const maxed = statAt('atk', incin.baseStats.atk, MAX_SP_PER_STAT, 50, 'Adamant');
  if (one - bare !== 1) fail(`1 Stat Point moved Attack by ${one - bare}, expected 1`);
  else if (maxed - bare !== MAX_SP_PER_STAT) fail('32 Stat Points did not add exactly 32');
  else ok(`1 SP = +1 stat (Incineroar Adamant Atk ${bare} -> ${maxed} at ${MAX_SP_PER_STAT} SP)`);

  const neutral = baseStatValue('atk', incin.baseStats.atk, 50, 'Serious');
  if (bare <= neutral) fail('a boosting Nature did not raise the base stat');
  else ok(`Nature scales the base only: Adamant ${bare} vs neutral ${neutral}`);

  // @smogon/calc clones both Pokémon inside calculate(), and clone() rebuilds stats
  // from EVs/IVs — so a spread must reach the calculator through something the clone
  // carries. If this regresses, every damage number silently uses uninvested stats.
  const chompSet = threatToSet(BUILT_IN_THREATS.find((t) => t.id === 'garchomp-lo')!, 50);
  const base = { ...threatToSet(BUILT_IN_THREATS.find((t) => t.id === 'incineroar-support')!, 50),
    sp: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 } };
  const f = defaultField('Doubles');
  const noDef = calcDamage(chompSet, base, 'Earthquake', format, f)!;
  const maxDef = calcDamage(
    chompSet, { ...base, sp: { ...base.sp, def: MAX_SP_PER_STAT } }, 'Earthquake', format, f)!;
  if (!(maxDef.max < noDef.max)) {
    fail(`defensive Stat Points did not reduce damage (${noDef.max} vs ${maxDef.max})`);
  } else {
    ok(`defence points reach the calculator: ${noDef.max} -> ${maxDef.max} damage at ${MAX_SP_PER_STAT} Def`);
  }
  const bulky = { ...base, sp: { ...base.sp, hp: MAX_SP_PER_STAT } };
  if (maxHPOf(bulky, format) - maxHPOf(base, format) !== MAX_SP_PER_STAT) {
    fail('HP Stat Points did not reach the calculator');
  } else ok('HP points reach the calculator');

  // Every stat the engine computes must equal what the calculator ends up using.
  let mismatched = 0;
  for (const t of BUILT_IN_THREATS) {
    const set = threatToSet(t, 50);
    const mine = computeStats(set, format);
    const mon = toCalcPokemon(set, format)!;
    for (const st of STATS) if (mon.rawStats[st] !== mine[st]) mismatched++;
  }
  if (mismatched) fail(`${mismatched} stat mismatches between engine and calculator`);
  else ok(`all ${BUILT_IN_THREATS.length} threat sets round-trip every stat into the calculator`);

  const hpBare = baseStatValue('hp', incin.baseStats.hp, 50, 'Adamant');
  const hpNeutral = baseStatValue('hp', incin.baseStats.hp, 50, 'Serious');
  if (hpBare !== hpNeutral) fail('Nature affected HP');
  else ok(`HP ignores Nature (${hpBare})`);
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
  const chomp = threatToSet(BUILT_IN_THREATS.find((t) => t.id === 'garchomp-lo')!, 50);
  const bare = { ...incin, sp: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 } };

  const survive = minSPToSurvive({ defender: bare, attacker: chomp, move: 'Earthquake', format, field });
  if (!survive.best) fail('no survive solution found');
  else if (survive.best.worstCasePct >= 100) fail('survive solution does not actually survive');
  else ok(`Incineroar survives Life Orb Garchomp Earthquake with ${survive.best.hpSP} HP / ${survive.best.defSP} Def (${survive.best.worstCasePct.toFixed(1)}% max roll)`);

  const ko = minSPToKO(chomp, incin, 'Earthquake', format, field, { guaranteed: false });
  ok(ko ? `Garchomp needs ${ko.atkSP} Atk points for a chance to OHKO the bulky Incineroar` : 'Earthquake cannot OHKO Incineroar');

  const speed = minSPToOutspeed(bare, 100, format);
  if (!speed.withCurrentNature) fail('no speed solution for a reachable benchmark');
  else ok(`Incineroar needs ${speed.withCurrentNature.sp} Spe points to pass 100 Speed (reaches ${speed.withCurrentNature.speed})`);

  // The grid the chart draws must agree with the solver and be monotonic: more
  // points can never mean fewer hits survived.
  const grid = survivalGrid({ defender: bare, attacker: chomp, move: 'Earthquake', format, field });
  let monotonic = true;
  for (let hp = 0; hp < MAX_SP_PER_STAT; hp++) {
    for (let d = 0; d < MAX_SP_PER_STAT; d++) {
      if (grid.cells[hp + 1][d].hitsToKO < grid.cells[hp][d].hitsToKO) monotonic = false;
      if (grid.cells[hp][d + 1].hitsToKO < grid.cells[hp][d].hitsToKO) monotonic = false;
    }
  }
  if (!monotonic) fail('survival grid is not monotonic in Stat Points');
  else ok(`survival grid ${MAX_SP_PER_STAT + 1}x${MAX_SP_PER_STAT + 1} is monotonic`);

  const solved = grid.cells[survive.best!.hpSP][survive.best!.defSP];
  if (solved.hitsToKO < 2) fail('grid disagrees with the cheapest surviving spread');
  else ok('grid and solver agree on the cheapest surviving spread');
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
    if (spTotal(a.sp) !== spTotal(b.sp)) fail(`Stat Point mismatch on ${a.species}`);
    if (a.moves.filter(Boolean).join() !== b.moves.filter(Boolean).join()) fail(`move mismatch on ${a.species}`);
  }
  if (!failures) ok('round trip preserved species, item, nature, EVs and moves');

  const paste = `Mega Charizard Y\nAbility: Blaze\nLevel: 50\nSP: 2 HP / 32 SpA / 32 Spe\nModest Nature\n- Heat Wave\n- Protect`;
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
      { ...threatToSet(BUILT_IN_THREATS[0], 50), item: 'Sitrus Berry' },
      { ...threatToSet(BUILT_IN_THREATS[1], 50), item: 'Sitrus Berry' },
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

console.log('\n=== Drafter ===');
{
  // `gaps` is every type here: the check asks whether the move can *ever* justify
  // itself, not whether it did against one particular team.
  const TYPE_LIST = [
    'Normal', 'Fire', 'Water', 'Electric', 'Grass', 'Ice', 'Fighting', 'Poison',
    'Ground', 'Flying', 'Psychic', 'Bug', 'Rock', 'Ghost', 'Dragon', 'Dark', 'Steel', 'Fairy',
  ];
  const field = defaultField('Doubles');
  const plans: (PlanId | 'auto')[] = ['auto', 'balance', 'trickroom', 'sun', 'rain', 'bulky', 'tailwind'];
  let drafted = 0;

  for (const plan of plans) {
    // Every plan gets one draft from nothing and one that has to work around a core.
    for (const seed of [1, 2, 3, 4]) {
      const start = seed % 2 === 0
        ? [{ ...emptySet(seed === 2 ? 'Torkoal' : 'Incineroar'), level: 50 }]
        : [];
      const result = draftTeam({
        team: start,
        format,
        threats: BUILT_IN_THREATS,
        field,
        override: null,
        options: { plan, spice: seed / 5, banned: [], seed },
      });

      if (result.team.length !== format.bring) {
        fail(`${plan}: drafted ${result.team.length} of ${format.bring}`);
      }

      const team = {
        id: 'd', name: 'draft', formatId: format.id, members: result.team, notes: '', updatedAt: 0,
      };
      for (const issue of validateTeam(team, format, null)) {
        if (issue.level === 'error') fail(`${plan}: ${issue.message}`);
      }

      for (const member of result.team) {
        const label = `${plan}/${member.species}`;
        const learnset = await loadLearnset(member.species);
        for (const move of member.moves.filter(Boolean)) {
          if (!learnset.some((l) => toID(l) === toID(move))) fail(`${label} cannot learn ${move}`);
        }
        if (member.moves.filter(Boolean).length !== 4) fail(`${label} has an empty move slot`);
        if (!member.item) fail(`${label} has no item`);
        // The ability must be legal on the *base* forme: the Mega's ability is
        // applied by resolveForm, never stored.
        if (!abilitiesFor(member.species).some((a) => toID(a) === toID(member.ability))) {
          fail(`${label} cannot have ${member.ability}`);
        }
        if (spTotal(member.sp) > MAX_SP_TOTAL) fail(`${label} spends ${spTotal(member.sp)} points`);
        if (STATS.some((s) => (member.sp[s] ?? 0) > MAX_SP_PER_STAT)) {
          fail(`${label} exceeds the per-stat cap`);
        }
        if (spTotal(member.sp) < MAX_SP_TOTAL - 4) {
          fail(`${label} left ${MAX_SP_TOTAL - spTotal(member.sp)} points unspent`);
        }
        if (!getNature(member.nature)) fail(`${label} has an unknown Nature ${member.nature}`);
      }

      // The drafter may only propose Pokémon confirmed to be in Champions.
      // Suggesting one that is not in the game is the worst failure this tool has.
      for (const member of result.team.slice(start.length)) {
        if (rosterConfidence(member.species, format, null) !== 'confirmed') {
          fail(`${plan}: drafted ${member.species}, which is not confirmed to be in Champions`);
        }
      }

      // Every held item must exist in Champions, and no spread move may hit the
      // team's own side unless every partner is immune to it.
      for (const member of result.team) {
        const item = getItem(member.item);
        if (item && !inChampionsPool(item)) {
          fail(`${plan}/${member.species} holds ${member.item}, which Champions does not have`);
        }
        for (const name of member.moves.filter(Boolean)) {
          const move = getMove(name);
          if (!move || move.target !== 'allAdjacent') continue;
          const partners = result.team.filter((m) => m !== member);
          const safe = partners.every((mate) => {
            const form = resolveForm(mate, format);
            if (!form) return false;
            const ability = toID(form.ability);
            if (ability === 'telepathy' || ability === 'levitate') return true;
            return effectiveness(move.type, form.types) === 0;
          });
          if (!safe) fail(`${plan}/${member.species} runs ${move.name}, which hits its own partner`);
        }
      }

      // A damaging move earns its slot by STAB, by coverage, by a rider, or by
      // being overwhelming. Anything else is filler — a non-STAB Normal move with
      // none of the above is the case that started this rule.
      const allTypes = new Set(TYPE_LIST as TypeName[]);
      for (const member of result.team) {
        const form = resolveForm(member, format);
        if (!form) continue;
        for (const name of member.moves.filter(Boolean)) {
          const move = getMove(name);
          if (!move || move.category === 'Status') continue;
          const justified = moveIsJustified(move, {
            types: form.types,
            ability: form.ability,
            gaps: allTypes,
            weather: result.plan.weather,
          });
          if (!justified) {
            fail(`${plan}/${member.species} runs ${move.name}: no STAB, no coverage, no rider`);
          }
        }
      }

      // A Trick Room team must not invest in Speed, and must actually set the room.
      if (plan === 'trickroom') {
        if (result.team.some((m) => (m.sp.spe ?? 0) > 0)) fail('Trick Room plan bought Speed points');
        if (!result.team.some((m) => m.moves.some((x) => toID(x) === 'trickroom'))) {
          fail('Trick Room plan drafted nobody who sets Trick Room');
        }
      }
      drafted++;
    }
  }
  ok(`${drafted} drafts across ${plans.length} plans produce legal, complete, fully-invested teams`);

  // The drafter must finish a half-built Pokémon rather than replace it.
  const partial = { ...emptySet('Amoonguss'), level: 50 };
  const finished = draftTeam({
    team: [partial], format, threats: BUILT_IN_THREATS, field, override: null,
    options: { plan: 'balance', spice: 0.2, banned: [], seed: 5 },
  });
  const kept = finished.team[0];
  if (kept.species !== 'Amoonguss') fail('drafter replaced the Pokémon it was asked to finish');
  else if (kept.moves.filter(Boolean).length !== 4 || !kept.item) fail('drafter left the set unfinished');
  else ok(`half-built sets are completed in place (${kept.species} @ ${kept.item}: ${kept.moves.join(', ')})`);

  // A banned species never comes back.
  const first = draftTeam({
    team: [], format, threats: BUILT_IN_THREATS, field, override: null,
    options: { plan: 'balance', spice: 0.3, banned: [], seed: 9 },
  });
  const rejected = first.team[0].species;
  const second = draftTeam({
    team: [], format, threats: BUILT_IN_THREATS, field, override: null,
    options: { plan: 'balance', spice: 0.3, banned: [rejected], seed: 9 },
  });
  if (second.team.some((m) => toID(m.species) === toID(rejected))) {
    fail(`${rejected} was drafted again after being turned down`);
  } else ok(`turning down ${rejected} keeps it out of the next draft`);

  // Shape is a measurement, not a decoration: adding Pokémon must move it.
  const empty = teamShape([], prepareThreats(BUILT_IN_THREATS, format), format, field);
  if (Object.values(empty).some((v) => v !== 0)) fail('empty team has a non-zero shape');
  if (first.after.offense <= first.before.offense) fail('drafting a full team did not improve offense');
  else ok(`team shape moves with the team (offense ${first.before.offense} → ${first.after.offense})`);
}

console.log('\n=== Champions availability ===');
{
  // The roster is final-stage only, with a handful of documented exceptions.
  const nfeOffered = allSelectableSpecies().filter(
    (sp) => sp.nfe && rosterConfidence(sp.name, format, null) !== 'excluded',
  );
  const unexpected = nfeOffered.filter(
    (sp) => !NFE_EXCEPTIONS.some((n) => toID(n) === toID(sp.name)),
  );
  if (unexpected.length) {
    fail(`unevolved Pokémon still count as legal: ${unexpected.slice(0, 5).map((sp) => sp.name).join(', ')}`);
  } else {
    ok(`unevolved Pokémon are excluded, except ${NFE_EXCEPTIONS.join(', ')}`);
  }

  // …and the exceptions really are legal, because they really are in the game.
  for (const name of NFE_EXCEPTIONS) {
    if (!getSpecies(name)) continue;
    if (rosterConfidence(name, format, null) === 'excluded') fail(`${name} should be legal`);
  }
  ok('the roster exceptions are selectable');

  // Everything with published Reg M-B usage must be legal in the app.
  for (const t of BUILT_IN_THREATS) {
    if (rosterConfidence(t.species, format, null) === 'excluded') {
      fail(`${t.species} appears in ladder data but the app calls it illegal`);
    }
  }
  ok(`all ${BUILT_IN_THREATS.length} metagame Pokémon are legal in the app`);

  // Reported: the drafter suggested Togekiss, which is not in Champions. It was in
  // the confirmed list on nothing but recollection. Nothing may be in that list
  // without a source, and this is the specific case that proved why.
  if (rosterConfidence('Togekiss', format, null) === 'confirmed') {
    fail('Togekiss is marked confirmed, but nothing sources it');
  } else ok('unsourced species are not treated as confirmed');

  const open = getFormat('champs-open');
  if (rosterConfidence('Pawniard', open, null) === 'excluded') {
    fail('the sandbox format should not exclude anything');
  } else ok('the sandbox format still allows everything');
}

console.log('\n=== Item catalogue ===');
{
  const listed = itemCatalogue('Incineroar').map((e) => e.item.name);
  const dead = ['Fire Stone', 'Poke Ball', 'Ultra Ball', 'Berry Sweet', 'Pomeg Berry', 'Bug Gem'];
  const present = dead.filter((n) => listed.includes(n));
  if (present.length) fail(`items with no battle use are still listed: ${present.join(', ')}`);
  else ok(`${listed.length} usable items listed (was ${allItems().length} before curation)`);

  const staples = ['Sitrus Berry', 'Focus Sash', 'Life Orb', 'Choice Scarf'];
  const firstTen = listed.slice(0, 10);
  if (!staples.every((s) => firstTen.includes(s))) fail(`staples are not at the top: ${firstTen.join(', ')}`);
  else ok('the items VGC actually runs come first');

  const open = getFormat('champs-open');
  if (itemCatalogue('Incineroar', open).some((e) => e.item.name === 'Light Ball')) {
    fail('species-locked items are offered to the wrong species');
  } else if (!itemCatalogue('Pikachu', open).some((e) => e.item.name === 'Light Ball')) {
    fail('Light Ball is missing from Pikachu');
  } else ok('species-locked items only appear on the species that uses them');

  // Champions ships a curated item pool; the sandbox format is the escape hatch.
  const championsPool = itemCatalogue('Incineroar').map((e) => e.item.name);
  const absent = ['Assault Vest', 'Choice Band', 'Weakness Policy', 'Expert Belt'];
  const leaked = absent.filter((n) => championsPool.includes(n));
  if (leaked.length) fail(`items Champions does not have are still offered: ${leaked.join(', ')}`);
  else ok(`item pool restricted to Champions (${championsPool.length} items; sandbox shows ${itemCatalogue('Incineroar', open).length})`);

  for (const needed of ['Sitrus Berry', 'Focus Sash', 'Life Orb', 'Choice Scarf', 'Fairy Feather', 'Chople Berry', 'White Herb', 'Damp Rock']) {
    if (!championsPool.includes(needed)) fail(`${needed} is used on ladder but missing from the pool`);
  }
  ok('every item seen in Reg M-B ladder data is in the pool');

  const zardStones = itemCatalogue('Charizard').filter((e) => e.category === 'mega');
  if (zardStones.length !== 2) fail(`Charizard should see 2 Mega Stones, saw ${zardStones.length}`);
  else ok('only this Pokémon\'s own Mega Stones are offered');
}

console.log('\n=== Formats ===');
for (const f of FORMATS) {
  if (!f.name || !f.sourceNotes) fail(`format ${f.id} missing metadata`);
}
ok(`${FORMATS.length} formats defined`);

console.log(failures ? `\n${failures} FAILURE(S)\n` : '\nAll checks passed.\n');
process.exit(failures ? 1 : 0);
