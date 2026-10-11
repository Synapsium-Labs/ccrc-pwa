// UpdateMoveSheet — the ONE confirm sheet every move control opens
// (centralised-update design 2026-09-20 §13 "W4 adds"; programme wave 5
// Task 8): Install / Roll back on a /settings release row, Update / Roll back
// on an inventory row, and the fleet banner's Update all. It names the nodes
// the move takes, numbered in the order the server's dispatcher moves them
// (movePlan.ts), under the move's own headline, and one confirm sends the
// request(s) by direction — `apply {tag}` forward, `rollback {to}` back.
//
// A `Sheet`, not `QuickConfirm` (D-3389):
// QuickConfirm's confirm runs `onConfirm(); onClose();` unconditionally, and a
// single-node apply or rollback can be REFUSED synchronously — the route
// answers the dispatcher's own predicate as a 409. The refusal is said IN this
// sheet, through updateErrorText, and the sheet stays open; it closes only on
// a 2xx that requested what it named. The busy flag and the generation
// counter are AbandonSheet's idiom: an
// answer for a plan the sheet no longer shows is dropped.
//
// RESULT BY RE-MEASUREMENT. A 202 means a request row was written — never that
// a node moved. The sheet calls onDone (its caller re-polls /api/updates) and
// closes; the inventory then shows the request and, later, the move. A 2xx
// whose body would not parse is still a written request (postJsonOr, D-1150):
// the sheet closes the same way and a toast says the answer was unread.
//
// A SKIP IS SAID. `{all: true}`'s 202 lists in `skipped` every node the
// server's dispatcher would refuse (MoveSkipWhy, D-3401).
// This plan previews by version and OS alone, so a node it NAMED can come back
// skipped for a capability, the agent, a refusal or the catalogue: the sheet
// says each such node and its sentence IN PLACE (moveSkippedText) and stays
// open with no confirm — the reply is final. Task 6's requestAll writes no
// request for a skipped node, and notes an updateDetail on its row for every
// word except not-newer, busy, halted and waiting-for-fleet (no-desired is
// noted nowhere either: it is no refusal of the row), so for those this
// sentence is the only place the operator learns why. A readable reply that requested nothing
// at all is said the same way (MOVE_NOTHING_REQUESTED_TEXT); a skip of a node
// the sheet never listed is the plan agreeing with the server, and is not said
// — EXCEPT `halted` (programme wave 14, R15(b); D-4269). A halting row is a
// fact about the whole fleet, not that node: every request the same reply wrote
// waits behind it until the ack. A failed row already at the tag is never named
// by the plan, so before this wave the sheet closed on that 202 as if the move
// had started.
//
// A fleet-wide rollback is one single-node request per node, in order,
// stopping at the first refusal (D-3390); the
// refusal then names the nodes already requested, and onDone re-polls so the
// inventory shows them. The sheet then offers NO second send: re-sending the
// plan would start with the node now pending, whose own route answers 409
// busy before the rest is reached (MOVE_REST_TEXT points at the release list).
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { MoveRequestAnswer } from '../../../shared/api';
import { Button, QC_ACTIONS, QC_CONSEQUENCE, RESET_LIST, Sheet, toast } from '@ccrc/ui';
import { ApiError, api, moveSkipText, updateErrorText } from '../lib/api';
import { moveEmptyText, moveHeadline, moveLabel, moveLines, moveRequests, rollbackHowText, type PlannedMove } from './movePlan';
import './fleet.css';

export const MOVE_UNREADABLE_TEXT = "Requested — the server's answer could not be read; the screen will re-check.";
/** A readable 2xx that requested no node and skipped none this sheet named (one left the inventory between the
 *  tap and the send): nothing was written, so the sheet says so rather than closing on it. */
export const MOVE_NOTHING_REQUESTED_TEXT = 'The server requested no node — reload the screen to see each row.';
/** After a per-node sequence stopped part-way: the node already requested is not re-sent from this sheet. */
export const MOVE_REST_TEXT = 'Move the rest from the release list once that node settles.';

/** A move refused part-way. Two facts, so one value that carries both: the refusal itself (`err` — an ApiError
 *  from the route, or a transport error) and the nodes whose single-node request was already written. */
export class MoveSendError extends Error {
  readonly err: unknown;
  readonly requested: readonly string[];
  constructor(err: unknown, requested: readonly string[]) {
    super(err instanceof Error ? err.message : 'move refused');
    this.name = 'MoveSendError';
    this.err = err;
    this.requested = requested;
  }
}

/** A 2xx body normalised to the shape this sheet trusts. `postJsonOr` only degrades a body that failed to
 *  PARSE (D-1150) — a body that parsed fine but is not the object this route promises (`null`, an array, a
 *  `requested`/`skipped` that is not an array, or a `skipped` element that is not an object) reaches here
 *  UNCHANGED, and indexing `.requested`/`.skipped` on it throws (review MINOR 3). Read as the same
 *  `'unreadable'` a parse failure already is — never indexed as if it were the real shape. */
function asAnswer(raw: unknown): MoveRequestAnswer | 'unreadable' {
  if (raw === 'unreadable') return raw;
  if (typeof raw !== 'object' || raw === null) return 'unreadable';
  const { requested, skipped } = raw as { requested?: unknown; skipped?: unknown };
  if (!Array.isArray(requested) || !Array.isArray(skipped)) return 'unreadable';
  if (skipped.some((s) => typeof s !== 'object' || s === null)) return 'unreadable';
  return raw as MoveRequestAnswer;
}

/** `isCurrent` is AbandonSheet's generation check, asked BETWEEN requests (review IMPORTANT 1): a fleet-wide
 *  rollback sends one request per node, in order, and a sheet dismissed mid-sequence (the scrim, Esc, swipe —
 *  none of which the disabled Cancel button gates) must not keep sending into a plan nothing shows any more.
 *  Defaults to always-current so a direct caller (a test, or a future one-shot use) behaves exactly as before
 *  this parameter existed. What already went out stands regardless — this only stops the REST from being sent. */
export async function sendMove(
  plan: PlannedMove, isCurrent: () => boolean = () => true,
): Promise<Array<MoveRequestAnswer | 'unreadable'>> {
  const answers: Array<MoveRequestAnswer | 'unreadable'> = [];
  const requested: string[] = [];
  for (const r of moveRequests(plan)) {
    if (!isCurrent()) break;
    try {
      answers.push(asAnswer(r.route === 'apply' ? await api.applyUpdate(r.body) : await api.rollbackUpdate(r.body)));
    } catch (err) {
      throw new MoveSendError(err, [...requested]);
    }
    const body = r.body;
    if ('nodeId' in body) requested.push(body.nodeId);
  }
  return answers;
}

/** The answers' skips of nodes this plan NAMED — the server refused them for a reason the plan could not preview.
 *  A skip of a node the plan never listed is the plan agreeing with the server, and is not said, unless it is
 *  `halted`: that node holds every other request until it is acked (D-4269), so it is named through the plan's
 *  inventory (moveLabel). */
export function moveSkippedText(answers: ReadonlyArray<MoveRequestAnswer | 'unreadable'>, plan: PlannedMove): string | null {
  const named = new Map(plan.nodes.map((n) => [n.nodeId, n.label] as const));
  const said: string[] = [];
  for (const a of answers) {
    if (a === 'unreadable' || !Array.isArray(a.skipped)) continue;
    for (const s of a.skipped) {
      const label = named.get(s.nodeId) ?? (s.why === 'halted' ? moveLabel(plan, s.nodeId) : undefined);
      if (label !== undefined) said.push(`${label}: ${moveSkipText(s.why)}`);
    }
  }
  return said.length === 0 ? null : `Not requested — ${said.join(' ')}`;
}

/** `{all: true}`'s 202 can REQUEST a node this plan never listed — a snapshot the server's own, fresher view has
 *  moved past (review MINOR 4). `moveSkippedText` speaks for a SKIP of a node this plan named, and for a `halted`
 *  skip of a node the plan never named (D-4269); silence for a REQUEST of a node it did not would close the sheet without saying anything moved beyond what it previewed.
 *  Said the same way a named skip is — in place, no confirm offered again. */
function moveUnnamedText(requested: readonly string[], plan: PlannedMove): string | null {
  const named = new Set(plan.nodes.map((n) => n.nodeId));
  const extra = requested.filter((id) => !named.has(id));
  return extra.length === 0 ? null
    : `Also requested — not previewed here: ${extra.map((id) => moveLabel(plan, id)).join(', ')}.`;
}

/** The labels a `409 halted` names in its `detail` — the halting nodeIds, `, `-joined (Task 6's singleNodeMove),
 *  usually NOT the node this sheet moves, so they are read through the plan's inventory. None for any other
 *  refusal, or a detail that is not a string. */
function haltedBy(refusal: unknown, plan: PlannedMove): string[] {
  if (!(refusal instanceof ApiError) || typeof refusal.body !== 'object' || refusal.body === null) return [];
  const { error, detail } = refusal.body as { error?: unknown; detail?: unknown };
  if (error !== 'halted' || typeof detail !== 'string' || detail === '') return [];
  return detail.split(', ').map((id) => moveLabel(plan, id));
}

/** The refusal's own sentence (updateErrorText, code-first); for `halted`, the nodes that halt the fleet; then
 *  the nodes already requested when some were, and that the rest is not re-sent from here. Other refusals'
 *  `detail` is not appended: `busy`'s is the moved node's own state word, which the sentence already says, and
 *  `no-desired`/`no-previous` cannot reach this sheet — every move it sends names its tag. */
function moveErrorText(err: unknown, plan: PlannedMove): string {
  const refusal = err instanceof MoveSendError ? err.err : err;
  const said = updateErrorText(refusal);
  const blockers = haltedBy(refusal, plan);
  const head = blockers.length === 0 ? said : `${said} Blocked by: ${blockers.join(', ')}.`;
  const requested = err instanceof MoveSendError ? err.requested : [];
  if (requested.length === 0) return head;
  return `${head} Already requested: ${requested.map((id) => moveLabel(plan, id)).join(', ')}. ${MOVE_REST_TEXT}`;
}

export function UpdateMoveSheet({ open, plan, onClose, onDone }: {
  open: boolean; plan: PlannedMove | null; onClose: () => void; onDone: () => void;
}): ReactNode {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The sheet has had its final answer while staying open (a part-way refusal,
  // or a 2xx that did not request what it named): no confirm is offered again.
  const [answered, setAnswered] = useState(false);
  // AbandonSheet's generation: every close and every new plan bumps it in the
  // effect's cleanup, and an answer issued under an older generation is dropped.
  const gen = useRef(0);
  useEffect(() => {
    setBusy(false);
    setError(null);
    setAnswered(false);
    return () => { gen.current += 1; };
  }, [open, plan]);

  if (!open || plan === null) return null;
  const headline = moveHeadline(plan.intent);
  const lines = moveLines(plan);

  const confirm = (): void => {
    if (busy || answered) return;
    const mine = gen.current;
    setBusy(true);
    setError(null);
    void sendMove(plan, () => gen.current === mine).then(
      (answers) => {
        if (gen.current !== mine) {
          // Superseded — a dismiss (scrim, Esc, swipe — never gated by the disabled Cancel), or a new plan: in the
          // real app neither parent can change `plan` while the sheet is open, so a new plan IS a dismiss then a
          // reopen. Either way the answer is dropped from the SCREEN (nothing is rendered for a plan the sheet no
          // longer shows), but if it came back at all something was written — a single-node move's one POST, or
          // a mid-sequence stop's first — and the operator is now looking at something else, so the caller
          // re-polls. The reload is harmless when nothing new was written (review F5, IMPORTANT 1).
          if (answers.length > 0) onDone();
          return;
        }
        setBusy(false);
        const unread = answers.includes('unreadable');
        const requested = answers.flatMap((a) => (a !== 'unreadable' && Array.isArray(a.requested) ? a.requested : []));
        // The reply is authoritative (D-3401): a node this sheet NAMED that it skipped, a `halted` skip of a node it
        // did NOT name (D-4269), a node it did NOT name that the server requested anyway (a fresher view than this
        // plan's own), or a readable reply that
        // requested nothing at all, is said HERE and the sheet stays open — never a close that reads as "moved".
        // onDone only when something may have been written.
        const short = moveSkippedText(answers, plan) ?? moveUnnamedText(requested, plan)
          ?? (!unread && requested.length === 0 ? MOVE_NOTHING_REQUESTED_TEXT : null);
        if (short !== null) {
          setAnswered(true);
          setError(requested.length === 0 ? short : `${short} Requested: ${requested.map((id) => moveLabel(plan, id)).join(', ')}.`);
          if (requested.length > 0 || unread) onDone();
          return;
        }
        if (unread) toast(MOVE_UNREADABLE_TEXT);
        onDone();
        onClose();
      },
      (err: unknown) => {
        if (gen.current !== mine) {
          // Same dismiss-vs-switch reasoning as the success arm: a MoveSendError's own `requested` is exactly
          // what already went out before the refusal, and a dismiss stopping the sequence never reaches this
          // branch with an empty one unless nothing was ever written.
          if (err instanceof MoveSendError && err.requested.length > 0) onDone();
          return;
        }
        setBusy(false);
        setError(moveErrorText(err, plan));
        if (err instanceof MoveSendError && err.requested.length > 0) {
          // Part-way (a fleet rollback): the requested node is pending now, and re-sending this plan would start
          // with it — its own 409 busy, never reaching the rest. So this sheet offers no second send.
          setAnswered(true);
          onDone();
        }
      },
    );
  };

  return (
    <Sheet open onClose={onClose} title={headline}>
      <div className="update-move-sheet">
        {lines.length === 0 ? (
          <p className={QC_CONSEQUENCE}>{moveEmptyText(plan.intent)}</p>
        ) : (
          <ol className={`update-move-list ${RESET_LIST}`} role="list" aria-label="Nodes this moves, in order">
            {plan.nodes.map((n, i) => <li key={n.nodeId} className="update-move-node">{lines[i]}</li>)}
          </ol>
        )}
        {plan.intent.direction === 'rollback' && lines.length > 0 && (
          <p className="qc-consequence">{rollbackHowText(plan.intent.to)}</p>
        )}
        <div className={QC_ACTIONS}>
          {lines.length > 0 && !answered && (
            <Button variant="primary" disabled={busy} onClick={confirm}>
              {busy ? 'Sending…' : headline}
            </Button>
          )}
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            {answered ? 'Close' : 'Cancel'}
          </Button>
        </div>
        {error !== null && <p className="update-move-error" role="alert">{error}</p>}
      </div>
    </Sheet>
  );
}
