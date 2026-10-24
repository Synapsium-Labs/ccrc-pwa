/**
 * ARCH-24: one corpus of Claude Code pane captures, with a verdict per CALLER.
 *
 * TS and ccd read the spinner row's `esc to interrupt` phrase independently, on purpose, with
 * opposite safety directions: TS anchors it because a false busy held mail; ccd greps it
 * unanchored because a false busy only withholds a keystroke. Nothing recorded which differences
 * are intended. `fixtures/panes/busy/verdicts.json` does: each capture lists the verdict of every
 * caller, and a divergence carries its reason. A caller that drifts from its own column fails
 * here; a divergence is recorded, not forced to agree.
 *
 * The ccd columns run the REAL predicate line, cut out of the named function in `ccd/ccd` and
 * evaluated in bash over the capture's last 8 rows (no source of ccd, no verb, no HOME touched).
 * A site that moves or changes its grep makes the cut fail loudly.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { turnRunning } from '../src/pane/dialog.js';
import { CCD } from './ccdWsHelpers.js';

const DIR = path.resolve(__dirname, 'fixtures/panes/busy');
const SGR = /\x1b\[[0-9;]*m/g;
const CCD_SITES = { 'ccd-enter': '_auto_stale_check', 'ccd-swap': '_swap_idle_gate', 'ccd-compact': '_idle_for_keystroke' } as const;
type Caller = 'ts-mail-hold' | keyof typeof CCD_SITES;
interface Verdicts { captures: Record<string, Partial<Record<Caller, boolean>> & { divergence?: string }> }
const verdicts = JSON.parse(readFileSync(path.join(DIR, 'verdicts.json'), 'utf8')) as Verdicts;
const ccdSource = readFileSync(CCD, 'utf8');

/** The last 8 rows, the window every caller decides on. */
const tail8 = (plain: string): string => plain.replace(/\n$/, '').split('\n').slice(-8).join('\n');

/** The one executable `esc to interrupt` grep line inside a ccd function. */
const predicateLine = (fn: string): string => {
  const start = ccdSource.indexOf(`\n${fn}() {`);
  expect(start, `${fn} is gone from ccd/ccd`).toBeGreaterThan(-1);
  const end = ccdSource.indexOf('\n}\n', start);
  const lines = ccdSource.slice(start, end).split('\n').filter((l) => /^\s*echo "\$pane" \| grep -q "esc to interrupt"/.test(l));
  expect(lines, `${fn} must carry exactly one executable busy grep`).toHaveLength(1);
  return lines[0]!;
};

/** True iff the ccd predicate line returns (stands down) on this pane. */
const ccdBusy = (fn: string, pane: string): boolean => {
  const r = spawnSync('bash', ['-c', `probe() { local pane="$1"; ${predicateLine(fn)}\n echo notbusy; }; probe "$1"`, 'bash', pane], { encoding: 'utf8', timeout: 15000 });
  // The stand-down arms `return` 0 or 1, so the exit status says nothing; stdout and stderr do.
  expect(r.stderr ?? '', 'the probe must not error').toBe('');
  return (r.stdout ?? '').trim() !== 'notbusy';
};

const read = (name: string): string => readFileSync(path.join(DIR, name), 'utf8');
const names = readdirSync(DIR).filter((f) => f.endsWith('.txt')).sort();

describe('pane busy corpus', () => {
  it('has at least 10 captures and a verdict row for each, and no row without a capture', () => {
    expect(names.length).toBeGreaterThanOrEqual(10);
    expect(Object.keys(verdicts.captures).sort()).toEqual(names);
  });

  it.each(names)('%s: every caller answers its own column', (name) => {
    const col = verdicts.captures[name]!;
    const plain = tail8(read(name).replace(SGR, ''));
    expect(turnRunning(plain), `${name} ts-mail-hold`).toBe(col['ts-mail-hold']);
    for (const [caller, fn] of Object.entries(CCD_SITES)) {
      expect(ccdBusy(fn, plain), `${name} ${caller}`).toBe(col[caller as Caller]);
    }
  });

  it('a divergence is recorded with its reason, and only where the callers differ', () => {
    for (const [name, col] of Object.entries(verdicts.captures)) {
      const vs = (['ts-mail-hold', ...Object.keys(CCD_SITES)] as Caller[]).map((c) => col[c]);
      const differs = new Set(vs).size > 1;
      expect(Boolean(col.divergence), `${name}: divergence note iff the columns differ`).toBe(differs);
    }
  });

  it('the intended direction holds: ccd is never less busy than TS on any capture', () => {
    for (const [name, col] of Object.entries(verdicts.captures)) {
      if (col['ts-mail-hold']) for (const c of Object.keys(CCD_SITES)) expect(col[c as Caller], `${name} ${c}`).toBe(true);
    }
  });
});
