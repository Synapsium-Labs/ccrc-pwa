// Overlord W1a, the start report (Task 3, as plan review 1890's I2 to I4 shape it): every SessionStart of a main-thread
// session that is not a child, `fork` excluded, is reported to `POST /api/sessions/:id/start` through the closed client
// (`ccrc-api sessions start <id> --json -`), the whole event inside one 4 s budget, the fresh report first. A report not
// taken is kept in one dot-free field, `$REG/<id>.startpending`, which `_reg_purge` and `_ws_slug_residue` take with the
// row: no answer keeps it untried; `stale-uuid`, a 404, a 401, a 5xx or a local refusal keep it and count a try; any other
// refusal drops it, counted. Only SessionStart and UserPromptSubmit resend, after the back-off the last pass stamped by
// how it ended, each kept report once, with the sender's current uuid; a report tried START_RESEND_TRIES times is
// dropped. The start path's exit code and stdout never change for it (review 1911: F2, F3, F4, F6, F7, F9).
//
// Runs ccd/session-hook.sh for real inside a fixture HOME with a fake `ccrc-api`; no live box, no live server. The
// harness is COPIED from session-hook-roster-card.test.ts (a test file cannot import another). The purge cases run ccd's
// own functions through `makeCcdHarness`, in a fixture HOME of their own.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';

const HOOK = path.resolve(__dirname, '../../ccd/session-hook.sh');
const GENERATION = '0189abcd-1234-5678-9abc-0123456789ab';
const SID = '00000000-0000-4000-8000-000000000001';
const ID = 'lane-a-project-a';
const MAX = 20;
const TRIES = 5;
const BUDGET = 4000;
const LONG = 30_000;
const SHORT = 5000;

let home: string;
const reg = (): string => path.join(home, '.cc-sessions');
const spoolFile = (): string => path.join(reg(), `${ID}.startpending`);
beforeEach(() => {
  home = mkTmp('ccrc-hook-start-');
  fs.mkdirSync(reg(), { recursive: true });
  fs.mkdirSync(path.join(home, 'bin'), { recursive: true });
  fs.mkdirSync(path.join(home, '.local', 'bin'), { recursive: true });
  fs.mkdirSync(path.join(home, 'work'), { recursive: true });
  fs.writeFileSync(path.join(reg(), `${ID}.generation`), GENERATION);
  fs.writeFileSync(path.join(home, 'bin', 'tmux'), `#!/bin/sh\necho "cc-${ID}"\n`, { mode: 0o755 });
  // The fake closed client. `runs list` (the roster card's read) answers an empty list; `sessions start` records its argv
  // and the body it read from stdin, then answers what `api.code` holds: `202`, `<status> <error word>`, `hang`, `slow`
  // (202 after 3.6 s), `late` (202 after 2.5 s, then a hang), `local` (the client's own refusal, exit 2) or `purge`.
  fs.writeFileSync(path.join(home, '.local', 'bin', 'ccrc-api'), [
    '#!/bin/sh',
    'if [ "$1 $2" = "runs list" ]; then echo \'{"runs":[]}\'; echo "http 200" >&2; exit 0; fi',
    '[ "$1 $2" = "sessions start" ] || exit 9',
    `printf '%s\\n' "$*" >> "${home}/api.argv"`,
    `cat >> "${home}/api.bodies"`,
    `set -- $(cat "${home}/api.code" 2>/dev/null || echo 202)`,
    'if [ "$1" = hang ]; then sleep 20; fi',
    'if [ "$1" = slow ]; then sleep 3.6; set -- 202; fi',
    `if [ "$1" = late ]; then if [ -e "${home}/api.once" ]; then sleep 20; fi; : > "${home}/api.once"; sleep 2.5; set -- 202; fi`,
    'if [ "$1" = local ]; then echo "ccrc-api: --json needs a body (bad-args)" >&2; exit 2; fi',
    // `purge`: the row is purged while the send is in flight (plan review 1896, R12), then the server answers stale-uuid.
    `if [ "$1" = purge ]; then rm -f "${path.join(home, '.cc-sessions', `${ID}.generation`)}"; set -- 403 stale-uuid; fi`,
    'if [ "$1" = 202 ]; then echo \'{"ok":true,"id":1,"fresh":true}\'; else echo "{\\"ok\\":false,\\"error\\":\\"$2\\"}"; fi',
    'echo "http $1" >&2; exit 0',
  ].join('\n') + '\n', { mode: 0o755 });
});
afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

const answer = (code: string): void => { fs.writeFileSync(path.join(home, 'api.code'), code); };
const calls = (): number => {
  const f = path.join(home, 'api.argv');
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter((l) => l.length > 0).length : 0;
};
const argv = (): string[] => fs.readFileSync(path.join(home, 'api.argv'), 'utf8').split('\n').filter((l) => l.length > 0);
const bodies = (): Record<string, unknown>[] => {
  const f = path.join(home, 'api.bodies');
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter((l) => l.length > 0).map((l) => JSON.parse(l) as Record<string, unknown>) : [];
};
/** The spool as the hook keeps it: its header and its kept reports, or null when the field is absent. */
const spool = (): { after: number; dropped: number; kept: { tries: number; body: Record<string, unknown> }[] } | null => {
  if (!fs.existsSync(spoolFile())) return null;
  const [head, ...rest] = fs.readFileSync(spoolFile(), 'utf8').split('\n').filter((l) => l.length > 0);
  const [after, dropped] = head!.split('\t').map(Number);
  return { after: after!, dropped: dropped!, kept: rest.map((l) => ({ tries: Number(l.split('\t')[0]), body: JSON.parse(l.slice(l.indexOf('\t') + 1)) as Record<string, unknown> })) };
};
/** Writes a spool of `n` untried reports spooled under `uuid`, its back-off passed. */
const seed = (n: number, uuid = SID): void => {
  const lines = Array.from({ length: n }, (_, i) => `0\t${JSON.stringify({ fromId: ID, fromUuid: uuid, startedUuid: uuid, reportId: `seed-${String(i).padStart(4, '0')}`, source: 'clear', model: null, rowIncarnation: null, reportedAt: 1 })}`);
  fs.writeFileSync(spoolFile(), `0\t0\n${lines.join('\n')}\n`);
};
/** Moves the spool's back-off stamp into the past, as the passing of the back-off would. */
const expireBackoff = (): void => {
  const lines = fs.readFileSync(spoolFile(), 'utf8').split('\n');
  lines[0] = `0\t${lines[0]!.split('\t')[1]}`;
  fs.writeFileSync(spoolFile(), lines.join('\n'));
};

const base = (): object => ({ session_id: SID, transcript_path: path.join(home, 'cfg', 'projects', '-work', `${SID}.jsonl`), cwd: path.join(home, 'work') });
const start = (source: string, extra: Record<string, unknown> = {}): object =>
  ({ ...base(), hook_event_name: 'SessionStart', source, model: 'claude-model-a', ...extra });
const prompt = (): object => ({ ...base(), hook_event_name: 'UserPromptSubmit', prompt: 'hello' });
const preTool = (): object => ({ ...base(), hook_event_name: 'PreToolUse', tool_name: 'Read', tool_use_id: 'toolu_1', tool_input: { file_path: '/x' } });
const postTool = (): object => ({ ...base(), hook_event_name: 'PostToolUse', tool_name: 'Read', tool_use_id: 'toolu_1', tool_input: { file_path: '/x' }, tool_response: {} });
const stop = (): object => ({ ...base(), hook_event_name: 'Stop', stop_hook_active: false });

const hook = (p: object, env: Record<string, string> = {}): { status: number | null; stdout: string; ms: number } => {
  const t0 = Date.now();
  const r = spawnSync('bash', [HOOK], {
    input: JSON.stringify(p), encoding: 'utf8',
    env: {
      ...process.env, HOME: home, PATH: `${path.join(home, 'bin')}:${process.env['PATH'] ?? ''}`,
      TMUX_PANE: '%1', CLAUDE_CODE_SESSION_ID: SID, CLAUDE_PID: '4242', CCRC_SESSION_GENERATION: GENERATION, ...env,
    },
  });
  return { status: r.status, stdout: r.stdout, ms: Date.now() - t0 };
};

describe('the start report: what is sent', () => {
  it('a SessionStart clear sends one report with the payload\'s uuid, source and model and the row\'s incarnation; a 202 keeps nothing', () => {
    expect(hook(start('clear')).status).toBe(0);
    expect(argv()).toEqual([`sessions start ${ID} --json -`]);
    const [b] = bodies();
    expect(b).toMatchObject({ fromId: ID, fromUuid: SID, source: 'clear', model: 'claude-model-a', rowIncarnation: GENERATION });
    expect(String(b!['reportId'])).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    expect(Number.isSafeInteger(b!['reportedAt'])).toBe(true);
    expect(spool(), 'a 202 leaves no spool').toBeNull();
  });

  it.each(['startup', 'resume', 'compact'])('a SessionStart %s is reported too', (source) => {
    hook(start(source));
    expect(bodies().map((b) => b['source'])).toEqual([source]);
  });

  it('a fork is never reported: it shares this pane\'s id under a new uuid, so it could never be attributed', () => {
    hook(start('fork'));
    expect(calls()).toBe(0);
    expect(spool()).toBeNull();
  });

  it('no model in the payload and no incarnation in the env, or a malformed one, report null for both', () => {
    const p = start('startup') as Record<string, unknown>;
    delete p['model'];
    hook(p, { CCRC_SESSION_GENERATION: '' });
    hook(p, { CCRC_SESSION_GENERATION: '0189ABCD-1234-5678-9abc-0123456789ab' });
    expect(bodies().map((b) => [b['model'], b['rowIncarnation']])).toEqual([[null, null], [null, null]]);
  });

  it('an empty source is reported as other', () => {
    hook(start(''));
    expect(bodies().map((b) => b['source'])).toEqual(['other']);
  });

  it('a row ccd did not create (no generation) and an id outside the client\'s grammar send none', () => {
    fs.rmSync(path.join(reg(), `${ID}.generation`));
    hook(start('clear'));
    const dotted = 'lane-a.x-project-a';
    fs.writeFileSync(path.join(reg(), `${dotted}.generation`), GENERATION);
    fs.writeFileSync(path.join(home, 'bin', 'tmux'), `#!/bin/sh\necho "cc-${dotted}"\n`, { mode: 0o755 });
    hook(start('clear'));
    expect(calls()).toBe(0);
    expect(fs.readdirSync(reg()).filter((n) => n.includes('startpending'))).toEqual([]);
  });

  it('a child sends none, and neither does a subagent\'s event', () => {
    hook(start('startup', { agent_id: 'agent-1' }));
    fs.writeFileSync(path.join(reg(), `${ID}.child`), '1880');
    hook(start('clear'));
    hook(prompt());
    expect(calls()).toBe(0);
    expect(spool()).toBeNull();
  });
});

describe('the start report: what is kept and resent', () => {
  it('a stale-uuid refusal is kept with a try; the first UserPromptSubmit past the back-off resends it and clears the field on a 202', () => {
    answer('403 stale-uuid');
    hook(start('clear'));
    expect(spool()).toMatchObject({ dropped: 0, kept: [{ tries: 1 }] });
    const first = bodies()[0]!;
    expect(first).toMatchObject({ fromUuid: SID, startedUuid: SID });
    answer('202');
    expireBackoff();
    expect(hook(prompt()).status).toBe(0);
    expect(bodies()).toEqual([first, first]);
    expect(spool(), 'the field goes once nothing is kept and nothing was dropped').toBeNull();
  });

  it('any other refusal is dropped and counted, never kept', () => {
    answer('403 not-owner');
    hook(start('clear'));
    expect(spool()).toMatchObject({ dropped: 1, kept: [] });
    answer('202');
    hook(prompt());
    expect(calls(), 'nothing to resend').toBe(1);
  });

  it('PreToolUse, PostToolUse and Stop make no call, whatever is kept', () => {
    answer('403 stale-uuid');
    hook(start('clear'));
    answer('202');
    for (const ev of [preTool(), postTool(), stop()]) expect(hook(ev).status).toBe(0);
    expect(calls()).toBe(1);
    expect(spool()!.kept).toHaveLength(1);
  });

  it('a resend refused again sets a back-off: the next UserPromptSubmit inside it makes no call', () => {
    answer('403 stale-uuid');
    hook(start('clear'));
    expireBackoff();
    hook(prompt());
    expect(calls()).toBe(2);
    const s = spool()!;
    expect(s.kept).toMatchObject([{ tries: 2 }]);
    expect(s.after).toBeGreaterThan(Date.now());
    hook(prompt());
    expect(calls(), 'inside the back-off').toBe(2);
  });

  it(`a report refused stale-uuid ${TRIES} times, its first send included, is dropped and counted`, () => {
    answer('403 stale-uuid');
    hook(start('clear'));
    for (let i = 1; i < TRIES; i++) { expireBackoff(); hook(prompt()); }
    expect(calls()).toBe(TRIES);
    expect(spool()).toMatchObject({ dropped: 1, kept: [] });
    hook(prompt());
    expect(calls()).toBe(TRIES);
  });

  it('a hanging server costs the start path only its bound: exit code and stdout unchanged, the report kept', () => {
    const ok = hook(start('clear'));
    answer('hang');
    const slow = hook(start('clear'));
    expect(slow.status).toBe(0);
    expect(slow.stdout).toBe(ok.stdout);
    expect(slow.ms, 'inside the 4 s budget').toBeLessThan(ok.ms + BUDGET + 800);
    expect(spool()).toMatchObject({ dropped: 0, kept: [{ tries: 0 }] });
  }, 30_000);

  it('a send with no answer ends the pass: one call, both reports still kept', () => {
    answer('403 stale-uuid');
    hook(start('clear'));
    hook(start('startup'));
    expect(spool()!.kept).toHaveLength(2);
    expireBackoff();
    fs.rmSync(path.join(home, 'api.argv'));
    answer('hang');
    hook(prompt());
    expect(calls(), 'the first send timed out and ended the pass').toBe(1);
    expect(spool()!.kept).toHaveLength(2);
  }, 30_000);

  it('a 5xx answer (registry-unmeasurable) keeps the report, counts a try and ends the pass (review 1911, F6)', () => {
    answer('403 stale-uuid');
    hook(start('clear'));
    hook(start('startup'));
    expireBackoff();
    fs.rmSync(path.join(home, 'api.argv'));
    answer('502 registry-unmeasurable');
    hook(prompt());
    expect(calls()).toBe(1);
    expect(spool()).toMatchObject({ dropped: 0, kept: [{ tries: 2 }, { tries: 1 }] });
  });

  it('a start goes first; when the server is silent the kept reports are not sent: one budget, not two', () => {
    answer('403 stale-uuid');
    hook(start('clear'));
    expireBackoff();
    fs.rmSync(path.join(home, 'api.argv'));
    answer('hang');
    const r = hook(start('resume'));
    expect(r.status).toBe(0);
    expect(bodies().map((b) => b['source']), 'the new start was sent, timed out, and ended the pass').toEqual(['clear', 'resume']);
    expect(calls()).toBe(1);
    expect(r.ms).toBeLessThan(BUDGET + 3000);
    expect(spool()!.kept.map((k) => k.body['source']), 'oldest first').toEqual(['clear', 'resume']);
  }, 30_000);

  it('a row purged during the send leaves no field behind: the generation is looked at again after the write (review 1896, R12)', () => {
    answer('purge');
    expect(hook(start('clear')).status).toBe(0);
    expect(calls()).toBe(1);
    expect(fs.readdirSync(reg()).filter((n) => n.startsWith(`${ID}.startpending`)), 'no orphan field, no temp file').toEqual([]);
  });

  it(`keeps at most ${MAX} reports, the oldest dropped first and counted`, () => {
    answer('403 stale-uuid');
    const old = Array.from({ length: MAX }, (_, i) => `0\t${JSON.stringify({ reportId: `seed-${String(i).padStart(4, '0')}` })}`);
    fs.writeFileSync(spoolFile(), `${Date.now() + 600_000}\t0\n${old.join('\n')}\n`);
    hook(start('clear'));
    const s = spool()!;
    expect(s.kept).toHaveLength(MAX);
    expect(s.kept[0]!.body['reportId']).toBe('seed-0001');
    expect(s.kept[MAX - 1]!.body['source']).toBe('clear');
    expect(s.dropped).toBe(1);
  });
});

describe('the start report: the budget, the answers that count a try, and the back-off (review 1911)', () => {
  it.each([['SessionStart', (): object => start('clear')], ['UserPromptSubmit', prompt]] as const)(
    'a %s against a slow server that answers (202 after 3.6 s) with two kept reports stays inside the 4 s budget (F2)', (_name, ev) => {
      const base = hook(prompt());
      expect(calls(), 'nothing kept, nothing sent').toBe(0);
      seed(2);
      answer('slow');
      const r = hook(ev());
      expect(r.status).toBe(0);
      expect(calls(), 'one send fits; none starts with under a second left').toBe(1);
      expect(r.ms, 'the whole event: the budget plus a small margin').toBeLessThan(base.ms + BUDGET + 800);
      const s = spool()!;
      expect(s.kept.length + (ev === prompt ? 1 : 0), 'what was not sent is kept, untried').toBe(2);
      expect(s.kept.every((k) => k.tries === 0)).toBe(true);
      expect(s.after, 'a spent budget stamps the short back-off').toBeLessThanOrEqual(Date.now() + SHORT);
    }, 30_000);

  it('a send started late gets only what is left of the budget, never a whole bound of its own (F2)', () => {
    const base = hook(prompt());
    seed(1);
    answer('late');
    const r = hook(start('clear'));
    // The fresh report takes 2.5 s; the kept one then starts with about 1.5 s left (on a loaded box it may not start).
    expect(calls()).toBeLessThanOrEqual(2);
    expect(r.ms).toBeLessThan(base.ms + BUDGET + 800);
    expect(spool()).toMatchObject({ dropped: 0, kept: [{ tries: 0 }] });
  }, 30_000);

  it.each(['404 not-found', '401 unauthenticated'])('a %s (an older server, mid-rollout) keeps the report, counts a try and stamps the long back-off (F3)', (code) => {
    answer(code);
    const t0 = Date.now();
    hook(start('clear'));
    const s = spool()!;
    expect(s).toMatchObject({ dropped: 0, kept: [{ tries: 1 }] });
    expect(s.after).toBeGreaterThanOrEqual(t0 + LONG);
    hook(prompt());
    expect(calls(), 'inside the back-off').toBe(1);
    for (let i = 1; i < TRIES; i++) { expireBackoff(); hook(prompt()); }
    expect(spool(), `bounded by ${TRIES} tries`).toMatchObject({ dropped: 1, kept: [] });
  });

  it('a 5xx on the fresh send keeps it with a try, ends the pass and stamps the long back-off (F6, F9)', () => {
    seed(1);
    answer('503 unavailable');
    const t0 = Date.now();
    hook(start('clear'));
    expect(calls(), 'the kept report is not sent after it').toBe(1);
    const s = spool()!;
    expect(s).toMatchObject({ dropped: 0, kept: [{ tries: 0, body: { reportId: 'seed-0000' } }, { tries: 1, body: { source: 'clear' } }] });
    expect(s.after).toBeGreaterThanOrEqual(t0 + LONG);
  });

  it('the client\'s own refusal (exit 2) keeps the report, counts a try and ends the pass (F9)', () => {
    seed(2);
    answer('local');
    hook(prompt());
    expect(calls()).toBe(1);
    expect(spool()).toMatchObject({ dropped: 0, kept: [{ tries: 1 }, { tries: 0 }] });
  });

  it('a 400 not-owner is dropped and counted, as the 403 is (F9)', () => {
    answer('400 not-owner');
    hook(start('clear'));
    expect(spool()).toMatchObject({ dropped: 1, kept: [] });
  });

  it('a resend carries the sender\'s current uuid in fromUuid and the spooled report\'s in startedUuid (F4)', () => {
    const A = '00000000-0000-4000-8000-00000000000a';
    const B = '00000000-0000-4000-8000-00000000000b';
    seed(1, A);
    const older = JSON.parse(fs.readFileSync(spoolFile(), 'utf8').split('\n')[1]!.split('\t')[1]!) as Record<string, unknown>;
    delete older['startedUuid'];
    fs.writeFileSync(spoolFile(), `0\t0\n0\t${JSON.stringify(older)}\n`);
    expect(hook({ ...prompt(), session_id: B }, { CLAUDE_CODE_SESSION_ID: B }).status).toBe(0);
    expect(bodies()).toMatchObject([{ fromUuid: B, startedUuid: A, reportId: 'seed-0000' }]);
    expect(spool(), 'taken').toBeNull();
  });

  it('a stale-uuid keep stamps the short back-off, one supervisor tick (F7)', () => {
    answer('403 stale-uuid');
    const t0 = Date.now();
    hook(start('clear'));
    const { after } = spool()!;
    expect(after).toBeGreaterThanOrEqual(t0 + SHORT);
    expect(after).toBeLessThan(t0 + SHORT + 2000);
  });

  it('a start whose fresh send found the server silent stamps the long back-off, so the next prompt waits (F7)', () => {
    answer('hang');
    const t0 = Date.now();
    hook(start('clear'));
    expect(spool()!.after).toBeGreaterThanOrEqual(t0 + LONG);
    const r = hook(prompt());
    expect(calls()).toBe(1);
    expect(r.ms).toBeLessThan(BUDGET);
  }, 30_000);

  it('a stamp further out than the long back-off (a clock stepped back) is read as the long back-off (F7, F15)', () => {
    seed(1);
    const lines = fs.readFileSync(spoolFile(), 'utf8').split('\n');
    lines[0] = `${Date.now() + 3_600_000}\t0`;
    fs.writeFileSync(spoolFile(), lines.join('\n'));
    hook(prompt());
    expect(calls(), 'still inside the clamped back-off').toBe(0);
    expect(spool()!.after).toBeLessThanOrEqual(Date.now() + LONG);
  });
});

describe('the start report\'s field goes with its row (plan review 1890, I2)', () => {
  let h: CcdHarness;
  beforeEach(() => { h = makeCcdHarness('ccrc-start-purge-'); });
  afterEach(() => { h.cleanup(); });
  const REGD = (): string => path.join(h.home, '.cc-sessions');
  const id = 'demo-still-river';

  it('_reg_purge removes <id>.startpending and leaves a neighbour\'s standing', () => {
    h.sh(`_reg_set ${id} uuid 72be9ee2-0000-4bcc-b60b-0cfc0dc3d199; _reg_set ${id} project demo`);
    fs.writeFileSync(path.join(REGD(), `${id}.startpending`), '0\t0\n');
    fs.writeFileSync(path.join(REGD(), `${id}x.startpending`), '0\t0\n');
    const out = h.sh(`_reg_purge ${id}; echo "rc=$?"`);
    expect(out).toContain('rc=0');
    expect(fs.existsSync(path.join(REGD(), `${id}.startpending`))).toBe(false);
    expect(fs.existsSync(path.join(REGD(), `${id}x.startpending`))).toBe(true);
  });

  it('a spool write that lands after the purge\'s glob has run is still gone when the purge returns (review 1911, F1, side b)', () => {
    h.sh(`_reg_set ${id} uuid 72be9ee2-0000-4bcc-b60b-0cfc0dc3d199; _reg_set ${id} project demo`);
    // `_usage_purge` runs after the glob loop and before `generation` goes: the hook's rename lands there.
    const out = h.sh(`_usage_purge() { printf '0\\t0\\n' > "$REG/${id}.startpending"; echo landed; }; _reg_purge ${id}; echo "rc=$?"`);
    expect(out).toContain('landed');
    expect(out).toContain('rc=0');
    expect(fs.existsSync(path.join(REGD(), `${id}.startpending`)), 'taken once more after generation').toBe(false);
  });

  it('_ws_slug_residue names <id>.startpending while it stands', () => {
    fs.writeFileSync(path.join(REGD(), `${id}.startpending`), '0\t0\n');
    expect(h.sh('_ws_slug_residue demo still-river')).toContain(`${id}.startpending`);
  });
});
