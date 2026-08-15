import type { FieldState, FormatRules, PokemonSet, ThreatSet } from '../types';
import { STATS } from '../types';
import { effectiveness, getMove, getSpecies, learnsetSync, toID } from '../data/dex';
import type { Species, TypeName } from '../data/dex';
import { legalMegas, speciesCatalogue } from '../data/roster';
import type { RosterOverride } from '../data/roster';
import { displayName } from './calc';
import { defensiveProfile, roleReport, teamTypeTable } from './coverage';
import { buildMatrix, threatToSet } from './matrix';
import { computeSpeed, defaultScenario } from './speed';
import { resolveForm } from './stats';
import { buildSet, planIsUp, rolesOfSet, teamRoleCount, uncoveredTypes } from './setgen';
import type { DraftThreat, SetContext } from './setgen';
import { synergiesWith, synergyScore, cohesion, weatherWantedBy } from './synergy';
import type { SynergyHit } from './synergy';
import { PLANS, getPlan } from './plans';
import type { Plan, PlanId, RoleKey } from './plans';

/**
 * The drafter: finish a team from whatever is already in it.
 *
 * Two ideas hold the whole thing together.
 *
 * The first is that "what is missing" is only answerable against the metagame,
 * so the deciding term in the score is a real one: every shortlisted candidate is
 * given a full set, run through the same damage matrix the Threat tab uses, and
 * scored on *how much it improves the team's worst answer to each threat*. A
 * Pokémon that beats things you already beat scores nothing.
 *
 * The second is that a team is a plan, not a pile. The drafter commits to a game
 * plan first (see plans.ts) and every pick is scored against it, which is also
 * what lets the spice dial produce something genuinely different rather than
 * randomly worse.
 */

export interface DraftOptions {
  plan: PlanId | 'auto';
  /** 0 = the chalk answer, 1 = show me something I have not seen. */
  spice: number;
  /** Species the user rejected; never drafted again this session. */
  banned: string[];
  seed: number;
}

export type ReasonKind =
  | 'threat' | 'synergy' | 'defense' | 'offense' | 'role' | 'speed' | 'plan' | 'spice'
  | 'complete';

export interface DraftReason {
  kind: ReasonKind;
  text: string;
}

export interface DraftPick {
  /** Index in the finished team. */
  slot: number;
  set: PokemonSet;
  species: string;
  /** 'new' — drafted into an empty slot. 'completed' — your Pokémon, finished off. */
  kind: 'new' | 'completed';
  reasons: DraftReason[];
  /** Set-level notes from the synthesis step (why this item, why these points). */
  notes: string[];
  alternates: { species: string; note: string }[];
  score: number;
}

export interface TeamShape {
  offense: number;
  bulk: number;
  speed: number;
  coverage: number;
  support: number;
  resilience: number;
  cohesion: number;
}

export const SHAPE_AXES: { key: keyof TeamShape; label: string; hint: string }[] = [
  { key: 'offense', label: 'Offense', hint: 'How quickly the team takes threats down' },
  { key: 'bulk', label: 'Bulk', hint: 'How long it survives the metagame’s best hits' },
  { key: 'speed', label: 'Speed', hint: 'Share of the metagame it moves before' },
  { key: 'coverage', label: 'Coverage', hint: 'Types it can hit for super-effective damage' },
  { key: 'support', label: 'Support', hint: 'Speed control, Fake Out, redirection, Protect…' },
  { key: 'resilience', label: 'Resilience', hint: 'Freedom from stacked shared weaknesses' },
  {
    key: 'cohesion',
    label: 'Cohesion',
    hint: 'Share of the team that works with another member rather than beside it',
  },
];

export interface DraftResult {
  plan: Plan;
  planReason: string;
  picks: DraftPick[];
  /** Kept members plus the drafted ones, in slot order. */
  team: PokemonSet[];
  before: TeamShape;
  after: TeamShape;
  headline: string;
  /** Milliseconds spent, and how many real damage calculations it took. */
  elapsedMs: number;
}

/* ------------------------------------------------------------------ *
 * Deterministic randomness
 *
 * Rerolling a slot must give a different answer; redrawing the same slot with
 * the same seed must give the same one. A seeded generator does both.
 * ------------------------------------------------------------------ */

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------------ *
 * Threat preparation
 * ------------------------------------------------------------------ */

export function prepareThreats(threats: ThreatSet[], format: FormatRules): DraftThreat[] {
  const scenario = defaultScenario();
  return threats.map((t) => {
    const set = threatToSet(t, format.level);
    const form = resolveForm(set, format);
    const damaging = set.moves
      .map((m) => getMove(m))
      .filter((m) => !!m && m.category !== 'Status');
    const physical = damaging.filter((m) => m!.category === 'Physical').length;
    return {
      set,
      usage: t.usage,
      types: form?.types ?? [],
      speed: computeSpeed(set, format, scenario).final,
      physicalShare: damaging.length ? physical / damaging.length : 0.5,
    };
  });
}

/** How hard each attacking type presses, weighted by how common its users are. */
function attackPressure(threats: DraftThreat[]): Map<TypeName, number> {
  const out = new Map<TypeName, number>();
  for (const t of threats) {
    for (const name of t.set.moves) {
      const move = getMove(name);
      if (!move || move.category === 'Status' || move.basePower <= 0) continue;
      const type = move.type as TypeName;
      const stab = t.types.includes(move.type) ? 1.5 : 1;
      out.set(type, (out.get(type) ?? 0) + t.usage * stab);
    }
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Plan selection
 * ------------------------------------------------------------------ */

function planFit(plan: Plan, team: PokemonSet[], format: FormatRules): number {
  let score = 0;
  let speedSum = 0;
  let members = 0;

  for (const member of team) {
    const form = resolveForm(member, format);
    if (!form) continue;
    members++;
    speedSum += form.baseStats.spe;
    const ability = toID(form.ability);
    if (plan.enablerAbilities.some((a) => toID(a) === ability)) score += 90;
    if (plan.payoffAbilities.some((a) => toID(a) === ability)) score += 55;
    for (const name of member.moves) {
      const id = toID(name);
      if (!id) continue;
      if (plan.enablerMoves.some((m) => toID(m) === id)) score += 70;
    }
    // A move that only works under a particular weather is the strongest possible
    // statement about what plan this team wants: Electro Shot means rain.
    const wants = weatherWantedBy(member, format);
    if (wants && toID(plan.weather) === toID(wants)) score += 110;
  }

  if (members) {
    const meanSpeed = speedSum / members;
    if (plan.tempo === 'fast') score += (meanSpeed - 80) * 0.6;
    if (plan.tempo === 'slow') score += (78 - meanSpeed) * 1.1;
  }
  return score;
}

function choosePlan(
  team: PokemonSet[],
  format: FormatRules,
  options: DraftOptions,
  random: () => number,
): { plan: Plan; reason: string } {
  if (options.plan !== 'auto') {
    const plan = getPlan(options.plan);
    return { plan, reason: `You asked for ${plan.label.toLowerCase()}.` };
  }

  const scored = PLANS.map((plan) => {
    const fit = planFit(plan, team, format);
    // Off-beat plans are gated behind the spice dial rather than hidden: at zero
    // spice the drafter plays the percentages, at full spice it will commit.
    const gate = (1 - options.spice) * plan.exotic * 150;
    const jitter = random() * options.spice * 90;
    return { plan, score: fit - gate + jitter, fit };
  }).sort((a, b) => b.score - a.score);

  const winner = scored[0];
  const evidence = team.length
    ? describePlanEvidence(winner.plan, team, format)
    : options.spice >= 0.6
      ? 'nothing on the team yet, and you asked for spice'
      : 'an empty team, so the drafter starts from the safest plan';
  return {
    plan: winner.plan,
    reason: `${winner.plan.label} — ${evidence}.`,
  };
}

function describePlanEvidence(plan: Plan, team: PokemonSet[], format: FormatRules): string {
  const carriers: string[] = [];
  for (const member of team) {
    const form = resolveForm(member, format);
    if (!form) continue;
    const ability = toID(form.ability);
    const name = member.nickname || displayName(form.species.name);
    if (plan.enablerAbilities.some((a) => toID(a) === ability) ||
        plan.payoffAbilities.some((a) => toID(a) === ability)) {
      carriers.push(`${name}'s ${form.ability}`);
    }
    for (const moveName of member.moves) {
      if (plan.enablerMoves.some((m) => toID(m) === toID(moveName))) {
        carriers.push(`${moveName} on ${name}`);
      }
    }
  }
  if (carriers.length) return `you already have ${carriers.slice(0, 2).join(' and ')}`;

  const speeds = team
    .map((m) => resolveForm(m, format)?.baseStats.spe ?? 0)
    .filter((s) => s > 0);
  const mean = speeds.length ? speeds.reduce((a, b) => a + b, 0) / speeds.length : 0;
  if (plan.tempo === 'slow') return `your core averages base ${Math.round(mean)} Speed, which is too slow to play fair`;
  if (plan.tempo === 'fast') return `your core averages base ${Math.round(mean)} Speed and wants to move first`;
  return 'it is the best fit for what you have';
}

/**
 * How much of the metagame each uncovered type actually accounts for.
 *
 * "Nothing on the team hits Bug super-effectively" is only a problem if somebody
 * brings a Bug type. Weighting the gaps by usage stops the drafter chasing holes
 * that do not exist, which is most of them.
 */
function metagameShareOf(gaps: Set<TypeName>, threats: DraftThreat[]): Map<TypeName, number> {
  const total = threats.reduce((a, t) => a + t.usage, 0) || 1;
  const out = new Map<TypeName, number>();
  for (const gap of gaps) {
    const share = threats.reduce(
      (a, t) => a + (t.types.includes(gap) ? t.usage : 0),
      0,
    ) / total;
    out.set(gap, share);
  }
  return out;
}

/**
 * Which side of the offensive split the team attacks from. A team that is all
 * special folds to one specially bulky Pokémon, so the drafter tracks it.
 */
function offensiveSplit(team: PokemonSet[], format: FormatRules): number {
  let special = 0;
  let counted = 0;
  for (const member of team) {
    const stats = resolveForm(member, format)?.baseStats;
    if (!stats) continue;
    const physicalMoves = member.moves.filter((m) => getMove(m)?.category === 'Physical').length;
    const specialMoves = member.moves.filter((m) => getMove(m)?.category === 'Special').length;
    const isSpecial = physicalMoves === specialMoves
      ? stats.spa > stats.atk
      : specialMoves > physicalMoves;
    counted++;
    if (isSpecial) special++;
  }
  return counted ? special / counted : 0.5;
}

/* ------------------------------------------------------------------ *
 * Candidate scoring
 * ------------------------------------------------------------------ */

interface Candidate {
  species: Species;
  confidence: string;
  bst: number;
  relevance: number;
  moveIds: Set<string>;
  abilities: string[];
}

const ROLE_MOVE_IDS: Record<RoleKey, string[]> = {
  pivot: ['partingshot', 'uturn', 'voltswitch', 'flipturn'],
  speedControl: ['tailwind', 'icywind', 'electroweb', 'thunderwave', 'nuzzle'],
  trickRoom: ['trickroom'],
  fakeOut: ['fakeout'],
  redirection: ['followme', 'ragepowder', 'spotlight'],
  protect: ['protect', 'detect', 'spikyshield', 'burningbulwark', 'silktrap'],
  screens: ['reflect', 'lightscreen', 'auroraveil'],
  recovery: ['recover', 'roost', 'softboiled', 'synthesis', 'moonlight', 'morningsun', 'slackoff', 'strengthsap'],
  spread: [],
  priority: [],
  intimidate: [],
};

/** The roles a doubles team genuinely cannot do without. */
const CORE_ROLES = new Set<RoleKey>([
  'speedControl', 'fakeOut', 'redirection', 'intimidate', 'trickRoom', 'pivot',
]);

const ROLE_TEXT: Record<RoleKey, string> = {
  pivot: 'a pivot move',
  speedControl: 'speed control',
  trickRoom: 'Trick Room',
  fakeOut: 'Fake Out',
  redirection: 'redirection',
  protect: 'Protect',
  screens: 'screens',
  recovery: 'recovery',
  spread: 'spread damage',
  priority: 'priority',
  intimidate: 'Intimidate',
};

/** Abilities that are a net negative; a species with nothing else is unbuildable. */
const ABILITY_PENALTY: Record<string, number> = {
  truant: -1, slowstart: -1, defeatist: -1, stall: -1, klutz: -1, normalize: -1,
};

const learnsetIdCache = new Map<string, Set<string>>();
function moveIdsOf(species: string): Set<string> {
  const cached = learnsetIdCache.get(species);
  if (cached) return cached;
  const ids = new Set((learnsetSync(species) ?? []).map((m) => toID(m)));
  learnsetIdCache.set(species, ids);
  return ids;
}

function buildCandidates(
  format: FormatRules,
  override: RosterOverride | null,
): Candidate[] {
  const out: Candidate[] = [];
  for (const entry of speciesCatalogue(format, override)) {
    if (entry.confidence === 'excluded') continue;
    if (entry.species.nfe) continue;
    /*
     * The drafter only proposes Pokémon that are *confirmed* to be in Champions.
     *
     * The roster is curated and not published in machine-readable form, so the
     * app's "probably in the roster" tier is a guess — and a guess is fine on a
     * badge next to a name you typed yourself, but not fine coming from a tool
     * that says "add this to your team". Suggesting something that does not exist
     * in the game wastes more of your time than a slightly narrower shortlist
     * does. Import your in-game roster from the Roster panel and this opens up to
     * exactly what you own.
     */
    if (entry.confidence !== 'confirmed') continue;
    if (entry.bst < 430) continue;
    out.push({
      species: entry.species,
      confidence: entry.confidence,
      bst: entry.bst,
      relevance: entry.relevance,
      moveIds: moveIdsOf(entry.species.name),
      abilities: entry.species.abilities,
    });
  }
  return out;
}

interface ScoreContext {
  format: FormatRules;
  team: PokemonSet[];
  plan: Plan;
  threats: DraftThreat[];
  pressure: Map<TypeName, number>;
  spice: number;
  /** Usage-weighted total of `pressure`, for normalising. */
  pressureTotal: number;
  gaps: Set<TypeName>;
  roles: Record<string, number>;
  megaUsed: boolean;
  meanSpeed: number;
  /** Precomputed once per slot: it is read by every candidate. */
  table: ReturnType<typeof teamTypeTable>;
  /** Share of the metagame each uncovered type accounts for, 0–1. */
  gapWeight: Map<TypeName, number>;
  /** Whether anything on the team already sets the plan up. */
  planUp: boolean;
  /** Share of the team that attacks from the special side, 0–1. */
  specialShare: number;
}


function makeScoreContext(
  team: PokemonSet[],
  format: FormatRules,
  threats: DraftThreat[],
  plan: Plan,
  spice: number,
): ScoreContext {
  const pressure = attackPressure(threats);
  const pressureTotal = [...pressure.values()].reduce((a, b) => a + b, 0) || 1;
  const table = teamTypeTable(team, format);
  // Types nothing on the team hits for super-effective damage — the same measure
  // the set builder uses, so a "no Ground coverage" claim means one thing only.
  const gaps = uncoveredTypes(team);
  const speeds = team.map((m) => resolveForm(m, format)?.baseStats.spe ?? 0).filter(Boolean);
  return {
    format,
    team,
    plan,
    threats,
    pressure,
    pressureTotal,
    spice,
    gaps,
    roles: teamRoleCount(team, format),
    megaUsed: team.some((m) => !!resolveForm(m, format)?.mega),
    meanSpeed: speeds.length ? speeds.reduce((a, b) => a + b, 0) / speeds.length : 0,
    table,
    gapWeight: metagameShareOf(gaps, threats),
    planUp: planIsUp(team, plan, format),
    specialShare: offensiveSplit(team, format),
  };
}

interface ScoreBreakdown {
  total: number;
  defense: number;
  offense: number;
  role: number;
  plan: number;
  speed: number;
  spice: number;
  /** Types this candidate resists that the team is stacked weak to. */
  patchedTypes: TypeName[];
  /** Offensive types it brings that the team did not have. */
  newCoverage: TypeName[];
}

/**
 * Everything that can be judged without a damage calculation. Cheap enough to run
 * over the whole legal roster, which is what makes the expensive stage affordable.
 */
function cheapScore(cand: Candidate, ctx: ScoreContext): ScoreBreakdown {
  const types = cand.species.types;
  const stats = cand.species.baseStats;

  /* ---- Defensive glue ------------------------------------------------ */
  const table = ctx.table;
  let defense = 0;
  const patched: TypeName[] = [];
  for (const row of table) {
    const weight = (ctx.pressure.get(row.type) ?? 0) / ctx.pressureTotal;
    if (weight <= 0) continue;
    const mult = effectiveness(row.type, types);
    const teamWeak = row.weak.length;
    const teamCovers = row.resist.length + row.immune.length;

    if (mult < 1) {
      // Resisting matters most where the team is weak and nothing else resists.
      const need = teamWeak + (teamCovers === 0 ? 1.5 : 0);
      defense += weight * need * (mult === 0 ? 90 : 60);
      if (teamWeak >= 2 && teamCovers === 0) patched.push(row.type);
    } else if (mult > 1) {
      defense -= weight * (1 + teamWeak) * 45;
    }
  }
  // Raw bulk still counts: a resistance on a Pokémon that folds is not a resistance.
  defense += (stats.hp + stats.def + stats.spd - 260) * 0.12;

  /* ---- Offensive gaps ------------------------------------------------ */
  let offense = 0;
  const newCoverage: TypeName[] = [];
  for (const gap of ctx.gaps) {
    const hits = [...cand.moveIds].some((id) => {
      const move = getMove(id);
      return !!move && move.category !== 'Status' && move.basePower >= 70 &&
        effectiveness(move.type, [gap]) >= 2;
    });
    if (!hits) continue;
    // Worth something in proportion to how much of the metagame the gap covers.
    // A hole nothing walks through is not a hole.
    offense += 60 * (ctx.gapWeight.get(gap) ?? 0);
    if ((ctx.gapWeight.get(gap) ?? 0) > 0) newCoverage.push(gap);
  }
  offense += (Math.max(stats.atk, stats.spa) - 90) * 0.55;
  // Stacking one attacking side means one bulky Pokémon walls the whole team.
  if (ctx.team.length >= 2) {
    const candidateIsSpecial = stats.spa > stats.atk;
    const share = candidateIsSpecial ? ctx.specialShare : 1 - ctx.specialShare;
    if (share >= 0.6) offense -= (share - 0.5) * 90;
  }

  /* ---- Roles --------------------------------------------------------- */
  let role = 0;
  for (const key of Object.keys(ROLE_MOVE_IDS) as RoleKey[]) {
    const ids = ROLE_MOVE_IDS[key];
    const canDo = key === 'intimidate'
      ? cand.abilities.some((a) => toID(a) === 'intimidate')
      : ids.some((id) => cand.moveIds.has(id));
    if (!canDo) continue;
    const held = ctx.roles[key] ?? 0;
    const want = ctx.plan.roleWeights[key] ?? 1;
    if (held === 0) {
      role += (CORE_ROLES.has(key) ? 42 : 20) * want;
    } else if (held === 1) {
      role += 6 * want;
    }
  }

  /* ---- Plan fit ------------------------------------------------------ */
  let plan = 0;
  const hasEnablerMove = ctx.plan.enablerMoves.some((m) => cand.moveIds.has(toID(m)));
  const hasEnablerAbility = ctx.plan.enablerAbilities.some(
    (a) => cand.abilities.some((c) => toID(c) === toID(a)),
  );
  const hasPayoff = ctx.plan.payoffAbilities.some(
    (a) => cand.abilities.some((c) => toID(c) === toID(a)),
  );
  /*
   * A weather ability and a weather move are not the same thing. Drizzle is free,
   * arrives on turn one and never has to be re-used; Rain Dance costs a move slot
   * on somebody and a turn you wanted for something else. When the plan needs a
   * carrier, the ability is worth far more than the move — which is why a rain
   * team should be reaching for Pelipper rather than teaching Rain Dance to
   * whatever happens to be fastest.
   */
  if (hasEnablerAbility) plan += ctx.planUp ? 30 : 200;
  if (hasEnablerMove) plan += ctx.planUp ? 10 : 40;
  if (hasPayoff) plan += 60;

  /* ---- Speed --------------------------------------------------------- */
  let speed = 0;
  if (ctx.plan.tempo === 'fast') speed += (stats.spe - 85) * 0.5;
  else if (ctx.plan.tempo === 'slow') speed += (70 - stats.spe) * 0.7;
  else if (ctx.meanSpeed > 0) {
    // Balanced teams want a spread of speed tiers, not five Pokémon in one bracket.
    speed += Math.min(28, Math.abs(stats.spe - ctx.meanSpeed) * 0.35);
  }

  /* ---- Spice --------------------------------------------------------- */
  // "Obvious" is the relevance ordering the species picker already uses; novelty is
  // its inverse. At spice 0 this is a penalty on the exotic, at spice 1 a bonus.
  const novelty = Math.max(0, Math.min(1, (620 - cand.relevance) / 420));
  const spice = (ctx.spice - 0.35) * novelty * 150;

  const megaBonus = !ctx.megaUsed && legalMegas(cand.species.name, ctx.format).length ? 34 : 0;

  // A Pokémon whose only ability actively loses it the game is not a candidate,
  // whatever its stat line says. Slaking has a 670 base stat total and Truant.
  const bestAbility = Math.max(...cand.abilities.map((a) => ABILITY_PENALTY[toID(a)] ?? 0), 0);
  const abilityDrag = bestAbility === 0 && cand.abilities.every((a) => ABILITY_PENALTY[toID(a)] !== undefined)
    ? -150
    : 0;

  return {
    total: defense + offense + role + plan + speed + spice + megaBonus + abilityDrag,
    defense, offense, role, plan, speed, spice,
    patchedTypes: patched,
    newCoverage,
  };
}

/* ------------------------------------------------------------------ *
 * The expensive stage: real damage calculations
 * ------------------------------------------------------------------ */

const VERDICT_SCORE: Record<string, number> = {
  winning: 0, favourable: 25, even: 50, unfavourable: 75, losing: 100, unset: 100,
};

interface Measurement {
  /** Per-threat verdict scores, 0 (beats it) … 100 (loses to it). */
  scores: number[];
  /** Threats whose best move cannot take this Pokémon down in two hits. */
  walls: { name: string; usage: number; hits: number; move: string }[];
}

/** One Pokémon against the whole threat list, measured rather than estimated. */
function measureAgainst(
  set: PokemonSet,
  threats: DraftThreat[],
  format: FormatRules,
  field: FieldState,
): Measurement {
  const matrix = buildMatrix([set], threats.map((t) => t.set), { format, field });
  const scores: number[] = [];
  const walls: Measurement['walls'] = [];

  threats.forEach((threat, i) => {
    const cell = matrix.cells[0]?.[i];
    if (!cell || cell.incomplete) {
      scores.push(100);
      return;
    }
    scores.push(VERDICT_SCORE[cell.verdict] ?? 100);
    const taken = cell.defense?.result;
    if (taken && taken.hitsToKO >= 3 && taken.max > 0) {
      walls.push({
        name: threat.set.nickname || threat.set.species,
        usage: threat.usage,
        hits: taken.hitsToKO,
        move: cell.defense!.move,
      });
    }
  });

  walls.sort((a, b) => b.usage - a.usage);
  return { scores, walls };
}

/** The team's current best answer to each threat. */
function teamBaseline(
  team: PokemonSet[],
  threats: DraftThreat[],
  format: FormatRules,
  field: FieldState,
): number[] {
  if (!team.length) return threats.map(() => 100);
  const matrix = buildMatrix(team, threats.map((t) => t.set), { format, field });
  return threats.map((_, i) => {
    let best = 100;
    for (let m = 0; m < team.length; m++) {
      const cell = matrix.cells[m]?.[i];
      if (!cell || cell.incomplete) continue;
      best = Math.min(best, VERDICT_SCORE[cell.verdict] ?? 100);
    }
    return best;
  });
}

/* ------------------------------------------------------------------ *
 * Team shape
 * ------------------------------------------------------------------ */

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

export function teamShape(
  team: PokemonSet[],
  threats: DraftThreat[],
  format: FormatRules,
  field: FieldState,
): TeamShape {
  if (!team.length) {
    return { offense: 0, bulk: 0, speed: 0, coverage: 0, support: 0, resilience: 0, cohesion: 0 };
  }
  const matrix = buildMatrix(team, threats.map((t) => t.set), { format, field });
  const weightTotal = threats.reduce((a, t) => a + t.usage, 0) || 1;

  let offense = 0;
  let bulk = 0;
  let speed = 0;
  threats.forEach((threat, t) => {
    let bestHits = 99;
    let longestSurvival = 0;
    let faster = 0;
    let counted = 0;
    team.forEach((_, m) => {
      const cell = matrix.cells[m]?.[t];
      if (!cell) return;
      counted++;
      if (cell.offense && cell.offense.result.hitsToKO > 0) {
        bestHits = Math.min(bestHits, cell.offense.result.hitsToKO);
      }
      const taken = cell.defense?.result.hitsToKO ?? 99;
      longestSurvival = Math.max(longestSurvival, taken === 0 ? 99 : taken);
      if (cell.faster) faster++;
    });
    const w = threat.usage / weightTotal;
    offense += w * (bestHits <= 1 ? 100 : bestHits === 2 ? 72 : bestHits === 3 ? 42 : 12);
    bulk += w * (longestSurvival >= 4 ? 100 : longestSurvival === 3 ? 74 : longestSurvival === 2 ? 44 : 10);
    speed += w * (counted ? (faster / counted) * 100 : 0);
  });

  const table = teamTypeTable(team, format);
  const coverage = (table.filter((r) => r.offense.length > 0).length / table.length) * 100;

  const roles = roleReport(team, format);
  const roleChecks = [
    roles.speedControl.length > 0,
    roles.fakeOut.length > 0,
    roles.intimidate.length > 0 || roles.redirection.length > 0,
    roles.protect.length >= Math.min(3, team.length),
    roles.spread.length > 0,
    roles.priority.length > 0,
    roles.recovery.length > 0 || roles.screens.length > 0,
  ];
  const support = (roleChecks.filter(Boolean).length / roleChecks.length) * 100;

  let resilience = 100;
  for (const row of table) {
    const uncovered = row.resist.length + row.immune.length === 0;
    if (row.weak.length >= 2 && uncovered) resilience -= row.weak.length * 9;
    else if (row.weak.length >= 3) resilience -= (row.weak.length - 2) * 5;
  }

  return {
    offense: clamp(offense),
    bulk: clamp(bulk),
    speed: clamp(speed),
    coverage: clamp(coverage),
    support: clamp(support),
    resilience: clamp(resilience),
    cohesion: clamp(cohesion(team, format)),
  };
}

/* ------------------------------------------------------------------ *
 * The draft
 * ------------------------------------------------------------------ */

export interface DraftInput {
  team: PokemonSet[];
  format: FormatRules;
  threats: ThreatSet[];
  field: FieldState;
  override: RosterOverride | null;
  options: DraftOptions;
}

/**
 * A full set for one species in the context of a team — what the panel needs when
 * you take an alternate instead of the drafter's first choice.
 */
export function draftOne(species: string, input: DraftInput) {
  const threats = prepareThreats(input.threats, input.format);
  const plan = input.options.plan === 'auto'
    ? choosePlan(input.team, input.format, input.options, rng(input.options.seed)).plan
    : getPlan(input.options.plan);
  return buildSet(
    species,
    setContext(input.team, plan, threats, input.format, input.options.spice, {
      tuned: true,
      seed: input.options.seed,
    }),
  );
}

export function draftTeam(input: DraftInput): DraftResult {
  const started = Date.now();
  const { format, field: baseField, override, options } = input;
  const random = rng(options.seed);

  const kept = input.team.filter((m) => !!getSpecies(m.species));
  const threats = prepareThreats(input.threats, format);
  const { plan, reason: planReason } = choosePlan(kept, format, options, random);
  // Plan weather is part of the plan: a sun team is measured in the sun.
  const field: FieldState = plan.weather ? { ...baseField, weather: plan.weather } : baseField;

  const before = teamShape(kept, threats, format, field);
  const picks: DraftPick[] = [];
  const team: PokemonSet[] = kept.map((m) => ({ ...m, sp: { ...m.sp }, moves: [...m.moves] }));

  /* ---- 1. Finish what the user started ------------------------------ */
  team.forEach((member, i) => {
    const gaps = missingParts(member);
    if (!gaps.length) return;
    const ctx = setContext(
      team.filter((_, j) => j !== i), plan, threats, format, options.spice,
      { tuned: true, seed: options.seed + i },
    );
    const generated = buildSet(member.species, ctx, member);
    team[i] = generated.set;
    picks.push({
      slot: i,
      set: generated.set,
      species: generated.set.species,
      kind: 'completed',
      reasons: [{
        kind: 'complete',
        text: `Your ${displayName(member.species)}, finished: ${gaps.join(', ')}.`,
      }],
      notes: generated.notes,
      alternates: [],
      score: 0,
    });
  });

  /* ---- 2. Draft the empty slots ------------------------------------- */
  const banned = new Set(options.banned.map((b) => toID(b)));
  const pool = buildCandidates(format, override);
  const slotsToFill = Math.max(0, format.bring - team.length);

  for (let n = 0; n < slotsToFill; n++) {
    const ctx = makeScoreContext(team, format, threats, plan, options.spice);
    const baseline = teamBaseline(team, threats, format, field);
    const usedNums = new Set(
      team.map((m) => getSpecies(m.species)?.num).filter((x): x is number => x !== undefined),
    );

    let eligible = pool.filter(
      (c) => !banned.has(toID(c.species.name)) &&
        !usedNums.has(c.species.num) &&
        !team.some((m) => toID(m.species) === toID(c.species.name)),
    );
    if (!eligible.length) break;

    /*
     * A plan built on weather needs its setter, and it needs it as an ability
     * rather than as a move somebody had to give up a slot for. Until the team has
     * one, that is what this slot is for — the same way a human builds rain by
     * picking Pelipper first and working out the rest afterwards. Without this the
     * scoring happily drafts the best attacker available and teaches it Rain Dance.
     */
    if (plan.enablerAbilities.length && !planIsUp(team, plan, format)) {
      const setters = eligible.filter((c) => c.abilities.some(
        (a) => plan.enablerAbilities.some((e) => toID(e) === toID(a)),
      ));
      if (setters.length) eligible = setters;
    }

    const shortlist = eligible
      .map((cand) => ({ cand, breakdown: cheapScore(cand, ctx) }))
      .sort((a, b) => b.breakdown.total - a.breakdown.total)
      .slice(0, SHORTLIST);

    // Only the shortlist gets the expensive treatment: a real set, and a real
    // matrix against the metagame.
    const measured = shortlist.map(({ cand, breakdown }) => {
      const setCtx = setContext(team, plan, threats, format, options.spice, {
        seed: options.seed + team.length,
      });
      const generated = buildSet(cand.species.name, setCtx);
      const measured = measureAgainst(generated.set, threats, format, field);
      const row = measured.scores;
      // Credit only the roles the finished set actually carries. What a Pokémon
      // *could* learn is not what it brought.
      // Only roles the team genuinely wanted. "Nothing else brings screens" is a
      // fact about the team, not a reason to have drafted this Pokémon.
      const newRoles = rolesOfSet(generated.set, format).filter(
        (r) => (ctx.roles[r] ?? 0) === 0 && r !== 'protect' && CORE_ROLES.has(r) &&
          (r !== 'trickRoom' || plan.tempo === 'slow'),
      );
      const newCoverage = [...ctx.gaps]
        .filter((gap) => (ctx.gapWeight.get(gap) ?? 0) > 0)
        .filter((gap) => generated.set.moves.some((name) => {
          const move = getMove(name);
          return !!move && move.category !== 'Status' && effectiveness(move.type, [gap]) >= 2;
        }));
      // How this Pokémon works *with* the ones already on the team. Computed here
      // rather than in the cheap pass because most pairings depend on the moves,
      // and the moves only exist once the set has been generated.
      const synergies = synergiesWith(
        generated.set, team, format,
        (m) => displayName(resolveForm(m, format)?.species.name ?? m.species),
      );

      let improvement = 0;
      const fixed: { name: string; gain: number }[] = [];
      threats.forEach((threat, i) => {
        const gain = Math.max(0, baseline[i] - row[i]);
        if (gain <= 0) return;
        improvement += (gain * threat.usage) / 100;
        if (baseline[i] >= 50 && row[i] <= 25) {
          fixed.push({ name: threat.set.nickname || threat.set.species, gain: gain * threat.usage });
        }
      });
      fixed.sort((a, b) => b.gain - a.gain);

      return {
        cand,
        breakdown,
        generated,
        improvement,
        fixed,
        newRoles,
        newCoverage,
        synergies,
        walls: measured.walls,
        total: breakdown.total + improvement * MATCHUP_WEIGHT + synergyScore(synergies),
      };
    }).sort((a, b) => b.total - a.total);

    if (!measured.length) break;

    // The spice dial widens the draw: at 0 the drafter always takes the best
    // candidate, at 1 it picks from a handful of near-equals.
    const width = 1 + Math.round(options.spice * 5);
    const chosen = measured[Math.floor(random() * Math.min(width, measured.length))];

    /*
     * The eighteen candidates were compared with rough spreads, because solving a
     * spread properly costs real damage calculations and doing that eighteen times
     * over would not change which one wins. The one that does win gets the full
     * treatment: its Stat Points are solved against actual targets.
     */
    const slot = team.length;
    const finalCtx = setContext(team, plan, threats, format, options.spice, {
      tuned: true,
      seed: options.seed + slot,
    });
    const final = buildSet(chosen.cand.species.name, finalCtx);
    const finalSet = final.set;
    team.push(finalSet);
    picks.push({
      slot,
      set: finalSet,
      species: finalSet.species,
      kind: 'new',
      reasons: explain(chosen, ctx, plan, finalSet),
      // The notes have to describe the set you are looking at, which is the solved
      // one — the rough build's reasoning was about a spread that got thrown away.
      notes: final.notes,
      alternates: measured
        .filter((m) => m !== chosen)
        .slice(0, 3)
        .map((m) => ({
          species: m.cand.species.name,
          note: m.fixed.length
            ? `also answers ${m.fixed[0].name}`
            : m.newRoles.length
              ? `brings ${ROLE_TEXT[m.newRoles[0]]}`
              : 'close on the numbers',
        })),
      score: Math.round(chosen.total),
    });
  }

  const after = teamShape(team, threats, format, field);
  return {
    plan,
    planReason,
    picks,
    team,
    before,
    after,
    headline: headline(before, after, picks),
    elapsedMs: Date.now() - started,
  };
}

const SHORTLIST = 18;
/** How much a real matchup improvement is worth against the heuristic score. */
const MATCHUP_WEIGHT = 2.2;

function setContext(
  team: PokemonSet[],
  plan: Plan,
  threats: DraftThreat[],
  format: FormatRules,
  spice: number,
  opts: { tuned?: boolean; seed?: number } = {},
): SetContext {
  return {
    format,
    team,
    plan,
    threats,
    spice,
    allowMega: format.megaPerBattle > 0 && !team.some((m) => !!resolveForm(m, format)?.mega),
    tuned: opts.tuned,
    seed: opts.seed,
  };
}

/** Which parts of an existing set the user has not filled in. */
export function missingParts(set: PokemonSet): string[] {
  const out: string[] = [];
  const moves = set.moves.filter(Boolean).length;
  if (moves < 4) out.push(moves === 0 ? 'no moves' : `${4 - moves} empty move slots`);
  if (!set.item) out.push('no item');
  if (!set.ability) out.push('no ability');
  if (STATS.every((s) => (set.sp[s] ?? 0) === 0)) out.push('no Stat Points');
  else if (STATS.reduce((n, s) => n + (set.sp[s] ?? 0), 0) < 60) out.push('unspent Stat Points');
  return out;
}

interface Measured {
  cand: Candidate;
  breakdown: ScoreBreakdown;
  generated: { set: PokemonSet };
  improvement: number;
  fixed: { name: string; gain: number }[];
  /** Roles the finished set brings that nothing else on the team does. */
  newRoles: RoleKey[];
  /** Types the finished set can hit for super-effective damage and the team could not. */
  newCoverage: TypeName[];
  /** Pairings this Pokémon forms with the team it is joining. */
  synergies: SynergyHit[];
  /** Threats it simply does not fall to. */
  walls: { name: string; usage: number; hits: number; move: string }[];
}

/** Turn the winning score into the two or three sentences that justify it. */
function explain(
  m: Measured,
  ctx: ScoreContext,
  plan: Plan,
  /** The set that was actually kept, when it differs from the one measured. */
  final?: PokemonSet,
): DraftReason[] {
  const out: DraftReason[] = [];
  const name = displayName(m.generated.set.species);

  if (m.fixed.length) {
    const names = m.fixed.slice(0, 2).map((f) => f.name);
    out.push({
      kind: 'threat',
      text: names.length === 1
        ? `Answers ${names[0]}, which nothing on the team was beating.`
        : `Answers ${names[0]} and ${names[1]}, which nothing on the team was beating.`,
    });
  } else if (m.improvement > 4) {
    out.push({
      kind: 'threat',
      text: 'Improves the team\'s worst matchups across the threat list rather than replaying answers you already have.',
    });
  }

  // Cohesion first: how a Pokémon works with the team is the most useful thing
  // that can be said about it, and the easiest to disagree with.
  for (const hit of m.synergies.slice(0, 2)) {
    out.push({ kind: 'synergy', text: hit.describe(name, hit.partnerName) });
  }

  if (m.breakdown.patchedTypes.length) {
    const types = m.breakdown.patchedTypes.slice(0, 3).join(', ');
    out.push({
      kind: 'defense',
      text: `Resists ${types} — weaknesses stacked on your team with nothing to switch into.`,
    });
  }

  if (m.newRoles.length) {
    const roles = m.newRoles.map((r) => ROLE_TEXT[r]);
    out.push({
      kind: 'role',
      text: `Only source of ${roles.slice(0, 2).join(' and ')} on the team.`,
    });
  }

  if (m.newCoverage.length >= 2) {
    out.push({
      kind: 'offense',
      text: `Hits ${m.newCoverage.slice(0, 3).join(', ')} for super-effective damage — types nothing on the team could touch.`,
    });
  }

  const carries = m.breakdown.plan >= 60
    ? planCarryNote(m, plan, ctx.format, final)
    : null;
  if (carries) {
    out.push({ kind: 'plan', text: `Carries the ${plan.label.toLowerCase()} plan: ${carries}.` });
  }

  const spe = m.cand.species.baseStats.spe;
  if (plan.tempo === 'fast' && spe >= 100) {
    out.push({ kind: 'speed', text: `Base ${spe} Speed — fast enough to use the plan once it is up.` });
  } else if (plan.tempo === 'slow' && spe <= 60) {
    out.push({ kind: 'speed', text: `Base ${spe} Speed — slow enough that Trick Room makes it first.` });
  } else if (ctx.meanSpeed > 0 && spe >= 80 && spe - ctx.meanSpeed >= 30) {
    out.push({
      kind: 'speed',
      text: `Base ${spe} Speed sits in a bracket your team did not cover.`,
    });
  }

  if (m.breakdown.spice > 25) {
    out.push({
      kind: 'spice',
      text: `${name} is not a name you see often in this format — this is the spice dial talking.`,
    });
  }

  if (!out.length) {
    // Never leave a pick unexplained: say plainly that it won on the aggregate.
    out.push({
      kind: 'threat',
      text: `${name} scored highest across the whole threat list rather than on any single matchup.`,
    });
  }
  return out.slice(0, 5);
}

/**
 * What this Pokémon actually contributes to the plan — read off the finished set
 * rather than off what the species *could* have done. Qwilfish can have Swift Swim,
 * but the Qwilfish on the team has Intimidate, and citing the ability it did not
 * take is the drafter explaining a set nobody drafted.
 */
function planCarryNote(
  m: Measured,
  plan: Plan,
  format: FormatRules,
  final?: PokemonSet,
): string | null {
  const carries = (ability: string) =>
    plan.enablerAbilities.some((e) => toID(e) === toID(ability)) ||
    plan.payoffAbilities.some((e) => toID(e) === toID(ability));

  if (final) {
    const ability = resolveForm(final, format)?.ability ?? final.ability;
    if (carries(ability)) return ability;
    const move = plan.enablerMoves.find((e) => final.moves.some((x) => toID(x) === toID(e)));
    return move ?? null;
  }

  const abilityMatch = m.cand.abilities.find(carries);
  if (abilityMatch) return abilityMatch;
  return plan.enablerMoves.find((e) => m.cand.moveIds.has(toID(e))) ?? null;
}

function headline(before: TeamShape, after: TeamShape, picks: DraftPick[]): string {
  const drafted = picks.filter((p) => p.kind === 'new').length;
  const completed = picks.filter((p) => p.kind === 'completed').length;
  const gains = SHAPE_AXES
    .map((a) => ({ label: a.label.toLowerCase(), delta: after[a.key] - before[a.key] }))
    .filter((g) => g.delta > 4)
    .sort((a, b) => b.delta - a.delta);

  const parts: string[] = [];
  if (drafted) parts.push(`${drafted} Pokémon drafted`);
  if (completed) parts.push(`${completed} of yours finished`);
  const head = parts.join(', ') || 'Nothing to add';
  if (!gains.length) return `${head}.`;
  const best = gains.slice(0, 2).map((g) => `${g.label} +${Math.round(g.delta)}`);
  return `${head} — ${best.join(', ')}.`;
}

/** Defensive profile helper used by the panel to explain a finished team. */
export function sharedWeaknesses(team: PokemonSet[], format: FormatRules): TypeName[] {
  const counts = new Map<TypeName, number>();
  for (const member of team) {
    const profile = defensiveProfile(member, format);
    if (!profile) continue;
    for (const t of profile.weaknesses) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return [...counts.entries()].filter(([, n]) => n >= 3).map(([t]) => t);
}
