/**
 * THE CARD'S GATHERER (Overlord design spec §3.3.3 C38, §3.3.9 C49 to C52; plan `w1a-card.md` Task 3). L3, context C3: it
 * reads one session's facts from `CoordStore` and the registry, once per request, and decides nothing; the role is
 * `cardRoleOf`'s (L1) and the text the renderers' (`card.ts`).
 *
 * EVERY DISTINCTION IS KEPT. A read that failed, or threw, is a fact of its own (`unmeasured`, naming what could not be
 * read), and the card renders it as a line. It is never an empty list, which would read as "nothing there".
 *
 * ABSOLUTE STAMPS ONLY (plan review A4). Every time a fact carries is a row's own stamp (a mail's send time, an item's
 * raise time, a decision's time), never an age computed at the request, so unchanged rows give one snapshot and one hash.
 *
 * THE READS (measured in Task 3 Step 1, named in the departures note): the runs (`runs`, open and the newest closed, one
 * read; a session's runs are those it claims or is bound to), a child's run kind (`run`), the claims (`activeClaims`, by
 * holder), declared intent (`coordinatorIntentDeclared` on the registry incarnation, the one new read), the items
 * (`itemsFor`, all programmes, once: the session's raised items and each programme's open items), each programme's goals
 * and modifications (`goalsFor`), and the outstanding mail (`outstandingMailFor`).
 */
import { TERMINAL_RUN_STATES, type ChildMark, type ChildReclaimGeneration, type RunKind } from '../../../shared/api.js';
import type {
  CardClaim, CardFacts, CardHistory, CardItem, CardMail, CardProgramme, CardRenderer, CardRun, Fact,
} from '../../../shared/continuity-card.js';
import type { CoordStore } from '../coord/store.js';
import type { ItemRow } from '../coord/ledgersStore.js';
import { roleFactsOf } from '../roleOf.js';
import { cardRoleOf } from './card.js';

/** The store reads the gatherer makes, declared by this consumer. */
export type CardFactsCoord = Pick<CoordStore, 'runs' | 'run' | 'activeClaims' | 'outstandingMailFor' | 'itemsFor' | 'goalsFor'
  | 'coordinatorIntentDeclared'>;

export interface CardFactsDeps {
  readonly coord: CardFactsCoord;
  /** The session's registry record's child mark, or null when the registry could not say (the row is unmeasurable, the
   *  registry unlistable): then the role reads undecided, never "not a child". */
  childMark(id: string): Promise<ChildMark | null>;
  /** The registry row's incarnation (`childReclaimGenerationRead`): the key declared intent is stored under. */
  incarnation(id: string): Promise<ChildReclaimGeneration>;
}

/** The history line's verb (C52). No read names a session's newest node yet (slug history-line-without-a-node). */
export const CARD_HISTORY: CardHistory = { verb: 'ccrc history describe', node: null };
/** At most this many outstanding deliveries are read for a card (`outstandingMailFor`'s own cap is 100). */
const MAIL_LIMIT = 100;

const read = <T>(value: T): Fact<T> => ({ kind: 'read', value });
const unmeasured = (what: string): Fact<never> => ({ kind: 'unmeasured', what });
/** One read: its value, or `unmeasured` naming `what` when it answered a failure or threw. */
function attempt<T>(what: string, f: () => T | null): Fact<T> {
  try {
    const v = f();
    return v === null ? unmeasured(what) : read(v);
  } catch {
    return unmeasured(what);
  }
}

const cardItemOf = (i: ItemRow): CardItem => ({
  id: i.id, programme: i.program, kind: i.kind, state: i.state, neededBy: i.neededBy, at: i.raisedAt, text: i.title,
  everTicked: i.tickedAt !== null,
});

/** One session's card facts, and the renderer its role is drawn by. `now` is the server's time of rendering: it is
 *  `CardFacts.at`, and the hold filter of `itemsFor` (an item still held is not yet shown to anyone). */
export async function gatherCardFacts(deps: CardFactsDeps, sessionId: string, now: number):
  Promise<{ readonly facts: CardFacts; readonly renderer: CardRenderer }> {
  const { coord } = deps;
  let child: ChildMark;
  try { child = (await deps.childMark(sessionId)) ?? { kind: 'unreadable' }; } catch { child = { kind: 'unreadable' }; }
  let incarnation: ChildReclaimGeneration;
  try { incarnation = await deps.incarnation(sessionId); } catch { incarnation = { kind: 'unreadable' }; }

  // The runs: open runs, and the newest closed ones (the programme of a coordinator between runs).
  const allRuns = attempt('the runs', () => {
    const r = coord.runs({ includeClosed: true });
    return r.ok ? r.runs : null;
  });
  const isOpen = (state: string): boolean => !(TERMINAL_RUN_STATES as readonly string[]).includes(state);
  const runs: Fact<readonly CardRun[]> = allRuns.kind === 'unmeasured' ? allRuns : read(allRuns.value
    .filter((r) => isOpen(r.state) && (r.claimedBy === sessionId || r.sessionId === sessionId))
    .map((r): CardRun => ({ id: r.id, programme: r.program, wave: r.wave, waveOf: r.waveOf, state: r.state, planPath: null, kind: r.kind })));

  const claims = attempt<readonly CardClaim[]>('the claims', () => coord.activeClaims()
    .filter((c) => c.heldBy === sessionId).map((c) => ({ id: c.id, paths: c.paths, runId: c.runId })));

  const intent: Fact<boolean> = incarnation.kind === 'absent' ? read(false)
    : incarnation.kind === 'unreadable' ? unmeasured('declared coordinator intent (the registry incarnation)')
    : attempt('declared coordinator intent', () => {
      const r = coord.coordinatorIntentDeclared(sessionId, incarnation.v);
      return r.ok ? r.declared : null;
    });

  const openItems = attempt('the open items', () => coord.itemsFor(null, now).open);
  const itemsRaised: Fact<readonly CardItem[]> = openItems.kind === 'unmeasured' ? unmeasured('the items you raised')
    : read(openItems.value.filter((i) => i.raisedBy === sessionId).map(cardItemOf));

  // The programmes: those of the session's open runs and of the items it raised, or, for a session that claims no open
  // run, the programme of the newest run it claimed (C51: a coordinator between runs gets its programme's card).
  const ledger = ((): Fact<readonly CardProgramme[]> => {
    if (allRuns.kind === 'unmeasured') return unmeasured('the programme ledger (its programmes are read from the runs)');
    if (openItems.kind === 'unmeasured') return unmeasured('the programme ledger (its open items)');
    const mine = allRuns.value.filter((r) => r.claimedBy === sessionId || r.sessionId === sessionId);
    const slugs = new Set(mine.filter((r) => isOpen(r.state)).map((r) => r.program));
    for (const i of openItems.value) if (i.raisedBy === sessionId) slugs.add(i.program);
    if (!mine.some((r) => isOpen(r.state) && r.claimedBy === sessionId)) {
      const newest = mine.filter((r) => r.claimedBy === sessionId).sort((a, b) => b.id - a.id)[0];
      if (newest !== undefined) slugs.add(newest.program);
    }
    try {
      return read([...slugs].sort().map((slug): CardProgramme => {
        const g = coord.goalsFor(slug);
        // No goals version carries `ratifiedBy` yet, so every goal is rendered as not ratified (slug goals-unratified).
        const goals = [...(g.inShort === null ? [] : [g.inShort]), ...(g.doneWhen ?? [])].map((text) => ({ text, ratified: false }));
        const decisions = g.modifications.map((m) => ({ at: m.at, text: m.ruling === null ? m.text : `${m.text} (ruling: ${m.ruling})` }));
        return { slug, goals, decisions, openItems: openItems.value.filter((i) => i.program === slug).map(cardItemOf) };
      }));
    } catch {
      return unmeasured('the programme ledger');
    }
  })();

  const mailOutstanding = attempt<readonly CardMail[]>('the outstanding mail', () => coord.outstandingMailFor(sessionId, MAIL_LIMIT)
    .map((m) => ({ deliveryId: m.deliveryId, fromId: m.fromId, at: m.at, subject: m.subject })));

  const childRunKind = ((): RunKind | 'unmeasured' => {
    if (child.kind !== 'child') return 'unmeasured';
    try {
      const r = coord.run(child.runId);
      return r.ok && r.run !== null ? r.run.kind : 'unmeasured';
    } catch { return 'unmeasured'; }
  })();
  const openCoordinators = allRuns.kind === 'unmeasured' ? 'unmeasured' as const
    : new Set(allRuns.value.filter((r) => isOpen(r.state) && r.claimedBy !== null).map((r) => r.claimedBy as string));
  const role = cardRoleOf(roleFactsOf(sessionId, {
    child, childRunKind, openCoordinators, intentDeclared: intent.kind === 'read' ? intent.value : 'unmeasured',
  }));

  return {
    renderer: role.renderer,
    facts: {
      sessionId, role: role.role, roleWhy: role.roleWhy, at: now, runs, ledger, claims, intent, itemsRaised, mailOutstanding,
      notes: read([]), checkpoint: read(null), history: read(CARD_HISTORY),
    },
  };
}
