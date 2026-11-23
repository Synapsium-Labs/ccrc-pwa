// Confirm the restore's banner (Overlord W1, authority journal C; spec §7.6, plan Task 8 and question 14,
// `confirm-control-ships-with-its-door`). Ring L4, context C5. Self-contained: it reads the authority guard's state
// (`GET /api/overlord/restore`), shows the refusal while the guard is not coherent, and offers Confirm the restore
// (`POST /api/overlord/restore/confirm`), a step-up act run once through `useStepUp`'s `runAct` (the step shown again on
// `step-up-required`). It hides once the guard reads coherent, and when the read fails (the Overlord's own doors say why). The
// Overlord's place mounts it with one line (home B).
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '@ccrc/ui';
import { ConfirmItsYou } from '../accounts/ConfirmItsYou';
import { useStepUp, type StepUpDeps } from '../accounts/useStepUp';
import { ApiError, api } from '../lib/api';

/** The guard's state as the read answers it (`overlordAuthorityCoherence.ts#AuthorityState`, its wire shape). */
export type AuthorityRead =
  | { readonly kind: 'coherent' }
  | { readonly kind: 'rolled-back'; readonly cause: string }
  | { readonly kind: 'unmeasured'; readonly why: string };

export const RESTORE_WORDS = {
  heading: 'Authority rolled back',
  confirm: 'Confirm the restore',
  refused: 'Refused',
  working: 'Confirming…',
} as const;

/** The one reader of the read's answer: one of the three states, or `null` for anything else (never a partial state). */
export function readAuthority(raw: unknown): AuthorityRead | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const a = (raw as { authority?: unknown }).authority;
  if (typeof a !== 'object' || a === null) return null;
  const { kind, cause, why } = a as { kind?: unknown; cause?: unknown; why?: unknown };
  if (kind === 'coherent') return { kind };
  if (kind === 'rolled-back' && typeof cause === 'string') return { kind, cause };
  if (kind === 'unmeasured' && typeof why === 'string') return { kind, why };
  return null;
}

/** The banner's sentence for a state that is not coherent. */
export function restoreLine(a: Exclude<AuthorityRead, { kind: 'coherent' }>): string {
  return a.kind === 'rolled-back'
    ? `The Overlord's authority reads authority-rolled-back (${a.cause}): a restore may have given back authority you took away. `
      + 'Its doors stay refused until you confirm the restore, which keeps the stricter of every setting.'
    : `The Overlord's authority journal cannot be read (${a.why}): its doors stay refused until it can be.`;
}

const NO_STEP_UP_DEPS: StepUpDeps = {};
const ASSUME_FRESH = Infinity;
const wordOf = (err: unknown): string => {
  if (err instanceof ApiError && typeof err.body === 'object' && err.body !== null) {
    const e = (err.body as { error?: unknown }).error;
    if (typeof e === 'string') return e;
  }
  return 'unavailable';
};

export function RestoreBanner({ stepUpDeps = NO_STEP_UP_DEPS }: { readonly stepUpDeps?: StepUpDeps }): ReactNode {
  const [state, setState] = useState<AuthorityRead | null>(null);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const stepUp = useStepUp(ASSUME_FRESH, stepUpDeps);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const read = useCallback(async (): Promise<void> => {
    let next: AuthorityRead | null = null;
    try { next = readAuthority(await api.overlordRestore()); } catch { next = null; }
    if (mounted.current) setState(next);
  }, []);
  useEffect(() => { void read(); }, [read]);

  if (state === null || state.kind === 'coherent') return null;
  const confirm = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setSaid(null);
    try {
      const outcome = await stepUp.runAct(() => api.confirmRestore());
      if (outcome === 'done') await read();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return;
      if (mounted.current) setSaid(`${RESTORE_WORDS.refused}: ${wordOf(err)}`);
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  return (
    <section role="alert" aria-label={RESTORE_WORDS.heading} data-restore-banner>
      <h2>{RESTORE_WORDS.heading}</h2>
      <p>{restoreLine(state)}</p>
      {state.kind === 'rolled-back' && (
        <Button variant="primary" size="fit" disabled={busy} onClick={() => { void confirm(); }}>
          {busy ? RESTORE_WORDS.working : RESTORE_WORDS.confirm}
        </Button>
      )}
      {said !== null && <p role="status">{said}</p>}
      <ConfirmItsYou stepUp={stepUp} subject="Confirm the restore" />
    </section>
  );
}
