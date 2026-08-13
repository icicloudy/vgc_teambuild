import { useMemo } from 'react';
import type { PokemonSet } from '../types';
import { bestMove, displayName } from '../engine/calc';
import { threatToSet } from '../engine/matrix';
import { computeSpeed, defaultScenario } from '../engine/speed';
import { resolveForm } from '../engine/stats';
import { useEnabledThreats, useFormat, useStore } from '../store';
import { Section, Sprite } from './common';
import { damageTone } from './format';

/**
 * Live "what does this set actually do" panel: the top threats sorted by how
 * dangerous they are to the Pokémon currently being edited.
 */
export function SlotMatchupPreview({ member }: { member: PokemonSet }) {
  const format = useFormat();
  const field = useStore((s) => s.field);
  const threats = useEnabledThreats();
  const setTab = useStore((s) => s.setTab);

  const rows = useMemo(() => {
    const scenario = defaultScenario();
    const mySpeed = computeSpeed(member, format, scenario).final;
    const defendField = {
      ...field,
      attackerSide: field.defenderSide,
      defenderSide: field.attackerSide,
    };

    return threats.slice(0, 10).map((threat) => {
      const set = threatToSet(threat, format.level);
      const out = bestMove(member, set, format, field);
      const inc = bestMove(set, member, format, defendField);
      const theirSpeed = computeSpeed(set, format, scenario).final;
      return {
        threat,
        set,
        out,
        inc,
        faster: mySpeed > theirSpeed,
        tied: mySpeed === theirSpeed,
      };
    }).sort((a, b) => (b.inc?.result.maxPct ?? 0) - (a.inc?.result.maxPct ?? 0));
  }, [member, threats, format, field]);

  const filled = member.moves.filter(Boolean).length;

  return (
    <Section
      title="Matchups"
      subtitle={
        filled
          ? 'Best move each way against the top of the metagame'
          : 'Add moves to see what this set does'
      }
      actions={
        <button className="btn btn-sm" onClick={() => setTab('threats')}>Full matrix</button>
      }
    >
      <div className="matchup-list">
        {rows.map(({ threat, set, out, inc, faster, tied }) => {
          const form = resolveForm(set, format);
          return (
            <div key={threat.id} className="matchup-row">
              <Sprite species={form?.species.name ?? threat.species} size={30} />
              <div className="matchup-name">
                <span>{displayName(form?.species.name ?? threat.species)}</span>
                <span className="muted small">
                  {tied ? 'speed tie' : faster ? 'you are faster' : 'they are faster'}
                </span>
              </div>

              <div className="matchup-dmg">
                <span className="matchup-dir">you →</span>
                {out && out.result.max > 0 ? (
                  <span className={`dmg dmg-${damageTone(out.result.maxPct)}`} title={out.result.desc}>
                    {out.result.minPct.toFixed(0)}–{out.result.maxPct.toFixed(0)}%
                    <em>{out.move}</em>
                  </span>
                ) : <span className="dmg dmg-none">—</span>}
              </div>

              <div className="matchup-dmg">
                <span className="matchup-dir">→ you</span>
                {inc && inc.result.max > 0 ? (
                  <span className={`dmg dmg-${damageTone(inc.result.maxPct)}`} title={inc.result.desc}>
                    {inc.result.minPct.toFixed(0)}–{inc.result.maxPct.toFixed(0)}%
                    <em>{inc.move}</em>
                  </span>
                ) : <span className="dmg dmg-none">—</span>}
              </div>
            </div>
          );
        })}
      </div>
    </Section>
  );
}
