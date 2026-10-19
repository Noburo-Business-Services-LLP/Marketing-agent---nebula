import React, { useEffect, useState } from 'react';
import { avatarView } from '../utils/competitorsHome';

/**
 * A competitor's round picture: our own stored copy of their public profile picture (never Instagram's link), loaded
 * lazily, or their initials on a soft colour that stays the same for a handle. A picture that fails to load falls back
 * to the initials. Styles: .nb-cav in CompetitorTiles.css.
 */
const CompetitorAvatar: React.FC<{ name: string; handle?: string | null; url?: string | null; size?: number }> = ({ name, handle, url, size = 40 }) => {
  const v = avatarView(name, handle, url);
  const [broken, setBroken] = useState(false);
  useEffect(() => { setBroken(false); }, [v.src]);
  if (v.src && !broken) {
    return <img className="nb-cav" src={v.src} alt={v.alt} width={size} height={size} style={{ width: size, height: size }} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setBroken(true)} />;
  }
  return (
    <span className="nb-cav" data-tone={v.tone} role="img" aria-label={v.alt} style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}>
      <span aria-hidden="true">{v.initials}</span>
    </span>
  );
};

export default CompetitorAvatar;
