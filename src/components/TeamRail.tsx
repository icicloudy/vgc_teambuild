import type { LegalityIssue } from '../types';
import { getMove } from '../data/dex';
import { displayName } from '../engine/calc';
import { resolveForm } from '../engine/stats';
import { useActiveTeam, useFormat, useStore } from '../store';
import { CategoryBadge, Sprite, TypeBadge } from './common';

export function TeamRail({ issues }: { issues: LegalityIssue[] }) {
  const team = useActiveTeam();
  const format = useFormat();
  const selected = useStore((s) => s.selectedSlot);
  const selectSlot = useStore((s) => s.selectSlot);
  const addMember = useStore((s) => s.addMember);
  const removeMember = useStore((s) => s.removeMember);
  const moveMember = useStore((s) => s.moveMember);
  const duplicateMember = useStore((s) => s.duplicateMember);
  const setTab = useStore((s) => s.setTab);

  const slotIssues = (i: number) => issues.filter((issue) => issue.slot === i);

  return (
    <aside className="rail">
      <div className="rail-head">
        <h2>Team</h2>
        <span className="rail-count">{team.members.length}/{format.bring}</span>
      </div>

      <div className="rail-list">
        {team.members.map((member, i) => {
          const form = resolveForm(member, format);
          const mine = slotIssues(i);
          const errors = mine.filter((x) => x.level === 'error').length;
          const warns = mine.filter((x) => x.level === 'warning').length;
          const name = displayName(form?.species.name ?? member.species);

          return (
            <div
              key={member.id}
              className={`slot ${selected === i ? 'is-selected' : ''} ${errors ? 'has-error' : ''}`}
              onClick={() => { selectSlot(i); setTab('build'); }}
            >
              <Sprite species={form?.species.name ?? member.species} size={44} />
              <div className="slot-main">
                <div className="slot-title">
                  <span className="slot-name">{member.nickname || name}</span>
                  {form?.mega && <span className="slot-mega">M</span>}
                </div>
                <div className="slot-types">
                  {form?.types.map((t) => <TypeBadge key={t} type={t} small />)}
                </div>
                <div className="slot-meta">
                  {member.item || 'no item'} · {member.ability || 'no ability'}
                </div>
                <div className="slot-moves">
                  {member.moves.filter(Boolean).map((m, k) => {
                    const move = getMove(m);
                    return (
                      <span key={k} className={`slot-move mv-${(move?.type ?? '').toLowerCase()}`}>
                        {move && <CategoryBadge category={move.category} />}
                        {move?.name ?? m}
                      </span>
                    );
                  })}
                </div>
              </div>

              <div className="slot-side">
                {errors > 0 && <span className="dot dot-error" title={`${errors} illegal`} />}
                {warns > 0 && errors === 0 && <span className="dot dot-warn" title={`${warns} warning`} />}
                <div className="slot-tools" onClick={(e) => e.stopPropagation()}>
                  <button className="slot-tool-move" title="Move up" onClick={() => moveMember(i, i - 1)}>↑</button>
                  <button className="slot-tool-move" title="Move down" onClick={() => moveMember(i, i + 1)}>↓</button>
                  <button className="slot-tool-move" title="Duplicate" onClick={() => duplicateMember(i)}>⧉</button>
                  <button className="slot-tool-del" title="Remove" onClick={() => removeMember(i)}>×</button>
                </div>
              </div>
            </div>
          );
        })}

        {team.members.length < format.bring && (
          <button className="slot slot-add" onClick={() => addMember()}>
            <span className="slot-add-plus">+</span>
            <span>Add Pokémon {team.members.length + 1}</span>
          </button>
        )}
      </div>

      <div className="rail-foot">
        <p className="muted small">
          {format.name}
          <br />
          {format.window}
        </p>
      </div>
    </aside>
  );
}
