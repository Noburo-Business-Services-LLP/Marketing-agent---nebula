import React, { useEffect, useState } from 'react';
import { SHOWCASE_SLIDES } from './showcaseData';

const SLIDE_MS = 4200;

function useSlideIndex(count: number): [number, (n: number) => void] {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (count < 2) return;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduced) return;
    const t = setInterval(() => setI(n => (n + 1) % count), SLIDE_MS);
    return () => clearInterval(t);
  }, [count]);
  return [i, setI];
}

/**
 * Posts made for different kinds of business, cycling beside the sign-up steps.
 * On a wide screen it is a tall panel down the left; on a phone it is a short
 * banner above the steps. Every picture is shown whole, over a blurred copy of
 * itself, so no text in a post is ever cut off.
 */
export const ShowcasePanel: React.FC = () => {
  const [i, setI] = useSlideIndex(SHOWCASE_SLIDES.length);
  const current = SHOWCASE_SLIDES[i];

  return (
    <aside
      className="hidden lg:block relative lg:w-[38%] xl:w-[40%] flex-shrink-0 h-screen sticky top-0 overflow-hidden"
      style={{ background: '#14203A' }}
      aria-label="Posts made with Nebulaa"
    >
      {SHOWCASE_SLIDES.map((s, n) => (
        <div
          key={s.src}
          className={`absolute inset-0 transition-opacity duration-1000 ${n === i ? 'opacity-100' : 'opacity-0'}`}
          aria-hidden={n !== i}
        >
          <img
            src={s.src}
            alt=""
            loading={n < 2 ? 'eager' : 'lazy'}
            className="absolute inset-0 h-full w-full scale-125 object-cover blur-2xl opacity-60"
          />
          <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, rgba(20,32,58,0.78) 0%, rgba(20,32,58,0.35) 40%, rgba(20,32,58,0.8) 100%)' }} />
          <div className="absolute inset-0 flex items-center justify-center px-[9%]">
            <img
              src={s.src}
              alt={`A ${s.label.toLowerCase()} post made with Nebulaa`}
              loading={n < 2 ? 'eager' : 'lazy'}
              className="w-full max-h-[60vh] aspect-square object-contain rounded-[22px] shadow-[0_24px_60px_rgba(0,0,0,0.45)] border border-white/20"
            />
          </div>
        </div>
      ))}

      <div className="absolute top-0 inset-x-0 px-10 pt-12 text-white">
        <p className="text-[12px] font-bold uppercase tracking-[0.18em] text-[#FFCB2E] mb-3">Made with Nebulaa</p>
        <h2 style={{ fontFamily: "'Archivo', 'Arial Narrow', Arial, sans-serif", fontWeight: 800, textTransform: 'uppercase', lineHeight: 1.05 }} className="text-[30px] xl:text-[36px]">
          Posts like these,
          <br />
          <span style={{ fontFamily: "'Kaushan Script', cursive", textTransform: 'none', fontWeight: 400, color: '#FFCB2E' }} className="text-[1.15em]">for your business.</span>
        </h2>
      </div>

      <div className="absolute bottom-0 inset-x-0 px-10 pb-10 flex items-center justify-between gap-4 text-white">
        <span className="inline-flex items-center whitespace-nowrap rounded-full bg-white/15 backdrop-blur px-4 py-2 text-[13.5px] font-semibold border border-white/20">
          {current.label}
        </span>
        <div className="flex gap-1.5" role="tablist" aria-label="Choose a post">
          {SHOWCASE_SLIDES.map((s, n) => (
            <button
              key={s.src}
              onClick={() => setI(n)}
              aria-label={`Show post ${n + 1}`}
              className={`h-1.5 rounded-full transition-all ${n === i ? 'w-5 bg-[#FFCB2E]' : 'w-1.5 bg-white/40'}`}
            />
          ))}
        </div>
      </div>
    </aside>
  );
};

/** The same pictures as a short banner, for phones and tablets. */
export const ShowcaseBanner: React.FC = () => {
  const [i] = useSlideIndex(SHOWCASE_SLIDES.length);
  const current = SHOWCASE_SLIDES[i];
  return (
    <div className="lg:hidden relative h-[150px] w-full overflow-hidden rounded-2xl mb-5" style={{ background: '#14203A' }}>
      {SHOWCASE_SLIDES.map((s, n) => (
        <div key={s.src} className={`absolute inset-0 transition-opacity duration-1000 ${n === i ? 'opacity-100' : 'opacity-0'}`} aria-hidden={n !== i}>
          <img src={s.src} alt="" loading={n < 2 ? 'eager' : 'lazy'} className="absolute inset-0 h-full w-full scale-125 object-cover blur-xl opacity-60" />
          <div className="absolute inset-0" style={{ background: 'rgba(20,32,58,0.45)' }} />
          <div className="absolute inset-0 flex items-center justify-center">
            <img src={s.src} alt={`A ${s.label.toLowerCase()} post made with Nebulaa`} loading={n < 2 ? 'eager' : 'lazy'} className="h-[126px] w-[126px] object-contain rounded-xl shadow-lg border border-white/25" />
          </div>
        </div>
      ))}
      <span className="absolute left-3 bottom-2.5 rounded-full bg-white/15 backdrop-blur px-3 py-1 text-[11.5px] font-semibold text-white border border-white/20">
        Made with Nebulaa · {current.label}
      </span>
    </div>
  );
};

export default ShowcasePanel;
