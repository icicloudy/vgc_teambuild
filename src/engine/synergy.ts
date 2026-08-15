import type { FormatRules, PokemonSet } from '../types';
import { effectiveness, getMove, toID } from '../data/dex';
import { resolveForm } from './stats';

/**
 * How two Pokémon work together.
 *
 * The rest of the drafter reasons about a candidate on its own: can it beat the
 * metagame, does it cover a type nothing else covers, does it fill an empty role.
 * That is necessary and it is not sufficient — a VGC team is four Pokémon on the
 * field in pairs, and the reason a team is good is usually a *relationship*
 * between two of its members rather than a property of any one of them.
 *
 * So this file models the relationships directly. Each rule detects one concrete,
 * mechanical pairing — the redirector that buys the slow attacker its turn, the
 * weather setter and the ability that keys off the weather, the Ground immunity
 * that gives a Ground-weak partner somewhere to stand. They are scored into the
 * draft and, more importantly, said out loud on the card, because "Rage Powder
 * buys Baxcalibur the turn it needs" is a reason a player can agree or disagree
 * with, and "fills a Bug-type coverage gap" usually is not.
 */

export interface Synergy {
  id: string;
  /** How much this pairing is worth, roughly on the same scale as a role slot. */
  weight: number;
  /** Reads as "<candidate> …" in the draft card. */
  describe: (candidate: string, partner: string) => string;
}

export interface SynergyHit extends Synergy {
  /** Index into the team of the Pokémon this pairs with. */
  partnerIndex: number;
  partnerName: string;
}

interface Side {
  set: PokemonSet;
  types: string[];
  ability: string;
  baseStats: { hp: number; atk: number; def: number; spa: number; spd: number; spe: number };
  moveIds: Set<string>;
  offense: number;
  physicalBulk: number;
}

function sideOf(set: PokemonSet, format: FormatRules): Side | null {
  const form = resolveForm(set, format);
  if (!form) return null;
  const s = form.baseStats;
  return {
    set,
    types: form.types,
    ability: toID(form.ability),
    baseStats: s,
    moveIds: new Set(set.moves.filter(Boolean).map((m) => toID(m))),
    offense: Math.max(s.atk, s.spa),
    physicalBulk: s.hp + s.def,
  };
}

const REDIRECTION = ['followme', 'ragepowder', 'spotlight'];
const SCREENS = ['reflect', 'lightscreen', 'auroraveil'];
const SETUP = [
  'swordsdance', 'nastyplot', 'dragondance', 'calmmind', 'bulkup', 'victorydance',
  'tidyup', 'irondefense', 'agility',
];

/** Weather, the ability or move that sets it, and the abilities that cash it in. */
const WEATHER_PAIRS: {
  weather: string;
  setters: string[];
  setterMoves: string[];
  payoffAbilities: string[];
  boostedType: string;
}[] = [
  {
    weather: 'sun',
    setters: ['drought', 'orichalcumpulse'],
    setterMoves: ['sunnyday'],
    payoffAbilities: ['chlorophyll', 'solarpower', 'flowergift', 'leafguard', 'protosynthesis'],
    boostedType: 'Fire',
  },
  {
    weather: 'rain',
    setters: ['drizzle'],
    setterMoves: ['raindance'],
    payoffAbilities: ['swiftswim', 'dryskin', 'raindish', 'hydration'],
    boostedType: 'Water',
  },
  {
    weather: 'sand',
    setters: ['sandstream'],
    setterMoves: ['sandstorm'],
    payoffAbilities: ['sandrush', 'sandforce', 'sandveil'],
    boostedType: 'Rock',
  },
  {
    weather: 'snow',
    setters: ['snowwarning'],
    setterMoves: ['snowscape'],
    payoffAbilities: ['slushrush', 'icebody', 'snowcloak'],
    boostedType: 'Ice',
  },
];

const TERRAIN_PAIRS: { setters: string[]; payoffMoves: string[]; label: string }[] = [
  { setters: ['grassysurge'], payoffMoves: ['grassyglide'], label: 'Grassy Terrain' },
  { setters: ['electricsurge'], payoffMoves: ['risingvoltage'], label: 'Electric Terrain' },
  { setters: ['psychicsurge'], payoffMoves: ['expandingforce'], label: 'Psychic Terrain' },
];

/**
 * Moves that are conditional on weather, and what the weather does for them.
 *
 * These are the most obvious partnerships in the game and the easiest to miss
 * mechanically: an Archaludon with Electro Shot is asking for a Drizzle partner in
 * a way no coverage table will ever show, because without rain the move spends a
 * turn charging and with it the move is simply better than everything else it
 * could be doing.
 */
const WEATHER_DEPENDENT: Record<string, { weather: string; effect: string }> = {
  electroshot: { weather: 'rain', effect: 'fires the turn it is used instead of charging' },
  solarbeam: { weather: 'sun', effect: 'fires the turn it is used instead of charging' },
  solarblade: { weather: 'sun', effect: 'fires the turn it is used instead of charging' },
  thunder: { weather: 'rain', effect: 'stops missing' },
  hurricane: { weather: 'rain', effect: 'stops missing' },
  blizzard: { weather: 'snow', effect: 'stops missing' },
  auroraveil: { weather: 'snow', effect: 'works at all' },
  growth: { weather: 'sun', effect: 'raises two stages instead of one' },
  synthesis: { weather: 'sun', effect: 'heals two thirds instead of half' },
  morningsun: { weather: 'sun', effect: 'heals two thirds instead of half' },
  moonlight: { weather: 'sun', effect: 'heals two thirds instead of half' },
  weatherball: { weather: 'any', effect: 'doubles in power and changes type' },
};

const WEATHER_LABEL: Record<string, string> = {
  sun: 'sun', rain: 'rain', sand: 'sand', snow: 'snow',
};

/**
 * The weather this Pokémon's moves are asking for, if any. Used by plan inference:
 * a team carrying Electro Shot is telling you it wants rain before you have chosen
 * anything at all.
 */
export function weatherWantedBy(set: PokemonSet, format: FormatRules): string | null {
  const side = sideOf(set, format);
  if (!side) return null;
  for (const [id, need] of Object.entries(WEATHER_DEPENDENT)) {
    if (side.moveIds.has(id) && need.weather !== 'any') return need.weather;
  }
  return null;
}

/** Which weather does this side set, if any? */
function weatherSetBy(side: Side): string | null {
  for (const w of WEATHER_PAIRS) {
    if (w.setters.includes(side.ability) || has(side, w.setterMoves)) return w.weather;
  }
  return null;
}

/** A move on this side that wants a particular weather, and what it gains. */
function weatherWanted(side: Side, weather: string): { move: string; effect: string } | null {
  for (const [id, need] of Object.entries(WEATHER_DEPENDENT)) {
    if (!side.moveIds.has(id)) continue;
    if (need.weather !== 'any' && need.weather !== weather) continue;
    return { move: id, effect: need.effect };
  }
  return null;
}

const has = (side: Side, ids: string[]) => ids.some((id) => side.moveIds.has(id));

/**
 * Every rule is written from the candidate's point of view: "does adding C to a
 * team that already contains M make either of them better?" Both directions are
 * checked, because the drafter does not control which one arrives first.
 */
const RULES: {
  synergy: Synergy;
  detect: (candidate: Side, partner: Side) => boolean;
}[] = [
  {
    synergy: {
      id: 'redirection-cover',
      weight: 26,
      describe: (c, p) => `${p}'s redirection buys ${c} the free turn its damage needs.`,
    },
    detect: (c, p) => has(p, REDIRECTION) && (c.offense >= 110 || has(c, SETUP)) && c.baseStats.spe <= 100,
  },
  {
    synergy: {
      id: 'redirection-give',
      weight: 26,
      describe: (c, p) => `Redirection: ${c} pulls attacks off ${p}, which needs a turn to do its damage.`,
    },
    detect: (c, p) => has(c, REDIRECTION) && (p.offense >= 110 || has(p, SETUP)),
  },
  {
    synergy: {
      id: 'intimidate-cover',
      weight: 20,
      describe: (c, p) => `${c}'s Intimidate is worth most next to ${p}, which does not want to take physical hits.`,
    },
    detect: (c, p) => c.ability === 'intimidate' && p.physicalBulk <= 150,
  },
  {
    synergy: {
      id: 'weather-payoff',
      weight: 34,
      describe: (c, p) => `${p} sets the weather ${c} is built to use.`,
    },
    detect: (c, p) => WEATHER_PAIRS.some((w) =>
      (w.setters.includes(p.ability) || has(p, w.setterMoves)) &&
      (w.payoffAbilities.includes(c.ability) || c.types.includes(w.boostedType))),
  },
  {
    synergy: {
      id: 'weather-setter',
      weight: 34,
      describe: (c, p) => `${c} sets the weather ${p} is built to use.`,
    },
    detect: (c, p) => WEATHER_PAIRS.some((w) =>
      (w.setters.includes(c.ability) || has(c, w.setterMoves)) &&
      (w.payoffAbilities.includes(p.ability) || p.types.includes(w.boostedType))),
  },
  {
    synergy: {
      id: 'weather-enables-move',
      weight: 40,
      describe: (c, p) => `${c} sets the weather that makes ${p}'s move work.`,
    },
    detect: (c, p) => {
      const weather = weatherSetBy(c);
      return !!weather && !!weatherWanted(p, weather);
    },
  },
  {
    synergy: {
      id: 'move-wants-weather',
      weight: 40,
      describe: (c, p) => `${p}'s weather is what ${c}'s moves were written for.`,
    },
    detect: (c, p) => {
      const weather = weatherSetBy(p);
      return !!weather && !!weatherWanted(c, weather);
    },
  },
  {
    synergy: {
      id: 'trickroom-payoff',
      weight: 30,
      describe: (c, p) => `${p} sets Trick Room and ${c} is slow enough to move first under it.`,
    },
    detect: (c, p) => p.moveIds.has('trickroom') && c.baseStats.spe <= 60 && c.offense >= 100,
  },
  {
    synergy: {
      id: 'trickroom-setter',
      weight: 30,
      describe: (c, p) => `${c} sets the Trick Room that turns ${p}'s Speed into an advantage.`,
    },
    detect: (c, p) => c.moveIds.has('trickroom') && p.baseStats.spe <= 60 && p.offense >= 100,
  },
  {
    synergy: {
      id: 'tailwind-payoff',
      weight: 22,
      describe: (c, p) => `${p}'s Tailwind puts ${c} ahead of the whole metagame for four turns.`,
    },
    detect: (c, p) => p.moveIds.has('tailwind') && c.baseStats.spe >= 70 && c.baseStats.spe <= 120 &&
      c.offense >= 105,
  },
  {
    synergy: {
      id: 'immunity-switchin',
      weight: 24,
      describe: (c, p) => `${c} is immune to a type ${p} is weak to — somewhere to stand when it comes down.`,
    },
    detect: (c, p) => {
      for (const type of ['Ground', 'Electric', 'Water', 'Fire', 'Grass', 'Flying']) {
        const cImmune = effectiveness(type, c.types) === 0 || IMMUNITY_ABILITY[c.ability] === type;
        if (cImmune && effectiveness(type, p.types) >= 2) return true;
      }
      return false;
    },
  },
  {
    synergy: {
      id: 'fakeout-window',
      weight: 16,
      describe: (c, p) => `${p}'s Fake Out is the turn ${c} uses to set up or fire its slowest move.`,
    },
    detect: (c, p) => p.moveIds.has('fakeout') && (has(c, SETUP) || c.moveIds.has('trickroom')),
  },
  {
    synergy: {
      id: 'screens-offense',
      weight: 18,
      describe: (c, p) => `${p}'s screens are what let ${c} survive long enough to attack twice.`,
    },
    detect: (c, p) => has(p, SCREENS) && c.offense >= 110 && c.physicalBulk <= 160,
  },
  {
    synergy: {
      id: 'terrain-payoff',
      weight: 24,
      describe: (c, p) => `${p}'s terrain is what ${c}'s moves are written for.`,
    },
    detect: (c, p) => TERRAIN_PAIRS.some((t) =>
      (t.setters.includes(p.ability) && has(c, t.payoffMoves)) ||
      (t.setters.includes(c.ability) && has(p, t.payoffMoves))),
  },
  {
    synergy: {
      id: 'friend-guard',
      weight: 20,
      describe: (_c, p) => `Friend Guard takes a quarter off everything aimed at ${p}.`,
    },
    detect: (c, p) => c.ability === 'friendguard' && p.offense >= 100,
  },
  {
    synergy: {
      id: 'helping-hand',
      weight: 16,
      describe: (c, p) => `${p}'s Helping Hand turns ${c}'s strongest move into a KO.`,
    },
    detect: (c, p) => p.moveIds.has('helpinghand') && c.offense >= 115,
  },
];

const IMMUNITY_ABILITY: Record<string, string> = {
  levitate: 'Ground', eartheater: 'Ground',
  voltabsorb: 'Electric', lightningrod: 'Electric', motordrive: 'Electric',
  waterabsorb: 'Water', stormdrain: 'Water', dryskin: 'Water',
  flashfire: 'Fire', wellbakedbody: 'Fire',
  sapsipper: 'Grass', windrider: 'Flying',
};

/** Every pairing this candidate would form with the team as it stands. */
export function synergiesWith(
  candidate: PokemonSet,
  team: PokemonSet[],
  format: FormatRules,
  nameOf: (set: PokemonSet) => string,
): SynergyHit[] {
  const c = sideOf(candidate, format);
  if (!c) return [];
  const out: SynergyHit[] = [];
  const seen = new Set<string>();

  team.forEach((member, i) => {
    const p = sideOf(member, format);
    if (!p || member === candidate) return;
    for (const rule of RULES) {
      if (seen.has(rule.synergy.id)) continue;
      if (!rule.detect(c, p)) continue;
      seen.add(rule.synergy.id);
      out.push({
        ...rule.synergy,
        // The weather rules can name the move and the effect, which reads far
        // better than the generic sentence.
        describe: describeWeather(rule.synergy, c, p) ?? rule.synergy.describe,
        partnerIndex: i,
        partnerName: nameOf(member),
      });
    }
  });

  return out.sort((a, b) => b.weight - a.weight);
}

function describeWeather(synergy: Synergy, c: Side, p: Side): Synergy['describe'] | null {
  const setter = synergy.id === 'weather-enables-move' ? c : p;
  const user = synergy.id === 'weather-enables-move' ? p : c;
  if (synergy.id !== 'weather-enables-move' && synergy.id !== 'move-wants-weather') return null;
  const weather = weatherSetBy(setter);
  if (!weather) return null;
  const want = weatherWanted(user, weather);
  if (!want) return null;
  const moveName = getMove(want.move)?.name ?? want.move;
  const label = WEATHER_LABEL[weather] ?? weather;
  return synergy.id === 'weather-enables-move'
    ? (cand, partner) => `${cand}'s ${label} is what makes ${partner}'s ${moveName} work — it ${want.effect}.`
    : (cand, partner) => `${partner}'s ${label} makes ${cand}'s ${moveName} work — it ${want.effect}.`;
}

/** The score contribution of those pairings, with diminishing returns. */
export function synergyScore(hits: SynergyHit[]): number {
  let total = 0;
  hits.forEach((hit, i) => {
    total += hit.weight * (i === 0 ? 1 : i === 1 ? 0.6 : 0.3);
  });
  return total;
}

/**
 * How connected a finished team is: the share of its members that take part in at
 * least one pairing. A team of six good Pokémon that never help each other scores
 * zero here, which is the point.
 */
export function cohesion(team: PokemonSet[], format: FormatRules): number {
  if (team.length < 2) return 0;
  const connected = new Set<number>();
  team.forEach((member: PokemonSet, i: number) => {
    for (const hit of synergiesWith(member, team, format, () => '')) {
      connected.add(i);
      connected.add(hit.partnerIndex);
    }
  });
  return Math.round((connected.size / team.length) * 100);
}
