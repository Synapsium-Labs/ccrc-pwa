# ccrc PR Lifecycle — design spec

**Status:** decided. Implement as written.
**Scope:** a PR control in the chat header, automatic **archiving** on merge, and **confirmed, non-automatic deletion** of an archived workspace.
**Files:** `infra/ccrc/agent/src/whitelist.ts`, `infra/ccrc/agent/test/*`, `infra/ccrc/server/src/{server,watch,fleet,registry,ccdargv,prstate,wsaudit}.ts`, `infra/ccrc/server/test/*`, `infra/ccrc/shared/api.ts`, `infra/ccrc/pwa/src/session/{SessionHeader,PrKeycap,PrSheet,ReapSheet}.tsx`, `infra/ccrc/pwa/src/fleet/SessionActionsSheet.tsx`, `infra/ccrc-portability/ccd`.

---

## 0. The ruling on automation, stated plainly

The user asked for auto-archiving *and* cleanup on merge. This spec gives **both halves of what was asked, split at the only line that matters**:

- **Archiving is fully automatic.** On merge, ccrc stops the session and its boot unit, marks the workspace archived, folds it out of the live fleet, and notifies. It destroys nothing — not the worktree, not the branch, not one gitignored byte. Every automatic failure mode costs disk, and disk is reversible.
- **Deletion is never automatic. Not on a timer, not after a grace window, not "when we are sure".** A deferred deletion is an automatic deletion whose confirmation happened before the facts did.

Why deletion cannot be automated here, concretely and not as taste:

1. **The only local proof of mergedness is a snapshot, and the session that could invalidate it is still running.** A workspace's residual value after merge is exactly a warm session for the follow-up fix — so the moment automation is most likely to fire is the moment a follow-up commit is most likely to land.
2. **The check that would gate it is blind to the loss that matters.** `ws-rm`'s sole data guard is `git status --porcelain` (ccd:252), which cannot see gitignored content. A worktree holding `SECRET_API_KEY=…` in `.env` is deleted today with the output `removed workspace …` and nothing else, and that content was never in the object store. No poller produces the judgement "yes, I know about that `.env`". Only a human reading the filename does.
3. **`git branch -D` is indistinguishable from destroying work.** A branch on a squash-merged base plus one genuinely unmerged commit produces the byte-identical `branch -d` error and exit code as a fully merged one.
4. **There is no pressure justifying the risk.** `ccd ws-gc` reports 6.4 G across 18 worktrees, all foreign, zero ccd workspaces. `ws-add` already refuses below `CCD_DISK_FLOOR_GB`. The cost of not deleting is a directory.
5. **`custom-tools-quiet-basin` lived 13h40m, burned 23min41s CPU, and vanished during normal operation.** Shipping an automation whose failure mode is "the thing I was working on is gone and I do not know why" into that context is the wrong lesson.

So: **merge → archive (automatic). Archived → delete (two taps, a manifest, and a state-fingerprint the server re-proves at the moment of deletion).** Everything below is the mechanism that makes that pair safe.

**Guard placement principle, used throughout:** *guards for reversible actions may live server-side; guards for irreversible actions must live in `ccd`, on the box that owns the files, re-evaluated at the instant of the action.* Archive's guards are server-side. Every reap guard is in `ccd`.

---

## 1. The exec-whitelist change

### 1.1 Mechanism — uniform argv-PREFIX matching, no `gh` key, flags before positionals

Replace `infra/ccrc/agent/src/whitelist.ts:93-126`:

```ts
/** cmd -> allowed argv PREFIXES. `args` must begin with one of them; tokens
 *  after the prefix are unconstrained. One-token prefixes are exactly the old
 *  behaviour, so every pre-existing entry is bit-identical. */
const EXEC_WHITELIST: Record<string, readonly (readonly string[])[]> = {
  tmux: [['has-session'], ['list-panes'], ['capture-pane'], ['send-keys'], ['resize-window']],

  // NO `gh` KEY, DELIBERATELY. The host token carries the `repo` WRITE scope
  // (gh auth status: gist, read:org, repo, workflow) and there is no second
  // layer — no read-only credential, no cwd sandbox. Any `gh` entry makes this
  // list the sole control between the PWA and `gh pr merge`. `gh: [['api']]` is
  // strictly worse still: -X POST|PATCH|PUT creates, closes and merges PRs.
  // PR reads and the one PR write go through `ccd` verbs, whose args[0] has no
  // write sibling reachable by changing args[1]. See whitelist-noghosts.test.ts.
  //
  // `ws-rm` is GONE from this list: it is the unguarded legacy verb and the PWA
  // must not be able to emit it. `ws-reap` replaces it and is pinned to carry
  // `--expect`, so an UNCONFIRMED reap cannot cross the wire at all.
  // `clip` is GONE: dead grant, no server call site emits it.
  // `ws-gc` is absent and must stay absent: ['ws-gc'] would permit `--prune`.
  ccd: [
    ['start'], ['enable'], ['ensure'], ['stop'], ['swap'], ['ws-add'],
    ['pr-state', '--session'],
    ['pr-state', '--project'],
    ['pr-open',  '--session'],
    ['ws-archive', '--session'],
    ['ws-restore', '--session'],
    ['ws-audit', '--session'],
    ['ws-reap',  '--expect'],   // load-bearing: no reap without a confirmation token
    ['ws-attic', '--session'],
  ],
};

export function isExecAllowed(cmd: string, args: string[]): boolean {
  if (typeof cmd !== 'string' || cmd.length === 0 || cmd.includes('/')) return false;
  const prefixes = EXEC_WHITELIST[cmd];
  if (!prefixes) return false;
  if (!Array.isArray(args) || !args.every((a) => typeof a === 'string')) return false;
  return prefixes.some((p) => p.length <= args.length && p.every((tok, i) => args[i] === tok));
}
```

`EXEC_WHITELIST` is module-private, so the type change is not an API change. All 14 existing assertions in `agent/test/whitelist.test.ts:93-149` pass unmodified except the two that assert `ws-rm`/`clip` are allowed, which invert.

**Why the multi-token capability is actually spent, not merely adopted.** Prefixes pin a *leading run* of tokens, so putting flags after a variable `<id>` positional makes them unpinnable — that is how a `--body-file <any path>` or a `--drop-ignored` becomes whitelist-legal. Therefore **every new verb takes `--flag value` pairs only, with no free positionals**, and the two verbs where it matters are pinned at their first flag. `['ws-reap','--expect']` is a machine-checked statement that ccrc cannot reap without a token.

### 1.2 ccd-side argument parsing — fixed arity, no getopt loop, no passthrough

Every new `cmd_*` opens with strict positional assertions, not a flag loop:

```bash
cmd_ws_reap() {                      # ccd ws-reap --expect <tok> --session <id>
  [[ $# -eq 4 && $1 == --expect && $3 == --session ]] || die "usage: ccd ws-reap --expect <token> --session <id>"
  local token=$2 id=$4
  [[ $token =~ ^[0-9a-f]{64}$ ]]     || die "bad token"
  [[ $id    =~ ^[A-Za-z0-9._-]+$ ]]  || die "bad session id"
  ...
}
```

Rules, enforced by review and by test:
- **No `"$@"` is ever forwarded into `gh` or `git`.** pflag is last-wins (verified: `gh pr list -R bad -R good` returns `good`), so a passthrough would let a caller override `-R`, `--head` or `--base`.
- **No flag anywhere takes a filesystem path.** `gh pr create -F <file>` reads any file the uid can read, including `~/.config/gh/hosts.yml` (mode 0600, two live `gho_` tokens). PR body arrives as `--body-b64 <base64>` — a value, not a reference.
- **No force/override flag exists in any verb.** There is no `--drop-ignored`, no `--now`, no `--force-branch`, no `ignored=discard` config file. "Not exposed in the PWA" is a UI statement, not a security property; the only correct version is "not implemented".
- **Every id-taking verb validates `^[A-Za-z0-9._-]+$` before any path is built from it.** `ccd` today regexes `project` (ccd:166) and never `id`; `ws-reap` is the first ccd verb that `rm -rf`s a path built from an id, so this is mandatory. Server routes also call `isSafeSessionId` (`clip.ts:10`) — note `server.ts:315` does not today.
- **Git revision operands are validated and `--`-terminated *after* the revisions.** Verified fail-open: `git diff --quiet -- <A> <B>` exits **0** (the shas become pathspecs); `git diff --quiet <A> <B> --` exits 1 correctly. `--merge-commit`-style oids are matched `^[0-9a-f]{7,40}$`. Empty operands fail closed (exit 128), and every ref is resolved with `rev-parse --verify` first.

### 1.3 The subset test — three layers, shipped in the same commit

This is the mechanism that stops "route added, whitelist not updated, all suites green, dead on the fleet" (the `ws-add`/`ws-rm` defect). This design adds **eight** new argv shapes; without this it reproduces that defect eight times.

**Layer 1 — a guard `Runner`, free on every existing route test.** In `server/test/helpers.ts`, wrap the default runner (`helpers.ts:12`):

```ts
import { isExecAllowed } from '../../agent/src/whitelist.js';
import { wireCmd } from '../src/remote/runner.js';
export const guardRunner = (inner: Runner): Runner => async (cmd, args) => {
  const wire = wireCmd(cmd);                    // cfg.ccdBin is absolute; isExecAllowed rejects '/'
  if (!isExecAllowed(wire, args)) throw new Error(`argv not in the agent EXEC_WHITELIST: ${wire} ${args.join(' ')}`);
  return inner(cmd, args);
};
```
Applying `wireCmd` (`remote/runner.ts:36-38`) is load-bearing. Return `{code:1}` as before so no existing expectation moves. Cross-package import is established practice — five server tests already import `../../agent/src/server.js`, and `server/package.json` declares `"ccrc-agent": "file:../agent"`.

**Layer 2 — exhaustive enumeration, so an untested route cannot hide.** New `server/src/ccdargv.ts` is the *only* place ccd argv is constructed:

```ts
export const CCD_ARGV = {
  start:     (w: string, p: string, wd?: string) => ['start', w, p, ...(wd ? [wd] : [])],
  ensure:    (id: string) => ['ensure', id],
  stopId:    (id: string) => ['stop', id],
  stopPair:  (w: string, p: string) => ['stop', w, p],
  swap:      (id: string, w: string) => ['swap', id, w],
  wsAdd:     (p: string) => ['ws-add', p],
  prStateSession: (id: string) => ['pr-state', '--session', id],
  prStateProject: (p: string)  => ['pr-state', '--project', p],
  prOpen:    (id: string, t: string, b64: string, draft: boolean) =>
               ['pr-open', '--session', id, '--title', t, '--body-b64', b64, '--draft', draft ? 'true' : 'false'],
  wsArchive: (id: string) => ['ws-archive', '--session', id],
  wsRestore: (id: string) => ['ws-restore', '--session', id],
  wsAudit:   (id: string) => ['ws-audit', '--session', id],
  wsReap:    (tok: string, id: string) => ['ws-reap', '--expect', tok, '--session', id],
  wsAttic:   (id: string) => ['ws-attic', '--session', id],
} as const;
```
`it.each(Object.entries(CCD_ARGV))` asserts `isExecAllowed('ccd', build(...sample)) === true` for every entry. Self-guard the table with a static scan over `server/src/**.ts` asserting **no inline array literal appears at a runner call site outside `ccdargv.ts` and `exec.ts`**, in the style of `test/module-format.test.ts:55-66`. Move the stray `deps.run('tmux', ['resize-window', …])` at `server.ts:218` onto the `Tmux` class so `exec.ts` is genuinely the only tmux argv site — it is `void`-ed today, so a `forbidden` there is swallowed silently, which is exactly this class of failure.

**Layer 3 — reverse direction, and the cross-box gap.**
- *Superset:* every `EXEC_WHITELIST.ccd` prefix must be reachable from some `CCD_ARGV` entry. This is what catches a dead grant (`clip`) and stops the list drifting wider than the code.
- *Deployment skew:* `~/.local/bin/ccd` is a **copy**, not a symlink to the repo. A verb can pass the whitelist and still not exist on the box. So `ccd` gains `ccd caps` (prints one verb name per line) — **not** whitelisted, read at agent start and reported in the agent `hello` payload as `ccdVerbs: string[]`. The server refuses to emit a verb the agent did not advertise and renders `unsupported` in the UI instead of a control that silently fails. An end-to-end pass booting a real in-process agent via the existing `remoteHelpers.ts` and injecting every ccd-emitting route (asserting no 502 carries `forbidden`) is optional but ~30 lines.

**Agent test additions** (`whitelist.test.ts`, plus a new `whitelist-noghosts.test.ts` whose failure message names the reason):
`('ccd', ['ws-reap','--expect','<64hex>','--session','x'])` → true; `('ccd', ['ws-reap','x'])` → **false**; `('ccd', ['ws-rm','x'])` → **false**; `('ccd', ['clip','x'])` → **false**; `('ccd', ['ws-gc'])` and `(…,['ws-gc','--prune'])` → false; `('gh', […])` → false for `pr view|list|create|merge|close|edit|ready|comment`, `api`, `repo delete`, `auth token`, `[]`; `('git', ['push','--force'])` → false; boundary cases `('ccd', [])`, `('ccd', ['pr-statex'])`, `('ccd', ['pr-state'])` → false. One `exec.test.ts` end-to-end `forbidden` for `gh pr create`; one `malformed.test.ts` table row.

---

## 2. The chat-header PR control

`infra/ccrc/pwa/src/session/PrKeycap.tsx`, rendered in `SessionHeader.tsx` immediately after the `⋯` cap (`SessionHeader.tsx:216-223`) and before the conditional `esc` cap — "top right, to the right of the ···". `esc` keeps the outer edge because it is the interrupt and its position is muscle memory; on a fine pointer `esc` is absent and PR becomes rightmost naturally.

Styling reuses `.chat-head .keycap` (`chat.css:177-196`) with `.keycap--pr { min-width: var(--tap-min); padding-inline: 6px; }` — **it must not be the one sub-44px control in the header.**

### Visibility rule

**The cap renders for every session with `workspace !== null`, always, unconditionally — including before the first sweep, during a gh outage, and while the agent link is down.** A main checkout gets no cap.

This is deliberate and non-negotiable: keying visibility on `pr !== null` makes the control's *absence* an affirmative claim ("this session cannot have a PR") that is rendered identically for "we have not checked" — and the retry affordance then lives behind a control that is not on screen. `pr === null` is a first-class **`unchecked`** state with its own legend.

`FleetSession` gains `pr: PrState | null` and `archivedAt: number | null`. `SessionRecord` (`registry.ts:5-9`) gains `prPhase`, `prNumber`, `prCheckedAt`, `archivedAt` — persisted, so a server restart degrades to **honest stale**, never to silence.

```ts
export type PrPhase = 'unchecked' | 'none' | 'no-commits' | 'open' | 'draft' | 'merged' | 'closed' | 'unknown';
export type PrChecks = 'pass' | 'fail' | 'pending' | null;
export interface PrState {
  phase: PrPhase;
  number: number | null; url: string | null; title: string | null;
  checks: PrChecks; checkNames: string[] | null;   // inert text, never actionable
  ahead: number;                                    // commits past base
  reason: 'timeout'|'offline'|'unauthenticated'|'rate-limit'|'no-remote'|'unsupported'|'agent-down'|'error'|null;
  checkedAt: number | null;                         // epoch ms of the gh read that produced this
  mergedAt: number | null;
}
```

### States

| phase | legend | dot | tap opens `PrSheet` showing |
|---|---|---|---|
| `unchecked` | `PR` | hollow, dashed | "Not checked yet." + **Check now**. Never worded as "no PR". |
| `no-commits` | `PR` | none, dim | "`ws/quiet-basin` has no commits past `origin/main`." Create disabled with that sentence as the reason. |
| `none` | `PR` | none, accent | **Compose mode** (§3). |
| `draft` | `#42` | hollow ring | title, checks, **Open on GitHub**, **Copy link**, **Refresh**. |
| `open` | `#42` | green / amber breathing / red per `checks` | as above; failing check names rendered as **inert text**. |
| `merged` | `#42` | violet, filled | "Merged 12m ago." Then, derived **from `archivedAt`, never from `phase`**: either "Archived — session stopped; nothing deleted" + **Restore** + **Clean up…**, or "Not archived yet (session busy)" + **Archive now**. |
| `closed` | `#42` struck | grey | "Closed without merging. This branch's commits are not on main." **No cleanup is offered, ever.** |
| `unknown` | last `#42`, else `PR` | grey, dashed | the reason sentence + "last checked 6m ago" from `checkedAt`, + **Retry**. Neither create nor cleanup is offered. |

`aria-label` carries the full sentence. CI status is **never colour-only**: the dot is accompanied by a glyph (`✓ ▲ ✕`) and a text line in the sheet; `checks === null` renders "no checks configured", distinct from pending.

### What a tap does

**Always exactly one thing: open `PrSheet`. No state of the cap performs an action on tap.** A misread badge can therefore never cost anything. Opening the sheet fires a one-shot `GET /api/sessions/:id/pr` (cached values shown meanwhile). Every destructive or outward-facing action is a labelled button *inside* the sheet, and each uses the codebase's existing `QuickConfirm` consequence grammar — the primitive already used for stopping a session, swapping accounts and rebooting the host. Two identical ghost buttons side by side on a phone is not a confirmation.

**Failing checks get no action button.** Check names arrive from GitHub and are attacker-controllable on any repo that accepts fork PRs (`MegaMek/megamek` is public and takes them continuously). A "ask the session to fix the failing checks" button would inject that text through `POST /api/sessions/:id/prompt` → `tmux send-keys -l` into an agent spawned with `--dangerously-skip-permissions` (ccd:887). That is remote command execution against a `repo`-scoped token with no dialog, no `dialogPending`, and no notification. Check names are inert text. **No GitHub-sourced string is ever placed in a prompt, an argv, or a shell.**

`SessionActionsSheet.tsx:65-72` — the existing unconfirmed one-tap "Remove workspace" — is **rewired to open the same audit→confirm flow**, and its comment ("ccd ws-rm refuses … an unmerged branch") is deleted because it is false: `ws-rm` swallows `branch -d`'s failure with `2>/dev/null || true` (ccd:267-268) and orphans the branch. Leaving a shallower unguarded door beside a careful one guarantees the unguarded one gets used.

---

## 3. Creating a PR

**This is an outward-facing, irreversible-in-public action.** Opening a PR pushes a branch to a shared remote, emails reviewers, and starts CI. It cannot be undone by ccrc — closing a PR later does not unsend the notifications. It is treated accordingly: explicit content review, an explicit confirm, and no path that fires it without a tap.

### 3.1 Why the write is a ccd verb and not a prompt injection

The tempting design is "don't run any write; inject a prompt and let Claude push and run `gh pr create` under its own permission prompts." **That is unsound on this fleet and is rejected.** Every ccd session is spawned with `--dangerously-skip-permissions` (`ccd:887`, reached unconditionally from `cmd_ws_add` at ccd:228). There are no permission prompts to answer; `paneState()` never returns `menu`; `dialogPending` never sets; the `DialogSheet` never renders. That approach does not remove the write from the trust boundary — it moves it to the one channel the whitelist cannot inspect (natural language into an agent with full bypassed authority over the token, the filesystem and `git push --force`) and calls the result read-only.

The write is therefore one bounded verb whose reach is fixed by what the script implements:

```
ccd pr-open --session <id> --title <t> --body-b64 <b64> --draft <true|false>
```

`cmd_pr_open`, in order:
1. Strict arity/regex parse (§1.2). `id` regex. `--title` length ≤ 256, no control characters. `--body-b64` decodes as valid UTF-8 ≤ 64 KiB or die.
2. `[[ -n $(_reg_get "$id" workspace) ]] || die "not a workspace — refusing to open a PR from a main checkout"`. **Workspace-only, always.** Nine of nine sessions on this box today are main checkouts, several sitting on `main` with an upstream; a verb without this guard would `push --set-upstream origin main` on its first step.
3. `branch=$(_reg_get "$id" branch)`; `base=$(_reg_get "$id" base)`; die on empty; `[[ $branch != "$base_short" ]] || die "head equals base"`.
4. `repo=$(git -C "$main" config --get remote.origin.url)` → `OWNER/NAME`. This is why the verb lives in ccd: the agent's exec op passes **no cwd** (`agent/src/server.ts:92`), the agent's cwd is `$HOME` which is not a repo (verified: `gh pr list` there fails), and the server cannot read `~/worktrees/*` to derive it (`checkPath`, `whitelist.ts:83-90`).
5. **Idempotence:** `timeout 12 gh pr list --repo "$repo" --head "$branch" --state all --json number,url,state` — if a PR exists, print it and `exit 0` without pushing or creating.
6. `git -C "$wt" push --set-upstream origin "refs/heads/$branch:refs/heads/$branch"` — fully qualified both sides, **never `--force`**, branch from the registry and never from the request. Failure aborts before any `gh` call and surfaces git's stderr verbatim.
7. `gh pr create --repo "$repo" --head "$branch" --base "$base_short" --title "$title" --body "$body" [--draft]` with the flags in that fixed order and **no caller tokens appended**.
8. Print the created PR as JSON.

`gh pr merge`, `close`, `edit`, `ready`, `comment`, `review`, `gh api -X POST|PATCH|PUT`, `gh repo delete`, `gh auth token` and `git push --force` are unreachable from the PWA — not by policy but because no ccd verb emits them and `gh`/`git` are not whitelisted commands.

### 3.2 Where title and body come from

Server-side, in `server/src/prstate.ts` — **deterministic, no model call, testable without `gh`**. `ccd pr-state --session <id>` returns, alongside the PR object: `base`, `branch`, `repo`, `commits: [{sha, subject, body}]` for `base..HEAD`, and `template` (contents of `$main/.github/pull_request_template.md` if present).

`draftPr(state, tasks, template) → {title, body}`:

**Title**
1. Exactly one commit → its subject verbatim.
2. More than one → the **first** commit's subject (it names the intent; later commits are fixups), skipping subjects matching `/^(fixup|squash|amend|wip)!?\b/i`.
3. All fixup-shaped, or zero commits → the de-slugified branch (`ws/quiet-basin` → `quiet-basin`).

**Body**, assembled in order:
1. `template` if the repo has one — a repo with a PR template has an opinion, and automation does not override it. (Note: passing an empty `--body` suppresses the template, so ccd always passes a non-empty body; this gets its own test.)
2. Otherwise, the first commit's body paragraph if any.
3. `## Plan` — the session's own task list, which the server already reads (`tasks/read.ts`, swept into `FleetWatcher.taskProgress` every 10 s). Rendered `- [x] title` / `- [ ] title`. This is the best available description of the work and costs one map lookup.
4. `## Commits` — `- <short sha> <subject>`.
5. Trailer: ``Opened from ccrc workspace `custom-tools-quiet-basin` (`ws/quiet-basin` → `main`).``

### 3.3 Confirmation

The sheet in `none` phase is a composer:

- **Title:** a single-line editable input, prefilled. One field, one thumb height.
- **Body:** a **read-only rendered preview**, scrollable. A multi-line editor in a bottom sheet is a bad surface, and the body is fully regenerable — prose edits happen on GitHub, one tap away via the sheet's own link.
- **Facts line, always shown:** `ws/quiet-basin → main · you/custom-tools · 3 commits`. A dirty-tree line when applicable: *"2 files are not committed — they will not be in this PR."*
- **Primary:** `QuickConfirm` labelled **Open pull request**, consequence sentence: *"Pushes `ws/quiet-basin` to `you/custom-tools` and opens a public pull request. Reviewers are notified. ccrc cannot undo this."* Secondary: **Open as draft**. Disabled while `status === 'busy'` and under `unauthenticated`.
- The request goes through the existing per-session `KeyedQueue` (`server.ts:224`), so it serialises with every other write.

**There is no merge button, in any state, ever.** Merging is the irreversible review decision and belongs on github.com where the diff is. The sheet says so: *"Merging happens on GitHub. When it merges, ccrc archives this workspace automatically."* This also keeps the write surface at exactly one additive verb.

---

## 4. Merge detection

### 4.1 Mechanism

`ccd pr-state --project <project>` runs **one** call per repo:

```
timeout 12 gh pr list --repo "$slug" --state all --limit 100 \
  --json number,state,headRefName,headRefOid,baseRefName,isCrossRepository,mergedAt,mergeCommit,url,title,isDraft,statusCheckRollup
```

`--state all` is mandatory: `--state closed` is a *superset* that includes MERGED, so filtering on it conflates merged with abandoned in both directions. `mergeable`/`mergeStateStatus` are **never read** — they return the literal string `"UNKNOWN"` on merged PRs. `mergeCommit.oid` is never used as an identity — two PRs can share one oid (#583/#584).

**Merge predicate** (`prstate.ts`), conjunctive:

```ts
row.state === 'MERGED' && typeof row.mergedAt === 'string'
  && typeof row.mergeCommit?.oid === 'string' && /^[0-9a-f]{7,40}$/.test(row.mergeCommit.oid)
  && row.isCrossRepository === false                    // fork PRs cannot claim our branch name
  && row.baseRefName === baseShort                      // merged into the base we recorded
  && row.headRefName === registryBranch
```

`--head` matches on `headRefName` **across fork owners** (verified: `gh pr list -R cli/cli --head patch-1 --state all` returns PRs from ten unrelated external accounts). Any design whose `--json` list omits `isCrossRepository` hands the badge — and the cleanup trigger — to any stranger who can fork a public repo. Additionally, the workspace↔PR binding is **not** branch name alone: `headRefOid` must exist locally and be reachable from our branch tip (§5.4 proof 0). That kills both fork spoofing and the recycled-slug case (the slug namespace is 12×12 = 144 and `ws-reap` frees names; a 100-PR `--limit` window keeps an old merged PR matchable for months).

If several rows match, the highest `number` wins **after** the binding check, not before.

### 4.2 Cadence and cost

A third lane on `FleetWatcher` (`server/src/watch.ts`), beside the 2 s pane poll and the 10 s `TASK_SWEEP_MS` task sweep:

```ts
const PR_SWEEP_MS = 120_000;
const PR_SWEEP_ACTIVE_MS = 30_000;      // any project with an open PR whose checks are pending
const PR_BACKOFF_MAX_MS = 900_000;
```

- `private prStates = new Map<string, PrState>()`, `private prBackoff = new Map<string, {until:number; step:number}>()` keyed by **project**, `private lastPrSweep = 0`, `private prSweepInFlight = false`.
- `currentPrStates()` joins `currentPending()` / `currentStatuslines()` / `currentTaskProgress()` (`watch.ts:72-86`), so `/api/fleet` and the initial `/ws/fleet` push carry PR state immediately rather than after two minutes.
- `assembleFleet` (`fleet.ts:29`) takes it as a seventh parameter and sets `pr`, exactly as `tasks` is threaded.
- **`sweepPr()` is never awaited in `tick()`** — it shells out over the network and `gh` has no `--timeout`; awaiting it would stall the dialog detector and the busy→idle push behind GitHub's reachability. It is `void this.sweepPr().catch(logAndContinue)` behind `prSweepInFlight`. **Every JSON line is parsed inside its own try/catch**; `tick()` is invoked as `void this.tick()`, so an uncaught parse throw on truncated stdout would take the process down.
- Skipped entirely when `cfg.fleetMode === 'remote' && !fleetState?.connected` — the same guard `tick()` already applies before `saveSnapshot`.

Cost: 8 projects × 1 call / 120 s ≈ 240 GraphQL calls/hour against 5000/hr with ~4900 free (~5 %). Measured latency 0.51–0.69 s per call.

**Timeouts, two layers.** `timeout 12 gh …` inside ccd, exit 124 mapped to `{"phase":"unknown","reason":"timeout"}` on **stdout with exit 0** so the server receives an *answer* and not an ambiguity. Outer bound: `timeoutMsFor` in `remote/runner.ts` currently takes only `cmd` and returns a flat 90 s for `ccd`; **change its signature to `timeoutMsFor(cmd, args)`** and set `pr-state` 20 s, `ws-archive`/`ws-restore` 60 s, `ws-audit` 90 s, `ws-reap` 240 s. The agent's `MAX_EXEC_TIMEOUT_MS` is 120 s (`agent/src/server.ts:56`); raise it to 300 s in the same commit with a test, or `ws-reap` on a 4.8 G worktree is SIGTERM'd mid-delete.

### 4.3 What detection does, and what it does when it cannot tell

On each sweep, for every workspace session, ccrc computes `phase` and then evaluates a **level**, not an edge:

```
phase === 'merged' && workspace !== null && archivedAt === null
  && archiveSafety(id) === 'ok'          →  ccd ws-archive --session <id>
```

**Level-triggered, deliberately.** There is no `prevPhase` file and no in-memory "did we see the transition" flag. Any edge-triggered scheme consumes the transition on the producing box while the consumer lives in another process on another box with no acknowledgement — a partial multi-repo sweep killed at the outer timeout, an agent disconnect, or a busy-skip destroys the edge permanently and strands the workspace in a state whose UI claims it was archived. `ws-archive` is idempotent (`exit 0` with `already archived`), so retrying every 120 s until it succeeds is free and self-healing.

`archiveSafety(id)` returns `'ok' | 'busy' | 'attached' | 'unknown'` and **must not collapse `unknown` to idle**. `liveStatus` (`fleet.ts:20-27`) returns `'idle'` when `pid` or `cfgDir` is missing or the status file is unreadable — in remote mode both cross the agent WS, so a socket hiccup reads as "not working". Archive requires an *affirmative* idle plus `bus.listenerCount('session:'+id) === 0`. `unknown` defers and the next sweep retries; the sheet offers a manual **Archive now**. `ccd ws-archive` re-checks the wrapper status file itself and refuses `status-unknown`. Both layers fail closed.

**When merge state cannot be determined, nothing happens and the UI says so.** `unknown` never archives and never offers cleanup, at any staleness. `PrState` keeps its last good value and `checkedAt`; the cap greys and dashes; the sheet names the reason and offers Retry. A failed read never overwrites persisted `prPhase`.

---

## 5. Cleanup

Three stages. **Merge → ARCHIVE (automatic, destroys nothing). Archived → REAP (manual, confirmed, state-fingerprinted, destructive). Archived → RESTORE (manual, one tap, no confirmation, undoes archive completely).**

### 5.1 `ccd ws-archive --session <id>` — automatic, lossless

1. `[[ -f "$REG/$id.uuid" ]] || die "no such session"`.
2. `[[ -n $(_reg_get "$id" workspace) ]] || die "not a workspace — refusing to archive a main checkout"`.
3. `[[ -f "$REG/$id.archived" ]] && { echo "already archived $id"; exit 0; }` — idempotent; this is what makes level-triggering safe.
4. Wrapper status must read idle; unreadable → `die "status-unknown"`.
5. Write `$REG/$id.archivemanifest` (into the **registry**, never into the worktree, which is the thing that may later be deleted): branch, base, tip sha, dirty count, ignored digest, stash count, worktree bytes, PR number/url/mergedAt, resolved transcript path.
6. `_ws_unsupervise "$id"` (`systemctl --user disable --now claude-session@$id`) — clears the `default.target.wants` symlink and the `Restart=always` net.
7. `tmux kill-session -t "$(_tmux "$id")" 2>/dev/null || true`.
8. `_reg_set "$id" archived <epoch>`; `_reg_set "$id" archivedreason "merged:#42"`.
9. Print `archived <id> (merged in #42) — worktree kept at <path>, nothing deleted`.

**What it does not do:** no `git worktree remove`, no `git branch -d`, no `rm -f "$REG/$id".*`. Branch, worktree, every gitignored file, stashes, and the per-worktree HEAD reflog are byte-identical afterwards.

**Archiving is allowed on a dirty tree.** It destroys nothing, and refusing would strand merged-but-dirty workspaces in the live fleet permanently. The manifest records it and the archived row wears an amber `uncommitted` badge. The dirty refusal belongs in reap.

**The one real cost, disclosed:** killing tmux discards the pane scrollback and any in-flight turn. That is why archive requires an affirmative idle and nobody attached. `ws-restore` runs `_spawn "$id" resume`, and Claude Code resumes the conversation from the on-disk transcript, so *context* is not lost — only the pane.

**Where archived is visible — folded, never hidden.** `FleetSession.archivedAt`; `groupFleet.ts` splits archived rows into a collapsed `Archived (3)` sub-fold at the bottom of each `ProjectCard`, using the existing `foldState.ts` localStorage mechanism. A fleet-footer row `Archived · 7 · 2.3 GB` routes to `ArchiveScreen`. `/s/<id>` still resolves, the transcript still renders, and `SessionHeader` gains an `archived · merged #42` chip. **Notification, after the fact:** `✓ merged · custom-tools › quiet-basin — PR #42 merged; workspace archived, nothing deleted.` Tapping navigates to the session. It promises nothing else — `PushPayload` is `{title, body, sessionId?}` (`push.ts:16-18`) and `push-sw.js` passes no `actions[]`, so any "tap to keep / tap to cancel" copy would be a straight lie on the lock screen.

`ws-restore` (no confirmation, it only creates): die unless `.archived`; die if `$workdir` is missing (point at `ccd ws-attic`); `rm -f "$REG/$id".{archived,archivedreason,archivemanifest}`; `_spawn "$id" resume`; `_reg_set started 1`; `_ws_supervise "$id"`. Note `ccd ensure` does **not** re-supervise (`ccd:937-944`), so restore must call `_ws_supervise` explicitly or boot persistence is silently lost.

### 5.2 `ccd ws-audit --session <id>` — read-only, and the source of the confirmation token

Runs only on an archived workspace. Emits one JSON object:

```json
{ "id","branch","base","workdir","project","repo",
  "exists":true,"headMatchesRegistry":true,
  "dirty":["M src/x.ts"], "ignored":[{"path":"node_modules/","bytes":412000000},…],
  "ignoredCount":3,"ignoredBytes":…, "sensitive":[".env","config/id_rsa"],
  "stashes":0,"worktreeBytes":…,"commitsAheadOfBase":4,
  "pr":{"number":42,"url":…,"mergeCommit":"7a68ca0","headRefOid":"…"},
  "merge":{"proof":"patch-id"|"tree"|"ancestor"|"cherry"|null,"fetchedAt":…},
  "transcript":"/home/…/.claude/projects/…/<uuid>.jsonl",
  "verdict":"reapable"|"<refusal-token>", "detail":"…",
  "token":"<sha256 or absent>" }
```

**`git ls-files --others --ignored --exclude-standard` is NOT used.** It enumerates per-file: measured 210,070 entries / 24.6 MB in `custom-tools` (the agent's `EXEC_MAX_BUFFER` is 8 MB) and 102,016 in the largest worktree on this box. A manifest capped at "20 + count" then shows twenty `.remember/logs/autonomous/*.log` lines and a number, and the one judgement the whole design depends on becomes structurally unavailable. Use **`git status --porcelain --ignored=matching`**, which collapses ignored directories to one entry each — verified: 3 lines for 4 files, `!! .env` / `!! dist/` / `!! node_modules/`. Entries are sorted **sensitive-first, then by bytes descending**, and the count and total bytes are never truncated.

`sensitive` = entries matching a small, non-rotting pattern set: `.env*`, `*.pem`, `*.key`, `*.p12`, `id_[dre]*`, `*.kdbx`, `credentials*`, `*.sqlite*`, `*.db`, `*.dump`, `*.sql`, `secrets*`. `.ccrc/` is **listed, not exempted** — ccd itself added it to `info/exclude` (ccd:206), so exempting it would create a blind spot ccd manufactured.

**`token` = `sha256` over a canonical serialisation of** `{id, branch, tip, headRefOid, mergeCommit, proof, dirtyCount, ignoredDigest, sensitiveDigest, stashCount, worktreeHead, baseOid}`. It is present **only when `verdict === "reapable"`**.

### 5.3 `ccd ws-reap --expect <token> --session <id>` — the only destructive verb

**Every guard below is evaluated inside `ws-reap`, on the box, at the instant of deletion.** The audit's verdict is not trusted; it is recomputed. The token is a *fingerprint of the world state that a human was shown*: any drift between the sheet rendering and the tap — a new commit, a new ignored file, a moved branch — changes the fingerprint and the reap refuses `state-changed`, naming what moved.

This is the fix for the design pattern where the refusals are client render decisions and `DELETE /api/sessions/:id/workspace` is three unconditional lines: a stale sheet, a second tab, a replayed request, or one line of `curl` removes every guard. Here it removes none of them. (The token is an anti-staleness device, not an authentication one: forging it requires knowing the exact current state, and if that state satisfies every independently re-checked guard, the reap was legitimate anyway.)

**REFUSE FIRST, TEAR DOWN SECOND** — ccd's own doctrine (ccd:249). Each refusal prints `{"refused":"<token>","detail":…,"paths":[…]}` on stdout and **exits 0**: a refusal is an answer, not an error.

*Phase A — identity*
| # | check | refusal |
|---|---|---|
| A1 | `$REG/$id.uuid` exists | `no-such-session` |
| A2 | `.workspace` non-empty | `not-a-workspace` |
| A3 | `.archived` exists | `not-archived` — you must archive first; that is the staging |
| A4 | `.project`, `.workdir`, **`.branch`** all non-empty | `incomplete-registry` |
| A5 | `-d "$workdir"` **or** a `.reaping` breadcrumb exists (→ resume, §5.6) | `worktree-missing` |
| A6 | `git -C "$wt" rev-parse --abbrev-ref HEAD` ≠ `HEAD` | `detached-head` |
| A7 | that value == `_reg_get branch` | `branch-drift` (prints both) |
| A8 | `git -C "$wt" rev-parse --git-common-dir` resolves under `$PROJECTS_ROOT/$project/.git` | `foreign-worktree` |

`.branch` is read from the **registry first**, worktree second — the reverse of `ws-rm`, which reads only the worktree (ccd:245-247), leaves `branch` empty when the directory is gone, and then deletes the registry that named it. That is how `ws/swift-harbor` became an orphan invisible to `ccd ls`, the PWA and `ws-gc` alike, in production, right now.

*Phase B — nothing local is lost*
| # | check | refusal |
|---|---|---|
| B1 | `git -C "$wt" status --porcelain` empty | `dirty-tree` (+ count) |
| B2 | `sensitive` subset of `--ignored=matching` is empty | `sensitive-ignored` (+ the paths, by name) |
| B3 | `git -C "$main" stash list` has no `On <branch>:` / `WIP on <branch>` | `stashes-present` |
| B4 | `git -C "$wt" rev-parse "@{upstream}"` resolves and `rev-list --count "@{upstream}..HEAD"` is 0 | `no-upstream` / `unpushed-commits` |

**On B2 and the ratchet.** Non-sensitive ignored content (`node_modules/`, `dist/`, `.venv/`, `.ccrc/`) is **listed with sizes and destroyed on confirm**. Refusing on *all* ignored content sounds safer and is not: `ws-add` runs `$main/.ccrc/workspace.sh` and appends `.ccrc/` to `info/exclude`, so every real workspace has ignored content within minutes, the gate never passes, the feature never fires, and the pressure lands on a repo-wide opt-out — which cannot even be reviewed, because `git add .ccrc/reap.conf` is refused by the exclude rule ccd itself wrote (verified, exit 1). A gate whose only escape hatch is mandatory in practice and invisible once pulled is not a gate. So the rule is narrow, permanent, and has **no override anywhere in ccrc**: secret-shaped files stop the reap and the sheet offers **Copy paths** so you can move them; everything else is named, sized, and goes.

*Phase C — the work is genuinely in main (§5.4)*

*Phase D — the session*
| # | check | refusal |
|---|---|---|
| D1 | wrapper status readable and not `busy` | `session-busy` / `status-unknown` |
| D2 | `--expect` token equals the recomputed fingerprint | `state-changed` (+ which fields moved) |

### 5.4 Squash merge — the explicit answer

**The stated case: `git branch -d` exits 1 and `merge-base --is-ancestor` says NO, while `gh` says `state: "MERGED"`.** Both are correct. `ws-reap` resolves it with a proof ladder, records which rung passed, and **never uses `git branch -D`**.

First, **proof 0 — identity binding**, which must hold before any mergedness proof is attempted:

```
git -C "$main" cat-file -e "${H}^{commit}"                       # PR head oid exists locally
git -C "$main" merge-base --is-ancestor -- "$H" "$tip"           # and is ours
```
else `pr-head-not-ours`. This is what makes a recycled slug or a stranger's fork PR incapable of authorising a delete.

Then, `M = mergeCommit.oid`, `Pm = M^1`, `tip = git rev-parse --verify refs/heads/$branch`, after `timeout 60 git -C "$main" fetch --quiet origin` (failure → `fetch-failed`, and `M` must exist locally afterwards → else `merge-commit-missing`). **Mergedness is never proven against an unfetched ref.** `ws-add` records `base=origin/main` and creates the branch `--no-track`, and nothing else in ccrc ever fetches — measured staleness on this box: `orchard-api` 24.0 days, six repos never fetched. A proof against a 24-day-old `origin/main` produces the sentence "this branch has 4 commits that are not in the merge" about commits that *are* the merge, which is byte-identical to the true warning and therefore trains users onto the unguarded door.

Ladder — **any one rung suffices**, and the passing rung is recorded in the tombstone and shown in the sheet. All four were measured in an isolated fixture:

| rung | test | genuine squash, base unmoved | genuine squash, **base moved** | true merge | control: squash + 1 real unmerged commit |
|---|---|---|---|---|---|
| `ancestor` | `git merge-base --is-ancestor -- "$tip" "$M"` | no | no | **YES** | no |
| `tree` | `git diff --quiet "$M" "$tip" --` | **EQ** | ne | — | ne |
| `patch-id` | patch-id of `git diff --binary "$(git merge-base -- "$tip" "$Pm")" "$tip" --` == patch-id of `git diff --binary "$Pm" "$M" --` | **EQ** | **EQ** | — | ne |
| `cherry` | `git cherry "$M" "$tip"` has no `+` lines | no (3 `+`) | no (3 `+`) | — | no (4 `+`) |

Three things fall out and all three are load-bearing:

- **Tree-equality alone is not sufficient.** It holds only when the base did not move between branch point and merge. On a busy repo that is the minority case, and a tree-only design false-refuses on almost every real squash — which is precisely the failure that pushes users to a one-tap unguarded delete. `patch-id` over the *whole-branch* diff covers it. This is not `git cherry`: cherry compares per-commit patch-ids and reports `+` for every commit of a multi-commit squash (confirmed here and in the ground truth on PR #590), so cherry is only ever a *rebase-merge* rung.
- **The dangerous control case fails every rung.** A branch on a squash-merged base plus one genuinely unmerged commit is rejected by all four. That is the entire point.
- **Argv shape is a correctness requirement, not style.** `git diff --quiet -- "$A" "$B"` exits **0** for any two shas — the revisions become pathspecs and the check silently passes. Verified. The mandated form is `git diff --quiet "$A" "$B" --`, and there is a unit test asserting the wrong form is not present in `ccd` (grep) and that the right form returns 1 on a known-different pair. Empty operands fail closed (exit 128) because every ref goes through `rev-parse --verify` first; `git diff --quiet "$base"..` style ranges are banned, since an empty right operand reads as "no differences".

If no rung passes → `tree-differs`, printing `git diff --stat "$M" "$tip" -- | head -5` and `git log --oneline "$M".."$tip" | head -5`, and the sheet says exactly: *"GitHub reports PR #42 merged, but ccrc cannot prove this branch's work is in the merge (checked: ancestor, tree, patch-id, cherry). Not removing anything."* No override exists.

### 5.5 Destruction order, and what prevents losing unpushed work

Only after every guard in A–D passes:

**(a) The attic, before anything is touched.** `git -C "$main" update-ref refs/ccrc/attic/<id>/<sha> <sha>` for every distinct sha in the worktree's HEAD reflog (`git -C "$wt" reflog show --all`), deduped, capped at 200, plus `tip`. This is the single cheapest complete fix for the problem every prior design left open: `git worktree remove` deletes `$GIT_DIR/worktrees/<slug>/logs`, and deleting a branch ref deletes its reflog, so any commit amended or `reset --hard`'d away inside the workspace becomes a dangling object with a `gc.pruneExpire` fuse (default 2 weeks) and no name. Attic refs cost ~50 bytes each, create no objects, and make those commits **referenced rather than dangling** — they cannot be gc'd at all. `ccd ws-attic --session <id>` lists them; `ccd ws-attic --drop <id>` (terminal only, not whitelisted) releases them.

**(b) The tombstone.** `$HOME/.cc-sessions/.reaped/<id>.json` — deliberately outside the `$REG/$id.*` glob that step (g) removes, and inside `checkPath`'s read prefixes so the server can read it with no whitelist change. Contains: all registry fields, branch, tip, merge oid, the proof rung that passed, PR number/url, the full ignored manifest **as it was at deletion** (paths and bytes), the resolved transcript path, the attic ref names, and the reflog dump. `ws-rm` today deletes `$REG/$id.uuid` and with it the id→transcript mapping; the transcript survives but becomes findable only by reconstructing an escaped path. Two lines fix that permanently.

**(c) Breadcrumb.** `_reg_set "$id" reaping "<phase>"` written **before** the first destructive step and updated at each step. This is what makes the whole sequence resumable (§5.6).

**(d)** `_ws_unsupervise "$id"` (idempotent; already done by archive).
**(e)** `tmux kill-session … 2>/dev/null || true`.
**(f)** `git -C "$main" worktree remove "$workdir"` — **no `--force`**. On failure: **stop here**, leave the registry intact, print `{"refused":"worktree-remove-failed"}`, breadcrumb stays. The session is already stopped and `ccd ws-restore` recovers it; losing the registry would not be recoverable.
**(g) Branch deletion.** Do **not** rely on `git branch -d`'s semantics in either direction: it refuses on a squash merge even when the work is byte-identically in main, and it *succeeds* when the branch merely equals its upstream. Since mergedness was already proven independently and the attic already holds every sha, delete deterministically with compare-and-swap:
```
git -C "$main" update-ref -d "refs/heads/$branch" "$tip"
```
CAS aborts if the ref moved between proof and delete. `git branch -D` appears nowhere in the design. If `update-ref` fails → **stop and refuse**; an orphaned branch is a bug, not an outcome, and it is never swallowed with `|| true`.
**(h)** `rm -rf` the clips directory — only after re-validating `$id` and asserting the resolved path is a direct child of `$HOME/.cc-clips`. Note these are **full-resolution originals**, not thumbnails (3.8 MB single files observed on this box), so the tombstone records their **filenames and sizes**, not a count, and the manifest shows them.
**(i)** `rm -f "$REG/$id".*` — **last**, so a crash anywhere above leaves a findable workspace rather than an invisible branch. This also clears the breadcrumb.
**(j)** Print `{"reaped":…,"branch":…,"pr":42,"proof":"patch-id","tombstone":…,"attic":17,"bytes":…}`.

**Never touched:** Claude Code transcripts (`~/.claude*/projects/…/*.jsonl`), the `.ccrc/` line in the shared `info/exclude` (shared across every worktree of the repo), `~/.cc-limits` (keyed by wrapper, not session).

**The user-facing confirm** (`ReapSheet`, `QuickConfirm` grammar, primary carries the byte count and the literal slug):

```
Remove quiet-basin?                                    [ Remove quiet-basin · 1.2 GB ]

  branch      ws/quiet-basin — merged in #42 (proof: patch-id), 6 days ago
  worktree    ~/worktrees/custom-tools/quiet-basin        1.2 GB
  uncommitted none
  not in git  3 entries, 412 MB — node_modules/ · dist/ · .ccrc/     [show all]
              These are in no commit and cannot be recovered.
  stashes     none
  kept        transcript, and 17 commits pinned in the attic (ccd ws-attic)
```

### 5.6 Partial failure and resume

`ws-reap` opens by reading `$REG/$id.reaping`. If present, it **resumes** rather than refusing: re-validate `refs/heads/$branch == $tip` from the tombstone, then continue from the recorded phase. Refusing on a missing worktree is right when the *user* deleted it and wrong when *we* did, and the tombstone written at (b) distinguishes them. Without this, one SIGTERM at the outer timeout wedges the workspace into `worktree-missing` forever while the tombstone simultaneously reports it cleaned up, and the user's only exit is hand-run `ccd ws-rm` — which orphans the branch, reproducing the exact production bug.

`mkdir "$REG/.reap-$id.lock"` (atomic) guards concurrent invocations; a second caller exits 0 with `{"refused":"in-progress"}`. Note bash's EXIT trap releases the lock on SIGTERM while an orphaned `git worktree remove` grandchild keeps running — so the **breadcrumb, not the lock, is the recovery mechanism**.

`ws-gc` gains an `archived` state in `_ws_gc_row` and its `--prune` declines it; `_ws_gc_dead_regs` must additionally skip any id with `.archived` or `.reaping`, and must never remove `.reaped/` (a directory, so it does not match `*.workspace`, but assert it).

---

## 6. Error handling

`{"refused":…}` and `{"phase":"unknown","reason":…}` are printed on **stdout with exit 0**; only genuine faults exit non-zero. Refusal tokens map to sentences in `prstate.ts`/`wsaudit.ts`, so the UI never renders a raw shell string.

| condition | detection | ccrc state | UI | destructive action |
|---|---|---|---|---|
| **Offline** (30 s blocking hang; `gh pr list` has no `--timeout`) | `timeout 12 gh` → exit 124 | `phase:'unknown', reason:'timeout'`; persisted `prPhase` untouched | cap grey/dashed, last known number, "last checked 6m ago", **Retry** | none — reap needs a fresh fetch, `ws-audit` returns `fetch-failed` |
| **Network unreachable** | stderr `dial tcp` / `no such host` / `proxyconnect` | `reason:'offline'` | same | none |
| **Unauthenticated** (token revoked) | non-zero + `gh auth login` / `not logged in` / `HTTP 401`; `gh auth status` probed only **after** a failure, itself under `timeout` | `reason:'unauthenticated'`, backoff jumps straight to the 15 min ceiling | "GitHub CLI isn't logged in on the sessions box. Run `gh auth login` there." Create **disabled** — the one case we know would fail | none |
| **Rate limited** | `HTTP 403 … rate limit` | `reason:'rate-limit'`, flat 15 min | reason + retry time | none |
| **Partial sweep** (one repo fails, others succeed) | per-repo call, per-repo backoff | only that repo's rows go `unknown` | per-session honesty | none for that repo |
| **ccd verb missing on the box** (deployed `ccd` is a copy, not a symlink) | agent `hello` advertises `ccdVerbs`; usage-line stderr as a backstop | `reason:'unsupported'` | cap shows `PR ?`, sheet explains the fleet host needs a ccd update. **No merged-purple dot that never resolves** | none |
| **Agent link down** | `!fleetState?.connected` | sweep skipped entirely; states keep their `checkedAt` | staleness shown | none — archive and reap both ride the sweep |
| **`ws-reap` killed mid-flight** (SIGTERM at the outer timeout, agent disconnect, server restart) | breadcrumb `$REG/$id.reaping`; `execFile` yields `code:1, stderr:''` | server maps **empty stderr + non-zero exit** to **`indeterminate`**, never "failed" | "ccrc lost contact while cleaning up. Re-open the workspace to see its state." Next `ws-audit` reports the breadcrumb explicitly instead of "0 files" | resumes from the breadcrumb |
| **`worktree remove` refuses** | non-zero from git | breadcrumb retained, registry intact | git's stderr verbatim + **Retry** | stops; nothing further deleted |
| **`update-ref -d` fails** (ref moved) | non-zero | breadcrumb retained | "the branch moved while cleaning up — nothing was deleted after the worktree" | stops; branch intact, never `-D` |
| **Registry says workspace, worktree gone** | A5 | `worktree-missing`, unless a breadcrumb explains it | "the worktree is already gone; the branch and registry are still here" + `ccd ws-attic` guidance | none — but reap can complete the branch/registry half *only* via breadcrumb resume |
| **Registry branch ≠ worktree HEAD** | A7 | `branch-drift`, both names printed | "you have `feat/x` checked out here, not `ws/quiet-basin`" | none |
| **Registry incomplete (`.branch` empty)** | A4 | `incomplete-registry` | plain sentence | none — this is the state where `ws-rm` orphans a branch |
| **State moved between audit and confirm** | D2 token mismatch | `state-changed` + which fields | "this workspace changed since the list you were shown — here is what's different" + re-audit button | none |
| **Two PRs share a merge-commit oid** | — | oid used only as a *commit to prove against*, never as identity | — | both prove correctly |
| **Fork PR claims our branch name** | `isCrossRepository` + proof 0 | never binds | — | unreachable |

---

## 7. Deliberately out of scope

- **Merging from ccrc.** No merge, close, reopen, edit, review or comment verb exists. Merging is the irreversible review decision and requires the diff; the sheet links to GitHub and says so.
- **Automatic deletion of anything, at any delay.** No timer, no grace window, no "reclaim opens in 11 days", no auto-purge of archived workspaces. `reap` fires only from a confirmed tap carrying a fresh fingerprint. The only automatic pressure is the existing `ws-add` disk floor, whose message is extended to name the archived set and `ccd ws-attic --list`.
- **Cleanup of `closed`-unmerged PRs.** A closed PR's commits are *not* on main; removing that workspace is precisely the destroy-unpushed-work case, and `closed` is a state a remote party can set. Terminal only.
- **Any override for `sensitive-ignored`, `tree-differs`, `dirty-tree`, `unpushed-commits` or `stashes-present`.** No flag, no config file, no "Remove anyway". Move the files, or use a terminal.
- **`ws-gc` from the PWA**, in any form. `['ws-gc']` would permit `--prune`.
- **`gh` in `EXEC_WHITELIST`**, in any form, including `[['pr','view']]` and `[['api']]`.
- **Prompt injection as a mechanism for anything**, and any UI action carrying GitHub-sourced text into a session.
- **Editing the PR body on the phone.** Title is editable; body is a preview. Edit prose on GitHub.
- **Deleting `~/.claude*` transcripts, the `.ccrc/` line in `info/exclude`, or `~/.cc-limits`.**
- **Attic garbage collection.** Attic refs are dropped only by an explicit terminal command.
- **Multi-remote / non-`origin` repos, and PRs across forks.** `isCrossRepository:false` only.

---

## 8. Inherited fatal-flaw ledger

| flaw raised against a part kept here | resolution |
|---|---|
| Refusals are client-render decisions; `DELETE …/workspace` re-checks nothing (stale-audit confirm) | The route is **deleted**. `ws-rm` leaves the whitelist. Every guard is re-evaluated inside `ws-reap`, plus the `--expect` fingerprint, which the whitelist pins as mandatory. |
| Ignored-file manifest truncates at 20 of 210,070 → the human judgement is unavailable | `--ignored=matching` collapses directories (3 lines for 4 files, verified); sorted sensitive-first then by size; counts and bytes never truncated; secret-shaped entries hard-refuse. |
| "The session asks you before it pushes" is false — `--dangerously-skip-permissions` | That approach is rejected outright and the reason recorded. The write is one bounded ccd verb with an explicit `QuickConfirm`. |
| Fork PRs match `--head`; the tie-break hands the badge to a stranger | `isCrossRepository === false`, `baseRefName` match, and proof 0 (`headRefOid` locally reachable from our tip). |
| `closed` state was a live path to `ws-rm` | `closed` never archives and never offers cleanup. |
| No timeout on the destructive call; non-atomic tail; empty stderr reported as "failed"; retry's audit certifies "0 files" | `timeoutMsFor(cmd, args)` + raised agent `MAX_EXEC_TIMEOUT_MS`; breadcrumb-journalled tail with resume; empty stderr + non-zero → **indeterminate**; audit reports the breadcrumb. |
| A second, unguarded one-tap delete exists in `SessionActionsSheet` | Rewired to the audit→confirm flow; the false comment removed; the underlying route no longer exists. |
| `treeEqualsBase` computed against a never-fetched `origin/main` (24 days stale) | Mandatory fetch; proof is against the PR's own merge commit; `fetch-failed` is a refusal, never a claim about the user's commits. |
| Two "independent" witnesses share a failure mode; `git diff base..branch` fails open on an empty operand | Four independent rungs, all measured; `rev-parse --verify` on every ref; `--` after revisions (the `-- A B` fail-open is tested against); empty operands fail closed at 128. |
| `.prphase` stamped by branch name over a recycled 144-slug namespace becomes an unfalsifiable false witness | No phase file. Level-triggered. Binding is `headRefOid` reachability, not branch name. |
| At-most-once edge: transition consumed on one box, never received on the other | Level-triggered; `ws-archive` idempotent; retried every 120 s. |
| `pr !== null` visibility conflates "not eligible" with "not checked"; Retry lives behind the missing cap | Cap always renders for workspaces; `unchecked` is a first-class state; `checkedAt` persisted in the registry. |
| The merged sheet claims "archived" from `phase` | All archive copy derives from `archivedAt`. |
| `--body-file <any path>` exfiltrates `~/.config/gh/hosts.yml`; caller flags override `-R` | No path-taking flag exists; body is base64; fixed arity; no `"$@"` passthrough. |
| `pr-open` on a main checkout pushes to `main` | Workspace-only guard, and `head != base`. |
| `--drop-ignored` / `--now` / `--force-branch` are whitelist-legal | None of them exist. |
| `ignored=discard` ratchet: the gate never passes, the opt-out is unreviewable | Only the narrow secret-shaped subset refuses; no opt-out anywhere. |
| Consent gate lives server-side and fails open into deletion | The consent *is* the `--expect` token, checked in ccd; absent or mismatched → refuse. |
| `rm -rf ~/.cc-clips/$id` outside all guards; only a count recorded | Id re-validated, path asserted to be a direct child, filenames and sizes recorded in the tombstone and shown in the manifest. |
| Reflogs destroyed → amended-away commits dangle with a 2-week fuse | Attic refs pin every sha from the worktree reflog before anything is removed. |
| "tap to keep" promises an action `PushPayload` cannot deliver | Notifications promise only navigation, and are sent **after** the archive has already happened. |
| Gate 4 wedges a crashed reap permanently | Breadcrumb resume. |
| `ccd ensure` does not re-supervise | `ws-restore` calls `_ws_supervise` explicitly. |
| `liveStatus` fails open to `idle` and kills a running turn | `archiveSafety` has an explicit `unknown`; both server and ccd fail closed. |
| Server argv proven against the whitelist but not against the deployed `ccd` | `ccd caps` + `hello.ccdVerbs` + an `unsupported` UI state. |

## Definition of done

Agent suite green at 86 + additions, with `whitelist-noghosts.test.ts` failing loudly by design if a `gh` key is added. `server/test/whitelist-subset.test.ts` layers 1–3 green, including the static scan for inline argv literals and the superset assertion. `server/test/ccdPrHelpers.ts` (isolated-`HOME` bash harness modelled on `ccdWsHelpers.ts:16-28`, `gh()` stubbed as a shell function) covers, first and foremost, the **multi-commit squash with a moved base** — plus base-unmoved squash, true merge, rebase merge, the control case (squash + one real unmerged commit → `tree-differs`), dirty, untracked, ignored-only, sensitive-ignored, stashed, unpushed, detached, drifted, worktree-gone, breadcrumb-resume, `state-changed`, and gh timeout/401/`[]`. Every negative case asserts the worktree still exists afterwards.

Suggested location once saved: `docs/superpowers/specs/2026-07-29-ccrc-pr-lifecycle.md` → [ccrc PR lifecycle](https://server-box.tailnet-example.ts.net/OpenClawHetzner/specs/2026-07-29-ccrc-pr-lifecycle.md)