import React, { useEffect, useState } from 'react';
import ImageGeneration from './ui/image-generation';
import GenerationTimer from './GenerationTimer';

const PHASES = ['Reading your brief', 'Composing the frame', 'Painting it', 'Finishing touches'];

/**
 * Fills a post card's image area while its artwork renders. Sits exactly
 * where the finished image will appear, so the card never changes shape —
 * the animation is simply replaced by the poster when it lands.
 *
 * Pure CSS (see the `ig-*` rules in index.html). No WebGL, no runtime
 * dependency, nothing extra to download, and it degrades gracefully under
 * prefers-reduced-motion.
 */
const GeneratingFill: React.FC<{ label?: string; prompt?: string; resolution?: string }> = ({
  label,
  prompt,
  resolution
}) => {
  const [phase, setPhase] = useState(0);

  // Rotate the copy so a long render does not look stalled.
  useEffect(() => {
    if (label) return;
    const t = setInterval(() => setPhase((p) => (p + 1) % PHASES.length), 3200);
    return () => clearInterval(t);
  }, [label]);

  return (
    <div className="relative w-full h-full">
      <ImageGeneration
        label={label || PHASES[phase]}
        prompt={prompt || ''}
        resolution={resolution || ''}
      />
      <div className="absolute inset-x-3 bottom-2 pointer-events-none">
        <GenerationTimer minSeconds={20} maxSeconds={60} />
      </div>
    </div>
  );
};

export default GeneratingFill;
