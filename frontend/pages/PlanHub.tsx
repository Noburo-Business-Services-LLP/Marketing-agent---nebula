import React from 'react';
import PageTabs, { PageTab } from '../components/PageTabs';
import PageHeader from '../components/PageHeader';
import MyPlan, { PLAN_LINE } from './MyPlan';
import CalendarHome from './CalendarHome';
import IdeaInbox from './IdeaInbox';
import { BlueprintTab } from './BlueprintRoutes';
import { planTabs } from '../utils/navMenu';
import type { User } from '../types';

/** The page header of each Plan tab: one header on the page, above the tab bar. */
export const PLAN_HEADERS: Record<string, React.ReactNode> = {
  plan: <PageHeader eyebrow="Plan" title="Your marketing" emphasis="plan" description={PLAN_LINE} />,
  calendar: <PageHeader eyebrow="Plan" title="Your month of" emphasis="posts" description="The plan for each month, and every post on the day it is scheduled." />,
  ideas: <PageHeader eyebrow="Plan" title="Save ideas for" emphasis="future posts" description="Add a thought, a link or an ad you liked, or paste a list of ideas. You can turn any idea into a post when you are ready." />,
  blueprint: <PageHeader eyebrow="Plan" title="Your Growth" emphasis="Blueprint" description="Where your business stands online and what to do next, ready to read page by page." />,
};

/**
 * Plan (navigation phase 4): My plan, Calendar, Content ideas and Blueprint as tabs of one page (`?tab=`), so the
 * address and the browser back button keep the tab. The tab bodies draw no header of their own.
 */
const PlanHub: React.FC<{ user: User | null; showsMyPlan: boolean }> = ({ user, showsMyPlan }) => {
  const body: Record<string, React.ReactNode> = {
    plan: <MyPlan user={user} embedded />,
    calendar: <CalendarHome />,
    ideas: <IdeaInbox />,
    blueprint: <BlueprintTab user={user} />,
  };
  const tabs: PageTab[] = planTabs({ showsMyPlan }).map((t) => ({ key: t.key, label: t.label, element: body[t.key], header: PLAN_HEADERS[t.key] }));
  return <PageTabs tabs={tabs} label="Plan" />;
};

export default PlanHub;
