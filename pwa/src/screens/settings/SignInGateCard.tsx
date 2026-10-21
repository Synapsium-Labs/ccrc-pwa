// Settings › Security's Sign-in gate card, and the banner every Settings page shows while the gate is open to other
// machines (settings spec §5.5; settings Task R2b2, D-5503). Both read the frame's ONE status read
// (`SettingsDataProvider`'s `auth`, GET /api/auth/status once per mount, D-3298: /health reports no gate state) and
// make none of their own. The gate has no control: it is set on the server, by design (§1.4).
//
// The card's words, per state (§5.5's table):
//   - `passphrase`: on, one line;
//   - `locked-out`: locked, and it reopens by itself;
//   - `off`, reached over a name that is not loopback (`unarmedExposure`): the danger tone, its lead, the remedy, and
//     where passkeys and sign-out will appear;
//   - `off` on loopback: off, reachable from this machine only, in neutral ink;
//   - unreadable (a failed read, an older server, a body without a mode this build knows): "could not be read",
//     NEVER "on" and never "off".
// The banner draws only in the exposed state. Every non-answer draws NOTHING, because a red banner is a claim about
// this box, and a status read that told us nothing is not evidence of an open gate.
import type { ReactNode } from 'react';
import { Section, Skeleton, TextLink } from '@ccrc/ui';
import { SETTINGS_AMBER_NOTE, SETTINGS_CARDS, SIGN_IN_GATE_TEXT, inAppClick } from '../../fleet/settingsText';
import type { AuthRead } from './SettingsDataProvider';

import { unarmedExposure } from './signInGate';
export { unarmedExposure };

/** The gate's state as the card says it. `pending` until the read lands; `unread` for every answer that is not one
 *  of the three modes. */
export type GateState = 'pending' | 'on' | 'locked-out' | 'exposed' | 'loopback' | 'unread';

export function gateState(auth: AuthRead, hostname: string): GateState {
  if (auth.kind === 'pending') return 'pending';
  if (auth.kind === 'failed') return 'unread';
  const { status } = auth;
  if (unarmedExposure(status, hostname)) return 'exposed';
  switch (status.mode) {
    case 'off': return 'loopback';
    case 'locked-out': return 'locked-out';
    case 'passphrase': return 'on';
    default: return 'unread';
  }
}

/** The Sign-in gate card (scope "This box"). */
export function SignInGateCard({ auth }: { auth: AuthRead }): ReactNode {
  const card = SETTINGS_CARDS.security.gate;
  const state = gateState(auth, location.hostname);
  return (
    <Section level={3} scope={card.scope} title={card.title} purpose={card.purpose} data-gate={state}>
      {state === 'pending' ? <Skeleton lines={1} />
        : state === 'on' ? <p className="settings-note">{SIGN_IN_GATE_TEXT.on}</p>
        : state === 'locked-out' ? <p className={SETTINGS_AMBER_NOTE}>{SIGN_IN_GATE_TEXT.lockedOut}</p>
        : state === 'loopback' ? <p className="settings-note">{SIGN_IN_GATE_TEXT.loopback}</p>
        : state === 'unread' ? <p className={SETTINGS_AMBER_NOTE}>{SIGN_IN_GATE_TEXT.unread}</p>
        : (
          <>
            {/* The danger tone: the page's one self-grounded red block (`.settings-unarmed`), so no rule is added. */}
            <div className="settings-unarmed">
              <p className="m-0">{SIGN_IN_GATE_TEXT.exposedLead}</p>
              <p className="m-0">{SIGN_IN_GATE_TEXT.remedy}</p>
            </div>
            <p className="settings-note">{SIGN_IN_GATE_TEXT.laterCards}</p>
          </>
        )}
    </Section>
  );
}

/** The compact banner at the top of every Settings page, in the exposed state only: the card's lead and a link to
 *  Settings › Security. The frame keeps it at one place in the tree on the index and on every section page, so it
 *  is mounted, and so announced (`role="alert"`), once per mount of the frame, not again on each page. It replaces
 *  the top-of-page paragraph that named a route. */
export function SignInGateBanner({ auth, onSecurity }: { auth: AuthRead; onSecurity: boolean }): ReactNode {
  if (gateState(auth, location.hostname) !== 'exposed') return null;
  // On Security itself the card below holds the remedy, so the banner keeps its node and lead but links nowhere: a
  // link to the page it is on would be a dead door.
  return (
    <div className="settings-unarmed" role="alert" data-gate-banner="">
      {`${SIGN_IN_GATE_TEXT.exposedLead} `}
      {!onSecurity && (
        <TextLink href="/settings/security" onClick={inAppClick('/settings/security')}>{SIGN_IN_GATE_TEXT.bannerLink}</TextLink>
      )}
    </div>
  );
}
