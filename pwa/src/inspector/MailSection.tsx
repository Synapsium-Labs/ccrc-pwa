// The inspector's Mail (W2 Task S8, D-5474): the session's outstanding mail. Rendered by `MailStrip`, the one owner of
// a delivery's status line (abandoned, parked, held, blocked: its precedence is the design system's, and a second
// renderer here would be a second answer). The wire carries `MailSummary` only, no body, so a `MailCard` (which renders
// an envelope's body) has nothing to show here (departure `mail-section-strip`).
// No mail renders nothing (desktop polish T3d, D-6334).
import { useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { MailStrip } from '@ccrc/ui';
import type { SessionStore } from '../stores/session';
import { InspectorSection } from './InspectorSection';
import { useInspectorSession } from './useInspectorSession';

function MailBody({ store }: { store: SessionStore }): ReactNode {
  const mail = useSyncExternalStore(store.subscribe, () => store.getState().mail);
  if (mail.length === 0) return null;
  return (
    <InspectorSection id="mail" title="Mail">
      <MailStrip mail={mail} />
    </InspectorSection>
  );
}

export function MailSection(): ReactNode {
  const session = useInspectorSession();
  return session === null ? null : <MailBody store={session.store} />;
}
