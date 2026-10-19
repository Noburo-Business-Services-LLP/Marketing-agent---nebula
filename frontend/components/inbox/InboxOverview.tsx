import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import Tile from '../Tile';
import TileGrid from '../TileGrid';
import { InboxArt } from '../art/Inbox';
import { ReviewsArt } from '../art/Reviews';
import { AutoReplyArt } from '../art/AutoReply';
import { StepConnectArt } from '../art/inbox/Connect';
import { StepCarefulArt } from '../art/inbox/Careful';
import { StepRunArt } from '../art/inbox/Run';
import { EXPLAINER, EXPLAINER_STEPS, chipLabel, type InboxPart, type OverviewTile } from '../../utils/inboxOverview';
import './inbox.css';

const TILE_ART: Record<InboxPart, React.ReactNode> = {
  messages: <InboxArt />,
  reviews: <ReviewsArt />,
  'auto-reply': <AutoReplyArt />,
};

/** The three parts of the Inbox as compact tiles. Each shows its status in words and one counts line, and opens its part. */
export const InboxPartTiles: React.FC<{ tiles: OverviewTile[]; current: InboxPart; onOpen: (part: InboxPart) => void }> = ({ tiles, current, onOpen }) => (
  <TileGrid columns={3} label="Parts of your inbox" className="nb-ix-strip">
    {tiles.map((t) => (
      <Tile
        key={t.id}
        variant="compact"
        accent="inbox"
        title={t.title}
        subtitle={t.subtitle}
        badge={chipLabel(t.status) || undefined}
        footer={t.line}
        art={TILE_ART[t.id]}
        selected={current === t.id}
        onClick={() => onOpen(t.id)}
        dataAttrs={{ 'data-status': t.status || 'none', 'data-part': t.id }}
      />
    ))}
  </TileGrid>
);

const STEP_ART: Record<string, React.ReactNode> = {
  connect: <StepConnectArt />,
  careful: <StepCarefulArt />,
  run: <StepRunArt />,
};

/** What automatic replies do, in plain words, with the three steps as small art tiles. */
export const AutoReplyExplainer: React.FC<{ action?: { label: string; to: string } | null; showSafety?: boolean }> = ({ action, showSafety }) => (
  <section className="nb-ix-explain" aria-labelledby="nb-ix-explain-title">
    <div className="nb-ix-explain-head">
      <div>
        <p className="nb-ix-eyebrow">{EXPLAINER.eyebrow}</p>
        <h2 id="nb-ix-explain-title">{EXPLAINER.title}</h2>
      </div>
      <div className="nb-ix-explain-copy">
        {EXPLAINER.lines.map((line) => <p key={line}>{line}</p>)}
      </div>
    </div>
    <ol className="nb-ix-steps" aria-label="How it works">
      {EXPLAINER_STEPS.map((s, i) => (
        <li key={s.id} className="nb-ix-step">
          <span className="nb-ix-step-art">
            {STEP_ART[s.id]}
            <span className="nb-ix-step-num" aria-hidden="true">{i + 1}</span>
          </span>
          <span>
            <h3>{s.title}</h3>
            <p>{s.text}</p>
          </span>
        </li>
      ))}
    </ol>
    {(showSafety || action) && (
      <div className="nb-ix-explain-foot">
        {showSafety ? <p>{EXPLAINER.safety}</p> : <span />}
        {action && <Link to={action.to} className="nb-ix-btn">{action.label} <ArrowRight aria-hidden="true" /></Link>}
      </div>
    )}
  </section>
);

/** A warm note with small art, a title, one line and an optional button. */
export const InboxNote: React.FC<{
  title: string; text: string; art?: React.ReactNode; action?: { label: string; to?: string; onClick?: () => void } | null; role?: 'status' | 'alert';
}> = ({ title, text, art, action, role }) => (
  <div className="nb-ix-note" role={role}>
    {art && <span className="nb-ix-note-art" aria-hidden="true">{art}</span>}
    <div className="nb-ix-note-text">
      <h2>{title}</h2>
      <p>{text}</p>
    </div>
    {action && (action.to
      ? <Link to={action.to} className="nb-ix-btn">{action.label} <ArrowRight aria-hidden="true" /></Link>
      : <button type="button" onClick={action.onClick} className="nb-ix-btn">{action.label}</button>)}
  </div>
);
