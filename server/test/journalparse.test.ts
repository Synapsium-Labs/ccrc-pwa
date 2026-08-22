// L1, pure and TOTAL: `parseJournalLine` has no clock, no lookup, no registry
// and no other row, which is the whole of D8's re-measurement proof. Every
// assertion below is therefore a plain function call — no fixtures, no db.
import { describe, it, expect, vi } from 'vitest';
import { parseJournalLine, reviveMeas } from '../src/coord/journalparse.js';
import {
  LIFECYCLE_ACTS, LIFECYCLE_OUTCOMES, LC_ACT_UNKNOWN, LC_OUTCOME_UNKNOWN,
  LIFECYCLE_MEAS_KEYS,
} from '../../shared/api.js';

/** Taken from the vocabulary rather than written out: this file must not
 *  become a second holder of the act list (`single-definition.test.ts`). */
const AN_ACT = LIFECYCLE_ACTS.find((a) => a !== LC_ACT_UNKNOWN)!;
const AN_OUTCOME = LIFECYCLE_OUTCOMES.find((o) => o !== LC_OUTCOME_UNKNOWN)!;

const line = (over: Record<string, unknown> = {}): string => JSON.stringify({
  uid: '1755780000123456789.31415.7', at: 1_755_780_000_123,
  act: AN_ACT, outcome: AN_OUTCOME, verb: 'ws-rm', id: 'demo-quiet-basin',
  tx: '1755780000123456789.31415', ...over,
});

describe('parseJournalLine: it never throws, on anything', () => {
  it.each([
    ['empty', ''],
    ['not json', 'ws-rm demo-quiet-basin'],
    ['a bare array', '[1,2,3]'],
    ['a bare number', '42'],
    ['json null', 'null'],
    ['a truncated object', '{"uid":"1.2.3","act":'],
    ['a lone brace', '{'],
    // Added beyond the brief's list (task instructions: "test totality
    // adversarially, not just with the brief's cases").
    ['whitespace only', '   \t\n  '],
    ['an empty object', '{}'],
    ['a bare JSON string', '"hello"'],
    ['a bare JSON boolean', 'true'],
  ])('%s', (_name, raw) => {
    const r = parseJournalLine(raw);
    expect(r.act).toBe(LC_ACT_UNKNOWN);
    expect(r.outcome).toBe(LC_OUTCOME_UNKNOWN);
    expect(r.raw).toBe(raw);          // VERBATIM — D8's drill is byte equality
    expect(r.uid).toBeNull();
    expect(r.truncated).toBe(false);
  });
});

describe('parseJournalLine: adversarial totality — hostile inputs beyond the brief', () => {
  it('never throws on a wrong-typed field of every kind at once', () => {
    // Numbers where strings belong, strings/booleans where numbers belong,
    // an array where an object belongs, etc. — a hard guard first
    // (RULE 1: `expect.soft` does not stop execution).
    const raw = JSON.stringify({
      uid: 12345, at: 'not-a-number', act: 42, outcome: false, verb: true,
      id: ['not', 'a', 'string'], tx: { not: 'a string' }, refusal: 0,
      detail: null, truncated: 'true', badact: 99,
      obs: 'not an object', dec: [1, 2, 3], meas: 42,
    });
    const r = parseJournalLine(raw);
    expect(r, 'row exists at all').toBeDefined();
    expect.soft(r.uid, 'uid').toBeNull();
    expect.soft(r.at, 'at').toBeNull();
    expect.soft(r.act, 'act').toBe(LC_ACT_UNKNOWN);
    expect.soft(r.outcome, 'outcome').toBe(LC_OUTCOME_UNKNOWN);
    expect.soft(r.verb, 'verb').toBeNull();
    expect.soft(r.sessionId, 'sessionId').toBeNull();
    expect.soft(r.tx, 'tx').toBeNull();
    expect.soft(r.refusal, 'refusal').toBeNull();
    expect.soft(r.truncated, 'truncated').toBe(false);
    expect.soft(r.badact, 'badact — a non-string act has no token worth echoing').toBeNull();
    expect.soft(r.obs, 'obs — a non-object family collapses to null, never throws').toBeNull();
    expect.soft(r.dec, 'dec — an array is not a record').toBeNull();
    expect.soft(r.meas, 'meas — a bare number is not a record').toBeNull();
    expect.soft(r.raw, 'raw stays verbatim regardless').toBe(raw);
  });

  it('never throws on deeply nested JSON — measured, not assumed, against THIS runtime', () => {
    // FIX ROUND 1, F4: this comment previously stated as measured fact that a
    // bare `node script.mjs` reliably throws `RangeError: Maximum call stack
    // size exceeded` at 50,000 levels, and inferred that vitest's fork pool
    // has a much larger stack. Review re-ran the same claim on this box
    // (Node v24.14.1) with a standalone `.mjs` probe at 50,000 / 1,000,000 /
    // 5,000,000 levels, arrays and objects both, and got NO throw at any
    // depth — even in bare node. Re-measured here, independently, twice more:
    // a script shaped like the review's probe (a `probe(depth, kind)`
    // function called from a small loop, JSON.parse'd immediately) reproduces
    // NO THROW, deterministically, across three separate runs, even at
    // 5,000,000. But the ORIGINAL script this file's claim was measured from
    // (several unrelated `JSON.parse`/`JSON.stringify` calls first, THEN the
    // 50,000-deep call, all inline at a script's top level) reproduces THROW
    // just as deterministically, across three more separate runs, same box,
    // same Node — so the earlier claim was not fabricated, but its
    // EXPLANATION was wrong: this is not "plain node throws, vitest doesn't".
    // Whatever actually governs it — V8's JSON parser evidently is not
    // uniformly iterative regardless of context, contra a simpler read of
    // "it's iterative, so it can't overflow" — depends on something about the
    // calling script's shape or prior activity in the isolate that neither
    // review's re-test nor this re-measurement pinned down, and chasing V8
    // internals further is out of scope for this file. The one fact that
    // held in EVERY measurement, review's and ours: no depth found here is a
    // RELIABLE, portable way to hit the `RangeError` branch of
    // `parseJournalLine`'s `catch` on demand — so this test does not lean on
    // one. It keeps only the narrower, unconditionally-true claim below, and
    // the `vi.spyOn(JSON, 'parse')` case right after this one — deterministic
    // regardless of engine internals — is the actual proof of the guard.
    //
    // What IS still true and worth pinning regardless of any of the above: a
    // very large, successfully-parsed structure does not crash the parser
    // through some OTHER path (e.g. a recursive reviver walking the tree) —
    // `reviveObs`/`reviveDec`/`reviveMeas` only ever read named top-level
    // keys off the object JSON.parse already built, never recursing
    // themselves, so this is a real, if narrower, guarantee.
    const deepArray = '['.repeat(50_000) + '1' + ']'.repeat(50_000);
    const deepObject = '{"a":'.repeat(50_000) + '1' + '}'.repeat(50_000);
    for (const raw of [deepArray, deepObject]) {
      const r = parseJournalLine(raw);
      expect(r, 'row exists at all').toBeDefined();
      expect.soft(r.act, 'act').toBe(LC_ACT_UNKNOWN);
      expect.soft(r.outcome, 'outcome').toBe(LC_OUTCOME_UNKNOWN);
      expect.soft(r.raw, 'raw').toBe(raw);
    }
  });

  it('never throws when JSON.parse itself throws something other than SyntaxError', () => {
    // The deterministic version of the case above: rather than depend on a
    // stack depth that overflows in one Node invocation style and not
    // another, stub the global `JSON.parse` to throw the exact error class
    // the plain-node measurement produced (`RangeError`) and confirm
    // `parseJournalLine`'s `catch { … }` is untyped and still degrades
    // rather than propagating. This is what actually proves the implementation
    // does not special-case `SyntaxError` — the property the deep-nesting
    // scenario was trying, and failing in this runtime, to exercise.
    const spy = vi.spyOn(JSON, 'parse').mockImplementation(() => {
      throw new RangeError('Maximum call stack size exceeded');
    });
    try {
      const r = parseJournalLine('{"act":"whatever"}');
      expect(r.act).toBe(LC_ACT_UNKNOWN);
      expect(r.outcome).toBe(LC_OUTCOME_UNKNOWN);
      expect(r.raw).toBe('{"act":"whatever"}');
    } finally {
      spy.mockRestore();
    }
  });

  it('never throws on a very long line', () => {
    const raw = line({ detail: 'x'.repeat(2_000_000) });
    const r = parseJournalLine(raw);
    expect(r.detail?.length).toBe(2_000_000);
    expect(r.raw).toBe(raw);
  });

  it('never throws on lone surrogates or embedded NULs inside string values', () => {
    // Confirmed directly in node: `JSON.parse` accepts a lone high surrogate
    // (`\uD800`) or an embedded NUL byte inside a JSON string literal without
    // throwing — these are well-formed JSON/UTF-16 even though they are not
    // valid standalone Unicode. Exercised here so a future change to the
    // parsing strategy (e.g. swapping in a stricter decoder) cannot silently
    // start throwing on them.
    const raw = JSON.stringify({ act: AN_ACT, outcome: AN_OUTCOME, id: 'x\uD800y\u0000z' });
    const r = parseJournalLine(raw);
    expect(r.sessionId).toBe('x\uD800y\u0000z');
    expect(r.raw).toBe(raw);
  });

  it('cannot be poisoned by __proto__/constructor/prototype keys (prototype pollution)', () => {
    // JSON.parse gives `__proto__` etc. as OWN enumerable properties, never a
    // prototype mutation (confirmed directly in node: `Object.getPrototypeOf`
    // of the parsed object stays `Object.prototype`, and a global `{}` probe
    // shows no leaked property afterward). `journalparse.ts` never spreads or
    // `for...in`s an untrusted object onto anything — every reviver reads
    // named keys off it with bracket access into a fresh literal — so there
    // is no path for this to matter, but it is proven here rather than
    // assumed.
    const before = ({} as Record<string, unknown>)['polluted'];
    const raw = '{"act":"' + AN_ACT + '","outcome":"' + AN_OUTCOME + '",'
      + '"obs":{"__proto__":{"polluted":true},"cg":"agent"},'
      + '"dec":{"constructor":{"prototype":{"polluted2":true}},"surface":"cli"},'
      + '"meas":{"__proto__":{"polluted3":true},"project":"p"}}';
    const r = parseJournalLine(raw);
    expect.soft(r.obs?.cg, 'a sibling key beside __proto__ still reads through').toBe('agent');
    expect.soft(r.dec?.surface, 'a sibling key beside constructor still reads through').toBe('cli');
    expect.soft(r.meas?.project, 'a sibling key beside __proto__ still reads through').toBe('p');
    expect.soft(({} as Record<string, unknown>)['polluted'], 'no global pollution via obs').toBe(before);
    expect.soft(({} as Record<string, unknown>)['polluted2'], 'no global pollution via dec').toBe(before);
    expect.soft(({} as Record<string, unknown>)['polluted3'], 'no global pollution via meas').toBe(before);
  });

  it('never throws on `null` passed where a family object is expected', () => {
    const raw = line({ obs: null, dec: null, meas: null });
    const r = parseJournalLine(raw);
    expect.soft(r.obs).toBeNull();
    expect.soft(r.dec).toBeNull();
    expect.soft(r.meas).toBeNull();
  });
});

describe('parseJournalLine: the vocabulary', () => {
  it('reads a declared act and outcome through', () => {
    const r = parseJournalLine(line());
    expect(r.act).toBe(AN_ACT);
    expect(r.outcome).toBe(AN_OUTCOME);
    expect(r.badact).toBeNull();
    expect(r.sessionId).toBe('demo-quiet-basin');   // the wire says `id`, the row says sessionId
    expect(r.verb).toBe('ws-rm');
    expect(r.at).toBe(1_755_780_000_123);
  });

  it('degrades an act this build does not declare to `unknown` AND KEEPS THE TOKEN', () => {
    // A newer ccd. The row is INSERTED, not dropped: a byte we saw and could
    // not model is a different fact from a byte that was never there.
    const raw = line({ act: 'quarantine' });
    const r = parseJournalLine(raw);
    expect(r.act).toBe(LC_ACT_UNKNOWN);
    expect(r.badact).toBe('quarantine');
    expect(r.raw).toBe(raw);
    expect(r.uid).toBe('1755780000123456789.31415.7');   // still idempotent under replay
  });

  it("keeps ccd's own `badact` when ccd already degraded the act itself", () => {
    const r = parseJournalLine(line({ act: LC_ACT_UNKNOWN, badact: 'quarantine' }));
    expect(r.act).toBe(LC_ACT_UNKNOWN);
    expect(r.badact).toBe('quarantine');
  });

  // FIX ROUND 1, F1: `badoutcome` was entirely dropped before this round —
  // no field on `JournalRow`, `o['badoutcome']` never read — even though
  // ccd writes it today (`ccd/ccd:1351`, `:1417-1422`) and
  // `LifecycleEvent.badoutcome` (`shared/api.ts:4007-4010`) already declares
  // it with the identical invariant `badact` has. These two cases mirror the
  // two `badact` cases directly above, one per side of the pair.
  it('degrades an outcome this build does not declare to `unknown` AND KEEPS THE TOKEN', () => {
    const raw = line({ outcome: 'stalled' });
    const r = parseJournalLine(raw);
    expect(r.outcome).toBe(LC_OUTCOME_UNKNOWN);
    expect(r.badoutcome).toBe('stalled');
    expect(r.raw).toBe(raw);
  });

  it("keeps ccd's own `badoutcome` when ccd already degraded the outcome itself", () => {
    const r = parseJournalLine(line({ outcome: LC_OUTCOME_UNKNOWN, badoutcome: 'stalled' }));
    expect(r.outcome).toBe(LC_OUTCOME_UNKNOWN);
    expect(r.badoutcome).toBe('stalled');
  });

  // FIX ROUND 1, F2 (a forging vector, closed): `shared/api.ts:4003-4005` /
  // `:4007-4010` state the invariant in so many words — "null whenever `act`
  // [`outcome`] is not `LC_ACT_UNKNOWN` [`LC_OUTCOME_UNKNOWN`]. The two are
  // never both set." Before this round, `badact: badact ?? (act ===
  // LC_ACT_UNKNOWN ? actRaw : null)` read a caller-supplied `badact` key
  // FIRST regardless of what `act` resolved to, so a forged line pairing a
  // perfectly valid `act` with an attacker's own `badact` string came out
  // with BOTH set — exactly the signal `ccd/ccd:1417-1422`'s `_lc_emit`
  // guarantees never happens on a genuine line, and exactly what a reader
  // uses to decide "ccd's own vocabulary is stale". The journal is
  // append-only on a box with a single UNIX user (identity there is
  // attribution, not authentication), so this parser — not the writer — is
  // the boundary that has to hold the invariant against a forged line.
  // Mutant: revert `badact`/`badoutcome` to the old `x ?? (cond ? y : null)`
  // shape -> this goes red with `expected null to be 'forged-not-real'`.
  it('never carries a `badact`/`badoutcome` alongside a VALID `act`/`outcome` — forging is refused', () => {
    const forgedAct = line({ act: AN_ACT, badact: 'forged-not-real' });
    const rAct = parseJournalLine(forgedAct);
    expect(rAct.act).toBe(AN_ACT);
    expect(rAct.badact, 'a valid act must never carry a badact alongside it').toBeNull();

    const forgedOutcome = line({ outcome: AN_OUTCOME, badoutcome: 'forged-not-real' });
    const rOutcome = parseJournalLine(forgedOutcome);
    expect(rOutcome.outcome).toBe(AN_OUTCOME);
    expect(rOutcome.badoutcome, 'a valid outcome must never carry a badoutcome alongside it')
      .toBeNull();
  });

  it('reads the refusal token from `refusal`, never from `refused`', () => {
    // D15: `wsaudit.test.ts` greps ccd for /"refused":"…"/ and holds the result
    // set-equal to SENTENCES. A `refused` key here would mean ccd had written
    // one, which is the poisoning that test exists to catch.
    expect(parseJournalLine(line({ refusal: 'held' })).refusal).toBe('held');
    expect(parseJournalLine(line({ refused: 'held' })).refusal).toBeNull();
  });

  it('carries the top-level `detail` and `truncated` that the emitter writes beside them', () => {
    const r = parseJournalLine(line({ detail: 'held: program:build8 wave:2/4', truncated: true }));
    expect(r.detail).toBe('held: program:build8 wave:2/4');
    expect(r.truncated).toBe(true);
    // `truncated` is a BOOLEAN, three-condition-free: the key is either the
    // literal `true` or it is not there. A string 'true' is not an admission.
    expect(parseJournalLine(line({ truncated: 'true' })).truncated).toBe(false);
  });
});

describe('parseJournalLine: the three families never merge', () => {
  it('carries obs, dec and meas as three separate objects', () => {
    const r = parseJournalLine(line({
      obs: { cg: 'pane', cgraw: '0::/user.slice/x.scope', pid: 31415, ppid: 2,
             pane: 'cc-demo', paneWhy: 'ppid-ancestry', tty: true, ssh: null },
      dec: { surface: 'cli', actor: 'you', reason: 'stale wave' },
      meas: { project: 'demo', workspace: 'quiet-basin', branch: 'ws/quiet-basin',
              uuid: 'u', wrapper: 'claude', tip: 'abc', attic: 3,
              archivedAt: null, archivedReason: null, held: null },
    }));
    expect(r.obs?.cg).toBe('pane');
    expect(r.obs?.cgraw).toBe('0::/user.slice/x.scope');
    expect(r.dec?.surface).toBe('cli');
    expect(r.dec?.actor).toBe('you');
    expect(r.meas?.branch).toBe('ws/quiet-basin');
    expect(r.meas?.attic).toBe(3);
  });

  it('says NULL for a family the line did not carry — never an empty object', () => {
    const r = parseJournalLine(line());
    expect(r.obs).toBeNull();
    expect(r.dec).toBeNull();
    expect(r.meas).toBeNull();
  });

  it('tells "no flag was passed" from "a surface word this build cannot model"', () => {
    expect(parseJournalLine(line({ dec: { surface: 'none' } })).dec?.surface).toBe('none');
    expect(parseJournalLine(line({ dec: { surface: 'kiosk' } })).dec?.surface).toBe('unknown');
  });

  it('tells "no cgroup was read" from "one was read and matched nothing" — THREE conditions', () => {
    // `cg: null` is `corroboration` -> 'unmeasured'; `cg: 'unknown'` is
    // 'not-comparable'. Collapsing them would make an unread /proc look like a
    // disagreement the census could raise.
    const unread = parseJournalLine(line({ obs: { cgraw: null } }));
    expect(unread.obs?.cg).toBeNull();
    const unclassifiable = parseJournalLine(line({ obs: { cg: 'kubelet', cgraw: '0::/x' } }));
    expect(unclassifiable.obs?.cg).toBe('unknown');
    expect(unclassifiable.obs?.cgraw).toBe('0::/x');   // never dropped (D2)
  });

  it('says NULL for an `at` the line did not carry — 0 is a date, not an absence', () => {
    expect(parseJournalLine(line({ at: 'yesterday' })).at).toBeNull();
    expect(parseJournalLine(line({ at: undefined })).at).toBeNull();
  });

  // DEVIATION FROM THE BRIEF, recorded here (see journalparse.ts's own
  // deviation note beside `reviveMeas` for the full evidence trail): the
  // brief's version of this case is titled "models the TEN declared meas
  // keys" and asserts `Object.keys(r.meas!)` is exactly ten names, with
  // `workdir` as its example of a residual key that stays in `raw` only.
  // `LifecycleMeas` was widened to twenty-five required members in wave 2
  // (Task 21) and wave 3's fix round (Task 24) — both already shipped on
  // this branch before this task ran — so `workdir` (and `rc`) are now
  // MODELLED members, not residuals, and a `reviveMeas` restricted to ten
  // keys fails to typecheck against the interface it imports. This case is
  // rewritten to assert the shipped twenty-five (via `LIFECYCLE_MEAS_KEYS`,
  // derived rather than hand-listed a third time — `single-definition.
  // test.ts`'s own idiom) and to prove the residual mechanism still exists
  // for a key genuinely outside that closed set.
  it('models the twenty-five declared meas keys, and leaves anything beyond them in `raw`', () => {
    const raw = line({
      meas: { project: 'demo', workdir: '/w/demo-quiet-basin', rc: '0', notAKey: 'nope' },
    });
    const r = parseJournalLine(raw);
    expect(Object.keys(r.meas!).sort()).toEqual([...LIFECYCLE_MEAS_KEYS].sort());
    expect(r.meas!.project).toBe('demo');
    expect(r.meas!.workdir).toBe('/w/demo-quiet-basin');   // now modelled, not a residual
    // `rc` IS one of the twenty-five, but the wire sent it as a STRING
    // ('0'); `n()` requires `typeof === 'number'`, so a wrong-typed `rc`
    // still degrades to null rather than silently coercing "0" to 0 — a
    // coerced value here would be indistinguishable from a genuinely
    // measured zero.
    expect(r.meas!.rc).toBeNull();
    // `notAKey` is outside the closed twenty-five altogether — this is the
    // brief's residual mechanism, still alive, just for a key past the
    // (now much larger) modelled set rather than for `workdir`.
    expect(r.raw).toContain('"notAKey":"nope"');
    expect(reviveMeas({ project: 'demo' })!.project).toBe('demo');
  });

  it('narrows `meas.atticsrc` to its three declared members, collapsing an unrecognised token to null', () => {
    expect(parseJournalLine(line({ meas: { atticsrc: 'worktree' } })).meas?.atticsrc).toBe('worktree');
    expect(parseJournalLine(line({ meas: { atticsrc: 'registry' } })).meas?.atticsrc).toBe('registry');
    expect(parseJournalLine(line({ meas: { atticsrc: 'none' } })).meas?.atticsrc).toBe('none');
    // No fourth `'unknown'` member exists on this type (unlike `cg`/
    // `surface`), so an out-of-vocabulary token has nowhere type-safe to
    // land and collapses to null — same treatment as every other
    // wrong-typed scalar in this file. The byte is still in `raw`.
    const raw = line({ meas: { atticsrc: 'quarantine' } });
    const r = parseJournalLine(raw);
    expect(r.meas?.atticsrc).toBeNull();
    expect(r.raw).toContain('"atticsrc":"quarantine"');
  });
});
