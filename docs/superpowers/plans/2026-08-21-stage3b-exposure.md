# Stage 3b — exposure (name, cert, proxy) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A box gets a public name and a real certificate through `ccrc expose` (DuckDNS or BYO
domain), with installer-managed-but-operator-armed Caddy terminating TLS in front of a
loopback-confined server — everything dark until the operator runs the verb and the sudo
ceremony, exactly as 3a's gate stayed dark until armed.

**Architecture:** Spec `docs/superpowers/specs/2026-08-21-stage3b-exposure-design.md` (D1–D8) —
read it before any task. Stock Caddy + standard ACME challenges (D1); the no-sudo degraded-step
ceremony (D2); exposure config in its own `~/.ccrc/exposure.env` fed to the server unit by a
second `EnvironmentFile` line (D3); a user-timer DuckDNS updater (D4); trustProxy settled as
none (D5); four doctor checks with D-150 arms (D6); the rename choreography's false sentence
fixed with one additive `enrolledRpIds` wire field (D7). D8's `CCRC_HOST` guard already shipped
separately (PR #77).

**Tech Stack:** bash (`ccd/ccrc`, `ccd/ccrc-doctor-checks`), TypeScript ESM (server, pwa),
systemd user units, Caddy as a system package (never a node dependency).

## Global Constraints

- **No new npm dependencies in any `package.json`.** Caddy is a distro package the operator
  installs; ccrc only writes its config.
- **`FLEET_PROTO` stays 1.** `enrolledRpIds` (Task 5) is additive with one producer and one
  reader; an older server omitting it must read as "unknown", never as "no passkeys".
- Suites run from inside each package as `./node_modules/.bin/vitest run <file>` — NEVER bare
  `npx vitest`. Foreground. Full-suite gates at each commit named below.
- TDD red-first; every guard mutation-measured with the before/after counts recorded in this
  plan's `## Deviations found` ledger (D-N numbering continues from D-138).
- Bash single-definition: every new path/name constant (`CCRC_EXPOSURE_FILE`, the Caddyfile
  path, the ddns unit names) is spelled ONCE per corpus and pinned in
  `server/test/single-definition.test.ts` following the `CCRC_RC_FILE` worked example
  (`:850-925`).
- No value read from `ccrc.env`/`exposure.env` is ever printed by doctor or the verb — SET/NOT
  SET only (the `_check_config` rule). The DuckDNS token is a secret.
- **D-149 sweep:** any task that touches the server's `EXEMPT` table or adds a gated route
  re-reads the out-of-package consumers (`ccd/ccrc`, `ccd/ccrc-doctor-checks`,
  `ccd/coordinator-skill/`, `ccd/worker-skill/`, `deploy/*.sh`) and says in its commit message
  which it checked. (Task 5 adds no route and widens one exempt GET's body — the sweep still
  runs.)
- `ccd/ccd` is NOT touched by this plan; no provenance re-stamp arises. If a task finds it must
  touch `ccd/ccd`, stop and record a deviation first.
- The live reference box's exposure (its `CCRC_HOST=203.0.113.7` + tailscale serve) is
  operator ceremony — nothing in this plan changes it (spec D8.2).

## File structure

- `ccd/ccrc` — `CCRC_EXPOSURE_FILE`/`CCRC_CADDYFILE` constants beside `BOX_ENV_FILE`;
  `cmd_expose` + `_exp_*` step functions; usage table + dispatch rows.
- `ccd/ccrc-doctor-checks` — four new `_check_*` + four array entries.
- `deploy/ccrc.service` — one added `EnvironmentFile` line (REGENERATE class, ships via
  `_inst_units`/deploy alike).
- `deploy/systemd/ccrc-ddns.service` + `ccrc-ddns.timer` — new templates, installed by
  `cmd_expose` (duckdns arm only), NOT by `_inst_units`.
- `shared/api.ts` — `AuthStatus.enrolledRpIds?: string[]`.
- `server/src/auth/credentials.ts` — `enrolledRpIds()` reader; `server/src/server.ts` — status
  route emits it.
- `pwa/src/lib/auth.ts` / `pwa/src/screens/LoginScreen.tsx` — the rename sentence.
- `server/src/config.ts:74-80` — D5 settlement text; `server/test/auth-gate.test.ts` or a new
  small test — the no-trustProxy pin.
- `docs/superpowers/specs/2026-08-19-stage2-vm-gate-runbook.md` — step 11 + step-10 bullet
  rewrite; `deploy/ccrc.env.example`, `README.md` — exposure documentation.
- Tests: `server/test/ccrc-expose.test.ts` (new), `server/test/ccrc-doctor.test.ts` (extend),
  `server/test/single-definition.test.ts` (extend), `server/test/auth-routes.test.ts` (extend),
  `pwa/test/auth-login.test.tsx` (extend), `server/test/runbook-holds.test.ts` (extend).

---

### Task 1: The exposure seam — file constant, unit line, converge

**Files:**
- Modify: `ccd/ccrc` (beside `BOX_ENV_FILE`, ~:91-101), `deploy/ccrc.service:12` area
- Test: `server/test/single-definition.test.ts`, `server/test/ccrc-install.test.ts`

**Interfaces:**
- Produces: `CCRC_EXPOSURE_FILE="$HOME/.ccrc/exposure.env"` (bash, declared once, exported the
  way `BOX_ENV_FILE` is); the server unit reads
  `EnvironmentFile=-%h/.ccrc/exposure.env` AFTER the `ccrc.env` line (later file wins for a
  key present in both — systemd semantics; the leading `-` keeps a box without exposure
  booting).

- [x] **Step 1: RED** — extend `single-definition.test.ts`'s bash corpus with a
  `CCRC_EXPOSURE_FILE` pin copied structurally from the `CCRC_RC_FILE` block (`:850-925`):
  declared exactly once in `ccd/ccrc`, literal path spelled nowhere else in bash. Add to
  `ccrc-install.test.ts` a case asserting the installed `ccrc.service` unit text contains BOTH
  EnvironmentFile lines in order (`ccrc.env` first, `exposure.env` second, both `-`-prefixed).
  Run both suites: the new cases fail. *(Measured: single-definition 2 failed / 64 passed;
  ccrc-install 1 failed / 82 passed.)*
- [x] **Step 2: GREEN** — declare `CCRC_EXPOSURE_FILE` in `ccd/ccrc` beside `BOX_ENV_FILE`
  with a comment naming D3 and the seed-once conflict it resolves; add the line to
  `deploy/ccrc.service`. *(66/66 and 83/83 green.)*
- [x] **Step 3:** mutation — remove the second EnvironmentFile line → the install case reds;
  spell the literal path a second time in `ccd/ccrc` → single-definition reds. Record counts.
  *(Measured: EnvironmentFile line removed → ccrc-install 1 red (82 pass); literal spelled a
  second time in `ccd/ccrc` → single-definition 1 red (65 pass). Both reverted.)*
- [x] **Step 4:** full `ccrc-install` + `single-definition` suites green. Commit
  `feat(expose): the exposure seam — one file constant, a second EnvironmentFile`.
  *(149/149 across both suites.)*

### Task 2: `ccrc expose` — the verb

**Files:**
- Modify: `ccd/ccrc` (usage `:210-240`, dispatch `:2932-2941`, new `cmd_expose` + `_exp_*`
  functions after `cmd_passwd`)
- Test: `server/test/ccrc-expose.test.ts` (new, on the `ccrc-passwd.test.ts` +
  `ccrc-install.test.ts` harness idioms)

**Interfaces:**
- Consumes: `CCRC_EXPOSURE_FILE`, `BOX_ENV_FILE` (Task 1); the `_inst_linger` degraded idiom;
  the `cmd_passwd` tty idiom.
- Produces: `ccrc expose duckdns` / `ccrc expose byo` / `ccrc expose status`;
  `~/.ccrc/exposure.env` (0600) with keys `CCRC_ORIGIN`, `CCRC_RP_ID`, and (duckdns only)
  `CCRC_DDNS_PROVIDER=duckdns`, `CCRC_DDNS_DOMAIN`, `CCRC_DDNS_TOKEN`; `~/.ccrc/Caddyfile`
  (0644, regenerated every run); Task 3 consumes the duckdns keys.

Behaviour contract (each bullet is a test):
- `expose` with no subcommand or an unknown one → usage die, exit 2 (the verb-table idiom).
- `duckdns`: tty-required (`[ -t 0 ]` or die — the `cmd_passwd` sentence verbatim); prompts for
  subdomain and token (token via `read -rs`, never argv, never echoed); writes `exposure.env`
  0600 with `CCRC_ORIGIN=https://<sub>.duckdns.org`, `CCRC_RP_ID=<sub>.duckdns.org`; generates
  the Caddyfile; installs the ddns units (Task 3); prints the sudo ceremony; exit 0 with a
  degraded-style landing block naming what the operator must still do (sudo ceremony, port
  forward 80/443, restart ccrc).
- `byo`: prompts for the full origin (e.g. `https://box.example.com`) and derives nothing —
  the operator states `CCRC_RP_ID` too (the PSL rule; the prompt text quotes
  `config.ts`'s rpId warning in one line); no ddns units.
- The Caddyfile is exactly:
  ```
  <host> {
      reverse_proxy 127.0.0.1:<CCRC_PORT>
  }
  ```
  with `<CCRC_PORT>` read from `ccrc.env` (default 7788) and `<host>` from the new origin —
  stock Caddy automatic HTTPS does the rest (spec D1). No TLS directives, no plugin syntax.
- **Shadow refusal (spec D3):** if `ccrc.env` already defines `CCRC_ORIGIN` or `CCRC_RP_ID`
  (the 3a hand-edit path), the verb refuses with a message naming both files and which would
  win, and makes no write. Mutation: delete the refusal → the shadow test reds.
- Idempotent: re-running with the same answers converges (same files, same bytes apart from
  nothing — assert byte-identical second run); re-running with new answers rewrites.
- `status`: prints configured/not-configured, the origin, and SET/NOT SET for the token —
  never the value.
- The sudo ceremony printed (and only printed) is exactly three steps: install caddy (distro
  package), `sudo ln -sf ~/.ccrc/Caddyfile /etc/caddy/Caddyfile` (or copy — print both forms),
  `sudo systemctl enable --now caddy`. Assert the transcript contains `sudo` ONLY inside the
  printed remedy (the `_inst_linger` grep shape).

- [x] **Step 1: RED** — write `ccrc-expose.test.ts` with the harness preamble copied from
  `ccrc-passwd.test.ts` (throwaway HOME, symlinked ccrc, fixture PATH; `caddy` NOT stubbed —
  the verb never executes it) covering every bullet above. All red (verb unknown).
  *(Measured: ccrc-expose 24 failed / 0 passed; plus the two RED extensions written in the
  same step — ccrc-cli 1 failed / 22 passed (usage line gains `expose`), single-definition
  2 failed / 74 passed (the new `CCRC_CADDYFILE` pin block).)*
- [x] **Step 2: GREEN** — implement `cmd_expose` + `_exp_env_write` (tmp+`mv -f` in the same
  dir — the wave-2 discipline), `_exp_caddyfile`, `_exp_landing`; usage + dispatch rows.
  *(124/124 across the three suites; `_exp_status` implemented beside them — the status
  bullet's tests live in the same RED set.)*
- [x] **Step 3:** mutations — drop `[ -t 0 ]` (piped-token test reds); echo the token
  (never-echoed test reds); drop the shadow refusal (reds); chmod 0644 the env file (0600
  test reds). Record. *(Measured, each against ccrc-expose (24 tests), each reverted:
  `[ -t 0 ]` disarmed → 2 red (duckdns + byo piped refusals); token `read -rsp`→`read -rp`
  → 1 red (never-echoed); shadow refusal disarmed → 2 red (both shadow keys); env chmod
  600→644 → 2 red (both 0600 mode assertions).)*
- [x] **Step 4:** `ccrc-cli`, `ccrc-expose`, `single-definition` green. Commit
  `feat(expose): ccrc expose — duckdns and byo, the no-sudo ceremony`.
  *(Gate suites green, and the neighbour suites that also pin `ccd/ccrc` re-run beside
  them: ccrc-passwd + ccrc-install + ccrc-doctor — 501/501 across all six.)*

### Task 3: The DuckDNS updater units

**Files:**
- Create: `deploy/systemd/ccrc-ddns.service`, `deploy/systemd/ccrc-ddns.timer`
- Modify: `ccd/ccrc` (`_exp_ddns_units`, called from the duckdns arm)
- Test: `server/test/ccrc-expose.test.ts` (extend)

**Interfaces:**
- Consumes: `CCRC_EXPOSURE_FILE` keys `CCRC_DDNS_DOMAIN`/`CCRC_DDNS_TOKEN` (Task 2).
- Produces: user units `ccrc-ddns.timer` (`OnCalendar=*:0/5`, `Persistent=true`) and
  `ccrc-ddns.service`: `EnvironmentFile=%h/.ccrc/exposure.env`,
  `ExecStart=/usr/bin/curl -fsS --max-time 30 "https://www.duckdns.org/update?domains=${CCRC_DDNS_DOMAIN}&token=${CCRC_DDNS_TOKEN}&ip="`
  (DuckDNS infers the caller's IP from an empty `ip=`).

- [x] **Step 1: RED** — tests: the duckdns arm installs both units into `$CCRC_UNIT_DIR` via
  the atomic idiom and runs `systemctl --user daemon-reload` + `enable --now ccrc-ddns.timer`
  (recording `systemctl` stub asserts argv); the byo arm installs neither; the unit text
  reads the token from the EnvironmentFile and NEVER inlines it (assert the installed service
  file contains `${CCRC_DDNS_TOKEN}` literally and not the fixture token value).
  *(Measured: ccrc-expose 4 failed / 25 passed — five new tests, of which the
  byo-installs-neither guard cannot red pre-implementation (nothing installs units yet); its
  arming mutation is calling `_exp_ddns_units` on both arms. Plus the Global-Constraints pin
  written in the same RED set: single-definition 2 failed / 68 passed (the `CCRC_DDNS_UNIT`
  block — the ddns unit name spelled once in bash).)*
- [x] **Step 2: GREEN** — write the two templates + `_exp_ddns_units`. *(99/99 across
  ccrc-expose + single-definition.)*
- [x] **Step 3:** mutation — inline the token into ExecStart at generation time → the
  never-inlined test reds. Record. Suites green. Commit
  `feat(expose): the duckdns updater is a user timer reading its token from exposure.env`.
  *(Measured: sed the `${CCRC_DDNS_TOKEN}` placeholder in the installed service to the value
  read back from exposure.env → ccrc-expose 2 red (never-inlined + templates-byte-for-byte)
  / 27 passed; reverted. Gate + neighbour suites green: ccrc-expose, single-definition,
  ccrc-cli, ccrc-passwd, ccrc-install, ccrc-doctor — 508/508.)*

### Task 4: Doctor — `exposure`, `caddy`, `cert`, `name`

**Files:**
- Modify: `ccd/ccrc-doctor-checks` (array `:165-185` + four `_check_*`)
- Test: `server/test/ccrc-doctor.test.ts` (extend; stubs: `caddy` absent/present, `systemctl`
  recording, `openssl`, `getent`)

**Interfaces:**
- Consumes: `CCRC_EXPOSURE_FILE` (Task 1); the `_dr_pass/_dr_warn/_dr_fail/_dr_skip` contract;
  `_check_fleet`'s rc-classification shape for the D-150 arms.
- Produces: four checks per spec D6, exact verdict table below.

Verdict table (each row is a test):
| check | state | verdict |
|---|---|---|
| exposure | no `exposure.env` | SKIP "not configured (BYO proxy or pre-3b box)" |
| exposure | file present, 0600, both origin keys | PASS naming the origin (never the token) |
| exposure | file present but mode not 0600, or a key missing | FAIL + remedy `ccrc expose` |
| caddy | no exposure | SKIP |
| caddy | exposure set, system unit active (`systemctl is-active caddy` rc 0) | PASS |
| caddy | exposure set, `systemctl` says inactive/absent | FAIL + the sudo ceremony remedy |
| caddy | no `systemctl` on PATH | SKIP (container/dev box — the `_check_services` precedent) |
| cert | no exposure | SKIP |
| cert | `openssl s_client` to `127.0.0.1:443` with SNI answers a cert ≥14 days out | PASS naming days |
| cert | cert expires <14 days | WARN |
| cert | handshake refused/absent | FAIL + "caddy not serving — see the caddy check" |
| name | no exposure / byo | SKIP |
| name | `getent hosts <domain>` resolves | PASS (WARN, not FAIL, when it resolves elsewhere — propagation) |
| name | does not resolve | FAIL + "duckdns update not landed — check ccrc-ddns.timer" |

- [x] **Step 1: RED** — bijection first (four array entries, no functions → four MISSING
  reds), then the verdict-table cases against stubbed `openssl`/`getent`/`systemctl`.
  *(Measured: bijection test 1 red printing exactly `MISSING _check_exposure/caddy/cert/name`;
  with the 19 verdict-table cases written and the `healthy()` fixture exposed, the full
  ccrc-doctor suite in the RED state: 64 failed / 208 passed — the four missing functions
  also FAIL every healthy-fixture run, so the collateral is the mechanism working.)*
- [x] **Step 2: GREEN** — implement the four checks. `openssl` invoked as
  `openssl s_client -connect 127.0.0.1:443 -servername "$host" </dev/null 2>/dev/null | openssl x509 -noout -enddate`
  with both hops through stubs in tests. *(272/272. The constants are reached through
  `_check_config`'s bug-in-ccrc guard shape — no literal respelling of
  `CCRC_EXPOSURE_FILE`/`CCRC_CADDYFILE`/`CCRC_DDNS_UNIT`, so single-definition's holder
  lists stay `['ccd/ccrc']`. Harness note: `linkReal` made idempotent (rm-then-link) —
  `healthy()` now links `stat`/`date` and the pre-existing oversize-wrapper test re-links
  `stat`.)*
- [x] **Step 3:** mutations — flip the cert threshold comparison (WARN case reds); make the
  name check FAIL on mismatch (the WARN-not-FAIL case reds); print the token in the exposure
  PASS detail (never-printed test reds). Record. `ccrc-doctor` suite green. Commit
  `feat(doctor): exposure, caddy, cert, name — four checks, D-150 arms`.
  *(Measured, each against ccrc-doctor (272 tests), each reverted: `-lt 14` → `-ge 14` →
  5 red (PASS-naming-days + WARN-under-14, plus three warn-count collaterals); the
  resolves-elsewhere `_dr_warn`→`_dr_fail` → 1 red (the WARN-not-FAIL pin); the canary
  token appended to the exposure PASS detail → 1 red (never-printed). Gate + neighbour
  suites green: ccrc-doctor 272/272, and single-definition + ccrc-expose + ccrc-cli +
  ccrc-install + ccrc-passwd 255/255 — 527/527.)*

### Task 5: `enrolledRpIds` — the rename sentence stops lying

**Files:**
- Modify: `shared/api.ts` (AuthStatus), `server/src/auth/credentials.ts`,
  `server/src/server.ts` (status route), `pwa/src/lib/auth.ts` or the login screen's data
  hook, `pwa/src/screens/LoginScreen.tsx`
- Test: `server/test/auth-routes.test.ts`, `pwa/test/auth-login.test.tsx`

**Interfaces:**
- Consumes: `PasskeyStore` rows' `rpId` (`credentials.ts:386-425`); the status route (exempt,
  already emitting auth state).
- Produces: `AuthStatus.enrolledRpIds?: string[]` — distinct `rpId` values over stored
  credentials, sorted, no ids/counts/material. PWA: when a passkey ceremony throws AND
  `enrolledRpIds` is non-empty AND excludes the server's current `rpId` (already present in
  the assert-start response), the login screen renders:
  `Your passkeys were enrolled for a different box name (<old>). Sign in with the passphrase and re-enrol.`
  — otherwise the existing cancelled sentence stands.

- [x] **Step 1: RED (server)** — status route: with two credentials under `localhost` and one
  under `mybox.duckdns.org`, `enrolledRpIds` is `['localhost','mybox.duckdns.org']`; with no
  store, the field is absent or `[]` (pick absent — assert absent); the field never contains a
  credential id (shape assertion). *(Measured: auth-routes 1 failed / 52 passed — the
  projection case reds; the absent-with-no-store case is green pre-implementation by nature,
  since absence is today's shape.)*
- [x] **Step 2: GREEN (server)** — `enrolledRpIds()` on the store; emit from the route.
  Single reader on the PWA side. *(53/53. The PWA's single reader is the existing
  `readAuthStatus` — `STATUS_PATH` is spelled once in `pwa/src/lib/auth.ts` and the field
  arrives through `Partial<AuthStatus>` with no new code, so that file needed no edit.)*
- [x] **Step 3: RED (pwa)** — the rename state renders the re-enrol sentence naming the old
  rpId; a plain cancel (empty/matching `enrolledRpIds`) still renders the cancelled sentence.
  *(Measured: auth-login 1 failed / 39 passed — the rename case reds; the two plain-cancel
  cases pass pre-implementation by nature (today every ceremony failure is a cancel); the
  Step-5 mutation is what proves the matching-name one guards.)*
- [x] **Step 4: GREEN (pwa)** — thread the field through the login screen's status read.
  *(40/40, `tsc --noEmit` clean. The current-rpId half rides `PasskeyCeremonyError.rpId` —
  D-142.)*
- [x] **Step 5:** mutation — drop the rpId-mismatch condition (the plain-cancel test reds,
  because every cancel would claim a rename). D-149 sweep note in the commit (no route
  added; the exempt GET's body widened — checked `ccd/ccrc` + both skills for `auth/status`
  readers: doctor's `_check_auth` reads it; verify its parser tolerates the new field).
  Suites + `single-definition` + pwa typecheck green. Commit
  `feat(auth): status names enrolled rpIds; the rename failure says what is true`.
  *(Measured: mismatch condition reduced to `enrolled.length > 0` → auth-login 1 red (the
  matching-name plain-cancel pin) / 39 passed; reverted. D-149 sweep: ZERO out-of-package
  `auth/status` readers exist — the parenthetical's `_check_auth` claim was stale, D-141.
  Gate + neighbour suites green: server auth-routes + single-definition + auth-passkey +
  auth-gate 378/378, typecheck-tests 9/9; pwa auth-login + auth-passkey 76/76, tsc clean.)*

### Task 6: trustProxy settled as none

**Files:**
- Modify: `server/src/config.ts:74-80` (the forward-reference paragraph)
- Test: `server/test/auth-routes.test.ts` (one new case)

- [ ] **Step 1: RED** — a source-scan test in the `auth-routes` file's idiom: the string
  `trustProxy` appears nowhere in `server/src/**/*.ts` except `config.ts`'s docstring (grep
  the corpus the way `single-definition` builds file lists). It fails only in the sense of
  needing the docstring update to exist — combine: assert `config.ts`'s cookieSecure
  docstring no longer says "belongs to Stage 3b" and instead says "settled: none".
- [ ] **Step 2: GREEN** — rewrite the paragraph per spec D5 (config-driven, no proxy trust, no
  forwarded-header consumer; the measured zero-consumer fact and the spoof-surface argument).
- [ ] **Step 3:** suites green. Commit `docs(config): trustProxy is settled — none, and why`.

### Task 7: Runbook step 11, docs, example env

**Files:**
- Modify: `docs/superpowers/specs/2026-08-19-stage2-vm-gate-runbook.md` (step 11; rewrite the
  two stale step-10 bullets at `:508-516`), `deploy/ccrc.env.example`, `README.md`
- Test: `server/test/runbook-holds.test.ts` (pins for any quoted transcript lines),
  `server/test/readme-holds.test.ts` if README quotes transcripts

- [ ] **Step 1:** write step 11: prerequisites (router forwards 80/443 — the D1 sentence; a
  DuckDNS account), `ccrc expose duckdns`, the sudo ceremony, `ccrc doctor` expected
  transcript (exposure/caddy/cert/name PASS lines), restart, phone install, login, re-enrol
  passkeys (the D7 choreography order verbatim), and the reference-box migration note (D8.2,
  operator-only). Rewrite `:508-516`'s two bullets to point at step 11 and correct the
  refusal-text claim (the shipped sentence is Task 5's, not "enrolled for localhost —
  re-enrol").
- [ ] **Step 2:** `ccrc.env.example`: document that exposure keys live in `exposure.env` and
  which file wins; README: the exposure section (BYO-proxy contract sentence from spec
  `:160-164` verbatim).
- [ ] **Step 3: RED→GREEN** — add `runbook-holds` pins for every doctor line step 11 quotes.
  Full server suite green. Commit `docs(runbook): step 11 — expose, ceremony, phone proof`.

### Task 8: Whole-branch review + close-out

- [ ] Whole-branch adversarial review (the wave-2 lens set adapted: bash correctness of the
  verb, token never printed/inlined anywhere incl. failure paths, doctor verdict table
  matches shipped text, wire additivity of Task 5, D-149 sweep evidence present in commits).
- [ ] Fix round; deviations ledgered below; PR from the feature branch; CI green.

## Deviations found

(D-139 onward; recorded during execution.)

- **D-139** (Task 2): the tty refusal is the `cmd_passwd` sentence's SHAPE, not its verbatim
  bytes. The plan says "the `cmd_passwd` sentence verbatim", but that sentence names a
  passphrase, a confirmation read, and `Run 'ccrc passwd' from a terminal` — three claims
  that are false for this verb. Shipped: the same structure and the same load-bearing
  clauses (`stdin is not a terminal` opener, the `curl … | bash` stdin-is-the-installer
  hazard, `Nothing was written.` closer), reworded for a DuckDNS token/origin and naming
  `ccrc expose <sub>`. The test pins the same two anchors the passwd suite pins
  (`/^ccrc: stdin is not a terminal/m`, `/curl … \| bash/`), so the two refusals cannot
  drift apart on the parts that matter.
- **D-140** (Task 3): the timer enable is DEGRADED, not fatal — the plan's Step 1 named the
  `systemctl` calls without naming their failure mode, and Task 2's already-shipped contract
  decides it: every duckdns-arm test runs against the fixture's poisoned `systemctl` (exit 97)
  and asserts exit 0, so a fatal enable would red the whole shipped suite. Shipped as
  `_inst_linger`'s doctrine at verb scale (both config files and both units have landed by
  that line; a box without a session bus — container, bare ssh, this repo's own fixture —
  must not turn a converged run into an abort over a thing one command fixes): on failure the
  verb prints the exact `daemon-reload && enable --now` command and exits 0, pinned by a
  fifth test (`a failing systemctl DEGRADES, never dies`) beyond Step 1's three named bullets.
  Doctor's `name` check (Task 4) carries the not-yet-enabled state.
- **D-141** (Task 5): the D-149 sweep's parenthetical claim is stale — measured, NO
  out-of-package consumer reads `/api/auth/status` at all (`grep -rn "api/auth" ccd/ deploy/`
  → zero hits). Doctor's `_check_auth` measures `ccrc.env`, the secret file and the session
  store ON DISK through `_box_env_value`/`_box_auth_path`, never the HTTP route, so there is
  no parser to verify tolerance on. The sweep still ran and the commit says what it checked;
  the widened exempt body has exactly one out-of-server reader, the PWA's `readAuthStatus`,
  which types the body `Partial<AuthStatus>` and is additive-tolerant by construction.
- **D-142** (Task 5): the rename condition needs the box's CURRENT rpId, which the plan
  locates "already present in the assert-start response" — a response only
  `pwa/src/lib/passkey.ts` (not in the task's file list) has in scope. Shipped: `assertPasskey`
  stamps it onto every `PasskeyCeremonyError` it throws after start (`readonly rpId`), and the
  login screen compares that against `status.enrolledRpIds`. Two adjacent anchor corrections:
  the login screen lives at `pwa/src/components/LoginScreen.tsx` (the list says `screens/`),
  and `pwa/src/lib/auth.ts` needed no edit — its `readAuthStatus` was already the single
  reader the field rides in on.
