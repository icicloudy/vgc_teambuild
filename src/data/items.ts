import { allItems, getSpecies, megasFor, toID } from './dex';
import type { Item } from './dex';
import { CHAMPIONS_ITEM_POOL, KNOWN_ABSENT_ITEMS } from './champions';
import type { FormatRules } from '../types';

/**
 * The item list, arranged the way a builder thinks about it.
 *
 * Three filters stack. The dataset drops anything no battle can use — evolution
 * stones, Z-Crystals, fossils, the Gen 2 drawer (see `battleItem` in
 * scripts/build-dataset.mjs). This file then drops anything Champions itself does
 * not ship, which is a much shorter list than the dex suggests: no Assault Vest,
 * no Choice Band, no Weakness Policy. What survives is grouped, with the items
 * that actually decide Regulation M-B games at the top instead of leaving Absorb
 * Bulb and Aguav Berry to argue it out alphabetically.
 */

export type ItemCategory = 'mega' | 'staple' | 'utility' | 'berry' | 'boost' | 'species';

/** Is this item in the pool Champions actually ships? */
export function inChampionsPool(item: Item): boolean {
  return !!item.megaStone || CHAMPIONS_ITEM_POOL.has(item.id);
}

/** Why an item is unavailable, when we can say something specific. */
export function itemAbsenceNote(itemName: string): string {
  const id = toID(itemName);
  return KNOWN_ABSENT_ITEMS[id] ??
    `${itemName} is not in the Champions item pool for this regulation.`;
}

export const ITEM_CATEGORY_LABEL: Record<ItemCategory, string> = {
  mega: 'Mega Stone',
  staple: 'Commonly used',
  utility: 'Utility',
  berry: 'Berries',
  boost: 'Type boosters',
  species: 'Species-specific',
};

const CATEGORY_ORDER: ItemCategory[] = ['mega', 'staple', 'utility', 'berry', 'boost', 'species'];

/**
 * Ordered by what Regulation M-B ladder data actually shows on Pokémon, not by
 * what a Scarlet/Violet player would expect: Sitrus and the resist berries carry
 * this format, and the flat type boosters do the job Life Orb used to.
 */
const STAPLES = [
  'sitrusberry', 'focussash', 'lifeorb', 'leftovers', 'choicescarf', 'lumberry',
  'mentalherb', 'whiteherb', 'safetygoggles', 'covertcloak', 'clearamulet',
  'rockyhelmet', 'choicespecs', 'widelens', 'lightclay', 'muscleband', 'wiseglasses',
  'zoomlens', 'damprock', 'heatrock', 'icyrock', 'smoothrock', 'eviolite',
];
const STAPLE_RANK = new Map(STAPLES.map((id, i) => [id, i]));

/** Flat type-boosting items: the plates and their older cousins. */
const TYPE_BOOSTERS = new Set([
  'blackbelt', 'blackglasses', 'charcoal', 'dragonfang', 'fairyfeather', 'hardstone',
  'magnet', 'miracleseed', 'mysticwater', 'nevermeltice', 'poisonbarb', 'sharpbeak',
  'silkscarf', 'silverpowder', 'softsand', 'spelltag', 'twistedspoon', 'metalcoat',
  'dracoplate', 'dreadplate', 'earthplate', 'fistplate', 'flameplate', 'icicleplate',
  'insectplate', 'ironplate', 'meadowplate', 'mindplate', 'pixieplate', 'skyplate',
  'splashplate', 'spookyplate', 'stoneplate', 'toxicplate', 'zapplate',
]);

export function itemCategory(item: Item): ItemCategory {
  if (item.megaStone) return 'mega';
  if (STAPLE_RANK.has(item.id)) return 'staple';
  if (item.user?.length) return 'species';
  if (TYPE_BOOSTERS.has(item.id)) return 'boost';
  if (item.berry) return 'berry';
  return 'utility';
}

export interface CatalogueEntry {
  item: Item;
  category: ItemCategory;
}

/**
 * Every item this Pokémon could sensibly hold, grouped and ordered.
 *
 * Passing a species hides the noise that can never apply to it: other Pokémon's
 * Mega Stones, and the species-locked items (Light Ball, Thick Club, the Orbs)
 * that do nothing in anyone else's hands.
 */
export function itemCatalogue(species?: string, format?: FormatRules): CatalogueEntry[] {
  const stones = new Set(species ? megasFor(species).map((m) => m.stoneId) : []);
  const names = new Set<string>();
  if (species) {
    const dexSpecies = getSpecies(species);
    names.add(toID(dexSpecies?.name ?? species));
    if (dexSpecies?.baseSpecies) names.add(toID(dexSpecies.baseSpecies));
    // A Mega Stone's user is the base forme, so include every forme in the family.
    for (const mega of megasFor(species)) names.add(toID(mega.forme));
  }

  const restricted = (format?.itemPool ?? 'champions') === 'champions';
  const out: CatalogueEntry[] = [];
  for (const item of allItems()) {
    if (item.megaStone && !stones.has(item.id)) continue;
    // Outside the sandbox format, only offer what the game ships. An item that
    // cannot be equipped is worse than useless in a builder — it invents spreads.
    if (restricted && !inChampionsPool(item)) continue;
    if (species && item.user?.length && !item.megaStone) {
      if (!item.user.some((u) => names.has(toID(u)))) continue;
    }
    out.push({ item, category: itemCategory(item) });
  }

  return out.sort((a, b) => {
    const ca = CATEGORY_ORDER.indexOf(a.category);
    const cb = CATEGORY_ORDER.indexOf(b.category);
    if (ca !== cb) return ca - cb;
    if (a.category === 'staple') {
      return (STAPLE_RANK.get(a.item.id) ?? 99) - (STAPLE_RANK.get(b.item.id) ?? 99);
    }
    return a.item.name.localeCompare(b.item.name);
  });
}
