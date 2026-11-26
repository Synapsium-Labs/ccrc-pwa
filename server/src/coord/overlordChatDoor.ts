// The Overlord chat's two operator doors, every decision of theirs (Overlord W1, the chat, Tasks 2 and 3; plan
// `docs/superpowers/plans/2026-11-14-overlord-w1/w1-chat.md`, questions 1, 2, 9 and 12). Ring L1, context C5: pure, no store,
// no `fs`, no clock, no fastify. The routes file (L4) reads the facts and acts on what this file answers, so it decides nothing:
// the designation's three arms, each reader's answer as a fact, the thread's ledger line, the earlier page's generation row,
// plan, scope and answer.
//
// The reader shapes below are the consumer's (declared here, as a port is), so this file imports no adapter: the private store's
// `messagesPage`, the continuity store's `generationsOf` and the readiness store's `readinessChanges` each answer one of them.
//
// THE MEASURED ARM (Task 3 Step 1, `overlord-chat-earlier.test.ts`'s first case): no history verb names a conversation's newest
// entries, so `CHAT_EARLIER_PAGEABLE` is false, every earlier divider is `not-pageable`, and the earlier door refuses a page
// `bad-request` `not-pageable` until the history door gains its cursor. The items an `--around` page answers carry no
// conversation id, so when paging joins, the ledger scope names the `around` (step 7's second arm), never a whole generation.
import type { DesignationRead } from '../../../shared/overlord-designation.js';
import type { OperatorMessageRow } from '../../../shared/operatorMessages.js';
import type { ReadinessWord } from '../../../shared/overlord-readiness.js';
import { READ_SCOPE_MAX_CHARS } from '../../../shared/operatorMessages.js';
import type { RouteRefusal } from '../../../shared/refusal.js';
import type { ChatThread, GenerationKey } from '../../../shared/overlordChat.js';
import { designationFactFrom, identityOf } from '../roleOf.js';
import { composeChat, earlierPagePlan, type ChatFacts, type GenerationFact } from './overlordChat.js';
import type { HistoryDoorAnswer } from './overlordHistory.js';
import type { OverlordHistoryRequest } from '../../../shared/overlordHistory.js';

/** Task 3 Step 1's measured arm: no history verb names a conversation's newest entries (`not-pageable`). */
export const CHAT_EARLIER_PAGEABLE = false;
/** The thread door's page of messages. */
export const CHAT_PAGE_ROWS = 100;

/** What a door hands the read runner to answer (the runner's `ReadComposed`, structurally). */
export type ChatComposed =
  | { readonly kind: 'rows'; readonly body: unknown; readonly scope: string; readonly count: number }
  | { readonly kind: 'answer'; readonly body: unknown; readonly scope: string; readonly outcome: string }
  | { readonly kind: 'refuse'; readonly word: RouteRefusal; readonly detail?: string;
      readonly extra?: { readonly cause?: string; readonly refusal?: string }; readonly scope: string; readonly outcome: string };

// ── the designation ───────────────────────────────────────────────────────────────────────────────────────────────────

/** The designation's three arms for a chat door: an unreadable designation refuses 502 `unmeasured` and draws no thread; none is
 *  a measured absence, answered 200 with no entries and no read; a designated session carries its id, its term and the identity
 *  its generations are keyed by (`identityOf`, question 12). */
export type ChatDesignation =
  | { readonly kind: 'refuse'; readonly word: 'unmeasured'; readonly detail: string }
  | { readonly kind: 'none'; readonly thread: ChatThread }
  | { readonly kind: 'designated'; readonly sessionId: string; readonly term: number; readonly identity: string };

export function chatDesignation(read: DesignationRead): ChatDesignation {
  const fact = designationFactFrom(read);
  if (read.kind === 'unmeasured' || fact === 'unmeasured') {
    return { kind: 'refuse', word: 'unmeasured', detail: 'the Overlord designation could not be read' };
  }
  if (read.kind === 'not-designated') {
    return { kind: 'none', thread: composeChat({ designation: { kind: 'none' }, messages: NONE_PART, generations: NONE_PART, readiness: NONE_PART, pageable: CHAT_EARLIER_PAGEABLE }) };
  }
  return { kind: 'designated', sessionId: read.sessionId, term: read.term, identity: identityOf(read.sessionId, fact) };
}
const NONE_PART = { kind: 'unmeasured', why: 'no Overlord is designated' } as const;

// ── each reader's answer, as a fact ───────────────────────────────────────────────────────────────────────────────────

/** `messagesPage`'s answer. */
export type MessagesPageRead =
  | { readonly kind: 'measured'; readonly value: { readonly rows: readonly OperatorMessageRow[]; readonly more: boolean } }
  | { readonly kind: 'unmeasured'; readonly why: string };
/** `generationsOf`'s answer. */
export type GenerationsRead =
  | { readonly ok: true; readonly rows: readonly GenerationFact[] } | { readonly ok: false; readonly detail: string };
/** `readinessChanges`' answer (its rows carry more columns; the chat reads `at` and `word`). */
export type ReadinessChangesRead =
  | { readonly ok: true; readonly rows: readonly { readonly at: number; readonly word: ReadinessWord }[]; readonly oldest: number | null }
  | { readonly ok: false; readonly detail: string };

export const messagesFact = (r: MessagesPageRead): ChatFacts['messages'] =>
  r.kind === 'measured' ? { kind: 'rows', rows: r.value.rows, more: r.value.more } : { kind: 'unmeasured', why: r.why };

export const generationsFact = (r: GenerationsRead): ChatFacts['generations'] =>
  r.ok ? { kind: 'rows', rows: r.rows } : { kind: 'unmeasured', why: r.detail };

export const readinessFact = (r: ReadinessChangesRead): ChatFacts['readiness'] =>
  r.ok ? { kind: 'rows', rows: r.rows.map((c) => ({ at: c.at, word: c.word })), oldest: r.oldest } : { kind: 'unmeasured', why: r.detail };

// ── the thread door ───────────────────────────────────────────────────────────────────────────────────────────────────

/** A door's scope: the canonical target, cut to the ledger's bound by dropping the session (never a line the ledger refuses). */
const scopeOf = (full: string, short: string): string => (full.length <= READ_SCOPE_MAX_CHARS ? full : short);

/** The thread's answer for the runner. Its line counts the messages it hands. A thread whose messages were read is a served line
 *  (`rows`), whatever else could not be read, because it hands the operator's words, so it counts against the console's ceiling
 *  (slug `chat-line-counts-every-read-with-words`); one whose messages could not be read hands none and records
 *  `messages-unmeasured`. The 200 is the same either way: an unreadable part is in the thread as `unmeasured`. */
export function chatThreadComposed(thread: ChatThread): ChatComposed {
  const scope = scopeOf(`session:${thread.sessionId ?? 'none'}`, 'session');
  const count = thread.entries.filter((e) => e.kind === 'message').length;
  if (thread.messages.kind === 'read') return { kind: 'rows', body: thread, scope, count };
  return { kind: 'answer', body: thread, scope, outcome: 'messages-unmeasured' };
}

// ── the earlier door ──────────────────────────────────────────────────────────────────────────────────────────────────

/** The earlier page's ledger scope: the row's session, the term and the generation, and the `around` when one names the page
 *  (step 7's second arm, measured). Past the ledger's bound, the session is dropped. */
export function earlierScope(gen: GenerationKey, sessionId: string | null, around: string | null): string {
  const tail = `term:${gen.term}:gen:${gen.n}${around === null ? '' : `:around:${around}`}`;
  return sessionId === null ? tail : scopeOf(`session:${sessionId}:${tail}`, tail);
}

/** The earlier door's step after the ceiling: a composed refusal (the generations unreadable, or the page plan's refusal, each
 *  400 or 502 with its line), or the request to send and the scope its line names. */
export type EarlierStep =
  | { readonly kind: 'composed'; readonly composed: ChatComposed }
  | { readonly kind: 'read'; readonly request: OverlordHistoryRequest; readonly scope: string };

export function earlierStep(gens: ChatFacts['generations'], gen: GenerationKey, around: string | null, pageable: boolean): EarlierStep {
  if (gens.kind === 'unmeasured') {
    return { kind: 'composed', composed: { kind: 'refuse', word: 'unmeasured', detail: 'the generations could not be read', scope: earlierScope(gen, null, around), outcome: 'generations-unmeasured' } };
  }
  const row = gens.rows.find((g) => g.term === gen.term && g.n === gen.n) ?? null;
  const scope = earlierScope(gen, row?.sessionId ?? null, around);
  const plan = earlierPagePlan(row, around, pageable);
  if (plan.kind === 'refuse') return { kind: 'composed', composed: { kind: 'refuse', word: 'bad-request', detail: plan.why, scope, outcome: plan.why } };
  return { kind: 'read', request: plan.request, scope };
}

/** The history door's mapping (`historyDoorAnswer`, unchanged) as the earlier door answers it: the page under its generation's
 *  key, or the refusal with its own fields. `rows` is the one served line. */
export function earlierComposed(gen: GenerationKey, a: HistoryDoorAnswer, scope: string): ChatComposed {
  if (a.kind === 'refuse') return { kind: 'refuse', word: a.word, extra: a.extra, scope, outcome: a.outcome };
  const { ok: _ok, ...page } = a.body;
  const body = { ok: true, gen, page };
  return a.kind === 'rows' ? { kind: 'rows', body, scope, count: a.count } : { kind: 'answer', body, scope, outcome: a.outcome };
}
