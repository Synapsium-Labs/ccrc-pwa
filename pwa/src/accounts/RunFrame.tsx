import { useRef, useState, type ReactNode } from 'react';
import { Button, buttonVariants, cn, toast, useDesk, useNow } from '@ccrc/ui';
import {
  COME_BACK, COPIED, COPY_LINK, OPEN_LINK, OPEN_TO_SIGN_IN, REMOTE_CONTROL_MARK, REMOTE_CONTROL_SCOPE, SIGN_IN_WITH,
  WHAT_THIS_GRANTS, countdownWords, privateTabLine,
} from '../fleet/accountWords';
import { COPY_FAILED } from '../fleet/TroubleCard';
import { GHOST_ANCHOR } from '../lib/ghostAnchor';
import { grantScopes, type SignInMethod } from './connectFlow';

/** One line of the step ledger: its words, and the instant it was written (this device's clock). */
export interface LedgerLine { readonly text: string; readonly at: number }

const clock = (ms: number): string => {
  const d = new Date(ms);
  const two = (n: number): string => String(n).padStart(2, '0');
  return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
};

/**
 * "Run" (spec §12.3 frame 5; accounts plan Tasks A18, A22): the step ledger, in mono, each line with its own clock.
 * GLOW ONLY ON THE LIVING PROCESS (spec §12.3, 09-05 §12.6): the line still running BREATHES while the box works
 * (`data-live`), and PULSES AMBER while it waits on the operator (`data-wait`, `--pulse-period`); a line that is done is
 * still. The sign-in's cards (the URL card, the countdown, the code field) are the host's `children`, below the ledger.
 */
export function RunFrame({ lines, live, waiting = false, children }: {
  lines: readonly LedgerLine[];
  live: boolean;
  /** The last line waits on the operator (the code), not on the box. */
  waiting?: boolean;
  children?: ReactNode;
}): ReactNode {
  return (
    <div className="acct-frame" data-frame="run">
      <ol className="acct-ledger">
        {lines.map((l, i) => {
          const last = i === lines.length - 1;
          return (
            <li key={i} data-live={live && last && !waiting ? 'true' : undefined} data-wait={waiting && last ? 'true' : undefined}>
              <span className="acct-ledger-dot" aria-hidden="true" />
              <span className="acct-ledger-clock">{clock(l.at)}</span>
              <span className="acct-ledger-text">{l.text}</span>
            </li>
          );
        })}
      </ol>
      {children}
    </div>
  );
}

/** The anchor wearing the primary button (the desk's Open): an anchor has no `enabled:` state, so it takes the fill as
 *  it is, and the 52px of spec §6.2 step 5 from its own class. */
const PRIMARY_ANCHOR = cn(buttonVariants({ variant: 'primary', size: 'fit' }), 'acct-open-primary');

/**
 * THE URL CARD (spec §6.2 step 5, §6.3, §12.4; accounts plan Task A22, D-7849). `url` and `host` are what the SERVER
 * parsed and accepted (N2, spec §3.8): the mono host label is the server's `host`, never the file's text and never
 * hard-coded. The link opens in a new tab with `rel="noopener noreferrer"`, and is never persisted.
 *  - On a phone: **Copy link** is the primary, with "Paste it into a private tab …" (which account approves is the
 *    browser's claude.ai session), and Open ↗ is secondary; "Come back here to paste the code" (an installed PWA that
 *    leaves may be reloaded on return).
 *  - At ≥900: a 52px "Open claude.ai to sign in ↗" primary with the mono host beside it, and Copy link secondary.
 *  - The code field and Send share one row at every width, so Send stays beside the field when a phone's keyboard is up.
 *  - COPY TELLS THE TRUTH (spec §12.4): "Copied" only once `navigator.clipboard.writeText` resolves; on a refusal, or
 *    with no clipboard, the link is selected in a read-only mono field with "Couldn't copy: press and hold to copy".
 *  - "What this grants": the scopes the URL asks for, in a disclosure, Remote Control's marked.
 */
export function UrlCard({ url, host, method }: { url: string; host: string; method: SignInMethod }): ReactNode {
  const desk = useDesk();
  const field = useRef<HTMLElement>(null);
  const [copy, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle');
  const failed = (): void => {
    setCopy('failed');
    // The field is drawn by this state; select it once it is.
    queueMicrotask(() => {
      const el = field.current;
      if (el === null) return;
      el.focus();
      window.getSelection()?.selectAllChildren(el);
    });
  };
  const onCopy = (): void => {
    // `navigator.clipboard` is absent outside a secure context, whatever the DOM types say.
    const clipboard: Clipboard | undefined = navigator.clipboard;
    if (clipboard === undefined) { failed(); return; }
    let written: Promise<void>;
    try { written = clipboard.writeText(url); } catch { failed(); return; }
    written.then(() => { setCopy('copied'); toast(COPIED); }, failed);
  };
  const copyLabel = copy === 'copied' ? COPIED : COPY_LINK;
  const scopes = grantScopes(url);
  const open = (primary: boolean, label: string): ReactNode => (
    <a className={primary ? PRIMARY_ANCHOR : cn(GHOST_ANCHOR, 'acct-open')} href={url} target="_blank" rel="noopener noreferrer">
      {label} <span aria-hidden="true">↗</span>
    </a>
  );
  return (
    <div className="acct-url-card" data-desk={desk ? 'true' : undefined}>
      {desk ? (
        <div className="acct-url-acts">
          {open(true, OPEN_TO_SIGN_IN)}
          <code className="acct-url-host">{host}</code>
          <Button variant="ghost" size="fit" className="acct-copy-link" onClick={onCopy}>{copyLabel}</Button>
        </div>
      ) : (
        <>
          <div className="acct-url-acts">
            <Button variant="primary" className="acct-copy-link" onClick={onCopy}>{copyLabel}</Button>
            {open(false, OPEN_LINK)}
          </div>
          <p className="acct-field-note">{privateTabLine(method)} <code className="acct-url-host">{host}</code></p>
          <p className="acct-field-note">{COME_BACK}</p>
        </>
      )}
      {copy === 'failed' && (
        <div className="acct-fix-command">
          <code ref={field} className="acct-fix-field acct-url-field" tabIndex={0} aria-label="The sign-in link">{url}</code>
          <p className="acct-fix-hold" role="status">{COPY_FAILED}</p>
        </div>
      )}
      <p className="acct-field-note">{SIGN_IN_WITH}</p>
      {scopes.length > 0 && (
        <details className="acct-grants">
          <summary>{WHAT_THIS_GRANTS}</summary>
          <ul className="acct-grant-list">
            {scopes.map((s) => (
              <li key={s}>
                <code>{s}</code>
                {s === REMOTE_CONTROL_SCOPE && <span className="acct-grant-mark"> · {REMOTE_CONTROL_MARK}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/** The countdown (spec §3.7, §6.2 step 6): the deadline's clock and what is left, ticking each second, both read from
 *  `expiresAt` alone. Amber while the sign-in waits on the operator. */
export function Countdown({ expiresAt, waiting }: { expiresAt: number; waiting: boolean }): ReactNode {
  const now = useNow(1000);
  return (
    <p className="acct-countdown" data-wait={waiting ? 'true' : undefined}>{countdownWords(expiresAt, now)}</p>
  );
}
