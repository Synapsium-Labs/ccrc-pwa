// Settings screen (route `/settings`, centralised update management W3 —
// design 2026-09-20 §13). Two sections and no more — Updates (the channel,
// auto-install, *Check now*, the catalogue line, the release list, the node
// inventory) and Notifications (the bell, release notifications, the
// unarmed-exposure banner). The update plane's READING surface — the release
// list, the node inventory and the twenty pure helpers that turn a wire row
// into a sentence — moved to `screens/updates.tsx`; this file composes it.
// Both sections still live below the header
// (Tasks 7–10 of the W3 plan; fix rounds 1–2 widened several of their
// guards in place — see the plan's `## Deviations found`, D-3315/D-3316).
//
// The AccountsScreen skeleton, class for class (`.settings-screen/-head/-back/
// -title`, fleet.css): a back chevron that returns to the fleet, then the <h1>.
// It adds no scroll logic of its own — the D-161 pane reset in app.tsx puts
// `.shell-detail` back at the top on every route change, this one included.
import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type {
  AuthStatus, AutoMode, NodeWire, NotifyMode, UpdateChannel, UpdateRouteError,
  UpdateRouteRefusal, UpdatesView,
} from '../../../shared/api';
import {
  AUTO_MODES, FLEET_SCOPE, NOTIFY_MODES, UPDATE_CHANNELS, UPDATE_GATE_CAP, isNotifyMode,
} from '../../../shared/api';
import { LOOPBACK_HOSTS } from '../../../shared/base-url';
import {
  BackButton, Button, PHOSPHOR, RADIO_FIELDSET, RADIO_LEGEND, Radio, RadioFieldset,
  SYSTEM, Skeleton, THEMES, toast, useNow,
} from '@ccrc/ui';
import { NotificationBell } from '../fleet/NotificationBell';
import { planMove, type MoveIntent, type PlannedMove } from '../fleet/movePlan';
import { UpdateMoveSheet } from '../fleet/UpdateMoveSheet';
import { isPlaceableInstant, useUpdatesView, type UpdatesPoll } from '../fleet/useUpdatesView';
import { ApiError, api, updateErrorText } from '../lib/api';
import { readAuthStatus } from '../lib/auth';
import { pushSupported } from '../lib/push';
import { setTheme, storedTheme } from '../lib/theme';
import { navigate } from '../lib/router';
// The update plane's reading surface moved to a file of its own; this screen
// composes it. `ACK_UNREADABLE_TEXT`/`canAck` come THROUGH it because
// `NodeItem` is their consumer — see that file's header.
import { NodeList, ReleaseList, catalogueLine } from './updates';
import '../fleet/fleet.css';

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

/** Spec §13's two channel sentences, verbatim — one radio row each. */
export const CHANNEL_SENTENCES: Record<UpdateChannel, string> = {
  stable: "Stable — releases promoted after they've baked",
  dev: 'Dev — every merge, minutes after it lands',
};

/** The auto-install choices (`AutoMode`, W2) in the operator's words. */
export const AUTO_LABELS: Record<AutoMode, string> = {
  off: 'Off',
  stable: 'Stable releases only',
  channel: 'Every release on my channel',
};

/** The auto-install note's lead; the node labels follow, in `nodes()` order. */
const AUTO_GATE_NOTE = 'Auto-install needs the rollback gate on every node — not yet on: ';
/** A write that answered 2xx but unreadably (`postJsonOr`'s `unreadable`, D-1150): it may have landed. */
export const UNCONFIRMED_TEXT = "Saved — the server's answer could not be read; the screen will re-check.";
/** The first poll never landed and was not a 501 — a read that failed, said as one, not a skeleton forever. */
const UNREAD_TEXT = 'The update plane could not be read — the screen tries again every minute.';
/** A later poll failed: what is shown is the last answer that landed, and it says so. */
const STALE_TEXT = 'The latest read failed — this is the last answer that landed.';
/** The update surface's own sentence for a box with no control plane — Task 5's table, read through its one
 *  translator, so this file holds no second copy of it. */
const NOT_CONFIGURED_TEXT = updateErrorText(new ApiError(501, { ok: false, error: 'not-configured' }));
/** The one intent refusal rendered in place (by node label) instead of toasted (W2 Task 13). */
const AUTO_GATE_REFUSAL = 'auto-needs-rollback-gate' satisfies UpdateRouteError;

export function autoGateMissing(nodes: readonly NodeWire[]): NodeWire[] {
  // Array.isArray, not a bare `.includes`: a caps field that arrived as a
  // STRING would answer by substring and read as gated.
  return nodes.filter((n) => !(Array.isArray(n.caps) && n.caps.includes(UPDATE_GATE_CAP)));
}

/** The node ids a `409 auto-needs-rollback-gate` names; null for any other failure, and for a 409 naming no id
 *  (the caller then toasts the route's own sentence rather than an empty "not yet on:"). */
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
// moved there in fix round 1's second pass (F13, item 8) so `UpdateBanner`'s `bannerRelease` can share it —
// the banner used to decide "the catalogue was reached" with a bare `typeof … === 'number'`, which this
// screen's own `isPlaceableInstant` already refused (review F13). Used here by `catalogueLine`'s
// classification of `lastOkAt` AND by every renderer that prints a clock or a date off a wire instant —
// `clockTime`, `dayClock`, `releaseDate` — so there is exactly one place, shared by both surfaces, that
// decides "this build's Date cannot place it".

function ThemeRow({ choice, current, onPick, swatch = true }: {
  /** Structural, not `ThemeChoice`: "Follow system" is not a palette and
   *  carries no `mode`, but it IS this row — same label over the same note,
   *  same radio, in the same group. It was written out a second time instead,
   *  and the markup census found it. */
  choice: { id: string; label: string; note: string };
  current: string;
  onPick: (id: string) => void;
  /** "Follow system" draws none: there is no single palette to preview, and
   *  five swatches of whichever one happens to be applied would be a preview
   *  of the wrong thing. */
  swatch?: boolean;
}): ReactNode {
  const active = current === choice.id;
  return (
    <Radio
      className="settings-theme"
      data-active={active}
      name="settings-theme"
      value={choice.id}
      checked={active}
      onChange={() => onPick(choice.id)}
      bare
    >
      <span className="settings-theme-body">
        <span className="settings-theme-name">{choice.label}</span>
        <span className="settings-note">{choice.note}</span>
      </span>
      {/* `data-theme` on the swatch itself: tokens.css's blocks are plain
          attribute selectors, so they resolve on ANY element, not just the
          root. The preview is therefore the real palette rather than a
          hand-copied approximation of it. `phosphor` carries no block — it is
          :root — so it deliberately stamps nothing and inherits the default. */}
      {swatch && (
        <span
          className="settings-theme-swatch"
          aria-hidden="true"
          {...(choice.id === PHOSPHOR ? {} : { 'data-theme': choice.id })}
        >
          <i style={{ background: 'var(--bg-surface)' }} />
          <i style={{ background: 'var(--ink-primary)' }} />
          <i style={{ background: 'var(--accent)' }} />
          <i style={{ background: 'var(--status-attention)' }} />
          <i style={{ background: 'var(--status-dead)' }} />
        </span>
      )}
    </Radio>
  );
}

/** Not a palette, and deliberately not in `THEMES`: the generator writes that
 *  list and `themes:check` rules on it. This is the row that says "whichever
 *  of those two the phone is in". */
const FOLLOW_SYSTEM = {
  id: SYSTEM,
  label: 'Follow system',
  note: 'Phosphor & Ink after dark, Phosphor Daylight otherwise.',
};

/** Exported for its test. The rest of this screen mounts a `/api/updates`
 *  poll, and a test of a radio group should not need a control plane. */
export function AppearanceSection(): ReactNode {
  const titleId = useId();
  // Seeded from storage rather than defaulted, so the control opens showing
  // what is actually applied — including on a reload into a pinned palette.
  const [current, setCurrent] = useState(() => storedTheme());
  const pick = (id: string): void => { setTheme(id); setCurrent(id); };

  const dark = THEMES.filter((t) => t.mode === 'dark');
  const light = THEMES.filter((t) => t.mode === 'light');

  return (
    <section className="settings-section" aria-labelledby={titleId}>
      <h2 id={titleId} className="settings-section-title">Appearance</h2>
      <fieldset className={RADIO_FIELDSET}>
        <legend className={RADIO_LEGEND}>Theme</legend>
        <ThemeRow choice={FOLLOW_SYSTEM} current={current} onPick={pick} swatch={false} />
        {/* Grouped by how the palette reads, because that is the first thing
            anyone is choosing between — and the ask was light AND dark, not a
            dark list with one light apology. */}
        <p className={`${RADIO_LEGEND} settings-theme-group`}>Dark</p>
        {dark.map((t) => <ThemeRow key={t.id} choice={t} current={current} onPick={pick} />)}
        <p className={`${RADIO_LEGEND} settings-theme-group`}>Light</p>
        {light.map((t) => <ThemeRow key={t.id} choice={t} current={current} onPick={pick} />)}
      </fieldset>
    </section>
  );
}

// ── Notifications (spec §13 item 2, §12's unarmed banner; programme wave 3 Task 10) ──
// Two things live here, and one thing deliberately does not:
//   * The PHONE-PUSH toggle is the literal <NotificationBell/> — the same
//     component the fleet header mounts, with its four subscribe outcomes
//     (NotificationBell.tsx:29-47). This file imports none of lib/push's
//     lifecycle calls and spells none of those outcomes; a second copy of the
//     toggle is how two surfaces would come to disagree about whether this
//     browser is subscribed. `pushSupported()` is read here only to say why the
//     bell is absent (it renders nothing where Web Push cannot work).
//   * RELEASE NOTIFICATIONS are `update_intent['*'].notify` (W2's NotifyMode
//     column): one native radio per NOTIFY_MODES member
//     (D-3299), written through the one intent route.
//     The server's notifier (Task 3) reads the '*' row alone, so a per-node
//     scope is never offered here.
//   * NOT HERE: the release push itself. A tap on one of these radios changes
//     which tags the server will announce from the next sweep on; it sends
//     nothing and marks nothing.
//
// THE UNARMED-EXPOSURE BANNER (spec §12) sits above both sections. Its trigger
// is `AuthStatus.mode === 'off'` from the unauthenticated GET /api/auth/status
// (D-3298 — /health reports no gate state), AND a
// page origin whose hostname is not one of shared/base-url.ts's
// LOOPBACK_HOSTS: the one list of loopback spellings, reused rather than
// re-spelled (single-definition.test.ts's LOOP_SET scan holds that). Every
// non-answer draws NOTHING — a failed read, an older server with no route, a
// body without `mode` — because a red banner is a claim about this box, and a
// status read that told us nothing is not evidence of an open gate.

export const NOTIFY_LABELS: Record<NotifyMode, string> = { channel: 'on my channel', stable: 'stable only', off: 'off' };

/** The ONE spelling of the §12 sentence (the W4 doctor check will name the same route). */
export const UNARMED_EXPOSURE_TEXT =
  "The sign-in gate is off and this page was reached over a non-loopback address — anyone who can reach it can "
  + 'change what the fleet installs, and POST /api/updates/apply will let them install it. Arm the gate: '
  + 'CCRC_AUTH=on with CCRC_RP_ID and CCRC_ORIGIN, together (ccrc expose writes all three).';

/** (D-3298) true iff status?.mode === 'off' exactly AND !LOOPBACK_HOSTS.includes(hostname). */
export function unarmedExposure(status: Partial<AuthStatus> | null, hostname: string): boolean {
  return status?.mode === 'off' && !LOOPBACK_HOSTS.includes(hostname);
}

/** One status read per mount — the AccountsScreen `AuthSection` shape, whose
 *  argument (one extra anonymous GET on a rarely-visited screen, and a reader
 *  that never raises auth-lost) carries over unchanged. */
function UnarmedExposureBanner(): ReactNode {
  const [status, setStatus] = useState<Partial<AuthStatus> | null>(null);
  useEffect(() => {
    let live = true;
    void readAuthStatus()
      .then((s) => { if (live) setStatus(s); })
      .catch(() => { /* an older server, a proxy's 404, no network: this box told us nothing — draw nothing */ });
    return () => { live = false; };
  }, []);
  if (!unarmedExposure(status, location.hostname)) return null;
  return <div className="settings-unarmed" role="alert">{UNARMED_EXPOSURE_TEXT}</div>;
}

/** What the release-notifications radios show. `setAt: null` = a write in
 *  flight; a number = the route's own answer, shown until the poll's '*' row is
 *  at least that new — a controlled radio would otherwise snap back to the old
 *  choice for the length of one poll. */
interface ShownNotify { notify: NotifyMode; setAt: number | null }

function NotificationsSection({ view, reload }: { view: UpdatesView | null; reload: () => void }): ReactNode {
  const titleId = useId();
  const [supported] = useState(() => pushSupported());
  const [shown, setShown] = useState<ShownNotify | null>(null);
  const row = view === null ? null : (view.intent.find((i) => i.scope === FLEET_SCOPE) ?? null);
  const caughtUp = shown !== null && shown.setAt !== null && row !== null && row.setAt >= shown.setAt;
  const checked = shown !== null && !caughtUp ? shown.notify : (row?.notify ?? null);
  const saving = shown !== null && shown.setAt === null;

  const choose = async (notify: NotifyMode): Promise<void> => {
    if (saving) return;   // the disabled fieldset stops a finger; this stops a second call
    setShown({ notify, setAt: null });
    try {
      const answer = await api.setUpdateIntent({ scope: FLEET_SCOPE, notify });
      const stored = answer === 'unreadable' ? null : (answer?.intent ?? null);
      if (stored === null || !isNotifyMode(stored.notify) || typeof stored.setAt !== 'number') {
        // The write may have landed: say so, and let the poll decide what is checked.
        setShown(null);
        toast(UNCONFIRMED_TEXT);
      } else {
        setShown({ notify: stored.notify, setAt: stored.setAt });
      }
    } catch (err) {
      setShown(null);
      toast(updateErrorText(err), 'error');
    }
    reload();
  };

  return (
    <section className="settings-section" aria-labelledby={titleId}>
      <h2 id={titleId} className="settings-section-title">Notifications</h2>
      {supported ? (
        <div className="settings-bell-row">
          <NotificationBell />
          <span>Phone notifications for this browser</span>
        </div>
      ) : (
        <p className="settings-note">This browser cannot receive Web Push.</p>
      )}
      {view !== null && (
        <RadioFieldset
          legend="Release notifications"
          name="settings-notify"
          options={NOTIFY_MODES.map((m) => ({ value: m, label: NOTIFY_LABELS[m] }))}
          value={checked}
          onPick={(m) => void choose(m)}
          disabled={saving}
        />
      )}
    </section>
  );
}

export function SettingsScreen(): ReactNode {
  // ONE poll and ONE clock for the whole screen: every section reads the same
  // answer (Tasks 7–10), so two sections can never disagree about the fleet.
  const poll = useUpdatesView();
  const now = useNow(30_000);
  return (
    <div className="settings-screen">
      <header className="settings-head">
        <BackButton className="settings-back" aria-label="Back to fleet" onClick={() => navigate('/')}>
          ‹
        </BackButton>
        <h1 className="settings-title">Settings</h1>
      </header>
      <UnarmedExposureBanner />
      <AppearanceSection />
      <UpdatesSection poll={poll} now={now} />
      <NotificationsSection view={poll.view} reload={poll.reload} />
    </div>
  );
}

/** The Updates section's frame: its heading, and the three states before any view exists — loading, a box with
 *  no control plane, a first read that failed — each its own render (AccountsScreen's three-state discipline),
 *  so "don't know yet" never borrows the rendering of "nothing there". */
function UpdatesSection({ poll, now }: { poll: UpdatesPoll; now: number }): ReactNode {
  const titleId = useId();
  const { view, failure, reload } = poll;
  return (
    <section className="settings-section" aria-labelledby={titleId}>
      <h2 id={titleId} className="settings-section-title">Updates</h2>
      {view !== null ? (
        <UpdatesBody view={view} stale={failure !== null} now={now} reload={reload} />
      ) : failure === 'not-configured' ? (
        <p className="settings-note">{NOT_CONFIGURED_TEXT}</p>
      ) : failure === 'failed' ? (
        <p className="settings-note">{UNREAD_TEXT}</p>
      ) : (
        <Skeleton lines={3} />
      )}
    </section>
  );
}

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
  const [refreshNote, setRefreshNote] = useState<string | null>(null);
  // The move the operator is confirming — a plan taken at the tap, so a poll
  // landing while the sheet is open cannot change the list under a thumb.
  const [move, setMove] = useState<PlannedMove | null>(null);
  const openMove = (intent: MoveIntent): void => setMove(planMove(view, intent));

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
  const gateNote = gateLabels.length > 0 ? `${AUTO_GATE_NOTE}${gateLabels.join(', ')}` : null;
  const line = catalogueLine(view.catalogue, now);
  // Wave 8 item F1: the same unplaceable-reads-as-null rule catalogueLine's own `lastOkAt` classification uses
  // (:136), so a node's resolveDetail is qualified on the same basis the catalogue line itself is.
  const catalogueLastOkAt = view.catalogue.lastOkAt !== null && isPlaceableInstant(view.catalogue.lastOkAt)
    ? view.catalogue.lastOkAt : null;

  const writeIntent = (patch: { channel: UpdateChannel } | { auto: AutoMode }): void => {
    setBusy(true);
    if ('auto' in patch) setGateRefusal(null);
    void api.setUpdateIntent({ scope: FLEET_SCOPE, ...patch })
      .then(
        (answer) => { if (answer === 'unreadable') toast(UNCONFIRMED_TEXT); },
        (err: unknown) => {
          const refused = gateRefusalOf(err);
          // viewRef.current, not the closed-over `view` param (W5 F-A): the
          // view genuinely current when this 409 lands, never the one active
          // at the tap that started the write.
          if (refused !== null) setGateRefusal({ ids: refused, view: viewRef.current });
          else toast(updateErrorText(err), 'error');
        },
      )
      .finally(() => { setBusy(false); reload(); });
  };

  const checkNow = (): void => {
    setBusy(true);
    setRefreshNote(null);
    void api.refreshUpdates()
      .catch((err: unknown) => {
        // A 429 is the route's interval guard (W2 Task 13's
        // `REFRESH_MIN_INTERVAL_MS`, derived, D-3218), not a failure: GitHub
        // was ASKED too recently — by a request that may itself have
        // failed (D-3203 counts every request), so the note claims the request
        // and never a "checked" (the catalogue line owns that word, and only
        // off a non-null lastOkAt).
        if (err instanceof ApiError && err.status === 429) setRefreshNote(updateErrorText(err));
        else toast(updateErrorText(err), 'error');
      })
      .finally(() => { setBusy(false); reload(); });
  };

  return (
    <>
      {stale && <p className="settings-note">{STALE_TEXT}</p>}
      <RadioFieldset
        legend="Channel"
        name="settings-channel"
        options={UPDATE_CHANNELS.map((c) => ({ value: c, label: CHANNEL_SENTENCES[c] }))}
        value={fleet?.channel ?? null}
        onPick={(c) => writeIntent({ channel: c })}
        disabled={busy}
      />
      <RadioFieldset
        legend="Auto-install"
        name="settings-auto"
        /* D-3315: only the non-'off' choices are gated on the node caps — the
           route accepts `auto: 'off'` unconditionally (server/src/update/routes.ts),
           so disabling the whole fieldset would remove the one safe action
           exactly when the gate is incomplete. */
        options={AUTO_MODES.map((m) => ({
          value: m,
          label: AUTO_LABELS[m],
          disabled: m !== 'off' && missing.length > 0,
        }))}
        value={fleet?.auto ?? null}
        onPick={(m) => writeIntent({ auto: m })}
        disabled={busy}
        describedBy={gateNote !== null ? gateNoteId : undefined}
      />
      {gateNote !== null && <p id={gateNoteId} className="settings-note">{gateNote}</p>}
      <Button variant="ghost" className="settings-check" disabled={busy} onClick={checkNow}>
        Check now
      </Button>
      {refreshNote !== null && <p className="settings-note" aria-live="polite">{refreshNote}</p>}
      <p className={line.tone === 'calm' ? 'settings-catalogue' : `settings-catalogue settings-catalogue--${line.tone}`}>
        {line.text}
      </p>
      {view !== null && <ReleaseList releases={view.releases} nodes={view.nodes} onMove={openMove} />}
      {view !== null && (
        <NodeList
          nodes={view.nodes} releases={view.releases} now={now} catalogueLastOkAt={catalogueLastOkAt} onAcked={reload} onMove={openMove}
        />
      )}
      <UpdateMoveSheet open={move !== null} plan={move} onClose={() => setMove(null)} onDone={reload} />
    </>
  );
}
