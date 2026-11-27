// `_hook_pid` (ccd/ccd) — the translation between the pid tmux reports and the
// pid the SESSION HOOK names its files by.
//
// On MSYS2 a native Windows program has TWO pids: the one the MSYS runtime
// assigns — which is what `tmux` reports, tmux being an MSYS program itself —
// and the Windows one the program sees for itself. Claude Code is native, so
// its hook writes `<cfg>/sessions/<WINDOWS pid>.json`, while every lookup in
// ccd was keyed on `pane_pid`. The two numbers are unrelated. Measured on this
// box: tmux said 7956, the hook file was 56116, `/proc/7956/winpid` is 56116.
//
// FOUR mechanisms read that path, and one unreadable filename silently
// disabled all four:
//
//   _ws_status      → `ws-archive` refused with `status-unknown`, `ws-reap`
//                     with a refusal record (ccd:4082, ccd:6830, ccd:8300)
//   the uuid sync   → a session stopped being followed across a swap, which
//                     is the product's whole promise (ccd:9701)
//   two idle gates  → auto-swap and auto-compact never fired (ccd:10034, 10073)
//
// None of them reported a defect: each fails closed on an unreadable file, so
// the fleet looked healthy and merely never did anything.
//
// Off MSYS `/proc/<pid>/winpid` does not exist, the two numbers are the same,
// and `_hook_pid` is the identity function — which is why the wiring pin below
// shadows `_hook_pid` rather than relying on a translation Linux cannot make.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ccdSource, makeCcdHarness } from './ccdWsHelpers.js';

const h = makeCcdHarness('ccrc-hookpid-');
const onMsys = process.platform === 'win32';

describe('_hook_pid — the translation itself', () => {
  it('is the identity when the pid has no winpid file: every POSIX box, and any pid MSYS does not know', () => {
    // 4294967295 is above every pid either namespace hands out, so `/proc/…`
    // is absent here exactly as it is absent on Linux.
    expect(h.sh('_hook_pid 4294967295')).toBe('4294967295');
  });

  it('answers EMPTY for an empty pid, so the caller\'s numeric guard still refuses', () => {
    // `_ws_status` gates on `[[ "$pid" =~ ^[0-9]+$ ]] || return 1`. A helper
    // that invented a number for "tmux said nothing" would turn the honest
    // non-zero into a read of some unrelated session's status file.
    expect(h.sh('_hook_pid ""')).toBe('');
    expect(h.sh('_hook_pid')).toBe('');
  });

  it.skipIf(!onMsys)('reads the REAL bridge on MSYS — and the two numbers differ', () => {
    // The negative control the identity test cannot be: if this returned the
    // input, the whole fix would be a no-op on the only platform that needs it.
    // ONE snippet, because `$$` is a different number in each `h.sh` — every
    // call is its own bash. Measured the hard way: three separate reads
    // compared a shell pid against another shell's winpid and failed green-
    // looking work.
    const [shellPid, winpid, translated] = h.sh(
      'printf "%s\\n%s\\n%s" "$$" "$(cat /proc/$$/winpid)" "$(_hook_pid $$)"',
    ).split('\n');
    expect(winpid).toMatch(/^\d+$/);
    expect(winpid).not.toBe(shellPid);
    expect(translated).toBe(winpid);
  });
});

describe('_ws_status reads the TRANSLATED pid — the wiring, not the helper', () => {
  // Both files exist and disagree. Only the translated name can produce `busy`,
  // so this goes red the moment the `pid=$(_hook_pid "$pid")` line is deleted:
  // measured — without it `_ws_status` reads 111.json and answers `idle`.
  const cfg = path.join(h.home, 'cfg', 'sessions');
  fs.mkdirSync(cfg, { recursive: true });
  fs.writeFileSync(path.join(cfg, '111.json'), '{"status":"idle"}');
  fs.writeFileSync(path.join(cfg, '222.json'), '{"status":"busy"}');

  const drive = (translate: boolean, windows = true): string => h.sh(
    `_ccd_is_windows() { return ${windows ? 0 : 1}; }; `
    + '_reg_get() { echo w1; }; _cfg_dir() { echo "$HOME/cfg"; }; '
    + '_session_verdict() { echo live; }; tmux() { echo 111; }; '
    + (translate ? '_hook_pid() { [ "$1" = 111 ] && echo 222 || echo "$1"; }; ' : '')
    + '_ws_status demo',
  );

  it('the untranslated pid is the WRONG session — the pin\'s negative control', () => {
    // With `_hook_pid` left as the identity, 111.json is what gets read. This
    // is the answer the box gave before the fix on every reachable path.
    expect(drive(false)).toBe('idle');
  });

  it('the translated pid is the one that decides', () => {
    expect(drive(true)).toBe('busy');
  });

  it('off Windows nothing is translated: the pane pid is the hook pid there', () => {
    expect(drive(true, false)).toBe('idle');
  });
});

describe('every pane_pid → hook-file lookup goes through it', () => {
  // ccdSource(): ccd with its library spliced in, so a capture moved into ccd/lib is still scanned (ccd-lib-load.test.ts).
  const src = ccdSource().split('\n');

  it('translates at all four sites, and at no other', () => {
    // A structural scan rather than four end-to-end drives, because the failure
    // mode is a FIFTH site added later without the translation — which no test
    // of the existing four can see.
    // `_pane_scope_tmux` captures are EXEMPT by name, for `_lc_obs`'s reason (below): the pane-scope reader hands
    // the pid to `_pane_cgroup_of` and `ps`, which look it up in the MSYS namespace it came from. They never name a
    // hook file, so translating them would break a working lookup. `_am_who`'s capture (`_am_sys … display-message`) is
    // EXEMPT for `_lc_obs`'s reason too: `_am_ancestor` compares it with an ancestry walked from `$$`, MSYS to MSYS.
    const captures = src
      .map((line, i) => ({ line, n: i + 1 }))
      .filter(({ line }) => /#\{pane_pid\}/.test(line) && /=\$\(/.test(line) && !/_pane_scope_tmux/.test(line) && !/_am_sys/.test(line));
    expect(captures.map((c) => c.n)).toHaveLength(4);
    for (const { n, line } of captures) {
      const v = /^\s*(\w+)=\$\(/.exec(line)?.[1];
      // Windows only (`_ccd_is_windows`): on Linux the pane pid IS the hook pid, and the translation would be a fork a tick.
      expect(`${n}: ${src[n]?.trim()}`).toBe(`${n}: _ccd_is_windows && ${v}=$(_hook_pid "$${v}")`);
    }
  });

  it('EXEMPTS `_lc_obs`, whose comparison is MSYS-pid to MSYS-pid', () => {
    // `_lc_obs` matches `pane_pid` against an ancestry walked from `$$` up
    // through `/proc/<pid>/ppid` — both sides are MSYS pids, in the same
    // namespace. Translating one side there would BREAK a working comparison,
    // so its exemption is a decision, not an omission.
    const listAll = src.findIndex((l) => /list-panes -a -F/.test(l));
    expect(listAll).toBeGreaterThan(-1);
    expect(src.slice(listAll, listAll + 3).join('\n')).not.toContain('_hook_pid');
  });
});
