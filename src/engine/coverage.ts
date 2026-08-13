import type { FormatRules, PokemonSet } from '../types';
import { TYPES, effectiveness, getMove, toID } from '../data/dex';
import type { TypeName } from '../data/dex';
import { resolveForm } from './stats';

/** Ability-driven changes to incoming type effectiveness. */
const ABILITY_IMMUNITIES: Record<string, TypeName[]> = {
  levitate: ['Ground'],
  flashfire: ['Fire'],
  waterabsorb: ['Water'],
  stormdrain: ['Water'],
  dryskin: ['Water'],
  voltabsorb: ['Electric'],
  lightningrod: ['Electric'],
  motordrive: ['Electric'],
  sapsipper: ['Grass'],
  eartheater: ['Ground'],
  wellbakedbody: ['Fire'],
  windrider: ['Flying'],
};

const ABILITY_HALVES: Record<string, TypeName[]> = {
  thickfat: ['Fire', 'Ice'],
  heatproof: ['Fire'],
  waterbubble: ['Fire'],
  purifyingsalt: ['Ghost'],
};

export interface DefensiveProfile {
  types: string[];
  ability: string;
  /** Final multiplier per attacking type, abilities included. */
  matchups: Record<TypeName, number>;
  weaknesses: TypeName[];
  resistances: TypeName[];
  immunities: TypeName[];
}

export function defensiveProfile(set: PokemonSet, format: FormatRules): DefensiveProfile | null {
  const form = resolveForm(set, format);
  if (!form) return null;
  const abilityId = toID(form.ability);
  const matchups = {} as Record<TypeName, number>;
  for (const t of TYPES) {
    let mult = effectiveness(t, form.types);
    if ((ABILITY_IMMUNITIES[abilityId] ?? []).includes(t)) mult = 0;
    if ((ABILITY_HALVES[abilityId] ?? []).includes(t)) mult *= 0.5;
    if (abilityId === 'wonderguard' && mult <= 1) mult = 0;
    matchups[t] = mult;
  }
  return {
    types: form.types,
    ability: form.ability,
    matchups,
    weaknesses: TYPES.filter((t) => matchups[t] > 1),
    resistances: TYPES.filter((t) => matchups[t] > 0 && matchups[t] < 1),
    immunities: TYPES.filter((t) => matchups[t] === 0),
  };
}

export interface TeamTypeRow {
  type: TypeName;
  weak: number[];
  resist: number[];
  immune: number[];
  neutral: number[];
  /** Slots that can hit this type for super-effective damage. */
  offense: number[];
  /** Slots with a STAB damaging move of this type. */
  stab: number[];
}

export function teamTypeTable(team: PokemonSet[], format: FormatRules): TeamTypeRow[] {
  const profiles = team.map((s) => defensiveProfile(s, format));
  const rows: TeamTypeRow[] = [];

  for (const type of TYPES) {
    const row: TeamTypeRow = {
      type, weak: [], resist: [], immune: [], neutral: [], offense: [], stab: [],
    };
    profiles.forEach((p, i) => {
      if (!p) return;
      const m = p.matchups[type];
      if (m === 0) row.immune.push(i);
      else if (m > 1) row.weak.push(i);
      else if (m < 1) row.resist.push(i);
      else row.neutral.push(i);
    });
    rows.push(row);
  }

  // Offensive side: which slots carry a damaging move of each type.
  team.forEach((set, i) => {
    const form = resolveForm(set, format);
    if (!form) return;
    const seen = new Set<string>();
    for (const moveName of set.moves) {
      const move = getMove(moveName);
      if (!move || move.category === 'Status' || move.basePower <= 0) continue;
      if (seen.has(move.type)) continue;
      seen.add(move.type);
      const row = rows.find((r) => r.type === (move.type as TypeName));
      if (!row) continue;
      row.offense.push(i);
      if (form.types.includes(move.type)) row.stab.push(i);
    }
  });

  return rows;
}

/** How well the team's attacking types cover the 18 defensive types. */
export interface OffenseCoverage {
  type: TypeName;
  /** Best multiplier any team member achieves against a mono-type of this type. */
  best: number;
  slots: number[];
}

export function offensiveCoverage(team: PokemonSet[], format: FormatRules): OffenseCoverage[] {
  const attackTypes = team.map((set) => {
    const types = new Set<string>();
    for (const moveName of set.moves) {
      const move = getMove(moveName);
      if (!move || move.category === 'Status' || move.basePower <= 0) continue;
      types.add(move.type);
    }
    return types;
  });
  void format;

  return TYPES.map((defType) => {
    let best = 0;
    const slots: number[] = [];
    attackTypes.forEach((types, i) => {
      let mine = 0;
      for (const t of types) mine = Math.max(mine, effectiveness(t, [defType]));
      if (mine > best) best = mine;
      if (mine >= 2) slots.push(i);
    });
    return { type: defType, best, slots };
  });
}

export interface RoleReport {
  fakeOut: number[];
  redirection: number[];
  speedControl: number[];
  trickRoom: number[];
  intimidate: number[];
  protect: number[];
  priority: number[];
  spread: number[];
  recovery: number[];
  screens: number[];
  weatherSetters: number[];
  terrainSetters: number[];
}

const SPEED_CONTROL = new Set([
  'tailwind', 'icywind', 'electroweb', 'thunderwave', 'bleakwindstorm', 'stringshot',
  'glaciate', 'nuzzle', 'scaryface', 'rocktomb', 'lowsweep', 'cottonspore', 'quash',
]);
const REDIRECTION = new Set(['followme', 'ragepowder', 'spotlight', 'allyswitch']);
const RECOVERY = new Set([
  'recover', 'roost', 'softboiled', 'synthesis', 'moonlight', 'morningsun', 'slackoff',
  'rest', 'painsplit', 'strengthsap', 'shoreup', 'junglehealing', 'lifedew', 'healpulse',
]);
const SCREENS = new Set(['reflect', 'lightscreen', 'auroraveil']);
const WEATHER_MOVES = new Set(['sunnyday', 'raindance', 'sandstorm', 'snowscape', 'hail', 'chillyreception']);
const WEATHER_ABILITIES = new Set(['drought', 'drizzle', 'sandstream', 'snowwarning', 'orichalcumpulse']);
const TERRAIN_MOVES = new Set(['electricterrain', 'grassyterrain', 'psychicterrain', 'mistyterrain']);
const TERRAIN_ABILITIES = new Set(['electricsurge', 'grassysurge', 'psychicsurge', 'mistysurge', 'hadronengine']);

export function roleReport(team: PokemonSet[], format: FormatRules): RoleReport {
  const r: RoleReport = {
    fakeOut: [], redirection: [], speedControl: [], trickRoom: [], intimidate: [],
    protect: [], priority: [], spread: [], recovery: [], screens: [],
    weatherSetters: [], terrainSetters: [],
  };
  team.forEach((set, i) => {
    const form = resolveForm(set, format);
    const abilityId = toID(form?.ability ?? '');
    if (abilityId === 'intimidate') r.intimidate.push(i);
    if (WEATHER_ABILITIES.has(abilityId)) r.weatherSetters.push(i);
    if (TERRAIN_ABILITIES.has(abilityId)) r.terrainSetters.push(i);

    for (const moveName of set.moves) {
      const move = getMove(moveName);
      if (!move) continue;
      const id = move.id;
      if (id === 'fakeout') r.fakeOut.push(i);
      if (REDIRECTION.has(id)) r.redirection.push(i);
      if (SPEED_CONTROL.has(id)) r.speedControl.push(i);
      if (id === 'trickroom') { r.trickRoom.push(i); r.speedControl.push(i); }
      if (id === 'protect' || id === 'detect' || id === 'spikyshield' || id === 'banefulbunker' ||
          id === 'burningbulwark' || id === 'silktrap' || id === 'kingsshield') r.protect.push(i);
      if (move.priority > 0 && move.category !== 'Status') r.priority.push(i);
      if ((move.target === 'allAdjacent' || move.target === 'allAdjacentFoes') &&
          move.category !== 'Status') r.spread.push(i);
      if (RECOVERY.has(id)) r.recovery.push(i);
      if (SCREENS.has(id)) r.screens.push(i);
      if (WEATHER_MOVES.has(id)) r.weatherSetters.push(i);
      if (TERRAIN_MOVES.has(id)) r.terrainSetters.push(i);
    }
  });
  for (const key of Object.keys(r) as (keyof RoleReport)[]) {
    r[key] = [...new Set(r[key])].sort((a, b) => a - b);
  }
  return r;
}
