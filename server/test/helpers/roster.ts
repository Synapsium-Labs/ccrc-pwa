// Leaf module for DEFAULT_TEST_ROSTER — extracted from helpers.ts so that
// ccdWsHelpers.ts (and anything else that only needs the roster) does not
// transitively import helpers.ts → config.ts → shared/api.ts, which pulls
// ~86% of the server test suite into CI's dependency map for any api.ts
// change. helpers.ts re-exports DEFAULT_TEST_ROSTER, so every existing
// import keeps working. This file imports nothing from server/src except
// types (none needed — the roster is a plain object literal).

/**
 * The TEST default roster — deliberately NOT the single-`claude` roster a
 * fresh install ships (`deploy/accounts.default.json`, Task 10 of the
 * stage-2a plan). Over twenty files under `server/test/` exercise the other
 * four accounts by id (`dialog.test.ts` resolves `configDirFor(cfg,
 * 'claude-a')` and expects a real path back, for example), so the test
 * default has to be a five-account roster with every `exec` kind, a
 * non-home-able member, and ids that collide the way real ones do.
 *
 * THE ROSTER IS FIXTURES' OWN, NOT ANY FLEET'S (Stage 5, spec §5). It used
 * to be a byte-for-byte mirror of the reference fleet's five real accounts
 * (`deploy/accounts.migration.json`, deleted in the same task that renamed
 * these entries), which put one operator's wrapper names and account labels
 * at the root of every suite. What the tests ever actually consumed was the
 * SHAPE — one `upstream`, three `generated` (two with a `secretsFile`, one
 * without), one `external`/non-home-able/`telemetry:'none'`; hues spanning
 * five of the six; ids where a shorter one is a strict prefix of longer
 * ones — so the shape stayed and the names went neutral (`gpt` excepted,
 * see its entry). `claude` is a strict prefix of its three renamed siblings
 * and those three tie on length, which exercises `byIdLengthDesc`'s
 * tie-break (id ascending) harder than the old names did.
 *
 * This is also the ROOT copy of the account names in TypeScript, and
 * deliberately so: it is TEST data, under a directory the roster-drift
 * scanner (`single-definition.test.ts`) does not scan — and that scanner
 * reads its own list of wrapper names FROM here, because the roster it hunts
 * for copies of no longer exists in any source file it could trust to read
 * them from.
 *
 * ROOT, AND THE ONLY OTHER COPY IS DERIVED FROM IT.
 * `test/fixtures/ccdMirror.ts` DERIVES its ids, config dirs and home-able
 * flags from this object — adding only the two concepts ccd has and the roster
 * does not, `label` (statusline's display string) and `ccdValid` — and throws
 * at import if the two disagree, so it cannot drift. It STAYS: Task 9
 * considered deleting it once its last reader grew a generated-bash ⇄ server
 * TypeScript round-trip, and ruled against, because that round-trip checks
 * per-input agreement while the four describes still reading this fixture
 * check ccd's whole bash ANSWER SPACE against the roster in both directions —
 * a different property neither replaces. The ruling is recorded in
 * `ccdMirror.ts`'s own header.
 *
 * `pwa/src/lib/accounts.ts`'s `PRODUCTION_ROSTER` — the one genuinely
 * independent hand-typed copy, the thing the PWA could not yet get off the
 * wire — is GONE, deleted in Task 7. `single-definition.test.ts` no longer
 * names it as the single allowed holder: it asserts `toEqual([])`, i.e. NO
 * shipped source file under the four scanned roots holds a compile-time copy
 * of the roster at all. */
export const DEFAULT_TEST_ROSTER = {
  version: 1,
  accounts: [
    {
      id: 'claude', label: 'claude', configDirSuffix: '.claude',
      exec: { kind: 'upstream' }, homeAble: true, hue: 'cyan', telemetry: 'anthropic',
    },
    {
      id: 'claude-a', label: 'claude-a', configDirSuffix: '.claude-a',
      exec: { kind: 'generated', secretsFile: '.cc-secrets/claude-a-oauth.env' },
      homeAble: true, hue: 'violet', telemetry: 'anthropic',
    },
    {
      // The one account whose LABEL IS NOT ITS ID, deliberately (M9, final
      // review of the stage-2a plan). Every other entry here labels itself
      // with its own id, which made `label` and `id` indistinguishable on
      // the wire: `accounts-route.test.ts`'s roster assertion would have
      // passed just the same if the handler had emitted `a.id` for `label`,
      // and the PWA renders `label`. One discriminating row is enough to
      // make that assertion able to fail.
      id: 'claude-b', label: 'team·b', configDirSuffix: '.claude-b',
      exec: { kind: 'generated' }, homeAble: true, hue: 'blue', telemetry: 'anthropic',
    },
    {
      // `gpt` KEEPS its name through the stage-5 de-brand (D-202): it names
      // OpenAI's backend, not this fleet — and ccd's shipped bash keys its
      // Codex lane on this literal roster id (`_gpt_enabled() { _account_ok
      // gpt; }`, and `_codex_lanes`' pre-CCRC_CODEX_BACKEND fallback). Rename
      // it here and every gpt-lane test goes dark.
      //
      // `telemetry: 'none'`, and it STAYS that way — reverted 2026-09-14, the
      // same day it was briefly flipped to `'codex'` to make a `ccd ls` trailer
      // assertion green. That flip was backwards. `'none'` is not a misstatement
      // about a Codex lane: it is exactly what `ccrc account declare` and the
      // adopt path WRITE for an `exec.kind: 'external'` account
      // (`deploy/account-op.mjs`'s `declaredEntry`, pinned byte-for-byte by
      // ccrc-account.test.ts, and adopt.test.ts's `expect(gpt.telemetry)
      // .toBe('none')`). Nothing in this repo ever writes `'codex'`; a roster
      // only carries it after an operator edits it by hand, which is how the
      // live fleet's gpt/gpt7 got theirs on 2026-09-11.
      //
      // So this row is the shape the PRODUCT can actually produce, and bending
      // it to the post-edit value left the declare-shaped case guarded by
      // nothing while costing 11 unrelated tests that count this roster.
      // Coverage for a `'codex'` lane belongs in a purpose-built roster —
      // ccd-backend-vs-placement.test.ts has three of them — not here.
      id: 'gpt', label: 'gpt', configDirSuffix: '.claude-gpt',
      exec: { kind: 'external' }, homeAble: false, hue: 'magenta', telemetry: 'none',
    },
    {
      id: 'claude-d', label: 'claude-d', configDirSuffix: '.claude-d',
      exec: { kind: 'generated', secretsFile: '.cc-secrets/claude-d-oauth.env' },
      homeAble: true, hue: 'green', telemetry: 'anthropic',
    },
  ],
};
