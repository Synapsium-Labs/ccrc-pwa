# program-leverage wave 4 — F4: the kickoff rides the mail lane — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan
> task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retire the last machine injection that bypasses the delivery lane. The program kickoff
stops being a keystroke typed into a pane that may not be listening and becomes durable system
mail, delivered by the same idle-gated lane that has delivered every wave brief since Build 4.

**Architecture:** One L0 vocabulary block (the kickoff template, its ledger path and its subject —
one home, two consumers), one widened system-mail write (`queueSystemMail` grows a sender, a
nullable run, and a return value), one sender-scoped dedupe, one L1 seam
(`server/src/coord/kickoff.ts`, reachable without the sheet), one thin L4 route
(`POST /api/sessions/:id/kickoff` in `server.ts`), and a PWA that swaps one verb and gains the
retry door a durable queue makes possible for the first time.

**Tech Stack:** TypeScript (ESM, `"type":"module"`), Node >= 22.13.0, vitest, fastify (L4 only),
`node:sqlite` via `CoordStore` (L3 only), React (PWA). Zero new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-28-program-leverage-design.md` §6 (on
`origin/ws/brisk-meadow` — fetch that ref; it is not on `main`). Program ledger:
`docs/superpowers/programs/program-leverage.md`, same ref. Run 16, items 84–87.

---

## The seam, and why the spec's two candidates are not a free choice

Spec §6 hands the plan a choice between "a `kickoff` field on `POST /api/sessions`" and "a sibling
`POST /api/sessions/:id/kickoff`". **They were both measured, and only one of them can address a
recipient at all.** The choice is settled by mechanism, not taste (D-1039).

| Candidate | Measurement |
|---|---|
| a `kickoff` field on `POST /api/sessions` | **It never learns who to mail.** The handler is `runCcdOr502` (`server/src/server.ts:1512-1515`), whose success body is the literal `{ok:true}`; `CcdResult.stdout` — where `ccd` echoes the id it computed — is discarded. Recomputing `${wrapper}-${project}` server-side is the exact second implementation D-291 refused (`StartProgramSheet.tsx:8-27`, citing `useProjectedHome.ts`: *"Two implementations of one rule drift; that is what they do."*). Worse: `cmd_start` is **idempotent** (`ccd/ccd:12117`), so the id ccd would print can name a session that was **already running and may be mid-task** — the precise hijack D-292 exists to prevent, relocated to a place where the only guard against it (the sheet's pre-tap refusal) is not in the loop. And queueing before the registry row exists walks the delivery straight into `registry-absent` back-off, which is the one gate that **charges an attempt** and parks at `MAIL_MAX_ATTEMPTS` (`server/src/watch.ts:2417-2426`). Finally the request body has no wire type at all — its shape is spelled inline twice (`server/src/server.ts:1561-1574`, `pwa/src/lib/api.ts:362`) — so an added field would have no single reader. |
| **`POST /api/sessions/:id/kickoff` (chosen)** | The id arrives in the path, measured from a real `/ws/fleet` frame by `startedSessionFor` (`StartProgramSheet.tsx:188-199`) — which is exactly where D-291/D-292 already live. `/api/sessions` is **not** one of the eight `COORD_PREFIXES` (`server/test/coord-routes-single-file.test.ts:19-21`), so the route legally registers in `server.ts` and stays out of two scanners it could not satisfy: `coord-pause-route.test.ts:185-209` demands a box-token check before the first `await` for every `app.post` in `coord/routes.ts` (the PWA holds no box token, on any box, dark or armed), and `coordinator-skill.test.ts:210-250` demands every route registered there be named in the skill corpus or explicitly EXEMPTed. |

**"The D-292 hijack protections move with the ADDRESSING, not the injection"** (brief) is therefore
a statement about what does **not** change. The addressing is `startedSessionFor`'s return value —
`project` **and** `wrapper` **and** `status !== 'dead'` **and** `!preLive.has(s.id)` — plus `gen`,
`myAttemptRef` and the pre-tap `liveMainCheckoutIn` refusal. Every one of those stays byte-for-byte.
The wave changes one verb applied to the id they produce: `prompt(id, text)` → `kickoff(id, {slug,
title})`.

**The queueing seam is not the route handler.** Wave 5's reclaim door (`POST /api/runs/:id/reclaim`
plus a /runs-board re-kickoff) lives in `coord/routes.ts` and must call the same seam without
importing `server.ts`. `server.ts` value-imports `registerCoordRoutes` from `coord/routes.ts`
(`server/src/server.ts:46`) while `coord/routes.ts` imports `server.ts` **type-only**
(`server/src/coord/routes.ts:3`); putting the seam in either would force an L4↔L4 value edge. A
third file below both — `server/src/coord/kickoff.ts`, the shape `dispatch.ts` and `close.ts`
already have — is the only placement where neither delivery file imports the other's module.

---

## Global Constraints

- **Commit on `ws/quiet-meadow`, this workspace's own branch — never a separate feature branch.** The
  done-fingerprint re-measures this branch's tip; work parked elsewhere wedges the close `stale-tip`
  forever.
- **TDD red-first, mutation-table discipline. Write each pin BEFORE the code or prose it pins**
  (wave 1's D-1009: a pin authored after its subject has nothing to fail against). Every step that
  adds a guard is preceded by a step that measures it RED, with the **exact first failing assertion
  recorded verbatim** — the bar wave 3's review set (14 of 19 rows fell short of it and were
  ordered redone).
- **Every "behaviour unchanged" claim needs a fixture that could witness the change.** Wave 2's sweep
  lesson, re-learned in wave 3's fix round: *a fixture that cannot reproduce the topology proves
  nothing.* Tasks 2 and 3 change shipped readers used by dispatch, close and advance; neither may
  claim those lanes are unaffected without a fixture that would go red if they were.
- **No overloaded null at any new seam.** Specifically: `unknown-session` (404) and
  `registry-unmeasurable` (503) are two answers, never one; `queued: true` and `queued: false` are
  two answers, never one 200 with no field.
- **Wire discipline: additive only.** The route is new; the `GET`/`WS` frames are untouched. **Do not
  bump `FLEET_PROTO`** (=1, `shared/api.ts`). One reader per new field.
- **Zero new ccd verbs.** `EXEC_COMMANDS` is untouched. Nothing in this wave shells out.
- **Zero new injections.** After this wave `sendPrompt` has exactly three call sites, unchanged:
  `server.ts:1450` (the operator's own keystrokes), `coord/dispatch.ts:530` (the wave-N≥2 `/clear`)
  and `watch.ts:2527` (the idle-gated mail nudge). `POST /api/sessions/:id/prompt` **survives** — it
  has three PWA callers (`stores/session.ts:384`, `SessionScreen.tsx:221`, and today's kickoff). The
  wave retires the third caller, not the route.
- **The new coord file holds no database handle.** `single-definition.test.ts:397-439`'s
  `HANDLE_HOLDERS` is `{store.ts, rundefs.ts, routes.ts, db.ts, schema.ts}` and scans every `.ts`
  under `server/src/coord` for `./db.js` / `node:sqlite` imports and for a `coord.db` receiver.
  `kickoff.ts` must never run its own `tx(...)`; the transaction stays in `queueSystemMail`, the
  licensed home whose own docstring makes precisely this argument (`rundefs.ts:6-17`).
  **Do NOT add `kickoff.ts` to `HANDLE_HOLDERS`.**
- **No new quoted kebab-case literal under `server/src/coord/`.** `mail-routes.test.ts:383-495` scans
  every `.ts` directly under that directory with `/'([a-z]+(?:-[a-z]+)+)'/g` and requires each token
  to be a declared union member or a `NOT_CODES` entry. `'program-kickoff'` is defined in
  `shared/api.ts` and **imported** by `coord/kickoff.ts`, so no literal lands under `coord/` and no
  `NOT_CODES` edit is needed. If a step finds itself typing a hyphenated literal there, stop and put
  it in the L0 block instead.
- **Single-source-of-truth.** The system-mail sender set is derived (`Object.keys(...)`), never
  hand-typed; the kickoff sentence, its ledger path and its subject have exactly one definition each.
- **Role vocabulary only, in every byte this wave writes — including this plan.**
  `server/test/topology-clean.test.ts` scans `git ls-files` AND every blob `origin/main..HEAD`
  introduces (D-208) and bans the operator's username, the two real box names, the volume id, the
  GitHub handle and the old employer org. **No absolute home path anywhere; use
  `cd "$(git rev-parse --show-toplevel)"`.**
- **Deviation refs are ledgered and bounded.** `server/test/deviation-refs.test.ts` requires the
  highest `D-<n>` token anywhere in the tracked tree to equal the highest `D-<n>` DEFINED by a heading
  or bullet in a plan. Define every number you cite; **never write the top of an unconsumed range with
  a `D-` prefix** — spell this program's block `D-999..1046`.
- **Fixture `D-` refs MUST be spelled SPLIT** — `` `D-${1200}` `` or `'D-' + '1200'`, never
  contiguous. **Never write a bare `D-TBD-...` into a diff** (`server/test/dtbd.test.ts`).
- **Deviations: this program's block is `D-999..1046`; `D-999..D-1038` are consumed by waves 1–3, so
  this wave starts at `D-1039`.** Eight numbers remain. Every number cited below is defined in
  `## Deviations found`. If the block exhausts, write the `D-TBD-<slug>` placeholder **in the mail to
  the coordinator, never in a diff** — `server/test/dtbd.test.ts` reds on a concrete one anywhere in
  the tracked tree, and it reds on this plan too, which is how this sentence learned to use the
  meta-form — and it reconciles at review.
- **The route must be flag-blind and deterministic.** `auth-gate.test.ts:640-717` probes every route
  three times — dark, armed-anonymous, armed-authenticated — with **no body and no Origin**, and
  clause 3 asserts `dark.statusCode === authenticated.statusCode` exactly. A handler that read
  `authEnabled` or the session store would join `FLAG_AWARE` (`:598`), whose size is pinned verbatim
  at `:624`. Do not.
- **No new coloured CSS rule without its grounding and its pin in the SAME commit** (wave 3's
  D-1035). Prefer reusing `program-start-error` / `program-start-go`, which are already grounded and
  pinned; a genuinely new class ships with its `contrast.test.ts` entry and its
  `fleet-css.test.ts` inert-list entry in the same commit, never after.
- **Suites run in the FOREGROUND, `timeout >= 600000`, cd'd into the package.** Single suite:
  `./node_modules/.bin/vitest run test/<file>` from inside `server/` or `pwa/`. **Never bare
  `npx vitest`** — it resolves a global copy with no jsdom and falsely reports "no tests".
- **This wave is NOT agent-first.** It touches no `ccd/`, no `session-hook.sh`, no skill corpus. The
  deploy is the coordinator's act at wave close — **do not deploy anything.**
- **Do not name the route method-spelled in any skill corpus file.** `auth-passkey.test.ts:2284-2321`
  (D-1001's sweep) harvests `(GET|POST|…) /api/...` from `ccd/coordinator-skill` and
  `ccd/worker-skill` and requires every hit to be in the auth `EXEMPT` table; `coordinator-skill.test.ts:199-208`
  additionally requires each harvested route to be registered in `coord/routes.ts`. This wave writes
  nothing under `ccd/` at all, so both stay inert — and wave 5 must use the methodless spelling
  `resume.md` already uses for `/api/sessions/:id/ensure`.

---

## File Structure

| File | Change | Responsibility after the change |
|---|---|---|
| `shared/api.ts` | Add one L0 kickoff block | `ledgerPath`, `programKickoff(slug, title)`, `PROGRAM_KICKOFF_SUBJECT` — the sentence, the path and the subject, each defined once for both packages |
| `server/src/coord/rundefs.ts` | Widen `queueSystemMail`; add the sender vocabulary | `SYSTEM_MAIL_SENDER_MAP` → `SystemMailSender` + `MAIL_ROLE_IDS` (derived); `queueSystemMail(coord, run \| null, {fromId, runId: number \| null, …}): SystemMailQueued` |
| `server/src/coord/store.ts` | Scope the run-mail dedupe by sender | `hasOutstandingMail(fromId, runId, toId, subject)`; the docstring's falsified premise corrected |
| `server/src/coord/kickoff.ts` | **Create** | L1: `queueProgramKickoff(deps, toId, {slug, title}): KickoffOutcome`. Declares its own `KickoffDeps`. Imports no fastify, no `node:sqlite`, no `./db.js`, **no `../inject/send.js`** |
| `server/src/watch.ts` | Teach `tellSender` that a role is not a session | `MAIL_ROLE_IDS`-aware sender resolution; `'coordinator'`'s run-scoped resolution unchanged |
| `server/src/server.ts` | Add one route | `POST /api/sessions/:id/kickoff` — four pre-queue arms, then the L1 seam, then a union→status map. Decides nothing |
| `pwa/src/lib/api.ts` | Add one client method + error copy | `kickoff(id, {slug, title})` beside `prompt`; honest `API_ERROR_TEXT` sentences for the three codes this route can return |
| `pwa/src/fleet/StartProgramSheet.tsx` | Swap the verb; add the retry door; correct the copy | The `prompt` prop becomes `queueKickoff`; `finish()` navigates on success and holds a standing failure with a retry; `kickoff`/`ledgerPath` imported from L0 |
| `server/test/coord-kickoff.test.ts` | **Create** | The L1 seam: queued vs already-outstanding, the body, the sender, the run-less envelope, and the structural no-injection pin |
| `server/test/kickoff-route.test.ts` | **Create** | The route's four refusal arms, its 200s, and the behavioural **no tmux I/O at all** pin with its positive control |
| `server/test/mail-hardening.test.ts` | Extend + reseed | The sender-scoped dedupe's own killer; the `IS`-vs-`=` pin kept alive on a coordinator-sent row |
| `server/test/mail-sweep.test.ts` | Extend | A run-less operator mail's back-off notifies nobody — not the unrelated coordinator, not a phantom `operator` session |
| `server/test/auth-gate.test.ts` | Four numbers + the comment arithmetic | 45→46, 67→68, 64→65, 40→41 |
| `server/test/single-definition.test.ts` | Update one allowlist entry | `ledgerPath`'s exported spelling, in its new home |
| `pwa/test/api.test.ts` | Extend | `kickoff`'s URL, method, content-type and body |
| `pwa/test/start-program.test.tsx` | Extend + rewrite three tests | The verb swap across 19 prompt-asserting tests; the honest failure; the retry door; the L0 literal pin |

**Ordering rationale.** Task 1 ships pure L0 with nothing depending on it, so its reds are pure.
Task 2 changes a shipped write used by dispatch/close/advance and is the only task that can regress
them, so it is isolated and carries its own witness fixtures. Task 3 changes a shipped notification
path and is likewise isolated. Task 4 is pure-with-ports and fully testable without a server. Task 5
is the only task that adds a wire surface. Task 6 is the only task that touches the PWA. Task 7
verifies the whole branch.

---

## Verified facts this plan is built on

Read at `1f6ed803` (this branch's tip at planning time) on 2026-08-30, in this worktree, and each
adversarially re-verified against the file. Do not re-derive them; DO re-check any that a step's
expected output contradicts, and **believe the tree over this table.**

| Fact | Evidence |
|---|---|
| The kickoff is sent from exactly one line, and the sheet's whole apparatus exists to choose its first argument | `pwa/src/fleet/StartProgramSheet.tsx:376` — `void prompt(session.id, kickoff(w.slug, w.title))` |
| `prompt` is an injectable **prop** defaulting to `api.prompt`, not a module import | `StartProgramSheet.tsx:231`, `:240` |
| `POST /api/sessions`'s success body is the literal `{ok:true}`; ccd's stdout id is discarded | `server/src/server.ts:1512-1515` (`runCcdOr502`), route at `:1561-1574` |
| `POST /api/sessions/:id/prompt` calls `sendPrompt` inline with no idle probe and 409s on refusal | `server/src/server.ts:1422-1452`, esp. `:1450-1451` |
| `sendPrompt` has exactly three call sites; only three modules import `../inject/send.js`, and `coord/routes.ts` is not one of them | `server.ts:33`/`:1450`, `watch.ts:13`/`:2527`, `coord/dispatch.ts:11`/`:530` |
| `sendPrompt`'s FIRST act is a tmux capture, and `not-alive` / `dialog-open` / `draft-present` all return **after** it and **before** any `send-keys` | `server/src/inject/send.ts:486-487`, `:495`, `:577`, type loop at `:592-595` |
| `mail.runId` is NULLable (`INTEGER REFERENCES runs(id)`, no NOT NULL) and `PRAGMA foreign_keys = ON` still admits a NULL child key | `server/src/coord/schema.ts:112-123`; `server/src/coord/db.ts:165-167` |
| `mail_deliveries` has **no** `runId` column; its only index is `(state, nextAttemptAt)` | `schema.ts:125-128`, `:177` |
| `insertMail` already takes `runId: number \| null`; `renderEnvelope` already omits the whole `run:` line when `runId === null`; `dueDeliveries` never joins `runs` | `store.ts:1155-1164`; `coord/envelope.ts:66-69`, `:13`; `store.ts:1459-1483` |
| The run-less mail path is already live in production — peer mail — so the delivery lane is measured run-agnostic, not assumed so | `coord/routes.ts:622-637`; `mail-sweep.test.ts:159` (`queueTestDelivery` hard-codes `runId: null`, 55 call sites) |
| `queueSystemMail` is the ONLY caller of `hasOutstandingMail` in `server/src`, and its `m.runId` is typed `number` — so the null arm has **zero** production callers today | `rundefs.ts:139`, `:126` |
| `hasOutstandingMail`'s docstring states the premise this wave falsifies | `store.ts:1351-1352` — *"run mail has its own dedupe … keyed WITHOUT the sender, because the coordinator is its only sender"* |
| The peer lane deduped sender-scoped from the start; the collision is therefore one-way (a pending peer mail hides a kickoff, never the reverse) | `store.ts:1356-1359` (`hasOutstandingPeerDuplicate`, `AND m.fromId = ?`); `routes.ts:623-627` |
| `mail-hardening.test.ts:20-25` is the ONLY assertion a sender-scoped clause flips; `:33-39` inserts `fromId:'coordinator'` and stays green | that file |
| `tellSender` special-cases the `'coordinator'` role and otherwise treats `fromId` as a session id verbatim; it fires on park and on the first `draft-present` back-off | `server/src/watch.ts:2577-2595`, `:2612`, `:2620`, `:2631-2632` |
| `resolveCoordinator(null)` answers whichever program is the **single** active one — and `null` when 0 or ≥2 are active | `store.ts:1179-1192` |
| `'operator'` is already this codebase's role word beside `'coordinator'`, not a new coinage | `schema.ts:96` (`causedBy TEXT — 'coordinator' \| 'operator' \| <session id>`); `close.ts:93`; `routes.ts:1008` |
| `watch.ts` already imports from `coord/rundefs.js`, so a shared role set has a home both can read | `server/src/watch.ts:26` |
| `readSessionRecord` splits absent from unlistable and is **already imported by `server.ts`** | `server/src/registry.ts:895`, `SingleRead` at `:863-866`, contract at `:875-880`; import at `server/src/server.ts:35` |
| `POST /api/sessions/:id/stop` is the in-file precedent for that split, and says why | `server/src/server.ts:1585-1603` — 503 `registry-unmeasurable` vs 404 `unknown-session` |
| `knownId` deliberately folds both into one `false`, and 16 callers turn it into a bare 404 — so it is the wrong gate here | `server/src/server.ts:1388-1401` |
| `server.ts` has no `notConfigured` helper; its canonical shape is inlined | `server.ts:511`, `:585`, `:643`, `:652`, `:1089`, and the comment naming it at `:1312-1313`. **Not** the push routes' `{error}` without `ok:false` (`:1106`) |
| `isSafeSessionId` is already imported by `server.ts` | `server/src/server.ts:40`, used at `:1654`, `:1681` |
| `/api/sessions` is not a coordination prefix, so the route may not live in `coord/routes.ts` and need not | `server/test/coord-routes-single-file.test.ts:19-21`, `:46` |
| The auth route census is a **source scan**, and one new non-exempt POST in `server.ts` moves exactly four numbers | `server/test/auth-gate.test.ts:74-78` (`scanRoutes`), `:195` (45), `:199` (67), `:202` (64), `:463` (40); `:201`/`:464`/`:314` are derived and stay green |
| The three-probe drift loop sends **no body and no Origin**, and requires dark and authenticated statuses to be equal | `auth-gate.test.ts:640-717`, clause 3 at `:709` |
| `single-definition.test.ts`'s programs-path allowlist matches on the trimmed **line text**, not the file — so moving a line is free, but changing its spelling is not | its `ALLOWED_NON_COMMENT`, incl. `'const ledgerPath = (slug: string): string => \`docs/superpowers/programs/${slug}.md\`;'` |
| `mail-routes.test.ts`'s kebab scanner reads only `.ts` **directly under `server/src/coord`** | `server/test/mail-routes.test.ts:383-495`, `NOT_CODES` at `:390-468` (`'wave-brief'` at `:429`) |
| `shared/api.ts`'s import list is pinned to exactly one type import — a pure string template adds none | `server/test/peers-claims-l0.test.ts:156-162` |
| `dispatch.ts`'s own comment already defers to the sheet's constant as "one constant, one place" — a claim this wave makes true | `server/src/coord/dispatch.ts:19-21` |
| `not-idle` and `not-quiet` are FREE gates: `noteGate` touches neither `attempts` nor `nextAttemptAt`; only `registry-absent` (and a send failure) is charged | `store.ts:1686-1691`, `:1699-1705`; `watch.ts:2474-2475` vs `:2417-2426` |
| A cold pane therefore cannot park a kickoff on the idle gates; the floor is `MAIL_QUIET_MS` after the pane's last busy→idle edge | `watch.ts:194-198` (`MAIL_QUIET_MS = 60_000`), `:191` (`MAIL_SWEEP_MS = 10_000`), `:203` (`MAIL_COOLDOWN_MS = 120_000`) |
| `ccd` types `/effort` into every fresh pane, and that turn re-stamps `statusUpdatedAt` — so the 60 s clock starts after it, not at spawn | `ccd/ccd:11897-11908` |
| The nudge teaches the fetch mechanics completely (list → fetch by `deliveryId` → ack) and names no run | `coord/envelope.ts:166-175` |
| Every dispatched worker already cold-starts off exactly this nudge, by design | `coord/dispatch.ts:614-615`, `:644` |
| `MailStrip` never reads `runId`, so a run-less mail renders like any other on the session screen the sheet navigates to | `pwa/src/session/MailStrip.tsx:296-336`; fed by `sessionws.ts:422` |
| A toast is **dropped entirely** when the 401 auth-lost signal is up | `pwa/src/components/Toast.tsx:40`; raised at `pwa/src/lib/api.ts:221` |
| `createApi`'s `post` helper resolves `Promise<void>` and never reads the body; `abandonRun` is the precedent for reading one only when a render depends on it | `pwa/src/lib/api.ts:230`, `:459` |
| `pwa/test/start-program.test.tsx` has 55 tests, 19 of which assert something about the prompt call | that file (see Task 6's table) |
| ~~Highest `D-<n>` defined in the tracked tree is `D-1038`~~ — **FALSE, corrected in the fix round (review MINOR 8b)**. Re-measured at `1f6ed803`: the tracked high-water was **`D-1065`**, another program's block; `D-1038` was only THIS program's consumption. `D-1039..D-1046` are allocated to this program and were unused in both `docs/` and source, which is the half that mattered and the half that held | `git grep -hoE 'D-[0-9]{3,4}' 1f6ed803 \| sort -n \| tail`; `GET /api/ledger?project=ccrc-pwa` |

---

## Task 1: The kickoff sentence gets one home, in L0

The kickoff text lives in the PWA today (`StartProgramSheet.tsx:54-69`) because the PWA was its only
speaker. The server is now the second, and a template that ships twice is the drift this file's own
header warns about. It moves to `shared/api.ts` — L0, import-free, bundled by the PWA and read by the
server (D-1043).

**Files:** `shared/api.ts`, `pwa/src/fleet/StartProgramSheet.tsx`,
`server/test/single-definition.test.ts`, `pwa/test/start-program.test.tsx`,
`server/src/coord/dispatch.ts` (one comment).

- [ ] **1.1 — Move the pin first.** In `pwa/test/start-program.test.tsx`, change the
  `describe('kickoff — the one standing template…')` block's import to come from
  `'../../shared/api'` and rename the imported symbol to `programKickoff`. **Expected RED**, and
  record the first failing line verbatim (it will be a module-resolution / missing-export error, not
  an assertion — say so in the mutation table rather than pretending it was an assertion).
- [ ] **1.2 — Add the L0 block** to `shared/api.ts`, near the other mail constants:
  - `export const ledgerPath = (slug: string): string => \`docs/superpowers/programs/${slug}.md\`;`
  - `export const programKickoff = (slug: string, title: string): string => …` — **the same three
    sentences, byte for byte**, built on `ledgerPath` (never a second inline path — that was fix
    round 1's Minor 3 and it must not be reintroduced by the move).
  - `export const PROGRAM_KICKOFF_SUBJECT = 'program-kickoff';` with a docstring saying why it lives
    here and not under `coord/`: one home for the subject and the body it labels, and no hyphenated
    literal under `server/src/coord` for `mail-routes.test.ts`'s scanner to arbitrate.
  - Add **no import**. `peers-claims-l0.test.ts:156-162` pins the file's import list to exactly one
    entry.
- [ ] **1.3 — Update the programs-path allowlist.** `ledgerPath`'s line now carries `export `, and
  `single-definition.test.ts`'s `ALLOWED_NON_COMMENT` matches on trimmed line text. Replace the entry
  with the exported spelling and rewrite its comment to name `shared/api.ts` and the reason (the
  server composes the body; a browser still has no filesystem to read a ledger off). **Measure the
  red before the edit** — this is a genuine guard doing its job, and the record should show it fired.
- [ ] **1.4 — Delete the PWA copies.** `StartProgramSheet.tsx` imports `ledgerPath` and
  `programKickoff` from `'../../../shared/api'` (the relative spelling the file already uses at `:38`)
  and deletes its own `ledgerPath`/`kickoff`. Keep the sheet's `:54-59` docstring — move it with the
  constant to L0, since it is the argument for why the sheet may name a ledger it never opens.
- [ ] **1.5 — Make `dispatch.ts`'s comment true.** `server/src/coord/dispatch.ts:19-21` says the
  coordinator kickoff idiom is "StartProgramSheet.kickoff. One constant, one place." Repoint it at
  `shared/api.ts`'s `programKickoff` and say that both kickoffs now name their skill from one place.
- [ ] **1.6 — Green.** `cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts
  test/peers-claims-l0.test.ts` and `cd pwa && ./node_modules/.bin/vitest run test/start-program.test.tsx`.
- [ ] **1.7 — Mutation row.** Delete the `export` from `ledgerPath` (or change one word of the
  template) and record the exact first failing assertion for each of the two pins.

**Expected shape of `shared/api.ts`'s new block** (indicative, not to be copied blindly):

```ts
/** The one standing kickoff. It names three things and asserts nothing: the
 *  program slug, the ledger path the operator is expected to have committed,
 *  and the skill to run. THE SERVER NEVER VALIDATES THE LEDGER (`coord/routes.ts`'s
 *  open route: "PARSED BY NOTHING") and neither speaker of this sentence may
 *  pretend to. L0 because it has TWO speakers since wave 4: the sheet renders
 *  the path, and `coord/kickoff.ts` composes the body (D-1043). */
export const ledgerPath = (slug: string): string => `docs/superpowers/programs/${slug}.md`;

export const programKickoff = (slug: string, title: string): string =>
  `You are the coordinator for program \`${slug}\` (${title}).\n` +
  `Its ledger is \`${ledgerPath(slug)}\`.\n` +
  `Run the ccrc-coordinator skill and open the run for wave 1.`;

/** The kickoff's mail subject. Defined here, beside the body it labels, so that
 *  no hyphenated literal lands under `server/src/coord` — `mail-routes.test.ts`'s
 *  scanner arbitrates those, and a subject is not a refusal code. */
export const PROGRAM_KICKOFF_SUBJECT = 'program-kickoff';
```

---

## Task 2: `queueSystemMail` learns a sender, a missing run, and an answer

Three separate narrownesses in one function, each of which the kickoff breaks:

1. `run: Pick<RunRow,'program'|'wave'|'waveOf'>` and `m.runId: number` — a kickoff has **no run**;
   the coordinator opens run 1 itself. Faking `{program: slug, wave: 0, waveOf: null}` compiles and
   even works (`renderEnvelope` skips all three when `runId === null`), but it asserts a run that does
   not exist. The type should express the condition, not the caller invent a value for it.
2. `fromId: 'coordinator'` is hard-coded — see Task 3 for why a kickoff must not claim it (D-1040).
3. It returns `void` and dedupes with a bare `return` — "queued" and "already outstanding" collapse
   into one non-answer, which is exactly the seam defect this repo bans by name (D-1042).

And the dedupe key itself is now unsound: `hasOutstandingMail`'s docstring justifies omitting the
sender with *"the coordinator is its only sender"*, a premise true only while every system mail
carries a run. In the `runId IS NULL` space it shares a key with peer mail, whose subject is
unvalidated free text — so a pending peer mail could silently swallow a kickoff (D-1041).

**Files:** `server/src/coord/store.ts`, `server/src/coord/rundefs.ts`,
`server/src/coord/dispatch.ts`, `server/src/coord/close.ts`, `server/src/coord/routes.ts`,
`server/test/mail-hardening.test.ts`.

- [ ] **2.1 — Write the dedupe's killer first.** In `mail-hardening.test.ts`, add to the
  `hasOutstandingMail` describe: two outstanding rows with an identical `(runId: null, toId,
  subject)` triple, one `fromId:'coordinator'` and one `fromId:'demo-quiet-mesa'`; assert the
  coordinator probe finds only its own and the session probe finds only its own. **Expected RED**
  (today's three-argument signature does not compile / the single probe returns `true` for both).
  Record the exact first failing line.
- [ ] **2.2 — Keep the `IS`-vs-`=` pin alive.** Reseed `mail-hardening.test.ts:20-25`'s row as
  `fromId: 'coordinator'` and pass that sender to the probe. Rewrite its title and comment: the
  property it protects is that a **bound NULL can match at all**, and that property is orthogonal to
  the sender. **Measure it:** mutate `m.runId IS ?` → `m.runId = ?` and confirm the reseeded test
  still goes red — if it does not, the reseed destroyed the pin and must be redone.
- [ ] **2.3 — Scope the dedupe.** `hasOutstandingMail(fromId: string, runId: number | null, toId:
  string, subject: string)` with `AND m.fromId = ?` added to the SQL. Rewrite the docstring: name the
  premise that wave 4 falsified, and say that the run-less space is shared with peer mail whose
  subject nobody validates.
- [ ] **2.4 — Widen `queueSystemMail`.** New signature and return:

  ```ts
  const SYSTEM_MAIL_SENDER_MAP = {
    coordinator: "the program's own coordinator session, speaking as the role",
    operator: 'the operator, through a PWA-surface route — no session sent it',
  } as const;
  export type SystemMailSender = keyof typeof SYSTEM_MAIL_SENDER_MAP;
  /** Sender ids that are ROLES, not registry rows. Anything reading a `fromId`
   *  as a session id must consult this first (`watch.ts`'s `tellSender`). */
  export const MAIL_ROLE_IDS: ReadonlySet<string> = new Set(Object.keys(SYSTEM_MAIL_SENDER_MAP));

  export type SystemMailQueued =
    | { queued: true; mailId: number; deliveryId: number }
    | { queued: false };

  export function queueSystemMail(
    coord: CoordStore,
    run: Pick<RunRow, 'program' | 'wave' | 'waveOf'> | null,
    m: { fromId: SystemMailSender; toId: string; runId: number | null;
         kind: MailKind; subject: string; body: string },
  ): SystemMailQueued
  ```

  `{queued: false}` carries no reason field on purpose: there is exactly one condition under which
  this function declines, and a reason string with one member is a vocabulary pretending to be a
  distinction. `renderEnvelope` receives `run?.program ?? null` etc. — it already ignores all three
  when `runId === null`.
- [ ] **2.5 — Update the three existing call sites** (`dispatch.ts:644`, `close.ts:251`,
  `routes.ts:1102`) to pass `fromId: 'coordinator'` and their real run. Each ignores the return
  value; add one comment at the first of them saying why that is honest — each has at most one
  outstanding instance in flight per run by construction, which is the docstring's own standing
  claim.
- [ ] **2.6 — Witness fixture for the "unchanged" claim.** This task changes the write that dispatch,
  close and advance all use. Add to `server/test/run-routes.test.ts` (or extend an existing dispatch
  test) an assertion that the queued wave-brief's `from:` line still reads `coordinator` **and** that a
  second identical dispatch still queues nothing — a fixture that would go red if the widening had
  changed either. Measure it red by mutating `fromId` at the dispatch call site.
- [ ] **2.7 — Green.** `cd server && ./node_modules/.bin/vitest run test/mail-hardening.test.ts
  test/run-routes.test.ts test/mail-sweep.test.ts test/coord-store.test.ts`.

---

## Task 3: a role is not a session — `tellSender` stops guessing

`tellSender` (`watch.ts:2577-2595`) resolves a blocked mail's sender so the tray can tell somebody the
message did not land. It special-cases exactly one role — `'coordinator'` → `resolveCoordinator(runId)`
— and treats every other `fromId` as a session id verbatim, guarded by a comment that says inventing
one would "tag and presence-gate against an id no registry row carries."

Both halves break under wave 4 unless this task lands (D-1040):

- If the kickoff kept `fromId:'coordinator'` with `runId: null`, `resolveCoordinator(null)` answers
  **whichever program happens to be the single active one** — so with one unrelated program running,
  a `draft-present` back-off on a brand-new coordinator's kickoff pushes `✉ blocked › <that session>`
  at a coordinator that never sent it, is running a different program, and can do nothing about it.
  That is not a hypothetical arm: `programs` rows only leave `'active'` when a close route retires
  them, so "exactly one active program" is the ordinary steady state.
- If the kickoff uses `fromId:'operator'` — the honest answer, and already this codebase's word
  beside `'coordinator'` (`schema.ts:96`, `close.ts:93`) — then the **else** branch fires and pushes
  at a phantom session id, the exact failure that comment forbids.

There is no version of this wave in which `tellSender` is left alone.

**Files:** `server/src/watch.ts`, `server/test/mail-sweep.test.ts`.

- [ ] **3.1 — Write the killer first.** In `mail-sweep.test.ts`, add a case: seed an **active** program
  whose run is `claimedBy: 'demo-the-coordinator'`; queue a run-less mail with `fromId:'operator'` to
  a **different** session whose pane holds a draft (the existing `draft-present` fixture shape); sweep;
  assert the pushes contain neither `'demo-the-coordinator'` nor `'operator'`. **Expected RED against
  the naive shape** — run it first with `fromId:'coordinator'` to see the wrong-coordinator push, then
  with `'operator'` to see the phantom push, and record both first-failing assertions. This is one
  guard with two distinct mutants; the mutation table gets two rows.
- [ ] **3.2 — Import the role set.** `watch.ts` already imports `COORDINATOR_PAUSE_MARKER` from
  `./coord/rundefs.js` (`:26`); add `MAIL_ROLE_IDS` to that import.
- [ ] **3.3 — Resolve roles, not one role.**

  ```ts
  // A ROLE is not a session id. `'coordinator'` is the one role that can be
  // resolved to a session — through the run it names. Every other role
  // (`'operator'`, wave 4) has no session behind it at all: the operator taps a
  // button in a browser. Degrade to null rather than push, tag and presence-gate
  // against an id no registry row carries — the same reasoning the null return
  // below has always carried, now applied to the whole role vocabulary.
  const senderId = !MAIL_ROLE_IDS.has(origin.fromId)
    ? origin.fromId
    : origin.fromId === 'coordinator' ? store.resolveCoordinator(origin.runId) : null;
  ```

  `'coordinator'`'s behaviour is **unchanged** for every mail that carries a run, which after this
  wave is every coordinator-sent mail in the tree.
- [ ] **3.4 — Record the residual honestly.** In the plan's deviations (D-1045) and in a comment
  beside the new branch: a run-less kickoff's back-off and park notices reach **nobody**, by
  construction. The operator's surviving signals are recipient-side and already shipped — the
  queue-time push (`watch.ts:1071-1085`) and the `MailStrip` row with its `attempts`/`lastError`
  (`store.ts:1269-1276`, whose `COALESCE(rr.state,'')` exists precisely so a NULL-run row is not
  dropped). Do not invent a new notification lane in this wave; F7 surfaces parked mail.
- [ ] **3.5 — Green.** `cd server && ./node_modules/.bin/vitest run test/mail-sweep.test.ts test/watch.test.ts`.

---

## Task 4: `server/src/coord/kickoff.ts` — the seam wave 5 will call

**Files:** `server/src/coord/kickoff.ts` (new), `server/test/coord-kickoff.test.ts` (new).

- [ ] **4.1 — Write the suite first, all of it, and measure it red.** `coord-kickoff.test.ts`:
  - a kickoff queues one mail and one delivery, and answers `{queued: true, …}`;
  - a second identical kickoff to the same session answers `{queued: false}` and queues **nothing**
    (assert the delivery count did not move — not merely that the answer changed);
  - the queued body is exactly `programKickoff(slug, title)` — compared against the L0 constant, and
    separately against the literal three sentences, so a change to the constant cannot silently
    change what a coordinator is told;
  - the envelope carries `from: operator`, `subject: program-kickoff`, `kind: status`, and **no
    `run:` line at all** (a positive assertion on absence, since that is the run-less shape's one
    visible difference);
  - the mail row's `runId` is `null`;
  - a kickoff after the first was **acked** queues again (the dedupe is about outstanding mail, not
    about history).
- [ ] **4.2 — The structural no-injection pin,** in the same file, with an anti-vacuity guard:

  ```ts
  // The ring pin. `server.ts` already imports `../inject/send.js` for the
  // operator's own keystroke route, so an import scan there would be dead on
  // arrival — which is precisely why the DECISION lives here and not there.
  // This file is where "the kickoff never injects" can be an architectural
  // property instead of a per-fixture observation.
  it('never imports the injector — the kickoff path has no way to type', () => {
    const src = readFileSync(new URL('../src/coord/kickoff.ts', import.meta.url), 'utf8');
    expect(src.length).toBeGreaterThan(200);          // anti-vacuity: we read a real file
    expect(src).toContain('queueSystemMail');          // …and the right one
    expect(src).not.toMatch(/from '\.\.\/inject\/send\.js'/);
    expect(src).not.toMatch(/\bsendPrompt\b/);
  });
  ```
- [ ] **4.3 — Write the module.** Import block, every line justified by an existing coord precedent:

  ```ts
  import type { CoordStore } from './store.js';
  import { queueSystemMail } from './rundefs.js';
  import { PROGRAM_KICKOFF_SUBJECT, programKickoff } from '../../../shared/api.js';
  ```

  Forbidden outright: `./db.js`, `node:sqlite`, `fastify`, `../inject/send.js`, and any `reply`.

  ```ts
  /** L1 decision function — the program kickoff, as mail. Wave 5's reclaim door
   *  calls this too, which is why it takes a session id and a program rather
   *  than a request. Declares its own deps (the consumer-declared-port rule,
   *  D-1015's precedent); the transaction stays in `queueSystemMail`, the one
   *  file licensed to hold the handle. */
  export interface KickoffDeps { coord: CoordStore }

  /** Two outcomes, never one. `already-outstanding` is not a failure — a kickoff
   *  IS waiting for this session — but it is not the same fact as "queued now",
   *  and a caller that cannot tell them apart is the overloaded seam this repo
   *  bans. Wave 5 is the caller that needs the difference: a re-kickoff most
   *  often targets a session that still has an unacked one. */
  export type KickoffOutcome =
    | { state: 'queued'; mailId: number; deliveryId: number }
    | { state: 'already-outstanding' };

  export function queueProgramKickoff(
    deps: KickoffDeps, toId: string, program: { slug: string; title: string },
  ): KickoffOutcome
  ```

  It calls `queueSystemMail(deps.coord, null, { fromId: 'operator', toId, runId: null, kind:
  'status', subject: PROGRAM_KICKOFF_SUBJECT, body: programKickoff(program.slug, program.title) })`
  and maps the result. **Note:** `'already-outstanding'` is a hyphenated literal in a file under
  `server/src/coord`. It is a **type member**, and `mail-routes.test.ts`'s scanner accepts declared
  union members — verify that by running that suite as step 4.5; if it does not accept it, put the
  outcome union in `shared/api.ts` beside the subject rather than adding a `NOT_CODES` entry, and say
  so in the execution record.
- [ ] **4.4 — Document the constant-subject decision in the module's docstring.** The dedupe key is
  `(fromId:'operator', runId:null, toId, 'program-kickoff')` — deliberately **not** namespaced by
  slug. One session is one program's coordinator; a second outstanding kickoff to a session that
  already has one unread is a thing to refuse, whatever program it names, and a slug-suffixed subject
  would queue both. Recorded as a deliberate narrowing, not an oversight.
- [ ] **4.5 — Green.** `cd server && ./node_modules/.bin/vitest run test/coord-kickoff.test.ts
  test/single-definition.test.ts test/mail-routes.test.ts test/coord-routes-single-file.test.ts`.
- [ ] **4.6 — Mutation rows.** (a) delete the dedupe branch → the "queues nothing" assertion reds;
  (b) add `import { sendPrompt } from '../inject/send.js';` plus a call → the structural pin reds;
  (c) change `runId: null` to a number → the run-less envelope assertion reds. Record each first
  failing assertion verbatim.

---

## Task 5: `POST /api/sessions/:id/kickoff`

**Files:** `server/src/server.ts`, `server/test/kickoff-route.test.ts` (new),
`server/test/auth-gate.test.ts`.

- [ ] **5.1 — Write `kickoff-route.test.ts` first and measure it red.** Four refusal arms, each with a
  fixture that can only produce that arm (the `routes.test.ts:643-706` shapes):
  - no `deps.coord` → **501** `{ok:false, error:'not-configured'}`;
  - an id `isSafeSessionId` rejects → **400** `{ok:false, error:'bad-session-id'}`;
  - a body missing/blank `slug` or `title` → **400** `{ok:false, error:'bad-request'}`;
  - `io.readdir` answering `null` (unlistable registry) → **503** `{ok:false,
    error:'registry-unmeasurable'}`;
  - a real registry directory with no `<id>.uuid` → **404** `{ok:false, error:'unknown-session'}`;
  - the happy path → **200** `{ok:true, queued:true}`, and a second identical call → **200**
    `{ok:true, queued:false}`.

  **The 503-vs-404 pair is the point.** Confirm each reds against a draft that answers 404 for both
  — that is the overloaded null `knownId` would have handed us, and the record must show it was
  measured rather than avoided by good intentions.
- [ ] **5.2 — The queue-not-inject pin, spelled "no tmux I/O at all."** The brief asks for a test that
  reds if a `sendPrompt` call site returns on the kickoff path. Spelling it as
  `expect(calls.some((c) => c[0] === 'send-keys')).toBe(false)` — the shape `run-routes.test.ts:788`
  uses — **would be vacuous here**: `sendPrompt`'s first act is `captureAnsi` (`inject/send.ts:486`)
  and its `not-alive`, `dialog-open` and `draft-present` refusals all return after that capture and
  before the type loop, so on a fixture with no live pane a genuinely-injecting mutant records zero
  `send-keys` and the pin reports green. This is the same substitution `coord-abandon.test.ts:275-307`
  had to make after a narrower pin watched a mutant walk past it. So:
  - record the **command** as well as the argv (the recorder must be able to tell `tmux capture-pane`
    from a ccd verb — `run-routes.test.ts`'s `calls.push(args)` cannot);
  - give the fixture a pane scripted so a `sendPrompt` mutant would **succeed** — no `not-alive`, no
    dialog, no draft — so the pin cannot pass for the wrong reason;
  - assert `execs.filter((c) => c[0] === 'tmux')` is `[]`;
  - assert the durable half in the same test (one due delivery, right recipient, right subject, the
    body verbatim), so "no tmux" cannot be satisfied by doing nothing;
  - **and ship a positive control** in the same file: the same recorder, the same fixture, driving
    `POST /api/sessions/:id/prompt` — which must record tmux. A recorder that never fires passes
    everything.
- [ ] **5.3 — Write the handler.** Registered in `server.ts` beside the other `/api/sessions/:id/*`
  routes. Arms in this order, cheapest first, all deterministic and flag-blind:

  ```ts
  app.post('/api/sessions/:id/kickoff', async (req, reply) => {
    // 501 `{ok:false,error:'not-configured'}` — server.ts has no `notConfigured`
    // helper (coord/routes.ts:270's is local to registerCoordRoutes); this is the
    // shape :1312-1313 already names, and NOT the push routes' `{error}` without
    // `ok:false` (:1106). Unlike :1540/:1811 this route cannot degrade without a
    // store: no coord, no durable mail, so it refuses rather than pretending.
    if (!deps.coord) return reply.code(501).send({ ok: false, error: 'not-configured' });
    const { id } = req.params as { id: string };
    if (!isSafeSessionId(id)) return reply.code(400).send({ ok: false, error: 'bad-session-id' });
    const b = (req.body ?? {}) as { slug?: unknown; title?: unknown };
    if (typeof b.slug !== 'string' || b.slug.trim() === ''
      || typeof b.title !== 'string' || b.title.trim() === '') {
      return reply.code(400).send({ ok: false, error: 'bad-request' });
    }
    // Deliberately NOT `knownId` (:1388-1401), whose `names !== null &&` folds an
    // unlistable registry into "unknown". Same split, same two bodies, as
    // POST /api/sessions/:id/stop (:1585-1603) — a route that answered 404 for
    // both would reopen the overloaded null that 503 gate exists to close.
    const read = await readSessionRecord(deps.io, deps.cfg, id);
    if (!read.found) {
      return reply.code(read.reason === 'unlistable' ? 503 : 404).send({
        ok: false,
        error: read.reason === 'unlistable' ? 'registry-unmeasurable' : 'unknown-session',
      });
    }
    const out = queueProgramKickoff({ coord: deps.coord }, id,
      { slug: b.slug.trim(), title: b.title.trim() });
    return { ok: true, queued: out.state === 'queued' };
  });
  ```

  No `measuredIdentity` gate: this route addresses mail by id and reports no identity fields back, and
  the delivery lane re-measures and refuses to park a degraded row (`watch.ts:2383-2418`). If a later
  step adds identity to the 200 body, the gate comes with it.
- [ ] **5.4 — Four numbers in `auth-gate.test.ts`.** `:195` 45→46; `:199` 67→68; `:202` 64→65; `:463`
  40→41, and rewrite `:454-462`'s arithmetic comment to `68 scanned − 3 websockets − 24
  exempt-and-scanned = 41`, naming the kickoff route as the new gated member. `:198` (coord 22),
  `:201`, `:464` and `:314` are derived and must **not** be touched — if any of them reds, the route
  was registered in a shape the scanner cannot see, and that is the bug, not the number.
  **Do not add the route to `EXEMPT`:** it is a cookie-bearing PWA write and belongs behind the armed
  gate exactly like every other one.
- [ ] **5.5 — Confirm the drift loop is satisfied.** Run `auth-gate.test.ts` and check specifically
  that the new route appears in the armed-anonymous 401 sweep and that its dark and authenticated
  statuses are equal. They will be — with no `deps.coord` in that harness the first arm fires
  identically in both — but *check the output*, do not reason about it.
- [ ] **5.6 — Optional coverage, not forced:** add `/api/sessions/nope/kickoff` to
  `server/test/routes.test.ts:215`'s unknown-id loop and rename it off "all five routes". Do it if it
  is a one-line addition; skip it and say so if the loop's shape does not take a body.
- [ ] **5.7 — Green.** `cd server && ./node_modules/.bin/vitest run test/kickoff-route.test.ts
  test/auth-gate.test.ts test/routes.test.ts test/coord-routes-single-file.test.ts`.

---

## Task 6: the PWA swaps one verb, and gains the door a durable queue makes possible

**Files:** `pwa/src/lib/api.ts`, `pwa/src/fleet/StartProgramSheet.tsx`, `pwa/test/api.test.ts`,
`pwa/test/start-program.test.tsx`.

- [ ] **6.1 — Pin the client method first.** In `pwa/test/api.test.ts`, add a
  `describe('kickoff (wave 4)')` copying the `createSession (Task 13)` idiom verbatim: URL
  `/api/sessions/<id>/kickoff`, method POST, JSON content-type, body `{slug, title}`. **Expected
  RED.** Update the comment at `:356-362`, which currently says `prompt`'s own pin already exists at
  the top of the file.
- [ ] **6.2 — Add the method** immediately after `prompt` in `createApi`'s return object, so the two
  read as the pair they are:

  ```ts
  /** `POST /api/sessions/:id/kickoff` — queues the coordinator kickoff as DURABLE
   *  system mail instead of typing it into the pane. Resolves to `void`: the
   *  route's `queued` flag distinguishes "queued now" from "one was already
   *  waiting", and the sheet renders neither differently — both mean a kickoff is
   *  on its way. A page that renders no difference must not read the field
   *  (`abandonRun` is the standing counter-example: it reads a body because a
   *  render depends on it). */
  kickoff: (id: string, b: { slug: string; title: string }) => post(`${sid(id)}/kickoff`, b),
  ```
- [ ] **6.3 — Honest error copy.** Add to `API_ERROR_TEXT` sentences for the three codes this route
  can hand back that the operator would otherwise read as a bare slug: `not-configured`,
  `registry-unmeasurable`, `unknown-session`. Keep them factual and short; the sheet renders them
  inside a longer sentence.
- [ ] **6.4 — Rewrite the three tests that stop being true,** before touching the sheet:
  - `:297` "sends ONE kickoff prompt naming the slug, the ledger path and the skill" → asserts one
    `queueKickoff` call with `(sessionId, {slug, title})`. The slug/ledger/skill assertion moves to
    the server side (Task 4.1 already pins the body); say so in a comment so the coverage is not
    silently lost.
  - `:324` "a prompt failure toasts once, non-blocking" → **rewritten wholesale.** The 502
    `{stderr:'ccd: prompt: pane busy'}` fixture is a `sendPrompt` shape a queue route cannot produce.
    Replace it with a refusal the route really returns (501 `not-configured`), and assert the new
    behaviour: the sheet does **not** navigate, renders a standing failure naming the session and
    saying nothing was sent, and offers a retry.
  - `:352`/`:374-378` the production-fetch-URL pin → `/api/sessions/claude-ccrc-pwa/kickoff`;
    `toHaveLength(2)` holds because kickoff replaces prompt one-for-one.
- [ ] **6.5 — Add two tests that nothing covers today:**
  - the retry re-posts to the **same** session id, without re-measuring the fleet — D-292's addressing
    was decided once and a retry must not re-open it;
  - a queued kickoff survives a dropped toast: with the auth-lost signal up (`Toast.tsx:40`), the
    failure is still visible because it is sheet state, not a toast. Measure this red against the
    current toast-only shape.
- [ ] **6.6 — Rename the prop and swap the verb.** `prompt?: (id, text) => Promise<void>` becomes
  `queueKickoff?: (id: string, b: {slug: string; title: string}) => Promise<void>` defaulting to
  `api.kickoff`. **Do not name the prop `kickoff`** — it collides with the L0 constant the test file
  imports. Update all 24 injection sites and `OpenHarness`'s type.
- [ ] **6.7 — Rewrite `finish()`.** Success navigates exactly as today. Failure sets standing sheet
  state instead of a toast:

  ```ts
  void queueKickoff(session.id, { slug: w.slug, title: w.title })
    .then(() => {
      if (gen.current !== w.mine) return;   // superseded — a later close/open owns the phase
      setStarting(false);
      navigate(`/s/${encodeURIComponent(session.id)}`);
    })
    .catch((err: unknown) => {
      if (gen.current !== w.mine) return;
      setStarting(false);
      // The session is real; the BRIEF is not. Unlike the injection this
      // replaces, a failed QUEUE leaves nothing durable behind — no mail row, no
      // delivery, nothing the lane will retry — so it cannot be a toast, which
      // `Toast.tsx:40` drops entirely once the 401 auth-lost signal is up. It is
      // a standing statement in the sheet, beside the one act that fixes it.
      setKickoffFailed({ sessionId: session.id, slug: w.slug, title: w.title, why: apiErrorText(err) });
    });
  ```

  Note the reordering: the old shape was `.catch(...).then(...)`, which navigated on **both** arms.
  That was defensible for an injection (the session is real either way) and is not for a queue.
- [ ] **6.8 — Render the door.** When `kickoffFailed !== null`: one sentence naming the session, saying
  the kickoff could not be queued, giving `why`, and stating plainly that nothing was sent; a button
  that re-posts to `kickoffFailed.sessionId` (clearing the state on success and navigating); and a
  second that navigates without retrying. **Reuse `program-start-error` and `program-start-go`** —
  both are already grounded and pinned. If a new class proves unavoidable, its `contrast.test.ts`
  entry and its `fleet-css.test.ts` inert-list entry ship in the same commit (wave 3's D-1035).
- [ ] **6.9 — Correct the copy that stops being true** (D-1044). At minimum:
  - `:666-668` "The run row arrives later, once the coordinator opens it — not from this sheet." →
    say the kickoff itself arrives as mail at the session's next quiet boundary, not instantly.
  - `:625` "Starting here would either send the kickoff into that session, which may be mid-task…" →
    the mail lane will not interrupt a busy session, so the mid-task half is no longer the hazard;
    two coordinators in one project still is. Reword to the reason that survives.
  - `:656-657` the unmeasurable-registry warning → an unlistable registry stops the mail sweep
    outright (`watch.ts:2234`), so it now blocks the **kickoff**, not merely the coordinator's first
    dispatch.
  - Leave `START_PROGRAM_WAIT_MS` at 20 s and leave `:670-672`'s timeout copy alone: that wait is
    about the fleet **row** appearing, not about the kickoff landing, and it stays true. Say this
    explicitly in the execution record — it is the one place where "the sheet's 20 s and the lane's
    60 s conflict" is the wrong conclusion.
- [ ] **6.10 — Green.** `cd pwa && ./node_modules/.bin/vitest run test/start-program.test.tsx
  test/api.test.ts test/tap-targets.test.tsx test/fleet-css.test.ts test/contrast.test.ts`.
- [ ] **6.11 — Mutation rows.** (a) make `finish()` navigate on the failure arm → the new
  no-navigate assertion reds; (b) make the retry re-measure instead of reusing `sessionId` → the
  same-id assertion reds; (c) revert the prop to `api.prompt` → the URL pin reds.

---

## Task 7: whole-branch verification and the handoff

- [ ] **7.1 — Full suites, foreground, timeout ≥ 600000, cd'd in:** `cd server && npm run test`;
  `cd agent && npm run test`; `cd pwa && npm run test`. Record the totals. A green single suite is not
  a green branch (wave 3's D-1032: `as const` in the wrong place typechecks under vitest and not under
  tsc) — the server suite includes `typecheck-tests.test.ts`, and it is the arbiter.
- [ ] **7.2 — Re-run the known load flakes in isolation** before calling anything a break:
  `ccd-ws-gc`, `pr-sweep`, `session-hook`, `typecheck-tests`, `ccd-session-state`.
- [ ] **7.3 — Assemble the mutation table** in the execution record: every guard this wave adds, the
  mutation applied, and the **exact first failing assertion text**. Rows that fell short of that bar
  are recorded as falling short, not rounded up (wave 3's review counted 14 of 19 short and ordered
  them redone; wave 3's own totals were then off by one and had to be corrected — count twice).
- [ ] **7.4 — Self-review** against this plan's Global Constraints, one line per constraint, saying
  how it was met or why it did not apply.
- [ ] **7.5 — Push and open the PR** from `ws/quiet-meadow`. Wait for CI. **Do not deploy** — the
  deploy is the coordinator's act at wave close, and this wave is not agent-first.
- [ ] **7.6 — Measure the fingerprint once, after the last push**, and mail `wave-done` to
  `toId:'coordinator'` naming **`runId 16`**: `branchTip` = `handoffCommit` = `git rev-parse HEAD`,
  `prNumber`, `prPhase` from the eight enum words. Then stop pushing.
- [ ] **7.7 — Release the claim** (`POST /api/claims/12/release`) or let the run's close do it; say
  which in the wave-done mail.

---

## Deviations found

### D-1039 (spec finding, measured before planning) — the spec's two seams are not a free choice

§6 offers "`a kickoff` field on `POST /api/sessions`" or "a sibling `POST /api/sessions/:id/kickoff`"
and hands the plan the pick. Measured: the first **cannot address a recipient**. `runCcdOr502`'s
success body is the literal `{ok:true}` (`server/src/server.ts:1512-1515`) and `ccd`'s stdout id is
discarded; recomputing `${wrapper}-${project}` is the second implementation D-291 refused; and because
`cmd_start` is idempotent (`ccd/ccd:12117`) the id ccd prints may name a session that was already
running and may be mid-task — the exact D-292 hijack, moved to a place with no guard. Queueing before
the registry row exists also walks the delivery into `registry-absent`, the one gate that charges an
attempt and parks (`watch.ts:2417-2426`). The sibling route is the only shape that can carry the
feature, so the plan does not "choose" it so much as report that the other arm is disqualified.

### D-1040 (defect the naive shape would ship) — the kickoff cannot claim to be from the coordinator

`queueSystemMail` hard-codes `fromId:'coordinator'` (`rundefs.ts:141`). `tellSender` resolves that
role through `resolveCoordinator(origin.runId)` (`watch.ts:2580`), which with a null run answers
**whichever program is the single active one** (`store.ts:1179-1192`). So a `draft-present` back-off
or a park on a brand-new coordinator's kickoff would push `✉ blocked › <that session>` at an unrelated
program's coordinator — and "exactly one active program" is the ordinary steady state, not an edge,
because `programs` rows only leave `'active'` when a close route retires them. The kickoff is sent by
the operator through a browser; there is no session behind it. It ships as `fromId:'operator'` — the
word this codebase already uses beside `'coordinator'` (`schema.ts:96`, `close.ts:93`,
`routes.ts:1008`) — and `tellSender` is taught the whole role vocabulary rather than one member of it,
so a role degrades to no-notification instead of being pushed at as if it were a registry row. The
guard ships with two mutants, one per wrong shape.

### D-1041 (latent unsoundness this wave would otherwise open) — the run-mail dedupe's premise

`hasOutstandingMail`'s docstring justifies omitting the sender from its key: *"run mail has its own
dedupe … keyed WITHOUT the sender, because the coordinator is its only sender"* (`store.ts:1351-1352`).
That is true only while every system mail carries a run. A run-less system mail lands in the
`runId IS NULL` key space, which is the **peer** lane — where `subject` is unvalidated free text
(`routes.ts:447`, `:493`) — so a pending peer mail with the subject `program-kickoff` would have
silently swallowed a kickoff, and `queueSystemMail`'s bare `return` would have made the swallow
invisible. The collision is one-way: the peer lane already dedupes sender-scoped
(`hasOutstandingPeerDuplicate`, `store.ts:1356-1359`), so a kickoff never blocks a peer. Fixed by
adding `AND m.fromId = ?` to the run-mail probe, which flips exactly one existing assertion
(`mail-hardening.test.ts:20-25`, a peer-sent row probed by the run-mail guard — the collision itself);
that row is reseeded as coordinator-sent so the `IS`-vs-`=` property it exists to protect stays pinned.

### D-1042 (seam defect, fixed while here) — `queueSystemMail` returned `void`

`rundefs.ts:127`, `:139`: the function returns nothing and short-circuits with a bare `return` when an
identical mail is already outstanding. "Queued" and "already outstanding" therefore collapse into one
non-answer. The three existing callers can live with that — each has at most one instance in flight per
run by construction — but a route that must answer an operator cannot, and wave 5's reclaim door least
of all, since a re-kickoff most often targets a session that still has an unacked one. Widened to
`{queued: true; mailId; deliveryId} | {queued: false}`. The false arm carries no reason string on
purpose: one condition, one value; a vocabulary with a single member is a distinction pretending to
exist.

### D-1043 (single-definition, made true rather than asserted) — the kickoff sentence moves to L0

`dispatch.ts:19-21` already defers to "the coordinator kickoff idiom, StartProgramSheet.kickoff. One
constant, one place." — a claim that held only while the PWA was the sentence's only speaker. The
server is now the second. Both the template and `ledgerPath` move to `shared/api.ts` (L0, import-free,
bundled by the PWA), so the request body becomes `{slug, title}` and the server composes. Two
consequences worth recording: the route is now strictly **less** powerful than
`POST /api/sessions/:id/prompt` (it can queue a program kickoff and nothing else), and wave 5 can
compose a re-kickoff server-side without a browser. Cost: `single-definition.test.ts`'s programs-path
allowlist matches on trimmed line text, so the added `export ` keyword reds it until the entry is
updated — a guard doing its job, measured before it was edited.

### D-1044 (behaviour change, stated not discovered) — the kickoff's latency moves by two orders of magnitude

Injection was synchronous: `sendPrompt` inline, roughly 0.3–4.3 s, with a 409 the PWA could report
(`server.ts:1450-1451`; `inject/send.ts:64-70`). Mail is idle-gated: the sweep asks every
`MAIL_SWEEP_MS` (10 s, `watch.ts:191`), holds `not-idle` until the pane publishes a live state, then
holds `not-quiet` for `MAIL_QUIET_MS` (60 s, `:198`) measured from the pane's **last** busy→idle edge
— which on a fresh spawn is the end of ccd's own `/effort` turn (`ccd/ccd:11897-11908`) — and enforces
a 120 s per-session cooldown (`:203`). Floor ~60 s; a realistic cold spawn 75–120 s. This is bought
deliberately: those same gates are why the kickoff can no longer land mid-thought, and the delivery is
now durable, retried and visible. Two things follow that the plan states rather than lets a reader
discover: the sheet's copy is corrected where it described the old timing, and
`START_PROGRAM_WAIT_MS` is **left at 20 s** because that wait is about the fleet row appearing, not
about the kickoff landing — the two clocks measure different things and reconciling them would be a
mistake.

### D-1045 (limitation of the run-less shape, recorded not fixed) — a kickoff is outside every run-scoped bound

A `runId: null` mail is invisible to machinery that keys on a run: `cancelOutstandingDeliveries`
matches `mail WHERE runId = ?` (`store.ts:611-617`), so no run's close ever clears a kickoff; it counts
toward no run's `unreadMail` (`store.ts:975-982`); and after D-1040 its back-off and park notices reach
nobody at all. It is equally invisible to every peer bound, all of which are `fromId`-scoped
(`hasOutstandingPeerDuplicate`, `outstandingPeerCount`, `peerMailInLastHour` — `store.ts:1356`, `:1372`,
`:1385`), which is why the dedupe guard of D-1041 is the **only** bound on the kickoff producer and had
to be the correct one. Its only terminators are an ack or the six-attempt park. The operator's surviving
signals are recipient-side and already shipped: the queue-time push (`watch.ts:1071-1085`) and the
`MailStrip` row with its `attempts`/`lastError`, which `OUTSTANDING_OR_ABANDONED_SQL`'s
`COALESCE(rr.state,'')` (`store.ts:237-247`) keeps visible precisely so a NULL-run row is not dropped.
F7 surfaces parked mail on the board; this wave does not build a second notification lane for it.

---

## Deviations found in the fix round (review mail 113, 2026-08-30)

**The block is exhausted here.** `D-999..1046` had one number left; it is spent on the MAJOR below.
Everything after it comes from `POST /api/ledger/deviations` — `D-1119..D-1122`, allocated in one
call against a floor of 1119, which is itself the measurement that retires this plan's own false
high-water claim (see the record corrections below).

### D-1046 (defect this wave shipped) — the retry door had none of `finish()`'s supersession guards

`finish()` checks `gen.current` on BOTH arms because closing the sheet mid-flight has to retire
everything outstanding. `retryKickoff` shipped checking neither, and it is the call in this file
MOST likely to be in flight across a close: it starts only after the operator has read a failure
and tapped a button. A late success navigated to the previous attempt's session under whatever the
operator had opened next; a late rejection re-planted the block the close had just cleared, so the
next program's sheet opened showing the old attempt's retry door, aimed at the old attempt's
session. The `finally` is guarded too — a newer retry owns `retrying` once `gen` has moved, and
clearing it from a superseded call re-enables a button whose own call is still outstanding.

Both harms ship with their own pin, and both fixtures had to be repaired before they could witness
anything: the navigate pin pushes the router off the target explicitly (this wave's own measured
lesson, now three waves old), and the re-plant pin has to reopen the sheet, re-pick a project (the
door is gated on `project !== null`) and drop the started session from the frame (the D-292 arm
otherwise replaces the whole fragment). The unguarded code passed the first draft of the second one.

### D-1119 (invariant that was silently false) — the kickoff body was the one uncapped mail producer

`MAIL_BODY_MAX_BYTES` is enforced at the `POST /api/mail` ingress and by `dispatchRun` on its own
composed brief. `queueSystemMail` enforces nothing, which was harmless while every caller composed
its body from server-side facts — and stopped being harmless the moment a producer embedded content
an HTTP caller chose. `server.ts` builds Fastify with no `bodyLimit` override, so a ~900 KB title
under the 1 MiB default reached the handler, landed twice in `coord.db` (the mail row and the
rendered envelope) and was served whole into the recipient's context. The 8 KiB invariant
`schema.ts` states in a comment beside the column was false for exactly one producer: this one.

Capped at the SEAM rather than in the route, because wave 5's reclaim door is the next caller and
inherits the cap by calling the same function. Measured on the COMPOSED body for `dispatchRun`'s own
stated reason — a cap on the raw title lets a title at exactly the ceiling through and queues a mail
over it, and the two producers would then disagree about what 8 KiB means by exactly the length of a
template. The refusal is a THIRD arm (`{ok:false, kind:'oversize', limit, detail}`, the house shape
every other cap on this server answers in), never a second meaning for `queued:false`; the route maps
it to 413 and carries `out.kind` rather than re-spelling the code.

`KickoffOutcome`'s success half is now `SystemMailQueued` INTERSECTED rather than re-declared. The
review named the re-declaration as one-way-silent drift and it was right: a new field on the write's
result would simply not have reached this caller, with nothing going red.

### D-1120 (honest-failure gap) — two of the route's five codes reached the operator as slugs

`API_ERROR_TEXT` could only be taught two of them. `unknown-session`, `bad-session-id` and
`bad-request` are OWNED by `uploadErrorText`, which consumes `apiErrorText`'s OUTPUT as a KEY — so a
sentence there shadows the upload translator's own, and the suite says so (`does not shadow any code
the UPLOAD translator owns`). The remaining codes therefore reached the sheet as bare slugs inside a
sentence that ALSO asserted `<id> is running`, which for a 404 asserts the exact fact the registry
had just denied, above a retry that could not succeed.

Fixed in this file's own established idiom rather than by widening the shared map: a fourth
per-surface translator (`KICKOFF_ERROR_TEXT` / `kickoffErrorText`), composed exactly as
`useAttachImage.ts` composes the upload one, and pinned by the same shadow rule in both directions.
The door's sentence stops claiming the session is running and states what it actually knows.

### D-1121 (stale state, same class as this file's own M3) — a failed kickoff outlived its attempt

`kickoffFailed` was cleared only by close and by a retry that succeeded, so kickoff-A failing and
the operator starting B left A's red block — and A's navigate-to-A button — directly above the Start
aimed at B. This file already fixed exactly this class for `timedOut`; the door is worse, because it
carries an act that strands the create in flight.

RETIRED, NOT RE-KEYED, and that costs something worth stating: the door is the only control that can
re-post for that session, so a kickoff that failed and was then walked away from is not recoverable
from this sheet. The trade is deliberate — the door is on screen, in red, directly above the Start
the operator is choosing to tap instead — and re-keying was rejected because a door about a PREVIOUS
session has no honest key in the CURRENT attempt's terms.

### D-1122 (pins that could not fire) — two of this wave's own assertions measured nothing

Both found by the review, both in this wave's diff, both green for the same reason: a query that
matched something other than the thing under test.

1. `pwa/test/api.test.ts`'s "sends NO prose" pin took the FIRST line containing ``/kickoff` `` — the
   JSDoc line, seventeen lines above the implementation — and asserted that a COMMENT lacked `text`
   and `body`. It could never red on the mutation it names. The behavioural pin that actually holds
   the narrowing is `start-program.test.tsx`'s `Object.keys(body).sort()`. Repaired to select the
   call site (`post(` on the same line) with an anti-vacuity assertion, and measured red against a
   real prose-adding mutation.
2. Four `expect(screen.queryByText(/may be mid-task/i)).toBeNull()` assertions — the D-292
   suppression pins, which are Important-2's own guards — stopped matching anything the moment this
   wave reworded that paragraph from "may be mid-task" to "which is running mid-task". Nothing went
   red, because the assertion is an absence. Re-pointed at `/two coordinators/i`, which is unique to
   that paragraph and survives the correction below.

The class is now three waves old in this program, and the shape is always the same: an absence
assertion whose fixture cannot produce the presence.

---

## Notes for the coordinator

- **Not agent-first.** Server + PWA only; no `ccd/`, no `session-hook.sh`, no skill corpus. Deploy the
  server lane from the merge sha at close.
- **One risk worth naming at review.** A freshly spawned coordinator receives a one-line nudge and
  nothing in its standing context mentions mail: `session-hook.sh` writes only hookstate,
  `_inject_spawn_effort` types only `/effort`, and skills sit unloaded under `<configDir>/skills/`.
  The nudge itself is fully self-sufficient (`envelope.ts:166-175` gives the exact client path, the
  `deliveryId`-not-`id` rule and the ack body), and **every dispatched worker in this program already
  cold-started off exactly this shape** — which is the strongest available evidence that it works.
  The counter-evidence is F1's incident: a worker's first brief once sat queued ~40 minutes
  (`ccd/session-hook.sh:93-124`). This is a model-behaviour question the tree cannot settle; it is
  recorded here rather than asserted away.
- **Wave 5 inherits three things from this wave:** `queueProgramKickoff` (call it from
  `coord/routes.ts`; it imports nothing that file does not already reach), the `'operator'` sender
  role with its `tellSender` handling, and the `{queued:true|false}` distinction, which a re-kickoff
  onto a session with an outstanding one genuinely needs.
- **Block state after this wave:** `D-999..1046` allocated and now **fully consumed** — the fix
  round spent `D-1046` on the MAJOR and then allocated `D-1119..D-1122` from
  `POST /api/ledger/deviations` (floor was 1119, is 1123). The `D-TBD-<slug>` placeholder was not
  needed: the allocator was reachable.

---

## Execution record (measured, 2026-08-30)

Executed in this workspace on `ws/quiet-meadow`, one commit per task, in the plan's order. Every
number below is copied from a run, not recalled.

### Suite totals

| Package | Result | Δ vs `1f6ed803` |
|---|---|---|
| `server` | 241 files, **6010 passed**, 56 skipped | +41 tests |
| `pwa` | 75 files, **2007 passed**, 0 type errors | +24 tests |
| `agent` | 18 files, **281 passed** | unchanged — this wave is not agent-first |

### Reds measured before the code that answers them

Every guard below was written first and run first; the text is the run's own first failing line.

| # | Pin | First failing assertion, verbatim |
|---|---|---|
| 1.1 | the sheet's literal pin, repointed at L0 | `TypeError: programKickoff is not a function` (10 failed / 52 passed) — a resolution error, not an assertion, and recorded as such |
| 1.3 | `single-definition`'s programs-path allowlist | `AssertionError: expected [ Array(1) ] to deeply equal []`, naming `shared/api.ts:3041` |
| 2.1 | the sender-scoped dedupe | `AssertionError: expected false to be true // Object.is equality` (3 failed / 6 passed) |
| 3.1 | `tellSender`, both arms | `AssertionError: expected [ 'operator' ] to not include 'operator'` and `AssertionError: expected [ { …(4) } ] to deeply equal []` |
| 4.1 | the L1 seam | `Error: Cannot find module '../src/coord/kickoff.js'` |
| 5.1 | the route | `AssertionError: expected 404 to be 200` (13 failed / 1 passed — the single pass is the control test, which drives the neighbouring `/prompt` route this wave leaves alone) |
| 6.1 | the client method | `TypeError: api.kickoff is not a function` |

### Mutation table

Nineteen mutations, each applied to SOURCE (never to a test), each reverted from a working-tree
snapshot with the file diffed clean afterwards.

*(Corrected in the fix round: this line read "Twelve" over a table of nineteen rows, while the
self-review section below counted them correctly as nineteen. Wave 3's own lesson — count twice,
because a number written once is written from memory — recurring inside the very record that carries
it. Review MINOR 8a.)*

| # | Mutation | Result |
|---|---|---|
| 1.7a | drop `export` from `ledgerPath` | RED — `expected [ Array(1) ] to deeply equal []` |
| 1.7b | `wave 1.` → `wave 2.` in the template | RED — `expected 'You are the coordinator for program \`…' to be 'You are the coordinator for program \`…' // Object.is equality` |
| 2a | `m.runId IS ?` → `= ?` | RED, 3 — `expected false to be true` ×2, `expected true to be false`. So reseeding the legacy fixture coordinator-sent did NOT destroy the null-safety pin |
| 2b | drop `AND m.fromId = ?` | RED, 2 — `expected true to be false` ×2 |
| 2c | the wave brief's sender → `'operator'` | RED — ``expected '```ccrc-mail\nid: 1\nfrom: operator\n…' to contain 'from: coordinator'`` |
| 2d | the dedupe answers `queued: true` | RED, 2 — `expected true to be false` ×2 |
| 3a | restore the one-role ternary | RED, 2 — the same two assertions as 3.1 |
| 3b | drop ONLY `&& origin.runId !== null` | RED, 1 — `expected [ { …(4) } ] to deeply equal []`. The coordinator arm alone, so the two clauses are independently pinned |
| 4a | delete the dedupe branch | RED, 2 — `expected true to be false` ×2 |
| 4b | import and name `sendPrompt` in `kickoff.ts` | RED — `expected 'import type { CoordStore } from './s…' not to match /from '\.\.\/inject\/send\.js'/` |
| 4c | the kickoff's `fromId` → `'coordinator'` | RED — ``expected '```ccrc-mail\nid: 1\nfrom: coordinato…' to contain 'from: operator'`` |
| 4d | `renderEnvelope` stops gating the run line | RED — ``expected '```ccrc-mail\nid: 1\nfrom: operator\n…' not to contain 'run:'`` |
| 5a | 404 for both registry reasons | RED — `expected 404 to be 503` |
| 5b | the route injects before queueing | RED — `expected [ …(15) ] to deeply equal []` |
| 5c | answer `queued: true` unconditionally | RED — `expected { ok: true, queued: true } to match object { ok: true, queued: false }` |
| 6a | navigate on the failure arm too | **SURVIVED on the first run, 64/64** — see below. RED after the fixture was repaired: `expected '/s/claude-ccrc-pwa' to be '/runs'` |
| 6b | the retry re-measures the fleet | RED — `expected "vi.fn()" to be called 2 times, but got 1 times` |
| 6c | the client posts to `/prompt` | RED, 3 — incl. `expected [ '/api/sessions', …(1) ] to include '/api/sessions/claude-ccrc-pwa/kickoff'` |
| 6d | the client sends prose again | RED — `expected { slug: 'build9-demo', …(2) } to deeply equal { slug: 'build9-demo', …(1) }` |

### The one mutant that survived, and what it cost

**6a survived its first run at 64/64.** The test asserted "does not navigate" by capturing
`location.pathname` before the click and comparing against it afterwards — and nothing in
`start-program.test.tsx` resets the router between tests, so by the time this test ran the path was
already `/s/claude-ccrc-pwa`. The mutant navigated to the path that was already there, and the
assertion could not see it. Repaired by pushing `/runs` explicitly inside the test, and re-measured
red.

This is the third wave in a row to hit the same class — wave 2's sweep fixtures, wave 3's
MAJOR-1 token-path fixture, and now this. The lesson is unchanged and is worth restating in the
words that keep proving true: **a fixture that cannot reproduce the topology proves nothing**, and
the only way to find out which kind you have is to mutate the code and watch.

### Two expectations of mine that were wrong, where the code was right

Both are recorded rather than quietly reshaped, because in both cases the test moved and the
implementation did not.

1. **`unreadableField` → 503.** Written mirroring `POST /api/sessions/:id/stop`, measured **200**.
   `readSessionRecord` answers `found: true` with a degraded record for an unreadable FIELD;
   `reason: 'unlistable'` is the whole-directory collapse alone. `/stop` needs its second
   `measuredIdentity` gate because `stopPair` recomputes a wrapper/project pair into an argv that
   kills a tmux session BY NAME. This route recomputes nothing, and the delivery lane re-measures
   the recipient itself, so refusing would deny a coordinator its brief over a field neither the
   route nor the lane ever reads. Now pinned as a POSITIVE, so adding an identity gate later is a
   decision somebody makes rather than a copy-paste from the sibling.
2. **A body-less `it.each` row.** The "400 for no body" case passed `undefined`, which `post`'s own
   default parameter replaced with the VALID body — green for the wrong reason. It is now its own
   test driving a genuinely body-less `inject`, which is also the shape `auth-gate.test.ts`'s drift
   loop probes every route with.

### The vacuity claim in the queue-not-inject pin is measured, not argued

`kickoff-route.test.ts`'s comment asserts that the ordinary `send-keys`-only spelling would be
vacuous here. Wave 3's review found a recorded mechanism that was a MIS-DIAGNOSIS nobody had
measured (D-1030), so this one was measured: with mutation 5b applied AND the fixture's runner
answering code 1 for `capture-pane`, the send-keys-only spelling of the assertion reported
**1 passed** — the injecting mutant walked straight past it. Both changes reverted, both files
diffed clean. The shipped pin asserts no tmux I/O at all, on a fixture whose pane is LIVE, plus a
positive control driving `/prompt` through the same recorder — because a pin over a recorder that
never fires passes everything.

### Guards that fired during execution, and what each one bought

Six, none worked around:

1. **`single-definition`'s programs-path allowlist** — the `export` keyword alone reds it, since it
   matches on trimmed line text. Entry rewritten with its new home and reason.
2. **`mail-routes.test.ts`'s kebab scanner** refused `KickoffOutcome`'s first draft, a two-word
   string union: *"already-outstanding is not a declared MailRejectCode, RunRefuseCode,
   LifecycleGapReason, ClaimRefuseCode or SessionLifecycle"*. Correct — it reads as a code and
   belonged to no family. The honest answer was that the distinction ALREADY had a single definition
   one ring down, so the outcome now carries `queueSystemMail`'s own `queued` boolean unchanged.
   That scanner also reads COMMENTS, which caught the same literal a second time in a docstring; the
   module now spells codes in backticks and says why.
3. **My own draft's handle-absence assertion** matched `kickoff.ts`'s own PROSE about the rule.
   Deleted rather than fixed: `single-definition` already scans the whole directory for it, and a
   second copy of one rule is the drift that suite exists to refuse.
4. **`single-definition`'s `watch.ts` import pin** required that import line to name exactly one
   symbol. Widened deliberately — the property is "reached through the shared constant, from that
   module", not "that line has one symbol" — rather than adding a second import line from one module
   to satisfy a regex.
5. **`api.test.ts`'s upload-shadowing guard** — `uploadErrorText` consumes `apiErrorText`'s OUTPUT
   as a KEY, so a code it owns must survive unchanged. Adding `'unknown-session'` to
   `API_ERROR_TEXT` reds it. Only the two free codes are mapped.
6. **`dtbd.test.ts`** caught THIS PLAN: it wrote the concrete placeholder twice, in the same
   sentences that quote the rule against it. Rewritten to the `<slug>` meta-form the guard's own
   docstring prescribes. A plan is a tracked file like any other, and it is a good sign that the
   tree does not exempt it.

### A tooling defect of my own, caught mid-round

The first mutation driver restored with `git checkout --`, which reverts to HEAD and therefore
silently destroyed the task's UNCOMMITTED `store.ts` edit. Found by grepping for the changed symbol
rather than trusting the run. The driver now snapshots the working tree before mutating, restores
from that snapshot, and diffs afterwards; every mutation above was run under it. Same class as wave
3's D-1038 — recorded here rather than consuming another number from a block with one left, because
nothing defective reached the tree and no measurement was invalidated (2a's result was taken before
the revert and re-taken after).

### Deviations consumed

**D-1039..D-1045** (seven). **D-1046 is the only number left in the block `D-999..1046`.**

One extension to a deviation as planned: **D-1040** shipped slightly wider than written. The plan
fixed the role-vs-session collapse and left `resolveCoordinator(origin.runId)` alone. Executing it
made the omission untenable — the same doctrine ("degrade, never guess") that forbids pushing at a
role also forbids inferring a coordinator for a mail that names no run, since
`resolveCoordinator(null)`'s single-active-program answer is exactly right on the ADDRESSING side
and a guess as sender attribution. Both arms now degrade, both are pinned, and mutation 3b shows
they are pinned independently.

### What the whole-branch run caught that no single suite did

`dtbd.test.ts` (guard 6). Every package suite ran green task-by-task; the placeholder was in a
markdown file no package suite reads, and only the full server run — which scans the tracked tree —
saw it.

### Self-review against this plan's Global Constraints

| Constraint | How it was met |
|---|---|
| Commit on `ws/quiet-meadow` | Eight commits, all on this workspace's own branch; no feature branch was cut |
| TDD red-first, exact first failing assertion recorded | Seven reds in the table above, each quoted from its run; nineteen mutation rows likewise |
| Every "behaviour unchanged" claim gets a witness | Task 2 changed the write dispatch/close/advance share, so it shipped two fixtures that would see the change (mutations 2c and 2d), not a claim |
| No overloaded null at any new seam | 404 vs 503 split through `readSessionRecord` (mutation 5a); `queued: true` vs `false` carried from `queueSystemMail` to the wire (5c); sender-scoped dedupe (2b) |
| Wire additive-only, no `FLEET_PROTO` bump | One new route; no frame changed; `FLEET_PROTO` untouched |
| Zero new ccd verbs | Nothing in this wave shells out. `EXEC_COMMANDS` untouched |
| Zero new injections | `sendPrompt` still has exactly three call sites, unchanged; `POST /api/sessions/:id/prompt` survives with its three PWA callers |
| The new coord file holds no handle | Enforced directory-wide by `single-definition`; the duplicate assertion I drafted was deleted rather than kept |
| No new quoted kebab literal under `server/src/coord/` | `PROGRAM_KICKOFF_SUBJECT` lives in L0 and is imported; the scanner caught two prose violations and both were rewritten |
| Single-source-of-truth | `MAIL_ROLE_IDS` derived from `Object.keys`; the kickoff sentence, its path and its subject defined once each |
| Role vocabulary only | `topology-clean` green |
| Deviation refs ledgered and bounded | `deviation-refs` green; `dtbd` green after the meta-form fix |
| Flag-blind, deterministic route | Not EXEMPT; appears in the armed-anonymous 401 sweep by name; the drift loop is green with the route in its swept set; the handler reads neither the flag nor the session store |
| No new coloured CSS rule | None added — the retry door reuses `program-start-error` and `program-start-go`; `contrast.test.ts` and `fleet-css.test.ts` both green |
| Suites in the foreground, `timeout >= 600000`, cd'd in | All three run that way; totals above |
| NOT agent-first; do not deploy | No `ccd/`, no `session-hook.sh`, no skill corpus touched. Nothing deployed |

Two constraints deserve a sentence rather than a row. **"Write each pin BEFORE the code it pins"**
held for every task except the two expectation corrections in Task 5, where the pin was written
first and then MOVED after measurement contradicted it — which is the same discipline arriving at a
different answer, and is recorded as such rather than presented as foresight. And **"the deploy is
not the worker's act"**: nothing was deployed, and the coordinator's own re-measurement is the next
step, not mine.

### The fold: PR #34 (D-1066) landed on `main` mid-wave

`3b7f58d8` merged while this branch was at task 7. It touches four files this wave also touches —
`server/src/watch.ts`, `server/test/mail-sweep.test.ts`, `shared/api.ts` and (not ours)
`pwa/src/session/MailStrip.tsx` — and it is in the same `sweepMail` loop. Merged, not rebased
(wave 3's precedent). Git auto-merged all three overlapping files, and a clean TEXTUAL merge is not
a semantic one, so the overlap was read rather than assumed:

- Its new `session-dead` rung sits at the tmux gate (`watch.ts:2479-2517`) and parks through
  `store.rejectDelivery` **directly**. It never calls `tellSender`, which is not even in scope
  there — so it cannot interact with this wave's role-aware sender resolution, and this wave cannot
  change what it reports. Independent.
- Its own commit message anticipated this wave by name: it relaxed `lifecycle-sweep`'s parity signal
  from "no lifecycle vocabulary anywhere in `sweepMail`" to a named ban plus an allow-list,
  defending the rule its comment states — *"wave 4 adds a producer BESIDE it, never inside it"*.
  This wave adds no lifecycle vocabulary at all, so that guard is satisfied trivially.
- **It adds a FOURTH way a kickoff can park**, which D-1045's list did not have: a kickoff addressed
  to a session somebody archived now backs off and parks `undeliverable` at the ceiling instead of
  retrying for ever. That is right for a kickoff — an archived coordinator should not accumulate
  mail — and it is recorded here so the next reader does not think the list was wrong.

Post-merge totals: server **241 files / 6021 passed**, 56 skipped; pwa **75 / 2007**, 0 type errors;
agent 281.

### A verification miss of my own, caught by the post-merge run

The task-6 pwa run was checked with `grep -E "FAIL|Tests |Type Errors"`, which printed
`Tests 2007 passed` and `Type Errors  no errors` and looked green. Reading the tail instead showed
`Errors  2 errors` — two **TypeCheckError**s reported as *unhandled source errors* rather than as
type errors: `programKickoff` and `toast`, both left imported in `StartProgramSheet.tsx` after the
sheet stopped composing the sentence and stopped toasting. Both removed.

Two things worth carrying forward. First, vitest prints `Type Errors  no errors` on the same run
that reports two TypeCheckErrors, so that line is not the typecheck verdict and must not be read as
one. Second — the process point, and the one that actually bit — **a grep over a suite's output is
not a reading of it**: the filter that made the output short is the same filter that hid the finding.

---

## Fix round (review mail 113, 2026-08-30)

Verdict on the wave: **SHIP-WITH-FIXES** — 1 major, 7 minors, 2 refuted, from a 26-agent adversarial
pass whose live re-measurement at `9df76bf0` matched this record exactly. Every finding below was
verified against the tree before it was acted on, and one of them turned out to be understated.

### Reds and mutations

Each mutation applied to SOURCE, reverted from a working-tree snapshot, the file diffed clean after.

| # | What was measured | First failing assertion, verbatim |
|---|---|---|
| F1a | `retryKickoff` with no generation guard, late SUCCESS | `expected '/s/claude-ccrc-pwa' to be '/runs'` |
| F1b | `retryKickoff` with no generation guard, late REJECTION | `expected <p class="program-start-error"></p> to be null` |
| F2a | the seam with no body cap (5 tests) | `expected undefined to be false` |
| F2b | the route with no 413 arm (2 tests) | `expected 200 to be 413` |
| F3a | the sheet without `kickoffErrorText` | `expected 'claude-ccrc-pwa is running, but its k…' to match /no longer in the registry/i` |
| F3b | `apiErrorText` before `KICKOFF_ERROR_TEXT` existed (2 tests) | `kickoffErrorText is not a function` |
| F4 | `kickoffFailed` not retired by a new `start()` | `expected <p class="program-start-error"></p> to be null` (the received text is A's door, above B's Start) |
| F5 | the re-pointed D-292 absence pins, against a sheet that always renders the refusal | RED, 11 — `expected <p class="program-start-existing"></p> to be null` |
| F6 | the repaired "sends NO prose" pin, against a real prose-adding mutation | `expected '    kickoff: (id: string, b: { slug: …' not to match /\btext\b\|\bbody\b/` |

**F6 was also measured the other way**, which is the whole point of the finding: with the same
mutation in place, the ORIGINAL predicate (`find(l => l.includes('/kickoff`'))`) selected
`" * \`POST /api/sessions/:id/kickoff\`'s own refusals (wave-4 review, MINOR 3,"` — a docstring line
— and its assertion passed. The pin could not fail on the mutation it was written for.

### The finding that was worse than reported

MINOR 6 was reported as a copy defect. It is also a **guard defect**: four
`expect(screen.queryByText(/may be mid-task/i)).toBeNull()` assertions — the Important-2 suppression
pins, which are the guards on the one D-292 arm that renders a refusal — stopped matching anything
the moment this wave reworded that paragraph. Nothing went red, because they assert an ABSENCE and an
absence is trivially satisfied by a string that no longer exists. Re-pointed at `/two coordinators/i`
and measured against a mutant that drops `!isOwnAttempt`: 11 red. Recorded as the second half of
D-1122, with MINOR 5 — the class is one, and it is now three waves old in this program.

### Notes the review asked to be recorded

- **`KickoffOutcome` no longer re-declares `SystemMailQueued`.** It intersects it. The re-declaration
  was one-way-silent drift — a new field on the write's result would not have reached this caller and
  nothing would have gone red. Acted on rather than merely noted, because the same commit was
  changing that type anyway (D-1119).
- **`queued: false` folds two facts, deliberately, and wave 5 will need them apart.** The dedupe key
  is `(operator, null, toId, subject)` with no slug in it, so "this session already has a kickoff for
  THIS program" and "…for a DIFFERENT program" answer identically. That is right for the sheet — both
  mean *do not queue a second one* — and it is the fold the reclaim door has to open, because
  re-kickoff onto a session holding another program's kickoff is a genuinely different situation from
  re-kickoff onto its own. Recorded as a known fold, not fixed: inventing the distinction here with
  no consumer would ship a seam nothing reads.
- **`typecheck-tests` needs the sibling packages' `node_modules`.** A `server`-only `npm ci` leaves it
  reporting 2 failures that are missing-module resolution, not type errors. Environmental; the
  full-suite runs in this record were all done with all three packages installed.
- **The repo `CLAUDE.md` sentence "Box token gates every coordination WRITE … except THREE
  deliberately ungated operator doors" now has a fourth shape it does not name.** This wave's
  `POST /api/sessions/:id/kickoff` is a coordination WRITE that is session-gated only, by the brief's
  own instruction (the PWA holds no box token). It is not an ungated door — armed, it sits behind the
  auth gate exactly like every other PWA-surface write — so the sentence is not wrong so much as
  incomplete. Left for wave 5's `CLAUDE.md` correction to fold in rather than edited here, where it
  would be a second uncoordinated edit to the same paragraph.
- **The queue-not-inject pin's divergence from the brief's literal spelling was ACCEPTED** by the
  review as a measured-stronger superset. The vacuity measurement behind it stands: a `send-keys`-only
  spelling reported *1 passed* against a route mutated to inject.

### Scope declined, and why

MINOR 3 named two harms: a slug where a sentence belongs, and a retry door offered for a code where a
retry can never succeed. The first is fixed. The second is not: the door still renders for
`unknown-session`, and its copy now says what the registry answered instead of asserting the opposite.
Suppressing the controls per code class would put a code-class predicate in the sheet — a distinction
the server states and the client would then re-derive — for a failure whose worst case is one wasted
round trip that re-renders the same sentence. Recorded rather than done, and it is the coordinator's
call if that is the wrong trade.
