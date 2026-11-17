// `_swap_target` breaks a load tie toward the session's current organization (account organization plan, Task C1,
// slugs `org-tie-break-only` and `unknown-org-is-no-preference`). Organization decides only between EQUAL scores
// inside one bracket: it never beats a lower score, never moves a candidate across the home-able/overflow brackets,
// and never touches the stay rules or the return home. An unlabelled current account relates `unknown` to every
// candidate, so its pick is today's, byte for byte (the CONTROL below and `ccd-swap-target-class.test.ts`).
//
// The rescue's record carries the evidence for the plan's §9 question: `meas.org`, the landing's relation to the
// account it left, and `meas.orgnear`, the lowest score of a `same` candidate that lost to a lower-scored `other`
// one. `_swap_target` runs in a command substitution, so it hands `orgnear` back as a second stdout line, and only
// when the caller asks (`CCD_ORGNEAR_ASK`, set by the rescue sites); every other caller reads one line, as before.
//
// FIXTURE HOME ONLY (`makeCcdHarness`). Neutral ids: the session `lane-a-project-a`, the fixture roster's wrappers
// (`claude`, `claude-a`, `claude-b`, `gpt`, `claude-d`, in that roster order) and the labels `org-a` and `org-b`.
// Nothing here reaches a real pane, so no key can be sent.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, seedAccountsSh, WIDE_PANE, type CcdHarness } from './ccdWsHelpers.js';
import { DEFAULT_TEST_ROSTER } from './helpers/roster.js';
import { eventsOf, measOf } from './lifecycleHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-swap-org-'); });
afterEach(() => { h.cleanup(); });

const ID = 'lane-a-project-a';
const UUID = 'a0000000-0000-4000-8000-0000000000c1';
const PANE_PID = '4242';
const T0 = Math.floor(Date.now() / 1000);

/** The fixture roster with organization labels, and optionally some accounts made non-home-able (an overflow lane). */
const orgRoster = (orgs: Record<string, string>, overflow: readonly string[] = []): unknown => ({
  ...DEFAULT_TEST_ROSTER,
  accounts: DEFAULT_TEST_ROSTER.accounts.map((a) => ({
    ...a,
    ...(orgs[a.id] !== undefined ? { org: orgs[a.id] } : {}),
    ...(overflow.includes(a.id) ? { homeAble: false } : {}),
  })),
});
const labels = (orgs: Record<string, string>, overflow: readonly string[] = []): void =>
  seedAccountsSh(h.home, orgRoster(orgs, overflow));

const seed = (wrapper: string, home: string): void => {
  const wd = path.join(h.home, 'projects', 'project-a');
  fs.mkdirSync(wd, { recursive: true });
  h.sh(`_reg_set ${ID} wrapper ${wrapper}
        _reg_set ${ID} home ${home}
        _reg_set ${ID} project project-a
        _reg_set ${ID} workdir ${wd}
        _reg_set ${ID} uuid ${UUID}
        _reg_set ${ID} started 1`);
};
/** `~/.cc-limits/<w>.json`: both windows measured, a fresh `ts`. */
const limits = (w: string, five: number, seven: number): void => {
  fs.mkdirSync(path.join(h.home, '.cc-limits'), { recursive: true });
  fs.writeFileSync(path.join(h.home, '.cc-limits', `${w}.json`), JSON.stringify({ five, seven, ts: T0 }));
};
/** An installed wrapper for a lane the harness does not install (the overflow lanes). */
const installWrapper = (w: string): void => {
  const bin = path.join(h.home, '.local', 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, w), '#!/bin/sh\n', { mode: 0o755 });
};
const ENV = { FAKE_NOW: String(T0), TMUX: '' };
/** `_swap_target id cur home force hrc` → its stdout lines joined by `|`, then ` rc=N`. */
const target = (cur: string, home: string, force: string, ask = ''): string =>
  h.sh(`out=$(CCD_ORGNEAR_ASK='${ask}' _swap_target ${ID} ${cur} ${home} '${force}' 0); rc=$?; `
    + `printf '%s rc=%s' "\${out//$'\\n'/|}" "$rc"`, ENV);

// The rescue's starting shape: the session is on `claude-a` (forced off it), its home `claude` is full, and the
// loop ranks `claude-b` and `claude-d`; `gpt` has no installed wrapper, so `_account_ok` drops it.
const blockedAway = (): void => { seed('claude-a', 'claude'); limits('claude-a', 100, 100); limits('claude', 100, 100); };

describe('the tie-break: organization decides only between equal scores', () => {
  it('two candidates at an equal score: the `same` one wins over the earlier-listed `other` one', () => {
    labels({ 'claude-a': 'org-a', 'claude-b': 'org-b', 'claude-d': 'org-a' });
    blockedAway(); limits('claude-b', 30, 30); limits('claude-d', 30, 30);
    expect(target('claude-a', 'claude', '1')).toBe('claude-d rc=0');
  });

  it('a lower-scored `other` candidate beats a higher-scored `same` one: organization never overrides load', () => {
    labels({ 'claude-a': 'org-a', 'claude-b': 'org-b', 'claude-d': 'org-a' });
    blockedAway(); limits('claude-b', 20, 20); limits('claude-d', 30, 30);
    expect(target('claude-a', 'claude', '1')).toBe('claude-b rc=0');
  });

  it('two `same` candidates at an equal score: the earlier listed, as today', () => {
    labels({ 'claude-a': 'org-a', 'claude-b': 'org-a', 'claude-d': 'org-a' });
    blockedAway(); limits('claude-b', 30, 30); limits('claude-d', 30, 30);
    expect(target('claude-a', 'claude', '1')).toBe('claude-b rc=0');
  });

  it('a `same` overflow lane never beats a home-able one, even at a lower score', () => {
    labels({ 'claude-a': 'org-a', 'claude-b': 'org-b', gpt: 'org-a' });
    installWrapper('gpt');
    seed('claude-a', 'claude'); limits('claude-a', 100, 100); limits('claude', 100, 100); limits('claude-d', 100, 100);
    limits('claude-b', 40, 40); limits('gpt', 10, 10);
    expect(target('claude-a', 'claude', '1')).toBe('claude-b rc=0');
  });

  it('the tie breaks inside the overflow bracket too', () => {
    // `claude-d` made an overflow lane beside `gpt`; every home-able lane is full, so only the overflow bracket ranks.
    labels({ 'claude-a': 'org-a', gpt: 'org-b', 'claude-d': 'org-a' }, ['claude-d']);
    installWrapper('gpt');
    seed('claude-a', 'claude'); limits('claude-a', 100, 100); limits('claude', 100, 100); limits('claude-b', 100, 100);
    limits('gpt', 30, 30); limits('claude-d', 30, 30);
    expect(target('claude-a', 'claude', '1')).toBe('claude-d rc=0');
  });

  it('a lower-scored `other` overflow lane beats a higher-scored `same` one: load first in the overflow bracket too', () => {
    // The overflow twin of the home-able case above, so a tie test moved ahead of the score in that bracket alone is red.
    labels({ 'claude-a': 'org-a', gpt: 'org-b', 'claude-d': 'org-a' }, ['claude-d']);
    installWrapper('gpt');
    seed('claude-a', 'claude'); limits('claude-a', 100, 100); limits('claude', 100, 100); limits('claude-b', 100, 100);
    limits('gpt', 20, 20); limits('claude-d', 30, 30);
    expect(target('claude-a', 'claude', '1')).toBe('gpt rc=0');
  });

  it('the tie breaks between two unmeasured candidates (rank 100) as well', () => {
    labels({ 'claude-a': 'org-a', 'claude-b': 'org-b', 'claude-d': 'org-a' });
    blockedAway();   // claude-b and claude-d: no telemetry, both rank 100
    expect(target('claude-a', 'claude', '1')).toBe('claude-d rc=0');
  });
});

describe('unknown is no preference', () => {
  it('an unlabelled current account picks by roster order, exactly as before', () => {
    labels({ 'claude-b': 'org-b', 'claude-d': 'org-a' });
    blockedAway(); limits('claude-b', 30, 30); limits('claude-d', 30, 30);
    expect(target('claude-a', 'claude', '1')).toBe('claude-b rc=0');
  });

  it('an unlabelled candidate never wins a tie over a `same` one', () => {
    labels({ 'claude-a': 'org-a', 'claude-d': 'org-a' });   // claude-b unlabelled, listed first
    blockedAway(); limits('claude-b', 30, 30); limits('claude-d', 30, 30);
    expect(target('claude-a', 'claude', '1')).toBe('claude-d rc=0');
  });

  it('an unlabelled candidate never loses a tie to an `other` one: roster order decides', () => {
    labels({ 'claude-a': 'org-a', 'claude-d': 'org-b' });   // claude-b unlabelled, listed first
    blockedAway(); limits('claude-b', 30, 30); limits('claude-d', 30, 30);
    expect(target('claude-a', 'claude', '1')).toBe('claude-b rc=0');
  });

  it('an `other` candidate never wins a tie over an earlier unlabelled one either way round', () => {
    labels({ 'claude-a': 'org-a', 'claude-b': 'org-b' });   // claude-d unlabelled, listed last
    blockedAway(); limits('claude-b', 30, 30); limits('claude-d', 30, 30);
    expect(target('claude-a', 'claude', '1')).toBe('claude-b rc=0');
  });
});

describe('home is returned to whatever its organization', () => {
  it('unforced: a recovered home in another organization is the answer, ahead of a `same` lane with room', () => {
    labels({ claude: 'org-b', 'claude-a': 'org-a', 'claude-d': 'org-a' });
    seed('claude-a', 'claude'); limits('claude-a', 100, 100); limits('claude', 10, 10); limits('claude-d', 10, 10);
    expect(target('claude-a', 'claude', '')).toBe('claude rc=0');
  });

  it('forced: a measured recovered home in another organization is the answer, before the loop', () => {
    labels({ claude: 'org-b', 'claude-a': 'org-a', 'claude-d': 'org-a' });
    seed('claude-a', 'claude'); limits('claude-a', 100, 100); limits('claude', 30, 30); limits('claude-d', 10, 10);
    expect(target('claude-a', 'claude', '1')).toBe('claude rc=0');
  });
});

describe('orgnear: the near miss, asked for by the rescue sites only', () => {
  it('a `same` candidate that lost to a lower-scored `other` one: its score, on a second line', () => {
    labels({ 'claude-a': 'org-a', 'claude-b': 'org-b', 'claude-d': 'org-a' });
    blockedAway(); limits('claude-b', 20, 20); limits('claude-d', 40, 40);
    expect(target('claude-a', 'claude', '1', '1')).toBe('claude-b|orgnear=40 rc=0');
  });

  it('the lowest such score when several `same` candidates lost', () => {
    // At home and forced off it, so the loop ranks all three other lanes.
    labels({ 'claude-a': 'org-a', 'claude-b': 'org-b', claude: 'org-a', 'claude-d': 'org-a' });
    seed('claude-a', 'claude-a'); limits('claude-a', 100, 100);
    limits('claude', 60, 60); limits('claude-b', 20, 20); limits('claude-d', 40, 40);
    expect(target('claude-a', 'claude-a', '1', '1')).toBe('claude-b|orgnear=40 rc=0');
  });

  it('not asked: one line, whatever the near miss', () => {
    labels({ 'claude-a': 'org-a', 'claude-b': 'org-b', 'claude-d': 'org-a' });
    blockedAway(); limits('claude-b', 20, 20); limits('claude-d', 40, 40);
    expect(target('claude-a', 'claude', '1')).toBe('claude-b rc=0');
  });

  it('no line when the landing is `same`, or when nothing `same` lost', () => {
    labels({ 'claude-a': 'org-a', 'claude-b': 'org-a', 'claude-d': 'org-b' });
    blockedAway(); limits('claude-b', 20, 20); limits('claude-d', 40, 40);
    expect(target('claude-a', 'claude', '1', '1')).toBe('claude-b rc=0');
    limits('claude-b', 40, 40); limits('claude-d', 20, 20);
    labels({ 'claude-a': 'org-a', 'claude-b': 'org-b', 'claude-d': 'org-b' });
    expect(target('claude-a', 'claude', '1', '1')).toBe('claude-d rc=0');
    // and the near miss itself, for contrast: `claude-b` at 40 relates `same` and lost to `other` at 20
    labels({ 'claude-a': 'org-a', 'claude-b': 'org-a', 'claude-d': 'org-b' });
    expect(target('claude-a', 'claude', '1', '1')).toBe('claude-d|orgnear=40 rc=0');
  });

  it('no line when an unlabelled winner beat a `same` loser: only an `other` landing is a near miss', () => {
    labels({ 'claude-a': 'org-a', 'claude-d': 'org-a' });   // claude-b unlabelled
    blockedAway(); limits('claude-b', 20, 20); limits('claude-d', 40, 40);
    expect(target('claude-a', 'claude', '1', '1')).toBe('claude-b rc=0');
  });

  it('no line when the losing candidate is only unlabelled: an unknown organization is no near miss', () => {
    labels({ 'claude-a': 'org-a', 'claude-b': 'org-b' });   // claude-d unlabelled
    blockedAway(); limits('claude-b', 20, 20); limits('claude-d', 40, 40);
    expect(target('claude-a', 'claude', '1', '1')).toBe('claude-b rc=0');
  });
});

describe('the labels are read once per call, whatever they hold', () => {
  it('a rescue-asked call with ties and several `same` losers reads each roster label exactly once', () => {
    // Every candidate here asks a question (asked calls note each `same` score, and two pairs tie), so a table that
    // were not kept would be read again for each.
    labels({ 'claude-a': 'org-a', claude: 'org-a', 'claude-b': 'org-b', 'claude-d': 'org-a' });
    seed('claude-a', 'claude-a'); limits('claude-a', 100, 100);
    limits('claude', 40, 40); limits('claude-b', 20, 20); limits('claude-d', 40, 40);
    const out = h.sh(`_acct_org() { echo "$1" >> "$HOME/org-reads"; declare -F _ccrc_org >/dev/null 2>&1 && _ccrc_org "$1"; return 0; }
      out=$(CCD_ORGNEAR_ASK=1 _swap_target ${ID} claude-a claude-a 1 0); printf '%s' "\${out//$'\\n'/|}"`, ENV);
    expect(out).toBe('claude-b|orgnear=40');
    const reads = fs.readFileSync(path.join(h.home, 'org-reads'), 'utf8').split('\n').filter(Boolean).sort();
    expect(reads).toEqual(DEFAULT_TEST_ROSTER.accounts.map((a) => a.id).sort());
  });
});

describe('CONTROL: with no labels at all, every answer is today\'s', () => {
  beforeEach(() => { seedAccountsSh(h.home); });

  it('a tie goes to roster order, and asking adds no line', () => {
    blockedAway(); limits('claude-b', 30, 30); limits('claude-d', 30, 30);
    expect(target('claude-a', 'claude', '1')).toBe('claude-b rc=0');
    expect(target('claude-a', 'claude', '1', '1')).toBe('claude-b rc=0');
  });

  it('the least loaded wins, and asking adds no line', () => {
    blockedAway(); limits('claude-b', 40, 40); limits('claude-d', 20, 20);
    expect(target('claude-a', 'claude', '1', '1')).toBe('claude-d rc=0');
  });

  it('an older `accounts.sh` with no `_ccrc_org` at all: the same answers', () => {
    blockedAway(); limits('claude-b', 30, 30); limits('claude-d', 30, 30);
    const sh = path.join(h.home, '.ccrc', 'accounts.sh');
    fs.writeFileSync(sh, fs.readFileSync(sh, 'utf8').replace(/^_ccrc_org\(\) \{\n {2}case "\$1" in\n\n {2}esac\n\}\n/m, ''));
    expect(fs.readFileSync(sh, 'utf8')).not.toContain('_ccrc_org');
    expect(target('claude-a', 'claude', '1', '1')).toBe('claude-b rc=0');
  });
});

// The rescue tick hands the near miss to the dispatch, which carries it into the unit as `CCD_SWAP_ORGNEAR`.
const BLOCKED = `
  tmux() { case "$*" in *pane_active*) echo "1 200"; return 0 ;; esac
           case "\${1:-}" in
             capture-pane) echo "API Error: 429 Too Many Requests" ;;
             list-panes)   echo ${PANE_PID} ;;
           esac; return 0; };
  _dispatch_swap() { echo "dispatch $1 -> $2 arm=$3 orgnear=\${10-}" >> "$REG/swap.log"; };
`;
const swapLog = (): string => fs.readFileSync(path.join(h.home, '.cc-sessions', 'swap.log'), 'utf8');

describe('the rescue tick carries the near miss into the dispatch', () => {
  it('a rescue that took a lower `other` lane over a `same` one dispatches with orgnear', () => {
    labels({ 'claude-a': 'org-a', 'claude-b': 'org-b', 'claude-d': 'org-a' });
    blockedAway(); limits('claude-b', 20, 20); limits('claude-d', 40, 40);
    h.sh(`${BLOCKED} _auto_swap_check ${ID}`, ENV);
    expect(swapLog()).toContain(`dispatch ${ID} -> claude-b arm=rescue orgnear=40`);
  });

  it('a rescue with no near miss dispatches with orgnear empty', () => {
    labels({ 'claude-a': 'org-a', 'claude-b': 'org-b', 'claude-d': 'org-a' });
    blockedAway(); limits('claude-b', 30, 30); limits('claude-d', 30, 30);
    h.sh(`${BLOCKED} _auto_swap_check ${ID}`, ENV);
    expect(swapLog()).toMatch(new RegExp(`dispatch ${ID} -> claude-d arm=rescue orgnear=$`, 'm'));
  });
});

// The other two sites that ask for the near miss cut it off before the dispatch: the tick's retry with the class gate
// dropped, and the limit watchdog. Each fixture has a near miss (`claude-d`, `same`, at 40 lost to `claude-a`, `other`), so
// a site that skipped its cut would dispatch the two-line answer as the destination's name. The dispatch stub prints
// a newline in the name as `<NL>`.
const ORGS_NEAR = { claude: 'org-a', 'claude-a': 'org-b', 'claude-b': 'org-a', 'claude-d': 'org-a' };
const DISPATCH_NL = `_dispatch_swap() { local t="\${2//$'\\n'/<NL>}"; echo "dispatch $1 -> $t arm=$3 orgnear=\${10-}" >> "$HOME/ccd-calls"; };`;
const dispatches = (): string[] => h.calls().filter((l) => l.startsWith('dispatch '));
const iso = (e: number): string => new Date(e * 1000).toISOString();

describe('the other two rescue sites cut the near miss off too', () => {
  it('the tick\'s retry with the class gate dropped', () => {
    labels(ORGS_NEAR); seed('claude', 'claude');
    fs.mkdirSync(path.join(h.home, '.cc-limits'), { recursive: true });
    for (const [w, five] of [['claude', 100], ['claude-a', 10], ['claude-b', 40], ['claude-d', 40]] as const) {
      fs.writeFileSync(path.join(h.home, '.cc-limits', `${w}.json`), JSON.stringify(
        { five, seven: five === 100 ? 5 : five, ts: T0, fiveResetAt: T0 + 10000, sevenResetAt: T0 + 400000 }));
    }
    // A live limit row in the transcript, and a class gate that refuses every lane until it is dropped.
    const at = T0 - 5;
    const p = h.sh(`_transcript_path ${ID}`);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify({
      parentUuid: 'p', isSidechain: false, type: 'assistant', uuid: `b${at}`, timestamp: iso(at),
      message: { model: '<synthetic>', role: 'assistant', content: [{ type: 'text', text: "You've hit your session limit · resets 9:10pm (UTC)" }] },
      isApiErrorMessage: true, error: 'rate_limit', apiErrorStatus: 429,
      quotaLimits: { status: 'rejected', resetsAt: at + 9000, rateLimitType: 'five_hour' },
    }) + '\n');
    fs.writeFileSync(path.join(h.home, 'pane.txt'), '? for shortcuts\n❯ \n');
    h.sh(`tmux() { ${WIDE_PANE} case "\${1:-}" in
        capture-pane) cat "$HOME/pane.txt" ;; list-panes) echo ${PANE_PID} ;;
        display-message) [ -n "\${TMUX_CREATED:-}" ] && echo "$TMUX_CREATED" ;; esac; return 0; };
      _pane_box_draft() { printf ''; };
      ${DISPATCH_NL}
      _route_peek_to() { printf -v "$1" ''; [[ "$3" == class ]] && printf -v "$1" opus; return 0; };
      _class_gate() { [[ -z "\${2:-}" ]] && return 0; return 2; };
      _auto_swap_check ${ID}`, { TMUX_CREATED: String(T0 - 86400) });
    expect(dispatches()).toEqual([`dispatch ${ID} -> claude-a arm=rescue orgnear=40`]);
  });

  it('the limit watchdog', () => {
    const W0 = 1_900_000_000;
    const BORDER = '─'.repeat(28);
    labels(ORGS_NEAR); seed('claude', 'claude');
    fs.mkdirSync(path.join(h.home, '.cc-limits'), { recursive: true });
    for (const [w, five, seven] of [['claude', 100, 10], ['claude-a', 5, 5], ['claude-b', 40, 40], ['claude-d', 40, 40]] as const) {
      fs.writeFileSync(path.join(h.home, '.cc-limits', `${w}.json`),
        JSON.stringify({ five, seven, ts: W0, ...(w === 'claude' ? { fiveResetAt: W0 + 10000 } : {}) }));
    }
    h.sh(`_reg_set ${ID} lastswap ${W0 - 100}`);
    fs.writeFileSync(path.join(h.home, 'pane.txt'),
      `  ⎿  You've hit your session limit · resets 9:10pm (UTC)\n${BORDER}\n❯ \n${BORDER}\n  ? for shortcuts\n`);
    const stubs = `
      date() { if [[ "\${1:-}" == +%s && -n "\${FAKE_NOW:-}" ]]; then echo "$FAKE_NOW"; else command date "$@"; fi; };
      tmux() { echo "tmux $*" >> "$HOME/ccd-calls"
        case "$*" in *pane_active*) echo "1 200"; return 0 ;; esac
        case "\${1:-}" in capture-pane) cat "$HOME/pane.txt" ;; list-panes) echo ${PANE_PID} ;;
          display-message) [ -n "\${TMUX_CREATED:-}" ] && echo "$TMUX_CREATED" ;; esac; return 0; };
      ${DISPATCH_NL}
      _svc_run_detached() { echo "detached $*" >> "$HOME/ccd-calls"; return 0; };`;
    for (const w of [W0, W0 + 300]) h.sh(`${stubs} cmd_limit_watchdog`, { TMUX_CREATED: String(w - 86400), FAKE_NOW: String(w) });
    expect(dispatches()).toEqual([`dispatch ${ID} -> claude-a arm=watchdog orgnear=40`]);
  });
});

// The dispatch composes the near miss into the unit's environment beside the decision's other values (D-5240).
describe('the dispatch carries orgnear into the unit', () => {
  const DETACHED = `_svc_run_detached() { printf '%s\\n' "$3" >> "$HOME/detached"; return 0; };`;
  const detached = (): string => fs.readFileSync(path.join(h.home, 'detached'), 'utf8');

  it('as CCD_SWAP_ORGNEAR, and empty when the caller passed none', () => {
    seedAccountsSh(h.home); seed('claude-a', 'claude');
    h.sh(`${DETACHED} _dispatch_swap ${ID} claude-b rescue 1 2 '' '' '' '' 40`, ENV);
    expect(detached()).toContain('CCD_SWAP_ORGNEAR=40 ');
    fs.rmSync(path.join(h.home, '.cc-sessions', `${ID}.dispatching`), { force: true });
    fs.rmSync(path.join(h.home, 'detached'));
    h.sh(`${DETACHED} _dispatch_swap ${ID} claude-b rescue 1 2`, ENV);
    expect(detached()).toContain("CCD_SWAP_ORGNEAR='' ");
  });
});

// The act's record: `cmd_swap`'s `swap` row carries `meas.org` (the landing's relation to the account it left) and
// `meas.orgnear` (what the decision carried in). `_lc_emit`, the one writer, drops an empty value, so a move with no near
// miss carries no `orgnear` at all.
// `ccd-crosspool.test.ts`'s stubs: no pane stands, so the swap moves a stopped session and types nothing.
const NO_PANE = 'case "${1:-}" in has-session) echo "can\'t find session: x" >&2; return 1 ;; esac;';
const SWAP_STUBS = 'systemctl() { echo "systemctl $*" >> "$HOME/ccd-calls"; return 0; };'
  + ' launchctl() { echo "launchctl $*" >> "$HOME/ccd-calls"; return 0; };'
  + ` tmux() { echo "tmux $*" >> "$HOME/ccd-calls"; ${WIDE_PANE} ${NO_PANE} return 0; }; sleep() { :; };`;

describe('the swap record carries meas.org and meas.orgnear', () => {
  const plantTranscript = (): void => {
    const wd = fs.realpathSync(path.join(h.home, 'projects', 'project-a')).replace(/[/._]/g, '-');
    const dir = path.join(h.home, '.claude-a', 'projects', wd);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${UUID}.jsonl`), 'HISTORY\n');
  };

  it('a move into another organization, with the near miss the decision carried', () => {
    labels({ 'claude-a': 'org-a', 'claude-b': 'org-b' });
    seed('claude-a', 'claude-a'); plantTranscript();
    h.sh(`${SWAP_STUBS} CCD_SWAP_ORGNEAR=40 cmd_swap ${ID} claude-b`, ENV);
    const rows = eventsOf(h.home, 'swap');
    expect(rows).toHaveLength(1);
    expect(measOf(rows[0]!)).toMatchObject({ from: 'claude-a', wrapper: 'claude-b', org: 'other', orgnear: '40' });
  });

  it('a move within one organization, with no near miss', () => {
    labels({ 'claude-a': 'org-a', 'claude-b': 'org-a' });
    seed('claude-a', 'claude-a'); plantTranscript();
    h.sh(`${SWAP_STUBS} cmd_swap ${ID} claude-b`, ENV);
    const m = measOf(eventsOf(h.home, 'swap')[0]!);
    expect(m).toMatchObject({ org: 'same' });
    expect(m['orgnear']).toBeUndefined();
  });

  it('an unlabelled landing reads `unknown`, never `same`', () => {
    labels({ 'claude-a': 'org-a' });
    seed('claude-a', 'claude-a'); plantTranscript();
    h.sh(`${SWAP_STUBS} cmd_swap ${ID} claude-b`, ENV);
    const m = measOf(eventsOf(h.home, 'swap')[0]!);
    expect(m).toMatchObject({ org: 'unknown' });
    expect(m['orgnear']).toBeUndefined();
  });
});
