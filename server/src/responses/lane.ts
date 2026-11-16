// The response lane (Overlord spec §4.3, Table 11.1c, Table 11.5; plan `docs/superpowers/plans/2026-11-14-overlord-w1/
// w1-responses.md`, Task 7). L4, context C6: it GATHERS each open row's facts through the owners' existing reads and the
// response store, asks `responseSealDue` (L1), and writes what it answers through `sealResponse`, once; then it keeps the
// operator's retention through the deleter by time. It decides nothing. Each step has its own `try`, so a failed seal never
// stops retention. A response is never an answer and never authority: the lane writes the response tables only.
import { DIGEST_KEY_ROW_KINDS, type ResponseStamp } from '../../../shared/responses.js';
import { ITEM_ACTORS, ITEM_ACTS, isItemNonMove, type ItemEventAct } from '../../../shared/ledgers.js';
import type { DigestRowKind } from '../../../shared/api.js';
import { responseSealDue, responseWindowEnd, type OwnerFacts, type SealFacts } from '../responses.js';
import type { WatcherCoordPort } from '../coord/ports.js';
import { approvalForResponse, askCorrectionForResponse, askForResponse } from '../coord/questions.js';
import type { OpenResponseRow } from '../coord/responsesStore.js';

const DAY_MS = 86_400_000;
const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** What the lane reads and writes: the watcher's one store port (`coord/ports.ts#WatcherCoordPort`), which carries the
 *  response store's lane members and the owners' reads. */
export type ResponsesLanePort = WatcherCoordPort;

/** The owner facts of one row, read through the owners' existing reads (an ask or an approval through `coord/questions.ts`,
 *  whose store reads hydrate and refuse a word this build does not know). A read that throws, refuses or answers a word
 *  this build does not know is `{ ok: false }`, never a default; a row that no longer exists is `gone`. */
export function ownerFactsOf(port: WatcherCoordPort, row: OpenResponseRow): { readonly ok: true; readonly owner: OwnerFacts } | { readonly ok: false; readonly detail: string } {
  try {
    const about = row.kind === 'push' ? row.carries : row.kind === 'waiting' && row.refKind !== null && row.refId !== null ? { kind: row.refKind, id: row.refId } : null;
    if (row.kind === 'digest') return digestFacts(port, row.refKey);
    if (about === null) {
      if (row.kind === 'waiting') return { ok: false, detail: `row ${row.id} names no source` };
      return { ok: true, owner: { kind: 'none' } };
    }
    if (about.kind === 'item') {
      if (port.itemById(about.id) === null) return { ok: true, owner: { kind: 'gone' } };
      const acts = port.itemHistory(about.id).map((e) => {
        const act = String(e.act) as ItemEventAct;
        if (!(ITEM_ACTS as readonly string[]).includes(act) && !isItemNonMove(act)) throw new Error(`an item event act ${act} is not known`);
        if (!(ITEM_ACTORS as readonly string[]).includes(e.actor)) throw new Error(`an item event actor ${e.actor} is not known`);
        return { act, actor: e.actor, at: Number(e.at) };
      });
      return { ok: true, owner: { kind: 'item', acts } };
    }
    const read = askForResponse(port, about.id);
    if (!read.ok) return { ok: false, detail: read.detail };
    const ask = read.ask;
    if (ask === null) return { ok: true, owner: { kind: 'gone' } };
    return { ok: true, owner: { kind: 'ask', state: ask.state, answeredBy: ask.answeredBy, answeredAt: ask.answeredAt,
      endedAt: ask.answeredAt ?? ask.releasedAt } };
  } catch (e) {
    return { ok: false, detail: message(e) };
  }
}

function digestFacts(port: WatcherCoordPort, key: string | null): { readonly ok: true; readonly owner: OwnerFacts } | { readonly ok: false; readonly detail: string } {
  const parts = (key ?? '').split(':');
  const rowKind = parts[1] as DigestRowKind;
  const id = Number(parts[2]);
  if (parts.length !== 3 || !DIGEST_KEY_ROW_KINDS.includes(rowKind) || !Number.isSafeInteger(id)) return { ok: false, detail: 'a digest key is not readable' };
  if (rowKind === 'ask') {
    const r = askCorrectionForResponse(port, id);
    if (!r.ok) return { ok: false, detail: r.detail };
    return { ok: true, owner: r.row === null ? { kind: 'gone' } : { kind: 'digest', corrected: r.row.corrected, overturnedAt: null } };
  }
  if (rowKind === 'approval') {
    const r = approvalForResponse(port, id);
    if (!r.ok) return { ok: false, detail: r.detail };
    return { ok: true, owner: r.row === null ? { kind: 'gone' } : { kind: 'digest', corrected: r.row.corrected, overturnedAt: null } };
  }
  const call = port.callById(id);
  return { ok: true, owner: call === null ? { kind: 'gone' } : { kind: 'digest', corrected: false, overturnedAt: call.overturnedAt } };
}

/** One lane: its pass, and the latch that logs each failing cause once until it clears. */
export interface ResponsesLane {
  run(port: ResponsesLanePort, stamp: (() => ResponseStamp) | undefined, now: number): void;
}

export function responsesLane(warn: (line: string) => void = (l) => console.warn(l)): ResponsesLane {
  const latched = new Set<string>();
  const once = (cause: string, line: string): void => {
    if (latched.has(cause)) return;
    latched.add(cause);
    warn(`ccrc-server: responses: ${line}`);
  };
  const clear = (prefix: string): void => { for (const c of [...latched]) if (c.startsWith(prefix)) latched.delete(c); };

  function seal(port: ResponsesLanePort, stamp: (() => ResponseStamp) | undefined, now: number): void {
    // No stamp source this pass (a narrow composition): every row is left for a pass that has one.
    if (stamp === undefined) return;
    const open = port.openResponseRows();
    if (!open.ok) { once(`open:${open.detail}`, `${open.detail}; the next pass reads again`); return; }
    clear('open:');
    for (const bad of open.unreadable) once(`row:${bad.detail}`, `a response row is unreadable by this build (${bad.detail}); it is left unsealed`);
    const stampNow = stamp();
    for (const row of open.rows) {
      try {
        const owner = ownerFactsOf(port, row);
        let read: { ok: true; facts: SealFacts } | { ok: false };
        if (!owner.ok) {
          once(`owner:${owner.detail}`, `an owner read failed (${owner.detail}); the seal waits at most a day past the window`);
          read = { ok: false };
        } else {
          const end = responseWindowEnd(row, owner.owner);
          if (end === null || now < end) continue;          // the window is open: no receipts are read for it yet
          try {
            read = { ok: true, facts: { row, owner: owner.owner, receipts: port.responseReceipts(row.id), replacedOn: port.responseReplacedOn(row, end),
              bootsInWindow: port.responseBootsInWindow(row.insertedAt, end), stampNow } };
          } catch (e) {
            once(`facts:${message(e)}`, `a response row's facts were not read (${message(e)}); the seal waits at most a day past the window`);
            read = { ok: false };
          }
        }
        const d = responseSealDue(row, read, now);
        if (d.seal) port.sealResponse(row.id, d, now);
      } catch (e) {
        once(`seal:${message(e)}`, `a response row was not sealed (${message(e)}); the next pass tries again`);
      }
    }
  }

  function retain(port: ResponsesLanePort, now: number): void {
    const r = port.responseRetention();
    // An unreadable setting deletes nothing this pass, never the default (slug retention-unreadable-deletes-nothing).
    if (!r.ok) { once(`retention:${r.detail}`, `the retention setting is unreadable (${r.detail}); nothing is deleted this pass`); return; }
    clear('retention:');
    port.deleteResponsesThrough(now - r.days * DAY_MS);
  }

  return {
    run(port, stamp, now) {
      try { seal(port, stamp, now); } catch (e) { once(`pass:${message(e)}`, `the seal step failed (${message(e)})`); }
      try { retain(port, now); } catch (e) { once(`delete:${message(e)}`, `the retention step failed (${message(e)}); the next pass tries again`); }
    },
  };
}
