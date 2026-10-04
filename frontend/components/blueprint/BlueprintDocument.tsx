import React from 'react';
import { GravityPanel } from '../gravity';
import { BLUEPRINT_COPY } from '../../constants/blueprintCopy';
import type { BlueprintView } from '../../utils/blueprint';

/** Placeholder for the finished document (the printable page replaces it in the next task). */
const BlueprintDocument: React.FC<{ view: BlueprintView }> = ({ view }) => (
  <GravityPanel padding="p-6" contentClassName="space-y-2">
    <h2 className="text-[20px] font-semibold text-[var(--gv-text-primary)]">{BLUEPRINT_COPY.view.readyTitle}</h2>
    <p className="text-[14px] text-[var(--gv-text-secondary)]">
      {view.businessName ? `${view.businessName}. ` : ''}{BLUEPRINT_COPY.view.readyBody}
    </p>
  </GravityPanel>
);

export default BlueprintDocument;
