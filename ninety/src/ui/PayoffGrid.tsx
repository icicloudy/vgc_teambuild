import { useState } from 'react';
import type { Battler } from '../engine/battler';
import type { PreviewSolution } from '../engine/solve';

/**
 * The whole game, on one screen.
 *
 * Rows are your fifteen possible fours, columns are theirs, and the cell is what
 * that pairing is worth to you. It is here because the number the app hands you
 * is a *best response*, and a best response only means something next to the
 * responses it beat — you can see at a glance whether your pick is good against
 * everything or good against one thing and catastrophic against another. That
 * distinction is the entire skill of team preview and no list of four names can
 * show it.
 *
 * Colour is the design system's diverging pair (blue yours, red theirs, gray at
 * nothing), which is the only correct family for a signed quantity with a
 * meaningful zero. It never carries the value alone: every cell has its number
 * on hover, and the table view underneath prints all of them.
 */

const STEPS = [
  { at: -22, css: 'var(--neg-4)' },
  { at: -12, css: 'var(--neg-3)' },
  { at: -5, css: 'var(--neg-2)' },
  { at: -1.5, css: 'var(--neg-1)' },
  { at: 1.5, css: 'var(--zero)' },
  { at: 5, css: 'var(--pos-1)' },
  { at: 12, css: 'var(--pos-2)' },
  { at: 22, css: 'var(--pos-3)' },
];

function shade(value: number): string {
  for (const s of STEPS) if (value < s.at) return s.css;
  return 'var(--pos-4)';
}

const label = (idx: number[], six: Battler[]) =>
  six.filter((_, i) => !idx.includes(i)).map((b) => b.species).join(' + ');

export default function PayoffGrid({
  solution, mine, theirs,
}: { solution: PreviewSolution; mine: Battler[]; theirs: Battler[] }) {
  const [hover, setHover] = useState<{ i: number; j: number } | null>(null);
  const { rows, cols, payoff, rowMix } = solution.game;

  // Rows worth reading first: the ones the equilibrium actually plays, then the
  // rest by how good they are. Fifteen rows of noise helps nobody.
  const order = rows.map((_, i) => i).sort((a, b) =>
    (rowMix[b] - rowMix[a]) || (solution.all[b].vsBest - solution.all[a].vsBest));
  const pickKey = solution.pick.bring.join();
  const hovered = hover ? payoff[hover.i][hover.j] : null;

  return (
    <div className="panel">
      <h2>Every four, against every four</h2>
      <p className="hint">
        Your fifteen options down the side, theirs across the top, labelled by who stays home.
        {hovered !== null && hover
          ? <> <b>You leave {label(rows[hover.i], mine)}, they leave {label(cols[hover.j], theirs)}: {hovered >= 0 ? '+' : ''}{hovered.toFixed(1)}.</b></>
          : ' Hover a cell for the number.'}
      </p>

      <div className="grid-scroll">
        <table className="grid">
          <thead>
            <tr>
              <th />
              <th className="mixcell">mix</th>
              {cols.map((c, j) => (
                <th key={j} title={`They leave home: ${label(c, theirs)}`}>{j + 1}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {order.map((i) => (
              <tr key={i} className={rows[i].join() === pickKey ? 'is-pick' : ''}>
                <th className="row-head" title={`You leave home: ${label(rows[i], mine)}`}>
                  {label(rows[i], mine)}
                </th>
                <td className="mixcell">
                  <span
                    className="mixbar"
                    style={{ width: `${Math.max(rowMix[i] * 100, rowMix[i] > 0 ? 6 : 0)}%` }}
                    title={`played ${(rowMix[i] * 100).toFixed(0)}% of the time at equilibrium`}
                  />
                </td>
                {cols.map((_, j) => (
                  <td
                    key={j}
                    className="cell"
                    style={{ background: shade(payoff[i][j]) }}
                    onMouseEnter={() => setHover({ i, j })}
                    onMouseLeave={() => setHover(null)}
                    title={`${payoff[i][j] >= 0 ? '+' : ''}${payoff[i][j].toFixed(1)}`}
                  />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="legend">
        <span>theirs</span>
        <span className="swatches">
          <i style={{ background: 'var(--neg-4)' }} />
          <i style={{ background: 'var(--neg-3)' }} />
          <i style={{ background: 'var(--neg-2)' }} />
          <i style={{ background: 'var(--neg-1)' }} />
          <i style={{ background: 'var(--zero)' }} />
          <i style={{ background: 'var(--pos-1)' }} />
          <i style={{ background: 'var(--pos-2)' }} />
          <i style={{ background: 'var(--pos-3)' }} />
          <i style={{ background: 'var(--pos-4)' }} />
        </span>
        <span>yours</span>
        <span style={{ marginLeft: 'auto' }}>
          The blue bar is how often the equilibrium brings that four.
        </span>
      </div>

      <details className="table-view">
        <summary>The same thing as numbers</summary>
        <table className="plain">
          <thead>
            <tr>
              <th>You leave home</th>
              <th className="num">vs their best</th>
              <th className="num">worst case</th>
              <th className="num">vs likely</th>
              <th className="num">mix</th>
            </tr>
          </thead>
          <tbody>
            {order.map((i) => (
              <tr key={i}>
                <td>{label(rows[i], mine)}</td>
                <td className="num">{solution.all[i].vsBest.toFixed(1)}</td>
                <td className="num">{solution.all[i].worst.toFixed(1)}</td>
                <td className="num">{solution.all[i].vsLikely.toFixed(1)}</td>
                <td className="num">{(rowMix[i] * 100).toFixed(0)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
