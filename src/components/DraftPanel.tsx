import { useMemo, useState } from 'react';
import { STATS, STAT_NAMES } from '../types';
import { natureLabel } from '../data/dex';
import { PLANS } from '../engine/plans';
import type { PlanId } from '../engine/plans';
import { draftOne, draftTeam, missingParts } from '../engine/autobuild';
import type { DraftPick, DraftResult, ReasonKind } from '../engine/autobuild';
import { displayName } from '../engine/calc';
import { resolveForm, spTotal } from '../engine/stats';
import { newId } from '../engine/showdown';
import { useActiveTeam, useEnabledThreats, useFormat, useStore } from '../store';
import { MoveChip, Pill, Section, Sprite, TypeBadge } from './common';
import { ShapeBars } from './TeamShape';
import { plural } from '../text';

const REASON_ICON: Record<ReasonKind, string> = {
  threat: '◎',
  defense: '⛊',
  offense: '⚔',
  role: '⚑',
  speed: '⏱',
  plan: '◆',
  spice: '✦',
  complete: '✎',
};

const SPICE_LABELS: [number, string][] = [
  [0.15, 'Chalk — the percentage play'],
  [0.4, 'Standard, with room to breathe'],
  [0.65, 'Off the beaten path'],
  [1.01, 'Show me something I have not seen'],
];

function spiceLabel(spice: number): string {
  return SPICE_LABELS.find(([limit]) => spice < limit)?.[1] ?? SPICE_LABELS[0][1];
}

export function DraftPanel() {
  const format = useFormat();
  const team = useActiveTeam();
  const threats = useEnabledThreats();
  const field = useStore((s) => s.field);
  const rosterOverride = useStore((s) => s.rosterOverride);
  const replaceMembers = useStore((s) => s.replaceMembers);
  const setTab = useStore((s) => s.setTab);
  const selectSlot = useStore((s) => s.selectSlot);

  const [plan, setPlan] = useState<PlanId | 'auto'>('auto');
  const [spice, setSpice] = useState(0.3);
  const [banned, setBanned] = useState<string[]>([]);
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 1e9));
  const [result, setResult] = useState<DraftResult | null>(null);
  const [working, setWorking] = useState(false);

  const input = useMemo(() => ({
    team: team.members,
    format,
    threats,
    field,
    override: rosterOverride,
  }), [team.members, format, threats, field, rosterOverride]);

  const run = (opts: { seed?: number; banned?: string[] } = {}) => {
    setWorking(true);
    // Let the button paint its working state before the calculations block.
    setTimeout(() => {
      try {
        setResult(draftTeam({
          ...input,
          options: {
            plan,
            spice,
            banned: opts.banned ?? banned,
            seed: opts.seed ?? seed,
          },
        }));
      } finally {
        setWorking(false);
      }
    }, 16);
  };

  const reroll = (species: string) => {
    const next = [...banned, species];
    setBanned(next);
    run({ banned: next, seed: seed + 1 });
  };

  const shuffle = () => {
    const next = Math.floor(Math.random() * 1e9);
    setSeed(next);
    run({ seed: next });
  };

  const applyAll = () => {
    if (!result) return;
    replaceMembers(result.team.map((m) => ({ ...m, id: m.id || newId() })));
    setResult(null);
    selectSlot(0);
    setTab('build');
  };

  const applyOne = (pick: DraftPick) => {
    const members = [...team.members];
    if (pick.kind === 'completed') members[pick.slot] = pick.set;
    else if (members.length < format.bring) members.push({ ...pick.set, id: newId() });
    replaceMembers(members);
    setResult(null);
  };

  const takeAlternate = (species: string) => {
    if (team.members.length >= format.bring) return;
    const generated = draftOne(species, {
      ...input,
      options: { plan, spice, banned, seed },
    });
    replaceMembers([...team.members, { ...generated.set, id: newId() }]);
    setResult(null);
  };

  const openSlots = format.bring - team.members.length;
  const unfinished = team.members.filter((m) => missingParts(m).length).length;

  return (
    <div className="draft-wrap">
      <Section
        title="The Draft Table"
        subtitle={
          openSlots > 0
            ? `${plural(openSlots, 'open slot')}${unfinished ? `, ${unfinished} half-finished` : ''} — pick a plan and let the drafter fill them`
            : unfinished
              ? `Team is full; ${unfinished} of them still need moves, items or points`
              : 'Team is full and finished. Reroll a slot to see what else fits.'
        }
        actions={
          <>
            <button className="btn" onClick={shuffle} disabled={working}>Shuffle</button>
            <button className="btn btn-primary" onClick={() => run()} disabled={working}>
              {working ? 'Drafting…' : result ? 'Draft again' : 'Draft the rest'}
            </button>
          </>
        }
      >
        <div className="draft-controls">
          <label className="draft-control">
            <span className="side-label">Game plan</span>
            <select value={plan} onChange={(e) => setPlan(e.target.value as PlanId | 'auto')}>
              <option value="auto">Read my team and choose</option>
              {PLANS.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
            <span className="muted small">
              {plan === 'auto'
                ? 'The drafter infers the plan from what you already have.'
                : PLANS.find((p) => p.id === plan)?.blurb}
            </span>
          </label>

          <label className="draft-control draft-spice">
            <span className="side-label">Spice</span>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(spice * 100)}
              onChange={(e) => setSpice(Number(e.target.value) / 100)}
            />
            <span className="muted small">{spiceLabel(spice)}</span>
          </label>

          {banned.length > 0 && (
            <div className="draft-control">
              <span className="side-label">Turned down</span>
              <div className="draft-banned">
                {banned.map((b) => (
                  <button
                    key={b}
                    className="chip-x"
                    title="Allow it again"
                    onClick={() => setBanned(banned.filter((x) => x !== b))}
                  >
                    {displayName(b)} ✕
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {!result && (
          <p className="muted small draft-hint">
            The drafter scores every legal Pokémon against your team, then runs a full damage
            matrix on the shortlist — so a pick has to beat the threats you are actually losing
            to, not just look good on paper. It fills in moves, ability, item, Nature and Stat
            Points too, and finishes any set you left half-done.
          </p>
        )}
      </Section>

      {result && (
        <>
          <Section
            title={result.headline}
            subtitle={result.planReason}
            actions={
              <>
                <button className="btn" onClick={() => setResult(null)}>Discard</button>
                <button className="btn btn-primary" onClick={applyAll}>Apply the whole team</button>
              </>
            }
          >
            <ShapeBars
              before={result.before}
              after={result.after}
              showBefore={team.members.length > 0}
            />
            <p className="muted small draft-timing">
              {result.picks.length
                ? `${plural(result.picks.length, 'slot')} decided in ${(result.elapsedMs / 1000).toFixed(1)}s of real damage calculations.`
                : 'Nothing to add.'}
              {result.plan.tempo === 'slow' && (
                <> Speed going down is the plan working — under Trick Room the slower side moves first.</>
              )}
            </p>
          </Section>

          <div className="draft-grid">
            {result.picks.map((pick) => (
              <PickCard
                key={`${pick.slot}-${pick.species}`}
                pick={pick}
                onKeep={() => applyOne(pick)}
                onReject={() => reroll(pick.species)}
                onAlternate={takeAlternate}
                full={team.members.length >= format.bring && pick.kind === 'new'}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function PickCard({
  pick, onKeep, onReject, onAlternate, full,
}: {
  pick: DraftPick;
  onKeep: () => void;
  onReject: () => void;
  onAlternate: (species: string) => void;
  full: boolean;
}) {
  const format = useFormat();
  const form = resolveForm(pick.set, format);
  const shown = form?.species.name ?? pick.set.species;

  return (
    <article className={`draft-card ${pick.kind === 'completed' ? 'is-completed' : ''}`}>
      <header className="draft-card-head">
        <Sprite species={shown} size={46} />
        <div className="draft-card-title">
          <h3>{displayName(shown)}</h3>
          <span className="muted small">
            {pick.set.item || 'no item'} · {form?.ability || pick.set.ability}
          </span>
          <div className="draft-card-types">
            {(form?.types ?? []).map((t) => <TypeBadge key={t} type={t} small />)}
          </div>
        </div>
        <Pill tone={pick.kind === 'completed' ? 'neutral' : 'ok'}>
          {pick.kind === 'completed' ? 'yours, finished' : `slot ${pick.slot + 1}`}
        </Pill>
      </header>

      <ul className="draft-reasons">
        {pick.reasons.map((r, i) => (
          <li key={i}>
            <span className="draft-reason-icon" aria-hidden>{REASON_ICON[r.kind]}</span>
            <span className="draft-reason-kind">{r.kind}</span>
            {r.text}
          </li>
        ))}
      </ul>

      <div className="draft-set">
        <div className="draft-moves">
          {pick.set.moves.filter(Boolean).map((m) => (
            <MoveChip key={m} name={m} className="draft-move" />
          ))}
        </div>
        <div className="draft-spread">
          <span className="muted small">{natureLabel(pick.set.nature)}</span>
          <span className="draft-sp">
            {STATS.filter((s) => (pick.set.sp[s] ?? 0) > 0)
              .map((s) => `${pick.set.sp[s]} ${STAT_NAMES[s]}`)
              .join(' / ') || 'no points'}
            <em>{spTotal(pick.set.sp)}/66</em>
          </span>
        </div>
      </div>

      {!!pick.notes.length && (
        <ul className="draft-notes">
          {pick.notes.map((n, i) => <li key={i}>{n}</li>)}
        </ul>
      )}

      <footer className="draft-card-foot">
        <button className="btn btn-sm btn-primary" onClick={onKeep} disabled={full}>
          {pick.kind === 'completed' ? 'Apply to my set' : 'Add to team'}
        </button>
        {pick.kind === 'new' && (
          <button className="btn btn-sm" onClick={onReject} title="Never draft this Pokémon again">
            Not this one
          </button>
        )}
        {!!pick.alternates.length && (
          <div className="draft-alts">
            <span className="muted small">or</span>
            {pick.alternates.map((a) => (
              <button
                key={a.species}
                className="mon-chip mon-chip-add"
                title={`${a.species} — ${a.note}`}
                disabled={full}
                onClick={() => onAlternate(a.species)}
              >
                <Sprite size={20} species={a.species} />
                {a.species}
              </button>
            ))}
          </div>
        )}
      </footer>
    </article>
  );
}
