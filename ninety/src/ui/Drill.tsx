import { useCallback, useEffect, useMemo, useState } from 'react';
import { grade, scenario } from '../engine/drill';
import type { Grade, Scenario } from '../engine/drill';
import { brief } from '../engine/brief';
import { MonCard, Figure, signed, tone } from './bits';
import BriefingView from './Briefing';

/**
 * Ninety seconds, six against six, no take-backs.
 *
 * The drill exists because reading a solved matchup teaches you less than
 * getting one wrong does. It deals a real team into a legal opponent six, runs
 * the clock the game actually runs, and then scores what you brought against
 * what the solver would have — as a share of the equity that was available,
 * because most preview calls are worth a handful of points and a trainer that
 * shouts "wrong" at a two-point miss is a trainer you stop believing.
 */

const LIMIT = 90;

export default function Drill() {
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 1e9));
  const sc: Scenario = useMemo(() => scenario(seed), [seed]);
  const [order, setOrder] = useState<number[]>([]);
  const [result, setResult] = useState<Grade | null>(null);
  const [left, setLeft] = useState(LIMIT);
  const [history, setHistory] = useState<number[]>([]);

  const submit = useCallback((picked: number[]) => {
    if (result) return;
    const four = picked.length === 4 ? picked : padTo4(picked, sc.mine.length);
    const sorted = four.slice().sort((a, b) => a - b);
    const leadPositions = four.slice(0, 2).map((p) => sorted.indexOf(p)).sort((a, b) => a - b);
    const g = grade(sc, sorted, leadPositions);
    setResult(g);
    setHistory((h) => [...h, g.score]);
  }, [result, sc]);

  useEffect(() => {
    if (result) return;
    if (left <= 0) { submit(order); return; }
    const t = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [left, result, order, submit]);

  const next = () => {
    setSeed(Math.floor(Math.random() * 1e9));
    setOrder([]);
    setResult(null);
    setLeft(LIMIT);
  };

  const toggle = (pos: number) => {
    if (result) return;
    setOrder((o) => (o.includes(pos) ? o.filter((p) => p !== pos) : o.length < 4 ? [...o, pos] : o));
  };

  const mean = history.length
    ? Math.round(history.reduce((a, b) => a + b, 0) / history.length)
    : null;

  return (
    <>
      <div className="panel">
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <span className={`clock ${left <= 15 && !result ? 'low' : ''}`}>
            {result ? '—' : `0:${String(Math.max(0, left)).padStart(2, '0')}`}
          </span>
          <span className="hint">
            {result
              ? 'Clock stopped.'
              : order.length < 4
                ? `Pick four in order — the first two are your leads. ${4 - order.length} to go.`
                : 'Locked in. Submit, or click one to swap it out.'}
          </span>
          <span className="streak" style={{ marginLeft: 'auto' }}>
            {history.length ? `${history.length} solved · average ${mean}` : 'first one'}
          </span>
        </div>
      </div>

      <div className="panel">
        <div className="side-label">Their six <span className="rule" /> assume the common set</div>
        <div className="six">
          {sc.theirs.map((b) => (
            <MonCard
              key={b.key}
              b={b}
              showSet={!!result}
              title={result ? undefined : `${b.species} — you cannot see its item at preview`}
            />
          ))}
        </div>

        <div className="side-label" style={{ marginTop: 18 }}>
          Your six <span className="rule" /> {sc.teamName}
        </div>
        <div className="six">
          {sc.mine.map((b, i) => (
            <MonCard
              key={b.key}
              b={b}
              picked={order.includes(i)}
              dim={!!result && !order.includes(i)}
              order={order.includes(i) ? order.indexOf(i) + 1 : undefined}
              lead={order.indexOf(i) === 0 || order.indexOf(i) === 1}
              onClick={() => toggle(i)}
            />
          ))}
        </div>
        <p className="note">{sc.teamNote}</p>

        <div className="btn-row">
          <button
            className="btn primary"
            disabled={order.length !== 4 || !!result}
            onClick={() => submit(order)}
          >
            Lock it in
          </button>
          <button className="btn" onClick={next}>{result ? 'Next matchup' : 'Skip'}</button>
        </div>
      </div>

      {result && <Result sc={sc} g={result} />}
    </>
  );
}

function padTo4(picked: number[], size: number): number[] {
  const out = picked.slice();
  for (let i = 0; i < size && out.length < 4; i++) if (!out.includes(i)) out.push(i);
  return out;
}

function Result({ sc, g }: { sc: Scenario; g: Grade }) {
  const b = useMemo(
    () => brief(sc.table, sc.mine.map((_, i) => i), sc.assumptions, sc.solution),
    [sc],
  );
  return (
    <>
      <div className="panel">
        <h2>{g.asGoodAsItGets ? 'Solved' : 'Graded'}</h2>
        <div className="score-hero">
          <b className={g.score >= 70 ? 'up' : g.score >= 40 ? '' : 'down'}>{g.score}</b>
          <span className="hint">{g.verdict}</span>
        </div>
        <div className="figures">
          <Figure label="your four" value={signed(g.yours)} tone={tone(g.yours)} />
          <Figure label="the best four" value={signed(g.best)} tone={tone(g.best)} />
          <Figure label="cost of the miss" value={(g.best - g.yours).toFixed(1)} />
          <Figure label="lead" value={`${Math.round(g.leadScore * 100)}%`} />
        </div>
      </div>
      <BriefingView brief={b} mine={sc.mine} />
    </>
  );
}
