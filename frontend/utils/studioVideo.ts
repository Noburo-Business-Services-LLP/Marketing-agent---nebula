/** Small rules for the Videos flow, kept apart from the page so they can be tested. */

export type StepKey = 'idea' | 'yours' | 'check' | 'result';

/** Can the person move on from the idea step? An idea, or a file read into one, is needed. */
export function canPlan(idea: string): boolean {
  return String(idea || '').trim().length >= 8;
}

/** "Maybe 2 minutes" copy for the wait, from how long it has been running. */
export function waitMessage(seconds: number): string {
  if (seconds < 20) return 'Planning the shots…';
  if (seconds < 60) return 'Filming your video…';
  if (seconds < 120) return 'Adding the voice and music…';
  return 'Almost there. This one is taking a little longer.';
}

/** Whole videos left for a balance: shown beside the price so a number of Quarks means something. */
export function videosLeft(balance: number, perVideo: number): number {
  if (!Number.isFinite(balance) || !Number.isFinite(perVideo) || perVideo <= 0) return 0;
  return Math.max(0, Math.floor(balance / perVideo));
}

// Changes the model shows clearly. A plain "make it night" barely moves an indoor shop, so it is not offered.
export const CHANGE_IDEAS = [
  'Add Diwali lamps and fairy lights',
  'Make it brighter and warmer',
  'Add more smiling people',
  'Make the music softer',
];
