// A limit-blocked session whose class window is undecidable drops the class gate rather than strand (D-8123,
// limit-swap-autofix Task 4).
//
// `_swap_target` answers rc 5 ("nobody can say") when the session has a standing class and a candidate's class window
// could not be measured. For a session that is not blocked that is right: it stands still and says `classwindow`. For
// one a limit banner has stopped, standing still IS the strand, written on a fact nobody measured. So the rescue arm of
// `_auto_swap_check` retries once with `CCD_CLASS_GATE_OFF=1` (read by `_swap_target` as "no class") when the verdict
// is rc 5 and the session is hard-blocked. With a destination it logs `class-gate-dropped` and takes the normal rescue
// path; with none it strands as before. A session that is not blocked is unchanged.
//
// FIXTURE HOME ONLY (`makeCcdHarness`): tmux, `_dispatch_swap`, `_route_peek_to` and `_class_gate` are shell functions.
// Neutral ids: the session `lane-a-project-a`, the fixture roster's wrappers. Nothing here reaches a pane.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, type CcdHarness, WIDE_PANE } from './ccdWsHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-classwindow-drop-'); });
afterEach(() => { h.cleanup(); });

const ID = 'lane-a-project-a';
const UUID = 'a0000000-0000-4000-8000-0000000000f4';
const now = (): number => Math.floor(Date.now() / 1000);
const iso = (epoch: number): string => new Date(epoch * 1000).toISOString();
const PROMPT = '? for shortcuts\n❯ ';

const seed = (): void => {
  h.sh(`_reg_set ${ID} wrapper claude
        _reg_set ${ID} home claude
        _reg_set ${ID} project project-a
        _reg_set ${ID} workdir "$HOME/projects/project-a"
        _reg_set ${ID} uuid ${UUID}
        _reg_set ${ID} started 1`);
  fs.mkdirSync(path.join(h.home, 'projects', 'project-a'), { recursive: true });
  const t = now();
  fs.mkdirSync(path.join(h.home, '.cc-limits'), { recursive: true });
  for (const [w, five] of [['claude', 100], ['claude-a', 10]] as const) {
    fs.writeFileSync(path.join(h.home, '.cc-limits', `${w}.json`),
      JSON.stringify({ five, seven: 5, ts: t, fiveResetAt: t + 10000, sevenResetAt: t + 400000 }));
  }
};
const limitRow = (at: number): string => JSON.stringify({
  parentUuid: 'p', isSidechain: false, type: 'assistant', uuid: `b${at}`, timestamp: iso(at),
  message: { model: '<synthetic>', role: 'assistant', content: [{ type: 'text', text: "You've hit your session limit · resets 9:10pm (UTC)" }] },
  isApiErrorMessage: true, error: 'rate_limit', apiErrorStatus: 429,
  quotaLimits: { status: 'rejected', resetsAt: at + 9000, rateLimitType: 'five_hour' },
});
const writeTranscript = (lines: string[]): void => {
  const p = h.sh(`_transcript_path ${ID}`);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, lines.join('\n') + '\n');
};
const blockNow = (): void => { writeTranscript([limitRow(now() - 5)]); };

/** The session has a standing class, and its class window is unmeasured on every lane (`_class_gate` rc 2) unless the
 *  class is dropped (empty class: nothing to gate on, rc 0). */
const CLASS_UNMEASURED = `_route_peek_to() { printf -v "$1" ''; [[ "$3" == class ]] && printf -v "$1" opus; return 0; };
  _class_gate() { [[ -z "\${2:-}" ]] && return 0; return 2; };`;

/** tmux answers one pane; the dispatch LOGS (and lands, as the detached `cmd_swap` does). The real `_swap_target`. */
const tick = (pane: string, extra = ''): void => {
  fs.writeFileSync(path.join(h.home, 'pane.txt'), pane + '\n');
  h.sh(`tmux() { echo "tmux $*" >> "$HOME/ccd-calls"; ${WIDE_PANE} case "\${1:-}" in
      capture-pane) cat "$HOME/pane.txt" ;; list-panes) echo 4242 ;;
      display-message) [ -n "\${TMUX_CREATED:-}" ] && echo "$TMUX_CREATED" ;; esac; return 0; };
    _pane_box_draft() { printf ''; };
    _dispatch_swap() { echo "dispatch $1 -> $2 $3" >> "$HOME/ccd-calls"; };
    ${extra}
    _auto_swap_check ${ID}`, { TMUX_CREATED: String(now() - 86400) });
};
const regFile = (f: string): string => path.join(h.home, '.cc-sessions', f);
const swapLog = (): string => (fs.existsSync(regFile('swap.log')) ? fs.readFileSync(regFile('swap.log'), 'utf8') : '');
const lines = (word: string): string[] => swapLog().split('\n').filter((l) => l.includes(` ${word} `));
const dispatches = (): string[] => h.calls().filter((l) => l.startsWith('dispatch '));
const keystrokes = (): string[] => h.calls().filter((l) => l.startsWith('tmux send-keys'));

describe('a limit-blocked session with an undecidable class window', () => {
  it('hard-blocked and the class window undecidable: rescued without the class gate, never stranded', () => {
    seed(); blockNow();
    tick(PROMPT, CLASS_UNMEASURED);
    expect(lines('class-gate-dropped')).toHaveLength(1);
    expect(lines('class-gate-dropped')[0]).toContain(`class-gate-dropped ${ID}: class window undecidable; rescuing without the class gate`);
    expect(dispatches()).toEqual([`dispatch ${ID} -> claude-a rescue`]);
    expect(lines('auto-rescue')).toHaveLength(1);
    expect(fs.existsSync(regFile(`${ID}.stranded`))).toBe(false);
    expect(lines('tick-undecidable')).toEqual([]);
    expect(keystrokes()).toEqual([]);
  });

  it('hard-blocked, class window undecidable and nobody has room even without the gate: stranded as today', () => {
    seed(); blockNow();
    fs.writeFileSync(path.join(h.home, '.cc-limits', 'claude-a.json'), JSON.stringify({ five: 100, seven: 100, ts: now() }));
    for (const w of ['claude-b', 'claude-d']) fs.writeFileSync(path.join(h.home, '.cc-limits', `${w}.json`), JSON.stringify({ five: 100, seven: 100, ts: now() }));
    tick(PROMPT, CLASS_UNMEASURED);
    expect(lines('class-gate-dropped')).toEqual([]);
    expect(dispatches()).toEqual([]);
    expect(fs.existsSync(regFile(`${ID}.stranded`))).toBe(true);
  });

  it('kept: not blocked and the class window undecidable: tick-undecidable classwindow, no move', () => {
    seed();
    fs.writeFileSync(path.join(h.home, '.cc-limits', 'claude.json'), JSON.stringify({ five: 10, seven: 5, ts: now() }));   // home recovered: the return home asks the class
    tick(PROMPT, CLASS_UNMEASURED);
    expect(lines('class-gate-dropped')).toEqual([]);
    expect(dispatches()).toEqual([]);
    expect(lines('tick-undecidable').join('\n')).toContain(`tick-undecidable ${ID}: classwindow`);
    expect(fs.existsSync(regFile(`${ID}.stranded`))).toBe(false);
  });
});
