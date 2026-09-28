import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { makeCcdHarness, CCD, type CcdHarness, WIDE_PANE } from './ccdWsHelpers.js';
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
 *  NOT block. Perl is available on both supported userlands; SIGALRM exits 142. */
const detectTimed = (fn: string, p: string): string =>
  h.sh(`perl -e 'alarm shift; exec @ARGV' 5 bash -c "$(declare -f ${fn}); REDRIVE_TAIL_LINES=$REDRIVE_TAIL_LINES; ${fn} \\"\\$1\\"" _ ${JSON.stringify(p)} >/dev/null 2>&1; echo "rc=$?"`);

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
  it('still reads a rate limit as stuck, with or without a since', () => {
    seed(); const p = writeTranscript([L.banner()]);
    expect(stuck(p)).toBe('0');
    expect(stuck(p, '')).toBe('0');
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
    expect(src).toContain(`tmux display-message -p -t "$(_tmux "$1")" '#{session_created}' 2>/dev/null`);
    expect(src).toContain('born=$(_pane_born "$id")');
    expect(src).toContain('stuck "$(_pane_born "$id")"');
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
