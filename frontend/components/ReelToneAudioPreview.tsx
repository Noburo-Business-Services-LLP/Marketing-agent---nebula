import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Play, Pause, AlertCircle, Loader2 } from 'lucide-react';

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export interface ReelToneAudioPreviewProps {
  src: string;
  toneLabel: string;
  isDarkMode: boolean;
}

export function ReelToneAudioPreview({ src, toneLabel, isDarkMode }: ReelToneAudioPreviewProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [buffering, setBuffering] = useState(true);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    setLoadError(null);
    setBuffering(true);
    setPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    el.src = src;
    el.load();
  }, [src]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;

    const syncDuration = () => {
      const d = el.duration;
      if (Number.isFinite(d) && d > 0) setDuration(d);
    };

    const onLoadedData = () => {
      setBuffering(false);
      syncDuration();
    };

    const onCanPlay = () => {
      setBuffering(false);
      syncDuration();
    };

    const onTimeUpdate = () => setCurrentTime(el.currentTime);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnded = () => {
      setPlaying(false);
      setCurrentTime(0);
    };
    const onWaiting = () => setBuffering(true);
    const onPlaying = () => setBuffering(false);

    const onError = () => {
      setBuffering(false);
      setLoadError(
        'Preview unavailable. Start the API server (port 5000) and ensure MP3s exist in backend/tone-audio/ (e.g. fun.mp3).'
      );
    };

    el.addEventListener('loadedmetadata', syncDuration);
    el.addEventListener('loadeddata', onLoadedData);
    el.addEventListener('canplay', onCanPlay);
    el.addEventListener('durationchange', syncDuration);
    el.addEventListener('timeupdate', onTimeUpdate);
    el.addEventListener('play', onPlay);
    el.addEventListener('pause', onPause);
    el.addEventListener('ended', onEnded);
    el.addEventListener('waiting', onWaiting);
    el.addEventListener('playing', onPlaying);
    el.addEventListener('error', onError);

    return () => {
      el.removeEventListener('loadedmetadata', syncDuration);
      el.removeEventListener('loadeddata', onLoadedData);
      el.removeEventListener('canplay', onCanPlay);
      el.removeEventListener('durationchange', syncDuration);
      el.removeEventListener('timeupdate', onTimeUpdate);
      el.removeEventListener('play', onPlay);
      el.removeEventListener('pause', onPause);
      el.removeEventListener('ended', onEnded);
      el.removeEventListener('waiting', onWaiting);
      el.removeEventListener('playing', onPlaying);
      el.removeEventListener('error', onError);
    };
  }, [src]);

  const toggle = useCallback(() => {
    const el = audioRef.current;
    if (!el || loadError) return;
    if (playing) {
      el.pause();
      return;
    }
    void el.play().catch(() => {
      setLoadError('Playback failed. Check the audio URL and try again.');
    });
  }, [playing, loadError]);

  const onSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const el = audioRef.current;
    if (!el || loadError) return;
    const t = parseFloat(e.target.value);
    if (!Number.isFinite(t)) return;
    el.currentTime = t;
    setCurrentTime(t);
  };

  const max = duration > 0 ? duration : 1;
  const disabled = !!loadError;
  const showInitialBusy = buffering && !loadError && duration === 0;

  const shell = isDarkMode
    ? 'border-slate-600/80 bg-[#0d1117] shadow-inner'
    : 'border-slate-200 bg-white shadow-sm';

  const labelMuted = isDarkMode ? 'text-slate-500' : 'text-slate-500';
  const timeText = isDarkMode ? 'text-slate-300' : 'text-slate-700';
  const rangeTrack = isDarkMode ? 'bg-slate-700' : 'bg-slate-200';

  return (
    <div
      className={`mt-3 rounded-xl border p-3 ${shell}`}
      style={{ colorScheme: isDarkMode ? 'dark' : 'light' }}
    >
      <audio ref={audioRef} preload="auto" className="hidden" />

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={toggle}
          disabled={disabled}
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border transition-colors disabled:opacity-40 ${
            isDarkMode
              ? 'border-[#ffcc29]/40 bg-[#161b22] text-[#ffcc29] hover:bg-[#ffcc29]/10'
              : 'border-[#ffcc29]/50 bg-[#fffbeb] text-[#b45309] hover:bg-[#ffcc29]/20'
          }`}
          aria-label={playing ? 'Pause preview' : 'Play preview'}
        >
          {showInitialBusy ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : playing ? (
            <Pause className="h-5 w-5" fill="currentColor" />
          ) : (
            <Play className="h-5 w-5 pl-0.5" fill="currentColor" />
          )}
        </button>

        <div className="min-w-0 flex-1 space-y-1.5">
          <div className={`flex items-center justify-between gap-2 text-[11px] ${labelMuted}`}>
            <span className="truncate capitalize">{toneLabel} preview</span>
            <span className={`font-mono tabular-nums ${timeText}`}>
              {formatTime(currentTime)} / {duration > 0 ? formatTime(duration) : '—:—'}
            </span>
          </div>

          <input
            type="range"
            min={0}
            max={max}
            step="any"
            value={Math.min(currentTime, max)}
            onChange={onSeek}
            disabled={disabled || duration <= 0}
            className={`h-1.5 w-full cursor-pointer appearance-none rounded-full ${rangeTrack} accent-[#ffcc29] disabled:cursor-not-allowed disabled:opacity-50 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#ffcc29]`}
            aria-label="Seek preview"
          />
        </div>
      </div>

      {loadError && (
        <div
          className={`mt-2 flex items-start gap-2 rounded-lg border px-2.5 py-2 text-xs ${
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
