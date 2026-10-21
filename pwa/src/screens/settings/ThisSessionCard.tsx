// Settings › Security's This session card (settings spec §5.5; settings Task R2d, D-5508): Sign out, moved from
// Accounts with Your sign-in (`YourSignInCard.tsx`). It makes no read: Security shows it only while the provider's
// status read says the gate is armed.
//
// SIGN OUT (D-145) is two halves, and either alone is a bug: `POST /api/auth/logout` ends the session on the server
// (without it the browser keeps a cookie the server would still honour), and `raiseAuthLost('no-session')` brings the
// login screen up locally, through the same seam a 401 uses, so both socket ladders park and the next login wakes
// them. `'no-session'`, not `'expired'`: this is a deliberate act, not something that happened to the operator. A
// session already dead answers the gated route with 401, and the funnel raises off the body, which lands the operator
// where they were going anyway; the result line is for the odd failures (offline, a 500). It stays ghost with no
// confirm (D-5099): signing in again undoes it.
import { useState } from 'react';
import type { ReactNode } from 'react';
import { Button, Section } from '@ccrc/ui';
import { ResultLine, SETTINGS_CARDS, useResultLine } from '../../fleet/settingsText';
import { api, apiErrorText } from '../../lib/api';
import { raiseAuthLost } from '../../lib/auth';

/** This session's words (spec §5.5). */
export const SESSION_TEXT = {
  note: 'Signs this browser out. Other signed-in browsers stay signed in.',
} as const;

const PASSWD_COMMAND = 'ccrc passwd';
/** The sentence kept verbatim from Accounts; its command is set as code. */
export const PASSWD_SENTENCE = `To end every session at once, rotate the passphrase with ${PASSWD_COMMAND} on the box.`;
const [PASSWD_BEFORE, PASSWD_AFTER] = PASSWD_SENTENCE.split(PASSWD_COMMAND);

export function ThisSessionCard(): ReactNode {
  const card = SETTINGS_CARDS.security.session;
  const [busy, setBusy] = useState(false);
  const result = useResultLine();

  const signOut = async (): Promise<void> => {
    setBusy(true);
    result.clear();
    try {
      await api.logout();
      raiseAuthLost('no-session');
    } catch (err) {
      result.say(apiErrorText(err), 'refusal');
    } finally {
      // Cleared on the success path too: this card stays mounted behind the login screen, and a kept "Signing out…"
      // would greet whoever signs back in.
      setBusy(false);
    }
  };

  return (
    <Section level={3} scope={card.scope} title={card.title} purpose={card.purpose}>
      <Button variant="ghost" disabled={busy} onClick={() => void signOut()}>
        {busy ? 'Signing out…' : 'Sign out'}
      </Button>
      <ResultLine line={result.line} />
      <p className="settings-note">{SESSION_TEXT.note}</p>
      <p className="settings-note">{PASSWD_BEFORE}<code>{PASSWD_COMMAND}</code>{PASSWD_AFTER}</p>
    </Section>
  );
}
