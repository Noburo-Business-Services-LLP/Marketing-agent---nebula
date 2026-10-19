'use strict';
/**
 * What the memory learns about the customers and the market. PURE.
 * From the owner's own answers in the business profile (who buys, sells to, where, price level, what makes the
 * business different, industry) and from the plan's reading of the ideal customer (`result.plan.icp`: who, worries,
 * where to find them, what makes them buy). Only what is stored is said; a gender is never guessed and business buyers
 * are only mentioned when the owner said so.
 */
const { str, clip, plural, listWords, dayMonth, makeItem, sourceResult, claimText } = require('./common');
const { planOf } = require('./fromPlan');

const SELLS_TO = { B2B: 'other businesses', B2C: 'individual customers', Both: 'both businesses and individual customers' };
const REACH = { neighbourhood: 'the neighbourhood', city: 'the city', state: 'the state', india: 'all of India', international: 'other countries' };
const OLD_REACH = { hyperlocal: 'the neighbourhood', local_city: 'the city', regional: 'the region', state: 'the state', national: 'all of India', international: 'other countries' };
const PRICE = { budget: 'budget', affordable: 'affordable', mid_range: 'mid-range', premium: 'premium', luxury: 'luxury' };

const claims = (list) => (Array.isArray(list) ? list : []).map(claimText).filter(Boolean).slice(0, 3);

function learnFromCustomers({ user = null, planDoc = null } = {}) {
  const bp = (user && user.businessProfile && typeof user.businessProfile === 'object') ? user.businessProfile : {};
  const items = [];
  let answers = 0;

  const who = str(bp.targetCustomerProfile) || str(bp.targetAudience);
  if (who) {
    answers += 1;
    items.push(makeItem({
      key: 'customers-who', source: 'customers', kind: 'who', confidence: 'strong',
      text: `Who buys from you: ${clip(who, 160)}`,
      promptLine: `The customer: ${who}`,
      evidenceCount: 1, evidenceUnit: 'answers', evidenceText: 'from your business profile'
    }));
  }

  // The market, from the owner's answers.
  const market = [];
  const marketPrompt = [];
  const type = String(bp.businessType || '');
  if (SELLS_TO[type]) { market.push(`you sell to ${SELLS_TO[type]}`); marketPrompt.push(`the business sells to ${SELLS_TO[type]}`); }
  const areas = Array.isArray(bp.reachAreas) && bp.reachAreas.length ? bp.reachAreas.map((a) => REACH[a]).filter(Boolean) : (OLD_REACH[bp.geographicReach] ? [OLD_REACH[bp.geographicReach]] : []);
  if (areas.length) { market.push(`your customers are in ${listWords(areas)}`); marketPrompt.push(`its customers are in ${listWords(areas)}`); }
  if (PRICE[bp.pricePositioning]) { market.push(`your prices are ${PRICE[bp.pricePositioning]}`); marketPrompt.push(`its prices are ${PRICE[bp.pricePositioning]}`); }
  const industry = str(bp.industry);
  if (market.length) {
    answers += market.length;
    const sentence = market.join(', ');
    items.push(makeItem({
      key: 'customers-market', source: 'customers', kind: 'market', confidence: 'strong',
      text: `Your market${industry ? ` (${clip(industry, 40)})` : ''}: ${sentence}.`,
      promptLine: `The market: ${marketPrompt.join(', ')}.`,
      evidenceCount: market.length, evidenceUnit: 'answers', evidenceText: `from ${plural(market.length, 'answer', 'answers')} in your business profile`
    }));
  }

  const different = str(bp.keyDifferentiator);
  if (different) {
    answers += 1;
    items.push(makeItem({
      key: 'customers-different', source: 'customers', kind: 'different', confidence: 'strong',
      text: `Why customers choose you: ${clip(different, 160)}`,
      promptLine: `Why customers choose this business: ${different}`,
      evidenceCount: 1, evidenceUnit: 'answers', evidenceText: 'from your business profile'
    }));
  }

  // The plan's reading of the ideal customer (Nebulaa's reading, so "good", not "strong").
  const p = planOf(planDoc);
  const icp = p && p.icp && typeof p.icp === 'object' ? p.icp : null;
  const date = dayMonth(planDoc && planDoc.completedAt);
  const fromPlan = date ? `from your plan of ${date}` : 'from your plan';
  if (icp) {
    const rows = [
      ['pains', 'What worries them', 'What worries the customer'],
      ['where', 'Where to find them', 'Where the customer is found'],
      ['triggers', 'What makes them buy', 'What makes the customer buy']
    ];
    for (const [field, shown, prompt] of rows) {
      const list = claims(icp[field]);
      if (!list.length) continue;
      items.push(makeItem({
        key: `customers-${field}`, source: 'customers', kind: field, confidence: 'good',
        text: `${shown}: ${list.join('; ')}.`.replace(/\.\.$/, '.'),
        promptLine: `${prompt}: ${list.join('; ')}`,
        evidenceCount: list.length, evidenceUnit: 'points', evidenceText: `${fromPlan} (${plural(list.length, 'point', 'points')})`
      }));
    }
  }
  if (!who && icp) {
    const list = claims(icp.who).length ? claims(icp.who) : claims(p.positioning && p.positioning.audience);
    if (list.length) {
      items.unshift(makeItem({
        key: 'customers-who-plan', source: 'customers', kind: 'who', confidence: 'good',
        text: `Who your plan says buys from you: ${list.join('; ')}.`.replace(/\.\.$/, '.'),
        promptLine: `The customer: ${list.join('; ')}`,
        evidenceCount: list.length, evidenceUnit: 'points', evidenceText: fromPlan
      }));
    }
  }

  return sourceResult('none', 'Tell Nebulaa who your customers are in Settings, under your business profile, or wait for your plan.', {
    evidenceCount: answers + (icp ? 1 : 0), evidenceUnit: 'answers', items
  });
}

module.exports = { learnFromCustomers };
