// A one-tap toggle in the fleet header to enable/disable phone push
// notifications (a session raising a question, or finishing a turn). Hidden
// where the browser can't do Web Push.
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { toast } from '../components/Toast';
import { pushSupported, pushEnabled, enablePush, disablePush } from '../lib/push';

export function NotificationBell(): ReactNode {
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [supported] = useState(() => pushSupported());

  useEffect(() => {
    if (supported) void pushEnabled().then(setOn);
  }, [supported]);

  if (!supported) return null;

  const toggle = async (): Promise<void> => {
    setBusy(true);
    try {
      if (on) {
        await disablePush();
        setOn(false);
        toast('Notifications off');
        return;
      }
      const r = await enablePush();
      if (r === 'enabled') {
        setOn(true);
        toast("Notifications on — you'll get a ping when a session needs you");
      } else if (r === 'denied') {
        toast('Allow notifications in your browser settings first', 'error');
      } else if (r === 'unconfigured') {
        toast("Push isn't set up on the server", 'error');
      } else {
        toast("Couldn't enable notifications", 'error');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      className={on ? 'bell bell--on' : 'bell'}
      aria-label={on ? 'Notifications on' : 'Notifications off'}
      aria-pressed={on}
      disabled={busy}
      onClick={() => void toggle()}
    >
      <span aria-hidden="true">{on ? '🔔' : '🔕'}</span>
    </button>
  );
}
