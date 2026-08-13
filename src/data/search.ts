import {
  TYPES, getAbility, getMove, learnsetSync, toID,
} from './dex';
import type { Species } from './dex';
import { allSelectableSpecies } from './dex';

/**
 * Searching the species list by what a Pokémon *does*, not just its name.
 *
 * "intimidate", "fake out", "steel" and "fake out intimidate" all work, and terms
 * stack: every term must match. Within one term the interpretations are unioned,
 * so "steel" finds Steel-types *and* Steelix rather than forcing a choice.
 */

export type FilterKind = 'ability' | 'move' | 'type' | 'name';

export interface SearchTerm {
  kind: FilterKind;
  /** What to show on the chip. */
  label: string;
  /** The raw text this term consumed. */
  text: string;
}

/* ------------------------------------------------------------------ *
 * Inverted indexes, built once on first use
 * ------------------------------------------------------------------ */

interface Indexes {
  byAbility: Map<string, Set<string>>;
  byMove: Map<string, Set<string>>;
  byType: Map<string, Set<string>>;
  abilityNames: { id: string; name: string }[];
  moveNames: { id: string; name: string }[];
}

let indexes: Indexes | null = null;

function buildIndexes(): Indexes {
  const byAbility = new Map<string, Set<string>>();
  const byMove = new Map<string, Set<string>>();
  const byType = new Map<string, Set<string>>();
  const abilitySeen = new Map<string, string>();
  const moveSeen = new Map<string, string>();

  const add = (map: Map<string, Set<string>>, key: string, id: string) => {
    let set = map.get(key);
    if (!set) { set = new Set(); map.set(key, set); }
    set.add(id);
  };

  for (const species of allSelectableSpecies()) {
    for (const ability of species.abilities) {
      const id = toID(ability);
      add(byAbility, id, species.id);
      abilitySeen.set(id, ability);
    }
    for (const type of species.types) add(byType, type.toLowerCase(), species.id);

    // Learnsets are already resolved and cached by the dex layer.
    for (const move of learnsetSync(species.name) ?? []) {
      const id = toID(move);
      add(byMove, id, species.id);
      moveSeen.set(id, move);
    }
  }

  return {
    byAbility,
    byMove,
    byType,
    abilityNames: [...abilitySeen].map(([id, name]) => ({ id, name })),
    moveNames: [...moveSeen].map(([id, name]) => ({ id, name })),
  };
}

function getIndexes(): Indexes {
  if (!indexes) indexes = buildIndexes();
  return indexes;
}

/* ------------------------------------------------------------------ *
 * Query parsing
 * ------------------------------------------------------------------ */

const TYPE_IDS = new Set(TYPES.map((t) => t.toLowerCase()));

/** Species matching one phrase, or null when the phrase names nothing. */
function resolvePhrase(phrase: string): { term: SearchTerm; ids: Set<string> } | null {
  const id = toID(phrase);
  if (!id) return null;
  const idx = getIndexes();

  if (TYPE_IDS.has(id) && idx.byType.has(id)) {
    const name = TYPES.find((t) => t.toLowerCase() === id)!;
    return { term: { kind: 'type', label: `${name} type`, text: phrase }, ids: idx.byType.get(id)! };
  }

  const ability = getAbility(id);
  if (ability && idx.byAbility.has(ability.id)) {
    return {
      term: { kind: 'ability', label: ability.name, text: phrase },
      ids: idx.byAbility.get(ability.id)!,
    };
  }

  const move = getMove(id);
  if (move && idx.byMove.has(move.id)) {
    return {
      term: { kind: 'move', label: move.name, text: phrase },
      ids: idx.byMove.get(move.id)!,
    };
  }

  // Prefixes, so "intim" and "fake" work before the whole name is typed.
  if (id.length >= 3) {
    const abilityHits = idx.abilityNames.filter((a) => a.id.startsWith(id));
    if (abilityHits.length) {
      const ids = new Set<string>();
      for (const a of abilityHits) for (const s of idx.byAbility.get(a.id) ?? []) ids.add(s);
      const label = abilityHits.length === 1 ? abilityHits[0].name : `${phrase}… (ability)`;
      return { term: { kind: 'ability', label, text: phrase }, ids };
    }
    const moveHits = idx.moveNames.filter((m) => m.id.startsWith(id));
    if (moveHits.length) {
      const ids = new Set<string>();
      for (const m of moveHits) for (const s of idx.byMove.get(m.id) ?? []) ids.add(s);
      const label = moveHits.length === 1 ? moveHits[0].name : `${phrase}… (move)`;
      return { term: { kind: 'move', label, text: phrase }, ids };
    }
  }

  return null;
}

export interface ParsedQuery {
  terms: SearchTerm[];
  /** One id set per term; a species must appear in all of them. */
  constraints: (Set<string> | null)[];
  /** Raw text of terms that only matched by name. */
  nameFragments: string[];
}

const MAX_PHRASE = 4;

/**
 * Split a query into terms, preferring the longest phrase that names something —
 * so "fake out" is one move filter, not two name fragments.
 */
export function parseSpeciesQuery(query: string): ParsedQuery {
  const terms: SearchTerm[] = [];
  const constraints: (Set<string> | null)[] = [];
  const nameFragments: string[] = [];

  // A comma is an explicit separator; otherwise fall back to greedy matching.
  for (const chunk of query.split(',')) {
    const tokens = chunk.trim().toLowerCase().split(/\s+/).filter(Boolean);
    let i = 0;
    while (i < tokens.length) {
      let consumed = 0;
      for (let len = Math.min(MAX_PHRASE, tokens.length - i); len >= 1; len--) {
        const phrase = tokens.slice(i, i + len).join(' ');
        const hit = resolvePhrase(phrase);
        if (hit) {
          terms.push(hit.term);
          constraints.push(hit.ids);
          consumed = len;
          break;
        }
      }
      if (!consumed) {
        const text = tokens[i];
        terms.push({ kind: 'name', label: text, text });
        constraints.push(null);
        nameFragments.push(text);
        consumed = 1;
      }
      i += consumed;
    }
  }

  return { terms, constraints, nameFragments };
}

/**
 * Species matching every term. A term is satisfied by its filter *or* by the name,
 * so a word that is both a type and part of a name finds both.
 */
export function searchSpecies(query: string, pool: Species[]): Species[] {
  const q = query.trim();
  if (!q) return pool;
  const { terms, constraints } = parseSpeciesQuery(q);
  if (!terms.length) return pool;

  return pool.filter((species) => {
    const name = species.name.toLowerCase();
    for (let i = 0; i < terms.length; i++) {
      const ids = constraints[i];
      const byName = name.includes(terms[i].text);
      const byFilter = ids ? ids.has(species.id) : false;
      if (!byName && !byFilter) return false;
    }
    return true;
  });
}

/** Warm the indexes so the first keystroke is not the one that pays for them. */
export function primeSearchIndexes(): void {
  getIndexes();
}
