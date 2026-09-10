import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { makeCcdHarness, CCD, type CcdHarness } from './ccdWsHelpers.js';
import { itLinux } from './platformFixtures.js';
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
  human: (text = 'resume') => JSON.stringify({ type: 'user', uuid: 'u1', timestamp: 't', message: { role: 'user', content: text } }),
  caveat: () => JSON.stringify({ type: 'user', isMeta: true, uuid: 'c1', timestamp: 't', message: { role: 'user', content: '<local-command-caveat>Caveat: ...</local-command-caveat>' } }),
  command: () => JSON.stringify({ type: 'user', uuid: 'c2', timestamp: 't', message: { role: 'user', content: '<command-name>/effort</command-name><command-args>ultracode</command-args>' } }),
  stdout: () => JSON.stringify({ type: 'user', uuid: 'c3', timestamp: 't', message: { role: 'user', content: '<local-command-stdout>Set effort level to ultracode</local-command-stdout>' } }),
  system: () => JSON.stringify({ type: 'system', uuid: 's1', timestamp: 't', content: 'Remote Control disconnected' }),
};
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
/** The same function run under `timeout` in a child bash that inherits only
 *  the function's text — the only way to prove a read does NOT block. */
const detectTimed = (fn: string, p: string): string =>
  h.sh(`timeout 5 bash -c "$(declare -f ${fn}); REDRIVE_TAIL_LINES=$REDRIVE_TAIL_LINES; ${fn} \\"\\$1\\"" _ ${JSON.stringify(p)} >/dev/null 2>&1; echo "rc=$?"`);

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
  itLinux('a FIFO at the path: rc 2 without blocking — `-r` alone would open it and wait for ever (D-2370)', () => {
    seed(); const f = path.join(h.home, 'fifo.jsonl'); execFileSync('mkfifo', [f]);
    expect(detectTimed('_transcript_limit_banner', f)).toBe('rc=2');
  });
  it("the detector's error literal is shared's RATE_LIMIT_ERROR — one bash copy, one TS copy, pinned", () => {
    const src = fs.readFileSync(CCD, 'utf8');
    const line = src.split('\n').find((l) => l.includes(`*'"isApiErrorMessage":true'*`) && l.includes('found="$line"'));
    if (!line) throw new Error('_transcript_limit_banner detector line not found in ccd/ccd');
    const m = /\*'"error":"([a-z_]+)"'\*/.exec(line);
    if (!m) throw new Error('no "error":"…" glob literal on the detector line');
    expect(m[1]).toBe(RATE_LIMIT_ERROR);
  });
});

describe('_transcript_stalled_pair pairs -f with -r (D-2370, closing D-2347)', () => {
  it('a directory at the path: rc 2', () => {
    seed(); const d = path.join(h.home, 'dir.jsonl'); fs.mkdirSync(d);
    expect(h.sh(`_transcript_stalled_pair ${JSON.stringify(d)}; echo "rc=$?"`)).toBe('rc=2');
  });
  itLinux('a FIFO at the path: rc 2 without blocking', () => {
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
    tmux() { echo "tmux $*" >> "$HOME/ccd-calls"; case "\${1:-}" in
      capture-pane) printf '%s\\n' ${JSON.stringify(pane)} ;; list-panes) echo 4242 ;; esac; return 0; };
    _pane_box_draft() { printf '%s' "\${BOX_DRAFT:-}"; };
    _swap_target() { echo ${target}; }; _avail() { return 0; };
    _dispatch_swap() { echo "dispatch $1 -> $2" >> "$HOME/ccd-calls"; };`;
  const dispatches = (): string[] => h.calls().filter((l) => l.startsWith('dispatch '));
  const swapLog = (): string => {
    const f = path.join(h.home, '.cc-sessions', 'swap.log');
    return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
  };
  const stranded = (): boolean => fs.existsSync(path.join(h.home, '.cc-sessions', `${ID}.stranded`));

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
  it('both call sites go through _session_hard_blocked (source pin)', () => {
    const src = fs.readFileSync(CCD, 'utf8');
    expect(src).toContain('_session_hard_blocked "$id" "$pane" && hard_blocked=1');
    expect(src).toContain('_session_hard_blocked "$1" "$pane" && blocked=1');
  });
});
