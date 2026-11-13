// Overlord W1a, the start report (Task 3): every SessionStart of a main-thread session that is not a child is reported to
// `POST /api/sessions/:id/start` through the closed client (`ccrc-api sessions start <id> --json <file>`), bounded by
// `_hook_timeout 4`. The body is spooled first as `$REG/<id>.start-pending.<reportId>` and removed only on a 202, so a
// refused, timed-out or killed send is resent at the session's next UserPromptSubmit, Stop or SessionStart, at most
// START_PENDING_MAX files kept (the oldest dropped first, each drop counted). The start path's exit code and stdout never
// change for it.
//
// Runs ccd/session-hook.sh for real inside a fixture HOME with a fake `ccrc-api`; no live box, no live server. The
// harness is COPIED from session-hook-roster-card.test.ts (a test file cannot import another).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';

const HOOK = path.resolve(__dirname, '../../ccd/session-hook.sh');
const GENERATION = '0189abcd-1234-5678-9abc-0123456789ab';
const SID = '00000000-0000-4000-8000-000000000001';
const ID = 'lane-a-project-a';
const MAX = 20;

let home: string;
const reg = (): string => path.join(home, '.cc-sessions');
beforeEach(() => {
  home = mkTmp('ccrc-hook-start-');
  fs.mkdirSync(reg(), { recursive: true });
  fs.mkdirSync(path.join(home, 'bin'), { recursive: true });
  fs.mkdirSync(path.join(home, '.local', 'bin'), { recursive: true });
  fs.mkdirSync(path.join(home, 'work'), { recursive: true });
  fs.writeFileSync(path.join(reg(), `${ID}.generation`), GENERATION);
  fs.writeFileSync(path.join(home, 'bin', 'tmux'), `#!/bin/sh\necho "cc-${ID}"\n`, { mode: 0o755 });
  // The fake closed client. `runs list` (the roster card's read) answers an empty list; `sessions start` records its argv
  // and the body file it was handed, then answers the status in `api.code` (202 when absent), or hangs on `hang`.
  fs.writeFileSync(path.join(home, '.local', 'bin', 'ccrc-api'), [
    '#!/bin/sh',
    'if [ "$1 $2" = "runs list" ]; then echo \'{"runs":[]}\'; echo "http 200" >&2; exit 0; fi',
    '[ "$1 $2" = "sessions start" ] || exit 9',
    `printf '%s\\n' "$*" >> "${home}/api.argv"`,
    `cat "$5" >> "${home}/api.bodies"`,
    `code=$(cat "${home}/api.code" 2>/dev/null || echo 202)`,
    'if [ "$code" = hang ]; then sleep 20; fi',
    'echo \'{"ok":true}\'; echo "http $code" >&2; exit 0',
  ].join('\n') + '\n', { mode: 0o755 });
});
afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

const answer = (code: string): void => { fs.writeFileSync(path.join(home, 'api.code'), code); };
const argv = (): string[] => {
  const f = path.join(home, 'api.argv');
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter((l) => l.length > 0) : [];
};
const bodies = (): Record<string, unknown>[] => {
  const f = path.join(home, 'api.bodies');
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter((l) => l.length > 0).map((l) => JSON.parse(l) as Record<string, unknown>) : [];
};
const pending = (): string[] => fs.readdirSync(reg()).filter((n) => n.startsWith(`${ID}.start-pending.`) && !n.endsWith('.dropped')).sort();
const dropped = (): string => {
  const f = path.join(reg(), `${ID}.start-pending.dropped`);
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim() : '';
};

const base = (): object => ({ session_id: SID, transcript_path: path.join(home, 'cfg', 'projects', '-work', `${SID}.jsonl`), cwd: path.join(home, 'work') });
const start = (source: string, extra: Record<string, unknown> = {}): object =>
  ({ ...base(), hook_event_name: 'SessionStart', source, model: 'claude-model-a', ...extra });
const prompt = (): object => ({ ...base(), hook_event_name: 'UserPromptSubmit', prompt: 'hello' });
const toolUse = (): object => ({ ...base(), hook_event_name: 'PostToolUse', tool_name: 'Read', tool_use_id: 'toolu_1', tool_input: { file_path: '/x' }, tool_response: {} });

const hook = (p: object): { status: number | null; stdout: string; ms: number } => {
  const t0 = Date.now();
  const r = spawnSync('bash', [HOOK], {
    input: JSON.stringify(p), encoding: 'utf8',
    env: {
      ...process.env, HOME: home, PATH: `${path.join(home, 'bin')}:${process.env['PATH'] ?? ''}`,
      TMUX_PANE: '%1', CLAUDE_CODE_SESSION_ID: SID, CLAUDE_PID: '4242', CCRC_SESSION_GENERATION: GENERATION,
    },
  });
  return { status: r.status, stdout: r.stdout, ms: Date.now() - t0 };
};

describe('the start report', () => {
  it('a SessionStart clear sends one report with the payload\'s uuid, source and model and the env\'s generation', () => {
    expect(hook(start('clear')).status).toBe(0);
    expect(argv()).toHaveLength(1);
    expect(argv()[0]).toMatch(new RegExp(`^sessions start ${ID} --json \\S+$`));
    const [b] = bodies();
    expect(b).toMatchObject({ fromId: ID, fromUuid: SID, source: 'clear', model: 'claude-model-a', regGen: GENERATION });
    expect(String(b!['reportId'])).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    expect(Number.isSafeInteger(b!['reportedAt'])).toBe(true);
    expect(pending(), 'a 202 leaves nothing spooled').toEqual([]);
  });

  it.each(['startup', 'resume', 'compact'])('a SessionStart %s is reported too', (source) => {
    hook(start(source));
    expect(bodies().map((b) => b['source'])).toEqual([source]);
  });

  it('a payload with no model and an env with no generation report null for both', () => {
    const p = start('startup') as Record<string, unknown>;
    delete p['model'];
    const r = spawnSync('bash', [HOOK], {
      input: JSON.stringify(p), encoding: 'utf8',
      env: { ...process.env, HOME: home, PATH: `${path.join(home, 'bin')}:${process.env['PATH'] ?? ''}`, TMUX_PANE: '%1', CLAUDE_CODE_SESSION_ID: SID,
        CCRC_SESSION_GENERATION: '' },
    });
    expect(r.status).toBe(0);
    expect(bodies()[0]).toMatchObject({ model: null, regGen: null });
  });

  it('a child sends none', () => {
    fs.writeFileSync(path.join(reg(), `${ID}.child`), '1880');
    hook(start('clear'));
    hook(prompt());
    expect(argv()).toEqual([]);
    expect(pending()).toEqual([]);
  });

  it('a subagent\'s event sends none', () => {
    hook(start('startup', { agent_id: 'agent-1' }));
    expect(argv()).toEqual([]);
  });

  it('a refused report (403) leaves one pending file; the next UserPromptSubmit resends it and removes it on a 202', () => {
    answer('403');
    hook(start('clear'));
    expect(pending()).toHaveLength(1);
    const first = bodies()[0]!;
    answer('202');
    expect(hook(prompt()).status).toBe(0);
    expect(bodies()).toHaveLength(2);
    expect(bodies()[1]).toEqual(first);
    expect(pending(), 'removed on the 202').toEqual([]);
  });

  it('a tool event never resends: the hot path calls nothing', () => {
    answer('403');
    hook(start('clear'));
    answer('202');
    hook(toolUse());
    expect(argv()).toHaveLength(1);
    expect(pending()).toHaveLength(1);
  });

  it('a hanging server costs the start path only its bound: exit code and stdout unchanged, one pending file', () => {
    const ok = hook(start('clear'));
    fs.rmSync(path.join(home, 'api.argv'));
    answer('hang');
    const slow = hook(start('clear'));
    expect(slow.status).toBe(0);
    expect(slow.stdout).toBe(ok.stdout);
    expect(slow.ms, 'bounded by _hook_timeout 4').toBeLessThan(12_000);
    expect(pending()).toHaveLength(1);
  }, 30_000);

  it(`keeps at most ${MAX} pending files, the oldest dropped first and each drop counted`, () => {
    answer('403');
    const names = Array.from({ length: MAX }, (_, i) => `${ID}.start-pending.${1_700_000_000_000 + i}-1-1`);
    for (const n of names) fs.writeFileSync(path.join(reg(), n), '{}\n');
    hook(start('clear'));
    const now = pending();
    expect(now).toHaveLength(MAX);
    expect(now).not.toContain(names[0]);
    expect(now).toContain(names[1]);
    expect(dropped()).toBe('1');
    hook(start('clear'));
    expect(pending()).toHaveLength(MAX);
    expect(dropped()).toBe('2');
  });
});
