// Settings › Updates (settings spec §3.1, §3.3, §4.1; D-5503, D-5504): three cards over the frame's ONE /api/updates
// poll (`SettingsDataProvider`), in §3.3's order from one list (`UPDATES_CARDS`): Fleet version (the halt line first,
// then the status, Check now, the catalogue line and the release window), then Nodes, then Update policy (Channel,
// Auto-install). Versions first, policy last (§15 D7). The page's `<h2>` is the frame's; each card's title is an
// `<h3>`.
import { useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type {
  AutoMode, NodeWire, UpdateChannel, UpdateRouteError, UpdateRouteRefusal, UpdatesView,
} from '../../../../shared/api';
import { AUTO_MODES, FLEET_SCOPE, UPDATE_CHANNELS } from '../../../../shared/api';
import { carriesUpdateGate } from '../../../../shared/update-move';
import { Button, Section, Skeleton, useNow } from '@ccrc/ui';
import {
  CATALOGUE_EXPLAIN_TEXT, NotedRadioSet, ResultLine, SETTINGS_CARDS, SETTINGS_WHEN, UNCONFIRMED_TEXT, UPDATES_TEXT,
  autoGateNoteText, useResultLine,
} from '../../fleet/settingsText';
import { planMove, type MoveIntent, type PlannedMove } from '../../fleet/movePlan';
import { UpdateMoveSheet } from '../../fleet/UpdateMoveSheet';
import { UPDATES_STALE_TEXT, type UpdatesPoll } from '../../fleet/useUpdatesView';
import { isPlaceableInstant } from '../../fleet/updatesRead';
import { ApiError, api, updateErrorText } from '../../lib/api';
// `dayClock` and `elapsedWords` come THROUGH the update plane's reading
// surface, which is where the twenty wire-row-to-sentence helpers moved: the
// box-token card landed on main while that move was happening on this branch,
// and it reads two of the same clocks.
// The update plane's reading surface moved to a file of its own; this screen
// composes it. `ACK_UNREADABLE_TEXT`/`canAck` come THROUGH it because
// `NodeItem` is their consumer — see that file's header.
import {
  HaltLine, NodeList, ReleaseList, WhatsNewButton, catalogueLine, haltLineText, moveKey, releaseWindow, type MoveResult,
} from '../updates';
import { bannerRelease } from '../../fleet/releaseWaiting';
import { WhatsNewSheet, whatsNewReleases } from '../../fleet/WhatsNewSheet';
import { haltingNodes, updateAllHaltedText } from '../../fleet/updateHalt';
import '../../fleet/fleet.css';

// ── The Updates section (spec §13; programme wave 3 Task 7) ──────────────────
// Channel, auto-install, Check now and the catalogue line, over the screen's
// ONE /api/updates poll. Three rules this block keeps, each pinned in
// settings-screen.test.tsx:
//   * THE SERVER'S ROW IS WHAT IS SHOWN. A radio is checked from the fleet
//     intent row (`scope === FLEET_SCOPE`) the last poll returned, never from
//     the tap: a change writes a partial through api.setUpdateIntent and
//     re-polls, so a refused or lost write cannot leave a choice on screen
//     that the server does not hold.
//   * UNREACHABLE IS NOT CURRENT (§18). The line says "checked" only off a
//     non-null lastOkAt; a failed check is amber and says only what it can
//     measure (D-3306); nothing here says "up to date".
//   * THE AUTO GATE IS ADVISORY HERE. Only the non-`'off'` auto-install radios
//     are disabled, from the nodes' measured caps alone (`autoGateMissing`,
//     D-3297, D-3315) — `off` stays enabled, since the route accepts it
//     unconditionally and it moves nothing. The fieldset itself carries no
//     `disabled` from the gate. The route's 409 disables nothing; it only
//     relabels the note, rendering its own node list by label in place of
//     the measured one (D-3315).
// The selectors are native radios in a fieldset (D-3299):
// the platform supplies the group's role, its name (the legend), arrow-key
// movement and the checked state.

/** The channel labels (settings spec §11.2: the old "Stable — releases promoted after they've baked" became the label
 *  "Stable" with its note), one radio row each. The name stays for its importers. */
export const CHANNEL_SENTENCES: Record<UpdateChannel, string> = {
  stable: 'Stable',
  dev: 'Dev',
};

/** Each channel's note, under its option (spec §5.1). */
export const CHANNEL_NOTES: Record<UpdateChannel, string> = {
  stable: 'Releases promoted only after they have baked.',
  dev: 'Every merge that changes the build, minutes after it lands.',
};

/** The auto-install choices (`AutoMode`, W2) in spec §11.2's words. The wire's values do not change. */
export const AUTO_LABELS: Record<AutoMode, string> = {
  off: 'Off',
  stable: 'On the Stable channel only',
  channel: 'On any channel',
};

/** Each auto-install choice's note, under its option (spec §5.1). */
export const AUTO_NOTES: Record<AutoMode, string> = {
  off: 'Nothing installs until you press Install or Update.',
  stable: 'Installs each new stable release by itself. While the channel is Dev, nothing installs by itself.',
  channel: 'Installs each new release on the chosen channel by itself, Dev included.',
};
// UNCONFIRMED_TEXT is defined in ../fleet/settingsText so the Stall watch section can import it without a cycle back to this
// screen; re-exported here so this screen's callers and tests keep their import, and so the spec's citation of this
// file (§13 step 3) still resolves to the re-export here.
export { UNCONFIRMED_TEXT };
/** The first poll never landed and was not a 501 — a read that failed, said as one, not a skeleton forever. */
const UNREAD_TEXT = 'The update plane could not be read — the screen tries again every minute.';
/** The update surface's own sentence for a box with no control plane — Task 5's table, read through its one
 *  translator, so this file holds no second copy of it. */
const NOT_CONFIGURED_TEXT = updateErrorText(new ApiError(501, { ok: false, error: 'not-configured' }));
/** The one intent refusal rendered as the gate note (by node label) rather than as Auto-install's result line (W2
 *  Task 13). */
const AUTO_GATE_REFUSAL = 'auto-needs-rollback-gate' satisfies UpdateRouteError;

export function autoGateMissing(nodes: readonly NodeWire[]): NodeWire[] {
  // Array.isArray, not a bare `.includes`: a caps field that arrived as a
  // STRING would answer by substring and read as gated.
  return nodes.filter((n) => !(Array.isArray(n.caps) && carriesUpdateGate(n.caps)));
}

/** The node ids a `409 auto-needs-rollback-gate` names; null for any other failure, and for a 409 naming no id
 *  (the caller then says the route's own sentence under Auto-install rather than an empty "Not yet:"). */
// `RadioFieldset` LEFT THIS FILE — it is `@ccrc/ui`'s now, with the five
// fleet.css rules that skinned it. The argument that kept it local was "this
// file is their only consumer, so moving them anywhere would cost three rules
// and buy nothing", and what it was weighed against has changed: the design
// system could not render a radio at all, which is a hole a third consumer
// would have met with no way to reach either half. The move cost nothing a
// contrast-gate entry names, because every one of those rules was layout.
//
// What stays here is the SKIN that paints — `.settings-theme` and its body —
// passed in as `className`, the same arrangement `CollapsibleStrip` has with
// the three strips.

function gateRefusalOf(err: unknown): string[] | null {
  if (!(err instanceof ApiError) || err.status !== 409) return null;
  if (typeof err.body !== 'object' || err.body === null) return null;
  const { error, nodes } = err.body as Partial<UpdateRouteRefusal>;
  if (error !== AUTO_GATE_REFUSAL || !Array.isArray(nodes)) return null;
  const ids = nodes.filter((id) => typeof id === 'string');
  return ids.length > 0 ? ids : null;
}

// THE ONE invalid-Date predicate (fix round 1) now lives in `fleet/useUpdatesView.ts` (imported above),
// moved there in fix round 1's second pass (F13, item 8) so `releaseWaiting.ts`'s `bannerRelease` can share it —
// the fleet's update line used to decide "the catalogue was reached" with a bare `typeof … === 'number'`, which this
// screen's own `isPlaceableInstant` already refused (review F13). Used here by `catalogueLine`'s
// classification of `lastOkAt` AND by every renderer that prints a clock or a date off a wire instant —
// `clockTime`, `dayClock`, `releaseDate` — so there is exactly one place, shared by both surfaces, that
// decides "this build's Date cannot place it".

// The row the Theme fieldset draws moved to `AppearanceRow.tsx` (D-5458): the
// Layout fieldset draws it too, and two copies of its markup are what the
// markup census refuses.
/** Updates' cards, in §3.3's order: versions first, policy last (§15 D7). THE ONE ORDER: the page renders this list
 *  and nothing else decides it, so the Claude Code card (the binary-lifecycle plan's CB1h, §15.3 C5) is one id
 *  inserted between `nodes` and `policy`. */
export const UPDATES_CARDS = ['fleetVersion', 'nodes', 'policy'] as const satisfies readonly (keyof typeof SETTINGS_CARDS.updates)[];
type UpdatesCardId = (typeof UPDATES_CARDS)[number];

/** One Updates card: its head from the word table, its body given. */
function UpdatesCard({ id, children }: { id: UpdatesCardId; children: ReactNode }): ReactNode {
  const card = SETTINGS_CARDS.updates[id];
  return <Section level={3} scope={card.scope} title={card.title} purpose={card.purpose} data-card={id}>{children}</Section>;
}

/** The Updates page's body: the three states before any view exists — loading, a box with no control plane, a first
 *  read that failed — each its own render (AccountsScreen's three-state discipline), so "don't know yet" never borrows
 *  the rendering of "nothing there". The poll is the frame's one (`SettingsDataProvider`); the heading is the
 *  frame's `<h2>`. */
export function UpdatesSection({ poll }: { poll: UpdatesPoll }): ReactNode {
  const now = useNow(30_000);
  const { view, failure, reload } = poll;
  // Before a view, the one state sits in Fleet version's card: Nodes and Update policy have nothing to show yet.
  return view !== null ? (
    <UpdatesBody view={view} stale={failure !== null} now={now} reload={reload} />
  ) : (
    <UpdatesCard id="fleetVersion">
      {failure === 'not-configured' ? (
        <p className="settings-note">{NOT_CONFIGURED_TEXT}</p>
      ) : failure === 'failed' ? (
        <p className="settings-note">{UNREAD_TEXT}</p>
      ) : (
        <Skeleton lines={3} />
      )}
    </UpdatesCard>
  );
}

/** The opener key of the What's-new sheet's Update all: its line is drawn under "See what's new". */
const WHATS_NEW_FROM = 'whats-new';

/** The section over a landed view. `view` is the LAST GOOD answer (useUpdatesView keeps it across a failed
 *  poll); `stale` says a later poll failed. Tasks 8 and 9 render the release list and the node inventory
 *  after the catalogue line, from these same props. */
function UpdatesBody({ view, stale, now, reload }: {
  view: UpdatesView; stale: boolean; now: number; reload: () => void;
}): ReactNode {
  const gateNoteId = useId();
  const [busy, setBusy] = useState(false);
  // Fix round 1 (F5, item 5): the refusal carries the VIEW that was current
  // when the route named these ids, alongside the ids themselves — not just
  // the ids — so a LATER poll can be told from the one already in hand at
  // 409-time by identity, never by content (every real poll answer is a
  // fresh object even when nothing about the fleet changed, so an identity
  // test, not a content one, is what "a later poll" means here).
  //
  // W5 review 161 (F-A, the coordinator's ruling; corrects this comment's
  // earlier text, which said the opposite): the write's OWN immediate reload
  // (`writeIntent`'s `.finally(reload)`) IS that later poll. The latest
  // measurement supersedes the route's node list, so the route's list is
  // what the note names only until that reload lands, and from then on the
  // note names the poll's own `missing`.
  //
  // W5 review 161 (F-A): "the view that was current when the route named
  // these ids" is the view live at 409-LANDING time, never the one closed
  // over at TAP time. `writeIntent` is redefined every render, so its own
  // `.then`/`.catch` closes over whatever `view` this function's PARAMETER
  // was on the render that DEFINED it — the render active when the radio was
  // tapped. A routine 60 s poll landing anywhere in that gap (before the 409
  // arrives, and so before this instance's own reload) re-renders the
  // component with a NEW `view` object; the closure does not see it. Stamping
  // `gateRefusal.view` from that stale closure would then compare unequal to
  // the CURRENT `view` prop on the very next render — superseding the note
  // immediately, before it was ever shown, off a poll that was never "later"
  // than the 409 it is compared against. `viewRef` below is written on every
  // render, so the catch handler reads the view genuinely current at the
  // instant the 409 lands; the write's OWN `.finally()` reload is then the
  // first poll that can ever supersede it, exactly as F5 intended.
  const viewRef = useRef(view);
  viewRef.current = view;
  const [gateRefusal, setGateRefusal] = useState<{ ids: string[]; view: UpdatesView } | null>(null);
  // D-5507 (spec §6.4): every server action here answers in a line under the control that asked, a toast only once
  // the control is gone. One line per control: Channel, Auto-install, Check now, and the move's opener.
  const channelLine = useResultLine();
  const autoLine = useResultLine();
  const checkLine = useResultLine();
  const moveLine = useResultLine();
  // The control that opened the move sheet (`moveKey` of its intent, or `whats-new` for the sheet's own Update all),
  // so the 202's line is drawn under it once the sheet has closed.
  const [moveFrom, setMoveFrom] = useState<string | null>(null);
  // The move the operator is confirming — a plan taken at the tap, so a poll
  // landing while the sheet is open cannot change the list under a thumb.
  const [move, setMove] = useState<PlannedMove | null>(null);
  const openMove = (intent: MoveIntent, from: string = moveKey(intent)): void => {
    moveLine.clear();
    setMoveFrom(from);
    setMove(planMove(view, intent));
  };
  const moveResult: MoveResult | null = moveFrom !== null && moveLine.line !== null
    ? { key: moveFrom, line: moveLine.line } : null;
  // D-5611: the rollback sheet's target, for its withdrawn and unbundled lines.
  const rollbackTo = move !== null && move.intent.direction === 'rollback' ? move.intent.to : null;
  // Updates' own "See what's new" (settings spec §4.1, D-5505): the fleet's update-line sheet, its tag
  // (`bannerRelease`), and its footer's Update all handing over to the one move sheet. One sheet at a time.
  const [whatsNew, setWhatsNew] = useState(false);
  const haltId = useId();

  const fleet = view.intent.find((i) => i.scope === FLEET_SCOPE) ?? null;
  const missing = autoGateMissing(view.nodes);
  const labelOf = (id: string): string => view.nodes.find((n) => n.nodeId === id)?.label ?? id;
  // The route's answer, when it gave one, is the authority over the poll's —
  // but only until a LATER poll has landed (F5): while `gateRefusal.view` is
  // still the exact view active when the route named these ids, its list
  // stands unfiltered (the route may know something this same poll's own
  // measured caps do not yet). Once a poll strictly after that one lands, the
  // route's list is SUPERSEDED, not intersected with it: the note becomes
  // that poll's own `missing` in full, never `gateRefusal.ids ∩ missing`.
  // Fix round 2 (review of d5aefc4a, item 1): intersecting was itself a bug —
  // a 409 naming only node A while B is ALSO missing (the route reports one
  // culprit; the poll's own measured caps can show more) would, once A
  // cleared, filter the note down to the empty set and lose B entirely, even
  // though B's radios stay disabled (`missing.length > 0`, unaffected by this
  // note) with no reason given on screen. A 409's stale list must not outlive
  // the poll that answers it — and once it is superseded, the poll's full,
  // current `missing` is the one true answer, not a subset of the route's
  // now-stale one.
  const gateLabels = (gateRefusal !== null && gateRefusal.view === view)
    ? gateRefusal.ids.map(labelOf)
    : missing.map((n) => n.label);
  const gateNote = gateLabels.length > 0 ? autoGateNoteText(gateLabels) : null;
  const line = catalogueLine(view.catalogue, now);
  const waiting = bannerRelease(view);
  // THE ONE HALT LINE (settings spec §5.1): computed over what the window and the node rows will draw, so it shows
  // only while a control it gates is on screen, and every such control names it.
  const halt = haltLineText(view.nodes, releaseWindow(view.releases, view.nodes, fleet?.channel ?? null));
  const halting = haltingNodes(view.nodes);
  // Wave 8 item F1: the same unplaceable-reads-as-null rule catalogueLine's own `lastOkAt` classification uses
  // (:136), so a node's resolveDetail is qualified on the same basis the catalogue line itself is.
  const catalogueLastOkAt = view.catalogue.lastOkAt !== null && isPlaceableInstant(view.catalogue.lastOkAt)
    ? view.catalogue.lastOkAt : null;

  const writeIntent = (patch: { channel: UpdateChannel } | { auto: AutoMode }): void => {
    setBusy(true);
    if ('auto' in patch) setGateRefusal(null);
    const line = 'auto' in patch ? autoLine : channelLine;
    line.clear();
    void api.setUpdateIntent({ scope: FLEET_SCOPE, ...patch })
      .then(
        (answer) => { if (answer === 'unreadable') line.say(UNCONFIRMED_TEXT); },
        (err: unknown) => {
          const refused = gateRefusalOf(err);
          // viewRef.current, not the closed-over `view` param (W5 F-A): the
          // view genuinely current when this 409 lands, never the one active
          // at the tap that started the write.
          if (refused !== null) setGateRefusal({ ids: refused, view: viewRef.current });
          else line.say(updateErrorText(err), 'refusal');
        },
      )
      .finally(() => { setBusy(false); reload(); });
  };

  const checkNow = (): void => {
    setBusy(true);
    checkLine.clear();
    void api.refreshUpdates()
      .catch((err: unknown) => {
        // A 429 is the route's interval guard (W2 Task 13's
        // `REFRESH_MIN_INTERVAL_MS`, derived, D-3218), not a failure: GitHub
        // was ASKED too recently — by a request that may itself have
        // failed (D-3203 counts every request), so the note claims the request
        // and never a "checked" (the catalogue line owns that word, and only
        // off a non-null lastOkAt).
        if (err instanceof ApiError && err.status === 429) checkLine.say(updateErrorText(err));
        else checkLine.say(updateErrorText(err), 'refusal');
      })
      .finally(() => { setBusy(false); reload(); });
  };

  const bodies: Record<UpdatesCardId, ReactNode> = {
    fleetVersion: (
      <>
        {/* The one halt line leads the card (spec §5.1, audit U9). */}
        {halt !== null && <HaltLine id={haltId} text={halt} />}
        {/* A later poll failed: the update plane's one sentence for the last answer that landed (wave 19, R24(b)). */}
        {stale && <p className="settings-note">{UPDATES_STALE_TEXT}</p>}
        {waiting !== null && (
          <>
            <div className="settings-release-actions">
              <span className="settings-note">{`${waiting.tag} available`}</span>
              <WhatsNewButton onClick={() => setWhatsNew(true)}>{"See what's new"}</WhatsNewButton>
            </div>
            {moveResult?.key === WHATS_NEW_FROM && <ResultLine line={moveResult.line} />}
            <p className="settings-note">{UPDATES_TEXT.whatsNewNote}</p>
            <p className={SETTINGS_WHEN}>{UPDATES_TEXT.whatsNewWhen}</p>
          </>
        )}
        <Button variant="ghost" className="settings-check" disabled={busy} onClick={checkNow}>
          Check now
        </Button>
        <ResultLine line={checkLine.line} />
        <p className="settings-note">{UPDATES_TEXT.checkNowNote}</p>
        <p className={SETTINGS_WHEN}>{UPDATES_TEXT.checkNowWhen}</p>
        <p className={line.tone === 'calm' ? 'settings-catalogue' : `settings-catalogue settings-catalogue--${line.tone}`}>
          {line.text}
        </p>
        <p className="settings-note">{CATALOGUE_EXPLAIN_TEXT}</p>
        <ReleaseList
          releases={view.releases} nodes={view.nodes} channel={fleet?.channel ?? null} source={view.source}
          haltedBy={halt !== null ? haltId : null}
          onWhatsNew={waiting !== null ? () => setWhatsNew(true) : undefined}
          whatsNewSince={waiting !== null ? whatsNewReleases(view, waiting.tag).since : null}
          onMove={openMove} result={moveResult}
        />
      </>
    ),
    nodes: (
      <NodeList
        nodes={view.nodes} releases={view.releases} now={now} catalogueLastOkAt={catalogueLastOkAt}
        haltedBy={halt !== null ? haltId : null} onAcked={reload} onMove={openMove} result={moveResult}
      />
    ),
    policy: (
      <>
        {/* Spec §5.1's options with their notes: each note under its option, read as its description. */}
        <NotedRadioSet
          legend="Channel"
          name="settings-channel"
          options={UPDATE_CHANNELS.map((c) => ({ value: c, label: CHANNEL_SENTENCES[c], note: CHANNEL_NOTES[c] }))}
          value={fleet?.channel ?? null}
          onPick={(c) => writeIntent({ channel: c })}
          disabled={busy}
        />
        <ResultLine line={channelLine.line} />
        <p className="settings-note">{UPDATES_TEXT.channelPurpose}</p>
        <p className={SETTINGS_WHEN}>{UPDATES_TEXT.channelWhen}</p>
        <NotedRadioSet
          legend="Auto-install"
          name="settings-auto"
          /* D-3315: only the non-'off' choices are gated on the node caps — the
             route accepts `auto: 'off'` unconditionally (server/src/update/routes.ts),
             so disabling the whole fieldset would remove the one safe action
             exactly when the gate is incomplete. */
          options={AUTO_MODES.map((m) => ({
            value: m,
            label: AUTO_LABELS[m],
            note: AUTO_NOTES[m],
            disabled: m !== 'off' && missing.length > 0,
          }))}
          value={fleet?.auto ?? null}
          onPick={(m) => writeIntent({ auto: m })}
          disabled={busy}
          describedBy={gateNote !== null ? gateNoteId : undefined}
        />
        <ResultLine line={autoLine.line} />
        {gateNote !== null && <p id={gateNoteId} className="settings-note">{gateNote}</p>}
        {gateNote !== null && <p className={SETTINGS_WHEN}>{UPDATES_TEXT.autoGateWhen}</p>}
        <p className="settings-note">{UPDATES_TEXT.autoPurpose}</p>
        <p className={SETTINGS_WHEN}>{UPDATES_TEXT.autoWhen}</p>
      </>
    ),
  };

  return (
    <>
      {/* A fleet with no node yet has no Nodes card: an empty card says nothing the purpose line does not. */}
      {UPDATES_CARDS.filter((id) => id !== 'nodes' || view.nodes.length > 0)
        .map((id) => <UpdatesCard key={id} id={id}>{bodies[id]}</UpdatesCard>)}
      <WhatsNewSheet
        open={whatsNew && waiting !== null}
        view={view}
        tag={waiting?.tag ?? null}
        halted={halting.length > 0 ? updateAllHaltedText(halting) : null}
        onClose={() => setWhatsNew(false)}
        onUpdateAll={() => {
          if (waiting === null) return;
          setWhatsNew(false);
          openMove({ scope: 'fleet', direction: 'update', tag: waiting.tag }, WHATS_NEW_FROM);
        }}
      />
      {/* D-5507: a rollback is a danger action, so its sheet takes the danger tone and reads the target's catalogue
          row (withdrawn, unbundled; D-5611). Install and Update keep the default. */}
      <UpdateMoveSheet
        open={move !== null} plan={move} onClose={() => setMove(null)} onDone={reload}
        onAnswered={(text) => moveLine.say(text)}
        tone={move?.intent.direction === 'rollback' ? 'danger' : 'move'}
        release={rollbackTo === null ? undefined : view?.releases.find((r) => r.tag === rollbackTo)}
      />
    </>
  );
}

