import type { CombatantState, FieldState, FormatRules, PokemonSet, StatID } from '../types';
import { calcDamage, defaultCombatant, maxHPOf } from './calc';
import {
  MAX_SP_PER_STAT, MAX_SP_TOTAL, baseStatValue, resolveForm, spTotal,
} from './stats';
import { computeSpeed, defaultScenario } from './speed';
import type { SpeedScenario } from './speed';
import { NATURES, getMove, natureModifier } from '../data/dex';

function withSP(set: PokemonSet, patch: Partial<Record<StatID, number>>): PokemonSet {
  return { ...set, sp: { ...set.sp, ...patch } };
}

function inferCategory(move: string): 'Physical' | 'Special' | 'Status' {
  return (getMove(move)?.category ?? 'Status') as 'Physical' | 'Special' | 'Status';
}

/** Stat Points still free once every other stat keeps what it already has. */
export function budgetFor(set: PokemonSet, ...reserved: StatID[]): number {
  const spentElsewhere = spTotal(set.sp) - reserved.reduce((n, s) => n + (set.sp[s] ?? 0), 0);
  return Math.max(0, MAX_SP_TOTAL - spentElsewhere);
}

/* ------------------------------------------------------------------ *
 * Survival grid — HP × defence, the whole space at once
 * ------------------------------------------------------------------ */

export interface SurvivalCell {
  hpSP: number;
  defSP: number;
  /** Hits at the highest damage roll before this Pokémon faints. 99 = never. */
  hitsToKO: number;
  /** Damage taken at the highest roll, as a share of max HP. */
  worstPct: number;
  maxHP: number;
  /** Whether the pair fits inside the Stat Point budget. */
  affordable: boolean;
}

export interface SurvivalGrid {
  cells: SurvivalCell[][];
  /** Which defensive stat the attack is measured against. */
  defStat: 'def' | 'spd';
  category: 'Physical' | 'Special' | 'Status';
  budget: number;
  /** Cheapest affordable pair for each hit count, keyed by hitsToKO. */
  cheapest: Map<number, SurvivalCell>;
  /** True when the move does no damage at all. */
  inert: boolean;
}

export interface SurvivalQuery {
  defender: PokemonSet;
  attacker: PokemonSet;
  move: string;
  format: FormatRules;
  field: FieldState;
  attackerState?: CombatantState;
  defenderState?: CombatantState;
}

/**
 * Damage across every (HP, defence) Stat Point pair.
 *
 * 33 x 33 is small enough to evaluate exhaustively, which is what makes the
 * threshold map honest: no interpolation, every boundary is a real calculation.
 */
export function survivalGrid(q: SurvivalQuery): SurvivalGrid {
  const {
    defender, attacker, move, format, field,
    attackerState = defaultCombatant(), defenderState = defaultCombatant(),
  } = q;

  const category = inferCategory(move);
  const defStat: 'def' | 'spd' = category === 'Special' ? 'spd' : 'def';
  const budget = budgetFor(defender, 'hp', defStat);
  const cheapest = new Map<number, SurvivalCell>();

  const probe = calcDamage(attacker, defender, move, format, field, attackerState, defenderState);
  const inert = !probe || probe.max === 0;

  const cells: SurvivalCell[][] = [];
  for (let hpSP = 0; hpSP <= MAX_SP_PER_STAT; hpSP++) {
    const row: SurvivalCell[] = [];
    for (let defSP = 0; defSP <= MAX_SP_PER_STAT; defSP++) {
      const candidate = withSP(defender, { hp: hpSP, [defStat]: defSP } as Partial<Record<StatID, number>>);
      const maxHP = maxHPOf(candidate, format);
      const affordable = hpSP + defSP <= budget;

      let hitsToKO = 99;
      let worstPct = 0;
      if (!inert) {
        const res = calcDamage(
          attacker, candidate, move, format, field, attackerState, defenderState,
        );
        if (res && res.max > 0) {
          hitsToKO = Math.ceil(maxHP / res.max);
          worstPct = (res.max / maxHP) * 100;
        }
      }

      const cell: SurvivalCell = { hpSP, defSP, hitsToKO, worstPct, maxHP, affordable };
      row.push(cell);

      if (affordable) {
        const best = cheapest.get(hitsToKO);
        const cost = hpSP + defSP;
        if (!best || cost < best.hpSP + best.defSP) cheapest.set(hitsToKO, cell);
      }
    }
    cells.push(row);
  }

  return { cells, defStat, category, budget, cheapest, inert };
}

/** The distinct hit counts present in a grid, ascending. */
export function gridBands(grid: SurvivalGrid): number[] {
  const seen = new Set<number>();
  for (const row of grid.cells) for (const cell of row) seen.add(cell.hitsToKO);
  return [...seen].sort((a, b) => a - b);
}

/* ------------------------------------------------------------------ *
 * Single-answer solvers
 * ------------------------------------------------------------------ */

export interface SurviveOption {
  hpSP: number;
  defSP: number;
  total: number;
  worstCasePct: number;
  maxHP: number;
}

/**
 * Cheapest spreads that live `hits` hits, one per total cost, cheapest first.
 * Derived from the same grid the chart draws, so the two can never disagree.
 */
export function minSPToSurvive(q: SurviveQuery): {
  options: SurviveOption[];
  best: SurviveOption | null;
  category: 'Physical' | 'Special' | 'Status';
  defStat: 'def' | 'spd';
  impossible: boolean;
  grid: SurvivalGrid;
} {
  const hits = q.hits ?? 1;
  const grid = survivalGrid(q);

  const survivors: SurviveOption[] = [];
  for (const row of grid.cells) {
    for (const cell of row) {
      if (!cell.affordable) continue;
      if (cell.hitsToKO <= hits) continue; // faints on hit number `hits` or earlier
      survivors.push({
        hpSP: cell.hpSP,
        defSP: cell.defSP,
        total: cell.hpSP + cell.defSP,
        worstCasePct: cell.worstPct * hits,
        maxHP: cell.maxHP,
      });
    }
  }

  if (grid.inert) {
    return {
      options: [], best: null, category: grid.category, defStat: grid.defStat,
      impossible: false, grid,
    };
  }
  if (!survivors.length) {
    return {
      options: [], best: null, category: grid.category, defStat: grid.defStat,
      impossible: true, grid,
    };
  }

  // One entry per price point, favouring the HP-heavy pair at equal cost since HP
  // helps against both attacking categories.
  const byCost = new Map<number, SurviveOption>();
  for (const o of survivors) {
    const held = byCost.get(o.total);
    if (!held || o.hpSP > held.hpSP) byCost.set(o.total, o);
  }
  const options = [...byCost.values()].sort((a, b) => a.total - b.total);
  return {
    options: options.slice(0, 8), best: options[0], category: grid.category,
    defStat: grid.defStat, impossible: false, grid,
  };
}

export interface SurviveQuery extends SurvivalQuery {
  /** Number of hits to live through (1 = survive one hit at full HP). */
  hits?: number;
}

export interface KOOption {
  atkSP: number;
  minPct: number;
  maxPct: number;
  koText: string;
}

export function minSPToKO(
  attacker: PokemonSet,
  defender: PokemonSet,
  move: string,
  format: FormatRules,
  field: FieldState,
  opts: {
    guaranteed?: boolean; hits?: number;
    attackerState?: CombatantState; defenderState?: CombatantState;
  } = {},
): KOOption | null {
  const guaranteed = opts.guaranteed ?? true;
  const hits = opts.hits ?? 1;
  const category = inferCategory(move);
  if (category === 'Status') return null;
  const atkStat: StatID = category === 'Special' ? 'spa' : 'atk';
  const maxHP = maxHPOf(defender, format);
  const budget = Math.min(MAX_SP_PER_STAT, budgetFor(attacker, atkStat));

  for (let sp = 0; sp <= budget; sp++) {
    const candidate = withSP(attacker, { [atkStat]: sp } as Partial<Record<StatID, number>>);
    const res = calcDamage(
      candidate, defender, move, format, field, opts.attackerState, opts.defenderState,
    );
    if (!res) return null;
    const ok = guaranteed ? res.min * hits >= maxHP : res.max * hits >= maxHP;
    if (ok) {
      return {
        atkSP: sp,
        minPct: res.minPct * hits,
        maxPct: res.maxPct * hits,
        koText: res.koText,
      };
    }
  }
  return null;
}

export interface SpeedOption {
  sp: number;
  nature: string;
  speed: number;
}

export function minSPToOutspeed(
  set: PokemonSet,
  targetSpeed: number,
  format: FormatRules,
  scenario: SpeedScenario = defaultScenario(),
): { withCurrentNature: SpeedOption | null; withPositiveNature: SpeedOption | null } {
  const form = resolveForm(set, format);
  if (!form) return { withCurrentNature: null, withPositiveNature: null };
  const budget = Math.min(MAX_SP_PER_STAT, budgetFor(set, 'spe'));

  const trial = (nature: string): SpeedOption | null => {
    for (let sp = 0; sp <= budget; sp++) {
      const candidate = { ...withSP(set, { spe: sp }), nature };
      const speed = computeSpeed(candidate, format, scenario).final;
      if (scenario.trickRoom ? speed <= targetSpeed : speed > targetSpeed) {
        return { sp, nature, speed };
      }
    }
    return null;
  };

  const current = trial(set.nature);
  let positive: SpeedOption | null = null;
  if (natureModifier(set.nature, 'spe') <= 1) {
    const speedNature = NATURES.find(
      (n) => natureModifier(n, 'spe') > 1 && natureModifier(n, 'spa') < 1,
    ) ?? 'Jolly';
    positive = trial(speedNature);
  }
  return { withCurrentNature: current, withPositiveNature: positive };
}

/** Speed benchmarks worth hitting, derived from the threat list. */
export interface SpeedBenchmark {
  label: string;
  speed: number;
  scenarioNote: string;
}

export function speedBenchmarks(threats: PokemonSet[], format: FormatRules): SpeedBenchmark[] {
  const base = defaultScenario();
  return threats
    .map((t) => {
      const s = computeSpeed(t, format, base);
      return {
        label: t.nickname || t.species,
        speed: s.final,
        scenarioNote: s.applied.length ? s.applied.join(' + ') : 'no modifiers',
      };
    })
    .sort((a, b) => b.speed - a.speed);
}

/** What a stat reaches with no points, and with every point it may hold. */
export function statRange(
  stat: StatID,
  baseStat: number,
  level: number,
  nature: string,
): { bare: number; maxed: number } {
  const bare = baseStatValue(stat, baseStat, level, nature);
  return { bare, maxed: bare + MAX_SP_PER_STAT };
}

export function currentSpeed(set: PokemonSet, format: FormatRules): number {
  return computeSpeed(set, format, defaultScenario()).final;
}
