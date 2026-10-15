// Child reclamation wave 9 (spec §5.9, §5.10): the kept-leaf sentences stay true whether the temp-root collector is
// shadowed, armed, paused, or absent on a box whose ccd cannot collect, each half written only when that half was
// kept; the yield carries the clips clause a winning item quotes; and L0's `runId` sentence, as Task 1 rewrote it
// (attention-runid-sentence-misses-leaf-arms), names the evidence of every arm: its three lines are pinned verbatim.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { reviveMeas } from '../src/coord/journalparse.js';
import {
  childReclaimLeafKept, childReclaimLeafKeptManySentence, childReclaimLeafKeptSentence,
  type ChildReclaimLeafSourceRow,
} from '../src/childReclaimSweep.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel: string): string => readFileSync(path.join(ROOT, rel), 'utf8');
const NOW = 1_790_000_000_000;
const HORIZON = 'This line ends when the id is used for a new workspace, or 7 days after ccd recorded the reclaim; '
  + 'the feed keeps the record.';
const CLIPS_HALF = 'ccrc never removes the clips directory; a person removes it once nothing still uses it.';
const TMP_HALF = 'ccrc’s temp-root collector removes the temp root once it has stood idle, but only while the '
  + 'collector is switched on, the fleet box’s ccd can collect and cleanup is not paused, and only if ccrc recorded '
  + 'handing that directory out; until then, or if the collector lists it for you, a person removes it once nothing '
  + 'still uses it. The temp root leaves this line once it is collected.';
const NONE = { kind: 'none-or-unreported' } as const;

let mid = 5000;
const row = (sessionId: string, meas: Record<string, unknown> | null, truncated = false): ChildReclaimLeafSourceRow => ({
  id: (mid += 1), sessionId, at: NOW - 1000, outcome: 'done', refusal: null, truncated,
  meas: meas === null ? null : reviveMeas(meas), detail: null,
});

describe('the kept-leaf sentences (spec §5.9, §5.10)', () => {
  it('each half is written only when that half was kept', () => {
    expect(childReclaimLeafKeptSentence('demo-g', { kind: 'kept', word: 'refused' }, NONE, null)).toBe(
      'The reclaim of this child completed, but ccd kept its clips directory ~/.cc-clips/demo-g (refused: its removal '
      + `helper refused it). What was kept stays on disk. ${CLIPS_HALF} ${HORIZON}`);
    expect(childReclaimLeafKeptSentence('demo-g', NONE, { kind: 'kept', word: 'in-use' }, null)).toBe(
      'The reclaim of this child completed, but ccd kept its temp root ~/.cc-tmp/demo-g (in-use: a process still used '
      + `it after the bounded wait). What was kept stays on disk. ${TMP_HALF} ${HORIZON}`);
    expect(childReclaimLeafKeptSentence('demo-g', { kind: 'kept', word: 'unmeasured' }, { kind: 'kept', word: 'refused' }, null)).toBe(
      'The reclaim of this child completed, but ccd kept its clips directory ~/.cc-clips/demo-g (unmeasured: whether it '
      + 'could be removed could not be measured) and its temp root ~/.cc-tmp/demo-g (refused: its removal helper '
      + `refused it). What was kept stays on disk. ${CLIPS_HALF} ${TMP_HALF} ${HORIZON}`);
  });

  it('the collapsed line', () => {
    expect(childReclaimLeafKeptManySentence(6)).toBe('6 reclaimed child workspaces have a clips directory or a temp '
      + 'root that ccd kept on disk. Each clips directory stays until a person removes it; each temp root stays until '
      + 'ccrc’s temp-root collector removes it, while the collector is switched on and cleanup is not paused, or until '
      + 'a person does. The feed row of each names what was kept and why. Each one leaves this line when its id is '
      + 'used for a new workspace, or 7 days after ccd recorded its reclaim.');
  });

  it('"ccrc deletes nothing more of it" is gone from the source, and so is the old collapsed clause', () => {
    const src = read('server/src/childReclaimSweep.ts');
    expect(src).not.toContain('ccrc deletes nothing more of it');
    expect(src).not.toContain('Each stays until a person removes it, and');
  });

  it('childReclaimLeafKept yields the clips clause: the clips part when kept, the unknown clause on a cut line, else null', () => {
    const got = childReclaimLeafKept({ rows: [
      row('demo-k', { childOf: '41', clipsKept: 'refused' }),
      row('demo-t', { childOf: '41', tmpRootKept: 'in-use' }),
      row('demo-x', null, true),
    ], ends: new Map(), nowMs: NOW });
    expect(got.map((k) => [k.item.sessionId, k.clipsClause])).toEqual([
      ['demo-k', 'its clips directory ~/.cc-clips/demo-k (refused: its removal helper refused it)'],
      ['demo-t', null],
      ['demo-x', 'whether its clips directory ~/.cc-clips/demo-x was kept is not known'],
    ]);
    expect(got[0]!.item.sentence, 'the clause is the sentence’s own words').toContain(got[0]!.clipsClause);
  });
});

describe('L0’s runId sentence names every arm’s evidence (Task 1’s three lines, verbatim)', () => {
  it('the marker’s run, meas.childOf on leaf-kept, collect.witness.run on collect; a box-wide line has none', () => {
    const api = read('shared/api.ts');
    expect(api).toContain("switch. `runId` is the run the item's own evidence names, else null: the registry marker's minting run on");
    expect(api).toContain("`terminal`, `failing`, `stuck` and `kept` (never null on `kept`), the journal line's `meas.childOf` on");
    expect(api).toContain("`leaf-kept`, and the collect audit's `collect.witness.run` on `collect`; a box-wide `collect` line has none.");
    expect(api).not.toContain('switch. `runId` is the minting run the registry marker names, or null when');
  });
});
