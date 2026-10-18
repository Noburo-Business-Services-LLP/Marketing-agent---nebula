import React from 'react';

/**
 * Responsive grid for tiles: 1 column on phones (under 640 px), 2 up to 1024 px, then 3 or 4.
 * The columns rule lives in index.html (.nb-tile-grid). A `hero` tile spans two columns from 640 px.
 */
const TileGrid: React.FC<{ children: React.ReactNode; columns?: 3 | 4; label?: string; className?: string }> = ({ children, columns = 3, label, className }) => (
  <div
    className={`nb-tile-grid${className ? ` ${className}` : ''}`}
    style={{ ['--nb-cols' as string]: columns }}
    role={label ? 'group' : undefined}
    aria-label={label}
  >
    {children}
  </div>
);

export default TileGrid;
