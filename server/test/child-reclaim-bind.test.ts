// child-reclamation wave 2, Task 5 — `childBindGate`, the ONE gate both doors
// call (spec §5.4): `POST /api/runs` naming a `sessionId`, and dispatch's
// resume arm. Non-children are untouched by all of it — a workspace with no
// marker binds exactly as today, even one that has had a PR.
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Runner } from '../src/exec.js';
import { localIO, type FleetIO } from '../src/io.js';
import { childBindGate, type ChildBindRuns } from '../src/coord/childBind.js';
import type { ChildBirthRunRead, ChildSpentDeps } from '../src/coord/childSpent.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { unreadableField } from './ioDoubles.js';

const ID = 'demo-child';
let home: string;
let reg: string;

beforeEach(() => {
  home = mkTmp('ccrc-child-bind-');
  reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  for (const [k, v] of Object.entries({
    wrapper: 'claude', project: 'demo', workdir: `/w/${ID}`, uuid: `u-${ID}`, started: '1',
    workspace: ID, branch: `ws/${ID}`, base: 'origin/main',
  })) writeFileSync(path.join(reg, `${ID}.${k}`), v);
});
const put = (field: string, content: string): void => writeFileSync(path.join(reg, `${ID}.${field}`), content);
// `tip` is a real-looking sha, never absent — an absent/null tip is D-3351's
// own "not measured" and would answer `spent-unmeasured`, not `ok`, which
// would falsely pin every "unspent child" case below to the WRONG rung.
const noPrLine = JSON.stringify(
  { id: ID, rows: [], baseShort: 'main', branch: `ws/${ID}`, ahead: 1, tip: 'f'.repeat(40), checkedAt: 1 });
// Review 145 F1 (D-3351): the rename shape — registered branch `ws/a`, ccd's
// `--head ws/a` finds no PR and the branch itself no longer resolves.
const renameShapeLine = JSON.stringify(
  { id: ID, rows: [], baseShort: 'main', branch: 'ws/a', ahead: null, tip: null, checkedAt: 1 });

/** The minting run's row, as the gate's birth port reads it: run 5 — every
 *  fixture's `.child` — minted THIS session with a dispatch start at
 *  `BIRTH_MS`. A case that needs another answer passes its own `runs`. */
const BIRTH_MS = Date.parse('2026-09-24T12:00:00Z');
const HOUR = 3_600_000;
const iso = (ms: number): string => new Date(ms).toISOString();
const mintingRun = (answer: ChildBirthRunRead | null = null) => {
  const asked: number[] = [];
  const runs: ChildBindRuns = {
    run: (id) => {
      asked.push(id);
      if (answer !== null) return answer;
      return { ok: true, run: id === 5 ? { sessionId: ID, dispatchStartedAt: BIRTH_MS } : null };
    },
  };
  return { runs, asked };
};

const harness = (io: FleetIO = localIO, prStateOut = `${noPrLine}\n`, birth = mintingRun()) => {
  const verbs: string[] = [];
  const run: Runner = async (_cmd, args) => {
    verbs.push(args[0] ?? '');
    return args[0] === 'pr-state' ? { code: 0, stdout: prStateOut, stderr: '' } : { code: 0, stdout: '', stderr: '' };
  };
  const base = testDeps(home, run);
  const deps: ChildSpentDeps = { io, cfg: base.cfg, runCcd: base.runCcd };
  return { deps, verbs, runs: birth.runs, asked: birth.asked };
};
const gate = (h: ReturnType<typeof harness>, sessionId: string) => childBindGate(h.deps, h.runs, sessionId);

describe('childBindGate', () => {
  it('a workspace with NO marker binds as today — even one that has had a PR', async () => {
    put('prnumber', '42');
    const h = harness();
    expect(await gate(h, ID)).toEqual({ ok: true });
    expect(h.verbs).not.toContain('pr-state');
  });

  it('a session with no registry row binds as today', async () => {
    expect(await gate(harness(), 'demo-nobody')).toEqual({ ok: true });
  });

  it('a spent child → workspace-spent, naming the PR', async () => {
    put('child', '5'); put('prnumber', '42');
    expect(await gate(harness(), ID)).toEqual({ ok: false, code: 'workspace-spent', pr: 42 });
  });

  it('an unspent child → ok: a research wave still hands over', async () => {
    put('child', '5');
    const h = harness();
    expect(await gate(h, ID)).toEqual({ ok: true });
    expect(h.verbs).toContain('pr-state');
  });

  it('an UNREADABLE marker → spent-unmeasured, never a bind', async () => {
    put('child', '5');
    expect(await gate(harness(unreadableField(ID, 'child')), ID))
      .toEqual({ ok: false, code: 'spent-unmeasured', detail: 'the child marker could not be read' });
  });

  it('a MALFORMED marker → spent-unmeasured', async () => {
    put('child', 'abc');
    expect(await gate(harness(), ID))
      .toEqual({ ok: false, code: 'spent-unmeasured', detail: 'the child marker could not be read' });
  });

  it('an unmeasured verdict → spent-unmeasured, carrying its detail', async () => {
    put('child', '5'); put('prhistory', '');
    expect(await gate(harness(unreadableField(ID, 'prhistory')), ID))
      .toEqual({ ok: false, code: 'spent-unmeasured', detail: 'the PR ledger (.prhistory) could not be read' });
  });

  it('an UNLISTABLE registry → spent-unmeasured: it proves nothing, so it is not "no row"', async () => {
    put('child', '5');
    const unlistable: FleetIO = { ...localIO, readdir: async () => null };
    expect(await gate(harness(unlistable), ID))
      .toEqual({ ok: false, code: 'spent-unmeasured', detail: 'the registry could not be listed' });
  });

  it('a MARKED row the registry cannot build (a torn identity field) → spent-unmeasured, never "no row"', async () => {
    // `readSessionRecord` answers `absent` for a row `buildRecord` DROPS — an
    // identity field read back empty — exactly as for one with no `.uuid`.
    // The marker is still listed: this is a child whose evidence was not read.
    put('child', '5'); put('wrapper', '');
    expect(await gate(harness(), ID))
      .toEqual({ ok: false, code: 'spent-unmeasured', detail: 'the child marker is listed but its registry row could not be built' });
  });

  it('…and a SECOND listing that fails there → spent-unmeasured', async () => {
    put('child', '5'); put('wrapper', '');
    // Listing 1 is `readSessionRecord`'s (a dropped row takes no reconfirm);
    // listing 2 is the gate's own look for the marker.
    let n = 0;
    const second: FleetIO = { ...localIO, readdir: async (p) => (++n === 2 ? null : localIO.readdir(p)) };
    expect(await gate(harness(second), ID))
      .toEqual({ ok: false, code: 'spent-unmeasured', detail: 'the registry could not be listed' });
  });

  it('an UNMARKED row the registry cannot build binds as today — non-children are untouched', async () => {
    put('wrapper', '');
    expect(await gate(harness(), ID)).toEqual({ ok: true });
  });

  it('a marked child whose registered branch was hand-renamed (tip unmeasured) → spent-unmeasured, never a bind (D-3351)', async () => {
    put('child', '5');
    const h = harness(localIO, `${renameShapeLine}\n`);
    const v = await gate(h, ID);
    expect(v).toMatchObject({ ok: false, code: 'spent-unmeasured' });
    expect((v as { detail: string }).detail).toContain('tip');
  });
});

// Incarnation placement at the bind (child-reclamation spec §5.3; a slug is
// recycled, §5.5). The gate reads the child's BIRTH — its minting run's
// `dispatchStartedAt` — through its own port over the run row its marker
// names, and refuses on a spent answer of EITHER incarnation. Only a row
// proven to predate the birth stops counting.
describe('childBindGate — incarnation placement', () => {
  const line = (rows: Record<string, unknown>[]) => `${JSON.stringify({ id: ID, rows: rows.map((r) => ({
    number: 7, state: 'MERGED', headRefName: `ws/${ID}`, baseRefName: 'main', isCrossRepository: false,
    ours: true, isDraft: false, mergedAt: '2026-01-01T00:00:00Z', mergeCommit: { oid: 'f'.repeat(40) }, ...r,
  })), baseShort: 'main', branch: `ws/${ID}`, ahead: 1, tip: 'f'.repeat(40), checkedAt: 1 })}\n`;
  const inheritedOnly = line([{ createdAt: iso(BIRTH_MS - HOUR) }]);

  it('a child whose only PR predates its birth binds — the PR was an earlier incarnation\'s', async () => {
    put('child', '5');
    const h = harness(localIO, inheritedOnly);
    expect(await gate(h, ID)).toEqual({ ok: true });
    expect(h.asked, 'the birth is read from the run the marker names').toEqual([5]);
  });

  it('a child with a PR created after its birth → workspace-spent', async () => {
    put('child', '5');
    expect(await gate(harness(localIO, line([{ number: 9, createdAt: iso(BIRTH_MS + HOUR) }])), ID))
      .toEqual({ ok: false, code: 'workspace-spent', pr: 9 });
  });

  it('an UNPLACED child (a row with no createdAt — an older ccd) → workspace-spent, as before placement existed', async () => {
    put('child', '5');
    expect(await gate(harness(localIO, line([{}])), ID)).toEqual({ ok: false, code: 'workspace-spent', pr: 7 });
  });

  it('a pre-birth row beside a registry PR number → workspace-spent: a bind does not date the fast path', async () => {
    put('child', '5'); put('prnumber', '42');
    const h = harness(localIO, inheritedOnly);
    expect(await gate(h, ID)).toEqual({ ok: false, code: 'workspace-spent', pr: 42 });
    expect(h.verbs).not.toContain('pr-state');
  });

  // Every way the birth cannot be placed makes the same pre-birth row
  // UNPLACED — never inherited — so each one refuses.
  it.each([
    ['the minting run row is unreadable', { ok: false, detail: 'integer out of range' }],
    ['the minting run row is absent', { ok: true, run: null }],
    ['the minting run never stamped a dispatch start', { ok: true, run: { sessionId: ID, dispatchStartedAt: null } }],
    ['the minting run is bound to ANOTHER session (a retry orphan)',
      { ok: true, run: { sessionId: 'demo-retry', dispatchStartedAt: BIRTH_MS } }],
    ['the minting run is bound to no session yet', { ok: true, run: { sessionId: null, dispatchStartedAt: BIRTH_MS } }],
  ] as const)('an unplaceable birth — %s — refuses a pre-birth row: workspace-spent', async (_what, answer) => {
    put('child', '5');
    expect(await gate(harness(localIO, inheritedOnly, mintingRun(answer as ChildBirthRunRead)), ID))
      .toEqual({ ok: false, code: 'workspace-spent', pr: 7 });
  });

  it('through a real CoordStore: markDispatchStarted is the birth, and an inherited-only child binds', async () => {
    // The port is `CoordStore.run` itself, unchanged — no fake row shape.
    const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
    const opened = coord.openRun({ program: 'build4', title: 'Child reclamation', project: 'demo',
      wave: 1, waveOf: 3, claimedBy: 'demo-coordinator' });
    if (!('id' in opened)) throw new Error(`fixture run not opened: ${JSON.stringify(opened)}`);
    coord.markDispatchStarted(opened.id, BIRTH_MS);
    coord.markDispatched(opened.id, ID, ID, `ws/${ID}`, false, BIRTH_MS + 30_000);
    put('child', String(opened.id));
    const h = harness(localIO, inheritedOnly);
    expect(await childBindGate(h.deps, coord, ID)).toEqual({ ok: true });
    // …and the same child, with no dispatch start on its run, refuses.
    const bare = coord.openRun({ program: 'build5', title: 'Another', project: 'demo',
      wave: 1, waveOf: 3, claimedBy: 'demo-coordinator-2' });
    if (!('id' in bare)) throw new Error(`fixture run not opened: ${JSON.stringify(bare)}`);
    coord.markDispatched(bare.id, ID, ID, `ws/${ID}`, false, BIRTH_MS + 30_000);
    put('child', String(bare.id));
    expect(await childBindGate(h.deps, coord, ID)).toEqual({ ok: false, code: 'workspace-spent', pr: 7 });
  });
});
