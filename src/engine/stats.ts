import type { Species } from '@pkmn/dex';
import type { FormatRules, PokemonSet, StatID, StatsTable } from '../types';
import { STATS } from '../types';
import { getSpecies, megaFromItem, natureModifier, toID } from '../data/dex';
import type { MegaOption } from '../data/dex';

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
  const ability = mega
    ? (Object.values(mega.species.abilities)[0] as string)
    : set.ability || (Object.values(base.abilities)[0] as string);

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

export function statAt(
  stat: StatID,
  baseStat: number,
  iv: number,
  ev: number,
  level: number,
  nature: string,
): number {
  if (stat === 'hp') {
    if (baseStat === 1) return 1; // Shedinja
    return Math.floor(((2 * baseStat + iv + Math.floor(ev / 4)) * level) / 100) + level + 10;
  }
  const raw = Math.floor(((2 * baseStat + iv + Math.floor(ev / 4)) * level) / 100) + 5;
  return Math.floor(raw * natureModifier(nature, stat));
}

export function computeStats(set: PokemonSet, format: FormatRules): StatsTable {
  const form = resolveForm(set, format);
  const out = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 } as StatsTable;
  if (!form) return out;
  for (const s of STATS) {
    out[s] = statAt(s, form.baseStats[s], set.ivs[s] ?? 31, set.evs[s] ?? 0, set.level, set.nature);
  }
  return out;
}

export function evTotal(evs: StatsTable): number {
  return STATS.reduce((sum, s) => sum + (evs[s] ?? 0), 0);
}

export const MAX_EV_TOTAL = 508;
export const MAX_EV_SINGLE = 252;

/** EVs above a 4-step boundary do nothing at level 50 — report the waste. */
export function wastedEVs(evs: StatsTable): StatID[] {
  return STATS.filter((s) => (evs[s] ?? 0) % 4 !== 0 && (evs[s] ?? 0) !== 252);
}

/** Smallest EV investment that reaches `target` for a stat, or null if impossible. */
export function evsNeededFor(
  stat: StatID,
  target: number,
  baseStat: number,
  iv: number,
  level: number,
  nature: string,
): number | null {
  for (let ev = 0; ev <= MAX_EV_SINGLE; ev += 4) {
    if (statAt(stat, baseStat, iv, ev, level, nature) >= target) return ev;
  }
  return null;
}
