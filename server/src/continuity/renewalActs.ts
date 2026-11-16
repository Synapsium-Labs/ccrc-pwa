// L4 delivery, context C3 (Session Conversation): the renewal act's acts (Overlord spec §3.3.11 H12 and H13, §3.6 H2; W1a
// renewal act Task 4). `runRenewalActs` takes the acts a live generations pass planned (`generationsPass`'s `planned`) and
// carries them out through the `SessionHost` port, the system mail, the ledger and the store. It decides nothing: which
// acts a step asks for is `actsOfStep`'s, which try a `renew` is owed is `renewOwed`'s, and what `renew`'s answer means is
// `renewAnswerEvent`'s (all `renewalFeed.ts`, L1); what that answer does to the generation is `generationStep`'s.
//
// It is called ONLY while `continuity` is live: in shadow the pass records its steps and plans nothing (the caller's
// `continuity` check and the pass's `live` are the same read). Its store writes are the lane's own, made between the pass and
// the next one, on rows re-read after each await, so the lane stays the one synchronous writer of `continuity_generations`.
//
// RENEW IS IDEMPOTENT ON (generation, try). Before any retry (try 2 on) the receipt's second half is read: a start recorded
// since the generation's own start ends the retry (the next pass's start batch mints the next generation from it). Then
// the call is claimed in `continuity_renew_calls` BEFORE it is made, so neither a second pass nor a restart can make it again
// (slug renew-calls-claimed-first); a claim that was already taken is skipped. The checkpoint is sealed just before the call,
// with the handover note if one arrived (slug checkpoint-sealed-at-renew). The answer is recorded on the claim and fed to the
// machine as one event; a `renew` that step asks for is NOT made here: it is owed on the next pass, after its receipt read.
//
// Every other act is single-shot: the first prompt and the card re-nudge are one `deliver` each (a refusal is logged, and
// `carded`'s nudge point gives a second chance), the handover ask and the spot-probe notice are system mail that the mail
// store keeps from being queued twice while one is outstanding, and the degraded item is raised once per generation: the
// lane plans it on every pass while the generation stays degraded (review 2149 F3), and it is raised only while no open item
// for that generation stands and none was raised for this stay in this process (so an item the operator dismissed is not
// raised again until the generation degrades anew). A generation the item cannot be raised for (no claimed programme, a
// role with none) is logged once per generation in this process.
import type { CoordStore } from '../coord/store.js';
import { newestClaimedWorkRuns } from '../coord/bindingReads.js';
import { assembleCheckpoint, CHECKPOINT_RULINGS_MAX } from './checkpoint.js';
import { genExpectOf, genViewOf, type GenRow } from './continuityStore.js';
import { generationStep } from './generationMachine.js';
import type { ActTarget, PlannedAct } from './generationsLane.js';
import {
  RENEWAL_HANDOVER_BODY, RENEWAL_HANDOVER_SUBJECT, SPOT_PROBE_BODY, SPOT_PROBE_SUBJECT, actsOfStep, answerActs, handoverInRenewal,
  itemAboutOf, itemStandsWords, renewAnswerEvent, renewalItemPrefix, type ItemAbout, type RenewalAct,
} from './renewalFeed.js';
import type { SessionHost } from './sessionHost.js';

/** The renewal item's title (`renewalItemPrefix` and the reason). */
export const degradedItemTitle = (sessionId: string, n: number, why: string, about?: ItemAbout): string =>
  `${renewalItemPrefix(sessionId, n, about)}: ${why}`;

/** The store members the acts reach, declared by this consumer. */
export type RenewalActsCoord = Pick<CoordStore, 'liveGenerations' | 'stepGeneration' | 'setHoldOff' | 'claimRenewCall'
  | 'answerRenewCall' | 'putCheckpoint' | 'liveNotes' | 'handoverOf' | 'rulingRowsOf' | 'itemsFor' | 'raiseItem'
  | 'bindingRunsOf' | 'run'>;

export interface RenewalActsDeps {
  readonly coord: RenewalActsCoord;
  readonly host: SessionHost;
  /** Queue one system mail from the operator's role to a session; false when it was not queued (one is outstanding). */
  readonly mail: (toId: string, subject: string, body: string) => boolean;
  readonly now: () => number;
  readonly log: (line: string) => void;
  /** What this process already did once, kept by the caller across passes: an item raised for a generation's stay in its
   *  state, and a generation logged as having no programme to raise one on. A memo, never a decision's durable state. */
  readonly memo?: Set<string>;
}

/** What one run of the acts did, by act. */
export interface ActsResult {
  readonly renewed: number; readonly delivered: number; readonly mailed: number; readonly raised: number;
  readonly skipped: number; readonly failed: number;
}

/** Take every planned act, in order. Each act's failure is logged and counted; it never stops the others. */
export async function runRenewalActs(deps: RenewalActsDeps, planned: readonly PlannedAct[]): Promise<ActsResult> {
  const r = { renewed: 0, delivered: 0, mailed: 0, raised: 0, skipped: 0, failed: 0 };
  for (const p of planned) await actOnce(deps, p.target, p.act, r);
  return r;
}

/** One act whose failure is logged and counted, so it never stops the acts after it (a step's hold-off after its item). */
async function actOnce(deps: RenewalActsDeps, t: ActTarget, a: RenewalAct, r: Counts): Promise<void> {
  try {
    await act(deps, t, a, r);
  } catch (e) {
    r.failed += 1;
    deps.log(`ccrc-server: renewal: ${a.kind} for ${t.sessionId} n=${t.n} failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

type Counts = { renewed: number; delivered: number; mailed: number; raised: number; skipped: number; failed: number };

async function act(deps: RenewalActsDeps, t: ActTarget, a: RenewalAct, r: Counts): Promise<void> {
  const say = (line: string): void => deps.log(`ccrc-server: renewal: ${t.sessionId} n=${t.n}: ${line}`);
  switch (a.kind) {
    case 'renew': return renew(deps, t, a.try, r, say);
    case 'first-prompt': case 'renudge-card': {
      const d = await deps.host.deliver(t.sessionId, 'renewal-first-prompt');
      if (d.kind === 'sent') r.delivered += 1;
      else { r.failed += 1; say(`the ${a.kind} was not delivered (${d.kind === 'refused' ? d.reason : d.detail})`); }
      return;
    }
    case 'ask-handover': return mailOnce(deps, t, RENEWAL_HANDOVER_SUBJECT, RENEWAL_HANDOVER_BODY, r, say);
    case 'spot-probe': return mailOnce(deps, t, SPOT_PROBE_SUBJECT, SPOT_PROBE_BODY, r, say);
    case 'assemble-checkpoint': { if (!seal(deps, t)) { r.failed += 1; say('the checkpoint could not be stored'); } return; }
    case 'raise-item': return raiseDegraded(deps, t, a, r, say);
    case 'set-hold-off': {
      const g = reread(deps, t.genId);
      if (g === null || !deps.coord.setHoldOff(g.id, genExpectOf(g)).changed) { r.failed += 1; say('the hold-off could not be set'); }
      return;
    }
    default: { const never: never = a; return never; }
  }
}

/** The generation as it stands now, or null when it is no longer live or the read failed. */
function reread(deps: RenewalActsDeps, genId: number): GenRow | null {
  const rows = deps.coord.liveGenerations();
  return rows.ok ? (rows.rows.find((g) => g.id === genId) ?? null) : null;
}

async function renew(deps: RenewalActsDeps, t: ActTarget, tryN: number, r: Counts, say: (l: string) => void): Promise<void> {
  if (tryN > 1) {
    const receipt = await deps.host.receipt(t.sessionId, t.startId);
    if (receipt.kind === 'started') { r.skipped += 1; say(`try ${tryN} not made: start ${receipt.startId} is recorded`); return; }
    if (receipt.kind === 'unreadable') { r.skipped += 1; say(`try ${tryN} waits: the receipt could not be read (${receipt.detail})`); return; }
  }
  const key = { generationId: t.genId, episode: t.episode, try: tryN };
  const claim = deps.coord.claimRenewCall(key, deps.now());
  if (!claim.ok) { r.failed += 1; say(`try ${tryN} not made: its claim could not be written`); return; }
  if (!claim.claimed) { r.skipped += 1; return; }
  if (!seal(deps, t)) say('the checkpoint could not be stored before the renewal');
  const answer = await deps.host.renew(t.sessionId, t.n);
  deps.coord.answerRenewCall(key, answer.kind);
  if (answer.kind === 'started') r.renewed += 1; else say(`try ${tryN}: ${answer.kind}${'reason' in answer ? ` (${answer.reason})` : 'detail' in answer ? ` (${answer.detail})` : ''}`);
  for (const extra of answerActs(answer)) await actOnce(deps, t, extra, r);
  const g = reread(deps, t.genId);
  if (g === null || g.state !== 'clearing' || g.enteredAt !== t.episode || g.attempts !== tryN) { say(`try ${tryN}'s answer was not fed: the generation moved on`); return; }
  const event = renewAnswerEvent(answer);
  const step = generationStep(genViewOf(g, true), event);
  if (!step.changed) return;
  if (!deps.coord.stepGeneration(g.id, genExpectOf(g), step.next, true, deps.now()).changed) { say(`try ${tryN}'s answer was not written`); return; }
  // The step's own acts (the release, the hold-off, the item); a retry's `renew` is owed on the next pass.
  for (const next of actsOfStep(step.actions, g.state, event, itemAboutOf(answer.kind))) await actOnce(deps, t, next, r);
}

/** Seal this generation's checkpoint (the lane is its one writer): the identity's live notes, this generation's handover
 *  note if one arrived, and for a coordinator its newest rulings. */
function seal(deps: RenewalActsDeps, t: ActTarget): boolean {
  const notes = deps.coord.liveNotes(t.identity);
  const handover = deps.coord.handoverOf(t.genId);
  const rulings = t.role === 'coordinator' ? deps.coord.rulingRowsOf(t.sessionId, CHECKPOINT_RULINGS_MAX) : { ok: true as const, rulings: [] };
  if (!notes.ok || !handover.ok || !rulings.ok) return false;
  const h = handover.handover !== null && handoverInRenewal(handover.handover.at, t.episode) ? handover.handover : null;
  const cp = assembleCheckpoint({
    role: t.role, trigger: t.cls ?? 'hard',
    notes: notes.notes.map((n) => ({ id: n.id, at: n.at, kind: n.kind, key: n.key, waitsOn: n.waitsOn, next: n.next })),
    handover: h === null ? null : { n: h.n, dropped: h.dropped, note: h.note },
    rulings: rulings.rulings,
  });
  return deps.coord.putCheckpoint({ ...cp, generationId: t.genId, at: deps.now() }).ok;
}

function mailOnce(deps: RenewalActsDeps, t: ActTarget, subject: string, body: string, r: Counts, say: (l: string) => void): void {
  if (deps.mail(t.sessionId, subject, body)) r.mailed += 1;
  else { r.skipped += 1; say(`the ${subject} mail was not queued: one is outstanding`); }
}

/** One item per degraded generation, on the coordinator's programme (slug degraded-item-on-the-programme): an open item
 *  already raised for the same generation, or one this process raised for this stay, is not raised again (the header). */
function raiseDegraded(deps: RenewalActsDeps, t: ActTarget, a: Extract<RenewalAct, { kind: 'raise-item' }>, r: Counts, say: (l: string) => void): void {
  // The stay is the generation's entry into the state it holds now (a degrade written by this run's `renew` included).
  const stay = reread(deps, t.genId)?.enteredAt ?? t.episode;
  const raisedKey = `raised:${t.genId}:${stay}:${a.about === 'kill-failed' ? 'unit' : 'degraded'}`;
  if (deps.memo?.has(raisedKey) === true) { r.skipped += 1; return; }
  const once = (line: string): void => {
    const k = `none:${t.genId}`;
    if (deps.memo?.has(k) === true) return;
    deps.memo?.add(k);
    say(line);
  };
  if (t.role !== 'coordinator') { r.skipped += 1; once(`${a.why}; no programme to raise an item on for role ${t.role}`); return; }
  const runs = newestClaimedWorkRuns(deps.coord, t.identity);
  const program = runs.ok ? runs.runs[0]?.program : undefined;
  if (program === undefined) { r.skipped += 1; once(`${a.why}; it claims no programme that could be read, so no item was raised`); return; }
  const now = deps.now();
  if (deps.coord.itemsFor(program, now).open.some((i) => i.title.startsWith(renewalItemPrefix(t.sessionId, t.n, a.about)))) { r.skipped += 1; return; }
  deps.coord.raiseItem({
    program, runId: null, raisedBy: t.sessionId, kind: 'do', title: degradedItemTitle(t.sessionId, t.n, a.why, a.about),
    why: `The renewal of ${t.sessionId} did not complete (${a.why}). ${itemStandsWords(a.about)}`,
    how: ['Open the session and check that it is working.', 'Nothing else is needed while it works: its next hard trigger renews it again.'],
    options: null, neededBy: 'soon', soonLabel: 'renewal', secretSlot: null,
  }, now, 'ccrc');
  deps.memo?.add(raisedKey);
  r.raised += 1;
}
