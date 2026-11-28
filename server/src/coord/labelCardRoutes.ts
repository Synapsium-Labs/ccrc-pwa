// Overlord W2, the label cards' two doors (spec 2026-11-09 §3.7 H6, "Labels come only from the operator or from measured rows";
// §6.8; plan docs/superpowers/plans/2026-11-16-overlord-w2/w2-label-queue.md, Task 5, LQ9, LQ10, LQ12, LQ13; index F14). Ring:
// L4, context Attention & Notification (C6).
//
//   GET  /api/labels       the open cards, each rebuilt from its record, with the model's answer hidden
//   POST /api/labels/:id   one answer: a label, or "Not sure", which is no label
//
// UNDER THE SIGN-IN COOKIE (index F14, LQ9). Both doors ask the account gate with `{ cap: null }` and no step-up, so both refuse
// `auth-off`, `insecure-origin` and `unauthenticated` before reading anything; a label records the gate's actor. They consult no
// box token. The read is in `MASKED_GET_ROUTES`: a card may carry the operator's own cited words or a mail body.
//
// THE TEXT (the coordinator's ruling on the gap, call 1913). A card's fields are rebuilt at each read from its record's refs:
// a message through the private store's own by-id read, called here inside the read's handler and nowhere else (the census of
// operator-message readers holds that), and a mail body through the coordination store's one-row read. A card whose state does
// not resolve is skipped and counted under one word (absent, unmeasured, no-reader), never drawn empty and never from a copy.
//
// AT MOST TEN HANDED OVER (LQ2; the coordinator's ruling C1, call 1975). The read draws the shown cards in `handOverOrder` while
// `readDraws` allows, the weekly budget's own constant, and answers the rest as `heldBack`, a count, never silently. The answer
// door is unchanged: an answer for a held-back card is accepted as for any open card.
//
// DECIDE IN C6 (F13). The handlers read through `LabelCardStore`, the port this file declares as its consumer, ask
// `labelCards.ts` and `labelQueue.ts`, and pass the verdict to the store's close, which re-checks and writes and decides
// nothing else.
import type { FastifyInstance } from 'fastify';
import type { ReadFailure } from '../../../shared/agent-protocol.js';
import { DECISION_QUESTIONS, type DecisionRowId, type DecisionRowMode } from '../../../shared/decisionModel.js';
import type { CardView, LabelCardsAnswer, LabelSkipWord } from '../../../shared/labelQueue.js';
import type { AccountGate } from '../accounts/gate.js';
import { refuseRoute } from '../refuse.js';
import { utcIsoWeek } from '../time/rules.js';
import type { LabelledAnswer } from './decisionLines.js';
import { cardAnswerVerdict, cardFieldsOf, cardOptionsOf, cardView, type CardRefText } from './labelCards.js';
import { cardRefNeeds, cardShown, handOverOrder, readDraws, refKey, type LabelCardRow } from './labelQueue.js';

type Refs = Readonly<Record<string, string | readonly string[]>>;

/** The doors' store, declared here by its consumer and met by `labelQueueStore.ts#labelCardStoreOf` (C5). */
export interface LabelCardStore {
  /** Every open card with its row and revision; the handler filters through `cardShown`. */
  openCards(): readonly LabelCardRow[];
  /** One card, open or closed, or `absent`. */
  card(id: number): LabelCardRow | 'absent';
  /** The row's mode through the decision model's row read, or `unreadable`. */
  rowMode(row: DecisionRowId): DecisionRowMode | 'unreadable';
  /** A card's record's refs and inline fields. */
  record(recordId: number): { refs: Refs; inline: Readonly<Record<string, string>> | null } | ReadFailure;
  /** The cards picked in `week`. */
  pickedThisWeek(week: string): number;
  /** Told the verdict, it re-checks the card and the row in one transaction and writes the close and its label. */
  close(id: number, close: { outcome: 'labelled' | 'not-sure'; label: LabelledAnswer['label'] | null; actor: string; at: number;
    expect: { mode: 'shadow' | 'armed'; revision: string } }): 'closed' | 'already' | 'moved' | 'absent';
}

/** A message's text, through the private store's own read (`OperatorModelStore.messageById`). */
export interface LabelCardMessages {
  messageById(id: number): { kind: 'measured'; value: { readonly text: string } | 'absent' } | { kind: 'unmeasured'; why: string };
}
/** A mail's body, through the coordination store's one-row read (`CoordStore.mailOrigin`); null for no such mail. */
export interface LabelCardMail { mailOrigin(id: number): { readonly body: string } | null }

export interface LabelCardRouteDeps {
  readonly gate: AccountGate;
  readonly store: () => LabelCardStore | undefined;
  readonly messages: () => LabelCardMessages | undefined;
  readonly mail: () => LabelCardMail | undefined;
  readonly now: () => number;
}

/** The card's id from the path: a positive safe integer, else null. */
const idOf = (raw: unknown): number | null =>
  typeof raw === 'string' && /^[1-9][0-9]{0,15}$/.test(raw) && Number.isSafeInteger(Number(raw)) ? Number(raw) : null;
const NOT_WIRED = 'the label store is not wired on this server';

export function registerLabelCardRoutes(app: FastifyInstance, deps: LabelCardRouteDeps): void {
  app.get('/api/labels', async (req, reply) => {
    if (!deps.gate(req, reply, { cap: null }).pass) return reply;
    const store = deps.store();
    if (store === undefined) return refuseRoute(reply, 'unavailable', { detail: NOT_WIRED });
    const week = utcIsoWeek(deps.now()).key;
    const skipped: Record<LabelSkipWord, number> = { absent: 0, unmeasured: 0, 'no-reader': 0 };
    const cards: CardView[] = [];
    const shown: LabelCardRow[] = [];
    let heldBack = 0;
    const messages = deps.messages();
    const mail = deps.mail();
    for (const card of store.openCards()) {
      const mode = store.rowMode(card.row);
      if (mode === 'unreadable') { skipped.unmeasured++; continue; }
      if (cardShown(card, { mode, revision: DECISION_QUESTIONS[card.row].revision }) === 'shown') shown.push(card);
    }
    for (const card of handOverOrder(shown)) {
      // Past the tenth drawn card the rest are held back unread: their records and texts are not read (the ruling C1).
      if (!readDraws(cards.length)) { heldBack++; continue; }
      const q = DECISION_QUESTIONS[card.row];
      const rec = store.record(card.recordId);
      if (rec === 'absent') { skipped.absent++; continue; }
      if (rec === 'unreadable') { skipped.unmeasured++; continue; }
      const texts = new Map<string, CardRefText>();
      const needs = cardRefNeeds(q, rec.refs);
      if (needs.kind === 'reads') {
        for (const r of needs.reads) {
          for (const id of r.ids) {
            if (r.refKind === 'message') {
              const m = messages === undefined ? { kind: 'unmeasured' as const, why: 'no private store' } : messages.messageById(id);
              texts.set(refKey('message', id), m.kind === 'unmeasured' ? { kind: 'unmeasured', why: m.why }
                : m.value === 'absent' ? { kind: 'absent' } : { kind: 'resolved', text: m.value.text });
            } else {
              let body: { readonly body: string } | null | undefined;
              try { body = mail?.mailOrigin(id); } catch { body = undefined; }
              texts.set(refKey('mail', id), body === undefined ? { kind: 'unmeasured', why: 'the mail read failed' }
                : body === null ? { kind: 'absent' } : { kind: 'resolved', text: body.body });
            }
          }
        }
      }
      const f = cardFieldsOf(q, rec.refs, rec.inline, texts);
      if (f.kind === 'skip') { skipped[f.word]++; continue; }
      cards.push(cardView(card, q, f.fields, cardOptionsOf(q, rec.refs)));
    }
    const answer: LabelCardsAnswer = {
      ok: true, cards, open: shown.length, heldBack, pickedThisWeek: store.pickedThisWeek(week), week,
      skipped: { absent: skipped.absent, unmeasured: skipped.unmeasured, noReader: skipped['no-reader'] },
    };
    return answer;
  });

  app.post('/api/labels/:id', async (req, reply) => {
    const pass = deps.gate(req, reply, { cap: null });
    if (!pass.pass) return reply;
    const store = deps.store();
    if (store === undefined) return refuseRoute(reply, 'unavailable', { detail: NOT_WIRED });
    const id = idOf((req.params as { id?: unknown }).id);
    if (id === null) return refuseRoute(reply, 'bad-request', { detail: 'the card id is a positive integer' });
    const body = req.body as { answer?: unknown } | null | undefined;
    const answer = typeof body === 'object' && body !== null ? body.answer : undefined;
    // One re-read after a failed compare (`moved`): the row moved between this read and the close, so the verdict is asked again.
    for (let attempt = 0; attempt < 2; attempt++) {
      const card = store.card(id);
      if (card === 'absent') return refuseRoute(reply, 'not-found');
      const q = DECISION_QUESTIONS[card.row];
      const mode = store.rowMode(card.row);
      if (mode === 'unreadable') return refuseRoute(reply, 'write-failed', { detail: 'the row cannot be read' });
      const rec = store.record(card.recordId);
      const options = typeof rec === 'string' ? [] : cardOptionsOf(q, rec.refs);
      const v = cardAnswerVerdict(card, { mode, revision: q.revision, row: q, options }, answer);
      if (v.kind === 'already') return { ok: true, changed: false };
      if (v.kind === 'refuse') return refuseRoute(reply, v.word);
      if (mode === 'off') return refuseRoute(reply, 'row-changed');
      let closed: ReturnType<LabelCardStore['close']>;
      try {
        closed = store.close(id, {
          outcome: v.kind === 'label' ? 'labelled' : 'not-sure', label: v.kind === 'label' ? v.label : null,
          actor: String(pass.actor), at: deps.now(), expect: { mode, revision: q.revision },
        });
      } catch {
        return refuseRoute(reply, 'write-failed');
      }
      if (closed === 'closed') return { ok: true, changed: true };
      if (closed === 'already') return { ok: true, changed: false };
      if (closed === 'absent') return refuseRoute(reply, 'not-found');
    }
    return refuseRoute(reply, 'row-changed');
  });
}
