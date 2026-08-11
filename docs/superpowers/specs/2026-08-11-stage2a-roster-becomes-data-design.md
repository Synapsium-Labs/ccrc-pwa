# Stage 2a — the account roster becomes data

> Part of the ccrc OSS single-dev infrastructure workstream. Parent spec:
> `2026-08-11-ccrc-oss-single-dev-infra-design.md`. Stage 1 (repo rebuilds a
> box) shipped as PRs #33/#34 and is live on both boxes.

## Why this is its own stage

The parent spec's stage 2 bundles two unrelated risks under one label:

1. **The roster becomes data** — touches eight modules across three languages,
   widens a core type, and is where a wrong schema is expensive to undo.
2. **The installer, CLI and doctor** — mostly new files, low blast radius,
   and it *consumes* the output of (1).

(1) is a hard prerequisite for (2): the installer's job is generating account
wrappers from the roster, so there is nothing to generate until the roster
exists as data. Splitting them lets the risky half get its own review, and
lets the installer be designed against a schema that is already proven against
a real box rather than one still being argued about.

This spec is 2a. Everything in the parent spec's stage 2 that is not the
roster — `ccrc install`/`doctor`/`status`, the single-box installer, the
`CCRC_PROJECTS_ROOT` reconciliation, `CCRC_REMOTE_CONTROL`, and the first-run
spawn fixes — is 2b and unchanged by this document, with one exception noted
under **Carried into 2a** below.

## Decisions (locked with the owner, 2026-08-11)

| Question | Decision | Why |
|---|---|---|
| Account identity | **Free-form ids** — a user names accounts whatever fits (`work`, `personal`, `oss`) | The OSS goal is the best solo-dev experience; nobody should inherit one operator's `claude2`/`claude-corp` naming. The closed `Wrapper` union buys one compile-time check that stops meaning anything once there is no hand-typed union to add to |
| Existing hand-built boxes | **`ccrc adopt` is read-only in 2a** — it writes `accounts.json` and nothing else | Adoption is the schema's best test; in-place convergence of a live production fleet waits for stage 4, where update and rollback exist |
| CLI surface | `install`, `adopt`, `doctor`, `status` — of which **only `adopt` lands in 2a**; the other three are 2b | Adding an account is `edit accounts.json` + re-run `install`, reusing idempotent convergence rather than building a second path that must stay in sync |
| Roster failure posture | **Refuse to boot**, with a named remedy, in both the server and ccd | Follows stage 1's `assertProjectsRootIsSafe` precedent. A silently-empty roster is exactly the failure that killed chat for six `claude-dev0` sessions |

## What the disk actually contains

The schema is shaped by three facts established by reading the live box, not
by preference:

- **`~/.local/bin/claude` is not a wrapper.** It is the Claude Code binary
  itself — 304,282,632 bytes of ELF. ccrc must never generate, overwrite or
  back it up.
- **Three accounts are trivially generatable.** `claude2` (336 bytes),
  `claude-corp` (102 bytes) and `claude-dev0` (340 bytes) are the same four-line
  shape: set `CLAUDE_CONFIG_DIR`, optionally source
  `~/.cc-secrets/<id>-oauth.env`, `exec` the binary.
- **One account is bespoke and must be left alone.** `gpt` (7,800 bytes) is a
  hand-written launcher that manages a LiteLLM proxy and Codex OAuth. ccrc
  must know it exists — to rank, label and color it — and must never write it.

## Design

### 1. `~/.ccrc/accounts.json`

```json
{
  "version": 1,
  "accounts": [
    { "id": "claude",  "label": "team·max", "configDirSuffix": ".claude",
      "exec": { "kind": "upstream" },
      "homeAble": true,  "hue": "cyan",    "telemetry": "anthropic" },

    { "id": "claude2", "label": "alt·max", "configDirSuffix": ".claude-personal",
      "exec": { "kind": "generated", "secretsFile": ".cc-secrets/claude2-oauth.env" },
      "homeAble": true,  "hue": "violet",  "telemetry": "anthropic" },

    { "id": "gpt",     "label": "gpt",      "configDirSuffix": ".claude-gpt",
      "exec": { "kind": "external" },
      "homeAble": false, "hue": "magenta", "telemetry": "none" }
  ]
}
```

`exec.kind` is the discriminator the disk forced on us:

- `upstream` — the Claude Code binary itself. Exactly one per roster. Never
  written, never generated, never backed up.
- `generated` — ccrc owns this file end to end. `secretsFile` is optional and
  relative to `$HOME`.
- `external` — a user-provided executable. ccrc records the account so it can
  be ranked, labelled and colored, and touches the file never.

Shipped default for a fresh install is a single account: `claude`, upstream,
`.claude`, home-able, cyan, anthropic telemetry.

### 2. Derived, never stored

Four of today's seven `AccountDef` fields leave the schema because they are
computable, and computing them removes a class of hazard:

- **`idPrefix`** is always `<id>-`. Deriving it makes the arm-order hazard
  structural: the generator emits case arms sorted by **descending id length**,
  so `claude-dev0-*` cannot land after `claude-*`. Today that ordering is
  protected by a comment asking maintainers not to reorder.
- **The disable file** is `~/.cc-sessions/<id>-disabled`. Today's
  `GPT_DISABLE_FILE` already matches that pattern exactly.
- **`ccdValid`** is true for all five accounts since `claude-dev0`'s
  promotion, and collapses to "every account in the roster".
- **`hooksAble`** is true for all five, and both install scripts already skip
  a home whose directory is absent, so the flag buys nothing.

Also derived: the wrapper path (`~/.local/bin/<id>`), the config dir
(`$HOME/<configDirSuffix>`), and the hooks/skill install target (the config
dir).

### 3. Two new fields

**`hue`** replaces `colorVar`, because a free-form id cannot name a hand-tuned
CSS token. `pwa/src/styles/tokens.css` renames its account hues to colors —
`--acct-cyan`, `--acct-violet`, `--acct-blue`, `--acct-magenta` — keeping every
measured light/dark contrast value as-is, and gains two more (`amber`, `green`)
for headroom. **The two new hues need their contrast ratios measured against
their tints in both themes, not guessed**: every existing entry in that file
carries a measured ratio, and a seventh account is not a reason to break that.

Auto-assignment is next-free-hue by roster position, and the rule lives in the
shared parser so that every writer — the migration, `adopt`, and 2b's installer
— agrees. Past six accounts the palette cycles rather than falling back to
neutral, and doctor warns on the collision; two accounts sharing a hue is a
cosmetic problem, an account rendered in status-colored ink is a legibility
one. This also de-brands the tokens, which the parent spec had as a stage-5
chore.

Two aliases must be read before editing rather than swept: `--acct-active` /
`--acct-active-tint` (the rebinding mechanism components actually style
against) and `--pr-merged`, which deliberately aliases the violet hue.

**`telemetry`** (`anthropic` | `none`) exists because `limits.ts` conflates
*unmeasured* with *zero used*, and an account scored 0 wins every placement.
Both halves are mechanically confirmed against the current tree:
`projectHome({claude:5, claude2:6, 'claude-corp':7})` returns
`{wrapper:'claude-dev0', score:0}` — an account with no telemetry row at all —
and an account shaped like `{five: null, seven: 0}` behaves identically.

Two corrections to the earlier framing of this bug. `gpt` **does** write
`~/.cc-limits/gpt.json`; its content is `{"five": null, "seven": 0, …}`, so the
distinguishing fact is a permanently null `five`, not an absent file. And
nothing is misplaced in production today: `claude-dev0` reports real telemetry
(12/4 at the time of writing), so it is scored honestly, and the only
structurally-unmeasurable account, `gpt`, is kept out of scoring by
`homeAble: false` rather than by anything to do with telemetry.

The fix therefore has two parts, and the second one matters more than the
first:

1. An account with `telemetry: 'none'` is never scored.
2. An `anthropic` account with no measurement must rank as **unknown**, not as
   zero — the distinction `pwa/src/fleet/SwapSheet.tsx:72-73` already draws,
   and which `limits.ts` and ccd's `_ws_least_loaded` (ccd:1005,
   `[[ -z "$sc" ]] && sc=0`) both currently collapse.

**Unknown must not mean unplaceable.** On a fresh install no account has
telemetry yet, so excluding unmeasured accounts outright would leave
`projectHome` returning null and the PWA reporting that nothing can take a new
workspace — breaking the exact first-run path this workstream exists to make
work. The rule is: prefer measured accounts; if none are measured, fall back to
the first home-able account in roster order. ccd's `_ws_least_loaded` gets the
same treatment in the same commit, since `server/test/projected-home.test.ts`
asserts the two implementations agree per fixture.

### 4. Validation and failure posture

- `id` matches `^[a-z][a-z0-9-]{0,31}$` and is unique across the roster. The
  id becomes a filename, a bash `case` pattern and a session-id prefix, so the
  charset is deliberately narrow.
- `configDirSuffix` begins with `.`, contains no `/` and no `..` — it is
  joined to `$HOME`.
- Exactly one account has `exec.kind === "upstream"`.
- `hue` is a known hue name or absent (auto-assigned).
- Unknown *fields* **warn**, never fail, for forward compatibility. An unknown
  `version`, by contrast, **fails**: a file written by a newer ccrc may mean
  something different by a field this build thinks it understands, and guessing
  is how a roster silently loses an account.

A roster that fails validation **refuses to boot**, in both the server and
ccd, naming the offending account and the remedy. A malformed file must never
yield a silently-empty roster.

### 5. Ownership — how a writer avoids doing damage

2a ships the **marker format** and its verifier. It does **not** ship the path
classifier or the manifest writer: 2a's only writer is `deploy.sh`, which is
bash, so those two would be code with no caller until 2b's installer exists.
They land in 2b alongside the thing that calls them. (Revised during planning —
the earlier version of this section put all three in 2a.)

In 2a the only newly generated file is `accounts.sh`, with `ccd` gaining a
marker since deploy.sh already installs it. 2b's installer brings the generated
wrappers, units and drop-ins under the same rules without inventing a second
policy.

One rule underneath everything: **a writer writes, skips, or refuses. It never
deletes.** Deletion requires a rollback story, which arrives in stage 4 with
`update`/`uninstall`.

Every file falls into one of three classes, and the class picks the verb.

**ccrc-owned.** Carries a provenance marker as its second line:

```
# ccrc:generated 1 sha256=<hash of the body below this line>
```

On re-run the writer recomputes the hash. Marker present and matching → ccrc
wrote it and nobody has since → overwrite freely. Marker present, hash
differs → the user edited it → **skip**, and doctor names the file. No marker →
foreign → **never touch**, and doctor raises an error. The marker lives in the
file, not only in a manifest, so provenance survives a rebuild or a copy.

Covers, in 2a: `~/.ccrc/accounts.sh` and `ccd`. In 2b: the generated wrappers,
the systemd units and the drop-ins.

**User-owned.** `~/.ccrc/ccrc.env`, `~/.ccrc/accounts.json`, anything under
`~/.cc-secrets`. Create-if-missing. On an existing file a writer may only
**add absent keys with their defaults** — never rewrite a value, reorder, or
reformat — and backs up first into the `~/ccrc-backups/` mechanism PR #28
already built.

**Foreign.** Written never: `~/.local/bin/claude` (the binary), every
`external` account's executable, and Claude's own `settings.json`, which is
*merged into* by the existing hook installers rather than written.

### 6. `~/.ccrc/manifest.json`

**Deferred to 2b** (revised during planning). The manifest records every path a
ccrc writer touched, its ownership class, its hash, and — for `settings.json` —
the exact entries ccrc added. Its author is the installer, which does not exist
until 2b; 2a's only writer is bash. The reasoning for having it at all is
unchanged and still applies at 2b:
It is written anyway because provenance is free at the moment you have it and
unreconstructable afterwards, and because the parent spec names the exact
failure it prevents: today a declined trial leaves every Claude session
shelling to a deleted hook script, since the inverse operation has never
existed. Stage 4's uninstall either has this record or guesses.

### 7. ccd's bash projection

The generator emits `~/.ccrc/accounts.sh` — written by `deploy.sh` and the
migration in 2a, by `ccrc install` from 2b onward:

```bash
#!/usr/bin/env bash
# ccrc:generated 1 sha256=…
CCRC_ACCOUNTS=(claude claude2 claude-corp claude-dev0 gpt)
CCRC_HOME_ABLE=(claude claude2 claude-corp claude-dev0)
_ccrc_cfg_dir()    { case "$1" in claude-dev0) echo "$HOME/.claude-dev0";; … esac; }
_ccrc_id_wrapper() { case "$1" in claude-dev0-*) echo claude-dev0;; claude-corp-*) …;; claude-*) …;; esac; }
```

Case arms are emitted in **descending id length**, making the ordering
invariant a property of the generator rather than of a maintainer's care.

This replaces four hardcoded ccd surfaces — `VALID_WRAPPERS` (ccd:14),
`_is_valid_wrapper` (ccd:104, which also hardcodes `gpt`), `_cfg_dir`
(ccd:6526-6534) and `_id_wrapper` (ccd:6658-6674) — plus the hardcoded
`homes=(…)` defaults in `install-session-hooks.sh:25` and
`install-coordinator-skill.sh:34`.

`VALID_WRAPPERS` has **more consumers than those four**, and all of them move
in the same commit: `_ws_least_loaded` (ccd:1003), `cmd_ws_add`'s
all-excluded preflight (ccd:1053), and `_default_pool` (ccd:6558), which uses
`"${VALID_WRAPPERS[*]}"` — a space-joined *string* consumed by `_swap_target`
(ccd:6709) through an unquoted `for cand in $(_pool_for "$id")`. Free-form ids
are safe there only because the id charset excludes whitespace; that is now a
load-bearing reason for the charset rule in §4, not merely a tidiness one.

Today's `_id_wrapper` arms are **not** strictly length-descending —
`claude-corp-` and `claude-dev0-` are both 12 characters, and `claude2-` (8)
precedes `claude-` (7) by hand-authoring luck. The order is correct but by a
weaker accident than "sorted". A golden-file comparison against today's text
would therefore fail against a correctly-sorted generator: the test must assert
*behaviour*, never the literal arm order.

**The path is derived from `$HOME` with no env override**, matching ccd's
existing discipline (its own header comment: `$HOME` is the single isolation
boundary the test harness sets, and a stray `Environment=` would point unit
tests at real repos). A test that relocates `$HOME` therefore gets the test's
roster for free.

**A missing `accounts.sh` makes ccd die** with a named remedy, rather than
falling back to a built-in default. A fallback would mean a box quietly running
a roster that does not match its accounts — the `claude-dev0` failure exactly.
ccd already dies this way for a missing python3.

The cost is an ordering constraint with teeth: `accounts.sh` must land
**before** ccd is replaced, or every ccd invocation in the gap dies while the
deploy is restarting supervisors. `agent/test/deploy-verify.test.ts` already
pins step ordering (that is how `stamp_build`'s position between build and
restart is enforced), so this is one more assertion in an existing place.

### 8. TypeScript surface

The agent does not reference the roster at all. The blast radius is five
TypeScript files, three bash files and one stylesheet.

- **`shared/api.ts`** — keeps `Wrapper` (widened to a documented `string`
  alias, so the type's 35-line docstring stays put; the identifier occurs 34
  times but in *type position* in only three non-test files — `shared/api.ts`,
  `server/src/config.ts`, `server/src/fleet.ts`) and **exports** `AccountDef`,
  which is a bare `interface` today and must gain `export` for `parseRoster`'s
  return type; gains a **pure** `parseRoster(json)` (pure because `shared/`
  may not import `node:*`, so the caller reads the file); loses `ACCOUNTS`,
  `ALL_WRAPPERS`, `HOME_ABLE_WRAPPERS`, `ACCOUNT_ORDER` and `KNOWN_WRAPPERS`,
  which become functions of a roster.
- **`server/src/config.ts`** — `loadConfig` reads `accounts.json`;
  `configDirFor` takes the config rather than a bare home.
- **`server/src/limits.ts`, `server.ts`, `fleet.ts`** — swap the three imported
  constants for roster lookups. `fleet.ts`'s `idHomeWrapper` keeps
  longest-prefix-wins, sorting by id length, and falls back to the **upstream
  account's id** rather than the literal `'claude'`.
- **`pwa/src/lib/accounts.ts`** — reads the roster from the store instead of
  the import.

This is smaller than it sounds because **`isWrapper` is already the only
narrowing gate in the codebase and every boundary already handles an unknown
wrapper** (`configDirFor` returns `undefined`; `rank()` sorts unknown last
rather than hiding; the PWA falls back to the raw name and neutral ink;
`SessionRecord.wrapper` is an untrusted string read off disk). Widening the
type therefore breaks compilation in exactly the `Record<Wrapper, …>`
positions — one field on `CcrcConfig` plus the three derived lists.

### 9. The wire and the PWA

The PWA is a compiled bundle and can no longer have the roster compiled in, so
`GET /api/accounts` grows a `roster` field alongside today's
`{ accounts, projected }`: `[{ id, label, hue, homeAble }]`.

No loading state is required. The PWA's existing unknown-wrapper fallbacks —
raw name for the label, `--ink-tertiary` for the color — mean an
asynchronously-arriving roster degrades gracefully rather than flashing wrong
values.

### 10. The roster in two-box (remote) mode

In `fleetMode: 'remote'` the server runs on one box and the accounts live on
another — server-box has no Claude accounts at all, while openclaw has five. But
`GET /api/accounts` serves labels, hues and ordering, which are facts about the
*fleet host*.

**`deploy.sh` writes `accounts.json` to both boxes in the same run**, from the
same operator machine, exactly as it already does for ccd, the units and
`ccrc.env`. There is one source of truth — the operator's file — and two
deployed copies kept equal by the thing that writes both. `ccrc doctor` (2b)
compares them and goes red on divergence.

Rejected: having the server fetch the roster from the agent. It is
conceptually cleaner, but it costs a protocol change inside the stage already
widening a core type, plus a degraded mode — the server must still render
labels and hues while the agent is down, which is exactly when the UI most
needs to stay readable. Stage 4's version-skew handshake can carry the roster
later at no extra cost.

Consequence for `loadConfig`: it reads `accounts.json` from the **local** box
unconditionally, in both fleet modes, via `readFileSync`. It must stay
synchronous — `server/src/index.ts:21` calls `loadConfig()` at module top level
with no await.

### 11. `adopt` versus the migration — two different things

Conflating these would cost the reference installation its labels.

**`ccrc adopt`** rediscovers accounts from disk: a non-script
`~/.local/bin/claude` is `upstream`; scripts matching the generated shape are
`generated`, with their config dir and secrets file read back out; any other
executable that sets `CLAUDE_CONFIG_DIR` is `external`. Cross-checked against
`~/.claude*` directories, `~/.cc-limits/*.json` and the session registry. It
cannot invent `team·max`, so it writes id-as-label and says so. It writes
`accounts.json` and nothing else.

**The migration** is separate and exact: the same commit that removes
`ACCOUNTS` from `shared/api.ts` emits those five entries verbatim as the
initial `accounts.json` for the existing boxes. The reference installation
keeps its labels, and `adopt` still gets tested independently against the same
box.

### Carried into 2a

`shared/api.ts`'s roster docstrings now contradict the roster: after the
`claude-dev0` promotion they still state the account "is not ccd-valid", that
`ccdValid` "is false", and that `HOME_ABLE_WRAPPERS` is "the three accounts",
while the data says ccd-valid, home-able, and four. These comments are
load-bearing — they are what a maintainer reads before touching arm order — so
they are corrected here rather than carried into the new file as stale prose.

## Testing

**The cross-language fixture test gets stronger.** Today
`server/test/wrapper-roster-fixture.test.ts` compares two hand-written lists,
so it can only catch a literal drifting. The replacement generates
`accounts.sh` from a fixture roster, **sources it in a real bash subshell**,
and asserts that for every account `_ccrc_cfg_dir <id>` matches what the
TypeScript computes, and for every synthetic `<id>-<slug>` that
`_ccrc_id_wrapper` agrees with `idHomeWrapper`. It runs against an adversarial
fixture whose ids are strict prefixes of one another (`a`, `a-b`, `a-b-c`),
proving the ordering property rather than trusting it — the bug class that
actually bit.

Other required coverage: schema validation rejects each invalid case by name;
refuse-to-boot fires in both the server and ccd; the ownership classifier
overwrites a matching-marker file, skips an edited one, and refuses an unmarked
one; `deploy-verify` pins `accounts.sh` landing before ccd.

## Proof gates

In order:

1. Generator round-trip green, including the prefix-collision fixture.
2. A malformed `accounts.json` refuses to boot in the server **and** in ccd,
   each with a named remedy.
3. The migration file reproduces today's five accounts verbatim; the full
   suite passes unchanged.
4. `ccrc adopt` on openclaw independently rediscovers those same five from
   disk alone — `claude` upstream, `gpt` external, three generated, with
   `claude2` and `claude-dev0`'s secrets files correctly attributed.
5. Both boxes deploy; `/health` reports the shipped sha; `claude-dev0` still
   resolves; no live session loses its account.

## Risks and mitigations

- **Deploy ordering.** `accounts.sh` after ccd would kill every ccd invocation
  during the supervisor sweep. Mitigation: an assertion in `deploy-verify`
  beside the existing `stamp_build` ordering check.
- **Losing the compiler during the refactor.** Widening `Wrapper` removes
  type-level help mid-change. Mitigation: the break set is enumerable (§8) and
  `isWrapper` remains the runtime gate, so the change is a list, not a search.
- **Hue rename touching more than tokens.css.** Mitigation: `--acct-active`
  and `--pr-merged` are read before editing, never swept.
- **`adopt` mis-classifying a bespoke launcher as generated.** Mitigation:
  classification requires a full shape match, not a substring; anything
  ambiguous is `external`, which is the safe direction — ccrc then never
  writes it.

## Out of scope (2b and later)

`ccrc install` / `doctor` / `status`; the single-box installer; the
`CCRC_PROJECTS_ROOT` reconciliation across ccd, the agent and the server's
`/data/projects` default; `ccclip`'s hardcoded `BOX=`; `notify.sh`'s fallback
IP; `CCRC_REMOTE_CONTROL`; first-run spawn fixes. Auth (3a), exposure (3b),
releases and update (4), OSS polish (5) are unchanged by this spec.

## References

- Parent spec: `docs/superpowers/specs/2026-08-11-ccrc-oss-single-dev-infra-design.md`
- Stage 1 (shipped): PRs #33/#34 — build identity, EnvironmentFile cutover,
  repatriated fleet-host artifacts, `resolveProjectsRoot`
- The roster's own history: `shared/api.ts:1199-1356`, and the `claude-dev0`
  incident it documents
