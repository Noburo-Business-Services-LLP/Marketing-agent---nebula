import React, { useState } from 'react';
import './questionnaire.css';
import {
  QUESTION_WORDS, type QLang, INDUSTRY_GROUPS, OTHER_INDUSTRY, LIMITS, SELLS_TO, REACH_AREAS, AGE_GROUPS, GENDERS,
  BUYER_INDUSTRIES, COMPANY_SIZES, DECISION_MAKERS, SALES_CYCLES, VOICES, GOALS, LANGUAGES, LANGUAGE_SCRIPT, OLDER_LANGUAGE_NAMES,
  sellsToBusinesses, sellsToPeople, reachAreasOf, genderValueOf, industryValueFor, isOtherIndustry, languageParts, languageValue,
  toggleIn, voiceList,
} from '../../constants/businessQuestions';
import { AreaGlyph, CityGlyph } from '../art/questions/ReachNear';
import { StateGlyph, IndiaGlyph, WorldGlyph } from '../art/questions/ReachWide';
import { PeopleGlyph, BusinessGlyph, BothGlyph } from '../art/questions/SellsTo';

/**
 * The business-profile questions, used by sign-up and by Settings > Business profile, so the two can never differ.
 * Every list comes from constants/businessQuestions.ts (a mirror of the backend definition, kept equal by a test).
 * `onChange(field, value)` gets the businessProfile field name and its new value.
 */
export type QuestionProps = {
  lang: QLang;
  profile: Record<string, any>;
  onChange: (field: string, value: any) => void;
  /** Classes for the text boxes and the select, so each page keeps its own field look. */
  inputClassName?: string;
  /** Classes for the question titles, so Settings can match its other field labels. */
  titleClassName?: string;
  required?: boolean;
};

type Option = { value: string; label: string; sub?: string; art?: React.ReactNode };

const Required = () => <span className="nb-q-required" aria-hidden="true">*</span>;

/** A question: title, an optional hint and the answer area. */
export const QuestionBlock: React.FC<{ id: string; title: string; hint?: string; optional?: string; required?: boolean; titleClassName?: string; children: React.ReactNode }> = ({ id, title, hint, optional, required, titleClassName, children }) => (
  <div className="nb-q" role="group" aria-labelledby={`nb-q-${id}`}>
    <p id={`nb-q-${id}`} className={titleClassName ? `nb-q-title-custom ${titleClassName}` : 'nb-q-title'}>
      {title} {required ? <Required /> : optional ? <span className="nb-q-optional">{optional}</span> : null}
    </p>
    {hint && <p className="nb-q-hint">{hint}</p>}
    {children}
  </div>
);

/**
 * Tiles to pick from: buttons with aria-pressed, wide and short, every row filled (the last row stretches), every
 * tile in a row the same height. `art` tiles carry a small drawing beside the words.
 */
export const ChoiceTiles: React.FC<{ options: Option[]; selected: string[]; onPick: (value: string) => void; variant?: 'art' | 'chip'; label: string; basis?: number }> = ({ options, selected, onPick, variant = 'chip', label, basis }) => (
  <div className={`nb-q-tiles nb-q-tiles--${variant}`} aria-label={label} style={basis ? ({ '--nb-q-basis': `${basis}px` } as React.CSSProperties) : undefined}>
    {options.map((o) => {
      const on = selected.includes(o.value);
      return (
        <button key={o.value || 'none'} type="button" aria-pressed={on} onClick={() => onPick(o.value)} className={`nb-q-tile${on ? ' is-on' : ''}`}>
          {o.art && <span className="nb-q-tile-art">{o.art}</span>}
          <span className="nb-q-tile-words">
            <span className="nb-q-tile-label">{o.label}</span>
            {o.sub && <span className="nb-q-tile-sub">{o.sub}</span>}
          </span>
          <span className="nb-q-tick" aria-hidden="true" />
        </button>
      );
    })}
  </div>
);

/* ---------- Industry ---------- */

export const IndustryQuestion: React.FC<QuestionProps> = ({ lang, profile, onChange, inputClassName = '', required, titleClassName }) => {
  const w = QUESTION_WORDS[lang];
  const current = String(profile.industry || '');
  const other = isOtherIndustry(current);
  const selectValue = other ? OTHER_INDUSTRY : industryValueFor(current);
  const ownWords = other && current !== OTHER_INDUSTRY ? current : '';
  return (
    <QuestionBlock titleClassName={titleClassName} id="industry" title={w.q.industry.title} hint={w.q.industry.hint} required={required}>
      <select className={inputClassName} aria-label={w.q.industry.title} value={selectValue} onChange={(e) => onChange('industry', e.target.value)}>
        <option value="">{w.chooseOne}</option>
        {INDUSTRY_GROUPS.map((g) => (
          <optgroup key={g.id} label={w.groups[g.id]}>
            {g.values.map((v) => <option key={v} value={v}>{w.industries[v]}</option>)}
          </optgroup>
        ))}
        <option value={OTHER_INDUSTRY}>{w.industries[OTHER_INDUSTRY]}</option>
      </select>
      {other && (
        <input
          className={`${inputClassName} nb-q-other`}
          aria-label={w.q.industryOther.title}
          maxLength={LIMITS.industry}
          placeholder={w.q.industryOther.placeholder}
          value={ownWords}
          onChange={(e) => onChange('industry', e.target.value.trim() ? e.target.value : OTHER_INDUSTRY)}
        />
      )}
    </QuestionBlock>
  );
};

/* ---------- Who do you sell to ---------- */

const SELLS_ART: Record<string, React.ReactNode> = { B2C: <PeopleGlyph />, B2B: <BusinessGlyph />, Both: <BothGlyph /> };

export const SellsToQuestion: React.FC<QuestionProps> = ({ lang, profile, onChange, required, titleClassName }) => {
  const w = QUESTION_WORDS[lang];
  const options = SELLS_TO.map((v) => ({ value: v, label: w.sellsTo[v].label, sub: w.sellsTo[v].sub, art: SELLS_ART[v] }));
  return (
    <QuestionBlock titleClassName={titleClassName} id="sellsTo" title={w.q.sellsTo.title} hint={w.q.sellsTo.hint} required={required}>
      <ChoiceTiles variant="art" label={w.q.sellsTo.title} options={options} selected={[String(profile.businessType || '')]} onPick={(v) => onChange('businessType', v)} basis={76} />
    </QuestionBlock>
  );
};

/* ---------- Where are your customers ---------- */

const REACH_ART: Record<string, React.ReactNode> = { neighbourhood: <AreaGlyph />, city: <CityGlyph />, state: <StateGlyph />, india: <IndiaGlyph />, international: <WorldGlyph /> };

export const ReachQuestion: React.FC<QuestionProps> = ({ lang, profile, onChange, titleClassName }) => {
  const w = QUESTION_WORDS[lang];
  const selected = reachAreasOf(profile);
  const options = REACH_AREAS.map((v) => ({ value: v, label: w.reach[v].label, sub: w.reach[v].sub, art: REACH_ART[v] }));
  return (
    <QuestionBlock titleClassName={titleClassName} id="reach" title={w.q.reach.title} hint={w.q.reach.hint} optional={w.optional}>
      <ChoiceTiles variant="art" label={w.q.reach.title} options={options} selected={selected} onPick={(v) => onChange('reachAreas', toggleIn<string>(selected, v))} basis={76} />
    </QuestionBlock>
  );
};

/* ---------- The follow-up questions for people and for businesses ---------- */

export const CustomerBranchQuestions: React.FC<QuestionProps> = ({ lang, profile, onChange, inputClassName = '', titleClassName }) => {
  const w = QUESTION_WORDS[lang];
  const type = String(profile.businessType || '');
  const b2b = profile.b2b && typeof profile.b2b === 'object' ? profile.b2b : {};
  const setB2b = (patch: Record<string, any>) => onChange('b2b', { ...b2b, ...patch });
  const decider = String(b2b.decisionMaker || '');
  const deciderIsOwn = Boolean(decider) && !(DECISION_MAKERS as readonly string[]).includes(decider);
  const [typingOwn, setTypingOwn] = useState(deciderIsOwn);
  const ownOpen = typingOwn || deciderIsOwn;
  const ages: string[] = Array.isArray(profile.ageGroups) ? profile.ageGroups : [];
  const buyers: string[] = Array.isArray(b2b.customerIndustries) ? b2b.customerIndustries : [];
  const OWN = '__own__';

  return (
    <>
      {sellsToPeople(type) && (
        <div className="nb-q-branch" data-branch="people">
          <QuestionBlock titleClassName={titleClassName} id="ageGroups" title={w.q.ageGroups.title} hint={w.q.ageGroups.hint} optional={w.optional}>
            <ChoiceTiles label={w.q.ageGroups.title} options={AGE_GROUPS.map((v) => ({ value: v, label: w.ages[v] }))} selected={ages} onPick={(v) => onChange('ageGroups', toggleIn(ages, v))} basis={130} />
          </QuestionBlock>
          <QuestionBlock titleClassName={titleClassName} id="gender" title={w.q.gender.title} hint={w.q.gender.hint} optional={w.optional}>
            <ChoiceTiles label={w.q.gender.title} options={[{ value: '', label: w.everyone }, ...GENDERS.map((v) => ({ value: v, label: w.genders[v] }))]} selected={[genderValueOf(profile)]} onPick={(v) => onChange('targetGender', v)} basis={100} />
          </QuestionBlock>
        </div>
      )}
      {sellsToBusinesses(type) && (
        <div className="nb-q-branch" data-branch="business">
          <p className="nb-q-branch-title">{w.q.businessBranch.title}</p>
          <QuestionBlock titleClassName={titleClassName} id="buyerIndustries" title={w.q.buyerIndustries.title} hint={w.q.buyerIndustries.hint} optional={w.optional}>
            <ChoiceTiles label={w.q.buyerIndustries.title} options={BUYER_INDUSTRIES.map((v) => ({ value: v, label: w.buyers[v] }))} selected={buyers} onPick={(v) => setB2b({ customerIndustries: toggleIn(buyers, v) })} basis={170} />
          </QuestionBlock>
          <QuestionBlock titleClassName={titleClassName} id="companySize" title={w.q.companySize.title} optional={w.optional}>
            <ChoiceTiles label={w.q.companySize.title} options={COMPANY_SIZES.map((v) => ({ value: v, label: w.sizes[v] }))} selected={[String(b2b.companySize || '')]} onPick={(v) => setB2b({ companySize: b2b.companySize === v ? '' : v })} basis={200} />
          </QuestionBlock>
          <QuestionBlock titleClassName={titleClassName} id="decisionMaker" title={w.q.decisionMaker.title} optional={w.optional}>
            <ChoiceTiles
              label={w.q.decisionMaker.title}
              options={[...DECISION_MAKERS.map((v) => ({ value: v, label: w.deciders[v] })), { value: OWN, label: w.someoneElse }]}
              selected={[ownOpen ? OWN : decider]}
              onPick={(v) => {
                if (v === OWN) { setTypingOwn(true); if (!deciderIsOwn) setB2b({ decisionMaker: '' }); return; }
                setTypingOwn(false);
                setB2b({ decisionMaker: decider === v ? '' : v });
              }}
              basis={130}
            />
            {ownOpen && (
              <input className={`${inputClassName} nb-q-other`} aria-label={w.q.decisionMaker.title} maxLength={LIMITS.decisionMaker} placeholder={w.q.decisionMaker.placeholder} value={deciderIsOwn ? decider : ''} onChange={(e) => setB2b({ decisionMaker: e.target.value })} />
            )}
          </QuestionBlock>
          <QuestionBlock titleClassName={titleClassName} id="salesCycle" title={w.q.salesCycle.title} optional={w.optional}>
            <ChoiceTiles label={w.q.salesCycle.title} options={SALES_CYCLES.map((v) => ({ value: v, label: w.cycles[v] }))} selected={[String(b2b.salesCycle || '')]} onPick={(v) => setB2b({ salesCycle: b2b.salesCycle === v ? '' : v })} basis={140} />
          </QuestionBlock>
        </div>
      )}
    </>
  );
};

/* ---------- Goals and voice ---------- */

/** Saved values outside the list (older free text) stay visible as extra tiles, so a save never drops them. */
function withSaved(values: readonly string[], saved: string[], words: Record<string, string>): Option[] {
  const extra = saved.filter((s) => !values.includes(s));
  return [...values.map((v) => ({ value: v, label: words[v] || v })), ...extra.map((v) => ({ value: v, label: v }))];
}

export const GoalsQuestion: React.FC<QuestionProps> = ({ lang, profile, onChange, required, titleClassName }) => {
  const w = QUESTION_WORDS[lang];
  const goals: string[] = Array.isArray(profile.marketingGoals) ? profile.marketingGoals : [];
  return (
    <QuestionBlock titleClassName={titleClassName} id="goals" title={w.q.goals.title} hint={w.q.goals.hint} required={required}>
      <ChoiceTiles label={w.q.goals.title} options={withSaved(GOALS, goals, w.goals)} selected={goals} onPick={(v) => onChange('marketingGoals', toggleIn(goals, v))} basis={200} />
    </QuestionBlock>
  );
};

export const VoiceQuestion: React.FC<QuestionProps> = ({ lang, profile, onChange, titleClassName }) => {
  const w = QUESTION_WORDS[lang];
  const voice = voiceList(profile.brandVoice);
  return (
    <QuestionBlock titleClassName={titleClassName} id="voice" title={w.q.voice.title} hint={w.q.voice.hint} optional={w.optional}>
      <ChoiceTiles label={w.q.voice.title} options={withSaved(VOICES, voice, w.voices)} selected={voice} onPick={(v) => onChange('brandVoice', toggleIn(voice, v))} basis={130} />
    </QuestionBlock>
  );
};

/* ---------- Post language ---------- */

export const LanguageQuestion: React.FC<QuestionProps> = ({ lang, profile, onChange, required, titleClassName }) => {
  const w = QUESTION_WORDS[lang];
  const { base, mix } = languageParts(profile.contentLanguage);
  const bases: string[] = [...LANGUAGES];
  // An account that already uses another language keeps it, shown as one more tile.
  if (base && !bases.includes(base)) bases.push(base);
  const options = bases.map((b) => {
    const label = (w.languages as Record<string, string>)[b] || OLDER_LANGUAGE_NAMES[b] || b;
    const script = (LANGUAGE_SCRIPT as Record<string, string>)[b];
    // The name in its own script, unless the page already shows it that way.
    return { value: b, label, sub: script && script !== label && b !== 'english' ? script : undefined };
  });
  return (
    <QuestionBlock titleClassName={titleClassName} id="language" title={w.q.language.title} required={required}>
      <ChoiceTiles label={w.q.language.title} options={options} selected={[base]} onPick={(b) => onChange('contentLanguage', languageValue(b, mix))} basis={140} />
      {base && base !== 'english' && (
        <label className="nb-q-switch">
          <input type="checkbox" role="switch" checked={mix} onChange={(e) => onChange('contentLanguage', languageValue(base, e.target.checked))} />
          <span className="nb-q-switch-track" aria-hidden="true"><span className="nb-q-switch-dot" /></span>
          <span className="nb-q-switch-words">
            <span className="nb-q-tile-label">{w.q.languageMix.title}</span>
            <span className="nb-q-tile-sub">{w.q.languageMix.hint}</span>
          </span>
        </label>
      )}
    </QuestionBlock>
  );
};
