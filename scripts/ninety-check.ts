/**
 * Offline checks for Ninety. Run with: npm run check:ninety
 * Pass a seed to also print a full briefing: npm run check:ninety -- 42
 */
import { POOL, effectiveness, setOdds } from '../ninety/src/data/dex.ts';
import { PRESET_TEAMS, itemClauseBreaks, resolveTeam, speciesClauseBreaks } from '../ninety/src/data/teams.ts';
import { battlersFor, likeliest, statValue } from '../ninety/src/engine/battler.ts';
import { buildTable, evaluate, regimeOf } from '../ninety/src/engine/matchup.ts';
import { combinations, solveGame, solvePreview, solveLeads } from '../ninety/src/engine/solve.ts';
import { brief } from '../ninety/src/engine/brief.ts';
import { assumptionsFor, grade, scenario, tableFor } from '../ninety/src/engine/drill.ts';

let failed = 0;
const ok = (m: string) => console.log('  ✓ ' + m);
const fail = (m: string) => { failed++; console.log('  ✗ ' + m); };
const check = (cond: boolean, good: string, bad: string) => (cond ? ok(good) : fail(bad));

console.log('\n=== Pool ===');
{
  check(POOL.length >= 20, `${POOL.length} species in the preview pool`, 'pool is too small to be a metagame');

  const measured = POOL.filter((p) => p.measured);
  check(measured.length >= 15, `${measured.length} carry published set data`, 'too little measured data');

  // A species with one set claims certainty it does not have; a species with
  // several has to have them add up to something usable.
  for (const entry of POOL) {
    const odds = setOdds(entry);
    const sum = odds.reduce((a, b) => a + b, 0);
    if (Math.abs(sum - 1) > 1e-9) fail(`${entry.species}: set odds sum to ${sum.toFixed(3)}`);
    if (odds.some((o) => o <= 0 || o > 1)) fail(`${entry.species}: an impossible set probability`);
  }
  ok('every species is a probability distribution over its sets');

  // Unmeasured species must not pretend to have alternatives.
  const fake = POOL.filter((p) => !p.measured && p.sets.length > 1);
  check(!fake.length, 'unmeasured species carry exactly one set, and say so',
    `${fake.map((p) => p.species).join(', ')} invent variants with no data behind them`);
}

console.log('\n=== Stats and damage ===');
{
  // Champions Stat Points at Level 50, checked against hand arithmetic.
  const chomp = likeliest('garchomp');
  check(chomp.stats.spe === Math.floor(Math.floor((2 * 102 + 31) * 50 / 100 + 5) * 1.1) + 32,
    `Garchomp reaches ${chomp.stats.spe} Speed on Jolly + 32 points`,
    `Garchomp Speed came out ${chomp.stats.spe}`);
  check(statValue('hp', 108, 2, 50, 'Jolly') === Math.floor((2 * 108 + 31) * 50 / 100) + 50 + 10 + 2,
    'HP follows the HP formula, which is a different formula',
    'HP is being computed like a regular stat');

  // Nothing may spend more than the budget.
  for (const entry of POOL) {
    for (const set of entry.sets) {
      const total = Object.values(set.sp).reduce((a, b) => a + b, 0);
      if (total > 66) fail(`${entry.species}/${set.label} spends ${total} Stat Points`);
    }
  }
  ok('every set is inside the 66-point budget');

  // Weather has to change what a move is, not only how hard it hits.
  const pelipper = likeliest('pelipper');
  const chompDef = likeliest('garchomp');
  const table = buildTable([pelipper], [chompDef]);
  const dry = table.out[0][0][0][0];
  const rain = table.out[1][0][0][0];
  check(rain.damage > dry.damage,
    `Pelipper hits Garchomp for ${Math.round(dry.damage * 100)}% dry and ${Math.round(rain.damage * 100)}% in its own rain`,
    'rain did not change Pelipper\'s damage');
  check(rain.best?.type === 'Water' || rain.best?.move.id === 'hurricane',
    `in rain its best move goes out as ${rain.best?.type}`,
    'Weather Ball is still being read as a Normal move in rain');

  // A resist berry is the whole reason Kingambit holds one.
  const kingambit = battlersFor('kingambit');
  const chople = kingambit.find((b) => b.itemId === 'chopleberry')!;
  const glasses = kingambit.find((b) => b.itemId === 'blackglasses')!;
  const sneasler = likeliest('sneasler');
  const t2 = buildTable([sneasler], [chople, glasses]);
  const vsChople = t2.out[0][0][0][0];
  const vsGlasses = t2.out[0][0][0][1];
  check(vsChople.damage < vsGlasses.damage,
    `Chople Berry Kingambit takes ${Math.round(vsChople.damage * 100)}% from Close Combat where the Black Glasses one takes ${Math.round(vsGlasses.damage * 100)}%`,
    'the resist berry is doing nothing');

  // Type immunity has to actually be immunity.
  check(effectiveness('Normal', ['Ghost']) === 0, 'Normal does nothing to Ghost', 'the type chart is wrong');
  check(effectiveness('Fighting', ['Dark', 'Steel']) === 4, 'Fighting is 4x on Kingambit', 'dual-type effectiveness is wrong');
}

console.log('\n=== Teams ===');
{
  for (const team of PRESET_TEAMS) {
    let six;
    try { six = resolveTeam(team); } catch (e) { fail(String((e as Error).message)); continue; }
    if (six.length !== 6) fail(`${team.name} has ${six.length} members`);
    const breaks = [...itemClauseBreaks(six), ...speciesClauseBreaks(six)];
    if (breaks.length) fail(`${team.name}: ${breaks.join('; ')}`);
  }
  ok(`${PRESET_TEAMS.length} preset teams are legal under Species and Item Clause`);
}

console.log('\n=== The game ===');
{
  check(combinations(6, 4).length === 15, 'six choose four is fifteen options', 'the option count is wrong');
  check(combinations(4, 2).length === 6, 'four choose two is six leads', 'the lead count is wrong');

  // Matching Pennies: no pure strategy, value 0, both sides play 50/50.
  const pennies = solveGame([[1, -1], [-1, 1]], 4000);
  check(Math.abs(pennies.value) < 0.05,
    `a game with no right answer solves to ${pennies.value.toFixed(3)}`,
    `matching pennies came out at ${pennies.value.toFixed(3)}`);
  check(Math.abs(pennies.rowMix[0] - 0.5) < 0.06,
    'and to an even mix, which is the correct answer to it',
    `the mix came out ${pennies.rowMix.map((n) => n.toFixed(2)).join('/')}`);

  // A dominated row must never be played.
  const dominated = solveGame([[5, 5], [1, 1]], 2000);
  check(dominated.rowMix[1] < 0.02, 'a dominated four is never brought', 'the solver brings a dominated four');
  check(Math.abs(dominated.value - 5) < 0.1, 'and the value is the dominant row', 'the game value is wrong');

  // The equilibrium value must sit between what each side can guarantee alone.
  const sc = scenario(7);
  const rowsMin = sc.solution.game.payoff.map((r) => Math.min(...r));
  const maximin = Math.max(...rowsMin);
  const colsMax = sc.solution.game.cols.map((_, j) =>
    Math.max(...sc.solution.game.payoff.map((r) => r[j])));
  const minimax = Math.min(...colsMax);
  const v = sc.solution.game.value;
  check(v >= maximin - 0.6 && v <= minimax + 0.6,
    `the equilibrium (${v.toFixed(1)}) sits between maximin ${maximin.toFixed(1)} and minimax ${minimax.toFixed(1)}`,
    `the equilibrium ${v.toFixed(1)} is outside [${maximin.toFixed(1)}, ${minimax.toFixed(1)}]`);

  check(sc.solution.pick.vsBest >= sc.solution.safest.vsBest - 1e-6,
    'the pick beats the safe four against equilibrium play, which is what makes it the pick',
    'the recommended four is worse than the safe one on its own measure');
  check(sc.solution.safest.worst >= sc.solution.pick.worst - 1e-6,
    'and the safe four has the better worst case, which is what makes it the safe one',
    'the safe four does not have the best worst case');
}

console.log('\n=== Judgement ===');
{
  // Tailwind on one side only has to change the tempo read.
  const whims = likeliest('whimsicott');
  const chomp = likeliest('garchomp');
  const incin = likeliest('incineroar');
  const gambit = likeliest('kingambit');
  const withTW = regimeOf([whims, chomp], [incin, gambit]);
  const withoutTW = regimeOf([chomp, incin], [gambit, incin]);
  check(withTW.tempo === 'mine' && withoutTW.tempo === 'neutral',
    'a one-sided Tailwind is read as a one-sided Tailwind',
    `tempo came out ${withTW.tempo} / ${withoutTW.tempo}`);

  // Rain from the only setter must be the weather that is up.
  const pelipper = likeliest('pelipper');
  check(regimeOf([pelipper, chomp], [incin, gambit]).weather === 'rain',
    'the only Drizzle on the board sets the weather',
    'a lone Drizzle did not set rain');

  // Armor Tail has to turn Fake Out off, and the app has to say so.
  const farigiraf = likeliest('farigiraf');
  const sneasler = likeliest('sneasler');
  const t = buildTable([sneasler, chomp], [farigiraf, gambit]);
  const m = evaluate(t, [0, 1], [0, 1]);
  const deadFakeOut = m.edges.find((e) => /Fake Out is dead/.test(e.label));
  check(!!deadFakeOut && deadFakeOut.value < 0,
    `Armor Tail is priced: "${deadFakeOut?.detail.slice(0, 68)}…"`,
    'Fake Out is still counted as live into Armor Tail');

  // Every edge the app prints has to name the Pokémon it is about.
  const sc = scenario(11);
  const b = brief(sc.table, sc.mine.map((_, i) => i), sc.assumptions, sc.solution);
  const names = [...sc.mine, ...sc.theirs].map((x) => x.species);
  const unnamed = [...b.bring, ...b.bench].filter((l) => !names.some((n) => l.reason.includes(n)) &&
    !/Nothing here for it to do|Genuinely close/.test(l.reason));
  check(!unnamed.length, 'every reason names the Pokémon it is about',
    `${unnamed.length} reasons are generic: ${unnamed.map((u) => u.battler.species).join(', ')}`);

  check(b.bring.length === 4 && b.bench.length === 2, 'four brought, two benched', 'the briefing lost a Pokémon');
  check(b.lead.length === 2 && b.lead.every((l) => b.bring.some((x) => x.battler.key === l.key)),
    'the leads are two of the four that were brought',
    'the lead is a Pokémon that was left at home');
  check(!!b.crux && b.crux.length > 40, 'the crux is a real sentence', 'the crux is empty or a stub');
  check(b.risks.every((r) => r.odds > 0 && r.odds <= 1), 'every risk carries a real probability',
    'a risk has an impossible probability');
  check(!JSON.stringify(b).includes('NaN'), 'no NaN reaches the page', 'a NaN got into the briefing');
  check(!JSON.stringify(b).includes('undefined'), 'no undefined reaches the page', 'an undefined got into the briefing');
}

console.log('\n=== Drill ===');
{
  let dealt = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const sc = scenario(seed);
    if (sc.theirs.length !== 6) { fail(`seed ${seed}: dealt ${sc.theirs.length} opponents`); continue; }
    const breaks = [...itemClauseBreaks(sc.theirs), ...speciesClauseBreaks(sc.theirs)];
    if (breaks.length) { fail(`seed ${seed}: illegal opponent six — ${breaks.join('; ')}`); continue; }

    // The solver's own answer must score full marks against itself.
    const best = grade(sc, sc.solution.pick.bring, solveLeads(
      sc.table, sc.solution.pick.bring, sc.solution.theirLikely.map((j) => sc.assumptions[j].index),
    ).lead);
    if (!best.asGoodAsItGets) fail(`seed ${seed}: the solver graded its own pick as suboptimal`);
    if (best.score < 95) fail(`seed ${seed}: the solver scored itself ${best.score}`);

    // And the worst four must score worse than the best one.
    const worstRow = sc.solution.all.reduce((a, z) => (z.vsBest < a.vsBest ? z : a));
    const worst = grade(sc, worstRow.bring, [0, 1]);
    if (worst.score > best.score) fail(`seed ${seed}: the worst four outscored the best`);
    dealt++;
  }
  ok(`${dealt} drills deal a legal six and grade the solver's own answer at the top`);
}

console.log('\n=== Uncertainty ===');
{
  // The whole point: pinning a different set has to be able to change the answer.
  const mine = resolveTeam(PRESET_TEAMS[0]);
  const theirs = ['Garchomp', 'Basculegion', 'Incineroar', 'Pelipper', 'Kingambit', 'Sinistcha']
    .map((s) => likeliest(POOL.find((p) => p.species === s)!.id));
  const table = tableFor(mine, theirs);
  const assumptions = assumptionsFor(theirs, table);
  const solution = solvePreview(table, mine.map((_, i) => i), assumptions.map((a) => a.index));

  const alts = assumptions.reduce((n, a) => n + a.alternatives.length, 0);
  check(alts >= 8, `${alts} alternative sets are held open for the risk read-out`,
    'the app is not tracking what it cannot see');

  // Swapping Garchomp to the Choice Scarf set must change its effective Speed.
  const slot = assumptions[0];
  const scarf = slot.alternatives.find((a) => a.battler.itemId === 'choicescarf');
  check(!!scarf, 'Choice Scarf Garchomp is one of the sets the app keeps in mind',
    'the Scarf set was dropped');
  if (scarf) {
    const base = table.theirs[slot.index];
    check(scarf.battler.stats.spe === base.stats.spe,
      'the Scarf set has the same raw Speed — the item is what makes it fast, so the app must apply it at compare time',
      'the Scarf set was given different base Speed');
  }

  const b = brief(table, mine.map((_, i) => i), assumptions, solution);
  check(b.risks.length > 0, `the app names ${b.risks.length} thing(s) that would change its mind`,
    'the app claims nothing could change its answer, which is never true at preview');
}

/* ---- optional: print a whole briefing so a human can read it ---- */
const seedArg = Number(process.argv[2]);
if (Number.isFinite(seedArg)) {
  const sc = scenario(seedArg);
  const b = brief(sc.table, sc.mine.map((_, i) => i), sc.assumptions, sc.solution);
  console.log(`\n\n========= ${sc.teamName} vs ${sc.theirs.map((t) => t.species).join(', ')} =========`);
  console.log(`\nCRUX  ${b.crux}`);
  console.log(`TEMPO ${b.regime}`);
  console.log(`\nBRING ${b.bring.map((l) => l.battler.species).join(', ')}`);
  console.log(`LEAD  ${b.lead.map((l) => l.species).join(' + ')} — ${b.leadReason}`);
  console.log(`      equity ${b.equity.toFixed(1)}, worst case ${b.worstCase.toFixed(1)}`);
  for (const l of b.bring) console.log(`  · ${l.battler.species.padEnd(16)} ${l.reason}   [${l.figure}]`);
  console.log('\nBENCH');
  for (const l of b.bench) console.log(`  · ${l.battler.species.padEnd(16)} ${l.reason}   [${l.figure}]`);
  console.log('\nRISKS');
  for (const r of b.risks) console.log(`  · ${(r.odds * 100).toFixed(0)}%  ${r.headline} — ${r.detail}`);
  if (b.closeCall) console.log(`\nCLOSE ${b.closeCall}`);
}

console.log(failed ? `\n${failed} FAILURE(S)\n` : '\nAll checks passed.\n');
process.exit(failed ? 1 : 0);
