import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';

// D-2227 — Claude Code's interrupted-turn resume is env-gated
// (CLAUDE_CODE_RESUME_INTERRUPTED_TURN); ccd never set it, so every `--resume`
// after a swap wrote the synthetic "Continue from where you left off." pair and
// sat idle. These pin that every spawn line carries the flag and the prompt.

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-resume-flag-'); });
afterEach(() => { h.cleanup(); });

/** The `ccd-rc-flag.test.ts` spawn substrate: `new-session` raises a pane marker. */
const TMUX = `sleep() { :; };
  tmux() {
    echo "tmux $*" >> "$HOME/ccd-calls"
    case "$1" in
      new-session)  : > "$HOME/pane-up" ;;
      kill-session) rm -f "$HOME/pane-up" ;;
      has-session)  [[ -e "$HOME/pane-up" ]] ;;
      capture-pane) printf '%s' "\${PANE_TEXT:-? for shortcuts}" ;;
    esac
  };`;
/** A tmux whose `--resume` new-session leaves no pane, forcing the
 *  `--session-id` fallback line — the second spawn line must carry the flag too. */
const RESUME_DIES = `sleep() { :; };
  tmux() {
    echo "tmux $*" >> "$HOME/ccd-calls"
    case "$1" in
      new-session)  case "$*" in *--session-id*) : > "$HOME/pane-up" ;; esac ;;
      has-session)  [[ -e "$HOME/pane-up" ]] ;;
      list-sessions) return 0 ;;
    esac
  };`;
const newSessions = (): string[] => h.calls().filter((c) => c.startsWith('tmux new-session'));
const seed = (): void => {
  h.sh(`_reg_set myid wrapper claude
        _reg_set myid workdir '${h.home}'
        _reg_set myid uuid deadbeef-0000-4000-8000-000000000000`);
};

describe('the resume flag (D-2227)', () => {
  it('a resume spawn carries CLAUDE_CODE_RESUME_INTERRUPTED_TURN=1 and the prompt, before the wrapper', () => {
    seed();
    h.sh(`${TMUX} rm -f "$HOME/pane-up"; _spawn_start myid resume`);
    const line = newSessions()[0]!;
    expect(line).toContain('CLAUDE_CODE_RESUME_INTERRUPTED_TURN=1');
    expect(line).toContain("CLAUDE_CODE_RESUME_PROMPT='Continue from where you left off.");
    expect(line.indexOf('CLAUDE_CODE_RESUME_INTERRUPTED_TURN=1')).toBeLessThan(line.indexOf('/.local/bin/claude'));
    expect(line).not.toContain('CLAUDE_CODE_RESUME_INTERRUPTED_TURN_MAX_AGE_MS');
  });

  it('a new spawn carries it too — one spawn shape, the transcript decides', () => {
    seed();
    h.sh(`${TMUX} rm -f "$HOME/pane-up"; _spawn_start myid new`);
    expect(newSessions()[0]).toContain('CLAUDE_CODE_RESUME_INTERRUPTED_TURN=1');
  });

  it('the --session-id fallback line carries it as well', () => {
    seed();
    h.sh(`${RESUME_DIES} rm -f "$HOME/pane-up"; _spawn_start myid resume 2>/dev/null`);
    const news = newSessions();
    expect(news).toHaveLength(2);
    expect(news[1]).toContain('--session-id');
    expect(news[1]).toContain('CLAUDE_CODE_RESUME_INTERRUPTED_TURN=1');
  });

  it('RESUME_REDRIVE_MAX_AGE_MS, when set, rides as CLAUDE_CODE_RESUME_INTERRUPTED_TURN_MAX_AGE_MS (D-2230)', () => {
    seed();
    h.sh(`${TMUX} RESUME_REDRIVE_MAX_AGE_MS=3600000; rm -f "$HOME/pane-up"; _spawn_start myid resume`);
    expect(newSessions()[0]).toContain('CLAUDE_CODE_RESUME_INTERRUPTED_TURN_MAX_AGE_MS=3600000');
  });

  it('the prompt has no single quote (it is single-quoted into the tmux command) and starts with the sentence Claude Code matches', () => {
    const p = h.sh(`printf '%s' "$RESUME_PROMPT"`);
    expect(p).not.toContain("'");
    expect(p.startsWith('Continue from where you left off.')).toBe(true);
    expect(p).toContain('ccd restarted this session');
  });
});
