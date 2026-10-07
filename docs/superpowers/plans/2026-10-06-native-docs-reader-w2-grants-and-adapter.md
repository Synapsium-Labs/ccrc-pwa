# Native Docs reader, wave 2 — grants and adapter Implementation Plan

> **For agentic workers:** this wave is dispatched by the programme's coordinator as one run (see "How this wave runs" below). The worker executes it with REQUIRED SUB-SKILL superpowers:subagent-driven-development (recommended) or superpowers:executing-plans, task by task, under the `ccrc-worker` skill. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the server everything it needs to call the four Docs verbs safely, with no route yet: the agent's four enrolled grants, the five `CcdArgv` builders and `DOCS_CAP`, the four runner budget rows, the L1 policy (`server/src/docs/policy.ts`), the consumer-declared L2 ports (`server/src/docs/ports.ts`) and the L3 ccd adapter (`server/src/docs/ccdsource.ts`) with the tri-state cap gate, classification checks 1-9 and the second redaction pass, so that W3 can register routes that only apply L1 verdicts to L3 answers.

**Architecture:** Three new files under `server/src/docs/`, one per ring, checked by their imports. `policy.ts` (L1, imports only `shared/`) decides: the HTTP status of every failure word (`DOCS_FAILURE_HTTP`) and its `Retry-After`; the API query, `:project` and refresh-body parsers built from W1's L0 predicates; request provenance; `refreshDue` and `fetchBranchFor`; read-lane admission and wire estimates; `cacheControlFor` and the response-header verdict over W1's headers table. `ports.ts` (L2, type-only) declares `DocsReader {index, tree, show}` and `DocsFetcher {fetch}` for W3's routes; every operation answers its own named result type, `{ok: true; answer} | DocsFailureBody`, with no shared null. `ccdsource.ts` (L3) implements both ports over the existing `CcdRunner`: it gates on `ccdVerbs` before any exec, classifies the `CcdResult` through §2 (b)'s checks in order, carries ccd's words and context verbatim, verifies show integrity, pins and size, and redacts every string leaf of a failure body a second time. The agent gains four enrolled grants, `ccdargv.ts` five builders and `DOCS_CAP`, `runner.ts` four rows, `lifecycle.ts` one additive reader (`ccdEnding`) so that `killed`/`signal` keep a single reader. A docs ring guard appended to `single-definition.test.ts` pins the rings. One W2 run: one worker, one reviewer.

**Tech Stack:** TypeScript (node >= 22.13; TS 7 for server and agent), vitest 4.1, `node:crypto` (L3 only). No fastify import anywhere in W2 (W3 owns L4).

**Spec:** `docs/superpowers/specs/2026-10-01-native-docs-reader-design.md` — §1's units (policy, ports, ccdsource rows), §2 (a) Verbs, Caps and Budgets, §2 (b) exit contract, One redactor and Server classification, §2 (e) pins (check 8's echoes), §2 (g) Stale on open, Flow and GET-never-fetches wall 1, §2 (i) status tables, §2 (j) rows 44-47, 53 (L1 half) and 62 (L3 half), §3.2's `parseDocsApiQuery` paragraph, §3.4 parameter rules and refresh flow, §3.5, §3.7, §3.8, §3.12, §5.2's `cacheControlFor`, §5.3's header values, §6.1-§6.3 and §6.6, §7.1's skew table (C1, C3), §7.7's W2 row, §7.9's W2 suites, §7.10's M7.4 (runner-budget clause), M7.7 and M7.10, §3.14's M3.4 (L1 half), M3.9, M3.10, §6.10's M6.1 and M6.3-M6.5.

**Format:** Markdown, not the self-contained HTML the operator's standing preference (2026-10-06) asks of new plans, kept so on purpose: `server/test/deviation-refs.test.ts` and the ledger's floor scan read `*.md` plans only, so an HTML plan would hide the `D-N` entries Task 6 defines from the collision guard, and Task 9's `w2-rows.py` and `w2-results.py` parse this file's Markdown headings and fences. A coordinator's or the operator's ruling may change that; until then this sentence records the departure.

## Global Constraints

- SAFETY: fixture HOMEs only (`makeCcdHarness('ccd-docs-')`, `server/test/ccdWsHelpers.ts`); W2 needs none, because no W2 test runs `ccd`. Never run `ccd` against the live HOME, never run a destructive ccd verb, never touch tmux, `~/.cc-sessions`, `~/.cc-limits` or `claude-session@*` units, never print a secret file's contents. The adapter tests drive a recording `CcdRunner` double; the two real-runner cases point `cfg.ccdBin` at a stub shell script in a `mkTmp` directory, never at `ccd`. `docs-budget.test.ts` reads `ccd/ccd` and `ccd/ccrc-doctor-checks` as TEXT only. Mutations run in a scratch COPY of the tree (`git archive HEAD | tar -x -C <copy>` then `git -C <copy> init -q`, D-4160's lesson), never in the worktree.
- Scope. W2 edits exactly: `agent/src/whitelist.ts`; `agent/test/types/bypasses/g16..g19-*.ts` (new), `agent/test/types/ok/legit-whitelist.ts`, `agent/test/whitelist-structural.test.ts`, `agent/test/whitelist.test.ts`; `server/src/ccdargv.ts`, `server/src/remote/runner.ts`, `server/src/lifecycle.ts` (one additive reader); `server/src/docs/policy.ts`, `ports.ts`, `ccdsource.ts` (new); `server/test/*`; and this plan (Task 6 appends `## Deviations found`, Task 9 appends `## Wave 2 results`). It makes NO edit to `ccd/ccd` (so no restamp, no citation tax), `ccd/ccrc-doctor-checks`, `shared/*` (W1's `shared/docs.ts` is consumed, never amended), `pwa/src`, `server/src/server.ts`, `server/src/index.ts`, `README.md`, and adds no `routes.ts`, `hooks.ts`, `lane.ts` or `cache.ts` (W3). No `FLEET_PROTO` bump, no `shared/agent-protocol.ts` change; `EXEC_COMMANDS` stays `['tmux','ccd']`; `UNGRANTABLE_VERBS` stays `['ws-rm','ws-gc']`.
- Base. The workspace branch must contain W1. Task 1 Step 0 checks content, not ancestry (W1 may land squashed): `grep -q 'export const DOCS_FAILURES' shared/docs.ts && grep -q '^  echo docs-v1$' ccd/ccd && test ! -e server/src/docs`. If any fails, stop and put an ask to the coordinator; never merge, rebase or pull inside a task.
- Rings, by imports (M7.10; the architecture doctrine `2026-08-10-architecture-ddd-clean-solid.md`):
  - `policy.ts` (L1): every import specifier is `../../../shared/docs.js` (type or value). No `node:` import, no `Buffer`, no clock (`Date.now`, `new Date`, `performance.now`), no timer, no fastify, no `reply`, no `console`. Narrow input, typed union out.
  - `ports.ts` (L2): `import type` lines only, no runtime export (no `export const`/`function`/`class`). Declared by the consumer (W3's routes), docstring states each method's failure contract.
  - `ccdsource.ts` (L3): no fastify, no `reply` identifier, no `setTimeout`/`setInterval`/`setImmediate`. May import `../ccdargv.js`, `../lifecycle.js`, `../exec.js` (`UNMEASURED`), `../fleetstate.js` (type), `node:crypto`, `./policy.js`, `./ports.js` (type) and `../../../shared/docs.js`.
  - An adapter never narrows a distinction it received; no overloaded `null` at a seam (every `null` in a W2 signature has exactly one stated meaning); a server log line is `console.warn('ccrc-server: ...')`, never `req.log`.
- Exact values, copied from the spec:
  - Grants and enrolment: `docs-index` -> `'--all'`, grant `['docs-index','--all']`; `docs-tree`, `docs-show`, `docs-fetch` -> `'--project'`, grants `['docs-tree','--project']`, `['docs-show','--project']`, `['docs-fetch','--project']`. ONE `docs-show` grant serves both modes.
  - Builders (verb first; values reach ccd unvalidated; the one type-level closure is `section: DocSectionSlug`): `docsIndex()` -> `docs-index --all`; `docsTree(project, ref: string | null)` -> `docs-tree --project P [--ref R]`; `docsShowCommitted(project, commit, servedRef, section, path, maxBytes: number)` -> `docs-show --project P --commit C --ref R --section S --path X --max-bytes N` (12 tokens after the verb); `docsShowDraft(project, branch, head, section, path, fp, maxBytes: number)` -> `docs-show --project P --draft-branch B --head H --section S --path X --fingerprint F --max-bytes N` (14); `docsFetch(project, branch: string | null)` -> `docs-fetch --project P [--branch B]`. No `--blob`, no `--worktree`, no `--`.
  - `DOCS_CAP = 'docs-v1'`, declared once, in `server/src/ccdargv.ts` beside the other cap constants (directly after `EXPIRE_CAP`, the last one at the base).
  - The gate, inside each adapter function that calls `CCD_ARGV.docs*(`: `const verbs = state.ccdVerbs; if (verbs === null || !verbs.includes('caps')) return fail('caps-unknown'); if (!capSupported(state, DOCS_CAP)) return fail('unsupported');` — both decided before any exec.
  - Runner rows in `CCD_VERB_TIMEOUT_MS` (`server/src/remote/runner.ts`), each written as a quoted key at line start, underscored digits and a trailing comma: `'docs-index': 20_000,`, `'docs-tree': 20_000,`, `'docs-show': 15_000,`, `'docs-fetch': 60_000,`. Invariant: helper deadline + 2 s grace + 5 s < runner budget, with helper deadlines 12 / 12 / 7 / 45 s (`HELPER_DEADLINE_S`, `KILL_GRACE_S` in ccd). The doctor's `: "${CCRC_DOCTOR_DOCS_TIMEOUT:=20}"` equals `CCD_VERB_TIMEOUT_MS['docs-index']` / 1000.
  - Read lane (L1 constants in `policy.ts`): `DOCS_LANE_EXECS = 2`, `DOCS_LANE_BYTES = 3145728`, `DOCS_LANE_LARGE_RAW = 1048576` (the "one answer over 1 MiB" threshold), `DOCS_LANE_QUEUE = 32` (test: `>= DOCS_MAX_IMAGES_PER_PAGE + 2`), `DOCS_LANE_MAX_WAIT_MS = 10000`. `laneAdmit` is §6.3's four clauses in order. `showRawBound(classCap, knownSize) = Math.min(classCap, knownSize ?? classCap)`; `showWire(raw) = 4 * Math.ceil(raw / 3) + DOCS_ENVELOPE_RESERVE`; `LISTING_JOB = { raw: DOCS_MAX_LISTING_WIRE_BYTES, wire: DOCS_MAX_LISTING_WIRE_BYTES }`; `showWire(2097152) = 2861740 <= DOCS_LANE_BYTES`.
  - `refreshDue(tree)` is §2 (g)'s pseudocode exactly (`>=`; `DOCS_STALE_MS` for `ok`/`remote-branch-absent`, `DOCS_RETRY_FLOOR_MS` otherwise; `false` for a `refs/heads/...` request and for `remote === null`; `true` for `stamp === null`). `fetchBranchFor`: `null` -> no `--branch`; bare `b` -> `b`; `refs/remotes/origin/b` -> `b`; `refs/heads/b` -> `skipped {why:'local-ref'}`.
  - Cache-Control (§6.6): `private, max-age=31536000, immutable` only for a committed pin of class `raster`; `no-store` for everything else, every non-200 included.
  - `DOCS_FAILURE_HTTP` (§2 (i), §3.7): 400 bad-project, bad-ref, bad-commit, bad-section, bad-path, bad-fingerprint, bad-query; 403 foreign-request; 404 unknown-project, no-default-branch, unresolved-ref, unknown-commit, absent-path, remote-branch-absent; 409 worktree-gone, ambiguous-worktree, worktree-moved, draft-changed, ref-locked; 413 too-large, too-many-entries; 422 not-a-git-repo, linked-worktree, shared-repo, partial-clone, ref-not-commit, not-a-commit, not-a-file, symlink-in-path, untrusted-worktree, remote-absent, raster-mismatch; 429 fetch-too-soon; 500 response-type-refused; 501 unsupported, not-granted; 502 repo-unreadable, object-missing, unreadable-path, fetch-auth-failed, fetch-rejected-objects, fetch-transport, fetch-failed, git-failed, helper-failed, ccd-killed, ccd-fault, answer-overflow, malformed-answer, unknown-failure; 503 helper-unavailable, caps-unknown, link-failed, docs-busy; 504 git-timeout, fetch-timeout, ccd-timeout, link-timeout. 58 keys, exhaustive by type.
  - Check 9's log line is exactly `console.warn('ccrc-server: docs answer over its declared bound')`.
- Never spelled in `server/src` (W1's pins and the new ones read the four TS roots): the quoted `'docs-v1'` anywhere but `ccdargv.ts` (`capsupported.test.ts`'s `literalSpellings`); the quoted `'x-ccrc-docs'` (read `DOCS_REQUEST_HEADER`/`DOCS_REQUEST_HEADER_VALUE`); any redactor fragment, grammar body or the PNG magic (import from `shared/docs.ts`); the quoted `'refs/heads/'` or `'refs/remotes/origin/'` under `server/src/docs` (derive both from `DOCS_QUALIFIED_PREFIX_RE_BODY`); `'absent'` and `'unreadable'` adjacent in a union (the `one absent/unreadable read vocabulary` pin); the standalone docs server's name (M7.9). W2 adds no failure word: `docs-shared.test.ts`'s `SPEC_WORDS` is frozen. W2 redeclares no W1 name (every L0 type, value and function has a one-home pin).
- `'worktree-gone'` and the archive door's pin. `DOCS_FAILURE_HTTP` must quote it as a key, which reds the archive door's refusal-code pin. Task 2 makes ONE line-count-neutral in-place edit of that pin's `want` line (find it with `grep -n "const want = AUDIT_WORDS.has(code)" server/test/single-definition.test.ts`) so that its `worktree-gone` arm reads `['server/src/docs/policy.ts', 'shared/api.ts', 'shared/docs.ts']`, and confirms in a scratch copy that a fourth home still reds. That is the only non-EOF edit of `single-definition.test.ts` in W2.
- `single-definition.test.ts` is append-only at EOF: `session-hook.test.ts`'s citation census cites it by line, and origin/main already inserts 13 lines mid-file. Locate the end with `tail -n 6`; never insert above it; reuse its module-scope `ALL`, `rel`, `sources`, `ccrcRoot`, `path`, `readFileSync`, `readdirSync`, `existsSync`; add no import at its top.
- Locate every edit by content. Line numbers in this plan are hints measured at `049ddcc28`. If a Find block is absent or not unique, stop and report (an ask to the coordinator), never guess.
- Test hygiene: `( cd <server|agent> && ./node_modules/.bin/vitest run test/<file> )`, in the FOREGROUND, Bash timeout 600000 ms; split anything longer with `-t`; never background, never bare `npx vitest`. Run `git fetch -q origin main` before `deviation-refs`. Known load flakes (`typecheck-tests` among them) are re-run in isolation before being called broken. Quoted pass counts are indicative; what binds is that each case this plan adds is red before its code and green after, and every pre-existing case in a touched file stays as green as it was at the base (W1's G3).
- Mutation-table discipline (W1's G8, binding): every guard a task adds — a refusal, a gate arm, a classification arm, a bound, a pin — ships with a case that goes red when the guard is deleted or mutated, measured in the scratch copy. Each task lists its rows (`W2-T<n>-M<k>`: file, old, new, expected red); Task 9 runs the whole table. Where no fixture can reach a branch, record `D-TBD-<slug>` and say so; do not add tests for anything else.
- Fixtures carry placeholders only: `demo`, `a`, `b`, `main`, `ws/a`, `example-org/example-repo`, `https://u:tok@example.invalid`, 40/64-hex strings built by `'a'.repeat(40)`. No real host, project, user, pool or account name (`topology-clean`).
- Deviations. Four of the refinements below depart from the binding spec's TEXT rather than fill a silence, so each is a deviation with an allocator-issued number: (c) the gate in two adapter functions, where §2 (a) says "inside the one adapter function"; (d) one failure arm per operation (the whole `DocsFailureBody`) and `index` keyed by `DocsNodeId`, where §1 says each operation has its own failure union and is keyed by `DocsSourceId`; (f) `ccd-fault` without `code`, where §2 (b) check 5 names `ccd-fault {code, stderrHead}`; (g) an edit of `server/src/lifecycle.ts`, outside §7.7's W2 row. The coordinator mints a block of at least four numbers at dispatch (`POST /api/ledger/deviations`) and names it in the brief. The WORKER defines the block's first four, in that order, in Task 6 Step 6: a `## Deviations found` section appended at the end of this plan, each entry carrying its refinement's text as the rationale. The rest of the block serves a departure found while executing, reported to the coordinator and defined only with an issued number; a session that cannot reach the allocator writes `D-TBD-<slug>` and reports, and that placeholder never lands (`dtbd.test.ts` reds it). A `D-N` is never typed in advance: this plan's text spells no number it defines.
- Commits: one per task, files staged by name, message `<area>: <what> (docs W2)`, ending with the `Co-Authored-By:` trailer the dispatch names (the model that wrote the commit; default `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`). Commits go on the workspace branch, never a separate feature branch (a feature branch wedges the close with `stale-tip`). No task pushes or opens a PR.
- Inherited from W1's ledger, carried, not fixed: SEC-3 (an externally killed helper orphans git's process group; W2's lever is Task 5's pinned invariant, so the agent never kills ccd in normal operation; the helper-side trap is a ccd change outside W2), MT-2 (ccd cuts stderr before redacting; L3's second pass cannot recover a cut secret; noted in `docs-source.test.ts`'s header), contract F4 (`branch: null` is detached OR unmeasured: carried verbatim), D-4157 (`unwalked` absent when 0: carried, never defaulted), D-4158 (`lockAgeMs` number / null / ABSENT: carried, never defaulted), D-4164 (`too-many-entries` is read by `count`, never by `bytes`), and the partial-clone word pair that W1's CI-fix ruling deferred to W2's adapter (W1 ledger, `progress.md`): a commit missing from a partial clone answers `git-failed {step:'cat-file'}` on git 2.43 and `unknown-commit` on git 2.55 (`show_object_type`'s rc-128 path). Both words are carried verbatim: L3 never maps one known ccd word onto another (refinement (j); check 7 maps only an UNKNOWN word), so treating them as one condition belongs to ccd (one word for one condition, a ccd change outside W2) or to W5's failure sentence. Discovery already refuses a partial clone (`partial-clone`), so only `GIT_NO_LAZY_FETCH`'s backstop path can meet it.

## How this wave runs (coordinator)

- One run row for W2, opened by the programme's coordinator (`ccrc-coordinator` skill) through `POST /api/runs`; W1's run stays open until W2's run exists (closing first retires the programme). Release: none; W2 rides a later rollout (§7.7), and exec grants take effect only when the agent restarts (§7.1).
- Dispatch: one `ccrc-worker` brief (mail, `WORKER_KICKOFF_PREFIX`) carrying WAVE SPECIFICS only: this plan's path, tasks 1-9, the base (W1 merged, or the W1 head named), the issued `D-N` block (at least four numbers: Task 6 defines the first four, for refinements (c), (d), (f) and (g)), and the branch-discipline sentence. Preferred order: dispatch after W1's PR has merged so the workspace branch (cut from main) holds W1. A refused dispatch on the rolling daily cap is retried at the age-out.
- The worker acks, runs the tasks with native subagents (Model routing per task; never Fable), puts questions to the operator as structured asks, lists mail before its wave-done, and after Task 9 reports one measured wave-done fingerprint (`handoffCommit === branchTip`, read fresh from the ref).
- Review: on a verified wave-done the coordinator dispatches one `ccrc-reviewer` run reading the branch at one measured tip in its own worktree. Its brief names the panel's Lenses line from the coordinator skill's `review-panel.md`: (1) rings and imports (L1 pure, L2 type-only, L3 never narrows, no overloaded null); (2) version skew and the gate (§7.1 table, C1, C3); (3) untrusted input — query, body, headers and every ccd answer (checks 1-9, redaction); (4) mutation-table discipline (each guard red when cut); (5) spec conformance (every W2 row and M-case in Task 9's table). Copy the wave-done and the review report into `.superpowers/` on receipt. The coordinator rules; a fix round is a scoped re-review.
- Push, PR and merge are the coordinator's and the operator's acts, after the review rules clean.

## Review Focus

The five inputs a person using this will meet first, each pinned in the task that owns it:

1. **A fleet that is not ready, or is older.** `ccdVerbs` `null`, `[]`, `['x']`, `['caps']`, a list naming the four verbs but not `docs-v1`, and an old agent's `{stderr:'forbidden'}` answer give `caps-unknown`, `caps-unknown`, `caps-unknown`, `unsupported`, `unsupported` and `not-granted`, each with ZERO execs before the gate's verdict (the last after exactly one), on every port operation. Pinned by T6 (row 45, M7.7).
2. **A hand-typed or hostile API query.** A repeated key (`ref=a&ref=b`, arriving as an array), an unknown key (`node`, `size`, `maxBytes`), a mixed or incomplete pin, a bare `servedRef`, a qualified draft `branch`, a `+` in a path, a string or array refresh body, and a `:project` of `-x` or `..` give `bad-query {key, why}` or the right `bad-*` word, in one fixed precedence, before any exec. Pinned by T3 (M3.4, L1 half).
3. **A request the browser did not make on the PWA's behalf.** `Sec-Fetch-Mode: navigate`, `Sec-Fetch-Site: cross-site`/`same-site`/`none`/empty, and a missing or wrong `x-ccrc-docs` marker give `foreign-request` with `why` `navigation`, `site` or `marker`, in that order, even when the marker is present. Pinned by T3.
4. **An answer from the fleet that cannot be trusted.** A tampered `sha256`, a size that does not match the bytes, a non-canonical base64, a committed answer without `onRef`, a blob that differs from the listing's, a truncated stdout (maxBuffer), an answer one byte over `job.wire`, a server-only word sent by ccd, a 2 KiB unknown word, and a secret in `detail`/`stderrHead`/a context string give `malformed-answer {why}`, `answer-overflow` or `unknown-failure {word}` (its word redacted, then cut to 512 bytes), and no secret shape survives into a failure body. Pinned by T6 (checks 1-7) and T7 (checks 8-9, row 62, M6.5).
5. **Stale on open.** A `refs/heads/b` view, `remote: null`, `stamp: null`, an `ok` stamp at 599 999 and 600 000 ms, a transient failure at 59 999 and 60 000 ms, and `refs/remotes/origin/a/b` (fetches `a/b`) give exactly §2 (g)'s answers. Pinned by T2 (M3.9, M3.10).

## File Structure

| File | Task | Responsibility |
|---|---|---|
| `agent/src/whitelist.ts` | T1 | Four `REQUIRED_VERB_FLAG` entries and four grants, appended after `['win-size','--session']`, with one family paragraph above the enrolment and a one-line comment per grant. |
| `agent/test/types/bypasses/g16-docs-index-without-all.ts`, `g17-docs-tree-without-project.ts`, `g18-docs-show-without-project.ts`, `g19-docs-fetch-without-project.ts` | T1 | New bypass fixtures (TS2322 each), in g15's shape. |
| `agent/test/types/ok/legit-whitelist.ts` | T1 | Four `Assert<Equals<(typeof REQUIRED_VERB_FLAG)[...], ...>>` positive controls. |
| `agent/test/whitelist-structural.test.ts` | T1 | Four `EXPECTED` entries; the runtime-audit throw cases. |
| `agent/test/whitelist.test.ts` | T1 | The behavioural `isExecAllowed` case for every exact argv, and the refusals. |
| `server/src/ccdargv.ts` | T1, T6 | T1: five builders and two named flag helpers. T6: `DOCS_CAP`. |
| `server/test/whitelist-subset.test.ts` | T1 | `SAMPLES` and layer-2c `EXPECTED` rows for the five builders; "grantable ONLY with" cases. |
| `server/src/docs/policy.ts` | T2, T3, T4 | The L1 file: T2 status, retry-after, ref target, `fetchBranchFor`, `refreshDue`; T3 parsers and provenance; T4 lane, wire, cache-control, send verdict. |
| `server/test/docs-policy.test.ts` | T2, T3, T4 | The L1 tables and the purity scan; each task appends its own describe. |
| `server/test/single-definition.test.ts` | T2, T8 | T2: the archive door's `want` line, in place. T8: the docs ring guard and the W2 one-home pins, appended at EOF. |
| `server/src/remote/runner.ts` | T5 | Four `CCD_VERB_TIMEOUT_MS` rows. |
| `server/test/remote-runner.test.ts` | T5 | Four `per-verb timeouts` rows. |
| `server/test/docs-budget.test.ts` | T5 | Row 47, M6.3, M7.4's runner-budget clause, read from source text and constants. |
| `server/src/lifecycle.ts` | T6 | `CcdEnding` and `ccdEnding`, the single reader of `killed`/`signal`; `cutShort` re-expressed through it. |
| `server/test/lifecycle.test.ts` | T6 | The `ccdEnding` table and `cutShort`'s equivalence. |
| `server/src/docs/ports.ts` | T6 | The L2 ports and their result types. |
| `server/src/docs/ccdsource.ts` | T6, T7 | T6: factories, the two gated executors, checks 1-7, failure-body rebuild. T7: checks 8-9, show bytes, the second redaction pass. |
| `server/test/docs-source.test.ts` | T6, T7 | The adapter's recording-runner cases and the two real-runner cases. |
| `server/test/capsupported.test.ts`, `server/test/ccd-archive.test.ts`, `server/test/verb-gate.test.ts` | T6 | `DOCS_CAP` spelled once; `toContain(DOCS_CAP)`; the four verbs in `CAP_GATED_VERBS` and `NEW_GENERATION`. |
| `docs/superpowers/plans/2026-10-06-native-docs-reader-w2-grants-and-adapter.md` | T6, T9 | T6: appends `## Deviations found` (the brief's first four issued numbers, for refinements (c), (d), (f), (g)). T9: appends `## Wave 2 results` (suites, invariants, the mutation table's measured reds). |

## Spec refinements (decided while planning)

These refine the spec where it was silent, stale or could be built two ways. Each is applied in the task named; W7's prose pass carries the spec text into line with them. Four of them, (c), (d), (f) and (g), contradict the spec's text rather than fill a silence: they are deviations, which Task 6 defines with issued numbers (Global Constraints, "Deviations"), and the text here is the rationale those entries carry.

- **(a) Bypass fixtures are `g16`-`g19`** (T1). §2 row 44's `g13…g16` predates `g13`-`g15` (ws-reclaim, reclaim-pause, ws-expire), which now exist; `EXPECTED` must equal the on-disk set.
- **(b) Optional flags ride named helpers** `docsRefFlags(ref)` and `docsBranchFlags(branch)`, never an inline ternary inside `argv([...])` (T1). R13: `ccdargv-dec-parity`'s lazy `argv\(\[([\s\S]*?)\]\)` scan would end early on a `])` inside the literal; T1 measures the suite green and records it.
- **(c) The gate lives in two adapter functions**, `readDocs` (index, tree, both shows, through one `switch`) and `fetchDocs`, each carrying §2 (a)'s two lines literally (T6). `verb-gate.test.ts` reads the nearest enclosing function for a literal `capSupported(`, and §2 (g) wall 2 wants `CCD_ARGV.docsFetch(` once, inside the fetch path; a single shared gate helper would read as ungated. Two factories, `ccdDocsReader(deps)` and `ccdDocsFetcher(deps)`, keep wall 1's split down to construction. **A deviation** from §2 (a)'s "inside the one adapter function": Task 6 Step 6 defines it.
- **(d) Port result types** (T6): `DocsIndexRead = {ok: true; answer: DocsIndexOk} | DocsFailureBody`, likewise `DocsTreeRead`, `DocsFetchRun`, and `DocsShowRead = {ok: true; answer: DocsShowOk; bytes: Uint8Array} | DocsFailureBody` (the decoded bytes whose sha256 check 8 verified, for W3's raster path). "Each operation has its own failure union" is realised as one named type per operation whose failure arm is the whole `DocsFailureBody`: ccd's per-verb word set is not a checked contract (check 7 tests membership in the ccd set only), so a narrower static union would claim what the adapter cannot measure. `index` takes `DocsNodeId {node}` (docs-index is project-less); the others take `DocsSourceId {node, project}`. The adapter is bound to one node at construction; W3's node map selects it. **A deviation** from §1's per-operation failure unions keyed by `DocsSourceId`: Task 6 Step 6 defines it.
- **(e) `show`'s server facts arrive as `DocsShowAsk {maxBytes, job, listedBlob}`** (T6): `maxBytes` is `DOCS_CLASS_CAP[contentClass(path)]`, `job` is L1's estimate, `listedBlob` is the listing map's blob for a committed pin, `null` meaning only "the server holds no listing entry". Tree, index and fetch answers are bounded by `LISTING_JOB` (a fetch answer is under 1 KiB; the spec names no fetch job).
- **(f) `ccd-fault` carries `stderrHead` but no `code`** (T6). `CcdResult` (`lifecycle.ts`) carries `ok`, not the exit code, and widening it would change `ccd()`'s output under existing `toEqual` pins; the adapter never invents one (absent means unmeasured, never `1`). `stderrHead` is the first 512 bytes of the REDACTED stderr, cut at a UTF-8 boundary; `link-failed`'s `cause` is the transport message, redacted and cut the same way. **A deviation** from §2 (b) check 5's `ccd-fault {code, stderrHead}`: Task 6 Step 6 defines it.
- **(g) `killed` and `signal` keep one reader** (T6). `lifecycle.ts` gains `ccdEnding(r): {kind:'unmeasured'} | {kind:'deadline'} | {kind:'signal'; signal} | {kind:'exited'}` and `cutShort` is re-expressed through it with identical answers. Check 1 is `ending unmeasured && !ok && stdout === ''` (the transport catch's shape, `{code:1, stdout:''}`), so an ok answer whose halves are unmeasured proceeds to parsing; the half-measured `(killed:false, signal:UNMEASURED)` shape has no producer and reads as check 1. **A deviation**: `lifecycle.ts` is outside §7.7's W2 row, and Task 6 Step 6 defines it.
- **(h) `'forbidden'` and `'timeout'` are module-private literals in `ccdsource.ts`** (T6). The client exports no constant for either; R14 forbids a shared constant across packages. `docs-source.test.ts` EXTRACTS both from source text (`agent/src/server.ts`'s refusal `fail(req.id, 'forbidden')` beside `isExecAllowed`, and `server/src/remote/client.ts`'s `reject(new Error('timeout'))`) and drives the adapter with what it extracted, so a renamed word on either side reds the test.
- **(i) Classification order and its sharpened edges** (T6, T7): checks 1-9 run in §2 (b)'s order and the first match wins. Check 6: stdout is exactly one JSON text followed by exactly one `\n` (no other `\n`), parses to a plain object, `v === 1`, `verb` equals the requested verb, `ok` is a boolean, and an `ok:false` line has a string `failure`; else `malformed-answer {why:'parse'}` (not one line, not JSON) or `{why:'schema'}`. Check 7: an `ok:false` word outside `DOCS_CCD_FAILURES` — a server-only word included — is `unknown-failure {word}`, its `word` redacted and then cut to 512 bytes at a UTF-8 boundary exactly as stderr is (`stderrHeadOf`): the word is ccd's untrusted text, a line may be as long as the 8 MiB exec buffer, and the PWA shows the word (§2 (i)), which names no length, so the bound fills a silence. Check 8 (show ok only) also echoes `source` against the request's mode and requires a draft's `fp === sha256`; base64 must round-trip canonically. Check 9 runs last, on every answer that reached it (an ok answer or a known ccd failure).
- **(j) A ccd failure body is rebuilt by dropping exactly `v`, `verb` and `elapsedMs` and setting `ok:false`**; every other key is carried verbatim, absent stays absent and `null` stays `null` (T6). There is no hand-kept list of context keys.
- **(k) The second redaction pass covers every string leaf of a failure body except `failure`** (T7), recursively through arrays and objects, server-made bodies included. Reconciles §2 (b)'s "every string field" with its closing sentence's three named fields; ok answers are never rewritten.
- **(l) Lane constants live in `policy.ts`** (T4): `DOCS_LANE_EXECS`, `DOCS_LANE_BYTES`, `DOCS_LANE_LARGE_RAW` (the name §6.3's code uses), `DOCS_LANE_QUEUE`, `DOCS_LANE_MAX_WAIT_MS`. They are server-only, so L0 stays untouched. The fetch-lane and cache constants (`DOCS_FETCH_GLOBAL`, `DOCS_CACHE_BYTES`, `DOCS_LISTING_MAP_ENTRIES`, `DOCS_LISTING_PROVENANCE_MS`), the cache and single-flight key builders, `rasterVerdict` and the raster MIME choice are W3's, added to the same file then.
- **(m) "Use of the headers table" is an L1 verdict** (T4): `docsSendPolicy(statusCode, contentType, cacheControl)` answers `pass` with `DOCS_RESPONSE_HEADERS` plus `cache-control: no-store` when the status is not 200 or no cache-control was set, or `refuse` when the content type is not in `DOCS_ALLOWED_CONTENT_TYPES`. W3's `onSend` hook applies it and decides nothing.
- **(n) The API parsers** (T3). `parseDocsApiQuery(route, query)` takes Fastify's default-decoded record (fast-querystring: form-style, `+` is a space, a repeated key is an array); `docsApi` never writes a bare `+`, so only a hand-typed URL meets that. Precedence: an unknown key (the first in code-unit order) > a repeated key (the first in the route's key order) > `pin-shape` > value faults in ccd's argv order (committed: `commit` bad-commit, `servedRef` bad-ref, qualified only, `section`, `path`; draft: `branch` bad-ref, bare only, `head` bad-commit, `section`, `path`, `fp` bad-fingerprint; tree: `ref` bad-ref, bare or qualified). `parseDocsProjectParam` answers `bad-project`. `parseDocsRefreshBody`: not a plain object (string, array, `null`) -> `bad-query {why:'body'}`; an extra key -> `{key, why:'unknown'}`; a missing key, or `reason` not `auto`/`manual`, or `ref` neither `null` nor a string -> `{key, why:'body'}`; a string `ref` outside both grammars -> `bad-ref`.
- **(o) Provenance headers** (T3): a header arriving as an array is read as its `', '`-join (node's own join), so it never equals a single expected value; an empty `sec-fetch-site` is present and not `same-origin`; `site` is carried only on clause 2's refusal, cut to 64 characters.
- **(p) `Retry-After`** (T2): `docsRetryAfterSeconds(body)` answers 5 for `caps-unknown` (§3.7's `Retry-After: 5`), `Math.ceil(retryAfterMs / 1000)` for `docs-busy`, and `null` (no header, one meaning) for every other word; `fetch-too-soon`'s wait rides its body only, as §2 (i) states no header.
- **(q) The two qualified prefixes are derived, not spelled** (T2): `policy.ts` splits `DOCS_QUALIFIED_PREFIX_RE_BODY` into its two alternatives once at module scope, and a test pins the pair. W2 makes no `shared/docs.ts` edit at all.
- **(r) Row 49's scans are W3's** (`CCD_ARGV.docsFetch(` once; the read registration has no fetcher). W2 creates the single call site and wall 1's split; Task 8 adds only the ring guard and the one-home pins.
- **(s) README's gated-verb sentence** (it already omits `ws-expire`) is left to W7's prose pass; README's pins and line ratchet make an unplanned edit costly.

---

### Task 1: Grants and builders: four enrolled agent grants, five CcdArgv builders, the cross-package subset pins

**Model routing:** `sonnet`, effort `high` — transcription of the spec's verb table; the type fixtures and the subset layers are the check.

**Spec rows:** §2 row 44 (grants: fixtures, `EXPECTED`, `Assert<Equals<…>>`, the runtime-audit throw case, the behavioural case, `SAMPLES` and "grantable ONLY with"), and the builder half of §2 (a)'s verb table. `DOCS_CAP` is NOT this task's (Task 6 declares it with its gate); this task spells the cap token only in backticks, never quoted (`capsupported.test.ts`'s `literalSpellings`).

**Files:**
- Create: `agent/test/types/bypasses/g16-docs-index-without-all.ts`, `agent/test/types/bypasses/g17-docs-tree-without-project.ts`, `agent/test/types/bypasses/g18-docs-show-without-project.ts`, `agent/test/types/bypasses/g19-docs-fetch-without-project.ts` (spec refinement (a): `g13`-`g15` are taken).
- Modify: `agent/src/whitelist.ts` — one paragraph in the `REQUIRED_VERB_FLAG` docstring (above `Kept as data rather than a hardcoded`, HEAD :304-306), four enrolment keys (the object, HEAD :310-315), four grants after `['win-size',   '--session'],` (HEAD :555-557).
- Modify: `server/src/ccdargv.ts` — one type import (after HEAD :2), two named flag helpers after `childFlags` (HEAD :159-160), five builders after `winSize` (HEAD :595-597).
- Test: `agent/test/whitelist-structural.test.ts` — four `EXPECTED` entries (before `EXPECTED`'s closing `};`, HEAD :137-142) and one runtime-audit `it` after the ws-expire case (HEAD :349-357).
- Test: `agent/test/types/ok/legit-whitelist.ts` — four positive controls after `WsExpireNeedsExpect` (HEAD :91).
- Test: `agent/test/whitelist.test.ts` — one behavioural `it` after the project-pool case (HEAD :296-308).
- Test: `server/test/whitelist-subset.test.ts` — five `SAMPLES` (after `winSize`, HEAD :105-106), one "grantable ONLY with" `it` after the reclaim-pause case (HEAD :341-349), five layer-2c `EXPECTED` rows (after `winSize`, HEAD :546-547) and one optional-tail `it` after layer 2c's `it.each` (HEAD :549-552).

Every Find block below is quoted from the file at `049ddcc28` and is unique in its file; line numbers are hints. If a Find block is absent or not unique, stop and put an ask to the coordinator.

**Interfaces:**
- Consumes:
  - `shared/docs.ts` (W1): `export type DocSectionSlug = keyof typeof DOC_SECTIONS;` (`'specs' | 'plans' | 'product-design' | 'conventions'`), imported type-only: `import type { DocSectionSlug } from '../../shared/docs.js';`.
  - `agent/src/whitelist.ts` (unchanged machinery): `REQUIRED_VERB_FLAG`, `EXEC_WHITELIST`, `UNGRANTABLE_VERBS`, `type ExecWhitelist`, `type LawfulGrants<W>`, `type IllegalGrant<P>`, `auditExecWhitelist(table?: unknown): void` (throws `… '<verb>' is only grantable with '<flag>' immediately after it …`), `isExecAllowed(cmd: string, args: string[]): boolean` (prefix match).
  - `server/src/ccdargv.ts`: `const argv = (parts: readonly string[]): CcdArgv` (the only mint), `export type CcdArgv = readonly string[] & { readonly [CcdArgvBrand]: true }`.
- Produces:
  - `agent/src/whitelist.ts`: `REQUIRED_VERB_FLAG` gains `'docs-index': '--all', 'docs-tree': '--project', 'docs-show': '--project', 'docs-fetch': '--project'` (so `GatedVerb` gains the four); `EXEC_WHITELIST.ccd` gains `['docs-index', '--all']`, `['docs-tree', '--project']`, `['docs-show', '--project']`, `['docs-fetch', '--project']` (ONE `docs-show` grant serves both modes).
  - `server/src/ccdargv.ts`, module-private: `const docsRefFlags = (ref: string | null): string[]` (`null` -> `[]`, else `['--ref', ref]`); `const docsBranchFlags = (branch: string | null): string[]` (`null` -> `[]`, else `['--branch', branch]`).
  - `server/src/ccdargv.ts`, in `CCD_ARGV` (each returns `CcdArgv`):
    - `docsIndex: () => CcdArgv` — `['docs-index', '--all']`
    - `docsTree: (project: string, ref: string | null) => CcdArgv` — `['docs-tree', '--project', project, ...docsRefFlags(ref)]`
    - `docsShowCommitted: (project: string, commit: string, servedRef: string, section: DocSectionSlug, path: string, maxBytes: number) => CcdArgv` — `['docs-show', '--project', project, '--commit', commit, '--ref', servedRef, '--section', section, '--path', path, '--max-bytes', String(maxBytes)]` (12 tokens after the verb)
    - `docsShowDraft: (project: string, branch: string, head: string, section: DocSectionSlug, path: string, fp: string, maxBytes: number) => CcdArgv` — `['docs-show', '--project', project, '--draft-branch', branch, '--head', head, '--section', section, '--path', path, '--fingerprint', fp, '--max-bytes', String(maxBytes)]` (14)
    - `docsFetch: (project: string, branch: string | null) => CcdArgv` — `['docs-fetch', '--project', project, ...docsBranchFlags(branch)]`

**Measured while planning** (a scratch copy of `049ddcc28` with this task applied; none is a deviation):
1. **R13 is closed.** `ccdargv-dec-parity.test.ts`'s lazy `argv\(\[([\s\S]*?)\]\)` scan stays green (14 passed) with the optional tails in named helpers: no docs literal contains a `])` before its own end, and no docs builder appends `decFlags(`, so the derived dec-verb set is unchanged.
2. **`verb-gate.test.ts`'s four-string probe builds all five.** `VERB_OF` calls every builder with `['x','x','x','x']`: both shows resolve to `docs-show`, `String(undefined)` does not throw, so no `PROBE_ARGS` entry is needed. No docs builder has a call site yet, so the gate scan has nothing new to read (Task 6 adds the sites and `CAP_GATED_VERBS`). Green, 12 passed.
3. **The red is exactly the new cases.** Agent: `7 failed | 130 passed (137)`; the seventh is the pre-existing `the positive control compiles clean`, red because `REQUIRED_VERB_FLAG['docs-index']` does not exist yet (`legit-whitelist.ts(94,7)`, TS2339). Server: `3 failed | 93 passed (96)`; the third is the pre-existing `has a sample for every CCD_ARGV entry` (`SAMPLES` names five keys `CCD_ARGV` lacks).
4. **A half edit of `whitelist.ts` is not a red case, it is a crash.** Narrowing a grant (`['docs-show']`) or giving it the wrong flag (`['docs-fetch','--all']`) throws at module load (`ccrc-agent: EXEC_WHITELIST['ccd'] grants 'docs-show', but 'docs-show' is only grantable with '--project' immediately after it. … Refusing to start.`) and is TS2322 on the proof line (`src/whitelist.ts(597,7): … is not assignable to type 'never'`), so every importer reds with `no tests`. That is why Step 4 adds the enrolment and the grants in ONE edit, and why the runtime-audit case runs over constructed tables.
5. **Two environment-only reds, not this task's.** In a tree whose `pwa/node_modules` is a symlink, `typecheck-tests`' `PWA_TSC really is pwa's own installed compiler` reds alone (W1 Task 2 Step 6 says the same; Step 0's `npm ci` installs real modules). In a checkout with no `origin/main`, `topology-clean`'s `resolved a base to measure against` reds alone; `CCRC_HISTORY_BASE=<base sha>` measured it 55/55 green.
6. **Mutations**, each measured red in a separate scratch copy (`git archive HEAD | tar -x -C <copy>`, then `git -C <copy> init -q`), restored after each; the JSON block at the end of this task carries them for Task 9.

| id | file | old | new | red |
|---|---|---|---|---|
| W2-T1-M1 | `agent/src/whitelist.ts` | the enrolment line | without `'docs-tree': '--project', ` | structural `3 failed`: g17, the positive control, the docs audit case |
| W2-T1-M2 | `agent/src/whitelist.ts` | `    ['docs-show',  '--project'],` | `    ['docs-show'],` | module-load throw: structural and whitelist `Test Files 2 failed`, `no tests`; tsc TS2322 at the proof line |
| W2-T1-M3 | `agent/src/whitelist.ts` | `    ['docs-fetch', '--project'],` | `    ['docs-fetch', '--all'],` | module-load throw `only grantable with '--project'`: `Test Files 2 failed`, `no tests` |
| W2-T1-M4 | `agent/src/whitelist.ts` | `    ['docs-index', '--all'],` | deleted | whitelist-subset `2 failed`: layer 2 `docsIndex`, the ONLY-with case |
| W2-T1-M5 | `server/src/ccdargv.ts` | `'--ref', servedRef,` before `'--section', section,` | the two pairs swapped | whitelist-subset `1 failed`: `docsShowCommitted builds the exact argv` |
| W2-T1-M6 | `server/src/ccdargv.ts` | `docsRefFlags`' body | `['--ref', ref ?? '']` | whitelist-subset `2 failed`: `docsTree builds the exact argv`, the optional-tail case |
| W2-T1-M7 | `server/src/ccdargv.ts` | `docsBranchFlags`' non-null arm | `[]` | whitelist-subset `1 failed`: the optional-tail case |
| W2-T1-M8 | `agent/src/whitelist.ts` | the enrolment line | without `'docs-index': '--all', ` | structural `3 failed`: g16, the positive control, the docs audit case |
| W2-T1-M9 | `agent/src/whitelist.ts` | `    ['docs-index', '--all'],` | deleted | whitelist `1 failed`: the docs behavioural case |

- [ ] **Step 0: Check the base and install (once per wave).** From the worktree root:

```bash
grep -q 'export const DOCS_FAILURES' shared/docs.ts && grep -q '^  echo docs-v1$' ccd/ccd && test ! -e server/src/docs && echo BASE-OK
git rev-parse HEAD
( cd server && npm ci ) && ( cd agent && npm ci ) && ( cd pwa && npm ci )
```

Expected: `BASE-OK`, then the base sha (record it in the SDD ledger), then three clean installs (`typecheck-tests` compiles all three packages, and needs a real `pwa/node_modules`). If `BASE-OK` does not print, stop and put an ask to the coordinator; never merge, rebase or pull inside a task.

Run: `( cd agent && ./node_modules/.bin/vitest run test/whitelist-structural.test.ts test/whitelist.test.ts test/whitelist-noghosts.test.ts test/whitelist-prototype.test.ts )`
Expected: `4 passed (4)`, `131 passed (131)` (measured at `049ddcc28`).

Run: `( cd server && ./node_modules/.bin/vitest run test/whitelist-subset.test.ts )`
Expected: `94 passed (94)`.

- [ ] **Step 1: Write the failing agent tests.**

(a) Create the four bypass fixtures, in g15's shape (header, one type import, the table written `as const satisfies ExecWhitelist`, the `proven` line). Each must fail with TS2322 at its `proven` line once the verb is enrolled.

Create `agent/test/types/bypasses/g16-docs-index-without-all.ts`:

```ts
// BYPASS FIXTURE — MUST NOT COMPILE.
//
// NATIVE DOCS READER, wave 2: `['docs-index', '--all']` -> `['docs-index']`,
// i.e. the fleet-wide docs listing granted without the flag that is its whole
// argument surface — g14's shape for the first of the four docs verbs.
//
// `isExecAllowed` is PREFIX-matching, so `['docs-index']` admits the argv
// `CCD_ARGV.docsIndex` builds exactly as the two-token grant does, and
// `server/test/whitelist-subset.test.ts`'s reachability layer stays green on
// the narrowed grant. What refuses is the ENROLMENT in `REQUIRED_VERB_FLAG`:
// it makes this edit a TS2322 on the proof line below and a boot refusal at
// module load. The verb is read-only and takes no confirmation token, so the
// flag is all the grant can name; a bare `docs-index` would admit every
// positional form the verb might grow, reached from a session-gated route
// that carries no box token.
import type { ExecWhitelist, LawfulGrants } from '../../../src/whitelist.js';

const table = {
  tmux: [['has-session']],
  ccd: [['start'], ['docs-index']],
} as const satisfies ExecWhitelist;

export const proven: LawfulGrants<typeof table> = table;
```

Create `agent/test/types/bypasses/g17-docs-tree-without-project.ts`:

```ts
// BYPASS FIXTURE — MUST NOT COMPILE.
//
// NATIVE DOCS READER, wave 2: `['docs-tree', '--project']` -> `['docs-tree']`,
// i.e. the per-project docs listing granted without the flag that is its
// whole argument surface — g16's shape one verb over.
//
// `isExecAllowed` is PREFIX-matching, so `['docs-tree']` admits both argv
// `CCD_ARGV.docsTree` builds (with and without `--ref`) exactly as the
// two-token grant does, and `server/test/whitelist-subset.test.ts`'s
// reachability layer stays green on the narrowed grant. What refuses is the
// ENROLMENT in `REQUIRED_VERB_FLAG`: it makes this edit a TS2322 on the proof
// line below and a boot refusal at module load. A bare `docs-tree` would
// admit every positional form the verb might grow.
import type { ExecWhitelist, LawfulGrants } from '../../../src/whitelist.js';

const table = {
  tmux: [['has-session']],
  ccd: [['start'], ['docs-tree']],
} as const satisfies ExecWhitelist;

export const proven: LawfulGrants<typeof table> = table;
```

Create `agent/test/types/bypasses/g18-docs-show-without-project.ts`:

```ts
// BYPASS FIXTURE — MUST NOT COMPILE.
//
// NATIVE DOCS READER, wave 2: `['docs-show', '--project']` -> `['docs-show']`,
// i.e. the one grant both `docs-show` argv shapes ride (committed, 12 tokens
// after the verb; draft, 14) narrowed to the bare verb — g16's shape for the
// verb that returns file bytes.
//
// `isExecAllowed` is PREFIX-matching, so `['docs-show']` admits the argv
// `CCD_ARGV.docsShowCommitted` and `CCD_ARGV.docsShowDraft` build exactly as
// the two-token grant does, and `server/test/whitelist-subset.test.ts`'s
// reachability layer stays green on the narrowed grant. What refuses is the
// ENROLMENT in `REQUIRED_VERB_FLAG`: it makes this edit a TS2322 on the proof
// line below and a boot refusal at module load. A bare `docs-show` would
// admit every positional form the verb might grow.
import type { ExecWhitelist, LawfulGrants } from '../../../src/whitelist.js';

const table = {
  tmux: [['has-session']],
  ccd: [['start'], ['docs-show']],
} as const satisfies ExecWhitelist;

export const proven: LawfulGrants<typeof table> = table;
```

Create `agent/test/types/bypasses/g19-docs-fetch-without-project.ts`:

```ts
// BYPASS FIXTURE — MUST NOT COMPILE.
//
// NATIVE DOCS READER, wave 2: `['docs-fetch', '--project']` -> `['docs-fetch']`,
// i.e. the one docs verb that writes anything (one remote-tracking ref and
// ccd's own fetch stamp) granted without the flag that is its whole argument
// surface — g16's shape for the fetch.
//
// `isExecAllowed` is PREFIX-matching, so `['docs-fetch']` admits both argv
// `CCD_ARGV.docsFetch` builds (with and without `--branch`) exactly as the
// two-token grant does, and `server/test/whitelist-subset.test.ts`'s
// reachability layer stays green on the narrowed grant. What refuses is the
// ENROLMENT in `REQUIRED_VERB_FLAG`: it makes this edit a TS2322 on the proof
// line below and a boot refusal at module load. A bare `docs-fetch` would
// admit every positional form the verb might grow.
import type { ExecWhitelist, LawfulGrants } from '../../../src/whitelist.js';

const table = {
  tmux: [['has-session']],
  ccd: [['start'], ['docs-fetch']],
} as const satisfies ExecWhitelist;

export const proven: LawfulGrants<typeof table> = table;
```

(b) Four `EXPECTED` entries. The exhaustiveness case (`has an expectation for every fixture on disk, and a fixture for every expectation`) needs the keys to equal the on-disk set exactly.

Find (in `agent/test/whitelist-structural.test.ts`, HEAD :137-141):

```ts
  'g15-ws-expire-without-expect.ts': {
    what: 'the archived-workspace expiry verb granted without its confirmation token',
    codes: ['TS2322'],
  },
};
```

Replace with:

```ts
  'g15-ws-expire-without-expect.ts': {
    what: 'the archived-workspace expiry verb granted without its confirmation token',
    codes: ['TS2322'],
  },
  // NATIVE DOCS READER wave 2, g14's shape for the four docs verbs: read-only, no confirmation token, so the flag is
  // each verb's whole argument surface, and the enrolment is what makes the narrowed grant a compile error.
  'g16-docs-index-without-all.ts': {
    what: 'the fleet-wide docs listing granted without --all, its whole argument surface',
    codes: ['TS2322'],
  },
  'g17-docs-tree-without-project.ts': {
    what: 'the docs tree verb granted without --project',
    codes: ['TS2322'],
  },
  'g18-docs-show-without-project.ts': {
    what: 'the docs show verb (one grant, both argv shapes) granted without --project',
    codes: ['TS2322'],
  },
  'g19-docs-fetch-without-project.ts': {
    what: 'the docs fetch verb granted without --project',
    codes: ['TS2322'],
  },
};
```

(c) One runtime-audit case inside `describe('mechanism 3, values — …')`, directly after the ws-expire case. It uses that describe's own `withCcd` helper.

Find (in `agent/test/whitelist-structural.test.ts`, HEAD :354-357):

```ts
    expect(() => auditExecWhitelist(withCcd([['ws-expire', '--expect']]))).not.toThrow();
  });

  it('throws on a ws-reclaim with no confirmation token, the second destructive verb', () => {
```

Replace with:

```ts
    expect(() => auditExecWhitelist(withCcd([['ws-expire', '--expect']]))).not.toThrow();
  });

  // NATIVE DOCS READER wave 2: the four docs verbs, enrolled for their ARGUMENT SURFACE (`coord-pause`'s reason).
  // Run over CONSTRUCTED tables, so narrowing a shipped docs grant reds here as an assertion naming the verb's own
  // rule, not only as the module-load crash every importer of `whitelist.ts` takes. The flag must be the token
  // IMMEDIATELY after the verb, so a misplaced `--project` is refused like a missing one.
  it('throws on a docs verb with no flag, the wrong flag, or the flag out of place (docs W2)', () => {
    const REFUSED: readonly (readonly [prefix: readonly string[], flag: string])[] = [
      [['docs-index'], '--all'],
      [['docs-index', '--project'], '--all'],
      [['docs-tree'], '--project'],
      [['docs-show', '--all'], '--project'],
      [['docs-fetch'], '--project'],
      [['docs-show', '--ref', '--project'], '--project'],
    ];
    for (const [prefix, flag] of REFUSED) {
      expect(() => auditExecWhitelist(withCcd([prefix])), prefix.join(' '))
        .toThrow(new RegExp(`only grantable with '${flag}'`));
    }
    const LAWFUL: readonly (readonly string[])[] = [
      ['docs-index', '--all'], ['docs-tree', '--project'], ['docs-show', '--project'], ['docs-fetch', '--project'],
    ];
    for (const prefix of LAWFUL) {
      expect(() => auditExecWhitelist(withCcd([prefix])), prefix.join(' ')).not.toThrow();
    }
  });

  it('throws on a ws-reclaim with no confirmation token, the second destructive verb', () => {
```

(d) Four positive controls in the ok project, after `WsExpireNeedsExpect`. `Assert` and `Equals` are the file's own local helpers; `REQUIRED_VERB_FLAG` is already imported.

Find (in `agent/test/types/ok/legit-whitelist.ts`, HEAD :91):

```ts
export type WsExpireNeedsExpect = Assert<Equals<(typeof REQUIRED_VERB_FLAG)['ws-expire'], '--expect'>>;
```

Replace with:

```ts
export type WsExpireNeedsExpect = Assert<Equals<(typeof REQUIRED_VERB_FLAG)['ws-expire'], '--expect'>>;
/** The four docs verbs (native Docs reader, wave 2): read-only, enrolled on the flag that is each one's whole
 *  argument surface; losing an enrolment stops this project compiling. `g16`-`g19` are the other side. */
export type DocsIndexNeedsAll = Assert<Equals<(typeof REQUIRED_VERB_FLAG)['docs-index'], '--all'>>;
export type DocsTreeNeedsProject = Assert<Equals<(typeof REQUIRED_VERB_FLAG)['docs-tree'], '--project'>>;
export type DocsShowNeedsProject = Assert<Equals<(typeof REQUIRED_VERB_FLAG)['docs-show'], '--project'>>;
export type DocsFetchNeedsProject = Assert<Equals<(typeof REQUIRED_VERB_FLAG)['docs-fetch'], '--project'>>;
```

(e) One behavioural case in `describe('whitelist.isExecAllowed')`, after the project-pool case: true for the seven exact argvs of the spec's verb table, false for each bare verb, a positional, a misplaced flag, the wrong flag and a misspelled verb.

Find (in `agent/test/whitelist.test.ts`, HEAD :305-308):

```ts
    expect(isExecAllowed('ccd', ['project-pool', '--pool', 'pool-a'])).toBe(false);
  });

  it('is still a whitelist — plausible adjacent subcommands stay refused', () => {
```

Replace with:

```ts
    expect(isExecAllowed('ccd', ['project-pool', '--pool', 'pool-a'])).toBe(false);
  });

  // NATIVE DOCS READER wave 2 (spec 2026-10-01 section 2 (a), the verb table): every exact argv the server's
  // builders emit crosses its grant, and nothing bare, positional, misplaced or misspelled does. The grant stops
  // at the flag; arity is ccd's, and the server's layer-2c table in `whitelist-subset.test.ts` pins it.
  it('grants the four docs verbs ONLY with their flag, and admits every argv the spec table names', () => {
    const sha = 'a'.repeat(40);
    expect(isExecAllowed('ccd', ['docs-index', '--all'])).toBe(true);
    expect(isExecAllowed('ccd', ['docs-tree', '--project', 'demo'])).toBe(true);
    expect(isExecAllowed('ccd', ['docs-tree', '--project', 'demo', '--ref', 'ws/a'])).toBe(true);
    expect(isExecAllowed('ccd', ['docs-show', '--project', 'demo', '--commit', sha, '--ref', 'refs/remotes/origin/main',
      '--section', 'specs', '--path', 'a.md', '--max-bytes', '2097152'])).toBe(true);
    expect(isExecAllowed('ccd', ['docs-show', '--project', 'demo', '--draft-branch', 'main', '--head', sha,
      '--section', 'plans', '--path', 'b.md', '--fingerprint', 'c'.repeat(64), '--max-bytes', '2097152'])).toBe(true);
    expect(isExecAllowed('ccd', ['docs-fetch', '--project', 'demo'])).toBe(true);
    expect(isExecAllowed('ccd', ['docs-fetch', '--project', 'demo', '--branch', 'ws/a'])).toBe(true);
    for (const verb of ['docs-index', 'docs-tree', 'docs-show', 'docs-fetch']) {
      expect(isExecAllowed('ccd', [verb]), verb).toBe(false);
    }
    expect(isExecAllowed('ccd', ['docs-tree', 'demo'])).toBe(false);
    expect(isExecAllowed('ccd', ['docs-tree', '--ref', 'r', '--project', 'demo'])).toBe(false);
    expect(isExecAllowed('ccd', ['docs-index', '--project', 'demo'])).toBe(false);
    expect(isExecAllowed('ccd', ['docs-showx', '--project', 'demo'])).toBe(false);
  });

  it('is still a whitelist — plausible adjacent subcommands stay refused', () => {
```

- [ ] **Step 2: Write the failing server tests** in `server/test/whitelist-subset.test.ts`. `SAMPLES` and layer 2c's `EXPECTED` are typed `Record<keyof typeof CCD_ARGV, …>`, so until Step 4 lands the five keys are excess properties under `typecheck-tests` too; vitest strips types, so the runtime reds below are what Step 3 measures.

(a) Five `SAMPLES`:

Find (in `server/test/whitelist-subset.test.ts`, HEAD :105-106):

```ts
  winSize: ['demo-quiet-basin', 'smallest'],
};
```

Replace with:

```ts
  winSize: ['demo-quiet-basin', 'smallest'],
  // NATIVE DOCS READER wave 2. Read-only verbs, one grant each; the two
  // `docs-show` builders share `['docs-show','--project']`. The `null` tails
  // are the samples, so layer 2c pins the shortest argv of `docsTree` and
  // `docsFetch`; their non-null tails are pinned by the case after it.
  docsIndex: [],
  docsTree: ['demo', null],
  docsShowCommitted: ['demo', 'a'.repeat(40), 'refs/remotes/origin/main', 'specs', 'a.md', 2097152],
  docsShowDraft: ['demo', 'main', 'b'.repeat(40), 'plans', 'b.md', 'c'.repeat(64), 2097152],
  docsFetch: ['demo', null],
};
```

(b) The "grantable ONLY with" case, after the reclaim-pause case (cross-package, reading the object):

Find (in `server/test/whitelist-subset.test.ts`, HEAD :348-349):

```ts
    expect(isExecAllowed('ccd', [...CCD_ARGV.reclaimPause('off')])).toBe(true);
  });
```

Replace with:

```ts
    expect(isExecAllowed('ccd', [...CCD_ARGV.reclaimPause('off')])).toBe(true);
  });

  // NATIVE DOCS READER wave 2 (spec 2026-10-01 section 2 (a), row 44). Four
  // read-only verbs, each enrolled for its ARGUMENT SURFACE (`coord-pause`'s
  // reason) and reached from session-gated routes that carry no box token. A
  // bare grant is green in layer 2 and in layer 3's reachability check,
  // because the bare verb is a genuine prefix of every argv the builders make,
  // so it is refused here, cross-PACKAGE and object-reading, for the reasons
  // the ws-reap assertion above states. ONE `docs-show` grant serves both of
  // its builders; a second grant would be dead weight layer 3 cannot see.
  it('docs verbs are grantable ONLY with their flag, one grant each, and both docs-show builders cross it', () => {
    const GRANTS: readonly (readonly [verb: string, flag: string])[] = [
      ['docs-index', '--all'], ['docs-tree', '--project'], ['docs-show', '--project'], ['docs-fetch', '--project'],
    ];
    for (const [verb, flag] of GRANTS) {
      expect(EXEC_WHITELIST.ccd.filter((p) => p[0] === verb), `exactly one ${verb} grant, on ${flag}`)
        .toEqual([[verb, flag]]);
      expect(isExecAllowed('ccd', [verb]), `bare ${verb}`).toBe(false);
      expect(isExecAllowed('ccd', [verb, 'demo']), `${verb} with a positional`).toBe(false);
    }
    expect(isExecAllowed('ccd', ['docs-index', '--project', 'demo'])).toBe(false);
    expect(isExecAllowed('ccd', ['docs-tree', '--all'])).toBe(false);
    expect(isExecAllowed('ccd', ['docs-show', '--all'])).toBe(false);
    expect(isExecAllowed('ccd', ['docs-fetch', '--all'])).toBe(false);
    expect(isExecAllowed('ccd', [...CCD_ARGV.docsIndex()])).toBe(true);
    expect(isExecAllowed('ccd', [...CCD_ARGV.docsTree('demo', null)])).toBe(true);
    expect(isExecAllowed('ccd', [...CCD_ARGV.docsTree('demo', 'ws/a')])).toBe(true);
    expect(isExecAllowed('ccd', [...CCD_ARGV.docsShowCommitted('demo', 'a'.repeat(40), 'refs/remotes/origin/main',
      'specs', 'a.md', 2097152)])).toBe(true);
    expect(isExecAllowed('ccd', [...CCD_ARGV.docsShowDraft('demo', 'main', 'b'.repeat(40), 'plans', 'b.md',
      'c'.repeat(64), 2097152)])).toBe(true);
    expect(isExecAllowed('ccd', [...CCD_ARGV.docsFetch('demo', null)])).toBe(true);
    expect(isExecAllowed('ccd', [...CCD_ARGV.docsFetch('demo', 'ws/a')])).toBe(true);
  });
```

(c) Five layer-2c rows, token for token:

Find (in `server/test/whitelist-subset.test.ts`, HEAD :546-547):

```ts
    winSize: ['win-size', '--session', 'demo-quiet-basin', '--mode', 'smallest'],
  };
```

Replace with:

```ts
    winSize: ['win-size', '--session', 'demo-quiet-basin', '--mode', 'smallest'],
    // NATIVE DOCS READER wave 2: spec 2026-10-01 section 2 (a)'s verb table, token for token. The verb, then
    // `--project` (or `--all`), then every flag pair in ccd's argv order; `--max-bytes` is the class cap,
    // stringified. Committed show is 12 tokens after the verb, draft show 14.
    docsIndex: ['docs-index', '--all'],
    docsTree: ['docs-tree', '--project', 'demo'],
    docsShowCommitted: ['docs-show', '--project', 'demo', '--commit', 'a'.repeat(40), '--ref', 'refs/remotes/origin/main',
                        '--section', 'specs', '--path', 'a.md', '--max-bytes', '2097152'],
    docsShowDraft: ['docs-show', '--project', 'demo', '--draft-branch', 'main', '--head', 'b'.repeat(40),
                    '--section', 'plans', '--path', 'b.md', '--fingerprint', 'c'.repeat(64), '--max-bytes', '2097152'],
    docsFetch: ['docs-fetch', '--project', 'demo'],
  };
```

(d) The optional-tail case, after layer 2c's `it.each` (the samples carry `null` tails, so the exact-argv row sees only the short form):

Find (in `server/test/whitelist-subset.test.ts`, HEAD :551-552):

```ts
    expect(build(...(SAMPLES[key] as unknown[]))).toEqual(EXPECTED[key]);
  });
```

Replace with:

```ts
    expect(build(...(SAMPLES[key] as unknown[]))).toEqual(EXPECTED[key]);
  });

  // NATIVE DOCS READER wave 2. The samples above carry `null` tails, so the
  // row above sees only the shortest argv of `docsTree` and `docsFetch`. This
  // pins both arms of both builders: a non-null value adds exactly its one
  // flag pair AFTER the project, and `null` adds nothing at all (never an
  // empty `--ref ''`, which ccd would refuse as `bad-ref`).
  it('docsTree and docsFetch add their optional flag pair only for a non-null value, after the project', () => {
    expect(CCD_ARGV.docsTree('demo', null)).toEqual(['docs-tree', '--project', 'demo']);
    expect(CCD_ARGV.docsTree('demo', 'ws/a')).toEqual(['docs-tree', '--project', 'demo', '--ref', 'ws/a']);
    expect(CCD_ARGV.docsTree('demo', 'refs/remotes/origin/main'))
      .toEqual(['docs-tree', '--project', 'demo', '--ref', 'refs/remotes/origin/main']);
    expect(CCD_ARGV.docsFetch('demo', null)).toEqual(['docs-fetch', '--project', 'demo']);
    expect(CCD_ARGV.docsFetch('demo', 'ws/a')).toEqual(['docs-fetch', '--project', 'demo', '--branch', 'ws/a']);
  });
```

- [ ] **Step 3: Run them to verify they fail.** Foreground, Bash timeout 600000 ms.

Run: `( cd agent && ./node_modules/.bin/vitest run test/whitelist-structural.test.ts test/whitelist.test.ts test/whitelist-noghosts.test.ts test/whitelist-prototype.test.ts )`
Expected: `Test Files  2 failed | 2 passed (4)`, `Tests  7 failed | 130 passed (137)`. The seven: `g16-docs-index-without-all.ts` … `g19-docs-fetch-without-project.ts` (`expected TS2322 from:` — tsc compiles them clean while the verbs are unenrolled), `the positive control compiles clean` (`expected 'test/types/ok/legit-whitelist.ts(94,7…' to be ''`), `throws on a docs verb with no flag, the wrong flag, or the flag out of place (docs W2)` (`docs-index: expected [Function] to throw an error`) and `grants the four docs verbs ONLY with their flag, …` (`expected false to be true`).

Run: `( cd server && ./node_modules/.bin/vitest run test/whitelist-subset.test.ts )`
Expected: `Tests  3 failed | 93 passed (96)`: `has a sample for every CCD_ARGV entry` (`expected [ 'coordPause', 'docsFetch', …(38) ] to deeply equal [ 'coordPause', 'enable', …(33) ]`), `docs verbs are grantable ONLY with their flag, …` (`exactly one docs-index grant, on --all: expected [] to deeply equal [ [ 'docs-index', '--all' ] ]`) and `docsTree and docsFetch add their optional flag pair …` (`TypeError: CCD_ARGV.docsTree is not a function`).

- [ ] **Step 4: Implement.**

(a) `agent/src/whitelist.ts`, the family paragraph in `REQUIRED_VERB_FLAG`'s docstring, above its closing "Kept as data" paragraph:

Find (in `agent/src/whitelist.ts`, HEAD :304-306):

```ts
 * of any kind.
 *
 * Kept as data rather than a hardcoded `if` so the type below and the runtime
```

Replace with:

```ts
 * of any kind.
 *
 * The four docs verbs (native Docs reader, spec 2026-10-01 section 2 (a)) are
 * the next family, enrolled for `coord-pause`'s reason rather than
 * `ws-reap`'s. `docs-index`, `docs-tree` and `docs-show` read and write
 * nothing; `docs-fetch` writes one remote-tracking ref and ccd's own fetch
 * stamp. None takes a confirmation token, so the flag — `--all` for the
 * index, `--project` for the other three — is each verb's whole argument
 * surface. They are reached from session-gated routes (three GETs and one
 * POST) that carry no box token of any kind, and a bare grant would admit
 * every positional form a verb might grow while staying green in
 * `whitelist-subset.test.ts`'s layers 2 and 3, because the bare verb is a
 * genuine prefix of every argv the server builds. `g16`-`g19` are the other
 * side.
 *
 * Kept as data rather than a hardcoded `if` so the type below and the runtime
```

(b) `agent/src/whitelist.ts`, the four enrolment keys AND the four grants in this same step: an enrolment without its grant, or a grant without its enrolment, is a module-load throw that reds every importer (Measured 4). The enrolment:

Find (in `agent/src/whitelist.ts`, HEAD :314-315):

```ts
  'reclaim-pause': '--state', 'ws-expire': '--expect',
} as const;
```

Replace with:

```ts
  'reclaim-pause': '--state', 'ws-expire': '--expect',
  'docs-index': '--all', 'docs-tree': '--project', 'docs-show': '--project', 'docs-fetch': '--project',
} as const;
```

The grants, appended after `win-size`'s (prefix order does not matter to `isExecAllowed` or to layer 3):

Find (in `agent/src/whitelist.ts`, HEAD :555-557):

```ts
    ['win-size',   '--session'],
  ],
} as const satisfies ExecWhitelist;
```

Replace with:

```ts
    ['win-size',   '--session'],
    // NATIVE DOCS READER (spec 2026-10-01 section 2 (a), docs W2): the four
    // verbs `docs-v1` names, each ENROLLED in `REQUIRED_VERB_FLAG` above on the
    // flag that is its whole argument surface (g16-g19 are the other side).
    // Every token after the flag is unconstrained here; the exact argv is
    // ccd's (a usage die on any other shape) and the server's layer-2c table.
    // The fleet-wide listing: `--all` is its only argument.
    ['docs-index', '--all'],
    // One project's listing, at the origin default or at `--ref R`.
    ['docs-tree',  '--project'],
    // One file's bytes. ONE grant reaches BOTH argv shapes: committed (12
    // tokens after the verb) and draft (14).
    ['docs-show',  '--project'],
    // The one docs verb that writes: a fetch of one branch from origin.
    ['docs-fetch', '--project'],
  ],
} as const satisfies ExecWhitelist;
```

(c) `server/src/ccdargv.ts`, the type import (type-only, so the file's ring is unchanged and `shared/docs.ts` is consumed, never amended):

Find (in `server/src/ccdargv.ts`, HEAD :2):

```ts
import { ROUTE_WRITABLE_FIELDS, type RouteFields, type StopSurface } from '../../shared/api.js';
```

Replace with:

```ts
import { ROUTE_WRITABLE_FIELDS, type RouteFields, type StopSurface } from '../../shared/api.js';
import type { DocSectionSlug } from '../../shared/docs.js';
```

(d) `server/src/ccdargv.ts`, the two named helpers beside `routeFlags`/`childFlags` (spec refinement (b); never an inline ternary inside `argv([...])`):

Find (in `server/src/ccdargv.ts`, HEAD :159-160):

```ts
const childFlags = (child: number | null): string[] =>
  child === null ? [] : ['--child', String(child)];
```

Replace with:

```ts
const childFlags = (child: number | null): string[] =>
  child === null ? [] : ['--child', String(child)];

/**
 * The `--ref <R>` pair for `docs-tree` (native Docs reader, spec 2026-10-01
 * section 2 (a)), or nothing. `null` means exactly one thing: the request named
 * no ref, so ccd serves the origin default branch. A named helper and not an
 * inline ternary for `childFlags`' measured reason: `ccdargv-dec-parity.test.ts`
 * walks each `argv([...])` literal in the table below to its first `])`.
 */
const docsRefFlags = (ref: string | null): string[] => (ref === null ? [] : ['--ref', ref]);

/**
 * The `--branch <B>` pair for `docs-fetch`, or nothing. `null` means exactly
 * one thing: fetch the origin default branch (ccd resolves it and answers
 * `defaultVia`). Named for `docsRefFlags`' reason.
 */
const docsBranchFlags = (branch: string | null): string[] => (branch === null ? [] : ['--branch', branch]);
```

(e) `server/src/ccdargv.ts`, the five builders, appended after `winSize`:

Find (in `server/src/ccdargv.ts`, HEAD :595-597):

```ts
  winSize: (id: string, mode: 'smallest' | 'canonical') =>
             argv(['win-size', '--session', id, '--mode', mode]),
} as const;
```

Replace with:

```ts
  winSize: (id: string, mode: 'smallest' | 'canonical') =>
             argv(['win-size', '--session', id, '--mode', mode]),

  /** NATIVE DOCS READER (spec 2026-10-01 section 2 (a), docs W2): one builder per
   *  argv shape of the four read verbs `docs-v1` names. The verb comes first and
   *  the flag the agent grants second (`--all` here, `--project` for the other
   *  four builders); `docs-show`'s two builders ride ONE grant,
   *  `['docs-show','--project']`. Every value reaches ccd UNVALIDATED by these
   *  builders: the server's L1 parsers refuse a bad value with a 400 before any
   *  exec, and ccd re-checks every token against the same grammars, so this
   *  table holds no third copy of them. The one type-level closure is
   *  `section: DocSectionSlug`. No builder takes `--blob` or `--worktree`, and
   *  none emits `--`.
   *
   *  `docsIndex` is project-less: `--all` is its whole argument surface. */
  docsIndex: () => argv(['docs-index', '--all']),

  /** One project's listing. `ref` is the request's ref in either grammar, bare
   *  or qualified, or `null` for the origin default branch, which adds no
   *  `--ref` at all (`docsRefFlags`). */
  docsTree: (project: string, ref: string | null) =>
              argv(['docs-tree', '--project', project, ...docsRefFlags(ref)]),

  /** A committed file, 12 tokens after the verb. `commit` is the pin the tree
   *  answer served; `servedRef` is that answer's `ref.served`, qualified, which
   *  ccd uses only for the `onRef` provenance check and never to choose bytes.
   *  `maxBytes` is `DOCS_CLASS_CAP[contentClass(path)]`, the class cap the
   *  server chose, stringified; ccd enforces `min(N, DOCS_MAX_FILE_BYTES)`. */
  docsShowCommitted: (project: string, commit: string, servedRef: string, section: DocSectionSlug, path: string,
                      maxBytes: number) =>
                       argv(['docs-show', '--project', project, '--commit', commit, '--ref', servedRef,
                             '--section', section, '--path', path, '--max-bytes', String(maxBytes)]),

  /** A draft file, 14 tokens after the verb: the worktree holding `branch`
   *  (bare) at `head`, read only while its bytes still hash to `fp`. ccd
   *  resolves the worktree itself; `maxBytes` as for `docsShowCommitted`. */
  docsShowDraft: (project: string, branch: string, head: string, section: DocSectionSlug, path: string, fp: string,
                  maxBytes: number) =>
                   argv(['docs-show', '--project', project, '--draft-branch', branch, '--head', head,
                         '--section', section, '--path', path, '--fingerprint', fp, '--max-bytes', String(maxBytes)]),

  /** The one docs verb that writes: a fetch of `branch` (bare) from origin, or
   *  of the origin default branch for `null`, which adds no `--branch` at all
   *  (`docsBranchFlags`). */
  docsFetch: (project: string, branch: string | null) =>
               argv(['docs-fetch', '--project', project, ...docsBranchFlags(branch)]),
} as const;
```

- [ ] **Step 5: Run them to verify they pass.** Foreground, Bash timeout 600000 ms.

Run: `( cd agent && ./node_modules/.bin/vitest run test/whitelist-structural.test.ts test/whitelist.test.ts test/whitelist-noghosts.test.ts test/whitelist-prototype.test.ts )`
Expected: `4 passed (4)`, `137 passed (137)` (structural 63, whitelist 26, noghosts 38, prototype 10).

Run: `( cd agent && ./node_modules/.bin/vitest run )`
Expected: `25 passed (25)`, `471 passed (471)`.

Run: `( cd server && ./node_modules/.bin/vitest run test/whitelist-subset.test.ts test/verb-gate.test.ts test/ccdargv-dec-parity.test.ts test/ccdargv-brand.test.ts )`
Expected: `4 passed (4)`, `145 passed (145)`: whitelist-subset 106 (94 + the two new cases + five layer-2 rows + five layer-2c rows), verb-gate 12, ccdargv-dec-parity 14 (R13, Measured 1), ccdargv-brand 13.

- [ ] **Step 6: The guard suites.** Foreground, Bash timeout 600000 ms each; `typecheck-tests` measured about 185 s and is a known load flake, so a red there is re-run alone before it is called broken.

Run: `( cd server && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts )`
Expected: `12 passed (12)`. It compiles `agent/test` (the new behavioural and audit cases) and `server/test` (`SAMPLES`/`EXPECTED` against `keyof typeof CCD_ARGV`, which is now exhaustive again). With a symlinked `pwa/node_modules` only `PWA_TSC really is pwa's own installed compiler` reds (Measured 5).

Run: `( cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts test/topology-clean.test.ts test/capsupported.test.ts test/readme-holds.test.ts test/unattended-actor.test.ts test/caps-token-shape.test.ts )`
Expected: all green (measured: single-definition 399, topology-clean 55, capsupported 21, readme-holds 17, unattended-actor 24, caps-token-shape 5). `topology-clean` needs `origin/main` (Measured 5); `capsupported` stays green because this task quotes no cap token.

No `ccd/ccd` edit, so no restamp.

- [ ] **Step 7: Commit.**

```bash
git add agent/src/whitelist.ts server/src/ccdargv.ts \
  agent/test/types/bypasses/g16-docs-index-without-all.ts agent/test/types/bypasses/g17-docs-tree-without-project.ts \
  agent/test/types/bypasses/g18-docs-show-without-project.ts agent/test/types/bypasses/g19-docs-fetch-without-project.ts \
  agent/test/types/ok/legit-whitelist.ts agent/test/whitelist-structural.test.ts agent/test/whitelist.test.ts \
  server/test/whitelist-subset.test.ts
git commit -m "agent+server: docs grants and CcdArgv builders (docs W2)" \
  -m "Four docs verbs enrolled in REQUIRED_VERB_FLAG and granted on their flag (g16-g19 are the other side); five CcdArgv builders with the optional tails in named helpers. R13: ccdargv-dec-parity is green with docsRefFlags/docsBranchFlags, and no docs argv literal contains a '])' before its own end." \
  -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

**Mutation rows this task contributes** (each measured red in a scratch copy, never in the worktree; `pkg` is the package the `tests` run in):

```json
[
 {
  "id": "W2-T1-M1",
  "pkg": "agent",
  "file": "agent/src/whitelist.ts",
  "old": "  'docs-index': '--all', 'docs-tree': '--project', 'docs-show': '--project', 'docs-fetch': '--project',",
  "new": "  'docs-index': '--all', 'docs-show': '--project', 'docs-fetch': '--project',",
  "tests": [
   "test/whitelist-structural.test.ts"
  ],
  "red": "agent whitelist-structural: Tests 3 failed | 60 passed (63) — g17-docs-tree-without-project.ts, the positive control compiles clean, throws on a docs verb with no flag, the wrong flag, or the flag out of place (docs W2)"
 },
 {
  "id": "W2-T1-M2",
  "pkg": "agent",
  "file": "agent/src/whitelist.ts",
  "old": "    ['docs-show',  '--project'],",
  "new": "    ['docs-show'],",
  "tests": [
   "test/whitelist-structural.test.ts",
   "test/whitelist.test.ts"
  ],
  "red": "agent whitelist-structural + whitelist: Test Files 2 failed (2), Tests no tests — module-load throw \"EXEC_WHITELIST['ccd'] grants 'docs-show', but 'docs-show' is only grantable with '--project' immediately after it\"; agent tsc: src/whitelist.ts(597,7) TS2322 (not assignable to type 'never')"
 },
 {
  "id": "W2-T1-M3",
  "pkg": "agent",
  "file": "agent/src/whitelist.ts",
  "old": "    ['docs-fetch', '--project'],",
  "new": "    ['docs-fetch', '--all'],",
  "tests": [
   "test/whitelist-structural.test.ts",
   "test/whitelist.test.ts"
  ],
  "red": "agent whitelist-structural + whitelist: Test Files 2 failed (2), Tests no tests — module-load throw \"grants 'docs-fetch --all', but 'docs-fetch' is only grantable with '--project'\"; agent tsc TS2322 at the proof line"
 },
 {
  "id": "W2-T1-M4",
  "pkg": "server",
  "file": "agent/src/whitelist.ts",
  "old": "    ['docs-index', '--all'],\n",
  "new": "",
  "tests": [
   "test/whitelist-subset.test.ts"
  ],
  "red": "server whitelist-subset: Tests 2 failed | 104 passed (106) — docsIndex (layer 2), docs verbs are grantable ONLY with their flag, one grant each, and both docs-show builders cross it"
 },
 {
  "id": "W2-T1-M5",
  "pkg": "server",
  "file": "server/src/ccdargv.ts",
  "old": "'--commit', commit, '--ref', servedRef,\n                             '--section', section,",
  "new": "'--commit', commit, '--section', section,\n                             '--ref', servedRef,",
  "tests": [
   "test/whitelist-subset.test.ts"
  ],
  "red": "server whitelist-subset: Tests 1 failed | 105 passed (106) — docsShowCommitted builds the exact argv, token for token"
 },
 {
  "id": "W2-T1-M6",
  "pkg": "server",
  "file": "server/src/ccdargv.ts",
  "old": "const docsRefFlags = (ref: string | null): string[] => (ref === null ? [] : ['--ref', ref]);",
  "new": "const docsRefFlags = (ref: string | null): string[] => ['--ref', ref ?? ''];",
  "tests": [
   "test/whitelist-subset.test.ts"
  ],
  "red": "server whitelist-subset: Tests 2 failed | 104 passed (106) — docsTree builds the exact argv, token for token; docsTree and docsFetch add their optional flag pair only for a non-null value, after the project"
 },
 {
  "id": "W2-T1-M7",
  "pkg": "server",
  "file": "server/src/ccdargv.ts",
  "old": "const docsBranchFlags = (branch: string | null): string[] => (branch === null ? [] : ['--branch', branch]);",
  "new": "const docsBranchFlags = (branch: string | null): string[] => (branch === null ? [] : []);",
  "tests": [
   "test/whitelist-subset.test.ts"
  ],
  "red": "server whitelist-subset: Tests 1 failed | 105 passed (106) — docsTree and docsFetch add their optional flag pair only for a non-null value, after the project"
 },
 {
  "id": "W2-T1-M8",
  "pkg": "agent",
  "file": "agent/src/whitelist.ts",
  "old": "  'docs-index': '--all', 'docs-tree': '--project',",
  "new": "  'docs-tree': '--project',",
  "tests": [
   "test/whitelist-structural.test.ts"
  ],
  "red": "agent whitelist-structural: Tests 3 failed | 60 passed (63) — g16-docs-index-without-all.ts, the positive control compiles clean, the docs audit case"
 },
 {
  "id": "W2-T1-M9",
  "pkg": "agent",
  "file": "agent/src/whitelist.ts",
  "old": "    ['docs-index', '--all'],\n",
  "new": "",
  "tests": [
   "test/whitelist.test.ts"
  ],
  "red": "agent whitelist: Tests 1 failed | 25 passed (26) — grants the four docs verbs ONLY with their flag, and admits every argv the spec table names"
 }
]
```

---

---

### Task 2: L1 policy, part 1: DOCS_FAILURE_HTTP, Retry-After, ref target, fetchBranchFor and refreshDue

**Model routing:** `sonnet`, effort `high` — the status table is hand-transcribed from the spec in the test, never derived from the code; the tests and the compiles are the check.

**Spec rows:** §2 row 53's L1 half (`DOCS_FAILURE_HTTP` exhaustive by type and by a hand table; the `refreshDue` table), M3.9 (`fetchBranchFor`), M3.10 (`refreshDue` exists only on an ok tree, is `false` for `refs/heads/...`, and keeps §2 (g)'s stale and floor rules), spec refinements (p) (`Retry-After`) and (q) (the two qualified prefixes derived from L0), and this file's half of M7.10 (the L1 purity scan; Task 8 adds the cross-file ring guard).

**Files:**
- Create: `server/src/docs/policy.ts` (the L1 file; Tasks 3 and 4 append to it).
- Create: `server/test/docs-policy.test.ts` (Tasks 3 and 4 append their own describes).
- Modify: `server/test/single-definition.test.ts` — ONE line, in place, line-count neutral: the archive door pin's `want` line (HEAD :4175; find it with `grep -n "const want = AUDIT_WORDS.has(code)" server/test/single-definition.test.ts`, exactly one hit). This is W2's only non-EOF edit of that file (Global Constraints).
- Test: `server/test/docs-policy.test.ts`, `server/test/single-definition.test.ts`.

The Find block below is quoted from the file at `049ddcc28` (Task 1 does not touch this file) and is unique in it; the line number is a hint. If it is absent or not unique, stop and put an ask to the coordinator.

**Interfaces:**
- Consumes, from `shared/docs.ts` (W1; imported, never amended): `DOCS_FAILURES` (58 words) and `type DocsFailure = keyof typeof DOCS_FAILURES`; `type DocsFailureBody = { ok: false; failure: DocsFailure; detail?: string; retryAfterMs?: number } & DocsFailureContext` (carries `lane?: 'read' | 'fetch'` and `lockAgeMs?: number | null`); `interface DocsTreeOk` (reads `ref.requested: string | null` and `freshness: { remote: 'origin' | null; stamp: null | { okAgeMs: number | null; attemptAgeMs: number; lastOutcome: 'ok' | DocsFetchFailure; okCommit: string | null } }`); `type DocsFetchFailure` (the seven stampable fetch words, test only); `type DocsRefSpec = { kind: 'bare'; name: string } | { kind: 'qualified'; ref: string }`; `DOCS_QUALIFIED_PREFIX_RE_BODY` (`'(?:refs/heads/|refs/remotes/origin/)'`); `DOCS_STALE_MS` (600000); `DOCS_RETRY_FLOOR_MS` (60000).
- Produces, all in `server/src/docs/policy.ts`:
  - `export const DOCS_FAILURE_HTTP: Record<DocsFailure, number>` — 58 keys in `DOCS_FAILURES`'s order; the only status source.
  - `export const DOCS_CAPS_UNKNOWN_RETRY_AFTER_S = 5;`
  - `export function docsRetryAfterSeconds(body: DocsFailureBody): number | null` — `caps-unknown` -> 5; `docs-busy` with a number `retryAfterMs` -> `Math.ceil(retryAfterMs / 1000)`; every other case -> `null` (send no header; one meaning).
  - `export const DOCS_REF_PREFIXES: readonly [local: string, origin: string]` — derived from `DOCS_QUALIFIED_PREFIX_RE_BODY` (its `(?:` and `)` stripped, split on `|`); module-private `LOCAL_REF_PREFIX`, `ORIGIN_REF_PREFIX` destructured from it.
  - `export type DocsRefTarget = { side: 'bare' | 'local' | 'origin'; branch: string };`
  - `export function docsRefTarget(ref: DocsRefSpec): DocsRefTarget` — bare -> `{side:'bare', branch: name}`; qualified -> the prefix stripped, `side` by which derived prefix matched; a qualified spec under neither prefix THROWS (`parseDocsRef` never builds one).
  - `export type DocsFetchPlan = { kind: 'fetch'; branch: string | null } | { kind: 'skipped'; why: 'local-ref' };` — `branch: null` is the origin default branch (no `--branch`), one meaning.
  - `export function fetchBranchFor(ref: DocsRefSpec | null): DocsFetchPlan`
  - `export function refreshDue(tree: DocsTreeOk): boolean` — §2 (g)'s pseudocode, line for line.
  - For Tasks 3 and 4: the file's one import statement is the block below; a later task that needs another `shared/docs.ts` name ADDS it to that import (never a second import from the same specifier), and keeps every import specifier `../../../shared/docs.js` (this task's purity scan).

**Measured while planning** (the shared scratch tree with Task 1 applied, then a separate copy for the mutations; none is a deviation):
1. **`DOCS_FAILURE_HTTP` reds the archive door pin, as the Global Constraints foretold.** Its `'worktree-gone': 409,` key is a code-line literal, so the archive door's `'worktree-gone' is a code-line literal in shared/api.ts alone` case counts `server/src/docs/policy.ts` as a third home. Step 2 widens that one `want` arm in place. With the edit and no `policy.ts` the case reds in the OTHER direction (Step 3); with `policy.ts` it is green; with a fourth file spelling the word it reds again (W2-T2-M8), so the widened pin still bounds the word. The case's title still says "alone": renaming it would move no line but would change a name other tooling may quote, so it is left.
2. **No other `single-definition` pin sees the new file.** It declares no W1 name, quotes neither qualified prefix (both are derived), spells no grammar body, and has no `'absent'`/`'unreadable'` pair: `399 passed (399)`, as at the base.
3. **The `@ts-expect-error` in M3.10's type-level case is live.** Widening `refreshDue` to accept a failure body (W2-T2-M14) leaves `docs-policy` green at runtime but makes `tsc -p test/tsconfig.tests.json` report `test/docs-policy.test.ts(242,7): error TS2578: Unused '@ts-expect-error' directive.`, which reds `typecheck-tests`' `server/test/ is clean under a tests-inclusive project`. That is the only red M3.10's "compute it on a failure" mutation can have, so it is a row.
4. **`docsRetryAfterSeconds` needs three `docs-busy` rows.** A mutation answering 5 for every 503 leaves `5000 -> 5` green; `2000 -> 2` and `2001 -> 3` catch it, and `2001 -> 3` alone catches `Math.round` for `Math.ceil` (W2-T2-M7, W2-T2-M11).
5. **Two environment-only reds, not this task's** (Task 1's Measured 5): with a symlinked `pwa/node_modules`, `typecheck-tests`' `PWA_TSC really is pwa's own installed compiler` reds alone (`1 failed | 11 passed (12)` measured so); with no `origin/main`, `topology-clean` needs `CCRC_HISTORY_BASE=<base sha>` (measured green so).
6. **Mutations**, each measured red in a separate copy (`git archive HEAD | tar -x -C <copy>`, then `git -C <copy> init -q`), restored after each; the JSON block at the end of this task carries them for Task 9.

| id | file | red |
|---|---|---|
| W2-T2-M1 | `server/src/docs/policy.ts` | server docs-policy: Tests 2 failed \| 113 passed (115) |
| W2-T2-M2 | `server/src/docs/policy.ts` | server docs-policy: Tests 2 failed \| 113 passed (115) |
| W2-T2-M3 | `server/src/docs/policy.ts` | server docs-policy: Tests 10 failed \| 105 passed (115) |
| W2-T2-M4 | `server/src/docs/policy.ts` | server docs-policy: Tests 10 failed \| 105 passed (115) |
| W2-T2-M5 | `server/src/docs/policy.ts` | server docs-policy: Tests 2 failed \| 113 passed (115) |
| W2-T2-M6 | `server/src/docs/policy.ts` | server docs-policy: Tests 1 failed \| 114 passed (115) |
| W2-T2-M7 | `server/src/docs/policy.ts` | server docs-policy: Tests 4 failed \| 111 passed (115) |
| W2-T2-M8 | `server/src/docs/fourth-home.ts` | server single-definition: Tests 1 failed \| 398 passed (399) |
| W2-T2-M9 | `server/src/docs/policy.ts` | server docs-policy: Tests 2 failed \| 113 passed (115) |
| W2-T2-M10 | `server/src/docs/policy.ts` | server docs-policy: Tests 1 failed \| 114 passed (115) |
| W2-T2-M11 | `server/src/docs/policy.ts` | server docs-policy: Tests 1 failed \| 114 passed (115) |
| W2-T2-M12 | `server/src/docs/policy.ts` | server docs-policy: Tests 1 failed \| 114 passed (115) |
| W2-T2-M13 | `server/src/docs/policy.ts` | server docs-policy: Tests 1 failed \| 114 passed (115) |
| W2-T2-M14 | `server/src/docs/policy.ts` | server typecheck-tests: `server/test/ is clean under a tests-inclusive project` fails (TS2578 at docs-policy.test.ts:242); docs-policy stays green |

- [ ] **Step 1: Write the failing tests.** Create `server/test/docs-policy.test.ts` with exactly this content. The status table is HAND-TRANSCRIBED from §2 (i)'s tables and §3.7, never derived from `policy.ts`; the Argument group's status (400) comes from its heading. Fixtures are placeholders only (`demo`, `main`, `ws/a`, `'a'.repeat(40)`).

```ts
// `server/src/docs/policy.ts`, the native Docs reader's L1 file (design 2026-10-01, section 1's policy row): pure
// decisions that W3's routes and hooks apply and never re-decide. Each task of wave 2 appends its own describes.
//
// Task 2: section 2 row 53's L1 half (`DOCS_FAILURE_HTTP` exhaustive, the `refreshDue` table), M3.9
// (`fetchBranchFor`), M3.10 (`refreshDue` exists only on an ok tree, is false for a local ref, and keeps section
// 2 (g)'s stale and floor rules), the `Retry-After` verdict (spec refinement (p)), the two qualified prefixes
// derived from L0 (refinement (q)), and the file's L1 purity scan (its ring by imports; Task 8's ring guard in
// `single-definition.test.ts` is the cross-file half of M7.10).
//
// The status table below is HAND-TRANSCRIBED from the spec's tables (section 2 (i) and section 3.7), never derived
// from `DOCS_FAILURE_HTTP`: a table read back from the code would agree with any mistake in it.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DOCS_FAILURE_HTTP, DOCS_CAPS_UNKNOWN_RETRY_AFTER_S, DOCS_REF_PREFIXES, docsRetryAfterSeconds, docsRefTarget,
  fetchBranchFor, refreshDue,
} from '../src/docs/policy.js';
import { DOCS_FAILURES } from '../../shared/docs.js';
import type { DocsFailure, DocsFailureBody, DocsFetchFailure, DocsTreeOk } from '../../shared/docs.js';

/** Section 2 (i)'s tables in their order, then section 3.7's four added words. The Argument group's status is its
 *  heading ("Argument (400; ...)"); every other row names its own. 58 rows. */
const SPEC_STATUS: readonly (readonly [word: string, status: number])[] = [
  // Argument (400).
  ['bad-project', 400], ['bad-ref', 400], ['bad-commit', 400], ['bad-section', 400], ['bad-path', 400],
  ['bad-fingerprint', 400],
  // Repository.
  ['unknown-project', 404], ['not-a-git-repo', 422], ['linked-worktree', 422], ['shared-repo', 422],
  ['partial-clone', 422], ['repo-unreadable', 502],
  // Refs.
  ['no-default-branch', 404], ['unresolved-ref', 404], ['ref-not-commit', 422],
  // Objects and paths.
  ['unknown-commit', 404], ['not-a-commit', 422], ['object-missing', 502], ['absent-path', 404], ['not-a-file', 422],
  ['symlink-in-path', 422], ['too-large', 413], ['too-many-entries', 413], ['unreadable-path', 502],
  // Draft pins (show).
  ['worktree-gone', 409], ['ambiguous-worktree', 409], ['untrusted-worktree', 422], ['worktree-moved', 409],
  ['draft-changed', 409],
  // Fetch.
  ['remote-absent', 422], ['remote-branch-absent', 404], ['fetch-auth-failed', 502], ['fetch-rejected-objects', 502],
  ['fetch-transport', 502], ['ref-locked', 409], ['fetch-too-soon', 429], ['fetch-timeout', 504], ['fetch-failed', 502],
  // ccd generic.
  ['git-failed', 502], ['git-timeout', 504], ['helper-unavailable', 503], ['helper-failed', 502],
  // Server-only.
  ['unsupported', 501], ['caps-unknown', 503], ['not-granted', 501], ['link-failed', 503], ['link-timeout', 504],
  ['docs-busy', 503], ['ccd-timeout', 504], ['ccd-killed', 502], ['ccd-fault', 502], ['answer-overflow', 502],
  ['malformed-answer', 502], ['unknown-failure', 502],
  // Section 3.7 (the HTTP layer).
  ['foreign-request', 403], ['bad-query', 400], ['raster-mismatch', 422], ['response-type-refused', 500],
];

describe('DOCS_FAILURE_HTTP (row 53, L1 half): every word has the status the spec gives it', () => {
  const words = SPEC_STATUS.map(([w]) => w);

  it('the transcribed table is whole: 58 distinct words, exactly the vocabulary, in both directions', () => {
    expect(SPEC_STATUS).toHaveLength(58);
    expect(new Set(words).size, 'a word transcribed twice').toBe(58);
    expect([...words].sort()).toEqual(Object.keys(DOCS_FAILURES).sort());
  });

  it('the policy table holds exactly the vocabulary: no word missing, no extra key', () => {
    expect(Object.keys(DOCS_FAILURE_HTTP).sort()).toEqual(Object.keys(DOCS_FAILURES).sort());
  });

  it.each(SPEC_STATUS)("'%s' answers %i", (word, status) => {
    expect(DOCS_FAILURE_HTTP[word as DocsFailure]).toBe(status);
  });

  it('every status is a failure status: success is 200 only, so no 2xx and no 3xx (section 3.7)', () => {
    const FAILURE_STATUSES = [400, 403, 404, 409, 413, 422, 429, 500, 501, 502, 503, 504];
    for (const [word, status] of Object.entries(DOCS_FAILURE_HTTP)) {
      expect(FAILURE_STATUSES, `${word} answers ${status}`).toContain(status);
    }
  });

  it('ref-locked is a 409 of its own, never folded into the 502 of a failed fetch (section 3.7)', () => {
    expect(DOCS_FAILURE_HTTP['ref-locked']).toBe(409);
    expect(DOCS_FAILURE_HTTP['fetch-failed']).toBe(502);
  });
});

describe('docsRetryAfterSeconds: the Retry-After header, or none (spec refinement (p))', () => {
  const body = (failure: DocsFailure, extra: Partial<DocsFailureBody> = {}): DocsFailureBody =>
    ({ ok: false, failure, ...extra });

  it('caps-unknown answers 5 s (section 3.7: 503, Retry-After: 5)', () => {
    expect(DOCS_CAPS_UNKNOWN_RETRY_AFTER_S).toBe(5);
    expect(docsRetryAfterSeconds(body('caps-unknown'))).toBe(5);
  });

  it.each([[2000, 2], [5000, 5], [2001, 3]])('docs-busy with retryAfterMs %i answers %i s, rounded up', (ms, s) => {
    expect(docsRetryAfterSeconds(body('docs-busy', { lane: 'read', retryAfterMs: ms }))).toBe(s);
  });

  it('docs-busy without retryAfterMs answers null: no header, never a guessed wait', () => {
    expect(docsRetryAfterSeconds(body('docs-busy', { lane: 'fetch' }))).toBeNull();
  });

  it("fetch-too-soon's wait rides its body only (section 2 (i) names no header), and ref-locked has none", () => {
    expect(docsRetryAfterSeconds(body('fetch-too-soon', { retryAfterMs: 4000 }))).toBeNull();
    expect(docsRetryAfterSeconds(body('ref-locked', { lockAgeMs: 1000 }))).toBeNull();
  });

  it('every other word answers null even when its body carries a retryAfterMs', () => {
    for (const word of Object.keys(DOCS_FAILURES) as DocsFailure[]) {
      if (word === 'caps-unknown' || word === 'docs-busy') continue;
      expect(docsRetryAfterSeconds(body(word, { retryAfterMs: 2000 })), word).toBeNull();
    }
  });
});

describe('the qualified prefixes are derived from L0, and docsRefTarget reads a ref spec (refinement (q))', () => {
  it('DOCS_REF_PREFIXES is the local prefix, then the origin prefix', () => {
    expect(DOCS_REF_PREFIXES).toEqual(['refs/heads/', 'refs/remotes/origin/']);
  });

  it.each([
    [{ kind: 'bare', name: 'main' }, { side: 'bare', branch: 'main' }],
    [{ kind: 'bare', name: 'ws/a' }, { side: 'bare', branch: 'ws/a' }],
    [{ kind: 'qualified', ref: 'refs/heads/main' }, { side: 'local', branch: 'main' }],
    [{ kind: 'qualified', ref: 'refs/heads/ws/a' }, { side: 'local', branch: 'ws/a' }],
    [{ kind: 'qualified', ref: 'refs/remotes/origin/b' }, { side: 'origin', branch: 'b' }],
    [{ kind: 'qualified', ref: 'refs/remotes/origin/a/b' }, { side: 'origin', branch: 'a/b' }],
  ] as const)('%j targets %j', (spec, target) => {
    expect(docsRefTarget(spec)).toEqual(target);
  });

  it('refuses a qualified spec in neither grammar rather than guessing a side', () => {
    // `parseDocsRef` never builds one; a hand-built spec is a caller's bug, so it throws instead of answering.
    expect(() => docsRefTarget({ kind: 'qualified', ref: 'refs/tags/v1' })).toThrow(/neither qualified prefix/);
  });
});

describe('fetchBranchFor (M3.9): what a refresh fetches for the requested ref (section 3.4, section 2 (g) Flow)', () => {
  it('null (the default view) fetches with no --branch', () => {
    expect(fetchBranchFor(null)).toEqual({ kind: 'fetch', branch: null });
  });

  it.each([
    [{ kind: 'bare', name: 'b' }, 'b'],
    [{ kind: 'bare', name: 'ws/a' }, 'ws/a'],
    [{ kind: 'qualified', ref: 'refs/remotes/origin/b' }, 'b'],
    [{ kind: 'qualified', ref: 'refs/remotes/origin/a/b' }, 'a/b'],
  ] as const)('%j fetches --branch %s', (spec, branch) => {
    expect(fetchBranchFor(spec)).toEqual({ kind: 'fetch', branch });
  });

  it('a local ref is skipped, local-ref: a fetch cannot move it', () => {
    expect(fetchBranchFor({ kind: 'qualified', ref: 'refs/heads/b' })).toEqual({ kind: 'skipped', why: 'local-ref' });
    expect(fetchBranchFor({ kind: 'qualified', ref: 'refs/heads/ws/a' })).toEqual({ kind: 'skipped', why: 'local-ref' });
  });
});

describe('refreshDue (M3.10, row 53 L1 half): section 2 (g) "Stale on open", exactly', () => {
  type Stamp = NonNullable<DocsTreeOk['freshness']['stamp']>;
  const SHA = 'a'.repeat(40);
  /** A minimal ok tree, valid by type, placeholders only: the default view of `demo`, origin present, never fetched. */
  const BASE: DocsTreeOk = {
    v: 1, verb: 'docs-tree', ok: true, elapsedMs: 1, project: 'demo',
    repo: { key: 'b'.repeat(32), objectFormat: 'sha1', shallow: false },
    github: { state: 'none' },
    ref: {
      requested: null, served: 'refs/remotes/origin/main', name: 'main', side: 'origin', commit: SHA,
      via: 'default:origin-head', tried: [], relation: 'equal', counterpart: null,
    },
    mainCheckout: { path: '/srv/demo', branch: 'main', head: SHA },
    sections: [],
    entries: [],
    unlisted: { count: 0, byReason: {} },
    drafts: { state: 'none', branch: 'main', skipped: [] },
    freshness: { remote: 'origin', trackedRef: 'refs/remotes/origin/main', stamp: null, fetchHead: null },
  };
  const treeWith = (o: { requested?: string | null; remote?: 'origin' | null; stamp?: Stamp | null }): DocsTreeOk => ({
    ...BASE,
    ref: { ...BASE.ref, requested: o.requested !== undefined ? o.requested : BASE.ref.requested },
    freshness: {
      ...BASE.freshness,
      remote: o.remote !== undefined ? o.remote : BASE.freshness.remote,
      stamp: o.stamp !== undefined ? o.stamp : BASE.freshness.stamp,
    },
  });
  const stampAt = (lastOutcome: Stamp['lastOutcome'], attemptAgeMs: number): Stamp => ({
    okAgeMs: lastOutcome === 'ok' ? attemptAgeMs : null, attemptAgeMs, lastOutcome,
    okCommit: lastOutcome === 'ok' ? SHA : null,
  });

  /** Every outcome a stamp can record, and the wait the spec gives it. Typed by the vocabulary, so a new
   *  `DocsFetchFailure` does not compile here until it is placed. */
  const WAIT: Record<'ok' | DocsFetchFailure, 'stale' | 'floor'> = {
    'ok': 'stale',
    'remote-branch-absent': 'stale',
    'fetch-timeout': 'floor',
    'fetch-rejected-objects': 'floor',
    'fetch-auth-failed': 'floor',
    'ref-locked': 'floor',
    'fetch-transport': 'floor',
    'fetch-failed': 'floor',
  };
  // The spec's numbers, written out: 600 000 (DOCS_STALE_MS) and 60 000 (DOCS_RETRY_FLOOR_MS).
  const BOUNDARY = { stale: 600000, floor: 60000 } as const;

  it.each([
    ['a local ref with no stamp', false, treeWith({ requested: 'refs/heads/main', stamp: null })],
    ['a local ref with a long-stale stamp', false,
      treeWith({ requested: 'refs/heads/ws/a', stamp: stampAt('ok', 6000000) })],
    ['no origin remote, no stamp', false, treeWith({ remote: null, stamp: null })],
    ['no origin remote, a long-stale stamp', false,
      treeWith({ remote: null, stamp: stampAt('fetch-transport', 6000000) })],
    ['the default view, never fetched', true, treeWith({ requested: null, stamp: null })],
    ['a bare ref, never fetched', true, treeWith({ requested: 'main', stamp: null })],
    ['a bare ref that merely contains the local prefix, never fetched', true,
      treeWith({ requested: 'ws/refs/heads/a', stamp: null })],
    ['an origin ref, never fetched', true, treeWith({ requested: 'refs/remotes/origin/main', stamp: null })],
  ] as const)('%s: due %s', (_what, due, tree) => {
    expect(refreshDue(tree)).toBe(due);
  });

  const BOUNDARY_ROWS = (Object.keys(WAIT) as ('ok' | DocsFetchFailure)[]).flatMap((outcome) => {
    const edge = BOUNDARY[WAIT[outcome]];
    return [[outcome, edge - 1, false], [outcome, edge, true]] as const;
  });

  it.each(BOUNDARY_ROWS)("a last outcome of '%s' attempted %i ms ago is due: %s", (outcome, age, due) => {
    expect(refreshDue(treeWith({ stamp: stampAt(outcome, age) }))).toBe(due);
  });

  it.each([
    ['a bare ref', 'ws/a'],
    ['an origin ref', 'refs/remotes/origin/ws/a'],
  ] as const)('%s keeps the same stale and floor boundaries as the default view', (_what, requested) => {
    expect(refreshDue(treeWith({ requested, stamp: stampAt('ok', 599999) }))).toBe(false);
    expect(refreshDue(treeWith({ requested, stamp: stampAt('ok', 600000) }))).toBe(true);
    expect(refreshDue(treeWith({ requested, stamp: stampAt('fetch-transport', 59999) }))).toBe(false);
    expect(refreshDue(treeWith({ requested, stamp: stampAt('fetch-transport', 60000) }))).toBe(true);
  });

  it('exists only on an ok tree: a failure body is a compile error (checked by typecheck-tests)', () => {
    const failure: DocsFailureBody = { ok: false, failure: 'unresolved-ref' };
    // Never called: the proof is the compile error below, which `typecheck-tests` reds on if it disappears (TS2578).
    const wouldCall = (): boolean =>
      // @ts-expect-error -- refreshDue takes DocsTreeOk only, so an unresolved ref can never be due.
      refreshDue(failure);
    expect(typeof wouldCall).toBe('function');
  });
});

describe('policy.ts is L1: pure, and imports shared/docs.ts alone (M7.10, this file\'s half)', () => {
  const SRC = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'docs', 'policy.ts'), 'utf8');
  /** Comments blanked, positions preserved (`coord-caps-policy.test.ts`'s helper): the file's header names what it
   *  refuses, and prose is not code. */
  const code = (): string => SRC
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, ' '));

  it('the scan is over real code, not an empty string', () => {
    expect(code()).toContain('export const DOCS_FAILURE_HTTP');
    expect(code().replace(/\s/g, '').length).toBeGreaterThan(400);
  });

  it('has no clock and no timer', () => {
    expect(code()).not.toMatch(/\bDate\s*\.\s*now\s*\(|\bnew\s+Date\b|\bperformance\s*\.\s*now/);
    expect(code()).not.toMatch(/\bset(?:Timeout|Interval|Immediate)\b/);
  });

  it('has no node builtin, no require, no dynamic import and no Buffer', () => {
    expect(code()).not.toMatch(/(['"])node:/);
    expect(code()).not.toMatch(/\brequire\s*\(|\bimport\s*\(/);
    expect(code()).not.toMatch(/\bBuffer\b/);
  });

  it('has no fastify, no reply and no console: an L1 verdict neither answers HTTP nor logs', () => {
    expect(code()).not.toMatch(/fastify/i);
    expect(code()).not.toMatch(/\breply\b/);
    expect(code()).not.toMatch(/\bconsole\b/);
  });

  it('every import specifier is ../../../shared/docs.js, and there is at least one', () => {
    const specifiers = [...code().matchAll(/\bfrom\s*(['"])([^'"]+)\1|\bimport\s*(['"])([^'"]+)\3/g)]
      .map((m) => m[2] ?? m[4]);
    expect(specifiers.length, 'no import found: the scan is over nothing').toBeGreaterThan(0);
    for (const s of specifiers) expect(s).toBe('../../../shared/docs.js');
  });
});
```

- [ ] **Step 2: Widen the archive door pin's `worktree-gone` arm, in place.** In `server/test/single-definition.test.ts` (HEAD :4175, inside `describe('the archive door\'s refusal codes are spelled once, in L0 (workspace lifecycle wave 2)'`), replace the one line. Same line, same indentation, no line added or removed (`session-hook.test.ts`'s citation census cites this file by line); the case compares sorted relative paths, so the three entries are in sorted order.

Find:

```ts
    const want = AUDIT_WORDS.has(code) ? ['server/src/wsaudit.ts', 'shared/api.ts'] : code === 'worktree-gone' ? ['shared/api.ts', 'shared/docs.ts'] : ['shared/api.ts'];
```

Replace with:

```ts
    const want = AUDIT_WORDS.has(code) ? ['server/src/wsaudit.ts', 'shared/api.ts'] : code === 'worktree-gone' ? ['server/src/docs/policy.ts', 'shared/api.ts', 'shared/docs.ts'] : ['shared/api.ts'];
```

Confirm the file's length did not change: `wc -l server/test/single-definition.test.ts` prints the same count before and after (4693 at `049ddcc28`).

- [ ] **Step 3: Run them to verify they fail.** Foreground, Bash timeout 600000 ms.

Run: `( cd server && ./node_modules/.bin/vitest run test/docs-policy.test.ts )`
Expected: `Test Files  1 failed (1)`, `Tests  no tests`, with `Error: Cannot find module '../src/docs/policy.js' imported from …/server/test/docs-policy.test.ts`.

Run: `( cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'archive door' )`
Expected: `Tests  1 failed | 8 passed | 390 skipped (399)`: `'worktree-gone' is a code-line literal in shared/api.ts alone` reds in the other direction until `policy.ts` exists — `AssertionError: a second 'worktree-gone': expected [ 'shared/api.ts', 'shared/docs.ts' ] to deeply equal [ 'server/src/docs/policy.ts', …(2) ]`.

- [ ] **Step 4: Write the implementation.** Create `server/src/docs/policy.ts` with exactly this content. One import statement, from `../../../shared/docs.js` only. Never spell either qualified prefix as a string (they are derived from `DOCS_QUALIFIED_PREFIX_RE_BODY`), never put `'absent'` next to `'unreadable'`, and keep the `refreshDue` body the spec's pseudocode line for line.

```ts
// The native Docs reader's L1 policy (design 2026-10-01, section 1's policy row): pure decisions over narrow
// inputs, a typed answer out. W3's routes and hooks APPLY these verdicts and decide nothing themselves; L3
// (`ccdsource.ts`) classifies ccd's answers into the words whose status this file owns.
//
// Ring, checked by imports (M7.10; this file's purity scan is in `docs-policy.test.ts`, the cross-file ring guard in
// `single-definition.test.ts`): every import is from `shared/docs.ts`. No node builtin, no Buffer, no clock, no
// timer, no fastify, no reply, no console. A server log line belongs to the layer that applies a verdict.
//
// Spelled nowhere here, by rule: the two qualified ref prefixes (derived below from L0's prefix body, refinement
// (q)), any grammar body, the redactor's rules, and the docs cap token.
import {
  DOCS_QUALIFIED_PREFIX_RE_BODY, DOCS_RETRY_FLOOR_MS, DOCS_STALE_MS,
  type DocsFailure, type DocsFailureBody, type DocsRefSpec, type DocsTreeOk,
} from '../../../shared/docs.js';

// ===== HTTP status and Retry-After (section 2 (i), section 3.7) =====

/**
 * The HTTP status of every failure word: the ONLY status source (section 3.7). Success is 200 only, so every value
 * here is a 4xx or 5xx. Typed by the vocabulary, so a word added to `DOCS_FAILURES` does not compile until it is
 * placed, and a word not in it is an excess property. Listed in `DOCS_FAILURES`'s order.
 *
 * `ref-locked` is a 409 of its own, never the 502 of a failed fetch: a held lock is a conflict the page retries
 * while it is young (`DOCS_FAILURE_RETRY`'s `auto-while-young`), not a broken fetch.
 */
export const DOCS_FAILURE_HTTP: Record<DocsFailure, number> = {
  // Argument (400; L1 and ccd apply the same grammar).
  'bad-project': 400,
  'bad-ref': 400,
  'bad-commit': 400,
  'bad-section': 400,
  'bad-path': 400,
  'bad-fingerprint': 400,
  // Repository.
  'unknown-project': 404,
  'not-a-git-repo': 422,
  'linked-worktree': 422,
  'shared-repo': 422,
  'partial-clone': 422,
  'repo-unreadable': 502,
  // Refs.
  'no-default-branch': 404,
  'unresolved-ref': 404,
  'ref-not-commit': 422,
  // Objects and paths.
  'unknown-commit': 404,
  'not-a-commit': 422,
  'object-missing': 502,
  'absent-path': 404,
  'not-a-file': 422,
  'symlink-in-path': 422,
  'too-large': 413,
  'too-many-entries': 413,
  'unreadable-path': 502,
  // Draft pins (show).
  'worktree-gone': 409,
  'ambiguous-worktree': 409,
  'untrusted-worktree': 422,
  'worktree-moved': 409,
  'draft-changed': 409,
  // Fetch.
  'remote-absent': 422,
  'remote-branch-absent': 404,
  'fetch-auth-failed': 502,
  'fetch-rejected-objects': 502,
  'fetch-transport': 502,
  'ref-locked': 409,
  'fetch-too-soon': 429,
  'fetch-timeout': 504,
  'fetch-failed': 502,
  // ccd generic.
  'git-failed': 502,
  'git-timeout': 504,
  'helper-unavailable': 503,
  'helper-failed': 502,
  // Server-only.
  'unsupported': 501,
  'caps-unknown': 503,
  'not-granted': 501,
  'link-failed': 503,
  'link-timeout': 504,
  'docs-busy': 503,
  'ccd-timeout': 504,
  'ccd-killed': 502,
  'ccd-fault': 502,
  'answer-overflow': 502,
  'malformed-answer': 502,
  'unknown-failure': 502,
  // Added by section 3.7 (the HTTP layer).
  'foreign-request': 403,
  'bad-query': 400,
  'raster-mismatch': 422,
  'response-type-refused': 500,
};

/** `caps-unknown`'s `Retry-After`, in seconds (section 3.7: 503, `Retry-After: 5`; section 7.1, C1). */
export const DOCS_CAPS_UNKNOWN_RETRY_AFTER_S = 5;

/**
 * The `Retry-After` header a failure body gets, in whole seconds, or `null`: send NO header (one meaning).
 * - `caps-unknown`: `DOCS_CAPS_UNKNOWN_RETRY_AFTER_S`.
 * - `docs-busy`: its body's `retryAfterMs`, rounded UP to a whole second; `null` when the body carries none, so a
 *   wait is never guessed.
 * - every other word: `null`. `fetch-too-soon`'s wait rides its body's `retryAfterMs` only (section 2 (i) names no
 *   header for it), and a `retryAfterMs` on any other word's body changes nothing here.
 */
export function docsRetryAfterSeconds(body: DocsFailureBody): number | null {
  if (body.failure === 'caps-unknown') return DOCS_CAPS_UNKNOWN_RETRY_AFTER_S;
  if (body.failure === 'docs-busy' && typeof body.retryAfterMs === 'number') return Math.ceil(body.retryAfterMs / 1000);
  return null;
}

// ===== The requested ref (refinement (q); section 3.4's refresh flow) =====

/** The two qualified prefixes, local then origin, DERIVED from L0's `DOCS_QUALIFIED_PREFIX_RE_BODY` (a
 *  non-capturing group of two literal alternatives): its `(?:` and `)` stripped, split on `|`. Never spelled here, so
 *  the grammar and this file cannot drift apart. `docs-policy.test.ts` pins the pair. */
export const DOCS_REF_PREFIXES = DOCS_QUALIFIED_PREFIX_RE_BODY
  .slice('(?:'.length, -')'.length)
  .split('|') as unknown as readonly [local: string, origin: string];

const [LOCAL_REF_PREFIX, ORIGIN_REF_PREFIX] = DOCS_REF_PREFIXES;

/** What a ref spec names: the branch, and which side holds it. `bare` is a name ccd resolves itself (origin first,
 *  section 2 (c)); `local` and `origin` come from a qualified ref, its prefix stripped. */
export type DocsRefTarget = { side: 'bare' | 'local' | 'origin'; branch: string };

/**
 * The target of a ref spec. A bare spec is its name; a qualified spec is its branch, read after whichever derived
 * prefix it starts with. A qualified spec under neither prefix is a caller's bug (`parseDocsRef` never builds one),
 * so it throws rather than guessing a side.
 */
export function docsRefTarget(ref: DocsRefSpec): DocsRefTarget {
  if (ref.kind === 'bare') return { side: 'bare', branch: ref.name };
  if (ref.ref.startsWith(LOCAL_REF_PREFIX)) return { side: 'local', branch: ref.ref.slice(LOCAL_REF_PREFIX.length) };
  if (ref.ref.startsWith(ORIGIN_REF_PREFIX)) {
    return { side: 'origin', branch: ref.ref.slice(ORIGIN_REF_PREFIX.length) };
  }
  throw new Error(`docsRefTarget: '${ref.ref}' starts with neither qualified prefix`);
}

/** What a refresh fetches. `branch: null` is the origin default branch (no `--branch`), one meaning; `skipped`
 *  is a local ref, which a fetch cannot move. */
export type DocsFetchPlan = { kind: 'fetch'; branch: string | null } | { kind: 'skipped'; why: 'local-ref' };

/**
 * `fetchBranchFor` (section 2 (g) Flow, section 3.4's table; M3.9):
 * - `null` (the default view): fetch with no `--branch`;
 * - bare `b`: `--branch b`;
 * - `refs/remotes/origin/b`: `--branch b` (everything after the prefix, so `a/b` stays `a/b`);
 * - `refs/heads/b`: skipped, `local-ref`, with no fetch exec at all.
 */
export function fetchBranchFor(ref: DocsRefSpec | null): DocsFetchPlan {
  if (ref === null) return { kind: 'fetch', branch: null };
  const target = docsRefTarget(ref);
  if (target.side === 'local') return { kind: 'skipped', why: 'local-ref' };
  return { kind: 'fetch', branch: target.branch };
}

// ===== Stale on open (section 2 (g); M3.10, row 53's L1 half) =====

/**
 * Whether the PWA should fire one automatic refresh for this tree: section 2 (g)'s pseudocode, line for line.
 * Takes an OK tree only, so an `unresolved-ref` answer can never be due (structural, not a flag). Never due for a
 * `refs/heads/<b>` view (a fetch cannot move a local ref) or a repo with no origin remote; always due when the
 * fleet has no stamp; otherwise due once the last attempt is at least `DOCS_STALE_MS` old after an `ok` or a
 * `remote-branch-absent` outcome, or at least `DOCS_RETRY_FLOOR_MS` old after any other outcome. Ages are on the
 * fleet clock (`attemptAgeMs`), so no clock is read here.
 */
export function refreshDue(tree: DocsTreeOk): boolean {
  const stamp = tree.freshness.stamp;
  return !(tree.ref.requested ?? '').startsWith(LOCAL_REF_PREFIX) &&
    tree.freshness.remote !== null && (
    stamp === null ||
      stamp.attemptAgeMs >= (stamp.lastOutcome === 'ok' || stamp.lastOutcome === 'remote-branch-absent'
        ? DOCS_STALE_MS : DOCS_RETRY_FLOOR_MS));
}
```

- [ ] **Step 5: Run them to verify they pass.** Foreground, Bash timeout 600000 ms.

Run: `( cd server && ./node_modules/.bin/vitest run test/docs-policy.test.ts )`
Expected: `Tests  115 passed (115)` (status 62, Retry-After 7, prefixes and target 8, `fetchBranchFor` 6, `refreshDue` 27, purity 5).

Run: `( cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts )`
Expected: `Tests  399 passed (399)` — the archive door case green with `policy.ts` holding the word (Measured 1), every W1 docs pin green (Measured 2).

Run: `( cd server && ./node_modules/.bin/vitest run test/docs-shared.test.ts )`
Expected: `Tests  239 passed (239)`; `SPEC_WORDS` is frozen and untouched (W2 adds no failure word).

- [ ] **Step 6: The guard suites and the compiles.** Foreground, Bash timeout 600000 ms each; `typecheck-tests` is a known load flake, so a red there is re-run alone before it is called broken.

Run: `( cd server && node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit && node node_modules/typescript/bin/tsc -p test/tsconfig.tests.json --noEmit && echo TSC-OK )`
Expected: `TSC-OK`. The first compiles `policy.ts` under the server's build flags; the second compiles `docs-policy.test.ts`, whose `@ts-expect-error` must be USED (Measured 3).

Run: `( cd server && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts )`
Expected: `Tests  12 passed (12)`. With a symlinked `pwa/node_modules` only `PWA_TSC really is pwa's own installed compiler` reds (Measured 5); Task 1's Step 0 installs real modules.

Run: `( cd server && ./node_modules/.bin/vitest run test/topology-clean.test.ts test/capsupported.test.ts )`
Expected: `Test Files  2 passed (2)`, `Tests  76 passed (76)` (topology-clean 55, capsupported 21). `topology-clean` needs `origin/main` (Measured 5); `capsupported` stays green because this task spells no cap token.

No `ccd/ccd` edit, so no restamp.

- [ ] **Step 7: Commit.**

```bash
git add server/src/docs/policy.ts server/test/docs-policy.test.ts server/test/single-definition.test.ts
git commit -m "server: docs L1 policy, statuses, refreshDue and fetchBranchFor (docs W2)" \
  -m "DOCS_FAILURE_HTTP (58 words, typed by the vocabulary, pinned by a hand-transcribed table), the Retry-After verdict, the two qualified prefixes derived from L0, docsRefTarget, fetchBranchFor (M3.9) and refreshDue (M3.10), with the file's L1 purity scan. The archive door pin's worktree-gone arm names policy.ts as a third home, in place, line-count neutral." \
  -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

**Mutation rows this task contributes** (each measured red in a separate copy, never in the worktree; `pkg` is the package the `tests` run in; W2-T2-M8's `old` is empty because the mutation creates a new file, removed to restore):

```json
[
 {
  "id": "W2-T2-M1",
  "pkg": "server",
  "file": "server/src/docs/policy.ts",
  "old": "  'ref-locked': 409,",
  "new": "  'ref-locked': 502,",
  "tests": [
   "test/docs-policy.test.ts"
  ],
  "red": "server docs-policy: Tests 2 failed | 113 passed (115) — 'ref-locked' answers 409; ref-locked is a 409 of its own, never folded into the 502 of a failed fetch (section 3.7)"
 },
 {
  "id": "W2-T2-M2",
  "pkg": "server",
  "file": "server/src/docs/policy.ts",
  "old": "  return !(tree.ref.requested ?? '').startsWith(LOCAL_REF_PREFIX) &&\n    tree.freshness.remote !== null && (",
  "new": "  return tree.freshness.remote !== null && (",
  "tests": [
   "test/docs-policy.test.ts"
  ],
  "red": "server docs-policy: Tests 2 failed | 113 passed (115) — a local ref with no stamp: due false; a local ref with a long-stale stamp: due false"
 },
 {
  "id": "W2-T2-M3",
  "pkg": "server",
  "file": "server/src/docs/policy.ts",
  "old": "      stamp.attemptAgeMs >= (",
  "new": "      stamp.attemptAgeMs > (",
  "tests": [
   "test/docs-policy.test.ts"
  ],
  "red": "server docs-policy: Tests 10 failed | 105 passed (115) — the eight 'attempted <edge> ms ago is due: true' rows (600000 for ok and remote-branch-absent, 60000 for the six others), and both 'keeps the same stale and floor boundaries' cases"
 },
 {
  "id": "W2-T2-M4",
  "pkg": "server",
  "file": "server/src/docs/policy.ts",
  "old": "        ? DOCS_STALE_MS : DOCS_RETRY_FLOOR_MS));",
  "new": "        ? DOCS_RETRY_FLOOR_MS : DOCS_STALE_MS));",
  "tests": [
   "test/docs-policy.test.ts"
  ],
  "red": "server docs-policy: Tests 10 failed | 105 passed (115) — 'ok' and 'remote-branch-absent' attempted 599999 ms ago is due: false; the six floor words attempted 60000 ms ago is due: true; both 'keeps the same stale and floor boundaries' cases"
 },
 {
  "id": "W2-T2-M5",
  "pkg": "server",
  "file": "server/src/docs/policy.ts",
  "old": "    tree.freshness.remote !== null && (",
  "new": "    (",
  "tests": [
   "test/docs-policy.test.ts"
  ],
  "red": "server docs-policy: Tests 2 failed | 113 passed (115) — no origin remote, no stamp: due false; no origin remote, a long-stale stamp: due false"
 },
 {
  "id": "W2-T2-M6",
  "pkg": "server",
  "file": "server/src/docs/policy.ts",
  "old": "  if (target.side === 'local') return { kind: 'skipped', why: 'local-ref' };\n",
  "new": "",
  "tests": [
   "test/docs-policy.test.ts"
  ],
  "red": "server docs-policy: Tests 1 failed | 114 passed (115) — a local ref is skipped, local-ref: a fetch cannot move it"
 },
 {
  "id": "W2-T2-M7",
  "pkg": "server",
  "file": "server/src/docs/policy.ts",
  "old": "  if (body.failure === 'caps-unknown') return DOCS_CAPS_UNKNOWN_RETRY_AFTER_S;",
  "new": "  if (DOCS_FAILURE_HTTP[body.failure] === 503) return DOCS_CAPS_UNKNOWN_RETRY_AFTER_S;",
  "tests": [
   "test/docs-policy.test.ts"
  ],
  "red": "server docs-policy: Tests 4 failed | 111 passed (115) — docs-busy with retryAfterMs 2000 answers 2 s; 2001 answers 3 s; docs-busy without retryAfterMs answers null; every other word answers null (helper-unavailable and link-failed are 503s). The 5000 -> 5 row stays green by coincidence, which is why the table has three rows."
 },
 {
  "id": "W2-T2-M8",
  "pkg": "server",
  "file": "server/src/docs/fourth-home.ts",
  "old": "",
  "new": "export const FOURTH = 'worktree-gone';\n",
  "tests": [
   "test/single-definition.test.ts"
  ],
  "red": "server single-definition: Tests 1 failed | 398 passed (399) — 'worktree-gone' is a code-line literal in shared/api.ts alone (expected four homes to equal the three the widened want names). old is empty: the mutation CREATES the file; delete it to restore."
 },
 {
  "id": "W2-T2-M9",
  "pkg": "server",
  "file": "server/src/docs/policy.ts",
  "old": "} from '../../../shared/docs.js';\n",
  "new": "} from '../../../shared/docs.js';\nimport { readFileSync } from 'node:fs';\n",
  "tests": [
   "test/docs-policy.test.ts"
  ],
  "red": "server docs-policy: Tests 2 failed | 113 passed (115) — has no node builtin, no require, no dynamic import and no Buffer; every import specifier is ../../../shared/docs.js, and there is at least one"
 },
 {
  "id": "W2-T2-M10",
  "pkg": "server",
  "file": "server/src/docs/policy.ts",
  "old": "  throw new Error(`docsRefTarget: '${ref.ref}' starts with neither qualified prefix`);",
  "new": "  return { side: 'origin', branch: ref.ref };",
  "tests": [
   "test/docs-policy.test.ts"
  ],
  "red": "server docs-policy: Tests 1 failed | 114 passed (115) — refuses a qualified spec in neither grammar rather than guessing a side"
 },
 {
  "id": "W2-T2-M11",
  "pkg": "server",
  "file": "server/src/docs/policy.ts",
  "old": "  if (body.failure === 'docs-busy' && typeof body.retryAfterMs === 'number') return Math.ceil(body.retryAfterMs / 1000);",
  "new": "  if (body.failure === 'docs-busy' && typeof body.retryAfterMs === 'number') return Math.round(body.retryAfterMs / 1000);",
  "tests": [
   "test/docs-policy.test.ts"
  ],
  "red": "server docs-policy: Tests 1 failed | 114 passed (115) — docs-busy with retryAfterMs 2001 answers 3 s, rounded up"
 },
 {
  "id": "W2-T2-M12",
  "pkg": "server",
  "file": "server/src/docs/policy.ts",
  "old": "  const stamp = tree.freshness.stamp;\n",
  "new": "  const stamp = tree.freshness.stamp;\n  void Date.now();\n",
  "tests": [
   "test/docs-policy.test.ts"
  ],
  "red": "server docs-policy: Tests 1 failed | 114 passed (115) — has no clock and no timer"
 },
 {
  "id": "W2-T2-M13",
  "pkg": "server",
  "file": "server/src/docs/policy.ts",
  "old": "  if (target.side === 'local') return { kind: 'skipped', why: 'local-ref' };\n",
  "new": "  if (target.side === 'local') { console.warn('ccrc-server: docs refresh skipped'); return { kind: 'skipped', why: 'local-ref' }; }\n",
  "tests": [
   "test/docs-policy.test.ts"
  ],
  "red": "server docs-policy: Tests 1 failed | 114 passed (115) — has no fastify, no reply and no console: an L1 verdict neither answers HTTP nor logs"
 },
 {
  "id": "W2-T2-M14",
  "pkg": "server",
  "file": "server/src/docs/policy.ts",
  "old": "export function refreshDue(tree: DocsTreeOk): boolean {\n  const stamp = tree.freshness.stamp;\n",
  "new": "export function refreshDue(tree: DocsTreeOk | DocsFailureBody): boolean {\n  if (!tree.ok) return false;\n  const stamp = tree.freshness.stamp;\n",
  "tests": [
   "test/typecheck-tests.test.ts"
  ],
  "red": "server typecheck-tests: 'server/test/ is clean under a tests-inclusive project' fails (measured with -t 'server/test/ is clean': Tests 1 failed | 11 skipped (12)); tsc -p test/tsconfig.tests.json: test/docs-policy.test.ts(242,7): error TS2578: Unused '@ts-expect-error' directive. docs-policy itself stays green: this is M3.10's 'compute it on a failure', caught only at the compile."
 }
]
```

---

---

### Task 3: L1 policy, part 2: API query, :project and refresh-body parsers, and request provenance

**Model routing:** `sonnet`, effort `high` — precedence is the subtle part; the hand-written table in the test is the check, and every expected body in it is written out from the spec, never read back from `policy.ts`.

**Spec rows:** M3.4's L1 half (section 3.4 "Parameter rules": `bad-query {key, why}` for an unknown or a repeated key, `{why:'pin-shape'}` for a mixed or incomplete pin, `servedRef` qualified only, `:project` -> `bad-project`, the refresh body exactly `{ref, reason}` with a string body -> `{why:'body'}`; W3's `docs-routes.test.ts` carries the zero-exec half), section 3.2's `parseDocsApiQuery` paragraph (built from the L0 predicates and key constants; no second grammar), section 3.8's three provenance clauses, and spec refinements (n) and (o). M3.5-M3.7 are W3's route-level rows; this task gives each clause its own L1 mutation row so W3 starts from a pinned verdict.

**Files:**
- Modify: `server/src/docs/policy.ts` — (a) its one import statement (HEAD of Task 2: lines 10-13, the block starting `import {` directly under the header comment), replaced in place with a wider one, same specifier; (b) an append at the end of the file (after `refreshDue`'s closing `}`, line 177 at Task 2's state).
- Modify: `server/test/docs-policy.test.ts` — an append at the end of the file only (after the purity describe's closing `});`, line 285 at Task 2's state). This task's imports go WITH its describes at the end, not into the block at the top: Task 2's W2-T2-M14 row cites `docs-policy.test.ts(242,7)`, so no line above the end may move. ES module imports are hoisted, so placement changes nothing at run time.
- Test: `server/test/docs-policy.test.ts`; guards `server/test/single-definition.test.ts`, `server/test/docs-url.test.ts`, `server/test/docs-shared.test.ts`, `server/test/typecheck-tests.test.ts`, `server/test/topology-clean.test.ts`, `server/test/capsupported.test.ts`.

The Find block below is quoted from `policy.ts` as Task 2 created it and is unique in it; the line numbers are hints. If it is absent or not unique, stop and put an ask to the coordinator.

**Interfaces:**
- Consumes, from `shared/docs.ts` (W1; imported, never amended):
  - `isDocsProject(s: string): boolean`, `isDocsSection(s: string): s is DocSectionSlug`, `isDocsRelPath(s: string): boolean`, `isDocsCommit(s: string): boolean` (40 or 64 lowercase hex), `isDocsFingerprint(s: string): boolean` (64 lowercase hex), `isDocsBareRef(s: string): boolean`, `isDocsQualifiedRef(s: string): boolean`, `parseDocsRef(s: string): DocsRefSpec | null` (null: in neither grammar). Each refuses a non-string at run time; their parameter type is `string`, so `policy.ts` narrows with `typeof` first.
  - `type DocsRefSpec = { kind: 'bare'; name: string } | { kind: 'qualified'; ref: string }`; `type DocSectionSlug`; `type DocPin = { kind: 'committed'; commit: string; servedRef: string; section: DocSectionSlug; path: string } | { kind: 'draft'; branch: string; head: string; section: DocSectionSlug; path: string; fp: string }`.
  - `DOCS_PIN_KEYS = ['commit', 'servedRef', 'branch', 'head', 'fp'] as const`; `DOCS_REQUEST_HEADER = 'x-ccrc-docs'`; `DOCS_REQUEST_HEADER_VALUE = '1'`.
  - `type DocsFailure`, `type DocsFailureBody` (its context carries `key?: string`, `why?: string`, `site?: string`).
  - Test only: `docsApi.file(project: string, pin: DocPin): string`, `docsApi.tree(project: string, ref: DocsRefSpec | null): string`; `import type { IncomingHttpHeaders } from 'node:http'`.
- Consumes, from Task 2 (`policy.ts`): nothing but the import statement this task widens.
- Produces, all in `server/src/docs/policy.ts`:
  - `export type DocsApiRoute = 'projects' | 'tree' | 'file';`
  - `export type DocsApiRequest = { route: 'projects' } | { route: 'tree'; ref: DocsRefSpec | null } | { route: 'file'; pin: DocPin };` — `ref: null` is the default view (no `ref` key), one meaning.
  - `export function parseDocsApiQuery(route: DocsApiRoute, query: Readonly<Record<string, unknown>>): { ok: true; req: DocsApiRequest } | DocsFailureBody`
  - `export function parseDocsProjectParam(project: unknown): { ok: true; project: string } | DocsFailureBody` — `bad-project`.
  - `export type DocsRefreshRequest = { ref: DocsRefSpec | null; reason: 'auto' | 'manual' };`
  - `export function parseDocsRefreshBody(body: unknown): { ok: true; req: DocsRefreshRequest } | DocsFailureBody`
  - `export type DocsHeaderBag = Readonly<Record<string, string | readonly string[] | undefined>>;` — structurally `IncomingHttpHeaders` (pinned by a compile-checked case).
  - `export type DocsProvenance = { ok: true } | { ok: false; why: 'navigation' | 'site' | 'marker'; site?: string };`
  - `export function docsProvenance(headers: DocsHeaderBag): DocsProvenance`
  - Module-private (not exported, so no one-home pin is owed): `PIN_COMMIT`..`PIN_FP` (destructured from `DOCS_PIN_KEYS`), `COMMITTED_PIN_KEYS`, `DRAFT_PIN_KEYS`, `API_KEYS`, `REFRESH_KEYS`, `PROVENANCE_SITE_MAX_CHARS = 64`, and the helpers `badQuery`, `refused`, `isText`, `own`, `firstUnknownKey`, `sameKeys`, `parsePinPlace`, `parseFilePin`, `headerText`.
  - For Task 4: the file's ONE import statement is the Replace block below; a later task that needs another `shared/docs.ts` name ADDS it to that statement (never a second import from the same specifier) and keeps every specifier `../../../shared/docs.js` (Task 2's purity scan).

**Decisions this task makes (refinements (n) and (o) applied; none is a deviation):**
1. **Decoding.** The parser takes Fastify's default-decoded record (fast-querystring 1.1.2, measured in W1's ledger, Task 5: form-style, `%2B` -> `+`, a bare `+` -> space, a repeated key -> an array). It does not re-decode. `docsApi` writes `+` as `%2B`, so its own URLs round-trip; a hand-typed bare `+` names a different path (a space) and is documented by a case, not refused. (W1's ground notes once said "decode strictly"; refinement (n) supersedes that, and W1's ledger records `docsApi`'s output as safe under either decoder.)
2. **Precedence**, one answer per query whatever its key order: an unknown key (the first in code-unit order, `Object.keys(...).sort()`) > a repeated key (the first in the route's key order: file `commit, servedRef, branch, head, fp, section, path`, i.e. `DOCS_PIN_KEYS` then `section`, `path`) > `pin-shape` (the pin keys must be EXACTLY a committed pin's or a draft pin's, and `section` and `path` must both be present) > value faults in ccd's argv order (committed: `commit` bad-commit, `servedRef` bad-ref QUALIFIED only, `section`, `path`; draft: `branch` bad-ref BARE only, `head` bad-commit, `section`, `path`, `fp` bad-fingerprint; tree: `ref` bad-ref, bare or qualified).
3. **Own keys only.** Every value is read through one reader, `own(record, key)` (`Object.hasOwn`), so an inherited name is no key and a null-prototype record parses; a repeated key reaches every check as the array it is.
4. **A grammar refusal carries no context**: `{ok:false, failure:'bad-commit'}` for a bad `commit` and a bad `head` alike (section 2 (i)'s Argument rows name none). `bad-query` carries `key` for `unknown`, `repeated` and a body field, and none for `pin-shape` or a non-object body.
5. **The refresh body.** Not a plain object (string, array, `null`, number, boolean, no body) -> `{why:'body'}`; then an extra key -> `{key, why:'unknown'}` (code-unit order); then `ref` (missing, or neither `null` nor a string) and then `reason` (missing, or not exactly `auto`/`manual`) -> `{key, why:'body'}`; then a string `ref` in neither grammar -> `bad-ref`. A local qualified `ref` is accepted: `fetchBranchFor` skips its fetch, and the follow-up tree still runs.
6. **Provenance.** A header value arriving as an array is read as its `', '`-join (node's own join), so it never equals a single expected value; an empty `sec-fetch-site` is present and not `same-origin`; `site` rides only clause 2's refusal, cut to 64 characters; the marker must equal `DOCS_REQUEST_HEADER_VALUE` exactly (presence is not enough). The header word is read as `headers[DOCS_REQUEST_HEADER]`, never quoted (single-definition's `HEADER_LITERAL` pin).

**Measured while planning** (the shared scratch tree with Tasks 1-2 applied, then a separate copy for the mutations; none is a deviation):
1. **RED is 117 new cases** (`parseDocsApiQuery` 62, `parseDocsProjectParam` 14, `parseDocsRefreshBody` 23, `docsProvenance` 18), each failing with `TypeError: <name> is not a function` (vitest resolves a missing named export to `undefined`; the module still loads, so Task 2's 115 cases stay green). GREEN is `232 passed (232)`.
2. **No `single-definition` pin sees the new code**: the marker word is read through `DOCS_REQUEST_HEADER`, no grammar body or qualified prefix is spelled, no W1 name is redeclared, and no `'absent'`/`'unreadable'` pair appears: `399 passed (399)`, as after Task 2. The test file may quote anything (`ROOTS` excludes `server/test`), but it too reads the constants.
3. **Two checks are left out because no reachable input can red them** (G8: a guard without a red is a comment). A prototype test on the refresh body (Fastify's JSON parser yields only plain objects and arrays, and the `Array.isArray` arm already refuses the arrays), and an `Object.hasOwn(record, 'ref')` test before reading `ref`, which a first draft carried: an absent `ref` reads as `undefined` through `own`, and the `null`-or-string check already refuses that as `{key:'ref', why:'body'}`. Deleting that draft's test left every case green, so it was removed; W2-T3-M19 pins the behaviour it seemed to own (an absent `ref` is never the default view).
4. **Environment-only reds, not this task's** (Task 1's Measured 5, Task 2's Measured 5): with a symlinked `pwa/node_modules`, `typecheck-tests`' `PWA_TSC really is pwa's own installed compiler` reds alone (`1 failed | 11 passed (12)` measured so; `server/test/ is clean under a tests-inclusive project` is green); with no `origin/main`, `topology-clean` needs `CCRC_HISTORY_BASE=<base sha>` (measured green so).
5. **Mutations**, each measured red in a separate copy (`git archive HEAD | tar -x -C <copy>`, then `git -C <copy> init -q`, `server/node_modules` linked in), restored after each; the JSON block at the end of this task carries them for Task 9. The architecture's seven rows keep their ids (W2-T3-M5 is clause 1 alone); clause 2 and the marker compare are W2-T3-M8 and W2-T3-M9, and M10-M19 pin the remaining refusals and orders.

| id | file | red |
|---|---|---|
| W2-T3-M1 | `server/src/docs/policy.ts` | server docs-policy: Tests 4 failed \| 228 passed (232) |
| W2-T3-M2 | `server/src/docs/policy.ts` | server docs-policy: Tests 2 failed \| 230 passed (232) |
| W2-T3-M3 | `server/src/docs/policy.ts` | server docs-policy: Tests 2 failed \| 230 passed (232) |
| W2-T3-M4 | `server/src/docs/policy.ts` | server docs-policy: Tests 10 failed \| 222 passed (232) |
| W2-T3-M5 | `server/src/docs/policy.ts` | server docs-policy: Tests 3 failed \| 229 passed (232) |
| W2-T3-M6 | `server/src/docs/policy.ts` | server docs-policy: Tests 2 failed \| 230 passed (232) |
| W2-T3-M7 | `server/src/docs/policy.ts` | server docs-policy: Tests 1 failed \| 231 passed (232) |
| W2-T3-M8 | `server/src/docs/policy.ts` | server docs-policy: Tests 7 failed \| 225 passed (232) |
| W2-T3-M9 | `server/src/docs/policy.ts` | server docs-policy: Tests 3 failed \| 229 passed (232) |
| W2-T3-M10 | `server/src/docs/policy.ts` | server docs-policy: Tests 1 failed \| 231 passed (232) |
| W2-T3-M11 | `server/src/docs/policy.ts` | server docs-policy: Tests 7 failed \| 225 passed (232) |
| W2-T3-M12 | `server/src/docs/policy.ts` | server docs-policy: Tests 2 failed \| 230 passed (232) |
| W2-T3-M13 | `server/src/docs/policy.ts` | server docs-policy: Tests 1 failed \| 231 passed (232) |
| W2-T3-M14 | `server/src/docs/policy.ts` | server docs-policy: Tests 2 failed \| 230 passed (232) |
| W2-T3-M15 | `server/src/docs/policy.ts` | server docs-policy: Tests 2 failed \| 230 passed (232) |
| W2-T3-M16 | `server/src/docs/policy.ts` | server docs-policy: Tests 3 failed \| 229 passed (232) |
| W2-T3-M17 | `server/src/docs/policy.ts` | server docs-policy: Tests 1 failed \| 231 passed (232) |
| W2-T3-M18 | `server/src/docs/policy.ts` | server docs-policy: Tests 2 failed \| 230 passed (232) |
| W2-T3-M19 | `server/src/docs/policy.ts` | server docs-policy: Tests 2 failed \| 230 passed (232) |

- [ ] **Step 1: Write the failing tests.** Append the block below to the END of `server/test/docs-policy.test.ts`: find the end with `tail -n 3 server/test/docs-policy.test.ts` (it prints the purity describe's last `it`'s `  });` and the describe's `});`), leave one blank line after that final `});`, then paste the block exactly. Edit nothing above it. Fixtures are placeholders only (`demo`, `main`, `ws/a`, `'a'.repeat(40)`, `example.invalid`).

```ts
// ===== Task 3: the API query, :project and refresh-body parsers, and request provenance =====
// M3.4's L1 half (section 3.4 "Parameter rules", refinement (n)) and section 3.8's three provenance clauses
// (refinement (o)). W3's `docs-routes.test.ts` carries M3.4's other half: the same refusals reach no exec. Every
// expected body below is written out by hand from the spec; none is read back from `policy.ts`.
//
// This task's imports sit here, beside its describes, rather than in the block at the top: everything above keeps
// its line number, and Task 2's W2-T2-M14 row cites `docs-policy.test.ts(242,7)`. ES module imports are hoisted, so
// placement changes nothing at run time.
import type { IncomingHttpHeaders } from 'node:http';
import {
  docsProvenance, parseDocsApiQuery, parseDocsProjectParam, parseDocsRefreshBody,
  type DocsApiRoute, type DocsHeaderBag,
} from '../src/docs/policy.js';
import { DOCS_REQUEST_HEADER, DOCS_REQUEST_HEADER_VALUE, docsApi, type DocPin } from '../../shared/docs.js';

/** A query decoded as Fastify's default parser decodes it (fast-querystring 1.1.2, measured in W1's ledger, Task 5):
 *  form-style, so a bare `+` is a space and `%2B` a plus, and a repeated key folds to an array of its values. */
function form(search: string): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [key, value] of new URLSearchParams(search)) {
    const had = Object.hasOwn(out, key) ? out[key] : undefined;
    out[key] = had === undefined ? value : Array.isArray(had) ? [...had, value] : [had, value];
  }
  return out;
}

const T3_COMMIT = 'a'.repeat(40);
const T3_HEAD = 'b'.repeat(40);
const T3_FP = 'c'.repeat(64);
/** A complete committed pin and a complete draft pin, in docsApi's key order. */
const COMMITTED_Q = `commit=${T3_COMMIT}&servedRef=refs/remotes/origin/main&section=specs&path=a.md`;
const DRAFT_Q = `branch=ws/a&head=${T3_HEAD}&section=plans&path=dir/b.md&fp=${T3_FP}`;
const COMMITTED_PIN: DocPin =
  { kind: 'committed', commit: T3_COMMIT, servedRef: 'refs/remotes/origin/main', section: 'specs', path: 'a.md' };
const DRAFT_PIN: DocPin =
  { kind: 'draft', branch: 'ws/a', head: T3_HEAD, section: 'plans', path: 'dir/b.md', fp: T3_FP };

const badQuery = (why: 'unknown' | 'repeated' | 'pin-shape' | 'body', key?: string): DocsFailureBody =>
  key === undefined ? { ok: false, failure: 'bad-query', why } : { ok: false, failure: 'bad-query', key, why };
const refusal = (failure: DocsFailure): DocsFailureBody => ({ ok: false, failure });

describe('parseDocsApiQuery (M3.4, L1 half): a docs API query, parsed or refused before any exec', () => {
  type Row = readonly [what: string, route: DocsApiRoute, search: string, want: unknown];
  const ROWS: readonly Row[] = [
    // projects: no query keys at all.
    ['projects, no keys', 'projects', '', { ok: true, req: { route: 'projects' } }],
    ['projects, an unknown key', 'projects', 'x=1', badQuery('unknown', 'x')],
    ['projects, ref (only the tree takes one)', 'projects', 'ref=main', badQuery('unknown', 'ref')],
    // tree: ref, bare or qualified.
    ['tree, no ref: the default view', 'tree', '', { ok: true, req: { route: 'tree', ref: null } }],
    ['tree, a bare ref', 'tree', 'ref=main', { ok: true, req: { route: 'tree', ref: { kind: 'bare', name: 'main' } } }],
    ['tree, a local qualified ref', 'tree', 'ref=refs/heads/main',
      { ok: true, req: { route: 'tree', ref: { kind: 'qualified', ref: 'refs/heads/main' } } }],
    ['tree, an origin qualified ref', 'tree', 'ref=refs/remotes/origin/ws/a',
      { ok: true, req: { route: 'tree', ref: { kind: 'qualified', ref: 'refs/remotes/origin/ws/a' } } }],
    ['tree, a repeated ref', 'tree', 'ref=a&ref=b', badQuery('repeated', 'ref')],
    ['tree, an empty ref', 'tree', 'ref=', refusal('bad-ref')],
    ['tree, a ref starting with a dash', 'tree', 'ref=-x', refusal('bad-ref')],
    ['tree, a ref with ..', 'tree', 'ref=a..b', refusal('bad-ref')],
    ['tree, a node key (section 3.12 reserves it)', 'tree', 'node=a', badQuery('unknown', 'node')],
    ['tree, a node key beside a good ref', 'tree', 'ref=main&node=a', badQuery('unknown', 'node')],
    // file: a whole pin of one kind.
    ['file, a complete committed pin', 'file', COMMITTED_Q, { ok: true, req: { route: 'file', pin: COMMITTED_PIN } }],
    ['file, a complete draft pin', 'file', DRAFT_Q, { ok: true, req: { route: 'file', pin: DRAFT_PIN } }],
    ['file, a committed pin in another key order', 'file',
      `path=a.md&section=specs&servedRef=refs/remotes/origin/main&commit=${T3_COMMIT}`,
      { ok: true, req: { route: 'file', pin: COMMITTED_PIN } }],
    ['file, a committed pin served from a local ref', 'file',
      `commit=${T3_COMMIT}&servedRef=refs/heads/main&section=specs&path=a.md`,
      { ok: true, req: { route: 'file', pin: { ...COMMITTED_PIN, servedRef: 'refs/heads/main' } } }],
    ['file, a complete committed pin plus branch: mixed', 'file', `${COMMITTED_Q}&branch=main`, badQuery('pin-shape')],
    ['file, a complete draft pin plus commit: mixed', 'file', `${DRAFT_Q}&commit=${T3_COMMIT}`, badQuery('pin-shape')],
    ['file, commit and branch only: mixed and incomplete', 'file',
      `commit=${T3_COMMIT}&branch=main&section=specs&path=a.md`, badQuery('pin-shape')],
    ['file, a committed pin missing path', 'file',
      `commit=${T3_COMMIT}&servedRef=refs/remotes/origin/main&section=specs`, badQuery('pin-shape')],
    ['file, a committed pin missing section', 'file',
      `commit=${T3_COMMIT}&servedRef=refs/remotes/origin/main&path=a.md`, badQuery('pin-shape')],
    ['file, a committed pin missing servedRef', 'file', `commit=${T3_COMMIT}&section=specs&path=a.md`,
      badQuery('pin-shape')],
    ['file, a draft pin missing fp', 'file', `branch=ws/a&head=${T3_HEAD}&section=plans&path=dir/b.md`,
      badQuery('pin-shape')],
    ['file, no pin keys at all', 'file', 'section=specs&path=a.md', badQuery('pin-shape')],
    ['file, no keys at all', 'file', '', badQuery('pin-shape')],
    // Keys the server derives or reserves are unknown, never ignored.
    ['file, a client size', 'file', `${COMMITTED_Q}&size=1`, badQuery('unknown', 'size')],
    ['file, a client maxBytes', 'file', `${COMMITTED_Q}&maxBytes=1`, badQuery('unknown', 'maxBytes')],
    ['file, a node key', 'file', `${COMMITTED_Q}&node=a`, badQuery('unknown', 'node')],
    ['file, a ref key (the pin carries servedRef)', 'file', `${COMMITTED_Q}&ref=main`, badQuery('unknown', 'ref')],
    // Value faults, one at a time.
    ['file, a bare servedRef (qualified only: it is ref.served)', 'file',
      `commit=${T3_COMMIT}&servedRef=main&section=specs&path=a.md`, refusal('bad-ref')],
    ['file, a qualified draft branch (bare only)', 'file',
      `branch=refs/heads/main&head=${T3_HEAD}&section=plans&path=dir/b.md&fp=${T3_FP}`, refusal('bad-ref')],
    ['file, a short commit', 'file', 'commit=abc&servedRef=refs/remotes/origin/main&section=specs&path=a.md',
      refusal('bad-commit')],
    ['file, an upper-case commit', 'file',
      `commit=${'A'.repeat(40)}&servedRef=refs/remotes/origin/main&section=specs&path=a.md`, refusal('bad-commit')],
    ['file, a short head', 'file', `branch=ws/a&head=abc&section=plans&path=dir/b.md&fp=${T3_FP}`,
      refusal('bad-commit')],
    ['file, an unknown section', 'file',
      `commit=${T3_COMMIT}&servedRef=refs/remotes/origin/main&section=notes&path=a.md`, refusal('bad-section')],
    ['file, a short fp', 'file', `branch=ws/a&head=${T3_HEAD}&section=plans&path=dir/b.md&fp=abc`,
      refusal('bad-fingerprint')],
    ['file, a 40-hex fp (a fingerprint is 64)', 'file',
      `branch=ws/a&head=${T3_HEAD}&section=plans&path=dir/b.md&fp=${'c'.repeat(40)}`, refusal('bad-fingerprint')],
    // Precedence: unknown > repeated > pin-shape > values, values in ccd's argv order.
    ['precedence: an unknown key beats a repeated one', 'tree', 'zz=1&ref=a&ref=b', badQuery('unknown', 'zz')],
    ['precedence: the first unknown key in code-unit order, not arrival order', 'tree', 'zz=1&aa=1',
      badQuery('unknown', 'aa')],
    ['precedence: a repeated key beats pin-shape', 'file', 'commit=a&commit=b&branch=x', badQuery('repeated', 'commit')],
    ["precedence: the first repeated key in the route's key order, not arrival order", 'file',
      `path=a.md&path=b.md&commit=${T3_COMMIT}&commit=${T3_COMMIT}`, badQuery('repeated', 'commit')],
    ['precedence: pin-shape beats a bad value', 'file',
      `commit=abc&servedRef=refs/remotes/origin/main&section=specs&path=a.md&head=${T3_HEAD}`, badQuery('pin-shape')],
    ['precedence: committed, commit before path', 'file',
      'commit=abc&servedRef=refs/remotes/origin/main&section=specs&path=../a.md', refusal('bad-commit')],
    ['precedence: committed, servedRef before section', 'file',
      `commit=${T3_COMMIT}&servedRef=main&section=notes&path=a.md`, refusal('bad-ref')],
    ['precedence: committed, section before path', 'file',
      `commit=${T3_COMMIT}&servedRef=refs/remotes/origin/main&section=notes&path=../a.md`, refusal('bad-section')],
    ['precedence: draft, branch before head', 'file',
      `branch=refs/heads/main&head=abc&section=plans&path=dir/b.md&fp=${T3_FP}`, refusal('bad-ref')],
    ['precedence: draft, head before fp', 'file', `branch=ws/a&head=abc&section=plans&path=dir/b.md&fp=abc`,
      refusal('bad-commit')],
    ['precedence: draft, path before fp', 'file', `branch=ws/a&head=${T3_HEAD}&section=plans&path=a//b.md&fp=abc`,
      refusal('bad-path')],
  ];

  it.each(ROWS)('%s', (_what, route, search, want) => {
    expect(parseDocsApiQuery(route, form(search))).toStrictEqual(want);
  });

  it.each([
    ['a parent step', '../a.md'],
    ['an empty component', 'a//b.md'],
    ['a trailing slash', 'a/'],
    ['an empty path', ''],
    ['a format character (U+202E)', '‮.md'],
  ])('file, %s in path is bad-path', (_what, bad) => {
    const search = new URLSearchParams(
      { commit: T3_COMMIT, servedRef: 'refs/remotes/origin/main', section: 'specs', path: bad }).toString();
    expect(parseDocsApiQuery('file', form(search))).toStrictEqual(refusal('bad-path'));
  });

  const ROUND_TRIP_PATHS = ['a b.md', 'a+b.md', 'c%d.md', 'dir/e.md', 'café/ü.md'];

  it.each(ROUND_TRIP_PATHS)('docsApi.file round-trips the path %j, committed and draft', (p) => {
    for (const pin of [{ ...COMMITTED_PIN, path: p }, { ...DRAFT_PIN, path: p }] satisfies DocPin[]) {
      const search = new URL(docsApi.file('demo', pin), 'http://example.invalid').search;
      expect(parseDocsApiQuery('file', form(search))).toStrictEqual({ ok: true, req: { route: 'file', pin } });
    }
  });

  it('docsApi.tree round-trips a bare and a qualified ref', () => {
    for (const ref of [{ kind: 'bare', name: 'ws/a' }, { kind: 'qualified', ref: 'refs/remotes/origin/main' }] as const) {
      const search = new URL(docsApi.tree('demo', ref), 'http://example.invalid').search;
      expect(parseDocsApiQuery('tree', form(search))).toStrictEqual({ ok: true, req: { route: 'tree', ref } });
    }
  });

  it('a hand-typed bare + arrives as a space (form decoding), so it names a different path: documented, not refused', () => {
    expect(parseDocsApiQuery('file', form(`commit=${T3_COMMIT}&servedRef=refs/remotes/origin/main&section=specs&path=a+b.md`)))
      .toStrictEqual({ ok: true, req: { route: 'file', pin: { ...COMMITTED_PIN, path: 'a b.md' } } });
  });

  it('reads own keys only: a null-prototype record parses, an inherited key is no key', () => {
    const bare = Object.assign(Object.create(null) as Record<string, unknown>, { ref: 'main' });
    expect(parseDocsApiQuery('tree', bare)).toStrictEqual(
      { ok: true, req: { route: 'tree', ref: { kind: 'bare', name: 'main' } } });
    const inherited = Object.create({ ref: 'main' }) as Record<string, unknown>;
    expect(parseDocsApiQuery('tree', inherited)).toStrictEqual({ ok: true, req: { route: 'tree', ref: null } });
  });
});

describe('parseDocsProjectParam: a :project failing the grammar is bad-project (section 3.4)', () => {
  it.each(['demo', 'a.b_c-1', '_x', 'x'.repeat(100)])('%j is a project', (p) => {
    expect(parseDocsProjectParam(p)).toStrictEqual({ ok: true, project: p });
  });

  it.each([
    ['a leading dash', '-x'], ['dot-dot', '..'], ['dot', '.'], ['a leading dot', '.a'], ['empty', ''],
    ['a slash', 'a/b'], ['101 characters', 'x'.repeat(101)], ['an array', ['demo']], ['undefined', undefined],
    ['a number', 7],
  ])('%s is bad-project', (_what, p) => {
    expect(parseDocsProjectParam(p)).toStrictEqual(refusal('bad-project'));
  });
});

describe('parseDocsRefreshBody: exactly {ref, reason} (section 3.4, refinement (n))', () => {
  it.each([
    [{ ref: null, reason: 'auto' }, { ref: null, reason: 'auto' }],
    [{ ref: 'main', reason: 'manual' }, { ref: { kind: 'bare', name: 'main' }, reason: 'manual' }],
    [{ reason: 'auto', ref: 'refs/heads/ws/a' }, { ref: { kind: 'qualified', ref: 'refs/heads/ws/a' }, reason: 'auto' }],
  ])('%j parses', (body, req) => {
    expect(parseDocsRefreshBody(body)).toStrictEqual({ ok: true, req });
  });

  it.each([
    ['a string (Fastify parses text/plain too)', 'x'],
    ['an empty array', []],
    ['an array holding a good body', [{ ref: null, reason: 'auto' }]],
    ['null', null],
    ['a number', 7],
    ['a boolean', true],
    ['undefined (no body)', undefined],
  ])('%s is bad-query body', (_what, body) => {
    expect(parseDocsRefreshBody(body)).toStrictEqual(badQuery('body'));
  });

  it.each([
    ['an empty object: ref is checked first', {}, badQuery('body', 'ref')],
    ['ref missing', { reason: 'auto' }, badQuery('body', 'ref')],
    ['reason missing', { ref: null }, badQuery('body', 'reason')],
    ['an extra key', { ref: null, reason: 'auto', x: 1 }, badQuery('unknown', 'x')],
    ['reason later', { ref: null, reason: 'later' }, badQuery('body', 'reason')],
    ['reason in upper case', { ref: null, reason: 'AUTO' }, badQuery('body', 'reason')],
    ['ref a number', { ref: 7, reason: 'auto' }, badQuery('body', 'ref')],
    ['ref an array', { ref: ['main'], reason: 'auto' }, badQuery('body', 'ref')],
    ['ref outside both grammars', { ref: 'a..b', reason: 'auto' }, refusal('bad-ref')],
    ['ref empty', { ref: '', reason: 'auto' }, refusal('bad-ref')],
    ['precedence: a bad reason beats a bad ref string', { ref: 'a..b', reason: 'later' }, badQuery('body', 'reason')],
    ['precedence: an extra key beats a bad shape', { ref: 7, x: 1 }, badQuery('unknown', 'x')],
    ['precedence: the first extra key in code-unit order', { zz: 1, aa: 1, ref: null, reason: 'auto' },
      badQuery('unknown', 'aa')],
  ])('%s', (_what, body, want) => {
    expect(parseDocsRefreshBody(body)).toStrictEqual(want);
  });
});

describe('docsProvenance: section 3.8\'s three clauses, in order (refinement (o))', () => {
  const MARKER = { [DOCS_REQUEST_HEADER]: DOCS_REQUEST_HEADER_VALUE };

  it.each([
    ['navigate with a same-origin site and the marker', { 'sec-fetch-mode': 'navigate', 'sec-fetch-site': 'same-origin', ...MARKER },
      { ok: false, why: 'navigation' }],
    ['navigate with no site and the marker', { 'sec-fetch-mode': 'navigate', ...MARKER }, { ok: false, why: 'navigation' }],
    ['cors from a cross-site page, with the marker', { 'sec-fetch-mode': 'cors', 'sec-fetch-site': 'cross-site', ...MARKER },
      { ok: false, why: 'site', site: 'cross-site' }],
    ['a same-site sibling, with the marker', { 'sec-fetch-site': 'same-site', ...MARKER },
      { ok: false, why: 'site', site: 'same-site' }],
    ['a user-initiated load (none), with the marker', { 'sec-fetch-site': 'none', ...MARKER },
      { ok: false, why: 'site', site: 'none' }],
    ['an empty site is present and not same-origin', { 'sec-fetch-site': '', ...MARKER }, { ok: false, why: 'site', site: '' }],
    ['a doubled same-origin site reads as its join, never as same-origin',
      { 'sec-fetch-site': ['same-origin', 'same-origin'], ...MARKER },
      { ok: false, why: 'site', site: 'same-origin, same-origin' }],
    ['the PWA: cors, same-origin, the marker', { 'sec-fetch-mode': 'cors', 'sec-fetch-site': 'same-origin', ...MARKER },
      { ok: true }],
    ['a browser that sends no Sec-Fetch-*, with the marker', { ...MARKER }, { ok: true }],
    ['no marker', { 'sec-fetch-site': 'same-origin' }, { ok: false, why: 'marker' }],
    ['no headers at all', {}, { ok: false, why: 'marker' }],
    ['the marker 0', { [DOCS_REQUEST_HEADER]: '0' }, { ok: false, why: 'marker' }],
    ['an empty marker', { [DOCS_REQUEST_HEADER]: '' }, { ok: false, why: 'marker' }],
    ['a doubled marker reads as its join', { [DOCS_REQUEST_HEADER]: ['1', '1'] }, { ok: false, why: 'marker' }],
    ['navigation beats site and marker', { 'sec-fetch-mode': 'navigate', 'sec-fetch-site': 'cross-site' },
      { ok: false, why: 'navigation' }],
    ['site beats marker', { 'sec-fetch-site': 'cross-site' }, { ok: false, why: 'site', site: 'cross-site' }],
    ['a long site is carried cut to 64 characters', { 'sec-fetch-site': 'x'.repeat(200), ...MARKER },
      { ok: false, why: 'site', site: 'x'.repeat(64) }],
  ] as const)('%s', (_what, headers, want) => {
    // toStrictEqual: `site` must be ABSENT on navigation and marker refusals, not present and undefined.
    expect(docsProvenance(headers)).toStrictEqual(want);
  });

  it("takes node's IncomingHttpHeaders as it is (checked by typecheck-tests)", () => {
    const incoming: IncomingHttpHeaders = { 'sec-fetch-site': 'same-origin', [DOCS_REQUEST_HEADER]: DOCS_REQUEST_HEADER_VALUE };
    const bag: DocsHeaderBag = incoming;
    expect(docsProvenance(bag)).toStrictEqual({ ok: true });
  });
});
```

- [ ] **Step 2: Run them to verify they fail.** Foreground, Bash timeout 600000 ms.

Run: `( cd server && ./node_modules/.bin/vitest run test/docs-policy.test.ts )`
Expected: `Test Files  1 failed (1)`, `Tests  117 failed | 115 passed (232)`; every new case fails with `TypeError: parseDocsApiQuery is not a function` (or `parseDocsProjectParam`, `parseDocsRefreshBody`, `docsProvenance`), and Task 2's 115 cases stay green.

- [ ] **Step 3: Write the implementation.** Two edits to `server/src/docs/policy.ts`.

(a) Widen the one import statement, in place (HEAD of Task 2: lines 10-13). Find:

```ts
import {
  DOCS_QUALIFIED_PREFIX_RE_BODY, DOCS_RETRY_FLOOR_MS, DOCS_STALE_MS,
  type DocsFailure, type DocsFailureBody, type DocsRefSpec, type DocsTreeOk,
} from '../../../shared/docs.js';
```

Replace with:

```ts
import {
  DOCS_PIN_KEYS, DOCS_QUALIFIED_PREFIX_RE_BODY, DOCS_REQUEST_HEADER, DOCS_REQUEST_HEADER_VALUE, DOCS_RETRY_FLOOR_MS,
  DOCS_STALE_MS, isDocsBareRef, isDocsCommit, isDocsFingerprint, isDocsProject, isDocsQualifiedRef, isDocsRelPath,
  isDocsSection, parseDocsRef,
  type DocPin, type DocSectionSlug, type DocsFailure, type DocsFailureBody, type DocsRefSpec, type DocsTreeOk,
} from '../../../shared/docs.js';
```

(b) Append the block below to the END of the file: leave one blank line after `refreshDue`'s closing `}` (the file's last line, 177 at Task 2's state), then paste it exactly. Every value test is a W1 predicate call, never a local regex; the pin keys come from `DOCS_PIN_KEYS`; the marker word is `DOCS_REQUEST_HEADER`, never quoted; no `node:` import, no clock, no `console` (Task 2's purity scan reads this file).

```ts
// ===== The API query, :project and refresh-body parsers (section 3.4 "Parameter rules"; refinement (n); M3.4) =====
//
// Each parser takes what Fastify hands a route and answers a typed request, or the failure body W3 sends before any
// exec. Every value test is an L0 predicate from `shared/docs.ts` (section 3.2: no second grammar in server/src),
// and the pin keys are read from `DOCS_PIN_KEYS`, never re-spelled. A query arrives decoded by Fastify's default
// parser (fast-querystring: form-style, so `%2B` is a plus, a bare `+` is a space, and a repeated key is an array).
// `docsApi` writes every value through `encodeURIComponent`, so only a hand-typed URL meets a bare `+`, and it reads
// as a space.

/** The three GET routes whose query `parseDocsApiQuery` reads. The refresh POST's body is `parseDocsRefreshBody`'s. */
export type DocsApiRoute = 'projects' | 'tree' | 'file';

/** A GET request, parsed. `ref: null` is the default view (the query has no `ref` key), one meaning. */
export type DocsApiRequest =
  | { route: 'projects' }
  | { route: 'tree'; ref: DocsRefSpec | null }
  | { route: 'file'; pin: DocPin };

/** The pin keys by name, in `DOCS_PIN_KEYS`'s order: a committed pin's two, then a draft pin's three. */
const [PIN_COMMIT, PIN_SERVED_REF, PIN_BRANCH, PIN_HEAD, PIN_FP] = DOCS_PIN_KEYS;
const COMMITTED_PIN_KEYS: readonly string[] = [PIN_COMMIT, PIN_SERVED_REF];
const DRAFT_PIN_KEYS: readonly string[] = [PIN_BRANCH, PIN_HEAD, PIN_FP];

/** The keys each route carries, in the order a repeated key is reported. Any other key is unknown: a client
 *  `size` or `maxBytes` (the server derives the cap from the path's class) and a `node` (section 3.12) included. */
const API_KEYS: Readonly<Record<DocsApiRoute, readonly string[]>> = {
  projects: [],
  tree: ['ref'],
  file: [...DOCS_PIN_KEYS, 'section', 'path'],
};

/** The refresh body's keys: exactly these two (section 3.4). */
const REFRESH_KEYS: readonly string[] = ['ref', 'reason'];

/** `bad-query`, with the key it names when it names one (`pin-shape` and a non-object body name none). */
function badQuery(why: 'unknown' | 'repeated' | 'pin-shape' | 'body', key?: string): DocsFailureBody {
  return key === undefined ? { ok: false, failure: 'bad-query', why } : { ok: false, failure: 'bad-query', key, why };
}

/** A grammar refusal: the word alone, no context (section 2 (i)'s Argument rows carry none). */
function refused(failure: DocsFailure): DocsFailureBody {
  return { ok: false, failure };
}

function isText(v: unknown): v is string {
  return typeof v === 'string';
}

/** The value of an OWN key, or `undefined` when the record has no such own key: an inherited name is no key. The
 *  one reader of a value, so a repeated key (an array) reaches every check as the array it is. */
function own(record: Readonly<Record<string, unknown>>, key: string): unknown {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

/** The first own key outside `allowed`, in code-unit order, so the answer does not depend on the order the keys
 *  arrived in; `undefined` when every key is allowed. */
function firstUnknownKey(record: Readonly<Record<string, unknown>>, allowed: readonly string[]): string | undefined {
  return Object.keys(record).sort().find((k) => !allowed.includes(k));
}

function sameKeys(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((k, i) => k === b[i]);
}

/** The section and the path every pin carries, in ccd's argv order: section, then path. */
function parsePinPlace(query: Readonly<Record<string, unknown>>):
    { ok: true; section: DocSectionSlug; path: string } | DocsFailureBody {
  const section = own(query, 'section');
  if (!isText(section) || !isDocsSection(section)) return refused('bad-section');
  const path = own(query, 'path');
  if (!isText(path) || !isDocsRelPath(path)) return refused('bad-path');
  return { ok: true, section, path };
}

/**
 * A file query's pin. Its pin keys must be EXACTLY a committed pin's or a draft pin's, and `section` and `path` must
 * both be present, else `pin-shape` (a mixed or incomplete pin) before any value is read. Then each value, in ccd's
 * argv order, the first fault winning:
 * - committed: `commit` (bad-commit), `servedRef` (bad-ref; QUALIFIED only, because it is the tree answer's
 *   `ref.served`, which `docs-show --commit` receives as `--ref`), `section`, `path`;
 * - draft: `branch` (bad-ref; BARE only), `head` (bad-commit), `section`, `path`, `fp` (bad-fingerprint).
 * The pin is assembled only after every value passed.
 */
function parseFilePin(query: Readonly<Record<string, unknown>>): { ok: true; pin: DocPin } | DocsFailureBody {
  const pinKeys = DOCS_PIN_KEYS.filter((k) => Object.hasOwn(query, k));
  const committed = sameKeys(pinKeys, COMMITTED_PIN_KEYS);
  if ((!committed && !sameKeys(pinKeys, DRAFT_PIN_KEYS)) ||
    !Object.hasOwn(query, 'section') || !Object.hasOwn(query, 'path')) return badQuery('pin-shape');
  if (committed) {
    const commit = own(query, PIN_COMMIT);
    if (!isText(commit) || !isDocsCommit(commit)) return refused('bad-commit');
    const servedRef = own(query, PIN_SERVED_REF);
    if (!isText(servedRef) || !isDocsQualifiedRef(servedRef)) return refused('bad-ref');
    const place = parsePinPlace(query);
    if (!place.ok) return place;
    return { ok: true, pin: { kind: 'committed', commit, servedRef, section: place.section, path: place.path } };
  }
  const branch = own(query, PIN_BRANCH);
  if (!isText(branch) || !isDocsBareRef(branch)) return refused('bad-ref');
  const head = own(query, PIN_HEAD);
  if (!isText(head) || !isDocsCommit(head)) return refused('bad-commit');
  const place = parsePinPlace(query);
  if (!place.ok) return place;
  const fp = own(query, PIN_FP);
  if (!isText(fp) || !isDocsFingerprint(fp)) return refused('bad-fingerprint');
  return { ok: true, pin: { kind: 'draft', branch, head, section: place.section, path: place.path, fp } };
}

/**
 * Parse a docs GET route's query (section 3.4 "Parameter rules"; M3.4's L1 half). One fixed precedence, so one
 * query has one answer whatever order its keys arrived in:
 * 1. an unknown key: `bad-query {key, why:'unknown'}`, the first in code-unit order;
 * 2. a repeated key (an array value): `bad-query {key, why:'repeated'}`, the first in the route's key order;
 * 3. (file) a mixed or incomplete pin: `bad-query {why:'pin-shape'}`;
 * 4. a value outside its grammar: its own `bad-*` word, in ccd's argv order. A tree's `ref` is bare or qualified.
 */
export function parseDocsApiQuery(route: DocsApiRoute, query: Readonly<Record<string, unknown>>):
    { ok: true; req: DocsApiRequest } | DocsFailureBody {
  const allowed = API_KEYS[route];
  const unknown = firstUnknownKey(query, allowed);
  if (unknown !== undefined) return badQuery('unknown', unknown);
  const repeated = allowed.find((k) => Array.isArray(own(query, k)));
  if (repeated !== undefined) return badQuery('repeated', repeated);
  if (route === 'projects') return { ok: true, req: { route } };
  if (route === 'tree') {
    if (!Object.hasOwn(query, 'ref')) return { ok: true, req: { route, ref: null } };
    const text = own(query, 'ref');
    const ref = isText(text) ? parseDocsRef(text) : null;
    return ref === null ? refused('bad-ref') : { ok: true, req: { route, ref } };
  }
  const pin = parseFilePin(query);
  return pin.ok ? { ok: true, req: { route, pin: pin.pin } } : pin;
}

/** The `:project` route parameter: the project grammar, else `bad-project` (section 3.4), before any exec. */
export function parseDocsProjectParam(project: unknown): { ok: true; project: string } | DocsFailureBody {
  return isText(project) && isDocsProject(project) ? { ok: true, project } : refused('bad-project');
}

/** A parsed refresh body. `ref: null` is the default view, one meaning; `reason` changes nothing on the server but
 *  the wording of a failure log line (section 3.4). */
export type DocsRefreshRequest = { ref: DocsRefSpec | null; reason: 'auto' | 'manual' };

/**
 * Parse the refresh POST's body: an object with exactly the keys `ref` and `reason` (section 3.4). In order:
 * 1. not a plain object (a string, which Fastify's `text/plain` parser yields, an array, `null`, a number, no
 *    body): `bad-query {why:'body'}`;
 * 2. an extra key: `bad-query {key, why:'unknown'}`, the first in code-unit order;
 * 3. `ref` missing or neither `null` nor a string, then `reason` missing or not `auto`/`manual`:
 *    `bad-query {key, why:'body'}`;
 * 4. a string `ref` in neither ref grammar: `bad-ref`. A local qualified ref is ACCEPTED here: `fetchBranchFor`
 *    skips its fetch, and the follow-up tree still runs.
 */
export function parseDocsRefreshBody(body: unknown): { ok: true; req: DocsRefreshRequest } | DocsFailureBody {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return badQuery('body');
  const record = body as Readonly<Record<string, unknown>>;
  const unknown = firstUnknownKey(record, REFRESH_KEYS);
  if (unknown !== undefined) return badQuery('unknown', unknown);
  const ref = own(record, 'ref');
  if (ref !== null && !isText(ref)) return badQuery('body', 'ref');
  const reason = own(record, 'reason');
  if (reason !== 'auto' && reason !== 'manual') return badQuery('body', 'reason');
  if (ref === null) return { ok: true, req: { ref: null, reason } };
  const spec = parseDocsRef(ref);
  return spec === null ? refused('bad-ref') : { ok: true, req: { ref: spec, reason } };
}

// ===== Request provenance (section 3.8; refinement (o)) =====

/** A request's headers as node hands them over: structurally `IncomingHttpHeaders` (names lower-cased; a value
 *  a string, an array for a repeated header node does not join, or absent). Declared here because L1 imports no
 *  node type; `docs-policy.test.ts` assigns an `IncomingHttpHeaders` to it under `typecheck-tests`. */
export type DocsHeaderBag = Readonly<Record<string, string | readonly string[] | undefined>>;

/** `docsProvenance`'s verdict. `site` rides only a `site` refusal: the header's text, cut to 64 characters. */
export type DocsProvenance = { ok: true } | { ok: false; why: 'navigation' | 'site' | 'marker'; site?: string };

/** How much of a refused `sec-fetch-site` value the refusal carries. */
const PROVENANCE_SITE_MAX_CHARS = 64;

/** A header's text: absent stays `undefined`; an array reads as its `', '`-join (node's own join), so it never
 *  equals a single expected value. */
function headerText(v: string | readonly string[] | undefined): string | undefined {
  if (v === undefined) return undefined;
  return isText(v) ? v : v.join(', ');
}

/**
 * Whether a docs API request came from the PWA's own `fetch()` (section 3.8), its three clauses in order, the first
 * refusal winning:
 * 1. `sec-fetch-mode` is `navigate`: `navigation` (every top-level and frame navigation, through the service worker
 *    too);
 * 2. `sec-fetch-site` is present and not `same-origin`: `site` (a same-site sibling, cross-site, `none`, and an
 *    empty value), carrying the value cut to 64 characters;
 * 3. the marker header (`DOCS_REQUEST_HEADER`) is not exactly `DOCS_REQUEST_HEADER_VALUE`: `marker`.
 * Clause 3 is the wall on a browser that sends no `Sec-Fetch-*`; clauses 1 and 2 hold even when the marker is
 * present. W3's `onRequest` hook applies the verdict (403 `foreign-request`, its log line); this decides only.
 */
export function docsProvenance(headers: DocsHeaderBag): DocsProvenance {
  if (headerText(headers['sec-fetch-mode']) === 'navigate') return { ok: false, why: 'navigation' };
  const site = headerText(headers['sec-fetch-site']);
  if (site !== undefined && site !== 'same-origin') {
    return { ok: false, why: 'site', site: site.slice(0, PROVENANCE_SITE_MAX_CHARS) };
  }
  if (headerText(headers[DOCS_REQUEST_HEADER]) !== DOCS_REQUEST_HEADER_VALUE) return { ok: false, why: 'marker' };
  return { ok: true };
}
```

- [ ] **Step 4: Run them to verify they pass.** Foreground, Bash timeout 600000 ms.

Run: `( cd server && ./node_modules/.bin/vitest run test/docs-policy.test.ts )`
Expected: `Tests  232 passed (232)` (Task 2's 115; this task's 117: `parseDocsApiQuery` 62, `parseDocsProjectParam` 14, `parseDocsRefreshBody` 23, `docsProvenance` 18). The purity describe stays green: the only import specifier is still `../../../shared/docs.js`.

- [ ] **Step 5: The guard suites and the compiles.** Foreground, Bash timeout 600000 ms each; `typecheck-tests` is a known load flake, so a red there is re-run alone before it is called broken.

Run: `( cd server && node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit && node node_modules/typescript/bin/tsc -p test/tsconfig.tests.json --noEmit && echo TSC-OK )`
Expected: `TSC-OK`. The first compiles `policy.ts` under the server's build flags (target ES2022, so `Object.hasOwn` is in the lib); the second compiles the new cases, including the `IncomingHttpHeaders` -> `DocsHeaderBag` assignment and Task 2's `@ts-expect-error`, which must still be USED.

Run: `( cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts )`
Expected: `Tests  399 passed (399)` (Measured 2): the `x-ccrc-docs` literal pin, the grammar-body pins and every W1 one-home pin see no second copy.

Run: `( cd server && ./node_modules/.bin/vitest run test/docs-url.test.ts test/docs-shared.test.ts )`
Expected: `Test Files  2 passed (2)`, `Tests  337 passed (337)` (docs-url 98, docs-shared 239); W1's L0 is consumed, never amended.

Run: `( cd server && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts )`
Expected: `Tests  12 passed (12)`. With a symlinked `pwa/node_modules` only `PWA_TSC really is pwa's own installed compiler` reds (Measured 4); Task 1's Step 0 installs real modules.

Run: `( cd server && ./node_modules/.bin/vitest run test/topology-clean.test.ts test/capsupported.test.ts )`
Expected: `Test Files  2 passed (2)`, `Tests  76 passed (76)` (topology-clean 55, capsupported 21). `topology-clean` needs `origin/main` (Measured 4); this task adds no real host, project or account name, and spells no cap token.

No `ccd/ccd` edit, so no restamp.

- [ ] **Step 6: Commit.**

```bash
git add server/src/docs/policy.ts server/test/docs-policy.test.ts
git commit -m "server: docs L1 query parsers and provenance (docs W2)" \
  -m "parseDocsApiQuery (M3.4, L1 half: unknown > repeated > pin-shape > value faults in ccd's argv order, servedRef qualified only, draft branch bare only), parseDocsProjectParam (bad-project), parseDocsRefreshBody (exactly {ref, reason}) and docsProvenance (section 3.8's three clauses in order, the marker read through DOCS_REQUEST_HEADER). Every value test is a W1 L0 predicate; the pin keys come from DOCS_PIN_KEYS." \
  -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

**Mutation rows this task contributes** (each measured red in a separate copy, never in the worktree; `pkg` is the package the `tests` run in; `old` is unique in the file at this task's state):

```json
[
 {
  "id": "W2-T3-M1",
  "pkg": "server",
  "file": "server/src/docs/policy.ts",
  "old": "  return Object.hasOwn(record, key) ? record[key] : undefined;",
  "new": "  const v = Object.hasOwn(record, key) ? record[key] : undefined;\n  return Array.isArray(v) ? v[0] : v;",
  "tests": [
   "test/docs-policy.test.ts"
  ],
  "red": "server docs-policy: Tests 4 failed | 228 passed (232) — tree, a repeated ref; precedence: a repeated key beats pin-shape; precedence: the first repeated key in the route's key order, not arrival order; ref an array"
 },
 {
  "id": "W2-T3-M2",
  "pkg": "server",
  "file": "server/src/docs/policy.ts",
  "old": "  const committed = sameKeys(pinKeys, COMMITTED_PIN_KEYS);",
  "new": "  const committed = COMMITTED_PIN_KEYS.every((k) => pinKeys.includes(k));",
  "tests": [
   "test/docs-policy.test.ts"
  ],
  "red": "server docs-policy: Tests 2 failed | 230 passed (232) — file, a complete committed pin plus branch: mixed; precedence: pin-shape beats a bad value"
 },
 {
  "id": "W2-T3-M3",
  "pkg": "server",
  "file": "server/src/docs/policy.ts",
  "old": "    if (!isText(servedRef) || !isDocsQualifiedRef(servedRef)) return refused('bad-ref');",
  "new": "    if (!isText(servedRef) || parseDocsRef(servedRef) === null) return refused('bad-ref');",
  "tests": [
   "test/docs-policy.test.ts"
  ],
  "red": "server docs-policy: Tests 2 failed | 230 passed (232) — file, a bare servedRef (qualified only: it is ref.served); precedence: committed, servedRef before section"
 },
 {
  "id": "W2-T3-M4",
  "pkg": "server",
  "file": "server/src/docs/policy.ts",
  "old": "  if (unknown !== undefined) return badQuery('unknown', unknown);\n  const repeated = allowed.find(",
  "new": "  const repeated = allowed.find(",
  "tests": [
   "test/docs-policy.test.ts"
  ],
  "red": "server docs-policy: Tests 10 failed | 222 passed (232) — projects, an unknown key; projects, ref (only the tree takes one); tree, a node key (section 3.12 reserves it); tree, a node key beside a good ref; file, a client size; file, a client maxBytes; file, a node key; file, a ref key (the pin carries servedRef); precedence: an unknown key beats a repeated one; precedence: the first unknown key in code-unit order, not arrival order"
 },
 {
  "id": "W2-T3-M5",
  "pkg": "server",
  "file": "server/src/docs/policy.ts",
  "old": "  if (headerText(headers['sec-fetch-mode']) === 'navigate') return { ok: false, why: 'navigation' };\n",
  "new": "",
  "tests": [
   "test/docs-policy.test.ts"
  ],
  "red": "server docs-policy: Tests 3 failed | 229 passed (232) — navigate with a same-origin site and the marker; navigate with no site and the marker; navigation beats site and marker"
 },
 {
  "id": "W2-T3-M6",
  "pkg": "server",
  "file": "server/src/docs/policy.ts",
  "old": "  if (typeof body !== 'object' || body === null || Array.isArray(body)) return badQuery('body');",
  "new": "  if (typeof body !== 'object' || body === null) return badQuery('body');",
  "tests": [
   "test/docs-policy.test.ts"
  ],
  "red": "server docs-policy: Tests 2 failed | 230 passed (232) — an empty array is bad-query body; an array holding a good body is bad-query body"
 },
 {
  "id": "W2-T3-M7",
  "pkg": "server",
  "file": "server/src/docs/policy.ts",
  "old": "  const pinKeys = DOCS_PIN_KEYS.filter((k) => Object.hasOwn(query, k));",
  "new": "  const early = own(query, PIN_COMMIT);\n  if (early !== undefined && !(isText(early) && isDocsCommit(early))) return refused('bad-commit');\n  const pinKeys = DOCS_PIN_KEYS.filter((k) => Object.hasOwn(query, k));",
  "tests": [
   "test/docs-policy.test.ts"
  ],
  "red": "server docs-policy: Tests 1 failed | 231 passed (232) — precedence: pin-shape beats a bad value"
 },
 {
  "id": "W2-T3-M8",
  "pkg": "server",
  "file": "server/src/docs/policy.ts",
  "old": "  if (site !== undefined && site !== 'same-origin') {\n    return { ok: false, why: 'site', site: site.slice(0, PROVENANCE_SITE_MAX_CHARS) };\n  }\n",
  "new": "",
  "tests": [
   "test/docs-policy.test.ts"
  ],
  "red": "server docs-policy: Tests 7 failed | 225 passed (232) — cors from a cross-site page, with the marker; a same-site sibling, with the marker; a user-initiated load (none), with the marker; an empty site is present and not same-origin; a doubled same-origin site reads as its join, never as same-origin; site beats marker; a long site is carried cut to 64 characters"
 },
 {
  "id": "W2-T3-M9",
  "pkg": "server",
  "file": "server/src/docs/policy.ts",
  "old": "  if (headerText(headers[DOCS_REQUEST_HEADER]) !== DOCS_REQUEST_HEADER_VALUE) return { ok: false, why: 'marker' };",
  "new": "  if (headerText(headers[DOCS_REQUEST_HEADER]) === undefined) return { ok: false, why: 'marker' };",
  "tests": [
   "test/docs-policy.test.ts"
  ],
  "red": "server docs-policy: Tests 3 failed | 229 passed (232) — the marker 0; an empty marker; a doubled marker reads as its join"
 },
 {
  "id": "W2-T3-M10",
  "pkg": "server",
  "file": "server/src/docs/policy.ts",
  "old": "site: site.slice(0, PROVENANCE_SITE_MAX_CHARS) };",
  "new": "site };",
  "tests": [
   "test/docs-policy.test.ts"
  ],
  "red": "server docs-policy: Tests 1 failed | 231 passed (232) — a long site is carried cut to 64 characters"
 },
 {
  "id": "W2-T3-M11",
  "pkg": "server",
  "file": "server/src/docs/policy.ts",
  "old": "  return isText(project) && isDocsProject(project) ? { ok: true, project } : refused('bad-project');",
  "new": "  return isText(project) ? { ok: true, project } : refused('bad-project');",
  "tests": [
   "test/docs-policy.test.ts"
  ],
  "red": "server docs-policy: Tests 7 failed | 225 passed (232) — a leading dash is bad-project; dot-dot is bad-project; dot is bad-project; a leading dot is bad-project; empty is bad-project; a slash is bad-project; 101 characters is bad-project"
 },
 {
  "id": "W2-T3-M12",
  "pkg": "server",
  "file": "server/src/docs/policy.ts",
  "old": "  return Object.keys(record).sort().find((k) => !allowed.includes(k));",
  "new": "  return Object.keys(record).find((k) => !allowed.includes(k));",
  "tests": [
   "test/docs-policy.test.ts"
  ],
  "red": "server docs-policy: Tests 2 failed | 230 passed (232) — precedence: the first unknown key in code-unit order, not arrival order; precedence: the first extra key in code-unit order"
 },
 {
  "id": "W2-T3-M13",
  "pkg": "server",
  "file": "server/src/docs/policy.ts",
  "old": "  const repeated = allowed.find((k) => Array.isArray(own(query, k)));",
  "new": "  const repeated = Object.keys(query).find((k) => Array.isArray(own(query, k)));",
  "tests": [
   "test/docs-policy.test.ts"
  ],
  "red": "server docs-policy: Tests 1 failed | 231 passed (232) — precedence: the first repeated key in the route's key order, not arrival order"
 },
 {
  "id": "W2-T3-M14",
  "pkg": "server",
  "file": "server/src/docs/policy.ts",
  "old": "  if (!isText(branch) || !isDocsBareRef(branch)) return refused('bad-ref');",
  "new": "  if (!isText(branch) || parseDocsRef(branch) === null) return refused('bad-ref');",
  "tests": [
   "test/docs-policy.test.ts"
  ],
  "red": "server docs-policy: Tests 2 failed | 230 passed (232) — file, a qualified draft branch (bare only); precedence: draft, branch before head"
 },
 {
  "id": "W2-T3-M15",
  "pkg": "server",
  "file": "server/src/docs/policy.ts",
  "old": "  return spec === null ? refused('bad-ref') : { ok: true, req: { ref: spec, reason } };",
  "new": "  return { ok: true, req: { ref: spec ?? { kind: 'bare', name: ref }, reason } };",
  "tests": [
   "test/docs-policy.test.ts"
  ],
  "red": "server docs-policy: Tests 2 failed | 230 passed (232) — ref outside both grammars; ref empty"
 },
 {
  "id": "W2-T3-M16",
  "pkg": "server",
  "file": "server/src/docs/policy.ts",
  "old": "  const unknown = firstUnknownKey(record, REFRESH_KEYS);\n  if (unknown !== undefined) return badQuery('unknown', unknown);\n",
  "new": "",
  "tests": [
   "test/docs-policy.test.ts"
  ],
  "red": "server docs-policy: Tests 3 failed | 229 passed (232) — an extra key; precedence: an extra key beats a bad shape; precedence: the first extra key in code-unit order"
 },
 {
  "id": "W2-T3-M17",
  "pkg": "server",
  "file": "server/src/docs/policy.ts",
  "old": "  const section = own(query, 'section');\n  if (!isText(section) || !isDocsSection(section)) return refused('bad-section');\n  const path = own(query, 'path');\n  if (!isText(path) || !isDocsRelPath(path)) return refused('bad-path');\n",
  "new": "  const path = own(query, 'path');\n  if (!isText(path) || !isDocsRelPath(path)) return refused('bad-path');\n  const section = own(query, 'section');\n  if (!isText(section) || !isDocsSection(section)) return refused('bad-section');\n",
  "tests": [
   "test/docs-policy.test.ts"
  ],
  "red": "server docs-policy: Tests 1 failed | 231 passed (232) — precedence: committed, section before path"
 },
 {
  "id": "W2-T3-M18",
  "pkg": "server",
  "file": "server/src/docs/policy.ts",
  "old": "  if ((!committed && !sameKeys(pinKeys, DRAFT_PIN_KEYS)) ||\n    !Object.hasOwn(query, 'section') || !Object.hasOwn(query, 'path')) return badQuery('pin-shape');",
  "new": "  if (!committed && !sameKeys(pinKeys, DRAFT_PIN_KEYS)) return badQuery('pin-shape');",
  "tests": [
   "test/docs-policy.test.ts"
  ],
  "red": "server docs-policy: Tests 2 failed | 230 passed (232) — file, a committed pin missing path; file, a committed pin missing section"
 },
 {
  "id": "W2-T3-M19",
  "pkg": "server",
  "file": "server/src/docs/policy.ts",
  "old": "  const ref = own(record, 'ref');",
  "new": "  const ref = own(record, 'ref') ?? null;",
  "tests": [
   "test/docs-policy.test.ts"
  ],
  "red": "server docs-policy: Tests 2 failed | 230 passed (232) — an empty object: ref is checked first; ref missing"
 }
]
```

---

---

### Task 4: L1 policy, part 3: read-lane admission, wire estimates, cache-control and the response-header verdict

**Model routing:** `sonnet`, effort `high` — small pure functions whose bodies the spec gives (section 6.2, section 6.3, section 5.3), but every boundary (`>` against `>=`, `??` against `||`, exact content-type match) is a row of its own, and the expected values in the test are hand-computed from the spec, never read back from `policy.ts`.

**Spec rows:** M6.1 (`laneAdmit`: idle, full execs, over bytes, a second large job; "delete or loosen any clause" reds), M6.4 (estimates from server facts: a size sent by the client has no effect, a listed size lowers the estimate, an unknown size uses the class cap), section 6.2's `showRawBound`/`showWire`/`LISTING_JOB` exactly, section 6.3's `laneAdmit` body verbatim and its five constants (refinement (l)), section 6.6's browser-cache table and section 5.2's `cacheControlFor`, and section 5.3's `onSend` hook expressed as an L1 verdict (refinement (m)). M6.3's inequalities (`showWire(class cap) <= DOCS_LANE_BYTES`, `DOCS_MAX_LISTING_WIRE_BYTES <= DOCS_LANE_BYTES`, `DOCS_LANE_QUEUE >= DOCS_MAX_IMAGES_PER_PAGE + 2`) are Task 5's `docs-budget.test.ts`, which imports this task's `DOCS_LANE_BYTES`, `DOCS_LANE_QUEUE` and `showWire`. The lane itself (FIFO, queue, wait, `docs-busy`, M6.2) and the `onSend` hook that applies the verdict are W3's L4.

**Files:**
- Modify: `server/src/docs/policy.ts` — (a) its one import statement (Task 3's state: lines 11-17, the block starting `import {` directly under the header comment), replaced in place with a wider one, same specifier; (b) an append at the end of the file (after `docsProvenance`'s closing `}`, line 387 at Task 3's state).
- Modify: `server/test/docs-policy.test.ts` — an append at the end of the file only (after the `docsProvenance` describe's closing `});`, line 557 at Task 3's state). This task's imports go WITH its describes at the end, for Task 3's reason: Task 2's W2-T2-M14 row cites `docs-policy.test.ts(242,7)`, so no line above the end may move. ES module imports are hoisted.
- Test: `server/test/docs-policy.test.ts`; guards `server/test/single-definition.test.ts`, `server/test/docs-url.test.ts`, `server/test/docs-shared.test.ts`, `server/test/typecheck-tests.test.ts`, `server/test/topology-clean.test.ts`, `server/test/capsupported.test.ts`.

The Find block below is quoted from `policy.ts` as Task 3 left it and is unique in it; the line numbers are hints. If it is absent or not unique, stop and put an ask to the coordinator.

**Interfaces:**
- Consumes, from `shared/docs.ts` (W1; imported, never amended):
  - `DOCS_ENVELOPE_RESERVE = 65536`; `DOCS_MAX_LISTING_WIRE_BYTES = 1048576`; `DOCS_CLASS_CAP: Record<DocContentClass, number>` (every class 2097152 today, derived from `DOCS_MAX_DOC_BYTES` and `DOCS_MAX_IMAGE_BYTES`); `contentClass(path: string): DocContentClass`; `type DocContentClass = 'markdown' | 'raster' | 'svg' | 'html' | 'text' | 'other'`; `type DocPin`.
  - `DOCS_RESPONSE_HEADERS` (`as const`: `x-content-type-options`, `content-security-policy`, `referrer-policy`, `cross-origin-resource-policy`); `DOCS_ALLOWED_CONTENT_TYPES: readonly string[]` (`'application/json; charset=utf-8'` and the four raster MIME types).
  - `type DocsFailureBody`.
- Consumes, from Task 2 (`policy.ts`): `DOCS_FAILURE_HTTP` (the refusal's status is `DOCS_FAILURE_HTTP['response-type-refused']`, 500). From Task 3: `parseDocsApiQuery` (M6.4's client-size row), and in the test file Task 3's module-scope `form`, `COMMITTED_Q`, `COMMITTED_PIN`, `DRAFT_PIN` and `badQuery`, reused, never redeclared.
- Produces, all in `server/src/docs/policy.ts`:
  - `export const DOCS_LANE_EXECS = 2;` `export const DOCS_LANE_BYTES = 3145728;` `export const DOCS_LANE_LARGE_RAW = 1048576;` `export const DOCS_LANE_QUEUE = 32;` `export const DOCS_LANE_MAX_WAIT_MS = 10000;` — each its own integer literal (pinned by source text).
  - `export interface DocsJob { raw: number; wire: number }`
  - `export interface LaneLoad { execs: number; bytes: number; large: number }`
  - `export function laneAdmit(load: LaneLoad, job: DocsJob): boolean` — section 6.3's four clauses, in order.
  - `export function showRawBound(classCap: number, knownSize: number | undefined): number` — `undefined`: the server holds no size fact, one meaning.
  - `export function showWire(raw: number): number`
  - `export const LISTING_JOB: Readonly<DocsJob>` — `{ raw: DOCS_MAX_LISTING_WIRE_BYTES, wire: DOCS_MAX_LISTING_WIRE_BYTES }`, frozen. (`Readonly<DocsJob>` is assignable wherever a `DocsJob` is taken.)
  - `export interface DocsShowPlan { cls: DocContentClass; maxBytes: number; job: DocsJob }`
  - `export function docsShowPlan(path: string, knownSize: number | undefined): DocsShowPlan` — `maxBytes = DOCS_CLASS_CAP[contentClass(path)]`, `job.raw = showRawBound(maxBytes, knownSize)`, `job.wire = showWire(job.raw)`.
  - `export const DOCS_CACHE_IMMUTABLE = 'private, max-age=31536000, immutable';` `export const DOCS_CACHE_NO_STORE = 'no-store';` `export const DOCS_JSON_CONTENT_TYPE = 'application/json; charset=utf-8';`
  - `export function cacheControlFor(pin: DocPin, cls: DocContentClass): string`
  - `export type DocsSendVerdict = { kind: 'pass'; headers: Readonly<Record<string, string>> } | { kind: 'refuse'; status: number; headers: Readonly<Record<string, string>>; remove: readonly string[]; body: DocsFailureBody; contentType: string };`
  - `export function docsSendPolicy(statusCode: number, contentType: string, cacheControl: string | undefined): DocsSendVerdict` — `contentType` is the reply's content-type as text (`''` when none); `cacheControl` `undefined` means the route set none, one meaning.
  - Module-private (not exported, so no one-home pin is owed): `REFUSED_RESPONSE_REMOVES = ['content-length', 'content-disposition']`, `REFUSED_TYPE_MAX_CHARS = 80`.
  - For later tasks: Task 5 imports `DOCS_LANE_BYTES`, `DOCS_LANE_QUEUE`, `showWire`; Tasks 6-7 import `type DocsJob`, `LISTING_JOB` and build show asks with `docsShowPlan`; Task 8's one-home pins name every export above (`DOCS_JSON_CONTENT_TYPE`, `DocsShowPlan` and `DocsSendVerdict` included). A later task that needs another `shared/docs.ts` name ADDS it to the one import statement (never a second import from the same specifier).

**Decisions this task makes (refinements (l) and (m) applied; none is a deviation):**
1. **`laneAdmit` is section 6.3's body verbatim**, with the named constants. Its refusal is "not yet" (the lane keeps the job at the head of its FIFO), never `docs-busy`; `docs-busy` is the W3 lane's queue-full or wait-expired answer.
2. **`showRawBound` uses `??`**, as the spec spells it: a listed size of 0 is a fact (an empty file), not an unknown. A row pins it (W2-T4-M8).
3. **`LISTING_JOB` is frozen** and typed `Readonly<DocsJob>`: one shared object that every tree and index job books, so a caller writing into it would move every other caller's estimate.
4. **`docsShowPlan` is the one place a show's `--max-bytes` and lane job are derived**, from the path and a server-held size only; it takes no query, so nothing a client sends reaches it (M6.4). The class caps are all 2 MiB today, so no value can tell `DOCS_CLASS_CAP[cls]` from a fixed cap: a source-text row pins the lookup (W1's pattern for the same equality in `docs-shared.test.ts`).
5. **`cacheControlFor(pin, cls)` takes the class as given** (the spec's signature): the route computes `cls` once from `pin.path` (section 5.2 step 2) and passes it both here and to `docsShowPlan`.
6. **`docsSendPolicy`'s `refuse` arm carries the whole refusal** (status from `DOCS_FAILURE_HTTP`, the four L0 headers plus `content-type: application/json; charset=utf-8` and `cache-control: no-store`, the two headers to remove, the body `{ok:false, failure:'response-type-refused'}`, and the refused type cut to 80 characters for the log line), so W3's hook applies it and decides nothing (refinement (m)). This widens the architecture's `{kind:'refuse'; contentType}`, which left the hook to decide status, headers and body. The content-type compare is exact (`includes`), so `application/json` without a charset, `charset=UTF-8` and `image/PNG` are refused. The `pass` arm's `headers` is a fresh object every call (`{...DOCS_RESPONSE_HEADERS}`); the L0 table is never written. `cache-control: no-store` is added when the status is not 200 or the route set none (the spec hook's own condition), so a 200 raster keeps the route's `cacheControlFor` value and every failure, the gate's 401 and 403 included, is `no-store`.
7. **`DOCS_JSON_CONTENT_TYPE` is a new export**: the refusal answers in it, and a row pins that it is one of `DOCS_ALLOWED_CONTENT_TYPES`, so the refusal can never itself be refused. W3's JSON routes may read it.

**Measured while planning** (the shared scratch tree with Tasks 1-3 applied, then a separate copy for the mutations; none is a deviation):
1. **RED is 73 new cases** (lane constants 2, `laneAdmit` 9, `showRawBound` 5, `showWire` 8, `LISTING_JOB` 1, `docsShowPlan` 6 + 1 class-cap + 1 source pin, M6.4's client-size row 1, `cacheControlFor` 13, `docsSendPolicy` 26). The functions fail with `TypeError: <name> is not a function`; the constant rows fail on `undefined` and the two source pins on a missing line. Tasks 2-3's 232 cases stay green. GREEN is `305 passed (305)`.
2. **No `single-definition` pin sees the new code**: no W1 name is redeclared (the one-home pins for `DOCS_CLASS_CAP`, `DOCS_RESPONSE_HEADERS`, `DOCS_ALLOWED_CONTENT_TYPES`, `contentClass` still find only `shared/docs.ts`), and the CSP text is never spelled (`DOCS_RESPONSE_HEADERS` is spread): `399 passed (399)`, as after Task 3. Note for Task 8: `server/src/server.ts` (around line 3043, a non-docs route) already spells `'private, max-age=31536000, immutable'`, so a one-home pin for `DOCS_CACHE_IMMUTABLE` must be a declaration pin (`VALUE_DEF`), never a literal-spelling count.
3. **Environment-only reds, not this task's** (Tasks 1-3's notes): with a symlinked `pwa/node_modules`, `typecheck-tests`' `PWA_TSC really is pwa's own installed compiler` reds alone (`1 failed | 11 passed (12)` measured so); with no `origin/main`, `topology-clean` needs `CCRC_HISTORY_BASE=<base sha>` (measured green so).
4. **Mutations**, each measured red in a separate copy (`git archive HEAD | tar -x -C <copy>`, then `git -C <copy> init -q`, `server/node_modules` linked in), restored after each; the JSON block at the end carries them for Task 9. The architecture's seven rows are split one guard per row: its M4 (two mutations) is W2-T4-M4 and W2-T4-M5, its M5 is W2-T4-M7, its M6 is W2-T4-M14, its M7 (two mutations) is W2-T4-M16 and W2-T4-M18; the rest pin the boundaries and shapes the decisions above name.

| id | file | red |
|---|---|---|
| W2-T4-M1 | `server/src/docs/policy.ts` | server docs-policy: 1 failed \| 304 passed (305) |
| W2-T4-M2 | `server/src/docs/policy.ts` | server docs-policy: 1 failed \| 304 passed (305) |
| W2-T4-M3 | `server/src/docs/policy.ts` | server docs-policy: 1 failed \| 304 passed (305) |
| W2-T4-M4 | `server/src/docs/policy.ts` | server docs-policy: 1 failed \| 304 passed (305) |
| W2-T4-M5 | `server/src/docs/policy.ts` | server docs-policy: 1 failed \| 304 passed (305) |
| W2-T4-M6 | `server/src/docs/policy.ts` | server docs-policy: 1 failed \| 304 passed (305) |
| W2-T4-M7 | `server/src/docs/policy.ts` | server docs-policy: 5 failed \| 300 passed (305) |
| W2-T4-M8 | `server/src/docs/policy.ts` | server docs-policy: 2 failed \| 303 passed (305) |
| W2-T4-M9 | `server/src/docs/policy.ts` | server docs-policy: 11 failed \| 294 passed (305) |
| W2-T4-M10 | `server/src/docs/policy.ts` | server docs-policy: 1 failed \| 304 passed (305) |
| W2-T4-M11 | `server/src/docs/policy.ts` | server docs-policy: 1 failed \| 304 passed (305) |
| W2-T4-M12 | `server/src/docs/policy.ts` | server docs-policy: 3 failed \| 302 passed (305) |
| W2-T4-M13 | `server/src/docs/policy.ts` | server docs-policy: 1 failed \| 304 passed (305) |
| W2-T4-M14 | `server/src/docs/policy.ts` | server docs-policy: 1 failed \| 304 passed (305) |
| W2-T4-M15 | `server/src/docs/policy.ts` | server docs-policy: 5 failed \| 300 passed (305) |
| W2-T4-M16 | `server/src/docs/policy.ts` | server docs-policy: 3 failed \| 302 passed (305) |
| W2-T4-M17 | `server/src/docs/policy.ts` | server docs-policy: 2 failed \| 303 passed (305) |
| W2-T4-M18 | `server/src/docs/policy.ts` | server docs-policy: 11 failed \| 294 passed (305) |
| W2-T4-M19 | `server/src/docs/policy.ts` | server docs-policy: 1 failed \| 304 passed (305) |
| W2-T4-M20 | `server/src/docs/policy.ts` | server docs-policy: 1 failed \| 304 passed (305) |
| W2-T4-M21 | `server/src/docs/policy.ts` | server docs-policy: 13 failed \| 292 passed (305) |
| W2-T4-M22 | `server/src/docs/policy.ts` | server docs-policy: 12 failed \| 293 passed (305) |

- [ ] **Step 1: Write the failing tests.** Append the block below to the END of `server/test/docs-policy.test.ts`: find the end with `tail -n 3 server/test/docs-policy.test.ts` (it prints `    expect(docsProvenance(bag)).toStrictEqual({ ok: true });`, `  });` and `});`), leave one blank line after that final `});`, then paste the block exactly. Edit nothing above it. The block reuses Task 3's module-scope `form`, `COMMITTED_Q`, `COMMITTED_PIN`, `DRAFT_PIN` and `badQuery` and the top block's `readFileSync`, `path`, `fileURLToPath` and `parseDocsApiQuery` (Task 3's import); it imports no name a block above already imports (a second import of the same name is a duplicate-identifier compile error under `typecheck-tests`).

```ts
// ===== Task 4: read-lane admission, wire estimates, cache-control and the response-header verdict =====
// M6.1 (`laneAdmit`, section 6.3's four clauses), M6.4 (a wire estimate reads server facts only, section 6.2),
// section 6.6's browser-cache table (`cacheControlFor`) and section 5.3's onSend hook as an L1 verdict
// (`docsSendPolicy`, refinement (m)). The lane constants are refinement (l)'s; their derived inequalities
// (`showWire(class cap) <= DOCS_LANE_BYTES`, `DOCS_LANE_QUEUE >= DOCS_MAX_IMAGES_PER_PAGE + 2`) are Task 5's
// `docs-budget.test.ts`. Every expected number and string below is written out from the spec, never read back from
// `policy.ts`; the four L0 response headers are read from `shared/docs.ts`, their one home.
//
// Imports sit here for Task 3's reason: no line above this block moves.
import {
  DOCS_CACHE_IMMUTABLE, DOCS_CACHE_NO_STORE, DOCS_JSON_CONTENT_TYPE, DOCS_LANE_BYTES, DOCS_LANE_EXECS,
  DOCS_LANE_LARGE_RAW, DOCS_LANE_MAX_WAIT_MS, DOCS_LANE_QUEUE, LISTING_JOB, cacheControlFor, docsSendPolicy,
  docsShowPlan, laneAdmit, showRawBound, showWire,
  type DocsJob, type DocsSendVerdict, type LaneLoad,
} from '../src/docs/policy.js';
import {
  DOCS_ALLOWED_CONTENT_TYPES, DOCS_CLASS_CAP, DOCS_RESPONSE_HEADERS, type DocContentClass,
} from '../../shared/docs.js';

/** `policy.ts`'s text, for the two source pins below (a constant's own literal, the class-cap lookup). */
const T4_POLICY_SRC = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'docs', 'policy.ts'), 'utf8');

describe('the read-lane constants (refinement (l), section 6.3)', () => {
  it('each has the value the spec gives it', () => {
    expect(DOCS_LANE_EXECS).toBe(2);
    expect(DOCS_LANE_BYTES).toBe(3145728);
    expect(DOCS_LANE_LARGE_RAW).toBe(1048576);
    expect(DOCS_LANE_QUEUE).toBe(32);
    expect(DOCS_LANE_MAX_WAIT_MS).toBe(10000);
  });

  it('each is its own integer literal, never an alias of a neighbour that holds the same number', () => {
    // DOCS_LANE_LARGE_RAW equals DOCS_MAX_LISTING_WIRE_BYTES today; tying them would let a listing-bound change move
    // the lane's large-answer threshold (W1's rule for the caps in shared/docs.ts, section (B)).
    const lines = T4_POLICY_SRC.split('\n');
    for (const line of [
      'export const DOCS_LANE_EXECS = 2;',
      'export const DOCS_LANE_BYTES = 3145728;',
      'export const DOCS_LANE_LARGE_RAW = 1048576;',
      'export const DOCS_LANE_QUEUE = 32;',
      'export const DOCS_LANE_MAX_WAIT_MS = 10000;',
    ]) expect(lines, line).toContain(line);
  });
});

describe("laneAdmit (M6.1): section 6.3's four clauses, in order", () => {
  const load = (execs: number, bytes: number, large: number): LaneLoad => ({ execs, bytes, large });
  const job = (raw: number, wire: number): DocsJob => ({ raw, wire });

  it.each([
    ['an idle lane admits one job over the byte budget and over the large threshold', load(0, 0, 0),
      job(4194304, 5657944), true],
    ['one exec in flight admits a small job (the control for the next row)', load(1, 0, 0), job(1, 65540), true],
    ['execs at DOCS_LANE_EXECS refuse', load(2, 0, 0), job(1, 65540), false],
    ['execs past DOCS_LANE_EXECS refuse', load(3, 0, 0), job(1, 65540), false],
    ['bytes plus wire exactly at DOCS_LANE_BYTES admit', load(1, 3145728 - 65540, 0), job(1, 65540), true],
    ['bytes plus wire one byte over DOCS_LANE_BYTES refuse', load(1, 3145728 - 65539, 0), job(1, 65540), false],
    ['a second answer over 1 MiB refuses', load(1, 0, 1), job(1048577, 1463640), false],
    ['an answer of exactly 1 MiB beside a large one admits (over, not at)', load(1, 0, 1), job(1048576, 1463640), true],
    ['a large answer with no large one running admits', load(1, 0, 0), job(1048577, 1463640), true],
  ] as const)('%s', (_what, l, j, want) => {
    expect(laneAdmit(l, j)).toBe(want);
  });
});

describe('wire estimates read server facts only (M6.4, section 6.2)', () => {
  it.each([
    ['an unknown size is the class cap', 2097152, undefined, 2097152],
    ['a listed size lowers it', 2097152, 100, 100],
    ['a listed size of 0 is a fact, not an unknown', 2097152, 0, 0],
    ['a listed size over the cap never raises it', 2097152, 5000000, 2097152],
    ['a listed size equal to the cap is the cap', 2097152, 2097152, 2097152],
  ] as const)('showRawBound: %s', (_what, cap, size, want) => {
    expect(showRawBound(cap, size)).toBe(want);
  });

  it.each([
    [0, 65536], [1, 65540], [3, 65540], [4, 65544], [1000, 66872], [1048576, 1463640], [2097152, 2861740],
    [4194304, 5657944],
  ] as const)('showWire(%i) = %i: 4 * ceil(raw / 3) plus the 64 KiB envelope', (raw, wire) => {
    expect(showWire(raw)).toBe(wire);
  });

  it('LISTING_JOB is the framed listing bound on both sides, and frozen: one shared object, never a caller\'s', () => {
    expect(LISTING_JOB).toStrictEqual({ raw: 1048576, wire: 1048576 });
    expect(Object.isFrozen(LISTING_JOB)).toBe(true);
  });

  it.each([
    ['a.md', undefined, { cls: 'markdown', maxBytes: 2097152, job: { raw: 2097152, wire: 2861740 } }],
    ['a.png', 1000, { cls: 'raster', maxBytes: 2097152, job: { raw: 1000, wire: 66872 } }],
    ['dir/b.svg', 5000000, { cls: 'svg', maxBytes: 2097152, job: { raw: 2097152, wire: 2861740 } }],
    ['a.html', 0, { cls: 'html', maxBytes: 2097152, job: { raw: 0, wire: 65536 } }],
    ['a.json', 3, { cls: 'text', maxBytes: 2097152, job: { raw: 3, wire: 65540 } }],
    ['a.pdf', undefined, { cls: 'other', maxBytes: 2097152, job: { raw: 2097152, wire: 2861740 } }],
  ] as const)('docsShowPlan(%j, %j)', (p, size, want) => {
    expect(docsShowPlan(p, size)).toStrictEqual(want);
  });

  it("docsShowPlan's --max-bytes is the path's class cap, for every class", () => {
    const byClass: readonly (readonly [string, DocContentClass])[] = [
      ['a.md', 'markdown'], ['a.png', 'raster'], ['a.svg', 'svg'], ['a.html', 'html'], ['a.txt', 'text'],
      ['a.pdf', 'other'],
    ];
    for (const [p, cls] of byClass) expect(docsShowPlan(p, undefined).maxBytes, p).toBe(DOCS_CLASS_CAP[cls]);
  });

  it('reads the cap through DOCS_CLASS_CAP[cls]: the class caps are equal today, so no value tells them apart', () => {
    expect(T4_POLICY_SRC.split('\n')).toContain('  const maxBytes = DOCS_CLASS_CAP[cls];');
  });

  it('a size sent by the client never reaches an estimate: the query refuses it, and a parsed pin carries none', () => {
    expect(parseDocsApiQuery('file', form(`${COMMITTED_Q}&size=1`))).toStrictEqual(badQuery('unknown', 'size'));
    expect(parseDocsApiQuery('file', form(`${COMMITTED_Q}&maxBytes=1`))).toStrictEqual(badQuery('unknown', 'maxBytes'));
    const parsed = parseDocsApiQuery('file', form(COMMITTED_Q));
    if (!parsed.ok || parsed.req.route !== 'file') throw new Error('the complete committed pin did not parse');
    expect(Object.keys(parsed.req.pin).sort()).toEqual(['commit', 'kind', 'path', 'section', 'servedRef']);
    expect(docsShowPlan(parsed.req.pin.path, undefined).job).toStrictEqual({ raw: 2097152, wire: 2861740 });
  });
});

describe("cacheControlFor (section 6.6, section 5.2): immutable only for a committed pin's raster", () => {
  it('the two values are the spec strings', () => {
    expect(DOCS_CACHE_IMMUTABLE).toBe('private, max-age=31536000, immutable');
    expect(DOCS_CACHE_NO_STORE).toBe('no-store');
  });

  it.each([
    ['committed', 'raster', 'private, max-age=31536000, immutable'],
    ['committed', 'markdown', 'no-store'],
    ['committed', 'svg', 'no-store'],
    ['committed', 'html', 'no-store'],
    ['committed', 'text', 'no-store'],
    ['committed', 'other', 'no-store'],
    ['draft', 'raster', 'no-store'],
    ['draft', 'markdown', 'no-store'],
    ['draft', 'svg', 'no-store'],
    ['draft', 'html', 'no-store'],
    ['draft', 'text', 'no-store'],
    ['draft', 'other', 'no-store'],
  ] as const)('a %s pin of class %s: %s', (kind, cls, want) => {
    expect(cacheControlFor(kind === 'committed' ? COMMITTED_PIN : DRAFT_PIN, cls)).toBe(want);
  });
});

describe("docsSendPolicy (section 5.3's onSend hook as an L1 verdict, refinement (m))", () => {
  const H: Readonly<Record<string, string>> = DOCS_RESPONSE_HEADERS;
  const NO_STORE = { ...H, 'cache-control': 'no-store' };
  const IMMUTABLE = 'private, max-age=31536000, immutable';
  const JSON_CT = 'application/json; charset=utf-8';

  it('the JSON content type is the spec string, and an allowed one (the refusal answers in it)', () => {
    expect(DOCS_JSON_CONTENT_TYPE).toBe('application/json; charset=utf-8');
    expect(DOCS_ALLOWED_CONTENT_TYPES).toContain(DOCS_JSON_CONTENT_TYPE);
  });

  it.each([
    ['a 200 JSON answer with no cache-control gets no-store', 200, JSON_CT, undefined, NO_STORE],
    ['a 200 JSON answer whose route set no-store keeps it (no override)', 200, JSON_CT, 'no-store', H],
    ['a 200 committed PNG keeps its immutable header', 200, 'image/png', IMMUTABLE, H],
    ['a 200 JPEG keeps its header', 200, 'image/jpeg', IMMUTABLE, H],
    ['a 200 GIF keeps its header', 200, 'image/gif', IMMUTABLE, H],
    ['a 200 WebP keeps its header', 200, 'image/webp', IMMUTABLE, H],
    ['a 200 PNG with no cache-control gets no-store', 200, 'image/png', undefined, NO_STORE],
    ['a 404 failure is no-store even when immutable was set', 404, JSON_CT, IMMUTABLE, NO_STORE],
    ["the gate's 401 gets no-store", 401, JSON_CT, undefined, NO_STORE],
    ['a 403 foreign-request gets no-store over a set value', 403, JSON_CT, 'no-store', NO_STORE],
    ['a 503 docs-busy gets no-store', 503, JSON_CT, undefined, NO_STORE],
    ['any status but 200 is no-store: a 206 PNG', 206, 'image/png', IMMUTABLE, NO_STORE],
  ] as const)('%s', (_what, status, ct, cc, headers) => {
    expect(docsSendPolicy(status, ct, cc)).toStrictEqual({ kind: 'pass', headers });
  });

  const refused = (contentType: string): DocsSendVerdict => ({
    kind: 'refuse',
    status: 500,
    headers: { ...H, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    remove: ['content-length', 'content-disposition'],
    body: { ok: false, failure: 'response-type-refused' },
    contentType,
  });

  it.each([
    'text/html', 'text/html; charset=utf-8', 'image/svg+xml', 'application/xml', 'text/xml', 'text/plain',
    'application/octet-stream', 'application/json', 'application/json; charset=UTF-8', 'image/PNG', '',
  ])('content type %j is refused: 500 response-type-refused, whatever the status', (ct) => {
    expect(docsSendPolicy(200, ct, undefined)).toStrictEqual(refused(ct));
    expect(docsSendPolicy(404, ct, IMMUTABLE)).toStrictEqual(refused(ct));
  });

  it('a refused content type is carried cut to 80 characters, the length the log line quotes', () => {
    expect(docsSendPolicy(200, 'x'.repeat(200), undefined)).toStrictEqual(refused('x'.repeat(80)));
  });

  it('never writes into the L0 table, and answers a fresh header object each time', () => {
    const a = docsSendPolicy(404, JSON_CT, undefined);
    const b = docsSendPolicy(404, JSON_CT, undefined);
    expect(Object.keys(DOCS_RESPONSE_HEADERS).sort()).toEqual([
      'content-security-policy', 'cross-origin-resource-policy', 'referrer-policy', 'x-content-type-options',
    ]);
    if (a.kind !== 'pass' || b.kind !== 'pass') throw new Error('a JSON 404 was refused');
    expect(a.headers).not.toBe(b.headers);
    expect(a.headers).not.toBe(DOCS_RESPONSE_HEADERS);
  });
});
```

- [ ] **Step 2: Run them to verify they fail.** Foreground, Bash timeout 600000 ms.

Run: `( cd server && ./node_modules/.bin/vitest run test/docs-policy.test.ts )`
Expected: `Test Files  1 failed (1)`, `Tests  73 failed | 232 passed (305)`. The function rows fail with `TypeError: laneAdmit is not a function` (likewise `showRawBound`, `showWire`, `docsShowPlan`, `cacheControlFor`, `docsSendPolicy`); the constant rows fail on `undefined`; the two source pins fail on a missing line. Tasks 2-3's 232 cases stay green.

- [ ] **Step 3: Write the implementation.** Two edits to `server/src/docs/policy.ts`.

(a) Widen the one import statement, in place (Task 3's state: lines 11-17). Find:

```ts
import {
  DOCS_PIN_KEYS, DOCS_QUALIFIED_PREFIX_RE_BODY, DOCS_REQUEST_HEADER, DOCS_REQUEST_HEADER_VALUE, DOCS_RETRY_FLOOR_MS,
  DOCS_STALE_MS, isDocsBareRef, isDocsCommit, isDocsFingerprint, isDocsProject, isDocsQualifiedRef, isDocsRelPath,
  isDocsSection, parseDocsRef,
  type DocPin, type DocSectionSlug, type DocsFailure, type DocsFailureBody, type DocsRefSpec, type DocsTreeOk,
} from '../../../shared/docs.js';
```

Replace with:

```ts
import {
  DOCS_ALLOWED_CONTENT_TYPES, DOCS_CLASS_CAP, DOCS_ENVELOPE_RESERVE, DOCS_MAX_LISTING_WIRE_BYTES, DOCS_PIN_KEYS,
  DOCS_QUALIFIED_PREFIX_RE_BODY, DOCS_REQUEST_HEADER, DOCS_REQUEST_HEADER_VALUE, DOCS_RESPONSE_HEADERS,
  DOCS_RETRY_FLOOR_MS, DOCS_STALE_MS, contentClass, isDocsBareRef, isDocsCommit, isDocsFingerprint, isDocsProject,
  isDocsQualifiedRef, isDocsRelPath, isDocsSection, parseDocsRef,
  type DocContentClass, type DocPin, type DocSectionSlug, type DocsFailure, type DocsFailureBody, type DocsRefSpec,
  type DocsTreeOk,
} from '../../../shared/docs.js';
```

(b) Append the block below at the END of the file: find the end with `tail -n 3 server/src/docs/policy.ts` (it prints `docsProvenance`'s last two lines, `  return { ok: true };` and `}`), leave one blank line after that final `}`, then paste the block exactly.

```ts
// ===== The read lane and wire estimates (section 6.2, section 6.3; refinement (l); M6.1, M6.4) =====
//
// The lane itself (`lane.ts`, a per-node FIFO with its queue, wait and `docs-busy`) is W3's L4; it applies
// `laneAdmit` to its head job and decides nothing. Each constant is its OWN integer literal, never an alias of a
// neighbour that holds the same number (W1's rule for the caps): `DOCS_LANE_LARGE_RAW` equals
// `DOCS_MAX_LISTING_WIRE_BYTES` today, and tying them would let the listing bound move the large-answer threshold.
// The inequalities that tie them to the caps (`showWire(class cap) <= DOCS_LANE_BYTES`, the listing bound within it,
// `DOCS_LANE_QUEUE >= DOCS_MAX_IMAGES_PER_PAGE + 2`) are computed by `docs-budget.test.ts`.

/** The most docs execs in flight on one node's read lane (section 6.3). */
export const DOCS_LANE_EXECS = 2;
/** The most estimated framed answer bytes in flight on one read lane: 3 MiB, so any single show at a class cap
 *  (2 861 740 framed) fits alone, and head-of-line blocking stays near 252 ms at 100 Mbit (section 6.3). */
export const DOCS_LANE_BYTES = 3145728;
/** "At most one answer over 1 MiB": a job whose RAW estimate exceeds this is large (section 6.3). */
export const DOCS_LANE_LARGE_RAW = 1048576;
/** The most jobs queued behind a read lane; `docs-busy {lane:'read'}` past it (section 6.3). */
export const DOCS_LANE_QUEUE = 32;
/** The longest a queued read job waits for admission; `docs-busy {lane:'read'}` past it (section 6.3). */
export const DOCS_LANE_MAX_WAIT_MS = 10000;

/** One read job's estimate: `raw`, the most content bytes its answer can carry; `wire`, the most framed bytes the
 *  answer line can take on the link. */
export interface DocsJob { raw: number; wire: number }

/** A read lane's load at the moment its head job is considered: execs in flight, their summed `wire` estimates, and
 *  how many of them are large (`raw` over `DOCS_LANE_LARGE_RAW`). The lane keeps the counters; this only reads them. */
export interface LaneLoad { execs: number; bytes: number; large: number }

/**
 * Whether the read lane admits `job` now (section 6.3), its four clauses in order, the first that answers winning:
 * 1. an idle lane always admits one job, so a job larger than the budget still runs, alone;
 * 2. `DOCS_LANE_EXECS` execs in flight refuse;
 * 3. the summed wire estimate past `DOCS_LANE_BYTES` refuses (exactly at it admits);
 * 4. a second answer over `DOCS_LANE_LARGE_RAW` refuses (exactly at it is not large).
 * A refusal here is "not yet", never `docs-busy`: the lane keeps the job at the head of its FIFO (W3).
 */
export function laneAdmit(load: LaneLoad, job: DocsJob): boolean {
  if (load.execs === 0) return true;
  if (load.execs >= DOCS_LANE_EXECS) return false;
  if (load.bytes + job.wire > DOCS_LANE_BYTES) return false;
  if (job.raw > DOCS_LANE_LARGE_RAW && load.large > 0) return false;
  return true;
}

/**
 * The most content bytes a show can answer (section 6.2): the class cap, lowered by a size the server already holds.
 * `knownSize` is `undefined` when the server holds no size fact, one meaning; it comes from the listing map for a
 * committed pin or the `fp -> size` map for a draft (W3), NEVER from the request (M6.4: the query refuses `size` and
 * `maxBytes`). A listed size of 0 is a fact, so `??`, never `||`.
 */
export function showRawBound(classCap: number, knownSize: number | undefined): number {
  return Math.min(classCap, knownSize ?? classCap);
}

/** A show answer's framed bound for `raw` content bytes (section 6.1's encoding rule): base64's
 *  `4 * ceil(raw / 3)` plus `DOCS_ENVELOPE_RESERVE`. `showWire(2097152)` is 2 861 740. */
export function showWire(raw: number): number {
  return 4 * Math.ceil(raw / 3) + DOCS_ENVELOPE_RESERVE;
}

/** The estimate of every tree and index job: ccd's framed listing bound on both sides (section 6.2). Frozen, so
 *  no caller can change every other caller's estimate. */
export const LISTING_JOB: Readonly<DocsJob> =
  Object.freeze({ raw: DOCS_MAX_LISTING_WIRE_BYTES, wire: DOCS_MAX_LISTING_WIRE_BYTES });

/** A show's server-side plan: the path's class, the `--max-bytes` it sends ccd, and the lane job it books. */
export interface DocsShowPlan { cls: DocContentClass; maxBytes: number; job: DocsJob }

/**
 * Plan one show from server facts alone (section 5.2 steps 2-3, section 6.2): `cls` is `contentClass(path)`,
 * `maxBytes` is that class's cap (`docs-show --max-bytes`), and the job's `raw` is `showRawBound(maxBytes,
 * knownSize)`, its `wire` `showWire(raw)`. Takes no query: nothing a client sends can reach the estimate (M6.4).
 */
export function docsShowPlan(path: string, knownSize: number | undefined): DocsShowPlan {
  const cls = contentClass(path);
  const maxBytes = DOCS_CLASS_CAP[cls];
  const raw = showRawBound(maxBytes, knownSize);
  return { cls, maxBytes, job: { raw, wire: showWire(raw) } };
}

// ===== Browser cache and the response-header verdict (section 5.2, section 5.3, section 6.6; refinement (m)) =====

/** A committed raster's bytes are a pure function of `(commit, section, path)`, so the browser may keep them. */
export const DOCS_CACHE_IMMUTABLE = 'private, max-age=31536000, immutable';
/** Everything else: every JSON answer (its `onRef` and `from` are not a function of the URL), a draft, a failure. */
export const DOCS_CACHE_NO_STORE = 'no-store';
/** The one JSON content type a docs route sends, and the type a refused response is answered in. It is one of
 *  `DOCS_ALLOWED_CONTENT_TYPES` (pinned by `docs-policy.test.ts`). */
export const DOCS_JSON_CONTENT_TYPE = 'application/json; charset=utf-8';

/**
 * The `Cache-Control` of a 200 file answer (section 6.6): immutable only for a committed pin of class `raster`,
 * `no-store` for everything else. A non-200 is never asked: `docsSendPolicy` makes every failure `no-store`.
 */
export function cacheControlFor(pin: DocPin, cls: DocContentClass): string {
  return pin.kind === 'committed' && cls === 'raster' ? DOCS_CACHE_IMMUTABLE : DOCS_CACHE_NO_STORE;
}

/** The headers a refused response removes: no length of the refused payload, and never a `Content-Disposition`. */
const REFUSED_RESPONSE_REMOVES: readonly string[] = ['content-length', 'content-disposition'];
/** How much of a refused content type the verdict carries, for W3's log line. */
const REFUSED_TYPE_MAX_CHARS = 80;

/**
 * What W3's `onSend` hook does to a docs response (section 5.3), decided here so the hook decides nothing:
 * - `pass`: set every header in `headers` (a fresh object every call: `DOCS_RESPONSE_HEADERS`' four, plus
 *   `cache-control: no-store` when the status is not 200 or the route set no cache-control) and send the payload;
 * - `refuse`, for a content type outside `DOCS_ALLOWED_CONTENT_TYPES` (compared exactly): remove `remove`, answer
 *   `status` with `headers` and the JSON of `body`, and log `contentType` (cut to 80 characters).
 */
export type DocsSendVerdict =
  | { kind: 'pass'; headers: Readonly<Record<string, string>> }
  | {
    kind: 'refuse'; status: number; headers: Readonly<Record<string, string>>; remove: readonly string[];
    body: DocsFailureBody; contentType: string;
  };

/**
 * The response-header verdict over W1's headers table (section 5.3; refinement (m)). `contentType` is the reply's
 * content-type header as text (`''` when none was set); `cacheControl` is the reply's cache-control header, or
 * `undefined` when the route set none, one meaning. Never writes into the L0 table.
 */
export function docsSendPolicy(statusCode: number, contentType: string, cacheControl: string | undefined):
    DocsSendVerdict {
  if (!DOCS_ALLOWED_CONTENT_TYPES.includes(contentType)) {
    return {
      kind: 'refuse',
      status: DOCS_FAILURE_HTTP['response-type-refused'],
      headers: {
        ...DOCS_RESPONSE_HEADERS, 'content-type': DOCS_JSON_CONTENT_TYPE, 'cache-control': DOCS_CACHE_NO_STORE,
      },
      remove: REFUSED_RESPONSE_REMOVES,
      body: { ok: false, failure: 'response-type-refused' },
      contentType: contentType.slice(0, REFUSED_TYPE_MAX_CHARS),
    };
  }
  const headers: Record<string, string> = { ...DOCS_RESPONSE_HEADERS };
  if (statusCode !== 200 || cacheControl === undefined) headers['cache-control'] = DOCS_CACHE_NO_STORE;
  return { kind: 'pass', headers };
}
```

- [ ] **Step 4: Run them to verify they pass.** Foreground, Bash timeout 600000 ms.

Run: `( cd server && ./node_modules/.bin/vitest run test/docs-policy.test.ts )`
Expected: `Tests  305 passed (305)` (Tasks 2-3's 232; this task's 73). The purity describe stays green: the only import specifier is still `../../../shared/docs.js`, and the new code reads no clock, no `Buffer` and no `console`.

- [ ] **Step 5: The guard suites and the compiles.** Foreground, Bash timeout 600000 ms each; `typecheck-tests` is a known load flake, so a red there is re-run alone before it is called broken.

Run: `( cd server && node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit && node node_modules/typescript/bin/tsc -p test/tsconfig.tests.json --noEmit && echo TSC-OK )`
Expected: `TSC-OK`. The first compiles `policy.ts` under the server's build flags; the second compiles the new cases, including the `DocsSendVerdict`-typed refusal builder and the `as const` tables.

Run: `( cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts )`
Expected: `Tests  399 passed (399)` (Measured 2): the CSP-text pin and every W1 one-home pin (`DOCS_CLASS_CAP`, `DOCS_RESPONSE_HEADERS`, `DOCS_ALLOWED_CONTENT_TYPES`, `contentClass`) see no second copy.

Run: `( cd server && ./node_modules/.bin/vitest run test/docs-url.test.ts test/docs-shared.test.ts )`
Expected: `Test Files  2 passed (2)`, `Tests  337 passed (337)` (docs-url 98, docs-shared 239); W1's L0 is consumed, never amended.

Run: `( cd server && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts )`
Expected: `Tests  12 passed (12)`. With a symlinked `pwa/node_modules` only `PWA_TSC really is pwa's own installed compiler` reds (Measured 3); Task 1's Step 0 installs real modules.

Run: `( cd server && ./node_modules/.bin/vitest run test/topology-clean.test.ts test/capsupported.test.ts )`
Expected: `Test Files  2 passed (2)`, `Tests  76 passed (76)` (topology-clean 55, capsupported 21). `topology-clean` needs `origin/main` (Measured 3); this task adds no real host, project or account name, and spells no cap token.

No `ccd/ccd` edit, so no restamp.

- [ ] **Step 6: Commit.**

```bash
git add server/src/docs/policy.ts server/test/docs-policy.test.ts
git commit -m "server: docs L1 lane admission, wire estimates and response policy (docs W2)" \
  -m "laneAdmit (M6.1, section 6.3's four clauses verbatim) with the five read-lane constants, each its own literal; showRawBound, showWire, LISTING_JOB (frozen) and docsShowPlan (M6.4: the show's --max-bytes and lane job from the path's class cap and a server-held size only); cacheControlFor (section 6.6: immutable only for a committed raster); docsSendPolicy (section 5.3's onSend hook as an L1 verdict: the four L0 headers on a fresh object, no-store on every non-200 or unset cache-control, and a complete response-type-refused verdict for any content type outside DOCS_ALLOWED_CONTENT_TYPES)." \
  -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

**Mutation rows this task contributes** (each measured red in a separate copy, never in the worktree; `pkg` is the package the `tests` run in; `old` is unique in the file at this task's state):

```json
[
 {
  "id": "W2-T4-M1",
  "pkg": "server",
  "file": "server/src/docs/policy.ts",
  "old": "  if (load.execs === 0) return true;\n",
  "new": "",
  "tests": [
   "test/docs-policy.test.ts"
  ],
  "red": "server docs-policy: 1 failed | 304 passed (305) — an idle lane admits one job over the byte budget and over the large threshold"
 },
 {
  "id": "W2-T4-M2",
  "pkg": "server",
  "file": "server/src/docs/policy.ts",
  "old": "  if (load.execs >= DOCS_LANE_EXECS) return false;",
  "new": "  if (load.execs > DOCS_LANE_EXECS) return false;",
  "tests": [
   "test/docs-policy.test.ts"
  ],
  "red": "server docs-policy: 1 failed | 304 passed (305) — execs at DOCS_LANE_EXECS refuse"
 },
 {
  "id": "W2-T4-M3",
  "pkg": "server",
  "file": "server/src/docs/policy.ts",
  "old": "  if (load.bytes + job.wire > DOCS_LANE_BYTES) return false;",
  "new": "  if (load.bytes + job.wire >= DOCS_LANE_BYTES) return false;",
  "tests": [
   "test/docs-policy.test.ts"
  ],
  "red": "server docs-policy: 1 failed | 304 passed (305) — bytes plus wire exactly at DOCS_LANE_BYTES admit"
 },
 {
  "id": "W2-T4-M4",
  "pkg": "server",
  "file": "server/src/docs/policy.ts",
  "old": "  if (job.raw > DOCS_LANE_LARGE_RAW && load.large > 0) return false;",
  "new": "  if (job.raw > DOCS_LANE_LARGE_RAW) return false;",
  "tests": [
   "test/docs-policy.test.ts"
  ],
  "red": "server docs-policy: 1 failed | 304 passed (305) — a large answer with no large one running admits"
 },
 {
  "id": "W2-T4-M5",
  "pkg": "server",
  "file": "server/src/docs/policy.ts",
  "old": "  if (job.raw > DOCS_LANE_LARGE_RAW && load.large > 0) return false;\n",
  "new": "",
  "tests": [
   "test/docs-policy.test.ts"
  ],
  "red": "server docs-policy: 1 failed | 304 passed (305) — a second answer over 1 MiB refuses"
 },
 {
  "id": "W2-T4-M6",
  "pkg": "server",
  "file": "server/src/docs/policy.ts",
  "old": "  if (job.raw > DOCS_LANE_LARGE_RAW && load.large > 0) return false;",
  "new": "  if (job.raw >= DOCS_LANE_LARGE_RAW && load.large > 0) return false;",
  "tests": [
   "test/docs-policy.test.ts"
  ],
  "red": "server docs-policy: 1 failed | 304 passed (305) — an answer of exactly 1 MiB beside a large one admits (over, not at)"
 },
 {
  "id": "W2-T4-M7",
  "pkg": "server",
  "file": "server/src/docs/policy.ts",
  "old": "  return Math.min(classCap, knownSize ?? classCap);",
  "new": "  return classCap;",
  "tests": [
   "test/docs-policy.test.ts"
  ],
  "red": "server docs-policy: 5 failed | 300 passed (305) — showRawBound: a listed size lowers it; showRawBound: a listed size of 0 is a fact, not an unknown; docsShowPlan(\"a.png\", 1000); docsShowPlan(\"a.html\", 0); docsShowPlan(\"a.json\", 3)"
 },
 {
  "id": "W2-T4-M8",
  "pkg": "server",
  "file": "server/src/docs/policy.ts",
  "old": "  return Math.min(classCap, knownSize ?? classCap);",
  "new": "  return Math.min(classCap, knownSize || classCap);",
  "tests": [
   "test/docs-policy.test.ts"
  ],
  "red": "server docs-policy: 2 failed | 303 passed (305) — showRawBound: a listed size of 0 is a fact, not an unknown; docsShowPlan(\"a.html\", 0)"
 },
 {
  "id": "W2-T4-M9",
  "pkg": "server",
  "file": "server/src/docs/policy.ts",
  "old": "  return 4 * Math.ceil(raw / 3) + DOCS_ENVELOPE_RESERVE;",
  "new": "  return 4 * Math.floor(raw / 3) + DOCS_ENVELOPE_RESERVE;",
  "tests": [
   "test/docs-policy.test.ts"
  ],
  "red": "server docs-policy: 11 failed | 294 passed (305) — showWire(1) = 65540: 4 * ceil(raw / 3) plus the 64 KiB envelope; showWire(4) = 65544: 4 * ceil(raw / 3) plus the 64 KiB envelope; showWire(1000) = 66872: 4 * ceil(raw / 3) plus the 64 KiB envelope; showWire(1048576) = 1463640: 4 * ceil(raw / 3) plus the 64 KiB envelope; showWire(2097152) = 2861740: 4 * ceil(raw / 3) plus the 64 KiB envelope; showWire(4194304) = 5657944: 4 * ceil(raw / 3) plus the 64 KiB envelope; docsShowPlan(\"a.md\", undefined); docsShowPlan(\"a.png\", 1000); docsShowPlan(\"dir/b.svg\", 5000000); docsShowPlan(\"a.pdf\", undefined); a size sent by the client never reaches an estimate: the query refuses it, and a parsed pin carries none"
 },
 {
  "id": "W2-T4-M10",
  "pkg": "server",
  "file": "server/src/docs/policy.ts",
  "old": "  Object.freeze({ raw: DOCS_MAX_LISTING_WIRE_BYTES, wire: DOCS_MAX_LISTING_WIRE_BYTES });",
  "new": "  ({ raw: DOCS_MAX_LISTING_WIRE_BYTES, wire: DOCS_MAX_LISTING_WIRE_BYTES });",
  "tests": [
   "test/docs-policy.test.ts"
  ],
  "red": "server docs-policy: 1 failed | 304 passed (305) — LISTING_JOB is the framed listing bound on both sides, and frozen: one shared object, never a caller's"
 },
 {
  "id": "W2-T4-M11",
  "pkg": "server",
  "file": "server/src/docs/policy.ts",
  "old": "  const maxBytes = DOCS_CLASS_CAP[cls];",
  "new": "  const maxBytes = DOCS_CLASS_CAP.markdown;",
  "tests": [
   "test/docs-policy.test.ts"
  ],
  "red": "server docs-policy: 1 failed | 304 passed (305) — reads the cap through DOCS_CLASS_CAP[cls]: the class caps are equal today, so no value tells them apart"
 },
 {
  "id": "W2-T4-M12",
  "pkg": "server",
  "file": "server/src/docs/policy.ts",
  "old": "  const raw = showRawBound(maxBytes, knownSize);",
  "new": "  const raw = showRawBound(maxBytes, undefined);",
  "tests": [
   "test/docs-policy.test.ts"
  ],
  "red": "server docs-policy: 3 failed | 302 passed (305) — docsShowPlan(\"a.png\", 1000); docsShowPlan(\"a.html\", 0); docsShowPlan(\"a.json\", 3)"
 },
 {
  "id": "W2-T4-M13",
  "pkg": "server",
  "file": "server/src/docs/policy.ts",
  "old": "export const DOCS_LANE_LARGE_RAW = 1048576;",
  "new": "export const DOCS_LANE_LARGE_RAW = DOCS_MAX_LISTING_WIRE_BYTES;",
  "tests": [
   "test/docs-policy.test.ts"
  ],
  "red": "server docs-policy: 1 failed | 304 passed (305) — each is its own integer literal, never an alias of a neighbour that holds the same number"
 },
 {
  "id": "W2-T4-M14",
  "pkg": "server",
  "file": "server/src/docs/policy.ts",
  "old": "  return pin.kind === 'committed' && cls === 'raster' ? DOCS_CACHE_IMMUTABLE : DOCS_CACHE_NO_STORE;",
  "new": "  return cls === 'raster' ? DOCS_CACHE_IMMUTABLE : DOCS_CACHE_NO_STORE;",
  "tests": [
   "test/docs-policy.test.ts"
  ],
  "red": "server docs-policy: 1 failed | 304 passed (305) — a draft pin of class raster: no-store"
 },
 {
  "id": "W2-T4-M15",
  "pkg": "server",
  "file": "server/src/docs/policy.ts",
  "old": "  return pin.kind === 'committed' && cls === 'raster' ? DOCS_CACHE_IMMUTABLE : DOCS_CACHE_NO_STORE;",
  "new": "  return pin.kind === 'committed' ? DOCS_CACHE_IMMUTABLE : DOCS_CACHE_NO_STORE;",
  "tests": [
   "test/docs-policy.test.ts"
  ],
  "red": "server docs-policy: 5 failed | 300 passed (305) — a committed pin of class markdown: no-store; a committed pin of class svg: no-store; a committed pin of class html: no-store; a committed pin of class text: no-store; a committed pin of class other: no-store"
 },
 {
  "id": "W2-T4-M16",
  "pkg": "server",
  "file": "server/src/docs/policy.ts",
  "old": "  if (statusCode !== 200 || cacheControl === undefined) headers['cache-control'] = DOCS_CACHE_NO_STORE;",
  "new": "  if (cacheControl === undefined) headers['cache-control'] = DOCS_CACHE_NO_STORE;",
  "tests": [
   "test/docs-policy.test.ts"
  ],
  "red": "server docs-policy: 3 failed | 302 passed (305) — a 404 failure is no-store even when immutable was set; a 403 foreign-request gets no-store over a set value; any status but 200 is no-store: a 206 PNG"
 },
 {
  "id": "W2-T4-M17",
  "pkg": "server",
  "file": "server/src/docs/policy.ts",
  "old": "  if (statusCode !== 200 || cacheControl === undefined) headers['cache-control'] = DOCS_CACHE_NO_STORE;",
  "new": "  if (statusCode !== 200) headers['cache-control'] = DOCS_CACHE_NO_STORE;",
  "tests": [
   "test/docs-policy.test.ts"
  ],
  "red": "server docs-policy: 2 failed | 303 passed (305) — a 200 JSON answer with no cache-control gets no-store; a 200 PNG with no cache-control gets no-store"
 },
 {
  "id": "W2-T4-M18",
  "pkg": "server",
  "file": "server/src/docs/policy.ts",
  "old": "  if (!DOCS_ALLOWED_CONTENT_TYPES.includes(contentType)) {",
  "new": "  if (contentType === '') {",
  "tests": [
   "test/docs-policy.test.ts"
  ],
  "red": "server docs-policy: 11 failed | 294 passed (305) — content type \"text/html\" is refused: 500 response-type-refused, whatever the status; content type \"text/html; charset=utf-8\" is refused: 500 response-type-refused, whatever the status; content type \"image/svg+xml\" is refused: 500 response-type-refused, whatever the status; content type \"application/xml\" is refused: 500 response-type-refused, whatever the status; content type \"text/xml\" is refused: 500 response-type-refused, whatever the status; content type \"text/plain\" is refused: 500 response-type-refused, whatever the status; content type \"application/octet-stream\" is refused: 500 response-type-refused, whatever the status; content type \"application/json\" is refused: 500 response-type-refused, whatever the status; content type \"application/json; charset=UTF-8\" is refused: 500 response-type-refused, whatever the status; content type \"image/PNG\" is refused: 500 response-type-refused, whatever the status; a refused content type is carried cut to 80 characters, the length the log line quotes"
 },
 {
  "id": "W2-T4-M19",
  "pkg": "server",
  "file": "server/src/docs/policy.ts",
  "old": "  const headers: Record<string, string> = { ...DOCS_RESPONSE_HEADERS };",
  "new": "  const headers = DOCS_RESPONSE_HEADERS as unknown as Record<string, string>;",
  "tests": [
   "test/docs-policy.test.ts"
  ],
  "red": "server docs-policy: 1 failed | 304 passed (305) — never writes into the L0 table, and answers a fresh header object each time"
 },
 {
  "id": "W2-T4-M20",
  "pkg": "server",
  "file": "server/src/docs/policy.ts",
  "old": "      contentType: contentType.slice(0, REFUSED_TYPE_MAX_CHARS),",
  "new": "      contentType,",
  "tests": [
   "test/docs-policy.test.ts"
  ],
  "red": "server docs-policy: 1 failed | 304 passed (305) — a refused content type is carried cut to 80 characters, the length the log line quotes"
 },
 {
  "id": "W2-T4-M21",
  "pkg": "server",
  "file": "server/src/docs/policy.ts",
  "old": "export const DOCS_JSON_CONTENT_TYPE = 'application/json; charset=utf-8';",
  "new": "export const DOCS_JSON_CONTENT_TYPE = 'application/json';",
  "tests": [
   "test/docs-policy.test.ts"
  ],
  "red": "server docs-policy: 13 failed | 292 passed (305) — the JSON content type is the spec string, and an allowed one (the refusal answers in it); content type \"text/html\" is refused: 500 response-type-refused, whatever the status; content type \"text/html; charset=utf-8\" is refused: 500 response-type-refused, whatever the status; content type \"image/svg+xml\" is refused: 500 response-type-refused, whatever the status; content type \"application/xml\" is refused: 500 response-type-refused, whatever the status; content type \"text/xml\" is refused: 500 response-type-refused, whatever the status; content type \"text/plain\" is refused: 500 response-type-refused, whatever the status; content type \"application/octet-stream\" is refused: 500 response-type-refused, whatever the status; content type \"application/json\" is refused: 500 response-type-refused, whatever the status; content type \"application/json; charset=UTF-8\" is refused: 500 response-type-refused, whatever the status; content type \"image/PNG\" is refused: 500 response-type-refused, whatever the status; content type \"\" is refused: 500 response-type-refused, whatever the status; a refused content type is carried cut to 80 characters, the length the log line quotes"
 },
 {
  "id": "W2-T4-M22",
  "pkg": "server",
  "file": "server/src/docs/policy.ts",
  "old": "const REFUSED_RESPONSE_REMOVES: readonly string[] = ['content-length', 'content-disposition'];",
  "new": "const REFUSED_RESPONSE_REMOVES: readonly string[] = ['content-length'];",
  "tests": [
   "test/docs-policy.test.ts"
  ],
  "red": "server docs-policy: 12 failed | 293 passed (305) — content type \"text/html\" is refused: 500 response-type-refused, whatever the status; content type \"text/html; charset=utf-8\" is refused: 500 response-type-refused, whatever the status; content type \"image/svg+xml\" is refused: 500 response-type-refused, whatever the status; content type \"application/xml\" is refused: 500 response-type-refused, whatever the status; content type \"text/xml\" is refused: 500 response-type-refused, whatever the status; content type \"text/plain\" is refused: 500 response-type-refused, whatever the status; content type \"application/octet-stream\" is refused: 500 response-type-refused, whatever the status; content type \"application/json\" is refused: 500 response-type-refused, whatever the status; content type \"application/json; charset=UTF-8\" is refused: 500 response-type-refused, whatever the status; content type \"image/PNG\" is refused: 500 response-type-refused, whatever the status; content type \"\" is refused: 500 response-type-refused, whatever the status; a refused content type is carried cut to 80 characters, the length the log line quotes"
 }
]
```

---

---

### Task 5: Runner budgets and docs-budget.test.ts: four CCD_VERB_TIMEOUT_MS rows, the deadline invariant, the cap chains and the lane inequalities

**Model routing:** `sonnet`, effort `high` — text extraction in the `swap-timeout-budget.test.ts` shape, but every extractor must refuse zero and two matches (a budget test that passes on nothing is the failure this task exists to prevent), the expected numbers are hand-computed from the spec (5 657 944, 2 861 740, the 1 s show margin), and the 8 MiB literals must be found at their anchors, never by counting occurrences.

**Spec rows:** section 2 (j) row 47 (`remote-runner.test.ts` rows 20 000 / 20 000 / 15 000 / 60 000; `docs-budget.test.ts` extracts ccd's deadlines and asserts deadline + 2 + 5 < budget; it reads both `8 * 1024 * 1024` literals and asserts both cap chains; parity of `DOCS_MAX_FILE_BYTES`), section 6.10's M6.3 (the two derived inequalities of section 6.3, plus `DOCS_LANE_QUEUE >= DOCS_MAX_IMAGES_PER_PAGE + 2`), and section 7.10's M7.4 runner-budget clause ("the timeout default equals the runner budget"; W1 shipped the rest of M7.4). Section 2 (a)'s Budgets table is the source of the four numbers and the invariant; section 6.1's "ceiling chain" and "class-cap chain" are the source of 5 657 944 and 2 861 740.

**Files:**
- Modify: `server/src/remote/runner.ts` — four rows and one comment block appended INSIDE `CCD_VERB_TIMEOUT_MS`, after its last row `  swap: 300_000,` (line 122 at `049ddcc28`; no earlier W2 task touches this file) and before the map's closing `};`. The map is module-private and stays so; nothing new is exported.
- Modify: `server/test/remote-runner.test.ts` — four rows appended to `describe('per-verb timeouts')`'s `it.each` table, after `    [['enable', 'demo-quiet-basin'], 300_000],` (line 116 at `049ddcc28`) and before `  ])('sends %j with a %i ms budget', ...`.
- Create: `server/test/docs-budget.test.ts` (232 lines).
- Test: `server/test/docs-budget.test.ts`, `server/test/remote-runner.test.ts`; the two suites that also extract from `runner.ts`'s text, `server/test/pr-timeout-budget.test.ts` and `server/test/swap-timeout-budget.test.ts`; guards `server/test/typecheck-tests.test.ts`, `server/test/single-definition.test.ts`, `server/test/topology-clean.test.ts`, `server/test/capsupported.test.ts`, `server/test/ccdargv-brand.test.ts`, `server/test/exec.test.ts`.

The Find blocks below are quoted from the files as Task 4 left them and are unique in them; the line numbers are hints. If a Find block is absent or not unique, stop and put an ask to the coordinator.

`docs-budget.test.ts` reads `ccd/ccd`, `ccd/ccrc-doctor-checks`, `agent/src/server.ts`, `server/src/exec.ts` and `server/src/remote/runner.ts` as TEXT only. It runs no `ccd`, spawns no process, and needs no fixture HOME (`docsHelperSource()` reads `ccd/ccd` from the tree; it writes nothing).

**Interfaces:**
- Consumes, from W1's `server/test/docsHelperPy.ts`:
  - `export function docsHelperSource(ccdText?: string): string` — the `_docs_py` program between its two marker lines of `ccd/ccd`; throws unless each marker is exactly one line and a program sits between them.
  - `export function pyLiteral(src: string, name: string): string` — the text after `NAME=` on the helper's ONE unindented single-line binding of `name`; throws on any other count or spelling.
- Consumes, from `ccd/ccd`'s helper (text, read through `pyLiteral`): `HELPER_DEADLINE_S={'docs-index':12,'docs-tree':12,'docs-show':7,'docs-fetch':45}`, `KILL_GRACE_S=2`, `DOCS_MAX_FILE_BYTES=4194304`, `DOCS_MAX_ANSWER_BYTES=6291456`.
- Consumes, from `ccd/ccrc-doctor-checks` (text): the one line `: "${CCRC_DOCTOR_DOCS_TIMEOUT:=20}"`.
- Consumes, as anchored text: `agent/src/server.ts`'s `const EXEC_MAX_BUFFER = 8 * 1024 * 1024;` and the one `runExec` call `execFile(cmd, args, { maxBuffer: EXEC_MAX_BUFFER, timeout: timeoutMs }`; `server/src/exec.ts`'s `export const realRunner: Runner = (cmd, args) =>` declaration and its one `maxBuffer: 8 * 1024 * 1024`. Never a count of `8 * 1024 * 1024` across the tree: `server/src/localcaps.ts` (`MAX_BUFFER`) and `server/src/update/catalogue.ts` (`CATALOGUE_BODY_MAX_BYTES`) spell the same product for other things.
- Consumes, from Task 4 (`server/src/docs/policy.ts`): `export const DOCS_LANE_BYTES = 3145728;`, `export const DOCS_LANE_QUEUE = 32;`, `export function showWire(raw: number): number` (`4 * Math.ceil(raw / 3) + DOCS_ENVELOPE_RESERVE`).
- Consumes, from `shared/docs.ts` (W1; imported, never amended): `DOCS_MAX_FILE_BYTES = 4194304`, `DOCS_MAX_DOC_BYTES = 2097152`, `DOCS_MAX_IMAGE_BYTES = 2097152`, `DOCS_MAX_ANSWER_BYTES = 6291456`, `DOCS_MAX_LISTING_WIRE_BYTES = 1048576`, `DOCS_MAX_IMAGES_PER_PAGE = 30`.
- Produces, in `server/src/remote/runner.ts` (inside the module-private `const CCD_VERB_TIMEOUT_MS: Record<string, number>`; no export):
  - `'docs-index': 20_000,` `'docs-tree': 20_000,` `'docs-show': 15_000,` `'docs-fetch': 60_000,` — each a quoted key at line start, underscored digits, a trailing comma, so the first-match extractors of `docs-budget.test.ts` and `pr-timeout-budget.test.ts` read them. The comment above them never spells `'docs-<verb>': <digits>`.
  - Behaviour: `timeoutMsFor('ccd', ['docs-index', ...])` answers 20000 (likewise 20000, 15000, 60000) instead of the flat `CCD_TIMEOUT_MS` 90000; the remote runner sends that as the agent `exec` frame's `timeoutMs`.
- Produces, in `server/test/docs-budget.test.ts` (module-private, not exported, so no one-home pin is owed; no later task imports them): `DOCS_BUDGET_VERBS` (the four verbs, `as const`) and `type DocsBudgetVerb`; `exactlyOne(text: string, re: RegExp, what: string): RegExpMatchArray`; `runnerMsIn(src: string, verb: DocsBudgetVerb): number`; `helperDeadlinesIn(helperSrc: string): Record<DocsBudgetVerb, number>`; `pyIntIn(helperSrc: string, name: string): number`; `doctorDocsTimeoutSIn(src: string): number`; `productOf(expr: string, what: string): number`; `agentExecBufferIn(src: string): number`; `serverExecBufferIn(src: string): number`; `HEADROOM_S = 5`.

- [ ] **Step 1: Write the failing tests.** Two edits.

(a) In `server/test/remote-runner.test.ts` (lines 115-117 at `049ddcc28`), find:

```ts
    [['start', 'demo-quiet-basin'], 300_000],
    [['enable', 'demo-quiet-basin'], 300_000],
  ])('sends %j with a %i ms budget', async (args, ms) => {
```

Replace with:

```ts
    [['start', 'demo-quiet-basin'], 300_000],
    [['enable', 'demo-quiet-basin'], 300_000],
    // The four Docs verbs (spec 2026-10-01 section 2 (a), Budgets): each outlasts ccd's own helper deadline plus
    // its 2 s kill grace plus 5 s, which `docs-budget.test.ts` holds against ccd's source. Without these rows a
    // missing entry silently inherits the flat 90 s and nothing here reds.
    [['docs-index', '--all'], 20_000],
    [['docs-tree', '--project', 'x'], 20_000],
    [['docs-show', '--project', 'x', '--commit', 'c'], 15_000],
    [['docs-fetch', '--project', 'x'], 60_000],
  ])('sends %j with a %i ms budget', async (args, ms) => {
```

(b) Create `server/test/docs-budget.test.ts` with exactly this content:

```ts
/**
 * The Docs budgets and caps, pinned across the files that own their halves (spec 2026-10-01: section 2 (j) row 47,
 * section 6.10's M6.3, section 7.10's M7.4 runner-budget clause).
 *
 * Four relationships live in four different places, and no one of those places can import another's number:
 *   1. ccd's python helper bounds each docs verb itself (`HELPER_DEADLINE_S`, `KILL_GRACE_S`, in `ccd/ccd`), and the
 *      server's runner budget (`CCD_VERB_TIMEOUT_MS`, module-private in `server/src/remote/runner.ts`) must outlast
 *      it: helper deadline + 2 s grace + 5 s < runner budget, strictly. A budget at or under that sum lets the agent
 *      kill ccd while the helper is still waiting on git, and the agent's kill reaches only its direct child, so git's
 *      process group would be orphaned instead of reaped by the helper's own `killpg`.
 *   2. `ccrc doctor`'s `docs` check waits `CCRC_DOCTOR_DOCS_TIMEOUT` seconds (`ccd/ccrc-doctor-checks`), and that
 *      default equals the runner's docs-index budget, so doctor waits exactly as long as a Docs page would (M7.4).
 *   3. Every answer ccd will send fits both 8 MiB exec buffers (`EXEC_MAX_BUFFER` in `agent/src/server.ts`, the
 *      `maxBuffer` of `realRunner` in `server/src/exec.ts`): a cut stdout reads as code 1 (check 4's
 *      `answer-overflow`), so the chains are what keep that check unreachable.
 *   4. One show at a class cap, and one listing, each fit the read lane's byte budget alone, and the lane's queue
 *      holds one page of images plus the document and its tree (M6.3).
 *
 * Everything outside TypeScript is read as TEXT, never executed: no `ccd` runs here. Each extraction asserts that it
 * matched exactly once (the CONTROL describe at the end proves the extractors refuse zero and two), so a renamed or
 * doubled literal reds this file instead of letting it pass on nothing.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DOCS_MAX_ANSWER_BYTES, DOCS_MAX_DOC_BYTES, DOCS_MAX_FILE_BYTES, DOCS_MAX_IMAGE_BYTES, DOCS_MAX_IMAGES_PER_PAGE,
  DOCS_MAX_LISTING_WIRE_BYTES,
} from '../../shared/docs.js';
import { DOCS_LANE_BYTES, DOCS_LANE_QUEUE, showWire } from '../src/docs/policy.js';
import { docsHelperSource, pyLiteral } from './docsHelperPy.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..', '..');
const readRel = (rel: string): string => readFileSync(path.join(ROOT, rel), 'utf8');

const DOCS_BUDGET_VERBS = ['docs-index', 'docs-tree', 'docs-show', 'docs-fetch'] as const;
type DocsBudgetVerb = (typeof DOCS_BUDGET_VERBS)[number];

/** The one match of `re` (a `g` regex) in `text`; throws on zero or on more than one. */
function exactlyOne(text: string, re: RegExp, what: string): RegExpMatchArray {
  const hits = [...text.matchAll(re)];
  if (hits.length !== 1) throw new Error(`${what}: ${hits.length} matches; the contract is one`);
  return hits[0]!;
}

/** `CCD_VERB_TIMEOUT_MS['<verb>']` in ms, read from runner.ts's text: a quoted key at line start, underscored
 *  digits, a trailing comma (the shape `swap-timeout-budget.test.ts` reads). A commented-out row does not match. */
function runnerMsIn(src: string, verb: DocsBudgetVerb): number {
  const m = exactlyOne(src, new RegExp(`^[ \\t]*'${verb}':[ \\t]*([\\d_]+),`, 'gm'), `CCD_VERB_TIMEOUT_MS['${verb}']`);
  return Number(m[1]!.replace(/_/g, ''));
}

/** ccd's `HELPER_DEADLINE_S` dict literal, parsed. Throws unless it is `{'<verb>':<int>,...}` naming exactly the four
 *  docs verbs, each once. */
function helperDeadlinesIn(helperSrc: string): Record<DocsBudgetVerb, number> {
  const lit = pyLiteral(helperSrc, 'HELPER_DEADLINE_S');
  if (!/^\{'[a-z-]+':\d+(?:,'[a-z-]+':\d+)*\}$/.test(lit)) {
    throw new Error(`HELPER_DEADLINE_S: ${JSON.stringify(lit)} is not a one-line dict of integer seconds`);
  }
  const pairs = [...lit.matchAll(/'([a-z-]+)':(\d+)/g)].map((m) => [m[1]!, Number(m[2]!)] as const);
  const keys = pairs.map(([k]) => k).sort();
  if (keys.join(',') !== [...DOCS_BUDGET_VERBS].sort().join(',')) {
    throw new Error(`HELPER_DEADLINE_S names ${JSON.stringify(keys)}; the contract is exactly the four docs verbs`);
  }
  return Object.fromEntries(pairs) as Record<DocsBudgetVerb, number>;
}

/** A python integer binding of the helper (`NAME=<digits>`), as a number. */
function pyIntIn(helperSrc: string, name: string): number {
  const lit = pyLiteral(helperSrc, name);
  if (!/^\d+$/.test(lit)) throw new Error(`${name}: ${JSON.stringify(lit)} is not an integer literal`);
  return Number(lit);
}

/** The doctor's default wait for `ccd docs-index --all`, in seconds: its one `: "${CCRC_DOCTOR_DOCS_TIMEOUT:=N}"`
 *  line. Any second default-assignment of the knob, in any spelling, is refused first. */
function doctorDocsTimeoutSIn(src: string): number {
  exactlyOne(src, /CCRC_DOCTOR_DOCS_TIMEOUT:=/g, 'a default assignment of CCRC_DOCTOR_DOCS_TIMEOUT');
  const m = exactlyOne(src, /^: "\$\{CCRC_DOCTOR_DOCS_TIMEOUT:=(\d+)\}"$/gm, 'the CCRC_DOCTOR_DOCS_TIMEOUT default line');
  return Number(m[1]!);
}

/** A buffer size written as a product of integer literals (`8 * 1024 * 1024`), evaluated. Refuses anything else. */
function productOf(expr: string, what: string): number {
  if (!/^\d+(?: \* \d+)*$/.test(expr)) throw new Error(`${what}: ${JSON.stringify(expr)} is not a product of integer literals`);
  return expr.split(' * ').reduce((acc, f) => acc * Number(f), 1);
}

/** The agent's exec buffer: its one `const EXEC_MAX_BUFFER = ...;` line, and the one `runExec` call that uses it. */
function agentExecBufferIn(src: string): number {
  exactlyOne(src, /execFile\(cmd, args, \{ maxBuffer: EXEC_MAX_BUFFER, timeout: timeoutMs \}/g,
    "runExec's execFile with maxBuffer: EXEC_MAX_BUFFER");
  const m = exactlyOne(src, /^const EXEC_MAX_BUFFER = ([^;\n]+);$/gm, 'const EXEC_MAX_BUFFER');
  return productOf(m[1]!, 'EXEC_MAX_BUFFER');
}

/** local mode's buffer: the one `maxBuffer:` inside `realRunner`'s declaration, which ends at its first two-space
 *  `});` line. Anchored on the declaration, never on a count of the product: `localcaps.ts` and
 *  `update/catalogue.ts` spell the same `8 * 1024 * 1024` for other things. */
function serverExecBufferIn(src: string): number {
  const decl = exactlyOne(src, /^export const realRunner: Runner = [\s\S]*?^ {2}\}\);$/gm, 'the realRunner declaration');
  const m = exactlyOne(decl[0], /maxBuffer: ([^,}\n]+?) ?[,}]/g, "realRunner's maxBuffer");
  return productOf(m[1]!, "realRunner's maxBuffer");
}

const runnerSrc = (): string => readRel('server/src/remote/runner.ts');
const runnerMs = (verb: DocsBudgetVerb): number => runnerMsIn(runnerSrc(), verb);
const helperSrc = (): string => docsHelperSource();
/** The 2 s grace and the 5 s headroom of spec section 2 (a)'s invariant; the grace is ccd's `KILL_GRACE_S`. */
const HEADROOM_S = 5;

describe('docs runner budgets outlast the helper (row 47, spec section 2 (a) Budgets)', () => {
  it('the four CCD_VERB_TIMEOUT_MS rows are 20 000 / 20 000 / 15 000 / 60 000 ms', () => {
    expect(DOCS_BUDGET_VERBS.map((v) => [v, runnerMs(v)])).toEqual([
      ['docs-index', 20_000], ['docs-tree', 20_000], ['docs-show', 15_000], ['docs-fetch', 60_000],
    ]);
  });

  it('the helper deadline table names exactly the four docs verbs, and the grace is a whole-second integer', () => {
    const deadlines = helperDeadlinesIn(helperSrc());
    expect(Object.keys(deadlines).sort()).toEqual([...DOCS_BUDGET_VERBS].sort());
    expect(Number.isInteger(pyIntIn(helperSrc(), 'KILL_GRACE_S'))).toBe(true);
  });

  it.each(DOCS_BUDGET_VERBS)('%s: helper deadline + KILL_GRACE_S + 5 s < the runner budget, strictly', (verb) => {
    const deadlineS = helperDeadlinesIn(helperSrc())[verb];
    const graceS = pyIntIn(helperSrc(), 'KILL_GRACE_S');
    expect(
      deadlineS + graceS + HEADROOM_S,
      `${verb}: the agent may kill ccd before the helper's own killpg reaches git; raise the runner row or lower `
      + 'the helper deadline, never the reverse of what the spec states',
    ).toBeLessThan(runnerMs(verb) / 1000);
  });

  it('docs-show has the thinnest margin, exactly 1 s (15 - (7 + 2 + 5)): a change to either side is read here', () => {
    const margin = runnerMs('docs-show') / 1000
      - (helperDeadlinesIn(helperSrc())['docs-show'] + pyIntIn(helperSrc(), 'KILL_GRACE_S') + HEADROOM_S);
    expect(margin).toBe(1);
  });
});

describe('the doctor waits exactly as long as a Docs page (M7.4, the runner-budget clause)', () => {
  it("CCRC_DOCTOR_DOCS_TIMEOUT's default equals CCD_VERB_TIMEOUT_MS['docs-index'] / 1000", () => {
    const doctorS = doctorDocsTimeoutSIn(readRel('ccd/ccrc-doctor-checks'));
    expect(doctorS).toBe(runnerMs('docs-index') / 1000);
    expect(doctorS).toBe(20);
  });
});

describe('no answer ccd will send can be cut by an exec buffer (row 47, the cap chains)', () => {
  const agentBuf = (): number => agentExecBufferIn(readRel('agent/src/server.ts'));
  const serverBuf = (): number => serverExecBufferIn(readRel('server/src/exec.ts'));

  it('both 8 * 1024 * 1024 literals are found at their anchors and are 8 388 608', () => {
    expect(agentBuf()).toBe(8_388_608);
    expect(serverBuf()).toBe(8_388_608);
  });

  it('the ceiling chain: showWire(DOCS_MAX_FILE_BYTES) = 5 657 944 <= DOCS_MAX_ANSWER_BYTES < each buffer', () => {
    expect(showWire(DOCS_MAX_FILE_BYTES)).toBe(5_657_944);
    expect(showWire(DOCS_MAX_FILE_BYTES)).toBeLessThanOrEqual(DOCS_MAX_ANSWER_BYTES);
    expect(DOCS_MAX_ANSWER_BYTES).toBeLessThan(agentBuf());
    expect(DOCS_MAX_ANSWER_BYTES).toBeLessThan(serverBuf());
  });

  it('the listing chain: DOCS_MAX_LISTING_WIRE_BYTES < each buffer', () => {
    expect(DOCS_MAX_LISTING_WIRE_BYTES).toBeLessThan(agentBuf());
    expect(DOCS_MAX_LISTING_WIRE_BYTES).toBeLessThan(serverBuf());
  });

  it("parity: ccd's DOCS_MAX_FILE_BYTES and DOCS_MAX_ANSWER_BYTES are shared/docs.ts's", () => {
    expect(pyIntIn(helperSrc(), 'DOCS_MAX_FILE_BYTES')).toBe(DOCS_MAX_FILE_BYTES);
    expect(pyIntIn(helperSrc(), 'DOCS_MAX_ANSWER_BYTES')).toBe(DOCS_MAX_ANSWER_BYTES);
  });
});

describe('derived inequalities (M6.3, spec section 6.3)', () => {
  it('any single show at a class cap fits the read lane alone: showWire(2 097 152) = 2 861 740 <= DOCS_LANE_BYTES', () => {
    const classMax = Math.max(DOCS_MAX_DOC_BYTES, DOCS_MAX_IMAGE_BYTES);
    expect(showWire(classMax)).toBe(2_861_740);
    expect(showWire(classMax)).toBeLessThanOrEqual(DOCS_LANE_BYTES);
  });

  it('any single listing fits the read lane alone: DOCS_MAX_LISTING_WIRE_BYTES <= DOCS_LANE_BYTES', () => {
    expect(DOCS_MAX_LISTING_WIRE_BYTES).toBeLessThanOrEqual(DOCS_LANE_BYTES);
  });

  it("the read queue holds one page's images plus the document and its tree: DOCS_LANE_QUEUE >= DOCS_MAX_IMAGES_PER_PAGE + 2", () => {
    expect(DOCS_LANE_QUEUE).toBeGreaterThanOrEqual(DOCS_MAX_IMAGES_PER_PAGE + 2);
  });
});

describe('CONTROL: each extractor refuses zero and two, so no case above can pass on nothing', () => {
  it('runnerMsIn: a missing row, a doubled row and a commented-out row', () => {
    expect(() => runnerMsIn("  'docs-tree': 20_000,\n", 'docs-show')).toThrow(/0 matches/);
    expect(() => runnerMsIn("  'docs-show': 15_000,\n  'docs-show': 15_000,\n", 'docs-show')).toThrow(/2 matches/);
    expect(() => runnerMsIn("  // 'docs-show': 15_000,\n", 'docs-show')).toThrow(/0 matches/);
    expect(runnerMsIn("  'docs-show': 15_000,\n", 'docs-show')).toBe(15_000);
  });

  it('helperDeadlinesIn: a missing verb, an extra key, a non-integer and a second binding', () => {
    const ok = "HELPER_DEADLINE_S={'docs-index':12,'docs-tree':12,'docs-show':7,'docs-fetch':45}\n";
    expect(helperDeadlinesIn(ok)).toEqual({ 'docs-index': 12, 'docs-tree': 12, 'docs-show': 7, 'docs-fetch': 45 });
    expect(() => helperDeadlinesIn("HELPER_DEADLINE_S={'docs-index':12,'docs-tree':12,'docs-show':7}\n"))
      .toThrow(/exactly the four docs verbs/);
    expect(() => helperDeadlinesIn(ok.replace('}', ",'docs-x':1}"))).toThrow(/exactly the four docs verbs/);
    expect(() => helperDeadlinesIn(ok.replace(':7,', ':7.5,'))).toThrow(/integer seconds/);
    expect(() => helperDeadlinesIn(`${ok}HELPER_DEADLINE_S={}\n`)).toThrow(/bound 2 times/);
  });

  it('doctorDocsTimeoutSIn: a missing default and a second default-assignment', () => {
    const line = ': "${CCRC_DOCTOR_DOCS_TIMEOUT:=20}"\n';
    expect(doctorDocsTimeoutSIn(line)).toBe(20);
    expect(() => doctorDocsTimeoutSIn('')).toThrow(/0 matches/);
    expect(() => doctorDocsTimeoutSIn(`${line}x="\${CCRC_DOCTOR_DOCS_TIMEOUT:=30}"\n`)).toThrow(/2 matches/);
  });

  it('the buffer readers: a non-literal product, a second realRunner, and a runExec not using the constant', () => {
    expect(() => productOf('8 * 1024 * size', 'x')).toThrow(/product of integer literals/);
    const runner = 'export const realRunner: Runner = (cmd, args) =>\n'
      + '  new Promise((resolve) => {\n    execFile(cmd, args, { maxBuffer: 8 * 1024 * 1024 }, () => {});\n  });\n';
    expect(serverExecBufferIn(runner)).toBe(8_388_608);
    expect(() => serverExecBufferIn(`${runner}${runner}`)).toThrow(/2 matches/);
    const agent = 'const EXEC_MAX_BUFFER = 8 * 1024 * 1024;\n'
      + 'execFile(cmd, args, { maxBuffer: EXEC_MAX_BUFFER, timeout: timeoutMs }, cb);\n';
    expect(agentExecBufferIn(agent)).toBe(8_388_608);
    expect(() => agentExecBufferIn(agent.replace('maxBuffer: EXEC_MAX_BUFFER', 'maxBuffer: 1024')))
      .toThrow(/0 matches/);
  });
});
```

- [ ] **Step 2: Run them to verify they fail.** Foreground, Bash timeout 600000 ms.

Run: `( cd server && ./node_modules/.bin/vitest run test/docs-budget.test.ts )`
Expected: `Test Files  1 failed (1)`, `Tests  7 failed | 12 passed (19)`. The seven reds are every case that reads a runner row (the four-rows case, the four invariant rows, the show margin, the doctor equality), each failing with `Error: CCD_VERB_TIMEOUT_MS['docs-index']: 0 matches; the contract is one` (or the verb it reads first). The twelve greens are the cap chains, the parity, M6.3 and the four CONTROL cases: they guard values W1 and Task 4 already hold, so they cannot be red before this task's code; their bite is measured by mutation rows W2-T5-M7 to W2-T5-M14 below, not by this step.

Run: `( cd server && ./node_modules/.bin/vitest run test/remote-runner.test.ts )`
Expected: `Test Files  1 failed (1)`, `Tests  4 failed | 23 passed (27)`; each new row fails with `AssertionError: expected 90000 to be 20000` (likewise 15000, 60000): without a row the verb inherits the flat 90 s.

- [ ] **Step 3: Write the implementation.** One edit to `server/src/remote/runner.ts` (lines 121-123 at `049ddcc28`). Find:

```ts
  // needs a ccd-side bound and is not this row's job.
  swap: 300_000,
};
```

Replace with:

```ts
  // needs a ccd-side bound and is not this row's job.
  swap: 300_000,
  // The four Docs verbs (spec 2026-10-01 section 2 (a), Budgets). ccd's python helper bounds each one itself: a
  // whole-verb deadline (`HELPER_DEADLINE_S` in ccd/ccd: index 12 s, tree 12 s, show 7 s, fetch 45 s), at which it
  // sends SIGTERM to every git process group it started and SIGKILL `KILL_GRACE_S` (2 s) later. Each budget below
  // is strictly greater than that deadline + the 2 s grace + 5 s; `docs-budget.test.ts` reads both sides from
  // source and holds the inequality, and docs-show's margin is the thinnest (exactly 1 s).
  //
  // Why the margin must stay positive: these budgets exist so the AGENT never kills ccd in normal operation. The
  // agent's deadline (`runExec`'s `execFile` timeout) kills only its direct child, so a kill landing while the
  // helper still waits on git would orphan git's process group (`git-remote-https`, ssh, `git-lfs`) rather than
  // let the helper's own `killpg` reap it. The helper's deadline must always fire first. Without these rows a
  // docs verb silently inherits the flat 90 s.
  //
  // The docs-index budget is also doctor's wait: ccd/ccrc-doctor-checks defaults `CCRC_DOCTOR_DOCS_TIMEOUT` to it
  // in seconds, so doctor waits exactly as long as a Docs page would; `docs-budget.test.ts` holds the two equal.
  'docs-index': 20_000,
  'docs-tree': 20_000,
  'docs-show': 15_000,
  'docs-fetch': 60_000,
};
```

This is W2's lever on the inherited SEC-3 finding (W1's ledger: an externally killed helper orphans git's process group): the invariant is pinned so the agent's kill never lands first in normal operation. The helper-side signal trap and an agent-side group kill remain outside W2.

- [ ] **Step 4: Run them to verify they pass.** Foreground, Bash timeout 600000 ms each.

Run: `( cd server && ./node_modules/.bin/vitest run test/docs-budget.test.ts )`
Expected: `Tests  19 passed (19)`.

Run: `( cd server && ./node_modules/.bin/vitest run test/remote-runner.test.ts )`
Expected: `Tests  27 passed (27)` (the base's 23 plus this task's 4).

Run: `( cd server && ./node_modules/.bin/vitest run test/pr-timeout-budget.test.ts test/swap-timeout-budget.test.ts )`
Expected: `Test Files  2 passed (2)`, `Tests  5 passed (5)`. Both read `runner.ts`'s text with a first-match regex for their own verb (`'pr-state'`, `swap`); the new comment spells neither, and the new rows sit below both.

- [ ] **Step 5: The guard suites and the compiles.** Foreground, Bash timeout 600000 ms each; `typecheck-tests` is a known load flake, so a red there is re-run alone before it is called broken.

Run: `( cd server && node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit && node node_modules/typescript/bin/tsc -p test/tsconfig.tests.json --noEmit && echo TSC-OK )`
Expected: `TSC-OK`. The second compiles `docs-budget.test.ts`, including `Record<DocsBudgetVerb, number>` indexing and its imports from `policy.ts` and `shared/docs.ts`.

Run: `( cd server && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts )`
Expected: `Tests  12 passed (12)`. With a symlinked `pwa/node_modules` only `PWA_TSC really is pwa's own installed compiler` reds (Task 1's Measured 5); Task 1's Step 0 installs real modules.

Run: `( cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts test/topology-clean.test.ts test/capsupported.test.ts test/ccdargv-brand.test.ts test/exec.test.ts )`
Expected: `Test Files  5 passed (5)`, `Tests  509 passed (509)` (single-definition 399, topology-clean 55, capsupported 21, ccdargv-brand 13, exec 21). `topology-clean` needs `origin/main` (Task 1's Measured 5): without it only `resolved a base to measure against — a missing one is RED, never vacuous` reds. This task adds no real host, project, account or pool name (fixtures are `x`, `c`, `demo`), spells no cap token, and declares nothing in `server/src` that a one-home pin reads.

No `ccd/ccd` or `ccd/ccrc-doctor-checks` edit, so no restamp and no citation tax.

- [ ] **Step 6: Commit.**

```bash
git add server/src/remote/runner.ts server/test/remote-runner.test.ts server/test/docs-budget.test.ts
git commit -m "server: docs runner budgets and the budget invariants (docs W2)" \
  -m "Four CCD_VERB_TIMEOUT_MS rows (docs-index 20 s, docs-tree 20 s, docs-show 15 s, docs-fetch 60 s), so no docs verb inherits the flat 90 s. docs-budget.test.ts (row 47, M6.3, M7.4's runner-budget clause) reads ccd's HELPER_DEADLINE_S and KILL_GRACE_S, the doctor's CCRC_DOCTOR_DOCS_TIMEOUT default, and both 8 MiB exec buffers from source text at their anchors, and holds: deadline + grace + 5 s < budget for every verb (docs-show's 1 s margin exactly), the doctor's wait equal to the docs-index budget, the ceiling chain (showWire(DOCS_MAX_FILE_BYTES) = 5 657 944 <= DOCS_MAX_ANSWER_BYTES < each buffer), the listing chain, ccd/L0 parity of the two show caps, and section 6.3's lane inequalities. Every extractor refuses zero and two matches." \
  -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

**Mutation rows this task contributes** (each measured red in a separate copy, never in the worktree; `pkg` is the package the `tests` run in; `old` is unique in the file at this task's state; the three `ccd/` rows and the `agent/src/server.ts` row are scratch-copy-only by construction, since W2 never edits those files):

```json
[
 {
  "id": "W2-T5-M1",
  "pkg": "server",
  "file": "server/src/remote/runner.ts",
  "old": "  'docs-show': 15_000,",
  "new": "  'docs-show': 14_000,",
  "tests": [
   "test/docs-budget.test.ts",
   "test/remote-runner.test.ts"
  ],
  "red": "server docs-budget + remote-runner: Tests 4 failed | 42 passed (46) — sends [\"docs-show\",\"--project\",\"x\",\"--commit\",\"c\"] with a 15000 ms budget; the four CCD_VERB_TIMEOUT_MS rows are 20 000 / 20 000 / 15 000 / 60 000 ms; docs-show: helper deadline + KILL_GRACE_S + 5 s < the runner budget, strictly; docs-show has the thinnest margin, exactly 1 s (15 - (7 + 2 + 5)): a change to either side is read here"
 },
 {
  "id": "W2-T5-M2",
  "pkg": "server",
  "file": "server/src/remote/runner.ts",
  "old": "  'docs-fetch': 60_000,\n",
  "new": "",
  "tests": [
   "test/docs-budget.test.ts",
   "test/remote-runner.test.ts"
  ],
  "red": "server docs-budget + remote-runner: Tests 3 failed | 43 passed (46) — sends [\"docs-fetch\",\"--project\",\"x\"] with a 60000 ms budget; the four CCD_VERB_TIMEOUT_MS rows are 20 000 / 20 000 / 15 000 / 60 000 ms; docs-fetch: helper deadline + KILL_GRACE_S + 5 s < the runner budget, strictly"
 },
 {
  "id": "W2-T5-M3",
  "pkg": "server",
  "file": "server/src/remote/runner.ts",
  "old": "  'docs-index': 20_000,",
  "new": "  'docs-index': 25_000,",
  "tests": [
   "test/docs-budget.test.ts",
   "test/remote-runner.test.ts"
  ],
  "red": "server docs-budget + remote-runner: Tests 3 failed | 43 passed (46) — sends [\"docs-index\",\"--all\"] with a 20000 ms budget; the four CCD_VERB_TIMEOUT_MS rows are 20 000 / 20 000 / 15 000 / 60 000 ms; CCRC_DOCTOR_DOCS_TIMEOUT's default equals CCD_VERB_TIMEOUT_MS['docs-index'] / 1000"
 },
 {
  "id": "W2-T5-M4",
  "pkg": "server",
  "file": "ccd/ccd",
  "old": "HELPER_DEADLINE_S={'docs-index':12,'docs-tree':12,'docs-show':7,'docs-fetch':45}",
  "new": "HELPER_DEADLINE_S={'docs-index':12,'docs-tree':12,'docs-show':9,'docs-fetch':45}",
  "tests": [
   "test/docs-budget.test.ts"
  ],
  "red": "server docs-budget: Tests 2 failed | 17 passed (19) — docs-show: helper deadline + KILL_GRACE_S + 5 s < the runner budget, strictly; docs-show has the thinnest margin, exactly 1 s (15 - (7 + 2 + 5)): a change to either side is read here"
 },
 {
  "id": "W2-T5-M5",
  "pkg": "server",
  "file": "ccd/ccd",
  "old": "KILL_GRACE_S=2\n",
  "new": "KILL_GRACE_S=4\n",
  "tests": [
   "test/docs-budget.test.ts"
  ],
  "red": "server docs-budget: Tests 4 failed | 15 passed (19) — docs-index: helper deadline + KILL_GRACE_S + 5 s < the runner budget, strictly; docs-tree: helper deadline + KILL_GRACE_S + 5 s < the runner budget, strictly; docs-show: helper deadline + KILL_GRACE_S + 5 s < the runner budget, strictly; docs-show has the thinnest margin, exactly 1 s (15 - (7 + 2 + 5)): a change to either side is read here"
 },
 {
  "id": "W2-T5-M6",
  "pkg": "server",
  "file": "ccd/ccrc-doctor-checks",
  "old": ": \"${CCRC_DOCTOR_DOCS_TIMEOUT:=20}\"",
  "new": ": \"${CCRC_DOCTOR_DOCS_TIMEOUT:=25}\"",
  "tests": [
   "test/docs-budget.test.ts"
  ],
  "red": "server docs-budget: Tests 1 failed | 18 passed (19) — CCRC_DOCTOR_DOCS_TIMEOUT's default equals CCD_VERB_TIMEOUT_MS['docs-index'] / 1000"
 },
 {
  "id": "W2-T5-M7",
  "pkg": "server",
  "file": "agent/src/server.ts",
  "old": "const EXEC_MAX_BUFFER = 8 * 1024 * 1024;",
  "new": "const EXEC_MAX_BUFFER = 4 * 1024 * 1024;",
  "tests": [
   "test/docs-budget.test.ts"
  ],
  "red": "server docs-budget: Tests 2 failed | 17 passed (19) — both 8 * 1024 * 1024 literals are found at their anchors and are 8 388 608; the ceiling chain: showWire(DOCS_MAX_FILE_BYTES) = 5 657 944 <= DOCS_MAX_ANSWER_BYTES < each buffer"
 },
 {
  "id": "W2-T5-M8",
  "pkg": "server",
  "file": "server/src/exec.ts",
  "old": "    execFile(cmd, args, { maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {",
  "new": "    execFile(cmd, args, { maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {",
  "tests": [
   "test/docs-budget.test.ts"
  ],
  "red": "server docs-budget: Tests 2 failed | 17 passed (19) — both 8 * 1024 * 1024 literals are found at their anchors and are 8 388 608; the ceiling chain: showWire(DOCS_MAX_FILE_BYTES) = 5 657 944 <= DOCS_MAX_ANSWER_BYTES < each buffer"
 },
 {
  "id": "W2-T5-M9",
  "pkg": "server",
  "file": "ccd/ccd",
  "old": "DOCS_MAX_FILE_BYTES=4194304\n",
  "new": "DOCS_MAX_FILE_BYTES=4194305\n",
  "tests": [
   "test/docs-budget.test.ts"
  ],
  "red": "server docs-budget: Tests 1 failed | 18 passed (19) — parity: ccd's DOCS_MAX_FILE_BYTES and DOCS_MAX_ANSWER_BYTES are shared/docs.ts's"
 },
 {
  "id": "W2-T5-M10",
  "pkg": "server",
  "file": "shared/docs.ts",
  "old": "export const DOCS_MAX_ANSWER_BYTES = 6291456;",
  "new": "export const DOCS_MAX_ANSWER_BYTES = 5000000;",
  "tests": [
   "test/docs-budget.test.ts"
  ],
  "red": "server docs-budget: Tests 2 failed | 17 passed (19) — the ceiling chain: showWire(DOCS_MAX_FILE_BYTES) = 5 657 944 <= DOCS_MAX_ANSWER_BYTES < each buffer; parity: ccd's DOCS_MAX_FILE_BYTES and DOCS_MAX_ANSWER_BYTES are shared/docs.ts's"
 },
 {
  "id": "W2-T5-M11",
  "pkg": "server",
  "file": "shared/docs.ts",
  "old": "export const DOCS_MAX_LISTING_WIRE_BYTES = 1048576;",
  "new": "export const DOCS_MAX_LISTING_WIRE_BYTES = 8388608;",
  "tests": [
   "test/docs-budget.test.ts"
  ],
  "red": "server docs-budget: Tests 2 failed | 17 passed (19) — the listing chain: DOCS_MAX_LISTING_WIRE_BYTES < each buffer; any single listing fits the read lane alone: DOCS_MAX_LISTING_WIRE_BYTES <= DOCS_LANE_BYTES"
 },
 {
  "id": "W2-T5-M12",
  "pkg": "server",
  "file": "server/src/docs/policy.ts",
  "old": "export const DOCS_LANE_QUEUE = 32;",
  "new": "export const DOCS_LANE_QUEUE = 31;",
  "tests": [
   "test/docs-budget.test.ts"
  ],
  "red": "server docs-budget: Tests 1 failed | 18 passed (19) — the read queue holds one page's images plus the document and its tree: DOCS_LANE_QUEUE >= DOCS_MAX_IMAGES_PER_PAGE + 2"
 },
 {
  "id": "W2-T5-M13",
  "pkg": "server",
  "file": "server/src/docs/policy.ts",
  "old": "export const DOCS_LANE_BYTES = 3145728;",
  "new": "export const DOCS_LANE_BYTES = 2000000;",
  "tests": [
   "test/docs-budget.test.ts"
  ],
  "red": "server docs-budget: Tests 1 failed | 18 passed (19) — any single show at a class cap fits the read lane alone: showWire(2 097 152) = 2 861 740 <= DOCS_LANE_BYTES"
 },
 {
  "id": "W2-T5-M14",
  "pkg": "server",
  "file": "shared/docs.ts",
  "old": "export const DOCS_MAX_IMAGE_BYTES = 2097152;",
  "new": "export const DOCS_MAX_IMAGE_BYTES = 2400000;",
  "tests": [
   "test/docs-budget.test.ts"
  ],
  "red": "server docs-budget: Tests 1 failed | 18 passed (19) — any single show at a class cap fits the read lane alone: showWire(2 097 152) = 2 861 740 <= DOCS_LANE_BYTES"
 }
]
```

---

### Task 6: Ports and the adapter gate: ports.ts, DOCS_CAP, ccdEnding, ccdsource.ts with the tri-state gate and checks 1-7

**Model routing:** `sonnet`, effort `high` — the traps are `verb-gate.test.ts`'s scope rule (the gate must sit, literally, in the nearest enclosing function of every `CCD_ARGV.docs*(` call, whose head is ONE line with a named return type and no generic) and the no-narrowing rule (every ccd word and context key carried verbatim, absent kept absent, `null` kept `null`); the recording runner, which counts execs, is the check.

**Spec rows:** section 2 (j) row 45 (the gate cases: `ccdVerbs` null, `[]`, a list without `caps`, `['caps']`, each with zero execs; `CAP_GATED_VERBS` holds every docs verb; `docs-v1` in `KNOWN_CAPABILITY_TOKENS` with `toContain(DOCS_CAP)`) with `DOCS_CAP` declared; section 7.10's M7.7 (a list without `caps` is unmeasured); the checks 1-7 half of row 46 (one case per `CcdResult` shape of section 2 (b)'s Server classification, the literal `'forbidden'` and `'timeout'` taken from their own source). Checks 8-9 and the second redaction pass are Task 7's. Section 7.1's skew table (C1, C3) is the source of the gate's three answers.

**Files:**
- Modify: `server/src/ccdargv.ts` — `DOCS_CAP` directly after `export const EXPIRE_CAP = 'expire-v1';` (line 802 at `049ddcc28`, 863 after Task 1), the last cap constant at the base.
- Modify: `server/src/lifecycle.ts` — `CcdEnding` and `ccdEnding` inserted above `cutShort`'s docstring (the docstring opens at line 42 at `049ddcc28`, unchanged by Tasks 1-5), and `cutShort`'s body re-expressed through it (lines 79-85). No other edit: `lifecycle.ts` is the one file outside W2's row list, chosen so that `killed`/`signal` keep a single reader (refinement (g)).
- Create: `server/src/docs/ports.ts` (62 lines), `server/src/docs/ccdsource.ts` (236 lines), `server/test/docs-source.test.ts` (342 lines).
- Test: `server/test/lifecycle.test.ts` — the import line (line 10) and one `describe` appended at EOF (after line 1039). Line count above line 1039 is unchanged, so `providers.test.ts`'s prose citation `lifecycle.test.ts:962-966` stays true.
- Test: `server/test/capsupported.test.ts` — the import (line 14) and one `it` at the end of `describe('capSupported')`, after the child-argv case (line 146).
- Test: `server/test/ccd-archive.test.ts` — the import (line 12) and one `toContain` after `toContain(EXPIRE_CAP)` (line 188).
- Test: `server/test/verb-gate.test.ts` — `CAP_GATED_VERBS` (line 95) and `NEW_GENERATION` (line 395).
- Test (run, not edited): `server/test/caps-token-shape.test.ts`, `server/test/whitelist-subset.test.ts`, `server/test/dispatch-adopt.test.ts` and `server/test/child-reclaim.test.ts` (the two `cutShort` consumers); guards `typecheck-tests`, `single-definition`, `topology-clean`, `ccdargv-brand`, `exec`, `docs-policy`, `docs-shared`, `docs-parity`.

Every Find block below is quoted from the file as Task 5 left it and is unique in it; the line numbers are hints (Tasks 1-5 touch none of these test files and, of these sources, only `ccdargv.ts`). If a Find block is absent or not unique, stop and put an ask to the coordinator.

**Interfaces:**
- Consumes:
  - `server/src/lifecycle.ts`: `export interface CcdResult { ok: boolean; stdout: string; stderr: string; killed: boolean | Unmeasured; signal: string | null | Unmeasured }`; `export type CcdRunner = (argv: CcdArgv) => Promise<CcdResult>`; `export const ccdRunner = (run: Runner, cfg: CcrcConfig): CcdRunner`; `export function cutShort(r: CcdResult): boolean | Unmeasured`.
  - `server/src/exec.ts`: `export const UNMEASURED = 'unmeasured'`, `export type Unmeasured`, `export const realRunner: Runner` (`execFile` with `maxBuffer: 8 * 1024 * 1024`, no timeout; a cut stdout answers code 1 with `killed: false, signal: null`, measured by this task's real-runner case).
  - `server/src/ccdargv.ts`: `export function capSupported(state: Pick<FleetState, 'ccdVerbs'> | undefined, token: string): boolean` (false on a null list and on `undefined`); Task 1's builders `docsIndex(): CcdArgv`, `docsTree(project: string, ref: string | null): CcdArgv`, `docsShowCommitted(project: string, commit: string, servedRef: string, section: DocSectionSlug, path: string, maxBytes: number): CcdArgv`, `docsShowDraft(project: string, branch: string, head: string, section: DocSectionSlug, path: string, fp: string, maxBytes: number): CcdArgv`, `docsFetch(project: string, branch: string | null): CcdArgv` (all on `CCD_ARGV`).
  - `server/src/fleetstate.ts`: `FleetState` (`ccdVerbs: string[] | null`), type-only.
  - Task 4 (`server/src/docs/policy.ts`): `export interface DocsJob { raw: number; wire: number }`; `export function docsShowPlan(path: string, knownSize: number | undefined): DocsShowPlan` (the test builds its `DocsShowAsk` from it).
  - `shared/docs.ts` (W1, imported, never amended): `DOCS_CCD_FAILURES: readonly DocsFailure[]`, `redactDocsText(s: string): string`, `docsRefText(r: DocsRefSpec): string`, and the types `DocsFailure`, `DocsFailureBody`, `DocsVerb`, `DocsIndexOk`, `DocsTreeOk`, `DocsShowOk`, `DocsFetchOk`, `DocPin`, `DocsRefSpec`.
  - Source text, read by the test only: `agent/src/server.ts`'s one `if (!isExecAllowed(req.cmd, req.args)) { send(ws, fail(req.id, 'forbidden')); return; }` line; `server/src/remote/client.ts`'s request timer `const timer = setTimeout(() => { ... reject(new Error('timeout')); }, wait);`.
- Produces:
  - `server/src/ccdargv.ts`: `export const DOCS_CAP = 'docs-v1';` — the only quoted spelling of the token in `server/src`.
  - `server/src/lifecycle.ts`: `export type CcdEnding = { kind: 'unmeasured' } | { kind: 'deadline' } | { kind: 'signal'; signal: string } | { kind: 'exited' };` and `export function ccdEnding(r: CcdResult): CcdEnding` (`killed === true` -> `deadline`; `signal === UNMEASURED` -> `unmeasured`; a non-null signal -> `signal`; else `exited`). `cutShort` keeps its signature and every answer (`deadline`/`signal` -> `true`, `unmeasured` -> `UNMEASURED`, `exited` -> `false`).
  - `server/src/docs/ports.ts` (type-only): `export interface DocsNodeId { node: string }`; `export interface DocsSourceId { node: string; project: string }`; `export interface DocsShowAsk { maxBytes: number; job: DocsJob; listedBlob: string | null }`; `export type DocsIndexRead = { ok: true; answer: DocsIndexOk } | DocsFailureBody`; `export type DocsTreeRead = { ok: true; answer: DocsTreeOk } | DocsFailureBody`; `export type DocsShowRead = { ok: true; answer: DocsShowOk; bytes: Uint8Array } | DocsFailureBody`; `export type DocsFetchRun = { ok: true; answer: DocsFetchOk } | DocsFailureBody`; `export interface DocsReader { index(at: DocsNodeId): Promise<DocsIndexRead>; tree(src: DocsSourceId, ref: DocsRefSpec | null): Promise<DocsTreeRead>; show(src: DocsSourceId, pin: DocPin, ask: DocsShowAsk): Promise<DocsShowRead> }`; `export interface DocsFetcher { fetch(src: DocsSourceId, branch: string | null): Promise<DocsFetchRun> }`.
  - `server/src/docs/ccdsource.ts`, exported: `export interface CcdDocsDeps { runCcd: CcdRunner; fleetState: Pick<FleetState, 'ccdVerbs'> | undefined }`; `export function ccdDocsReader(deps: CcdDocsDeps): DocsReader`; `export function ccdDocsFetcher(deps: CcdDocsDeps): DocsFetcher`.
  - `server/src/docs/ccdsource.ts`, module-private (Task 7 extends these; nothing else imports them): `const AGENT_EXEC_REFUSAL = 'forbidden'`; `const LINK_WAIT_EXPIRED = 'timeout'`; `const STDERR_HEAD_BYTES = 512`; `const CCD_WORDS: ReadonlySet<string>`; `const ENVELOPE_ONLY_KEYS: ReadonlySet<string>` (`v`, `verb`, `elapsedMs`); `type DocsReadCall = { verb: 'docs-index' } | { verb: 'docs-tree'; project: string; ref: DocsRefSpec | null } | { verb: 'docs-show'; project: string; pin: DocPin; ask: DocsShowAsk }`; `type DocsRan = { ok: true; res: CcdResult } | DocsFailureBody`; `type DocsLine = { ok: true; line: Readonly<Record<string, unknown>> } | DocsFailureBody`; `function fail(failure: DocsFailure, context?: Omit<DocsFailureBody, 'ok' | 'failure'>): DocsFailureBody`; `function utf8Head(s: string, maxBytes: number): string`; `function stderrHeadOf(s: string): string` (redact, then cut: stderr's `cause` and `stderrHead`, and check 7's `word`); `async function readDocs(deps: CcdDocsDeps, call: DocsReadCall): Promise<DocsRan>` (the gate, then one `switch` over the four read argv shapes); `async function fetchDocs(deps: CcdDocsDeps, project: string, branch: string | null): Promise<DocsRan>` (the gate, then the one `CCD_ARGV.docsFetch(`); `function classify(verb: DocsVerb, res: CcdResult): DocsLine` (checks 1-5, then `parseLine`); `function parseLine(verb: DocsVerb, stdout: string): DocsLine` (checks 6-7); `function ccdFailureBody(line: Readonly<Record<string, unknown>>): DocsFailureBody`; `function decodeShowBytes(ans: DocsShowOk): { ok: true; bytes: Uint8Array } | DocsFailureBody`.
  - Behaviour: before any exec, a missing state, `ccdVerbs: null`, or a list without `caps` answers `{ok:false, failure:'caps-unknown'}`, and a list with `caps` but without `docs-v1` answers `{ok:false, failure:'unsupported'}`; then checks 1-7 in section 2 (b)'s order. `ccd-fault` carries `stderrHead` and never `code` (refinement (f)); `unknown-failure`'s `word` is redacted, then cut to 512 bytes (refinement (i)), so no untrusted string of unbounded length reaches a failure body.

**Two departures from the architecture's sketch, both minimal and recorded here.** (1) `readDocs` and `fetchDocs` answer `DocsRan` (the raw `CcdResult`, or the gate's body), not the classified union: each port method then calls `classify` with its own verb, so every method returns its own named type with no cast between union members, and the one cast left is the unavoidable one from parsed JSON to the verb's ok type (check 6 validates the envelope only). The gate and every `CCD_ARGV.docs*(` call still share one function each, which is all `verb-gate.test.ts` reads. (2) `classify` takes no `job` yet: nothing in checks 1-7 reads it, and Task 7 adds the parameter with check 9. And one addition: `decodeShowBytes` answers `malformed-answer {why:'schema'}` when `encoding` names a field the answer does not carry (or names neither encoding), instead of letting `Buffer.from(undefined)` throw, because the port's contract is that the promise rejects only on a defect. Its three rows are pinned here (W2-T6-M24, -M25); Task 7's check 8 builds on it and must not re-add them as red-first rows.

- [ ] **Step 1: Write the failing tests.** Five edits.

(a) `server/test/lifecycle.test.ts`, the import (line 10).

Find:

```ts
import { ccd, ccdRunner, cutShort, listProjects, type CcdResult } from '../src/lifecycle.js';
```

Replace with:

```ts
import { ccd, ccdEnding, ccdRunner, cutShort, listProjects, type CcdEnding, type CcdResult } from '../src/lifecycle.js';
```


Then append at the very end of the file (after its last line, `});`, line 1039):

```ts

describe('docs W2 — ccdEnding: the single reader of killed and signal, and cutShort read through it', () => {
  const r = (killed: CcdResult['killed'], signal: CcdResult['signal']): CcdResult =>
    ({ ok: false, stdout: '', stderr: '', killed, signal });
  const U = UNMEASURED;
  // Every (killed, signal) cell, killed in {true, false, UNMEASURED} by signal in {null, SIGKILL, SIGTERM, UNMEASURED}.
  // The UNMEASURED signal column is the token trap: `UNMEASURED` is a string, so a reader that tests the signal by
  // its javascript type reads the token as a signal name.
  const TABLE: readonly (readonly [CcdResult['killed'], CcdResult['signal'], CcdEnding])[] = [
    [true, null, { kind: 'deadline' }],
    [true, 'SIGKILL', { kind: 'deadline' }],
    [true, 'SIGTERM', { kind: 'deadline' }],
    [true, U, { kind: 'deadline' }],
    [false, null, { kind: 'exited' }],
    [false, 'SIGKILL', { kind: 'signal', signal: 'SIGKILL' }],
    [false, 'SIGTERM', { kind: 'signal', signal: 'SIGTERM' }],
    [false, U, { kind: 'unmeasured' }],
    [U, null, { kind: 'exited' }],
    [U, 'SIGKILL', { kind: 'signal', signal: 'SIGKILL' }],
    [U, 'SIGTERM', { kind: 'signal', signal: 'SIGTERM' }],
    [U, U, { kind: 'unmeasured' }],
  ];

  it.each(TABLE)('killed %s, signal %s ends as %j', (killed, signal, want) => {
    expect(ccdEnding(r(killed, signal))).toEqual(want);
  });

  it('cutShort answers what the ending says, cell for cell: deadline and signal adopt, unmeasured is UNMEASURED', () => {
    for (const [killed, signal, ending] of TABLE) {
      const want = ending.kind === 'unmeasured' ? UNMEASURED : ending.kind !== 'exited';
      expect(cutShort(r(killed, signal)), `killed ${String(killed)}, signal ${String(signal)}`).toBe(want);
    }
  });
});
```

(b) `server/test/capsupported.test.ts`, the import (line 14).

Find:

```ts
  ACTOR_FLAGS_CAP, CCD_ARGV, CHILD_ARGV_CAP, RECLAIM_CAP, RECLAIM_PAUSE_CAP, WIN_SIZE_CAP, capSupported, stopSurfaceSupported, verbSupported,
```

Replace with:

```ts
  ACTOR_FLAGS_CAP, CCD_ARGV, CHILD_ARGV_CAP, DOCS_CAP, RECLAIM_CAP, RECLAIM_PAUSE_CAP, WIN_SIZE_CAP, capSupported, stopSurfaceSupported, verbSupported,
```


And the end of `describe('capSupported')` (lines 146-148).

Find:

```ts
    expect(verbSupported(state(['ws-add']), ['ws-add', '--no-rc', '--child', '7', 'demo'])).toBe(true);
  });
});
```

Replace with:

```ts
    expect(verbSupported(state(['ws-add']), ['ws-add', '--no-rc', '--child', '7', 'demo'])).toBe(true);
  });

  it('spells the docs token exactly once in server/src, and reads it with the REFUSING default (docs W2)', () => {
    // The other two spellings: ccd's own `echo docs-v1` and `ccd-archive.test.ts`'s KNOWN_CAPABILITY_TOKENS, whose
    // `toContain(DOCS_CAP)` holds all three equal. The scan proves it is reading files by finding the one.
    expect(DOCS_CAP).toBe('docs-v1');
    expect(literalSpellings(DOCS_CAP)).toBe(1);
    // THE POLARITY: no evidence REFUSES, and a VERB's presence is not the TOKEN's presence. The docs adapter's gate
    // adds its own `caps` arm in front of this (`docs-source.test.ts`), because `capSupported` alone would fold
    // "nothing measured" into "too old".
    expect(capSupported(state(null), DOCS_CAP)).toBe(false);
    expect(capSupported(undefined, DOCS_CAP)).toBe(false);
    expect(capSupported(state(['docs-tree']), DOCS_CAP)).toBe(false);
    expect(capSupported(state([DOCS_CAP]), DOCS_CAP)).toBe(true);
    expect(verbSupported(state(null), ['docs-tree'])).toBe(true);
  });
});
```


(c) `server/test/ccd-archive.test.ts`, the import (line 12; the Find block is the line's first half, unique, and the rest of the line is unchanged).

Find:

```ts
import { ACCOUNT_POOLS_CAP, ACTOR_FLAGS_CAP, CHILD_ARGV_CAP, EXPIRE_CAP, POOLS_CAP,
```

Replace with:

```ts
import { ACCOUNT_POOLS_CAP, ACTOR_FLAGS_CAP, CHILD_ARGV_CAP, DOCS_CAP, EXPIRE_CAP, POOLS_CAP,
```


And after the `EXPIRE_CAP` pin (line 188).

Find:

```ts
    expect(KNOWN_CAPABILITY_TOKENS).toContain(EXPIRE_CAP);
```

Replace with:

```ts
    expect(KNOWN_CAPABILITY_TOKENS).toContain(EXPIRE_CAP);
    // The native Docs reader's token (docs W2): the third spelling of `docs-v1`, held equal to the constant the docs
    // adapter's gate reads (`capSupported`) and to ccd's own `echo docs-v1` (W1).
    expect(KNOWN_CAPABILITY_TOKENS).toContain(DOCS_CAP);
```


(d) `server/test/verb-gate.test.ts`, `CAP_GATED_VERBS` (lines 93-95).

Find:

```ts
 * argument above holds for each of them unchanged.
 */
const CAP_GATED_VERBS: ReadonlySet<string> = new Set(['route', 'ws-reclaim', 'reclaim-pause']);
```

Replace with:

```ts
 * argument above holds for each of them unchanged.
 *
 * The four Docs verbs (docs W2, spec 2026-10-01 section 2 (a)) argue it once more: a box that echoes `docs-v1`
 * dispatches all four at their final arity, so the token is the gate, and `capSupported` refuses on no evidence where
 * `verbSupported` would permit. Their two call-site functions (`docs/ccdsource.ts`'s `readDocs` and `fetchDocs`)
 * carry the token check behind a `caps` arm of their own, which this scan does not read: `docs-source.test.ts` pins
 * that arm by behaviour.
 */
const CAP_GATED_VERBS: ReadonlySet<string> = new Set([
  'route', 'ws-reclaim', 'reclaim-pause', 'docs-index', 'docs-tree', 'docs-show', 'docs-fetch',
]);
```


And `NEW_GENERATION` (lines 395-396; its odd indentation is the file's own and is kept).

Find:

```ts
const NEW_GENERATION = ['pr-state', 'pr-open', 'ws-archive', 'ws-restore', 'ws-audit', 'ws-reap', 'project-pool',
  'ws-reclaim'];
```

Replace with:

```ts
    // The four Docs verbs (docs W2) join for `ws-reclaim`'s reason: each is gated by `capSupported(DOCS_CAP)` in
    // CAP_GATED_VERBS above, and naming them here reds a vanished call site or a lost gate.
const NEW_GENERATION = ['pr-state', 'pr-open', 'ws-archive', 'ws-restore', 'ws-audit', 'ws-reap', 'project-pool',
  'ws-reclaim', 'docs-index', 'docs-tree', 'docs-show', 'docs-fetch'];
```


(e) Create `server/test/docs-source.test.ts` with exactly this content. The fixtures are placeholders only (`demo`, `ws/a`, `main`, `/w/a`, `'a'.repeat(40)`, `https://u:tok@example.invalid`). The three real-runner cases write a stub `#!/bin/sh` script into a fresh `mkTmp('docs-source-')` directory (cleaned by `tmpHelpers.ts`), or point at a path in it that does not exist; none of them is `ccd`.

```ts
/**
 * The Docs L3 adapter (`server/src/docs/ccdsource.ts`), driven through its two ports (spec 2026-10-01):
 * - section 2 (j) row 45 with section 7.10's M7.7: the tri-state cap gate, on EVERY port operation, each answer
 *   decided with zero execs;
 * - row 46: one case per `CcdResult` shape of section 2 (b)'s classification. Checks 1-7 are here; checks 8 and 9
 *   (show integrity and pins, the wire bound) and the second redaction pass are Task 7's cases, appended below;
 * - R14: the agent's refusal word and the client's timeout word are EXTRACTED from their own source and the adapter
 *   is driven with what was extracted, so a word renamed on either side reds this file.
 *
 * A recording `CcdRunner` double answers a scripted `CcdResult` and keeps every argv it was handed. No case runs
 * `ccd`: the three real-runner cases point `cfg.ccdBin` at a stub shell script in a `mkTmp` directory, or at a path
 * that does not exist.
 *
 * Inherited from W1's ledger, carried and not fixed here: MT-2 (ccd cuts stderr before it redacts, so the adapter
 * cannot recover a secret that cut split) and SEC-3 (an externally killed helper orphans git's process group; this
 * wave's lever is `docs-budget.test.ts`'s invariant).
 */
import { describe, it, expect } from 'vitest';
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOCS_CAP, type CcdArgv } from '../src/ccdargv.js';
import { ccdRunner, type CcdResult, type CcdRunner } from '../src/lifecycle.js';
import { UNMEASURED, realRunner } from '../src/exec.js';
import type { CcrcConfig } from '../src/config.js';
import { ccdDocsFetcher, ccdDocsReader, type CcdDocsDeps } from '../src/docs/ccdsource.js';
import { docsShowPlan } from '../src/docs/policy.js';
import type { DocsShowAsk } from '../src/docs/ports.js';
import type { DocPin, DocsFailureBody } from '../../shared/docs.js';
import { mkTmp } from './tmpHelpers.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const U = UNMEASURED;

/** A recording runner: every argv it is handed, and one scripted answer for all of them. */
function recorder(answer: CcdResult): { run: CcdRunner; calls: string[][] } {
  const calls: string[][] = [];
  return { calls, run: async (argv: CcdArgv) => { calls.push([...argv]); return answer; } };
}
/** A measured, clean exit unless a case says otherwise. */
const res = (over: Partial<CcdResult>): CcdResult =>
  ({ ok: true, stdout: '', stderr: '', killed: false, signal: null, ...over });
const state = (ccdVerbs: string[] | null): { ccdVerbs: string[] | null } => ({ ccdVerbs });
const READY = state(['caps', DOCS_CAP]);
/** One answer line as ccd writes it: one JSON text and one LF. */
const line = (o: Record<string, unknown>): string => `${JSON.stringify(o)}\n`;
const sha256 = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');

const SHA = 'a'.repeat(40);
const TEXT = '# a\n';
const TEXT_BYTES = Buffer.from(TEXT, 'utf8');
const COMMITTED: DocPin = { kind: 'committed', commit: SHA, servedRef: 'refs/remotes/origin/main', section: 'specs', path: 'a.md' };
const DRAFT_FP = sha256(TEXT_BYTES);
const DRAFT: DocPin = { kind: 'draft', branch: 'ws/a', head: SHA, section: 'specs', path: 'a.md', fp: DRAFT_FP };
const PLAN = docsShowPlan('a.md', undefined);
const ASK: DocsShowAsk = { maxBytes: PLAN.maxBytes, job: PLAN.job, listedBlob: null };
const SRC = { node: 'n', project: 'demo' };

/** A valid show answer for `pin`, its size and sha256 measured over `TEXT`'s bytes, every echo matching the pin. */
function showOk(pin: DocPin, over: Record<string, unknown> = {}): Record<string, unknown> {
  const common = {
    v: 1, verb: 'docs-show', ok: true, elapsedMs: 3, section: pin.section, path: pin.path,
    size: TEXT_BYTES.length, sha256: sha256(TEXT_BYTES), encoding: 'utf8', text: TEXT,
  };
  return pin.kind === 'committed'
    ? { ...common, source: 'committed', commit: pin.commit, blob: 'c'.repeat(40), mode: '100644', onRef: 'contains', ...over }
    : { ...common, source: 'draft', worktree: '/w/a', branch: pin.branch, head: pin.head, fp: pin.fp, ...over };
}
const TREE_OK = { v: 1, verb: 'docs-tree', ok: true, elapsedMs: 4, project: 'demo' };

type Answer = { ok: boolean };
/** Every port operation, with the exact argv its builder must send. */
const OPS: readonly { name: string; call: (d: CcdDocsDeps) => Promise<Answer>; argv: readonly string[] }[] = [
  { name: 'index', call: (d) => ccdDocsReader(d).index({ node: 'n' }), argv: ['docs-index', '--all'] },
  {
    name: 'tree', call: (d) => ccdDocsReader(d).tree(SRC, { kind: 'bare', name: 'main' }),
    argv: ['docs-tree', '--project', 'demo', '--ref', 'main'],
  },
  {
    name: 'show committed', call: (d) => ccdDocsReader(d).show(SRC, COMMITTED, ASK),
    argv: ['docs-show', '--project', 'demo', '--commit', SHA, '--ref', 'refs/remotes/origin/main', '--section', 'specs',
      '--path', 'a.md', '--max-bytes', String(PLAN.maxBytes)],
  },
  {
    name: 'show draft', call: (d) => ccdDocsReader(d).show(SRC, DRAFT, ASK),
    argv: ['docs-show', '--project', 'demo', '--draft-branch', 'ws/a', '--head', SHA, '--section', 'specs',
      '--path', 'a.md', '--fingerprint', DRAFT_FP, '--max-bytes', String(PLAN.maxBytes)],
  },
  { name: 'fetch', call: (d) => ccdDocsFetcher(d).fetch(SRC, 'main'), argv: ['docs-fetch', '--project', 'demo', '--branch', 'main'] },
];

/** One tree call through a recorder answering `answer`. */
async function treeWith(answer: CcdResult): Promise<Answer> {
  return ccdDocsReader({ runCcd: recorder(answer).run, fleetState: READY }).tree(SRC, null);
}

describe('the cap gate, before any exec (row 45, M7.7, spec section 2 (a) and section 7.1)', () => {
  const GATE: readonly (readonly [string, CcdDocsDeps['fleetState'], 'caps-unknown' | 'unsupported'])[] = [
    ['no fleet state at all', undefined, 'caps-unknown'],
    ['ccdVerbs null (not handshaken)', state(null), 'caps-unknown'],
    ["[] (the agent's failed boot read, seeded ?? [])", state([]), 'caps-unknown'],
    ["['x'] (a list that lacks caps measured nothing)", state(['x']), 'caps-unknown'],
    ["['caps'] (a measured pre-Docs ccd)", state(['caps']), 'unsupported'],
    ['the four verb names without docs-v1', state(['caps', 'docs-index', 'docs-tree', 'docs-show', 'docs-fetch']), 'unsupported'],
  ];
  const CASES = OPS.flatMap((op) => GATE.map(([label, fleetState, want]) => [op.name, label, want, op, fleetState] as const));

  it.each(CASES)('%s, %s: %s with zero execs', async (_name, _label, want, op, fleetState) => {
    const rec = recorder(res({ stdout: line(TREE_OK) }));
    expect(await op.call({ runCcd: rec.run, fleetState })).toEqual({ ok: false, failure: want });
    expect(rec.calls).toEqual([]);
  });

  it.each(OPS)('$name: with docs-v1 advertised, exactly one exec, with the builder\'s argv', async (op) => {
    const rec = recorder(res({ ok: false, stderr: 'usage' }));
    await op.call({ runCcd: rec.run, fleetState: READY });
    expect(rec.calls).toEqual([op.argv]);
  });

  it('the default-view tree sends no --ref, and the default-branch fetch no --branch', async () => {
    const rec = recorder(res({ ok: false, stderr: 'usage' }));
    await ccdDocsReader({ runCcd: rec.run, fleetState: READY }).tree(SRC, null);
    await ccdDocsFetcher({ runCcd: rec.run, fleetState: READY }).fetch(SRC, null);
    expect(rec.calls).toEqual([['docs-tree', '--project', 'demo'], ['docs-fetch', '--project', 'demo']]);
  });
});

/** The word the agent refuses an ungranted argv with: the `fail(req.id, '<w>')` on its one `isExecAllowed(` line. */
function agentRefusalWord(): string {
  const src = readFileSync(path.join(ROOT, 'agent/src/server.ts'), 'utf8');
  const words = src.split('\n').filter((l) => l.includes('isExecAllowed('))
    .flatMap((l) => [...l.matchAll(/fail\(req\.id, '([a-z-]+)'\)/g)].map((m) => m[1]!));
  expect(words, "agent/src/server.ts: one fail(req.id, '<w>') on the isExecAllowed( line").toHaveLength(1);
  return words[0]!;
}

/** The word the client's own request wait rejects with: the `reject(new Error('<w>'))` inside its one timer. */
function clientTimeoutWord(): string {
  const src = readFileSync(path.join(ROOT, 'server/src/remote/client.ts'), 'utf8');
  const words = [...src.matchAll(/const timer = setTimeout\(\(\) => \{[^}]*?reject\(new Error\('([a-z-]+)'\)\);/g)]
    .map((m) => m[1]!);
  expect(words, "server/src/remote/client.ts: one reject(new Error('<w>')) in the request timer").toHaveLength(1);
  return words[0]!;
}

describe('check 1: the transport catch, both halves unmeasured (row 46, R14)', () => {
  const transport = (stderr: string): CcdResult => ({ ok: false, stdout: '', stderr, killed: U, signal: U });

  it("the agent's own refusal word is not-granted, after exactly one exec (section 7.1, C3)", async () => {
    const rec = recorder(transport(agentRefusalWord()));
    expect(await ccdDocsReader({ runCcd: rec.run, fleetState: READY }).tree(SRC, null))
      .toEqual({ ok: false, failure: 'not-granted' });
    expect(rec.calls).toHaveLength(1);
  });

  it("the client's own wait word is link-timeout", async () => {
    expect(await treeWith(transport(clientTimeoutWord()))).toEqual({ ok: false, failure: 'link-timeout' });
  });

  it('any other transport message is link-failed, carrying it as cause', async () => {
    expect(await treeWith(transport('disconnected'))).toEqual({ ok: false, failure: 'link-failed', cause: 'disconnected' });
  });

  it('the cause is redacted', async () => {
    expect(await treeWith(transport('connect https://u:tok@example.invalid/x')))
      .toEqual({ ok: false, failure: 'link-failed', cause: 'connect https://***@example.invalid/x' });
  });

  it('an OK answer whose halves are unmeasured (an older agent) is parsed, not read as a transport failure', async () => {
    expect(await treeWith({ ok: true, stdout: line(TREE_OK), stderr: '', killed: U, signal: U }))
      .toEqual({ ok: true, answer: TREE_OK });
    expect(await treeWith({ ok: true, stdout: '', stderr: '', killed: U, signal: U }))
      .toEqual({ ok: false, failure: 'malformed-answer', why: 'parse' });
  });

  it('a NOT-ok answer with stdout and unmeasured halves is a cut answer, not a transport failure', async () => {
    expect(await treeWith({ ok: false, stdout: 'partial', stderr: '', killed: U, signal: U }))
      .toEqual({ ok: false, failure: 'answer-overflow' });
  });
});

describe('checks 2-5: how ccd ended (row 46)', () => {
  it('the runner deadline fired: ccd-timeout', async () => {
    expect(await treeWith(res({ ok: false, killed: true, signal: 'SIGTERM' }))).toEqual({ ok: false, failure: 'ccd-timeout' });
  });

  it('a measured signal without the deadline: ccd-killed {signal}', async () => {
    expect(await treeWith(res({ ok: false, killed: false, signal: 'SIGKILL' })))
      .toEqual({ ok: false, failure: 'ccd-killed', signal: 'SIGKILL' });
  });

  it('not ok with stdout (a cut answer): answer-overflow', async () => {
    expect(await treeWith(res({ ok: false, stdout: 'partial' }))).toEqual({ ok: false, failure: 'answer-overflow' });
  });

  it("not ok, empty stdout: ccd-fault {stderrHead}, and no code (CcdResult carries none)", async () => {
    const out = await treeWith(res({ ok: false, stderr: 'usage: ccd docs-tree --project P [--ref R]' }));
    expect(out).toEqual({ ok: false, failure: 'ccd-fault', stderrHead: 'usage: ccd docs-tree --project P [--ref R]' });
    expect(out).not.toHaveProperty('code');
  });

  it('stderrHead is at most 512 bytes, cut back to a UTF-8 boundary', async () => {
    const stderr = `${'x'.repeat(511)}€${'y'.repeat(3486)}`; // the euro sign's 3 bytes sit at offsets 511-513
    expect(Buffer.byteLength(stderr)).toBe(4000);
    const out = (await treeWith(res({ ok: false, stderr }))) as DocsFailureBody;
    expect(out.failure).toBe('ccd-fault');
    expect(out.stderrHead).toBe('x'.repeat(511));
    expect(Buffer.byteLength(out.stderrHead!)).toBeLessThanOrEqual(512);
  });

  it('stderr is redacted BEFORE it is cut, so a secret straddling the cut leaves no fragment', async () => {
    const stderr = `${'e'.repeat(500)} https://u:${'k'.repeat(40)}@example.invalid/x`;
    const out = (await treeWith(res({ ok: false, stderr }))) as DocsFailureBody;
    expect(out.stderrHead).toBe(`${'e'.repeat(500)} https://***`);
    expect(out.stderrHead).not.toContain('u:k');
  });
});

describe('check 6: exactly one JSON line, with the envelope (row 46)', () => {
  const ROWS: readonly (readonly [string, 'parse' | 'schema', string])[] = [
    ['an empty stdout', 'parse', ''],
    ['not JSON', 'parse', 'not json\n'],
    ['two lines', 'parse', line(TREE_OK) + line(TREE_OK)],
    ['no trailing LF', 'parse', JSON.stringify(TREE_OK)],
    ['a blank second line', 'parse', `${line(TREE_OK)} \n`],
    ['an array', 'schema', '[]\n'],
    ['JSON null', 'schema', 'null\n'],
    ['v 2', 'schema', line({ ...TREE_OK, v: 2 })],
    ["verb 'docs-show' answering a tree call", 'schema', line({ ...TREE_OK, verb: 'docs-show' })],
    ["ok 'yes' beside a ccd word", 'schema', line({ v: 1, verb: 'docs-tree', ok: 'yes', elapsedMs: 1, failure: 'git-failed' })],
    ['ok:false without a failure word', 'schema', line({ v: 1, verb: 'docs-tree', ok: false, elapsedMs: 1 })],
  ];

  it.each(ROWS)('%s: malformed-answer {why: %s}', async (_label, why, stdout) => {
    expect(await treeWith(res({ stdout }))).toEqual({ ok: false, failure: 'malformed-answer', why });
  });
});

describe('check 7 and the verbatim rebuild (row 46, refinement (j))', () => {
  const failLine = (verb: string, failure: string, ctx: Record<string, unknown> = {}): string =>
    line({ v: 1, verb, ok: false, elapsedMs: 9, failure, ...ctx });

  it('a word outside the vocabulary is unknown-failure {word}, never mapped onto a known word', async () => {
    expect(await treeWith(res({ stdout: failLine('docs-tree', 'no-such-word') })))
      .toEqual({ ok: false, failure: 'unknown-failure', word: 'no-such-word' });
  });

  it('a SERVER-only word sent by ccd is unknown-failure too', async () => {
    expect(await treeWith(res({ stdout: failLine('docs-tree', 'docs-busy', { lane: 'read' }) })))
      .toEqual({ ok: false, failure: 'unknown-failure', word: 'docs-busy' });
  });

  it('the word is redacted, then cut to 512 bytes: a 2 KiB word, and a secret straddling the cut', async () => {
    expect(await treeWith(res({ stdout: failLine('docs-tree', 'w'.repeat(2048)) })))
      .toEqual({ ok: false, failure: 'unknown-failure', word: 'w'.repeat(512) });
    const straddling = `${'w'.repeat(500)} https://u:${'k'.repeat(40)}@example.invalid/x`;
    expect(await treeWith(res({ stdout: failLine('docs-tree', straddling) })))
      .toEqual({ ok: false, failure: 'unknown-failure', word: `${'w'.repeat(500)} https://***` });
  });

  it('a ccd word keeps exactly its line, minus v, verb and elapsedMs', async () => {
    const ctx = { detail: 'no such ref', tried: [{ ref: 'refs/heads/b', result: 'absent' }], suggest: 'main' };
    expect(await treeWith(res({ stdout: failLine('docs-tree', 'unresolved-ref', ctx) })))
      .toEqual({ ok: false, failure: 'unresolved-ref', ...ctx });
  });

  it.each([
    ['absent (unmeasured)', {}],
    ['null (the lock already went)', { lockAgeMs: null }],
    ['a number (its age)', { lockAgeMs: 1200 }],
  ] as const)('ref-locked with lockAgeMs %s keeps that state (D-4158)', async (_label, ctx) => {
    const rec = recorder(res({ stdout: failLine('docs-fetch', 'ref-locked', ctx) }));
    const out = await ccdDocsFetcher({ runCcd: rec.run, fleetState: READY }).fetch(SRC, null);
    expect(out).toStrictEqual({ ok: false, failure: 'ref-locked', ...ctx });
  });

  it('linked-worktree with branch null keeps null (contract F4: detached OR unmeasured)', async () => {
    expect(await treeWith(res({ stdout: failLine('docs-tree', 'linked-worktree', { owner: '/w/a', branch: null }) })))
      .toStrictEqual({ ok: false, failure: 'linked-worktree', owner: '/w/a', branch: null });
  });

  it('an ok index keeps unwalked absent when ccd sent none, and 3 when it sent 3 (D-4157)', async () => {
    const index = { v: 1, verb: 'docs-index', ok: true, elapsedMs: 5, unlisted: 0, duplicates: [], projects: [] };
    const indexWith = async (stdout: string): Promise<Answer> =>
      ccdDocsReader({ runCcd: recorder(res({ stdout })).run, fleetState: READY }).index({ node: 'n' });
    expect(await indexWith(line(index))).toStrictEqual({ ok: true, answer: index });
    expect(await indexWith(line({ ...index, unwalked: 3 }))).toStrictEqual({ ok: true, answer: { ...index, unwalked: 3 } });
  });
});

describe('show: the answer and its decoded bytes (integrity, pins and size are Task 7\'s)', () => {
  const showWith = async (pin: DocPin, answer: Record<string, unknown>): Promise<Answer> =>
    ccdDocsReader({ runCcd: recorder(res({ stdout: line(answer) })).run, fleetState: READY }).show(SRC, pin, ASK);

  it('a committed utf8 answer carries the answer and the UTF-8 of its text', async () => {
    const answer = showOk(COMMITTED);
    expect(await showWith(COMMITTED, answer)).toEqual({ ok: true, answer, bytes: TEXT_BYTES });
  });

  it('a draft base64 answer carries the decoded bytes', async () => {
    const answer = showOk(DRAFT, { encoding: 'base64', b64: TEXT_BYTES.toString('base64') });
    delete answer.text;
    expect(await showWith(DRAFT, answer)).toEqual({ ok: true, answer, bytes: TEXT_BYTES });
  });

  it.each([
    ['utf8 carrying b64 instead of text', { text: undefined, b64: TEXT_BYTES.toString('base64') }],
    ["encoding 'hex'", { encoding: 'hex' }],
    ['base64 carrying text but no b64', { encoding: 'base64' }],
  ] as const)('%s: malformed-answer {why: schema}', async (_label, over) => {
    expect(await showWith(COMMITTED, showOk(COMMITTED, over))).toEqual({ ok: false, failure: 'malformed-answer', why: 'schema' });
  });
});

describe('the real local runner, measured on this node (row 46, Q4)', () => {
  /** A stub script in a fresh tmp dir, as the ccdBin of a real `ccdRunner(realRunner, ...)`. Never ccd. */
  function stubReader(body: string | null): ReturnType<typeof ccdDocsReader> {
    const dir = mkTmp('docs-source-');
    const bin = path.join(dir, body === null ? 'absent' : 'stub');
    if (body !== null) {
      writeFileSync(bin, `#!/bin/sh\n${body}\n`);
      chmodSync(bin, 0o755);
    }
    return ccdDocsReader({ runCcd: ccdRunner(realRunner, { ccdBin: bin } as CcrcConfig), fleetState: READY });
  }

  it('a 9 MiB stdout past the 8 MiB exec buffer is answer-overflow (check 4)', async () => {
    expect(await stubReader("head -c 9437184 /dev/zero | tr '\\000' x\nexit 0").tree(SRC, null))
      .toEqual({ ok: false, failure: 'answer-overflow' });
  });

  it("a usage line on stderr and exit 1 is ccd-fault {stderrHead} (an old ccd's answer)", async () => {
    expect(await stubReader("echo 'usage: ccd docs-tree --project P [--ref R]' >&2\nexit 1").tree(SRC, null))
      .toEqual({ ok: false, failure: 'ccd-fault', stderrHead: 'usage: ccd docs-tree --project P [--ref R]\n' });
  });

  it('a ccdBin that does not exist is ccd-fault', async () => {
    const out = (await stubReader(null).tree(SRC, null)) as DocsFailureBody;
    expect(out.failure).toBe('ccd-fault');
  });
});
```

- [ ] **Step 2: Run them to verify they fail.** Foreground, Bash timeout 600000 ms each.

Run: `( cd server && ./node_modules/.bin/vitest run test/docs-source.test.ts )`
Expected: `Test Files  1 failed (1)`, `Tests  no tests`, with `Error: Cannot find module '../src/docs/ccdsource.js' imported from .../server/test/docs-source.test.ts`.

Run: `( cd server && ./node_modules/.bin/vitest run test/lifecycle.test.ts )`
Expected: `Tests  12 failed | 52 passed (64)`; the twelve `ccdEnding` cells fail with `TypeError: ccdEnding is not a function`. The new `cutShort answers what the ending says, cell for cell` case is GREEN here, as it must be: it pins that `cutShort`'s answers do not move when Step 3 re-expresses it.

Run: `( cd server && ./node_modules/.bin/vitest run test/capsupported.test.ts )`
Expected: `Tests  1 failed | 21 passed (22)` — `spells the docs token exactly once in server/src, ...` fails with `AssertionError: expected undefined to be 'docs-v1'`.

Run: `( cd server && ./node_modules/.bin/vitest run test/ccd-archive.test.ts )`
Expected: `Tests  1 failed | 76 passed (77)` — `advertises exactly the verbs the dispatcher implements, plus the known capability tokens` fails with `AssertionError: expected [ Array(15) ] to include undefined`. (This suite runs the real `ccd/ccd`'s `cmd_caps` inside `makeCcdHarness`'s fixture HOME, as it always has; it never touches the live HOME.)

Run: `( cd server && ./node_modules/.bin/vitest run test/verb-gate.test.ts )`
Expected: `Tests  1 failed | 11 passed (12)` — `gates every verb this branch added, at every one of its call sites` fails with `AssertionError: docs-index has no call site at all: expected 0 to be greater than 0`.

- [ ] **Step 3: Write the implementation.** Two edits and two new files.

(a) `server/src/ccdargv.ts`, after `EXPIRE_CAP` (lines 861-863 after Task 1).

Find:

```ts
 *  sent to a box with no evidence it exists is the failure the capability reader was built to prevent. Nothing reads
 *  it in this build — wave 3b's lane does, before its first audit. */
export const EXPIRE_CAP = 'expire-v1';
```

Replace with:

```ts
 *  sent to a box with no evidence it exists is the failure the capability reader was built to prevent. Nothing reads
 *  it in this build — wave 3b's lane does, before its first audit. */
export const EXPIRE_CAP = 'expire-v1';

/** The `ccd caps` token that says this box has the native Docs reader (spec 2026-10-01 section 2 (a), docs W2):
 *  `docs-index`, `docs-tree`, `docs-show` and `docs-fetch` at exactly the argv the `docs*` builders above emit — one
 *  ccd inode. Spelled ONCE in `server/src`; ccd's `echo docs-v1` and `ccd-archive.test.ts`'s
 *  `KNOWN_CAPABILITY_TOKENS` are the other two spellings, held equal by that test's `toContain`.
 *
 *  READ IT WITH `capSupported`, NEVER `verbSupported`, and NEVER ALONE. The docs adapter's gate
 *  (`docs/ccdsource.ts`) is a tri-state: a `ccdVerbs` of `null`, or a list without the token `caps` (an agent whose
 *  boot read of `ccd caps` failed seeds `[]`), measured nothing and answers `caps-unknown`; only a list that DID
 *  come from `ccd caps` and lacks this token answers `unsupported` (section 7.1's skew table, C1). `capSupported`
 *  alone folds the first into the second, and the two have different remedies. */
export const DOCS_CAP = 'docs-v1';
```


(b) `server/src/lifecycle.ts`, `cutShort`'s docstring opening (lines 42-45).

Find:

```ts
/** "THIS CALL'S CHILD WAS CUT SHORT" — the single fact §1.5's adoption gate
 *  rests on, and (wire discipline) the SINGLE READER of `killed` and `signal`,
 *  so the two halves of one measurement are never interpreted twice in two
 *  places that could drift apart.
```

Replace with:

```ts
/** How one ccd call ENDED, as its two kill halves together say (docs W2, refinement (g)):
 *  - `deadline`: the runner's own deadline fired (`killed === true`), whatever `signal` says;
 *  - `signal`: a MEASURED, non-null signal ended the child without the deadline — an operator, an OOM reaper,
 *    systemd stopping the unit;
 *  - `unmeasured`: nobody measured the signal half (an older agent, the transport catch path);
 *  - `exited`: a measured `signal: null` — the child exited by itself, with whatever code `ok` reports.
 *  Four kinds, never folded: a caller that needs fewer (`cutShort`) folds them itself. */
export type CcdEnding = { kind: 'unmeasured' } | { kind: 'deadline' } | { kind: 'signal'; signal: string } | { kind: 'exited' };

/** THE SINGLE READER of `CcdResult`'s `killed` and `signal` (wire discipline): `cutShort` below and the docs
 *  adapter (`docs/ccdsource.ts`) both read the two halves through here, so they are never interpreted twice in two
 *  places that could drift apart. `cutShort`'s docstring argues each arm; the order is its order.
 *
 *  The token trap `cutShort` names applies here first: `UNMEASURED` is itself a string, so the signal half is
 *  compared with the token BEFORE it is read as a signal name, never tested by its javascript type. */
export function ccdEnding(r: CcdResult): CcdEnding {
  if (r.killed === true) return { kind: 'deadline' };
  if (r.signal === UNMEASURED) return { kind: 'unmeasured' };
  if (r.signal !== null) return { kind: 'signal', signal: r.signal };
  return { kind: 'exited' };
}

/** "THIS CALL'S CHILD WAS CUT SHORT" — the single fact §1.5's adoption gate
 *  rests on. It reads `killed` and `signal` through {@link ccdEnding}, their
 *  single reader (wire discipline), so the two halves of one measurement are
 *  never interpreted twice in two places that could drift apart: `deadline`
 *  and `signal` are `true`, `unmeasured` is `UNMEASURED`, `exited` is `false`.
```


And `cutShort`'s body (lines 79-85 at the Task 5 state, before (b)'s insertion; locate it by content).

Find:

```ts
export function cutShort(r: CcdResult): boolean | Unmeasured {
  const signalMeasured = r.signal !== UNMEASURED;
  if (r.killed === true) return true;
  if (signalMeasured && r.signal !== null) return true;
  if (!signalMeasured) return UNMEASURED;
  return false;
}
```

Replace with:

```ts
export function cutShort(r: CcdResult): boolean | Unmeasured {
  const ending = ccdEnding(r);
  if (ending.kind === 'unmeasured') return UNMEASURED;
  return ending.kind !== 'exited';
}
```


`cutShort`'s remaining docstring paragraphs (the external-kill argument, the signal half deciding, the token trap) stay as they are: they now argue the arms `ccdEnding` implements.

(c) Create `server/src/docs/ports.ts` with exactly this content.

```ts
// The native Docs reader's L2 ports (design 2026-10-01, section 1's ports row), DECLARED BY THE CONSUMER: W3's routes
// are the code that calls them, and this file states what those routes need and what each answer means.
// `ccdsource.ts` (L3) is one implementation, over the fleet's `ccd docs-*` verbs.
//
// Ring, checked by imports (M7.10): `import type` lines only and no runtime export, so nothing here executes.
//
// The failure contract, the same for every operation: each answers its own named result type, `{ ok: true; ... }` or
// a `DocsFailureBody` (`shared/docs.ts`). Every gate, transport, ccd and classification condition is a failure BODY
// carrying its word; the promise rejects only on a defect. No operation answers `null` or `undefined` for a failure,
// and every `null` in a signature below has exactly one meaning, stated beside it.
//
// The failure arm is the whole `DocsFailureBody`, not a narrower per-operation union (refinement (d)): ccd's per-verb
// word set is not a checked contract, so a narrower static type would claim what the adapter cannot measure.
import type {
  DocPin, DocsFailureBody, DocsFetchOk, DocsIndexOk, DocsRefSpec, DocsShowOk, DocsTreeOk,
} from '../../../shared/docs.js';
import type { DocsJob } from './policy.js';

/** Which fleet node answers a project-less read. An implementation is bound to one node at construction; W3's node
 *  map selects it, and passes the id through so every port operation names its node the same way. */
export interface DocsNodeId { node: string }

/** One project on one fleet node. `project` is a `:project` that L1's `parseDocsProjectParam` admitted. */
export interface DocsSourceId { node: string; project: string }

/** The server's own facts about one show, decided before the call and never taken from the request (M6.4):
 *  - `maxBytes`: the class cap of the path's content class (`docsShowPlan(...).maxBytes`), sent as `--max-bytes`;
 *  - `job`: L1's lane estimate for the answer (`docsShowPlan(...).job`), its `wire` the bound check 9 holds;
 *  - `listedBlob`: the committed blob the server's listing map holds for this pin; `null` means only "the server
 *    holds no listing entry for it", never "the blob is absent". A draft pin carries `null`. */
export interface DocsShowAsk { maxBytes: number; job: DocsJob; listedBlob: string | null }

/** `docs-index --all`'s answer, carried verbatim, or the failure. */
export type DocsIndexRead = { ok: true; answer: DocsIndexOk } | DocsFailureBody;

/** `docs-tree`'s answer, carried verbatim, or the failure. */
export type DocsTreeRead = { ok: true; answer: DocsTreeOk } | DocsFailureBody;

/** `docs-show`'s answer, carried verbatim, with `bytes`: the content it encodes, decoded once here so W3's raster
 *  path serves exactly the bytes the adapter checked. Or the failure. */
export type DocsShowRead = { ok: true; answer: DocsShowOk; bytes: Uint8Array } | DocsFailureBody;

/** `docs-fetch`'s answer, carried verbatim, or the failure. */
export type DocsFetchRun = { ok: true; answer: DocsFetchOk } | DocsFailureBody;

/** The three reads. None of them writes anything on the fleet (section 2 (g)'s wall 1: the read registration is built
 *  with this port alone and holds no fetcher). */
export interface DocsReader {
  /** Every project on the node (`docs-index --all`). */
  index(at: DocsNodeId): Promise<DocsIndexRead>;
  /** One project's listing. `ref` is the request's ref in either grammar; `null` means the default view (ccd's
   *  origin-default chain), sent as no `--ref` at all. */
  tree(src: DocsSourceId, ref: DocsRefSpec | null): Promise<DocsTreeRead>;
  /** One file at a pin from a tree answer: a committed pin, or a draft pin; `ask` carries the server's facts. */
  show(src: DocsSourceId, pin: DocPin, ask: DocsShowAsk): Promise<DocsShowRead>;
}

/** The one docs operation that writes (a git fetch on the fleet), held apart so a read route cannot reach it. */
export interface DocsFetcher {
  /** Fetch `branch` (bare) from origin. `null` means the origin default branch, sent as no `--branch` at all. */
  fetch(src: DocsSourceId, branch: string | null): Promise<DocsFetchRun>;
}
```

(d) Create `server/src/docs/ccdsource.ts` with exactly this content. Keep both executor heads (`async function readDocs(...)`, `async function fetchDocs(...)`) on ONE line with a named return type and no type parameter: `verb-gate.test.ts`'s `isHandlerHead` needs the name followed directly by `(`, and a wrapped or generic head resolves no scope (an "ungated call site" red). Keep the two gate lines as written in both: they are section 2 (a)'s text, and the mutation rows below quote them.

```ts
// The native Docs reader's L3 ccd adapter (design 2026-10-01: section 1's ccdsource row, section 2 (a) The gate,
// section 2 (b) Server classification). It implements the two consumer-declared ports of `ports.ts` over the one ccd
// capability the server already holds, `CcdRunner` (`lifecycle.ts`). It answers words; `policy.ts` (L1) decides what
// each word means over HTTP, and W3's routes apply that verdict.
//
// Ring, checked by imports (M7.10): it may import `../ccdargv.js`, `../lifecycle.js`, `../exec.js`,
// `../fleetstate.js` (type), `node:crypto`, `./policy.js`, `./ports.js` (type) and `../../../shared/docs.js`. No
// fastify, no reply, no timer.
//
// The rules it keeps:
// - THE GATE comes first, inside each of the two functions that build a docs argv (`readDocs`, `fetchDocs`), and both
//   of its answers are decided before any exec. `verb-gate.test.ts` reads the nearest enclosing function of every
//   `CCD_ARGV.docs*(` call for a literal `capSupported(`, which is why one shared gate helper would read as ungated
//   (refinement (c)), and why each function head stays on one line with a named return type.
// - IT NEVER NARROWS a distinction it received. The checks run in section 2 (b)'s order and the first match wins.
//   ccd's words and every context key ride through verbatim: absent stays absent and `null` stays `null` (D-4157's
//   `unwalked`, D-4158's `lockAgeMs`, contract F4's `branch`). A word outside ccd's set is `unknown-failure {word}`,
//   never mapped onto a known word.
// - `killed` and `signal` are read through `ccdEnding` (`lifecycle.ts`) alone: one reader for the two halves.
// - A server-made string carrying ccd's untrusted text (`cause`, `stderrHead`, check 7's `word`) is redacted BEFORE it
//   is cut to 512 bytes, so a cut cannot split a secret past the redactor and no such string rides in unbounded.
// Inherited from W1's ledger, carried and not fixed here: MT-2 (ccd cuts its own stderr before it redacts, so nothing
// here can recover a secret that cut split) and SEC-3 (an externally killed helper orphans git's process group; this
// wave's lever is the runner budget invariant that `docs-budget.test.ts` holds, so the agent never kills ccd first).
import { CCD_ARGV, DOCS_CAP, capSupported } from '../ccdargv.js';
import { ccdEnding, type CcdResult, type CcdRunner } from '../lifecycle.js';
import type { FleetState } from '../fleetstate.js';
import {
  DOCS_CCD_FAILURES, docsRefText, redactDocsText,
  type DocPin, type DocsFailure, type DocsFailureBody, type DocsFetchOk, type DocsIndexOk, type DocsRefSpec,
  type DocsShowOk, type DocsTreeOk, type DocsVerb,
} from '../../../shared/docs.js';
import type { DocsFetchRun, DocsFetcher, DocsReader, DocsShowAsk, DocsShowRead } from './ports.js';

/** What both adapters are built from. `fleetState` is the server's live fleet state, read at each call (the server
 *  refreshes `ccdVerbs` from `ccd caps`); `undefined` means only "this server holds no fleet state object", which
 *  the gate answers exactly as it answers a `null` list: `caps-unknown`. */
export interface CcdDocsDeps { runCcd: CcdRunner; fleetState: Pick<FleetState, 'ccdVerbs'> | undefined }

/** The agent's refusal of an argv its exec whitelist does not grant (`agent/src/server.ts`'s `fail(req.id, ...)` on
 *  the `isExecAllowed(` line), relayed by the client as the rejection's message and by the runner's catch as stderr.
 *  Module-private, never shared across packages (R14): `docs-source.test.ts` extracts the agent's literal from source
 *  and drives this adapter with it, so a renamed word on either side reds that test. */
const AGENT_EXEC_REFUSAL = 'forbidden';

/** The client's own wait expiring (`server/src/remote/client.ts`'s timer: `reject(new Error(...))`). Module-private
 *  for `AGENT_EXEC_REFUSAL`'s reason, and extracted from source by the same test. */
const LINK_WAIT_EXPIRED = 'timeout';

/** The most bytes of redacted untrusted text a server-made body carries (`ccd-fault`'s `stderrHead`, `link-failed`'s
 *  `cause`, `unknown-failure`'s `word`), cut at a UTF-8 boundary. */
const STDERR_HEAD_BYTES = 512;

/** ccd's words, as a set for a membership test on an untrusted string (check 7). Derived from L0, never listed. */
const CCD_WORDS: ReadonlySet<string> = new Set(DOCS_CCD_FAILURES);

/** The three envelope keys a ccd failure line carries and a failure body does not (refinement (j)). */
const ENVELOPE_ONLY_KEYS: ReadonlySet<string> = new Set(['v', 'verb', 'elapsedMs']);

/** A read call, one arm per argv shape `readDocs` builds. `ref: null` is the default view (no `--ref`). */
type DocsReadCall =
  | { verb: 'docs-index' }
  | { verb: 'docs-tree'; project: string; ref: DocsRefSpec | null }
  | { verb: 'docs-show'; project: string; pin: DocPin; ask: DocsShowAsk };

/** What a gated executor hands back: the run's raw result, or the gate's own failure body. */
type DocsRan = { ok: true; res: CcdResult } | DocsFailureBody;

/** A classified answer: ccd's ok line as parsed (its shape is the verb's ok type; only the envelope was checked), or
 *  the failure body. */
type DocsLine = { ok: true; line: Readonly<Record<string, unknown>> } | DocsFailureBody;

/** A failure body the adapter makes itself, with that word's context. */
function fail(failure: DocsFailure, context: Omit<DocsFailureBody, 'ok' | 'failure'> = {}): DocsFailureBody {
  return { ok: false, failure, ...context };
}

/** The first `maxBytes` bytes of `s`'s UTF-8, cut back to the start of the character the cut would split. */
function utf8Head(s: string, maxBytes: number): string {
  const bytes = Buffer.from(s, 'utf8');
  if (bytes.length <= maxBytes) return s;
  let end = maxBytes;
  while (end > 0 && (bytes[end]! & 0xc0) === 0x80) end--;
  return bytes.subarray(0, end).toString('utf8');
}

/** ccd's untrusted text as a server-made body carries it: redacted first, then cut (`STDERR_HEAD_BYTES`). */
function stderrHeadOf(s: string): string {
  return utf8Head(redactDocsText(s), STDERR_HEAD_BYTES);
}

/**
 * The gated read executor: the gate, then ONE `switch` that builds and runs each read argv (refinement (c)). The two
 * gate lines are section 2 (a)'s, literally, and both answers are decided before any exec:
 * - no list, or a list without the token `caps`, measured nothing (an agent whose boot read of `ccd caps` failed
 *   seeds `[]`): `caps-unknown` (C1);
 * - a measured list without `docs-v1`: `unsupported`. `capSupported`, never `verbSupported`: a box can echo the four
 *   verb names without the token, and `verbSupported` would permit it.
 */
async function readDocs(deps: CcdDocsDeps, call: DocsReadCall): Promise<DocsRan> {
  const verbs = deps.fleetState?.ccdVerbs ?? null;
  if (verbs === null || !verbs.includes('caps')) return fail('caps-unknown');
  if (!capSupported(deps.fleetState, DOCS_CAP)) return fail('unsupported');
  switch (call.verb) {
    case 'docs-index':
      return { ok: true, res: await deps.runCcd(CCD_ARGV.docsIndex()) };
    case 'docs-tree':
      return {
        ok: true,
        res: await deps.runCcd(CCD_ARGV.docsTree(call.project, call.ref === null ? null : docsRefText(call.ref))),
      };
    case 'docs-show':
      return {
        ok: true,
        res: await deps.runCcd(call.pin.kind === 'committed'
          ? CCD_ARGV.docsShowCommitted(call.project, call.pin.commit, call.pin.servedRef, call.pin.section, call.pin.path,
            call.ask.maxBytes)
          : CCD_ARGV.docsShowDraft(call.project, call.pin.branch, call.pin.head, call.pin.section, call.pin.path,
            call.pin.fp, call.ask.maxBytes)),
      };
  }
}

/** The gated fetch executor: the same two gate lines, then the ONE `CCD_ARGV.docsFetch(` in `server/src`. */
async function fetchDocs(deps: CcdDocsDeps, project: string, branch: string | null): Promise<DocsRan> {
  const verbs = deps.fleetState?.ccdVerbs ?? null;
  if (verbs === null || !verbs.includes('caps')) return fail('caps-unknown');
  if (!capSupported(deps.fleetState, DOCS_CAP)) return fail('unsupported');
  return { ok: true, res: await deps.runCcd(CCD_ARGV.docsFetch(project, branch)) };
}

/**
 * Checks 1-7 of section 2 (b), in order; the first match wins.
 * 1. Both halves unmeasured, not ok, empty stdout: the runner's transport catch (`{code:1, stdout:'', stderr:msg}`).
 *    The agent's refusal is `not-granted`, the client's own wait `link-timeout`, anything else `link-failed {cause}`.
 *    An ok answer whose halves are unmeasured (an agent older than both fields) is NOT this: it goes on to parsing.
 * 2. The runner's deadline fired: `ccd-timeout`.
 * 3. A measured signal ended ccd: `ccd-killed {signal}`.
 * 4. Not ok with stdout: a cut answer (maxBuffer), which the exit contract makes detectable: `answer-overflow`.
 * 5. Not ok, empty stdout: `ccd-fault {stderrHead}` (a `die`, an old ccd's usage line, ENOENT). No `code`: the
 *    `CcdResult` carries none, and absent means unmeasured (refinement (f)).
 * 6-7. `parseLine`.
 */
function classify(verb: DocsVerb, res: CcdResult): DocsLine {
  const ending = ccdEnding(res);
  if (ending.kind === 'unmeasured' && !res.ok && res.stdout === '') {
    if (res.stderr === AGENT_EXEC_REFUSAL) return fail('not-granted');
    if (res.stderr === LINK_WAIT_EXPIRED) return fail('link-timeout');
    return fail('link-failed', { cause: stderrHeadOf(res.stderr) });
  }
  if (ending.kind === 'deadline') return fail('ccd-timeout');
  if (ending.kind === 'signal') return fail('ccd-killed', { signal: ending.signal });
  if (!res.ok && res.stdout !== '') return fail('answer-overflow');
  if (!res.ok) return fail('ccd-fault', { stderrHead: stderrHeadOf(res.stderr) });
  return parseLine(verb, res.stdout);
}

/**
 * Checks 6 and 7.
 * 6. stdout is exactly one JSON text and exactly one `\n`, its last character (an empty stdout reaches `JSON.parse`
 *    as `''` and fails there): otherwise `malformed-answer {why:'parse'}`. The text is an object, `v` is 1, `verb` is
 *    the verb asked, `ok` is a boolean, and a failure line's `failure` is a string: otherwise `{why:'schema'}`.
 * 7. A word outside ccd's set (a server-only word included) is `unknown-failure {word}`, the word via `stderrHeadOf`;
 *    a ccd word is `ccdFailureBody`.
 */
function parseLine(verb: DocsVerb, stdout: string): DocsLine {
  if (stdout.indexOf('\n') !== stdout.length - 1) return fail('malformed-answer', { why: 'parse' });
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout.slice(0, -1));
  } catch {
    return fail('malformed-answer', { why: 'parse' });
  }
  if (typeof parsed !== 'object' || parsed === null) return fail('malformed-answer', { why: 'schema' });
  const line = parsed as Readonly<Record<string, unknown>>;
  if (line.v !== 1 || line.verb !== verb || typeof line.ok !== 'boolean') return fail('malformed-answer', { why: 'schema' });
  if (line.ok) return { ok: true, line };
  if (typeof line.failure !== 'string') return fail('malformed-answer', { why: 'schema' });
  if (!CCD_WORDS.has(line.failure)) return fail('unknown-failure', { word: stderrHeadOf(line.failure) });
  return ccdFailureBody(line);
}

/** A ccd failure line as a failure body (refinement (j)): exactly `v`, `verb` and `elapsedMs` dropped, every other key
 *  carried as ccd wrote it. No hand-kept list of context keys, so no context key can be dropped or defaulted.
 *  `Object.fromEntries` defines each key as an own property, so a `__proto__` key in the line stays a plain key. */
function ccdFailureBody(line: Readonly<Record<string, unknown>>): DocsFailureBody {
  const carried = Object.fromEntries(Object.entries(line).filter(([key]) => !ENVELOPE_ONLY_KEYS.has(key)));
  return { ...carried, ok: false } as unknown as DocsFailureBody;
}

/** The content bytes a show answer encodes, decoded once: `text` as UTF-8, or `b64` as base64. An answer whose
 *  encoding names no field it carries is `malformed-answer {why:'schema'}`. */
function decodeShowBytes(ans: DocsShowOk): { ok: true; bytes: Uint8Array } | DocsFailureBody {
  if (ans.encoding === 'utf8' && typeof ans.text === 'string') return { ok: true, bytes: Buffer.from(ans.text, 'utf8') };
  if (ans.encoding === 'base64' && typeof ans.b64 === 'string') return { ok: true, bytes: Buffer.from(ans.b64, 'base64') };
  return fail('malformed-answer', { why: 'schema' });
}

/** The read port over ccd. Bound to the node whose `CcdRunner` it holds; `index`'s `at` names that node. */
export function ccdDocsReader(deps: CcdDocsDeps): DocsReader {
  return {
    index: async () => {
      const ran = await readDocs(deps, { verb: 'docs-index' });
      if (!ran.ok) return ran;
      const read = classify('docs-index', ran.res);
      return read.ok ? { ok: true, answer: read.line as unknown as DocsIndexOk } : read;
    },
    tree: async (src, ref) => {
      const ran = await readDocs(deps, { verb: 'docs-tree', project: src.project, ref });
      if (!ran.ok) return ran;
      const read = classify('docs-tree', ran.res);
      return read.ok ? { ok: true, answer: read.line as unknown as DocsTreeOk } : read;
    },
    show: async (src, pin, ask): Promise<DocsShowRead> => {
      const ran = await readDocs(deps, { verb: 'docs-show', project: src.project, pin, ask });
      if (!ran.ok) return ran;
      const read = classify('docs-show', ran.res);
      if (!read.ok) return read;
      const answer = read.line as unknown as DocsShowOk;
      const decoded = decodeShowBytes(answer);
      return decoded.ok ? { ok: true, answer, bytes: decoded.bytes } : decoded;
    },
  };
}

/** The fetch port over ccd: the one docs operation that writes, built apart from the reader (section 2 (g)'s wall 1). */
export function ccdDocsFetcher(deps: CcdDocsDeps): DocsFetcher {
  return {
    fetch: async (src, branch): Promise<DocsFetchRun> => {
      const ran = await fetchDocs(deps, src.project, branch);
      if (!ran.ok) return ran;
      const read = classify('docs-fetch', ran.res);
      return read.ok ? { ok: true, answer: read.line as unknown as DocsFetchOk } : read;
    },
  };
}
```

- [ ] **Step 4: Run them to verify they pass.** Foreground, Bash timeout 600000 ms each.

Run: `( cd server && ./node_modules/.bin/vitest run test/docs-source.test.ts )`
Expected: `Tests  76 passed (76)` — the gate 36 (30 refusal cells, 5 exact-argv rows, 1 default-flags case), check 1 six, checks 2-5 six, check 6 eleven, check 7 nine (the word's cut and its order among them), show five, the real runner three. The real-runner overflow case is the measurement section 2 (b) row 4 asks for: on this node `realRunner` answers a cut 8 MiB stdout with `killed: false, signal: null` and code 1, which classifies as `answer-overflow`, not `ccd-timeout`.

Run: `( cd server && ./node_modules/.bin/vitest run test/lifecycle.test.ts )`
Expected: `Tests  64 passed (64)` (the base's 51, the 12 cells and the equivalence case). The pre-existing `§1.7 — cutShort` describe is untouched and green.

Run: `( cd server && ./node_modules/.bin/vitest run test/capsupported.test.ts test/ccd-archive.test.ts test/caps-token-shape.test.ts )`
Expected: `Test Files  3 passed (3)`, `Tests  104 passed (104)` (22 + 77 + 5). `capsupported`'s `literalSpellings(DOCS_CAP)` reads 1: the cap appears quoted nowhere else in `server/src` (the docstrings spell it in backticks only).

Run: `( cd server && ./node_modules/.bin/vitest run test/verb-gate.test.ts test/whitelist-subset.test.ts )`
Expected: `Test Files  2 passed (2)`, `Tests  118 passed (118)` (12 + 106). `verb-gate` now finds five docs call sites (`docsIndex`, `docsTree`, `docsShowCommitted`, `docsShowDraft` in `readDocs`; `docsFetch` in `fetchDocs`), resolves a scope for each, and reads each as gated through `CAP_GATED_VERBS` and the literal `capSupported(`. `VERB_OF` already resolves both show builders to `docs-show` under its four-string probe (Task 1), so no `PROBE_ARGS` entry is needed.

Run: `( cd server && ./node_modules/.bin/vitest run test/dispatch-adopt.test.ts test/child-reclaim.test.ts )`
Expected: `Test Files  2 passed (2)`, `Tests  161 passed (161)`: the two `cutShort` consumers answer as before.

- [ ] **Step 5: The guard suites and the compiles.** Foreground, Bash timeout 600000 ms each; `typecheck-tests` is a known load flake, so a red there is re-run alone before it is called broken.

Run: `( cd server && node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit && node node_modules/typescript/bin/tsc -p test/tsconfig.tests.json --noEmit && echo TSC-OK )`
Expected: `TSC-OK`. The first compiles the exhaustive `switch` in `readDocs` (every arm returns, so no trailing return is needed) and the two `as unknown as` casts from parsed JSON; the second compiles `docs-source.test.ts`'s `CcdResult` literals with `UNMEASURED` halves and `{ ccdBin } as CcrcConfig`.

Run: `( cd server && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts )`
Expected: `Tests  12 passed (12)`. With a symlinked `pwa/node_modules` only `PWA_TSC really is pwa's own installed compiler` reds (Task 1's Measured 5); Task 1's Step 0 installs real modules.

Run: `( cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts test/topology-clean.test.ts test/ccdargv-brand.test.ts test/exec.test.ts )`
Expected: `Test Files  4 passed (4)`, `Tests  488 passed (488)` (399 + 55 + 13 + 21). `topology-clean` needs `origin/main` (Task 1's Measured 5): without it only `resolved a base to measure against — a missing one is RED, never vacuous` reds. This task spells no quoted `'docs-v1'` outside `ccdargv.ts`, no quoted `'x-ccrc-docs'`, no redactor fragment, no qualified ref prefix under `server/src/docs` (the test file quotes `'refs/remotes/origin/main'` as fixture data, outside `server/src`), no `'absent'`/`'unreadable'` pair, and redeclares no W1 name.

Run: `( cd server && ./node_modules/.bin/vitest run test/docs-policy.test.ts test/docs-shared.test.ts test/docs-parity.test.ts )`
Expected: `Test Files  3 passed (3)`, `Tests  589 passed (589)` (305 + 239 + 45). `policy.ts` is untouched; `ccdsource.ts` imports the redactor and `DOCS_CCD_FAILURES` from `shared/docs.ts` and re-spells neither.

No `ccd/ccd` edit, so no restamp and no citation tax. Task 8 appends the docs ring guard that checks this task's two new files by their imports.

- [ ] **Step 6: Define the four spec deviations, then commit.**

This task is where the plan departs from the binding spec's TEXT (Global Constraints, "Deviations"): refinements (c), (d), (f) and (g). Define them with the first four numbers of the block the brief issued for this run, in that order, by appending ONE section at the end of this plan (after Task 9's rows block; nothing above it changes). `<n1>`..`<n4>` are those issued numbers, never one looked up, guessed or read off `GET /api/ledger`'s `floor`; `<date>` is `date -u +%F`. If the brief names no block, or fewer than four numbers, stop and put an ask to the coordinator: write no `D-` number that was not issued. Append exactly this, with the placeholders filled:

```markdown

## Deviations found

- **D-<n1> (<date>)** — the docs cap gate lives in two adapter functions, not "inside the one adapter function" (spec §2 (a)). `readDocs` (index, tree, both shows, one `switch`) and `fetchDocs` each carry §2 (a)'s two gate lines literally, because `verb-gate.test.ts` reads the nearest enclosing function of every `CCD_ARGV.docs*(` call for a literal `capSupported(` (a shared gate helper would read as ungated) and §2 (g)'s wall 1 keeps the fetch path apart from the reader. Refinement (c); Task 6.
- **D-<n2> (<date>)** — each port operation's failure arm is the whole `DocsFailureBody`, not a per-operation union, and `index` takes `DocsNodeId {node}`, not `DocsSourceId` (spec §1). ccd's per-verb word set is not a checked contract (check 7 tests membership in the ccd set only), so a narrower static union would claim what the adapter cannot measure, and docs-index is project-less. Refinement (d); Task 6.
- **D-<n3> (<date>)** — `ccd-fault` carries `stderrHead` but no `code` (spec §2 (b) check 5 names `ccd-fault {code, stderrHead}`). `CcdResult` carries `ok`, not the exit code, and widening it would change `ccd()`'s output under existing `toEqual` pins; the adapter never invents a code (absent means unmeasured, never `1`). Refinement (f); Task 6.
- **D-<n4> (<date>)** — `server/src/lifecycle.ts`, outside §7.7's W2 row, gains `CcdEnding` and `ccdEnding`, and `cutShort` is re-expressed through it with identical answers, so `killed` and `signal` keep one reader for the adapter's check 1 and `cutShort` alike. Refinement (g); Task 6.
```

Then prove the numbers collide with nothing and no placeholder lands, and read the result BEFORE committing (the commit is its own call, made only after a green read):

```bash
git fetch -q origin main
( cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts test/dtbd.test.ts )
grep -c '^- \*\*D-[0-9][0-9]* (' docs/superpowers/plans/2026-10-06-native-docs-reader-w2-grants-and-adapter.md
```

Expected: `Test Files  2 passed (2)`; then `4`. A red `deviation-refs` names a number defined in two plans: stop and report it to the coordinator, never renumber by hand.

```bash
git add server/src/ccdargv.ts server/src/lifecycle.ts server/src/docs/ports.ts server/src/docs/ccdsource.ts \
  server/test/docs-source.test.ts server/test/lifecycle.test.ts server/test/capsupported.test.ts \
  server/test/ccd-archive.test.ts server/test/verb-gate.test.ts \
  docs/superpowers/plans/2026-10-06-native-docs-reader-w2-grants-and-adapter.md
git commit -m "server: docs ports and the ccd adapter gate (docs W2)" \
  -m "DOCS_CAP ('docs-v1', spelled once in server/src, held equal to ccd's echo by ccd-archive's toContain). lifecycle.ts gains ccdEnding, the single reader of killed and signal, and cutShort is re-expressed through it with identical answers. ports.ts (L2, type-only) declares DocsReader {index, tree, show} and DocsFetcher {fetch}, each operation answering its own named {ok:true; answer} | DocsFailureBody. ccdsource.ts (L3) implements both over CcdRunner: section 2 (a)'s tri-state gate inside each of its two argv-building functions (null or a list without caps -> caps-unknown, a measured list without docs-v1 -> unsupported, zero execs either way; row 45, M7.7), then section 2 (b)'s checks 1-7 in order, ccd's words and context carried verbatim (absent stays absent, null stays null), stderr and check 7's unknown word redacted before they are cut to 512 bytes. The plan defines the four issued deviations (refinements (c), (d), (f), (g)). verb-gate holds the four docs verbs in CAP_GATED_VERBS and NEW_GENERATION; docs-source.test.ts drives every port with a recording runner and takes 'forbidden' and 'timeout' from their own source (R14)." \
  -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

**Mutation rows this task contributes** (each measured red in a separate copy of the tree at this task's state, never in the worktree; `pkg` is the package the `tests` run in; `old` is unique in `file` at this task's state, and where the two executors share a line, `old` carries the function head or the following `switch` line to make it so; `red` is the measured summary and the cases that went red). Rows M16 and M17 guard the cut and its order, which Task 7's second redaction pass cannot mask: a fragment cut before redaction no longer matches any rule. M17 reds the word's straddling case too, and M27 holds check 7's `word` to the same cut (without it a 2 KiB word rides whole into the body).

```json
[
 {
  "id": "W2-T6-M1",
  "pkg": "server",
  "file": "server/src/docs/ccdsource.ts",
  "old": "async function readDocs(deps: CcdDocsDeps, call: DocsReadCall): Promise<DocsRan> {\n  const verbs = deps.fleetState?.ccdVerbs ?? null;\n  if (verbs === null || !verbs.includes('caps')) return fail('caps-unknown');",
  "new": "async function readDocs(deps: CcdDocsDeps, call: DocsReadCall): Promise<DocsRan> {\n  const verbs = deps.fleetState?.ccdVerbs ?? null;\n  if (!verbs.includes('caps')) return fail('caps-unknown');",
  "tests": [
   "test/docs-source.test.ts"
  ],
  "red": "Tests 8 failed | 68 passed (76) — test/docs-source.test.ts > index, ccdVerbs null (not handshaken): caps-unknown with zero execs; test/docs-source.test.ts > index, no fleet state at all: caps-unknown with zero execs; test/docs-source.test.ts > show committed, ccdVerbs null (not handshaken): caps-unknown with zero execs; test/docs-source.test.ts > show committed, no fleet state at all: caps-unknown with zero execs; ... (8 in all)"
 },
 {
  "id": "W2-T6-M2",
  "pkg": "server",
  "file": "server/src/docs/ccdsource.ts",
  "old": "async function readDocs(deps: CcdDocsDeps, call: DocsReadCall): Promise<DocsRan> {\n  const verbs = deps.fleetState?.ccdVerbs ?? null;\n  if (verbs === null || !verbs.includes('caps')) return fail('caps-unknown');",
  "new": "async function readDocs(deps: CcdDocsDeps, call: DocsReadCall): Promise<DocsRan> {\n  const verbs = deps.fleetState?.ccdVerbs ?? null;\n  if (verbs === null) return fail('caps-unknown');",
  "tests": [
   "test/docs-source.test.ts"
  ],
  "red": "Tests 8 failed | 68 passed (76) — test/docs-source.test.ts > index, ['x'] (a list that lacks caps measured nothing): caps-unknown with zero execs; test/docs-source.test.ts > index, [] (the agent's failed boot read, seeded ?? []): caps-unknown with zero execs; test/docs-source.test.ts > show committed, ['x'] (a list that lacks caps measured nothing): caps-unknown with zero execs; test/docs-source.test.ts > show committed, [] (the agent's failed boot read, seeded ?? []): caps-unknown with zero execs; ... (8 in all)"
 },
 {
  "id": "W2-T6-M3",
  "pkg": "server",
  "file": "server/src/docs/ccdsource.ts",
  "old": "async function fetchDocs(deps: CcdDocsDeps, project: string, branch: string | null): Promise<DocsRan> {\n  const verbs = deps.fleetState?.ccdVerbs ?? null;\n  if (verbs === null || !verbs.includes('caps')) return fail('caps-unknown');",
  "new": "async function fetchDocs(deps: CcdDocsDeps, project: string, branch: string | null): Promise<DocsRan> {\n  const verbs = deps.fleetState?.ccdVerbs ?? null;\n  if (!verbs.includes('caps')) return fail('caps-unknown');",
  "tests": [
   "test/docs-source.test.ts"
  ],
  "red": "Tests 2 failed | 74 passed (76) — test/docs-source.test.ts > fetch, ccdVerbs null (not handshaken): caps-unknown with zero execs; test/docs-source.test.ts > fetch, no fleet state at all: caps-unknown with zero execs"
 },
 {
  "id": "W2-T6-M4",
  "pkg": "server",
  "file": "server/src/docs/ccdsource.ts",
  "old": "async function fetchDocs(deps: CcdDocsDeps, project: string, branch: string | null): Promise<DocsRan> {\n  const verbs = deps.fleetState?.ccdVerbs ?? null;\n  if (verbs === null || !verbs.includes('caps')) return fail('caps-unknown');",
  "new": "async function fetchDocs(deps: CcdDocsDeps, project: string, branch: string | null): Promise<DocsRan> {\n  const verbs = deps.fleetState?.ccdVerbs ?? null;\n  if (verbs === null) return fail('caps-unknown');",
  "tests": [
   "test/docs-source.test.ts"
  ],
  "red": "Tests 2 failed | 74 passed (76) — test/docs-source.test.ts > fetch, ['x'] (a list that lacks caps measured nothing): caps-unknown with zero execs; test/docs-source.test.ts > fetch, [] (the agent's failed boot read, seeded ?? []): caps-unknown with zero execs"
 },
 {
  "id": "W2-T6-M5",
  "pkg": "server",
  "file": "server/src/docs/ccdsource.ts",
  "old": "  if (!capSupported(deps.fleetState, DOCS_CAP)) return fail('unsupported');\n  switch (call.verb) {",
  "new": "  if (!verbs.includes(call.verb)) return fail('unsupported');\n  switch (call.verb) {",
  "tests": [
   "test/docs-source.test.ts",
   "test/verb-gate.test.ts"
  ],
  "red": "Tests 48 failed | 40 passed (88) — test/docs-source.test.ts > a NOT-ok answer with stdout and unmeasured halves is a cut answer, not a transport failure; test/docs-source.test.ts > an OK answer whose halves are unmeasured (an older agent) is parsed, not read as a transport failure; test/docs-source.test.ts > any other transport message is link-failed, carrying it as cause; test/docs-source.test.ts > the agent's own refusal word is not-granted, after exactly one exec (section 7.1, C3); ... (48 in all)"
 },
 {
  "id": "W2-T6-M6",
  "pkg": "server",
  "file": "server/src/docs/ccdsource.ts",
  "old": "    if (res.stderr === AGENT_EXEC_REFUSAL) return fail('not-granted');\n",
  "new": "",
  "tests": [
   "test/docs-source.test.ts"
  ],
  "red": "Tests 1 failed | 75 passed (76) — test/docs-source.test.ts > the agent's own refusal word is not-granted, after exactly one exec (section 7.1, C3)"
 },
 {
  "id": "W2-T6-M7",
  "pkg": "server",
  "file": "server/src/docs/ccdsource.ts",
  "old": "  if (ending.kind === 'deadline') return fail('ccd-timeout');\n  if (ending.kind === 'signal') return fail('ccd-killed', { signal: ending.signal });",
  "new": "  if (ending.kind === 'deadline') return fail('ccd-killed');\n  if (ending.kind === 'signal') return fail('ccd-timeout');",
  "tests": [
   "test/docs-source.test.ts"
  ],
  "red": "Tests 2 failed | 74 passed (76) — test/docs-source.test.ts > a measured signal without the deadline: ccd-killed {signal}; test/docs-source.test.ts > the runner deadline fired: ccd-timeout"
 },
 {
  "id": "W2-T6-M8",
  "pkg": "server",
  "file": "server/src/docs/ccdsource.ts",
  "old": "  if (!res.ok && res.stdout !== '') return fail('answer-overflow');\n",
  "new": "",
  "tests": [
   "test/docs-source.test.ts"
  ],
  "red": "Tests 3 failed | 73 passed (76) — test/docs-source.test.ts > a NOT-ok answer with stdout and unmeasured halves is a cut answer, not a transport failure; test/docs-source.test.ts > not ok with stdout (a cut answer): answer-overflow; test/docs-source.test.ts > a 9 MiB stdout past the 8 MiB exec buffer is answer-overflow (check 4)"
 },
 {
  "id": "W2-T6-M9",
  "pkg": "server",
  "file": "server/src/docs/ccdsource.ts",
  "old": "  if (!CCD_WORDS.has(line.failure)) return fail('unknown-failure', { word: stderrHeadOf(line.failure) });\n",
  "new": "",
  "tests": [
   "test/docs-source.test.ts"
  ],
  "red": "Tests 3 failed | 73 passed (76) — test/docs-source.test.ts > a SERVER-only word sent by ccd is unknown-failure too; test/docs-source.test.ts > a word outside the vocabulary is unknown-failure {word}, never mapped onto a known word; test/docs-source.test.ts > the word is redacted, then cut to 512 bytes: a 2 KiB word, and a secret straddling the cut"
 },
 {
  "id": "W2-T6-M10",
  "pkg": "server",
  "file": "server/src/docs/ccdsource.ts",
  "old": "  return { ...carried, ok: false } as unknown as DocsFailureBody;",
  "new": "  return { ...carried, lockAgeMs: line.lockAgeMs ?? null, ok: false } as unknown as DocsFailureBody;",
  "tests": [
   "test/docs-source.test.ts"
  ],
  "red": "Tests 3 failed | 73 passed (76) — test/docs-source.test.ts > a ccd word keeps exactly its line, minus v, verb and elapsedMs; test/docs-source.test.ts > linked-worktree with branch null keeps null (contract F4: detached OR unmeasured); test/docs-source.test.ts > ref-locked with lockAgeMs absent (unmeasured) keeps that state (D-4158)"
 },
 {
  "id": "W2-T6-M11",
  "pkg": "server",
  "file": "server/src/lifecycle.ts",
  "old": "  if (r.signal === UNMEASURED) return { kind: 'unmeasured' };\n  if (r.signal !== null) return { kind: 'signal', signal: r.signal };",
  "new": "  if (typeof r.signal === 'string') return { kind: 'signal', signal: r.signal };\n  if (r.signal === UNMEASURED) return { kind: 'unmeasured' };",
  "tests": [
   "test/lifecycle.test.ts",
   "test/docs-source.test.ts"
  ],
  "red": "Tests 11 failed | 129 passed (140) — test/docs-source.test.ts > a NOT-ok answer with stdout and unmeasured halves is a cut answer, not a transport failure; test/docs-source.test.ts > an OK answer whose halves are unmeasured (an older agent) is parsed, not read as a transport failure; test/docs-source.test.ts > any other transport message is link-failed, carrying it as cause; test/docs-source.test.ts > the agent's own refusal word is not-granted, after exactly one exec (section 7.1, C3); ... (11 in all)"
 },
 {
  "id": "W2-T6-M12",
  "pkg": "server",
  "file": "server/src/docs/ccdsource.ts",
  "old": "  if (!capSupported(deps.fleetState, DOCS_CAP)) return fail('unsupported');\n  switch (call.verb) {",
  "new": "  switch (call.verb) {",
  "tests": [
   "test/verb-gate.test.ts",
   "test/docs-source.test.ts"
  ],
  "red": "Tests 10 failed | 78 passed (88) — test/docs-source.test.ts > index, ['caps'] (a measured pre-Docs ccd): unsupported with zero execs; test/docs-source.test.ts > index, the four verb names without docs-v1: unsupported with zero execs; test/docs-source.test.ts > show committed, ['caps'] (a measured pre-Docs ccd): unsupported with zero execs; test/docs-source.test.ts > show committed, the four verb names without docs-v1: unsupported with zero execs; ... (10 in all)"
 },
 {
  "id": "W2-T6-M13",
  "pkg": "server",
  "file": "server/src/ccdargv.ts",
  "old": "export const DOCS_CAP = 'docs-v1';",
  "new": "export const DOCS_CAP = 'docs-v2';",
  "tests": [
   "test/capsupported.test.ts",
   "test/ccd-archive.test.ts"
  ],
  "red": "Tests 2 failed | 97 passed (99) — test/capsupported.test.ts > spells the docs token exactly once in server/src, and reads it with the REFUSING default (docs W2); test/ccd-archive.test.ts > advertises exactly the verbs the dispatcher implements, plus the known capability tokens"
 },
 {
  "id": "W2-T6-M14",
  "pkg": "server",
  "file": "server/src/docs/ccdsource.ts",
  "old": "  if (ending.kind === 'unmeasured' && !res.ok && res.stdout === '') {",
  "new": "  if (ending.kind === 'unmeasured' && res.stdout === '') {",
  "tests": [
   "test/docs-source.test.ts"
  ],
  "red": "Tests 1 failed | 75 passed (76) — test/docs-source.test.ts > an OK answer whose halves are unmeasured (an older agent) is parsed, not read as a transport failure"
 },
 {
  "id": "W2-T6-M15",
  "pkg": "server",
  "file": "server/src/docs/ccdsource.ts",
  "old": "  if (ending.kind === 'unmeasured' && !res.ok && res.stdout === '') {",
  "new": "  if (ending.kind === 'unmeasured' && !res.ok) {",
  "tests": [
   "test/docs-source.test.ts"
  ],
  "red": "Tests 1 failed | 75 passed (76) — test/docs-source.test.ts > a NOT-ok answer with stdout and unmeasured halves is a cut answer, not a transport failure"
 },
 {
  "id": "W2-T6-M16",
  "pkg": "server",
  "file": "server/src/docs/ccdsource.ts",
  "old": "  while (end > 0 && (bytes[end]! & 0xc0) === 0x80) end--;\n",
  "new": "",
  "tests": [
   "test/docs-source.test.ts"
  ],
  "red": "Tests 1 failed | 75 passed (76) — test/docs-source.test.ts > stderrHead is at most 512 bytes, cut back to a UTF-8 boundary"
 },
 {
  "id": "W2-T6-M17",
  "pkg": "server",
  "file": "server/src/docs/ccdsource.ts",
  "old": "  return utf8Head(redactDocsText(s), STDERR_HEAD_BYTES);",
  "new": "  return redactDocsText(utf8Head(s, STDERR_HEAD_BYTES));",
  "tests": [
   "test/docs-source.test.ts"
  ],
  "red": "Tests 2 failed | 74 passed (76) — test/docs-source.test.ts > stderr is redacted BEFORE it is cut, so a secret straddling the cut leaves no fragment; test/docs-source.test.ts > the word is redacted, then cut to 512 bytes: a 2 KiB word, and a secret straddling the cut"
 },
 {
  "id": "W2-T6-M18",
  "pkg": "server",
  "file": "server/src/docs/ccdsource.ts",
  "old": "  if (stdout.indexOf('\\n') !== stdout.length - 1) return fail('malformed-answer', { why: 'parse' });",
  "new": "  if (!stdout.endsWith('\\n')) return fail('malformed-answer', { why: 'parse' });",
  "tests": [
   "test/docs-source.test.ts"
  ],
  "red": "Tests 1 failed | 75 passed (76) — test/docs-source.test.ts > a blank second line: malformed-answer {why: parse}"
 },
 {
  "id": "W2-T6-M19",
  "pkg": "server",
  "file": "server/src/docs/ccdsource.ts",
  "old": "  if (typeof parsed !== 'object' || parsed === null) return fail('malformed-answer', { why: 'schema' });",
  "new": "  if (typeof parsed !== 'object') return fail('malformed-answer', { why: 'schema' });",
  "tests": [
   "test/docs-source.test.ts"
  ],
  "red": "Tests 1 failed | 75 passed (76) — test/docs-source.test.ts > JSON null: malformed-answer {why: schema}"
 },
 {
  "id": "W2-T6-M20",
  "pkg": "server",
  "file": "server/src/docs/ccdsource.ts",
  "old": "  if (line.v !== 1 || line.verb !== verb || typeof line.ok !== 'boolean') return fail('malformed-answer', { why: 'schema' });",
  "new": "  if (line.verb !== verb || typeof line.ok !== 'boolean') return fail('malformed-answer', { why: 'schema' });",
  "tests": [
   "test/docs-source.test.ts"
  ],
  "red": "Tests 1 failed | 75 passed (76) — test/docs-source.test.ts > v 2: malformed-answer {why: schema}"
 },
 {
  "id": "W2-T6-M21",
  "pkg": "server",
  "file": "server/src/docs/ccdsource.ts",
  "old": "  if (line.v !== 1 || line.verb !== verb || typeof line.ok !== 'boolean') return fail('malformed-answer', { why: 'schema' });",
  "new": "  if (line.v !== 1 || typeof line.ok !== 'boolean') return fail('malformed-answer', { why: 'schema' });",
  "tests": [
   "test/docs-source.test.ts"
  ],
  "red": "Tests 1 failed | 75 passed (76) — test/docs-source.test.ts > verb 'docs-show' answering a tree call: malformed-answer {why: schema}"
 },
 {
  "id": "W2-T6-M22",
  "pkg": "server",
  "file": "server/src/docs/ccdsource.ts",
  "old": "  if (line.v !== 1 || line.verb !== verb || typeof line.ok !== 'boolean') return fail('malformed-answer', { why: 'schema' });",
  "new": "  if (line.v !== 1 || line.verb !== verb) return fail('malformed-answer', { why: 'schema' });",
  "tests": [
   "test/docs-source.test.ts"
  ],
  "red": "Tests 1 failed | 75 passed (76) — test/docs-source.test.ts > ok 'yes' beside a ccd word: malformed-answer {why: schema}"
 },
 {
  "id": "W2-T6-M23",
  "pkg": "server",
  "file": "server/src/docs/ccdsource.ts",
  "old": "  if (typeof line.failure !== 'string') return fail('malformed-answer', { why: 'schema' });\n",
  "new": "",
  "tests": [
   "test/docs-source.test.ts"
  ],
  "red": "Tests 1 failed | 75 passed (76) — test/docs-source.test.ts > ok:false without a failure word: malformed-answer {why: schema}"
 },
 {
  "id": "W2-T6-M24",
  "pkg": "server",
  "file": "server/src/docs/ccdsource.ts",
  "old": "  if (ans.encoding === 'utf8' && typeof ans.text === 'string') return",
  "new": "  if (ans.encoding === 'utf8') return",
  "tests": [
   "test/docs-source.test.ts"
  ],
  "red": "Tests 1 failed | 75 passed (76) — test/docs-source.test.ts > utf8 carrying b64 instead of text: malformed-answer {why: schema}"
 },
 {
  "id": "W2-T6-M25",
  "pkg": "server",
  "file": "server/src/docs/ccdsource.ts",
  "old": "  if (ans.encoding === 'base64' && typeof ans.b64 === 'string') return",
  "new": "  if (ans.encoding === 'base64') return",
  "tests": [
   "test/docs-source.test.ts"
  ],
  "red": "Tests 1 failed | 75 passed (76) — test/docs-source.test.ts > base64 carrying text but no b64: malformed-answer {why: schema}"
 },
 {
  "id": "W2-T6-M26",
  "pkg": "server",
  "file": "server/src/docs/ccdsource.ts",
  "old": "new Set(['v', 'verb', 'elapsedMs'])",
  "new": "new Set(['v', 'verb'])",
  "tests": [
   "test/docs-source.test.ts"
  ],
  "red": "Tests 5 failed | 71 passed (76) — test/docs-source.test.ts > a ccd word keeps exactly its line, minus v, verb and elapsedMs; test/docs-source.test.ts > linked-worktree with branch null keeps null (contract F4: detached OR unmeasured); test/docs-source.test.ts > ref-locked with lockAgeMs a number (its age) keeps that state (D-4158); test/docs-source.test.ts > ref-locked with lockAgeMs absent (unmeasured) keeps that state (D-4158); ... (5 in all)"
 },
 {
  "id": "W2-T6-M27",
  "pkg": "server",
  "file": "server/src/docs/ccdsource.ts",
  "old": "{ word: stderrHeadOf(line.failure) }",
  "new": "{ word: line.failure }",
  "tests": [
   "test/docs-source.test.ts"
  ],
  "red": "Tests 1 failed | 75 passed (76) — test/docs-source.test.ts > the word is redacted, then cut to 512 bytes: a 2 KiB word, and a secret straddling the cut"
 }
]
```

---

### Task 7: Adapter classification, part 2: show integrity and pins (check 8), the wire bound (check 9), the second redaction pass

**Model routing:** `sonnet`, effort `high` — untrusted-input handling: every answer from the fleet is checked before it is believed, and the planted answers in the test are the check. The traps are the order (check 8 before check 9, both after checks 1-7, the first match wins), base64's leniency in node (`Buffer.from(s, 'base64')` silently accepts a missing pad, a stray character and stray low bits, so only a re-encode can tell), and the one exit (every failure body, the gate's included, leaves through ONE `redactBody` call, so cutting it once reds every planted row).

**Spec rows:** section 2 (j) row 46's remaining half (the tampered-sha256 double, the committed answer without `onRef`, the answer one byte over `job.wire`; with Task 6's cases, one case per `CcdResult` shape); row 62's L3 half (the L3 pass redacts a planted unredacted ccd answer; drop the pass, redact one field only, each alone, red); section 6.10's M6.5 (one byte over `job.wire`: `malformed-answer {why:'oversize'}`; delete check 9, red). Section 2 (b)'s checks 8 and 9 and its "One redactor" paragraph, section 6.2's check 9 and its log line, and refinements (e), (i) and (k) are the sources.

**Files:**
- Modify: `server/src/docs/ccdsource.ts` (236 lines at Task 6's state, 321 after): the header's rules (line 21), two imports (lines 25 and 33), `ON_REF_WORDS` after `ENVELOPE_ONLY_KEYS` (line 58), `DocsLine`'s docstring and the new `DocsAccept` (lines 69-71), `classify`'s docstring tail, head and last line plus the new `checkBound` (lines 142-156), `parseLine`'s check-7 clause and last line (lines 163-164, 179-181), `showFault`/`checkShow`/`redactLeaves`/`redactBody`/`settle` after `decodeShowBytes` (line 197), and the two port factories (lines 199-236, to EOF), which now answer through `settle`.
- Test: `server/test/docs-source.test.ts` (342 lines at Task 6's state, 544 after): the vitest import (line 18) gains `vi`, the policy import (line 28) gains `LISTING_JOB`, and three `describe` blocks are appended at EOF (after line 342). Nothing above line 342 changes otherwise: Task 6's `describe('show: ...')` title still says integrity, pins and size are Task 7's, which the appended blocks now are.
- Test (run, not edited): `server/test/docs-shared.test.ts`, `server/test/docs-parity.test.ts` (the redactor still has one home; this task imports it and re-spells no fragment), `server/test/verb-gate.test.ts` and `server/test/capsupported.test.ts` (the two gated executors are untouched: `readDocs` and `fetchDocs` keep their one-line heads and literal gate lines), `server/test/docs-policy.test.ts`; guards `typecheck-tests`, `single-definition`, `topology-clean`, `ccdargv-brand`, `exec`.

Every Find block below is quoted from the file as Task 6 left it and is unique in it; line numbers are hints measured at Task 6's state (Tasks 1-5 touch neither file). If a Find block is absent or not unique, stop and put an ask to the coordinator. Every Task 6 mutation row's `old` text survives this task unchanged and still reds (re-measured at this task's state: all 25 `ccdsource.ts` rows red; the `lifecycle.ts` and `ccdargv.ts` rows are untouched).

**Interfaces:**
- Consumes:
  - Task 6 (`server/src/docs/ccdsource.ts`, module-private): `fail(failure: DocsFailure, context?: Omit<DocsFailureBody, 'ok' | 'failure'>): DocsFailureBody`; `classify(verb: DocsVerb, res: CcdResult): DocsLine` (re-signed here); `parseLine(verb: DocsVerb, stdout: string): DocsLine`; `ccdFailureBody(line: Readonly<Record<string, unknown>>): DocsFailureBody`; `decodeShowBytes(ans: DocsShowOk): { ok: true; bytes: Uint8Array } | DocsFailureBody`; `readDocs(deps: CcdDocsDeps, call: DocsReadCall): Promise<DocsRan>`; `fetchDocs(deps: CcdDocsDeps, project: string, branch: string | null): Promise<DocsRan>`; `type DocsRan = { ok: true; res: CcdResult } | DocsFailureBody`. Exported, unchanged: `ccdDocsReader(deps: CcdDocsDeps): DocsReader`, `ccdDocsFetcher(deps: CcdDocsDeps): DocsFetcher`, `interface CcdDocsDeps`.
  - Task 6 (`server/src/docs/ports.ts`): `interface DocsShowAsk { maxBytes: number; job: DocsJob; listedBlob: string | null }`; `type DocsShowRead = { ok: true; answer: DocsShowOk; bytes: Uint8Array } | DocsFailureBody`; `DocsIndexRead`, `DocsTreeRead`, `DocsFetchRun`.
  - Task 4 (`server/src/docs/policy.ts`): `export interface DocsJob { raw: number; wire: number }`; `export const LISTING_JOB: Readonly<DocsJob>` (`{ raw: 1048576, wire: 1048576 }`); `export function docsShowPlan(path: string, knownSize: number | undefined): DocsShowPlan` (the test's `ASK` is built from it).
  - `node:crypto`: `createHash('sha256')`. `shared/docs.ts` (W1, imported, never amended): `redactDocsText(s: string): string`, the types `DocPin`, `DocsShowOk` (its `onRef?: 'contains' | 'not-contained' | 'unmeasured'`), `DocsFailureBody`, `DocsVerb`.
- Produces (all module-private to `ccdsource.ts`; no export is added or changed, so `ports.ts`, W3 and every consumer see the same surface):
  - `const ON_REF_WORDS: Readonly<Record<NonNullable<DocsShowOk['onRef']>, true>>` — the three `onRef` words, keyed by the L0 type.
  - `type DocsAccept<T extends { ok: true }> = (line: Readonly<Record<string, unknown>>) => T | DocsFailureBody` — what one port operation checks of ccd's ok line beyond the envelope.
  - `function classify<T extends { ok: true }>(verb: DocsVerb, res: CcdResult, job: DocsJob, accept: DocsAccept<T>): T | DocsFailureBody` — checks 1-9 in order.
  - `function checkBound<A>(answer: A, stdout: string, job: DocsJob): A | DocsFailureBody` — check 9: `Buffer.byteLength(stdout) > job.wire` gives `malformed-answer {why:'oversize'}` with `console.warn('ccrc-server: docs answer over its declared bound')`.
  - `function showFault(why: 'integrity' | 'pin' | 'schema'): DocsFailureBody`.
  - `function checkShow(ans: DocsShowOk, pin: DocPin, ask: DocsShowAsk): { ok: true; bytes: Uint8Array } | DocsFailureBody` — check 8.
  - `function redactLeaves(v: unknown): unknown` and `function redactBody(body: DocsFailureBody): DocsFailureBody` — the second pass over every string leaf but `failure`, recursively.
  - `function settle<T extends { ok: true }>(ran: DocsRan, verb: DocsVerb, job: DocsJob, accept: DocsAccept<T>): T | DocsFailureBody` — the one exit: every failure body passes `redactBody` exactly here.
  - `parseLine` keeps its signature; a line carrying a ccd word now comes back as `{ ok: true, line }` (the line's own `ok:false` tells it apart), so check 9 can run before `ccdFailureBody`.
  - The jobs: `index`, `tree` and `fetch` pass `LISTING_JOB`; `show` passes `ask.job`.

**Departures from the architecture's sketch, minimal and recorded here.** (1) `classify` takes `accept` beside `job`: check 8 needs the pin and the ask, which only `show` holds, and check 9 must run after it, so the show-only check rides in as a callback and `classify` stays the one place the order lives. (2) The one exit is a function, `settle`, called by all four port operations, rather than a return statement each: one `redactBody(` call site, so cutting it reds every planted row (M26). (3) The outline's "utf8 with a `b64` field instead of `text`" and "encoding 'hex'" rows already exist as Task 6's `decodeShowBytes` rows and are not re-added; `checkShow` reaches them through `decodeShowBytes` first. (4) The outline's "draft fp differing" row is planted as an answer whose `fp` IS its `sha256` but not the pin's, against a pin whose `fp` is `'f' x 64`: an answer `fp` of `'f' x 64` against the ordinary pin is also caught by `fp === sha256`, so it would not red when the echo is cut (measured; M9 needs the planted form). (5) One extra case beyond the outline: an `unknown-failure {word}` whose word carries `?token=abc` — the one server-made body whose string comes from ccd's stdout rather than stderr. Task 6's check 7 already redacts that word before it cuts it (`stderrHeadOf`), and this pass redacts it again idempotently, so the case is a two-layer regression pin that no single row reds (green under M26 alone and under W2-T6-M27 alone); the second pass's own red is the five planted rows.

- [ ] **Step 1: Write the failing tests.** Two edits to `server/test/docs-source.test.ts`, then an append at its EOF.

Edit — the vitest import gains `vi` (line 18). Find:

```ts
import { describe, it, expect } from 'vitest';
```

Replace with:

```ts
import { describe, it, expect, vi } from 'vitest';
```

Edit — the policy import gains `LISTING_JOB` (line 28). Find:

```ts
import { docsShowPlan } from '../src/docs/policy.js';
```

Replace with:

```ts
import { LISTING_JOB, docsShowPlan } from '../src/docs/policy.js';
```

Edit — append at EOF (after the closing `});` of `describe('the real local runner, measured on this node (row 46, Q4)', ...)`, line 342). Locate the end with `tail -n 4 server/test/docs-source.test.ts`; never insert above it.

```ts
// ---- Task 7: check 8 (show integrity and pins), check 9 (the wire bound), the second redaction pass ----

/** One show call through a recorder answering `stdout` verbatim, with `ask` (default `ASK`). */
async function showRaw(pin: DocPin, stdout: string, ask: DocsShowAsk = ASK): Promise<Answer> {
  return ccdDocsReader({ runCcd: recorder(res({ stdout })).run, fleetState: READY }).show(SRC, pin, ask);
}
/** The body `malformed-answer {why}`. */
const malformed = (why: string): Answer => ({ ok: false, failure: 'malformed-answer', why } as Answer);
/** A base64 show answer for `pin`: `showOk`'s fields, with `b64` in place of `text`. */
function b64Ok(pin: DocPin, b64: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  const answer = showOk(pin, { encoding: 'base64', b64, ...over });
  delete answer.text;
  return answer;
}
const B64 = TEXT_BYTES.toString('base64'); // 'IyBhCg==': canonical, with two padding characters

describe('check 8: show integrity, pins and onRef (row 46, spec section 2 (b))', () => {
  /** A draft pin whose fp is not the sha256 of `TEXT`'s bytes. */
  const DRAFT_F: DocPin = { kind: 'draft', branch: 'ws/a', head: SHA, section: 'specs', path: 'a.md', fp: 'f'.repeat(64) };

  it('a canonical base64 committed answer is ok, carrying its decoded bytes', async () => {
    const answer = b64Ok(COMMITTED, B64);
    expect(await showRaw(COMMITTED, line(answer))).toEqual({ ok: true, answer, bytes: TEXT_BYTES });
  });

  const ROWS: readonly (readonly [string, DocPin, Record<string, unknown>, 'integrity' | 'pin' | 'schema'])[] = [
    ['a tampered sha256', COMMITTED, showOk(COMMITTED, { sha256: 'b'.repeat(64) }), 'integrity'],
    ['a size one over the bytes', COMMITTED, showOk(COMMITTED, { size: TEXT_BYTES.length + 1 }), 'integrity'],
    ['a size one under the bytes', DRAFT, showOk(DRAFT, { size: TEXT_BYTES.length - 1 }), 'integrity'],
    ['base64 without its padding', COMMITTED, b64Ok(COMMITTED, B64.replace(/=+$/, '')), 'integrity'],
    ['base64 with a stray character', COMMITTED, b64Ok(COMMITTED, `${B64.slice(0, 4)}*${B64.slice(4)}`), 'integrity'],
    ['base64 with stray bits in its last character', COMMITTED, b64Ok(COMMITTED, B64.replace('Cg==', 'Ch==')), 'integrity'],
    ['a commit that is not the pin', COMMITTED, showOk(COMMITTED, { commit: 'b'.repeat(40) }), 'pin'],
    ['a section that is not the pin', COMMITTED, showOk(COMMITTED, { section: 'plans' }), 'pin'],
    ['a path that is not the pin', COMMITTED, showOk(COMMITTED, { path: 'b.md' }), 'pin'],
    ["source 'draft' answering a committed pin", COMMITTED, showOk(COMMITTED, { source: 'draft' }), 'pin'],
    ["source 'committed' answering a draft pin", DRAFT, showOk(DRAFT, { source: 'committed' }), 'pin'],
    ['a draft branch that is not the pin', DRAFT, showOk(DRAFT, { branch: 'ws/b' }), 'pin'],
    ['a draft head that is not the pin', DRAFT, showOk(DRAFT, { head: 'b'.repeat(40) }), 'pin'],
    ['a draft fp that is its sha256 but not the pin', DRAFT_F, showOk(DRAFT_F, { fp: DRAFT_FP }), 'pin'],
    ['a committed answer without onRef', COMMITTED, showOk(COMMITTED, { onRef: undefined }), 'schema'],
    ["a committed answer with onRef 'maybe'", COMMITTED, showOk(COMMITTED, { onRef: 'maybe' }), 'schema'],
  ];

  it.each(ROWS)('%s: malformed-answer {why}', async (_label, pin, answer, why) => {
    expect(await showRaw(pin, line(answer))).toEqual(malformed(why));
  });

  it('a draft whose fp echoes its pin but is not its sha256: pin', async () => {
    expect(await showRaw(DRAFT_F, line(showOk(DRAFT_F)))).toEqual(malformed('pin'));
  });

  it("a committed blob is held to the listing's when the server holds one, and to nothing when it holds none", async () => {
    const answer = showOk(COMMITTED); // blob 'c' x 40
    expect(await showRaw(COMMITTED, line(answer), { ...ASK, listedBlob: 'b'.repeat(40) })).toEqual(malformed('pin'));
    expect(await showRaw(COMMITTED, line(answer), { ...ASK, listedBlob: 'c'.repeat(40) }))
      .toEqual({ ok: true, answer, bytes: TEXT_BYTES });
    expect(await showRaw(COMMITTED, line(answer), { ...ASK, listedBlob: null }))
      .toEqual({ ok: true, answer, bytes: TEXT_BYTES });
  });

  it.each(['contains', 'not-contained', 'unmeasured'])("onRef '%s' is ok", async (onRef) => {
    const answer = showOk(COMMITTED, { onRef });
    expect(await showRaw(COMMITTED, line(answer))).toEqual({ ok: true, answer, bytes: TEXT_BYTES });
  });
});

/** `console.warn` spied and silenced for one call: the call's answer and every warn call's arguments. */
async function watchingWarn(run: () => Promise<Answer>): Promise<{ out: Answer; warned: unknown[][] }> {
  const spy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  try {
    const out = await run();
    return { out, warned: spy.mock.calls.map((args) => [...args]) };
  } finally {
    spy.mockRestore();
  }
}

/** `o` as one answer line of exactly `bytes` bytes, padded through a `pad` key (ccd's keys ride through verbatim). */
function lineOf(o: Record<string, unknown>, bytes: number): string {
  const bare = Buffer.byteLength(line({ ...o, pad: '' }));
  const out = line({ ...o, pad: 'x'.repeat(bytes - bare) });
  expect(Buffer.byteLength(out)).toBe(bytes);
  return out;
}

describe("check 9: the job's declared wire bound (row 46, M6.5, spec section 6.2)", () => {
  const WARN = 'ccrc-server: docs answer over its declared bound';
  const INDEX_OK = { v: 1, verb: 'docs-index', ok: true, elapsedMs: 5, unlisted: 0, duplicates: [], projects: [] };
  const FETCH_OK = {
    v: 1, verb: 'docs-fetch', ok: true, elapsedMs: 7, branch: 'main', trackedRef: 'refs/remotes/origin/main',
    defaultVia: 'origin/HEAD', before: null, after: SHA, moved: 'unchanged', stamp: 'written',
  };
  const runWith = (stdout: string): CcdDocsDeps => ({ runCcd: recorder(res({ stdout })).run, fleetState: READY });
  const LISTINGS: readonly (readonly [string, Record<string, unknown>, (d: CcdDocsDeps) => Promise<Answer>])[] = [
    ['index', INDEX_OK, (d) => ccdDocsReader(d).index({ node: 'n' })],
    ['tree', TREE_OK, (d) => ccdDocsReader(d).tree(SRC, null)],
    ['fetch', FETCH_OK, (d) => ccdDocsFetcher(d).fetch(SRC, null)],
  ];

  it('a show answer of exactly ask.job.wire bytes passes; one byte over is oversize, logged once', async () => {
    const answer = showOk(COMMITTED);
    const stdout = line(answer);
    const wire = (n: number): DocsShowAsk => ({ ...ASK, job: { raw: PLAN.job.raw, wire: n } });
    const at = await watchingWarn(() => showRaw(COMMITTED, stdout, wire(Buffer.byteLength(stdout))));
    expect(at.out).toEqual({ ok: true, answer, bytes: TEXT_BYTES });
    expect(at.warned).toEqual([]);
    const over = await watchingWarn(() => showRaw(COMMITTED, stdout, wire(Buffer.byteLength(stdout) - 1)));
    expect(over.out).toEqual(malformed('oversize'));
    expect(over.warned).toEqual([[WARN]]);
  });

  it.each(LISTINGS)('%s: an ok answer of exactly LISTING_JOB.wire bytes passes; one byte over is oversize, logged once',
    async (_name, ok, call) => {
      const at = await watchingWarn(() => call(runWith(lineOf(ok, LISTING_JOB.wire))));
      expect(at.out.ok).toBe(true);
      expect(at.warned).toEqual([]);
      const over = await watchingWarn(() => call(runWith(lineOf(ok, LISTING_JOB.wire + 1))));
      expect(over.out).toEqual(malformed('oversize'));
      expect(over.warned).toEqual([[WARN]]);
    });

  it('a ccd failure line one byte over the bound is oversize too; at the bound it is carried', async () => {
    const failure = { v: 1, verb: 'docs-tree', ok: false, elapsedMs: 9, failure: 'git-failed', step: 'cat-file', rc: 128 };
    const at = await watchingWarn(() => treeWith(res({ stdout: lineOf(failure, LISTING_JOB.wire) })));
    expect((at.out as DocsFailureBody).failure).toBe('git-failed');
    expect(at.warned).toEqual([]);
    const over = await watchingWarn(() => treeWith(res({ stdout: lineOf(failure, LISTING_JOB.wire + 1) })));
    expect(over.out).toEqual(malformed('oversize'));
    expect(over.warned).toEqual([[WARN]]);
  });

  it('check 8 wins over check 9: a tampered sha256 one byte over its bound is integrity, and nothing is logged', async () => {
    const stdout = line(showOk(COMMITTED, { sha256: 'b'.repeat(64) }));
    const ask: DocsShowAsk = { ...ASK, job: { raw: PLAN.job.raw, wire: Buffer.byteLength(stdout) - 1 } };
    const out = await watchingWarn(() => showRaw(COMMITTED, stdout, ask));
    expect(out.out).toEqual(malformed('integrity'));
    expect(out.warned).toEqual([]);
  });

  it('check 7 wins over check 9: an unknown word over the bound stays unknown-failure, and nothing is logged', async () => {
    const unknown = { v: 1, verb: 'docs-tree', ok: false, elapsedMs: 9, failure: 'no-such-word' };
    const out = await watchingWarn(() => treeWith(res({ stdout: lineOf(unknown, LISTING_JOB.wire + 1) })));
    expect(out.out).toEqual({ ok: false, failure: 'unknown-failure', word: 'no-such-word' });
    expect(out.warned).toEqual([]);
  });
});

describe('the second redaction pass: every string leaf of a failure body but failure (row 62, L3 half)', () => {
  const failLine = (verb: string, failure: string, ctx: Record<string, unknown>): string =>
    line({ v: 1, verb, ok: false, elapsedMs: 9, failure, ...ctx });
  /** One call of the port operation that runs `verb`, through a recorder answering `stdout`. */
  const callVerb = (verb: string, stdout: string): Promise<Answer> => {
    const deps: CcdDocsDeps = { runCcd: recorder(res({ stdout })).run, fleetState: READY };
    if (verb === 'docs-fetch') return ccdDocsFetcher(deps).fetch(SRC, null);
    if (verb === 'docs-show') return ccdDocsReader(deps).show(SRC, COMMITTED, ASK);
    return ccdDocsReader(deps).tree(SRC, null);
  };
  const TOKEN = `gho_${'A'.repeat(24)}`;

  const PLANTED: readonly (readonly [string, string, string, Record<string, unknown>, Record<string, unknown>])[] = [
    ['git-failed, in stderrHead and detail', 'docs-tree', 'git-failed',
      { step: 'cat-file', rc: 128, stderrHead: 'fatal: https://u:tok@example.invalid/x', detail: 'GET /?access_token=abc&x=1' },
      { step: 'cat-file', rc: 128, stderrHead: 'fatal: https://***@example.invalid/x', detail: 'GET /?access_token=***&x=1' }],
    ['fetch-transport, an Authorization line in detail', 'docs-fetch', 'fetch-transport',
      { detail: 'fetching\nAuthorization: Bearer x\ndone' },
      { detail: 'fetching\nAuthorization: ***\ndone' }],
    ['linked-worktree, a gho_ token in owner', 'docs-tree', 'linked-worktree',
      { owner: `/w/${TOKEN}`, branch: 'main' },
      { owner: '/w/gho_***', branch: 'main' }],
    ['ambiguous-worktree, a token inside a candidates entry', 'docs-show', 'ambiguous-worktree',
      { candidates: ['/w/a?token=abc', '/w/b'] },
      { candidates: ['/w/a?token=***', '/w/b'] }],
    ['unresolved-ref, a token inside a tried entry', 'docs-tree', 'unresolved-ref',
      { tried: [{ ref: 'refs/heads/a?token=abc', result: 'absent' }], suggest: 'main' },
      { tried: [{ ref: 'refs/heads/a?token=***', result: 'absent' }], suggest: 'main' }],
  ];

  it.each(PLANTED)('a planted unredacted ccd line, %s: redacted, failure untouched', async (_label, verb, failure, sent, want) => {
    expect(await callVerb(verb, failLine(verb, failure, sent))).toStrictEqual({ ok: false, failure, ...want });
  });

  it('a server-made body carrying an untrusted string is redacted: unknown-failure {word}', async () => {
    expect(await treeWith(res({ stdout: failLine('docs-tree', 'x?token=abc', {}) })))
      .toStrictEqual({ ok: false, failure: 'unknown-failure', word: 'x?token=***' });
  });

  it('idempotent: a line ccd already redacted comes back unchanged', async () => {
    const ctx = {
      step: 'fetch', rc: 128, stderrHead: 'fatal: https://***@example.invalid/x',
      detail: 'GET /?access_token=***&x=1\nAuthorization: ***', owner: '/w/gho_***',
    };
    expect(await treeWith(res({ stdout: failLine('docs-tree', 'git-failed', ctx) })))
      .toStrictEqual({ ok: false, failure: 'git-failed', ...ctx });
  });

  it('an ok answer is never rewritten: a tree entry path holding ?token=abc comes back as ccd sent it', async () => {
    const tree = { ...TREE_OK, entries: [{ path: 'a?token=abc.md' }] };
    expect(await treeWith(res({ stdout: line(tree) }))).toStrictEqual({ ok: true, answer: tree });
  });
});
```

- [ ] **Step 2: Run them to verify they fail.** Foreground, Bash timeout 600000 ms.

Run: `( cd server && ./node_modules/.bin/vitest run test/docs-source.test.ts )`
Expected: `Tests  29 failed | 84 passed (113)`. Red: the 16 `ROWS` cases, `a draft whose fp echoes its pin but is not its sha256: pin` and the blob case (Task 6's `show` hands back any answer that decodes); the show, three listing and ccd-failure-line bound cases and `check 8 wins over check 9` (no check 9 yet, so the over-bound answer passes, and the tampered sha256 is not caught); the five planted redaction rows (no second pass). Already green, by design (8): the canonical base64 answer and the three `onRef` words (ok answers that Task 6 already carries), `check 7 wins over check 9` (an unknown word is answered at check 7 either way), the `unknown-failure {word}` row (Task 6's check 7 redacts its word), the idempotent row and the ok-tree row (Task 6 rewrites neither). They hold Step 3's code, not its absence: six red under a mutation below (the ok answers under M5 and M27, the check-7 row under M19, the ok-tree row under M27); the idempotent row is a regression pin with no guard of its own here (the redactor's idempotence is `docs-shared`'s), and so is the `unknown-failure {word}` row (departure (5)).

- [ ] **Step 3: Write the implementation.** Eleven edits to `server/src/docs/ccdsource.ts`, in file order.

Edit — the header's rules gain checks 8-9 and the one exit (line 21 at Task 6's state). Find:

```ts
// - A server-made string carrying ccd's untrusted text (`cause`, `stderrHead`, check 7's `word`) is redacted BEFORE it
//   is cut to 512 bytes, so a cut cannot split a secret past the redactor and no such string rides in unbounded.
```

Replace with:

```ts
// - A server-made string carrying ccd's untrusted text (`cause`, `stderrHead`, check 7's `word`) is redacted BEFORE it
//   is cut to 512 bytes, so a cut cannot split a secret past the redactor and no such string rides in unbounded.
// - A show answer is held to the bytes it encodes and to the pin it was asked for (check 8), and every answer that
//   reaches check 9 is held to its job's declared wire bound.
// - ONE EXIT: every failure body leaves through `settle`, which runs the redactor a second time over each of its string
//   leaves but `failure`, at any depth (refinement (k)). An ok answer is never rewritten.
```

Edit — `node:crypto` above the first import (line 25). Find:

```ts
import { CCD_ARGV, DOCS_CAP, capSupported } from '../ccdargv.js';
```

Replace with:

```ts
import { createHash } from 'node:crypto';
import { CCD_ARGV, DOCS_CAP, capSupported } from '../ccdargv.js';
```

Edit — `LISTING_JOB` and `DocsJob` from L1, above the ports import (line 33). Find:

```ts
import type { DocsFetchRun, DocsFetcher, DocsReader, DocsShowAsk, DocsShowRead } from './ports.js';
```

Replace with:

```ts
import { LISTING_JOB, type DocsJob } from './policy.js';
import type { DocsFetchRun, DocsFetcher, DocsReader, DocsShowAsk, DocsShowRead } from './ports.js';
```

Edit — `ON_REF_WORDS` after `ENVELOPE_ONLY_KEYS` (line 58). Find:

```ts
const ENVELOPE_ONLY_KEYS: ReadonlySet<string> = new Set(['v', 'verb', 'elapsedMs']);
```

Replace with:

```ts
const ENVELOPE_ONLY_KEYS: ReadonlySet<string> = new Set(['v', 'verb', 'elapsedMs']);

/** The three words a committed show answer's `onRef` may carry (section 3.5), keyed by the L0 type, so a word added
 *  there is a compile error here until it is listed. An answer without one, or with any other, is `{why:'schema'}`. */
const ON_REF_WORDS: Readonly<Record<NonNullable<DocsShowOk['onRef']>, true>> =
  { contains: true, 'not-contained': true, unmeasured: true };
```

Edit — `DocsLine` now names what passed checks 6-7, and `DocsAccept` is declared beside it (lines 69-71). Find:

```ts
/** A classified answer: ccd's ok line as parsed (its shape is the verb's ok type; only the envelope was checked), or
 *  the failure body. */
type DocsLine = { ok: true; line: Readonly<Record<string, unknown>> } | DocsFailureBody;
```

Replace with:

```ts
/** A line that passed checks 6 and 7, as parsed: ccd's ok line (its shape is the verb's ok type; only the envelope
 *  was checked) or ccd's failure line carrying a word of ccd's set, told apart by the line's own `ok`. Or the
 *  failure body an earlier check made. */
type DocsLine = { ok: true; line: Readonly<Record<string, unknown>> } | DocsFailureBody;

/** What one port operation checks of ccd's ok line beyond the envelope, and what it answers: check 8 and the decoded
 *  bytes for a show (`checkShow`), the line as the verb's ok type for the others. */
type DocsAccept<T extends { ok: true }> = (line: Readonly<Record<string, unknown>>) => T | DocsFailureBody;
```

Edit — `classify`'s docstring tail and head gain checks 8-9 (lines 142-144). Find:

```ts
 * 6-7. `parseLine`.
 */
function classify(verb: DocsVerb, res: CcdResult): DocsLine {
```

Replace with:

```ts
 * 6-7. `parseLine`.
 * 8. An ok line goes through `accept` (for a show, `checkShow`); a failure there wins over check 9.
 * 9. Every answer that reached here, an ok line that passed check 8 or a ccd failure line, is held to `job.wire`
 *    (`checkBound`). A body that checks 1-7 made never reaches it: the first match wins.
 */
function classify<T extends { ok: true }>(verb: DocsVerb, res: CcdResult, job: DocsJob, accept: DocsAccept<T>):
  T | DocsFailureBody {
```

Edit — `classify`'s last line becomes checks 8-9, and `checkBound` follows it (lines 154-156). Find:

```ts
  if (!res.ok) return fail('ccd-fault', { stderrHead: stderrHeadOf(res.stderr) });
  return parseLine(verb, res.stdout);
}
```

Replace with:

```ts
  if (!res.ok) return fail('ccd-fault', { stderrHead: stderrHeadOf(res.stderr) });
  const read = parseLine(verb, res.stdout);
  if (!read.ok) return read;
  if (read.line.ok !== true) return checkBound(ccdFailureBody(read.line), res.stdout, job);
  const accepted = accept(read.line);
  return accepted.ok ? checkBound(accepted, res.stdout, job) : accepted;
}

/** Check 9 (section 6.2): a stdout over the job's declared wire bound is `malformed-answer {why:'oversize'}`, logged
 *  once. The framed bound is ccd's own contract, pinned by ccd's tests; this is the server's backstop for a ccd that
 *  broke it. `>`, never `>=`: an answer of exactly `job.wire` bytes is within its bound. */
function checkBound<A>(answer: A, stdout: string, job: DocsJob): A | DocsFailureBody {
  if (Buffer.byteLength(stdout) > job.wire) {
    console.warn('ccrc-server: docs answer over its declared bound');
    return fail('malformed-answer', { why: 'oversize' });
  }
  return answer;
}
```

Edit — `parseLine`'s docstring, check 7's last clause (lines 163-164). Find:

```ts
 * 7. A word outside ccd's set (a server-only word included) is `unknown-failure {word}`, the word via `stderrHeadOf`;
 *    a ccd word is `ccdFailureBody`.
```

Replace with:

```ts
 * 7. A word outside ccd's set (a server-only word included) is `unknown-failure {word}`, the word via `stderrHeadOf`;
 *    a line carrying a ccd word is handed back as parsed, for check 9 and then `ccdFailureBody` (`classify`).
```

Edit — `parseLine` hands a ccd failure line back as parsed (lines 179-181). Find:

```ts
  if (!CCD_WORDS.has(line.failure)) return fail('unknown-failure', { word: stderrHeadOf(line.failure) });
  return ccdFailureBody(line);
}
```

Replace with:

```ts
  if (!CCD_WORDS.has(line.failure)) return fail('unknown-failure', { word: stderrHeadOf(line.failure) });
  return { ok: true, line };
}
```

Edit — `checkShow`, `showFault`, the second redaction pass and `settle`, after `decodeShowBytes` (lines 195-197). Find:

```ts
  if (ans.encoding === 'base64' && typeof ans.b64 === 'string') return { ok: true, bytes: Buffer.from(ans.b64, 'base64') };
  return fail('malformed-answer', { why: 'schema' });
}
```

Replace with:

```ts
  if (ans.encoding === 'base64' && typeof ans.b64 === 'string') return { ok: true, bytes: Buffer.from(ans.b64, 'base64') };
  return fail('malformed-answer', { why: 'schema' });
}

/** Check 8's word: `malformed-answer` with the named `why`. */
function showFault(why: 'integrity' | 'pin' | 'schema'): DocsFailureBody {
  return fail('malformed-answer', { why });
}

/**
 * Check 8 (show only), over an ok answer that passed checks 1-7, in this order; the first match wins.
 * - The bytes, decoded once (`decodeShowBytes`): an encoding naming no field it carries is `{why:'schema'}`.
 * - Integrity, `{why:'integrity'}`: a base64 answer is canonical (its bytes re-encode to exactly `b64`, so no missing
 *   padding, stray character or stray bits ride along), the bytes are `size` long, and their sha256 is `sha256`.
 * - Pins, `{why:'pin'}`: `source` is the request's mode, and the answer echoes `section` and `path`; for a draft pin
 *   `branch`, `head` and `fp`, with `fp` equal to `sha256`; for a committed pin `commit`, and `blob` equal to the
 *   listing's when the server holds one (`ask.listedBlob`, whose `null` means only that it holds none).
 * - A committed answer's `onRef` is one of `ON_REF_WORDS`: absent or any other value is `{why:'schema'}`.
 */
function checkShow(ans: DocsShowOk, pin: DocPin, ask: DocsShowAsk): { ok: true; bytes: Uint8Array } | DocsFailureBody {
  const decoded = decodeShowBytes(ans);
  if (!decoded.ok) return decoded;
  const bytes = decoded.bytes;
  if (ans.encoding === 'base64' && Buffer.from(bytes).toString('base64') !== ans.b64) return showFault('integrity');
  if (bytes.length !== ans.size) return showFault('integrity');
  if (createHash('sha256').update(bytes).digest('hex') !== ans.sha256) return showFault('integrity');
  if (ans.source !== pin.kind || ans.section !== pin.section || ans.path !== pin.path) return showFault('pin');
  if (pin.kind === 'draft') {
    if (ans.branch !== pin.branch || ans.head !== pin.head || ans.fp !== pin.fp) return showFault('pin');
    return ans.fp === ans.sha256 ? { ok: true, bytes } : showFault('pin');
  }
  if (ans.commit !== pin.commit) return showFault('pin');
  if (ask.listedBlob !== null && ans.blob !== ask.listedBlob) return showFault('pin');
  if (!Object.hasOwn(ON_REF_WORDS, ans.onRef ?? '')) return showFault('schema');
  return { ok: true, bytes };
}

/** `v` with every string leaf passed through the redactor: arrays and plain objects are rebuilt (`Object.fromEntries`
 *  defines each key as an own property), numbers, booleans and `null` are kept as they are. */
function redactLeaves(v: unknown): unknown {
  if (typeof v === 'string') return redactDocsText(v);
  if (Array.isArray(v)) return v.map(redactLeaves);
  if (typeof v === 'object' && v !== null) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, redactLeaves(x)]));
  return v;
}

/**
 * The second redaction pass (section 2 (b) "One redactor", refinement (k)): a new body whose every string leaf but
 * `failure` has been through `redactDocsText`, at any depth (`candidates`, `tried`), server-made bodies included. ccd
 * ran the same rules over what it derived from stderr; this pass covers whatever it missed or did not derive from
 * stderr, and changes nothing already redacted (the redactor is idempotent). Absent stays absent, `null` stays `null`.
 */
function redactBody(body: DocsFailureBody): DocsFailureBody {
  const out = Object.fromEntries(Object.entries(body).map(([key, v]) => [key, key === 'failure' ? v : redactLeaves(v)]));
  return out as unknown as DocsFailureBody;
}

/**
 * THE ONE EXIT of every port operation: the gate's body, or checks 1-9 over the run (`classify`), with any failure
 * body, whatever made it, through `redactBody`. An ok answer is returned exactly as checked, never rewritten.
 */
function settle<T extends { ok: true }>(ran: DocsRan, verb: DocsVerb, job: DocsJob, accept: DocsAccept<T>):
  T | DocsFailureBody {
  const out = ran.ok ? classify(verb, ran.res, job, accept) : ran;
  return out.ok ? out : redactBody(out);
}
```

Edit — the two port factories answer through `settle` (lines 199-236, to EOF). Find:

```ts
/** The read port over ccd. Bound to the node whose `CcdRunner` it holds; `index`'s `at` names that node. */
export function ccdDocsReader(deps: CcdDocsDeps): DocsReader {
  return {
    index: async () => {
      const ran = await readDocs(deps, { verb: 'docs-index' });
      if (!ran.ok) return ran;
      const read = classify('docs-index', ran.res);
      return read.ok ? { ok: true, answer: read.line as unknown as DocsIndexOk } : read;
    },
    tree: async (src, ref) => {
      const ran = await readDocs(deps, { verb: 'docs-tree', project: src.project, ref });
      if (!ran.ok) return ran;
      const read = classify('docs-tree', ran.res);
      return read.ok ? { ok: true, answer: read.line as unknown as DocsTreeOk } : read;
    },
    show: async (src, pin, ask): Promise<DocsShowRead> => {
      const ran = await readDocs(deps, { verb: 'docs-show', project: src.project, pin, ask });
      if (!ran.ok) return ran;
      const read = classify('docs-show', ran.res);
      if (!read.ok) return read;
      const answer = read.line as unknown as DocsShowOk;
      const decoded = decodeShowBytes(answer);
      return decoded.ok ? { ok: true, answer, bytes: decoded.bytes } : decoded;
    },
  };
}

/** The fetch port over ccd: the one docs operation that writes, built apart from the reader (section 2 (g)'s wall 1). */
export function ccdDocsFetcher(deps: CcdDocsDeps): DocsFetcher {
  return {
    fetch: async (src, branch): Promise<DocsFetchRun> => {
      const ran = await fetchDocs(deps, src.project, branch);
      if (!ran.ok) return ran;
      const read = classify('docs-fetch', ran.res);
      return read.ok ? { ok: true, answer: read.line as unknown as DocsFetchOk } : read;
    },
  };
}
```

Replace with:

```ts
/** The read port over ccd. Bound to the node whose `CcdRunner` it holds; `index`'s `at` names that node. A listing
 *  answer is held to `LISTING_JOB`, a show answer to its own `ask.job` (check 9). */
export function ccdDocsReader(deps: CcdDocsDeps): DocsReader {
  return {
    index: async () => settle(await readDocs(deps, { verb: 'docs-index' }), 'docs-index', LISTING_JOB,
      (line) => ({ ok: true, answer: line as unknown as DocsIndexOk })),
    tree: async (src, ref) => settle(await readDocs(deps, { verb: 'docs-tree', project: src.project, ref }), 'docs-tree',
      LISTING_JOB, (line) => ({ ok: true, answer: line as unknown as DocsTreeOk })),
    show: async (src, pin, ask): Promise<DocsShowRead> => settle(
      await readDocs(deps, { verb: 'docs-show', project: src.project, pin, ask }), 'docs-show', ask.job, (line) => {
        const answer = line as unknown as DocsShowOk;
        const shown = checkShow(answer, pin, ask);
        return shown.ok ? { ok: true, answer, bytes: shown.bytes } : shown;
      }),
  };
}

/** The fetch port over ccd: the one docs operation that writes, built apart from the reader (section 2 (g)'s wall 1).
 *  Its answer is under 1 KiB, held to `LISTING_JOB` (refinement (e): the spec names no fetch job). */
export function ccdDocsFetcher(deps: CcdDocsDeps): DocsFetcher {
  return {
    fetch: async (src, branch): Promise<DocsFetchRun> => settle(await fetchDocs(deps, src.project, branch), 'docs-fetch',
      LISTING_JOB, (line) => ({ ok: true, answer: line as unknown as DocsFetchOk })),
  };
}
```

- [ ] **Step 4: Run them to verify they pass.** Foreground, Bash timeout 600000 ms.

Run: `( cd server && ./node_modules/.bin/vitest run test/docs-source.test.ts )`
Expected: `Test Files  1 passed (1)`, `Tests  113 passed (113)` (Task 6's 76 and this task's 37), every Task 6 case still green: the gate's bodies, the transport, ending and envelope words and the verbatim rebuild all leave through `settle` now, and `redactBody` keeps absent absent, `null` `null` and numbers as numbers (Task 6's `lockAgeMs`, `branch: null` and `unwalked` cases hold it).

- [ ] **Step 5: The guard suites and the compiles.** Foreground, Bash timeout 600000 ms each; `typecheck-tests` is a known load flake, so a red there is re-run alone before it is called broken.

Run: `( cd server && node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit && node node_modules/typescript/bin/tsc -p test/tsconfig.tests.json --noEmit && echo TSC-OK )`
Expected: `TSC-OK`. The first compiles `settle`'s inference of each port operation's ok arm from its `accept` callback, `ON_REF_WORDS`'s `Record` keyed by the L0 union (a fourth `onRef` word in `shared/docs.ts` would be a compile error here) and `Object.hasOwn` (ES2022, the server's target); the second compiles the test's `vi.spyOn(console, 'warn')` and the typed `ROWS`, `LISTINGS` and `PLANTED` tables.

Run: `( cd server && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts )`
Expected: `Tests  12 passed (12)`. With a symlinked `pwa/node_modules` only `PWA_TSC really is pwa's own installed compiler` reds (Task 1's Measured 5); Task 1's Step 0 installs real modules.

Run: `( cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts test/topology-clean.test.ts test/ccdargv-brand.test.ts test/exec.test.ts )`
Expected: `Test Files  4 passed (4)`, `Tests  488 passed (488)` (399 + 55 + 13 + 21). `topology-clean` needs `origin/main` (Task 1's Measured 5): without it only `resolved a base to measure against — a missing one is RED, never vacuous` reds. `ccdsource.ts` spells no redactor fragment (it imports `redactDocsText`), no quoted `'docs-v1'`, no qualified ref prefix and no `'absent'`/`'unreadable'` pair; the test file quotes `access_token=`, `Authorization:`, `gho_` and `refs/heads/` as fixture data under `server/test`, which `single-definition`'s `ROOTS` do not scan, and its tokens are placeholders (`u:tok@example.invalid`, `'A'.repeat(24)`).

Run: `( cd server && ./node_modules/.bin/vitest run test/docs-shared.test.ts test/docs-parity.test.ts )`
Expected: `Test Files  2 passed (2)`, `Tests  284 passed (284)` (239 + 45): the redactor's one home and its python copy are untouched.

Run: `( cd server && ./node_modules/.bin/vitest run test/verb-gate.test.ts test/capsupported.test.ts test/docs-policy.test.ts )`
Expected: `Test Files  3 passed (3)`, `Tests  339 passed (339)` (34 + 305). `verb-gate` reads the nearest enclosing function of each `CCD_ARGV.docs*(` call; those calls are still in `readDocs` and `fetchDocs`, which this task does not edit (`settle` and the factories call the executors, never `CCD_ARGV`).

No `ccd/ccd` edit, so no restamp and no citation tax. Task 8 appends the docs ring guard, which checks this file's imports: `node:crypto` and `./policy.js` are both on L3's list.

- [ ] **Step 6: Commit.**

```bash
git add server/src/docs/ccdsource.ts server/test/docs-source.test.ts
git commit -m "server: docs adapter integrity, wire bound and second redaction pass (docs W2)" \
  -m "Check 8 (show only): the answer's bytes, decoded once, must be canonical base64 when base64 (a re-encode equals b64, so node's lenient decoder cannot pass a missing pad, a stray character or stray bits), size bytes long and of the stated sha256 (integrity); source must be the request's mode and the answer must echo section, path and commit, or branch, head and fp with fp equal to sha256, and a committed blob the listing's when the server holds one (pin); a committed onRef must be one of its three words (schema). Check 9 holds every answer that reached it, an ok line past check 8 or a ccd failure line, to its job's wire bound (listings and fetch LISTING_JOB, show ask.job): one byte over is malformed-answer {why:'oversize'} with console.warn('ccrc-server: docs answer over its declared bound') (row 46, M6.5). Every failure body now leaves through one exit, settle, which redacts every string leaf but failure a second time, recursively; an ok answer is never rewritten (row 62, L3 half)." \
  -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

**Mutation rows this task contributes** (each measured red in a separate copy of the tree at this task's state, never in the worktree; `pkg` is the package the `tests` run in; `old` is unique in `file` at this task's state; `red` is the measured summary and the cases that went red). The architecture's W2-T7-M1..M9 map onto these as: M1 -> M1, M2 -> M2, M3 -> M3, M4 -> M4 and M5, M5 -> M6, M6 -> M15 and M16 (check 9's two arms, each alone), M7 -> M17, M8 -> M22, M23, M24, M25 and M26 (array arm, object arm, top-level strings only, `detail` only, the pass removed), M9 -> M27; M7-M14 and M18-M21 are the echoes, the draft `fp === sha256`, the check order on both sides of check 9, the show job and the log line, each a guard this task adds.

```json
[
 {
  "id": "W2-T7-M1",
  "pkg": "server",
  "file": "server/src/docs/ccdsource.ts",
  "old": "  if (createHash('sha256').update(bytes).digest('hex') !== ans.sha256) return showFault('integrity');\n",
  "new": "",
  "tests": [
   "test/docs-source.test.ts"
  ],
  "red": "Tests 2 failed | 111 passed (113) — test/docs-source.test.ts > a tampered sha256: malformed-answer {why}; test/docs-source.test.ts > check 8 wins over check 9: a tampered sha256 one byte over its bound is integrity, and nothing is logged"
 },
 {
  "id": "W2-T7-M2",
  "pkg": "server",
  "file": "server/src/docs/ccdsource.ts",
  "old": "  if (bytes.length !== ans.size) return showFault('integrity');\n",
  "new": "",
  "tests": [
   "test/docs-source.test.ts"
  ],
  "red": "Tests 2 failed | 111 passed (113) — test/docs-source.test.ts > a size one over the bytes: malformed-answer {why}; test/docs-source.test.ts > a size one under the bytes: malformed-answer {why}"
 },
 {
  "id": "W2-T7-M3",
  "pkg": "server",
  "file": "server/src/docs/ccdsource.ts",
  "old": "  if (ans.encoding === 'base64' && Buffer.from(bytes).toString('base64') !== ans.b64) return showFault('integrity');\n",
  "new": "",
  "tests": [
   "test/docs-source.test.ts"
  ],
  "red": "Tests 3 failed | 110 passed (113) — test/docs-source.test.ts > base64 without its padding: malformed-answer {why}; test/docs-source.test.ts > base64 with a stray character: malformed-answer {why}; test/docs-source.test.ts > base64 with stray bits in its last character: malformed-answer {why}"
 },
 {
  "id": "W2-T7-M4",
  "pkg": "server",
  "file": "server/src/docs/ccdsource.ts",
  "old": "  if (ask.listedBlob !== null && ans.blob !== ask.listedBlob) return showFault('pin');\n",
  "new": "",
  "tests": [
   "test/docs-source.test.ts"
  ],
  "red": "Tests 1 failed | 112 passed (113) — test/docs-source.test.ts > a committed blob is held to the listing's when the server holds one, and to nothing when it holds none"
 },
 {
  "id": "W2-T7-M5",
  "pkg": "server",
  "file": "server/src/docs/ccdsource.ts",
  "old": "  if (ask.listedBlob !== null && ans.blob !== ask.listedBlob) return showFault('pin');",
  "new": "  if (ans.blob !== ask.listedBlob) return showFault('pin');",
  "tests": [
   "test/docs-source.test.ts"
  ],
  "red": "Tests 9 failed | 104 passed (113) — test/docs-source.test.ts > a committed utf8 answer carries the answer and the UTF-8 of its text; test/docs-source.test.ts > a canonical base64 committed answer is ok, carrying its decoded bytes; test/docs-source.test.ts > a committed answer without onRef: malformed-answer {why}; test/docs-source.test.ts > a committed answer with onRef 'maybe': malformed-answer {why}; ... (9 in all)"
 },
 {
  "id": "W2-T7-M6",
  "pkg": "server",
  "file": "server/src/docs/ccdsource.ts",
  "old": "  if (!Object.hasOwn(ON_REF_WORDS, ans.onRef ?? '')) return showFault('schema');\n",
  "new": "",
  "tests": [
   "test/docs-source.test.ts"
  ],
  "red": "Tests 2 failed | 111 passed (113) — test/docs-source.test.ts > a committed answer without onRef: malformed-answer {why}; test/docs-source.test.ts > a committed answer with onRef 'maybe': malformed-answer {why}"
 },
 {
  "id": "W2-T7-M7",
  "pkg": "server",
  "file": "server/src/docs/ccdsource.ts",
  "old": "    if (ans.branch !== pin.branch || ans.head !== pin.head || ans.fp !== pin.fp) return showFault('pin');",
  "new": "    if (ans.head !== pin.head || ans.fp !== pin.fp) return showFault('pin');",
  "tests": [
   "test/docs-source.test.ts"
  ],
  "red": "Tests 1 failed | 112 passed (113) — test/docs-source.test.ts > a draft branch that is not the pin: malformed-answer {why}"
 },
 {
  "id": "W2-T7-M8",
  "pkg": "server",
  "file": "server/src/docs/ccdsource.ts",
  "old": "    if (ans.branch !== pin.branch || ans.head !== pin.head || ans.fp !== pin.fp) return showFault('pin');",
  "new": "    if (ans.branch !== pin.branch || ans.fp !== pin.fp) return showFault('pin');",
  "tests": [
   "test/docs-source.test.ts"
  ],
  "red": "Tests 1 failed | 112 passed (113) — test/docs-source.test.ts > a draft head that is not the pin: malformed-answer {why}"
 },
 {
  "id": "W2-T7-M9",
  "pkg": "server",
  "file": "server/src/docs/ccdsource.ts",
  "old": "    if (ans.branch !== pin.branch || ans.head !== pin.head || ans.fp !== pin.fp) return showFault('pin');",
  "new": "    if (ans.branch !== pin.branch || ans.head !== pin.head) return showFault('pin');",
  "tests": [
   "test/docs-source.test.ts"
  ],
  "red": "Tests 1 failed | 112 passed (113) — test/docs-source.test.ts > a draft fp that is its sha256 but not the pin: malformed-answer {why}"
 },
 {
  "id": "W2-T7-M10",
  "pkg": "server",
  "file": "server/src/docs/ccdsource.ts",
  "old": "    return ans.fp === ans.sha256 ? { ok: true, bytes } : showFault('pin');",
  "new": "    return { ok: true, bytes };",
  "tests": [
   "test/docs-source.test.ts"
  ],
  "red": "Tests 1 failed | 112 passed (113) — test/docs-source.test.ts > a draft whose fp echoes its pin but is not its sha256: pin"
 },
 {
  "id": "W2-T7-M11",
  "pkg": "server",
  "file": "server/src/docs/ccdsource.ts",
  "old": "  if (ans.source !== pin.kind || ans.section !== pin.section || ans.path !== pin.path) return showFault('pin');",
  "new": "  if (ans.section !== pin.section || ans.path !== pin.path) return showFault('pin');",
  "tests": [
   "test/docs-source.test.ts"
  ],
  "red": "Tests 2 failed | 111 passed (113) — test/docs-source.test.ts > source 'draft' answering a committed pin: malformed-answer {why}; test/docs-source.test.ts > source 'committed' answering a draft pin: malformed-answer {why}"
 },
 {
  "id": "W2-T7-M12",
  "pkg": "server",
  "file": "server/src/docs/ccdsource.ts",
  "old": "  if (ans.source !== pin.kind || ans.section !== pin.section || ans.path !== pin.path) return showFault('pin');",
  "new": "  if (ans.source !== pin.kind || ans.path !== pin.path) return showFault('pin');",
  "tests": [
   "test/docs-source.test.ts"
  ],
  "red": "Tests 1 failed | 112 passed (113) — test/docs-source.test.ts > a section that is not the pin: malformed-answer {why}"
 },
 {
  "id": "W2-T7-M13",
  "pkg": "server",
  "file": "server/src/docs/ccdsource.ts",
  "old": "  if (ans.source !== pin.kind || ans.section !== pin.section || ans.path !== pin.path) return showFault('pin');",
  "new": "  if (ans.source !== pin.kind || ans.section !== pin.section) return showFault('pin');",
  "tests": [
   "test/docs-source.test.ts"
  ],
  "red": "Tests 1 failed | 112 passed (113) — test/docs-source.test.ts > a path that is not the pin: malformed-answer {why}"
 },
 {
  "id": "W2-T7-M14",
  "pkg": "server",
  "file": "server/src/docs/ccdsource.ts",
  "old": "  if (ans.commit !== pin.commit) return showFault('pin');\n",
  "new": "",
  "tests": [
   "test/docs-source.test.ts"
  ],
  "red": "Tests 1 failed | 112 passed (113) — test/docs-source.test.ts > a commit that is not the pin: malformed-answer {why}"
 },
 {
  "id": "W2-T7-M15",
  "pkg": "server",
  "file": "server/src/docs/ccdsource.ts",
  "old": "  return accepted.ok ? checkBound(accepted, res.stdout, job) : accepted;",
  "new": "  return accepted;",
  "tests": [
   "test/docs-source.test.ts"
  ],
  "red": "Tests 4 failed | 109 passed (113) — test/docs-source.test.ts > a show answer of exactly ask.job.wire bytes passes; one byte over is oversize, logged once; test/docs-source.test.ts > index: an ok answer of exactly LISTING_JOB.wire bytes passes; one byte over is oversize, logged once; test/docs-source.test.ts > tree: an ok answer of exactly LISTING_JOB.wire bytes passes; one byte over is oversize, logged once; test/docs-source.test.ts > fetch: an ok answer of exactly LISTING_JOB.wire bytes passes; one byte over is oversize, logged once"
 },
 {
  "id": "W2-T7-M16",
  "pkg": "server",
  "file": "server/src/docs/ccdsource.ts",
  "old": "  if (read.line.ok !== true) return checkBound(ccdFailureBody(read.line), res.stdout, job);",
  "new": "  if (read.line.ok !== true) return ccdFailureBody(read.line);",
  "tests": [
   "test/docs-source.test.ts"
  ],
  "red": "Tests 1 failed | 112 passed (113) — test/docs-source.test.ts > a ccd failure line one byte over the bound is oversize too; at the bound it is carried"
 },
 {
  "id": "W2-T7-M17",
  "pkg": "server",
  "file": "server/src/docs/ccdsource.ts",
  "old": "  if (Buffer.byteLength(stdout) > job.wire) {",
  "new": "  if (Buffer.byteLength(stdout) >= job.wire) {",
  "tests": [
   "test/docs-source.test.ts"
  ],
  "red": "Tests 5 failed | 108 passed (113) — test/docs-source.test.ts > a show answer of exactly ask.job.wire bytes passes; one byte over is oversize, logged once; test/docs-source.test.ts > index: an ok answer of exactly LISTING_JOB.wire bytes passes; one byte over is oversize, logged once; test/docs-source.test.ts > tree: an ok answer of exactly LISTING_JOB.wire bytes passes; one byte over is oversize, logged once; test/docs-source.test.ts > fetch: an ok answer of exactly LISTING_JOB.wire bytes passes; one byte over is oversize, logged once; ... (5 in all)"
 },
 {
  "id": "W2-T7-M18",
  "pkg": "server",
  "file": "server/src/docs/ccdsource.ts",
  "old": "  const accepted = accept(read.line);\n  return accepted.ok ? checkBound(accepted, res.stdout, job) : accepted;",
  "new": "  const bounded = checkBound(read.line, res.stdout, job);\n  return bounded === read.line ? accept(read.line) : bounded;",
  "tests": [
   "test/docs-source.test.ts"
  ],
  "red": "Tests 1 failed | 112 passed (113) — test/docs-source.test.ts > check 8 wins over check 9: a tampered sha256 one byte over its bound is integrity, and nothing is logged"
 },
 {
  "id": "W2-T7-M19",
  "pkg": "server",
  "file": "server/src/docs/ccdsource.ts",
  "old": "  if (!read.ok) return read;\n",
  "new": "  if (!read.ok) return checkBound(read, res.stdout, job);\n",
  "tests": [
   "test/docs-source.test.ts"
  ],
  "red": "Tests 1 failed | 112 passed (113) — test/docs-source.test.ts > check 7 wins over check 9: an unknown word over the bound stays unknown-failure, and nothing is logged"
 },
 {
  "id": "W2-T7-M20",
  "pkg": "server",
  "file": "server/src/docs/ccdsource.ts",
  "old": "'docs-show', ask.job, (line) => {",
  "new": "'docs-show', LISTING_JOB, (line) => {",
  "tests": [
   "test/docs-source.test.ts"
  ],
  "red": "Tests 1 failed | 112 passed (113) — test/docs-source.test.ts > a show answer of exactly ask.job.wire bytes passes; one byte over is oversize, logged once"
 },
 {
  "id": "W2-T7-M21",
  "pkg": "server",
  "file": "server/src/docs/ccdsource.ts",
  "old": "    console.warn('ccrc-server: docs answer over its declared bound');\n",
  "new": "",
  "tests": [
   "test/docs-source.test.ts"
  ],
  "red": "Tests 5 failed | 108 passed (113) — test/docs-source.test.ts > a show answer of exactly ask.job.wire bytes passes; one byte over is oversize, logged once; test/docs-source.test.ts > index: an ok answer of exactly LISTING_JOB.wire bytes passes; one byte over is oversize, logged once; test/docs-source.test.ts > tree: an ok answer of exactly LISTING_JOB.wire bytes passes; one byte over is oversize, logged once; test/docs-source.test.ts > fetch: an ok answer of exactly LISTING_JOB.wire bytes passes; one byte over is oversize, logged once; ... (5 in all)"
 },
 {
  "id": "W2-T7-M22",
  "pkg": "server",
  "file": "server/src/docs/ccdsource.ts",
  "old": "  if (Array.isArray(v)) return v.map(redactLeaves);\n",
  "new": "",
  "tests": [
   "test/docs-source.test.ts"
  ],
  "red": "Tests 3 failed | 110 passed (113) — test/docs-source.test.ts > a ccd word keeps exactly its line, minus v, verb and elapsedMs; test/docs-source.test.ts > a planted unredacted ccd line, ambiguous-worktree, a token inside a candidates entry: redacted, failure untouched; test/docs-source.test.ts > a planted unredacted ccd line, unresolved-ref, a token inside a tried entry: redacted, failure untouched"
 },
 {
  "id": "W2-T7-M23",
  "pkg": "server",
  "file": "server/src/docs/ccdsource.ts",
  "old": "  if (typeof v === 'object' && v !== null) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, redactLeaves(x)]));\n",
  "new": "",
  "tests": [
   "test/docs-source.test.ts"
  ],
  "red": "Tests 1 failed | 112 passed (113) — test/docs-source.test.ts > a planted unredacted ccd line, unresolved-ref, a token inside a tried entry: redacted, failure untouched"
 },
 {
  "id": "W2-T7-M24",
  "pkg": "server",
  "file": "server/src/docs/ccdsource.ts",
  "old": "key === 'failure' ? v : redactLeaves(v)",
  "new": "key === 'failure' || typeof v !== 'string' ? v : redactDocsText(v)",
  "tests": [
   "test/docs-source.test.ts"
  ],
  "red": "Tests 2 failed | 111 passed (113) — test/docs-source.test.ts > a planted unredacted ccd line, ambiguous-worktree, a token inside a candidates entry: redacted, failure untouched; test/docs-source.test.ts > a planted unredacted ccd line, unresolved-ref, a token inside a tried entry: redacted, failure untouched"
 },
 {
  "id": "W2-T7-M25",
  "pkg": "server",
  "file": "server/src/docs/ccdsource.ts",
  "old": "key === 'failure' ? v : redactLeaves(v)",
  "new": "key === 'detail' ? redactLeaves(v) : v",
  "tests": [
   "test/docs-source.test.ts"
  ],
  "red": "Tests 4 failed | 109 passed (113) — test/docs-source.test.ts > a planted unredacted ccd line, git-failed, in stderrHead and detail: redacted, failure untouched; test/docs-source.test.ts > a planted unredacted ccd line, linked-worktree, a gho_ token in owner: redacted, failure untouched; test/docs-source.test.ts > a planted unredacted ccd line, ambiguous-worktree, a token inside a candidates entry: redacted, failure untouched; test/docs-source.test.ts > a planted unredacted ccd line, unresolved-ref, a token inside a tried entry: redacted, failure untouched"
 },
 {
  "id": "W2-T7-M26",
  "pkg": "server",
  "file": "server/src/docs/ccdsource.ts",
  "old": "  return out.ok ? out : redactBody(out);",
  "new": "  return out;",
  "tests": [
   "test/docs-source.test.ts"
  ],
  "red": "Tests 5 failed | 108 passed (113) — test/docs-source.test.ts > a planted unredacted ccd line, git-failed, in stderrHead and detail: redacted, failure untouched; test/docs-source.test.ts > a planted unredacted ccd line, fetch-transport, an Authorization line in detail: redacted, failure untouched; test/docs-source.test.ts > a planted unredacted ccd line, linked-worktree, a gho_ token in owner: redacted, failure untouched; test/docs-source.test.ts > a planted unredacted ccd line, ambiguous-worktree, a token inside a candidates entry: redacted, failure untouched; ... (5 in all)"
 },
 {
  "id": "W2-T7-M27",
  "pkg": "server",
  "file": "server/src/docs/ccdsource.ts",
  "old": "  return out.ok ? out : redactBody(out);",
  "new": "  return redactBody(out as unknown as DocsFailureBody) as unknown as T | DocsFailureBody;",
  "tests": [
   "test/docs-source.test.ts"
  ],
  "red": "Tests 9 failed | 104 passed (113) — test/docs-source.test.ts > a committed utf8 answer carries the answer and the UTF-8 of its text; test/docs-source.test.ts > a draft base64 answer carries the decoded bytes; test/docs-source.test.ts > a canonical base64 committed answer is ok, carrying its decoded bytes; test/docs-source.test.ts > a committed blob is held to the listing's when the server holds one, and to nothing when it holds none; ... (9 in all)"
 }
]
```

---

### Task 8: The docs ring guard and the W2 one-home pins, appended to single-definition.test.ts

**Model routing:** `sonnet`, effort `high` — a guard over text, so the planted CONTROLs ARE the check: every rule is proved by a planted shape it must catch and a near miss it must not, and the live tree is held to the same function. The traps are the ones the update ring already paid for (a double-quoted or dynamic import seen by nothing, a hand-kept file list that disarms the scan when a file moves), the comment trap (a docstring ABOUT fastify, `reply` or a timer is not code — every rule reads `stallCodeText`'s comment-stripped text), and the append-only rule: `session-hook.test.ts`'s citation census cites this file by line, so the whole task is ONE hunk after the old last line.

**Spec rows:** §7.10's M7.10 (Docs ring: files under `server/src/docs/` are classified by their imports — `policy.ts` imports only `shared/`, `ports.ts` is type-only, `ccdsource.ts` has no fastify and no `reply`, only `routes.ts`, `hooks.ts`, `lane.ts` and `cache.ts` import fastify or own timers; the file list comes from `readdirSync`; a planted `import 'fastify'` in a copy of `policy.ts` is detected; mutations: import fastify in L1, hand-list the files). §1's ring column (L1 pure, L2 consumer-declared and type-only, L3 never narrows) and §2 row 48's "single-definition sees one TS copy", extended to the names W2 adds. Spec refinement (r): row 49's exact `CCD_ARGV.docsFetch(` count and the read registration's no-fetcher scan are W3's; this task pins only that the adapter is the one caller of the docs builders.

**Files:**
- Test (modify, APPEND AT EOF ONLY): `server/test/single-definition.test.ts` (4693 lines at `049ddcc28` and at Task 7's state — Task 2's one in-place `want` edit is line-count neutral; 4952 after). The block below goes after the file's true last line, the closing `});` of `describe('docs sections, grammar predicates and ref spec are declared once, in shared/docs.ts (docs W1, Task 1)'` (HEAD :4659-4693). Nothing above line 4693 changes; no import is added at the top of the file.
- Read, never edited: `server/src/docs/policy.ts`, `server/src/docs/ports.ts`, `server/src/docs/ccdsource.ts` (Tasks 2-7), `server/src/ccdargv.ts` (`DOCS_CAP`, Task 6), `server/src/lifecycle.ts` (`CcdEnding`/`ccdEnding`, Task 6).
- Test (run, not edited): `server/test/session-hook.test.ts` (`-t 'every line citation is anchored'`, the compaction-card describe whose census keys 8 citations on `single-definition.test.ts` by line), `server/test/typecheck-tests.test.ts` (this file is compiled under the tests-inclusive project), `server/test/topology-clean.test.ts` (the fixtures below are placeholders and no real name).

Locate the end by content, never by a remembered number: `tail -n 6 server/test/single-definition.test.ts` must print exactly

```ts
  for (const name of FUNCTIONS) {
    it(`defines ${name} exactly once, in shared/docs.ts`, () => {
      expect(ALL.filter((f) => FN_DEF(name).test(readFileSync(f, 'utf8'))).map(rel)).toEqual(['shared/docs.ts']);
    });
  }
});
```

and `grep -c '' server/test/single-definition.test.ts` must print `4693`. If either differs (a later merge of `main` appended its own describe), append after whatever the true last line is, and report the new line numbers in the commit body; if the tail is not a closed top-level `describe`, stop and put an ask to the coordinator.

**Interfaces:**
- Consumes, from `single-definition.test.ts`'s module scope (declared above the append point; reused, never re-declared): `ALL: string[]` (every `.ts`/`.tsx` under the four ROOTS); `rel(p: string): string` (path relative to `ccrcRoot`); `sources(dir: string): string[]` (the recursive `readdirSync` walk, `.ts`/`.tsx`, skipping `__`-prefixed transient mutants); `ccrcRoot: string`; `path` (`node:path`); `readFileSync`, `existsSync` (`node:fs`); `stallCodeText(t: string): string` and `stallCode(f: string): string` (comment LINES removed — a line starting `*`, `//` or `/*`; declared at HEAD :4077-4079). The update ring's describe (HEAD :3640) is the template: `[name, source]` pairs so the CONTROLs plant text, a FLOOR list, a directory walk.
- Consumes, the names Tasks 2-7 produced (pinned, never imported — this file reads text): in `server/src/docs/policy.ts` the values `DOCS_FAILURE_HTTP`, `DOCS_CAPS_UNKNOWN_RETRY_AFTER_S`, `DOCS_REF_PREFIXES`, `DOCS_LANE_EXECS`, `DOCS_LANE_BYTES`, `DOCS_LANE_LARGE_RAW`, `DOCS_LANE_QUEUE`, `DOCS_LANE_MAX_WAIT_MS`, `LISTING_JOB`, `DOCS_CACHE_IMMUTABLE`, `DOCS_CACHE_NO_STORE`, `DOCS_JSON_CONTENT_TYPE`, the functions `docsRetryAfterSeconds`, `docsRefTarget`, `fetchBranchFor`, `refreshDue`, `parseDocsApiQuery`, `parseDocsProjectParam`, `parseDocsRefreshBody`, `docsProvenance`, `laneAdmit`, `showRawBound`, `showWire`, `docsShowPlan`, `cacheControlFor`, `docsSendPolicy`, and the types `DocsRefTarget`, `DocsFetchPlan`, `DocsApiRoute`, `DocsApiRequest`, `DocsRefreshRequest`, `DocsHeaderBag`, `DocsProvenance`, `DocsJob`, `LaneLoad`, `DocsShowPlan`, `DocsSendVerdict`; in `ports.ts` the types `DocsNodeId`, `DocsSourceId`, `DocsShowAsk`, `DocsIndexRead`, `DocsTreeRead`, `DocsShowRead`, `DocsFetchRun`, `DocsReader`, `DocsFetcher`; in `ccdsource.ts` `CcdDocsDeps`, `ccdDocsReader`, `ccdDocsFetcher`; `DOCS_CAP` in `server/src/ccdargv.ts`; `CcdEnding` and `ccdEnding` in `server/src/lifecycle.ts`. The import lists of the three docs files as Tasks 2, 6 and 7 left them (`policy.ts`: one statement from `../../../shared/docs.js`; `ports.ts`: two `import type` statements; `ccdsource.ts`: `node:crypto`, `../ccdargv.js`, `../lifecycle.js`, `../fleetstate.js` (type), `../../../shared/docs.js`, `./policy.js`, `./ports.js` (type)).
- Produces (describe-local; nothing is exported, nothing is hoisted):
  - `describe('the docs ring — server/src/docs is classified by its imports (spec 2026-10-01 M7.10)')` with `type DocsRing = 'L1' | 'L2' | 'L3' | 'L4'`; `const DOCS_RING_ROLES: Readonly<Record<string, DocsRing>>` = `{ 'policy.ts': 'L1', 'ports.ts': 'L2', 'ccdsource.ts': 'L3', 'routes.ts': 'L4', 'hooks.ts': 'L4', 'lane.ts': 'L4', 'cache.ts': 'L4' }` (W3's four named now, so W3 reds nothing); `const DOCS_RING_FLOOR: readonly string[]` = the three W2 files; `const L3_IMPORTS: ReadonlySet<string>` (the Global Constraints' L3 list); `ringViolations(files: readonly (readonly [string, string])[]): string[]` over `[name relative to server/src/docs, source]` pairs, answering one sentence per broken rule; `docsNames(): string[]` (the walk); `onDisk(): (readonly [string, string])[]`; `planted(name: string, line: string): (readonly [string, string])[]`. A file missing from `DOCS_RING_ROLES` is held to L3's rules.
  - `describe('docs W2 names are defined once (spec 2026-10-01 section 1, M7.10)')` with `const HOMES: Readonly<Record<string, string>>` (52 names -> their one file); `DEF(name: string): RegExp` (any declaration shape); `exportedNames(text: string): string[]`; `QUOTED_PREFIX: RegExp`; `DOCS_CALL: RegExp`.

The rules, each over comment-stripped text:

| Ring | Rule | Sentence it answers |
|---|---|---|
| every role but L4 | no fastify import in any form (`from`, bare `import`, dynamic `import(`, `require(`; either quote; `fastify`, `fastify/...`, `fastify-*`, `@fastify/*`) | `<f> (<role>) imports fastify` |
| every role but L4 | no `setTimeout(`/`setInterval(`/`setImmediate(` | `<f> (<role>) owns a timer` |
| L1 | every static specifier (`import ... from`, `export ... from`, bare `import`) matches `^(?:\.\./)+shared/` — a type import is an import | `<f> (L1) imports <spec>, outside shared/` |
| L1 | no dynamic `import(` and no `require(` | `<f> (L1) loads a module at run time` |
| L2 | every line starting `import` starts `import type` | `<f> (L2) has a value import: <line>` |
| L2 | no `export default`, `export const/let/var/function/class/abstract/enum`, `export {`, `export *` (`export type {` is fine) | `<f> (L2) exports a runtime value` |
| L3 (and any unclassified file) | no `reply` identifier | `<f> (L3) names reply` |
| L3 | every static specifier is in `L3_IMPORTS` | `<f> (L3) imports <spec>, not on L3's list` |
| L3 | no dynamic `import(` and no `require(` | `<f> (L3) loads a module at run time` |
| L4 | none (W3's files own fastify and the lane's timers) | — |

Every CONTROL compares the WHOLE answer with `toEqual`, so deleting any one rule changes at least one answer and reds (the mutation rows below measure each).

- [ ] **Step 1: Confirm the append point.** Run `tail -n 6 server/test/single-definition.test.ts` and `grep -c '' server/test/single-definition.test.ts`; expect the six lines quoted above and `4693`. Confirm the three docs files exist and nothing else is under the directory yet: `ls server/src/docs` prints `ccdsource.ts  policy.ts  ports.ts`.

- [ ] **Step 2: Append the two describes.** Append exactly this block after the last line (it begins with one blank line; it adds no import and re-declares no module-scope name). Do not reformat it: the CONTROL strings are compared byte for byte.

```ts

// Docs W2, Task 8 (spec 2026-10-01 M7.10, section 1's ring column): the files under server/src/docs are classified
// by their IMPORTS, never by their path. policy.ts (L1) imports only shared/; ports.ts (L2) is type-only;
// ccdsource.ts (L3) names no fastify, no `reply` and no timer, and imports only from its stated list; only W3's
// routes.ts, hooks.ts, lane.ts and cache.ts (L4) may import fastify or own a timer. A file the table does not name
// is held to L3's rules, so a new file is never an exemption. The file list is read from the directory (`sources`,
// a readdirSync walk), never hand-kept. Every rule reads comment-stripped text (`stallCodeText`), so a sentence
// ABOUT fastify or a timer is never counted as one. APPENDED after the file's last line: `session-hook.test.ts`'s
// citation audit cites this file by line, so nothing above may move.
describe('the docs ring — server/src/docs is classified by its imports (spec 2026-10-01 M7.10)', () => {
  const docsDir = path.join(ccrcRoot, 'server/src/docs');
  type DocsRing = 'L1' | 'L2' | 'L3' | 'L4';
  /** Each known file's ring. W3's four L4 files are named now, so W3 adding them reds nothing here. */
  const DOCS_RING_ROLES: Readonly<Record<string, DocsRing>> = {
    'policy.ts': 'L1', 'ports.ts': 'L2', 'ccdsource.ts': 'L3',
    'routes.ts': 'L4', 'hooks.ts': 'L4', 'lane.ts': 'L4', 'cache.ts': 'L4',
  };
  /** The files W2 created. A FLOOR, not a count (the update ring's argument): a new file raises it, and a listed
   *  file that is gone reds instead of disarming the scan. */
  const DOCS_RING_FLOOR: readonly string[] = ['policy.ts', 'ports.ts', 'ccdsource.ts'];
  /** What L3 may import (the W2 plan's Global Constraints): its server neighbours, node's hash, its own ring's
   *  policy and ports, and L0. A type import is an import. */
  const L3_IMPORTS: ReadonlySet<string> = new Set([
    '../ccdargv.js', '../lifecycle.js', '../exec.js', '../fleetstate.js', 'node:crypto', './policy.js', './ports.js',
    '../../../shared/docs.js',
  ]);
  /** A fastify import in any of its forms: `from`, a bare `import`, a dynamic `import(...)` or a `require(...)`;
   *  either quote; the package, a subpath, a `fastify-*` package or an `@fastify/*` one. */
  const FASTIFY = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)(['"])(?:@fastify\/[^'"\n]*|fastify(?:[-/][^'"\n]*)?)\1/;
  const TIMERS = /\b(?:setTimeout|setInterval|setImmediate)\s*\(/;
  const RUNTIME_LOAD = /\bimport\s*\(|\brequire\s*\(/;
  const REPLY = /\breply\b/;
  const L2_RUNTIME_EXPORT = /^\s*export\s+(?:default\b|(?:async\s+)?(?:const|let|var|function|class|abstract|enum)\b|\{|\*)/m;
  /** Every static specifier: `import ... from 'x'`, `export ... from 'x'` and a bare `import 'x'`. */
  const specifiers = (code: string): string[] => [
    ...[...code.matchAll(/^\s*(?:import|export)\b[^;]*?\bfrom\s*(['"])([^'"\n]+)\1/gm)].map((m) => m[2]),
    ...[...code.matchAll(/^\s*import\s*(['"])([^'"\n]+)\1/gm)].map((m) => m[2]),
  ];
  /** Over `[name, source]` pairs, so the CONTROLs below plant their shapes as text: no fixture directory, and so
   *  no new import line in this file. */
  const ringViolations = (files: readonly (readonly [string, string])[]): string[] =>
    files.flatMap(([name, text]) => {
      const role: DocsRing = DOCS_RING_ROLES[name] ?? 'L3';
      const code = stallCodeText(text);
      const at = `${name} (${role})`;
      const specs = specifiers(code);
      const out: string[] = [];
      if (role !== 'L4' && FASTIFY.test(code)) out.push(`${at} imports fastify`);
      if (role !== 'L4' && TIMERS.test(code)) out.push(`${at} owns a timer`);
      if (role === 'L1') {
        for (const s of specs) if (!/^(?:\.\.\/)+shared\//.test(s)) out.push(`${at} imports ${s}, outside shared/`);
        if (RUNTIME_LOAD.test(code)) out.push(`${at} loads a module at run time`);
      }
      if (role === 'L2') {
        for (const l of code.split('\n')) {
          if (/^\s*import\b/.test(l) && !/^\s*import\s+type\b/.test(l)) out.push(`${at} has a value import: ${l.trim()}`);
        }
        if (L2_RUNTIME_EXPORT.test(code)) out.push(`${at} exports a runtime value`);
      }
      if (role === 'L3') {
        if (REPLY.test(code)) out.push(`${at} names reply`);
        for (const s of specs) if (!L3_IMPORTS.has(s)) out.push(`${at} imports ${s}, not on L3's list`);
        if (RUNTIME_LOAD.test(code)) out.push(`${at} loads a module at run time`);
      }
      return out;
    });
  const docsNames = (): string[] => sources(docsDir).map((f) => path.relative(docsDir, f));
  const onDisk = (): (readonly [string, string])[] =>
    docsNames().map((n) => [n, readFileSync(path.join(docsDir, n), 'utf8')] as const);
  /** One live file with one planted line above its own text: the live text is clean, so the answer is exactly what
   *  the planted line breaks. */
  const planted = (name: string, line: string): (readonly [string, string])[] =>
    [[name, `${line}\n${readFileSync(path.join(docsDir, name), 'utf8')}`]];

  it('covers the directory — every floor file is visited by the directory walk (never a hand list)', () => {
    expect(existsSync(docsDir), 'server/src/docs is not on disk — was the directory moved?').toBe(true);
    const names = docsNames();
    for (const f of DOCS_RING_FLOOR) expect(names, `${f} is listed but not visited`).toContain(f);
    expect(names.length).toBeGreaterThanOrEqual(DOCS_RING_FLOOR.length);
  });

  it('the live tree: no file under server/src/docs breaks its ring', () => {
    expect(ringViolations(onDisk())).toEqual([]);
  });

  it('CONTROL: L1 (policy.ts) — fastify in each form, a node builtin, a server module, a timer', () => {
    expect(ringViolations(planted('policy.ts', "import fastify from 'fastify';"))).toEqual([
      'policy.ts (L1) imports fastify', 'policy.ts (L1) imports fastify, outside shared/',
    ]);
    expect(ringViolations(planted('policy.ts', "import 'fastify';"))).toEqual([
      'policy.ts (L1) imports fastify', 'policy.ts (L1) imports fastify, outside shared/',
    ]);
    expect(ringViolations(planted('policy.ts', 'const f = await import("fastify");'))).toEqual([
      'policy.ts (L1) imports fastify', 'policy.ts (L1) loads a module at run time',
    ]);
    expect(ringViolations(planted('policy.ts', "import { readFileSync } from 'node:fs';"))).toEqual([
      'policy.ts (L1) imports node:fs, outside shared/',
    ]);
    expect(ringViolations(planted('policy.ts', "import type { CcdArgv } from '../ccdargv.js';"))).toEqual([
      'policy.ts (L1) imports ../ccdargv.js, outside shared/',
    ]);
    expect(ringViolations(planted('policy.ts', 'const t = setTimeout(() => {}, 1);'))).toEqual([
      'policy.ts (L1) owns a timer',
    ]);
  });

  it('CONTROL: L2 (ports.ts) — a value import and each runtime export are caught; a type re-export is not', () => {
    expect(ringViolations(planted('ports.ts', "import { DOCS_CAP } from '../ccdargv.js';"))).toEqual([
      "ports.ts (L2) has a value import: import { DOCS_CAP } from '../ccdargv.js';",
    ]);
    expect(ringViolations(planted('ports.ts', 'export const X = 1;'))).toEqual(['ports.ts (L2) exports a runtime value']);
    expect(ringViolations(planted('ports.ts', 'export function f(): void {}'))).toEqual(['ports.ts (L2) exports a runtime value']);
    expect(ringViolations(planted('ports.ts', "export { DOCS_CAP } from '../ccdargv.js';"))).toEqual([
      'ports.ts (L2) exports a runtime value',
    ]);
    expect(ringViolations(planted('ports.ts', "export type { DocsJob } from './policy.js';"))).toEqual([]);
  });

  it('CONTROL: L3 (ccdsource.ts) — reply, a timer, a fastify type and an unlisted import are caught; prose is not', () => {
    expect(ringViolations(planted('ccdsource.ts', 'reply.code(500);'))).toEqual(['ccdsource.ts (L3) names reply']);
    expect(ringViolations(planted('ccdsource.ts', 'setTimeout(() => {}, 1);'))).toEqual(['ccdsource.ts (L3) owns a timer']);
    expect(ringViolations(planted('ccdsource.ts', "import type { FastifyReply } from 'fastify';"))).toEqual([
      'ccdsource.ts (L3) imports fastify', "ccdsource.ts (L3) imports fastify, not on L3's list",
    ]);
    expect(ringViolations(planted('ccdsource.ts', "import { readFileSync } from 'node:fs';"))).toEqual([
      "ccdsource.ts (L3) imports node:fs, not on L3's list",
    ]);
    expect(ringViolations(planted('ccdsource.ts', '// reply, setTimeout( and import fastify are named here in prose only'))).toEqual([]);
  });

  it('CONTROL: an L4 file may import fastify and own a timer; an unclassified file is held to L3', () => {
    expect(ringViolations([
      ['routes.ts', "import type { FastifyInstance } from 'fastify';\nexport const t = setTimeout(() => {}, 1);\n"],
    ])).toEqual([]);
    expect(ringViolations([['extra.ts', "import fastify from 'fastify';\n"]])).toEqual([
      'extra.ts (L3) imports fastify', "extra.ts (L3) imports fastify, not on L3's list",
    ]);
    expect(ringViolations([['extra.ts', 'import fastifyStatic from "@fastify/static";\n']])).toEqual([
      'extra.ts (L3) imports fastify', "extra.ts (L3) imports @fastify/static, not on L3's list",
    ]);
  });
});

// Docs W2, Task 8: the names W2 declares, each with ONE home. W3's routes and later waves import them; a second
// declaration would be a second answer that nothing forces to agree. Two directions: a hand-kept table pins each
// W2 name to its file, and a derived scan holds EVERY export under server/src/docs (W3's included, with no list to
// maintain) to exactly one declaration across the four roots. The table is checked against the scan, so the scan
// cannot go blind to a name the table knows. Plus two docs-only spellings: the qualified ref prefixes are derived
// from L0 and never quoted under server/src/docs, and the adapter is the one caller of the docs builders (row 49's
// exact `docsFetch(` count is W3's). APPENDED, for the citation audit's reason above.
describe('docs W2 names are defined once (spec 2026-10-01 section 1, M7.10)', () => {
  const docsDir = path.join(ccrcRoot, 'server/src/docs');
  const POLICY = 'server/src/docs/policy.ts';
  const PORTS = 'server/src/docs/ports.ts';
  const SOURCE = 'server/src/docs/ccdsource.ts';
  const HOMES: Readonly<Record<string, string>> = {
    // policy.ts (L1): values, functions, types.
    DOCS_FAILURE_HTTP: POLICY, DOCS_CAPS_UNKNOWN_RETRY_AFTER_S: POLICY, DOCS_REF_PREFIXES: POLICY,
    DOCS_LANE_EXECS: POLICY, DOCS_LANE_BYTES: POLICY, DOCS_LANE_LARGE_RAW: POLICY, DOCS_LANE_QUEUE: POLICY,
    DOCS_LANE_MAX_WAIT_MS: POLICY, LISTING_JOB: POLICY, DOCS_CACHE_IMMUTABLE: POLICY, DOCS_CACHE_NO_STORE: POLICY,
    DOCS_JSON_CONTENT_TYPE: POLICY,
    docsRetryAfterSeconds: POLICY, docsRefTarget: POLICY, fetchBranchFor: POLICY, refreshDue: POLICY,
    parseDocsApiQuery: POLICY, parseDocsProjectParam: POLICY, parseDocsRefreshBody: POLICY, docsProvenance: POLICY,
    laneAdmit: POLICY, showRawBound: POLICY, showWire: POLICY, docsShowPlan: POLICY, cacheControlFor: POLICY,
    docsSendPolicy: POLICY,
    DocsRefTarget: POLICY, DocsFetchPlan: POLICY, DocsApiRoute: POLICY, DocsApiRequest: POLICY,
    DocsRefreshRequest: POLICY, DocsHeaderBag: POLICY, DocsProvenance: POLICY, DocsJob: POLICY, LaneLoad: POLICY,
    DocsShowPlan: POLICY, DocsSendVerdict: POLICY,
    // ports.ts (L2): types only.
    DocsNodeId: PORTS, DocsSourceId: PORTS, DocsShowAsk: PORTS, DocsIndexRead: PORTS, DocsTreeRead: PORTS,
    DocsShowRead: PORTS, DocsFetchRun: PORTS, DocsReader: PORTS, DocsFetcher: PORTS,
    // ccdsource.ts (L3): the deps type and the two factories.
    CcdDocsDeps: SOURCE, ccdDocsReader: SOURCE, ccdDocsFetcher: SOURCE,
    // Outside server/src/docs: the cap token, and the single reader of killed/signal.
    DOCS_CAP: 'server/src/ccdargv.ts', CcdEnding: 'server/src/lifecycle.ts', ccdEnding: 'server/src/lifecycle.ts',
  };
  /** A declaration of `name` in any of its shapes: a function (async or not), a `const|let|var|class|enum` binding,
   *  a type alias by its `=`, an interface; `export`/`declare` optional. An import, a re-export or a call declares
   *  nothing. */
  const DEF = (name: string): RegExp => new RegExp(
    `^\\s*(?:export\\s+)?(?:declare\\s+)?(?:(?:async\\s+)?function\\s+${name}\\b|(?:const|let|var|class|enum)\\s+${name}\\b|type\\s+${name}\\b\\s*(?:<[^>\\n]*>)?\\s*=|interface\\s+${name}\\b)`,
    'm');
  /** Every name a file exports by declaration. */
  const exportedNames = (text: string): string[] =>
    [...text.matchAll(/^export\s+(?:declare\s+)?(?:async\s+)?(?:const|let|var|function|class|enum|interface|type)\s+([A-Za-z_$][\w$]*)/gm)]
      .map((m) => m[1]);
  const text = new Map<string, string>();
  const src = (f: string): string => {
    const hit = text.get(f);
    if (hit !== undefined) return hit;
    const t = readFileSync(f, 'utf8');
    text.set(f, t);
    return t;
  };
  const holders = (re: RegExp): string[] => ALL.filter((f) => re.test(src(f))).map(rel);
  /** A qualified ref prefix inside a string literal of any quote, a template included. */
  const QUOTED_PREFIX = /(['"`])refs\/(?:heads|remotes\/origin)\//;
  const DOCS_CALL = /\bCCD_ARGV\.docs\w*\s*\(/;

  it('CONTROL: DEF sees each declaration shape and an un-exported copy, and not an import, a re-export, a call or a longer name', () => {
    for (const decl of [
      'export const X = 1;', 'const X = 1;', 'export interface X {', 'export type X<T> = T;', 'type X = 1;',
      'export async function X(): Promise<void> {', 'function X(): void {', 'export class X {',
    ]) expect(DEF('X').test(decl), decl).toBe(true);
    for (const miss of [
      "import { X } from './policy.js';", "import {\n  type X,\n} from './policy.js';", 'export { X };',
      'export const X_SEEN = 1;', 'const y = X(1);', 'export type XY = 1;',
    ]) expect(DEF('X').test(miss), miss).toBe(false);
  });

  it('CONTROL: exportedNames reads every exported declaration and nothing else', () => {
    expect(exportedNames(
      'export const A = 1;\nexport function b(): void {}\nexport interface C {}\nexport type D = 1;\n'
      + 'export async function e(): Promise<void> {}\nconst f = 1;\nexport { f };\n  export const g = 1;\n',
    )).toEqual(['A', 'b', 'C', 'D', 'e']);
  });

  it.each(Object.entries(HOMES))('%s is declared exactly once, in %s', (name, home) => {
    expect(holders(DEF(name))).toEqual([home]);
  });

  it('every export under server/src/docs is declared exactly once across the four roots, in its own file', () => {
    const files = sources(docsDir);
    expect(files.length).toBeGreaterThanOrEqual(3);
    for (const f of files) {
      for (const name of exportedNames(src(f))) expect(holders(DEF(name)), name).toEqual([rel(f)]);
    }
  });

  it('the table is seen by the scan: every listed name under server/src/docs is an export of its home', () => {
    for (const [name, home] of Object.entries(HOMES)) {
      if (!home.startsWith('server/src/docs/')) continue;
      expect(exportedNames(src(path.join(ccrcRoot, home))), `${name} in ${home}`).toContain(name);
    }
  });

  it('CONTROL: QUOTED_PREFIX sees a quoted prefix in each quote, and not prose or the derived name', () => {
    for (const hit of ["const l = 'refs/heads/' + b;", 'const o = `refs/remotes/origin/${b}`;', 'x === "refs/heads/main"']) {
      expect(QUOTED_PREFIX.test(stallCodeText(hit)), hit).toBe(true);
    }
    for (const miss of [' * - `refs/heads/b`: skipped, local-ref', '// refs/remotes/origin/b', 'const [l, o] = DOCS_REF_PREFIXES;']) {
      expect(QUOTED_PREFIX.test(stallCodeText(miss)), miss).toBe(false);
    }
  });

  it("the qualified ref prefixes are quoted nowhere under server/src/docs (derived from L0's prefix body)", () => {
    expect(sources(docsDir).filter((f) => QUOTED_PREFIX.test(stallCode(f))).map(rel)).toEqual([]);
  });

  it('CONTROL: DOCS_CALL sees a builder call, and not the builder table or a comment', () => {
    expect(DOCS_CALL.test(stallCodeText('await deps.runCcd(CCD_ARGV.docsFetch(project, branch));'))).toBe(true);
    expect(DOCS_CALL.test(stallCodeText("  docsFetch: (project: string, branch: string | null) =>"))).toBe(false);
    expect(DOCS_CALL.test(stallCodeText('/** the ONE `CCD_ARGV.docsFetch(` in server/src */'))).toBe(false);
  });

  it('the docs builders have one caller across the four roots: the adapter', () => {
    expect(ALL.filter((f) => DOCS_CALL.test(stallCode(f))).map(rel)).toEqual([SOURCE]);
  });
});
```

Then `grep -c '' server/test/single-definition.test.ts` prints `4952`, and `git diff -U0 -- server/test/single-definition.test.ts | grep '^@@'` prints ONE hunk, `@@ -4693,0 +4694,259 @@` (an append; no line above 4694 moved).

- [ ] **Step 3: Prove the guard can fail (RED), in a scratch copy.** The code this task guards already exists (Tasks 2-7), so a fresh guard over a clean tree is green by construction; its RED is measured by planting what it forbids, in a COPY, never in the worktree (Global Constraints; W1's G8). Foreground, Bash timeout 600000 ms each.

```bash
COPY=$(mktemp -d) && git archive HEAD | tar -x -C "$COPY" && git -C "$COPY" init -q \
  && cp server/test/single-definition.test.ts "$COPY/server/test/" \
  && ln -s "$PWD/server/node_modules" "$COPY/server/node_modules"
```

(a) M7.10's named mutation, "import fastify in L1", on the LIVE file (row W2-T8-M4's shape with fastify): plant it and run the ring describe:

```bash
python3 -I - "$COPY/server/src/docs/policy.ts" <<'EOF'
import sys
p = sys.argv[1]; s = open(p).read(); old = "import {\n  DOCS_ALLOWED_CONTENT_TYPES,"
assert s.count(old) == 1, 'Find block not unique'
open(p, 'w').write(s.replace(old, "import 'fastify';\n" + old))
EOF
( cd "$COPY/server" && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'docs ring' )
cp server/src/docs/policy.ts "$COPY/server/src/docs/policy.ts"
```

Expected: `Tests  2 failed | 4 passed | 459 skipped (465)` — `the live tree: no file under server/src/docs breaks its ring` (answer `['policy.ts (L1) imports fastify', 'policy.ts (L1) imports fastify, outside shared/']`) and the L1 CONTROL (its planted lines now sit above a dirty file). The restore line puts the file back.

(b) M7.10's other named mutation, "hand-list the files" (row W2-T8-M2):

```bash
python3 -I - "$COPY/server/test/single-definition.test.ts" <<'EOF'
import sys
p = sys.argv[1]; s = open(p).read()
old = "  const docsNames = (): string[] => sources(docsDir).map((f) => path.relative(docsDir, f));"
assert s.count(old) == 1, 'Find block not unique'
open(p, 'w').write(s.replace(old, "  const docsNames = (): string[] => ['policy.ts', 'ports.ts'];"))
EOF
( cd "$COPY/server" && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'docs ring' )
cp server/test/single-definition.test.ts "$COPY/server/test/single-definition.test.ts"
```

Expected: `Tests  1 failed | 5 passed | 459 skipped (465)` — `covers the directory — every floor file is visited by the directory walk (never a hand list)` (`ccdsource.ts is listed but not visited`).

(c) A second home for a W2 name (row W2-T8-M5): in the copy, replace `const STDERR_HEAD_BYTES = 512;\n` in `server/src/docs/ccdsource.ts` with `const STDERR_HEAD_BYTES = 512;\nexport const DOCS_LANE_QUEUE = 32;\n` the same way, then run `( cd "$COPY/server" && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'docs W2 names' )`. Expected: `Tests  2 failed | 58 passed | 405 skipped (465)` — `DOCS_LANE_QUEUE is declared exactly once, in server/src/docs/policy.ts` and `every export under server/src/docs is declared exactly once across the four roots, in its own file`. Restore with `cp server/src/docs/ccdsource.ts "$COPY/server/src/docs/ccdsource.ts"`.

The remaining twelve rows of the table below are run the same way by Task 9; each was measured red at planning. Remove the copy afterwards: `rm -rf "$COPY"`.

- [ ] **Step 4: Run the new describes GREEN on the worktree.** Foreground, Bash timeout 600000 ms.

Run: `( cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'docs ring|docs W2 names' )`
Expected: `Test Files  1 passed (1)`, `Tests  66 passed | 399 skipped (465)` — the ring describe's 6 cases (`covers the directory`, `the live tree`, four CONTROLs) and the names describe's 60 (two CONTROLs, 52 `<name> is declared exactly once, in <file>` cases, the derived export scan, the table-seen-by-the-scan check, the prefix CONTROL and pin, the builder-call CONTROL and pin). If the live-tree case is red, its answer names the file, the ring and the rule; fix the guarded file only if it is a real breach a Task 2-7 text missed (report it to the coordinator), never the rule.

- [ ] **Step 5: The guard suites.** Foreground, Bash timeout 600000 ms each; `typecheck-tests` is a known load flake, so a red there is re-run alone before it is called broken.

Run: `( cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts )`
Expected: `Test Files  1 passed (1)`, `Tests  465 passed (465)` (399 at Task 7's state + 66).

Run: `( cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts -t 'every line citation is anchored' )`
Expected: `Test Files  1 passed (1)`, `Tests  13 passed | 322 skipped (335)`: the census's 8 line-keyed citations of this file still land, because the append moved no line.

Run: `( cd server && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts )`
Expected: `Tests  12 passed (12)` (`server/test/ is clean under a tests-inclusive project` compiles the new block: `type DocsRing` is describe-local, `m[1]`/`m[2]` are `string` capture groups). With a symlinked `pwa/node_modules` only `PWA_TSC really is pwa's own installed compiler` reds (Task 1's Measured 5); Task 1's Step 0 installs real modules.

Run: `( cd server && ./node_modules/.bin/vitest run test/topology-clean.test.ts )`
Expected: `Test Files  1 passed (1)`, `Tests  55 passed (55)`; without `origin/main` only `resolved a base to measure against` reds, and `CCRC_HISTORY_BASE=<base sha>` measures it green. The block carries no real host, project, user, pool or account name (its fixtures are `X`, `A`-`g`, `main`, `extra.ts`).

No source file changes in this task, so `docs-policy`, `docs-source`, `verb-gate`, `capsupported` and the agent suites are not re-run here; Task 9 runs them all.

- [ ] **Step 6: Commit.**

```bash
git add server/test/single-definition.test.ts
git commit -m "test: docs ring guard and W2 one-home pins (docs W2)" \
  -m "M7.10: the files under server/src/docs are classified by their imports, read by a directory walk with a floor of the three W2 files. policy.ts (L1) imports only shared/ and loads nothing at run time; ports.ts (L2) has only import-type lines and no runtime export; ccdsource.ts (L3) names no reply and imports only its listed modules; every file but W3's four L4 names (routes, hooks, lane, cache) has no fastify import in any form and no timer, and an unclassified file is held to L3. Each rule is proved by a planted CONTROL compared whole, and the live tree is held to the same function. One-home pins: 52 W2 names pinned to their file, every export under server/src/docs declared once across the four roots (derived, so W3's exports are covered with no list), the qualified ref prefixes quoted nowhere there, and the adapter the one caller of CCD_ARGV.docs*. Appended at EOF only (one hunk, +259), so session-hook's line census is unmoved." \
  -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

**Mutation rows this task contributes** (each measured red in a separate copy of the tree at this task's state — the tree copied with `server/node_modules` linked in, never the worktree — and restored after each; `pkg` is the package the `tests` run in, with `-t` set to the row's `t`; `old` is unique in `file` at this task's state; `red` is the measured summary and the cases that went red). The architecture's W2-T8-M1..M5 are rows M1..M5 here, with M1 cutting the cross-ring fastify rule (in this design L1's fastify import is also refused by the specifier rule, so the CONTROL's whole-answer comparison is what reds); M6-M15 cover every other rule and both directions of the derived scan.

```json
[
 {
  "id": "W2-T8-M1",
  "pkg": "server",
  "file": "server/test/single-definition.test.ts",
  "old": "      if (role !== 'L4' && FASTIFY.test(code)) out.push(`${at} imports fastify`);\n",
  "new": "",
  "tests": [
   "test/single-definition.test.ts"
  ],
  "t": "docs ring",
  "red": "Tests 3 failed | 3 passed | 459 skipped (465) — CONTROL: L1 (policy.ts) — fastify in each form, a node builtin, a server module, a timer; CONTROL: L3 (ccdsource.ts) — reply, a timer, a fastify type and an unlisted import are caught; prose is not; CONTROL: an L4 file may import fastify and own a timer; an unclassified file is held to L3"
 },
 {
  "id": "W2-T8-M2",
  "pkg": "server",
  "file": "server/test/single-definition.test.ts",
  "old": "  const docsNames = (): string[] => sources(docsDir).map((f) => path.relative(docsDir, f));",
  "new": "  const docsNames = (): string[] => ['policy.ts', 'ports.ts'];",
  "tests": [
   "test/single-definition.test.ts"
  ],
  "t": "docs ring",
  "red": "Tests 1 failed | 5 passed | 459 skipped (465) — covers the directory — every floor file is visited by the directory walk (never a hand list)"
 },
 {
  "id": "W2-T8-M3",
  "pkg": "server",
  "file": "server/test/single-definition.test.ts",
  "old": "!/^\\s*import\\s+type\\b/.test(l)",
  "new": "!/^\\s*import\\s+(?:type\\b|\\{)/.test(l)",
  "tests": [
   "test/single-definition.test.ts"
  ],
  "t": "docs ring",
  "red": "Tests 1 failed | 5 passed | 459 skipped (465) — CONTROL: L2 (ports.ts) — a value import and each runtime export are caught; a type re-export is not"
 },
 {
  "id": "W2-T8-M4",
  "pkg": "server",
  "file": "server/src/docs/policy.ts",
  "old": "import {\n  DOCS_ALLOWED_CONTENT_TYPES,",
  "new": "import type { CcdArgv } from '../ccdargv.js';\nimport {\n  DOCS_ALLOWED_CONTENT_TYPES,",
  "tests": [
   "test/single-definition.test.ts"
  ],
  "t": "docs ring",
  "red": "Tests 2 failed | 4 passed | 459 skipped (465) — CONTROL: L1 (policy.ts) — fastify in each form, a node builtin, a server module, a timer; the live tree: no file under server/src/docs breaks its ring"
 },
 {
  "id": "W2-T8-M5",
  "pkg": "server",
  "file": "server/src/docs/ccdsource.ts",
  "old": "const STDERR_HEAD_BYTES = 512;\n",
  "new": "const STDERR_HEAD_BYTES = 512;\nexport const DOCS_LANE_QUEUE = 32;\n",
  "tests": [
   "test/single-definition.test.ts"
  ],
  "t": "docs W2 names",
  "red": "Tests 2 failed | 58 passed | 405 skipped (465) — DOCS_LANE_QUEUE is declared exactly once, in server/src/docs/policy.ts; every export under server/src/docs is declared exactly once across the four roots, in its own file"
 },
 {
  "id": "W2-T8-M6",
  "pkg": "server",
  "file": "server/test/single-definition.test.ts",
  "old": "        if (REPLY.test(code)) out.push(`${at} names reply`);\n",
  "new": "",
  "tests": [
   "test/single-definition.test.ts"
  ],
  "t": "docs ring",
  "red": "Tests 1 failed | 5 passed | 459 skipped (465) — CONTROL: L3 (ccdsource.ts) — reply, a timer, a fastify type and an unlisted import are caught; prose is not"
 },
 {
  "id": "W2-T8-M7",
  "pkg": "server",
  "file": "server/test/single-definition.test.ts",
  "old": "      if (role !== 'L4' && TIMERS.test(code)) out.push(`${at} owns a timer`);\n",
  "new": "",
  "tests": [
   "test/single-definition.test.ts"
  ],
  "t": "docs ring",
  "red": "Tests 2 failed | 4 passed | 459 skipped (465) — CONTROL: L1 (policy.ts) — fastify in each form, a node builtin, a server module, a timer; CONTROL: L3 (ccdsource.ts) — reply, a timer, a fastify type and an unlisted import are caught; prose is not"
 },
 {
  "id": "W2-T8-M8",
  "pkg": "server",
  "file": "server/test/single-definition.test.ts",
  "old": "DOCS_RING_ROLES[name] ?? 'L3'",
  "new": "DOCS_RING_ROLES[name] ?? 'L4'",
  "tests": [
   "test/single-definition.test.ts"
  ],
  "t": "docs ring",
  "red": "Tests 1 failed | 5 passed | 459 skipped (465) — CONTROL: an L4 file may import fastify and own a timer; an unclassified file is held to L3"
 },
 {
  "id": "W2-T8-M9",
  "pkg": "server",
  "file": "server/test/single-definition.test.ts",
  "old": "        for (const s of specs) if (!L3_IMPORTS.has(s)) out.push(`${at} imports ${s}, not on L3's list`);\n",
  "new": "",
  "tests": [
   "test/single-definition.test.ts"
  ],
  "t": "docs ring",
  "red": "Tests 2 failed | 4 passed | 459 skipped (465) — CONTROL: L3 (ccdsource.ts) — reply, a timer, a fastify type and an unlisted import are caught; prose is not; CONTROL: an L4 file may import fastify and own a timer; an unclassified file is held to L3"
 },
 {
  "id": "W2-T8-M10",
  "pkg": "server",
  "file": "server/test/single-definition.test.ts",
  "old": "if (!/^(?:\\.\\.\\/)+shared\\//.test(s))",
  "new": "if (!/^(?:\\.\\.\\/)+/.test(s))",
  "tests": [
   "test/single-definition.test.ts"
  ],
  "t": "docs ring",
  "red": "Tests 1 failed | 5 passed | 459 skipped (465) — CONTROL: L1 (policy.ts) — fastify in each form, a node builtin, a server module, a timer"
 },
 {
  "id": "W2-T8-M11",
  "pkg": "server",
  "file": "server/test/single-definition.test.ts",
  "old": "outside shared/`);\n        if (RUNTIME_LOAD.test(code)) out.push(`${at} loads a module at run time`);\n",
  "new": "outside shared/`);\n",
  "tests": [
   "test/single-definition.test.ts"
  ],
  "t": "docs ring",
  "red": "Tests 1 failed | 5 passed | 459 skipped (465) — CONTROL: L1 (policy.ts) — fastify in each form, a node builtin, a server module, a timer"
 },
 {
  "id": "W2-T8-M12",
  "pkg": "server",
  "file": "server/test/single-definition.test.ts",
  "old": "        if (L2_RUNTIME_EXPORT.test(code)) out.push(`${at} exports a runtime value`);\n",
  "new": "",
  "tests": [
   "test/single-definition.test.ts"
  ],
  "t": "docs ring",
  "red": "Tests 1 failed | 5 passed | 459 skipped (465) — CONTROL: L2 (ports.ts) — a value import and each runtime export are caught; a type re-export is not"
 },
 {
  "id": "W2-T8-M13",
  "pkg": "server",
  "file": "server/src/docs/policy.ts",
  "old": "const [LOCAL_REF_PREFIX, ORIGIN_REF_PREFIX] = DOCS_REF_PREFIXES;",
  "new": "const [LOCAL_REF_PREFIX, ORIGIN_REF_PREFIX] = ['refs/heads/', 'refs/remotes/origin/'];",
  "tests": [
   "test/single-definition.test.ts"
  ],
  "t": "docs W2 names",
  "red": "Tests 1 failed | 59 passed | 405 skipped (465) — the qualified ref prefixes are quoted nowhere under server/src/docs (derived from L0's prefix body)"
 },
 {
  "id": "W2-T8-M14",
  "pkg": "server",
  "file": "server/src/ccdargv.ts",
  "old": "export const DOCS_CAP = 'docs-v1';\n",
  "new": "export const DOCS_CAP = 'docs-v1';\nexport const docsIndexArgv = (): CcdArgv => CCD_ARGV.docsIndex();\n",
  "tests": [
   "test/single-definition.test.ts"
  ],
  "t": "docs W2 names",
  "red": "Tests 1 failed | 59 passed | 405 skipped (465) — the docs builders have one caller across the four roots: the adapter"
 },
 {
  "id": "W2-T8-M15",
  "pkg": "server",
  "file": "server/test/single-definition.test.ts",
  "old": "(?:const|let|var|function|class|enum|interface|type)\\s+([A-Za-z_$][\\w$]*)",
  "new": "(?:const|let|var|function|class|enum)\\s+([A-Za-z_$][\\w$]*)",
  "tests": [
   "test/single-definition.test.ts"
  ],
  "t": "docs W2 names",
  "red": "Tests 2 failed | 58 passed | 405 skipped (465) — CONTROL: exportedNames reads every exported declaration and nothing else; the table is seen by the scan: every listed name under server/src/docs is an export of its home"
 }
]
```

---

### Task 9: Close the wave: the W2 suites, the census-free invariants, the mutation table, and the results record (no push, no PR)

**Model routing:** `sonnet`, effort `high`. The five scratch tools are complete below; the work is running them and reading what they print. Any red, any FAIL invariant and any mutation row that does not come back as its `expect` says is a FINDING: it is reported to the coordinator (Step 4's `finding` mail, or an ask when it needs the operator), never fixed silently and never weakened. This task adds no guard and edits no source or test file.

**Spec rows:** none of its own. §7.9's "every wave" and W2 suites; §7.10, §3.14 and §6.10's W2 M-cases and §2 (j)'s W2 rows, as carried by Tasks 1-8's mutation rows; §7.7's W2 row (no release: W2 rides a later rollout).

**Files:**
- Modify: `docs/superpowers/plans/2026-10-06-native-docs-reader-w2-grants-and-adapter.md`, this plan. `## Wave 2 results` is APPENDED after the file's last line, whatever its last section is (the `## Deviations found` section Task 6 appended after Task 9's rows block, with any entry added since). `w2-results.py` is its only writer: it refuses while the file has uncommitted edits, and on a re-run (a fix round) it replaces the section it wrote, which is the file's last `## ` section by construction. No line above it changes.
- No other tracked file. Scratch only, never committed: `<SCRATCH>/w2-suites.py`, `<SCRATCH>/w2-invariants.py`, `<SCRATCH>/w2-rows.py`, `<SCRATCH>/mutate.py`, `<SCRATCH>/w2-results.py`, `<SCRATCH>/w2-base`, `<SCRATCH>/w2-rows.json`, `<SCRATCH>/w2-mut/` (a `git archive` copy of HEAD) with its `w2-mut.*` state files, the `w2-suite-*.log` files, `w2-invariants.txt`, `w2-mutation-table.md` and, only when something needed one, `w2-notes.md`. Step 5 copies the evidence into the SDD ledger's directory, `.superpowers/sdd/2026-10-06-native-docs-reader-w2-grants-and-adapter/task-9-evidence/` (gitignored, so `git status` stays clean), because the fleet box's `/tmp` reaper deletes scratch files older than 12 h and the coordinator reads the evidence after this session ends.

`<SCRATCH>` is this session's scratchpad directory, as an ABSOLUTE path OUTSIDE the worktree (`mutate.py` refuses a copy inside it). Shell state does not survive between Bash calls, so every block below opens with `SCRATCH=<that path>`, and every file below is written to that absolute path. Every vitest run is in the foreground with a Bash timeout of 600000 ms; no command below is backgrounded.

**Interfaces:**
- Consumes (no TypeScript: this task imports nothing and declares nothing):
  - this plan's `### Task <n>: ` sections 1-8, each ending in a `**Mutation rows this task contributes**` line and one JSON block of rows `{id, pkg, file, old, new, tests, red, t?}` (ids `W2-T<n>-M<k>`; 147 rows: T1 9, T2 14, T3 19, T4 22, T5 14, T6 27, T7 27, T8 15), and Task 9's own empty block;
  - the base sha Task 1 Step 0 printed (`git rev-parse HEAD` before Task 1) and recorded in the SDD ledger;
  - the test files Tasks 1-8 created or extended: agent `whitelist-structural`, `whitelist`; server `whitelist-subset`, `verb-gate`, `capsupported`, `ccd-archive`, `remote-runner`, `docs-budget`, `lifecycle`, `docs-source`, `docs-policy`, `single-definition` (its `docs ring` and `docs W2 names` describes);
  - W1's mutation-runner idiom (`git archive HEAD | tar -x`, then `git -C <copy> init -q`; one row at a time; byte-for-byte restore under a per-row sentinel), extended here for a row that creates a file and a row whose guard throws at module load;
  - `$HOME/.local/bin/ccrc-api` (`whoami`, `mail list`, `mail fetch`, `mail ack`, `mail send`), as the `ccrc-worker` skill uses it.
- Produces:
  - `## Wave 2 results` at the end of this plan: the measurement time, the measured tree's sha, the base, the W2 commit count; a Suites table (command, `Test Files`, `Tests`, rc, and a re-run's rc where one was needed); the Invariants block verbatim; the Mutation table (one line per row: id, task, file, measured verdict, first red case) with its `<n> rows; <n> measured as expected` line; Notes; and the inherited items restated as carried (SEC-3, MT-2, contract F4, D-4157, D-4158, D-4164, and the partial-clone word pair);
  - one commit, `docs: W2 results (docs W2)`, the wave's `handoffCommit`;
  - one `wave-done` mail to the coordinator whose fingerprint is `{branchTip: <that commit>, prNumber: null, prPhase: "none", handoffCommit: <that commit>}`.
  - The scratch tools' command lines: `python3 w2-suites.py SCRATCH ID [ID ...] | --rerun ID | --list`; `python3 w2-invariants.py BASE`; `python3 w2-rows.py PLAN OUT`; `python3 mutate.py ROWS MUT setup|baseline|run [ID ...]|final|report`; `python3 w2-results.py SCRATCH BASE [--record-reds]`. All run from the worktree root.

**Measured while planning** (a scratch tree at `049ddcc28` with Tasks 1-8 applied as written; no deviation):
1. **The table is whole and every row bites at the wave's END state.** Each task measured its own rows at its own state; later tasks edit the same files (Task 7 extends `ccdsource.ts`, Task 8 appends to `single-definition.test.ts`). At the final state all 146 non-empty `old` strings are still present exactly once, and the runner measured `ALL ROWS MEASURED: 147 ok, 0 not ok`: 145 RED and 2 LOAD (`W2-T1-M2`, `W2-T1-M3`, the audit's module-load throw, with its `only grantable with '--project'` message in vitest's output). Baseline and final: `ALL COMMANDS GREEN` over 16 test commands; about 170 s each, and the 147 rows took two `run` invocations.
2. **The runner needed three things W1's did not.** `W2-T2-M8` creates a file HEAD does not have (`server/src/docs/fourth-home.ts`), so the manifest records it as absent and the restore deletes it. `W2-T1-M2` and `-M3` red as a test file that fails to LOAD (`Test Files 2 failed`, `Tests no tests`), which W1's classifier calls `error`; here a row with `expect: 'load'` accepts it only when the output names its `loadMatch`. And `typecheck-tests.test.ts` resolves pwa's own `typescript` at MODULE scope, so the copy links `pwa/node_modules` too (without it the file failed to load, `Cannot find module 'typescript'`), and `W2-T2-M14` runs with `-t 'server/test/ is clean under a tests-inclusive project'`, because the file's `PWA_TSC really is pwa's own installed compiler` case is red on its own wherever `pwa/node_modules` is a symlink, as it is in the copy.
3. **The invariants can fail.** In a clone with one planted commit (a `shared/docs.ts` edit, a second quoted `'docs-v1'` in `ccdargv.ts`, a line inserted at line 11 of `single-definition.test.ts`), `w2-invariants.py` printed four `FAIL` lines (`scope`, `untouched`, `cap-literal`, `sd-shape`) and `8 invariants, 4 PASS`, rc 1; on the tree as Tasks 1-8 leave it, `8 invariants, 8 PASS`.
4. **Two reds that only a scratch tree shows, never this worktree:** `typecheck-tests`' `PWA_TSC` case (a symlinked `pwa/node_modules`; Task 1 Step 0's `npm ci` installs real ones), and `deviation-refs`' two incident cases `reports D-1157/D-1158 …` and `reports D-1159/D-1160/D-1161 …` (they need the repository's own history, which a `git init` copy lacks). Both are green in a real checkout; neither is this wave's.
5. **Task 6's `## Deviations found` append was not simulated.** The planning tree holds no issued block, and it may neither type a `D-` number nor commit a concrete `D-TBD-` placeholder, so its Task 6 commit carries no plan edit. Nothing in Task 9 reads that section (`w2-rows.py` takes the LAST rows line of Task 9's section and the first `json` fence after it; `w2-results.py` replaces only its own section); the worker's suite 12 (`deviation-refs`, `dtbd`) is what measures the four entries.

- [ ] **Step 0: Preconditions.** From the worktree root, one Bash call:

```bash
SCRATCH=<abs path>; BASE=<the base sha Task 1 Step 0 printed>; mkdir -p "$SCRATCH" && echo "$BASE" > "$SCRATCH/w2-base"
git status --short
git merge-base --is-ancestor "$BASE" HEAD && echo base-is-ancestor
git show "$BASE:shared/docs.ts" | grep -c 'export const DOCS_FAILURES'
git cat-file -e "$BASE:server/src/docs" 2>/dev/null && echo base-has-docs-dir || echo base-has-no-docs-dir
git log --first-parent --no-merges --format=%s "$BASE"..HEAD | grep -c '(docs W2)$'
for p in server agent pwa; do { [ -d "$p/node_modules" ] && [ ! -L "$p/node_modules" ]; } || echo "not installed: $p"; done
grep -c '^### Task [1-9]: ' docs/superpowers/plans/2026-10-06-native-docs-reader-w2-grants-and-adapter.md
```

Expected: no status line; `base-is-ancestor`; `1`; `base-has-no-docs-dir`; at least `8` (one commit per task 1-8; a fix round's commits also end `(docs W2)`); no `not installed` line (else `( cd <pkg> && npm ci )` for that package, foreground); `9`. A base that fails any of these is not W2's base: read it again from the SDD ledger, and if it still fails, stop and put an ask to the coordinator.

- [ ] **Step 1: The every-wave suites (§7.9).** Write the suite runner to `<SCRATCH>/w2-suites.py`:

````python
#!/usr/bin/env python3
"""The W2 suites (the plan's Task 9, Steps 1, 2 and 5). Scratch only: never committed.

  python3 w2-suites.py SCRATCH ID [ID ...]          run those suites, in the foreground, one after another
  python3 w2-suites.py SCRATCH --rerun ID            run one suite again, ALONE, into its .rerun.log
  python3 w2-suites.py SCRATCH --list                print the table

Run from the worktree root. Each run writes SCRATCH/w2-suite-<ID>-<name>.log: the command on its first line, the
vitest output with colour codes stripped, and `rc=<n>` on its last line; it prints the command, vitest's
`Test Files` and `Tests` lines, every FAIL line, and the rc. A suite marked `fetch` runs `git fetch -q origin
main` first (deviation-refs and topology-clean measure against origin/main), unless CCRC_LEDGER_BASE or
CCRC_HISTORY_BASE is set, which those tests read before origin/main. Exit 0 only when every suite run is rc 0.
Never more than one Bash call's worth: the slowest single suite measured about 130 s.
"""
import os, re, subprocess, sys

SUITES = [
    ('01', 'topology-clean', 'server', ['test/topology-clean.test.ts'], None, True),
    ('02', 'single-definition', 'server', ['test/single-definition.test.ts'], None, False),
    ('03', 'deviation-refs', 'server', ['test/deviation-refs.test.ts'], None, True),
    ('04', 'typecheck-tests', 'server', ['test/typecheck-tests.test.ts'], None, False),
    ('05', 'agent-full', 'agent', [], None, False),
    ('06', 'grants-and-argv', 'server', ['test/whitelist-subset.test.ts', 'test/verb-gate.test.ts',
                                         'test/capsupported.test.ts', 'test/ccdargv-brand.test.ts',
                                         'test/ccdargv-dec-parity.test.ts'], None, False),
    ('07', 'budgets', 'server', ['test/remote-runner.test.ts', 'test/pr-timeout-budget.test.ts',
                                 'test/swap-timeout-budget.test.ts'], None, False),
    ('08', 'docs-new', 'server', ['test/docs-source.test.ts', 'test/docs-policy.test.ts',
                                  'test/docs-budget.test.ts'], None, False),
    ('09', 'touched-readers', 'server', ['test/lifecycle.test.ts', 'test/ccd-archive.test.ts',
                                         'test/caps-token-shape.test.ts'], None, False),
    ('10', 'docs-l0', 'server', ['test/docs-shared.test.ts', 'test/docs-parity.test.ts',
                                 'test/docs-url.test.ts'], None, False),
    ('11', 'session-hook-citations', 'server', ['test/session-hook.test.ts'], 'every line citation is anchored',
     False),
    ('12', 'plan-pins', 'server', ['test/topology-clean.test.ts', 'test/deviation-refs.test.ts',
                                   'test/dtbd.test.ts'], None, True),
]
BY_ID = dict((s[0], s) for s in SUITES)
ANSI = re.compile(r'\x1b\[[0-9;?]*[A-Za-z]')


def command(s):
    _id, _name, pkg, files, t, _fetch = s
    argv = ['./node_modules/.bin/vitest', 'run'] + (['-t', t] if t else []) + files
    shown = ' '.join(("'%s'" % a) if ' ' in a else a for a in argv)
    return pkg, argv, '( cd %s && %s )' % (pkg, shown)


def log_path(scratch, s, rerun):
    return os.path.join(scratch, 'w2-suite-%s-%s%s.log' % (s[0], s[1], '.rerun' if rerun else ''))


def run(scratch, s, rerun):
    pkg, argv, shown = command(s)
    if s[5] and not (os.environ.get('CCRC_LEDGER_BASE') or os.environ.get('CCRC_HISTORY_BASE')):
        f = subprocess.run(['git', 'fetch', '-q', 'origin', 'main'], capture_output=True, text=True)
        if f.returncode != 0:
            sys.exit('w2-suites.py: git fetch origin main failed: %s' % f.stderr.strip())
    p = subprocess.run(argv, cwd=pkg, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    out = ANSI.sub('', p.stdout.decode('utf-8', 'replace'))
    with open(log_path(scratch, s, rerun), 'w', encoding='utf-8') as fh:
        fh.write('$ %s\n%s\nrc=%d\n' % (shown, out.rstrip('\n'), p.returncode))
    print('== %s %s%s: %s' % (s[0], s[1], ' (re-run alone)' if rerun else '', shown))
    for line in out.splitlines():
        if re.match(r'^\s*(Test Files|Tests)\s', line) or re.match(r'^\s*FAIL\s', line):
            print('   ' + line.strip())
    print('   rc=%d' % p.returncode)
    return p.returncode


if len(sys.argv) < 3:
    sys.exit(__doc__)
SCRATCH = sys.argv[1]
if not os.path.isdir(SCRATCH):
    sys.exit('w2-suites.py: %s is not a directory' % SCRATCH)
if not os.path.isdir('server') or not os.path.isdir('agent'):
    sys.exit('w2-suites.py: run me from the worktree root')
if sys.argv[2] == '--list':
    for s in SUITES:
        print('%s %-24s %s%s' % (s[0], s[1], command(s)[2], '   [fetch]' if s[5] else ''))
    sys.exit(0)
rerun = sys.argv[2] == '--rerun'
ids = sys.argv[3:] if rerun else sys.argv[2:]
if rerun and len(ids) != 1:
    sys.exit('w2-suites.py: --rerun takes exactly one ID')
for i in ids:
    if i not in BY_ID:
        sys.exit('w2-suites.py: no suite %s (try --list)' % i)
rcs = [run(SCRATCH, BY_ID[i], rerun) for i in ids]
sys.exit(0 if all(rc == 0 for rc in rcs) else 1)
````

Then, one Bash call per line (`01` and `03` run `git fetch -q origin main` first, so `topology-clean` and `deviation-refs` measure against the main this worktree has just fetched):

```bash
SCRATCH=<abs path>; python3 "$SCRATCH/w2-suites.py" "$SCRATCH" 01
SCRATCH=<abs path>; python3 "$SCRATCH/w2-suites.py" "$SCRATCH" 02
SCRATCH=<abs path>; python3 "$SCRATCH/w2-suites.py" "$SCRATCH" 03
SCRATCH=<abs path>; python3 "$SCRATCH/w2-suites.py" "$SCRATCH" 04
```

Expected, each ending `rc=0` (counts measured at `049ddcc28` plus Tasks 1-8; a later `main` moves them, and what binds is rc 0):
- `01 topology-clean`: `Test Files 1 passed (1)`, `Tests 55 passed (55)`.
- `02 single-definition`: `1 passed (1)`, `465 passed (465)`.
- `03 deviation-refs`: `1 passed (1)`, `31 passed (31)`. Green means no allocator-era `D-N` is defined in two plans across this branch and `origin/main`.
- `04 typecheck-tests`: `1 passed (1)`, `12 passed (12)`; about 65 s.

A red suite: re-run it ALONE once, `SCRATCH=<abs path>; python3 "$SCRATCH/w2-suites.py" "$SCRATCH" --rerun <ID>` (it writes the `.rerun.log` beside the first, and the results table shows both rcs). `typecheck-tests` and `session-hook` are on `CLAUDE.md`'s load-flake list; a red that is green alone is recorded as that flake in `<SCRATCH>/w2-notes.md`, one line: `- suite <ID> <name>: red on the first run (<the FAIL line>), green re-run alone; a known load flake.`. A red that stays red alone is a finding: Step 4's last paragraph says how to report it, and this task stops there.

- [ ] **Step 2: The W2 suites.** One Bash call per line:

```bash
SCRATCH=<abs path>; python3 "$SCRATCH/w2-suites.py" "$SCRATCH" 05
SCRATCH=<abs path>; python3 "$SCRATCH/w2-suites.py" "$SCRATCH" 06
SCRATCH=<abs path>; python3 "$SCRATCH/w2-suites.py" "$SCRATCH" 07
SCRATCH=<abs path>; python3 "$SCRATCH/w2-suites.py" "$SCRATCH" 08
SCRATCH=<abs path>; python3 "$SCRATCH/w2-suites.py" "$SCRATCH" 09
SCRATCH=<abs path>; python3 "$SCRATCH/w2-suites.py" "$SCRATCH" 10
```

Expected, each ending `rc=0`:
- `05 agent-full` (`whitelist-structural` and `whitelist` included): `Test Files 25 passed (25)`, `Tests 471 passed (471)`.
- `06 grants-and-argv` (`whitelist-subset`, `verb-gate`, `capsupported`, `ccdargv-brand`, `ccdargv-dec-parity`): `5 passed (5)`, `167 passed (167)`.
- `07 budgets` (`remote-runner`, `pr-timeout-budget`, `swap-timeout-budget`): `3 passed (3)`, `32 passed (32)`.
- `08 docs-new` (`docs-source`, `docs-policy`, `docs-budget`): `3 passed (3)`, `437 passed (437)`.
- `09 touched-readers` (`lifecycle`, `ccd-archive`, `caps-token-shape`): `3 passed (3)`, `146 passed (146)`; about 125 s, nearly all of it `ccd-archive`.
- `10 docs-l0` (`docs-shared`, `docs-parity`, `docs-url`; W1's, unchanged by W2, which consumes `shared/docs.ts` and never amends it): `3 passed (3)`, `382 passed (382)`.

A red one is handled exactly as in Step 1.

- [ ] **Step 3: The census-free invariants.** Write the checker to `<SCRATCH>/w2-invariants.py`:

````python
#!/usr/bin/env python3
"""The W2 census-free invariants (the plan's Task 9, Step 3). Scratch only: never committed. Read-only.

  python3 w2-invariants.py BASE        from the worktree root; prints one PASS/FAIL line per invariant

W2's OWN change is the union of its own commits: `git log --first-parent --no-merges BASE..HEAD`. A merge of
origin/main into the branch (a fix round may make one) is on a second parent and never counts as W2's edit, which
a plain `git diff BASE HEAD` would get wrong. Exit 0 when every line is PASS, 1 otherwise.
"""
import os, re, subprocess, sys

if len(sys.argv) != 2:
    sys.exit(__doc__)
BASE = sys.argv[1]
PLAN = 'docs/superpowers/plans/2026-10-06-native-docs-reader-w2-grants-and-adapter.md'
SCOPE = {
    'agent/src/whitelist.ts',
    'agent/test/types/bypasses/g16-docs-index-without-all.ts',
    'agent/test/types/bypasses/g17-docs-tree-without-project.ts',
    'agent/test/types/bypasses/g18-docs-show-without-project.ts',
    'agent/test/types/bypasses/g19-docs-fetch-without-project.ts',
    'agent/test/types/ok/legit-whitelist.ts',
    'agent/test/whitelist-structural.test.ts',
    'agent/test/whitelist.test.ts',
    'server/src/ccdargv.ts',
    'server/src/remote/runner.ts',
    'server/src/lifecycle.ts',
    'server/src/docs/policy.ts',
    'server/src/docs/ports.ts',
    'server/src/docs/ccdsource.ts',
    'server/test/capsupported.test.ts',
    'server/test/ccd-archive.test.ts',
    'server/test/docs-budget.test.ts',
    'server/test/docs-policy.test.ts',
    'server/test/docs-source.test.ts',
    'server/test/lifecycle.test.ts',
    'server/test/remote-runner.test.ts',
    'server/test/single-definition.test.ts',
    'server/test/verb-gate.test.ts',
    'server/test/whitelist-subset.test.ts',
}
FORBIDDEN = ('ccd/', 'shared/', 'pwa/src/', 'server/src/server.ts', 'server/src/index.ts', 'README.md')
SD = 'server/test/single-definition.test.ts'
WANT_LINE = 'const want = AUDIT_WORDS.has(code)'


def git(*a):
    return subprocess.run(['git'] + list(a), capture_output=True, text=True, check=True).stdout


results = []


def check(name, ok, answer):
    results.append(ok)
    print('%s %-14s %s' % ('PASS' if ok else 'FAIL', name, answer))


def files_containing(root, needle):
    hits = {}
    for d, _dirs, fs in os.walk(root):
        for f in fs:
            if f.endswith('.ts'):
                p = os.path.join(d, f)
                n = open(p, encoding='utf-8').read().count(needle)
                if n:
                    hits[p] = n
    return hits


commits = git('rev-list', '--first-parent', '--no-merges', '--reverse', '%s..HEAD' % BASE).split()
touched = set(l for l in git('log', '--first-parent', '--no-merges', '--format=', '--name-only',
                                '%s..HEAD' % BASE).splitlines() if l)
print('base %s, tip %s, %d W2 commits' % (git('rev-parse', '--short=12', BASE).strip(),
                                          git('rev-parse', '--short=12', 'HEAD').strip(), len(commits)))

extra = sorted(touched - SCOPE - {PLAN})
missing = sorted(SCOPE - touched)
check('scope', not extra and not missing,
      '%d files touched by W2 commits; outside the scope: %s; scope files untouched: %s'
      % (len(touched), extra or 'none', missing or 'none'))

hit = sorted(p for p in touched if p.startswith(FORBIDDEN))
check('untouched', not hit, 'ccd/, shared/ (agent-protocol.ts and FLEET_PROTO included), pwa/src, server.ts, '
      'index.ts, README.md edited by W2: %s' % (hit or 'none'))

docs = sorted(git('ls-files', 'server/src/docs').split())
on_disk = sorted(os.path.join('server/src/docs', f) for f in os.listdir('server/src/docs'))
want = ['server/src/docs/ccdsource.ts', 'server/src/docs/policy.ts', 'server/src/docs/ports.ts']
check('docs-files', docs == want and on_disk == want, 'tracked %s; on disk %s' % (docs, on_disk))

wl = open('agent/src/whitelist.ts', encoding='utf-8').read()
n_exec = wl.count("export const EXEC_COMMANDS = ['tmux', 'ccd'] as const;")
n_ungr = wl.count("export const UNGRANTABLE_VERBS = ['ws-rm', 'ws-gc'] as const;")
check('exec-surface', n_exec == 1 and n_ungr == 1,
      "EXEC_COMMANDS = ['tmux', 'ccd'] x%d; UNGRANTABLE_VERBS = ['ws-rm', 'ws-gc'] x%d" % (n_exec, n_ungr))

api = open('shared/api.ts', encoding='utf-8').read()
n_p, n_pm = api.count('export const FLEET_PROTO = 1;'), api.count('export const FLEET_PROTO_MIN = 1;')
check('fleet-proto', n_p == 1 and n_pm == 1, 'FLEET_PROTO = 1 x%d; FLEET_PROTO_MIN = 1 x%d' % (n_p, n_pm))

cap = files_containing('server/src', "'docs-v1'")
check('cap-literal', cap == {'server/src/ccdargv.ts': 1}, "'docs-v1' quoted under server/src: %s" % cap)

argv = sorted(files_containing('server/src', 'CCD_ARGV.docs'))
check('builder-calls', argv == ['server/src/docs/ccdsource.ts'], 'CCD_ARGV.docs under server/src: %s' % argv)

replaced, appended, other = 0, 0, []
for c in commits:
    if SD not in git('show', '--format=', '--name-only', c).split():
        continue
    parent_lines = len(git('show', '%s^:%s' % (c, SD)).splitlines())
    patch = git('show', '-U0', '--format=', c, '--', SD)
    for m in re.finditer(r'^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@', patch, re.M):
        a, b = int(m.group(1)), int(m.group(2) or 1)
        cnt = int(m.group(4) or 1)
        body = patch[m.end():].split('\n@@', 1)[0]
        minus = [l for l in body.splitlines() if l.startswith('-')]
        if b == 1 and cnt == 1 and len(minus) == 1 and WANT_LINE in minus[0]:
            replaced += 1
        elif b == 0 and a == parent_lines:
            appended += 1
        else:
            other.append('%s %s' % (c[:9], m.group(0)))
check('sd-shape', replaced == 1 and appended >= 1 and not other,
      'single-definition.test.ts: %d in-place want-line edit, %d EOF append(s), other hunks: %s'
      % (replaced, appended, other or 'none'))

print('%d invariants, %d PASS' % (len(results), sum(results)))
sys.exit(0 if all(results) else 1)
````

Then, one Bash call per line:

```bash
SCRATCH=<abs path>; python3 "$SCRATCH/w2-invariants.py" "$(cat "$SCRATCH/w2-base")" | tee "$SCRATCH/w2-invariants.txt"; echo "rc=${PIPESTATUS[0]}"
SCRATCH=<abs path>; python3 "$SCRATCH/w2-suites.py" "$SCRATCH" 11
```

Expected: the `base … tip … <n> W2 commits` line, then eight `PASS` lines and `8 invariants, 8 PASS`, `rc=0`:
- `scope`: `24 files touched by W2 commits; outside the scope: none; scope files untouched: none` (the Global Constraints' scope list, exactly: no file outside it, and every file in it touched).
- `untouched`: `… edited by W2: none` (no `ccd/` edit, so no restamp and no citation tax; no `shared/` edit, so no `FLEET_PROTO` bump and no `shared/agent-protocol.ts` change; no `pwa/src`, `server.ts`, `index.ts` or `README.md` edit).
- `docs-files`: tracked and on disk, exactly `ccdsource.ts`, `policy.ts`, `ports.ts` (no `routes.ts`, `hooks.ts`, `lane.ts` or `cache.ts`: those are W3's).
- `exec-surface`: `EXEC_COMMANDS = ['tmux', 'ccd'] x1; UNGRANTABLE_VERBS = ['ws-rm', 'ws-gc'] x1`.
- `fleet-proto`: `FLEET_PROTO = 1 x1; FLEET_PROTO_MIN = 1 x1`.
- `cap-literal`: `'docs-v1' quoted under server/src: {'server/src/ccdargv.ts': 1}`.
- `builder-calls`: `CCD_ARGV.docs under server/src: ['server/src/docs/ccdsource.ts']`.
- `sd-shape`: `single-definition.test.ts: 1 in-place want-line edit, 1 EOF append(s), other hunks: none` (Task 2's line-count-neutral `want` line, Task 8's append; a fix-round append is a second EOF append and still passes).

The invariants read W2's OWN commits (`git log --first-parent --no-merges <base>..HEAD`), never `git diff <base> HEAD`: a merge of `origin/main` into this branch sits on a second parent and is not W2's edit, while a plain diff would count it. Then `11 session-hook-citations`: `Test Files 1 passed (1)`, `Tests 13 passed | 322 skipped (335)`, `rc=0`: the compaction card's line census (eight of its citations key on `single-definition.test.ts` by line) is unmoved, which is what "append at EOF only" bought. A `FAIL` line is a finding (Step 4's last paragraph); never edit the checker to make it pass.

- [ ] **Step 4: The mutation table.** Mutations never run in the worktree. Write the row extractor to `<SCRATCH>/w2-rows.py`:

````python
#!/usr/bin/env python3
"""Build the W2 mutation table from the plan itself (the plan's Task 9). Scratch only: never committed.

  python3 w2-rows.py PLAN OUT

Reads every `### Task <n>: ` section of PLAN, takes the LAST line in it that starts with
`**Mutation rows this task contributes**`, and parses the first ```json fence after that line. Tasks 1-8 must
each contribute at least one row and Task 9 none; ids are unique and named `W2-T<n>-M<k>` after their own task.
Each row keeps its fields verbatim (id, pkg, file, old, new, tests, red, t?) and gains `task`. Three rows gain
the measurement fields the plan text describes in prose but the JSON does not carry:
  - W2-T1-M2 and W2-T1-M3 red as a MODULE-LOAD throw (Task 1, "Measured while planning" 4): `expect: 'load'`
    plus the substring of the audit's refusal that must appear in vitest's output;
  - W2-T2-M14 reds `typecheck-tests`' server case (its `red` names it): `t` is set to that case, because the
    file's PWA case reds on its own wherever pwa/node_modules is a symlink, as it is in the mutation copy.
"""
import json, re, sys

if len(sys.argv) != 3:
    sys.exit(__doc__)
PLAN, OUT = sys.argv[1], sys.argv[2]
text = open(PLAN, encoding='utf-8').read()
heads = list(re.finditer(r'^### Task (\d+): ', text, re.M))
nums = [int(h.group(1)) for h in heads]
if nums != list(range(1, 10)):
    sys.exit('w2-rows.py: the plan has Task headings %r, not 1..9 in order; stop and report' % nums)
LEAD = '**Mutation rows this task contributes**'
EXTRA = {
    'W2-T1-M2': {'expect': 'load', 'loadMatch': "'docs-show' is only grantable with '--project'"},
    'W2-T1-M3': {'expect': 'load', 'loadMatch': "'docs-fetch' is only grantable with '--project'"},
    'W2-T2-M14': {'t': 'server/test/ is clean under a tests-inclusive project'},
}
FIELDS = ('id', 'pkg', 'file', 'old', 'new', 'tests', 'red')
rows, per = [], {}
for i, h in enumerate(heads):
    n = nums[i]
    sec = text[h.start():heads[i + 1].start() if i + 1 < len(heads) else len(text)]
    leads = [m.start() for m in re.finditer(r'^' + re.escape(LEAD), sec, re.M)]
    if not leads:
        sys.exit('w2-rows.py: Task %d has no "%s" line; stop and report' % (n, LEAD))
    fence = re.compile(r'^```json\n(.*?)\n```$', re.S | re.M).search(sec, leads[-1])
    if fence is None:
        sys.exit('w2-rows.py: Task %d has no ```json fence after its rows line; stop and report' % n)
    got = json.loads(fence.group(1))
    if not isinstance(got, list) or (n <= 8 and not got) or (n == 9 and got):
        sys.exit('w2-rows.py: Task %d contributes %r rows; Tasks 1-8 need some, Task 9 none' % (n, len(got)))
    for r in got:
        missing = [k for k in FIELDS if k not in r]
        if missing or not r['id'].startswith('W2-T%d-M' % n):
            sys.exit('w2-rows.py: row %r of Task %d: missing %r or a foreign id' % (r.get('id'), n, missing))
        r = dict(r, task='T%d' % n)
        r.update(EXTRA.get(r['id'], {}))
        rows.append(r)
    per['T%d' % n] = len(got)
ids = [r['id'] for r in rows]
if len(set(ids)) != len(ids):
    sys.exit('w2-rows.py: duplicate row ids')
unknown = sorted(set(EXTRA) - set(ids))
if unknown:
    sys.exit('w2-rows.py: no row %r for its measurement fields; stop and report' % unknown)
json.dump(rows, open(OUT, 'w', encoding='utf-8'), indent=1)
print('%d rows: %s' % (len(rows), ', '.join('%s %d' % kv for kv in per.items())))
````

Write the runner to `<SCRATCH>/mutate.py`:

````python
#!/usr/bin/env python3
"""Mutation runner for the native Docs reader, wave 2 (the plan's Task 9). Scratch only: never committed.

Run from the WORKTREE root. It reads HEAD with git, and it never writes inside the worktree:

  python3 mutate.py ROWS MUT setup             build MUT, a `git archive` copy of HEAD, and its manifest
  python3 mutate.py ROWS MUT baseline          every distinct test command the rows name, unmutated: all green
  python3 mutate.py ROWS MUT run [ID ...]      measure the rows not measured yet (all of them, or the IDs given)
  python3 mutate.py ROWS MUT final             MUT is byte-equal to HEAD again, and every test command is green
  python3 mutate.py ROWS MUT report            the measured table, as markdown, for the results section

ROWS is the list w2-rows.py writes: {id, task, pkg, file, old, new, tests, red, t?, expect?, loadMatch?,
timeoutS?}. A row replaces exactly one occurrence of `old` with `new` in MUT/<file>; an `old` that is absent or
not unique SKIPS the row and touches nothing. A row whose `old` is empty and whose `file` does not exist at HEAD
CREATES that file with `new` (and the restore deletes it). A row runs `vitest run --bail=1 [-t <t>] <tests>` in
MUT/<pkg>. `expect` is 'red' (the default: at least one test FAILED) or 'load' (no test failed, but a test file
failed to load, and the output names `loadMatch`: a guard that throws at module load).

Each row backs its file up under a sentinel of its own (MUT.bak/<id>.orig, or a record that the file was absent),
writes MUT.pending.json BEFORE it mutates, and restores the file byte for byte afterwards, asserting the sha256
the manifest recorded (or the absence). A run killed mid-row leaves MUT.pending.json behind, and the next
invocation restores from it before anything else. A mutated ccd/ccd is re-stamped (so no stamp check can pass for
a guard pin) and must pass `bash -n`, and its helper must parse at feature_version (3, 8) and import, or the row
is UNPARSEABLE, never red; any other mutated ccd/ file must pass `bash -n`.

One invocation starts a row or a command only while it has run less than BUDGET_S seconds AND that piece's own
bound still ends before CEILING_S, so every invocation ends inside a 600 s tool call; a piece that does not fit
waits for the next invocation, where it starts first. Run it again until it prints ALL ROWS MEASURED (or ALL
COMMANDS GREEN).
"""
import hashlib, json, os, re, shutil, signal, subprocess, sys, tempfile, time

BUDGET_S = 240
CEILING_S = 570
ROW_TIMEOUT_S = 300
UNIT_TIMEOUT_S = 300
OPENER = "  python3 /dev/fd/3 \"$@\" 3<<'DOCS_PY'\n"
CLOSER = '\nDOCS_PY\n'
RESTAMP = ("import { readFileSync, writeFileSync } from 'node:fs'; const { markGenerated } = await import("
           "'./shared/mark.mjs'); writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))")
IMPORT_CHECK = ("import importlib.util, sys\n"
                "s = importlib.util.spec_from_file_location('docs_helper', sys.argv[1])\n"
                "m = importlib.util.module_from_spec(s)\n"
                "s.loader.exec_module(m)\n")
ANSI = re.compile(r'\x1b\[[0-9;?]*[A-Za-z]')


def die(msg):
    print('mutate.py: ' + msg, file=sys.stderr)
    sys.exit(2)


def sha(b):
    return hashlib.sha256(b).hexdigest()


def on_signal(signum, _frame):
    raise SystemExit(128 + signum)


for _s in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
    signal.signal(_s, on_signal)

if len(sys.argv) < 4:
    die(__doc__)
ROWS_PATH, MUT, CMD = sys.argv[1], os.path.abspath(sys.argv[2]), sys.argv[3]
ROOT = os.getcwd()
top = subprocess.run(['git', 'rev-parse', '--show-toplevel'], capture_output=True, text=True)
if top.returncode != 0 or os.path.realpath(top.stdout.strip()) != os.path.realpath(ROOT):
    die('run me from the worktree root')
real_mut, real_root = os.path.realpath(MUT), os.path.realpath(ROOT)
if real_mut == real_root or real_mut.startswith(real_root + os.sep):
    die('MUT must lie OUTSIDE the worktree: mutations never run in it')
ROWS = json.load(open(ROWS_PATH, encoding='utf-8'))
BY_ID = dict((r['id'], r) for r in ROWS)
if len(BY_ID) != len(ROWS):
    die('duplicate row ids')
MANIFEST, RESULTS, PENDING, BAK = MUT + '.manifest.json', MUT + '.results.jsonl', MUT + '.pending.json', MUT + '.bak'
BASE_DONE, FINAL_DONE = MUT + '.baseline.json', MUT + '.final.json'
T0 = time.monotonic()


def head_sha():
    return subprocess.run(['git', 'rev-parse', 'HEAD'], capture_output=True, text=True, check=True).stdout.strip()


def head_bytes(f):
    """The file's bytes at HEAD, or None when HEAD has no such file."""
    p = subprocess.run(['git', 'cat-file', 'blob', 'HEAD:' + f], capture_output=True)
    return p.stdout if p.returncode == 0 else None


def load_manifest():
    if not os.path.exists(MANIFEST):
        die('no manifest: run setup first')
    m = json.load(open(MANIFEST))
    if m['head'] != head_sha():
        die('HEAD moved since setup: run setup, then baseline, again')
    return m


def matches(m, f):
    """True when MUT/<f> is what the manifest recorded: the HEAD bytes, or absent."""
    p = os.path.join(MUT, f)
    if m['files'][f] is None:
        return not os.path.lexists(p)
    return os.path.isfile(p) and sha(open(p, 'rb').read()) == m['files'][f]


def put_back(m, f, bak):
    p = os.path.join(MUT, f)
    if bak is None:
        if os.path.lexists(p):
            os.remove(p)
    else:
        shutil.copyfile(bak, p)
        os.remove(bak)
    if not matches(m, f):
        die('%s was not restored to the manifest state (backup %s)' % (f, bak))


def restore_pending(m):
    if not os.path.exists(PENDING):
        return
    p = json.load(open(PENDING))
    if p.get('pgid') and ours(p['pgid']):
        kill_group(p['pgid'])
    put_back(m, p['file'], p['bak'])
    os.remove(PENDING)
    print('restored %s, left mutated by an interrupted row %s' % (p['file'], p['id']))


def assert_pristine(m):
    for f in sorted(m['files']):
        if not matches(m, f):
            die('%s in MUT is not its HEAD state: run setup again' % f)


def kill_group(pgid):
    """SIGTERM to vitest's whole process group (its workers and anything they spawned), then SIGKILL."""
    for sig in (signal.SIGTERM, signal.SIGKILL):
        try:
            os.killpg(pgid, sig)
        except OSError:
            return
        if sig == signal.SIGTERM:
            time.sleep(5)


def ours(pid):
    """True only while pid is still a vitest leader running in MUT: a recorded pid can be reused once its process
    has gone, and this runner never signals a group it cannot prove is its own."""
    try:
        cwd = os.path.realpath('/proc/%d/cwd' % pid)
    except OSError:
        return False
    return cwd == real_mut or cwd.startswith(real_mut + os.sep)


def unit_of(r):
    return (r.get('pkg', 'server'), tuple(r['tests']), r.get('t'))


def units():
    seen = []
    for r in ROWS:
        u = unit_of(r)
        if u not in seen:
            seen.append(u)
    return seen


def unit_key(u):
    return '%s:%s%s' % (u[0], ' '.join(u[1]), (' -t %r' % u[2]) if u[2] else '')


def vitest(unit, timeout_s, bail, on_start=None):
    pkg, files, t = unit
    argv = (['./node_modules/.bin/vitest', 'run'] + (['--bail=1'] if bail else []) + (['-t', t] if t else [])
            + list(files))
    p = subprocess.Popen(argv, cwd=os.path.join(MUT, pkg), stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                         start_new_session=True)
    if on_start is not None:
        on_start(p.pid)
    try:
        out, _ = p.communicate(timeout=timeout_s)
        return p.returncode, ANSI.sub('', out.decode('utf-8', 'replace')), False
    except subprocess.TimeoutExpired:
        kill_group(p.pid)
        out, _ = p.communicate()
        return None, ANSI.sub('', out.decode('utf-8', 'replace')), True
    except BaseException:
        kill_group(p.pid)
        raise


def classify(rc, out, timed_out):
    """green | red | load | timeout | error. Red needs a FAILED TEST. Load is a test file that failed to load with
    no test failed (a guard that throws at import); a row accepts it only with expect 'load' and its loadMatch.
    Anything else that is not green (a config error, 'no test files') is error, never red."""
    if timed_out:
        return 'timeout', out.strip()[-600:]
    if rc == 0:
        return 'green', ''
    lines = out.splitlines()
    named = [l.strip() for l in lines if re.match(r'^\s*(FAIL|\u00d7|\u2717)\s', l) and ' > ' in l]
    counted = re.findall(r'^\s*Tests\s+(\d+) failed', out, re.M)
    if named or (counted and int(counted[-1]) > 0):
        return 'red', (named[0] if named else 'Tests %s failed' % counted[-1])[:240]
    files_failed = re.findall(r'^\s*Test Files\s+(\d+) failed', out, re.M)
    if files_failed and int(files_failed[-1]) > 0 and re.search(r'^\s*Tests\s+no tests', out, re.M):
        return 'load', 'Test Files %s failed, no tests' % files_failed[-1]
    return 'error', out.strip()[-1200:]


def check_ccd(path):
    """None when the mutated ccd/ccd still parses as bash and its helper parses at 3.8 and imports; else why."""
    r = subprocess.run(['bash', '-n', path], capture_output=True, text=True)
    if r.returncode != 0:
        return 'bash -n: ' + r.stderr.strip()[:300]
    text = open(path, encoding='utf-8').read()
    if text.count(OPENER) != 1:
        return 'the helper opener is not unique'
    a = text.index(OPENER) + len(OPENER)
    b = text.find(CLOSER, a)
    if b < 0:
        return 'the helper terminator is missing'
    src = text[a:b + 1]
    import ast
    try:
        ast.parse(src, feature_version=(3, 8))
    except SyntaxError as e:
        return 'helper SyntaxError: %s' % e
    with tempfile.NamedTemporaryFile('w', suffix='.py', delete=False, encoding='utf-8') as fh:
        fh.write(src)
        tmp = fh.name
    try:
        r = subprocess.run(['python3', '-c', IMPORT_CHECK, tmp], capture_output=True, text=True, timeout=60)
    finally:
        os.remove(tmp)
    if r.returncode != 0:
        return 'helper import: ' + r.stderr.strip()[-300:]
    return None


def results():
    got = {}
    if os.path.exists(RESULTS):
        for line in open(RESULTS, encoding='utf-8'):
            if line.strip():
                o = json.loads(line)
                got[o['id']] = o
    return got


def cmd_setup():
    for p in (MUT, BAK):
        if os.path.exists(p):
            shutil.rmtree(p)
    for p in (MANIFEST, RESULTS, PENDING, BASE_DONE, FINAL_DONE):
        if os.path.exists(p):
            os.remove(p)
    os.makedirs(MUT)
    os.makedirs(BAK)
    tar = subprocess.run(['git', 'archive', '--format=tar', 'HEAD'], capture_output=True, check=True).stdout
    subprocess.run(['tar', '-x', '-C', MUT], input=tar, check=True)
    subprocess.run(['git', '-C', MUT, 'init', '-q'], check=True)
    # All three packages: typecheck-tests resolves pwa's own compiler at module scope, whichever package runs it.
    for pkg in ('server', 'agent', 'pwa'):
        src = os.path.join(ROOT, pkg, 'node_modules')
        if not os.path.isdir(src):
            die('%s has no node_modules: run npm ci there first' % pkg)
        os.symlink(os.path.realpath(src), os.path.join(MUT, pkg, 'node_modules'))
    files = {}
    for r in ROWS:
        f = r['file']
        want = head_bytes(f)
        if want is None:
            if r['old'] != '':
                die('row %s mutates %s, which HEAD does not have' % (r['id'], f))
            files[f] = None
            continue
        data = open(os.path.join(MUT, f), 'rb').read()
        if data != want:
            die('%s in the archive differs from HEAD' % f)
        files[f] = sha(data)
    json.dump({'head': head_sha(), 'files': files}, open(MANIFEST, 'w'), indent=1)
    print('MUT ready at HEAD %s: %d files under mutation (%d created by a row), %d rows, %d test commands'
          % (head_sha()[:12], len(files), sum(1 for v in files.values() if v is None), len(ROWS), len(units())))


def fits(tmo):
    """May a piece bounded by tmo seconds start now?"""
    elapsed = time.monotonic() - T0
    return elapsed <= BUDGET_S and elapsed + tmo <= CEILING_S


def run_units(done_path, label):
    m = load_manifest()
    restore_pending(m)
    assert_pristine(m)
    done = json.load(open(done_path)) if os.path.exists(done_path) else {}
    for u in units():
        key = unit_key(u)
        if done.get(key) == 'green':
            continue
        if not fits(UNIT_TIMEOUT_S):
            print('%d of %d commands green; run `%s` again' % (len(done), len(units()), label))
            return 3
        rc, out, timed_out = vitest(u, UNIT_TIMEOUT_S, False)
        verdict, detail = classify(rc, out, timed_out)
        print('%-8s %s %s' % (verdict.upper(), key, detail[:300]))
        if verdict != 'green':
            print(out.strip()[-2000:])
            die('%s is not green unmutated: every red row would be meaningless; stop and report' % key)
        done[key] = 'green'
        json.dump(done, open(done_path, 'w'), indent=1)
    print('ALL COMMANDS GREEN (%s)' % label)
    return 0


def mutate_one(m, r):
    f = r['file']
    path = os.path.join(MUT, f)
    create = m['files'][f] is None
    if create:
        text = r['new']
    else:
        text = open(path, 'rb').read().decode('utf-8')
        n = text.count(r['old'])
        if n != 1:
            return 'skipped', '`old` occurs %d times in %s: %r' % (n, f, r['old'][:80])
        text = text.replace(r['old'], r['new'], 1)
    bak = None
    if not create:
        bak = os.path.join(BAK, r['id'] + '.orig')
        shutil.copyfile(path, bak)
    pending = {'id': r['id'], 'file': f, 'bak': bak}
    json.dump(pending, open(PENDING, 'w'))

    def started(pid):
        pending['pgid'] = pid
        json.dump(pending, open(PENDING, 'w'))

    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        open(path, 'w', encoding='utf-8').write(text)
        if f == 'ccd/ccd':
            subprocess.run(['node', '--input-type=module', '-e', RESTAMP], cwd=MUT, check=True)
            why = check_ccd(path)
            if why is not None:
                return 'unparseable', why
        elif f.startswith('ccd/'):
            p = subprocess.run(['bash', '-n', path], capture_output=True, text=True)
            if p.returncode != 0:
                return 'unparseable', 'bash -n: ' + p.stderr.strip()[:300]
        rc, out, timed_out = vitest(unit_of(r), r.get('timeoutS', ROW_TIMEOUT_S), True, started)
        verdict, detail = classify(rc, out, timed_out)
        if verdict == 'load' and r.get('loadMatch') and r['loadMatch'] not in out:
            return 'error', 'a load failure that does not name %r: %s' % (r['loadMatch'], out.strip()[-600:])
        return verdict, detail
    finally:
        put_back(m, f, bak)
        os.remove(PENDING)


def ok_of(r, verdict):
    return verdict == r.get('expect', 'red')


def cmd_run(ids):
    m = load_manifest()
    restore_pending(m)
    assert_pristine(m)
    for i in ids:
        if i not in BY_ID:
            die('no row %s' % i)
    got = results()
    queue = [r for r in ROWS if r['id'] in ids] if ids else [r for r in ROWS if r['id'] not in got]
    bad = 0
    for r in queue:
        if not fits(r.get('timeoutS', ROW_TIMEOUT_S)):
            continue
        t = time.monotonic()
        verdict, detail = mutate_one(m, r)
        ok = ok_of(r, verdict)
        rec = {'id': r['id'], 'verdict': verdict, 'ok': ok, 'detail': detail, 'seconds': int(time.monotonic() - t)}
        with open(RESULTS, 'a', encoding='utf-8') as fh:
            fh.write(json.dumps(rec) + '\n')
        bad += 0 if ok else 1
        print('== %-10s [%s] %-11s %s  %ss  %s' % (r['id'], r['task'], verdict.upper(), 'ok' if ok else 'NOT OK',
              rec['seconds'], detail[:200]))
    assert_pristine(m)
    left = [x['id'] for x in ROWS if x['id'] not in results()]
    if left:
        print('%d rows left (%s...): run `run` again' % (len(left), ', '.join(left[:6])))
        return 3
    nok = [x for x in results().values() if not x['ok']]
    print('ALL ROWS MEASURED: %d ok, %d not ok%s' % (len(ROWS) - len(nok), len(nok),
          (' -> ' + ', '.join(x['id'] for x in nok)) if nok else ''))
    return 1 if (nok or bad) else 0


def cmd_final():
    m = load_manifest()
    restore_pending(m)
    for f in sorted(m['files']):
        p = os.path.join(MUT, f)
        if m['files'][f] is None:
            if os.path.lexists(p):
                die('%s exists in MUT, and HEAD has no such file' % f)
        elif not matches(m, f) or open(p, 'rb').read() != head_bytes(f):
            die('%s in MUT is not byte-equal to HEAD' % f)
    print('MUT byte-equal to HEAD for all %d files under mutation' % len(m['files']))
    return run_units(FINAL_DONE, 'final')


def cmd_report():
    got = results()
    cell = lambda s: s.replace('|', '\\|').replace('\n', ' ')
    out = ['| Row | Task | File | Result | First red case (measured) |', '|---|---|---|---|---|']
    for r in ROWS:
        g = got.get(r['id'])
        if g is None:
            res, case = 'NOT MEASURED', ''
        else:
            res = g['verdict'] + ('' if g['ok'] else ' (NOT OK)')
            # Only a red or load detail is a test's own name; any other detail can carry a scratch path, and
            # stays in MUT.results.jsonl for the report to the coordinator.
            case = (re.sub(r'^FAIL\s+', '', g['detail']) if g['verdict'] in ('red', 'load')
                    else '(detail in w2-mut.results.jsonl)')
        out.append('| %s | %s | `%s` | %s | %s |' % (r['id'], r['task'], r['file'], res, cell(case[:160])))
    nok = [r['id'] for r in ROWS if r['id'] not in got or not got[r['id']]['ok']]
    out.append('')
    out.append('%d rows; %d measured as expected%s.' % (len(ROWS), len(ROWS) - len(nok),
               ('; not as expected or not measured: ' + ', '.join(nok)) if nok else ''))
    print('\n'.join(out))
    return 0


if CMD == 'setup':
    cmd_setup()
    sys.exit(0)
if CMD == 'baseline':
    sys.exit(run_units(BASE_DONE, 'baseline'))
if CMD == 'run':
    if not os.path.exists(BASE_DONE) or len(json.load(open(BASE_DONE))) != len(units()):
        die('run `baseline` to ALL COMMANDS GREEN first')
    sys.exit(cmd_run(sys.argv[4:]))
if CMD == 'final':
    sys.exit(cmd_final())
if CMD == 'report':
    sys.exit(cmd_report())
die('unknown command %r' % CMD)
````

Extract the rows from this plan, build the copy and prove every test command green in it, one Bash call per line, repeating `baseline` until it prints `ALL COMMANDS GREEN (baseline)`:

```bash
SCRATCH=<abs path>; python3 "$SCRATCH/w2-rows.py" docs/superpowers/plans/2026-10-06-native-docs-reader-w2-grants-and-adapter.md "$SCRATCH/w2-rows.json"
SCRATCH=<abs path>; python3 "$SCRATCH/mutate.py" "$SCRATCH/w2-rows.json" "$SCRATCH/w2-mut" setup
SCRATCH=<abs path>; python3 "$SCRATCH/mutate.py" "$SCRATCH/w2-rows.json" "$SCRATCH/w2-mut" baseline
```

Expected: `147 rows: T1 9, T2 14, T3 19, T4 22, T5 14, T6 27, T7 27, T8 15, T9 0`; then `MUT ready at HEAD <12 hex>: 13 files under mutation (1 created by a row), 147 rows, 16 test commands`; then sixteen `GREEN` lines and `ALL COMMANDS GREEN (baseline)`. A command that is not green unmutated stops the runner: run the same files in the worktree (`( cd <pkg> && ./node_modules/.bin/vitest run [-t '<t>'] <files> )`). Green there means the copy differs from the tree: stop and report. Red there too means a load flake or a real break: re-run it alone once, and report it if it stays red. Never run a row against a red baseline. If the extractor stops (a heading count, a missing rows line, an empty block, a foreign id), the plan was edited after it was written: report it, never hand-write `w2-rows.json`.

Then measure, one Bash call per invocation, repeating `run` (exit 3 means rows are left) until it prints `ALL ROWS MEASURED`:

```bash
SCRATCH=<abs path>; python3 "$SCRATCH/mutate.py" "$SCRATCH/w2-rows.json" "$SCRATCH/w2-mut" run
```

Each row prints `== <id> [T<n>] <VERDICT> ok|NOT OK <seconds>s <first red case>` and is appended to `w2-mut.results.jsonl`, so an interrupted invocation loses at most the row in flight. Expected: `ALL ROWS MEASURED: 147 ok, 0 not ok`, with every row `RED` except `W2-T1-M2` and `W2-T1-M3`, which are `LOAD`. A row that is `NOT OK`:
- **SKIPPED**: its `old` is not in the file exactly once. Find the guard the row's `red` names in the shipped file. If it is there with another spelling (a review round changed the task's code after the plan was written), rewrite that row's `old`/`new` in `w2-rows.json` as the SAME mutation of the shipped text, re-measure it alone (`… run <ID>`), and add one line to `<SCRATCH>/w2-notes.md`: `- <ID>: re-anchored to the shipped text; same mutation.`. If the guard is gone, it is a finding.
- **GREEN** where red was expected: a guard nothing pins. Re-measure it alone once; if it stays green, it is a finding. Closing it is a test change in the owning task's file, and the coordinator orders that round; never weaken or drop the row.
- **LOAD** on a row that expects red, **ERROR**, or **TIMEOUT**: re-measure it alone once; if it repeats, it is a finding, with the detail `w2-mut.results.jsonl` holds. It is unmeasured, never red.
- **UNPARSEABLE**: the row leaves a `ccd/` file unparseable. A finding; never counted.

Then prove the copy restored and green again, repeating `final` until it prints `ALL COMMANDS GREEN (final)`, prove the worktree untouched, and write the table:

```bash
SCRATCH=<abs path>; python3 "$SCRATCH/mutate.py" "$SCRATCH/w2-rows.json" "$SCRATCH/w2-mut" final
SCRATCH=<abs path>; git status --short; python3 "$SCRATCH/mutate.py" "$SCRATCH/w2-rows.json" "$SCRATCH/w2-mut" report > "$SCRATCH/w2-mutation-table.md"; tail -n 1 "$SCRATCH/w2-mutation-table.md"
```

Expected: `MUT byte-equal to HEAD for all 13 files under mutation`, sixteen `GREEN` lines, `ALL COMMANDS GREEN (final)`; no status line; `147 rows; 147 measured as expected.`.

**Reporting a finding** (any step). The coordinator rules on it; this worker never fixes it in this task. Send ONE `finding` mail per finding, then wait for the ruling (it arrives as mail; list it as Step 6 does). `<SUBJECT>` names the step and the id (`W2 Task 9: mutation row W2-T6-M12 stays green`, `W2 Task 9: suite 09 red alone`, `W2 Task 9: invariant sd-shape FAIL`), and `<BODY>` quotes the printed line and the file that holds the detail:

```bash
SCRATCH=<abs path>; RUN=<the runId the brief names>; API="$HOME/.local/bin/ccrc-api"
who=$("$API" whoami) || { printf 'identity refused: %s\n' "$who" >&2; exit 1; }
id=${who#*\"id\":\"};     id=${id%%\"*}
uuid=${who#*\"uuid\":\"}; uuid=${uuid%%\"*}
[[ -n "$id" && -n "$uuid" ]] || { printf 'identity unreadable: %s\n' "$who" >&2; exit 1; }
python3 - "$id" "$uuid" "$RUN" '<SUBJECT>' '<BODY>' <<'PY' | "$API" mail send --json -
import json, sys
i, u, run, subject, body = sys.argv[1:6]
print(json.dumps({'fromId': i, 'fromUuid': u, 'toId': 'coordinator', 'runId': int(run), 'kind': 'finding',
                  'subject': subject, 'body': body, 'artifacts': []}))
PY
```

Expected: a JSON answer with `"ok":true`. A `stale-uuid` means the identity was cached; re-run the whole block. When the coordinator rules that a red is to be RECORDED as it stands (rather than fixed in a round), Step 5 runs `w2-results.py` with `--record-reds` and the ruling is quoted in `w2-notes.md`.

- [ ] **Step 5: The results record and the commit.** Write the section writer to `<SCRATCH>/w2-results.py`:

````python
#!/usr/bin/env python3
"""Write `## Wave 2 results` at the end of the plan (the plan's Task 9, Step 5). Scratch only: never committed.

  python3 w2-results.py SCRATCH BASE [--record-reds]

Run from the worktree root, after Steps 1-4. It reads only what those steps wrote into SCRATCH:
w2-suite-01..11 logs (and any .rerun.log), w2-invariants.txt, w2-mutation-table.md, and w2-notes.md when it
exists. It refuses (exit 2, plan untouched) when a suite's last rc is not 0, an invariant is not PASS, or the
mutation table's last line does not say every row measured as expected, unless --record-reds is given, which is
used ONLY when the coordinator has ruled that the reds be recorded as they stand. A section already present is
replaced (it is the plan's last `## ` section by construction); nothing above it is touched.
"""
import datetime, os, re, subprocess, sys

PLAN = 'docs/superpowers/plans/2026-10-06-native-docs-reader-w2-grants-and-adapter.md'
HEAD = '## Wave 2 results'
IDS = ['%02d' % i for i in range(1, 12)]
CARRIED = [
    'SEC-3: an externally killed helper orphans git\'s process group. W2\'s lever is Task 5\'s pinned budget '
    'invariant (helper deadline + 2 s grace + 5 s < the runner budget), so the agent never kills ccd in normal '
    'operation; the helper-side signal trap (a ccd change) and an agent-side group kill remain unscheduled.',
    'MT-2: ccd cuts stderr before it redacts it, so L3\'s second redaction pass cannot recover a secret the cut '
    'split; noted in `docs-source.test.ts`\'s header.',
    'Contract F4: `branch: null` is detached OR unmeasured; the adapter carries it verbatim.',
    'D-4157 (from W1\'s ledger): `unwalked` is absent when 0; carried, never defaulted.',
    'D-4158 (from W1\'s ledger): `lockAgeMs` is a number, `null` or ABSENT; carried, never defaulted.',
    'D-4164 (from W1\'s ledger): `too-many-entries` is read by `count`, never by `bytes`.',
    'The partial-clone word pair (W1\'s CI-fix ruling, deferred to W2\'s adapter): a commit missing from a partial '
    'clone answers `git-failed {step:\'cat-file\'}` on git 2.43 and `unknown-commit` on git 2.55. L3 carries both '
    'words verbatim, because it never maps one known ccd word onto another (refinement (j)); one word for one '
    'condition is a ccd change, or W5\'s failure sentence.',
]


def die(msg):
    print('w2-results.py: ' + msg, file=sys.stderr)
    sys.exit(2)


def git(*a):
    return subprocess.run(['git'] + list(a), capture_output=True, text=True, check=True).stdout.strip()


def summary(path):
    text = open(path, encoding='utf-8').read()
    lines = text.splitlines()
    cmd = lines[0][2:] if lines and lines[0].startswith('$ ') else '?'
    rc = int(re.findall(r'^rc=(\d+)$', text, re.M)[-1])
    pick = lambda label: next((re.sub(r'\s+', ' ', l.strip())[len(label):].strip()
                               for l in reversed(lines) if l.strip().startswith(label + ' ')), '-')
    fails = [l.strip()[len('FAIL'):].strip() for l in lines if re.match(r'^\s*FAIL\s', l)]
    return cmd, pick('Test Files'), pick('Tests'), rc, fails


if len(sys.argv) not in (3, 4) or (len(sys.argv) == 4 and sys.argv[3] != '--record-reds'):
    die(__doc__)
S, BASE, record = sys.argv[1], sys.argv[2], len(sys.argv) == 4
if not os.path.isfile(PLAN):
    die('no %s: run me from the worktree root' % PLAN)
if subprocess.run(['git', 'diff', '--quiet', 'HEAD', '--', PLAN]).returncode != 0:
    die('%s has uncommitted edits; this script must be the only writer' % PLAN)

reds, rows = [], []
for i in IDS:
    found = sorted(f for f in os.listdir(S) if re.match(r'^w2-suite-%s-[a-z0-9-]+\.log$' % i, f))
    if len(found) != 1:
        die('expected one w2-suite-%s-*.log in %s, found %r: run that suite first' % (i, S, found))
    cmd, files, tests, rc, fails = summary(os.path.join(S, found[0]))
    cell = '%d' % rc
    rerun = os.path.join(S, found[0][:-len('.log')] + '.rerun.log')
    final_rc = rc
    if os.path.exists(rerun):
        _c, files, tests, final_rc, fails2 = summary(rerun)
        cell = '%d; re-run alone: %d' % (rc, final_rc)
        fails = fails2 if final_rc else fails
    if final_rc != 0:
        reds.append('suite %s' % i)
    esc = lambda s: s.replace('|', '\\|')
    rows.append('| %s | `%s` | %s | %s | %s |' % (i, esc(cmd), esc(files), esc(tests), cell))
    for f in (fails if final_rc else []):
        rows.append('|  | FAIL: %s |  |  |  |' % f.replace('|', '\\|')[:200])

inv = open(os.path.join(S, 'w2-invariants.txt'), encoding='utf-8').read().rstrip('\n')
reds += ['invariant: ' + l for l in inv.splitlines() if l.startswith('FAIL ')]
if not re.search(r'^\d+ invariants, \d+ PASS$', inv, re.M):
    die('w2-invariants.txt has no summary line: run Step 3 again')
table = open(os.path.join(S, 'w2-mutation-table.md'), encoding='utf-8').read().rstrip('\n')
last = table.splitlines()[-1]
m = re.match(r'^(\d+) rows; (\d+) measured as expected', last)
if not m:
    die('w2-mutation-table.md does not end with the runner\'s count line: run Step 4\'s report again')
if m.group(1) != m.group(2):
    reds.append('mutation table: ' + last)
if reds and not record:
    die('not all green, so nothing is written; report these to the coordinator:\n  ' + '\n  '.join(reds))
notes_path = os.path.join(S, 'w2-notes.md')
notes = open(notes_path, encoding='utf-8').read().strip() if os.path.exists(notes_path) else ''

tip = git('rev-parse', '--short=12', 'HEAD')
base = git('rev-parse', '--short=12', BASE)
n = len(git('rev-list', '--first-parent', '--no-merges', '%s..HEAD' % BASE).split())
when = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%d %H:%M UTC')
out = [HEAD, '',
       'Measured %s on the tree at `%s` (base `%s`, %d W2 commits on the first-parent line). Every number below '
       'was printed by a Task 9 command; none is a forecast. The commit that adds this section changes only this '
       'file, and it is the wave-done `handoffCommit`.' % (when, tip, base, n), '',
       '### Suites', '',
       '| # | Command | Test Files | Tests | rc |', '|---|---|---|---|---|'] + rows + [
       '', '### Invariants', '',
       'From `w2-invariants.py` (W2\'s own commits: `git log --first-parent --no-merges <base>..HEAD`):', '',
       '```text', inv, '```', '',
       '### Mutation table', '',
       'Every `W2-T<n>-M<k>` row of Tasks 1-8, extracted from this plan and run by `mutate.py` in a `git archive` '
       'copy of the tree at `%s`, one row at a time, each file restored byte for byte after its row. '
       '`load` is a guard that throws at module load (Task 1, rows M2 and M3).' % tip, '',
       table, '',
       '### Notes', '',
       notes if notes else 'None: no suite needed a re-run, and no row was re-anchored or reported.', '',
       '### Carried, not fixed', ''] + ['- ' + c for c in CARRIED] + ['']
section = '\n'.join(out)
text = open(PLAN, encoding='utf-8').read()
at = text.find('\n' + HEAD + '\n')
if at >= 0:
    if re.search(r'^## ', text[at + len(HEAD) + 2:], re.M):
        die('%s is not the plan\'s last ## section; stop and report' % HEAD)
    text = text[:at + 1]
elif not text.endswith('\n'):
    text += '\n'
open(PLAN, 'w', encoding='utf-8').write(text + ('' if text.endswith('\n\n') else '\n') + section)
print('wrote %s (%d lines) to %s%s' % (HEAD, section.count('\n'), PLAN, '; WITH REDS, on the coordinator\'s ruling'
                                       if reds else ''))
````

Then, one Bash call per line:

```bash
SCRATCH=<abs path>; python3 "$SCRATCH/w2-results.py" "$SCRATCH" "$(cat "$SCRATCH/w2-base")"
git status --short; git diff --stat
SCRATCH=<abs path>; python3 "$SCRATCH/w2-suites.py" "$SCRATCH" 12
SCRATCH=<abs path>; E=.superpowers/sdd/2026-10-06-native-docs-reader-w2-grants-and-adapter/task-9-evidence; mkdir -p "$E" && cp "$SCRATCH"/w2-suite-*.log "$SCRATCH/w2-invariants.txt" "$SCRATCH/w2-rows.json" "$SCRATCH/w2-mut.results.jsonl" "$SCRATCH/w2-mutation-table.md" "$E"/ && { [ ! -f "$SCRATCH/w2-notes.md" ] || cp "$SCRATCH/w2-notes.md" "$E"/; } && ls "$E" | wc -l && git status --short
```

Expected: `wrote ## Wave 2 results (<n> lines) to docs/superpowers/plans/2026-10-06-native-docs-reader-w2-grants-and-adapter.md` (about 200 lines: the mutation table is 147 of them); then ` M docs/superpowers/plans/2026-10-06-native-docs-reader-w2-grants-and-adapter.md` alone and its `1 file changed` stat; then `12 plan-pins` (`topology-clean`, `deviation-refs`, `dtbd`, re-run because the plan changed): `Test Files 3 passed (3)`, `Tests 87 passed (87)`, `rc=0` (the section names no real host, project, user or account; it DEFINES no `D-N`, since the inherited numbers are restated as `- D-4157 (from W1's ledger): …`, which is not a definition line; and it carries no concrete `D-TBD-` placeholder, which `dtbd` would red); then the evidence count (`16`: twelve suite logs and four files; one more for `w2-notes.md` and one per `.rerun.log`) and the same single status line. If `w2-results.py` refuses with its `not all green` list, every item on it is a finding still open: report it (Step 4) and stop. Then read the section once, top to bottom, with `sed -n '/^## Wave 2 results$/,$p' docs/superpowers/plans/2026-10-06-native-docs-reader-w2-grants-and-adapter.md`: every number in it was printed by a command above, and nothing in it is a forecast.

Commit, in its own Bash call, only after the `12 plan-pins` line read `rc=0`:

```bash
git add docs/superpowers/plans/2026-10-06-native-docs-reader-w2-grants-and-adapter.md
git commit -m "docs: W2 results (docs W2)" \
  -m "Task 9's measured record: the every-wave and W2 suites with their counts, eight census-free invariants (W2's own commits touch exactly the scope list; no ccd/, shared/, pwa/src, server.ts, index.ts or README.md edit; server/src/docs holds exactly policy.ts, ports.ts and ccdsource.ts; the exec surface, FLEET_PROTO, the docs-v1 literal and the builder call site as the plan states; single-definition.test.ts changed by one in-place line and an EOF append only), session-hook's citation census unmoved, and the 147-row mutation table run at the wave's end state in a git-archive copy, every row restored byte for byte. No push, no PR." \
  -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
git log -1 --format='%H %s'; git status --short
```

Expected: the new sha and `docs: W2 results (docs W2)`; no status line.

- [ ] **Step 6: Report the wave done (`ccrc-worker`).** First list mail, so nothing the coordinator sent while the suites ran sits unread under a wave-done (a hold once sat three hours that way). One Bash call:

```bash
API="$HOME/.local/bin/ccrc-api"
who=$("$API" whoami) || { printf 'identity refused: %s\n' "$who" >&2; exit 1; }
id=${who#*\"id\":\"}; id=${id%%\"*}
[[ -n "$id" ]] || { printf 'identity unreadable: %s\n' "$who" >&2; exit 1; }
"$API" mail list --to "$id"
```

For every row not yet acked, read and ack it BEFORE acting on it, one Bash call per row, with `D` set to the row's `deliveryId` (never the row's own `id`, which is a different sequence):

```bash
API="$HOME/.local/bin/ccrc-api"; D=<the row's deliveryId>
who=$("$API" whoami) || { printf 'identity refused: %s\n' "$who" >&2; exit 1; }
id=${who#*\"id\":\"};     id=${id%%\"*}
uuid=${who#*\"uuid\":\"}; uuid=${uuid%%\"*}
[[ -n "$id" && -n "$uuid" ]] || { printf 'identity unreadable: %s\n' "$who" >&2; exit 1; }
"$API" mail fetch "$D"
printf '{"fromId":"%s","fromUuid":"%s"}' "$id" "$uuid" | "$API" mail ack "$D" --json -
```

A mail that changes the wave (a hold, a ruling, a fix-round order) is obeyed first, and this step starts again after it.

Then measure the fingerprint ONCE and send it ONCE, in one Bash call. W2 pushes nothing and opens no PR (push, PR and merge are the coordinator's and the operator's acts after the review rules clean), so the PR fields are read, not assumed: `gh pr list` must print `[]`.

```bash
SCRATCH=<abs path>; RUN=<the runId the brief names>; API="$HOME/.local/bin/ccrc-api"
who=$("$API" whoami) || { printf 'identity refused: %s\n' "$who" >&2; exit 1; }
id=${who#*\"id\":\"};     id=${id%%\"*}
uuid=${who#*\"uuid\":\"}; uuid=${uuid%%\"*}
[[ -n "$id" && -n "$uuid" ]] || { printf 'identity unreadable: %s\n' "$who" >&2; exit 1; }
[ -z "$(git status --short)" ] || { echo 'worktree not clean: stop'; exit 1; }
[ "$(git log -1 --format=%s)" = 'docs: W2 results (docs W2)' ] || { echo 'tip is not the results commit: stop'; exit 1; }
prs=$(gh pr list --head "$(git branch --show-current)" --state all --json number); echo "prs=$prs"
[ "$prs" = '[]' ] || { echo 'a PR exists for this branch: stop and report, never send a fingerprint that hides it'; exit 1; }
tip=$(git rev-parse HEAD); echo "tip=$tip"
python3 - "$id" "$uuid" "$RUN" "$tip" "$SCRATCH" <<'PY' | "$API" mail send --json -
import json, os, sys
i, u, run, tip, scratch = sys.argv[1:6]
ev = os.path.abspath('.superpowers/sdd/2026-10-06-native-docs-reader-w2-grants-and-adapter/task-9-evidence')
table = open(os.path.join(scratch, 'w2-mutation-table.md'), encoding='utf-8').read().rstrip('\n').splitlines()[-1]
inv = [l for l in open(os.path.join(scratch, 'w2-invariants.txt'), encoding='utf-8').read().splitlines()
       if l.endswith(' PASS') and ' invariants, ' in l]
fp = json.dumps({'branchTip': tip, 'prNumber': None, 'prPhase': 'none', 'handoffCommit': tip}, separators=(',', ':'))
body = '\n'.join([
    'suite: unrun',
    fp,
    'W2 (grants and adapter), tasks 1-9 done on this workspace branch; no push, no PR.',
    'Results: docs/superpowers/plans/2026-10-06-native-docs-reader-w2-grants-and-adapter.md, section Wave 2 results.',
    'Mutation table: ' + table,
    'Invariants: ' + (inv[0] if inv else 'NO SUMMARY LINE'),
    'Evidence (logs, rows, results): ' + ev,
])
print(json.dumps({'fromId': i, 'fromUuid': u, 'toId': 'coordinator', 'runId': int(run), 'kind': 'status',
                  'subject': 'wave-done', 'body': body, 'artifacts': [os.path.join(ev, 'w2-mutation-table.md'),
                  os.path.join(ev, 'w2-invariants.txt')]}))
PY
```

Expected: `prs=[]`, the tip, and a JSON answer with `"ok":true`. `suite: unrun` is the honest signal: W2 runs the §7.9 selection, never the full server suite (clause 15; the PR's CI and the daily full run are the coordinator's later reads). If a coordinator ruling had a red recorded (`--record-reds`), the first line is `suite: red` followed by `failure: ceiling` or `failure: shallow` as that ruling names it. Then stop: no commit and no push after `wave-done` (clause 9); a review run reads this tip, and a fix round, if the coordinator orders one, arrives as mail.

No commit in this task but Step 5's: everything else it writes is scratch or gitignored evidence.

**Mutation rows this task contributes** (none: Task 9 adds no guard; it runs Tasks 1-8's 146 rows at the wave's end state and records what they measured):

```json
[]
```

## Deviations found

- **D-4374 (2026-10-07)** — the docs cap gate lives in two adapter functions, not "inside the one adapter function" (spec §2 (a)). `readDocs` (index, tree, both shows, one `switch`) and `fetchDocs` each carry §2 (a)'s two gate lines literally, because `verb-gate.test.ts` reads the nearest enclosing function of every `CCD_ARGV.docs*(` call for a literal `capSupported(` (a shared gate helper would read as ungated) and §2 (g)'s wall 1 keeps the fetch path apart from the reader. Refinement (c); Task 6.
- **D-4375 (2026-10-07)** — each port operation's failure arm is the whole `DocsFailureBody`, not a per-operation union, and `index` takes `DocsNodeId {node}`, not `DocsSourceId` (spec §1). ccd's per-verb word set is not a checked contract (check 7 tests membership in the ccd set only), so a narrower static union would claim what the adapter cannot measure, and docs-index is project-less. Refinement (d); Task 6.
- **D-4376 (2026-10-07)** — `ccd-fault` carries `stderrHead` but no `code` (spec §2 (b) check 5 names `ccd-fault {code, stderrHead}`). `CcdResult` carries `ok`, not the exit code, and widening it would change `ccd()`'s output under existing `toEqual` pins; the adapter never invents a code (absent means unmeasured, never `1`). Refinement (f); Task 6.
- **D-4377 (2026-10-07)** — `server/src/lifecycle.ts`, outside §7.7's W2 row, gains `CcdEnding` and `ccdEnding`, and `cutShort` is re-expressed through it with identical answers, so `killed` and `signal` keep one reader for the adapter's check 1 and `cutShort` alike. Check 1 is read through it as `ending unmeasured && !ok && stdout === ''` (the transport catch's shape), not §2 (b) check 1's "killed and signal both UNMEASURED": an ok answer whose halves are unmeasured proceeds to parsing, a failed answer that carries stdout passes check 1, and the half-measured `(killed:false, signal:UNMEASURED)` shape, which has no producer, reads as check 1. Check 3 likewise reads through it, so `(killed: UNMEASURED, signal: 'SIGKILL')`, a half-measured frame no known producer sends, answers `ccd-killed` as `cutShort` already reads it, where §2 (b) check 3 names `killed === false`. Refinement (g); Task 6.
- **D-4378 (2026-10-07)** — the second redaction pass bounds its depth (`REDACT_MAX_DEPTH`, 8) and a failure body nested deeper answers `malformed-answer {why:'schema'}`; the spec is silent on nesting and refinement (k) says "recursively", but an unbounded walk lets a hostile or broken ccd line nested ~20 000 deep (inside the listing bound) throw `RangeError`, so the port's promise rejects instead of answering a word, against `ports.ts`'s "rejects only on a defect". Found by the whole-branch review; final-review fix wave.

## Wave 2 results

Measured 2026-10-07 23:39 UTC on the tree at `64ebe8351560` (base `a17e14bc00c4`, 16 W2 commits on the first-parent line). Every number below was printed by a Task 9 command; none is a forecast. The commit that adds this section changes only this file, and it is the wave-done `handoffCommit`.

### Suites

| # | Command | Test Files | Tests | rc |
|---|---|---|---|---|
| 01 | `( cd server && ./node_modules/.bin/vitest run test/topology-clean.test.ts )` | 1 passed (1) | 55 passed (55) | 0 |
| 02 | `( cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts )` | 1 passed (1) | 472 passed (472) | 0 |
| 03 | `( cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts )` | 1 passed (1) | 31 passed (31) | 0 |
| 04 | `( cd server && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts )` | 1 passed (1) | 12 passed (12) | 0 |
| 05 | `( cd agent && ./node_modules/.bin/vitest run )` | 25 passed (25) | 471 passed (471) | 0 |
| 06 | `( cd server && ./node_modules/.bin/vitest run test/whitelist-subset.test.ts test/verb-gate.test.ts test/capsupported.test.ts test/ccdargv-brand.test.ts test/ccdargv-dec-parity.test.ts )` | 5 passed (5) | 167 passed (167) | 0 |
| 07 | `( cd server && ./node_modules/.bin/vitest run test/remote-runner.test.ts test/pr-timeout-budget.test.ts test/swap-timeout-budget.test.ts )` | 3 passed (3) | 32 passed (32) | 0 |
| 08 | `( cd server && ./node_modules/.bin/vitest run test/docs-source.test.ts test/docs-policy.test.ts test/docs-budget.test.ts )` | 3 passed (3) | 460 passed (460) | 0 |
| 09 | `( cd server && ./node_modules/.bin/vitest run test/lifecycle.test.ts test/ccd-archive.test.ts test/caps-token-shape.test.ts )` | 3 passed (3) | 147 passed (147) | 0 |
| 10 | `( cd server && ./node_modules/.bin/vitest run test/docs-shared.test.ts test/docs-parity.test.ts test/docs-url.test.ts )` | 3 passed (3) | 382 passed (382) | 0 |
| 11 | `( cd server && ./node_modules/.bin/vitest run -t 'every line citation is anchored' test/session-hook.test.ts )` | 1 passed (1) | 13 passed \| 322 skipped (335) | 0 |

### Invariants

From `w2-invariants.py` (W2's own commits: `git log --first-parent --no-merges <base>..HEAD`):

```text
base a17e14bc00c4, tip 64ebe8351560, 16 W2 commits
PASS scope          25 files touched by W2 commits; outside the scope: none; scope files untouched: none
PASS untouched      ccd/, shared/ (agent-protocol.ts and FLEET_PROTO included), pwa/src, server.ts, index.ts, README.md edited by W2: none
PASS docs-files     tracked ['server/src/docs/ccdsource.ts', 'server/src/docs/policy.ts', 'server/src/docs/ports.ts']; on disk ['server/src/docs/ccdsource.ts', 'server/src/docs/policy.ts', 'server/src/docs/ports.ts']
PASS exec-surface   EXEC_COMMANDS = ['tmux', 'ccd'] x1; UNGRANTABLE_VERBS = ['ws-rm', 'ws-gc'] x1
PASS fleet-proto    FLEET_PROTO = 1 x1; FLEET_PROTO_MIN = 1 x1
PASS cap-literal    'docs-v1' quoted under server/src: {'server/src/ccdargv.ts': 1}
PASS builder-calls  CCD_ARGV.docs under server/src: ['server/src/docs/ccdsource.ts']
FAIL sd-shape       single-definition.test.ts: 1 in-place want-line edit, 1 EOF append(s), other hunks: ['d6a1e264f @@ -4915,0 +4916,3 @@', '88178b5bf @@ -4846,0 +4847 @@', '88178b5bf @@ -4904,0 +4906,3 @@']
8 invariants, 7 PASS
```

### Mutation table

Every `W2-T<n>-M<k>` row of Tasks 1-8, extracted from this plan and run by `mutate.py` in a `git archive` copy of the tree at `64ebe8351560`, one row at a time, each file restored byte for byte after its row. `load` is a guard that throws at module load (Task 1, rows M2 and M3).

| Row | Task | File | Result | First red case (measured) |
|---|---|---|---|---|
| W2-T1-M1 | T1 | `agent/src/whitelist.ts` | red | test/whitelist-structural.test.ts > mechanism 1+2 — granting `gh` fails to COMPILE, wherever it is written > g17-docs-tree-without-project.ts |
| W2-T1-M2 | T1 | `agent/src/whitelist.ts` | load | Test Files 2 failed, no tests |
| W2-T1-M3 | T1 | `agent/src/whitelist.ts` | load | Test Files 2 failed, no tests |
| W2-T1-M4 | T1 | `agent/src/whitelist.ts` | red | test/whitelist-subset.test.ts > layer 2 — every argv the server can build passes the agent whitelist > docsIndex |
| W2-T1-M5 | T1 | `server/src/ccdargv.ts` | red | test/whitelist-subset.test.ts > layer 2c — exact argv, not just prefix compliance (mutation-sweep finding) > docsShowCommitted builds the exact argv, token for  |
| W2-T1-M6 | T1 | `server/src/ccdargv.ts` | red | test/whitelist-subset.test.ts > layer 2c — exact argv, not just prefix compliance (mutation-sweep finding) > docsTree builds the exact argv, token for token |
| W2-T1-M7 | T1 | `server/src/ccdargv.ts` | red | test/whitelist-subset.test.ts > layer 2c — exact argv, not just prefix compliance (mutation-sweep finding) > docsTree and docsFetch add their optional flag pair |
| W2-T1-M8 | T1 | `agent/src/whitelist.ts` | red | test/whitelist-structural.test.ts > mechanism 1+2 — granting `gh` fails to COMPILE, wherever it is written > g16-docs-index-without-all.ts |
| W2-T1-M9 | T1 | `agent/src/whitelist.ts` | red | test/whitelist.test.ts > whitelist.isExecAllowed > grants the four docs verbs ONLY with their flag, and admits every argv the spec table names |
| W2-T2-M1 | T2 | `server/src/docs/policy.ts` | red | test/docs-policy.test.ts > DOCS_FAILURE_HTTP (row 53, L1 half): every word has the status the spec gives it > 'ref-locked' answers 409 |
| W2-T2-M2 | T2 | `server/src/docs/policy.ts` | red | test/docs-policy.test.ts > refreshDue (M3.10, row 53 L1 half): section 2 (g) "Stale on open", exactly > a local ref with no stamp: due false |
| W2-T2-M3 | T2 | `server/src/docs/policy.ts` | red | test/docs-policy.test.ts > refreshDue (M3.10, row 53 L1 half): section 2 (g) "Stale on open", exactly > a last outcome of 'ok' attempted 600000 ms ago is due: t |
| W2-T2-M4 | T2 | `server/src/docs/policy.ts` | red | test/docs-policy.test.ts > refreshDue (M3.10, row 53 L1 half): section 2 (g) "Stale on open", exactly > a last outcome of 'ok' attempted 599999 ms ago is due: f |
| W2-T2-M5 | T2 | `server/src/docs/policy.ts` | red | test/docs-policy.test.ts > refreshDue (M3.10, row 53 L1 half): section 2 (g) "Stale on open", exactly > no origin remote, no stamp: due false |
| W2-T2-M6 | T2 | `server/src/docs/policy.ts` | red | test/docs-policy.test.ts > fetchBranchFor (M3.9): what a refresh fetches for the requested ref (section 3.4, section 2 (g) Flow) > a local ref is skipped, local |
| W2-T2-M7 | T2 | `server/src/docs/policy.ts` | red | test/docs-policy.test.ts > docsRetryAfterSeconds: the Retry-After header, or none (spec refinement (p)) > docs-busy with retryAfterMs 2000 answers 2 s, rounded  |
| W2-T2-M8 | T2 | `server/src/docs/fourth-home.ts` | red | test/single-definition.test.ts > the archive door's refusal codes are spelled once, in L0 (workspace lifecycle wave 2) > 'worktree-gone' is a code-line literal  |
| W2-T2-M9 | T2 | `server/src/docs/policy.ts` | red | test/docs-policy.test.ts > policy.ts is L1: pure, and imports shared/docs.ts alone (M7.10, this file's half) > has no node builtin, no require, no dynamic impor |
| W2-T2-M10 | T2 | `server/src/docs/policy.ts` | red | test/docs-policy.test.ts > the qualified prefixes are derived from L0, and docsRefTarget reads a ref spec (refinement (q)) > refuses a qualified spec in neither |
| W2-T2-M11 | T2 | `server/src/docs/policy.ts` | red | test/docs-policy.test.ts > docsRetryAfterSeconds: the Retry-After header, or none (spec refinement (p)) > docs-busy with retryAfterMs 2001 answers 3 s, rounded  |
| W2-T2-M12 | T2 | `server/src/docs/policy.ts` | red | test/docs-policy.test.ts > policy.ts is L1: pure, and imports shared/docs.ts alone (M7.10, this file's half) > has no clock and no timer |
| W2-T2-M13 | T2 | `server/src/docs/policy.ts` | red | test/docs-policy.test.ts > policy.ts is L1: pure, and imports shared/docs.ts alone (M7.10, this file's half) > has no fastify, no reply and no console: an L1 ve |
| W2-T2-M14 | T2 | `server/src/docs/policy.ts` | red | test/typecheck-tests.test.ts > every test file typechecks — the directory the gates could not see > server/test/ is clean under a tests-inclusive project |
| W2-T3-M1 | T3 | `server/src/docs/policy.ts` | red | test/docs-policy.test.ts > parseDocsApiQuery (M3.4, L1 half): a docs API query, parsed or refused before any exec > tree, a repeated ref |
| W2-T3-M2 | T3 | `server/src/docs/policy.ts` | red | test/docs-policy.test.ts > parseDocsApiQuery (M3.4, L1 half): a docs API query, parsed or refused before any exec > file, a complete committed pin plus branch:  |
| W2-T3-M3 | T3 | `server/src/docs/policy.ts` | red | test/docs-policy.test.ts > parseDocsApiQuery (M3.4, L1 half): a docs API query, parsed or refused before any exec > file, a bare servedRef (qualified only: it i |
| W2-T3-M4 | T3 | `server/src/docs/policy.ts` | red | test/docs-policy.test.ts > parseDocsApiQuery (M3.4, L1 half): a docs API query, parsed or refused before any exec > projects, an unknown key |
| W2-T3-M5 | T3 | `server/src/docs/policy.ts` | red | test/docs-policy.test.ts > docsProvenance: section 3.8's three clauses, in order (refinement (o)) > navigate with a same-origin site and the marker |
| W2-T3-M6 | T3 | `server/src/docs/policy.ts` | red | test/docs-policy.test.ts > parseDocsRefreshBody: exactly {ref, reason} (section 3.4, refinement (n)) > an empty array is bad-query body |
| W2-T3-M7 | T3 | `server/src/docs/policy.ts` | red | test/docs-policy.test.ts > parseDocsApiQuery (M3.4, L1 half): a docs API query, parsed or refused before any exec > precedence: pin-shape beats a bad value |
| W2-T3-M8 | T3 | `server/src/docs/policy.ts` | red | test/docs-policy.test.ts > docsProvenance: section 3.8's three clauses, in order (refinement (o)) > cors from a cross-site page, with the marker |
| W2-T3-M9 | T3 | `server/src/docs/policy.ts` | red | test/docs-policy.test.ts > docsProvenance: section 3.8's three clauses, in order (refinement (o)) > the marker 0 |
| W2-T3-M10 | T3 | `server/src/docs/policy.ts` | red | test/docs-policy.test.ts > docsProvenance: section 3.8's three clauses, in order (refinement (o)) > a long site is carried cut to 64 characters |
| W2-T3-M11 | T3 | `server/src/docs/policy.ts` | red | test/docs-policy.test.ts > parseDocsProjectParam: a :project failing the grammar is bad-project (section 3.4) > a leading dash is bad-project |
| W2-T3-M12 | T3 | `server/src/docs/policy.ts` | red | test/docs-policy.test.ts > parseDocsApiQuery (M3.4, L1 half): a docs API query, parsed or refused before any exec > precedence: the first unknown key in code-un |
| W2-T3-M13 | T3 | `server/src/docs/policy.ts` | red | test/docs-policy.test.ts > parseDocsApiQuery (M3.4, L1 half): a docs API query, parsed or refused before any exec > precedence: the first repeated key in the ro |
| W2-T3-M14 | T3 | `server/src/docs/policy.ts` | red | test/docs-policy.test.ts > parseDocsApiQuery (M3.4, L1 half): a docs API query, parsed or refused before any exec > file, a qualified draft branch (bare only) |
| W2-T3-M15 | T3 | `server/src/docs/policy.ts` | red | test/docs-policy.test.ts > parseDocsRefreshBody: exactly {ref, reason} (section 3.4, refinement (n)) > ref outside both grammars |
| W2-T3-M16 | T3 | `server/src/docs/policy.ts` | red | test/docs-policy.test.ts > parseDocsRefreshBody: exactly {ref, reason} (section 3.4, refinement (n)) > an extra key |
| W2-T3-M17 | T3 | `server/src/docs/policy.ts` | red | test/docs-policy.test.ts > parseDocsApiQuery (M3.4, L1 half): a docs API query, parsed or refused before any exec > precedence: committed, section before path |
| W2-T3-M18 | T3 | `server/src/docs/policy.ts` | red | test/docs-policy.test.ts > parseDocsApiQuery (M3.4, L1 half): a docs API query, parsed or refused before any exec > file, a committed pin missing path |
| W2-T3-M19 | T3 | `server/src/docs/policy.ts` | red | test/docs-policy.test.ts > parseDocsRefreshBody: exactly {ref, reason} (section 3.4, refinement (n)) > an empty object: ref is checked first |
| W2-T4-M1 | T4 | `server/src/docs/policy.ts` | red | test/docs-policy.test.ts > laneAdmit (M6.1): section 6.3's four clauses, in order > an idle lane admits one job over the byte budget and over the large threshol |
| W2-T4-M2 | T4 | `server/src/docs/policy.ts` | red | test/docs-policy.test.ts > laneAdmit (M6.1): section 6.3's four clauses, in order > execs at DOCS_LANE_EXECS refuse |
| W2-T4-M3 | T4 | `server/src/docs/policy.ts` | red | test/docs-policy.test.ts > laneAdmit (M6.1): section 6.3's four clauses, in order > bytes plus wire exactly at DOCS_LANE_BYTES admit |
| W2-T4-M4 | T4 | `server/src/docs/policy.ts` | red | test/docs-policy.test.ts > laneAdmit (M6.1): section 6.3's four clauses, in order > a large answer with no large one running admits |
| W2-T4-M5 | T4 | `server/src/docs/policy.ts` | red | test/docs-policy.test.ts > laneAdmit (M6.1): section 6.3's four clauses, in order > a second answer over 1 MiB refuses |
| W2-T4-M6 | T4 | `server/src/docs/policy.ts` | red | test/docs-policy.test.ts > laneAdmit (M6.1): section 6.3's four clauses, in order > an answer of exactly 1 MiB beside a large one admits (over, not at) |
| W2-T4-M7 | T4 | `server/src/docs/policy.ts` | red | test/docs-policy.test.ts > wire estimates read server facts only (M6.4, section 6.2) > showRawBound: a listed size lowers it |
| W2-T4-M8 | T4 | `server/src/docs/policy.ts` | red | test/docs-policy.test.ts > wire estimates read server facts only (M6.4, section 6.2) > showRawBound: a listed size of 0 is a fact, not an unknown |
| W2-T4-M9 | T4 | `server/src/docs/policy.ts` | red | test/docs-policy.test.ts > wire estimates read server facts only (M6.4, section 6.2) > showWire(1) = 65540: 4 * ceil(raw / 3) plus the 64 KiB envelope |
| W2-T4-M10 | T4 | `server/src/docs/policy.ts` | red | test/docs-policy.test.ts > wire estimates read server facts only (M6.4, section 6.2) > LISTING_JOB is the framed listing bound on both sides, and frozen: one sh |
| W2-T4-M11 | T4 | `server/src/docs/policy.ts` | red | test/docs-policy.test.ts > wire estimates read server facts only (M6.4, section 6.2) > reads the cap through DOCS_CLASS_CAP[cls]: the class caps are equal today |
| W2-T4-M12 | T4 | `server/src/docs/policy.ts` | red | test/docs-policy.test.ts > wire estimates read server facts only (M6.4, section 6.2) > docsShowPlan("a.png", 1000) |
| W2-T4-M13 | T4 | `server/src/docs/policy.ts` | red | test/docs-policy.test.ts > the read-lane constants (refinement (l), section 6.3) > each is its own integer literal, never an alias of a neighbour that holds the |
| W2-T4-M14 | T4 | `server/src/docs/policy.ts` | red | test/docs-policy.test.ts > cacheControlFor (section 6.6, section 5.2): immutable only for a committed pin's raster > a draft pin of class raster: no-store |
| W2-T4-M15 | T4 | `server/src/docs/policy.ts` | red | test/docs-policy.test.ts > cacheControlFor (section 6.6, section 5.2): immutable only for a committed pin's raster > a committed pin of class markdown: no-store |
| W2-T4-M16 | T4 | `server/src/docs/policy.ts` | red | test/docs-policy.test.ts > docsSendPolicy (section 5.3's onSend hook as an L1 verdict, refinement (m)) > a 404 failure is no-store even when immutable was set |
| W2-T4-M17 | T4 | `server/src/docs/policy.ts` | red | test/docs-policy.test.ts > docsSendPolicy (section 5.3's onSend hook as an L1 verdict, refinement (m)) > a 200 JSON answer with no cache-control gets no-store |
| W2-T4-M18 | T4 | `server/src/docs/policy.ts` | red | test/docs-policy.test.ts > docsSendPolicy (section 5.3's onSend hook as an L1 verdict, refinement (m)) > content type "text/html" is refused: 500 response-type- |
| W2-T4-M19 | T4 | `server/src/docs/policy.ts` | red | test/docs-policy.test.ts > docsSendPolicy (section 5.3's onSend hook as an L1 verdict, refinement (m)) > never writes into the L0 table, and answers a fresh hea |
| W2-T4-M20 | T4 | `server/src/docs/policy.ts` | red | test/docs-policy.test.ts > docsSendPolicy (section 5.3's onSend hook as an L1 verdict, refinement (m)) > a refused content type is carried cut to 80 characters, |
| W2-T4-M21 | T4 | `server/src/docs/policy.ts` | red | test/docs-policy.test.ts > docsSendPolicy (section 5.3's onSend hook as an L1 verdict, refinement (m)) > the JSON content type is the spec string, and an allowe |
| W2-T4-M22 | T4 | `server/src/docs/policy.ts` | red | test/docs-policy.test.ts > docsSendPolicy (section 5.3's onSend hook as an L1 verdict, refinement (m)) > content type "text/html" is refused: 500 response-type- |
| W2-T5-M1 | T5 | `server/src/remote/runner.ts` | red | test/docs-budget.test.ts > docs runner budgets outlast the helper (row 47, spec section 2 (a) Budgets) > the four CCD_VERB_TIMEOUT_MS rows are 20 000 / 20 000 / |
| W2-T5-M2 | T5 | `server/src/remote/runner.ts` | red | test/docs-budget.test.ts > docs runner budgets outlast the helper (row 47, spec section 2 (a) Budgets) > the four CCD_VERB_TIMEOUT_MS rows are 20 000 / 20 000 / |
| W2-T5-M3 | T5 | `server/src/remote/runner.ts` | red | test/remote-runner.test.ts > per-verb timeouts > sends ["docs-index","--all"] with a 20000 ms budget |
| W2-T5-M4 | T5 | `ccd/ccd` | red | test/docs-budget.test.ts > docs runner budgets outlast the helper (row 47, spec section 2 (a) Budgets) > docs-show: helper deadline + KILL_GRACE_S + 5 s < the r |
| W2-T5-M5 | T5 | `ccd/ccd` | red | test/docs-budget.test.ts > docs runner budgets outlast the helper (row 47, spec section 2 (a) Budgets) > docs-index: helper deadline + KILL_GRACE_S + 5 s < the  |
| W2-T5-M6 | T5 | `ccd/ccrc-doctor-checks` | red | test/docs-budget.test.ts > the doctor waits exactly as long as a Docs page (M7.4, the runner-budget clause) > CCRC_DOCTOR_DOCS_TIMEOUT's default equals CCD_VERB |
| W2-T5-M7 | T5 | `agent/src/server.ts` | red | test/docs-budget.test.ts > no answer ccd will send can be cut by an exec buffer (row 47, the cap chains) > both 8 * 1024 * 1024 literals are found at their anch |
| W2-T5-M8 | T5 | `server/src/exec.ts` | red | test/docs-budget.test.ts > no answer ccd will send can be cut by an exec buffer (row 47, the cap chains) > both 8 * 1024 * 1024 literals are found at their anch |
| W2-T5-M9 | T5 | `ccd/ccd` | red | test/docs-budget.test.ts > no answer ccd will send can be cut by an exec buffer (row 47, the cap chains) > parity: ccd's DOCS_MAX_FILE_BYTES and DOCS_MAX_ANSWER |
| W2-T5-M10 | T5 | `shared/docs.ts` | red | test/docs-budget.test.ts > no answer ccd will send can be cut by an exec buffer (row 47, the cap chains) > the ceiling chain: showWire(DOCS_MAX_FILE_BYTES) = 5  |
| W2-T5-M11 | T5 | `shared/docs.ts` | red | test/docs-budget.test.ts > no answer ccd will send can be cut by an exec buffer (row 47, the cap chains) > the listing chain: DOCS_MAX_LISTING_WIRE_BYTES < each |
| W2-T5-M12 | T5 | `server/src/docs/policy.ts` | red | test/docs-budget.test.ts > derived inequalities (M6.3, spec section 6.3) > the read queue holds one page's images plus the document and its tree: DOCS_LANE_QUEU |
| W2-T5-M13 | T5 | `server/src/docs/policy.ts` | red | test/docs-budget.test.ts > derived inequalities (M6.3, spec section 6.3) > any single show at a class cap fits the read lane alone: showWire(2 097 152) = 2 861  |
| W2-T5-M14 | T5 | `shared/docs.ts` | red | test/docs-budget.test.ts > derived inequalities (M6.3, spec section 6.3) > any single show at a class cap fits the read lane alone: showWire(2 097 152) = 2 861  |
| W2-T6-M1 | T6 | `server/src/docs/ccdsource.ts` | red | test/docs-source.test.ts > the cap gate, before any exec (row 45, M7.7, spec section 2 (a) and section 7.1) > index, no fleet state at all: caps-unknown with ze |
| W2-T6-M2 | T6 | `server/src/docs/ccdsource.ts` | red | test/docs-source.test.ts > the cap gate, before any exec (row 45, M7.7, spec section 2 (a) and section 7.1) > index, [] (the agent's failed boot read, seeded ?? |
| W2-T6-M3 | T6 | `server/src/docs/ccdsource.ts` | red | test/docs-source.test.ts > the cap gate, before any exec (row 45, M7.7, spec section 2 (a) and section 7.1) > fetch, no fleet state at all: caps-unknown with ze |
| W2-T6-M4 | T6 | `server/src/docs/ccdsource.ts` | red | test/docs-source.test.ts > the cap gate, before any exec (row 45, M7.7, spec section 2 (a) and section 7.1) > fetch, [] (the agent's failed boot read, seeded ?? |
| W2-T6-M5 | T6 | `server/src/docs/ccdsource.ts` | red | test/docs-source.test.ts > the cap gate, before any exec (row 45, M7.7, spec section 2 (a) and section 7.1) > index, the four verb names without docs-v1: unsupp |
| W2-T6-M6 | T6 | `server/src/docs/ccdsource.ts` | red | test/docs-source.test.ts > check 1: the transport catch, both halves unmeasured (row 46, R14) > the agent's own refusal word is not-granted, after exactly one e |
| W2-T6-M7 | T6 | `server/src/docs/ccdsource.ts` | red | test/docs-source.test.ts > checks 2-5: how ccd ended (row 46) > the runner deadline fired: ccd-timeout |
| W2-T6-M8 | T6 | `server/src/docs/ccdsource.ts` | red | test/docs-source.test.ts > check 1: the transport catch, both halves unmeasured (row 46, R14) > a NOT-ok answer with stdout and unmeasured halves is a cut answe |
| W2-T6-M9 | T6 | `server/src/docs/ccdsource.ts` | red | test/docs-source.test.ts > check 7 and the verbatim rebuild (row 46, refinement (j)) > a word outside the vocabulary is unknown-failure {word}, never mapped ont |
| W2-T6-M10 | T6 | `server/src/docs/ccdsource.ts` | red | test/docs-source.test.ts > check 7 and the verbatim rebuild (row 46, refinement (j)) > a ccd word keeps exactly its line, minus v, verb and elapsedMs |
| W2-T6-M11 | T6 | `server/src/lifecycle.ts` | red | test/docs-source.test.ts > check 1: the transport catch, both halves unmeasured (row 46, R14) > the agent's own refusal word is not-granted, after exactly one e |
| W2-T6-M12 | T6 | `server/src/docs/ccdsource.ts` | red | test/docs-source.test.ts > the cap gate, before any exec (row 45, M7.7, spec section 2 (a) and section 7.1) > index, ['caps'] (a measured pre-Docs ccd): unsuppo |
| W2-T6-M13 | T6 | `server/src/ccdargv.ts` | red | test/capsupported.test.ts > capSupported > spells the docs token exactly once in server/src, and reads it with the REFUSING default (docs W2) |
| W2-T6-M14 | T6 | `server/src/docs/ccdsource.ts` | red | test/docs-source.test.ts > check 1: the transport catch, both halves unmeasured (row 46, R14) > an OK answer whose halves are unmeasured (an older agent) is par |
| W2-T6-M15 | T6 | `server/src/docs/ccdsource.ts` | red | test/docs-source.test.ts > check 1: the transport catch, both halves unmeasured (row 46, R14) > a NOT-ok answer with stdout and unmeasured halves is a cut answe |
| W2-T6-M16 | T6 | `server/src/docs/ccdsource.ts` | red | test/docs-source.test.ts > checks 2-5: how ccd ended (row 46) > stderrHead is at most 512 bytes, cut back to a UTF-8 boundary |
| W2-T6-M17 | T6 | `server/src/docs/ccdsource.ts` | red | test/docs-source.test.ts > checks 2-5: how ccd ended (row 46) > stderr is redacted BEFORE it is cut, so a secret straddling the cut leaves no fragment |
| W2-T6-M18 | T6 | `server/src/docs/ccdsource.ts` | red | test/docs-source.test.ts > check 6: exactly one JSON line, with the envelope (row 46) > a blank second line: malformed-answer {why: parse} |
| W2-T6-M19 | T6 | `server/src/docs/ccdsource.ts` | red | test/docs-source.test.ts > check 6: exactly one JSON line, with the envelope (row 46) > JSON null: malformed-answer {why: schema} |
| W2-T6-M20 | T6 | `server/src/docs/ccdsource.ts` | red | test/docs-source.test.ts > check 6: exactly one JSON line, with the envelope (row 46) > v 2: malformed-answer {why: schema} |
| W2-T6-M21 | T6 | `server/src/docs/ccdsource.ts` | red | test/docs-source.test.ts > check 6: exactly one JSON line, with the envelope (row 46) > verb 'docs-show' answering a tree call: malformed-answer {why: schema} |
| W2-T6-M22 | T6 | `server/src/docs/ccdsource.ts` | red | test/docs-source.test.ts > check 6: exactly one JSON line, with the envelope (row 46) > ok 'yes' beside a ccd word: malformed-answer {why: schema} |
| W2-T6-M23 | T6 | `server/src/docs/ccdsource.ts` | red | test/docs-source.test.ts > check 6: exactly one JSON line, with the envelope (row 46) > ok:false without a failure word: malformed-answer {why: schema} |
| W2-T6-M24 | T6 | `server/src/docs/ccdsource.ts` | red | test/docs-source.test.ts > show: the answer and its decoded bytes (integrity, pins and size are Task 7's) > utf8 carrying b64 instead of text: malformed-answer  |
| W2-T6-M25 | T6 | `server/src/docs/ccdsource.ts` | red | test/docs-source.test.ts > show: the answer and its decoded bytes (integrity, pins and size are Task 7's) > base64 carrying text but no b64: malformed-answer {w |
| W2-T6-M26 | T6 | `server/src/docs/ccdsource.ts` | red | test/docs-source.test.ts > check 7 and the verbatim rebuild (row 46, refinement (j)) > a ccd word keeps exactly its line, minus v, verb and elapsedMs |
| W2-T6-M27 | T6 | `server/src/docs/ccdsource.ts` | red | test/docs-source.test.ts > check 7 and the verbatim rebuild (row 46, refinement (j)) > the word is redacted, then cut to 512 bytes: a 2 KiB word, and a secret s |
| W2-T7-M1 | T7 | `server/src/docs/ccdsource.ts` | red | test/docs-source.test.ts > check 8: show integrity, pins and onRef (row 46, spec section 2 (b)) > a tampered sha256: malformed-answer {why} |
| W2-T7-M2 | T7 | `server/src/docs/ccdsource.ts` | red | test/docs-source.test.ts > check 8: show integrity, pins and onRef (row 46, spec section 2 (b)) > a size one over the bytes: malformed-answer {why} |
| W2-T7-M3 | T7 | `server/src/docs/ccdsource.ts` | red | test/docs-source.test.ts > check 8: show integrity, pins and onRef (row 46, spec section 2 (b)) > base64 without its padding: malformed-answer {why} |
| W2-T7-M4 | T7 | `server/src/docs/ccdsource.ts` | red | test/docs-source.test.ts > check 8: show integrity, pins and onRef (row 46, spec section 2 (b)) > a committed blob is held to the listing's when the server hold |
| W2-T7-M5 | T7 | `server/src/docs/ccdsource.ts` | red | test/docs-source.test.ts > show: the answer and its decoded bytes (integrity, pins and size are Task 7's) > a committed utf8 answer carries the answer and the U |
| W2-T7-M6 | T7 | `server/src/docs/ccdsource.ts` | red | test/docs-source.test.ts > check 8: show integrity, pins and onRef (row 46, spec section 2 (b)) > a committed answer without onRef: malformed-answer {why} |
| W2-T7-M7 | T7 | `server/src/docs/ccdsource.ts` | red | test/docs-source.test.ts > check 8: show integrity, pins and onRef (row 46, spec section 2 (b)) > a draft branch that is not the pin: malformed-answer {why} |
| W2-T7-M8 | T7 | `server/src/docs/ccdsource.ts` | red | test/docs-source.test.ts > check 8: show integrity, pins and onRef (row 46, spec section 2 (b)) > a draft head that is not the pin: malformed-answer {why} |
| W2-T7-M9 | T7 | `server/src/docs/ccdsource.ts` | red | test/docs-source.test.ts > check 8: show integrity, pins and onRef (row 46, spec section 2 (b)) > a draft fp that is its sha256 but not the pin: malformed-answe |
| W2-T7-M10 | T7 | `server/src/docs/ccdsource.ts` | red | test/docs-source.test.ts > check 8: show integrity, pins and onRef (row 46, spec section 2 (b)) > a draft whose fp echoes its pin but is not its sha256: pin |
| W2-T7-M11 | T7 | `server/src/docs/ccdsource.ts` | red | test/docs-source.test.ts > check 8: show integrity, pins and onRef (row 46, spec section 2 (b)) > source 'draft' answering a committed pin: malformed-answer {wh |
| W2-T7-M12 | T7 | `server/src/docs/ccdsource.ts` | red | test/docs-source.test.ts > check 8: show integrity, pins and onRef (row 46, spec section 2 (b)) > a section that is not the pin: malformed-answer {why} |
| W2-T7-M13 | T7 | `server/src/docs/ccdsource.ts` | red | test/docs-source.test.ts > check 8: show integrity, pins and onRef (row 46, spec section 2 (b)) > a path that is not the pin: malformed-answer {why} |
| W2-T7-M14 | T7 | `server/src/docs/ccdsource.ts` | red | test/docs-source.test.ts > check 8: show integrity, pins and onRef (row 46, spec section 2 (b)) > a commit that is not the pin: malformed-answer {why} |
| W2-T7-M15 | T7 | `server/src/docs/ccdsource.ts` | red | test/docs-source.test.ts > check 9: the job's declared wire bound (row 46, M6.5, spec section 6.2) > a show answer of exactly ask.job.wire bytes passes; one byt |
| W2-T7-M16 | T7 | `server/src/docs/ccdsource.ts` | red | test/docs-source.test.ts > check 9: the job's declared wire bound (row 46, M6.5, spec section 6.2) > a ccd failure line one byte over the bound is oversize too; |
| W2-T7-M17 | T7 | `server/src/docs/ccdsource.ts` | red | test/docs-source.test.ts > check 9: the job's declared wire bound (row 46, M6.5, spec section 6.2) > a show answer of exactly ask.job.wire bytes passes; one byt |
| W2-T7-M18 | T7 | `server/src/docs/ccdsource.ts` | red | test/docs-source.test.ts > check 9: the job's declared wire bound (row 46, M6.5, spec section 6.2) > check 8 wins over check 9: a tampered sha256 one byte over  |
| W2-T7-M19 | T7 | `server/src/docs/ccdsource.ts` | red | test/docs-source.test.ts > check 9: the job's declared wire bound (row 46, M6.5, spec section 6.2) > check 7 wins over check 9: an unknown word over the bound s |
| W2-T7-M20 | T7 | `server/src/docs/ccdsource.ts` | red | test/docs-source.test.ts > check 9: the job's declared wire bound (row 46, M6.5, spec section 6.2) > a show answer of exactly ask.job.wire bytes passes; one byt |
| W2-T7-M21 | T7 | `server/src/docs/ccdsource.ts` | red | test/docs-source.test.ts > check 9: the job's declared wire bound (row 46, M6.5, spec section 6.2) > a show answer of exactly ask.job.wire bytes passes; one byt |
| W2-T7-M22 | T7 | `server/src/docs/ccdsource.ts` | red | test/docs-source.test.ts > check 7 and the verbatim rebuild (row 46, refinement (j)) > a ccd word keeps exactly its line, minus v, verb and elapsedMs |
| W2-T7-M23 | T7 | `server/src/docs/ccdsource.ts` | red | test/docs-source.test.ts > the second redaction pass: every string leaf of a failure body but failure (row 62, L3 half) > a planted unredacted ccd line, unresol |
| W2-T7-M24 | T7 | `server/src/docs/ccdsource.ts` | red | test/docs-source.test.ts > the second redaction pass: every string leaf of a failure body but failure (row 62, L3 half) > a planted unredacted ccd line, ambiguo |
| W2-T7-M25 | T7 | `server/src/docs/ccdsource.ts` | red | test/docs-source.test.ts > the second redaction pass: every string leaf of a failure body but failure (row 62, L3 half) > a planted unredacted ccd line, git-fai |
| W2-T7-M26 | T7 | `server/src/docs/ccdsource.ts` | red | test/docs-source.test.ts > the second redaction pass: every string leaf of a failure body but failure (row 62, L3 half) > a planted unredacted ccd line, git-fai |
| W2-T7-M27 | T7 | `server/src/docs/ccdsource.ts` | red | test/docs-source.test.ts > show: the answer and its decoded bytes (integrity, pins and size are Task 7's) > a committed utf8 answer carries the answer and the U |
| W2-T8-M1 | T8 | `server/test/single-definition.test.ts` | red | test/single-definition.test.ts > the docs ring — server/src/docs is classified by its imports (spec 2026-10-01 M7.10) > CONTROL: L1 (policy.ts) — fastify in eac |
| W2-T8-M2 | T8 | `server/test/single-definition.test.ts` | red | test/single-definition.test.ts > the docs ring — server/src/docs is classified by its imports (spec 2026-10-01 M7.10) > covers the directory — every floor file  |
| W2-T8-M3 | T8 | `server/test/single-definition.test.ts` | red | test/single-definition.test.ts > the docs ring — server/src/docs is classified by its imports (spec 2026-10-01 M7.10) > CONTROL: L2 (ports.ts) — a value import  |
| W2-T8-M4 | T8 | `server/src/docs/policy.ts` | red | test/single-definition.test.ts > the docs ring — server/src/docs is classified by its imports (spec 2026-10-01 M7.10) > the live tree: no file under server/src/ |
| W2-T8-M5 | T8 | `server/src/docs/ccdsource.ts` | red | test/single-definition.test.ts > docs W2 names are defined once (spec 2026-10-01 section 1, M7.10) > DOCS_LANE_QUEUE is declared exactly once, in server/src/doc |
| W2-T8-M6 | T8 | `server/test/single-definition.test.ts` | red | test/single-definition.test.ts > the docs ring — server/src/docs is classified by its imports (spec 2026-10-01 M7.10) > CONTROL: L3 (ccdsource.ts) — reply, a ti |
| W2-T8-M7 | T8 | `server/test/single-definition.test.ts` | red | test/single-definition.test.ts > the docs ring — server/src/docs is classified by its imports (spec 2026-10-01 M7.10) > CONTROL: L1 (policy.ts) — fastify in eac |
| W2-T8-M8 | T8 | `server/test/single-definition.test.ts` | red | test/single-definition.test.ts > the docs ring — server/src/docs is classified by its imports (spec 2026-10-01 M7.10) > CONTROL: an L4 file may import fastify a |
| W2-T8-M9 | T8 | `server/test/single-definition.test.ts` | red | test/single-definition.test.ts > the docs ring — server/src/docs is classified by its imports (spec 2026-10-01 M7.10) > CONTROL: L3 (ccdsource.ts) — reply, a ti |
| W2-T8-M10 | T8 | `server/test/single-definition.test.ts` | red | test/single-definition.test.ts > the docs ring — server/src/docs is classified by its imports (spec 2026-10-01 M7.10) > CONTROL: L1 (policy.ts) — fastify in eac |
| W2-T8-M11 | T8 | `server/test/single-definition.test.ts` | red | test/single-definition.test.ts > the docs ring — server/src/docs is classified by its imports (spec 2026-10-01 M7.10) > CONTROL: L1 (policy.ts) — fastify in eac |
| W2-T8-M12 | T8 | `server/test/single-definition.test.ts` | red | test/single-definition.test.ts > the docs ring — server/src/docs is classified by its imports (spec 2026-10-01 M7.10) > CONTROL: L2 (ports.ts) — a value import  |
| W2-T8-M13 | T8 | `server/src/docs/policy.ts` | red | test/single-definition.test.ts > docs W2 names are defined once (spec 2026-10-01 section 1, M7.10) > the qualified ref prefixes are quoted nowhere under server/ |
| W2-T8-M14 | T8 | `server/src/ccdargv.ts` | red | test/single-definition.test.ts > docs W2 names are defined once (spec 2026-10-01 section 1, M7.10) > the docs builders have one caller across the four roots: th |
| W2-T8-M15 | T8 | `server/test/single-definition.test.ts` | red | test/single-definition.test.ts > docs W2 names are defined once (spec 2026-10-01 section 1, M7.10) > CONTROL: exportedNames reads every exported declaration and |
| W2-T3-M20 | T3 | `server/src/docs/policy.ts` | red | test/docs-policy.test.ts > own keys only (the guard behind every parsed value) > a refresh body whose ref and reason are inherited has neither: ref is the first |
| W2-T6-M28 | T6 | `server/src/docs/ccdsource.ts` | red | test/docs-source.test.ts > check 1: the transport catch, both halves unmeasured (row 46, R14) > the cause is cut to 512 bytes (refinement (f): redacted and cut  |
| W2-T6-M29 | T6 | `server/src/docs/ccdsource.ts` | red | test/docs-source.test.ts > the cap gate, before any exec (row 45, M7.7, spec section 2 (a) and section 7.1) > fetch, ['caps'] (a measured pre-Docs ccd): unsuppo |
| W2-T6-M30 | T6 | `server/src/docs/ccdsource.ts` | red | test/docs-source.test.ts > check 1: the transport catch, both halves unmeasured (row 46, R14) > the client's own wait word is link-timeout |
| W2-T6-M31 | T6 | `server/src/docs/ccdsource.ts` | red | test/docs-source.test.ts > checks 2-5: how ccd ended (row 46) > not ok, empty stdout: ccd-fault {stderrHead}, and no code (CcdResult carries none) |
| W2-T6-M32 | T6 | `server/src/lifecycle.ts` | red | test/docs-source.test.ts > checks 2-5: how ccd ended (row 46) > the runner deadline fired: ccd-timeout |
| W2-T6-M33 | T6 | `server/src/docs/ccdsource.ts` | red | test/docs-source.test.ts > check 1: the transport catch, both halves unmeasured (row 46, R14) > an OK answer whose halves are unmeasured (an older agent) is par |
| W2-T8-M16 | T8 | `server/test/single-definition.test.ts` | red | test/single-definition.test.ts > the docs ring — server/src/docs is classified by its imports (spec 2026-10-01 M7.10) > CONTROL: L3 (ccdsource.ts) — reply, a ti |
| W2-FR-M1 | FR | `server/src/docs/ccdsource.ts` | red | test/docs-source.test.ts > the second redaction pass bounds its depth (final-review I1) > a known-word failure line nested 10 000 deep answers malformed-answer  |
| W2-FR-M2 | FR | `server/src/docs/ccdsource.ts` | red | test/docs-source.test.ts > check 7 and the verbatim rebuild (row 46, refinement (j)) > a ccd word keeps exactly its line, minus v, verb and elapsedMs |
| W2-FR-M3 | FR | `server/src/docs/ccdsource.ts` | red | test/docs-source.test.ts > check 8: show integrity, pins and onRef (row 46, spec section 2 (b)) > onRef 'toString' (inherited from Object.prototype): malformed- |
| W2-FR-M4 | FR | `server/src/docs/ccdsource.ts` | red | test/docs-source.test.ts > check 8: show integrity, pins and onRef (row 46, spec section 2 (b)) > a tampered sha256 and a wrong path echo at once: malformed-ans |
| W2-FR-M5 | FR | `server/test/single-definition.test.ts` | red | test/single-definition.test.ts > the docs ring — server/src/docs is classified by its imports (spec 2026-10-01 M7.10) > CONTROL: L2 (ports.ts) — a value import  |
| W2-FR-M6 | FR | `server/src/docs/ccdsource.ts` | red | test/docs-source.test.ts > check 7 and the verbatim rebuild (row 46, refinement (j)) > a show failure line unknown-commit (git 2.55) is carried verbatim, its wo |
| W2-FR2-M1 | FR2 | `server/src/docs/ccdsource.ts` | red | test/docs-source.test.ts > check 8: show integrity, pins and onRef (row 46, spec section 2 (b)) > onRef as an array holding a word is schema, not ok (the key is |
| W2-FR2-M3 | FR2 | `server/src/docs/ccdsource.ts` | red | test/docs-source.test.ts > refinement (g): killed and signal have one reader, ccdEnding > the docs files and lifecycle.ts read them nowhere else (a floor inside |

163 rows; 163 measured as expected.

### Notes

- Extra mutation rows W2-T3-M20, W2-T6-M28..M33, W2-T8-M16 and W2-FR-M1..M6 (14 rows) are not in the plan's JSON fences: they come from reviews (pre-flight/T3/T6/T8 task reviews and the whole-branch review), each measured red once by its implementer; they were appended to w2-rows.json in mutate.py's row shape and run in the same table (table count is 147 plan rows + 14 = 161).
- W2-T7-M22, M23, M24, M25: re-anchored to the shipped text; same mutation (the final-review fix wave rewrote redactLeaves into the depth-bounded walk(v, depth); each row's mutation is applied to the same arm: the array arm removed, the plain-object arm removed, the non-failure leaf walk replaced by the typeof-string redactDocsText, the walk applied to detail only).
- Coordinator ruling (mail 3847, 2026-10-07) on finding 3846, invariant sd-shape FAIL: not a red; record it as it stands. The invariant exists so that single-definition.test.ts changes by one in-place `want` line plus an EOF append and no line at or above the base's last line (4789) moves. The net diff against a17e14bc0 is exactly that, and suite 11 (citation census) is green. The checker judges each commit against its parent, so two review fixes that inserted lines inside W2's own appended block count as `other`. No history rewrite, no checker edit, no deviation number. Net hunk headers of `git diff -U0 a17e14bc0 HEAD -- server/test/single-definition.test.ts`: @@ -4188 +4188 @@; @@ -4788,0 +4789,266 @@.
- Fix-round rows W2-FR2-M1 and W2-FR2-M3 (2 rows) are not in the plan's JSON fences: they come from the coordinator's review 317 (fix round 1, mail 3945), exact strings in fr1/fix-report.md, each measured red once by its implementer; W2-FR2-M3 plants a line, so its old is the anchor `  const ending = ccdEnding(res);` and its new is the planted `  if (res.killed === true) return fail('ccd-timeout');` line plus the anchor. Table count is 147 plan rows + 14 + 2 = 163.
- W2-T7-M6, W2-FR-M3: re-anchored to the shipped text; same mutation (fix round 1 commit 52a884b01 rewrote the onRef guard in checkShow to `!(typeof ans.onRef === 'string' && Object.hasOwn(ON_REF_WORDS, ans.onRef))`; T7-M6 removes that whole line, FR-M3 replaces `Object.hasOwn(ON_REF_WORDS, ans.onRef)` with `(ans.onRef in ON_REF_WORDS)`).

### Carried, not fixed

- SEC-3: an externally killed helper orphans git's process group. W2's lever is Task 5's pinned budget invariant (helper deadline + 2 s grace + 5 s < the runner budget), so the agent never kills ccd in normal operation; the helper-side signal trap (a ccd change) and an agent-side group kill remain unscheduled.
- MT-2: ccd cuts stderr before it redacts it, so L3's second redaction pass cannot recover a secret the cut split; noted in `docs-source.test.ts`'s header.
- Contract F4: `branch: null` is detached OR unmeasured; the adapter carries it verbatim.
- D-4157 (from W1's ledger): `unwalked` is absent when 0; carried, never defaulted.
- D-4158 (from W1's ledger): `lockAgeMs` is a number, `null` or ABSENT; carried, never defaulted.
- D-4164 (from W1's ledger): `too-many-entries` is read by `count`, never by `bytes`.
- The partial-clone word pair (W1's CI-fix ruling, deferred to W2's adapter): a commit missing from a partial clone answers `git-failed {step:'cat-file'}` on git 2.43 and `unknown-commit` on git 2.55. L3 carries both words verbatim, because it never maps one known ccd word onto another (refinement (j)); one word for one condition is a ccd change, or W5's failure sentence.
