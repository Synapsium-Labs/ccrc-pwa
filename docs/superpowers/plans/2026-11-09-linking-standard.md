# The linking standard: every project's PRs reach their Linear ticket, by the repository's visibility: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:test-driven-development (red first, then green). One PR,
> ordered commits, one per task, each green before the next. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Sequencing.** The first commit carries this plan and nothing else. Tasks 1 to 3 land the vocabulary, the store and
> the reads; Task 4 and Task 5 add the two ccd verbs (agent-first on deploy: the server reads `verbRow` support, so an
> older ccd answers `unsupported`, never a wrong reading); Tasks 6 to 8 use them. `shared/api.ts`, `server/src/server.ts`,
> `server/src/watch.ts` and `ccd/ccd` are hot files: each task's hunk there is a few lines that call a new module, and
> the rest lives in new files.

**Goal:** the Linear linking convention becomes ccrc's standard for every project it works on, set from the console
by any installer. A **private** repository carries the ticket id: in the branch name (`ws/key-123-…`), in the PR body
(`Closes KEY-123` when the merge meets the ticket's acceptance, `Refs KEY-123` when a live check is owed) and in
commits (`Related: KEY-123`); Linear's GitHub integration links and closes from those. A **public** repository never
carries a tracker id: the PR is linked from the Linear side with `ccrc-api linear link <REF> --url …` (D-8141) and its
body cites the ticket's GitHub mirror issue (`Closes #n` / `Refs #n`). ccrc decides which rule applies from the
repository's GitHub visibility, read and cached, with an operator override, and each project carries its Linear team
key, set and shown in the console and readable by sessions.

**Architecture (short):**
- **L0** `shared/linking.ts` (new): the words (`RepoVisibility`, `LinkingOverride`, `LinkingMode`), the wire
  (`ProjectLinkingWire`, `LinkingShowAnswer`, `LinkingWriteBody`) and the refusal words. `ProjectRow` gains one
  optional `linking` cell (one line in `shared/api.ts`). The team key's grammar is `shared/linear.ts`'s
  `LINEAR_TEAM_KEY_SHAPE`; no second one.
- **L1** `server/src/linking/policy.ts` (new): `linkingMode` (override wins; measured `private`/`internal` is private,
  `public` is public, nothing measured is `unknown`), `ticketRefOfBranch`, `trackerIdsIn`, `parseLinkingWrite`,
  `visibilityDue`. Every rule about the convention is decided here and nowhere else.
- **L3** `server/src/coord/linkingStore.ts` (new, `reviewCapStore.ts`'s idiom): one table, `project_linking`
  (migration 52), with two writers of two facts: the operator's settings (team key, override) and the measured reading
  (visibility, slug, template, when).
- **L4** `server/src/linking/routes.ts` (new): `POST /api/projects/:project/linking` (the operator's write),
  `POST /api/projects/:project/pr-template` (the operator's template PR) and `GET /api/linking` (a session's read, box
  token and attribution, through `ccrc-api linking show`). The `linking` cell on `GET /api/projects` is read from the
  store per request. The measurement rides the PR sweep the watcher already runs (`server/src/linking/visibilityLane.ts`,
  at most one project per tick, a reading kept 24 h).
- **ccd**: `repo-visibility --project <p>` (one `gh api repos/{slug}` read: visibility and default branch, plus the
  template's presence) and `pr-template --project <p> --team <KEY>` (a branch and a pull request that add
  `.github/pull_request_template.md`; never a push to the default branch, refused on a public repository). Both through
  the agent's whitelist and `CCD_ARGV`.
- **The PR paths**: `draftPr` (the one place ccrc builds a PR body) carries `Refs KEY-123` on a private project whose
  branch names a ticket of its team; `POST /api/sessions/:id/pr` refuses a public project's title or body that names
  its team's tracker id; a named workspace created from a ticket in a public project is slugged from the ticket's
  words, never its id.
- **Skills**: the worker skill, the coordinator skill, `wave-lifecycle.md` §5 and `ccrc-linear` state the rule by
  visibility and read it with `ccrc-api linking show`.
- **PWA**: Settings › Security › **Project linking** (one row per project: team key, visibility and override, template
  state and its control), and the add-project sheet's two optional fields (team key; open a template PR).

**Tech stack:** TypeScript (shared, server, PWA), React, `node:sqlite`, bash (`ccd/ccd`, `ccd/ccrc-api`), vitest
(jsdom and browser).

## What was read first (2026-11-09, at `681cea9a1`)

- **No per-project settings home exists beyond the pool tag.** `ccd project-pool` writes `$POOLS_DIR/<project>` on
  the fleet box (one token, one file) and `POST /api/projects/:project/pool` reaches it; `coord.db`'s
  `landing_projects` (`project` PK, two flags) is the landing context's. Neither is the linking context's, so a new
  table is the smallest honest home: the server owns the operator's choice, and sessions read it through the server.
- **`GET /api/projects`** (`server.ts`) composes per-project cells (`readiness`, `pool`, `placement`, `repo`) over
  `listProjects`; `repo` is `FleetWatcher.projectRepos`, retained from the 120 s `sweepPr` (`_gh_repo_slug` of the main
  checkout). `ProjectRow`'s docstring states the absence rule every cell follows: the key absent means an older server.
- **Onboarding** is `POST /api/projects` → `planProjectAdd` (L1, `projectAdd.ts`) → `ccd project-add --name <n>
  (--url <u> | --empty)`; the PWA host is `AddProjectSheet.tsx` over `useProjectAddForm` (shared with the new-session
  sheet's inline add), and success is a toast whose action starts a session.
- **ccd opens PRs in one verb**, `cmd_pr_open` (`--session --title --body-b64 --draft`), called only by
  `POST /api/sessions/:id/pr`. It builds neither the body nor the branch name: the body comes from the operator's sheet,
  drafted by `draftPr` (`server/src/prstate.ts`), which already defers to the repository's
  `.github/pull_request_template.md` (read by `cmd_pr_state`); the branch is `ws/<slug>` from `cmd_ws_add`, and the
  slug of a named create from a ticket is `key-123-<title words>` (`shared/slug.ts`). Sessions that open their own PRs
  run `gh pr create` under the skills' rules.
- **Visibility is read nowhere today.** ccd's gh readers (`_gh_repo_slug`, `_gh_pr_list`, `_gh_fail_reason`) are the
  ones to extend; the server never runs `gh`.
- **The skills today**: the coordinator skill's `## Linear` section and `wave-lifecycle.md` §5 carry D-8141's
  public-repository rule for every repository (pinned in `coordinator-skill.test.ts`, "the coordinator links every
  ticketed PR from the Linear side (D-8141)"); the worker skill's `## Linear` section has no linking rule.
- **Session reads**: `ccrc-api`'s closed `ROUTES` table (sixty rows) appends the pane's identity to every `linear.*`
  row's query; the server's box-token lanes check it with `attribute(id, uuid)` (`coord/attribution.ts`).
- **Counts today**: the gate stands in front of 191 routes; sixty box-token machine lanes; sixty `ccrc-api` rows;
  `coord/schema.ts` holds 48 migrations.

## Deviations found

- **D-8147 (2026-11-09)** — the linking standard: each project carries a Linear team key and a visibility override,
  set from Settings › Security › Project linking and the add-project sheet and stored in `coord.db`'s
  `project_linking` (migration 52); ccrc reads the repository's GitHub visibility through `ccd repo-visibility` on the
  PR sweep, cached 24 h, and the override wins; sessions read both with `ccrc-api linking show` (`GET /api/linking`, a
  box-token lane). A private project (measured `private` or `internal`, or overridden private) puts the ticket id in the
  branch, the PR body (`Closes`/`Refs KEY-123`) and commits (`Related: KEY-123`); a public or unmeasured project never
  does, links from the Linear side (D-8141) and cites the mirror issue. Departures from the ask, each argued here: the
  ticket reference is carried by `draftPr` and checked by the PR route, not by `cmd_pr_open`, because ccd builds neither
  the body nor the branch name (it transports the operator's text), and the decision belongs in L1; an unmeasured
  visibility reads as public for every act that would write a tracker id (the safe direction), and as unknown on the
  wire; `draftPr` writes `Refs`, never `Closes`, because whether a merge meets the acceptance is a judgement the
  operator makes in the sheet; the template is added by a pull request on its own branch, never a push to the default
  branch, and only on the operator's tap; the tracker-id check knows only the project's own team key, because the
  general identifier shape also matches `UTF-8` and `SHA-256`.

## Global constraints

- **Public repository.** No tracker ids, emails, hosts, IPs, account or session names, or private repository or
  company names, in code, tests, fixtures, commits or docs; examples are `KEY-123`, `owner/repo`, `project-a`.
  `topology-clean.test.ts` must stay green on the branch.
- **Commits**: author and committer the identity the task brief gives (its GitHub no-reply address); cite D-8147; end with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Named files only (never `git add -A`); assert
  `git rev-parse --show-toplevel` before each commit; no stash; no push from a task.
- **Tests**: `vitest --maxWorkers=2`, at most 12 files per command, never the whole server suite. Every bash spawn in a
  ccd test is contained (`ghContainedEnv` from `server/test/ccdWsHelpers.ts`, with its systemd and tmux options), and a
  fake `gh` on `PATH` answers; nothing reaches GitHub. Browser files run locally with
  `CCRC_CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./node_modules/.bin/vitest run --config vitest.browser.config.ts <files>`
  from `pwa/`, and keep `let dist: string | undefined;` and `dist = sharedDist(); server = await serveDist(dist);`.
- **Count pins that move, deliberately** (re-measure on `origin/main` before the PR): the gate's route count
  (191 → 194; `gate.ts`'s docstring "all 194 routes" and the reason-2 lane list "sixty-one box-token machine lanes",
  `auth-gate.test.ts`), `box-token-census.test.ts` (+`GET /api/linking`), `ccrc-api`'s table (sixty → sixty-one rows:
  the count word in the header bullet and above `ROUTES`, `ccrc-api.test.ts`, `ccrc-api-closed.test.ts`),
  `coord/schema.ts`'s migration slot (must print 49 before entry 50 is counted).
- **No new box setting.** The 24 h reading age and the one-project-per-tick bound are constants in
  `server/src/linking/policy.ts`, so the settings census, the README settings paragraph, `ccrc.env.example` and the
  Linux-only settings counts do not move.
- **Growth**: `ccd/ccd` grows by the two verbs (expected +150 net lines): `server/test/growth-waivers/D-8147-ccd-ccd.json`
  with its reason. `server.ts`, `watch.ts`, `shared/api.ts` and `prstate.ts` stay under +40 each (the logic is in new
  files); a file that does not gets its own `D-8147-*.json` in the same commit.
- **Refusals**: every new refusal word is in `shared/linking.ts`'s closed list and reaches the PWA through
  `refusalText` with a fixed sentence (the refusal-literal ratchet); the box's own text is never shown.
- **The D-number rule**: D-8147 is cited in tracked files only because this plan defines it above.
- **The coordinator word** in any PWA text comes from `coordinatorRole()`.

## File structure

| File | Change |
|---|---|
| `shared/linking.ts` | new: words, wire types, refusal words, `LINKING_TEMPLATE_PATH` |
| `shared/api.ts` | `ProjectRow.linking?: ProjectLinkingWire` (one line and its docstring line) |
| `server/src/linking/policy.ts` | new: L1 deciders |
| `server/src/coord/schema.ts` | migration 52: `project_linking` |
| `server/src/coord/linkingStore.ts` | new: the table's SQL; `CoordStore` gains one-line delegates |
| `server/src/linking/routes.ts` | new: the three routes |
| `server/src/linking/visibilityLane.ts` | new: one measurement per sweep tick |
| `server/src/server.ts` | registers the routes; the `linking` cell on `GET /api/projects`; the PR route's check |
| `server/src/watch.ts` | `sweepPr` calls `visibilityLane.tick` once per pass |
| `server/src/prstate.ts` | `draftPr` takes the project's linking |
| `server/src/workspaceCreate.ts` | a public project's ticket create slugs from words |
| `server/src/ccdargv.ts` | `repoVisibility`, `prTemplate` entries and their `verbRow`s |
| `server/src/auth/gate.ts` | one EXEMPT row (`GET /api/linking`), counts and prose |
| `agent/src/whitelist.ts` | `repo-visibility` and `pr-template` grants |
| `ccd/ccd` | `cmd_repo_visibility`, `cmd_pr_template`, `_gh_repo_meta`, `_pr_template_file`; usage line |
| `ccd/ccrc-api` | `[linking.show]` row; identity appended like `linear.*`; counts |
| `ccd/worker-skill/SKILL.md`, `ccd/coordinator-skill/SKILL.md`, `ccd/coordinator-skill/references/wave-lifecycle.md`, `ccd/linear-skill/SKILL.md` | the rule by visibility |
| `pwa/src/screens/settings/ProjectLinkingCard.tsx` | new: the card |
| `pwa/src/screens/settings/SecuritySection.tsx`, `pwa/src/fleet/settingsText.ts` | mounts the card after Linear; its title and purpose |
| `pwa/src/fleet/AddProjectSheet.tsx`, `pwa/src/fleet/AddProjectForm.tsx`, `pwa/src/fleet/projectAddWords.ts` | the two optional fields and the follow-up acts |
| `pwa/src/lib/api.ts`, `pwa/src/lib/refusalWords.ts` | `saveLinking`, `openTemplatePr`; the refusal sentences |
| `README.md` | "Linking PRs to Linear" paragraph |
| `server/test/growth-waivers/D-8147-ccd-ccd.json` | the waiver |

## Tasks

### Task 1: The vocabulary and the deciders

**Files:** `shared/linking.ts`, `shared/api.ts`, `server/src/linking/policy.ts`; tests `server/test/linking-policy.test.ts`.

**Interfaces:**
```ts
// shared/linking.ts
export type RepoVisibility = 'public' | 'private' | 'internal';
export type LinkingOverride = 'private' | 'public';
export type LinkingMode = 'private' | 'public' | 'unknown';
export type TemplateState = 'present' | 'absent';
export interface ProjectLinkingWire {
  teamKey: string | null;
  override: LinkingOverride | null;
  measured: { state: 'measured'; visibility: RepoVisibility; slug: string; template: TemplateState; at: number }
          | { state: 'unmeasured' }
          | { state: 'failed'; reason: string; at: number };
  mode: LinkingMode;
}
export interface LinkingShowAnswer extends ProjectLinkingWire { ok: true; project: string }
export interface LinkingWriteBody { teamKey: string | null; override: LinkingOverride | null }
export const LINKING_REFUSALS = ['bad-team-key', 'bad-override', 'no-project', 'repo-public', 'repo-unmeasured',
  'template-exists', 'no-team-key', 'tracker-id-public', 'ticket-slug-public'] as const;
export const LINKING_TEMPLATE_PATH = '.github/pull_request_template.md';
// server/src/linking/policy.ts
export const VISIBILITY_MAX_AGE_MS = 24 * 3_600_000;
export function linkingMode(override: LinkingOverride | null, measured: ProjectLinkingWire['measured']): LinkingMode;
export function ticketRefOfBranch(branch: string, teamKey: string | null): string | null; // 'ws/key-123-x' → 'KEY-123'
export function trackerIdsIn(text: string, teamKey: string | null): string[];            // case-insensitive, whole token
export function parseLinkingWrite(body: unknown): { ok: true; write: LinkingWriteBody } | { ok: false; error: 'bad-team-key' | 'bad-override' | 'bad-request' };
export function visibilityDue(rows: readonly { project: string; at: number | null }[], now: number): string | null; // oldest first, never-measured first
```

- [ ] **Step 1, red.** `linking-policy.test.ts`:
  - `linkingMode: an override wins over any reading`
  - `linkingMode: private and internal read private, public reads public`
  - `linkingMode: unmeasured and failed read unknown`
  - `ticketRefOfBranch: names the team's ticket at the slug's start, in either case`
  - `ticketRefOfBranch: null with no team key, another team's key, or the key mid-word`
  - `trackerIdsIn: finds KEY-123 as a whole token and ignores UTF-8 and SHA-256 when the key is KEY`
  - `trackerIdsIn: empty with no team key`
  - `parseLinkingWrite: takes a team key in LINEAR_TEAM_KEY_SHAPE, uppercased, and null clears it`
  - `parseLinkingWrite: refuses a bad key, an override outside the two words, and extra fields`
  - `visibilityDue: a never-measured project first, then the oldest reading past 24 h, else null`
- [ ] **Step 2, green.** Write the two files; add `linking?: ProjectLinkingWire` to `ProjectRow` with one docstring line
  ("absent: an older server; it follows the absence rule above").
- [ ] **Step 3.** Run `linking-policy.test.ts` and `topology-clean.test.ts`. Commit.

### Task 2: The store, the operator's write and the projects cell

**Files:** `server/src/coord/schema.ts`, `server/src/coord/linkingStore.ts`, `server/src/coord/store.ts` (delegates),
`server/src/linking/routes.ts`, `server/src/server.ts`; tests `server/test/linking-store.test.ts`,
`server/test/linking-routes.test.ts`, `server/test/coord-schema.test.ts` (the slot pin), `server/test/auth-gate.test.ts`.

**Interfaces:**
```sql
CREATE TABLE project_linking (
  project     TEXT NOT NULL PRIMARY KEY,
  teamKey     TEXT,
  override    TEXT CHECK (override IN ('private','public')),
  setBy       TEXT, setAt INTEGER,
  visibility  TEXT CHECK (visibility IN ('public','private','internal')),
  slug        TEXT, template TEXT CHECK (template IN ('present','absent')),
  failReason  TEXT, measuredAt INTEGER
);
```
```ts
export function setLinking(db: DatabaseSync, project: string, w: LinkingWriteBody, by: string, at: number): void;
export function recordReading(db: DatabaseSync, project: string, r: ProjectLinkingWire['measured']): void;
export function linkingOf(db: DatabaseSync, project: string): ProjectLinkingWire;          // a missing row reads unmeasured, no key
export function linkingAll(db: DatabaseSync): Map<string, ProjectLinkingWire>;
// POST /api/projects/:project/linking  body LinkingWriteBody → 200 { ok: true, linking: ProjectLinkingWire }
```

- [ ] **Step 1, red.**
  - `linking-store.test.ts`: `a project with no row reads unmeasured with no key and mode unknown`;
    `setLinking writes the key and override and leaves the reading`; `recordReading writes the reading and leaves the
    key`; `a failed reading keeps the last measured visibility out of the mode`; `linkingAll reads every row in one query`.
  - `linking-routes.test.ts`: `POST linking stores the key and answers the stored row (measured, not echoed)`;
    `POST linking with teamKey null clears it`; `POST linking refuses bad-team-key and bad-override with 400 and
    writes nothing`; `POST linking is session-gated when armed and open dark`; `GET /api/projects carries a linking cell
    per project from one read`.
  - `coord-schema.test.ts`: the migration count pin moves 49 → 50.
- [ ] **Step 2, green.** Migration 50 with the header comment the file's rule asks for (a new table, nothing an older
  build trips on; re-measure the slot). `linkingStore.ts` and `CoordStore` delegates. `registerLinkingRoutes(app, deps)`
  from `server.ts` (one call); the `linking` cell beside `repoCell` in `GET /api/projects`. `setBy` is the device the
  `pwaDec(req)` helper names. A project name goes through unvalidated into a bound SQL parameter only (the pool route's
  stance), and is not refused for a name the walk has not listed yet, as the pool route does not refuse one (an
  operator may set a project's key before its first walk).
- [ ] **Step 3.** Run the four files and `auth-gate.test.ts` (route count 191 → 192 here; prose moved in Task 3).
  Commit.

### Task 3: A session's read: `GET /api/linking` and `ccrc-api linking show`

**Files:** `server/src/linking/routes.ts`, `server/src/auth/gate.ts`, `ccd/ccrc-api`; tests
`server/test/linking-routes.test.ts`, `server/test/auth-gate.test.ts`, `server/test/box-token-census.test.ts`,
`server/test/ccrc-api.test.ts`, `server/test/ccrc-api-closed.test.ts`.

**Interfaces:**
```ts
// GET /api/linking?byId=<id>&byUuid=<uuid>   (box token; attribution as the Linear lanes)
// 200 LinkingShowAnswer; 4xx the attribution words; 404 'no-project' when the session's record names none
```
```bash
[linking.show]='GET|/api/linking|no|-'     # identity appended like every linear.* row
```

- [ ] **Step 1, red.**
  - `linking-routes.test.ts`: `GET linking answers the caller's own project's row, found through its registry record`;
    `GET linking refuses a missing or wrong box token`; `GET linking refuses an attribution the registry does not hold`;
    `GET linking reads unknown mode for a project never measured`.
  - `box-token-census.test.ts`: the census names `GET /api/linking`.
  - `auth-gate.test.ts`: EXEMPT holds `GET /api/linking` with its reason; 193 routes here, 194 after Task 5.
  - `ccrc-api.test.ts`: `linking show sends GET /api/linking with the pane's byId and byUuid`;
    `linking show takes no id and no query key`; the table count reads sixty-one.
  - `ccrc-api-closed.test.ts`: the skills' `ccrc-api linking show` calls are rows of the table.
- [ ] **Step 2, green.** The route (attribution first, then `readSessionRecord` for the project, then `linkingOf`); the
  EXEMPT row and the gate docstring's lane count ("sixty-one box-token machine lanes"); the `ccrc-api` row, its count
  words and `[[ "$key" == linear.* || "$key" == linking.show ]]` in the identity block.
- [ ] **Step 3.** Run the five files. Commit.

### Task 4: Reading visibility: `ccd repo-visibility` and the sweep

**Files:** `ccd/ccd`, `agent/src/whitelist.ts`, `server/src/ccdargv.ts`, `server/src/linking/visibilityLane.ts`,
`server/src/watch.ts`, `server/test/growth-waivers/D-8147-ccd-ccd.json`; tests `server/test/ccd-repo-visibility.test.ts`,
`server/test/linking-visibility-lane.test.ts`, `server/test/whitelist-subset.test.ts`, `agent/test/whitelist.test.ts`.

**Interfaces:**
```bash
ccd repo-visibility --project <p>
# rc 0, one line: {"slug":"owner/repo","visibility":"private","defaultBranch":"main","template":"absent"}
# rc 1, one line: {"reason":"no-remote|unauthenticated|rate-limit|offline|unavailable|truncated|error|bad-answer"}
_gh_repo_meta()      # slug -> "<visibility>\t<default_branch>" from ONE `gh api repos/{slug}`, bounded by _plat_timeout
_pr_template_file()  # main -> the template path cmd_pr_state reads (now the one definition of it)
```
```ts
CCD_ARGV.repoVisibility(project) // ['repo-visibility','--project',project], verbRow('repo-visibility')
export class VisibilityLane { tick(projects: readonly string[], now: number): Promise<void> } // at most one ccd call per tick
```

- [ ] **Step 1, red.**
  - `ccd-repo-visibility.test.ts` (contained env, fake `gh`): `prints slug, visibility, default branch and template for a
    github origin`; `reads template present when the main checkout holds .github/pull_request_template.md`;
    `answers no-remote for a checkout with no github origin and calls no gh`; `classifies a gh failure through
    _gh_fail_reason`; `answers bad-answer for a visibility outside public, private and internal`; `refuses an invalid
    project name before any read`; `exact arity: any other argv is the usage line`; `cmd_pr_state reads the template
    through _pr_template_file`.
  - `linking-visibility-lane.test.ts`: `measures a never-measured project first`; `measures nothing while every
    reading is younger than 24 h`; `records a failure with its reason and keeps the project due on the next day`;
    `makes at most one ccd call per tick`; `answers unsupported quietly on a ccd without the verb`.
  - `whitelist-subset.test.ts` / `agent/test/whitelist.test.ts`: the grant `['repo-visibility','--project']`.
- [ ] **Step 2, green.** The verb, its usage-line word, the grant, the argv row, the lane (decides through
  `visibilityDue`, acts through `runCcd`, writes through `recordReading`), and one line in `sweepPr` after the repo
  cells are retained. The waiver file with the measured delta.
- [ ] **Step 3.** Run the five files plus `ccd-pr-state.test.ts` and `growth-check.test.ts`. Commit.

### Task 5: The template PR: `ccd pr-template` and its route

**Files:** `ccd/ccd`, `agent/src/whitelist.ts`, `server/src/ccdargv.ts`, `server/src/linking/routes.ts`; tests
`server/test/ccd-pr-template.test.ts`, `server/test/linking-routes.test.ts`, `server/test/whitelist-subset.test.ts`,
`server/test/auth-gate.test.ts`.

**Interfaces:**
```bash
ccd pr-template --project <p> --team <KEY>
# Reads _gh_repo_meta; refuses public (word repo-public) and a template already on the fetched default branch
# (template-exists); makes a temp worktree from origin/<default> under $PROJECTS_ROOT/.pr-template.<p>.<pid>
# (a dot name the project walk skips), writes the template, commits, pushes refs/heads/ccrc/linking-template only
# (never --force; an existing open PR from that branch is answered, not duplicated), runs gh pr create, removes the
# temp, and prints the gh PR row through _gh_pr_list.
```
The template it writes (`<KEY>` is the team key):
```md
<!-- Linking: name this PR's Linear ticket so Linear links it and acts on merge. -->
<!-- Closes <KEY>-<n> when merging this PR meets the ticket's acceptance; Refs <KEY>-<n> when a live check is still owed. -->
Closes <KEY>-

## Summary

## Test plan
```
```ts
// POST /api/projects/:project/pr-template  (no body) → 200 { ok: true, url } | 409 repo-public | template-exists
//   | 409 no-team-key (no key stored) | 409 repo-unmeasured (mode unknown and no override) | 502 the ccd failure
```

- [ ] **Step 1, red.**
  - `ccd-pr-template.test.ts` (contained env, fake `gh`, a bare origin): `opens a PR from ccrc/linking-template adding
    the template with the team key`; `never pushes the default branch`; `refuses repo-public and pushes nothing`;
    `refuses template-exists when the default branch holds one`; `answers the open PR when the branch already has one`;
    `removes its temp worktree on every path`; `refuses a team key outside the shape`; `exact arity`.
  - `linking-routes.test.ts`: `POST pr-template refuses no-team-key and repo-unmeasured before any ccd call`;
    `POST pr-template refuses repo-public on an override to public`; `POST pr-template answers the PR url and records
    the template present`; `POST pr-template answers unsupported on a ccd without the verb`.
  - `whitelist-subset.test.ts`: the grant `['pr-template','--project']`.
- [ ] **Step 2, green.** The verb (the template text is in its heredoc, the one definition), the grant, the argv row
  and the route (decides with `linkingMode` from the stored row; acts through `runCcd`; on success writes
  `template: present` through `recordReading`). The gate's count reads 194.
- [ ] **Step 3.** Run the four files and `growth-check.test.ts`. Commit.

### Task 6: The PR paths carry or check the ticket

**Files:** `server/src/prstate.ts`, `server/src/server.ts` (the PR routes), `server/src/workspaceCreate.ts`; tests
`server/test/prstate-draft.test.ts`, `server/test/pr-open-route.test.ts`, `server/test/workspace-create.test.ts`.

**Interfaces:**
```ts
export function draftPr(line: CcdPrLine, tasks: TaskItem[] | null, linking?: { mode: LinkingMode; teamKey: string | null }): { title: string; body: string };
// POST /api/sessions/:id/pr → 400 tracker-id-public { ids } when the project's mode is public and the title or body names its team's ids
// POST /api/projects/:project/workspaces (named, from a ticket) on a public project → slug from the resolved title's words; 400 ticket-slug-public when Linear gave none
```

- [ ] **Step 1, red.**
  - `prstate-draft.test.ts`: `a private project's draft ends its first part with Refs KEY-123 when the branch names it`;
    `the Refs line is not added when the template or the body already names the ticket`; `a public or unknown project's
    draft names no tracker id`; `no team key: the draft is today's, byte for byte`.
  - `pr-open-route.test.ts`: `a public project's PR naming KEY-123 is refused tracker-id-public and ccd is not called`;
    `a private project's PR naming KEY-123 is sent`; `an unknown project's PR is sent (the operator's own text)`.
  - `workspace-create.test.ts`: `a public project's ticket create slugs from the title words, never key-123`;
    `refuses ticket-slug-public when Linear gave no title`; `a private project's ticket create keeps key-123-…`.
- [ ] **Step 2, green.** `GET /api/sessions/:id/pr` passes the project's linking to `prView`/`draftPr`; the POST route
  and the named create read it with `linkingOf`. Decisions go through `ticketRefOfBranch`, `trackerIdsIn` and
  `linkingMode`.
- [ ] **Step 3.** Run the three files and `workspace-refusal-census.test.ts`. Commit.

### Task 7: The skills state the rule by visibility

**Files:** `ccd/worker-skill/SKILL.md`, `ccd/coordinator-skill/SKILL.md`,
`ccd/coordinator-skill/references/wave-lifecycle.md`, `ccd/linear-skill/SKILL.md`; tests
`server/test/worker-skill.test.ts`, `server/test/coordinator-skill.test.ts`, `server/test/ccrc-api-closed.test.ts`.

The text (one paragraph, the same rule in each, worded for its reader): **Link every pull request for ticketed work,
by the repository's visibility.** Read it first: `~/.local/bin/ccrc-api linking show` answers this project's `mode` and
`teamKey`. `private`: name the ticket in the workspace (a dispatch's `slug` starts `key-123-`), write
`Related: KEY-123` in commits and `Closes KEY-123` (the merge meets the acceptance) or `Refs KEY-123` (a live check is
owed) in the PR body; Linear's GitHub integration links and closes. `public` or `unknown`: never write a tracker id in
the repository (branch, commit, file or PR body); link from the Linear side with `ccrc-api linear link <REF> --json -`
and cite the ticket's GitHub mirror issue, `Closes #<n>` or `Refs #<n>`. New tickets are filed in the team `teamKey`
names; with no team key, ask, and do not guess one.

- [ ] **Step 1, red.**
  - `worker-skill.test.ts`: `the Linear section reads the rule with ccrc-api linking show`; `it states both arms and
    both keywords`; `it names no tracker id of this repository`.
  - `coordinator-skill.test.ts`: the D-8141 block's pins re-pinned to the new wording (its `it` names kept), plus
    `the dispatch slug carries the ticket only on a private project`.
  - `ccrc-api-closed.test.ts`: `linking show` is a table row the corpora call.
- [ ] **Step 2, green.** Edit the four skills.
- [ ] **Step 3.** Run the three files and `topology-clean.test.ts`. Commit.

### Task 8: The console: Project linking, onboarding, the PR sheet, the README

**Files:** `pwa/src/screens/settings/ProjectLinkingCard.tsx`, `pwa/src/screens/settings/SecuritySection.tsx`,
`pwa/src/fleet/settingsText.ts`, `pwa/src/screens/settings/settings.css`, `pwa/src/fleet/AddProjectForm.tsx`,
`pwa/src/fleet/AddProjectSheet.tsx`, `pwa/src/fleet/projectAddWords.ts`, `pwa/src/lib/api.ts`,
`pwa/src/lib/refusalWords.ts`, `README.md`; tests `pwa/test/project-linking-card.test.tsx`,
`pwa/test/add-project-sheet.test.tsx`, `pwa/test/project-linking-card.browser.test.ts`, `pwa/test/settings-security.test.tsx`.

**The card** (`SETTINGS_CARDS.security.linking`, scope box, after the Linear card): one row per project from
`GET /api/projects`' `linking` cell. Each row: the name; **Team key** (a short text field, uppercased, Save; empty
clears); **Visibility**: the measured word and its age ("Private, read 3 h ago", "Not read yet", "Couldn't read:
offline"), and an override select (Automatic, Private, Public); **PR template**: Present / Absent, and on a private
project with an absent template and a team key, **Open a template PR**, behind a `QuickConfirm` naming the repository
slug and the file. The answer is what is shown: a write renders the stored row; the template act shows the PR's URL
as a link. Rows of a project whose cell is absent (an older server) show nothing.

**Onboarding**: the add-project sheet (not the new-session sheet's inline add) gains **Linear team key (optional)**
and, for a clone, **Open a PR adding the linking template** (unchecked). After a successful add the host saves the
key (`saveLinking`) and, when checked, runs `openTemplatePr`; each outcome is a line in the success toast. A
`repo-unmeasured` answer says "ccrc has not read this repository's visibility yet; open the template from Settings ›
Project linking in a few minutes."

**The PR sheet**: `tracker-id-public` reads "This repository is public: remove KEY-123 from the title and body. Link
the ticket from Linear instead." (the ids from the answer).

| Width | Refined (light, dark) | Instrument (light, dark) |
|---|---|---|
| 360 | rows stack: name; key field and Save on one line (field 8ch, wraps under at 360 if the Save label needs it); visibility line, then the select full width; template line, then the button full width. No horizontal scroll; a long project name wraps. Sheet fields stack, checkbox label wraps. | same stack inside the settings column; the list column is hidden at this width. |
| 390 | as 360, key field and Save always on one line. | as 360. |
| 1280 | each row one grid line: name / key + Save / visibility + select / template + button; the button wraps to the row's second line when the card is narrower than 760 px. Sheet: fields in one column, max 560 px. | the card in the detail pane beside the settings list; same grid, measured at the pane's width (the 760 px rule decides). |
| 1470 | as 1280. | as 1280; one grid line per row. |
| 1920 | as 1280, card max width 960 px, centred in the section. | one grid line per row; the card keeps 960 px max. |

Both themes take every colour from the existing tokens (no new colour); the measured word and the failure line use the
existing note and amber classes. Focus order follows the row; every control is a real button, select or input with a
label.

- [ ] **Step 1, red.**
  - `project-linking-card.test.tsx`: `renders one row per project with its key, visibility and template`; `saving a key
    renders the stored row`; `an override change sends override and renders the answer`; `the template button shows
    only for a private project with no template and a key`; `the template act confirms first and shows the PR link`;
    `each refusal word renders its fixed sentence`; `a project with no linking cell renders nothing`.
  - `add-project-sheet.test.tsx`: `a clone with a team key saves it after the add`; `the template box runs the template
    act after the add and reports it in the toast`; `the empty arm shows no template box`; `the new-session inline add
    shows neither field`.
  - `settings-security.test.tsx`: `the Project linking card follows the Linear card`.
  - `project-linking-card.browser.test.ts`: `no horizontal overflow and no clipped text at 360, 390, 1280, 1470 and
    1920 in both skins and both themes`; `at 1280 a row is one grid line`.
- [ ] **Step 2, green.** The card, the sheet fields, the API helpers, the refusal sentences, the README paragraph
  ("Linking PRs to Linear": the two rules, where the team key and override are set, and that the template is added by
  a pull request on the operator's tap).
- [ ] **Step 3.** Run the four PWA files (the browser file with `CCRC_CHROME`), and `topology-clean.test.ts`. Commit.

## Known limits

- **A repository moved between public and private** is read again within 24 h; until then the stored reading stands,
  and the override is the operator's immediate answer.
- **Only the project's own team key is checked** for tracker ids; another team's identifier in a public PR passes.
- **Sessions that run `gh pr create` themselves** are held to the rule by the skills, not by code; the server checks
  only the PR route it serves.
- **The template is looked for at `.github/pull_request_template.md` only** (the path `cmd_pr_state` reads); a repository
  that keeps it elsewhere reads `absent` and the template act's own check against the default branch looks at the same
  path.
- **A project name outside `SAFE_RE`** (one with a dot) is still read: `ccrc-api linking show` takes no project, so the
  server finds it through the caller's registry record.
- **Acceptance on the fleet after deploy**: a private and a public project each read the right mode within one sweep
  after deploy; the template PR opens on a private test repository; a worker's PR on each follows the rule.
