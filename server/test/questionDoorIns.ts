// The routes' four door-ins, driven the way a door core drives them (W3 Q3f, D-7030; coordinator ruling D-7245, option
// (a)): the member of the watcher's own `Questions` instance, with the pane-edge facts the watcher hands that instance
// (`QuestionDoorSink`), its answer pushed through the same sink. Each is what the watcher's forward of the same name
// did before Q3f deleted it (`releaseHeldAsk`, `answeredLate`, `releaseHeldApproval`, `approvalRuled`), so a suite that
// drove the forward drives this instead with no row changing meaning.
import { questionsTestView, type QuestionDoorSink, type QuestionPush } from '../src/coord/questions.js';
import type { FleetWatcher } from '../src/watch.js';

export interface DoorIns {
  /** `POST /api/asks/:id/release`'s door-in (was `FleetWatcher#releaseHeldAsk`). */
  released(childId: string): void;
  /** `POST /api/asks/:id/answer`'s late-answer door-in (was `FleetWatcher#answeredLate`). */
  answeredLate(childId: string, askId: number, parent: string): void;
  /** `POST /api/approvals/:id/release`'s door-in (was `FleetWatcher#releaseHeldApproval`). */
  approvalReleased(childId: string): void;
  /** `POST /api/approvals/:id/rule`'s door-in (was `FleetWatcher#approvalRuled`). */
  approvalRuled(childId: string, agentId: string, parent: string, verdict: 'allow' | 'deny'): void;
}

export function doorInsOf(w: FleetWatcher): DoorIns {
  const q = w.questions;
  const sink = (): QuestionDoorSink => {
    const s = questionsTestView(q).doors();
    if (s === undefined) throw new Error('the watcher made its Questions instance with no doors sink');
    return s;
  };
  const send = (ev: QuestionPush | null): void => { if (ev !== null) sink().push(ev); };
  return {
    released: (childId) => send(q.released(childId)),
    answeredLate: (childId, askId, parent) => send(q.answeredLate(childId, askId, parent)),
    approvalReleased: (childId) => send(q.approvalReleased(childId, sink().paintedDialogOf(childId))),
    approvalRuled: (childId, agentId, parent, verdict) => send(q.approvalRuled(childId, agentId, parent, verdict,
      sink().paintedDialogOf(childId) !== undefined, () => sink().projectOf(childId))),
  };
}
