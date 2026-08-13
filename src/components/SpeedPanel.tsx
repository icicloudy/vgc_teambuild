import { useMemo, useState } from 'react';
import { buildSpeedRows, defaultScenario, outspeedShare } from '../engine/speed';
import type { SpeedScenario } from '../engine/speed';
import { threatToSet } from '../engine/matrix';
import { displayName } from '../engine/calc';
import { resolveForm } from '../engine/stats';
import { useActiveTeam, useEnabledThreats, useFormat, useStore } from '../store';
import { Section, Sprite, Toggle } from './common';

export function SpeedPanel() {
  const format = useFormat();
  const team = useActiveTeam();
  const threats = useEnabledThreats();
  const setTab = useStore((s) => s.setTab);

  const [mine, setMine] = useState<SpeedScenario>(defaultScenario());
  const [theirs, setTheirs] = useState<SpeedScenario>(defaultScenario());

  const threatSets = useMemo(
    () => threats.map((t) => threatToSet(t, format.level)),
    [threats, format.level],
  );

  const rows = useMemo(
    () => buildSpeedRows(team.members, threatSets, format, mine, theirs),
    [team.members, threatSets, format, mine, theirs],
  );

  const maxSpeed = Math.max(1, ...rows.map((r) => r.speed));

  const shares = useMemo(
    () => team.members.map((m) => ({
      member: m,
      share: outspeedShare(m, threatSets, format, mine, theirs),
    })),
    [team.members, threatSets, format, mine, theirs],
  );

  if (!team.members.length) {
    return (
      <div className="empty-state">
        <h2>No team yet</h2>
        <p>Speed tiers compare your Pokémon against the metagame list.</p>
        <button className="btn btn-primary" onClick={() => setTab('build')}>Go to Build</button>
      </div>
    );
  }

  return (
    <div className="speed-wrap">
      <Section
        title="Speed tiers"
        subtitle={
          mine.trickRoom
            ? 'Trick Room: slowest moves first — the ladder is inverted'
            : 'Fastest first. Your Pokémon are highlighted.'
        }
        actions={
          <div className="row-actions">
            <span className="muted small">Yours:</span>
            <select
              value={mine.boost}
              onChange={(e) => setMine({ ...mine, boost: Number(e.target.value) })}
            >
              {[0, 1, 2, -1, -2].map((b) => (
                <option key={b} value={b}>{b === 0 ? 'no boost' : `${b > 0 ? '+' : ''}${b}`}</option>
              ))}
            </select>
            <Toggle label="Tailwind" checked={mine.tailwind} onChange={(v) => setMine({ ...mine, tailwind: v })} />
            <Toggle label="Paralysed" checked={mine.paralysis} onChange={(v) => setMine({ ...mine, paralysis: v })} />
            <span className="muted small">Theirs:</span>
            <Toggle label="Tailwind" checked={theirs.tailwind} onChange={(v) => setTheirs({ ...theirs, tailwind: v })} />
            <span className="muted small">Both:</span>
            <select
              value={mine.weather}
              onChange={(e) => {
                const weather = e.target.value as SpeedScenario['weather'];
                setMine({ ...mine, weather });
                setTheirs({ ...theirs, weather });
              }}
            >
              <option value="">no weather</option>
              <option value="Sun">Sun</option>
              <option value="Rain">Rain</option>
              <option value="Sand">Sand</option>
              <option value="Snow">Snow</option>
            </select>
            <Toggle
              label="Trick Room"
              checked={mine.trickRoom}
              onChange={(v) => { setMine({ ...mine, trickRoom: v }); setTheirs({ ...theirs, trickRoom: v }); }}
            />
          </div>
        }
      >
        <div className="speed-ladder">
          {rows.map((r) => (
            <div key={r.key} className={`speed-row ${r.source === 'team' ? 'is-mine' : ''}`}>
              <span className="speed-value">{r.speed}</span>
              <span className="speed-bar-wrap">
                <span className="speed-bar" style={{ width: `${(r.speed / maxSpeed) * 100}%` }} />
              </span>
              <Sprite species={r.species} size={24} />
              <span className="speed-name">{r.label}</span>
              <span className="speed-mods muted small">
                {r.applied.length ? r.applied.join(' + ') : `base ${r.base}`}
              </span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Speed control summary" subtitle="How much of the metagame each of your Pokémon moves before">
        <table className="report-table">
          <thead>
            <tr><th>Pokémon</th><th>Speed</th><th>Outspeeds</th><th /></tr>
          </thead>
          <tbody>
            {shares.map(({ member, share }) => {
              const row = rows.find((r) => r.key === `team-${member.id}`);
              const pct = share.total ? Math.round((share.faster / share.total) * 100) : 0;
              return (
                <tr key={member.id}>
                  <td>
                    <Sprite species={resolveForm(member, format)?.species.name ?? member.species} size={24} />
                    {member.nickname || displayName(resolveForm(member, format)?.species.name ?? member.species)}
                  </td>
                  <td className="num">{row?.speed ?? 0}</td>
                  <td className="num">
                    {share.faster}/{share.total}
                    {share.tied > 0 && <span className="muted small"> ({share.tied} tie)</span>}
                  </td>
                  <td>
                    <div className="pressure">
                      <span className="pressure-bar pressure-good" style={{ width: `${pct}%` }} />
                      <span className="pressure-num">{pct}%</span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Section>
    </div>
  );
}
