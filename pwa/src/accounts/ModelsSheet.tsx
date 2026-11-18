// THE MODELS SHEET (programme model-class-advance, wave R4; plan 2026-10-15-model-class-auto-advance-codex-arm.md, Task 20
// as re-planned, D-8686, D-8690): one Codex lane's four classes as the lane's own files say them, with the advance record
// beside them, and Hold, Release and Revert for each class. Drawn in `AccountSheet`'s shell, as the re-auth and switch sheets
// are: its live region announces each answer, its offline line sits above the body.
//
// ONE READ. The sheet reads through `useLaneModels` (`lib/useLaneModels.ts`), the same hook every other surface that names a
// lane's models reads through: no second hook and no second fetch of the GET. An act's 200 carries the FRESH read, shown at
// once and kept until the hook's next landed read replaces it (the hook's reads are objects of their own, so "replaced" is an
// identity check), and put in the screen cache for the other surfaces.
//
// NON-OPTIMISTIC. A tap stands down every control (one write at a time: the fleet agent has one models gate), marks the tapped
// class's controls busy, and changes nothing else. The row moves only on the server's answer. A refusal that proves nothing ran
// leaves the row and says why beside it; an outcome that is unknown (the act MAY have run: a timeout, a lost answer, a 200 this
// build cannot read, no answer at all) says so, and the lane is read again rather than guessed.
//
// REVERT ASKS FIRST, and exists only where the box says the class can revert (`revertable`, with a read advance record).
// L4: it decides nothing about wording or refusals; every sentence and reader is `modelsSheetWords.ts`.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button, QuickConfirm, Skeleton } from '@ccrc/ui';
import { CLASSES, type LaneClassAdvance, type LaneModelsRead, type ModelClass } from '../../../shared/models';
import { put, laneModelsKey } from '../lib/screenCache';
import { api } from '../lib/api';
import { useLaneModels } from '../lib/useLaneModels';
import { AccountSheet, type Announcement } from './AccountSheet';
import {
  MODELS_READ_ABSENT, MODELS_READ_UNREADABLE, MODELS_REVERT_CONFIRM, MODELS_SHEET_TITLE, actDoneWords, actUnreadableWords,
  advanceStateWords, asLaneModelsActAnswer, classLabel, familyWords, holdAriaLabel, holdWords, lastMoveWords, modelLine,
  modelsActFailure, pendingWords, previousWords, revertAriaLabel, revertConsequence, revertTitle, type ModelsAction,
} from './modelsSheetWords';
import '../fleet/fleet.css';

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
  const read = useLaneModels(lane, load, open, refreshKey);
  // The act's own fresh read, shown while the hook's read is still the one it replaced.
  const [fresh, setFresh] = useState<{ over: LaneModelsRead | null; read: LaneModelsRead } | null>(null);
  const readNow = useRef(read);
  readNow.current = read;
  const shown: LaneModelsRead | null = fresh !== null && fresh.over === read ? fresh.read : read;

  const [busy, setBusy] = useState<ModelClass | null>(null);
  const [notes, setNotes] = useState<Partial<Record<ModelClass, Note>>>({});
  const [said, setSaid] = useState<Announcement | null>(null);
  const [confirming, setConfirming] = useState<ModelClass | null>(null);
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);

  const mayChange = offline === null && busy === null;
  const note = (cls: ModelClass, n: Note | null): void => setNotes((all) => ({ ...all, [cls]: n ?? undefined }));
  /** An act that may have run: said as such, and the lane is read again, never guessed. */
  const unknown = (cls: ModelClass, text: string): void => {
    note(cls, { kind: 'unknown', text });
    setSaid({ kind: 'alert', text });
    setRefreshKey((k) => k + 1);
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
      if (f.outcome === 'unknown') unknown(cls, f.text);
      else { note(cls, { kind: 'refused', text: f.text }); setSaid({ kind: 'alert', text: f.text }); }
      return;
    }
    if (!live.current) return;
    setBusy(null);
    const answer = asLaneModelsActAnswer(raw);
    if (answer === null || answer.lane !== lane || answer.action !== action || answer.class !== cls) {
      unknown(cls, actUnreadableWords(cls));
      return;
    }
    // The server's own read after the act, shown at once; the hook's next landed read replaces it.
    setFresh({ over: readNow.current, read: answer.models });
    put(laneModelsKey(lane), raw, Date.now());
    setSaid({ kind: 'status', text: actDoneWords(answer) });
  };

  const advance = shown?.kind === 'read' ? shown.advance : undefined;
  const words = advanceStateWords(advance);
  const confirmClass = confirming === null || shown?.kind !== 'read' ? null : confirming;

  return (
    <AccountSheet
      open={open} onClose={onClose} title={MODELS_SHEET_TITLE} eyebrow={lane} frame="models" said={said} offline={offline}
      testIds="models" className="acct-models"
    >
      {shown === null && <Skeleton lines={4} />}
      {shown !== null && shown.kind !== 'read' && (
        <p className="acct-models-note" data-testid="models-read-state">
          {shown.kind === 'absent' ? MODELS_READ_ABSENT : MODELS_READ_UNREADABLE}
        </p>
      )}
      {shown !== null && shown.kind === 'read' && (
        <>
          <p className="acct-models-note" data-testid="models-advance" data-state={words.state}>{words.text}</p>
          {advance?.pending != null && <p className="acct-models-note" data-testid="models-pending">{pendingWords(advance.pending)}</p>}
          <div className="acct-models-list">
            {CLASSES.map((cls) => {
              const c = shown.classes[cls];
              const adv: LaneClassAdvance | null = advance?.state === 'ok' ? advance.classes?.[cls] ?? null : null;
              // Hold is known only where the record read (`ok`) or stands absent (nothing is held yet); never guessed elsewhere.
              const holdKnown = adv !== null || advance?.state === 'absent';
              const held = adv?.hold != null;
              const canRevert = adv?.revertable === true;
              const mine = busy === cls;
              const n = notes[cls];
              return (
                <section
                  key={cls} className="acct-models-class" role="group" aria-label={classLabel(cls)} data-testid={`models-class-${cls}`}
                  data-held={adv === null ? undefined : String(held)}
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
                  {(holdKnown || canRevert) && (
                    <div className="acct-models-acts">
                      {holdKnown && (
                        <ModelsAct
                          label={held ? 'Release' : 'Hold'} name={holdAriaLabel(held ? 'release' : 'hold', cls)} disabled={!mayChange} busy={mine}
                          onTap={() => { void run(held ? 'release' : 'hold', cls); }}
                        />
                      )}
                      {canRevert && (
                        <ModelsAct
                          label="Revert" name={revertAriaLabel(cls)} disabled={!mayChange} busy={mine} onTap={() => setConfirming(cls)}
                        />
                      )}
                    </div>
                  )}
                  {n !== undefined && <p className="acct-models-refusal" role="alert" data-kind={n.kind}>{n.text}</p>}
                </section>
              );
            })}
          </div>
        </>
      )}
      {confirmClass !== null && shown?.kind === 'read' && (
        <QuickConfirm
          open
          onClose={() => setConfirming(null)}
          title={revertTitle(confirmClass)}
          consequence={revertConsequence(lane, confirmClass, shown.classes[confirmClass].model, shown.advance?.classes?.[confirmClass]?.previous ?? null)}
          confirmLabel={MODELS_REVERT_CONFIRM}
          onConfirm={() => { void run('revert', confirmClass); }}
        />
      )}
    </AccountSheet>
  );
}
