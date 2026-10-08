import React from 'react';
import { frameSharePercent } from '../utils/postDesign';

const POSITION_CLASS: Record<string, string> = {
  'top-left': 'top-2 left-2', 'top-center': 'top-2 left-1/2 -translate-x-1/2', 'top-right': 'top-2 right-2',
  'bottom-left': 'bottom-2 left-2', 'bottom-center': 'bottom-2 left-1/2 -translate-x-1/2', 'bottom-right': 'bottom-2 right-2',
  center: 'top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2',
};
const ASPECT_CSS: Record<string, string> = { '1:1': '1 / 1', '4:5': '4 / 5', '9:16': '9 / 16', '16:9': '16 / 9', '3:4': '3 / 4' };

/**
 * A small mock of a post showing where the header, footer and logo will sit. The picture behind is a neutral
 * placeholder; the header, footer and logo are the real saved images, so changes show at once.
 */
const PostPreview: React.FC<{ aspect: string; headerUrl?: string; footerUrl?: string; logoUrl?: string; logoPosition?: string; className?: string }> = ({
  aspect, headerUrl, footerUrl, logoUrl, logoPosition = 'bottom-right', className = '',
}) => (
  <div className={`relative overflow-hidden rounded-lg border border-[var(--gv-border-default)] bg-gradient-to-br from-[#e9dcc4] to-[#cdb892] ${className}`} style={{ aspectRatio: ASPECT_CSS[aspect] || '4 / 5' }} aria-label="Preview of where the header, footer and logo go">
    <span className="absolute inset-0 flex items-center justify-center text-[11px] font-semibold uppercase tracking-[0.14em] text-black/25">Your post</span>
    {headerUrl && <img src={headerUrl} alt="Header" className="absolute top-0 left-0 w-full object-cover" style={{ height: `${frameSharePercent('header', aspect)}%` }} />}
    {footerUrl && <img src={footerUrl} alt="Footer" className="absolute bottom-0 left-0 w-full object-cover" style={{ height: `${frameSharePercent('footer', aspect)}%` }} />}
    {logoUrl && <img src={logoUrl} alt="Logo" className={`absolute w-[16%] max-h-[14%] object-contain ${POSITION_CLASS[logoPosition] || POSITION_CLASS['bottom-right']}`} />}
  </div>
);

export default PostPreview;
