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

  // CHARACTERIZATION (D-8201): the card's exact text, pinned before its builder moves out of the hook, so the move is
  // proved to change no byte of it.
  it('the card, byte for byte: the header, one line per run, the awaiting-you line', () => {
    fakeApi(list(run_('', { id: 11 }), run_('', { id: 12, state: 'awaiting-review', waveOf: null, unreadMail: 1 })));
    expect(rosterOf(hook('compact'))).toBe([
      'ccrc-roster: 2 open run(s) you claim; re-read with `~/.local/bin/ccrc-api runs list`.',
      '#11 prog-a w1/3 working worker=worker-a 3h unread=0',
      '#12 prog-a w1 awaiting-review worker=worker-a 3h unread=1',
      'awaiting you: review #12',
    ].join('\n'));
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
    expect(c).toContain('You are still this project\'s coordinator');   // control: the arm ran (compact gets the short reminder, D-8142)
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

// ── R-5a (D-8201): the wake arm ────────────────────────────────────────────────────────────────────────────────────────
// Claude Code's idle compaction (about 55 minutes after a turn ends) starts no turn and fires none of the card's three
// SessionStart events, so a coordinator next wakes on the server's mail nudge, or on its idle-compaction nudge, with a
// compacted context and no roster. The wake arm is the hook's UserPromptSubmit for exactly those two prompts: when the
// newest compaction in the transcript is an idle one (the server's own reading, `isIdleCompaction`) and no turn has run
// since, the wake turn carries the SAME card, built by the same builder (`ccd/lib/roster-card.jq`), as its context,
// under the same switch and the same shadow log.
import { renderMailNudge } from '../src/coord/envelope.js';
import { IDLE_COMPACT_NUDGE_PROMPT, IDLE_COMPACT_NOTICE_PREFIXES } from '../../shared/api.js';
import { isIdleCompaction, readCompactionTail } from '../src/idlenudge.js';

const transcript = (): string => path.join(home, 'cfg', 'projects', '-work', `${SID}.jsonl`);
const row = (o: object): string => JSON.stringify(o);
const ENDED = [
  { type: 'assistant', uuid: 'a1', message: { role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: 'done' }] } },
  { type: 'system', subtype: 'stop_hook_summary' },
];
const boundary = (trigger = 'auto', uuid = 'b1'): object =>
  ({ type: 'system', subtype: 'compact_boundary', uuid, timestamp: new Date(NOW - 60_000).toISOString(), compactMetadata: { trigger } });
const SUMMARY = { type: 'user', isCompactSummary: true, message: { role: 'user', content: 'the summary' } };
const NOTICE = { type: 'system', subtype: 'informational', content: `${IDLE_COMPACT_NOTICE_PREFIXES[0]} to save tokens` };
const ASSISTANT_AFTER = { type: 'assistant', uuid: 'a2', message: { role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] } };
const lines = (...rows: object[]): string => rows.map(row).join('\n') + '\n';
const IDLE = lines(...ENDED, boundary(), SUMMARY, NOTICE);
const writeTranscript = (text: string): void => {
  fs.mkdirSync(path.dirname(transcript()), { recursive: true });
  fs.writeFileSync(transcript(), text);
};

/** One UserPromptSubmit through the real hook; answers the additionalContext it printed, or '' for silence. */
const wake = (prompt: string, over: Record<string, unknown> = {}): string => {
  const r = spawnSync('bash', [HOOK], {
    input: JSON.stringify({ session_id: SID, transcript_path: transcript(), cwd: path.join(home, 'work'),
      hook_event_name: 'UserPromptSubmit', prompt, ...over }), encoding: 'utf8',
    env: {
      ...process.env, HOME: home, PATH: `${path.join(home, 'bin')}:${process.env['PATH'] ?? ''}`,
      TMUX_PANE: '%1', CLAUDE_CODE_SESSION_ID: SID, CLAUDE_PID: '4242', CCRC_SESSION_GENERATION: GENERATION,
    },
  });
  expect(r.status, 'the hook contract: exit 0 on every path').toBe(0);
  const out = r.stdout.split('\n').filter((l) => l.length > 0);
  expect(out.length, 'at most one envelope per event').toBeLessThanOrEqual(1);
  if (out.length === 0) return '';
  const env = JSON.parse(out[0]!) as { hookSpecificOutput: { hookEventName: string; additionalContext: string } };
  expect(env.hookSpecificOutput.hookEventName, 'the envelope names its own event').toBe('UserPromptSubmit');
  return env.hookSpecificOutput.additionalContext;
};
const MAIL = (): string => renderMailNudge(ID);

describe('R-5a: the wake arm, armed', () => {
  beforeEach(() => { arm(); writeTranscript(IDLE); });

  it('the mail nudge after an idle compaction carries the same card a compaction would, byte for byte', () => {
    fakeApi(list(run_('', { id: 41 }), run_('', { id: 42, state: 'awaiting-review' })));
    const card = wake(MAIL());
    expect(card).toMatch(/^ccrc-roster: 2 open run\(s\) you claim/);
    expect(card).toBe(rosterOf(hook('compact')));
  });

  it('so does the server\'s idle-compaction nudge', () => {
    fakeApi(list(run_('', { id: 43 })));
    expect(wake(IDLE_COMPACT_NUDGE_PROMPT)).toMatch(/#43 prog-a w1\/3 working/);
  });

  it('the prompt is still written as a turn: the hookstate reads working', () => {
    fakeApi(list(run_('', { id: 44 })));
    expect(wake(MAIL())).toContain('#44 ');
    const hs = JSON.parse(fs.readFileSync(path.join(reg(), `${ID}.hookstate.json`), 'utf8')) as { state?: string };
    expect(hs.state).toBe('working');
  });

  it('says nothing once a turn has run since the compaction: the card went out on the first wake', () => {
    writeTranscript(IDLE + lines(ASSISTANT_AFTER));
    fakeApi(list(run_('', { id: 45 })));
    expect(wake(MAIL())).toBe('');
  });

  it('says nothing after a compaction that was not an idle one: SessionStart already carried the card', () => {
    writeTranscript(lines(...ENDED, boundary('manual'), SUMMARY));
    fakeApi(list(run_('', { id: 46 })));
    expect(wake(MAIL())).toBe('');
  });

  it('reads only the newest compaction: an idle one behind a newer ordinary one says nothing', () => {
    writeTranscript(IDLE + lines(ASSISTANT_AFTER, boundary('manual', 'b2'), SUMMARY));
    fakeApi(list(run_('', { id: 47 })));
    expect(wake(MAIL())).toBe('');
  });

  it('says nothing for any other prompt, the operator\'s included', () => {
    fakeApi(list(run_('', { id: 48 })));
    expect(wake('please carry on')).toBe('');
    expect(wake(`note: ${MAIL()}`)).toBe('');
  });

  it('says nothing with no transcript to read', () => {
    fs.rmSync(transcript());
    fakeApi(list(run_('', { id: 49 })));
    expect(wake(MAIL())).toBe('');
  });

  it('says nothing for a dispatched child, a subagent or a kill-switched session', () => {
    fakeApi(list(run_('', { id: 50 })));
    expect(wake(MAIL(), { agent_id: 'agent-a' })).toBe('');
    fs.mkdirSync(path.join(home, '.ccrc'), { recursive: true });
    fs.writeFileSync(path.join(home, '.ccrc', 'ccrc-card-off'), '');
    expect(wake(MAIL())).toBe('');
    fs.rmSync(path.join(home, '.ccrc', 'ccrc-card-off'));
    fs.writeFileSync(path.join(reg(), `${ID}.child`), 'run-a\n');
    expect(wake(MAIL())).toBe('');
  });

  it('fails open on a server that does not answer: no context, the turn untouched', () => {
    fakeApi('', 3);
    expect(wake(MAIL())).toBe('');
  });

  it('says nothing when the session claims no open run', () => {
    fakeApi(list(run_('', { claimedBy: 'project-z-other' })));
    expect(wake(MAIL())).toBe('');
  });
});

describe('R-5a: the wake arm, unarmed', () => {
  it('injects nothing and appends the would-be card to the same shadow log, naming the wake', () => {
    writeTranscript(IDLE);
    fakeApi(list(run_('', { id: 51 })));
    expect(wake(MAIL())).toBe('');
    const log = fs.readFileSync(shadow(), 'utf8');
    expect(log).toMatch(new RegExp(`^\\d+ ${ID} wake$`, 'm'));
    expect(log).toMatch(/#51 prog-a w1\/3 working/);
  });
});

describe('R-5a: the wake reader agrees with the server\'s', () => {
  // `idle_compaction_open` in ccd/lib/transcript.jq is the box's spelling of `isIdleCompaction(t) && !t.turnAfter`
  // over `readCompactionTail` (server/src/idlenudge.ts, D-5373): another process on another host, so two spellings,
  // held equal here over one table.
  const TOOL_RESULT = { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'x' }] } };
  const OPERATOR = { type: 'user', message: { role: 'user', content: 'hello' } };
  const SIDE = { ...ASSISTANT_AFTER, isSidechain: true };
  const QUEUED = { type: 'attachment', attachment: { type: 'queued_command', prompt: 'x' } };
  const TABLE: [string, string][] = [
    ['an idle compaction, nothing after', IDLE],
    ['the notice alone (no finished turn before)', lines(boundary('manual'), SUMMARY, NOTICE)],
    ['an auto compaction after a finished turn, no notice', lines(...ENDED, boundary('auto'), SUMMARY)],
    ['an auto compaction mid-turn', lines(ENDED[0]!, boundary('auto'), SUMMARY)],
    ['a manual compaction', lines(...ENDED, boundary('manual'), SUMMARY)],
    ['an assistant row after', IDLE + lines(ASSISTANT_AFTER)],
    ['a tool result after', IDLE + lines(TOOL_RESULT)],
    ['only the wake prompt after', IDLE + lines(OPERATOR)],
    ['a queued command after', IDLE + lines(QUEUED)],
    ['a sidechain assistant after', IDLE + lines(SIDE)],
    ['a newer manual compaction', IDLE + lines(ASSISTANT_AFTER, boundary('manual', 'b2'), SUMMARY)],
    ['a newer idle compaction', lines(...ENDED, boundary('manual', 'b0'), SUMMARY, ASSISTANT_AFTER) + IDLE],
    ['a boundary with no key', lines(...ENDED, { type: 'system', subtype: 'compact_boundary' }, SUMMARY, NOTICE)],
    ['no compaction at all', lines(...ENDED)],
    ['a cut first line and junk', '{"type":"assis\nnot json\n' + IDLE],
    ['the notice with leading whitespace', lines(...ENDED, boundary('manual'), SUMMARY, { ...NOTICE, content: `  ${NOTICE.content}` })],
    ['empty', ''],
  ];
  const LIB = path.resolve(__dirname, '../../ccd/lib');
  it.each(TABLE)('%s', (_n, tail) => {
    const t = readCompactionTail(tail);
    const want = isIdleCompaction(t) && t.kind === 'compaction' && !t.turnAfter;
    const r = spawnSync('jq', ['-L', LIB, '-rRs', 'include "transcript"; idle_compaction_open'], { input: tail, encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe(String(want));
  });
  it('the table holds both answers', () => {
    const answers = TABLE.map(([, tail]) => { const t = readCompactionTail(tail); return isIdleCompaction(t) && t.kind === 'compaction' && !t.turnAfter; });
    expect(answers).toContain(true);
    expect(answers).toContain(false);
  });
  it('the notice prefixes are the server\'s list', () => {
    const src = fs.readFileSync(path.join(LIB, 'transcript.jq'), 'utf8');
    const m = src.match(/^def idle_notice_prefixes: (\[.*\]);$/m);
    expect(m, 'the jq list is spelled on one line').not.toBeNull();
    expect(JSON.parse(m![1]!)).toEqual([...IDLE_COMPACT_NOTICE_PREFIXES]);
  });
});

describe('R-5a: the hook knows the server\'s two wake prompts', () => {
  // The hook recognises the wake by the text the server types. A reworded nudge must fail here, not silently stop the
  // card: the hook's two spellings are held to `renderMailNudge`'s fixed head and to IDLE_COMPACT_NUDGE_PROMPT.
  const src = fs.readFileSync(HOOK, 'utf8');
  it('the mail nudge head', () => {
    const m = src.match(/^ROSTER_WAKE_MAIL='([^']*)'$/m);
    expect(m).not.toBeNull();
    expect(renderMailNudge('x').startsWith(m![1]!)).toBe(true);
    expect(m![1]!.length).toBeGreaterThanOrEqual(24);
  });
  it('the idle-compaction nudge', () => {
    const m = src.match(/^ROSTER_WAKE_IDLE="([^"]*)"$/m);
    expect(m).not.toBeNull();
    expect(m![1]).toBe(IDLE_COMPACT_NUDGE_PROMPT);
  });
});

describe('the builder ships', () => {
  const REPO = path.resolve(__dirname, '../..');
  const read = (rel: string): string => fs.readFileSync(path.join(REPO, rel), 'utf8');
  const DEST = '.cc-sessions/lib/roster-card.jq';
  it('deploy.sh installs it at 644 before the hook that loads it, and backs it up', () => {
    const code = read('deploy/deploy.sh').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
    const at = code.indexOf(`install_atomic ccd/lib/roster-card.jq ${DEST} 644`);
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(code.indexOf('install_atomic ccd/session-hook.sh .cc-sessions/session-hook.sh 755'));
    expect(read('deploy/deploy.sh')).toContain('~/.cc-sessions/lib/roster-card.jq ~/ccrc-backups/$TS/roster-card.jq');
  });
  it('ccrc install places it before the hook, ccrc update backs it up, ccrc uninstall removes it', () => {
    const src = read('ccd/ccrc');
    const inst = src.indexOf(`_inst_atomic "$tree/ccd/lib/roster-card.jq" "$HOME/${DEST}" 644`);
    expect(inst).toBeGreaterThan(-1);
    expect(inst).toBeLessThan(src.indexOf('_inst_atomic "$tree/ccd/session-hook.sh"'));
    expect(src).toContain(`_upd_backup_copy "$HOME/${DEST}" roster-card.jq`);
    expect(src).toContain('"$reg/lib/roster-card.jq"');
  });
  it('an installed hook, alone in its directory, reads the builder under $HOME/.cc-sessions/lib', () => {
    arm();
    const bin = path.join(home, '.cc-sessions-copy');
    fs.mkdirSync(bin, { recursive: true });
    fs.copyFileSync(HOOK, path.join(bin, 'session-hook.sh'));
    fs.mkdirSync(path.join(home, '.cc-sessions', 'lib'), { recursive: true });
    fs.copyFileSync(path.join(REPO, 'ccd', 'lib', 'roster-card.jq'), path.join(home, DEST));
    fakeApi(list(run_('', { id: 61 })));
    const r = spawnSync('bash', [path.join(bin, 'session-hook.sh')], {
      input: JSON.stringify(payload('compact')), encoding: 'utf8',
      env: { ...process.env, HOME: home, PATH: `${path.join(home, 'bin')}:${process.env['PATH'] ?? ''}`,
        TMUX_PANE: '%1', CLAUDE_CODE_SESSION_ID: SID, CLAUDE_PID: '4242', CCRC_SESSION_GENERATION: GENERATION },
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/#61 prog-a w1\/3 working/);
    // A box the builder never reached: no card, the other cards untouched (fail open).
    fs.rmSync(path.join(home, DEST));
    const r2 = spawnSync('bash', [path.join(bin, 'session-hook.sh')], {
      input: JSON.stringify(payload('compact')), encoding: 'utf8',
      env: { ...process.env, HOME: home, PATH: `${path.join(home, 'bin')}:${process.env['PATH'] ?? ''}`,
        TMUX_PANE: '%1', CLAUDE_CODE_SESSION_ID: SID, CLAUDE_PID: '4242', CCRC_SESSION_GENERATION: GENERATION },
    });
    expect(r2.status).toBe(0);
    expect(r2.stdout).not.toContain('ccrc-roster');
    expect(r2.stdout).toContain('You are still this project\'s coordinator');
  });
});
