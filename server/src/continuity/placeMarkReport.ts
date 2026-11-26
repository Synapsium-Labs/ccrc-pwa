// L4, context C3 (Session Conversation): the session socket's one call after a parsed `visible` frame (Overlord W1 home B, plan
// w1-home.md question 4 and Task 7). It reads the designation's bound session and the `@overlord-place` mark's `at`, reads the
// wall clock through the `now` it is handed (the server's own `deps.time.clock.wall()`; this directory is in the time-port scope, so no ambient clock is read here), asks the pure
// `placeMarkDue`, and on `write` calls the mark's one writer, `putOperatorMark`, with `OVERLORD_PLACE_MARK`. It decides nothing.
//
// The report never disturbs the frame it rides on: a throw from either read, a read that answers unread, or a write that did
// not land is caught or noted and warned about once (`ccrc-server: …`), and the caller's `viewers.setVisible` has already run.
// A write that lands re-arms the warning, so a standing fault is one line, not one per 15-second frame.
import { OVERLORD_PLACE_MARK } from '../../../shared/continuity.js';
import type { DesignationRead } from '../../../shared/overlord-designation.js';
import type { OperatorMarksRead } from './continuityStore.js';
import { placeMarkDue, type PlaceBound, type PlaceMarkAt } from './placeMark.js';

/** The two reads and the one write the report needs: `CoordStore` carries all three. */
export interface PlaceMarkPorts {
  designationRead(): DesignationRead;
  operatorMarks(): OperatorMarksRead;
  putOperatorMark(programme: string, at: number): { ok: boolean };
}

const boundOf = (d: DesignationRead): PlaceBound =>
  d.kind === 'designated' ? { kind: 'bound', sessionId: d.sessionId } : d.kind === 'not-designated' ? { kind: 'not-designated' } : { kind: 'unread' };

const markAtOf = (r: OperatorMarksRead): PlaceMarkAt => {
  if (!r.ok) return 'unread';
  const row = r.rows.find((m) => m.programme === OVERLORD_PLACE_MARK);
  return row === undefined ? 'absent' : row.at;
};

/** The function the socket handler calls: `(frame's session, visible)`. With no store (`ports` undefined) it does nothing. */
export function placeMarkReporter(
  ports: PlaceMarkPorts | undefined,
  now: () => number,
  warn: (line: string) => void = (l) => { console.warn(l); },
): (frameSessionId: string, visible: boolean) => void {
  let warned = false;
  const fail = (what: string): void => {
    if (warned) return;
    warned = true;
    warn(`ccrc-server: the Overlord place mark was not refreshed (${what}); the mark ages, so a renewal may read the place as hidden`);
  };
  return (frameSessionId, visible) => {
    if (ports === undefined) return;
    try {
      const nowMs = now();
      const bound = boundOf(ports.designationRead());
      const markAtMs = markAtOf(ports.operatorMarks());
      if (bound.kind === 'unread') fail('the designation could not be read');
      if (markAtMs === 'unread') fail('the marks could not be read');
      if (placeMarkDue({ frameSessionId, visible, bound, markAtMs, nowMs }) === 'skip') return;
      if (ports.putOperatorMark(OVERLORD_PLACE_MARK, nowMs).ok) warned = false;
      else fail('the write did not land');
    } catch (e) {
      fail(e instanceof Error ? e.message : String(e));
    }
  };
}
