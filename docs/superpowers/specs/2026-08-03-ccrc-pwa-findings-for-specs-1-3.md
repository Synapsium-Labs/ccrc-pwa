# Findings carried out of spec 0, for specs 1–3

Recorded 2026-08-03, at the close of the extraction. These surfaced *during*
execution rather than during design, and none belongs to spec 0 — its defining
constraint was zero behaviour change. Each is written so a later spec can act on
it without re-deriving it.

## 1. Capability capture is a boot-time snapshot — spec 3

**Severity: this shipped a dead feature for 14 hours and every signal said green.**

`agent/src/server.ts:417` reads `ccd caps` **once**, at agent start, outside the
connection handler, and hands that frozen array to every subsequent connection
(`:340`). `shared/agent-protocol.ts:7` documents the intent — "what `ccd caps`
printed on the AGENT's box at start" — but not the hazard.

**Measured on 2026-08-02:** `ccrc-agent` started at 23:42:50; the new `ccd` was
installed at 23:44:43. **113 seconds too late.** For the next fourteen hours the
agent advertised the *old* 1,181-line binary's verb list while the correct
5,439-line one sat on disk beside it. The PR feature was fully deployed and
completely unreachable; the PWA said "the fleet host is running a ccd that does
not have this verb yet" and was telling the literal truth about what the agent
had told it.

Everything that could have caught it was green: `deploy.sh` exited 0, `/health`
returned `{"ok":true}`, and `ccd caps` run by hand on the box listed every verb
correctly. Fixed by restarting `ccrc-agent`.

**Requirement for spec 3's installer:** either capability capture must stop being
a boot-time snapshot (re-read on each connection, or on a cheap mtime check), or
the install order must be *enforced by the installer* rather than remembered by
the operator. A comment in a README is not a mechanism.

**This is the third instance of the same class on this branch.** The first was a
`deploy.sh` that never builds the PWA (a Jul 29 bundle served for four days
behind a green deploy). The second was a `deploy.sh` that never ships `ccd` (the
installed copy 4,258 lines behind main). All three share one shape: **a green
signal standing in for a measurement nobody took.**

## 2. `ccd`'s merged-check depends on a ref that newer git populates differently — spec 1

`_ws_gc_merged` (`ccd/ccd`, ~line 4640):

```bash
base=$(git -C "$main" symbolic-ref --quiet refs/remotes/origin/HEAD) || return 1
git -C "$main" merge-base --is-ancestor "refs/heads/$branch" "$base" 2>/dev/null
```

Probed directly on git 2.43.0, replicating the test fixture's setup (`git init
--bare -b main`, `git init -b main`, commit, `remote add`, `push -u`):
**`refs/remotes/origin/HEAD` does not exist after `push -u`.** So on 2.43 that
ref is absent unless something else creates it, and the function returns
`unprovable`.

The whole design of `ws-gc` is that every ambiguous case resolves toward doing
nothing. That is sound — but the *ambiguity detection itself* hinges on a ref
whose population has changed across git versions, so the same repository can take
a different code path and produce a different refusal on a different machine,
silently. For a tool being handed to colleagues on assorted distros, that
matters.

**Not established:** the precise git version where the behaviour changed. Pinning
it needs a git ≥2.46 to bisect against.

## 3. A fixture race in the server suite, under parallel execution only — spec 1

Observed once on merged `main` (1 failed / 1109 passed), and not reproducible in
isolation — the suspect test passes 5/5 standalone. The error:

```
IsADirectoryError: [Errno 21] Is a directory:
  '/tmp/ccrc-ccd-prstate-4hGnNR/.cc-sessions/demo-quiet-basin.prnumber'
```

Something creates a **directory** where `.prnumber` is expected to be a file.
Only manifests under the full parallel suite, which points at fixture-name
collision or a race between concurrently-running ccd tests sharing a session
slug (`demo-quiet-basin` appears in several files).

A separate intermittent failure was seen once on a GitHub runner in
`ccd-ws-gc.test.ts > lists the ignored entries it is about to destroy`, and
reproduced locally three times (fail, fail, pass) by an independent reviewer.
Whether these are the same underlying race is unresolved.

**Neither blocks anything today**, but a flaky test in the *deletion* path is the
worst place to have one: it trains the reader to discount a red suite in exactly
the code where a red suite matters most.

## 4. Two repos now hold the same code, and they drift — spec 1/3 sequencing

`infra/ccrc/` in this monorepo and `example-org/ccrc-pwa` contain the same
product. The monorepo remains the live deploy source until spec 3.

This drift is not theoretical: within an hour of the extraction, a review fix
wave landed monorepo-only and had to be ported by hand, because the better test
coverage had been added to the copy scheduled for deletion.

**Any ccrc change must land in both until `infra/ccrc/` is deleted.** That is a
real argument for moving through specs 1–3 without a long pause, rather than
running two copies in parallel indefinitely.

## 5. The repo is readable by 61 people — spec 1, operator-accepted

`example-org` sets `default_repository_permission: read`, so all 61 org
members can read `ccrc-pwa` despite `visibility: private` (0 direct
collaborators, 0 outside — every one inherited). The tree currently carries the
operator's tailnet name, box IPs, username, and home paths across **9 files, 20
hits** — `deploy/ccrc.service`, `deploy/deploy.sh`, `deploy/notify.sh`,
`server/src/inject/send.ts`, `README.md`, and tests.

Material because ccrc has **no authentication** — that is spec 2 — so the address
is the entire guard. The operator ruled on 2026-08-03 that those 61 are not a
risk, tailnet ACLs being theirs to know. Recorded because spec 1's
de-personalisation is what actually removes the information, and this is the
concrete reason it matters rather than a tidiness argument.

## 6. Smaller items

- **`refuses an unrecognised tree`** (`server/test/extraction-manifest.test.ts`)
  asserts only `toThrow()`. It would pass if the script were absent entirely.
  Low impact — five sibling tests invoke the script successfully — but it does
  not pin the exit code or stderr.
- **The manifest instrument is blind to additions.** Monorepo mode walks
  `infra/ccrc` recursively; standalone mode walks a fixed directory allowlist. A
  file existing only in the extracted repo, outside that allowlist, is never
  hashed. Documented in the script header as of `d2c4ba0`; worth revisiting if
  the layout grows a new top-level directory.
- **File modes are outside the manifest.** If `ccd` or a `.sh` lost its `+x` bit
  during the move, both manifests would compare equal. `git filter-repo`
  preserves modes and nothing in either repo invokes these files directly, so
  exposure is small — but a one-off `git ls-files -s` comparison between the two
  repos is cheap insurance.
- **No `engines` field** in any of the four `package.json` files, despite Node
  ≥22 being a hard requirement documented only in prose. Spec 3's prereq check.
