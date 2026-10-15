import React from 'react';
import AdditionalLanguagePicker from './AdditionalLanguagePicker';
import { CONTENT_LANGUAGES, offeredLanguages } from '../constants/languages';
import {
  industryChoicesFor, industryValueFor, REACH_CHOICES, reachAreasOf, COMPANY_SIZES, SALES_CYCLES,
  VOICE_CHOICES, GOAL_CHOICES, sellsToBusinesses, showGenderChoice, toggleIn, voiceList,
} from '../utils/businessProfileForm';

type Props = {
  biz: any;
  onChange: (key: string, value: any) => void;
  inputCls: string;
  labelCls: string;
  mutedCls: string;
};

const Field: React.FC<{ label: string; labelCls: string; hint?: string; mutedCls: string; children: React.ReactNode }> = ({ label, labelCls, hint, mutedCls, children }) => (
  <div>
    <label className={labelCls}>{label}</label>
    {children}
    {hint && <p className={`mt-1.5 text-[12px] ${mutedCls}`}>{hint}</p>}
  </div>
);

const Section: React.FC<{ title: string; intro?: string; mutedCls: string; children: React.ReactNode }> = ({ title, intro, mutedCls, children }) => (
  <section className="space-y-5">
    <div className="pb-2 border-b border-[var(--gv-border-subtle)]">
      <h3 className="text-[15px] font-semibold text-[var(--gv-text-primary)]">{title}</h3>
      {intro && <p className={`mt-0.5 text-[12.5px] ${mutedCls}`}>{intro}</p>}
    </div>
    {children}
  </section>
);

const Chips: React.FC<{ options: Array<{ value: string; label: string }>; selected: string[]; onToggle: (v: string) => void; label: string }> = ({ options, selected, onToggle, label }) => (
  <div className="flex flex-wrap gap-2" role="group" aria-label={label}>
    {options.map((o) => {
      const on = selected.includes(o.value);
      return (
        <button key={o.value} type="button" aria-pressed={on} onClick={() => onToggle(o.value)}
          className={`h-9 px-4 rounded-full text-[13px] font-semibold border transition-colors ${on ? 'bg-[var(--gv-accent-fill)] border-[var(--gv-accent)] text-[var(--gv-text-primary)]' : 'border-[var(--gv-border-default)] text-[var(--gv-text-secondary)] hover:border-[var(--gv-border-strong)]'}`}>
          {o.label}
        </button>
      );
    })}
  </div>
);

/** The business profile form, grouped by what each answer is used for. */
const BusinessProfileFields: React.FC<Props> = ({ biz, onChange, inputCls, labelCls, mutedCls }) => {
  const b2b = biz.b2b || {};
  const reach = reachAreasOf(biz);
  const voice = voiceList(biz.brandVoice);
  const goals: string[] = Array.isArray(biz.marketingGoals) ? biz.marketingGoals : [];
  const toBusinesses = sellsToBusinesses(biz.businessType);
  const f = { labelCls, mutedCls };
  const textOptions = (list: string[]) => list.map((v) => ({ value: v, label: v }));

  return (
    <div className="space-y-10 mb-6">
      <Section title="About your business" intro="The basics Nebulaa uses to write about you." mutedCls={mutedCls}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <Field {...f} label="Business name"><input className={inputCls} value={biz.name || ''} onChange={(e) => onChange('name', e.target.value)} /></Field>
          <Field {...f} label="Website"><input className={inputCls} value={biz.website || ''} onChange={(e) => onChange('website', e.target.value)} placeholder="https://..." /></Field>
          <Field {...f} label="What kind of business">
            <select className={inputCls} value={industryValueFor(biz.industry)} onChange={(e) => onChange('industry', e.target.value)}>
              <option value="">Select...</option>
              {industryChoicesFor(biz.industry).map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </Field>
          <Field {...f} label="Who you sell to" hint="Businesses, individual customers, or both.">
            <select className={inputCls} value={biz.businessType || ''} onChange={(e) => onChange('businessType', e.target.value)}>
              <option value="">Select...</option>
              <option value="B2C">Individual customers</option>
              <option value="B2B">Other businesses</option>
              <option value="Both">Both</option>
            </select>
          </Field>
          <Field {...f} label="Business location"><input className={inputCls} value={biz.businessLocation || ''} onChange={(e) => onChange('businessLocation', e.target.value)} placeholder="City, state or country" /></Field>
          <Field {...f} label="GST number"><input className={inputCls} value={biz.gstNumber || ''} onChange={(e) => onChange('gstNumber', e.target.value)} /></Field>
          <Field {...f} label="Years in business"><input type="number" min={0} className={inputCls} value={biz.yearsInBusiness ?? ''} onChange={(e) => onChange('yearsInBusiness', e.target.value === '' ? undefined : Number(e.target.value))} /></Field>
          <Field {...f} label="Where your brand stands today">
            <select className={inputCls} value={biz.brandMaturity || ''} onChange={(e) => onChange('brandMaturity', e.target.value)}>
              <option value="">Select...</option>
              <option value="established">Well known already</option>
              <option value="growing">Still growing</option>
            </select>
          </Field>
        </div>
        <Field {...f} label="What you do, in a few lines"><textarea className={`${inputCls} min-h-[90px]`} value={biz.description || ''} onChange={(e) => onChange('description', e.target.value)} /></Field>
        <Field {...f} label="Your speciality"><input className={inputCls} value={biz.niche || ''} onChange={(e) => onChange('niche', e.target.value)} placeholder="For example: handmade silver jewellery" /></Field>
        <Field {...f} label="The problem you solve"><textarea className={`${inputCls} min-h-[80px]`} value={biz.problemSolved || ''} onChange={(e) => onChange('problemSolved', e.target.value)} /></Field>
      </Section>

      <Section title="Who your customers are" intro="Nebulaa writes to these people, in these places." mutedCls={mutedCls}>
        <Field {...f} label={toBusinesses ? 'Who buys from you' : 'Who buys from you'}><textarea className={`${inputCls} min-h-[80px]`} value={biz.targetAudience || ''} onChange={(e) => onChange('targetAudience', e.target.value)} placeholder={toBusinesses ? 'For example: owners of small shops and clinics' : 'For example: families in town buying for the home'} /></Field>
        <Field {...f} label="Your ideal customer, in detail"><textarea className={`${inputCls} min-h-[80px]`} value={biz.targetCustomerProfile || ''} onChange={(e) => onChange('targetCustomerProfile', e.target.value)} /></Field>
        <div>
          <label className={labelCls}>Where your customers are</label>
          <Chips label="Where your customers are" options={REACH_CHOICES} selected={reach} onToggle={(v) => onChange('reachAreas', toggleIn(reach, v as any))} />
          <p className={`mt-1.5 text-[12px] ${mutedCls}`}>Choose all that apply.</p>
        </div>
        {toBusinesses && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5 rounded-xl border border-[var(--gv-border-subtle)] p-4">
            <Field {...f} label="Size of your business customers">
              <select className={inputCls} value={b2b.companySize || ''} onChange={(e) => onChange('b2b', { ...b2b, companySize: e.target.value })}>
                <option value="">Select...</option>
                {COMPANY_SIZES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </Field>
            <Field {...f} label="Who decides to buy"><input className={inputCls} value={b2b.decisionMaker || ''} maxLength={120} onChange={(e) => onChange('b2b', { ...b2b, decisionMaker: e.target.value })} placeholder="For example: owner or operations head" /></Field>
            <Field {...f} label="How long a sale takes">
              <select className={inputCls} value={b2b.salesCycle || ''} onChange={(e) => onChange('b2b', { ...b2b, salesCycle: e.target.value })}>
                <option value="">Select...</option>
                {SALES_CYCLES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </Field>
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <Field {...f} label="New or returning customers">
            <select className={inputCls} value={biz.customerType || ''} onChange={(e) => onChange('customerType', e.target.value)}>
              <option value="">Select...</option>
              <option value="mostly_new">Mostly new</option>
              <option value="mix_new_repeat">A mix of new and returning</option>
              <option value="mostly_loyal">Mostly returning</option>
            </select>
          </Field>
          <Field {...f} label="Price level">
            <select className={inputCls} value={biz.pricePositioning || ''} onChange={(e) => onChange('pricePositioning', e.target.value)}>
              <option value="">Select...</option>
              <option value="budget">Budget</option>
              <option value="affordable">Affordable</option>
              <option value="mid_range">Mid range</option>
              <option value="premium">Premium</option>
              <option value="luxury">Luxury</option>
            </select>
          </Field>
          {showGenderChoice(biz.businessType) && (
            <Field {...f} label="Mostly men, women or families? (optional)" hint="Leave this empty unless it really describes your customers.">
              <select className={inputCls} value={biz.targetGender || ''} onChange={(e) => onChange('targetGender', e.target.value)}>
                <option value="">Not specific</option>
                <option value="mostly_men">Mostly men</option>
                <option value="mostly_women">Mostly women</option>
                <option value="families">Families</option>
              </select>
            </Field>
          )}
        </div>
      </Section>

      <Section title="Your voice and languages" intro="How your posts should sound, and in which languages." mutedCls={mutedCls}>
        <div>
          <label className={labelCls}>Brand voice</label>
          <Chips label="Brand voice" options={textOptions(Array.from(new Set([...VOICE_CHOICES, ...voice])))} selected={voice} onToggle={(v) => onChange('brandVoice', toggleIn(voice, v))} />
        </div>
        <div>
          <label className={labelCls}>What you want from your marketing</label>
          <Chips label="Marketing goals" options={textOptions(Array.from(new Set([...GOAL_CHOICES, ...goals])))} selected={goals} onToggle={(v) => onChange('marketingGoals', toggleIn(goals, v))} />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <Field {...f} label="Main language for posts">
            <select className={inputCls} value={biz.contentLanguage || ''} onChange={(e) => onChange('contentLanguage', e.target.value)}>
              <option value="">Select...</option>
              {offeredLanguages((biz as any).contentLanguage).map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
            </select>
          </Field>
        </div>
        <AdditionalLanguagePicker
          primary={biz.contentLanguage}
          value={biz.additionalLanguages || []}
          onChange={(next) => onChange('additionalLanguages', next)}
          labels={{ title: 'Also post in', hint: 'Optional. Choose up to three more languages. You can turn any post into these languages later.', full: 'Three languages are chosen. Remove one to choose another.', names: Object.fromEntries(CONTENT_LANGUAGES.map((l) => [l.value, l.label])) }}
        />
      </Section>

      <Section title="What you offer" intro="The things Nebulaa should feature and the lines it must respect." mutedCls={mutedCls}>
        <Field {...f} label="Your hero product or service"><textarea className={`${inputCls} min-h-[70px]`} value={biz.heroProduct || ''} onChange={(e) => onChange('heroProduct', e.target.value)} /></Field>
        <Field {...f} label="What makes you different"><textarea className={`${inputCls} min-h-[70px]`} value={biz.keyDifferentiator || ''} onChange={(e) => onChange('keyDifferentiator', e.target.value)} /></Field>
        <Field {...f} label="Your story"><textarea className={`${inputCls} min-h-[100px]`} value={biz.brandStory || ''} onChange={(e) => onChange('brandStory', e.target.value)} /></Field>
        <Field {...f} label="Things to never say or show"><textarea className={`${inputCls} min-h-[70px]`} value={biz.contentRestrictions || ''} onChange={(e) => onChange('contentRestrictions', e.target.value)} placeholder="For example: no medical claims, no competitor names" /></Field>
        <Field {...f} label="Ideas for your first month"><textarea className={`${inputCls} min-h-[80px]`} value={biz.firstMonthContentAngles || ''} onChange={(e) => onChange('firstMonthContentAngles', e.target.value)} /></Field>
      </Section>

      <Section title="How much to post" intro="Changes apply from next month's plan onward. The current month's plan stays as it was made." mutedCls={mutedCls}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <Field {...f} label="Posts per day">
            <input type="number" min={1} max={5} step={1} className={inputCls} value={biz.contentCadence?.postsPerDay ?? 1}
              onChange={(e) => onChange('contentCadence', { ...biz.contentCadence, postsPerDay: Math.max(1, Math.min(5, Number(e.target.value) || 1)) })} />
          </Field>
          <Field {...f} label="Reels per week">
            <input type="number" min={0} max={7} step={1} className={inputCls} value={biz.contentCadence?.reelsPerWeek ?? 1}
              onChange={(e) => onChange('contentCadence', { ...biz.contentCadence, reelsPerWeek: Math.max(0, Math.min(7, Number(e.target.value) || 0)) })} />
          </Field>
        </div>
      </Section>
    </div>
  );
};

export default BusinessProfileFields;
