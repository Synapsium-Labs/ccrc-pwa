// Type-level suite for Sheet's props. Runs inside `vitest run` — vite.config's
// test.typecheck is enabled, so a widening that only exists in the type system
// still has a red test to break, not just a `tsc --noEmit` a reader might skip.
import { expectTypeOf, test } from 'vitest';
import type { ReactElement } from 'react';
import { Sheet, type SheetProps } from '../src/components/Sheet';

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
