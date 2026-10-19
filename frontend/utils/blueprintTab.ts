/** Words and numbers for the Blueprint tab of Plan (pages/BlueprintRoutes.tsx, BlueprintTab). Pure, tested in tests/blueprintTab.test.mjs. */
import type { TileState } from './brandTiles';

export interface BlueprintRowLike { id: string; status: string }
export interface BlueprintPriceInput { tier?: string | null; blueprintQuarks?: number; pdfQuarks?: number }
interface TileWords { status: string; state: TileState; line: string; to: string }

const quarks = (n?: number) => (Number(n) > 0 ? `${Math.round(Number(n)).toLocaleString('en-IN')} Quarks` : '');
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export const BLUEPRINT_INTRO = 'A Growth Blueprint is a first look at where your business stands online and what to do in the next 90 days, made from your website and your Instagram page.';

export function blueprintSummary(items: BlueprintRowLike[] | null | undefined, price: BlueprintPriceInput): {
  intro: string; ready: TileWords; waiting: TileWords; price: { status: string; line: string }; pdf: { status: string; line: string };
} {
  const list = items || [];
  const known = Array.isArray(items);
  const ready = list.filter((b) => b.status === 'completed');
  const making = list.filter((b) => b.status === 'queued' || b.status === 'processing');
  const waiting = list.filter((b) => b.status === 'awaiting_approval' || b.status === 'stopped');
  const free = price.tier === 'free';
  const bp = quarks(price.blueprintQuarks);
  const pdf = quarks(price.pdfQuarks);
  return {
    intro: BLUEPRINT_INTRO,
    ready: {
      status: !known ? 'Checking' : ready.length ? plural(ready.length, 'ready', 'ready') : 'None yet',
      state: !known ? 'unknown' : ready.length ? 'added' : 'missing',
      line: making.length ? `${plural(making.length, 'Blueprint', 'Blueprints')} being prepared.` : ready.length ? 'Open one to read it.' : 'Create your first one.',
      to: ready[0] ? `/blueprint/${ready[0].id}` : '/blueprint/new',
    },
    waiting: {
      status: !known ? 'Checking' : waiting.length ? plural(waiting.length, 'Blueprint', 'Blueprints') : 'Nothing',
      state: !known ? 'unknown' : waiting.length ? 'partly' : 'added',
      line: waiting.length ? 'Check the details Nebulaa found, then it carries on.' : 'Nothing needs your answer.',
      to: waiting[0] ? `/blueprint/${waiting[0].id}` : '/blueprint/new',
    },
    price: free
      ? { status: 'Free', line: 'Your first Blueprint is free.' }
      : { status: bp || 'Priced on the form', line: 'For each Blueprint you make.' },
    pdf: { status: pdf || 'Priced on the form', line: 'A designed copy to share.' },
  };
}
