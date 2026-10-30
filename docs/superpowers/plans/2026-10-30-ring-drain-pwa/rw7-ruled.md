# Ring drain, PWA half, Task RW7: operator act OA1 ruled — the skin registry declares `L4 composition` (D-7576)

**What this is.** The ruling record that the PWA ring-drain plan (`docs/superpowers/plans/2026-10-30-consolidation-ring-exemption-drain-pwa.md`, §Operator acts OA1, §Gates, Task RW7) requires before RW7 is dispatched. It is docs only: it builds nothing and edits no plan. RW7's own number stays D-7575 (the plan defines it); the ruling itself is D-7576, defined in `docs/superpowers/plans/2026-10-30-ring-drain-pwa-oa1-ruled.md`.

## The ruling

On 2026-10-30 the operator ruled **OA1 option (a)**, the plan's recommendation: `pwa/src/skins/index.ts` declares `L4 composition` in its header, by the spec's header grammar ("a declaration moves a file outward of what its facts give", `composition` being one of its words), the same mechanism that places `pwa/src/fleet/openers.ts` (`// L4 delivery:`, D-6441). The file stops reading L1, so both component-set pairs out of it drain in one commit, and `PWA_L1_EXEMPTIONS` reaches 0.

Options (b) (keep the two entries as standing debt, re-dated every 60 days) and (c) (move `SKIN_SETS` into `app.tsx`) are **not** taken.

**The precedent is bounded.** This is the PWA's first use of the `composition` word. The ruling covers this one file only (plan §Review focus 7): no other file gains a header declaration under this ruling, and a later file that wants one is a new operator act.

## What RW7 must now do

RW7 is unblocked and is built exactly as the plan's "Under OA1 option (a)" Files list says. Nothing in the plan's Files needs rewriting by the coordinator. In short:

1. **Step 0, re-ground** on a fresh `origin/main`: this file is on `main` and names option (a); `server/test/rings/ring.ts#pwaRing` gives `skins/index.ts` L1 on the base and `{ ring: 'L4', why: 'declares L4 in its header' }` on a scratch copy with the new first line; `pwa/test/skin-identity.test.ts`'s case (o) still finds `app.tsx` as the one importer; the set's size at the base (so whether this commit empties it); the CONTROL row's first assertion in `server/test/rings/exemption-age.test.ts`.
2. **Characterization:** `skin-identity.test.ts` and `skin-switch.test.tsx` run unedited and green on the base.
3. **Drain commit (−2), D-7575:**
   - `pwa/src/skins/index.ts`: the header's first line `// The one map from a skin id to its parts (D-5469). …` becomes `// L4 composition: the one map from a skin id to its parts (D-5469). …`. The comment's other lines, `SKIN_SETS`, its imports and its re-export keep their bytes. No runtime byte changes.
   - `server/test/rings/pwa-rings.test.ts`: a new row directly after "pwa/src/fleet/openers.ts is L4 by its header declaration", titled `pwa/src/skins/index.ts is L4 by its header declaration (OA1)`, asserting `{ ring: 'L4', why: 'declares L4 in its header' }`, with a two-line comment citing this file and D-7575.
   - `server/test/rings/pwa-rings.data.ts`: both `pwa/src/skins/index.ts -> …/parts.tsx` keys deleted (D-7575's named exception to one edge per commit: the source leaves L1). If the set reaches 0, the stamp reads `size: 0, reason: 'empty since D-7575 (ARCH-05, #551)'` and the CONTROL check of the plan's §Global constraints is run.
4. **Mutation table, run:** no declaration; the declaration moved below `SKIN_SETS`; `// (L4) composition`; at 0, a CONTROL row naming this set left unedited. Each reds the rows the plan names.
5. **Verify, one file at a time:** from `pwa/`, `skin-identity.test.ts`, `skin-switch.test.tsx`, `tsc --noEmit`; from `server/`, `rings/pwa-rings.test.ts`, `rings/exemption-age.test.ts`, `rings/totality.test.ts`, `citations.test.ts`, `tsc --noEmit -p test/tsconfig.tests.json`.

**Routing:** band 3, native; the orchestrator reviews the diff against this ruling. **Branch:** `refactor/ring-drain-pwa-skin-registry`. **Must not change:** which parts a skin renders. **Rollback:** `git revert`.

## Number

D-7576 is defined once, in `docs/superpowers/plans/2026-10-30-ring-drain-pwa-oa1-ruled.md` (the deviation scanner reads only the plans directory's own files).
