import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { canonicalize, checkPath, isExecAllowed } from '../src/whitelist.js';

describe('whitelist.canonicalize', () => {
  it('resolves an existing path to its realpath', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ccrc-wl-'));
    const real = mkdtempSync(path.join(tmpdir(), 'ccrc-wl-real-'));
    const link = path.join(dir, 'link');
    symlinkSync(real, link);
    expect(await canonicalize(link)).toBe(await canonicalize(real));
    rmSync(dir, { recursive: true, force: true });
    rmSync(real, { recursive: true, force: true });
  });

  it('appends non-existent tail components literally onto the resolved existing prefix', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ccrc-wl-'));
    const target = path.join(dir, 'not', 'yet', 'created.txt');
    const canonical = await canonicalize(target);
    expect(canonical.endsWith(path.join('not', 'yet', 'created.txt'))).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('whitelist.checkPath', () => {
  let home: string;
  let projectsRoot: string;
  let outside: string;

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
    rmSync(projectsRoot, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  function seed(): void {
    home = mkdtempSync(path.join(tmpdir(), 'ccrc-wl-home-'));
    for (const d of ['.cc-sessions', '.cc-limits', '.cc-clips', '.claude', '.claude-corp']) {
      mkdirSync(path.join(home, d), { recursive: true });
    }
    projectsRoot = mkdtempSync(path.join(tmpdir(), 'ccrc-wl-projects-'));
    outside = mkdtempSync(path.join(tmpdir(), 'ccrc-wl-outside-'));
  }

  it('allows reads under every read-whitelisted root', async () => {
    seed();
    const cfg = { home, projectsRoot };
    for (const rel of ['.cc-sessions/a', '.cc-limits/b', '.cc-clips/c', '.claude/settings.json', '.claude-corp/settings.json']) {
      const p = path.join(home, rel);
      expect(await checkPath(p, cfg, 'read')).not.toBeNull();
    }
    expect(await checkPath(path.join(projectsRoot, 'proj', 'x.ts'), cfg, 'read')).not.toBeNull();
  });

  it('rejects reads outside every whitelisted root, including a sibling dir with a similar prefix', async () => {
    seed();
    const cfg = { home, projectsRoot };
    expect(await checkPath(path.join(outside, 'x'), cfg, 'read')).toBeNull();
    // a directory that merely starts with the same characters as home must not match
    expect(await checkPath(`${home}-evil/x`, cfg, 'read')).toBeNull();
  });

  it('restricts writes to .cc-clips only, even though those paths are read-allowed', async () => {
    seed();
    const cfg = { home, projectsRoot };
    expect(await checkPath(path.join(home, '.cc-clips', 'a.png'), cfg, 'write')).not.toBeNull();
    expect(await checkPath(path.join(home, '.cc-sessions', 'a.wrapper'), cfg, 'write')).toBeNull();
    expect(await checkPath(path.join(home, '.claude', 'settings.json'), cfg, 'write')).toBeNull();
    expect(await checkPath(path.join(projectsRoot, 'proj', 'x.ts'), cfg, 'write')).toBeNull();
  });

  it('rejects a symlink under a whitelisted dir that points outside it', async () => {
    seed();
    const cfg = { home, projectsRoot };
    const secret = path.join(outside, 'secret.txt');
    writeFileSync(secret, 'nope');
    const link = path.join(home, '.cc-clips', 'escape');
    symlinkSync(secret, link);
    expect(await checkPath(link, cfg, 'read')).toBeNull();
  });

  it('returns null instead of throwing when the path is not a string (malformed request)', async () => {
    seed();
    const cfg = { home, projectsRoot };
    await expect(checkPath(undefined as unknown as string, cfg, 'read')).resolves.toBeNull();
    await expect(checkPath(42 as unknown as string, cfg, 'read')).resolves.toBeNull();
    await expect(checkPath(null as unknown as string, cfg, 'write')).resolves.toBeNull();
  });
});

describe('whitelist.isExecAllowed', () => {
  it('allows whitelisted cmd/subcommand pairs', () => {
    expect(isExecAllowed('tmux', ['has-session', '-t', 'x'])).toBe(true);
    expect(isExecAllowed('ccd', ['swap', 'x', 'claude2'])).toBe(true);
  });

  it('requires an EXACT bare command name — no basename matching', () => {
    // An absolute path whose *basename* matches ("tmux"/"ccd") must NOT be
    // treated as the real binary — that would let e.g. /tmp/x/tmux or a
    // fleet checkout's .../some-repo/ccd pass the whitelist.
    expect(isExecAllowed('/home/user/.local/bin/ccd', ['ensure', 'x'])).toBe(false);
    expect(isExecAllowed('/tmp/x/tmux', ['has-session'])).toBe(false);
    expect(isExecAllowed('/srv/projects/some-repo/ccd', ['swap', 'x'])).toBe(false);
  });

  it('rejects unknown commands', () => {
    expect(isExecAllowed('rm', ['-rf', '/'])).toBe(false);
  });

  it('rejects unknown subcommands of a whitelisted command', () => {
    expect(isExecAllowed('tmux', ['kill-server'])).toBe(false);
    expect(isExecAllowed('ccd', [])).toBe(false);
  });

  // ws-add stays; ws-rm does NOT. The old comment here claimed ccd "refuses an
  // unmerged branch" — it does not, it keeps the branch and warns on stderr —
  // and the whole reap design exists because that guard was never real, and
  // because the guards ws-rm does have cannot see a gitignored .env, ask the
  // remote nothing, and are never re-proved at the instant of deletion.
  // See whitelist-noghosts.test.ts for the full statement.
  it('allows ws-add and refuses ws-rm', () => {
    expect(isExecAllowed('ccd', ['ws-add', 'OpenClawHetzner'])).toBe(true);
    expect(isExecAllowed('ccd', ['ws-rm', 'OpenClawHetzner-quiet-mesa'])).toBe(false);
  });

  it('allows the PR and archive verbs at their pinned prefixes', () => {
    expect(isExecAllowed('ccd', ['pr-state', '--session', 'demo-quiet-basin'])).toBe(true);
    expect(isExecAllowed('ccd', ['pr-state', '--project', 'demo'])).toBe(true);
    expect(isExecAllowed('ccd', ['pr-open', '--session', 'x', '--title', 't', '--body-b64', 'Yg==', '--draft', 'false'])).toBe(true);
    expect(isExecAllowed('ccd', ['ws-archive', '--session', 'x'])).toBe(true);
    expect(isExecAllowed('ccd', ['ws-restore', '--session', 'x'])).toBe(true);
    expect(isExecAllowed('ccd', ['ws-audit', '--session', 'x'])).toBe(true);
    expect(isExecAllowed('ccd', ['ws-attic', '--session', 'x'])).toBe(true);
  });

  it('is still a whitelist — plausible adjacent subcommands stay refused', () => {
    // Pinned in BOTH directions on purpose. The pair above is only worth
    // anything while this holds: a list that had been widened to accept
    // anything ws-shaped — or anything at all — would satisfy those two
    // assertions for entirely the wrong reason.
    expect(isExecAllowed('ccd', ['ws-nuke', 'OpenClawHetzner-quiet-mesa'])).toBe(false);
    expect(isExecAllowed('ccd', ['ws'])).toBe(false);
    expect(isExecAllowed('ccd', ['prefer', 'x', 'claude2'])).toBe(false);
    expect(isExecAllowed('ccd', ['supervise', 'x'])).toBe(false);
  });

  it('returns false instead of throwing on malformed wire values (missing/wrong-typed fields)', () => {
    expect(isExecAllowed(undefined as unknown as string, ['x'])).toBe(false);
    expect(isExecAllowed(123 as unknown as string, ['x'])).toBe(false);
    expect(isExecAllowed(null as unknown as string, ['x'])).toBe(false);
    expect(isExecAllowed('tmux', undefined as unknown as string[])).toBe(false);
    expect(isExecAllowed('tmux', 'has-session' as unknown as string[])).toBe(false);
    expect(isExecAllowed('tmux', [123 as unknown as string])).toBe(false);
  });
});
