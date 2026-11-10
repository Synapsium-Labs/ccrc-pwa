// D-8166 (test box connect plan TC15; spec 2026-11-07-test-box-connect-design.md §2.2): the connect flow's one read and
// one write door. It reads `GET /api/testbox/admin` (the status the verb wrote, and the ten newest ledger rows), asks again
// every `runningPollMs` while a long act runs (so a reload mid-install shows the same phase file), and runs one act through
// `POST /api/testbox/admin/:sub`, whose answer is the status RE-READ after the act: the card installs that and nothing it
// inferred. The caller owns the step-up (`useStepUp.runAct` wraps `act`), so a `step-up-required` refusal is rethrown.
//
// WHAT CROSSES. The status goes through `shared/testbox-admin.ts`'s one reader (it refuses an unknown field and any address
// text); a ledger row and an act's result are checked field by field below, so an answer this build cannot read is a failed
// read, never a half-drawn card. Nothing here ever holds an address once the form that typed it is gone.
import { useCallback, useState } from 'react';
import {
  TESTBOX_ACT_MAP, TESTBOX_ACT_OUTCOME_MAP, readTestboxAdminStatus, type TestboxAdminFields, type TestboxAdminStatus,
  type TestboxAdminSub,
} from '../../../shared/testbox-admin';
import type { TestboxEventRow, TestboxAdminResult } from '../../../shared/api';
import { ApiError, api } from '../lib/api';
import { TESTBOX_GATE_DARK_TEXT, refusalText, testboxRouteText } from '../lib/refusalWords';
import { usePoll } from '../lib/usePoll';
import { isRecord } from '../lib/wire';
import { writeOutcomeUnknown } from '../lib/apiError';

/** The cadence while a long act runs; otherwise the card reads once, and again after each act and on return to the page. */
export const TESTBOX_ADMIN_RUNNING_POLL_MS = 2_000;

/** Why a read did not land: the account gate's dark sentence (sign-in is required; no button is drawn), or a plain failure. */
export interface TestboxAdminFailure {
  /** The sentence of a dark gate (`auth-off`, `insecure-origin`), else null. */
  readonly dark: string | null;
  /** What the card says: the route's word in its sentence, else the card's floor. */
  readonly text: string | null;
}

export interface TestboxAdminHook {
  /** The last status that landed; a failed read keeps it. */
  readonly status: TestboxAdminStatus | null;
  readonly events: readonly TestboxEventRow[];
  /** The latest read's failure; null after a good one. */
  readonly failure: TestboxAdminFailure | null;
  /** A read is in flight and none has landed. */
  readonly loading: boolean;
  /** An act is in flight (the request, not the long act it started). */
  readonly busy: boolean;
  /** Runs one act and installs the re-read status. Resolves its result (`{}` for a sub that says nothing), or `unreadable` when
   *  a 2xx could not be read (the status is then re-read). Rejects with the route's `ApiError`: the caller reads the refusal. */
  readonly act: (sub: TestboxAdminSub, fields: TestboxAdminFields) => Promise<TestboxAdminResult | 'unreadable'>;
  readonly reload: () => void;
}

const isText = (v: unknown): v is string => typeof v === 'string';

/** One ledger row, or null when a field is off. */
function asEventRow(v: unknown): TestboxEventRow | null {
  if (!isRecord(v)) return null;
  const { id, at, actor, act, actId, outcome, code, fingerprint, fleetIdentity } = v;
  if (typeof id !== 'number' || typeof at !== 'number' || !isText(actor)) return null;
  if (!isText(act) || !Object.hasOwn(TESTBOX_ACT_MAP, act) || !isText(outcome) || !Object.hasOwn(TESTBOX_ACT_OUTCOME_MAP, outcome)) return null;
  const nullable = (x: unknown): x is string | null => x === null || isText(x);
  if (!nullable(actId) || !nullable(code) || !nullable(fingerprint) || !nullable(fleetIdentity)) return null;
  return v as unknown as TestboxEventRow;
}

/** The envelope `{ok, status, events}`: the status through the shared reader, the rows that fit. Null when the status is off. */
export function asTestboxAdminRead(raw: unknown): { status: TestboxAdminStatus; events: TestboxEventRow[] } | null {
  if (!isRecord(raw) || raw.ok !== true) return null;
  const read = readTestboxAdminStatus(JSON.stringify(raw.status));
  if (!read.ok) return null;
  const events = Array.isArray(raw.events) ? raw.events.map(asEventRow).filter((r): r is TestboxEventRow => r !== null) : [];
  return { status: read.value, events };
}

/** What an act answered beside the status: each piece of the closed result shape, anything else dropped. */
export function asTestboxAdminResult(raw: unknown): TestboxAdminResult {
  if (!isRecord(raw)) return {};
  const out: TestboxAdminResult = {};
  if (isText(raw.line)) out.line = raw.line;
  if (isText(raw.fingerprint)) out.fingerprint = raw.fingerprint;
  if (typeof raw.pass === 'boolean') out.pass = raw.pass;
  if (isText(raw.fixLine)) out.fixLine = raw.fixLine;
  if (isText(raw.act)) out.act = raw.act;
  if (typeof raw.cancelled === 'boolean') out.cancelled = raw.cancelled;
  if (Array.isArray(raw.checks)) {
    out.checks = raw.checks.flatMap((c): NonNullable<TestboxAdminResult['checks']> => (
      isRecord(c) && isText(c.check) && typeof c.ok === 'boolean' && (c.code === null || isText(c.code))
        ? [{ check: c.check, ok: c.ok, code: c.code as NonNullable<TestboxAdminResult['checks']>[number]['code'] }]
        : []));
  }
  return out;
}

/** A failed read in the card's terms. */
export function failureOf(err: unknown): TestboxAdminFailure {
  return { dark: refusalText(err, TESTBOX_GATE_DARK_TEXT), text: testboxRouteText(err) };
}

export function useTestboxAdmin(opts: { runningPollMs?: number } = {}): TestboxAdminHook {
  const [state, setState] = useState<{ status: TestboxAdminStatus | null; events: readonly TestboxEventRow[]; failure: TestboxAdminFailure | null; settled: boolean }>(
    { status: null, events: [], failure: null, settled: false });
  const [busy, setBusy] = useState(false);
  const running = state.status?.act?.outcome === 'running';
  const { reload, supersede } = usePoll({
    pollMs: running ? (opts.runningPollMs ?? TESTBOX_ADMIN_RUNNING_POLL_MS) : null,
    request: (signal) => api.testboxAdmin({ signal }),
    onOutcome: (outcome) => {
      if (outcome.ok) {
        const read = asTestboxAdminRead(outcome.raw);
        setState((prev) => (read === null
          ? { ...prev, failure: { dark: null, text: null }, settled: true }
          : { status: read.status, events: read.events, failure: null, settled: true }));
      } else {
        setState((prev) => ({ ...prev, failure: failureOf(outcome.err), settled: true }));
      }
    },
  });

  const act = useCallback<TestboxAdminHook['act']>(async (sub, fields) => {
    setBusy(true);
    try {
      const answer = await api.testboxAdminAct(sub, fields);
      supersede();
      const read = answer === 'unreadable' ? null : asTestboxAdminRead(answer);
      if (answer === 'unreadable' || read === null) { reload(); return 'unreadable'; }
      setState({ status: read.status, events: read.events, failure: null, settled: true });
      return asTestboxAdminResult(answer.result);
    } catch (err) {
      // A write that may have landed (no answer, a 5xx) is re-read; a 4xx is the route's own refusal and proves nothing was written.
      if (writeOutcomeUnknown(err) && !(err instanceof ApiError && err.status === 401)) reload();
      throw err;
    } finally {
      setBusy(false);
    }
  }, [reload, supersede]);

  return { status: state.status, events: state.events, failure: state.failure, loading: !state.settled, busy, act, reload: () => { reload(); } };
}
