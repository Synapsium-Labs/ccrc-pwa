# Admin-merge gate: one checked door for an approval-missing landing

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a coordinator can land a PR whose only stop is `approval-missing` in a repository where ccrc's GitHub
identity is an admin and no merge queue applies, through ONE ccd verb that checks every condition itself, merges with
`--admin --match-head-commit <sha>` and journals the merge. Every raw `gh pr merge --admin` and `gh api` merge stays
refused by the session hook in every session, and workers still cannot merge at all.

**Architecture:** a new session-side verb, `ccd pr-admin-merge --repo <owner/repo> --pr <n> --head <sha>`
(`cmd_pr_admin_merge` in ccd/ccd, beside `cmd_pr_open`). Coordinators already run `ccd pr-state` and land with `gh`
from their own session, so the door is a ccd verb run from the coordinator's own Bash, not a server route. ccd runs
`gh` as a subprocess, which no hook sees; the hook keeps refusing the raw spellings, and its worker deny gains the
door's command word. One box setting, `CCRC_ADMIN_MERGE` (`auto` or `off`, default `auto`), turns the door off
fleet-wide and is shown in the console's box settings card. The coordinator skill sends `STOP approval-missing`, and
only that stop, to the door.

**Tech stack:** bash (ccd/ccd, ccd/ccrc, ccd/session-hook.sh), jq, `gh` REST and GraphQL reads, vitest fixture tests
(`makePrHarness`, the hook's spawn harness), TypeScript (shared/api.ts, pwa words).

## Deviations found

- **D-8124 (2026-11-09)** — the operator's rulings on admin merges, overturning the blanket "no `--admin` in any
  session" rule (landing-order spec §5.2 and §5.7.4, session-hook.sh's merge deny, the coordinator skill's clause 15
  and wave-lifecycle's **No `--admin`**) for one case only. (1) Which repositories: every repository where ccrc's
  GitHub identity holds admin permission, read at merge time (`GET /repos/{owner}/{repo}` `permissions.admin`), with
  no per-repository switch; one box setting, `CCRC_ADMIN_MERGE` (`auto` or `off`, default `auto`), turns the feature
  off fleet-wide and is shown in the console. (2) A repository whose base branch has a merge queue (a ruleset
  `merge_queue` rule, or GitHub's `mergeQueue` for the branch) is never admin-merged: the queue decides, so this
  repository keeps landing through its queue. (3) Every condition is checked at merge time on the exact head: every
  required check green on that head commit, no review standing at changes-requested, not a draft, the merge pinned
  with `--match-head-commit <sha>`, and the repository's allowed merge method respected (a merge commit preferred,
  `--squash` only when a merge commit is not allowed). (4) Coordinators only; workers stay unable to merge at all.
  The design keeps the hook's deny of a raw `gh pr merge --admin` and of `gh api` merges in every session and adds
  one gated door, `ccd pr-admin-merge`, that performs every check itself, refuses with a typed reason otherwise and
  journals each admin merge.

What the read of `main` at 217fc7d29 found, beside the rulings:

1. **The blanket rule already has one exception.** D-7249's allowance (`$REG/admin-merge-allowed/<project>`, written by
   the operator by hand, `ALLOW_ADMIN_RE` in session-hook.sh) lifts the admin half of the bypass deny for one exact
   `gh pr merge <n> --admin` spelling in one project's sessions, with no check of its own. This plan leaves it as it
   is: the door neither reads it nor is lifted by it. Whether to retire it once the door ships is the operator's call
   (open point 2).
2. **The fleet's landing rules prefer squash, not a merge commit.** Spec §11 item 7 ("squash, then merge") and the
   landing verdict's method choice (`wave-lifecycle.md` §5b) both prefer squash. The ruling's text says "prefer a merge
   commit, as the fleet's landing rules do". The door follows the ruling's explicit order: merge, then squash only
   when the method set holds no merge, and a rebase-only set refuses as the verdict does. The verdict is unchanged.
3. **The verdict counts `neutral` and `skipped` as passing.** `checks()` in §5b judges a completed run with conclusion
   `success`, `neutral` or `skipped` as passing. An admin merge bypasses GitHub's own judgement of the required set,
   so the door asks more: a required name is green only when every run and status for it on the head reads
   `success`. A required check a path filter skipped refuses the door (`checks-not-green`).
   **Superseded by review (same day):** the door now uses GitHub's and the verdict's passing set (`success`, `neutral`,
   `skipped`), because the stricter rule made the verdict say `passing`, the stop `approval-missing`, and the door refuse a
   path-filtered required job, which sent the operator back to merging by hand. The journal keeps the word (`lint:skipped`).
4. **Nothing in the fleet reads GitHub permissions today.** No `permissions.admin`, `viewerPermission` or
   `mergeQueue` read exists in ccd, the server or the agent. The door is the first. Measured from a workstation on
   2026-11-09: `GET /repos/{o}/{r}` answers `permissions.admin` and the four `allow_*` settings in one read, and GraphQL
   `repository.mergeQueue(branch:)` answers an id for a branch with a queue rule and `null` for one without.
5. **The registry has no coordinator marker.** A coordinator is derived: no `.child` marker (`sessionRoleOf`,
   shared/api.ts, which reads the marker's existence) and, as the hook's worker deny reads it, no hold matching
   `CCRC_HOLD_WAVE_RE` (a self-claimed run's hold or a reclaim heir is refused like a worker). The door uses both,
   and `CCRC_HOLD_WAVE_RE` gets a ccd copy held equal to the hook's by a single-definition pin.
6. **Session-side ccd verbs identify their caller by the tmux pane.** `cmd_swap_self` reads `tmux display-message
   -p '#S'`; the hook reads the exact pane, bounded (`-t "$TMUX_PANE"`, `timeout 2`). The door uses the hook's read and
   never takes the caller from an argument. Identity on this box is attribution, not authentication (spec §4).
7. **An empty required set makes condition (3)'s check vacuous.** The ruling says "every required check green". A
   repository with an approval rule and no required checks would admit an admin merge with no CI evidence. The door
   follows the ruling as written (it admits, prints `checks=none-required` and journals it) and this is open point 1.
8. **The over-cap reading never sees the door.** Over `MERGE_PARSE_CAP` the hook asks only the `gh … pr … merge`
   segment rule, so a held session's over-cap command that runs the door passes the hook. The door still refuses
   that caller itself; the class goes on the hook's `WHAT PASSES UNPARSED` list.

## Open points for the operator (the plan ships the first answer of each)

1. A repository with an approval rule and no required checks: admit (as ruled, journaled `checks=none-required`), or
   refuse `no-required-checks`.
2. D-7249's per-project allowance: keep (as now), or retire it once the door has landed one PR.
3. The door does not tie the named repository to the caller's project: a coordinator may name any repository the
   identity administers (as ruled, "every repository"). Tying it to the caller's project origin would narrow it.

## Risks and their pins

| Risk | Pin (test, file) |
|---|---|
| A worker calls the door | door: `refuses a caller whose hold names a programme wave`, `refuses a caller carrying the child marker, readable or not` (ccd-pr-admin-merge.test.ts); hook: `refuses a worker's call of the admin-merge door with wave 2's reason` (session-hook-merge-deny.test.ts) |
| A caller with no pane, or not ccd-managed | `refuses a caller it cannot name: no pane, no tmux answer, no registry row` |
| A coordinator names a repository with a queue | `refuses a base with a merge_queue rule`, `refuses a base GraphQL names a mergeQueue for, with no rule in the rules read`, `refuses when the mergeQueue read fails` |
| A stale head (a push after the check) | `refuses when the PR head is not the bound sha`, `refuses when the head moved between the checks and the merge`, `passes --match-head-commit <sha> to gh, and reads GitHub's refusal as github-refused` |
| A required check pending, skipped, neutral or missing | `checks-not-green names each required check that is not success: pending, skipped, neutral, missing, red` |
| Admin read, but the token lacks it at merge time | `refuses protection-unreadable when classic protection answers 403 to an admin read`, `a refused merge is github-refused, journaled, never retried` |
| A draft, a closed PR, a standing request for changes | `refuses a draft`, `refuses a PR that is not OPEN`, `refuses a standing changes-requested review, by summary or by a reviewer's latest review` |
| The wrong merge method | `merges with --merge when a merge commit is allowed`, `merges with --squash only when the method set holds squash and no merge`, `refuses rebase-only and an empty method set` |
| The setting off, unreadable or refused | `refuses setting-off with no gh call`, `a refused value or a missing reader reads as off` |
| Prose that mentions `--admin` | `the door's argv never carries --admin`; skill: `names --admin only in clause 15 and spells no gh pr merge with --admin`; hook: `mentions of the door pass`, the existing wave 2b mention cases |
| A raw `gh pr merge --admin` from a coordinator | the existing bypass-deny cases, plus `the bypass reason names the admin-merge door` |
| The server calling the door | `no server argv builder names pr-admin-merge` (whitelist-subset.test.ts) |

## File map

- `ccd/ccrc` — `CCRC_SETTINGS`, `BOX_SETTINGS_TABLE`, `BOX_SETTING_VALUE_WORDS`, `_set_reads`, the family check in the
  settings verb, new `_lnd_ok` and `_lnd_says`.
- `deploy/gen-settings-lib.mjs`, `ccd/lib/ccrc-settings.sh` (regenerated) — carry `_lnd_ok` and `_lnd_says`.
- `shared/api.ts` — `BoxSettingFamily` gains `landing`; `BOX_SETTING_TABLE` and `BOX_SETTING_VALUE_WORDS` rows.
- `pwa/src/fleet/boxSettingsWords.ts` — the family label `Landing`.
- `deploy/ccrc.env.example`, `README.md` — the setting's line and table row.
- `server/test/fixtures/box-settings/ok--*.json` — the new row, by hand (Linux regenerates).
- `ccd/ccd` — `cmd_pr_admin_merge` and its `_am_*` helpers, `AM_HOLD_WAVE_RE`, the dispatch line, the usage line.
- `ccd/session-hook.sh` — `CCD_DOOR_RE`, the worker deny's door arm, the bypass reason's door sentence, the
  `WHAT PASSES UNPARSED` line, the header's D-8124 paragraph.
- `ccd/coordinator-skill/SKILL.md` — clause 15.
- `ccd/coordinator-skill/references/wave-lifecycle.md` — the verdict's `approval-missing` stop line and comment, the
  `admin=never` bullet, **No `--admin`**, a new **The admin-merge door (D-8124)** paragraph, the stop list.
- `docs/superpowers/specs/2026-09-23-landing-order-and-main-churn-design.md` — §5.7.4 and an §11 amendment.
- `CLAUDE.md` — the CI paragraph's "never use it" line.
- Tests: new `server/test/ccd-pr-admin-merge.test.ts` and `server/test/ccdAdminMergeFixture.ts`; edits to
  `session-hook-merge-deny.test.ts`, `coordinator-skill.test.ts`, `coordinator-landing-verdict.test.ts`,
  `box-settings-table.test.ts`, `ccrc-settings-verb.test.ts`, `single-definition/vocabularies.test.ts`,
  `whitelist-subset.test.ts`.

## Interfaces

```
ccd pr-admin-merge --repo <owner/repo> --pr <n> --head <40-hex sha>
```

- Fixed arity, six words in that order, no getopt loop, no passthrough. `<owner/repo>` matches
  `^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$` and neither half starts with `-` or `.`; `<n>` matches `^[1-9][0-9]{0,8}$`; `<sha>`
  matches `^[0-9a-f]{40}$`. Anything else: `die` with the usage line, rc 1, no gh call.
- stdout is exactly one line, always:
  - `MERGED <owner/repo>#<n> head=<sha> method=<merge|squash> merge=<oid> checks=<name:success,…|none-required>`, rc 0;
  - `REFUSED <reason>: <detail>`, rc 2, where `<reason>` is one of
    `setting-off`, `setting-unread`, `caller-unknown`, `not-coordinator`, `unreadable`, `not-admin`, `not-open`,
    `draft`, `not-at-head`, `merge-queue`, `protection-unreadable`, `changes-requested`, `checks-not-green`,
    `method-none`, `rebase-only`, `head-moved`, `github-refused`, `unproven`.
  - `unproven` means gh answered the merge but the read-back did not show MERGED at `<sha>`: GitHub may have merged,
    so it is reported, never retried.
- The order of the checks, cheapest and local first, each a refusal on failure: argv, setting, caller, repository read
  (admin, methods), PR read (state, draft, head, base, review decision), rules read on the base (queue, required
  checks, `pull_request` methods, linear history), GraphQL `mergeQueue(branch: base)`, classic protection (required
  checks, linear history), reviews, check runs and statuses on `<sha>`, the method, a fresh PR read (head and review
  decision), then `gh pr merge <n> -R <owner/repo> --admin --<method> --match-head-commit <sha>`, then the read-back.
- Journal: one line in `$REG/swap.log` per call that got past argv:
  `admin-merge <caller>: <owner/repo>#<n> head=<sha> method=<m> checks=<…> result=merged merge=<oid>` or
  `admin-merge-refused <caller or ?>: <owner/repo>#<n> head=<sha> reason=<reason>`.
- Box setting: `CCRC_ADMIN_MERGE` (`auto` or `off`, default `auto`), family `landing`, roles `fleet,both`, applies
  `run`. Read through `ccrc-settings.sh`'s `_ccrc_knob` and checked by `_lnd_ok`; a missing reader, an unreadable
  value or a refused value reads as `off` (fail closed) and refuses `setting-unread`.

The test fixture, `server/test/ccdAdminMergeFixture.ts`, exports `AM_GH_STUB` (a bash `gh()` that logs its argv to
`$HOME/gh-calls` and answers each read from a file under `$HOME/am/`, a missing file answering rc 1), `amFixture(h,
over)` (writes a green, eligible repository `owner-a/repo-a`, PR 42 at `HEAD_A`, base `main`, one required check
`build`), `amCaller(h, id, { hold?, child? })` (a registry row, a stub `tmux` answering `cc-<id>`) and `amRun(h, argv)`
(runs `cmd_pr_admin_merge` with `TMUX_PANE=%1` and the stub first on `PATH`).

---

### Task 1: The box setting `CCRC_ADMIN_MERGE`

**Files:**
- Modify: `ccd/ccrc` (`CCRC_SETTINGS`, `BOX_SETTINGS_TABLE`, `BOX_SETTING_VALUE_WORDS`, `_set_reads`, the settings
  verb's family `case`, new `_lnd_ok` and `_lnd_says` beside `_mg_ok`)
- Modify: `deploy/gen-settings-lib.mjs` (copy `_lnd_ok`, `_lnd_says`); regenerate `ccd/lib/ccrc-settings.sh`
- Modify: `shared/api.ts` (`BoxSettingFamily`, `BOX_SETTING_FAMILY_MAP`, `BOX_SETTING_TABLE`, `BOX_SETTING_VALUE_WORDS`)
- Modify: `pwa/src/fleet/boxSettingsWords.ts` (`landing: 'Landing'`)
- Modify: `deploy/ccrc.env.example`, `README.md` (configuration table row)
- Modify: `server/test/fixtures/box-settings/ok--*.json` (one row each, in the verb's row shape)
- Test: `server/test/box-settings-table.test.ts`, `server/test/ccrc-settings-verb.test.ts`

- [ ] **Step 1: Write the failing tests.** In `box-settings-table.test.ts` add a pair reader beside `mgPairs`:

```ts
/** D-8124: the admin-merge door's (key, words) pair, from `_lnd_ok`'s one word arm in ccd/ccrc. */
function lndPairs(src: string): string[] {
  const body = /^_lnd_ok\(\) \{[\s\S]*?\n\}$/m.exec(src)?.[0] ?? '';
  return [...body.matchAll(/^\s+(CCRC_[A-Z0-9_]+)\) case "\$2" in ([a-z|]+)\) return 0 ;; \*\) return 1 ;; esac ;;$/gm)]
    .map((m) => `${m[1]!}:${m[2]!.split('|').join(',')}`).sort();
}
```

and in T10 add `expect(lndPairs(SRC)).toEqual(['CCRC_ADMIN_MERGE:auto,off']);`, fold `...lndPairs(SRC)` into
`fromShape`, and add `'CCRC_ADMIN_MERGE:auto,off'` first in the sorted expected list. In `ccrc-settings-verb.test.ts`
add `/_ccrc_knob CCRC_ADMIN_MERGE auto file;/` to the `_set_reads` pin list, and a case:

```ts
it('CCRC_ADMIN_MERGE: auto by default, off accepted, any other word refused (D-8124)', () => {
  expect(rowOf(settingsJson({}), 'CCRC_ADMIN_MERGE')).toEqual({ key: 'CCRC_ADMIN_MERGE', state: 'ok', value: 'auto', from: 'default' });
  expect(rowOf(settingsJson({ file: 'CCRC_ADMIN_MERGE=off\n' }), 'CCRC_ADMIN_MERGE')).toMatchObject({ state: 'ok', value: 'off', from: 'file' });
  expect(rowOf(settingsJson({ file: 'CCRC_ADMIN_MERGE=on\n' }), 'CCRC_ADMIN_MERGE')).toMatchObject({ state: 'refused', why: 'auto or off' });
});
```

(`rowOf` and `settingsJson` are that file's existing readers; use whatever names it already exports for the wake
gate's case, which this mirrors.)

- [ ] **Step 2: Run them and see them fail.**
  `cd server && npx vitest run --maxWorkers=2 test/box-settings-table.test.ts test/ccrc-settings-verb.test.ts`
  Expected: FAIL (`lndPairs` reads `[]`; no `CCRC_ADMIN_MERGE` row).
- [ ] **Step 3: Implement.** In ccd/ccrc append `CCRC_ADMIN_MERGE` to `CCRC_SETTINGS`, the table row
  `CCRC_ADMIN_MERGE:value:landing:fleet,both:run`, the words line `CCRC_ADMIN_MERGE:auto,off`, the read
  `_ccrc_knob CCRC_ADMIN_MERGE auto file; _set_got CCRC_ADMIN_MERGE $?` at the end of `_set_reads`, the family arm
  `landing) _lnd_ok "$k" "$v" ;;`, and:

```bash
# The admin-merge door's switch (D-8124): `auto` lets `ccd pr-admin-merge` act in every repository the fleet's GitHub
# identity administers that has no merge queue; `off` turns it off fleet-wide. ccd reads it at each call, never typed.
_lnd_ok() {
  case "$1" in
    CCRC_ADMIN_MERGE) case "$2" in auto|off) return 0 ;; *) return 1 ;; esac ;;
    *) return 1 ;;
  esac
}
_lnd_says() {
  case "$1" in
    CCRC_ADMIN_MERGE) printf '%s' 'auto or off' ;;
    *) return 1 ;;
  esac
}
```

  Add `'_lnd_ok', '_lnd_says'` to gen-settings-lib.mjs's list with a `// D-8124` comment and run the generator
  (`node deploy/gen-settings-lib.mjs`). Add the family to shared/api.ts (last in the union and the map, so the
  family order test reads table order), the row `CCRC_ADMIN_MERGE: { cls: 'value', family: 'landing', roles:
  ['fleet', 'both'], applies: 'run' }` last in `BOX_SETTING_TABLE`, `CCRC_ADMIN_MERGE: ['auto', 'off']` in
  `BOX_SETTING_VALUE_WORDS`, and `landing: 'Landing'` in boxSettingsWords.ts. README row: "`CCRC_ADMIN_MERGE` | fleet
  box, read by `ccd pr-admin-merge` at each call | `auto` (default) or `off`: whether a coordinator may land an
  approval-missing PR through the admin-merge door in a repository the fleet's GitHub identity administers and that has
  no merge queue (D-8124; "The admin-merge door", below). A refused or unreadable value reads as `off`." Add
  `# CCRC_ADMIN_MERGE=` with a two-line comment to ccrc.env.example. Add the `ok` row to each `ok--*.json` fixture.
- [ ] **Step 4: Run them and see them pass.** Same command, plus
  `npx vitest run --maxWorkers=2 test/ccrc-settings-lib.test.ts test/single-definition/vocabularies.test.ts` and the
  pwa box settings card test (`cd pwa && npx vitest run --maxWorkers=2 test/box-settings*`).
- [ ] **Step 5: Commit.**
  `git commit -m "feat(settings): CCRC_ADMIN_MERGE, the admin-merge door's fleet-wide switch (D-8124)"` with the
  trailer.

### Task 2: The door's gate before any GitHub call (argv, setting, caller)

**Files:**
- Modify: `ccd/ccd` (`cmd_pr_admin_merge`, `_am_setting`, `_am_caller`, `_am_refuse`, `AM_HOLD_WAVE_RE`, dispatch
  `pr-admin-merge) shift; cmd_pr_admin_merge "$@" ;;`, the usage line)
- Create: `server/test/ccdAdminMergeFixture.ts`, `server/test/ccd-pr-admin-merge.test.ts`
- Modify: `server/test/single-definition/vocabularies.test.ts`, `server/test/whitelist-subset.test.ts`

- [ ] **Step 1: Write the failing tests** in `ccd-pr-admin-merge.test.ts` (`describe('the gate before GitHub')`):

```ts
it('takes exactly --repo, --pr, --head in that order, and nothing else', () => {
  amFixture(h); amCaller(h, 'demo-quiet-basin');
  for (const argv of [`--repo owner-a/repo-a --pr 42`, `--pr 42 --repo owner-a/repo-a --head ${HEAD_A}`,
    `--repo owner-a/repo-a --pr 42 --head ${HEAD_A} --admin`, `--repo owner-a --pr 42 --head ${HEAD_A}`,
    `--repo owner-a/repo-a --pr 042 --head ${HEAD_A}`, `--repo owner-a/repo-a --pr 42 --head ${HEAD_A.slice(1)}`,
    `--repo -x/repo-a --pr 42 --head ${HEAD_A}`]) {
    const r = amRun(h, argv);
    expect(r.code, argv).toBe(1);
    expect(r.stderr, argv).toMatch(/usage: ccd pr-admin-merge --repo <owner\/repo> --pr <n> --head <sha>/);
  }
  expect(h.ghCalls()).toEqual([]);
});
it('refuses setting-off with no gh call', () => {
  amFixture(h); amCaller(h, 'demo-quiet-basin'); boxEnv(h, 'CCRC_ADMIN_MERGE=off\n');
  const r = amRun(h, `--repo owner-a/repo-a --pr 42 --head ${HEAD_A}`);
  expect([r.code, r.stdout.trim()]).toEqual([2, 'REFUSED setting-off: CCRC_ADMIN_MERGE is off']);
  expect(h.ghCalls()).toEqual([]);
});
it('a refused value or a missing reader reads as off: setting-unread, no gh call', () => { /* CCRC_ADMIN_MERGE=on; then the lib moved away */ });
it('refuses a caller it cannot name: no pane, no tmux answer, no registry row', () => { /* caller-unknown ×3, no gh call */ });
it('refuses a caller whose hold names a programme wave', () => {
  amFixture(h); amCaller(h, 'demo-quiet-basin', { hold: 'program:landing-order wave:2/5 run:17' });
  expect(amRun(h, `--repo owner-a/repo-a --pr 42 --head ${HEAD_A}`).stdout).toMatch(/^REFUSED not-coordinator: /);
  expect(h.ghCalls()).toEqual([]);
});
it('refuses a caller carrying the child marker, readable or not', () => { /* .child = '17'; then .child mode 000 */ });
it('a hold that names no wave is not a worker hold (the hook reads it the same way)', () => { /* passes the gate: the first gh call is the repository read */ });
it('journals a refusal past argv in swap.log with the caller and the reason', () => {
  /* setting-off: swap.log's last line matches /admin-merge-refused demo-quiet-basin: owner-a\/repo-a#42 head=[0-9a-f]{40} reason=setting-off$/ */
});
```

In `vocabularies.test.ts` add: `'ccd AM_HOLD_WAVE_RE is session-hook.sh CCRC_HOLD_WAVE_RE, byte for byte'` (read both
assignments with `/^NAME='([^']*)'$/m` and compare). In `whitelist-subset.test.ts` add `'no server argv builder names
pr-admin-merge: the door is a session verb, never the server's'` (`server/src` has no `'pr-admin-merge'` string).

- [ ] **Step 2: Run and see them fail.**
  `cd server && npx vitest run --maxWorkers=2 test/ccd-pr-admin-merge.test.ts test/single-definition/vocabularies.test.ts test/whitelist-subset.test.ts`
  Expected: FAIL (`cmd_pr_admin_merge: command not found`; no `AM_HOLD_WAVE_RE`).
- [ ] **Step 3: Implement.** Fixed-arity check as `cmd_pr_open` does; `_am_refuse <caller> <reason> <detail>` prints
  the `REFUSED` line, appends the journal line and `exit 2`. `_am_setting` reads the library in a subshell exactly as
  `_browser_mcp_box` does (`. "$lib" && declare -F _ccrc_knob _lnd_ok`), `_ccrc_knob CCRC_ADMIN_MERGE auto`, then
  `_lnd_ok`: `auto` passes, `off` is `setting-off`, anything else (no reader, `$KNOB_WHY`, a refused word) is
  `setting-unread` naming why. `_am_caller` reads `TMUX_PANE` (empty: `caller-unknown: no tmux pane`), then
  `_plat_timeout 2 tmux display-message -p -t "$TMUX_PANE" '#S'`, requires `cc-<id>`, `id` matching
  `^[A-Za-z0-9._-]+$` and `$REG/$id.uuid`, then `[[ -e "$REG/$id.child" ]]` is `not-coordinator: <id> carries the
  child marker`, and a `.hold` read under `CCRC_HOLD_MAX` (127) that matches `AM_HOLD_WAVE_RE` is `not-coordinator:
  <id>'s hold reads <hold>`. `AM_HOLD_WAVE_RE` is the hook's string, with a comment naming the single-definition pin.
  Add the dispatch line and the usage word. Write `ccdAdminMergeFixture.ts` as the Interfaces section says.
- [ ] **Step 4: Run and see them pass.** Same command.
- [ ] **Step 5: Commit.**
  `git commit -m "feat(ccd): pr-admin-merge's gate: argv, the setting and a coordinator caller (D-8124)"`

### Task 3: The GitHub reads and every refusal before the merge

**Files:**
- Modify: `ccd/ccd` (`_am_reads`, `_am_judge` jq programs, `AM_GH_TIMEOUT`)
- Test: `server/test/ccd-pr-admin-merge.test.ts` (`describe('the reads')`)

Every read is a GET, each under `_plat_timeout "$AM_GH_TIMEOUT"` (8 s), each answer required to be exactly one JSON
value of the expected type before any field is read (the verdict's rule), any failure `unreadable: <which read>`:

1. `gh api repos/<o>/<r>`: `.permissions.admin == true` else `not-admin`; the four `allow_*` booleans (a missing one
   is `unreadable`, never false).
2. `gh pr view <n> -R <o>/<r> --json state,isDraft,headRefOid,baseRefName,reviewDecision`: `state != OPEN` is
   `not-open`, `isDraft` is `draft`, `headRefOid != <sha>` is `not-at-head`, the base must match
   `^[A-Za-z0-9._/-]+$`.
3. `gh api --paginate repos/<o>/<r>/rules/branches/<base>` (the base's `/` encoded as `%2F`, as `_pr_landing_rules`
   does): any `merge_queue` rule is `merge-queue`; keep `required_status_checks` contexts (with `integration_id`),
   `pull_request` `allowed_merge_methods`, `required_linear_history`.
4. `gh api graphql` with `repository(owner:$o, name:$r) { mergeQueue(branch:$b) { id } }`, `-f` values, never
   interpolated: a non-null `mergeQueue` is `merge-queue`; an errors-only or malformed answer is `unreadable`.
5. `gh api -i repos/<o>/<r>/branches/<base>/protection`: 200 gives the classic checks, contexts and linear history;
   404 with exactly `Branch not protected` is none; 401 or 403 is `protection-unreadable` (an admin can read it, so a
   refusal here means the token does not carry admin now); anything else `unreadable`.
6. `gh api --paginate repos/<o>/<r>/pulls/<n>/reviews`: the verdict's standing-request rule (per identity, the latest
   APPROVED, CHANGES_REQUESTED or DISMISSED review; `reviewDecision == CHANGES_REQUESTED` too): any standing request is
   `changes-requested: reviews=<ids>`. There is no ignore key: the door never passes over a request.
7. `gh api --paginate 'repos/<o>/<r>/commits/<sha>/check-runs?filter=latest'` and `…/commits/<sha>/status`: for each
   required name (rules plus classic, an App-pinned name keeping its App, as the verdict's `req`), the runs with that
   name (and App) and, when unpinned, the statuses with that context. Green only when at least one exists and every
   run is `completed` with conclusion `success` and every status is `success`. Otherwise one word per name, in this
   order of precedence: `red` (a completed run with another conclusion than success, neutral or skipped, or a status
   failure or error), `pending`, `neutral`, `skipped`, `missing`. Any non-green is `checks-not-green: build=pending,
   lint=skipped`. An empty required set is green and prints `checks=none-required`.
8. The method set: the settings, intersected with every `pull_request` rule's `allowed_merge_methods` (absent is all
   three, lower-cased), minus `merge` under linear history (a rule or classic). `merge` if in the set, else `squash`,
   else `rebase-only` when only rebase is left, else `method-none`.

- [ ] **Step 1: Write the failing tests**, one per row, each on `amFixture(h, over)` with one field changed, each
  asserting the exact `REFUSED` line, that `pr merge` is not in `h.ghCalls()`, and the journal line:

```ts
it('refuses not-admin when permissions.admin is false, before any other read', () => {
  amFixture(h, { repo: { permissions: { admin: false } } }); amCaller(h, 'demo-quiet-basin');
  const r = amRun(h, ARGV);
  expect([r.code, r.stdout.trim()]).toEqual([2, 'REFUSED not-admin: the fleet\'s GitHub identity is not an admin of owner-a/repo-a']);
  expect(h.ghCalls()).toEqual(['api repos/owner-a/repo-a']);
});
it('refuses a base with a merge_queue rule', () => {
  amFixture(h, { rules: [{ type: 'merge_queue', parameters: { merge_method: 'SQUASH' } }] }); amCaller(h, 'demo-quiet-basin');
  expect(amRun(h, ARGV).stdout.trim()).toBe('REFUSED merge-queue: main has a merge queue (a merge_queue rule); the queue lands it');
});
it('refuses a base GraphQL names a mergeQueue for, with no rule in the rules read', () => { /* mq: { id: 'MQ_x' } */ });
it('refuses when the mergeQueue read fails', () => { /* mq file absent → REFUSED unreadable: the merge queue read */ });
it('refuses a draft', () => { /* pr.isDraft true */ });
it('refuses a PR that is not OPEN', () => { /* MERGED and CLOSED */ });
it('refuses when the PR head is not the bound sha', () => { /* headRefOid HEAD_B → not-at-head: the PR head is HEAD_B */ });
it('refuses protection-unreadable when classic protection answers 403 to an admin read', () => {});
it('refuses a standing changes-requested review, by summary or by a reviewer\'s latest review', () => {
  /* reviewDecision CHANGES_REQUESTED; then reviews [CHANGES_REQUESTED by user 7, COMMENTED by user 7] → reviews=<id>;
     then [CHANGES_REQUESTED, APPROVED] by the same user → passes this rung */
});
it('checks-not-green names each required check that is not success: pending, skipped, neutral, missing, red', () => {
  amFixture(h, { required: ['build', 'lint', 'docs', 'e2e', 'unit'],
    runs: [run('build', 'in_progress', null), run('lint', 'completed', 'skipped'), run('docs', 'completed', 'neutral'),
      run('unit', 'completed', 'failure')] });
  amCaller(h, 'demo-quiet-basin');
  expect(amRun(h, ARGV).stdout.trim())
    .toBe('REFUSED checks-not-green: build=pending, docs=neutral, e2e=missing, lint=skipped, unit=red');
});
it('an App-pinned required name is judged on that App\'s runs only, and a status never stands in for it', () => {});
it('a commit status satisfies an unpinned required context', () => {});
it('refuses rebase-only and an empty method set', () => {});
it('an unreadable answer at every read is unreadable naming that read, never a pass', () => {
  /* for each of repo, pr, rules, mq, protection, reviews, runs, status: the file absent, then two JSON values, then a
     JSON array where an object is due → REFUSED unreadable: <read> */
});
```

- [ ] **Step 2: Run and see them fail.** `cd server && npx vitest run --maxWorkers=2 test/ccd-pr-admin-merge.test.ts`
  Expected: FAIL (the reads do not exist; the gate passes straight to nothing).
- [ ] **Step 3: Implement** `_am_reads` in the order above, one jq program per judgement (`_AM_CHECKS_JQ`,
  `_AM_REVIEWS_JQ`, `_AM_METHOD_JQ`), every `as` after a binary operator parenthesised (the hook suite's jq 1.8 rule
  applies to ccd's jq too). Never print a login, a review body or a check's free text: names of required checks and
  numeric ids only.
- [ ] **Step 4: Run and see them pass.** Same command.
- [ ] **Step 5: Commit.**
  `git commit -m "feat(ccd): pr-admin-merge reads admin, queue, head, reviews, checks and method at merge time (D-8124)"`

### Task 4: The merge, the read-back and the journal

**Files:**
- Modify: `ccd/ccd` (`cmd_pr_admin_merge`'s act)
- Test: `server/test/ccd-pr-admin-merge.test.ts` (`describe('the merge')`)

- [ ] **Step 1: Write the failing tests:**

```ts
it('merges with --merge when a merge commit is allowed, pinned to the head, and answers MERGED', () => {
  amFixture(h); amCaller(h, 'demo-quiet-basin');
  const r = amRun(h, ARGV);
  expect(r.code).toBe(0);
  expect(r.stdout.trim()).toBe(`MERGED owner-a/repo-a#42 head=${HEAD_A} method=merge merge=${MERGE_OID} checks=build:success`);
  expect(h.ghCalls().filter((c) => c.startsWith('pr merge')))
    .toEqual([`pr merge 42 -R owner-a/repo-a --admin --merge --match-head-commit ${HEAD_A}`]);
  expect(lastJournal(h)).toMatch(new RegExp(`admin-merge demo-quiet-basin: owner-a/repo-a#42 head=${HEAD_A} method=merge checks=build:success result=merged merge=${MERGE_OID}$`));
});
it('merges with --squash only when the method set holds squash and no merge', () => { /* allow_merge_commit false */ });
it('drops merge under linear history (a rule or classic protection)', () => {});
it('refuses when the head moved between the checks and the merge', () => {
  /* the stub's second `pr view` answers HEAD_B → REFUSED head-moved, no `pr merge` call */
});
it('a refused merge is github-refused, journaled, never retried', () => {
  /* the stub's `pr merge` exits 1 with "GraphQL: Head branch was modified" → REFUSED github-refused: <first stderr line,
     control characters dropped, at most 200 bytes>; exactly one `pr merge` call; no other method tried */
});
it('passes --match-head-commit <sha> to gh, and reads GitHub\'s refusal as github-refused', () => {});
it('a merge gh answered whose read-back is not MERGED at the head is unproven, not merged, and not retried', () => {});
it('the door\'s argv never carries --admin, and the only --admin it sends is on its one gh pr merge', () => {
  /* every gh call but the merge holds no --admin; the source of cmd_pr_admin_merge spells `--admin` exactly once */
});
```

- [ ] **Step 2: Run and see them fail.** `cd server && npx vitest run --maxWorkers=2 test/ccd-pr-admin-merge.test.ts`
- [ ] **Step 3: Implement.** After the reads, a fresh `gh pr view <n> -R <o>/<r> --json headRefOid,reviewDecision,state,isDraft`:
  a different head is `head-moved`, and a changes-requested decision, a draft or a non-OPEN state refuse as before.
  Then the one write, `_plat_timeout "$AM_GH_TIMEOUT" gh pr merge "$pr" -R "$repo" --admin "--$method"
  --match-head-commit "$sha"`, stdout dropped, stderr captured. Non-zero: `github-refused`. Zero: read back with
  `gh pr view <n> -R <o>/<r> --json state,headRefOid,mergeCommit`; MERGED with `headRefOid == sha` and a 40-hex
  `mergeCommit.oid` is `MERGED`, journaled; anything else `unproven`. Never a second merge call on any path.
- [ ] **Step 4: Run and see them pass.** Same command.
- [ ] **Step 5: Commit.**
  `git commit -m "feat(ccd): pr-admin-merge merges with --admin --match-head-commit, proves it and journals it (D-8124)"`

### Task 5: The session hook: the worker deny covers the door, the bypass reason names it

**Files:**
- Modify: `ccd/session-hook.sh` (`CCD_DOOR_CUT`, `CCD_DOOR_RE` derived from `GH_MERGE_RE`, the merge arm, both bypass
  reasons, the header)
- Test: `server/test/session-hook-merge-deny.test.ts`

`CCD_DOOR_RE` is `GH_MERGE_RE`'s head grammar with `ccd pr-admin-merge` for `gh … pr … merge`, derived as `GH_API_RE`
is, so the two never drift: `CCD_DOOR_CUT=$'([^[:space:];&|()]*/)?gh('`, which occurs once in `GH_MERGE_RE`;
`CCD_DOOR_RE=${GH_MERGE_RE%%"$CCD_DOOR_CUT"*}$'([^[:space:];&|()]*/)?ccd[ \t]+pr-admin-merge([[:space:];&|()<>]|$)'`.
Under the cap, `[[ "$mcmd" =~ $CCD_DOOR_RE ]]` sets `mmerge=1`, so wave 2's question (a wave hold, the child marker)
refuses it with wave 2's reason, byte for byte; a session with neither is not asked and passes. The prefilter needs
no change (`pr-admin-merge` holds `merge`). Over the cap the door is not read (deviation 8): a `WHAT PASSES UNPARSED`
line says so. The bypass reasons (under and over the cap) gain: "In a repository where the fleet's GitHub identity
is an admin and no merge queue applies, a coordinator lands a PR stopped only by `approval-missing` through `ccd
pr-admin-merge --repo <owner/repo> --pr <n> --head <sha>`, which checks every condition itself and journals the
merge (D-8124)." The header's THE BYPASS DENY paragraph gains a D-8124 paragraph saying the deny stays whole and why
(a text read cannot check admin, a queue, the head or the checks; the door can).

- [ ] **Step 1: Write the failing tests:**

```ts
describe('the admin-merge door (D-8124)', () => {
  const DOOR = `ccd pr-admin-merge --repo owner-a/repo-a --pr 42 --head ${'a'.repeat(40)}`;
  it('refuses a worker\'s call of the admin-merge door with wave 2\'s reason', () => {
    hold(WAVE_HOLD);
    expect(bash(DOOR).deny).toBe(bash('gh pr merge 42').deny);
    marker();
    expect(bash(`~/.local/bin/${DOOR}`).deny).toContain('a wave\'s session never merges');
  });
  it('a coordinator\'s call of the door passes', () => { expect(bash(DOOR).deny).toBeNull(); });
  it('mentions of the door pass, in a worker too', () => {
    hold(WAVE_HOLD);
    for (const c of [`echo "${DOOR}"`, `git commit -m "land with ${DOOR}"`, 'grep -n pr-admin-merge ccd/ccd', 'ccd pr-admin-mergers'])
      expect(bash(c).deny, c).toBeNull();
  });
  it('CCD_DOOR_RE is derived from GH_MERGE_RE\'s head: the cut occurs once and the head is shared', () => {});
  it('LISTED pass: a worker\'s door call over the parse cap', () => { hold(WAVE_HOLD); expect(bash(sized(' ', DOOR, CAP + 1)).deny).toBeNull(); });
});
```

  and in `'refuses --admin in a session with no hold and no marker, naming …'` add
  `expect(deny).toContain('ccd pr-admin-merge --repo <owner/repo> --pr <n> --head <sha>')`, likewise for the over-cap
  bypass reason case. The existing coordinator `--admin` refusals stay as they are.
- [ ] **Step 2: Run and see them fail.**
  `cd server && npx vitest run --maxWorkers=2 test/session-hook-merge-deny.test.ts`
- [ ] **Step 3: Implement** as above. Keep the `as` rule (no new jq). Add the LISTED line to the header list.
- [ ] **Step 4: Run and see them pass**, plus
  `npx vitest run --maxWorkers=2 test/session-hook.test.ts test/session-hook-sync-advisory.test.ts` (the arm's time
  bound).
- [ ] **Step 5: Commit.**
  `git commit -m "feat(hook): the worker deny covers the admin-merge door; the bypass reason names it (D-8124)"`

### Task 6: The coordinator skill: `approval-missing` goes to the door, and only that stop

**Files:**
- Modify: `ccd/coordinator-skill/SKILL.md` (clause 15)
- Modify: `ccd/coordinator-skill/references/wave-lifecycle.md` (§5b's route comment and `approval-missing` stop line,
  the `admin=never` bullet, **No `--admin`**, a new **The admin-merge door (D-8124)** paragraph, the stop list)
- Test: `server/test/coordinator-skill.test.ts`, `server/test/coordinator-landing-verdict.test.ts`

New text, final wording at implementation:

- Clause 15's sentence "`--admin` and GitHub API merge or enqueue calls are governed by the external policy authority
  of the repository; until that authority answers, this session never uses them." becomes "This session never passes
  `--admin` to gh and never makes a GitHub API merge or enqueue call; its one admin merge is `ccd pr-admin-merge`, on an
  `approval-missing` stop only, as `references/wave-lifecycle.md` §5b says (D-8124)." The unattended sentence's "and
  nothing uses `--admin` or an update of the branch" becomes "and nothing passes `--admin` outside that door or updates
  the branch". `--admin` stays inside clause 15 only.
- The verdict's stop: `stop "approval-missing: route $route needs an approval the fleet cannot give; only the
  admin-merge door may land it (D-8124)"`, its comment block saying the operator answered for the policy authority on
  2026-11-09 and the ROUTE lines keep `admin=never` (no route passes `--admin`; the door is not a route).
- **No `--admin`** keeps every never (no `--admin` on a route, never a fallback after a refusal, `changes-requested` is
  never passed over) and drops "until that authority answers".
- **The admin-merge door (D-8124).** "On `STOP approval-missing`, and on no other line, once the landing line
  (below) answers `pinned` at the head you bind, run `ccd pr-admin-merge --repo <owner/repo> --pr <pr> --head
  <handoffCommit>` once, from your own session, in the foreground. It checks for itself that the setting is on, that
  you are a coordinator, that the fleet's GitHub identity is an admin of the repository, that its base has no merge
  queue, that the PR is open, not a draft and at that head, that no review requests changes, and that every required
  check is `success` on that head; it then merges with the repository's method, pinned to the head, and journals it.
  Its one line decides: `MERGED …` is proven as every route is (MERGED at `handoffCommit`, step 3); `REFUSED
  <reason>: …` leaves the stop standing, reported as `approval-missing` with the door's line; `unproven` is reported,
  never retried. Never run it twice for one attempt, never after `github-refused`, `changes-requested` or any other
  stop, and never in place of route Q: a repository with a merge queue lands through it."

- [ ] **Step 1: Update the pins first, so they fail on the old text.** In coordinator-skill.test.ts: CONTRACT[14]
  becomes the new clause 15; `'withdraws the loose --admin allowance'` now expects the new **No `--admin`** sentence
  and `not.toContain('until that authority answers')`; add

```ts
it('names the admin-merge door on approval-missing only, spelled once with the bound head (D-8124)', () => {
  const wl = flat(refs('wave-lifecycle.md'));
  const door = '`ccd pr-admin-merge --repo <owner/repo> --pr <pr> --head <handoffCommit>`';
  expect(wl.split(door)).toHaveLength(2);
  expect(wl).toContain('On `STOP approval-missing`, and on no other line');
  expect(wl).toContain('never after `github-refused`, `changes-requested` or any other stop');
  expect(allSkillText).not.toMatch(/ccd pr-admin-merge[^`\n]*--admin/);
});
```

  In coordinator-landing-verdict.test.ts the `approvalMissing` expected line becomes the new stop text, and add a case
  that every `ROUTE` line still prints `admin=never`.
- [ ] **Step 2: Run and see them fail.**
  `cd server && npx vitest run --maxWorkers=2 test/coordinator-skill.test.ts test/coordinator-landing-verdict.test.ts`
- [ ] **Step 3: Edit the skill and the reference** as above; the `gh pr merge` spans are unchanged, so the SHA-binding
  pin stays green.
- [ ] **Step 4: Run and see them pass**, plus `npx vitest run --maxWorkers=2 test/landing-verdict.test.ts test/pr-queue-lane.test.ts`.
- [ ] **Step 5: Commit.**
  `git commit -m "feat(skill): approval-missing goes to the admin-merge door, and only that stop (D-8124)"`

### Task 7: The docs say the one exception and why

**Files:**
- Modify: `README.md` ("The bypass deny (landing-order wave 2b)", the D-7249 paragraph, the native-queue paragraph's
  "never `--admin`", the CI paragraph's "Don't do it"; a new "The admin-merge door (D-8124)" paragraph)
- Modify: `CLAUDE.md` (the CI paragraph's "so never use it")
- Modify: `docs/superpowers/specs/2026-09-23-landing-order-and-main-churn-design.md` (§5.7.4's `--admin` column and
  its paragraph; a new §11 amendment "Amendment 2026-11-09 (D-8124)" and decisions 18 to 21)
- Test: `server/test/readme-*.test.ts` that pin these paragraphs, if any red

- [ ] **Step 1:** Write the README paragraph: what the door checks, in order; its typed refusals; the journal line;
  `CCRC_ADMIN_MERGE`; that the hook still refuses every raw `--admin` and `gh api` merge, and why a text read cannot
  carry those checks; that a repository with a merge queue is never admin-merged, so this repository keeps landing
  through its queue and the CI paragraph's reasoning (the fast run only) still holds; that coordinators only, never
  workers. CLAUDE.md: "so never use it" becomes "so never use it; ccrc's admin-merge door (D-8124) refuses any
  repository with a merge queue, so it never lands here". The spec: the `--admin` column reads "never on a route; on G
  and U an `approval-missing` stop may go to the admin-merge door (D-8124)", and §11 records rulings (1) to (4).
- [ ] **Step 2:** `cd server && npx vitest run --maxWorkers=2 test/readme-settings*.test.ts test/box-settings-table.test.ts`
  and any README census the change trips (grep `server/test` for the edited headings first).
- [ ] **Step 3: Commit.** `git commit -m "docs: the admin-merge door is the one exception to no --admin (D-8124)"`

### Task 8: Verification

- [ ] Run every touched suite in groups of at most 12 files with `--maxWorkers=2`: the eight test files above, then
  `ccd-pr-open`, `ccd-pr-state`, `ccd-pr-landing`, `ccd-lib-load`, `ccrc-settings-lib`, `session-hook`,
  `session-hook-sync-advisory`, `landing-verdict`, `pr-queue-lane`.
- [ ] `bash -n ccd/ccd ccd/session-hook.sh ccd/ccrc`; `shellcheck` on the three if installed.
- [ ] `cd server && npx tsc --noEmit -p .` and `cd pwa && npx tsc --noEmit -p .` (shared/api.ts changed).
- [ ] Known Mac-only failures, not this change's: push-copy, mail-sweep (the Mac disk alarm), history-replay (Node),
  the agent's deploy-verify D3b-e. The box-settings corpus regeneration case is Linux-only and must run on Linux CI.

## Known limits

- The caller is named by its tmux pane. A process that sets `TMUX_PANE` to another session's pane is attributed to
  that session: identity on this box is attribution, not authentication (spec §4), as for every hook and verb here.
- A review that requests changes after the door's last read, while gh merges, is not seen. The door re-reads the PR's
  review decision just before the merge; nothing closes the last second.
- Over the parse cap the hook does not read the door (deviation 8); the door still refuses a worker.
- The door does not read the landing line; the skill reads it first, as before every direct merge.
- The journal is `$REG/swap.log`, which the console does not show today.
- The door does not tie the named repository to the caller's project (open point 3).
- D-7249's allowance is unchanged (open point 2).
