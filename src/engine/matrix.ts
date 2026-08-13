import type {
  CombatantState, DamageResult, FieldState, FormatRules, PokemonSet, ThreatSet,
} from '../types';
import { emptyEVs, maxIVs } from '../types';
import { calcAllMoves, defaultCombatant, displayName } from './calc';
import type { MoveDamage } from './calc';
import { resolveForm } from './stats';
import { computeSpeed, defaultScenario } from './speed';

/** Turn a threat definition into a full set the engine can use. */
export function threatToSet(threat: ThreatSet, level: number): PokemonSet {
  return {
    id: threat.id,
    species: threat.species,
    nickname: threat.name,
    item: threat.item,
    ability: threat.ability,
    level,
    nature: threat.nature,
    evs: { ...emptyEVs(), ...threat.evs },
    ivs: { ...maxIVs(), ...(threat.ivs ?? {}) },
    moves: [...threat.moves],
  };
}

export interface Matchup {
  /** Best move my Pokémon has into the threat. */
  offense: MoveDamage | null;
  offenseAll: MoveDamage[];
  /** Best move the threat has into my Pokémon. */
  defense: MoveDamage | null;
  defenseAll: MoveDamage[];
  /** true when my Pokémon is faster in the given speed scenario. */
  faster: boolean;
  tied: boolean;
  /** Net verdict for the cell. */
  verdict: Verdict;
  /** The Pokémon has no damaging moves yet, so the verdict means nothing. */
  incomplete: boolean;
}

export type Verdict = 'winning' | 'favourable' | 'even' | 'unfavourable' | 'losing' | 'unset';

function hits(r: DamageResult | null | undefined): number {
  if (!r || r.max <= 0) return 99;
  return r.hitsToKO || 99;
}

function verdictOf(m: Omit<Matchup, 'verdict' | 'incomplete'>): Verdict {
  const mine = hits(m.offense?.result);
  const theirs = hits(m.defense?.result);
  if (mine === 99 && theirs === 99) return 'even';
  if (mine === 99) return 'losing';
  if (theirs === 99) return 'winning';

  // Being faster is worth roughly half a turn.
  const myTurns = mine - (m.faster ? 0.5 : 0);
  const theirTurns = theirs - (m.faster ? 0 : 0.5);
  const diff = theirTurns - myTurns;
  if (diff >= 1.5) return 'winning';
  if (diff >= 0.5) return 'favourable';
  if (diff > -0.5) return 'even';
  if (diff > -1.5) return 'unfavourable';
  return 'losing';
}

export interface MatrixOptions {
  format: FormatRules;
  field: FieldState;
  /** Applied to your Pokémon (e.g. -1 Atk from an opposing Intimidate). */
  myState?: CombatantState;
  theirState?: CombatantState;
  tailwind?: boolean;
  trickRoom?: boolean;
}

export interface ThreatMatrix {
  threats: PokemonSet[];
  /** cells[teamIndex][threatIndex] */
  cells: Matchup[][];
}

export function buildMatrix(
  team: PokemonSet[],
  threatSets: PokemonSet[],
  opts: MatrixOptions,
): ThreatMatrix {
  const { format, field } = opts;
  const myState = opts.myState ?? defaultCombatant();
  const theirState = opts.theirState ?? defaultCombatant();

  const myScenario = { ...defaultScenario(), tailwind: !!opts.tailwind, trickRoom: !!opts.trickRoom };
  const theirScenario = { ...defaultScenario(), trickRoom: !!opts.trickRoom };

  const attackField = field;
  // Swap sides so screens/Helping Hand land on the correct half of the field.
  const defendField: FieldState = {
    ...field,
    attackerSide: field.defenderSide,
    defenderSide: field.attackerSide,
  };

  const cells = team.map((mine) => {
    const mySpeed = computeSpeed(mine, format, myScenario).final;
    return threatSets.map((theirs) => {
      const theirSpeed = computeSpeed(theirs, format, theirScenario).final;
      const offenseAll = calcAllMoves(mine, theirs, format, attackField, myState, theirState);
      const defenseAll = calcAllMoves(theirs, mine, format, defendField, theirState, myState);
      const partial = {
        offense: pickBest(offenseAll),
        offenseAll,
        defense: pickBest(defenseAll),
        defenseAll,
        faster: opts.trickRoom ? mySpeed < theirSpeed : mySpeed > theirSpeed,
        tied: mySpeed === theirSpeed,
      };
      const incomplete = !offenseAll.length;
      return {
        ...partial,
        incomplete,
        verdict: (incomplete ? 'unset' : verdictOf(partial)) as Verdict,
      };
    });
  });

  return { threats: threatSets, cells };
}

function pickBest(all: MoveDamage[]): MoveDamage | null {
  if (!all.length) return null;
  return [...all].sort((a, b) => {
    const ah = hits(a.result);
    const bh = hits(b.result);
    if (ah !== bh) return ah - bh;
    return b.result.maxPct - a.result.maxPct;
  })[0];
}

export interface ThreatSummary {
  threatIndex: number;
  name: string;
  /** Slots that can OHKO this threat. */
  koers: number[];
  /** Slots this threat can OHKO. */
  victims: number[];
  /** Best answer on the team, or null when nothing handles it. */
  bestAnswer: number | null;
  worstVerdict: Verdict;
  /** 0 (handled) … 100 (nothing on the team beats it). */
  pressure: number;
}

const VERDICT_SCORE: Record<Verdict, number> = {
  winning: 0, favourable: 25, even: 50, unfavourable: 75, losing: 100, unset: 100,
};

export function summariseThreats(
  matrix: ThreatMatrix,
  team: PokemonSet[],
  format: FormatRules,
  usage: number[],
): ThreatSummary[] {
  return matrix.threats.map((threat, t) => {
    const koers: number[] = [];
    const victims: number[] = [];
    let best: number | null = null;
    let bestScore = Infinity;
    let worst: Verdict = 'winning';

    team.forEach((_, i) => {
      const cell = matrix.cells[i]?.[t];
      if (!cell || cell.incomplete) return;
      if (cell.offense && hits(cell.offense.result) === 1) koers.push(i);
      if (cell.defense && hits(cell.defense.result) === 1) victims.push(i);
      const score = VERDICT_SCORE[cell.verdict];
      if (score < bestScore) { bestScore = score; best = i; }
      if (score > VERDICT_SCORE[worst]) worst = cell.verdict;
    });

    const form = resolveForm(threat, format);
    return {
      threatIndex: t,
      name: threat.nickname || displayName(form?.species.name ?? threat.species),
      koers,
      victims,
      bestAnswer: team.length ? best : null,
      worstVerdict: worst,
      // Weight the danger by how common the threat is.
      pressure: Math.round((bestScore === Infinity ? 100 : bestScore) * (usage[t] / 100)),
    };
  });
}

export function teamPressureScore(summaries: ThreatSummary[]): number {
  if (!summaries.length) return 0;
  const avg = summaries.reduce((a, s) => a + s.pressure, 0) / summaries.length;
  return Math.round(100 - avg);
}
