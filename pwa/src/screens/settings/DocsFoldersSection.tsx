// Settings' Docs folders section (X2 P2.4, spec 4.1 "Settings"): the folders outside the projects that Docs may read, each by
// its label with its absolute path, Add (a label and an absolute path, behind the account gate's step-up) and Remove.
//
// THE ONE PLACE A FOLDER'S PATH IS DRAWN. The listing here is the paths door's (`api.docs.folders.paths`), the one door
// whose answer carries a path; no Docs page reads it (`docs-ring.test.ts` holds that this file is the paths method's only
// caller). A folder whose registry entry cannot be read (`state: 'unreadable'`) is shown by label with that word and no path,
// and stays removable.
//
// SIGN-IN DARK. Both listing doors refuse `auth-off` while sign-in is dark (an outside folder is read only with a session),
// so the section cannot name a label then. It says what to do in plain words (`signInNeeded`) and draws NO list, NO Add form
// and no spinner: an empty list there would read as "no folders". There is no workaround and no control for it.
//
// Rules, as the Linear card keeps them: Add is a credential-class act (a widening), so it goes through `useStepUp`'s
// `runAct` once, and a `step-up-required` shows the "Confirm it's you" step and waits for the operator to press Add again;
// Remove is a narrowing and asks none. Every refusal is a fixed sentence chosen by its word (`failureSentence` for a docs
// word, `DOCS_FOLDER_TEXT.gateRefusal` for the account gate's own); the box's text never reaches the screen.
import { useCallback, useEffect, useId, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { Button, Section, TextInput } from '@ccrc/ui';
import { DOCS_FOLDER_LABEL_RE, type DocsFolderListRow } from '../../../../shared/docs';
import { ConfirmItsYou } from '../../accounts/ConfirmItsYou';
import { useStepUp, type StepUpDeps } from '../../accounts/useStepUp';
import { DOCS_FOLDER_TEXT, failureSentence, slotSentence } from '../../docs/docsText';
import type { DocsNotOk } from '../../docs/failures';
import type { DocsFolderLoaders } from '../../docs/folderPage';
import { SETTINGS_CARDS, ResultLine, useResultLine } from '../../fleet/settingsText';
import { ApiError, api } from '../../lib/api';
import { onAuthRegained } from '../../lib/auth';

/** The hook is told the session's step-up is fresh until an act proves otherwise (the Linear card's rule): no challenge is
 *  fetched on a visit to Settings, only after Add is refused `step-up-required`. */
const ASSUME_FRESH = Infinity;

const DEFAULT_FOLDERS: DocsFolderLoaders = api.docs.folders;

/** The listing's slot. `dark` is the sign-in-needed state: the word the doors refuse with while sign-in is off, or with no
 *  session. */
type Slot =
  | { s: 'loading' } | { s: 'ok'; rows: readonly DocsFolderListRow[] } | { s: 'dark' } | { s: 'signed-out' }
  | { s: 'failed'; text: string };

/** Which sign-in refusal an answer is: `dark` (`auth-off`: sign-in is off, so it must be turned on), `signed-out`
 *  (`unauthenticated`, or the client's `auth` slot: sign-in is on and this device has no session), or `null` (none). */
function signInRefusal(a: DocsNotOk): 'dark' | 'signed-out' | null {
  if (a.s === 'auth') return 'signed-out';
  if (a.s !== 'failed') return null;
  return a.body.failure === 'auth-off' ? 'dark' : a.body.failure === 'unauthenticated' ? 'signed-out' : null;
}

const notOkSentence = (a: DocsNotOk): string => (a.s === 'failed' ? failureSentence(a.body) : slotSentence(a));

/** The sentence of a sign-in refusal. */
const signInSentence = (kind: 'dark' | 'signed-out'): string =>
  kind === 'dark' ? DOCS_FOLDER_TEXT.signInNeeded : DOCS_FOLDER_TEXT.signInAgain;

/** The account gate's refusal word of a write (`ApiError` with `{error}`), as its fixed sentence; `other` when the word is
 *  none the gate is known to say, or there is none. */
function gateSentence(err: unknown, other: string): string {
  const b: unknown = err instanceof ApiError ? err.body : null;
  const word = typeof b === 'object' && b !== null ? (b as { error?: unknown }).error : undefined;
  const known: Readonly<Record<string, string>> = DOCS_FOLDER_TEXT.gateRefusal;
  return typeof word === 'string' && Object.hasOwn(known, word) ? known[word]! : other;
}

export function DocsFoldersSection(p: { folders?: DocsFolderLoaders; stepUpDeps?: StepUpDeps }): ReactNode {
  const { folders = DEFAULT_FOLDERS, stepUpDeps } = p;
  const card = SETTINGS_CARDS.integrations.docsFolders;
  const [slot, setSlot] = useState<Slot>({ s: 'loading' });
  const [nonce, setNonce] = useState(0);
  const [label, setLabel] = useState('');
  const [path, setPath] = useState('');
  const [busy, setBusy] = useState(false);
  const result = useResultLine();
  const stepUp = useStepUp(ASSUME_FRESH, stepUpDeps);
  const labelId = useId();
  const pathId = useId();

  useEffect(() => {
    let live = true;
    void folders.paths().then((a) => {
      if (!live) return;
      if (a.s === 'ok') { setSlot({ s: 'ok', rows: a.value.folders }); return; }
      const kind = signInRefusal(a);
      setSlot(kind === null ? { s: 'failed', text: notOkSentence(a) } : { s: kind });
    }, () => undefined);
    return () => { live = false; };
  }, [folders, nonce]);
  const reread = useCallback(() => setNonce((n) => n + 1), []);
  // A sign-in again reads the list again: the list was refused (or never read) while this device had no session.
  useEffect(() => onAuthRegained(reread), [reread]);

  const add = (e: FormEvent): void => {
    e.preventDefault();
    const l = label.trim();
    const pth = path.trim();
    if (busy || l === '' || pth === '') return;
    setBusy(true);
    result.clear();
    void (async () => {
      try {
        let answer: Awaited<ReturnType<DocsFolderLoaders['add']>> | undefined;
        const outcome = await stepUp.runAct(async () => { answer = await folders.add(l, pth); });
        if (outcome === 'step-up') return;
        if (answer === undefined) return;
        if (answer.s === 'ok') {
          setLabel('');
          setPath('');
          result.say(DOCS_FOLDER_TEXT.added);
          reread();
        } else {
          const kind = signInRefusal(answer);
          result.say(kind === null ? notOkSentence(answer) : signInSentence(kind), 'refusal');
        }
      } catch (err) {
        // A refusal of the account gate (`step-up-required` is the hook's, handled above); a 401 is the login screen's.
        if (!(err instanceof ApiError && err.status === 401)) result.say(gateSentence(err, DOCS_FOLDER_TEXT.gateRefusalOther), 'refusal');
      } finally {
        setBusy(false);
      }
    })();
  };

  const remove = (row: DocsFolderListRow): void => {
    if (busy) return;
    setBusy(true);
    result.clear();
    void folders.remove(row.label).then((a) => {
      if (a.s === 'ok') {
        result.say(DOCS_FOLDER_TEXT.removed);
        reread();
      } else {
        const kind = signInRefusal(a);
        result.say(kind === null ? notOkSentence(a) : signInSentence(kind), 'refusal');
      }
    }, (err: unknown) => {
      // Remove is a narrowing and asks no step-up; the gate can still refuse a session that is gone (a 401 is the login screen's).
      if (!(err instanceof ApiError && err.status === 401)) result.say(gateSentence(err, DOCS_FOLDER_TEXT.removeFailed), 'refusal');
    }).finally(() => setBusy(false));
  };

  let body: ReactNode;
  if (slot.s === 'loading') body = <p className="settings-note" data-docs-folders="loading">{DOCS_FOLDER_TEXT.settingsReading}</p>;
  else if (slot.s === 'dark' || slot.s === 'signed-out') {
    body = <p className="settings-note" data-docs-folders="sign-in">{signInSentence(slot.s)}</p>;
  }
  else if (slot.s === 'failed') {
    body = (
      <>
        <p className="settings-note" data-docs-folders="failed">{slot.text}</p>
        <Button variant="ghost" size="fit" onClick={reread}>{DOCS_FOLDER_TEXT.retry}</Button>
      </>
    );
  } else {
    const labelOk = DOCS_FOLDER_LABEL_RE.test(label.trim());
    body = (
      <>
        {slot.rows.length === 0
          ? <p className="settings-note" data-docs-folders="empty">{DOCS_FOLDER_TEXT.settingsEmpty}</p>
          : (
            <ul className="linear-list" data-docs-folders="list">
              {slot.rows.map((r) => (
                <li key={r.label} data-folder={r.label} data-state={r.state}>
                  <strong>{r.label}</strong>{' '}
                  {r.state === 'ok' && r.path !== null
                    ? <code className="docs-folder-path">{r.path}</code>
                    : <span className="settings-note">{DOCS_FOLDER_TEXT.unreadableState}</span>}{' '}
                  <Button variant="ghost" size="fit" disabled={busy} onClick={() => remove(r)}>{DOCS_FOLDER_TEXT.remove}</Button>
                </li>
              ))}
            </ul>
          )}
        <form className="linear-add" data-docs-folders="add" onSubmit={add}>
          <label htmlFor={labelId} className="settings-note">{DOCS_FOLDER_TEXT.labelField}</label>
          <TextInput id={labelId} value={label} aria-invalid={label.trim() !== '' && !labelOk} onChange={(e) => setLabel(e.target.value)} />
          <label htmlFor={pathId} className="settings-note">{DOCS_FOLDER_TEXT.pathField}</label>
          <TextInput id={pathId} value={path} onChange={(e) => setPath(e.target.value)} />
          <Button type="submit" variant="primary" size="fit" disabled={busy || !labelOk || path.trim() === ''}>
            {DOCS_FOLDER_TEXT.add}
          </Button>
        </form>
        <ConfirmItsYou stepUp={stepUp} subject={DOCS_FOLDER_TEXT.stepUpSubject} />
      </>
    );
  }

  return (
    <Section level={3} scope={card.scope} title={card.title} purpose={card.purpose} data-docs-folders="section">
      {body}
      <ResultLine line={result.line} />
    </Section>
  );
}
