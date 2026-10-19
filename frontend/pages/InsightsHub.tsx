import React from 'react';
import PageTabs, { PageTab } from '../components/PageTabs';
import PageHeader, { PageEmphasis } from '../components/PageHeader';
import GravityInsights from './GravityInsights';
import Competitors from './Competitors';
import AIMemory from './AIMemory';
import { insightsTabs } from '../utils/navMenu';

export const INSIGHTS_HEADERS: Record<string, React.ReactNode> = {
  performance: <PageHeader eyebrow="Insights" title="How your posts are" emphasis="doing" description="Reach, engagement, followers and posts published, from your connected accounts." />,
  competitors: <PageHeader eyebrow="Insights" title={<>Who else is in the <PageEmphasis>room</PageEmphasis>?</>} description="Their public posts, checked once a week: what is working for them and what you can make from it." />,
  learned: <PageHeader eyebrow="Insights" title="What Nebulaa has" emphasis="learned" description="Nebulaa keeps a short list of patterns it has learned from how your published posts performed, and uses it when it plans your next posts." />,
};

/**
 * Insights (navigation phase 3): Performance, Competitors and What Nebulaa learned as tabs (`?tab=`). The Competitors
 * tab is listed only where the menu entry was shown before (paid plans, inside a client); an old link still opens it.
 */
const InsightsHub: React.FC<{ showsCompetitors: boolean }> = ({ showsCompetitors }) => {
  const body: Record<string, React.ReactNode> = {
    performance: <GravityInsights embedded />,
    competitors: <Competitors embedded />,
    learned: <AIMemory embedded />,
  };
  const listed = new Set(insightsTabs({ showsCompetitors }).map((t) => t.key));
  const tabs: PageTab[] = insightsTabs({ showsCompetitors: true }).map((t) => ({
    key: t.key, label: t.label, element: body[t.key], header: INSIGHTS_HEADERS[t.key], hidden: !listed.has(t.key),
  }));
  return <PageTabs tabs={tabs} label="Insights" />;
};

export default InsightsHub;
