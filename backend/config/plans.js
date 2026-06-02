const PLANS = {
  pro: {
    name: 'Pro',
    description: 'Essential AI marketing tools for solo creators',
    features: [
      '500 credits / month',
      'AI campaign generation',
      '2 social platforms',
      'Basic analytics',
      'Email support',
    ],
    cycles: {
      monthly:   { planId: 'plan_SwglziXMDTbcy5', amount: 5000,   label: 'Monthly',   per: '/month' },
      quarterly: { planId: 'plan_Sra8hXOnr41HRB', amount: 30000,  label: 'Quarterly', per: '/quarter' },
      annual:    { planId: 'plan_SraAlfXaHST15q', amount: 120000, label: 'Annual',    per: '/year' },
    },
  },
  growth: {
    name: 'Growth',
    description: 'Scale your brand across all major platforms',
    features: [
      '1,500 credits / month',
      'AI campaign generation',
      '5 social platforms',
      'Competitor intelligence',
      'Advanced analytics',
      'Priority support',
    ],
    cycles: {
      monthly:   { planId: 'plan_Sra3M5oVHjMHCH', amount: 15000,  label: 'Monthly',   per: '/month' },
      quarterly: { planId: 'plan_Sra993vFrplrY3', amount: 45000,  label: 'Quarterly', per: '/quarter' },
      annual:    { planId: 'plan_SraBDTTlxejfJ6', amount: 180000, label: 'Annual',    per: '/year' },
    },
  },
  scale: {
    name: 'Scale',
    description: 'Enterprise-grade automation for serious brands',
    features: [
      '3,000 credits / month',
      'AI campaign generation',
      'Unlimited social platforms',
      'Competitor + influencer tracking',
      'Full analytics suite',
      'Dedicated account manager',
      '24/7 priority support',
    ],
    cycles: {
      monthly:   { planId: 'plan_Sra3qdeqKtycGD', amount: 25000,  label: 'Monthly',   per: '/month' },
      quarterly: { planId: 'plan_Sra9zGhK2otFa9', amount: 75000,  label: 'Quarterly', per: '/quarter' },
      annual:    { planId: 'plan_SraByb2izvT2my', amount: 300000, label: 'Annual',    per: '/year' },
    },
  },
};

function findPlan(planId) {
  for (const [tier, plan] of Object.entries(PLANS)) {
    for (const [cycle, info] of Object.entries(plan.cycles)) {
      if (info.planId === planId) {
        return { tier, cycle, ...info };
      }
    }
  }
  return null;
}

module.exports = { PLANS, findPlan };
