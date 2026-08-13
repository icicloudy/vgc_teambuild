import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type {
  CombatantState, FieldState, PokemonSet, StatsTable, Team, ThreatSet,
} from './types';
import { emptySP } from './types';
import { DEFAULT_FORMAT_ID, getFormat } from './data/formats';
import { BUILT_IN_THREATS } from './data/threats';
import type { RosterOverride } from './data/roster';
import { defaultCombatant, defaultField } from './engine/calc';
import { emptySet, evsToSP, newId } from './engine/showdown';
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

/**
 * Sandboxed embeds (and Safari private mode) can make `localStorage` throw on
 * access, not just on write. Fall back to an in-memory store so the app still
 * runs — teams just do not survive a reload there.
 */
function safeStorage(): Storage {
  try {
    const probe = '__champions_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    const mem = new Map<string, string>();
    return {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => { mem.set(k, v); },
      removeItem: (k: string) => { mem.delete(k); },
      clear: () => mem.clear(),
      key: (i: number) => [...mem.keys()][i] ?? null,
      get length() { return mem.size; },
    } as Storage;
  }
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
      version: 2,
      migrate: (state, from) => {
        // v1 stored EVs and IVs. Champions uses Stat Points, so convert saved teams
        // rather than dropping them.
        if (from >= 2) return state as AppState;
        const s = state as { teams?: Team[] };
        for (const team of s.teams ?? []) {
          for (const member of team.members ?? []) {
            const legacy = member as unknown as { evs?: Partial<StatsTable>; ivs?: unknown };
            if (legacy.evs && !member.sp) member.sp = evsToSP(legacy.evs);
            if (!member.sp) member.sp = emptySP();
            delete legacy.evs;
            delete legacy.ivs;
          }
        }
        return state as AppState;
      },
      storage: createJSONStorage(safeStorage),
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
