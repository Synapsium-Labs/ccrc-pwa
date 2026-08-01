// This file exists to FAIL LOUDLY if a `gh` key is ever added to
// EXEC_WHITELIST, and to pin the two verbs that were removed from it.
//
// The host's gh token carries the `repo` WRITE scope (gh auth status: gist,
// read:org, repo, workflow) and there is no second layer — no read-only
// credential, no cwd sandbox. Any `gh` entry makes this list the sole control
// between the PWA and `gh pr merge`. `gh: [['api']]` is strictly worse still:
// -X POST|PATCH|PUT creates, closes and merges PRs. Every PR read and the one
// PR write go through `ccd` verbs, whose args[0] has no write sibling
// reachable by changing args[1].
import { describe, it, expect } from 'vitest';
import { isExecAllowed } from '../src/whitelist.js';

describe('there is no gh key, in any form', () => {
  it.each([
    ['pr', 'view', '1'], ['pr', 'list'], ['pr', 'create'], ['pr', 'merge', '1'],
    ['pr', 'close', '1'], ['pr', 'edit', '1'], ['pr', 'ready', '1'], ['pr', 'comment', '1'],
    ['api', 'repos/o/r/pulls'], ['api', '-X', 'POST', 'repos/o/r/pulls'],
    ['repo', 'delete', 'o/r'], ['auth', 'token'], ['auth', 'status'],
  ])('refuses gh %s %s', (...args) => {
    expect(isExecAllowed('gh', args as string[]),
      'a gh grant makes EXEC_WHITELIST the sole control between the PWA and gh pr merge')
      .toBe(false);
  });

  it('refuses gh with no arguments at all', () => {
    expect(isExecAllowed('gh', [])).toBe(false);
  });

  it('refuses git outright, including a force push', () => {
    expect(isExecAllowed('git', ['push', '--force'])).toBe(false);
    expect(isExecAllowed('git', ['status'])).toBe(false);
  });
});

describe('the removed grants stay removed', () => {
  it('refuses ws-rm — the unguarded legacy verb', () => {
    // Its only data guard is `git status --porcelain`, which cannot see a
    // gitignored .env; it asks the remote nothing; and it carries no
    // confirmation to re-prove the tree at the instant of deletion.
    expect(isExecAllowed('ccd', ['ws-rm', 'demo-quiet-basin'])).toBe(false);
  });

  it('refuses clip — a dead grant with no server call site', () => {
    expect(isExecAllowed('ccd', ['clip', '/tmp/x.png'])).toBe(false);
  });

  it('refuses ws-gc in every form — ["ws-gc"] would permit --prune', () => {
    expect(isExecAllowed('ccd', ['ws-gc'])).toBe(false);
    expect(isExecAllowed('ccd', ['ws-gc', '--prune'])).toBe(false);
  });
});

describe('a reap cannot cross the wire without a confirmation token', () => {
  it('allows ws-reap only when --expect leads the arguments', () => {
    expect(isExecAllowed('ccd', ['ws-reap', '--expect', 'a'.repeat(64), '--session', 'x'])).toBe(true);
    expect(isExecAllowed('ccd', ['ws-reap', 'x'])).toBe(false);
    expect(isExecAllowed('ccd', ['ws-reap'])).toBe(false);
    expect(isExecAllowed('ccd', ['ws-reap', '--session', 'x'])).toBe(false);
    expect(isExecAllowed('ccd', ['ws-reap', '--session', 'x', '--expect', 'a'.repeat(64)])).toBe(false);
  });
});

describe('prefix matching is a prefix, not a substring', () => {
  it.each([
    [[]], [['pr-statex']], [['pr-state']], [['pr-state', '--branch', 'x']],
    [['ws-archive']], [['ws-archive', '--all']], [['ws-attic', '--drop', 'x']],
    [['pr-open', '--project', 'x']],
    // ws-restore and ws-audit had no substring/bare-refusal coverage anywhere
    // in the suite — a mutant dropping their `--session` requirement (the
    // same class caught above for ws-archive/ws-attic/pr-open) would have
    // survived silently. Added by the Task 9 mutation sweep.
    [['ws-restore']], [['ws-restore', '--all']],
    [['ws-audit']], [['ws-audit', '--all']],
  ])('refuses ccd %j', (args) => {
    expect(isExecAllowed('ccd', args as string[])).toBe(false);
  });

  it('leaves every one-token grant bit-identical to the old behaviour', () => {
    expect(isExecAllowed('ccd', ['start', 'claude', 'demo'])).toBe(true);
    expect(isExecAllowed('ccd', ['stop', 'demo-quiet-basin'])).toBe(true);
    expect(isExecAllowed('tmux', ['capture-pane', '-t', 'cc-x', '-p'])).toBe(true);
  });
});
