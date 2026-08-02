import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { assembleFleet, idHomeWrapper } from '../src/fleet.js';
import { Tmux, type Runner } from '../src/exec.js';
import { localIO } from '../src/io.js';
import type { Statusline } from '../src/pane/statusline.js';
import type { PrState } from '../../shared/api.js';
import { mkTmp } from './tmpHelpers.js';

const seedSession = (home: string, id: string, wrapper: string, extra: Record<string, string> = {}) => {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const fields = { wrapper, project: id, workdir: `/data/projects/${id}`, uuid: '1'.repeat(36), started: '1', ...extra };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${k}`), v);
};

describe('idHomeWrapper', () => {
  it('longest prefix wins', () => {
    expect(idHomeWrapper('claude-corp-orchard-api')).toBe('claude-corp');
    expect(idHomeWrapper('claude2-MekWarLive')).toBe('claude2');
    expect(idHomeWrapper('claude-synapsium-platform')).toBe('claude');
    expect(idHomeWrapper('gpt-foo')).toBe('gpt');
  });
});

describe('assembleFleet', () => {
  it('joins registry, live state, limits, and tmux aliveness', async () => {
    const home = mkTmp('ccrc-');
    seedSession(home, 'claude2-MekWarLive', 'claude2');
    seedSession(home, 'claude-dead-proj', 'claude');
    mkdirSync(path.join(home, '.claude-personal', 'sessions'), { recursive: true });
    writeFileSync(path.join(home, '.claude-personal', 'sessions', '40613.json'), JSON.stringify({
      pid: 40613, sessionId: '1'.repeat(36), cwd: '/data/projects/MekWarLive',
      name: 'mekwar-a1', status: 'busy', statusUpdatedAt: 1784582728369, version: '2.1.210',
    }));
    mkdirSync(path.join(home, '.cc-limits'), { recursive: true });
    const now = 1784600000;
    writeFileSync(path.join(home, '.cc-limits', 'claude2.json'), JSON.stringify({ five: 55, seven: 70, ts: now - 60 }));

    const run: Runner = async (_cmd, args) => {
      if (args[0] === 'has-session') return { code: args.includes('cc-claude2-MekWarLive') ? 0 : 1, stdout: '', stderr: '' };
      if (args[0] === 'list-panes') return { code: 0, stdout: '40613\n', stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    };

    const fleet = await assembleFleet(localIO, loadConfig({ CCRC_HOME: home }), new Tmux(run), now);
    const mek = fleet.find((s) => s.id === 'claude2-MekWarLive')!;
    expect(mek.status).toBe('busy');
    expect(mek.name).toBe('mekwar-a1');
    expect(mek.limits).toEqual({ five: 55, seven: 70 });
    expect(mek.home).toBe('claude2');
    const dead = fleet.find((s) => s.id === 'claude-dead-proj')!;
    expect(dead.status).toBe('dead');
    expect(dead.name).toBeNull();
  });
});

describe('branch precedence', () => {
  const setup = (): { home: string; run: Runner } => {
    const home = mkTmp('ccrc-');
    seedSession(home, 'demo-quiet-mesa', 'claude', {
      project: 'demo', workspace: 'quiet-mesa', branch: 'ws/quiet-mesa',
    });
    // Alive, but with no live-state file — so no statusline can have been
    // derived yet. This is a workspace in the seconds after ws-add.
    const run: Runner = async (_cmd, args) => {
      if (args[0] === 'has-session') return { code: 0, stdout: '', stderr: '' };
      if (args[0] === 'list-panes') return { code: 0, stdout: '', stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    };
    return { home, run };
  };

  it('falls back to the registry branch before any pane capture has landed', async () => {
    const { home, run } = setup();
    const fleet = await assembleFleet(localIO, loadConfig({ CCRC_HOME: home }), new Tmux(run), 1784600000);
    expect(fleet.find((s) => s.id === 'demo-quiet-mesa')!.branch).toBe('ws/quiet-mesa');
  });

  it('prefers the statusline branch — it reflects a manual checkout the registry cannot know about', async () => {
    const { home, run } = setup();
    const sl = new Map<string, Statusline>([
      ['demo-quiet-mesa', { branch: 'feat/actually-here', ultracode: false, workflowActive: false }],
    ]);
    const fleet = await assembleFleet(
      localIO, loadConfig({ CCRC_HOME: home }), new Tmux(run), 1784600000, undefined, sl);
    expect(fleet.find((s) => s.id === 'demo-quiet-mesa')!.branch).toBe('feat/actually-here');
  });

  it('is null when neither source has one', async () => {
    const home = mkTmp('ccrc-');
    seedSession(home, 'claude-demo', 'claude');
    const run: Runner = async () => ({ code: 1, stdout: '', stderr: '' });
    const fleet = await assembleFleet(localIO, loadConfig({ CCRC_HOME: home }), new Tmux(run), 1784600000);
    expect(fleet.find((s) => s.id === 'claude-demo')!.branch).toBeNull();
  });
});

describe('derived session handles', () => {
  const build = async (live: Record<string, unknown>) => {
    const home = mkTmp('ccrc-');
    seedSession(home, 'claude2-MekWarLive', 'claude2');
    mkdirSync(path.join(home, '.claude-personal', 'sessions'), { recursive: true });
    writeFileSync(
      path.join(home, '.claude-personal', 'sessions', '40613.json'),
      JSON.stringify({ pid: 40613, sessionId: '1'.repeat(36), cwd: '/d', status: 'idle', ...live }),
    );
    const run: Runner = async (_cmd, args) => {
      if (args[0] === 'has-session') return { code: 0, stdout: '', stderr: '' };
      if (args[0] === 'list-panes') return { code: 0, stdout: '40613\n', stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    };
    const fleet = await assembleFleet(localIO, loadConfig({ CCRC_HOME: home }), new Tmux(run));
    return fleet.find((s) => s.id === 'claude2-MekWarLive')!;
  };

  it('drops a name Claude Code declares derived', async () => {
    expect((await build({ name: 'mekwarlive-e7', nameSource: 'derived' })).name).toBeNull();
  });

  it('keeps a name with no nameSource at all — an older file, chosen by a human', async () => {
    // The ONE live session that carries a real name is exactly this shape.
    // An implementation testing `=== 'chosen'` passes the case above and fails here.
    expect((await build({ name: 'add-mcp-image-attachments' })).name)
      .toBe('add-mcp-image-attachments');
  });

  it('keeps a name whose nameSource is anything but derived', async () => {
    expect((await build({ name: 'refactor-auth', nameSource: 'user' })).name).toBe('refactor-auth');
  });
});

describe('PR state on the wire', () => {
  const seedPr = (home: string, id: string, fields: Record<string, string>): void => {
    for (const [f, v] of Object.entries(fields)) {
      writeFileSync(path.join(home, '.cc-sessions', `${id}.${f}`), v);
    }
  };

  it('falls back to the persisted registry values when no sweep has run', async () => {
    // The whole reason the fields are on disk: a server restart must degrade
    // to "merged, last checked 40 minutes ago", never to "no PR".
    const home = mkTmp('ccrc-');
    seedSession(home, 'demo-quiet-basin', 'claude');
    seedPr(home, 'demo-quiet-basin', {
      workspace: 'quiet-basin', branch: 'ws/quiet-basin',
      prphase: 'merged', prnumber: '42', prcheckedat: '1785300000000',
    });
    const fleet = await assembleFleet(localIO, loadConfig({ CCRC_HOME: home }), new Tmux(async () => ({ code: 1, stdout: '', stderr: '' })));
    const s = fleet.find((x) => x.id === 'demo-quiet-basin')!;
    expect(s.pr).toEqual({
      phase: 'merged', number: 42, url: null, title: null, checks: null, checkNames: null,
      ahead: 0, reason: null, checkedAt: 1785300000000, mergedAt: null, retryAt: null,
    });
  });

  it('gives a workspace that was never checked an unchecked phase, not null', async () => {
    const home = mkTmp('ccrc-');
    seedSession(home, 'demo-still-cove', 'claude');
    seedPr(home, 'demo-still-cove', { workspace: 'still-cove' });
    const fleet = await assembleFleet(localIO, loadConfig({ CCRC_HOME: home }), new Tmux(async () => ({ code: 1, stdout: '', stderr: '' })));
    expect(fleet.find((x) => x.id === 'demo-still-cove')!.pr!.phase).toBe('unchecked');
  });

  it('gives a MAIN CHECKOUT no pr object at all — no workspace, no cap', async () => {
    const home = mkTmp('ccrc-');
    seedSession(home, 'claude-demo', 'claude');
    const fleet = await assembleFleet(localIO, loadConfig({ CCRC_HOME: home }), new Tmux(async () => ({ code: 1, stdout: '', stderr: '' })));
    expect(fleet.find((x) => x.id === 'claude-demo')!.pr).toBeNull();
  });

  it('prefers a live swept state over the persisted one', async () => {
    const home = mkTmp('ccrc-');
    seedSession(home, 'demo-quiet-basin', 'claude');
    seedPr(home, 'demo-quiet-basin', { workspace: 'quiet-basin', prphase: 'open', prnumber: '7' });
    const live = new Map<string, PrState>([['demo-quiet-basin', {
      phase: 'merged', number: 7, url: 'u', title: 't', checks: 'pass', checkNames: null,
      ahead: 3, reason: null, checkedAt: 5, mergedAt: 4,
    }]]);
    const fleet = await assembleFleet(
      localIO, loadConfig({ CCRC_HOME: home }), new Tmux(async () => ({ code: 1, stdout: '', stderr: '' })),
      undefined, undefined, undefined, undefined, live);
    expect(fleet.find((x) => x.id === 'demo-quiet-basin')!.pr!.phase).toBe('merged');
  });

  it('carries archivedAt straight through', async () => {
    const home = mkTmp('ccrc-');
    seedSession(home, 'demo-quiet-basin', 'claude');
    seedPr(home, 'demo-quiet-basin', { workspace: 'quiet-basin', archived: '1785300123' });
    const fleet = await assembleFleet(localIO, loadConfig({ CCRC_HOME: home }), new Tmux(async () => ({ code: 1, stdout: '', stderr: '' })));
    expect(fleet.find((x) => x.id === 'demo-quiet-basin')!.archivedAt).toBe(1785300123);
  });
});

describe('archived size on the wire', () => {
  it('reads worktreeBytes out of the archive manifest ws-archive wrote', async () => {
    const home = mkTmp('ccrc-');
    seedSession(home, 'demo-quiet-basin', 'claude');
    const reg = path.join(home, '.cc-sessions');
    writeFileSync(path.join(reg, 'demo-quiet-basin.workspace'), 'quiet-basin');
    writeFileSync(path.join(reg, 'demo-quiet-basin.archived'), '1785300123');
    writeFileSync(path.join(reg, 'demo-quiet-basin.archivemanifest'),
      JSON.stringify({ branch: 'ws/quiet-basin', worktreeBytes: 1_200_000_000 }));
    const fleet = await assembleFleet(localIO, loadConfig({ CCRC_HOME: home }), new Tmux(async () => ({ code: 1, stdout: '', stderr: '' })));
    expect(fleet.find((s) => s.id === 'demo-quiet-basin')!.archivedBytes).toBe(1_200_000_000);
  });

  it('is null when there is no manifest, or it is unparseable', async () => {
    // A missing figure must read as "unknown", never as 0 — a footer claiming
    // 0 GB would argue against a cleanup that would actually free gigabytes.
    const home = mkTmp('ccrc-');
    seedSession(home, 'demo-still-cove', 'claude');
    const reg = path.join(home, '.cc-sessions');
    writeFileSync(path.join(reg, 'demo-still-cove.workspace'), 'still-cove');
    writeFileSync(path.join(reg, 'demo-still-cove.archived'), '1785300123');
    writeFileSync(path.join(reg, 'demo-still-cove.archivemanifest'), 'half-writ');
    const fleet = await assembleFleet(localIO, loadConfig({ CCRC_HOME: home }), new Tmux(async () => ({ code: 1, stdout: '', stderr: '' })));
    expect(fleet.find((s) => s.id === 'demo-still-cove')!.archivedBytes).toBeNull();
  });

  it('is null when the manifest file itself was never written at all', async () => {
    // Distinct from the case above: no `.archivemanifest` file exists (the
    // `field()` read resolves to null), never that its content failed to
    // parse. Both must land on null, and this is the ONLY case in this
    // describe block that exercises manifestBytes's `raw === null` branch —
    // a mutant turning it into `return 0` survives every other test here,
    // since seedSession() never writes this file for any other fixture in
    // this suite either.
    const home = mkTmp('ccrc-');
    seedSession(home, 'demo-far-hollow', 'claude');
    const reg = path.join(home, '.cc-sessions');
    writeFileSync(path.join(reg, 'demo-far-hollow.workspace'), 'far-hollow');
    writeFileSync(path.join(reg, 'demo-far-hollow.archived'), '1785300123');
    // No .archivemanifest file written at all.
    const fleet = await assembleFleet(localIO, loadConfig({ CCRC_HOME: home }), new Tmux(async () => ({ code: 1, stdout: '', stderr: '' })));
    expect(fleet.find((s) => s.id === 'demo-far-hollow')!.archivedBytes).toBeNull();
  });

  it('is null when the manifest is valid JSON but never wrote worktreeBytes', async () => {
    // The `deviation 10` reconciliation this task ships: a manifest
    // ws-archive wrote with a partial `du` failure could plausibly omit the
    // key entirely rather than write malformed JSON — this is the "partial
    // du fallback" case named in the task brief, and it must land on null,
    // never silently coerce `undefined` into a number.
    const home = mkTmp('ccrc-');
    seedSession(home, 'demo-thin-reach', 'claude');
    const reg = path.join(home, '.cc-sessions');
    writeFileSync(path.join(reg, 'demo-thin-reach.workspace'), 'thin-reach');
    writeFileSync(path.join(reg, 'demo-thin-reach.archived'), '1785300123');
    writeFileSync(path.join(reg, 'demo-thin-reach.archivemanifest'),
      JSON.stringify({ branch: 'ws/thin-reach' }));
    const fleet = await assembleFleet(localIO, loadConfig({ CCRC_HOME: home }), new Tmux(async () => ({ code: 1, stdout: '', stderr: '' })));
    expect(fleet.find((s) => s.id === 'demo-thin-reach')!.archivedBytes).toBeNull();
  });

  it('treats a non-finite worktreeBytes as unknown, never as Infinity', async () => {
    // JSON syntax permits a numeral outside double-precision range (1e400);
    // JSON.parse silently overflows it to Infinity, which `typeof` still
    // calls 'number' — exactly the shape numOrNull's own doc comment warns
    // about for NaN. Infinity is not a byte count either.
    const home = mkTmp('ccrc-');
    seedSession(home, 'demo-far-shore', 'claude');
    const reg = path.join(home, '.cc-sessions');
    writeFileSync(path.join(reg, 'demo-far-shore.workspace'), 'far-shore');
    writeFileSync(path.join(reg, 'demo-far-shore.archived'), '1785300123');
    writeFileSync(path.join(reg, 'demo-far-shore.archivemanifest'),
      '{"branch":"ws/far-shore","worktreeBytes":1e400}');
    const fleet = await assembleFleet(localIO, loadConfig({ CCRC_HOME: home }), new Tmux(async () => ({ code: 1, stdout: '', stderr: '' })));
    expect(fleet.find((s) => s.id === 'demo-far-shore')!.archivedBytes).toBeNull();
  });
});
