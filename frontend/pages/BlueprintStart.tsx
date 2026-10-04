import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, X as XIcon } from 'lucide-react';
import { GravityPanel, GravityLabel, GravityButton, GravityFileInput } from '../components/gravity';
import UpgradePrompt from '../components/UpgradePrompt';
import { apiService } from '../services/api';
import { upgradeInfoOf } from '../utils/plans';
import {
  GOALS, MAX_COMPETITORS, MAX_OFFERS, MAX_COLOURS, emptyForm, validateForm, buildStartBody, canChooseMode,
  logoFileProblem, startFailureOf, quarksNote, BlueprintInputForm,
} from '../utils/blueprint';
import { BLUEPRINT_COPY } from '../constants/blueprintCopy';
import type { User } from '../types';

const C = BLUEPRINT_COPY.form;

const inputCls =
  'w-full rounded-lg border border-[var(--gv-border-default)] bg-[var(--gv-panel)] px-3 py-2.5 text-[14px] text-[var(--gv-text-primary)] placeholder:text-[var(--gv-text-tertiary)] focus:outline-none focus:border-[var(--gv-accent)]';

const Field: React.FC<{ id: string; label: string; help?: string; error?: string; children: React.ReactNode }> = ({ id, label, help, error, children }) => (
  <div className="space-y-1.5">
    <label htmlFor={id} className="block text-[13px] font-semibold text-[var(--gv-text-primary)]">{label}</label>
    {children}
    {help && <p className="text-[12.5px] text-[var(--gv-text-tertiary)]">{help}</p>}
    {error && <p role="alert" className="text-[12.5px] font-medium text-[var(--gv-coral-text)]">{error}</p>}
  </div>
);

const BlueprintStart: React.FC<{ user: User }> = ({ user }) => {
  const navigate = useNavigate();
  const [form, setForm] = useState<BlueprintInputForm>(() => {
    const f = emptyForm();
    f.businessName = (user as any)?.companyName || user?.businessProfile?.name || '';
    f.website = user?.businessProfile?.website || '';
    return f;
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [already, setAlready] = useState<{ id: string; message: string } | null>(null);
  const [upgrade, setUpgrade] = useState<ReturnType<typeof upgradeInfoOf>>(null);
  const [cost, setCost] = useState<number | undefined>(undefined);
  const allowMode = canChooseMode(user as any);

  useEffect(() => {
    let live = true;
    apiService.getCredits().then((r) => { if (live && typeof r?.costs?.blueprint === 'number') setCost(r.costs.blueprint); }).catch(() => {});
    return () => { live = false; };
  }, []);

  const set = <K extends keyof BlueprintInputForm>(k: K, v: BlueprintInputForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  const onLogo = (file: File | undefined) => {
    if (!file) return;
    const problem = logoFileProblem(file);
    if (problem) { setErrors((e) => ({ ...e, logo: problem })); return; }
    const reader = new FileReader();
    reader.onload = () => {
      setErrors((e) => { const { logo, ...rest } = e; return rest; });
      set('logoDataUrl', String(reader.result || ''));
    };
    reader.readAsDataURL(file);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setMessage(''); setAlready(null); setUpgrade(null);
    const v = validateForm(form);
    setErrors(v.errors);
    if (!v.ok) { setMessage(C.correctFields); return; }
    setBusy(true);
    try {
      const res = await apiService.blueprintStart(buildStartBody(form, allowMode));
      if (res?.id) navigate(`/blueprint/${res.id}`);
      else setMessage('We could not start your Blueprint. Please try again.');
    } catch (err: any) {
      const f = startFailureOf(err);
      if (f.kind === 'already') setAlready({ id: f.id, message: f.message });
      else if (f.kind === 'upgrade') setUpgrade(upgradeInfoOf(err));
      else if (f.kind === 'fields') { setErrors(f.errors); setMessage(f.message); }
      else setMessage(f.message);
    } finally {
      setBusy(false);
    }
  };

  const competitorRows = (form.competitors.length ? form.competitors : [{ name: '', url: '' }]).slice(0, MAX_COMPETITORS);
  const offerRows = (form.offers.length ? form.offers : [{ name: '', price: '' }]).slice(0, MAX_OFFERS);
  const setCompetitor = (i: number, k: 'name' | 'url', v: string) => {
    const next = competitorRows.map((c, j) => (j === i ? { ...c, [k]: v } : c));
    set('competitors', next);
  };
  const setOffer = (i: number, k: 'name' | 'price', v: string) => {
    const next = offerRows.map((o, j) => (j === i ? { ...o, [k]: v } : o));
    set('offers', next);
  };

  return (
    <form onSubmit={submit} noValidate className="max-w-[720px] w-full mx-auto px-4 sm:px-6 py-8 space-y-6">
      <div>
        <GravityLabel gold className="mb-2">Brand Growth Blueprint</GravityLabel>
        <h1 className="text-[26px] sm:text-[32px] font-semibold leading-tight text-[var(--gv-text-primary)]">{C.title}</h1>
        <p className="mt-2 text-[14.5px] leading-relaxed text-[var(--gv-text-secondary)]">{C.intro}</p>
      </div>

      {already && (
        <GravityPanel padding="p-4" contentClassName="space-y-3">
          <p role="status" className="text-[14px] text-[var(--gv-text-primary)]">{already.message}</p>
          {already.id && <GravityButton onClick={() => navigate(`/blueprint/${already.id}`)}>{C.openExisting}</GravityButton>}
        </GravityPanel>
      )}
      {upgrade && <UpgradePrompt reason={upgrade.reason} feature={upgrade.feature} />}

      <GravityPanel padding="p-5 sm:p-6" contentClassName="space-y-5">
        <Field id="bp-name" label={C.businessName} error={errors.businessName}>
          <input id="bp-name" className={inputCls} value={form.businessName} maxLength={120} autoComplete="organization" onChange={(e) => set('businessName', e.target.value)} />
        </Field>
        <div className="grid sm:grid-cols-2 gap-5">
          <Field id="bp-web" label={C.website} error={errors.website}>
            <input id="bp-web" className={inputCls} value={form.website} placeholder={C.websitePlaceholder} inputMode="url" autoCapitalize="none" onChange={(e) => set('website', e.target.value)} />
          </Field>
          <Field id="bp-ig" label={C.instagram} error={errors.instagram}>
            <input id="bp-ig" className={inputCls} value={form.instagram} placeholder={C.instagramPlaceholder} autoCapitalize="none" onChange={(e) => set('instagram', e.target.value)} />
          </Field>
        </div>
        <p className="-mt-3 text-[12.5px] text-[var(--gv-text-tertiary)]">{C.reachHelp}</p>
        <Field id="bp-sell" label={C.whatYouSell} help={C.whatYouSellHelp} error={errors.whatYouSell}>
          <textarea id="bp-sell" rows={2} className={inputCls} value={form.whatYouSell} maxLength={300} onChange={(e) => set('whatYouSell', e.target.value)} />
        </Field>
        <Field id="bp-for" label={C.whoItsFor} help={C.whoItsForHelp} error={errors.whoItsFor}>
          <input id="bp-for" className={inputCls} value={form.whoItsFor} maxLength={200} onChange={(e) => set('whoItsFor', e.target.value)} />
        </Field>
        <fieldset className="space-y-2">
          <legend className="text-[13px] font-semibold text-[var(--gv-text-primary)] mb-1">{C.goal}</legend>
          <div className="grid grid-cols-2 gap-2">
            {GOALS.map((g) => (
              <label key={g.value} className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-[14px] cursor-pointer text-[var(--gv-text-primary)] ${form.goal === g.value ? 'border-[var(--gv-accent)] bg-[var(--gv-accent-fill)]' : 'border-[var(--gv-border-default)]'}`}>
                <input type="radio" name="bp-goal" value={g.value} checked={form.goal === g.value} onChange={() => set('goal', g.value)} className="accent-[var(--gv-accent)]" />
                {g.label}
              </label>
            ))}
          </div>
          {errors.goal && <p role="alert" className="text-[12.5px] font-medium text-[var(--gv-coral-text)]">{errors.goal}</p>}
        </fieldset>

        <details className="group rounded-xl border border-[var(--gv-border-subtle)] px-4 py-3">
          <summary className="cursor-pointer text-[14px] font-semibold text-[var(--gv-text-primary)]">{C.moreDetail}</summary>
          <div className="mt-4 space-y-5">
            <Field id="bp-city" label={C.city}>
              <input id="bp-city" className={inputCls} value={form.city} maxLength={80} onChange={(e) => set('city', e.target.value)} />
            </Field>

            <div className="space-y-2">
              <p className="text-[13px] font-semibold text-[var(--gv-text-primary)]">{C.competitors}</p>
              {competitorRows.map((c, i) => (
                <div key={i} className="grid sm:grid-cols-2 gap-2">
                  <input aria-label={`${C.competitorName} ${i + 1}`} className={inputCls} placeholder={C.competitorName} value={c.name} maxLength={80} onChange={(e) => setCompetitor(i, 'name', e.target.value)} />
                  <input aria-label={`${C.competitorUrl} ${i + 1}`} className={inputCls} placeholder={C.competitorUrl} value={c.url} inputMode="url" autoCapitalize="none" onChange={(e) => setCompetitor(i, 'url', e.target.value)} />
                </div>
              ))}
              {competitorRows.length < MAX_COMPETITORS && competitorRows.every((c) => c.name || c.url) && (
                <button type="button" className="text-[13px] font-semibold text-[var(--gv-accent-text)] underline underline-offset-2" onClick={() => set('competitors', [...competitorRows, { name: '', url: '' }])}>{C.addCompetitor}</button>
              )}
              <p className="text-[12.5px] text-[var(--gv-text-tertiary)]">{C.competitorsHelp}</p>
              {errors.competitors && <p role="alert" className="text-[12.5px] font-medium text-[var(--gv-coral-text)]">{errors.competitors}</p>}
            </div>

            <div className="space-y-2">
              <p className="text-[13px] font-semibold text-[var(--gv-text-primary)]">{C.offers}</p>
              {offerRows.map((o, i) => (
                <div key={i} className="grid sm:grid-cols-2 gap-2">
                  <input aria-label={`${C.offerName} ${i + 1}`} className={inputCls} placeholder={C.offerName} value={o.name} maxLength={80} onChange={(e) => setOffer(i, 'name', e.target.value)} />
                  <input aria-label={`${C.offerPrice} ${i + 1}`} className={inputCls} placeholder={C.offerPrice} value={o.price} maxLength={60} onChange={(e) => setOffer(i, 'price', e.target.value)} />
                </div>
              ))}
              {offerRows.length < MAX_OFFERS && offerRows.every((o) => o.name || o.price) && (
                <button type="button" className="text-[13px] font-semibold text-[var(--gv-accent-text)] underline underline-offset-2" onClick={() => set('offers', [...offerRows, { name: '', price: '' }])}>{C.addOffer}</button>
              )}
              <p className="text-[12.5px] text-[var(--gv-text-tertiary)]">{C.offersHelp}</p>
              {errors.offers && <p role="alert" className="text-[12.5px] font-medium text-[var(--gv-coral-text)]">{errors.offers}</p>}
            </div>

            <div className="space-y-2">
              <p className="text-[13px] font-semibold text-[var(--gv-text-primary)]">{C.colours}</p>
              <div className="flex flex-wrap items-center gap-3">
                {form.colours.map((c, i) => (
                  <span key={i} className="inline-flex items-center gap-1.5">
                    <input type="color" aria-label={`${C.colours} ${i + 1}`} value={c} className="h-10 w-12 rounded-md border border-[var(--gv-border-default)] bg-transparent p-0.5" onChange={(e) => set('colours', form.colours.map((x, j) => (j === i ? e.target.value : x)))} />
                    <button type="button" aria-label={C.removeColour} className="p-1 text-[var(--gv-text-tertiary)]" onClick={() => set('colours', form.colours.filter((_, j) => j !== i))}><XIcon className="w-4 h-4" /></button>
                  </span>
                ))}
                {form.colours.length < MAX_COLOURS && (
                  <GravityButton variant="ghost" onClick={() => set('colours', [...form.colours, '#14203a'])}>{C.addColour}</GravityButton>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-[13px] font-semibold text-[var(--gv-text-primary)]">{C.logo}</p>
              <div className="flex items-center gap-3 flex-wrap">
                <GravityFileInput accept="image/png,image/jpeg,image/webp" buttonText={C.logoButton} onFile={onLogo} fileName={form.logoDataUrl ? 'Logo selected' : undefined} />
                {form.logoDataUrl && (
                  <>
                    <img src={form.logoDataUrl} alt="Your logo" className="h-12 w-12 rounded-md object-contain border border-[var(--gv-border-subtle)] bg-[var(--gv-panel)]" />
                    <button type="button" className="text-[13px] font-semibold text-[var(--gv-accent-text)] underline underline-offset-2" onClick={() => set('logoDataUrl', '')}>{C.removeLogo}</button>
                  </>
                )}
              </div>
              <p className="text-[12.5px] text-[var(--gv-text-tertiary)]">{C.logoHelp}</p>
              {errors.logo && <p role="alert" className="text-[12.5px] font-medium text-[var(--gv-coral-text)]">{errors.logo}</p>}
            </div>
          </div>
        </details>

        {allowMode && (
          <fieldset className="space-y-2">
            <legend className="text-[13px] font-semibold text-[var(--gv-text-primary)] mb-1">{C.modeTitle}</legend>
            {(['guided', 'auto'] as const).map((m) => (
              <label key={m} className={`flex items-start gap-2 rounded-lg border px-3 py-2.5 text-[14px] cursor-pointer text-[var(--gv-text-primary)] ${form.mode === m ? 'border-[var(--gv-accent)] bg-[var(--gv-accent-fill)]' : 'border-[var(--gv-border-default)]'}`}>
                <input type="radio" name="bp-mode" value={m} checked={form.mode === m} onChange={() => set('mode', m)} className="mt-1 accent-[var(--gv-accent)]" />
                <span>{m === 'guided' ? C.modeGuided : C.modeAuto}</span>
              </label>
            ))}
          </fieldset>
        )}
      </GravityPanel>

      {message && <p role="alert" className="text-[13.5px] font-medium text-[var(--gv-coral-text)]">{message}</p>}

      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <GravityButton type="submit" disabled={busy} className="justify-center">
          {busy && <Loader2 className="w-4 h-4 animate-spin" />}
          {busy ? C.submitting : C.submit}
        </GravityButton>
        <p className="text-[13px] text-[var(--gv-text-secondary)]">{quarksNote(cost)}</p>
      </div>
      <p className="text-[12.5px] text-[var(--gv-text-tertiary)]">{C.privacy}</p>
    </form>
  );
};

export default BlueprintStart;
