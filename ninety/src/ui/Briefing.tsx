import type { Briefing } from '../engine/brief';
import type { Battler } from '../engine/battler';
import { Disc, Figure, signed, tone } from './bits';

/**
 * The answer, in the order a player wants it: what decides the game, what to
 * bring, what to lead, and what would have to be true for all of it to be wrong.
 */
export default function BriefingView({ brief, mine }: { brief: Briefing; mine: Battler[] }) {
  const bringing = brief.bring.map((b) => b.battler);
  return (
    <>
      <div className="panel">
        <h2>The crux</h2>
        <p className="crux">{brief.crux}</p>
        <div className="figures">
          <Figure label="equity" value={signed(brief.equity)} tone={tone(brief.equity)} />
          <Figure label="if they read you" value={signed(brief.worstCase)} tone={tone(brief.worstCase)} />
          <Figure label="lead" value={brief.lead.map((b) => b.species).join(' + ')} />
        </div>
        <p className="note">
          <b>Tempo:</b> {brief.regime}.
        </p>
        {brief.readProof && <p className="note">{brief.readProof}</p>}
        {brief.closeCall && <p className="note">{brief.closeCall}</p>}
      </div>

      <div className="panel">
        <h2>Bring these four</h2>
        <div className="six compact" style={{ marginBottom: 14 }}>
          {bringing.map((b) => (
            <div
              key={b.key}
              className={`mon picked ${brief.lead.includes(b) ? 'lead' : ''}`}
            >
              <Disc b={b} />
              <span className="mon-name">{b.species}</span>
              <span className="mon-set">{brief.lead.includes(b) ? 'lead' : 'back'}</span>
            </div>
          ))}
        </div>
        <ul className="reasons">
          {brief.bring.map((line) => (
            <li className="reason" key={line.battler.key}>
              <Disc b={line.battler} size="sm" />
              <span className="reason-body">
                <span className="reason-who">{line.battler.species}</span>{' '}
                <span className="reason-text">{line.reason}</span>
              </span>
              <span className="reason-fig">{line.figure}</span>
            </li>
          ))}
        </ul>
        <p className="note"><b>Lead:</b> {brief.leadReason}</p>
      </div>

      <div className="cols">
        <div className="panel">
          <h2>Left at home</h2>
          <ul className="reasons">
            {brief.bench.map((line) => (
              <li className="reason" key={line.battler.key}>
                <Disc b={line.battler} size="sm" />
                <span className="reason-body">
                  <span className="reason-who">{line.battler.species}</span>{' '}
                  <span className="reason-text">{line.reason}</span>
                </span>
                <span className="reason-fig">{line.figure}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="panel">
          <h2>What would have to be true</h2>
          {brief.risks.length === 0 ? (
            <p className="reason-text">
              Nothing they could be running changes the answer by more than a few points. Their sets
              are either known or they do not matter here.
            </p>
          ) : (
            brief.risks.map((r, i) => (
              <div className={`risk ${r.changesThePick ? 'flips' : ''}`} key={i}>
                <span className="risk-odds">{Math.round(r.odds * 100)}%</span>
                <span>
                  <h3>{r.headline}</h3>
                  <p>{r.detail}</p>
                </span>
              </div>
            ))
          )}
          <p className="note">
            You cannot see items at preview, so every number above is conditional. These are the
            conditions worth holding in your head.
          </p>
        </div>
      </div>

      <MissingAnswers brief={brief} mine={mine} />
    </>
  );
}

/**
 * The one line a player says out loud at preview that no other panel covers:
 * "I have nothing for that."
 */
function MissingAnswers({ brief, mine }: { brief: Briefing; mine: Battler[] }) {
  void mine;
  const weak = brief.bring.filter((b) => b.reason.startsWith('Nothing here for it to do'));
  if (!weak.length) return null;
  return (
    <div className="panel">
      <h2>Soft slots</h2>
      <p className="reason-text">
        {weak.map((w) => w.battler.species).join(' and ')}{' '}
        {weak.length === 1 ? 'is' : 'are'} in the four because the alternatives are worse, not
        because {weak.length === 1 ? 'it does' : 'they do'} a job. If this matchup keeps coming up,
        that is the slot on your six worth changing.
      </p>
    </div>
  );
}
