import { useMemo } from 'react';
import { TYPES } from '../data/dex';
import { defensiveProfile, offensiveCoverage, roleReport, teamTypeTable } from '../engine/coverage';
import { displayName } from '../engine/calc';
import { resolveForm } from '../engine/stats';
import { useActiveTeam, useFormat, useStore } from '../store';
import { Section, Sprite, TypeBadge } from './common';

const ROLE_ROWS: { key: keyof ReturnType<typeof roleReport>; label: string; want: number; why: string }[] = [
  { key: 'speedControl', label: 'Speed control', want: 1, why: 'Tailwind, Trick Room, Icy Wind, Thunder Wave…' },
  { key: 'protect', label: 'Protect', want: 3, why: 'Scouts, stalls Fake Out, buys Tailwind/TR turns' },
  { key: 'fakeOut', label: 'Fake Out', want: 1, why: 'Denies a turn of damage on the crucial turn' },
  { key: 'intimidate', label: 'Intimidate', want: 1, why: 'Blanket answer to physical attackers' },
  { key: 'redirection', label: 'Redirection', want: 0, why: 'Follow Me / Rage Powder protects a setup partner' },
  { key: 'spread', label: 'Spread moves', want: 1, why: 'Hits both opponents — wins damage races' },
  { key: 'priority', label: 'Priority', want: 1, why: 'Finishes weakened Pokémon through speed control' },
  { key: 'recovery', label: 'Recovery', want: 0, why: 'Lets a bulky Pokémon come back in twice' },
  { key: 'screens', label: 'Screens', want: 0, why: 'Halves incoming damage for four turns' },
  { key: 'weatherSetters', label: 'Weather', want: 0, why: 'Sun offense is the top archetype in Reg M-B' },
  { key: 'terrainSetters', label: 'Terrain', want: 0, why: 'Grassy Terrain blunts Earthquake and heals' },
];

export function AnalysisPanel() {
  const format = useFormat();
  const team = useActiveTeam();
  const setTab = useStore((s) => s.setTab);

  const table = useMemo(() => teamTypeTable(team.members, format), [team.members, format]);
  const offense = useMemo(() => offensiveCoverage(team.members, format), [team.members, format]);
  const roles = useMemo(() => roleReport(team.members, format), [team.members, format]);

  if (!team.members.length) {
    return (
      <div className="empty-state">
        <h2>Nothing to analyse</h2>
        <button className="btn btn-primary" onClick={() => setTab('build')}>Go to Build</button>
      </div>
    );
  }

  return (
    <div className="analysis-wrap">
      <Section
        title="Defensive type chart"
        subtitle="How each Pokémon takes every attacking type, abilities included"
      >
        <div className="typegrid-scroll">
          <table className="typegrid">
            <thead>
              <tr>
                <th />
                {team.members.map((m) => (
                  <th key={m.id}>
                    <Sprite species={resolveForm(m, format)?.species.name ?? m.species} size={26} />
                  </th>
                ))}
                <th className="tg-total">weak</th>
              </tr>
            </thead>
            <tbody>
              {TYPES.map((type) => {
                const row = table.find((r) => r.type === type)!;
                return (
                  <tr key={type}>
                    <th className="tg-type"><TypeBadge type={type} small /></th>
                    {team.members.map((m, i) => {
                      const p = defensiveProfile(m, format);
                      const mult = p?.matchups[type] ?? 1;
                      return (
                        <td key={m.id} className={`tg-cell tg-${multClass(mult)}`} title={`${displayName(resolveForm(m, format)?.species.name ?? m.species)}: ${mult}×`}>
                          {mult === 1 ? '' : formatMult(mult)}
                          {row.stab.includes(i) && <span className="tg-stab" title="has STAB of this type">•</span>}
                        </td>
                      );
                    })}
                    <td className={`tg-total ${row.weak.length >= 3 ? 'is-bad' : ''}`}>
                      {row.weak.length}
                      {row.resist.length + row.immune.length === 0 && row.weak.length > 0 && (
                        <span className="tg-none" title="nothing on the team resists this">!</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="muted small">
          A dot marks a Pokémon that carries STAB of that type. The right column counts how many of
          your team are weak to it — three or more with no resist is the classic way to lose to one
          spread move.
        </p>
      </Section>

      <div className="grid-2">
        <Section title="Attacking coverage" subtitle="Best multiplier your team achieves against each type">
          <div className="coverage-grid">
            {offense.map((c) => (
              <div key={c.type} className={`cov cov-${c.best === 0 ? 'none' : c.best >= 2 ? 'se' : c.best === 1 ? 'ok' : 'bad'}`}>
                <TypeBadge type={c.type} small />
                <span className="cov-val">{c.best === 0 ? 'no answer' : `${c.best}×`}</span>
                <span className="muted small">
                  {c.slots.length ? `${c.slots.length} can hit it hard` : ''}
                </span>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Roles" subtitle="The support jobs a VGC team needs filled">
          <table className="role-table">
            <tbody>
              {ROLE_ROWS.map((r) => {
                const slots = roles[r.key];
                const short = slots.length < r.want;
                return (
                  <tr key={r.key} className={short ? 'is-short' : ''}>
                    <td className="role-label">
                      {r.label}
                      <span className="muted small">{r.why}</span>
                    </td>
                    <td className="role-count">{slots.length}</td>
                    <td className="role-mons">
                      {slots.map((i) => (
                        <Sprite
                          key={i}
                          size={22}
                          species={resolveForm(team.members[i], format)?.species.name ?? team.members[i].species}
                        />
                      ))}
                      {short && <span className="text-error small">needs {r.want}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Section>
      </div>

      <Section title="Per-Pokémon summary">
        <div className="summary-grid">
          {team.members.map((m) => {
            const p = defensiveProfile(m, format);
            const form = resolveForm(m, format);
            return (
              <div key={m.id} className="summary-card">
                <div className="summary-head">
                  <Sprite species={form?.species.name ?? m.species} size={40} />
                  <div>
                    <strong>{m.nickname || displayName(form?.species.name ?? m.species)}</strong>
                    <div>{form?.types.map((t) => <TypeBadge key={t} type={t} small />)}</div>
                  </div>
                </div>
                <dl>
                  <dt>Weak to</dt>
                  <dd>{p?.weaknesses.length
                    ? p.weaknesses.map((t) => <TypeBadge key={t} type={t} small />)
                    : <span className="muted">nothing</span>}</dd>
                  <dt>Resists</dt>
                  <dd>{p?.resistances.map((t) => <TypeBadge key={t} type={t} small />)}</dd>
                  {!!p?.immunities.length && (
                    <>
                      <dt>Immune</dt>
                      <dd>{p.immunities.map((t) => <TypeBadge key={t} type={t} small />)}</dd>
                    </>
                  )}
                </dl>
              </div>
            );
          })}
        </div>
      </Section>
    </div>
  );
}

function multClass(m: number): string {
  if (m === 0) return 'immune';
  if (m >= 4) return 'weak4';
  if (m > 1) return 'weak2';
  if (m <= 0.25) return 'res4';
  if (m < 1) return 'res2';
  return 'neutral';
}

function formatMult(m: number): string {
  if (m === 0) return '0';
  if (m === 0.25) return '¼';
  if (m === 0.5) return '½';
  return `${m}×`;
}
