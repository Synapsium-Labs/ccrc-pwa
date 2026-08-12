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

const runSwap = (target = 'claude-dev0'): string =>
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
  path.join(h.home, '.claude-dev0', 'projects', pdir, rel);

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
    expect(runSwap()).toContain('swapped claude-demo: claude -> claude-dev0');
    expect(fs.readFileSync(dstAt('-w-quiet-mesa', `${UUID}.jsonl`), 'utf8')).toBe('HISTORY\n');
    // …and the slot the resumed process reads first is covered too.
    expect(fs.readFileSync(dstAt(mdir, `${UUID}.jsonl`), 'utf8')).toBe('HISTORY\n');
    expect(h.reg(ID, 'wrapper')).toBe('claude-dev0');
  });

  it('a gpt -> Anthropic swap sanitizes the copy, and every carried name IS that file', () => {
    // Unchanged contract (ccd:7044), re-pinned at the verb: the Codex lane
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
    sidecar('.claude-dev0', mdir, 'tool-results/r.json', 'ALREADY THERE\n');
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
    h.sh(`${SWAP} ${CP_STUB} cmd_swap ${ID} claude-dev0`, { TMUX: '' });
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
    expect(fs.readFileSync(path.join(h.home, '.claude-dev0', 'tasks', UUID, 'plan.json'), 'utf8'))
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
      'systemctl --user start claude-session@claude-demo',
    ]);
  });
});
