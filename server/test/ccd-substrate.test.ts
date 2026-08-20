/**
 * The substrate marker — `$REG/<id>.substrate`, the supervisor's decision
 * record for "I could not reach tmux" (spec §2, D-B8-14).
 *
 * One writer per file: the row's own supervisor. The fleet-wide statement
 * ("tmux itself is down") is DERIVED by the reader from the set of markers,
 * never written by anyone — so these tests pin only the per-row contract:
 *
 *   - format `<epoch-seconds> <text>`, text NEVER empty (an empty reason is
 *     the one shape a maintainer can do nothing with);
 *   - the client/server version-skew comparison rides on the FIRST write
 *     only — that is the moment the answer is wanted, one bounded call per
 *     fault, not one per 30s tick against a server already unwell;
 *   - `_substrate_clear` is silent when the marker is already absent (the
 *     first live tick after a restart clears unconditionally).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { CCD, ghContainedEnv, makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-substrate-'); });
afterEach(() => { h.cleanup(); });

describe('the substrate marker — one writer, epoch + verbatim reason (spec §2)', () => {
  it('mark writes "<epoch> <detail>", clear removes it, absent clear is silent', () => {
    h.sh(`PROBE_DETAIL='no server running on /tmp/x'; date() { [[ "$1" == +%s ]] && echo 1755620112 || command date "$@"; }
          tmux() { echo 'tmux 3.4' ; }
          _substrate_mark demo`);
    expect(h.reg('demo', 'substrate')).toMatch(/^1755620112 no server running on \/tmp\/x/);
    h.sh('_substrate_clear demo');
    expect(existsSync(path.join(h.home, '.cc-sessions', 'demo.substrate'))).toBe(false);
    h.sh('_substrate_clear demo');   // absent: no error
  });
  it('the FIRST write records the skew comparison; later writes do not repeat it', () => {
    const stub = `date() { [[ "$1" == +%s ]] && echo 100 || command date "$@"; }
      tmux() { case "$1" in -V) echo 'tmux 3.5'; return 0 ;; display-message) echo 'protocol version mismatch' >&2; return 1 ;; esac; };`;
    h.sh(`${stub} PROBE_DETAIL='x'; _substrate_mark demo`);
    const first = h.reg('demo', 'substrate');
    expect(first).toContain('client tmux 3.5');
    expect(first).toContain('server unreachable');
    h.sh(`${stub} PROBE_DETAIL='y'; _substrate_mark demo`);
    expect(h.reg('demo', 'substrate')).toBe('100 y');   // refresh, no second skew suffix
  });
  it('the reason is NEVER empty — an empty PROBE_DETAIL is refused with a synthesized text', () => {
    h.sh(`PROBE_DETAIL=''; tmux() { echo 'tmux 3.4'; }; _substrate_mark demo`);
    const marker = h.reg('demo', 'substrate');
    expect(marker).toMatch(/^\d+ .+/);
    // The guard's own words, not just the shape: with the guard deleted the
    // FIRST write still appends the skew suffix, so the marker reads
    // "<epoch>  (client …)" — a double space `.` happily matches. Only the
    // synthesized text itself distinguishes guarded from unguarded.
    expect(marker).toContain('tmux gave no reason');
  });
});

const ID = 'demo';

/** `cmd_supervise` as a PROGRAM, bounded: the loop under test is a `while :`,
 *  so spawnSync's own timeout turns a loop that stops exiting into one failed
 *  case instead of a hung suite (the ccd-session-state.test.ts run idiom). */
const run = (snippet: string): { code: number; stdout: string; stderr: string } => {
  const r = spawnSync('bash', ['-c', `source "${CCD}"; ${snippet}`], {
    encoding: 'utf8', cwd: h.home, timeout: 15000,
    env: ghContainedEnv(h.home, { ...process.env, HOME: h.home }, { systemd: true }),
  });
  return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
};

// Sequenced probe: answers from an array, then 'gone' forever — the loop's only
// exit. Elements are single-quoted: a detail with a SPACE must stay one array
// element.
const seq = (...v: string[]): string =>
  `_i=0; _seq=(${v.map((x) => `'${x}'`).join(' ')}); _session_probe() {
     local x="\${_seq[$_i]:-gone}"; _i=$((_i+1))
     PROBE_VERDICT="\${x%%:*}"; PROBE_DETAIL="\${x#*:}"; [[ "$PROBE_DETAIL" == "$x" ]] && PROBE_DETAIL=""; }`;

// The loop's collaborators, stubbed quiet; `sleep` RECORDS its argument — the
// backoff contract is read from that log. `tmux` is a function stub so
// `_substrate_mark`'s first-write skew probe stays hermetic (no real binary,
// no real socket; `_session_probe` itself is sequenced above anyway).
const LOOP_STUBS = `systemctl() { :; }; sleep() { echo "sleep \${1:-}" >> "$HOME/ccd-calls"; }
  cmd_ensure() { :; }; _sync_uuid() { :; }; _auto_swap_check() { :; }; _auto_compact_check() { :; }
  tmux() { case "$1" in -V) echo 'tmux 3.4' ;; *) return 1 ;; esac; }`;

describe('cmd_supervise under a substrate fault (spec §1)', () => {
  it('unknown does NOT exit, marks the row, and stamps the heartbeat EVERY unknown tick', () => {
    run(`${LOOP_STUBS}
      ${seq('unknown:protocol mismatch', 'unknown:protocol mismatch', 'gone')}
      _reg_set() { printf '%s' "$3" > "$REG/$1.$2"; echo "stamp $2" >> "$HOME/ccd-calls"; }
      cmd_supervise ${ID}`);
    expect(h.calls().filter((l) => l === 'stamp supervised').length).toBeGreaterThanOrEqual(3); // pre-ensure + 2 unknown ticks
    expect(h.reg(ID, 'substrate')).toContain('protocol mismatch');
  });
  it('the FIRST live after unknown clears the marker; a STALE marker from a dead supervisor clears too', () => {
    run(`${LOOP_STUBS}
      ${seq('unknown:x', 'live', 'gone')}
      cmd_supervise ${ID}`);
    expect(existsSync(path.join(h.home, '.cc-sessions', `${ID}.substrate`))).toBe(false);
    h.sh(`printf '1 stale' > "$REG/${ID}.substrate"`);
    run(`${LOOP_STUBS}
      ${seq('live', 'gone')}
      cmd_supervise ${ID}`);
    expect(existsSync(path.join(h.home, '.cc-sessions', `${ID}.substrate`))).toBe(false);
  });
  it('backs off 5s -> 30s after SUBSTRATE_BACKOFF_AFTER consecutive unknowns, and 5s again on live', () => {
    run(`${LOOP_STUBS}
      ${seq('unknown:x', 'unknown:x', 'unknown:x', 'unknown:x', 'live', 'unknown:x', 'gone')}
      cmd_supervise ${ID}`);
    const sleeps = h.calls().filter((l) => l.startsWith('sleep ')).map((l) => l.slice(6));
    // unknown_run 1,2 sleep 5; run 3 REACHES the threshold so the sleep AFTER the third
    // unknown is already 30 (and stays 30); live resets to 5; a fresh unknown starts at 5.
    expect(sleeps).toEqual(['5', '5', '30', '30', '5', '5']);
  });
  it('gone stays the ONLY exit — an unknown-only run is bounded by the seq fallback, not by exiting', () => {
    const r = run(`${LOOP_STUBS}
      ${seq('unknown:x', 'gone')}
      cmd_supervise ${ID}`);
    expect(r.code).toBe(1);   // the gone exit, systemd's restart signal, unchanged
  });
  it('the three tick helpers are SKIPPED on an unknown tick — each would shell into the dead tmux', () => {
    run(`${LOOP_STUBS}
      ${seq('unknown:x', 'gone')}
      _sync_uuid() { echo tickhelper >> "$HOME/ccd-calls"; }
      cmd_supervise ${ID}`);
    expect(h.calls().filter((l) => l === 'tickhelper')).toHaveLength(0);
  });
});
