import { NEUTRAL, answer } from './battler';
import type { Answer, Battler, Weather } from './battler';

/**
 * What a four-versus-four is worth.
 *
 * The whole app rests on this file, so it is built to be argued with: the score
 * is a sum of named parts, and every sentence the app prints is one of those
 * parts read back out. Nothing is asserted that is not a number here.
 *
 * The unit is game equity, roughly -100 (unwinnable) to +100 (free), where 0 is
 * a coin flip. It is not a win percentage and does not pretend to be.
 */

export type Tempo = 'neutral' | 'mine' | 'theirs' | 'trickroom';

export interface Regime {
  weather: Weather;
  /** Whose speed control is the one that ends up mattering. */
  tempo: Tempo;
  /** Why — for the read-out. */
  why: string;
}

/* ------------------------------------------------------------------ *
 * Speed
 * ------------------------------------------------------------------ */

export function effectiveSpeed(b: Battler, regime: Regime, mine: boolean): number {
  let spe = b.stats.spe;
  if (b.itemId === 'choicescarf') spe = Math.floor(spe * 1.5);
  if (regime.tempo === 'mine' && mine) spe *= 2;
  if (regime.tempo === 'theirs' && !mine) spe *= 2;
  if (b.speedDoubler === 'rain' && regime.weather === 'rain') spe *= 2;
  if (b.speedDoubler === 'sun' && regime.weather === 'sun') spe *= 2;
  // Unburden needs the item gone first; it is a turn-two fact, so it counts for
  // half of what a real doubling would.
  if (b.speedDoubler === 'unburden') spe = Math.floor(spe * 1.5);
  return spe;
}

/** Under Trick Room the slow one moves first, so the comparison inverts. */
function movesFirst(a: number, b: number, regime: Regime): boolean {
  return regime.tempo === 'trickroom' ? a < b : a > b;
}

/* ------------------------------------------------------------------ *
 * Which regime this pair of fours produces
 * ------------------------------------------------------------------ */

export function regimeOf(mine: Battler[], theirs: Battler[]): Regime {
  /*
   * Weather first. Ability setters go up on entry, and when both sides have one
   * the *slower* Pokémon sets last and therefore wins, which is the opposite of
   * what people expect and decides a great many rain mirrors.
   */
  const myWeather = mine.find((b) => b.setsRain || b.setsSun);
  const theirWeather = theirs.find((b) => b.setsRain || b.setsSun);
  let weather: Weather = 'none';
  let why = '';
  if (myWeather && theirWeather) {
    const slower = myWeather.stats.spe <= theirWeather.stats.spe ? myWeather : theirWeather;
    weather = slower.setsRain ? 'rain' : 'sun';
    why = `${slower.species} is the slower setter, so its weather is the one that sticks`;
  } else if (myWeather) {
    weather = myWeather.setsRain ? 'rain' : 'sun';
    why = `your ${myWeather.species} sets it and nothing of theirs contests it`;
  } else if (theirWeather) {
    weather = theirWeather.setsRain ? 'rain' : 'sun';
    why = `their ${theirWeather.species} sets it and you have no weather of your own`;
  }

  /*
   * Then tempo. Trick Room beats Tailwind when it is up, because it does not
   * only speed one side up, it turns the other side's investment into a
   * liability — so a side that commits to it and is actually slow takes the
   * regime. A fast team that brings Trick Room is bringing it for somebody else.
   */
  const myTR = mine.find((b) => b.setsTrickRoom);
  const theirTR = theirs.find((b) => b.setsTrickRoom);
  const meanSpeed = (side: Battler[]) => side.reduce((n, b) => n + b.stats.spe, 0) / side.length;
  const myTRIsReal = !!myTR && meanSpeed(mine) < 85;
  const theirTRIsReal = !!theirTR && meanSpeed(theirs) < 85;

  const myTW = mine.some((b) => b.setsTailwind);
  const theirTW = theirs.some((b) => b.setsTailwind);

  let tempo: Tempo = 'neutral';
  if (myTRIsReal || theirTRIsReal) {
    tempo = 'trickroom';
    const owner = myTRIsReal ? 'your' : 'their';
    const who = (myTRIsReal ? myTR : theirTR)!;
    why += `${why ? '; ' : ''}${owner} ${who.species} inverts the speed order`;
  } else if (myTW && !theirTW) {
    tempo = 'mine';
    why += `${why ? '; ' : ''}you have the only Tailwind`;
  } else if (theirTW && !myTW) {
    tempo = 'theirs';
    why += `${why ? '; ' : ''}they have the only Tailwind`;
  } else if (myTW && theirTW) {
    why += `${why ? '; ' : ''}both sides bring Tailwind, so it cancels`;
  }

  return { weather, tempo, why: why || 'no weather, no speed control — raw speed decides' };
}

/* ------------------------------------------------------------------ *
 * The damage table
 *
 * Every one of my sets against every one of theirs, both directions, at both
 * Attack stages Intimidate can produce, under each weather that could be up.
 * Built once; every subset comparison after that is a lookup.
 * ------------------------------------------------------------------ */

const WEATHERS: Weather[] = ['none', 'rain', 'sun'];

export interface DamageTable {
  mine: Battler[];
  theirs: Battler[];
  /** [weather][intimidated ? 1 : 0][attacker][defender] */
  out: Answer[][][][];
  back: Answer[][][][];
}

export function buildTable(mine: Battler[], theirs: Battler[]): DamageTable {
  const dim = <T,>(fn: (w: Weather, intim: boolean) => T) =>
    WEATHERS.map((w) => [fn(w, false), fn(w, true)]);

  const out = dim((weather, intim) =>
    mine.map((m) => theirs.map((t) =>
      answer(m, t, { ...NEUTRAL, weather, atkStage: intim ? -1 : 0 }))));

  const back = dim((weather, intim) =>
    theirs.map((t) => mine.map((m) =>
      answer(t, m, { ...NEUTRAL, weather, atkStage: intim ? -1 : 0 }))));

  return { mine, theirs, out, back };
}

const weatherIndex = (w: Weather) => (w === 'none' ? 0 : w === 'rain' ? 1 : 2);

/* ------------------------------------------------------------------ *
 * One Pokémon against one Pokémon
 * ------------------------------------------------------------------ */

export interface Exchange {
  /** -1 (they win it outright) to +1 (you do). */
  value: number;
  myTurns: number;
  theirTurns: number;
  faster: boolean;
  mine: Battler;
  theirs: Battler;
  myBest: Answer;
  theirBest: Answer;
}

const cap = (turns: number) => Math.min(turns, 6);

/**
 * A 1v1 read, in the unit team preview actually uses: turns.
 *
 * Not percentages — the difference between a move that does 51% and one that
 * does 99% is nothing, and the difference between 99% and 101% is the game. So
 * the comparison is "how many turns do I need, how many do they need, and who
 * moves first", which is the same question a player asks looking at the sprites.
 */
export function exchange(
  table: DamageTable,
  i: number,
  j: number,
  regime: Regime,
  myIntimidate: boolean,
  theirIntimidate: boolean,
): Exchange {
  const w = weatherIndex(regime.weather);
  const myBest = table.out[w][theirIntimidate ? 1 : 0][i][j];
  const theirBest = table.back[w][myIntimidate ? 1 : 0][j][i];
  const mine = table.mine[i];
  const theirs = table.theirs[j];

  const myTurns = cap(myBest.turns);
  const theirTurns = cap(theirBest.turns);
  const faster = movesFirst(
    effectiveSpeed(mine, regime, true),
    effectiveSpeed(theirs, regime, false),
    regime,
  );

  const adv = (theirTurns - myTurns) + (faster ? 0.5 : -0.5);
  return {
    value: Math.max(-1, Math.min(1, adv / 3)),
    myTurns, theirTurns, faster, mine, theirs, myBest, theirBest,
  };
}

/* ------------------------------------------------------------------ *
 * Four against four
 * ------------------------------------------------------------------ */

export interface Edge {
  label: string;
  detail: string;
  value: number;
}

export interface Matchup {
  score: number;
  regime: Regime;
  /** For each of theirs: my best answer to it. */
  answers: { foe: Battler; by: Battler | null; value: number; exchange: Exchange | null }[];
  /**
   * For each of mine: the foe that handles it worst for you (`by`) and the one it
   * does best into (`bestBy`). Both are needed — a Pokémon earns its slot either
   * because nothing over there beats it or because it beats something.
   */
  exposure: {
    mine: Battler; by: Battler | null; value: number; exchange: Exchange | null;
    bestBy: Battler | null; bestValue: number; bestExchange: Exchange | null;
  }[];
  edges: Edge[];
  coverage: number;
  resilience: number;
}

const WEIGHT = { coverage: 52, resilience: 26 };

export function evaluate(
  table: DamageTable,
  myIdx: number[],
  theirIdx: number[],
): Matchup {
  const mine = myIdx.map((i) => table.mine[i]);
  const theirs = theirIdx.map((j) => table.theirs[j]);
  const regime = regimeOf(mine, theirs);
  const myIntim = mine.some((b) => b.intimidates);
  const theirIntim = theirs.some((b) => b.intimidates);

  const grid: Exchange[][] = myIdx.map((i) =>
    theirIdx.map((j) => exchange(table, i, j, regime, myIntim, theirIntim)));

  const answers = theirIdx.map((_, jj) => {
    let best: Exchange | null = null;
    for (let ii = 0; ii < myIdx.length; ii++) {
      const e = grid[ii][jj];
      if (!best || e.value > best.value) best = e;
    }
    return { foe: theirs[jj], by: best?.mine ?? null, value: best?.value ?? -1, exchange: best };
  });

  const exposure = myIdx.map((_, ii) => {
    let worst: Exchange | null = null;
    let best: Exchange | null = null;
    for (let jj = 0; jj < theirIdx.length; jj++) {
      const e = grid[ii][jj];
      if (!worst || e.value < worst.value) worst = e;
      if (!best || e.value > best.value) best = e;
    }
    return {
      mine: mine[ii],
      by: worst?.theirs ?? null, value: worst?.value ?? -1, exchange: worst,
      bestBy: best?.theirs ?? null, bestValue: best?.value ?? -1, bestExchange: best,
    };
  });

  const coverage = answers.reduce((n, a) => n + a.value, 0) / answers.length;
  const resilience = exposure.reduce((n, e) => n + e.value, 0) / exposure.length;

  const edges = edgesOf(mine, theirs, regime);
  const score =
    WEIGHT.coverage * coverage +
    WEIGHT.resilience * resilience +
    edges.reduce((n, e) => n + e.value, 0);

  return { score, regime, answers, exposure, edges, coverage, resilience };
}

/**
 * The things that do not show up in a damage roll.
 *
 * Every one of these is a real, specific interaction a player would name out
 * loud at preview, and each carries the sentence it would be named with.
 */
function edgesOf(mine: Battler[], theirs: Battler[], regime: Regime): Edge[] {
  const out: Edge[] = [];
  const add = (label: string, detail: string, value: number) => {
    if (value !== 0) out.push({ label, detail, value });
  };

  /* ---- speed control ---- */
  if (regime.tempo === 'mine') {
    add('Tailwind', `${mine.find((b) => b.setsTailwind)!.species} gets the Tailwind and they have none.`, 7);
  } else if (regime.tempo === 'theirs') {
    add('Tailwind', `${theirs.find((b) => b.setsTailwind)!.species} gets the Tailwind and you have none — four turns where they move first.`, -7);
  } else if (regime.tempo === 'trickroom') {
    const mySlow = mine.reduce((n, b) => n + b.stats.spe, 0) / mine.length;
    const theirSlow = theirs.reduce((n, b) => n + b.stats.spe, 0) / theirs.length;
    const mineOwns = mine.some((b) => b.setsTrickRoom);
    add(
      'Trick Room',
      mineOwns
        ? 'The room is yours, and your side is the slow one under it.'
        : `Their ${theirs.find((b) => b.setsTrickRoom)?.species ?? 'Trick Room setter'} inverts the speed order; your Speed investment stops being an asset.`,
      mineOwns ? 8 : (theirSlow < mySlow ? -9 : -4),
    );
  }

  /* ---- Fake Out, and the thing that turns it off ---- */
  const myFakeOut = mine.filter((b) => b.fakeOut);
  const theirArmorTail = theirs.find((b) => b.blocksPriority);
  if (myFakeOut.length && theirArmorTail) {
    add(
      'Fake Out is dead',
      `${theirArmorTail.species}'s ${theirArmorTail.ability} blocks priority aimed at its side, so ${myFakeOut.map((b) => b.species).join(' and ')} loses its first turn entirely.`,
      -5 * Math.min(myFakeOut.length, 2),
    );
  } else if (myFakeOut.length) {
    add('Fake Out', `${myFakeOut[0].species} takes a turn off them before the game starts.`, 5);
  }
  const theirFakeOut = theirs.filter((b) => b.fakeOut);
  const myArmorTail = mine.find((b) => b.blocksPriority);
  if (theirFakeOut.length && myArmorTail) {
    add(
      'Their Fake Out is dead',
      `${myArmorTail.species}'s ${myArmorTail.ability} turns off ${theirFakeOut.map((b) => b.species).join(' and ')}'s Fake Out.`,
      5,
    );
  } else if (theirFakeOut.length) {
    add('Their Fake Out', `${theirFakeOut[0].species} takes your first turn instead.`, -5);
  }

  /* ---- redirection, and the thing that ignores it ---- */
  const theirRedirect = theirs.find((b) => b.redirects);
  const mySpread = mine.filter((b) => b.moves.some(
    (m) => m.category !== 'Status' && (m.target === 'allAdjacentFoes' || m.target === 'allAdjacent')));
  if (theirRedirect && mySpread.length >= 2) {
    add(
      'Spread beats redirection',
      `${theirRedirect.species}'s ${theirRedirect.moves.find((m) => m.id === 'ragepowder' || m.id === 'followme')!.name} cannot redirect a spread move, and ${mySpread.length} of your four click one.`,
      6,
    );
  } else if (theirRedirect) {
    add('Their redirection', `${theirRedirect.species} pulls your single-target attacks off whatever it is protecting.`, -5);
  }
  const myRedirect = mine.find((b) => b.redirects);
  const theirSpread = theirs.filter((b) => b.moves.some(
    (m) => m.category !== 'Status' && (m.target === 'allAdjacentFoes' || m.target === 'allAdjacent')));
  if (myRedirect && theirSpread.length >= 2) {
    add(
      'Your redirection is soft',
      `${myRedirect.species} redirects, but ${theirSpread.length} of their four attack both slots anyway.`,
      -3,
    );
  } else if (myRedirect) {
    add('Redirection', `${myRedirect.species} buys a free turn for whatever needs one.`, 5);
  }

  /* ---- Intimidate against a physical side ---- */
  const myIntim = mine.filter((b) => b.intimidates);
  const theirPhysical = theirs.filter((b) => physicalShare(b) > 0.5);
  if (myIntim.length && theirPhysical.length >= 2) {
    add(
      'Intimidate',
      `${theirPhysical.length} of their four attack physically, and ${myIntim[0].species} drops all of it on entry.`,
      4 + 2 * (theirPhysical.length - 2),
    );
  }
  const theirIntim = theirs.filter((b) => b.intimidates);
  const myPhysical = mine.filter((b) => physicalShare(b) > 0.5);
  if (theirIntim.length && myPhysical.length >= 2) {
    add(
      'Their Intimidate',
      `${theirIntim[0].species} takes a stage off ${myPhysical.map((b) => b.species).join(' and ')} every time it comes in.`,
      -(4 + 2 * (myPhysical.length - 2)),
    );
  }

  /* ---- status, and what refuses it ---- */
  const theirBlocker = theirs.find((b) => b.blocksStatus);
  const myStatus = mine.filter((b) => b.moves.filter((m) => m.category === 'Status').length >= 2);
  if (theirBlocker && myStatus.length) {
    add(
      'Good as Gold',
      `${theirBlocker.species} refuses every status move you have — ${myStatus.map((b) => b.species).join(', ')} can only click damage into it.`,
      -4,
    );
  }

  /* ---- weather that is doing work ---- */
  if (regime.weather !== 'none') {
    const mineSets = mine.some((b) => (regime.weather === 'rain' ? b.setsRain : b.setsSun));
    const payoff = (side: Battler[]) => side.filter((b) =>
      (b.speedDoubler === regime.weather) ||
      b.moves.some((m) => (regime.weather === 'rain'
        ? m.id === 'electroshot' || m.id === 'hurricane' || m.id === 'thunder' || m.id === 'weatherball'
        : m.id === 'solarbeam' || m.id === 'weatherball'))).length;
    const mineGain = payoff(mine);
    const theirGain = payoff(theirs);
    if (mineGain !== theirGain) {
      const good = mineGain > theirGain;
      add(
        good ? 'The weather is yours' : 'Their weather',
        good
          ? `${regime.weather === 'rain' ? 'Rain' : 'Sun'} is up and ${mineGain} of your four are built to use it against ${theirGain} of theirs.`
          : `${regime.weather === 'rain' ? 'Rain' : 'Sun'} is up and ${theirGain} of their four cash it in — ${mineSets ? 'you set it and they are the ones profiting' : 'and you get nothing from it'}.`,
        (mineGain - theirGain) * 3,
      );
    }
  }

  /* ---- screens ---- */
  const theirScreens = theirs.find((b) => b.screens);
  if (theirScreens) {
    add('Screens', `${theirScreens.species} halves everything you throw for the next five turns.`, -5);
  }
  const myScreens = mine.find((b) => b.screens);
  if (myScreens) add('Your screens', `${myScreens.species} halves what comes back.`, 5);

  return out;
}

function physicalShare(b: Battler): number {
  const damaging = b.moves.filter((m) => m.category !== 'Status');
  if (!damaging.length) return 0;
  return damaging.filter((m) => m.category === 'Physical').length / damaging.length;
}

/** Damage as a readable line: "Flare Blitz 62–74%". */
export function damageLine(a: Answer, def: Battler): string {
  if (!a.best || a.best.max <= 0) return 'nothing';
  const lo = Math.round(a.best.min * 100);
  const hi = Math.round(a.best.max * 100);
  void def;
  return `${a.best.move.name} ${lo}–${hi}%${a.needsRoll ? ' (roll)' : ''}`;
}
