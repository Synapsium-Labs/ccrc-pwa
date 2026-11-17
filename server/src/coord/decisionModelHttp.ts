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
// THE KEY IS BOUND TO ITS ORIGIN (review 2418 F1, the coordinator's ruling). The key door records the origin it was entered
// for in the slot's record (`writeServerSecret`'s `bound`), and the reader answers the value only to a call whose host
// snapshot has that origin: a key stored for another origin, or a key changed while a call planned with the old host was in
// flight, reads `not-bound`, and the call answers `no-key`. So a key is never sent to an origin it was not entered for.
//
// THE ENDPOINT IS CHECKED AT EACH CALL (question 6, ruling F8). A `local` host must name an address literal or `localhost`
// (review 2324 F2, the coordinator's ruling: a name could resolve one way for the check and another for the connect), and
// must resolve to loopback or private addresses only; an `http:` endpoint must resolve to loopback only.
//
// THE BODY IS CAPPED WHILE IT IS READ (review 2324 F6): reading stops at the first chunk past 64 KiB.
import type { ReadFailure } from '../../../shared/agent-protocol.js';
import {
  DECISION_DEADLINE_MS, DECISION_MODEL_KEY_SLOT, DECISION_RETRY_MIN_LEFT_MS, type DecisionHostKind,
} from '../../../shared/decisionModel.js';
import { readServerSecretMeta, readServerSecretValue } from './ledgersSecrets.js';
import type { TimePorts } from '../time/ports.js';
import { isLiteralHost, type DECISION_KEY_READ_WORDS } from './decisionModel.js';
import type { DecisionCall, DecisionFetch, DecisionModel, DecisionWireRequest } from './decisionModelPort.js';

/** The largest answer body read as an answer (64 KiB); a larger one is `malformed`, `too-large`. */
export const DECISION_ANSWER_MAX_BYTES = 65536;

/** What the key reader answers: the value, why there is none in the one absent/unreadable vocabulary (D-1438), or
 *  `not-bound`: a key is stored, but its record does not name the origin asked for (another origin's key, a record missing or
 *  one written before the binding, or a key that changed during the read). */
export type DecisionKeyRead = { kind: 'value'; value: string } | { kind: ReadFailure } | { kind: (typeof DECISION_KEY_READ_WORDS)[number] };

/** The key for one origin, read from its `.server` slot at each call (question 6; review 2418 F1): the slot's record is read
 *  before and after the value, and the value is answered only when both name `origin` and agree. The key door removes the old
 *  record before it writes a new value and writes the new record after, so no read pairs a value with an origin it was not
 *  entered for. Never logged; the adapter sends it only as the bearer header. */
export function readDecisionModelKey(ccrcDir: string, origin: string): DecisionKeyRead {
  const boundAt = (): number | 'none' | 'unreadable' | 'not-bound' => {
    const m = readServerSecretMeta(ccrcDir, DECISION_MODEL_KEY_SLOT);
    if (m === null) return 'none';
    if ('unreadable' in m) return 'unreadable';
    return m.setAt !== null && m.bound === origin ? m.setAt : 'not-bound';
  };
  const before = boundAt();
  if (before === 'none') {
    // No regular value file: the value read tells absent from unreadable (a directory or a link there), as before the binding.
    const r = readServerSecretValue(ccrcDir, DECISION_MODEL_KEY_SLOT);
    return r.state === 'unreadable' ? { kind: 'unreadable' } : r.state === 'absent' ? { kind: 'absent' } : { kind: 'not-bound' };
  }
  if (before === 'unreadable') return { kind: 'unreadable' };
  if (before === 'not-bound') return { kind: 'not-bound' };
  const r = readServerSecretValue(ccrcDir, DECISION_MODEL_KEY_SLOT);
  if (r.state !== 'value') return { kind: r.state === 'absent' ? 'absent' : 'unreadable' };
  return boundAt() === before ? { kind: 'value', value: r.value } : { kind: 'not-bound' };
}

export interface DecisionHttpDeps {
  fetch: DecisionFetch;
  /** Every address a host name resolves to. A literal address resolves to itself. */
  resolve: (hostname: string) => Promise<readonly string[]>;
  time: TimePorts;
  /** `decisionModel.ts#isPrivateAddress`, the rule the key door applies too. */
  isPrivateAddress: (address: string, loopbackOnly: boolean) => boolean;
}

/** The body's bytes, or `too-large` at the first chunk that takes it past the cap; leaving the loop cancels the stream. */
async function readCapped(body: AsyncIterable<Uint8Array> | null): Promise<Uint8Array | 'too-large'> {
  if (body === null) return new Uint8Array(0);
  const parts: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of body) {
    size += chunk.byteLength;
    if (size > DECISION_ANSWER_MAX_BYTES) return 'too-large';
    parts.push(chunk);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.byteLength; }
  return out;
}

const originOf = (endpoint: string): string | null => {
  try { return new URL(endpoint).origin; } catch { return null; }
};

/** `key` is asked for the key of this adapter's own origin (`readDecisionModelKey`), so a key bound to another origin is
 *  never sent here (review 2418 F1). */
export function createHttpDecisionModel(host: { kind: DecisionHostKind; endpoint: string }, key: (origin: string) => DecisionKeyRead,
  deps: DecisionHttpDeps): DecisionModel {
  const origin = originOf(host.endpoint);
  return {
    kind: host.kind,
    origin,
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
        if (origin === null) return unavailable('endpoint-unparseable');
        const url = new URL(host.endpoint);
        const isHttp = url.protocol === 'http:';
        const hostname = url.hostname.replace(/^\[(.*)\]$/, '$1');
        if (host.kind === 'local' && !isLiteralHost(hostname)) return unavailable('endpoint-not-literal');
        if (host.kind === 'local' || isHttp) {
          let addresses: readonly string[];
          try {
            addresses = await Promise.race([deps.resolve(hostname), aborted]);
          } catch { return unavailable('unreachable'); }
          if (addresses.length === 0) return unavailable('unreachable');
          if (addresses.some((a) => !deps.isPrivateAddress(a, isHttp))) return unavailable('endpoint-not-private');
        }
        let k: DecisionKeyRead;
        try { k = key(origin); } catch { return unavailable('no-key'); }
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
          let bytes: Uint8Array | 'too-large';
          try { bytes = await Promise.race([readCapped(res.body), aborted]); } catch { return unavailable('unreachable', status); }
          if (bytes === 'too-large') return { ok: false, outcome: 'malformed', why: 'too-large', ms: ms(), attempts };
          let answer: unknown;
          try { answer = JSON.parse(new TextDecoder().decode(bytes)); } catch { return { ok: false, outcome: 'malformed', why: 'not-json', ms: ms(), attempts }; }
          return { ok: true, answer, ms: ms(), attempts };
        }
      } finally {
        cancel();
      }
    },
  };
}
