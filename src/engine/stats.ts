import type { FormatRules, PokemonSet, StatID, StatsTable } from '../types';
import { CHAMPIONS_IV, STATS } from '../types';
import { getSpecies, megaFromItem, natureModifier, toID } from '../data/dex';
import type { MegaOption, Species } from '../data/dex';

export interface ResolvedForm {
  /** The forme actually on the field: the Mega when a valid stone is held. */
  species: Species;
  /** The team-preview forme. */
  base: Species;
  mega: MegaOption | null;
  types: string[];
  ability: string;
  baseStats: StatsTable;
  weightkg: number;
}

/**
 * Resolve what a set actually turns into in battle. A held Mega Stone implies the
 * Mega forme (that is how Champions works — the stone is the trigger), unless the
 * format forbids Mega Evolution or that specific Mega.
 */
export function resolveForm(set: PokemonSet, format: FormatRules): ResolvedForm | null {
  const base = getSpecies(set.species);
  if (!base) return null;

  let mega = megaFromItem(set.species, set.item);
  if (mega) {
    const banned =
      format.megaPerBattle < 1 ||
      format.bannedMegas.some((b) => toID(b) === toID(mega!.forme)) ||
      format.bannedSpecies.some((b) => toID(b) === toID(mega!.forme));
    if (banned) mega = null;
  }

  const species = mega ? mega.species : base;
  const ability = mega ? mega.species.abilities[0] : set.ability || base.abilities[0];

  return {
    species,
    base,
    mega,
    types: [...species.types],
    ability,
    baseStats: { ...species.baseStats } as StatsTable,
    weightkg: species.weightkg,
  };
}

/* ------------------------------------------------------------------ *
 * Stat Points
 * ------------------------------------------------------------------ */

/** Total Stat Points a Pokémon may spend. */
export const MAX_SP_TOTAL = 66;
/** Ceiling on any single stat. */
export const MAX_SP_PER_STAT = 32;

/**
 * The stat a Pokémon has before any Stat Points are spent: the mainline formula
 * with 31 IVs and no EVs, which is what every Champions Pokémon starts from.
 */
export function baseStatValue(
  stat: StatID,
  baseStat: number,
  level: number,
  nature: string,
): number {
  if (stat === 'hp') {
    if (baseStat === 1) return 1; // Shedinja
    return Math.floor(((2 * baseStat + CHAMPIONS_IV) * level) / 100) + level + 10;
  }
  const raw = Math.floor(((2 * baseStat + CHAMPIONS_IV) * level) / 100) + 5;
  return Math.floor(raw * natureModifier(nature, stat));
}

/**
 * Final stat = the un-invested stat, plus one point per Stat Point.
 *
 * Champions states that 1 SP is exactly +1 to the stat, so SP are added *after*
 * the Nature multiplier — a boosting Nature scales the base value, not the points.
 * That ordering is the one part of the formula not published in a form this app
 * can verify, and it is isolated here so it is a one-line change if it is wrong.
 */
export function statAt(
  stat: StatID,
  baseStat: number,
  sp: number,
  level: number,
  nature: string,
): number {
  const base = baseStatValue(stat, baseStat, level, nature);
  if (stat === 'hp' && baseStat === 1) return 1;
  return base + Math.max(0, Math.min(MAX_SP_PER_STAT, sp));
}

export function computeStats(set: PokemonSet, format: FormatRules): StatsTable {
  const form = resolveForm(set, format);
  const out = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 } as StatsTable;
  if (!form) return out;
  for (const s of STATS) {
    out[s] = statAt(s, form.baseStats[s], set.sp[s] ?? 0, set.level, set.nature);
  }
  return out;
}

export function spTotal(sp: StatsTable): number {
  return STATS.reduce((sum, s) => sum + (sp[s] ?? 0), 0);
}

export function spRemaining(sp: StatsTable): number {
  return MAX_SP_TOTAL - spTotal(sp);
}

/** Stat Points needed to reach `target`, or null if it is out of reach. */
export function spNeededFor(
  stat: StatID,
  target: number,
  baseStat: number,
  level: number,
  nature: string,
): number | null {
  const base = baseStatValue(stat, baseStat, level, nature);
  const needed = target - base;
  if (needed <= 0) return 0;
  return needed <= MAX_SP_PER_STAT ? needed : null;
}
