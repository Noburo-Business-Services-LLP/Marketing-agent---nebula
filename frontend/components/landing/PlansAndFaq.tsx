import React from 'react';
import { CheckCircle2, ChevronDown } from 'lucide-react';
import { FAQ_COPY, INBOX_LINES_VISIBLE, PLANS_COPY, faqItems } from '../../constants/landingCopy';
import { PLAN_ORDER, bestValueId, planOf, rupees, type LandingFacts } from '../../utils/landingPlans';
import { SectionHead } from './LandingBits';

/** Plans: three cards in the order Starter, Growth, Agency. Every figure comes from the plans answer (or its checked snapshot). */
export const PlansSection: React.FC<{ facts: LandingFacts; onChoose: () => void }> = ({ facts, onChoose }) => {
  const best = bestValueId(facts);
  return (
    <section className="nb-land-section nb-land-plans-section" id="plans" aria-labelledby="plans-title">
      <div className="nb-land-wrap">
        <SectionHead id="plans-title" eyebrow={PLANS_COPY.eyebrow} title={PLANS_COPY.title} emphasis={PLANS_COPY.emphasis(facts)} line={PLANS_COPY.line} />
        <ul className="nb-land-plans">
          {PLAN_ORDER.map((id) => {
            const p = planOf(facts, id);
            const isBest = id === best;
            const lines = id === 'agency' ? [...p.features, PLANS_COPY.extraClient(facts)] : p.features;
            return (
              <li key={id} className="nb-land-plan" data-best={isBest ? '' : undefined} data-plan={id}>
                <p className="nb-land-plan-name">{p.name}{isBest && <span className="nb-land-plan-best">{PLANS_COPY.bestValue}</span>}</p>
                <p className="nb-land-plan-price"><b>{rupees(p.inr)}</b><span>{PLANS_COPY.perMonth}</span></p>
                <p className="nb-land-plan-desc">{p.description}</p>
                <ul>
                  {lines.map((f) => <li key={f}><CheckCircle2 size={16} aria-hidden="true" /><span>{f}</span></li>)}
                </ul>
                <button type="button" className="nb-land-btn" data-kind={isBest ? 'gold' : 'outline'} data-full="" onClick={onChoose}>{PLANS_COPY.choose(p.name)}</button>
              </li>
            );
          })}
        </ul>
        <div className="nb-land-plan-foot">
          <p>{PLANS_COPY.addons(facts)}</p>
          <p>{PLANS_COPY.topup}</p>
        </div>
      </div>
    </section>
  );
};

/** Eight questions in two even columns of four on a desktop; native details, so it works without script. */
export const FaqSection: React.FC<{ facts: LandingFacts }> = ({ facts }) => {
  const items = faqItems(facts);
  const half = Math.ceil(items.length / 2);
  const cols = [items.slice(0, half), items.slice(half)];
  return (
    <section className="nb-land-section" id="faq" aria-labelledby="faq-title" style={{ paddingTop: 0 }}>
      <div className="nb-land-wrap">
        <SectionHead id="faq-title" eyebrow={FAQ_COPY.eyebrow} title={FAQ_COPY.title} emphasis={FAQ_COPY.emphasis} center />
        <div className="nb-land-faq">
          {cols.map((col, c) => (
            <div key={c} className="nb-land-faq-col">
              {col.map((f) => (
                <details key={f.q}>
                  <summary>{f.q}<ChevronDown size={20} aria-hidden="true" /></summary>
                  <div className="nb-land-faq-a">
                    <p>{f.a}{INBOX_LINES_VISIBLE && f.inboxNote ? ` ${f.inboxNote}` : ''}</p>
                    {f.link?.page === 'privacy' && <a href="/#/privacy-policy">{f.link.label}</a>}
                    {f.link?.page === 'refund' && <a href="/#/refund-policy">{f.link.label}</a>}
                  </div>
                </details>
              ))}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};
