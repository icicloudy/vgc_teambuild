import type { FormatRules, PokemonSet } from '../types';
import { toID } from '../data/dex';
import { resolveForm } from './stats';
import { statsOf } from './calc';
import { displayName } from './calc';

export interface SpeedScenario {
  boost: number;
  tailwind: boolean;
  paralysis: boolean;
  weather: '' | 'Sun' | 'Rain' | 'Sand' | 'Snow';
  trickRoom: boolean;
  /** Apply the Pokémon's own speed-doubling ability when its condition is met. */
  useAbility: boolean;
  useItem: boolean;
}

export function defaultScenario(): SpeedScenario {
  return {
    boost: 0, tailwind: false, paralysis: false, weather: '', trickRoom: false,
    useAbility: true, useItem: true,
  };
}

const BOOST_MULTIPLIER: Record<number, number> = {
  [-6]: 2 / 8, [-5]: 2 / 7, [-4]: 2 / 6, [-3]: 2 / 5, [-2]: 2 / 4, [-1]: 2 / 3,
  0: 1, 1: 3 / 2, 2: 4 / 2, 3: 5 / 2, 4: 6 / 2, 5: 7 / 2, 6: 8 / 2,
};

const WEATHER_SPEED_ABILITIES: Record<string, string> = {
  swiftswim: 'Rain',
  chlorophyll: 'Sun',
  sandrush: 'Sand',
  slushrush: 'Snow',
};

export interface SpeedBreakdown {
  base: number;
  final: number;
  applied: string[];
}

export function computeSpeed(
  set: PokemonSet,
  format: FormatRules,
  scenario: SpeedScenario,
): SpeedBreakdown {
  const stats = statsOf(set, format);
  const form = resolveForm(set, format);
  const base = stats?.spe ?? 0;
  let value = base;
  const applied: string[] = [];

  const boost = Math.max(-6, Math.min(6, scenario.boost));
  if (boost !== 0) {
    value = Math.floor(value * BOOST_MULTIPLIER[boost]);
    applied.push(`${boost > 0 ? '+' : ''}${boost}`);
  }

  const abilityId = toID(form?.ability ?? '');
  if (scenario.useAbility) {
    const need = WEATHER_SPEED_ABILITIES[abilityId];
    if (need && scenario.weather === need) {
      value = Math.floor(value * 2);
      applied.push(form!.ability);
    } else if (abilityId === 'unburden') {
      value = Math.floor(value * 2);
      applied.push('Unburden');
    } else if (abilityId === 'quickfeet' && scenario.paralysis) {
      value = Math.floor(value * 1.5);
      applied.push('Quick Feet');
    } else if (abilityId === 'surgesurfer') {
      value = Math.floor(value * 2);
      applied.push('Surge Surfer');
    }
  }

  if (scenario.useItem) {
    const item = toID(set.item);
    if (item === 'choicescarf') {
      value = Math.floor(value * 1.5);
      applied.push('Choice Scarf');
    } else if (item === 'ironball' || item === 'machobrace' || item === 'poweranklet') {
      value = Math.floor(value * 0.5);
      applied.push('Speed-lowering item');
    }
  }

  if (scenario.tailwind) {
    value = Math.floor(value * 2);
    applied.push('Tailwind');
  }

  // Quick Feet ignores the paralysis drop; everything else eats it.
  if (scenario.paralysis && abilityId !== 'quickfeet') {
    value = Math.floor(value * 0.5);
    applied.push('Paralysis');
  }

  return { base, final: value, applied };
}

export interface SpeedRow {
  key: string;
  label: string;
  species: string;
  speed: number;
  base: number;
  applied: string[];
  source: 'team' | 'threat';
  slot?: number;
}

export function buildSpeedRows(
  team: PokemonSet[],
  threats: PokemonSet[],
  format: FormatRules,
  teamScenario: SpeedScenario,
  threatScenario: SpeedScenario,
): SpeedRow[] {
  const rows: SpeedRow[] = [];
  team.forEach((set, i) => {
    const form = resolveForm(set, format);
    const s = computeSpeed(set, format, teamScenario);
    rows.push({
      key: `team-${set.id}`,
      label: set.nickname || displayName(form?.species.name ?? set.species),
      species: form?.species.name ?? set.species,
      speed: s.final,
      base: s.base,
      applied: s.applied,
      source: 'team',
      slot: i,
    });
  });
  threats.forEach((set) => {
    const form = resolveForm(set, format);
    const s = computeSpeed(set, format, threatScenario);
    rows.push({
      key: `threat-${set.id}`,
      label: set.nickname || displayName(form?.species.name ?? set.species),
      species: form?.species.name ?? set.species,
      speed: s.final,
      base: s.base,
      applied: s.applied,
      source: 'threat',
    });
  });
  const dir = teamScenario.trickRoom ? 1 : -1;
  return rows.sort((a, b) => (a.speed - b.speed) * dir);
}

/** Fraction of `threats` that `set` moves before (ties excluded). */
export function outspeedShare(
  set: PokemonSet,
  threats: PokemonSet[],
  format: FormatRules,
  teamScenario: SpeedScenario,
  threatScenario: SpeedScenario,
): { faster: number; tied: number; total: number } {
  const mine = computeSpeed(set, format, teamScenario).final;
  let faster = 0;
  let tied = 0;
  for (const t of threats) {
    const theirs = computeSpeed(t, format, threatScenario).final;
    if (teamScenario.trickRoom ? mine < theirs : mine > theirs) faster++;
    else if (mine === theirs) tied++;
  }
  return { faster, tied, total: threats.length };
}
