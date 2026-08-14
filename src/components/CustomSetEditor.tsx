import { useMemo } from 'react';
import type { PokemonSet, StatID } from '../types';
import { STATS, STAT_NAMES } from '../types';
import { NATURES, abilitiesFor, getMove, natureLabel } from '../data/dex';
import { ITEM_CATEGORY_LABEL, itemCatalogue } from '../data/items';
import type { RosterOverride } from '../data/roster';
import type { FormatRules } from '../types';
import { MAX_SP_PER_STAT, MAX_SP_TOTAL, resolveForm, spTotal } from '../engine/stats';
import { Combobox, Field, TypeBadge } from './common';
import type { ComboOption } from './common';
import { SpeciesPicker } from './SpeciesPicker';
import { useLearnset } from './useLearnset';

/**
 * A compact set editor for the calculator, so any Pokémon can be measured —
 * not only the ones on your team or in the threat list.
 */
export function CustomSetEditor({
  set, onChange, format, override,
}: {
  set: PokemonSet;
  onChange: (patch: Partial<PokemonSet>) => void;
  format: FormatRules;
  override: RosterOverride | null;
}) {
  const learnset = useLearnset(set.species);
  const form = resolveForm(set, format);
  const spent = spTotal(set.sp);
  const remaining = MAX_SP_TOTAL - spent;

  const itemOptions = useMemo<ComboOption[]>(
    () => itemCatalogue(set.species).map(({ item, category }) => ({
      value: item.name,
      label: item.name,
      keywords: `${item.shortDesc} ${ITEM_CATEGORY_LABEL[category]}`,
      sublabel: <span className="muted small">{item.shortDesc}</span>,
      group: ITEM_CATEGORY_LABEL[category],
    })),
    [set.species],
  );

  const moveOptions = useMemo<ComboOption[]>(
    () => learnset.map((name) => {
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
            </span>
          </>
        ),
      };
    }),
    [learnset],
  );

  const setSP = (stat: StatID, raw: number) => {
    const held = set.sp[stat] ?? 0;
    const ceiling = Math.min(MAX_SP_PER_STAT, held + Math.max(0, remaining));
    onChange({ sp: { ...set.sp, [stat]: Math.max(0, Math.min(ceiling, Math.round(raw))) } });
  };

  return (
    <div className="custom-set">
      <Field label="Pokémon">
        <SpeciesPicker
          value={set.species}
          format={format}
          override={override}
          includeIllegal
          onChange={(name) => {
            const abilities = abilitiesFor(name);
            onChange({
              species: name,
              ability: abilities[0] ?? '',
              moves: ['', '', '', ''],
              item: '',
            });
          }}
        />
      </Field>

      <div className="custom-row">
        <Field label="Ability">
          <select
            value={set.ability}
            onChange={(e) => onChange({ ability: e.target.value })}
            disabled={!!form?.mega}
            title={form?.mega ? 'Mega Evolution overrides the Ability' : undefined}
          >
            {abilitiesFor(set.species).map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </Field>
        <Field label="Nature">
          <select value={set.nature} onChange={(e) => onChange({ nature: e.target.value })}>
            {NATURES.map((n) => <option key={n} value={n}>{natureLabel(n)}</option>)}
          </select>
        </Field>
      </div>

      <Field label="Item">
        <Combobox
          value={set.item}
          options={itemOptions}
          placeholder="Search items…"
          onChange={(item) => onChange({ item })}
        />
      </Field>

      <div className="custom-sp">
        <span className="custom-sp-head">
          Stat Points <em>{remaining} of {MAX_SP_TOTAL} left</em>
        </span>
        <div className="custom-sp-row">
          {STATS.map((stat) => (
            <label key={stat} className="custom-sp-cell">
              <span>{STAT_NAMES[stat]}</span>
              <input
                type="number"
                min={0}
                max={MAX_SP_PER_STAT}
                value={set.sp[stat] ?? 0}
                onChange={(e) => setSP(stat, Number(e.target.value))}
              />
            </label>
          ))}
        </div>
      </div>

      <div className="custom-moves">
        {[0, 1, 2, 3].map((i) => (
          <Combobox
            key={i}
            value={set.moves[i] ?? ''}
            options={moveOptions}
            placeholder={`Move ${i + 1}`}
            compact
            onChange={(m) => {
              const moves = [...set.moves];
              moves[i] = m;
              onChange({ moves });
            }}
            renderValue={(v) => {
              const mv = getMove(v);
              return mv
                ? <span className="combo-selected"><TypeBadge type={mv.type} small />{mv.name}</span>
                : <span className="muted">Move {i + 1}</span>;
            }}
          />
        ))}
      </div>
    </div>
  );
}
