import {
  FORMAT, STATS, effectiveness, forme, move, nature, poolEntry, setOdds, toId,
} from '../data/dex';
import type { Forme, Move, PartialStats, PoolEntry, PoolSet, StatId, Stats } from '../data/dex';

/**
 * A Pokémon as the battle sees it: one concrete set, with its stats already
 * worked out and the handful of facts the solver keeps asking about hoisted into
 * flags. Everything downstream reads a Battler and never touches the dex again.
 */

export interface Battler {
  /** Stable key: species + set label. Two of these can be the same species. */
  key: string;
  species: string;
  set: PoolSet;
  forme: Forme;
  types: string[];
  ability: string;
  abilityId: string;
  item: string;
  itemId: string;
  stats: Stats;
  moves: Move[];
  /** How likely this exact set is, given the species. 0–1. */
  odds: number;
  /** Published usage of the species, 0–100. */
  usage: number;
  measured: boolean;

  /* ---- the facts the solver asks about over and over ---- */
  fakeOut: boolean;
  redirects: boolean;
  protects: boolean;
  setsTailwind: boolean;
  setsTrickRoom: boolean;
  setsRain: boolean;
  setsSun: boolean;
  intimidates: boolean;
  /** Speed control that does not need a turn: Icy Wind, Thunder Wave, Electroweb. */
  slowsOnHit: boolean;
  screens: boolean;
  /** Refuses status moves aimed at it (Good as Gold). */
  blocksStatus: boolean;
  /** Blocks priority aimed at its whole side (Armor Tail, Dazzling). */
  blocksPriority: boolean;
  /** Eats the first hit outright (Disguise). */
  freeTurn: boolean;
  /** Doubles Speed once its item is gone (Unburden) or under its weather. */
  speedDoubler: 'unburden' | 'rain' | 'sun' | null;
  /** Priority damage, highest bracket it has. */
  priority: number;
}

/* ------------------------------------------------------------------ *
 * Stats — Champions Stat Points, not EVs
 *
 * 66 points to spend, 32 in any one stat, one point is one stat point, and
 * every Pokémon behaves as though its IVs were perfect. Natures are the usual
 * ±10%, applied before the points are added.
 * ------------------------------------------------------------------ */

export function statValue(
  stat: StatId,
  base: number,
  points: number,
  level: number,
  natureName: string,
): number {
  if (stat === 'hp') {
    if (base === 1) return 1; // Shedinja, and nothing else
    return Math.floor((2 * base + 31) * level / 100) + level + 10 + points;
  }
  const raw = Math.floor((2 * base + 31) * level / 100) + 5;
  const nat = nature(natureName);
  const mod = nat.plus === stat ? 1.1 : nat.minus === stat ? 0.9 : 1;
  return Math.floor(raw * mod) + points;
}

function statsOf(f: Forme, sp: PartialStats, natureName: string): Stats {
  const out = {} as Stats;
  for (const s of STATS) out[s] = statValue(s, f.baseStats[s], sp[s] ?? 0, FORMAT.level, natureName);
  return out;
}

/* ------------------------------------------------------------------ *
 * Building a Battler
 * ------------------------------------------------------------------ */

const REDIRECT = new Set(['followme', 'ragepowder']);
const SCREEN = new Set(['reflect', 'lightscreen', 'auroraveil']);
const SLOW_ON_HIT = new Set(['icywind', 'electroweb', 'thunderwave', 'nuzzle', 'scald']);

export function battler(entry: PoolEntry, setIndex: number): Battler {
  const set = entry.sets[setIndex];
  const f = forme(set.forme);
  const ids = new Set(set.moves);
  const list = set.moves.map(move);
  const abilityId = toId(set.ability);

  return {
    key: `${entry.id}:${setIndex}`,
    species: entry.species,
    set,
    forme: f,
    types: f.types,
    ability: set.ability,
    abilityId,
    item: set.item,
    itemId: toId(set.item),
    stats: statsOf(f, set.sp, set.nature),
    moves: list,
    odds: setOdds(entry)[setIndex],
    usage: entry.usage,
    measured: entry.measured,

    fakeOut: ids.has('fakeout'),
    redirects: [...ids].some((m) => REDIRECT.has(m)),
    protects: ids.has('protect') || ids.has('detect'),
    setsTailwind: ids.has('tailwind'),
    setsTrickRoom: ids.has('trickroom'),
    setsRain: abilityId === 'drizzle' || ids.has('raindance'),
    setsSun: abilityId === 'drought' || ids.has('sunnyday'),
    intimidates: abilityId === 'intimidate',
    slowsOnHit: [...ids].some((m) => SLOW_ON_HIT.has(m)),
    screens: [...ids].some((m) => SCREEN.has(m)),
    blocksStatus: abilityId === 'goodasgold',
    blocksPriority: abilityId === 'armortail' || abilityId === 'dazzling',
    freeTurn: abilityId === 'disguise',
    speedDoubler: abilityId === 'unburden' ? 'unburden'
      : abilityId === 'swiftswim' ? 'rain'
        : abilityId === 'chlorophyll' ? 'sun' : null,
    priority: list.reduce((n, m) => (m.category === 'Status' ? n : Math.max(n, m.priority)), 0),
  };
}

/** Every set the pool knows for a species, most likely first. */
export function battlersFor(speciesId: string): Battler[] {
  const entry = poolEntry(speciesId);
  if (!entry) return [];
  return entry.sets
    .map((_, i) => battler(entry, i))
    .sort((a, b) => b.odds - a.odds);
}

/** The set you should assume when you have no other information. */
export function likeliest(speciesId: string): Battler {
  const all = battlersFor(speciesId);
  if (!all.length) throw new Error(`no sets for ${speciesId}`);
  return all[0];
}

/* ------------------------------------------------------------------ *
 * Damage
 *
 * The Gen 9 formula, at the fidelity the decision needs. Rounding follows the
 * game's: the base calculation floors at each division, and every modifier
 * afterwards rounds half *down*, which is why 50.5 becomes 50.
 * ------------------------------------------------------------------ */

export type Weather = 'none' | 'rain' | 'sun';

export interface Conditions {
  weather: Weather;
  /** Move hits both opposing Pokémon, so it takes the 0.75 spread penalty. */
  spread: boolean;
  /** Attacker's Attack stage — Intimidate is the reason this exists. */
  atkStage: number;
  /** Reflect / Light Screen up on the defending side. */
  screen: boolean;
  /** Friend Guard on the defender's partner. */
  friendGuard: boolean;
}

export const NEUTRAL: Conditions = {
  weather: 'none', spread: true, atkStage: 0, screen: false, friendGuard: false,
};

const pokeRound = (n: number) => (n - Math.floor(n) > 0.5 ? Math.ceil(n) : Math.floor(n));

const STAGE = [2 / 8, 2 / 7, 2 / 6, 2 / 5, 2 / 4, 2 / 3, 2 / 2, 3 / 2, 4 / 2, 5 / 2, 6 / 2, 7 / 2, 8 / 2];
const stageMul = (n: number) => STAGE[Math.max(-6, Math.min(6, n)) + 6];

/** Items that add 20% to one type, which is how this format's boosters work. */
const TYPE_BOOSTER: Record<string, string> = {
  mysticwater: 'Water', fairyfeather: 'Fairy', blackglasses: 'Dark',
  charcoal: 'Fire', magnet: 'Electric', miracleseed: 'Grass', sharpbeak: 'Flying',
  softsand: 'Ground', hardstone: 'Rock', silkscarf: 'Normal', spelltag: 'Ghost',
  metalcoat: 'Steel', twistedspoon: 'Psychic', nevermeltice: 'Ice',
  poisonbarb: 'Poison', blackbelt: 'Fighting', dragonfang: 'Dragon', silverpowder: 'Bug',
};

/** Berries that halve one super-effective hit. The reason Kingambit holds Chople. */
const RESIST_BERRY: Record<string, string> = {
  chopleberry: 'Fighting', kasibberry: 'Ghost', colburberry: 'Dark', passhoberry: 'Water',
  occaberry: 'Fire', wacanberry: 'Electric', rindoberry: 'Grass', yacheberry: 'Ice',
  chartiberry: 'Rock', shucaberry: 'Ground', cobaberry: 'Flying', payapaberry: 'Psychic',
  tangaberry: 'Bug', kebiaberry: 'Poison', babiriberry: 'Steel', roseliberry: 'Fairy',
  habanberry: 'Dragon',
};

const CONTACT_EXEMPT = new Set([
  'heatwave', 'weatherball', 'hurricane', 'moonblast', 'hypervoice', 'dazzlinggleam',
  'lightofruin', 'solarbeam', 'matchagotcha', 'makeitrain', 'shadowball', 'electroshot',
  'flashcannon', 'dragonpulse', 'psychic', 'scald', 'icywind', 'zapcannon', 'focusblast',
  'thunderbolt', 'rockslide', 'lastrespects', 'suckerpunch', 'shadowsneak', 'superfang',
]);

/**
 * What type and power a move actually goes out with.
 *
 * Weather Ball is the whole reason this is a function: on paper it is a 50-power
 * Normal move, and in rain it is a 100-power Water one. Reading the printed type
 * is how a tool tells you Pelipper has two Water moves when it does not, or
 * misses that it does.
 */
export function firedAs(m: Move, b: Battler, weather: Weather): { type: string; power: number } {
  let type = m.type;
  let power = m.basePower;

  if (m.id === 'weatherball') {
    if (weather === 'rain') { type = 'Water'; power = 100; }
    else if (weather === 'sun') { type = 'Fire'; power = 100; }
  }
  // Pixilate and friends rewrite Normal moves and add 20%.
  if (b.abilityId === 'pixilate' && m.type === 'Normal') { type = 'Fairy'; power = Math.floor(power * 1.2); }
  if (b.abilityId === 'aerilate' && m.type === 'Normal') { type = 'Flying'; power = Math.floor(power * 1.2); }
  if (b.abilityId === 'refrigerate' && m.type === 'Normal') { type = 'Ice'; power = Math.floor(power * 1.2); }

  // Last Respects grows with the graveyard. At preview nobody has fainted, so
  // this is its floor — and the note the app prints says exactly that.
  if (m.id === 'lastrespects') power = 50;
  // Population Bomb is ten 20-power hits; Wide Lens makes it stick.
  if (m.id === 'populationbomb') power = 20 * (b.itemId === 'widelens' ? 9 : 7);

  return { type, power };
}

/**
 * Does this move actually do anything on the turn it is chosen?
 *
 * Solar Beam and Electro Shot spend a turn charging unless their weather is up.
 * A tool that prices Electro Shot at 130 against a team with no rain is pricing
 * a move that does not happen.
 */
export function needsCharge(m: Move, weather: Weather): boolean {
  if (m.id === 'solarbeam' || m.id === 'solarblade') return weather !== 'sun';
  if (m.id === 'electroshot') return weather !== 'rain';
  return false;
}

export interface Hit {
  move: Move;
  type: string;
  /** Damage as a share of the defender's max HP, worst and best roll. */
  min: number;
  max: number;
  effectiveness: number;
  /** Accuracy as a probability, after abilities and items. */
  accuracy: number;
  /** True when the move spends a turn charging first. */
  charging: boolean;
}

export function maxHP(b: Battler): number {
  return b.stats.hp;
}

/** One attacking move, one defender, one set of conditions. */
export function hit(atk: Battler, def: Battler, m: Move, c: Conditions): Hit | null {
  if (m.category === 'Status') return null;
  const { type, power } = firedAs(m, atk, c.weather);
  const eff = effectiveness(type, def.types);

  let accuracy = m.accuracy === true ? 1 : m.accuracy / 100;
  if (atk.abilityId === 'noguard') accuracy = 1;
  else {
    if (atk.itemId === 'widelens') accuracy = Math.min(1, accuracy * 1.1);
    // Rain makes Hurricane and Thunder stop missing; sun makes Hurricane worse.
    if (c.weather === 'rain' && (m.id === 'hurricane' || m.id === 'thunder')) accuracy = 1;
    if (c.weather === 'sun' && m.id === 'hurricane') accuracy = 0.5;
  }

  const base = {
    move: m, type, effectiveness: eff, accuracy,
    charging: needsCharge(m, c.weather),
  };
  if (eff === 0 || power === 0) return { ...base, min: 0, max: 0 };

  const physical = m.category === 'Physical';
  const a = physical
    ? Math.floor(atk.stats.atk * stageMul(c.atkStage))
    : atk.stats.spa;
  const d = physical ? def.stats.def : def.stats.spd;

  let raw = Math.floor(
    Math.floor(Math.floor(2 * FORMAT.level / 5 + 2) * power * a / d) / 50,
  ) + 2;

  // Spread moves lose a quarter in doubles, and this format is doubles.
  const isSpread = c.spread && (m.target === 'allAdjacentFoes' || m.target === 'allAdjacent');
  if (isSpread) raw = pokeRound(raw * 0.75);

  if (c.weather === 'rain' && type === 'Water') raw = pokeRound(raw * 1.5);
  if (c.weather === 'rain' && type === 'Fire') raw = pokeRound(raw * 0.5);
  if (c.weather === 'sun' && type === 'Fire') raw = pokeRound(raw * 1.5);
  if (c.weather === 'sun' && type === 'Water') raw = pokeRound(raw * 0.5);

  const stab = atk.types.includes(type)
    ? (atk.abilityId === 'adaptability' ? 2 : 1.5)
    : 1;

  // Everything that multiplies at the end, chained.
  let final = 1;
  if (atk.itemId === 'lifeorb') final *= 1.3;
  if (TYPE_BOOSTER[atk.itemId] === type) final *= 1.2;
  if (atk.abilityId === 'toughclaws' && !CONTACT_EXEMPT.has(m.id)) final *= 1.3;
  if (atk.abilityId === 'technician' && power <= 60) final *= 1.5;
  if ((atk.abilityId === 'blaze' && type === 'Fire') ||
      (atk.abilityId === 'torrent' && type === 'Water') ||
      (atk.abilityId === 'overgrow' && type === 'Grass')) {
    // Only live below a third HP; at full health it does nothing, so it is not
    // counted. Listed here so the omission is deliberate rather than forgotten.
    final *= 1;
  }
  if (c.screen && !isSpread) final *= 0.5;
  else if (c.screen) final *= 0.667;
  if (c.friendGuard) final *= 0.75;
  if (RESIST_BERRY[def.itemId] === type && eff > 1) final *= 0.5;
  if (def.abilityId === 'multiscale') final *= 0.5;

  const roll = (r: number) => {
    let dmg = Math.floor(raw * r);
    dmg = pokeRound(dmg * stab);
    dmg = Math.floor(dmg * eff);
    dmg = pokeRound(dmg * final);
    return Math.max(1, dmg);
  };

  const hp = maxHP(def);
  const hits = m.id === 'populationbomb' ? 1 : 1; // power already folded in above
  return {
    ...base,
    min: (roll(0.85) * hits) / hp,
    max: (roll(1.0) * hits) / hp,
  };
}

/** Every damaging move this Pokémon has, against one defender. */
export function hits(atk: Battler, def: Battler, c: Conditions): Hit[] {
  const out: Hit[] = [];
  for (const m of atk.moves) {
    const h = hit(atk, def, m, c);
    if (h) out.push(h);
  }
  return out;
}

/**
 * How many turns this Pokémon needs to remove that one, and with what.
 *
 * "Turns" rather than "percent" because that is the unit team preview is decided
 * in. A move that does 51% is a two-turn answer and so is one that does 99%; the
 * difference between them is nothing until a Sitrus Berry is involved, and the
 * difference between 99% and 101% is the whole game.
 */
export interface Answer {
  turns: number;
  best: Hit | null;
  /** Best roll as a share of the defender's HP, for the display. */
  damage: number;
  /** True when only the high roll gets there — a roll, not a read. */
  needsRoll: boolean;
}

export function answer(atk: Battler, def: Battler, c: Conditions): Answer {
  let best: Hit | null = null;
  let bestExpected = -1;
  for (const h of hits(atk, def, c)) {
    // A charging move is worth half of itself: it happens a turn late, and in
    // doubles a turn late usually means it does not happen.
    const expected = h.max * h.accuracy * (h.charging ? 0.5 : 1);
    if (expected > bestExpected) { bestExpected = expected; best = h; }
  }
  if (!best || best.max <= 0) return { turns: 99, best, damage: 0, needsRoll: false };

  // Disguise eats one hit outright, so everything against it is a turn late.
  const free = def.freeTurn ? 1 : 0;
  const sitrus = def.itemId === 'sitrusberry' ? 0.25 : 0;
  const effective = Math.max(0.01, best.max * best.accuracy);
  const turns = Math.ceil((1 + sitrus) / effective) + free + (best.charging ? 1 : 0);
  return {
    turns,
    best,
    damage: best.max,
    needsRoll: best.max >= 1 && best.min < 1,
  };
}
