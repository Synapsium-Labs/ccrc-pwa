// The Settings screen's Linear section (named workspaces S4b, design 2026-10-20 §5.1): connect a personal API key
// so a pasted ticket shows its real title, see what the box last found out about it, check it again, disconnect.
// Mounted on the Security page beside the Box token card; its read of GET /api/linear/connection is the Settings
// frame's (`useLinearConnection`, handed down as `poll`), like Stall watch's, so this file reads nothing itself.
//
// Rules this file keeps, each pinned in linear-section.test.tsx:
//   * THE KEY NEVER LIVES HERE LONGER THAN A TAP. The field is `type=password`, its value is held in this one
//     component's state only (never a store, never browser storage), is cleared the moment a Connect lands, and is
//     cleared when the page goes to the background (the passphrase step's own rule, spec §3.3).
//   * THE BOX'S ANSWER IS WHAT IS SHOWN. Every call answers the connection's state and the section renders that, not
//     what the tap expected. A state this build cannot read says so; it never borrows another state's sentence.
//   * PUT AND DELETE ARE CREDENTIAL ACTS. They need a recent step-up (D-5512), so they go through `useStepUp`'s
//     `runAct` exactly as an account sheet's acts do: run once, and when the box answers `step-up-required` the
//     "Confirm it's you" step shows and the operator presses the act again. The step is NOT shown ahead of time (the
//     hook is told the stamp is fresh, `Infinity`, so it fetches no challenge until an act is refused): a section
//     that opened a passkey challenge on every visit to Settings would also take it from a tab that was using it.
//   * EVERY REFUSAL IS A FIXED SENTENCE chosen by its word; the box's own text is never shown.
import { useEffect, useId, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { Button, Skeleton, TextInput, elapsedWords } from '@ccrc/ui';
import { isLinearKeyShape, type LinearConnectionView } from '../../../shared/linear';
import { ConfirmItsYou } from '../accounts/ConfirmItsYou';
import { useStepUp, type StepUpDeps } from '../accounts/useStepUp';
import type { LinearPoll } from '../fleet/useLinearConnection';
import { ResultLine, useResultLine } from '../fleet/settingsText';
import { ApiError, api, apiErrorText } from '../lib/api';

/** The key field's stack and the action row: named here, not copied from the passphrase step's literals. */
const FIELD_STACK = 'flex flex-col gap-2';
const ACTION_ROW = 'flex flex-wrap gap-2';

/** The hook is told the session's step-up is fresh until an act proves otherwise: see the file's third rule. */
const ASSUME_FRESH = Infinity;

/** The section's words. The state sentences are the design's table (§5.1) verbatim where it gives one. */
export const LINEAR_TEXT = {
  title: 'Linear',
  purpose: 'Connect Linear so a ticket you paste into a new session shows its real title. Without it the title is read from what you paste.',
  loading: 'Reading the Linear connection…',
  unread: "Couldn't read the Linear connection. Reload to try again.",
  notConnected: "Not connected. Paste a personal API key from Linear's settings (read access is enough).",
  rejected: 'Linear rejected this key (it was revoked or expired). Ticket titles fall back to what you paste.',
  forbidden: 'Linear refused this key access at the last check (it may be missing a permission). The key was not called bad. Ticket titles fall back to what you paste.',
  unreachable: "Couldn't reach Linear at the last check. Ticket titles fall back to what you paste.",
  detailsUnknown: "A key is stored, but the box has no record of what it last found out about it. Check again to confirm it still works.",
  unreadableKey: "Can't read the stored key. Fix the file's permissions on the box, or replace the key here.",
  unusableKey: 'The stored key file has no key in it. Paste a key to replace it.',
  placeholderKey: 'The stored key is still the example value. Paste a key to replace it.',
  keyLabel: 'Linear API key',
  connect: 'Connect',
  replace: 'Replace key',
  check: 'Check again',
  disconnect: 'Disconnect',
  working: 'Working…',
  connected: 'Connected.',
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
};

const wordOf = (err: unknown): string | null => {
  if (!(err instanceof ApiError) || typeof err.body !== 'object' || err.body === null) return null;
  const w = (err.body as { error?: unknown }).error;
  return typeof w === 'string' ? w : null;
};

const refusalText = (err: unknown): string => {
  const w = wordOf(err);
  return (w === null ? undefined : REFUSAL_TEXT[w]) ?? apiErrorText(err);
};

/** The one sentence a state is, as a node (the organisation and user in strong). */
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

/** Which controls a state offers, from the design's table: a field (Connect for a box with no key, Replace key for
 *  any state whose stored key is not working), Check again (a stored key whose state is unsure or good), Disconnect
 *  (anything stored). `unusable` and `placeholder` are stored files, so they offer Disconnect too. */
export function linearControls(v: LinearConnectionView): { field: 'connect' | 'replace' | null; check: boolean; disconnect: boolean } {
  switch (v.state) {
    case 'not-connected': return { field: 'connect', check: false, disconnect: false };
    case 'connected': return { field: null, check: true, disconnect: true };
    case 'key-rejected': return { field: 'replace', check: false, disconnect: true };
    // A 403 is not a verdict on the key: it may be the scope that changed, so a second look is worth offering too.
    case 'key-forbidden': return { field: 'replace', check: true, disconnect: true };
    case 'unreachable': return { field: null, check: true, disconnect: true };
    case 'details-unknown': return { field: null, check: true, disconnect: true };
    case 'unreadable': case 'unusable': case 'placeholder': return { field: 'replace', check: false, disconnect: true };
  }
}

export function LinearSection({ poll, stepUpDeps }: { poll: LinearPoll; stepUpDeps?: StepUpDeps }): ReactNode {
  const titleId = useId();
  const fieldId = useId();
  // The last GOOD view; a failed read with none to show is the `unread` sentence.
  const view = poll.view;
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const result = useResultLine();
  const stepUp = useStepUp(ASSUME_FRESH, stepUpDeps);

  // "checked 3m ago" ages on screen.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  // A key typed into the field does not wait there in a backgrounded page.
  useEffect(() => {
    const onVisibility = (): void => { if (document.visibilityState === 'hidden') setKey(''); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  /** One act: its answer becomes the state; a refusal becomes its sentence; a stale step-up shows the step. */
  const perform = async (act: () => Promise<LinearConnectionView | 'unreadable'>, done: string | null, clearKey: boolean): Promise<void> => {
    setBusy(true);
    result.clear();
    let answer: LinearConnectionView | 'unreadable' | undefined;
    try {
      const outcome = await stepUp.runAct(async () => { answer = await act(); });
      if (outcome === 'step-up') return;
      if (answer === undefined || answer === 'unreadable') {
        // The call completed and its body could not be read: it may have landed, so re-read the truth.
        poll.reload();
      } else {
        poll.settle(answer);
        if (done !== null) result.say(done);
      }
      if (clearKey) setKey('');
    } catch (err) {
      // A 401 raises the login screen, which is the answer: no stale line waits behind it.
      if (!(err instanceof ApiError && err.status === 401)) result.say(refusalText(err), 'refusal');
    } finally {
      setBusy(false);
    }
  };

  const submitKey = (e: FormEvent): void => {
    e.preventDefault();
    const trimmed = key.trim();
    if (trimmed === '' || busy) return;
    // The pasted key is trimmed at both ends only (a copied key often carries a newline); the shape rule is the
    // server's too, and is said here first so a mistyped paste costs no round trip.
    if (!isLinearKeyShape(trimmed)) { result.say(REFUSAL_TEXT['bad-key'] ?? '', 'refusal'); return; }
    void perform(() => api.connectLinear(trimmed), LINEAR_TEXT.connected, true);
  };

  let body: ReactNode;
  if (view === null && poll.failure === null) {
    body = <Skeleton lines={2} />;
  } else if (view === null) {
    body = <p className="settings-note" data-linear="unread">{LINEAR_TEXT.unread}</p>;
  } else {
    const controls = linearControls(view);
    body = (
      <>
        <p className="settings-note" data-linear="state" data-linear-state={view.state}>{linearStateText(view, now)}</p>
        {controls.field !== null && (
          <form className={FIELD_STACK} onSubmit={submitKey}>
            <label htmlFor={fieldId} className="settings-note">{LINEAR_TEXT.keyLabel}</label>
            <TextInput
              id={fieldId}
              type="password"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              value={key}
              onChange={(e) => setKey(e.target.value)}
            />
            <Button type="submit" variant="primary" disabled={busy || key.trim() === ''}>
              {controls.field === 'connect' ? LINEAR_TEXT.connect : LINEAR_TEXT.replace}
            </Button>
          </form>
        )}
        {(controls.check || controls.disconnect) && (
          <div className={ACTION_ROW}>
            {controls.check && (
              <Button variant="ghost" className="settings-check" disabled={busy}
                onClick={() => void perform(() => api.checkLinear(), null, false)}>
                {LINEAR_TEXT.check}
              </Button>
            )}
            {controls.disconnect && (
              <Button variant="ghost" className="settings-check" disabled={busy}
                onClick={() => void perform(() => api.disconnectLinear(), LINEAR_TEXT.disconnected, false)}>
                {LINEAR_TEXT.disconnect}
              </Button>
            )}
          </div>
        )}
      </>
    );
  }

  return (
    <section className="settings-section" aria-labelledby={titleId} data-linear="section">
      <h3 id={titleId} className="settings-section-title">{LINEAR_TEXT.title}</h3>
      <p className="settings-note">{LINEAR_TEXT.purpose}</p>
      {body}
      <ConfirmItsYou stepUp={stepUp} subject={LINEAR_TEXT.stepUpSubject} />
      <ResultLine line={result.line} />
    </section>
  );
}
