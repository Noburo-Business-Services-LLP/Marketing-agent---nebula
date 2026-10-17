/** The setup path card: ordered steps, one highlighted next step with a route. */
import type { SetupResponse, SetupStep } from '../types';

const ROUTES: Record<string, string> = {
  profile: '/settings?tab=business',
  socials: '/connect-socials',
  plan: '/plan',
  week: '/',
  choose: '/trial-expired',
};
const BUTTONS: Record<string, string> = {
  profile: 'Add your business details', socials: 'Connect your accounts', plan: 'Read your plan', week: 'See this week', choose: 'Choose a plan',
};

export interface NextStep extends SetupStep { to: string; button: string }
export interface CardModel { show: boolean; title: string; nextStep: NextStep | null; steps: SetupStep[]; waiting: string }

export function cardModel(setup: Partial<SetupResponse> | null | undefined): CardModel {
  const steps = Array.isArray(setup && setup.steps) ? (setup!.steps as SetupStep[]) : [];
  const empty: CardModel = { show: false, title: '', nextStep: null, steps, waiting: '' };
  if (!setup || !steps.length || setup.allDone) return empty;
  const found = steps.find((s) => s.id === setup.next && !s.done);
  const nextStep = found ? { ...found, to: ROUTES[found.id] || '/', button: BUTTONS[found.id] || 'Continue' } : null;
  const done = steps.filter((s) => s.done).length;
  return {
    show: true,
    title: `Get started: ${done} of ${steps.length} done`,
    nextStep,
    steps,
    waiting: nextStep ? '' : 'Your plan is being built. Your next step appears here when it is ready.',
  };
}
