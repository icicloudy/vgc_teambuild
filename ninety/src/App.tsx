import { useMemo, useState } from 'react';
import { POOL } from './data/dex';
import { PRESET_TEAMS, itemClauseBreaks, resolveTeam, speciesClauseBreaks } from './data/teams';
import { battler, battlersFor } from './engine/battler';
import type { Battler } from './engine/battler';
import { assumptionsFor, tableFor } from './engine/drill';
import { solvePreview } from './engine/solve';
import { brief } from './engine/brief';
import { Disc, MonCard } from './ui/bits';
import BriefingView from './ui/Briefing';
import PayoffGrid from './ui/PayoffGrid';
import Drill from './ui/Drill';

/**
 * Ninety — the ninety seconds of team preview, solved and then drilled.
 *
 * Every other tool in VGC helps you build the six. Nothing helps with the part
 * that decides the game: choosing four of them, and two to lead, against six
 * species whose items and moves you cannot see. That is a simultaneous game
 * under uncertainty, it has a right answer, and this is it.
 */

const DEFAULT_FOES = ['Garchomp', 'Charizard', 'Incineroar', 'Whimsicott', 'Kingambit', 'Sinistcha'];

export default function App() {
  const [mode, setMode] = useState<'solve' | 'drill'>('solve');
  return (
    <div className="wrap">
      <header className="top">
        <span className="brand">
          <b>Ninety</b>
          <span>team preview, solved</span>
        </span>
        <span className="modes">
          <button className={`mode ${mode === 'solve' ? 'on' : ''}`} onClick={() => setMode('solve')}>
            Solve
          </button>
          <button className={`mode ${mode === 'drill' ? 'on' : ''}`} onClick={() => setMode('drill')}>
            Drill
          </button>
        </span>
      </header>
      {mode === 'solve' ? <Solve /> : <Drill />}
      <Footer />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Solve
 * ------------------------------------------------------------------ */

function Solve() {
  const [teamId, setTeamId] = useState(PRESET_TEAMS[0].id);
  const [foes, setFoes] = useState<string[]>(DEFAULT_FOES);
  /** Slot → set index, when you have scouted them and know better. */
  const [scouted, setScouted] = useState<Record<number, number>>({});

  const team = PRESET_TEAMS.find((t) => t.id === teamId)!;
  const mine = useMemo(() => resolveTeam(team), [team]);
  const legality = useMemo(
    () => [...itemClauseBreaks(mine), ...speciesClauseBreaks(mine)],
    [mine],
  );

  const theirs: Battler[] = useMemo(
    () => foes.map((name, slot) => {
      const options = battlersFor(POOL.find((p) => p.species === name)!.id);
      return options[scouted[slot] ?? 0] ?? options[0];
    }),
    [foes, scouted],
  );

  const solved = useMemo(() => {
    const table = tableFor(mine, theirs);
    const assumptions = assumptionsFor(theirs, table);
    const solution = solvePreview(table, mine.map((_, i) => i), assumptions.map((a) => a.index));
    return {
      table,
      solution,
      briefing: brief(table, mine.map((_, i) => i), assumptions, solution),
    };
  }, [mine, theirs]);

  const swapFoe = (slot: number, species: string) => {
    setFoes((f) => f.map((v, i) => (i === slot ? species : v)));
    setScouted((s) => ({ ...s, [slot]: 0 }));
  };

  return (
    <>
      <div className="panel">
        <div className="side-label">
          Their six <span className="rule" /> species only, the way preview shows it
        </div>
        <div className="six">
          {theirs.map((b, slot) => (
            <FoeSlot
              key={slot}
              b={b}
              slot={slot}
              taken={foes}
              onSpecies={(s) => swapFoe(slot, s)}
              onSet={(i) => setScouted((s) => ({ ...s, [slot]: i }))}
            />
          ))}
        </div>

        <div className="side-label" style={{ marginTop: 18 }}>
          Your six <span className="rule" />
          <select value={teamId} onChange={(e) => setTeamId(e.target.value)}>
            {PRESET_TEAMS.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div className="six">
          {mine.map((b) => (
            <MonCard
              key={b.key}
              b={b}
              picked={solved.briefing.bring.some((x) => x.battler.key === b.key)}
              dim={!solved.briefing.bring.some((x) => x.battler.key === b.key)}
              lead={solved.briefing.lead.some((x) => x.key === b.key)}
            />
          ))}
        </div>
        <p className="note">{team.note}</p>
        {legality.length > 0 && (
          <p className="note" style={{ color: 'var(--critical)' }}>{legality.join('; ')}</p>
        )}
      </div>

      <BriefingView brief={solved.briefing} mine={mine} />
      <PayoffGrid solution={solved.solution} mine={mine} theirs={theirs} />
    </>
  );
}

/**
 * One of their slots. You can change the species — that is what you are reading
 * off the preview screen — and, if you have scouted them or seen game one, pin
 * the set instead of letting the app assume the common one.
 */
function FoeSlot({
  b, slot, taken, onSpecies, onSet,
}: {
  b: Battler; slot: number; taken: string[];
  onSpecies: (s: string) => void; onSet: (i: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const entry = POOL.find((p) => p.species === b.species)!;
  const sets = entry.sets.map((_, i) => battler(entry, i));

  return (
    <div style={{ position: 'relative' }}>
      <button className="mon" type="button" onClick={() => setOpen((o) => !o)}>
        <Disc b={b} />
        <span className="mon-name">{b.species}</span>
        <span className="mon-set">
          {b.set.label}
          {!b.measured && <span className="tag guess" style={{ marginLeft: 4 }}>guess</span>}
        </span>
      </button>
      {open && (
        <div className="panel" style={{ position: 'absolute', zIndex: 20, left: 0, minWidth: 260, marginTop: 4 }}>
          <h2>Slot {slot + 1}</h2>
          <div className="picker" style={{ marginBottom: 12 }}>
            {POOL.map((p) => (
              <button
                key={p.id}
                className={`chip ${p.species === b.species ? 'on' : ''}`}
                disabled={taken.includes(p.species) && p.species !== b.species}
                onClick={() => { onSpecies(p.species); setOpen(false); }}
              >
                {p.species}
              </button>
            ))}
          </div>
          <h2>If you have scouted it</h2>
          <div className="picker">
            {sets.map((s, i) => (
              <button
                key={s.key}
                className={`chip ${s.key === b.key ? 'on' : ''}`}
                onClick={() => { onSet(i); setOpen(false); }}
                title={s.set.note}
              >
                {s.set.label} · {Math.round(s.odds * 100)}%
              </button>
            ))}
          </div>
          <p className="note">{b.set.note}</p>
          <button className="btn" style={{ marginTop: 10 }} onClick={() => setOpen(false)}>Close</button>
        </div>
      )}
    </div>
  );
}

function Footer() {
  const measured = POOL.filter((p) => p.measured).length;
  return (
    <div className="panel">
      <h2>What this is standing on</h2>
      <p className="reason-text">
        {POOL.length} species of the Regulation M-B pool, {measured} of them with published move and
        item percentages from Champions ranked data (Pikalytics, Season&nbsp;3, August 2026); the
        other {POOL.length - measured} carry a <span className="tag guess">guess</span> because no
        set data was ever published for them. Spreads are nowhere published, so every spread here is
        a reading of what the set is for. Damage is the Gen&nbsp;9 formula at Level&nbsp;50 with
        Champions Stat Points, computed in this page — 66 to spend, 32 to a stat, no IVs.
      </p>
      <p className="note">
        Things the model does not do: Last Respects is priced at its floor of 50 power because
        nothing has fainted yet at preview, Stamina and Unburden are counted at half effect because
        they need a turn first, and switching is not simulated at all — this answers which four to
        bring, not how to play them.
      </p>
    </div>
  );
}
