# Auth-dead marker outlives a clean spawn — Plan

> **For agentic workers:** a single-task fix, done in one commit. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a clean spawn on an account whose credential is dead no longer wipes that account's auth-dead
marker, so a session rescued off a 401 is not sent back to the dead account; and a real re-login still
revives the account, on Linux and macOS, without a spawn and without the probe.

**Background, measured 2026-09-28** (fixture HOME on the tree's ccd; Claude Code 2.1.280 in a private tmux
socket against a mock that answers 401 to everything):

- `_spawn_settle` rc 0 runs `rm -f "$REG/$id.stopped" "$REG/$wrapper-authdead"` (`ccd/ccd:20321`), on the
  argument that "a TUI that came up on `$wrapper` is proof that account's credential authenticates". That
  premise is false on 2.1.280: with a dead OAuth token the pane shows `❯` and `? for shortcuts · ← for
  agents`, which `_accept_first_run_prompts` reads as rc 0 (`ccd/ccd:19407`). Claude Code swallows its one
  startup 401 and writes no transcript row until the first turn.
- The loop, replayed end to end: a rescue off a 401 writes `claude-authdead` (`rescue-401`) and moves S to
  `claude-a`; while it stands, `_swap_target`'s home-recovered arm refuses `claude`; a clean spawn of any
  other session on `claude` wipes it; the next home decision returns S to `claude`, whose redrive 401s, and
  S is rescued again. One bounce per wipe, per rescued session homed on the account (7 of 22 live sessions
  share one wrapper on this box). ~1,650 rc-0 spawns since 2026-08-22, so wipe opportunities are frequent.
- The rc-0 clear is owner 2 of `docs/superpowers/specs/2026-09-07-account-health-and-provenance-design.md`
  §A.6 ("each of which is evidence"). By the spec's own rule it is no longer evidence.
- What a revival leaves behind: every re-login path ccrc knows rewrites the lane's credential FILE with a
  tmp + `mv -f` (`ccd-account-auth`'s `_auth_write_secret`, `ccrc account credential`'s `_acct_write_secret`),
  which moves its inode and ctime; a hand edit or a restore from backup (`cp -p` backdates mtime, measured)
  still moves ctime. ctime cannot be set back, so "the credential file's ctime is at or after the verdict"
  never misses a changed credential. `chmod` also moves ctime; a false "changed" costs at most today's
  single bounce.
- Every Anthropic lane on this fleet authenticates with a setup token from its roster `exec.secretsFile`
  (`.cc-secrets/<id>-oauth.env`); the upstream wrapper sources `.cc-secrets/<upstream>-oauth.env`, as the
  probe does (`ccd/ccd-account-health:87`). `.credentials.json` in a lane's config dir is rewritten often
  without a re-login (12 of 17 in five days, cause not measured; round 1 measured 7 of 17 with a ctime
  0-3 h old), so it is never a credential source: a lane the roster gives no secrets file is unnameable.

## Task 1: the marker stands until the account's credential changes

**Files:** `ccd/ccd` (`_authdead`, `_spawn_settle`'s rc-0 arm, the rescue's marker write in
`_auto_swap_check`, comments at `_authdead`'s header, `_swap_target`'s home arm), `ccd/ccrc` (the
byte-identical platform block's copy of `_plat_ctime`), `shared/generate.mjs` (the generated `accounts.sh`
body), `server/test/ccd-authdead.test.ts`, `server/test/ccd-limit-banner.test.ts`,
`server/test/macos-platform.test.ts`, the generator's tests (`roster-generate.test.ts`,
`gen-accounts.test.ts`), `server/test/single-definition.test.ts` (ccd becomes the fifth, argued holder of
the `.cc-secrets/<id>-oauth.env` convention), `server/test/session-hook.test.ts` (`_ccrc_secrets_file`
joins the generated names its comment scan cannot find under `ccd/`), `README.md`.

Design:

1. **Name the credential source.** A generated `_ccrc_secrets_file <id>` in `accounts.sh` answers the
   roster's `exec.secretsFile` (HOME-relative) for an account that declares one, and nothing otherwise
   (additive, like `_ccrc_pool`; ccd probes it with `declare -F`). ccd's `_authdead_cred_src <w>` prints one
   absolute path or answers rc 1 (unnameable):
   - `_ccrc_secrets_file` defined and answering a path → `$HOME/<path>`;
   - `<w>` is `$CCRC_UPSTREAM` → `$HOME/.cc-secrets/<w>-oauth.env`;
   - otherwise → unnameable: a lane whose roster declares no secrets file (a login lane, an external lane),
     and every lane but the upstream under an old `accounts.sh` with no such function. Never a config
     dir's `.credentials.json` (round 1, below).
   The candidate must be a regular file and not a symlink (`[[ -f && ! -L ]]`). It is `stat`ed, NEVER
   opened (it holds a secret). Never glob `.cc-secrets/<id>-*`: ids prefix one another on this fleet.
2. **`_plat_ctime`** in ccd's `_plat_*` block (Darwin `stat -f %c`, else `stat -c %Z`) — and in `ccd/ccrc`'s
   copy of it, which `macos-platform.test.ts` requires byte-identical.
3. **`_authdead_cred_changed <w> <epoch>`** → rc 0 when the source's ctime ≥ epoch, rc 1 when older,
   rc 2 when unnameable or unmeasurable (stat failed, non-digit ctime or epoch).
4. **Expiry at every ccd read.** `_authdead` (ccd's one reader: the condemned placement tier, the home arm,
   rank 101, the rescue writer's check), after its existing regular-file / no-symlink / digits gates: when
   `_authdead_cred_changed` answers 0, `rm -f` the marker and answer "not dead". Silent on stdout; never
   blocks (the `ccd-crosspool` hang table must keep every answer). So a re-login needs no spawn.
5. **The rc-0 arm** keeps `rm -f "$REG/$id.stopped"` and clears the marker only when
   `_authdead_cred_changed` answers 0 or 2. Answer 1 (the credential predates the verdict) keeps it: the
   TUI came up on the same credential that was measured dead. Answer 2 keeps today's rule for a lane ccd
   cannot see (any lane that declares no secrets file — login lanes, external lanes; an old `accounts.sh`).
6. **The rescue writer** skips its write when the source is nameable and its ctime ≥ the pane's
   `_pane_born`: the dying process read an older credential than the file now holds.
7. **Line budget.** `ccd/ccd` line numbers are cited (README anchors, the S6-R11 corpus; highest cited
   line 21428 at 17e5e7a35). Define every new function BELOW that line; above it, change existing lines in
   place (a clause appended to an existing line) wherever that stays readable. If a line must be added or
   removed above it, run the S6-R11 procedure (re-point README anchors by content, re-measure the census)
   in this commit.

**Found implementing (corrections to the design above, same commit):**

- Item 1's third arm (a config dir's `.credentials.json`) first needed a backend gate, so an external lane
  would not be judged by it; round 1 then dropped the arm entirely (below), which subsumes the gate.
- Item 7 held without the S6-R11 procedure: every edit above `ccd/ccd:21428` is line-neutral (`wc -l`
  unchanged at 23587 until the new functions were appended after the last cited line), `ccd/ccrc`'s edit
  is line-neutral too, and `session-hook.test.ts`'s census stayed green unchanged.
- Emitting `_ccrc_secrets_file` moved three pins the plan did not name: `gen-accounts.test.ts`'s
  "enriched and plain rosters project the same bytes" (now: the same bytes but for the upstream's one
  secrets-file arm) and its "never spells `.cc-secrets`" (now: only inside `_ccrc_secrets_file`'s arms);
  `single-definition.test.ts`'s holder list for `-oauth.env` (ccd is the fifth holder, and argues);
  `session-hook.test.ts`'s generated-name exemption. README's projection list and its digest paragraph
  (`exec.secretsFile` is now inside the roster digest) were updated with them.
- `_authdead_cred_changed` reads the epoch base 10 and bounds it to 18 digits: the marker's first field
  is bytes off disk, bash reads a leading `0` as octal, and a 25-digit field wraps (measured) — each is
  pinned by a test and a mutation.

**Round 1 (harm-lens review; the orchestrator's rulings, same fix commit):**

- **The `.credentials.json` arm is dropped.** On a lane that declares no secrets file, that file changes
  for reasons other than a re-login (7 of 17 config dirs had a ctime 0-3 h old, cause unmeasured), so a
  change between a pane's birth and its 401 made the rescue skip its marker, and any marker written
  expired at the next change: D-3522's loop, back. Such a lane is now unnameable — the rescue writes its
  marker as D-3522 did, rc 0 keeps §A.6's clear, and nothing expires on read. Live exposure was none
  (every generated lane on the fleet box declares a secrets file), but `ccrc account add --method login`
  writes exactly this shape.
- **API-key lanes keep the rule; the probe selects by credential identity.** An OpenRouter or compatible
  lane's secrets file is `.cc-secrets/<id>-<provider>.env`; the OAuth usage probe selects only an upstream
  lane's declared `exec.secretsFile` (or its legacy `<id>-oauth.env`) and a generated Anthropic lane with
  a declared setup-token file. API-key and login lanes are refused before any file is sourced, even if a
  stale `<id>-oauth.env` remains. Kept on purpose: an API-key 401 is an invalid key, and a new key file is
  what ends it (or an operator `rm`). The CARRIED text below had said the probe covers every Linux lane;
  it now names what the probe covers and what clears a marker elsewhere.
- **`_authdead`'s expiry re-reads before it removes.** Deciding forks for the source and for `stat`
  (~7 ms, measured by the review at load ~37); the probe or a rescue can rename a fresh verdict in
  meanwhile, and a remove by path deleted it and answered "not dead". The marker's first field is now
  read again (a builtin, behind the same `-f`/`! -L` rungs) and the file is removed only while it still
  carries the judged epoch; otherwise the answer is "dead" for that decision. The window left is the one
  between that read and `rm`'s unlink — one fork and exec wide — and is stated in the code.
  `_authdead_clear_on_spawn`'s rc-0 remove is unchanged: it keeps the window base's unconditional rc-0
  `rm` always had.

- [x] Red: the tests below, each measured red before the fix.
- [x] Green: design items 1–6.
- [ ] Re-stamp `ccd/ccd` (`shared/mark.mjs` `markGenerated`); re-measure the citation census; mutation
  table; full sharded server suite plus PWA, agent, build and tsc.

Tests (red first):
- a clean spawn keeps the marker when the account's credential predates the verdict (fixture
  `.cc-secrets/claude-a-oauth.env`, marker epoch now+3600) — red today;
- a clean spawn clears it when the credential changed after the verdict (marker epoch far in the past);
- a lane with no nameable credential keeps today's rule (the existing "a successful spawn … clears"
  case, retitled — its premise is now a fallback, not evidence);
- a lane with no `secretsFile` is unnameable (round 1): a `.credentials.json` rewritten after the verdict
  expires nothing, rc 0 clears, and a rescue marks even when that file changed after the pane was born;
  the upstream is judged by `.cc-secrets/<upstream>-oauth.env`; an old `accounts.sh` with no
  `_ccrc_secrets_file` is unnameable;
- an API-key lane's marker survives rc 0 and expires when its key file is rewritten (round 1);
- a fresh verdict renamed in while `_authdead` judges the old one survives, and the account reads dead
  (round 1, a `_plat_ctime` seam that renames it in); control: the same seam with no rename expires;
- a re-login expires the marker at the next read, with no spawn (`_swap_target` returns home and the
  marker is gone) — red today; and its control (credential older than the verdict: home still refused);
- `_ws_least_loaded`'s condemned tier sees the same expiry;
- `_authdead` prints nothing while expiring; a symlinked or non-regular credential source is unnameable;
- the rescue marks nothing when the credential changed after the pane was born — red today; control: a
  credential older than the pane is marked;
- the carried loop end to end (rescue writes, another session's rc-0 spawn on the dead account, the home
  arm refuses) — red today;
- `macos-platform.test.ts` gains the `_plat_ctime` Linux arm;
- the generator emits `_ccrc_secrets_file` for an account with `exec.secretsFile` and answers nothing for
  one without.

## Deviations found

- **D-3524** — *The auth-dead marker outlives a clean spawn until the account's credential changes;
  amends `2026-09-07-account-health-and-provenance-design.md` §A.6 owner 2.* §A.6 made "any successful
  session start on that account" a clearing owner because a start was evidence the credential
  authenticates. Measured 2026-09-28, Claude Code 2.1.280 brings up a working prompt on a dead OAuth token,
  so `_spawn_settle` rc 0 wiped the marker D-3522's rescue had just written, and the home-recovered arm sent
  the rescued session back: one bounce per wipe, per rescued session. What shipped: the evidence is now the
  credential itself. A marker expires — at `_spawn_settle` rc 0 and at every ccd read — once the account's
  credential file (roster `exec.secretsFile` through a generated `_ccrc_secrets_file`, else the upstream's
  `<id>-oauth.env`) has a ctime at or after the marker's epoch; a clean spawn on an unchanged credential
  keeps it; a lane whose credential ccd cannot name — any lane that declares no secrets file (a login
  lane, an external lane; a config dir's `.credentials.json` is never read, because it changes without a
  re-login), and every lane but the upstream under an older `accounts.sh` — keeps §A.6's rc-0 clear.
  The rescue writes no marker when the named file changed after the dying process started. The owners
  become: the probe (writes on 401, clears on a live answer), the rescue (writes), a credential change
  (expires), rc 0 on a lane ccd cannot name (clears), and an operator `rm`. WHAT THE PROBE COVERS:
  `ccd-account-health` runs where its systemd timer runs (Linux, any role but `server`; never macOS),
  over roster accounts with `telemetry: "anthropic"` whose credential identity is an OAuth setup token:
  an upstream lane's declared `exec.secretsFile` (or its legacy `.cc-secrets/<id>-oauth.env`) and a
  generated Anthropic lane with a declared setup-token file. It refuses API-key lanes
  (`<id>-<provider>.env`) and login lanes before sourcing a stale guessed OAuth file. On a lane ccd names
  but the probe cannot measure (an API-key lane anywhere, any lane on macOS) a
  marker stands until that file is rewritten or an operator `rm` — for an API key, whose 401 means an
  invalid key, that is the intended owner; on a lane ccd cannot name, until the next rc-0 spawn or an
  `rm`. CARRIED, not fixed: a probed account revived with no local trace (a transient API-side 401, an
  account re-enabled server-side) keeps its marker until the probe's next live answer, and a nameable
  unprobed one until its file changes or an `rm`; the account stays eligible at rank 101 and flagged in
  the PWA meanwhile. A proof-by-reply clear (a real assistant row from a process holding the current
  credential) would close that and is not built. `_authdead`'s expiry removes the marker only while it
  still carries the judged epoch; a rename landing between that re-read and `rm`'s unlink is still
  deleted. The keepalive's and the server's readers of the marker do not expire it; they converge when a
  ccd reader removes the file.
