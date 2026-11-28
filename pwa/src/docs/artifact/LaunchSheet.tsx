// The artifact launch sheet and its Open link (X5 A5.2; spec 2026-11-19 §3.2 "The scope read, before the mint", §4.1, §4.4, §6.2).
// Ring L4: it draws what `tier.ts` and `artifactWords.ts` decide and word, and decides nothing beyond calling them.
//   - On open, and again whenever the page's pin changes (`docListPinKey`) or Retry is tapped, it reads the scope: what the page
//     could read, before anything is minted. A newer read aborts the older one.
//   - Prepare mints with the choices as ticked and shows the one real link, `<a target="_blank" rel="noopener noreferrer">`, the
//     operator taps: a link rather than a popup call after an await, which loses its user activation in some browsers. The URL
//     is the anchor's `href` and nowhere else on the page: no text, no Copy link, never answered again.
//   - THE ONE RULE FOR LETTING GO (`release`): a capability the sheet holds is revoked when the sheet unmounts, when the pin
//     changes, when a tick changes, or when an origin it was minted with leaves the offer, but only if its Open was never tapped.
//     Open counts as tapped on any pointer-down, click, middle-click or context menu on the link, because each can open it in a
//     tab (a long-press, the menu key and a drag into the tab bar included). Once Open was tapped the tab may be using it, so it
//     lives on and the list's Revoke ends it; a touch that only grazes the link therefore also keeps the capability alive until
//     that Revoke, the safe direction: never revoked behind the operator's back. A mint answer that arrives after the sheet
//     moved on (a newer pin, an unmount) is for a page this sheet no longer shows: it revokes its own id and touches nothing the
//     sheet holds. So is one whose origins are no longer all in the CURRENT offer (the census changed while the mint was out): it
//     is checked against the latest offer, revoked, and Prepare shows again with nothing held.
//   - Every mint that answered ok is noted in the store (`noteMinted`: id and page, never the URL) before anything else touches
//     its id, and forgotten when its revoke ends, so a list that could not be read again after the mint still lists a link that is
//     live in a tab, with its Revoke, until a good read settles it.
//   - `pin-moved`, from the scope read or the mint, is the one refusal with an action, "Reload and open again": each tap asks the
//     leaf's re-list once, and it is enabled again when the leaf hands a new pin; the new pin reads the scope again with this
//     sheet still open. A scope read that did not complete (the box could not list the files, a docs slot) shows Retry instead.
//   - A leaf whose pre-scan did not run hands no census (null): no outside host, no above-the-folder count, and Prepare mints
//     with no origins. A leaf whose pre-scan has not answered yet hands 'pending': the sheet waits and holds Prepare.
import { useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Button, QC_ACTIONS, Sheet, buttonVariants } from '@ccrc/ui';
import type { ArtifactMintOk, ArtifactScopeOk } from '../../../../shared/artifacts';
import { docListPinKey, type DocListPin, type DocSectionSlug } from '../../../../shared/docs';
import { fillSentence } from '../docsText';
import { ARTIFACT_TEXT } from './artifactWords';
import { artifactStop, sheetOrigins, type ArtifactAnswer, type ArtifactCensusState, type ArtifactStop } from './tier';
import { ArtifactDoorsContext, useArtifacts } from './useArtifacts';
import './artifact.css';

/** The Open link's `rel`: the tab gets no opener handle and no `Referer`, so neither the console nor the artifact tab can reach the other. */
export const ARTIFACT_OPEN_REL = 'noopener noreferrer';

export interface LaunchSheetProps {
  readonly project: string;
  /** The page's pin at this moment; a new one (by its key) reads the scope again, a new object of the same key re-enables Reload. */
  readonly pin: DocListPin;
  /** The page the sheet mints for, so a capability it minted is noted (with its page) in the store beside the lists. */
  readonly page: { readonly section: DocSectionSlug; readonly path: string };
  /** The pre-scan's census; null where the leaf's pre-scan did not run, 'pending' until it answers. */
  readonly census: ArtifactCensusState;
  /** The walls view's own refusal line for this page (budget, size or pre-scan), repeated under the Why line; null when it has none. */
  readonly wallsNote: string | null;
  /** The leaf visit's re-list of its tree. */
  readonly retryTree: () => void;
  readonly onClose: () => void;
}

type Read =
  | { readonly s: 'reading' }
  | { readonly s: 'ok'; readonly scope: ArtifactScopeOk }
  | ({ readonly s: 'halted' } & ArtifactStop);

type Mint =
  | { readonly s: 'idle' }
  | { readonly s: 'minting' }
  | { readonly s: 'minted'; readonly mint: ArtifactMintOk }
  | ({ readonly s: 'refused' } & ArtifactStop);

/** The choices a held capability was minted with. */
interface Asked { readonly origins: readonly string[]; readonly windows: boolean }

export function LaunchSheet(p: LaunchSheetProps): ReactNode {
  const { project, pin, page, census, wallsNote, retryTree, onClose } = p;
  const doors = useContext(ArtifactDoorsContext);
  const { state, refresh, noteMinted, forgetKnown } = useArtifacts();
  const [read, setRead] = useState<Read>({ s: 'reading' });
  const [readNo, setReadNo] = useState(0);
  const [mint, setMint] = useState<Mint>({ s: 'idle' });
  const [ticked, setTicked] = useState<readonly string[]>([]);
  const [windows, setWindows] = useState(false);
  const [reloaded, setReloaded] = useState(false);
  // The ids this sheet holds or has revoked: the "Another artifact is open" line counts every other live one.
  const [mine, setMine] = useState<readonly string[]>([]);
  // The capability the sheet holds now (the one its Open shows), what it was minted with, whether its Open was tapped, and the
  // number of the read the sheet is on (bumped by a new pin, a retry and an unmount, so an older mint answer reads as stale).
  const heldId = useRef<string | null>(null);
  const heldAsked = useRef<Asked | null>(null);
  const opened = useRef(false);
  const generation = useRef(0);
  const pinNow = useRef(pin);

  /** Revokes `id` and reads the live list again. A revoke that did not end it (a failed answer, a defect) takes it off `mine`, so
   *  the "Another artifact is open" line shows it when the list still holds it. */
  const revokeId = useCallback(async (id: string): Promise<void> => {
    let ended = false;
    try {
      ended = (await doors.revoke(id)).s === 'ok';
    } catch {
      // A defect: the list read below still shows what is live.
    }
    if (ended) forgetKnown(id);
    else setMine((ids) => ids.filter((i) => i !== id));
    await refresh();
  }, [doors, refresh, forgetKnown]);

  /** THE rule for letting go of the held capability (see the header): revoked unless its Open was tapped, then it lives on and is
   *  no longer this sheet's. */
  const release = useCallback((): void => {
    const id = heldId.current;
    if (id === null) return;
    heldId.current = null;
    heldAsked.current = null;
    if (opened.current) {
      opened.current = false;
      setMine((ids) => ids.filter((i) => i !== id));
      return;
    }
    void revokeId(id);
  }, [revokeId]);

  /** A tick, the windows choice or the offer changed under a minted capability: let it go, hide Open, Prepare again. */
  const changed = useCallback((): void => {
    release();
    setMint({ s: 'idle' });
  }, [release]);

  // Unmount: an older mint answer is stale from here on, and what the sheet holds is let go by the one rule.
  const releaseNow = useRef(release);
  useEffect(() => {
    releaseNow.current = release;
  });
  useEffect(() => () => {
    generation.current += 1;
    releaseNow.current();
  }, []);

  // A new pin object: the leaf's re-list answered, so Reload and open again may be tapped again.
  useEffect(() => {
    pinNow.current = pin;
    setReloaded(false);
  }, [pin]);

  const pinKey = docListPinKey(pin);
  useEffect(() => {
    generation.current += 1;
    const ctl = new AbortController();
    release();
    setRead({ s: 'reading' });
    setMint({ s: 'idle' });
    setReloaded(false);
    void (async () => {
      let answer: ArtifactAnswer<ArtifactScopeOk>;
      try {
        answer = await doors.scope(project, pinNow.current, ctl.signal);
      } catch {
        // An abort (a newer pin, a close) says nothing; any other rejection is a read that did not complete.
        if (ctl.signal.aborted) return;
        answer = { s: 'unreachable' };
      }
      if (ctl.signal.aborted) return;
      setRead(answer.s === 'ok' ? { s: 'ok', scope: answer.value } : { s: 'halted', ...artifactStop(answer) });
    })();
    return () => ctl.abort();
  }, [doors, project, pinKey, readNo, release]);

  const pending = census === 'pending';
  const counts = census === null || census === 'pending' ? null : census;
  const offered = counts === null || read.s !== 'ok'
    ? []
    : sheetOrigins(counts.origins, [location.hostname, read.scope.artifactHost, read.scope.contentHost]);

  // The latest offer, for a mint answer that lands after a render moved the offer on.
  const offeredNow = useRef(offered);
  useEffect(() => {
    offeredNow.current = offered;
  });

  // An origin the held capability was minted with that the offer no longer holds is a tick change.
  const offeredKey = offered.join('\n');
  useEffect(() => {
    const asked = heldAsked.current;
    if (asked === null) return;
    const now = offeredKey === '' ? [] : offeredKey.split('\n');
    if (asked.origins.some((o) => !now.includes(o))) changed();
  }, [offeredKey, changed]);

  const toggleOrigin = (origin: string, on: boolean): void => {
    changed();
    setTicked((t) => (on ? [...t, origin] : t.filter((o) => o !== origin)));
  };
  const toggleWindows = (on: boolean): void => {
    changed();
    setWindows(on);
  };

  const prepare = async (): Promise<void> => {
    const mineNow = generation.current;
    const asked: Asked = { origins: offered.filter((o) => ticked.includes(o)), windows };
    setMint({ s: 'minting' });
    let answer: ArtifactAnswer<ArtifactMintOk>;
    try {
      answer = await doors.mint({ pin, project, origins: [...asked.origins], windows: asked.windows });
    } catch {
      answer = { s: 'unreachable' };
    }
    if (answer.s !== 'ok') {
      if (mineNow === generation.current) setMint({ s: 'refused', ...artifactStop(answer) });
      return;
    }
    // Live from here on: the store notes it first, so a list that cannot be read again still lists it with its Revoke.
    noteMinted({ id: answer.value.id, project, section: page.section, path: page.path });
    // Stale: the sheet moved on while the mint was out. The capability is for a page this sheet no longer shows, so it ends its
    // own id and touches nothing the sheet holds.
    if (mineNow !== generation.current) {
      void revokeId(answer.value.id);
      return;
    }
    // The offer moved on while the mint was out: an origin it was minted with is gone, so it ends its own id, holds nothing and
    // Prepare shows again.
    if (asked.origins.some((o) => !offeredNow.current.includes(o))) {
      void revokeId(answer.value.id);
      setMint({ s: 'idle' });
      return;
    }
    const { id } = answer.value;
    heldId.current = id;
    heldAsked.current = asked;
    opened.current = false;
    setMine((ids) => [...ids, id]);
    setMint({ s: 'minted', mint: answer.value });
    void refresh();
  };

  /** Open was tapped, on any of the ways a tab can be opened from the link (see the header). */
  const markOpened = (): void => { opened.current = true; };

  const minted = mint.s === 'minted' ? mint.mint : null;
  const haltedMoved = read.s === 'halted' && read.pinMoved;
  const refusedMoved = mint.s === 'refused' && mint.pinMoved;
  const pinMoved = haltedMoved || refusedMoved;
  const busy = mint.s === 'minting';
  const shown = minted ?? (read.s === 'ok' ? read.scope : null);
  const others = state.list.s === 'ok' && state.list.live.some((r) => !mine.includes(r.id));

  let body: ReactNode;
  if (read.s === 'reading') {
    body = <p className="docs-loading">{ARTIFACT_TEXT.reading}</p>;
  } else if (read.s === 'halted') {
    body = <p className="docs-note" role="alert">{read.sentence}</p>;
  } else {
    body = (
      <>
        <p className="docs-note">{ARTIFACT_TEXT.why}</p>
        {wallsNote !== null && <p className="docs-note">{wallsNote}</p>}
        {shown !== null && (
          <p className="docs-note">
            {fillSentence(ARTIFACT_TEXT.whatRuns, { host: read.scope.artifactHost, n: shown.files, m: shown.uncommitted })}
          </p>
        )}
        {shown !== null && shown.unsized > 0 && <p className="docs-note">{fillSentence(ARTIFACT_TEXT.unsized, { n: shown.unsized })}</p>}
        {pending && <p className="docs-loading">{ARTIFACT_TEXT.reading}</p>}
        {!pending && counts === null && <p className="docs-note">{ARTIFACT_TEXT.notScanned}</p>}
        {counts !== null && (
          <>
            {offered.map((origin) => (
              <label key={origin} className="docs-artifact-check">
                <input
                  type="checkbox" checked={ticked.includes(origin)} disabled={busy || pinMoved}
                  onChange={(e) => toggleOrigin(origin, e.currentTarget.checked)}
                />
                {`${origin} — ${ARTIFACT_TEXT.originNote}`}
              </label>
            ))}
            {counts.above > 0 && <p className="docs-note">{fillSentence(ARTIFACT_TEXT.above, { n: counts.above })}</p>}
          </>
        )}
        {others && <p className="docs-note">{ARTIFACT_TEXT.othersOpen}</p>}
        <label className="docs-artifact-check">
          <input type="checkbox" checked={windows} disabled={busy || pinMoved} onChange={(e) => toggleWindows(e.currentTarget.checked)} />
          {ARTIFACT_TEXT.windows}
        </label>
        {mint.s === 'refused' && <p className="docs-note" role="alert">{mint.sentence}</p>}
      </>
    );
  }

  let main: ReactNode = null;
  if (pinMoved) {
    main = (
      <Button variant="primary" disabled={reloaded} onClick={() => { setReloaded(true); retryTree(); }}>{ARTIFACT_TEXT.reloadOpen}</Button>
    );
  } else if (minted !== null) {
    main = (
      <a
        href={minted.url} target="_blank" rel={ARTIFACT_OPEN_REL}
        onClick={markOpened} onAuxClick={markOpened} onContextMenu={markOpened} onPointerDown={markOpened}
        className={buttonVariants({ variant: 'primary' })}
      >
        {ARTIFACT_TEXT.openLink}
      </a>
    );
  } else if (read.s === 'halted' && read.retry) {
    main = <Button variant="primary" onClick={() => setReadNo((n) => n + 1)}>{ARTIFACT_TEXT.retry}</Button>;
  } else if (read.s === 'ok') {
    main = <Button variant="primary" disabled={busy || pending} onClick={() => { void prepare(); }}>{ARTIFACT_TEXT.prepare}</Button>;
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={ARTIFACT_TEXT.sheetTitle}
      footer={(
        <div className={QC_ACTIONS}>
          {main}
          <Button variant="ghost" onClick={onClose}>{ARTIFACT_TEXT.cancel}</Button>
        </div>
      )}
    >
      <div className="docs-artifact-sheet">{body}</div>
    </Sheet>
  );
}
