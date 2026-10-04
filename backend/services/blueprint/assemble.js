'use strict';
// Modules D and H: assemble the page-JSON deterministically. Facts are copied from the sheet by code; the model's
// claims were already tagged and cleaned by the planner. Phase labels, page titles and the closing contact come
// from config, never from the model.
const { PAGES, PHASES, NEBULAA, LIMITED_NOTE } = require('../../config/blueprint');

// Static sentences, written to the app voice rules.
const NO_COMPETITORS = 'Add the names and addresses of up to three competitors to see this page.';
const NO_OFFERS = 'Add up to three of your real offers, with their prices, to see hooks written for them.';
const NO_COMPETITOR_READ = 'None of the competitors you named could be read from their own pages.';
const CLOSING = {
  heading: 'Turn this plan into posts in Nebulaa',
  body: 'Nebulaa turns each tile of this plan into a finished post for you to review and approve.',
  cta: { label: 'Open Nebulaa', href: '#/dashboard' }
};

const proposed = (text, extra = {}) => ({ text, tag: 'proposed', ...extra });
const verifiedOf = (f) => ({ text: f.text, tag: 'verified', factId: f.id });
const section = (heading, kind, items) => ({ heading, kind, items });

function assembleBlueprint({ input, sheet, plan, direction, mode, now, sources }) {
  const when = now instanceof Date ? now : new Date();
  const facts = sheet.facts || [];
  const own = facts.filter((f) => f.kind !== 'competitor_page');
  const unverified = sheet.unverified || [];
  const isCompetitorNote = (u) => /^Competitor /.test(u.text);

  const logo = input.logoUrl ? { url: input.logoUrl, source: 'typed' } : (sheet.assets && sheet.assets.logo) || null;
  const cover = {
    businessName: input.businessName,
    logo: logo ? { url: logo.url, source: logo.source } : null,
    logoNote: logo ? null : 'Logo not provided',
    colours: ((sheet.assets && sheet.assets.colours) || []).map((c) => ({ hex: c.hex, source: c.source })),
    promise: plan.promise || null,
    limitedNote: sheet.basis === 'limited' ? LIMITED_NOTE : null,
    warnings: (sheet.warnings || []).map((w) => ({ reason: w.reason, message: w.message }))
  };

  const page = (n) => {
    const meta = PAGES[n - 1];
    return { n: meta.n, id: meta.id, title: meta.title, purpose: meta.purpose, sections: [] };
  };
  const pages = PAGES.map((p) => page(p.n));
  const add = (n, s) => { if (s.items.length) pages[n - 1].sections.push(s); };

  // 1 Where you are today
  add(1, section('What we confirmed', 'claims', own.map(verifiedOf)));
  add(1, section('What we read from this', 'claims', plan.whereToday));
  add(1, section('What we could not confirm', 'claims', unverified.filter((u) => !isCompetitorNote(u)).map((u) => ({ text: u.text, tag: 'unverified', reason: u.reason }))));

  // 2 Audience and positioning
  const t = plan.positioning.territory;
  const terr = direction && direction.name && mode === 'guided' ? { name: direction.name, rationale: direction.rationale, risk: direction.risk } : t;
  add(2, section('Who you speak to', 'claims', plan.positioning.audience));
  if (terr) {
    add(2, section('The territory', 'claims', [
      proposed(terr.name, { label: 'Territory' }),
      ...(terr.rationale ? [{ ...terr.rationale, label: 'Why it fits' }] : []),
      ...(terr.risk ? [{ ...terr.risk, label: 'The risk' }] : [])
    ]));
  }
  add(2, section('Your line', 'claims', plan.positioning.line ? [{ ...plan.positioning.line, label: 'Line' }] : []));

  // 3 Competitor read: only competitors the visitor named with an address, and only what their own pages say.
  const named = input.competitors || [];
  const read = named.filter((c) => c.url).map((c) => {
    const mine = facts.filter((f) => f.kind === 'competitor_page' && f.subject === c.name).map(verifiedOf);
    const model = (plan.competitors.find((m) => m.name.toLowerCase() === c.name.toLowerCase()) || { observations: [] }).observations;
    return { name: c.name, url: c.url, observations: [...mine, ...model] };
  }).filter((c) => c.observations.length);
  add(3, section('What their own pages say', 'competitors', read));
  const notRead = unverified.filter(isCompetitorNote).map((u) => ({ text: u.text, tag: 'unverified', reason: u.reason }));
  add(3, section('Not researched', 'claims', notRead));
  if (!named.length) add(3, section('Add competitors', 'claims', [proposed(NO_COMPETITORS)]));
  else if (!read.length && !notRead.length) add(3, section('Not researched', 'claims', [{ text: NO_COMPETITOR_READ, tag: 'unverified', reason: 'No competitor page could be read.' }]));

  // 4 and 5
  add(4, section('Your pillars', 'pillars', plan.pillars));
  add(5, section('Thirty days of posts', 'calendar', plan.calendar));

  // 6 Offers: exactly as the visitor typed them.
  const offers = (input.offers || []).map((o) => {
    const text = o.price ? `Offer: ${o.name}, ${o.price}` : `Offer: ${o.name}`;
    const fact = facts.find((f) => f.kind === 'typed' && f.field === 'Offer' && f.text === text);
    const m = fact && plan.offers.find((x) => x.factId === fact.id);
    return fact ? { name: o.name, price: o.price, fact: verifiedOf(fact), hook: (m && m.hook) || null, cta: (m && m.cta) || null } : null;
  }).filter(Boolean);
  add(6, section('Your offers', 'offers', offers));
  if (!(input.offers || []).length) add(6, section('Add your offers', 'claims', [proposed(NO_OFFERS)]));

  // 7, 8, 9
  add(7, section('Where to be present', 'channels', plan.channels));
  add(8, section('Three phases', 'phases', PHASES.map((ph) => {
    const r = plan.roadmap.find((x) => x.phase === ph.id) || {};
    return { id: ph.id, label: ph.label, title: ph.title, focus: r.focus || null, actions: r.actions || [], measure: r.measure || [] };
  })));
  add(9, section('This week', 'claims', plan.firstSteps));

  return {
    version: 1,
    mode,
    basis: sheet.basis,
    generatedAt: when.toISOString(),
    cover,
    pages,
    sources: (sources || []).filter((s) => s.kind !== 'robots').map((s) => ({ url: s.url, kind: s.kind, ok: !!s.ok })),
    closing: { ...CLOSING, cta: { ...CLOSING.cta }, contact: { ...NEBULAA } }
  };
}

module.exports = { assembleBlueprint, NO_COMPETITORS, NO_OFFERS };
