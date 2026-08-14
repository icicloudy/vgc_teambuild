import type { FormatRules, PokemonSet, StatID, StatsTable } from '../types';
import { STATS, emptySP } from '../types';
import {
  abilitiesFor, effectiveness, getItem, getMove, getSpecies, learnsetSync, toID,
} from '../data/dex';
import type { Move, TypeName } from '../data/dex';
import { legalMegas } from '../data/roster';
import { inChampionsPool } from './../data/items';
import { MAX_SP_PER_STAT, MAX_SP_TOTAL, resolveForm, statAt } from './stats';
import { computeSpeed, defaultScenario } from './speed';
import { emptySet } from './showdown';
import type { Plan, RoleKey } from './plans';

/**
 * Set synthesis: given a species and the team around it, decide an ability, a
 * held item, four moves, a Nature and a Stat Point spread.
 *
 * The rule everywhere below is that a choice must be *derivable*: from the base
 * stats, the learnset, the plan, the rest of the team, or a real speed
 * computation against the threat list. Curated tables encode the parts of VGC
 * knowledge that are not in the dex — that Fake Out is worth a slot and Splash
 * is not — but nothing here is a hard-coded sample team.
 */

/** A threat the drafter measures against, with the numbers it needs precomputed. */
export interface DraftThreat {
  set: PokemonSet;
  usage: number;
  types: string[];
  speed: number;
  /** Share of this threat's damaging moves that are physical, 0–1. */
  physicalShare: number;
}

export interface SetContext {
  format: FormatRules;
  /** Everything else already on the team: drives item clause, roles and coverage. */
  team: PokemonSet[];
  plan: Plan;
  threats: DraftThreat[];
  /** 0 = chalk, 1 = maximum spice. Shifts tie-breaks, never legality. */
  spice: number;
  /** Whether this slot may take a Mega Stone. */
  allowMega: boolean;
}

export interface GeneratedSet {
  set: PokemonSet;
  archetype: Archetype;
  bias: 'physical' | 'special';
  /** Short notes on the non-obvious choices, shown under the card. */
  notes: string[];
}

export type Archetype = 'attacker' | 'support' | 'wall';

/* ------------------------------------------------------------------ *
 * Curated move knowledge
 *
 * The dex knows base power and target; it does not know that Fake Out wins
 * games. These tables are that knowledge, kept in one place.
 * ------------------------------------------------------------------ */

/**
 * Moves worth a slot for what they *do* rather than what they hit for, and
 * roughly what that is worth. Deliberately not restricted to status moves: Fake
 * Out is Physical, Icy Wind and Electroweb are Special, and all three are on the
 * team for their effect.
 */
const SUPPORT_VALUE: Record<string, number> = {
  protect: 46, detect: 40, spikyshield: 42, burningbulwark: 42, silktrap: 42, kingsshield: 40,
  fakeout: 60, followme: 58, ragepowder: 58, spotlight: 30, allyswitch: 22,
  trickroom: 62, tailwind: 62, icywind: 40, electroweb: 34, thunderwave: 30, nuzzle: 34,
  helpinghand: 34, wideguard: 30, quickguard: 18, coaching: 16,
  partingshot: 40, willowisp: 28, taunt: 26, encore: 26, disable: 14,
  spore: 48, sleeppowder: 22, lovelykiss: 18, yawn: 16,
  reflect: 24, lightscreen: 24, auroraveil: 36,
  recover: 26, roost: 26, softboiled: 26, synthesis: 22, moonlight: 22, morningsun: 22,
  slackoff: 26, strengthsap: 34, junglehealing: 28, lifedew: 24,
  swordsdance: 22, nastyplot: 22, dragondance: 26, calmmind: 20, bulkup: 16,
  irondefense: 12, agility: 14, tidyup: 20, victorydance: 26,
  sunnyday: 20, raindance: 20, snowscape: 16, sandstorm: 12, trick: 18, knockoff: 0,
  haze: 14, decorate: 44, safeguard: 10, healpulse: 10, gravity: 8, imprison: 8,
};

/**
 * Moves that need conditions the drafter cannot promise. Focus Punch fails to any
 * chip damage, Future Sight resolves two turns later, Counter needs to be hit
 * first — none of them survive contact with a doubles turn.
 */
const CONDITIONAL = new Set([
  'focuspunch', 'futuresight', 'doomdesire', 'bide', 'counter', 'mirrorcoat',
  'metalburst', 'endeavor', 'dreameater', 'snore', 'sleeptalk', 'naturalgift',
  'fling', 'present', 'spitup', 'swallow', 'rollout', 'iceball', 'beatup',
  'falseswipe', 'holdback', 'synchronoise', 'lastresort', 'echoedvoice', 'belch',
  'storedpower', 'powertrip', 'punishment', 'trumpcard', 'ragefist',
  // Locking yourself in for three turns is a singles luxury.
  'outrage', 'petaldance', 'thrash', 'uproar', 'ragingfury', 'gigatonhammer',
  'steelroller', 'burnup', 'doubleshock', 'brine', 'venoshock', 'barbbarrage',
  // Champions has no Terastallization, so Tera Blast is a Normal move with no home.
  'terablast',
]);

/** Moves the drafter will not put on a set, and why they lose the slot. */
const TWO_TURN = new Set([
  'solarbeam', 'solarblade', 'skyattack', 'fly', 'dig', 'dive', 'bounce', 'razorwind',
  'skullbash', 'phantomforce', 'shadowforce', 'skydrop', 'freezeshock', 'iceburn',
  'meteorbeam', 'electroshot', 'geomancy',
]);
const RECHARGE = new Set([
  'hyperbeam', 'gigaimpact', 'blastburn', 'hydrocannon', 'frenzyplant', 'rockwrecker',
  'roaroftime', 'eternabeam', 'prismaticlaser', 'meteorassault',
]);
const SELF_KO = new Set([
  'explosion', 'selfdestruct', 'mistyexplosion', 'memento', 'finalgambit',
  'healingwish', 'lunardance', 'lastresort',
]);
/** Moves whose listed base power badly understates what they actually do. */
const EFFECTIVE_POWER: Record<string, number> = {
  bulletseed: 100, rockblast: 100, iciclespear: 100, pinmissile: 100, scaleshot: 100,
  populationbomb: 160, tripleaxel: 120, dualwingbeat: 80, bonemerang: 100, tripledive: 100,
  gyroball: 90, bodypress: 105, foulplay: 105, weatherball: 100,
  boltbeak: 130, fishiousrend: 130, avalanche: 90, payback: 80, grassknot: 90,
  lowkick: 90, heavyslam: 90, heatcrash: 90, storedpower: 20, acrobatics: 110,
  hex: 65, facade: 70, freezedry: 100, collisioncourse: 110, electrodrift: 110,
};
// Nothing above may reference a move the drafter refuses to pick.
/** Moves that pay for their power by dropping the stat that fired them. */
const SELF_DEBUFF = new Set([
  'overheat', 'dracometeor', 'leafstorm', 'makeitrain', 'spinout', 'psychoboost',
  'superpower', 'closecombat', 'vcreate', 'hyperspacefury', 'clangoroussoul',
]);

/** Recoil moves: the damage is real, and so is the chip you take for it. */
const RECOIL = new Set([
  'doubleedge', 'flareblitz', 'bravebird', 'wildcharge', 'woodhammer', 'headsmash',
  'volttackle', 'submission', 'takedown', 'headcharge', 'lightofruin', 'wavecrash',
  'headlongrush', 'chloroblast',
]);

/** Moves that pull their weight beyond raw damage (utility riders). */
const MOVE_RIDER: Record<string, number> = {
  knockoff: 30, uturn: 20, voltswitch: 18, flipturn: 18, snarl: 26, iciclespear: 6,
  suckerpunch: 20, aquajet: 8, bulletpunch: 10, machpunch: 8, shadowsneak: 8,
  extremespeed: 24, grassyglide: 22, jetpunch: 14, thunderclap: 20, iceshard: 8,
  ragingbull: 8, breakingswipe: 12, mudshot: 10, bulldoze: 8, poltergeist: 8,
  scaleshot: 8, glaciallance: 20, astralbarrage: 20, matchagotcha: 14, upperhand: 12,
};

/** Abilities worth reaching for, independent of the plan. */
const ABILITY_VALUE: Record<string, number> = {
  hugepower: 60, purepower: 60, intimidate: 44, drought: 42, drizzle: 42,
  goodasgold: 34, protean: 32, libero: 32, adaptability: 26, regenerator: 30,
  sheerforce: 26, technician: 24, magicbounce: 26, prankster: 26, unaware: 22,
  levitate: 22, moldbreaker: 16, thickfat: 24, waterabsorb: 18, voltabsorb: 18,
  flashfire: 18, lightningrod: 26, stormdrain: 26, sapsipper: 20, eartheater: 22,
  wellbakedbody: 20, guts: 22, defiant: 22, competitive: 22, moxie: 18, beastboost: 20,
  triage: 24, sturdy: 12, multiscale: 30, filter: 18, solidrock: 18, furcoat: 26,
  icescales: 30, gooey: 10, tangledfeet: 0, friendguard: 34, psychicsurge: 24,
  grassysurge: 26, electricsurge: 24, mistysurge: 20, sandstream: 18, snowwarning: 20,
  static: 8, flamebody: 10, roughskin: 14, ironbarbs: 14, poisonpoint: 4,
  serenegrace: 20, skilllink: 20, strongjaw: 18, toughclaws: 20, punkrock: 18,
  transistor: 26, dragonsmaw: 26, steelworker: 20, steelyspirit: 18, contrary: 28,
  // Liabilities.
  truant: -60, slowstart: -50, defeatist: -40, klutz: -25, stall: -25, weakarmor: -12,
  normalize: -20, illuminate: -6, runaway: -6, honeygather: -6, ballfetch: -6,
};

/* ------------------------------------------------------------------ *
 * Entry point
 * ------------------------------------------------------------------ */

/**
 * Build a complete set for `species`. Anything already chosen on `base` is kept:
 * that is what makes this usable as "finish what I started" as well as
 * "invent something from nothing".
 */
export function buildSet(species: string, ctx: SetContext, base?: PokemonSet): GeneratedSet {
  const dexSpecies = getSpecies(species);
  const notes: string[] = [];
  const set: PokemonSet = base
    ? { ...base, species: dexSpecies?.name ?? species, sp: { ...base.sp }, moves: [...base.moves] }
    : { ...emptySet(dexSpecies?.name ?? species), level: ctx.format.level };
  if (!dexSpecies) return { set, archetype: 'attacker', bias: 'physical', notes };

  const keepItem = !!base?.item;
  // The builder pre-fills the first ability when you add a Pokémon, so "has an
  // ability" is not the same as "chose an ability": only a non-default one is kept.
  const keepAbility = !!base?.ability &&
    toID(base.ability) !== toID(dexSpecies.abilities[0] ?? '');
  const keepNature = !!base && base.nature !== 'Serious';
  const keepSP = !!base && STATS.some((s) => (base.sp[s] ?? 0) > 0);
  const givenMoves = (base?.moves ?? []).filter(Boolean);

  /* ---- Mega Evolution, which decides stats and ability for us ------- */
  if (!keepItem && ctx.allowMega) {
    const mega = pickMega(dexSpecies.name, ctx);
    if (mega) {
      set.item = mega.stone;
      notes.push(`${mega.stone} — the Mega is the strongest version of this Pokémon, and the team has a free Mega slot.`);
    }
  }

  /* ---- Ability ------------------------------------------------------ */
  // A set always stores the *base* species' ability, even when it Mega Evolves:
  // the Mega's ability is applied by resolveForm, and writing it here would make
  // the set illegal (Gardevoir cannot "have" Pixilate).
  if (!keepAbility) {
    const chosen = pickAbility(dexSpecies.name, ctx);
    if (chosen) set.ability = chosen.name;
    if (chosen?.note) notes.push(chosen.note);
  }
  const form = resolveForm(set, ctx.format);
  if (form?.mega) {
    notes.push(`${form.ability} comes with the Mega forme — the ability above is what it holds before it evolves.`);
  }

  /* ---- Archetype and attacking bias --------------------------------- */
  const resolved = resolveForm(set, ctx.format) ?? form;
  const stats = resolved?.baseStats ?? dexSpecies.baseStats;
  const pool = movePool(set.species, ctx);
  let bias: 'physical' | 'special' = stats.atk >= stats.spa ? 'physical' : 'special';
  const archetype = pickArchetype(stats, pool);

  /* ---- Moves -------------------------------------------------------- */
  if (givenMoves.length < 4) {
    const picked = pickMoves(set, pool, { bias, archetype, ctx, keep: givenMoves });
    set.moves = picked.moves;
    notes.push(...picked.notes);
    // A movepool can overrule the stat line: a Pokémon with better Attack that only
    // learns special coverage is a special attacker in practice.
    const phys = set.moves.filter((m) => getMove(m)?.category === 'Physical').length;
    const spec = set.moves.filter((m) => getMove(m)?.category === 'Special').length;
    if (phys !== spec) bias = phys > spec ? 'physical' : 'special';
  } else {
    set.moves = [...givenMoves.slice(0, 4)];
  }
  while (set.moves.length < 4) set.moves.push('');

  /* ---- Nature, decided together with the Speed investment ----------- */
  // Which way the Nature goes depends on whether Speed points buy anything here,
  // and what those points buy depends on the Nature. Price it, then commit.
  const offensiveSP = archetype === 'attacker' ? 32 : archetype === 'support' ? 20 : 8;
  const speedBudget = Math.min(MAX_SP_PER_STAT, MAX_SP_TOTAL - offensiveSP);
  if (!keepNature) {
    const speedNature = wantsSpeedNature(set, bias, speedBudget, archetype, ctx);
    set.nature = pickNature({ bias, archetype, ctx, speedNature });
  }

  /* ---- Item (needs the moves: Assault Vest bans status moves) -------- */
  if (!keepItem && !set.item) {
    const item = pickItem(set, { bias, archetype, ctx, stats });
    if (item) {
      set.item = item.name;
      if (item.note) notes.push(item.note);
    }
  }

  /* ---- Stat Points -------------------------------------------------- */
  if (!keepSP) {
    const spread = allocateSP(set, { bias, archetype, ctx });
    set.sp = spread.sp;
    notes.push(...spread.notes);
  }

  return { set, archetype, bias, notes };
}

/* ------------------------------------------------------------------ *
 * Mega Evolution
 * ------------------------------------------------------------------ */

function pickMega(species: string, ctx: SetContext) {
  const options = legalMegas(species, ctx.format);
  if (!options.length) return null;
  const usedItems = heldItems(ctx.team);
  const free = options.filter((m) => !usedItems.has(m.stoneId));
  if (!free.length) return null;

  return free
    .map((m) => {
      const ability = toID(m.species.abilities[0] ?? '');
      let score = (Object.values(m.species.baseStats) as number[]).reduce((a, b) => a + b, 0);
      // A Mega that also sets the plan's weather is worth more than a bigger stat line.
      if (ctx.plan.enablerAbilities.some((a) => toID(a) === ability)) score += 220;
      if (ctx.plan.payoffAbilities.some((a) => toID(a) === ability)) score += 90;
      score += (ABILITY_VALUE[ability] ?? 0) * 1.5;
      return { m, score };
    })
    .sort((a, b) => b.score - a.score)[0].m;
}

/* ------------------------------------------------------------------ *
 * Ability
 * ------------------------------------------------------------------ */

function pickAbility(species: string, ctx: SetContext): { name: string; note?: string } | null {
  const options = abilitiesFor(species);
  if (!options.length) return null;

  const teamAbilities = new Set(ctx.team.map((m) => toID(resolveForm(m, ctx.format)?.ability ?? '')));
  const scored = options.map((name, index) => {
    const id = toID(name);
    let score = ABILITY_VALUE[id] ?? 0;
    // The first ability is the common one; only take a different one for a reason.
    if (index === 0) score += 6;
    if (ctx.plan.enablerAbilities.some((a) => toID(a) === id)) score += 80;
    if (ctx.plan.payoffAbilities.some((a) => toID(a) === id)) score += 55;
    if (id === 'intimidate' && !teamAbilities.has('intimidate')) score += 14;
    return { name, score, id };
  });

  const best = scored.sort((a, b) => b.score - a.score)[0];
  const plain = scored.find((s) => s.id === toID(options[0]))!;
  const note = best.id !== plain.id && best.score - plain.score >= 20
    ? `${best.name} over ${options[0]} — it is what makes the set work.`
    : undefined;
  return { name: best.name, note };
}

/* ------------------------------------------------------------------ *
 * Moves
 * ------------------------------------------------------------------ */

interface PoolEntry {
  move: Move;
  support: number;
}

function movePool(species: string, ctx: SetContext): PoolEntry[] {
  const names = learnsetSync(species) ?? [];
  const out: PoolEntry[] = [];
  for (const name of names) {
    const move = getMove(name);
    if (!move) continue;
    if (ctx.format.bannedMoves.some((b) => toID(b) === move.id)) continue;
    if (RECHARGE.has(move.id) || SELF_KO.has(move.id) || CONDITIONAL.has(move.id)) continue;
    if (TWO_TURN.has(move.id) && !chargedByWeather(move.id, ctx)) continue;
    const support = SUPPORT_VALUE[move.id] ?? 0;
    // A status move with no listed value is one the drafter has no use for; a
    // damaging move is always usable, valued or not.
    if (move.category === 'Status' ? support <= 0 : move.basePower <= 0) continue;
    out.push({ move, support });
  }
  return out;
}

/** Sun makes Solar Beam a one-turn move; rain does the same for Electro Shot. */
function chargedByWeather(id: string, ctx: SetContext): boolean {
  if (ctx.plan.weather === 'Sun') return id === 'solarbeam' || id === 'solarblade';
  if (ctx.plan.weather === 'Rain') return id === 'electroshot';
  return false;
}

/**
 * What this Pokémon is for.
 *
 * Decided from the stat line first, because a movepool full of support options
 * does not make a base-135 attacker into a supporter — every VGC support Pokémon
 * worth the slot is one that could not have hit harder instead.
 */
function pickArchetype(stats: StatsTable, pool: PoolEntry[]): Archetype {
  const offense = Math.max(stats.atk, stats.spa);
  const bulk = stats.hp + stats.def + stats.spd;
  const hasRealSupport = pool.some((p) => p.support >= 40);

  if (offense >= 100 || stats.spe >= 100) return 'attacker';
  if (offense < 85 && bulk >= 300) return 'wall';
  if (hasRealSupport) return 'support';
  return offense >= 85 ? 'attacker' : 'wall';
}

/**
 * Usage-weighted value of attacking with a given type: how much of the metagame
 * it actually hits. Keeps coverage choices tied to the threat list rather than to
 * the abstract type chart.
 */
function typeReach(type: string, ctx: SetContext): number {
  let total = 0;
  let weight = 0;
  for (const t of ctx.threats) {
    const mult = effectiveness(type, t.types);
    total += t.usage * Math.min(mult, 4);
    weight += t.usage;
  }
  return weight ? total / weight : 1;
}

/** Defensive types the team cannot hit for super-effective damage. */
export function uncoveredTypes(team: PokemonSet[]): Set<TypeName> {
  const covered = new Set<TypeName>();
  for (const member of team) {
    for (const name of member.moves) {
      const move = getMove(name);
      if (!move || move.category === 'Status' || move.basePower <= 0) continue;
      for (const def of TYPE_LIST) {
        if (effectiveness(move.type, [def]) >= 2) covered.add(def);
      }
    }
  }
  return new Set(TYPE_LIST.filter((t) => !covered.has(t)));
}

const TYPE_LIST: TypeName[] = [
  'Normal', 'Fire', 'Water', 'Electric', 'Grass', 'Ice', 'Fighting', 'Poison', 'Ground',
  'Flying', 'Psychic', 'Bug', 'Rock', 'Ghost', 'Dragon', 'Dark', 'Steel', 'Fairy',
];

function attackScore(
  entry: PoolEntry,
  opts: {
    types: string[];
    bias: 'physical' | 'special';
    stats: StatsTable;
    ctx: SetContext;
    gaps: Set<TypeName>;
  },
): number {
  const { move } = entry;
  const { types, bias, stats, ctx, gaps } = opts;
  const power = EFFECTIVE_POWER[move.id] ?? move.basePower;
  // Accuracy hurts more than linearly: the game a 70% move loses is the whole game.
  const accuracy = move.accuracy === true ? 1 : Math.pow(Math.max(0.5, move.accuracy / 100), 1.5);

  let score = power * accuracy;
  if (types.includes(move.type)) score *= 1.5;
  if (ctx.format.gameType === 'Doubles') {
    if (move.target === 'allAdjacentFoes') {
      // Hits both opponents and nothing of yours.
      score *= 1.3;
    } else if (move.target === 'allAdjacent') {
      // Earthquake, Surf, Discharge, Sludge Wave: these hit your own partner too.
      // Worth it only when the rest of the team does not care.
      score *= partnersImmuneTo(move, ctx) ? 1.3 : 0.7;
    }
  }
  if (move.priority > 0) score *= 1.12;
  if (ctx.plan.weather === 'Sun' && move.type === 'Fire') score *= 1.4;
  if (ctx.plan.weather === 'Sun' && move.type === 'Water') score *= 0.7;
  if (ctx.plan.weather === 'Rain' && move.type === 'Water') score *= 1.4;
  if (ctx.plan.weather === 'Rain' && move.type === 'Fire') score *= 0.7;

  // The stat that actually fires the move. Foul Play is the exception that proves
  // it: the damage comes off the *target's* Attack, so a strong attacker gains
  // nothing by running it.
  const attackStat = move.id === 'foulplay'
    ? Math.min(stats.atk, 90)
    : move.category === 'Physical' ? stats.atk : stats.spa;
  score *= 0.55 + attackStat / 220;
  if (move.id === 'foulplay' && stats.atk >= 105) score *= 0.5;
  if ((move.category === 'Physical') !== (bias === 'physical')) score *= 0.72;

  score *= 0.6 + 0.4 * typeReach(move.type, ctx);
  if (gaps.has(move.type as TypeName)) score += 22;
  // A move that halves its own attacking stat is worth less than its base power
  // suggests, because the second use is the one that matters.
  if (SELF_DEBUFF.has(move.id)) score *= 0.86;
  if (RECOIL.has(move.id)) score *= 0.85;
  score += MOVE_RIDER[move.id] ?? 0;
  return score;
}

/**
 * Abilities that make a teammate ignore an ally's spread move.
 */
const ALLY_IMMUNITY: Record<string, string[]> = {
  levitate: ['Ground'],
  eartheater: ['Ground'],
  waterabsorb: ['Water'],
  stormdrain: ['Water'],
  dryskin: ['Water'],
  voltabsorb: ['Electric'],
  lightningrod: ['Electric'],
  motordrive: ['Electric'],
  sapsipper: ['Grass'],
  flashfire: ['Fire'],
  wellbakedbody: ['Fire'],
  windrider: ['Flying'],
};

/**
 * Would this spread move go through your own side?
 *
 * `allAdjacent` moves hit the partner as well as both opponents, which is why
 * Earthquake teams are built out of Flying types and Levitate — and why handing
 * Sludge Wave to a Pokémon standing next to a Grass partner is a mistake a
 * teambuilder should not make for you.
 */
function partnersImmuneTo(move: Move, ctx: SetContext): boolean {
  if (!ctx.team.length) return false;
  return ctx.team.every((mate) => {
    const form = resolveForm(mate, ctx.format);
    if (!form) return false;
    const ability = toID(form.ability);
    if (ability === 'telepathy') return true;
    if ((ALLY_IMMUNITY[ability] ?? []).includes(move.type)) return true;
    return effectiveness(move.type, form.types) === 0;
  });
}

function pickMoves(
  set: PokemonSet,
  pool: PoolEntry[],
  opts: {
    bias: 'physical' | 'special';
    archetype: Archetype;
    ctx: SetContext;
    keep: string[];
  },
): { moves: string[]; notes: string[] } {
  const { bias, archetype, ctx, keep } = opts;
  const form = resolveForm(set, ctx.format);
  const types = form?.types ?? [];
  const stats = form?.baseStats ?? { hp: 80, atk: 80, def: 80, spa: 80, spd: 80, spe: 80 };
  const gaps = uncoveredTypes(ctx.team);
  const notes: string[] = [];

  const chosen: string[] = [...keep];
  const taken = new Set(chosen.map((m) => toID(m)));
  const add = (name: string) => {
    if (chosen.length >= 4 || taken.has(toID(name))) return false;
    chosen.push(name);
    taken.add(toID(name));
    return true;
  };

  /* ---- 1. Role moves: the reason this Pokémon is on the team --------- */
  const teamRoles = teamRoleCount(ctx.team, ctx.format);
  const supportBudget = archetype === 'attacker' ? 2 : 3;
  const roleCandidates = pool
    .filter((p) => p.support > 0)
    // Speed control has to agree with the plan: Trick Room on a Tailwind team is
    // not a bonus, it is the two halves of the team fighting each other.
    .filter((p) => (p.move.id === 'trickroom' ? ctx.plan.tempo === 'slow' : true))
    .filter((p) => (p.move.id === 'tailwind' ? ctx.plan.tempo !== 'slow' : true))
    .map((p) => {
      let value = p.support;
      // A damaging support move fires off an attacking stat. Icy Wind on a
      // physical attacker is a 55-power special move from an uninvested SpA —
      // the speed drop still lands, but Thunder Wave does the same job for free.
      if (p.move.category !== 'Status' &&
          (p.move.category === 'Physical') !== (bias === 'physical')) {
        value *= 0.6;
      }
      const key = ROLE_OF_MOVE[p.move.id];
      if (key) {
        value *= ctx.plan.roleWeights[key] ?? 1;
        // A role nobody else covers is worth far more than a third copy of one.
        // The first carrier of a role is worth several times the second.
        const held = teamRoles[key] ?? 0;
        value *= held === 0 ? 1.6 : held === 1 ? 0.75 : 0.3;
      }
      // The plan needs exactly one carrier. Once it is up, a second copy is not a
      // bonus at all — it is a wasted move slot on a team that already has it.
      if (ctx.plan.enablerMoves.some((m) => toID(m) === p.move.id) &&
          !planIsUp(ctx.team, ctx.plan, ctx.format)) {
        value += 120;
      }
      if (p.move.id === 'protect') value *= 0.9; // handled explicitly below
      return { name: p.move.name, value, id: p.move.id };
    })
    .sort((a, b) => b.value - a.value);

  let supportTaken = 0;
  for (const cand of roleCandidates) {
    if (supportTaken >= supportBudget - 1) break; // always leave room for Protect
    if (cand.value < 45) break;
    if (cand.id === 'protect') continue;
    // Doubling up on a role the team already has needs a much better reason than
    // covering one nothing else does.
    const roleKey = ROLE_OF_MOVE[cand.id];
    if (roleKey && (teamRoles[roleKey] ?? 0) >= 1 && cand.value < 75) continue;
    if (add(cand.name)) {
      supportTaken++;
      const key = ROLE_OF_MOVE[cand.id];
      if (key && (teamRoles[key] ?? 0) === 0) {
        notes.push(`${cand.name} — nothing else on the team brings ${ROLE_LABEL[key]}.`);
      }
    }
  }

  /* ---- 2. Attacks: best STAB, then the best coverage it adds --------- */
  const attacks = pool
    .filter((p) => p.move.category !== 'Status')
    .map((p) => ({ entry: p, score: attackScore(p, { types, bias, stats, ctx, gaps }) }))
    .sort((a, b) => b.score - a.score);

  // Protect is the highest-value move in doubles; it gets a slot unless this is a
  // bulky attacker that can plausibly run four attacks behind an Assault Vest.
  const bulk = stats.hp + stats.def + stats.spd;
  const wantProtect = !(archetype === 'attacker' && bulk >= 300) &&
    pool.some((p) => p.support > 0 && ROLE_OF_MOVE[p.move.id] === 'protect');
  const attackQuota = Math.max(
    1,
    4 - chosen.length - (wantProtect ? 1 : 0),
  );
  const usedTypes = new Set<string>();
  for (const m of chosen) {
    const mv = getMove(m);
    if (mv && mv.category !== 'Status') usedTypes.add(mv.type);
  }

  let attacksTaken = usedTypes.size;
  for (const { entry } of attacks) {
    if (attacksTaken >= attackQuota || chosen.length >= 4) break;
    if (usedTypes.has(entry.move.type)) continue;
    if (add(entry.move.name)) {
      usedTypes.add(entry.move.type);
      attacksTaken++;
      if (gaps.has(entry.move.type as TypeName)) {
        notes.push(`${entry.move.name} — the team had no ${entry.move.type} coverage at all.`);
      }
    }
  }

  /* ---- 3. Protect, then anything still missing ---------------------- */
  const protectOrder = ['protect', 'burningbulwark', 'silktrap', 'spikyshield', 'detect'];
  const protect = protectOrder
    .map((id) => pool.find((p) => p.move.id === id))
    .find(Boolean);
  if (chosen.length < 4 && protect) add(protect.move.name);

  if (chosen.length < 4) {
    for (const { entry } of attacks) {
      if (chosen.length >= 4) break;
      add(entry.move.name);
    }
  }
  if (chosen.length < 4) {
    for (const cand of roleCandidates) {
      if (chosen.length >= 4) break;
      add(cand.name);
    }
  }
  while (chosen.length < 4) chosen.push('');

  return { moves: chosen.slice(0, 4), notes };
}

const ROLE_OF_MOVE: Record<string, RoleKey> = {
  tailwind: 'speedControl', icywind: 'speedControl', electroweb: 'speedControl',
  thunderwave: 'speedControl', nuzzle: 'speedControl',
  trickroom: 'trickRoom',
  fakeout: 'fakeOut',
  followme: 'redirection', ragepowder: 'redirection', spotlight: 'redirection',
  protect: 'protect', detect: 'protect', spikyshield: 'protect',
  reflect: 'screens', lightscreen: 'screens', auroraveil: 'screens',
  recover: 'recovery', roost: 'recovery', softboiled: 'recovery', synthesis: 'recovery',
  moonlight: 'recovery', morningsun: 'recovery', slackoff: 'recovery', strengthsap: 'recovery',
  junglehealing: 'recovery', lifedew: 'recovery',
};

const ROLE_LABEL: Record<RoleKey, string> = {
  speedControl: 'speed control',
  trickRoom: 'Trick Room',
  fakeOut: 'Fake Out',
  redirection: 'redirection',
  protect: 'Protect',
  screens: 'screens',
  recovery: 'recovery',
  intimidate: 'Intimidate',
  spread: 'spread damage',
  priority: 'priority',
};

/** The roles a finished set actually brings — read off its moves, not its learnset. */
export function rolesOfSet(set: PokemonSet, format: FormatRules): RoleKey[] {
  const out = new Set<RoleKey>();
  for (const name of set.moves) {
    const move = getMove(name);
    if (!move) continue;
    const key = ROLE_OF_MOVE[move.id];
    if (key) out.add(key);
    if (move.category === 'Status') continue;
    if (move.target === 'allAdjacent' || move.target === 'allAdjacentFoes') out.add('spread');
    if (move.priority > 0) out.add('priority');
  }
  if (toID(resolveForm(set, format)?.ability ?? '') === 'intimidate') out.add('intimidate');
  return [...out];
}

/** Does the team already carry the move or ability the plan is built on? */
export function planIsUp(team: PokemonSet[], plan: Plan, format: FormatRules): boolean {
  return team.some((member) => {
    const ability = toID(resolveForm(member, format)?.ability ?? '');
    if (plan.enablerAbilities.some((a) => toID(a) === ability)) return true;
    return member.moves.some((m) => plan.enablerMoves.some((e) => toID(e) === toID(m)));
  });
}

/**
 * How many team members already cover each role. Counted through `rolesOfSet` so
 * that "nothing else on the team does this" is measured the same way everywhere.
 */
export function teamRoleCount(
  team: PokemonSet[],
  format: FormatRules,
): Partial<Record<RoleKey, number>> {
  const out: Partial<Record<RoleKey, number>> = {};
  for (const member of team) {
    for (const key of rolesOfSet(member, format)) out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Nature
 * ------------------------------------------------------------------ */

function pickNature(
  opts: {
    bias: 'physical' | 'special';
    archetype: Archetype;
    ctx: SetContext;
    speedNature: boolean;
  },
): string {
  const { bias, archetype, ctx, speedNature } = opts;
  const slow = ctx.plan.tempo === 'slow';
  const unusedOffense = bias === 'physical' ? 'SpA' : 'Atk';

  if (archetype === 'attacker') {
    if (slow) return bias === 'physical' ? 'Brave' : 'Quiet';
    if (speedNature) return bias === 'physical' ? 'Jolly' : 'Timid';
    return bias === 'physical' ? 'Adamant' : 'Modest';
  }
  if (speedNature && !slow) return bias === 'physical' ? 'Jolly' : 'Timid';

  // Support and walls drop the offensive stat they never use, and lower Speed
  // under Trick Room so the room actually helps them.
  const physicalPressure = threatPhysicalShare(ctx);
  if (slow) return physicalPressure >= 0.5 ? 'Relaxed' : 'Sassy';
  if (unusedOffense === 'SpA') return physicalPressure >= 0.5 ? 'Impish' : 'Careful';
  return physicalPressure >= 0.5 ? 'Bold' : 'Calm';
}

function threatPhysicalShare(ctx: SetContext): number {
  let phys = 0;
  let weight = 0;
  for (const t of ctx.threats) {
    phys += t.usage * t.physicalShare;
    weight += t.usage;
  }
  return weight ? phys / weight : 0.5;
}

/* ------------------------------------------------------------------ *
 * Item
 * ------------------------------------------------------------------ */

function heldItems(team: PokemonSet[]): Set<string> {
  return new Set(team.map((m) => toID(m.item)).filter(Boolean));
}

function pickItem(
  set: PokemonSet,
  opts: {
    bias: 'physical' | 'special';
    archetype: Archetype;
    ctx: SetContext;
    stats: StatsTable;
  },
): { name: string; note?: string } | null {
  const { bias, archetype, ctx, stats } = opts;
  const used = heldItems(ctx.team);
  const moves = set.moves.filter(Boolean).map((m) => getMove(m)).filter(Boolean) as Move[];
  const statusMoves = moves.filter((m) => m.category === 'Status');
  const bulk = stats.hp + stats.def + stats.spd;
  const offense = Math.max(stats.atk, stats.spa);
  const hasRecovery = moves.some((m) => ROLE_OF_MOVE[m.id] === 'recovery');
  const hasScreens = moves.some((m) => ROLE_OF_MOVE[m.id] === 'screens');
  const setsTrickRoom = moves.some((m) => m.id === 'trickroom');
  const lowAccuracy = moves.some((m) => m.accuracy !== true && m.accuracy <= 85);

  const candidates: { name: string; score: number; note?: string }[] = [
    {
      name: 'Assault Vest',
      score: statusMoves.length === 0 && bulk >= 270 ? 70 : -1,
      note: 'Assault Vest — four attacks and no status move, so the downside is free.',
    },
    {
      name: 'Mental Herb',
      score: setsTrickRoom ? 66 : -1,
      note: 'Mental Herb — the one item that guarantees the Trick Room actually goes up through Taunt.',
    },
    { name: 'Sitrus Berry', score: archetype !== 'attacker' ? 58 : 30 },
    { name: 'Leftovers', score: hasRecovery || bulk >= 320 ? 54 : 20 },
    { name: 'Light Clay', score: hasScreens ? 68 : -1 },
    {
      name: 'Focus Sash',
      score: bulk <= 250 && offense >= 110 ? 64 : -1,
      note: 'Focus Sash — it is fast and frail; the Sash buys the turn it needs.',
    },
    { name: 'Life Orb', score: archetype === 'attacker' && offense >= 110 ? 56 : -1 },
    {
      name: 'Choice Scarf',
      score: archetype === 'attacker' && statusMoves.length === 0 && (stats.spe ?? 0) >= 70 &&
        ctx.plan.tempo !== 'slow' ? 50 : -1,
      note: 'Choice Scarf — locked in, but it turns the speed tier on its head.',
    },
    { name: 'Rocky Helmet', score: archetype !== 'attacker' && stats.def >= 100 ? 52 : -1 },
    {
      name: 'Safety Goggles',
      score: archetype === 'support' ? 48 : 20,
      note: 'Safety Goggles — support Pokémon are the ones Spore and Rage Powder are aimed at.',
    },
    { name: 'Wide Lens', score: lowAccuracy ? 44 : -1 },
    {
      name: 'Covert Cloak',
      score: archetype !== 'attacker' ? 34 + ctx.spice * 30 : -1,
      note: 'Covert Cloak — blanks Fake Out flinches, Icy Wind drops and every secondary effect.',
    },
    {
      name: 'Weakness Policy',
      score: bulk >= 300 && offense >= 110 ? 30 + ctx.spice * 44 : -1,
      note: 'Weakness Policy — it is bulky enough to eat the super-effective hit that turns it on.',
    },
    {
      name: 'Clear Amulet',
      score: bias === 'physical' && archetype === 'attacker' ? 26 + ctx.spice * 30 : -1,
      note: 'Clear Amulet — Intimidate is everywhere in this format and this set hates it.',
    },
    { name: 'Eject Button', score: archetype === 'wall' ? 20 + ctx.spice * 26 : -1 },
  ];

  const available = (name: string) => {
    const item = getItem(name);
    if (!item || used.has(toID(name))) return false;
    if (ctx.format.bannedItems.some((b) => toID(b) === toID(name))) return false;
    // Champions ships a curated item pool. Handing out an Assault Vest the game
    // does not have is the fastest way to make a whole spread unusable.
    return ctx.format.itemPool !== 'champions' || inChampionsPool(item);
  };

  const pick = candidates
    .filter((c) => c.score > 0)
    .filter((c) => available(c.name))
    .sort((a, b) => b.score - a.score)[0];
  if (pick) return pick;

  // Item Clause can eat every candidate on a six-Pokémon team. An empty item slot
  // is strictly worse than a mediocre item, so fall back rather than leave one.
  const fallback = ITEM_FALLBACKS.find(available);
  return fallback ? { name: fallback } : null;
}

const ITEM_FALLBACKS = [
  'Sitrus Berry', 'Leftovers', 'Lum Berry', 'Expert Belt', 'Rocky Helmet', 'Wide Lens',
  'Safety Goggles', 'Covert Cloak', 'Clear Amulet', 'Focus Sash', 'Life Orb',
  'Mental Herb', 'Zoom Lens', 'Protective Pads', 'Shell Bell', 'Bright Powder',
];

/* ------------------------------------------------------------------ *
 * Stat Points
 * ------------------------------------------------------------------ */

interface SpreadResult {
  sp: StatsTable;
  notes: string[];
}

/**
 * Spend the 66 points.
 *
 * Order of operations, which is also the order a human does it in: the stat that
 * fires the moves, then a real Speed benchmark taken from the threat list, then
 * everything left into bulk — allocated one point at a time to whichever of
 * HP/Def/SpD buys the most effective HP, weighted by how physical the metagame is.
 */
function allocateSP(
  set: PokemonSet,
  opts: { bias: 'physical' | 'special'; archetype: Archetype; ctx: SetContext },
): SpreadResult {
  const { bias, archetype, ctx } = opts;
  const form = resolveForm(set, ctx.format);
  const notes: string[] = [];
  const sp = emptySP();
  if (!form) return { sp, notes };

  const offStat: StatID = bias === 'physical' ? 'atk' : 'spa';
  const hasAttack = set.moves.some((m) => {
    const mv = getMove(m);
    return !!mv && mv.category !== 'Status';
  });

  /* ---- 1. Offensive stat -------------------------------------------- */
  if (hasAttack) {
    sp[offStat] = archetype === 'attacker' ? 32 : archetype === 'support' ? 20 : 8;
  }

  /* ---- 2. Speed ------------------------------------------------------ */
  let budget = MAX_SP_TOTAL - sp[offStat];
  if (ctx.plan.tempo === 'slow') {
    notes.push('No Speed investment: under Trick Room, slower is better.');
  } else {
    const priced = priceSpeed(set, set.nature, Math.min(MAX_SP_PER_STAT, budget), archetype, ctx);
    if (priced.points > 0) {
      sp.spe = priced.points;
      budget -= priced.points;
      notes.push(
        `${priced.points} Speed points — the cheapest number that outruns ${priced.label} at ${priced.target}.`,
      );
    }
  }

  /* ---- 3. Bulk, one point at a time --------------------------------- */
  const physShare = threatPhysicalShare(ctx);
  const level = set.level;
  const nature = set.nature;
  const value = (table: StatsTable) => {
    const hp = statAt('hp', form.baseStats.hp, table.hp, level, nature);
    const def = statAt('def', form.baseStats.def, table.def, level, nature);
    const spd = statAt('spd', form.baseStats.spd, table.spd, level, nature);
    return hp * def * physShare + hp * spd * (1 - physShare);
  };

  for (let point = 0; point < budget; point++) {
    let best: StatID | null = null;
    let bestValue = value(sp);
    for (const stat of ['hp', 'def', 'spd'] as StatID[]) {
      if ((sp[stat] ?? 0) >= MAX_SP_PER_STAT) continue;
      if (stat === 'hp' && form.baseStats.hp === 1) continue; // Shedinja
      const trial = { ...sp, [stat]: (sp[stat] ?? 0) + 1 };
      const v = value(trial);
      if (v > bestValue) {
        bestValue = v;
        best = stat;
      }
    }
    if (!best) break;
    sp[best] = (sp[best] ?? 0) + 1;
  }

  // Anything the bulk loop could not place (every stat capped) goes back into offence.
  let spent = STATS.reduce((n, s) => n + sp[s], 0);
  for (const stat of [offStat, 'spe'] as StatID[]) {
    while (spent < MAX_SP_TOTAL && sp[stat] < MAX_SP_PER_STAT && hasAttack) {
      sp[stat]++;
      spent++;
    }
  }

  return { sp, notes };
}

/**
 * What Speed is worth here, and what it costs.
 *
 * Speed is only worth what it outruns, so every point count from 0 to the budget
 * is priced: the gain is the extra share of the metagame (usage-weighted) this
 * Pokémon moves before, the cost is the bulk those points would otherwise buy. A
 * slow Pokémon chasing a tier it cannot reach nets out at zero and gets nothing,
 * which is the answer a human would give too.
 */
const SPEED_POINT_COST: Record<Archetype, number> = {
  attacker: 0.5,
  support: 0.85,
  wall: 1.2,
};

interface SpeedPrice {
  points: number;
  net: number;
  label: string;
  target: number;
  /** How many threats the investment newly moves before. */
  passed: number;
}

function priceSpeed(
  set: PokemonSet,
  nature: string,
  budget: number,
  archetype: Archetype,
  ctx: SetContext,
): SpeedPrice {
  const none: SpeedPrice = { points: 0, net: 0, label: '', target: 0, passed: 0 };
  if (budget <= 0 || !ctx.threats.length) return none;

  const scenario = defaultScenario();
  const speedAt = (points: number) =>
    computeSpeed({ ...set, nature, sp: { ...set.sp, spe: points } }, ctx.format, scenario).final;

  const total = ctx.threats.reduce((a, t) => a + t.usage, 0) || 1;
  const shareAt = (speed: number) =>
    ctx.threats.reduce((a, t) => a + (speed > t.speed ? t.usage : 0), 0) / total;

  const bare = speedAt(0);
  const baseShare = shareAt(bare);
  const cost = SPEED_POINT_COST[archetype];
  let best = none;
  for (let points = 1; points <= budget; points++) {
    const reached = speedAt(points);
    const net = (shareAt(reached) - baseShare) * 100 - points * cost;
    if (net <= best.net) continue;
    const newlyPassed = ctx.threats.filter((t) => t.speed < reached && t.speed >= bare);
    // Name the fastest thing this investment newly outruns: that is the benchmark.
    const marker = [...newlyPassed].sort((a, b) => b.speed - a.speed)[0];
    best = {
      points,
      net,
      label: marker ? marker.set.nickname || marker.set.species : '',
      target: marker?.speed ?? 0,
      passed: newlyPassed.length,
    };
  }
  // Cheap Speed is always worth taking; expensive Speed has to clear a real block
  // of the metagame, not creep one Pokémon. Otherwise those points buy bulk, which
  // applies on every turn rather than on the turns where the tier matters.
  if (best.points > 12 && (best.passed < 3 || best.net < 12)) return none;
  return best;
}

/**
 * Whether this Pokémon wants a Speed-boosting Nature.
 *
 * The trade is explicit: +Speed costs 10% of the attacking stat, so it has to buy
 * meaningfully more of the metagame than a neutral Nature does at the same cost.
 */
function wantsSpeedNature(
  set: PokemonSet,
  bias: 'physical' | 'special',
  budget: number,
  archetype: Archetype,
  ctx: SetContext,
): boolean {
  if (ctx.plan.tempo === 'slow') return false;
  const plus = priceSpeed(set, bias === 'physical' ? 'Jolly' : 'Timid', budget, archetype, ctx);
  const neutral = priceSpeed(set, 'Serious', budget, archetype, ctx);
  return plus.net > neutral.net + 8;
}
