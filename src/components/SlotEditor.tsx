import { useMemo } from 'react';
import type { LegalityIssue, StatID } from '../types';
import { STATS, STAT_NAMES } from '../types';
import {
  NATURES, TYPES, abilitiesFor, allItems, getItem, getMove, getSpecies, megasFor,
  natureLabel, natureModifier, toID,
} from '../data/dex';
import { CONFIDENCE_LABEL, legalMegas, rosterConfidence, speciesCatalogue } from '../data/roster';
import { displayName } from '../engine/calc';
import { MAX_EV_TOTAL, evTotal, resolveForm } from '../engine/stats';
import { useActiveTeam, useFormat, useStore } from '../store';
import { Combobox, Field, Pill, Section, Sprite, StatBar, TypeBadge } from './common';
import type { ComboOption } from './common';
import { OptimizerPanel } from './Optimizer';
import { SlotMatchupPreview } from './SlotMatchupPreview';
import { useLearnset } from './useLearnset';
import { plural } from '../text';

export function SlotEditor({ issues }: { issues: LegalityIssue[] }) {
  const team = useActiveTeam();
  const format = useFormat();
  const selected = useStore((s) => s.selectedSlot);
  const addMember = useStore((s) => s.addMember);
  const index = Math.min(selected, Math.max(0, team.members.length - 1));
  const member = team.members[index];

  if (!member) {
    return (
      <div className="empty-state">
        <h2>No Pokémon selected</h2>
        <p>Add one to start building a {format.shortName} team.</p>
        <button className="btn btn-primary" onClick={() => addMember()}>Add Pokémon</button>
      </div>
    );
  }
  return <SlotEditorInner key={member.id} index={index} issues={issues} />;
}

function SlotEditorInner({ index, issues }: { index: number; issues: LegalityIssue[] }) {
  const team = useActiveTeam();
  const format = useFormat();
  const update = useStore((s) => s.updateMember);
  const rosterOverride = useStore((s) => s.rosterOverride);

  const member = team.members[index];
  const learnset = useLearnset(member?.species ?? '');

  const allMegas = useMemo(() => megasFor(member?.species ?? ''), [member?.species]);

  const speciesOptions = useMemo<ComboOption[]>(() => {
    const catalogue = speciesCatalogue(format, rosterOverride);
    const rank: Record<string, number> = { confirmed: 0, likely: 1, unverified: 2, excluded: 3 };
    return catalogue
      .sort((a, b) =>
        rank[a.confidence] - rank[b.confidence] ||
        b.bst - a.bst ||
        a.species.name.localeCompare(b.species.name))
      .map((e) => ({
        value: e.species.name,
        label: e.species.name,
        keywords: `${e.species.types.join(' ')} ${e.species.num}`,
        sublabel: (
          <>
            {e.species.types.map((t: string) => <TypeBadge key={t} type={t} small />)}
            <span className="muted"> BST {e.bst}</span>
            {e.megaCount > 0 && <span className="mega-tag">{e.megaCount === 1 ? 'Mega' : `${e.megaCount} Megas`}</span>}
          </>
        ),
        right: <span className={`conf conf-${e.confidence}`}>{CONFIDENCE_LABEL[e.confidence]}</span>,
        disabled: e.confidence === 'excluded',
      }));
  }, [format, rosterOverride]);

  const itemOptions: ComboOption[] = useMemo(() => {
    const stones = new Set(allMegas.map((m) => m.stoneId));
    return allItems()
      .filter((i) => !i.megaStone || stones.has(i.id))
      .map((i) => ({
        value: i.name,
        label: i.name,
        keywords: i.desc ?? '',
        sublabel: <span className="muted small">{i.shortDesc || i.desc || ''}</span>,
        group: i.megaStone ? 'Mega Stone' : 'Item',
      }))
      .sort((a, b) => (a.group === 'Mega Stone' ? -1 : 0) - (b.group === 'Mega Stone' ? -1 : 0));
  }, [allMegas]);

  const moveOptions: ComboOption[] = useMemo(() => {
    const source = learnset.length ? learnset : [];
    return source.map((name) => {
      const m = getMove(name)!;
      return {
        value: m.name,
        label: m.name,
        keywords: `${m.type} ${m.category}`,
        sublabel: (
          <>
            <TypeBadge type={m.type} small />
            <span className="muted small">
              {m.category === 'Status' ? 'Status' : `${m.basePower || '—'} BP`}
              {' · '}{m.accuracy === true ? '—' : `${m.accuracy}%`}
              {m.target === 'allAdjacentFoes' || m.target === 'allAdjacent' ? ' · spread' : ''}
              {m.priority !== 0 ? ` · pri ${m.priority > 0 ? '+' : ''}${m.priority}` : ''}
            </span>
          </>
        ),
      };
    });
  }, [learnset]);

  const form = useMemo(() => (member ? resolveForm(member, format) : null), [member, format]);

  const stats = useMemo(() => {
    const out = {} as Record<StatID, number>;
    if (!form || !member) return out;
    for (const s of STATS) {
      const base = form.baseStats[s];
      const iv = member.ivs[s] ?? 31;
      const ev = member.evs[s] ?? 0;
      out[s] = s === 'hp'
        ? Math.floor(((2 * base + iv + Math.floor(ev / 4)) * member.level) / 100) + member.level + 10
        : Math.floor(
            (Math.floor(((2 * base + iv + Math.floor(ev / 4)) * member.level) / 100) + 5) *
            natureModifier(member.nature, s),
          );
    }
    return out;
  }, [form, member]);

  if (!member) return null;

  const slotIssues = issues.filter((i) => i.slot === index);
  const megaOptions = legalMegas(member.species, format);
  const confidence = rosterConfidence(member.species, format, rosterOverride);
  const spent = evTotal(member.evs);
  const remaining = MAX_EV_TOTAL - spent;

  const setEV = (stat: StatID, raw: number) => {
    const value = Math.max(0, Math.min(252, raw));
    update(index, { evs: { ...member.evs, [stat]: value } });
  };
  const setIV = (stat: StatID, raw: number) => {
    const value = Math.max(0, Math.min(31, raw));
    update(index, { ivs: { ...member.ivs, [stat]: value } });
  };

  return (
    <div className="build-grid">
      <div className="build-col">
        <Section
          title={member.nickname || displayName(form?.species.name ?? member.species)}
          subtitle={
            <span className="head-sub">
              {form?.types.map((t) => <TypeBadge key={t} type={t} small />)}
              {form?.mega && <Pill tone="mega">Mega Evolves</Pill>}
              <span className="muted small">
                Ability in battle: <strong>{form?.ability}</strong>
              </span>
            </span>
          }
          actions={<Sprite species={form?.species.name ?? member.species} size={64} />}
        >
          <div className="grid-2">
            <Field label="Pokémon">
              <Combobox
                value={member.species}
                options={speciesOptions}
                placeholder="Search Pokémon…"
                allowClear={false}
                onChange={(species) => {
                  const s = getSpecies(species);
                  if (!s) return;
                  update(index, {
                    species: s.name,
                    ability: Object.values(s.abilities)[0] as string,
                    item: megasFor(s.name).some((m) => m.stoneId === toID(member.item))
                      ? member.item
                      : getItem(member.item)?.megaStone ? '' : member.item,
                    moves: ['', '', '', ''],
                  });
                }}
                renderValue={(v) => (
                  <span className="combo-selected">
                    <Sprite species={v} size={22} />
                    {v || 'Select a Pokémon'}
                  </span>
                )}
              />
              {confidence !== 'confirmed' && (
                <span className={`conf conf-${confidence} conf-inline`}>
                  {CONFIDENCE_LABEL[confidence]}
                </span>
              )}
            </Field>

            <Field label="Nickname">
              <input
                value={member.nickname}
                placeholder={getSpecies(member.species)?.name ?? ''}
                onChange={(e) => update(index, { nickname: e.target.value })}
              />
            </Field>

            <Field label="Item">
              <Combobox
                value={member.item}
                options={itemOptions}
                placeholder="Search items…"
                onChange={(item) => update(index, { item })}
              />
            </Field>

            <Field label="Ability">
              <select
                value={member.ability}
                onChange={(e) => update(index, { ability: e.target.value })}
                disabled={!!form?.mega}
                title={form?.mega ? 'Mega Evolution overrides the Ability' : undefined}
              >
                {abilitiesFor(member.species).map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
            </Field>

            <Field label="Nature">
              <select value={member.nature} onChange={(e) => update(index, { nature: e.target.value })}>
                {NATURES.map((n) => (
                  <option key={n} value={n}>{natureLabel(n)}</option>
                ))}
              </select>
            </Field>

            <Field label="Level">
              <input
                type="number"
                min={1}
                max={100}
                value={member.level}
                onChange={(e) => update(index, { level: Number(e.target.value) || format.level })}
              />
            </Field>
          </div>

          {allMegas.length > 0 && (
            <div className="mega-row">
              <span className="mega-row-label">Mega Evolution</span>
              <button
                className={`mega-chip ${!form?.mega ? 'is-on' : ''}`}
                onClick={() => update(index, { item: getItem(member.item)?.megaStone ? '' : member.item })}
              >
                None
              </button>
              {allMegas.map((m) => {
                const legal = megaOptions.some((o) => o.forme === m.forme);
                return (
                  <button
                    key={m.forme}
                    disabled={!legal}
                    title={legal ? m.stone : `${displayName(m.forme)} is not legal in ${format.shortName}`}
                    className={`mega-chip ${form?.mega?.forme === m.forme ? 'is-on' : ''} ${legal ? '' : 'is-illegal'}`}
                    onClick={() => update(index, { item: m.stone })}
                  >
                    {displayName(m.forme)}
                    {m.isNew && <span className="new-tag">new</span>}
                  </button>
                );
              })}
            </div>
          )}
        </Section>

        <Section
          title="Moves"
          subtitle={learnset.length ? `${learnset.length} legal moves` : 'loading movepool…'}
        >
          <div className="move-grid">
            {[0, 1, 2, 3].map((i) => {
              const move = getMove(member.moves[i]);
              return (
                <div key={i} className="move-slot">
                  <Combobox
                    value={member.moves[i]}
                    options={moveOptions}
                    placeholder={`Move ${i + 1}`}
                    onChange={(m) => {
                      const moves = [...member.moves];
                      moves[i] = m;
                      update(index, { moves });
                    }}
                    renderValue={(v) => {
                      const mv = getMove(v);
                      return mv ? (
                        <span className="combo-selected">
                          <TypeBadge type={mv.type} small />
                          {mv.name}
                        </span>
                      ) : <span className="muted">Move {i + 1}</span>;
                    }}
                  />
                  {move && (
                    <div className="move-meta">
                      <span className={`cat cat-${move.category.toLowerCase()}`}>{move.category}</span>
                      <span>{move.category === 'Status' ? '—' : `${move.basePower} BP`}</span>
                      <span>{move.accuracy === true ? '—' : `${move.accuracy}%`}</span>
                      {(move.target === 'allAdjacentFoes' || move.target === 'allAdjacent') && (
                        <span className="tag-spread">spread ×0.75</span>
                      )}
                      {move.priority !== 0 && (
                        <span className="tag-priority">
                          priority {move.priority > 0 ? '+' : ''}{move.priority}
                        </span>
                      )}
                    </div>
                  )}
                  {move?.shortDesc && <p className="move-desc">{move.shortDesc}</p>}
                </div>
              );
            })}
          </div>
        </Section>

        <Section
          title="Spread"
          subtitle={
            <>
              <strong className={remaining < 0 ? 'text-error' : ''}>{remaining}</strong> EVs left
              {remaining >= 4 && ' — unspent EVs are free stats'}
            </>
          }
          actions={
            <div className="row-actions">
              <button className="btn btn-sm" onClick={() => update(index, { evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 } })}>
                Clear EVs
              </button>
              <button
                className="btn btn-sm"
                title="Set every IV to 31"
                onClick={() => update(index, { ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 } })}
              >
                Max IVs
              </button>
            </div>
          }
        >
          <div className="ev-table">
            <div className="ev-head">
              <span>Stat</span><span>Base</span><span>EVs</span><span /><span>IV</span><span>Total</span>
            </div>
            {STATS.map((stat) => {
              const mod = natureModifier(member.nature, stat);
              return (
                <div key={stat} className="ev-row">
                  <span className={`ev-name ${mod > 1 ? 'nat-up' : mod < 1 ? 'nat-down' : ''}`}>
                    {STAT_NAMES[stat]}
                    {mod > 1 ? '+' : mod < 1 ? '−' : ''}
                  </span>
                  <span className="ev-base">{form?.baseStats[stat]}</span>
                  <input
                    className="ev-num"
                    type="number"
                    min={0}
                    max={252}
                    step={4}
                    value={member.evs[stat] ?? 0}
                    onChange={(e) => setEV(stat, Number(e.target.value))}
                  />
                  <input
                    className="ev-slider"
                    type="range"
                    min={0}
                    max={252}
                    step={4}
                    value={member.evs[stat] ?? 0}
                    onChange={(e) => setEV(stat, Number(e.target.value))}
                  />
                  <input
                    className="iv-num"
                    type="number"
                    min={0}
                    max={31}
                    value={member.ivs[stat] ?? 31}
                    onChange={(e) => setIV(stat, Number(e.target.value))}
                  />
                  <span className="ev-total">
                    <strong>{stats[stat]}</strong>
                    <StatBar value={stats[stat]} max={stat === 'hp' ? 250 : 220} tone={stat} />
                  </span>
                </div>
              );
            })}
          </div>
        </Section>

        {slotIssues.length > 0 && (
          <Section title="Legality" subtitle={`${plural(slotIssues.length, 'note')} for this slot`}>
            <ul className="issue-list">
              {slotIssues.map((issue, i) => (
                <li key={i} className={`issue issue-${issue.level}`}>
                  <span className="issue-tag">{issue.level}</span>
                  <div>
                    <p>{issue.message}</p>
                    {issue.fix && <p className="muted small">{issue.fix}</p>}
                  </div>
                </li>
              ))}
            </ul>
          </Section>
        )}
      </div>

      <div className="build-col build-col-side">
        <SlotMatchupPreview member={member} />
        <OptimizerPanel member={member} index={index} />

        <Section title="Tera type" subtitle="Not available in Pokémon Champions">
          <p className="muted small">
            Champions is built around Mega Evolution, not Terastallization. This field is kept for
            teams imported from Scarlet/Violet formats and is ignored by every calculation.
          </p>
          <select
            value={member.teraType ?? ''}
            onChange={(e) => update(index, { teraType: e.target.value })}
          >
            <option value="">(none)</option>
            {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </Section>
      </div>
    </div>
  );
}
