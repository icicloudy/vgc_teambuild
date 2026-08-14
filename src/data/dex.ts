import { Generations as CalcGenerations } from '@smogon/calc';
import type { StatID, StatsTable } from '../types';
import raw from './generated/dex-data.json';

/**
 * Dex access for the app.
 *
 * The data comes from `src/data/generated/dex-data.json`, produced by
 * `npm run data` from @pkmn/dex. Generating it keeps ~4.8 MB of multi-generation
 * Pokédex out of the bundle: only the species a Champions team can contain, the
 * moves they can carry (learnsets pre-merged across pre-evolutions) and the
 * fields this app reads actually ship.
 */

/** Damage-calculator view of Gen 9 (Champions runs on Gen 9 mechanics). */
export const calcGen = CalcGenerations.get(9);

export const TYPES = [
  'Normal', 'Fire', 'Water', 'Electric', 'Grass', 'Ice', 'Fighting', 'Poison', 'Ground',
  'Flying', 'Psychic', 'Bug', 'Rock', 'Ghost', 'Dragon', 'Dark', 'Steel', 'Fairy',
] as const;

export type TypeName = (typeof TYPES)[number];

export interface Species {
  id: string;
  name: string;
  num: number;
  types: string[];
  baseStats: StatsTable;
  /** Ordered; the first entry is the default ability. */
  abilities: string[];
  weightkg: number;
  tags?: string[];
  isNonstandard?: string;
  forme?: string;
  /** Only present on alternate formes. */
  baseSpecies?: string;
  prevo?: string;
  nfe?: boolean;
  doublesTier?: string;
  requiredItem?: string;
  /** A base forme a builder can pick, as opposed to a Mega/Primal result. */
  selectable?: boolean;
}

export interface Move {
  id: string;
  name: string;
  type: string;
  category: 'Physical' | 'Special' | 'Status';
  basePower: number;
  /** `true` means the move never misses. */
  accuracy: number | true;
  target: string;
  priority: number;
  shortDesc: string;
  isNonstandard?: string;
}

export interface Item {
  id: string;
  name: string;
  num: number;
  shortDesc: string;
  /** Base species name -> Mega forme name. */
  megaStone?: Record<string, string>;
  isNonstandard?: string;
  berry?: boolean;
  /** Choice Band / Specs / Scarf: locks the holder into one move. */
  choice?: boolean;
  /** Species this item only works for, if any. */
  user?: string[];
}

export interface Ability {
  id: string;
  name: string;
}

interface DexData {
  species: Species[];
  moves: Move[];
  items: Item[];
  abilities: Ability[];
  types: Record<string, Record<string, number>>;
  natures: Record<string, { plus?: StatID; minus?: StatID }>;
  /** Species id -> indices into `moves`. */
  learnsets: Record<string, number[]>;
  /** Alias id -> species id. */
  aliases: Record<string, string>;
}

const data = raw as unknown as DexData;

export const NATURES = Object.keys(data.natures).sort();

export function toID(s: string): string {
  return ('' + s).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/* ------------------------------------------------------------------ *
 * Lookups
 * ------------------------------------------------------------------ */

const speciesById = new Map<string, Species>(data.species.map((s) => [s.id, s]));
const movesById = new Map<string, Move>(data.moves.map((m) => [m.id, m]));
const itemsById = new Map<string, Item>(data.items.map((i) => [i.id, i]));
const abilitiesById = new Map<string, Ability>(data.abilities.map((a) => [a.id, a]));

export function getSpecies(name: string): Species | null {
  if (!name) return null;
  const id = toID(name);
  const direct = speciesById.get(id);
  if (direct) return direct;
  // "Mega Charizard Y", "Landorus-T", "Ttar" and friends.
  const alias = data.aliases[id];
  return alias ? speciesById.get(alias) ?? null : null;
}

export function getMove(name: string): Move | null {
  return name ? movesById.get(toID(name)) ?? null : null;
}

export function getItem(name: string): Item | null {
  return name ? itemsById.get(toID(name)) ?? null : null;
}

export function getAbility(name: string): Ability | null {
  return name ? abilitiesById.get(toID(name)) ?? null : null;
}

export function getNature(name: string): { name: string; plus?: StatID; minus?: StatID } | null {
  if (!name) return null;
  const key = Object.keys(data.natures).find((n) => toID(n) === toID(name));
  return key ? { name: key, ...data.natures[key] } : null;
}

/* ------------------------------------------------------------------ *
 * Type effectiveness
 * ------------------------------------------------------------------ */

// Showdown encodes damageTaken as 0 = neutral, 1 = super effective, 2 = resisted, 3 = immune.
const DAMAGE_TAKEN_MULTIPLIER: Record<number, number> = { 0: 1, 1: 2, 2: 0.5, 3: 0 };

export function typeEffect(attacking: string, defending: string): number {
  const taken = data.types[defending];
  if (!taken) return 1;
  const code = taken[attacking];
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

for (const item of data.items) {
  if (!item.megaStone) continue;
  for (const [base, forme] of Object.entries(item.megaStone)) {
    const species = getSpecies(forme);
    if (!species) continue;
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
  return data.items.filter((i) => !!i.megaStone);
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

const selectable = data.species
  // A Mega forme is a result, never a choice: you pick the base and hold the stone.
  // Belt and braces against a stale dataset, since a Mega leaking into the picker
  // would be selectable but unbuildable.
  .filter((s) => s.selectable && !/(^|-)Mega/.test(s.forme ?? ''))
  .sort((a, b) => a.name.localeCompare(b.name));

/** Every base forme that could plausibly be selected in a builder. */
export function allSelectableSpecies(): Species[] {
  return selectable;
}

export function bst(s: Species): number {
  return (Object.values(s.baseStats) as number[]).reduce((a, b) => a + b, 0);
}

/* ------------------------------------------------------------------ *
 * Learnsets
 *
 * Pre-merged at generation time across pre-evolutions and base formes, so a
 * Pokémon transferred into Champions keeps what it could learn earlier. The
 * async entry point is kept for callers that were written against the old lazy
 * loader; it now resolves immediately.
 * ------------------------------------------------------------------ */

const learnsetCache = new Map<string, string[]>();

function resolveLearnset(speciesName: string): string[] {
  const species = getSpecies(speciesName);
  if (!species) return [];
  const cached = learnsetCache.get(species.id);
  if (cached) return cached;

  // Mega formes share their base species' movepool.
  const key = data.learnsets[species.id]
    ? species.id
    : toID(species.baseSpecies ?? species.name);
  const indices = data.learnsets[key] ?? [];
  const names = indices
    .map((i) => data.moves[i]?.name)
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
  learnsetCache.set(species.id, names);
  return names;
}

export function learnsetSync(speciesName: string): string[] | null {
  const species = getSpecies(speciesName);
  return species ? resolveLearnset(speciesName) : null;
}

export async function loadLearnset(speciesName: string): Promise<string[]> {
  return resolveLearnset(speciesName);
}

/* ------------------------------------------------------------------ *
 * Sprites
 * ------------------------------------------------------------------ */

/**
 * Showdown sprite id. Champions-exclusive megas have no sprite upstream yet, so
 * callers render the type-coloured fallback when the image fails to load.
 */
export function spriteId(speciesName: string): string {
  const s = getSpecies(speciesName);
  if (!s) return '0';
  return s.name
    .toLowerCase()
    .replace(/[.'’ ]/g, '')
    .replace(/-mega-([xyz])/, '-mega$1');
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
  return [...(getSpecies(speciesName)?.abilities ?? [])];
}

// The dataset already excludes fan-made and unobtainable items; everything left is
// usable in Champions, including the legacy Mega Stones the dex marks as "Past".
const usableItems = [...data.items]
  .filter((i) => i.num >= 0)
  .sort((a, b) => a.name.localeCompare(b.name));

export function allItems(): Item[] {
  return usableItems;
}

export function natureModifier(nature: string, stat: StatID): number {
  const n = getNature(nature);
  if (!n) return 1;
  if (n.plus === stat) return 1.1;
  if (n.minus === stat) return 0.9;
  return 1;
}

export function natureLabel(nature: string): string {
  const n = getNature(nature);
  if (!n?.plus || !n.minus) return `${nature} (neutral)`;
  const short: Record<string, string> = {
    atk: 'Atk', def: 'Def', spa: 'SpA', spd: 'SpD', spe: 'Spe',
  };
  return `${nature} (+${short[n.plus]} / -${short[n.minus]})`;
}
