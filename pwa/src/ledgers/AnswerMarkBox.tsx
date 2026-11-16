// Overlord W1, answer marks (spec 2026-11-09 §9.2.1, C70; plan w1-delegation-marks.md Task 4): the operator's two boxes on a
// question of Waiting on you, "The Overlord could answer this" and "I'm not sure of my answer", and the one box on a task,
// "The Overlord could handle this" (answer marks C, #2900). Ring L4, context Coordination: it draws and acts; every word and
// every rule of what a box shows is `answerMarkWords.ts`'s (L1).
//
// WHY A MARK IS OPTIMISTIC WHILE A SWITCH IS NOT (F14). A switch arms behaviour on the box, so the console shows only what the
// server measured. A mark grants nothing and is never an answer, and the door answers each tap with the mark's new value in the
// same call: so the box shows the operator's tap at once (pending, disabled so a second tap waits), keeps the door's answer
// as `settled` when the call resolves, and rolls back to the server's value on any refusal or failure, with the reason beside
// it. The one settle rule (`settledMark`) decides what shows after that: the newer of `settled` and the view's mark.
import { useEffect, useState, type ReactNode } from 'react';
import { ANSWER_MARK_NAMES, type AnswerMarkKind, type AnswerMarkName, type AnswerMarkView } from '../../../shared/answerMarks';
import { api } from '../lib/api';
import { apiErrorText, LEDGER_REFUSAL_TEXT, refusalText } from '../lib/refusalWords';
import { pageStorage, readKey, writeKey, type StorageSource } from '../lib/storage';
import {
  ANSWER_MARK_EXPLAINED_KEY, ANSWER_MARK_EXPLAINER, ANSWER_MARKS_LABEL, answerMarkLabel, answerMarksOf, markOf, settledMark, shownMark,
} from './answerMarkWords';

function AnswerMarkBox({ kind, id, mark, label, view, current, onUse }: {
  kind: AnswerMarkKind; id: number; mark: AnswerMarkName; label: string; view: AnswerMarkView; current: boolean; onUse: () => void;
}): ReactNode {
  const [pending, setPending] = useState<boolean | null>(null);
  const [settled, setSettled] = useState<AnswerMarkView | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const { shown, drop } = settledMark(view, settled);
  useEffect(() => { if (drop) setSettled(null); }, [drop]);
  const box = shownMark(shown, pending, current);
  const tap = (value: boolean): void => {
    onUse();
    setRefusal(null);
    setPending(value);
    api.setAnswerMark(kind, id, mark, value).then(
      (res) => { setSettled(res.answerMark); setPending(null); },
      (err: unknown) => { setPending(null); setRefusal(refusalText(err, LEDGER_REFUSAL_TEXT) ?? apiErrorText(err)); },
    );
  };
  return (
    <span className="wl-mark" data-mark={mark} data-state={shown.state}>
      <label className="wl-mark-hit">
        <input type="checkbox" checked={box.checked} disabled={box.disabled} onChange={(e) => tap(e.currentTarget.checked)} />
        {label}
      </label>
      {box.note !== null && <span className="wl-mark-note">{box.note}</span>}
      {refusal !== null && <span className="wl-mark-refusal" role="alert">{refusal}</span>}
    </span>
  );
}

/** The boxes of one row, an item or (answer marks B) an ask the operator has: both on a question or an ask, one on a task
 *  (answer marks C), or nothing when the server cannot mark it (`answerMarksOf` answers `unsupported`). `current` is false on
 *  the device's saved copy, where every box is disabled. Its own control beside the row's button, never inside it. */
export function AnswerMarkBoxes({ item, kind = 'item', current, storage = pageStorage }: {
  item: { readonly id: number; readonly answerMarks?: unknown; readonly kind?: unknown }; kind?: AnswerMarkKind; current: boolean;
  storage?: StorageSource;
}): ReactNode {
  const [explain, setExplain] = useState(false);
  const marks = answerMarksOf(item);
  if (marks === 'unsupported') return null;
  // The first use on this device shows the explainer once; a store that cannot be read or written changes nothing else.
  const onUse = (): void => {
    if (readKey(ANSWER_MARK_EXPLAINED_KEY, storage) !== null) return;
    writeKey(ANSWER_MARK_EXPLAINED_KEY, '1', storage);
    setExplain(true);
  };
  return (
    <div className="wl-marks" role="group" aria-label={ANSWER_MARKS_LABEL} {...(kind === 'ask' ? { 'data-ask': item.id } : { 'data-item': item.id })}>
      {ANSWER_MARK_NAMES.map((m) => {
        const view = markOf(marks, m);
        return view === null ? null : (
          <AnswerMarkBox key={m} kind={kind} id={item.id} mark={m} label={answerMarkLabel(m, item.kind)} view={view} current={current} onUse={onUse} />
        );
      })}
      {explain && <p className="wl-marks-explainer" role="note">{ANSWER_MARK_EXPLAINER}</p>}
    </div>
  );
}
