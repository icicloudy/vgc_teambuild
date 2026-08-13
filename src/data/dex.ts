import { Dex } from '@pkmn/dex';
import type { Species, Move, Item, Ability } from '@pkmn/dex';
import { Generations as CalcGenerations } from '@smogon/calc';
import type { StatID } from '../types';

/** Damage-calculator view of Gen 9 (Champions runs on Gen 9 mechanics). */
export const calcGen = CalcGenerations.get(9);

export const TYPES = [
  'Normal', 'Fire', 'Water', 'Electric', 'Grass', 'Ice', 'Fighting', 'Poison', 'Ground',
  'Flying', 'Psychic', 'Bug', 'Rock', 'Ghost', 'Dragon', 'Dark', 'Steel', 'Fairy',
] as const;

export type TypeName = (typeof TYPES)[number];

export const NATURES = [
  'Adamant', 'Bashful', 'Bold', 'Brave', 'Calm', 'Careful', 'Docile', 'Gentle', 'Hardy',
  'Hasty', 'Impish', 'Jolly', 'Lax', 'Lonely', 'Mild', 'Modest', 'Naive', 'Naughty',
  'Quiet', 'Quirky', 'Rash', 'Relaxed', 'Sassy', 'Serious', 'Timid',
];

export function toID(s: string): string {
  return ('' + s).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

export function getSpecies(name: string): Species | null {
  if (!name) return null;
  const s = Dex.species.get(name);
  return s && s.exists ? s : null;
}

export function getMove(name: string): Move | null {
  if (!name) return null;
  const m = Dex.moves.get(name);
  return m && m.exists ? m : null;
}

export function getItem(name: string): Item | null {
  if (!name) return null;
  const i = Dex.items.get(name);
  return i && i.exists ? i : null;
}

export function getAbility(name: string): Ability | null {
  if (!name) return null;
  const a = Dex.abilities.get(name);
  return a && a.exists ? a : null;
}

/* ------------------------------------------------------------------ *
 * Type effectiveness
 * ------------------------------------------------------------------ */

// Showdown encodes damageTaken as 0 = neutral, 1 = super effective, 2 = resisted, 3 = immune.
const DAMAGE_TAKEN_MULTIPLIER: Record<number, number> = { 0: 1, 1: 2, 2: 0.5, 3: 0 };

export function typeEffect(attacking: string, defending: string): number {
  const def = Dex.types.get(defending);
  if (!def || !def.exists) return 1;
  const code = def.damageTaken[attacking];
  return code === undefined ? 1 : (DAMAGE_TAKEN_MULTIPLIER[code] ?? 1);
}

export function effectiveness(attacking: string, defTypes: readonly string[]): number {
  return defTypes.reduce((acc, t) => acc * typeEffect(attacking, t), 1);
}

/* ------------------------------------------------------------------ *
 * Mega Evolution registry
 * ------------------------------------------------------------------ */

export interface MegaOption {
  /** Forme name, e.g. "Charizard-Mega-Y". */
  forme: string;
  /** Item that triggers it, e.g. "Charizardite Y". */
  stone: string;
  stoneId: string;
  species: Species;
  /** True for Champions-era megas that do not exist in the Gen 6/7 games. */
  isNew: boolean;
}

const megasByBase = new Map<string, MegaOption[]>();
const megaByStone = new Map<string, MegaOption>();

function buildMegaRegistry() {
  for (const item of Dex.items.all()) {
    if (!item.megaStone) continue;
    // megaStone maps base species name -> mega forme name.
    for (const [base, forme] of Object.entries(item.megaStone as Record<string, string>)) {
      const species = Dex.species.get(forme);
      if (!species || !species.exists) continue;
      const opt: MegaOption = {
        forme: species.name,
        stone: item.name,
        stoneId: item.id,
        species,
        isNew: species.isNonstandard === 'Future',
      };
      const key = toID(base);
      if (!megasByBase.has(key)) megasByBase.set(key, []);
      megasByBase.get(key)!.push(opt);
      megaByStone.set(item.id, opt);
    }
  }
}
buildMegaRegistry();

export function megasFor(speciesName: string): MegaOption[] {
  return megasByBase.get(toID(speciesName)) ?? [];
}

export function hasMega(speciesName: string): boolean {
  return megasFor(speciesName).length > 0;
}

export function megaFromItem(speciesName: string, itemName: string): MegaOption | null {
  if (!itemName) return null;
  const opt = megaByStone.get(toID(itemName));
  if (!opt) return null;
  // A stone only works on its own species.
  return megasFor(speciesName).some((m) => m.stoneId === opt.stoneId) ? opt : null;
}

export function allMegaStones(): Item[] {
  return Dex.items.all().filter((i) => !!i.megaStone);
}

/* ------------------------------------------------------------------ *
 * Species catalogue
 * ------------------------------------------------------------------ */

export type SpeciesTag =
  | 'Restricted Legendary'
  | 'Sub-Legendary'
  | 'Mythical'
  | 'Paradox'
  | 'Ultra Beast';

export function speciesTags(s: Species): SpeciesTag[] {
  return [...(s.tags ?? [])] as SpeciesTag[];
}

/** Every base forme that could plausibly be selected in a builder. */
export function allSelectableSpecies(): Species[] {
  const out: Species[] = [];
  for (const s of Dex.species.all()) {
    if (s.forme && (s.forme.startsWith('Mega') || s.forme === 'Primal')) continue;
    if (s.isNonstandard && s.isNonstandard !== 'Future') continue;
    if (s.isCosmeticForme) continue;
    if (s.num <= 0) continue;
    out.push(s);
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Base stat total helper that tolerates missing data. */
export function bst(s: Species): number {
  return (Object.values(s.baseStats) as number[]).reduce((a, b) => a + b, 0);
}

/* ------------------------------------------------------------------ *
 * Learnsets (lazy, cached)
 * ------------------------------------------------------------------ */

const learnsetCache = new Map<string, string[]>();
const learnsetPending = new Map<string, Promise<string[]>>();

async function fetchLearnset(speciesName: string): Promise<string[]> {
  const species = getSpecies(speciesName);
  if (!species) return [];

  const ids = new Set<string>();
  // Walk up through pre-evolutions and the base forme so transferred Pokémon keep
  // everything they could legally have learned before arriving in Champions.
  const queue: string[] = [species.name];
  const seen = new Set<string>();
  while (queue.length) {
    const name = queue.shift()!;
    if (seen.has(toID(name))) continue;
    seen.add(toID(name));
    const cur = getSpecies(name);
    if (!cur) continue;
    try {
      const ls = await Dex.learnsets.get(cur.id);
      if (ls?.learnset) for (const id of Object.keys(ls.learnset)) ids.add(id);
    } catch {
      /* species without learnset data */
    }
    if (cur.prevo) queue.push(cur.prevo);
    if (cur.baseSpecies && cur.baseSpecies !== cur.name) queue.push(cur.baseSpecies);
    if (cur.changesFrom) queue.push(cur.changesFrom as string);
  }

  const names: string[] = [];
  for (const id of ids) {
    const move = Dex.moves.get(id);
    if (!move?.exists) continue;
    if (move.isNonstandard && move.isNonstandard !== 'Future') continue; // drops Past-only moves
    names.push(move.name);
  }
  return names.sort((a, b) => a.localeCompare(b));
}

export function learnsetSync(speciesName: string): string[] | null {
  return learnsetCache.get(toID(speciesName)) ?? null;
}

export async function loadLearnset(speciesName: string): Promise<string[]> {
  const key = toID(speciesName);
  const cached = learnsetCache.get(key);
  if (cached) return cached;
  const pending = learnsetPending.get(key);
  if (pending) return pending;
  const p = fetchLearnset(speciesName).then((moves) => {
    learnsetCache.set(key, moves);
    learnsetPending.delete(key);
    return moves;
  });
  learnsetPending.set(key, p);
  return p;
}

/* ------------------------------------------------------------------ *
 * Sprites
 * ------------------------------------------------------------------ */

/**
 * Showdown sprite id. Champions-exclusive megas have no sprite upstream yet, so
 * callers should render the monogram fallback when the image fails to load.
 */
export function spriteId(speciesName: string): string {
  const s = getSpecies(speciesName);
  if (!s) return '0';
  return s.name
    .toLowerCase()
    .replace(/[.'’ ]/g, '')
    .replace(/-mega-([xyz])/, '-mega$1')
    .replace(/-/g, '-');
}

export function spriteUrl(speciesName: string): string {
  return `https://play.pokemonshowdown.com/sprites/gen5/${spriteId(speciesName)}.png`;
}

export function itemSpriteUrl(itemName: string): string {
  return `https://play.pokemonshowdown.com/sprites/itemicons/${toID(itemName).replace(/(\d)/g, '-$1')}.png`;
}

/* ------------------------------------------------------------------ *
 * Misc lookups
 * ------------------------------------------------------------------ */

export function abilitiesFor(speciesName: string): string[] {
  const s = getSpecies(speciesName);
  if (!s) return [];
  return [...new Set(Object.values(s.abilities).filter(Boolean))] as string[];
}

export function allItems(): Item[] {
  return Dex.items
    .all()
    .filter((i) => i.exists && (!i.isNonstandard || i.isNonstandard === 'Future') && i.num >= 0)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function natureModifier(nature: string, stat: StatID): number {
  const n = Dex.natures.get(nature);
  if (!n || !n.exists) return 1;
  if (n.plus === stat) return 1.1;
  if (n.minus === stat) return 0.9;
  return 1;
}

export function natureLabel(nature: string): string {
  const n = Dex.natures.get(nature);
  if (!n?.exists || !n.plus || !n.minus) return `${nature} (neutral)`;
  const short: Record<string, string> = {
    atk: 'Atk', def: 'Def', spa: 'SpA', spd: 'SpD', spe: 'Spe',
  };
  return `${nature} (+${short[n.plus]} / -${short[n.minus]})`;
}

export { Dex };
