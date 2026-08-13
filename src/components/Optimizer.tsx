import { useMemo, useState } from 'react';
import type { PokemonSet, StatID } from '../types';
import { getMove } from '../data/dex';
import { bestMove, displayName } from '../engine/calc';
import { threatToSet } from '../engine/matrix';
import { minEVsToKO, minEVsToOutspeed, minEVsToSurvive } from '../engine/optimizer';
import { computeSpeed, defaultScenario } from '../engine/speed';
import { resolveForm } from '../engine/stats';
import { useEnabledThreats, useFormat, useStore } from '../store';
import { Section } from './common';

type Mode = 'survive' | 'ko' | 'speed';

/**
 * Turns "I want to live a Mega Metagross Iron Head" into an actual EV spread.
 * Every result is applied straight to the set.
 */
export function OptimizerPanel({ member, index }: { member: PokemonSet; index: number }) {
  const format = useFormat();
  const field = useStore((s) => s.field);
  const update = useStore((s) => s.updateMember);
  const threats = useEnabledThreats();

  const [mode, setMode] = useState<Mode>('survive');
  const [threatId, setThreatId] = useState(threats[0]?.id ?? '');
  const [moveName, setMoveName] = useState('');
  const [hits, setHits] = useState(1);
  const [guaranteed, setGuaranteed] = useState(true);

  const threat = threats.find((t) => t.id === threatId) ?? threats[0];
  const threatSet = useMemo(
    () => (threat ? threatToSet(threat, format.level) : null),
    [threat, format.level],
  );

  const opposingMoves = useMemo(
    () => (threat?.moves ?? []).filter((m) => getMove(m)?.category !== 'Status'),
    [threat],
  );
  const myMoves = useMemo(
    () => member.moves.filter((m) => m && getMove(m)?.category !== 'Status'),
    [member.moves],
  );

  // Default to whatever actually hurts, not whatever happens to be in slot one.
  const strongestIncoming = useMemo(() => {
    if (!threatSet) return '';
    const best = bestMove(threatSet, member, format, {
      ...field, attackerSide: field.defenderSide, defenderSide: field.attackerSide,
    });
    return best?.move ?? opposingMoves[0] ?? '';
  }, [threatSet, member, format, field, opposingMoves]);

  const strongestOutgoing = useMemo(() => {
    if (!threatSet) return '';
    const best = bestMove(member, threatSet, format, field);
    return best?.move ?? myMoves[0] ?? '';
  }, [threatSet, member, format, field, myMoves]);

  const activeMove = mode === 'survive'
    ? (opposingMoves.includes(moveName) ? moveName : strongestIncoming)
    : (myMoves.includes(moveName) ? moveName : strongestOutgoing);

  const survive = useMemo(() => {
    if (mode !== 'survive' || !threatSet || !activeMove) return null;
    return minEVsToSurvive({
      defender: member, attacker: threatSet, move: activeMove, format, field, hits,
    });
  }, [mode, threatSet, activeMove, member, format, field, hits]);

  const ko = useMemo(() => {
    if (mode !== 'ko' || !threatSet || !activeMove) return null;
    return minEVsToKO(member, threatSet, activeMove, format, field, { guaranteed, hits });
  }, [mode, threatSet, activeMove, member, format, field, guaranteed, hits]);

  const speed = useMemo(() => {
    if (mode !== 'speed' || !threatSet) return null;
    const target = computeSpeed(threatSet, format, defaultScenario()).final;
    return { target, result: minEVsToOutspeed(member, target, format) };
  }, [mode, threatSet, member, format]);

  const applyEVs = (patch: Partial<Record<StatID, number>>, nature?: string) => {
    update(index, {
      evs: { ...member.evs, ...patch },
      ...(nature ? { nature } : {}),
    });
  };

  const category = getMove(activeMove)?.category;
  const defStat: StatID = category === 'Special' ? 'spd' : 'def';

  return (
    <Section
      title="EV optimizer"
      subtitle="Solve a benchmark, then apply it to the spread"
    >
      <div className="seg">
        {(['survive', 'ko', 'speed'] as Mode[]).map((m) => (
          <button
            key={m}
            className={`seg-btn ${mode === m ? 'is-on' : ''}`}
            onClick={() => { setMode(m); setMoveName(''); }}
          >
            {m === 'survive' ? 'Survive' : m === 'ko' ? 'Secure a KO' : 'Outspeed'}
          </button>
        ))}
      </div>

      <div className="opt-controls">
        <label className="inline-field">
          <span>{mode === 'ko' ? 'Target' : mode === 'speed' ? 'Benchmark' : 'Attacker'}</span>
          <select value={threat?.id ?? ''} onChange={(e) => setThreatId(e.target.value)}>
            {threats.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>

        {mode !== 'speed' && (
          <label className="inline-field">
            <span>Move</span>
            <select value={activeMove} onChange={(e) => setMoveName(e.target.value)}>
              {(mode === 'survive' ? opposingMoves : myMoves).map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
              {!(mode === 'survive' ? opposingMoves : myMoves).length && (
                <option value="">no damaging moves</option>
              )}
            </select>
          </label>
        )}

        {mode === 'survive' && (
          <label className="inline-field">
            <span>Hits</span>
            <select value={hits} onChange={(e) => setHits(Number(e.target.value))}>
              <option value={1}>Live 1 hit</option>
              <option value={2}>Live 2 hits</option>
              <option value={3}>Live 3 hits</option>
            </select>
          </label>
        )}

        {mode === 'ko' && (
          <label className="inline-field">
            <span>Roll</span>
            <select value={guaranteed ? '1' : '0'} onChange={(e) => setGuaranteed(e.target.value === '1')}>
              <option value="1">Guaranteed (min roll)</option>
              <option value="0">Any roll (max)</option>
            </select>
          </label>
        )}
      </div>

      {/* ---------------- survive ---------------- */}
      {mode === 'survive' && survive && (
        survive.impossible || !survive.best ? (
          <p className="opt-note text-error">
            {threat?.name} {activeMove} cannot be survived even with 252/252 —
            you need a resist, Intimidate, a screen or a Focus Sash.
          </p>
        ) : (
          <>
            <p className="opt-note">
              Cheapest spread that lives {hits > 1 ? `${hits} hits of ` : ''}
              <strong>{threat?.name} {activeMove}</strong>:
            </p>
            <div className="opt-options">
              {survive.options.slice(0, 6).map((o) => (
                <button
                  key={`${o.hpEV}-${o.defEV}`}
                  className="opt-option"
                  onClick={() => applyEVs({ hp: o.hpEV, [defStat]: o.defEV } as Partial<Record<StatID, number>>)}
                >
                  <span className="opt-spread">
                    {o.hpEV} HP / {o.defEV} {defStat === 'def' ? 'Def' : 'SpD'}
                  </span>
                  <span className="muted small">
                    {o.total} EVs · worst roll {o.worstCasePct.toFixed(1)}%
                  </span>
                </button>
              ))}
            </div>
          </>
        )
      )}

      {/* ---------------- KO ---------------- */}
      {mode === 'ko' && (
        ko ? (
          <>
            <p className="opt-note">
              <strong>{ko.atkEV}</strong> {category === 'Special' ? 'SpA' : 'Atk'} EVs
              {guaranteed ? ' guarantee' : ' give a chance at'} the OHKO on {threat?.name}
              {' '}({ko.minPct.toFixed(1)}–{ko.maxPct.toFixed(1)}%).
            </p>
            <button
              className="btn btn-sm btn-primary"
              onClick={() => applyEVs({ [category === 'Special' ? 'spa' : 'atk']: ko.atkEV } as Partial<Record<StatID, number>>)}
            >
              Apply {ko.atkEV} EVs
            </button>
          </>
        ) : (
          <p className="opt-note text-error">
            {activeMove || 'This set'} cannot OHKO {threat?.name} even at 252 EVs.
            Try a different move, an item, or a boost.
          </p>
        )
      )}

      {/* ---------------- speed ---------------- */}
      {mode === 'speed' && speed && threatSet && (
        <>
          <p className="opt-note">
            {threat?.name} sits at <strong>{speed.target}</strong> Speed
            {' '}({resolveForm(threatSet, format)?.baseStats.spe} base).
          </p>
          <div className="opt-options">
            {speed.result.withCurrentNature ? (
              <button
                className="opt-option"
                onClick={() => applyEVs({ spe: speed.result.withCurrentNature!.evs })}
              >
                <span className="opt-spread">{speed.result.withCurrentNature.evs} Spe EVs</span>
                <span className="muted small">
                  keeps {member.nature} · reaches {speed.result.withCurrentNature.speed}
                </span>
              </button>
            ) : (
              <p className="opt-note text-error">
                Cannot outrun it with {member.nature} even at 252 Spe EVs.
              </p>
            )}
            {speed.result.withPositiveNature && (
              <button
                className="opt-option"
                onClick={() => applyEVs(
                  { spe: speed.result.withPositiveNature!.evs },
                  speed.result.withPositiveNature!.nature,
                )}
              >
                <span className="opt-spread">
                  {speed.result.withPositiveNature.evs} Spe EVs + {speed.result.withPositiveNature.nature}
                </span>
                <span className="muted small">
                  reaches {speed.result.withPositiveNature.speed} — frees up EVs elsewhere
                </span>
              </button>
            )}
          </div>
        </>
      )}

      {threat && (
        <p className="opt-foot muted small">
          Reference set: {displayName(resolveForm(threatToSet(threat, format.level), format)?.species.name ?? threat.species)}
          {' @ '}{threat.item || 'no item'} · {threat.nature} · {formatEVs(threat.evs)}
        </p>
      )}
    </Section>
  );
}

function formatEVs(evs: Partial<Record<StatID, number>>): string {
  const labels: Record<string, string> = {
    hp: 'HP', atk: 'Atk', def: 'Def', spa: 'SpA', spd: 'SpD', spe: 'Spe',
  };
  return Object.entries(evs)
    .filter(([, v]) => v)
    .map(([k, v]) => `${v} ${labels[k]}`)
    .join(' / ');
}
