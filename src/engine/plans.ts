import type { FieldState } from '../types';

/**
 * Game plans the drafter can build towards.
 *
 * A VGC team is not six individually good Pokémon, it is a plan plus the pieces
 * that serve it. So the drafter picks (or is told) a plan first, and every later
 * decision — species, moves, items, spreads — is scored against it. This is also
 * where the "surprise me" lever lives: an unusual plan produces an unusual team
 * far more reliably than randomising individual picks does.
 */

export type PlanId = 'balance' | 'tailwind' | 'trickroom' | 'sun' | 'rain' | 'bulky';

export type RoleKey =
  | 'speedControl' | 'fakeOut' | 'intimidate' | 'redirection' | 'protect'
  | 'spread' | 'priority' | 'recovery' | 'screens' | 'trickRoom';

export interface Plan {
  id: PlanId;
  label: string;
  /** One line, shown on the plan selector. */
  blurb: string;
  /** How the team intends to win the speed war. */
  tempo: 'fast' | 'slow' | 'neutral';
  /** Moves that set the plan up. A team needs at least one carrier. */
  enablerMoves: string[];
  /** Abilities that set the plan up. */
  enablerAbilities: string[];
  /** Abilities that cash the plan in once it is up. */
  payoffAbilities: string[];
  /** Weather the plan plays under, so calcs and item choices see it. */
  weather: FieldState['weather'];
  /** Roles this plan wants more than usual. */
  roleWeights: Partial<Record<RoleKey, number>>;
  /** How far off the beaten path the plan is; used to gate it behind the spice dial. */
  exotic: number;
}

export const PLANS: Plan[] = [
  {
    id: 'balance',
    label: 'Balanced goodstuff',
    blurb: 'Strong pieces, Intimidate and Fake Out support, one mode of speed control.',
    tempo: 'neutral',
    enablerMoves: ['Tailwind', 'Icy Wind', 'Thunder Wave'],
    enablerAbilities: [],
    payoffAbilities: [],
    weather: '',
    roleWeights: { fakeOut: 1.2, intimidate: 1.2, protect: 1, speedControl: 1.4 },
    exotic: 0,
  },
  {
    id: 'tailwind',
    label: 'Tailwind offense',
    blurb: 'Set Tailwind, then run everything over inside four turns.',
    tempo: 'fast',
    enablerMoves: ['Tailwind'],
    enablerAbilities: ['Wind Rider'],
    payoffAbilities: [],
    weather: '',
    roleWeights: { speedControl: 2, fakeOut: 1.2, spread: 1.4, redirection: 1.1 },
    exotic: 0.15,
  },
  {
    id: 'trickroom',
    label: 'Trick Room',
    blurb: 'Invert the speed order and swing with Pokémon that are too slow to play fair.',
    tempo: 'slow',
    enablerMoves: ['Trick Room'],
    enablerAbilities: [],
    payoffAbilities: ['Sheer Force', 'Huge Power', 'Pure Power'],
    weather: '',
    roleWeights: { trickRoom: 2.4, redirection: 1.5, fakeOut: 1.3, protect: 1.2 },
    exotic: 0.35,
  },
  {
    id: 'sun',
    label: 'Sun offense',
    blurb: 'Drought, then Fire moves nothing survives and Chlorophyll sweepers.',
    tempo: 'fast',
    enablerMoves: ['Sunny Day'],
    enablerAbilities: ['Drought', 'Orichalcum Pulse'],
    payoffAbilities: ['Chlorophyll', 'Solar Power', 'Flower Gift', 'Leaf Guard'],
    weather: 'Sun',
    roleWeights: { spread: 1.5, protect: 1.1, speedControl: 1.1 },
    exotic: 0.3,
  },
  {
    id: 'rain',
    label: 'Rain offense',
    blurb: 'Drizzle, Swift Swim, and water moves that do not care what resists them.',
    tempo: 'fast',
    enablerMoves: ['Rain Dance'],
    enablerAbilities: ['Drizzle'],
    payoffAbilities: ['Swift Swim', 'Dry Skin', 'Water Absorb', 'Hydration'],
    weather: 'Rain',
    roleWeights: { spread: 1.4, protect: 1.1, redirection: 1.1 },
    exotic: 0.45,
  },
  {
    id: 'bulky',
    label: 'Bulky control',
    blurb: 'Win the long game: Intimidate, redirection, chip and recovery.',
    tempo: 'neutral',
    enablerMoves: ['Icy Wind', 'Thunder Wave', 'Tailwind'],
    enablerAbilities: [],
    payoffAbilities: ['Regenerator', 'Friend Guard'],
    weather: '',
    roleWeights: {
      intimidate: 1.8, redirection: 1.6, recovery: 1.5, protect: 1.4, screens: 1.2,
    },
    exotic: 0.2,
  },
];

export function getPlan(id: PlanId): Plan {
  return PLANS.find((p) => p.id === id) ?? PLANS[0];
}
