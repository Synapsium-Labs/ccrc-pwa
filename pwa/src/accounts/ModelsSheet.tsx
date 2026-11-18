// THE MODELS SHEET (programme model-class-advance, wave R4; plan 2026-10-15-model-class-auto-advance-codex-arm.md, Task 20
// as re-planned, D-8686, D-8690): one Codex lane's four classes as the lane's own files say them, with the advance record
// beside them, and Hold, Release and Revert for each class. Drawn in `AccountSheet`'s shell, as the re-auth and switch sheets
// are: its live region announces each answer (ONE announcement per failure: the card's own note is text, not a second alert),
// its offline line sits above the body.
//
// ONE READ. The sheet reads through `useLaneModels` (`lib/useLaneModels.ts`), the same hook every other surface that names a
// lane's models reads through: no second hook and no second fetch of the GET. An act's 200 carries the FRESH read, shown at
// once, put in the screen cache for the other surfaces (even if the sheet was closed while the act was with the box), and kept
// until a read STARTED AFTER it lands: the sheet asks the lane again after EVERY act, whatever the outcome. The moment a 200
// arrives the sheet supersedes every read of the hook still in flight (`LaneModelsControl`, `usePoll`'s `supersede`), so a read
// issued before the act (the opening read of a sheet drawn from the cache) can never land between the 200 and the read asked
// for after it, and an older read never puts the old state back, on screen or in the cache (review 2523 F2).
//
// NON-OPTIMISTIC. A tap stands down every control (one write at a time: the fleet agent has one models gate), marks the tapped
// class's controls busy, and changes nothing else. The row moves only on the server's answer, and then only to a read. "Nothing
// was changed" is said only where the verb never ran (`modelsActFailure`); a refusal the verb itself made, or an outcome that is
// unknown (a timeout, a lost answer, a 200 this build cannot read, no answer at all), says what it knows and the row shows what
// the lane holds now (F1). When the act settles the focus is on the class's card (F11).
//
// REVERT ASKS FIRST, and exists only where the box says the class can revert (`classActs`), re-checked on the CURRENT read while
// the confirm stands and again when it is confirmed (F13). A failed read of the lane is said in words with a Try again (F12).
// L4: it decides nothing about wording or refusals; every sentence, reader and per-class predicate is `modelsSheetWords.ts`.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button, QuickConfirm, Skeleton } from '@ccrc/ui';
import { CLASSES, type LaneModelsRead, type ModelClass } from '../../../shared/models';
import { forget, put, laneModelsKey } from '../lib/screenCache';
import { api } from '../lib/api';
import { useLaneModelsView, type LaneModelsControl, type LaneModelsReadOutcome } from '../lib/useLaneModels';
import { laneReadWords, type LaneReadFailure } from '../lib/models';
import { AccountSheet, type Announcement } from './AccountSheet';
import {
  MODELS_READ_FAILED, MODELS_RETRY, MODELS_REVERT_CONFIRM, MODELS_SHEET_TITLE, actDoneWords, modelsReadStateWords,
  actUnreadableWords, advanceStateWords, asLaneModelsActAnswer, classActs, classLabel, familyWords, holdAriaLabel, holdWords, lastMoveWords,
  modelLine, modelsActFailure, pendingWords, previousWords, revertAriaLabel, revertConsequence, revertStillOffered, revertTitle,
  revertWithdrawnWords, type ModelsAction,
} from './modelsSheetWords';
import '../fleet/fleet.css';
import './models-sheet.css';

/** The act the sheet calls: rejects with the app's `ApiError` on a non-2xx, as every `api.*` write does. */
export type ModelsActFn = (lane: string, body: { action: ModelsAction; class: ModelClass }) => Promise<unknown>;

export interface ModelsSheetProps {
  /** The lane whose classes the sheet shows (a Codex lane's roster id). */
  lane: string;
  open: boolean;
  onClose: () => void;
  /** Why the screen cannot act (offline, or the connect gate), or `null`. */
  offline: string | null;
  /** Injectable for tests; default `api.laneModelsAct`. */
  act?: ModelsActFn;
  /** Injectable for tests; `useLaneModels`' own default is `api.laneModels`. */
  load?: (lane: string, signal: AbortSignal) => Promise<unknown>;
}

/** `refused`: the verb never ran or it refused (a definite word); `unknown`: the act MAY have run. Two kinds, two inks. */
type Note = { readonly kind: 'refused' | 'unknown'; readonly text: string };

/** One act of a class card: its visible word, an accessible name that names the class, and the busy mark while its own
 *  act is with the box (`aria-busy`). Written once, so Hold, Release and Revert are one control. */
function ModelsAct({ label, name, disabled, busy, onTap }: {
  label: string; name: string; disabled: boolean; busy: boolean; onTap: () => void;
}): ReactNode {
  return (
    <Button variant="ghost" size="fit" className="acct-models-act" disabled={disabled} aria-busy={busy ? true : undefined} aria-label={name} onClick={onTap}>
      {label}
    </Button>
  );
}

const defaultAct: ModelsActFn = (lane, body) => api.laneModelsAct(lane, body);

export function ModelsSheet({ lane, open, onClose, offline, act = defaultAct, load }: ModelsSheetProps): ReactNode {
  const [refreshKey, setRefreshKey] = useState(0);
  const [said, setSaid] = useState<Announcement | null>(null);
  // Why the newest read failed (F12), or null once one landed. A failure is announced once, here, by the shell's live region.
  const [readFailure, setReadFailure] = useState<LaneReadFailure | null>(null);
  const onRead = (outcome: LaneModelsReadOutcome): void => {
    if (outcome.ok) { setReadFailure(null); return; }
    setReadFailure(outcome.failure);
    setSaid({ kind: 'alert', text: MODELS_READ_FAILED[outcome.failure] });
  };
  const reads = useRef<LaneModelsControl | null>(null);
  // F2: a transient newest answer keeps the read the sheet shows, and its word is said beside it.
  const view = useLaneModelsView(lane, load, open, refreshKey, onRead, reads);
  const read = view.read;
  // The act's own fresh read, shown while the hook's read is still the one it replaced.
  const [fresh, setFresh] = useState<{ over: LaneModelsRead | null; read: LaneModelsRead } | null>(null);
  const readNow = useRef(read);
  readNow.current = read;
  const shown: LaneModelsRead | null = fresh !== null && fresh.over === read ? fresh.read : read;
  const shownNow = useRef(shown);
  // The read's one state sentence: a non-read answer's own words, or the transient word beside a kept good read (F2).
  // The two never show together, so they are one element.
  const stateNote: { testid: string; kind: string; text: string | null } | null =
    shown === null ? null
      : shown.kind !== 'read' ? { testid: 'models-read-state', kind: shown.kind, text: modelsReadStateWords(shown) }
        : view.transient !== null && shown === read
          ? { testid: 'models-read-transient', kind: view.transient, text: laneReadWords({ kind: view.transient }) }
          : null;
  shownNow.current = shown;

  const [busy, setBusy] = useState<ModelClass | null>(null);
  const [notes, setNotes] = useState<Partial<Record<ModelClass, Note>>>({});
  const [confirming, setConfirming] = useState<ModelClass | null>(null);
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);

  // Where the focus goes when an act settles (F11): the class's card, a stop of its own (`tabIndex={-1}`), never the body.
  const cards = useRef<Partial<Record<ModelClass, HTMLElement | null>>>({});
  const [settled, setSettled] = useState<{ cls: ModelClass; n: number } | null>(null);
  useEffect(() => {
    if (settled !== null) cards.current[settled.cls]?.focus({ preventScroll: true });
  }, [settled]);

  const mayChange = offline === null && busy === null;
  const note = (cls: ModelClass, n: Note | null): void => setNotes((all) => ({ ...all, [cls]: n ?? undefined }));
  /** Every act, whatever its outcome, ends the same way: the lane is read again (F1), and the focus goes to the card (F11). */
  const settle = (cls: ModelClass): void => {
    setRefreshKey((k) => k + 1);
    setSettled((was) => ({ cls, n: (was?.n ?? 0) + 1 }));
  };

  const run = async (action: ModelsAction, cls: ModelClass): Promise<void> => {
    if (!mayChange) return;
    setBusy(cls);
    note(cls, null);
    let raw: unknown;
    try {
      raw = await act(lane, { action, class: cls });
    } catch (e) {
      if (!live.current) return;
      setBusy(null);
      const f = modelsActFailure(e, lane, cls);
      note(cls, { kind: f.outcome === 'unknown' ? 'unknown' : 'refused', text: f.text });
      setSaid({ kind: 'alert', text: f.text });
      settle(cls);
      return;
    }
    // A 200: no read issued before it may land now (F2). The read asked for in `settle` is issued after this.
    reads.current?.supersede();
    const answer = asLaneModelsActAnswer(raw);
    const mine = answer !== null && answer.lane === lane && answer.action === action && answer.class === cls ? answer : null;
    // Even when the sheet is gone by now, the answer is the newest state of the lane: the screen cache keeps it (F6), unless
    // its read is transient (R3b fix round 1, F2: nothing ran). Then the lane's cache entry goes (fix round 2, N4): it
    // predates the act, so another surface reads the lane fresh rather than seed from it. The sheet still shows that
    // transient read in place, for the same reason, and then reads the lane again.
    if (mine !== null) {
      if (mine.models.kind === 'busy' || mine.models.kind === 'not-started') forget(laneModelsKey(lane));
      else put(laneModelsKey(lane), raw, Date.now());
    }
    if (!live.current) return;
    setBusy(null);
    if (mine === null) {
      const text = actUnreadableWords(cls);
      note(cls, { kind: 'unknown', text });
      setSaid({ kind: 'alert', text });
      settle(cls);
      return;
    }
    // The server's own read after the act, shown at once; the read asked for below (begun after it) replaces it.
    setFresh({ over: readNow.current, read: mine.models });
    setSaid({ kind: 'status', text: actDoneWords(mine) });
    settle(cls);
  };

  const advance = shown?.kind === 'read' ? shown.advance : undefined;
  const words = advanceStateWords(advance);

  // The Revert confirm stands only while the CURRENT read still offers the revert: otherwise it closes, and says so (F13).
  useEffect(() => {
    if (confirming === null || revertStillOffered(shown, confirming)) return;
    const cls = confirming;
    setConfirming(null);
    setSaid({ kind: 'alert', text: revertWithdrawnWords(cls) });
  }, [confirming, shown]);
  const confirmRead = confirming !== null && shown?.kind === 'read' && revertStillOffered(shown, confirming) ? shown : null;
  const confirmPrevious = confirmRead !== null && confirming !== null ? confirmRead.advance?.classes?.[confirming]?.previous ?? null : null;
  /** The confirm's yes: re-checked on the read as it is NOW, and never sent for a class that no longer offers it. */
  const confirmRevert = (cls: ModelClass): void => {
    if (!revertStillOffered(shownNow.current, cls)) { setSaid({ kind: 'alert', text: revertWithdrawnWords(cls) }); return; }
    void run('revert', cls);
  };

  return (
    <AccountSheet
      open={open} onClose={onClose} title={MODELS_SHEET_TITLE} eyebrow={lane} frame="models" said={said} offline={offline}
      testIds="models" className="acct-models"
    >
      {readFailure !== null && (
        <div className="acct-models-note acct-models-failed" data-testid="models-read-failed" data-failure={readFailure}>
          <p>{MODELS_READ_FAILED[readFailure]}</p>
          <Button variant="ghost" size="fit" className="acct-models-act" onClick={() => { setReadFailure(null); setRefreshKey((k) => k + 1); }}>
            {MODELS_RETRY}
          </Button>
        </div>
      )}
      {shown === null && readFailure === null && <Skeleton lines={4} />}
      {stateNote !== null && (
        <p className="acct-models-note" data-testid={stateNote.testid} data-kind={stateNote.kind}>{stateNote.text}</p>
      )}
      {shown !== null && shown.kind !== 'read' && shown.kind !== 'absent' && (
        <ul className="acct-models-names">
          {CLASSES.map((cls) => <li key={cls} data-testid={`models-name-${cls}`}>{classLabel(cls)}</li>)}
        </ul>
      )}
      {shown !== null && shown.kind === 'read' && (
        <>
          <p className="acct-models-note" data-testid="models-advance" data-state={words.state}>{words.text}</p>
          {advance?.pending != null && <p className="acct-models-note" data-testid="models-pending">{pendingWords(advance.pending)}</p>}
          <div className="acct-models-list">
            {CLASSES.map((cls) => {
              const c = shown.classes[cls];
              const { adv, held, hold, revert } = classActs(advance, cls);
              const mine = busy === cls;
              const n = notes[cls];
              return (
                <section
                  key={cls} ref={(el) => { cards.current[cls] = el; }} tabIndex={-1} className="acct-models-class" role="group"
                  aria-label={classLabel(cls)} data-testid={`models-class-${cls}`} data-held={adv === null ? undefined : String(held)}
                >
                  <h3 className="acct-models-name">{classLabel(cls)}</h3>
                  <p className="acct-models-model">{modelLine(c.model, c.label)}</p>
                  {adv !== null && (
                    <div className="acct-models-facts">
                      <p>{familyWords(adv.family)}</p>
                      <p>{holdWords(adv.hold)}</p>
                      <p>{lastMoveWords(adv.lastMove)}</p>
                      {previousWords(adv.previous) !== null && <p>{previousWords(adv.previous)}</p>}
                    </div>
                  )}
                  {(hold !== null || revert) && (
                    <div className="acct-models-acts">
                      {hold !== null && (
                        <ModelsAct
                          label={hold === 'release' ? 'Release' : 'Hold'} name={holdAriaLabel(hold, cls)} disabled={!mayChange} busy={mine}
                          onTap={() => { void run(hold, cls); }}
                        />
                      )}
                      {revert && (
                        <ModelsAct
                          label="Revert" name={revertAriaLabel(cls)} disabled={!mayChange} busy={mine} onTap={() => setConfirming(cls)}
                        />
                      )}
                    </div>
                  )}
                  {/* The note is text; the shell's live region announces it once (F11). */}
                  {n !== undefined && <p className={`acct-models-refusal acct-models-refusal--${n.kind}`} data-testid={`models-note-${cls}`} data-kind={n.kind}>{n.text}</p>}
                </section>
              );
            })}
          </div>
        </>
      )}
      {confirming !== null && confirmRead !== null && confirmPrevious !== null && (
        <QuickConfirm
          open
          onClose={() => setConfirming(null)}
          title={revertTitle(confirming)}
          consequence={revertConsequence(lane, confirming, confirmRead.classes[confirming].model, confirmPrevious)}
          confirmLabel={MODELS_REVERT_CONFIRM}
          onConfirm={() => confirmRevert(confirming)}
        />
      )}
    </AccountSheet>
  );
}
