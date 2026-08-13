import type { FormatRules, RosterConfidence, SpeciesCategory } from '../types';
import { allSelectableSpecies, getSpecies, hasMega, megasFor, toID } from './dex';
import type { Species } from './dex';

/**
 * Champions ships a curated roster (208 species / 75 Megas as of Reg M-B) rather
 * than the full National Dex. That list is not published in machine-readable form
 * and this app runs entirely offline, so the roster is modelled in three layers:
 *
 *  1. Category rules from the regulation (no Legendary / Mythical / Paradox / …)
 *     — these are hard rules and produce legality *errors*.
 *  2. A confirmed set, derived from data we can actually verify: every species with
 *     a Champions Mega Stone, plus species named in official format coverage.
 *  3. Everything else — selectable, but badged "unverified" so you know to check
 *     it in-game.
 *
 * Paste the in-game list into the Roster panel to replace layers 2 and 3 with the
 * real thing; it is stored locally and treated as authoritative from then on.
 */

/** Species named directly in official/major coverage of Champions ranked play. */
const REPORTED_IN_GAME = [
  'Incineroar', 'Kingambit', 'Garchomp', 'Charizard', 'Metagross', 'Mawile', 'Swampert',
  'Sceptile', 'Blaziken', 'Staraptor', 'Gengar', 'Tyranitar', 'Salamence', 'Venusaur',
  'Blastoise', 'Greninja', 'Chesnaught', 'Delphox', 'Baxcalibur', 'Zeraora', 'Raichu',
  'Absol', 'Lucario', 'Dragonite', 'Clefable',
];

/** Species that are Mega-capable but are Legendary/Mythical, so absent from Champions. */
const LEGENDARY_MEGA_BASES = [
  'Mewtwo', 'Latias', 'Latios', 'Rayquaza', 'Kyogre', 'Groudon', 'Diancie', 'Heatran',
  'Darkrai', 'Magearna', 'Magearna-Original', 'Zygarde', 'Zygarde-Complete',
];

function buildConfirmed(): Set<string> {
  const set = new Set<string>();
  for (const name of REPORTED_IN_GAME) set.add(toID(name));
  for (const s of allSelectableSpecies()) {
    if (!hasMega(s.name)) continue;
    if (s.isNonstandard === 'CAP') continue;
    if (LEGENDARY_MEGA_BASES.some((n) => toID(n) === toID(s.name))) continue;
    if (categoriesOf(s).some((c) => c !== 'mega')) continue;
    set.add(toID(s.name));
  }
  return set;
}

/**
 * The dex tags are missing on a few species — notably the DLC Paradox legendaries,
 * which carry no tag at all. Without this they would sneak past the category rules.
 */
const EXTRA_CATEGORIES: Record<string, SpeciesCategory[]> = {
  gougingfire: ['paradox', 'sublegendary'],
  ragingbolt: ['paradox', 'sublegendary'],
  ironboulder: ['paradox', 'sublegendary'],
  ironcrown: ['paradox', 'sublegendary'],
  walkingwake: ['paradox', 'sublegendary'],
  ironleaves: ['paradox', 'sublegendary'],
};

export function categoriesOf(s: Species): SpeciesCategory[] {
  const out: SpeciesCategory[] = [...(EXTRA_CATEGORIES[toID(s.name)] ?? [])];
  const tags = (s.tags ?? []) as string[];
  if (tags.includes('Restricted Legendary')) out.push('restricted');
  if (tags.includes('Sub-Legendary')) out.push('sublegendary');
  if (tags.includes('Mythical')) out.push('mythical');
  if (tags.includes('Paradox')) out.push('paradox');
  if (tags.includes('Ultra Beast')) out.push('ultrabeast');
  if (s.forme?.startsWith('Mega')) out.push('mega');
  return [...new Set(out)];
}

export const CATEGORY_LABELS: Record<SpeciesCategory, string> = {
  restricted: 'Restricted Legendary',
  sublegendary: 'Legendary',
  mythical: 'Mythical',
  paradox: 'Paradox',
  ultrabeast: 'Ultra Beast',
  mega: 'Mega Evolution',
};

let confirmedCache: Set<string> | null = null;
export function confirmedRoster(): Set<string> {
  if (!confirmedCache) confirmedCache = buildConfirmed();
  return confirmedCache;
}

/** A user-supplied roster overrides everything below it. */
export interface RosterOverride {
  species: string[];
  importedAt: number;
  label: string;
}

/** Hard rule check: does the regulation forbid this species outright? */
export function categoryViolation(speciesName: string, format: FormatRules): SpeciesCategory | null {
  const s = getSpecies(speciesName);
  if (!s) return null;
  if (s.isNonstandard === 'CAP') return 'restricted';
  const cats = categoriesOf(s);
  for (const c of cats) {
    if (c === 'mega') continue;
    if (format.excludedCategories.includes(c)) return c;
  }
  return null;
}

export function rosterConfidence(
  speciesName: string,
  format: FormatRules,
  override: RosterOverride | null,
): RosterConfidence {
  const s = getSpecies(speciesName);
  if (!s) return 'excluded';
  if (format.bannedSpecies.some((n) => toID(n) === toID(speciesName))) return 'excluded';
  if (categoryViolation(speciesName, format)) return 'excluded';
  if (override) {
    return override.species.some((n) => toID(n) === toID(speciesName)) ? 'confirmed' : 'excluded';
  }
  if (format.id === 'champs-open') return 'confirmed';
  if (confirmedRoster().has(toID(speciesName))) return 'confirmed';
  // A curated competitive roster realistically holds Pokémon that see doubles play or
  // are simply strong. Showdown's doubles tier is a far better relevance signal than
  // raw stats — it is what keeps Amoonguss and Torkoal out of the "unverified" bucket.
  const total = (Object.values(s.baseStats) as number[]).reduce((a, b) => a + b, 0);
  const playedInDoubles = ['DOU', 'DUU', 'DUber'].includes(s.doublesTier as string);
  if (!s.nfe && (playedInDoubles || total >= 480)) return 'likely';
  return 'unverified';
}

export const CONFIDENCE_LABEL: Record<RosterConfidence, string> = {
  confirmed: 'In roster',
  likely: 'Likely in roster',
  unverified: 'Unverified',
  excluded: 'Not legal',
};

export interface SpeciesEntry {
  species: Species;
  confidence: RosterConfidence;
  megaCount: number;
  bst: number;
}

export function speciesCatalogue(
  format: FormatRules,
  override: RosterOverride | null,
): SpeciesEntry[] {
  const out: SpeciesEntry[] = [];
  for (const s of allSelectableSpecies()) {
    if (s.isNonstandard === 'CAP') continue;
    const confidence = rosterConfidence(s.name, format, override);
    out.push({
      species: s,
      confidence,
      megaCount: legalMegas(s.name, format).length,
      bst: (Object.values(s.baseStats) as number[]).reduce((a, b) => a + b, 0),
    });
  }
  return out;
}

export function legalMegas(speciesName: string, format: FormatRules) {
  if (format.megaPerBattle < 1) return [];
  return megasFor(speciesName).filter(
    (m) => !format.bannedMegas.some((b) => toID(b) === toID(m.forme)),
  );
}

/** Parse a pasted roster (one name per line, or comma separated). */
export function parseRosterPaste(text: string): { species: string[]; unknown: string[] } {
  const raw = text
    .split(/[\n,;]+/)
    .map((l) => l.replace(/^[\s\d.#•-]+/, '').trim())
    .filter(Boolean);
  const species: string[] = [];
  const unknown: string[] = [];
  for (const line of raw) {
    const s = getSpecies(line);
    if (s) {
      const base = s.baseSpecies && s.forme?.startsWith('Mega') ? s.baseSpecies : s.name;
      if (!species.includes(base)) species.push(base);
    } else {
      unknown.push(line);
    }
  }
  return { species, unknown };
}
