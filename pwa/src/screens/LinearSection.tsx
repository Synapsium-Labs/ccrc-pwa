// The Settings screen's Linear card (#1444, spec §10.2, §10.3; it began as named workspaces S4b's one-key section):
// every Linear workspace key the box holds, one row each, with its state, its teams and its controls, and the key saved
// before workspaces as the legacy row. Mounted on the Security page after the Box token card, as a `Section` card like
// the others (its scope, title and purpose line are `SETTINGS_CARDS.security.linear`); its read of GET
// /api/linear/workspaces is the Settings frame's (`useLinearWorkspaces`, handed down as `poll`), like Stall watch's,
// so this file reads nothing itself.
//
// Rules this file keeps, each pinned in linear-section.test.tsx:
//   * THE BOX'S ANSWER IS WHAT IS SHOWN. Every key act answers the list and the card renders that, not what the tap
//     expected. A list this build cannot read says so; a row never borrows another state's sentence.
//   * THE LEGACY ROW KEEPS `main`'S CONTROLS (spec §3.4). Its Check again is `POST /api/linear/connection/check` and its
//     Disconnect `DELETE /api/linear/connection`, the routes a cached older card still calls. It offers no Replace: a
//     new key is added as a workspace of its own.
//   * WRITES ARE CREDENTIAL ACTS. Remove and Disconnect need a recent step-up (D-5512), so they go through
//     `useStepUp`'s `runAct` exactly as an account sheet's acts do: run once, and when the box answers
//     `step-up-required` the "Confirm it's you" step shows and the operator presses the act again. The step is NOT
//     shown ahead of time (the hook is told the stamp is fresh, `Infinity`, so it fetches no challenge until an act is
//     refused): a card that opened a passkey challenge on every visit to Settings would also take it from a tab that
//     was using it. A check asks for none.
//   * EVERY REFUSAL IS A FIXED SENTENCE chosen by its word; the box's own text is never shown.
//   * EVERY WIDTH (spec §10.3). The band is read once, from the desk query and the wide query, and set on the card as
//     `data-band`; the stylesheet lays each band out (`settings.css`), and the band says how many team chips show
//     before *+N more*. No text is cut short: a long name wraps.
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Button, Chip, Section, Skeleton, elapsedWords, useDesk, useMediaQuery } from '@ccrc/ui';
import type { LinearConnectionView, LinearLegacyRow, LinearTeamShown, LinearWorkspaceView } from '../../../shared/linear';
import { ConfirmItsYou } from '../accounts/ConfirmItsYou';
import { useStepUp, type StepUpDeps } from '../accounts/useStepUp';
import type { LinearWorkspacesPoll } from '../fleet/useLinearWorkspaces';
import { ResultLine, SETTINGS_CARDS, useResultLine } from '../fleet/settingsText';
import { ApiError, api, apiErrorText, type LinearWorkspacesRead } from '../lib/api';

/** The hook is told the session's step-up is fresh until an act proves otherwise: see the file's third rule. */
const ASSUME_FRESH = Infinity;

/** The wide band's query: the width at which the shell's other wide layouts start (`tokens.css`'s 1600), as the test
 *  box card's. */
export const LINEAR_WIDE_QUERY = '(min-width: 1600px)';

export type LinearBand = 'phone' | 'laptop' | 'wide';

/** How many team chips a row shows before *+N more*, by band (spec §10.3). */
export const LINEAR_TEAMS_SHOWN: Readonly<Record<LinearBand, number>> = { phone: 8, laptop: 16, wide: 24 };

/** The card's words. The state sentences are the spec's table (§10.2) where it gives one, and today's otherwise. */
export const LINEAR_TEXT = {
  loading: 'Reading the Linear keys…',
  unread: "Couldn't read the Linear keys. Reload to try again.",
  storeUnreadable: "Can't read the box's folder of Linear keys. Fix its permissions on the box; the keys in it are not shown until then.",
  empty: 'No Linear workspace has a key yet.',
  notConnected: "Not connected. Paste a personal API key from Linear's settings (read access is enough).",
  rejected: 'Linear rejected this key (it was revoked or expired). Ticket titles fall back to what you paste.',
  forbidden: 'Linear refused this key access at the last check (it may be missing a permission). The key was not called bad. Ticket titles fall back to what you paste.',
  unreachable: "Couldn't reach Linear at the last check. Ticket titles fall back to what you paste.",
  detailsUnknown: "A key is stored, but the box has no record of what it last found out about it. Check again to confirm it still works.",
  unreadableKey: "Can't read the stored key. Fix the file's permissions on the box, or replace the key here.",
  unusableKey: 'The stored key file has no key in it. Paste a key to replace it.',
  placeholderKey: 'The stored key is still the example value. Paste a key to replace it.',
  /** A slot whose record has not named its workspace (its key was never checked well). */
  unnamed: 'A workspace not yet named',
  slotForbidden: 'Linear refused the last check; the key may lack access.',
  slotUnreachable: "Couldn't reach Linear at the last check.",
  legacyName: 'A key saved before workspaces',
  legacyLearned: 'a key saved before workspaces',
  legacyUnlearned: 'A key saved before workspaces. Check again so sessions can use it.',
  more: (n: number) => `+${n} more`,
  fewer: 'Show fewer',
  teamsLabel: 'Teams',
  check: 'Check again',
  remove: 'Remove',
  disconnect: 'Disconnect',
  removed: 'Removed.',
  disconnected: 'Disconnected.',
  stepUpSubject: 'the Linear key',
} as const;

/** What a refusal word says. Chosen by the word alone: the box's own text never reaches the screen. */
const REFUSAL_TEXT: Readonly<Record<string, string>> = {
  'bad-key': "That doesn't look like a Linear API key. Paste it again, with nothing before or after it.",
  'key-rejected': 'Linear rejected that key, so nothing was saved. Check it and try again.',
  'key-forbidden': 'Linear refused that key access, so nothing was saved. Check its permissions, or try another key.',
  'unreachable': "Couldn't reach Linear, so nothing was saved. Try again.",
  'timeout': 'Linear took too long to answer, so nothing was saved. Try again.',
  'malformed': "Linear's answer was not what was expected, so nothing was saved. Try again.",
  'write-failed': "The box couldn't save that. Try again.",
  'auth-off': 'Sign-in is off on this box, so the Linear key cannot be changed from here.',
  'insecure-origin': 'This box is not served over HTTPS, so the Linear key cannot be changed from here.',
  'oversize': "That's too long to be a Linear API key.",
  'rate-limited': 'Linear is busy for this box right now, so nothing was changed. Try again in a minute.',
  'journal-unavailable': "The box couldn't record this change, so nothing was changed. Try again.",
  'linear-unavailable': "This box can't change Linear keys right now, so nothing was changed. Try again after it restarts.",
};

const wordOf = (err: unknown): string | null => {
  if (!(err instanceof ApiError) || typeof err.body !== 'object' || err.body === null) return null;
  const w = (err.body as { error?: unknown }).error;
  return typeof w === 'string' ? w : null;
};

export const refusalText = (err: unknown): string => {
  const w = wordOf(err);
  return (w === null ? undefined : REFUSAL_TEXT[w]) ?? apiErrorText(err);
};

/** Today's one sentence for a key's state, as a node (the organisation and user in strong): the legacy row's note. */
export function linearStateText(v: LinearConnectionView, now: number): ReactNode {
  switch (v.state) {
    case 'not-connected': return LINEAR_TEXT.notConnected;
    case 'key-rejected': return LINEAR_TEXT.rejected;
    case 'key-forbidden': return LINEAR_TEXT.forbidden;
    case 'unreachable': return LINEAR_TEXT.unreachable;
    case 'details-unknown': return LINEAR_TEXT.detailsUnknown;
    case 'unreadable': return LINEAR_TEXT.unreadableKey;
    case 'unusable': return LINEAR_TEXT.unusableKey;
    case 'placeholder': return LINEAR_TEXT.placeholderKey;
    case 'connected': return (
      <>
        Connected to <strong>{v.org ?? 'Linear'}</strong> as <strong>{v.user ?? 'this key'}</strong>
        {' · '}key ending …{v.keyTail}{' · '}checked {elapsedWords(Math.max(0, now - v.checkedAt))} ago
      </>
    );
  }
}

/** A slot row's state sentence (spec §10.2's table), beside its name. */
export function workspaceStateText(w: LinearWorkspaceView): ReactNode {
  switch (w.state) {
    case 'connected': return <>Connected as <strong>{w.user ?? 'this key'}</strong></>;
    case 'key-rejected': return <>Linear rejected this key; sessions can't use <strong>{w.name ?? 'this workspace'}</strong> until it is replaced.</>;
    case 'key-forbidden': return LINEAR_TEXT.slotForbidden;
    case 'unreachable': return LINEAR_TEXT.slotUnreachable;
    default: return linearStateText(w, 0);
  }
}

/** Which controls a slot row offers (spec §10.2): Check again where a second look can say something, Replace key where
 *  the stored key is not working, Remove always (a slot always has a key file). */
export function workspaceControls(w: LinearWorkspaceView): { check: boolean; replace: boolean; remove: true } {
  switch (w.state) {
    case 'connected': case 'unreachable': case 'details-unknown': return { check: true, replace: false, remove: true };
    case 'key-rejected': return { check: false, replace: true, remove: true };
    // A 403 is not a verdict on the key: it may be the scope that changed, so a second look is worth offering too.
    case 'key-forbidden': return { check: true, replace: true, remove: true };
    // `not-connected` is never a slot's (a slot always has a key file); read as a key that is not working.
    case 'unreadable': case 'unusable': case 'placeholder': case 'not-connected': return { check: false, replace: true, remove: true };
  }
}

/** The legacy row's sentence (spec §3.4, §10.2): superseded, not yet learned, or learned. */
export function legacyStateText(l: LinearLegacyRow): ReactNode {
  const w = l.workspace;
  if (w !== null && l.superseded) {
    return <>A key saved before workspaces. <strong>{w.name}</strong> now uses the newer key; Disconnect this one when you are ready.</>;
  }
  if (w === null) return LINEAR_TEXT.legacyUnlearned;
  return l.view.state === 'connected'
    ? <>Connected as <strong>{l.view.user ?? 'this key'}</strong> · {LINEAR_TEXT.legacyLearned}</>
    : LINEAR_TEXT.legacyLearned;
}

function useBand(): LinearBand {
  const desk = useDesk();
  const wide = useMediaQuery(LINEAR_WIDE_QUERY);
  return !desk ? 'phone' : wide ? 'wide' : 'laptop';
}

/** The key's tail and its last check, on one line that wraps at a word. */
function KeyLine({ keyTail, checkedAt, now }: { keyTail: string | null; checkedAt: number | null; now: number }): ReactNode {
  if (keyTail === null) return null;
  return (
    <p className="settings-note linear-meta" data-linear="meta">
      key ending …{keyTail}{checkedAt === null ? null : <>{' · '}checked {elapsedWords(Math.max(0, now - checkedAt))} ago</>}
    </p>
  );
}

/** The teams, as chips that wrap: the band's first few, then *+N more*, which shows the rest. */
function Teams({ teams, band }: { teams: readonly LinearTeamShown[]; band: LinearBand }): ReactNode {
  const [all, setAll] = useState(false);
  if (teams.length === 0) return null;
  const cap = LINEAR_TEAMS_SHOWN[band];
  const shown = all ? teams : teams.slice(0, cap);
  const hidden = teams.length - shown.length;
  return (
    <ul className="linear-teams" data-linear="teams" aria-label={LINEAR_TEXT.teamsLabel}>
      {shown.map((t) => <li key={t.key}><Chip className="linear-team">{t.key}</Chip></li>)}
      {(hidden > 0 || (all && teams.length > cap)) && (
        <li>
          <Button variant="ghost" size="fit" className="linear-more" data-linear="more" aria-expanded={all} onClick={() => setAll(!all)}>
            {hidden > 0 ? LINEAR_TEXT.more(hidden) : LINEAR_TEXT.fewer}
          </Button>
        </li>
      )}
    </ul>
  );
}

/** One row: its name and state on the head, its controls, then its key line and its teams. */
function Row({ kind, state, name, sentence, note, keyTail, checkedAt, teams, controls, band, now }: {
  kind: 'slot' | 'legacy'; state: LinearConnectionView['state']; name: string; sentence: ReactNode; note: ReactNode;
  keyTail: string | null; checkedAt: number | null; teams: readonly LinearTeamShown[]; controls: ReactNode;
  band: LinearBand; now: number;
}): ReactNode {
  return (
    <li className="linear-row" data-linear="row" data-row={kind} data-linear-state={state}>
      <div className="linear-row-head">
        <p className="linear-row-title">
          <strong className="linear-name" data-linear="name">{name}</strong>{' '}
          <span className="settings-note linear-state" data-linear="state">{sentence}</span>
        </p>
        <div className="linear-controls" data-linear="controls">{controls}</div>
      </div>
      {note !== null && <p className="settings-note linear-note" data-linear="note">{note}</p>}
      <KeyLine keyTail={keyTail} checkedAt={checkedAt} now={now} />
      <Teams teams={teams} band={band} />
    </li>
  );
}

export function LinearSection({ poll, stepUpDeps }: { poll: LinearWorkspacesPoll; stepUpDeps?: StepUpDeps }): ReactNode {
  const card = SETTINGS_CARDS.security.linear;
  const band = useBand();
  // The last GOOD list; a failed read with none to show is the `unread` sentence.
  const view = poll.view;
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const result = useResultLine();
  const stepUp = useStepUp(ASSUME_FRESH, stepUpDeps);

  // "checked 3m ago" ages on screen.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  /** One act: its answer becomes what is shown; a refusal becomes its sentence; a stale step-up shows the step.
   *  `install` turns the act's answer into the list (a legacy act answers the pair's view, which then re-reads). */
  const perform = async <A,>(act: () => Promise<A | 'unreadable'>, install: (answer: A) => void, done: string | null): Promise<void> => {
    setBusy(true);
    result.clear();
    let answer: A | 'unreadable' | undefined;
    try {
      const outcome = await stepUp.runAct(async () => { answer = await act(); });
      if (outcome === 'step-up') return;
      if (answer === undefined || answer === 'unreadable') {
        // The call completed and its body could not be read: it may have landed, so re-read the truth.
        poll.reload();
      } else {
        install(answer);
        if (done !== null) result.say(done);
      }
    } catch (err) {
      // A 401 raises the login screen, which is the answer: no stale line waits behind it.
      if (!(err instanceof ApiError && err.status === 401)) result.say(refusalText(err), 'refusal');
    } finally {
      setBusy(false);
    }
  };
  const slotAct = (act: () => Promise<LinearWorkspacesRead | 'unreadable'>, done: string | null): void =>
    void perform(act, (list) => poll.settle(list), done);
  /** The legacy row's acts answer the pair's view: shown at once in the row, then the list is read again for what
   *  the check learned (its workspace, its teams, whether a slot supersedes it). */
  const legacyAct = (list: LinearWorkspacesRead, act: () => Promise<LinearConnectionView | 'unreadable'>, done: string | null): void =>
    void perform(act, (v) => {
      const legacy = list.legacy;
      poll.settle({ ...list, legacy: v.state === 'not-connected' || legacy === null ? null : { ...legacy, view: v } });
      poll.reload();
    }, done);

  let body: ReactNode;
  if (view === null && poll.failure === null) {
    body = <Skeleton lines={2} />;
  } else if (view === null) {
    body = <p className="settings-note" data-linear="unread">{LINEAR_TEXT.unread}</p>;
  } else {
    const rows: ReactNode[] = view.workspaces.map((w) => {
      const c = workspaceControls(w);
      return (
        <Row key={w.id} kind="slot" state={w.state} name={w.name ?? LINEAR_TEXT.unnamed} sentence={workspaceStateText(w)} note={null}
          keyTail={w.keyTail} checkedAt={w.checkedAt} teams={w.teams} band={band} now={now}
          controls={<>
            {c.check && (
              <Button variant="ghost" size={band === 'phone' ? 'full' : 'fit'} disabled={busy}
                onClick={() => slotAct(() => api.checkLinearWorkspace(w.id), null)}>
                {LINEAR_TEXT.check}
              </Button>
            )}
            <Button variant="ghost" size={band === 'phone' ? 'full' : 'fit'} disabled={busy}
              onClick={() => slotAct(() => api.removeLinearWorkspace(w.id), LINEAR_TEXT.removed)}>
              {LINEAR_TEXT.remove}
            </Button>
          </>} />
      );
    });
    const l = view.legacy;
    if (l !== null) {
      const shown = 'keyTail' in l.view ? l.view : null;
      rows.push(
        <Row key="legacy" kind="legacy" state={l.view.state} name={l.workspace?.name ?? LINEAR_TEXT.legacyName} sentence={legacyStateText(l)}
          note={l.view.state === 'connected' ? null : linearStateText(l.view, now)}
          keyTail={shown?.keyTail ?? null} checkedAt={shown?.checkedAt ?? null} teams={l.workspace?.teams ?? []} band={band} now={now}
          controls={<>
            <Button variant="ghost" size={band === 'phone' ? 'full' : 'fit'} disabled={busy}
              onClick={() => legacyAct(view, () => api.checkLinear(), null)}>
              {LINEAR_TEXT.check}
            </Button>
            <Button variant="ghost" size={band === 'phone' ? 'full' : 'fit'} disabled={busy}
              onClick={() => legacyAct(view, () => api.disconnectLinear(), LINEAR_TEXT.disconnected)}>
              {LINEAR_TEXT.disconnect}
            </Button>
          </>} />,
      );
    }
    body = (
      <>
        {view.store === 'unreadable' && <p className="settings-note" data-linear="store">{LINEAR_TEXT.storeUnreadable}</p>}
        {rows.length === 0
          ? <p className="settings-note" data-linear="empty">{LINEAR_TEXT.empty}</p>
          : <ul className="linear-list" data-linear="list">{rows}</ul>}
      </>
    );
  }

  return (
    <Section level={3} scope={card.scope} title={card.title} purpose={card.purpose} data-linear="section" data-band={band} className="linear-card">
      {body}
      <ConfirmItsYou stepUp={stepUp} subject={LINEAR_TEXT.stepUpSubject} />
      <ResultLine line={result.line} />
    </Section>
  );
}
