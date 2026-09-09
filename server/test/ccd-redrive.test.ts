import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-redrive-'); });
afterEach(() => { h.cleanup(); });

/** tmux, RECORDING: `capture-pane` answers `$PANE_TEXT`, everything else is logged. */
const STUBS = `sleep() { :; };
  tmux() { echo "tmux $*" >> "$HOME/ccd-calls";
    case "\${1:-}" in capture-pane) printf '%s\\n' "\${PANE_TEXT:-}" ;; esac; return 0; };
  _pane_box_draft() { printf '%s' "\${BOX_DRAFT:-}"; };`;
const sendKeys = (): string[] => h.calls().filter((l) => l.includes('send-keys'));
const READY = '? for shortcuts\n❯ ';
const ARMED = 'Usage limit reached · continuing automatically at 11:50am · esc or type to cancel\n❯ ';

describe('_inject_spawn_effort stands down on an armed auto-continue (D-2229)', () => {
  it('types nothing into a session waiting out a limit', () => {
    h.sh(`${STUBS} _inject_spawn_effort cc-test`, { PANE_TEXT: ARMED });
    expect(sendKeys()).toEqual([]);
  });
  it('control: a ready pane gets /effort', () => {
    h.sh(`${STUBS} _inject_spawn_effort cc-test`, { PANE_TEXT: READY });
    expect(sendKeys().some((k) => k.includes('-l /effort'))).toBe(true);
  });
});

describe('_pane_auto_continue_armed', () => {
  it.each([
    ['continuing automatically at 11:50am', true],
    ['Usage limit reached · continuing shortly · esc to cancel', true],
    ['Usage limit reached · continuing automatically when it resets · esc to cancel', true],
    ["You've hit your session limit · resets 11:50am (UTC)", false],
    ['? for shortcuts', false],
  ])('%s -> %s', (pane, armed) => {
    const out = h.sh(`_pane_auto_continue_armed ${JSON.stringify(pane)} && echo yes || echo no`);
    expect(out).toBe(armed ? 'yes' : 'no');
  });
});

// — the fallback re-drive (D-2231, D-2237) —
const ID = 'myid';
const UUID = 'deadbeef-0000-4000-8000-000000000000';
const seed = (): void => {
  h.sh(`_reg_set ${ID} wrapper claude
        _reg_set ${ID} workdir "$HOME/projects/demo"
        _reg_set ${ID} uuid ${UUID}`);
  fs.mkdirSync(path.join(h.home, 'projects', 'demo'), { recursive: true });
};
/** Compact JSONL, the shape Claude Code writes (no spaces after colons). */
const L = {
  metaPrompt: (text = 'Continue from where you left off.') => JSON.stringify({
    parentUuid: 'p', isSidechain: false, type: 'user',
    message: { role: 'user', content: [{ type: 'text', text }] }, isMeta: true, uuid: 'm1', timestamp: '2026-09-09T11:25:31.906Z',
  }),
  synthetic: () => JSON.stringify({
    parentUuid: 'm1', isSidechain: false, type: 'assistant', uuid: 'a1', timestamp: '2026-09-09T11:25:31.906Z',
    message: { model: '<synthetic>', role: 'assistant', content: [{ type: 'text', text: 'No response requested.' }] },
  }),
  realAssistant: () => JSON.stringify({
    parentUuid: 'm1', isSidechain: false, type: 'assistant', uuid: 'a2', timestamp: '2026-09-09T11:25:40.000Z',
    message: { model: 'claude-fable-5-1', role: 'assistant', content: [{ type: 'text', text: 'Resuming the workflow.' }] },
  }),
  humanPrompt: () => JSON.stringify({
    parentUuid: 'a1', isSidechain: false, type: 'user', uuid: 'u9', timestamp: '2026-09-09T11:52:45.000Z',
    message: { role: 'user', content: 'resume' },
  }),
  caveat: () => JSON.stringify({ type: 'user', isMeta: true, uuid: 'c1', timestamp: 't', message: { role: 'user', content: '<local-command-caveat>Caveat: ...</local-command-caveat>' } }),
  command: () => JSON.stringify({ type: 'user', uuid: 'c2', timestamp: 't', message: { role: 'user', content: '<command-name>/effort</command-name><command-args>ultracode</command-args>' } }),
  stdout: () => JSON.stringify({ type: 'user', uuid: 'c3', timestamp: 't', message: { role: 'user', content: '<local-command-stdout>Set effort level to ultracode</local-command-stdout>' } }),
  system: () => JSON.stringify({ type: 'system', uuid: 's1', timestamp: 't', content: 'Remote Control disconnected' }),
  attachment: () => JSON.stringify({ type: 'attachment', uuid: 'at1', timestamp: 't', attachment: { type: 'x' } }),
  banner: () => JSON.stringify({ type: 'assistant', uuid: 'b1', isApiErrorMessage: true, error: 'rate_limit', timestamp: 't', message: { model: '<synthetic>', role: 'assistant', content: [{ type: 'text', text: "You've hit your session limit · resets 11:50am (UTC)" }] } }),
};
const writeTranscript = (lines: string[]): string => {
  const p = h.sh(`_transcript_path ${ID}`);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, lines.join('\n') + '\n');
  return p;
};
const swapLog = (): string => {
  const f = path.join(h.home, '.cc-sessions', 'swap.log');
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
};
const redrive = (env: Record<string, string> = {}): string[] => {
  h.sh(`${STUBS} _redrive_after_spawn ${ID} cc-test`, { PANE_TEXT: READY, ...env });
  return sendKeys();
};
const typedPrompt = (keys: string[]): boolean =>
  keys.some((k) => k.startsWith('tmux send-keys -t cc-test -l Continue from where you left off.'))
  && keys.some((k) => k === 'tmux send-keys -t cc-test Enter');

describe('_transcript_stalled_pair', () => {
  const rc = (lines: string[]): number => {
    const p = writeTranscript(lines);
    return Number(h.sh(`_transcript_stalled_pair '${p}'; echo "rc=$?"`).match(/rc=(\d)/)![1]);
  };
  beforeEach(seed);
  it('the pair at the tail is a stall', () => {
    expect(rc([L.banner(), L.metaPrompt(), L.synthetic()])).toBe(0);
  });
  it('local-command chatter, system lines and attachments after the pair do not un-stall it', () => {
    expect(rc([L.banner(), L.metaPrompt(), L.synthetic(), L.attachment(), L.caveat(), L.command(), L.stdout(), L.system()])).toBe(0);
  });
  it('a real assistant entry after the pair means the flag drove it', () => {
    expect(rc([L.banner(), L.metaPrompt(), L.synthetic(), L.realAssistant()])).toBe(1);
  });
  it('a submitted prompt (META, then a real reply) is not a stall', () => {
    expect(rc([L.banner(), L.metaPrompt(), L.realAssistant()])).toBe(1);
  });
  it('a human prompt after the pair means a person handled it', () => {
    expect(rc([L.banner(), L.metaPrompt(), L.synthetic(), L.humanPrompt()])).toBe(1);
  });
  it('a prompt that is not META is a human, not the harness', () => {
    const notMeta = L.metaPrompt().replace('"isMeta":true', '"isMeta":false');
    expect(rc([L.banner(), notMeta, L.synthetic()])).toBe(1);
  });
  it('an unreadable path is 2, not 1', () => {
    expect(Number(h.sh(`_transcript_stalled_pair "$HOME/nope.jsonl"; echo "rc=$?"`).match(/rc=(\d)/)![1])).toBe(2);
  });
});

describe('_redrive_after_spawn', () => {
  beforeEach(seed);
  it('types the prompt when the tail is the unsubmitted pair, and logs redrive', () => {
    writeTranscript([L.banner(), L.metaPrompt(), L.synthetic()]);
    expect(typedPrompt(redrive())).toBe(true);
    expect(swapLog()).toMatch(/ redrive myid: /);
  });
  it('types nothing when the flag drove the turn', () => {
    writeTranscript([L.banner(), L.metaPrompt(), L.realAssistant()]);
    expect(redrive()).toEqual([]);
    expect(swapLog()).toBe('');
  });
  it('types nothing while a turn is running (the pane says esc to interrupt)', () => {
    writeTranscript([L.banner(), L.metaPrompt(), L.synthetic()]);
    expect(redrive({ PANE_TEXT: 'thinking… esc to interrupt' })).toEqual([]);
  });
  it('types nothing into an armed auto-continue, and says so', () => {
    writeTranscript([L.banner(), L.metaPrompt(), L.synthetic()]);
    expect(redrive({ PANE_TEXT: ARMED })).toEqual([]);
    expect(swapLog()).toMatch(/ redrive-skip myid: auto-continue armed/);
  });
  it('types nothing over a hard-blocked pane, and says so', () => {
    writeTranscript([L.banner(), L.metaPrompt(), L.synthetic()]);
    expect(redrive({ PANE_TEXT: '5-hour limit reached · resets 3pm\n❯ ' })).toEqual([]);
    expect(swapLog()).toMatch(/ redrive-skip myid: hard-blocked pane/);
  });
  it('re-measures after the wait: a turn that starts in the final second is not typed into', () => {
    // capture-pane answers READY for every call the loop makes, then 'esc to interrupt'
    // on the one re-measurement call after the loop — the race the loop's own last check
    // (one second earlier) cannot see.
    writeTranscript([L.banner(), L.metaPrompt(), L.synthetic()]);
    const RACE_STUBS = `sleep() { :; };
      tmux() { echo "tmux $*" >> "$HOME/ccd-calls";
        case "\${1:-}" in capture-pane)
          n=$(cat "$HOME/pane-calls" 2>/dev/null || echo 0); echo $((n+1)) > "$HOME/pane-calls";
          if [[ "$n" -ge 20 ]]; then printf '%s\\n' 'thinking… esc to interrupt'; else printf '%s\\n' "\${PANE_TEXT:-}"; fi ;;
        esac; return 0; };
      _pane_box_draft() { printf '%s' "\${BOX_DRAFT:-}"; };`;
    h.sh(`${RACE_STUBS} _redrive_after_spawn ${ID} cc-test`, { PANE_TEXT: READY });
    expect(sendKeys()).toEqual([]);
  });
  it('types nothing over a draft in the box, and says so', () => {
    writeTranscript([L.banner(), L.metaPrompt(), L.synthetic()]);
    expect(redrive({ BOX_DRAFT: 'half-typed' })).toEqual([]);
    expect(swapLog()).toMatch(/ redrive-skip myid: input box not empty/);
  });
  it('types nothing when there is no transcript', () => {
    expect(redrive()).toEqual([]);
    expect(swapLog()).toBe('');
  });
});

describe('_spawn_settle calls the re-drive after the effort injection (the wiring)', () => {
  beforeEach(seed);
  const SETTLE = `${STUBS}
    _accept_first_run_prompts() { return \${ACCEPT_RC:-0}; };
    _inject_spawn_effort() { echo "effort $1" >> "$HOME/ccd-calls"; };
    _lc_done() { :; };`;
  it('on a clean landing the re-drive runs, after /effort', () => {
    writeTranscript([L.banner(), L.metaPrompt(), L.synthetic()]);
    h.sh(`${SETTLE} _spawn_settle ${ID} 1`, { PANE_TEXT: READY });
    const calls = h.calls();
    // The target here is `_tmux myid`, not `cc-test` — match on the typed text alone.
    expect(calls.findIndex((c) => c.startsWith('effort '))).toBeLessThan(calls.findIndex((c) => c.includes('-l Continue from where')));
    expect(sendKeys().some((k) => k.includes('-l Continue from where you left off.'))).toBe(true);
    expect(sendKeys().some((k) => k.endsWith(' Enter'))).toBe(true);
  });
  it('a landing that is not clean (rc 5, hard-blocked) is not re-driven', () => {
    writeTranscript([L.banner(), L.metaPrompt(), L.synthetic()]);
    h.sh(`${SETTLE} _spawn_settle ${ID} 1; :`, { PANE_TEXT: READY, ACCEPT_RC: '5' });
    expect(sendKeys()).toEqual([]);
  });
});
