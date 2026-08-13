import { useMemo, useState } from 'react';
import { exportTeam, importTeam } from '../engine/showdown';
import { useActiveTeam, useFormat, useStore } from '../store';

export function ImportExportDialog({ onClose }: { onClose: () => void }) {
  const team = useActiveTeam();
  const format = useFormat();
  const replaceMembers = useStore((s) => s.replaceMembers);

  const exported = useMemo(() => exportTeam(team.members), [team.members]);
  const [paste, setPaste] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);

  const doImport = () => {
    const { sets, errors: errs } = importTeam(paste);
    setErrors(errs);
    if (!sets.length) return;
    replaceMembers(sets.slice(0, format.bring).map((s) => ({ ...s, level: format.level })));
    if (!errs.length) onClose();
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(exported);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>Import / Export</h2>
          <button className="btn btn-sm" onClick={onClose}>Close</button>
        </header>

        <div className="modal-body grid-2">
          <div>
            <h3>Export</h3>
            <p className="muted small">
              Standard Showdown paste. Mega Stones are written as the item, so the set imports
              cleanly anywhere.
            </p>
            <textarea className="notes mono" rows={18} readOnly value={exported} />
            <div className="row-actions">
              <button className="btn" onClick={copy}>{copied ? 'Copied' : 'Copy to clipboard'}</button>
              <a
                className="btn"
                download={`${team.name || 'team'}.txt`}
                href={URL.createObjectURL(new Blob([exported], { type: 'text/plain' }))}
              >
                Download
              </a>
            </div>
          </div>

          <div>
            <h3>Import</h3>
            <p className="muted small">
              Paste a team. A line like <code>Mega Charizard Y</code> is folded back into
              Charizard holding Charizardite Y, which is how Champions actually builds it.
            </p>
            <textarea
              className="notes mono"
              rows={18}
              value={paste}
              placeholder="Paste a Showdown team here…"
              onChange={(e) => setPaste(e.target.value)}
            />
            <div className="row-actions">
              <button className="btn btn-primary" onClick={doImport} disabled={!paste.trim()}>
                Replace team
              </button>
              <span className="muted small">Replaces all {team.members.length} current slots.</span>
            </div>
            {errors.length > 0 && (
              <ul className="issue-list compact">
                {errors.map((e, i) => (
                  <li key={i} className="issue issue-warning"><span className="issue-tag">note</span>{e}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
