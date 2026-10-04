import React from 'react';
import { Languages, PlayCircle } from 'lucide-react';
import { GUIDE_LANGS, GUIDE_STEPS, GUIDE_VIDEOS } from './guideData';
import { useOnboardingLang } from './useOnboardingLang';

/**
 * Sits above the form on every step: what to do here, in the owner's own
 * language. If a video guide has been added for the step and language, the
 * video shows instead of the lines.
 */
export const StepGuide: React.FC<{ step: number }> = ({ step }) => {
  // The same choice drives the questions below, so it lives in one shared place.
  const { lang, t, setLang: choose } = useOnboardingLang();

  const guide = GUIDE_STEPS[step];
  if (!guide) return null;
  const video = GUIDE_VIDEOS[step]?.[lang];

  return (
    <div className="rounded-2xl border border-[#E5D8BF] bg-[#FFF7EA] p-5 mb-5">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <p className="flex items-center gap-2 text-[13px] font-bold text-[#14203A]">
          <PlayCircle className="w-4 h-4 text-[#EE6330]" /> {guide.title[lang]}
        </p>
        <div className="flex items-center gap-1.5" role="group" aria-label={t.languageSwitcher}>
          <Languages className="w-4 h-4 text-[#6D6250] hidden sm:block" aria-hidden="true" />
          {GUIDE_LANGS.map(l => (
            <button
              key={l.id}
              type="button"
              lang={l.id}
              aria-pressed={lang === l.id}
              onClick={() => choose(l.id)}
              className={`px-2.5 py-1 rounded-full text-[12px] font-semibold border transition-colors ${
                lang === l.id ? 'bg-[#14203A] text-white border-[#14203A]' : 'bg-white text-[#33405C] border-[#D4C4A4] hover:border-[#14203A]'
              }`}
            >
              {l.label}
            </button>
          ))}
        </div>
      </div>

      {video ? (
        <video key={video} src={video} controls playsInline preload="metadata" className="w-full rounded-xl aspect-video bg-black" />
      ) : (
        <ol className="space-y-2">
          {guide.lines[lang].map((line, n) => (
            <li key={n} className="flex gap-3 text-[14.5px] leading-[1.5] text-[#33405C]">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-[#14203A] text-white text-[12px] font-bold flex items-center justify-center">{n + 1}</span>
              <span>{line}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
};

export default StepGuide;
