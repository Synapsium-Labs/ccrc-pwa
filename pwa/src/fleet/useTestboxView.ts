// Test box plan TB10 (D-7412; spec 2026-10-28 §2.7 "The card"): the Settings card's read of `GET /api/testbox`, the
// block TB9's poll last decided (`server/src/testbox.ts`, D-7411). The hook has `useDispatchAbandonView`'s shape: the
// newest issued request is authoritative, a failed poll keeps the last GOOD view beside its failure, the page becoming
// visible re-polls, `pollMs <= 0` is the injected mode, and a not-available answer (an older server's 404) drops the
// view. The block's type is the server's L1 decider's, restated here as the wire the card reads (the PWA never imports
// `server/src`), and `asTestboxBlock` is its one guard (D-7566): every field the card draws is checked, the box's
// status answer through `shared/testbox.ts`'s one frame reader, so a block this build cannot read is a failed read,
// never a half-drawn card.
//
// D-7444: the STATE and the SWITCH are two fields, never folded. The state is `off` only when no test box is
// configured; the switch is `on`, `off` or `unknown`.
import { useCallback, useState } from 'react';
import type { TestboxHostMeasure } from '../../../shared/agent-protocol';
import {
  isTestboxFallbackId, readTestboxFrame, TESTBOX_STATE_MAP, TESTBOX_TOOLS, type StatusAnswer, type TestboxFallbackId,
  type TestboxState,
} from '../../../shared/testbox';
import { api } from '../lib/api';
import { isCount, isRecord } from '../lib/wire';
import { settingsReadFailure, type SettingsReadFailure } from '../lib/notAvailable';
import { usePoll } from '../lib/usePoll';

/** The read's cadence: `CCRC_TESTBOX_POLL`'s default, the server poll's own beat. */
export const TESTBOX_POLL_MS = 30_000;

export type TestboxSwitch = 'on' | 'off' | 'unknown';

/** The last 24 hours of the runs log (D-7445), as the server counted it. */
export interface TestboxCounts {
  readonly remote: number;
  readonly fallback: number;
  readonly refused: number;
  readonly unreadable: number;
  readonly byReason: Readonly<Partial<Record<TestboxFallbackId, number>>>;
}

/** The block, as the card reads it (`server/src/testbox.ts`'s `TestboxBlock`; its `cells` are not read: the card
 *  marks each differing cell through `versionCellsDiffer` itself). */
export interface TestboxBlock {
  readonly state: TestboxState;
  readonly reasons: readonly string[];
  readonly summary: string;
  readonly switch: TestboxSwitch;
  readonly at: number;
  readonly host: TestboxHostMeasure | null;
  readonly box: StatusAnswer | null;
  readonly counts: TestboxCounts | null;
}

/** A landed read: the block, or `null` when the server's poll has not made its first pass. */
export interface TestboxRead { readonly block: TestboxBlock | null }

const SWITCHES: Record<TestboxSwitch, true> = { on: true, off: true, unknown: true };
const isText = (v: unknown): v is string => typeof v === 'string';
const own = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

function readHost(v: unknown): TestboxHostMeasure | null | undefined {
  if (v === null) return null;
  if (!isRecord(v) || !isRecord(v.tools)) return undefined;
  const tools = v.tools;
  if (!TESTBOX_TOOLS.every((t) => own(tools, t) && (tools[t] === null || isText(tools[t])))) return undefined;
  if (!(v.release === null || isText(v.release)) || !isText(v.measuredAt)) return undefined;
  return v as unknown as TestboxHostMeasure;
}

function readBox(v: unknown): StatusAnswer | null | undefined {
  if (v === null) return null;
  if (!isRecord(v) || v.t !== 'status') return undefined;
  const r = readTestboxFrame(JSON.stringify(v));
  return r.ok && r.value.t === 'status' ? r.value : undefined;
}

function readCounts(v: unknown): TestboxCounts | null | undefined {
  if (v === null) return null;
  if (!isRecord(v) || !isRecord(v.byReason)) return undefined;
  if (![v.remote, v.fallback, v.refused, v.unreadable].every(isCount)) return undefined;
  const by = v.byReason;
  if (!Object.keys(by).every((k) => isTestboxFallbackId(k) && isCount(by[k]))) return undefined;
  return v as unknown as TestboxCounts;
}

/** THE ONE GUARD of the block on the wire: the block, or `null` when any field the card draws is off. */
export function asTestboxBlock(v: unknown): TestboxBlock | null {
  if (!isRecord(v)) return null;
  if (!isText(v.state) || !own(TESTBOX_STATE_MAP, v.state)) return null;
  if (!isText(v.switch) || !own(SWITCHES, v.switch)) return null;
  if (!Array.isArray(v.reasons) || !v.reasons.every(isText) || !isText(v.summary)) return null;
  if (typeof v.at !== 'number' || !Number.isFinite(v.at)) return null;
  const host = readHost(v.host);
  const box = readBox(v.box);
  const counts = readCounts(v.counts);
  if (host === undefined || box === undefined || counts === undefined) return null;
  return {
    state: v.state as TestboxState, reasons: v.reasons as string[], summary: v.summary, switch: v.switch as TestboxSwitch,
    at: v.at, host, box, counts,
  };
}

/** The envelope `{ok, testbox}`: a read, or `null` when this build cannot read it. */
export function asTestboxRead(raw: unknown): TestboxRead | null {
  if (!isRecord(raw) || raw.ok !== true || !own(raw, 'testbox')) return null;
  if (raw.testbox === null) return { block: null };
  const block = asTestboxBlock(raw.testbox);
  return block === null ? null : { block };
}

export interface TestboxPoll {
  /** The LAST GOOD answer: a failed read keeps it; a not-available answer drops it. */
  view: TestboxRead | null;
  /** The latest poll's failure; null after a good answer. */
  failure: SettingsReadFailure | null;
  reload: () => void;
}

export function useTestboxView(pollMs: number = TESTBOX_POLL_MS): TestboxPoll {
  const [state, setState] = useState<{ view: TestboxRead | null; failure: SettingsReadFailure | null }>(
    { view: null, failure: null });
  const { reload: load } = usePoll({
    pollMs,
    request: () => api.testbox(),
    onOutcome: (outcome) => {
      if (outcome.ok) {
        const view = asTestboxRead(outcome.raw);
        setState((prev) => (view === null ? { view: prev.view, failure: 'failed' } : { view, failure: null }));
      } else {
        const failure = settingsReadFailure(outcome.err);
        setState((prev) => ({ view: failure === 'not-configured' ? null : prev.view, failure }));
      }
    },
  });
  const reload = useCallback(() => { load(); }, [load]);
  return { view: state.view, failure: state.failure, reload };
}
