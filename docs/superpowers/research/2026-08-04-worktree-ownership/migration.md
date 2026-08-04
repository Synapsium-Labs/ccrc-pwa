# Making `example-org/ccrc-pwa` canonical — research

Gathered 2026-08-04, read-only. All paths absolute. No `ccd` verb was run; no
tmux/systemd/registry state was modified.

## 0. A correction to the task framing (matters for every deploy statement below)

The task brief said "server-box (this box)" and "openclaw (fleet host,
198.51.100.7)". **This box is `openclaw`, 198.51.100.7** — `hostname` =
`openclaw`, `tailscale ip -4` = `198.51.100.7`. `server-box` is
**203.0.113.7**, a different machine.

Measured tailnet (`tailscale status`):

| Host | Tailnet IP | Runs |
| --- | --- | --- |
| `openclaw` (this box, the monorepo checkout) | `198.51.100.7` | `ccrc-agent.service` (active running), the 16 `claude-session@*` units, `claude-docserver.service` |
| `server-box` | `203.0.113.7` | `ccrc.service` (the server + PWA). Not verifiable from here without SSH — see gaps. |

`systemctl --user cat ccrc` on this box returns **"No files found for
ccrc.service"** — the server unit is not installed here. Only
`ccrc-agent.service` is (`/home/you/.config/systemd/user/ccrc-agent.service`,
plus a hand-written drop-in `ccrc-agent.service.d/protect.conf` and three
transient `systemctl set-property` drop-ins under
`/run/user/1000/systemd/user.control/`). **Those drop-ins are box state, not repo
state — no deploy reproduces them, and a fresh install loses them.**

So: the docserver and the fleet sessions and the agent are on `openclaw`; the
ccrc *server*, and therefore the PWA people actually open, is on `server-box`.

---

## M1 — Current deploy reality

### The one script

`/srv/projects/OpenClawHetzner/infra/ccrc/deploy/deploy.sh`
(3,250 bytes, mode `100755`, last touched by `a501b12`).

```
BOX="${CCRC_BOX:-you@203.0.113.7}"          # -> server-box
CCRC_SSH_KEY="${CCRC_SSH_KEY:-$HOME/.ssh/your-key-a}"
CCRC_SSH_PORT="${CCRC_SSH_PORT:-2222}"
HEALTH_URL="${CCRC_HEALTH_URL:-http://203.0.113.7:7788/health}"
```

Two modes:

- **`deploy.sh`** (server, default) → `rsync ... infra/ccrc/server infra/ccrc/shared infra/ccrc/deploy $BOX:ccrc/`,
  then on the box: `cd ~/ccrc/server && npm ci && npm run build`, copy
  `~/ccrc/deploy/ccrc.service` into `~/.config/systemd/user/`, `daemon-reload`,
  `enable --now`, `restart`, `sleep 1 && curl -fsS $HEALTH_URL`.
- **`deploy.sh agent <host>`** → same rsync but `infra/ccrc/agent`, then
  `npm ci && npm run build`, copy `ccrc-agent.service`, restart, then
  `bash ~/ccrc/deploy/verify-service.sh ccrc-agent.service` (MainPID-stability
  check; the last link of the `&&` chain, so `set -e` aborts the deploy on it).

Both call `ship_env`, which scp's a gitignored real-token env file if present.

### Every monorepo-relative path in it (the flip surface)

| Line | Literal | Why it breaks in a flat repo |
| --- | --- | --- |
| `deploy/deploy.sh:22` | `local local_file="infra/ccrc/deploy/$1"` | env file lookup |
| `deploy/deploy.sh:32` | `infra/ccrc/agent infra/ccrc/shared infra/ccrc/deploy` | agent rsync sources |
| `deploy/deploy.sh:52` | `infra/ccrc/server infra/ccrc/shared infra/ccrc/deploy` | server rsync sources |

These are **relative to the repo root, and the script is invoked from the repo
root** (`bash infra/ccrc/deploy/deploy.sh`), not relative to the script. In
`/srv/projects/ccrc-pwa` the same file is **byte-identical**
(the extraction was a literal copy) so **`ccrc-pwa/deploy/deploy.sh` cannot
deploy anything today** — every rsync source resolves to a nonexistent
`infra/ccrc/...`. This is the single hard blocker on flipping the source.

The flip is three `infra/ccrc/` prefix deletions plus a `cd "$(dirname "$0")/.."`
(or `git rev-parse --show-toplevel`) so the script stops depending on the
caller's cwd. Nothing else in the script is layout-bound.

`/srv/projects/ccrc-pwa/README.md` carries the same stale
paths at lines **58, 59, 69, 99** (`bash infra/ccrc/deploy/deploy.sh`,
`infra/ccrc/deploy/ccrc.env`, ``ccrc-agent (`infra/ccrc/agent/`)``).

### What the deploy does NOT do

- **It never builds the PWA.** Neither branch runs anything in `pwa/`. The
  server rsync uses `--exclude dist`, which is an exact-basename match and does
  **not** exclude `dist-pwa/` — so the PWA that reaches `server-box` is whatever
  `server/dist-pwa/` happened to contain on the deploying box.
  `infra/ccrc/server/dist-pwa/` on this box is dated **Aug 2 23:51**;
  `ccrc-pwa/server/dist-pwa/` is dated **Aug 3 13:04**. Both are gitignored
  (`ccrc-pwa/.gitignore`: `server/dist-pwa/`). Finding 1 in the findings doc
  names this exact failure ("a Jul 29 bundle served for four days behind a green
  deploy"). **Flipping the source silently changes which bundle ships** unless
  the flip adds an explicit `cd pwa && npm ci && npm run build` step.
- **It never ships `ccd`.** `grep ccd infra/ccrc/deploy/*.sh` hits only the
  comment in `notify.sh`. `ccd` is installed **by hand**: `~/.local/bin/ccd` is a
  *copy*, per the 2026-06-15 portability plan
  (`plans/2026-06-15-remote-claude-session-portability.md:27-28`:
  `scp infra/ccrc-portability/ccd "$BOX":/home/you/.local/bin/ccd`
  then `chmod +x`). Measured today, all three are in sync:
  `sha256 2bc6287b5e8a882168118c6977e148547e4b2c18278011b616c8b9b23aa42f7d` for
  `~/.local/bin/ccd`, `infra/ccrc-portability/ccd`, and `ccrc-pwa/ccd/ccd`.
  This is the gap that let an installed ccd sit 4,258 lines behind main, and the
  one that finding 1 says spec 3's installer must close.
- **Nothing deploys the docserver, the `claude-session@.service` template, the
  statusline, or `tmux.conf`** — those four files moved into `ccrc-pwa/ccd/`
  but no script installs them from either repo.

### The units

`deploy/ccrc.service` hardcodes the destination box in the unit itself:

```
Environment=CCRC_HOST=203.0.113.7
Environment=CCRC_PORT=7788
ExecStart=/usr/bin/env node %h/ccrc/server/dist/server/src/index.js
```

`deploy/ccrc-agent.service` is host-agnostic (`EnvironmentFile=%h/.ccrc/agent.env`).
The **live** agent unit on this box is byte-equal to the repo copy plus the
`protect.conf` drop-in described above.

`deploy/notify.sh` is a `ccd` swap hook posting to
`http://${CCRC_ADDR:-203.0.113.7:7788}/api/notify`. **It is installed live** at
`/home/you/.cc-sessions/notify.sh` (mode 755, Jul 21 16:22, content
identical to the repo copy). `ccd` invokes it at
`~/.local/bin/ccd:5284` — `[[ -x "$REG/notify.sh" ]] && "$REG/notify.sh" ...`.
No deploy script installs it; it was placed by hand. Flipping the repo does not
touch it, but it is a fourth hand-installed artifact the spec-3 installer owes.

### Where the live PWA is served from

`ccrc-pwa/pwa/vite.config.ts:68` → `outDir: '../server/dist-pwa'`.
`ccrc-pwa/server/src/server.ts:60-66` walks up from the module to find a sibling
`dist-pwa/`, and `:545-552` serves it at `/` via `@fastify/static` with an SPA
fallback to `index.html`. So on `server-box` the served bundle is
`~/ccrc/server/dist-pwa/`, populated purely by rsync. Fronted by
`tailscale serve` on **:8443** (`https://server-box.tailnet-example.ts.net:8443/`) —
443 root belongs to `claude-docserver`. The `tailscale serve` config on
`server-box` is **not visible from here** (see gaps).

### What flipping the source to `/srv/projects/ccrc-pwa` touches

1. `ccrc-pwa/deploy/deploy.sh` — three path literals + cwd independence.
2. `ccrc-pwa/README.md` — four stale `infra/ccrc/` references.
3. A PWA build step, or the flip regresses the served bundle.
4. `ccrc-pwa/deploy/ccrc.env` and `ccrc-agent.env` — **gitignored, and they do
   not exist in the new checkout.** `ship_env` silently no-ops when the file is
   absent (`if [ -f ... ]`), so the first flipped deploy would restart the agent
   with a stale `~/.ccrc/agent.env` (fine) but would never re-ship a rotated
   token, and a fresh box would boot tokenless. Copy them across *out of band*;
   they are not in git by design.
5. Nothing on either box changes: same `~/ccrc/` destination, same units, same
   ports. The flip is a **source-side-only** change, which is why it is safe to
   do before spec 1/2/3.

---

## M2 — Sync state (finding-6 mode insurance, and both-direction commit mapping)

### `git ls-files -s` mode + path comparison

Method: mono side = `git ls-files -s infra/ccrc` with the `infra/ccrc/` prefix
stripped, plus `infra/ccrc-portability/{ccd,claude-session@.service,statusline-command.sh,tmux.conf}`
mapped to `ccd/<name>` (the `PORTABILITY_FILES` allowlist in
`scripts/extraction-manifest.sh`). 304 mono entries vs 308 pwa entries.

**Modes: every file that exists in both has the identical mode.** The five
executables — `ccd/ccd`, `deploy/deploy.sh`, `deploy/notify.sh`,
`deploy/verify-service.sh`, `scripts/extraction-manifest.sh` — are `100755` on
both sides; everything else is `100644` on both sides. **Finding 6's "did a
`+x` bit get lost" concern is answered: no.**

Full path delta:

| Path | Side | Status |
| --- | --- | --- |
| `.github/workflows/ci.yml` | pwa only | expected — the monorepo has no CI |
| `.gitignore` | pwa only | expected — flat-layout ignore, added by `0485fb9` |
| `ccd/claude-session@.service`, `ccd/statusline-command.sh`, `ccd/tmux.conf` | pwa only *by path* | **not a real delta** — blob-hash-identical to `infra/ccrc-portability/<name>` in mono (verified with `git rev-parse HEAD:<path>` on both sides; all four including `ccd/ccd` report SAME) |
| `server/test/ccd-ccclip.test.ts` | mono only | **deliberate**, see below |

Content diff of the whole mapped tree (`git archive HEAD infra/ccrc` vs the pwa
working tree, excluding `.git .github .gitignore ccd node_modules dist dist-pwa`)
returns exactly **two** lines:

- `Only in mono: server/test/ccd-ccclip.test.ts`
- `ccdWsHelpers.ts differ` — one line, the permitted one:
  ```
  < export const CCD = path.resolve(__dirname, '../../../ccrc-portability/ccd');
  > export const CCD = path.resolve(__dirname, '../../ccd/ccd');
  ```

That matches the plan's "Done when: manifest differs in exactly the two expected
lines" exactly.

**On `ccd-ccclip.test.ts` (149 lines, mono-only).** It is excluded *by design*:
`scripts/extraction-manifest.sh` `is_excluded()` has
`*/server/test/ccd-ccclip.test.ts) return 0` with the comment "the one test that
stays with the Mac-side tool it exercises". `ccclip` is a macOS-side helper
(`infra/ccrc-portability/ccclip`) and is *not* one of the four
`PORTABILITY_FILES`. **But `ccrc-pwa/ccd/ccd` still implements `ccd clip`**
(grep hits `ccclip` in `ccrc-pwa/ccd/ccd`,
`server/test/single-definition.test.ts`, `server/test/extraction-manifest.test.ts`),
and the agent whitelist admits `ccd clip`. So the canonical repo ships a verb
whose 149-line test lives only in the repo scheduled for deletion. **This is the
one substantive thing the monorepo still holds that ccrc-pwa does not.** It is
not a sync defect today; it becomes a coverage loss the day `infra/ccrc/` is
deleted. Decide explicitly: port it (and `ccclip`) into ccrc-pwa, or record the
deletion of the test as intentional.

Also tracked in both, and shouldn't be: `pwa/tsconfig.tsbuildinfo`. `b7ba967`
excluded it from the *manifest* but it is still a tracked file in both repos.

### Commits since extraction — both directions

**Monorepo** (`you/OpenClawHetzner`, HEAD `9f15625`, working tree clean;
note the session's opening git snapshot showing `5a943c5` was stale):

- `d2c4ba0` is an ancestor of HEAD (verified).
- `git log d2c4ba0..HEAD -- infra/ccrc infra/ccrc-portability` → **empty**.
- `git log d2c4ba0..HEAD` (all paths) → four commits, all docs/merge:
  `9a97db0` (plan defect corrections), `4a90d5f` (spec content-identity),
  `6118ed6` (Merge PR #2 `you/ccrc-pwa-extraction`), `9f15625` (the findings
  doc).

**→ Zero product drift has accumulated on the monorepo side since `d2c4ba0`.**
The window is currently clean — the cheapest moment to freeze.

**ccrc-pwa** (HEAD `b7ba967`, clean, `3ade762` is the extraction base):

| Commit | Nature | Needs back-port to mono? |
| --- | --- | --- |
| `e23b69a` test(ccrc): manifest script comparing both layouts | mono has it at `d2c4ba0` | no |
| `fbb71b4` refactor(ccrc): one definition of the ccd path | mono has it (pre-extraction Task 2) | no |
| `ee3eb19` fix(ccrc): post-move parts form, drop dead wsaudit bindings, scan test-e2e | **content-identical in mono** (diff is clean) → this is the pwa-side landing of work already in mono | no |
| `0485fb9` fix: resolve ccd inside the repo + flat-layout `.gitignore` | layout-specific (`ccdWsHelpers.ts`, `.gitignore`) | no — permitted deviation |
| `de2a918`, `c65bebb` ci | pwa-only by design | no |
| `b7ba967` test: manifest checksum blind spot, exclude tsbuildinfo | same change as mono's `d2c4ba0` | no |

**The mapping is complete in both directions.** Every pwa commit after
`3ade762` is either the flat-layout equivalent of something already in the
monorepo, or CI that the monorepo deliberately does not have. Nothing in either
repo is unrepresented in the other except the two known lines and the
deliberately-excluded ccclip test.

---

## M3 — The findings doc, and how the migration must sequence against specs 1–3

`/srv/projects/OpenClawHetzner/docs/superpowers/specs/2026-08-03-ccrc-pwa-findings-for-specs-1-3.md`
(134 lines). Six findings; the ones that constrain this migration:

**Finding 1 → spec 3 (installer/deploy).** `agent/src/server.ts:417` reads
`ccd caps` **once at agent boot**, outside the connection handler, and hands the
frozen array to every connection (`:340`). Measured 2026-08-02: agent started
23:42:50, new `ccd` installed 23:44:43 — **113 seconds late**, and for 14 hours
the agent advertised the old 1,181-line binary's verbs while the 5,439-line one
sat beside it. `deploy.sh` exited 0, `/health` was `{"ok":true}`, and `ccd caps`
by hand was correct. Requirement: **either capability capture stops being a boot
snapshot, or the install order is enforced by the installer.** "A comment in a
README is not a mechanism." The doc calls this the third instance of one shape —
deploy that never builds the PWA, deploy that never ships ccd, agent that caches
caps — *a green signal standing in for a measurement nobody took*. **This is
already in the local memory file (`ccrc-agent caches ccd caps at boot`) and it is
the reason the migration checklist below never treats "deploy exited 0" as
verification.**

**Finding 2 → spec 1.** `_ws_gc_merged` (`ccd/ccd` ~4640) resolves its base via
`git symbolic-ref refs/remotes/origin/HEAD`; probed on git 2.43.0 that ref
**does not exist after `push -u`**, so the merged-check returns `unprovable` and
`ws-gc` refuses. Portability hazard for handing ccd to colleagues. Unresolved:
which git version changed it (needs ≥2.46 to bisect).

**Finding 3 → spec 1.** Fixture race in the server suite under parallel
execution only: `IsADirectoryError ... /tmp/ccrc-ccd-prstate-*/.cc-sessions/demo-quiet-basin.prnumber`
— a directory where a file is expected; suspect slug collision on
`demo-quiet-basin`. Plus an intermittent `ccd-ws-gc.test.ts > lists the ignored
entries it is about to destroy`, reproduced 3× locally by a reviewer. **A flake
in the deletion path.** Relevant here because CI is about to become the gate: a
red run that everyone learns to re-run is worse than no gate.

**Finding 4 → the reason this task exists.** "`infra/ccrc/` in this monorepo and
`example-org/ccrc-pwa` contain the same product... **Any ccrc change must
land in both until `infra/ccrc/` is deleted.**" And the measured cost: "within an
hour of the extraction, a review fix wave landed monorepo-only and had to be
ported by hand, because the better test coverage had been added to the copy
scheduled for deletion."

**Finding 5 → spec 1 (de-personalisation), operator-accepted.**
`example-org` sets `default_repository_permission: read`, so **all 61 org
members can read `ccrc-pwa`** despite `private` (0 direct, 0 outside
collaborators — every reader inherited). ccrc has **no authentication** (spec 2),
so the address *is* the guard. The tree carries the operator's tailnet name, box
IPs, username and home paths across **9 files / 20 hits**. Operator ruled
2026-08-03 that the 61 are not a risk.

I re-measured the personalisation spread today. Grepping
`203.0.113.7|198.51.100.7|you|tailnet-example|/home/you` over
`*.ts,*.tsx,*.sh,*.service,*.md,*.example` gives **exactly 20 hits**, matching
the doc. Widening to include `server-box|openclaw` and `*.yml` gives **19 files**:

`deploy/ccrc.service`, `deploy/deploy.sh`, `deploy/notify.sh`,
`deploy/ccrc.env.example`, `README.md`, `scripts/extraction-manifest.sh`,
`ccd/statusline-command.sh`, `server/src/config.ts`, `server/src/fleet.ts`,
`server/src/inject/send.ts`, `server/test/config.test.ts`,
`server/test/routes.test.ts`, `server/test/remote-runner.test.ts`,
`server/test/single-definition.test.ts`,
`server/test/extraction-manifest.test.ts`, `pwa/src/fleet/sessionLabel.ts`,
`pwa/test/header.test.tsx`, `pwa/test/compose.test.ts`,
`agent/test/exec.test.ts`.

The 9-file/20-hit figure is the **narrow** set (identifying strings only); the
19-file set includes hostname mentions in prose and test fixtures. **Spec 1
should size against 19, not 9** — otherwise "de-personalised" will still leave
`server-box` and `openclaw` in half a dozen source files.

**Finding 6 → discharged in part by this research.** The `git ls-files -s`
comparison it recommends as "cheap insurance" is done above: **no mode drift.**
The other two sub-items stand: `refuses an unrecognised tree` asserts only
`toThrow()` (would pass if the script were absent), the manifest is blind to
additions on the standalone side, and **no `package.json` has an `engines`
field** despite Node ≥22 being a hard requirement documented only in prose —
spec 3's prereq check.

**Sequencing consequence.** The plan
(`plans/2026-08-03-ccrc-pwa-extraction.md:1168`) says: *"The monorepo keeps its
copy of everything. Deleting it happens after spec 3, once `ccrc-pwa`'s install
path has been proven."* And its "Deliberately not done" section forbids granting
any colleague access "until spec 1 lands". So:

- **Canonical-ising ccrc-pwa is not gated on spec 1, 2 or 3.** Making it the
  place work happens, and freezing the monorepo copy, is orthogonal to
  de-personalisation and auth — it only requires the deploy source to work from
  the flat layout.
- **Deleting `infra/ccrc/` IS gated on spec 3.**
- **Granting anyone access is gated on spec 1.**
- Every spec 1/2/3 change should land in ccrc-pwa *only*, once the freeze is up —
  which is precisely the reason to freeze before starting spec 1 rather than
  after: spec 1 touches 19 files, and dual-landing that by hand is how finding
  4's drift happened the first time.

---

## M4 — Docserver

`/home/you/.claude-docserver/config.json` — 10 entries. **`ccrc-pwa` is
NOT served.** Entries are `custom-tools`, `data-internal`, `expoAI-assistant`,
`orchard-api`, `intake-platform`, `MekWarLive`, `OpenClawHetzner`,
`rp-llm`, `synapsium-platform`, and one worktree entry
`data-internal-clear-mesa` → `/home/you/worktrees/data-internal/clear-mesa`.
No entry carries a `ref` override, so all serve the default `origin/main`.

The entry to add (do **not** edit the file as part of this research — it
hot-reloads on mtime):

```json
  {
    "label": "ccrc-pwa",
    "root": "/srv/projects/ccrc-pwa"
  }
```

Two caveats:

- `ccrc-pwa` has **no `docs/superpowers/{specs,plans}` directory at all** (its
  tree is `agent ccd deploy pwa scripts server shared .github`). Adding the root
  before any docs exist gets an empty project page. If specs 1–3 are to live in
  ccrc-pwa, they need `docs/superpowers/specs/` created there; if they stay in
  the monorepo (they are there now, and the monorepo is served), no config
  change is needed at all until the split is decided.
- `/data/projects` and `/srv/projects` are **the same
  directory** (`readlink -f /data/projects` → `/srv/projects`).
  Every other entry uses the `/mnt/...` spelling; match it.

The live docserver is `claude-docserver.service` (active), running
`/home/you/.claude-docserver/venv/bin/python
/home/you/.claude-docserver/server.py` on **this** box (openclaw) — note
that the doc-link convention in CLAUDE.md names `server-box.tailnet-example.ts.net`
as the docserver host, which is the *other* box. Worth confirming which one the
tailnet name actually resolves to before publishing links (see gaps).

---

## M5 — CI and repo state in `ccrc-pwa`

`/srv/projects/ccrc-pwa/.github/workflows/ci.yml`. Triggers:
`push` to `main`, and `pull_request` (any branch). Two jobs:

- **`test`** — matrix over `[server, agent, pwa]`, `fail-fast: false`, Node 22
  with npm cache keyed on each package's lockfile. For `server` only: installs
  `tmux` via apt (the ccd tests execute the real bash script against fixture
  HOMEs) **and** runs `npm ci` in `agent/` too, because
  `server/test/typecheck-tests.test.ts` spawns `tsc` against agent's project.
  Then `./node_modules/.bin/vitest run` and `./node_modules/.bin/tsc --noEmit`
  per package — local binaries, never `npx`.
- **`build-pwa`** — `npm ci && npm run build` in `pwa/`, then
  `test -f server/dist-pwa/index.html`. The comment is explicit: "A green build
  step with no artifact is the failure this repo has already shipped once."

The header comment states the purpose outright: "The monorepo had no CI at all —
these suites have only ever been run by hand, which is how an installed ccd sat
4,258 lines behind main without anyone noticing. This is the mechanism that
keeps the extraction honest."

**Repo facts** (`gh api repos/example-org/ccrc-pwa`):

| Field | Value |
| --- | --- |
| default branch | `main` |
| visibility | `private` (61 org members inherit read — finding 5) |
| `allow_squash_merge` | `true` |
| `delete_branch_on_merge` | **`false`** |
| `has_issues` | `true` |
| id / size | `1321771345` / 1959 KB, `pushed_at` 2026-08-03T14:20:40Z |

**Branch protection: none.** `gh api repos/example-org/ccrc-pwa/branches/main/protection`
→ `404 {"message":"Branch not protected"}` — a real answer, not a permission
failure. `gh api .../rulesets` → `[]`. So `main` today accepts direct pushes and
force-pushes, and **CI is advisory: nothing blocks a merge on it.**

**Open PRs: none.** `gh pr list --state all` returns empty — the repo has never
had a PR; all seven post-extraction commits went straight to `main`.

**Recent runs** (`gh run list`): `30822242117` success (`b7ba967`, 4m56s),
`30817971495` success (`c65bebb`, 5m15s), `30817088087` **failure**
(`de2a918`, the CI-introducing commit — fixed by the next one). CI is green on
`main` today and takes ~5 minutes.

Monorepo for contrast: `you/OpenClawHetzner`, private, default `main`, no CI.
Note the **owner mismatch** — the monorepo is on a personal account, ccrc-pwa is
on the org. That is what makes the org's 61-reader default apply to one and not
the other.

---

## M6 — The "land in both" rule, and what replaces it

**Today's rule**, stated once, in prose, in one document:
`specs/2026-08-03-ccrc-pwa-findings-for-specs-1-3.md:98` — *"Any ccrc change must
land in both until `infra/ccrc/` is deleted."* The extraction plan reinforces it
from the other side (`plans/2026-08-03-ccrc-pwa-extraction.md:1168`): *"The
monorepo keeps its copy of everything. Deleting it happens after spec 3."*

**There is no mechanism.** No CI in the monorepo, no hook, no README marker in
`infra/ccrc/`, no CODEOWNERS, no branch protection on either side. The rule is
enforced entirely by whoever remembers it — and it has already failed once
within an hour of the extraction (finding 4). This is finding 1's shape again:
an instruction standing in for a mechanism.

### Recommendation — the smallest honest mechanism

The rule to replace it is the inverse: **ccrc-pwa is canonical; `infra/ccrc/` and
the four `infra/ccrc-portability/` files are a frozen mirror that must not
change.** Three candidate mechanisms, in increasing cost:

1. **README tombstone only** — `infra/ccrc/README.md` gains a header, the
   monorepo `CLAUDE.md` gains a line. Zero infrastructure. But it is *exactly*
   the mechanism that just failed, and finding 1 says in as many words that a
   comment in a README is not a mechanism. **Necessary, not sufficient.**
2. **A pre-commit hook** — local, per-checkout, bypassable with `--no-verify`,
   and invisible to any other clone. Not honest.
3. **A monorepo CI guard.** The monorepo has *no* CI at all today, so this means
   standing up a first workflow — but a freeze guard is about the cheapest
   possible one: ~15 lines, `pull_request` + `push`, `git diff --name-only` the
   base against HEAD and fail if anything under `infra/ccrc/` or the four
   `infra/ccrc-portability/` files changed. It costs seconds, needs no
   Node, no deps, no secrets.

**Recommended: 1 + 3 together, and nothing more.**

- The tombstone is what a human reads when they open the directory and wonder
  why their change is being rejected. It must name the canonical repo URL, the
  freeze date, and the deletion trigger (spec 3 landing).
- The CI guard is what actually stops the commit. It is honest because it fails
  on the change itself rather than on someone's memory of a rule, and it is
  small enough to be obviously correct.
- **Do not add branch protection to the monorepo's `main` for this.** It would
  block the guard's own enabling commit and every unrelated monorepo change; the
  guard failing a run is sufficient signal for a single-operator repo.
- **Do consider enabling branch protection (or a ruleset) on `ccrc-pwa`'s `main`
  requiring the `test` and `build-pwa` checks** — that is a separate, and more
  valuable, change, because today CI is advisory there and the repo is about to
  become the only copy. But it converts a 7-commits-direct-to-main workflow into
  a PR workflow; confirm that is wanted before doing it, and if yes, also flip
  `delete_branch_on_merge` to `true`.

One nuance the guard must handle: **`infra/ccrc-portability/` is only
partly frozen.** Four of its thirteen files moved (`ccd`, `claude-session@.service`,
`statusline-command.sh`, `tmux.conf`); the other nine (`cc`, `ccclip`,
`cc-termux`, `cc-compact-restore.sh`, `docserver-server.py`,
`hammerspoon-init.lua`, `hardening.sh`, `install-compact-hook.sh`, `README.md`)
are operator tooling that legitimately stays and keeps changing. The guard must
freeze **exactly the four**, using the same `PORTABILITY_FILES` allowlist that
`scripts/extraction-manifest.sh` already encodes — and note that `ccclip` is on
the *stays-behind* side while `server/test/ccd-ccclip.test.ts` (also
stays-behind) tests a `ccd` verb that *moved*. Those two must move or die
together; see M2.

---

## Ordered checklist

Ordering rationale: the deploy source cannot flip until `deploy.sh` works from
a flat layout (M1), and the freeze must not be declared until the flipped deploy
has been *proven by measurement* (finding 1), and nothing here is allowed to
touch a running session.

**Phase A — make ccrc-pwa deployable (all changes in ccrc-pwa, nothing deploys)**

1. Confirm the sync baseline still holds before starting: re-run
   `scripts/extraction-manifest.sh` in both repos and diff; expect exactly the
   `ccdWsHelpers.ts` line and the excluded ccclip test. Re-run the
   `git ls-files -s` mode comparison. **Both are clean as of 2026-08-04** —
   this is a re-verify, not a discovery.
2. Decide the `ccclip` question and record it: port
   `infra/ccrc/server/test/ccd-ccclip.test.ts` (149 lines) + the `ccclip`
   script into ccrc-pwa, **or** write down that `ccd clip`'s test dies with the
   monorepo. Do this *now*, while both copies exist.
3. In `ccrc-pwa`, fix `deploy/deploy.sh`: drop the three `infra/ccrc/` prefixes
   (lines 22, 32, 52) and make it cwd-independent
   (`cd "$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"`).
4. In the same commit, add the PWA build to the server path:
   `cd pwa && npm ci && npm run build && test -f ../server/dist-pwa/index.html`
   **before** the rsync. This closes the first of finding 1's three instances
   and prevents the flip from silently changing which bundle ships.
5. Fix the four stale `infra/ccrc/` references in `ccrc-pwa/README.md`
   (lines 58, 59, 69, 99).
6. Copy the two gitignored env files across out of band:
   `infra/ccrc/deploy/{ccrc.env,ccrc-agent.env}` →
   `ccrc-pwa/deploy/`. Verify with `ls`, never by printing contents.
7. Push; confirm CI green (~5 min, three suites + three typechecks +
   `build-pwa`).

**Phase B — flip the deploy source (the only step that touches live services)**

8. Deploy the **agent** first, from ccrc-pwa, to this box:
   `bash deploy/deploy.sh agent you@198.51.100.7`. `verify-service.sh`
   gates it on MainPID stability across a 5 s window.
9. **Then** verify capabilities explicitly, because the agent caches `ccd caps`
   at boot (finding 1, and the standing memory note): confirm the agent's
   advertised verb list matches the installed ccd, and that
   `sha256 ~/.local/bin/ccd` still equals `2bc6287b5e8a…`. If ccd is ever
   reinstalled, restart the agent *after*, never before.
10. Deploy the **server** from ccrc-pwa:
    `bash deploy/deploy.sh` (→ `you@203.0.113.7`, health-checked).
11. Verify the served bundle actually changed — compare the hash of the
    `assets/` entry in `~/ccrc/server/dist-pwa/index.html` on server-box against
    the freshly built one. A green deploy is not evidence; this is the exact
    class of failure finding 1 documents three times.
12. Confirm the fleet is untouched: 16 `claude-session@*` units still active,
    `/api/fleet/health` responding, `~/.cc-sessions/notify.sh` unchanged.

**Phase C — freeze the monorepo copy (only after Phase B is proven)**

13. Add `infra/ccrc/README.md` tombstone: canonical repo URL
    `https://github.com/example-org/ccrc-pwa`, freeze date, "changes here
    are rejected by CI", deletion trigger = spec 3 landing.
14. Add the monorepo's first workflow, `.github/workflows/ccrc-freeze.yml`:
    fail if `git diff --name-only` against the base touches `infra/ccrc/**` or
    any of the four frozen `infra/ccrc-portability/` files. Leave the other
    nine files in that directory unguarded.
15. Add one line to the monorepo's `CLAUDE.md` pointing ccrc work at ccrc-pwa.
16. Prove the guard: open a throwaway branch touching one byte under
    `infra/ccrc/`, confirm CI red, delete the branch. **A guard nobody has seen
    fail is a green signal standing in for a measurement.**
17. Amend `specs/2026-08-03-ccrc-pwa-findings-for-specs-1-3.md` finding 4 —
    "must land in both" is now false and actively harmful. Replace with the
    freeze rule and the date it took effect.

**Phase D — optional hardening, confirm before doing**

18. Docserver: add `{"label":"ccrc-pwa","root":"/srv/projects/ccrc-pwa"}`
    to `~/.claude-docserver/config.json` — **only if** ccrc-pwa is going to hold
    `docs/superpowers/{specs,plans}`. It has no docs directory today. Config
    hot-reloads on mtime; no restart.
19. `ccrc-pwa` branch protection / ruleset on `main` requiring `test` and
    `build-pwa`, plus `delete_branch_on_merge: true`. Converts the current
    push-to-main workflow into PRs — confirm that is wanted.
20. Fix the flake (finding 3) before protection makes it a merge blocker: the
    `demo-quiet-basin` slug collision in the prstate fixtures, and the
    `ccd-ws-gc.test.ts` intermittent. A flaky gate in the deletion path teaches
    people to re-run red.

**Phase E — gated on spec 3, not on this work**

21. Delete `infra/ccrc/` and the four frozen portability files from the
    monorepo, once ccrc-pwa's install path is proven. Then the freeze guard and
    its tombstone come out too.
