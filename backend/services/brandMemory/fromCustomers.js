'use strict';
/**
 * What the memory learns about the customers and the market. PURE.
 * From the owner's own answers in the business profile (who buys, sells to, where, price level, what makes the
 * business different, industry) and from the plan's reading of the ideal customer (`result.plan.icp`: who, worries,
 * where to find them, what makes them buy). Only what is stored is said; a gender is never guessed and business buyers
 * are only mentioned when the owner said so.
 */
const { str, clip, plural, dayMonth, makeItem, sourceResult, claimText } = require('./common');
const { planOf } = require('./fromPlan');

const { audienceFacts, industryOf } = require('../businessProfile');

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

  // The market and the business buyers, from the owner's answers (the same plain words every prompt reader uses).
  // The gender answer stays out of the memory (it is only a hint for the writers, see brandMemory.describeAudience).
  const BUYER_KEYS = ['buyers', 'size', 'decider', 'cycle'];
  const facts = audienceFacts(bp).filter((f) => f.key !== 'gender');
  const own = (t) => t.replace(/^sells to /, 'you sell to ').replace(/^customers are /, 'your customers are ').replace(/^business customers are /, 'your business customers are ').replace(/^prices are /, 'your prices are ');
  const third = (t) => t.replace(/^sells to /, 'the business sells to ').replace(/^customers are /, 'its customers are ').replace(/^business customers are /, 'its business customers are ').replace(/^prices are /, 'its prices are ');
  const industry = industryOf(bp);
  const groups = [
    { key: 'customers-market', kind: 'market', label: `Your market${industry ? ` (${clip(industry, 40)})` : ''}`, prompt: 'The market', list: facts.filter((f) => !BUYER_KEYS.includes(f.key)) },
    { key: 'customers-buyers', kind: 'buyers', label: 'Your business customers', prompt: 'The business customers', list: facts.filter((f) => BUYER_KEYS.includes(f.key)) }
  ];
  for (const g of groups) {
    if (!g.list.length) continue;
    const join = g.list.some((f) => f.text.includes(',')) ? '; ' : ', ';
    answers += g.list.length;
    items.push(makeItem({
      key: g.key, source: 'customers', kind: g.kind, confidence: 'strong',
      text: `${g.label}: ${g.list.map((f) => (g.kind === 'buyers' ? f.text.replace(/^business customers are /, '') : own(f.text))).join(join)}.`,
      promptLine: `${g.prompt}: ${g.list.map((f) => third(f.text)).join(join)}.`,
      evidenceCount: g.list.length, evidenceUnit: 'answers', evidenceText: `from ${plural(g.list.length, 'answer', 'answers')} in your business profile`
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
