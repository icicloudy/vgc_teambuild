import { useMemo, useState } from 'react';
import { displayName } from '../engine/calc';
import { buildMatrix, summariseThreats, teamPressureScore, threatToSet } from '../engine/matrix';
import type { Matchup, Verdict } from '../engine/matrix';
import { resolveForm } from '../engine/stats';
import { useActiveTeam, useEnabledThreats, useFormat, useStore } from '../store';
import { Pill, Section, Sprite, Toggle } from './common';

const VERDICT_LABEL: Record<Verdict, string> = {
  winning: 'You win',
  favourable: 'Favoured',
  even: 'Even',
  unfavourable: 'Against you',
  losing: 'You lose',
  unset: 'No moves yet',
};

type View = 'verdict' | 'offense' | 'defense';

export function ThreatMatrixPanel() {
  const format = useFormat();
  const team = useActiveTeam();
  const threats = useEnabledThreats();
  const field = useStore((s) => s.field);
  const setTab = useStore((s) => s.setTab);

  const [view, setView] = useState<View>('verdict');
  const [tailwind, setTailwind] = useState(false);
  const [trickRoom, setTrickRoom] = useState(false);
  const [intimidated, setIntimidated] = useState(false);
  const [detail, setDetail] = useState<{ row: number; col: number } | null>(null);

  const threatSets = useMemo(
    () => threats.map((t) => threatToSet(t, format.level)),
    [threats, format.level],
  );

  const matrix = useMemo(
    () => buildMatrix(team.members, threatSets, {
      format,
      field,
      tailwind,
      trickRoom,
      theirState: intimidated
        ? { boosts: { atk: -1 }, status: '', hpPercent: 100, megaOverride: null, abilityOn: false }
        : undefined,
    }),
    [team.members, threatSets, format, field, tailwind, trickRoom, intimidated],
  );

  const summaries = useMemo(
    () => summariseThreats(matrix, team.members, format, threats.map((t) => t.usage)),
    [matrix, team.members, format, threats],
  );

  const score = teamPressureScore(summaries);

  if (!team.members.length) {
    return (
      <div className="empty-state">
        <h2>Nothing to compare yet</h2>
        <p>Add Pokémon to your team and every matchup against the metagame appears here.</p>
        <button className="btn btn-primary" onClick={() => setTab('build')}>Go to Build</button>
      </div>
    );
  }

  const cellFor = (m: Matchup) => {
    if (m.incomplete) return { cls: 'mx-unset', text: '—', sub: 'no moves' };
    if (view === 'verdict') {
      return { cls: `mx-${m.verdict}`, text: shortVerdict(m.verdict), sub: m.faster ? '⚡' : '' };
    }
    const r = view === 'offense' ? m.offense : m.defense;
    if (!r || r.result.max === 0) return { cls: 'mx-none', text: '—', sub: '' };
    return {
      cls: `mx-dmg mx-d${Math.min(4, Math.floor(r.result.maxPct / 25))}`,
      text: `${r.result.maxPct.toFixed(0)}%`,
      sub: r.move,
    };
  };

  const selected = detail ? matrix.cells[detail.row]?.[detail.col] : null;

  return (
    <div className="matrix-wrap">
      <Section
        title="Threat matrix"
        subtitle={
          <>
            Best move each way, {threats.length} threats × {team.members.length} of yours ·
            {' '}<strong>{matrix.cells.length * (matrix.cells[0]?.length ?? 0) * 8}</strong> calculations
          </>
        }
        actions={
          <div className="row-actions">
            <div className="seg">
              {(['verdict', 'offense', 'defense'] as View[]).map((v) => (
                <button key={v} className={`seg-btn ${view === v ? 'is-on' : ''}`} onClick={() => setView(v)}>
                  {v === 'verdict' ? 'Verdict' : v === 'offense' ? 'You deal' : 'You take'}
                </button>
              ))}
            </div>
            <Toggle label="Tailwind" checked={tailwind} onChange={setTailwind} />
            <Toggle label="Trick Room" checked={trickRoom} onChange={setTrickRoom} />
            <Toggle label="They're Intimidated" checked={intimidated} onChange={setIntimidated} />
          </div>
        }
      >
        <div className="score-strip">
          <div className="score">
            <span className="score-value">{score}</span>
            <span className="score-label">metagame score</span>
          </div>
          <p className="muted small">
            Weighted by how common each threat is: 100 means you beat everything on the list,
            0 means the whole list beats you. Use it to compare two versions of a team, not as an
            absolute rating.
          </p>
        </div>

        <div className="matrix-scroll">
          <table className="matrix">
            <thead>
              <tr>
                <th className="mx-corner">vs.</th>
                {matrix.threats.map((t, i) => (
                  <th key={t.id} title={threats[i]?.name}>
                    <div className="mx-head">
                      <Sprite species={resolveForm(t, format)?.species.name ?? t.species} size={28} />
                      <span>{displayName(resolveForm(t, format)?.species.name ?? t.species)}</span>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {team.members.map((member, row) => (
                <tr key={member.id}>
                  <th className="mx-row-head">
                    <Sprite species={resolveForm(member, format)?.species.name ?? member.species} size={26} />
                    <span>{member.nickname || displayName(resolveForm(member, format)?.species.name ?? member.species)}</span>
                  </th>
                  {matrix.threats.map((_, col) => {
                    const cell = matrix.cells[row][col];
                    const c = cellFor(cell);
                    return (
                      <td
                        key={col}
                        className={`mx-cell ${c.cls} ${detail?.row === row && detail?.col === col ? 'is-picked' : ''}`}
                        onClick={() => setDetail({ row, col })}
                        title={cell.offense?.result.desc ?? ''}
                      >
                        <span className="mx-text">{c.text}</span>
                        {c.sub && <span className="mx-sub">{c.sub}</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {selected && detail && (
        <Section
          title={`${team.members[detail.row].nickname ||
            displayName(resolveForm(team.members[detail.row], format)?.species.name ?? '')} vs ${threats[detail.col]?.name}`}
          subtitle={
            <>
              <Pill tone={verdictTone(selected.verdict)}>{VERDICT_LABEL[selected.verdict]}</Pill>
              {selected.tied
                ? <Pill tone="warn">Speed tie</Pill>
                : <Pill tone={selected.faster ? 'ok' : 'warn'}>
                    {selected.faster ? 'You move first' : 'They move first'}
                  </Pill>}
            </>
          }
          actions={<button className="btn btn-sm" onClick={() => setDetail(null)}>Close</button>}
        >
          <div className="grid-2">
            <div>
              <h4>Your damage</h4>
              <ul className="calc-lines">
                {selected.offenseAll.map((r) => (
                  <li key={r.move}>{r.result.desc}</li>
                ))}
                {!selected.offenseAll.length && <li className="muted">No damaging moves.</li>}
              </ul>
            </div>
            <div>
              <h4>Their damage</h4>
              <ul className="calc-lines">
                {selected.defenseAll.map((r) => (
                  <li key={r.move}>{r.result.desc}</li>
                ))}
                {!selected.defenseAll.length && <li className="muted">No damaging moves.</li>}
              </ul>
            </div>
          </div>
          {threats[detail.col]?.notes && (
            <p className="muted small note-line">{threats[detail.col].notes}</p>
          )}
        </Section>
      )}

      <Section title="Threat report" subtitle="Sorted by how much trouble each one causes, weighted by usage">
        <table className="report-table">
          <thead>
            <tr>
              <th>Threat</th><th>Pressure</th><th>You OHKO it</th><th>It OHKOes you</th><th>Best answer</th>
            </tr>
          </thead>
          <tbody>
            {[...summaries].sort((a, b) => b.pressure - a.pressure).map((s) => (
              <tr key={s.threatIndex}>
                <td>
                  <Sprite species={resolveForm(threatSets[s.threatIndex], format)?.species.name ?? ''} size={24} />
                  {s.name}
                </td>
                <td>
                  <div className="pressure">
                    <span className="pressure-bar" style={{ width: `${s.pressure}%` }} />
                    <span className="pressure-num">{s.pressure}</span>
                  </div>
                </td>
                <td className={s.koers.length ? '' : 'text-error'}>
                  {s.koers.length
                    ? s.koers.map((i) => shortName(team.members[i], format)).join(', ')
                    : 'nobody'}
                </td>
                <td className={s.victims.length >= 3 ? 'text-error' : ''}>
                  {s.victims.length ? `${s.victims.length} of yours` : 'nobody'}
                </td>
                <td>
                  {s.bestAnswer !== null
                    ? shortName(team.members[s.bestAnswer], format)
                    : <span className="text-error">none</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
    </div>
  );
}

function shortName(set: { nickname: string; species: string }, format: ReturnType<typeof useFormat>): string {
  return set.nickname || displayName(resolveForm(set as never, format)?.species.name ?? set.species);
}

function shortVerdict(v: Verdict): string {
  return {
    winning: 'win', favourable: 'good', even: 'even',
    unfavourable: 'bad', losing: 'lose', unset: '—',
  }[v];
}

function verdictTone(v: Verdict): string {
  return {
    winning: 'ok', favourable: 'ok', even: 'neutral',
    unfavourable: 'warn', losing: 'error', unset: 'neutral',
  }[v];
}
