// The temp-root collector's ROW RULE (child reclamation wave 7, spec §5.10):
// no registry row may lie at, inside or through the leaf it collects.
// The removal helper does not ask this, so the collector asks it itself, by
// `_ws_reclaim_workdir_shared`'s own comparisons in ONE registry pass, with the
// leaf as the workdir: every row, standing or placed by either gone-row arm,
// literally and resolved — equal, inside, or spelled through it. MEASURED: a
// stopped session's clone inside a dead child's temp root is that session's
// tree, and without this rule the collector deletes it.
//
// Every ask runs under `_ws_reclaim_contained`, as its callers ask it: the
// git-record placement runs git on other rows' repositories.
//
// FIXTURE HOMES ONLY (`makePrHarness`): every row, leaf and repository is under
// the harness's HOME. The function under test removes nothing.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { inheritedEnv } from './gitEnvStrip.js';

let h: PrHarness;
let restore: [string, number][] = [];
beforeEach(() => { h = makePrHarness('ccrc-collect-rows-'); restore = []; });
afterEach(() => {
  for (const [p, m] of restore.reverse()) { try { fs.chmodSync(p, m); } catch { /* gone */ } }
  h.cleanup();
});
const chmodFor = (p: string, mode: number): void => {
  restore.push([p, fs.statSync(p).mode & 0o7777]);
  fs.chmodSync(p, mode);
};

const ID = 'demo-quiet-mesa';             // the dead child: its row is gone, its temp root stands
const OTHER = 'demo2-calm-cove';          // another session
const ROOT_USER = process.getuid?.() === 0;
const leaf = (): string => path.join(h.home, '.cc-tmp', ID);

/** A row for `id` naming `workdir`, as `ccd start` leaves one; `project` when given. */
const row = (id: string, workdir: string, project?: string): void => {
  h.sh(`_reg_set ${id} wrapper claude
        _reg_set ${id} uuid deadbeef-0000-4000-8000-00000000000${id.length % 10}
        _reg_set ${id} workdir '${workdir}'${project ? `\n        _reg_set ${id} project ${project}` : ''}`);
};
const clear = (pre = ''): { rc: string; why: string } => {
  const [rc = '', why = ''] = h.sh(`${pre} _ws_reclaim_contained _ws_collect_rows_clear ${ID} '${leaf()}'; rc=$?; printf '%s\\x1f%s' "$rc" "$_WS_COLLECT_ROWS_WHY"`)
    .split('\x1f');
  return { rc, why };
};
/** A clone at `dest` (a `.git` DIRECTORY), of a repository outside the leaf. */
const cloneAt = (dest: string): void => {
  const origin = path.join(h.home, 'origins', 'up.git');
  if (!fs.existsSync(origin)) h.makeRepo('up');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  execFileSync('git', ['clone', '-q', origin, dest], { env: { ...inheritedEnv(), HOME: h.home } });
};

describe('_ws_collect_rows_clear — a row at, inside or through the leaf refuses: rc 1, the row named', () => {
  it('MEASURED: a STOPPED session’s clone inside the dead child’s temp root is that session’s tree', () => {
    const clone = path.join(leaf(), 'clone');
    cloneAt(clone);
    row(OTHER, clone);                     // stopped: its row stands, no pane
    const a = clear();
    expect(a.rc, a.why).toBe('1');
    expect(a.why).toContain(`inside: ${OTHER}`);
  }, 60_000);

  it('a row AT the leaf', () => {
    fs.mkdirSync(leaf(), { recursive: true });
    row(OTHER, leaf());
    const a = clear();
    expect(a.rc, a.why).toBe('1');
    expect(a.why).toContain(`at: ${OTHER}`);
  });

  it('a row spelled THROUGH the leaf, not as one plain path', () => {
    fs.mkdirSync(leaf(), { recursive: true });
    fs.mkdirSync(path.join(h.home, 'elsewhere'), { recursive: true });
    row(OTHER, `${leaf()}/../elsewhere`);
    const a = clear();
    expect(a.rc, a.why).toBe('1');
    expect(a.why).toContain(`through: ${OTHER}`);
  });

  it('a row INSIDE the leaf reached through a link — compared RESOLVED, not only as written', () => {
    fs.mkdirSync(path.join(leaf(), 'work'), { recursive: true });
    fs.symlinkSync(leaf(), path.join(h.home, 'alias'));
    row(OTHER, path.join(h.home, 'alias', 'work'));
    const a = clear();
    expect(a.rc, a.why).toBe('1');
    expect(a.why).toContain(`inside: ${OTHER}`);
  });

  it('a row inside the leaf whose directory is GONE still refuses — its spelling goes with the leaf', () => {
    fs.mkdirSync(leaf(), { recursive: true });
    row(OTHER, path.join(leaf(), 'gone-tree'));
    const a = clear();
    expect(a.rc, a.why).toBe('1');
    expect(a.why).toContain(`inside: ${OTHER}`);
  });

  it('AFTER the move (the pre-move spelling now absent), a row literally inside it still refuses', () => {
    fs.mkdirSync(path.join(leaf(), 'clone'), { recursive: true });
    row(OTHER, path.join(leaf(), 'clone'));
    fs.renameSync(leaf(), path.join(h.home, 'moved'));
    const a = clear();
    expect(a.rc, a.why).toBe('1');
    expect(a.why).toContain(`inside: ${OTHER}`);
  });

  it('the id’s OWN row refuses — a temp root whose id has a row is never collected', () => {
    fs.mkdirSync(leaf(), { recursive: true });
    row(ID, path.join(h.home, 'worktrees', 'demo', 'quiet-mesa'));
    const a = clear();
    expect(a.rc, a.why).toBe('1');
    expect(a.why).toContain(`${ID}'s own registry row stands`);
  });

  it('the id’s own `.workdir` as a DANGLING link refuses too — a link stands, whatever it names', () => {
    fs.mkdirSync(leaf(), { recursive: true });
    fs.symlinkSync(path.join(h.home, 'no-such-target'), path.join(h.home, '.cc-sessions', `${ID}.workdir`));
    const a = clear();
    expect(a.rc, a.why).toBe('1');
    expect(a.why).toContain(`${ID}'s own registry row stands`);
  });
});

describe('_ws_collect_rows_clear — the id’s clips leaf is compared too, as for a reclaim: both answers fail closed', () => {
  it('a row inside `~/.cc-clips/<id>` refuses: rc 1', () => {
    fs.mkdirSync(leaf(), { recursive: true });
    fs.mkdirSync(path.join(h.home, '.cc-clips', ID, 'sub'), { recursive: true });
    row(OTHER, path.join(h.home, '.cc-clips', ID, 'sub'));
    const a = clear();
    expect(a.rc, a.why).toBe('1');
    expect(a.why).toContain(`inside: ${OTHER}`);
  });

  it.skipIf(ROOT_USER)('a clips leaf whose absence cannot be proven is unmeasured: rc 2, never "no row"', () => {
    fs.mkdirSync(leaf(), { recursive: true });
    fs.mkdirSync(path.join(h.home, '.cc-clips'), { recursive: true });
    chmodFor(path.join(h.home, '.cc-clips'), 0o600);
    const a = clear();
    expect(a.rc, a.why).toBe('2');
    expect(a.why).toContain('cannot be measured');
  });
});

describe('_ws_collect_rows_clear — clear: rc 0', () => {
  it('no row at all, and rows elsewhere (beside the leaf, a sibling whose id has this id as a prefix)', () => {
    fs.mkdirSync(leaf(), { recursive: true });
    expect(clear().rc).toBe('0');
    fs.mkdirSync(path.join(h.home, 'worktrees', 'demo2', 'calm-cove'), { recursive: true });
    row(OTHER, path.join(h.home, 'worktrees', 'demo2', 'calm-cove'));
    fs.mkdirSync(`${leaf()}-x`, { recursive: true });
    row('demo-quiet-mesa-x', `${leaf()}-x`);
    const a = clear();
    expect(a.rc, a.why).toBe('0');
  });

  it('after the move, with nothing at or under the pre-move spelling: 0', () => {
    fs.mkdirSync(leaf(), { recursive: true });
    fs.renameSync(leaf(), path.join(h.home, 'moved'));
    expect(clear().rc).toBe('0');
  });

  it('a GONE row elsewhere that git’s own record places (the git-record placement) is placed, outside: 0', () => {
    fs.mkdirSync(leaf(), { recursive: true });
    const main = h.makeRepo('demo2');
    const wt = path.join(h.home, 'worktrees', 'demo2', 'calm-cove');
    fs.mkdirSync(path.dirname(wt), { recursive: true });
    h.git(main, 'worktree', 'add', '-q', '-b', 'ws/calm-cove', wt);
    row(OTHER, wt, 'demo2');
    fs.rmSync(wt, { recursive: true, force: true });   // gone; git's record reads prunable
    const a = clear();
    expect(a.rc, a.why).toBe('0');
  }, 60_000);
});

describe('_ws_collect_rows_clear — unmeasured: rc 2, never "no row"', () => {
  it('a GONE row elsewhere that nothing places is unmeasured', () => {
    fs.mkdirSync(leaf(), { recursive: true });
    row(OTHER, path.join(h.home, 'worktrees', 'demo2', 'never-made'));
    const a = clear();
    expect(a.rc, a.why).toBe('2');
    expect(a.why).toContain(OTHER);
  });

  it('a row that cannot be placed at all (a relative workdir) is unmeasured', () => {
    fs.mkdirSync(leaf(), { recursive: true });
    row(OTHER, 'worktrees/demo2/calm-cove');
    expect(clear().rc).toBe('2');
  });

  it.skipIf(ROOT_USER)('a registry that cannot be listed is unmeasured', () => {
    fs.mkdirSync(leaf(), { recursive: true });
    row(OTHER, path.join(h.home, 'elsewhere'));
    chmodFor(path.join(h.home, '.cc-sessions'), 0o300);
    const a = clear();
    expect(a.rc, a.why).toBe('2');
    expect(a.why).toContain('could not list');
  });

  it('a refusal OUTRANKS an unmeasured row, whatever order the registry lists them in', () => {
    const clone = path.join(leaf(), 'clone');
    fs.mkdirSync(clone, { recursive: true });
    row(OTHER, clone);
    row('demo3-a', 'relative/path');
    row('demo3-z', 'relative/path');
    expect(clear().rc).toBe('1');
  });

  it('an id no witness is named for is never asked: 2', () => {
    const [rc = ''] = h.sh('_ws_reclaim_contained _ws_collect_rows_clear .x /y; echo "$?"').split('\n');
    expect(rc).toBe('2');
  });
});
