# ccrc surface map — archive/restore UI, fleet payload, listProjects, whitelist, verb gate

Root: `/srv/projects/OpenClawHetzner/infra/ccrc` (monorepo copy of ccrc-pwa).
All line refs are from a full read of each file, at HEAD `5a943c5`.

---

## S1 — Manual archive/restore UI

### What exists today

| Piece | Location | Note |
|---|---|---|
| Sheet the `···` opens | `pwa/src/fleet/SessionActionsSheet.tsx` | Buttons: Restart (:92), Swap account (:96), **Clean up workspace…** (:104-109, gated) |
| The gate at :104 | `session.workspace !== null && session.archivedAt !== null` | archived-only, because `ws-audit` refuses `not-archived` (`server/src/wsaudit.ts:20`) |
| Only callers of archive/restore | `pwa/src/session/PrSheet.tsx:198-215` | inside `pr?.phase === 'merged'` ONLY: `Restore` (:201-204) when `archived`, `Archive now` (:210-213) when not |
| Client methods | `pwa/src/lib/api.ts:162-163` | `archive: (id) => post('/api/sessions/<id>/archive')`, `restore: …/restore` — both return `void`, both throw `ApiError` |
| Routes | `server/src/server.ts:464-478` (`/archive`), `:480-491` (`/restore`) | `isSafeSessionId` → `knownId` → build `CCD_ARGV.wsArchive/wsRestore` → `verbSupported` else `501 {ok:false,error:'unsupported'}` → `runCcdOr502` (502 `{ok:false,stderr}`) |
| ccd side | `../ccrc-portability/ccd:1290-1350` (`cmd_ws_archive`), `:1512+` (`cmd_ws_restore`) | refusals: `not a workspace…`, `worktree is gone: …`, `status-unknown`, `session-busy`, manifest-untruthful. **`already archived` is exit 0**, so a double tap is not an error. Destroys nothing. |

### The refresh question — there is none to write

`PrSheet.act()` (`PrSheet.tsx:64-70`) does `setBusy(true) → await fn() → load()`. `load()` (:36-39)
re-fires **only** `GET /api/sessions/<id>/pr`; it does **not** touch the fleet store. It cannot: the
fleet store (`pwa/src/stores/fleet.ts`) has no fetch/refresh action at all — it is a pure mirror of
the `/ws/fleet` push stream (`connect()` at :65, `set({ sessions })` at :74).

`archivedAt` therefore refreshes on its own: ccd writes `$REG/<id>.archived`, and `FleetWatcher`
polls every **2000 ms** (`server/src/watch.ts:79,85`), re-assembles from the registry
(`assembleFleet`), and emits `bus.emit('fleet', sessions)` only when the JSON changed
(`watch.ts:151-154`). So an Archive button in `SessionActionsSheet` needs **no store refresh call**
— `FleetScreen` already re-feeds the open sheet from the live list (`FleetScreen.tsx:111-125`), so
the button will flip to Restore / reveal "Clean up workspace…" within ~2 s by itself.

Consequence for the diff: `SessionActionsSheet` does **not** need `load()`-equivalent plumbing; it
needs a local `busy` flag only (mirroring `restarting` at :48/:62-76).

### Toast copy conventions (measured across the PWA)

Two live conventions, and they split by surface:

- **Sheets/screens that own a verb**: `` toast(`Couldn't <verb> — ${apiErrorText(err)}`, 'error') ``
  — `SessionActionsSheet.tsx:72` ("Couldn't restart"), `FleetScreen.tsx:73`, `SwapSheet.tsx:202`,
  `NewSessionSheet.tsx:105`, `FleetHostBanner.tsx:53`, `SessionScreen.tsx:147,155`, `DialogSheet.tsx:133`.
- **PrSheet only**: `` toast(`${label} failed — ${apiErrorText(err)}`, 'error') `` (`PrSheet.tsx:68`,
  labels `'Archiving'` / `'Restoring'`).

`apiErrorText` (`api.ts:97-108`) is mandatory, never `err.message`: precedence is
502 `body.stderr` (ccd's own words) → `body.error` via `API_ERROR_TEXT` → message. The one coded
entry today is `unsupported → UNSUPPORTED_VERB_TEXT` (`api.ts:68-89`), the same sentence
`PrKeycap`'s `REASON_TEXT.unsupported` uses — a 501 must render as
"The fleet host is running a ccd that does not have this verb yet.", never "unsupported".

Success toasts are optional and in-progress-flavoured where ccd is slow
(`"Starting … "`, `"Moving … "`, `"Reboot requested — …"`). Archive is fast and its effect is
visible on the next fleet tick, so a success toast is arguably unnecessary; if added, match the
`'info'` default and describe consequence, e.g. `Archived — session stopped; nothing deleted`
(that exact sentence already exists as `PrSheet.tsx:200`'s note; reuse rather than reword).

### Tests covering `SessionActionsSheet` today

- **`pwa/test/session-actions-sheet.test.tsx`** (147 lines) — the owner suite. Session factory `s()`
  at :9-15 constructs a **full `FleetSession` literal**, so any new required field in
  `shared/api.ts` breaks it (by design). Groups: `composition` (:32), `actions` (:69, restart +
  ccd-stderr toast via a real 502 `Response`), `the unguarded delete is gone` (:95), `away note`
  (:110), `cleanup, guarded` (:124-146 — archived-only gate, `onReap` hand-up, main-checkout).
- `pwa/test/fleet-screen.test.tsx:402` — notes explicitly that the sheet's own suite renders it in
  isolation, and covers the FleetScreen-level wiring (`onReap` → `ReapSheet`).
- `pwa/test/lifecycle-ui.test.tsx:259,327` — sheet-lifecycle behaviours (reset-on-close, no session
  swap while open).
- `pwa/test/polish.test.tsx:147` — pins the limit-note sentence text.
- CSS: `.sess-sheet`, `.sess-sheet .btn-ghost`, `.sess-sheet-note` at `pwa/src/fleet/fleet.css:828-839`
  — a new `btn-ghost` inherits tap sizing, so `tap-targets.test.tsx` needs nothing.
- Server side: `server/test/pr-routes.test.ts:60-61,77-78` (400/404 guard table incl. `/archive`,
  `/restore`), `:241-252` (exact argv), `:253+` (the 501 skew cases). `pwa/test/api.test.ts:118,130`
  pins the two client methods' URLs. `pwa/test/pr-sheet.test.tsx:396-465` pins the button→fetch
  wiring and both toast sentences.

---

## S2 — Fleet payload (`shared/api.ts` `FleetSession`)

`FleetSession` is `shared/api.ts:5-34`. Fields relevant here: `workspace`, `workdir`, `branch`,
`pr`, `archivedAt` (:29), `archivedBytes` (:33).

### How a row is built — there is no `ccd ls` anywhere

`server/src/fleet.ts:49-107` (`assembleFleet`) builds each row from:

1. `readRegistry(io, cfg)` — `server/src/registry.ts:53-96`, which **reads `~/.cc-sessions/<id>.<field>`
   files one at a time through `FleetIO.readFile`** (`registry.ts:28-31`). Fields are enumerated in
   the `Promise.all` at `registry.ts:59-69`.
2. `readLimits`, `tmux.hasSession/panePid`, `readLiveState` (live pane state),
3. watcher-held maps passed in as arguments: `pendingDialogs`, `statuslines`, `taskProgress`,
   `prStates` (`fleet.ts:54-60`).

So **the server never parses ccd stdout to build the fleet.** The only ccd calls in the fleet path
are `pr-state` (`watch.ts:210`) and `ws-archive` (`watch.ts:307`). `ccd ls` has no server call site
and is not in `EXEC_WHITELIST`.

### What a `children` concept costs, end to end

A count-only field is the cheapest honest shape and mirrors `archivedBytes`'s house rule
("a number is a measurement; unmeasured is `null`, never `0`" — `shared/api.ts:30-33`,
`ArchiveScreen.tsx:18-41`):

```ts
/** Child worktrees Claude Code created inside this session, as ccd last counted
 *  them. null = never counted (older ccd / unreadable), NOT zero. */
childWorktrees: number | null;
childBytes: number | null;   // only if the UI must argue for a cleanup
```

Three end-to-end options, in increasing cost:

- **A. New registry field written by ccd** (matches how `archivedAt`/`archivemanifest` already flow):
  ccd writes `$REG/<id>.children` (or a JSON manifest like `archivemanifest`), `registry.ts` adds one
  `field(...)` call to the `Promise.all` + one `SessionRecord` key + `numOrNull`, `fleet.ts:92-105`
  adds one line to the returned literal, `shared/api.ts` adds the field, and
  `reviveFleetSession` (`shared/api.ts:489+`) must add it too **or the whole snapshot type breaks at
  compile time** — that function returns a `FleetSession` literal precisely so a forgotten field is a
  compile error (`shared/api.ts:459-491`). No new ccd *verb*, no whitelist change, no verb gate.
- **B. Server-side scan** (server walks `workdir/.git/worktrees/` per session): needs no ccd change
  but costs N `FleetIO.readdir` per 2 s tick, and in `fleetMode: 'remote'` every one of those is a WS
  round-trip to the agent. `.git/worktrees` is under `projectsRoot`, so the agent's read whitelist
  already permits it (`agent/src/whitelist.ts:83-90`); `~/worktrees` and `/mnt/.../ccrc-wt` are **not**
  under `projectsRoot` or `$HOME/.cc-*` and would be **denied** — a real constraint on any scan design.
- **C. New `ccd ws-children --session <id>` verb**: full cost — CCD_ARGV entry + whitelist prefix +
  verb gate + skew 501 + `ccd caps`. Only worth it if the UI needs a live, on-demand list (the reap
  flow's shape), not a per-tick count.

**Recommendation for the design: don't add a field yet.** `FleetSession` has no `children` concept
today and nothing in the PWA reads one; the archive-button work is independent of it. When children
become visible, take option A.

Note also: `FleetSession.workdir` already exists, so a client-side "this session is a worktree"
inference is possible without any payload change — but the PWA cannot stat, so it would be a
string-shape guess. Don't.

---

## S3 — `listProjects` and the worktree masquerade

`server/src/lifecycle.ts:35-56`. Today:

```
names = io.readdir(cfg.projectsRoot)            // :40
skip dotfiles                                   // :43
workdir = join(projectsRoot, name)
if (io.readdir(workdir) === null) continue      // :45  "not a directory — skip"
byWorkdir.set(workdir, {name, workdir})
… union with every registry record's workdir    // :49-51
```

`cfg.projectsRoot` defaults to `/data/projects` (`server/src/config.ts:39`).

### The cheap detection, and the trap in it

Measured on this box (probe under `scratchpad/probes/`, plain `git`, `file://`-free):

- normal checkout → `.git` is a **directory**
- linked worktree → `.git` is a **regular file** containing `gitdir: <path>/.git/worktrees/<name>`
- submodule checkout → `.git` is also a **regular file**, containing `gitdir: …/.git/modules/<name>`
- bare repo dir → `.git` absent (the dir *is* the repo)

Measured on the real `/data/projects`: **16 dirs with a `.git` directory, 4 with no `.git` at all**
(`cctest`, `cab-batch`, `cab-archive`, `bt-rules`), and exactly **1 with a `.git` regular file** —
`/data/projects/wt-model-rates-sync`, whose `.git` reads
`gitdir: /srv/projects/data-internal/.git…`. That is the masquerade in the brief,
confirmed.

So the naive rule "skip if `readdir(workdir/.git) === null`" is **wrong**: it would also delete the
four legitimate non-git project dirs from the picker. The correct cheap rule needs both readdirs:

```ts
const names = await io.readdir(workdir);          // already have to call this — reuse it
if (names === null) continue;                     // not a directory (today's :45 check)
if (names.includes('.git') && (await io.readdir(path.join(workdir, '.git'))) === null) continue;
```

i.e. **`.git` present AND not a directory ⇒ linked worktree or submodule ⇒ skip.** Cost: exactly one
extra `readdir` per candidate that has a `.git`, and it reuses the readdir `:45` already performs
(today its result is discarded — change `=== null` to a captured `names`). No new `FleetIO` method:
`readdir` returning `null` for a plain file is the existing directory-ness probe and is documented as
such at `lifecycle.ts:31-33`. `FleetIO` has no `lstat`/`isFile` (`server/src/io.ts:11-24`); `stat()`
follows symlinks and reports only `{mtimeMs, size}`, so it cannot answer file-vs-dir.

If the design wants to distinguish worktree from submodule (worth it: a submodule is arguably still
not a project either, but the *reason* differs), one `io.readFile(workdir + '/.git')` and a
`/^gitdir:\s*(.*\/\.git\/worktrees\/)/` test does it — still within the existing `FleetIO` surface.

**Second half of the problem, not solved by this check:** the registry-union loop
(`lifecycle.ts:49-51`) adds every registry `workdir` unconditionally. A session registered *in* a
foreign worktree still surfaces as a project from that side. Any fix must apply the same probe there
or the masquerade returns through the other door.

### Tests that pin `listProjects`

`server/test/lifecycle.test.ts:179-220`, two cases:
- `:180-211` — builds a tmp projects root with `alpha/`, `mekwar/`, `.hidden/`, `stray.txt`, seeds two
  registry sessions, and asserts the **exact sorted array** of `{name, workdir}` plus that
  `GET /api/projects` returns the identical object. A new skip rule lands here as a third fixture
  (`git worktree`-shaped: a dir containing a `.git` **file**) — note the test uses real `mkdirSync`/
  `writeFileSync` + `localIO`, so a fixture is two `writeFileSync` calls, no git needed.
- `:213-219` — missing projects root ⇒ registry-only.

Also downstream: `pwa/test/lifecycle-ui.test.tsx` and `pwa/test/project-card.test.tsx` exercise the
project picker fed by `api.projects()` (`pwa/src/lib/api.ts:151`).

---

## S4 — Whitelist (`agent/src/whitelist.ts`)

### Allowed ccd argv shapes today (`whitelist.ts:298-308`)

```
['start'] ['enable'] ['ensure'] ['stop'] ['swap'] ['ws-add']
['pr-state','--session'] ['pr-state','--project'] ['pr-open','--session']
['ws-archive','--session']   ['ws-restore','--session']
['ws-audit','--session']     ['ws-reap','--expect']   ['ws-attic','--session']
```

Matching is **prefix** matching, tokens after the prefix unconstrained
(`isExecAllowed`, `whitelist.ts:541-605`, the `prefixes.some(p => p.every((tok,i) => args[i]===tok))`
at :604). So `ws-archive --session <anything>` and `ws-restore --session <anything>` are **already
granted** — a manual Archive/Restore button needs **no whitelist change at all**. Same for the
existing audit/reap pair.

### If the design adds a new verb or flag

Every one of these is required, and the file says so in its own comments:

1. `server/src/ccdargv.ts` — a new `CCD_ARGV` entry (the *only* mint site; `argv()` at :46 freezes
   and brands, `CcdArgv` at :27).
2. `agent/src/whitelist.ts` — a new prefix in `EXEC_WHITELIST.ccd`. It must be **≥1 token**
   (empty prefix ⇒ refuse-to-boot, :484-489), must not head with `ws-rm`/`ws-gc`
   (`UNGRANTABLE_VERBS`, :229; refuse-to-boot at :491-496), and if the verb is destructive it should
   join `REQUIRED_VERB_FLAG` (:218) so the token flag is type-checked (`IllegalGrant`, :249-258)
   *and* boot-checked (:497-504). All of this is enforced three ways: type (`LawfulGrants` proof line
   at :321), runtime (`auditExecWhitelist()` called at module load, :509), and cross-package tests.
3. `server/test/whitelist-subset.test.ts` — **two** tables must gain the key or the suite fails
   outright: `SAMPLES` (:13-32, asserted exhaustive against `Object.keys(CCD_ARGV)` at :35-37) and
   `EXPECTED` (:222-242, token-for-token argv). Layer 3's reachability check (:92-113) then requires
   the new grant to be built by *some* `CCD_ARGV` entry — a dead grant fails.
4. `server/test/verb-gate.test.ts` — see S5.
5. `ccd caps` must advertise the verb, or `verbSupported` (`ccdargv.ts:85-92`) greys it out on the
   real host; note the memory-item caveat that **`ccrc-agent` caches ccd caps at boot**.

Precedent worth knowing: `wsAttic` (`ccdargv.ts:76`) is minted and whitelisted but has **zero server
call sites** — so an entry without a call site is tolerated today (verb-gate only scans call sites,
and its `NEW_GENERATION` list at `verb-gate.test.ts:239` does not include `ws-attic`).

### The single-definition guard

`server/test/single-definition.test.ts` — a **text scan over four source roots** (`shared`,
`server/src`, `pwa/src`, `agent/src`, :29-34) asserting that certain definitions live in exactly one
file: `UNCHECKED_PR` only in `shared/api.ts` (:62-83), the nine-member PR-reason vocabulary only where
a `Record<PrReason, …>` makes it exhaustive (:109-125), and the ccd script path only in
`server/test/ccdWsHelpers.ts` (:140-209). Rules it imposes on new work: **do not restate a shared
union or a shared literal in a second file**, and if a new vocabulary is introduced, either put it in
`shared/api.ts` behind an exhaustive `Record<>` or expect to add a scan case. The file states its own
limit honestly (:11-16): it catches the copy that looks like the original, not a determined evader.

### The structural rule that `gh` can never be added — restated

`gh` is not merely absent; it is **unexpressible**, by four mechanisms in three classes
(`whitelist.ts:93-133`):

1. **Type (keys)** — `EXEC_COMMANDS = ['tmux','ccd']` (:134) and
   `ExecWhitelist = Record<ExecCommand, …>` (:175). A `gh:` key is TS2353 at any position in the
   literal, above or below `ccd:`.
2. **Type (the widening move)** — `ProvenGrantable` (:164) is
   `[Extract<ExecCommand, ForbiddenCommand>] extends [never] ? ExecCommand : never`, and
   `GRANTABLE_COMMANDS: readonly ProvenGrantable[] = EXEC_COMMANDS` (:169). Adding `'gh'` to
   `EXEC_COMMANDS` — the only way to make step 1 compile — collapses that annotation to
   `readonly never[]` and fails on a **different line**. `FORBIDDEN_COMMANDS` (:146-153) lists `gh`,
   `hub`, `git`, `glab`, every shell, every interpreter, every network and privilege tool.
3. **Runtime, at module load** — `auditExecWhitelist()` (:421-507, invoked at :509) reads
   `Reflect.ownKeys` (not `Object.keys`, so a non-enumerable `defineProperty` grant is caught) and
   **`refuseToBoot`s** on a forbidden key. That survives a cast, an `as any`, a `JSON.parse`, and a
   hand-edit of the deployed `dist/whitelist.js`. The governing rule is stated at :348-389: *refuse to
   boot for over-permission, never for under-permission.*
4. **Tests in two packages** — `agent/test/whitelist-noghosts.test.ts`,
   `agent/test/whitelist-structural.test.ts` + `agent/test/types/bypasses/*`, and — crucially, in a
   *different package* so deleting agent tests cannot reach it —
   `server/test/whitelist-subset.test.ts:77-90`, which asserts `Object.keys(EXEC_WHITELIST)` is
   exactly `['ccd','tmux']` by reading the **object**, not its source text.

The reason, in the file's own words (:137-145, :285-297): the host `gh` token carries the `repo`
**write** scope and there is no second credential, so a single `gh` grant would make `EXEC_WHITELIST`
the only control between the PWA and `gh pr merge`; `gh: [['api']]` is strictly worse
(`-X POST|PATCH|PUT`). Every PR read and the one PR write go through `ccd` verbs whose `args[0]` has
no write sibling reachable by changing `args[1]`. **Any design that "just needs one git/gh call" must
route it through a new `ccd` verb instead.** `git` is on `FORBIDDEN_COMMANDS` too — so a
worktree-lifecycle design cannot shell `git worktree` from the agent either.

---

## S5 — `verb-gate.test.ts` contract

`server/test/verb-gate.test.ts` (247 lines). It walks **every `.ts` under `server/src`**
(`tsFilesUnder`, :160-165), blanks comments and string bodies while preserving byte positions
(:75-104), finds every literal `CCD_ARGV.<name>(` (:132), resolves the **enclosing handler/function**
by brace-chain + `isHandlerHead` (:106-116), and marks the site **gated** iff the literal text
`verbSupported(` appears anywhere in that enclosing function (:153).

What it enforces for any new `CCD_ARGV` call site:

1. **`scope !== null`** — the site must sit inside something the scanner recognises as a
   function/route handler (`app.get|post|put|patch|delete(` or a named/`async`/`function` head with a
   `{`-terminated signature). A call site at module top level, or inside an arrow the head regex
   cannot see, fails `:216` as a *scanner failure*, not a pass.
2. **Gated, or explicitly exempt** — `:222-225`: any ungated site whose verb is not in
   `UNGATED_BY_DECISION` (`start, enable, ensure, ws-add, stop, swap` — :58-60) fails. Practically:
   **every new verb must build its argv, then `if (!verbSupported(deps.fleetState, argv)) return
   reply.code(501).send({ ok: false, error: 'unsupported' })`** (routes) or `continue` (the
   level-triggered sweep, `watch.ts:304-306`).
3. **The exemption list cannot rot** — `:227-232`: every verb in `UNGATED_BY_DECISION` must still
   have a real ungated call site, so you cannot silence a failure by adding a name.
4. **`NEW_GENERATION` is named, not derived** — `:234-245` hard-pins
   `pr-state, pr-open, ws-archive, ws-restore, ws-audit, ws-reap`: each must have ≥1 call site and
   **zero** ungated ones. A new destructive verb should be added to this list by hand.
5. **Self-tests** — `:176-206` prove the scanner sees an ungated site, sees a gated one, does **not**
   count a neighbouring route's gate, and ignores comment-only mentions.

Stated non-coverage (:26-37, worth quoting in the design): a `CcdArgv` passed in as a parameter, an
alias `const A = CCD_ARGV`, or a table lookup `CCD_ARGV[k]` is **invisible** to it; and a
`verbSupported` call in a *sibling branch* of the same function counts as a gate. Provenance is
policed elsewhere (`ccdargv-brand.test.ts`, `whitelist-subset.test.ts`).

---

## Minimal-change plan

### A. The Archive/Restore button on the `···` sheet — smallest coherent diff

Nothing on the server, in `shared/`, in `agent/`, or in ccd changes. Routes, client methods,
whitelist grants and skew gates all already exist. This is a PWA-only change.

**`pwa/src/fleet/SessionActionsSheet.tsx`**
1. Add `const [lifecycling, setLifecycling] = useState(false);` beside `restarting` (:48).
2. Add one handler modelled exactly on `restart` (:62-76) — set busy, `await api.archive(id)` /
   `api.restore(id)`, `toast(\`Couldn't archive — ${apiErrorText(err)}\`, 'error')` (sheet
   convention, **not** PrSheet's `"Archiving failed — "`; pick one and say why in the comment), reset
   in `finally`. **No refresh call** — the 2 s fleet tick is the refresh (`watch.ts:85,151-154`).
3. Render, **above** the existing "Clean up workspace…" block so cleanup stays last:
   - `session.workspace !== null && session.archivedAt === null` → `Archive workspace…` /
     `Archive session`. Do **not** `disabled` on `status === 'busy'`: ccd refuses with `session-busy`
     (`ccd:1314`) and that refusal is the explanation the reader needs — the same rationale the file
     banner gives for surfacing ccd's stderr. (If the design prefers to pre-empt it, disable + a
     `title`, matching `PrSheet.tsx:111`.)
   - `session.workspace !== null && session.archivedAt !== null` → `Restore` beside the existing
     "Clean up workspace…".
4. Update the file banner comment (:1-14): it currently narrates "cleanup goes archive → audit →
   confirmed reap" and explains why there is no delete here — extend it to say archive/restore now
   also live here and why that is safe (archive destroys nothing; ccd:1290-1292 says so).

**`pwa/src/fleet/fleet.css`** — nothing required; `.sess-sheet .btn-ghost` (:834) already sizes it.
Add a modifier only if Archive should read differently from Restore.

**Tests** (all in `pwa/test/session-actions-sheet.test.tsx`, extending the existing
`cleanup, guarded` describe or a new `archive, manual` one):
- offers Archive only when `workspace !== null && archivedAt === null`; offers Restore only when
  `archivedAt !== null`; offers neither for `workspace: null` (mirror :142-145).
- clicking Archive fetches a URL ending `/archive`; clicking Restore, `/restore` (use the existing
  `vi.mocked(fetch).mock.calls.some(...)` idiom at :77-79 — SwapSheet's `/api/accounts` poll means
  position cannot be assumed).
- a 502 `{ok:false,stderr:'ccd: session-busy'}` renders ccd's own words in the toast (copy the
  `stubFetch` + `ToastHost` pattern at :20-24, :82-92).
- a **501 `{ok:false,error:'unsupported'}`** renders `UNSUPPORTED_VERB_TEXT`, not the slug — this is
  the regression `api.ts:71-89` and `pr-sheet.test.tsx:417-450` exist for, and a second caller of
  `api.archive` is exactly where it would come back. Import `UNSUPPORTED_VERB_TEXT` from
  `../src/lib/api` as pr-sheet.test.tsx does.

Optionally one line in `pwa/test/fleet-screen.test.tsx` if the design wants the FleetScreen-level
wiring pinned; not required, since the sheet owns the call.

**Not needed and worth stating so nobody adds them:** no `shared/api.ts` change, no
`server/src/*` change, no `CCD_ARGV` entry, no `EXEC_WHITELIST` prefix, no `verb-gate` /
`whitelist-subset` / `single-definition` edits, no fleet-store action.

### B. Fleet-payload additions, if children become visible (separate change)

Take option A of S2 — ccd writes it, the server reads it, nothing new is executed:

1. **ccd** — write a per-session registry field/manifest (`$REG/<id>.children`, or extend the
   `archivemanifest` JSON shape). No new verb ⇒ no whitelist, no verb gate, no 501 skew path.
2. **`server/src/registry.ts`** — one `field(io, cfg.registryDir, id, 'children')` in the
   `Promise.all` (:59-69), one `SessionRecord` key (:6-26), parsed with `numOrNull` (:36-40) or a
   `manifestBytes`-style JSON reader (:42-51) so a half-written file yields `null`, never `0`.
3. **`server/src/fleet.ts`** — one line in the returned literal (:92-105).
4. **`shared/api.ts`** — the field on `FleetSession` (:5-34) **and** in `reviveFleetSession`
   (:459-491+): nullable-absent ⇒ `null`, wrong type ⇒ reject the whole snapshot. The revive function
   returns a `FleetSession` literal specifically so forgetting this is a compile error, not a
   third outage.
5. **PWA** — every `FleetSession` literal in tests gains the field; the two that matter are
   `pwa/test/session-actions-sheet.test.tsx:9-15` and the equivalents in `fleet-screen.test.tsx`,
   `pr-sheet.test.tsx`, `session-line.test.tsx`, `archive-screen.test.tsx`.
6. **Presentation rule, inherited** — an unmeasured count/size must render as a word
   ("not counted" / "size unknown"), never as `0`: `ArchiveScreen.tsx:18-52`, `ReapSheet.tsx:29-95`
   and `shared/api.ts:30-33` all already encode this, and `ReapSheet` deliberately keeps two distinct
   phrasings for "measured and failed" vs "never attempted".
7. **Tests** — `server/test/registry.test.ts` (field parse incl. the half-written case),
   `server/test/fleet.test.ts` (the row carries it), `shared`'s revival tests
   (`pwa/test/offline.test.ts` and the malformed-snapshot suite) for absent/wrong-type.

If instead the design needs an on-demand child listing (a reap-style sheet), that is option C and
costs the full ladder: `CCD_ARGV` entry → `EXEC_WHITELIST` prefix (+ `REQUIRED_VERB_FLAG` if it can
delete) → `SAMPLES` + `EXPECTED` in `whitelist-subset.test.ts` → `verbSupported` gate + 501 →
`NEW_GENERATION` in `verb-gate.test.ts` → `ccd caps` (and remember the agent caches caps at boot).
