import type { FormatRules, RosterConfidence, SpeciesCategory } from '../types';
import { allSelectableSpecies, getSpecies, hasMega, megasFor, toID } from './dex';
import type { Species } from './dex';
import { CONFIRMED_SPECIES, NFE_EXCEPTIONS } from './champions';

/**
 * Champions ships a curated roster (208 species / 75 Megas as of Reg M-B) rather
 * than the full National Dex, and that list is not published in machine-readable
 * form. So the roster is modelled in four layers, hardest evidence first:
 *
 *  1. Category rules from the regulation (no Legendary / Mythical / Paradox / …)
 *     — hard rules, and legality *errors*.
 *  2. The roster is final-stage only, with a handful of known exceptions
 *     (Pikachu, Eternal Flower Floette, Qwilfish). This one rule removes several
 *     hundred species that could never be built, so it is an error too.
 *  3. A confirmed set that can be cited: every species with a Champions Mega
 *     Stone, everything in Reg M-B ladder usage data, and the Pokémon named in
 *     the regulation announcements (see data/champions.ts).
 *  4. Everything else — selectable, but badged, because the roster is curated and
 *     "it is fully evolved and not a legendary" is not proof it is in the game.
 *
 * Paste the in-game list into the Roster panel to replace layers 2-4 with the
 * real thing; it is stored locally and treated as authoritative from then on.
 */

/** Species named in official coverage or appearing in Reg M-B ladder data. */
const REPORTED_IN_GAME = CONFIRMED_SPECIES;

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

/**
 * Is this a Pokémon that still evolves, and not one of the roster's known
 * exceptions? Champions is a battling game: with a few deliberate exceptions it
 * only carries final-stage Pokémon.
 */
export function isUnevolvedOffRoster(s: Species): boolean {
  if (!s.nfe) return false;
  return !NFE_EXCEPTIONS.some((n) => toID(n) === toID(s.name));
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
  // The roster is final-stage only. This is the rule with the most reach: it takes
  // the builder from "every Pokémon that ever existed" to something close to the
  // 208 that are really there.
  if (isUnevolvedOffRoster(s)) return 'excluded';
  // Beyond that the roster is curated, and no rule predicts it. Showdown's doubles
  // tier is the best available proxy for "the sort of Pokémon a battling game ships".
  const total = (Object.values(s.baseStats) as number[]).reduce((a, b) => a + b, 0);
  const playedInDoubles = ['DOU', 'DUU', 'DUber'].includes(s.doublesTier as string);
  if (playedInDoubles || total >= 480) return 'likely';
  return 'unverified';
}

export const CONFIDENCE_LABEL: Record<RosterConfidence, string> = {
  confirmed: 'In roster',
  likely: 'Probably in roster',
  unverified: 'Not confirmed in roster',
  excluded: 'Not available',
};

export interface SpeciesEntry {
  species: Species;
  confidence: RosterConfidence;
  megaCount: number;
  bst: number;
  /** Higher is more likely to matter in VGC; drives the default ordering. */
  relevance: number;
}

const CONFIDENCE_WEIGHT: Record<RosterConfidence, number> = {
  confirmed: 300, likely: 150, unverified: 0, excluded: -1000,
};

const DOUBLES_TIER_WEIGHT: Record<string, number> = {
  DOU: 220, DUber: 200, DUU: 120,
};

/**
 * How likely a species is to be worth considering for a VGC team.
 *
 * The dominant term is whether it is fully evolved: a Pokémon that still evolves
 * is almost never a real option, and a high base-stat total (Ferrothorn's
 * pre-evolutions, say) should not float it above things people actually play.
 */
export function relevanceScore(species: Species, confidence: RosterConfidence): number {
  let score = CONFIDENCE_WEIGHT[confidence];
  if (species.nfe) score -= 600;
  score += DOUBLES_TIER_WEIGHT[species.doublesTier ?? ''] ?? 0;
  if (megasFor(species.name).length) score += 90;
  const total = (Object.values(species.baseStats) as number[]).reduce((a, b) => a + b, 0);
  score += total / 6;
  return score;
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
      relevance: relevanceScore(s, confidence),
    });
  }
  // Most relevant first, so a Pokémon that still evolves never outranks one people
  // actually bring.
  return out.sort((a, b) => b.relevance - a.relevance || a.species.name.localeCompare(b.species.name));
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
