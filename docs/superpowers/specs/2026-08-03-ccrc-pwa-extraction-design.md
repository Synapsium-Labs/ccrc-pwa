# ccrc-pwa Extraction Design

**Date:** 2026-08-03
**Status:** approved for planning
**Spec:** 0 of 4 (see [Roadmap](#roadmap))

## Goal

Move ccrc out of the `OpenClawHetzner` monorepo into a standalone private repo
called **`ccrc-pwa`**, changing **no behaviour whatsoever**. Same code, new
address.

That constraint is the whole point. Specs 1–3 change how ccrc is configured,
secured, and installed; each of them is a redesign with judgement calls in it.
If the move and a redesign land together and something breaks, there is no way
to tell which one caused it. A pure move is verifiable by machine — checksums
and test counts — with no judgement required, and it is the foundation the
other three build on.

## Why ccrc is not self-contained today

Three independent facts, each of which alone stops a colleague from running it:

1. **The test suite escapes the package tree.** Eight files under
   `infra/ccrc/server/test/` reference `../../../ccrc-portability/`,
   reaching out of `ccrc/` into a sibling directory to exec the real `ccd`
   bash script. Extracting `ccrc/` alone breaks its own tests.
2. **The runtime assumes an un-shipped dependency.** `server/src/config.ts:38`
   resolves `ccdBin` to `~/.local/bin/ccd` — a 5,439-line bash program that
   nothing in the repo installs, and which `deploy/deploy.sh` has never
   deployed. On 2026-08-02 the installed copy measured 1,181 lines against
   main's 5,439.
3. **The only way to get it is to clone 36 MB of someone's personal monorepo**,
   including `MekWarLive`, `infra/handoff`, `infra/mac-account-swap`, and every
   plan and spec in `docs/superpowers/`.

## Scope

### In scope

Moving the product — the PWA and everything a Linux box needs to serve it —
into `ccrc-pwa`, with history preserved, the path coupling resolved, and all
three test suites green in the new location.

### Explicitly not in scope

Each of these is real work that belongs to a later spec. None of it happens
here, and a reviewer should reject this work if any of it appears:

- **No de-personalisation.** `FleetHostBanner.tsx:6` keeps saying "rp-llm".
  `README.md` keeps naming `server-box.tailnet-example.ts.net` and
  `you@203.0.113.7`. `agent/src/server.ts:58` keeps
  `DEFAULT_PROJECTS_ROOT = '/srv/projects'`. → Spec 1.
- **No account-model change.** The eight hardcoded wrapper sites stay
  hardcoded. → Spec 1.
- **No `ccd` portability seams.** The GNU-isms and `systemctl` calls stay
  exactly where they are. → Spec 1.
- **No auth.** Every route stays unauthenticated. → Spec 2.
- **No installer.** `deploy/deploy.sh` moves across unchanged and keeps
  rsync-ing to a hardcoded box. → Spec 3.
- **No deletion from the monorepo.** `infra/ccrc/` and
  `infra/ccrc-portability/` stay exactly as they are, and remain the
  source of truth for the live deployment throughout.
- **No deploy cutover.** Nothing deploys from `ccrc-pwa` in this spec.

### Access constraint

Because de-personalisation is spec 1, the repo contains the operator's tailnet
name, box IPs, username, and home paths when this spec completes. **No
colleague is granted access to `ccrc-pwa` until spec 1 has landed.** Access
stays limited to the repo owner until then.

## What moves

| From | To |
| --- | --- |
| `infra/ccrc/server/` | `server/` |
| `infra/ccrc/agent/` | `agent/` |
| `infra/ccrc/pwa/` | `pwa/` |
| `infra/ccrc/shared/` | `shared/` |
| `infra/ccrc/deploy/` | `deploy/` |
| `infra/ccrc/README.md` | `README.md` |
| `infra/ccrc-portability/ccd` | `ccd/ccd` |
| `infra/ccrc-portability/claude-session@.service` | `ccd/claude-session@.service` |
| `infra/ccrc-portability/statusline-command.sh` | `ccd/statusline-command.sh` |
| `infra/ccrc-portability/tmux.conf` | `ccd/tmux.conf` |

305 files: 300 under `infra/ccrc/{server,agent,pwa,shared,deploy}`, plus
`infra/ccrc/README.md`, plus the four `ccrc-portability` files below.
Roughly 4.4 MB of source, excluding `node_modules` and build output.

**Why each of the four `ccd/` files is not optional:**

- `ccd` — the server has no session logic of its own. It reads `ccd`'s
  flat-file registry under `~/.cc-sessions/` and drives its verbs through
  `ccdargv.ts`.
- `claude-session@.service` — `ccd:5250` starts sessions through this systemd
  template. Without it, `ccd enable` fails.
- `statusline-command.sh` — the **only** writer of `~/.cc-limits/<wrapper>.json`,
  which `server/src/limits.ts:59-113` reads, and whose exact glyph layout
  `server/src/pane/statusline.ts:1-16` screen-scrapes. Today it is an
  undocumented out-of-band dependency; here it becomes a declared part of the
  product. Absent it, ccrc silently loses model/effort/branch display without
  failing loudly.
- `tmux.conf` — referenced by `ccd`.

## What stays in the monorepo

The operator's personal tooling, none of which the PWA touches — verified by
grep: `pwa/src`, `server/src`, and `agent/src` contain **zero** references to
`ccclip`, Termux, Hammerspoon, `pngpaste`, or `mosh`. The single hit is
`agent/src/whitelist.ts:150`, which is a *denylist* forbidding `ssh`/`scp`/
`rsync`/`curl` from the agent's exec surface.

- `cc`, `cc-termux` — SSH/mosh attach wrappers (the PWA is the client)
- `ccclip`, `hammerspoon-init.lua` — Mac clipboard→box. The PWA's own path is
  `AttachButton.tsx` → `useAttachImage.ts` → `POST /api/sessions/:id/upload`
  (`server.ts:353`), which needs no Mac.
- `cc-compact-restore.sh`, `install-compact-hook.sh` — Claude Code workflow hook
- `docserver-server.py` — the Tailscale doc server, a separate tool
- `hardening.sh` — Hetzner CX53 OOM guardrails, box ops
- `infra/mac-account-swap/`, `infra/handoff/`

**`ccd`'s `clip` verb still moves.** It is one of the six subcommands the agent
whitelist permits, so the server drives it as part of the upload path. What
stays behind is the Mac-side *producer*, not the box-side receiver.

## Target layout

```
ccrc-pwa/
├── server/          # Fastify + TS ESM. Serves the PWA from dist-pwa/.
├── agent/           # WS service for split topology.
├── pwa/             # React + Vite. Builds into ../server/dist-pwa.
├── shared/          # agent-protocol.ts, api.ts — imported by server + agent.
├── ccd/             # The box-side half.
│   ├── ccd
│   ├── claude-session@.service
│   ├── statusline-command.sh
│   └── tmux.conf
├── deploy/          # Moves unchanged; spec 3 replaces it.
├── .github/workflows/ci.yml
├── .gitignore
└── README.md
```

The `infra/` prefix is a monorepo artifact and does not survive.

**`shared/` must stay a sibling of `server/` and `agent/`.** This is a hard
constraint, not a preference: `server/tsconfig.json:4-7` and
`agent/tsconfig.json:4-7` both declare `"rootDir": ".."` with
`"include": ["src/**/*.ts", "../shared/**/*.ts"]`, so each package compiles
`shared/` into its own `dist/` by reaching up exactly one level. The layout
above preserves that relationship; any nesting change breaks both builds.

**`shared/package.json` must not be touched.** Its `"//"` field documents a
load-bearing subtlety: the file exists solely so tsc's NodeNext resolver treats
`shared/*.ts` as ESM. Without it, tsc emits CommonJS into `dist/shared/` while
`server/` and `agent/` are `"type": "module"`, and the built server dies at
startup with "does not provide an export named".

## The coupling fix

This is the one code change in the spec, and it is mechanical.

**Today:** seven independent definitions of the path to `ccd`, each escaping the
package tree:

| File | Line |
| --- | --- |
| `server/test/ccdWsHelpers.ts` | 10 (exported as `CCD`) |
| `server/test/ccd-clip.test.ts` | 12 |
| `server/test/projected-home.test.ts` | 20 |
| `server/test/ccd-limits.test.ts` | 13 |
| `server/test/ccd-ws-reap.test.ts` | 128 |
| `server/test/ccd-ws-audit.test.ts` | 266 |
| `server/test/wsaudit.test.ts` | 8 (as `CCD_PATH`, spelled with `path.join` parts) |

**After:** one definition in `server/test/ccdWsHelpers.ts`, resolving to
`../../ccd/ccd` — inside the repo, which is the point. The other six import it.
`wsaudit.test.ts`'s `CCD_PATH` becomes an import of the same constant.

`server/test/single-definition.test.ts` already exists to enforce exactly this
class of invariant and gains a guard: no file outside `ccdWsHelpers.ts` may
contain a literal path to the `ccd` script.

### The one test that does not move

`server/test/ccd-ccclip.test.ts` (149 lines) references
`../../../ccrc-portability/ccclip` at line 30. It runs `ccclip` for real,
supplying `pngpaste`, `mktemp`, `scp`, and `ssh` as exported bash functions
because the script replaces `PATH` outright at its line 8 — a stub directory
would be discarded, whereas functions resolve before `PATH` and survive.

It is a good test of a tool that is not part of this product. **It stays in the
monorepo with `ccclip`.** The expected consequence is exact and must be
recorded rather than discovered: `ccrc-pwa`'s server suite has **one fewer test
file** (55 → 54) and correspondingly fewer test cases than the monorepo
baseline. Verification asserts this delta explicitly, so that a genuine loss
cannot hide inside it.

This leaves a consequence for the later cleanup phase, noted here so it is not
lost: when `infra/ccrc/` is eventually deleted from the monorepo,
`ccd-ccclip.test.ts` loses its harness and will need either a small home of its
own beside `ccclip` or a deliberate decision to drop it.

## History preservation

`git filter-repo`, retaining commits touching the moved paths. 411 of the
monorepo's 609 commits touch `infra/ccrc`; 115 touch `ccd`.

This matters most for `ccd`. Its commit messages carry the reasoning behind
guards whose purpose is not evident from the code — a future reader without
that history will delete them as dead weight. Starting fresh throws away the
single best defence against that.

Path rewriting happens as part of the filter so history is continuous across
the move: a `git log --follow` on `ccd/ccd` reaches back through
`infra/ccrc-portability/ccd`.

## Verification protocol

The move either preserved the code exactly or it did not. Every check below is
mechanical and fails loudly.

**Step 1 — capture the baseline before touching anything.** In the monorepo,
record: `sha256sum` of every file that will move; the pass/fail counts from
each of the three suites; `tsc --noEmit` exit status per package. Write it to a
file. A baseline captured *after* the move proves nothing.

The `ccd` anchor at time of writing:
`2bc6287b5e8a882168118c6977e148547e4b2c18278011b616c8b9b23aa42f7d`.

**Step 2 — content identity.** Every moved file's sha256 in `ccrc-pwa` must
equal its monorepo baseline. Exactly one line is permitted to differ:
`ccdWsHelpers.ts:10`, the sole remaining definition of the path to `ccd`. The
collapse of the seven ccd-path definitions to that one lands in the monorepo
*before* the move, not after, so the six former copy sites are not exceptions
here — they already import the shared constant, unchanged, and must match
their monorepo baseline byte for byte like everything else. A checksum
mismatch on any file other than `ccdWsHelpers.ts` fails the step. `ccd` — 331
KB, 5,439 lines — must match **byte for byte**. There is no judgement call
available here: it either moved intact or it did not.

**Step 3 — suites green in the new location.** All three run from inside their
own package using the local binary (`./node_modules/.bin/vitest`,
`./node_modules/.bin/tsc`), never `npx`. `npx vitest` resolves to a global
cache copy with no `jsdom` and falsely reports "no tests" alongside 39 errors.

Expected counts, against the measured baseline in the appendix: `server/` **54**
(55 minus `ccd-ccclip.test.ts`), `agent/` **13**, `pwa/` **40**. Test-case
counts must equal the baseline minus exactly the cases in
`ccd-ccclip.test.ts`, which are counted at baseline so the subtraction is
checked rather than assumed.

Two counting subtleties will otherwise produce false alarms, and both were hit
while measuring the baseline:

- `server/` holds **56** test files on disk. `vitest.config.ts:2` includes only
  `test/**/*.test.ts`, so `test-e2e/session.e2e.test.ts` is excluded from the
  default run to keep it hermetic — it is gated on `CCRC_BASE_URL` and drives a
  live session. It still moves with `server/`; it simply never runs in CI.
- `pwa/` reports **40** files from **39** on disk. `vite.config.ts:85` sets
  `typecheck: { enabled: true }`, so the `*.test-d.tsx` type-level suite counts
  as an additional entry. A naive `find` for `*.test.ts`/`*.test.tsx` misses it.

**Step 4 — typecheck.** `tsc --noEmit` clean in `server/`, `agent/`, and `pwa/`.
`pwa/` has `noUncheckedIndexedAccess: true` and typechecks `test/`.

**Step 5 — the PWA actually builds.** `npm run build` in `pwa/` must produce
`server/dist-pwa`. This is checked because `deploy.sh` never builds the PWA and
a stale bundle is invisible to every other signal in this list — the exact
failure that shipped a Jul 29 bundle on Aug 2 behind a green deploy and a green
`/health`.

**Step 6 — the live fleet is untouched.** Nothing deploys from `ccrc-pwa`.
Confirm afterwards that the 11 sessions are intact and the installed `ccd`
still reports its verbs through `ccd caps`.

## CI

`ccrc-pwa` gets `.github/workflows/ci.yml` on day one. The monorepo has no CI at
all (`.github/workflows/` does not exist), and the three suites have only ever
been run by hand.

The workflow runs the three suites and the three typechecks on push and PR. It
is the mechanism that keeps the extraction honest afterwards: without it,
"green at extraction time" decays silently.

Adding CI is not a behaviour change to the product — no shipped file changes —
so it stays inside this spec's no-behaviour-change constraint.

## Risks

**A hand-copy drops a file.** 300 files move. Mitigated by step 2: sha256 over
the complete baseline manifest, not a spot check.

**`git filter-repo` mangles paths.** Mitigated by step 2 plus a
`git log --follow` check on `ccd/ccd` reaching back past the rename.

**Node modules.** All four packages currently have real `node_modules`
directories in this checkout, but worktrees under `ccrc-wt/` use symlinks into
the monorepo. The new repo does a clean `npm ci` per package; `node-pty` is a
native addon and needs a working build toolchain.

**The live deployment.** Lowest risk in the spec, because nothing deploys.
`infra/ccrc/` remains the deploy source until spec 3.

## Roadmap

| Spec | Removes the reliance on… |
| --- | --- |
| **0 — Extraction** (this document) | code living outside the product |
| **1 — Config & de-personalisation** | *this* operator's box, paths, accounts, and tailnet; plus portability seams in `ccd` so a later Windows/macOS port swaps a handful of helpers rather than re-auditing 5,439 lines |
| **2 — Auth** | the network being the only thing between a colleague and your sessions. One `resolveIdentity(req) → user \| null` seam through which every route and both WS endpoints pass, failing closed. Tailscale's forwarded identity header is the only implementation in v1; a later OIDC or bearer implementation slots in behind the same seam without touching a route. |
| **3 — Install & update** | a human correctly following a README with ~15 manual steps |

Tailscale remains a requirement after spec 2, and auth does not change that.
It supplies three things and auth replaces only the third: reachability through
NAT to a laptop or VPS; TLS with a genuinely trusted certificate, without which
the service worker will not register and the PWA will not install to a home
screen; and identity. What spec 2 buys is that a misconfigured tailnet ACL
stops being the only thing standing between a colleague and every session on
the fleet.

The definition of done for spec 3, and therefore for the programme, is a
**clean-room install**: a fresh Linux container with a base OS only, the
installer, and a real session driven from the PWA. Anything the installer did
not put there is a missing dependency. It is an executable test, so it cannot
be satisfied by a green signal that nobody measured.

Monorepo cleanup — deleting `infra/ccrc/` and the moved
`infra/ccrc-portability/` files — happens after spec 3, once `ccrc-pwa`'s
install path has been proven on the operator's own box.

## Appendix — measured baseline

Captured `2026-08-03T11:23Z` on the monorepo at `f73ab41`, running each package's
own `./node_modules/.bin/vitest run` and `./node_modules/.bin/tsc --noEmit`.

| Package | Test files | Tests | tsc |
| --- | --- | --- | --- |
| `server/` | 55 run (56 on disk) | 1099 passed | exit 0 |
| `agent/` | 13 | 204 passed | exit 0 |
| `pwa/` | 40 (39 runtime + 1 type-level) | 903 passed | exit 0 |
| **Total** | **108 run** | **2206 passed** | — |

`ccd` sha256: `2bc6287b5e8a882168118c6977e148547e4b2c18278011b616c8b9b23aa42f7d`

This is an anchor for orientation, not a substitute for step 1. The
implementation captures its own baseline immediately before extracting, because
these numbers will have moved by then and a stale figure silently weakens every
check that depends on it.

One observation worth recording, since it looks alarming in a raw test log and
is not: the server suite emits `* [new branch] ws/quiet-basin -> ws/quiet-basin`,
which is `git push` output. It is contained. `ccdWsHelpers.ts` builds a local
bare repository as the fixture `origin` and the ccd worktree tests push to
that; `git ls-remote --heads origin` on the real remote confirms no such branch
exists. Anyone auditing a future run will see the same line and should not
re-investigate it.
