// The inspector's ONE routing line: it says what runs, and asks only what it can measure (desktop polish T3d,
// D-6334). "Runs <model> on <lane> · effort <x>", then "· asked <class>" or "· asked effort <x>" only for a field the
// routing record asks for and the pane has not read back yet. A field not read yet says the header chip's own words
// ("a model not read yet", "set effort"), so each door shows a word its accessible name speaks.
//
// PURE. The provider does not come in here: it reaches the line through `routeView`, which already holds the
// measurability rule, so the session header's model chip and this line share one decision about what is pending and
// cannot disagree. The word "queued" is the header badge's, for a field the lane can read back; this line never
// says it. The header shows ONE badge when both fields are pending (the effort first, `wireQueuedField`), while this
// line names every pending field, so a class can be asked here with no badge on the model chip: the rail may say
// more than the header, never something else. With no routing record at all (`route` absent) the line asks nothing,
// whatever the header's local-write badge says for its 60 seconds (`routeView` states that residual).
//
// The line takes the whole `RouteView` rather than reading the record itself (departure
// `routing-line-takes-the-view`), so the one decision about what is pending stays in `routeView`.
//
// The line's words live ONCE, in `WORDS`, and the line is handed out as ordered `parts`: the sentence is their join,
// and the inspector's markup maps them (the two chooser doors, the pending style) without spelling a word itself, so
// the sentence and the rail cannot drift and the plain-words census reads every word.
import type { FleetSession } from '../../../shared/api';
import { modelOptions } from '../lib/models';
import type { MetaChipTone } from './chipTones';
import type { RouteView } from './routeView';

/** Every word the line says, apart from the live values it is made around. */
const WORDS: Readonly<Record<'runs' | 'on' | 'effort' | 'sep' | 'asked' | 'askedEffort' | 'unreadable'
  | 'inertModel' | 'inertEffort' | 'unreadEffort' | 'aModel' | 'unreadModel' | 'ultracode', string>> = {
  runs: 'Runs ',
  on: ' on ',
  effort: 'effort ',
  // Its own part before the effort and before each asked part and note: every "·" is this part, so the markup can
  // keep it with what follows, and the asked pill holds only the asked words.
  sep: ' · ',
  asked: 'asked ',
  // The asked effort is the departure `routing-line-says-pending-effort`: the header badges it, so the rail names it.
  askedEffort: 'asked effort ',
  unreadable: 'routing could not be read',
  inertModel: 'model set by the lane',
  inertEffort: 'set by the lane',
  // The header chip's word for an effort not read yet; the door says it alone, with no "effort " before it.
  unreadEffort: 'set effort',
  aModel: 'a model ',
  unreadModel: 'not read yet',
  ultracode: 'ultracode',
};

/** One piece of the line, in reading order: plain text, the model door, the effort door, a pending ask (in the
 *  header's pending style) or a note on the read. */
export interface RoutingPart {
  readonly kind: 'text' | 'sep' | 'model' | 'effort' | 'asked' | 'note';
  readonly text: string;
  /** A door's chip tone, decided here and not by the markup: 'model' for the model door, and for the effort door
   *  'ultra' only on a live ultracode pane whose effort is not set by the lane, else 'plain'. Absent on the rest. */
  readonly tone?: MetaChipTone;
}

export interface RoutingLine {
  /** The live model, or null before the pane has one. */
  readonly model: string | null;
  /** The lane's human label (the caller passes `accountLabel(roster, wrapper)`). */
  readonly lane: string;
  /** What the effort door says: the live level, 'ultracode', 'set by the lane' (ccd stamped effort inert), or
   *  'set effort' before the pane reports one. */
  readonly effort: string;
  /** The asked class's label from this lane's own option list (`modelOptions(row.wrapper, null)`), only when
   *  `view.classPending`; else null. */
  readonly askedClass: string | null;
  /** The asked effort word, only when `view.effortPending`; else null. */
  readonly askedEffort: string | null;
  /** Either field's read failed this pass (`view.classUnreadable || view.effortUnreadable`). */
  readonly unreadable: boolean;
  /** The line in reading order; `sentence` is the join of their text. */
  readonly parts: readonly RoutingPart[];
  /** The whole line as one sentence, for a reader and for tests. */
  readonly sentence: string;
}

export function routingLine(row: FleetSession, view: RouteView, lane: string): RoutingLine {
  const model = row.model;
  const effortUnread = !view.effortInert && !row.ultracode && row.effort === null;
  const effort = view.effortInert ? WORDS.inertEffort : row.ultracode ? WORDS.ultracode : (row.effort ?? WORDS.unreadEffort);
  // Unreachable today: `classPending` already found this label on the same list. Kept so a miss shows the raw word
  // rather than nothing, and the type stays total.
  const askedClass = view.classPending && view.classIntended !== null
    ? (modelOptions(row.wrapper, null).find((o) => o.route.value === view.classIntended)?.label ?? view.classIntended)
    : null;
  const askedEffort = view.effortPending ? view.effortIntended : null;
  const unreadable = view.classUnreadable || view.effortUnreadable;
  const sep: RoutingPart = { kind: 'sep', text: WORDS.sep };
  const parts: RoutingPart[] = [
    { kind: 'text', text: WORDS.runs },
    ...(model === null ? [{ kind: 'text', text: WORDS.aModel } as const] : []),
    { kind: 'model', text: model ?? WORDS.unreadModel, tone: 'model' },
    { kind: 'text', text: WORDS.on },
    { kind: 'text', text: lane },
    sep,
    ...(effortUnread ? [] : [{ kind: 'text', text: WORDS.effort } as const]),
    { kind: 'effort', text: effort, tone: !view.effortInert && row.ultracode ? 'ultra' : 'plain' },
  ];
  if (askedClass !== null) parts.push(sep, { kind: 'asked', text: `${WORDS.asked}${askedClass}` });
  if (askedEffort !== null) parts.push(sep, { kind: 'asked', text: `${WORDS.askedEffort}${askedEffort}` });
  if (view.classInert) parts.push(sep, { kind: 'note', text: WORDS.inertModel });
  if (unreadable) parts.push(sep, { kind: 'note', text: WORDS.unreadable });
  return { model, lane, effort, askedClass, askedEffort, unreadable, parts, sentence: parts.map((p) => p.text).join('') };
}
