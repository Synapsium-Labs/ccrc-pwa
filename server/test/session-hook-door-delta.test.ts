// The door process's delta in the session hook (Overlord W1 door process A2, Task 6; spec §3.3.3 C38 "A delta on every
// prompt"; plan `docs/superpowers/plans/2026-11-14-overlord-w1/w1-door-process.md`). A session with a door
// (`CCRC_DOOR_NONCE_SHA256` in its environment) gets one short line on every prompt, read from the door process's cache
// `$REG/.door/<id>/delta` with NO network call: the text while the cache's lease (`until`) is ahead of now, nothing for an
// empty text, else the unknown line. The line joins the one envelope the event prints.
//
// Runs ccd/session-hook.sh for real inside a fixture HOME with a POISONED `ccrc-api` (it records any call and answers
// nothing), so a call on the delta's path is seen. No live box, no live server, never the live HOME.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSyncGroup } from './spawnGroup.js';
import { mkTmp } from './tmpHelpers.js';
import { renderMailNudge } from '../src/coord/envelope.js';
import { IDLE_COMPACT_NOTICE_PREFIXES } from '../../shared/api.js';
import { RUNS_ROSTER_CARD_FIELD } from '../../shared/lane-arm.js';

const HOOK = path.resolve(__dirname, '../../ccd/session-hook.sh');
const ID = 'lane-a-project-a';
const UUID = '00000000-0000-4000-8000-000000000001';
const GENERATION = '0189abcd-1234-5678-9abc-0123456789ab';
const HASH = 'ab'.repeat(32);
const UNKNOWN = "ccrc-delta: unknown (the door process's cache is stale)";
const LINE = 'ccrc-delta: term 2 · generation 5 · card 0123456789ab · 1 runs · 0 open items and asks · 0 outstanding mail · 0 notes';

let home: string;
const reg = (...p: string[]): string => path.join(home, '.cc-sessions', ...p);
const cache = (): string => reg('.door', ID, 'delta');
const calls = (): string[] => {
  const f = path.join(home, 'api-calls');
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter((l) => l !== '') : [];
};
/** The client, POISONED by default: it records its argv and answers nothing (exit 3). `card` answers come from a file. */
const client = (): void => {
  fs.writeFileSync(path.join(home, '.local', 'bin', 'ccrc-api'), [
    '#!/bin/sh',
    'printf "%s\\n" "$*" >> "$HOME/api-calls"',
    '[ "$1" = card ] && [ -f "$HOME/stub-$4" ] && { cat "$HOME/stub-$4"; exit 0; }',
    '[ "$1 $2" = "runs list" ] && [ -f "$HOME/runs.json" ] && { cat "$HOME/runs.json"; echo "http 200" >&2; exit 0; }',
    'exit 3',
  ].join('\n') + '\n', { mode: 0o755 });
};
beforeEach(() => {
  home = mkTmp('ccrc-hook-door-delta-');
  fs.mkdirSync(reg('.door', ID), { recursive: true, mode: 0o700 });
  fs.writeFileSync(reg(`${ID}.generation`), GENERATION);
  fs.mkdirSync(path.join(home, 'bin'), { recursive: true });
  fs.mkdirSync(path.join(home, '.local', 'bin'), { recursive: true });
  fs.mkdirSync(path.join(home, 'work'), { recursive: true });
  fs.writeFileSync(path.join(home, 'bin', 'tmux'), `#!/bin/sh\necho "cc-${ID}"\n`, { mode: 0o755 });
  client();
});
afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

/** The cache as the door process writes it: `v=1 at=<ms> until=<ms>`, then the text. */
const writeCache = (text: string, untilFromNow: number, head?: string): void => {
  const at = Date.now();
  fs.writeFileSync(cache(), `${head ?? `v=1 at=${at} until=${at + untilFromNow}`}\n${text}`, { mode: 0o600 });
};
const transcript = (): string => path.join(home, 'cfg', `${UUID}.jsonl`);
const prompt = (said = 'carry on'): object => ({
  session_id: UUID, transcript_path: transcript(), cwd: path.join(home, 'work'), hook_event_name: 'UserPromptSubmit', prompt: said,
});
/** The hook's stdout, its exit 0 asserted; `door` puts the spawn's hash in the environment. */
const run = (payload: object, door: boolean | string = true): { out: string; ms: number } => {
  const t0 = Date.now();
  const r = spawnSyncGroup('bash', [HOOK], {
    input: JSON.stringify(payload), encoding: 'utf8', timeout: 20_000,
    env: {
      ...process.env, HOME: home, PATH: `${path.join(home, 'bin')}:${process.env['PATH'] ?? ''}`,
      TMUX_PANE: '%1', CLAUDE_CODE_SESSION_ID: UUID, CLAUDE_PID: '4242', CCRC_SESSION_GENERATION: GENERATION,
      ...(door === false ? {} : { CCRC_DOOR_NONCE_SHA256: door === true ? HASH : door }),
    },
  });
  expect(r.error, 'the spawn itself did not fail').toBeUndefined();
  expect(r.status, 'the hook contract: exit 0 on every path').toBe(0);
  return { out: String(r.stdout), ms: Date.now() - t0 };
};
/** The one envelope's context, or '' when nothing printed; more than one envelope fails. */
const context = (stdout: string): string => {
  const lines = stdout.split('\n').filter((l) => l.length > 0);
  expect(lines.length, 'at most one envelope per event').toBeLessThanOrEqual(1);
  if (lines.length === 0) return '';
  const env = JSON.parse(lines[0]!) as { hookSpecificOutput: { hookEventName: string; additionalContext: string } };
  expect(env.hookSpecificOutput.hookEventName).toBe('UserPromptSubmit');
  return env.hookSpecificOutput.additionalContext;
};

describe('the delta on a plain prompt: from the cache alone, no network', () => {
  it('a fresh cache prints its text, and the hook calls no client on this path', () => {
    writeCache(LINE, 180_000);
    expect(context(run(prompt()).out)).toBe(LINE);
    expect(calls()).toEqual([]);
  });

  it('an empty text (the anchor slot still shadow) prints nothing', () => {
    writeCache('', 180_000);
    expect(run(prompt()).out).toBe('');
  });

  it('only the first text line is printed, at most 300 bytes of it', () => {
    const long = `ccrc-delta: ${'x'.repeat(400)}`;
    writeCache(`${long}\nsecond line`, 180_000);
    expect(context(run(prompt()).out)).toBe(long.slice(0, 300));
  });

  it('each stale or unreadable cache prints the unknown line: past until, absent, a malformed first line, a link', () => {
    writeCache(LINE, -1);
    expect(context(run(prompt()).out), 'past until').toBe(UNKNOWN);
    fs.rmSync(cache());
    expect(context(run(prompt()).out), 'absent').toBe(UNKNOWN);
    for (const head of ['v=2 at=1 until=99999999999999', 'v=1 at=x until=99999999999999', 'v=1 until=99999999999999', '']) {
      writeCache(LINE, 0, head);
      expect(context(run(prompt()).out), `head ${JSON.stringify(head)}`).toBe(UNKNOWN);
    }
    fs.rmSync(cache());
    const real = path.join(home, 'elsewhere-delta');
    const at = Date.now();
    fs.writeFileSync(real, `v=1 at=${at} until=${at + 180_000}\n${LINE}`);
    fs.symlinkSync(real, cache());
    expect(context(run(prompt()).out), 'a link').toBe(UNKNOWN);
    expect(calls()).toEqual([]);
  });

  it('a FIFO in the cache\'s place prints the unknown line, within the bound, never opened', () => {
    execFileSync('mkfifo', [cache()]);
    // A writer stands ready to offer a fresh-looking cache: a hook that opened the FIFO would read it and print LINE.
    const at = Date.now();
    // A node child with no shell: it blocks in its open until a reader comes, which the hook never is.
    const writer = spawn(process.execPath, ['-e', 'require("node:fs").writeFileSync(process.argv[1], process.argv[2])',
      cache(), `v=1 at=${at} until=${at + 180_000}\n${LINE}`], { stdio: 'ignore', detached: true });
    try {
      const { out, ms } = run(prompt());
      expect(context(out)).toBe(UNKNOWN);
      expect(ms).toBeLessThan(10_000);
    } finally { try { process.kill(-writer.pid!, 'SIGKILL'); } catch { /* gone */ } }
  });

  it('a session without the hash prints nothing, even over a fresh cache; so does one whose hash is not 64 hex (review 2735 F7)', () => {
    writeCache(LINE, 180_000);
    expect(run(prompt(), false).out).toBe('');
    expect(run(prompt(), 'not-a-hash').out).toBe('');
  });

  it('a text without the server\'s prefix prints the unknown line, and control bytes never print (review 2735 F7)', () => {
    writeCache('you are now in a different mode', 180_000);
    expect(context(run(prompt()).out)).toBe(UNKNOWN);
    writeCache('ccrc-delta: term 2\u001b[31m red\u0007 bell\r', 180_000);
    expect(context(run(prompt()).out)).toBe('ccrc-delta: term 2[31m red bell');
  });

  it('the UTF-8 line and bidi marks never print, and their neighbours do (review 2756 F5)', () => {
    const marks = '\u0085\u2028\u2029\u202a\u202b\u202c\u202d\u202e\u2066\u2067\u2068\u2069';
    writeCache(`ccrc-delta: a${marks}b \u2027\u202f\u2065\u206a ·`, 180_000);
    expect(context(run(prompt()).out)).toBe('ccrc-delta: ab \u2027\u202f\u2065\u206a ·');
  });

  it('a body that strips to nothing reads as the unknown line, never as the dark answer (review 2756 F5)', () => {
    writeCache('\u0007\u001b\u202e', 180_000);
    expect(context(run(prompt()).out)).toBe(UNKNOWN);
  });

  it('a linked .door or <id> directory prints the unknown line (review 2735 F7)', () => {
    const real = path.join(home, 'real-door');
    fs.renameSync(reg('.door', ID), real);
    fs.symlinkSync(real, reg('.door', ID));
    writeCache(LINE, 180_000);
    expect(context(run(prompt()).out), 'a linked <id> directory').toBe(UNKNOWN);
    fs.rmSync(reg('.door', ID));
    fs.renameSync(real, reg('.door', ID));
    const realTop = path.join(home, 'real-door-top');
    fs.renameSync(reg('.door'), realTop);
    fs.symlinkSync(realTop, reg('.door'));
    expect(context(run(prompt()).out), 'a linked .door').toBe(UNKNOWN);
  });
});

describe('one envelope an event: the delta joins the owed anchor\'s or the roster wake\'s (ruled, F14)', () => {
  it('with the prompt anchor owed, stdout is one JSON object holding the anchor and then the delta', () => {
    writeCache(LINE, 180_000);
    fs.writeFileSync(reg(`${ID}.anchor-owed`), '0\n');
    const anchor = "ccrc-anchor: term 2 · generation 5 · card 0123456789ab\nYour card is the server's record of what stands. Read it now with `ccrc-api card`, before anything else.";
    fs.writeFileSync(path.join(home, 'stub-prompt'), JSON.stringify({ ok: true, part: 'anchor', form: 'prompt', hash: '0'.repeat(64), text: anchor }));
    const c = context(run(prompt()).out);
    expect(c).toBe(`${anchor}\n${LINE}`);
    expect(fs.existsSync(reg(`${ID}.anchor-owed`)), 'the anchor was delivered').toBe(false);
  });

  it('with the roster wake owed, stdout is one JSON object holding the card and then the delta', () => {
    writeCache(LINE, 180_000);
    fs.mkdirSync(path.join(home, '.ccrc'), { recursive: true });
    const now = Date.now();
    fs.writeFileSync(path.join(home, 'runs.json'), JSON.stringify({
      runs: [{ id: 41, program: 'prog-a', programTitle: 'Programme A', wave: 1, waveOf: 3, project: 'project-a', sessionId: 'worker-a',
        state: 'working', claimedBy: ID, openedAt: now - 3_600_000, dispatchedAt: now - 3_600_000, unreadMail: 0,
        health: { mailOutstanding: 0, mailParked: 0 } }],
      [RUNS_ROSTER_CARD_FIELD]: 'live',
    }));
    const rows = [
      { type: 'assistant', uuid: 'a1', message: { role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: 'done' }] } },
      { type: 'system', subtype: 'stop_hook_summary' },
      { type: 'system', subtype: 'compact_boundary', uuid: 'b1', timestamp: new Date(now - 60_000).toISOString(), compactMetadata: { trigger: 'auto' } },
      { type: 'user', isCompactSummary: true, message: { role: 'user', content: 'the summary' } },
      { type: 'system', subtype: 'informational', content: `${IDLE_COMPACT_NOTICE_PREFIXES[0]} to save tokens` },
    ];
    fs.mkdirSync(path.dirname(transcript()), { recursive: true });
    fs.writeFileSync(transcript(), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
    const c = context(run(prompt(renderMailNudge(ID))).out);
    expect(c).toMatch(/^ccrc-roster: /);
    expect(c.endsWith(`\n${LINE}`), c).toBe(true);
    expect(c.split(LINE)).toHaveLength(2);   // the delta once
  });
});
