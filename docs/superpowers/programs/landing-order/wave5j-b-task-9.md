# Wave 5j-b, Task 9: the operator's pause and withdraw doors

Plan: `docs/superpowers/plans/2026-11-25-landing-order-wave5j-doors.md`, Task 9, section 4.5 and section 9's
`CLAUDE.md` blocks 3 to 5 and README blocks R4 and R5 (D-9049, D-9051). Base: `origin/main` at `31d5d9ae26`.

## What changed

- `server/src/coord/routes.ts`: `POST /api/landing/pause` and `POST /api/landing/withdraw`, registered right after
  `POST /api/landing/order` (never inside the span the other-lanes census reads), through one helper, `landingDoor`:
  `notConfigured` first, then the closed parse, the actor by the file's one expression
  (`deps.cfg.authEnabled ? deviceActor(sessionAuth(req).device) : 'flag-off'`), one `actLandingWrite` inside
  `coordMutex.run`, refusals through `refuseRoute`, and the answer less `ok` (and less `coordinator` for a withdrawal).
  Neither handler names the box token, its helpers or `requireAttribution`, and neither makes a sign-in decision. The
  entries and order helper now also drops `released` (Task 7's internal field) from its answer.
- The census pins: `coord-pause-route.test.ts`'s `SESSION_ONLY` gains both paths (its comment holds no closing square
  bracket and no quoted string); `coordinator-skill.test.ts`'s census `EXEMPT` gains both routes with a reason; nothing
  is added to the skill text. `auth-gate.test.ts`: the landing write doors case now asserts that neither literal names
  `/api/landing/entries` or `/api/landing/order`; the `coord/routes.ts` tally rises 78 to 80 and the total by 2, each
  with a dated comment. At the tip `511f196a96`, over main `5b14086b57` (the base the two merges of main left), the total
  reads 324 to 326 (the figures this note first gave, 309 to 311, were counted on the first base `31d5d9ae26`; review
  run 3864's F2).
- `CLAUDE.md` blocks 3, 4 and 5 and README blocks R4 and R5, byte for byte as section 9 gives them. Each old block was
  measured first: exactly once in its file at the base `31d5d9ae26`, at `origin/main` `bc65307b1a` and in the worktree.
- New `landing-doors-route.test.ts`: dark (pause, resume and withdraw each 200 with no credential, actor `flag-off`);
  armed with a real login whose `user-agent` is a long one cut at 120 units in a space (the actor exactly `deviceActor`'s
  text); armed with the box token only, and with neither (401, nothing journalled); a session with no device label
  through the `collect-lane-route.test.ts` rig (`unmeasured`); each bad body 400; each refusal of section 4.5 with its
  status and word; no answer carries `head`, `next`, `order`, `successor`, `coordinator` or `released`.

## Held files and packets

- `server/src/coord/routes.ts` (claim 7131, the timers worker): a unified diff against `origin/main` `bc65307b1a`,
  3864 bytes, sha256 `d542e4555b548456ffeb107ef2bfb494150dc3eb27ed01caf9ea7cb8aac60286`; answered yes (mail 36068), and
  applied exactly. The holder's own change in that file is the mail route's recipient check, far from this one.
- `server/test/auth-gate.test.ts` (claim 7164, the docs reader P2 worker): a unified diff against `bc65307b1a`, 2663
  bytes, sha256 `25b8ae8697f5c2493bf2ff23ffc120367aee22e8fda40bb15392cca9006b395b`; answered yes (mail 36075). Hunks 1
  and 3 applied exactly. Hunk 2 did not apply on this branch's base: the total there is 309, where `bc65307b1a` reads 310
  (a door that landed after the base). The same change was made on the base's line, 309 to 311, with the same comment
  shape. The holder has released the claim (mail 36097), and this branch now holds it (claim 7171). Its pull request,
  #3369, also moves these totals; whichever lands second resolves them, and that worker gave the combined numbers.
- `README.md`'s claim (wave 1f) lapsed at its merge; this branch claimed it (7167).

## What the first run found, and the fixes

- `auth-gate.test.ts`'s sweep also checks four prose sites against the counts it derives: the scanner-meta comment
  (324 to 326 scanned at the tip over `5b14086b57`; 309 to 311 on the first base), the property loop's and the third
  probe's HTTP count (321 to 323 at the tip; 306 to 308 on the first base), and `gate.ts`'s docstring (321 to 323 at
  the tip; 306 to 308 on the first base). The plan named the two tallies only. `server/src/auth/gate.ts` was free once claim 7164 was released, so
  this branch claimed it (7173) and changed only that number in its docstring. Issued as
  **D-9094** `landing-doors-gate-count-prose` (the plan's Task 9 file list lacks `gate.ts` and the four prose counts).
- `box-token-census.test.ts` harvests the `SESSION_ONLY` literal as text, and the first comment written there held an
  apostrophe ("the operator's"), which the harvest read as a quoted path. The comment now has none, as the plan warned.
- `landing-doors-route.test.ts`'s first identity-conflict fixture reused an existing subject id, and its run-unreadable
  fixture bound a journalled run-less entry to a run, which recovery lists first (`landing-recovery-unresolved`, step 3
  before step 6). Both fixtures now use raw rows with no subject.

## Growth

- `routes.ts` grows by about 30 net code lines, under the 40-line limit, so D-9052 is not used and no waiver is added.
  The growth check is measured in the gate run.
