// The collector's words tables are TOTAL over their unions (path-identity spec 2026-10-12 §5.7): each is typed
// `Record<Union, …>`, so a state the server learns is a compile error in collectLaneWords.ts until it has words. A
// table retyped as `Record<string, …>` would still compile and still look right at runtime, so these type pins are
// what goes red. `vite.config.ts` sets `test.typecheck.enabled`, so this file runs in `vitest run`.
import { expectTypeOf, test } from 'vitest';
import type { CollectArmedBy, CollectLaneRefusal, CollectLaneView } from '../../shared/api';
import {
  COLLECT_ARMED_BY_TEXT, COLLECT_OFF_NOTE_TEXT, COLLECT_REFUSAL_TEXT, COLLECT_STATE_TEXT, COLLECT_STORED_FAULT_TEXT,
} from '../src/fleet/collectLaneWords';

test('every words table is keyed by exactly its union', () => {
  expectTypeOf<keyof typeof COLLECT_STATE_TEXT>().toEqualTypeOf<CollectLaneView['effective']['state']>();
  expectTypeOf<keyof typeof COLLECT_ARMED_BY_TEXT>().toEqualTypeOf<CollectArmedBy>();
  expectTypeOf<keyof typeof COLLECT_REFUSAL_TEXT>().toEqualTypeOf<CollectLaneRefusal>();
  expectTypeOf<keyof typeof COLLECT_OFF_NOTE_TEXT>().toEqualTypeOf<CollectLaneView['marker']['listing']>();
  expectTypeOf<keyof typeof COLLECT_STORED_FAULT_TEXT>()
    .toEqualTypeOf<Exclude<CollectLaneView['stored'], { read: 'row' }>['read']>();
});
