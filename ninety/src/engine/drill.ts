import { POOL, setOdds, toId } from '../data/dex';
import { PRESET_TEAMS, resolveTeam } from '../data/teams';
import { battler } from './battler';
import type { Battler } from './battler';
import { buildTable } from './matchup';
import type { DamageTable } from './matchup';
import { solveLeads, solvePreview } from './solve';
import type { PreviewSolution } from './solve';
import type { Assumption } from './brief';

/**
 * Team preview is a skill, and skills are trained by being graded.
 *
 * A drill deals a real matchup — one of the format's teams against a legal
 * opponent six drawn on usage — starts the same 90-second clock the game gives
 * you, and then scores what you brought against what the solver would have
 * brought. The grade is not "right or wrong": it is what fraction of the
 * available equity your four captured, because most preview decisions are worth
 * a few points rather than the game, and a trainer that says "wrong" to a
 * two-point miss teaches you to distrust it.
 */

export interface Scenario {
  seed: number;
  mine: Battler[];
  theirs: Battler[];
  teamName: string;
  teamNote: string;
  table: DamageTable;
  assumptions: Assumption[];
  solution: PreviewSolution;
}

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A legal opponent six: distinct species, distinct items, drawn on usage.
 *
 * Usage-weighted rather than uniform because the point of the drill is the
 * matchups you will actually face, and a six that is all of the format's rarest
 * Pokémon teaches you to solve a game nobody is playing.
 */
export function randomSix(random: () => number): Battler[] {
  const weights = POOL.map((p) => p.usage);
  const chosen: Battler[] = [];
  const usedSpecies = new Set<string>();
  const usedItems = new Set<string>();

  let guard = 0;
  while (chosen.length < 6 && guard++ < 400) {
    let roll = random() * weights.reduce((a, b, i) => a + (usedSpecies.has(POOL[i].id) ? 0 : b), 0);
    let entry = POOL[0];
    for (let i = 0; i < POOL.length; i++) {
      if (usedSpecies.has(POOL[i].id)) continue;
      roll -= weights[i];
      if (roll <= 0) { entry = POOL[i]; break; }
    }
    if (usedSpecies.has(entry.id)) continue;

    // Pick a set on its published share, then reject it if the item is taken.
    const odds = setOdds(entry);
    let pick = random();
    let index = 0;
    for (let i = 0; i < odds.length; i++) {
      pick -= odds[i];
      if (pick <= 0) { index = i; break; }
    }
    // Item Clause is checked on the same normalised id the Battler carries —
    // "Focus Sash".toLowerCase() is not "focussash", and comparing the two is how
    // a six with two Focus Sashes gets dealt.
    const options = entry.sets
      .map((_, i) => i)
      .filter((i) => !usedItems.has(toId(entry.sets[i].item)));
    if (!options.length) { usedSpecies.add(entry.id); continue; }
    if (!options.includes(index)) index = options[0];

    const b = battler(entry, index);
    chosen.push(b);
    usedSpecies.add(entry.id);
    usedItems.add(b.itemId);
  }
  return chosen;
}

/**
 * What you assume about a species you can only see the sprite of: its most
 * likely set, with the alternatives kept around so the risk read-out can price
 * being wrong.
 */
export function assumptionsFor(theirs: Battler[], table: DamageTable): Assumption[] {
  return theirs.map((b, slot) => {
    const siblings = table.theirs
      .map((t, index) => ({ t, index }))
      .filter(({ t }) => t.species === b.species);
    const self = siblings.find(({ t }) => t.key === b.key)!;
    return {
      slot,
      index: self.index,
      alternatives: siblings
        .filter(({ t }) => t.key !== b.key)
        .map(({ t, index }) => ({ index, odds: t.odds, battler: t }))
        .sort((a, z) => z.odds - a.odds),
    };
  });
}

/**
 * The damage table has to hold every set of theirs the app might reason about,
 * not only the one it assumes — otherwise the risk read-out has nothing to
 * compare against.
 */
export function tableFor(mine: Battler[], theirs: Battler[]): DamageTable {
  const expanded: Battler[] = [];
  for (const b of theirs) {
    const entry = POOL.find((p) => p.species === b.species)!;
    entry.sets.forEach((_, i) => expanded.push(battler(entry, i)));
  }
  return buildTable(mine, expanded);
}

export function scenario(seed: number, teamId?: string): Scenario {
  const random = rng(seed);
  const team = teamId
    ? PRESET_TEAMS.find((t) => t.id === teamId) ?? PRESET_TEAMS[0]
    : PRESET_TEAMS[Math.floor(random() * PRESET_TEAMS.length)];
  const mine = resolveTeam(team);

  // Their six must not duplicate a species with yours in a way that breaks the
  // mirror — Species Clause is per team, so overlaps are legal and common.
  const theirs = randomSix(random);

  const table = tableFor(mine, theirs);
  const assumptions = assumptionsFor(theirs, table);
  const solution = solvePreview(table, mine.map((_, i) => i), assumptions.map((a) => a.index));

  return {
    seed,
    mine,
    theirs,
    teamName: team.name,
    teamNote: team.note,
    table,
    assumptions,
    solution,
  };
}

/* ------------------------------------------------------------------ *
 * Grading
 * ------------------------------------------------------------------ */

export interface Grade {
  /** 0–100. */
  score: number;
  bringScore: number;
  leadScore: number;
  /** Equity your four is worth against their equilibrium play. */
  yours: number;
  /** Equity the best four is worth. */
  best: number;
  /** Equity the worst legal four is worth — the floor the grade is measured from. */
  floor: number;
  verdict: string;
  /** True when your four was within noise of the best one. */
  asGoodAsItGets: boolean;
  bestBring: number[];
  bestLead: number[];
}

export function grade(
  sc: Scenario,
  bring: number[],
  lead: number[],
): Grade {
  const { solution, table } = sc;
  const key = bring.slice().sort((a, b) => a - b).join();
  const rowIdx = solution.game.rows.findIndex((r) => r.join() === key);
  const yours = rowIdx >= 0 ? solution.all[rowIdx].vsBest : solution.all[0].vsBest;
  const best = Math.max(...solution.all.map((r) => r.vsBest));
  const floor = Math.min(...solution.all.map((r) => r.vsBest));
  const span = Math.max(1, best - floor);
  const bringScore = Math.max(0, Math.min(1, (yours - floor) / span));

  // Leads are graded inside the four you actually brought, because grading them
  // against a four you did not bring would be grading you twice for one mistake.
  const myFour = (rowIdx >= 0 ? solution.game.rows[rowIdx] : solution.pick.bring).map((p) => p);
  const theirFour = solution.theirLikely.map((j) => sc.assumptions[j].index);
  const leads = solveLeads(table, myFour.map((p) => p), theirFour);
  const leadKey = lead.slice().sort((a, b) => a - b).join();
  const leadRow = leads.ranked.find((r) => r.pair.join() === leadKey);
  const leadBest = leads.ranked[0].vsBest;
  const leadFloor = leads.ranked[leads.ranked.length - 1].vsBest;
  const leadSpan = Math.max(1, leadBest - leadFloor);
  const leadScore = leadRow
    ? Math.max(0, Math.min(1, (leadRow.vsBest - leadFloor) / leadSpan))
    : 0;

  const score = Math.round(100 * (0.7 * bringScore + 0.3 * leadScore));
  const asGoodAsItGets = best - yours < 1.5;

  const verdict = asGoodAsItGets && leadScore > 0.9
    ? 'That is the solve.'
    : asGoodAsItGets
      ? 'Right four, and the lead is where the points went.'
      : bringScore > 0.75
        ? 'A defensible four — it gives up a little to the four above it.'
        : bringScore > 0.4
          ? 'Playable, but you left a real edge on the table.'
          : 'This four is on the wrong side of the matchup.';

  return {
    score, bringScore, leadScore, yours, best, floor, verdict, asGoodAsItGets,
    bestBring: solution.pick.bring.slice(),
    bestLead: solveLeads(table, solution.pick.bring.map((p) => p), theirFour).lead.slice(),
  };
}
