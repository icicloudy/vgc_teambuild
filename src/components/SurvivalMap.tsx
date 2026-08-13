import { useMemo, useState } from 'react';
import type { StatID, StatsTable } from '../types';
import { MAX_SP_PER_STAT } from '../engine/stats';
import type { SurvivalCell, SurvivalGrid } from '../engine/optimizer';

/**
 * Where the KO thresholds actually sit, across every way of splitting Stat Points
 * between HP and one defence.
 *
 * The bands are an ordered quantity (hits survived), so the fill is a single-hue
 * ramp rather than a traffic light — a red/green split fails deuteranope
 * separation. The real information is the *boundaries*, so those are drawn as
 * explicit contours and labelled; colour only reinforces them.
 */

const BANDS = [
  { hits: 1, fill: '#ff8a80', label: 'OHKO' },
  { hits: 2, fill: '#cf5346', label: '2HKO' },
  { hits: 3, fill: '#8c3f36', label: '3HKO' },
  { hits: 4, fill: '#4a2b28', label: '4HKO or more' },
];

function bandOf(hits: number) {
  if (hits >= 99) return null;
  return BANDS[Math.min(hits, 4) - 1] ?? BANDS[3];
}

function bandFill(hits: number): string {
  return bandOf(hits)?.fill ?? '#243036';
}

/** 1 -> "OHKO", 5 -> "5HKO", 99 -> "never". */
function hitsLabel(hits: number): string {
  if (hits >= 99) return 'never faints';
  if (hits === 1) return 'OHKO';
  return `${hits}HKO`;
}

const CELL = 11;
const PAD = { left: 42, right: 12, top: 10, bottom: 34 };
const AXIS_MAX = MAX_SP_PER_STAT;
const SIZE = (AXIS_MAX + 1) * CELL;

export function SurvivalMap({
  grid, current, onPick, attackerLabel, moveName,
}: {
  grid: SurvivalGrid;
  current: StatsTable;
  onPick: (sp: { hp: number; def: number }) => void;
  attackerLabel: string;
  moveName: string;
}) {
  const [hover, setHover] = useState<SurvivalCell | null>(null);

  const defLabel = grid.defStat === 'def' ? 'Def' : 'SpD';
  const curHP = Math.min(AXIS_MAX, current.hp ?? 0);
  const curDef = Math.min(AXIS_MAX, current[grid.defStat as StatID] ?? 0);

  // Defence on X, HP on Y; HP grows upward.
  const x = (def: number) => PAD.left + def * CELL;
  const y = (hp: number) => PAD.top + (AXIS_MAX - hp) * CELL;

  // Draw a line on each edge where the hit count changes: those edges are the
  // thresholds, which is the thing worth reading off this chart.
  const contours = useMemo(() => {
    const segs: { x1: number; y1: number; x2: number; y2: number }[] = [];
    for (let hp = 0; hp <= AXIS_MAX; hp++) {
      for (let def = 0; def <= AXIS_MAX; def++) {
        const here = grid.cells[hp][def].hitsToKO;
        // Boundary above this cell (one more HP point).
        if (hp < AXIS_MAX && grid.cells[hp + 1][def].hitsToKO !== here) {
          segs.push({ x1: x(def), y1: y(hp + 1) + CELL, x2: x(def) + CELL, y2: y(hp + 1) + CELL });
        }
        // Boundary to the right of this cell (one more defence point).
        if (def < AXIS_MAX && grid.cells[hp][def + 1].hitsToKO !== here) {
          segs.push({ x1: x(def + 1), y1: y(hp), x2: x(def + 1), y2: y(hp) + CELL });
        }
      }
    }
    return segs;
  }, [grid]);

  const anyUnaffordable = useMemo(
    () => grid.cells.some((row) => row.some((c) => !c.affordable)),
    [grid],
  );

  const presentBands = useMemo(() => {
    const seen = new Set<number>();
    for (const row of grid.cells) {
      for (const cell of row) if (cell.hitsToKO < 99) seen.add(Math.min(cell.hitsToKO, 4));
    }
    return BANDS.filter((b) => seen.has(b.hits));
  }, [grid]);

  if (grid.inert) {
    return (
      <p className="opt-note muted">
        {attackerLabel} {moveName} does no damage here, so there is no threshold to plot.
      </p>
    );
  }

  const width = PAD.left + SIZE + PAD.right;
  const height = PAD.top + SIZE + PAD.bottom;
  const ticks = [0, 8, 16, 24, 32];
  const shown = hover ?? grid.cells[curHP][curDef];

  return (
    <div className="survival">
      <div className="survival-legend">
        {presentBands.map((b) => (
          <span key={b.hits} className="survival-key">
            <span className="survival-swatch" style={{ background: b.fill }} />
            {b.label}
          </span>
        ))}
        {anyUnaffordable && (
          <span className="survival-key">
            <span className="survival-swatch survival-swatch-out" />
            needs points spent elsewhere
          </span>
        )}
      </div>

      <svg
        className="survival-svg"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={
          `Hits survived against ${attackerLabel} ${moveName} for every split of Stat Points ` +
          `between ${defLabel} (horizontal) and HP (vertical).`
        }
        onMouseLeave={() => setHover(null)}
      >
        {grid.cells.map((row, hp) =>
          row.map((cell, def) => (
            <rect
              key={`${hp}-${def}`}
              x={x(def)}
              y={y(hp)}
              width={CELL}
              height={CELL}
              fill={bandFill(cell.hitsToKO)}
              opacity={cell.affordable ? 1 : 0.18}
              onMouseEnter={() => setHover(cell)}
              onClick={() => cell.affordable && onPick({ hp, def })}
              style={{ cursor: cell.affordable ? 'pointer' : 'not-allowed' }}
            />
          )),
        )}

        {contours.map((s, i) => (
          <line
            key={i}
            x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2}
            stroke="#0e1116" strokeWidth={2} strokeLinecap="square"
            pointerEvents="none"
          />
        ))}

        {/*
          The budget line: def + hp = budget. Only drawn when it actually crosses the
          grid — with all 66 points free, 32+32 fits and nothing is out of reach.
        */}
        {anyUnaffordable && (
          <line
            x1={x(Math.max(0, grid.budget - AXIS_MAX))}
            y1={y(Math.min(AXIS_MAX, grid.budget))}
            x2={x(Math.min(AXIS_MAX, grid.budget))}
            y2={y(Math.max(0, grid.budget - AXIS_MAX))}
            stroke="#9daabd" strokeWidth={1.5} strokeDasharray="4 3"
            pointerEvents="none"
          />
        )}

        {/* Current spread. */}
        <rect
          x={x(curDef)} y={y(curHP)} width={CELL} height={CELL}
          fill="none" stroke="#e6ecf5" strokeWidth={2} pointerEvents="none"
        />
        {hover && (
          <rect
            x={x(hover.defSP)} y={y(hover.hpSP)} width={CELL} height={CELL}
            fill="none" stroke="#4f8cff" strokeWidth={2} pointerEvents="none"
          />
        )}

        {ticks.map((t) => (
          <g key={`x${t}`} pointerEvents="none">
            <text x={x(t) + CELL / 2} y={height - 16} className="survival-tick" textAnchor="middle">
              {t}
            </text>
          </g>
        ))}
        {ticks.map((t) => (
          <text
            key={`y${t}`}
            x={PAD.left - 8}
            y={y(t) + CELL / 2 + 3}
            className="survival-tick"
            textAnchor="end"
            pointerEvents="none"
          >
            {t}
          </text>
        ))}
        <text x={PAD.left + SIZE / 2} y={height - 2} className="survival-axis" textAnchor="middle">
          {defLabel} Stat Points
        </text>
        <text
          x={-(PAD.top + SIZE / 2)}
          y={11}
          className="survival-axis"
          textAnchor="middle"
          transform="rotate(-90)"
        >
          HP Stat Points
        </text>
      </svg>

      <div className="survival-readout">
        <span className="survival-readout-head">
          {shown.hpSP} HP / {shown.defSP} {defLabel}
          <em>{shown.hpSP + shown.defSP} of {grid.budget} points</em>
        </span>
        <span className={`survival-verdict band-${Math.min(shown.hitsToKO, 4)}`}>
          {hitsLabel(shown.hitsToKO)}
        </span>
        <span className="muted small">
          {shown.worstPct.toFixed(1)}% at the highest roll · {shown.maxHP} HP
          {!shown.affordable && ` · needs ${shown.hpSP + shown.defSP - grid.budget} more points`}
        </span>
      </div>
      <p className="muted small survival-hint">
        {hover ? 'Click a square to apply that spread.' : 'Hover any square for its numbers.'}
        {' '}The white outline is the current spread.
        {anyUnaffordable
          ? ` Only ${grid.budget} of your 66 points are free — the rest are committed to other` +
            ' stats, so the dimmed area past the dashed line needs points freed up first.'
          : ' All 66 points are free, so every square here is reachable.'}
      </p>
    </div>
  );
}
