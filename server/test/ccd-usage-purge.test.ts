import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { CCD, makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-usage-purge-'); });
afterEach(() => { h.cleanup(); });

const usage = (rel: string): string => path.join(h.home, '.cc-sessions', 'usage', rel);
const seed = (id: string): void => {
  h.sh(`_reg_set ${id} wrapper claude; _reg_set ${id} uuid 00000000-0000-0000-0000-000000000000`);
  fs.mkdirSync(usage(`${id}.agents`), { recursive: true });
  fs.writeFileSync(usage(`${id}.json`), '{"ts":1}\n');
  fs.writeFileSync(usage(`${id}.agents/scout.json`), '{"ts":1,"agent":"scout"}\n');
};

describe('_reg_purge reaps the usage sidecar so a reused id never inherits a dead reading (routing spec §6)', () => {
  it('removes the main row and the agents directory of the purged id, and ONLY that id', () => {
    seed('demo-a'); seed('demo-ab');
    h.sh('_reg_purge demo-a');
    expect(fs.existsSync(usage('demo-a.json'))).toBe(false);
    expect(fs.existsSync(usage('demo-a.agents'))).toBe(false);
    // `_reg_purge`'s own unanchored-glob hazard, applied here: demo-a must not take demo-ab with it
    expect(fs.existsSync(usage('demo-ab.json'))).toBe(true);
    expect(fs.existsSync(usage('demo-ab.agents/scout.json'))).toBe(true);
    expect(h.reg('demo-ab', 'uuid')).not.toBeNull();
  });

  it('is a silent no-op for an id with no sidecar', () => {
    h.sh('_reg_set demo-b wrapper claude');
    expect(h.sh('_reg_purge demo-b; echo rc=$?')).toContain('rc=0');
  });

  it('_usage_purge on its own returns 0 whether or not anything existed', () => {
    seed('demo-c');
    expect(h.sh('_usage_purge demo-c; echo rc=$?')).toContain('rc=0');
    expect(h.sh('_usage_purge demo-never; echo rc=$?')).toContain('rc=0');
    expect(fs.existsSync(usage('demo-c.json'))).toBe(false);
  });

  it('cleans up leaked tmp files for the purged id only', () => {
    fs.mkdirSync(usage('.'), { recursive: true });
    // Create leaked tmp files for demo-a and demo-ab
    fs.writeFileSync(usage('.demo-a.123.tmp'), '{}');
    fs.writeFileSync(usage('.demo-ab.123.tmp'), '{}');
    h.sh('_usage_purge demo-a');
    expect(fs.existsSync(usage('.demo-a.123.tmp'))).toBe(false);
    expect(fs.existsSync(usage('.demo-ab.123.tmp'))).toBe(true);
  });
});

// ── THE COMPOSITION IS A MECHANISM (merge fix round M3, gate 1 A-I1) ────────
// `_reg_purge`'s own contract sentence (ccd/ccd:3061-3063) says "Every unlink
// from here down is tracked and the function returns 3 … if any of them
// failed". The merge with `origin/main` placed main's `_usage_purge "$id"`
// 22 lines below that sentence and INSIDE that function, and main's three
// sidecar removals were silent (`2>/dev/null`) and statusless ("Always 0") —
// so a sidecar that could not be removed left the purge answering 0 with
// `REG_PURGE_UNREMOVED` empty, which is the one condition the sentence says
// cannot happen. The composition's invariant is now the tracking itself: each
// removal carries `|| _reg_purge_unremoved "<path>"`, so the sentence above it
// is true of the merged body rather than of either parent's.
//
// IT DOES NOT STOP THE PURGE, which is all main's "not a reason to stop
// purging the row" ever protected: the recorder only sets `_pg_urc` and
// appends a pathname, every later unlink still runs, and the status is
// reported once at the end. `_ws_slug_free` never reads `$REG/usage`, so slug
// reuse is unaffected either way — the defect was the STATUS contract.
describe('the usage sidecar removals are TRACKED unlinks of the purge that runs them', () => {
  /** `$REG/usage` made unwritable, with the mode restored whatever happens —
   *  `h.cleanup()`'s recursive rm needs to unlink what is inside it. */
  const withSealedUsage = (fn: () => void): void => {
    fs.mkdirSync(usage('.'), { recursive: true });
    fs.chmodSync(usage('.'), 0o555);
    try { fn(); } finally { fs.chmodSync(usage('.'), 0o755); }
  };

  it('a refused sidecar removal makes `_reg_purge` return 3 and names the path, while the row still dies', () => {
    seed('demo-sealed');
    fs.writeFileSync(usage('.demo-sealed.4242.tmp'), '{}');
    withSealedUsage(() => {
      const out = h.sh('_reg_purge demo-sealed; echo "rc=$?"; echo "unremoved=$REG_PURGE_UNREMOVED"');
      // THE STATUS, not a boolean: `_reg_purge`'s four callers branch on the
      // value, and 3 is "the row is gone and something beside it is standing" —
      // distinct from the 1 a pre-emit lock refusal returns.
      expect(out, 'a refused sidecar unlink is the purge`s own status-3 condition').toContain('rc=3');
      // ALL THREE REMOVAL LINES, each named by the path it could not take. The
      // glob line records its PATTERN (prose for a human and for the journal's
      // `detail`, never a grammar — `_reg_purge_unremoved`'s own comment).
      const rec = out.split('\n').find((l) => l.startsWith('unremoved=')) ?? '';
      expect(rec, 'the main row sidecar').toContain(usage('demo-sealed.json'));
      expect(rec, 'the leaked per-PID partials, as the pattern').toContain(usage('.demo-sealed.*.tmp'));
      expect(rec, 'the per-agent directory').toContain(usage('demo-sealed.agents'));
      // AND THE PURGE RAN ON. The registry row is destroyed exactly as it is on
      // the success path — the recorder changes the STATUS, never the sequence.
      expect(h.reg('demo-sealed', 'uuid'), 'the row was purged anyway').toBeNull();
      expect(h.reg('demo-sealed', 'wrapper'), 'every field of it').toBeNull();
    });
  });

  it('CONTROL — the same fixture with the sidecar removable answers 0 with an empty record', () => {
    seed('demo-open');
    fs.writeFileSync(usage('.demo-open.4242.tmp'), '{}');
    const out = h.sh('_reg_purge demo-open; echo "rc=$?"; echo "unremoved=[$REG_PURGE_UNREMOVED]"');
    // Without this the pin above cannot tell "the recorder fired" from "this
    // fixture records something on every run".
    expect(out, 'nothing refused, so nothing is recorded').toContain('rc=0');
    expect(out, 'and the out-parameter stays empty').toContain('unremoved=[]');
    expect(fs.existsSync(usage('demo-open.json'))).toBe(false);
    expect(fs.existsSync(usage('demo-open.agents'))).toBe(false);
    expect(fs.existsSync(usage('.demo-open.4242.tmp'))).toBe(false);
  });

  it('`_usage_purge` has exactly ONE call site in `ccd/ccd`, and it is inside `_reg_purge`', () => {
    // THE TRACKING IS ONLY A MECHANISM WHILE THIS HOLDS. `_reg_purge_unremoved`
    // assigns `_pg_urc`, which is `_reg_purge`'s own `local` reached through
    // bash's dynamic scope — so a second call site outside that extent would be
    // recording into whatever `_pg_urc` happened to be in scope, or into
    // nothing. This is what makes "two sites, one dynamic extent" checkable.
    const lines = fs.readFileSync(CCD, 'utf8').split('\n');
    const calls = lines
      .map((l, i) => ({ n: i + 1, l }))
      .filter(({ l }) => l.includes('_usage_purge'))
      .filter(({ l }) => !/^_usage_purge\(\)\s*\{/.test(l))   // its own definition
      .filter(({ l }) => !/^\s*#/.test(l));                   // prose about it
    expect(calls.length, 'one call site, no more').toBe(1);
    expect(calls[0]!.l.trim(), 'and it is a bare invocation of the row id')
      .toMatch(/^_usage_purge "\$id"/);
    // The enclosing function, read backwards to the nearest definition line.
    const enclosing = (n: number): string => {
      for (let i = n - 1; i >= 1; i--) {
        const m = /^([A-Za-z_][A-Za-z0-9_]*)\(\)\s*\{/.exec(lines[i - 1]!);
        if (m) return m[1]!;
      }
      return '(file scope)';
    };
    expect(enclosing(calls[0]!.n), 'the sidecar purge runs inside the function whose status it raises')
      .toBe('_reg_purge');
  });
});
