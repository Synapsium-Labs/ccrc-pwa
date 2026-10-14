import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { makeCcdHarness, CCD, type CcdHarness, WIDE_PANE, BOUNDED, ghContainedEnv } from './ccdWsHelpers.js';
import { RATE_LIMIT_ERROR } from '../../shared/api.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-limit-banner-'); });
afterEach(() => { h.cleanup(); });

const ID = 'myid';
const UUID = 'deadbeef-0000-4000-8000-000000000000';
const seed = (): void => {
  h.sh(`_reg_set ${ID} wrapper claude
        _reg_set ${ID} home claude
        _reg_set ${ID} project demo
        _reg_set ${ID} workdir "$HOME/projects/demo"
        _reg_set ${ID} uuid ${UUID}
        _reg_set ${ID} started 1`);
  fs.mkdirSync(path.join(h.home, 'projects', 'demo'), { recursive: true });
};
/** Compact JSONL, the shape Claude Code writes. `banner` is the real row from
 *  expoAI-assistant-swift-meadow at 2026-09-10T10:12:21Z, field for field. */
const L = {
  banner: (over: Record<string, unknown> = {}) => JSON.stringify({
    parentUuid: 'p', isSidechain: false, type: 'assistant', uuid: 'b1', timestamp: '2026-09-10T10:12:21.199Z',
    message: { model: '<synthetic>', role: 'assistant', content: [{ type: 'text', text: "You've hit your weekly limit · resets Sep 15, 12am (UTC)" }] },
    isApiErrorMessage: true, error: 'rate_limit', apiErrorStatus: 429,
    quotaLimits: { status: 'rejected', resetsAt: 1789430400, rateLimitType: 'seven_day', overageStatus: 'rejected' },
    ...over,
  }),
  metaPrompt: () => JSON.stringify({ type: 'user', isMeta: true, uuid: 'm1', timestamp: 't', message: { role: 'user', content: [{ type: 'text', text: 'Continue from where you left off. Note: ccd restarted this session.' }] } }),
  assistant: (text = 'Working on it.') => JSON.stringify({ type: 'assistant', uuid: 'a1', timestamp: 't', message: { model: 'claude-opus-5', role: 'assistant', content: [{ type: 'text', text }] } }),
  assistantWithNestedLimit: () => JSON.stringify({
    type: 'assistant', uuid: 'a2', timestamp: 't',
    message: {
      model: 'claude-opus-5', role: 'assistant',
      content: [{ type: 'tool_use', id: 'tool-1', name: 'inspect', input: { isApiErrorMessage: true, error: 'rate_limit' } }],
    },
  }),
  human: (text = 'resume') => JSON.stringify({ type: 'user', uuid: 'u1', timestamp: 't', message: { role: 'user', content: text } }),
  caveat: () => JSON.stringify({ type: 'user', isMeta: true, uuid: 'c1', timestamp: 't', message: { role: 'user', content: '<local-command-caveat>Caveat: ...</local-command-caveat>' } }),
  command: () => JSON.stringify({ type: 'user', uuid: 'c2', timestamp: 't', message: { role: 'user', content: '<command-name>/effort</command-name><command-args>ultracode</command-args>' } }),
  stdout: () => JSON.stringify({ type: 'user', uuid: 'c3', timestamp: 't', message: { role: 'user', content: '<local-command-stdout>Set effort level to ultracode</local-command-stdout>' } }),
  system: () => JSON.stringify({ type: 'system', uuid: 's1', timestamp: 't', content: 'Remote Control disconnected' }),
  /** Claude Code 2.1.280's own API-error rows for the two other ways an account
   *  leaves a session stuck, field for field as a private rig wrote them
   *  (mock API, 2026-09-23 and 2026-09-26): a 401, and a 400 on exhausted credit.
   *  The 529 is the control — transient, and not the account's. */
  apiError: (error: string, status: number, text: string) => JSON.stringify({
    parentUuid: 'p', isSidechain: false, type: 'assistant', uuid: 'e1', timestamp: '2026-09-26T10:50:02.000Z',
    message: { model: '<synthetic>', role: 'assistant', content: [{ type: 'text', text }] },
    isApiErrorMessage: true, error, apiErrorStatus: status,
  }),
};
const AUTH = () => L.apiError('authentication_failed', 401, 'Invalid API key · Fix external API key');
/** The row's own clock, as epoch seconds: a `since` above it means the row was
 *  written by an EARLIER process than the pane's current one. */
const ROW_AT = Math.floor(Date.parse('2026-09-26T10:50:02.000Z') / 1000);
/** The `banner` row's own clock, as epoch seconds (D-3526). */
const BANNER_AT = Math.floor(Date.parse('2026-09-10T10:12:21.199Z') / 1000);
const iso = (epoch: number): string => new Date(epoch * 1000).toISOString();
const OAUTH = () => L.apiError('authentication_failed', 401, 'Please run /login · API Error: 401 OAuth token has expired. Please obtain a new token or refresh your existing token.');
const BILLING = () => L.apiError('billing_error', 400, 'Credit balance is too low');
const OVERLOADED = () => L.apiError('server_error', 529, 'API Error: Repeated 529 Overloaded errors. The API is at capacity — this is not a problem with your account.');
const writeTranscript = (lines: string[]): string => {
  const p = h.sh(`_transcript_path ${ID}`);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, lines.join('\n') + '\n');
  return p;
};
/** rc and stdout of the detector, in one shell so `$?` is the function's own.
 *  Trailing `|` sentinel: `h.sh` trims the whole captured shell output, and
 *  when both fields are empty the detector's own output is a lone tab — with
 *  no sentinel that tab sits at the very end and `.trim()` silently eats it.
 *  A non-whitespace tail keeps `.trim()` off the boundary that matters. */
const detect = (p: string): { rc: string; out: string } => {
  const raw = h.sh(`out=$(_transcript_limit_banner ${JSON.stringify(p)}); rc=$?; printf '%s|%s|' "$rc" "$out"`);
  const i = raw.indexOf('|');
  return { rc: raw.slice(0, i), out: raw.slice(i + 1, -1) };
};
/** The same function under a cross-platform five-second alarm in a child bash
 *  that inherits only the function's text — the only way to prove a read does
 *  NOT block. `BOUNDED` (ccdWsHelpers.ts) kills the child's WHOLE process group
 *  on the alarm and exits 142 (session-continuity spec §5.6 item 3). */
const detectTimed = (fn: string, p: string): string =>
  h.sh(`${BOUNDED} 5 bash -c "$(declare -f ${fn}); REDRIVE_TAIL_LINES=$REDRIVE_TAIL_LINES; ${fn} \\"\\$1\\"" _ ${JSON.stringify(p)} >/dev/null 2>&1; echo "rc=$?"`);

describe('_transcript_limit_banner (D-2362)', () => {
  it('the newest real row is the banner: rc 0, prints resetsAt and rateLimitType', () => {
    seed(); const p = writeTranscript([L.human(), L.assistant(), L.banner()]);
    expect(detect(p)).toEqual({ rc: '0', out: '1789430400\tseven_day' });
  });
  it('local-command chatter after the banner is not a turn: still rc 0', () => {
    seed(); const p = writeTranscript([L.banner(), L.caveat(), L.command(), L.stdout(), L.system()]);
    expect(detect(p).rc).toBe('0');
  });
  it('a META resume prompt after the banner means the landing was re-driven: rc 1', () => {
    seed(); const p = writeTranscript([L.banner(), L.metaPrompt()]);
    expect(detect(p).rc).toBe('1');
  });
  it('a real assistant turn after the banner: rc 1', () => {
    seed(); const p = writeTranscript([L.banner(), L.assistant()]);
    expect(detect(p).rc).toBe('1');
  });
  it('a human message after the banner: rc 1', () => {
    seed(); const p = writeTranscript([L.banner(), L.human()]);
    expect(detect(p).rc).toBe('1');
  });
  it('an API error that is not a rate limit is not a limit: rc 1 — the field decides, not the shape', () => {
    seed(); const p = writeTranscript([L.banner({ error: 'overloaded', quotaLimits: undefined })]);
    expect(detect(p).rc).toBe('1');
  });
  it('an assistant row carrying the error field but not the API-error marker is not a limit: rc 1', () => {
    seed(); const p = writeTranscript([L.banner({ isApiErrorMessage: undefined })]);
    expect(detect(p).rc).toBe('1');
  });
  it("the banner's TEXT on an ordinary assistant row is not a limit: rc 1 — text is never the detector", () => {
    seed(); const p = writeTranscript([L.assistant("You've hit your weekly limit · resets Sep 15, 12am (UTC)")]);
    expect(detect(p).rc).toBe('1');
  });
  it('field-shaped keys nested in ordinary assistant content are not a top-level limit envelope (D-2456)', () => {
    seed(); const p = writeTranscript([L.assistantWithNestedLimit()]);
    expect(detect(p).rc).toBe('1');
  });
  it('an unparseable row after a banner fails closed instead of trusting older evidence (D-2456)', () => {
    seed(); const p = writeTranscript([L.banner(), '{"type":"assistant","message":']);
    expect(detect(p).rc).toBe('1');
  });
  it('a tag quoted by a real assistant is a turn, not local-command chatter (D-2456)', () => {
    seed(); const p = writeTranscript([L.banner(), L.assistant('The marker is <command-name>.')]);
    expect(detect(p).rc).toBe('1');
  });
  it('a banner without quotaLimits still detects, printing empty fields', () => {
    seed(); const p = writeTranscript([L.banner({ quotaLimits: undefined })]);
    expect(detect(p)).toEqual({ rc: '0', out: '\t' });
  });
  it('no transcript: rc 2', () => {
    seed(); expect(detect(path.join(h.home, 'nope.jsonl')).rc).toBe('2');
  });
  it('a directory at the path: rc 2 — `-f` is what refuses it (D-2370)', () => {
    seed(); const d = path.join(h.home, 'dir.jsonl'); fs.mkdirSync(d);
    expect(detect(d).rc).toBe('2');
  });
  it('a FIFO at the path: rc 2 without blocking — `-r` alone would open it and wait for ever (D-2370)', () => {
    seed(); const f = path.join(h.home, 'fifo.jsonl'); execFileSync('mkfifo', [f]);
    expect(detectTimed('_transcript_limit_banner', f)).toBe('rc=2');
  });
  it('the timed harness kills its child\'s WHOLE process group on timeout: a grandchild blocked on a FIFO does not outlive it', () => {
    // A stand-in for a detector whose FIFO guard is gone: it forks `tail`, which blocks opening the FIFO for ever.
    seed(); const f = path.join(h.home, `leak-${process.pid}.fifo`); execFileSync('mkfifo', [f]);
    const holders = (): string[] => execFileSync('ps', ['-eo', 'pid=,args='], { encoding: 'utf8' }).split('\n').filter((l) => l.includes(f) && !l.includes('ps -eo'));
    try {
      // Bounded from OUTSIDE too (10 s, no ccd sourced: the case needs none), so a harness that cannot kill
      // its group fails this case instead of hanging the file — and the `finally` below still runs.
      const r = spawnSync('bash', ['-c', `_leaky() { tail -n 1 -- "$1"; }; ${BOUNDED} 1 bash -c "$(declare -f _leaky); _leaky \\"\\$1\\"" _ ${JSON.stringify(f)} >/dev/null 2>&1; echo "rc=$?"`],
        { encoding: 'utf8', timeout: 10_000, killSignal: 'SIGKILL',
          env: ghContainedEnv(h.home, { PATH: process.env['PATH'] ?? '', HOME: h.home }, { systemd: true, tmux: true }) });
      expect(r.error, 'the bounded run did not return within 10 s: the group was not killed').toBeUndefined();
      expect(r.stdout.trim()).toBe('rc=142');
      expect(holders(), 'a process still holds the FIFO after the harness timed out').toEqual([]);
    } finally {
      // Release any leftover reader (a writer opening the FIFO ends its `tail`), then kill what is left.
      try { fs.closeSync(fs.openSync(f, fs.constants.O_WRONLY | fs.constants.O_NONBLOCK)); } catch { /* no reader: nothing to release */ }
      for (const l of holders()) { try { process.kill(Number(l.trim().split(/\s+/)[0]), 'SIGKILL'); } catch { /* gone */ } }
    }
  });
  it("the detector's error literal is shared's RATE_LIMIT_ERROR — one bash copy, one TS copy, pinned", () => {
    const src = fs.readFileSync(CCD, 'utf8');
    const line = src.split('\n').find((l) => l.includes('row.get("error") =='));
    if (!line) throw new Error('_transcript_limit_banner detector line not found in ccd/ccd');
    const m = /row\.get\("error"\) == "([a-z_]+)"/.exec(line);
    if (!m) throw new Error('no parsed error literal on the detector line');
    expect(m[1]).toBe(RATE_LIMIT_ERROR);
  });
});

// D-3522: the operator's widening. On 2.1.280 every final banner sits four
// rows above the prompt box, outside the rescue's pane window, so auth loss
// and exhausted credit were rescued by NOTHING — the old pane alternation
// names the auth phrases, but only where the banner never renders. The
// transcript already records the kind as an envelope field; `stuck` mode reads
// those two kinds beside `rate_limit`. The default mode is unchanged.
describe('_transcript_limit_banner stuck mode: auth loss written by this process (D-3522)', () => {
  const stuck = (p: string, since: string | number = ROW_AT): string =>
    h.sh(`_transcript_limit_banner ${JSON.stringify(p)} stuck ${JSON.stringify(String(since))} >/dev/null; echo $?`);
  it.each([['an invalid API key', AUTH], ['an expired OAuth login', OAUTH]])(
    'reads %s as stuck', (_what, row) => {
      seed(); const p = writeTranscript([L.human(), row()]);
      expect(stuck(p)).toBe('0');
    });
  it('a rate limit is stuck unless it provably predates the pane (D-3526)', () => {
    // Was "still reads a rate limit as stuck, with or without a since", written
    // when only the 401 was dated. Its intent survives in the first two rows:
    // no since, or a since at or before the row, and the limit counts. The
    // third row is the rule this pin now carries: a row written before this
    // pane's process is a carried-in banner, rc 3 — not the rc 0 of a block.
    seed(); const p = writeTranscript([L.banner()]);
    expect(stuck(p, '')).toBe('0');
    expect(stuck(p, BANNER_AT)).toBe('0');
    expect(stuck(p, BANNER_AT + 1)).toBe('3');
  });
  it('the default mode is unchanged: a 401 is not a limit banner, even handed a since', () => {
    seed(); const p = writeTranscript([AUTH()]);
    expect(detect(p).rc).toBe('1');
    expect(h.sh(`_transcript_limit_banner ${JSON.stringify(p)} '' ${ROW_AT} >/dev/null; echo $?`)).toBe('1');
  });
  it('a 401 written by an EARLIER process is not stuck — a swap carries the transcript, not the fault', () => {
    // The loop this closes: Claude Code will not re-drive a turn whose error is
    // over six hours old, so after a swap the old account's 401 stays the newest
    // real row and would swap a healthy session every SWAP_COOLDOWN.
    seed(); const p = writeTranscript([AUTH()]);
    expect(stuck(p, ROW_AT + 1)).toBe('1');
    expect(stuck(p, ROW_AT)).toBe('0');
  });
  it('no since, or one that is not digits, and a 401 does not count — fail closed', () => {
    seed(); const p = writeTranscript([AUTH()]);
    expect(stuck(p, '')).toBe('1');
    expect(stuck(p, 'yesterday')).toBe('1');
  });
  it('an unreadable row timestamp does not count', () => {
    seed(); const p = writeTranscript([JSON.stringify({ ...JSON.parse(AUTH()), timestamp: 'soon' })]);
    expect(stuck(p)).toBe('1');
  });
  it('a 403 is not stuck — 2.1.280 files a model-permission refusal under the same error, and a swap cannot grant a model', () => {
    seed(); expect(stuck(writeTranscript([L.apiError('authentication_failed', 403, 'Please run /login · API Error: 403 permission denied')]))).toBe('1');
  });
  it('exhausted credit is not stuck — nothing marks a billing-dead account, so a rescue would bounce home', () => {
    seed(); expect(stuck(writeTranscript([BILLING()]))).toBe('1');
  });
  it("a 529 is not stuck, in either mode — transient, and not the account's", () => {
    seed(); const p = writeTranscript([OVERLOADED()]);
    expect(stuck(p)).toBe('1');
    expect(detect(p).rc).toBe('1');
  });
  it('the text on an ordinary assistant row is not stuck — the envelope decides', () => {
    seed(); expect(stuck(writeTranscript([L.assistant('Invalid API key · Fix external API key')]))).toBe('1');
  });
  it('a row carrying the error field without the API-error marker is not stuck', () => {
    const unmarked = JSON.stringify({ ...JSON.parse(AUTH()), isApiErrorMessage: undefined });
    seed(); expect(stuck(writeTranscript([unmarked]))).toBe('1');
  });
  it('a USER row carrying every field is not stuck — only the assistant row Claude Code appends', () => {
    const user = JSON.stringify({ ...JSON.parse(AUTH()), type: 'user' });
    seed(); expect(stuck(writeTranscript([user]))).toBe('1');
  });
  it("a landing's META resume prompt after the row means the session moved on", () => {
    seed(); expect(stuck(writeTranscript([AUTH(), L.metaPrompt()]))).toBe('1');
  });
});

describe('_transcript_stalled_pair pairs -f with -r (D-2370, closing D-2347)', () => {
  it('a directory at the path: rc 2', () => {
    seed(); const d = path.join(h.home, 'dir.jsonl'); fs.mkdirSync(d);
    expect(h.sh(`_transcript_stalled_pair ${JSON.stringify(d)}; echo "rc=$?"`)).toBe('rc=2');
  });
  it('a FIFO at the path: rc 2 without blocking', () => {
    seed(); const f = path.join(h.home, 'fifo.jsonl'); execFileSync('mkfifo', [f]);
    expect(detectTimed('_transcript_stalled_pair', f)).toBe('rc=2');
  });
});

describe('_session_hard_blocked wires the transcript into the rescue arm (D-2363)', () => {
  const PROMPT = '? for shortcuts\n❯ ';
  const BUSY = 'Reading files… (esc to interrupt)\n';
  const BANNER_PANE = 'API Error: 429 Too Many Requests\n❯ ';
  /** tmux answers ONE pane for every capture (plain and `-e` alike), `_pane_box_draft`
   *  answers `$BOX_DRAFT`, and the swap decision is stubbed so the test is about the
   *  verdict, never the fixture roster's telemetry. */
  const STUBS = (pane: string, target = 'claude2'): string => `
    tmux() { echo "tmux $*" >> "$HOME/ccd-calls"; ${WIDE_PANE} case "\${1:-}" in
      capture-pane) printf '%s\\n' ${JSON.stringify(pane)} ;; list-panes) echo 4242 ;;
      display-message) echo "\${TMUX_CREATED:-1}" ;; esac; return 0; };
    _pane_box_draft() { printf '%s' "\${BOX_DRAFT:-}"; };
    _swap_target() { echo ${target}; }; _avail() { return 0; };
    _dispatch_swap() { echo "dispatch $1 -> $2" >> "$HOME/ccd-calls"; };`;
  const dispatches = (): string[] => h.calls().filter((l) => l.startsWith('dispatch '));
  const swapLog = (): string => {
    const f = path.join(h.home, '.cc-sessions', 'swap.log');
    return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
  };
  const stranded = (): boolean => fs.existsSync(path.join(h.home, '.cc-sessions', `${ID}.stranded`));
  const authdeadPath = (): string => path.join(h.home, '.cc-sessions', 'claude-authdead');
  const authdead = (): string | null => (fs.existsSync(authdeadPath()) ? fs.readFileSync(authdeadPath(), 'utf8') : null);

  it('a banner newest in the transcript rescues a session whose pane shows only a prompt; the line says via=transcript', () => {
    seed(); writeTranscript([L.banner()]);
    h.sh(`${STUBS(PROMPT)} _auto_swap_check ${ID}`);
    expect(dispatches()).toEqual([`dispatch ${ID} -> claude2`]);
    expect(swapLog()).toMatch(/auto-rescue myid: claude \(blocked\) -> claude2 \[home=claude\] via=transcript/);
  });
  it('a BLANK pane no longer blinds the rescue: the transcript decides', () => {
    seed(); writeTranscript([L.banner()]);
    h.sh(`${STUBS('')} _auto_swap_check ${ID}`);
    expect(dispatches()).toHaveLength(1);
  });
  it('a non-empty input box stands the transcript arm down — cmd_swap carries the transcript, never the box', () => {
    seed(); writeTranscript([L.banner()]);
    h.sh(`${STUBS(PROMPT)} _auto_swap_check ${ID}`, { BOX_DRAFT: 'half a sentence' });
    expect(dispatches()).toEqual([]);
  });
  it('a running turn is never read for a banner', () => {
    seed(); writeTranscript([L.banner()]);
    h.sh(`${STUBS(BUSY)} _auto_swap_check ${ID}`);
    expect(dispatches()).toEqual([]);
  });
  it('a fresh stalepress stands the transcript arm down — the Enter _auto_stale_check just pressed does not lose the race to a same-tick rescue (D-2443)', () => {
    seed(); writeTranscript([L.banner()]);
    h.sh(`_reg_set ${ID} stalepress $(date +%s)`);
    h.sh(`${STUBS(PROMPT)} _auto_swap_check ${ID}`);
    expect(dispatches()).toEqual([]);
  });
  it('control: once STALE_RESUME_GRACE has lapsed the stand-down clears and the transcript arm rescues again', () => {
    seed(); writeTranscript([L.banner()]);
    h.sh(`_reg_set ${ID} stalepress $(( $(date +%s) - STALE_RESUME_GRACE - 1 ))`);
    h.sh(`${STUBS(PROMPT)} _auto_swap_check ${ID}`);
    expect(dispatches()).toEqual([`dispatch ${ID} -> claude2`]);
  });
  it('control: the pane arm is unaffected by a fresh stalepress — the grace only stands down the transcript arm', () => {
    seed(); writeTranscript([L.assistant()]);
    h.sh(`_reg_set ${ID} stalepress $(date +%s)`);
    h.sh(`${STUBS(BANNER_PANE)} _auto_swap_check ${ID}`);
    expect(dispatches()).toHaveLength(1);
  });
  it('control: a transcript whose newest row is a real turn does not rescue a prompt pane', () => {
    seed(); writeTranscript([L.banner(), L.assistant()]);
    h.sh(`${STUBS(PROMPT)} _auto_swap_check ${ID}`);
    expect(dispatches()).toEqual([]);
  });
  it('control: the pane arm is unchanged — a visible banner line rescues, draft or not, with no via= suffix', () => {
    seed(); writeTranscript([L.assistant()]);
    h.sh(`${STUBS(BANNER_PANE)} _auto_swap_check ${ID}`, { BOX_DRAFT: 'typing' });
    expect(dispatches()).toHaveLength(1);
    expect(swapLog()).toMatch(/auto-rescue myid: claude \(blocked\) -> claude2 \[home=claude\]$/m);
  });
  it('no destination: a transcript banner marks the row stranded, like a pane banner does', () => {
    seed(); writeTranscript([L.banner()]);
    h.sh(`${STUBS(PROMPT, '')} _auto_swap_check ${ID}`);
    expect(dispatches()).toEqual([]);
    expect(stranded()).toBe(true);
  });
  it('the strand half of an undecidable tick reads the same verdict', () => {
    seed(); writeTranscript([L.banner()]);
    h.sh(`${STUBS(PROMPT)} _tick_strand_undecidable ${ID} wrapper claude`);
    expect(stranded()).toBe(true);
    h.sh(`${STUBS(PROMPT)} _strand_clear ${ID}; _tick_strand_undecidable ${ID} wrapper claude`, { BOX_DRAFT: 'typing' });
    expect(stranded()).toBe(false);
  });
  it('a BLANK pane no longer blinds the strand half either: the transcript still strands it (D-2363)', () => {
    seed(); writeTranscript([L.banner()]);
    h.sh(`${STUBS('')} _tick_strand_undecidable ${ID} wrapper claude`);
    expect(stranded()).toBe(true);
  });
  it('the strand half stands down on a fresh stalepress too — one verdict, one stand-down (D-2443)', () => {
    seed(); writeTranscript([L.banner()]);
    h.sh(`_reg_set ${ID} stalepress $(date +%s)`);
    h.sh(`${STUBS(PROMPT)} _tick_strand_undecidable ${ID} wrapper claude`);
    expect(stranded()).toBe(false);
  });
  it('auth loss newest in the transcript rescues a prompt pane, via=transcript (D-3522)', () => {
    seed(); writeTranscript([L.human(), AUTH()]);
    h.sh(`${STUBS(PROMPT)} _auto_swap_check ${ID}`);
    expect(dispatches()).toEqual([`dispatch ${ID} -> claude2`]);
    expect(swapLog()).toMatch(/auto-rescue myid: claude \(blocked\) -> claude2 \[home=claude\] via=transcript/);
  });
  it("the old account's 401, carried into a pane created after it, rescues nothing (D-3522)", () => {
    seed(); writeTranscript([L.human(), AUTH()]);
    h.sh(`${STUBS(PROMPT)} _auto_swap_check ${ID}`, { TMUX_CREATED: String(ROW_AT + 60) });
    expect(dispatches()).toEqual([]);
    expect(authdead()).toBeNull();
  });
  it('a rescue off a 401 marks the account auth-dead, so nothing sends a session back to it (D-3522)', () => {
    seed(); writeTranscript([L.human(), AUTH()]);
    h.sh(`${STUBS(PROMPT)} _auto_swap_check ${ID}`);
    expect(dispatches()).toEqual([`dispatch ${ID} -> claude2`]);
    expect(authdead()).toMatch(/^\d+ rescue-401$/);
    expect(h.sh('_authdead claude && echo dead || echo live')).toBe('dead');
  });
  it('the rescue never writes over a standing marker (D-3522)', () => {
    seed(); writeTranscript([L.human(), AUTH()]);
    fs.writeFileSync(authdeadPath(), '1757203200 auth-401');
    h.sh(`${STUBS(PROMPT)} _auto_swap_check ${ID}`);
    expect(dispatches()).toHaveLength(1);
    expect(authdead()).toBe('1757203200 auth-401');
  });
  it('a rescue whose account credential changed after the pane was born marks nothing — the dying process read an older credential (D-3524)', () => {
    // `TMUX_CREATED` defaults to 1, so the file written here (ctime now) is newer
    // than the process: the 401 is a verdict about bytes no longer on disk. The
    // session still leaves — only the marker is withheld.
    seed(); writeTranscript([L.human(), AUTH()]);
    fs.mkdirSync(path.join(h.home, '.cc-secrets'), { recursive: true });
    fs.writeFileSync(path.join(h.home, '.cc-secrets', 'claude-oauth.env'), 'export CLAUDE_CODE_OAUTH_TOKEN=fixture\n');
    h.sh(`${STUBS(PROMPT)} _auto_swap_check ${ID}`);
    expect(dispatches()).toEqual([`dispatch ${ID} -> claude2`]);
    expect(authdead()).toBeNull();
  });
  it('CONTROL: a credential older than the pane is marked (D-3524)', () => {
    seed();
    fs.mkdirSync(path.join(h.home, '.cc-secrets'), { recursive: true });
    fs.writeFileSync(path.join(h.home, '.cc-secrets', 'claude-oauth.env'), 'export CLAUDE_CODE_OAUTH_TOKEN=fixture\n');
    const now = Math.floor(Date.now() / 1000);
    writeTranscript([L.human(), JSON.stringify({ ...JSON.parse(AUTH()), timestamp: new Date((now + 60) * 1000).toISOString() })]);
    h.sh(`${STUBS(PROMPT)} _auto_swap_check ${ID}`, { TMUX_CREATED: String(now + 30) });
    expect(dispatches()).toEqual([`dispatch ${ID} -> claude2`]);
    expect(authdead()).toMatch(/^\d+ rescue-401$/);
  });
  it('a lane with no secretsFile still marks when its `.credentials.json` changed after the pane was born — that file is not its credential (D-3524 round 1)', () => {
    // `claude-b` declares no secretsFile (a login lane). Its config dir's
    // `.credentials.json` changes for reasons that are not a re-login (7 of 17 on
    // the fleet box within 0-3 h), so it names nothing: the rescue writes its
    // marker exactly as D-3522 did, and the home arm keeps refusing the account.
    seed();
    h.sh(`_reg_set ${ID} wrapper claude-b; _reg_set ${ID} home claude-b`);
    writeTranscript([L.human(), AUTH()]);
    fs.mkdirSync(path.join(h.home, '.claude-b'), { recursive: true });
    fs.writeFileSync(path.join(h.home, '.claude-b', '.credentials.json'), '{}\n');   // ctime now; the pane was born at 1
    h.sh(`${STUBS(PROMPT)} _auto_swap_check ${ID}`);
    expect(dispatches()).toEqual([`dispatch ${ID} -> claude2`]);
    const f = path.join(h.home, '.cc-sessions', 'claude-b-authdead');
    expect(fs.existsSync(f), 'the rescue marked the login lane').toBe(true);
    expect(fs.readFileSync(f, 'utf8')).toMatch(/^\d+ rescue-401$/);
  });
  it('a rate-limit rescue marks nothing — a limit is not a dead credential (D-3522)', () => {
    seed(); writeTranscript([L.banner()]);
    h.sh(`${STUBS(PROMPT)} _auto_swap_check ${ID}`);
    expect(dispatches()).toHaveLength(1);
    expect(authdead()).toBeNull();
  });
  it('a pane-rung rescue marks nothing — only the transcript\'s 401 is evidence of a dead credential (D-3522)', () => {
    seed(); writeTranscript([L.assistant()]);
    h.sh(`${STUBS(BANNER_PANE)} _auto_swap_check ${ID}`);
    expect(dispatches()).toHaveLength(1);
    expect(authdead()).toBeNull();
  });
  it('the process bound is tmux session_created, read by one helper both callers share (source pin, D-3522)', () => {
    // `session_activity` would move on every redraw and silently discard every
    // 401 as "earlier"; the harness's tmux stub answers any display-message, so
    // only the source can hold the format.
    const src = fs.readFileSync(CCD, 'utf8');
    expect(src).toContain(`tmux display-message -p -t "$(_tmux_t "$1")" '#{session_created}' 2>/dev/null`);
    expect(src).toContain('born=$(_pane_born "$id")');
    // The rescue's marker write reads the bound ONCE (D-3524) and hands the same
    // value to the stuck scan and to the credential-change check, so the two can
    // never disagree about which process wrote the 401.
    expect(src).toContain('authborn=$(_pane_born "$id") && [[ "$(_transcript_limit_banner "$authf" stuck "$authborn"');
    expect(src).toContain('! _authdead_cred_changed "$wrapper" "$authborn"');
    expect(src.match(/#\{session_created\}/g)).toHaveLength(1);
  });
  it('control: exhausted credit rescues nothing (D-3522)', () => {
    seed(); writeTranscript([L.human(), BILLING()]);
    h.sh(`${STUBS(PROMPT)} _auto_swap_check ${ID}`);
    expect(dispatches()).toEqual([]);
  });
  it('auth loss with no destination strands the row, and the strand half reads it too (D-3522)', () => {
    seed(); writeTranscript([AUTH()]);
    h.sh(`${STUBS(PROMPT, '')} _auto_swap_check ${ID}`);
    expect(dispatches()).toEqual([]);
    expect(stranded()).toBe(true);
    h.sh(`${STUBS(PROMPT)} _strand_clear ${ID}; _tick_strand_undecidable ${ID} wrapper claude`);
    expect(stranded()).toBe(true);
  });
  it('control: a draft still stands the arm down for a 401 (D-3522)', () => {
    seed(); writeTranscript([AUTH()]);
    h.sh(`${STUBS(PROMPT)} _auto_swap_check ${ID}`, { BOX_DRAFT: 'half a sentence' });
    expect(dispatches()).toEqual([]);
  });
  it('control: a 529 newest in the transcript rescues nothing (D-3522)', () => {
    seed(); writeTranscript([OVERLOADED()]);
    h.sh(`${STUBS(PROMPT)} _auto_swap_check ${ID}`);
    expect(dispatches()).toEqual([]);
  });
  it('both call sites go through _session_hard_blocked (source pin)', () => {
    const src = fs.readFileSync(CCD, 'utf8');
    expect(src).toContain('_session_hard_blocked "$id" "$pane" && hard_blocked=1');
    expect(src).toContain('_session_hard_blocked "$1" "$pane" && blocked=1');
  });
});

describe('the transcript verdict is cached per session (D-2444)', () => {
  const PROMPT = '? for shortcuts\n❯ ';
  const stub = (verdict: 0 | 1 | 2, pathReadable = true): string => `
    _transcript_path() { ${pathReadable ? 'echo "$HOME/transcript.jsonl"' : 'return 1'}; };
    _transcript_limit_banner() { echo transcript-read >> "$HOME/ccd-calls"; return ${verdict}; };
    tmux() { ${WIDE_PANE} case "\${1:-}" in capture-pane) printf '%s\\n' ${JSON.stringify(PROMPT)} ;; esac; };
    _pane_box_draft() { printf '%s' "\${BOX_DRAFT:-}"; };`;
  const verdict = (extra = '', env: Record<string, string> = {}): string =>
    h.sh(`${extra} _session_hard_blocked ${ID} ${JSON.stringify(PROMPT)}; echo "rc=$?"`, env);
  const reads = (): string[] => h.calls().filter((line) => line === 'transcript-read');

  it('reuses a positive verdict and keeps answering blocked', () => {
    seed();
    expect(verdict(stub(0))).toBe('rc=0');
    expect(verdict(stub(0))).toBe('rc=0');
    expect(reads()).toHaveLength(1);
    expect(h.reg(ID, 'tscan')).toMatch(/^\d+ 1$/);
  });

  it('reads again when the cached verdict is older than TRANSCRIPT_ARM_INTERVAL', () => {
    seed(); h.sh(`_reg_set ${ID} tscan "1 1"`);
    expect(verdict(stub(0))).toBe('rc=0');
    expect(reads()).toHaveLength(1);
  });

  it('re-asks the draft guard for a cached positive without rereading the transcript', () => {
    seed(); h.sh(`_reg_set ${ID} tscan "$(date +%s) 1"`);
    expect(verdict(stub(0), { BOX_DRAFT: 'half a sentence' })).toBe('rc=1');
    expect(reads()).toEqual([]);
  });

  it('writes and honors a negative verdict, then finds the banner after expiry', () => {
    seed();
    expect(verdict(stub(1))).toBe('rc=1');
    expect(h.reg(ID, 'tscan')).toMatch(/^\d+ 0$/);
    expect(verdict(stub(0))).toBe('rc=1');
    expect(reads()).toHaveLength(1);

    h.sh(`_reg_set ${ID} tscan "1 0"`);
    expect(verdict(stub(0))).toBe('rc=0');
    expect(reads()).toHaveLength(2);
  });

  it('caches an absent transcript as a negative verdict', () => {
    seed();
    expect(verdict(stub(0, false))).toBe('rc=1');
    expect(h.reg(ID, 'tscan')).toMatch(/^\d+ 0$/);
    expect(reads()).toEqual([]);
  });

  it('caches an unreadable transcript as a negative verdict', () => {
    seed();
    expect(verdict(stub(2))).toBe('rc=1');
    expect(h.reg(ID, 'tscan')).toMatch(/^\d+ 0$/);
    expect(reads()).toHaveLength(1);
    expect(verdict(stub(0))).toBe('rc=1');
    expect(reads()).toHaveLength(1);
  });
});

// ── D-3100 / D-3101 — the pane arm learns THIS YEAR'S banner ───────────────
//
// THE FALSIFICATION FIRST. `_pane_hard_blocked`'s alternation was written
// against the banners of its day. Measured 2026-09-19 against every
// `isApiErrorMessage` row on disk across the fleet's wrapper HOMEs, these are
// the texts Claude Code actually renders — and three of the four match nothing
// in it, so the primary, every-tick pane detector has been blind to the session,
// weekly and bare limits, leaving D-2363's cached, newest-row-only, draft-
// deferring transcript fallback as the ONLY thing standing between a limited
// session and a human. The fleet log says the same: the only rescue of this
// shape on 2026-09-19 is logged ` … (blocked) -> … via=transcript`, i.e. by the
// fallback, on a pane that had been showing the answer all along.
//
// D-2364 IS KEPT, NOT REVERSED. It ruled that `_pane_hard_blocked` is not
// widened, because `_spawn_settle` turns that same regex into rc 5 on every
// landing. That function is untouched; the new wording lives in its own
// predicate with ONE caller, `_session_hard_blocked`. The cases below assert
// both halves — the new rung fires, and the old regex still does not.

describe('_pane_limit_banner: the wordings this fleet actually renders (D-3100)', () => {
  /** Every string here was read off an `isApiErrorMessage` row on this fleet's
   *  disk, not composed for the test. `monthly spend` is the one the OLD regex
   *  already caught, and it is kept in the table so the table shows the split
   *  rather than asserting it in prose. */
  const MEASURED: [text: string, oldArmMatches: boolean][] = [
    ["You've hit your session limit · resets 9:10pm (UTC)", false],
    ["You've hit your weekly limit · resets Sep 21, 7am (UTC)", false],
    ["You've hit your limit · resets Sep 17, 9pm (UTC)", false],
    ["You've hit your monthly spend limit · raise it at claude.ai/settings/usage", true],
  ];
  const paneArm = (fn: string, text: string): string =>
    h.sh(`${fn} ${JSON.stringify(text)}; echo "rc=$?"`);

  for (const [text, oldArmMatches] of MEASURED) {
    it(`matches ${JSON.stringify(text.slice(0, 34))}…`, () => {
      expect(paneArm('_pane_limit_banner', text)).toBe('rc=0');
    });
    it(`_pane_hard_blocked is UNCHANGED for it (rc ${oldArmMatches ? 0 : 1}) — D-2364 kept`, () => {
      // The whole reason the new wording is a separate function. `_spawn_settle`
      // and `_redrive_after_spawn` read this one and turn a match into rc 5
      // ("blocked on the new account") on every landing; widening it is the
      // thing D-2364 declined, and this row is what refuses the future edit
      // that does it anyway.
      expect(paneArm('_pane_hard_blocked', text)).toBe(`rc=${oldArmMatches ? 0 : 1}`);
    });
  }

  it('the separator is part of the pattern: an assistant SAYING the words does not match', () => {
    // Without the `·` this is a prose detector, and the session most likely to
    // print the sentence is the one working on this code. A wording change that
    // drops the separator fails CLOSED — no keystroke, no relocation, exactly
    // today's behaviour — which is `_pane_limit_stale`'s own rule.
    expect(paneArm('_pane_limit_banner',
      'I think you hit your weekly limit earlier, so the rescue never fired.')).toBe('rc=1');
  });

  it('the auto-continue banner still matches the OLD arm, so nothing regressed there', () => {
    // "Usage limit reached · continuing automatically at 9:10pm · esc to cancel"
    // is the shape that DID work, and it is why the fleet ever swapped at all.
    expect(paneArm('_pane_hard_blocked',
      'Usage limit reached · continuing automatically at 9:10pm · esc to cancel')).toBe('rc=0');
  });
});

describe('the banner rung rescues, and the log names WHICH detector fired (D-3100, D-3101)', () => {
  const PROMPT = '? for shortcuts\n❯ ';
  const NEW_BANNER = "You've hit your session limit · resets 9:10pm (UTC)\n❯ ";
  const STUBS = (pane: string, target = 'claude2'): string => `
    tmux() { echo "tmux $*" >> "$HOME/ccd-calls"; ${WIDE_PANE} case "\${1:-}" in
      capture-pane) printf '%s\\n' ${JSON.stringify(pane)} ;; list-panes) echo 4242 ;; esac; return 0; };
    _pane_box_draft() { printf '%s' "\${BOX_DRAFT:-}"; };
    _swap_target() { echo ${target}; }; _avail() { return 0; };
    _dispatch_swap() { echo "dispatch $1 -> $2" >> "$HOME/ccd-calls"; };`;
  const dispatches = (): string[] => h.calls().filter((l) => l.startsWith('dispatch '));
  const swapLog = (): string => {
    const f = path.join(h.home, '.cc-sessions', 'swap.log');
    return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
  };

  it("a pane showing \"You've hit your session limit ·\" is rescued, and the line says via=banner", () => {
    // The transcript deliberately holds an ORDINARY assistant turn, so the
    // transcript arm answers "not blocked". Without the new rung nothing here
    // fires at all — which is the defect, and this case is its measurement.
    seed(); writeTranscript([L.assistant()]);
    h.sh(`${STUBS(NEW_BANNER)} _auto_swap_check ${ID}`);
    expect(dispatches()).toEqual([`dispatch ${ID} -> claude2`]);
    expect(swapLog()).toMatch(/auto-rescue myid: claude \(blocked\) -> claude2 \[home=claude\] via=banner/);
  });

  it('the rescue does not wait out the transcript cache — the pane decides this tick', () => {
    // A cached NEGATIVE transcript verdict (`tscan "<now> 0"`) is exactly the
    // state a session lands in seconds before its limit arrives. The transcript
    // arm would say nothing for up to TRANSCRIPT_ARM_INTERVAL; the pane rung
    // sits above the cache and is not subject to it.
    seed(); writeTranscript([L.assistant()]);
    h.sh(`_reg_set ${ID} tscan "$(date +%s) 0"`);
    h.sh(`${STUBS(NEW_BANNER)} _auto_swap_check ${ID}`);
    expect(dispatches()).toEqual([`dispatch ${ID} -> claude2`]);
  });

  it('a banner pane with no destination strands the row, like every other hard block', () => {
    seed(); writeTranscript([L.assistant()]);
    h.sh(`${STUBS(NEW_BANNER, '')} _auto_swap_check ${ID}`);
    expect(dispatches()).toEqual([]);
    expect(fs.existsSync(path.join(h.home, '.cc-sessions', `${ID}.stranded`))).toBe(true);
  });

  it('the strand half reads the same verdict — one detector, two callers', () => {
    seed(); writeTranscript([L.assistant()]);
    h.sh(`${STUBS(NEW_BANNER)} _tick_strand_undecidable ${ID} wrapper claude`);
    expect(fs.existsSync(path.join(h.home, '.cc-sessions', `${ID}.stranded`))).toBe(true);
  });

  it('control: a prose mention of the words rescues nothing', () => {
    seed(); writeTranscript([L.assistant()]);
    h.sh(`${STUBS('we hit your weekly limit yesterday\n❯ ')} _auto_swap_check ${ID}`);
    expect(dispatches()).toEqual([]);
  });

  it('the provenance is READ off the verdict, not re-asked of a classifier that cannot see all three rungs', () => {
    // D-3101. The old line called `_pane_hard_blocked` a second time to decide
    // whether to write ` via=transcript`. That was sound while this function had
    // two rungs and one of them WAS that call; with three it would say
    // `via=transcript` about a banner that was on screen the whole time.
    seed(); writeTranscript([L.assistant()]);
    expect(h.sh(`${STUBS(NEW_BANNER)} _session_hard_blocked ${ID} ${JSON.stringify(NEW_BANNER)}; echo "$?:$HARD_BLOCK_VIA"`))
      .toBe('0:banner');
    expect(h.sh(`${STUBS(PROMPT)} _session_hard_blocked ${ID} 'API Error: 429'; echo "$?:$HARD_BLOCK_VIA"`))
      .toBe('0:pane');
    h.sh(`_reg_set ${ID} tscan ""`);
    writeTranscript([L.banner()]);
    expect(h.sh(`${STUBS(PROMPT)} _session_hard_blocked ${ID} ${JSON.stringify(PROMPT)}; echo "$?:$HARD_BLOCK_VIA"`))
      .toBe('0:transcript');
    h.sh(`_reg_set ${ID} tscan ""`);
    writeTranscript([L.assistant()]);
    expect(h.sh(`${STUBS(PROMPT)} _session_hard_blocked ${ID} ${JSON.stringify(PROMPT)}; echo "$?:$HARD_BLOCK_VIA"`))
      .toBe('1:');
  });
});

// ── D-3526 — a carried-in rate-limit banner is not a block ─────────────────
//
// `cmd_swap` carries the transcript with every row's original timestamp, so
// the old account's `error:"rate_limit"` row arrives on the new account
// unchanged. When the new process writes nothing — its TUI never came up, or
// Claude Code declines to re-drive a turn whose API-error row is six hours old
// — that row stays the newest real one, and once SWAP_COOLDOWN lapses the
// rescue read it as a block on the NEW account and moved the session again.
// Measured since 2026-09-08: 26 of 259 rescues. D-3522 already dates a 401
// against the pane's tmux `session_created`; this dates the rate limit against
// the same clock, and answers a distinct rc 3 for "carried in" rather than
// folding it into "not a limit". The one exception, the operator's ruling: a
// process that never came up (`.spawn` rc 4 at or after its birth) is still
// moved, because that move is what got such a landing off a dead target.
//
// ROUND 1 (the orchestrator's rulings on the harm review). The clock alone
// cannot tell a row a SWAP carried in from one this same account wrote before
// a restart (an OOM kill, a revival, stop/start), so "carried in" also needs a
// swap after the row: `$REG/<id>.lastswap` later than the row's epoch. And the
// pane rungs' dated read is cached on the process and the file
// (`$REG/<id>.tdate`), because a pane positive is asked every 5 s tick for as
// long as a stranded block, or a suppressed carried-in banner, stays on screen.

describe('_transcript_limit_banner stuck mode: a rate limit written before this process (D-3526)', () => {
  const read = (p: string, since: string | number, mode = 'stuck'): { rc: string; out: string } => {
    const raw = h.sh(`out=$(_transcript_limit_banner ${JSON.stringify(p)} ${mode} ${JSON.stringify(String(since))}); rc=$?; printf '%s|%s|' "$rc" "$out"`);
    const i = raw.indexOf('|');
    return { rc: raw.slice(0, i), out: raw.slice(i + 1, -1) };
  };
  it('the newest real row is a banner older than since: rc 3, and it prints the row epoch', () => {
    seed(); const p = writeTranscript([L.human(), L.banner()]);
    expect(read(p, BANNER_AT + 60)).toEqual({ rc: '3', out: String(BANNER_AT) });
  });
  it('control: equal seconds count as a block (rc 0), as the 401 gate counts them', () => {
    seed(); const p = writeTranscript([L.human(), L.banner()]);
    expect(read(p, BANNER_AT).rc).toBe('0');
    // A row stamped on the whole second: `since` equal to it is still this process's.
    const q = writeTranscript([L.human(), L.banner({ timestamp: iso(BANNER_AT) })]);
    expect(read(q, BANNER_AT).rc).toBe('0');
    expect(read(q, BANNER_AT + 1)).toEqual({ rc: '3', out: String(BANNER_AT) });
  });
  it('control: no since, or one that is not digits, keeps the positive — never taken away without proof', () => {
    seed(); const p = writeTranscript([L.human(), L.banner()]);
    expect(read(p, '').rc).toBe('0');
    expect(read(p, 'yesterday').rc).toBe('0');
  });
  it('control: an unparseable row timestamp cannot be proved older, so it counts', () => {
    seed(); const p = writeTranscript([L.human(), L.banner({ timestamp: 'soon' })]);
    expect(read(p, BANNER_AT + 60).rc).toBe('0');
  });
  it('control: a fresh banner after the carried one is this process\'s own block (rc 0)', () => {
    seed(); const p = writeTranscript([L.banner(), L.banner({ timestamp: iso(BANNER_AT + 120) })]);
    expect(read(p, BANNER_AT + 60)).toEqual({ rc: '0', out: '1789430400\tseven_day' });
  });
  it('control: the default mode is byte-for-byte unchanged, handed a since or not', () => {
    seed(); const p = writeTranscript([L.human(), L.banner()]);
    expect(detect(p)).toEqual({ rc: '0', out: '1789430400\tseven_day' });
    expect(read(p, BANNER_AT + 60, "''")).toEqual({ rc: '0', out: '1789430400\tseven_day' });
  });
  it('control: a META resume prompt after the carried banner is still "moved on" (rc 1)', () => {
    seed(); expect(read(writeTranscript([L.banner(), L.metaPrompt()]), BANNER_AT + 60).rc).toBe('1');
  });
  it('control: a 401 written before this process stays rc 1 — only a rate limit answers carried-in', () => {
    seed(); expect(read(writeTranscript([AUTH()]), ROW_AT + 1).rc).toBe('1');
  });
});

describe('_session_hard_blocked: a carried-in rate-limit banner is not a block (D-3526)', () => {
  const PROMPT = '? for shortcuts\n❯ ';
  const NEW_BANNER = "You've hit your session limit · resets 9:10pm (UTC)\n❯ ";
  const FOOTER = 'Usage limit reached · continuing automatically at 9:10pm · esc or type to cancel\n❯ ';
  const API_429 = 'API Error: 429 Too Many Requests\n❯ ';
  const AUTH_PANE = 'Invalid API key · Please run /login\n❯ ';
  /** This pane's process was born a minute AFTER the fixture banner was written. */
  const BORN = BANNER_AT + 60;
  /** D-2363's stubs, except that `display-message` answers only when
   *  `TMUX_CREATED` is set — unset is "tmux cannot say", the D-3100 stubs' shape. */
  const STUBS = (pane: string, target = 'claude2'): string => `
    tmux() { echo "tmux $*" >> "$HOME/ccd-calls"; ${WIDE_PANE} case "\${1:-}" in
      capture-pane) printf '%s\\n' ${JSON.stringify(pane)} ;; list-panes) echo 4242 ;;
      display-message) [ -n "\${TMUX_CREATED:-}" ] && echo "$TMUX_CREATED" ;; esac; return 0; };
    _pane_box_draft() { printf '%s' "\${BOX_DRAFT:-}"; };
    _swap_target() { echo ${target}; }; _avail() { return 0; };
    _dispatch_swap() { echo "dispatch $1 -> $2" >> "$HOME/ccd-calls"; };`;
  const tick = (pane: string, born: number | null = BORN, target = 'claude2'): void => {
    h.sh(`${STUBS(pane, target)} _auto_swap_check ${ID}`, born === null ? {} : { TMUX_CREATED: String(born) });
  };
  const dispatches = (): string[] => h.calls().filter((l) => l.startsWith('dispatch '));
  const swapLog = (): string => {
    const f = path.join(h.home, '.cc-sessions', 'swap.log');
    return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
  };
  const notes = (): string[] => swapLog().split('\n').filter((l) => l.includes(' carried-in '));
  const stranded = (): boolean => fs.existsSync(path.join(h.home, '.cc-sessions', `${ID}.stranded`));
  const authdead = (): string | null => {
    const f = path.join(h.home, '.cc-sessions', 'claude-authdead');
    return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null;
  };
  /** The swap that carried the row in: stamped after the row, before this pane's birth. */
  const LANDED = BANNER_AT + 30;
  const carried = (): void => {
    seed(); writeTranscript([L.human(), L.banner()]);
    h.sh(`_reg_set ${ID} lastswap ${LANDED}`);
  };
  const settled = (at: number, rc: number): void => { h.sh(`_reg_set ${ID} spawn "${at} ${rc}"`); };
  /** Counts every transcript read the verdict makes: the real reader, wrapped. */
  const COUNTED = `eval "$(declare -f _transcript_limit_banner | sed '1s/^_transcript_limit_banner/_tlb_real/')";
    _transcript_limit_banner() { echo transcript-read >> "$HOME/ccd-calls"; _tlb_real "$@"; };`;
  const reads = (): number => h.calls().filter((l) => l === 'transcript-read').length;
  /** One verdict read, as the rescue arm asks it, with the reader counted. */
  const verdict = (pane: string, born: number = BORN): string =>
    h.sh(`${STUBS(pane)} ${COUNTED} _session_hard_blocked ${ID} ${JSON.stringify(pane)}; echo "$?:$HARD_BLOCK_VIA"`,
      { TMUX_CREATED: String(born) });

  it('transcript rung: a banner older than the pane rescues nothing, and says so once per process', () => {
    carried(); settled(BORN + 30, 0);
    tick(PROMPT);
    expect(dispatches()).toEqual([]);
    expect(notes()).toHaveLength(1);
    expect(notes()[0]).toMatch(new RegExp(
      `^\\d{4}-\\d\\d-\\d\\d \\d\\d:\\d\\d:\\d\\d carried-in ${ID}: via=transcript rate-limit row at ${BANNER_AT} `
      + `predates this pane's process \\(born ${BORN}\\) — not a block \\[wrapper=claude\\] \\[spawn=0\\]$`));
    expect(h.reg(ID, 'carriednote')).toBe(String(BORN));
    expect(authdead()).toBeNull();
    // A second read of the same process (the cache cleared) writes no second line.
    h.sh(`_reg_set ${ID} tscan ""`);
    tick(PROMPT);
    expect(dispatches()).toEqual([]);
    expect(notes()).toHaveLength(1);
    // A new process is a new floor.
    h.sh(`_reg_set ${ID} tscan ""`);
    tick(PROMPT, BANNER_AT + 90);
    expect(dispatches()).toEqual([]);
    expect(notes()).toHaveLength(2);
    expect(notes()[1]).toContain(`(born ${BANNER_AT + 90})`);
  });
  it('the carried-in answer is cached as an ordinary negative — the tscan shape is unchanged', () => {
    carried(); tick(PROMPT);
    expect(h.reg(ID, 'tscan')).toMatch(/^\d+ 0$/);
  });
  it('control: a pane born BEFORE the banner is rescued via=transcript, with no carried-in line', () => {
    carried(); tick(PROMPT, BANNER_AT - 60);
    expect(dispatches()).toEqual([`dispatch ${ID} -> claude2`]);
    expect(swapLog()).toMatch(/auto-rescue myid: claude \(blocked\) -> claude2 \[home=claude\] via=transcript/);
    expect(notes()).toEqual([]);
  });
  it('never came up: this process settled rc 4, so the carried banner still moves it — the ruling', () => {
    carried(); settled(BORN + 900, 4);
    tick(PROMPT);
    expect(dispatches()).toEqual([`dispatch ${ID} -> claude2`]);
    expect(swapLog()).toMatch(/auto-rescue myid: claude \(blocked\) -> claude2 \[home=claude\] via=transcript/);
    expect(notes()).toEqual([]);
  });
  it('never came up counts the settle AT the birth second too', () => {
    carried(); settled(BORN, 4);
    tick(PROMPT);
    expect(dispatches()).toEqual([`dispatch ${ID} -> claude2`]);
  });
  it('control: an rc 4 from an EARLIER process (a .spawn older than born) is not "never came up"', () => {
    carried(); settled(BORN - 10, 4);
    tick(PROMPT);
    expect(dispatches()).toEqual([]);
    expect(notes()).toHaveLength(1);
    expect(notes()[0]).toMatch(/\[spawn=4\]$/);
  });
  it('control: a settle of this process that came up (rc 0) is not "never came up"', () => {
    carried(); settled(BORN + 900, 0);
    tick(PROMPT);
    expect(dispatches()).toEqual([]);
  });
  it('pane rung (banner): this year\'s limit banner over a carried transcript banner rescues nothing, via=banner', () => {
    carried(); tick(NEW_BANNER);
    expect(dispatches()).toEqual([]);
    expect(notes()).toHaveLength(1);
    expect(notes()[0]).toContain(`carried-in ${ID}: via=banner rate-limit row at ${BANNER_AT}`);
  });
  it.each([['an auto-continue footer', FOOTER], ['an API Error: 429 line', API_429]])(
    'pane rung (pane): %s over a carried transcript banner rescues nothing, via=pane', (_what, pane) => {
      carried(); tick(pane);
      expect(dispatches()).toEqual([]);
      expect(notes()).toHaveLength(1);
      expect(notes()[0]).toContain(`carried-in ${ID}: via=pane rate-limit row at ${BANNER_AT}`);
    });
  it('the pane rung reports its verdict with HARD_BLOCK_VIA cleared', () => {
    carried();
    expect(h.sh(`${STUBS(NEW_BANNER)} _session_hard_blocked ${ID} ${JSON.stringify(NEW_BANNER)}; echo "$?:$HARD_BLOCK_VIA"`,
      { TMUX_CREATED: String(BORN) })).toBe('1:');
  });
  it('never came up keeps a pane positive too', () => {
    carried(); settled(BORN + 900, 4);
    tick(NEW_BANNER);
    expect(dispatches()).toEqual([`dispatch ${ID} -> claude2`]);
    expect(swapLog()).toMatch(/via=banner/);
  });
  it('control: a real row after the carried banner means this process wrote something — the pane banner rescues', () => {
    seed(); writeTranscript([L.banner(), L.assistant()]);
    tick(NEW_BANNER);
    expect(dispatches()).toEqual([`dispatch ${ID} -> claude2`]);
    expect(swapLog()).toMatch(/auto-rescue myid: claude \(blocked\) -> claude2 \[home=claude\] via=banner/);
    expect(notes()).toEqual([]);
  });
  it('control: born unknown keeps every pane positive', () => {
    carried(); tick(NEW_BANNER, null);
    expect(dispatches()).toEqual([`dispatch ${ID} -> claude2`]);
    expect(notes()).toEqual([]);
  });
  it('control: an auth failure on the pane is not dated against a rate-limit row', () => {
    carried(); tick(AUTH_PANE);
    expect(dispatches()).toEqual([`dispatch ${ID} -> claude2`]);
    expect(notes()).toEqual([]);
    expect(authdead()).toBeNull();
  });
  it('the pane rung\'s dating read is not the tscan cache: a cached negative does not decide it', () => {
    carried();
    h.sh(`_reg_set ${ID} tscan "$(date +%s) 0"`);
    tick(NEW_BANNER);
    expect(dispatches()).toEqual([]);
    // This process has now written its own limit row: the pane banner is real.
    writeTranscript([L.human(), L.banner(), L.banner({ timestamp: iso(BANNER_AT + 120) })]);
    tick(NEW_BANNER);
    expect(dispatches()).toEqual([`dispatch ${ID} -> claude2`]);
    expect(h.reg(ID, 'tscan')).toMatch(/^\d+ 0$/);
  });
  it('the strand half: a carried banner writes no .stranded', () => {
    carried();
    h.sh(`${STUBS(PROMPT)} _strand_clear ${ID}; _tick_strand_undecidable ${ID} wrapper claude`, { TMUX_CREATED: String(BORN) });
    expect(stranded()).toBe(false);
    // Control: the same banner, the pane born before it, strands.
    h.sh(`_reg_set ${ID} tscan ""`);
    h.sh(`${STUBS(PROMPT)} _tick_strand_undecidable ${ID} wrapper claude`, { TMUX_CREATED: String(BANNER_AT - 60) });
    expect(stranded()).toBe(true);
  });
  it('the no-target strand: a carried banner with nowhere to go strands nothing', () => {
    carried(); tick(PROMPT, BORN, '');
    expect(dispatches()).toEqual([]);
    expect(stranded()).toBe(false);
  });
  it('_never_came_up reads a torn .spawn or born as "cannot say", and never evaluates it (D-299)', () => {
    seed();
    // Both operands reach bash verbatim: the file is written from here, and
    // born rides single-quoted, so only `_never_came_up` itself could expand them.
    const ask = (spawn: string, born: string): string => {
      fs.writeFileSync(path.join(h.home, '.cc-sessions', `${ID}.spawn`), spawn);
      return h.sh(`_never_came_up ${ID} '${born}' 2>/dev/null; echo "rc=$?"`);
    };
    expect(ask(`${BORN} 4`, String(BORN))).toBe('rc=0');
    expect(ask(`0${BORN} 4`, String(BORN))).toBe('rc=0');
    expect(ask(`${BORN} 4`, '')).toBe('rc=1');
    expect(ask(`${BORN} 4`, 'soon')).toBe('rc=1');
    expect(ask('4', String(BORN))).toBe('rc=1');
    expect(ask(`${BORN} 4 4`, String(BORN))).toBe('rc=1');
    const marker = path.join(h.home, 'evaluated');
    expect(ask(`REG[$(touch ${marker})] 4`, String(BORN))).toBe('rc=1');
    expect(ask(`${BORN} 4`, `REG[$(touch ${marker})]`)).toBe('rc=1');
    expect(fs.existsSync(marker)).toBe(false);
  });
  it('purge: carriednote and tdate go with the row', () => {
    seed(); h.sh(`_reg_set ${ID} carriednote 5; _reg_set ${ID} tdate "1 2 3 1 - /x.jsonl"`);
    expect(h.reg(ID, 'carriednote')).toBe('5');
    expect(h.reg(ID, 'tdate')).toBe('1 2 3 1 - /x.jsonl');
    h.sh(`_reg_purge ${ID}`);
    expect(h.reg(ID, 'carriednote')).toBeNull();
    expect(h.reg(ID, 'tdate')).toBeNull();
  });

  // ── Round 1, ruling 1: carried in means a SWAP carried it ──────────────────
  // The harm review's scenario, step for step: a session strands on a limit its
  // own account wrote, every account pinned; more than six hours later the pane
  // is revived ON THE SAME ACCOUNT (an OOM kill, a revival, stop/start), so the
  // new process is born after the row and Claude Code's six-hour cap declines to
  // re-drive it. The clock alone read that row as carried in: the strand was
  // retracted and the session was never moved when a target freed. No swap
  // after the row means the row is this account's own, and it stays a block.
  it.each([['the transcript rung', PROMPT], ['the banner rung', NEW_BANNER]])(
    'a same-account restart more than 6 h after a real block keeps it, via %s: stays stranded, then moves when a target frees', (_what, pane) => {
      seed(); writeTranscript([L.human(), L.banner()]);
      // The swap that brought the session onto this account came BEFORE the row.
      h.sh(`_reg_set ${ID} lastswap ${BANNER_AT - 3600}`);
      // (1) the pane that hit the limit, nowhere to go: stranded.
      tick(pane, BANNER_AT - 60, '');
      expect(stranded()).toBe(true);
      // (2) revived on the same account seven hours later; this process came up.
      const REVIVED = BANNER_AT + 7 * 3600;
      settled(REVIVED + 30, 0);
      h.sh(`_reg_set ${ID} tscan ""`);
      tick(pane, REVIVED, '');
      expect(stranded()).toBe(true);
      expect(swapLog()).not.toMatch(/unstranded/);
      expect(notes()).toEqual([]);
      // (3) the same process, and now a target frees: it is moved.
      h.sh(`_reg_set ${ID} tscan ""`);
      tick(pane, REVIVED);
      expect(dispatches()).toEqual([`dispatch ${ID} -> claude2`]);
    });
  it('a missing lastswap (a refused carry deletes it) is no swap: the row stays a block', () => {
    seed(); writeTranscript([L.human(), L.banner()]);
    settled(BANNER_AT + 7 * 3600 + 30, 0);
    tick(PROMPT, BANNER_AT + 7 * 3600);
    expect(dispatches()).toEqual([`dispatch ${ID} -> claude2`]);
    expect(notes()).toEqual([]);
  });
  it('control: the same restart with a swap after the row is carried in', () => {
    carried(); settled(BANNER_AT + 7 * 3600 + 30, 0);
    tick(PROMPT, BANNER_AT + 7 * 3600, '');
    expect(dispatches()).toEqual([]);
    expect(stranded()).toBe(false);
    expect(notes()).toHaveLength(1);
  });
  it('a swap in the row\'s own second is not proof it came after: the row stays a block', () => {
    seed(); writeTranscript([L.human(), L.banner()]);
    h.sh(`_reg_set ${ID} lastswap ${BANNER_AT}`);
    tick(PROMPT);
    expect(dispatches()).toEqual([`dispatch ${ID} -> claude2`]);
    // Control: one second later is.
    h.sh(`_reg_set ${ID} lastswap ${BANNER_AT + 1}; _reg_set ${ID} tscan ""`);
    expect(verdict(PROMPT)).toBe('1:');
    expect(notes()).toHaveLength(1);
  });
  it('a torn lastswap is no swap, and is never evaluated (D-299)', () => {
    seed(); writeTranscript([L.human(), L.banner()]);
    const marker = path.join(h.home, 'evaluated');
    const at = (sw: string): string => {
      fs.writeFileSync(path.join(h.home, '.cc-sessions', `${ID}.lastswap`), sw);
      h.sh(`_reg_set ${ID} tscan ""`);
      return verdict(PROMPT);
    };
    // `+0` is the one that would read as a later swap if it reached the arithmetic.
    for (const torn of ['', 'soon', `REG[$(touch ${marker})]`, `${LANDED} ${LANDED}`, `${LANDED}+0`]) {
      expect(at(torn), JSON.stringify(torn)).toBe('0:transcript');
    }
    expect(fs.existsSync(marker)).toBe(false);
    expect(notes()).toEqual([]);
    // Control: a leading zero is still a number, in base ten.
    expect(at(`0${LANDED}`)).toBe('1:');
    expect(notes()).toHaveLength(1);
  });

  // ── Round 1, ruling 2: the dated answer is cached on the process and the file ──
  it('a pane positive reads the transcript once per process and file: the second tick does not read it again', () => {
    carried();
    expect(verdict(NEW_BANNER)).toBe('1:');
    expect(reads()).toBe(1);
    const p = h.sh(`_transcript_path ${ID}`);
    expect(h.reg(ID, 'tdate')).toBe(`${BORN} ${Math.floor(fs.statSync(p).mtimeMs / 1000)} ${fs.statSync(p).size} 3 ${BANNER_AT} - - ${p}`);
    expect(verdict(NEW_BANNER)).toBe('1:');
    expect(verdict(FOOTER)).toBe('1:');
    expect(reads()).toBe(1);
    expect(notes()).toHaveLength(1);
  });
  it('a grown transcript is read again, so a fresh block is never hidden by the cache — even in the same second', () => {
    carried();
    expect(verdict(NEW_BANNER)).toBe('1:');
    const p = h.sh(`_transcript_path ${ID}`);
    const { atime, mtime } = fs.statSync(p);
    // This process now writes its own limit row; the clock is held still, so only the size says so.
    fs.appendFileSync(p, L.banner({ timestamp: iso(BORN + 60) }) + '\n');
    fs.utimesSync(p, atime, mtime);
    expect(verdict(NEW_BANNER)).toBe('0:banner');
    expect(reads()).toBe(2);
  });
  it('a rewritten transcript of the same size is read again: the mtime is a key too', () => {
    carried();
    expect(verdict(NEW_BANNER)).toBe('1:');
    const p = h.sh(`_transcript_path ${ID}`);
    const { atime, mtime } = fs.statSync(p);
    fs.utimesSync(p, atime, new Date(mtime.getTime() + 5000));
    expect(verdict(NEW_BANNER)).toBe('1:');
    expect(reads()).toBe(2);
  });
  it('a new process is read again: born is a key — a 401 is dated by it', () => {
    seed(); writeTranscript([AUTH()]);
    // Born before the 401: this process wrote it, a block.
    expect(verdict(PROMPT, ROW_AT - 60)).toBe('0:transcript');
    // A later process on the same file: that 401 is no longer its own.
    h.sh(`_reg_set ${ID} tscan ""`);
    expect(verdict(PROMPT, ROW_AT + 60)).toBe('1:');
    expect(reads()).toBe(2);
  });
  it('another transcript is read again: the path is a key too', () => {
    carried();
    expect(verdict(NEW_BANNER)).toBe('1:');
    const p = h.sh(`_transcript_path ${ID}`);
    const { atime, mtime } = fs.statSync(p);
    // A new conversation id, and a file with the same bytes and the same clock.
    h.sh(`_reg_set ${ID} uuid deadbeef-0000-4000-8000-000000000001`);
    const q = writeTranscript([L.human(), L.banner()]);
    expect(q).not.toBe(p);
    fs.utimesSync(q, atime, mtime);
    expect(verdict(NEW_BANNER)).toBe('1:');
    expect(reads()).toBe(2);
  });
  it('an unreadable answer (rc 2) is never cached: it is asked again next tick', () => {
    seed(); writeTranscript([L.human(), L.banner()]);
    const TWO = '_transcript_limit_banner() { echo transcript-read >> "$HOME/ccd-calls"; return 2; };';
    const ask = (): string => h.sh(`${STUBS(NEW_BANNER)} ${TWO} _session_hard_blocked ${ID} ${JSON.stringify(NEW_BANNER)}; echo "$?:$HARD_BLOCK_VIA"`,
      { TMUX_CREATED: String(BORN) });
    expect(ask()).toBe('0:banner');
    expect(ask()).toBe('0:banner');
    expect(reads()).toBe(2);
    expect(h.reg(ID, 'tdate')).toBeNull();
  });
  it('born unknown, or a file stat cannot measure, reads uncached and writes no record', () => {
    carried();
    const ask = (extra: string, env: Record<string, string>): string =>
      h.sh(`${STUBS(NEW_BANNER)} ${COUNTED} ${extra} _session_hard_blocked ${ID} ${JSON.stringify(NEW_BANNER)}; echo "$?:$HARD_BLOCK_VIA"`, env);
    // tmux cannot say when this pane was born: the positive stands, read every time.
    expect(ask('', {})).toBe('0:banner');
    expect(ask('', {})).toBe('0:banner');
    expect(reads()).toBe(2);
    expect(h.reg(ID, 'tdate')).toBeNull();
    // A stat that answers no number, for either key: still dated, never cached.
    for (const broken of ['_plat_mtime() { echo soon; };', '_plat_size() { :; };']) {
      expect(ask(broken, { TMUX_CREATED: String(BORN) }), broken).toBe('1:');
      expect(ask(broken, { TMUX_CREATED: String(BORN) }), broken).toBe('1:');
      expect(h.reg(ID, 'tdate'), broken).toBeNull();
    }
    expect(reads()).toBe(6);
  });
  it('a record for another key, or a torn one, is never trusted', () => {
    carried();
    const p = h.sh(`_transcript_path ${ID}`);
    const m = Math.floor(fs.statSync(p).mtimeMs / 1000); const s = fs.statSync(p).size;
    // A record that would answer "not a limit" for a different process: ignored, the file is read.
    h.sh(`_reg_set ${ID} tdate "${BORN - 1} ${m} ${s} 1 - ${p}"`);
    expect(verdict(NEW_BANNER)).toBe('1:');
    expect(reads()).toBe(1);
    // A torn record for this key: ignored too.
    h.sh(`_reg_set ${ID} tdate "${BORN} ${m} ${s} 9 - ${p}"`);
    expect(verdict(NEW_BANNER)).toBe('1:');
    expect(reads()).toBe(2);
  });
  it('an rc-inconsistent cache record is torn and cannot turn a carried banner back into a block', () => {
    carried();
    const p = h.sh(`_transcript_path ${ID}`);
    const m = Math.floor(fs.statSync(p).mtimeMs / 1000); const s = fs.statSync(p).size;
    // rc 3 must carry the dated row's epoch, not the no-row sentinel.
    h.sh(`_reg_set ${ID} tdate "${BORN} ${m} ${s} 3 - ${p}"`);
    expect(verdict(NEW_BANNER)).toBe('1:');
    expect(reads()).toBe(1);
    // Likewise, an rc 1 record cannot carry a row epoch.
    h.sh(`_reg_set ${ID} tdate "${BORN} ${m} ${s} 1 ${BANNER_AT} ${p}"`);
    expect(verdict(NEW_BANNER)).toBe('1:');
    expect(reads()).toBe(2);
  });
});

// ── The `dated` read, and the row `_limit_read` caches (session-continuity §5.4
// rule 2, D-3498). `dated` mode is `stuck` mode plus the rate-limit row's own
// epoch as a third field, so the rescue waits read `resetsAt`, the window and the
// row's epoch from the answer the verdict itself came from — cached in
// `$REG/<id>.tdate` on the process and the file, never a second read on the
// 5 s tick. Every other answer — rc 1, 2, 3, and a 401's rc 0 — is stuck mode's.
describe('_transcript_limit_banner dated mode, and the row _limit_read caches (session-continuity §5.4 rule 2)', () => {
  const read = (p: string, since: string | number, mode = 'dated'): { rc: string; out: string } => {
    const raw = h.sh(`out=$(_transcript_limit_banner ${JSON.stringify(p)} ${mode} ${JSON.stringify(String(since))}); rc=$?; printf '%s|%s|' "$rc" "$out"`);
    const i = raw.indexOf('|');
    return { rc: raw.slice(0, i), out: raw.slice(i + 1, -1) };
  };
  const at = (row: string, epoch: number): string => JSON.stringify({ ...JSON.parse(row), timestamp: iso(epoch) });
  /** `_limit_read`, with every transcript read it makes counted. */
  const COUNTED = `eval "$(declare -f _transcript_limit_banner | sed '1s/^_transcript_limit_banner/_tlb_real/')";
    _transcript_limit_banner() { echo transcript-read >> "$HOME/ccd-calls"; _tlb_real "$@"; };`;
  const reads = (): number => h.calls().filter((l) => l === 'transcript-read').length;
  const limitRead = (p: string, born: number): string =>
    h.sh(`${COUNTED} out=$(_limit_read ${ID} ${JSON.stringify(p)} ${born}); echo "$?|$out|"`);
  const key = (p: string, born: number): string =>
    `${born} ${Math.floor(fs.statSync(p).mtimeMs / 1000)} ${fs.statSync(p).size}`;

  it('a rate-limit row this process wrote: rc 0, stuck mode\'s two fields, then the row\'s own epoch', () => {
    seed(); const p = writeTranscript([L.human(), L.banner()]);
    expect(read(p, BANNER_AT)).toEqual({ rc: '0', out: `1789430400\tseven_day\t${BANNER_AT}` });
    expect(read(p, BANNER_AT, 'stuck')).toEqual({ rc: '0', out: '1789430400\tseven_day' });
  });
  it('no since, or one that is not digits: still rc 0 — never taken away — but the row cannot be placed: `-`', () => {
    seed(); const p = writeTranscript([L.human(), L.banner()]);
    expect(read(p, '')).toEqual({ rc: '0', out: '1789430400\tseven_day\t-' });
    expect(read(p, 'soon')).toEqual({ rc: '0', out: '1789430400\tseven_day\t-' });
  });
  it('a row without quotaLimits keeps both empty fields, so the epoch is always the third', () => {
    seed(); const p = writeTranscript([L.banner({ quotaLimits: undefined })]);
    expect(read(p, BANNER_AT)).toEqual({ rc: '0', out: `\t\t${BANNER_AT}` });
  });
  it('rc 1, rc 3 and a 401 are stuck mode\'s answers, byte for byte', () => {
    seed();
    const p = writeTranscript([L.human(), L.banner()]);
    expect(read(p, BANNER_AT + 60)).toEqual({ rc: '3', out: String(BANNER_AT) });
    expect(read(writeTranscript([L.banner(), L.metaPrompt()]), BANNER_AT)).toEqual({ rc: '1', out: '' });
    expect(read(writeTranscript([AUTH()]), ROW_AT)).toEqual({ rc: '0', out: '\t\tauthentication_failed' });
  });
  // THE MEASUREMENT BEHIND "LOST AUTH DATES NOTHING". Whoever wrote the 401, it
  // is newer than the rate-limit row, so that row is never the answer: with no
  // `since` (or a torn one) the 401 is not counted and still ends the banner's
  // run (rc 1); a 401 this process wrote is the answer, with no epoch or reset;
  // a 401 an earlier process wrote ends the run as well (rc 1).
  it.each([
    ['[banner, turn, 401]', () => [L.banner(), at(L.assistant(), BANNER_AT + 60), at(AUTH(), BANNER_AT + 120)]],
    ['[banner, 401]', () => [L.banner(), at(AUTH(), BANNER_AT + 120)]],
  ])('%s: no since or a torn one, rc 1; born before the 401, the 401; born after it, rc 1 — in both modes', (_what, rows) => {
    seed(); const p = writeTranscript(rows());
    for (const mode of ['dated', 'stuck']) {
      expect(read(p, '', mode).rc, mode).toBe('1');
      expect(read(p, 'soon', mode).rc, mode).toBe('1');
      expect(read(p, BANNER_AT + 90, mode), mode).toEqual({ rc: '0', out: '\t\tauthentication_failed' });
      expect(read(p, BANNER_AT + 180, mode).rc, mode).toBe('1');
    }
  });

  it('_limit_read caches the rc-0 row beside the answer, and prints it from the cache without a read', () => {
    seed(); const p = writeTranscript([L.human(), L.banner()]);
    expect(limitRead(p, BANNER_AT)).toBe(`0|${BANNER_AT}\t1789430400\tseven_day|`);
    expect(h.reg(ID, 'tdate')).toBe(`${key(p, BANNER_AT)} 0 ${BANNER_AT} 1789430400 seven_day ${p}`);
    expect(limitRead(p, BANNER_AT)).toBe(`0|${BANNER_AT}\t1789430400\tseven_day|`);
    expect(reads()).toBe(1);
  });
  it('each field is its own: a row with no quotaLimits caches `- -` after its epoch, never its epoch as a reset', () => {
    seed(); const p = writeTranscript([L.banner({ quotaLimits: undefined })]);
    expect(limitRead(p, BANNER_AT)).toBe(`0|${BANNER_AT}\t-\t-|`);
    expect(h.reg(ID, 'tdate')).toBe(`${key(p, BANNER_AT)} 0 ${BANNER_AT} - - ${p}`);
  });
  it('a 401 caches rc 0 with nothing dated; rc 1 caches `- - -`; rc 3 its row and `- -`', () => {
    seed();
    const q = writeTranscript([AUTH()]);
    expect(limitRead(q, ROW_AT)).toBe('0|-\t-\t-|');
    expect(h.reg(ID, 'tdate')).toBe(`${key(q, ROW_AT)} 0 - - - ${q}`);
    const r = writeTranscript([L.banner(), L.metaPrompt()]);
    expect(limitRead(r, BANNER_AT)).toBe('1||');
    expect(h.reg(ID, 'tdate')).toBe(`${key(r, BANNER_AT)} 1 - - - ${r}`);
    const s = writeTranscript([L.human(), L.banner()]);
    expect(limitRead(s, BANNER_AT + 60)).toBe(`3|${BANNER_AT}|`);
    expect(h.reg(ID, 'tdate')).toBe(`${key(s, BANNER_AT + 60)} 3 ${BANNER_AT} - - ${s}`);
  });
  it('a record in the shape before this wave is re-read, never trusted, and rewritten', () => {
    seed(); const p = writeTranscript([L.human(), L.banner()]);
    // The old shape "<key> <rc> <row|-> <path>" for THIS key: had it been parsed
    // it would have answered rc 0 with no row — no wait, for as long as the file
    // stood still.
    h.sh(`_reg_set ${ID} tdate "${key(p, BANNER_AT)} 0 - ${p}"`);
    expect(limitRead(p, BANNER_AT)).toBe(`0|${BANNER_AT}\t1789430400\tseven_day|`);
    expect(reads()).toBe(1);
    expect(h.reg(ID, 'tdate')).toBe(`${key(p, BANNER_AT)} 0 ${BANNER_AT} 1789430400 seven_day ${p}`);
  });
  it('a torn record for this key — an rc 1 with a row, an rc 3 with a reset — is never trusted', () => {
    seed(); const p = writeTranscript([L.human(), L.banner()]);
    h.sh(`_reg_set ${ID} tdate "${key(p, BANNER_AT)} 1 ${BANNER_AT} - - ${p}"`);
    expect(limitRead(p, BANNER_AT)).toBe(`0|${BANNER_AT}\t1789430400\tseven_day|`);
    expect(reads()).toBe(1);
    h.sh(`_reg_set ${ID} tdate "${key(p, BANNER_AT + 60)} 3 ${BANNER_AT} 1789430400 - ${p}"`);
    expect(limitRead(p, BANNER_AT + 60)).toBe(`3|${BANNER_AT}|`);
    expect(reads()).toBe(2);
  });
});
