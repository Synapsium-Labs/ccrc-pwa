// The shared tail's word for a PROVEN refusal (child reclamation wave 7, spec
// §5.6), end to end on ws-reclaim. `_ws_reclaim_owned` is the tail's
// removal-time re-ask, and on a RESUMED arm it is the only identity check there
// is. When it PROVES the tree at the workdir is not only the child's own, the
// tail prints and journals `containment-refuted`. When the question could not be
// asked, the word stays `worktree-remove-failed`. Either way the tail stops where
// it always stopped: after the unit and the pane, before the settle, with the
// tombstone and the breadcrumb standing and nothing further deleted. A retry
// meets the same thing, and once the other row is gone it completes. What stands
// on disk is asserted first, then the word.
// FIXTURE HOME ONLY (`makePrHarness`): the unit and the pane are stubbed
// (`CHILD_STUBS`); every repository, row and leaf is under the HOME.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { WS_ADD } from './ccdWsHelpers.js';
import { eventsOf } from './lifecycleHelpers.js';
import { CHILD_BRANCH, CHILD_ID, childReclaimVerb, evalOf, makeChild, type Child } from './childReclaimFixture.js';
import { verbHelpers } from './childReclaimVerbHelpers.js';
import {
  FAMILIES, assertRefuted, assertUnproven, seam, seamRan, type Run, type Target,
} from './containmentRefutedFamilies.js';

let h: PrHarness;
let restore: [string, number][] = [];
beforeEach(() => { h = makePrHarness('ccrc-reclaim-refuted-'); restore = []; });
afterEach(() => {
  for (const [p, m] of restore.reverse()) { try { fs.chmodSync(p, m); } catch { /* gone */ } }
  h.cleanup();
});
const ROOT_USER = process.getuid?.() === 0;
const WAIT = 'CCD_RECLAIM_TMPROOT_WAIT_S=2;';
const { interrupted, resumeToken } = verbHelpers(() => h);
const T = (c: Child): Target => ({ act: 'reclaim', id: CHILD_ID, wt: c.wt, main: c.main, branch: CHILD_BRANCH });
/** A reclaim interrupted after its pin, its breadcrumb at `worktree`; the resume token, minted before any shape. */
const resumed = (c: Child): string => { interrupted(c, 'worktree'); return resumeToken('worktree'); };
const foreignTree = (): string => {
  h.makeGhRepo('demo2', 'o/r2');
  h.sh(`${WS_ADD} CCD_WS_SLUG=still-harbor cmd_ws_add demo2`);
  return path.join(h.home, 'worktrees', 'demo2', 'still-harbor');
};

describe('a PROVEN refusal is containment-refuted — ws-reclaim, resumed at `worktree` (spec §5.6)', () => {
  for (const fam of FAMILIES) {
    it(fam.name, () => {
      const c = makeChild(h);
      const shape = fam.make(h, T(c));
      const tok = resumed(c);
      h.sh(shape.plant);
      assertRefuted(h, childReclaimVerb(h, tok, { pre: WAIT }), T(c), shape, 'worktree');
    }, 120_000);
  }
});

describe('the fresh arm, and the retry', () => {
  it('SHARED, planted inside the tail’s first act after the ladder passed: containment-refuted, the fresh breadcrumb kept', () => {
    const c = makeChild(h);
    const shape = FAMILIES[0]!.make(h, T(c));
    const tok = evalOf(h).token;
    expect(tok, 'the CONTROL: without the row the ladder passes').toMatch(/^[0-9a-f]{64}$/);
    const r = childReclaimVerb(h, tok, { pre: WAIT + seam(shape.plant) });
    expect(seamRan(h), 'the CONTROL: the shape was planted inside the tail').toBe(true);
    assertRefuted(h, r, T(c), shape, 'children');
  }, 120_000);

  it('a retry meets the same refutation; once the other row is gone the next attempt resumes from the breadcrumb and completes', () => {
    const c = makeChild(h);
    const shape = FAMILIES[0]!.make(h, T(c));
    interrupted(c, 'worktree');
    h.sh(shape.plant);
    assertRefuted(h, childReclaimVerb(h, resumeToken('worktree'), { pre: WAIT }), T(c), shape, 'worktree');
    assertRefuted(h, childReclaimVerb(h, resumeToken('worktree'), { pre: WAIT }), T(c), shape, 'worktree');
    expect(eventsOf(h.home, 'reclaim').filter((e) => e['refusal'] === 'containment-refuted'),
      'one journal row per attempt').toHaveLength(2);
    for (const f of ['demo-twin.uuid', 'demo-twin.workdir']) fs.rmSync(path.join(h.home, '.cc-sessions', f));
    const r = childReclaimVerb(h, resumeToken('worktree'), { pre: WAIT });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect((JSON.parse(r.stdout) as Record<string, unknown>)['reclaimed']).toBe(CHILD_ID);
    expect(fs.existsSync(c.wt), 'the tree went, once it was the child’s own alone').toBe(false);
  }, 180_000);
});

describe('what could not be asked stays worktree-remove-failed — ws-reclaim, resumed at `worktree`', () => {
  it('the workdir’s absence cannot be proven (its parent cannot be searched)', (ctx) => {
    if (ROOT_USER) { ctx.skip(); return; }
    const c = makeChild(h);
    const tok = resumed(c);
    const demo = path.join(h.home, 'worktrees', 'demo');
    let r: Run;
    fs.chmodSync(demo, 0o000);
    try { r = childReclaimVerb(h, tok, { pre: WAIT }); } finally { fs.chmodSync(demo, 0o755); }
    assertUnproven(h, r, T(c), `${demo} cannot be searched`, 'worktree');
  }, 120_000);

  it('git’s worktree list cannot be read', () => {
    const c = makeChild(h);
    const tok = resumed(c);
    const r = childReclaimVerb(h, tok,
      { pre: `${WAIT} git() { case "$*" in *"worktree list"*) return 128 ;; esac; command git "$@"; };` });
    assertUnproven(h, r, T(c), `could not read ${c.main}'s worktree list`, 'worktree');
  }, 120_000);

  it('a tree that stands with no worktree record', () => {
    const c = makeChild(h);
    const tok = resumed(c);
    fs.rmSync(path.join(c.main, '.git', 'worktrees', 'quiet-basin'), { recursive: true, force: true });
    assertUnproven(h, childReclaimVerb(h, tok, { pre: WAIT }), T(c), `${c.main} has no worktree record for the tree at ${c.wt}`, 'worktree');
  }, 120_000);

  it('another row that cannot be placed', () => {
    const c = makeChild(h);
    const tok = resumed(c);
    fs.writeFileSync(path.join(h.home, '.cc-sessions', 'demo-nested.uuid'), 'u-nested');
    fs.writeFileSync(path.join(h.home, '.cc-sessions', 'demo-nested.workdir'), 'quiet-basin/server');
    assertUnproven(h, childReclaimVerb(h, tok, { pre: WAIT }), T(c), 'registry row(s) demo-nested name no plain absolute workdir', 'worktree');
  }, 120_000);

  it('a child that cannot be scanned for a gone row’s moved tree', (ctx) => {
    if (ROOT_USER) { ctx.skip(); return; }
    const c = makeChild(h);
    const wt2 = foreignTree();
    const tok = resumed(c);
    fs.rmSync(wt2, { recursive: true, force: true });
    const s = path.join(c.wt, 'shut');
    fs.mkdirSync(s);
    fs.chmodSync(s, 0o000);
    restore.push([s, 0o755]);
    assertUnproven(h, childReclaimVerb(h, tok, { pre: WAIT }), T(c), `could not scan ${c.wt} for a gone row's moved tree`, 'worktree');
  }, 120_000);

  it('a nested checkout whose git directory cannot be read — never folded into a proof', () => {
    const c = makeChild(h);
    const wt2 = foreignTree();
    const tok = resumed(c);
    fs.rmSync(wt2, { recursive: true, force: true });
    fs.mkdirSync(path.join(c.wt, 'bogus'));
    fs.writeFileSync(path.join(c.wt, 'bogus', '.git'), 'gitdir: /nowhere\n');
    assertUnproven(h, childReclaimVerb(h, tok, { pre: WAIT }), T(c), 'could not read the git directory of the checkout at', 'worktree');
  }, 120_000);
});
