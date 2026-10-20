// path-identity W2, TR7: the collector's idle floor knob strips its leading zeros with ONE regex capture (path-identity
// spec §3.6). `_ws_collect_floor_s` used to strip them with a pattern expansion, `${o%%[!0]*}`, which is quadratic in
// the knob's length: measured 43.3 s at 131,000 zeros. The anchored capture `^0*([1-9][0-9]*)?$` has exactly one
// parse (its group must begin with a digit that is not 0), so its answer does not depend on how a libc orders POSIX
// subexpression matches, and it runs in linear time. It answers what the old strip answered, so
// `ccd-collect-idle-token.test.ts`'s padded rows stand unedited.
//
// A timing-free row cannot go red when the quadratic strip comes back, because both forms give the same answer. So the
// MECHANISM is the structure pin on `type _ws_collect_floor_s`; the 200,000-zero rows pin correctness at scale. Each
// knob is built INSIDE the shell (`printf -v`): written into the snippet or the env, it would be one argv or env string
// longer than 131072 bytes, which the kernel refuses before ccd runs.
//
// FIXTURE HOMES ONLY (`makePrHarness`). Every case runs on every platform. Each reads rc, stdout, `_WS_FLOOR_WHY` and
// stderr in the CURRENT shell, so the global it reads is the one this call set.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-collect-floor-linear-'); });
afterEach(() => { h.cleanup(); });

interface Floor { rc: string; out: string; why: string; err: string; len: string }
/** `_ws_collect_floor_s` asked in the CURRENT shell after `setup`: its rc, its stdout, `_WS_FLOOR_WHY`, its stderr, and
 *  the knob's length as the function saw it (the control that the knob arrived whole). */
const floor = (setup: string): Floor => {
  const [rc = '', out = '', why = '', err = '', len = ''] = h.sh(`${setup}`
    + ' _ws_collect_floor_s >"$HOME/fl.out" 2>"$HOME/fl.err"; rc=$?;'
    + ' printf \'%s\\x1f%s\\x1f%s\\x1f%s\\x1f%s\' "$rc" "$(cat -- "$HOME/fl.out")" "$_WS_FLOOR_WHY" "$(cat -- "$HOME/fl.err")"'
    + ' "${#WS_COLLECT_IDLE_FLOOR_S}"').split('\x1f');
  return { rc, out, why, err, len };
};

describe('_ws_collect_floor_s, TR7 (path-identity spec §3.6)', () => {
  it('a knob of 200,000 leading zeros reads its significant digits', () => {
    for (const [tail, want] of [['172800', '172800'], ['', '86400'], ['1111111111', '999999999']] as const) {
      const got = floor(`printf -v z '%0*d' 200000 0; WS_COLLECT_IDLE_FLOOR_S="\${z}${tail}";`);
      expect(got.len, `the knob reached the function whole: 200,000 zeros, then ${JSON.stringify(tail)}`)
        .toBe(String(200_000 + tail.length));
      expect({ rc: got.rc, out: got.out, why: got.why, err: got.err }, `200,000 zeros, then ${JSON.stringify(tail)}`)
        .toEqual({ rc: '0', out: want, why: '', err: '' });
    }
  });

  it('the strip is one capture, never a pattern expansion', () => {
    const body = h.sh('type _ws_collect_floor_s');
    expect(body, 'the CONTROL: `type` printed the function').toContain('WS_COLLECT_IDLE_FLOOR_S');
    expect(body).toContain('BASH_REMATCH[1]:-0');
    expect(body).toContain('^0*([1-9][0-9]*)?$');
    expect(body, 'the capture’s status is read: a capture that fails answers 2, never a silent 86400')
      .toMatch(/\^0\*\(\[1-9\]\[0-9\]\*\)\?\$ \]\] \|\| \{\s*_WS_FLOOR_WHY="WS_COLLECT_IDLE_FLOOR_S could not be read by its capture/);
    expect(body, 'the quadratic strip is gone').not.toMatch(/%%\[!0\]\*/);
  });

  it('a knob that is not a whole number still answers 2, and the anchored capture never sees it', () => {
    for (const k of ['0x10', '00 1']) {
      const got = floor(`WS_COLLECT_IDLE_FLOOR_S='${k}';`);
      expect({ rc: got.rc, out: got.out, err: got.err }, `knob ${JSON.stringify(k)}`).toEqual({ rc: '2', out: '', err: '' });
      expect(got.why, `knob ${JSON.stringify(k)}`).toContain('not a whole number');
    }
  });
});
