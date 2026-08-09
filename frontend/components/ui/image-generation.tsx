/**
 * Pure-CSS "generating image" placeholder — a faint dot matrix with a bright
 * cluster drifting through it.
 *
 * Styles live in the global <style> block in index.html (this project loads
 * Tailwind from the CDN, so there is no index.css / tailwind.config to
 * extend). Look for the `ig-*` keyframes and `.ig*` classes there.
 */
export function ImageGeneration({
  prompt = "a calm mountain lake at dawn",
  resolution = "1024 × 1024",
  label = "Generating image",
}: {
  prompt?: string;
  resolution?: string;
  label?: string;
}) {
  return (
    <div className="igWrap">
      <div className="igCanvas" role="img" aria-label={label}>
        <span className="igDots" aria-hidden />
        <span className="igGlow" aria-hidden />
        {resolution ? <span className="igRes">{resolution}</span> : null}
      </div>
      <div className="igMeta">
        <span className="igLabel">{label}</span>
        {prompt ? <span className="igPrompt">“{prompt}”</span> : null}
      </div>
    </div>
  );
}

export default ImageGeneration;
