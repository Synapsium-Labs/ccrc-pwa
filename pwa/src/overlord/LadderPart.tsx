// The ladder part of the Overlord's place (Overlord W1 home B, Task 4; plan "The ladder", H9): L4. It draws `LadderWire` as the
// store's read answers it, and EVERY CONTROL COMES FROM A ROW OF THE READ, never a list in the console: a rung button for each row
// of `rungs[]`, Clear for each row of `latches[]`. A rung above `chat` the server does not yet advertise is drawn disabled with the
// word it needs; the effective rung and each binding row; each standing latch with its cause sentence, its cap, its time and Clear;
// each condition with its reading and its effect. A cause this build does not know is drawn by its key (Clear stays). A read that
// failed says "The ladder could not be read" and draws no control; a stale one draws its last answer with "last read hh:mm".
//
// The doors are `useLadderDoors`'s (the place calls it once and hands it to this part and the readiness part). Lowering to Off or
// Chat asks no step-up; a raise and Clear go through the place's step-up. The "taking effect" line follows a rung lowered, until the
// ladder read says `done`; Clear leaves none. Refusals are said in their sentences.
//
// Class hooks for the place's one stylesheet: `ovl-ladder` (the card), `ovl-rungs` (the rung buttons' row, wraps at 320 px),
// `ovl-rung` (one rung button, 44 px), `ovl-rung-needs` (the word a disabled rung needs), `ovl-ladder-facts` (operator's and
// effective rung), `ovl-ladder-list` (bindings, latches, conditions), `ovl-ladder-row` (one row, wraps), `ovl-ladder-row-actions`
// (a latch's Clear), `ovl-note` (a status line).
import type { ReactNode } from 'react';
import { Button } from '@ccrc/ui';
import type { LadderWire } from '../../../shared/overlord-ladder';
import { useLadder } from '../stores/overlord';
import {
  LADDER_LOADING, LADDER_UNREADABLE, causeWords, conditionReadingWords, effectWords, rungControlOf, rungLabel, takingEffectLine,
} from './ladderWords';
import { clockOf } from './readinessWords';
import type { LadderDoors } from './useLadderDoors';

const has = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

function Answered({ l, doors, lastRead }: { readonly l: LadderWire; readonly doors: LadderDoors; readonly lastRead: string | null }): ReactNode {
  return (
    <>
      {lastRead !== null && <p className="ovl-note" data-ladder-stale>{lastRead}</p>}
      <p className="ovl-ladder-facts">
        <span data-operator-rung>{`Your rung: ${rungLabel(l.operatorRung)}`}</span>
        <span data-effective-rung>{`In effect: ${rungLabel(l.effectiveRung)}`}</span>
      </p>
      <div className="ovl-rungs" role="group" aria-label="Your rung">
        {l.rungs.map((row) => {
          const c = rungControlOf(row, l.operatorRung);
          return (
            <div key={c.rung} className="ovl-rung-cell">
              <Button
                variant="ghost" size="fit" className="ovl-rung" data-rung={c.rung} aria-pressed={c.current}
                disabled={c.disabled || doors.busy} onClick={() => { void doors.setRung(row.rung); }}
              >
                {c.label}
              </Button>
              {c.needs !== null && (
                <span className="ovl-rung-needs" data-rung-needs={c.rung}>{c.arrives === null ? c.needs : `${c.needs} (${c.arrives})`}</span>
              )}
            </div>
          );
        })}
      </div>
      {l.binding.length > 0 && (
        <ul className="ovl-ladder-list" aria-label="What binds the rung">
          {l.binding.map((b) => {
            const cause = causeWords(b.cause);
            return (
              <li key={`${b.kind}:${b.cause}`} className="ovl-ladder-row" data-binding={b.cause}>
                <span>{cause.text}</span>
                <span>{`caps at ${b.cap}`}</span>
                <span>{has(conditionReadingWords, b.reading) ? conditionReadingWords[b.reading] : b.reading}</span>
              </li>
            );
          })}
        </ul>
      )}
      {l.latches.length > 0 && (
        <ul className="ovl-ladder-list" aria-label="Standing latches">
          {l.latches.map((latch) => {
            const cause = causeWords(latch.cause);
            return (
              <li key={`${latch.cause}:${latch.raisedAt}`} className="ovl-ladder-row" data-latch={latch.cause} data-known={cause.known}>
                <span>{cause.text}</span>
                <span>{`caps at ${latch.cap}`}</span>
                <span>{`since ${clockOf(latch.raisedAt)}`}</span>
                {latch.detail !== '' && <span>{latch.detail}</span>}
                <span className="ovl-ladder-row-actions">
                  <Button
                    variant="ghost" size="fit" disabled={doors.busy} aria-label={`Clear ${cause.text}`}
                    onClick={() => { void doors.clear(latch.cause); }}
                  >
                    Clear
                  </Button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {l.conditions.length > 0 && (
        <ul className="ovl-ladder-list" aria-label="Conditions">
          {l.conditions.map((c) => {
            const cause = causeWords(c.cause);
            return (
              <li key={c.cause} className="ovl-ladder-row" data-condition={c.cause} data-known={cause.known}>
                <span>{cause.text}</span>
                <span>{has(conditionReadingWords, c.reading) ? conditionReadingWords[c.reading] : c.reading}</span>
                <span>{effectWords(c.effect)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

export function LadderPart({ doors }: { readonly doors: LadderDoors }): ReactNode {
  const read = useLadder();
  const line = doors.door === 'rung' ? takingEffectLine(doors.narrowing, read) : null;
  // Pause's refusal and line belong to the readiness part; the rung's and Clear's are drawn here.
  const said = doors.door === 'rung' || doors.door === 'clear' ? doors.said : null;
  return (
    <section className="ovl-ladder" data-ladder-part aria-label="Authority ladder">
      {read.state === 'loading' && <p className="ovl-note" role="status">{LADDER_LOADING}</p>}
      {(read.state === 'unmeasured' || read.state === 'absent') && (
        <p className="ovl-note" role="status" data-ladder-unreadable>{LADDER_UNREADABLE}</p>
      )}
      {(read.state === 'answered' || read.state === 'stale') && (
        <Answered l={read.value} doors={doors} lastRead={read.state === 'stale' ? `last read ${clockOf(read.at)}` : null} />
      )}
      {line !== null && <p className="ovl-note" role="status" data-taking-effect>{line}</p>}
      {said !== null && <p className="ovl-note" role="status" data-said>{said}</p>}
    </section>
  );
}
