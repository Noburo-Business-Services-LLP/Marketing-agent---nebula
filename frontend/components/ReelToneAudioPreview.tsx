import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, Loader2, Pause, Play } from 'lucide-react';

export interface ReelToneAudioPreviewProps {
  src: string;
  toneLabel: string;
  isDarkMode: boolean;
}

/**
 * Loads tone MP3s via same-origin `fetch` + blob URL. Using a direct
 * `http://127.0.0.1:5000/audio/...` src from `http://localhost:3000` fails in the browser
 * because Helmet sets `Cross-Origin-Resource-Policy: same-origin` on the API.
 * Relative `/audio/...` hits Vite's proxy in dev and Express in prod - no CORP issue.
 */
export function ReelToneAudioPreview({ src, toneLabel, isDarkMode }: ReelToneAudioPreviewProps) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isStartingPlayback, setIsStartingPlayback] = useState(false);

  const blobRef = useRef<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const formatTime = (seconds: number): string => {
    if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
    const total = Math.floor(seconds);
    const mins = Math.floor(total / 60);
    const secs = total % 60;
    return `${mins}:${String(secs).padStart(2, '0')}`;
  };

  useEffect(() => {
    const ac = new AbortController();

    if (blobRef.current) {
      URL.revokeObjectURL(blobRef.current);
      blobRef.current = null;
    }

    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }

    setObjectUrl(null);
    setLoadError(null);
    setLoading(true);
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setIsStartingPlayback(false);

    fetch(src, { signal: ac.signal })
      .then((res) => {
        if (!res.ok) throw new Error(String(res.status));
        return res.blob();
      })
      .then((blob) => {
        if (!blob.size) throw new Error('empty');
        if (ac.signal.aborted) return;
        const url = URL.createObjectURL(blob);
        blobRef.current = url;
        setObjectUrl(url);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (ac.signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) return;
        setLoadError(
          'Preview unavailable. Start the API server (port 5000) and ensure MP3s exist in backend/tone-audio/ (e.g. professional.mp3).'
        );
        setLoading(false);
      });

    return () => {
      ac.abort();
      if (audioRef.current) {
        audioRef.current.pause();
      }
      if (blobRef.current) {
        URL.revokeObjectURL(blobRef.current);
        blobRef.current = null;
      }
    };
  }, [src]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !objectUrl) return;

    const onLoadedMetadata = () => {
      const d = Number.isFinite(audio.duration) ? audio.duration : 0;
      setDuration(d);
      setLoadError(null);
    };

    const onTimeUpdate = () => setCurrentTime(audio.currentTime || 0);

    const onPlay = () => {
      setIsPlaying(true);
      setIsStartingPlayback(false);
    };

    const onPause = () => {
      setIsPlaying(false);
      setIsStartingPlayback(false);
    };

    const onEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
      audio.currentTime = 0;
    };

    const onError = () => {
      setIsPlaying(false);
      setIsStartingPlayback(false);
      setLoadError('Unable to play this tone preview.');
    };

    audio.addEventListener('loadedmetadata', onLoadedMetadata);
    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('error', onError);

    return () => {
      audio.removeEventListener('loadedmetadata', onLoadedMetadata);
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('error', onError);
    };
  }, [objectUrl]);

  const togglePlay = async () => {
    const audio = audioRef.current;
    if (!audio || !objectUrl || loading) return;

    if (isPlaying) {
      audio.pause();
      return;
    }

    try {
      setIsStartingPlayback(true);
      await audio.play();
    } catch {
      setIsStartingPlayback(false);
      setLoadError('Playback was blocked. Click play again after interacting with the page.');
    }
  };

  const onSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const audio = audioRef.current;
    if (!audio) return;
    const nextTime = Number(e.target.value);
    if (!Number.isFinite(nextTime)) return;
    audio.currentTime = nextTime;
    setCurrentTime(nextTime);
  };

  const shell = isDarkMode
    ? 'border-slate-700/50 bg-[#0d1117]'
    : 'border-slate-200 bg-white';

  const buttonTone = isDarkMode
    ? 'border-[#ffcc29]/40 bg-[#161b22] text-[#ffcc29] hover:bg-[#ffcc29]/10'
    : 'border-[#ffcc29]/50 bg-[#fffbeb] text-[#b45309] hover:bg-[#ffcc29]/20';

  const trackTone = isDarkMode ? 'bg-slate-700/70' : 'bg-slate-200';
  const textPrimary = isDarkMode ? 'text-slate-300' : 'text-slate-700';
  const textSecondary = isDarkMode ? 'text-slate-500' : 'text-slate-500';

  return (
    <div className={`mt-0 rounded-xl border p-3 ${shell}`} style={{ colorScheme: isDarkMode ? 'dark' : 'light' }}>
      <div className={`mb-2 flex items-center justify-between gap-2 text-[11px] ${textSecondary}`}>
        <span className="truncate capitalize">{toneLabel} preview</span>
        {loading && !loadError && (
          <span className="inline-flex items-center gap-1 text-[10px]">
            <Loader2 className="h-3 w-3 animate-spin" />
            Loading...
          </span>
        )}
      </div>

      {objectUrl && !loadError && (
        <div className="space-y-2">
          <audio ref={audioRef} src={objectUrl} preload="metadata" playsInline />

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={togglePlay}
              disabled={loading || !objectUrl}
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border transition-colors disabled:opacity-40 ${buttonTone}`}
              aria-label={isPlaying ? 'Pause preview' : 'Play preview'}
            >
              {isStartingPlayback ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : isPlaying ? (
                <Pause className="h-5 w-5" fill="currentColor" />
              ) : (
                <Play className="h-5 w-5 pl-0.5" fill="currentColor" />
              )}
            </button>

            <div className="min-w-0 flex-1 space-y-1.5">
              <div className={`flex items-center justify-between gap-2 text-[11px] ${textSecondary}`}>
                <span className={`truncate capitalize ${textPrimary}`}>{toneLabel} preview</span>
                <span className="font-mono tabular-nums">
                  {formatTime(currentTime)} / {duration > 0 ? formatTime(duration) : '--:--'}
                </span>
              </div>

              <input
                type="range"
                min={0}
                max={duration > 0 ? duration : 0}
                step="any"
                value={Math.min(currentTime, duration || 0)}
                onChange={onSeek}
                disabled={loading || duration <= 0}
                className={`h-1.5 w-full cursor-pointer appearance-none rounded-full ${trackTone} accent-[#ffcc29] disabled:cursor-not-allowed disabled:opacity-50 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#ffcc29]`}
                aria-label="Seek preview"
              />
            </div>
          </div>
        </div>
      )}

      {loadError && (
        <div
          className={`flex items-start gap-2 rounded-lg border px-2.5 py-2 text-xs ${
            isDarkMode
              ? 'border-amber-500/30 bg-amber-500/10 text-amber-100/90'
              : 'border-amber-200 bg-amber-50 text-amber-900'
          }`}
        >
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{loadError}</span>
        </div>
      )}
    </div>
  );
}
