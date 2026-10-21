// path-identity W3, Task 1 (path-identity spec §4; the wave's add-only invariant, R33). THE FENCE: every hold the rows
// rung, the record reader, `_ws_reclaim_owned` and the shared reclaim and expiry tail give TODAY, frozen as a table
// before W3 changes any placement. Each row names its caller, the word it gives on W2's head (`today`), and the words
// it may give after any later W3 task (`allowed`): today's word and only stricter ones. A retryable hold may become a
// terminal refusal. A tail's `worktree-remove-failed` may become `containment-refuted`. A FRESH verb may stop earlier,
// at its in-lock recompute's `probe-unmeasured`, before the kill. A row never releases: no token, no `reclaimed` or
// `expired`, no rc 0 that clears. A tail row leaves its tree, its branch and its breadcrumb standing. The CONTROL
// cases pin today's PASS on a clean child through every caller, against the host's own mount table. A CONTROL that
// reds after a later task is a narrowing on the clean layout, never a fence row to relax.
// THESE ARE FENCES, NOT RED-FIRST TESTS. They were measured green on W2's head, and each is proven to bite by a
// mutation that deletes an EXISTING guard of ccd and is measured red (the path-identity W3 plan's Task 1 table). Every
// later W3 task that edits `ccd/ccd` re-runs this file. `W3_FENCE_BASE=1` adds the base check: each row's word, and a
// tail row's breadcrumb, equal what this table says they were on W2's head.
// Every other row is HAND-PLANTED (`.uuid` and `.workdir` written here, `.project` where git's record must place it),
// so it stays a legacy row whatever W3 seeds for new ones. The one exception is the MOVED family of
// `containmentRefutedFamilies.ts`, whose row `cmd_ws_add` mints. The fence asserts words, never reasons.
// FIXTURE HOME ONLY (`makePrHarness`): every repository, row, leaf and mount table is under the harness's HOME. The
// unit and the pane are recorded, never touched (`CHILD_STUBS`, `EXP_STUBS`). Mounts are FAKED (`MOUNTS_SEAM` over a
// copy of this process's table), never made. The expiry ladder's working-directory probe reads a fake process root
// (`FAKE_PROC_SELF`), except where a row needs a real process in the tree (`holdCwd`). The reclaim and expiry tail's
// post-kill wait walks the real `/proc` (counted by `PROC_SPY`), so CLAUDE.md lists this file as a load flake. Linux
// only: the faked table, the `//` spelling bash keeps and the expiry's `/proc` probe are Linux shapes.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { CHILD_BRANCH, CHILD_ID, childReclaimVerb, evalOf, makeChild, type Child } from './childReclaimFixture.js';
import { verbHelpers } from './childReclaimVerbHelpers.js';
import { FAMILIES } from './containmentRefutedFamilies.js';
import {
  EXP_BRANCH, EXP_ID, EXP_STUBS, expireAudit, expireToken, expireVerb, holdCwd, makeArchived, type Archived,
} from './wsExpireFixture.js';
import { COL_ID, MOUNTS_SEAM, realMounts } from './wsCollectFixture.js';
import { FAKE_PROC_SELF } from './worktreeIdentityFixture.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-wtid-fence-'); });
afterEach(() => { h.cleanup(); });
const { interrupted, resumeToken, unsupervised } = verbHelpers(() => h);

const LINUX = process.platform === 'linux';
/** `W3_FENCE_BASE=1`: each row's word, and a tail row's breadcrumb, must equal what this table says for W2's head. */
const BASE = process.env['W3_FENCE_BASE'] === '1';
const WAIT = 'CCD_RECLAIM_TMPROOT_WAIT_S=2;';
/** Every walk of the real /proc the tail's wait makes (`_ws_path_users`, through its seam), one line each. */
const PROC_SPY = '_ws_path_users_proc_root() { echo walk >> "$HOME/proc-walks"; printf "%s" /proc; };';
/** git's worktree list cannot be read; every other git call is the real one. */
const LIST_FAILS = 'git() { case "$*" in *"worktree list"*) return 128 ;; esac; command git "$@"; };';

type Run = { code: number; stdout: string; stderr: string };
type Caller = 'L' | 'X' | 'C' | 'O' | 'R' | 'V' | 'E';
interface Tail {
  readonly id: string;
  readonly act: 'reclaim' | 'expire';
  /** Files that must stand afterwards: the subject's tree, or another session's work. */
  readonly stands: readonly string[];
  readonly branches: readonly { readonly main: string; readonly name: string }[];
}
interface Outcome {
  /** The ladder's verdict, the audit document's verdict, an rc, or the verb document's `failed`/`refused` word. */
  readonly word: string;
  /** A token, a `reclaimed`/`expired` document, or an rc 0 that clears. */
  readonly minted: boolean;
  readonly detail: string;
  readonly tail?: Tail;
}
interface Row {
  readonly id: string;
  readonly caller: Caller;
  readonly title: string;
  readonly today: string;
  /** A tail row's breadcrumb on W2's head. */
  readonly crumb?: string;
  readonly allowed: readonly string[];
  readonly run: () => Outcome;
}

// The words a row may give after a later task: today's, and only stricter ones.
const UNMEASURED = ['unmeasured', 'containment-unproven', 'not-a-workspace'] as const;
const UNPROVEN = ['containment-unproven'] as const;
const IN_USE = ['in-use'] as const;
const RC1 = ['1'] as const;
const RC2 = ['2', '1'] as const;
const LIST_RC2 = ['2'] as const;
const FAILED_FRESH = ['worktree-remove-failed', 'containment-refuted', 'probe-unmeasured'] as const;
const FAILED_RESUMED = ['worktree-remove-failed', 'containment-refuted'] as const;
const REFUTED = ['containment-refuted'] as const;

const reg = (file: string): string => path.join(h.home, '.cc-sessions', file);
const linesOf = (name: string): string[] => {
  const p = path.join(h.home, name);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').split('\n').filter(Boolean) : [];
};
/** Another session's row, HAND-PLANTED as `ccd start` writes one: `.uuid`, `.workdir`, and `.project` when given. */
const otherRow = (id: string, workdir: string, project?: string): void => {
  fs.writeFileSync(reg(`${id}.uuid`), `u-${id}`);
  fs.writeFileSync(reg(`${id}.workdir`), workdir);
  if (project !== undefined) fs.writeFileSync(reg(`${id}.project`), project);
};
/** `$HOME/alias` a link to `tree`, `<tree>/server` standing, and a row spelled `$HOME/alias/server`: inside by its
 *  resolution only. */
const aliasRow = (tree: string): void => {
  fs.mkdirSync(path.join(tree, 'server'), { recursive: true });
  fs.symlinkSync(tree, path.join(h.home, 'alias'));
  otherRow('demo-alias', path.join(h.home, 'alias', 'server'));
};
/** A linked worktree of `main` at `wt` on `branch`, recorded by git, and a hand-planted row naming it in `project`.
 *  Answers its admin directory. */
const sibling = (main: string, project: string, id: string, wt: string, branch: string): string => {
  fs.mkdirSync(path.dirname(wt), { recursive: true });
  h.git(main, 'worktree', 'add', '-q', '-b', branch, wt);
  otherRow(id, wt, project);
  return h.git(wt, 'rev-parse', '--absolute-git-dir');
};
/** git's admin entry `<main>/.git/worktrees/<slug>`: its `gitdir` rewritten with `body`. */
const emptyGitdir = (main: string, slug: string, body: string): void => {
  fs.writeFileSync(path.join(main, '.git', 'worktrees', slug, 'gitdir'), body);
};
/** `projects/demo2`: a LINKED worktree of the child's repository, used as a project directory. */
const linkedProject = (c: Child): string => {
  const demo2 = path.join(h.home, 'projects', 'demo2');
  h.git(c.main, 'worktree', 'add', '-q', '-b', 'proj2-main', demo2);
  return demo2;
};
/** A mount point as the kernel's table writes it: space, tab, newline and backslash encoded. */
const encoded = (p: string): string =>
  p.replace(/\\/g, '\\134').replace(/ /g, '\\040').replace(/\t/g, '\\011').replace(/\n/g, '\\012');
const MOUNT_LINE = (p: string): string => `9999 1 0:99 / ${encoded(p)} rw,relatime - tmpfs tmpfs rw`;
/** Appends a mount at `p` (physical) to the faked table at `$HOME/mountinfo`. */
const mountAt = (p: string): void => { fs.appendFileSync(path.join(h.home, 'mountinfo'), `${MOUNT_LINE(p)}\n`); };
const childFiles = (c: Child): string[] => [path.join(c.wt, 'f1.txt'), path.join(c.wt, 'f2.txt')];
const archivedFiles = (a: Archived): string[] => [path.join(a.wt, 'f1.txt'), path.join(a.wt, 'f2.txt')];

/** The verb's one JSON document, or `{}` when it printed none. */
const lastJson = (r: Run): Record<string, unknown> => {
  try { return JSON.parse(r.stdout.trim().split('\n').pop() || '{}') as Record<string, unknown>; } catch { return {}; }
};
/** L: `_ws_reclaim_eval`, the audit's call. */
const L = (pre = ''): Outcome => {
  const a = evalOf(h, { pre });
  return { word: a.verdict, minted: a.token !== '', detail: a.detail };
};
/** X: `ws-audit --session <id> --expire`'s document. By default the expiry's cwd probe reads `FAKE_PROC_SELF`. */
const X = (pre: string = FAKE_PROC_SELF): Outcome => {
  const r = expireAudit(h, { pre });
  const doc = lastJson(r);
  return {
    word: doc['verdict'] !== undefined ? String(doc['verdict']) : `no document (exit ${r.code})`,
    minted: typeof doc['token'] === 'string' && doc['token'] !== '',
    detail: String(doc['detail'] ?? `${r.stdout}${r.stderr}`),
  };
};
/** The dead child the collector's row rule is asked about: no row, a temp-root leaf. */
const leafC = (): string => path.join(h.home, '.cc-tmp', COL_ID);
/** C: `_ws_collect_rows_clear` with the leaf as the workdir, contained as its callers ask it. */
const C = (): Outcome => {
  const [rc = '', why = ''] = h.sh(`_ws_reclaim_contained _ws_collect_rows_clear ${COL_ID} '${leafC()}'; rc=$?;`
    + ' printf \'%s\\x1f%s\' "$rc" "$_WS_COLLECT_ROWS_WHY"').split('\x1f');
  return { word: rc, minted: rc === '0', detail: why };
};
/** O: `_ws_reclaim_owned`, the tail's re-ask, called directly. */
const O = (wd: string, main: string, pre = ''): Outcome => {
  const [rc = '', why = ''] = h.sh(`${pre} _ws_reclaim_owned ${CHILD_ID} "${wd}" "${main}"; printf '%s\\x1f%s' "$?" "$_WS_OWNED_WHY"`)
    .split('\x1f');
  return { word: rc, minted: rc === '0', detail: why };
};
/** V or E: the verb's document, read as a word. */
const verb = (r: Run, tail: Tail): Outcome => {
  const doc = lastJson(r);
  const done = doc['reclaimed'] !== undefined || doc['expired'] !== undefined;
  const said = doc['failed'] ?? doc['refused'];
  return {
    word: said !== undefined ? String(said) : (done ? 'done' : `no document (exit ${r.code})`),
    minted: done,
    detail: String(doc['detail'] ?? `${r.stdout}${r.stderr}`),
    tail,
  };
};
const childTail = (c: Child, stands: readonly string[], more: readonly string[] = []): Tail => ({
  id: CHILD_ID, act: 'reclaim', stands, branches: [CHILD_BRANCH, ...more].map((name) => ({ main: c.main, name })),
});
const expiryTail = (a: Archived, stands: readonly string[]): Tail => ({
  id: EXP_ID, act: 'expire', stands, branches: [{ main: a.main, name: EXP_BRANCH }],
});
const reclaimToken = (): string => {
  const a = evalOf(h);
  expect(a.token, `the CONTROL: the ladder passes — ${a.verdict}: ${a.detail}`).toMatch(/^[0-9a-f]{64}$/);
  return a.token;
};
const expiryToken = (): string => {
  const t = expireToken(h, { pre: FAKE_PROC_SELF });
  expect(t, 'the CONTROL: the expiry ladder passes').toMatch(/^[0-9a-f]{64}$/);
  return t;
};
/** A reclaim interrupted after its pin, its breadcrumb at `worktree`, and the resume token, minted before any shape. */
const resumedReclaim = (c: Child): string => {
  interrupted(c, 'worktree');
  const t = resumeToken('worktree');
  expect(t, 'the CONTROL: the resumed reclaim mints its token').toMatch(/^[0-9a-f]{64}$/);
  return t;
};
/** The same for an expiry (`ccd-expire-tail-refuted.test.ts`'s resumed case), its cwd probe on `FAKE_PROC_SELF`. */
const resumedExpiry = (a: Archived): string => {
  h.sh(`${EXP_STUBS} ${FAKE_PROC_SELF} _WS_RCL_ACT=expire; _ws_expire_eval ${EXP_ID} >/dev/null`
    + ` && _ws_reclaim_pin ${EXP_ID} "${a.wt}" "${a.main}" "$REAP_BRANCH" "$EXPIRE_ARCHIVED_AT"`
    + ` && _ws_tombstone ${EXP_ID} '[]' "$(_ws_reclaim_tomb_fields "$EXPIRE_ARCHIVED_AT" present)" >/dev/null`
    + ` && _reg_set ${EXP_ID} reaping expire:worktree`);
  expect(h.reg(EXP_ID, 'reaping'), 'the CONTROL: interrupted at `worktree`').toBe('expire:worktree');
  const t = h.sh(`${EXP_STUBS} ${FAKE_PROC_SELF} _WS_RCL_ACT=expire; _ws_expire_resume_eval ${EXP_ID} worktree >/dev/null;`
    + ' printf \'%s\' "$REAP_TOKEN"');
  expect(t, 'the CONTROL: the resumed expiry mints its token').toMatch(/^[0-9a-f]{64}$/);
  return t;
};

const FENCE: Row[] = [
  { id: 'F1.L', caller: 'L', title: 'another row names the workdir (SHARED by string)', today: 'containment-unproven', allowed: UNPROVEN,
    run: () => { const c = makeChild(h); otherRow('demo-twin', c.wt); return L(); } },
  { id: 'F1.X', caller: 'X', title: 'another row names the archived workdir (SHARED by string)', today: 'containment-unproven', allowed: UNPROVEN,
    run: () => { const a = makeArchived(h); otherRow('demo-twin', a.wt); return X(); } },
  { id: 'F1.C', caller: 'C', title: 'another row names the dead child’s temp-root leaf', today: '1', allowed: RC1,
    run: () => { fs.mkdirSync(leafC(), { recursive: true }); otherRow('demo-twin', leafC()); return C(); } },
  { id: 'F1.O', caller: 'O', title: 'another row names the workdir (SHARED by string)', today: '1', allowed: RC1,
    run: () => { const c = makeChild(h); otherRow('demo-twin', c.wt); return O(c.wt, c.main); } },
  { id: 'F1b.L', caller: 'L', title: 'SHARED beside a `//` row in the same pass: the placement outranks the hold', today: 'containment-unproven', allowed: UNPROVEN,
    run: () => {
      const c = makeChild(h);
      fs.mkdirSync(path.join(c.wt, 'server'));
      otherRow('demo-twin', c.wt);
      otherRow('demo-ds', `/${c.wt}/server`);
      return L();
    } },
  { id: 'F2.L', caller: 'L', title: 'a row at `<child>/x` (NESTED by string)', today: 'containment-unproven', allowed: UNPROVEN,
    run: () => { const c = makeChild(h); otherRow('demo-nested', `${c.wt}/x`); return L(); } },
  { id: 'F2.X', caller: 'X', title: 'a row at `<archived>/x` (NESTED by string)', today: 'containment-unproven', allowed: UNPROVEN,
    run: () => { const a = makeArchived(h); otherRow('demo-nested', `${a.wt}/x`); return X(); } },
  { id: 'F2.O', caller: 'O', title: 'a row at `<child>/x` (NESTED by string)', today: '1', allowed: RC1,
    run: () => { const c = makeChild(h); otherRow('demo-nested', `${c.wt}/x`); return O(c.wt, c.main); } },
  { id: 'F3.L', caller: 'L', title: 'a row `<child>/..` (THROUGH: not one plain path under the child)', today: 'containment-unproven', allowed: UNPROVEN,
    run: () => { const c = makeChild(h); otherRow('demo-up', `${c.wt}/..`); return L(); } },
  { id: 'F4.L', caller: 'L', title: 'an alias row: `$HOME/alias -> <child>`, row `$HOME/alias/server`', today: 'containment-unproven', allowed: UNPROVEN,
    run: () => { const c = makeChild(h); aliasRow(c.wt); return L(); } },
  { id: 'F4.X', caller: 'X', title: 'an alias row: `$HOME/alias -> <archived>`, row `$HOME/alias/server`', today: 'containment-unproven', allowed: UNPROVEN,
    run: () => { const a = makeArchived(h); aliasRow(a.wt); return X(); } },
  { id: 'F4.O', caller: 'O', title: 'an alias row: `$HOME/alias -> <child>`, row `$HOME/alias/server`', today: '1', allowed: RC1,
    run: () => { const c = makeChild(h); aliasRow(c.wt); return O(c.wt, c.main); } },
  { id: 'F5.L', caller: 'L', title: 'a row spelled `/<child>/server` (it opens with `//`)', today: 'unmeasured', allowed: UNMEASURED,
    run: () => {
      const c = makeChild(h);
      fs.mkdirSync(path.join(c.wt, 'server'));
      otherRow('demo-ds', `/${c.wt}/server`);
      return L();
    } },
  { id: 'F6.L', caller: 'L', title: 'a row `<lnk>/../gone/../<child>` once `gone` is removed (its `..` follows a gone directory)', today: 'unmeasured', allowed: UNMEASURED,
    run: () => {
      const c = makeChild(h);
      fs.mkdirSync(path.join(h.home, 'elsewhere', 'sub'), { recursive: true });
      fs.mkdirSync(path.join(h.home, 'elsewhere', 'gone'));
      fs.symlinkSync(path.join(h.home, 'elsewhere', 'sub'), path.join(h.home, 'lnk'));
      fs.mkdirSync(path.join(h.home, 'gone'));
      otherRow('demo-dotdot', `${h.home}/lnk/../gone/../${path.relative(h.home, c.wt)}`);
      const shared = L();
      expect(shared.word, `the CONTROL: while gone stands the row IS the child — ${shared.detail}`).toBe('containment-unproven');
      fs.rmdirSync(path.join(h.home, 'gone'));
      return L();
    } },
  ...(['/proc/self/cwd/elsewhere', '///proc/self/cwd/elsewhere', '/proc'] as const).map((spelled, i): Row => ({
    id: `F7.L.${i + 1}`, caller: 'L', title: `a row under /proc: ${spelled}`, today: 'unmeasured', allowed: UNMEASURED,
    run: () => {
      makeChild(h);
      fs.mkdirSync(path.join(h.home, 'elsewhere'));
      otherRow('demo-proc', spelled);
      return L();
    },
  })),
  { id: 'F7.X.1', caller: 'X', title: 'a row under /proc: /proc/self/cwd/elsewhere', today: 'unmeasured', allowed: UNMEASURED,
    run: () => {
      makeArchived(h);
      fs.mkdirSync(path.join(h.home, 'elsewhere'));
      otherRow('demo-proc', '/proc/self/cwd/elsewhere');
      return X();
    } },
  { id: 'F8.L', caller: 'L', title: 'a gone row with no git record and no breadcrumb', today: 'unmeasured', allowed: UNMEASURED,
    run: () => { makeChild(h); otherRow('demo-gone', path.join(h.home, 'worktrees', 'demo', 'never-was')); return L(); } },
  { id: 'F8.O', caller: 'O', title: 'a gone row with no git record and no breadcrumb', today: '2', allowed: RC2,
    run: () => {
      const c = makeChild(h);
      otherRow('demo-gone', path.join(h.home, 'worktrees', 'demo', 'never-was'));
      return O(c.wt, c.main);
    } },
  { id: 'F9.L', caller: 'L', title: 'a gone row git’s record would place, beside a blank admin entry of its repository', today: 'unmeasured', allowed: UNMEASURED,
    run: () => {
      const c = makeChild(h);
      const gone = path.join(h.home, 'worktrees', 'demo', 'gone-tree');
      sibling(c.main, 'demo', 'demo-gone-tree', gone, 'ws/gone-tree');
      fs.rmSync(gone, { recursive: true, force: true });
      const placed = L();
      expect(placed.word, `the CONTROL: git's record places the gone row — ${placed.detail}`).toBe('reclaimable');
      h.git(c.main, 'worktree', 'add', '-q', '-b', 'ws/blank', path.join(h.home, 'worktrees', 'demo', 'blank'));
      emptyGitdir(c.main, 'blank', '\n');
      return L();
    } },
  ...(['L', 'O'] as const).map((caller): Row => ({
    id: `F10.${caller}`, caller, title: 'a gone row, placed on git’s record, whose tree was moved inside the child (the moved-check)',
    today: caller === 'L' ? 'containment-unproven' : '1', allowed: caller === 'L' ? UNPROVEN : RC1,
    run: () => {
      const c = makeChild(h);
      const main2 = h.makeGhRepo('demo2', 'o/r2');
      const wt2 = path.join(h.home, 'worktrees', 'demo2', 'still-harbor');
      const admin = sibling(main2, 'demo2', 'demo2-still-harbor', wt2, 'ws/still-harbor');
      expect(fs.readFileSync(path.join(admin, 'gitdir'), 'utf8').trim(), 'the CONTROL: git records the tree by its physical path')
        .toBe(`${wt2}/.git`);
      const outside = caller === 'L' ? L() : O(c.wt, c.main);
      expect(outside.word, `the CONTROL: while it stands outside, the child passes — ${outside.detail}`)
        .toBe(caller === 'L' ? 'reclaimable' : '0');
      const moved = path.join(c.wt, 'vendor', 'still-harbor');
      fs.mkdirSync(path.dirname(moved));
      fs.renameSync(wt2, moved);
      expect(h.sh(`_ws_reclaim_foreign_clean "${moved}"; printf '%s' "$?"`), 'the CONTROL: rung 9 alone would pass it').toBe('0');
      return caller === 'L' ? L() : O(c.wt, c.main);
    },
  })),
  { id: 'F11.L', caller: 'L', title: 'the child’s own workdir resolves to a `//` spelling, and another row stands inside it', today: 'unmeasured', allowed: UNMEASURED,
    run: () => {
      const c = makeChild(h);
      fs.mkdirSync(path.join(c.wt, 'server'));
      fs.renameSync(path.join(h.home, 'worktrees'), path.join(h.home, 'wtreal'));
      fs.symlinkSync(`/${path.join(h.home, 'wtreal')}`, path.join(h.home, 'worktrees'));
      expect(h.sh(`_ws_realpath "${c.wt}"`), 'the CONTROL: the child resolves to a `//` spelling')
        .toBe(`/${path.join(h.home, 'wtreal', 'demo', 'quiet-basin')}`);
      otherRow('demo-other', path.join(h.home, 'wtreal', 'demo', 'quiet-basin', 'server'));
      return L();
    } },
  { id: 'F12.L', caller: 'L', title: 'another row’s `.workdir` cannot be read (a directory stands at its name)', today: 'unmeasured', allowed: UNMEASURED,
    run: () => {
      makeChild(h);
      fs.writeFileSync(reg('demo-dir.uuid'), 'u-demo-dir');
      fs.mkdirSync(reg('demo-dir.workdir'));
      return L();
    } },
  ...(['L', 'O'] as const).map((caller): Row => ({
    id: `F13.${caller}`, caller, title: 'a row inside the child’s temp-root leaf `~/.cc-tmp/<id>`',
    today: caller === 'L' ? 'containment-unproven' : '1', allowed: caller === 'L' ? UNPROVEN : RC1,
    run: () => {
      const c = makeChild(h);
      const inLeaf = path.join(h.home, '.cc-tmp', CHILD_ID, 'wt');
      fs.mkdirSync(inLeaf, { recursive: true });
      otherRow('demo-nested', inLeaf);
      return caller === 'L' ? L() : O(c.wt, c.main);
    },
  })),
  { id: 'F14.O.1', caller: 'O', title: 'the workdir is the project’s main checkout', today: '1', allowed: RC1,
    run: () => { const c = makeChild(h); const demo2 = linkedProject(c); return O(c.main, demo2); } },
  { id: 'F14.O.2', caller: 'O', title: 'the workdir is the project directory itself', today: '1', allowed: RC1,
    run: () => { const c = makeChild(h); const demo2 = linkedProject(c); return O(demo2, demo2); } },
  { id: 'F14.O.3', caller: 'O', title: 'git’s worktree list cannot be read', today: '2', allowed: RC2,
    run: () => { const c = makeChild(h); return O(c.wt, c.main, LIST_FAILS); } },
  { id: 'F15.R', caller: 'R', title: '_ws_reclaim_record: git’s worktree list cannot be read', today: '2', allowed: LIST_RC2,
    run: () => {
      const c = makeChild(h);
      const rc = h.sh(`${LIST_FAILS} _ws_reclaim_record "${c.main}" "${c.wt}"; printf '%s' "$?"`);
      return { word: rc, minted: rc === '0', detail: `_ws_reclaim_record answered ${rc}` };
    } },
  { id: 'F16.V.N', caller: 'V', title: 'a mount under a standing nested checkout (fresh)', today: 'worktree-remove-failed', crumb: 'reclaim:children', allowed: FAILED_FRESH,
    run: () => {
      const c = makeChild(h);
      const inner = path.join(c.wt, 'inner');
      h.git(c.main, 'worktree', 'add', '-q', '-b', 'ws/nested', inner);
      fs.writeFileSync(path.join(inner, 'f'), 'nested work\n');
      const tok = reclaimToken();
      realMounts(h);
      mountAt(path.join(fs.realpathSync(inner), 'mnt'));
      return verb(childReclaimVerb(h, tok, { pre: `${MOUNTS_SEAM} ${WAIT} ${PROC_SPY}` }),
        childTail(c, [path.join(inner, 'f'), ...childFiles(c)], ['ws/nested']));
    } },
  { id: 'F16.V.C', caller: 'V', title: 'a mount under the child’s own tree (fresh)', today: 'worktree-remove-failed', crumb: 'reclaim:worktree', allowed: FAILED_FRESH,
    run: () => {
      const c = makeChild(h);
      const tok = reclaimToken();
      realMounts(h);
      mountAt(path.join(fs.realpathSync(c.wt), 'sub'));
      return verb(childReclaimVerb(h, tok, { pre: `${MOUNTS_SEAM} ${WAIT} ${PROC_SPY}` }), childTail(c, childFiles(c)));
    } },
  { id: 'F16.E.C', caller: 'E', title: 'a mount under the archived tree (fresh)', today: 'worktree-remove-failed', crumb: 'expire:worktree', allowed: FAILED_FRESH,
    run: () => {
      const a = makeArchived(h);
      const tok = expiryToken();
      realMounts(h);
      mountAt(path.join(fs.realpathSync(a.wt), 'sub'));
      return verb(expireVerb(h, tok, { pre: `${FAKE_PROC_SELF} ${MOUNTS_SEAM} ${WAIT} ${PROC_SPY}` }), expiryTail(a, archivedFiles(a)));
    } },
  { id: 'F16.V.L', caller: 'V', title: 'the workdir swapped for a link to another worktree inside the settle (resumed at worktree)', today: 'worktree-remove-failed', crumb: 'reclaim:worktree', allowed: FAILED_RESUMED,
    run: () => {
      const c = makeChild(h);
      const tok = resumedReclaim(c);
      const other = path.join(h.home, 'other');
      h.git(c.main, 'worktree', 'add', '-q', '-b', 'ws/other', other);
      fs.writeFileSync(path.join(other, 'dirty.txt'), 'another session’s uncommitted work\n');
      const swap = `_ws_reclaim_children_merge() { rm -rf "${c.wt}"; ln -s "${other}" "${c.wt}"; printf '%s' "$1"; };`;
      return verb(childReclaimVerb(h, tok, { pre: `${WAIT} ${PROC_SPY} ${swap}` }),
        childTail(c, [path.join(other, 'dirty.txt'), path.join(other, 'README.md')], ['ws/other']));
    } },
  { id: 'F16.V.P', caller: 'V', title: 'the child swapped for a link under its nested checkout’s proof: “not to itself” (fresh)', today: 'worktree-remove-failed', crumb: 'reclaim:children', allowed: FAILED_FRESH,
    run: () => {
      const c = makeChild(h);
      h.git(c.main, 'worktree', 'add', '-q', '-b', 'ws/nested', path.join(c.wt, 'inner'));
      const x = path.join(h.home, 'x');
      fs.mkdirSync(x);
      const other2 = path.join(x, 'inner');
      h.git(c.main, 'worktree', 'add', '-q', '-b', 'ws/other2', other2);
      fs.writeFileSync(path.join(other2, 'keep.txt'), 'another session\n');
      const aside = path.join(h.home, 'aside');
      const swap = `eval "$(declare -f _ws_reclaim_nested_proven | sed '1s/_ws_reclaim_nested_proven/_orig_np/')";`
        + ` _ws_reclaim_nested_proven() { [[ -L "${c.wt}" ]] || { mv "${c.wt}" "${aside}"; ln -s "${x}" "${c.wt}"; }; _orig_np "$@"; };`;
      return verb(childReclaimVerb(h, reclaimToken(), { pre: `${WAIT} ${PROC_SPY} ${swap}` }),
        childTail(c, [path.join(other2, 'keep.txt'), path.join(aside, 'f1.txt')], ['ws/nested', 'ws/other2']));
    } },
  ...FAMILIES.map((fam, i): Row => ({
    id: `F17.V.${i}`, caller: 'V', title: `a proven refusal planted after the resume token — ${fam.name}`,
    today: 'containment-refuted', crumb: 'reclaim:worktree', allowed: REFUTED,
    run: () => {
      const c = makeChild(h);
      const shape = fam.make(h, { id: CHILD_ID, wt: c.wt, main: c.main });
      const tok = resumedReclaim(c);
      h.sh(shape.plant);
      return verb(childReclaimVerb(h, tok, { pre: `${WAIT} ${PROC_SPY}` }),
        childTail(c, [...shape.keeps, ...(shape.treeStands ? childFiles(c) : [])]));
    },
  })),
  { id: 'F17.E.0', caller: 'E', title: `a proven refusal planted after the resume token — ${FAMILIES[0]!.name}`, today: 'containment-refuted', crumb: 'expire:worktree', allowed: REFUTED,
    run: () => {
      const a = makeArchived(h);
      const shape = FAMILIES[0]!.make(h, { id: EXP_ID, wt: a.wt, main: a.main });
      const tok = resumedExpiry(a);
      h.sh(shape.plant);
      return verb(expireVerb(h, tok, { pre: `${FAKE_PROC_SELF} ${WAIT} ${PROC_SPY}` }),
        expiryTail(a, [...shape.keeps, ...archivedFiles(a)]));
    } },
  { id: 'F18.X', caller: 'X', title: 'a real process works inside the archived tree', today: 'in-use', allowed: IN_USE,
    run: () => {
      const a = makeArchived(h);
      const s = holdCwd(a.wt);
      try { return X(''); } finally { s.stop(); }
    } },
];

/** Every row's own assertions. The measurement line is printed FIRST, so a red row still reports what it gave. */
const holds = (row: Row, o: Outcome): void => {
  const crumb = o.tail ? h.reg(o.tail.id, 'reaping') : null;
  console.info(`fence ${row.id} word=${o.word} crumb=${o.tail ? String(crumb) : '-'} walks=${o.tail ? linesOf('proc-walks').length : '-'}`);
  if (BASE) expect(o.word, `${row.id}: the word it gives on W2's head — ${o.detail}`).toBe(row.today);
  expect(row.allowed, `${row.id}: ${o.word} is today’s word or a stricter one — ${o.detail}`).toContain(o.word);
  expect(o.minted, `${row.id}: nothing was released — ${o.detail}`).toBe(false);
  if (!o.tail) return;
  for (const f of o.tail.stands) expect(fs.existsSync(f), `${row.id}: ${f} stands`).toBe(true);
  for (const b of o.tail.branches) {
    expect(h.git(b.main, 'branch', '--list', b.name), `${row.id}: the branch ${b.name} stands`).toContain(b.name);
  }
  if (o.word === 'probe-unmeasured') {
    expect(crumb, `${row.id}: the in-lock recompute stopped the act before its pin, so no breadcrumb`).toBeNull();
    expect(unsupervised(), `${row.id}: and before the unit was touched`).toEqual([]);
  } else {
    expect(crumb ?? '', `${row.id}: the breadcrumb stands, for the retry`).toMatch(new RegExp(`^${o.tail.act}:`));
    if (BASE) expect(crumb, `${row.id}: the step it stopped at on W2's head`).toBe(row.crumb);
  }
};

describe.skipIf(!LINUX)('the add-only fence: today’s holds, frozen as a table (path-identity spec §4)', () => {
  it('the table is sane: unique ids, every row’s today among its allowed words, a breadcrumb on tail rows only', () => {
    const ids = FENCE.map((r) => r.id);
    expect(new Set(ids).size, 'ids are unique').toBe(ids.length);
    expect(ids.length, 'forty-eight rows').toBe(48);
    for (const r of FENCE) {
      expect(r.allowed, `${r.id}: its today is allowed`).toContain(r.today);
      expect(r.crumb !== undefined, `${r.id}: a tail row, and only a tail row, names a breadcrumb`)
        .toBe(r.caller === 'V' || r.caller === 'E');
    }
  });

  it.each(FENCE)('$id — $title', (row) => {
    holds(row, row.run());
  }, 240_000);
});

describe.skipIf(!LINUX)('CONTROL: a clean child passes through every caller, against the host’s own mount table', () => {
  it('CONTROL.L — the reclaim ladder answers reclaimable, with a token', () => {
    makeChild(h);
    const o = L();
    expect(o.word, o.detail).toBe('reclaimable');
    expect(o.minted).toBe(true);
  }, 120_000);

  it('CONTROL.X — the expiry audit answers expirable, with a token', () => {
    makeArchived(h);
    const o = X();
    expect(o.word, o.detail).toBe('expirable');
    expect(o.minted).toBe(true);
  }, 120_000);

  it('CONTROL.C — the collector’s row rule answers 0 for a leaf no row names', () => {
    fs.mkdirSync(leafC(), { recursive: true });
    const o = C();
    expect(o.word, o.detail).toBe('0');
  }, 60_000);

  it('CONTROL.O — _ws_reclaim_owned answers 0 for the child’s own tree', () => {
    const c = makeChild(h);
    const o = O(c.wt, c.main);
    expect(o.word, o.detail).toBe('0');
  }, 120_000);

  it('CONTROL.V — the reclaim verb reclaims the child: its tree and its branch go', () => {
    const c = makeChild(h);
    const r = childReclaimVerb(h, reclaimToken(), { pre: `${WAIT} ${PROC_SPY}` });
    console.info(`fence CONTROL.V walks=${linesOf('proc-walks').length}`);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(lastJson(r)['reclaimed']).toBe(CHILD_ID);
    expect(fs.existsSync(c.wt), 'the tree went').toBe(false);
    expect(h.git(c.main, 'branch', '--list', CHILD_BRANCH), 'the branch went').toBe('');
  }, 240_000);

  it('CONTROL.E — the expiry verb expires the archived workspace: its tree and its branch go', () => {
    const a = makeArchived(h);
    const r = expireVerb(h, expiryToken(), { pre: `${FAKE_PROC_SELF} ${WAIT} ${PROC_SPY}` });
    console.info(`fence CONTROL.E walks=${linesOf('proc-walks').length}`);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(lastJson(r)['expired']).toBe(EXP_ID);
    expect(fs.existsSync(a.wt), 'the tree went').toBe(false);
    expect(h.git(a.main, 'branch', '--list', EXP_BRANCH), 'the branch went').toBe('');
  }, 240_000);
});
