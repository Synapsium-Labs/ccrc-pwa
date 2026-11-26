// The console's prompt to the designated session: recorded, then nudged through the mail lane (Overlord W1 private store,
// Task 5; spec §3.8 H7, §3.3.11; open questions 3, 5, 6, 7, 8, 13, 17). Ring L4, context C11: it decides nothing. The route in
// `server.ts` asks `promptTargetVerdict` (L1) and calls this only for `record`; this asks the account gate, the deciders
// (`promptBodyVerdict` for the body's shape and the order of its refusals, `settlementMarkOf`, the store's `capMessageText`) and
// the store, and acts on what they answer. Its one check of its own is that the two stores it was handed are present (`unavailable`).
//
// RECORDED BEFORE DELIVERED. The row and its privacy-journal record commit in `operator-model.db` first. Only then, in ONE
// `coord.db` transaction, the nudge mail is queued and W1a's mark `@overlord` is written; and with no `await` after the
// transaction, `moveMessage(id, 'queue', 'route')` with its sequence line (`messageLine.ts`). No transaction spans the two files. NOTHING is typed into the pane here:
// the nudge is a delivery of the mail lane, one fixed line that names the id and the `messages` door, never the words. A
// failed record queues no nudge and answers a refusal; a throw after the record leaves the row `recorded` (the boot pass and
// the inbox both see it), still answers `ok` because the words are recorded, and logs the id only.
//
// NO MESSAGE TEXT leaves the store: not in `coord.db`, a log line, a refusal or a feed row. A retried send (the same
// `sendKey`) answers the first record with `replay: true` and queues, marks and moves nothing.
import type { AccountGateAnswer, AccountGateAsk } from '../accounts/gate.js';
import { SHAPE_ONLY_MASKER, type SecretMasker } from '../accounts/mask.js';
import type { CallerIdentity } from '../auth/callerIdentity.js';
import { REFUSAL_STATUS, type RouteRefusal } from '../../../shared/refusal.js';
import type { MessageState } from '../../../shared/operatorMessages.js';
import type { DesignationRead } from '../../../shared/overlord-designation.js';
import { promptTargetVerdict, settlementMarkOf } from './messages.js';
import { promptBodyVerdict } from './promptBody.js';
import { queueOperatorNudge, type NudgeQueueCoord } from './nudgeQueue.js';
import { moveOperatorMessage, stampOperatorMessageLine } from './messageLine.js';
import type { OperatorModelStore, StoreWriteError } from './store.js';

/** The route's reading of "no coordination store": nobody is designated, so every prompt takes today's typing path. */
export const NO_DESIGNATION: DesignationRead = { kind: 'not-designated', row: null };

/** What the act needs, handed in by the route: the gate and the identity port, the private store and the coordination store
 *  (absent on a box without them: `unavailable`), the egress mask (`SHAPE_ONLY_MASKER` where nothing wires the table), the
 *  server's wall clock and its log. */
export interface PromptRecordDeps {
  /** The account gate, bound to the request by the route; it writes its own refusal reply. */
  readonly gate: (ask: AccountGateAsk) => AccountGateAnswer;
  readonly identity: Pick<CallerIdentity, 'operator'>;
  readonly store: Pick<OperatorModelStore, 'recordMessage' | 'moveMessage'> | undefined;
  readonly coord: NudgeQueueCoord | undefined;
  readonly masker?: Pick<SecretMasker, 'maskText'>;
  readonly wall: () => number;
  readonly warn: (line: string) => void;
}

/** What the act answers: the gate already wrote its refusal (`replied`), or a plain status and body for the route to send. The act
 *  holds no reply object, so no web-framework type reaches it. */
export type PromptRecordAnswer = { readonly kind: 'replied' } | { readonly kind: 'answer'; readonly status: number; readonly body: Record<string, unknown> };
const refuse = (error: RouteRefusal, extra: Record<string, unknown> = {}): PromptRecordAnswer =>
  ({ kind: 'answer', status: REFUSAL_STATUS[error], body: { ok: false, error, ...extra } });

/** The refusal word of each store failure. `refused` is the store's own `bad-request`, with its detail. */
const STORE_REFUSAL: Readonly<Record<Exclude<StoreWriteError, 'refused'>, 'journal-unreadable' | 'journal-unwritable' | 'write-failed' | 'unavailable'>> = {
  'journal-unreadable': 'journal-unreadable', 'journal-unwritable': 'journal-unwritable', 'write-failed': 'write-failed', 'not-open': 'unavailable',
};

/** The re-ask the typed path makes INSIDE `sendPrompt`'s queue slot, right before its first key (review 2550 F1): `go` while the
 *  verdict is still `type`, `stop` when the designation moved while the call waited its turn (a `goLive` in that wait), so the words
 *  are recorded or refused by the route and never typed unrecorded into a now-live Overlord. */
export const promptRecheck = (read: () => DesignationRead, sessionId: string, body: { readonly overlordTerm?: unknown; readonly offRecord?: unknown }): (() => 'go' | 'stop') =>
  () => (promptTargetVerdict(read(), sessionId, body).kind === 'type' ? 'go' : 'stop');

/** The body's fields this act reads. The key is read by a field constant, not as a property or a literal element: `sendKey` is one of the pane typers'
 *  names, which `single-definition/injected-prompts.test.ts` reserves in `server/src` (slug `send-key-field-is-composed-key`). */
type PromptBody = { readonly text?: unknown; readonly attachments?: unknown; readonly offRecord?: unknown };
const SEND_KEY_FIELD = 'sendKey';
const sendKeyOf = (body: PromptBody): unknown => (body as Record<string, unknown>)[SEND_KEY_FIELD];

/** One prompt to the designated session at `term`. Answers through `reply`; the account gate writes its own refusals. */
export async function recordOperatorPrompt(
  deps: PromptRecordDeps, sessionId: string, term: number, body: PromptBody,
): Promise<PromptRecordAnswer> {
  const pass = deps.gate({ cap: null });
  if (!pass.pass) return { kind: 'replied' };
  const bodyVerdict = promptBodyVerdict(body, sendKeyOf(body));
  if (bodyVerdict.kind === 'refuse') return refuse(bodyVerdict.word, bodyVerdict.detail === undefined ? {} : { detail: bodyVerdict.detail });
  const key = bodyVerdict.key;
  const { store, coord } = deps;
  if (store === undefined || coord === undefined) return refuse('unavailable');

  const text = (deps.masker ?? SHAPE_ONLY_MASKER).maskText(bodyVerdict.text);
  const at = deps.wall();
  const recorded = store.recordMessage({
    at, sessionId, term, actor: deps.identity.operator(pass.actor), text, mark: settlementMarkOf(text) === 'mark',
    composedKey: key, offRecord: body.offRecord === true,
  });
  if (!recorded.ok) {
    return recorded.error === 'refused'
      ? refuse('bad-request', { detail: recorded.detail })
      : refuse(STORE_REFUSAL[recorded.error], { detail: recorded.detail });
  }
  const { id, cut, replay, offRecord } = recorded.value;
  let state: MessageState | 'unknown' = recorded.value.state;
  const lines = { store, coordDb: coord.db, warn: deps.warn };
  if (!replay) {
    // From here the words are recorded: nothing below changes the answer's `ok`. A marked message was created settled: its line
    // is the route's, right after the record commits (call 1218); creation as `recorded` stamps no line.
    if (recorded.value.state === 'settled') stampOperatorMessageLine(lines, id, 'settled', 'route', at);
    try {
      const queued = queueOperatorNudge(coord, sessionId, id, at, deps.warn);
      // No `await` between the committed queue and its move, nor between the move and its line.
      if (queued) {
        const moved = moveOperatorMessage(lines, id, 'queue', 'route', at);
        if (moved.ok) state = moved.value.state;
        else deps.warn(`ccrc-server: prompt: message ${id} queue move refused (${moved.error})`);
      }
    } catch {
      deps.warn(`ccrc-server: prompt: message ${id} is recorded and its nudge was not queued`);
    }
  }
  return { kind: 'answer', status: 200, body: { ok: true, messageId: id, cut, state, replay, offRecord } };
}
