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
  `198.51.100.7` (fleet-ish), domain `mybox.example.com`, tailnet example
  `yourbox.tailnet-example.ts.net` is FORBIDDEN (matches the `*.ts.net` ban) — use
  `mybox.example.com` for rpId examples too.
- The deviation ledger continues from main's highest landed D-number (check
  `git grep -oE 'D-[0-9]+' origin/main | sort -t- -k2 -n | tail -1` before allocating).

---

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
    different PR — misresolution, not a dead link. Keep the `example-org` repo alive
    and private as the archive so the real ones stay readable, and say so in the checklist.
  - `example-org` becomes sweepable immediately (Task 8 step 3 no longer waits on a
    transfer): 8 files, plus `server/test/license.test.ts`'s own pin.

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
  > **Margin (2026-08-23, D-173).** Taken with one stated deviation: the owner is spelled
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
- [ ] **Step 2:** `notify.sh`: delete the `ADDR="${ADDR:-203.0.113.7:7788}"` line and
  its comment paragraph; add `[ -n "$ADDR" ] || exit 0` with the one-line comment
  `# no address configured — notify is best-effort, silence is the contract`. Green.
- [ ] **Step 3 (red):** `deploy.sh`: tests in `agent/test/deploy-verify.test.ts` that pin
  the default-box slice re-anchor to the refusal string. Then replace
  `BOX="${CCRC_BOX:-you@203.0.113.7}"` with an unset-check that `die`s with the
  message above; `CCRC_SSH_KEY` refusal likewise; `CCRC_SSH_PORT` default → `22`. Green.
- [ ] **Step 4 (red):** `ccclip`: read the three values from `~/.ccrc/ccclip.env` by the
  grep idiom (`grep -E '^BOX=' … | tail -n1 | cut -d= -f2-`), refuse with the message
  above when the file/keys are absent. Add a fixture-HOME test beside the existing ccclip
  suite (`server/test/ccd-ccclip.test.ts`) planting the env file. Green.
- [ ] **Step 5:** `config.ts:323` → `mailto:ccrc@localhost`; adjust its test pin.
  `ccrc-cli.test.ts:642`'s comment updates (the address it sets is now pure fixture —
  change the value to `203.0.113.7:7788`).
- [ ] **Step 6: Ratchet** — add to `FORBIDDEN` in `topology-clean.test.ts` the class
  `CGNAT tailnet IPs` `/\b100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}\b/`
  **scoped to non-doc files first** (`!path.startsWith('docs/')`) → red count states the
  remaining code/test occurrences; sweep them (fixtures → `100.64.0.1` is ALSO banned —
  use `203.0.113.x`); green. (Docs join the class in Task 8.)
- [ ] **Step 7: Commit** `feat(debrand): the shipped executables refuse rather than
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

- [ ] **Step 1 (red):** add ratchet class `*.ts.net + tailnet-example + server-box` scoped to
  `server/ agent/ pwa/ shared/ ccd/ deploy/ scripts/ install.sh` (docs in Task 8) → the
  red count IS the work-list.
- [ ] **Step 2:** sweep: error/example strings → `mybox.example.com`; `ccrc-adopt:350`'s
  `team·max` → `team·max`; `ccd/ccd` banner "server-box" → "the server box" (provenance
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
- [ ] **Step 2:** deploy.sh refusal + delete the migration JSON; `ccrc-install`/
  `ccrc-wrappers` suites green.
- [ ] **Step 3: Ratchet** — add class: the four real labels (`team·max`, `alt·max`,
  `team·shared`, `lab·dev0`) and `orchard` (scoped: non-docs) → sweep fixture/demo
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

- [ ] **Step 1 (red):** cli tests: `ccrc expose ip` writes exposure.env (mode ip, the
  box's address measured via the existing `hostname -I` first-global helper, else
  refuses naming the reason), regenerates the Caddyfile with `tls internal`, prints the
  3-step sudo ceremony PLUS the trust ceremony (the printed text names the CA root's
  path `/var/lib/caddy/.local/share/caddy/pki/authorities/local/root.crt`, `caddy
  trust` for this box, and the iOS/Android install steps in two lines each) and the
  passphrase-only sentence verbatim: `passkeys need a domain — on a bare IP the gate
  runs on passphrase login only`. Doctor tests: exposure PASSes mode ip; cert's
  untrusted-chain WARN names the trust ceremony as remedy.
- [ ] **Step 2:** implement the arm (reuse `_exp_*` helpers; refuse `ip` + `CCRC_AUTH`
  passkey-enrolled state? NO — enrolment simply stays hidden, the existing
  `enrolledRpIds` wire already handles absent rpId).
- [ ] **Step 3:** doctor arms; both suites green; runbook note + `runbook-holds` union
  updated if its pins touch step 11 text.
- [ ] **Step 4:** README exposure section becomes the three-mode decision table
  (duckdns: zero-cost name / byo: your domain / ip: no third party at all).
- [ ] **Step 5: Commit** `feat(expose): ip mode — HTTPS with nobody else involved
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

- [ ] **Step 1:** write `deploy/reference-fleet.md` from today's live values; add to
  `.gitignore`; `CLAUDE.md` two-box section rewrites to roles + the pointer sentence
  `real values: deploy/reference-fleet.md (gitignored)`. The 817-lines figure corrected
  after Task 9 lands.
- [ ] **Step 2 (red):** widen ALL ratchet classes to the full tree (drop the non-docs
  scopes from Tasks 3/4/5) → the red count is the corpus work-list, file by file:
  sanitise (role vocabulary above; transcripts keep shape, lose hostnames; D-N refs and
  plan anchors PRESERVED) or prune (scratch/ both files). Sweep to green in 3–5 commits
  grouped by directory so review stays possible.
- [ ] **Step 3:** base64 residue class joins the ratchet: username, `your-key-a`,
  `your-key-b`, `srv-volume`, `you`, (post-transfer) `example-org` —
  encoded, with the why-comment from the spec §3. Red → sweep the stragglers → green.
- [ ] **Step 4: Commit(s)** `docs(debrand): the corpus speaks roles (N/M) (D-<n>)`

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

- [ ] **Step 1:** `topology-clean` now carries every class unscoped; mutation-measure
  once more (plant one token of each of 3 classes → 3 reds; revert by edit).
- [ ] **Step 2:** all four packages' full suites FOREGROUND green; flakes re-run isolated.
- [ ] **Step 3:** whole-branch review (fresh reviewer pass over the complete diff; the
  deviations ledger `## Deviations found` below gets every D-N allocated).
- [ ] **Step 4:** PR `feat/stage5-oss-polish` → operator review → merge → deploy BOTH
  lanes (agent-first: ccd/ccrc + doctor + ccclip changed).

### Task 11: Flip support (operator-gated, no code)

The §9 checklist, prepared not executed: draft the repo-settings steps (fork-PR approval
policy, CodeRabbit note), stage the transfer+owner commit expectation, the re-scan
command line (re-run the 6-finder workflow + suite), and hand the operator the ordered
list. **No transfer, no flip, no tag happens from this session.**

## Deviations found

(allocated during the build; numbering continues from main's ledger)
