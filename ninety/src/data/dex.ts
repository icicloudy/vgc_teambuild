import raw from '../generated/dex.json';

/**
 * The dex, cut down to the preview pool. Everything here is read-only and
 * resolved once at module load — the solver runs hundreds of times a second
 * during a drill and cannot afford lookups that allocate.
 */

export type StatId = 'hp' | 'atk' | 'def' | 'spa' | 'spd' | 'spe';
export const STATS: StatId[] = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
export const STAT_LABEL: Record<StatId, string> = {
  hp: 'HP', atk: 'Atk', def: 'Def', spa: 'SpA', spd: 'SpD', spe: 'Spe',
};

export type Stats = Record<StatId, number>;
export type PartialStats = Partial<Record<StatId, number>>;

export interface Forme {
  id: string;
  name: string;
  types: string[];
  baseStats: Stats;
  abilities: string[];
  weightkg: number;
}

export interface Move {
  id: string;
  name: string;
  type: string;
  category: 'Physical' | 'Special' | 'Status';
  basePower: number;
  /** `true` means "cannot miss". */
  accuracy: number | true;
  target: string;
  priority: number;
  shortDesc: string;
}

export interface PoolSet {
  label: string;
  /** Published item share, 0–100. Normalised into a probability by `setOdds`. */
  share: number;
  item: string;
  /** The ability it actually battles with — the Mega's, when it Megas. */
  ability: string;
  /** What it holds before it Mega Evolves. */
  baseAbility: string;
  nature: string;
  sp: PartialStats;
  moves: string[];
  /** The forme it battles as. */
  forme: string;
  mega: boolean;
  note: string;
}

export interface PoolEntry {
  id: string;
  species: string;
  usage: number;
  /** False when no published move data existed and the set is the app's reading. */
  measured: boolean;
  sets: PoolSet[];
}

export const FORMAT = raw.format as {
  id: string; name: string; level: number; bring: number; pick: number;
  spBudget: number; spPerStat: number;
};

const formes = new Map<string, Forme>(
  Object.entries(raw.species as Record<string, Omit<Forme, 'id'>>)
    .map(([id, s]) => [id, { id, ...s }]),
);

const moves = new Map<string, Move>(
  Object.entries(raw.moves as Record<string, Omit<Move, 'id'>>)
    .map(([id, m]) => [id, { id, ...m } as Move]),
);

const natures = raw.natures as Record<string, { plus?: StatId; minus?: StatId }>;
const damageTaken = raw.types as Record<string, Record<string, number>>;

export const POOL: PoolEntry[] = (raw.pool as PoolEntry[])
  .slice()
  .sort((a, b) => b.usage - a.usage);

const poolById = new Map(POOL.map((p) => [p.id, p]));

export const toId = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

export function forme(id: string): Forme {
  const f = formes.get(id);
  if (!f) throw new Error(`unknown forme ${id}`);
  return f;
}

export function move(id: string): Move {
  const m = moves.get(id);
  if (!m) throw new Error(`unknown move ${id}`);
  return m;
}

export function poolEntry(id: string): PoolEntry | undefined {
  return poolById.get(id);
}

export function nature(name: string): { plus?: StatId; minus?: StatId } {
  return natures[name] ?? {};
}

/**
 * Type effectiveness. The table is stored the way the dex stores it — as what a
 * defending type *takes* — so 1 means "takes double", 2 means "takes half",
 * 3 means "takes nothing".
 */
export function effectiveness(attacking: string, defending: string[]): number {
  let mult = 1;
  for (const def of defending) {
    const code = damageTaken[def]?.[attacking] ?? 0;
    if (code === 1) mult *= 2;
    else if (code === 2) mult *= 0.5;
    else if (code === 3) mult = 0;
  }
  return mult;
}

/**
 * Turns published item shares into a probability distribution.
 *
 * The shares do not sum to 100 — Pikalytics lists the top few items and the tail
 * is everything else — so what is left over is spread back across the listed
 * sets in proportion. That is the honest reading: the missing 21% of Garchomps
 * are running something, and it is far more likely to behave like the Life Orb
 * one than like anything not on the list.
 */
export function setOdds(entry: PoolEntry): number[] {
  const total = entry.sets.reduce((a, s) => a + s.share, 0) || 1;
  return entry.sets.map((s) => s.share / total);
}

export const TYPE_LIST = Object.keys(damageTaken);
