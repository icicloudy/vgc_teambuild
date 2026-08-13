import * as smogon from '@smogon/calc';
import { natureModifier as natureModifierOf } from '../data/dex';
import type {
  CombatantState, DamageResult, FieldState, FormatRules, PokemonSet, StatID, StatsTable,
} from '../types';
import { calcGen, getMove, getSpecies } from '../data/dex';
import { computeStats, resolveForm } from './stats';

const gen = calcGen;

export function defaultCombatant(): CombatantState {
  return { boosts: {}, status: '', hpPercent: 100, megaOverride: null, abilityOn: false };
}

export function defaultField(gameType: 'Doubles' | 'Singles'): FieldState {
  const side = () => ({
    isReflect: false, isLightScreen: false, isAuroraVeil: false, isTailwind: false,
    isHelpingHand: false, isFriendGuard: false, isBattery: false, isPowerSpot: false,
    spikes: 0, isSR: false,
  });
  return {
    gameType,
    weather: '',
    terrain: '',
    isGravity: false,
    isMagicRoom: false,
    isWonderRoom: false,
    isTrickRoom: false,
    attackerSide: side(),
    defenderSide: side(),
  };
}

export function toSmogonField(f: FieldState): smogon.Field {
  return new smogon.Field({
    gameType: f.gameType,
    weather: (f.weather || undefined) as smogon.Field['weather'],
    terrain: (f.terrain || undefined) as smogon.Field['terrain'],
    isGravity: f.isGravity,
    isMagicRoom: f.isMagicRoom,
    isWonderRoom: f.isWonderRoom,
    attackerSide: { ...f.attackerSide },
    defenderSide: { ...f.defenderSide },
  });
}

/**
 * Base stats that make @smogon/calc reproduce a Champions Stat Point spread.
 *
 * The calculator has no concept of Stat Points, and assigning its `stats` after
 * construction does not survive: `calculate()` clones both Pokémon, and `clone()`
 * rebuilds stats from EVs/IVs — silently dropping the override and calculating
 * with uninvested stats. `overrides.species` *is* carried through the clone, so
 * the spread is encoded as base stats instead.
 *
 * Inverting the level-50 stat formula with 31 IVs, no EVs and a neutral nature
 * gives an exact (possibly fractional) base stat for any target, so the numbers
 * round-trip precisely rather than approximately.
 */
function syntheticBaseStats(
  set: PokemonSet,
  format: FormatRules,
  realBase: StatsTable,
): StatsTable {
  const stats = computeStats(set, format);
  const level = set.level;
  const out = {} as StatsTable;
  for (const stat of Object.keys(stats) as StatID[]) {
    const target = stats[stat];
    if (stat === 'hp') {
      // Shedinja's 1 HP is a special case in the games and in the calculator.
      out.hp = realBase.hp === 1 ? 1 : (((target - level - 10) * 100) / level - 31) / 2;
    } else {
      out[stat] = (((target - 5) * 100) / level - 31) / 2;
    }
  }
  return out;
}

/** Build a calculator Pokémon, folding in the Mega forme when a stone is held. */
export function toCalcPokemon(
  set: PokemonSet,
  format: FormatRules,
  state: CombatantState = defaultCombatant(),
): smogon.Pokemon | null {
  const form = resolveForm(set, format);
  if (!form) return null;

  const opts: Record<string, unknown> = {
    level: set.level,
    item: set.item || undefined,
    ability: form.ability || undefined,
    abilityOn: state.abilityOn,
    boosts: state.boosts,
    status: state.status || undefined,
    // Neutral nature: the Nature multiplier is already baked into the synthetic
    // base stats below, so applying it twice would inflate every number.
    nature: 'Serious',
    overrides: {
      types: form.types,
      baseStats: syntheticBaseStats(set, format, form.baseStats),
      weightkg: form.weightkg,
    },
  };
  if (format.teraAllowed && set.teraType) opts.teraType = set.teraType;

  const mon = new smogon.Pokemon(gen, form.base.name, opts as never);
  const stats = computeStats(set, format);
  mon.originalCurHP = state.hpPercent < 100
    ? Math.max(1, Math.floor((stats.hp * state.hpPercent) / 100))
    : stats.hp;
  return mon;
}

export function isSpreadMove(moveName: string, gameType: 'Doubles' | 'Singles'): boolean {
  if (gameType !== 'Doubles') return false;
  const m = getMove(moveName);
  if (!m) return false;
  return m.target === 'allAdjacent' || m.target === 'allAdjacentFoes';
}

export interface CalcOptions {
  isCrit?: boolean;
  hits?: number;
  /**
   * Spread reduction is driven by the field's game type, so a spread move aimed at
   * a single remaining target is modelled by calculating it as a Singles hit.
   */
  singleTarget?: boolean;
}

function spNotation(set: PokemonSet, stat: StatID): string {
  const sp = set.sp[stat] ?? 0;
  const mod = natureModifierOf(set.nature, stat);
  const sign = mod > 1 ? '+' : mod < 1 ? '-' : '';
  return `${sp}${sign}`;
}

function describe(
  attacker: PokemonSet,
  attackerName: string,
  defender: PokemonSet,
  defenderName: string,
  move: string,
  result: DamageResult,
  category: 'Physical' | 'Special' | 'Status',
): string {
  const atkStat: StatID = category === 'Special' ? 'spa' : 'atk';
  const defStat: StatID = category === 'Special' ? 'spd' : 'def';
  const atkPart = `${spNotation(attacker, atkStat)} ${category === 'Special' ? 'SpA' : 'Atk'}`;
  const defPart = `${spNotation(defender, 'hp')} HP / ${spNotation(defender, defStat)} ${
    category === 'Special' ? 'SpD' : 'Def'
  }`;
  return (
    `${atkPart} ${attackerName} ${move} vs. ${defPart} ${defenderName}: ` +
    `${result.min}-${result.max} (${result.minPct.toFixed(1)} - ${result.maxPct.toFixed(1)}%) — ${result.koText}`
  );
}

const EMPTY: DamageResult = {
  min: 0, max: 0, minPct: 0, maxPct: 0, koText: 'no damage', koChance: 0,
  hitsToKO: 0, desc: '', moveName: '',
};

export function calcDamage(
  attackerSet: PokemonSet,
  defenderSet: PokemonSet,
  moveName: string,
  format: FormatRules,
  field: FieldState,
  attackerState: CombatantState = defaultCombatant(),
  defenderState: CombatantState = defaultCombatant(),
  options: CalcOptions = {},
): DamageResult | null {
  const move = getMove(moveName);
  if (!move) return null;
  if (move.category === 'Status') return { ...EMPTY, moveName: move.name };

  const attacker = toCalcPokemon(attackerSet, format, attackerState);
  const defender = toCalcPokemon(defenderSet, format, defenderState);
  if (!attacker || !defender) return null;

  const smove = new smogon.Move(gen, move.name, {
    isCrit: options.isCrit,
    hits: options.hits,
    useMax: false,
  });
  // @smogon/calc applies the 0.75 spread modifier from the field's game type.
  const effectiveField = options.singleTarget && field.gameType === 'Doubles'
    ? { ...field, gameType: 'Singles' as const }
    : field;

  let result: smogon.Result;
  try {
    result = smogon.calculate(gen, attacker, defender, smove, toSmogonField(effectiveField));
  } catch {
    return { ...EMPTY, moveName: move.name };
  }

  let range: [number, number];
  try {
    range = result.range();
  } catch {
    return { ...EMPTY, moveName: move.name };
  }
  const maxHP = defender.maxHP();
  const out: DamageResult = {
    min: range[0],
    max: range[1],
    minPct: (range[0] / maxHP) * 100,
    maxPct: (range[1] / maxHP) * 100,
    koText: 'no damage',
    koChance: 0,
    hitsToKO: 0,
    desc: '',
    moveName: move.name,
  };

  if (range[1] > 0) {
    try {
      const ko = result.kochance();
      out.koText = ko.text || '';
      out.koChance = ko.chance ?? (ko.n === 1 && range[0] >= maxHP ? 1 : 0);
      out.hitsToKO = ko.n ?? Math.ceil(maxHP / Math.max(1, range[1]));
    } catch {
      out.hitsToKO = Math.ceil(maxHP / Math.max(1, range[1]));
      out.koText = `${out.hitsToKO}HKO`;
    }
  }

  const aForm = resolveForm(attackerSet, format);
  const dForm = resolveForm(defenderSet, format);
  out.desc = describe(
    attackerSet,
    displayName(aForm?.species.name ?? attackerSet.species),
    defenderSet,
    displayName(dForm?.species.name ?? defenderSet.species),
    move.name,
    out,
    move.category as 'Physical' | 'Special',
  );
  return out;
}

/** "Charizard-Mega-Y" -> "Mega Charizard Y" for human-facing text. */
export function displayName(name: string): string {
  const m = /^(.*)-Mega(?:-([XYZ]))?$/.exec(name);
  if (!m) return name;
  return `Mega ${m[1]}${m[2] ? ` ${m[2]}` : ''}`;
}

export interface MoveDamage {
  move: string;
  result: DamageResult;
}

/** Every damaging move of `attacker` against `defender`, strongest first. */
export function calcAllMoves(
  attackerSet: PokemonSet,
  defenderSet: PokemonSet,
  format: FormatRules,
  field: FieldState,
  attackerState?: CombatantState,
  defenderState?: CombatantState,
): MoveDamage[] {
  const out: MoveDamage[] = [];
  for (const move of attackerSet.moves) {
    if (!move) continue;
    const m = getMove(move);
    if (!m || m.category === 'Status') continue;
    const result = calcDamage(
      attackerSet, defenderSet, move, format, field, attackerState, defenderState,
    );
    if (result) out.push({ move, result });
  }
  return out.sort((a, b) => b.result.maxPct - a.result.maxPct);
}

export function bestMove(
  attackerSet: PokemonSet,
  defenderSet: PokemonSet,
  format: FormatRules,
  field: FieldState,
  attackerState?: CombatantState,
  defenderState?: CombatantState,
): MoveDamage | null {
  const all = calcAllMoves(
    attackerSet, defenderSet, format, field, attackerState, defenderState,
  );
  if (!all.length) return null;
  // Prefer a guaranteed KO in fewer hits over raw percentage.
  return all.sort((a, b) => {
    const ah = a.result.hitsToKO || 99;
    const bh = b.result.hitsToKO || 99;
    if (ah !== bh) return ah - bh;
    return b.result.maxPct - a.result.maxPct;
  })[0];
}

export function maxHPOf(set: PokemonSet, format: FormatRules): number {
  const mon = toCalcPokemon(set, format);
  return mon ? mon.maxHP() : 0;
}

export function statsOf(set: PokemonSet, format: FormatRules): StatsTable | null {
  return resolveForm(set, format) ? computeStats(set, format) : null;
}

export function moveCategoryOf(moveName: string): 'Physical' | 'Special' | 'Status' {
  return (getMove(moveName)?.category ?? 'Status') as 'Physical' | 'Special' | 'Status';
}

export function speciesTypes(name: string): string[] {
  return [...(getSpecies(name)?.types ?? [])];
}
