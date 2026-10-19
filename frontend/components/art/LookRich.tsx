import React from 'react';

/** Create content, Look: Rich. A festive, full post: warm colour, bunting, a framed picture, sparkles, a bold headline. Decorative. */
export const LookRichArt: React.FC = () => (
  <svg viewBox="0 0 40 48" width="40" height="48" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id="nb-look-rich" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#F27A3D" />
        <stop offset="1" stopColor="#B8325A" />
      </linearGradient>
    </defs>
    <rect x=".5" y=".5" width="39" height="47" rx="4" fill="url(#nb-look-rich)" />
    <path d="M2 4h36" stroke="#FFF3D6" strokeWidth=".6" />
    <path d="M4 4l3 4 3-4zM12 4l3 4 3-4zM20 4l3 4 3-4zM28 4l3 4 3-4z" fill="#FFD27A" />
    <path d="M8 4l3 4 3-4zM24 4l3 4 3-4z" fill="#3E8B5A" />
    <circle cx="20" cy="20" r="8" fill="#FFD27A" stroke="#FFF3D6" strokeWidth="1.2" />
    <circle cx="20" cy="20" r="4" fill="#EE6330" />
    <path transform="translate(7 17)" d="M0-3 .8-.8 3 0 .8.8 0 3-.8.8-3 0-.8-.8z" fill="#FFF3D6" />
    <path transform="translate(33 24)" d="M0-3 .8-.8 3 0 .8.8 0 3-.8.8-3 0-.8-.8z" fill="#FFF3D6" />
    <circle cx="9" cy="28" r="1" fill="#FFD27A" />
    <circle cx="31" cy="12" r="1" fill="#3E8B5A" />
    <circle cx="34" cy="31" r="1" fill="#FFD27A" />
    <rect x="6" y="32" width="28" height="4" rx="2" fill="#FFF8EC" />
    <rect x="10" y="38.5" width="20" height="2" rx="1" fill="#FFF8EC" opacity=".75" />
    <rect x="3" y="43" width="34" height="2" rx="1" fill="#FFD27A" />
  </svg>
);
