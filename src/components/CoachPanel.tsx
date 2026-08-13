import { useMemo } from 'react';
import type { LegalityIssue } from '../types';
import { buildMatrix, summariseThreats, threatToSet } from '../engine/matrix';
import { buildSuggestions } from '../engine/suggest';
import { displayName } from '../engine/calc';
import { resolveForm } from '../engine/stats';
import { useActiveTeam, useEnabledThreats, useFormat, useStore } from '../store';
import { Pill, Section, Sprite } from './common';
import { plural } from '../text';

export function CoachPanel({ issues }: { issues: LegalityIssue[] }) {
  const format = useFormat();
  const team = useActiveTeam();
  const threats = useEnabledThreats();
  const field = useStore((s) => s.field);
  const rosterOverride = useStore((s) => s.rosterOverride);
  const addMember = useStore((s) => s.addMember);
  const selectSlot = useStore((s) => s.selectSlot);
  const setTab = useStore((s) => s.setTab);
  const setTeamNotes = useStore((s) => s.setTeamNotes);

  const threatSets = useMemo(
    () => threats.map((t) => threatToSet(t, format.level)),
    [threats, format.level],
  );

  const { suggestions } = useMemo(() => {
    if (!team.members.length) return { suggestions: [] };
    const matrix = buildMatrix(team.members, threatSets, { format, field });
    const summaries = summariseThreats(matrix, team.members, format, threats.map((t) => t.usage));
    return {
      suggestions: buildSuggestions(team.members, format, matrix, summaries, rosterOverride),
    };
  }, [team.members, threatSets, format, field, threats, rosterOverride]);

  const blocking = issues.filter((i) => i.level === 'error');

  if (!team.members.length) {
    return (
      <div className="empty-state">
        <h2>Build something first</h2>
        <p>The coach reads your team, runs the full threat matrix and tells you what to fix.</p>
        <button className="btn btn-primary" onClick={() => setTab('build')}>Go to Build</button>
      </div>
    );
  }

  return (
    <div className="coach-wrap">
      {blocking.length > 0 && (
        <Section title="Fix before you play" subtitle={plural(blocking.length, 'rule violation')}>
          <ul className="issue-list">
            {blocking.map((issue, i) => (
              <li key={i} className="issue issue-error">
                <span className="issue-tag">illegal</span>
                <div>
                  <p>{issue.message}</p>
                  {issue.fix && <p className="muted small">{issue.fix}</p>}
                </div>
                {issue.slot !== null && (
                  <button
                    className="btn btn-sm"
                    onClick={() => { selectSlot(issue.slot!); setTab('build'); }}
                  >
                    Open slot
                  </button>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section
        title="Coach"
        subtitle={
          suggestions.length
            ? `${plural(suggestions.length, 'thing')} worth looking at, most important first`
            : 'Nothing obvious to improve — nice team.'
        }
      >
        <div className="advice-list">
          {suggestions.map((s) => (
            <article key={s.id} className={`advice advice-${s.severity}`}>
              <header>
                <Pill tone={s.severity === 'critical' ? 'error' : s.severity === 'important' ? 'warn' : 'neutral'}>
                  {s.severity}
                </Pill>
                <h3>{s.title}</h3>
                <span className="advice-kind">{s.kind}</span>
              </header>
              <p>{s.detail}</p>

              {!!s.slots?.length && (
                <div className="advice-mons">
                  {s.slots.map((i) => team.members[i] && (
                    <button
                      key={i}
                      className="mon-chip"
                      onClick={() => { selectSlot(i); setTab('build'); }}
                    >
                      <Sprite
                        size={22}
                        species={resolveForm(team.members[i], format)?.species.name ?? team.members[i].species}
                      />
                      {team.members[i].nickname ||
                        displayName(resolveForm(team.members[i], format)?.species.name ?? team.members[i].species)}
                    </button>
                  ))}
                </div>
              )}

              {!!s.candidates?.length && (
                <div className="advice-candidates">
                  <span className="muted small">Try:</span>
                  {s.candidates.map((c) => (
                    <button
                      key={c}
                      className="mon-chip mon-chip-add"
                      title={`Add ${c} to the team`}
                      disabled={team.members.length >= format.bring}
                      onClick={() => { addMember(c); setTab('build'); }}
                    >
                      <Sprite size={22} species={c} />
                      {c}
                      <span className="chip-plus">+</span>
                    </button>
                  ))}
                </div>
              )}
            </article>
          ))}

          {!suggestions.length && (
            <p className="muted">
              No structural problems found. Keep an eye on the threat report — a high pressure score
              on a common Pokémon is usually worth a slot change even when nothing here fires.
            </p>
          )}
        </div>
      </Section>

      <Section title="Notes" subtitle="Saved with the team">
        <textarea
          className="notes"
          rows={6}
          value={team.notes}
          placeholder="Leads, common game plans, matchup notes…"
          onChange={(e) => setTeamNotes(e.target.value)}
        />
      </Section>
    </div>
  );
}
