/** Core domain types for the Champions VGC teambuilder. */

export type StatID = 'hp' | 'atk' | 'def' | 'spa' | 'spd' | 'spe';

export type StatsTable = Record<StatID, number>;

export const STATS: StatID[] = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];

export const STAT_NAMES: Record<StatID, string> = {
  hp: 'HP',
  atk: 'Atk',
  def: 'Def',
  spa: 'SpA',
  spd: 'SpD',
  spe: 'Spe',
};

export type GenderName = 'M' | 'F' | 'N';

/** A single team member. Mega form is derived from the held stone, never stored. */
export interface PokemonSet {
  id: string;
  species: string;
  nickname: string;
  item: string;
  ability: string;
  level: number;
  nature: string;
  evs: StatsTable;
  ivs: StatsTable;
  moves: string[];
  gender?: GenderName;
  shiny?: boolean;
  teraType?: string;
  happiness?: number;
}

export interface Team {
  id: string;
  name: string;
  formatId: string;
  members: PokemonSet[];
  notes: string;
  updatedAt: number;
}

/** Categories a format can exclude wholesale, matched against dex tags. */
export type SpeciesCategory =
  | 'restricted'
  | 'sublegendary'
  | 'mythical'
  | 'paradox'
  | 'ultrabeast'
  | 'mega';

export type RosterConfidence = 'confirmed' | 'likely' | 'unverified' | 'excluded';

export interface FormatRules {
  id: string;
  name: string;
  shortName: string;
  window: string;
  active: boolean;
  gameType: 'Doubles' | 'Singles';
  /** Bring this many, pick this many at team preview. */
  bring: number;
  pick: number;
  level: number;
  speciesClause: boolean;
  itemClause: boolean;
  /** Megas usable per battle. 0 disables Mega Evolution entirely. */
  megaPerBattle: number;
  teraAllowed: boolean;
  /** Dex tag categories that are illegal in this format. */
  excludedCategories: SpeciesCategory[];
  /** Explicit species bans on top of the category rules. */
  bannedSpecies: string[];
  /** Explicit mega-forme bans (e.g. event-locked megas). */
  bannedMegas: string[];
  bannedItems: string[];
  bannedMoves: string[];
  notes: string[];
  /** Provenance for every rule the app cannot verify offline. */
  sourceNotes: string;
}

export type LegalityLevel = 'error' | 'warning' | 'info';

export interface LegalityIssue {
  level: LegalityLevel;
  /** Index into team.members, or null for team-wide issues. */
  slot: number | null;
  code: string;
  message: string;
  fix?: string;
}

/** Field state shared by the calculator, threat matrix and optimizer. */
export interface FieldState {
  gameType: 'Doubles' | 'Singles';
  weather: '' | 'Sun' | 'Rain' | 'Sand' | 'Snow' | 'Harsh Sunshine' | 'Heavy Rain';
  terrain: '' | 'Electric' | 'Grassy' | 'Psychic' | 'Misty';
  isGravity: boolean;
  isMagicRoom: boolean;
  isWonderRoom: boolean;
  isTrickRoom: boolean;
  attackerSide: SideState;
  defenderSide: SideState;
}

export interface SideState {
  isReflect: boolean;
  isLightScreen: boolean;
  isAuroraVeil: boolean;
  isTailwind: boolean;
  isHelpingHand: boolean;
  isFriendGuard: boolean;
  isBattery: boolean;
  isPowerSpot: boolean;
  spikes: number;
  isSR: boolean;
}

export interface CombatantState {
  boosts: Partial<Record<Exclude<StatID, 'hp'>, number>>;
  status: '' | 'brn' | 'par' | 'psn' | 'tox' | 'slp' | 'frz';
  hpPercent: number;
  /** Force the mega forme on/off in the calculator irrespective of the item. */
  megaOverride: boolean | null;
  abilityOn: boolean;
  isDynamaxed?: boolean;
}

export interface ThreatSet {
  id: string;
  name: string;
  species: string;
  item: string;
  ability: string;
  nature: string;
  evs: Partial<StatsTable>;
  ivs?: Partial<StatsTable>;
  moves: string[];
  /** 0-100, how common this Pokémon is in the format. Drives sorting + weighting. */
  usage: number;
  role: string;
  notes?: string;
  builtIn: boolean;
}

export interface DamageResult {
  min: number;
  max: number;
  minPct: number;
  maxPct: number;
  koText: string;
  koChance: number;
  /** Number of hits needed at max roll; 0 when the move deals no damage. */
  hitsToKO: number;
  desc: string;
  moveName: string;
}

export interface MatchupCell {
  best: DamageResult | null;
  byMove: DamageResult[];
}

export const EMPTY_STATS: StatsTable = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
export const MAX_IVS: StatsTable = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };

export function emptyEVs(): StatsTable {
  return { ...EMPTY_STATS };
}

export function maxIVs(): StatsTable {
  return { ...MAX_IVS };
}
