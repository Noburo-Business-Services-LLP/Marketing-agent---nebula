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
import { PlatformMark } from '../plan/PlanMarks';
import { EXPLAINER, EXPLAINER_STEPS, chipLabel, type InboxPart, type OverviewTile } from '../../utils/inboxOverview';
import { WHAT_WILL_APPEAR, initialsOf, markOf, type Chip, type MarkKey } from '../../utils/inboxView';
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
        <p className="nb-ix-eyebrow">{EXPLAINER.eyebrow}{EXPLAINER.badge && <span className="nb-ix-ready">{EXPLAINER.badge}</span>}</p>
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

type NoteAction = { label: string; to?: string; onClick?: () => void; busy?: boolean };

const NoteButton: React.FC<{ a: NoteAction; quiet?: boolean }> = ({ a, quiet }) => (a.to
  ? <Link to={a.to} className={quiet ? 'nb-ix-btn2' : 'nb-ix-btn'}>{a.label} {!quiet && <ArrowRight aria-hidden="true" />}</Link>
  : <button type="button" onClick={a.onClick} disabled={a.busy} className={quiet ? 'nb-ix-btn2' : 'nb-ix-btn'}>{a.label}</button>);

/** A warm note with small art, a title, one line and up to two buttons. `marks` shows the platforms it is about. */
export const InboxNote: React.FC<{
  title: string; text: string; art?: React.ReactNode; action?: NoteAction | null; second?: NoteAction | null;
  role?: 'status' | 'alert'; tone?: 'warn'; marks?: MarkKey[];
}> = ({ title, text, art, action, second, role, tone, marks }) => (
  <div className="nb-ix-note" role={role} data-tone={tone}>
    {art && <span className="nb-ix-note-art" aria-hidden="true">{art}</span>}
    <div className="nb-ix-note-text">
      <h2>{title}</h2>
      <p>{text}</p>
      {marks && marks.length > 0 && <span className="nb-ix-note-marks" aria-hidden="true">{marks.map((m) => <PlatformMark key={m} platform={m} size={24} />)}</span>}
    </div>
    {(action || second) && (
      <div className="nb-ix-note-actions">
        {second && <NoteButton a={second} quiet />}
        {action && <NoteButton a={action} />}
      </div>
    )}
  </div>
);

/** A round avatar with the person's initials and the platform's small mark. */
export const InboxAvatar: React.FC<{ name?: string | null; platform?: string | null; size?: 'lg' }> = ({ name, platform, size }) => (
  <span className="nb-ix-avatar" data-size={size} aria-hidden="true">
    {initialsOf(name)}
    <span className="nb-ix-avatar-mark"><PlatformMark platform={markOf(platform)} size={18} /></span>
  </span>
);

export const InboxChips: React.FC<{ chips: Chip[]; label?: string }> = ({ chips, label }) => (
  <span className="nb-ix-chips" aria-label={label}>
    {chips.map((c) => <span key={c.label} className="nb-ix-chip" data-tone={c.tone}>{c.label}</span>)}
  </span>
);

/** Connected, nothing yet: what will show up here, with the inbox drawing. */
export const InboxWelcome: React.FC = () => (
  <section className="nb-ix-card nb-ix-welcome" aria-labelledby="nb-ix-welcome-title">
    <div className="nb-ix-welcome-lead">
      <span aria-hidden="true"><InboxArt /></span>
      <div>
        <h2 id="nb-ix-welcome-title">Nothing here yet</h2>
        <p>Your accounts are connected. When people comment on your posts or send you a message, it shows up here.</p>
      </div>
    </div>
    <ul className="nb-ix-appear" aria-label="What will appear here">
      {WHAT_WILL_APPEAR.map((w) => (
        <li key={w.id}>
          <PlatformMark platform={w.mark} size={26} />
          <span><strong>{w.title}</strong><span>{w.text}</span></span>
        </li>
      ))}
    </ul>
  </section>
);
