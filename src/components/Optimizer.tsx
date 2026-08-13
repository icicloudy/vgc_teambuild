import { useMemo, useState } from 'react';
import type { PokemonSet, StatID } from '../types';
import { getMove } from '../data/dex';
import { bestMove, displayName } from '../engine/calc';
import { threatToSet } from '../engine/matrix';
import { minSPToKO, minSPToOutspeed, minSPToSurvive } from '../engine/optimizer';
import { computeSpeed, defaultScenario } from '../engine/speed';
import { resolveForm } from '../engine/stats';
import { useEnabledThreats, useFormat, useStore } from '../store';
import { Section } from './common';
import { SurvivalMap } from './SurvivalMap';

type Mode = 'survive' | 'ko' | 'speed';

/**
 * Turns "I want to live a Mega Metagross Iron Head" into an actual Stat Point
 * spread. Every result is applied straight to the set.
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
    return minSPToSurvive({
      defender: member, attacker: threatSet, move: activeMove, format, field, hits,
    });
  }, [mode, threatSet, activeMove, member, format, field, hits]);

  const ko = useMemo(() => {
    if (mode !== 'ko' || !threatSet || !activeMove) return null;
    return minSPToKO(member, threatSet, activeMove, format, field, { guaranteed, hits });
  }, [mode, threatSet, activeMove, member, format, field, guaranteed, hits]);

  const speed = useMemo(() => {
    if (mode !== 'speed' || !threatSet) return null;
    const target = computeSpeed(threatSet, format, defaultScenario()).final;
    return { target, result: minSPToOutspeed(member, target, format) };
  }, [mode, threatSet, member, format]);

  const applySP = (patch: Partial<Record<StatID, number>>, nature?: string) => {
    update(index, {
      sp: { ...member.sp, ...patch },
      ...(nature ? { nature } : {}),
    });
  };

  const category = getMove(activeMove)?.category;

  return (
    <Section
      title="Stat Point optimizer"
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
        survive.impossible ? (
          <p className="opt-note text-error">
            {threat?.name} {activeMove} cannot be survived with any split of your remaining
            points — you need a resist, Intimidate, a screen or a Focus Sash.
          </p>
        ) : (
          <>
            <SurvivalMap
              grid={survive.grid}
              current={member.sp}
              attackerLabel={threat?.name ?? ''}
              moveName={activeMove}
              onPick={({ hp, def }) =>
                applySP({ hp, [survive.defStat]: def } as Partial<Record<StatID, number>>)}
            />
            {survive.best && (
              <>
                <p className="opt-note">
                  Cheapest spread that lives {hits > 1 ? `${hits} hits of ` : ''}
                  <strong>{threat?.name} {activeMove}</strong>:
                </p>
                <div className="opt-options">
                  {survive.options.slice(0, 5).map((o) => (
                    <button
                      key={`${o.hpSP}-${o.defSP}`}
                      className="opt-option"
                      onClick={() => applySP(
                        { hp: o.hpSP, [survive.defStat]: o.defSP } as Partial<Record<StatID, number>>,
                      )}
                    >
                      <span className="opt-spread">
                        {o.hpSP} HP / {o.defSP} {survive.defStat === 'def' ? 'Def' : 'SpD'}
                      </span>
                      <span className="muted small">
                        {o.total} points · worst roll {o.worstCasePct.toFixed(1)}%
                      </span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </>
        )
      )}

      {/* ---------------- KO ---------------- */}
      {mode === 'ko' && (
        ko ? (
          <>
            <p className="opt-note">
              <strong>{ko.atkSP}</strong> {category === 'Special' ? 'SpA' : 'Atk'} points
              {guaranteed ? ' guarantee' : ' give a chance at'} the OHKO on {threat?.name}
              {' '}({ko.minPct.toFixed(1)}–{ko.maxPct.toFixed(1)}%).
            </p>
            <button
              className="btn btn-sm btn-primary"
              onClick={() => applySP({ [category === 'Special' ? 'spa' : 'atk']: ko.atkSP } as Partial<Record<StatID, number>>)}
            >
              Apply {ko.atkSP} points
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
                onClick={() => applySP({ spe: speed.result.withCurrentNature!.sp })}
              >
                <span className="opt-spread">{speed.result.withCurrentNature.sp} Spe points</span>
                <span className="muted small">
                  keeps {member.nature} · reaches {speed.result.withCurrentNature.speed}
                </span>
              </button>
            ) : (
              <p className="opt-note text-error">
                Cannot outrun it with {member.nature} even with every spare point in Speed.
              </p>
            )}
            {speed.result.withPositiveNature && (
              <button
                className="opt-option"
                onClick={() => applySP(
                  { spe: speed.result.withPositiveNature!.sp },
                  speed.result.withPositiveNature!.nature,
                )}
              >
                <span className="opt-spread">
                  {speed.result.withPositiveNature.sp} Spe points + {speed.result.withPositiveNature.nature}
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
          {' @ '}{threat.item || 'no item'} · {threat.nature} · {formatSP(threat.sp)}
        </p>
      )}
    </Section>
  );
}

function formatSP(sp: Partial<Record<StatID, number>>): string {
  const labels: Record<string, string> = {
    hp: 'HP', atk: 'Atk', def: 'Def', spa: 'SpA', spd: 'SpD', spe: 'Spe',
  };
  return Object.entries(sp)
    .filter(([, v]) => v)
    .map(([k, v]) => `${v} ${labels[k]}`)
    .join(' / ') || 'no points';
}
