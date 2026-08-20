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
import { existsSync } from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';

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
