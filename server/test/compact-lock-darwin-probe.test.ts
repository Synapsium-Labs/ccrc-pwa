// A PROBE, not a pin: prints what each step of `_compact_lock_acquire` answers on
// THIS platform, so the macOS leg can say why the compaction lock cannot be taken
// there (main dfa167d7: 540 `could not take … within 5s` with an EMPTY
// COMPACT_LOCK_WHY, answered in ~200 ms — so not the `flock -w` wait). Runs on
// linux too, where every step must answer 0; it asserts only that the shell ran.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { CCD, makeCcdHarness, ghContainedEnv, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-lock-probe-'); });
afterEach(() => h.cleanup());

const SNIPPET = [
  'id=probe-row; lock="$REG/.$id.compactions.lock"',
  'echo "uname=$(uname -srm) bash=$BASH_VERSION"',
  'echo "flock=$(command -v flock) [$(flock --version 2>&1 | head -1)] link=$(command -v link) mktemp=$(command -v mktemp)"',
  'src=$( umask 077; mktemp "$REG/.$id.compactions.lock-init.XXXXXX" 2>&1 ); echo "mktemp rc=$? src=${src##*/}"',
  'link "$src" "$lock" 2>&1; echo "link-publish rc=$?"; rm -f "$src"',
  '[[ -f "$lock" && ! -L "$lock" ]]; echo "canonical-regular rc=$?"',
  'al="$REG/.$id.compactions.lock-open.$$.1.2"; link "$lock" "$al" 2>&1; echo "link-alias rc=$?"',
  'exec {fd}<>"$al"; echo "open rc=$? fd=$fd"; rm -f "$al"',
  'echo "proc=$([ -e /proc/self/fd/$fd ] && echo yes || echo no) devfd=$([ -e /dev/fd/$fd ] && echo yes || echo no)"',
  'p=/dev/fd/$fd; [ -e /proc/self/fd/$fd ] && p=/proc/self/fd/$fd',
  'echo "p=$p -e=$([ -e $p ] && echo yes || echo no) -f=$([[ -f $p ]] && echo yes || echo no) -ef=$([[ $p -ef $lock ]] && echo yes || echo no)"',
  'if [[ $(uname) == Darwin ]]; then echo "stat(p)=$(stat -f \'%d:%i %HT\' "$p" 2>&1)"; else echo "stat(p)=$(stat -c \'%d:%i %F\' "$p" 2>&1)"; fi',
  'if [[ $(uname) == Darwin ]]; then echo "stat(lock)=$(stat -f \'%d:%i %HT\' "$lock" 2>&1)"; else echo "stat(lock)=$(stat -c \'%d:%i %F\' "$lock" 2>&1)"; fi',
  '_compact_lock_same "$fd" "$lock"; echo "same rc=$?"',
  'out=$(flock -w 2 "$fd" 2>&1); echo "flock-w rc=$? out=[$out]"',
  'out=$(flock -n "$fd" 2>&1); echo "flock-n rc=$? out=[$out]"',
  'exec {fd}>&-',
  '_compact_lock_acquire "$id" 2; echo "acquire rc=$? why=[${COMPACT_LOCK_WHY:-}] fd=[${COMPACT_LOCK_FD:-}]"',
  '[[ -n "${COMPACT_LOCK_FD:-}" ]] && _compact_lock_release "$COMPACT_LOCK_FD"',
].join('\n');

describe('compact-lock platform probe', () => {
  it('prints what each step of the acquire answers here', () => {
    const env = ghContainedEnv(h.home, { ...process.env, HOME: h.home }, { systemd: true, tmux: true });
    const r = spawnSync('bash', ['-c', `source "${CCD}"; ${SNIPPET}`], { encoding: 'utf8', cwd: h.home, env });
    console.log(`\n=== compact-lock probe (${process.platform}) ===\n${r.stdout}${r.stderr ? `--- stderr ---\n${r.stderr}` : ''}=== end probe ===\n`);
    expect(r.status, `the probe shell itself exited ${r.status}: ${r.stderr}`).toBe(0);
  });
});
