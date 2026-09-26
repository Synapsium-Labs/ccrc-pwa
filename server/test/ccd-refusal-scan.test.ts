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

/** D4's four destructive verbs, and ws-reclaim (child reclamation, wave 3) as the fifth. Floors are measured minima, not guesses. */
const VERBS: readonly (readonly [string, string, number])[] = [
  ['cmd_ws_rm', 'cmd_ws_rename', 8000],
  ['cmd_forget', 'cmd_ls', 2000],
  ['cmd_ws_restore', 'cmd_ws_attic', 5000],
  ['cmd_ws_reap', '_ws_reap_locked', 7000],
  // Measured 4091 characters for cmd_ws_reclaim's pre-lock parse and lock when
  // this entry was written; the floor sits under it with room for an edit.
  ['cmd_ws_reclaim', '_ws_reclaim_locked', 3500],
];

/**
 * THE THIRTEEN DIES A REFUSAL RECORD CANNOT DESCRIBE, each for one stated reason.
 * Four are `cmd_ws_reap`'s pre-lock rungs, which D15 leaves alone: three run
 * before `$id` has been validated at all and the fourth is the `_json_str`
 * probe — the emitter itself is what is missing there, so an emit would be the
 * thing being reported. Two are the `--reason` loop arms, which run before any
 * id is bound. The set is EXACT: a fourteenth sanctioned die reds the count.
 *
 * Seven are cmd_ws_reclaim's (child reclamation, wave 3), for reap's own reasons: its usage line and run-id shape check run before $id is bound, its four --actor/--reason checks are the loop arms that run before any id is bound, and its _json_str probe is the emitter being missing. Its "bad token" and "bad session id" are the SAME literals as reap's and need no second entry.
 */
const SANCTIONED: readonly string[] = [
  'die "usage: ccd ws-rm [--reason <text>] <id>"',
  'die "usage: ccd forget [--reason <text>] <id>"',
  'die "usage: ccd ws-reap --expect <token> --session <id>"',
  'die "bad token"',
  'die "bad session id"',
  'die "python3 unavailable — cannot quote the reap record safely"',
  'die "usage: ccd ws-reclaim --expect <token> --child-of <runId> --session <id> [--defer-expired] [--surface <word>] [--actor <text>] [--reason <text>]"',
  'die "bad run id"',
  'die "python3 unavailable — cannot quote the reclaim record safely"',
  'die "--actor must be non-blank"',
  'die "--actor is longer than $_LC_DEC_MAX bytes"',
  'die "--reason must be non-blank"',
  'die "--reason is longer than $_LC_DEC_MAX bytes"',
];

describe('every die in a destructive verb is reached through _lc_refuse or _lc_fail', () => {
  it('found every body, and each is substantial — the coverage floor', () => {
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
    expect(SANCTIONED.length, 'the sanctioned set changed size').toBe(13);
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

  it('holds the reclaim emits at exactly two — one verdict point, one flock decline (child reclamation, wave 3)', () => {
    // `_ws_reclaim_locked` routes EVERY ladder refusal, the token mismatch and
    // the flavour refusal through one `_lc_emit`; the lock decline in
    // `cmd_ws_reclaim` is the second. A third is a refusal path that bypasses
    // the verdict point, which is where the journal's completeness is decided.
    const region = src.slice(src.indexOf('RECLAIM-BEGIN'), src.indexOf('RECLAIM-END'));
    expect(region.length, 'the reclaim region could not be sliced').toBeGreaterThan(20000);
    expect([...region.matchAll(/_lc_emit reclaim refused/g)]).toHaveLength(2);
  });

  it('the reclaim lock\'s two inner functions contain NO die — past the lock, a failure is _lc_fail and JSON', () => {
    for (const [name, until, floor] of [
      ['_ws_reclaim_locked', '# ── end child reclamation', 2500],
      ['_ws_reclaim_tail', 'cmd_ws_reclaim() {', 9000],
    ] as const) {
      const from = src.indexOf(`${name}() {`);
      const body = from > -1 ? src.slice(from, src.indexOf(until, from)) : '';
      expect(body.length, `${name} could not be sliced`).toBeGreaterThan(floor);
      expect([...body.matchAll(/(^|\s|\|\|\s*|;\s*)die "/g)].map((m) => lineAt(body, m.index!)),
        `${name} grew a die — past the lock, route it through _lc_fail and the "failed" document`).toEqual([]);
    }
  });
});

describe('every literal refusal argument ccd carries is a token L0 or wsaudit already owns', () => {
  it('holds literal refusal arguments set-equal to the vocabularies in both directions', () => {
    // Wave 1 shipped `LC_REFUSAL_WORD` and a disjointness guard but could not
    // assert either cross-language direction until wave 3 landed. A literal typo
    // at a call site would reach the PWA untranslated; a stale declared token
    // would preserve dead vocabulary after its final literal producer disappeared.
    const known = new Set<string>([...LC_REFUSAL_TOKENS, ...Object.keys(SENTENCES)]);
    const found = new Set<string>();
    for (const m of src.matchAll(/_lc_refuse\s+[a-z-]+\s+"[^"]*"\s+([a-z][a-z0-9-]*)/g)) found.add(m[1]!);
    for (const m of src.matchAll(/_lc_fail\s+[a-z-]+\s+"[^"]*"\s+"[^"]*"\s+([a-z][a-z0-9-]*)/g)) found.add(m[1]!);
    // `_ws_reclaim_fail id lctx <token> detail` (child reclamation, wave 3) is
    // `_lc_fail reclaim` with its stdout document written from the same detail:
    // its third argument IS the journal token, so it is a literal position too.
    for (const m of src.matchAll(/_ws_reclaim_fail\s+"[^"]*"\s+"[^"]*"\s+([a-z][a-z0-9-]*)/g)) found.add(m[1]!);
    for (const m of src.matchAll(/_lc_emit\s+[a-z-]+\s+refused\s+"[^"]*"\s+""\s+verb\s+[a-z-]+\s+refusal\s+([a-z][a-z0-9-]*)/g)) found.add(m[1]!);
    expect(found.size, 'the scan found almost no tokens — it is vacuous').toBeGreaterThanOrEqual(14);
    expect([...found].filter((t) => !known.has(t)).sort(), 'tokens no vocabulary owns').toEqual([]);
    expect(LC_REFUSAL_TOKENS.filter((t) => !found.has(t)).sort(),
      'declared journal-only tokens with no literal ccd call-site argument').toEqual([]);
  });
});
