import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { assembleFleet, hookAskSummary, idHomeWrapper, liveStatus } from '../src/fleet.js';
import { Tmux, type Runner } from '../src/exec.js';
import { localIO, type FleetIO } from '../src/io.js';
import type { Statusline } from '../src/pane/statusline.js';
import type { HookState } from '../src/hookstate.js';
import type { PrState } from '../../shared/api.js';
import { parseRoster } from '../../shared/roster.js';
import { mkTmp } from './tmpHelpers.js';
import { DEFAULT_TEST_ROSTER, seedRoster } from './helpers.js';

const seedSession = (home: string, id: string, wrapper: string, extra: Record<string, string> = {}) => {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const fields = { wrapper, project: id, workdir: `/data/projects/${id}`, uuid: '1'.repeat(36), started: '1', ...extra };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${k}`), v);
};

const mkHookState = (over: Partial<HookState> = {}): HookState =>
  ({ state: 'working', updatedAt: 1784600000000, event: null, ask: null, subagents: [], interrupted: false, ...over });

describe('idHomeWrapper', () => {
  const roster = parseRoster(DEFAULT_TEST_ROSTER);

  it('longest prefix wins', () => {
    expect(idHomeWrapper(roster, 'claude-corp-orchard-api')).toBe('claude-corp');
    expect(idHomeWrapper(roster, 'claude2-MekWarLive')).toBe('claude2');
    expect(idHomeWrapper(roster, 'claude-synapsium-platform')).toBe('claude');
    expect(idHomeWrapper(roster, 'gpt-foo')).toBe('gpt');
  });

  // Not prophylactic: `claude-dev0-*` ids exist in the registry today. The old
  // prefix list (a hand-typed, unordered array) never even MENTIONED
  // `claude-dev0`, so `claude-dev0-quiet-basin` fell through to the bare
  // `'claude-'` branch — this assertion was GREEN with the WRONG answer before
  // the fix (confirmed against the exact pre-fix source: it returned
  // `'claude'`). `roster.byIdLengthDesc` is what keeps it right: `claude-dev0`
  // (11 chars) is tried before `claude` (6).
  it('resolves claude-dev0 sessions to claude-dev0, not to claude', () => {
    expect(idHomeWrapper(roster, 'claude-dev0-quiet-basin')).toBe('claude-dev0');
  });

  // The ordering property, isolated from the production names that happen to
  // exhibit it — a roster of two accounts where one id is a strict prefix of
  // the other, which is the collision `byIdLengthDesc` exists for. Free-form
  // ids (the point of Stage 2a) make this reachable by anyone writing an
  // `accounts.json`, not just by the five names that shipped.
  it('resolves the longer id when one account id is a prefix of another', () => {
    const r = parseRoster({ version: 1, accounts: [
      { id: 'claude', label: 'c', configDirSuffix: '.claude', exec: { kind: 'upstream' }, homeAble: true, hue: 'cyan', telemetry: 'anthropic' },
      { id: 'claude-dev0', label: 'd', configDirSuffix: '.claude-dev0', exec: { kind: 'generated' }, homeAble: true, hue: 'violet', telemetry: 'anthropic' },
    ] });
    expect(idHomeWrapper(r, 'claude-dev0-quiet-basin')).toBe('claude-dev0');
    expect(idHomeWrapper(r, 'claude-quiet-basin')).toBe('claude');
    // The fallback branch, which no test covered before: an id with no account
    // prefix at all — a main checkout's id is the bare project name. It answers
    // the roster's UPSTREAM account (the one running the Claude Code binary
    // itself), not the literal string 'claude', which is only this roster's
    // name for it.
    expect(idHomeWrapper(r, 'zzz-quiet-basin')).toBe('claude');
  });

  it('falls back to the upstream account whatever it is called', () => {
    // The same fallback on a roster where the upstream account is NOT named
    // `claude` — the assertion above cannot tell the two rules apart.
    const r = parseRoster({ version: 1, accounts: [
      { id: 'work', label: 'w', configDirSuffix: '.work', exec: { kind: 'generated' }, homeAble: true, hue: 'cyan', telemetry: 'anthropic' },
      { id: 'main', label: 'm', configDirSuffix: '.main', exec: { kind: 'upstream' }, homeAble: true, hue: 'violet', telemetry: 'anthropic' },
    ] });
    expect(idHomeWrapper(r, 'OpenClawHetzner')).toBe('main');
  });
});

describe('assembleFleet', () => {
  it('joins registry, live state, limits, and tmux aliveness', async () => {
    const home = mkTmp('ccrc-');
    seedRoster(home);
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

// Registry ladder (architecture doc, increment 1's second half): `liveStatus`
// backs `POST /api/sessions/:id/interrupt`'s own busy check
// (`server.ts:514`) — a degraded row reading 'dead' makes that route refuse
// an interrupt on a session that is plainly mid-turn, fails-open in exactly
// the direction spec's own THE PRINCIPLE forbids ("fails toward refusing an
// interrupt"). Written FIRST and confirmed red against the pre-ladder code,
// where `readSessionRecord`'s old `null`-on-any-unreadable-field answer made
// `!rec` true for a row this fixture proves is genuinely busy.
describe('liveStatus', () => {
  it('answers busy for a session with an unmeasured (but IRRELEVANT to this question) workdir/uuid — ' +
     'never dead, never blind to a live pane because of a read failure on a field it does not even use', async () => {
    const home = mkTmp('ccrc-');
    seedRoster(home);
    seedSession(home, 'claude-quiet-mesa', 'claude');
    const cfgDir = path.join(home, '.claude');
    mkdirSync(path.join(cfgDir, 'sessions'), { recursive: true });
    writeFileSync(path.join(cfgDir, 'sessions', '4242.json'), JSON.stringify({
      pid: 4242, sessionId: '1'.repeat(36), cwd: '/data/projects/claude-quiet-mesa',
      status: 'busy', statusUpdatedAt: 1784600000000,
    }));
    const run: Runner = async (_cmd, args) => {
      if (args[0] === 'has-session') return { code: 0, stdout: '', stderr: '' };
      if (args[0] === 'list-panes') return { code: 0, stdout: '4242\n', stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    };
    // `workdir` (irrelevant to liveStatus: it never reads it) is the ONE
    // unreadable field — `wrapper` (which liveStatus DOES need, to resolve
    // cfgDir) reads clean.
    const unreadableWorkdir: FleetIO = {
      ...localIO,
      readFile: async (p) => (p.endsWith('claude-quiet-mesa.workdir') ? null : localIO.readFile(p)),
    };
    const status = await liveStatus(unreadableWorkdir, loadConfig({ CCRC_HOME: home }), new Tmux(run), 'claude-quiet-mesa');
    expect(status).toBe('busy');
  });

  it('still answers dead for a session genuinely absent from the registry', async () => {
    const home = mkTmp('ccrc-');
    seedRoster(home);
    const run: Runner = async () => ({ code: 0, stdout: '', stderr: '' });
    const status = await liveStatus(localIO, loadConfig({ CCRC_HOME: home }), new Tmux(run), 'claude-nope');
    expect(status).toBe('dead');
  });

  it('answers idle (never dead, never a throw) for an unmeasured WRAPPER — the existing !cfgDir fallback', async () => {
    const home = mkTmp('ccrc-');
    seedRoster(home);
    seedSession(home, 'claude-quiet-mesa', 'claude');
    const run: Runner = async (_cmd, args) => {
      if (args[0] === 'has-session') return { code: 0, stdout: '', stderr: '' };
      if (args[0] === 'list-panes') return { code: 0, stdout: '4242\n', stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    };
    const unreadableWrapper: FleetIO = {
      ...localIO,
      readFile: async (p) => (p.endsWith('claude-quiet-mesa.wrapper') ? null : localIO.readFile(p)),
    };
    const status = await liveStatus(unreadableWrapper, loadConfig({ CCRC_HOME: home }), new Tmux(run), 'claude-quiet-mesa');
    expect(status).toBe('idle');
  });
});

describe('branch precedence', () => {
  const setup = (): { home: string; run: Runner } => {
    const home = mkTmp('ccrc-');
    seedRoster(home);
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
    seedRoster(home);
    seedSession(home, 'claude-demo', 'claude');
    const run: Runner = async () => ({ code: 1, stdout: '', stderr: '' });
    const fleet = await assembleFleet(localIO, loadConfig({ CCRC_HOME: home }), new Tmux(run), 1784600000);
    expect(fleet.find((s) => s.id === 'claude-demo')!.branch).toBeNull();
  });
});

describe('derived session handles', () => {
  const build = async (live: Record<string, unknown>) => {
    const home = mkTmp('ccrc-');
    seedRoster(home);
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
    seedRoster(home);
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
    seedRoster(home);
    seedSession(home, 'demo-still-cove', 'claude');
    seedPr(home, 'demo-still-cove', { workspace: 'still-cove' });
    const fleet = await assembleFleet(localIO, loadConfig({ CCRC_HOME: home }), new Tmux(async () => ({ code: 1, stdout: '', stderr: '' })));
    expect(fleet.find((x) => x.id === 'demo-still-cove')!.pr!.phase).toBe('unchecked');
  });

  it('gives a MAIN CHECKOUT no pr object at all — no workspace, no cap', async () => {
    const home = mkTmp('ccrc-');
    seedRoster(home);
    seedSession(home, 'claude-demo', 'claude');
    const fleet = await assembleFleet(localIO, loadConfig({ CCRC_HOME: home }), new Tmux(async () => ({ code: 1, stdout: '', stderr: '' })));
    expect(fleet.find((x) => x.id === 'claude-demo')!.pr).toBeNull();
  });

  it('prefers a live swept state over the persisted one', async () => {
    const home = mkTmp('ccrc-');
    seedRoster(home);
    seedSession(home, 'demo-quiet-basin', 'claude');
    seedPr(home, 'demo-quiet-basin', { workspace: 'quiet-basin', prphase: 'open', prnumber: '7' });
    const live = new Map<string, PrState>([['demo-quiet-basin', {
      phase: 'merged', number: 7, url: 'u', title: 't', checks: 'pass', checkNames: null,
      // `retryAt` is REQUIRED on `PrState` (shared/api.ts) and was missing here.
      // Harmless at runtime — `assembleFleet` only reads `.phase` — but it was
      // a real TS2769 that no gate could see, because the server's tsconfig
      // `include` never covered `test/`. Deviation 80 carried it knowingly;
      // final review, integration finding 4 confirmed it was the ONLY one
      // hiding in the whole directory. `null` is the right value, not `0`: a
      // merged PR has no scheduled retry, and a number here would be a
      // measurement nobody made.
      ahead: 3, reason: null, checkedAt: 5, mergedAt: 4, retryAt: null,
    }]]);
    const fleet = await assembleFleet(
      localIO, loadConfig({ CCRC_HOME: home }), new Tmux(async () => ({ code: 1, stdout: '', stderr: '' })),
      undefined, undefined, undefined, undefined, live);
    expect(fleet.find((x) => x.id === 'demo-quiet-basin')!.pr!.phase).toBe('merged');
  });

  it('carries archivedAt straight through', async () => {
    const home = mkTmp('ccrc-');
    seedRoster(home);
    seedSession(home, 'demo-quiet-basin', 'claude');
    seedPr(home, 'demo-quiet-basin', { workspace: 'quiet-basin', archived: '1785300123' });
    const fleet = await assembleFleet(localIO, loadConfig({ CCRC_HOME: home }), new Tmux(async () => ({ code: 1, stdout: '', stderr: '' })));
    expect(fleet.find((x) => x.id === 'demo-quiet-basin')!.archivedAt).toBe(1785300123);
  });

  // Fix round, finding 2. `held: r.held` is this task's ONE server line and it
  // had no test: `hold-gate.test.ts` exercises `archiveMerged` against
  // `SessionRecord`, never `assembleFleet`, so `held: null` here would have
  // stayed green everywhere while every held workspace reached the phone
  // unheld — no chip, and the actions sheet offering Hold instead of Release,
  // which is the ONLY PWA route to the release that `ws-reap`'s refusal
  // sentence tells the operator to take. Same shape as `archivedAt` above:
  // the registry field, verbatim, on the assembled session.
  it('carries held straight through, verbatim', async () => {
    const home = mkTmp('ccrc-');
    seedRoster(home);
    seedSession(home, 'demo-quiet-basin', 'claude', {
      workspace: 'quiet-basin', hold: 'program:agent-evals wave:2/4',
    });
    seedSession(home, 'demo-still-lake', 'claude', { workspace: 'still-lake' });
    const fleet = await assembleFleet(localIO, loadConfig({ CCRC_HOME: home }), new Tmux(async () => ({ code: 1, stdout: '', stderr: '' })));
    expect(fleet.find((x) => x.id === 'demo-quiet-basin')!.held).toBe('program:agent-evals wave:2/4');
    // Absence IS release — the verb unlinks — so no `.hold` file must reach
    // the wire as null, not as an empty string a chip would render blank.
    expect(fleet.find((x) => x.id === 'demo-still-lake')!.held).toBeNull();
  });
});

describe('archived size on the wire', () => {
  it('reads worktreeBytes out of the archive manifest ws-archive wrote', async () => {
    const home = mkTmp('ccrc-');
    seedRoster(home);
    seedSession(home, 'demo-quiet-basin', 'claude');
    const reg = path.join(home, '.cc-sessions');
    writeFileSync(path.join(reg, 'demo-quiet-basin.workspace'), 'quiet-basin');
    writeFileSync(path.join(reg, 'demo-quiet-basin.archived'), '1785300123');
    writeFileSync(path.join(reg, 'demo-quiet-basin.archivemanifest'),
      JSON.stringify({ branch: 'ws/quiet-basin', worktreeBytes: 1_200_000_000 }));
    const fleet = await assembleFleet(localIO, loadConfig({ CCRC_HOME: home }), new Tmux(async () => ({ code: 1, stdout: '', stderr: '' })));
    expect(fleet.find((s) => s.id === 'demo-quiet-basin')!.archivedBytes).toBe(1_200_000_000);
  });

  // Pre-merge fix round, finding 5: ccd now writes the EXPLICIT JSON value
  // `null` (not an omitted key) for `worktreeBytes` when a `du` failed on an
  // otherwise-readable worktree. `manifestBytes`'s own `typeof n === 'number'`
  // check already excludes `null` (`typeof null === 'object'`), so this closes
  // the coverage gap for the exact shape ccd now emits — every sibling test in
  // this block exercises a DIFFERENT shape (omitted key, unparseable JSON, no
  // manifest file, non-finite number), none of them this one.
  it('is null when the manifest explicitly writes worktreeBytes as JSON null — the failed-du shape ccd now emits', async () => {
    const home = mkTmp('ccrc-');
    seedRoster(home);
    seedSession(home, 'demo-lone-creek', 'claude');
    const reg = path.join(home, '.cc-sessions');
    writeFileSync(path.join(reg, 'demo-lone-creek.workspace'), 'lone-creek');
    writeFileSync(path.join(reg, 'demo-lone-creek.archived'), '1785300123');
    writeFileSync(path.join(reg, 'demo-lone-creek.archivemanifest'),
      JSON.stringify({ branch: 'ws/lone-creek', worktreeBytes: null }));
    const fleet = await assembleFleet(localIO, loadConfig({ CCRC_HOME: home }), new Tmux(async () => ({ code: 1, stdout: '', stderr: '' })));
    expect(fleet.find((s) => s.id === 'demo-lone-creek')!.archivedBytes).toBeNull();
  });

  it('is null when there is no manifest, or it is unparseable', async () => {
    // A missing figure must read as "unknown", never as 0 — a footer claiming
    // 0 GB would argue against a cleanup that would actually free gigabytes.
    const home = mkTmp('ccrc-');
    seedRoster(home);
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
    seedRoster(home);
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
    seedRoster(home);
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
    seedRoster(home);
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

describe('hook state on the wire', () => {
  it('a fresh hookstate carries hookState, askSummary and subagents onto the session', async () => {
    const home = mkTmp('ccrc-');
    seedRoster(home);
    seedSession(home, 'claude-demo', 'claude');
    const hookStates = new Map<string, HookState>([
      ['claude-demo', mkHookState({
        state: 'waiting',
        ask: { questions: [{ question: 'Pick one', header: 'Choose', options: [{ label: 'A' }, { label: 'B' }] }] },
        subagents: [{ name: 'reviewer', startedAt: 1000 }],
      })],
    ]);
    const fleet = await assembleFleet(
      localIO, loadConfig({ CCRC_HOME: home }), new Tmux(async () => ({ code: 1, stdout: '', stderr: '' })), 1784600000,
      undefined, undefined, undefined, undefined, hookStates,
    );
    const s = fleet.find((x) => x.id === 'claude-demo')!;
    expect(s.hookState).toBe('waiting');
    expect(s.askSummary).toBe('Choose');
    expect(s.subagents).toEqual([{ name: 'reviewer', startedAt: 1000 }]);
  });

  it('a hookless session carries all three fields as null', async () => {
    const home = mkTmp('ccrc-');
    seedRoster(home);
    seedSession(home, 'claude-demo', 'claude');
    // No `hookStates` map at all — the shape every existing caller had before
    // this task, and still the shape a cold `/api/fleet` REST call can be.
    const fleet = await assembleFleet(
      localIO, loadConfig({ CCRC_HOME: home }), new Tmux(async () => ({ code: 1, stdout: '', stderr: '' })), 1784600000,
    );
    const s = fleet.find((x) => x.id === 'claude-demo')!;
    expect(s.hookState).toBeNull();
    expect(s.askSummary).toBeNull();
    expect(s.subagents).toBeNull();
  });

  it('dialogPending is true when only the pane detector says so', async () => {
    const home = mkTmp('ccrc-');
    seedRoster(home);
    seedSession(home, 'claude-demo', 'claude');
    const pending = new Set(['claude-demo']);
    const fleet = await assembleFleet(
      localIO, loadConfig({ CCRC_HOME: home }), new Tmux(async () => ({ code: 1, stdout: '', stderr: '' })), 1784600000, pending,
    );
    expect(fleet.find((x) => x.id === 'claude-demo')!.dialogPending).toBe(true);
  });

  it('dialogPending is true when only the hook reports waiting — the pane never painted a menu', async () => {
    const home = mkTmp('ccrc-');
    seedRoster(home);
    seedSession(home, 'claude-demo', 'claude');
    const hookStates = new Map<string, HookState>([['claude-demo', mkHookState({ state: 'waiting' })]]);
    const fleet = await assembleFleet(
      localIO, loadConfig({ CCRC_HOME: home }), new Tmux(async () => ({ code: 1, stdout: '', stderr: '' })), 1784600000,
      undefined, undefined, undefined, undefined, hookStates,
    );
    const s = fleet.find((x) => x.id === 'claude-demo')!;
    expect(s.dialogPending).toBe(true);
    // The tmux stub always fails `has-session`, so this session is dead —
    // `waiting` earning dialogPending must not also earn it a status.
    expect(s.status).toBe('dead');
  });

  it('dialogPending is false when NEITHER source says so — a working hook is not a pending dialog', async () => {
    const home = mkTmp('ccrc-');
    seedRoster(home);
    seedSession(home, 'claude-demo', 'claude');
    const hookStates = new Map<string, HookState>([['claude-demo', mkHookState({ state: 'working' })]]);
    const fleet = await assembleFleet(
      localIO, loadConfig({ CCRC_HOME: home }), new Tmux(async () => ({ code: 1, stdout: '', stderr: '' })), 1784600000,
      undefined, undefined, undefined, undefined, hookStates,
    );
    expect(fleet.find((x) => x.id === 'claude-demo')!.dialogPending).toBe(false);
  });

  it('status is IDENTICAL with and without a hookstate for the same fixture — status is frozen against hook data', async () => {
    const home = mkTmp('ccrc-');
    seedRoster(home);
    seedSession(home, 'claude2-MekWarLive', 'claude2');
    mkdirSync(path.join(home, '.claude-personal', 'sessions'), { recursive: true });
    writeFileSync(path.join(home, '.claude-personal', 'sessions', '40613.json'), JSON.stringify({
      pid: 40613, sessionId: '1'.repeat(36), cwd: '/data/projects/MekWarLive',
      name: 'mekwar-a1', status: 'busy', statusUpdatedAt: 1784582728369, version: '2.1.210',
    }));
    const run: Runner = async (_cmd, args) => {
      if (args[0] === 'has-session') return { code: args.includes('cc-claude2-MekWarLive') ? 0 : 1, stdout: '', stderr: '' };
      if (args[0] === 'list-panes') return { code: 0, stdout: '40613\n', stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    };
    const cfg = loadConfig({ CCRC_HOME: home });

    const withoutHook = await assembleFleet(localIO, cfg, new Tmux(run), 1784600000);
    const hookStates = new Map<string, HookState>([['claude2-MekWarLive', mkHookState({ state: 'done' })]]);
    const withHook = await assembleFleet(
      localIO, cfg, new Tmux(run), 1784600000, undefined, undefined, undefined, undefined, hookStates,
    );
    // `waiting` is the state most likely to tempt a status-derivation bug
    // specifically — it is also the value dialogPending's OR-rule reads, so a
    // fix or refactor near that line reaching one line too far (promoting an
    // idle status to busy, or demoting this already-busy one) is the exact
    // regression this fixture exists to catch. `done` above cannot pin that:
    // it shares no vocabulary with anything status-adjacent.
    const waitingHookStates = new Map<string, HookState>([['claude2-MekWarLive', mkHookState({ state: 'waiting' })]]);
    const withWaitingHook = await assembleFleet(
      localIO, cfg, new Tmux(run), 1784600000, undefined, undefined, undefined, undefined, waitingHookStates,
    );

    const before = withoutHook.find((x) => x.id === 'claude2-MekWarLive')!;
    const after = withHook.find((x) => x.id === 'claude2-MekWarLive')!;
    const afterWaiting = withWaitingHook.find((x) => x.id === 'claude2-MekWarLive')!;
    expect(before.status).toBe('busy');
    expect(after.status).toBe(before.status);
    expect(afterWaiting.status).toBe(before.status);
    // The mutant this pins: only the hook-derived fields may differ.
    expect(before.hookState).toBeNull();
    expect(after.hookState).toBe('done');
    expect(afterWaiting.hookState).toBe('waiting');
  });
});

describe('hookAskSummary', () => {
  it('is null when there is no hook state at all', () => {
    expect(hookAskSummary(null)).toBeNull();
  });

  it('is null when the hook state is not waiting', () => {
    expect(hookAskSummary(mkHookState({ state: 'working' }))).toBeNull();
    expect(hookAskSummary(mkHookState({ state: 'done' }))).toBeNull();
  });

  it('is null for a waiting state with no ask envelope yet — the hook can report waiting a beat before the ask write lands', () => {
    expect(hookAskSummary(mkHookState({ state: 'waiting', ask: null }))).toBeNull();
  });

  it("uses the first question's header when present", () => {
    const hs = mkHookState({
      state: 'waiting',
      ask: {
        questions: [
          { question: 'Full question text nobody should read on a card', header: 'Pick a database', options: [] },
          { question: 'A second question, never consulted', options: [] },
        ],
      },
    });
    expect(hookAskSummary(hs)).toBe('Pick a database');
  });

  it('falls back to the question text when there is no header', () => {
    const hs = mkHookState({
      state: 'waiting',
      ask: { questions: [{ question: 'Which branch should this land on?', options: [] }] },
    });
    expect(hookAskSummary(hs)).toBe('Which branch should this land on?');
  });

  it('falls back to the question text when the header is empty or whitespace-only — a real shape, since header is optional on the tool call itself', () => {
    const empty = mkHookState({
      state: 'waiting',
      ask: { questions: [{ question: 'Which branch should this land on?', header: '', options: [] }] },
    });
    expect(hookAskSummary(empty)).toBe('Which branch should this land on?');
    const whitespace = mkHookState({
      state: 'waiting',
      ask: { questions: [{ question: 'Which branch should this land on?', header: '   ', options: [] }] },
    });
    expect(hookAskSummary(whitespace)).toBe('Which branch should this land on?');
  });

  it('formats an approval as "tool: summary"', () => {
    const hs = mkHookState({ state: 'waiting', ask: { approval: { tool: 'Bash', summary: 'rm -rf node_modules' } } });
    expect(hookAskSummary(hs)).toBe('Bash: rm -rf node_modules');
  });

  it('is null when an approval has neither a tool nor a summary — never the bare ": "', () => {
    const hs = mkHookState({ state: 'waiting', ask: { approval: { tool: '', summary: '' } } });
    expect(hookAskSummary(hs)).toBeNull();
  });

  it('clips a question summary to 80 characters', () => {
    const long = 'x'.repeat(120);
    const hs = mkHookState({ state: 'waiting', ask: { questions: [{ question: long, options: [] }] } });
    const out = hookAskSummary(hs);
    expect(out).toHaveLength(80);
    expect(out).toBe(long.slice(0, 80));
  });

  it('clips an approval summary to 80 characters', () => {
    const hs = mkHookState({ state: 'waiting', ask: { approval: { tool: 'Bash', summary: 'y'.repeat(120) } } });
    expect(hookAskSummary(hs)).toHaveLength(80);
  });
});
