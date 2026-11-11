# Adding a project from the console

**Status:** draft, rev 2 (prototype scope; rev 2 folds in the three review lenses)
**Date:** 2026-11-04 · **Base:** origin/main 7b362246a
**Plan:** none for the prototype. It ships as one PR. Any deviations are issued by `POST /api/ledger/deviations` when they are found.

## In short

The operator asked for this: *"add a new project to ccrc, from a GitHub repo or empty, to the project list, from the UI."*

Today a project is a directory under the projects root on the fleet box. Only someone with a shell there can create one, by running `git clone` into `~/projects` by hand. The prototype adds one door for it:

- **PWA:** a **New project** door above the fleet list (on its runs line) and in the first-run panel, and an inline add in the
  **Start a session** sheet (§2, redrawn 2026-11-09). The form has two choices:
  - **From GitHub:** `owner/repo`, a github.com URL, or the scheme-less `github.com/owner/repo` a browser's address bar gives.
  - **Empty:** a fresh `git init`.
  
  The name field is prefilled from the repo and can be edited.
- **Server:** `POST /api/projects`. A pure decider (L1) validates the body and builds a `CcdArgv`. The route runs it and maps the result to a status.
- **ccd:** a new verb, `ccd project-add --name <n> (--url <u> | --empty)`. It is the only code that writes the new directory. It clones or inits into a dot-named temp directory under `$PROJECTS_ROOT`, then moves the result into place. It refuses an existing name.
- **Agent:** one gated grant, `['project-add','--name']`, enrolled in `REQUIRED_VERB_FLAG`.

The new directory is listed by the existing `GET /api/projects` walk. The route drops the walk cache on success, and on an outcome it could not learn, so the new card appears on the next read and not 30 s later.

## 1. What is true on main today

| piece | today |
|---|---|
| project list | `listProjects` (`server/src/lifecycle.ts`) lists every non-dot directory under `cfg.projectsRoot`, unioned with registry workdirs. It skips linked worktrees. The listing is cached by `ProjectWalkCache` for `PROJECT_WALK_TTL_MS` (30 s), and the cache has no way to invalidate it. |
| ccd's root | `PROJECTS_ROOT="$HOME/projects"`, hard-coded with no override. A test points it elsewhere through `HOME` alone. |
| name grammar | `_ws_project_valid` (ccd) and `isWsProject` (`shared/slug.ts`): `^[A-Za-z0-9._-]+$`, with no leading `.` or `-`. |
| workspace create | `cmd_ws_add` needs `$PROJECTS_ROOT/<p>/.git` to be a directory and `refs/remotes/origin/HEAD` to exist. Without them it dies with `no origin/HEAD`. |
| session create | `cmd_start <wrapper> <project>` runs in the main checkout and needs no remote. |
| exec surface | The agent runs only `tmux` and `ccd` from `EXEC_WHITELIST`. `git` and `gh` are in `FORBIDDEN_COMMANDS`. A clone therefore has to live inside a ccd verb. |
| exec timeout | The server runner's default is `CCD_TIMEOUT_MS` (90 s), with per-verb rows in `CCD_VERB_TIMEOUT_MS`. The agent clamps every exec to `MAX_EXEC_TIMEOUT_MS` (300 s). |

## 2. The user flow

Redrawn on 2026-11-09, after the operator could not find the first prototype's grey row under the last project card.
An operator adds a project because they want to work in it, so the main way in is the **Start a session** sheet, where
they notice the project is missing. The fleet screen keeps a visible door just above its list.

```
 Fleet ─────────────────────────────
  Runs · 8 active  [Automatic ▾] [+ New project]   ← on the runs line; a row of its own where none
  [project cards …]

 ┌ Start a session · step 2 ─────────┐
 │ [ example/new-thing           ]   │   ← search; a repo or a new name offers an add
 │  +  Clone example/new-thing       │   ← one tap: clone, then pick it
 │     From GitHub, as project …     │
 │  +  New project                   │   ← when the search is blank: opens the form here
 │  ❯  project-a …                   │
 └───────────────────────────────────┘

 ┌ Sheet: Add a project ─────────────┐   ← the fleet door's sheet; the same form, inline
 │ ( • ) From GitHub   (   ) Empty   │     in the session sheet with "‹ Back to projects"
 │ Repository  [ owner/repo or URL ] │
 │ Name        [ repo            ]   │  ← prefilled from the repo, editable
 │ <refusal line, in the sheet>      │
 │ [ Add project ]   [ Cancel ]      │
 └───────────────────────────────────┘
```

- **The session sheet's search offers** (`projectSearchOffer`, `pwa/src/fleet/projectAddWords.ts`):
  - A search that parses as a GitHub repository offers **Clone owner/repo**. When the repo's project already exists, the
    sheet shows that project instead.
  - A search that is a valid new name and matches no project offers **Create empty project <name>**.
  - A tap fills the form and sends it. When the repo's own name cannot be a project's (`.github`), the tap opens the form
    and waits for a name.
- **On success in the session sheet:** the sheet goes back to its list, re-reads it and picks the new project.
- **On success from the fleet door:** the sheet closes and shows the toast `Added project <name>`, with the action
  **Start session**. That action opens the session sheet, which picks the project once an account is chosen. A project
  in another pool is never picked for the operator: the sheet opens its disclosure instead.
- A refusal stays in the form, and the typed text is kept.
- An empty project can take a session started in its main checkout. It cannot take a workspace until it has a GitHub
  `origin`, because `ws-add` refuses with `no origin/HEAD`. The success toast for the Empty choice says so.
- The fleet door rides the runs line, the full-width row just above the list, because a row of its own pushed the
  first session row past the phone's height budget (`refined-phone.browser.test.ts`). Where no runs line is drawn
  (Instrument's desk column) it takes a row of its own.
- The first-run panel (a fleet with no sessions) keeps its own **New project** button: it has no list.

## 3. The shared vocabulary (L0, `shared/projectAdd.ts`)

This module is pure and imports nothing, so the PWA and the server parse input the same way:

- **`PROJECT_NAME_MAX = 64`.** Workspace ids are `<project>-<slug>` and capped at `WS_ID_MAX` (128). A new project's name must leave room for a slug.
- **`isNewProjectName(s)`.** `^[A-Za-z0-9][A-Za-z0-9._-]*$`, at most `PROJECT_NAME_MAX` bytes, and not ending in `.git`. This is stricter than `isWsProject`, and any name it accepts also passes `_ws_project_valid`.
- **`parseGithubRepo(input)`** returns `{ owner, repo, url } | null`, after trimming surrounding blanks. It accepts four shapes:
  - `owner/repo`
  - `https://github.com/owner/repo` (optional `.git`, optional trailing `/`)
  - `github.com/owner/repo`, the same with no scheme (optional `.git`, optional trailing `/`), normalised to HTTPS
  - `git@github.com:owner/repo(.git)`

  The segment rules, which ccd's copy implements exactly (§4):
  - **owner:** `^[A-Za-z0-9][A-Za-z0-9-]*$`. GitHub owners have no dots or underscores. So `owner.with.dot/repo` is refused, and so is `github.com/owner` read as the short shape, because its "owner" `github.com` has a dot.
  - **repo,** after stripping ONE trailing `.git`: `^[A-Za-z0-9._][A-Za-z0-9._-]*$`, not `.` or `..`, and not itself ending in `.git`. A leading dot or underscore is allowed, so GitHub's own `owner/.github` and a `owner/_tools` parse. A leading dash never is, so the url can never read as an option. The url is its own token after `--` anyway (§4).

  The result's `url` is `https://github.com/<owner>/<repo>.git`, or for the SSH shape `git@github.com:<owner>/<repo>.git`, so the transport the operator chose is kept. These two are the only shapes ccd accepts. Every other host, scheme, or extra path segment answers `null`.
- **`deriveProjectName(repo)`** returns the repo name (`.git` already stripped by the parse) when `isNewProjectName` accepts it, else `null`. So `owner/.github` and `owner/_tools` need a typed name: a new project's name cannot lead with a dot or an underscore.
- **Wire types.** The request body is `ProjectAddBody = { source: 'github', repo: string, name?: string } | { source: 'empty', name: string }`. A successful answer is `ProjectAddAnswer = { ok: true, name: string, source: 'github' | 'empty' }`.

## 4. The seam

### ccd (AGENT-FIRST)

The verb is `ccd project-add --name <n> (--url <u> | --empty)`.

- It parses flags in the strict `cmd_project_pool` style. Each flag may appear at most once, `--url` and `--empty` are exactly one of two, and any other word is a usage error.
- It validates before it touches anything:
  - `_ws_project_valid` plus ccd's own copy of the stricter new-name rule: a leading alphanumeric, at most 64 bytes, no `.git` suffix. A parity test pins this rule against `isNewProjectName`.
  - The URL must be exactly `https://github.com/<o>/<r>.git` or `git@github.com:<o>/<r>.git`, with §3's owner and repo segment rules, matched under `LC_ALL=C`. A URL that does not match is refused. The parity test (`project-add-parity.test.ts`) holds ccd's match equal to the urls `parseGithubRepo` emits.
- It refuses `project exists: <name>` when `$PROJECTS_ROOT/<name>` exists, including as a file or a link.
- **Clone:** `GIT_TERMINAL_PROMPT=0 git clone --quiet -- <url> <tmp>`. ccd sets `GIT_SSH_COMMAND` to `ssh -o BatchMode=yes` only when the box chose no ssh command of its own: `GIT_SSH_COMMAND`, `GIT_SSH` and `core.sshCommand` all unset. The environment variable overrides both of the others, so setting it over a box's `core.sshCommand` (a deploy key, say) would make a clone that works by hand fail. With the default, a private repo with no credential fails fast instead of waiting on a prompt.
- **A bound inside ccd:** the `git clone` or `git init` runs under `_plat_timeout` at `PROJECT_ADD_GIT_S` (220 s), below the runner's 240 s row. A clone past it dies inside ccd, which removes its own temp directory and dies `git clone timed out for <name> after 220s`. Without it, the agent's deadline kills only the ccd bash process, and the orphaned `git clone` keeps writing a full copy into the temp directory with nobody left to remove it.
- **Empty:** `git init --quiet -b main <tmp>`. No commit is made, because ccd does not invent an author identity.
- `<tmp>` is `$PROJECTS_ROOT/.project-add.<name>.<pid>`. The walk skips dot names, so a half-built tree is never listed. ccd moves it to `$PROJECTS_ROOT/<name>` only after a second existence check, by `_plat_mv_notdir`. On failure it removes its own temp directory and passes git's stderr through. A temp this pid already holds (a killed run's) is refused, never adopted or deleted.
- On success it prints `added <name>` on stdout.
- It adds `project-add` to the dispatcher, to `cmd_caps` and to the usage line, plus a `contexts.tsv` row. No capability token is needed, because the verb has no flags to gate.
- **Growth:** `ccd/ccd` takes at most 40 net code lines (`growth-check`).

### Agent

- Grant `['project-add','--name']` in `EXEC_WHITELIST.ccd`, enrolled in `REQUIRED_VERB_FLAG`.
- Add bypass fixture `g26-project-add-without-name.ts`.

### Server

- Two `CCD_ARGV` entries follow the `start`/`enable` rule, which picks the entry instead of parameterising one builder:
  - `projectAddClone(name, url)` builds `['project-add','--name',name,'--url',url]`.
  - `projectAddEmpty(name)` builds `['project-add','--name',name,'--empty']`.
- Both `CCD_CAN` rows are `verbRow('project-add')`. An older ccd answers `501 unsupported`.
- `CCD_VERB_TIMEOUT_MS['project-add']` is 240 000 ms.
- `server/src/projectAdd.ts` is L1 in context C4 (Workspace Lifecycle), beside `workspaceCreate.ts`. ccd's `cmd_project_add` and its two helpers are C4 in `ccd/contexts.tsv`, and the PWA's `fleet/AddProjectSheet.tsx` and `fleet/projectAddWords.ts` are C4 in the architecture spec's table, so every side names the concept in one context. `planProjectAdd(body, box)` takes the deployed ccd's caps too, because the code that builds the argv must ask `ccdCan` (`verb-gate`). It returns one of:
  - `{ kind: 'refuse', error: 'bad-request' | 'bad-source' | 'bad-project' | 'unsupported' }`, decided in that order
  - `{ kind: 'run', name, source, argv }`, where `argv` comes from one of the two entries.

  The name is trimmed. For a GitHub body without a name, or with a blank one, the name comes from the repo.
- `classifyProjectAddFailure(res)` returns `exists`, `unknown` or `other`. A not-ran result (`ran === false`) is never a refusal, whatever its text says:
  - `unknown` when the runner's `reason` is `timeout` (the server's own wait expired) or `transport` (the agent link failed). The runner may have started ccd, and ccd may still finish the clone and move it into place: the agent's exec keeps running when the link drops.
  - `other` when the reason is `spawn`: the runner knows ccd never started, so nothing was added.
  - Of ccd's own answers, `project exists: <name>` is `exists`; everything else is `other`.
- The route is `POST /api/projects` in `server.ts`. It is session-gated when auth is armed and consults no box token, as the pool route does.
  - It runs `plan`, then `deps.runCcd`, then reads a failure through `classifyProjectAddFailure`.
  - On success it calls `projectWalk.drop()` and answers `{ ok: true, name, source }`.
  - On `unknown` it calls `projectWalk.drop()` too and answers `502 outcome-unknown`, so the sheet can say the project may have been added and the re-read shows what the box holds. A retry that then answers `409 project-exists` does not contradict an earlier "failed".
  - On `exists` it answers `409 project-exists`; on `other`, `502` with the stderr.
- Refusal words go in `shared/refusal.ts` as a typed group, `PROJECT_ADD_REFUSALS = ['bad-source', 'project-exists', 'outcome-unknown']`. `outcome-unknown` is not new: it is the account routes' word (`ACCOUNT_ROUTE_REFUSALS`, `shared/api.ts`) with the same meaning, "the box may have acted, re-read". A word has one status in `REFUSAL_STATUS`, so it keeps its 502 there; it is listed in the group so every reader of the group (the sheet's sentences) answers it. `bad-project`, `bad-request` and `unsupported` are reused.
- `ProjectWalkCache.drop()` is a new method. It forgets the kept walk, and a walk that started before the drop is not kept when it finishes, unless the clock has since stepped back past the drop.

### PWA

- `api.projectAdd(body)` goes through `postRead`, with its reader in `lib/wireReaders.ts`.
- `addProject` sits on the `useProjectRows` plane and refreshes through `refreshProjects`. That hook stays the one reader of `/api/projects`.
- `fleet/AddProjectSheet.tsx` is built from `Sheet`, `RadioFieldset`, `TextInput` and `Button`, on the `AddWorkspaceSheet` model.
- `fleet/projectAddWords.ts` holds the sentences, driven by a table (`refusalText`) so the literal ratchet does not grow.
- The opener lives in `FleetChrome` and `FleetFlows`. The entry rows are in `FleetScreen` (the list foot and the first-run panel).

## 5. Safety

- ccd deletes nothing but its own temp directory, which it created in this run. One window is left, and it is recorded rather than closed: between the second existence check and the move, a process of the same user can create `$PROJECTS_ROOT/<name>`, in a window of milliseconds. The move then replaces what that process just made there: a file or a link (on darwin `_plat_mv_notdir` removes a link to a directory with `rm -f`, the link only, never its target, then `mv -f`), or on Linux an empty directory (`mv -fT`, one rename(2)). A non-empty directory is never replaced: darwin refuses any real directory, and rename(2) fails on a non-empty one. So the cost is bounded to something created inside that window, not a project that stood before the add. Taking the name first with an atomic `mkdir` would close it; the prototype does not.
- The clone uses the fleet box user's git credentials, read-only. Nothing is pushed.
- Only github.com is accepted, in two exact URL shapes, and `--` comes before the URL, so `ext::`, `file://` and option injection are refused twice: by the L0 parser on the server and by ccd's own match.
- The verb is not added to `FORBIDDEN_CCD_VERBS`. A session may create a project, which is no worse than its own `git clone`. A later stage can revisit this.
- A box with a non-default `CCRC_PROJECTS_ROOT` lists a different directory from the one ccd writes (ccd's root is `$HOME/projects`, §1), which is the same split that `ws-add` already has. There the route answers 200 `Added <name>` and the card never appears, because the server walks the other directory. The prototype records this and does not fix it.
- **Local mode has no deadline on the runner.** `realRunner` (`server/src/exec.ts`) passes no timeout to `execFile`, so the 240 s row applies to the remote runner only. ccd's own 220 s git bound still applies in local mode, so a stalled clone still ends there; what local mode lacks is a server-side bound on ccd as a whole.
- **A cloned EMPTY GitHub repository** (one with no commits) clones with exit 0 and has no `refs/remotes/origin/HEAD`. `ws-add` then refuses it with `no origin/HEAD`, exactly as it refuses an Empty project, and the toast says only `Added <name>`. Stage 3 covers both.

## 6. Stages

| # | stage | ships alone because |
|---|---|---|
| P | **Prototype**, this PR: the verb, the grant, the route and the sheet | It is the whole loop, and an older ccd answers 501 |
| 2 | GitHub repo creation for the Empty choice (`gh repo create` stays forbidden to the agent, so this needs its own design) | — |
| 3 | A local origin or a no-origin `ws-add` path, so an empty project, and a clone of an empty GitHub repository, can take workspaces | — |
| 4 | Clone progress, and a sweep for dot-named leftovers of a clone killed from outside ccd (a signal, a reboot); ccd's own 220 s bound already removes its temp | — |

## 7. Rejected

- **Running `git` from the server or agent directly.** `git` and `gh` are forbidden commands, and the agent's exec surface is closed.
- **Creating an empty project with a local bare origin under `~/.ccrc`.** It invents a fake remote that PRs and the landing train cannot use. *Superseded by D-8193 (`docs/superpowers/plans/2026-11-10-empty-project-born-ready.md`): an Empty project now gets a local bare origin, so it takes workspaces; pull requests still need a GitHub remote.*
- **A capability token.** The verb's name in `ccd caps` is enough. `verbRow` refuses on an older ccd once caps are measured.

## 8. Verification

- **ccd** (`server/test/ccd-project-add.test.ts`, fixture HOME): usage errors, bad name, existing name, bad URL, clone and empty init. Clone tests use a local bare origin, reached through `url.<local>.insteadOf=https://github.com/` set by `GIT_CONFIG_*` env. A failed clone must leave no directory, named or dot-named.
- **Census suites:** `ccd-verb-sets`, `whitelist-subset`, `id-argv-census`, `ccd-can-sites`, `verb-gate`, `ccd-contexts`, the agent's whitelist and structural tests, `auth-gate` route counts, `refusal-status`, and ring totality.
- **Unit tests:** L0 parser cases, the L1 plan, the route through `buildServer` with a fake `runCcd`, the PWA sheet, the words, the plane and the api pin.
- **Visuals:** a blind ui-verifier pass on the sheet at phone and desktop widths.
