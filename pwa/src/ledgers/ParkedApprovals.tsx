// The parked-approvals group of the Waiting screen (approvals PR 3): each parked permission prompt of a child, with Allow and
// Deny. The ruling is a credential act, so it runs through `useStepUp`'s `runAct` like the replay quiz's (one run, the step
// shown again on `step-up-required`). Ring L4: every word is `parkedApprovalWords.ts`'s; the input is drawn as text only.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '@ccrc/ui';
import type { ParkedApprovalView } from '../../../shared/api';
import { ConfirmItsYou } from '../accounts/ConfirmItsYou';
import { useStepUp, type StepUpDeps } from '../accounts/useStepUp';
import { ApiError, api } from '../lib/api';
import {
  ALLOW_WORD, DENY_WORD, PARKED_HEADING, RECORDED_WORD, parkedOldestFirst, parkedRefusalText, parkedRowLine, ruledLine,
} from './parkedApprovalWords';

const NO_STEP_UP_DEPS: StepUpDeps = {};
const ASSUME_FRESH = Infinity;
export type RuleParked = (id: number, verdict: 'allow' | 'deny') => Promise<unknown>;
const defaultRule: RuleParked = (id, verdict) => api.ruleParkedApproval(id, verdict);

export function ParkedApprovals({ approvals, rule = defaultRule, stepUpDeps = NO_STEP_UP_DEPS }: {
  readonly approvals: readonly ParkedApprovalView[] | undefined; readonly rule?: RuleParked; readonly stepUpDeps?: StepUpDeps;
}): ReactNode {
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<ReadonlyMap<number, string>>(new Map());
  const stepUp = useStepUp(ASSUME_FRESH, stepUpDeps);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  if (approvals === undefined || approvals.length === 0) return null;
  const say = (id: number, text: string): void => { if (mounted.current) setSaid((m) => new Map(m).set(id, text)); };
  const answer = async (id: number, verdict: 'allow' | 'deny'): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      let done = false;
      const outcome = await stepUp.runAct(async () => { await rule(id, verdict); done = true; });
      if (outcome === 'done' && done) say(id, RECORDED_WORD);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return;
      say(id, parkedRefusalText(err));
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  return (
    <section className="wl-group" aria-label={PARKED_HEADING} data-parked-approvals>
      <h2 className="wl-group-title">{PARKED_HEADING}</h2>
      <ul className="wl-rows">
        {parkedOldestFirst(approvals).map((a) => (
          <li key={a.id} className="wl-row" data-parked-approval={a.id}>
            <p>{parkedRowLine(a)}</p>
            {a.input !== null && <pre className="wl-note">{a.input}</pre>}
            {a.ruled !== null
              ? <p role="status">{ruledLine(a.ruled)}</p>
              : (
                <div>
                  <Button variant="primary" size="fit" disabled={busy} onClick={() => { void answer(a.id, 'allow'); }}>{ALLOW_WORD}</Button>
                  <Button variant="ghost" size="fit" disabled={busy} onClick={() => { void answer(a.id, 'deny'); }}>{DENY_WORD}</Button>
                </div>
              )}
            {said.has(a.id) && <p role="status">{said.get(a.id)}</p>}
          </li>
        ))}
      </ul>
      <ConfirmItsYou stepUp={stepUp} subject="a permission ruling" />
    </section>
  );
}
