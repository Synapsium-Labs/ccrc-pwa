// ws-rename renames a workspace branch before it is pushed. Sourced under an
// isolated HOME, so nothing here can reach the real registry or a real repo.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { makeCcdHarness, CCD, WS_ADD, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-rename-'); });
afterEach(() => { h.cleanup(); });

/** A workspace on ws/quiet-mesa. Returns its worktree path. */
const addOne = (): string => {
  h.makeRepo('demo');
  h.sh(`${WS_ADD} CCD_WS_SLUG=quiet-mesa cmd_ws_add demo`);
  return path.join(h.home, 'worktrees', 'demo', 'quiet-mesa');
};

describe('_ws_branch_valid', () => {
  const ok = (s: string): boolean =>
    h.sh(`_ws_branch_valid '${s}' && echo yes || echo no`) === 'yes';

  it('accepts the type/slug shape every repo here uses', () => {
    expect(ok('feat/int-7-mcp-image-attachments')).toBe(true);
    expect(ok('ccrc/attachment-tray')).toBe(true);
    expect(ok('fix/MEK-995.cleanup')).toBe(true);
  });

  it('rejects a leading dash — git would read it as an option', () => {
    expect(ok('--force')).toBe(false);
  });

  it('rejects the ref-format traps git itself rejects', () => {
    expect(ok('feat/../escape')).toBe(false);
    expect(ok('/leading')).toBe(false);
    expect(ok('trailing/')).toBe(false);
    expect(ok('feat/thing.lock')).toBe(false);
    expect(ok('feat/thing.lock/more')).toBe(false);   // any COMPONENT, not just the suffix
  });

  it('rejects spaces, colons and glob characters', () => {
    expect(ok('feat/two words')).toBe(false);
    expect(ok('feat:thing')).toBe(false);
    expect(ok('feat/*')).toBe(false);
  });

  it('rejects the empty name', () => {
    expect(ok('')).toBe(false);
  });
});

describe('ws-rename', () => {
  it('renames the branch and records it', () => {
    const wt = addOne();
    const out = h.sh(`cmd_ws_rename demo-quiet-mesa feat/real-name`);
    expect(out).toContain('ws/quiet-mesa');
    expect(out).toContain('feat/real-name');
    expect(h.git(wt, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('feat/real-name');
    expect(h.reg('demo-quiet-mesa', 'branch')).toBe('feat/real-name');
  });

  it('leaves the workspace slug, directory and id alone', () => {
    const wt = addOne();
    h.sh(`cmd_ws_rename demo-quiet-mesa feat/real-name`);
    expect(fs.existsSync(wt)).toBe(true);
    expect(h.reg('demo-quiet-mesa', 'workspace')).toBe('quiet-mesa');
    expect(h.reg('demo-quiet-mesa', 'uuid')).not.toBeNull();
  });

  it('refuses once the branch has an upstream — the remote already has the old name', () => {
    const wt = addOne();
    h.git(wt, 'push', '-u', 'origin', 'HEAD:refs/heads/ws/quiet-mesa');
    expect(() => h.sh(`cmd_ws_rename demo-quiet-mesa feat/real-name`)).toThrow();
    expect(h.git(wt, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('ws/quiet-mesa');
    expect(h.reg('demo-quiet-mesa', 'branch')).toBe('ws/quiet-mesa');
  });

  it('refuses a name that already exists locally', () => {
    const wt = addOne();
    h.git(path.join(h.home, 'projects', 'demo'), 'branch', 'feat/taken');
    expect(() => h.sh(`cmd_ws_rename demo-quiet-mesa feat/taken`)).toThrow();
    expect(h.git(wt, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('ws/quiet-mesa');
  });

  it('refuses a name that already exists on the remote', () => {
    const wt = addOne();
    // On origin but not local: exactly the case a local-only check would miss.
    h.git(wt, 'push', 'origin', 'HEAD:refs/heads/feat/taken-upstream');
    expect(() => h.sh(`cmd_ws_rename demo-quiet-mesa feat/taken-upstream`)).toThrow();
    expect(h.git(wt, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('ws/quiet-mesa');
  });

  it('renames anyway when origin is unreachable, and says so', () => {
    // Unreachable is not the same as taken. Refusing here would make ws-rename
    // unusable offline for a branch that has never been pushed.
    const wt = addOne();
    h.git(path.join(h.home, 'projects', 'demo'), 'remote', 'set-url', 'origin',
      path.join(h.home, 'origins', 'gone.git'));
    const out = h.sh(`cmd_ws_rename demo-quiet-mesa feat/real-name 2>&1`);
    expect(out).toContain('could not reach origin');
    expect(h.git(wt, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('feat/real-name');
  });

  it('refuses an invalid name without touching the branch', () => {
    const wt = addOne();
    expect(() => h.sh(`cmd_ws_rename demo-quiet-mesa 'feat/../escape'`)).toThrow();
    expect(h.git(wt, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('ws/quiet-mesa');
  });

  it('refuses a session that is not a workspace', () => {
    h.sh(`_reg_set claude2-demo wrapper claude2
          _reg_set claude2-demo project demo
          _reg_set claude2-demo workdir ${path.join(h.home, 'projects', 'demo')}
          _reg_set claude2-demo uuid abc`);
    expect(() => h.sh(`cmd_ws_rename claude2-demo feat/real-name`)).toThrow();
  });

  it('refuses an unknown id', () => {
    expect(() => h.sh(`cmd_ws_rename nope-nothing feat/real-name`)).toThrow();
  });

  it('refuses when the name is unchanged', () => {
    addOne();
    expect(() => h.sh(`cmd_ws_rename demo-quiet-mesa ws/quiet-mesa`)).toThrow();
  });

  it('is reachable as a subcommand', () => {
    addOne();
    expect(h.sh(`"${CCD}" ws-rename demo-quiet-mesa feat/real-name`)).toContain('feat/real-name');
  });
});
