import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, Sparkles, Copy, Check, AlertCircle } from 'lucide-react';
import { apiService } from '../services/api';
import { customerMessage } from '../utils/errors';
import { REVIEWS_NOTE } from '../utils/inbox';
import { avgStars, reviewsState, reviewsSummaryLine, type ReviewsState } from '../utils/inboxView';
import { InboxAvatar, InboxNote } from './inbox/InboxOverview';
import { ReviewsArt } from './art/Reviews';
import { ReviewStarsArt } from './art/inbox/Stars';
import './inbox/inbox.css';

type ReviewsResult = Awaited<ReturnType<typeof apiService.getGoogleReviews>>;
type Review = ReviewsResult['reviews'][number];

const STAR = 'M12 2.8l2.8 5.8 6.3.9-4.6 4.4 1.1 6.3L12 17.2l-5.6 3 1.1-6.3L2.9 9.5l6.3-.9z';

const Stars: React.FC<{ rating: number }> = ({ rating }) => (
  <span className="nb-ix-stars" role="img" aria-label={`${rating} out of 5 stars`}>
    {[1, 2, 3, 4, 5].map((n) => (
      <svg key={n} viewBox="0 0 24 24" aria-hidden="true" focusable="false" data-on={n <= rating ? 'true' : 'false'}><path d={STAR} /></svg>
    ))}
  </span>
);

const dateText = (v?: string | null): string => {
  if (!v) return '';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};

/** Google reviews with a drafted reply for each. Replies are copied into Google by the owner; nothing is posted from here. */
const ReviewsPanel: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<ReviewsResult | null>(null);
  const [view, setView] = useState<ReviewsState>('failed');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async (isCancelled: () => boolean = () => false) => {
    setLoading(true);
    try {
      const res = await apiService.getGoogleReviews();
      if (isCancelled()) return;
      setResult(res);
      setView(reviewsState(res));
    } catch {
      if (!isCancelled()) { setResult(null); setView('failed'); }
    } finally {
      if (!isCancelled()) setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    load(() => cancelled);
    return () => { cancelled = true; };
  }, [load]);

  const draft = async (review: Review) => {
    setBusyId(review.id);
    setError('');
    try {
      const res = await apiService.draftGoogleReviewReply({ reviewer: review.reviewer, rating: review.rating, text: review.text });
      setDrafts((prev) => ({ ...prev, [review.id]: res.reply }));
    } catch (e) {
      setError(customerMessage(e, 'A reply could not be drafted just now. Please try again.'));
    } finally {
      setBusyId(null);
    }
  };

  const copy = async (id: string) => {
    try {
      await navigator.clipboard.writeText(drafts[id] || '');
      setCopiedId(id);
      setTimeout(() => setCopiedId((current) => (current === id ? null : current)), 2000);
    } catch (_) {
      setError('Copying did not work in this browser. Select the text and copy it by hand.');
    }
  };

  if (loading) return <div className="nb-ix-card nb-ix-empty" role="status" aria-label="Loading"><Loader2 className="w-6 h-6 animate-spin motion-reduce:animate-none text-[var(--gv-accent-text)]" /></div>;

  if (view === 'not_connected') {
    return (
      <InboxNote
        title="Connect your Google Business Profile"
        text="Once your Google profile is connected, your reviews appear here with a reply drafted for each one, ready to copy into Google."
        art={<ReviewsArt />}
        marks={['google']}
        action={{ label: 'Connect an account', to: '/connect-socials' }}
      />
    );
  }

  if (view === 'failed') {
    return (
      <InboxNote
        role="alert"
        title="We could not load your reviews"
        text="Your Google profile is connected, but the reviews did not load just now. Please try again in a few minutes."
        art={<ReviewsArt />}
        action={{ label: 'Try again', onClick: () => load() }}
      />
    );
  }

  const reviews = result?.reviews || [];
  const summaryLine = reviewsSummaryLine(result?.summary);

  if (view === 'empty') {
    return (
      <section className="nb-ix-card nb-ix-welcome" aria-labelledby="nb-ix-rev-empty">
        <div className="nb-ix-welcome-lead">
          <span aria-hidden="true"><ReviewStarsArt /></span>
          <div>
            <h2 id="nb-ix-rev-empty">No Google reviews yet</h2>
            <p>When a customer reviews you on Google, the review shows up here with a reply drafted in your tone, ready to copy into Google.</p>
          </div>
        </div>
        <p className="nb-ix-muted">{REVIEWS_NOTE}</p>
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="nb-ix-card nb-ix-revhead">
        {summaryLine && <Stars rating={avgStars(result?.summary?.averageRating)} />}
        <div>
          {summaryLine && <strong>{summaryLine}</strong>}
          <p>{REVIEWS_NOTE} Nothing is posted to Google from here.</p>
        </div>
      </div>
      {error && <p role="alert" className="nb-ix-alert"><AlertCircle aria-hidden="true" />{error}</p>}
      <ul className="nb-ix-reviews" aria-label="Your Google reviews">
        {reviews.map((review) => (
          <li key={review.id} className="nb-ix-card nb-ix-review">
            <div className="nb-ix-review-who">
              <InboxAvatar name={review.reviewer} platform="gmb" />
              <div>
                <p className="nb-ix-review-name">
                  <span>{review.reviewer}</span>
                  <Stars rating={review.rating} />
                  {review.needsApproval && !review.replied && <span className="nb-ix-chip" data-tone="warn">Read before replying</span>}
                </p>
                {dateText(review.createdAt) && <p className="nb-ix-muted">{dateText(review.createdAt)}</p>}
                {review.text ? <p className="nb-ix-review-text">{review.text}</p> : <p className="nb-ix-muted">A rating without words.</p>}
              </div>
            </div>
            <div className="nb-ix-review-reply">
              {review.replied ? (
                <>
                  <span>Your reply on Google</span>
                  <p className="nb-ix-review-text">{review.existingReply}</p>
                </>
              ) : drafts[review.id] !== undefined ? (
                <>
                  <label htmlFor={`rev-${review.id}`}>Drafted reply (you can change it)</label>
                  <textarea
                    id={`rev-${review.id}`}
                    className="nb-ix-field"
                    value={drafts[review.id]}
                    onChange={(e) => setDrafts((prev) => ({ ...prev, [review.id]: e.target.value }))}
                    rows={4}
                  />
                  <div className="nb-ix-row-actions">
                    <button type="button" onClick={() => copy(review.id)} className="nb-ix-btn">
                      {copiedId === review.id ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                      {copiedId === review.id ? 'Copied' : 'Copy'}
                    </button>
                    <p className="nb-ix-muted">Paste it as your reply in Google.</p>
                  </div>
                </>
              ) : (
                <>
                  <span>No reply yet</span>
                  <p className="nb-ix-muted">Nebulaa drafts a reply in your tone for you to copy.</p>
                  <div className="nb-ix-row-actions">
                    <button type="button" onClick={() => draft(review)} disabled={busyId === review.id} className="nb-ix-btn2">
                      {busyId === review.id ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Sparkles aria-hidden="true" />}
                      Draft a reply
                    </button>
                  </div>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default ReviewsPanel;
