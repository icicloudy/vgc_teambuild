import { SHAPE_AXES } from '../engine/autobuild';
import type { TeamShape } from '../engine/autobuild';

/**
 * Before/after across the six axes of a team's shape.
 *
 * Form: one bar per axis for the drafted value, with a tick marking where the
 * team is today — the two marks are told apart by *shape*, not by colour, and
 * both numbers are printed on the row, so nothing here depends on hue. That also
 * sidesteps the trap in a two-shade dumbbell: two steps of one hue that both sit
 * in the readable lightness band land under the colour-difference floor, and
 * paying for the separation with a second hue would imply two categories where
 * there is really one measure and a reference point.
 */
export function ShapeBars({
  before, after, showBefore = true,
}: {
  before: TeamShape;
  after: TeamShape;
  showBefore?: boolean;
}) {
  return (
    <div className="shape">
      {SHAPE_AXES.map((axis) => {
        const from = before[axis.key];
        const to = after[axis.key];
        const delta = to - from;
        return (
          <div className="shape-row" key={axis.key}>
            <span className="shape-label" title={axis.hint}>{axis.label}</span>
            <span className="shape-track">
              <span className="shape-fill" style={{ width: `${Math.max(1, to)}%` }} />
              {showBefore && from > 0 && (
                <span
                  className="shape-tick"
                  style={{ left: `${from}%` }}
                  title={`now ${from}`}
                />
              )}
            </span>
            <span className="shape-values">
              {showBefore && <span className="shape-from">{from}</span>}
              {showBefore && <span className="shape-arrow">→</span>}
              <strong>{to}</strong>
              {showBefore && delta !== 0 && (
                <span className="shape-delta">
                  {delta > 0 ? '▲' : '▼'}{Math.abs(delta)}
                </span>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}
