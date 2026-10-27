// The inspector's ONE routing line: it says what runs, and asks only what it can measure (desktop polish T3d,
// D-6334). "Runs <model> on <lane> · effort <x>", then "· asked <class>" or "· asked effort <x>" only for a field the
// routing record asks for and the pane has not read back yet.
//
// PURE. The provider does not come in here: it reaches the line through `routeView`, which already holds the
// measurability rule, so the session header's model chip and this line share one decision about what is pending and
// cannot disagree. The word "queued" is the header badge's, for a class the lane can read back; this line never
// says it.
import type { FleetSession } from '../../../shared/api';
import { modelOptions } from '../lib/models';
import type { RouteView } from './routeView';

export interface RoutingLine {
  /** The live model, or null before the pane has one. */
  readonly model: string | null;
  /** The lane's human label (the caller passes `accountLabel(roster, wrapper)`). */
  readonly lane: string;
  /** What the effort door says: the live level, 'ultracode', 'set by the lane' (ccd stamped effort inert), or
   *  'not read yet'. */
  readonly effort: string;
  /** The asked class's label from this lane's own option list (`modelOptions(row.wrapper, null)`), only when
   *  `view.classPending`; else null. */
  readonly askedClass: string | null;
  /** The asked effort word, only when `view.effortPending`; else null. */
  readonly askedEffort: string | null;
  /** Either field's read failed this pass (`view.classUnreadable || view.effortUnreadable`). */
  readonly unreadable: boolean;
  /** The whole line as one sentence, for a reader and for tests. */
  readonly sentence: string;
}

export function routingLine(row: FleetSession, view: RouteView, lane: string): RoutingLine {
  const model = row.model;
  const effort = view.effortInert ? 'set by the lane' : row.ultracode ? 'ultracode' : (row.effort ?? 'not read yet');
  // A class the lane's list does not carry cannot be pending (`classPending` needs its readback), but fall back to
  // the raw word rather than drop a degradation the reader cannot name.
  const askedClass = view.classPending && view.classIntended !== null
    ? (modelOptions(row.wrapper, null).find((o) => o.route.value === view.classIntended)?.label ?? view.classIntended)
    : null;
  const askedEffort = view.effortPending ? view.effortIntended : null;
  const unreadable = view.classUnreadable || view.effortUnreadable;
  const sentence = `Runs ${model ?? 'a model not read yet'} on ${lane} · effort ${effort}`
    + (askedClass !== null ? ` · asked ${askedClass}` : '')
    + (askedEffort !== null ? ` · asked effort ${askedEffort}` : '')
    + (unreadable ? ' · routing could not be read' : '');
  return { model, lane, effort, askedClass, askedEffort, unreadable, sentence };
}
