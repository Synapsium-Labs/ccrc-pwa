/**
 * `ccd swap` carries the whole conversation.
 *
 * Task 1 proved the locator in isolation; this drives the real verb. The two
 * things a swap does to the world that a test must not are systemd and tmux,
 * so both are shell functions that LOG — the `cmd_stop` idiom from
 * ccd-workspaces.test.ts, verbatim. Everything else (the registry writes, the
 * config-dir mapping, the copies, the sanitize) runs for real against an
 * isolated HOME.
 *
 * The sidecar directory is the object this file exists for: 188MB of
 * subagents/tool-results/workflows that NOTHING copied before this build, in
 * project dirs that do not always hold a .jsonl for the same uuid.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-swap-'); });
afterEach(() => { h.cleanup(); });

const UUID = 'b7001948-2222-4bcc-b60b-0cfc0dc3d199';
const ID = 'claude-demo';
const EMPTY_TEXT = '{"message":{"content":[{"type":"text","text":""}]}}';

/** systemd and tmux log instead of acting. `sleep` is stubbed because
 *  cmd_swap's flush wait is a second of real time per case and nothing here
 *  depends on it. TMUX is emptied at the call site so the detached-self-swap
 *  branch — which re-execs ccd under `systemd-run` — can never be taken from a
 *  suite that may itself be running inside tmux. */
const SWAP = 'systemctl() { echo "systemctl $*" >> "$HOME/ccd-calls"; }; '
  + 'tmux() { echo "tmux $*" >> "$HOME/ccd-calls"; }; sleep() { :; };';

const runSwap = (target = 'claude-d'): string =>
  h.sh(`${SWAP} cmd_swap ${ID} ${target}`, { TMUX: '' });

/** The registry row cmd_swap reads. Returns `mdir` — the munge of the resolved
 *  workdir, computed here exactly as ccd's `tr '/._' '---'` computes it. */
const seed = (wrapper: string): string => {
  const wd = path.join(h.home, 'projects', 'demo');
  fs.mkdirSync(wd, { recursive: true });
  h.sh(`_reg_set ${ID} uuid ${UUID}
    _reg_set ${ID} wrapper ${wrapper}
    _reg_set ${ID} project demo
    _reg_set ${ID} workdir ${wd}`);
  return fs.realpathSync(wd).replace(/[/._]/g, '-');
};

const plant = (cfg: string, pdir: string, body: string): string => {
  const dir = path.join(h.home, cfg, 'projects', pdir);
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, `${UUID}.jsonl`);
  fs.writeFileSync(f, body);
  return f;
};

const sidecar = (cfg: string, pdir: string, rel: string, body: string): string => {
  const f = path.join(h.home, cfg, 'projects', pdir, UUID, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, body);
  return f;
};

/** A path inside the DESTINATION account's project dir. */
const dstAt = (pdir: string, rel: string): string =>
  path.join(h.home, '.claude-d', 'projects', pdir, rel);

const swapLog = (): string => {
  const p = path.join(h.home, '.cc-sessions', 'swap.log');
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
};

describe('cmd_swap carries the transcript', () => {
  it('carries a transcript from a directory mdir never names', () => {
    // The 2026-08-11 incident, as a test: the session had moved into a
    // worktree, so the ONE path cmd_swap looked at did not exist, and the swap
    // completed anyway with a warning nobody read.
    const mdir = seed('claude');
    plant('.claude', '-w-quiet-mesa', 'HISTORY\n');
    expect(runSwap()).toContain('swapped claude-demo: claude -> claude-d');
    expect(fs.readFileSync(dstAt('-w-quiet-mesa', `${UUID}.jsonl`), 'utf8')).toBe('HISTORY\n');
    // …and the slot the resumed process reads first is covered too.
    expect(fs.readFileSync(dstAt(mdir, `${UUID}.jsonl`), 'utf8')).toBe('HISTORY\n');
    expect(h.reg(ID, 'wrapper')).toBe('claude-d');
  });

  it('a gpt -> Anthropic swap sanitizes the copy, and every carried name IS that file', () => {
    // Unchanged contract (ccd:10495), re-pinned at the verb: the Codex lane
    // writes EMPTY assistant text blocks, which the Anthropic API rejects on
    // the next turn. Ordering it before the hardlinks is what stops a sibling
    // name keeping the unsanitized inode.
    const mdir = seed('gpt');
    const a = plant('.claude-gpt', mdir, `${EMPTY_TEXT}\n`);
    fs.mkdirSync(path.join(h.home, '.claude-gpt', 'projects', '-w-quiet-mesa'), { recursive: true });
    fs.linkSync(a, path.join(h.home, '.claude-gpt', 'projects', '-w-quiet-mesa', `${UUID}.jsonl`));
    runSwap();
    for (const d of [mdir, '-w-quiet-mesa']) {
      expect(fs.readFileSync(dstAt(d, `${UUID}.jsonl`), 'utf8'), `${d} kept the unsanitized file`)
        .toContain('"..."');
    }
    expect(fs.statSync(dstAt(mdir, `${UUID}.jsonl`)).ino)
      .toBe(fs.statSync(dstAt('-w-quiet-mesa', `${UUID}.jsonl`)).ino);
    expect(fs.readFileSync(a, 'utf8'), 'no move, ever — the source keeps its own')
      .toBe(`${EMPTY_TEXT}\n`);
  });

  it('an Anthropic -> Anthropic swap rewrites nothing', () => {
    const mdir = seed('claude');
    plant('.claude', mdir, `${EMPTY_TEXT}\n`);
    runSwap();
    expect(fs.readFileSync(dstAt(mdir, `${UUID}.jsonl`), 'utf8')).toBe(`${EMPTY_TEXT}\n`);
  });
});

describe('cmd_swap carries the sidecars', () => {
  it('carries a sidecar whose project dir holds no .jsonl at all', () => {
    // M3: two of the incident's sidecars sat in dirs with no transcript for
    // that uuid. Kills any implementation that iterates transcript matches and
    // looks for a sidecar beside each one.
    const mdir = seed('claude');
    plant('.claude', mdir, 'HISTORY\n');
    sidecar('.claude', '-lonely-worktree', 'tool-results/r.json', 'RESULT\n');
    runSwap();
    expect(fs.readFileSync(dstAt('-lonely-worktree', path.join(UUID, 'tool-results/r.json')), 'utf8'))
      .toBe('RESULT\n');
  });

  it('lands each sidecar at the mirror of its OWN source directory', () => {
    // Not "beside the transcript" and not "at mdir": the mirror is what makes
    // the brief's "beside each jsonl" true wherever a sibling exists and still
    // carries the ones where it does not.
    const mdir = seed('claude');
    plant('.claude', mdir, 'HISTORY\n');
    sidecar('.claude', '-w-quiet-mesa', 'subagents/a.jsonl', 'SUB\n');
    runSwap();
    expect(fs.existsSync(dstAt('-w-quiet-mesa', path.join(UUID, 'subagents/a.jsonl')))).toBe(true);
    expect(fs.existsSync(dstAt(mdir, UUID)),
      'the sidecar was relocated to mdir instead of mirrored').toBe(false);
  });

  it('carries the sidecar as a hardlink tree, and says so', () => {
    // 188MB per sidecar: the difference between a swap that takes a moment and
    // one that takes minutes and fills the disk. The contents are write-once
    // artifacts, so sharing inodes between the two accounts is safe — and the
    // log line is the evidence, if a future defect ever implicates a shared
    // checkpoint.
    const mdir = seed('claude');
    plant('.claude', mdir, 'HISTORY\n');
    const src = sidecar('.claude', mdir, 'tool-results/r.json', 'RESULT\n');
    runSwap();
    expect(fs.statSync(dstAt(mdir, path.join(UUID, 'tool-results/r.json'))).ino)
      .toBe(fs.statSync(src).ino);
    expect(swapLog()).toContain('(link)');
  });

  it('leaves an existing destination sidecar alone — a tree is not replaced in one step', () => {
    // Deliberately the OPPOSITE of §2.2's unlink-first rule for the
    // transcript, which is one file replaceable in one step.
    const mdir = seed('claude');
    plant('.claude', mdir, 'HISTORY\n');
    sidecar('.claude', mdir, 'tool-results/r.json', 'SOURCE\n');
    sidecar('.claude-d', mdir, 'tool-results/r.json', 'ALREADY THERE\n');
    runSwap();
    expect(fs.readFileSync(dstAt(mdir, path.join(UUID, 'tool-results/r.json')), 'utf8'))
      .toBe('ALREADY THERE\n');
    expect(swapLog()).toContain('(kept)');
  });

  it('falls back to a full copy without nesting when cp -al leaves a partial destination behind', () => {
    // The fallback's own documented trigger, forced deterministically: a real
    // cross-device `cp -al` builds the destination directory skeleton before
    // it fails on the first unlinkable file (measured on this box, EXDEV), so
    // `$dst` already EXISTS by the time the fallback runs. A stub that just
    // fails `cp -al` cleanly would not exercise the fix at all — the bug only
    // shows up when the fallback's `cp -a` lands on a PRE-EXISTING `$dst`, so
    // the stub reproduces that shape: `-al` creates the destination and fails,
    // anything else (the fallback's own `-a`, and every other cp in this swap:
    // `-p --remove-destination`, `-r`) runs for real.
    const mdir = seed('claude');
    plant('.claude', mdir, 'HISTORY\n');
    sidecar('.claude', mdir, 'tool-results/r.json', 'RESULT\n');
    const CP_STUB = 'cp() { if [[ "$1" == "-al" ]]; then mkdir -p "$3"; return 1; fi; command cp "$@"; };';
    h.sh(`${SWAP} ${CP_STUB} cmd_swap ${ID} claude-d`, { TMUX: '' });
    const real = dstAt(mdir, path.join(UUID, 'tool-results/r.json'));
    expect(fs.existsSync(real), 'the file must land at the real mirrored path, not nested').toBe(true);
    expect(fs.readFileSync(real, 'utf8')).toBe('RESULT\n');
    expect(fs.existsSync(dstAt(mdir, path.join(UUID, UUID))), 'a <uuid>/<uuid> nest must not exist').toBe(false);
    expect(swapLog()).toContain('(copy)');
  });
});

describe('cmd_swap keeps carrying the task list', () => {
  it('still copies <configdir>/tasks/<uuid>/, untouched by any of this', () => {
    // Keyed by uuid rather than by a munged directory, so it was never subject
    // to D1's defect: it keeps its `cp -r` and its copy-don't-move reasoning.
    // Pinned because the rewrite above it is where it would get lost.
    const mdir = seed('claude');
    plant('.claude', mdir, 'HISTORY\n');
    const tasks = path.join(h.home, '.claude', 'tasks', UUID);
    fs.mkdirSync(tasks, { recursive: true });
    fs.writeFileSync(path.join(tasks, 'plan.json'), 'PLAN\n');
    runSwap();
    expect(fs.readFileSync(path.join(h.home, '.claude-d', 'tasks', UUID, 'plan.json'), 'utf8'))
      .toBe('PLAN\n');
    expect(fs.readFileSync(path.join(tasks, 'plan.json'), 'utf8'),
      'copy, don\'t move: a reverted swap still needs the old lane\'s copy').toBe('PLAN\n');
  });

  it('stops the unit before killing the pane, and starts it again at the end', () => {
    // Restart=always resurrects the session under the OLD wrapper if the pane
    // dies first. Unchanged ordering, pinned because this task rewrites the
    // lines between those two calls.
    const mdir = seed('claude');
    plant('.claude', mdir, 'HISTORY\n');
    runSwap();
    expect(h.calls()).toEqual([
      'systemctl --user stop claude-session@claude-demo',
      'tmux kill-session -t cc-claude-demo',
      // cmd_swap's own `_lc_done` (task 18) is the first `_lc_emit` in this
      // process — it sits right after the registry flip, before the restart —
      // so `_lc_obs`'s once-per-process `tmux list-panes` probe fires here.
      'tmux list-panes -a -F #{session_name} #{pane_pid}',
      'systemctl --user start claude-session@claude-demo',
    ]);
  });
});

describe('the detached self-swap answers for its own dispatch', () => {
  // FINAL REVIEW. This is the COMMON invocation — a session swapping itself
  // from its own Bash tool — and it is the one arm of the design with no test
  // at all, because every other case in this file empties TMUX precisely to
  // avoid it. Measured before the fix: `systemd-run` returns 1, ccd prints
  // `detached: <id> will restart under <target> in a few seconds`, returns 0,
  // and records NOTHING — no swap.log line, no swapblocked, no banner,
  // `wrapper` unchanged. `_dispatch_swap`, the auto-path twin, has carried the
  // matching `|| echo "… dispatch FAILED …"` guard all along.
  //
  // `tmux display-message` must answer with this session's own name for the
  // branch to be taken at all; TMUX is set for the same reason.
  const SELF = (runRc: number): string =>
    `systemctl() { echo "systemctl $*" >> "$HOME/ccd-calls"; }; sleep() { :; };
     tmux() { case "\${1:-}" in display-message) echo "cc-${ID}";; esac;
       echo "tmux $*" >> "$HOME/ccd-calls"; return 0; };
     systemd-run() { echo "systemd-run $*" >> "$HOME/ccd-calls"; return ${runRc}; };`;

  const selfSwap = (runRc: number): { code: number; stdout: string; stderr: string } => {
    try {
      return { code: 0, stdout: h.sh(`${SELF(runRc)} cmd_swap ${ID} claude-d`, { TMUX: '/tmp/x,1,0' }), stderr: '' };
    } catch (e) {
      const err = e as { status?: number; stdout?: Buffer; stderr?: Buffer };
      return { code: err.status ?? 1, stdout: String(err.stdout ?? ''), stderr: String(err.stderr ?? '') };
    }
  };

  it('reports failure, records it, and tears nothing down when systemd-run fails', () => {
    const mdir = seed('claude');
    plant('.claude', mdir, 'HISTORY\n');
    const r = selfSwap(1);
    expect(r.code).not.toBe(0);
    expect(r.stdout, 'a failed dispatch printed the success line').not.toContain('detached:');
    expect(r.stderr).toContain(`could not detach the swap of ${ID}`);
    expect(swapLog()).toContain(`detach FAILED for ${ID}: claude -> claude-d`);
    // Nothing was torn down and nothing moved — the session is untouched, which
    // is why this arm reports through an rc instead of through `swapblocked`.
    expect(h.calls().some((c) => c.includes('kill-session'))).toBe(false);
    expect(h.reg(ID, 'wrapper')).toBe('claude');
    expect(h.reg(ID, 'swapblocked')).toBeNull();
  });

  it('still returns 0 with its one line when the dispatch is accepted', () => {
    // The other side of the same branch: a successful detach really has handed
    // the work to a transient unit and really is about to kill this caller, so
    // the confident line is the correct answer THERE.
    const mdir = seed('claude');
    plant('.claude', mdir, 'HISTORY\n');
    const r = selfSwap(0);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain(`detached: ${ID} will restart under claude-d`);
    expect(swapLog()).not.toContain('detach FAILED');
  });
});

describe('the swap heartbeats WHILE it carries, not just around the carry', () => {
  // §4.2: "the swap re-stamps as it goes, and the window classifies as
  // `restarting`" — motivated by §2.3's `cp -a` fallback over a 188MB sidecar
  // taking longer than the 120s freshness window. What shipped was two stamps,
  // one before the carry and one after, and nothing between. Measured against
  // the shipped ladder with a 200s carry: `orphan` at 125s and at 180s — the
  // row reading "nothing is watching it" MID-SWAP, with the PWA's revive
  // affordance beside it, while `wrapper` still names the source account.
  //
  // Wall-clock, because that is the only thing the defect is made of: the beat
  // interval is turned down to 1s and the first `cp` is slowed to ~4s. `sleep`
  // is deliberately NOT stubbed here.
  const SLOW = `systemctl() { echo "systemctl $*" >> "$HOME/ccd-calls"; };
    tmux() { echo "tmux $*" >> "$HOME/ccd-calls"; };
    SWAP_BEAT_INTERVAL=1
    cp() { if [[ -z "\${SLOWED:-}" ]]; then SLOWED=1; command sleep 7; fi; command cp "$@"; };`;

  it('re-stamps `supervised` during the carry, and stops the moment it is over', () => {
    const mdir = seed('claude');
    plant('.claude', mdir, 'HISTORY\n');
    // TWO samples taken from INSIDE the carry, and the assertion is that they
    // differ. Comparing a post-swap read against a pre-swap one would prove
    // nothing: `cmd_swap`'s own closing stamp ("the carry may have taken
    // minutes") already moves it, and did so before this fix too.
    const out = h.sh(`${SLOW}
      ( command sleep 2; _reg_get ${ID} supervised > "$HOME/beat-a"
        command sleep 3; _reg_get ${ID} supervised > "$HOME/beat-b" ) &
      sampler=$!
      cmd_swap ${ID} claude-d >/dev/null
      wait $sampler
      done=$(_reg_get ${ID} supervised)
      command sleep 3
      settled=$(_reg_get ${ID} supervised)
      echo "$(cat "$HOME/beat-a") $(cat "$HOME/beat-b") $done $settled"`, { TMUX: '' });
    const [a, b, done, settled] = out.split(' ').map(Number) as [number, number, number, number];
    expect(b, 'the stamp did not move DURING the carry — it is bracketed, not covered')
      .toBeGreaterThan(a);
    // And the stamper is not still running three seconds after the verb
    // returned — a heartbeat that outlives the swap is a worse lie than the one
    // this fixes, since it claims a supervisor that does not exist.
    expect(settled).toBe(done);
  });

  // ——— the three lines that claim above rests on ———
  //
  // `_swap_beat`'s own comment says it is "bounded twice over" and that "a
  // leaked stamper would be a worse lie than the one it fixes". The test above
  // proves the covering and one stop; it does not touch either bound, and the
  // whole 2585-test suite noticed nothing when all three of these lines were
  // deleted in turn: the `kill -0 "$parent"` guard, the `i < SWAP_BEAT_MAX`
  // loop condition, and the `_swap_beat_stop` on the REFUSAL arm (only the
  // success tail was covered). A safety claim in a comment, defended by
  // nothing — this branch's most-repeated finding, landing on the newest thing
  // the branch itself wrote, which is why it is closed before the merge rather
  // than after it.

  it('a stamper whose parent is gone stamps NOTHING — the first bound', () => {
    seed('claude');
    // The leak this guard exists for is `cmd_swap` killed mid-carry, where the
    // explicit `_swap_beat_stop` never runs at all. A pid that is dead AND
    // REAPED, because `kill -0` succeeds on a zombie: a child that had merely
    // exited would answer "alive" and test nothing. `sleep` is a no-op so the
    // check happens now rather than 30s from now — and so a build with the
    // guard deleted races its 240 ticks in milliseconds instead of hanging.
    const out = h.sh(`sleep() { :; }
      ( exit 0 ) & dead=$!; wait "$dead" 2>/dev/null
      _swap_beat ${ID} "$dead"; rc=$?
      echo "rc=$rc stamp=[$(_reg_get ${ID} supervised)]"`);
    // Not "it exits" — it writes nothing. The order inside the loop is the
    // whole property: the parent is checked BEFORE the stamp, so an orphaned
    // beat never claims a supervisor even once.
    expect(out).toBe('rc=0 stamp=[]');
  });

  it('gives up after SWAP_BEAT_MAX ticks with its parent still alive — the second bound', () => {
    seed('claude');
    // The parent is this very shell, so the first bound cannot be what ends
    // this loop; only the counter can. `_reg_set` becomes a tick counter (the
    // real one is exercised by the wall-clock test above) and `sleep` is a
    // no-op, so production's 240 × 30s = 2h degenerates to 240 iterations in
    // milliseconds — and `printf > "$REG/…"` creates no directory, so a beat
    // that ran too long could not litter either.
    //
    // The killer subshell is what keeps `while :` from hanging the suite
    // instead of failing it: a beat that had to be killed comes back 137.
    const out = h.sh(`sleep() { :; }; _reg_set() { echo tick >> "$HOME/beats"; }
      _swap_beat ${ID} $$ & beat=$!
      ( command sleep 20; kill -9 "$beat" ) >/dev/null 2>&1 & killer=$!
      wait "$beat"; rc=$?
      kill "$killer" 2>/dev/null; wait "$killer" 2>/dev/null
      echo "rc=$rc ticks=$(wc -l < "$HOME/beats") max=$SWAP_BEAT_MAX window=$(( SWAP_BEAT_INTERVAL * SWAP_BEAT_MAX ))"`);
    // The window is asserted, not just the counter: "bounded twice over" is a
    // claim about TWO HOURS, and 240 ticks means two hours only while the
    // interval is 30s. Turning either constant into something a leaked stamper
    // could live inside fails here.
    expect(out).toBe('rc=0 ticks=240 max=240 window=7200');
  });

  /** The refusal fixture's stubs, with ONE difference from `SWAP`: the beat's
   *  own sleep is real. Under a blanket `sleep() { :; }` a leaked stamper
   *  sprints to its 240-tick bound in milliseconds and is gone before any
   *  assertion can see it — the test would then pass against a build that
   *  leaks, which is the fixture-cannot-discriminate shape this branch found
   *  twice. The interval is 3s (not the production 30) so a leak in a failing
   *  run is observable for three seconds and orphans nothing for longer;
   *  `cmd_swap`'s own `sleep 1` flush is still skipped. */
  const BEAT_ALIVE = `systemctl() { echo "systemctl $*" >> "$HOME/ccd-calls"; };
    tmux() { echo "tmux $*" >> "$HOME/ccd-calls"; };
    SWAP_BEAT_INTERVAL=3
    sleep() { [[ "\${1:-}" == "$SWAP_BEAT_INTERVAL" ]] && command sleep "$1"; return 0; };`;

  it('stops the stamper on the REFUSAL arm too, not only on the success tail', () => {
    const mdir = seed('claude');
    plant('.claude', mdir, 'HISTORY\n');
    // A carry that fails AFTER the pre-flight passed is the only way to reach
    // the refusal arm inside the `if` — the pre-flight's own refusal happens
    // before the beat is ever started. `_swap_beat_stop` runs there before
    // `_swap_refuse` does, so a refused swap leaves nothing behind claiming to
    // watch the row it just gave up on: the row is about to be handed back to
    // an operator, and a heartbeat under it would say "something is watching
    // this" for the next two hours.
    const out = h.sh(`${BEAT_ALIVE} cp() { return 1; }
      cmd_swap ${ID} claude-d >/dev/null 2>&1; rc=$?
      echo "rc=$rc stampers_left=$(jobs -pr | wc -l)"
      jobs -pr | xargs -r kill -9 2>/dev/null; true`, { TMUX: '' });
    expect(out).toBe('rc=1 stampers_left=0');
  });
});
