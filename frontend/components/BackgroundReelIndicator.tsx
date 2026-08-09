import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Film, X, CheckCircle2, AlertTriangle } from 'lucide-react';
import { videoGenerationAPI } from '../services/api';
import {
  BackgroundReel,
  readBackgroundReel,
  onBackgroundReelChange,
  updateBackgroundReel,
  clearBackgroundReel
} from '../utils/backgroundReel';

/**
 * Floating pill shown while a Smart Calendar reel renders in the background.
 *
 * The render itself runs on the server queue, so leaving the wizard doesn't
 * stop it. This polls job status from wherever the user happens to be and
 * offers a way back in.
 */
const BackgroundReelIndicator: React.FC = () => {
  const [reel, setReel] = useState<BackgroundReel | null>(() => readBackgroundReel());
  const navigate = useNavigate();

  useEffect(() => onBackgroundReelChange(setReel), []);

  // Poll while the job is live. Deliberately slower than the wizard's own
  // poll — this is an ambient indicator, not the primary view.
  useEffect(() => {
    if (!reel?.jobId || reel.status === 'completed' || reel.status === 'failed') return;

    let cancelled = false;
    const tick = async () => {
      try {
        const job: any = await videoGenerationAPI.getJobStatus(reel.jobId);
        if (cancelled || !job) return;
        const status = String(job.status || '').toLowerCase();
        updateBackgroundReel({
          progress: Number(job.progress) || 0,
          step: String(job.currentStep || job.step || ''),
          status: status === 'completed' ? 'completed' : status === 'failed' ? 'failed' : 'running'
        });
      } catch {
        // Transient network/auth blips shouldn't kill the indicator.
      }
    };

    tick();
    const timer = setInterval(tick, 8000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [reel?.jobId, reel?.status]);

  if (!reel) return null;

  const done = reel.status === 'completed';
  const failed = reel.status === 'failed';
  const pct = Math.max(0, Math.min(100, Math.round(reel.progress || 0)));

  return (
    <div className="fixed bottom-5 right-5 z-[60] w-[300px] rounded-xl border border-slate-700 bg-[#0d1117] shadow-2xl overflow-hidden">
      <div className="flex items-start gap-3 p-3">
        <div className="mt-0.5">
          {done ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-400" />
          ) : failed ? (
            <AlertTriangle className="w-5 h-5 text-red-400" />
          ) : (
            <Loader2 className="w-5 h-5 text-[#ffcc29] animate-spin" />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-[12px] font-semibold text-white leading-tight">
            {done ? 'Reel ready' : failed ? 'Reel generation failed' : 'Generating reel in the background'}
          </p>
          <p className="text-[11px] text-slate-400 truncate mt-0.5" title={reel.headline}>
            Day {reel.day} · {reel.headline || 'Smart Calendar reel'}
          </p>
          {!done && !failed && (
            <p className="text-[10px] uppercase tracking-wide text-slate-500 mt-1">
              {reel.step || 'queued'} · {pct}%
            </p>
          )}

          <button
            type="button"
            onClick={() => {
              navigate(`/reels?jobId=${encodeURIComponent(reel.jobId)}`);
              if (done || failed) clearBackgroundReel();
            }}
            className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-[#ffcc29] text-black hover:bg-[#e6b825] transition"
          >
            <Film className="w-3 h-3" />
            {done ? 'View reel' : 'Open wizard'}
          </button>
        </div>

        <button
          type="button"
          onClick={clearBackgroundReel}
          title={done || failed ? 'Dismiss' : 'Hide (the render keeps running)'}
          className="text-slate-500 hover:text-white transition"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {!done && !failed && (
        <div className="h-1 bg-slate-800">
          <div className="h-full bg-[#ffcc29] transition-all duration-500" style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
};

export default BackgroundReelIndicator;
