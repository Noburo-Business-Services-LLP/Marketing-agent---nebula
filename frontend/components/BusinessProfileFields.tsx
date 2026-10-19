import React from 'react';
import AdditionalLanguagePicker from './AdditionalLanguagePicker';
import { CONTENT_LANGUAGES } from '../constants/languages';
import { LANGUAGES } from '../constants/businessQuestions';
import { IndustryQuestion, SellsToQuestion, ReachQuestion, CustomerBranchQuestions, GoalsQuestion, VoiceQuestion, LanguageQuestion } from './questionnaire/Questions';

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

/** The business profile form, grouped by what each answer is used for. */
const BusinessProfileFields: React.FC<Props> = ({ biz, onChange, inputCls, labelCls, mutedCls }) => {
  const f = { labelCls, mutedCls };
  // The same questions as sign-up (components/questionnaire), in English here.
  const q = { lang: 'en' as const, profile: biz, onChange, inputClassName: inputCls, titleClassName: labelCls };

  return (
    <div className="space-y-10 mb-6">
      <Section title="About your business" intro="The basics Nebulaa uses to write about you." mutedCls={mutedCls}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <Field {...f} label="Business name"><input className={inputCls} value={biz.name || ''} onChange={(e) => onChange('name', e.target.value)} /></Field>
          <Field {...f} label="Website"><input className={inputCls} value={biz.website || ''} onChange={(e) => onChange('website', e.target.value)} placeholder="https://..." /></Field>
          <div className="md:col-span-2"><IndustryQuestion {...q} /></div>
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
        <SellsToQuestion {...q} />
        <ReachQuestion {...q} />
        <Field {...f} label="Who buys from you"><textarea className={`${inputCls} min-h-[80px]`} value={biz.targetAudience || ''} onChange={(e) => onChange('targetAudience', e.target.value)} placeholder="For example: families in town buying for the home, or owners of small shops and clinics" /></Field>
        <Field {...f} label="Your ideal customer, in detail"><textarea className={`${inputCls} min-h-[80px]`} value={biz.targetCustomerProfile || ''} onChange={(e) => onChange('targetCustomerProfile', e.target.value)} /></Field>
        <CustomerBranchQuestions {...q} />
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
        </div>
      </Section>

      <Section title="Your goals, voice and languages" intro="What you want from your marketing, how your posts should sound, and in which languages." mutedCls={mutedCls}>
        <GoalsQuestion {...q} />
        <VoiceQuestion {...q} />
        <LanguageQuestion {...q} />
        <AdditionalLanguagePicker
          primary={biz.contentLanguage}
          offer={[...LANGUAGES]}
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
