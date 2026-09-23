// child-reclamation wave 2, Task 5 — `childBindGate`, the ONE gate both doors
// call (spec §5.4): `POST /api/runs` naming a `sessionId`, and dispatch's
// resume arm. Non-children are untouched by all of it — a workspace with no
// marker binds exactly as today, even one that has had a PR.
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Runner } from '../src/exec.js';
import { localIO, type FleetIO } from '../src/io.js';
import { childBindGate } from '../src/coord/childBind.js';
import type { ChildSpentDeps } from '../src/coord/childSpent.js';
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

const harness = (io: FleetIO = localIO, prStateOut = `${noPrLine}\n`) => {
  const verbs: string[] = [];
  const run: Runner = async (_cmd, args) => {
    verbs.push(args[0] ?? '');
    return args[0] === 'pr-state' ? { code: 0, stdout: prStateOut, stderr: '' } : { code: 0, stdout: '', stderr: '' };
  };
  const base = testDeps(home, run);
  const deps: ChildSpentDeps = { io, cfg: base.cfg, runCcd: base.runCcd };
  return { deps, verbs };
};

describe('childBindGate', () => {
  it('a workspace with NO marker binds as today — even one that has had a PR', async () => {
    put('prnumber', '42');
    const h = harness();
    expect(await childBindGate(h.deps, ID)).toEqual({ ok: true });
    expect(h.verbs).not.toContain('pr-state');
  });

  it('a session with no registry row binds as today', async () => {
    expect(await childBindGate(harness().deps, 'demo-nobody')).toEqual({ ok: true });
  });

  it('a spent child → workspace-spent, naming the PR', async () => {
    put('child', '5'); put('prnumber', '42');
    expect(await childBindGate(harness().deps, ID)).toEqual({ ok: false, code: 'workspace-spent', pr: 42 });
  });

  it('an unspent child → ok: a research wave still hands over', async () => {
    put('child', '5');
    const h = harness();
    expect(await childBindGate(h.deps, ID)).toEqual({ ok: true });
    expect(h.verbs).toContain('pr-state');
  });

  it('an UNREADABLE marker → spent-unmeasured, never a bind', async () => {
    put('child', '5');
    expect(await childBindGate(harness(unreadableField(ID, 'child')).deps, ID))
      .toEqual({ ok: false, code: 'spent-unmeasured', detail: 'the child marker could not be read' });
  });

  it('a MALFORMED marker → spent-unmeasured', async () => {
    put('child', 'abc');
    expect(await childBindGate(harness().deps, ID))
      .toEqual({ ok: false, code: 'spent-unmeasured', detail: 'the child marker could not be read' });
  });

  it('an unmeasured verdict → spent-unmeasured, carrying its detail', async () => {
    put('child', '5'); put('prhistory', '');
    expect(await childBindGate(harness(unreadableField(ID, 'prhistory')).deps, ID))
      .toEqual({ ok: false, code: 'spent-unmeasured', detail: 'the PR ledger (.prhistory) could not be read' });
  });

  it('an UNLISTABLE registry → spent-unmeasured: it proves nothing, so it is not "no row"', async () => {
    put('child', '5');
    const unlistable: FleetIO = { ...localIO, readdir: async () => null };
    expect(await childBindGate(harness(unlistable).deps, ID))
      .toEqual({ ok: false, code: 'spent-unmeasured', detail: 'the registry could not be listed' });
  });

  it('a MARKED row the registry cannot build (a torn identity field) → spent-unmeasured, never "no row"', async () => {
    // `readSessionRecord` answers `absent` for a row `buildRecord` DROPS — an
    // identity field read back empty — exactly as for one with no `.uuid`.
    // The marker is still listed: this is a child whose evidence was not read.
    put('child', '5'); put('wrapper', '');
    expect(await childBindGate(harness().deps, ID))
      .toEqual({ ok: false, code: 'spent-unmeasured', detail: 'the child marker is listed but its registry row could not be built' });
  });

  it('…and a SECOND listing that fails there → spent-unmeasured', async () => {
    put('child', '5'); put('wrapper', '');
    // Listing 1 is `readSessionRecord`'s (a dropped row takes no reconfirm);
    // listing 2 is the gate's own look for the marker.
    let n = 0;
    const second: FleetIO = { ...localIO, readdir: async (p) => (++n === 2 ? null : localIO.readdir(p)) };
    expect(await childBindGate(harness(second).deps, ID))
      .toEqual({ ok: false, code: 'spent-unmeasured', detail: 'the registry could not be listed' });
  });

  it('an UNMARKED row the registry cannot build binds as today — non-children are untouched', async () => {
    put('wrapper', '');
    expect(await childBindGate(harness().deps, ID)).toEqual({ ok: true });
  });

  it('a marked child whose registered branch was hand-renamed (tip unmeasured) → spent-unmeasured, never a bind (D-3351)', async () => {
    put('child', '5');
    const h = harness(localIO, `${renameShapeLine}\n`);
    const v = await childBindGate(h.deps, ID);
    expect(v).toMatchObject({ ok: false, code: 'spent-unmeasured' });
    expect((v as { detail: string }).detail).toContain('tip');
  });
});
