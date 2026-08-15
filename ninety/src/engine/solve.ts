import { evaluate } from './matchup';
import type { DamageTable, Matchup } from './matchup';

/**
 * Team preview is a simultaneous game, so it gets solved like one.
 *
 * You pick four of six without seeing their four. They do the same. That is a
 * 15 × 15 matrix game, and it has the property every simultaneous game has: the
 * four that beats what they usually bring is not the four that beats what they
 * bring *once they know what you bring*. Both answers are worth having, and they
 * are different answers, so the app gives you both and prices the gap.
 *
 * The equilibrium is found by fictitious play — each side repeatedly best-
 * responds to the history of the other — which converges for zero-sum games and
 * costs nothing at this size.
 */

export function combinations(n: number, k: number): number[][] {
  const out: number[][] = [];
  const pick = (start: number, acc: number[]) => {
    if (acc.length === k) { out.push(acc.slice()); return; }
    for (let i = start; i < n; i++) { acc.push(i); pick(i + 1, acc); acc.pop(); }
  };
  pick(0, []);
  return out;
}

export interface GameSolution {
  /** Row options (yours) and column options (theirs), as index lists. */
  rows: number[][];
  cols: number[][];
  payoff: number[][];
  /** Mixed strategies at equilibrium. */
  rowMix: number[];
  colMix: number[];
  /** The equilibrium value: what the matchup is worth when both play well. */
  value: number;
}

export function solveGame(payoff: number[][], iterations = 3000): {
  rowMix: number[]; colMix: number[]; value: number;
} {
  const R = payoff.length;
  const C = payoff[0]?.length ?? 0;
  if (!R || !C) return { rowMix: [], colMix: [], value: 0 };

  const rowCount = new Array(R).fill(0);
  const colCount = new Array(C).fill(0);
  // Running payoff of each pure strategy against the other side's history.
  const rowScore = new Array(R).fill(0);
  const colScore = new Array(C).fill(0);

  // Seed: one arbitrary play each, so the first best-response has something to
  // answer. Starting from the maximin rows makes it converge faster than 0.
  let r = 0;
  let c = 0;
  for (let i = 0; i < iterations; i++) {
    for (let j = 0; j < C; j++) colScore[j] += payoff[r][j];
    for (let k = 0; k < R; k++) rowScore[k] += payoff[k][c];
    rowCount[r]++;
    colCount[c]++;

    // Row maximises, column minimises.
    let bestR = 0;
    for (let k = 1; k < R; k++) if (rowScore[k] > rowScore[bestR]) bestR = k;
    let bestC = 0;
    for (let j = 1; j < C; j++) if (colScore[j] < colScore[bestC]) bestC = j;
    r = bestR;
    c = bestC;
  }

  const rowMix = rowCount.map((n) => n / iterations);
  const colMix = colCount.map((n) => n / iterations);
  let value = 0;
  for (let i = 0; i < R; i++) {
    if (!rowMix[i]) continue;
    for (let j = 0; j < C; j++) value += rowMix[i] * colMix[j] * payoff[i][j];
  }
  return { rowMix, colMix, value };
}

/* ------------------------------------------------------------------ *
 * The preview solve
 * ------------------------------------------------------------------ */

export interface Recommendation {
  /** Positions into your six. */
  bring: number[];
  matchup: Matchup;
  /** Value against their equilibrium play. */
  vsBest: number;
  /** Value if they bring the worst possible four for you. */
  worst: number;
  /** Value against the four they are most likely to bring. */
  vsLikely: number;
  /** How much of the good case you give up by being read. */
  regret: number;
  /** Share of the equilibrium mix this four holds, 0–1. */
  weight: number;
}

export interface PreviewSolution {
  game: GameSolution;
  /** The answer: best response to their equilibrium play. */
  pick: Recommendation;
  /** The four whose worst case is least bad. */
  safest: Recommendation;
  /** The four that punishes their most likely bring hardest. */
  greedy: Recommendation;
  /** Their most likely four, as positions into their six. */
  theirLikely: number[];
  all: Recommendation[];
}

/**
 * @param mineIdx  positions into the damage table for your six, in team order
 * @param theirIdx positions into the damage table for their six, one set each
 */
export function solvePreview(
  table: DamageTable,
  mineIdx: number[],
  theirIdx: number[],
  pick = 4,
): PreviewSolution {
  const rows = combinations(mineIdx.length, Math.min(pick, mineIdx.length));
  const cols = combinations(theirIdx.length, Math.min(pick, theirIdx.length));

  const matchups: Matchup[][] = rows.map((r) =>
    cols.map((c) => evaluate(table, r.map((i) => mineIdx[i]), c.map((j) => theirIdx[j]))));
  const payoff = matchups.map((row) => row.map((m) => m.score));

  const game = solveGame(payoff);
  const solution: GameSolution = { rows, cols, payoff, ...game };

  // Their most likely four when they are not reading you: the one that does best
  // against your whole six played evenly. That is what a ladder opponent brings.
  let likely = 0;
  let likelyScore = Infinity;
  for (let j = 0; j < cols.length; j++) {
    const mean = payoff.reduce((n, row) => n + row[j], 0) / payoff.length;
    if (mean < likelyScore) { likelyScore = mean; likely = j; }
  }

  const recs: Recommendation[] = rows.map((bring, i) => {
    const row = payoff[i];
    const vsBest = row.reduce((n, v, j) => n + v * game.colMix[j], 0);
    const worst = Math.min(...row);
    const best = Math.max(...row);
    return {
      bring: bring.slice(),
      matchup: matchups[i][likely],
      vsBest,
      worst,
      vsLikely: row[likely],
      regret: best - worst,
      weight: game.rowMix[i],
    };
  });

  const pickBy = (fn: (r: Recommendation) => number) =>
    recs.reduce((a, b) => (fn(b) > fn(a) ? b : a));

  return {
    game: solution,
    pick: pickBy((r) => r.vsBest),
    safest: pickBy((r) => r.worst),
    greedy: pickBy((r) => r.vsLikely),
    theirLikely: cols[likely].slice(),
    all: recs,
  };
}

/* ------------------------------------------------------------------ *
 * Leads
 * ------------------------------------------------------------------ */

export interface LeadSolution {
  pairs: number[][];
  /** Positions into the chosen four. */
  lead: number[];
  matchup: Matchup;
  value: number;
  worst: number;
  /** Every pair, best first, for the read-out. */
  ranked: { pair: number[]; vsBest: number; worst: number }[];
}

/**
 * Which two of the four step out first.
 *
 * The same game, one level down and one level more brutal: on turn one nobody
 * has switched, nothing is known, and a Fake Out lands or it does not. The 2v2
 * evaluation is the same function as the 4v4 — Fake Out, redirection, speed and
 * damage are the same considerations — which is the point: if leading is a
 * different kind of question from bringing, one of the two models is wrong.
 */
export function solveLeads(
  table: DamageTable,
  myFour: number[],
  theirFour: number[],
): LeadSolution {
  const pairs = combinations(myFour.length, 2);
  const theirPairs = combinations(theirFour.length, 2);

  const matchups = pairs.map((p) =>
    theirPairs.map((q) => evaluate(table, p.map((i) => myFour[i]), q.map((j) => theirFour[j]))));
  const payoff = matchups.map((row) => row.map((m) => m.score));
  const game = solveGame(payoff, 1500);

  const ranked = pairs.map((pair, i) => ({
    pair: pair.slice(),
    vsBest: payoff[i].reduce((n, v, j) => n + v * game.colMix[j], 0),
    worst: Math.min(...payoff[i]),
  })).sort((a, b) => b.vsBest - a.vsBest);

  const bestIdx = pairs.findIndex((p) => p.join() === ranked[0].pair.join());
  let theirBest = 0;
  for (let j = 1; j < theirPairs.length; j++) {
    if (payoff[bestIdx][j] < payoff[bestIdx][theirBest]) theirBest = j;
  }

  return {
    pairs,
    lead: ranked[0].pair,
    matchup: matchups[bestIdx][theirBest],
    value: ranked[0].vsBest,
    worst: ranked[0].worst,
    ranked,
  };
}
