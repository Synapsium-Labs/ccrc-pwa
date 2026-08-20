# `FleetIO` measured read — killing the `readFile` null collapse

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development` to
> implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Program:** `registry-durability`, wave 1 of 2 (run 6). Ledger:
`docs/superpowers/programs/registry-durability.md` (currently on `origin/docs/registry-durability-ledger`,
not on `main` — see D-108).
**Workspace / branch:** `ccrc-pwa-plain-ridge` on `ws/plain-ridge`. Every commit lands here; no
feature branch (worker-skill clause 2).
**Base:** `b5b5ddf` (`origin/main` at survey time). Every anchor below was derived by identifier
against that tree; if `main` moves, re-derive by `git grep -n <identifier>`, never by offset.

**Goal:** `FleetIO.readFile`'s `// null = missing` docstring is FALSE (CLAUDE.md, "Open on `main`").
Both implementations map *every* failure — ENOENT, EACCES, EISDIR, ENOTDIR, a dropped agent-WS round
trip — to one `null`. That is the "no overloaded null at a seam" rule broken at the seam the whole
registry ladder reads through. Add a **result-returning read** beside `readFile` so absent and
unreadable stop sharing a value, thread it through the wire additively, and consume it where a
consumer already handles the two differently.

**Not the goal:** re-deciding the registry ladder. Every migration below is behaviour-preserving by
construction (see THE GOVERNING RULE); the two places it deliberately diverges are D-112 and D-113.

---

## Global constraints

Every task's requirements implicitly include this section.

- **`FLEET_PROTO` stays 1.** This wire change is ADDITIVE and absence-permitting, read through a
  **single reader**. (`AgentReady.v` on this link is deliberately unread —
  `shared/agent-protocol.ts:21-28` — so absence-permits is the *entire* compatibility mechanism here.
  There is no version gate to fall back on if the reader gets it wrong.)
- **No new agent op.** `validateReq`'s `default: return null` (`agent/src/server.ts:407`) makes an
  older agent answer an unknown op `bad-request`, which `remote/client.ts:276` turns into a rejected
  promise indistinguishable from `disconnected`/`timeout` — the argument already written down for
  `caps()` at `client.ts:194-197`. A new op could therefore never prove `absent` against an older
  agent. The marker rides the EXISTING `read` response.
- **No new dependency in any `package.json`. Node floor stays `>=22.13.0`.**
- **Suites run in the FOREGROUND, timeout ≥600000 ms**, as `./node_modules/.bin/vitest run test/<file>`
  from inside the package. **Never bare `npx vitest`.** Known load flakes (`ccd-ws-gc`, `pr-sweep`,
  `session-hook`, `typecheck-tests`, `ccd-session-state`) — re-run in isolation before calling a break.
- **Mutation-table discipline.** Every guard ships with a test that goes RED when the guard is
  deleted or mutated, measured before/after and recorded in the deviation ledger. TDD red-first.
- **`server/test/remoteHelpers.ts:3` imports `agent/src/server.js`**, so the SERVER typecheck project
  compiles agent source: an agent-side type error reds `server/test/typecheck-tests.test.ts` too.
  `cd server && npm test` cannot be green until the agent half compiles.
- **Tests use FIXTURE HOMEs only.** No `ws-rm`/`ws-reap`/`ws-gc`/`ws-archive`/`ws-restore` anywhere.
- **No `git push`, no `gh`, in any task step.** Branch, commit, stop. The PR is opened once at the end.
- **This wave is AGENT-FIRST** (D-110). It does not touch `ccd/`, but it makes the server read a
  field only a redeployed agent emits — the same ordering rule, for the same reason.

---

## THE GOVERNING RULE (read this before any migration task)

> **The measured read is ADDITIONAL evidence, never a replacement for existing evidence.**
> At every migrated call site: `ok:true` and `reason:'absent'` are POSITIVE answers that
> short-circuit. `reason:'unreadable'` falls back to **exactly the evidence that site uses today** —
> the directory listing, the `stat` probe, or the re-read.

Why it is not optional: the fail-shut collapse (older agent omits the marker → `unreadable`) means
that in `CCRC_FLEET=remote` — the live standing config — **every** measured read answers `unreadable`
until the agent redeploys. Without the fallback, `coord/gitref.ts` would refuse every branch tip
(`tip-unmeasurable`, `coord/fingerprint.ts:213`) and the registry ladder would call every absent
field unmeasured, fleet-wide, for the length of the deploy window. With the fallback, an older agent
takes today's path verbatim and the wave is a strict improvement in every window.

It also makes "provably identical" checkable per site instead of argued: the `unreadable` arm IS
today's code.

---

## The seam's shape (settled by the brief — do not redesign)

```ts
// server/src/io.ts
export type ReadFailure = 'absent' | 'unreadable';
export type MeasuredRead = { ok: true; content: string } | { ok: false; reason: ReadFailure };

export interface FleetIO {
  readFileMeasured(path: string): Promise<MeasuredRead>;
  readFile(path: string): Promise<string | null>;   // derives from readFileMeasured
  …
}
```

- **`localIO.readFileMeasured`** branches on the errno: `ENOENT` → `absent`; **everything else** →
  `unreadable`. The idiom is already shipped twice in this repo and must be copied, not reinvented:
  `server/src/config.ts:100-116` (`loadRoster`) and `server/src/coord/token.ts:110-135`
  (`readMailToken`). Both branch on `(err as NodeJS.ErrnoException).code === 'ENOENT'` and both
  argue the polarity in their docstrings. **ENOTDIR, EISDIR, EACCES, ELOOP, ERR_INVALID_ARG_TYPE →
  `unreadable`**, deliberately: fail-shut, and `coord-fingerprint.test.ts:88` (chmod 000) and `:105`
  (the ref path is a directory) exist to stop a stale `packed-refs` tip settling a wave close.
- **`localIO.readFile` derives**: `const r = await this.readFileMeasured(p); return r.ok ? r.content : null;`
  `this`-based, not `localIO.`-based — verified safe: no call site in `server/src`, `server/test`,
  `server/test-e2e` or `pwa/src` destructures a read method off the io object, so the receiver is
  never lost. It is also what makes a test double that overrides only `readFileMeasured` degrade
  `readFile` too (Task 4).
- **Wire:** the `read` response gains `absent?: true`, set **only** on ENOENT.
  `read → {data: string|null, absent?: true}`. `data` keeps today's meaning exactly (`null` for BOTH
  absent and unreadable) so an older SERVER — whose whole reader is
  `typeof data === 'string' ? data : null`, `remote/io.ts:31-32` — is unaffected. Shape copied from
  `stat`'s `{missing:true}`; **semantics deliberately NOT copied** — `statPath` reports EACCES as
  `missing:true` (`agent/src/fileops.ts:60-65`), which is the same defect one hop deeper (D-114).
- **`remote/io.ts`** gets THE SINGLE READER of that field: `data` is a string → `ok`; else
  `absent === true` → `absent`; else → `unreadable`. A rejected promise (disconnected / timeout /
  `forbidden` / `bad-request`) → `unreadable`. **`forbidden` is never `absent`** — `checkPath`
  refuses a path that very often also does not exist.
- **The reason union lives in `server/src/io.ts`, not `shared/`.** `agent/tsconfig.json` includes
  only `src/**` + `../shared/**`, so the agent cannot import it — and does not need to: the agent
  emits a boolean, and its own result type is local (precedent: `agent/src/fileops.ts:67`
  `WriteResult`). Keeping it out of `shared/` also keeps this off the PWA's bundle path.

---

## Per-site ruling — every `FleetIO` read consumer

Exhaustive: the critic re-grepped `\.(readFile|readFileB64|readFileFrom)\b` across `server/src`,
`agent/src`, `pwa/src`, `shared` and found exactly 20 hits, all classified below.

### Migrating in this wave

| site | today | after | why identical |
|---|---|---|---|
| `registry.ts:287` `field()` | `readFile` → trim → `string\|null` | **`fieldMeasured()` added beside it**; `field()` keeps calling `io.readFile` and is left for unmigrated readers | additive; no existing caller changes |
| `registry.ts` `.branch` → `branchEvidence` | `names.includes` decides `unreadable` vs `absent` | measured decides; `unreadable` falls back to `names` | old agent → `names` path verbatim. Consumer `coord/fingerprint.ts:197` treats the two differently, so this is the one ladder field where the distinction already reaches a user-visible sentence |
| `registry.ts` `.hold` → `held` | `holdListed ? HOLD_UNREADABLE : null` + second listing | measured `absent` → `null` directly; `unreadable` → today's `holdListed` rung, and still enters `holdUnconfirmed` | see D-112 for the one divergence |
| `registry.ts` `.substrate` | `substrateListed ? SUBSTRATE_UNREADABLE : null` | same shape as `.hold` | see D-113 |
| `registry.ts` identity triple | `raw === null && names.includes(...)` → `unmeasured`, else drop | measured `unreadable` + listed → `unmeasured`; measured `absent` → drop | a measured-absent triple member is retired immediately instead of via the second listing — same end state, one listing fewer |
| `registry.ts` `lifecycleUnmeasured` (`started`/`supervised`/`stopped`) | `raw === null && names.includes(...)` | same shape | `.stopped`'s WIDER net (listed-and-readable-but-unparseable) is untouched |
| `coord/gitref.ts:79` loose ref | `readFile` → null → `io.stat` probe → packed-refs | measured `absent` → straight to packed-refs; `unreadable` → **today's `stat` probe, unchanged** | old agent → today's path verbatim; saves one round trip on the ordinary packed-only branch |

### NOT migrating — and the reason, per site

- **`coord/prhistory.ts:73`/`:85`** — `coord-prhistory.test.ts:100` pins *"REFUSES when the registry
  directory itself does not exist — no listing, no evidence"*. Under a measured read that case is a
  plain ENOENT on the file → `absent` → `{ok:true, entries:[]}`, flipping a pinned refusal into a
  pinned success. The listing is not a workaround there, it is the contract: absence is only absence
  when something looked at the directory. Separately, the second read exists to catch a ledger
  CREATED in the gap (`prhistory.ts:56-67` — ccd appends at exactly run-close time), which a measured
  first read does not make unnecessary. **Both lines migrate together or not at all**; here, not at all.
- **`coord/gitref.ts:90` (packed-refs), `:277` (`gitdir`), `:282` (`HEAD`)** — mechanically identical
  (both `!ok` arms → the same outcome), so migrating changes nothing and buys nothing: the
  distinction has nowhere to go until `readBranchTip`'s and `WorktreeRecord`'s own return types
  widen. Out of scope.
- **`hookstate.ts:141`, `livestate.ts:58`, `tasks/read.ts:61`** — each has a consumer that *would*
  legitimately branch on the two (`dispatch.ts:396-403`'s `worker-busy` gate fails OPEN; `fleet.ts:221`
  paints `idle` for an unreadable status file; `tasks/read.ts` drops an unreadable task from both
  numerator and denominator, over-reporting progress against its own stated rule at `:38-39`). But
  each needs its OWN return type widened to carry the answer, which is a behaviour change per
  consumer, not a de-collapsing. **Recorded as D-115; wave-2 or later candidates, named so they are
  not lost.**
- **`limits.ts:126`, `commands.ts:73`** — genuinely indifferent. Both facts already have the same
  correct answer and the type has no arm to carry another.
- **`watch.ts`** — has ZERO `io.readFile` calls; the kill-switches are read by LISTING
  (`watch.ts:208-215` argues why). Untouched.
- **`readFileB64` (`server.ts:804`) and `readFileFrom` (`transcript/{tail,ask,title}.ts`)** — the same
  collapse on different methods; each needs its own wire op and frame. Out of scope, D-114.
- **`config.ts:100`, `coord/token.ts:110`, `fleetstate.ts:195`, `notifylog.ts:40`, `push.ts:42`,
  `buildinfo.ts:24`** — direct `node:fs`, deliberately NOT through `FleetIO`. `token.ts:100-107`
  states a structural reason it can never be: `~/.cc-secrets` is on none of the agent's whitelist
  prefixes. **Do not sweep these onto the new reader** — doing so breaks the boot gate or fail-shuts
  every `/api/mail*` write. `config.ts` and `token.ts` are the *precedent* for the errno branch, not
  candidates for it.

---

## Tasks

### Task 1 — the local half

- [ ] **1.1** RED: add `describe('readFileMeasured')` to `server/test/io.test.ts` — content → `{ok:true}`;
      a missing path → `{ok:false, reason:'absent'}`; a DIRECTORY path → `{ok:false, reason:'unreadable'}`
      (EISDIR is the deterministic non-ENOENT fixture — `chmod 000` does not fail for root); a
      `chmod 000` file → `unreadable`, guarded `it.skipIf(process.getuid?.() === 0)`.
- [ ] **1.2** Add `ReadFailure`, `MeasuredRead`, and `readFileMeasured` to `FleetIO`; implement in
      `localIO` with the ENOENT branch; rewrite `readFile` to derive via `this.readFileMeasured`.
- [ ] **1.3** Correct the interface docstrings: `io.ts:12`'s `// null = missing` becomes the truth,
      **and `io.ts:14`'s identical false comment on `readFileB64`** (the critic's find — two lies on
      this interface, not one; CLAUDE.md names only the first).
- [ ] **1.4** GREEN: `./node_modules/.bin/vitest run test/io.test.ts`. `io.test.ts:13`'s existing
      `readFile` assertions are the derivation's regression pin — they must pass UNCHANGED.
- [ ] **1.5** MUTATION: delete the ENOENT branch (make everything `unreadable`) → 1.1's absent case
      must go RED. Record the before/after counts in the ledger.

### Task 2 — the agent half (wire producer)

- [ ] **2.1** RED: in `agent/test/fileops.test.ts`, beside the existing `read … null for missing ones`
      (`:37`, `toMatchObject`, so it stays green): a missing whitelisted path answers
      `{ok:true, data:null, absent:true}`; a **directory** under a whitelist root answers
      `{ok:true, data:null}` with **no** `absent` key (`expect(res).not.toHaveProperty('absent')`);
      a non-whitelisted path still answers `{ok:false, err:'forbidden'}` with no `absent` key.
- [ ] **2.2** `agent/src/fileops.ts`: `readWhole` becomes result-returning (local type, à la
      `WriteResult`); keep it never-throwing — the dispatch's `.catch` (`server.ts:616`) would leak
      an fs message carrying the absolute path onto the wire.
- [ ] **2.3** `agent/src/server.ts:244`: build the payload through ONE named helper so the mutation
      test has one thing to delete, and spread `absent` only when the reason is absent. **Do not
      touch the shared `ok()`/`fail()` builders** — five exact-equality `toEqual` assertions across
      `fileops.test.ts:154`, `exec.test.ts:91/100/109/138`, `pty.test.ts:103` would break.
- [ ] **2.4** `shared/agent-protocol.ts:105`: update the payload comment to
      `read → {data: string|null, absent?: true}`. That comment IS the schema — `ResOk`'s index
      signature means no compiler checks this field on either side.
- [ ] **2.5** GREEN: `cd agent && ./node_modules/.bin/vitest run`. MUTATION: delete the `absent`
      spread → 2.1 goes RED.

### Task 3 — the remote half (wire reader)

- [ ] **3.1** RED: in `server/test/remote-io.test.ts` (which boots a REAL in-process agent):
      round-trip content, a missing file → `absent`, a directory → `unreadable`, a path outside every
      whitelist → `unreadable` (NOT absent), and a **disconnected client** → `unreadable`.
- [ ] **3.2** RED, the compatibility case that is the whole point: an **OLDER-AGENT** simulation —
      an agent-shaped peer whose `read` response omits `absent` — must answer `unreadable` for a file
      that genuinely does not exist. Build it by driving `createIo` against a stub `FleetClient`
      (the type is structural), not by forking the real agent.
- [ ] **3.3** Implement `readFileMeasured` in `remote/io.ts` with the single reader; `readFile`
      derives. Rewrite the module docstring at `remote/io.ts:5-11`, which currently states the
      collapse as the contract.
- [ ] **3.4** GREEN + MUTATION: change the reader's default arm from `unreadable` to `absent` → 3.2
      goes RED. This is the fail-shut pin.

### Task 4 — honest test doubles (prerequisite for Task 5)

The hazard, confirmed on all 60+ sites: every `FleetIO` double in `server/test` is
`{ ...localIO, readFile: … }`. Adding a required member compiles fine (74 spreads), but a call site
that migrates to `readFileMeasured` makes those overrides **inert** — the spread's real
`localIO.readFileMeasured` reads the fixture file and the test goes green for the wrong reason.

- [ ] **4.1** Add `server/test/ioDoubles.ts` exporting ONE factory that degrades a path predicate to
      a chosen reason and overrides **both** `readFileMeasured` and `readFile` consistently, plus
      `absent`/`unreadable` variants. `server/test/` is not a `single-definition` root, so the seven
      existing copies of `withUnreadableField`/`unreadableField` are unpoliced duplication — this
      retires them.
- [ ] **4.2** Replace those seven copies (`registry.test.ts:25`, `dialog.test.ts:328`,
      `mail-routes.test.ts:68`, `sessionws.test.ts:821`, `routes.test.ts:648`, `mail-sweep.test.ts:158`,
      `run-routes.test.ts:168`) and the inline registry-field degraders that feed `buildRecord`
      (`sessionws.test.ts:1107/1136/1169`, `dialog.test.ts:348/394`, `registry.test.ts:409`,
      `hold-gate.test.ts:88`, `name-sweep.test.ts:123/155/…`, `fleet.test.ts:138/163`,
      `fleetws.test.ts:428`, `push-copy.test.ts:263/333`, `coord-fingerprint.test.ts:533/712`,
      `pr-sweep.test.ts:783`, `coord-abandon.test.ts:293/317`, `fleet-lifecycle.test.ts:87/192`,
      `routes.test.ts:138/158`) with calls to it. **Semantics preserved: today's `readFile → null`
      double means `unreadable`, so that is the default the factory produces.**
- [ ] **4.3** GREEN with NO production change yet — the whole server suite must be green after 4.2,
      proving the refactor is behaviour-neutral before Task 5 depends on it.

### Task 5 — the registry ladder

- [ ] **5.1** RED, per field, in `server/test/registry.test.ts` — the cases that are impossible to
      express today: a **listed** `.branch` whose read is measured-`absent` reads
      `branchEvidence: 'absent'` (today: `'unreadable'`); a **listed** `.hold` measured-`absent` reads
      `held: null` with no second listing (today: `HOLD_UNREADABLE` then a reconfirm); a **listed**
      `.substrate` measured-`absent` reads `null`; a **not-listed** field measured-`unreadable` keeps
      today's answer.
- [ ] **5.2** RED, the compatibility pin: an OLD-AGENT-shaped io (every read `unreadable`) reproduces
      today's ladder answers EXACTLY, field by field — the mechanised form of THE GOVERNING RULE.
- [ ] **5.3** Add `fieldMeasured()` beside `field()` (trimming preserved — `field()`'s `.trim()` is
      load-bearing for the `'empty'` rung). `field()` is UNCHANGED and keeps calling `io.readFile`.
- [ ] **5.4** Migrate, in this order, running the suite between each: `branchEvidence` → `.hold` →
      `.substrate` → identity triple → `lifecycleUnmeasured`. Each keeps its `names.includes` rung as
      the `unreadable` fallback.
- [ ] **5.5** Derive the vocabulary rather than restating it:
      `export type BranchEvidence = 'named' | ReadFailure | 'empty';` — `registry.ts:20` currently
      spells `'absent' | 'unreadable'` a second time inside a `single-definition` root.
      (`single-definition.test.ts` is per-named-symbol and would NOT have caught this; the house rule
      is the reason, not a red suite. Adding a pin for it is 5.6.)
- [ ] **5.6** Add `describe('one absent/unreadable read vocabulary')` to
      `server/test/single-definition.test.ts`, asserting the pair is declared once, in
      `server/src/io.ts`. Mutation: re-inline the union in `registry.ts` → RED.
- [ ] **5.7** GREEN: the whole server suite. Re-run any known load flake in isolation.

### Task 6 — `readBranchTip`'s loose ref

- [ ] **6.1** RED in `server/test/coord-fingerprint.test.ts`: a measured-`absent` loose ref reaches
      `packed-refs` **without** a `stat` call (count the `stat` calls with a counting double).
- [ ] **6.2** Migrate `gitref.ts:79` per the table: `ok` → today's SHA/symref branch verbatim;
      `absent` → straight to packed-refs; `unreadable` → **today's `io.stat` rung, unchanged**.
- [ ] **6.3** The four existing `chmodSync(…, 0o000)` pins (`:99`, `:614`, `:632`, `:683`) must pass
      UNCHANGED — they are the fail-shut contract. Note they are NOT uid-guarded (unlike
      `coord-prhistory.test.ts`); leave that as found and record it (D-116).
- [ ] **6.4** Rewrite `gitref.ts:41-46`, which quotes `io.ts:12`'s `null = missing` **as authority**
      and becomes substantively false once Task 1.3 lands.

### Task 7 — the citations, and the CLAUDE.md entry

- [ ] **7.1** Five docstrings cite `server/src/io.ts` BY LINE NUMBER and all shift when the interface
      block grows: `watch.ts:213`, `transcript/resolve.ts:105`, `coord/prhistory.ts:50`,
      `gitref.ts:42`, `gitref.ts:45`. Two (`prhistory.ts:50`, `gitref.ts:45`) cite `io.ts:41-43`,
      which was ALREADY stale before this wave (the code is at `:48-50`). Re-anchor all five.
- [ ] **7.2** Update CLAUDE.md's "Open on `main`" entry — `FleetIO.readFile`'s docstring is no longer
      false — leaving the two items this wave does not close (`MailDeliveryState` terminality, the
      "account = wrapper" type) intact, and adding the `readFileB64`/`readFileFrom` remainder (D-114).
- [ ] **7.3** FULL SUITES, foreground, in each package: `cd server && npm test`,
      `cd agent && npm test`, `cd pwa && npm test`. Then `cd pwa && npm run build` (the PWA's test
      tree is typechecked by the BUILD, not the suite).
- [ ] **7.4** Open the PR from `ws/plain-ridge` against `main`. Measure the fingerprint ONCE, after
      the final push, and send `wave-done`.

---

## Deviations found

- **D-108 (2026-08-20)** — the brief names the ledger `docs/superpowers/programs/registry-durability.md`,
  but that file is on neither `main` nor this workspace's branch; it lives on
  `origin/docs/registry-durability-ledger`. Found by `git cat-file -e` across every remote ref. The
  worker skill's clause 6 says the plan file governs over recollection; here the *ledger* had to be
  fetched from a branch to be read at all. Recorded so wave 2's worker does not conclude it is missing.
- **D-109 (2026-08-20)** — the wave's own first act reproduced the program's F-1 finding one layer
  down: `curl -H "x-ccrc-mail-token: $(cat …)"` sent the token file's `#`-comment preamble as a
  multi-line header value and every call answered a bare 400 before any route logic ran. The SKILL
  text was fixed in PR #70; the reflex was not. Extraction (`grep -v '^#' … | head -1`) is the only
  correct form, and it is worth stating that the failure is a *transport* 400, not a route refusal —
  no `error` code appears anywhere, which is exactly what makes it hard to read.
- **D-110 (2026-08-20)** — **this wave is AGENT-FIRST even though it touches no `ccd/` file.**
  CLAUDE.md's rule names `ccd/`, `session-hook.sh` and `ccd/coordinator-skill/`; the mechanism behind
  it — the server reads what the fleet host writes — applies verbatim to the `absent` marker. Deploy
  order: `deploy/deploy.sh agent <host>` **then** `deploy/deploy.sh`. Reversed, every measured read
  answers `unreadable` for the length of the window. THE GOVERNING RULE makes that degradation
  equal-to-today rather than a regression, which is why it is a deviation and not a blocker — but the
  order is still the correct one.
- **D-111 (2026-08-20)** — the `absent` marker is **compile-unchecked on both sides**. `ResOk` carries
  `[k: string]: unknown` (`shared/agent-protocol.ts:103`) and `ok()` takes `Record<string, unknown>`,
  so a misspelled or forgotten key produces no `tsc` error anywhere and the payload comment at
  `:105-107` is the only schema. Mitigation, and the reason Task 2.3 routes the payload through one
  named helper: a red-on-deletion test is the sole available mechanism.
- **D-112 (2026-08-20)** — **`.hold`'s one deliberate divergence.** Today, a `.hold` that is LISTED and
  reads null is `HOLD_UNREADABLE`, and the second listing (`registry.ts:663-687`) demotes it to `null`
  only if that listing succeeds AND the name is gone; a FAILED second listing leaves it held
  (fail-shut). After migration, a measured-`absent` hold reads `null` immediately, without consulting
  the second listing at all. The two differ in exactly one case: listed + ENOENT + the second listing
  also fails. The change is deliberate and the direction is defended: `ws-release` unlinks the file,
  so ENOENT from the file's own read is the *strongest* form of "absence IS release" — strictly better
  evidence than a listing that did not come back. It also retires the false-alarm the second listing
  was invented to paper over ("a perfectly ordinary release was reported as `HOLD_UNREADABLE` … and
  `archiveMerged` fired a held-merged push announcing corruption seconds after the operator tapped
  Release"). The second listing STAYS for genuine `unreadable` holds.
- **D-113 (2026-08-20)** — **`.substrate` gets the same divergence, and it closes a live false alarm.**
  `_substrate_clear` removes the marker on the first live probe — a routine event, not an exotic one —
  so a marker listed at the top of a read and cleared before its own field read is reported today as
  `SUBSTRATE_UNREADABLE`, i.e. "the registry is broken", on an ordinary recovery. `.substrate` has no
  second listing of its own (only `.hold` and the identity triple do), so today there is nothing to
  demote it. Measured-`absent` fixes it at the read.
- **D-114 (2026-08-20)** — the collapse is NOT confined to `readFile`. `io.ts:14`'s `readFileB64`
  carries the identical false `// null = missing` comment, and the agent's half folds a THIRD
  condition into the same null (over-cap, `agent/src/fileops.ts:39`). `readFileFrom` swallows twice.
  And `stat` is worse than either: the agent announces EACCES as `{missing: true}`
  (`agent/src/fileops.ts:60-65`), so the wire's existing "absent" marker is already a lie for
  non-ENOENT failures — the shape Task 2 copies and the semantics it must not. All out of scope here;
  named so the next wave has a list rather than a rediscovery.
- **D-115 (2026-08-20)** — three consumers would branch correctly on the distinction but cannot carry
  it without widening their OWN return types, so they are named rather than migrated:
  `dispatch.ts:396-403`'s `worker-busy` gate fails OPEN on an unreadable hookstate and then `/clear`s
  a possibly mid-turn session; `fleet.ts:221`/`sessionws.ts:498` paint `idle` for an unreadable live
  status file, the exact inversion `liveSessionStatus`'s own docstring argues against; `tasks/read.ts:61`
  drops an unreadable task from both numerator and denominator, over-reporting progress against the
  rule stated at `:38-39`. Each is a behaviour change per consumer, not a de-collapsing.
- **D-116 (2026-08-20)** — `coord-fingerprint.test.ts`'s four `chmodSync(…, 0o000)` cases (`:99`,
  `:614`, `:632`, `:683`) are NOT guarded by `it.skipIf(process.getuid?.() === 0)`, while
  `coord-prhistory.test.ts`'s equivalent IS. `chmod 000` does not deny root, so those four silently
  assert the wrong thing under a root test runner. Left as found (out of scope), recorded because
  Task 1.1 adds a fifth chmod case and must NOT copy the unguarded form.
- **D-117 (2026-08-20)** — `server/test/remoteHelpers.ts:3` imports `../../agent/src/server.js`, so
  `server/test/tsconfig.tests.json` pulls agent source into the SERVER typecheck project even though
  it lists no agent path. Consequence for task ordering: Task 2 (agent) must compile before Task 3's
  suite can be called green, and a red `typecheck-tests` after an agent edit is not necessarily a
  server defect.

- **D-118 (2026-08-20)** — `server/test/push-copy.test.ts:333`'s "reads clean exactly ONCE per tick"
  double is VACUOUS: neutering it (degrade nothing) leaves the test green. Measured on BOTH the
  converted double and the pre-conversion original at `c1a6866`, so it is pre-existing, not a
  regression from Task 4. Root cause: the busy→idle fix that test was written for already landed, and
  `assembleFleet` no longer re-reads the field per tick, so the double's `>1 reads` branch is dead
  either way. Preserved bug-for-bug here because Task 4's charter is exact semantics preservation —
  changing it would have been a silent assertion change. Left for whoever next owns that test.
- **D-119 (2026-08-20)** — Task 4.1's wording ("overrides **both** `readFileMeasured` and `readFile`
  consistently") was superseded during execution by "overrides `readFileMeasured` ONLY". Both aim at
  the same invariant, but the `this`-based derivation ACHIEVES it where two overrides only PROMISE
  it — one source of truth instead of two kept in step by hand. This resolves an internal
  inconsistency in the plan rather than departing from it: the seam section above already anticipates
  "a test double that overrides only `readFileMeasured` degrade[s] `readFile` too".

- **D-120 (2026-08-20)** — `readBranchTip`'s migrated loose-ref read carries one residual, stated
  here rather than left in a report nobody will open. Today a null read is followed by an `io.stat`
  on the same path; after migration a measured `absent` skips that probe entirely. In the window
  where a loose ref is CREATED between the read and where the `stat` would have fired, the old code
  observed presence and refused (`tip-unmeasurable`), and the new code goes to `packed-refs`. The
  plan's per-site ruling mandates the skip unconditionally and that stands — a `stat` cannot make an
  ENOENT that already happened un-happen, and a tip measured a round trip earlier is the ordinary
  condition every reader here lives with. The `unreadable` arm keeps the `stat` probe verbatim, so
  the fail-shut cases (EACCES, EISDIR, and an older agent's collapse) are untouched.

## Open questions for the operator

None blocking. Two judgment calls were made rather than asked, both recorded above with their
evidence: D-112 (`.hold`'s divergence, the sacred gate) and the decision to migrate the whole ladder
rather than a subset, which is what the brief's "migrate `field()` and, through it, ladder call sites"
asks for once THE GOVERNING RULE makes each site provably identical. If the coordinator disagrees
with D-112, reverting it is a two-line change confined to `registry.ts`'s `held` expression plus its
test.
