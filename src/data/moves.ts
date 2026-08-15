import { getMove, learnsetSync, toID } from './dex';
import type { Move } from './dex';
import { BUILT_IN_THREATS } from './threats';

/**
 * The move list, arranged the way a builder thinks about it — the same treatment
 * the item list gets.
 *
 * Alphabetical order is the worst possible order for a movepool: Aerial Ace and
 * Acrobatics come before Protect and Fake Out, and a Pokémon with 90 legal moves
 * buries the six you were going to consider. So moves are grouped, and the group
 * that matters is ordered by how often the move is actually used.
 *
 * "Actually used" is measured, not guessed: the Reg M-B threat database is built
 * from published ladder data, so a move's appearances there — weighted by how
 * common the Pokémon carrying it is — is real usage evidence. The curated list
 * below only fills in what the top 24 Pokémon happen not to show.
 */

export type MoveCategory = 'common' | 'status' | 'physical' | 'special';

export const MOVE_CATEGORY_LABEL: Record<MoveCategory, string> = {
  common: 'Commonly used',
  status: 'Status',
  physical: 'Physical',
  special: 'Special',
};

const CATEGORY_ORDER: MoveCategory[] = ['common', 'status', 'physical', 'special'];

/**
 * Moves that carry VGC games and are not necessarily on a top-24 Pokémon.
 * Ordered; earlier is more common. Everything measured from ladder data outranks
 * this list, which is only here so a Pokémon whose staples happen not to appear
 * in the threat database still sorts sensibly.
 */
const KNOWN_STAPLES = [
  'protect', 'fakeout', 'followme', 'ragepowder', 'trickroom', 'tailwind',
  'partingshot', 'helpinghand', 'icywind', 'knockoff', 'wideguard', 'spore',
  'uturn', 'voltswitch', 'flipturn', 'taunt', 'encore', 'willowisp', 'thunderwave',
  'snarl', 'electroweb', 'nuzzle', 'lightscreen', 'reflect', 'auroraveil',
  'suckerpunch', 'extremespeed', 'aquajet', 'bulletpunch', 'grassyglide',
  'detect', 'allyswitch', 'lifedew', 'junglehealing', 'recover', 'roost',
  'swordsdance', 'nastyplot', 'dragondance', 'calmmind', 'trick', 'haze',
  'heatwave', 'rockslide', 'dazzlinggleam', 'muddywater', 'earthquake', 'surf',
  'closecombat', 'flareblitz', 'moonblast', 'makeitrain', 'icebeam', 'hypervoice',
];

/**
 * Usage weight per move id, derived from the threat database: how much of the
 * metagame runs this move. Computed once.
 */
let ladderWeights: Map<string, number> | null = null;

function usageWeights(): Map<string, number> {
  if (ladderWeights) return ladderWeights;
  const out = new Map<string, number>();
  for (const threat of BUILT_IN_THREATS) {
    for (const name of threat.moves) {
      const id = toID(name);
      if (!id) continue;
      out.set(id, (out.get(id) ?? 0) + threat.usage);
    }
  }
  ladderWeights = out;
  return out;
}

const STAPLE_RANK = new Map(KNOWN_STAPLES.map((id, i) => [id, i]));

/** Is this a move a builder should see near the top? */
export function isCommonMove(move: Move): boolean {
  return usageWeights().has(move.id) || STAPLE_RANK.has(move.id);
}

export function moveCategory(move: Move): MoveCategory {
  if (isCommonMove(move)) return 'common';
  if (move.category === 'Status') return 'status';
  return move.category === 'Physical' ? 'physical' : 'special';
}

export interface MoveEntry {
  move: Move;
  category: MoveCategory;
  /** Share of the metagame running this move, when it appears in ladder data. */
  usage: number;
}

/**
 * Every move this Pokémon can learn, grouped, with the ones the format actually
 * runs first.
 */
export function moveCatalogue(species: string): MoveEntry[] {
  const weights = usageWeights();
  const total = BUILT_IN_THREATS.reduce((a, t) => a + t.usage, 0) || 1;

  const out: MoveEntry[] = [];
  for (const name of learnsetSync(species) ?? []) {
    const move = getMove(name);
    if (!move) continue;
    out.push({
      move,
      category: moveCategory(move),
      usage: (weights.get(move.id) ?? 0) / total,
    });
  }

  // Alphabetical inside each section. The section already carries the frequency
  // signal, and within a section a name is easier to find than a ranking is to
  // read — the usage figure is still printed next to each one.
  return out.sort((a, b) => {
    const ca = CATEGORY_ORDER.indexOf(a.category);
    const cb = CATEGORY_ORDER.indexOf(b.category);
    if (ca !== cb) return ca - cb;
    return a.move.name.localeCompare(b.move.name);
  });
}
