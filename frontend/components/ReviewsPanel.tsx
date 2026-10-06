import React, { useEffect, useState } from 'react';
import { Loader2, Star, Sparkles, Copy, Check } from 'lucide-react';
import { apiService } from '../services/api';
import { useTheme, getThemeClasses } from '../context/ThemeContext';
import { customerMessage } from '../utils/errors';

type Review = Awaited<ReturnType<typeof apiService.getGoogleReviews>>['reviews'][number];

const Stars: React.FC<{ rating: number }> = ({ rating }) => (
  <span className="inline-flex" aria-label={`${rating} out of 5 stars`}>
    {[1, 2, 3, 4, 5].map((n) => (
      <Star key={n} className={`w-4 h-4 ${n <= rating ? 'text-[#F5A623] fill-[#F5A623]' : 'text-slate-300'}`} />
    ))}
  </span>
);

/** Google reviews with a suggested reply for each. Replies are copied into Google by the owner. */
const ReviewsPanel: React.FC = () => {
  const { isDarkMode } = useTheme();
  const theme = getThemeClasses(isDarkMode);
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

  if (loading) return <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-[#F5A623]" /></div>;

  if (!connected) {
    return (
      <div className={`rounded-2xl border p-8 text-center ${theme.bgCard} ${isDarkMode ? 'border-slate-700/50' : 'border-slate-200'}`}>
        <h2 className={`text-lg font-semibold ${theme.text}`}>Google reviews are not available yet</h2>
        <p className={`mt-1 text-sm ${theme.textSecondary}`}>
          {message || 'Once your Google Business Profile is connected, your reviews appear here with a suggested reply for each one.'}
        </p>
      </div>
    );
  }

  if (reviews.length === 0) {
    return <p className={`py-10 text-center text-sm ${theme.textSecondary}`}>You have no Google reviews yet.</p>;
  }

  return (
    <div className="space-y-3">
      {error && <p className="text-sm text-red-600">{error}</p>}
      {reviews.map((review) => (
        <div key={review.id} className={`rounded-xl border p-4 space-y-3 ${theme.bgCard} ${isDarkMode ? 'border-slate-700/50' : 'border-slate-200'}`}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className={`font-semibold ${theme.text}`}>{review.reviewer}</p>
              <Stars rating={review.rating} />
            </div>
            {review.replied
              ? <span className="text-xs font-semibold text-green-700">Replied</span>
              : review.needsApproval && <span className="text-xs font-semibold text-amber-700">Please read before replying</span>}
          </div>
          {review.text && <p className={`text-sm ${theme.text}`}>{review.text}</p>}
          {review.replied ? (
            <p className={`text-sm italic ${theme.textSecondary}`}>Your reply: {review.existingReply}</p>
          ) : drafts[review.id] !== undefined ? (
            <div className="space-y-2">
              <textarea
                value={drafts[review.id]}
                onChange={(e) => setDrafts((prev) => ({ ...prev, [review.id]: e.target.value }))}
                rows={4}
                className="w-full rounded-lg border border-slate-300 p-3 text-sm"
              />
              <div className="flex items-center gap-3">
                <button onClick={() => copy(review.id)} className="px-4 py-2 rounded-lg bg-[#F5A623] text-[#070A12] text-sm font-bold inline-flex items-center gap-2">
                  {copiedId === review.id ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  {copiedId === review.id ? 'Copied' : 'Copy reply'}
                </button>
                <span className={`text-xs ${theme.textSecondary}`}>Paste it as your reply in Google Business Profile.</span>
              </div>
            </div>
          ) : (
            <button onClick={() => draft(review)} disabled={busyId === review.id} className="px-4 py-2 rounded-lg border border-[#F5A623] text-[#F5A623] text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-50">
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
