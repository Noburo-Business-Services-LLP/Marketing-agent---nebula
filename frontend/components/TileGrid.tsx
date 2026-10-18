import React from 'react';

/**
 * Responsive grid for tiles: 1 column on phones (under 640 px), 2 up to 1024 px, then 3 or 4.
 * The columns rule lives in index.html (.nb-tile-grid). A `hero` tile spans two columns from 640 px.
 * On a phone, `phone="row"` shows each tile as a row (picture left, text right) so a choice of several tiles stays short.
 */
const TileGrid: React.FC<{ children: React.ReactNode; columns?: 3 | 4; label?: string; className?: string; phone?: 'stack' | 'row' }> = ({ children, columns = 3, label, className, phone = 'stack' }) => (
  <div
    className={`nb-tile-grid${className ? ` ${className}` : ''}`}
    data-phone={phone}
    style={{ ['--nb-cols' as string]: columns }}
    role={label ? 'group' : undefined}
    aria-label={label}
  >
    {children}
  </div>
);

export default TileGrid;
