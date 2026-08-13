import { useCallback, useMemo } from 'react';
import type { FormatRules } from '../types';
import { getSpecies } from '../data/dex';
import { CONFIDENCE_LABEL, speciesCatalogue } from '../data/roster';
import type { RosterOverride } from '../data/roster';
import { parseSpeciesQuery, searchSpecies } from '../data/search';
import { Combobox, Sprite, TypeBadge } from './common';
import type { ComboOption } from './common';

/**
 * The species picker, shared by the team builder and the calculator.
 *
 * The search box takes what a Pokémon *does*, not only its name: "intimidate",
 * "fake out", "steel", or several at once ("fake out intimidate") to stack them.
 */
export function SpeciesPicker({
  value, onChange, format, override, includeIllegal = false, placeholder = 'Name, ability, move or type…',
}: {
  value: string;
  onChange: (species: string) => void;
  format: FormatRules;
  override: RosterOverride | null;
  /** The calculator allows anything; the builder does not. */
  includeIllegal?: boolean;
  placeholder?: string;
}) {
  const catalogue = useMemo(
    () => speciesCatalogue(format, override),
    [format, override],
  );

  const options = useMemo<ComboOption[]>(
    () => catalogue.map((e) => ({
      value: e.species.name,
      label: e.species.name,
      id: e.species.id,
      keywords: `${e.species.types.join(' ')} ${e.species.num}`,
      sublabel: (
        <>
          {e.species.types.map((t: string) => <TypeBadge key={t} type={t} small />)}
          <span className="muted"> BST {e.bst}</span>
          {e.megaCount > 0 && (
            <span className="mega-tag">{e.megaCount === 1 ? 'Mega' : `${e.megaCount} Megas`}</span>
          )}
          {e.species.nfe && <span className="nfe-tag">not fully evolved</span>}
        </>
      ),
      right: <span className={`conf conf-${e.confidence}`}>{CONFIDENCE_LABEL[e.confidence]}</span>,
      disabled: !includeIllegal && e.confidence === 'excluded',
    })),
    [catalogue, includeIllegal],
  );

  const speciesById = useMemo(
    () => new Map(catalogue.map((e) => [e.species.id, e.species])),
    [catalogue],
  );

  // The catalogue is already ordered by relevance, so filtering preserves it.
  const search = useCallback(
    (query: string, opts: ComboOption[]) => {
      if (!query.trim()) return opts;
      const pool = opts
        .map((o) => (o.id ? speciesById.get(o.id) : undefined))
        .filter(Boolean) as NonNullable<ReturnType<typeof getSpecies>>[];
      const allowed = new Set(searchSpecies(query, pool).map((s) => s.id));
      return opts.filter((o) => o.id && allowed.has(o.id));
    },
    [speciesById],
  );

  const renderHeader = useCallback((query: string, matches: number) => {
    if (!query.trim()) return null;
    const { terms } = parseSpeciesQuery(query);
    const filters = terms.filter((t) => t.kind !== 'name');
    if (!filters.length && terms.length <= 1) return null;
    return (
      <div className="combo-filters">
        {terms.map((t, i) => (
          <span key={`${t.kind}-${t.text}-${i}`} className={`filter-chip chip-${t.kind}`}>
            <em>{t.kind === 'name' ? 'name' : t.kind}</em>
            {t.label}
          </span>
        ))}
        <span className="muted small">{matches} match{matches === 1 ? '' : 'es'}</span>
      </div>
    );
  }, []);

  return (
    <Combobox
      value={value}
      options={options}
      search={search}
      renderHeader={renderHeader}
      placeholder={placeholder}
      allowClear={false}
      onChange={(name) => { if (getSpecies(name)) onChange(name); }}
      renderValue={(v) => (
        <span className="combo-selected">
          <Sprite species={v} size={22} />
          {v || 'Select a Pokémon'}
        </span>
      )}
    />
  );
}
