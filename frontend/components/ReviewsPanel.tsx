import React, { useEffect, useState } from 'react';
import { Loader2, Star, Sparkles, Copy, Check } from 'lucide-react';
import { apiService } from '../services/api';
import { customerMessage } from '../utils/errors';
import { REVIEWS_NOTE } from '../utils/inbox';
import { BTN, BTN_MAIN, CARD, ERROR_TEXT, FIELD, MUTED, TEXT } from './inboxStyles';

type Review = Awaited<ReturnType<typeof apiService.getGoogleReviews>>['reviews'][number];

const Stars: React.FC<{ rating: number }> = ({ rating }) => (
  <span className="inline-flex" aria-label={`${rating} out of 5 stars`}>
    {[1, 2, 3, 4, 5].map((n) => (
      <Star key={n} className={`w-4 h-4 ${n <= rating ? 'text-[var(--gv-accent)] fill-[var(--gv-accent)]' : 'text-[var(--gv-border-default)]'}`} />
    ))}
  </span>
);

/** Google reviews with a suggested reply for each. Replies are copied into Google by the owner. */
const ReviewsPanel: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [message, setMessage] = useState('');
  const [reviews, setReviews] = useState<Review[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    apiService.getGoogleReviews()
      .then((res) => {
        if (cancelled) return;
        setConnected(res.connected);
        setReviews(res.reviews || []);
        setMessage(res.message || '');
      })
      .catch((e) => { if (!cancelled) setMessage(customerMessage(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const draft = async (review: Review) => {
    setBusyId(review.id);
    setError('');
    try {
      const res = await apiService.draftGoogleReviewReply({ reviewer: review.reviewer, rating: review.rating, text: review.text });
      setDrafts((prev) => ({ ...prev, [review.id]: res.reply }));
    } catch (e) {
      setError(customerMessage(e));
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

  if (loading) return <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin motion-reduce:animate-none text-[var(--gv-accent-text)]" /></div>;

  if (!connected) {
    return (
      <div className={`${CARD} p-8 text-center`}>
        <h2 className={`text-lg font-semibold ${TEXT}`}>Google reviews are not available yet</h2>
        <p className={`mt-1 text-sm ${MUTED}`}>
          {message || 'Once your Google Business Profile is connected, your reviews appear here with a suggested reply for each one.'}
        </p>
      </div>
    );
  }

  if (reviews.length === 0) {
    return <div><p className={`text-sm ${MUTED}`}>{REVIEWS_NOTE}</p><p className={`py-10 text-center text-sm ${MUTED}`}>You have no Google reviews yet.</p></div>;
  }

  return (
    <div className="space-y-3">
      <p className={`text-sm ${MUTED}`}>{REVIEWS_NOTE}</p>
      {error && <p role="alert" className={`text-sm ${ERROR_TEXT}`}>{error}</p>}
      {reviews.map((review) => (
        <div key={review.id} className={`${CARD} p-4 space-y-3`}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className={`font-semibold ${TEXT}`}>{review.reviewer}</p>
              <Stars rating={review.rating} />
            </div>
            {review.replied
              ? <span className="text-xs font-semibold text-[var(--gv-text-secondary)]">Replied</span>
              : review.needsApproval && <span className="text-xs font-semibold text-[var(--gv-accent-text)]">Please read before replying</span>}
          </div>
          {review.text && <p className={`text-sm ${TEXT}`}>{review.text}</p>}
          {review.replied ? (
            <p className={`text-sm italic ${MUTED}`}>Your reply: {review.existingReply}</p>
          ) : drafts[review.id] !== undefined ? (
            <div className="space-y-2">
              <textarea
                value={drafts[review.id]}
                onChange={(e) => setDrafts((prev) => ({ ...prev, [review.id]: e.target.value }))}
                rows={4}
                aria-label="Drafted reply" className={FIELD}
              />
              <div className="flex items-center gap-3">
                <button onClick={() => copy(review.id)} className={BTN_MAIN}>
                  {copiedId === review.id ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  {copiedId === review.id ? 'Copied' : 'Copy'}
                </button>
                <span className={`text-xs ${MUTED}`}>Paste it as your reply in Google Business Profile.</span>
              </div>
            </div>
          ) : (
            <button onClick={() => draft(review)} disabled={busyId === review.id} className={BTN}>
              {busyId === review.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              Suggest a reply
            </button>
          )}
        </div>
      ))}
    </div>
  );
};

export default ReviewsPanel;
