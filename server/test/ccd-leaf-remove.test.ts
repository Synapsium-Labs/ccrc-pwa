// `_ws_leaf_remove` — the ONE removal of a per-session leaf under a box-wide
// root (child reclamation wave 6, spec §5.6) — and the reclaim/expire tail,
// which now removes its clips directory and its temp root through it. What is
// asserted is what stands on disk afterwards and the helper's three-way answer
// (0 removed or absent, PROVEN; 1 refused; 2 unmeasured), never its word alone.
// A leaf the helper does not remove is KEPT by the tail, the act completes, and
// the done row says so — never a refusal, never kept in silence.
// FIXTURE HOME ONLY: every root is under the harness's HOME. The `rm`, `pwd`
// and `_ws_leaf_uid` stubs are shell FUNCTIONS defined in the snippet: they
// shadow the binary or the builtin for that one call and touch nothing else.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { eventsOf, measOf } from './lifecycleHelpers.js';
import { CHILD_BRANCH, CHILD_ID, childReclaimVerb, evalOf, makeChild } from './childReclaimFixture.js';
import { EXP_ID, expireToken, expireVerb, makeArchived } from './wsExpireFixture.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-leaf-remove-'); });
afterEach(() => { h.cleanup(); });

const ID = 'demo-quiet-basin';
const ROOT_USER = process.getuid?.() === 0;
const rootOf = (): string => path.join(h.home, 'root');
const leafOf = (): string => path.join(rootOf(), ID);
/** What `rm` is handed for a directory leaf: never across a file-system boundary. */
const RM_TREE = process.platform === 'darwin' ? '-rfx --' : '-rf --one-file-system --';

interface Answer { rc: string; why: string }
const remove = (root: string, id: string, opts: { devino?: string; pre?: string } = {}): Answer => {
  const dv = opts.devino !== undefined ? ` "${opts.devino}"` : '';
  const [rc = '', why = ''] = h.sh(`${opts.pre ?? ''} _ws_leaf_remove "${root}" "${id}"${dv}; rc=$?;`
    + ` printf '%s\\x1f%s' "$rc" "$_WS_LEAF_WHY"`).split('\x1f');
  return { rc, why };
};
/** A leaf with files, a nested directory, and a mode-000 subdirectory holding a file. */
const plantTree = (dir: string): void => {
  fs.mkdirSync(path.join(dir, 'cdk.out', 'deep'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'cdk.out', 'manifest.json'), '{}');
  fs.mkdirSync(path.join(dir, 'locked'));
  fs.writeFileSync(path.join(dir, 'locked', 'x'), 'x');
  fs.chmodSync(path.join(dir, 'locked'), 0o000);
};
const unlock = (dir: string): void => { const l = path.join(dir, 'locked'); if (fs.existsSync(l)) fs.chmodSync(l, 0o755); };

describe('_ws_leaf_remove — removed, or absent: rc 0, PROVEN', () => {
  it('an absent root, and an absent leaf under a present root, answer 0', () => {
    expect(remove(rootOf(), ID).rc).toBe('0');
    fs.mkdirSync(rootOf());
    expect(remove(rootOf(), ID).rc).toBe('0');
    expect(fs.existsSync(rootOf()), 'the root itself is never removed').toBe(true);
  }, 60_000);

  it('a directory leaf — files, a nested directory, a mode-000 subdirectory — is normalised, removed and proven gone', () => {
    plantTree(leafOf());
    try {
      const a = remove(rootOf(), ID);
      expect(a.rc, a.why).toBe('0');
      expect(fs.existsSync(leafOf())).toBe(false);
      expect(fs.existsSync(rootOf()), 'the root stays').toBe(true);
    } finally { unlock(leafOf()); }
  }, 60_000);

  it('a LINK leaf is unlinked, never followed — to a directory, to a file, or dangling', () => {
    const outside = path.join(h.home, 'outside');
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'keep'), 'not the session’s');
    fs.mkdirSync(rootOf());
    for (const target of [outside, path.join(outside, 'keep'), path.join(h.home, 'nowhere')]) {
      fs.symlinkSync(target, leafOf());
      const a = remove(rootOf(), ID);
      expect(a.rc, `${target}: ${a.why}`).toBe('0');
      expect(() => fs.lstatSync(leafOf()), 'the link itself is gone').toThrow();
      expect(fs.readFileSync(path.join(outside, 'keep'), 'utf8'), 'its target is untouched').toBe('not the session’s');
    }
  }, 60_000);

  it('a FILE leaf is unlinked; the root stays', () => {
    fs.mkdirSync(rootOf());
    fs.writeFileSync(leafOf(), 'a file where the leaf should be');
    expect(remove(rootOf(), ID).rc).toBe('0');
    expect(() => fs.lstatSync(leafOf())).toThrow();
    expect(fs.existsSync(rootOf())).toBe(true);
  }, 60_000);

  it('a ROOT that is a link is followed (a data volume) — the leaf under its physical root goes, the link stays', () => {
    const vol = path.join(h.home, 'vol');
    fs.mkdirSync(path.join(vol, ID, 'x'), { recursive: true });
    fs.symlinkSync(vol, rootOf());
    expect(remove(rootOf(), ID).rc).toBe('0');
    expect(fs.existsSync(path.join(vol, ID))).toBe(false);
    expect(fs.lstatSync(rootOf()).isSymbolicLink(), 'the root link stays').toBe(true);
  }, 60_000);

  it('a directory leaf is handed to rm NEVER ACROSS A FILE-SYSTEM BOUNDARY, by its physical path', () => {
    fs.mkdirSync(path.join(leafOf(), 'x'), { recursive: true });
    const a = remove(rootOf(), ID, { pre: 'rm() { printf "rm %s\\n" "$*" >> "$HOME/rm-calls"; command rm "$@"; };' });
    expect(a.rc, a.why).toBe('0');
    const calls = fs.readFileSync(path.join(h.home, 'rm-calls'), 'utf8').split('\n').filter((l) => l.startsWith('rm -rf'));
    expect(calls).toEqual([`rm ${RM_TREE} ${path.join(fs.realpathSync(rootOf()), ID)}`]);
  }, 60_000);

  it('the leaf’s own dev:ino, when the caller names it, lets it go', () => {
    fs.mkdirSync(leafOf(), { recursive: true });
    const di = h.sh(`_plat_devino "${leafOf()}"`);
    expect(di, 'the CONTROL: an identity was read').toMatch(/^\d+:\d+$/);
    expect(remove(rootOf(), ID, { devino: di }).rc).toBe('0');
    expect(fs.existsSync(leafOf())).toBe(false);
  }, 60_000);

  it('a mode-000 leaf this uid owns has its OWN owner bits set before it is entered, then goes, proven', () => {
    plantTree(leafOf());
    fs.chmodSync(leafOf(), 0o000);
    try {
      const a = remove(rootOf(), ID);
      expect(a.rc, a.why).toBe('0');
      expect(fs.existsSync(leafOf())).toBe(false);
    } finally { if (fs.existsSync(leafOf())) { fs.chmodSync(leafOf(), 0o755); unlock(leafOf()); } }
  }, 60_000);
});

describe('_ws_leaf_remove — refused: rc 1, nothing removed', () => {
  it('an id ccd never mints is refused before anything is looked at', () => {
    fs.mkdirSync(rootOf());
    fs.writeFileSync(path.join(rootOf(), 'keep'), 'k');
    fs.writeFileSync(path.join(h.home, 'sentinel'), 's');
    for (const bad of ['..', '.', 'a/b', '', 'x y']) {
      const a = remove(rootOf(), bad);
      expect(a.rc, `'${bad}': ${a.why}`).toBe('1');
      expect(a.why).toContain('not a session id');
    }
    expect(fs.existsSync(path.join(rootOf(), 'keep'))).toBe(true);
    expect(fs.existsSync(path.join(h.home, 'sentinel'))).toBe(true);
  }, 60_000);

  it('a directory another uid owns is refused, and stands', () => {
    fs.mkdirSync(path.join(leafOf(), 'x'), { recursive: true });
    const a = remove(rootOf(), ID, { pre: '_ws_leaf_uid() { echo 999999; };' });
    expect(a.rc, a.why).toBe('1');
    expect(a.why).toContain('belongs to uid 999999');
    expect(fs.existsSync(path.join(leafOf(), 'x'))).toBe(true);
  }, 60_000);

  it('a directory whose physical path is not root/<id> is refused, and stands', () => {
    fs.mkdirSync(path.join(leafOf(), 'x'), { recursive: true });
    const pre = `pwd() { if [[ "$PWD" == */${ID} ]]; then printf '%s\\n' "$HOME/elsewhere"; else builtin pwd "$@"; fi; };`;
    const a = remove(rootOf(), ID, { pre });
    expect(a.rc, a.why).toBe('1');
    expect(a.why).toContain('resolves to');
    expect(fs.existsSync(path.join(leafOf(), 'x'))).toBe(true);
  }, 60_000);

  it('a dev:ino that is not the leaf’s is refused, and the leaf stands', () => {
    fs.mkdirSync(path.join(leafOf(), 'x'), { recursive: true });
    const a = remove(rootOf(), ID, { devino: '1:1' });
    expect(a.rc, a.why).toBe('1');
    expect(a.why).toContain('not the 1:1');
    expect(fs.existsSync(path.join(leafOf(), 'x'))).toBe(true);
  }, 60_000);

  it('an entry still unreadable after the permission pass refuses the WHOLE leaf — no partial rm', () => {
    fs.mkdirSync(path.join(leafOf(), 'x'), { recursive: true });
    const a = remove(rootOf(), ID, { pre: "_ws_reclaim_normalise() { _WS_NORMALISE_WHY='stub: x is still unreadable'; return 1; };" });
    expect(a.rc, a.why).toBe('1');
    expect(a.why).toContain('stub: x is still unreadable');
    expect(fs.existsSync(path.join(leafOf(), 'x'))).toBe(true);
  }, 60_000);
});

describe('_ws_leaf_remove — unmeasured: rc 2, every exit code read', () => {
  it('a permission pass that could not RUN removes nothing', () => {
    fs.mkdirSync(path.join(leafOf(), 'x'), { recursive: true });
    const a = remove(rootOf(), ID, { pre: "_ws_reclaim_normalise() { _WS_NORMALISE_WHY='stub: the pass could not run'; return 2; };" });
    expect(a.rc, a.why).toBe('2');
    expect(fs.existsSync(path.join(leafOf(), 'x'))).toBe(true);
  }, 60_000);

  it('an rm that fails — a nested mount it would not cross — is UNMEASURED, rm’s own words carried', () => {
    fs.mkdirSync(path.join(leafOf(), 'mnt'), { recursive: true });
    const pre = `rm() { if [[ "$1" == -rf* ]]; then echo "rm: skipping '${leafOf()}/mnt', since it's on a different device" >&2; return 1; fi; command rm "$@"; };`;
    const a = remove(rootOf(), ID, { pre });
    expect(a.rc, a.why).toBe('2');
    expect(a.why).toContain('rm exit 1');
    expect(a.why).toContain('different device');
    expect(fs.existsSync(path.join(leafOf(), 'mnt'))).toBe(true);
  }, 60_000);

  it('a link leaf whose unlink fails is UNMEASURED', () => {
    fs.mkdirSync(rootOf());
    fs.symlinkSync(path.join(h.home, 'nowhere'), leafOf());
    const pre = 'rm() { if [[ "$1" == -f && "$2" == -- ]]; then echo "rm: cannot remove: Operation not permitted" >&2; return 1; fi; command rm "$@"; };';
    const a = remove(rootOf(), ID, { pre });
    expect(a.rc, a.why).toBe('2');
    expect(a.why).toContain('could not be unlinked');
  }, 60_000);

  it('a leaf that stands AGAIN after a successful rm is unmeasured, never "removed"', () => {
    fs.mkdirSync(path.join(leafOf(), 'x'), { recursive: true });
    const pre = `rm() { command rm "$@"; local rc=$?; [[ "$1" == -rf* ]] && mkdir -p "${leafOf()}"; return $rc; };`;
    const a = remove(rootOf(), ID, { pre });
    expect(a.rc, a.why).toBe('2');
    expect(a.why).toContain('stands again');
  }, 60_000);

  it.skipIf(ROOT_USER)('a root that cannot be searched is unmeasured', () => {
    const locked = path.join(h.home, 'locked');
    fs.mkdirSync(path.join(locked, 'root', ID), { recursive: true });
    fs.chmodSync(locked, 0o000);
    try {
      expect(remove(path.join(locked, 'root'), ID).rc).toBe('2');
    } finally { fs.chmodSync(locked, 0o755); }
    expect(fs.existsSync(path.join(locked, 'root', ID))).toBe(true);
  }, 60_000);

  // Each guard below answers 2 with ITS OWN reason. Dropped, each one used to
  // fall through to an EMPTY value: a root that resolved to nothing "proved"
  // the leaf absent at `/` (rc 0 — fail open), and an empty uid, owner, path
  // or identity was refused (rc 1) for a reason that was not true.
  it('a root that is a regular file cannot be resolved: unmeasured, never "absent"', () => {
    fs.writeFileSync(rootOf(), 'a file where the root should be');
    const a = remove(rootOf(), ID);
    expect(a.rc, a.why).toBe('2');
    expect(a.why).toContain('cannot be resolved');
    expect(fs.readFileSync(rootOf(), 'utf8')).toBe('a file where the root should be');
  }, 60_000);

  it.skipIf(ROOT_USER)('a mode-000 root holding the leaf cannot be resolved: unmeasured, and the leaf stands', () => {
    fs.mkdirSync(path.join(leafOf(), 'x'), { recursive: true });
    fs.chmodSync(rootOf(), 0o000);
    let a: Answer;
    try { a = remove(rootOf(), ID); } finally { fs.chmodSync(rootOf(), 0o755); }
    expect(a.rc, a.why).toBe('2');
    expect(a.why).toContain('cannot be resolved');
    expect(fs.existsSync(path.join(leafOf(), 'x'))).toBe(true);
  }, 60_000);

  it.skipIf(ROOT_USER)('a removal whose absence cannot then be LOOKED AT is unmeasured — never proven gone', () => {
    fs.mkdirSync(path.join(leafOf(), 'x'), { recursive: true });
    const pre = `rm() { command rm "$@"; local rc=$?; [[ "$1" == -rf* ]] && chmod 000 "${rootOf()}"; return $rc; };`;
    let a: Answer;
    try { a = remove(rootOf(), ID, { pre }); } finally { fs.chmodSync(rootOf(), 0o755); }
    expect(a.rc, a.why).toBe('2');
    expect(a.why).toContain('was never proven');
  }, 60_000);

  it('this uid, unreadable, is unmeasured — never "another uid’s"', () => {
    fs.mkdirSync(path.join(leafOf(), 'x'), { recursive: true });
    const a = remove(rootOf(), ID, { pre: 'id() { return 1; };' });
    expect(a.rc, a.why).toBe('2');
    expect(a.why).toContain('this uid could not be read');
    expect(fs.existsSync(path.join(leafOf(), 'x'))).toBe(true);
  }, 60_000);

  it('an owner that cannot be read is unmeasured — never "another uid’s"', () => {
    fs.mkdirSync(path.join(leafOf(), 'x'), { recursive: true });
    const a = remove(rootOf(), ID, { pre: '_ws_leaf_uid() { return 1; };' });
    expect(a.rc, a.why).toBe('2');
    expect(a.why).toContain('who owns');
    expect(fs.existsSync(path.join(leafOf(), 'x'))).toBe(true);
  }, 60_000);

  it('owner bits that could not be set are unmeasured', () => {
    fs.mkdirSync(path.join(leafOf(), 'x'), { recursive: true });
    const a = remove(rootOf(), ID, { pre: 'find() { return 1; };' });
    expect(a.rc, a.why).toBe('2');
    expect(a.why).toContain('owner bits');
    expect(fs.existsSync(path.join(leafOf(), 'x'))).toBe(true);
  }, 60_000);

  it('a leaf that cannot be entered is unmeasured — never "resolves to" nothing', () => {
    fs.mkdirSync(path.join(leafOf(), 'x'), { recursive: true });
    const pre = `cd() { if [[ "\${2-}" == */${ID} ]]; then return 1; fi; builtin cd "$@"; };`;
    const a = remove(rootOf(), ID, { pre });
    expect(a.rc, a.why).toBe('2');
    expect(a.why).toContain('cannot be entered');
    expect(fs.existsSync(path.join(leafOf(), 'x'))).toBe(true);
  }, 60_000);

  it('an identity that cannot be read, when the caller names one, is unmeasured — never "not the recorded one"', () => {
    fs.mkdirSync(path.join(leafOf(), 'x'), { recursive: true });
    const a = remove(rootOf(), ID, { devino: '1:1', pre: '_plat_devino() { return 1; };' });
    expect(a.rc, a.why).toBe('2');
    expect(a.why).toContain('the identity of');
    expect(fs.existsSync(path.join(leafOf(), 'x'))).toBe(true);
  }, 60_000);
});

/** The clips leaf (only) reads as another uid's. */
const CLIPS_NOT_OURS = '_ws_leaf_uid() { case "$1" in */.cc-clips/*) echo 999999 ;; *)'
  + ' if [[ "$CCD_OS" == darwin ]]; then stat -f %u "$1"; else stat -c %u "$1"; fi ;; esac; };';
/** rm fails on the clips leaf (only), as a nested mount would make it. */
const CLIPS_RM_FAILS = 'rm() { if [[ "$1" == -rf* && "$*" == *"/.cc-clips/"* ]]; then'
  + ' echo "rm: cannot remove: Device or resource busy" >&2; return 1; fi; command rm "$@"; };';

describe('the tail removes both leaves through the helper — and KEEPS, and says, what it did not remove', () => {
  const plantClips = (id: string): string => {
    const d = path.join(h.home, '.cc-clips', id);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'shot.png'), 'png');
    return d;
  };

  it('a clips leaf the helper refuses is KEPT; the reclaim completes, and its done row says so', () => {
    const c = makeChild(h);
    const clips = plantClips(CHILD_ID);
    const r = childReclaimVerb(h, evalOf(h).token, { pre: CLIPS_NOT_OURS });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(JSON.parse(r.stdout).reclaimed).toBe(CHILD_ID);
    expect(fs.existsSync(c.wt), 'worktree').toBe(false);
    expect(h.git(c.main, 'branch', '--list', CHILD_BRANCH), 'branch').toBe('');
    expect(h.reg(CHILD_ID, 'uuid'), 'the row').toBeNull();
    expect(fs.existsSync(path.join(clips, 'shot.png')), 'the clips directory is kept').toBe(true);
    const events = eventsOf(h.home, 'reclaim');
    expect(events.map((e) => e['outcome']), 'a completed act, not a refusal').toEqual(['intent', 'done']);
    const done = events.find((e) => e['outcome'] === 'done')!;
    expect(measOf(done)['clipsKept']).toBe('refused');
    expect(String(done['detail'])).toContain('belongs to uid 999999');
  }, 90_000);

  it('an rm that fails on the clips leaf: kept, `unmeasured`, rm’s words in the detail', () => {
    makeChild(h);
    const clips = plantClips(CHILD_ID);
    const r = childReclaimVerb(h, evalOf(h).token, { pre: CLIPS_RM_FAILS });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(fs.existsSync(path.join(clips, 'shot.png'))).toBe(true);
    const done = eventsOf(h.home, 'reclaim').find((e) => e['outcome'] === 'done')!;
    expect(measOf(done)['clipsKept']).toBe('unmeasured');
    expect(String(done['detail'])).toContain('Device or resource busy');
  }, 90_000);

  // Linux only: on Darwin, Task 6's in-use probe answers unmeasured before the helper is asked.
  it.skipIf(process.platform === 'darwin')('a temp root the helper refuses is KEPT and recorded as `refused`', () => {
    makeChild(h);
    const leaf = path.join(h.home, '.cc-tmp', CHILD_ID);
    fs.mkdirSync(path.join(leaf, 'cdk.out'), { recursive: true });
    const pre = '_ws_leaf_uid() { case "$1" in */.cc-tmp/*) echo 999999 ;; *) stat -c %u "$1" ;; esac; };';
    const r = childReclaimVerb(h, evalOf(h).token, { pre });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(fs.existsSync(path.join(leaf, 'cdk.out'))).toBe(true);
    const done = eventsOf(h.home, 'reclaim').find((e) => e['outcome'] === 'done')!;
    expect(measOf(done)['tmpRootKept']).toBe('refused');
    expect(String(done['detail'])).toContain(`temp root ${path.join(h.home, '.cc-tmp', CHILD_ID)} kept (refused)`);
  }, 90_000);

  it('ws-expire’s tail is the same tail: a refused clips leaf is kept, recorded on the `expire` done row', () => {
    makeArchived(h);
    const clips = plantClips(EXP_ID);
    const r = expireVerb(h, expireToken(h), { pre: CLIPS_NOT_OURS });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(JSON.parse(r.stdout).expired).toBe(EXP_ID);
    expect(fs.existsSync(path.join(clips, 'shot.png'))).toBe(true);
    const done = eventsOf(h.home, 'expire').find((e) => e['outcome'] === 'done')!;
    expect(measOf(done)['clipsKept']).toBe('refused');
  }, 90_000);

  it('a purge failure after a kept leaf says what was kept — never "clips … gone"', () => {
    makeChild(h);
    plantClips(CHILD_ID);
    const purge3 = '_reg_purge() { REG_PURGE_UNREMOVED="$HOME/x"; return 3; };';
    const r = childReclaimVerb(h, evalOf(h).token, { pre: `${CLIPS_NOT_OURS} ${purge3}` });
    expect(r.code, r.stdout + r.stderr).toBe(1);
    const doc = JSON.parse(r.stdout) as { failed: string; detail: string };
    expect(doc.failed).toBe('purge-incomplete');
    expect(doc.detail).toContain('clips kept (refused)');
    expect(doc.detail).not.toContain('clips gone');
    const failed = eventsOf(h.home, 'reclaim').find((e) => e['outcome'] === 'failed')!;
    expect(measOf(failed)['clipsKept']).toBe('refused');
  }, 90_000);

  it('the CONTROL: the same purge failure with nothing kept says the clips went', () => {
    makeChild(h);
    plantClips(CHILD_ID);
    const r = childReclaimVerb(h, evalOf(h).token, { pre: '_reg_purge() { REG_PURGE_UNREMOVED="$HOME/x"; return 3; };' });
    expect(r.code, r.stdout + r.stderr).toBe(1);
    expect((JSON.parse(r.stdout) as { detail: string }).detail).toContain('clips gone');
    // Linux only: on Darwin, Task 6's in-use probe keeps a temp root that stands.
    if (process.platform !== 'darwin') {
      expect((JSON.parse(r.stdout) as { detail: string }).detail).toContain('temp root gone');
      const failed = eventsOf(h.home, 'reclaim').find((e) => e['outcome'] === 'failed')!;
      expect(measOf(failed), 'nothing kept, nothing recorded').not.toHaveProperty('clipsKept');
      expect(measOf(failed)).not.toHaveProperty('tmpRootKept');
    }
  }, 90_000);

  // Linux only, for the reason above.
  it.skipIf(process.platform === 'darwin')('the CONTROL: a clean reclaim removes both leaves, and its done row carries NEITHER kept key', () => {
    makeChild(h);
    const clips = plantClips(CHILD_ID);
    const tmp = path.join(h.home, '.cc-tmp', CHILD_ID);
    fs.mkdirSync(path.join(tmp, 'cdk.out'), { recursive: true });
    const r = childReclaimVerb(h, evalOf(h).token);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(fs.existsSync(clips), 'clips').toBe(false);
    expect(fs.existsSync(tmp), 'temp root').toBe(false);
    const done = eventsOf(h.home, 'reclaim').find((e) => e['outcome'] === 'done')!;
    expect(measOf(done)).not.toHaveProperty('clipsKept');
    expect(measOf(done)).not.toHaveProperty('tmpRootKept');
    expect(String(done['detail'] ?? '')).not.toContain('kept (');
  }, 90_000);

  // Every purge-failure arm carries both kept keys, and says what was kept.
  for (const [rc, token] of [[3, 'purge-incomplete'], [2, 'purge-mechanism-absent'], [1, 'purge-refused']] as const) {
    it.skipIf(process.platform === 'darwin')(`a purge failure (rc ${rc}, ${token}) after BOTH leaves were kept carries both keys`, () => {
      makeChild(h);
      plantClips(CHILD_ID);
      fs.mkdirSync(path.join(h.home, '.cc-tmp', CHILD_ID, 'cdk.out'), { recursive: true });
      const pre = `_ws_leaf_uid() { echo 999999; }; _reg_purge() { REG_PURGE_UNREMOVED="$HOME/x"; return ${rc}; };`;
      const r = childReclaimVerb(h, evalOf(h).token, { pre });
      expect(r.code, r.stdout + r.stderr).toBe(1);
      const doc = JSON.parse(r.stdout) as { failed: string; detail: string };
      expect(doc.failed).toBe(token);
      expect(doc.detail).toContain('worktree and branch are gone, clips kept (refused), temp root kept (refused)');
      const failed = eventsOf(h.home, 'reclaim').find((e) => e['outcome'] === 'failed')!;
      expect(measOf(failed)['clipsKept']).toBe('refused');
      expect(measOf(failed)['tmpRootKept']).toBe('refused');
    }, 90_000);
  }

  // Linux only, for the reason above. The TEMP ROOT, because the ladder's own
  // permission pass reads the clips directory first and refuses an unreadable one.
  it.skipIf(process.platform === 'darwin')('a kept leaf’s reason reaches the done row as ONE short line — control bytes read "?", cut at 300 bytes — and the row keeps its meas', () => {
    makeChild(h);
    const tmp = path.join(h.home, '.cc-tmp', CHILD_ID);
    // A name the SESSION chose: long, and laden with every kind of control byte.
    const name = `evil${'\t\n\x1b\x7f\x01'.repeat(40)}`;
    fs.mkdirSync(path.join(tmp, name, name), { recursive: true });
    // The permission pass names what it could not fix by its raw path, as `_ws_reclaim_normalise` does;
    // every other tree (the worktree's and the clips directory's, at the ladder) gets the real pass. The
    // leaf is matched by its last two components: the harness HOME itself may sit under a `.cc-tmp`.
    const pre = 'eval "$(declare -f _ws_reclaim_normalise | sed \'1s/^_ws_reclaim_normalise/_t_norm_real/\')";'
      + ` _ws_reclaim_normalise() { case "$1" in */.cc-tmp/${CHILD_ID})`
      + ' _WS_NORMALISE_WHY="$(find -P "$1" -mindepth 2 -print -quit) is still unreadable after the permission pass"; return 1 ;;'
      + ' *) _t_norm_real "$@" ;; esac; };';
    const r = childReclaimVerb(h, evalOf(h).token, { pre });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(JSON.parse(r.stdout).reclaimed).toBe(CHILD_ID);
    expect(fs.existsSync(path.join(tmp, name, name)), 'the temp root is kept').toBe(true);
    const done = eventsOf(h.home, 'reclaim').find((e) => e['outcome'] === 'done')!;
    expect(done['truncated'], 'the row was never cut down to fit').toBeUndefined();
    expect(measOf(done)['tmpRootKept']).toBe('refused');
    expect(measOf(done)['childOf']).toBe('7');
    expect(measOf(done)['branch']).toBe(CHILD_BRANCH);
    const detail = String(done['detail']);
    expect(detail).not.toMatch(/[\x00-\x1f\x7f]/);
    const head = `temp root ${tmp} kept (refused): `;
    expect(detail.startsWith(head), detail).toBe(true);
    const why = detail.slice(head.length);
    expect(why).toContain(`${fs.realpathSync(tmp)}/evil?????`);
    expect(why.endsWith('…'), 'a cut is marked').toBe(true);
    expect(Buffer.byteLength(why.slice(0, -1), 'utf8')).toBeLessThanOrEqual(300);
  }, 90_000);
});
