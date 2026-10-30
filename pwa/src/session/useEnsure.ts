// L4 delivery: the one ensure (D-7189; W7 C7k; ARCH-75 #810). `POST /api/sessions/:id/ensure`, which Restart session,
// Wake, a main checkout's Restore and the Resume sheet's Revive all post, is sent from this file and nowhere else in
// `pwa/src` (`census-w7/pwa.ts#ensureCallers`, held at 1 by `rings/pwa-one-owner.test.ts`).
//
// Two shapes of one call. `ensureSession` is the call alone, for an owner that keeps its own state around it: the
// session screen's wake on open (its phase machine), SwapSheet's toast Wake and ArchiveSheet's restore (module
// functions, not components), and ResumeSheet's injectable `ensure` prop, whose default it is. `useEnsure` adds the
// busy state and the refusal toast for the two Restart buttons, each passing its own words through `failedTo` or its
// own sentence, so no owner's refusal text changes.
//
// The call reads `api.ensure` when it runs, never at import, so a suite that mocks `api.ensure` (a `vi.mock` of
// `lib/api` or a `vi.spyOn`) holds every owner through this one seam.
import { useState } from 'react';
import { toast } from '@ccrc/ui';
import { api } from '../lib/api';

/** The one call: `POST /api/sessions/:id/ensure`. */
export const ensureSession = (id: string): Promise<void> => api.ensure(id);

export interface Ensure {
  /** One ensure is in flight from this hook; a second press while it is out sends nothing. */
  readonly busy: boolean;
  /** Ensure `id`. On success `done` runs; on a refusal the toast says `refusal(err)`, as an error. */
  readonly ensure: (id: string, refusal: (err: unknown) => string, done?: () => void) => Promise<void>;
}

/** The Restart buttons' ensure: the call, its busy state and its refusal words. */
export function useEnsure(): Ensure {
  const [busy, setBusy] = useState(false);
  const ensure = async (id: string, refusal: (err: unknown) => string, done?: () => void): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      await ensureSession(id);
      done?.();
    } catch (err) {
      toast(refusal(err), 'error');
    } finally {
      setBusy(false);
    }
  };
  return { busy, ensure };
}
