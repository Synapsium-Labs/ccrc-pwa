# Named workspaces and Linear tickets — implementation plan

**Design:** `docs/superpowers/specs/2026-10-20-named-workspaces-and-linear-tickets-design.md` (rev 1, approved
2026-10-20, with §5.1's Settings ruling). Read it first; this plan does not restate the reasoning, only the work.

**Base:** `origin/main` `63fc3152` (#940). **Branch:** `feat/named-workspaces`.

**Deviation series:** D-6112..D-6113, minted by `POST /api/ledger/deviations` on 2026-10-20 (floor 6112 → 6114)
and defined below in the same act. A deviation found during execution is allocated the same way, never looked up.

**Port source:** `feat/ticket-named-workspaces` (never merged). Read a file from it with
`git show feat/ticket-named-workspaces:<path>`. Port Feature B only; every Feature A file stays behind.

**Review log.** Rev 1 applies a blind plan review (verdict: execute with edits). Its findings, each folded into
the task it touches: B1 the public-tree scanner (constraint 5), B2 the post-worktree re-pick (S1), M1 the
censuses (S1, S4b, S5, S9), M2 the registry census (S2), M3 `--wrapper`'s five gaps (S1, S8), M4 the key's
posture and storage (S4b), M5 the lookup at create (S5), M6 title sanitising (S4/S5), M7 Rename's gate (S9),
M8 D-6113's corrected claim, M9 `named` on dispatched workers (S1).

## Global constraints (every task inherits these)

1. **Red first.** Each guard ships with a test measured red against the unguarded code, and the measurement is
   recorded in the task's commit message. A ported test that is green on its first run is not red-first: mutate
   the guard it pins and record that red instead.
2. **Additive wire.** No `FLEET_PROTO` bump. A new `FleetSession` field goes into `reviveFleetSession`'s literal.
3. **One owner per fact.** The slug rule lives in `shared/slug.ts`; the Linear key has one writer (the Settings
   routes) and one source (`~/.ccrc/linear.key`). No environment variable, no second copy of `512`.
4. **Fixture HOMEs only** for every ccd test (`makeCcdHarness`). Never run ccd against the live `$HOME`.
5. **Public repo, scanned.** Fixtures use `project-a`, `lane-a`, `ENG-1234`, `team-a`, `user-a`.
   `topology-clean.test.ts` bans `linear.app/<word>` in every tracked file **and in every blob the branch adds**
   (its history arm reads `origin/main..HEAD`), so a later commit cannot clean an earlier one. Build every such
   string indirectly (`[origin, 'team-a', 'issue', 'ENG-1234'].join('/')`), hold the API origin and path as two
   constants, and run `topology-clean` before every push.
6. **AGENT-FIRST** for S1 and S9: ccd (and S9's agent whitelist) reaches the fleet box before the server that uses it.
7. Suites run in the foreground (timeout ≥ 600000 ms), single suites with `./node_modules/.bin/vitest run`.
8. One commit per task; the PR merges with `--merge`, never `--squash`.

## Dependencies

S1, S2, S3, S4 and S9 ship alone. S2 lands before S5 (or the first named workspace is renamed within one tick).
S5 needs S3 (`isWsProject`, `deriveWorkspaceSlug`) and S4 (the lookup). S4b needs S4. S7 needs S5 and S6.
S8 needs S1 and S7.

## Tasks

### S1 — ccd: `--title`, `--wrapper`, `named`, caps `[AGENT-FIRST]`

Files: `ccd/ccd` (`cmd_ws_add` ≈:6966, the no-placement refusal builder ≈:7127–7190, the post-worktree re-pick
≈:7343–7415, `cmd_caps` ≈:8499), `server/src/ccdargv.ts` (two cap constants), `server/test/ccd-workspaces.test.ts`,
`server/test/ccd-archive.test.ts`.

1. **Red (fixture HOME):**
   - `ws-add --title 'ENG-1234 - Fix' project-a eng-1234` writes `title` and `named`;
   - `ws-add project-a eng-1234` (a slug, no title — the dispatch shape) writes **neither** (M9);
   - `--title` twice, blank, with a control character, or over `_LC_DEC_MAX` bytes → refused, no worktree;
   - `--wrapper lane-b` places on `lane-b` **with the fixture making `lane-b` strictly not the least loaded**, so
     the test cannot pass by coincidence, and the registry `wrapper` after the post-worktree step is still `lane-b`
     (B2);
   - `--wrapper` naming a non-home-able lane, an auth-dead lane, a lane failing `_account_ok` or `_pool_ok`, or
     (with an explicit `--route class=`) one `_class_gate` refuses → refused with the lane's reason, and no
     worktree, branch or registry row exists afterwards (assert each);
   - `ccd caps` lists `ws-title-v1` and `ws-wrapper-v1`.
2. Implement:
   - Two strip-loop arms mirroring `--actor` ≈:7013–7056 (at most once, non-blank, no control characters,
     `_lc_dec_ok`).
   - Extract the per-lane reason chain at ≈:7127–7190 into one helper; the no-placement message and `--wrapper`'s
     refusal both call it. Characterization first: pin today's no-placement message, then extract.
   - With `--wrapper`: skip `_place_for_class`; check `_is_home_able`, not `_authdead`, `_account_ok`, `_pool_ok`,
     and `_class_gate` only when `strict=1`. In the post-worktree step, re-validate that lane against the fresh
     roster instead of re-picking; die with the existing "worktree EXISTS" message if it no longer qualifies.
   - `_reg_set title` and `_reg_set named 1` only when `--title` was given, beside ≈:7416, each warned on failure
     like the `--child` write ≈:7418.
3. Add both tokens to `ccd-archive.test.ts`'s `KNOWN_CAPABILITY_TOKENS` (≈:154) with its `toContain` lines.
4. Re-stamp `ccd/ccd`'s provenance marker in its own `chore(ccd): re-stamp …` commit, as the tree's recent ccd
   commits do.
5. `ccd-lifecycle-sites.test.ts`'s argv forms stay byte-identical.

### S2 — registry fields and the sweep exemption

Files: `server/src/registry.ts`, `server/src/watch.ts` (`sweepNames` ≈:3718), `server/test/name-sweep.test.ts`,
`server/test/registry.test.ts`.

1. **Red:** two rows in one sweep, one `named` → exactly one `ws-rename`, naming the auto row (D-6112). The doubt
   arm: `named` listed but unreadable → named. An **empty** `named` file → named (presence is the signal, as
   `.hold`'s ruling at registry.ts ≈:139; `--clear` removes the file).
2. Read `title` and `named` behind `names.includes(...) ? fieldMeasured(...) : Promise.resolve(null)` — the D-5347
   pattern `deny-settings` and `childshell` use — so a row without the files costs no extra read and the census
   (`registry.test.ts` ≈:83, `fields 31 / single 32 / fleet 745`) does not move. If any tagged
   `[registry-read-census:*]` claim still moves, update all three kinds together.
3. One clause in `sweepNames` beside the `held` check ≈:3772, before `openRunsForSession`.

### S3 — `shared/slug.ts` (port)

Files: `shared/slug.ts`, `server/src/naming.ts`, `server/test/slug.test.ts`,
`server/test/lifecycle-constants-twin.test.ts`.

1. Port `shared/slug.ts` and `slug.test.ts`. Rewrite every `linear.app/…` literal in them indirectly (constraint 5).
2. `WS_TITLE_MAX_BYTES = LC_REASON_MAX_BYTES` (`shared/api.ts` ≈:8731); the twin assertion is unconditional.
3. `server/src/naming.ts` imports `slugifyWords`/`fitSlug`; `naming.test.ts` unchanged and green.
4. **Mutation red:** delete the regex read in the parity pin, and break the trailing-dash strip; record both reds.
5. `single-definition.test.ts` and `topology-clean.test.ts` green.

### S4 — the Linear client + `GET /api/linear/resolve`

Files: `server/src/linear/client.ts` (port of the branch's `linear.ts`), `server/src/linear/connection.ts` (reads
the key file), the resolve route, `server/test/linear.test.ts`, `server/test/linear-resolve-route.test.ts`.

1. Port `lookupLinearIssue`: no `Bearer`, 8 s deadline, five failure arms; origin and path as two constants. Its
   token comes from `readLinearKey()` over `readValueFile`, mapping all of `absent`, `unreadable`, `unusable`,
   `placeholder`.
2. `sanitizeTitle`: control characters → one space, trimmed, then shortened to `WS_TITLE_MAX_BYTES` with `…`.
3. **Red:** `Authorization` carries no `Bearer`; a timeout degrades to the offline title; a title over the cap is
   shortened, never refused; a title with a tab or newline is sanitised; a 401 marks the connection rejected only
   when the stored key's digest still matches the key used; `ref` over a length cap → 400.
4. The route is session-gated with `Cache-Control: no-store`. Add its file to `auth-gate.test.ts`'s `scanRoutes`
   list (≈:106–110) and update the hard counts (≈:238, :392 and the gated/HTTP totals).

### S4b — Settings → Linear

Files: `server/src/linear/routes.ts`, `pwa/src/screens/SettingsScreen.tsx` (`LinearSection` beside
`BoxTokenSection` ≈:502), `pwa/src/lib/api.ts`, tests on both sides.

1. **Red (server):**
   - `PUT` and `DELETE` refused while auth is unarmed, from an insecure origin, and without a recent step-up
     (`createAccountGate`, `stepUp: true`);
   - a key failing `^[A-Za-z0-9_-]+$` or the length cap → 400 `bad-key` and Linear is never called;
   - a key Linear rejects → 400 `key-rejected`, no file; Linear unreachable → 503, no file;
   - a good key → `linear.key` then `linear.json`, both `0600`;
   - `GET` never contains the key (assert on the serialized body), and no error body contains Linear's text;
   - `DELETE` removes the key first, then the details;
   - key present and details absent → *connected, details unknown*; each `readValueFile` kind → its own state;
   - all four routes answer `Cache-Control: no-store`.
2. **Red (pwa):** each state renders its sentence and actions; the key field is `type=password` and cleared after
   a successful connect; *Check again* calls the check route.
3. `linear.json` has a measured JSON reader (absent / unreadable / malformed). Writes use `writeValueFileAtomic`.
4. Add `server/src/linear/routes.ts` to `auth-gate.test.ts`'s `scanRoutes` and update its counts.

### S5 — `wsAddNamed` + the route

Files: `server/src/ccdargv.ts`, `server/src/server.ts` (≈:2866), `server/test/workspaces-route.test.ts`,
`server/test/whitelist-subset.test.ts`, `server/test/id-argv-census.test.ts`.

1. **Red:**
   - `{name:'ENG-1234'}` on `/api/projects/--no-rc/workspaces` → 400 `bad-project` **and `calls` empty**;
   - a refused name → 400, `calls` empty; a non-string `name` or `wrapper` → 400 `bad-request`; a `wrapper` that
     fails the roster grammar → 400;
   - `{name:'', wrapper:'lane-a'}` → today's bodyless argv, `wrapper` ignored (pinned);
   - `wrapper` without `ws-wrapper-v1` or `name` without `ws-title-v1` → 501;
   - a ticket name with Linear answering → the created title is Linear's; with Linear timing out → 200 with the
     offline title (M5);
   - ccd `slug in use: ` → 409 `slug-taken`; a `--wrapper` refusal → 409 `account-refused` with ccd's reason;
   - the existing bodyless assertions unchanged (the additivity proof).
2. `CCD_ARGV.wsAddNamed(p, slug, {title, wrapper}, route, dec)`: a new key; `--title`/`--wrapper` lead, before
   the project (M8); slug right after the project; route and dec preserved. Add it to `whitelist-subset`'s
   `SAMPLES` and `EXPECTED`, and classify it `'no-id'` in `id-argv-census`'s `ID_BUILDERS`.
   `ccdargv-dec-parity.test.ts` picks it up automatically and must stay green.

### S6 — `title` on the wire

Files: `shared/api.ts`, `server/src/fleet.ts`, `pwa/src/fleet/sessionLabel.ts`, `pwa/test/session-label.test.ts`
(new).

1. `FleetSession.title`, `reviveFleetSession`, `fleet.ts` assembly; `sessionLabel` = `title ?? name ?? branch ??
   workspace ?? id`. Fixture edits through `pwa/test/fleetFixture.ts` where possible; `typed-label.test.tsx` and
   `header.test.tsx` stay green.

### S7 — `WorkspaceNameField` + `AddWorkspaceSheet` (the `+` door)

Files: `pwa/src/fleet/WorkspaceNameField.tsx`, `pwa/src/fleet/AddWorkspaceSheet.tsx`, `useProjectRows.ts`,
`ProjectCardHead.tsx`, `pwa/src/screens/FleetScreen.tsx`, `api.ts`, tests.

1. **Red:** tapping `+` creates nothing; empty + Add → today's request byte for byte (class route kept); a refused
   name disables the confirm and calls nothing; a 409 keeps the sheet open with the field intact; the field never
   autofocuses; the close-reset test drives `rerender` (vaul unmounts at `open={false}`).
2. Built on `@ccrc/ui`'s `Sheet`, `Button`, `TextInput`; tests use `fireEvent`.
3. The *Connect Linear in Settings* line shows only while not connected.

### S8 — the field in `NewSessionSheet`

1. **Red:** empty field → `api.createSession` with today's body; filled → `api.workspaceAdd(project, {name,
   wrapper, route})` with the picked wrapper; `account-refused` keeps the sheet open on the account step; a
   crossing (other-pool) project or a non-home-able account disables the field with its sentence and never sends
   a name.

### S9 — Rename (`ws-title`) `[AGENT-FIRST]`

Files: `ccd/ccd` (`cmd_ws_title`, `cmd_caps` verb list), `agent/src/whitelist.ts` (grant
`['ws-title','--session']` and `REQUIRED_VERB_FLAG` `'ws-title': '--session'`), `agent/CLAUDE.md` (gated verbs),
`server/src/ccdargv.ts`, `POST /api/sessions/:id/title`, `SessionActionsSheet.tsx`, tests.

1. **Red (ccd):** `ws-title --session <id> --title T` writes `title` and `named` and nothing else (assert the
   registry file set); `--clear` removes both; an unknown id or a main-checkout session → refused.
2. The server offers Rename only when `ccd caps` lists the verb `ws-title` (M7). Classify `wsTitle` `'id'` in
   `id-argv-census` with its census row and gate; update `routes.test.ts`'s count if it uses `knownId`, and
   `auth-gate.test.ts`'s server.ts count.
3. The PWA's Rename reuses `WorkspaceNameField` in rename mode (the slug line reads *slug stays*).
4. Clearing returns the row to the sweep: an S2 test asserts the sweep renames it again after `--clear`.

## Verification before the PR

- All three packages' suites green in the foreground; known load flakes re-run in isolation.
- `topology-clean.test.ts` and `deviation-refs.test.ts` green after `git fetch origin main`.
- A fresh, blind `ui-verifier` over the `+` sheet, the new-session sheet, Rename and Settings → Linear, at phone and
  desktop widths, given the spec and the running PWA only.
- `reviewer` over the full diff before the PR.

## Deviations found

- **D-6112** — `sweepNames` renames a workspace whose slug the operator chose. Its skip set
  (`server/src/watch.ts` ≈:3737–3827) excludes a row only for degraded identity, a main checkout, archival, an
  already-renamed branch, a hold or an open run; a slug passed to `ccd ws-add <project> <slug>` by hand still reads
  as the birth branch `ws/<slug>`, so the sweep overwrites it within one tick of its first ai-title. No registry
  field records that a human chose the name.
- **D-6113** — `cmd_ws_add`'s strip loop binds any token it does not recognise as a positional (`ccd/ccd` ≈:7026),
  and nothing reads a positional past the second. A leading unknown flag lands in the project or slug slot and is
  refused there; a **trailing** one, after `project slug`, is dropped unread and the workspace is created with
  exit 0 — on the least-loaded lane, if the dropped flag was the one choosing it. Callers therefore gate every new
  ws-add flag on a `ccd caps` entry and place it before the project. Refusing unknown `--` tokens in ccd itself is
  out of scope here.
