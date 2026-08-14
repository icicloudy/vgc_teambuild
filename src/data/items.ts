import { allItems, getSpecies, megasFor, toID } from './dex';
import type { Item } from './dex';

/**
 * The item list, arranged the way a builder thinks about it.
 *
 * Two things are going on here. The dataset already drops anything a Champions
 * battle cannot use — evolution stones, Z-Crystals, fossils, the Gen 2 drawer,
 * the berries that only lower EVs (see `battleItem` in scripts/build-dataset.mjs).
 * This file handles the rest: grouping what remains, and putting the twenty or so
 * items that actually decide games at the top instead of leaving Absorb Bulb and
 * Assault Vest to argue it out alphabetically.
 */

export type ItemCategory = 'mega' | 'staple' | 'utility' | 'berry' | 'boost' | 'species';

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
 * The items VGC actually runs, most common first. Hand-ordered: no usage
 * statistics exist for Champions, and this ordering is only a default — the
 * search box still finds anything by name.
 */
const STAPLES = [
  'assaultvest', 'sitrusberry', 'focussash', 'choicescarf', 'safetygoggles',
  'lifeorb', 'leftovers', 'covertcloak', 'clearamulet', 'choicespecs', 'choiceband',
  'rockyhelmet', 'mentalherb', 'weaknesspolicy', 'lumberry', 'eviolite', 'widelens',
  'lightclay', 'expertbelt', 'airballoon', 'ejectbutton', 'ejectpack', 'roomservice',
  'loadeddice', 'punchingglove', 'throatspray', 'mirrorherb', 'powerherb', 'whiteherb',
  'protectivepads', 'utilityumbrella', 'zoomlens', 'ironball',
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
export function itemCatalogue(species?: string): CatalogueEntry[] {
  const stones = new Set(species ? megasFor(species).map((m) => m.stoneId) : []);
  const names = new Set<string>();
  if (species) {
    const dexSpecies = getSpecies(species);
    names.add(toID(dexSpecies?.name ?? species));
    if (dexSpecies?.baseSpecies) names.add(toID(dexSpecies.baseSpecies));
    // A Mega Stone's user is the base forme, so include every forme in the family.
    for (const mega of megasFor(species)) names.add(toID(mega.forme));
  }

  const out: CatalogueEntry[] = [];
  for (const item of allItems()) {
    if (item.megaStone && !stones.has(item.id)) continue;
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
