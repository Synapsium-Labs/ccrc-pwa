// D-7865 (#1565): the orphan-worktree beat hands the disk alarm's held block to the sweep as its pressure mode, reading
// it on every pass. The beat is built over a fake port set; an empty census writes no row. A source pin on watch.ts,
// built on the scan parser, holds that the construction passes the block as its last argument.
import { describe, it, expect } from 'vitest';
import { OrphanTreeBeat } from '../src/orphanTreeBeat.js';
import { ORPHAN_CENSUS_PRESSURE_MS } from '../src/orphanTreeLane.js';
import { parsedFile } from './scan/symbols.js';

type Block = { pressure: boolean } | null;
type Deps = ReturnType<ConstructorParameters<typeof OrphanTreeBeat>[0]>;

function harness(initial: Block) {
  let mono = 1_000_000;
  let block: Block = initial;
  let censuses = 0;
  const deps = {
    coord: {},
    cfg: { registryDir: '/reg' },
    io: { readdirMeasured: async () => ({ ok: true, entries: [] }) },
    fleetState: { ccdVerbs: ['orphan-v1', 'reclaim-pause-v1', 'actor-flags-v1'] },
    queue: { run: (_k: string, fn: () => unknown) => fn() },
    fleetIdentity: undefined,
    runCcd: async (argv: readonly string[]) => {
      if (argv[0] === 'ws-audit' && argv.includes('--orphans')) {
        censuses += 1;
        return { ran: true, ok: true, stdout: JSON.stringify({ mode: 'orphans', truncated: false, rows: [] }), stderr: '', killed: false, signal: null };
      }
      throw new Error(`unexpected ccd call ${argv.join(' ')}`);
    },
  } as unknown as Deps;
  const beat = new OrphanTreeBeat(() => deps, () => mono, () => block);
  return { beat, censuses: () => censuses, advance: (ms: number) => { mono += ms; }, set: (b: Block) => { block = b; } };
}

describe('the orphan-tree beat and the disk alarm', () => {
  it("the beat hands the disk alarm's pressure to the sweep", async () => {
    for (const [block, want] of [[{ pressure: true }, 2], [{ pressure: false }, 1], [null, 1]] as const) {
      const h = harness(block);
      await h.beat.pass(); h.advance(ORPHAN_CENSUS_PRESSURE_MS); await h.beat.pass();
      expect(h.censuses(), JSON.stringify(block)).toBe(want);
    }
  });

  it('the beat reads the block on every pass, not once', async () => {
    const h = harness({ pressure: false });
    await h.beat.pass();
    expect(h.censuses()).toBe(1);
    h.set({ pressure: true }); h.advance(ORPHAN_CENSUS_PRESSURE_MS); await h.beat.pass();
    expect(h.censuses()).toBe(2);
  });

  it("watch.ts builds the beat with the disk alarm's block", () => {
    const p = parsedFile('server/src/watch.ts');
    const at = p.text.indexOf('new OrphanTreeBeat(');
    expect(at, 'one construction').toBeGreaterThan(-1);
    expect(p.text.indexOf('new OrphanTreeBeat(', at + 1), 'only one construction').toBe(-1);
    const end = p.text.indexOf(';', at);
    const block = p.calls.find((c) => c.start > at && c.end < end && c.callee === 'this.diskAlarm.block');
    expect(block, 'the third thunk calls this.diskAlarm.block()').toBeDefined();
    expect(p.text.slice(block!.end, end).replace(/\s/g, ''), 'it is the last argument').toBe(')');
  });
});
