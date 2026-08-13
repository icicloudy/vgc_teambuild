import { useMemo } from 'react';
import type { CombatantState, PokemonSet, SideState } from '../types';
import { getMove } from '../data/dex';
import { calcAllMoves, displayName } from '../engine/calc';
import { threatToSet } from '../engine/matrix';
import { computeSpeed, defaultScenario } from '../engine/speed';
import { computeStats, resolveForm } from '../engine/stats';
import { useActiveTeam, useEnabledThreats, useFormat, useStore } from '../store';
import type { CalcSlotRef } from '../store';
import { Section, Sprite, Toggle, TypeBadge } from './common';
import { damageTone } from './format';

const BOOST_STATS = ['atk', 'def', 'spa', 'spd', 'spe'] as const;
const STATUSES: { value: CombatantState['status']; label: string }[] = [
  { value: '', label: 'Healthy' },
  { value: 'brn', label: 'Burned' },
  { value: 'par', label: 'Paralysed' },
  { value: 'psn', label: 'Poisoned' },
  { value: 'tox', label: 'Badly poisoned' },
  { value: 'slp', label: 'Asleep' },
  { value: 'frz', label: 'Frozen' },
];

export function CalcPanel() {
  const format = useFormat();
  const team = useActiveTeam();
  const threats = useEnabledThreats();
  const field = useStore((s) => s.field);
  const setField = useStore((s) => s.setField);
  const resetField = useStore((s) => s.resetField);
  const attackerState = useStore((s) => s.attackerState);
  const defenderState = useStore((s) => s.defenderState);
  const setAttackerState = useStore((s) => s.setAttackerState);
  const setDefenderState = useStore((s) => s.setDefenderState);
  const calcAttacker = useStore((s) => s.calcAttacker);
  const calcDefender = useStore((s) => s.calcDefender);
  const setCalcRef = useStore((s) => s.setCalcRef);

  const resolve = (ref: CalcSlotRef | null, fallback: 'team' | 'threat'): PokemonSet | null => {
    const r = ref ?? (fallback === 'team'
      ? (team.members[0] ? { kind: 'team' as const, id: team.members[0].id } : null)
      : (threats[0] ? { kind: 'threat' as const, id: threats[0].id } : null));
    if (!r) return null;
    if (r.kind === 'team') return team.members.find((m) => m.id === r.id) ?? team.members[0] ?? null;
    const t = threats.find((x) => x.id === r.id) ?? threats[0];
    return t ? threatToSet(t, format.level) : null;
  };

  const attacker = resolve(calcAttacker, 'team');
  const defender = resolve(calcDefender, 'threat');

  const forward = useMemo(
    () => (attacker && defender
      ? calcAllMoves(attacker, defender, format, field, attackerState, defenderState)
      : []),
    [attacker, defender, format, field, attackerState, defenderState],
  );

  const reverseField = useMemo(
    () => ({ ...field, attackerSide: field.defenderSide, defenderSide: field.attackerSide }),
    [field],
  );
  const backward = useMemo(
    () => (attacker && defender
      ? calcAllMoves(defender, attacker, format, reverseField, defenderState, attackerState)
      : []),
    [attacker, defender, format, reverseField, defenderState, attackerState],
  );

  const scenario = defaultScenario();
  const aSpeed = attacker ? computeSpeed(attacker, format, { ...scenario, tailwind: field.attackerSide.isTailwind }).final : 0;
  const dSpeed = defender ? computeSpeed(defender, format, { ...scenario, tailwind: field.defenderSide.isTailwind }).final : 0;

  if (!attacker || !defender) {
    return (
      <div className="empty-state">
        <h2>Nothing to calculate yet</h2>
        <p>Add a Pokémon to your team, or enable a threat in the Metagame tab.</p>
      </div>
    );
  }

  return (
    <div className="calc-grid">
      <Combatant
        title="Attacker"
        set={attacker}
        state={attackerState}
        onState={setAttackerState}
        selected={calcAttacker}
        onSelect={(r) => setCalcRef('attacker', r)}
        speed={aSpeed}
        faster={field.isTrickRoom ? aSpeed < dSpeed : aSpeed > dSpeed}
      />

      <div className="calc-field">
        <Section
          title="Field"
          subtitle={`${field.gameType} · Level ${format.level}`}
          actions={<button className="btn btn-sm" onClick={resetField}>Reset</button>}
        >
          <div className="field-row">
            <label className="inline-field">
              <span>Weather</span>
              <select value={field.weather} onChange={(e) => setField({ weather: e.target.value as never })}>
                <option value="">None</option>
                <option value="Sun">Sun</option>
                <option value="Rain">Rain</option>
                <option value="Sand">Sandstorm</option>
                <option value="Snow">Snow</option>
                <option value="Harsh Sunshine">Harsh Sunshine</option>
                <option value="Heavy Rain">Heavy Rain</option>
              </select>
            </label>
            <label className="inline-field">
              <span>Terrain</span>
              <select value={field.terrain} onChange={(e) => setField({ terrain: e.target.value as never })}>
                <option value="">None</option>
                <option value="Electric">Electric</option>
                <option value="Grassy">Grassy</option>
                <option value="Psychic">Psychic</option>
                <option value="Misty">Misty</option>
              </select>
            </label>
          </div>

          <div className="toggle-row">
            <Toggle label="Trick Room" checked={field.isTrickRoom} onChange={(v) => setField({ isTrickRoom: v })} />
            <Toggle label="Gravity" checked={field.isGravity} onChange={(v) => setField({ isGravity: v })} />
            <Toggle label="Wonder Room" checked={field.isWonderRoom} onChange={(v) => setField({ isWonderRoom: v })} />
            <Toggle label="Magic Room" checked={field.isMagicRoom} onChange={(v) => setField({ isMagicRoom: v })} />
          </div>

          <SideToggles
            label="Your side"
            side={field.attackerSide}
            onChange={(patch) => setField({ attackerSide: { ...field.attackerSide, ...patch } })}
          />
          <SideToggles
            label="Their side"
            side={field.defenderSide}
            onChange={(patch) => setField({ defenderSide: { ...field.defenderSide, ...patch } })}
          />
        </Section>
      </div>

      <Combatant
        title="Defender"
        set={defender}
        state={defenderState}
        onState={setDefenderState}
        selected={calcDefender}
        onSelect={(r) => setCalcRef('defender', r)}
        speed={dSpeed}
        faster={field.isTrickRoom ? dSpeed < aSpeed : dSpeed > aSpeed}
      />

      <div className="calc-results">
        <ResultTable
          title={`${nameOf(attacker, format)} → ${nameOf(defender, format)}`}
          rows={forward}
        />
        <ResultTable
          title={`${nameOf(defender, format)} → ${nameOf(attacker, format)}`}
          rows={backward}
        />
      </div>
    </div>
  );
}

function nameOf(set: PokemonSet, format: ReturnType<typeof useFormat>): string {
  return set.nickname || displayName(resolveForm(set, format)?.species.name ?? set.species);
}

function SideToggles({
  label, side, onChange,
}: { label: string; side: SideState; onChange: (patch: Partial<SideState>) => void }) {
  return (
    <div className="side-block">
      <span className="side-label">{label}</span>
      <div className="toggle-row">
        <Toggle label="Reflect" checked={side.isReflect} onChange={(v) => onChange({ isReflect: v })} />
        <Toggle label="Light Screen" checked={side.isLightScreen} onChange={(v) => onChange({ isLightScreen: v })} />
        <Toggle label="Aurora Veil" checked={side.isAuroraVeil} onChange={(v) => onChange({ isAuroraVeil: v })} />
        <Toggle label="Tailwind" checked={side.isTailwind} onChange={(v) => onChange({ isTailwind: v })} />
        <Toggle label="Helping Hand" checked={side.isHelpingHand} onChange={(v) => onChange({ isHelpingHand: v })} />
        <Toggle label="Friend Guard" checked={side.isFriendGuard} onChange={(v) => onChange({ isFriendGuard: v })} />
      </div>
    </div>
  );
}

function Combatant({
  title, set, state, onState, selected, onSelect, speed, faster,
}: {
  title: string;
  set: PokemonSet;
  state: CombatantState;
  onState: (patch: Partial<CombatantState>) => void;
  selected: CalcSlotRef | null;
  onSelect: (ref: CalcSlotRef) => void;
  speed: number;
  faster: boolean;
}) {
  const format = useFormat();
  const team = useActiveTeam();
  const threats = useEnabledThreats();
  const form = resolveForm(set, format);
  const stats = computeStats(set, format);

  const value = selected
    ? `${selected.kind}:${selected.id}`
    : `${team.members.some((m) => m.id === set.id) ? 'team' : 'threat'}:${set.id}`;

  return (
    <Section
      title={title}
      subtitle={
        <span className="head-sub">
          {form?.types.map((t) => <TypeBadge key={t} type={t} small />)}
          <span className="muted small">{form?.ability}</span>
          <span className={`speed-pill ${faster ? 'is-faster' : ''}`}>{speed} Spe</span>
        </span>
      }
      actions={<Sprite species={form?.species.name ?? set.species} size={48} />}
    >
      <select
        className="full"
        value={value}
        onChange={(e) => {
          const [kind, id] = e.target.value.split(':');
          onSelect({ kind: kind as 'team' | 'threat', id });
        }}
      >
        <optgroup label="Your team">
          {team.members.map((m) => (
            <option key={m.id} value={`team:${m.id}`}>
              {m.nickname || displayName(resolveForm(m, format)?.species.name ?? m.species)}
            </option>
          ))}
        </optgroup>
        <optgroup label="Metagame threats">
          {threats.map((t) => <option key={t.id} value={`threat:${t.id}`}>{t.name}</option>)}
        </optgroup>
      </select>

      <div className="boost-row">
        {BOOST_STATS.map((stat) => (
          <label key={stat} className="boost">
            <span>{stat.toUpperCase()}</span>
            <select
              value={state.boosts[stat] ?? 0}
              onChange={(e) => onState({ boosts: { ...state.boosts, [stat]: Number(e.target.value) } })}
            >
              {[6, 5, 4, 3, 2, 1, 0, -1, -2, -3, -4, -5, -6].map((b) => (
                <option key={b} value={b}>{b > 0 ? `+${b}` : b}</option>
              ))}
            </select>
          </label>
        ))}
      </div>

      <div className="field-row">
        <label className="inline-field">
          <span>Status</span>
          <select value={state.status} onChange={(e) => onState({ status: e.target.value as never })}>
            {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </label>
        <label className="inline-field">
          <span>HP %</span>
          <input
            type="number"
            min={1}
            max={100}
            value={state.hpPercent}
            onChange={(e) => onState({ hpPercent: Math.max(1, Math.min(100, Number(e.target.value))) })}
          />
        </label>
      </div>

      <div className="stat-strip">
        {(['hp', 'atk', 'def', 'spa', 'spd', 'spe'] as const).map((s) => (
          <span key={s} title={`${set.evs[s] ?? 0} EVs`}>
            <em>{s.toUpperCase()}</em>
            {stats?.[s] ?? 0}
            <i className="stat-ev">{set.evs[s] ? `+${set.evs[s]}` : ''}</i>
          </span>
        ))}
      </div>
    </Section>
  );
}

function ResultTable({ title, rows }: { title: string; rows: ReturnType<typeof calcAllMoves> }) {
  return (
    <Section title={title} subtitle={rows.length ? undefined : 'No damaging moves'}>
      <table className="result-table">
        <thead>
          <tr>
            <th>Move</th><th>Type</th><th>Damage</th><th>%</th><th>Result</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ move, result }) => {
            const m = getMove(move);
            return (
              <tr key={move}>
                <td>{move}</td>
                <td>{m && <TypeBadge type={m.type} small />}</td>
                <td className="num">{result.min}–{result.max}</td>
                <td className="num">
                  <span className={`dmg dmg-${damageTone(result.maxPct)}`}>
                    {result.minPct.toFixed(1)}–{result.maxPct.toFixed(1)}%
                  </span>
                </td>
                <td className="ko-text">{result.koText}</td>
              </tr>
            );
          })}
          {!rows.length && (
            <tr><td colSpan={5} className="muted">Nothing to show — this side has no attacking moves.</td></tr>
          )}
        </tbody>
      </table>
    </Section>
  );
}
