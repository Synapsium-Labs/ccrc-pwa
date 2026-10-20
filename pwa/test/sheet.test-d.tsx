// Type-level suite for Sheet's props. Runs inside `vitest run` — vite.config's
// test.typecheck is enabled, so a widening that only exists in the type system
// still has a red test to break, not just a `tsc --noEmit` a reader might skip.
import { expectTypeOf, test } from 'vitest';
import type { ReactElement, ReactNode } from 'react';
import { Sheet, type SheetProps } from '@ccrc/ui';

test('eyebrow takes a node, so a caller can hang a chip off the kicker', () => {
  // The DialogSheet header badge: copy plus an element, not a bare string.
  expectTypeOf(
    <>
      claude is asking <span className="dlg-header-chip">Colour</span>
    </>,
  ).toExtend<SheetProps['eyebrow']>();

  // …and it still takes the plain string the seven other call sites pass.
  expectTypeOf<string>().toExtend<SheetProps['eyebrow']>();

  // The whole call site typechecks, not just the prop in isolation.
  expectTypeOf(
    <Sheet open onClose={() => {}} title="t" eyebrow={<span>chip</span>}>
      body
    </Sheet>,
  ).toExtend<ReactElement>();
});

// D-5932: the pinned footer. A sheet takes a `footer`; the `full` variant (the terminal drawer, whose glass runs to
// the safe-area line) takes none, so `full` and `footer` are exclusive in the props, not refused at runtime.
test('a sheet takes a footer', () => {
  expectTypeOf(
    <Sheet open onClose={() => {}} title="t" footer={<button type="button">Go</button>}>
      body
    </Sheet>,
  ).toExtend<ReactElement>();
  expectTypeOf<{ open: boolean; onClose: () => void; children: string; footer: ReactNode }>().toExtend<SheetProps>();
});

test('`full` with `footer` is a type error', () => {
  expectTypeOf<{ open: boolean; onClose: () => void; children: string; full: true; footer: ReactNode }>()
    .not.toExtend<SheetProps>();
  // @ts-expect-error — the full variant takes no footer.
  void (<Sheet open onClose={() => {}} full footer={<span>x</span>}>body</Sheet>);
  // `full` alone, and `full={false}` with a footer, are both still fine.
  expectTypeOf<{ open: boolean; onClose: () => void; children: string; full: true }>().toExtend<SheetProps>();
  expectTypeOf<{ open: boolean; onClose: () => void; children: string; full: false; footer: ReactNode }>()
    .toExtend<SheetProps>();
});
