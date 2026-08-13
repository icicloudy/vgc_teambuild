import type { CombatantState, FieldState, FormatRules, PokemonSet, StatID } from '../types';
import { calcDamage, defaultCombatant, maxHPOf, statsOf } from './calc';
import { MAX_EV_SINGLE, MAX_EV_TOTAL, evTotal, resolveForm, statAt } from './stats';
import { computeSpeed, defaultScenario } from './speed';
import type { SpeedScenario } from './speed';
import { NATURES, getMove, natureModifier } from '../data/dex';

const STEP = 4;

function withEVs(set: PokemonSet, patch: Partial<Record<StatID, number>>): PokemonSet {
  return { ...set, evs: { ...set.evs, ...patch } };
}

/* ------------------------------------------------------------------ *
 * Bulk: minimum investment to survive a hit
 * ------------------------------------------------------------------ */

export interface SurviveOption {
  hpEV: number;
  defEV: number;
  total: number;
  worstCasePct: number;
  /** Damage taken at the highest roll, in HP. */
  worstCaseDamage: number;
  maxHP: number;
}

export interface SurviveQuery {
  defender: PokemonSet;
  attacker: PokemonSet;
  move: string;
  format: FormatRules;
  field: FieldState;
  attackerState?: CombatantState;
  defenderState?: CombatantState;
  /** Number of hits to live through (1 = survive one hit at full HP). */
  hits?: number;
  /** Leave the rest of the spread alone and only spend what is still free. */
  budget?: number;
}

export function minEVsToSurvive(q: SurviveQuery): {
  options: SurviveOption[];
  best: SurviveOption | null;
  category: 'Physical' | 'Special' | 'Status';
  impossible: boolean;
} {
  const {
    defender, attacker, move, format, field,
    attackerState = defaultCombatant(), defenderState = defaultCombatant(),
  } = q;
  const hits = q.hits ?? 1;

  const probe = calcDamage(attacker, defender, move, format, field, attackerState, defenderState);
  const category = inferCategory(move);
  if (!probe || probe.max === 0) {
    return { options: [], best: null, category, impossible: false };
  }
  const defStat: StatID = category === 'Special' ? 'spd' : 'def';

  const spentElsewhere = evTotal(defender.evs) - (defender.evs.hp ?? 0) - (defender.evs[defStat] ?? 0);
  const budget = Math.min(q.budget ?? MAX_EV_TOTAL - spentElsewhere, MAX_EV_TOTAL);

  const survives = (hpEV: number, defEV: number): { ok: boolean; pct: number; dmg: number; maxHP: number } => {
    const candidate = withEVs(defender, { hp: hpEV, [defStat]: defEV } as Partial<Record<StatID, number>>);
    const res = calcDamage(attacker, candidate, move, format, field, attackerState, defenderState);
    const maxHP = maxHPOf(candidate, format);
    if (!res) return { ok: false, pct: 100, dmg: maxHP, maxHP };
    const dmg = res.max * hits;
    return { ok: dmg < maxHP, pct: (dmg / maxHP) * 100, dmg, maxHP };
  };

  const options: SurviveOption[] = [];
  for (let hpEV = 0; hpEV <= MAX_EV_SINGLE; hpEV += STEP) {
    if (hpEV > budget) break;
    // Damage taken falls monotonically as the defensive EV rises, so binary search.
    let lo = 0;
    let hi = Math.min(MAX_EV_SINGLE, budget - hpEV);
    if (hi < 0) break;
    if (!survives(hpEV, hi).ok) continue;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2 / STEP) * STEP;
      if (survives(hpEV, mid).ok) hi = mid;
      else lo = mid + STEP;
    }
    const final = survives(hpEV, lo);
    options.push({
      hpEV,
      defEV: lo,
      total: hpEV + lo,
      worstCasePct: final.pct,
      worstCaseDamage: final.dmg,
      maxHP: final.maxHP,
    });
  }

  if (!options.length) {
    return { options: [], best: null, category, impossible: true };
  }
  // Keep only Pareto-efficient spreads, cheapest first.
  const sorted = [...options].sort((a, b) => a.total - b.total || b.hpEV - a.hpEV);
  const seen = new Set<number>();
  const pareto = sorted.filter((o) => {
    if (seen.has(o.total)) return false;
    seen.add(o.total);
    return true;
  });
  return { options: pareto.slice(0, 12), best: pareto[0], category, impossible: false };
}

function inferCategory(move: string): 'Physical' | 'Special' | 'Status' {
  return (getMove(move)?.category ?? 'Status') as 'Physical' | 'Special' | 'Status';
}

/* ------------------------------------------------------------------ *
 * Power: minimum investment to secure a KO
 * ------------------------------------------------------------------ */

export interface KOOption {
  atkEV: number;
  minPct: number;
  maxPct: number;
  koText: string;
}

export function minEVsToKO(
  attacker: PokemonSet,
  defender: PokemonSet,
  move: string,
  format: FormatRules,
  field: FieldState,
  opts: { guaranteed?: boolean; hits?: number; attackerState?: CombatantState; defenderState?: CombatantState } = {},
): KOOption | null {
  const guaranteed = opts.guaranteed ?? true;
  const hits = opts.hits ?? 1;
  const category = inferCategory(move);
  if (category === 'Status') return null;
  const atkStat: StatID = category === 'Special' ? 'spa' : 'atk';
  const maxHP = maxHPOf(defender, format);

  const test = (ev: number) => {
    const candidate = withEVs(attacker, { [atkStat]: ev } as Partial<Record<StatID, number>>);
    const res = calcDamage(
      candidate, defender, move, format, field, opts.attackerState, opts.defenderState,
    );
    if (!res) return null;
    const ok = guaranteed ? res.min * hits >= maxHP : res.max * hits >= maxHP;
    return { ok, res };
  };

  const top = test(MAX_EV_SINGLE);
  if (!top || !top.ok) return null;

  let lo = 0;
  let hi = MAX_EV_SINGLE;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2 / STEP) * STEP;
    const t = test(mid);
    if (t?.ok) hi = mid;
    else lo = mid + STEP;
  }
  const final = test(lo);
  if (!final) return null;
  return {
    atkEV: lo,
    minPct: final.res.minPct * hits,
    maxPct: final.res.maxPct * hits,
    koText: final.res.koText,
  };
}

/* ------------------------------------------------------------------ *
 * Speed: minimum investment to outrun a benchmark
 * ------------------------------------------------------------------ */

export interface SpeedOption {
  evs: number;
  nature: string;
  speed: number;
}

export function minEVsToOutspeed(
  set: PokemonSet,
  targetSpeed: number,
  format: FormatRules,
  scenario: SpeedScenario = defaultScenario(),
): { withCurrentNature: SpeedOption | null; withPositiveNature: SpeedOption | null } {
  const form = resolveForm(set, format);
  if (!form) return { withCurrentNature: null, withPositiveNature: null };

  const trial = (nature: string): SpeedOption | null => {
    for (let ev = 0; ev <= MAX_EV_SINGLE; ev += STEP) {
      const candidate = { ...withEVs(set, { spe: ev }), nature };
      const speed = computeSpeed(candidate, format, scenario).final;
      if (scenario.trickRoom ? speed <= targetSpeed : speed > targetSpeed) {
        return { evs: ev, nature, speed };
      }
    }
    return null;
  };

  const current = trial(set.nature);
  let positive: SpeedOption | null = null;
  if (natureModifier(set.nature, 'spe') <= 1) {
    const speedNature = NATURES.find((n) => natureModifier(n, 'spe') > 1 &&
      natureModifier(n, 'spa') < 1) ?? 'Jolly';
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

export function speedBenchmarks(
  threats: PokemonSet[],
  format: FormatRules,
): SpeedBenchmark[] {
  const base = defaultScenario();
  const out: SpeedBenchmark[] = [];
  for (const t of threats) {
    const s = computeSpeed(t, format, base);
    out.push({
      label: t.nickname || t.species,
      speed: s.final,
      scenarioNote: s.applied.length ? s.applied.join(' + ') : 'no modifiers',
    });
  }
  return out.sort((a, b) => b.speed - a.speed);
}

/** Quick reference: what a given base stat reaches at common investments. */
export function statSpread(
  baseStat: number,
  stat: StatID,
  level: number,
  natures: string[] = ['Modest', 'Adamant'],
): { label: string; value: number }[] {
  void natures;
  return [
    { label: '0 EV, neutral', value: statAt(stat, baseStat, 31, 0, level, 'Serious') },
    { label: '252 EV, neutral', value: statAt(stat, baseStat, 31, 252, level, 'Serious') },
    { label: '252 EV, boosting', value: statAt(stat, baseStat, 31, 252, level, boostingNature(stat)) },
  ];
}

function boostingNature(stat: StatID): string {
  const map: Record<string, string> = {
    atk: 'Adamant', def: 'Impish', spa: 'Modest', spd: 'Calm', spe: 'Jolly', hp: 'Serious',
  };
  return map[stat] ?? 'Serious';
}

export function remainingEVs(set: PokemonSet): number {
  return MAX_EV_TOTAL - evTotal(set.evs);
}

export function currentSpeed(set: PokemonSet, format: FormatRules): number {
  return statsOf(set, format)?.spe ?? 0;
}
