import React, { useEffect, useState } from 'react';
import { apiService } from '../services/api';
import { HomeSummary, User } from '../types';
import AgencyUsage from '../components/AgencyUsage';
import SetupCard from '../components/SetupCard';
import ThisWeekCard from '../components/ThisWeekCard';
import { isAgencyUser, showsPostsNotQuarks } from '../utils/agency';
import { isHomeSummary, readCachedSummary, writeCachedSummary } from '../utils/home';
import { actionRows, greeting, headline, isNewAccount, planBanner, blockFailed } from '../utils/homeLayout';
import { BalanceChip, CreateToday, DoThisNext, NumbersStrip, Skeleton, PlanBanner, TodayPlan } from '../components/home/HomeBlocks';
import { HomeCompetitors } from '../components/CompetitorTiles';
import '../components/home/home.css';

// Home, the control room. The page reads ONE small answer, GET /api/home/summary (numbers, Do this next, this week,
// plan state, balance, today's posts), plus the Setup and This week cards' own calls. Nothing downloads every draft or
// campaign. Every block renders from the summary alone and fails alone; a failed source shows a small note in its block.

const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_LABELS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// Today's date as the India calendar shows it (not the browser's own timezone).
function istDateLabel(now: Date) {
  const d = new Date(now.getTime() + 330 * 60000);
  return `${DAY_LABELS[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTH_LABELS[d.getUTCMonth()]}`;
}

const GravityHome: React.FC<{ user?: User | null }> = ({ user }) => {
  const userId = String((user as any)?._id || (user as any)?.id || '');
  const [summary, setSummary] = useState<HomeSummary | null>(() => readCachedSummary(userId));
  const [loading, setLoading] = useState(() => !readCachedSummary(userId));
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    // Show the last answer at once when there is a fresh one, then read the latest quietly.
    const cached = attempt === 0 ? readCachedSummary(userId) : null;
    if (cached) { setSummary(cached); setLoading(false); }
    (async () => {
      try {
        const res = await apiService.getHomeSummary();
        if (cancelled) return;
        // An answer that is not a summary (an old server) counts as a failed load, never as numbers.
        if (!isHomeSummary(res)) throw new Error('unexpected answer');
        setSummary(res);
        setFailed(false);
        writeCachedSummary(userId, res);
      } catch {
        if (!cancelled) setFailed(!cached);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [userId, attempt]);

  // A CSM pass shows the client's account: the This week card shows, the Setup card does not. Staff see neither.
  const csmPass = (() => { try { return Boolean(localStorage.getItem('csmReturnToken')); } catch { return false; } })();
  const isStaffSelf = Boolean(user && (user.staffRole || user.isCsm)) && !csmPass;
  const showWeek = Boolean(user) && !isStaffSelf;
  // The summary already knows when setup is finished, so the Setup card (and its call) is left out then.
  const showSetup = showWeek && !csmPass && !user?.actingAgency && !(summary && summary.setup && summary.setup.allDone);

  const name = String(user?.businessProfile?.name || '').trim();
  const now = new Date();
  const hello = greeting('', now);
  const banner = summary ? planBanner(summary.plan) : null;
  const isNew = isNewAccount(summary);
  const language = user?.businessProfile?.contentLanguage;
  // A free account with nothing to spend is told about plans in Do this next; an empty balance here would only repeat it.
  const showBalance = Boolean(summary && !summary.account?.staff && !(summary.account?.free && !((summary.balance?.posts ?? 0) > 0)));

  return (
    <div className="nb-home">
      {isAgencyUser(user) && <AgencyUsage />}

      <header className="nb-home-head">
        <div style={{ minWidth: 0 }}>
          <p className="nb-home-date">{istDateLabel(now)}</p>
          <h1 className="nb-home-hello font-serif-display">
            {hello}{name ? <>, <em>{name}</em></> : null}
          </h1>
          <p className="nb-home-line" aria-live="polite">
            {summary ? headline(summary, actionRows(summary.nextActions, { planBanner: Boolean(banner) }).length) : loading ? ' ' : 'Here is your day at a glance.'}
          </p>
        </div>
        {showBalance && summary && <BalanceChip summary={summary} />}
      </header>

      {banner && <PlanBanner banner={banner} />}

      {loading && !summary && <Skeleton kind="numbers" />}

      {failed && !summary && (
        <div className="nb-home-banner" data-tone="warn" role="alert">
          <p>We could not load your numbers and next steps just now. The rest of Home still works.</p>
          <button type="button" className="nb-home-btn" onClick={() => { setLoading(true); setFailed(false); setAttempt((a) => a + 1); }}>Try again</button>
        </div>
      )}

      {summary && !isNew && <NumbersStrip summary={summary} />}

      <div className="nb-home-row">
        <div className="nb-home-col">
          {loading && !summary && <Skeleton kind="next" />}
          {summary && <DoThisNext summary={summary} planBannerShown={Boolean(banner)} isNew={isNew} />}
          {showSetup && (summary || failed) && <SetupCard />}
          {showWeek && <ThisWeekCard language={language} />}
        </div>
        <div className="nb-home-col">
          <CreateToday language={language} postsOnly={showsPostsNotQuarks(user as any)} showPacks={!isStaffSelf} />
          {loading && !summary && <Skeleton kind="today" />}
          {summary && <TodayPlan summary={summary} failed={blockFailed(summary, 'today')} />}
        </div>
      </div>

      {/* Competitors and trends: read after the summary so the first paint keeps to three calls. No plan links inside a pass. */}
      <HomeCompetitors enabled={showWeek && Boolean(summary || failed)} language={language} noPlanLinks={Boolean(summary?.account?.clientWorkspace || summary?.account?.pass || user?.actingAgency || csmPass)} postsOnly={showsPostsNotQuarks(user as any)} />

      {summary && isNew && <NumbersStrip summary={summary} />}
    </div>
  );
};

export default GravityHome;
