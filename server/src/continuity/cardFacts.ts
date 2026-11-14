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
 * THE READS (measured in Task 3 Step 1, named in the departures note): the runs, through the binding's own readers
 * (ARCH-62 and ARCH-42: no run/session equality is decided here): `bindingsOf`'s open runs it claims (`claimant`) and
 * works (`worker`), each hydrated by `run(id)` for its state and kind, and the newest run in its binding series
 * (`bindingRunsOf`) for a session that claims no open run; the open claimants (`openCoordinatorIds`) for the
 * role; a child's run kind (`run`), the claims (`activeClaims`, by holder), declared intent (`coordinatorIntentDeclared` on the registry incarnation, the one new read), the items
 * (`itemsFor`, all programmes, once: the session's raised items and each programme's open items), each programme's goals
 * and modifications (`goalsFor`), and the outstanding mail (`outstandingMailFor`).
 */
import type { ChildMark, ChildReclaimGeneration, RunKind } from '../../../shared/api.js';
import type {
  CardClaim, CardFacts, CardHistory, CardItem, CardMail, CardProgramme, CardRenderer, CardRun, Fact,
} from '../../../shared/continuity-card.js';
import type { CoordStore } from '../coord/store.js';
import type { ItemRow } from '../coord/ledgersStore.js';
import { roleFactsOf } from '../roleOf.js';
import { cardRoleOf } from './card.js';

/** The store reads the gatherer makes, declared by this consumer. */
export type CardFactsCoord = Pick<CoordStore, 'bindingsOf' | 'bindingRunsOf' | 'openCoordinatorIds' | 'run' | 'activeClaims'
  | 'outstandingMailFor' | 'itemsFor' | 'goalsFor' | 'coordinatorIntentDeclared'>;

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
export async function gatherCardFacts(deps: CardFactsDeps, id: string, now: number):
  Promise<{ readonly facts: CardFacts; readonly renderer: CardRenderer }> {
  const { coord } = deps;
  let child: ChildMark;
  try { child = (await deps.childMark(id)) ?? { kind: 'unreadable' }; } catch { child = { kind: 'unreadable' }; }
  let incarnation: ChildReclaimGeneration;
  try { incarnation = await deps.incarnation(id); } catch { incarnation = { kind: 'unreadable' }; }

  // The runs: the open runs it claims and the open runs it works, each read whole by its id for its state and kind.
  const bindings = coord.bindingsOf(id);
  const claimedOpen = attempt('the runs', () => { const r = bindings.claimant(); return r.ok ? r.siblings : null; });
  const workedOpen = attempt('the runs', () => { const r = bindings.worker(); return r.ok ? r.siblings : null; });
  const runs = attempt<readonly CardRun[]>('the runs', () => {
    if (claimedOpen.kind === 'unmeasured' || workedOpen.kind === 'unmeasured') return null;
    const ids = [...new Set([...claimedOpen.value, ...workedOpen.value].map((r) => r.id))].sort((a, b) => a - b);
    const out: CardRun[] = [];
    for (const runId of ids) {
      const r = coord.run(runId);
      if (!r.ok || r.run === null) return null;
      out.push({ id: runId, programme: r.run.program, wave: r.run.wave, waveOf: r.run.waveOf, state: r.run.state, planPath: null, kind: r.run.kind });
    }
    return out;
  });
  const claims = attempt<readonly CardClaim[]>('the claims', () => coord.activeClaims()
    .filter((c) => c.heldBy === id).map((c) => ({ id: c.id, paths: c.paths, runId: c.runId })));

  const intent: Fact<boolean> = incarnation.kind === 'absent' ? read(false)
    : incarnation.kind === 'unreadable' ? unmeasured('declared coordinator intent (the registry incarnation)')
    : attempt('declared coordinator intent', () => {
      const r = coord.coordinatorIntentDeclared(id, incarnation.v);
      return r.ok ? r.declared : null;
    });

  const openItems = attempt('the open items', () => coord.itemsFor(null, now).open);
  const itemsRaised: Fact<readonly CardItem[]> = openItems.kind === 'unmeasured' ? unmeasured('the items you raised')
    : read(openItems.value.filter((i) => i.raisedBy === id).map(cardItemOf));

  // The programmes: those of the session's open runs and of the items it raised, and, for a session that claims no open
  // run, the programme of the newest run in its series (C51: a coordinator between runs gets its programme's card).
  const ledger = ((): Fact<readonly CardProgramme[]> => {
    if (runs.kind === 'unmeasured' || claimedOpen.kind === 'unmeasured') return unmeasured('the programme ledger (its programmes are read from the runs)');
    if (openItems.kind === 'unmeasured') return unmeasured('the programme ledger (its open items)');
    const slugs = new Set(runs.value.map((r) => r.programme));
    for (const i of openItems.value) if (i.raisedBy === id) slugs.add(i.program);
    if (claimedOpen.value.length === 0) {
      // The newest run in the session's binding series (claimed or worked) gives the programme it is between runs of.
      const series = coord.bindingRunsOf(id);
      if (!series.ok) return unmeasured('the programme ledger (the runs it claimed)');
      const newest = [...series.runs].sort((a, b) => b.id - a.id)[0];
      if (newest !== undefined) {
        const r = coord.run(newest.id);
        if (!r.ok || r.run === null) return unmeasured('the programme ledger (the runs it claimed)');
        slugs.add(r.run.program);
      }
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

  const mailOutstanding = attempt<readonly CardMail[]>('the outstanding mail', () => coord.outstandingMailFor(id, MAIL_LIMIT)
    .map((m) => ({ deliveryId: m.deliveryId, fromId: m.fromId, at: m.at, subject: m.subject })));

  const childRunKind = ((): RunKind | 'unmeasured' => {
    if (child.kind !== 'child') return 'unmeasured';
    try {
      const r = coord.run(child.runId);
      return r.ok && r.run !== null ? r.run.kind : 'unmeasured';
    } catch { return 'unmeasured'; }
  })();
  let openCoordinators: ReadonlySet<string> | 'unmeasured';
  try { openCoordinators = new Set(coord.openCoordinatorIds()); } catch { openCoordinators = 'unmeasured'; }
  const role = cardRoleOf(roleFactsOf(id, {
    child, childRunKind, openCoordinators, intentDeclared: intent.kind === 'read' ? intent.value : 'unmeasured',
  }));

  return {
    renderer: role.renderer,
    facts: {
      sessionId: id, role: role.role, roleWhy: role.roleWhy, at: now, runs, ledger, claims, intent, itemsRaised, mailOutstanding,
      notes: read([]), checkpoint: read(null), history: read(CARD_HISTORY),
    },
  };
}
