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
