import React from 'react';
import { Link } from 'react-router-dom';
import { buildCostList, FREE_LINES, quarksText } from '../constants/quarks';
import { useQuarkPricing } from '../hooks/useQuarkCosts';
import './quarkCostList.css';

/**
 * Settings > Billing: what every paid action costs, in plain words and Quarks only, grouped by what the customer
 * does. Every number comes from the server (GET /api/credits costs and pricing) through constants/quarks.ts.
 * Tiles in one row share a height (symmetry rule, docs/superpowers/ops/tile-system.md); a small coloured dot marks
 * each group, no emoji.
 */
const QuarkCostList: React.FC = () => {
  const { costs, pricing } = useQuarkPricing();
  const groups = buildCostList(costs, pricing);
  return (
    <section className="nb-qc" aria-labelledby="nb-qc-title">
      <div className="nb-qc-head">
        <h3 id="nb-qc-title" className="nb-qc-title">What things cost</h3>
        <p className="nb-qc-lead">Prices in Quarks. The price is also shown before you make anything, and your balance is at the top of every page.</p>
      </div>
      {groups.length === 0 ? (
        <p className="nb-qc-lead" role="status">The prices could not be loaded just now. Please open this page again in a moment.</p>
      ) : (
        <ul className="nb-qc-grid">
          {groups.map((g) => (
            <li key={g.id} className="nb-qc-tile" data-group={g.id}>
              <p className="nb-qc-group"><span className="nb-qc-dot" style={{ background: g.accent }} aria-hidden="true" />{g.title}</p>
              <p className="nb-qc-blurb">{g.blurb}</p>
              <dl className="nb-qc-rows">
                {g.rows.map((r) => (
                  <div key={r.label} className="nb-qc-row">
                    <dt><span className="nb-qc-label">{r.label}</span><span className="nb-qc-detail">{r.detail}</span></dt>
                    <dd className="nb-qc-price">{quarksText(r.quarks)}</dd>
                  </div>
                ))}
              </dl>
              {g.note && <p className="nb-qc-note">{g.note}</p>}
            </li>
          ))}
          <li className="nb-qc-tile nb-qc-free" data-group="free">
            <p className="nb-qc-group"><span className="nb-qc-dot" style={{ background: '#3E8B5A' }} aria-hidden="true" />Free of Quarks</p>
            <ul className="nb-qc-freelist">
              {FREE_LINES.map((line) => <li key={line}>{line}</li>)}
            </ul>
            <p className="nb-qc-note">On the Starter and Growth plans, posting to your accounts and the Inbox are add-ons that renew monthly, not paid in Quarks. The Agency plan includes them.{' '}<Link to="/trial-expired" className="nb-qc-link">See plans and add-ons</Link></p>
          </li>
        </ul>
      )}
    </section>
  );
};

export default QuarkCostList;
