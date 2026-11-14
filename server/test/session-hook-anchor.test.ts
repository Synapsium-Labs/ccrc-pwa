// The anchor's slot in the session hook (Overlord W1a, the anchor piece, plan `w1a-anchor.md` Tasks 2 and 3; spec §3.3.3
// C38, the W0 results' Proposal 2). The hook asks the card door for the anchor (`ccrc-api card --anchor --form <f>`) and
// prints what came back in the emitter's FIRST slot; the door answers `dark` until the Shadow lanes row `anchor-slot` is
// live, and a `dark` answer or a failed read prints exactly what the hook printed before this piece.
//
// Runs ccd/session-hook.sh for real inside a fixture HOME with a stub `ccrc-api` (the harness shape of
// session-hook-role-card.test.ts and session-hook-precompact.test.ts, copied: a test file cannot import another). No live
// box, no live server, never the live HOME.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSyncGroup } from './spawnGroup.js';
import { mkTmp } from './tmpHelpers.js';

const HOOK = path.resolve(__dirname, '../../ccd/session-hook.sh');
const ID = 'lane-a-project-a';
const UUID = '00000000-0000-4000-8000-000000000001';
const GENERATION = '0189abcd-1234-5678-9abc-0123456789ab';

/** The role card's two texts (D-8142), verbatim, as `session-hook-role-card.test.ts` holds them. */
const FRESH = 'ccrc-role: You are this project\'s coordinator from your first turn. Load the `ccrc-coordinator` skill now, before anything else, and act as it says. When your work belongs to a programme, read its goals and definition of done in its ledger (`docs/superpowers/programs/<slug>.md`) before you plan or ask. Your children\'s questions and permission prompts come to you first; your own go to the operator.';
const REVIVED = 'ccrc-role: You are still this project\'s coordinator. If the `ccrc-coordinator` skill is not loaded in this context, load it now. Your children\'s questions and permission prompts come to you first; your own go to the operator.';
/** THE CHARACTERIZATION (Task 2 Step 1): what each SessionStart source printed for a coordinator fixture at the branch
 *  point (main at 2d503a4de), measured with the stub failing, before the anchor's edit: the role card alone. */
const BEFORE: Readonly<Record<string, string>> = {
  startup: FRESH, clear: FRESH, resume: REVIVED, compact: REVIVED, fork: REVIVED,
};
const envelope = (event: string, c: string): string =>
  `${JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: c } })}\n`;
const FORK_LINE = 'ccrc-anchor: a forked copy is not this session; it has no card.';
const ANCHOR = 'ccrc-anchor: role: coordinator of prog-a\nterm 2 · generation 5 · card 0123456789ab\ncounts: 1 runs · 0 open items and asks · 0 outstanding mail · 0 notes\n'
  + "Your card is the server's record of what stands. Read it now with `ccrc-api card`, before anything else.";
const PROMPT_ANCHOR = 'ccrc-anchor: term 2 · generation 6 starting · card 0123456789ab\n'
  + "Your card is the server's record of what stands. Read it now with `ccrc-api card`, before anything else.";
const DARK = '{"ok":true,"dark":true}';
const LIVE = '{"ok":true,"live":true}';
const text = (t: string): string => JSON.stringify({ ok: true, hash: '0123456789ab'.padEnd(64, '0'), text: t });

let home: string;
const reg = (...p: string[]): string => path.join(home, '.cc-sessions', ...p);
const owed = (): string => reg(`${ID}.anchor-owed`);
const calls = (): string[] => {
  const f = path.join(home, 'anchor-calls');
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter((l) => l !== '') : [];
};
/** The stub's answer for one form: a body it prints (exit 0), or null for no answer at all (exit 3, the client's
 *  no-response code). */
const answer = (form: 'start' | 'prompt' | 'fork', body: string | null): void => {
  const f = path.join(home, `stub-${form}`);
  if (body === null) fs.rmSync(f, { force: true }); else fs.writeFileSync(f, body);
};

beforeEach(() => {
  home = mkTmp('ccrc-hook-anchor-');
  fs.mkdirSync(reg(), { recursive: true });
  fs.writeFileSync(reg(`${ID}.generation`), GENERATION);
  fs.mkdirSync(path.join(home, 'bin'), { recursive: true });
  fs.mkdirSync(path.join(home, '.local', 'bin'), { recursive: true });
  fs.mkdirSync(path.join(home, 'work'), { recursive: true });
  fs.writeFileSync(path.join(home, 'bin', 'tmux'), `#!/bin/sh\necho "cc-${ID}"\n`, { mode: 0o755 });
  // The stub client: only `card` answers; it records each call's argv and the hookstate as it stood at the call, then
  // sleeps if asked to, then prints the body this test set for the form, or answers nothing.
  fs.writeFileSync(path.join(home, '.local', 'bin', 'ccrc-api'), [
    '#!/bin/sh',
    '[ "$1" = card ] || exit 3',
    'printf "%s\\n" "$*" >> "$HOME/anchor-calls"',
    `cat "$HOME/.cc-sessions/${ID}.hookstate.json" > "$HOME/hookstate-at-fetch" 2>/dev/null || echo absent > "$HOME/hookstate-at-fetch"`,
    '[ -f "$HOME/stub-sleep" ] && sleep "$(cat "$HOME/stub-sleep")"',
    '[ -f "$HOME/stub-$4" ] || exit 3',
    'cat "$HOME/stub-$4"',
  ].join('\n') + '\n', { mode: 0o755 });
});
afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

const transcript = (agents = 0): string => {
  const proj = path.join(home, '.claude', 'projects', '-rig-repo');
  fs.mkdirSync(proj, { recursive: true });
  const t = path.join(proj, `${UUID}.jsonl`);
  fs.writeFileSync(t, '{"type":"user"}\n');
  const old = Math.floor(Date.now() / 1000) - 600;
  fs.utimesSync(t, old, old);
  if (agents > 0) {
    const dir = path.join(proj, UUID, 'subagents');
    fs.mkdirSync(dir, { recursive: true });
    for (let i = 0; i < agents; i += 1) fs.writeFileSync(path.join(dir, `agent-a${i}.jsonl`), '{"type":"user"}\n');
  }
  return t;
};
const start = (source: string): object => ({
  session_id: UUID, transcript_path: path.join(home, 'cfg', `${UUID}.jsonl`), cwd: path.join(home, 'work'),
  hook_event_name: 'SessionStart', source, model: 'claude-model-a', ...(source === 'compact' ? { prompt_id: 'p1' } : {}),
});
const preCompact = (trigger: string, transcriptPath: string): object => ({
  session_id: UUID, transcript_path: transcriptPath, cwd: path.join(home, 'work'), hook_event_name: 'PreCompact', trigger, custom_instructions: null,
});
const prompt = (): object => ({
  session_id: UUID, transcript_path: path.join(home, 'cfg', `${UUID}.jsonl`), cwd: path.join(home, 'work'),
  hook_event_name: 'UserPromptSubmit', prompt: 'carry on',
});
/** The hook's stdout, its exit 0 asserted. Bounded: a timed shell spawn goes through spawnSyncGroup (#896). */
const run = (payload: object): string => {
  const r = spawnSyncGroup('bash', [HOOK], {
    input: JSON.stringify(payload), encoding: 'utf8', timeout: 20_000,
    env: {
      ...process.env, HOME: home, PATH: `${path.join(home, 'bin')}:${process.env['PATH'] ?? ''}`,
      TMUX_PANE: '%1', CLAUDE_CODE_SESSION_ID: UUID, CLAUDE_PID: '4242', CCRC_SESSION_GENERATION: GENERATION,
    },
  });
  expect(r.error, 'the spawn itself did not fail').toBeUndefined();
  expect(r.status, 'the hook contract: exit 0 on every path').toBe(0);
  return String(r.stdout);
};
const context = (stdout: string, event = 'SessionStart'): string => {
  const lines = stdout.split('\n').filter((l) => l.length > 0);
  expect(lines.length, 'at most one envelope per event').toBeLessThanOrEqual(1);
  if (lines.length === 0) return '';
  const env = JSON.parse(lines[0]!) as { hookSpecificOutput: { hookEventName: string; additionalContext: string } };
  expect(env.hookSpecificOutput.hookEventName).toBe(event);
  return env.hookSpecificOutput.additionalContext;
};

describe('the anchor\'s slot at a start (Task 2)', () => {
  it('CHARACTERIZATION: with the read failing, every source prints exactly what it printed before the anchor', () => {
    for (const [source, card] of Object.entries(BEFORE)) expect(run(start(source)), source).toBe(envelope('SessionStart', card));
    expect(calls()).toEqual(['card --anchor --form start', 'card --anchor --form start', 'card --anchor --form start',
      'card --anchor --form start', 'card --anchor --form fork']);
  });

  it('with no client at all, every source prints exactly the characterized card', () => {
    fs.rmSync(path.join(home, '.local', 'bin', 'ccrc-api'));
    for (const [source, card] of Object.entries(BEFORE)) expect(run(start(source)), source).toBe(envelope('SessionStart', card));
  });

  it('DARK: the door answering dark, every source prints exactly the characterized card (the merge arms nothing)', () => {
    for (const f of ['start', 'fork'] as const) answer(f, DARK);
    for (const [source, card] of Object.entries(BEFORE)) expect(run(start(source)), source).toBe(envelope('SessionStart', card));
  });

  it('an answer the hook cannot read (a refusal, a body with no text) prints exactly the characterized card', () => {
    for (const body of ['{"ok":false,"error":"stale-uuid"}', '{"ok":true}', '{"ok":true,"text":""}', 'not json']) {
      answer('start', body);
      expect(run(start('clear')), body).toBe(envelope('SessionStart', FRESH));
    }
  });

  it('LIVE: the anchor prints first, and the role card stands down for it, on startup, resume, clear and compact', () => {
    answer('start', text(ANCHOR));
    for (const source of ['startup', 'resume', 'clear', 'compact']) {
      const c = context(run(start(source)));
      expect(c, source).toBe(ANCHOR);
      expect(c, source).not.toContain('ccrc-role:');
    }
  });

  it('the anchor comes BEFORE every other subject: a held coordinator\'s hold line follows it', () => {
    fs.writeFileSync(reg(`${ID}.hold`), 'program:prog-a wave:1/2 run:11\n');
    answer('start', DARK);
    const without = context(run(start('clear')));
    expect(without.length, 'the hold card prints on its own').toBeGreaterThan(0);
    answer('start', text(ANCHOR));
    expect(context(run(start('clear')))).toBe(`${ANCHOR} ${without}`);
  });

  it('a fork prints its one refusal line only when the door answers live, and no role card', () => {
    answer('fork', LIVE);
    expect(context(run(start('fork')))).toBe(FORK_LINE);
    expect(calls()).toEqual(['card --anchor --form fork']);
  });

  it('a fork whose door answers dark, or nothing, prints exactly the characterized short role card (ruling R6)', () => {
    answer('fork', DARK);
    expect(run(start('fork'))).toBe(envelope('SessionStart', REVIVED));
    answer('fork', null);
    expect(run(start('fork'))).toBe(envelope('SessionStart', REVIVED));
    // A fork never takes a start's text: only `live` sets its line.
    answer('fork', text(ANCHOR));
    expect(run(start('fork'))).toBe(envelope('SessionStart', REVIVED));
  });

  it('a child prints neither the anchor nor the role card, and makes no read', () => {
    fs.writeFileSync(reg(`${ID}.child`), '11\n');
    answer('start', text(ANCHOR));
    answer('fork', LIVE);
    for (const source of Object.keys(BEFORE)) expect(context(run(start(source))), source).toBe('');
    expect(calls()).toEqual([]);
  });

  it('an answer of 2,000 characters is clipped to ANCHOR_CARD_MAX_CHARS, its first lines (the canaries) intact', () => {
    const long = `ccrc-anchor: role: coordinator\nterm 2 generation 5 card 0123456789ab\n${'x'.repeat(2000)}`;
    answer('start', text(long));
    const c = context(run(start('startup')));
    expect(c).toBe(long.slice(0, 1500));
    expect(c.split('\n').slice(0, 2)).toEqual(['ccrc-anchor: role: coordinator', 'term 2 generation 5 card 0123456789ab']);
  });
});

describe('the anchor owed after an automatic compaction (Task 3)', () => {
  it('PreCompact auto (main), then a prompt: the prompt carries the anchor once, and the mark is gone', () => {
    run(preCompact('auto', transcript()));
    expect(fs.readFileSync(owed(), 'utf8')).toBe('0\n');
    answer('prompt', text(PROMPT_ANCHOR));
    expect(context(run(prompt()), 'UserPromptSubmit')).toBe(PROMPT_ANCHOR);
    expect(fs.existsSync(owed())).toBe(false);
    expect(run(prompt()), 'the next prompt').toBe('');
    expect(calls()).toEqual(['card --anchor --form prompt']);
  });

  it('PreCompact auto, then SessionStart compact: the start carries the anchor, and the next prompt carries nothing', () => {
    run(preCompact('auto', transcript()));
    answer('start', text(ANCHOR));
    answer('prompt', text(PROMPT_ANCHOR));
    expect(context(run(start('compact')))).toBe(ANCHOR);
    expect(fs.existsSync(owed())).toBe(false);
    expect(run(prompt())).toBe('');
    expect(calls()).toEqual(['card --anchor --form start']);
  });

  it('a manual PreCompact sets no mark (a manual compaction fires SessionStart compact, W0-05)', () => {
    run(preCompact('manual', transcript()));
    expect(fs.existsSync(owed())).toBe(false);
  });

  it('an automatic PreCompact whose scope is subagent, ambiguous or unread sets no mark', () => {
    run(preCompact('auto', transcript(1)));
    expect(fs.existsSync(owed()), 'subagent').toBe(false);
    fs.rmSync(path.join(home, '.claude'), { recursive: true, force: true });
    run(preCompact('auto', transcript(2)));
    expect(fs.existsSync(owed()), 'ambiguous').toBe(false);
    run(preCompact('auto', '/rig/absent/transcript.jsonl'));
    expect(fs.existsSync(owed()), 'unread').toBe(false);
    answer('prompt', text(PROMPT_ANCHOR));
    expect(run(prompt())).toBe('');
    expect(calls()).toEqual([]);
  });

  it('a refused PreCompact sets no mark, and the next prompt carries nothing', () => {
    fs.writeFileSync(reg(`${ID}.precompact`), 'refuse\n');
    fs.writeFileSync(reg(`${ID}.turn.json`), `${JSON.stringify({ v: 1, sessionId: UUID, state: 'working', event: 'UserPromptSubmit', at: Date.now() - 60_000, turnAt: Date.now() - 60_000, stopAt: null, bg: -1, bgKinds: '', bgIds: '', err: null, restartAt: null, lostBg: 0, lostKinds: '', lostIds: '', crons: -1 })}\n`);
    const out = run(preCompact('auto', transcript()));
    expect(out, 'the refusal was printed').toContain('"decision":"block"');
    expect(fs.readFileSync(reg(`${ID}.compactevents`), 'utf8')).toContain('"phase":"refused"');
    expect(fs.existsSync(owed())).toBe(false);
    answer('prompt', text(PROMPT_ANCHOR));
    expect(run(prompt())).toBe('');
  });

  it('the prompt\'s hookstate is written before the read: a stub that sleeps three seconds finds it already working', () => {
    run(preCompact('auto', transcript()));
    fs.rmSync(reg(`${ID}.hookstate.json`), { force: true });
    fs.writeFileSync(path.join(home, 'stub-sleep'), '3');
    answer('prompt', text(PROMPT_ANCHOR));
    expect(context(run(prompt()), 'UserPromptSubmit')).toBe(PROMPT_ANCHOR);
    expect(JSON.parse(fs.readFileSync(path.join(home, 'hookstate-at-fetch'), 'utf8')) as Record<string, unknown>)
      .toMatchObject({ state: 'working' });
  }, 30_000);

  it('a dark answer clears the mark and prints nothing', () => {
    run(preCompact('auto', transcript()));
    answer('prompt', DARK);
    expect(run(prompt())).toBe('');
    expect(fs.existsSync(owed())).toBe(false);
    expect(run(prompt())).toBe('');
    expect(calls()).toEqual(['card --anchor --form prompt']);
  });

  it('no answer keeps the mark for the next prompt, at most three tries (the count in the mark)', () => {
    run(preCompact('auto', transcript()));
    expect(run(prompt())).toBe('');
    expect(fs.readFileSync(owed(), 'utf8')).toBe('1\n');
    expect(run(prompt())).toBe('');
    expect(fs.readFileSync(owed(), 'utf8')).toBe('2\n');
    expect(run(prompt())).toBe('');
    expect(fs.existsSync(owed()), 'the third try spends the mark').toBe(false);
    expect(run(prompt())).toBe('');
    expect(calls()).toEqual(['card --anchor --form prompt', 'card --anchor --form prompt', 'card --anchor --form prompt']);
  });

  it('a child\'s automatic compaction marks, but its prompt makes no read and the mark is spent', () => {
    fs.writeFileSync(reg(`${ID}.child`), '11\n');
    run(preCompact('auto', transcript()));
    answer('prompt', text(PROMPT_ANCHOR));
    for (let i = 0; i < 3; i += 1) expect(run(prompt())).toBe('');
    expect(calls()).toEqual([]);
    expect(fs.existsSync(owed())).toBe(false);
  });
});
