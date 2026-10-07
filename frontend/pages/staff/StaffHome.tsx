import React from 'react';

/** Step 1: a short welcome. Health, attention needed and growth arrive in the Home release. */
const StaffHome: React.FC<{ role: 'owner' | 'admin' | 'csm' }> = ({ role }) => (
  <div className="rounded-2xl border border-[var(--gv-border-subtle)] bg-[var(--gv-panel)] p-6">
    <p className="text-[var(--gv-text-primary)]">
      {role === 'csm'
        ? 'This is your staff area. Your clients are listed under Clients once that release is out. Until then, use My clients in the main menu.'
        : 'This is the Nebulaa staff area. Health, clients that need attention and growth numbers appear here in the next releases.'}
    </p>
  </div>
);

export default StaffHome;
