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
/** Every executable `esc to interrupt` grep in ccd/ccd: its function and how many identical lines it carries. */
const CCD_SITES = {
  'ccd-enter': { fn: '_auto_stale_check', lines: 1 },
  'ccd-swap': { fn: '_swap_idle_gate', lines: 1 },
  'ccd-compact': { fn: '_idle_for_keystroke', lines: 1 },
  'ccd-hard-block': { fn: '_session_hard_blocked', lines: 1 },
  'ccd-redrive': { fn: '_redrive_after_spawn', lines: 2 },
  /** The readiness grep: a match means the TUI is UP, the opposite direction, so it is exempt from the safety invariant. */
  'ccd-tui-up': { fn: '_accept_first_run_prompts', lines: 1 },
} as const;
const READINESS: readonly string[] = ['ccd-tui-up'];
type Caller = 'ts-mail-hold' | keyof typeof CCD_SITES;
interface Verdicts { captures: Record<string, Partial<Record<Caller, boolean>> & { divergence?: string }> }
const verdicts = JSON.parse(readFileSync(path.join(DIR, 'verdicts.json'), 'utf8')) as Verdicts;
const ccdSource = readFileSync(CCD, 'utf8');

/** The last 8 rows, the window every caller decides on. */
const tail8 = (plain: string): string => plain.replace(/\n$/, '').split('\n').slice(-8).join('\n');

/** The executable `esc to interrupt` grep lines inside a ccd function (pipe form or here-string form). */
const predicateLines = (fn: string, count: number): string[] => {
  const start = ccdSource.indexOf(`\n${fn}() {`);
  expect(start, `${fn} is gone from ccd/ccd`).toBeGreaterThan(-1);
  const end = ccdSource.indexOf('\n}\n', start);
  const lines = ccdSource.slice(start, end).split('\n').filter((l) => /^\s*(echo "\$pane" \| grep -E?q "[^"]*esc to interrupt|grep -q "esc to interrupt" <<<"\$pane")/.test(l));
  expect(lines, `${fn} must carry exactly ${count} executable busy grep line(s)`).toHaveLength(count);
  return lines;
};

/** True iff the ccd predicate line returns (stands down) on this pane. */
const ccdBusy = (fn: string, count: number, pane: string): boolean => {
  const verdicts = predicateLines(fn, count).map((line) => {
    const r = spawnSync('bash', ['--noprofile', '--norc', '-c', `probe() { local pane="$1"; ${line}\n echo notbusy; }; probe "$1"`, 'bash', pane], { encoding: 'utf8', timeout: 15000, env: { PATH: '/usr/bin:/bin', HOME: '/nonexistent' } });
    // The stand-down arms `return` 0 or 1, so the exit status says nothing; stdout and stderr do.
    expect(r.stderr ?? '', 'the probe must not error').toBe('');
    return (r.stdout ?? '').trim() !== 'notbusy';
  });
  expect(new Set(verdicts).size, `${fn}: its identical lines must agree`).toBe(1);
  return verdicts[0]!;
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
    for (const [caller, site] of Object.entries(CCD_SITES)) {
      expect(ccdBusy(site.fn, site.lines, plain), `${name} ${caller}`).toBe(col[caller as Caller]);
    }
  });

  it('a divergence is recorded with its reason, and only where the callers differ', () => {
    for (const [name, col] of Object.entries(verdicts.captures)) {
      const vs = (['ts-mail-hold', ...Object.keys(CCD_SITES)] as Caller[]).map((c) => col[c]);
      const differs = new Set(vs).size > 1;
      expect(Boolean(col.divergence), `${name}: divergence note iff the columns differ`).toBe(differs);
    }
  });

  it('the intended direction holds: every ccd withhold-grep is never less busy than TS (readiness exempt: opposite direction)', () => {
    for (const [name, col] of Object.entries(verdicts.captures)) {
      if (col['ts-mail-hold']) for (const c of Object.keys(CCD_SITES).filter((k) => !READINESS.includes(k))) expect(col[c as Caller], `${name} ${c}`).toBe(true);
    }
  });
});
