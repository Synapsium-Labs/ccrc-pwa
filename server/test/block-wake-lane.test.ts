// D-8126 wave A6 (coordinator-autonomy-default plan, Task A6-5, P7): one pass of the block-wake lane
// (`coord/blockWakeLane.ts`), on a real store. The sweep-level cases are in `stall-sweep.test.ts` ("block wakes"); these
// pin the pass's own two rules that the sweep cannot see: a lost compare-and-set sends no mail, and the not-ok memory
// keeps only the blocks the pass still judges.
import { describe, it, expect, afterEach, vi } from 'vitest';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { blockWakesPass, type BlockWakeDeps } from '../src/coord/blockWakeLane.js';
import type { NewCall } from '../src/coord/coordCalls.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

afterEach(removeTmpFixtures);

const NOW = 1_800_000_000_000;
const store = (): CoordStore => new CoordStore(openCoordDb(path.join(mkTmp('ccrc-block-wake-lane-'), '.ccrc', 'coord.db')));
const block = (wakeOn: string): NewCall => ({
  class: 'block', runId: null, question: null, options: null, chosen: 'resume the build', why: 'parked', reversible: true,
  wakeOn: wakeOn as NewCall['wakeOn'],
});
const deps = (s: CoordStore, o: Partial<BlockWakeDeps> = {}): BlockWakeDeps => ({
  coord: s, now: NOW, diskLevel: () => 'unmeasured', memoryLevel: () => 'unmeasured', build: 'b1',
  readMark: async () => ({ ok: false, reason: 'absent' }) as never, notOkSeen: new Set(), warn: () => {}, ...o,
});
const wakeMail = (s: CoordStore): string[] =>
  (s.db.prepare("SELECT subject FROM mail WHERE subject LIKE 'wake:%'").all() as unknown as { subject: string }[]).map((r) => r.subject);

describe('blockWakesPass', () => {
  it('a due time block is woken once and mailed once', async () => {
    const s = store();
    const id = s.insertCall('prog-a', 'coord-a', block(`time:${NOW - 1}`), 'b1', NOW - 60_000);
    await blockWakesPass(deps(s));
    expect(wakeMail(s)).toEqual([`wake: call ${id} (time:${NOW - 1})`]);
    await blockWakesPass(deps(s, { now: NOW + 60_000 }));
    expect(wakeMail(s)).toHaveLength(1);
  });

  it('a compare-and-set another pass won sends no mail, though the row was read unwoken', async () => {
    const s = store();
    s.insertCall('prog-a', 'coord-a', block(`time:${NOW - 1}`), 'b1', NOW - 60_000);
    vi.spyOn(s, 'markBlockWoken').mockReturnValue(false);
    await blockWakesPass(deps(s));
    expect(wakeMail(s)).toEqual([]);
  });

  it('the not-ok memory keeps a block it judged and drops one it no longer judges', async () => {
    const s = store();
    const id = s.insertCall('prog-a', 'coord-a', block('disk'), 'b1', NOW - 60_000);
    const notOkSeen = new Set<string>(['999999']);
    await blockWakesPass(deps(s, { diskLevel: () => 'critical', notOkSeen }));
    expect([...notOkSeen]).toEqual([String(id)]);
    await blockWakesPass(deps(s, { diskLevel: () => 'ok', notOkSeen }));
    expect(wakeMail(s)).toEqual([`wake: call ${id} (disk)`]);
    await blockWakesPass(deps(s, { notOkSeen }));
    expect([...notOkSeen]).toEqual([]);
  });
});
