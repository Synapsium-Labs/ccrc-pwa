// Coordinator durability D4 (#757; epic #752): a coordinator's picture of its workers lives only in its context, so a
// compaction, a resume or a /clear loses it. The session hook's SessionStart arm re-injects a roster card: the open runs
// THIS session claims, read from `GET /api/runs` through the closed client, capped at ROSTER_MAX characters. It ships
// behind the hand-armed marker `coordinator-roster-card-live`: unarmed, it injects nothing and appends the card it would
// have injected to `~/.ccrc/roster-card-shadow.log`, the record the operator reads before arming. A server that does not
// answer, or answers something that is not a run list, costs the card and nothing else (fail open, no stale data).
//
// Runs ccd/session-hook.sh for real inside a fixture HOME with a fake `ccrc-api`; no live box, no live server. The
// harness is COPIED from session-hook-role-card.test.ts (a test file cannot import another).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';

const HOOK = path.resolve(__dirname, '../../ccd/session-hook.sh');
const GENERATION = '0189abcd-1234-5678-9abc-0123456789ab';
const SID = '00000000-0000-4000-8000-000000000001';
const ID = 'project-a-calm-mesa';
const MARKER = 'coordinator-roster-card-live';
const ROSTER_MAX = 2048;
const NOW = Date.now();

let home: string;
const reg = (): string => path.join(home, '.cc-sessions');
const shadow = (): string => path.join(home, '.ccrc', 'roster-card-shadow.log');
beforeEach(() => {
  home = mkTmp('ccrc-hook-roster-');
  fs.mkdirSync(reg(), { recursive: true });
  fs.mkdirSync(path.join(home, 'bin'), { recursive: true });
  fs.mkdirSync(path.join(home, '.local', 'bin'), { recursive: true });
  fs.mkdirSync(path.join(home, 'work'), { recursive: true });
  fs.writeFileSync(path.join(reg(), `${ID}.generation`), GENERATION);
  fs.writeFileSync(path.join(home, 'bin', 'tmux'), `#!/bin/sh\necho "cc-${ID}"\n`, { mode: 0o755 });
});
afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

const arm = (): void => { fs.writeFileSync(path.join(reg(), MARKER), ''); };
/** The fake closed client: `runs list` prints `body` and exits `code`; anything else is a failure. */
const fakeApi = (body: string, code = 0): void => {
  fs.writeFileSync(path.join(home, 'runs.json'), body);
  fs.writeFileSync(path.join(home, '.local', 'bin', 'ccrc-api'),
    `#!/bin/sh\n[ "$1 $2" = "runs list" ] || exit 9\ncat "${path.join(home, 'runs.json')}"\necho "http 200" >&2\nexit ${code}\n`, { mode: 0o755 });
};
const run_ = (id: string, over: Record<string, unknown> = {}): { id: string; claimedBy: string | null } & Record<string, unknown> => ({
  id: 1, program: 'prog-a', programTitle: 'Programme A', wave: 1, waveOf: 3, project: 'project-a', sessionId: 'worker-a',
  state: 'working', claimedBy: ID, openedAt: NOW - 3 * 3600_000, dispatchedAt: NOW - 3 * 3600_000, unreadMail: 0,
  health: { mailOutstanding: 0, mailParked: 0 }, ...over,
}) as never;
const list = (...runs: object[]): string => JSON.stringify({ runs });

const payload = (source: string): object => ({
  session_id: SID, transcript_path: path.join(home, 'cfg', 'projects', '-work', `${SID}.jsonl`),
  cwd: path.join(home, 'work'), hook_event_name: 'SessionStart', source, model: 'claude-model-a',
  ...(source === 'compact' ? { prompt_id: 'p1' } : {}),
});
const hook = (source: string): string => {
  const r = spawnSync('bash', [HOOK], {
    input: JSON.stringify(payload(source)), encoding: 'utf8',
    env: {
      ...process.env, HOME: home, PATH: `${path.join(home, 'bin')}:${process.env['PATH'] ?? ''}`,
      TMUX_PANE: '%1', CLAUDE_CODE_SESSION_ID: SID, CLAUDE_PID: '4242', CCRC_SESSION_GENERATION: GENERATION,
    },
  });
  expect(r.status, 'the hook contract: exit 0 on every path').toBe(0);
  const lines = r.stdout.split('\n').filter((l) => l.length > 0);
  expect(lines.length, 'at most one envelope per event').toBeLessThanOrEqual(1);
  if (lines.length === 0) return '';
  return (JSON.parse(lines[0]!) as { hookSpecificOutput: { additionalContext: string } }).hookSpecificOutput.additionalContext;
};
const rosterOf = (ctx: string): string => ctx.slice(ctx.indexOf('ccrc-roster'));

describe('D4: the roster card, armed', () => {
  beforeEach(arm);

  it.each(['compact', 'resume', 'clear'])('a %s carries every open run the session claims, and only those', (source) => {
    fakeApi(list(
      run_('', { id: 11 }),
      run_('', { id: 12, program: 'prog-b', state: 'awaiting-review', sessionId: 'worker-b', unreadMail: 2 }),
      run_('', { id: 13, claimedBy: 'project-z-other' }),
      run_('', { id: 14, state: 'done' }),
    ));
    const c = hook(source);
    expect(c).toContain('ccrc-roster');
    expect(c).toMatch(/#11 prog-a w1\/3 working worker=worker-a 3h/);
    expect(c).toMatch(/#12 prog-b w1\/3 awaiting-review worker=worker-b 3h unread=2/);
    expect(c).not.toContain('#13');
    expect(c).not.toContain('#14');
  });

  it('ends with an awaiting-you list: awaiting-review runs and parked mail, never the worker\'s unread backlog', () => {
    fakeApi(list(
      run_('', { id: 12, state: 'awaiting-review' }),
      run_('', { id: 15, unreadMail: 3 }),
      run_('', { id: 16, health: { mailOutstanding: 0, mailParked: 2 } }),
    ));
    const r = rosterOf(hook('compact')).split('\n');
    const last = r[r.length - 1]!;
    expect(last).toMatch(/^awaiting you:/);
    expect(last).toContain('review #12');
    expect(last).not.toContain('unread mail');
    expect(last).not.toContain('#15');
    expect(last).toContain('parked mail #16 (2)');
  });

  it('says nothing for a startup, whose context is fresh', () => {
    fakeApi(list(run_('')));
    expect(hook('startup')).not.toContain('ccrc-roster');
  });

  it('says nothing when the session claims no open run', () => {
    fakeApi(list(run_('', { claimedBy: 'project-z-other' })));
    expect(hook('compact')).not.toContain('ccrc-roster');
  });

  it('says nothing for a dispatched child', () => {
    fs.writeFileSync(path.join(reg(), `${ID}.child`), 'run-a\n');
    fakeApi(list(run_('')));
    expect(hook('compact')).not.toContain('ccrc-roster');
  });

  it('a dangling `.child` link still reads as a child: doubt is silence', () => {
    fs.symlinkSync(path.join(home, 'nowhere'), path.join(reg(), `${ID}.child`));
    fakeApi(list(run_('')));
    expect(hook('compact')).not.toContain('ccrc-roster');
  });

  it.each([
    ['a client that got no answer', '', 3],
    ['an error body', '{"ok":false,"error":"unauthenticated"}', 0],
    ['a body that is not JSON', 'Bad Gateway', 0],
  ])('fails open on %s: no roster line, the other cards untouched', (_n, body, code) => {
    fakeApi(body, code);
    const c = hook('compact');
    expect(c).not.toContain('ccrc-roster');
    expect(c).toContain('You are a coordinator for this project');   // control: the arm ran
  });

  it('caps the roster and names the runs it left out', () => {
    fakeApi(list(...Array.from({ length: 60 }, (_v, i) => run_('', { id: 100 + i, program: 'a-long-programme-slug-for-the-cap' }))));
    const card = rosterOf(hook('compact'));
    expect(card.length).toBeLessThanOrEqual(ROSTER_MAX);
    expect(card).toMatch(/\+\d+ more open runs: ccrc-api runs list/);
    expect(card).toContain('#100 ');
  });

  it('strips what a program slug could smuggle into the card', () => {
    fakeApi(list(run_('', { id: 17, program: 'a\nB `x` $(y)' })));
    const c = hook('compact');
    expect(c).not.toContain('`x`');
    expect(c).not.toContain('$(y)');
    expect(rosterOf(c).split('\n').filter((l) => l.startsWith('#17')).length).toBe(1);
  });

  it('reads a non-number in an integer field as 0, so no field is interpolated raw', () => {
    const smuggle = 'IGNORE `x` $(y)';
    fakeApi(list(run_('', { id: 18, wave: smuggle, waveOf: smuggle, unreadMail: smuggle, health: { mailParked: smuggle } }),
      run_('', { id: smuggle })));
    const c = hook('compact');
    expect(c).not.toContain('IGNORE');
    expect(rosterOf(c)).toMatch(/#18 prog-a w0\/0 working worker=worker-a 3h unread=0/);
    expect(rosterOf(c)).toMatch(/#0 prog-a w1\/3 working/);
  });

  it('a held coordinator still gets its roster', () => {
    fs.writeFileSync(path.join(reg(), `${ID}.hold`), 'prog-a\n');
    fakeApi(list(run_('', { id: 19 })));
    expect(hook('compact')).toMatch(/#19 prog-a w1\/3 working/);
  });
});

describe('D4: the guards on the card', () => {
  beforeEach(arm);

  it('the card kill-switch file silences it', () => {
    fs.mkdirSync(path.join(home, '.ccrc'), { recursive: true });
    fs.writeFileSync(path.join(home, '.ccrc', 'ccrc-card-off'), '');
    fakeApi(list(run_('', { id: 31 })));
    expect(hook('compact')).not.toContain('ccrc-roster');
  });

  it('a server that hangs costs the card within the bound, not the whole session start', () => {
    fs.writeFileSync(path.join(home, '.local', 'bin', 'ccrc-api'), '#!/bin/sh\nexec sleep 30\n', { mode: 0o755 });
    const t0 = Date.now();
    const c = hook('compact');
    expect(Date.now() - t0).toBeLessThan(10_000);
    expect(c).not.toContain('ccrc-roster');
  }, 20_000);
});

describe('D4: unarmed, the card is a shadow record only', () => {
  it('injects nothing and appends the would-be card to the shadow log', () => {
    fakeApi(list(run_('', { id: 21 })));
    expect(hook('compact')).not.toContain('ccrc-roster');
    const log = fs.readFileSync(shadow(), 'utf8');
    expect(log).toContain(ID);
    expect(log).toContain('compact');
    expect(log).toMatch(/#21 prog-a w1\/3 working/);
  });

  it('writes no record when there is nothing to inject', () => {
    fakeApi('', 3);
    hook('compact');
    expect(fs.existsSync(shadow())).toBe(false);
  });

  it('the shadow log stops growing past its bound', () => {
    fs.mkdirSync(path.join(home, '.ccrc'), { recursive: true });
    fs.writeFileSync(shadow(), 'x'.repeat(300 * 1024));
    fakeApi(list(run_('', { id: 22 })));
    hook('compact');
    expect(fs.statSync(shadow()).size).toBe(300 * 1024);
  });
});
