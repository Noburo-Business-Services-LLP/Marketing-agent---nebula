import React from 'react';
import { ArrowRight, RefreshCw, CalendarCheck, MessagesSquare, Sparkles } from 'lucide-react';
import { BlueprintArt } from '../art/Blueprint';
import { PlanPeopleArt } from '../art/plan/People';
import { CompetitorsArt } from '../art/Competitors';
import { CalendarArt } from '../art/Calendar';
import { CampaignArt } from '../art/Campaign';
import { ReviewQueueArt } from '../art/ReviewQueue';
import { InboxArt } from '../art/Inbox';
import { MemoryArt } from '../art/Memory';
import { COMMUNITY, INBOX_LINES_VISIBLE, LOOP, type StageArt } from '../../constants/landingCopy';
import { SectionHead } from './LandingBits';

const ART: Record<StageArt, React.ReactNode> = {
  blueprint: <BlueprintArt />, people: <PlanPeopleArt />, competitors: <CompetitorsArt />, calendar: <CalendarArt />,
  campaign: <CampaignArt />, review: <ReviewQueueArt />, inbox: <InboxArt />, memory: <MemoryArt />,
};

/**
 * Where the arrow after each stage points on a desktop, where the eight cards sit as a loop: stages 1 to 4 run left to
 * right on the top row, 5 to 8 run right to left on the bottom row, and stage 8 points back up to stage 1. Below
 * 1024 px the stages are one column and every arrow points down; the "starts again" line closes the loop.
 */
const arrowDir = (i: number, n: number): 'right' | 'down' | 'left' | 'up' => {
  const top = Math.ceil(n / 2);
  if (i < top - 1) return 'right';
  if (i === top - 1) return 'down';
  if (i < n - 1) return 'left';
  return 'up';
};

/** "How Nebulaa runs your marketing": the eight-stage loop, then the short community block. */
const LoopSection: React.FC = () => {
  const stages = LOOP.stages;
  return (
    <section className="nb-land-section nb-land-loop-section" id="how" aria-labelledby="how-title">
      <div className="nb-land-wrap">
        <SectionHead id="how-title" eyebrow={LOOP.eyebrow} title={LOOP.title} emphasis={LOOP.emphasis} line={LOOP.line} />
        <ol className="nb-land-loop">
          {stages.map((s, i) => {
            // The Inbox stage stays in the loop when the switch is off, marked as not yet available, with no promise.
            const held = Boolean(s.inbox) && !INBOX_LINES_VISIBLE;
            return (
              <li key={s.title} className="nb-land-stage" data-tone={s.tone} data-i={i + 1}>
                <div className="nb-land-stage-art" aria-hidden="true">{ART[s.art]}</div>
                <div className="nb-land-stage-top">
                  <span className="nb-land-num" aria-hidden="true">{i + 1}</span>
                  {(held || s.addon) && <span className="nb-land-chip">{held ? LOOP.soon : s.addon}</span>}
                </div>
                <h3><span className="sr-only">{LOOP.stageLabel(i + 1)}</span>{s.title}</h3>
                <p>{held ? s.soonText : s.text}</p>
                <span className="nb-land-loop-arrow" data-dir={arrowDir(i, stages.length)} aria-hidden="true"><ArrowRight size={15} strokeWidth={2.6} /></span>
              </li>
            );
          })}
        </ol>
        <p className="nb-land-loop-back"><RefreshCw size={16} strokeWidth={2.4} aria-hidden="true" />{LOOP.back}</p>
        <CommunityBlock />
      </div>
    </section>
  );
};

const COMMUNITY_ICONS = [CalendarCheck, MessagesSquare, Sparkles];

/** Building a community: what Nebulaa helps with, written as help and never as a promise of growth. */
const CommunityBlock: React.FC = () => {
  const points = COMMUNITY.points.map((p, i) => ({ ...p, Icon: COMMUNITY_ICONS[i] })).filter((p) => INBOX_LINES_VISIBLE || !p.inbox);
  return (
    <div className="nb-land-community">
      <div>
        <p className="nb-land-eyebrow">{COMMUNITY.eyebrow}</p>
        <h3 className="nb-land-h3" id="community-title">{COMMUNITY.title} <span className="nb-land-em">{COMMUNITY.emphasis}</span></h3>
        <p className="nb-land-lede">{COMMUNITY.line}</p>
      </div>
      <ul className="nb-land-points" data-count={points.length}>
        {points.map(({ title, text, Icon }) => (
          <li key={title} className="nb-land-point">
            <span className="nb-land-point-mark" aria-hidden="true"><Icon size={19} strokeWidth={2.2} /></span>
            <div><h4>{title}</h4><p>{text}</p></div>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default LoopSection;
