/**
 * THE ONE RETIRE EXECUTOR LOOP (D-7167; ARCH-44, consolidation spec K1): `retireAct` drives one reason's row through
 * `decideRetire` with that reason's port, so the three retire executors (temp-orphan, archive-expired, child-spent) can
 * share one loop instead of three hand-written ladders. Each reason keeps its readers, its act, its hooks and its notice
 * in its own file (the port); this file only orders them.
 *
 * The order is fixed. For each `{ need: step }` the decider answers, the step's reader runs (and makes the side effect
 * of computing its fact, at that point), then the decider is asked again. When a judge answers an outcome, the port's
 * `answered(step, outcome, facts)` runs once, synchronously, with the step that answered; then the port's `notice` when
 * the row's notice home is `executor`; then the outcome is returned. On `{ act: true }`: the act, then `afterAct` (which
 * decides by the act's outcome), then the notice. `answered` never runs for a step that passed, nor after an act
 * (D-7199: a reader's own effect, or the outcome hook, are the only two homes of a gate's side effects).
 *
 * A reader's answer is awaited only when it is a promise, never a plain value, so a run of `sync` steps after the last
 * async one, and the act's own synchronous prefix up to its first `await`, run in one synchronous segment. A rejection
 * follows its step's mode (D-7226): a `judged` step's rejection becomes its fact (`RetireRejected`), which its judge
 * answers; a `propagate` step's rejection rejects `retireAct` with the same error, with no outcome hook, no notice, no
 * after-act hook and no later reader. A synchronous throw is a rejection of its step's mode. The act propagates.
 *
 * The loop never asks which reason it runs: every difference is a field of the row. It drives ports only: its one
 * runtime import is `retire.ts`, and it holds no timer and imports no I/O.
 */
import { RETIRE_NOTICE_HOMES, RetireRejected, decideRetire } from './retire.js';
import type { RetireFactSet, RetireReason, RetireStep } from './retire.js';

/** A step's fact as its reader answers it: never absent, and never a judged rejection (the loop makes that one). */
type RetireReadFact<Facts, S extends keyof Facts> = Exclude<Facts[S], undefined | RetireRejected>;

/** One reason's port: what `retireAct` drives.
 *  - `read`: the row's readers, one per step, each over the facts read before it (the `audit` step's reader runs the
 *    audit). Each answers its fact or a promise of one, and may make the side effect of computing it.
 *  - `act`: the act, over every fact.
 *  - `answered`: the outcome hook, for an effect that depends on the outcome a judge answered and on the step that
 *    answered it.
 *  - `afterAct`: the after-act hook, for an effect after the act; it decides by the act's outcome.
 *  - `notice`: the notice writer, called only when the row's notice home is `executor`. */
export interface RetireActPort<Req, Facts extends RetireFactSet, Out> {
  readonly read: {
    readonly [S in keyof Facts & RetireStep]-?: (facts: Facts, req: Req) => RetireReadFact<Facts, S> | Promise<RetireReadFact<Facts, S>>;
  };
  readonly act: (facts: Facts, req: Req) => Out | Promise<Out>;
  readonly answered?: (step: RetireStep, outcome: Out, facts: Facts) => void;
  readonly afterAct?: (outcome: Out, facts: Facts) => void | Promise<void>;
  readonly notice?: (outcome: Out) => void;
}

/** Drive `reason`'s row for `req` through `port`, in the order this file's header fixes, to the reason's outcome. */
export async function retireAct<Req, Facts extends RetireFactSet, Out>(
  port: RetireActPort<Req, Facts, Out>, reason: RetireReason<Req, Facts, Out>, req: Req,
): Promise<Out> {
  const facts: { [S in RetireStep]?: unknown } = {};
  const specs = [...reason.decide, reason.audit, ...reason.act];
  const readers = port.read as { readonly [S in RetireStep]?: (facts: Facts, req: Req) => unknown };
  const noticed = reason.notice === RETIRE_NOTICE_HOMES.executor;
  let last: RetireStep | null = null;
  for (;;) {
    const d = decideRetire(facts as Facts, reason, req);
    if ('outcome' in d) {
      // The decider walks from the first step over pure judges, so the step that answers is the one just read.
      if (last === null) throw new Error('retireAct: an outcome before any step was read');
      port.answered?.(last, d.outcome, facts as Facts);
      if (noticed) port.notice?.(d.outcome);
      return d.outcome;
    }
    if ('act' in d) break;
    const step = d.need;
    const spec = specs.find((s) => s.step === step);
    const reader = readers[step];
    if (spec === undefined || reader === undefined) throw new Error(`retireAct: no reader for step ${step}`);
    last = step;
    let v: unknown;
    try {
      v = reader(facts as Facts, req);
      if (v instanceof Promise) v = await v;
    } catch (err) {
      if (spec.onReject !== 'judged') throw err;
      v = new RetireRejected(err);
    }
    // An absent fact would be asked for again, forever: a reader that answers nothing is a broken port.
    if (v === undefined) throw new Error(`retireAct: the reader of step ${step} answered no fact`);
    facts[step] = v;
  }
  const answer = port.act(facts as Facts, req);
  const outcome = answer instanceof Promise ? await answer : answer;
  const after = port.afterAct?.(outcome, facts as Facts);
  if (after instanceof Promise) await after;
  if (noticed) port.notice?.(outcome);
  return outcome;
}
