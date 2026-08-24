# Stage 5 — OSS polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The tree becomes owner-agnostic and box-agnostic, proven by a red-bar suite; a
DNS-free exposure mode ships; the README teaches an outside reader; the operator receives
a short flip checklist.

**Architecture:** Spec `docs/superpowers/specs/2026-08-22-stage5-oss-polish-design.md`
(§1–§10) under the recorded rulings (S1 Synapsium-Labs, S2 sanitise-verified-cleared,
S10 DNS-free). §1/S8 is largely discharged by PR #93 (parallel session) — Task 2 verifies
rather than implements. The `topology-clean` suite (Task 1) is the ratchet: each sweep
task ADDS its pattern class red-first, sweeps to green, and the class can never return.

**Tech Stack:** bash (`ccd/ccrc`, `deploy/*`), TypeScript ESM tests (vitest), Caddy
internal CA, vite PWA config.

## Global Constraints

- No new npm dependencies. `FLEET_PROTO` stays 1; all wire surfaces additive.
- Suites: `./node_modules/.bin/vitest run <file>` from inside the package, FOREGROUND,
  never bare `npx vitest`. Known load-flaky suites re-run in isolation.
- ccd/ccrc tests: fixture HOMEs only; `ghContainedEnv()` per test.
- Every guard ships with a mutation-measured red (count stated in the commit).
- `ccd/ccd` commits re-stamp provenance.
- Neutral replacement vocabulary (use EXACTLY these): server box role name
  `<server-host>`, fleet box `<fleet-host>`, user `you@<server-host>`, home `/home/you`,
  projects root `/srv/projects`, documentation IPs `203.0.113.7` (server-ish),
  `198.51.100.7` (fleet-ish), domain `mybox.example.com`. A made-up tailnet hostname
  is FORBIDDEN as an example (any `<label>.ts` + `.net` name matches the class ban) — use
  `mybox.example.com` for rpId examples too, and bracket forms for the shape.
- The deviation ledger continues from main's highest landed D-number (check
  `git grep -oE 'D-[0-9]+' origin/main | sort -t- -k2 -n | tail -1` before allocating).

---

## Ledger allocations for this stage

`origin/main`'s high-water at the time of writing is **D-188**. The Tasks 1/3/4 branch
(`feat/stage5-oss-polish`) allocated **D-189…D-195** before it was pushed; that block is
RESERVED even though it is not on `main` yet. This branch therefore starts at **D-196**.

Two collisions were found and fixed while doing it, both of the kind CLAUDE.md warns about
("check `origin/main` for landed D-numbers before allocating on a new branch"):

- **D-171 was landed twice**, by PRs merged twenty minutes apart on 2026-08-23 — ws-reap's
  "containment is no longer selected by `@{upstream}`" (#94, first) and this stage's
  unanchored gitignore globs (#93, second). The later one renumbers: the gitignore
  deviation is now **D-196**, at its three sites (`.gitignore`,
  `server/test/gitignore-secrets.test.ts`, `server/test/install-coordinator-skill.test.ts`).
- **D-172, D-173 and D-174 were re-used** by this branch while all three were already taken
  on `main` by the same ws-reap plan — D-174 is pinned live by
  `server/test/ccd-ws-audit.test.ts`. Renumbered to **D-197** (the roster-seed guard),
  **D-198** (the owner-spelled-twice margin note) and **D-199** (the notify address chain).

**Not fixed, and not this stage's to fix:** the ledger already carries older duplicate
DEFINITIONS — `D-128` is defined by both `2026-08-20-regset-atomic-write.md` and
`2026-08-20-stage3a-auth.md`, and a further ~11 numbers in the D-129…D-139 range are in the
same state, residue of stage3a's descending renumber. A scanner over
`^- \*\*D-N —` in the plans corpus would mechanise this, but it cannot ship green until
those are reconciled, and pinning them in an exceptions list would be the same
allowlist-shaped mistake this stage's Task 1 review already caught once. Recorded as
follow-up, deliberately not papered over.


## Operator rulings recorded during execution (2026-08-23)

- **R-A — the roster labels (§5/S4).** *Neutralise the shipped defaults; the live boxes
  keep their real labels.* `~/.ccrc/accounts.json` is user-owned and no deploy overwrites
  it, so the reference fleet's own UI is unaffected by the sweep — nothing has to be
  migrated, and no operator loses a label they read every day. Task 5 therefore renames
  only what SHIPS (fixtures, defaults, examples); it does not touch a live box.

- **R-B — the repository (§9 step 1).** *A FRESH repo under `Synapsium-Labs`, not a
  transfer.* A transfer carries `refs/pull/*` — 91 of them, pinned by GitHub forever and
  untouched by any history rewrite — into the public repo. A fresh remote does not, which
  is the whole point. History is pushed across intact; only the pull refs are left behind.
  Consequences to carry into Task 11:
  - No GitHub redirect from the old URL. Both boxes' `origin` re-point by hand, and every
    external link to the old repo dies rather than forwarding.
  - Commit messages contain 97 distinct `#NN` references and the docs corpus another 102.
    In the new repo those auto-link to whatever `#NN` eventually exists THERE, which is a
    different PR — misresolution, not a dead link. Keep the OLD repo alive
    and private as the archive so the real ones stay readable, and say so in the checklist.
  - The pre-transfer owner org becomes sweepable immediately (Task 8 step 3 no longer waits
    on a transfer): 8 files, plus `server/test/license.test.ts`'s own pin, which now holds it
    base64-encoded because a pin that forbids a token has to name it.

- **R-C — the copyright string** stays `Synapsium Labs` (spaced) in notices, with
  `Synapsium-Labs` (hyphenated) as the GitHub owner literal. Both are already shipped and
  pinned; this records that the pairing is deliberate, not a typo one of them.

## Deviations from the spec taken during execution

- **§5's "refuse without `CCRC_ACCOUNTS_JSON`" is NOT what shipped.** The spec called for
  removing the roster default; PR #96 landed the better cure first — keep a default but
  make it neutral (`deploy/accounts.default.json`, one upstream `claude`) so a fresh box
  still deploys without ceremony. A competing "no default, refuse" commit on
  `feat/stage5-flip-prep` was dropped in favour of it. What the drop leaves behind is
  pinned in `server/test/deploy-env-guard.test.ts`: the migration roster can never be the
  fallback again, the resolution line must exist at all, and — the part neither cure had —
  the default roster FILE is constrained to exactly one `claude`/`upstream` account,
  because a permanent seed's hazard now lives in that file's contents rather than in a
  shell default where a reviewer would see it change.


---

### Task 1: The `topology-clean` ratchet suite

**Files:**
- Create: `server/test/topology-clean.test.ts`

**Interfaces:**
- Produces: the file-walk helper (`git ls-files -z` from repo root, read each) and the
  `FORBIDDEN` table (`{name, pattern, why}[]`) later tasks append classes to.

- [ ] **Step 1: Write the suite with the ALREADY-CLEAN classes** (red only if the tree
  regressed): public IPv4 outside RFC 5737/loopback/RFC 1918/CGNAT-doc use — pattern
  `/\b(?!(?:10|127|192\.168|172\.(?:1[6-9]|2\d|3[01])|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])|203\.0\.113|198\.51\.100|192\.0\.2|0)\.)\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/`
  applied per-line with an exclusion for `package-lock.json` version strings (match only
  lines that do NOT contain `"version"` or `"resolved"`); a `session_01[A-Za-z0-9]{22}`
  shape that is not `session_01EXAMPLEEXAMPLEEXAMPLE00`; any `[a-z0-9-]+\.duckdns\.org`
  not in `{mybox,otherbox,fixture,subdomain,<sub>}`. Binary files skipped by extension
  (`.png,.ico,.woff2,.db`). The suite itself is excluded from its own scan by path.
- [ ] **Step 2: Run** `./node_modules/.bin/vitest run test/topology-clean.test.ts` —
  expect PASS (these classes were cleared 2026-08-22). If red, the tree regressed since
  the scan: fix the regression first, in its own commit.
- [ ] **Step 3: Mutation-measure the walker** — temporarily plant a routable public IPv4
  literal (not one of the RFC 5737 documentation ranges) in a new doc
  line, expect 1 red; revert (never `git checkout` a file with uncommitted work — revert
  by editing).
- [ ] **Step 4: Commit** `test(topology): the ratchet lands — public-IP, session-id and
  duckdns classes forbidden from day one`

### Task 2: Identity — verify #93, add what it left

**Files:**
- Verify (merged by #93): `LICENSE`, `server|agent|pwa/package.json` license fields,
  `install.sh` `CCRC_RELEASE_OWNER`, `server/test/license.test.ts`
- Modify: `README.md` (copyright notice line), `server/test/single-definition.test.ts`
- Create: `CONTRIBUTING.md`, `SECURITY.md`

**Interfaces:**
- Consumes: #93's `license.test.ts` pins.
- Produces: the owner literal's single-definition pin other tasks must not duplicate.

- [ ] **Step 1:** After #93 merges (rebase this branch onto it), verify: LICENSE is
  verbatim AGPL-3.0; the copyright notice `Copyright (C) 2026 Synapsium Labs` appears in
  README's licence section (add it if #93 left it out — its body argued notice-with-the-
  program); `CCRC_RELEASE_OWNER="Synapsium-Labs"`.
- [x] **Step 2:** Red-first: add to `single-definition.test.ts` the pin that the literal
  `Synapsium-Labs` (as an owner/org value) is DEFINED once in `install.sh` — a second
  definition elsewhere is red. Run; if #93 already added an equivalent pin, skip with a
  comment in the plan margin.
  > **Margin (2026-08-23, D-198).** Taken with one stated deviation: the owner is spelled
  > **twice**, not once, and the pin enforces *exactly two declarations and no third*.
  > `install.sh` is the `curl | bash` bootstrap — it runs on a box with no ccrc and can
  > source nothing — while `ccd/ccrc` is the installed tool that self-updates. Making
  > either read the other would put a runtime file dependency under a constant that
  > changes once in the project's life, and turn `ccrc update` into a refusal over a
  > missing string. The property "define once" exists to buy is that they cannot
  > disagree, and that is held three ways: `ccrc-update.test.ts` pins them equal,
  > `license.test.ts` pins the previous org absent from shipping code, and this new pin
  > forbids a third spelling in any bash file. Measured: a third spelling → 1 red; the
  > owner inlined at a use site → 1 red.
  >
  > Also found and fixed while doing it: `install.sh` was **outside** the bash corpus
  > `single-definition` scans (`bashRoots` was `ccd/` + `deploy/` only), so every
  > "spelled once" rule in that file had been blind to the one script a stranger runs
  > first. Adding it reds nothing that was passing — a strict improvement. Measured:
  > removing it again → 2 red.
- [ ] **Step 3:** `CONTRIBUTING.md` (one page: build/test commands per package, the
  mutation-table doctrine sentence, PR-only main) and `SECURITY.md` (private disclosure:
  the repo's Security tab / maintainer contact; no version matrix).
- [ ] **Step 4:** Commit `docs(oss): contributing, security, and the owner pinned once`

### Task 3: Shipped executables lose the reference fleet

**Files:**
- Modify: `deploy/deploy.sh:8-13` (BOX/key/port), `deploy/notify.sh:35-45` (third tier),
  `ccd/ccclip:10-12` (BOX/SSH_KEY/CCD), `server/src/config.ts:323` (mailto)
- Tests: `server/test/notify-addr.test.ts` (:22 comment, :124, :153),
  `server/test/ccrc-cli.test.ts:642`, `agent/test/deploy-verify.test.ts` (health-URL pins)

**Interfaces:**
- Produces: refusal messages other tasks quote verbatim in docs:
  `deploy.sh: set CCRC_BOX=user@host — this script deploys to the box YOU name`
  `ccclip: no ~/.ccrc/ccclip.env — set BOX=, SSH_KEY=, CCD= there; ccclip carries no default box`

- [ ] **Step 1 (red):** rewrite `notify-addr.test.ts`'s two legacy-tier tests to assert
  the NEW rule — no `CCRC_ADDR`, no `ccrc.env` → **no curl at all, exit 0** (best-effort
  contract); assert `curlCalls(home)` is empty. Run → red (the tier still fires).
- [ ] **Step 2:** `notify.sh`: delete the baked reference-fleet address fallback and
  its comment paragraph; add `[ -n "$ADDR" ] || exit 0` with the one-line comment
  `# no address configured — notify is best-effort, silence is the contract`. Green.
- [ ] **Step 3 (red):** `deploy.sh`: tests in `agent/test/deploy-verify.test.ts` that pin
  the default-box slice re-anchor to the refusal string. Then replace
  the baked `CCRC_BOX` default with an unset-check that `die`s with the
  message above; `CCRC_SSH_KEY` refusal likewise; `CCRC_SSH_PORT` default → `22`. Green.
- [ ] **Step 4 (red):** `ccclip`: read the three values from `~/.ccrc/ccclip.env` by the
  grep idiom (`grep -E '^BOX=' … | tail -n1 | cut -d= -f2-`), refuse with the message
  above when the file/keys are absent. Add a fixture-HOME test beside the existing ccclip
  suite (`server/test/ccd-ccclip.test.ts`) planting the env file. Green.
- [ ] **Step 5:** `config.ts:323` → `mailto:ccrc@localhost`; adjust its test pin.
  `ccrc-cli.test.ts:642`'s comment updates (the address it sets is now pure fixture —
  change the value to `203.0.113.7:7788`).
- [x] **Step 6: Ratchet** — add to `FORBIDDEN` in `topology-clean.test.ts` the class
  `CGNAT tailnet IP` `/\b100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}\b/`
  **scoped to non-doc files first** → red count states the
  remaining code/test occurrences (measured: 18 across 9 files); sweep them (fixtures →
  the range's own first address is ALSO banned — use `203.0.113.x`, except the one
  sanctioned CGNAT placeholder, D-193); green. Scope and placeholder drifts: D-193. (Docs join the class
  in Task 8.)
- [x] **Step 7: Commit** `feat(debrand): the shipped executables refuse rather than
  remember the reference fleet (D-<n>)`

### Task 4: Runtime strings and dead tooling

**Files:**
- Modify: `server/src/auth/webauthn.ts:281,294`, `server/src/auth/gate.ts` (tailnet
  example strings), `server/src/config.ts` (example strings), `ccd/ccrc-adopt:350`,
  `ccd/ccd` (banner strings; provenance re-stamp), `deploy/ccrc.env.example`,
  `deploy/ccrc-agent.env.example`
- Delete: `scripts/extraction-manifest.sh`, `server/test/extraction-manifest.test.ts`
- Tests: `server/test/auth-passkey.test.ts`, `auth-routes.test.ts`, `config.test.ts`
  (every pin quoting the old example strings re-pins to `mybox.example.com` forms)

- [x] **Step 1 (red):** add ratchet class `*.ts.net` + the reference fleet's two bare
  name tokens (the tailnet's DNS label, the server host's name) scoped to
  `server/ agent/ pwa/ shared/ ccd/ deploy/ scripts/ install.sh` (docs in Task 8) → the
  red count IS the work-list. (Measured 1 red test, 83 `file:line` rows across 12 files.
  The two bare name tokens ride base64-encoded per spec §3's residue idiom, and the
  liveness harness's synthetic corpus moved in-scope — D-195.)
- [x] **Step 2:** sweep: error/example strings → `mybox.example.com`; `ccrc-adopt:350`'s
  real first label → `team·max`; `ccd/ccd` banner's server-host name → "the server box" (provenance
  re-stamped in the same commit); both env examples' worked blocks → documentation
  addresses. Delete the two extraction-manifest files (its 4+11 tailnet mentions die with
  it; its migration completed at Stage 1).
- [ ] **Step 3:** re-pin the three auth/config suites; full `server` suite green.
- [ ] **Step 4: Commit** `feat(debrand): runtime strings speak example, not reference
  (D-<n>)`

### Task 5: Roster de-brand (S4)

**Files:**
- Delete: `deploy/accounts.migration.json`
- Modify: `deploy/deploy.sh:321-326` (`ACCOUNTS_JSON` default → refuse when unset AND the
  target box lacks `~/.ccrc/accounts.json`; message names both remedies),
  `server/test/helpers.ts:66` `DEFAULT_TEST_ROSTER` (5 entries rename: ids
  `claude, claude-a, claude-b, claude-c, claude-d`; labels keep ≥1 label≠id, e.g.
  `claude-b`'s label `team·b`; keep `homeAble` flags as today), ~28 follower test files
  (mechanical: the old id/label strings)
- Tests: `server/test/single-definition.test.ts` (roster-name scanner: verify its ≥2-names
  -incl-`claude` invariant still holds), `server/test/accounts-route.test.ts:151`

- [ ] **Step 1 (red):** rename in `helpers.ts` → run the server suite → the red list IS
  the follower list; sweep it file by file (no logic edits, string renames only).
  (Measured 21 red files / 131 red tests; the external account keeps the id `gpt` —
  the plan's `claude-c` — and green files keep their own old-id fixture strings: both
  D-196.)
- [x] **Step 2:** deploy.sh refusal + delete the migration JSON; `ccrc-install`/
  `ccrc-wrappers` suites green. (The no-default line gained its own deploy-verify pin,
  mutation-measured 1 red — D-196; four suites' migration-roster fixtures re-root on
  `DEFAULT_TEST_ROSTER`, and gen-accounts' D-69 pin retired with its subject.)
- [x] **Step 3: Ratchet** — add class: the four real account labels (now `team·max`,
  `team·alt`, `team·b`, `team·d` in fixtures) and the old employer token, all
  base64-ridden (scoped: non-docs) → sweep fixture/demo
  names in `fleetws.test.ts`, `registry.test.ts`, `pwa/design/mockup.html` → green.
- [ ] **Step 4: Commit** `feat(debrand): the roster is fixtures' own, not this fleet's
  (D-<n>)`

### Task 6: Service-worker denylist knob (S6)

**Files:**
- Modify: `pwa/vite.config.ts:52-57`
- Test: `pwa/test/sw-denylist.test.ts` (create)

- [ ] **Step 1 (red):** test: import the exported helper (refactor the literal at :57
  into `export function swDenylist(extra: string | undefined): RegExp[]` in
  `pwa/vite.config.ts` or a small `pwa/src/lib/sw-denylist.ts` consumed by it): default =
  `[/^\/api\//, /^\/ws\//]`; `swDenylist('/docs,/fleet')` appends
  `/^\/docs(\/|$)/, /^\/fleet(\/|$)/`. Run → red (helper absent).
- [ ] **Step 2:** implement; vite.config consumes `process.env.CCRC_SW_DENYLIST`. Green.
- [ ] **Step 3:** document the knob in `deploy/ccrc.env.example` under a "builder's
  knobs" comment and in deploy.sh's PWA build step (`CCRC_SW_DENYLIST="/docs,/fleet"` is
  the REFERENCE box's setting — it lives in the operator's gitignored env, not the tree).
- [ ] **Step 4: Commit** `feat(pwa): co-tenant paths become the builder's knob (D-<n>)`

### Task 7: `ccrc expose ip` (S10)

**Files:**
- Modify: `ccd/ccrc` (`cmd_expose` at :2322 — new `ip` arm beside `duckdns|byo`),
  `ccd/ccrc-doctor-checks` (`_check_exposure`, `_check_cert` WARN arm names the trust
  ceremony), `docs/superpowers/specs/2026-08-19-stage2-vm-gate-runbook.md` (step 11 gains
  the ip-mode note)
- Tests: `server/test/ccrc-cli.test.ts` (expose-verb block), `server/test/ccrc-doctor.test.ts`

**Interfaces:**
- Produces: `~/.ccrc/exposure.env` gains `CCRC_EXPOSE_MODE=ip` and `CCRC_EXPOSE_ADDR=<ip>`
  (existing keys untouched); Caddyfile block `https://<ip> { tls internal;
  reverse_proxy 127.0.0.1:<port> }`.

- [x] **Step 1 (red):** cli tests: `ccrc expose ip` writes exposure.env (mode ip, the
  box's address measured via the existing `hostname -I` first-global helper, else
  refuses naming the reason), regenerates the Caddyfile with `tls internal`, prints the
  3-step sudo ceremony PLUS the trust ceremony (the printed text names the CA root's
  path `/var/lib/caddy/.local/share/caddy/pki/authorities/local/root.crt`, `caddy
  trust` for this box, and the iOS/Android install steps in two lines each) and the
  passphrase-only sentence verbatim: `passkeys need a domain — on a bare IP the gate
  runs on passphrase login only`. Doctor tests: exposure PASSes mode ip; cert's
  untrusted-chain WARN names the trust ceremony as remedy.
  (Measured red: ccrc-expose 13, ccrc-cli 1, ccrc-doctor 4 — plus one deliberate
  already-green regression pin, ip-mode-still-FAILs-when-nothing-answers. The
  behaviour tests live in ccrc-expose.test.ts, cli keeps discoverability — D-199.)
- [x] **Step 2:** implement the arm (reuse `_exp_*` helpers; refuse `ip` + `CCRC_AUTH`
  passkey-enrolled state? NO — enrolment simply stays hidden, the existing
  `enrolledRpIds` wire already handles absent rpId).
  (`_dr_ip4_global` moved doctor-checks→ccrc to be reachable at expose time — D-199;
  the CA-root path became `CCRC_CADDY_ROOT_CA`, spelled once, printed by the verb and
  quoted by the cert remedy.)
- [x] **Step 3:** doctor arms; both suites green; runbook note + `runbook-holds` union
  updated if its pins touch step 11 text. (expose 58/58, cli 34/34, doctor 303/303;
  runbook gained 11g and its pins stand unchanged, 22/22 — no union edit needed. The
  cert WARN measures presence, not subject — D-199. `name` gained an ip-mode SKIP arm
  so the BYO skip's "a BYO domain" sentence never lies about a box with no domain.)
- [x] **Step 4:** README exposure section becomes the three-mode decision table
  (duckdns: zero-cost name / byo: your domain / ip: no third party at all).
- [x] **Step 5: Commit** `feat(expose): ip mode — HTTPS with nobody else involved
  (D-<n>)`

### Task 8: The docs corpus sweep + CLAUDE.md roles

**Files:**
- Delete: `scratch/2026-08-10-rollout-readiness-synthesis.md`,
  `scratch/swap-affinity-tests/test-target.sh` (the whole `scratch/` dir goes)
- Modify: ~35 files under `docs/superpowers/` (the 2026-08-22 scan's per-token lists in
  the workflow output are the work-list), `CLAUDE.md`, `.gitignore`
  (+`deploy/reference-fleet.md`)
- Create: `deploy/reference-fleet.md` (GITIGNORED — the real addresses/user/key names
  move here verbatim so operations lose nothing)

- [x] **Step 1:** write `deploy/reference-fleet.md` from today's live values; add to
  `.gitignore`; `CLAUDE.md` two-box section rewrites to roles + the pointer sentence
  `real values: deploy/reference-fleet.md (gitignored)`. The 817-lines figure corrected
  after Task 9 lands. (Shipped; `git check-ignore` verified before the sweep began.)
- [x] **Step 2 (red):** widen ALL ratchet classes to the full tree (drop the non-docs
  scopes from Tasks 3/4/5) → the red count is the corpus work-list, file by file:
  sanitise (role vocabulary above; transcripts keep shape, lose hostnames; D-N refs and
  plan anchors PRESERVED) or prune (scratch/ both files). Sweep to green in 3–5 commits
  grouped by directory so review stays possible. (Measured with Step 3's class in the
  same red: 4 red tests, 687 `file:line` rows across 74 files — not the plan's ~35;
  the widening commit lands LAST so every commit stays green — both D-205.)
- [x] **Step 3:** base64 residue class joins the ratchet: the operator's username, the
  two SSH key names, the Hetzner volume id, the GitHub handle and (post-transfer) the
  old owner org — all six ride encoded in the suite (`OPERATOR_RESIDUE`), with the
  why-comment from the spec §3. Red → sweep the stragglers → green. (272 of the 687
  rows were this class's, 19 of them in runtime files no earlier task's scope reached;
  the owner-org token joined NOW, not post-transfer — D-200. Mutation ceremony: its
  first token planted in README.md → 1 red; reverted by edit → 30/30.)
- [x] **Step 4: Commit(s)** `docs(debrand): the corpus speaks roles (N/M) (D-<n>)`
  (five commits: reference-fleet+CLAUDE.md, scratch prune, plans 417 rows,
  specs+research+README 246 rows, runtime stragglers + the widened suite.)

### Task 9: README restructure (S7)

**Files:**
- Modify: `README.md`, `CLAUDE.md:8` (line-count + "canonical overview" sentence)
- Tests: `server/test/readme-holds.test.ts` must stay green untouched
  (`### Workspace holds & programs` verbatim)

- [ ] **Step 1:** restructure: top = what-is-this paragraph, LICENSE line, install
  (release one-liner quoting `CCRC_RELEASE_OWNER`'s value via the documented override,
  doctor prereq list, expose decision table from Task 7, update/uninstall); middle =
  operating (fleet, coordination, holds section VERBATIM); bottom = internals reference.
  Reference-deployment specifics genericised (`:17` install URL, `:1194` IP curl, config
  enumerations).
- [ ] **Step 2:** `readme-holds` + `runbook-holds` + full server suite green.
- [ ] **Step 3: Commit** `docs(readme): an outside reader installs first, spelunks later
  (D-<n>)`

### Task 10: Final ratchet close + whole-branch review

- [x] **Step 1:** `topology-clean` now carries every class unscoped; mutation-measure
  once more (plant one token of each of 3 classes → 3 reds; revert by edit).
- [x] **Step 2:** all four packages' full suites FOREGROUND green; flakes re-run isolated.
- [x] **Step 3:** whole-branch review (fresh reviewer pass over the complete diff; the
  deviations ledger `## Deviations found` below gets every D-N allocated).
- [ ] **Step 4:** PR `feat/stage5-oss-polish` → operator review → merge → deploy BOTH
  lanes (agent-first: ccd/ccrc + doctor + ccclip changed).

### Task 11: Flip support (operator-gated, no code)

The §9 checklist, prepared not executed: draft the repo-settings steps (fork-PR approval
policy, CodeRabbit note), stage the transfer+owner commit expectation, the re-scan
command line (re-run the 6-finder workflow + suite), and hand the operator the ordered
list. **No transfer, no flip, no tag happens from this session.**

## Deviations found

> **Reconciliation note (2026-08-23).** This section was written on a branch that
> allocated **D-189…D-201** while `main` was concurrently taking **D-196…D-203** for
> the same stage — the third ledger collision of the day, and the reason the
> allocations section above now states the high-water mark explicitly. D-189…D-195
> stand as written: those commits are on `main`. The entries for that branch's Task 5
> and Task 6 are removed rather than renumbered — `main` carries a different cure for
> each, reached independently, and a ledger entry for a commit nobody merged is a
> record of nothing. Everything from Task 7 on is renumbered clear of `main`'s block,
> starting at **D-204**. `main`'s own block (D-196…D-203) is recorded above under
> "Ledger allocations for this stage" and, for the four that were not renumbers, as
> entries here.


(allocated during the build; numbering continues from main's ledger)

- **D-189** (Task 1): the duckdns placeholder set shipped as
  `{mybox, otherbox, fixture, subdomain, www}`, not the plan's
  `{mybox, otherbox, fixture, subdomain, <sub>}`. Three drifts between the plan's
  enumeration and the tree: (1) bracket placeholders (`<sub>`, `<name>`) can never match
  the class pattern — the `>` breaks adjacency with `.duckdns.org` — so listing `<sub>`
  was dead weight; (2) `www` had to join: `www.duckdns.org` is DuckDNS's own update
  endpoint, load-bearing in the shipped `deploy/systemd/ccrc-ddns.service` and pinned
  verbatim by `ccrc-expose.test.ts` and the stage3b plan; (3) two fixture hostnames the
  plan's set did not carry (`ccrc-fixture` ×7 in `deploy-env-guard.test.ts`, `newbox` ×1
  in `ccrc-doctor.test.ts`) were renamed to already-allowed placeholder names rather than
  widening the set. Also in this cluster: the plan's own Step 3 line spelled the
  mutation token `1.2.3` + `.4` joined — which would have been the shipped suite's one
  red — re-worded to spell it unmatchably, and "a new doc line" sharpened to "a TRACKED
  doc line" (the walk is `git ls-files`; an untracked file is invisible to it).
- **D-190** (Task 1): the session-id pattern shipped `session_01[A-Za-z0-9]{22,}` greedy
  plus an equality `allowed`, not this plan's Step 1 `session_01[A-Za-z0-9]{22}` exact.
  Forced: the committed EXAMPLE id carries 23 alnum after the prefix where a real id
  carries 22, so an exact-22 match would extract the EXAMPLE's own first 22 characters —
  a token that is NOT the whole example, fails the equality, and flags the tree's one
  sanctioned fixture as a leak. Greedy makes the example match whole so the equality can
  admit it; anything id-shaped and unsanctioned still scores. Same plan-vs-tree drift
  class as D-189; rationale lives in the suite at `EXAMPLE_SESSION_ID`'s docstring.
- **D-191** (Task 2): the owner pin shipped as "exactly TWO named assignments"
  (`install.sh`, `ccd/ccrc`), not this plan's Step 2 "DEFINED once in `install.sh`".
  Forced: #93 landed the pair deliberately (D-92's cross-file class, argued in
  `ccd/ccrc`'s release-source header — `install.sh --release` runs before any ccrc
  exists on the box, and `ccrc update` runs on boxes install.sh has long left), with
  the two held equal by `ccrc-update.test.ts` and both VALUES pinned by
  `license.test.ts`. A literal once-in-install.sh pin would red forever against that
  shipped design. Step 2's skip clause ("if #93 already added an equivalent pin") was
  weighed and does NOT apply: #93 pins value and agreement but nothing pins the COUNT
  — so the new `single-definition.test.ts` describe closes exactly that gap (no third
  assignment in bash, no spelling in the four TS roots, none in the workflows; the
  hunted literal is READ from install.sh's definition, never restated in the scanner).
- **D-192** (Task 2, review must-fix): SECURITY.md's fallback disclosure path shipped as
  an issue-based private-channel handshake ("open an issue asking for a channel, no
  details"), not this plan's Step 3 "maintainer contact". Forced: the shipped fallback
  ("commit-author address on any recent commit", `git log -1 --format='%ae'`) resolves
  to a GitHub noreply address that cannot receive mail — all 40 most-recent commits are
  authored under it — and the only real addresses deeper in history are the OLD employer
  identity Stage 5 exists to retire and a personal address never sanctioned for the repo.
  No committable monitored mailbox exists in-tree, so the email half of the private path
  was non-functional as written; the handshake keeps disclosure private without minting
  an address the operator has not chosen. If the operator later publishes a monitored
  security address, it slots into that sentence.
- **D-193** (Task 3): the CGNAT ratchet class shipped with a wider doc-scope exclusion
  and one admitted placeholder, both forced. (1) Scope: the plan's Step 6 predicate
  `!path.startsWith('docs/')` alone would have pulled `README.md`, `CLAUDE.md` and
  `scratch/` into THIS task's sweep — they sit outside `docs/` but their sweep is owned
  by Tasks 8–9, and Task 8's ordering is load-bearing: `deploy/reference-fleet.md` must
  exist BEFORE `CLAUDE.md` loses the real reach values, and `scratch/` is pruned whole
  rather than sanitised. The shipped scope excludes all four roots and Task 8 still
  drops it entirely. (2) Vocabulary: the plan's sweep rule ("fixtures → `203.0.113.x`;
  the range's first address is ALSO banned") cannot apply to `ccrc-doctor.test.ts`'s CGNAT-arm test —
  that test exists to pin `_dr_ip4_global`'s classification of the 100.64/10 range, so
  its fixture must BE in the range. The class admits exactly one obviously-synthetic
  placeholder, `100.100.1.1` (argued in the suite next to the pattern); it also serves
  as `auth-passkey.test.ts`'s CGNAT-shaped rpId-refusal fixture, preserving that list's
  range coverage.
- **D-194** (Task 3): two counting drifts between the plan and the tree. (1)
  `notify-addr.test.ts` carried THREE legacy-IP pins, not the plan's "two legacy-tier
  tests": alongside the two the plan names (:124, :153), the unreadable-ccrc.env test
  (:166) also asserted the baked address. All three re-pinned to the silence contract
  (no curl, exit 0). (2) Step 5's "adjust its test pin" for `config.ts`'s
  `vapidSubject` found NO existing pin — nothing in `config.test.ts` asserted the
  default — so one was added red-first rather than adjusted, closing the gap the plan
  assumed shut. Also under this number: the mailto anchor itself drifted `:323`→`:333`
  (content matched; trusted the file per the plan's global rule).
- **D-195** (Task 4): four drifts between the plan and the shipped sweep. (1) The plan's
  replacement for `ccd/ccd`'s banner strings — "the server box" — named the wrong role:
  ccd runs on the FLEET host (CLAUDE.md's two-box topology), so line 3 now says "the
  fleet box" and the `cmd_menu` banner names the tool ("── ccd sessions ──") rather than
  any box. (2) The class's two bare name tokens ride base64-encoded in the suite (spec
  §3's residue idiom) instead of spelled: the suite is path-excluded from its own scan,
  but a verbatim spelling would still publish the very strings it hunts; the tailnet-DNS
  shape stays a plain pattern. (3) The liveness harness's synthetic corpus file moved
  from the repo root into `server/` — this class is the ratchet's first
  INCLUSION-scoped one, and a root-level synthetic path sat outside its scope, turning
  the class's own scan-liveness row red against a healthy pattern; sited in-scope for
  every class, the row means the same thing for all of them. (4)
  `single-definition.test.ts` was not in the plan's Task 4 file list but carried seven
  work-list rows: comments plus two dead `NAMES_CCD` alternatives matching the
  pre-extraction directory's path spellings (that directory name embeds the old box's
  name). The dead alternatives are deleted — the directory has not existed since the
  Stage-1 extraction and the ratchet now forbids its name outright, so the protection
  they gave is the ratchet's own — while the guard's two live alternatives (the
  post-move path, the adjacent-args form) are untouched and still pinned by its
  "exactly one file" test. Also under this number: `ccrc-adopt`'s example-label anchor
  drifted `:350`→`:457` (content matched; trusted the file per the global rule).
- **D-205** (Task 8): four drifts in the corpus sweep. (1) Scale: the plan's "~35 files
  under docs/superpowers/" measured 687 red rows across 74 files tree-wide — 64 docs
  files plus README.md, CLAUDE.md, scratch/ and 11 RUNTIME files; the runtime rows are
  all the new residue class's (Tasks 3–5's scopes only ever gated the tailnet, roster
  and CGNAT classes, and no class banned the username/key/volume/handle tokens until
  this task, so `/home/<user>` clip fixtures, the volume-path whitelist fixtures and the
  handle's PR-facts fixture had nothing to go red against). (2) Ordering: Steps 2–3's
  red was measured once, against the working tree with the widened+extended suite
  UNCOMMITTED, and the suite change lands in the LAST commit after the directory-grouped
  sweeps — the plan's "widen → red → sweep in 3–5 commits" read literally would commit a
  red ratchet bar mid-sequence, breaking bisect; red-first is a measurement discipline,
  not a committed state. (3) The owner-org token joined the residue class NOW, not
  "(post-transfer)": #93 already flipped `CCRC_RELEASE_OWNER`, the sweep left zero
  in-tree spellings, and the gate was illusory anyway — dropping Task 5's class scope in
  this same task already made the org's lowercase substring red corpus-wide, so
  deferring the token would have banned nothing extra; a transfer-window reintroduction
  is exactly what the class exists to catch. (4) Vocabulary the plan did not enumerate:
  the three stage-5 docs (this plan, the spec, the decision brief) are hand-rewritten
  rather than substituted — their sentences NAME the banned tokens as subject matter, so
  they now say the tokens' roles; the old monorepo's project spellings become
  `acme-platform-ts` (spec §1's neutral-name class) and the clip-fixture dirs
  `claude2-demo-app-ts`; the employer-email transcript author becomes
  `you@example.com`; the old monorepo name itself is deliberately NOT in the residue
  class (argued in the suite at the class comment: it names a repository, not a
  reachable box, and carries hundreds of load-bearing historical anchors).
- **D-200** (Task 3, `ccd/ccclip`): the env reader tolerates leading whitespace on the key
  and strips surrounding quotes, and "file absent" is a DIFFERENT refusal from "file
  present, key unreadable". Measured by running the reader: `BOX="you@host"` parsed with
  the quotes into an ssh destination, a trailing space stayed in a key path, and an
  indented key produced `ccclip: no ~/.ccrc/ccclip.env` at a file that existed with all
  three keys — absent and malformed collapsed into one sentence, on the one path whose
  stderr nobody reads (a Hammerspoon hotkey). Whitespace is trimmed at the ends only, not
  `tr -d '[:space:]'` like every other `~/.ccrc` reader, because this one reads a
  filesystem path and a Mac has paths with spaces.
- **D-201** (Task 1, superseding D-190's run length): the session-id class matches
  `session_01[A-Za-z0-9]{10,}`, not `{22,}`. A TRUNCATED id — half pasted out of a log or
  an error message — still names the account it came from. D-190's greedy-plus-equality
  shape, which is what keeps the committed example green, is unchanged.
- **D-202** (Task 5): the wrapper IDS are NOT renamed, only the labels and the employer
  name. `claude2`/`claude-corp`/`claude-dev0` name a Claude wrapper rather than a person
  or a company, they are 1,867 occurrences outside docs, and the fixtures mirror the ids
  the live boxes really use — which is what makes them catch shape bugs. Also forced:
  `deploy/accounts.migration.json` MOVES to `server/test/fixtures/roster-five.json`
  rather than being deleted, because six suites use it as the only committed roster with
  a generated exec, a secretsFile, a non-`homeAble` account and a label differing from
  its id. `deploy/` should ship what an installer needs, and nothing installs five
  accounts.
  > **Addendum (2026-08-24, post-flip follow-up, operator-instructed).** The SERVER
  > fixtures are now id-decoupled after all: `DEFAULT_TEST_ROSTER` in
  > `server/test/helpers.ts` speaks `claude`/`claude-a`/`claude-b`/`claude-d` (labels
  > self-named except `claude-b`'s `team·b`, the one label≠id discriminator; `gpt`
  > keeps its literal id — ccd's Codex overflow lane is keyed on it), and
  > `roster-five.json` is deleted: the in-memory roster carries every shape it
  > existed for (generated exec, secretsFile, non-`homeAble`, label≠id). The PWA
  > fixtures keep the transcribed wrapper ids deliberately — renaming them is a
  > branch-wide refactor through hue tokens and non-fixture tests for no leak-surface
  > gain (the ids name wrappers, not people) — but their labels speak `team·…`. This
  > is the parallel branch's Task 5, reviewed there, ported onto main's tree.
- **D-203** (Task 6): `CCRC_SW_DENYLIST` is read from `process.env` and EXPORTED by
  deploy.sh out of `~/.ccrc/deploy.env`, rather than read from a file at build time. The
  PWA is built on the deploying workstation and `deploy.env` is `.`-sourced, so a key set
  there is a shell variable and `npm run build` is a child process that sees only
  exported ones. The export is what makes the knob reach the build at all; a
  file-reading variant on a parallel branch had to be fixed for a relative-path miss
  inside `(cd pwa && …)`, a hazard this shape does not have.
- **D-204** (Task 7): three forced drifts in the ip arm. (1) The verb-behaviour tests
  live in `server/test/ccrc-expose.test.ts`, not the plan's `ccrc-cli.test.ts`: both
  files pin the split in their own headers (cli owns DISCOVERABILITY — the usage line,
  which did gain the `ip (no domain at all` pin — and ccrc-expose owns what the verb
  DOES), and a plan file-list entry does not outrank the tree's standing ownership.
  (2) The plan's "existing `hostname -I` first-global helper" (`_dr_ip4_global`) lived
  in `ccrc-doctor-checks`, which `cmd_expose` never sources — the function MOVED to
  `ccd/ccrc` (definition unchanged, still single-spelled; the checks table's standing
  sourced-by-ccrc premise covers it, same as `_box_env_value`), with a pointer comment
  left at its old home. (3) The spec §7 sentence "checking the certificate's presence
  and subject": subject is NOT measured — caddy's internal leaf carries an EMPTY
  subject (the address rides the SANs), so a subject pin would red exactly the box the
  arm exists for; presence (a completed handshake + a parseable x509) is the
  measurement, and the WARN text says whose CA it is from the mode, which is the fact
  the file itself records.
- **D-206** (whole-branch review must-fix 1): the `tailnet name` and `duckdns subdomain`
  classes carry the `i` flag the plan's pattern drafts lacked. DNS is case-blind, so a
  capitalised residue token or an upper-cased name locates the same real box, and the
  roster/operator residue classes already banned every casing — the two name classes
  landing case-sensitive admitted everything but lowercase. Measured green-safe (zero
  case variants in today's tree; the bracket and bare-suffix `passes` vocabulary is
  untouched by the flag), and each class gains a case-variant liveness fixture. The
  duckdns `allowed` vocabulary stays exact-lowercase deliberately: docs speak the
  canonical placeholder spelling, so a case-variant placeholder is flagged drift.
- **D-207** (whole-branch review must-fix 2): the ratchet scans tracked PATHS as well as
  contents — every `git ls-files` path fed through the same classes as its own one-line
  pseudo-file (`PATH_CORPUS`), because a tracked file NAMED after a forbidden token with
  clean contents evaded the contents-only walk, and the name ships in every clone as
  loudly as the bytes. The path corpus takes NO exclusion: the content walk's two
  escapes (`SELF`, binary extensions) are byte-arguments, so even this suite's own path
  is name-scanned, pinned by a corpus row. Measured green-safe against today's
  `git ls-files`. Ceremony for both (2026-08-23): a case-variant of each name class
  planted in README.md plus a tracked file named after the tailnet residue → pre-fix
  suite 30/30 GREEN (both blindnesses demonstrated), fixed suite exactly 3 reds (one
  per probe), 38/38 on revert. Under the same review: README's expose section said
  "symlink or copy" the Caddyfile, contradicting D-165's copy-only ruling the verb and
  three suites already pin — it now says copy, with the symlink named as the defect;
  and the gitignored operator continuity file regains the two rows the sweep orphaned
  (the Mac-side clip env triple, and the fleet host's server-address env for swap
  notices, absent per the old D-73 measurement — a tree with no baked fallback sends
  nothing until that file exists).
