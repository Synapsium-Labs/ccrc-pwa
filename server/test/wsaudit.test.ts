import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseAudit, parseReap, refusalSentence, SENTENCES } from '../src/wsaudit.js';
import { CCD } from './ccdWsHelpers.js';

/**
 * The refusal-token <-> copy linkage, required by Task 13. `ccd` answers
 * refusals as TOKENS (`_reap_refuse dirty-tree …`, `printf '{"refused":"…"}'`,
 * `printf '"verdict":"…"'`, and the two `!token` lines the embedded python
 * writes for `_pr_py pick`) and `refusalSentence` turns each into copy a
 * person reads. NOTHING before this test linked the two, so renaming a token
 * in `ccd` failed no test and the UI silently fell back to
 * `ccrc declined: <token>.` — measured once already: `branch-drift` became
 * `registry-branch-drift` and nothing here noticed until a human read the
 * sheet by hand. This test enumerates ccd's own source for every token it can
 * emit into `verdict`/`refused` and checks BOTH directions against
 * `wsaudit.ts`'s own `SENTENCES` map — not a second, hand-maintained list that
 * could itself drift from either side.
 *
 * Four emission shapes, each a literal-token grep over ccd's source text:
 *   - `_reap_refuse <token> "…"` — every guard in `_ws_reap_eval` (Phase A-D1),
 *     which backs BOTH `cmd_ws_audit`'s non-reapable verdict and
 *     `cmd_ws_reap`'s "evaluated" refusal (`$REAP_VERDICT`, dynamic on the wire
 *     but drawn from exactly this literal set).
 *   - `printf '{"refused":"<token>",…}'` — the refusals `cmd_ws_reap` and
 *     `_ws_reap_locked`/`_ws_reap_tail` emit directly: the flock contest
 *     (`in-progress`), the resume path's re-proofs (`branch-moved` x3,
 *     `tree-unreadable`, `dirty-tree`, `sensitive-ignored`, `status-unknown`,
 *     `session-busy` — the last five re-using `_ws_reap_eval`'s own tokens),
 *     the token mismatch (`state-changed`), the breadcrumb ccd never wrote
 *     (`reaping-phase-unknown`, Task 7 / deviation 35), and the worktree
 *     removal itself (`worktree-remove-failed`).
 *   - `printf '"verdict":"<token>"'` — `cmd_ws_audit`'s own two literal
 *     verdicts, `reapable` (success — excluded below, it is never a refusal
 *     and `parseAudit` gives it an EMPTY sentence) and `reap-interrupted` (not
 *     literally a "refusal" either — Task 7's third verdict, deviation 19 —
 *     but it still needs a sentence, since `parseAudit` routes every
 *     non-`reapable` verdict through `refusalSentence`).
 *   - `'!<token>` — `_pr_py pick`'s two bare `sys.stdout.write` literals
 *     (`!pr-head-not-ours`, `!not-merged`); `_ws_reap_eval`'s
 *     `_reap_refuse "${row#!}"` re-emits whichever of the two python chose, so
 *     the token itself only exists as a python string literal, not as a bash
 *     one.
 *
 * What this deliberately does NOT chase: `die "…"` failures (`cmd_ws_audit`'s
 * bad-session-id / python-unavailable guards) never produce `verdict`/
 * `refused` JSON at all — they exit non-zero with a bare stderr string, which
 * `parseAudit`/`parseReap` treat as an unparseable body (502 / indeterminate),
 * never as a token reaching `refusalSentence`. Out of scope for the same
 * reason `wsaudit.ts` never sees them.
 */
describe('refusal-token <-> sentence linkage (ccd source <-> wsaudit.ts SENTENCES)', () => {
  const ccdSrc = readFileSync(CCD, 'utf8');

  const tokens = new Set<string>();
  for (const m of ccdSrc.matchAll(/_reap_refuse\s+([a-zA-Z][a-zA-Z0-9_-]*)\b/g)) tokens.add(m[1]!);
  for (const m of ccdSrc.matchAll(/"refused":"([a-zA-Z0-9-]+)"/g)) tokens.add(m[1]!);
  for (const m of ccdSrc.matchAll(/'!([a-zA-Z0-9-]+)/g)) tokens.add(m[1]!);
  for (const m of ccdSrc.matchAll(/"verdict":"([a-zA-Z0-9-]+)"/g)) {
    if (m[1] !== 'reapable') tokens.add(m[1]!);
  }
  const ccdTokens = [...tokens].sort();

  it('found a plausible number of tokens in ccd\'s source (sanity floor on the scan itself)', () => {
    // Guards against the scan finding nothing because CCD is wrong, or a
    // ccd refactor moving every refusal behind one indirection the regexes
    // above cannot see — either of which would make every assertion below
    // vacuously true over an empty set.
    expect(ccdTokens.length).toBeGreaterThan(30);
  });

  it('every token ccd can emit has a non-fallback sentence', () => {
    const missing = ccdTokens.filter((t) => !(t in SENTENCES));
    expect(missing, `ccd can emit these but SENTENCES has no entry — the UI would show ` +
      `"ccrc declined: <token>." for each: ${missing.join(', ')}`).toEqual([]);
    // Belt and braces: go through the real function, not just the map, so a
    // future SENTENCES[token] = undefined (present key, no value) cannot slip
    // through the `in` check above.
    for (const t of ccdTokens) {
      expect(refusalSentence(t), `refusalSentence(${t}) fell back to the generic frame`)
        .not.toBe(`ccrc declined: ${t}.`);
    }
  });

  it('every sentence in wsaudit.ts maps to a token ccd can actually emit', () => {
    // The reverse direction: a sentence for a token ccd no longer writes (a
    // stale entry left behind by a rename) is dead copy — harmless today, but
    // it is exactly the shape the `branch-drift` incident left behind right
    // up until something renamed it a SECOND time onto a live token by
    // coincidence. Catching it here means a rename is a one-line diff instead
    // of an archaeology project.
    const stale = Object.keys(SENTENCES).filter((t) => !ccdTokens.includes(t));
    expect(stale, `SENTENCES has copy for these but ccd's source no longer emits them: ${stale.join(', ')}`)
      .toEqual([]);
  });

  it('the two sets are exactly equal — the full enumerated token list', () => {
    // Both directions in one assertion, and the list itself is what Task 13's
    // report quotes: every refusal token ccd can emit, alphabetically.
    expect(Object.keys(SENTENCES).sort()).toEqual(ccdTokens);
  });
});

describe('refusalSentence', () => {
  it('falls back to a neutral frame for a token with no mapped copy, rather than blank', () => {
    expect(refusalSentence('some-future-token-nobody-mapped-yet'))
      .toBe('ccrc declined: some-future-token-nobody-mapped-yet.');
  });

  it('maps clips-unreadable, and says WHICH directory rather than describing a worktree', () => {
    // The sixteenth measurement forgery: `~/.cc-clips/<id>` exists and ccd
    // cannot list it, so the sheet cannot name what the delete would destroy.
    // `tree-unreadable`'s copy is about a WORKTREE and would send the reader
    // to the wrong directory; the pastes are the one thing on that sheet that
    // exists in no commit and nowhere else. `ReapSheet` renders
    // `audit.sentence` and never `audit.detail`, so the remedy has to be here.
    const s = refusalSentence('clips-unreadable');
    expect(s).toMatch(/pasted images/i);
    expect(s).toContain('.cc-clips');
    expect(s).toMatch(/nothing was removed/i);
  });

  it('maps reaping-phase-unknown — the Task 7 token this task was holding open for', () => {
    // Deviation 35: fires when a `reaping` breadcrumb names a phase ccd never
    // wrote. The run refuses and destroys nothing — the sentence must say so,
    // not describe a dirty tree or a moved branch.
    expect(refusalSentence('reaping-phase-unknown')).toMatch(/marker ccrc does not recognise/i);
  });
});

describe('parseAudit', () => {
  // ONE canonical full-shape fixture, reused by every test below that needs a
  // valid audit. `reviveWsAudit` is a strict revive now (Task 10): a minimal
  // `{verdict:'x'}`-shaped object, which the pre-revive tests here used to
  // feed, is malformed by the full-shape contract and now returns null —
  // exactly the behaviour these tests exist to pin, not a regression to
  // paper over with a looser fixture.
  const FULL_AUDIT_INPUT = {
    id: 'demo-quiet-basin', branch: 'ws/quiet-basin', base: 'origin/main', workdir: '/w',
    project: 'demo', repo: 'o/r', exists: true, headMatchesRegistry: true, reaping: null,
    dirty: [], ignored: [], ignoredCount: 0, ignoredBytes: 0, sensitive: [], sensitiveFiltered: 0,
    clips: [], stashes: 0, worktreeBytes: 1200000000, commitsAheadOfBase: 3,
    pr: { number: null, url: '', mergeCommit: '', headRefOid: '' },
    merge: { proof: null, fetchedAt: null },
    transcript: '/t.jsonl', children: [], verdict: 'reapable', detail: '', token: 'a'.repeat(64),
  };

  it('returns null for stdout that is not one JSON object (die\'s bare stderr, truncation, …)', () => {
    expect(parseAudit('ccd: bad session id')).toBeNull();
    expect(parseAudit('')).toBeNull();
    expect(parseAudit('[1,2,3]')).toBeNull();
  });

  it('returns null for a JSON object that has a verdict but is otherwise malformed — a minimal {verdict} is not a WsAudit', () => {
    // Pre-revive, `parseAudit` blindly spread this through and the missing
    // fields simply read as `undefined` on the wire. Post-revive, `id`,
    // `branch`, `pr`, `merge`, etc. are all required, so this is exactly the
    // "one bad session rejects the whole thing" rule `reviveFleetSession`
    // already applies, now applied here too.
    expect(parseAudit(JSON.stringify({ verdict: 'reapable', detail: '', token: 'a'.repeat(64) }))).toBeNull();
  });

  it('gives the reapable verdict an EMPTY sentence — it is not a refusal', () => {
    const audit = parseAudit(JSON.stringify(FULL_AUDIT_INPUT));
    expect(audit?.sentence).toBe('');
  });

  it('gives every non-reapable verdict a sentence, reap-interrupted included', () => {
    const audit = parseAudit(JSON.stringify({ ...FULL_AUDIT_INPUT, verdict: 'reap-interrupted', detail: 'x' }));
    expect(audit?.sentence).toMatch(/stopped part-way/i);
  });

  it('malformed children (a string, not an array or null) makes the whole audit unrevivable → null', () => {
    const audit = parseAudit(JSON.stringify({ ...FULL_AUDIT_INPUT, children: 'nope' }));
    expect(audit).toBeNull();
  });

  it('children round-trips — a registered entry and a stray entry with all-null fields preserved', () => {
    const children = [
      { path: '/w/.claude/worktrees/agent-a', branch: 'ca', headOid: 'a'.repeat(40), dirty: 1, busy: null, stray: false },
      { path: '/w/.claude/worktrees/stray-x', branch: null, headOid: null, dirty: null, busy: null, stray: true },
    ];
    const audit = parseAudit(JSON.stringify({ ...FULL_AUDIT_INPUT, children }));
    expect(audit?.children).toEqual(children);
  });

  it('an unknown field ccd might emit is DROPPED from the result — revive discipline, not a passthrough', () => {
    const audit = parseAudit(JSON.stringify({ ...FULL_AUDIT_INPUT, futureField: 'a surprise from a newer ccd' }));
    expect(audit).not.toBeNull();
    expect(Object.prototype.hasOwnProperty.call(audit as object, 'futureField')).toBe(false);
  });

  it('children: null and children: [] both survive revive distinctly', () => {
    const withNull = parseAudit(JSON.stringify({ ...FULL_AUDIT_INPUT, children: null }));
    const withEmpty = parseAudit(JSON.stringify({ ...FULL_AUDIT_INPUT, children: [] }));
    expect(withNull?.children).toBeNull();
    expect(withEmpty?.children).toEqual([]);
  });
});

describe('parseReap', () => {
  it('a refusal is parsed from stdout regardless of exit code, and gets a sentence', () => {
    const r = parseReap('{"refused":"dirty-tree","detail":"1 file","paths":[]}', 0, '');
    expect(r.refused).toBe('dirty-tree');
    expect(r.sentence).toMatch(/uncommitted/i);
  });

  it('a success object gets an empty sentence', () => {
    const r = parseReap('{"reaped":"x","branch":"ws/x"}', 0, '');
    expect(r.reaped).toBe('x');
    expect(r.sentence).toBe('');
  });

  it('empty stdout, non-empty stderr, non-zero exit: a real failure, not indeterminate', () => {
    const r = parseReap('', 1, 'ccd: flock unavailable');
    expect(r.indeterminate).toBeUndefined();
    expect(r.refused).toBe('error');
    expect(r.sentence).toContain('flock unavailable');
  });

  it('a held workspace reaches the phone as a NAMED refusal, not as the shell string that caused it', () => {
    // Build 2.5. FAILS without `SENTENCES['held']`: `refusalSentence` falls
    // back to `ccrc declined: held.`, which is the generic frame this map
    // exists to avoid — and the linkage test above fails outright, since the
    // two sets are held exactly equal.
    const r = parseReap(
      '{"refused":"held","detail":"program:x wave:2/4 — release first: ccd ws-release --session demo-quiet-basin","paths":[]}',
      0, '');
    expect(r.refused).toBe('held');
    expect(r.sentence).not.toBe('ccrc declined: held.');
    expect(r.sentence).toMatch(/mid-flight/i);
    // The reason string travels in `detail` and is NOT what the sheet renders
    // (`ReapSheet` renders `sentence`), so the remedy has to be in the
    // sentence — the rule `stash-unreadable` and `child-unpushed` state.
    expect(r.sentence).toMatch(/release/i);
    expect(r.detail).toContain('program:x wave:2/4');
  });

  it('the SAME refusal answered ccd-style with `die` would be an `error` — which is WHY the reap rung emits a token', () => {
    // Not a regression pin on new code: the counterfactual, written down where
    // the classifier lives. It passes before and after the ccd change, and it
    // is what makes the ccd-side comment ("a `die` here puts a bash command on
    // a phone screen") checkable rather than assertion.
    const r = parseReap('', 1,
      'ccd: held: program:x wave:2/4 — release first: ccd ws-release --session demo-quiet-basin');
    expect(r.refused).toBe('error');
    expect(r.sentence).toContain('ccd ws-release --session demo-quiet-basin');
  });

  it('empty stdout, empty stderr, exit 0: not indeterminate either — indeterminate is specifically a NON-ZERO exit with nothing on stderr', () => {
    const r = parseReap('', 0, '');
    expect(r.indeterminate).toBeUndefined();
    expect(r.refused).toBe('error');
    expect(r.detail).toBe('');
    // No stderr text to fall back to, so the generic frame — pinned exactly,
    // since nothing else in this suite renders it verbatim.
    expect(r.sentence).toBe('ccrc could not clean up this workspace.');
  });
});
