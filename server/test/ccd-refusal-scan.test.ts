// server/test/ccd-refusal-scan.test.ts
//
// The mutant this exists for is not a deletion, it is an ADDITION: the next
// editor adding a fresh unrecorded `die` to a destructive verb. Task 24's
// record-tests pin the refusals that exist today; this pins the SHAPE of every
// refusal that will ever exist in these four functions.
//
// A SCANNER OVER SLICED BODIES, WITH A COVERAGE FLOOR, because a scan over an
// empty slice passes everything — `wsaudit.test.ts:65-71` and
// `ccd-swap-refuse.test.ts:435-446` both state that rule and this copies it.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { LC_REFUSAL_TOKENS } from '../../shared/api.js';
import { SENTENCES } from '../src/wsaudit.js';
import { CCD } from './ccdWsHelpers.js';

const src = readFileSync(CCD, 'utf8');

/** The body of `name`, from its opening line to `until`'s. */
const bodyOf = (name: string, until: string): string => {
  const from = src.indexOf(`${name}() {`);
  const to = src.indexOf(`${until}() {`, from);
  return from > -1 && to > from ? src.slice(from, to) : '';
};

const lineAt = (s: string, i: number): string => {
  const a = s.lastIndexOf('\n', i) + 1;
  const b = s.indexOf('\n', i);
  return s.slice(a, b === -1 ? undefined : b).trim();
};

/** D4's four destructive verbs. Floors are measured minima, not guesses. */
const VERBS: readonly (readonly [string, string, number])[] = [
  ['cmd_ws_rm', 'cmd_ws_rename', 8000],
  ['cmd_forget', 'cmd_ls', 2000],
  ['cmd_ws_restore', 'cmd_ws_attic', 5000],
  ['cmd_ws_reap', '_ws_reap_locked', 7000],
];

/**
 * THE SIX DIES A REFUSAL RECORD CANNOT DESCRIBE, each for one stated reason.
 * Four are `cmd_ws_reap`'s pre-lock rungs, which D15 leaves alone: three run
 * before `$id` has been validated at all and the fourth is the `_json_str`
 * probe — the emitter itself is what is missing there, so an emit would be the
 * thing being reported. Two are the `--reason` loop arms, which run before any
 * id is bound. The set is EXACT: a seventh sanctioned die reds the count.
 */
const SANCTIONED: readonly string[] = [
  'die "usage: ccd ws-rm [--reason <text>] <id>"',
  'die "usage: ccd forget [--reason <text>] <id>"',
  'die "usage: ccd ws-reap --expect <token> --session <id>"',
  'die "bad token"',
  'die "bad session id"',
  'die "python3 unavailable — cannot quote the reap record safely"',
];

describe('every die in a destructive verb is reached through _lc_refuse or _lc_fail', () => {
  it('found all four bodies, and each is substantial — the coverage floor', () => {
    // Without this, a rename or a refactor that moved one behind an indirection
    // would make every assertion below vacuously true over an empty string, and
    // the suite would stay green while the guard was gone.
    for (const [name, until, floor] of VERBS) {
      expect(bodyOf(name, until).length, `${name}'s body could not be sliced (looked for ${until})`)
        .toBeGreaterThan(floor);
    }
  });

  it('leaves no bare `die "` behind — every one is recorded or sanctioned', () => {
    // Mutant: add `die "nope"` to cmd_ws_rm -> this fails naming the line, and
    // a destruction is refused with nothing in the record to say so.
    const offenders: string[] = [];
    for (const [name, until] of VERBS) {
      const body = bodyOf(name, until);
      for (const m of body.matchAll(/(^|\s|\|\|\s*|;\s*|\{\s*)die "/g)) {
        const line = lineAt(body, m.index!);
        if (SANCTIONED.some((s) => line.includes(s))) continue;
        // The one recorded shape: a `die` inside the same `{ … }` block as an
        // `_lc_fail`, which is how a POST-teardown failure is written — the
        // record first, the death second, both explicit. 400 characters back is
        // enough for `_lc_fail`'s own continuation lines and no more.
        if (/_lc_fail /.test(body.slice(Math.max(0, m.index! - 400), m.index!))) continue;
        offenders.push(`${name}: ${line}`);
      }
    }
    expect(offenders,
      'a destructive verb refuses or fails without a record — route it through '
      + '_lc_refuse (before anything irreversible) or _lc_fail (after)').toEqual([]);
  });

  it('every sanctioned die is STILL THERE — a stale exemption is a hole', () => {
    // Mutant: convert `die "bad token"` and leave it in SANCTIONED -> this fails
    // with `a sanctioned die that no longer exists: [ 'die "bad token"' ]`.
    expect(SANCTIONED.length, 'the sanctioned set changed size').toBe(6);
    const all = VERBS.map(([n, u]) => bodyOf(n, u)).join('\n');
    expect(SANCTIONED.filter((s) => !all.includes(s)), 'a sanctioned die that no longer exists')
      .toEqual([]);
  });

  it('never puts an _lc_refuse inside `die` itself', () => {
    // That would fabricate a "refused destruction" for every usage error on
    // every verb in the file — the exact over-reach D15 forbids by name.
    const dieFn = src.slice(src.indexOf('die() {'), src.indexOf('die() {') + 200);
    expect(dieFn).not.toMatch(/_lc_/);
  });

  it('holds the reap emits at exactly two — one verdict point, one flock decline', () => {
    const reapRegion = src.slice(src.indexOf('cmd_ws_reap() {'), src.indexOf('# ── reclamation'));
    expect(reapRegion.length, 'the reap region could not be sliced').toBeGreaterThan(20000);
    expect([...reapRegion.matchAll(/_lc_emit reap refused/g)],
      'D15 authorises exactly two reap refusal emits; more is scope creep').toHaveLength(2);
  });

  it('the reap lock\'s two inner functions still contain NO die at all', () => {
    // MEASURED, not assumed: `_ws_reap_locked` and `_ws_reap_tail` answer in
    // JSON on stdout at exit 0 and never die, which is why the reap lane needs
    // no conversion. Pinning the zero is what catches a `die` added there later.
    for (const [name, until] of [['_ws_reap_locked', '_ws_reap_tail'],
                                 ['_ws_reap_tail', '_ws_gc_bytes']] as const) {
      const body = bodyOf(name, until);
      expect(body.length, `${name} could not be sliced`).toBeGreaterThan(15000);
      expect([...body.matchAll(/(^|\s|\|\|\s*|;\s*)die "/g)].map((m) => lineAt(body, m.index!)),
        `${name} grew a die — route it through _lc_fail, it is past the teardown`).toEqual([]);
    }
  });
});

describe('every refusal token ccd passes is a token L0 or wsaudit already owns', () => {
  it('holds the vocabularies set-equal in the direction wave 1 could not assert', () => {
    // Wave 1 ships `LC_REFUSAL_WORD` and a disjointness guard but no reverse
    // assertion, because it would be red until wave 3 lands. This is that
    // assertion. Mutant: pass `_lc_refuse destroy "$id" tip-unreadible …` ->
    // this fails with `tokens no vocabulary owns: [ 'tip-unreadible' ]`, and a
    // typo would reach the PWA as an untranslated token.
    const known = new Set<string>([...LC_REFUSAL_TOKENS, ...Object.keys(SENTENCES)]);
    const found = new Set<string>();
    for (const m of src.matchAll(/_lc_refuse\s+[a-z-]+\s+"[^"]*"\s+([a-z][a-z0-9-]*)/g)) found.add(m[1]!);
    for (const m of src.matchAll(/_lc_fail\s+[a-z-]+\s+"[^"]*"\s+"[^"]*"\s+([a-z][a-z0-9-]*)/g)) found.add(m[1]!);
    for (const m of src.matchAll(/_lc_emit\s+[a-z-]+\s+refused\s+"[^"]*"\s+""\s+verb\s+[a-z-]+\s+refusal\s+([a-z][a-z0-9-]*)/g)) found.add(m[1]!);
    expect(found.size, 'the scan found almost no tokens — it is vacuous').toBeGreaterThanOrEqual(14);
    expect([...found].filter((t) => !known.has(t)).sort(), 'tokens no vocabulary owns').toEqual([]);
  });
});
