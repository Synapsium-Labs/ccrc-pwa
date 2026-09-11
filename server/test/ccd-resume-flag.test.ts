import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import { RESUME_PROMPT_PREFIX } from '../../shared/api.js';
import { makeCcdHarness, CCD, type CcdHarness } from './ccdWsHelpers.js';

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

/** D-2228 — the fourth of the four independent copies of the resume sentence
 *  (finding: shared↔ccd↔detector↔this-test each held their own literal, so
 *  editing `RESUME_PROMPT_PREFIX` alone left every one of them green). Read
 *  `_transcript_stalled_pair`'s own glob literal FROM SOURCE — never retype
 *  it — so this test tracks ccd's copy instead of silently drifting from it.
 *  The line is found by its STRUCTURAL markers (the `"isMeta":true` glob
 *  clause and the `state=1` transition), not by the sentence itself. */
const detectorLiteral = (): string => {
  const src = fs.readFileSync(CCD, 'utf8');
  const line = src.split('\n').find((l) => l.includes(`*'"isMeta":true'*`) && l.includes('then state=1; continue; fi'));
  if (!line) throw new Error('_transcript_stalled_pair detector line not found in ccd/ccd');
  const literals = [...line.matchAll(/\*'([^']*)'\*/g)].map((m) => m[1]!);
  if (literals.length !== 2) throw new Error(`expected 2 glob literals ("isMeta":true, the sentence) on the detector line, found ${literals.length}`);
  return literals[1]!;
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

  it('the prompt has no single quote (it is single-quoted into the tmux command) and starts with RESUME_PROMPT_PREFIX — what the PWA parser matches (D-2228)', () => {
    const p = h.sh(`printf '%s' "$RESUME_PROMPT"`);
    expect(p).not.toContain("'");
    expect(p.startsWith(RESUME_PROMPT_PREFIX)).toBe(true);
    expect(p).toContain('ccd restarted this session');
  });

  it("the stall detector's own copy of the sentence (ccd/ccd, `_transcript_stalled_pair`) is a prefix of both RESUME_PROMPT_PREFIX and RESUME_PROMPT — closing the coupling's fourth literal (D-2228)", () => {
    const literal = detectorLiteral();
    expect(RESUME_PROMPT_PREFIX.startsWith(literal)).toBe(true);
    const p = h.sh(`printf '%s' "$RESUME_PROMPT"`);
    expect(p.startsWith(literal)).toBe(true);
  });
});
