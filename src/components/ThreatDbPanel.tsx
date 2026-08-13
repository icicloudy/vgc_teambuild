import { useState } from 'react';
import type { ThreatSet } from '../types';
import { getSpecies } from '../data/dex';
import { threatToSet } from '../engine/matrix';
import { resolveForm } from '../engine/stats';
import { importTeam } from '../engine/showdown';
import { useFormat, useStore } from '../store';
import { Pill, Section, Sprite, TypeBadge } from './common';
import { plural } from '../text';

export function ThreatDbPanel() {
  const format = useFormat();
  const threats = useStore((s) => s.threats);
  const disabled = useStore((s) => s.disabledThreats);
  const toggleThreat = useStore((s) => s.toggleThreat);
  const upsertThreat = useStore((s) => s.upsertThreat);
  const removeThreat = useStore((s) => s.removeThreat);
  const resetThreats = useStore((s) => s.resetThreats);

  const [paste, setPaste] = useState('');
  const [pasteMsg, setPasteMsg] = useState('');

  const addFromPaste = () => {
    const { sets, errors } = importTeam(paste);
    if (!sets.length) {
      setPasteMsg(errors[0] ?? 'Nothing could be read from that paste.');
      return;
    }
    for (const set of sets) {
      const species = getSpecies(set.species);
      if (!species) continue;
      upsertThreat({
        id: `custom-${set.id}`,
        name: set.nickname || species.name,
        species: species.name,
        item: set.item,
        ability: set.ability,
        nature: set.nature,
        sp: set.sp,
        moves: set.moves.filter(Boolean),
        usage: 50,
        role: 'Custom',
        notes: 'Added from a Showdown paste.',
        builtIn: false,
      });
    }
    setPasteMsg(`Added ${plural(sets.length, 'threat')}.${errors.length ? ` ${plural(errors.length, 'warning')}.` : ''}`);
    setPaste('');
  };

  const active = threats.filter((t) => !disabled.includes(t.id)).length;

  return (
    <div className="threatdb-wrap">
      <Section
        title="Metagame threat list"
        subtitle={
          <>
            {active} of {threats.length} threats active. Every calculation in the app — the matrix,
            the coach, the optimizer — runs against exactly this list.
          </>
        }
        actions={<button className="btn btn-sm" onClick={resetThreats}>Reset to defaults</button>}
      >
        <p className="muted small callout">
          Champions publishes no usage statistics, so the built-in list and its usage weights are a
          hand-picked starting point for Reg M-B, not scraped ladder data. Edit the weights, disable
          what you never face, and paste in the sets you actually lose to — the tools get sharper
          the closer this list is to your ladder.
        </p>

        <div className="threat-list">
          {threats.map((t) => {
            const off = disabled.includes(t.id);
            const set = threatToSet(t, format.level);
            const form = resolveForm(set, format);
            return (
              <div key={t.id} className={`threat-card ${off ? 'is-off' : ''}`}>
                <div className="threat-head">
                  <Sprite species={form?.species.name ?? t.species} size={40} />
                  <div className="threat-title">
                    <strong>{t.name}</strong>
                    <span className="muted small">{t.role}</span>
                    <div>{form?.types.map((ty) => <TypeBadge key={ty} type={ty} small />)}</div>
                  </div>
                  <div className="threat-controls">
                    <label className="usage-field" title="How common this threat is — weights the pressure score">
                      <span>usage</span>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={t.usage}
                        onChange={(e) => upsertThreat({ ...t, usage: Number(e.target.value) })}
                      />
                    </label>
                    <button className="btn btn-sm" onClick={() => toggleThreat(t.id)}>
                      {off ? 'Enable' : 'Disable'}
                    </button>
                    {!t.builtIn && (
                      <button className="btn btn-sm btn-danger" onClick={() => removeThreat(t.id)}>
                        Delete
                      </button>
                    )}
                  </div>
                </div>

                <div className="threat-body">
                  <span className="threat-line">
                    @ {t.item || 'no item'} · {t.ability} · {t.nature}
                  </span>
                  <span className="threat-line muted">{formatSP(t)}</span>
                  <div className="threat-moves">
                    {t.moves.map((m) => <span key={m} className="threat-move">{m}</span>)}
                  </div>
                  {t.notes && <p className="threat-note">{t.notes}</p>}
                  {!t.builtIn && <Pill tone="neutral">custom</Pill>}
                </div>
              </div>
            );
          })}
        </div>
      </Section>

      <Section
        title="Add a threat"
        subtitle="Paste any Showdown-format set — including the one that just beat you"
      >
        <textarea
          className="notes"
          rows={8}
          value={paste}
          placeholder={'Mega Metagross\nAbility: Clear Body\nLevel: 50\nEVs: 4 HP / 252 Atk / 252 Spe\nAdamant Nature\n- Iron Head\n- Zen Headbutt\n- Bullet Punch\n- Protect'}
          onChange={(e) => setPaste(e.target.value)}
        />
        <div className="row-actions">
          <button className="btn btn-primary" onClick={addFromPaste} disabled={!paste.trim()}>
            Add to threat list
          </button>
          {pasteMsg && <span className="muted small">{pasteMsg}</span>}
        </div>
      </Section>
    </div>
  );
}

function formatSP(t: ThreatSet): string {
  const labels: Record<string, string> = {
    hp: 'HP', atk: 'Atk', def: 'Def', spa: 'SpA', spd: 'SpD', spe: 'Spe',
  };
  const parts = Object.entries(t.sp)
    .filter(([, v]) => v)
    .map(([k, v]) => `${v} ${labels[k]}`);
  return parts.length ? `${parts.join(' / ')} SP` : 'no Stat Points';
}
