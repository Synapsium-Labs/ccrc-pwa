// The programme page's read of its plan and the work map beside it (programme work map WM4, D-8823; plan Task WM4). Ring L4: a
// hook that asks the server and holds the last result; every decision about an answer is `workRead.ts`'s (L1).
//
// It reads on arrival and again whenever `key` moves (`planKey`: this programme's runs as `id:state:stuck`, its items as
// `id:state`, from the frames the store already holds). An answer that comes back after the key has moved again, or the slug has
// changed, is dropped. The page alone keeps the last view (review 2268 F15): the card keeps none.
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { apiErrorText } from '../lib/refusalWords';
import { workCardOf, workReadNext, type WorkRead } from './workRead';
import type { WorkCardAnswer } from './workMapWords';

/** What the page draws: the card's answer and when its view was read, or null for no card (nothing read yet, or an older server). */
export function useWorkRead(slug: string, key: string): { answer: WorkCardAnswer; readAt: number } | null {
  const [read, setRead] = useState<WorkRead | null>(null);
  useEffect(() => {
    let live = true;
    api.plan(slug).then(
      (answer) => { if (live) setRead((prev) => workReadNext(prev, slug, { answer }, Date.now())); },
      (err: unknown) => { if (live) setRead((prev) => workReadNext(prev, slug, { failed: apiErrorText(err) }, Date.now())); },
    );
    return () => { live = false; };
  }, [slug, key]);
  return workCardOf(read, slug);
}
