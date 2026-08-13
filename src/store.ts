import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  CombatantState, FieldState, PokemonSet, Team, ThreatSet,
} from './types';
import { DEFAULT_FORMAT_ID, getFormat } from './data/formats';
import { BUILT_IN_THREATS } from './data/threats';
import type { RosterOverride } from './data/roster';
import { defaultCombatant, defaultField } from './engine/calc';
import { emptySet, newId } from './engine/showdown';
import { getSpecies } from './data/dex';

export type TabId =
  | 'build' | 'calc' | 'threats' | 'speed' | 'analysis' | 'coach' | 'threatdb' | 'roster';

export interface CalcSlotRef {
  kind: 'team' | 'threat';
  id: string;
}

interface AppState {
  teams: Team[];
  activeTeamId: string;
  formatId: string;
  selectedSlot: number;
  tab: TabId;

  threats: ThreatSet[];
  disabledThreats: string[];
  rosterOverride: RosterOverride | null;

  field: FieldState;
  attackerState: CombatantState;
  defenderState: CombatantState;
  calcAttacker: CalcSlotRef | null;
  calcDefender: CalcSlotRef | null;

  // actions
  setTab: (t: TabId) => void;
  setFormat: (id: string) => void;
  selectSlot: (i: number) => void;

  activeTeam: () => Team;
  newTeam: () => void;
  deleteTeam: (id: string) => void;
  selectTeam: (id: string) => void;
  renameTeam: (name: string) => void;
  setTeamNotes: (notes: string) => void;

  addMember: (species?: string) => void;
  updateMember: (index: number, patch: Partial<PokemonSet>) => void;
  replaceMembers: (sets: PokemonSet[]) => void;
  removeMember: (index: number) => void;
  moveMember: (from: number, to: number) => void;
  duplicateMember: (index: number) => void;

  setField: (patch: Partial<FieldState>) => void;
  resetField: () => void;
  setAttackerState: (patch: Partial<CombatantState>) => void;
  setDefenderState: (patch: Partial<CombatantState>) => void;
  setCalcRef: (side: 'attacker' | 'defender', ref: CalcSlotRef | null) => void;

  toggleThreat: (id: string) => void;
  upsertThreat: (threat: ThreatSet) => void;
  removeThreat: (id: string) => void;
  resetThreats: () => void;

  setRosterOverride: (o: RosterOverride | null) => void;
}

function starterTeam(): Team {
  return {
    id: newId(),
    name: 'New team',
    formatId: DEFAULT_FORMAT_ID,
    members: [],
    notes: '',
    updatedAt: Date.now(),
  };
}

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      teams: [starterTeam()],
      activeTeamId: '',
      formatId: DEFAULT_FORMAT_ID,
      selectedSlot: 0,
      tab: 'build',

      threats: BUILT_IN_THREATS,
      disabledThreats: [],
      rosterOverride: null,

      field: defaultField('Doubles'),
      attackerState: defaultCombatant(),
      defenderState: defaultCombatant(),
      calcAttacker: null,
      calcDefender: null,

      setTab: (tab) => set({ tab }),
      setFormat: (formatId) => {
        const format = getFormat(formatId);
        set((s) => ({
          formatId,
          field: { ...s.field, gameType: format.gameType },
        }));
      },
      selectSlot: (selectedSlot) => set({ selectedSlot }),

      activeTeam: () => {
        const s = get();
        return s.teams.find((t) => t.id === s.activeTeamId) ?? s.teams[0];
      },

      newTeam: () => {
        const team = { ...starterTeam(), formatId: get().formatId };
        set((s) => ({ teams: [...s.teams, team], activeTeamId: team.id, selectedSlot: 0 }));
      },
      deleteTeam: (id) =>
        set((s) => {
          const teams = s.teams.filter((t) => t.id !== id);
          const next = teams.length ? teams : [starterTeam()];
          return {
            teams: next,
            activeTeamId: next.some((t) => t.id === s.activeTeamId) ? s.activeTeamId : next[0].id,
          };
        }),
      selectTeam: (activeTeamId) => set({ activeTeamId, selectedSlot: 0 }),
      renameTeam: (name) => mutateTeam(set, get, (t) => ({ ...t, name })),
      setTeamNotes: (notes) => mutateTeam(set, get, (t) => ({ ...t, notes })),

      addMember: (species = '') =>
        mutateTeam(set, get, (t) => {
          const format = getFormat(get().formatId);
          const member = emptySet(species);
          member.level = format.level;
          const members = [...t.members, member].slice(0, format.bring);
          set({ selectedSlot: members.length - 1 });
          return { ...t, members };
        }),

      updateMember: (index, patch) =>
        mutateTeam(set, get, (t) => {
          const members = t.members.map((m, i) => (i === index ? { ...m, ...patch } : m));
          return { ...t, members };
        }),

      replaceMembers: (sets) => mutateTeam(set, get, (t) => ({ ...t, members: sets })),

      removeMember: (index) =>
        mutateTeam(set, get, (t) => {
          const members = t.members.filter((_, i) => i !== index);
          set({ selectedSlot: Math.max(0, Math.min(index, members.length - 1)) });
          return { ...t, members };
        }),

      moveMember: (from, to) =>
        mutateTeam(set, get, (t) => {
          if (to < 0 || to >= t.members.length) return t;
          const members = [...t.members];
          const [m] = members.splice(from, 1);
          members.splice(to, 0, m);
          set({ selectedSlot: to });
          return { ...t, members };
        }),

      duplicateMember: (index) =>
        mutateTeam(set, get, (t) => {
          const format = getFormat(get().formatId);
          if (t.members.length >= format.bring) return t;
          const copy = { ...t.members[index], id: newId() };
          const members = [...t.members];
          members.splice(index + 1, 0, copy);
          return { ...t, members };
        }),

      setField: (patch) => set((s) => ({ field: { ...s.field, ...patch } })),
      resetField: () => set((s) => ({ field: defaultField(s.field.gameType) })),
      setAttackerState: (patch) => set((s) => ({ attackerState: { ...s.attackerState, ...patch } })),
      setDefenderState: (patch) => set((s) => ({ defenderState: { ...s.defenderState, ...patch } })),
      setCalcRef: (side, ref) =>
        set(side === 'attacker' ? { calcAttacker: ref } : { calcDefender: ref }),

      toggleThreat: (id) =>
        set((s) => ({
          disabledThreats: s.disabledThreats.includes(id)
            ? s.disabledThreats.filter((t) => t !== id)
            : [...s.disabledThreats, id],
        })),
      upsertThreat: (threat) =>
        set((s) => {
          const i = s.threats.findIndex((t) => t.id === threat.id);
          if (i < 0) return { threats: [...s.threats, threat] };
          const threats = [...s.threats];
          threats[i] = threat;
          return { threats };
        }),
      removeThreat: (id) =>
        set((s) => ({ threats: s.threats.filter((t) => t.id !== id || t.builtIn) })),
      resetThreats: () => set({ threats: BUILT_IN_THREATS, disabledThreats: [] }),

      setRosterOverride: (rosterOverride) => set({ rosterOverride }),
    }),
    {
      name: 'champions-teambuilder',
      version: 1,
      partialize: (s) => ({
        teams: s.teams,
        activeTeamId: s.activeTeamId,
        formatId: s.formatId,
        threats: s.threats,
        disabledThreats: s.disabledThreats,
        rosterOverride: s.rosterOverride,
        field: s.field,
      }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<AppState>;
        // Built-in threats are code, not user data: refresh them on every load but
        // keep any custom threats the user added.
        const custom = (p.threats ?? []).filter((t) => !t.builtIn);
        return {
          ...current,
          ...p,
          threats: [...BUILT_IN_THREATS, ...custom],
          teams: p.teams?.length ? p.teams : current.teams,
        } as AppState;
      },
    },
  ),
);

function mutateTeam(
  set: (partial: Partial<AppState>) => void,
  get: () => AppState,
  fn: (t: Team) => Team,
) {
  const s = get();
  const active = s.teams.find((t) => t.id === s.activeTeamId) ?? s.teams[0];
  if (!active) return;
  const updated = { ...fn(active), updatedAt: Date.now() };
  set({
    teams: s.teams.map((t) => (t.id === active.id ? updated : t)),
    activeTeamId: updated.id,
  });
}

/* --------------------------------------------------------------- *
 * Derived selectors
 * --------------------------------------------------------------- */

export function useFormat() {
  return getFormat(useStore((s) => s.formatId));
}

export function useActiveTeam(): Team {
  const teams = useStore((s) => s.teams);
  const activeTeamId = useStore((s) => s.activeTeamId);
  return teams.find((t) => t.id === activeTeamId) ?? teams[0];
}

export function useEnabledThreats(): ThreatSet[] {
  const threats = useStore((s) => s.threats);
  const disabled = useStore((s) => s.disabledThreats);
  return threats
    .filter((t) => !disabled.includes(t.id))
    .filter((t) => !!getSpecies(t.species))
    .sort((a, b) => b.usage - a.usage);
}
