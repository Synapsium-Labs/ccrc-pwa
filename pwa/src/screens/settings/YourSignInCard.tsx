// Settings › Security's Your sign-in card (settings spec §5.5; settings Task R2d, D-5508): the passkeys, moved from
// Accounts with This session (`ThisSessionCard.tsx`). The two halves of what `AuthSection` was.
//
// IT MAKES NO READ OF ITS OWN. The status and the passkey list are the provider's (`SettingsDataProvider`, once per
// mount, the list only while the gate is armed); this card takes them as props. Its writes stay its own: the ceremony
// (`enrollPasskey`) and the revocation (`api.revokePasskey`). After either succeeds it calls `refreshAuth()`, the one
// way the list is read again, and announces `authPostureChanged()` from the writer, so the fleet sidebar's
// passphrase-only notice (D-161) retires on the first key and returns after the last.
//
// `label` is the enrolling device's user-agent: attacker-controlled text, rendered as TEXT (React's default), shown
// as it is with no parsing (spec §1.4), on one ellipsised line with the whole label as its `title`.
import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import type { AuthStatus, PasskeySummary } from '../../../../shared/api';
import { Button, QuickConfirm, Section, useNow } from '@ccrc/ui';
import { formatAge } from '../../fleet/formatReset';
import { ResultLine, SETTINGS_AMBER_NOTE, SETTINGS_CARDS, useResultLine } from '../../fleet/settingsText';
import { api, apiErrorText } from '../../lib/api';
import { authPostureChanged } from '../../lib/auth';
import { PasskeyCeremonyError, enrollPasskey, passkeyEnrollSupported } from '../../lib/passkey';
import type { PasskeysRead } from './SettingsDataProvider';

/**
 * THE UNREADABLE-FILE SENTENCE, verbatim (D-132, D-153). When the credential file exists and cannot be read, the
 * server reports zero credentials, and "No passkey is enrolled" would send the operator to enrol, which would rewrite
 * the file from an empty array and destroy the keys inside it. The server refuses that enrolment; this stops the
 * operator trying and says what to fix. THE PATH IS HEDGED, NOT ASSERTED (D-153): `CCRC_PASSKEYS_PATH` can redirect
 * the file and no route publishes where, so it names the default and the key that overrides it.
 */
export const STORE_UNREADABLE_TEXT =
  'This box’s passkey file exists but cannot be read, so no passkey can sign in and enrolling is refused '
  + '— adding one would overwrite the keys that are already there. Fix the permissions on '
  + '~/.ccrc/passkeys.json (or wherever CCRC_PASSKEYS_PATH points on this box) and restart the server.';
/** The sentence's path and key, set as code (as `AuthSection` set them); the words stay the constant above. */
const STORE_UNREADABLE_CODE = ['~/.ccrc/passkeys.json', 'CCRC_PASSKEYS_PATH'] as const;
function storeUnreadableSentence(): ReactNode {
  const [head, rest] = STORE_UNREADABLE_TEXT.split(STORE_UNREADABLE_CODE[0]) as [string, string];
  const [middle, tail] = rest.split(STORE_UNREADABLE_CODE[1]) as [string, string];
  return <>{head}<code>{STORE_UNREADABLE_CODE[0]}</code>{middle}<code>{STORE_UNREADABLE_CODE[1]}</code>{tail}</>;
}

/** Your sign-in's words (spec §5.5). */
export const SIGN_IN_TEXT = {
  none: 'No passkey is enrolled on this box — the passphrase is the only way in.',
  count: (n: number): string => `${n} passkey${n === 1 ? '' : 's'} enrolled on this box.`,
  /** The list read failed (spec §11): said, so a count with no rows is never silent. Not D-153's sentence, which
   *  claims more than a failed request shows. */
  listFailed: 'The passkey list could not be read, so its passkeys are not shown here. Reload to try again.',
  addNote: 'Adds this device’s passkey, so you can sign in here without the passphrase.',
  added: 'Passkey added. It can sign you in from now on.',
  cancelled: 'That passkey ceremony was cancelled or could not finish.',
  revoked: 'Passkey revoked. It cannot sign in again.',
  confirmTitle: (label: string): string => `Revoke the passkey ${label}?`,
  confirmConsequence: 'It will not sign in again.',
  confirmLast: 'This is your last passkey. After it, only the passphrase signs in.',
} as const;

/** The dates on a row, today's words: "added 5m ago", then ", last used …" when the server has a use. `formatAge`
 *  says the whole phrase ("5m ago", "just now"), so nothing is appended to it. */
function rowDates(c: PasskeySummary, now: number): string {
  const age = (at: number): string => formatAge(Math.floor(now / 1000) - Math.floor(at / 1000));
  return ` added ${age(c.enrolledAt)}${c.lastUsedAt > c.enrolledAt ? `, last used ${age(c.lastUsedAt)}` : ', never used'}`;
}

export function YourSignInCard({ status, passkeys, refreshAuth }: {
  status: Partial<AuthStatus>;
  passkeys: PasskeysRead;
  refreshAuth: () => void;
}): ReactNode {
  const card = SETTINGS_CARDS.security.signIn;
  const [busy, setBusy] = useState(false);
  /** The row whose Revoke asked last. Kept while the confirm closes, so its title does not lose the label mid-exit. */
  const [asking, setAsking] = useState<PasskeySummary | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const listTitleId = useId();
  const result = useResultLine();
  const now = useNow(60_000);
  const list = passkeys.kind === 'read' ? passkeys.list : null;
  const count = status.passkeysEnrolled ?? 0;

  const enroll = async (): Promise<void> => {
    setBusy(true);
    result.clear();
    try {
      await enrollPasskey();
      result.say(SIGN_IN_TEXT.added);
      refreshAuth();
      authPostureChanged();
    } catch (err) {
      // The ceremony's own failure and the box's refusal read differently: a Cancel is not a rejected key.
      result.say(err instanceof PasskeyCeremonyError ? SIGN_IN_TEXT.cancelled : apiErrorText(err), 'refusal');
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id: string): Promise<void> => {
    setBusy(true);
    result.clear();
    try {
      await api.revokePasskey(id);
      result.say(SIGN_IN_TEXT.revoked);
      refreshAuth();
      // Needed in both directions: revoking the last key puts the box back on the passphrase alone, which is when the
      // notice has to come back.
      authPostureChanged();
    } catch (err) {
      result.say(apiErrorText(err), 'refusal');
    } finally {
      setBusy(false);
    }
  };

  const body = list?.storeUnreadable === true ? (
    <p className={SETTINGS_AMBER_NOTE}>{storeUnreadableSentence()}</p>
  ) : (
    <>
      <p className="settings-note">{count === 0 ? SIGN_IN_TEXT.none : SIGN_IN_TEXT.count(count)}</p>
      {passkeys.kind === 'failed' && <p className={SETTINGS_AMBER_NOTE}>{SIGN_IN_TEXT.listFailed}</p>}
      {list !== null && list.credentials.length > 0 && (
        <ul className="settings-passkeys" aria-labelledby={listTitleId}>
          {list.credentials.map((c) => (
            <li key={c.credentialIdB64url} className="settings-passkey">
              <span className="settings-passkey-text">
                <span className="settings-passkey-label" title={c.label}>{c.label}</span>
                <span className="settings-note">{rowDates(c, now)}</span>
              </span>
              <Button
                variant="danger-ghost"
                size="fit"
                className="settings-passkey-revoke flex-none"
                disabled={busy}
                aria-label={`Revoke passkey ${c.label}`}
                onClick={() => { setAsking(c); setConfirmOpen(true); }}
              >
                Revoke
              </Button>
            </li>
          ))}
        </ul>
      )}
      {/* Enrolling needs WebAuthn Level 2 (`getPublicKey()`); a browser that can sign in with a key made elsewhere
          but cannot make one gets the list and no Add. */}
      {passkeyEnrollSupported() && (
        <div className="settings-passkey-add">
          <Button variant="primary" disabled={busy} onClick={() => void enroll()}>
            {busy ? 'Waiting for the authenticator…' : 'Add a passkey on this device'}
          </Button>
          <p className="settings-note">{SIGN_IN_TEXT.addNote}</p>
        </div>
      )}
    </>
  );

  return (
    <Section level={3} scope={card.scope} title={card.title} purpose={card.purpose}>
      <h4 id={listTitleId} className="settings-passkeys-title">Passkeys</h4>
      {body}
      <ResultLine line={result.line} />
      <QuickConfirm
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        tone="danger"
        defaultFocus="cancel"
        title={SIGN_IN_TEXT.confirmTitle(asking?.label ?? '')}
        consequence={list !== null && list.credentials.length === 1
          ? [SIGN_IN_TEXT.confirmConsequence, SIGN_IN_TEXT.confirmLast]
          : SIGN_IN_TEXT.confirmConsequence}
        confirmLabel="Revoke"
        onConfirm={() => { if (asking !== null) void revoke(asking.credentialIdB64url); }}
      />
    </Section>
  );
}
