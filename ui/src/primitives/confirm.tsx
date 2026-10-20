// QuickConfirm — the confirm-with-consequence-sentence sheet used by the
// release, forget and move-account flows. The consequence line does the explaining in plain
// language; confirming closes the sheet (callers surface progress/failure via
// toast). Cancel and scrim both just close.
//
// `consequence` is one line or several: a list renders one paragraph per line,
// in order, so the stall watch's sheet, built from the server's write effect,
// says each thing the write turns on or off on its own line (spec 2026-10-05
// §13, `confirm-on-stage-diff` (D-4034)). Every string caller is unchanged.
// Each line is its own `QC_CONSEQUENCE` paragraph, margin included — the
// spacing the one-line sheet always had, once per line.
//
// `qc-consequence` and `qc-actions` are structural hooks, not styling — see
// button.tsx's note. Callers and tests reach the confirm button through
// `.qc-actions .btn-primary` (`.btn-danger` under `tone="danger"`), because
// the opener button behind the sheet matches the same role and name.
import { useMemo, useRef } from 'react';
import type { ReactNode, RefObject } from 'react';
import { Button } from './button';
import { Sheet } from './sheet';

/** The consequence sentence, and the row of answers under it.
 *
 *  TWO CONSTANTS, TWELVE CALL SITES. The markup census counted the
 *  consequence string at SEVEN and the actions row at FIVE — and one of each
 *  was right here, in the component the other eleven were copying. Four app
 *  sheets (`AbandonSheet`, `ArchiveConflictSheet`, `ResumeSheet`,
 *  `UpdateMoveSheet`) could not use `QuickConfirm` itself, because each needs
 *  a busy state, a disabled pair or extra content above the row — so each
 *  copied its INNARDS instead, hook class and utilities together.
 *
 *  That is the failure this names. The hooks were already shared; what was
 *  copied is the composition around them, which no stylesheet guard can see
 *  because it is not in a stylesheet.
 *
 *  `ArchiveSheet` and `UpdateMoveSheet` are call sites too. They once wrote
 *  `qc-consequence` and `qc-actions` bare, on the belief that the body's grid
 *  supplied the look; it did not. Main styled both classes in a stylesheet this
 *  package deleted, so bare hooks rendered unstyled (ink colour, no margin,
 *  buttons touching), caught by the takeover's per-width visual check. Both
 *  hooks are in `design-system-boundary`'s OWNED list now. */
export const QC_CONSEQUENCE = 'qc-consequence mb-5 text-base leading-normal text-ink-secondary';
/** The row of answers goes in the `Sheet`'s `footer`, never in its children, so it is pinned (D-5932). */
export const QC_ACTIONS = 'qc-actions grid gap-2';

/** Cancel first (D-5507, settings spec §6.3): while `on`, a confirm opens with its Cancel focused, so an Enter or a
 *  Space pressed out of habit answers "no". The caller puts the returned ref on its Cancel AND passes it to its
 *  `Sheet` as `initialFocus`.
 *
 *  THIS HOOK ONLY CHOOSES (D-5931). The Sheet owns the focus: it moves it to `initialFocus` when the panel mounts and
 *  when a reopen reuses the closing panel (D-5610's two measured paths, `quick-confirm-focus.test.tsx`), every time
 *  with `preventScroll`, and it gives the focus back to the opener on close. What is left here is the choice of
 *  Cancel: the ref reads Cancel only while the confirm is `open` and `on`, and nothing otherwise, so the Sheet falls
 *  back to its panel. */
export function useCancelFirst<T extends HTMLElement = HTMLButtonElement>(open: boolean, on: boolean): RefObject<T | null> {
  const cancel = useRef<T | null>(null);
  const chosen = useRef(false);
  chosen.current = open && on;
  // React writes the element through `current`; the Sheet reads it back through the same field.
  return useMemo<RefObject<T | null>>(() => ({
    get current(): T | null { return chosen.current ? cancel.current : null; },
    set current(el: T | null) { cancel.current = el; },
  }), []);
}

export interface QuickConfirmProps {
  title: string;
  consequence: string | string[];
  confirmLabel: string;
  onConfirm: () => void;
  open: boolean;
  onClose: () => void;
  /** What the confirm does (D-5099). `commit` (the default) is the phosphor
   *  `primary`; `danger` is the filled red `danger` button, for a confirm that
   *  destroys something (the fleet host's reboot, Archive all). Cancel is the
   *  ghost either way. A caller reaching the confirm by its hook class reads
   *  `.qc-actions .btn-danger` under `danger`. */
  tone?: 'commit' | 'danger';
  /** Which answer holds the focus when the sheet opens (D-5507). `confirm`, the default, leaves it to the Sheet, which
   *  focuses its panel, so no answer is pre-selected (D-5931). `cancel` focuses Cancel (`useCancelFirst`): a danger
   *  confirm answered by habit answers no. Either way closing returns the focus to the opener (the Sheet's). */
  defaultFocus?: 'confirm' | 'cancel';
}

export function QuickConfirm({
  title,
  consequence,
  confirmLabel,
  onConfirm,
  open,
  onClose,
  tone = 'commit',
  defaultFocus = 'confirm',
}: QuickConfirmProps): ReactNode {
  const cancelFirst = defaultFocus === 'cancel';
  const cancelRef = useCancelFirst(open, cancelFirst);
  const lines = typeof consequence === 'string' ? [consequence] : consequence;
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      initialFocus={cancelRef}
      // The answers are pinned in the Sheet's footer (D-5932): a long consequence scrolls, they stay.
      footer={
        <div className={QC_ACTIONS}>
          <Button
            variant={tone === 'danger' ? 'danger' : 'primary'}
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            {confirmLabel}
          </Button>
          <Button ref={cancelRef} variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
      }
    >
      {lines.map((line, i) => (
        <p key={i} className={QC_CONSEQUENCE}>
          {line}
        </p>
      ))}
    </Sheet>
  );
}
