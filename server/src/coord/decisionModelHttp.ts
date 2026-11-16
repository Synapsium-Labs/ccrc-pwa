// Overlord W2, the decision-model port's one adapter (spec 2026-11-09 §3.7 H6, Table 11.1c; plan
// docs/superpowers/plans/2026-11-16-overlord-w2/w2-decision-model.md, Task 3). Ring: L3, context Coordination (C5). One
// adapter for the three host kinds, built per call from one host snapshot (question 1): the kind decides policy only.
//
// ONE DEADLINE, ONE RETRY. The whole call, its address check and its one retry included, runs under one `AbortController`
// and one `time.scheduler.after(DECISION_DEADLINE_MS, …)`, whose `Cancel` is a local of the call, so this file stays L3 (a
// deadline inside one adapter call, never a scheduler). The retry runs only after a network error, a 429 or a 5xx, and only
// when more than `DECISION_RETRY_MIN_LEFT_MS` remain.
//
// THE KEY NEVER LEAVES BUT AS A BEARER HEADER. It is read from the caller's reader at each call, sent only in
// `authorization`, and appears in no answer. An answer carries the status code and the outcome word, never a response
// body's text, and this file writes no log line.
//
// THE ENDPOINT IS CHECKED AT EACH CALL (question 6, ruling F8). A `local` host must resolve to loopback or private addresses
// only, and an `http:` endpoint to loopback only, so a name that later resolves elsewhere is refused before any request.
import { DECISION_DEADLINE_MS, DECISION_RETRY_MIN_LEFT_MS, type DecisionHostKind } from '../../../shared/decisionModel.js';
import type { TimePorts } from '../time/ports.js';
import type { DecisionCall, DecisionFetch, DecisionModel, DecisionWireRequest } from './decisionModelPort.js';

/** The largest answer body read as an answer (64 KiB); a larger one is `malformed`, `too-large`. */
export const DECISION_ANSWER_MAX_BYTES = 65536;

/** What the key reader answers: the value, or why there is none. */
export type DecisionKeyRead = { kind: 'value'; value: string } | { kind: 'absent' | 'unreadable' };

export interface DecisionHttpDeps {
  fetch: DecisionFetch;
  /** Every address a host name resolves to. A literal address resolves to itself. */
  resolve: (hostname: string) => Promise<readonly string[]>;
  time: TimePorts;
  /** `decisionModel.ts#isPrivateAddress`, the rule the key door applies too. */
  isPrivateAddress: (address: string, loopbackOnly: boolean) => boolean;
}

const originOf = (endpoint: string): string | null => {
  try { return new URL(endpoint).origin; } catch { return null; }
};

export function createHttpDecisionModel(host: { kind: DecisionHostKind; endpoint: string }, key: () => DecisionKeyRead,
  deps: DecisionHttpDeps): DecisionModel {
  const origin = originOf(host.endpoint);
  return {
    kind: host.kind,
    origin: origin ?? '',
    async ask(req: DecisionWireRequest): Promise<DecisionCall> {
      const { clock, scheduler } = deps.time;
      const start = clock.mono();
      const ms = (): number => clock.mono() - start;
      const ac = new AbortController();
      let timedOut = false;
      const aborted = new Promise<never>((_, reject) => {
        ac.signal.addEventListener('abort', () => reject(new Error('deadline')), { once: true });
      });
      aborted.catch(() => undefined);
      const cancel = scheduler.after(DECISION_DEADLINE_MS, () => { timedOut = true; ac.abort(); });
      let attempts = 0;
      const unavailable = (why: Extract<DecisionCall, { outcome: 'unavailable' }>['why'], status: number | null = null): DecisionCall =>
        ({ ok: false, outcome: 'unavailable', why: timedOut ? 'timeout' : why, status, ms: ms(), attempts });
      try {
        if (origin === null) return unavailable('unreachable');
        const url = new URL(host.endpoint);
        const isHttp = url.protocol === 'http:';
        if (host.kind === 'local' || isHttp) {
          let addresses: readonly string[];
          try {
            addresses = await Promise.race([deps.resolve(url.hostname.replace(/^\[(.*)\]$/, '$1')), aborted]);
          } catch { return unavailable('unreachable'); }
          if (addresses.length === 0) return unavailable('unreachable');
          if (addresses.some((a) => !deps.isPrivateAddress(a, isHttp))) return unavailable('endpoint-not-private');
        }
        const k = key();
        if (k.kind !== 'value') return unavailable('no-key');
        const body = JSON.stringify(req);
        const retryable = (): boolean => attempts < 2 && DECISION_DEADLINE_MS - ms() > DECISION_RETRY_MIN_LEFT_MS;
        for (;;) {
          attempts += 1;
          let res: Awaited<ReturnType<DecisionFetch>>;
          try {
            res = await Promise.race([deps.fetch(host.endpoint, {
              method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${k.value}` }, body,
              signal: ac.signal, redirect: 'error',
            }), aborted]);
          } catch {
            if (!timedOut && retryable()) continue;
            return unavailable('unreachable');
          }
          const status = res.status;
          if (status === 401 || status === 403) return { ok: false, outcome: 'auth-failed', status, ms: ms(), attempts };
          if (status === 413) return { ok: false, outcome: 'over-size', status, ms: ms(), attempts };
          if (status === 429 || status >= 500) {
            if (!timedOut && retryable()) continue;
            return unavailable('server-error', status);
          }
          if (status < 200 || status > 299) return { ok: false, outcome: 'refused', status, ms: ms(), attempts };
          let text: string;
          try { text = await Promise.race([res.text(), aborted]); } catch { return unavailable('unreachable', status); }
          if (new TextEncoder().encode(text).length > DECISION_ANSWER_MAX_BYTES) {
            return { ok: false, outcome: 'malformed', why: 'too-large', ms: ms(), attempts };
          }
          let answer: unknown;
          try { answer = JSON.parse(text); } catch { return { ok: false, outcome: 'malformed', why: 'not-json', ms: ms(), attempts }; }
          return { ok: true, answer, ms: ms(), attempts };
        }
      } finally {
        cancel();
      }
    },
  };
}
