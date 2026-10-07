import React from 'react';
import { Instagram, Facebook, Linkedin, Youtube } from 'lucide-react';

/** Brand marks for every network, so no picker falls back to a generic icon. */
const PlatformIcon: React.FC<{ platform: string; className?: string }> = ({ platform, className = 'w-4 h-4' }) => {
  const key = String(platform || '').toLowerCase().trim();
  switch (key) {
    case 'instagram': return <Instagram className={className} />;
    case 'facebook': return <Facebook className={className} />;
    case 'linkedin': return <Linkedin className={className} />;
    case 'youtube': return <Youtube className={className} />;
    case 'x':
    case 'twitter':
      return (
        <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-label="X">
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
        </svg>
      );
    case 'gmb':
    case 'google':
      return (
        <span className={`inline-flex items-center justify-center rounded-sm bg-[#4285F4] text-white font-bold leading-none ${className}`} style={{ fontSize: '0.7em' }} aria-label="Google Business">G</span>
      );
    default:
      return <span className={`inline-flex items-center justify-center font-bold ${className}`}>{key.charAt(0).toUpperCase() || '?'}</span>;
  }
};

export default PlatformIcon;
