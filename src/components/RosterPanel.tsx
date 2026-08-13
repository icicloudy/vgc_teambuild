import { useMemo, useState } from 'react';
import { FORMATS } from '../data/formats';
import { confirmedRoster, parseRosterPaste, speciesCatalogue } from '../data/roster';
import { megasFor } from '../data/dex';
import { displayName } from '../engine/calc';
import { useFormat, useStore } from '../store';
import { Pill, Section, Sprite, TypeBadge } from './common';

export function RosterPanel() {
  const format = useFormat();
  const override = useStore((s) => s.rosterOverride);
  const setOverride = useStore((s) => s.setRosterOverride);

  const [paste, setPaste] = useState('');
  const [result, setResult] = useState<{ ok: number; unknown: string[] } | null>(null);
  const [filter, setFilter] = useState('');

  const catalogue = useMemo(
    () => speciesCatalogue(format, override),
    [format, override],
  );

  const counts = useMemo(() => {
    const c = { confirmed: 0, likely: 0, unverified: 0, excluded: 0 };
    for (const e of catalogue) c[e.confidence]++;
    return c;
  }, [catalogue]);

  const legalMegaCount = useMemo(
    () => catalogue
      .filter((e) => e.confidence === 'confirmed' || e.confidence === 'likely')
      .reduce((n, e) => n + e.megaCount, 0),
    [catalogue],
  );

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return catalogue
      .filter((e) => e.confidence !== 'excluded')
      .filter((e) => !q || e.species.name.toLowerCase().includes(q))
      .slice(0, 400);
  }, [catalogue, filter]);

  const applyPaste = () => {
    const { species, unknown } = parseRosterPaste(paste);
    if (!species.length) {
      setResult({ ok: 0, unknown });
      return;
    }
    setOverride({ species, importedAt: Date.now(), label: `${species.length} species` });
    setResult({ ok: species.length, unknown });
    setPaste('');
  };

  return (
    <div className="roster-wrap">
      <Section title={format.name} subtitle={format.window}>
        <ul className="rule-list">
          {format.notes.map((n, i) => <li key={i}>{n}</li>)}
        </ul>
        <div className="rule-grid">
          <div><span>Battle</span><strong>{format.gameType}</strong></div>
          <div><span>Team</span><strong>Bring {format.bring}, pick {format.pick}</strong></div>
          <div><span>Level</span><strong>{format.level}</strong></div>
          <div><span>Species Clause</span><strong>{format.speciesClause ? 'Yes' : 'No'}</strong></div>
          <div><span>Item Clause</span><strong>{format.itemClause ? 'Yes' : 'No'}</strong></div>
          <div><span>Mega per battle</span><strong>{format.megaPerBattle}</strong></div>
          <div><span>Terastallization</span><strong>{format.teraAllowed ? 'Yes' : 'No'}</strong></div>
          <div><span>Legal Megas here</span><strong>{legalMegaCount}</strong></div>
        </div>
        <p className="muted small source-note">{format.sourceNotes}</p>
      </Section>

      <Section
        title="Roster accuracy"
        subtitle={
          override
            ? `Using your imported roster (${override.species.length} species)`
            : 'Using the built-in approximation'
        }
        actions={
          override && (
            <button className="btn btn-sm" onClick={() => setOverride(null)}>
              Revert to built-in
            </button>
          )
        }
      >
        {!override && (
          <>
            <p className="callout">
              Champions ships a curated roster — 208 species and 75 Mega Evolutions as of Reg M-B —
              and that list is not published anywhere this app can read offline. So legality works in
              two layers:
            </p>
            <ul className="rule-list">
              <li>
                <strong>Hard rules</strong> from the regulation (no Legendary, Mythical, Paradox or
                Treasures of Ruin; banned Megas; clauses) are enforced as errors. These are reliable.
              </li>
              <li>
                <strong>Roster membership</strong> is a best guess:
                {' '}<Pill tone="ok">{counts.confirmed} confirmed</Pill>{' '}
                (every species with a Champions Mega Stone, plus Pokémon named in official coverage),
                {' '}<Pill tone="warn">{counts.likely} likely</Pill> and
                {' '}<Pill tone="neutral">{counts.unverified} unverified</Pill>.
                Those produce notes, never errors, so the builder never blocks you on a guess.
              </li>
            </ul>
            <p className="muted small">
              Paste the in-game Pokédex list below and the guessing stops — the imported list becomes
              the single source of truth for legality, the species picker and the counter suggestions.
            </p>
          </>
        )}

        <textarea
          className="notes"
          rows={6}
          value={paste}
          placeholder={'Paste the in-game roster, one Pokémon per line:\nVenusaur\nCharizard\nBlastoise\n…'}
          onChange={(e) => setPaste(e.target.value)}
        />
        <div className="row-actions">
          <button className="btn btn-primary" onClick={applyPaste} disabled={!paste.trim()}>
            Import roster
          </button>
          {result && (
            <span className="muted small">
              {result.ok
                ? `Imported ${result.ok} species.`
                : 'Nothing recognisable in that paste.'}
              {result.unknown.length > 0 &&
                ` Skipped ${result.unknown.length}: ${result.unknown.slice(0, 5).join(', ')}${result.unknown.length > 5 ? '…' : ''}`}
            </span>
          )}
        </div>
      </Section>

      <Section
        title="Legal species"
        subtitle={`${catalogue.filter((e) => e.confidence !== 'excluded').length} selectable in ${format.shortName}`}
        actions={
          <input
            className="filter-input"
            value={filter}
            placeholder="Filter…"
            onChange={(e) => setFilter(e.target.value)}
          />
        }
      >
        <div className="species-grid">
          {shown.map((e) => (
            <div key={e.species.name} className={`species-card conf-border-${e.confidence}`}>
              <Sprite species={e.species.name} size={36} />
              <div>
                <strong>{e.species.name}</strong>
                <div>{e.species.types.map((t: string) => <TypeBadge key={t} type={t} small />)}</div>
                <span className="muted small">BST {e.bst}</span>
                {e.megaCount > 0 && (
                  <div className="species-megas">
                    {megasFor(e.species.name).map((m) => (
                      <span key={m.forme} className={`mega-mini ${m.isNew ? 'is-new' : ''}`}>
                        {displayName(m.forme).replace(`Mega ${e.species.name}`, 'Mega').trim() || 'Mega'}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="All formats" subtitle="Rules the app knows about">
        <table className="report-table">
          <thead>
            <tr><th>Format</th><th>Window</th><th>Type</th><th>Megas</th><th>Notes</th></tr>
          </thead>
          <tbody>
            {FORMATS.map((f) => (
              <tr key={f.id} className={f.id === format.id ? 'is-current' : ''}>
                <td>{f.name}</td>
                <td>{f.window}</td>
                <td>{f.gameType}</td>
                <td>{f.megaPerBattle ? `${f.megaPerBattle}/battle` : 'none'}</td>
                <td className="muted small">{f.sourceNotes}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted small">
          Built-in confirmed roster: {confirmedRoster().size} species.
        </p>
      </Section>
    </div>
  );
}
