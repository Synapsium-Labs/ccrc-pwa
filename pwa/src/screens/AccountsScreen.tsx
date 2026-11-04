// Accounts screen (route `/accounts`, Task 6 of Build 3 PR G) — every account
// ccd knows about, not just the ones with headroom to spare. The lanes row
// (AccountsStrip) hides a switched-off lane and only shows a window
// that "exists" for the account type; this screen's brief is the opposite —
// "show me my accounts" — so a disabled lane still gets a row (greyed, with
// its reason) and both windows always render, each through `windowReading`
// (laneWords.ts): `n%` measured, `0%` for a window that rolled over (spoken as
// inferred), and `—` never measured, rather than the row disappearing.
//
// It reads the fleet store's accounts answer (`usage`, `projected`, `roster`, `lanes`), which the store's one
// `/api/accounts` poll writes (C8, D-6440): the store is connected app-wide whichever route is mounted, so the
// screen needs no poll of its own.
//
// ONE STATE WORD PER LANE (accounts plan Task A2, D-7718; spec 2026-10-18 accounts-connect §4). Each card's head is
// two lines: the hue chip with the mono id, the label (ellipsised) and the lamp, right-aligned; then the kind chip,
// the identity line and the pool chip. The word is the server's (`LaneWire.state`, `stateWordFor`); the screen
// derives none of its own (`laneAnswerOf` falls back to the same function only when the answer carries no lane
// state). Signed out, Rate-limited, Expiring and Inconclusive lift to the top as trouble cards, and the measured
// roll-up opens the page. THE POOL CHIP AND `AccountPoolSheet` STAY through the redesign (D-7718's amendment): pool
// membership is still set here (spec §8.4).
//
// CHECK AND THE KILL SWITCH (accounts plan Task A14, D-7732; spec §10): every card whose answer carries `connect` draws
// the knob row (`fleet/AccountKnob.tsx`), which moves only on the server's ack, and a trouble card whose fix is a check
// offers Check again on the same route.
//
// THE ADD ACCOUNT DOOR (accounts plan Task A18, D-5522, D-7740; spec §5): one per width, mounted, never CSS-hidden. On a
// phone (both skins) it is the lane list's last row; at ≥900 it is the page header's action, in both skins until
// Instrument's list column holds this route's list (A4). It narrows in place with its reason, and opens the connect
// sheet (`accounts/ConnectSheet.tsx`). OFFLINE (spec §12.5) is the store's own reading (`conn === 'down'`), never
// `navigator.onLine`: every act on the screen (the door, Check, the knob) is refused with one sentence and the read-line.
//
// RESUME AND THE METHOD SWITCHES (accounts plan Task A23, D-7871; spec §6.2, §9, §4.2, §4.4). A lane whose sign-in THIS
// session started waits for its code: its card says so with Continue and Cancel, and `/accounts?resume=<id>` (the
// app-level banner's Continue) opens the sheet that continues it at the code field: the method switch sheet for a
// switch, the connect sheet for a lane it added (`resumeSheetFor`). A sign-in lane's fold offers Switch to a long-lived
// token, which is also a Signed-out sign-in lane's primary fix (Q1); a token lane's fold offers Switch to sign-in. Both
// run only on a fleet that advertises the sign-in's cap word (`account-auth-v1`).
//
// RE-AUTHENTICATE (accounts plan Task A38, D-7872; spec §9 rows 1, 2, §4.2). On the same fleets, a trouble card's acts
// come in the spec's order (`troubleActs`), the first the primary, each opening the sheet it names: Sign in again and
// Mint a new token open the re-auth sheet, the switches A23's switch sheet, Paste a token A19's paste sheet. A token
// lane's Replace token opens the mint first, with the paste its second way. Without the cap word, a token lane keeps
// A19's paste arm alone.
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ACCOUNT_AUTH_CAP, isArchivedRow, type AccountUsage, type ProjectedHome, type RosterWire } from '../../../shared/api';
import type { AccountStateAnswer } from '../../../shared/accounts';
import type { AccountPoolWire } from '../../../shared/poolrule';
import { Button, PageScaffold, Skeleton, toast, useDesk, useNow } from '@ccrc/ui';
import { AddAccountDoor, ConnectSheet, DoorReason } from '../accounts/ConnectSheet';
import { RemoveSheet } from '../accounts/RemoveSheet';
import { ReplaceSheet } from '../accounts/ReplaceSheet';
import { MethodSwitchSheet } from '../accounts/MethodSwitchSheet';
import { CREDENTIAL_ACT_LABEL, ReauthSheet, troubleActs, type CredentialAct } from '../accounts/ReauthSheet';
import { heldAttemptOf, isPastAdding, resumeSheetFor, switchTargetOf, type SignInMethod } from '../accounts/connectFlow';
import { wordOf, type HeldAttempt } from '../accounts/useSignInAttempt';
import { AccountMeterRow } from '../fleet/AccountMeterRow';
import { AccountPoolSheet } from '../fleet/AccountPoolSheet';
import { cardLines, connectBlock, DOOR_NARROWED, doorNarrowing, identityLine, isTrouble, kindChipWords, laneAnswerOf, notReadyWords, offAlso, offlineRefusal, REMOVE_ACT, REPLACE_TOKEN, rollUp, SIGN_IN_AGAIN, troubleCopy, troubleFirst, WEEKLY_ONLY } from '../fleet/accountWords';
import { CANCEL_SIGN_IN, CONTINUE, RESUME_CARD_LINE, SWITCH_TO_SIGN_IN, SWITCH_TO_TOKEN, cancelRefused } from '../fleet/accountWords';
import { StateLamp, TroubleCard } from '../fleet/TroubleCard';
import { AccountKnob, useLaneActs } from '../fleet/AccountKnob';
import { presenceOf } from '../fleet/presence';
import { sessionLabel } from '../fleet/sessionLabel';
import { accountColorVar, accountLabel, accountPoolState, homeAbleLabelList, rosterWrapperIds } from '../lib/accounts';
import { api, apiErrorText } from '../lib/api';
import { navigate, useLocation } from '../lib/router';
import { laneParam, resumeParam, sessionPath } from '../lib/routes';
import { backToFleet } from '../command/door';
import { useFleetStore, type FleetStore } from '../stores/fleet';
import '../fleet/fleet.css';
import { poolCleared, poolWriteFailed } from '../fleet/poolWords';

/** The chip's short text, accessible name and `data-pool`/`data-origin` for
 *  EVERY `AccountPoolWire` state — review round 1, I4. `malformed`,
 *  `unreadable` and `stale` are just as UNDECIDABLE to `poolRule` as each
 *  other (a 503, never a crossing offer, design §5.7) — collapsing any of
 *  them to "no pool" claims the opposite of what the server actually does
 *  with them: unconstrained, may serve any project. Distinct words for
 *  `stale` vs `unreadable` on purpose (design §5.7's own words: "one's
 *  remedy is file permissions, the other's is the control-plane link").
 *  Not producible by today's server (`resolvedAccountPool` only ever
 *  returns `tagged`/`untagged` — server/src/poolrule.ts), so this is latent,
 *  forward-looking coverage, not a reachable-today path.
 *
 *  Exhaustive over the current five-member union: the `never` assignment in
 *  the default arm is what makes a sixth member (a future server) a compile
 *  error here, rather than a silent "no pool" narrowing — `ProjectCard`'s own
 *  `PoolChip` makes the identical argument for its `unrecognised` fallback,
 *  the one condition TypeScript cannot see: a value that arrives at runtime
 *  off the type this build was compiled against. */
/** What the account-pool chip discloses when the fleet host's `ccd` has no
 *  ACCOUNT-pool machinery yet (`accountPools: 'unavailable'`) — the sibling
 *  fact `ProjectCard.tsx`'s `POOL_UNAVAILABLE_TEXT` states for project pools,
 *  named separately because the two are independent capabilities
 *  (`poolsEnforcement` reads `PROJECT_POOL_VERB`; `accountPoolsEnforcement`
 *  reads `ACCOUNT_POOLS_CAP` — a fleet can have one without the other).
 *
 *  UNLIKE the project chip, this one stays a clickable button when dimmed
 *  (see its `data-dim` usage below) rather than degrading to an inert span:
 *  a project tag write dispatches a `ccd` verb that a `poolsEnforcement:
 *  'unavailable'` fleet genuinely cannot run, but an account tag write is a
 *  central `coord.db` row this SERVER always accepts — `accountPools:
 *  'unavailable'` means no fleet node reads it YET, not that the write would
 *  fail. Disabling the control would also be the only way an operator could
 *  ever see this text, since the chip is the sheet's one entry point.
 *
 *  Exported so the suite pins the sentence rather than a paraphrase of it. */
export const ACCOUNT_POOL_UNAVAILABLE_TEXT = 'fleet ccd predates account pools';

function acctPoolChip(state: AccountPoolWire): {
  word: string; ariaLabel: string; dataPool: string; origin?: 'central' | 'declared';
} {
  switch (state.state) {
    case 'tagged':
      return {
        word: state.pools[0], dataPool: 'tagged', origin: state.origin,
        ariaLabel: `pool ${state.pools[0]}, opens the account pool editor`,
      };
    case 'untagged':
      return {
        word: 'no pool', dataPool: 'untagged', origin: state.origin,
        ariaLabel: 'no pool, opens the account pool editor',
      };
    case 'malformed':
      return {
        word: 'pool malformed', dataPool: 'malformed',
        ariaLabel: "this account's pool tag is malformed — nobody can decide whether it may serve a tagged project, opens the account pool editor",
      };
    case 'unreadable':
      return {
        word: 'pool unreadable', dataPool: 'unreadable',
        ariaLabel: "this account's pool tag could not be read — check permissions on the fleet host, opens the account pool editor",
      };
    case 'stale':
      return {
        word: 'pool stale', dataPool: 'stale',
        ariaLabel: "this account's pool projection is stale — the control-plane link may be down, opens the account pool editor",
      };
    default: {
      const unhandled: never = state;
      void unhandled;
      return {
        word: 'pool unrecognised', dataPool: 'unrecognised',
        ariaLabel: 'app bundle is older than the fleet; reload to understand this account pool, opens the account pool editor',
      };
    }
  }
}

// `accountPoolState(roster, wrapper)` — no edges map (ruling T9-R1). The
// fleet store's `GET /api/accounts` read (`useAccountsPoll` below) carries the
// roster, and `RosterWire.resolvedPool` (Task 7's T7-R2 fix round) rides the
// same response when the server has one to offer — see `lib/accounts.ts`'s
// own docstring. Every row below renders whatever `accountPoolState` returns
// without this screen having to know whether that came from a resolved
// central tag or the declared fallback.

interface AccountsPoll {
  accounts: readonly AccountUsage[] | null;      // null: no good answer has landed yet
  projected: ProjectedHome | null | undefined;    // undefined: no answer yet; null: landed, nothing placeable
  roster: readonly RosterWire[];                  // []: no good answer has landed yet, same as accounts/projected
}

/** The screen's view of the fleet store's accounts answer. The store is the one reader (C8, D-6440) and keeps the
 *  last good value of each field across a failed or malformed read, so a bad poll never empties a row the screen
 *  already drew (the rule this hook used to apply to `roster` alone, fix round 1, finding 5). `store` defaults to the
 *  app-wide fleet store (`RunsScreen`'s idiom). */
function useAccountsPoll(store: FleetStore = useFleetStore): AccountsPoll {
  const accounts = store((s) => s.usage);
  const projected = store((s) => s.projected);
  const roster = store((s) => s.roster);
  return { accounts, projected, roster };
}

/** The roster's declaration order first, then any wrapper the server has
 *  telemetry for that the roster doesn't (yet) know about — the same union
 *  SwapSheet's pickableWrappers uses, so a fifth account never goes missing
 *  from either surface.
 *
 *  BEFORE THE FIRST POLL: `roster` and `accounts` arrive on the exact same
 *  `GET /api/accounts` response, so they are unknown for exactly the same
 *  instant — there is no wrapper id to key a row on yet, roster-derived or
 *  not. Unlike the compile-time `KNOWN_WRAPPERS` this replaces (five ids,
 *  always available, so `rowOrder` was never empty), an empty roster
 *  genuinely has nothing to enumerate — `rowOrder` returns `[]` here, and the
 *  loading branch below renders a plain, count-free skeleton instead of one
 *  row per (unknown) account. That is the honest degrade this task's brief
 *  asks for: guessing at a row count before the roster says what the
 *  accounts ARE would be inventing accounts, the exact failure class this
 *  whole stage exists to end. */
function rowOrder(roster: readonly RosterWire[], accounts: readonly AccountUsage[]): string[] {
  const order: string[] = rosterWrapperIds(roster);
  for (const a of accounts) if (!order.includes(a.wrapper)) order.push(a.wrapper);
  return order;
}

export function AccountsScreen(): ReactNode {
  const { accounts, projected, roster } = useAccountsPoll();
  // Opening Accounts asks once (D-7180; coordinator call 3): the screen shows the store's answer at once, then a fresh
  // one, as it did before the store became the one reader. The store's 20 s poll stays the only cadence.
  const refreshAccounts = useFleetStore((s) => s.refreshAccounts);
  useEffect(() => { void refreshAccounts(); }, [refreshAccounts]);
  const sessions = useFleetStore((s) => s.sessions);
  // Item 3 (I1, wave-1 fix round A): the fleet-level `pools` frame's
  // `accountPools` capability — produced (T9-R2/F2, `server/src/pools.ts`'s
  // `accountPoolsEnforcement`) and, until this round, read by nothing in
  // `pwa/`. `null` (no frame yet) and `undefined` (an older server that never
  // sends the field) both mean "no evidence", the same as `ProjectCard`'s own
  // `pools?.enforcement` read — only a MEASURED `'unavailable'` dims the chip.
  const accountPools = useFleetStore((s) => s.pools?.accountPools);
  const now = useNow(30_000);
  const nowSec = Math.floor(now / 1000);
  // `GET /api/accounts`'s `lanes`: each lane's word and what the screen may show about its credential, sent only to a
  // reader with the session verdict (D-5511). `null` before it lands, and on a dark gate's answer.
  const lanes = useFleetStore((s) => s.lanes);
  // `connect`, on the same terms (A12): whether the screen may run a lane act, and why not. `null` draws no knob row.
  const connect = useFleetStore((s) => s.accountsConnect);
  // Offline (spec §12.5): the store's own reading, with the age of the last accounts answer as the read-line.
  const conn = useFleetStore((s) => s.conn);
  const accountsReadAt = useFleetStore((s) => s.accountsReadAt);
  const offline = conn === 'down' ? offlineRefusal(accountsReadAt(), now) : null;
  const blocked = offline ?? (connect === null ? null : connectBlock(connect));
  // Check and the kill switch (accounts plan Task A14, D-7732): the act in flight per lane, and each ack's switch.
  const acts = useLaneActs(refreshAccounts);

  // Each lane's one word, once per render: the order, the roll-up and the card all read the same answer.
  const answers = new Map<string, AccountStateAnswer>();
  const answerOf = (wrapper: string): AccountStateAnswer => {
    let a = answers.get(wrapper);
    if (a === undefined) {
      a = laneAnswerOf(
        lanes?.[wrapper], accounts?.find((x) => x.wrapper === wrapper) ?? null, roster.find((r) => r.id === wrapper), now,
      );
      answers.set(wrapper, a);
    }
    return a;
  };
  // Trouble cards first (spec §4.2), every other lane in roster order.
  const order = troubleFirst(rowOrder(roster, accounts ?? []), (w) => answerOf(w).word);

  // The arrival at a lane (T2c, D-6329, Q14): a lane card opens `/accounts?lane=<id>`, and the screen scrolls that
  // lane's row into view, focuses it and marks it with one accent edge. A PASSIVE effect, never a layout one: the
  // shell's pane reset to the top (app.tsx) is a layout effect that runs on every path or search change, and layout
  // effects run child before parent, so an arrival made in a layout effect would be undone by it. It is keyed on the
  // lane AND on whether the lane's row exists, because the rows are drawn only once the poll lands (`order` is empty
  // until then): an arrival at mount finds no row, and the same effect finishes the job when the poll brings it.
  // `arrivedAt` holds the last lane arrived at, so each value scrolls once and a re-render never moves focus again;
  // a second `?lane=` on the same mount is a new value and arrives once. An unknown lane arrives nowhere.
  const search = useLocation().search;
  const lane = laneParam(search);
  const laneRowExists = lane !== null && accounts != null && order.includes(lane);
  const rowRefs = useRef(new Map<string, HTMLElement>());
  const arrivedAt = useRef<string | null>(null);
  const [arrived, setArrived] = useState<string | null>(null);
  useEffect(() => {
    // The record follows the param: no lane, or a lane with no row, clears the edge and the ref, so a later return to
    // the lane that was arrived at arrives again (the shell's reset will have put the pane back at the top).
    if (!laneRowExists || lane === null) { arrivedAt.current = null; setArrived(null); return; }
    if (arrivedAt.current === lane) return;
    const row = rowRefs.current.get(lane);
    if (row === undefined) return;
    arrivedAt.current = lane;
    row.scrollIntoView({ block: 'start' });
    row.focus({ preventScroll: true });
    setArrived(lane);
  }, [lane, laneRowExists]);

  // The account-pool editor — one sheet, retargeted per tap, on the exact
  // terms `PoolSheet`/`FleetScreen`'s own pool sheet already use: the route-
  // owned subject lives here, not inside the sheet.
  const [poolSheetAccount, setPoolSheetAccount] = useState<string | null>(null);
  const [poolSheetOpen, setPoolSheetOpen] = useState(false);

  // `POST /api/pools/accounts/:id` (Task 7) does not echo the account's
  // resulting tag — only the epoch the write produced — so this toasts off
  // the REQUEST, not a remeasurement, and leans on the fleet store's 20s
  // accounts poll (`useAccountsPoll`) to bring the row's next `accountPoolState` read in line
  // with what the fleet host actually converges to (ccd-pool-sync's pull,
  // `OnUnitActiveSec=60s` — the same lag the fleet head's epoch/observed
  // indicator exists to make visible elsewhere).
  const setAccountPool = (accountId: string, pools: string[]): void => {
    void api.setAccountPools(accountId, pools).then(
      (response) => {
        if (response.warning === 'unknown-account') {
          toast(
            `Tagged ${accountId}${pools.length > 0 ? ` into pool ${pools[0]}` : ''}, but this box's roster `
              + 'does not know that account yet.',
            'error',
          );
        } else {
          toast(pools.length > 0 ? `${accountId} is now in pool ${pools[0]}.` : poolCleared(accountId));
        }
      },
      (error: unknown) => toast(poolWriteFailed(apiErrorText(error)), 'error'),
    );
    setPoolSheetOpen(false);
  };

  // ccd's own rule, restated ("next workspace lands here — least-loaded"),
  // including the Rider B case where nothing is placeable. `undefined`
  // (nothing polled yet) says nothing — same three-state read ProjectCard's
  // addLabel already makes, never collapsing "don't know yet" into either
  // defined answer.
  //
  // `projected === null` is a claim about HOME_ABLE lanes only (gpt is never
  // consulted — see homeAbleLabelList) — this same screen renders a gpt row
  // right below, so "all accounts disabled" would read as a claim about the
  // list under it that the server never actually checked. Naming the three
  // lanes individually is what ccd's own placement refusal already does.
  //
  // `homeAbleNames === ''` (fix round 1, finding 7): `projected` and `roster`
  // arrive on the same poll response in the steady state, but a first
  // response that lands with a valid `projected: null` and a malformed
  // `roster` leaves `roster` at its `[]` default (the store preserves rather
  // than clobbers on a malformed read — see `useAccountsPoll`'s comment) —
  // same degenerate case ProjectCard's `addLabel` guards.
  const homeAbleNames = homeAbleLabelList(roster);
  const projectionLine = projected === undefined
    ? null
    : projected === null
      ? homeAbleNames === ''
        ? 'Next workspace: all disabled — nothing can take it'
        : `Next workspace: ${homeAbleNames} all disabled — nothing can take it`
      : `Next workspace lands on ${accountLabel(roster, projected.wrapper)} — least-loaded`;

  // The door (D-5522): its narrowing first (offline, then the server's own `connect`), and the sheet it opens. The sheet
  // is keyed per opening, so every opening starts at the provider frame with nothing held from the last.
  const desk = useDesk();
  const narrowing = offline !== null ? null : doorNarrowing(accounts !== null, connect);
  const doorReason = offline !== null ? { text: offline } : narrowing === null ? null : DOOR_NARROWED[narrowing];
  const doorReasonId = 'acct-door-reason';
  const [connectOpen, setConnectOpen] = useState(false);
  const [connectGen, setConnectGen] = useState(0);
  const openConnect = (): void => { setConnectGen((g) => g + 1); setConnectOpen(true); };
  const door = (
    <AddAccountDoor desk={desk} narrowedBy={doorReason === null ? null : doorReasonId} onOpen={openConnect} />
  );
  const reason = doorReason === null ? null : <DoorReason id={doorReasonId} text={doorReason.text} fix={'fix' in doorReason ? doorReason.fix : undefined} />;

  // Remove and Replace token (accounts plan Task A19, D-7742): the fold's two sheets, hosted here rather than on a card,
  // because a removed lane's card goes with it and its ledger must stay. Each is keyed per opening.
  const [removing, setRemoving] = useState<{ id: string; gen: number } | null>(null);
  const [replacing, setReplacing] = useState<{ id: string; gen: number } | null>(null);
  const sheetGen = useRef(0);
  const openRemove = (id: string): void => setRemoving({ id, gen: ++sheetGen.current });
  const openReplace = (id: string): void => setReplacing({ id, gen: ++sheetGen.current });
  const readRoster = (): readonly RosterWire[] => useFleetStore.getState().roster;

  // The method switches and resume (accounts plan Task A23, D-7871): the switch sheet, and the connect sheet reopened on
  // an attempt this session started on a lane it added. Each keyed per opening, as above.
  const canSwitch = connect?.caps?.includes(ACCOUNT_AUTH_CAP) === true;
  const [switching, setSwitching] = useState<{ id: string; to: SignInMethod; gen: number; resume?: HeldAttempt } | null>(null);
  const [resumingConnect, setResumingConnect] = useState<{ id: string; held: HeldAttempt; gen: number } | null>(null);
  const openSwitch = (id: string, to: SignInMethod, resume?: HeldAttempt): void =>
    setSwitching({ id, to, gen: ++sheetGen.current, ...(resume !== undefined ? { resume } : {}) });
  /** Continue: the sheet that runs this session's attempt on lane `id`, at its code field (spec §6.2). */
  const openResume = (id: string): void => {
    const held = heldAttemptOf(lanes?.[id], Date.now());
    if (held === null) return;
    const kind = roster.find((r) => r.id === id)?.kind;
    const sheet = resumeSheetFor(kind, held.method, isPastAdding(lanes?.[id], accounts?.find((x) => x.wrapper === id)));
    if (sheet === 'switch') openSwitch(id, held.method, held);
    else if (sheet === 'reauth') openReauth(id, held.method, held);
    else setResumingConnect({ id, held, gen: ++sheetGen.current });
  };
  // `/accounts?resume=<id>` (the banner's Continue): opens once per value, as soon as the store's answer holds the
  // attempt; the attempt is read from that answer, never from the URL.
  const resumeId = resumeParam(search);
  const resumeHeld = resumeId !== null && heldAttemptOf(lanes?.[resumeId], now) !== null;
  const resumedFor = useRef<string | null>(null);
  useEffect(() => {
    if (resumeId === null) { resumedFor.current = null; return; }
    if (!resumeHeld || resumedFor.current === resumeId) return;
    resumedFor.current = resumeId;
    openResume(resumeId);
  });
  // Re-authenticate an existing lane (accounts plan Task A38, D-7872; spec §9 rows 1, 2): Sign in again on a sign-in
  // lane, Mint a new token on a token lane, each with the method the lane already has. One sheet at a time: opening it
  // closes the paste sheet, so only one step-up challenge is ever live (`useStepUp`'s one-instance rule).
  const [reauthing, setReauthing] = useState<{ id: string; method: SignInMethod; gen: number; resume?: HeldAttempt } | null>(null);
  function openReauth(id: string, method: SignInMethod, resume?: HeldAttempt): void {
    setReplacing(null);
    setReauthing({ id, method, gen: ++sheetGen.current, ...(resume !== undefined ? { resume } : {}) });
  }
  /** A token lane's Replace token: the mint first (with paste as its second way) where the fleet can mint. */
  const openTokenReplace = (id: string): void => { if (canSwitch) openReauth(id, 'setup-token'); else openReplace(id); };
  const openAct = (id: string, act: CredentialAct): void => {
    switch (act) {
      case 'switch-to-token': openSwitch(id, 'setup-token'); return;
      case 'sign-in-again': openReauth(id, 'login'); return;
      case 'mint-new-token': openReauth(id, 'setup-token'); return;
      case 'replace-token': openTokenReplace(id); return;
      case 'paste-token': openReplace(id); return;
      case 'switch-to-sign-in': openSwitch(id, 'login'); return;
    }
  };
  /** A sheet opened by the resume query, closed: the query goes, so a re-render never reopens it. */
  const dropResume = (): void => { if (resumeParam(location.search) !== null) navigate('/accounts', { replace: true }); };
  /** Cancel, from the card: the attempt ends at the box, then the screen reads the lanes again. */
  const [cancellingAuth, setCancellingAuth] = useState<string | null>(null);
  const cancelAttempt = async (id: string, attemptId: string): Promise<void> => {
    if (cancellingAuth !== null) return;
    setCancellingAuth(id);
    try {
      await api.accountAuthCancel(id, { attemptId });
    } catch (e) {
      const word = wordOf(e);
      if (word !== 'no-auth-attempt') toast(cancelRefused(word), 'error');
    }
    await refreshAccounts();
    setCancellingAuth(null);
  };

  return (
    // The page scaffold (D-5102). The body's grid keeps the old screen's rhythm, --sp-3 between blocks.
    <PageScaffold title="Accounts" back={backToFleet('accounts-back')} actions={desk ? door : undefined}>
      {/* At ≥900 the door is the header's action, and its reason is the body's first line, beneath it. */}
      {desk && reason}

      {/* The measured roll-up (spec §4.3), zero clauses omitted, and today's projection line under it. The scaffold has
          no subtitle slot, so it is the body's first line. */}
      {accounts && <p className="accounts-rollup">{rollUp(order.map((w) => answerOf(w).word))}</p>}
      {projectionLine !== null && <p className="accounts-projection">{projectionLine}</p>}

      <div className="accounts-list">
        {!accounts ? (
          // No poll has landed yet — still in flight, or every attempt so
          // far has failed (host down, PWA opened offline, mid restart).
          // Rendering the rows below in that state would find `a === null`
          // for every account and print "last reported —" across the board:
          // literally true of the fixture ("nothing measured") but false of
          // the account ("never asked" reads as "never landed" to whoever's
          // looking). Same three-state discipline as `projectionLine` above
          // — "don't know yet" gets its own render, not a borrowed one.
          // Falsy, not `=== null`: a same-shape sibling (AccountsStrip) was
          // handed a bare `undefined` by a test fixture whose stub returns
          // `{}` for an unmatched route, despite the declared `T[] | null` —
          // `!accounts` degrades to this branch instead of crashing on it.
          //
          // NOT one skeleton row per `order` entry any more: `order` is
          // DERIVED from `roster`, which arrives on this same unlanded poll —
          // before it lands there is no wrapper id to key a row on, roster or
          // not (unlike the compile-time `KNOWN_WRAPPERS` this replaced,
          // which always had five). Guessing a row count from the roster this
          // screen has not received yet would be inventing accounts, so a
          // single count-free skeleton block stands in for "loading" instead
          // — see `rowOrder`'s own comment.
          <section className="accounts-row" data-loading="true">
            <Skeleton lines={3} />
          </section>
        ) : order.map((wrapper) => {
          const a = accounts.find((x) => x.wrapper === wrapper) ?? null;
          // TWO facts, ONE affordance. `disabled` is the operator's kill-switch and `authDead` the health probe's
          // measurement; the lamp below says which one applies (Off outranks Signed out, and both stay in the full
          // record), and both grey the meters, because on this screen they answer the same question: can this lane
          // take work? `=== true` on both: a server built before `authDead` omits it, and absence is not condemned.
          const disabled = a?.disabled === true;
          const authDead = a?.authDead === true;
          const off = disabled || authDead;
          const entry = roster.find((r) => r.id === wrapper);
          const answer = answerOf(wrapper);
          const laneWire = lanes?.[wrapper];
          const lines = cardLines(answer, a?.ts ?? null, nowSec);
          const kindWords = kindChipWords(entry);
          const identity = identityLine(laneWire, answer.word, nowSec);
          const also = offAlso(answer, a);
          // "Sessions on this account" means LIVE sessions (Rider A §4): a
          // workspace that is archived, mid-cleanup, or that the server does
          // not read alive is not load on this account, even though it still
          // carries the account's `wrapper` and stays in the fleet store until
          // reaped. Archived is the server's bucket, `isArchivedRow` (shared/api.ts,
          // OA-C15 (a), D-7188): it covers both 'archived' and 'cleanup'.
          // Live is the server's word (`presenceOf`, OA-C15 (a), D-7181): a
          // doubted, sleeping or old-server row is not counted, as today, and
          // a pane gone under `restarting` is the session itself, alive.
          const onAccount = sessions.filter(
            (s) => s.wrapper === wrapper && !isArchivedRow(s) && presenceOf(s) === 'alive',
          );
          // `accountPoolState`, not `accountPool` — this chip is the one
          // surface in the app whose whole job is to say WHICH carrier
          // decided (`data-origin`), so an operator who just cleared a
          // central tag sees the declared default take over rather than a
          // chip that looks unchanged. `acctPoolChip` covers all five states,
          // not just tagged/untagged (I4).
          //
          // Review round 1, Minor: `inRoster` gates the chip entirely for a
          // wrapper `rowOrder` added from LIVE TELEMETRY the roster does not
          // (yet) have an entry for (`rowOrder`'s own docstring). Without
          // this, `accountPoolState` still answers `{state:'untagged',
          // origin:'declared'}` for such a wrapper — a POSITIVE claim ("the
          // roster declares this untagged") about an account this roster has
          // no entry to declare anything about, which is a different, worse
          // claim than the old code's silence. `accountLabel`'s raw-name
          // fallback is a safe degrade for the SAME condition because it
          // asserts nothing; an origin claim is not that.
          const inRoster = roster.some((a) => a.id === wrapper);
          const poolState = accountPoolState(roster, wrapper);
          const chip = acctPoolChip(poolState);
          // Item 3 (I1): measured `'unavailable'` only — `undefined`/`'unknown'`
          // are no-evidence-either-way, same polarity as `ProjectCard`'s
          // `poolDim`, so a fleet nobody has measured yet never dims the chip
          // on a guess.
          const acctPoolDim = accountPools === 'unavailable';
          const trouble = isTrouble(answer.word)
            ? troubleCopy({ id: wrapper, answer, entry, lane: laneWire, usage: a, sessions: onAccount.length, now })
            : null;
          // A Codex lane has no 5-hour window: its absent 5h says so rather than "—" (spec §4.1).
          const weeklyOnly = entry?.kind === 'codex' && (a?.five ?? null) === null;
          // The kill switch (spec §10): as the last answer has it, or as an ack set it until the next answer lands. An
          // off lane that is not ready says why it cannot be turned on; an on lane can always be switched off.
          const switchOn = acts.acked[wrapper] ?? answer.word !== 'off';
          const notReady = !switchOn && laneWire !== undefined && !laneWire.ready ? notReadyWords(laneWire.notReadyReason) : null;
          const canAct = connect !== null && blocked === null && inRoster;
          // An Anthropic lane on a long-lived token: its credential act is Replace token (spec §4.4, §9).
          const tokenLane = entry?.provider === 'anthropic' && entry.kind === 'token';
          // The method switch its fold offers (spec §4.4, §9; Q1), on a fleet that runs a sign-in (Task A23, D-7871).
          const switchTo = canSwitch ? switchTargetOf(entry) : null;
          // This session's attempt on the lane, waiting for its code (spec §6.2): the card's resume line.
          const held = heldAttemptOf(laneWire, now);
          const waitingCode = held !== null && laneWire?.authAttempt?.state === 'waiting-code';
          return (
            <section
              key={wrapper}
              className={answer.word === 'signed-out' ? 'accounts-row acct-rail' : 'accounts-row'}
              data-disabled={off ? 'true' : 'false'}
              data-lane={wrapper}
              data-state={answer.word}
              data-trouble={trouble !== null ? 'true' : undefined}
              data-arrived={arrived === wrapper ? 'true' : undefined}
              tabIndex={-1}
              ref={(el) => { if (el === null) rowRefs.current.delete(wrapper); else rowRefs.current.set(wrapper, el); }}
            >
              {/* The head, on two lines so it never wraps unpredictably at 360 (spec §4.4). Line 1: the hue chip with
                  the mono id, the label (ellipsised) and the lamp, right-aligned. */}
              <div className="accounts-row-head">
                <span
                  className="acct-card-id"
                  style={{ color: off ? 'var(--ink-tertiary)' : `var(${accountColorVar(roster, wrapper)})` }}
                >
                  {wrapper}
                </span>
                {/* The label only when it says more than the id: a lane whose label is its id names itself once. */}
                {accountLabel(roster, wrapper) !== wrapper && (
                  <span className="account-gauge-label acct-card-label" title={accountLabel(roster, wrapper)}>
                    {accountLabel(roster, wrapper)}
                  </span>
                )}
                <StateLamp word={answer.word} />
              </div>
              {/* Line 2: the kind chip in words, the identity line (only what the lane state recorded), and the pool
                  chip, which stays through the redesign (D-7718). */}
              <div className="accounts-row-kind">
                {kindWords !== null && <span className="acct-kind-chip">{kindWords}</span>}
                {identity !== null && <span className="acct-identity" title={identity}>{identity}</span>}
                {inRoster && (
                  <button
                    type="button"
                    className="proj-card-pool acct-pool-chip"
                    data-testid={`acct-pool-chip-${wrapper}`}
                    data-pool={chip.dataPool}
                    data-origin={chip.origin}
                    data-dim={acctPoolDim || undefined}
                    aria-label={acctPoolDim ? `${chip.ariaLabel} — ${ACCOUNT_POOL_UNAVAILABLE_TEXT}` : chip.ariaLabel}
                    title={acctPoolDim ? ACCOUNT_POOL_UNAVAILABLE_TEXT : undefined}
                    onClick={() => { setPoolSheetAccount(wrapper); setPoolSheetOpen(true); }}
                  >
                    {chip.word}
                  </button>
                )}
              </div>
              {/* The state's source, with its own age: a different measurement from the usage reading's age below. */}
              <p className="accounts-state-source" title={lines.stateAt === null ? undefined : new Date(lines.stateAt).toISOString()}>
                {also === null ? lines.state : `${lines.state} · ${also}`}
              </p>

              {trouble !== null && (
                <TroubleCard
                  copy={trouble}
                  onCheck={canAct ? () => acts.check(wrapper) : undefined}
                  checking={acts.busy[wrapper] !== undefined}
                  acts={canAct && entry?.provider === 'anthropic'
                    ? troubleActs(answer.word, entry.kind, canSwitch).map((c) => ({
                      label: CREDENTIAL_ACT_LABEL[c.act], primary: c.primary, onOpen: () => openAct(wrapper, c.act),
                    }))
                    : undefined}
                />
              )}
              {waitingCode && held !== null && (
                <div className="acct-resume-line" data-resume={wrapper}>
                  <span>{RESUME_CARD_LINE}</span>
                  <Button variant="primary" size="fit" disabled={blocked !== null} onClick={() => openResume(wrapper)}>{CONTINUE}</Button>
                  <Button
                    variant="ghost" size="fit" disabled={blocked !== null || cancellingAuth !== null}
                    aria-busy={cancellingAuth === wrapper || undefined}
                    onClick={() => { void cancelAttempt(wrapper, held.attemptId); }}
                  >
                    {CANCEL_SIGN_IN}
                  </Button>
                </div>
              )}

              {/* `off` greys the meters' fills while each keeps its frozen
                  classification on `data-band`: the colour and the reading
                  stay separate facts (D-5098). It replaced a row-level
                  fleet.css override. */}
              <div className="acct-rows">
                {weeklyOnly ? (
                  <div className="acct-row">
                    <span className="acct-win">5h</span>
                    <span className="acct-weekly-only">{WEEKLY_ONLY}</span>
                  </div>
                ) : (
                  <AccountMeterRow label="5h" pct={a?.five ?? null} resetAt={a?.fiveResetAt ?? null} nowSec={nowSec} rolledOver={a?.fiveRolledOver ?? false} off={off} />
                )}
                <AccountMeterRow label="7d" pct={a?.seven ?? null} resetAt={a?.sevenResetAt ?? null} nowSec={nowSec} rolledOver={a?.sevenRolledOver ?? false} off={off} />
              </div>

              {/* Telemetry is a byproduct of a session rendering its
                  statusline — an idle account simply stops reporting. This
                  reads as "last known", never as live: no refresh button,
                  because there is nothing to refresh until a session runs. */}
              <p className="accounts-fresh">{lines.usage}</p>

              {connect !== null && inRoster && (
                <AccountKnob
                  id={wrapper}
                  on={switchOn}
                  notReady={notReady}
                  blocked={blocked}
                  running={onAccount.length}
                  busy={acts.busy[wrapper]}
                  onFlip={() => acts.flip(wrapper, !switchOn)}
                  onCheck={() => acts.check(wrapper)}
                />
              )}
              {/* The fold's credential act and Remove (spec §4.4; Task A19). Refused, they stay drawn and disabled, named by
                  the knob row's reason (offline, or the server's own). */}
              {connect !== null && inRoster && (
                <div className="acct-fold">
                  {switchTo === 'setup-token' && (
                    <Button
                      variant="ghost" size="fit" disabled={!canAct}
                      aria-describedby={blocked !== null ? `acct-knob-reason-${wrapper}` : undefined}
                      onClick={() => openSwitch(wrapper, 'setup-token')}
                    >
                      {SWITCH_TO_TOKEN}
                    </Button>
                  )}
                  {/* A sign-in lane's Sign in again (spec §4.4; Task A38): where the fleet can run a sign-in. */}
                  {switchTo === 'setup-token' && (
                    <Button
                      variant="ghost" size="fit" disabled={!canAct}
                      aria-describedby={blocked !== null ? `acct-knob-reason-${wrapper}` : undefined}
                      onClick={() => openReauth(wrapper, 'login')}
                    >
                      {SIGN_IN_AGAIN}
                    </Button>
                  )}
                  {tokenLane && (
                    <Button
                      variant="ghost" size="fit" disabled={!canAct}
                      aria-describedby={blocked !== null ? `acct-knob-reason-${wrapper}` : undefined}
                      onClick={() => openTokenReplace(wrapper)}
                    >
                      {REPLACE_TOKEN}
                    </Button>
                  )}
                  {switchTo === 'login' && (
                    <Button
                      variant="ghost" size="fit" disabled={!canAct}
                      aria-describedby={blocked !== null ? `acct-knob-reason-${wrapper}` : undefined}
                      onClick={() => openSwitch(wrapper, 'login')}
                    >
                      {SWITCH_TO_SIGN_IN}
                    </Button>
                  )}
                  <Button
                    variant="danger-ghost" size="fit" disabled={!canAct}
                    aria-describedby={blocked !== null ? `acct-knob-reason-${wrapper}` : undefined}
                    onClick={() => openRemove(wrapper)}
                  >
                    {REMOVE_ACT}
                  </Button>
                </div>
              )}

              {onAccount.length > 0 && (
                <ul className="accounts-sessions">
                  {onAccount.map((s) => (
                    <li key={s.id}>
                      <button type="button" className="accounts-session" onClick={() => navigate(sessionPath(s.id))}>
                        {sessionLabel(s)}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
        {/* On a phone the door is the list's last row, with its reason beneath it (D-5522). */}
        {!desk && door}
        {!desk && reason}
      </div>

      <ConnectSheet
        key={connectGen}
        open={connectOpen}
        // Closed mid-sign-in, the attempt keeps running on the box: a fresh read lets the resume banner say so now.
        onClose={() => { setConnectOpen(false); void refreshAccounts(); }}
        roster={roster}
        connect={connect}
        offline={offline}
        refresh={refreshAccounts}
        readRoster={readRoster}
      />

      {removing !== null && (
        <RemoveSheet
          key={`remove-${removing.gen}`}
          id={removing.id}
          open
          onClose={() => setRemoving(null)}
          lane={lanes?.[removing.id]}
          connect={connect}
          blocked={blocked}
          refresh={refreshAccounts}
          readRoster={readRoster}
        />
      )}
      {replacing !== null && (
        <ReplaceSheet
          key={`replace-${replacing.gen}`}
          id={replacing.id}
          open
          onClose={() => setReplacing(null)}
          connect={connect}
          blocked={blocked}
          roster={roster}
          lane={lanes?.[replacing.id]}
          usage={accounts?.find((x) => x.wrapper === replacing.id) ?? null}
          refresh={refreshAccounts}
          {...(canSwitch ? { onMint: () => openReauth(replacing.id, 'setup-token') } : {})}
        />
      )}
      {reauthing !== null && (
        <ReauthSheet
          key={`reauth-${reauthing.gen}`}
          id={reauthing.id}
          method={reauthing.method}
          open
          // Closed mid-attempt, the attempt keeps running on the box: a fresh read lets the resume banner say so now.
          onClose={() => { setReauthing(null); dropResume(); void refreshAccounts(); }}
          connect={connect}
          blocked={blocked}
          lane={lanes?.[reauthing.id]}
          usage={accounts?.find((x) => x.wrapper === reauthing.id) ?? null}
          roster={roster}
          refresh={refreshAccounts}
          {...(reauthing.resume !== undefined ? { resume: reauthing.resume } : {})}
          {...(reauthing.method === 'setup-token'
            ? { onPaste: () => { const id = reauthing.id; setReauthing(null); openReplace(id); } } : {})}
        />
      )}

      {switching !== null && (
        <MethodSwitchSheet
          key={`switch-${switching.gen}`}
          id={switching.id}
          to={switching.to}
          open
          onClose={() => { setSwitching(null); dropResume(); void refreshAccounts(); }}
          connect={connect}
          blocked={blocked}
          roster={roster}
          lane={lanes?.[switching.id]}
          usage={accounts?.find((x) => x.wrapper === switching.id) ?? null}
          refresh={refreshAccounts}
          {...(switching.resume !== undefined ? { resume: switching.resume } : {})}
        />
      )}
      {resumingConnect !== null && (
        <ConnectSheet
          key={`resume-${resumingConnect.gen}`}
          open
          onClose={() => { setResumingConnect(null); dropResume(); void refreshAccounts(); }}
          roster={roster}
          connect={connect}
          offline={offline}
          refresh={refreshAccounts}
          readRoster={readRoster}
          resume={{ id: resumingConnect.id, held: resumingConnect.held }}
        />
      )}

      <AccountPoolSheet
        account={poolSheetAccount}
        roster={roster}
        current={poolSheetAccount === null ? undefined : accountPoolState(roster, poolSheetAccount)}
        unenforced={accountPools === 'unavailable'}
        open={poolSheetOpen}
        onClose={() => setPoolSheetOpen(false)}
        onSet={setAccountPool}
      />
    </PageScaffold>
  );
}
