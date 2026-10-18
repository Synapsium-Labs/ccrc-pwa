import { describe, it, expect, vi } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { assembleFleet, hookAskSummary, idHomeWrapper, liveStatus } from '../src/fleet.js';
import { Tmux, type Runner } from '../src/exec.js';
import { localIO } from '../src/io.js';
import type { Statusline } from '../src/pane/statusline.js';
import { readHookStateRawMeasured, type HookState } from '../src/hookstate.js';
import { ASK_OPERATOR_PRINCIPAL, SERVER_CAPS_FILE, renderServerCaps, reviveFleetSession, type PrState } from '../../shared/api.js';
import { parseRoster } from '../../shared/roster.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { ASK_HELD_CHIP_MAX_MS } from '../src/askwindow.js';
import { mkTmp } from './tmpHelpers.js';
import { DEFAULT_TEST_ROSTER, seedRoster } from './helpers.js';
import { degradedReadIO, unreadableField } from './ioDoubles.js';

const seedSession = (home: string, id: string, wrapper: string, extra: Record<string, string> = {}) => {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const fields = { wrapper, project: id, workdir: `/data/projects/${id}`, uuid: '1'.repeat(36), started: '1', ...extra };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${k}`), v);
};

const mkHookState = (over: Partial<HookState> = {}): HookState =>
  ({ state: 'working', updatedAt: 1784600000000, event: null, ask: null, subagents: [], graphQueries: 0, graphGateDenials: 0, interrupted: false, ...over });

describe('idHomeWrapper', () => {
  const roster = parseRoster(DEFAULT_TEST_ROSTER);

  it('longest prefix wins', () => {
    expect(idHomeWrapper(roster, 'claude-b-demo-app-ts')).toBe('claude-b');
    expect(idHomeWrapper(roster, 'claude-a-MekWarLive')).toBe('claude-a');
    expect(idHomeWrapper(roster, 'claude-synapsium-platform')).toBe('claude');
    expect(idHomeWrapper(roster, 'gpt-foo')).toBe('gpt');
  });

  // Not prophylactic: `claude-d-*` ids exist in the registry today. The old
  // prefix list (a hand-typed, unordered array) never even MENTIONED
  // `claude-d`, so `claude-d-quiet-basin` fell through to the bare
  // `'claude-'` branch — this assertion was GREEN with the WRONG answer before
  // the fix (confirmed against the exact pre-fix source: it returned
  // `'claude'`). `roster.byIdLengthDesc` is what keeps it right: `claude-d`
  // (11 chars) is tried before `claude` (6).
  it('resolves claude-d sessions to claude-d, not to claude', () => {
    expect(idHomeWrapper(roster, 'claude-d-quiet-basin')).toBe('claude-d');
  });

  // The ordering property, isolated from the production names that happen to
  // exhibit it — a roster of two accounts where one id is a strict prefix of
  // the other, which is the collision `byIdLengthDesc` exists for. Free-form
  // ids (the point of Stage 2a) make this reachable by anyone writing an
  // `accounts.json`, not just by the five names that shipped.
  it('resolves the longer id when one account id is a prefix of another', () => {
    const r = parseRoster({ version: 1, accounts: [
      { id: 'claude', label: 'c', configDirSuffix: '.claude', exec: { kind: 'upstream' }, homeAble: true, hue: 'cyan', telemetry: 'anthropic' },
      { id: 'claude-d', label: 'd', configDirSuffix: '.claude-d', exec: { kind: 'generated' }, homeAble: true, hue: 'violet', telemetry: 'anthropic' },
    ] });
    expect(idHomeWrapper(r, 'claude-d-quiet-basin')).toBe('claude-d');
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
    seedSession(home, 'claude-a-MekWarLive', 'claude-a');
    seedSession(home, 'claude-dead-proj', 'claude');
    mkdirSync(path.join(home, '.claude-a', 'sessions'), { recursive: true });
    writeFileSync(path.join(home, '.claude-a', 'sessions', '40613.json'), JSON.stringify({
      pid: 40613, sessionId: '1'.repeat(36), cwd: '/data/projects/MekWarLive',
      name: 'mekwar-a1', status: 'busy', statusUpdatedAt: 1784582728369, version: '2.1.210',
    }));
    mkdirSync(path.join(home, '.cc-limits'), { recursive: true });
    const now = 1784600000;
    writeFileSync(path.join(home, '.cc-limits', 'claude-a.json'), JSON.stringify({ five: 55, seven: 70, ts: now - 60 }));

    const run: Runner = async (_cmd, args) => {
      if (args[0] === 'has-session') return { code: args.includes('=cc-claude-a-MekWarLive:') ? 0 : 1, stdout: '', stderr: '' };
      if (args[0] === 'list-panes') return { code: 0, stdout: '40613\n', stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    };

    const fleet = await assembleFleet(localIO, loadConfig({ CCRC_HOME: home }), new Tmux(run), now);
    const mek = fleet.find((s) => s.id === 'claude-a-MekWarLive')!;
    expect(mek.status).toBe('busy');
    expect(mek.name).toBe('mekwar-a1');
    expect(mek.limits).toEqual({ five: 55, seven: 70 });
    expect(mek.home).toBe('claude-a');
    const dead = fleet.find((s) => s.id === 'claude-dead-proj')!;
    expect(dead.status).toBe('dead');
    expect(dead.name).toBeNull();
  });
});

// D-5301 (coordinator-first spec §8): every session the operator creates is a
// coordinator, and the role is DERIVED from the one marker only a dispatch
// writes — `$REG/<id>.child` — never marked. The rows below are the same shape
// whichever operator path made them: a PWA "+", a `POST /api/sessions` start
// and a CLI create (`cc <wrapper> <project>`, a hand-run `ccd ws-add`) leave
// no `.child`, and no server route wrote any of these fixtures.
describe('assembleFleet: the session role (D-5301)', () => {
  it("is 'coordinator' for every row with no .child — a CLI create, a held row and a main checkout alike — and 'child' for a .child row, unreadable included", async () => {
    const home = mkTmp('ccrc-');
    seedRoster(home);
    // A CLI create: a workspace row nothing on the server made.
    seedSession(home, 'lane-a-project-a-calm-mesa', 'lane-a', { workspace: 'calm-mesa' });
    // A main checkout, started by hand.
    seedSession(home, 'lane-a-project-a', 'lane-a');
    // An operator-created row the operator then held: the hold is not the role.
    seedSession(home, 'lane-a-project-a-open-dune', 'lane-a', { workspace: 'open-dune', hold: 'parked' });
    // Dispatched children: a marker naming the minting run, and one that does not parse.
    seedSession(home, 'lane-a-project-a-quiet-basin', 'lane-a', { workspace: 'quiet-basin', child: '7' });
    seedSession(home, 'lane-a-project-a-still-cove', 'lane-a', { workspace: 'still-cove', child: 'not-a-run' });
    const run: Runner = async () => ({ code: 1, stdout: '', stderr: '' });
    const fleet = await assembleFleet(localIO, loadConfig({ CCRC_HOME: home }), new Tmux(run), 1784600000);
    const role = (id: string) => fleet.find((s) => s.id === id)!.role;
    expect(role('lane-a-project-a-calm-mesa')).toBe('coordinator');
    expect(role('lane-a-project-a')).toBe('coordinator');
    expect(role('lane-a-project-a-open-dune')).toBe('coordinator');
    expect(role('lane-a-project-a-quiet-basin')).toBe('child');
    // An unreadable marker is still a `.child` file: the start card (Task 9)
    // reads it as a child, so the badge does too — never a coordinator.
    expect(role('lane-a-project-a-still-cove')).toBe('child');
    // The fixtures are what they claim: the registry read both markers as children.
    expect(fleet.find((s) => s.id === 'lane-a-project-a-quiet-basin')!.child).toEqual({ kind: 'child', runId: 7 });
    expect(fleet.find((s) => s.id === 'lane-a-project-a-still-cove')!.child).toEqual({ kind: 'unreadable' });
  });

  describe('reviveFleetSession — role (ADDITIVE, absence-permits)', () => {
    const assembledRow = async (): Promise<Record<string, unknown>> => {
      const home = mkTmp('ccrc-');
      seedRoster(home);
      seedSession(home, 'lane-a-project-a', 'lane-a');
      const run: Runner = async () => ({ code: 1, stdout: '', stderr: '' });
      const [row] = await assembleFleet(localIO, loadConfig({ CCRC_HOME: home }), new Tmux(run), 1784600000);
      return JSON.parse(JSON.stringify(row)) as Record<string, unknown>;
    };

    it('a snapshot from before the field (no key) and an explicit null revive null — never re-derived from child', async () => {
      const raw = await assembledRow();
      delete raw['role'];
      expect(reviveFleetSession(raw)?.role).toBeNull();
      expect(reviveFleetSession({ ...raw, role: null })?.role).toBeNull();
    });

    it.each(['coordinator', 'child'] as const)('round-trips %s exactly', async (role) => {
      expect(reviveFleetSession({ ...(await assembledRow()), role })?.role).toBe(role);
    });

    it.each([['an unknown word', 'parent'], ['a boolean', true], ['an object', { kind: 'child' }]])(
      'rejects the WHOLE session on %s — never laundered into either role', async (_what, role) => {
        expect(reviveFleetSession({ ...(await assembledRow()), role })).toBeNull();
      });
  });
});

// Registry ladder (architecture doc, increment 1's second half): `liveStatus`
// backs `POST /api/sessions/:id/interrupt`'s own busy check
// (`server.ts:523`) — a degraded row reading 'dead' makes that route refuse
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
    const unreadableWorkdir = unreadableField('claude-quiet-mesa', 'workdir');
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
    const unreadableWrapper = unreadableField('claude-quiet-mesa', 'wrapper');
    const status = await liveStatus(unreadableWrapper, loadConfig({ CCRC_HOME: home }), new Tmux(run), 'claude-quiet-mesa');
    expect(status).toBe('idle');
  });
});

// D-115's third consumer, the display half. `readLiveState` folded "the file
// is there and I could not read it" into the same `null` as "there is no file
// yet", and `assembleFleet` reads that `null` as "leave `status` at the
// `alive` default" — which is `'idle'`. So a session whose `<pid>.json` this
// box could not read painted `idle · 1m ago` on the fleet card while its own
// pane showed the spinner: rest asserted on the strength of a permission bit,
// or of one dropped agent-WS round trip in remote mode.
//
// THE ASYMMETRY WITH `liveStatus` DIRECTLY ABOVE IS DELIBERATE, and the third
// case here pins it so the next reader finds the reason beside the pin rather
// than in a plan. Same failure, opposite answer, and both are fail-shut:
// `assembleFleet` DISPLAYS, so its dangerous direction is the reassuring one
// (`idle`); `liveStatus`'s sole consumer is the interrupt route
// (`server.ts`'s `… === 'busy'`), which REFUSES on anything but `busy`, so
// there the reassuring word is the safe one and "fail toward busy" would GRANT
// interrupts on a read that measured nothing. The two surfaces are not
// inconsistent — they are each failing away from the act that cannot be taken
// back.
describe('assembleFleet: an unmeasured live status file is not a session at rest (D-115)', () => {
  const ID = 'claude-quiet-mesa';
  const PID = 4242;
  const LIVE = path.join('sessions', `${PID}.json`);

  /** An alive pane whose live file says the session is IDLE — so a card that
   *  reads `busy` below can only have come from the guard, never from the
   *  file's own contents. */
  const setup = (withLive = true): { home: string; run: Runner } => {
    const home = mkTmp('ccrc-');
    seedRoster(home);
    seedSession(home, ID, 'claude');
    const cfgDir = path.join(home, '.claude');
    mkdirSync(path.join(cfgDir, 'sessions'), { recursive: true });
    if (withLive) {
      writeFileSync(path.join(cfgDir, 'sessions', `${PID}.json`), JSON.stringify({
        pid: PID, sessionId: '1'.repeat(36), cwd: `/data/projects/${ID}`,
        name: 'quiet-mesa-1', status: 'idle', statusUpdatedAt: 1784600000000, version: '2.1.233',
      }));
    }
    const run: Runner = async (_cmd, args) => {
      if (args[0] === 'has-session') return { code: 0, stdout: '', stderr: '' };
      if (args[0] === 'list-panes') return { code: 0, stdout: `${PID}\n`, stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    };
    return { home, run };
  };

  it('paints an unreadable live file busy, and invents none of the fields that file was carrying', async () => {
    const { home, run } = setup();
    const io = degradedReadIO((p) => p.endsWith(LIVE));
    const fleet = await assembleFleet(io, loadConfig({ CCRC_HOME: home }), new Tmux(run), 1784600000);
    const s = fleet.find((x) => x.id === ID)!;
    expect(s.status).toBe('busy');
    // An unmeasured read has no fields to report. Carrying a `statusUpdatedAt`
    // or a `version` through this arm would be the same defect one field over
    // — and `statusUpdatedAt` in particular is what the card renders as the
    // `· 1m ago` beside the word, so a fabricated one would put a fresh
    // timestamp under a status nobody measured.
    expect(s.statusUpdatedAt).toBeNull();
    expect(s.version).toBeNull();
    expect(s.name).toBeNull();
    expect(s.dialogPending).toBe(false);
  });

  it('… and an ABSENT live file still paints idle — the ordinary shape in the seconds after ws-add', async () => {
    // The positive control, and it is not decoration: it separates this fix
    // from "the fleet now paints every quiet session busy". A fresh workspace
    // whose pane has not published a `<pid>.json` yet is the single most
    // common shape on this fleet, and it must keep reading idle.
    const { home, run } = setup(false);
    const fleet = await assembleFleet(localIO, loadConfig({ CCRC_HOME: home }), new Tmux(run), 1784600000);
    expect(fleet.find((x) => x.id === ID)!.status).toBe('idle');
  });

  it('liveStatus is NOT changed by this: the SAME unreadable file still answers idle, so the interrupt route still refuses', async () => {
    // The deliberate asymmetry, on one fixture so the two answers cannot be
    // read as a coincidence of two different setups. `liveStatus`'s `'idle'`
    // is the PROTECTIVE answer — its only consumer refuses on it — and its
    // three pins above are untouched by this task.
    const { home, run } = setup();
    const io = degradedReadIO((p) => p.endsWith(LIVE));
    const status = await liveStatus(io, loadConfig({ CCRC_HOME: home }), new Tmux(run), ID);
    expect(status).toBe('idle');
  });

  // D-5234: the read one step earlier. `hasSession` says the pane is alive,
  // and `panePid` comes back null (`list-panes` failed: a loaded tmux server, a
  // dropped round trip). Nothing was measured about the session, so the card
  // takes D-115's shape — `busy`, and declared unmeasured so the watcher never
  // spends it as an edge — rather than the `alive` default `idle`.
  const failedPid = (): { home: string; run: Runner } => {
    const { home, run: healthy } = setup();
    const run: Runner = async (cmd, args) => (args[0] === 'list-panes'
      ? { code: 1, stdout: '', stderr: 'server exited unexpectedly' }
      : healthy(cmd, args));
    return { home, run };
  };

  it('D-5234: an alive pane whose panePid read fails is busy and statusUnmeasured, never a measured idle', async () => {
    const { home, run } = failedPid();
    const fleet = await assembleFleet(localIO, loadConfig({ CCRC_HOME: home }), new Tmux(run), 1784600000);
    const s = fleet.find((x) => x.id === ID)!;
    expect(s.status).toBe('busy');
    expect(s.statusUnmeasured).toBe(true);
    expect(s.statusUpdatedAt).toBeNull();
    expect(s.version).toBeNull();
  });

  it('D-5234: … and liveStatus on the SAME failed panePid still answers idle, so the interrupt route still refuses', async () => {
    const { home, run } = failedPid();
    expect(await liveStatus(localIO, loadConfig({ CCRC_HOME: home }), new Tmux(run), ID)).toBe('idle');
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

  // The worktree's own HEAD, as the divergence sweep measured it, comes between
  // the two: a narrow pane cuts the `⎇` segment (so the statusline gives no
  // branch), and the registry's `.branch` still names the branch ws-add
  // created, whatever was checked out since. Measured 2026-09-23 on three of
  // the four narrow rows: registry `ws/…`, HEAD `docs/…`/`feat/…`.
  const headOnly = (branch: string | null) =>
    new Map<string, string | null>([['demo-quiet-mesa', branch]]);
  const withHead = (run: Runner, home: string, heads: Map<string, string | null>, sl?: Map<string, Statusline>) =>
    assembleFleet(localIO, loadConfig({ CCRC_HOME: home }), new Tmux(run), 1784600000,
      undefined, sl, undefined, undefined, undefined, undefined, undefined, undefined, heads);

  it('uses the worktree\'s measured HEAD when the pane gave no full branch', async () => {
    const { home, run } = setup();
    // The pane measured identity (model) but no branch — a cut `⎇` segment.
    const sl = new Map<string, Statusline>([
      ['demo-quiet-mesa', { model: 'Opus 5.5', ultracode: false, workflowActive: false }],
    ]);
    const fleet = await withHead(run, home, headOnly('docs/checked-out-by-hand'), sl);
    expect(fleet.find((s) => s.id === 'demo-quiet-mesa')!.branch).toBe('docs/checked-out-by-hand');
  });

  it('still lets a full statusline branch outrank the measured HEAD — the pane is the fresher read', async () => {
    const { home, run } = setup();
    const sl = new Map<string, Statusline>([
      ['demo-quiet-mesa', { branch: 'feat/actually-here', ultracode: false, workflowActive: false }],
    ]);
    const fleet = await withHead(run, home, headOnly('docs/older-sweep'), sl);
    expect(fleet.find((s) => s.id === 'demo-quiet-mesa')!.branch).toBe('feat/actually-here');
  });

  // A pane branch the watcher KEPT across a tick that measured nothing (an
  // overlay, or a row cut inside its 🤖 segment) is not a live reading: it
  // loses to the HEAD measured since, and still beats the registry.
  it('ships THIS tick\'s prompt-box width as paneCols, and null when the tick saw no box', async () => {
    const { home, run } = setup();
    const sl = (boxCols: number | undefined) => new Map<string, Statusline>([
      ['demo-quiet-mesa', { model: 'Opus 5.5', ultracode: false, workflowActive: false, boxCols }],
    ]);
    const assemble = (m?: Map<string, Statusline>) =>
      assembleFleet(localIO, loadConfig({ CCRC_HOME: home }), new Tmux(run), 1784600000, undefined, m);
    const row = async (m?: Map<string, Statusline>) => (await assemble(m)).find((s) => s.id === 'demo-quiet-mesa')!;
    expect((await row(sl(150))).paneCols).toBe(150);
    expect((await row(sl(60))).paneCols).toBe(60);
    // Unmeasured is null — never a guessed width, never 0.
    expect((await row(sl(undefined))).paneCols).toBeNull();
    expect((await row(undefined)).paneCols).toBeNull();
  });

  it('ranks a RETAINED pane branch below the measured HEAD, and above the registry', async () => {
    const { home, run } = setup();
    const kept = new Map<string, Statusline>([
      ['demo-quiet-mesa', { branch: 'feat/before-the-checkout', ultracode: false, workflowActive: false, retained: true }],
    ]);
    const withNewerHead = await withHead(run, home, headOnly('docs/checked-out-since'), kept);
    expect(withNewerHead.find((s) => s.id === 'demo-quiet-mesa')!.branch).toBe('docs/checked-out-since');
    const noHead = await withHead(run, home, new Map(), kept);
    expect(noHead.find((s) => s.id === 'demo-quiet-mesa')!.branch).toBe('feat/before-the-checkout');
  });

  it('falls through a detached or unreadable HEAD (null) to the registry', async () => {
    const { home, run } = setup();
    const fleet = await withHead(run, home, headOnly(null));
    expect(fleet.find((s) => s.id === 'demo-quiet-mesa')!.branch).toBe('ws/quiet-mesa');
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

// D-2011: the pane's `▓ ctx` reading, carried straight onto the wire. Same
// setup idiom as "branch precedence" above (no other source ever supplies
// this field, so there is no fallback arm to test — only present-vs-absent).
describe('ctxPct on the wire (D-2011)', () => {
  const setup = (): { home: string; run: Runner } => {
    const home = mkTmp('ccrc-');
    seedRoster(home);
    seedSession(home, 'demo-quiet-mesa', 'claude', {
      project: 'demo', workspace: 'quiet-mesa', branch: 'ws/quiet-mesa',
    });
    const run: Runner = async (_cmd, args) => {
      if (args[0] === 'has-session') return { code: 0, stdout: '', stderr: '' };
      if (args[0] === 'list-panes') return { code: 0, stdout: '', stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    };
    return { home, run };
  };

  it('is null before any pane capture has landed — nothing else on the record ever measures it', async () => {
    const { home, run } = setup();
    const fleet = await assembleFleet(localIO, loadConfig({ CCRC_HOME: home }), new Tmux(run), 1784600000);
    expect(fleet.find((s) => s.id === 'demo-quiet-mesa')!.ctxPct).toBeNull();
  });

  it('carries the statusline reading straight through', async () => {
    const { home, run } = setup();
    const sl = new Map<string, Statusline>([
      ['demo-quiet-mesa', { ultracode: false, workflowActive: false, ctxPct: 82 }],
    ]);
    const fleet = await assembleFleet(
      localIO, loadConfig({ CCRC_HOME: home }), new Tmux(run), 1784600000, undefined, sl);
    expect(fleet.find((s) => s.id === 'demo-quiet-mesa')!.ctxPct).toBe(82);
  });

  it('carries a measured 0% as 0, not null — a session Claude Code reports freshly compacted', async () => {
    const { home, run } = setup();
    const sl = new Map<string, Statusline>([
      ['demo-quiet-mesa', { ultracode: false, workflowActive: false, ctxPct: 0 }],
    ]);
    const fleet = await assembleFleet(
      localIO, loadConfig({ CCRC_HOME: home }), new Tmux(run), 1784600000, undefined, sl);
    expect(fleet.find((s) => s.id === 'demo-quiet-mesa')!.ctxPct).toBe(0);
  });

  it('carries the usage sidecar reading onto the session, and null when none was read (routing slice 0)', async () => {
    const { home, run } = setup();
    const reading = { ts: 1_800_000_000, model: 'claude-opus-5', class: 'opus' as const, effort: 'high', ctxPct: 12, cost: 1.25, stale: false };
    const withUsage = await assembleFleet(localIO, loadConfig({ CCRC_HOME: home }), new Tmux(run), 1784600000, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      new Map([['demo-quiet-mesa', reading]]));
    expect(withUsage.find((s) => s.id === 'demo-quiet-mesa')?.usage).toEqual(reading);
    const without = await assembleFleet(localIO, loadConfig({ CCRC_HOME: home }), new Tmux(run), 1784600000);
    expect(without.find((s) => s.id === 'demo-quiet-mesa')?.usage).toBeNull();
  });
});

// fleet.ts: the pane's Workflow row promotes an `idle` card to `busy` — but
// only where Claude Code's own live-status file did not already speak for the
// workflow. Every build from 2.1.277 (measured through 2.1.283) writes
// `status: isLoading || delegatedActive ? "busy" : "idle"`, and a running
// workflow is delegated work, so an `idle` from such a file has ruled a running
// workflow out: any row still on screen is a finished run's ~30 s linger, and
// on 2.1.281+ a run with a failed agent reads as running (no failed count in
// the text). The row speaks for a file with no `version` (this fixture, as it
// always was), an older build, or no readable file at all. Nothing pinned the
// promotion once: deleting it left every suite green.
describe('a running Workflow reads busy over an idle pid.json', () => {
  const assemble = async (workflowActive: boolean | undefined, live: Record<string, unknown> | null = {}) => {
    const home = mkTmp('ccrc-');
    seedRoster(home);
    seedSession(home, 'claude-a-MekWarLive', 'claude-a');
    mkdirSync(path.join(home, '.claude-a', 'sessions'), { recursive: true });
    if (live) writeFileSync(
      path.join(home, '.claude-a', 'sessions', '40613.json'),
      JSON.stringify({ pid: 40613, sessionId: '1'.repeat(36), cwd: '/d', status: 'idle', ...live }),
    );
    const run: Runner = async (_cmd, args) => {
      if (args[0] === 'has-session') return { code: 0, stdout: '', stderr: '' };
      if (args[0] === 'list-panes') return { code: 0, stdout: '40613\n', stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    };
    const sl = new Map<string, Statusline>([
      ['claude-a-MekWarLive', { model: 'Opus 5.5', ultracode: false, workflowActive }],
    ]);
    const fleet = await assembleFleet(localIO, loadConfig({ CCRC_HOME: home }), new Tmux(run), undefined, undefined, sl);
    return fleet.find((s) => s.id === 'claude-a-MekWarLive')!.status;
  };

  it('an idle session with a Workflow row on screen is busy', async () => {
    expect(await assemble(true)).toBe('busy');
  });

  it('control: the same session without one is idle', async () => {
    expect(await assemble(false)).toBe('idle');
  });

  // The lingering-row false busy: a 2.1.283 file measured idle, and the row
  // on screen (a finished run's, or one with a failed agent) must not undo it.
  it('a 2.1.277+ live file\'s idle stands over the row — it already counts a running workflow', async () => {
    expect(await assemble(true, { version: '2.1.283' })).toBe('idle');
    expect(await assemble(true, { version: '2.1.277' })).toBe('idle');
  });

  it('the row still speaks for a build older than 2.1.277, or a version that is not one', async () => {
    expect(await assemble(true, { version: '2.1.276' })).toBe('busy');
    expect(await assemble(true, { version: 'not-a-version' })).toBe('busy');
  });

  it('the row still speaks when there is no live file at all (no-state reads idle)', async () => {
    expect(await assemble(true, null)).toBe('busy');
    expect(await assemble(false, null), 'control: no file and no row is the alive default').toBe('idle');
  });

  it('control: a 2.1.283 idle with no row is idle', async () => {
    expect(await assemble(false, { version: '2.1.283' })).toBe('idle');
  });

  // `undefined` is a tick that did not see the statusline row, so saw no row
  // below it either (statusline.ts): unmeasured, never a promotion. The
  // watcher carries its last measurement across such a tick and never stores
  // one; this pins the seam for any caller that hands one in.
  it('an unmeasured row (`workflowActive: undefined`) promotes nothing', async () => {
    expect(await assemble(undefined, null)).toBe('idle');
    expect(await assemble(undefined, { version: '2.1.276' })).toBe('idle');
  });
});

describe('derived session handles', () => {
  const build = async (live: Record<string, unknown>) => {
    const home = mkTmp('ccrc-');
    seedRoster(home);
    seedSession(home, 'claude-a-MekWarLive', 'claude-a');
    mkdirSync(path.join(home, '.claude-a', 'sessions'), { recursive: true });
    writeFileSync(
      path.join(home, '.claude-a', 'sessions', '40613.json'),
      JSON.stringify({ pid: 40613, sessionId: '1'.repeat(36), cwd: '/d', status: 'idle', ...live }),
    );
    const run: Runner = async (_cmd, args) => {
      if (args[0] === 'has-session') return { code: 0, stdout: '', stderr: '' };
      if (args[0] === 'list-panes') return { code: 0, stdout: '40613\n', stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    };
    const fleet = await assembleFleet(localIO, loadConfig({ CCRC_HOME: home }), new Tmux(run));
    return fleet.find((s) => s.id === 'claude-a-MekWarLive')!;
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
  // had no test: `hold-gate.test.ts` exercises `sweepMerged` (`archiveMerged`'s
  // successor) against `SessionRecord`, never `assembleFleet`, so `held: null`
  // here would have stayed green everywhere while every held workspace reached
  // the phone unheld — no chip, and the actions sheet offering Hold instead of
  // Release, which is the ONLY PWA route to the release that `ws-reap`'s refusal
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
  it('a fresh hookstate carries all five fields — hookState, askSummary, subagents, graphQueries and graphGateDenials — onto the session', async () => {
    const home = mkTmp('ccrc-');
    seedRoster(home);
    seedSession(home, 'claude-demo', 'claude');
    const hookStates = new Map<string, HookState>([
      ['claude-demo', mkHookState({
        state: 'waiting',
        ask: { questions: [{ question: 'Pick one', header: 'Choose', options: [{ label: 'A' }, { label: 'B' }] }] },
        subagents: [{ name: 'reviewer', startedAt: 1000 }],
        graphQueries: 7,
        graphGateDenials: 2,
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
    // The POSITIVE carry, and the only test anywhere that proves a hookstate
    // count of N reaches `FleetSession.graphQueries` as N. Its hookless
    // sibling below is `toBeNull()` in every field, so WITHOUT this line the
    // whole seam (`graphQueries: hs?.graphQueries ?? null`, fleet.ts) could be
    // replaced by a literal `null` — the count silently dropped for every live
    // session — and the entire server suite would stay green (D-1249).
    expect(s.graphQueries).toBe(7);
    // R5's own counter, D-1613, and the number is deliberately DIFFERENT from
    // the query count above: a seam that carried `hs?.graphQueries` onto both
    // wire fields would pass with two 7s. The gate's next reading is denials
    // beside queries, so a carry that copies one onto the other reports a
    // fleet nobody can read.
    expect(s.graphGateDenials).toBe(2);
  });

  it('carries a hookstate graphQueries of 0 onto the session as 0 — a measured zero is not an absence', async () => {
    // The other half of the field, and the half a `hs ? 0 : null` would still
    // survive: the seam must distinguish "hook says zero reads" from "no hook
    // data at all", which is exactly the distinction `hookstate.ts` drew one
    // layer in. The sibling above pins N, this pins 0, the hookless one pins
    // null — three points, no collapse left unpinned (D-1249).
    const home = mkTmp('ccrc-');
    seedRoster(home);
    seedSession(home, 'claude-demo', 'claude');
    const hookStates = new Map<string, HookState>([
      ['claude-demo', mkHookState({ state: 'working', graphQueries: 0 })],
    ]);
    const fleet = await assembleFleet(
      localIO, loadConfig({ CCRC_HOME: home }), new Tmux(async () => ({ code: 1, stdout: '', stderr: '' })), 1784600000,
      undefined, undefined, undefined, undefined, hookStates,
    );
    const s = fleet.find((x) => x.id === 'claude-demo')!;
    expect(s.graphQueries).toBe(0);
  });

  it('carries a hookstate graphGateDenials of 0 onto the session as 0 — an armed gate that never fired', async () => {
    // The half a `hs ? 0 : null`, or a truthiness-flavoured carry, would still
    // survive: "the gate is live here and has not had to stop anybody" is a
    // MEASUREMENT, and the one this whole counter exists to report on the day
    // R5 ships. The hookless sibling below pins the null (D-1613).
    const home = mkTmp('ccrc-');
    seedRoster(home);
    seedSession(home, 'claude-demo', 'claude');
    const hookStates = new Map<string, HookState>([
      ['claude-demo', mkHookState({ state: 'working', graphGateDenials: 0 })],
    ]);
    const fleet = await assembleFleet(
      localIO, loadConfig({ CCRC_HOME: home }), new Tmux(async () => ({ code: 1, stdout: '', stderr: '' })), 1784600000,
      undefined, undefined, undefined, undefined, hookStates,
    );
    const s = fleet.find((x) => x.id === 'claude-demo')!;
    expect(s.graphGateDenials).toBe(0);
  });

  it('carries a hookstate graphGateDenials of NULL onto the session as null — a hook too old to have a gate', async () => {
    // A hook that predates R5 writes no denial counter at all, and
    // `hookstate.ts` reads that as `null`. The carry must not launder it into
    // a 0, which is what a `?? 0` here would do — and which would paint every
    // un-upgraded fleet box as a box whose gate is armed and quiet.
    const home = mkTmp('ccrc-');
    seedRoster(home);
    seedSession(home, 'claude-demo', 'claude');
    const hookStates = new Map<string, HookState>([
      ['claude-demo', mkHookState({ state: 'working', graphQueries: 4, graphGateDenials: null })],
    ]);
    const fleet = await assembleFleet(
      localIO, loadConfig({ CCRC_HOME: home }), new Tmux(async () => ({ code: 1, stdout: '', stderr: '' })), 1784600000,
      undefined, undefined, undefined, undefined, hookStates,
    );
    const s = fleet.find((x) => x.id === 'claude-demo')!;
    expect(s.graphQueries).toBe(4);
    expect(s.graphGateDenials).toBeNull();
  });

  it('a hookless session carries all five fields as null', async () => {
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
    expect(s.graphQueries).toBeNull();
    expect(s.graphGateDenials).toBeNull();
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
    seedSession(home, 'claude-a-MekWarLive', 'claude-a');
    mkdirSync(path.join(home, '.claude-a', 'sessions'), { recursive: true });
    writeFileSync(path.join(home, '.claude-a', 'sessions', '40613.json'), JSON.stringify({
      pid: 40613, sessionId: '1'.repeat(36), cwd: '/data/projects/MekWarLive',
      name: 'mekwar-a1', status: 'busy', statusUpdatedAt: 1784582728369, version: '2.1.210',
    }));
    const run: Runner = async (_cmd, args) => {
      if (args[0] === 'has-session') return { code: args.includes('=cc-claude-a-MekWarLive:') ? 0 : 1, stdout: '', stderr: '' };
      if (args[0] === 'list-panes') return { code: 0, stdout: '40613\n', stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    };
    const cfg = loadConfig({ CCRC_HOME: home });

    const withoutHook = await assembleFleet(localIO, cfg, new Tmux(run), 1784600000);
    const hookStates = new Map<string, HookState>([['claude-a-MekWarLive', mkHookState({ state: 'done' })]]);
    const withHook = await assembleFleet(
      localIO, cfg, new Tmux(run), 1784600000, undefined, undefined, undefined, undefined, hookStates,
    );
    // `waiting` is the state most likely to tempt a status-derivation bug
    // specifically — it is also the value dialogPending's OR-rule reads, so a
    // fix or refactor near that line reaching one line too far (promoting an
    // idle status to busy, or demoting this already-busy one) is the exact
    // regression this fixture exists to catch. `done` above cannot pin that:
    // it shares no vocabulary with anything status-adjacent.
    const waitingHookStates = new Map<string, HookState>([['claude-a-MekWarLive', mkHookState({ state: 'waiting' })]]);
    const withWaitingHook = await assembleFleet(
      localIO, cfg, new Tmux(run), 1784600000, undefined, undefined, undefined, undefined, waitingHookStates,
    );

    const before = withoutHook.find((x) => x.id === 'claude-a-MekWarLive')!;
    const after = withHook.find((x) => x.id === 'claude-a-MekWarLive')!;
    const afterWaiting = withWaitingHook.find((x) => x.id === 'claude-a-MekWarLive')!;
    expect(before.status).toBe('busy');
    expect(after.status).toBe(before.status);
    expect(afterWaiting.status).toBe(before.status);
    // The mutant this pins: only the hook-derived fields may differ.
    expect(before.hookState).toBeNull();
    expect(after.hookState).toBe('done');
    expect(afterWaiting.hookState).toBe('waiting');
  });
});

// Task 19: `FleetSession.ask`, computed server-side in `assembleFleet` off a
// real `CoordStore` — ruling F5, NOT a consumer of `GET /api/asks`. The
// `coord/store.ts` fixture idiom copied verbatim from `asks-store.test.ts`'s
// own `mk()`.
describe('the ask chip (Task 19)', () => {
  const mkCoord = (): CoordStore =>
    new CoordStore(openCoordDb(path.join(mkTmp('ccrc-coord-'), '.ccrc', 'coord.db')));

  const dead = new Tmux(async () => ({ code: 1, stdout: '', stderr: '' }));

  // THE UNITS, ONCE. `assembleFleet`'s `now` is SECONDS; every stamp on an
  // `asks` row — `at`, `answeredAt` — is MILLISECONDS (`insertAsk`/`settleAsk`'s
  // real callers all pass `Date.now()`). Both chip bounds are ms arithmetic
  // against `now * 1000`, so a fixture that mints a row at `now: 1` is not
  // "a moment ago", it is 1970 — which is why every mint below is expressed
  // relative to `NOW_MS`.
  const NOW_S = 1784600000;
  const NOW_MS = NOW_S * 1000;

  it('reads a HELD ask row as the "held" chip, parentId carried verbatim', async () => {
    const home = mkTmp('ccrc-');
    seedRoster(home);
    seedSession(home, 'claude-demo', 'claude');
    const coord = mkCoord();
    coord.insertAsk({
      childId: 'claude-demo', parentId: 'coord-1', runId: null, askKey: 'k',
      askAt: 1000, dialogId: 'd', question: 'q', options: ['a', 'b'], now: NOW_MS - 1000,
    });
    const fleet = await assembleFleet(
      localIO, loadConfig({ CCRC_HOME: home }), dead, 1784600000,
      undefined, undefined, undefined, undefined, undefined, undefined, coord,
    );
    expect(fleet.find((x) => x.id === 'claude-demo')!.ask).toEqual({ state: 'held', parentId: 'coord-1', answeredBy: null });
  });

  it('folds ANSWERING onto "held" — a digit has not landed, so a parent may still (attempt to) answer', async () => {
    const home = mkTmp('ccrc-');
    seedRoster(home);
    seedSession(home, 'claude-demo', 'claude');
    const coord = mkCoord();
    const id = coord.insertAsk({
      childId: 'claude-demo', parentId: 'coord-1', runId: null, askKey: 'k',
      askAt: 1000, dialogId: 'd', question: 'q', options: ['a', 'b'], now: NOW_MS - 1000,
    });
    expect(coord.takeAskForAnswer(id, 1000).ok).toBe(true); // held -> answering
    const fleet = await assembleFleet(
      localIO, loadConfig({ CCRC_HOME: home }), dead, 1784600000,
      undefined, undefined, undefined, undefined, undefined, undefined, coord,
    );
    expect(fleet.find((x) => x.id === 'claude-demo')!.ask).toEqual({ state: 'held', parentId: 'coord-1', answeredBy: null });
  });

  // `assembleFleet`'s `now` (1784600000) is SECONDS; `answeredAt` is
  // MILLISECONDS (`settleAsk`'s real callers all pass `Date.now()`) — one
  // minute before "now" in ms, comfortably inside `ASK_ANSWERED_CHIP_WINDOW_MS`
  // (30 minutes).
  it('reads a recently-settled ask row as the "answered" chip, once a parent has ruled', async () => {
    const home = mkTmp('ccrc-');
    seedRoster(home);
    seedSession(home, 'claude-demo', 'claude');
    const coord = mkCoord();
    const id = coord.insertAsk({
      childId: 'claude-demo', parentId: 'coord-1', runId: null, askKey: 'k',
      askAt: 1000, dialogId: 'd', question: 'q', options: ['a', 'b'], now: NOW_MS - 1000,
    });
    coord.takeAskForAnswer(id, 1000);
    coord.settleAsk(id, 'coord-1', 'a', NOW_MS - 60_000); // answering -> answered, 1 min ago
    const fleet = await assembleFleet(
      localIO, loadConfig({ CCRC_HOME: home }), dead, 1784600000,
      undefined, undefined, undefined, undefined, undefined, undefined, coord,
    );
    expect(fleet.find((x) => x.id === 'claude-demo')!.ask).toEqual({ state: 'answered', parentId: 'coord-1', answeredBy: 'coord-1' });
  });

  // Fix round 1, item 4 (coordinator review, RULING): left unbounded, "ruled
  // by <parent>" would sit on the row FOREVER — the window bounds it to
  // while the chip is still explaining something recent.
  it('folds a STALE-ANSWERED chip (past ASK_ANSWERED_CHIP_WINDOW_MS) to no chip', async () => {
    const home = mkTmp('ccrc-');
    seedRoster(home);
    seedSession(home, 'claude-demo', 'claude');
    const coord = mkCoord();
    const id = coord.insertAsk({
      childId: 'claude-demo', parentId: 'coord-1', runId: null, askKey: 'k',
      askAt: 1000, dialogId: 'd', question: 'q', options: ['a', 'b'], now: NOW_MS - 1000,
    });
    coord.takeAskForAnswer(id, 1000);
    // 40 minutes before "now" — past the 30-minute window.
    coord.settleAsk(id, 'coord-1', 'a', NOW_MS - 40 * 60_000);
    const fleet = await assembleFleet(
      localIO, loadConfig({ CCRC_HOME: home }), dead, 1784600000,
      undefined, undefined, undefined, undefined, undefined, undefined, coord,
    );
    expect(fleet.find((x) => x.id === 'claude-demo')!.ask).toBeNull();
  });

  // WHOLE-BRANCH REVIEW, F2(b) — the RULING, replacing the test that used to
  // sit here asserting the opposite ("a held ask is live by definition", a
  // row minted 40 minutes ago still wearing the chip). That premise holds
  // only within ONE PROCESS LIFETIME and only while `staleAsk` can still
  // reach the row, and neither is guaranteed: `heldAsks` is never rehydrated
  // at boot (D-2169, deliberately) and `dialogIds` is stamped on the priming
  // tick BEFORE the notify gate, so every deploy leaves one stuck chip per
  // session that had a live ask, forever. The bound is DERIVED from the two
  // constants the lane actually runs on (`askwindow.ts`) — never a third
  // number — because a `held` row older than the grace window plus the
  // answering ceiling is stale by construction.
  const holdMinted = async (home: string, coord: CoordStore, mintedAt: number) => {
    coord.insertAsk({
      childId: 'claude-demo', parentId: 'coord-1', runId: null, askKey: 'k',
      askAt: 1000, dialogId: 'd', question: 'q', options: ['a', 'b'], now: mintedAt,
    });
    const fleet = await assembleFleet(
      localIO, loadConfig({ CCRC_HOME: home }), dead, NOW_S,
      undefined, undefined, undefined, undefined, undefined, undefined, coord,
    );
    return fleet.find((x) => x.id === 'claude-demo')!.ask;
  };

  it('still shows a held chip INSIDE the derived window — the control for the bound below', async () => {
    const home = mkTmp('ccrc-');
    seedRoster(home);
    seedSession(home, 'claude-demo', 'claude');
    expect(await holdMinted(home, mkCoord(), NOW_MS - (ASK_HELD_CHIP_MAX_MS - 1_000)))
      .toEqual({ state: 'held', parentId: 'coord-1', answeredBy: null });
  });

  it('folds a held row OLDER than ASK_GRACE_MS + ASK_ANSWERING_MAX_MS to no chip (F2(b))', async () => {
    const home = mkTmp('ccrc-');
    seedRoster(home);
    seedSession(home, 'claude-demo', 'claude');
    expect(await holdMinted(home, mkCoord(), NOW_MS - (ASK_HELD_CHIP_MAX_MS + 1_000))).toBeNull();
  });

  it('bounds a folded-from-ANSWERING row by the same mint time — the stranded case F2(a) could not reach', async () => {
    // `staleAsk` is called through a try/catch on every path, so a coord.db
    // that throws leaves an `answering` row exactly where it was. The chip
    // must not depend on that write having landed.
    const home = mkTmp('ccrc-');
    seedRoster(home);
    seedSession(home, 'claude-demo', 'claude');
    const coord = mkCoord();
    const id = coord.insertAsk({
      childId: 'claude-demo', parentId: 'coord-1', runId: null, askKey: 'k',
      askAt: 1000, dialogId: 'd', question: 'q', options: ['a', 'b'],
      now: NOW_MS - (ASK_HELD_CHIP_MAX_MS + 1_000),
    });
    expect(coord.takeAskForAnswer(id, 1000).ok).toBe(true);   // held -> answering, and stranded there
    const fleet = await assembleFleet(
      localIO, loadConfig({ CCRC_HOME: home }), dead, NOW_S,
      undefined, undefined, undefined, undefined, undefined, undefined, coord,
    );
    expect(fleet.find((x) => x.id === 'claude-demo')!.ask).toBeNull();
  });

  // WHOLE-BRANCH REVIEW, F1 — the chip used to build its `answered` arm from
  // `row.parentId` and never read `row.answeredBy`, while `server.ts`'s
  // `POST /api/sessions/:id/ask` settles the OPERATOR's own answer with
  // `settleAsk(held.id, 'operator', …)`. So an ask the operator answered
  // themselves, from their own phone, inside the grace window, rendered as
  // "ruled by <parent-session-id>" — a false attribution on the one surface
  // this lane exists to make honest. Every chip test in this block settled
  // with `'coord-1'` and none with `'operator'`, which is exactly why the
  // suite was green and blind.
  it('names the OPERATOR, not the parent, when the operator answered their own held ask (F1)', async () => {
    const home = mkTmp('ccrc-');
    seedRoster(home);
    seedSession(home, 'claude-demo', 'claude');
    const coord = mkCoord();
    const id = coord.insertAsk({
      childId: 'claude-demo', parentId: 'coord-1', runId: null, askKey: 'k',
      askAt: 1000, dialogId: 'd', question: 'q', options: ['a', 'b'], now: NOW_MS - 1000,
    });
    coord.takeAskForAnswer(id, 1000);
    coord.settleAsk(id, ASK_OPERATOR_PRINCIPAL, 'a', NOW_MS - 60_000);
    const fleet = await assembleFleet(
      localIO, loadConfig({ CCRC_HOME: home }), dead, NOW_S,
      undefined, undefined, undefined, undefined, undefined, undefined, coord,
    );
    // `parentId` is still carried — it is who MAY have answered, and the chip
    // has always named it — but `answeredBy` is who DID, and they differ here.
    expect(fleet.find((x) => x.id === 'claude-demo')!.ask)
      .toEqual({ state: 'answered', parentId: 'coord-1', answeredBy: 'operator' });
  });

  it('carries a NULL answeredBy on an answered row that names no principal — never the parent by default', async () => {
    // Reachable: `settleAsk` is guarded on both answer routes precisely
    // because it can throw after the digit has already landed, leaving the
    // row unattributed. The chip must say what the row says, not fill the
    // gap in with `parentId`.
    const home = mkTmp('ccrc-');
    seedRoster(home);
    seedSession(home, 'claude-demo', 'claude');
    const coord = mkCoord();
    const id = coord.insertAsk({
      childId: 'claude-demo', parentId: 'coord-1', runId: null, askKey: 'k',
      askAt: 1000, dialogId: 'd', question: 'q', options: ['a', 'b'], now: NOW_MS - 1000,
    });
    coord.takeAskForAnswer(id, 1000);
    coord.db.prepare("UPDATE asks SET state = 'answered', answeredAt = ? WHERE id = ?")
      .run(NOW_MS - 60_000, id);
    const fleet = await assembleFleet(
      localIO, loadConfig({ CCRC_HOME: home }), dead, NOW_S,
      undefined, undefined, undefined, undefined, undefined, undefined, coord,
    );
    expect(fleet.find((x) => x.id === 'claude-demo')!.ask)
      .toEqual({ state: 'answered', parentId: 'coord-1', answeredBy: null });
  });

  it('folds RELEASED to no chip — the operator\'s own ordinary push already fired', async () => {
    const home = mkTmp('ccrc-');
    seedRoster(home);
    seedSession(home, 'claude-demo', 'claude');
    const coord = mkCoord();
    const id = coord.insertAsk({
      childId: 'claude-demo', parentId: 'coord-1', runId: null, askKey: 'k',
      askAt: 1000, dialogId: 'd', question: 'q', options: ['a', 'b'], now: NOW_MS - 1000,
    });
    expect(coord.releaseAsk(id, 2000)).toBe(true); // held -> released
    const fleet = await assembleFleet(
      localIO, loadConfig({ CCRC_HOME: home }), dead, 1784600000,
      undefined, undefined, undefined, undefined, undefined, undefined, coord,
    );
    expect(fleet.find((x) => x.id === 'claude-demo')!.ask).toBeNull();
  });

  it('folds DECLINED to no chip — the parent handed it over and the operator was pushed (D-5289)', async () => {
    const home = mkTmp('ccrc-');
    seedRoster(home);
    seedSession(home, 'claude-demo', 'claude');
    const coord = mkCoord();
    const id = coord.insertAsk({
      childId: 'claude-demo', parentId: 'coord-1', runId: null, askKey: 'k',
      askAt: 1000, dialogId: 'd', question: 'q', options: ['a', 'b'], now: NOW_MS - 1000,
    });
    expect(coord.declineAsk(id, 2000)).toBe(true); // held -> declined
    const fleet = await assembleFleet(
      localIO, loadConfig({ CCRC_HOME: home }), dead, 1784600000,
      undefined, undefined, undefined, undefined, undefined, undefined, coord,
    );
    expect(fleet.find((x) => x.id === 'claude-demo')!.ask).toBeNull();
  });

  it('folds STALE to no chip — the dialog itself is gone, nothing left to explain', async () => {
    const home = mkTmp('ccrc-');
    seedRoster(home);
    seedSession(home, 'claude-demo', 'claude');
    const coord = mkCoord();
    coord.insertAsk({
      childId: 'claude-demo', parentId: 'coord-1', runId: null, askKey: 'k',
      askAt: 1000, dialogId: 'd', question: 'q', options: ['a', 'b'], now: NOW_MS - 1000,
    });
    expect(coord.staleAsk('d', 'claude-demo', 2000)).toBe(true); // held -> stale
    const fleet = await assembleFleet(
      localIO, loadConfig({ CCRC_HOME: home }), dead, 1784600000,
      undefined, undefined, undefined, undefined, undefined, undefined, coord,
    );
    expect(fleet.find((x) => x.id === 'claude-demo')!.ask).toBeNull();
  });

  it('is null for a session CoordStore holds no ask row for at all', async () => {
    const home = mkTmp('ccrc-');
    seedRoster(home);
    seedSession(home, 'claude-demo', 'claude');
    const fleet = await assembleFleet(
      localIO, loadConfig({ CCRC_HOME: home }), dead, 1784600000,
      undefined, undefined, undefined, undefined, undefined, undefined, mkCoord(),
    );
    expect(fleet.find((x) => x.id === 'claude-demo')!.ask).toBeNull();
  });

  it('is null with no `coord` passed at all — a dark box, or a caller that predates the lane', async () => {
    // Same registry row, and a coord store that genuinely HOLDS a live held
    // ask for it — proving the null comes from the missing 11th argument,
    // not from an empty store.
    const home = mkTmp('ccrc-');
    seedRoster(home);
    seedSession(home, 'claude-demo', 'claude');
    const coord = mkCoord();
    coord.insertAsk({
      childId: 'claude-demo', parentId: 'coord-1', runId: null, askKey: 'k',
      askAt: 1000, dialogId: 'd', question: 'q', options: ['a', 'b'], now: NOW_MS - 1000,
    });
    const fleet = await assembleFleet(localIO, loadConfig({ CCRC_HOME: home }), dead, 1784600000);
    expect(fleet.find((x) => x.id === 'claude-demo')!.ask).toBeNull();
  });

  // Fix round 1: `assembleFleet` is called UNWRAPPED from `FleetWatcher.tick()`
  // and the `/ws/fleet` connect handler — neither wraps the call in its own
  // try/catch, so a synchronous `node:sqlite` throw off a broken coord.db
  // must degrade INSIDE this function, never escape it. Closing the
  // connection reproduces the same class of throw a full disk or a lock race
  // would (`push-copy.test.ts`/`fleetws.test.ts`'s own idiom for this).
  it('degrades to a null ask, and warns, rather than throwing when coord.db is broken', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const home = mkTmp('ccrc-');
    seedRoster(home);
    seedSession(home, 'claude-demo', 'claude');
    const coord = mkCoord();
    coord.insertAsk({
      childId: 'claude-demo', parentId: 'coord-1', runId: null, askKey: 'k',
      askAt: 1000, dialogId: 'd', question: 'q', options: ['a', 'b'], now: NOW_MS - 1000,
    });
    coord.db.close();
    const fleet = await assembleFleet(
      localIO, loadConfig({ CCRC_HOME: home }), dead, 1784600000,
      undefined, undefined, undefined, undefined, undefined, undefined, coord,
    );
    expect(fleet.find((x) => x.id === 'claude-demo')!.ask).toBeNull();
    expect(warnSpy.mock.calls.some(([line]) => String(line).includes('currentAsksFor'))).toBe(true);
    warnSpy.mockRestore();
  });

  // Fix round 1, item 3 (coordinator review): the whole point of collapsing
  // N per-session reads into one batched query is that a broken box warns
  // ONCE per assembly, not once per session — pinned directly with a
  // multi-session fleet, since the single-session test above cannot tell
  // "warned once" from "warned once per session" apart.
  it('warns exactly ONCE per assembly on a broken coord.db, however many sessions are in the fleet', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const home = mkTmp('ccrc-');
    seedRoster(home);
    seedSession(home, 'claude-alpha', 'claude');
    seedSession(home, 'claude-beta', 'claude');
    seedSession(home, 'claude-gamma', 'claude');
    const coord = mkCoord();
    coord.db.close();
    const fleet = await assembleFleet(
      localIO, loadConfig({ CCRC_HOME: home }), dead, 1784600000,
      undefined, undefined, undefined, undefined, undefined, undefined, coord,
    );
    expect(fleet).toHaveLength(3);
    expect(fleet.every((x) => x.ask === null)).toBe(true);
    expect(warnSpy.mock.calls.filter(([line]) => String(line).includes('currentAsksFor')).length).toBe(1);
    warnSpy.mockRestore();
  });
});

// Task 3, fix round 1 (Important 1): the central computation this task
// exists for — `boardProject`, as `assembleFleet` actually computes it off a
// real `CoordStore` — had ZERO coverage. This file never named the token, so
// no deep-equal caught it incidentally, and all three of these mutations to
// `fleet.ts`'s row literal shipped GREEN before this block existed:
//   - `stamped: bySession.get(r.id) ?? null` -> `stamped: null`
//   - `stamped: bySession.get(r.id) ?? null` -> `stamped: byProject.get(r.id) ?? null`
//   - `held: r.held !== null` -> `held: true`
// Each test below names the mutation it kills. D-2921 replaced the two ports
// with one SESSION-keyed `stampOf`, so the second mutation's modern spelling is
// `sessionId: r.id` -> `sessionId: r.project` and the first's is the port
// returning null — both still killed here, by the same fixtures.
describe('board placement on the wire (Task 3, fix round 1 coverage)', () => {
  const mkCoord = (): CoordStore =>
    new CoordStore(openCoordDb(path.join(mkTmp('ccrc-coord-'), '.ccrc', 'coord.db')));
  const dead = new Tmux(async () => ({ code: 1, stdout: '', stderr: '' }));
  const NOW_S = 1784600000;

  it('a stamped, held session boards on its COORDINATOR project, not its own — kills `stamped` forced to a constant', async () => {
    const home = mkTmp('ccrc-');
    seedRoster(home);
    seedSession(home, 'demo-worker', 'claude', { hold: 'program:agent-evals wave:1/2' });
    const coord = mkCoord();
    const opened = coord.openRun({
      program: 'agent-evals', title: 'wave 1', project: 'demo-worker',
      wave: 1, waveOf: 2, claimedBy: 'demo-coordinator', coordProject: 'intake-platform',
    }) as { id: number };
    coord.bindSession(opened.id, 'demo-worker');
    const fleet = await assembleFleet(
      localIO, loadConfig({ CCRC_HOME: home }), dead, NOW_S,
      undefined, undefined, undefined, undefined, undefined, undefined, coord,
    );
    expect(fleet.find((x) => x.id === 'demo-worker')!.boardProject).toBe('intake-platform');
  });

  it('newest wins when two runs stamp the same session with different coordinators', async () => {
    const home = mkTmp('ccrc-');
    seedRoster(home);
    seedSession(home, 'demo-worker', 'claude', { hold: 'program:agent-evals wave:2/2' });
    const coord = mkCoord();
    const first = coord.openRun({
      program: 'agent-evals', title: 'wave 1', project: 'demo-worker',
      wave: 1, waveOf: 2, claimedBy: 'demo-coordinator', coordProject: 'old-coordinator',
    }) as { id: number };
    coord.bindSession(first.id, 'demo-worker');
    // Wave 2's run is opened before wave 1 closes (the coordinator protocol's
    // own shape) — its higher autoincrement id is what "newest" means here.
    const second = coord.openRun({
      program: 'agent-evals', title: 'wave 2', project: 'demo-worker',
      wave: 2, waveOf: 2, claimedBy: 'demo-coordinator', coordProject: 'new-coordinator',
    }) as { id: number };
    coord.bindSession(second.id, 'demo-worker');
    const fleet = await assembleFleet(
      localIO, loadConfig({ CCRC_HOME: home }), dead, NOW_S,
      undefined, undefined, undefined, undefined, undefined, undefined, coord,
    );
    expect(fleet.find((x) => x.id === 'demo-worker')!.boardProject).toBe('new-coordinator');
  });

  it('the lookup is keyed on the SESSION id, never the project — kills `sessionId: r.project`', async () => {
    const home = mkTmp('ccrc-');
    seedRoster(home);
    // The session's OWN project is deliberately NOT its id — every OTHER
    // fixture in this file leaves `project` defaulted to the session id, which
    // would let a lookup keyed on the PROJECT accidentally answer a lookup
    // keyed on the session's id and hide exactly the bug this test exists to
    // catch.
    seedSession(home, 'demo-worker3', 'claude', {
      project: 'demo-worker3-project', hold: 'program:agent-evals wave:1/1',
    });
    const coord = mkCoord();
    // A run whose WORK is in this session's own project and which is bound to
    // a DIFFERENT session. Pre-D-2921 it was the `byProject` entry that shadowed
    // the right answer; now it is simply another session's stamp, and the only
    // way it can reach this row is a lookup keyed on the wrong thing.
    const foreign = coord.openRun({
      program: 'other-programme', title: 'unrelated', project: 'demo-worker3-project',
      wave: 1, waveOf: 1, claimedBy: 'other-coordinator', coordProject: 'byproject-answer',
    }) as { id: number };
    coord.bindSession(foreign.id, 'demo-worker3-project');
    // This session's OWN stamp, via a run whose `project` is unrelated.
    const sessionRun = coord.openRun({
      program: 'agent-evals', title: 'wave 1', project: 'unrelated-project',
      wave: 1, waveOf: 1, claimedBy: 'demo-coordinator', coordProject: 'bysession-answer',
    }) as { id: number };
    coord.bindSession(sessionRun.id, 'demo-worker3');
    const fleet = await assembleFleet(
      localIO, loadConfig({ CCRC_HOME: home }), dead, NOW_S,
      undefined, undefined, undefined, undefined, undefined, undefined, coord,
    );
    // The CORRECT key is `r.id`. Handing `boardPlacement` `sessionId: r.project`
    // instead would find the foreign session's stamp — which is deliberately
    // keyed under this project's NAME — and place the row on
    // 'byproject-answer'.
    expect(fleet.find((x) => x.id === 'demo-worker3')!.boardProject).toBe('bysession-answer');
  });

  it('an unheld-but-stamped session reads its own project — kills `held: r.held !== null` forced to `true`', async () => {
    const home = mkTmp('ccrc-');
    seedRoster(home);
    // No `hold:` extra — this workspace is NOT held.
    seedSession(home, 'demo-worker4', 'claude', { project: 'demo-worker4-project' });
    const coord = mkCoord();
    const run = coord.openRun({
      program: 'agent-evals', title: 'wave 1', project: 'unrelated-project',
      wave: 1, waveOf: 1, claimedBy: 'demo-coordinator', coordProject: 'should-be-ignored',
    }) as { id: number };
    coord.bindSession(run.id, 'demo-worker4');
    const fleet = await assembleFleet(
      localIO, loadConfig({ CCRC_HOME: home }), dead, NOW_S,
      undefined, undefined, undefined, undefined, undefined, undefined, coord,
    );
    expect(fleet.find((x) => x.id === 'demo-worker4')!.boardProject).toBe('demo-worker4-project');
  });

  it('a held-but-unstamped session reads its own project too', async () => {
    const home = mkTmp('ccrc-');
    seedRoster(home);
    seedSession(home, 'demo-worker5', 'claude', {
      project: 'demo-worker5-project', hold: 'program:agent-evals wave:1/1',
    });
    const coord = mkCoord();
    // A run exists and is stamped, but names a DIFFERENT session —
    // 'demo-worker5' is never `bindSession`-ed, so the stamp table has no
    // entry for it at all.
    const run = coord.openRun({
      program: 'agent-evals', title: 'wave 1', project: 'other-project',
      wave: 1, waveOf: 1, claimedBy: 'demo-coordinator', coordProject: 'not-this-one',
    }) as { id: number };
    coord.bindSession(run.id, 'someone-else');
    const fleet = await assembleFleet(
      localIO, loadConfig({ CCRC_HOME: home }), dead, NOW_S,
      undefined, undefined, undefined, undefined, undefined, undefined, coord,
    );
    expect(fleet.find((x) => x.id === 'demo-worker5')!.boardProject).toBe('demo-worker5-project');
  });

  // The whole reason `coordPlacementStamps`/`readCoordPlacements` pass
  // `includeClosed: true` rather than the active-only shape: a placement
  // keyed on open runs alone would bounce a worker off its coordinator's
  // card the instant the wave that stamped it closes, until the NEXT wave's
  // run opens. The hold file (not the run's own state) is what says this
  // workspace is still claimed.
  it('a CLOSED run stamp still places the session — the wave-boundary guarantee `includeClosed:true` exists for', async () => {
    const home = mkTmp('ccrc-');
    seedRoster(home);
    seedSession(home, 'demo-worker6', 'claude', {
      project: 'demo-worker6-project', hold: 'program:agent-evals wave:1/1',
    });
    const coord = mkCoord();
    const run = coord.openRun({
      program: 'agent-evals', title: 'wave 1', project: 'demo-worker6',
      wave: 1, waveOf: 1, claimedBy: 'demo-coordinator', coordProject: 'closed-wave-coordinator',
    }) as { id: number };
    coord.bindSession(run.id, 'demo-worker6');
    expect(coord.advance(run.id, 'failed', 'test-close').ok).toBe(true);
    const fleet = await assembleFleet(
      localIO, loadConfig({ CCRC_HOME: home }), dead, NOW_S,
      undefined, undefined, undefined, undefined, undefined, undefined, coord,
    );
    expect(fleet.find((x) => x.id === 'demo-worker6')!.boardProject).toBe('closed-wave-coordinator');
  });

  // Task 3 fix round 2 (Important 1, upgraded from Minor — Global Constraints:
  // "every new guard ships WITH a test that goes RED when the guard is
  // deleted or mutated"). `coordPlacementStamps`'s `WHERE coordProject IS NOT
  // NULL` was executed by every test above but pinned by none of them: delete
  // it and this whole file stays green, because every OTHER test's newer run
  // (if any) either has no coordProject either (both null, no divergence) or
  // IS the stamped one. This is the one shape that tells them apart — a
  // SESSION with an OLDER stamped run and a NEWER unstamped one. Without the
  // WHERE clause, the newer row's `coordProject` reads as SQL NULL cast
  // straight through the unsafe `as unknown as {...coordProject: string}[]`
  // (`store.ts`'s `as unknown as`) into `foldCoordPlacements`'s max-id fold,
  // which has no reason to distrust its own type and overwrites the session's
  // stamp with that `null` — reintroducing the wave-boundary bounce `includeClosed:
  // true` exists to prevent, just from the opposite direction (a stamp
  // disappearing forward in time instead of backward).
  it('an older STAMPED run is not shadowed by a newer UNSTAMPED one on the same session — pins `WHERE coordProject IS NOT NULL`', async () => {
    const home = mkTmp('ccrc-');
    seedRoster(home);
    seedSession(home, 'demo-worker8', 'claude', {
      project: 'demo-worker8-project', hold: 'program:agent-evals wave:2/2',
    });
    const coord = mkCoord();
    const stampedRun = coord.openRun({
      program: 'agent-evals', title: 'wave 1', project: 'demo-worker8',
      wave: 1, waveOf: 2, claimedBy: 'demo-coordinator', coordProject: 'real-coordinator',
    }) as { id: number };
    coord.bindSession(stampedRun.id, 'demo-worker8');
    // Opened AFTER (higher id — "newer"), but no coordProject given at all.
    const unstampedRun = coord.openRun({
      program: 'agent-evals', title: 'wave 2', project: 'demo-worker8',
      wave: 2, waveOf: 2, claimedBy: 'demo-coordinator',
    }) as { id: number };
    coord.bindSession(unstampedRun.id, 'demo-worker8');
    const fleet = await assembleFleet(
      localIO, loadConfig({ CCRC_HOME: home }), dead, NOW_S,
      undefined, undefined, undefined, undefined, undefined, undefined, coord,
    );
    expect(fleet.find((x) => x.id === 'demo-worker8')!.boardProject).toBe('real-coordinator');
  });

  // ------------------------------------------------------------------
  // FINAL WHOLE-BRANCH REVIEW, Critical 1 (D-2921). The two fixtures the
  // reviewer measured, and the one shape every fixture above deliberately
  // cannot express: the stamped COORDINATOR's project is ALSO a project that
  // hosts an ordinary same-repo programme, so a project-keyed hop table has an
  // entry under it. Every other case in this block keeps the two disjoint.
  // ------------------------------------------------------------------

  it('a cross-repo worker still boards on its coordinator when that coordinator project ALSO hosts an ordinary programme', async () => {
    const home = mkTmp('ccrc-');
    seedRoster(home);
    seedSession(home, 'ct-worker', 'claude', {
      project: 'custom-tools', hold: 'program:qdrant wave:10/10',
    });
    const coord = mkCoord();
    // The cross-repo worker: work in custom-tools, coordinator in ccrc-pwa.
    const crossRepo = coord.openRun({
      program: 'qdrant', title: 'wave 10', project: 'custom-tools',
      wave: 10, waveOf: 10, claimedBy: 'ccrc-pwa-amber-summit', coordProject: 'ccrc-pwa',
    }) as { id: number };
    coord.bindSession(crossRepo.id, 'ct-worker');
    // ANY ordinary ccrc-pwa programme — a worker in ccrc-pwa coordinated from
    // ccrc-pwa. Under a PROJECT-keyed hop this makes coordOf('ccrc-pwa') ===
    // 'ccrc-pwa', which trips the `seen` guard and scatters the row home.
    const sameRepo = coord.openRun({
      program: 'board-placement', title: 'wave 1', project: 'ccrc-pwa',
      wave: 1, waveOf: 1, claimedBy: 'ccrc-pwa-swift-mesa-coordinator', coordProject: 'ccrc-pwa',
    }) as { id: number };
    coord.bindSession(sameRepo.id, 'ccrc-pwa-worker');
    const fleet = await assembleFleet(
      localIO, loadConfig({ CCRC_HOME: home }), dead, NOW_S,
      undefined, undefined, undefined, undefined, undefined, undefined, coord,
    );
    expect(fleet.find((x) => x.id === 'ct-worker')!.boardProject).toBe('ccrc-pwa');
  });

  // The end-to-end pin on `claimedBy`'s carriage from the SQL to the walk: a
  // chain is the only shape whose answer depends on the second hop, so nulling
  // `claimedBy` anywhere between `coordPlacementStamps`' SELECT and
  // `foldCoordPlacements`' entry reds here. Without it that column is pinned
  // only at the store seam and in the fold's own unit test.
  it('walks a chain through a coordinator that is ITSELF a worker, to the root', async () => {
    const home = mkTmp('ccrc-');
    seedRoster(home);
    seedSession(home, 'chain-worker', 'claude', {
      project: 'leaf-project', hold: 'program:leaf wave:1/1',
    });
    const coord = mkCoord();
    // W is coordinated by `mid-session`, whose own project is `mid-project`.
    const leaf = coord.openRun({
      program: 'leaf', title: 'wave 1', project: 'leaf-project',
      wave: 1, waveOf: 1, claimedBy: 'mid-session', coordProject: 'mid-project',
    }) as { id: number };
    coord.bindSession(leaf.id, 'chain-worker');
    // …and `mid-session` is itself a worker, coordinated from `root-project`.
    const mid = coord.openRun({
      program: 'trunk', title: 'wave 1', project: 'mid-project',
      wave: 1, waveOf: 1, claimedBy: 'root-session', coordProject: 'root-project',
    }) as { id: number };
    coord.bindSession(mid.id, 'mid-session');
    const fleet = await assembleFleet(
      localIO, loadConfig({ CCRC_HOME: home }), dead, NOW_S,
      undefined, undefined, undefined, undefined, undefined, undefined, coord,
    );
    // 'mid-project' if `claimedBy` is lost anywhere on the way to the walk.
    expect(fleet.find((x) => x.id === 'chain-worker')!.boardProject).toBe('root-project');
  });

  it('a worker is never lifted onto a card that never coordinated it', async () => {
    const home = mkTmp('ccrc-');
    seedRoster(home);
    seedSession(home, 'ct-worker2', 'claude', {
      project: 'custom-tools', hold: 'program:qdrant wave:10/10',
    });
    const coord = mkCoord();
    // This worker's coordinator lives in intake-platform.
    const mine = coord.openRun({
      program: 'qdrant', title: 'wave 10', project: 'custom-tools',
      wave: 10, waveOf: 10, claimedBy: 'intake-platform-keen-meadow', coordProject: 'intake-platform',
    }) as { id: number };
    coord.bindSession(mine.id, 'ct-worker2');
    // An UNRELATED programme whose WORK happens in intake-platform, coordinated
    // from ccrc-pwa. A project-keyed hop reads this as "ccrc-pwa coordinates
    // intake-platform" and walks the row one card too far.
    const unrelated = coord.openRun({
      program: 'intake-thing', title: 'wave 1', project: 'intake-platform',
      wave: 1, waveOf: 1, claimedBy: 'ccrc-pwa-amber-summit', coordProject: 'ccrc-pwa',
    }) as { id: number };
    coord.bindSession(unrelated.id, 'intake-worker');
    const fleet = await assembleFleet(
      localIO, loadConfig({ CCRC_HOME: home }), dead, NOW_S,
      undefined, undefined, undefined, undefined, undefined, undefined, coord,
    );
    expect(fleet.find((x) => x.id === 'ct-worker2')!.boardProject).toBe('intake-platform');
  });

  it('a REFUSED placement read emits null on every row — never a non-null that reads as "placed at home" (D-2875)', async () => {
    const home = mkTmp('ccrc-');
    seedRoster(home);
    seedSession(home, 'demo-worker5', 'claude', { hold: 'program:agent-evals wave:1/1' });
    const coord = mkCoord();
    vi.spyOn(coord, 'coordPlacementStamps').mockReturnValue({ ok: false, kind: 'run-unreadable', detail: 'closed for the test' });
    const fleet = await assembleFleet(
      localIO, loadConfig({ CCRC_HOME: home }), dead, NOW_S,
      undefined, undefined, undefined, undefined, undefined, undefined, coord,
    );
    expect(fleet.find((x) => x.id === 'demo-worker5')!.boardProject).toBeNull();
  });

  it('a THROWING placement read emits null too, and the tick still resolves', async () => {
    const home = mkTmp('ccrc-');
    seedRoster(home);
    seedSession(home, 'demo-worker6', 'claude');
    const coord = mkCoord();
    vi.spyOn(coord, 'coordPlacementStamps').mockImplementation(() => { throw new Error('lock race'); });
    const fleet = await assembleFleet(
      localIO, loadConfig({ CCRC_HOME: home }), dead, NOW_S,
      undefined, undefined, undefined, undefined, undefined, undefined, coord,
    );
    expect(fleet.find((x) => x.id === 'demo-worker6')!.boardProject).toBeNull();
  });

  it('CONTROL: a readable store with nothing stamped still answers the OWN project, not null', async () => {
    // "Nothing stamped" is a measurement; "could not read" is not. The two
    // must not fold — this is the case the null must NOT reach.
    const home = mkTmp('ccrc-');
    seedRoster(home);
    seedSession(home, 'demo-worker7', 'claude', { project: 'demo-worker7-project' });
    const fleet = await assembleFleet(
      localIO, loadConfig({ CCRC_HOME: home }), dead, NOW_S,
      undefined, undefined, undefined, undefined, undefined, undefined, mkCoord(),
    );
    expect(fleet.find((x) => x.id === 'demo-worker7')!.boardProject).toBe('demo-worker7-project');
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

describe('assembleFleet hands back the pane pids it read (worker stall watch wave 2, M6)', () => {
  // `tick()` passes this map on to the stall lane as `StallTick.panePids`, so the lane never reads a pid a second
  // time. One harness: an alive row and a dead one, `fleet.test.ts`'s first case's shape.
  const pidsFor = async (listPanes: { code: number; stdout: string }): Promise<Map<string, number | null>> => {
    const home = mkTmp('ccrc-fleet-pids-');
    seedRoster(home);
    seedSession(home, 'claude-a-MekWarLive', 'claude-a');
    seedSession(home, 'claude-dead-proj', 'claude');
    const run: Runner = async (_cmd, args) => {
      if (args[0] === 'has-session') return { code: args.includes('=cc-claude-a-MekWarLive:') ? 0 : 1, stdout: '', stderr: '' };
      if (args[0] === 'list-panes') return { code: listPanes.code, stdout: listPanes.stdout, stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    };
    const pids = new Map<string, number | null>();
    await assembleFleet(localIO, loadConfig({ CCRC_HOME: home }), new Tmux(run), 1784600000,
      undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, pids);
    return pids;
  };

  it('fills the map with the pid of every ALIVE row, and gives a row whose pane is not alive no entry', async () => {
    expect([...await pidsFor({ code: 0, stdout: '40613\n' })]).toEqual([['claude-a-MekWarLive', 40613]]);
  });

  it('records null for an alive row whose pid tmux did not answer, never dropping the row', async () => {
    expect([...await pidsFor({ code: 1, stdout: '' })]).toEqual([['claude-a-MekWarLive', null]]);
  });
});

// `background-aware-working` (D-5231; spec §5.1): `fleet.ts` ships `background` ONLY when the live file's build covers
// delegation (`liveCoversWorkflows`, 2.1.277 on), the hook state is a `Stop`'s `done`, and the count is above zero.
describe('FleetSession.background (D-5231)', () => {
  const ID = 'lane-a-project-a';
  const UUID = '00000000-0000-4000-8000-000000000001';
  const ROSTER = { version: 1, accounts: [{
    id: 'lane-a', label: 'lane-a', configDirSuffix: '.lane-a',
    exec: { kind: 'upstream' }, homeAble: true, hue: 'cyan', telemetry: 'anthropic',
  }] };
  const HOOK_AT = 1_784_600_000_000;
  const hook = (o: Partial<HookState> = {}): HookState => ({
    state: 'done', updatedAt: HOOK_AT, event: 'Stop', ask: null, subagents: [], graphQueries: 0, graphGateDenials: 0,
    interrupted: false, background: { count: 2, kinds: ['subagent', 'workflow'] }, ...o,
  });
  const row = async (version: string, hs: HookState): Promise<{ background: unknown; bucket: string }> => {
    const home = mkTmp('ccrc-bg-');
    seedRoster(home, ROSTER);
    const reg = path.join(home, '.cc-sessions');
    mkdirSync(reg, { recursive: true });
    const fields = { wrapper: 'lane-a', project: 'project-a', workdir: '/data/projects/project-a', uuid: UUID, started: '1' };
    for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${ID}.${k}`), v);
    mkdirSync(path.join(home, '.lane-a', 'sessions'), { recursive: true });
    writeFileSync(path.join(home, '.lane-a', 'sessions', '40613.json'), JSON.stringify({
      pid: 40613, sessionId: UUID, cwd: '/data/projects/project-a',
      status: 'busy', statusUpdatedAt: HOOK_AT - 60_000, version,
    }));
    const run: Runner = async (_cmd, args) => {
      if (args[0] === 'has-session') return { code: args.includes(`=cc-${ID}:`) ? 0 : 1, stdout: '', stderr: '' };
      if (args[0] === 'list-panes') return { code: 0, stdout: '40613\n', stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    };
    const fleet = await assembleFleet(localIO, loadConfig({ CCRC_HOME: home }), new Tmux(run), HOOK_AT / 1000,
      undefined, undefined, undefined, undefined, new Map([[ID, hs]]));
    return fleet.find((x) => x.id === ID)!;
  };

  it('a 2.1.296 live file, hook Stop done with the pair: background set, the row working', async () => {
    const r = await row('2.1.296', hook());
    expect(r.background).toEqual({ count: 2, kinds: ['subagent', 'workflow'] });
    expect(r.bucket).toBe('working');
  });

  it('a 2.1.270 live file (below the floor): background null, D-75 answers done', async () => {
    const r = await row('2.1.270', hook());
    expect(r.background).toBeNull();
    expect(r.bucket).toBe('done');
  });

  it('a hook `working`: background null', async () => {
    expect((await row('2.1.296', hook({ state: 'working', event: 'PostToolUse' }))).background).toBeNull();
  });

  it.each(['SubagentStop', 'SubagentStart'])('a `done` the hook carried through a %s keeps background', async (event) => {
    // the subagent arm carries the pair and (until D-5232's gated arm) rewrites `event`
    const r = await row('2.1.296', hook({ event }));
    expect(r.background).toEqual({ count: 2, kinds: ['subagent', 'workflow'] });
    expect(r.bucket).toBe('working');
  });

  it.each(['SessionStart', 'PreCompact', null])('a `done` from %s, which never writes the pair: background null', async (event) => {
    expect((await row('2.1.296', hook({ event }))).background).toBeNull();
  });

  it('the pair at count 0: background null, D-75 answers done', async () => {
    const r = await row('2.1.296', hook({ background: { count: 0, kinds: [] } }));
    expect(r.background).toBeNull();
    expect(r.bucket).toBe('done');
  });

  it('no pair at all: background null', async () => {
    const hs = hook();
    delete hs.background;
    expect((await row('2.1.296', hs)).background).toBeNull();
  });
});

// `interrupt-and-restart-causes-recorded` (D-5237; spec §5.6): the registry's `lastend` reaches the wire as
// `FleetSession.lastEnd`, unchanged; absent is null.
describe('FleetSession.lastEnd (D-5237)', () => {
  const ID = 'lane-a-project-a';
  const UUID = '00000000-0000-4000-8000-000000000001';
  const ROSTER = { version: 1, accounts: [{
    id: 'lane-a', label: 'lane-a', configDirSuffix: '.lane-a',
    exec: { kind: 'upstream' }, homeAble: true, hue: 'cyan', telemetry: 'anthropic',
  }] };
  const row = async (lastend: string | null): Promise<{ lastEnd: unknown }> => {
    const home = mkTmp('ccrc-lastend-');
    seedRoster(home, ROSTER);
    const reg = path.join(home, '.cc-sessions');
    mkdirSync(reg, { recursive: true });
    const fields: Record<string, string> = { wrapper: 'lane-a', project: 'project-a', workdir: '/data/projects/project-a', uuid: UUID, started: '1' };
    if (lastend !== null) fields['lastend'] = lastend;
    for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${ID}.${k}`), v);
    const run: Runner = async (_cmd, args) => {
      if (args[0] === 'has-session') return { code: args.includes(`=cc-${ID}:`) ? 0 : 1, stdout: '', stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    };
    const fleet = await assembleFleet(localIO, loadConfig({ CCRC_HOME: home }), new Tmux(run), 1_784_600_000);
    return fleet.find((x) => x.id === ID)!;
  };
  it('a recorded oom end rides the wire', async () => {
    expect((await row('1784599820 oom')).lastEnd).toEqual({ at: 1_784_599_820_000, cause: 'oom' });
  });
  it('no lastend is null', async () => {
    expect((await row(null)).lastEnd).toBeNull();
  });
});

// D-5242 (plan Task 17a): the registry's `.hibernated` reaches the wire as `FleetSession.hibernatedAt`, epoch ms;
// unlisted is null, and a malformed body is null with the row still on the wire.
describe('FleetSession.hibernatedAt (D-5242)', () => {
  const ID = 'lane-a-project-a';
  const UUID = '00000000-0000-4000-8000-000000000001';
  const ROSTER = { version: 1, accounts: [{
    id: 'lane-a', label: 'lane-a', configDirSuffix: '.lane-a',
    exec: { kind: 'upstream' }, homeAble: true, hue: 'cyan', telemetry: 'anthropic',
  }] };
  const row = async (hibernated: string | null): Promise<{ hibernatedAt: unknown } | undefined> => {
    const home = mkTmp('ccrc-hibernated-');
    seedRoster(home, ROSTER);
    const reg = path.join(home, '.cc-sessions');
    mkdirSync(reg, { recursive: true });
    const fields: Record<string, string> = { wrapper: 'lane-a', project: 'project-a', workdir: '/data/projects/project-a', uuid: UUID, started: '1', stopped: '1784599820 agent' };
    if (hibernated !== null) fields['hibernated'] = hibernated;
    for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${ID}.${k}`), v);
    const run: Runner = async () => ({ code: 1, stdout: '', stderr: '' });
    const fleet = await assembleFleet(localIO, loadConfig({ CCRC_HOME: home }), new Tmux(run), 1_784_600_000);
    return fleet.find((x) => x.id === ID);
  };
  it('a hibernated row rides the wire with hibernatedAt, its bucket still dead', async () => {
    expect(await row('1784599820 7')).toMatchObject({ hibernatedAt: 1_784_599_820_000, status: 'dead', bucket: 'dead' });
  });
  it('no .hibernated is null', async () => {
    expect((await row(null))!.hibernatedAt).toBeNull();
  });
  it('a malformed .hibernated is null, and the row is still on the wire', async () => {
    expect((await row('seven hours ago'))!.hibernatedAt).toBeNull();
  });
});

// `compactions-write-no-hookstate` (D-5239; spec §5.8): an idle compaction behind the server's word leaves the Stop's
// hookstate as it was, so the row's `bucketSince` stays the Stop's T0 (no fresh `done`, no badge). END TO END: the real
// hook writes the file, the real reader parses it, `assembleFleet` ships the row. At base PostCompact `manual` writes a
// fresh `done`, and `bucketSince` jumps to the compaction.
describe('a compaction keeps bucketSince (D-5239)', () => {
  const HOOK = path.resolve(__dirname, '../../ccd/session-hook.sh');
  const FIVE = path.resolve(__dirname, 'fixtures/hook/stop-bg-five-kinds.json');
  const ID = 'lane-a-project-a';
  const UUID = '00000000-0000-4000-8000-000000000001';
  const GENERATION = '0189abcd-1234-5678-9abc-0123456789ab';
  const ROSTER = { version: 1, accounts: [{
    id: 'lane-a', label: 'lane-a', configDirSuffix: '.lane-a',
    exec: { kind: 'upstream' }, homeAble: true, hue: 'cyan', telemetry: 'anthropic',
  }] };
  const compaction = (trigger: 'auto' | 'manual'): object[] => ['PreCompact', 'PostCompact'].map((ev) => ({
    session_id: UUID, transcript_path: `/rig/fixhome/cfg/projects/-rig-repo/${UUID}.jsonl`, cwd: '/rig/repo',
    prompt_id: '00000000-0000-4000-8000-0000000000c1', hook_event_name: ev, trigger,
    ...(ev === 'PreCompact' ? { custom_instructions: null } : { compact_summary: 'fixture summary' }),
  }));

  it('a row done at T0, through an idle manual compaction, keeps bucketSince T0', async () => {
    const home = mkTmp('ccrc-compact-since-');
    seedRoster(home, ROSTER);
    const reg = path.join(home, '.cc-sessions');
    mkdirSync(reg, { recursive: true });
    const fields = { wrapper: 'lane-a', project: 'project-a', workdir: '/data/projects/project-a', uuid: UUID, started: '1', generation: GENERATION };
    for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${ID}.${k}`), v);
    const bin = path.join(home, 'bin');
    mkdirSync(bin, { recursive: true });
    writeFileSync(path.join(bin, 'tmux'), `#!/bin/sh\necho "cc-${ID}"\n`, { mode: 0o755 });
    mkdirSync(path.join(home, '.ccrc'), { recursive: true });
    writeFileSync(path.join(home, '.ccrc', SERVER_CAPS_FILE), renderServerCaps(['dispatch-live-gate-v1'], Math.floor(Date.now() / 1000)));
    const hook = (p: object): void => {
      execFileSync('bash', [HOOK], {
        input: JSON.stringify(p), encoding: 'utf8',
        env: { ...process.env, HOME: home, PATH: `${bin}:${process.env['PATH'] ?? ''}`, TMUX_PANE: '%1',
          CLAUDE_CODE_SESSION_ID: UUID, CLAUDE_PID: '40613', CCRC_SESSION_GENERATION: GENERATION },
      });
    };
    hook({ ...(JSON.parse(readFileSync(FIVE, 'utf8')) as Record<string, unknown>), background_tasks: [] });
    const hsFile = path.join(reg, `${ID}.hookstate.json`);
    const T0 = Date.now() - 60_000;
    writeFileSync(hsFile, JSON.stringify({ ...(JSON.parse(readFileSync(hsFile, 'utf8')) as object), updatedAt: T0 }) + '\n');
    for (const p of compaction('manual')) hook(p);
    const raw = await readHookStateRawMeasured(localIO, reg, ID, UUID);
    if (!raw.ok) throw new Error(`the hook wrote no readable hookstate: ${raw.reason}`);
    mkdirSync(path.join(home, '.lane-a', 'sessions'), { recursive: true });
    writeFileSync(path.join(home, '.lane-a', 'sessions', '40613.json'), JSON.stringify({
      pid: 40613, sessionId: UUID, cwd: '/data/projects/project-a',
      status: 'idle', statusUpdatedAt: T0 - 60_000, version: '2.1.296',
    }));
    const run: Runner = async (_cmd, args) => {
      if (args[0] === 'has-session') return { code: args.includes(`=cc-${ID}:`) ? 0 : 1, stdout: '', stderr: '' };
      if (args[0] === 'list-panes') return { code: 0, stdout: '40613\n', stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    };
    const fleet = await assembleFleet(localIO, loadConfig({ CCRC_HOME: home }), new Tmux(run), Math.floor(Date.now() / 1000),
      undefined, undefined, undefined, undefined, new Map([[ID, raw.state]]));
    const r = fleet.find((x) => x.id === ID)!;
    expect(r.bucket).toBe('done');
    expect(r.bucketSince).toBe(T0);
  });
});

// `with-coordinator-state` (D-5296; plan Task 7). `FleetSession.withCoordinator`
// from the session's newest asks row: set while it is `held` or `answering` and
// the assembly's clock is before `askNotifyAt(row.at)` (the MINT time, D-5364,
// never `askAt`), null on every other state and from `notifyAt` on. The row
// shape is the Task 19 block's own `insertAsk` fixture, neutral ids.
describe('the quiet "with coordinator" state (D-5296)', () => {
  const mkCoord = (): CoordStore =>
    new CoordStore(openCoordDb(path.join(mkTmp('ccrc-coord-'), '.ccrc', 'coord.db')));
  const dead = new Tmux(async () => ({ code: 1, stdout: '', stderr: '' }));
  const live = new Tmux(async (_cmd, args) => {
    if (args[0] === 'list-panes') return { code: 0, stdout: '4242\n', stderr: '' };
    return { code: 0, stdout: '', stderr: '' };
  });
  const NOW_S = 1784600000;
  const NOW_MS = NOW_S * 1000;
  // `askAt` is deliberately far from the mint: a computation that read it
  // instead of `at` would put `notifyAt` in 1970 and clear every case.
  const mint = (coord: CoordStore, at: number, childId = 'project-a-quiet-basin'): number => coord.insertAsk({
    childId, parentId: 'project-a-calm-mesa', runId: null, askKey: 'k',
    askAt: 1000, dialogId: 'd', question: 'q', options: ['a', 'b'], now: at,
  });
  const assemble = async (coord: CoordStore, nowS: number, tmux: Tmux = dead, hookStates?: Map<string, HookState>) => {
    const home = mkTmp('ccrc-');
    seedRoster(home);
    seedSession(home, 'project-a-quiet-basin', 'claude');
    seedSession(home, 'project-a-calm-mesa', 'claude');
    const fleet = await assembleFleet(
      localIO, loadConfig({ CCRC_HOME: home }), tmux, nowS,
      undefined, undefined, undefined, undefined, hookStates, undefined, coord,
    );
    return (id: string) => fleet.find((x) => x.id === id)!;
  };

  it('a held row one second before notifyAt sets the field; at notifyAt it is null', async () => {
    // Minted 179 s before NOW: notifyAt = mint + 180 s = NOW + 1 s.
    const coord = mkCoord();
    mint(coord, NOW_MS - 179_000);
    const before = await assemble(coord, NOW_S);
    expect(before('project-a-quiet-basin').withCoordinator).toEqual({
      kind: 'question', parentId: 'project-a-calm-mesa', since: NOW_MS - 179_000, notifyAt: NOW_MS + 1000,
    });
    const at = await assemble(coord, NOW_S + 1);
    expect(at('project-a-quiet-basin').withCoordinator).toBeNull();
  });

  it('an answering row (mid-answer) keeps it', async () => {
    const coord = mkCoord();
    const id = mint(coord, NOW_MS - 10_000);
    expect(coord.takeAskForAnswer(id, 1000).ok).toBe(true);
    const get = await assemble(coord, NOW_S);
    expect(get('project-a-quiet-basin').withCoordinator?.parentId).toBe('project-a-calm-mesa');
  });

  it('a declined, released or answered row gives null', async () => {
    const declined = mkCoord();
    expect(declined.declineAsk(mint(declined, NOW_MS - 10_000), NOW_MS - 5000)).toBe(true);
    expect((await assemble(declined, NOW_S))('project-a-quiet-basin').withCoordinator).toBeNull();

    const released = mkCoord();
    expect(released.releaseAsk(mint(released, NOW_MS - 10_000), NOW_MS - 5000)).toBe(true);
    expect((await assemble(released, NOW_S))('project-a-quiet-basin').withCoordinator).toBeNull();

    const answered = mkCoord();
    const id = mint(answered, NOW_MS - 10_000);
    answered.takeAskForAnswer(id, 1000);
    answered.settleAsk(id, 'project-a-calm-mesa', 'a', NOW_MS - 5000);
    expect((await assemble(answered, NOW_S))('project-a-quiet-basin').withCoordinator).toBeNull();
  });

  it('a top-level session never has it, and neither does any session without a coord store', async () => {
    const coord = mkCoord();
    mint(coord, NOW_MS - 10_000);
    const get = await assemble(coord, NOW_S);
    expect(get('project-a-calm-mesa').withCoordinator).toBeNull();
    const home = mkTmp('ccrc-');
    seedRoster(home);
    seedSession(home, 'project-a-quiet-basin', 'claude');
    const bare = await assembleFleet(localIO, loadConfig({ CCRC_HOME: home }), dead, NOW_S);
    expect(bare.find((x) => x.id === 'project-a-quiet-basin')!.withCoordinator).toBeNull();
  });

  it('end to end: a live waiting child with the field is working, dated from the hold; without it, attention', async () => {
    const hooks = new Map<string, HookState>([
      ['project-a-quiet-basin', mkHookState({ state: 'waiting', updatedAt: NOW_MS - 2000 })],
    ]);
    const coord = mkCoord();
    mint(coord, NOW_MS - 10_000);
    const held = (await assemble(coord, NOW_S, live, hooks))('project-a-quiet-basin');
    expect(held.withCoordinator).not.toBeNull();
    expect({ bucket: held.bucket, bucketSince: held.bucketSince }).toEqual({ bucket: 'working', bucketSince: NOW_MS - 10_000 });
    const lapsed = (await assemble(coord, NOW_S + 171, live, hooks))('project-a-quiet-basin');
    expect(lapsed.withCoordinator).toBeNull();
    expect(lapsed.bucket).toBe('attention');
  });
});
