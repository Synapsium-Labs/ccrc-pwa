// Settings › Notifications (settings spec §3.1; D-5503): the Bell and Announce new releases. Settings Task R2b1 moved
// it here from `SettingsScreen.tsx` unchanged; the page's `<h2>` is the frame's, and whether this browser can take a
// push is the frame's read (`SettingsDataProvider`'s `push`), not this file's.
import { useState } from 'react';
import type { ReactNode } from 'react';
import type { NotifyMode, UpdatesView } from '../../../../shared/api';
import { FLEET_SCOPE, NOTIFY_MODES, isNotifyMode } from '../../../../shared/api';
import { RadioFieldset } from '@ccrc/ui';
import { NotificationBell } from '../../fleet/NotificationBell';
import { NOTIFICATIONS_TEXT, ResultLine, UNCONFIRMED_TEXT, useResultLine } from '../../fleet/settingsText';
import { api, updateErrorText } from '../../lib/api';
// `dayClock` and `elapsedWords` come THROUGH the update plane's reading
// surface, which is where the twenty wire-row-to-sentence helpers moved: the
// box-token card landed on main while that move was happening on this branch,
// and it reads two of the same clocks.
// The update plane's reading surface moved to a file of its own; this screen
// composes it. `ACK_UNREADABLE_TEXT`/`canAck` come THROUGH it because
// `NodeItem` is their consumer — see that file's header.
import '../../fleet/fleet.css';

// ── Notifications (spec §13 item 2; programme wave 3 Task 10) ──
// Two things live here, and one thing deliberately does not:
//   * The PUSH toggle is the literal <NotificationBell/> — the same
//     component the fleet header mounts, with its four subscribe outcomes
//     (NotificationBell.tsx:29-47). This file imports none of lib/push's
//     lifecycle calls and spells none of those outcomes; a second copy of the
//     toggle is how two surfaces would come to disagree about whether this
//     browser is subscribed. The frame's push read (`supported`) says only why
//     the bell is absent (it renders nothing where Web Push cannot work).
//   * RELEASE NOTIFICATIONS are `update_intent['*'].notify` (W2's NotifyMode
//     column): one native radio per NOTIFY_MODES member
//     (D-3299), written through the one intent route.
//     The server's notifier (Task 3) reads the '*' row alone, so a per-node
//     scope is never offered here.
//   * NOT HERE: the release push itself. A tap on one of these radios changes
//     which tags the server will announce from the next sweep on; it sends
//     nothing and marks nothing.


/** Announce new releases' choices in spec §11.2's words; the wire's `NotifyMode` values do not change. */
export const NOTIFY_LABELS: Record<NotifyMode, string> = {
  channel: "Every release on the fleet's channel",
  stable: 'Stable releases only',
  off: 'None',
};

/** What the release-notifications radios show. `setAt: null` = a write in
 *  flight; a number = the route's own answer, shown until the poll's '*' row is
 *  at least that new — a controlled radio would otherwise snap back to the old
 *  choice for the length of one poll. */
interface ShownNotify { notify: NotifyMode; setAt: number | null }

/** The Notifications page's body (the heading is the frame's `<h2>`). `supported` is the frame's push read: the Bell
 *  renders nothing where Web Push cannot work, so this says why it is absent. */
export function NotificationsSection({ view, reload, supported }: {
  view: UpdatesView | null; reload: () => void; supported: boolean;
}): ReactNode {
  const [shown, setShown] = useState<ShownNotify | null>(null);
  const row = view === null ? null : (view.intent.find((i) => i.scope === FLEET_SCOPE) ?? null);
  const caughtUp = shown !== null && shown.setAt !== null && row !== null && row.setAt >= shown.setAt;
  const checked = shown !== null && !caughtUp ? shown.notify : (row?.notify ?? null);
  const saving = shown !== null && shown.setAt === null;
  // D-5507: the write's answer is a line under the group, a toast only once the section has gone (spec §6.4).
  const result = useResultLine();

  const choose = async (notify: NotifyMode): Promise<void> => {
    if (saving) return;   // the disabled fieldset stops a finger; this stops a second call
    result.clear();
    setShown({ notify, setAt: null });
    try {
      const answer = await api.setUpdateIntent({ scope: FLEET_SCOPE, notify });
      const stored = answer === 'unreadable' ? null : (answer?.intent ?? null);
      if (stored === null || !isNotifyMode(stored.notify) || typeof stored.setAt !== 'number') {
        // The write may have landed: say so, and let the poll decide what is checked.
        setShown(null);
        result.say(UNCONFIRMED_TEXT);
      } else {
        setShown({ notify: stored.notify, setAt: stored.setAt });
      }
    } catch (err) {
      setShown(null);
      result.say(updateErrorText(err), 'refusal');
    }
    reload();
  };

  return (
    <>
      {supported ? (
        <div className="settings-bell-row">
          <NotificationBell />
          {/* the label says push, never a device: notifications-label-says-push (D-4036) */}
          <span>Push notifications for this browser</span>
        </div>
      ) : (
        <p className="settings-note">This browser cannot receive Web Push.</p>
      )}
      <p className="settings-note">{NOTIFICATIONS_TEXT.browserPurpose}</p>
      <p className="settings-note">{NOTIFICATIONS_TEXT.browserWhen}</p>
      {view !== null && (
        <>
          <RadioFieldset
            legend={NOTIFICATIONS_TEXT.announceLegend}
            name="settings-notify"
            options={NOTIFY_MODES.map((m) => ({ value: m, label: NOTIFY_LABELS[m] }))}
            value={checked}
            onPick={(m) => void choose(m)}
            disabled={saving}
          />
          <ResultLine line={result.line} />
          <p className="settings-note">{NOTIFICATIONS_TEXT.announcePurpose}</p>
          <p className="settings-note">{NOTIFICATIONS_TEXT.announceWhen}</p>
        </>
      )}
    </>
  );
}
