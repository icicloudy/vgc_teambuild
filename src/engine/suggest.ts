import type { FormatRules, PokemonSet } from '../types';
import { TYPES, bst, effectiveness, getMove, getSpecies, toID } from '../data/dex';
import type { TypeName } from '../data/dex';
import { speciesCatalogue } from '../data/roster';
import type { RosterOverride } from '../data/roster';
import { defensiveProfile, roleReport, teamTypeTable } from './coverage';
import { displayName } from './calc';
import type { ThreatMatrix, ThreatSummary } from './matrix';
import { resolveForm } from './stats';

export type SuggestionKind =
  | 'threat' | 'coverage' | 'role' | 'speed' | 'spread' | 'redundancy' | 'legality';

export interface Suggestion {
  id: string;
  kind: SuggestionKind;
  severity: 'critical' | 'important' | 'minor';
  title: string;
  detail: string;
  /** Optional concrete follow-ups the UI can render as chips. */
  candidates?: string[];
  slots?: number[];
}

/** Attacking types that show up most in the format, used to weight weaknesses. */
const COMMON_ATTACK_TYPES: TypeName[] = [
  'Fire', 'Fighting', 'Ground', 'Fairy', 'Steel', 'Dark', 'Flying', 'Water', 'Ice',
];

export function buildSuggestions(
  team: PokemonSet[],
  format: FormatRules,
  matrix: ThreatMatrix | null,
  summaries: ThreatSummary[],
  override: RosterOverride | null,
): Suggestion[] {
  const out: Suggestion[] = [];
  if (!team.length) return out;

  /* ---- unanswered threats ------------------------------------------- */
  if (matrix) {
    const unanswered = summaries
      .filter((s) => s.worstVerdict !== 'winning' && (s.bestAnswer === null || s.pressure >= 40))
      .sort((a, b) => b.pressure - a.pressure)
      .slice(0, 5);

    for (const s of unanswered) {
      const threat = matrix.threats[s.threatIndex];
      const counters = suggestCounters(threat, team, format, override);
      out.push({
        id: `threat-${s.threatIndex}`,
        kind: 'threat',
        severity: s.pressure >= 60 ? 'critical' : 'important',
        title: `${s.name} is a problem`,
        detail: describeThreat(s.koers.length, s.victims.length),
        candidates: counters,
      });
    }
  }

  /* ---- stacked weaknesses ------------------------------------------- */
  const table = teamTypeTable(team, format);
  for (const row of table) {
    const weight = COMMON_ATTACK_TYPES.includes(row.type) ? 1 : 0.6;
    const threshold = weight === 1 ? 3 : 4;
    if (row.weak.length >= threshold && row.resist.length + row.immune.length === 0) {
      out.push({
        id: `weak-${row.type}`,
        kind: 'coverage',
        severity: row.weak.length >= 4 ? 'critical' : 'important',
        title: `${row.weak.length} Pokémon weak to ${row.type}, nothing resists it`,
        detail:
          `A single spread ${row.type} move hits most of your team for super-effective damage ` +
          'and you have no switch-in that takes it well.',
        slots: row.weak,
        candidates: resistCandidates(row.type, format, override),
      });
    } else if (row.weak.length >= threshold + 1) {
      out.push({
        id: `weak-soft-${row.type}`,
        kind: 'coverage',
        severity: 'minor',
        title: `${row.weak.length} Pokémon weak to ${row.type}`,
        detail: `You do resist it elsewhere, but ${row.type} coverage still hits a lot of the team.`,
        slots: row.weak,
      });
    }
  }

  /* ---- offensive holes ---------------------------------------------- */
  const blanks = table.filter((r) => r.offense.length === 0 && r.stab.length === 0);
  if (blanks.length >= 12) {
    out.push({
      id: 'narrow-coverage',
      kind: 'coverage',
      severity: 'minor',
      title: 'Narrow attacking coverage',
      detail:
        `Your team only attacks with ${18 - blanks.length} of the 18 types. ` +
        'Check the Analysis tab for the types nothing on the team can hit.',
    });
  }

  /* ---- VGC role checks ----------------------------------------------- */
  const roles = roleReport(team, format);
  const full = team.length >= format.bring;

  if (roles.speedControl.length === 0 && full) {
    out.push({
      id: 'no-speed-control',
      kind: 'role',
      severity: 'critical',
      title: 'No speed control',
      detail:
        'Nothing on the team sets Tailwind or Trick Room, or carries Icy Wind / Electroweb / ' +
        'Thunder Wave. Almost every successful VGC team runs at least one.',
    });
  }
  if (roles.protect.length < Math.min(3, team.length) && full) {
    out.push({
      id: 'few-protects',
      kind: 'role',
      severity: 'important',
      title: `Only ${roles.protect.length} Pokémon have Protect`,
      detail:
        'Protect is the highest-value move in doubles: it scouts, stalls Fake Out and ' +
        'buys turns for Trick Room and Tailwind. Most teams run it on 4+ slots.',
    });
  }
  if (roles.fakeOut.length === 0 && full) {
    out.push({
      id: 'no-fake-out',
      kind: 'role',
      severity: 'minor',
      title: 'No Fake Out',
      detail:
        'Fake Out denies a turn of damage and breaks up opposing setup. ' +
        'Incineroar, Mega Kangaskhan and Rillaboom all bring it in this format.',
    });
  }
  if (roles.redirection.length === 0 && roles.intimidate.length === 0 && full) {
    out.push({
      id: 'no-support',
      kind: 'role',
      severity: 'minor',
      title: 'No Intimidate or redirection',
      detail:
        'Your team has no way to soften physical attackers or protect a fragile ' +
        'partner (Follow Me / Rage Powder).',
    });
  }
  if (roles.spread.length === 0 && full) {
    out.push({
      id: 'no-spread',
      kind: 'role',
      severity: 'minor',
      title: 'No spread moves',
      detail:
        'Nothing hits both opposing Pokémon at once, so you will win damage races more slowly ' +
        'than teams with Heat Wave, Earthquake or Rock Slide.',
    });
  }

  /* ---- redundancy ---------------------------------------------------- */
  const megaSlots = team
    .map((s, i) => (resolveForm(s, format)?.mega ? i : -1))
    .filter((i) => i >= 0);
  if (megaSlots.length > format.megaPerBattle && format.megaPerBattle > 0) {
    out.push({
      id: 'mega-overlap',
      kind: 'redundancy',
      severity: 'minor',
      title: `${megaSlots.length} Mega Stones on one team`,
      detail:
        'Legal, but only one Pokémon can Mega Evolve per battle — the other stones are ' +
        'dead item slots unless you deliberately want the choice at team preview.',
      slots: megaSlots,
    });
  }

  const typeCounts = new Map<string, number[]>();
  team.forEach((set, i) => {
    const form = resolveForm(set, format);
    for (const t of form?.types ?? []) {
      if (!typeCounts.has(t)) typeCounts.set(t, []);
      typeCounts.get(t)!.push(i);
    }
  });
  for (const [type, slots] of typeCounts) {
    if (slots.length >= 4) {
      out.push({
        id: `type-stack-${type}`,
        kind: 'redundancy',
        severity: 'minor',
        title: `${slots.length} ${type}-types`,
        detail: 'Heavy type overlap usually means shared weaknesses and shared answers.',
        slots,
      });
    }
  }

  /* ---- spreads ------------------------------------------------------- */
  team.forEach((set, i) => {
    const invested = Object.entries(set.evs).filter(([, v]) => (v ?? 0) > 0);
    const total = invested.reduce((a, [, v]) => a + (v ?? 0), 0);
    if (total === 0) {
      out.push({
        id: `no-evs-${set.id}`,
        kind: 'spread',
        severity: 'important',
        title: `${nameOf(set, format)} has no EVs`,
        detail: 'Use the Optimizer in the slot editor to hit a real defensive or speed benchmark.',
        slots: [i],
      });
    } else if (total < 400) {
      out.push({
        id: `few-evs-${set.id}`,
        kind: 'spread',
        severity: 'minor',
        title: `${nameOf(set, format)} has ${508 - total} EVs left over`,
        detail: 'Unspent EVs are free stats — put them into bulk or a speed benchmark.',
        slots: [i],
      });
    }

    const form = resolveForm(set, format);
    if (!form) return;
    const physical = set.moves.filter((m) => getMove(m)?.category === 'Physical').length;
    const special = set.moves.filter((m) => getMove(m)?.category === 'Special').length;
    const atkEV = set.evs.atk ?? 0;
    const spaEV = set.evs.spa ?? 0;
    if (physical > 0 && special === 0 && spaEV > 0) {
      out.push({
        id: `wasted-spa-${set.id}`,
        kind: 'spread',
        severity: 'minor',
        title: `${nameOf(set, format)} invests in Special Attack but has no special moves`,
        slots: [i],
        detail: `${spaEV} SpA EVs are doing nothing. Move them into bulk or Speed.`,
      });
    }
    if (special > 0 && physical === 0 && atkEV > 0) {
      out.push({
        id: `wasted-atk-${set.id}`,
        kind: 'spread',
        severity: 'minor',
        title: `${nameOf(set, format)} invests in Attack but has no physical moves`,
        slots: [i],
        detail:
          `${atkEV} Atk EVs are doing nothing — and an uninvested Attack stat also means ` +
          'less damage from Foul Play and confusion, which is usually what you want.',
      });
    }
    if (physical === 0 && (set.ivs.atk ?? 31) === 31 && special > 0) {
      out.push({
        id: `atk-iv-${set.id}`,
        kind: 'spread',
        severity: 'minor',
        title: `${nameOf(set, format)} could run 0 Attack IVs`,
        detail: 'It has no physical moves, so 0 Atk IVs reduce confusion and Foul Play damage.',
        slots: [i],
      });
    }
  });

  const order: Record<Suggestion['severity'], number> = { critical: 0, important: 1, minor: 2 };
  return out.sort((a, b) => order[a.severity] - order[b.severity]);
}

/** Plain-language read on a threat, phrased for whichever side is actually losing. */
function describeThreat(koers: number, victims: number): string {
  if (koers === 0 && victims === 0) {
    return 'Neither side can OHKO the other, and it still comes out ahead of everything ' +
      'you have — you win this one on positioning or not at all.';
  }
  if (koers === 0) {
    const who = victims === 1 ? 'one of your Pokémon' : `${victims} of your Pokémon`;
    return `Nothing on the team OHKOes it, and it OHKOes ${who}.`;
  }
  if (victims === 0) {
    const mine = koers === 1 ? 'One of yours' : `${koers} of yours`;
    return `${mine} can OHKO it, but nothing it targets goes down in one hit — expect a long exchange.`;
  }
  const mine = koers === 1 ? 'one of yours' : `${koers} of yours`;
  return `It OHKOes ${victims} of your Pokémon; only ${mine} can OHKO back.`;
}

function nameOf(set: PokemonSet, format: FormatRules): string {
  const form = resolveForm(set, format);
  return set.nickname || displayName(form?.species.name ?? set.species);
}

/**
 * Score the legal roster for Pokémon that answer a specific threat: resist its
 * attacking types, hit it super-effectively, and ideally outspeed it.
 */
export function suggestCounters(
  threat: PokemonSet,
  team: PokemonSet[],
  format: FormatRules,
  override: RosterOverride | null,
  limit = 6,
): string[] {
  const threatForm = resolveForm(threat, format);
  if (!threatForm) return [];

  const threatAttackTypes = new Set<string>();
  for (const moveName of threat.moves) {
    const m = getMove(moveName);
    if (!m || m.category === 'Status' || m.basePower <= 0) continue;
    threatAttackTypes.add(m.type);
  }
  if (!threatAttackTypes.size) for (const t of threatForm.types) threatAttackTypes.add(t);

  const onTeam = new Set(team.map((s) => toID(s.species)));
  const threatSpeed = threatForm.baseStats.spe;

  const confirmed: { name: string; score: number }[] = [];
  const likely: { name: string; score: number }[] = [];
  for (const entry of speciesCatalogue(format, override)) {
    if (entry.confidence === 'excluded' || entry.confidence === 'unverified') continue;
    if (onTeam.has(toID(entry.species.name))) continue;
    if (entry.species.nfe) continue;
    if (entry.bst < 470) continue;

    const types = [...entry.species.types];
    let score = 0;

    // Defensive fit against everything the threat throws.
    for (const at of threatAttackTypes) {
      const mult = effectiveness(at, types);
      if (mult === 0) score += 4;
      else if (mult < 1) score += 2;
      else if (mult > 1) score -= 3;
    }
    // Offensive fit: STAB that hits the threat hard.
    let bestOffense = 0;
    for (const t of types) bestOffense = Math.max(bestOffense, effectiveness(t, threatForm.types));
    if (bestOffense >= 2) score += 3;
    else if (bestOffense === 1) score += 0.5;
    else score -= 1;

    if (entry.species.baseStats.spe > threatSpeed) score += 1.5;
    score += (bst(entry.species) - 500) / 200;
    if (entry.megaCount > 0) score += 0.5;

    if (score > 3) {
      (entry.confidence === 'confirmed' ? confirmed : likely).push({
        name: entry.species.name, score,
      });
    }
  }

  const byScore = (a: { score: number }, b: { score: number }) => b.score - a.score;
  // Only fall back to unverified-roster Pokémon when there aren't enough
  // candidates we are confident actually exist in Champions.
  const picks = confirmed.sort(byScore).slice(0, limit);
  if (picks.length < limit) picks.push(...likely.sort(byScore).slice(0, limit - picks.length));
  return picks.map((s) => s.name);
}

/** Pokémon that resist a type the team is stacked weak to. */
function resistCandidates(
  type: TypeName,
  format: FormatRules,
  override: RosterOverride | null,
  limit = 6,
): string[] {
  const confirmed: { name: string; score: number }[] = [];
  const likely: { name: string; score: number }[] = [];
  for (const entry of speciesCatalogue(format, override)) {
    if (entry.confidence !== 'confirmed' && entry.confidence !== 'likely') continue;
    if (entry.species.nfe || entry.bst < 480) continue;
    const mult = effectiveness(type, [...entry.species.types]);
    if (mult >= 1) continue;
    let score = mult === 0 ? 6 : mult <= 0.25 ? 4 : 2;
    score += (entry.bst - 500) / 150;
    (entry.confidence === 'confirmed' ? confirmed : likely).push({
      name: entry.species.name, score,
    });
  }
  const byScore = (a: { score: number }, b: { score: number }) => b.score - a.score;
  const picks = confirmed.sort(byScore).slice(0, limit);
  if (picks.length < limit) picks.push(...likely.sort(byScore).slice(0, limit - picks.length));
  return picks.map((s) => s.name);
}

/** Types nothing on the team can hit for neutral-or-better damage. */
export function uncoveredTypes(team: PokemonSet[], format: FormatRules): TypeName[] {
  const table = teamTypeTable(team, format);
  void format;
  return TYPES.filter((t) => {
    const row = table.find((r) => r.type === t);
    return !row || row.offense.length === 0;
  });
}

export function teamTypeSummary(team: PokemonSet[], format: FormatRules) {
  return team.map((set) => {
    const profile = defensiveProfile(set, format);
    const species = getSpecies(set.species);
    return {
      name: set.nickname || displayName(resolveForm(set, format)?.species.name ?? set.species),
      species: species?.name ?? set.species,
      weaknesses: profile?.weaknesses ?? [],
      resistances: profile?.resistances ?? [],
      immunities: profile?.immunities ?? [],
    };
  });
}
