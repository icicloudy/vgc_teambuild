import { damageLine, evaluate } from './matchup';
import type { DamageTable, Edge, Matchup } from './matchup';
import { solveLeads, solvePreview } from './solve';
import type { PreviewSolution } from './solve';
import type { Battler } from './battler';

/**
 * Turning the solve into sentences.
 *
 * Rule for this file, and it is the only rule: **no sentence without a number
 * behind it.** Every line below is generated from a term in the matchup — an
 * exchange, an edge, a swap delta, a set probability. If the model cannot
 * measure a thing, the app does not get to claim it.
 *
 * The second rule follows from the first: when the numbers are close, say so.
 * "These two fours are within three points; take the one you have practised" is
 * a more useful sentence than a confident pick that is noise.
 */

export interface BriefLine {
  battler: Battler;
  reason: string;
  /** The number the reason came from, for the tooltip. */
  figure: string;
}

export interface Risk {
  /** 0–1: how likely the deviation is. */
  odds: number;
  headline: string;
  detail: string;
  /** How many points of equity the deviation costs, if it costs any. */
  swing: number;
  /** True when the deviation changes which four you should bring. */
  changesThePick: boolean;
}

export interface Briefing {
  crux: string;
  regime: string;
  bring: BriefLine[];
  bench: BriefLine[];
  lead: Battler[];
  leadReason: string;
  risks: Risk[];
  equity: number;
  worstCase: number;
  /** Set when a second four is close enough that the pick is not really a pick. */
  closeCall: string | null;
  /** Set when their choice barely moves the number, so the read does not matter. */
  readProof: string | null;
}

const sign = (n: number) => (n >= 0 ? `+${Math.round(n)}` : `${Math.round(n)}`);

/* ------------------------------------------------------------------ *
 * The crux — the one thing that decides it
 * ------------------------------------------------------------------ */

/**
 * Both teams can run the same Pokémon — Species Clause is per team, and in a
 * format where Incineroar is on 86% of teams it happens constantly. "Your answer
 * to Whimsicott" is unreadable when you brought one too.
 */
function foeNamer(mine: Battler[]) {
  const shared = new Set(mine.map((b) => b.species));
  return (b: Battler) => (shared.has(b.species) ? `their ${b.species}` : b.species);
}

function crux(m: Matchup, foe: (b: Battler) => string): { text: string; from: string | null } {
  const candidates: { weight: number; text: string; from: string | null }[] = [];

  // A threat with no answer outranks everything else on the board.
  const worstAnswered = m.answers.reduce((a, b) => (b.value < a.value ? b : a));
  if (worstAnswered.value < -0.15 && worstAnswered.exchange) {
    const e = worstAnswered.exchange;
    candidates.push({
      from: null,
      weight: 60 * -worstAnswered.value,
      text: `Their ${worstAnswered.foe.species} is the problem. Your best answer is ${e.mine.species}, ` +
        `and it still needs ${e.myTurns} turns while ${foe(worstAnswered.foe)} needs ${e.theirTurns} ` +
        `— ${e.faster ? 'and it is not even the faster one' : 'moving after it, at that'}.`,
    });
  }

  // Something of yours that nothing of theirs can handle is the mirror of it.
  const bestUnanswered = m.exposure.reduce((a, b) => (b.value > a.value ? b : a));
  if (bestUnanswered.value > 0.25 && bestUnanswered.exchange) {
    candidates.push({
      from: null,
      weight: 50 * bestUnanswered.value,
      text: `${bestUnanswered.mine.species} is the win condition: the best thing they have against it is ` +
        `${bestUnanswered.by ? foe(bestUnanswered.by) : 'nothing'}, and that takes ${bestUnanswered.exchange.theirTurns} turns to do ` +
        `what ${bestUnanswered.mine.species} does in ${bestUnanswered.exchange.myTurns}.`,
    });
  }

  // Or the game is decided by one of the interactions rather than the damage.
  const edge = m.edges.reduce<Edge | null>(
    (a, b) => (!a || Math.abs(b.value) > Math.abs(a.value) ? b : a), null);
  if (edge && Math.abs(edge.value) >= 5) {
    /*
     * Framed rather than quoted. The same fact is about to appear beside the
     * Pokémon that supplies it, and printing one sentence twice on one screen is
     * how a tool looks like it has one thought — so the crux says what *kind* of
     * matchup this is and the roster line says who does it.
     */
    candidates.push({
      weight: Math.abs(edge.value) * 5,
      from: edge.detail,
      text: `This one is not decided by the damage rolls. ${edge.detail}`,
    });
  }

  if (!candidates.length) {
    return {
      from: null,
      text: 'Nothing on the board decides this on its own — it is four even trades, so the lead is ' +
        'where the game actually gets won.',
    };
  }
  const best = candidates.sort((a, b) => b.weight - a.weight)[0];
  return { text: best.text, from: best.from };
}

/* ------------------------------------------------------------------ *
 * Why each of the four is there
 * ------------------------------------------------------------------ */

function bringReason(b: Battler, m: Matchup, foe: (x: Battler) => string): BriefLine {
  // The foe it is the designated answer to.
  const answering = m.answers.filter((a) => a.by === b).sort((x, y) => y.value - x.value)[0];
  // The edge it personally supplies.
  const edge = m.edges
    .filter((e) => e.value > 0 && e.detail.includes(b.species))
    .sort((x, y) => y.value - x.value)[0];
  const mine = m.exposure.find((e) => e.mine === b);

  if (answering && answering.value > 0.15 && answering.exchange) {
    const e = answering.exchange;
    return {
      battler: b,
      reason: `Your answer to ${foe(answering.foe)} — ${damageLine(e.myBest, answering.foe)}, ` +
        `${e.myTurns === 1 ? 'a one-turn answer' : `down in ${e.myTurns}`}` +
        `${e.faster ? ' and it moves first' : ''}.`,
      figure: `exchange ${sign(answering.value * 100)}`,
    };
  }
  if (edge) {
    return { battler: b, reason: edge.detail, figure: `${edge.label} ${sign(edge.value)}` };
  }
  if (mine && mine.value > 0) {
    return {
      battler: b,
      reason: `Nothing in their four handles it: their best is ${mine.by ? foe(mine.by) : 'nothing'}, and that is still ` +
        `${mine.exchange?.theirTurns} turns.`,
      figure: `worst matchup ${sign(mine.value * 100)}`,
    };
  }
  /*
   * Only one Pokémon can be the *designated* answer to each of their four, which
   * leaves teammates that beat things anyway with nothing said about them. Naming
   * the matchup it does best into is still a fact about this Pokémon and this
   * board — falling straight through to "it is the fourth slot" is the tool
   * running out of things to measure and saying so instead of looking harder.
   */
  if (mine?.bestExchange && mine.bestValue > 0 && mine.bestBy) {
    const e = mine.bestExchange;
    const better = m.answers.find((a) => a.foe === mine.bestBy)?.by;
    return {
      battler: b,
      // The "and it does not lose to X" clause is only worth saying when it is
      // true and when X is somebody else — "Garchomp does it without losing to
      // Garchomp" is the model reading its own mirror match back to you.
      reason: `Beats ${foe(mine.bestBy)} as well — ${damageLine(e.myBest, mine.bestBy)}` +
        (better && better !== b ? `, second in line behind ${better.species}` : '') +
        (mine.by && mine.by !== mine.bestBy && mine.value >= -0.2
          ? `, and it holds up against ${foe(mine.by)} too.`
          : '.'),
      figure: `best matchup ${sign(mine.bestValue * 100)}`,
    };
  }
  return {
    battler: b,
    reason: `Nothing here for it to do: its best matchup on this board is ` +
      `${mine?.bestBy ? foe(mine.bestBy) : 'nothing'} and it loses that too. It is in the four ` +
      'because the two you left at home are worse, which is a reason to change your six.',
    figure: `best matchup ${sign((mine?.bestValue ?? 0) * 100)}`,
  };
}

/* ------------------------------------------------------------------ *
 * Why the other two stayed home
 * ------------------------------------------------------------------ */

function benchReasons(
  table: DamageTable,
  mineIdx: number[],
  chosen: number[],
  theirFour: number[],
  baseline: number,
): BriefLine[] {
  const out: BriefLine[] = [];
  for (let pos = 0; pos < mineIdx.length; pos++) {
    if (chosen.includes(pos)) continue;
    const b = table.mine[mineIdx[pos]];

    /*
     * The honest measure of "why not this one" is what happens if you bring it:
     * swap it in for each member of the four in turn and take the best of those
     * teams. If the best of them is still worse, the number is the cost.
     */
    let bestSwap = -Infinity;
    let displaced: Battler | null = null;
    for (const drop of chosen) {
      const swapped = chosen.map((p) => (p === drop ? pos : p));
      const score = evaluate(table, swapped.map((p) => mineIdx[p]), theirFour).score;
      if (score > bestSwap) {
        bestSwap = score;
        displaced = table.mine[mineIdx[drop]];
      }
    }
    const cost = baseline - bestSwap;

    // And the specific reason, where there is one worth naming.
    const solo = evaluate(table, [mineIdx[pos]], theirFour);
    const worst = solo.exposure[0];
    const blanked = solo.edges.filter((e) => e.value < 0 && e.detail.includes(b.species))[0];

    let reason: string;
    if (blanked) {
      reason = blanked.detail;
    } else if (worst && worst.value < -0.4 && worst.exchange) {
      // Six turns is the cap, which means "never" — say never.
      const back = worst.exchange.myTurns >= 6
        ? 'and it cannot get through at all'
        : `against ${worst.exchange.myTurns} turns the other way`;
      reason = `${worst.by?.species} takes it apart — ${damageLine(worst.exchange.theirBest, b)}, ${back}.`;
    } else if (cost < 3) {
      reason = `Genuinely close: bringing it over ${displaced?.species} costs ${cost.toFixed(1)} points. ` +
        'If you know this matchup better with it, bring it.';
    } else {
      reason = `${displaced?.species} does the same job ${cost.toFixed(0)} points better here.`;
    }
    out.push({ battler: b, reason, figure: `−${cost.toFixed(1)} to bring` });
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * What could be wrong
 * ------------------------------------------------------------------ */

export interface Assumption {
  /** Position in their six. */
  slot: number;
  /** Index into the damage table. */
  index: number;
  /** Alternatives for the same species, table indices, with probabilities. */
  alternatives: { index: number; odds: number; battler: Battler }[];
}

/**
 * At preview you can see six species and nothing else, so every number in this
 * app is conditional on a guess about their items and moves. This is where the
 * guess is priced.
 *
 * For each species with more than one plausible set, the whole solve is re-run
 * with that species swapped to the alternative. What comes back is the sentence
 * a good player says out loud: "this is fine unless the Garchomp is Scarf."
 */
function risksOf(
  table: DamageTable,
  mineIdx: number[],
  assumptions: Assumption[],
  base: PreviewSolution,
): Risk[] {
  const baseIdx = assumptions.map((a) => a.index);
  const risks: Risk[] = [];
  const names = (bring: number[]) => bring.map((p) => table.mine[mineIdx[p]].species);

  for (let slot = 0; slot < assumptions.length; slot++) {
    for (const alt of assumptions[slot].alternatives) {
      const swapped = baseIdx.slice();
      swapped[slot] = alt.index;
      const solved = solvePreview(table, mineIdx, swapped);

      const different = solved.pick.bring.join() !== base.pick.bring.join();
      // What the *original* plan is worth once the assumption turns out wrong.
      const rowIdx = solved.game.rows.findIndex((r) => r.join() === base.pick.bring.join());
      const heldValue = rowIdx >= 0
        ? solved.game.payoff[rowIdx].reduce((n, v, j) => n + v * solved.game.colMix[j], 0)
        : solved.pick.vsBest;
      const swing = base.pick.vsBest - heldValue;

      /*
       * The gate is the *cost of being wrong*, not whether the argmax moved.
       * When two fours are within a point of each other, a rounding-sized
       * perturbation flips which one is "best" while changing nothing you would
       * do about it — reporting that as "then this is the wrong four" is the
       * model mistaking its own noise for a read.
       */
      if (Math.abs(swing) < 2.5) continue;
      const changesThePick = different && swing >= 2.5;

      const b = alt.battler;
      const swapTo = names(solved.pick.bring).filter((n) => !names(base.pick.bring).includes(n));
      const swapFrom = names(base.pick.bring).filter((n) => !names(solved.pick.bring).includes(n));

      risks.push({
        odds: alt.odds,
        headline: `${b.species} is the ${b.set.label} set`,
        detail: changesThePick && swapTo.length
          ? `Holding this four costs ${swing.toFixed(0)} points — you would want ` +
            `${swapTo.join(' and ')} over ${swapFrom.join(' and ')}. ${firstSentence(b.set.note)}`
          : swing >= 2.5
            ? `Same four, ${swing.toFixed(0)} points worse. ${firstSentence(b.set.note)}`
            : `Same four, ${(-swing).toFixed(0)} points better for you. ${firstSentence(b.set.note)}`,
        swing,
        changesThePick,
      });
    }
  }

  return risks
    .sort((a, b) => (b.odds * Math.abs(b.swing) + (b.changesThePick ? 6 : 0)) -
      (a.odds * Math.abs(a.swing) + (a.changesThePick ? 6 : 0)))
    .slice(0, 4);
}

/** The measured claim from a set note, without the tail of caveats. */
function firstSentence(note: string): string {
  const first = note.split(/(?<=\.)\s/)[0] ?? note;
  return first.length > 130 ? '' : first;
}

/* ------------------------------------------------------------------ *
 * The briefing
 * ------------------------------------------------------------------ */

export function brief(
  table: DamageTable,
  mineIdx: number[],
  assumptions: Assumption[],
  solution: PreviewSolution,
): Briefing {
  const theirFour = solution.theirLikely.map((j) => assumptions[j].index);
  const chosen = solution.pick.bring;
  const myFour = chosen.map((p) => mineIdx[p]);
  const m = evaluate(table, myFour, theirFour);

  const leads = solveLeads(table, myFour, theirFour);
  const lead = leads.lead.map((i) => table.mine[myFour[i]]);
  const leadRunnerUp = leads.ranked[1];

  /*
   * The lead has to be justified by something the *lead* does. Repeating the
   * crux back is the tell that a tool has one thought and two places to put it,
   * so the reason a whole-team edge already carried is skipped here.
   */
  const foe = foeNamer(mineIdx.map((i) => table.mine[i]));
  const theCrux = crux(m, foe);
  const leadPair = leads.matchup;
  const leadEdge = leadPair.edges
    .filter((e) => e.value >= 4 && e.detail !== theCrux.from)
    .sort((a, b) => b.value - a.value)[0];
  const leadThreat = leadPair.answers.sort((a, b) => b.value - a.value)[0];
  const leadReason = leadThreat && leadThreat.exchange && leadThreat.value > 0.25
    ? `${leadThreat.by?.species} threatens ${leadThreat.foe.species} from turn one — ` +
      `${damageLine(leadThreat.exchange.myBest, leadThreat.foe)}` +
      `${leadThreat.exchange.faster ? ', and it moves first' : ''}.`
    : leadEdge
      ? leadEdge.detail
      : 'The safest opening: neither of these two loses its turn to anything they can lead.';

  // Is the pick actually a pick, or a coin flip dressed up as one?
  const sorted = solution.all.slice().sort((a, b) => b.vsBest - a.vsBest);
  const runnerUp = sorted.find((r) => r.bring.join() !== chosen.join());
  const gap = runnerUp ? solution.pick.vsBest - runnerUp.vsBest : Infinity;
  const alternative = runnerUp
    ? runnerUp.bring.map((p) => table.mine[mineIdx[p]].species).join(' + ')
    : '';
  const closeCall = runnerUp && gap < 2.5
    ? (gap < 0.15
      ? `Bringing ${alternative} instead is worth exactly the same. The model cannot separate them, ` +
        'so nothing it says here should talk you out of the four you practise with.'
      : `This is ${gap.toFixed(1)} points ahead of bringing ${alternative} instead — a margin thinner ` +
        'than the assumptions underneath it. Either is defensible.')
    : null;

  return {
    crux: theCrux.text,
    regime: m.regime.why,
    bring: myFour.map((i) => bringReason(table.mine[i], m, foe)),
    bench: benchReasons(table, mineIdx, chosen, theirFour, solution.pick.vsLikely),
    lead,
    leadReason: leadReason +
      (leadRunnerUp && leads.value - leadRunnerUp.vsBest < 2
        ? ` (${leadRunnerUp.pair.map((i) => table.mine[myFour[i]].species).join(' + ')} is barely behind.)`
        : ''),
    risks: risksOf(table, mineIdx, assumptions, solution),
    readProof: Math.abs(solution.pick.vsBest - solution.pick.worst) < 0.5
      ? 'Their choice barely moves this: every four they can bring lands within a point of the ' +
        'same number, so there is nothing here for them to read.'
      : null,
    equity: solution.pick.vsBest,
    worstCase: solution.pick.worst,
    closeCall,
  };
}
