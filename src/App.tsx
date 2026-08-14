import { useEffect, useMemo, useState } from 'react';
import { FORMATS } from './data/formats';
import { loadLearnset } from './data/dex';
import { validateTeam, issueCounts } from './engine/legality';
import { useActiveTeam, useFormat, useStore } from './store';
import type { TabId } from './store';
import { TeamRail } from './components/TeamRail';
import { SlotEditor } from './components/SlotEditor';
import { DraftPanel } from './components/DraftPanel';
import { CalcPanel } from './components/CalcPanel';
import { ThreatMatrixPanel } from './components/ThreatMatrixPanel';
import { SpeedPanel } from './components/SpeedPanel';
import { AnalysisPanel } from './components/AnalysisPanel';
import { CoachPanel } from './components/CoachPanel';
import { ThreatDbPanel } from './components/ThreatDbPanel';
import { RosterPanel } from './components/RosterPanel';
import { ImportExportDialog } from './components/ImportExport';
import { Pill } from './components/common';

const TABS: { id: TabId; label: string; hint: string }[] = [
  { id: 'build', label: 'Build', hint: 'Edit the selected Pokémon' },
  { id: 'draft', label: 'Draft', hint: 'Let the app finish the team for you' },
  { id: 'calc', label: 'Calculator', hint: 'Full damage calculator' },
  { id: 'threats', label: 'Threat matrix', hint: 'Every matchup against the metagame' },
  { id: 'speed', label: 'Speed', hint: 'Speed tiers and benchmarks' },
  { id: 'analysis', label: 'Analysis', hint: 'Types, roles and coverage' },
  { id: 'coach', label: 'Coach', hint: 'What to fix next' },
  { id: 'threatdb', label: 'Metagame', hint: 'The threat list your calcs run against' },
  { id: 'roster', label: 'Roster', hint: 'Format rules and the legal species list' },
];

export default function App() {
  const format = useFormat();
  const team = useActiveTeam();
  const tab = useStore((s) => s.tab);
  const setTab = useStore((s) => s.setTab);
  const setFormat = useStore((s) => s.setFormat);
  const teams = useStore((s) => s.teams);
  const selectTeam = useStore((s) => s.selectTeam);
  const newTeam = useStore((s) => s.newTeam);
  const renameTeam = useStore((s) => s.renameTeam);
  const rosterOverride = useStore((s) => s.rosterOverride);
  const [showIO, setShowIO] = useState(false);
  const [, forceRender] = useState(0);

  // Learnsets load lazily; refresh legality once they arrive.
  useEffect(() => {
    let cancelled = false;
    Promise.all(team.members.map((m) => loadLearnset(m.species))).then(() => {
      if (!cancelled) forceRender((n) => n + 1);
    });
    return () => { cancelled = true; };
  }, [team.members]);

  const issues = useMemo(
    () => validateTeam(team, format, rosterOverride),
    [team, format, rosterOverride],
  );
  const counts = issueCounts(issues);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">◆</span>
          <div>
            <strong>Champions Teambuilder</strong>
            <span className="brand-sub">VGC builder · calc · coach</span>
          </div>
        </div>

        <div className="topbar-controls">
          <label className="inline-field">
            <span>Format</span>
            <select value={format.id} onChange={(e) => setFormat(e.target.value)}>
              {FORMATS.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.shortName}{f.active ? '' : ' (past)'}
                </option>
              ))}
            </select>
          </label>

          <label className="inline-field">
            <span>Team</span>
            <select value={team.id} onChange={(e) => selectTeam(e.target.value)}>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>{t.name || 'Untitled'}</option>
              ))}
            </select>
          </label>

          <input
            className="team-name"
            value={team.name}
            onChange={(e) => renameTeam(e.target.value)}
            placeholder="Team name"
          />

          <button className="btn" onClick={newTeam}>New team</button>
          <button className="btn btn-primary" onClick={() => setShowIO(true)}>Import / Export</button>
        </div>

        <div className="topbar-status">
          {counts.error > 0 && <Pill tone="error">{counts.error} illegal</Pill>}
          {counts.warning > 0 && <Pill tone="warn">{counts.warning} warning</Pill>}
          {counts.error === 0 && counts.warning === 0 && team.members.length > 0 && (
            <Pill tone="ok">Legal for {format.shortName}</Pill>
          )}
          <Pill tone="neutral" title={`${format.name} — ${format.window}`}>
            {team.members.length}/{format.bring} · pick {format.pick}
          </Pill>
        </div>
      </header>

      <div className="body">
        <TeamRail issues={issues} />

        <main className="main">
          <nav className="tabs">
            {TABS.map((t) => (
              <button
                key={t.id}
                title={t.hint}
                className={`tab ${tab === t.id ? 'is-active' : ''}`}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </nav>

          <div className="tab-body">
            {tab === 'build' && <SlotEditor issues={issues} />}
            {tab === 'draft' && <DraftPanel />}
            {tab === 'calc' && <CalcPanel />}
            {tab === 'threats' && <ThreatMatrixPanel />}
            {tab === 'speed' && <SpeedPanel />}
            {tab === 'analysis' && <AnalysisPanel />}
            {tab === 'coach' && <CoachPanel issues={issues} />}
            {tab === 'threatdb' && <ThreatDbPanel />}
            {tab === 'roster' && <RosterPanel />}
          </div>
        </main>
      </div>

      {showIO && <ImportExportDialog onClose={() => setShowIO(false)} />}
    </div>
  );
}
