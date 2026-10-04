import React from 'react';
import { useNavigate } from 'react-router-dom';
import { UpgradeReason, upgradeMessage } from '../utils/plans';

interface UpgradePromptProps {
  reason: UpgradeReason;
  /** An entitlement name such as 'inbox' or 'competitors'; names the feature in the message. */
  feature?: string;
  className?: string;
}

/** The plain upgrade message with one button to the plans page. */
const UpgradePrompt: React.FC<UpgradePromptProps> = ({ reason, feature, className = '' }) => {
  const navigate = useNavigate();
  return (
    <div role="status" className={`rounded-xl border border-[#ffcc29]/40 bg-[#ffcc29]/10 p-4 flex flex-col sm:flex-row sm:items-center gap-3 ${className}`}>
      <p className="flex-1 text-sm leading-relaxed">{upgradeMessage(reason, feature)}</p>
      <button
        type="button"
        onClick={() => navigate('/trial-expired')}
        className="shrink-0 px-4 py-2 rounded-lg bg-[#ffcc29] text-[#070A12] text-sm font-semibold hover:bg-[#e6b825] transition-colors"
      >
        View plans and Quarks
      </button>
    </div>
  );
};

export default UpgradePrompt;
