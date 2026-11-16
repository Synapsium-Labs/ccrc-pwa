// The one reader of the Waiting on you list's wire shape (desktop-polish PL5a, D-7712, review 1359 F5; ring L1: pure), and of
// one programme's Goals view within it or beside it (`isGoalsFor`, carry C, D-7951).
//
// The list reaches the page two ways, the `waiting` frame (`stores/fleet.ts`) and `GET /api/waiting` (`waitingStore.ts`),
// and both ask THIS function whether what arrived is a list. One definition, so the two doors accept the same value: a
// list that is not three arrays would throw in the screen (`view.cleared.length`), and an empty list is a fact, so it is
// `{items: [], cleared: [], goals: []}`, never a missing field. The envelope is all it reads: an item's own fields are the
// server's, written by one writer, and a screen that cannot read one shows less of it rather than dropping the list.
import type { GoalsView, WaitingView } from '../../../shared/ledgers';
import { isRecord } from '../lib/wire';

export function isWaitingView(v: unknown): v is WaitingView {
  return isRecord(v) && Array.isArray(v.items) && Array.isArray(v.cleared) && Array.isArray(v.goals);
}

/** Whether a value is the Goals view of programme `slug`: the programme it names, and the one field its panel maps over
 *  (`modifications`) an array. The programme view asks it of the frame's entry and of the fetched answer alike, so the two
 *  copies are drawn on the same terms (carry C, D-7951; review 1386 F8). */
export function isGoalsFor(v: unknown, slug: string): v is GoalsView {
  return isRecord(v) && v.program === slug && Array.isArray(v.modifications);
}
