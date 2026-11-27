// A worktree whose links git writes RELATIVE (`git worktree add --relative-paths`, git 2.48+). The Windows port's ws-add
// asks for them: MSYS git otherwise writes `/c/...` links that Git for Windows cannot read, and `git` in the workspace
// answered "not a git repository" to every Windows tool. `_ws_reclaim_admin_entries`, the ONE matcher of git's admin
// entries to a path, compared an entry's `gitdir` text with the tree's absolute path, so a relative entry matched
// nothing and the reclaim and expiry ladders refused the tree as unreadable. On the Windows port it now resolves a relative entry from its
// own admin directory first. FIXTURE HOMEs ONLY (`makePrHarness`).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-relwt-'); });
afterEach(() => { h.cleanup(); });

/** A path as ccd's own shell spells it: MSYS form on Windows (`/d/...`, as `$HOME` is there; with `D:/...` git cannot
 *  relate two paths and writes the link absolute), unchanged elsewhere. */
const sh = (p: string): string => p.replace(/\\/g, '/').replace(/^([A-Za-z]):(?=\/)/, (_m, d: string) => `/${d.toLowerCase()}`);

describe('a relative worktree record', () => {
  it('is matched to its tree, and its HEAD reflog found, as an absolute one is', () => {
    const main = h.makeRepo('demo');
    const wt = path.join(h.home, 'worktrees', 'demo', 'rel');
    // Through the harness's bash and its git, as ws-add makes it.
    h.sh(`git -C '${sh(main)}' worktree add --relative-paths -q -b ws/rel '${sh(wt)}'`);
    expect(fs.readFileSync(path.join(main, '.git', 'worktrees', 'rel', 'gitdir'), 'utf8')).not.toMatch(/^(\/|[A-Za-z]:)/);
    // `OSTYPE=msys`: the resolution is the Windows port's arm (elsewhere a relative record is compared as written, as
    // before the port), so it is asked as that userland on every platform. Needs git 2.48+ for `--relative-paths`.
    const [rc = '', why = '', logs = ''] = h.sh(`OSTYPE=msys; _WS_LOGS=(); _WS_KEEP_WHY=''; _ws_reclaim_admin_entries "$(_ws_common_dir '${sh(main)}')" '${sh(wt)}' 1;`
      + ' printf \'%s\\x1f%s\\x1f\' "$?" "$_WS_KEEP_WHY"; printf \'%s\\n\' ${_WS_LOGS[@]+"${_WS_LOGS[@]}"}').split('\x1f');
    expect(rc, why).toBe('0');
    expect(logs).toMatch(/worktrees\/rel\/logs\/HEAD/);
  });
});
