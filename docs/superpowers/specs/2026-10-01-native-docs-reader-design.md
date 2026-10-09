# Native Docs reader — design

**Status:** approved design (brainstorm 2026-09-29 → 2026-10-01). Every decision in §0's log is ruled; what remains unmeasured is listed as risks, not as choices.

**Supersedes:** the 2026-08-22 tooling decision brief's T3 ("a standalone docs server as a public service: not in v1"; `docs/superpowers/specs/2026-08-22-ccrc-tooling-decision-brief.md`). ccrc now owns a gated docs reader.

**Citations:** every `file:line` into this repository is as measured at `c62e22b9a`. Line numbers are hints: each citation also names its function, constant or test, so it can be found again after `main` moves.

**Scope.** ccrc gains a Docs reader: a session-gated screen in the PWA that reads the four documentation sections (`docs/superpowers/specs`, `docs/superpowers/plans`, `docs/product-design`, `docs/conventions`) of each project under ccd's projects root on the install's own fleet box. A page serves the origin default branch by default, or any branch named by `?ref=`. A ref view overlays uncommitted drafts from the one worktree that holds that branch, when that worktree sits on the served commit. Pages render Markdown, images, text and sandboxed HTML mockups, and refresh from origin on open when stale or on demand. On the fleet side the feature is four narrow verbs in `ccd`: three reads and one fetch. On the server it is four routes behind the existing session gate. The exec surface, the agent protocol and `FLEET_PROTO` are unchanged. ccrc ships the reader, never the documents.

**Reading order.**
1. §0 says what was decided and why.
2. §1 names the units and traces one request.
3. §2 is the ccd contract everything else stands on.
4. Then §3 (HTTP API and URLs), §4 (the PWA screen and Markdown), §5 (HTML mockups, and how bytes leave the server), §6 (link protection, caching and limits) and §7 (rollout, retirement and the implementation waves).

A W1 implementer reads §2, then §6.1 and §7.1, which set the final argv, the class caps and the version-skew answers that ccd ships with.

## §0 Goals, non-goals and decisions

### Goals

1. **Each install reads its own projects' docs.** That means whatever ccd's projects root holds on that install's fleet box, behind that install's own session gate.
2. **Reading docs stops needing a tailnet, a forwarder and a standalone server.** The reader uses the server-to-agent link ccrc already has.
3. **ccrc never bundles, mirrors or redistributes documents.** The repository is public. Docs stay in the operator's repositories and reach only the operator's signed-in browser.
4. **A page says exactly what it served.** It shows the full refname, the commit, why that ref was chosen, and whether a draft overlays it. A `?ref=` that cannot be served is an honest error, never a 200 showing something else.
5. **Docs never starves the console.** Every docs byte shares the agent socket with the terminals, so docs traffic is bounded to keep it from doing so.

### Non-goals

- **The rest of `docs/`.** Only the four sections are addressable.
- **Programme ledgers** (`docs/superpowers/programs/`). That directory is not a section and has no page.
- **Links from mail artifacts.** They stay text (§4.13).
- **More than one fleet node.** This build has one agent link. The seam for more is reserved and not built: the `/docs/@<node>` page segment and node-keyed internals (§3.12).
- **Editing docs.** The reader writes nothing in any working tree, index or local ref.
- **Offline reading.** Offline, a Docs page shows the shell and its failure state only.

### Decision log

| Id | Decision | Chosen | Why |
|---|---|---|---|
| `product` | What ccrc ships | A session-gated Docs reader for each install's own project docs. It never bundles docs. | The standalone server it replaces sat outside ccrc's authentication, and its `?ref=` drove unbounded fetches: T3's reasons. ccrc already owns a gate, a link to the fleet and ccd. A public AGPL repository must not carry anyone's documents. |
| `sections` | What is addressable | `specs`, `plans`, `product-design`, `conventions`, and nothing else (`DOC_SECTIONS`) | These are the four sections the old preview served. Ledgers and the rest of `docs/` stay out (non-goals). |
| `features` | What carries over from the old preview | `?ref=` previews, drafts, HTML mockups | They are why an operator reads docs through a server rather than GitHub: unmerged branches, uncommitted specs, design mockups. |
| `approach` | How it is built | A native feature: four narrow verbs in ccd (three reads and `docs-fetch`). `EXEC_COMMANDS` stays `['tmux','ccd']`. No proxy to the old server. | The exec surface is closed by design (`agent/src/whitelist.ts:192`). A proxy would put an unauthenticated listener's raw HTML on the ccrc origin. |
| `Q1` | Drafts: what overlays, and where drafts come from | **The effective working-tree file wins**: badged, with "open committed version".<br>**Default view**: the origin default branch only, never drafts. When a worktree on the local default branch has uncommitted docs, a hint links `?ref=refs/heads/<branch>`.<br>**Ref view**: drafts come from the ONE worktree holding `refs/heads/<name>`, wherever it is on disk. A detached worktree never holds. Two holders make the view `ambiguous`: committed content only. Drafts overlay iff the holder's HEAD equals the served commit; otherwise the page shows the base hint. | An overlay on a different base is false of the served content. In one project whose main checkout is 1705 commits behind, a literal overlay would show 23 phantom deletions and 13 files rebuilt.<br>The default view means "what is on the default branch". The authoring case stays one tap away; one project's main checkout holds 36 uncommitted docs.<br>In a ref view the bases differ only when origin is served over a stale local branch. 0 of 166 worktree-held branches measured were behind origin. |
| `session-links` | Which branch a session's Docs link names | The branch the worktree holds now | Workspaces are usually renamed away from `ws/<slug>`: 168 of 260 measured. |
| `Q2` | `?ref=<name>` exists locally and on origin, at different commits | **The newer side wins.**<br>Local behind: origin. Local ahead: local. Diverged: local, flagged. Equal: local.<br>`refs/heads/…` or `refs/remotes/origin/…` force a side, with no fallback. | Always-local would serve a local `main` that is 44 commits behind origin on one repo. Always-origin hides unpushed worker commits and loses drafts, because no worktree can hold an origin ref. The cost is at most two `merge-base` calls, measured at about 0 s. |
| `Q3` | Where the index gets its data | A fourth verb, `docs-index --all` | One exec, 0.27–0.32 s over 16 repos, against about 21 execs. It reads ccd's projects root like every other docs call, so the inherited root seam (§1) does not reappear inside Docs. |
| `Q4` | When a view is stale | Stale 10 min after the last attempt. A failure is retried after 60 s, except `remote-branch-absent`, which waits 10 min. Auto-refresh fetches only the viewed branch, and only when the ref resolved. ccd enforces a 10 s per-branch floor. | Every fetch moves a remote-tracking ref in repos where live sessions work. Ten minutes matches how often specs change. Counting from the attempt stops an unpushed branch from refetching on every open. The ccd floor bounds a POST loop across server restarts. |
| `freshness` | How a page refreshes | Auto-refresh on open when stale, plus a manual Refresh. A GET never mutates git. | Reads and the one write are separated three ways: by port, by a source scan and by a PATH recorder (§2 (g)). |
| `http` | The HTTP surface (§3) | Approved as written in §3:<br>- a marker header (`x-ccrc-docs: 1`) plus `Sec-Fetch-*` replaces the approved Origin fallback;<br>- page URLs never carry a commit;<br>- `view=committed` and `frame=full`;<br>- `/docs/@<node>` is reserved. | The PWA's own same-origin GET sends no `Origin` (§3.0 M-g). An Origin rule would therefore either admit every subresource or refuse the PWA itself. A durable pointer to one commit is a GitHub URL. |
| `U1` | Size caps | Images 2 MiB. Documents 2 MiB. | Every PNG over 2 MiB on the fleet is gitignored evidence that Docs never lists, and the largest committed PNG is 0.36 MiB.<br>A 10 MiB cap would exceed the agent's 8 MiB exec buffer, and would stall terminals about 1.1 s per image at 100 Mbit.<br>Transcoding to WebP on the fleet box was rejected, for five reasons: it means native decoding of untrusted images outside the browser sandbox; it risks decompression-bomb memory use on the session box; it adds a dependency; it makes a GET do heavy work; and its pixels would differ from the repository's.<br>Larger images, if ever needed, go through a chunked `docs-show-range` verb, never a bigger cap. |
| `U2` | Outbound network in mockups | A per-view "Load external (N)" tap. Exact `https` origins only. Never remembered. | One of the three committed mockups draws its charts from a CDN, and two load hosted fonts. By default they render without those. One tap per view loads exactly the origins the census lists. |
| `U3` | How much of the hardening chat gets | (b):<br>- error boundaries;<br>- iterative `remarkAlerts`;<br>- the highlight cap;<br>- the nesting pre-scan;<br>- the parse worker for messages over 4 KiB;<br>- refusal of root-relative and protocol-relative image sources. | Chat shares the renderer. Measured: 10 KB of `>` overflows the stack, and 40 KB of nested emphasis freezes the page for 42.7 s. A same-origin image source fires a GET carrying the operator's cookie. |
| `U4` | Real-browser proof | (a): a required `browser (pwa)` headless-Chrome leg in `full-suite` | The mockup and byte-delivery guarantees rest on browser behaviour that jsdom cannot show: the sandbox, CSP, `srcdoc` and navigation headers. |
| `U5` | The pre-existing defects outside Docs | (a): two small PRs after W3, both outside the Docs waves and both disclosed once merged:<br>1. the pre-existing route defect, reported privately first, then fixed on its own;<br>2. a global baseline security-header hook.<br>The error boundary and the Docs-route headers are fixed inside the programme. | The repository and its issue mirror are public, so a live defect is reported privately before anything else. Keeping both fixes out of the Docs waves keeps each wave's review scoped. |
| `rollout` | Rollout and retirement (§7) | - Fleet box first.<br>- Doctor gains two checks, `docs` and `docs-sw`.<br>- The build refuses a `CCRC_SW_DENYLIST` entry covering `/docs`.<br>- Retiring a standalone docs server is operator steps only. ccrc never touches its units, its proxy mapping or the operator's global `CLAUDE.md`. The `/docs` proxy mapping comes off first, before the forwarder and the server stop.<br>- Seven waves, W1–W7. | Every server read is gated on `docs-v1` before any exec, so a new server can only under-call an old fleet. A denylisted `/docs` breaks Docs on every hard load. While the mapping stays, one URL is answered by two apps. |
| `s2-remedies` | The adversarial review of §2 | Every remedy aimed at §2 is folded in:<br>- holder and leaf trust;<br>- shared-repo discovery;<br>- argv read by fixed index;<br>- fsck on fetch;<br>- auto-refresh only for a resolved ref;<br>- the lock's age;<br>- one redactor;<br>- a path grammar built on Unicode categories;<br>- degrading the draft phase rather than failing the tree;<br>- commit provenance;<br>- the asset rule.<br>The remaining remedies moved to §4–§7. | The git core survived every attack. The gaps were at its edges, and each remedy is an addition with its own mutation row. |
| `evidence` | Settled on evidence, not put to the user | - An ambiguous holder serves committed only, with the candidates listed.<br>- The fetch stamp lives in ccd's registry at `$REG/docs/`.<br>- Any commit object may be read, still only within the four sections, so pins survive force-pushes; `onRef` says whether the commit is still on the branch.<br>- `DOCS_MAX_FILE_BYTES` stays the 4 MiB ccd ceiling, above the 2 MiB class caps. | All three review lenses agreed on the first. The approved §1 has ccd report the fetch age. Reading any commit is no wider than what a session holder can already do on the fleet. |

### Defects found along the way

Three pre-existing defects outside Docs, verified at `c62e22b9a`. U5 decides how each is handled.

1. **A pre-existing route defect.** An existing session-gated GET outside Docs mutates git state on the fleet box.
   - Docs does not touch it, and the Docs waves neither depend on it nor change it.
   - It is reported privately through GitHub private vulnerability reporting, as `SECURITY.md` asks, and then fixed in its own small PR after W3.
   - It is disclosed once that PR merges. This spec adds no further detail.
2. **No security headers.** The server sets none anywhere: no CSP, `nosniff`, `Referrer-Policy` or `X-Frame-Options`.
   - Inside the programme, every `/api/docs/*` response carries §5.3's set (W3), and the shell carries `frame-src 'none'` as a bundled meta (W6).
   - Outside it, a second small PR after W3 adds a global `onSend` baseline: `nosniff`, `Referrer-Policy: no-referrer`, `frame-ancestors 'self'`. It never overwrites a header a route set.
3. **No error boundary.** `pwa/src` has none; `pwa/src/main.tsx:13-17` renders `<App />` under `StrictMode` with no boundary. One render error therefore unmounts the whole console, and chat uses the same Markdown renderer.
   - Fixed inside the programme: boundaries at the root, the detail pane and each chat item in W4, and around each doc body in W5 (§4.12).

### Terminology

- **Default view.** A Docs page with no `?ref=`. It serves the origin default branch (§2 (c).1) and never overlays drafts.
- **Ref view.** A page with `?ref=<name>` (bare) or `?ref=refs/heads/<b>` or `?ref=refs/remotes/origin/<b>` (qualified). It serves the ref §2 (c) resolves, and overlays drafts when `baseEqual` holds.
- **Served ref.** `ref.served`, the full refname a tree answer resolved, together with `ref.commit`. Every later call in the visit pins to these two, and every page prints them.
- **Draft branch.** `Bd = ref.name`, the branch whose holder supplies drafts.
- **Holder.** The one worktree whose `worktree list` record reads exactly `branch refs/heads/<Bd>` and which passes the trust checks (§2 (d)). It may be anywhere on disk; a detached worktree never holds.
- **Draft.** A file in one of the four sections of the holder's working tree that differs from the holder's HEAD, as `status` or lie-mode hashing reports it. Its state is `modified`, `added`, `untracked`, `deleted`, `typechange` or `conflicted`.
- **Pin.** What a file read names: either a `CommittedPin {project, commit, servedRef, section, path}` or a `DraftPin {project, branch, head, section, path, fp}`. `fp` is the sha256 of the draft's bytes (§2 (e)).
- **baseEqual.** True when the holder's HEAD equals the served commit. A ref view overlays drafts iff it holds.
- **Hint.** The one-line banner that names uncommitted docs the page does not show, and links the view that does.
- **Provenance shorthands.** `s2-decisions`, used in §3 and §4, means the §2 rulings in the decision log above (`Q1`–`Q4`, `s2-remedies`, `evidence`). "attack <n>" and "challenge accepted" name items of the design reviews whose remedies are folded in place. None of them names a separate document.

## §1 Architecture and units

Units by ring. Approved 2026-09-29, and updated only where §2–§7 moved a responsibility.

| Unit | Ring | Job |
|---|---|---|
| `shared/docs.ts` | L0 | Imports nothing. It declares once:<br>- `DOC_SECTIONS`: the four slugs mapped to repo paths;<br>- the `/docs/...` page grammar (`parseDocsPage`, `docsPageUrl`) and the one API URL builder (`docsApi`), used by the PWA and the server;<br>- the value grammars and caps;<br>- the wire types and the failure words (`DOCS_FAILURES`), with their retry class `DOCS_FAILURE_RETRY`;<br>- `admitDraft` and `entryView`;<br>- `contentClass` and the raster table;<br>- `resolveDocRef`;<br>- `githubBlobUrl`;<br>- `DOCS_RESPONSE_HEADERS`. |
| `ccd docs-index` / `docs-tree` / `docs-show` / `docs-fetch` | fleet | The ONLY code that touches git or doc files, through one embedded python helper, `_docs_py`.<br>- `docs-tree` resolves a ref to a commit and lists the four sections. It reports the drafts of the one worktree that has that branch checked out, as facts; whether a draft overlays is decided by L0 `entryView`, never by ccd.<br>- `docs-show` returns one file's bytes from a commit or from that worktree, and reports whether the commit is on the served ref.<br>- `docs-fetch` fetches the default branch or one named branch, with a fixed refspec.<br>- `docs-index` lists every project's shape. |
| `server/src/docs/policy.ts` | L1 | Pure decisions: API query, ref and path validation (built from the L0 predicates); request provenance; the response representation for each content class; cache keys; `refreshDue` given the last fetch; `fetchBranchFor`; lane admission and wire estimates; the HTTP status (`DOCS_FAILURE_HTTP`). |
| `server/src/docs/ports.ts` | L2 | Two ports, `DocsReader {index, tree, show}` and `DocsFetcher {fetch}`, declared for the docs routes, which consume them. Each operation has its own failure union, with no shared null. Each is keyed by `DocsSourceId {node, project}`. |
| `server/src/docs/ccdsource.ts` | L3 | Calls the verbs through the existing ccd runner: the agent in remote mode, local ccd on a single box. It applies the tri-state cap gate, parses and classifies each answer without narrowing it, redacts again, and checks integrity and size. |
| `server/src/docs/routes.ts` (+ `hooks.ts`, `lane.ts`, `cache.ts`) | L4 | `GET /api/docs/projects`, `GET /api/docs/:project/tree`, `GET /api/docs/:project/file`, `POST /api/docs/:project/refresh`.<br>- They form one encapsulated plugin, registered beside `registerUpdateRoutes` (`server/src/server.ts:1629`).<br>- The hooks apply provenance and the response policy.<br>- They are session-gated and not `EXEMPT`.<br>- They decide nothing. |
| docs cache | L4-owned, L1-keyed | In memory and bounded. Committed content is keyed by (node, repo, blob), learned from (project, commit, path) through a listing map. Drafts are never cached. |
| `pwa/src/lib/markdown.tsx` (+ the parse pipeline in `pwa/src/lib/`) | PWA | The chat renderer, extracted from `MessageBubble` so that chat and docs share one pipeline that never renders raw HTML. Under U3 the pipeline carries the pre-scan, the parse worker, iterative `remarkAlerts` and `RenderBoundary`. |
| `pwa/src/screens/DocsScreen.tsx` (+ `pwa/src/docs/`) | PWA | The index, project, section and file views, and the mockup viewer.<br>- `router.ts` gains a search channel for `?ref=` (`useLocation`, `navigate`).<br>- `app.tsx` gains a route arm.<br>- The fleet header gains a Docs door, and session surfaces gain a "Docs on <branch>" row. |

**Request flow.**
1. Open `/docs/<p>/specs/x.md?ref=ws/foo`. The service worker serves the shell.
2. `DocsScreen` parses the path with the shared grammar.
3. It sends `GET /api/docs/<p>/tree?ref=ws/foo`, carrying `x-ccrc-docs: 1`. The request passes the gate, the provenance hook and the read lane.
4. `ccd docs-tree` answers with the resolved ref, the commit, the fetch age, the worktree, and entries marked committed, modified or untracked. `entryView` decides every row from that answer.
5. It sends `GET /api/docs/<p>/file`, pinned either to that commit or, for a draft, to the worktree.
   - A committed pin also carries the served ref, so ccd can report `onRef`.
   - A draft pin carries the holder's HEAD and the draft's fingerprint.
   - The class cap travels as `--max-bytes`.
   - Because of the pin, a listing and its contents can never straddle a ref move.
6. The page renders. When the tree answer says `refreshDue`, the PWA fires one `POST /api/docs/<p>/refresh` (a fetch, then a fresh tree) and re-renders.

**Rulings recorded with §1.**
- This design supersedes the 2026-08-22 brief's T3.
- The tree still never names the standalone docs server, outside the two existing ruling comments that M7.9 locates. Retiring it is operator plumbing: this spec describes it (§7.4), and this repo does not perform it.
- **An inherited seam, not fixed here.** ccd builds project paths from a hard-coded `PROJECTS_ROOT=$HOME/projects` (`ccd/ccd:986`), while the agent and the server use `CCRC_PROJECTS_ROOT`. Docs is self-consistent, because every docs call, the index included (Q3), reads ccd's root, and `unknown-project` names that root (R8).

## §2 ccd protocol, git safety, draft semantics, freshness

This is one contract, assembled from the security, semantics and operations lenses and then hardened by an adversarial review whose remedies are folded in place. Where a later section tightened a value for a measured reason, a one-line note says so beside the value.

**Provenance tags.** "security M<n>", "semantics M<n>", "ops M<n>" and "sheet A/B §n" name grounding measurements taken during the brainstorm. They are kept as provenance, and each citation states the result it supports.

### Measurements

All on git 2.43.0, kernel 6.8.0-137, ext4, in a disposable lab outside the tree.

- **MM1: the filter neutraliser works, but only with `required` overridden.** `status` was run on a stat-dirty `*.md filter=probe` file whose clean driver writes a marker.
  - With `-c filter.probe.clean=`: no marker was written, rc 0. `-c filter.probe.process=` with a process driver gave the same result.
  - With the repo also setting `filter.probe.required=true` and that override omitted: `fatal: … clean filter 'probe' failed`, rc 128.
  - So the neutraliser is all three of `clean=`, `process=` and `required=false`.
- **MM2: mtime granularity is about 1 ms.**
  - Same-size rewrites gave between about 500 and 760 distinct `st_mtime_ns` values per 2000 writes. The count varies; the roughly 1 ms tick does not.
  - A stat-only fingerprint therefore misses a same-size edit made within one tick, so fingerprints are content hashes.
- **MM3: `for-each-ref` patterns.**
  - The pattern `refs/heads/ws2` also matched `refs/heads/ws2/foo`, so an exact-refname filter is required.
  - One call takes several patterns. A pattern that matches nothing gives rc 0 and empty output.
  - `refs/remotes/*` can hold an annotated-tag object (`%(objecttype)`=tag, `%(*objecttype)`=commit). `refs/heads/*` cannot: `update-ref` refuses with "trying to write non-commit object".
- **MM4: `for-each-ref` hides a dangling symref.** With `refs/remotes/origin/HEAD` pointing at a missing ref, `for-each-ref` omitted it silently (rc 0, no output). `symbolic-ref -q` printed the target (rc 0). Telling "dangling" apart from "unset" therefore needs `symbolic-ref`.
- **MM5: `ls-files -z -v -s`** prints `<tag> <mode> <index-blob> <stage>\t<path>`, for example `S 100644 7898… 0\tdocs/…`.
  - The lie-mode check can therefore compare against the index blob in the same spawn.
  - A lowercase `s` means skip-worktree plus assume-unchanged.
  - An unmerged path gives tag `M`, with stage 1–3 entries.
- **MM6: fetch flags.** `git fetch -h` lists `--[no-]write-fetch-head`, `--[no-]auto-gc`, `--[no-]auto-maintenance`, `--[no-]show-forced-updates`, `--[no-]tags`, `--[no-]prune` and `--[no-]recurse-submodules`.
- **MM7: worktree census, fleet-wide: 366 worktrees.**

  | Where | Count | Of which |
  |---|---|---|
  | ws-add workspaces | 260 | 35 on `ws/*`, 168 on renamed branches, 57 detached |
  | under `<project>/.claude/worktrees` (Claude Code subagent and Workflow isolation, created under the project's main checkout) | 64 | 46 on their own branches, 18 detached |
  | session scratch directories under `/tmp` | 23 | 5 on branches |
  | main checkouts | 16 | |
  | elsewhere | 3 | |

  - One branch is held live by two Workflow worktrees at once.
  - 0 of 166 worktree-held branches are behind origin (semantics M4).
- **MM8: drafts on the default branch.** Three projects' main checkouts sit on their default branch with uncommitted docs in the four sections: 36, 3 and 1 files.
- **MM9: two trust gaps, reproduced by the review.**
  - A per-worktree `core.worktree` redirect makes a worktree's status read a different directory from the one its record names.
  - A `.git` file or symlink at project P, pointing at project Q's git directory, passed the old discovery, so P served Q's content under P's name.
- **Code read.**
  - `_pr_py` already runs git from python: `def git(main,*args)` → `subprocess.run(['git','-C',main,*args])`, at `ccd/ccd:5396`.
  - The agent dispatches `req` frames with `handleReq(...).catch`, with no await and no semaphore (`agent/src/server.ts:816-829`).

---

### (a) Verbs, argv, grants, caps, builders, budgets

#### Shape

Each verb has a bash front and one embedded python helper.

**The bash front**, `cmd_docs_<verb>`, does three things in order:
1. **An exact arity and flag-order check**, including the `--max-bytes` grammar. A bad shape gives `die "usage: ccd docs-… "`, rc 1, which is the server-bug class.
2. **A python probe**, `python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 8) else 3)'`.
   - If it fails, the front prints one fixed ASCII line and exits rc 0: `{"v":1,"verb":"docs-<verb>","ok":false,"elapsedMs":0,"failure":"helper-unavailable","detail":"python-too-old"}` when the probe exits 3, and the same line with `"detail":"python-missing"` for any other non-zero exit, `command not found` included.
   - Writing that line needs no quoting, so it needs no python.
   - This probe holds the version floor's one definition (§7.2).
3. **`_docs_py <verb> "$@"`**, with the program on fd 3, following the `_pr_py` idiom (`ccd/ccd:5347-5361`).

**The helper `_docs_py`** does all value validation, every git call, NUL parsing, the `openat` walks, hashing, encoding, redaction and the single stdout write.
- It reads every value **by fixed index**, from the same shape the bash front checked. It never uses `argparse`, `getopt` or `allow_abbrev`, so a value such as `-h` or `--commit` is always a value.
- It runs as **one python process per verb call**. Start-up costs 30–50 ms (ops M3).

#### Placement

- **One block** holds the verb bodies, `_docs_py` and every docs constant. It goes after `:21428`, the highest cited anchor, and above the dispatcher guard (`ccd/ccd:23550`). It shifts the guard, the dispatcher arms and the usage line, which are cited, so the W1 citation re-measure covers them along with the caps-block shift.
- **What does shift.** The caps lines (below) shift everything after `:8375`, `:21428` included. The arms and the usage edit shift everything from `:23551`. The plan therefore carries a citation re-measure task.
- **The arms** go after `pr-state)` (`:23583`), indented two spaces, one per verb:
  ```
    docs-tree)  shift; cmd_docs_tree "$@" ;;
  ```
  The dispatcher regex that must match them is at `server/test/ccd-archive.test.ts:194`.
- **Edited in place:**
  - the usage string at `:23585`;
  - `_pr_py`'s "The ONE embedded helper" comment (`:5347`), already loose because other embedded python exists, for example `:8404`;
  - `:1527`'s "ccd makes no outbound network call", already false at `:6938` and `:12288`.

  The two comments keep their line counts.
- **Restamp** `ccd/ccd` last, with `markGenerated`.

#### Verbs (final arity; `docs-v1` names exactly this argv)

| Verb | Exact argv | Tokens after the verb | Grant | `REQUIRED_VERB_FLAG` | `CCD_ARGV` builder |
|---|---|---|---|---|---|
| docs-index | `docs-index --all` | 1 | `['docs-index','--all']` | `'--all'` | `docsIndex()` |
| docs-tree | `docs-tree --project P`<br>`docs-tree --project P --ref R` | 2, 4 | `['docs-tree','--project']` | `'--project'` | `docsTree(project, ref: string \| null)` |
| docs-show (committed) | `docs-show --project P --commit C --ref R --section S --path X --max-bytes N` | 12 | `['docs-show','--project']` | `'--project'` | `docsShowCommitted(project, commit, servedRef, section: DocSectionSlug, path, maxBytes: number)` |
| docs-show (draft) | `docs-show --project P --draft-branch B --head H --section S --path X --fingerprint F --max-bytes N` | 14 | same grant | same | `docsShowDraft(project, branch, head, section: DocSectionSlug, path, fp, maxBytes: number)` |
| docs-fetch | `docs-fetch --project P`<br>`docs-fetch --project P --branch B` | 2, 4 | `['docs-fetch','--project']` | `'--project'` | `docsFetch(project, branch: string \| null)` |

- **Mode.** The third token after the verb (`--commit` or `--draft-branch`) picks the `docs-show` mode.
- **The two `docs-show` values the server supplies:**
  - **`--ref R`** is the tree answer's `ref.served`, in the qualified grammar only. ccd uses it for one thing, the `onRef` provenance check in (e). It never uses it to choose bytes.
  - **`--max-bytes N`** is `DOCS_CLASS_CAP[contentClass(path)]`, the class cap the server chose (§6.1). ccd enforces `min(N, DOCS_MAX_FILE_BYTES)` and holds no extension list.
- **Builders validate nothing.** Values "reach ccd unvalidated by this builder", as the house rule says (`server/src/ccdargv.ts:414-418`, `:548-551`). The one type-level closure is `section: DocSectionSlug`.
- **`EXEC_COMMANDS` is unchanged** (`agent/src/whitelist.ts:192`).
- **Every verb is enrolled in `REQUIRED_VERB_FLAG`** (`:310-314`). A bare-verb grant is then both a compile error (`IllegalGrant`) and a boot refusal (the audit).
- **What `docs-show` never takes:**
  - no `--blob` flag, because a blob sha alone would read any object in the store;
  - no `--worktree` flag, because ccd resolves the worktree itself.

#### Value grammars

**Where they live.**
- Each grammar is declared once in `shared/docs.ts` as a pattern-body string. `_docs_py` holds exactly one single-line literal copy of each, and a parity test extracts them.
- Python matches with `re.fullmatch`, which avoids python's `$`-before-newline hazard. TypeScript matches with `new RegExp('^(?:'+body+')$','u')`.
- L1 `policy.ts` applies the same grammars through the L0 predicates, so bad input gets a 400 without an agent round trip.
- Every grammar line is pure ASCII source. Non-ASCII code points are written only as `\uXXXX` (or `\u{…}` in TS).
- **There is no runtime `check-ref-format` call.** The ref grammar is a proved strict subset of what git accepts (sheet B §2), so that call could never go red. The proof lives in a fuzz test instead.

```
project      [A-Za-z0-9_][A-Za-z0-9._-]{0,99}
bare ref     (?!HEAD$)(?!refs/)(?!.*\.\.)(?!.*\.lock(?:/|$))(?!.*\.(?:/|$))[A-Za-z0-9][A-Za-z0-9._-]*(?:/[A-Za-z0-9][A-Za-z0-9._-]*)*   (≤ 200 chars)
qualified    (?:refs/heads/|refs/remotes/origin/) + <bare ref>
commit, head [0-9a-f]{40}|[0-9a-f]{64}
section      specs|plans|product-design|conventions           (generated from DOC_SECTIONS)
rel path     (?!/)(?!.*/$)(?!.*//)(?!(?:.*/)?\.\.?(?:/|$))[^\u0000-\u001f\u007f-\u009f]{1,1024}   + the category check
fingerprint  [0-9a-f]{64}                                     (sha256 of the draft bytes)
max-bytes    [1-9][0-9]{0,7}                                  (checked by the bash front: a bad N is a usage error)
```

- **project.** The first character is `[A-Za-z0-9_]`, so a project name can never start with `-` or `.`. That is stricter than `_ws_project_valid` (`ccd/ccd:6165-6180`), which admits a leading `-`. Docs is read-only, so being stricter is safe. A directory name that fails the grammar, a dash-leading one included, is counted in docs-index's `unlisted`, never listed.
- **bare ref.** Sheet B: 0 of 2197 real names are rejected, and the accepted strings form a strict subset of `check-ref-format` over 4641 fuzz strings. The grammar excludes `* : + ^ ~ @{`, so it cannot widen a refspec.
- **qualified.** Only `--ref` accepts this grammar. TS derives it by concatenation, python by the same concatenation, and parity compares the derived strings.
- **commit, head.** The length must equal the repo's object format, otherwise `bad-commit`. Short shas are refused, because `cat-file` accepts them (sheet B §7).
- **rel path.**
  - **Category check.** No code point may have Unicode general category `Cf`, `Zl`, `Zp`, `Co` or `Cn`, or be a variation selector (U+FE00–U+FE0F, U+E0100–U+E01EF).
    - The categories are declared once as `DOCS_PATH_EXCLUDED_CATEGORIES`, and the selector ranges once beside them.
    - TS turns them into a `\p{…}` lookahead under the `u` flag. Python applies them as a `unicodedata.category` post-check after `fullmatch`.
    - Parity compares the two lists textually and the verdicts over one corpus.
    - The check covers every bidi control and line or paragraph separator that the earlier hand-picked list named (U+061C, U+200E, U+200F, U+2028, U+2029, U+202A–U+202E, U+2066–U+2069), plus zero-width and private-use characters.
  - **Bytes.** The path must be strict UTF-8: python re-encodes argv with `surrogateescape` and decodes strictly. It is at most 1024 bytes, each component at most 255 bytes, and at most 16 deep.
  - **Display.** The PWA marks any non-ASCII name visibly (§4).

#### Caps

**The caps lines.** Append after `echo child-argv-v1` (`:8374`) and before `}` (`:8375`):
```
echo docs-tree
echo docs-show
echo docs-fetch
echo docs-index
echo docs-v1
```

**What changes with them.**
- The anchor shift starts at `:8375`, which is why the plan carries a citation re-measure task.
- Add `'docs-v1'` to `KNOWN_CAPABILITY_TOKENS` (`server/test/ccd-archive.test.ts:154`), together with `toContain(DOCS_CAP)`.
- Declare `DOCS_CAP = 'docs-v1'` once, in `server/src/ccdargv.ts` beside `WIN_SIZE_CAP` (`:719`).
- Add `docs-index`, `docs-tree`, `docs-show` and `docs-fetch` to `CAP_GATED_VERBS` (`server/test/verb-gate.test.ts:87`).
  - The set holds **verb names**: the test resolves each `CCD_ARGV` key through `VERB_OF` (`:110`, `:233`), which is derived from each builder's `built[0]` under a four-string probe.
  - Both `docs-show` builders therefore resolve to `docs-show`. Every docs builder must build under that probe without throwing, or gain a `PROBE_ARGS` entry.

**The gate.** It is a tri-state, inside the one adapter function that calls `CCD_ARGV.docs*(`:

```ts
const verbs = state.ccdVerbs;
if (verbs === null || !verbs.includes('caps')) return fail('caps-unknown');
if (!capSupported(state, DOCS_CAP)) return fail('unsupported');
```

- Both answers are decided before any exec.
- **A list that lacks `caps` measured nothing.** Every real `ccd caps` lists `caps` itself (`ccd/ccd:8200`). An agent whose boot read failed seeds `[]` (`agent/src/server.ts:883-889`, `?? []`). Folding that into "ccd too old" would give the wrong remedy (§7.1).
- **The literal `capSupported(` call** in that scope is what `verb-gate.test.ts:238` accepts for a verb in `CAP_GATED_VERBS`.
- **Why `capSupported` cannot stand alone.** On its own it folds "agent not ready" into "ccd too old" (`server/src/ccdargv.ts:742-749` returns false on null). Those two cases have different remedies.

#### Budgets

The helper enforces them.
- Each git call runs under `Popen(start_new_session=True)`.
- At the deadline the helper sends `killpg` SIGTERM, then SIGKILL 2 s later. That reaches the `git-remote-https`, ssh and `git-lfs` grandchildren.
- A whole-helper deadline wraps all the calls.

**Invariant:** helper deadline + 2 s grace + 5 s < runner budget.

| Verb | Per-call bounds | Helper deadline | `CCD_VERB_TIMEOUT_MS` (`server/src/remote/runner.ts:27`) |
|---|---|---|---|
| docs-index | 5 s | 12 s | 20 000 |
| docs-tree | ref calls 5 s; `ls-tree`, `worktree list`, `status` 8 s; `rev-list --count` 2 s soft (gives `count:'timeout'`) | 12 s | 20 000 |
| docs-show | 5 s; `merge-base --is-ancestor` for `onRef` 2 s soft (gives `unmeasured`) | 7 s | 15 000 |
| docs-fetch | fetch 40 s | 45 s | 60 000 |

- A per-call expiry answers `git-timeout {step}`, except inside the draft phase, see (d). A fetch expiry answers `fetch-timeout`.
- Local mode's `realRunner` has no timeout (`server/src/exec.ts:60-73`), so these bounds are the only ones there.
- **Measured costs:**
  - `worktree list`: 0–30 ms warm at 83 worktrees (ops M1), 0.434 s cold (sheet B);
  - `ls-tree`: 11–63 ms;
  - `cat-file` of 1.3 MB: 17–26 ms;
  - `rev-list --left-right --count`: at most 0.40 s (semantics M5);
  - the `ccd` floor: 60–90 ms (ops M2).

#### The hardened git runner `_docs_git` (python)

- **argv prefix:** `git --no-pager --no-optional-locks -c core.fsmonitor=false -c core.hooksPath=/dev/null -C <dir>`.
- **stdin and stdout.** stdin is `DEVNULL`. stdout is read up to 16 MiB. Beyond that the answer is `too-many-entries`, except inside the draft phase, see (d).
- **Read-verb environment:** `os.environ` with **every `GIT_*` key deleted**. That covers `GIT_DIR`, `GIT_CONFIG_PARAMETERS`, `GIT_CONFIG_COUNT/KEY_n/VALUE_n` and `GIT_EXEC_PATH`. Then set:
  - `GIT_NO_LAZY_FETCH=1` (measured honoured on 2.43.0; which release introduced it is UNMEASURED);
  - `GIT_NO_REPLACE_OBJECTS=1` (security M5);
  - `GIT_CEILING_DIRECTORIES=<realpath(parent of dir)>` (security M4);
  - `GIT_TERMINAL_PROMPT=0`, `GIT_PAGER=cat`, `LC_ALL=C`.
- **Fetch environment:** the same, except that `GIT_SSH`, `GIT_SSH_COMMAND`, `GIT_ASKPASS`, `GIT_SSL_CAINFO` and `GIT_SSL_CAPATH` are kept if present. This keep-list is R2's subject; contingency `docs-fetch-keeplist` widens it per remote class.
- **Subcommand allowlist, read verbs:**
  - `rev-parse`, `symbolic-ref`, `for-each-ref`, `ls-tree`;
  - `cat-file`, `--batch-check` or `blob` only;
  - `worktree list`, `status`, `ls-files`;
  - `merge-base --is-ancestor`, `rev-list --left-right --count`;
  - `config --get` and `config -z --get-regexp`.
- **`docs-fetch`** may additionally run `fetch`.
- **Never used:** `show`, `log`, `diff`, `archive`, `checkout-index`, `--textconv`, `--filters`, `<commit>:<path>`, `remote set-head`, `check-attr`.

---

### (b) Wire

#### The exit contract

Every docs verb either exits rc 0 with exactly one JSON line on stdout, or exits rc ≠ 0 with **empty** stdout.

- **One write.** Python writes once, at the end, with `sys.stdout.buffer.write`.
- **Exceptions.** A top-level `try/except` turns any exception into rc 0 `helper-failed {detail}`, where `detail` is the last traceback line, at most 512 B, redacted.
- **Final guards, before writing:**
  - **tree and index:** the framed length must be at most `DOCS_MAX_LISTING_WIRE_BYTES` (1 MiB), otherwise `too-many-entries {count, bytes}`.
    - The framed length is `len(json.dumps(line, ensure_ascii=False).encode())`: the line as the agent will JSON-encode it inside its frame.
    - `DOCS_MAX_ENTRIES` still applies.
    - Tightened from the 6 MiB answer cap: the largest measured tree frames at about 52 KB (§6.0).
  - **show:** the line must be at most `DOCS_MAX_ANSWER_BYTES` (6 291 456), otherwise `too-large`.
- **The failure key is `"failure"`.**
  - `server/test/wsaudit.test.ts:57-60` scans the whole of `ccd/ccd` for `_reap_refuse <alpha>`, `"refused":"<w>"`, `"verdict":"<w>"` and `'!<alnum>`. The ccd source must never contain any of those shapes.
  - The scan is blind to the key `failure`, which is why that key is used.

#### Envelope

`{v:1, verb:'docs-tree'|'docs-show'|'docs-fetch'|'docs-index', ok:boolean, elapsedMs}`.

- A failure adds `failure` and `detail?` (at most 2 KiB, redacted), plus that word's context fields.
- Strings are strict UTF-8, written with `ensure_ascii=False`. Names that are not strict UTF-8 never reach the wire; they are counted in `unlisted`.

#### One redactor

`redact(s)` runs in the helper over **every** string derived from stderr or a traceback (`detail`, `stderrHead`, `helper-failed`'s `detail`). L3 runs it again over every string field of a failure body before anything reaches HTTP.

| Pattern | Becomes |
|---|---|
| `://[^/@\s]+@` | `://***@` |
| `[?&](access_token\|token)=[^&\s]+` | the separator, the key, `=***` |
| `gh[opsu]_[A-Za-z0-9]{20,}` | the prefix plus `***` |
| any line containing `Authorization:` | `Authorization: ***` |

The patterns are declared once in `shared/docs.ts`, and `_docs_py` holds one parity-checked literal copy of them (row 48).

#### Types (`shared/docs.ts`, L0, imports nothing; additive only, no `FLEET_PROTO` bump)

```ts
export const DOC_SECTIONS = { specs:'docs/superpowers/specs', plans:'docs/superpowers/plans',
  'product-design':'docs/product-design', conventions:'docs/conventions' } as const;
export type DocSectionSlug = keyof typeof DOC_SECTIONS;
type Sha = string;
export type DocsGithub = { state:'named'; slug:string /*owner/name*/ } | { state:'none' };   // §3.11
// DocsFetchFailure: the fetch words of (i)

export interface DocsTreeOk { v:1; verb:'docs-tree'; ok:true; elapsedMs:number; project:string;
  repo: { key:string /*32hex sha256(realpath(common-dir))*/; objectFormat:'sha1'|'sha256'; shallow:boolean };
  github: DocsGithub;
  ref: { requested:string|null; served:string /*full refname*/; name:string; side:'local'|'origin'; commit:Sha;
         via:'default:origin-head'|'default:origin-main'|'default:origin-master'|'default:local-main'|'default:local-master'|'local'|'origin'|'qualified';
         tried:{ ref:string; result:'resolved'|'absent'|'dangling'|'malformed'|'not-a-commit' }[];
         relation:'equal'|'local-only'|'origin-only'|'local-ahead'|'local-behind'|'diverged'|'unmeasured';
         counterpart: null | { ref:string; commit:Sha; ahead:number|null; behind:number|null; count:'measured'|'timeout'|'shallow' } };
  mainCheckout: { path:string; branch:string|null; head:Sha };
  sections: { slug:DocSectionSlug; path:string; state:'present'|'absent'|'not-a-directory'; count:number }[]; // all 4, DOC_SECTIONS order
  entries: DocsEntry[];
  unlisted: { count:number; byReason:Partial<Record<'invalid-utf8'|'unsafe-char'|'too-long'|'too-deep', number>> };
  drafts: DraftsFacts;
  freshness: { remote:'origin'|null; trackedRef:string|null;
               stamp: null | { okAgeMs:number|null; attemptAgeMs:number; lastOutcome:'ok'|DocsFetchFailure; okCommit:Sha|null };
               fetchHead: null | { ageMs:number; bytes:number } } }  // fetchHead is diagnostic only (sheet B §9)

export interface DocsEntry { section:DocSectionSlug; path:string /*rel*/;
  committed: null | { kind:'file'|'exec'|'symlink'|'submodule'; blob:Sha /*commit sha for submodule*/; size:number|null };
  draft: null | { state:'modified'|'added'|'untracked'|'deleted'|'typechange'|'conflicted';
                  kind:'file'|'symlink'|'directory'|'special'|'hardlink'|'foreign-owner'|'other-device'|'unreadable'|'absent';
                  size:number|null;
                  fp:Sha|null /*sha256(bytes); null iff not a regular file that passed the leaf checks and is ≤ DOCS_MAX_FILE_BYTES*/;
                  errno?:string; trust:'status'|'hash' } }

export type DraftsFacts =
  | { state:'holder'; branch:string; worktree:{ path:string; head:Sha; class:'main'|'workspace'|'other' };
      baseEqual:boolean; base:{ ahead:number|null; behind:number|null; count:'measured'|'timeout'|'shallow' } | null;
      caveats:('assume-unchanged'|'skip-worktree'|'filters-bypassed')[]; opaque:string[] /*nested-repo dirs*/ }
  | { state:'none'; branch:string; skipped:{ path:string; why:'prunable'|'missing-dir'|'unsafe-path' }[] }
  | { state:'ambiguous'; branch:string; candidates:string[] }
  | { state:'untrusted'; branch:string; worktree:string;
      why:'common-dir'|'toplevel-mismatch'|'foreign-owner'|'identity-changed'|'dubious-ownership' }
  | { state:'unreadable'; branch:string; worktree:string|null; step:'worktree-list'|'status'|'ls-files'|'filter-config'; detail:string }
  | { state:'unsettled'; branch:string; worktree:string }
  | { state:'too-many'; branch:string; worktree:string; count:number; bytes:number };

export interface DocsShowOk { v:1; verb:'docs-show'; ok:true; elapsedMs:number;
  source:'committed'|'draft'; section:DocSectionSlug; path:string; size:number; sha256:Sha;
  encoding:'utf8'|'base64'; text?:string; b64?:string;
  commit?:Sha; blob?:Sha; mode?:string; onRef?:'contains'|'not-contained'|'unmeasured';  // committed only; onRef always present there
  worktree?:string; branch?:string; head?:Sha; fp?:Sha }                                   // draft only (fp === sha256)

export interface DocsFetchOk { v:1; verb:'docs-fetch'; ok:true; elapsedMs:number;
  branch:string; trackedRef:string; defaultVia?:string /*iff no --branch*/;
  before:Sha|null; after:Sha; moved:'created'|'updated'|'unchanged'; stamp:'written'|'unwritten' }

export interface DocsIndexOk { v:1; verb:'docs-index'; ok:true; elapsedMs:number; unlisted:number;
  unwalked?:number;                                             // projects not reached before the helper deadline; absent when 0 (D-4157)
  duplicates: { repoKey:string; projects:string[] }[];          // every repoKey held by two or more rows
  projects: { project:string;
    state:'ready'|'not-a-git-repo'|'linked-worktree'|'shared-repo'|'partial-clone'|'no-default-branch'|'repo-unreadable';
    github:DocsGithub; repoKey?:string;
    default?:{ name:string; via:string; commit:Sha }; sections?:Record<DocSectionSlug, number|null>;
    sectionsOnDisk?:DocSectionSlug[] /*non-git dirs: 4 lstats*/; owner?:string|null; branch?:string|null;
    fetch?:{ okAgeMs:number|null; lastOutcome:string } }[] }
```

The server wraps these answers unchanged (§3.5): `DocsTreeResponse {tree, refreshDue}`, `DocsFileResponse {contentClass, show, from}`, `DocsProjectsResponse`, `DocsRefreshResponse`. `refreshDue` exists only on an ok tree.

#### Server classification (`server/src/docs/ccdsource.ts`, L3)

The adapter runs over the `CcdResult` from `server/src/lifecycle.ts:30-39`. Checks run in order, and every word is carried verbatim.

| # | Condition | Word |
|---|---|---|
| 0 | Before any exec | the tri-state gate in (a) |
| 1 | `killed` and `signal` are both `UNMEASURED`: the transport catch, `{code:1, stdout:'', stderr:msg}` (`server/src/remote/runner.ts:185`) | - `stderr === 'forbidden'` → **`not-granted`**. This is the agent's refusal (`agent/src/server.ts:324`), relayed at `server/src/remote/client.ts:316`.<br>- `'timeout'` → **`link-timeout`** (`client.ts:218`).<br>- anything else → **`link-failed {cause}`** (`disconnected`, `aborted`, …) |
| 2 | `killed === true` | `ccd-timeout`: the agent's budget fired |
| 3 | `signal` is a non-null string and `killed === false` | `ccd-killed {signal}` |
| 4 | `!ok` and `stdout !== ''` | `answer-overflow`. This is maxBuffer truncation, which reads as code 1 (sheet A §6). The exit contract makes it detectable, and it can happen only if a cap is broken. |
| 5 | `!ok` and `stdout === ''` | `ccd-fault {code, stderrHead}`: a `die`, an old ccd's usage line, or ENOENT |
| 6 | `ok`, but not exactly one line, not JSON, `v !== 1` or the wrong `verb` | `malformed-answer {why:'parse'\|'schema'}` |
| 7 | `ok:false` with a word outside the ccd set | `unknown-failure {word}`, never mapped onto a known word |
| 8 | show only | - `size` and `sha256` must match the decoded bytes, otherwise `malformed-answer {why:'integrity'}`.<br>- These must echo the request, otherwise `{why:'pin'}`: `commit`/`section`/`path`, or `branch`/`head`/`fp` for a draft.<br>- A committed `blob` must equal the listing's when the server holds one, otherwise `{why:'pin'}`.<br>- A committed answer without `onRef` is `{why:'schema'}`. |
| 9 | every answer | `Buffer.byteLength(stdout) > job.wire` gives `malformed-answer {why:'oversize'}`, with `console.warn('ccrc-server: docs answer over its declared bound')` (§6.2) |

Before a failure body leaves the adapter, every string field derived from stderr (`detail`, `stderrHead`, `cause`) passes through `redact` a second time.

---

### (c) Ref resolution

All of this runs in `M = $PROJECTS_ROOT/<project>`, after discovery (h). Git only ever sees fully qualified refs.

#### 1. Default view (no `--ref`)

1. `symbolic-ref -q refs/remotes/origin/HEAD` gives a target T, or unset.
   - T must match `^refs/remotes/origin/<bare>$`, otherwise it is `malformed`.
   - This spawn exists because `for-each-ref` hides a dangling symref (MM4).
2. One `for-each-ref --format='%(refname)%00%(objecttype)%00%(objectname)%00%(*objecttype)%00%(*objectname)' --end-of-options <T?> refs/remotes/origin/main refs/remotes/origin/master refs/heads/main refs/heads/master`.
   - Keep exact refname matches only (MM3).
   - A candidate is usable if it is a `commit`, or a `tag` whose peeled type is `commit`.
3. The rungs, in order:

   | Rung | Candidate | `via` |
   |---|---|---|
   | 1 | T, which must resolve; if it does not, `tried` says `dangling` | `default:origin-head` |
   | 2 | `refs/remotes/origin/main` | `default:origin-main` |
   | 3 | `refs/remotes/origin/master` | `default:origin-master` |
   | 4 | `refs/heads/main` | `default:local-main` |
   | 5 | `refs/heads/master` | `default:local-master` |
   | — | none | `no-default-branch {tried}` |

- **Sides.** Rungs 1–3 serve the origin side (`side:'origin'`). Rungs 4–5 cover a repo with no `refs/remotes/*` (sheet B §3). They are a deliberate fallback inside the ruling "origin default branch only": that ruling means never the checked-out branch and never drafts, and a repo with no origin at all still gets its local default branch, labelled `default:local-main` / `default:local-master` on every page.
- **Never** use the checked-out branch, and never use the local default when an origin rung resolved. Main checkouts sit on feature branches, and local `main` is 44 commits behind `origin/main` on one repo (security M9).

#### 2. `--ref refs/heads/<b>` or `--ref refs/remotes/origin/<b>`

- That exact ref is used, with `via:'qualified'`. There is **no fallback to the other side**.
- If it is absent, the answer is `unresolved-ref {tried:[it]}`.

#### 3. `--ref <b>` (bare): Q2, the newer side wins

- One `for-each-ref` covers `refs/heads/<b>`, `refs/remotes/origin/<b>` and `refs/tags/<b>`, with the exact filter.
- The tags row is used only for the hint below.
- Candidates that do not peel to a commit are excluded. If every candidate is excluded, the answer is `ref-not-commit {ref, type}`.
- L is `refs/heads/<b>` and R is `refs/remotes/origin/<b>`:

| Present | Test | Served | `relation` |
|---|---|---|---|
| neither | — | `unresolved-ref {tried:[L,R], suggest?, hint?}` | — |
| L only | — | L | `local-only` |
| R only | — | R | `origin-only` |
| both, equal | — | L (so drafts can apply) | `equal` |
| both | `merge-base --is-ancestor L R` rc 0 | R | `local-behind` |
| both | `merge-base --is-ancestor R L` rc 0 | L | `local-ahead` |
| both | both rc 1 | L | `diverged` |
| both | rc ≥ 2, or the repo is shallow | L | `unmeasured` |

- `suggest` is set only when `<b>` starts with `origin/` and the remainder resolves. That is the old `?ref=origin/<b>` trap, now answered truthfully.
- `hint:'tag'` is set when `refs/tags/<b>` exists. Tags are never served.

#### 4. Counterpart

- The counterpart is the other side of the served name: for a served `refs/remotes/origin/<n>` it is `refs/heads/<n>`, and for a served `refs/heads/<n>` it is `refs/remotes/origin/<n>`. This holds for every way a ref is chosen: a bare name, a qualified ref, and every default rung.
- `relation` is always computed from the served ref and its counterpart with the table in 3 (the ancestry tests). A missing counterpart gives `local-only` when the served side is local, or `origin-only` when it is origin; `counterpart` is then `null`. A qualified ref changes only which side is served, never how `relation` is computed.
- Counts come from `rev-list --left-right --count --end-of-options S...K`, with a 2 s soft bound. If that runs out, `count:'timeout'`. A shallow repo gives `count:'shallow'`.

#### 5. Only `origin` is consulted

A second remote (one measured repo has one) is never read.

#### 6. What pages pin to

`ref.served` plus `ref.commit` are the only values any later call pins to. Every page, leaves included, prints the served refname, the short commit and `via`.

**Refs are never ambiguous.** They are fully qualified with a fixed precedence. Ambiguity exists only among worktree holders, see (d).

---

### (d) Draft overlay

#### Draft branch and holder

- **The draft branch** is `Bd = ref.name`.
  - In the default view it is the discovered default branch's name. Its holder's facts feed only the hint, never an overlay.
  - In a ref view it is the branch part of the bare or qualified name.
- **Holder enumeration.** Run `worktree list --porcelain -z` once in M and parse its NUL-separated records (sheet B §4).
  - A **holder** is a record with exactly `branch refs/heads/<Bd>`.
  - Records that are `prunable`, whose path does not open as a directory, or whose path is not strict UTF-8 go into `skipped[]` with a reason.
  - The first record is `mainCheckout`. A detached worktree is never a holder: its uncommitted files are scratch copies, not "the draft", so they are not addressable.
  - `%(worktreepath)` is not used, because it hides duplicates and names deleted worktrees (security M3, semantics M1).
  - `_ws_branch_holders` is not reused, because it reads non-`-z` porcelain.
- **Location is not restricted.** Holders are found wherever git records them: ws-add workspaces, `<project>/.claude/worktrees`, session scratch directories under `/tmp`, the main checkout (MM7). Location is reported only as `class` (`'main'|'workspace'|'other'`).

| Holders | `drafts` |
|---|---|
| 0 | `none` |
| ≥ 2 | `ambiguous {candidates}`: committed only, never picked. This happens live, for example with two Workflow worktrees on one branch (MM7). |
| enumeration failed, overflowed or timed out | `unreadable {step:'worktree-list', detail}`, never folded into `none` |
| exactly 1 | the trust checks, then the snapshot below |

#### Holder trust (every check, in order; any failure gives `untrusted {why}`, committed only)

1. **Common dir and toplevel.** Run `rev-parse --path-format=absolute --git-common-dir --show-toplevel` in W, with the ceiling set to W's parent.
   - The common dir must equal the project's, otherwise `why:'common-dir'`. This is `_ws_common_dir`'s stray-`git init` guard.
   - The toplevel must equal `realpath(W)`, otherwise `why:'toplevel-mismatch'`. This closes the per-worktree `core.worktree` redirect (MM9).
2. **Ownership.** `detected dubious ownership` in stderr gives `why:'dubious-ownership'`.
3. **Owner.** Open W with `O_RDONLY|O_DIRECTORY`. `fstat(fd).st_uid` must equal `geteuid()`, otherwise `why:'foreign-owner'`.
4. **Identity.** Record W's `(st_dev, st_ino)` from `stat(W)` during step 1. The `O_DIRECTORY` fd that every later walk starts from must `fstat` to the same pair, otherwise `why:'identity-changed'`.

`docs-show` repeats all four checks on its own re-enumerated record. A failure there answers `untrusted-worktree {why}`.

#### Snapshot (exactly one trusted holder W, with record HEAD H)

1. **Filter neutralisers.** Run `config -z --get-regexp '^filter\..*\.(clean|process|required)$'` in W.
   - For each driver name matching `^[A-Za-z0-9._-]+$`, `status` gets `-c filter.<n>.clean= -c filter.<n>.process= -c filter.<n>.required=false`. This is measured to disable both driver kinds and to avoid the rc 128 required failure (MM1).
   - A name outside that grammar gives `unreadable {step:'filter-config'}`, and status is not run.
   - Any neutralised filter adds the `filters-bypassed` caveat.
   - `--attr-source=<empty tree>` is rejected: it gives false `.M` under eol attributes (sheet B §6).
2. **Status:**
   ```
   status --porcelain=v2 -z --branch --no-ahead-behind --no-renames --untracked-files=all --ignore-submodules=all -- <4 DOC_SECTIONS paths>
   ```
   - `# branch.oid` must equal H, otherwise the phase is retried once.
   - `--no-ahead-behind` is used because the header is read only for `branch.oid` and `branch.head`, and the ahead/behind walk is unbounded.
3. **Lie-mode read:** `ls-files -z -v -s -- <4 paths>` (MM5).

**The draft phase degrades; it never fails the tree.** Steps 1–3 and the draft reads below form the draft phase.
- A `status` or `ls-files` stdout overflow (16 MiB) gives `too-many {count: records parsed before the cut, bytes: bytes read}`.
- A per-call timeout gives `unreadable {step, detail:'timeout'}`.
- So does the helper deadline (D-4164). The draft reads check it per path (`step:'status'` for the status-listed reads, `'ls-files'` for the lie-mode reads), and the phase runs on the helper deadline less a 2 s tail that `mainCheckout`'s fallback keeps. `remote.origin.url` is read before the phase, and a committed listing already over `DOCS_MAX_ENTRIES` skips the phase, because the answer is `too-many-entries` either way.
- In all these cases the committed listing still answers in full.

#### Classification

Paths are first filtered by section prefix and by the path grammar. Paths that fail go to `unlisted`.

| Record | `draft.state` |
|---|---|
| `1` with M in X or Y, and no A, D or T | `modified` |
| `1` with A in X or Y, including intent-to-add `.A` | `added` |
| `1` with D in X or Y | `deleted` (`kind:'absent'`) |
| `1 AD` | dropped |
| `1` with T | `typechange` |
| `u …` | `conflicted`. The bytes, conflict markers included, are served with a badge. |
| `? path` | `untracked` |
| `? path/` | not an entry; goes to `opaque[]` (nested repo) |
| `2 …` or any unknown type | the whole drafts result becomes `unreadable {step:'status', detail:'unexpected-record'}` |
| ignored | never requested, never listed |
| lowercase tag (assume-unchanged) or `S`, with no status record | decided by hashing (below) |

**Lie-mode hashing.**
- Assume-unchanged, file absent: `deleted {trust:'hash'}`.
- Skip-worktree, file absent: no draft (sparse checkout); the entry stays committed.
- A present regular file is hashed git-blob style and compared with the index blob. If they differ: `modified {trust:'hash'}`.
- Either tag adds a caveat.

**Draft facts.**
- Every non-deleted draft path is walked with the `openat` rule in (f), including its leaf checks. The walk gives the entry its `kind`.
  - A regular file that fails a leaf check gets `kind` `hardlink`, `foreign-owner` or `other-device`, and `fp:null`. It is never read.
- A regular file of at most `DOCS_MAX_FILE_BYTES` that passes the leaf checks is read once: `fp = sha256(bytes)`, and `size` comes from that read.
- A larger file gets `fp:null` and keeps its `size`.
- A stat fingerprint is **not** used: mtime has about 1 ms granularity here (MM2).
- The aggregate draft read budget is `DOCS_DRAFT_HASH_BUDGET` = 32 MiB, and the count limit is `DOCS_MAX_DRAFTS` = 1000. Past either, the result is `too-many {count, bytes}`: committed only, with a banner.

**Race guards.**
- **Revert race.** When `baseEqual`, a `modified`, `typechange` or `conflicted` draft whose git blob id equals the committed blob at C is dropped: it was reverted after status ran.
- **Head bracket.** After the reads, run `rev-parse --verify --end-of-options HEAD` in W. If it is not H, retry once. If it still differs, the result is `unsettled`, with no draft entries.

**Facts only.** ccd emits `baseEqual = (H === ref.commit)`. When that is false it also emits `base` counts (2 s soft bound). ccd decides nothing about display.

#### What overlays (L0, pure: `admitDraft(e, d)` and `entryView(e, d, mode)` in `shared/docs.ts`; full table in §4.6)

```ts
admitDraft(e, d) = d.state === 'holder' && d.baseEqual && e.draft !== null
overlay          = mode === 'ref' && admitDraft(e, d)        // mode: 'default' when the page has no ?ref=
```

- **The default view never overlays.** Every row and leaf is the committed entry at C.
  - **The hint.** When `drafts.state === 'holder'` and n > 0 entries carry a draft, the page shows "n uncommitted docs in <worktree> on <branch>" and links the same page at `?ref=refs/heads/<branch>`.
  - The link uses the qualified local ref: a bare name serves origin whenever local is behind (Q2), and the drafts would then not overlay.
- **A ref view overlays iff `baseEqual`.**
  - **The base hint.** Otherwise it shows "n uncommitted docs in <worktree> are based on local <branch> at <short H>; this page shows <served>", linking `?ref=refs/heads/<branch>`.
  - `baseEqual` is false in a ref view only in two cases. The first is when the origin side is served while the local branch is at another commit: `local-behind`, or a qualified `refs/remotes/origin/<b>`. MM7 measured 0 of 166 such branches. The second is when the holder committed between resolution and the snapshot.
- **The effective file wins.** In an overlay, the draft is what a row opens:

| Draft layer (overlay) | Opens | Offers |
|---|---|---|
| `modified`, `conflicted` (file with `fp`) | the draft bytes | the badge; "open committed version" |
| `added`, `untracked` (file with `fp`) | the draft bytes | badge "draft · new" |
| `deleted` | the committed bytes | banner "deleted in <worktree> (uncommitted)" |
| `typechange` | the committed bytes | a note; the draft is never read |
| `fp:null`, or `kind` `unreadable`, `symlink`, `directory`, `special`, `hardlink`, `foreign-owner`, `other-device` | the committed row (none for a new file) | withheld marker: `too-large`, `unreadable` or `not-a-file` |

- **Open committed version.** It is offered iff the row opens the draft and `committed.kind` is `file` or `exec`. It navigates to the same leaf with `view=committed`, which opens `CommittedPin(ref.commit, ref.served, section, path)` from this visit's tree. The commit itself is never in the URL (§3.1).
- **One badge function.** Directory rows and leaf headers both call `entryView`, which closes the old disagreement between leaf and directory badges.
- **Doors.** A session's "Docs on <branch>" link names the branch its worktree holds now (`FleetSession.branch`), never an assumed `ws/<slug>` (§4.8).

---

### (e) Consistency pins

**CommittedPin `{project, commit, servedRef, section, path}`.**
- It is immutable. `docs-show` never resolves a ref to choose bytes.
- A pinned commit that has since been gc'd answers `unknown-commit`, and the PWA re-lists once.
- **Provenance.** After the read, `docs-show` runs `merge-base --is-ancestor --end-of-options C R` with `R = --ref`, under a 2 s soft bound.

  | Result | `onRef` |
  |---|---|
  | rc 0 | `contains` |
  | rc 1 | `not-contained` |
  | R absent or not a commit, rc ≥ 2, or a timeout | `unmeasured` |

  - The PWA banners `not-contained`: "this commit is no longer on <ref>".
  - Any commit stays readable, so pins survive force-pushes, but a fork-PR, stash or dangling commit can never pass as being on the branch.
- **Where a commit comes from.** A commit reaches a request only from a tree answer of the same visit. The page grammar never carries one (§3.1).

**DraftPin `{project, branch, head, section, path, fp}`.** It is never cached. `docs-show` checks, in this order:
1. **Holder.** Re-enumerate the holder with the (d) rule.
   - None → `worktree-gone`.
   - Two or more → `ambiguous-worktree {candidates}`.
   - A failed trust check, identity included → `untrusted-worktree {why}`.
   - `worktree list` itself fails or times out → `git-failed {step:'worktree-list'}` or `git-timeout {step:'worktree-list'}`, never folded into `worktree-gone`.
2. **HEAD.** The record's HEAD must equal `--head`, otherwise `worktree-moved {head}`.
3. **Walk.** Walk with `openat` from the trusted fd, as in (f).
   - The leaf must be `S_ISREG` and pass the leaf checks, and its size must be within `min(N, DOCS_MAX_FILE_BYTES)`.
   - In a pinned read, `ENOENT` at the leaf answers `draft-changed {now:'absent'}`. Every other leaf outcome answers as (f)'s worktree table does: `ELOOP` gives `not-a-file {kind:'symlink'}`, and a leaf that is not `S_ISREG` gives `not-a-file {kind:'special'}` (rows 27 and 28).
   - A regular file that fails a leaf check answers `not-a-file {kind}`.
4. **Read.** Read at most size + 1 bytes, then `fstat` again. `(ino, size, mtime_ns, ctime_ns)` must be unchanged.
5. **Hash.** `sha256(bytes)` must equal F, otherwise `draft-changed {now:'present'}`. No `draft-changed` ever carries a hash or a size.
6. **HEAD again.** Re-verify HEAD in W. A change gives `worktree-moved`.
7. **Emit** the bytes that hashed to F.

**Why re-running status is unnecessary.**
- The content hash acts as a read capability. A caller can obtain a matching F only from a tree listing, and listings come from status, which never includes ignored files.
- Withholding the current hash on a mismatch keeps a guessed path from turning into a hash oracle.

**Assets (the asset rule).** It covers Markdown images now and HTML mockup assets in §5.6.3.
- **A committed page resolves every asset at its own commit C, and nothing else.** That covers every default-view page, every `view=committed` leaf, and every ref-view leaf that opens committed. Each asset that is a committed file at C (kind `file` or `exec`) is a `CommittedPin(C, servedRef, …)`, even when the asset has a draft; any other asset is missing.
- **A draft page** exists only when `baseEqual`, so H = C.
  - An asset that is itself an admitted `modified`, `added`, `untracked` or `conflicted` draft with an `fp` uses a `DraftPin` with that `fp`.
  - An asset whose draft is `deleted` is missing (`deleted-in-worktree`). One whose draft is `typechange`, withheld or `fp: null` is missing (`draft-withheld`); a typechange draft is never read ((d)). Neither falls back silently to the committed bytes.
  - An asset with no draft uses `CommittedPin(C, servedRef, …)` when it is a committed file at C, and is missing otherwise.
  - Markdown images (§4.11) and mockup assets (§5.6.3) follow this one rule.
  - A draft page that embeds a `DraftPin` asset shows the page-level badge "embeds N uncommitted assets", and each such embed wears a draft chip.
- So no page ever mixes the served base with an author's base, and no draft asset ever appears inside a committed page.

**Snapshot.**
- One `docs-tree` call does everything in order: resolve C, list at C, then take the holder snapshot bracketed by the H checks.
- **Reuse.** The PWA reuses a tree answer while the user navigates within one screen visit (stale-while-revalidate).
- **Re-fetch.** It re-fetches the tree:
  - on screen open;
  - after a refresh;
  - after `draft-changed`, `worktree-moved`, `worktree-gone` or `unknown-commit`, with one automatic retry and then an inline "changing — retry".

---

### (f) Content read

#### Committed

1. Feed `<C>\n` to `cat-file --batch-check`.
   - `missing` → `unknown-commit`.
   - A type other than commit → `not-a-commit`.
2. Run `ls-tree -r -z --long --full-tree --end-of-options <C> -- <DOC_SECTIONS[S]>`. Split each record at its first TAB and each header on whitespace. The size `-` is valid only for gitlinks.
3. Look `DOC_SECTIONS[S] + '/' + rel` up by exact byte equality in that listing.
   - No match, but some record starts with that path plus `/` → `not-a-file {kind:'directory'}`.
   - No match at all → `absent-path`.
   - A section path that is itself a record (`120000`, `160000` or a blob) → `not-a-file {kind:'section-not-a-directory'}`.
4. Mode `120000` → `not-a-file {kind:'symlink'}`. Its blob is the link target and is never served. Mode `160000` → `not-a-file {kind:'submodule'}`.
5. If the `--long` size exceeds `cap = min(N, DOCS_MAX_FILE_BYTES)` → `too-large {size, cap}`, and `cat-file` never runs. The cap equals N whenever the server sent a class cap.
6. Run `cat-file blob <hex>` and read at most size + 1 bytes.
   - If the length differs from size → `git-failed {step:'cat-file'}`.
   - On rc 128, batch-check the blob: `missing` → `object-missing`, otherwise `git-failed`.
7. Compute `onRef` (e).

- The caller's path never enters an argv or a pathspec.
- `<commit>:<path>` is never used. It is cwd-relative, and the part before the colon is parsed as revision syntax (sheet B §8).

#### Worktree (the `openat` walk; security M6)

1. Start from the trusted `O_DIRECTORY` fd of W from (d). W's own ancestors are trusted, because W is git's record.
2. Open each middle component with `os.open(c, O_RDONLY|O_DIRECTORY|O_NOFOLLOW, dir_fd=fd)`. On `ENOTDIR` or `ELOOP`, run `fstatat(…, follow_symlinks=False)`: a symlink gives `symlink-in-path`, anything else gives `not-a-file {kind:'file-in-path'}`.
3. Open the leaf with `O_RDONLY|O_NOFOLLOW|O_NONBLOCK|O_NOCTTY|O_CLOEXEC`.

| Result | Answer |
|---|---|
| `ELOOP` | `not-a-file {kind:'symlink'}` |
| `ENOENT` | `absent-path` (`draft-changed {now:'absent'}` inside a pinned read) |
| `EACCES`, `EPERM`, `EIO` | `unreadable-path {errno}` |
| `fstat` not `S_ISREG` | `not-a-file {kind:'special'}`. `O_NONBLOCK` means a FIFO cannot hang the read. |
| `S_ISREG`, `st_nlink != 1` | `not-a-file {kind:'hardlink'}` |
| `S_ISREG`, `st_uid != geteuid()` | `not-a-file {kind:'foreign-owner'}` |
| `S_ISREG`, `st_dev != W's st_dev` | `not-a-file {kind:'other-device'}` |

- No `fp` is issued for any leaf that fails, and no bytes are read from it.
- A size above `min(N, DOCS_MAX_FILE_BYTES)`, taken from `fstat`, answers `too-large {size, cap}` before any read.

#### Caps

All caps are declared once in `shared/docs.ts`. ccd holds parity copies only of the values ccd enforces. An environment override may only lower a value: `min(env, builtin)`.

| Constant | Value | Enforced by |
|---|---|---|
| `DOCS_MAX_FILE_BYTES` | 4 194 304 | ccd: the ceiling of every show, and the draft `fp` read bound |
| `DOCS_MAX_DOC_BYTES` | 2 097 152 | the server passes it as N for `markdown`, `html`, `text`, `other`; ccd refuses above it |
| `DOCS_MAX_IMAGE_BYTES` | 2 097 152 | the server passes it as N for `raster`, `svg` (U1) |
| `DOCS_CLASS_CAP` | `Record<DocContentClass, number>`, derived from the two above | server and PWA. The PWA shows `too-large` from a listed size without a request. |
| `DOCS_ENVELOPE_RESERVE` | 65 536 | — |
| `DOCS_MAX_ANSWER_BYTES` | 6 291 456 | ccd's final show guard |
| `DOCS_MAX_LISTING_WIRE_BYTES` | 1 048 576, framed | ccd's final tree and index guard |
| `DOCS_MAX_ENTRIES` | 5 000 | ccd |
| `DOCS_DRAFT_HASH_BUDGET` | 33 554 432 | ccd |
| `DOCS_MAX_DRAFTS` | 1 000 | ccd |

- **The 2 MiB class caps were tightened for measured head-of-line cost:** a 2 MiB frame costs about 268 ms of pty echo at 100 Mbit (§6.0). No committed Markdown blob on any branch tip exceeds 2 MiB, and the largest committed PNG is 0.36 MiB.
- **The ceiling chain:** 4·⌈4 194 304/3⌉ + 65 536 = 5 657 944 ≤ 6 291 456 < 8 388 608.
  - 8 388 608 is `EXEC_MAX_BUFFER` (`agent/src/server.ts:82`). The same literal appears again in `server/src/exec.ts:62`.
- **The class-cap chain:** 4·⌈2 097 152/3⌉ + 65 536 = 2 861 740.
- The largest committed doc measured is 1 300 991 bytes (sheet B §11).

#### Encoding

- Use `encoding:'utf8'` with `text` iff all three hold:
  1. the bytes decode as strict UTF-8;
  2. they contain no NUL;
  3. `framed(utf8 line) <= framed(base64 line)`, where `framed` is the length after the agent's own JSON encoding of the stdout line.
- Otherwise use `base64` with `b64`.
- `framed(show) <= 4·⌈size/3⌉ + DOCS_ENVELOPE_RESERVE` therefore always holds.
- Rule 3 was tightened because the agent JSON-escapes stdout a second time. Under the old singly-escaped comparison, a 3 MiB text with one `"` in three chose utf8 and framed at 6 291 617 B (§6.0). For prose, utf8 still wins.
- `sha256` of the raw bytes always travels beside them, and the server verifies it (b, check 8).

#### Content class

The class is L0 `contentClass(path)` (§5.1): one of `markdown`, `raster`, `svg`, `html`, `text` or `other`, by extension. ccd holds no extension list; it receives only N.
- HTML never renders on the ccrc origin. It goes only into §5.6's sandboxed `srcdoc` frame.
- SVG is only ever an image, through a `data:` URL (§5.5).
- The representation each class gets on the wire is §3.6's and §5.2's.

---

### (g) Freshness

#### docs-fetch

1. Validate the arguments and run discovery (h). A partial clone is refused.
2. `config --get remote.origin.url` exiting rc 1 → `remote-absent`.
3. The branch is `--branch`, or else the default chain's name: rung 1 T's name, then `main`/`master` in rung order. If nothing resolves → `no-default-branch`.
4. **Stamp.** Read `$REG/docs/fetch/<repo.key>/<sha256(branch)[:32]>.json`.
   - The path uses `lstat`, requires `S_ISREG`, opens with `O_NOFOLLOW|O_NONBLOCK`, and allows at most 4 KiB.
   - If the last attempt is younger than `DOCS_FETCH_MIN_INTERVAL_MS` (10 000) → `fetch-too-soon {retryAfterMs}`, with no network call.
   - The floor lives in ccd, so it survives server restarts and also applies to direct callers.
5. `before` comes from `for-each-ref refs/remotes/origin/<b>`.
6. Run the fetch (fetch environment, 40 s, `killpg`):

   ```
   git --no-pager -c core.hooksPath=/dev/null -c core.fsmonitor=false -c gc.auto=0 -c maintenance.auto=false \
       -c fetch.writeCommitGraph=false -c submodule.recurse=false -c fetch.recurseSubmodules=false \
       -c fetch.fsckObjects=true -c transfer.fsckObjects=true -c remote.origin.followRemoteHEAD=never -C <M> \
       fetch --quiet --no-tags --no-prune --no-recurse-submodules --no-write-fetch-head \
             --no-auto-gc --no-auto-maintenance --no-show-forced-updates --refmap= \
             --end-of-options origin +refs/heads/<b>:refs/remotes/origin/<b>
   ```

   What each part protects:
   - `hooksPath` closes the `reference-transaction` hook, which fires on fetch (security M1), and a husky `pre-auto-gc` wrapper.
   - The two fsck settings make git refuse a malformed object rather than write it into a store that live sessions share.
   - `--no-write-fetch-head` keeps a worker's `FETCH_HEAD` untouched (sheet B §9).
   - `+` matches git's default refspec, so a force-pushed `ws/*` branch does not stay stale.
   - Only one ref moves per call. There is no `set-head` and no prune. The explicit refspec alone does not make that true (D-4163): git also maps the fetched ref through every configured `remote.origin.fetch` line, so a `+refs/heads/*:refs/heads/*` line would force-move the local branch. The empty `--refmap=` drops those mappings, and `followRemoteHEAD=never` is there to stop git creating `refs/remotes/origin/HEAD`: documented for git >= 2.48, unmeasured here (git 2.43).
7. **Classify**, with `LC_ALL=C` stderr. The four rc/message pairs are measured; whether a translated locale would change them is UNMEASURED, because the box has only C locales.

   | Result | Word |
   |---|---|
   | rc 0 | ok |
   | deadline | `fetch-timeout` |
   | rc 128 and `couldn't find remote ref` | `remote-branch-absent` (the PWA says "local only") |
   | git's fsck refusal: an `index-pack`/`unpack-objects` failure naming an fsck error, pinned by fixture | `fetch-rejected-objects`. The ref is unmoved. |
   | `Authentication failed`, `could not read Username` or `Permission denied (publickey)` | `fetch-auth-failed` |
   | rc 1, `cannot lock ref` and git's lock-file evidence `Unable to create '<ref>.lock': File exists` (D-4158) | `ref-locked {lockAgeMs}`. ccd `lstat`s `<common-dir>/refs/remotes/origin/<b>.lock`: `lockAgeMs` is fleet-now minus its mtime, or `null` when the lock has already gone. |
   | other rc 128 | `fetch-transport {stderrHead}` |
   | anything else | `fetch-failed {rc, stderrHead}` |

   The rows are read in order, so rc 0 answers ok even when the deadline expired on a grandchild's pipe: git itself completed, and step 8 reads what moved (D-4159). A ref directory/file conflict also says `cannot lock ref`, but carries no lock-file evidence and no prune cures it under `--no-prune`, so it answers `fetch-failed` with git's message (D-4158).

   Every stderr-derived field passes through the one redactor (b).
8. `after` comes from `for-each-ref` again. `moved` is `created`, `updated` or `unchanged`.
9. **Stamp write, on every attempt.**
   - `mkstemp` in the same directory, then `os.replace`. The file is mode 0600 and directories are 0700. A directory that is a symlink is refused.
   - Content: `{v:1, branch, attemptMs, lastOutcome, okMs, okCommit}`, on the fleet clock. When this attempt failed, `okMs` and `okCommit` carry over from the previous stamp.
   - A write failure still reports the fetch, with `stamp:'unwritten'`.
   - There is **no ccd lock**: git's ref lock arbitrates, and the server single-flights (below).

**Where the stamp lives.** `$REG/docs` is in ccd's registry. Its name is dotless and hyphen-free.
- Every registry glob is suffix-shaped (`$REG/*.uuid`, `*.workspace`, `*.project`, `"$REG/$id".*`). That is the measured argument written beside `POOLS_DIR` (`ccd/ccd:988-1003`).
- Session ids are `<wrapper>-<project>` and always contain a hyphen, so `docs` can never be an id.
- `docs-fetch` as a directory name would be id-shaped, which is why it is not used.

#### The signal docs-tree reports

- `freshness.stamp` holds ages on the fleet clock (`okAgeMs`, `attemptAgeMs`), so clock skew between the two boxes never enters.
- `fetchHead` (mtime age and bytes) is diagnostic only. A failed fetch truncates `FETCH_HEAD`, so it lies in both directions.

#### Stale on open (L1 `refreshDue(tree)`, pure; Q4)

```
refreshDue(tree) =                     // computed only for an ok tree answer; stamp = tree.freshness.stamp
  !(tree.ref.requested ?? '').startsWith('refs/heads/') &&
  tree.freshness.remote !== null && (
    stamp === null ||
    stamp.attemptAgeMs >= (stamp.lastOutcome === 'ok' || stamp.lastOutcome === 'remote-branch-absent'
                             ? DOCS_STALE_MS /*600 000*/ : DOCS_RETRY_FLOOR_MS /*60 000*/))
```

- **Auto-refresh only when the ref resolved.** `refreshDue` lives only on an ok tree, so an `unresolved-ref` answer can never auto-refresh. That is structural, not a flag. That page instead offers a manual **Fetch from origin**.
- A `refs/heads/...` view is never due, because a fetch cannot move a local ref.
- An unpushed `ws/*` branch is re-asked at most once per `DOCS_STALE_MS`. A transient failure is retried after 60 s.
- The first open after a deploy fetches once per ref. That errs toward refetching, because the stamp does not count the daily fetcher.

#### Flow

1. `GET /api/docs/:p/tree` returns the answer plus `refreshDue`.
2. The PWA renders at once. If `refreshDue`, it fires one `POST /api/docs/:p/refresh {ref: string|null, reason:'auto'|'manual'}`, at most once per screen open per (project, ref).
   - The auto-refresh fetches only the viewed branch, which for the default view is the default branch.
   - L1 `fetchBranchFor` (§3.4) maps the request:

     | Requested ref | Fetch |
     |---|---|
     | `null` | no `--branch` |
     | bare `b` | `--branch b` |
     | `refs/remotes/origin/b` | `--branch b` |
     | `refs/heads/b` | `skipped {why:'local-ref'}` |
3. The server runs `docs-fetch`, then a **new** `docs-tree` flight (a generation counter keeps it from joining a pre-fetch flight, §6.4). It returns `{fetch: ran|failed|skipped, tree: ok|failure}`.
4. A fetch failure appears only in the freshness chip and never replaces the listing.
5. **Manual Refresh** (the chip) and **Fetch from origin** skip the retry floor. Neither skips single-flight or ccd's 10 s floor.
6. **`ref-locked` retries:**
   - automatically after 3 s while `lockAgeMs` is `null` or under 60 000;
   - above that it renders "stale lock on <ref>", with no automatic retry.

#### GET never fetches: three walls

1. **The port is split.** `DocsReader {index, tree, show}` and `DocsFetcher {fetch}` are declared for `server/src/docs/routes.ts`. `registerDocsReadRoutes(app, readers, lanes)` never receives a fetcher. Only `registerDocsRefreshRoute(app, readers, fetchers, lanes)` does.
2. **A source scan.** `CCD_ARGV.docsFetch(` occurs exactly once in `server/src`, inside `ccdsource.ts`'s fetch method.
3. **The PATH recorder.** The recorder tests (j) show that no read verb runs `fetch`.

#### Link protection (L4; §6 owns the derivations)

There is no exec concurrency cap on the agent (`agent/src/server.ts:816-829`), which is why these L4 bounds exist.

| Lane | Bound |
|---|---|
| **read lane**, `server/src/docs/lane.ts` (index, tree, show); one per node | - at most 2 execs in flight;<br>- at most `DOCS_LANE_BYTES` = 3 MiB of estimated framed answers in flight;<br>- at most one answer over 1 MiB;<br>- strict FIFO, 32 queued, 10 s maximum wait;<br>- past that, `docs-busy {lane:'read', retryAfterMs:2000}` (503, `Retry-After: 2`) |
| **fetch lane** | - one per (node, project) (`KeyedQueue`, `server/src/inject/queue.ts:6`);<br>- at most 2 globally, 8 queued, 20 s wait;<br>- past that, `docs-busy {lane:'fetch', retryAfterMs:5000}` |
| **single-flight** | concurrent identical calls join one in-flight promise: tree by (node, project, ref, generation), show by the full pin plus N, refresh by (node, project, branch) |

- The byte budget was tightened from the approved 8 MiB to 3 MiB. Head-of-line delay is linear in the bytes queued ahead of a console frame, and 8 MiB is about 670 ms at 100 Mbit (§6.3).
- The PWA never prefetches. Mockup assets use the read lane.

#### Cache (L4-owned, L1-keyed; §6.5)

- **Committed bytes** sit in a 64 MiB LRU keyed `(node, repoKey, blob)`.
  - It is fed through a listing map, `(node, project, commit) → {section/path → blob, size, kind}`, learned from tree and show answers. This is §1's (project, commit, path) key resolved to the blob, so a file that is unchanged across a moving `main` is a cache hit.
  - A hit whose served ref was recorded in the listing map within `DOCS_STALE_MS` answers with zero execs, as `onRef:'contains'`, `from:'cache'`. Otherwise `docs-show` runs and reports its own `onRef`.
- **Never cached:** drafts, tree answers, refresh answers and failures.
- **The index** has a 30 s micro-cache, dropped by any refresh.

**Browser cache (§6.6).**
- A committed raw-raster 200 carries `Cache-Control: private, max-age=31536000, immutable`.
- Everything else carries `no-store`: every JSON body, every draft, every failure.
- This is tightened from "every committed file response immutable" because a JSON file answer carries `onRef`, which can change.

---

### (h) Repository shapes (discovery, in every verb, right after validation)

1. `P = $PROJECTS_ROOT/<project>` (`ccd/ccd:986`). If it is absent or not a directory → `unknown-project {root}`. The `root` field names ccd's root, which makes the inherited `CCRC_PROJECTS_ROOT` seam visible.
2. `lstat P/.git`. If it is absent → `not-a-git-repo`, with no git call at all.
3. Run `rev-parse --path-format=absolute --git-dir --git-common-dir --show-toplevel --is-bare-repository --is-shallow-repository --show-object-format`, with `GIT_CEILING_DIRECTORIES=realpath(PROJECTS_ROOT)`.

   | Result | Word |
   |---|---|
   | rc ≠ 0 (corrupt, dubious ownership) | `repo-unreadable {stderrHead}` |
   | toplevel ≠ realpath(P) | `not-a-git-repo {detail:'toplevel-mismatch'}` (security M4) |
   | bare | `not-a-git-repo {detail:'bare'}` |
   | git-dir ≠ common-dir | `linked-worktree {owner, branch}` |

   - For `linked-worktree`, `owner` is the project Q whose `realpath(Q/.git)` equals the common dir, or null, and `branch` is this checkout's branch. The PWA redirects to `/docs/<owner>/…?ref=<branch>`, whose holder rule finds this same directory.
4. **Shared repo.** When `P/.git` is not a real directory (a file or a symlink) and git-dir == common-dir, search the other entries under the root that pass the project grammar for a Q whose `Q/.git` is a real directory with `realpath(Q/.git)` equal to that git-dir.
   - If Q exists → `shared-repo {owner:Q, branch}`. The PWA redirects exactly as for `linked-worktree`.
   - Only when no such owner exists is the shape accepted as a `--separate-git-dir` main checkout.
   - This closes MM9's second gap.
5. `config -z --get-regexp '^(remote\..*\.promisor|extensions\.partialclone)$'` finding anything → `partial-clone`. `GIT_NO_LAZY_FETCH=1` stays as the backstop. No partial clones exist on the fleet today.
6. **Shallow** repos are served, with `relation` reported as `unmeasured`. **sha256** repos are served, with 64-hex pins.
7. Sections absent at C → `ok`, with all four `absent` and `entries: []`. This is not an error.

**docs-index (Q3).**
- **The walk.** It walks the non-dot entries of `$PROJECTS_ROOT` that pass the project grammar. Every other name is counted in `unlisted`: dash-leading, non-UTF-8, too long.
- **Per directory** it runs steps 1–5, then:
  - the default chain;
  - `ls-tree -r -z --name-only --full-tree <C> -- <4 paths>` for section counts (`--name-only` does not lazy-fetch, sheet B §10);
  - the stamp ages;
  - the `github` slug (§3.11).
- **Non-git directories** get `sectionsOnDisk` from four `lstat` calls, and are never served.
- **What it skips.** It runs no worktree enumeration and no status.
- **Failures.** A per-project failure becomes that row's `state`, never a failure of the whole answer.
- **Deadline.** The walk stops at its helper deadline. The projects it did not reach are counted in `unwalked` (absent when 0), never labelled `repo-unreadable`; the doctor WARNs on `unwalked > 0` (D-4157).
- **Duplicates.** `duplicates` lists every `repoKey` that two or more rows share.
- **Cost.** 0.27–0.32 s over 16 repos (ops M5).
- **One root.** All of it reads ccd's root, so Docs is self-consistent even on a box whose `CCRC_PROJECTS_ROOT` differs.

---

### (i) Failure vocabulary

**Where the words live.**
- `shared/docs.ts` (L0) declares:
  - `DOCS_FAILURES: Record<word, 'ccd'|'server'>`, with `DocsFailure = keyof typeof DOCS_FAILURES`;
  - `DOCS_FAILURE_RETRY: Record<DocsFailure, DocsRetryClass>`, where `DocsRetryClass = 'auto' | 'manual' | 'none' | 'auto-while-young'`. Only `ref-locked` is `auto-while-young`: retried automatically after 3 s while `lockAgeMs` is `null` or < 60 000, otherwise treated as `none` with the "stale lock" sentence.
- L1 declares `DOCS_FAILURE_HTTP: Record<DocsFailure, number>`, the only source of a status.
- The PWA declares `DOCS_FAILURE_SENTENCE: Record<DocsFailure, string>` (§4.7).
- All four are exhaustive by type, so a new word is a compile error until it is mapped.
- The python helper carries one literal `FAILURES = frozenset({…})`, bound by parity, and `fail(w)` asserts membership.
- The HTTP-layer words that §3.7 and §5 add (`foreign-request`, `bad-query`, `raster-mismatch`, `response-type-refused`) live in the same record.

**Bodies and rendering.**
- Every failure body is `{ok:false, failure, detail?, …context}`. The PWA switches on `failure`; the HTTP status is informational. Success is 200 only.
- Every word renders inline:
  - tree failures replace the listing;
  - file failures replace the body and keep the header;
  - fetch failures show in the freshness chip.

**Retry codes**, as used in the tables below:
- **auto**: retried automatically once.
- **manual**: a Retry button.
- **none**: no retry.

The Action column says what the page offers.

#### Argument (400; L1 and ccd apply the same grammar)

| Word | Retry |
|---|---|
| `bad-project` | none |
| `bad-ref` | none |
| `bad-commit` | none |
| `bad-section` | none |
| `bad-path` | none |
| `bad-fingerprint` | none |

#### Repository

| Word | HTTP | Retry | Action |
|---|---|---|---|
| `unknown-project` | 404 | none | names ccd's root |
| `not-a-git-repo` | 422 | none | |
| `linked-worktree` | 422 | none | auto-redirect to the owner, with `branch` as `ref` |
| `shared-repo` | 422 | none | auto-redirect to the owner, as `linked-worktree` |
| `partial-clone` | 422 | none | |
| `repo-unreadable` | 502 | manual | |

#### Refs

| Word | HTTP | Retry | Action |
|---|---|---|---|
| `no-default-branch` | 404 | none | Refresh |
| `unresolved-ref` | 404 | none | shows `tried`, the suggest link and **Fetch from origin** (manual) |
| `ref-not-commit` | 422 | none | |

#### Objects and paths

| Word | HTTP | Retry | Action |
|---|---|---|---|
| `unknown-commit` | 404 | auto | re-list |
| `not-a-commit` | 422 | none | |
| `object-missing` | 502 | manual | |
| `absent-path` | 404 | none | re-list |
| `not-a-file` | 422 | none | shows `kind` (`directory`, `section-not-a-directory`, `symlink`, `submodule`, `file-in-path`, `special`, `hardlink`, `foreign-owner`, `other-device`); open committed |
| `symlink-in-path` | 422 | none | open committed |
| `too-large` | 413 | none | shows `size` and `cap`; `cap` is the class cap the server asked for |
| `too-many-entries` | 413 | none | shows `count` and `bytes` |
| `unreadable-path` | 502 | manual | shows `errno` |

#### Draft pins (show)

| Word | HTTP | Retry | Action |
|---|---|---|---|
| `worktree-gone` | 409 | auto | re-list, then open committed |
| `ambiguous-worktree` | 409 | none | lists candidates; open committed |
| `untrusted-worktree` | 422 | none | shows `why` (`common-dir`, `toplevel-mismatch`, `foreign-owner`, `identity-changed`, `dubious-ownership`); open committed |
| `worktree-moved` | 409 | auto | re-list |
| `draft-changed` | 409 | auto | re-list |

#### Fetch

| Word | HTTP | Retry | Action |
|---|---|---|---|
| `remote-absent` | 422 | none | |
| `remote-branch-absent` | 404 | none | "local only", not error styling |
| `fetch-auth-failed` | 502 | none | "the fleet box's git credentials were rejected" |
| `fetch-rejected-objects` | 502 | none | "origin sent objects that failed git's integrity check; nothing was written" |
| `fetch-transport` | 502 | manual | |
| `ref-locked` | 409 | auto after 3 s while `lockAgeMs` is null or < 60 000; otherwise none | "stale lock on <ref>" past 60 s |
| `fetch-too-soon` | 429 | auto after `retryAfterMs` | |
| `fetch-timeout` | 504 | manual | |
| `fetch-failed` | 502 | manual | |

#### ccd generic

| Word | HTTP | Retry | Action |
|---|---|---|---|
| `git-failed {step, rc, stderrHead}` | 502 | manual | |
| `git-timeout {step}` | 504 | manual | |
| `helper-unavailable {detail:'python-missing'\|'python-too-old'}` | 503 | none | "run ccrc doctor" (python3 3.8 or newer) |
| `helper-failed` | 502 | manual | |

#### Server-only

| Word | HTTP | Retry | Action |
|---|---|---|---|
| `unsupported` | 501 | none | "fleet ccd predates Docs — roll out" |
| `caps-unknown` | 503, `Retry-After: 5` | auto | "connecting to fleet". Answered both for a null list and for a list that lacks `caps`. |
| `not-granted` | 501 | manual | names both causes: a rollout in progress, or an agent that predates the Docs grants (§7.1) |
| `link-failed` | 503 | auto | |
| `link-timeout` | 504 | auto | |
| `docs-busy {lane, retryAfterMs}` | 503, `Retry-After` | auto | |
| `ccd-timeout` | 504 | manual | |
| `ccd-killed` | 502 | manual | |
| `ccd-fault` | 502 | manual | shows the stderr tail |
| `answer-overflow` | 502 | none | |
| `malformed-answer {why:'parse'\|'schema'\|'integrity'\|'pin'\|'oversize'}` | 502 | none | |
| `unknown-failure` | 502 | manual | shows the raw word |

**Not failures.** `drafts.state` values other than `holder`, and docs-index row states, are sub-states of a 200 answer. They render as badges, hints or banners over committed content.

**Routes**, registered in `server/src/docs/routes.ts` as one encapsulated plugin (§3.4):
- `GET /api/docs/projects`
- `GET /api/docs/:project/tree`
- `GET /api/docs/:project/file`
- `POST /api/docs/:project/refresh`

All four are session-gated, and none is `EXEMPT` (`server/src/auth/gate.ts:198`). All four pass §3.8's provenance hook (`Sec-Fetch-*` plus the `x-ccrc-docs` marker). When armed, the POST is also origin-checked by `needsOriginCheck` (`gate.ts:755-760`). No box token is used.

---

### (j) Mutation table

Every guard ships with a test that goes red when the guard is deleted or mutated. Rows marked **(ctl)** also assert the hostile effect **without** the guard. Rows 1–54 keep their numbers. Rows 55–67 were added for the review's remedies and the drafts ruling.

#### Test harness

- **Fixture HOMEs only**, from `makeCcdHarness('ccd-docs-')` (`server/test/ccdWsHelpers.ts:439`).
- Dispatcher runs follow `server/test/ccd-win-size.test.ts:75-90`, under `ghContainedEnv`.
- **Git calls are recorded at PATH level.** A `git` wrapper is written into `harnessBin(home)`, the first PATH entry (`ccdWsHelpers.ts:200-215`, `:276`, `:336`). It logs argv and the `GIT_*`/`LC_ALL` environment, then execs the real git by absolute path.
  - The `NOGIT` bash-function idiom (`server/test/ccd-ws-rename.test.ts:344`) cannot see python's `subprocess` git.
- **Canned input.** Conditions a fixture HOME cannot create are pinned by helper units over injected `stat`/`fstat` results or canned stderr: another uid, another device, a directory swapped mid-read, dubious ownership.
- **New files:**
  - ccd cases: `server/test/ccd-docs-{index,tree,show,fetch}.test.ts`, split across four files for load;
  - server: `docs-{parity,grammar,budget,source,policy,routes,cache}.test.ts`;
  - PWA: `pwa/test/docs-screen.test.tsx`.

#### ccd: arguments and grammar

| # | Guard | Test | Mutation that goes red |
|---|---|---|---|
| 1 | Grammar before git | - These all answer `bad-ref`: `--ref -x`, `main~1`, `main:docs`, `a..b`, `x.lock/y`, `HEAD`, `refs/tags/v`, `é`, `@{-1}`.<br>- These answer `bad-project`: `..`, `.git`, `a/b`, `-x`, 101 characters.<br>- The recorder logs **zero** git calls. | drop the pattern |
| 2 | Grammar ⊂ git | Fuzz 5000 strings over `ab.-_/09@{}~^:`. Every string ccd accepts passes real `git check-ref-format refs/heads/<n>`. | widen the pattern (for example drop `(?!.*\.\.)`) |
| 3 | TS ≡ python grammars | One corpus is run through the L0 predicates in `shared/docs.ts` (which L1 `policy.ts` applies from W2) and through `h.sh` into `_docs_py`. The verdicts are identical, the path category check included. | edit either copy |
| 4 | Path grammar | `../../README.md`, `a//b`, `./a`, a C1 character, U+202E and non-UTF-8 argv all answer `bad-path`. A helper run from a `docs/superpowers` cwd answers identically. | drop `--full-tree`, or use `<commit>:<path>` |
| 5 | Arity | Each of these gives rc 1, empty stdout and a `usage:` stderr:<br>- a wrong flag order;<br>- a `docs-show` missing `--ref` or `--max-bytes`;<br>- a bad N (`0`, `012`, 9 digits). | accept loose flags |
| 6 | Helper probe (= M7.8) | - A PATH `python3` stub exiting 127 gives rc 0 `helper-unavailable {detail:'python-missing'}`.<br>- A stub exiting 3 on the version probe gives `{detail:'python-too-old'}`.<br>- A raising helper gives rc 0 `helper-failed`.<br>- Every failure row asserts rc 0, one line, parseable, and the matching `verb`. | print partial stdout; probe presence only |

#### ccd: repository shapes

| # | Guard | Test | Mutation that goes red |
|---|---|---|---|
| 7 | Ceiling + toplevel | `$HOME/projects` is itself `git init`'d. `projects/nongit` answers `not-a-git-repo`. (ctl: a plain `rev-parse` answers the parent.) | drop either one; each is mutated alone |
| 8 | Linked worktree | A `.git`-file worktree under `projects/` answers `linked-worktree {owner, branch}`. | drop the git-dir ≠ common-dir check |
| 9 | Partial clone | A `clone --filter=blob:none file://…` (origin with `uploadpack.allowFilter`) answers `partial-clone`, and the pack count is unchanged. | drop the promisor check |
| 10 | `GIT_NO_LAZY_FETCH` | The recorder shows `GIT_NO_LAZY_FETCH=1` on every call. In the partial clone, `cat-file -s <missing>` through `_docs_git` leaves the pack count unchanged. | drop it from the environment |
| 11 | `GIT_*` scrub | With `GIT_DIR` and `GIT_CONFIG_PARAMETERS` pointing at a decoy, docs-tree still reads the project. | keep the environment |

#### ccd: git hygiene

| # | Guard | Test | Mutation that goes red |
|---|---|---|---|
| 12 | Index never written | Touch a doc in the holder and run docs-tree. The `.git/index` inode and mtime are unchanged, and `find .git -newer marker` is empty. (ctl: a plain status rewrites the index.) | drop `--no-optional-locks` |
| 13 | fsmonitor off | With `core.fsmonitor=<marker script>`, no marker appears. (ctl: a plain status fires it.) | drop `core.fsmonitor=false` |
| 14 | Filter neutralisers (MM1) | `*.md filter=probe` with a marker-writing clean driver and `required=true`, plus a dirty doc: no marker, rc 0, and the `filters-bypassed` caveat present. (ctl: the marker is written.) | drop any of `clean=`, `process=` or `required=false`; each is mutated alone |
| 15 | Replace refs off | After `git replace` on a doc blob, the real bytes are served. (ctl: a plain `cat-file`.) | drop `GIT_NO_REPLACE_OBJECTS` |
| 16 | Reads never mutate | For index, tree and show, the recorder never sees `fetch`, `remote`, `gc`, `maintenance`, `update-ref`, `checkout`, `worktree add/remove/prune`, `show`, `diff`, `archive`, `--textconv` or `--filters`. | add any of them |

#### ccd: refs

| # | Guard | Test | Mutation that goes red |
|---|---|---|---|
| 17 | Fully qualified | A tag `x` and a branch `x` at different commits: `--ref x` serves the branch. | resolve by the bare name |
| 18 | Exact refname filter (MM3) | With branches `ws2/foo` and `ws2`, `--ref ws2` serves `ws2` only. | drop the exact filter |
| 19 | Default chain | Fixtures:<br>- origin/HEAD set;<br>- `set-head -d`;<br>- dangling (`tried[0].result:'dangling'`, MM4);<br>- no remotes (local-main);<br>- nothing (`no-default-branch`). | delete any rung, or the `symbolic-ref` call |
| 20 | Default ignores the checkout | With the main checkout on `feat/x`, `served` is `refs/remotes/origin/main`. | serve HEAD's branch |
| 21 | Q2 ancestry | - Behind serves origin.<br>- Ahead serves local.<br>- Diverged serves local, with `diverged`.<br>- A qualified `refs/remotes/origin/ws/local-only` answers `unresolved-ref` with `tried` of length 1. | always local, or add a qualified fallback |
| 22 | Peel | `update-ref refs/remotes/origin/t <tag-of-blob>` answers `ref-not-commit`. A tag of a commit resolves (MM3). | drop the peel |
| 23 | Unresolved never lists | The answer has no `entries`. `suggest` appears for `origin/<b>`. | build a listing |

#### ccd: reads

| # | Guard | Test | Mutation that goes red |
|---|---|---|---|
| 24 | Exact lookup | `A.md` requested with `a.md` listed → `absent-path`. A directory path → `not-a-file {directory}`. | prefix match |
| 25 | Committed symlink, gitlink, section-as-link | `120000` → `not-a-file {symlink}`, and the target bytes are never on stdout. `160000` → `submodule`. A symlinked section → `not-a-file {section-not-a-directory}` from show, and section `state:'not-a-directory'` in the tree. | serve every mode |
| 26 | Size before read | - A blob of cap + 1 (cap lowered through the environment) → `too-large {size, cap}`, with no `cat-file blob` call.<br>- Exactly the cap is `ok`.<br>- `CCD_DOCS_MAX_FILE_BYTES=999999999` still enforces the built-in.<br>- The `--max-bytes` half is M6.6. | check after the read, or use the raw env value |
| 27 | `openat` no-follow | An untracked symlink to a sentinel outside the tree, and a symlinked middle directory: the sentinel bytes never appear. They answer `not-a-file {symlink}` and `symlink-in-path`. | drop `O_NOFOLLOW` on the leaf; separately, on the middle components |
| 28 | FIFO | An untracked FIFO → `not-a-file {special}` within 5 s. | drop `O_NONBLOCK` (the test times out, which is red) |
| 29 | Encoding bound | A cap-sized file of `"` bytes uses `base64`, and stdout < 6 291 456. Markdown uses `utf8`, and the `sha256` round-trips. The framed comparison is M6.7. | always utf8 |
| 30 | Entry and answer caps | 5001 files → `too-many-entries {count:5001}`. The framed 1 MiB listing bound is M6.8. | drop the cap |

#### ccd: drafts

| # | Guard | Test | Mutation that goes red |
|---|---|---|---|
| 31 | Holder rules | - prunable → `none` with `skipped`;<br>- detached at the tip → `none`;<br>- two holders via `worktree add --force` → `ambiguous` with 2 candidates;<br>- the main checkout holding the branch → `holder {class:'main'}`;<br>- a holder under `<project>/.claude/worktrees` and one under a `/tmp` directory are both found. | first match wins; no prunable filter; restrict by location |
| 32 | Holder trust | A stray `git init` in W's directory → `untrusted {common-dir}`. Dubious-ownership stderr is classified from canned input. | drop the compare |
| 33 | Enumeration failure is not "none" | The recorder fails `worktree list` → `unreadable {worktree-list}`. | fold into `none` |
| 34 | Status shapes | - A fixture with `status.renames=true`: a staged rename appears as `deleted` + `added`.<br>- `.D`, `D.`, `.T`, `u` and intent-to-add are each classified.<br>- `1 AD` is dropped.<br>- A nested repo goes to `opaque`.<br>- A `2` record from a canned stub gives `unreadable`. | drop `--no-renames`, or mutate the classifier |
| 35 | Ignored files never drafts | A gitignored `.md` in a section is not listed. Show with any fabricated fp gives `draft-changed`, with no bytes and no hash. | add `--ignored` |
| 36 | Lie modes | Assume-unchanged + edit → `modified {trust:'hash'}`. Skip-worktree + `rm` → no draft. (ctl: status alone is silent.) | trust status only |
| 37 | Content fingerprint (MM2) | Two same-size edits inside one mtime tick (`os.utime` restoring the mtime): the second show answers `draft-changed`. | switch fp to stat data |
| 38 | Draft pins | - edit → `draft-changed`;<br>- commit in W → `worktree-moved`;<br>- switch branch → `worktree-gone`;<br>- `worktree remove` → `worktree-gone`. | remove any check |
| 39 | Head bracket and revert race | A helper unit on canned inputs: `branch.oid` ≠ H → retry, then `unsettled`. A revert after status drops the entry. | drop either |
| 40 | Draft budget | 1001 drafts → `too-many`. | drop the bound |

#### ccd: fetch

| # | Guard | Test | Mutation that goes red |
|---|---|---|---|
| 41 | Fetch hygiene | - The recorded argv is exact, both fsck `-c` flags included.<br>- The `FETCH_HEAD` sentinel is byte- and mtime-identical.<br>- A remote tag and a second branch are not fetched.<br>- A local `ws/x` is unmoved.<br>- A `.git/hooks/reference-transaction` marker is absent. (ctl: a plain fetch writes it, security M1.) | edit any flag |
| 42 | Fetch classifier | - missing branch → `remote-branch-absent`;<br>- a planted `origin/main.lock` → `ref-locked`;<br>- a URL at a missing path → `fetch-transport`;<br>- a sleeping PATH git with a lowered deadline → `fetch-timeout`, and the grandchild is gone (`killpg`);<br>- canned stderr → `fetch-auth-failed`;<br>- `https://u:tok@…` in stderr gives `***@` in `detail`. | merge any two arms, or kill only the child |
| 43 | Stamp and floor | - `ok` writes `okMs`; a failure keeps `okMs`.<br>- A second call within 10 s → `fetch-too-soon`, with no fetch recorded.<br>- A FIFO or symlink planted at the stamp path gives stamp null, no hang, and nothing written through the link.<br>- `$REG/docs` is invisible to `_reg_purge` and the `*.uuid` globs. | drop the floor or the `O_NOFOLLOW` |

#### Agent and server wiring

| # | Guard | Test | Mutation that goes red |
|---|---|---|---|
| 44 | Grants | - `agent/test/types/bypasses/g13…g16-docs-*-without-<flag>.ts`, plus `EXPECTED` entries (`agent/test/whitelist-structural.test.ts:81`);<br>- `Assert<Equals<…>>` in `ok/legit-whitelist.ts`;<br>- the runtime-audit throw case;<br>- the behavioural case in `agent/test/whitelist.test.ts`;<br>- `whitelist-subset.test.ts` `SAMPLES` for every builder, plus "grantable ONLY with --project/--all". | remove an enrolment or a grant |
| 45 | Cap gate (with M7.7) | - `ccdVerbs` null → `caps-unknown`, 0 execs.<br>- `[]`, or any list without `caps` → `caps-unknown`, 0 execs.<br>- `['caps']` → `unsupported`, 0 execs.<br>- `CAP_GATED_VERBS` holds every docs verb name.<br>- The `ccd-archive` verbs equal the arms, and `docs-v1` is in `KNOWN_CAPABILITY_TOKENS`. | swap for `verbSupported`; drop the null branch; drop the `includes('caps')` arm |
| 46 | Adapter | One case per `CcdResult` shape in (b), including the literal `'forbidden'` and `'timeout'` taken from the client's own constants, a tampered-sha256 double, a committed answer without `onRef`, and an answer one byte over `job.wire`. | fold any two arms |
| 47 | Budgets and caps | - `remote-runner.test.ts` rows 20 000 / 20 000 / 15 000 / 60 000.<br>- `docs-budget.test.ts` extracts the ccd deadlines and asserts deadline + 2 + 5 < budget.<br>- It reads both `8 * 1024 * 1024` literals and asserts both cap chains.<br>- Parity of `DOCS_MAX_FILE_BYTES`. | raise a cap or a deadline |
| 48 | Single source | - `docs-parity.test.ts` extracts from ccd exactly one occurrence each of: `SECTIONS`; every grammar body; `DOCS_PATH_EXCLUDED_CATEGORIES` and the selector ranges; every ccd-enforced cap (`DOCS_MAX_FILE_BYTES`, `DOCS_MAX_ANSWER_BYTES`, `DOCS_MAX_LISTING_WIRE_BYTES`, `DOCS_MAX_ENTRIES`, `DOCS_DRAFT_HASH_BUDGET`, `DOCS_MAX_DRAFTS`); `FAILURES`; the redactor patterns; `DOCS_FETCH_MIN_INTERVAL_MS`.<br>- It compares them with `shared/docs.ts` in both directions (the `pool-name-parity.test.ts` precedent).<br>- `single-definition` sees one TS copy. | edit one side |
| 49 | GET never fetches | - Only one `CCD_ARGV.docsFetch(` in `server/src` (scan).<br>- The read registration's type has no fetcher (typecheck-tests).<br>- A spy across every GET never sees `docs-fetch`. | call fetch from a GET |
| 50 | Refresh gated | - Armed: a POST without a session gives 401; a wrong `Origin` gives 403.<br>- Not in `EXEMPT`.<br>- `box-token-census.test.ts` gains a `DOCS_SRC` lane (`server/src/docs/routes.ts`) and a hand-kept `DOCS_DOORS` checked both ways (the `UPDATE_DOORS` precedent, `:73`, `:218`). | add to `EXEMPT`, or drop the lane |
| 51 | Lanes (= M6.2) | Blocking doubles:<br>- at most 2 reads in flight;<br>- the 33rd queued or a 10 s wait gives `docs-busy {lane:'read'}`;<br>- a non-docs route is unaffected;<br>- two concurrent refreshes produce one fetch. | remove the semaphore or single-flight |
| 52 | Cache | - A second committed GET costs 0 execs; the same blob under a new commit costs 0.<br>- A draft always execs.<br>- Keys carry the node (M3.13).<br>- `immutable` only on a committed raw-raster 200; `no-store` on every JSON body and every failure. | cache drafts; mark JSON immutable |
| 53 | L0/L1 policy | - The `admitDraft`/`entryView` table over {each state and kind} × {baseEqual true/false} × {mode default/ref} × {committed at C yes/no}.<br>- The `refreshDue` table: ok tree only; false for `refs/heads/…`; the stale and floor rules.<br>- `DOCS_FAILURE_HTTP` and `DOCS_FAILURE_RETRY` exhaustive. | mutate any branch |
| 54 | PWA leaf truth | - The leaf header renders the served refname, short commit, `via` and source.<br>- The row and the leaf use the same `entryView` text.<br>- Withheld counts and links are rendered. | drop a field, or add a second badge function |

#### Folded remedies and the drafts ruling

| # | Guard | Test | Mutation that goes red |
|---|---|---|---|
| 55 | Holder trust, added checks | - A per-worktree `core.worktree` pointing W at another directory → `untrusted {toplevel-mismatch}`, and the other directory's bytes never appear. (ctl: without the compare, status reads the other directory, MM9.)<br>- An injected `fstat` with a foreign `st_uid` → `untrusted {foreign-owner}`.<br>- An injected swap of W between trust and walk (another `st_dev`/`st_ino`) → `untrusted {identity-changed}` in tree, and `untrusted-worktree {identity-changed}` in show. | drop any one check; each is mutated alone |
| 56 | Leaf identity | - An untracked draft that is a hard link to a sentinel outside the tree → `kind:'hardlink'`, `fp:null`, and the sentinel bytes never reach stdout.<br>- Re-linking a listed draft before show → `not-a-file {hardlink}`. (ctl: without the check the sentinel is served.)<br>- Injected `fstat` units cover `foreign-owner` and `other-device`. | drop the nlink, uid or dev check, each alone |
| 57 | Shared-repo discovery | - `projects/b/.git` as a symlink to `projects/a/.git`, and separately a `.git` file reading `gitdir:` that path, both → `shared-repo {owner:'a'}`, never a listing of a's content under b.<br>- A `--separate-git-dir` main checkout with no owner is accepted.<br>- docs-index lists the pair in `duplicates`. | drop the owner search; accept on git-dir == common-dir alone |
| 58 | Fixed-index argv | - `--project -h` and `--project --help` → `bad-project`.<br>- `--path --commit` and `--path -x` are read as path values (`absent-path`).<br>- Each answers one JSON line, rc 0.<br>- A dash-leading directory under the root is counted in docs-index's `unlisted`, never listed. | parse with `argparse`/`getopt`; widen the project's first character |
| 59 | fsck on fetch | - The recorded argv carries both fsck flags.<br>- An origin holding a corrupt object (written with `hash-object --literally`) → `fetch-rejected-objects`, and `refs/remotes/origin/<b>` is unmoved. (ctl: without the flags the fetch succeeds.) | drop either flag; fold into `fetch-transport` |
| 60 | Auto-refresh only when resolved | PWA:<br>- an `unresolved-ref` answer causes zero automatic POSTs;<br>- **Fetch from origin** issues exactly one manual POST;<br>- a `refs/heads/…` view never auto-POSTs.<br>The server half is M3.10. | auto-refresh on `stamp === null` regardless of resolution |
| 61 | Lock age | - A planted `<b>.lock` 5 s old → `ref-locked {lockAgeMs≈5000}`, retried after 3 s.<br>- 120 s old → retry `none` and "stale lock".<br>- A lock removed before the `lstat` → `lockAgeMs:null`. | drop the `lstat`; auto-retry a stale lock |
| 62 | One redactor | - Canned stderr carrying each of the four shapes (URL userinfo, `?access_token=`, a `gho_` token of 20+ characters, an `Authorization:` line) is redacted in `detail`, `stderrHead` and `helper-failed`'s `detail`.<br>- The L3 pass redacts a planted unredacted ccd answer. | drop a pattern; redact one field only; drop either pass, each alone |
| 63 | Path categories | - A ZWSP (U+200B) twin of a real name, U+2028, U+E000, an unassigned code point and U+FE0F each → `bad-path` in ccd and in the L0 predicates that L1 applies, with identical verdicts over the corpus.<br>- The grammar lines in `shared/docs.ts` and `_docs_py` are pure ASCII (scan). | drop a category; write a literal non-ASCII character |
| 64 | Draft-phase degradation | - A holder whose status output exceeds 16 MiB → `drafts.state:'too-many'`, with committed `entries` intact.<br>- A lowered status bound → `unreadable {step:'status'}`, committed intact.<br>- The recorded status argv includes `--no-ahead-behind`. | let a draft-phase overflow fail the tree; drop the flag |
| 65 | Commit provenance | With `--ref refs/remotes/origin/main`:<br>- a commit reachable only from `refs/remotes/fork/*` or `refs/stash` → `onRef:'not-contained'`;<br>- a commit on the ref → `contains`;<br>- an absent ref → `unmeasured`;<br>- a sleeping `merge-base` stub → `unmeasured` within the bound. | drop the check; answer `contains` on rc ≥ 2 |
| 66 | Asset rule | PWA:<br>- a committed page whose image has a modified draft renders the committed bytes;<br>- a draft page with a drafted image renders the DraftPin bytes, the per-embed chip and "embeds 1 uncommitted asset";<br>- a default-view page never requests a DraftPin. | resolve a committed page's assets through drafts; drop the badge |
| 67 | Default view and hints | A holder on local `main` with 3 dirty docs:<br>- the default view shows zero draft rows, and a hint (n = 3) linking `?ref=refs/heads/main`;<br>- a ref view with `baseEqual:false` (local behind, origin served) shows the base hint and no overlay;<br>- with `baseEqual:true`, the overlay appears. | overlay in the default view; link the bare name; overlay without `baseEqual` |

**Housekeeping.**
1. Restamp `ccd/ccd` after the last edit. There must be exactly one `# ccrc:generated` line (`server/test/ownership.test.ts:179-182`).
2. Re-measure the citation corpus. The caps lines shift every anchor after `:8375`, and the arms and usage edit shift everything after `:23550`.
3. Two branches that both edit `ccd/ccd` conflict on the digest on line 2.

---

### Risks

- **R1 Head-of-line blocking on the real link (UNMEASURED).**
  - Every show frame crosses the one agent WebSocket that pty, tail and exec share. `ws` `maxPayload` is at its 100 MiB default, and nothing enables compression.
  - The lab measured about 268 ms of pty echo per 2 MiB frame at 100 Mbit.
  - §7.8's R1 runs after W3's dark rollout. **Pass:** p95 under load minus idle p95 is at most 250 ms.
  - **Fail:** contingency `docs-chunked-reads` (§6.9): the chunked `docs-show-range` verb becomes a precondition of W5. The class caps stay at 2 MiB (ruling U1).
- **R2 Fetch authentication through the agent's environment (UNMEASURED).**
  - Untried: global credential helpers, `url.insteadOf`, and https origins under `GIT_TERMINAL_PROMPT=0` with stdin at `/dev/null`. The `GIT_SSH*`/`GIT_ASKPASS` keep-list is a guess.
  - §7.8 runs one real refresh per remote class before W5 merges. A failure fires `docs-fetch-keeplist`.
- **R3 Dirty-worktree status cost (UNMEASURED under a docs-tree load).** This covers `worktree list` on the fleet's busiest repo (105 worktrees; 0.434 s cold against 0–30 ms warm at 83 or 84). Measure it in a disposable clone, never a live repo (§7.8).
- **R4 Draft hashing cost.** Content-hash fingerprints read every draft's bytes at tree time, in both views, because the hint counts drafts too.
  - The bounds are `DOCS_DRAFT_HASH_BUDGET` (32 MiB) and `DOCS_MAX_DRAFTS` (1000). The largest measured draft set is 36 files.
  - A worktree with a large binary draft inside a section pushes the whole overlay into `too-many`.
- **R5 Filter neutralising has a false-positive mode.**
  - A doc routed through a real filter such as git-lfs is compared raw, so a stat-dirty filter-attributed doc can read as `modified` when it is not.
  - It is flagged only through the drafts-level `filters-bypassed` caveat, not per path, because `check-attr` is kept out of the allowlist.
- **R6 Fetch failure words depend on git's English stderr text** under `LC_ALL=C`, pinned on 2.43 by fixtures. A git upgrade degrades matching toward `fetch-failed` or `fetch-transport`: less specific, never a wrong word.
- **R7 A refresh moves `refs/remotes/origin/<b>` in repos where live sessions work.** That is newly reachable from a phone.
  - Mitigations: one ref per call; no `FETCH_HEAD` write; no prune or set-head; fsck on; a 10 s ccd floor; server single-flight; at most 2 fleet-wide.
  - `core.hooksPath=/dev/null` also disables any legitimate operator `reference-transaction` hook during docs fetches.
- **R8 The inherited root seam.** ccd's `PROJECTS_ROOT` is hard-coded to `$HOME/projects` (`ccd/ccd:986`), while the agent and server read `CCRC_PROJECTS_ROOT`.
  - Docs is self-consistent, but Docs and the session console can disagree about which projects exist on a box configured differently.
  - `unknown-project` names ccd's root, so the mismatch is visible, but it is not fixed.
- **R9 `origin/HEAD` can lag a renamed remote default.** By design nothing repoints it (no set-head), so a rename shows up as `remote-branch-absent` on the default fetch: diagnosable, not self-healing.
- **R10 Citation tax.**
  - The appended caps lines shift every cited `ccd/ccd` anchor after `:8375`, and the arms shift everything after `:23550`. `session-hook.test.ts` audits `file:line` citations.
  - The plan needs a re-measure task after the ccd commit, with the restamp last.
  - A merge where both sides edit `ccd/ccd` conflicts on the digest on line 2.
- **R11 Not exercised:**
  - sha256-object-format repos;
  - shallow repos (`relation` reported as `unmeasured`, so local is served);
  - a repo whose `origin/HEAD` target fails the ref grammar;
  - macOS: `O_NOFOLLOW` with `dir_fd`, `worktree list -z` needing git ≥ 2.36, and Apple git's `GIT_NO_LAZY_FETCH`. (python ≥ 3.8 is now probed.)
- **R12 The asset rule depends on the PWA threading the page's pin kind into asset resolution** (§4.11, §5.6.3). A slip would show a draft asset inside a committed page, or label one committed. Row 66 pins it.
- **R13 Conditional spreads in `ccdargv-dec-parity`.** `ccdargv-dec-parity.test.ts` parses each `argv([...])` literal, and its handling of the conditional spreads in `docsTree`/`docsFetch` (`--ref` and `--branch` present only when non-null) is UNMEASURED. Check it when the builders land, together with `VERB_OF`'s four-string probe over the two `docs-show` builders.
- **R14 Grant and cap skew.** An old agent with a new ccd answers `not-granted`. That distinction rides on the literal `'forbidden'` the agent sends, and is pinned by an adapter test, not by a shared constant across the two packages.
- **R15 Some trust conditions can be tested only on canned input.**
  - The scrub strips `GIT_TEST_ASSUME_DIFFERENT_OWNER`, and a fixture HOME can neither chown nor mount.
  - So `dubious-ownership`, both `foreign-owner` checks, `other-device` and `identity-changed` are pinned by helper units over injected `stat` results and canned stderr (rows 32, 55, 56), not end to end.
- **R16 fsck can refuse a legitimate remote.** A remote carrying a historical object that git's fsck rejects answers `fetch-rejected-objects` on every fetch of that branch, with no automatic retry. Docs then serves the last fetched commit, and the chip says why.
- **R17 Unicode version skew in the category check.** Python's `unicodedata` and the JS engine's Unicode tables can differ on which code points are `Cn`. A point assigned in one and not the other gets different verdicts. The corpus avoids such points. The consequence is a 400 against an answer, never a wrong read.
- **R18 Two holders hide a branch's drafts entirely.** This is observed live with Workflow worktrees. The page lists both candidates but overlays nothing until one releases the branch, which is the ruled behaviour but can surprise an author.

---

## §3 HTTP API & URLs

Measured at `c62e22b9a`. Browser facts come from Chromium 153 driven headless through playwright-core, with loopback origins A (the ccrc origin), B (same-site with A) and C (cross-site). Firefox and Safari are UNMEASURED. Lab scripts live outside the tree and are not cited by path.

### 3.0 Measurements this section rests on

| Id | What | Result |
|---|---|---|
| M-a | Signed-out armed box; tap on `/docs/<p>/specs/<f>.md?ref=<b>` | 200 shell (`Sec-Fetch-Site: none`, mode `navigate`, dest `document`). The funnel's first 401 raises the login overlay. The URL, `?ref=` included, is unchanged across sign-in. |
| M-b | Reload with the service worker active | `/docs/...` is answered from the worker's precached shell |
| M-c | Top-level navigation to an `/api/...` URL through the installed worker | Reaches the network with `Sec-Fetch-Mode: navigate`, `Sec-Fetch-Dest: empty` and, for a typed URL, `Sec-Fetch-Site: same-origin`; cookie sent |
| M-d | Link click and form GET from B and from C to an `/api/...` URL | Site preserved (`same-site` / `cross-site`), mode `navigate`; the Lax cookie rode all four |
| M-e | `<img src=A/api/projects>` on page B | 200, cookie sent, handler ran. From C: 401, no cookie |
| M-f | `fetch(A/api/..., {credentials:'include', headers:{'x-ccrc-docs':'1'}})` from B and from C | Only the `OPTIONS` preflight reached A (401). The GET was never sent |
| M-g | The PWA's own same-origin `fetch()` carrying a custom header, worker-controlled | The header survives the worker; `Sec-Fetch-Site: same-origin`; **no `Origin` header on a same-origin GET** |
| M-h | Unregistered `/api/docs/x/tree`, unauthenticated, bundle present | `404 {ok:false,error:'not-found'}`: the exempt `GET /*` wildcard (`gate.ts:345-348`) matches and the not-found handler answers (`server.ts:3364-3368`) |
| F1 | Fastify 5.10 encapsulated hooks, via `inject` | A plugin's `onSend` runs on the root gate's 401 and 403 for the plugin's routes, and on the default error handler's 500; it does not run for an unmatched `/api/docs/*` path or for routes outside the plugin |

### 3.1 Page URLs (PWA routes; the server never registers `/docs`)

| Location | Canonical URL |
|---|---|
| Index | `/docs` |
| Project | `/docs/<project>` |
| Section root | `/docs/<project>/<section>` |
| Directory | `/docs/<project>/<section>/<dir>/` (the trailing slash marks a directory) |
| Leaf | `/docs/<project>/<section>/<path>` |

`/docs/`, `/docs/<p>/` and `/docs/<p>/<section>/` canonicalise to the slash-less form. Whether a slash-less path is a leaf or a directory is decided by the tree answer, never by URL shape; a directory reached without its slash is replace-navigated to the slash form.

**Query keys**, `DOCS_PAGE_KEYS = ['ref','view','frame']`, written in that order:
- `ref=<ref>`: any page except the index. The bare or qualified grammar of §2 (a). Written verbatim, because its charset (`A-Z a-z 0-9 . _ / -`) is query-safe; the parser also accepts `%2F`.
- `view=committed`: leaf only, and only together with `ref`. It shows the committed bytes at the commit that **this visit's** tree answer resolved `ref` to. Without `ref` it is redundant, because the default view never overlays drafts, and it is canonicalised away.
- `frame=full`: leaf only, and only when `contentClass(path) === 'html'` (§5.6.7, the full-screen mockup). On any other class it is canonicalised away.
- `#fragment`: passed through untouched to §4.

**Refused, never canonicalised:**
- any pin key (`commit`, `servedRef`, `branch`, `head`, `fp`) gives `commit-in-page`. The page grammar never carries a commit (s2-decisions); a durable pointer to one exact commit is a GitHub URL (3.11);
- any other key gives `unknown-param`; a repeated key gives `repeated-param`;
- a bad value gives `bad-ref`, `bad-view` or `bad-frame`.

**What a leaf shows:**

| URL | Bytes |
|---|---|
| no `ref` | committed bytes at the origin default commit. Drafts never apply (ruling) |
| `?ref=<b>` | the effective file: the draft with its badge when `entryView` (§4.6) opens a draft, otherwise the committed bytes at the served commit |
| `?ref=<b>&view=committed` | the committed bytes at the served commit |

**Encoding.** `docsPageUrl` encodes each path segment with `encodeURIComponent`. The parser splits on `/` and decodes each segment strictly (`bad-escape` on a malformed escape). A `%2F` inside a segment gives `encoded-slash`, so one path has one spelling. Dot segments never arrive, because the URL parser resolves `..` and `%2e%2e` before `location.pathname` exists. After decoding, `(section, path)` must pass the §2 section and rel-path grammars.

**Relative links** are resolved in repository path space, never URL space (§4.11, L0 `resolveDocRef`).

**Reserved.** A first segment beginning with `@` gives `reserved-node` (3.12). The project grammar's first character is `[A-Za-z0-9_]` (s2-decisions), so no project can collide with it. `docs/superpowers/programs/` is not a section: programme ledgers are not addressable (non-goal).

### 3.2 `shared/docs.ts`: the URL layer (L0, imports nothing, additive)

```ts
export const DOCS_PAGE_PREFIX = '/docs';
export const DOCS_API_PREFIX = '/api/docs';
export const DOCS_REQUEST_HEADER = 'x-ccrc-docs';          // 3.8
export const DOCS_REQUEST_HEADER_VALUE = '1';
export const DOCS_PAGE_KEYS = ['ref', 'view', 'frame'] as const;
export const DOCS_PIN_KEYS = ['commit', 'servedRef', 'branch', 'head', 'fp'] as const;

export type DocsRefSpec = { kind: 'bare'; name: string } | { kind: 'qualified'; ref: string };
export function parseDocsRef(s: string): DocsRefSpec | null;   // one meaning of null: not in either grammar
export function docsRefText(r: DocsRefSpec): string;

export type DocsPageLocation =
  | { kind: 'index' }
  | { kind: 'project'; project: string; ref: DocsRefSpec | null }
  | { kind: 'section'; project: string; section: DocSectionSlug; ref: DocsRefSpec | null }
  | { kind: 'path'; project: string; section: DocSectionSlug; path: string; dirSlash: boolean;
      ref: DocsRefSpec | null; view: 'effective' | 'committed'; frame: 'inline' | 'full' };
export type DocsPageParseFailure = 'not-docs' | 'bad-project' | 'bad-section' | 'bad-path' | 'bad-ref'
  | 'bad-view' | 'bad-frame' | 'bad-escape' | 'encoded-slash' | 'commit-in-page' | 'unknown-param'
  | 'repeated-param' | 'reserved-node';
export type DocsPageParse = { ok: true; loc: DocsPageLocation; canonical: string } | { ok: false; why: DocsPageParseFailure };
export function parseDocsPage(pathname: string, search: string): DocsPageParse;
export function docsPageUrl(loc: DocsPageLocation): string;      // canonical; parse(docsPageUrl(l)) returns l
export function docRepoPath(section: DocSectionSlug, path: string): string;

export type DocPin =
  | { kind: 'committed'; commit: string; servedRef: string; section: DocSectionSlug; path: string }
  | { kind: 'draft'; branch: string; head: string; section: DocSectionSlug; path: string; fp: string };
export const docsApi = {                                    // the ONE docs API URL builder; fixed key order
  projects: (): string => '/api/docs/projects',
  tree: (project: string, ref: DocsRefSpec | null): string => ...,
  file: (project: string, pin: DocPin): string => ...,
  refresh: (project: string): string => ...,
};
```

- The server's L1 `parseDocsApiQuery(route, query)` (`server/src/docs/policy.ts`) is built from the same exported predicates (`isDocsProject`, `parseDocsRef`, `isDocsSection`, `isDocsRelPath`, `isDocsCommit`, `isDocsFingerprint`) and the same key constants. No second copy of any grammar exists in `server/src` or `pwa/src`.
- `server/test/docs-url.test.ts` runs the page parser on the server side, so one file pins the grammar for both consumers.

### 3.3 Router and shell

§4.2 owns the detail. In short: `pwa/src/lib/router.ts` gains `useLocation()` (a search channel) and `navigate(href, {replace})`; `app.tsx` gains a `docs` arm matched by `new RegExp('^/docs(?:/|$)')`, which joins the `data-view` chain at `app.tsx:118`. The server needs no change for the shell: `GET /*` is exempt and the not-found handler already serves `index.html` for `/docs/*` (`server.ts:3364-3367`).

### 3.4 API routes

**Registration.** One encapsulated plugin, in `server/src/server.ts` beside `registerUpdateRoutes` (`:1629`):

```ts
await app.register(async (app) => {   // the parameter is named app: auth-gate.test.ts's scanner is literal
  installDocsRequestPolicy(app);      // onRequest: provenance (3.8)
  installDocsResponsePolicy(app);     // onSend: headers, type allowlist, Cache-Control (§5.3)
  registerDocsReadRoutes(app, docs.readers, docs.lanes);
  registerDocsRefreshRoute(app, docs.readers, docs.fetchers, docs.lanes);
});
```

- The routes are registered in `server/src/docs/routes.ts`, the hooks in `server/src/docs/hooks.ts` (both L4). Every decision they apply is an L1 function in `server/src/docs/policy.ts`.
- Root hooks run before plugin hooks, so the gate's `onRequest` (`gate.ts:802-803`) runs first. An unauthenticated request therefore always gets the gate's 401 with its `verdict`, and F1 shows the plugin's `onSend` still decorates that 401 with the docs headers.
- All four routes are session-gated. None is in `EXEMPT` (`gate.ts:198`). None consults the box token. The POST is also origin-checked by the gate when armed (`needsOriginCheck`, `gate.ts:755-760`).
- The read registration never receives a fetcher (§2 (g), wall 1).

| Method + path | Input | 200 body | Refused before any exec |
|---|---|---|---|
| `GET /api/docs/projects` | no query keys | `DocsProjectsResponse` | `bad-query` |
| `GET /api/docs/:project/tree` | `ref?` (bare or qualified) | `DocsTreeResponse` | `bad-project`, `bad-ref`, `bad-query` |
| `GET /api/docs/:project/file` | committed pin `commit, servedRef, section, path`, or draft pin `branch, head, section, path, fp` | raw raster bytes, or `DocsFileResponse` (3.6) | `bad-*`, `bad-query` |
| `POST /api/docs/:project/refresh` | JSON body `{ref: string or null, reason: 'auto' or 'manual'}` | `DocsRefreshResponse` | `bad-query`, `bad-ref` |

**Parameter rules.**
- `servedRef` takes the qualified grammar only: it is the tree answer's `ref.served`, which `docs-show --commit` receives as `--ref` to compute `onRef` (s2-decisions).
- A mixed or incomplete pin gives `bad-query {why:'pin-shape'}`. A repeated key gives `{key, why:'repeated'}`; an unknown key `{key, why:'unknown'}`. Keys may arrive in any order; `docsApi` always writes them in one.
- `:project` failing the grammar gives `bad-project` with zero execs.
- The refresh body must be an object with exactly the keys `ref` and `reason`. Fastify also parses `text/plain` (`gate.ts:642-649`), so a string body gives `bad-query {why:'body'}`. `reason` changes nothing on the server except the wording of a failure log line.

**Refresh flow.** L1 `fetchBranchFor(ref)`:

| Requested ref | Fetch |
|---|---|
| `null` (default view) | `docs-fetch` with no `--branch` |
| bare `b` | `--branch b` |
| `refs/remotes/origin/b` | `--branch b` |
| `refs/heads/b` | skipped, `why:'local-ref'`: a fetch cannot move a local ref |

The follow-up `docs-tree` always starts a **new** flight and never joins a tree GET that began before the fetch ended (the generation counter, §6.4). The response is 200 whenever the lanes ran, and each half carries its own word. A refusal before any exec returns that word's own status.

### 3.5 Wire types (`shared/docs.ts`)

```ts
export interface DocsProjectsResponse { ok: true; index: DocsIndexOk; cacheAgeMs: number | null } // null: read from ccd for this request
export interface DocsTreeResponse { ok: true; tree: DocsTreeOk; refreshDue: boolean }
export interface DocsFileResponse { ok: true; contentClass: Exclude<DocContentClass, 'raster'>;
  show: DocsShowOk; from: 'ccd' | 'cache' }               // a cache hit is marked, never passed off as ccd's
export type DocsRefreshFetch =
  | { state: 'ran'; answer: DocsFetchOk }
  | { state: 'failed'; failure: DocsFailureBody }
  | { state: 'skipped'; why: 'local-ref' };
export interface DocsRefreshResponse { ok: true; fetch: DocsRefreshFetch; tree: DocsTreeResponse | DocsFailureBody }
export type DocsFailureBody = { ok: false; failure: DocsFailure; detail?: string; retryAfterMs?: number } & DocsFailureContext;
```

These wrap §2's ccd answers unchanged, so no adapter narrows. Additive amendments to the §2 types:
- `DocsShowOk` gains `onRef?: 'contains' | 'not-contained' | 'unmeasured'` on committed answers (s2-decisions).
- `DocsTreeOk` and every `DocsIndexOk.projects[]` row gain `github: {state:'named'; slug: string} | {state:'none'}` (3.11).
- `refreshDue` (L1 `refreshDue(tree)`, §2 (g)) exists only on an ok tree, so an unresolved ref can never auto-refresh: that is structural, not a flag. It is `false` for a `refs/heads/...` request.
- There is no `view` field: the PWA derives rows and badges itself from the L0 `entryView` (§4.6), so there is one derivation.
- There is no `node` field (3.12).

### 3.6 Content class decides the answer shape

The representation is a function of `contentClass(path)` alone (L0, §5.1), never of a request parameter, so one URL has one body shape.

| Class | `file` answer |
|---|---|
| `raster` (png, jpg, jpeg, gif, webp) | raw bytes with a checked `image/*` type (§5.2) |
| `markdown`, `svg`, `html`, `text`, `other` | `DocsFileResponse` JSON |

**Constraint on §4 and §5.** 3.8 refuses every navigation and every subresource load of a docs API URL, so every docs byte arrives through the PWA's own `fetch()`. Images are shown through an object URL (raster) or a `data:` URL (SVG); mockups use `srcdoc` with their assets inlined as `data:` URLs. No capability URL and no `iframe src=` ever points at a docs route.

### 3.7 Status mapping and words added here

L1 `DOCS_FAILURE_HTTP` is the only status source; L0 `DOCS_FAILURE_RETRY` is the retry class (§4.7). The PWA switches on `failure`; the status is informational. Success is 200 only: no 3xx, 204 or 304, and no redirects.

| Word | Origin | HTTP | Retry | Context |
|---|---|---|---|---|
| `foreign-request` | server | 403 | none | `{why:'navigation' / 'site' / 'marker', site?}`. No `verdict`, so it can never raise the login overlay (the `gate.ts:851-868` rationale) |
| `bad-query` | server | 400 | none | `{key?, why:'unknown' / 'repeated' / 'pin-shape' / 'body'}` |
| `raster-mismatch` | server | 422 | none | `{declared, size}` (§5.2) |
| `response-type-refused` | server | 500 | none | §5.3 |
| `docs-busy` | server | 503 + `Retry-After` | auto | gains `{lane:'read' / 'fetch', retryAfterMs}` (§6) |
| `malformed-answer` | server | 502 | none | `why` gains `'oversize'` (§6.2) |
| `too-large` | ccd | 413 | none | `cap` is the class cap the server asked for (§6.1) |
| `not-granted` | server | 501 | **manual** (was none) | §7.1 |
| `caps-unknown` | server | 503 + `Retry-After: 5` | auto | also when the verb list lacks `caps` (§7.1) |
| `shared-repo` | ccd | 422 | none | `{owner}`; redirect like `linked-worktree` (s2-decisions) |
| `fetch-rejected-objects` | ccd | 502 | none | s2-decisions |
| `ref-locked` | ccd | 409 | auto after 3 s while `lockAgeMs` is null or < 60 000, otherwise none | `{lockAgeMs}` |

`linked-worktree` and `shared-repo` carry `owner` and `branch`; the PWA replace-navigates to the owner's page with that branch as `ref` (§4.7).

### 3.8 Request provenance: `Sec-Fetch-*` plus a marker header

L1 `docsProvenance(headers): {ok:true} | {ok:false; why; site?}` is applied by the plugin's `onRequest` to all four routes, in this order:

1. `sec-fetch-mode === 'navigate'` gives `why:'navigation'`. This catches every top-level and frame navigation, including through the service worker, where Mode survives and Dest becomes `empty` (M-c, M-d).
2. `sec-fetch-site` present and not `'same-origin'` gives `why:'site'`. That covers a same-site sibling under a shared public suffix (`gate.ts:652-662`; M-e), cross-site, and `none`.
3. `x-ccrc-docs` not equal to `'1'` gives `why:'marker'`.

**Why a marker header replaces the approved "fallback Origin match".** M-g: the PWA's own same-origin GET sends no `Origin`. A match-if-present rule would admit every subresource; a must-match rule would refuse the PWA itself. A custom header, by contrast, cannot be attached by an `img`, `iframe`, `script`, `link` or navigation. A cross-origin `fetch()` can attach it only after a CORS preflight, which the server never answers (M-f), and `no-cors` mode drops non-safelisted headers. So clause 3 is the wall on browsers that send no `Sec-Fetch-*`. Clauses 1 and 2 are defence in depth against a future CORS mistake, and each has its own mutation row that sends the marker together with a foreign `Sec-Fetch-*` value.

**The refusal** is 403 `foreign-request`, carrying the §5.3 headers, logged as `console.warn('ccrc-server: docs refused a <why> request')` at most once a minute per `why`. The PWA sends the header on every `api.docs.*` call through the funnel's `request(path, init)` (`pwa/src/lib/api.ts:380`); `curl` and tests pass it by hand.

### 3.9 Deep links and sign-in

- Measured today (M-a, M-b): the shell is exempt and answers `/docs/*` with 200, from the worker once installed. The first 401 that names a `verdict` raises the overlay (`api.ts:401`). `clearAuthLost()` (`auth.ts:90`) fires `onAuthRegained` (`auth.ts:99`). The URL survives sign-in.
- `DocsScreen` subscribes to `onAuthRegained` and re-fetches (§4.3). No `next=` parameter, no server redirect and no navigation-shaped 401 are added.
- A docs **API** URL opened top-level never renders content: signed in it answers 403 `foreign-request {why:'navigation'}`, signed out it answers the gate's JSON 401 (`gate.ts:897-898`). Links meant for humans are always page URLs.

### 3.10 Service worker

No configuration change is needed. `navigateFallback: '/index.html'` gives `/docs/*` the shell; the built-in `^/api/` denylist keeps `/api/docs/*` navigations off it; the unanchored `NetworkOnly` rule keeps every `/api/docs/*` fetch out of the worker's caches (`pwa/vite.config.ts:62-67`, `pwa/src/lib/sw-denylist.ts:40`). `swDenylist` refuses an entry covering `/docs` at build time (§7.3 owns that change, its prose and its doctor check).

### 3.11 View on GitHub

**Where the slug comes from.** `docs-tree` and each `docs-index` row gain `github`. The helper computes it from `remote.origin.url`, read with its hardened runner (`config --get` is already on §2's allowlist), by the same rule as `_gh_repo_slug` (`ccd/ccd:5148-5163`): strip `.git`, strip one of the three GitHub prefixes, require `owner/name` over `A-Z a-z 0-9 . _ -`. The bash function stays the one definition for ccd's write paths; the helper's copy is bound to it by a corpus-verdict parity row (M3.12), the house pattern for a python copy. `none` means "no GitHub-shaped origin was read", never "no repository".

`ProjectRow.repo` is not used: it reads `unmeasured` for every project the PR sweep has not reached, which includes every project with no workspaces (`server.ts:2448-2452`), a common case for a docs reader.

**The builder** `githubBlobUrl(github, tree.ref, target)` in `shared/docs.ts`:

| Condition | Result |
|---|---|
| `github.state === 'none'` | no link (`no-github-origin`) |
| `relation === 'local-only'`, or `via` is `default:local-main` / `default:local-master` | no link; note "not pushed" (`not-on-origin`) |
| the leaf opens a new draft with no committed entry | no link (`uncommitted`) |
| `side === 'origin'`, or `relation === 'equal'` | link |
| `side === 'local'` with `relation` in `local-ahead`, `local-behind`, `diverged`, `unmeasured` | link, plus the note "GitHub's copy may differ from this view" |

The link is `https://github.com/<slug>/blob/<ref.name>/<repoPath>` for a leaf and `.../tree/<ref.name>/<sectionPath>` for a section or directory, each path segment encoded. Branch-name URLs, not commit permalinks, per the durable-link convention. The PWA never offers a docs page URL as a share link, and no docs page URL is written into tracked text.

### 3.12 Multi-node seam (reserved, not built)

The server holds exactly one agent connection (`index.ts:121-133`; one `agentUrl`/`agentToken`, `config.ts:490-491`; `update/inventory.ts:64-68`). This build:
- keys every internal structure (cache, listing map, single-flight, lanes) by a node key with one value, and the ports take `DocsSourceId = {node, project}`; the composition root builds a one-entry map. Lanes are per link, because head-of-line blocking is per socket;
- reserves the `@<node>` first page segment (`reserved-node`);
- adds nothing to the API or the wire: a `node` query key is simply unknown (`bad-query`).

A second agent connection would add `@<label>` pages keyed by its inventory label, never by the UUID `nodeId`, which re-keys (`inventory.ts:306`, `:521`). The primary keeps its short URLs, and a `node` wire field arrives then, additively.

### 3.13 Census and registration

**`server/test/auth-gate.test.ts`:**
- add `...scanRoutes('docs/routes.ts')` to `ROUTES` (`:99-101`) and a per-file line `expect(scanRoutes('docs/routes.ts').length).toBe(4)`;
- `ROUTES.length` goes from 86 to 90 (`:295`), and every derived count follows; re-measure the prose counts;
- add `/docs/example-project/specs/x.md?ref=ws/example` to the no-cookie shell list;
- the armed no-cookie sweep stays green (the gate's 401 comes first); the dark versus armed-with-cookie property holds (both answer 403 `foreign-request`, because the sweeps send no marker);
- docs routes join neither `EXEMPT` nor `FLAG_AWARE`.

**`server/test/box-token-census.test.ts`:** a `DOCS_SRC = read('server/src/docs/routes.ts')` lane with a hand-kept `DOCS_DOORS` (the four paths) checked against the file in both directions; exactly zero `requireMailToken(` / `checkMailToken(` calls in it; a planted-call control; planted `app.delete` and `app.route({...})` shapes seen. `DOCS_DOORS` does **not** join `SESSION_ONLY_ALL` (`:221`): docs routes are not coordination writes, so no `CLAUDE.md` sentence is owed.

**New scans:** no `app.<verb>('/docs` registration anywhere in `server/src`; `CCD_ARGV.docsFetch(` exactly once (§2 row 49).

### 3.14 Mutation rows (§3)

| # | Guard | Test | Mutation that goes red |
|---|---|---|---|
| M3.1 | Page grammar round trip | `server/test/docs-url.test.ts`: a corpus of canonical URLs round-trips; bare and qualified `ref`; trailing-slash directories; `%2F` gives `encoded-slash`; a bad escape gives `bad-escape`; `@x` gives `reserved-node` | accept any of them, or drop round-trip equality |
| M3.2 | No commit in a page URL | same file: `?commit=`, `&servedRef=`, `&head=`, `&fp=`, `&branch=` each give `commit-in-page` | accept `commit` |
| M3.3 | `view` and `frame` canonicalisation | `view=committed` without `ref` is dropped; `frame=full` on a `.md` is dropped and kept on a `.html`; unknown and repeated keys refused | keep a redundant key, or accept an unknown one |
| M3.4 | API query parser | `docs-routes.test.ts`: each `bad-query` why, with zero execs on a recording runner | accept a mixed pin |
| M3.5 | Provenance clause 1 | marker + same-origin + `sec-fetch-mode: navigate` gives 403 `navigation`, zero execs | delete clause 1 |
| M3.6 | Provenance clause 2 | marker + `sec-fetch-site` in `same-site`, `cross-site`, `none` gives 403 `site` | delete clause 2 |
| M3.7 | Provenance clause 3 | no marker and no `Sec-Fetch-*` gives 403 `marker`; marker with no `Sec-Fetch-*` reaches the handler | delete clause 3, or require `Sec-Fetch-Site` |
| M3.8 | Gate before provenance | armed, no cookie, no marker gives the gate's 401 with `verdict` | register provenance as a root hook before `installGate` |
| M3.9 | Refresh fetch mapping | `docs-policy.test.ts` `fetchBranchFor` table; `refs/heads/b` gives `skipped` with zero fetch execs | always fetch |
| M3.10 | `refreshDue` shape | L1 table: ok tree only; `false` for `refs/heads/...`; §2's stale and floor rules | compute it on a failure, or for a local ref |
| M3.11 | GitHub link | `githubBlobUrl` table over `side` x `relation` x `github` x new-draft | link a `local-only` view |
| M3.12 | Slug parity | `docs-parity.test.ts` runs `_gh_repo_slug` and the helper over one corpus of origin URLs; identical verdicts | edit either copy |
| M3.13 | Node key | `docs-cache.test.ts`: the same (repoKey, blob) under two injected node values gives two entries; same for single-flight | drop the node from a key |
| M3.14 | Route census | the `auth-gate` count lines and the COMPLETE describe; no `/docs` server route (scan) | register a docs route in an unscanned file, or under `/docs` |
| M3.15 | Box-token lane | `DOCS_DOORS` both directions, zero box-token calls, planted controls | add a box-token call; drop the lane |

---

## §4 PWA screen & Markdown

§4 covers everything the operator's browser does: the router's search channel, the Docs screen, its truth line and banners, the doors into Docs, the Markdown extraction, the docs link and image policy, and render hardening (including what chat gets, per U3). Names used from other sections are theirs: `parseDocsPage`, `docsPageUrl`, `DocPin`, `docsApi` (§3.2); `contentClass`, `DOCS_RASTER_TYPES` (§5.1); the lanes and caps (§6).

Measurements quoted here were taken in Node 24 on a server-class CPU with the lockfile's exact versions (react-markdown 10.1.0, remark-gfm 4.0.1, highlight.js 11.11.1, React 19.2.7). Phone CPU and stack depth are UNMEASURED; the worker and the depth check are why that does not affect correctness.

### 4.1 Files

Paths are under `pwa/src/` unless stated.

| File | Change | Content |
|---|---|---|
| `lib/router.ts` | changed | `useLocation()`; `usePath()` becomes a wrapper; `navigate(href, {replace?})` |
| `app.tsx` | changed | the `docs` arm, `data-view`, a boundary around the detail ladder, scroll reset on `path + search` |
| `main.tsx` | changed | the root `RenderBoundary` |
| `components/RenderBoundary.tsx` | new | the one error-boundary class |
| `lib/remarkAlerts.ts` | new | iterative `remarkAlerts`, React-free so the worker can import it |
| `lib/markdown.tsx` | new | extracted from `session/MessageBubble.tsx`: hljs registration, `CodeBlock`, `TableWrap`, shared `code`/`pre`/`table`, `CHAT_COMPONENTS`, `openExternal`, `absolute`, `isImageUrl`, `ChatMarkdown`; imports `../session/chat.css` |
| `lib/markdownLimits.ts` | new | every PWA render limit, declared once |
| `lib/markdownGuard.ts` | new | `prescanMarkdown(src)` |
| `lib/markdownParse.ts` | new | `parseMarkdown(src, profile)`: pure, no DOM, no React |
| `lib/markdownWorker.ts`, `lib/markdownRunner.ts` | new | worker entry; main-thread client with budget, terminate and respawn |
| `lib/renderHast.tsx`, `lib/useParsedMarkdown.ts` | new | the `post()` equivalent; the async hook chat and docs share |
| `lib/api.ts` | changed | `api.docs.*` (4.3, §5.4) |
| `session/MessageBubble.tsx`, `session/ChatList.tsx` | changed | import from `lib/markdown.tsx`; per-item boundary in `ChatItemView` |
| `screens/DocsScreen.tsx` | new | the route component |
| `docs/useDocsVisit.ts` | new | per-visit tree and file slots, single-flight, auto-refresh bookkeeping |
| `docs/DocsHead.tsx`, `docs/DocsBanners.tsx` | new | back, breadcrumb, truth line, freshness chip, actions; banners |
| `docs/DocsIndexView.tsx`, `docs/DocsTreeView.tsx`, `docs/DocsLeaf.tsx` | new | the views |
| `docs/DocMarkdown.tsx`, `docs/DocImage.tsx`, `docs/fetchQueue.ts` | new | docs renderer, gate and plain fallback; the image loader; the per-screen fetch queue shared with §5 |
| `docs/docsLinks.ts`, `docs/docsTree.ts` | new | link and image policy over L0 `resolveDocRef`; `sessionDocsHref`; `listDir`, `SECTION_ORDER` |
| `docs/docsText.ts`, `docs/DocsFailureView.tsx`, `docs/failures.ts` | new | every sentence map; failure rendering; client-only words (§5.4) |
| `docs/docs.css` | new | tokens only |
| `screens/FleetScreen.tsx`, `fleet/fleet.css` | changed | the Docs door |
| `fleet/SessionActionsSheet.tsx`, `session/SessionHeader.tsx` | changed | the "Docs on <branch>" row |
| `pwa/vite.config.ts` | changed | `worker: { format: 'es' }` |
| `pwa/package.json` | changed | five direct dependencies already in the lockfile, pinned to its versions: `unified` 11.0.5, `remark-parse` 11.0.0, `remark-rehype` 11.1.2, `hast-util-to-jsx-runtime` 2.3.6, `html-url-attributes` 3.0.1. `package-lock.json` changes only in its root dependency list |
| `design/audit.mjs`, `test/contrast.test.ts` | changed | ground registrations for `docs.css` |

### 4.2 Router search channel and the app arm

Today `usePath` holds only `location.pathname` (`router.ts:34-42`), so `?ref=a` to `?ref=b` on one path does not re-render. `navigate` already pushes any URL (`router.ts:17-31`).

```ts
export interface Loc { readonly path: string; readonly search: string }  // search includes '?', or ''
const read = (): string => location.pathname + location.search;
export function useLocation(): Loc {
  const [raw, setRaw] = useState(read);
  useEffect(() => {
    const on = (): void => setRaw(read());
    addEventListener('popstate', on);
    return () => removeEventListener('popstate', on);
  }, []);
  return useMemo(() => {
    const q = raw.indexOf('?');          // a pathname cannot contain '?'
    return q < 0 ? { path: raw, search: '' } : { path: raw.slice(0, q), search: raw.slice(q) };
  }, [raw]);
}
export function usePath(): string { return useLocation().path; }
export function navigate(href: string, opts?: { replace?: boolean }): void  // replace uses replaceState
```

- The mechanism stays `useState` + `popstate`, not `useSyncExternalStore`: `navigate`'s `flushSync` and view-transition timing, and `app-pane-reset-timing.test.tsx`, depend on it (`app.tsx:76-113`). `usePath` has one consumer (`app.tsx:33`).
- `app.tsx`: `const { path, search } = useLocation()`; `const docs = new RegExp('^/docs(?:/|$)').test(path)`, so `/docsearch` is not Docs. `docs` joins the `data-view` chain (`app.tsx:118`), so on a phone the fleet hides and Docs is full-screen (`shell.css:20-26`); on desktop Docs renders in `.shell-detail`.
- The ladder (`app.tsx:135-158`) gains `docs ? <DocsScreen path={path} search={search} />`, **not keyed**, so one mount spans one visit.
- The scroll reset (`app.tsx:108-113`) changes its dependencies from `[path]` to `[path, search]`: a changed `ref` or `view` is a different page.

### 4.3 DocsScreen: visit state and data flow

```ts
export interface DocsLoaders {
  projects(): Promise<DocsIndexAnswer>;
  tree(project: string, ref: DocsRefSpec | null): Promise<DocsTreeAnswer>;
  file(project: string, pin: DocPin, signal?: AbortSignal): Promise<DocsFileAnswer>;
  raster(project: string, pin: DocPin, signal?: AbortSignal): Promise<DocsRasterAnswer>;
  refresh(project: string, body: { ref: string | null; reason: 'auto' | 'manual' }): Promise<DocsRefreshAnswer>;
}
export function DocsScreen(p: { path: string; search: string; loaders?: DocsLoaders; parser?: MarkdownParser }): ReactNode
```

- Defaults are module-scope constants (`DEFAULT_DOCS_LOADERS = api.docs`, `parser = docsRunner.parse`), the `MailScreen` idiom (`MailScreen.tsx:23-46`), so their identities are stable.
- `page = parseDocsPage(path, search)`; a canonical mismatch is fixed with `navigate(canonical, {replace:true})`.
- **Loader results are unions, never exceptions, for docs words.** `api.docs.*` calls `request(path, {headers: {[DOCS_REQUEST_HEADER]: DOCS_REQUEST_HEADER_VALUE}, signal})`. An `ApiError` whose body has a string `failure` resolves to that body; any other rejection is mapped to a slot below. The 401 raise still happens in `request` (`api.ts:401`).

**Tree slots**, keyed `project + NUL + (docsRefText(ref) or '')`, with no overloaded null:

```ts
type TreeSlot =
  | { s: 'loading' }
  | { s: 'ok'; answer: DocsTreeResponse; receivedAt: number }
  | { s: 'failed'; body: DocsFailureBody }                        // a docs word, known or not (4.7)
  | { s: 'auth' }                                                // 401: the funnel raised the login overlay
  | { s: 'unreachable' }                                         // fetch rejected (offline, TypeError)
  | { s: 'no-docs-route' }                                       // 404 {error:'not-found'}: a pre-Docs server (§7.1)
  | { s: 'unexpected-response'; status: number; contentType: string };  // any other non-envelope answer
```

`docs/useDocsVisit.ts` owns:
1. **Tree slots**, one GET per key at a time. A tree answer is **reused while the user navigates within the visit** (project, section, leaf, sibling cost no GET; §2 (e)). It is re-fetched: on mount; after a refresh answer; after `draft-changed`, `worktree-moved`, `worktree-gone` or `unknown-commit` from a file read (once automatically, then an inline "changing, Retry"); on `visibilitychange` to visible when the slot is older than `DOCS_STALE_MS` (a GET only, never a refresh); and on `onAuthRegained` for slots in `auth`.
2. **File slots.** Committed bodies are keyed by `blob`, so a file unchanged across a moving default branch is not re-downloaded. Drafts are keyed by `(branch, head, section, path, fp)`. Every request carries the current pin.
3. **Auto-refresh.** `autoRefreshed: Set<key>` in a `useRef`, checked and added synchronously before the POST, so StrictMode's double effect cannot fire twice. It dies with the mount; a mount is one screen open.
4. **Retry bookkeeping.** `autoRetried: Set<key + word>`.

**Auto-refresh** (s2-decisions Q4 and attack 10): when a tree slot becomes `ok` with `refreshDue` true and the key is not in `autoRefreshed`, add it, then `POST refresh {ref: docsRefText(page.ref) or null, reason:'auto'}`. Only an ok tree triggers it; an `unresolved-ref` page offers a manual **Fetch from origin** (`reason:'manual'`). On the answer: an ok `tree` replaces the slot; a `fetch` failure changes only the freshness chip; a `tree` failure keeps the old listing and shows "re-list failed: <sentence>" in the chip. If the new tree changes the leaf's pin the leaf re-reads, keeping scroll, with an inline note "Updated to <short commit>".

**Auth.** On a 401 the slot becomes `auth` and the page says "Sign in to read Docs."; `onAuthRegained` re-fetches (nothing else re-fetches screens after sign-in today: `LoginScreen.tsx:200`).

**Offline** is a non-goal: `/api/` is `NetworkOnly` (`vite.config.ts:67`). The `unreachable` slot says "The server could not be reached; Docs needs a connection." with Retry.

### 4.4 Views

**Page kind comes from the tree answer.** For `kind:'path'`: an entry with exactly `(section, path)` is a leaf; an entry under `path + '/'` makes a directory; otherwise "Not in this listing at <short commit>", plus the default-view hint when it applies. A parse failure renders `DOCS_PAGE_INVALID_SENTENCE[why]` and a link to `/docs`.

| View | Data | Content |
|---|---|---|
| Index `/docs` | `loaders.projects()` | A text filter. `ready` rows sorted by name, then the rest. Each row: name, default branch and short commit, four section counts (`12 specs · 40 plans · 3 design · 0 conventions`; `null` shows `?`), fetch age. Other states in words: "part of <owner>" with a link (linked worktree, shared repo), partial clone, not a git repository, no default branch, unreadable. Projects with no docs collapse under "Projects with no docs (N)". Footer: "N folders not listed (names Docs cannot address)". Header: "Each project's default branch, read from the fleet box." |
| Project `/docs/<p>` | tree | Truth line (4.5). Four section rows in `DOC_SECTIONS` order: label, repo path, count, draft count; `absent` says "not in this repository at <short commit>"; `not-a-directory` says "is not a directory at <short commit>". Notes for `unlisted` and for `drafts.opaque` |
| Section or directory | tree | Truth line, View on GitHub (3.11), a filter, rows from `listDir(entries, section, dir, mode, drafts)`: folders first with listed-entry counts, then files. `SECTION_ORDER`: `specs` and `plans` newest first (name descending; names are date-prefixed), the other two alphabetical |
| Leaf | tree, then file | Truth line, banners, actions. Body by `contentClass(path)`: `markdown` gives `DocMarkdown` (4.10); `raster` gives one `DocImage`; `svg` gives the §5.5 image viewer; `html` gives §5's `MockupView`; `text` gives UTF-8 text in `<pre class="doc-plain">` (highlighted through `CodeBlock` under the 64 Ki-char rule when a registered language matches the extension); `other` gives "No preview (N KiB)" with Download (§5.4) |

A leaf whose listed size exceeds `DOCS_CLASS_CAP[contentClass(path)]` (§6.1) shows the `too-large` sentence **without** requesting it.

**Row** (`.docs-row`, one `<button>`, `min-height: var(--tap-min)`): class glyph, name, the `entryView` badge, size in KiB; a tap navigates with `docsPageUrl`, keeping the page's `ref`. A committed symlink or submodule row is listed, marked, and opens a leaf that says it is not followed.

**Layout.** Phone (<900 px): one column, breadcrumb of the last two crumbs behind a leading `…` button, truth-line facts inline joined by ` · ` with `overflow-wrap: anywhere`. Desktop: the same DOM inside `.shell-detail`, full crumbs; prose is limited by `.msg-assist`'s reading measure. `.docs-back` means "up one level" (leaf, directory or section, project, index, `/`), not `history.back()`, because a deep link has no history (the `.settings-back` choice).

### 4.5 Header: truth line, freshness, banners, actions

**Truth line** (`DocsHead`), from the current tree slot:

| Field | Source | Rendering |
|---|---|---|
| Served ref | `ref.served` | `origin/<b>` or `<b> (local)`; the full refname in `title` |
| Commit | `ref.commit` | first 8 hex, mono; full id in `title` and in "copy commit" |
| How chosen | `ref.via`, `relation`, `counterpart`, `tried` | `VIA_SENTENCE[via]`, plus `RELATION_SENTENCE[relation]` for `local`/`origin`/`qualified`; a dangling `origin/HEAD` in `tried[0]` adds "origin/HEAD points at a missing branch" |
| Source (leaf) | the opened pin | `committed`, `committed (view=committed)`, or `draft · <state> in <worktree label>` |
| Worktree (draft leaf) | `drafts.worktree` | "main checkout", "workspace <last segment>", or the last two segments; full path in `title` |
| Freshness chip | `freshness` + refresh state | below |
| Size (leaf) | answer `size` | KiB |

`VIA_SENTENCE`: `default:origin-head` "default branch (origin/HEAD)"; `default:origin-main` "default branch (origin/main; origin/HEAD unset)"; `default:origin-master` likewise; `default:local-main` "default branch (local main; no origin branch)"; `default:local-master` likewise; `local` "you asked for <requested>, showing local"; `origin` "you asked for <requested>, showing origin's"; `qualified` "exactly the ref you asked for". `RELATION_SENTENCE`: `equal` "local and origin agree"; `local-only` "not on origin"; `origin-only` "only on origin"; `local-ahead` "local is {ahead} ahead of origin"; `local-behind` "origin is {behind} ahead of local"; `diverged` "local and origin have diverged ({ahead} vs {behind}), showing local" (warn tone); `unmeasured` "local vs origin not measured".

**Freshness chip** (`.docs-fresh`, a `<button>`; a tap is a manual refresh with `reason:'manual'`, disabled while one runs; skips the retry floor, not single-flight or ccd's floor). Age shown is `attemptAgeMs + (now - receivedAt)`, with `now` from `useNow(30_000)` (`lib/useNow.ts:8`), formatted by `formatAge` (`fleet/formatReset.ts:50`, which takes seconds).

| State | `data-state` | Text |
|---|---|---|
| `freshness.remote === null` | `none` | "no origin" (static, not a button) |
| `stamp === null` | `never` | "never fetched ↻" |
| `lastOutcome === 'ok'` | `ok` | "fetched {age} ↻" |
| `lastOutcome === 'remote-branch-absent'` | `local` | "local only ↻" (neutral styling) |
| any other outcome | `failed` | "fetch failed {age}: {sentence} · last good {okAge or never} ↻" |
| refresh in flight | `fetching` | "fetching…" |
| answered `fetch-too-soon` | `soon` | "fetched moments ago; again in {n}s", one auto-retry at `retryAfterMs` |
| answered `ref-locked` with `lockAgeMs >= 60 000` | `failed` | "stale lock on {ref}", no auto-retry |
| answered `skipped: local-ref` | `local` | "local ref; fetch does not change it" |

**Banners** (`DocsBanners`, `role="status"`, tone info or warn). `mode` is `default` when `page.ref === null`, else `ref`; `n` counts entries with `draft !== null` (or `drafts.count` for `too-many`).

| Condition | Tone | Text · action |
|---|---|---|
| **Default-view hint:** `mode === 'default'`, `drafts.state === 'holder'`, `n > 0` | info | "{n} uncommitted doc{s} in {worktree label} on {drafts.branch}" · **Open the draft view**, linking the same page with `ref = refs/heads/<drafts.branch>` (challenge accepted: a bare `?ref=main` serves origin whenever local main is behind, and the drafts would not overlay) |
| **Ref-view base hint:** `mode === 'ref'`, holder, `!baseEqual`, `n > 0` | info | "{n} uncommitted doc{s} in {worktree label} are based on local {branch} at {short head}; this page shows {served}" · **Open the local view** (`ref = refs/heads/<branch>`) |
| `ambiguous` | warn | "Two or more worktrees hold {branch}, so drafts are not shown:" + candidates |
| `untrusted` | warn | "The worktree holding {branch} failed the ownership check ({why}); drafts are not shown." |
| `unreadable` | warn | "Drafts could not be read ({step}); showing committed only." |
| `unsettled` | info | "The worktree changed while Docs read it; showing committed only." · Retry |
| `too-many` | info | "{count} uncommitted files is over the limit; showing committed only." |
| `none` with `skipped` | info | "{k} worktree records for {branch} were skipped ({why list})." |
| holder with `caveats` | info | assume-unchanged / skip-worktree: "Some drafts were found by content hash."; `filters-bypassed`: "Clean/smudge filters were bypassed; drafts show raw working-tree bytes." |
| leaf withheld | info | `WITHHELD_SENTENCE[reason]` + "Showing the committed version." |
| leaf `deleted` / `typechange` | info | "Deleted in {label} (uncommitted)." / "Its type changed in {label}; the draft is not read." + "Showing the committed version." |
| leaf `conflicted` | warn | "Contains unresolved merge-conflict markers." |
| file answer `onRef === 'not-contained'` | warn | "Commit {short} is no longer on {served} (the branch was rewritten)." · Re-list |
| draft page embeds `DraftPin` assets | info | "This draft page embeds {k} uncommitted asset{s}." Each embed wears a `draft` chip |
| `view=committed` | info | "Showing the committed version at {short}." · **Back to the draft** |

**Actions.** View on GitHub (3.11; opened with `openExternal` on tap). **Open committed version**, shown iff `entryView(...).offersCommitted`, navigates to the same leaf with `view=committed` (URL state, so Back returns to the draft and a reload keeps the choice; the commit itself is never in the URL, it is resolved from this visit's tree).

### 4.6 `entryView`: one function for rows and leaves (L0, `shared/docs.ts`)

Moved to L0 from §2's L1 wording (challenge accepted): the PWA can import only `shared/`, and a second copy would break the single-source rule. The server-side table test imports it from `shared/docs.ts`.

```ts
export type EntryMode = 'default' | 'ref';
export type EntryBadge = 'modified' | 'new' | 'deleted' | 'typechange' | 'conflicted' | 'withheld';
export type WithheldReason = 'too-large' | 'unreadable' | 'not-a-file';
export interface EntryView { listed: boolean; opens: 'draft' | 'committed' | 'none'; badge: EntryBadge | null;
  withheld: WithheldReason | null; offersCommitted: boolean; committedKind: 'file' | 'exec' | 'symlink' | 'submodule' | null }
export function admitDraft(e: DocsEntry, d: DraftsFacts): boolean;  // d.state === 'holder' && d.baseEqual && e.draft !== null
export function entryView(e: DocsEntry, d: DraftsFacts, mode: EntryMode): EntryView;
```

`overlay = mode === 'ref' && admitDraft(e, d)` (s2-decisions: the default view never overlays; a ref view overlays iff `baseEqual`).

| Case | listed | opens | badge | withheld |
|---|---|---|---|---|
| no overlay, committed file/exec | yes | committed | — | — |
| no overlay, committed symlink/submodule | yes | none | — | — |
| no overlay, no committed entry | no | none | — | — |
| overlay, `modified`/`conflicted`, file with `fp` | yes | draft | modified / conflicted | — |
| overlay, `added`/`untracked`, file with `fp` | yes | draft | new | — |
| overlay, `deleted` | iff committed | committed | deleted | — |
| overlay, `typechange` | iff committed | committed | typechange | — |
| overlay, file with `fp: null` | iff committed or new | committed if committed, else none | withheld | too-large |
| overlay, `kind: 'unreadable'` | same | same | withheld | unreadable |
| overlay, `kind` symlink/directory/special/hardlink/foreign-owner/other-device | same | same | withheld | not-a-file |

`offersCommitted = opens === 'draft' && committedKind in {file, exec}`. Badge text lives in `docsText.ts` (`ENTRY_BADGE_TEXT`, e.g. `draft · modified`, `draft · new`).

### 4.7 Failure rendering

- `DOCS_FAILURE_SENTENCE: Record<DocsFailure, string>` in `docs/docsText.ts`, exhaustive by type (vitest runs `typecheck`, `vite.config.ts:91`), so a new word is a red suite until it has a sentence. `{field}` placeholders are filled from context. Every §2 word has a sentence (the set in §2 (i), plus `shared-repo`, `fetch-rejected-objects` and the §3.7 and §5 words); examples: `unknown-project` "There is no project by that name under the fleet box's projects folder ({root})."; `too-large` "This file is {size}; Docs shows files of this kind up to {cap}."; `helper-unavailable` "The fleet box has no usable python3, which Docs needs; run ccrc doctor there."; `unsupported` "The fleet box's ccd predates Docs; roll out a newer release."; `not-granted` "The fleet agent has not loaded the Docs grants yet. If a rollout is running this clears when it finishes; otherwise update the fleet box."; `foreign-request` "The server refused a request that did not come from the Docs screen."; `raster-mismatch` "These bytes are not a {declared} image."
- `not-a-file` renders `kindText[kind]` for directory, section-not-a-directory, symlink, submodule, file-in-path, special, hardlink, foreign-owner, other-device.
- `DOCS_PAGE_INVALID_SENTENCE: Record<DocsPageParseFailure, string>` for page-URL refusals.
- **Unknown words** from a newer server are never folded: "The server answered '{word}', which this app version does not know; reload to update."
- **Retry** comes from L0 `DOCS_FAILURE_RETRY[word]`: `auto` retries once after `Retry-After`, `retryAfterMs`, 3 s for a young `ref-locked`, or 5 s for `caps-unknown`, then shows Retry; `manual` shows Retry; `none` shows nothing.
- **Context** renders beside the sentence: `unresolved-ref` shows `tried`, `suggest` as a link, `hint:'tag'` ("a tag has that name; tags are not served") and **Fetch from origin**; `ambiguous-worktree` its candidates; `too-large` sizes; `ccd-fault`/`git-failed` `stderrHead` in `<pre class="docs-fail-detail">` (already redacted twice, s2-decisions); `unknown-project` its `root`.
- `linked-worktree` / `shared-repo` redirect with `navigate(docsPageUrl({...page, project: owner, ref: {kind:'bare', name: branch}}), {replace: true})`; `owner === null` renders the sentence only. When `branch` is `null` (the linked checkout is detached), the redirect goes to the owner's default view (`ref: null`) and the page shows "that checkout is detached; showing <owner>'s default branch".
- **Placement:** a tree failure replaces the listing and keeps the crumbs; a file failure replaces the body and keeps the header and truth line; a fetch failure appears only in the chip; an image failure is a per-image chip.
- **Non-docs slots:** `auth` "Sign in to read Docs."; `unreachable` as 4.3; `no-docs-route` "This server predates Docs; update the server box."; `unexpected-response` "The server answered {status} ({contentType})."

### 4.8 Doors and links into Docs

**The Docs door.** `<button type="button" className="docs-door" aria-label="Docs: specs, plans and design notes" onClick={() => navigate('/docs')}>` with a glyph span and the text `Docs`, placed in `.fleet-head-right` immediately before `.accounts-door` (`FleetScreen.tsx:566-573`). It copies the `.settings-door` box exactly (`min-height: var(--tap-min)`, `background: none`, `color: var(--ink-secondary)`, the mono `--text-2xs` font, the `:active` scale) and renders unconditionally. The group already wraps (`fleet.css:3029`); the visual result at 390 px is UNMEASURED (no real-browser layout runner).

**Session links.** `sessionDocsHref(s: FleetSession): {href, label, branch: string | null} | null` in `docs/docsLinks.ts` (null only when `s.project` fails the project grammar: no row rendered):
- `s.branch !== null` and it passes the bare grammar: `href = docsPageUrl({kind:'project', project: s.project, ref: {kind:'bare', name: s.branch}})`, written verbatim (`?ref=feat/renamed`), label `Docs on <branch>`. The branch is the one the worktree holds now (`shared/api.ts:70`), not `ws/<slug>`: workspaces are usually renamed (s2-decisions);
- otherwise the default view, label `Docs, default branch`; the string `null` never reaches a URL.
- Two surfaces call it and there is no second builder: `SessionActionsSheet` (a `btn-ghost` row after Restart, `onClose()` then `navigate`) and `SessionHeader`'s menu (`menu-item` "Docs" with `menu-hint` = branch or `default`, through `menuAct`). Use `session.project`, not the card the session renders on (`boardHome`).

**GitHub links** come from the tree answer's `github` through `githubBlobUrl` (3.11). No fetch of `/api/projects` is needed.

### 4.9 Markdown extraction (chat behaviour unchanged)

**Order:** commit 1 is the golden test (M4.M1) against today's `MessageBubble`; commit 2 is the extraction; commit 3 is chat hardening per U3.

- `lib/remarkAlerts.ts`: iterative, with an explicit stack pushing children in reverse, giving the same pre-order as the recursive `walk` (`MessageBubble.tsx:83-105`); `tag()` byte-identical. Measured: the recursive walk throws at depth 10 000, the iterative one survives 50 000; but the walk is never the first failure (the parser throws near 10 000 and `mdast-util-to-hast` near 5 000), so the guarantees rest on 4.10.
- `lib/markdown.tsx` takes, unchanged unless noted: `IMG_EXT`, `isImageUrl`, `absolute`, `openExternal` (`:32-51`); the hljs registration and aliases as a module side effect (`:53-59`); `LANG_LABEL`, `nodeText`, `keystrokeParts`; `CodeBlock` (gains a `highlight?: boolean` prop); `TableWrap`; `SHARED_COMPONENTS = {code, pre, table}`; `CHAT_COMPONENTS = {...SHARED_COMPONENTS, a, img}` = today's `mdComponents`; `import '../session/chat.css'`.
- `MessageBubble.tsx` keeps `linkify`, `timeOf`, `MessageEvent` and `FoldedCard` (imported by `ChatList.tsx:18`). Its two `<Markdown remarkPlugins={[remarkGfm, remarkAlerts]} components={mdComponents}>` sites become `<ChatMarkdown text={...} />`, preserving the plugin order.

**`lib/markdownLimits.ts`** (declared once; tests import them):

| Constant | Value | Basis |
|---|---|---|
| `MD_MAX_CONTAINER_DEPTH` | 32 | approved; real max 2 across 899 docs and 7 879 chat blocks |
| `MD_MAX_DELIMITER_RUN` | 64 | real max 3; a hostile 4 096-run costs 1.1 s at 8 KiB |
| `MD_MAX_TREE_DEPTH` | 64 | exact post-parse hast depth; real max 9 |
| `DOCS_MAX_RENDER_ELEMENTS` | 20 000 | element nodes in a parsed tree, both profiles. Real docs sit far below it; 510 KiB of thematic breaks parses inside its budget yet yields 104 448 `<hr>` elements that the main thread would build synchronously (measured) |
| `MD_HIGHLIGHT_BLOCK_MAX_CHARS` | 65 536 | approved; hljs is linear, about 43 ms at 64 KiB |
| `DOCS_HIGHLIGHT_PAGE_MAX_CHARS` | 524 288 | caps main-thread hljs per page at about 0.25 s |
| `DOCS_PARSE_BUDGET_MS` | `min(10 000, 2 000 + 1 000 x floor(bytes / 65 536))` | approved 2 s for every input under 64 KiB, which is where every measured hostile shape lives; larger real docs (0.6-0.9 s on a server CPU at 200-500 KB) get room on a phone. Off the main thread, a longer budget never freezes the UI |
| `DOCS_PARSE_BUDGET_LARGE_MS` | 30 000 | Format anyway |
| `DOCS_RENDER_GATE_BYTES` | 524 288 | approved; 6 of 899 real docs exceed it |
| `CHAT_SYNC_MAX_BYTES`, `CHAT_PARSE_BUDGET_MS` | 4 096, 2 000 | U3; chat p99 is 4 181 B |

`DOCS_MAX_IMAGES_PER_PAGE` (30) and `DOCS_STALE_MS` are imported from `shared/docs.ts`, never restated; `DOCS_PWA_FETCH_CONCURRENCY` (2) lives in `docs/fetchQueue.ts`.

### 4.10 The docs Markdown pipeline

**Pre-scan** (`prescanMarkdown(src): {ok:true} | {ok:false; why:'container-depth' | 'delimiter-run'; line; value}`): one iterative pass over lines, skipping fenced blocks (a fence of 3+ backticks or tildes at up to 3 spaces, closed by the same character at least as long). Container depth per line: repeatedly skip up to 3 spaces, then consume `>` (plus one optional space) or a list marker (`-`, `+`, `*`, or 1-9 digits then `.` or `)`, followed by space or tab); over 32 refuses. The longest run of `*` or of `_` over 64 refuses. Measured: 17 ms for 4 MiB; 0 false positives on 899 real docs and 7 879 real chat blocks; catches the measured crash shapes. It bounds depth, not time: measured super-linear shapes with no deep nesting (`*a _` repeated, nested emphasis, wide or long GFM tables, lazy blockquote continuation, repeated `[a](`) cost 1-26 s at 16-80 KiB. **The worker is the only time bound** (challenge accepted).

**Parse** (`parseMarkdown(src, profile)`, pure; runs in the worker and in tests):

```ts
export type ParseOutcome =
  | { kind: 'tree'; tree: HastRoot; depth: number }
  | { kind: 'refused'; why: 'container-depth' | 'delimiter-run'; line: number; value: number }
  | { kind: 'too-deep'; depth: number }
  | { kind: 'too-wide'; elements: number }            // over DOCS_MAX_RENDER_ELEMENTS
  | { kind: 'threw'; error: string }                 // error.name only
  | { kind: 'timeout'; budgetMs: number }            // runner only
  | { kind: 'worker-unavailable' }                   // runner only
  | { kind: 'worker-failed'; error: string };        // runner only
```

1. Pre-scan; refused ends here.
2. `unified().use(remarkParse).use([remarkGfm, remarkAlerts]).use(remarkRehype, {allowDangerousHtml: true})`, then `runSync(parse(file), file)`: react-markdown's own processor (`react-markdown/lib/index.js:123`, `:262`). This is the same pipeline, called stage by stage so the parse can run in a worker (challenge accepted; M4.P10 pins identical output).
3. Replace each `raw` node with a `text` node, iteratively (react-markdown's `post()` default, `:360-365`). **Raw HTML renders as literal text, never as markup;** `skipHtml` is not used, because 90 raw nodes in 48 real docs are mostly angle-bracket placeholders that `skipHtml` would silently delete.
4. Drop `position`, and compute depth and element count in one iterative walk. Over `MD_MAX_TREE_DEPTH` gives `too-deep`, protecting the recursive `toJsxRuntime` on the main thread. Over `DOCS_MAX_RENDER_ELEMENTS` gives `too-wide`, so a tree that parsed within its budget can never make the main thread build an unbounded DOM. The byte gate stays as the first check; the element cap is the one that bounds render cost.
5. Any exception gives `threw`.

**Worker and runner.** Protocol `{id, src, profile}` to the worker, `{id, outcome}` back; the worker wraps both the parse and the `postMessage` (a `DataCloneError` becomes `threw`). `createMarkdownRunner({spawn, setTimer, clearTimer})` gives `{parse(src, {profile, budgetMs, signal}), prewarm(), dispose()}`:
- `defaultSpawn = () => new Worker(new URL('./markdownWorker.ts', import.meta.url), {type: 'module'})`; no `Worker`, or a throw from `spawn`, is a sticky `worker-unavailable`;
- one worker, one job posted at a time, FIFO behind it; the budget timer starts at post; `prewarm()` on DocsScreen mount;
- the timer fires: `terminate()`, resolve `timeout`, respawn lazily; an `error`/`messageerror` event: `worker-failed`, drop, respawn on the next job; an abort while queued removes the job, while running terminates and respawns; a result whose `id` is not the running job's is ignored;
- two module singletons, `docsRunner` and `chatRunner`, so a 30 s docs job never delays chat.
- `vite.config.ts` adds `worker: {format: 'es'}`; that the build emits the chunk and the precache lists it is a plan verification step (`npm run build`, then grep `dist-pwa/sw.js` for the worker asset).

**`DocMarkdown`**, in order:
1. **Gate:** size over `DOCS_RENDER_GATE_BYTES` shows "This document is {MiB}. Formatting it may take a while." with **Format anyway** (30 s budget) and **Show as text**; the parser is not called until a choice.
2. **Parse** through `useParsedMarkdown(text, parser, {profile:'docs', budgetMs})`; header renders at once, body shows "Formatting…".
3. `worker-unavailable` with size at most `CHAT_SYNC_MAX_BYTES`: parse on the main thread; above: plain text with its own note.
4. `tree`: `detachUrls(tree)` once, then `renderHast(tree, {components: DOC_COMPONENTS})` in `<article className="doc-body msg-assist">` inside a `RenderBoundary` keyed by the pin. Anything else: `<DocPlain text reason={outcome} />`, a note line then `<pre className="doc-plain">`.
5. Notes: refused "Line {line} nests {value} levels deep (limit 32); shown as plain text." or the delimiter-run equivalent; `too-deep`; `too-wide` "This document would draw {elements} elements (limit 20 000); shown as plain text."; `threw` "could not be formatted ({error})"; `timeout` "Formatting took longer than {s} s" with **Format anyway** (only after the normal budget); `worker-unavailable`; `worker-failed` with **Retry**.
6. A `.md` that arrived as base64 is decoded with a non-fatal `TextDecoder('utf-8')` and shown as plain text: "Not valid UTF-8."

`renderHast(tree, {components, urlTransform?})` is react-markdown's `post()` minus the raw step; when `urlTransform` is given (chat passes react-markdown's `defaultUrlTransform`) it is applied to each `html-url-attributes` key as `post()` does; then `toJsxRuntime(tree, {Fragment, jsx, jsxs, components, ignoreInvalidStyle: true, passKeys: true, passNode: true})`.

**Highlighting.** `CodeBlock` highlights only when the language is registered, `highlight !== false`, and the block is at most `MD_HIGHLIGHT_BLOCK_MAX_CHARS`; an over-cap block labels itself "{label} · not highlighted ({KiB} KiB)". Docs add the per-page budget: `detachUrls` sums `pre > code` text in document order and marks every block past `DOCS_HIGHLIGHT_PAGE_MAX_CHARS` as `highlight:false`. Measured: 4 of 21 651 real code blocks exceed 64 KiB.

### 4.11 Docs link and image policy

**`detachUrls(tree)`** runs once per outcome, iteratively: for every element it moves every `html-url-attributes` property out of `properties` into a `WeakMap<Element, DetachedUrls>` and deletes it from the node; it numbers `img` elements in document order; it records the `highlight` decision for `pre`. **No URL-bearing attribute reaches the DOM except through `DocLink` and `DocImage`**, which read the map through the `node` prop and a `DocLinkContext` (`{project, pageRef, view, section, path, tree, pageSource}`).

**L0 `resolveDocRef(from: {section, path}, ref: string): DocRefResolution`** (`shared/docs.ts`; shared with §5):

```ts
export type DocRefResolution =
  | { kind: 'doc'; section: DocSectionSlug; path: string; fragment: string | null }
  | { kind: 'repo'; repoPath: string }                              // inside the repo, outside the four sections
  | { kind: 'fragment'; fragment: string }
  | { kind: 'external'; url: string; scheme: 'http' | 'https' | 'mailto'; origin: string | null }
  | { kind: 'self-contained'; scheme: 'data' | 'blob' }
  | { kind: 'refused'; why: 'empty' | 'malformed' | 'scheme' | 'protocol-relative' | 'root-relative' | 'above-root' | 'bad-path' };
```

Steps: trim leading and trailing ASCII whitespace and C0 controls (as a browser does for an attribute URL); any remaining C0, DEL, space, or backslash anywhere gives `malformed` (fail closed, never delete-and-continue); empty gives `empty`; a leading `#` gives `fragment`; a scheme (`^[A-Za-z][A-Za-z0-9+.-]*:`) gives `external` for http, https and mailto, `self-contained` for data and blob, otherwise `scheme`; a leading `//` gives `protocol-relative`; a leading `/` gives `root-relative` (where every `/api/...` lands); otherwise resolve with `new URL(ref, 'https://docs.invalid/' + dirname(docRepoPath(section, path)) + '/')`, require that sentinel origin, drop query, keep the fragment, decode each segment once (a throw is `bad-path`); a path climbing above the repo root is `above-root`; under one of the four section paths the remainder must pass the rel-path grammar (`bad-path` otherwise) and gives `doc`; any other in-repo path gives `repo`.

**Markdown `a` (`DocLink`):**
- `doc`: `<a href>` built with `docsPageUrl` for the same project, the page's `ref`, `view` dropped; a plain left click is prevented and navigated in-app; modifier and middle clicks are left to the browser (a new tab onto `/docs/...`). An `.html` target reaches §5's viewer through the leaf.
- `fragment`: `<a href="#id">` whose click scrolls the matching element inside the article (`CSS.escape`), no history entry. Only ids the pipeline emits exist (GFM footnotes); no heading ids are generated (2 fragment links in 899 real docs).
- `external`: `target="_blank" rel="noopener noreferrer"`, opened with `openExternal` on tap only; nothing prefetches.
- `repo`: a GitHub link through `githubBlobUrl` with a trailing "↗ GitHub" mark when one exists, else inert.
- everything else: `<span className="doc-link-inert" title="<sentence>: <raw>">`, no `href`.

**Markdown `img` (`DocImage`):**
- `doc` of class `raster` or `svg`, then the **pin rule** (s2-decisions asset rule), with `e` the tree entry at `(section, path)` (none gives refused `absent`):
  - **committed page** (every default-view page, every `view=committed` leaf, and every ref-view leaf that opens committed): needs `e.committed.kind` in file/exec, giving `CommittedPin{commit: ref.commit, servedRef: ref.served, section, path}`; otherwise refused `absent`. If `mode === 'ref'` and `admitDraft(e, drafts)`, the image wears "uncommitted change not shown";
  - **draft page**: `entryView(e, drafts, 'ref').opens === 'draft'` gives `DraftPin{branch: drafts.branch, head: drafts.worktree.head, section, path, fp: e.draft.fp}` with a `draft` chip, counted in the page banner; an entry whose draft is `deleted` is missing (`deleted-in-worktree`); a `typechange`, withheld or `fp: null` draft is missing (`draft-withheld`), never a silent fallback to the committed bytes (a missing image renders as a refused one, with that reason); an entry with no draft is committed at C (`baseEqual` makes H equal C) under the same file/exec condition as a committed page; no entry is refused `absent`. This is the one asset rule, shared with mockup assets (§5.6.3).
- `doc` of any other class: refused `not-image`; an `html` target also gets **Open in viewer** (its leaf route).
- `external` http(s): refused `external` with **Open image externally** (`openExternal` on tap).
- everything else: refused with its reason.
- Image index at or beyond `DOCS_MAX_IMAGES_PER_PAGE` (30): `deferred`, a **Load image** button.
- Loading: pinned images join the per-screen `fetchQueue` (concurrency 2, shared with mockup assets; §6 owns the real bound). A raster goes through `loaders.raster` and becomes an object URL through `rasterObjectUrl` (§5.4), revoked on unmount or replacement; an SVG goes through `loaders.file` and becomes a `data:image/svg+xml;base64,...` URL, never a `blob:` (§5.5).
- Rendered as `<button className="doc-img-link" onClick={() => navigate(<the image's own leaf>)}><img src alt className="msg-img" /></button>` plus its chip. Tapping opens the image's leaf in-app; there is never a top-level navigation to `/api/...`. The fetch goes through the funnel, so a 401 raises the login overlay, which a bare `<img src>` could not do.
- Failure: a chip with the failure sentence, "unexpected response" (§5.4), or "could not reach the server". Refused: `<span className="doc-img-refused" role="img" aria-label={alt}>` with "Image not loaded: {reason}".

### 4.12 Hardening

**`components/RenderBoundary.tsx`**: a class with `getDerivedStateFromError`, a `resetKey` prop reset through `getDerivedStateFromProps`, `componentDidCatch` logging `console.warn('ccrc: render error in ' + where, error)`, and a `fallback(error)` prop. This fixes pre-existing defect 3 (today a render throw unmounts the whole root, `main.tsx:13-17`).

| Mount | `resetKey` | Fallback |
|---|---|---|
| `main.tsx` around `<App/>` | constant | "ccrc could not draw this screen." + Reload |
| `app.tsx` around the detail ladder | `path + search` | "This screen could not be shown." + Back to the fleet; sidebar, login overlay and toasts survive |
| `DocMarkdown` around the doc body | pin key | `DocPlain` "This document could not be displayed; shown as plain text." |
| `ChatList.tsx` `ChatItemView`, per item | message text / item key | message: `<pre className="msg-plain">` + "could not render"; other items: "This item could not be shown." (covers virtualised and not, since `ChatListInner` shares `ChatItemView`) |

**Chat (ruling U3 = (b)).** Boundaries, the iterative `remarkAlerts` and the 64 Ki-char highlight cap reach chat by construction. Added for chat:
1. `prescanMarkdown` in front of the synchronous path; a refusal renders `<pre className="msg-plain">` (0 of 7 879 real chat blocks trip it).
2. Messages at most `CHAT_SYNC_MAX_BYTES` (UTF-8) render exactly as today: `<Markdown remarkPlugins={[remarkGfm, remarkAlerts]} components={CHAT_COMPONENTS}>`.
3. Longer messages (about 1% of blocks) parse through `chatRunner` with a 2 s budget: `msg-plain` until the first outcome, then the **last good** tree while newer streaming text parses (at most one running and one queued job per hook; the queued one is replaced); a tree renders through `renderHast(tree, {components: CHAT_COMPONENTS, urlTransform: defaultUrlTransform})`, byte-identical to the sync path (M4.P10); any other outcome renders `msg-plain` with a one-line note; no Format-anyway in chat; the streaming caret stays after the body.
4. Chat `img`, and the image-URL auto-embed in chat `a`, refuse a root-relative or protocol-relative `src` and render the URL as a plain link. That closes chat's path from message text to any same-origin API GET. Everything else about chat links, pinned by `message-links.test.tsx`, is unchanged.

### 4.13 Deferred (decided)

- **Mail artifacts stay text.** They are absolute fleet-box paths, usually review reports under `$HOME/.cc-clips/<id>/` (`ccd/reviewer-skill/SKILL.md:50`), outside every section; `MailCard`'s "rendered as paths, not as links" (`MailCard.tsx:67-80`) and its tests stay true. A follow-up could add a pure `docLocationOf(absPath, sessions)` built only from the parsed section and path.
- **StartProgramSheet gets no link:** its only path is a programme ledger, which is not a section and does not exist before the run.
- **No ProjectCard Docs link** in this programme; the index and the session rows cover it.

### 4.14 CSS, contrast, tap targets

- `docs/docs.css` uses tokens only (`--sp-*`, `--tap-min`, `--ink-*`, `--bg-*`, the existing tint/text pairs, `--r-sm`); no literal colours.
- The doc body is `.doc-body.msg-assist`, inheriting every contrast-measured markdown pair and the reading measure (`chat.css:928+`; `.msg-assist` is grounded on `--bg-page`, `design/audit.mjs:486`).
- New chrome is registered in `design/audit.mjs` `GROUNDS` with a `why`, following `.settings-*` (`audit.mjs:753-804`): `.docs-door` (+`:active`), `.docs-back`, `.docs-crumb`, `.docs-truth`, `.docs-fresh[data-state=*]`, `.docs-row`, `.docs-badge`, `.doc-link-inert`, `.doc-img-refused`, `.doc-plain`, `.doc-plain-note`, `.msg-plain`, and §5's `.docs-mockup-*` chrome. `.docs-door` also gets `.shell-nav`'s `--bg-surface` ground, as `.settings-door` does. The frozen census admits no unregistered identity (`contrast.test.ts:1162-1165`).
- `docs.css` sets no `overflow` on `.shell-detail` (`shell-css.test.ts`).
- Every new control gets both halves of `tap-targets.test.tsx` (CSS scrape of `min-height: var(--tap-min)` and a render assertion): door, back, crumb, row, chip, gate buttons, Load image, banner actions, the session-sheet and menu rows, and §5's toolbar buttons.

### 4.15 Mutation rows (§4; PWA tests under `pwa/test/`)

| # | Guard | Test | Mutation that goes red |
|---|---|---|---|
| M4.R1 | Search channel | `router-location.test.tsx`: `navigate('/docs/p?ref=a')` then `?ref=b`; injected `loaders.tree` called with ref `b` | snapshot only `pathname` |
| M4.R2 | `data-view` | `app.test.tsx`: `/docs` and `/docs/p/specs/x.md` give `[data-view="session"]`; `/docsearch` renders the placeholder | drop `docs` from the chain; match a bare `^/docs` prefix |
| M4.R3 | Scroll reset on search | `app-pane-reset-timing.test.tsx`: a scrolled pane resets when only `?ref=` changes | dependencies `[path]` |
| M4.R4 | Replace on redirect and canonicalisation | `docs-screen.test.tsx`: `history.length` unchanged after a `linked-worktree` redirect | `pushState` |
| M4.L1 | Docs door | `fleet-screen.test.tsx`: `.docs-door` in `.fleet-head-right`, text `Docs`, click goes to `/docs`; `tap-targets` scrape and render | remove it, or rename the class |
| M4.L2 | `sessionDocsHref` | `session-docs-link.test.tsx`: branch `feat/renamed` with workspace `ws-old` gives exactly `/docs/<p>?ref=feat/renamed`; branch null gives `/docs/<p>`; no href contains `null`; the sheet row and the menu item produce identical hrefs | use the workspace slug; a second builder |
| M4.M1 | Chat unchanged by extraction | `markdown-golden.test.tsx`, committed before the extraction: `renderToStaticMarkup(MessageBubble)` over a corpus (callouts incl. nested, code in all 14 languages and aliases, kbd, tables, task lists, images, links, bare URLs, raw HTML) equals stored snapshots | change plugin order; drop an alias; edit `CHAT_COMPONENTS.a` |
| M4.M2 | Iterative `remarkAlerts` | `remark-alerts.test.ts`: differential against the old recursive walk kept as the oracle, 1-40 deep; a synthetic depth-50 000 mdast completes (ctl: the oracle throws `RangeError`) | revert to recursion |
| M4.P1 | Container-depth pre-scan | `'>'.repeat(10000) + ' x'` gives `refused/container-depth` and the note (ctl: `parseMarkdown` without the pre-scan gives `threw RangeError`) | delete the pre-scan |
| M4.P2 | Delimiter-run pre-scan | a 4 096-run of `*` gives `refused/delimiter-run` | delete the run check |
| M4.P3 | No false positives | the ten largest tracked files under this repo's `docs/superpowers/**` pre-scan ok | lower either limit to 2 |
| M4.P4 | Tree depth | nested emphasis 100 deep passes the pre-scan and gives `too-deep` | delete the check |
| M4.P5 | Raw HTML as text | `<img src=x onerror=alert(1)>`, `<script>x</script>` and `<server-host>` render as visible text; 0 `img`, 0 `script` | add `rehype-raw`; use `skipHtml` (the placeholder vanishes) |
| M4.P6 | Budget and terminate | `markdown-runner.test.ts`, fake spawn that never answers, fake timers: `timeout` at the budget, `terminate` once; Format anyway posts a 30 000 job; the budget formula table (1 KiB 2 s, 128 KiB 4 s, 1 MiB 10 s) | drop the timer; drop terminate; a fixed budget |
| M4.P7 | `worker-unavailable` distinct | spawn throws: outcome `worker-unavailable`; 4 KiB parses in-thread; 5 KiB shows its note | fold into `timeout` |
| M4.P8 | Worker crash | fake emits `error`: `worker-failed`; the next parse respawns | reuse the dead worker |
| M4.P9 | Render gate | a 600 KiB doc shows the gate and the parser spy has 0 calls; Show as text gives `pre`; Format anyway calls with 30 000 | delete the gate |
| M4.P10 | Pipeline parity | `renderHast(parseMarkdown(src).tree, {components: CHAT_COMPONENTS, urlTransform: defaultUrlTransform})` equals `<Markdown ...>` over M4.M1's corpus | change `remarkRehype` options; drop raw-to-text |
| M4.P11 | Stale results ignored | v1 answering after v2 shows v2 | drop the id check |
| M4.P12 | Element cap | an `hr` x 90 000 fixture and an autolink fixture, each under 512 KiB, give `too-wide` and the `renderHast` spy has 0 calls; a real 500 KiB prose doc still renders | delete the count; count only after render |
| M4.H1 | Block highlight cap | a 70 000-char `ts` block has no `.hljs-keyword` and says "not highlighted"; 1 000 chars has spans | delete the cap |
| M4.H2 | Page highlight budget | nine 60 000-char blocks: first eight highlighted, ninth not | delete the budget |
| M4.U1 | Nothing hostile becomes `src` | `docs-links.test.tsx`: `/api/example/x`, `//evil.example/x.png`, `https://evil.example/x.png`, `data:`, `blob:`, `javascript:`, a leading control char, a backslash form, `../../../../x.png`, `../../README.png` give zero `img[src]` and zero fetch-spy calls (ctl: `CHAT_COMPONENTS` renders `img[src="/api/..."]` for the first) | use chat's `img` |
| M4.U2 | Pin rule | committed page gives `CommittedPin(C, served)`; draft page with an admitted image gives `DraftPin` + chip + "embeds 1"; committed page with a drafted image gives committed bytes + "uncommitted change not shown" | resolve a draft on a committed page |
| M4.U3 | In-app routes | `[x](../plans/p.md)` has `href === docsPageUrl(...)` with the page's ref; a click pushes state, no `window.open`; a meta-click is not prevented | `openExternal`; drop the ref |
| M4.U4 | External on tap only | `https://` link has `rel` with `noreferrer`, click calls `window.open(..., 'noopener,noreferrer')`; `javascript:`, `/api/`, `//host` render spans with no `href` | render `href` for inert links |
| M4.U5 | Image cap | 31 pinned images: 30 loader calls; the 31st is Load image | delete the cap |
| M4.U6 | Object URL revoked | unmount calls `URL.revokeObjectURL` with the created URL | drop the revoke |
| M4.U7 | Anchors | `[1](#user-content-fn-1)` scrolls inside the article; `history.length` unchanged | route anchors |
| M4.T1 | Truth line on every ref page | `docs-truth.test.tsx` over project, section, dir, leaf: served ref, 8-hex commit, `via` sentence, chip | omit it on any kind |
| M4.T2 | Default view never overlays; hint is qualified | holder with 3 drafts in the default view: hint links `ref=refs/heads/main`; draft-only entries unlisted; `loaders.file` never gets a draft pin | overlay in the default view; a bare `?ref=main` link |
| M4.T3 | Base hint | holder with `!baseEqual` in a ref view: hint linking `refs/heads/<b>`, no overlay | overlay when `!baseEqual` |
| M4.T4 | Drafts-state banners | parametrised over ambiguous, untrusted, unreadable, unsettled, too-many, none-with-skipped | drop any banner |
| M4.T5 | `onRef` | `not-contained` shows its banner | drop it |
| M4.T6 | Open committed version | the button navigates to `view=committed`; the loader gets `CommittedPin(C)`; no commit appears in `location.href` | put the commit in the URL |
| M4.T7 | One badge function | row and leaf badge text equal for every draft fixture; a source scan finds no `.draft.state` read in `pwa/src/docs/**` outside `entryView` | a second badge derivation |
| M4.F1 | Sentences exhaustive | typecheck `Record<DocsFailure, string>`; every `DOCS_FAILURES` key has a sentence of 20+ chars; same for `DocsPageParseFailure` | delete a key |
| M4.F2 | Unknown word kept | `{failure:'brand-new-word'}` renders a sentence containing it | fold it into a known one |
| M4.F3 | Retry classes | parametrised over `DOCS_FAILURE_RETRY` | retry `none`; retry forever |
| M4.F4 | Placement | a file failure keeps the truth line; a fetch failure changes only the chip | replace header or listing |
| M4.F5 | Re-fetch after sign-in | a 401 armed body gives slot `auth`; `clearAuthLost()` calls `loaders.tree` again | no `onAuthRegained` subscription |
| M4.F6 | Pre-Docs server | 404 `{error:'not-found'}` without `failure` renders "predates Docs", never a docs sentence | map any 404 to `unknown-project` |
| M4.A1 | Once per open per (project, ref) | `docs-refresh.test.tsx`: `refreshDue` gives exactly 1 POST; navigating within the visit keeps 1; a new ref adds 1; remount adds 1 | key by path; a module-level set |
| M4.A2 | Only when resolved | `unresolved-ref` gives 0 POSTs; Fetch from origin gives 1 `manual` | auto on failure |
| M4.A3 | Re-list on return | `visibilitychange` with a slot older than `DOCS_STALE_MS`: 1 GET, 0 POSTs; younger: 0 | always re-list; POST |
| M4.B1 | Detail boundary | a mocked throwing `DocsScreen` at `/docs`: `.shell-nav` present with the fallback; navigating resets it | remove it |
| M4.B2 | Doc-body boundary | an injected throwing renderer gives `DocPlain` with the truth line intact | remove it |
| M4.B3 | Chat per-item boundary | the middle of three messages throws; items 1 and 3 render, item 2 shows raw text | remove it |
| M4.B4 | Root boundary | `App` throwing shows Reload | remove it |
| M4.C1 | Chat pre-scan (U3 b) | an assistant `'>'.repeat(4000)` renders `.msg-plain` | delete it |
| M4.C2 | Chat worker threshold (U3 b) | runner spy called for 5 000 B, not for 4 000 B | always sync |
| M4.C3 | Chat image refusal (U3 b) | `![](/api/example/x)` gives no `img[src^="/api"]`; the `https` image case in `message-links.test.tsx` stays green | delete the clause |
| M4.S1 | Contrast registrations | `contrast.test.ts`: census unchanged, `.docs-door` measured on its second ground | drop a registration |

---

## §5 HTML mockups & how the file route sends bytes

**Summary.** The file route sends raw bytes only for a raster image whose bytes have been checked. Every other class gets a JSON envelope. Every docs response carries one fixed set of headers. A plugin-level hook applies them and also refuses any response type outside an allowlist. SVG is only ever an image, shown through `<img src="data:...">`.

An HTML mockup is never served from a URL. The PWA pre-scans its text and refuses a page that is too deep or has too many tags, without parsing it. Otherwise it:

- parses the page inertly;
- inlines its relative assets as `data:` URLs, fetched through the funnel under the asset rule;
- puts a CSP `<meta>` in front that cuts all network access;
- renders it in `<iframe srcdoc sandbox="">`, with scripts off until one tap turns them on.

The PWA shell carries `frame-src 'none'`. That closes the one channel the frame's own CSP cannot close: the frame navigating itself away.

### 5.0 Measurements this section rests on

Chromium 153 headless (desktop), Fastify 5.10 through `inject`, and a census of the fleet's committed sections. Firefox, WebKit/iOS and Android Chrome are UNMEASURED throughout. File:line citations into this repo are as measured at `c62e22b9a`.

| Id | Measured | Result |
|---|---|---|
| lab 1-2 | `sandbox="allow-scripts"` (attribute or `CSP: sandbox allow-scripts` header) | Opaque origin; touching the parent, `document.cookie` or storage throws; its requests carry no Lax cookie. The sandboxed document's relative assets arrive without cookies |
| lab 3 | CSP `<meta>` first in a srcdoc | 0/27 exfil channels to A and B; script cannot remove, loosen or bypass it with `document.open/write`. **It does not close self-navigation** |
| lab 4 | `blob:` URLs created by the parent | the sandboxed child cannot load them; it can load `data:` URLs |
| lab 6 | `<script src>` of A URLs whose body is valid JS, served as `text/plain`, `application/json` or `text/html`, from pages on A, B and C | without `nosniff`, the `text/plain` and `application/json` bodies execute on all three pages, cross-site C included; with `nosniff` none executes. The request reaches A in every case |
| lab 7 | Sandbox flags | each of `allow-same-origin`, `allow-popups(-to-escape-sandbox)`, `allow-top-navigation*` and `allow-forms` gives the frame a capability it must not have |
| lab 10 | A service worker on A at scope `/` with a navigation fallback | a sandboxed `srcdoc` child is not controlled by it (`navigator.serviceWorker` throws) and its requests go to the network; a sandboxed frame's navigation is never seen by the worker |
| E1 | Parent `frame-src 'none'` as a header **or** a `<meta>`, srcdoc child | The child renders and runs. Blocked: script navigation, `<meta refresh>`, navigation to A's `/api/...`, a link click. `frame-src 'self'` still lets it navigate to A's `/api/...` (without cookies, cross-site). With no parent CSP, all four reach their target |
| E3 | `MOCKUP_CSP` (5.6.4) with `data:` assets | png, SVG-in-img, css, ttf font, classic script, module script and import-mapped `data:` module all work; the SVG's own script does not run; an unrewritten relative `<img>` makes 0 requests; **0/27 to A and to B** |
| E4 | 1, 4 and 8 MiB PNG as `data:` in a srcdoc (up to 11.2 M chars) | rendered in 0.18, 1.24 and 1.35 s |
| E5 | Link clicks under parent `frame-src 'none'` | With no guard, any click kills the frame (srcdoc resolves `#x` against the parent URL). With the capture-phase guard the frame survives and fragment links scroll |
| E6 | SVG as `data:` and as `blob:` in the PWA's own `<img>`, then opened top-level | In `<img>` both paint, with 0 requests and no script. Top-level `data:` is opaque-origin. **Top-level `blob:image/svg+xml` runs as origin A, and its fetch carries the session cookie.** An `application/octet-stream` blob downloads |
| E7 | `Cross-Origin-Resource-Policy: same-origin` on a raster | A paints it; B (same-site) and C get width 0, but the requests still reach A, and B's request carries the cookie |
| E8 | An `image/png` response whose body is SVG with script, opened top-level | no script runs |
| E9 | Mockup CSP extended with exactly origin B | B's script runs; A and the unlisted C stay at 0/27; B gets no fetch, XHR, beacon, WebSocket or EventSource channel; no cookie anywhere |
| E10 | 3 s busy loop in a sandboxed srcdoc | the parent's 50 ms interval gap is at most 52 ms on desktop Chromium; mobile UNMEASURED |
| E11 | A blocked navigation | a second iframe `load` event fires |
| E12 | `DOMParser('text/html')` of hostile HTML | 0 requests, no handler or script runs, no refresh |
| E13 | `DOMParser('text/html')` of deeply nested `<div>`s on the main thread | **660 KiB froze the whole console about 14 s.** Cost grows faster than size and is spent inside the native parse, which cannot be aborted. A flat 2 MiB page of short elements parses in 66 ms, so no byte gate can bound this |
| F1 | Fastify encapsulated `onSend` | runs on the gate's 401/403 for plugin routes; replaces a `text/html` reply with a 500 JSON; forces `no-store` on a 404 that set `immutable`; runs on the default 500; does not run on unmatched paths or non-plugin routes |
| K1 | The four sections at each origin default branch (one reader's snapshot, 2026-09-29) | 1 012 md, **3 html** (17, 62, 119 KB), 1 png, 1 json, 3 py, 1 sql, **0 svg**. Of the 3 html: one is self-contained, one loads a hosted font stylesheet, and one draws charts with a library from a CDN and loads hosted fonts too. On disk only: an uncommitted 3D viewer with import maps and `.glb` files up to 39.6 MB, over every cap |

jsdom has no CSP, no sandbox and no srcdoc browsing context. Every claim about **effect** is therefore pinned by the real-browser leg (5.7). The jsdom and `inject` rows pin the artefacts that the browser rows run.

### 5.1 Content classes and the raster table (L0, `shared/docs.ts`)

```ts
export type DocContentClass = 'markdown' | 'raster' | 'svg' | 'html' | 'text' | 'other';
export const DOC_CONTENT_CLASS_BY_EXT = {
  md: 'markdown', markdown: 'markdown',
  png: 'raster', jpg: 'raster', jpeg: 'raster', gif: 'raster', webp: 'raster',
  svg: 'svg', html: 'html', htm: 'html',
  txt: 'text', json: 'text', yaml: 'text', yml: 'text', toml: 'text', csv: 'text', tsv: 'text', log: 'text',
  ts: 'text', tsx: 'text', js: 'text', mjs: 'text', cjs: 'text', css: 'text', py: 'text', sh: 'text',
  sql: 'text', diff: 'text', patch: 'text', xml: 'text', xsl: 'text', xhtml: 'text',
} as const satisfies Record<string, DocContentClass>;
export function contentClass(path: string): DocContentClass;

export const DOCS_RASTER_TYPES = {
  png:  { mime: 'image/png',  magic: [[{ at: 0, bytes: [0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a] }]] },
  jpeg: { mime: 'image/jpeg', magic: [[{ at: 0, bytes: [0xff,0xd8,0xff] }]] },
  gif:  { mime: 'image/gif',  magic: [[{ at: 0, bytes: [0x47,0x49,0x46,0x38,0x37,0x61] }], [{ at: 0, bytes: [0x47,0x49,0x46,0x38,0x39,0x61] }]] },
  webp: { mime: 'image/webp', magic: [[{ at: 0, bytes: [0x52,0x49,0x46,0x46] }, { at: 8, bytes: [0x57,0x45,0x42,0x50] }]] },
} as const;
export type RasterType = keyof typeof DOCS_RASTER_TYPES;
export type RasterMime = (typeof DOCS_RASTER_TYPES)[RasterType]['mime'];
export const DOCS_RASTER_EXT: Record<'png' | 'jpg' | 'jpeg' | 'gif' | 'webp', RasterType> =
  { png: 'png', jpg: 'jpeg', jpeg: 'jpeg', gif: 'gif', webp: 'webp' };
export function sniffRaster(declared: RasterType, bytes: Uint8Array): 'match' | 'mismatch';
```

- **Extension rule.** The extension is the text after the last `.` of the final path component. It is lowered ASCII-only (`A-Z` to `a-z`, never `toLowerCase()`) and must be 1-10 characters of `a-z 0-9`. Otherwise, or for a dotfile such as `.png`, the class is `other`.
- **Text, never a document.** `xml`, `xsl` and `xhtml` are **text**: rendered as source, never as a document. `pdf`, `mht`, `svgz`, fonts and anything unlisted are `other` (download only).
- **SVG is its own class.** In image mode it never runs script (E3, E6). That is strictly stronger than a frame whose scripts a tap can enable.
- **One table for both sides.** `contentClass` lives in L0, so the PWA picks its renderer from the same table the server uses to pick the representation. `server/src/docs/policy.ts` imports it and holds no copy.
- **Declared type must match the bytes.** A `.png` holding JPEG bytes is a `mismatch`: under `nosniff`, the declared type must be true of the bytes. `CLIP_MIME` (`server.ts:162-164`) stays where it is.

### 5.2 `GET /api/docs/:project/file`: two representations

§3 owns the query grammar and the `DocsFileResponse` envelope. The representation depends on `contentClass(pin.path)` alone.

Handler (`server/src/docs/routes.ts`; decisions in L1, the read in L3, the reply in L4):

1. Validate the pin (§3.4).
2. Set `cls = contentClass(pin.path)` and `cap = DOCS_CLASS_CAP[cls]` (§6.1).
3. Read: `r = await lanes.read(() => reader.show(pin, cap))`.
4. **Failure:** `reply.code(DOCS_FAILURE_HTTP[w]).send({ok:false, failure:w, ...context})`.
5. **`cls === 'raster'`:**
   - `t = DOCS_RASTER_EXT[ext]`, and `bytes` is the decoded show bytes (their `sha256` already checked, §2 (b) check 8).
   - If `rasterVerdict(t, bytes)` (L1, wraps `sniffRaster`) is `mismatch`: answer 422 `{ok:false, failure:'raster-mismatch', declared: t, size}` with no bytes.
   - Otherwise: `reply.code(200).type(DOCS_RASTER_TYPES[t].mime).header('cache-control', cacheControlFor(pin, cls)).send(Buffer.from(bytes))`.
6. **Every other class:** 200 `application/json; charset=utf-8` with `DocsFileResponse` and `cache-control: no-store`.

**`cacheControlFor(pin, cls)`** (L1) answers:

- `private, max-age=31536000, immutable` only for a committed pin of class raster, whose bytes are a pure function of `(commit, section, path)`;
- `no-store` for everything else.

JSON answers carry `onRef` and `from`, which are not a pure function of the URL: a force-push changes `onRef`. A year of browser caching would pin a stale banner. It replaces the approved "every committed file response immutable", as §2 (g)'s browser-cache rule already records.

Nothing on the docs routes ever sends `text/html`, `image/svg+xml`, any `*/xml`, `text/plain`, `application/octet-stream`, or a `Content-Disposition` header. 5.3 enforces that with a hook. The approved "octet-stream + attachment" option is done client-side (5.4).

### 5.3 Headers on every docs response (`server/src/docs/hooks.ts`, L4; values L0)

The header values live in `shared/docs.ts`, so the server hook and the browser leg use the same bytes:

```ts
export const DOCS_RESPONSE_CSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox; frame-ancestors 'none'";
export const DOCS_RESPONSE_HEADERS = {
  'x-content-type-options': 'nosniff',
  'content-security-policy': DOCS_RESPONSE_CSP,
  'referrer-policy': 'no-referrer',
  'cross-origin-resource-policy': 'same-origin',
} as const;
export const DOCS_ALLOWED_CONTENT_TYPES: readonly string[] =
  ['application/json; charset=utf-8', ...Object.values(DOCS_RASTER_TYPES).map((t) => t.mime)];
```

| Header | Why |
|---|---|
| `nosniff` | lab 6: without it, a `<script src>` of a JSON or text URL executes on any page that includes it, cross-site included; with it, none executes (the request still arrives) |
| CSP (approved string + `frame-ancestors 'none'`) | any top-level open of a docs URL is sandboxed; no docs URL is ever framed (mockups use srcdoc) |
| `Referrer-Policy: no-referrer` | the approved remedy from §2's adversarial review for unconstrained Markdown image and link URLs |
| CORP `same-origin` | E7: another origin's `<img>` of a docs raster paints nothing. The request still arrives, so §3.8's provenance guard remains the server-side wall |
| `Cache-Control` | 5.2 |

`installDocsResponsePolicy(app)` adds one `onSend` hook inside the docs plugin (§3.4):

```ts
app.addHook('onSend', async (_req, reply, payload) => {
  for (const [k, v] of Object.entries(DOCS_RESPONSE_HEADERS)) reply.header(k, v);
  const ct = String(reply.getHeader('content-type') ?? '');
  if (!DOCS_ALLOWED_CONTENT_TYPES.includes(ct)) {
    console.warn(`ccrc-server: docs response refused, content-type ${JSON.stringify(ct.slice(0, 80))}`);
    reply.removeHeader('content-length'); reply.removeHeader('content-disposition');
    reply.code(500).header('content-type', 'application/json; charset=utf-8').header('cache-control', 'no-store');
    return JSON.stringify({ ok: false, failure: 'response-type-refused' });
  }
  if (reply.statusCode !== 200 || reply.getHeader('cache-control') === undefined) reply.header('cache-control', 'no-store');
  return payload;
});
```

F1: the hook covers the gate's 401 and 403 on docs routes, and the default 500. It does not cover the root 404 for an unmatched `/api/docs/...` path, whose body is fixed JSON carrying no content.

These headers apply to docs routes only. The rest of the server gets a global baseline from a separate small PR after W3 (§7.6).

### 5.4 The PWA byte path (`pwa/src/lib/api.ts`, through `request`, so a 401 raises the overlay)

- **`docs.file(project, pin, signal) -> DocsFileAnswer`** serves every non-raster class. It refuses to be called for a raster path; that is an internal `wrong-representation` programming error.
- **`docs.raster(project, pin, signal) -> DocsRasterAnswer`** returns `{bytes: Uint8Array; mime: RasterMime}` or a failure. Two checks:
  - `res.headers.get('content-type')` must equal `DOCS_RASTER_TYPES[t].mime`, else the client word `unexpected-response {status, contentType}`;
  - `sniffRaster(t, bytes)` must match, else `raster-mismatch`.

  `mime` comes from the table, never from `Blob.type`.
- **Client-only words** live in `pwa/src/docs/failures.ts`: `unexpected-response` (also used for any error body that is not an envelope) and the slot states of §4.3.

**Object URLs.** `pwa/src/docs/objectUrls.ts` is the only `URL.createObjectURL` caller under `pwa/src/docs` and `pwa/src/lib/markdown*`:

- `rasterObjectUrl(bytes, mime)` builds `new Blob([bytes], {type: mime})`, and throws unless `mime` is one of the `DOCS_RASTER_TYPES` values.
- `downloadDocFile(project, pin, basename)` gets bytes through `docs.file` (or `docs.raster`) and builds `new Blob([bytes], {type: 'application/octet-stream'})` for **every** class. It clicks a detached `<a download>` and revokes the URL after 30 s. E6: an octet-stream blob downloads; it never renders.
- It **never** creates a `blob:` of `image/svg+xml`, `text/html` or any other active type. E6 measured the hazard: such a blob opened top-level is a same-origin document carrying the session.

### 5.5 SVG

- **In Markdown** (§4.11): `![](d.svg)` resolves to a pin. The PWA calls `docs.file` and renders `<img src="data:image/svg+xml;base64,...">`, never `blob:` and never `/api/`. E6: it paints, its script does not run, and its external references make no requests. Opened top-level, a `data:` SVG is opaque-origin.
- **Opened directly** (a leaf of class `svg`): the same `data:` image, fitted to the pane, with Source (the text renderer) and Download. No iframe and no scripted mode.
- **Inside a mockup:** inlined as `data:image/svg+xml` (E3).
- **Cap:** `DOCS_MAX_IMAGE_BYTES` (§6.1), checked against the listed size before any fetch.

### 5.6 The HTML mockup viewer

#### 5.6.1 The frame (`pwa/src/docs/MockupFrame.tsx`)

```tsx
<iframe key={mode + nonce} className="docs-mockup-frame" title={`Mockup: ${path}`}
        sandbox={mode === 'scripted' ? MOCKUP_SANDBOX_SCRIPTED : MOCKUP_SANDBOX_STATIC}
        srcDoc={srcdoc} referrerPolicy="no-referrer" csp={csp} onLoad={countLoad} />
```

- **Sandbox tokens.** `MOCKUP_SANDBOX_STATIC = ''` and `MOCKUP_SANDBOX_SCRIPTED = 'allow-scripts'` (`pwa/src/docs/mockup/policy.ts`). The attribute is always present, because an absent `sandbox` means no sandbox. No other token is ever used (`allow-same-origin`, `allow-popups`, `allow-popups-to-escape-sandbox`, `allow-top-navigation*`, `allow-forms`, `allow-modals`, `allow-downloads`; lab 7). No `src`, `name`, `allow` or `allowfullscreen`.
- **`csp` attribute.** This is Chromium's embedded enforcement; other browsers ignore it. It always equals the srcdoc `<meta>` policy, produced by the same function.
- **No message channel in either direction.** The parent never calls `postMessage` and never listens for `message`. That makes lab 3's "self-navigate, then receive `postMessage('*')`" moot.

**The parent wall.** `pwa/index.html` gains the line below immediately after `<meta charset="UTF-8" />` (line 4), preceded by an HTML comment naming this section:

```html
<meta http-equiv="Content-Security-Policy" content="frame-src 'none'" />
```

- **It works like a header.** E1: a `<meta>` behaves exactly like a header. It keeps the srcdoc frame alive and blocks every self-navigation, including one to A's own `/api/...`, which `'self'` would allow (on a box with auth not armed, that is an unauthenticated GET).
- **It travels with the bundle.** It ships inside the bundle bytes, so it holds on every install lane and through the service worker's precached shell. It does not depend on whether the precache replays response headers.
- **Never widen it.** The PWA has no iframe today (grep of `pwa/src` and `pwa/index.html`). Widening this meta re-opens the mockup's navigation channel for whatever it admits.

#### 5.6.2 How the HTML reaches the frame

1. **Fetch and decode.** Page bytes come from `docs.file(pagePin)`, class `html`, decoded with `TextDecoder('utf-8', {fatal: false})`. Base64 or replacement characters show a "not UTF-8" chip. The mockup's own `<meta charset>` is irrelevant, because srcdoc is a string.
2. **Pre-scan** with `prescanMockup(text)`, described below. On a refusal the viewer stops here, with zero DOMParser calls.
3. **Auto-render gate.** A page over `MOCKUP_AUTO_RENDER_BYTES` (1 MiB) shows "Render mockup · N KiB" and waits for the tap.
4. **Parse.** `parseMockup` (`mockup/parse.ts`, the only `new DOMParser(` in `pwa/src`) calls `new DOMParser().parseFromString(text, 'text/html')`. This is inert (E12). Nodes are never adopted into the live document; they are read and re-serialised.
5. **Plan, fetch, rewrite.** `planMockup` (5.6.3) runs, then the asset fetch, then the rewrite.
6. **Build.** `buildSrcdoc(...) = metaFor(csp) + MOCKUP_CLICK_GUARD + '<!doctype html>' + doc.documentElement.outerHTML`. The meta comes first in the byte stream, before the author's doctype; lab 3 shows the policy then applies before any author byte. A srcdoc document is never in quirks mode.
7. **Set.** React sets `srcDoc`; nothing is spliced as a string into the PWA's own HTML.

**The pre-scan** (`pwa/src/docs/mockup/prescan.ts`; limits in `mockup/policy.ts`). It follows the same pattern as §4.10's `prescanMarkdown`. It is the only guard that runs before the native parse, which cannot be aborted (E13):

```ts
export const MOCKUP_MAX_DEPTH = 256;
export const MOCKUP_MAX_TAGS = 20_000;
export type MockupPrescan =
  | { ok: true; depth: number; tags: number }
  | { ok: false; why: 'too-deep' | 'too-many-tags'; depth: number; tags: number };
export function prescanMockup(text: string): MockupPrescan;
export function parseMockup(text: string): { ok: true; doc: Document; prescan: MockupPrescan } | { ok: false; prescan: MockupPrescan };
```

- **How it counts.** One O(n) pass over the raw text:
  - `tags` counts every start tag and every end tag: `<` or `</` followed by an ASCII letter.
  - `depth` is the length of a stack of open element names. A start tag pushes its name unless it is a void element (`area base br col embed hr img input link meta source track wbr`). An end tag pops down through the nearest matching name, and is ignored when no name matches.
  - It skips nothing. Comments, attribute values and script text count too, so the scan errs toward refusing.
  - It stops as soon as either limit is exceeded.
- **The refusal.** "Too complex to render — shown as source", with the reason, the measured counts and both limits, the Source view and Download. There is no render-anyway control. `parseMockup` is the single call site, and it returns before constructing a parser.
- **The time budget.** W6 measures DOMParser in Chromium at the chosen thresholds, on the worst (deep) shape they admit. If that parse exceeds about 1 s, W6 lowers the thresholds. A lowered limit fails safe: a larger mockup shows as source and never freezes the console. M5.B8 then pins the budget in CI. W6 also records the depth and tag counts of the committed mockups (K1), counts only, to show the limits refuse none of them.
- **Caps on the page.** The html class cap is `DOCS_MAX_DOC_BYTES` (2 MiB), and the largest committed mockup is 119 KB (K1). The 1 MiB gate is about bytes only; the pre-scan is what bounds the parse.

#### 5.6.3 Relative assets

References resolve through L0 `resolveDocRef` (§4.11), which is shared with Markdown. Here, `self-contained` references (`data:`, `blob:`) are left in place: the frame's CSP allows `data:`, and a blob created by the parent cannot load in the child anyway (lab 4).

| Element | Attribute or text | Treatment |
|---|---|---|
| `img` | `src`, `srcset` (candidate by candidate; a candidate that fails to parse is dropped and listed) | image |
| `picture > source` | `srcset` | image |
| `video` | `poster` | image |
| `input[type=image]` | `src` | image |
| SVG `image`, `feImage` | `href`, `xlink:href` | image |
| `link` with rel token `stylesheet` | `href` | css |
| `script` | `src` | script, or module when `type=module`. A module's own relative imports cannot resolve from a `data:` URL and fail at runtime |
| `style` element, `style` attribute | `url(...)`, `@import` | resolved relative to the page |
| linked css text | `url(...)`, `@import` | resolved relative to the css file, depth at most `MOCKUP_MAX_CSS_DEPTH` = 3 |
| `a`, `area` | `href` | never rewritten; listed under Links (5.6.6) |
| `iframe`, `frame`, `object`, `embed`, `base`, `form[action]`, `meta[http-equiv=refresh]`, media and `track` `src`, `script[type=importmap]`, other `link` rels | — | `unsupported:'element'`; the CSP blocks them |

**CSS scanning** (`mockup/css.ts`) uses two patterns only:

- `url(...)` with an unquoted, single-quoted or double-quoted argument;
- `@import` followed by a quoted string.

Anything unmatched (escapes, comments, `image-set`) is left untouched, so it is blocked, never leaked. **The rewriter is a convenience and the CSP is the wall:** a form the rewriter misses fails closed, with the asset missing and no request made (E3).

**Asset MIME** (`MOCKUP_ASSET_MIME`, `policy.ts`), by extension:

- images: `DOCS_RASTER_TYPES`, plus `svg` as `image/svg+xml`;
- `css` as `text/css`;
- `js`/`mjs` as `text/javascript`;
- `woff2`, `woff`, `ttf`, `otf` as `font/*`.

An extension outside the table, or one that does not fit its element, is `unsupported:'kind'`. The `data:` MIME always comes from this table, never from a response.

**Pins** (the §2 asset rule, from this visit's tree answer):

- **Committed page at C:** an asset is `CommittedPin(C, served, s, p)` iff its `committed.kind` is file or exec. Draft entries are ignored. Otherwise the asset is `missing:'absent-at-commit'`.
- **Draft page:** this happens only under `?ref=`, with one trusted holder and `baseEqual`, so H = C.
  - An admitted `modified`, `added`, `untracked` or `conflicted` draft with `fp` is a `DraftPin` (counted in `draftAssets`).
  - `deleted` is `missing:'deleted-in-worktree'`.
  - `typechange`, withheld, or `fp: null` is `missing:'draft-withheld'`, never a silent fallback (a typechange draft is never read, §2 (d)).
  - An asset with no draft is `CommittedPin(C, served, s, p)` iff its `committed.kind` is file or exec; otherwise it is `missing:'absent-at-commit'`.

```ts
type MockupRefVerdict =
  | { v: 'inline'; pin: DocPin; kind: 'image' | 'css' | 'script' | 'module' | 'font'; mime: string; size: number; draft: boolean }
  | { v: 'kept'; why: 'fragment' | 'self-contained' }
  | { v: 'external'; origin: string }
  | { v: 'refused'; why: string }            // DocRefResolution's refused whys
  | { v: 'missing'; why: 'absent-at-commit' | 'deleted-in-worktree' | 'draft-withheld' }
  | { v: 'unsupported'; why: 'kind' | 'element' | 'css-depth' }
  | { v: 'skipped'; why: 'too-large' | 'over-budget' }
  | { v: 'failed'; failure: string };
```

**Budgets.** All are decided from listed sizes **before any fetch**, in DOM order and then CSS discovery order. A duplicate is fetched and counted once.

- `MOCKUP_MAX_ASSETS` = 64.
- `MOCKUP_MAX_ASSET_BYTES` = 5 MiB in total. The worst srcdoc is then about a 2 MiB page plus 5 MiB of base64 assets, about 9.1 M chars, inside the 11.2 M measured to render (E4).
- An image over `DOCS_MAX_IMAGE_BYTES`, or any asset over its class cap, is `skipped:'too-large'`.

**Loader** (`mockup/load.ts`):

- It goes through the per-screen fetch queue shared with §4 (concurrency 2), with an `AbortController` that fires on unmount.
- Rasters are fetched via `docs.raster`, everything else via `docs.file`. There is no prefetch.
- A `draft-changed`, `worktree-moved`, `worktree-gone` or `unknown-commit` on any asset triggers one re-list and re-plan (§2 (e)). A second such failure renders those rows `failed`, with "changing, retry".

#### 5.6.4 Outbound network

```ts
export const MOCKUP_CSP = "default-src 'none'; script-src 'unsafe-inline' data:; style-src 'unsafe-inline' data:; img-src data: blob:; font-src data:; media-src data: blob:; base-uri 'none'; form-action 'none'";
export function mockupCsp(extra: readonly HttpsOrigin[]): string;   // extra is [] unless the viewer tapped Load external in this view
```

- **The base policy.** Measured 0/27 to A and to B, with every inlined kind working (E3). `connect-src`, `frame-src`, `worker-src`, `object-src` and `manifest-src` fall back to `'none'`. `'self'` never appears, because from a srcdoc it means the ccrc origin.
- **External origins, one view at a time** (`mockup/origins.ts`; ruling U2):
  - Until the viewer taps, external references stay blocked. Each is listed in the census with its origin and the hint "or vendor it next to the mockup".
  - **Load external (N)** opens a confirm sheet that lists the N origins: "those sites will see that you opened this". Confirming re-mounts the frame with `mockupCsp(origins)` for this view only.
  - The choice is never remembered: no storage, no URL key. A remount, a reload or another visit returns to `MOCKUP_CSP`.
- **Origin validation.** `parseHttpsOrigin(url)` accepts only an exact `https` origin whose host contains a dot, is not an IP literal, is not `localhost` or `*.localhost`, and is not `location.hostname` at any port. The branded value holds no space, `;`, `'` or `*`. `mockupCsp` appends each origin to `script-src`, `style-src`, `img-src` and `font-src` only, never to `connect-src` or `default-src` (E9).

#### 5.6.5 Scripts off by default

- **First render is static.** Every mockup first renders with `sandbox=""`. E1: no script runs and `<meta refresh>` is refused.
- **Run and Stop.** When `plan.scripted` is true, the toolbar shows **Run scripts**, which re-mounts the frame with `allow-scripts`; **Stop scripts** re-mounts it static. `plan.scripted` is true for any `script` element, any `on*` attribute, a `javascript:` URL in href/src/action/formaction, or a refresh meta.
- **Never remembered.** The choice is not stored and has no URL key. A reload never re-runs hostile script, and a busy loop needs a tap to start.
- **UX only.** The detector is a convenience: a script it misses leaves the mockup static with no button.
- **Phone isolation is measured in W6.** E10 shows desktop isolation; mobile is UNMEASURED. W6's manual phone pass therefore includes a busy-loop mockup fixture, run with Run scripts.
- **Contingency `mockup-scripts-confirm`.** If the phone does not isolate the sandboxed frame (the console stops answering while the frame spins), Run scripts gains a confirm step that says the mockup's scripts may slow the console. Stop scripts then becomes a prominent control that stays in view above the frame. This lands as a W6 fix before W6 merges.

#### 5.6.6 Links and navigation inside the mockup

`MOCKUP_CLICK_GUARD` is injected second, right after the CSP meta (E5):

```html
<script>document.addEventListener('click',function(e){var a=e.target&&e.target.closest&&e.target.closest('a[href],area[href]');if(!a)return;e.preventDefault();var h=a.getAttribute('href')||'';if(h.charAt(0)==='#'&&h.length>1){var id=decodeURIComponent(h.slice(1));var t=document.getElementById(id)||document.getElementsByName(id)[0];if(t)t.scrollIntoView();}},true);</script>
```

- **The guard.** In scripted mode it keeps the frame alive and makes fragment links scroll. It is UX, not security: the parent's `frame-src 'none'` still blocks the navigation.
- **Load watcher.** A second `load` event means a blocked navigation (E11). The viewer overlays "This mockup tried to navigate away; links inside mockups do not open." with Reload mockup, and never re-mounts on its own.
- **Links list.** Each `a[href]`/`area[href]` goes through `resolveDocRef`:
  - `doc` renders as an in-app route (same project and `ref`, `docsPageUrl`);
  - `external` http(s) opens through `openExternal` on tap;
  - anything else shows as text.

#### 5.6.7 UX (`pwa/src/docs/MockupView.tsx`)

Top to bottom:

1. **Header:** §4's leaf header.
2. **Badges:** "embeds N uncommitted assets" on draft pages, "scripts off" when the page has scripts and the frame is static, and "N not loaded".
3. **Toolbar** (every button `min-height: var(--tap-min)`): Run/Stop scripts; Load external (N), shown when the plan lists at least one external origin (5.6.4); Full screen; New tab; Source; Download.
4. **Frame:** `70dvh`, full width, background `var(--mockup-canvas)`. This is a new token that is white in both themes, because srcdoc is transparent and mockups are authored on white.
5. **Census:** collapsed by default ("Assets and references · 12 loaded · 3 not loaded"), one row per reference showing:
   - the ref as text (cut to 120 chars, non-ASCII marked);
   - its target or origin;
   - `MOCKUP_VERDICT_SENTENCE[verdict]` (exhaustive by type);
   - size, and a draft chip.

   In-section targets link to their leaf. Each embed is marked here, in PWA chrome that the frame cannot paint over.

A page the pre-scan refuses shows the header, the refusal line, Source and Download, with no frame and no census.

- **Full screen** is the leaf URL with `frame=full` (§3.1): a thin bar with Close, and the frame at `100dvh`. Close goes `history.back()` when the previous history entry is this leaf; otherwise it navigates to the leaf.
- **New tab** is `window.open(fullUrl, '_blank', 'noopener,noreferrer')`. The new top-level document is the ccrc shell, which re-resolves the page as a new visit (pre-scan included) and renders the same sandboxed srcdoc. No URL exists whose top-level document is the mockup, and the toolbar never offers an `/api/docs/...` link.
- **Source** is the HTML as text (hljs `xml` under the 64 Ki-char rule). **Download** is `downloadDocFile`. **Open committed version** on a draft mockup renders the committed page at C with committed assets only.

#### 5.6.8 Failures

| Case | What the viewer shows |
|---|---|
| The page fetch fails | the failure word inline, header kept |
| The pre-scan refuses | the refusal line with Source and Download, and no parse |
| An asset fails | its census row reads `failed`; the frame still renders |
| A budget or kind refusal | a census row, and no request |
| A render error | §4's boundary |
| Offline | the shell only |

### 5.7 The real-browser leg (U4)

- **Package.** `pwa/` gains `playwright-core` as an exact-version devDependency (it downloads no browser) and `pwa/vitest.browser.config.ts`:
  - `include: ['browser/**/*.browser.test.{ts,tsx}']`;
  - a jsdom environment for DOMParser and React rendering inside the harness;
  - `testTimeout: 60000`.

  It also gains `"test:browser": "vitest run --config vitest.browser.config.ts"`.
- **Keeping it out of the hermetic run.** The hermetic config's `test` block (`pwa/vite.config.ts:84-92`) gains `exclude: [...configDefaults.exclude, 'browser/**']`. `pwa/test/browser-leg.test.ts` pins that the default config excludes the browser files and that the browser config includes at least one.
- **Chrome.** Chrome resolves from `CCRC_CHROME`, else `/usr/bin/google-chrome`. If neither exists, `beforeAll` **throws**: the leg goes red, never skipped.
- **Origins.** The harness serves origins A and B on loopback (same-site) and C on `localhost` (cross-site), on ephemeral ports. Server-side rows serve the fixture with `DOCS_RESPONSE_HEADERS` from `shared/docs.ts` over plain `node:http`, so the leg needs no Fastify. The `inject` rows (M5.4-M5.6) prove the hook applies exactly those values.
- **CI job.** `ci.yml` gains a job `browser-pwa`, named `browser (pwa)`:
  - `runs-on: ubuntu-latest`, with a `timeout-minutes` (15) as `oss-metadata.test.ts:158-185` requires;
  - the `CCRC_LEG` step-skip idiom of `test` and `build-pwa`;
  - steps: checkout, setup-node 22, `npm ci` in `pwa/`, then `./node_modules/.bin/vitest run --config vitest.browser.config.ts`.
- **It is required.** It runs on every PR and is a required leg of `full-suite`: it joins `full-suite.needs` (`ci.yml:859`) and its `RESULTS` string. `verdict.mjs` therefore fails the daily run and the stable gate on a red browser leg.
- **Manual phone pass.** Before the feature is called done, W6 includes one manual pass of the M5.B fixtures on the operator's phone (WebKit is not in the leg), plus the busy-loop fixture of 5.6.5.

### 5.8 Mutation rows (§5)

**Server (`inject`: `docs-file-bytes.test.ts`, `docs-headers.test.ts`, `docs-policy.test.ts`)**

| # | Guard | Test | Mutation that goes red |
|---|---|---|---|
| M5.1 | Representation by class | a stub reader serves `a.png` (PNG magic), `a.md`, `a.svg`, `a.html`, `a.json`, `a.woff2`, `a.pdf` and `a`: only `.png` answers 200 `image/png` with the bytes; the rest answer 200 JSON with the right `contentClass` | make `svg` or `html` raw (each alone) |
| M5.2 | Magic check | a 4x4 (declared, actual) matrix plus SVG bytes, empty and 3-byte files: only the diagonal is 200; every other cell is 422 `raster-mismatch`, `no-store`, with no raster bytes | skip `rasterVerdict`; accept any raster magic |
| M5.3 | `contentClass` | `A.PNG` raster, `x.png.html` html, `.png` other, `x.` other, non-ASCII extension other, `x.svgz` other, `x.xhtml` text, `x.svg` svg | `toLowerCase()`; use the first extension |
| M5.4 | Headers everywhere | for every route in Fastify's route table under `/api/docs/` (derived, not hand-kept), under a 200, a 4xx, a 5xx, an armed no-cookie 401, an armed POST with a foreign `Origin` (403) and a provenance 403: all four headers with exact values | delete the hook; delete one header; register a docs route outside the plugin |
| M5.5 | Type wall | the hook on a bare Fastify with planted routes sending `text/html`, `text/html; charset=utf-8`, `image/svg+xml`, `text/plain`, `application/octet-stream` and `application/xml`: each answers 500 `response-type-refused`, `no-store`, with no `content-disposition`; PNG and JSON pass | drop the allowlist; widen it to an `image/` prefix |
| M5.6 | Cache | a committed raster 200 is `immutable`; a committed JSON 200, draft 200s and every failure are `no-store`; a planted route setting `immutable` on a 404 answers `no-store` | drop the status branch; `immutable` on JSON or a draft |

**PWA (jsdom: `docs-resolve.test.ts`, `docs-mockup-plan.test.ts`, `docs-mockup-build.test.ts`, `docs-mockup-frame.test.tsx`, `docs-mockup-prescan.test.ts`, `docs-bytes.test.ts`, `index-csp.test.ts`, `docs-scans.test.ts`)**

| # | Guard | Test | Mutation that goes red |
|---|---|---|---|
| M5.7 | Resolver | about 30 rows: a tab or newline inside `javascript:`, a leading space, `HTTPS://h/x`, `//h/x`, backslash forms, `/api/x`, `%2e%2e/%2e%2e/x`, `../../README.md`, `a/../../../../x`, `x.png?q#f`, `#f`, `data:`, `blob:`, `mailto:`, `specs/a.md` from plans | skip the trim; accept a backslash; skip section containment; decode twice |
| M5.8 | Asset rule | a tree with `a` committed, `b` modified and admitted, `c` deleted, `d` untracked, `e` withheld. Committed page: `a`, `b`, `c`, `e` committed and `d` missing. Draft page: `a` committed, `b` and `d` as DraftPins (`draftAssets` 2), `c` deleted-in-worktree, `e` draft-withheld | draft pins on a committed page; a committed fallback for a withheld draft |
| M5.9 | Budgets before fetch | the 65th image is `over-budget`; past 5 MiB is `over-budget`; an image over its cap is `too-large`; the api spy sees zero calls for non-inline rows; a duplicate is fetched once | fetch then check; drop dedup |
| M5.10 | Prefix | `buildSrcdoc` starts with `metaFor(csp)` then `MOCKUP_CLICK_GUARD`, each once, before any other byte | append them; omit the guard |
| M5.11 | MIME from the table | each inlined value is `data:<MOCKUP_ASSET_MIME[ext]>;base64,...` and decodes to the fixture | take the MIME from the response or `Blob.type` |
| M5.12 | CSS | `url()`/`@import` resolve relative to the css file; depth 4 is `css-depth`; unmatched forms are untouched and never fetched | resolve relative to the page; drop the depth bound |
| M5.13 | Frame attributes | static: `sandbox` present and empty; scripted: tokens exactly `['allow-scripts']`; `srcdoc` set; no `src`, `name`, `allow`, `allowfullscreen`; `referrerpolicy=no-referrer`; `csp` equals the meta | each forbidden token alone; `src=`; drop `sandbox` |
| M5.14 | Scripts off | the first render is static; Run scripts re-mounts scripted; remounting DocsScreen is static; no storage is written | start scripted; persist the choice |
| M5.15 | Load watcher | two `load` events show the notice without a re-mount | re-mount automatically |
| M5.16 | Source scans with planted controls | in `pwa/src`: none of the forbidden sandbox tokens; `<iframe` and `srcDoc` only in `MockupFrame.tsx`; `new DOMParser(` only in `docs/mockup/parse.ts`; no `postMessage(` and no `'message'` listener in `pwa/src/docs` or `lib/markdown*`; `URL.createObjectURL(` only in `docs/objectUrls.ts` and the existing `session/useAttachImage.ts`; `default-src 'none'` only in `mockup/policy.ts` | add any of them |
| M5.17 | Object-URL types | `rasterObjectUrl(b, 'image/svg+xml')` throws; the output type is canonical; `downloadDocFile` builds octet-stream for all six classes | pass the input type through |
| M5.18 | Raster client check | a 200 `text/html` with PNG bytes gives `unexpected-response`; a 200 `image/png` with GIF bytes gives `raster-mismatch` | drop either check |
| M5.19 | Parent meta | `pwa/index.html` has exactly one CSP meta, with content exactly `frame-src 'none'`, in `<head>` before the module script; the `build-pwa` job greps `server/dist-pwa/index.html` for exactly one | remove it; `'self'`; move it to body; a build transform drops it |
| M5.20 | SVG as `data:` | Markdown `![](d.svg)` and an svg leaf render `img[src^="data:image/svg+xml;base64,"]`, never `blob:` or `/api/` | use an object URL |
| M5.21 | External opt-in | `parseHttpsOrigin` accepts `https://a.example` and `:8443`; refuses `http://`, wildcards, `;`/`'` injections, IP literals, `localhost`, `a.localhost`, single labels and `location.hostname`; the re-tokenised `mockupCsp` has no `connect-src`/`frame-src`, has `base-uri`/`form-action` `'none'`, and has the origins only in the four directives; Load external shows the confirm sheet listing exactly the plan's origins; a remount returns to the base CSP and nothing is stored | append to `default-src`; skip the validator; persist the choice; skip the sheet |
| M5.22 | Pre-scan before parse | a deep-nested-div fixture gives `{ok:false, why:'too-deep'}` and a spy on `DOMParser.prototype.parseFromString` sees **zero** calls; a fixture with `MOCKUP_MAX_TAGS + 1` tags gives `too-many-tags`, also with zero calls; fixtures exactly at each limit are admitted and parsed once; the refusal renders Source and Download and no render control | parse before the pre-scan; drop either limit; offer render-anyway |

**Real browser (5.7).** Each row runs production artefacts: `buildSrcdoc`, `MockupFrame` via `renderToStaticMarkup`, the meta extracted from `pwa/index.html`, `parseMockup`, and `DOCS_RESPONSE_HEADERS`.

| # | Property | Row | Control |
|---|---|---|---|
| M5.B1 | Frame CSP wall | a 27-channel battery fixture plus an unrewritten relative `<img>`, scripted: 0/27 to A and B; inlined png, svg, css, font, script and module load | the same fixture without the meta reaches B on at least 20/27 |
| M5.B2 | Parent wall | child script navigation, refresh and link click to B, and navigation to A `/api/x`: nothing reaches either server | without the meta, B is reached; with `'self'`, A `/api/x` is reached |
| M5.B3 | Click guard | a fragment click scrolls and the fixture's liveness beacon continues | without the guard the frame dies |
| M5.B4 | Static mode | `sandbox=""`: no script runs, refresh is refused | scripted mode runs the script |
| M5.B5 | SVG | a `data:` SVG in the page: no script, no requests | a top-level `blob:image/svg+xml` runs as A with the cookie |
| M5.B6 | Docs headers | pages B and C `<img>` a docs raster: width 0; an SVG body labelled `image/png` opened top-level runs no script; B's `<script src>` of a JSON docs response does not execute | without CORP both widths are 1; without nosniff the script runs |
| M5.B7 | External opt-in | listed B's script runs; A and unlisted C stay at 0/27; B gets no connect channel | — |
| M5.B8 | Parse budget | DOMParser in Chromium on the worst deep shape `prescanMockup` admits at `MOCKUP_MAX_DEPTH` and `MOCKUP_MAX_TAGS` finishes in at most 1 000 ms | the 660 KiB nested-div fixture of E13, parsed directly, exceeds 1 000 ms (proving the timer can see the hazard); through `parseMockup` it is refused with zero parses |

## §6 Link protection, caching & limits

In remote mode, every docs byte crosses the one agent WebSocket that pty, tail and exec share. This section bounds three things: what docs may put on that socket, what the server caches, and what the browser may cache. File:line citations into this repo are as measured at `c62e22b9a`.

### 6.0 Measurements

**Corpus** (read-only git, 16 repos):

| Scope | Result |
|---|---|
| Default refs (a second reader's snapshot over 16 repos, 2026-09-29; the corpus drifts, so the two snapshots differ) | 973 files: 963 markdown (p50 29 042 B, p99 707 841, max 1 300 991), 1 raster (381 792 B), 3 html (max 118 838), 6 other |
| Largest tree at a default ref | 223 entries = 47 124 B of JSON, 52 124 B once framed by the agent (x1.106) |
| All 1 702 branch tips | 1 575 distinct markdown blobs, max 1 368 167; 12 over 1 MiB, **0 over 2 MiB**; at most 227 entries per tip |
| Working trees | 47 330 markdown files, max 1 369 490 |
| Working-tree PNGs in sections | 403 files: p50 742 274, p95 2 284 637, max 6 562 870. Over 1 MiB: 27.3%; over 2 MiB: 6.7%; over 4 MiB: 1.5% |
| Working-tree other | `.glb` up to 39 645 840 B |

**Head-of-line blocking.** Rig: a real agent, with `connectFleet` and `ws` joined by a userland throttle proxy in one process, and a fake ccd answering base64 through an existing grant. Metric: the pty echo round trip while answers cross.

| Load | Loopback | 12.5 MB/s (100 Mbit) | 3.1 MB/s (25 Mbit) |
|---|---|---|---|
| baseline | p95 1 ms | p95 3 | p95 5 |
| 1 x 4 MiB (5.6 MB frame) | max 36 | **max 468** | max 1 836 |
| 1 x 2 MiB | 7 | **268** | 930 |
| 1 x 1 MiB | 6 | **152** | 441 |
| 12 x 2 MiB, unbounded | 130 | **2 022** | 5 389 |
| 12 x 2 MiB, one at a time | 20 | **277** | 943 |

HOL is linear in the bytes queued ahead of the console frame: about bytes / rate, plus 20-36 ms of CPU per 4 MB.

**Double escape.** The approved singly-escaped rule picked `utf8` for a 3 MiB text in which every third character is `"`. But the agent's `JSON.stringify` of that stdout is a 6 291 617 B frame, against 4 194 466 B for base64, at 3-4x the event-loop cost.

### 6.1 Size classes and caps (`shared/docs.ts`; ccd holds parity copies only where ccd enforces)

| Constant | Value | Enforced by | Evidence |
|---|---|---|---|
| `DOCS_MAX_FILE_BYTES` | 4 MiB (§2) | ccd, as the ceiling; also the bound on the draft `fp` read | — |
| `DOCS_MAX_DOC_BYTES` | **2 MiB** | the server asks, ccd refuses | markdown, html, text, other; 0 of 1 575 blobs over 2 MiB |
| `DOCS_MAX_IMAGE_BYTES` | **2 MiB** (U1) | the server asks, ccd refuses | raster, svg; covers 93.3% of working-tree PNGs and every committed one |
| `DOCS_CLASS_CAP` | `Record<DocContentClass, number>`, derived from the two above | server and PWA | the PWA shows `too-large` from the listed size without a request |
| `DOCS_MAX_LISTING_WIRE_BYTES` | **1 MiB** framed | ccd (tree and index) | about 20x the largest measured tree |
| `DOCS_ENVELOPE_RESERVE` | 64 KiB (§2) | — | — |
| `DOCS_MAX_ANSWER_BYTES` | 6 MiB (§2) | ccd's final show guard | — |
| `DOCS_MAX_IMAGES_PER_PAGE` | 30 | PWA (§4.11) | real max 9 |

**Why images are capped at 2 MiB (U1), the same as documents:**

- Every PNG over 2 MiB on the fleet is gitignored evidence that Docs never lists. The largest committed PNG is 0.36 MiB.
- A 10 MiB cap would exceed the agent's 8 MiB exec buffer, and would stall terminals by about 1.1 s per image at 100 Mbit.
- Transcoding to WebP on the fleet box was rejected, because it would mean:
  - native decoding of untrusted images outside the browser sandbox;
  - decompression-bomb memory risk on the box that runs the sessions;
  - a new dependency;
  - a GET doing heavy work;
  - pixels that differ from the repo's.
- A future need for larger images is met by a chunked `docs-show-range` verb (6.7), never by a bigger cap.

**`docs-show --max-bytes N` (amends §2 (a)).**

- The server passes `N = DOCS_CLASS_CAP[contentClass(path)]`.
- ccd uses `min(N, DOCS_MAX_FILE_BYTES)` and answers `too-large {size, cap}` with `cap = min(N, DOCS_MAX_FILE_BYTES)` (which is N whenever the server sent a class cap) **before** any `cat-file` or read, from the `ls-tree --long` size or `fstat`.
- N's grammar is 1-8 digits with no leading zero. ccd still holds no extension list.

With §2's `--ref <servedRef>`, the exact argv is:

- committed: `docs-show --project P --commit C --ref R --section S --path X --max-bytes N` (12 tokens after the verb);
- draft: `docs-show --project P --draft-branch B --head H --section S --path X --fingerprint F --max-bytes N` (14).

The final arity ships in W1, so `docs-v1` names one argv shape. The helper reads every value by fixed index (§2).

**Listing bound (amends §2 (b)).** For tree and index, the helper's final guard computes the framed length, `len(json.dumps(line, ensure_ascii=False).encode())`. Above `DOCS_MAX_LISTING_WIRE_BYTES` it refuses with `too-many-entries {count, bytes}`. `DOCS_MAX_ENTRIES` still applies.

**Encoding rule (amends §2 (f)).** `utf8` is chosen iff `framed(utf8 line) <= framed(base64 line)`, together with the NUL and strict-UTF-8 conditions. So `framed(show) <= 4 x ceil(size / 3) + DOCS_ENVELOPE_RESERVE` always holds. For prose, utf8 still wins (3.86 MB against 4.19 MB for a 3 MiB doc).

### 6.2 Wire estimates (L1, `server/src/docs/policy.ts`)

```ts
export function showRawBound(classCap: number, knownSize: number | undefined): number
  { return Math.min(classCap, knownSize ?? classCap); }
export function showWire(raw: number): number { return 4 * Math.ceil(raw / 3) + DOCS_ENVELOPE_RESERVE; }
export const LISTING_JOB = { raw: DOCS_MAX_LISTING_WIRE_BYTES, wire: DOCS_MAX_LISTING_WIRE_BYTES };
```

- **`knownSize` comes only from facts the server holds**, never from the request:
  - for a committed pin, the listing-map entry (6.5);
  - for a draft, an `fp -> size` map fed from tree answers. It is bounded at 10 000 entries, and because `fp` is the sha256 of the bytes, the size never changes.
- **Adapter check 9** (`ccdsource.ts`, after §2's check 8): if `Buffer.byteLength(stdout) > job.wire`, the answer is `malformed-answer {why:'oversize'}` with `console.warn('ccrc-server: docs answer over its declared bound')`. The framed bound itself is ccd's contract, pinned by ccd tests.

### 6.3 Read lane (`server/src/docs/lane.ts`, L4; decision L1 `laneAdmit`)

```ts
export interface LaneLoad { execs: number; bytes: number; large: number }
export function laneAdmit(load: LaneLoad, job: { raw: number; wire: number }): boolean {
  if (load.execs === 0) return true;                                   // an idle lane always admits one
  if (load.execs >= DOCS_LANE_EXECS) return false;                     // 2 (§2)
  if (load.bytes + job.wire > DOCS_LANE_BYTES) return false;           // 3 MiB framed
  if (job.raw > DOCS_LANE_LARGE_RAW && load.large > 0) return false;   // at most one answer over 1 MiB
  return true;
}
```

- **Scope.** One lane per node (per agent link), covering index, tree and show. Cache hits bypass it.
- **Strict FIFO.** A head job that cannot be admitted blocks everything behind it, so a large job cannot starve.
  - `DOCS_LANE_QUEUE = 32`, derived by test from `DOCS_MAX_IMAGES_PER_PAGE + 2`. The approved 16 was smaller than one page's images.
  - `DOCS_LANE_MAX_WAIT_MS = 10 000`.
  - A full queue or an expired wait gives `docs-busy {lane:'read', retryAfterMs: 2000}`.
  - A queued job whose request closed (`req.raw` `close`) is removed. A running exec is not cancelled, because the agent has no cancel op.
- **Derived inequalities (tested):**
  - `showWire(max(DOCS_MAX_DOC_BYTES, DOCS_MAX_IMAGE_BYTES)) = 2 861 740 <= DOCS_LANE_BYTES = 3 145 728`, so any single answer fits the budget alone;
  - `DOCS_MAX_LISTING_WIRE_BYTES <= DOCS_LANE_BYTES`.
- **The bound this buys.** Docs bytes queued on the socket ahead of a console frame are at most `DOCS_LANE_BYTES`. HOL is therefore at most about `DOCS_LANE_BYTES / link rate`: 252 ms at 100 Mbit, where the lab's one-at-a-time row measured 277 ms max. R1 (6.9) measures this bound on the real link. If R1 fails, the remedy is `docs-chunked-reads`, never a smaller `DOCS_LANE_BYTES`, because one frame is the unit of head-of-line blocking.
- **Tightened from the approved 8 MiB.** The approved "at most 8 MiB in flight" becomes 3 MiB. With 2 execs, 8 MiB never binds, and 8 MiB is about 670 ms of HOL at 100 Mbit.
- **The PWA side.** The PWA runs at most 2 docs fetches per screen and never prefetches (§4.11).

### 6.4 Fetch lane and single-flight

- **Fetch lane** (L4):
  - a `KeyedQueue` (`server/src/inject/queue.ts:6`) per (node, project);
  - a global semaphore of `DOCS_FETCH_GLOBAL = 2`, with a queue of 8 and a 20 s wait;
  - beyond that, `docs-busy {lane:'fetch', retryAfterMs: 5000}`.

  Fetch answers are tiny and take no read-lane bytes; the follow-up tree uses the read lane.
- **Single-flight.** Requests join before the lanes:
  - tree, by (node, project, ref text or none, **gen**);
  - show, by the node-prefixed full pin string plus `N`;
  - refresh, by (node, project, branch or default).

  `gen` is a per-(node, project) counter bumped when a fetch completes, so a refresh's tree never joins a flight that started before the fetch.
- **Index micro-cache.** The index's 30 s micro-cache (§2) is per node, and is dropped when any refresh completes.

### 6.5 Committed cache and listing map (`server/src/docs/cache.ts`, L4; keys from L1)

- **`CommittedBlobCache`.** An LRU keyed `node NUL repoKey NUL blob`, with a budget of `DOCS_CACHE_BYTES = 64 MiB` of `Buffer.byteLength`.
  - It is filled **only** from ok committed show answers that passed checks 8 and 9.
  - Failures and negatives are never cached.
  - `repoKey` comes from the listing map; with no listing-map entry, the answer is served but not cached.
- **`ListingMap`.** `(node, project, commit) -> {repoKey, entries: section NUL path -> {blob, size, kind}, refsAt: servedRef -> recordedAtMs}`, fed from every ok tree answer the server forwards. It is an LRU by commit, holding at most `DOCS_LISTING_MAP_ENTRIES = 50 000` entries in total.
- **Committed hit path.** Look up the listing map, then the blob, then the cache.
  - If `servedRef` is in `refsAt` and was recorded less than `DOCS_LISTING_PROVENANCE_MS` ago (= `DOCS_STALE_MS`, 600 000, derived), answer with zero execs, as `onRef:'contains'`, `from:'cache'`.
  - Otherwise run `docs-show`, which fills the cache and returns ccd's own `onRef`.
- **Never cached.** Drafts, tree answers and refresh answers are never cached (§2). Drafts feed only the `fp -> size` map.

### 6.6 Browser cache

| Response | `Cache-Control` |
|---|---|
| raw raster 200, committed pin | `private, max-age=31536000, immutable` |
| raw raster 200, draft pin | `no-store` |
| every JSON response, 200 or failure | `no-store` |
| every failure, any status | `no-store` |

There is no ETag or 304 handling (none exists in `server.ts`). Re-opening a committed doc costs only the bytes from server to browser: a server cache hit with zero agent execs. §5.3's hook enforces this table.

### 6.7 Chunking: not in v1

HOL is linear in frame bytes, and the lane bounds it to one frame plus the budget. With 2 MiB class caps, the largest frame is 2.86 MB (268 ms measured at 100 Mbit), and no committed markdown blob exceeds 2 MiB.

Chunking would be costly:

- an exec per 512 KiB, with a floor of 100-150 ms each;
- per-chunk re-verification;
- no transport-level shortcut without an agent protocol change. Fragments of one WebSocket message cannot interleave, and the agent answers each `req` with one `send` (`agent/src/server.ts:182`, `:829`).

**Seam.** Chunking arrives as a separate verb, `docs-show-range`, under its own cap token. It arrives in two cases: when R1 fails (6.9), or when larger images are wanted (U1). v1's argv and grants never change.

### 6.8 "Docs never starves the console": `server/test/docs-console-latency.test.ts`

- **Setup:**
  - `makeFixture()` and `bootAgent(fixture, {spawnPty: echoPty})` (`remoteHelpers.ts`);
  - a fixture ccd at `<home>/.local/bin/ccd` (`resolveSpawnCmd`, `agent/src/server.ts:258-260`). It is a python script that answers `caps` with the docs verbs and `docs-v1`, answers `docs-tree` with a canned 13-entry listing, and answers `docs-show` with random bytes of the size named in the path (behind the PNG signature for a `.png`, so `rasterVerdict` matches and the file route answers 200), echoing the pin and sha256 so check 8 passes;
  - a new helper, `server/test/throttledLink.ts: throttledProxy(targetPort, 12_500_000)` (time-based credit, 2 ms flush);
  - `connectFleet` through the proxy, and `buildServer` with `ccdRunner(fleet.runner, cfg)` and `fleet.state`.
- **Probes, throughout:** pty echo every 25 ms through `fleet.spawnPty`, and `fleet.client.caps()` every 100 ms.
- **Load:** a tree GET, then, concurrently, one 2 MiB `.md` and twelve 2 MiB `.png`, each sent with the marker and `sec-fetch-site: same-origin`.
- **Assertions:** all 13 answer 200. Pty echo p95 and max, and the caps round-trip max, are each at most `HOL_LIMIT_MS = ceil(DOCS_LANE_BYTES / 12.5e6 x 1000 x 1.5) + 150 = 528`.
- **Control, in the same file:** the same load through a test-injected pass-through lane must **exceed** `HOL_LIMIT_MS` (the lab analogue measured 2 022 ms). Otherwise the test fails with "the probe cannot see starvation". The measured separation is about 4x.
- **Running it.** Run it in the foreground. It is CPU-sensitive and joins the known load-sensitive list: re-run it in isolation before calling a red a break.

### 6.9 The field criterion (R1) and its contingency

The real link rate between the two boxes is UNMEASURED; the lab numbers come from loopback with a userland throttle. §7.8 gives the R1 procedure, run after W3's dark rollout and before W5 merges.

- **Pass:** the p95 of an exec round trip under a docs load at the class caps, minus its idle p95, is at most 250 ms (the approved §2 R1 bound).
- **Fail:** contingency `docs-chunked-reads` fires: a chunked `docs-show-range` verb becomes a precondition of W5's merge (W5's work may proceed; it does not merge first). It is built in its own run, W3b, between W3 and W5: the ccd verb, its own cap token (`docs-range-v1`), the agent grant and `REQUIRED_VERB_FLAG` entry, the builder and budget, the adapter, and the PWA's reassembly. It returns a file in bounded frames (at most 512 KiB of raw bytes each), each re-verified against the same blob or `fp`, so no single frame can hold the socket for long. It arrives under its own cap token; v1's argv and grants do not change. R1 is re-measured once it lands.
- **The class caps do not drop.** An earlier draft of this contingency lowered `DOCS_MAX_DOC_BYTES` and `DOCS_MAX_IMAGE_BYTES` to 1 MiB. That was superseded: it would override ruling U1 and make real committed docs unreadable (the largest default-ref doc is 1 300 991 B, and 12 blobs across branch tips exceed 1 MiB). Lowering `DOCS_LANE_BYTES` alone cannot help, because one frame is the unit of head-of-line blocking.

### 6.10 Mutation rows (§6)

| # | Guard | Test | Mutation that goes red |
|---|---|---|---|
| M6.1 | `laneAdmit` | `docs-policy.test.ts`: idle, full execs, over bytes, a second large job | delete or loosen any clause |
| M6.2 | FIFO and bounds | blocking doubles: the 33rd queued job or a 10 s wait gives `docs-busy {lane:'read'}` with zero extra execs; a non-docs route is unaffected; a closed request is dequeued | LIFO; no bound; no dequeue |
| M6.3 | Derived inequalities | `docs-budget.test.ts` computes both from the constants, plus `DOCS_LANE_QUEUE >= DOCS_MAX_IMAGES_PER_PAGE + 2` | raise a cap or lower the lane |
| M6.4 | Estimates from server facts | a size sent by the client has no effect; a listed size lowers the estimate; an unknown size uses the class cap | read the size from the query |
| M6.5 | Check 9 | the fixture answers 1 byte over `job.wire`: `malformed-answer {why:'oversize'}` | delete check 9 |
| M6.6 | `--max-bytes` before read (ccd) | `ccd-docs-show.test.ts`: a PNG of 2 MiB + 1 with `--max-bytes 2097152` gives `too-large {cap}` and the PATH recorder sees no `cat-file blob`; exactly the cap is ok; `--max-bytes 99999999` still hits the 4 MiB ceiling; a bad N gives rc 1 usage | check after the read; skip the `min` |
| M6.7 | Framed encoding rule (ccd) | a 3 MiB fixture with a quote every third character gives `base64`, with framed length within the bound (control: §2's old rule picks utf8 at 6 291 617) | compare the singly escaped length |
| M6.8 | Listing framed bound (ccd) | a fixture whose framed answer exceeds 1 MiB gives `too-many-entries {bytes}` | drop the guard |
| M6.9 | Single-flight and `gen` | two concurrent tree GETs: 1 exec; two file GETs for the same pin: 1 exec; a refresh's tree after a fetch does not join an earlier flight | drop the join; drop `gen` |
| M6.10 | Fetch lane | serial per project; at most 2 global; the 9th queued gives `docs-busy {lane:'fetch'}` | remove the semaphore |
| M6.11 | Cache | a second committed GET: 0 execs; the same blob under a new commit: 0; a draft always execs; the LRU evicts at 64 MiB; a failure is never cached; a provenance record older than 10 min execs | cache drafts or failures; drop the expiry |
| M6.12 | Console latency, with control | 6.8 | a pass-through lane (the control proves the probe can see it) |

## §7 Rollout, retirement and the implementation waves

**Tags.** C1–C5 mark the five corrections §7's design review made to earlier sections, each stated where it applies: C1, a caps list without `caps` is `caps-unknown`; C2, the python3 3.8 floor; C3, `not-granted` retries manually; C4, docs routes stay out of the coordination box-token census set; C5, `/docs` is never added to the worker's own denylist.

This section covers:

- how Docs reaches the two boxes and the phones;
- what `ccrc doctor` measures;
- how an operator retires a standalone docs server;
- which pre-existing defects this programme fixes;
- the waves a plan is written from.

Measured at `c62e22b9a` unless marked UNMEASURED.

- **X1:** a scratch PWA build from `pwa/` and `shared/` at `c62e22b9a`.
  - With `CCRC_SW_DENYLIST='/docs,/fleet/x'`, the built worker carries exactly one `denylist:[...]` with four entries.
  - With a patched `swDenylist` that throws, `'/wiki,/docs'` and `'/docs/'` fail the build (rc 1, message on stderr), importing the prefix from `shared/docs.ts` at config time.
  - Unset gives the two-entry default.
- **X2:** the fleet box's installed `server/dist-pwa/sw.js` (role `fleet`, release lane) carries the two-entry default. Which lane the server box runs is UNMEASURED.

### 7.1 Ordering and version skew

| Part | Box | Read from | When a new copy takes effect |
|---|---|---|---|
| ccd verbs and `_docs_py` | fleet | `~/.local/bin/ccd` (`resolveSpawnCmd`, `agent/src/server.ts:258-260`) | on the next exec. `ccrc update` places it at `_inst_bins`, before the agent restarts |
| `ccd caps`, including `docs-v1` | fleet to server | the agent seeds `verbCache` at boot (`agent/src/server.ts:883-889`); the `caps` op re-execs when ccd's mtime or size changed (`:738-747`) | the ready frame carries it (`client.ts:340-342`). The server polls `caps` every 60 s (`CAPS_REFRESH_MS`), so a ccd swap reaches the server within about a minute with no agent restart. Local mode reads it once at boot (`server/src/index.ts:177-179`) |
| Exec grants | fleet | compiled into the agent (`agent/src/whitelist.ts:378`, checked at `agent/src/server.ts:324`) | only when the agent restarts (`_inst_enable`, or `deploy.sh agent`) |
| Routes, hooks, lanes, cache | server | the server's service unit | at `_inst_enable` |
| PWA bundle and worker | server to phones | `$BOX_TREE_DIR/server/dist-pwa` | at the worker's next update check (7.3) |

`FLEET_PROTO` is unchanged: Docs rides the existing `exec` frame and adds nothing to `shared/agent-protocol.ts`.

| Server | Agent grants | ccd | Server's `ccdVerbs` | A docs call answers |
|---|---|---|---|---|
| pre-Docs | any | any | — | no docs routes. With a bundle, `GET /api/docs/*` hits the exempt `GET /*` wildcard and the not-found handler's `404 {ok:false,error:'not-found'}` (`server.ts:3368`); the POST matches nothing and is gated. The PWA renders "this server predates Docs" (M4.F6), never a docs word |
| Docs | not handshaken, or local mode before its boot read resolves | any | `null` | `caps-unknown` (503, auto), no exec |
| Docs | booted, but `ccd caps` failed | any | `[]` (seeded `?? []`) | **`caps-unknown`**: a list that lacks the token `caps` measured nothing, because every real `ccd caps` lists `caps` itself (`ccd/ccd:8200`). a gate that read only `capSupported` would say `unsupported`, which is the wrong remedy; §2 (a)'s tri-state gate folds this correction in (C1, M7.7) |
| Docs | pre-Docs | pre-Docs | list without `docs-v1` | `unsupported` (501), no exec |
| Docs | pre-Docs | Docs | list with `docs-v1` | the agent refuses; `{code:1, stderr:'forbidden'}` maps to `not-granted`. This happens only between `_inst_bins` and `_inst_enable`, and only while a Docs server is already running |
| Docs | Docs | Docs, python3 missing or below 3.8 | list with `docs-v1` | `helper-unavailable {detail:'python-missing' / 'python-too-old'}` (C2, M7.8) |
| Docs | link down after handshake | — | last list kept | the runner rejects with `disconnected`: `link-failed` (auto) |
| Docs, local mode | n/a | ccd copied by hand, no restart | stale boot list | `unsupported` until the server's service unit restarts; `ccrc update` restarts it itself |
| Docs | Docs | Docs | list with `docs-v1` | works |

**Release order: fleet box first, which is `ccrc rollout`'s default. No wave needs `--server-first`.**

- Every server read is gated on `docs-v1` before any exec, so a Docs server can only under-call an old fleet.
- Fleet-first also hides the `not-granted` window, because the old server does not call docs verbs.
- Rollback reads the table upward. `$REG/docs/fetch/...` stamps left behind are invisible to every registry glob (§2 row 43).

**`not-granted` (amended, C3):** retry is `manual` (it was none), and the sentence names both causes (§4.7).

### 7.2 `ccrc doctor`

**python3** stays a presence check (`ccd/ccrc-doctor-checks:173`, `:487-490`). Its reason text currently cites a ccd range that has no python3 in it. It becomes "ccd's session hook, its registry quoting and its Docs helper are python3". The version floor lives in one place, ccd's docs bash front (C2), and the `docs` check measures it through the verb.

Two new checks are appended to `CCRC_DOCTOR_CHECKS` after `models`. They follow the table contract (`:162-165`): verdicts go through `_dr_pass/_dr_warn/_dr_fail/_dr_skip`, every non-PASS carries a remedy, and the role comes from `_box_env_value "$BOX_ENV_FILE" CCRC_ROLE`.

**`docs`** (fleet half, W1):

1. **Role `server`:** SKIP ("no ccd answers Docs here; the fleet box's doctor measures it").
2. **Find ccd:** `ccd="$HOME/.local/bin/ccd"` (the path the agent execs). If it is not executable: FAIL, remedy `ccrc update`.
3. **Run the verb:** `_plat_timeout "$CCRC_DOCTOR_DOCS_TIMEOUT" "$ccd" docs-index --all </dev/null`, with `: "${CCRC_DOCTOR_DOCS_TIMEOUT:=20}"` placed beside `CCRC_DOCTOR_GH_TIMEOUT` (`:159`). The default equals `CCD_VERB_TIMEOUT_MS['docs-index']` (20 000 ms), asserted by `docs-budget.test.ts`.
4. **Classify the answer:**
   - rc 124: FAIL "did not answer within N s".
   - rc not 0: FAIL "ccd could not run docs-index (rc N: <first stderr line, 200 B>); it predates Docs or died", remedy `ccrc update`. An old ccd's unknown-verb arm gives exactly rc 1 with `usage: ccd {...}`.
   - stdout is not one JSON object with `.v==1` and `.verb=="docs-index"` (checked with `jq -e`, already required): FAIL.
   - `helper-unavailable`: FAIL with the python3 3.8+ remedy.
   - any other `ok:false`: FAIL naming the word.
   - `ok:true`: report **counts only, never project names**, because doctor output gets pasted. WARN when any row is `repo-unreadable` ("N projects under ccd's projects root, K served by Docs, U unreadable", with the `jq` one-liner that lists them); otherwise PASS.

This is the first doctor check that runs a ccd verb (read-only and bounded) against the live box. It also runs inside `ccrc update`'s closing doctor. A FAIL there is honest (the box updated, but Docs cannot run): `update` exits 3, and `rollout` relays it.

**`docs-sw`** (server half, W4):

1. **Role `fleet`:** SKIP.
2. **Find the worker:** `sw="$BOX_TREE_DIR/server/dist-pwa/sw.js"` (where both lanes put the bundle). Absent or unreadable: FAIL, remedy `ccrc update --force`.
3. **Shape check:** `grep -c 'denylist:\['` must be 1. Otherwise WARN ("this check knows the shape workbox emits"), with the remedy: hard-reload `/docs/` in a browser and check that the Docs screen renders.
4. **Prefix check:** extract the list and test it against an ERE built from `CCRC_DOCS_PAGE_PREFIX`. That is one literal `'/docs'` in the doctor file, bound to `DOCS_PAGE_PREFIX` by M7.3.
   - An entry equal to or under `/docs` FAILs: "the installed service worker refuses the app shell to /docs; Docs pages break on a hard load and offline". Remedy: "remove /docs from CCRC_SW_DENYLIST in the deploying machine's ~/.ccrc/deploy.env and deploy again, or move to the release lane: ccrc update".
   - `/docsy` passes.
5. **Otherwise** PASS.

The build already refuses such an entry (7.3). `docs-sw` is the only measurement of the bundle actually installed, which catches a hand-built bundle, a pre-Docs checkout, or a regression in the built-ins.

**No check probes a standalone docs server** in either direction: not its unit, its port or its proxy mapping. This keeps the ruling that this tree does not know such a tool exists (`ccd/ccrc:3412-3421`, `ccd/ccrc-doctor-checks:4612-4627`), and CLAUDE.md's rule against reading a live proxy mapping as the product's path.

**Fixtures (`server/test/ccrc-doctor.test.ts`):**

- `healthy()` plants `$HOME/ccrc/server/dist-pwa/sw.js` with the default denylist, and a stub `$HOME/.local/bin/ccd` that prints a canned ok `docs-index` line. Both checks then PASS, and `HEALTHY_SKIPS` (`:1271`) does not move.
- The canned lines come from one module, `server/test/docsIndexFixtures.ts`. `ccd-docs-index.test.ts` asserts that the real verb, run on matching fixture HOMEs, emits exactly those objects (with `elapsedMs` normalised), so the stub cannot drift.
- Whether `healthy()` already plants `~/.local/bin/ccd` is UNMEASURED; the W1 worker greps first.

### 7.3 The service worker and the `/docs` prefix

**Today:**

- The built-in denylist is `/^\/api\//` and `/^\/ws\//` only (`pwa/src/lib/sw-denylist.ts:40`).
- Extras come only from `CCRC_SW_DENYLIST` at build time (`pwa/vite.config.ts:63`), and only `deploy.sh` exports it (`deploy/deploy.sh:45`). `build-release.sh` sets no knob, and `ccrc update` installs the prebuilt bundle, so **every release-lane box serves the default** (X2).
- `/docs/*` pages are the shell: the server's not-found handler and the worker's `navigateFallback` both hand them `index.html`. Never add `/docs` to the worker's own denylist (C5; M7.2 pins that the default does not deny it).
- `/api/docs/*` is `NetworkOnly` and denylisted from the shell. Sandboxed frames bypass the worker entirely (lab 10).
- Offline, a Docs page shows the shell and its failure state only.

**Build-time refusal (W4).**

- `swDenylist(extra)` imports `DOCS_PAGE_PREFIX` from `../../../shared/docs` (the house form, `pwa/src/lib/feed.ts:9`).
- It **throws** on any normalised entry equal to that prefix or under it, with: "CCRC_SW_DENYLIST entry <p> covers /docs, ccrc's own Docs pages; a service worker that refuses them the app shell breaks them on every hard load. Remove it from CCRC_SW_DENYLIST (deploy.sh reads it from ~/.ccrc/deploy.env on the deploying machine) and build again."
- `vite.config.ts` calls it at config load, so the build fails (X1). `deploy.sh` runs under `set -euo pipefail` and builds before shipping, so nothing reaches the box.
- Only the Docs prefix is refused.

**Prose and tests that move with it (W4).** Each is edited in place, with its line count unchanged:

- `sw-denylist.ts:9-14` loses the sentence about the reference box's docs server. Its examples, including the docstring's `"/docs,/fleet"` and `/docs`, `/docs/`, `/docs/a/b` (`:29`, `:33-35`), become `/wiki` forms, plus one sentence saying `/docs` is ccrc's own and refused.
- `vite.config.ts:54-60` uses `/wiki` and points at `deploy/deploy.sh`'s header. The file it cites today, `deploy/ccrc.env.example`, never mentions the knob.
- `deploy/deploy.sh`'s header examples become `/wiki,/fleet`. They sit above the cited `:508-648` corpus, so no anchor shifts, and `deploy-coordinates.test.ts:141-142` pins only the export line.
- `pwa/test/sw-denylist.test.ts` switches every `/docs` example to `/wiki` (`:52-85`), keeping `:113-121`.

**Migrating a box that denylists `/docs` today.** This only happens with a `deploy.sh` build that has `/docs` in the knob. On such a box, `/docs/*` navigations bypass its worker and reach ccrc's fallback, so Docs works online and fails offline. The build refusal forces the first Docs deploy to drop the entry. The operator's one action is to remove `/docs` from their own `~/.ccrc/deploy.env`; ccrc never edits it.

**When a phone switches.** `registerType: 'autoUpdate'` (`vite.config.ts:19`) runs an update check every 15 minutes (`UPDATE_CHECK_MS`, `main.tsx:31`) and on every foreground. A deep link opened on a phone holding the pre-Docs bundle takes at most one reload:

1. the old shell shows the fleet;
2. the navigation's update check installs the new worker;
3. the reload lands on the Docs screen.

The shell's `frame-src` meta (§5.6.1) is in the bundle bytes, so the precache carries it. Nothing depends on replayed response headers.

### 7.4 Retiring a standalone docs server: operator steps

**ccrc performs none of these steps.** No ccrc code or check names such a server, its forwarder, its proxy mapping, or the operator's global `CLAUDE.md`. The README carries a short form (7.5). These steps use roles, not names: substitute your own proxy, your forwarder unit, your docs-server unit and `<old-port>`.

> **Warning.** A docs server that passes raw HTML through must never stay mapped on an origin that also serves the PWA. Any page it answers there runs script on the same origin as the PWA's session cookie, and ccrc's mockup sandbox cannot reach bytes another app sends. That is why removing the mapping is Step 1, before any verification.

**Step 0, preconditions.**

- Both boxes run a Docs release: check `ccrc version`, `/health`'s `version`, and the phone's build line after one foreground.
- On the fleet box, `ccrc doctor` shows `docs` PASS (or an accepted WARN) and `python3` PASS. On the server box it shows `docs-sw` PASS.
- For a `deploy.sh` user, `CCRC_SW_DENYLIST` no longer contains `/docs`.

**Step 1, remove the `/docs` mapping from your proxy.** Do this on every origin that also serves the PWA, before anything else. Until it is gone:

- one URL is answered by two apps: a phone whose updated worker hands `/docs` to the ccrc shell gets native Docs, while a browser without that worker gets the old server;
- the old server's raw HTML is live on the PWA's origin.

Use your proxy's own help for the syntax; this spec gives none.

**Step 2, verify the native path on `CCRC_ORIGIN` through the in-app Docs door.** Do not type `/docs` URLs. In-app navigation never leaves the page. Verify by content, never by status, because the SPA fallback answers 200 for any path:

1. The projects list appears, with non-zero counts where you expect specs.
2. A spec's header shows a served ref such as `refs/remotes/origin/main` and a short commit. Compare it with a read-only `git -C <that project's main checkout> rev-parse --short origin/main` on the fleet box.
3. Open the Docs link on the session card of a session whose worktree holds a branch with an uncommitted spec. It opens `?ref=<that branch>` and shows the spec with a draft badge, and Open committed version works. This includes an unpushed branch, the case the old tool answered falsely.
4. In a signed-out private window, `https://<your-origin>/api/docs/projects` returns 401 JSON when auth is armed (403 `foreign-request` when it is not), never a listing.
5. Optionally, read-only on the fleet box: `ccd docs-index --all | jq '.projects[] | {project, state}'`.

**Step 3, move your link convention.** This lives in your own global `CLAUDE.md`, which ccrc does not edit.

- Chat links become `https://<your-origin>/docs/<project>/<section>/<path>`, with `?ref=<branch>` for unmerged work.
- `<project>` is the directory name under ccd's projects root, as `docs-index` lists it, not a docs-server config label. A root your old server served that is not such a directory is reached with `?ref=<its branch>` on its parent project.
- Durable links stay GitHub blob URLs (`https://github.com/<owner>/<repo>/blob/<default-branch>/<path>`). The page's View on GitHub builds one when the tree answer names a GitHub origin. A Docs URL never belongs in a ticket, a PR or tracked text.
- Links on any other origin that also serves the PWA stop working once auth is armed: the cookie is host-only (`auth/cookie.ts:110-122`) and passkeys bind `CCRC_RP_ID`. Rewrite them to `CCRC_ORIGIN`.

**Step 4, stop your forwarder unit**, if one bridged the proxy to the docs server's box. Run `systemctl --user disable --now <your-forwarder>.service` on that box.

**Step 5, stop your docs-server unit:** `systemctl --user disable --now <your-docs-server>.service`.

- Keep its directory; its configuration and history are yours. A dormant second copy elsewhere is yours to keep or remove.
- Stopping it also removes an unauthenticated listener and a second writer of remote-tracking refs in your clones.

**Step 6, check.**

- The old path on every origin that serves the PWA reaches ccrc's shell or nothing, never the old server.
- `ss -ltn | grep ':<old-port>'` prints nothing on the old server's box.

**Rollback:** re-enable the units. If you need the old server reachable again, map it only on an origin that does not serve the PWA. ccrc changed none of these.

### 7.5 README and repository prose (W7 unless marked)

All of this text is public. Use placeholders only (`<your-origin>`, `<project>`, `example-org/example-repo`): never a real host, tailnet, project list, username or port, and never a docs-server URL. New README text cites functions and verbs by name, never `ccd/ccd:N`, because the README's own `file:line` refs are audited.

1. **`## Docs`**, placed before `## Fleet coordination` (`README.md:1966`). It covers:
   - scope: the four `DOC_SECTIONS` of each project under ccd's projects root, and the page grammar;
   - default view: the origin default branch, never drafts, plus the hint;
   - drafts: `?ref=<branch>` from the one worktree holding it, overlaid only when that worktree's HEAD is the served commit (otherwise a hint); a detached worktree never counts; two holders mean committed only; qualified refs force a side; `view=committed`;
   - freshness: stale 10 min after the last attempt, failures retried after 60 s except a branch origin lacks, which waits the full 10 min; auto-refresh only for a resolved ref; and the chip refreshes;
   - what Docs writes in your repositories: one `refs/remotes/origin/<branch>` per refresh, with no `FETCH_HEAD`, prune or `set-head`;
   - what Docs writes in ccd's registry: `~/.cc-sessions/docs/fetch/...` stamps, mode 0600, safe to delete;
   - rendering: client-side Markdown with no raw HTML; HTML mockups only in a sandboxed srcdoc frame, pre-scanned, with scripts off until tapped and external origins loaded only by a per-view tap; SVG only as an image;
   - limits: the §2 and §6 caps, and the lanes;
   - offline and auth: shell only when offline; every route is session-gated, never exempt, and uses no box token;
   - requirements: python3 3.8+ on the fleet box and a ccd advertising `docs-v1`, measured by doctor's `docs` and `docs-sw`;
   - the failure list, which is `DOCS_FAILURES`.
2. **`### Moving off a standalone docs server`:** 7.4 as one-line bullets, opening with the Step 1 warning.
3. **Requirements** (`README.md:132-133`; `:311` lists python3 with no reason and stays as it is): python3 is also "ccd's Docs helper (Python 3.8 or newer)".
4. **Architecture, HTTPS paragraph** (`:2851-2857`): the knob is documented in `deploy/deploy.sh`'s header, not in `deploy/ccrc.env.example`; `/docs` is ccrc's own route, and a build refuses a denylist entry that covers it.
5. **Deploy ordering** (`:3192-3197`): Docs follows fleet-first and needs no `--server-first`. Local mode reads `ccd caps` once at boot, so a hand-copied ccd needs a server restart (`ccrc update` does it).
6. **`CLAUDE.md`, two-box topology paragraph:**
   - Its last sentence, about the tailnet docs preview, becomes: "ccrc serves its own Docs reader at `/docs`, behind the session gate (README `## Docs`). An operator may still run an older docs preview beside it; that is operator plumbing outside ccrc, and nothing in this tree knows about it."
   - The deploy bullet's "the agent caches `ccd caps` at boot" becomes "the agent reads `ccd caps` at boot and re-reads it within a minute of ccd changing".
   - Grep `server/test`, `pwa/test` and `agent/test` for pins on either phrase first. None were found; whether any exist elsewhere is UNMEASURED.
   - The known load flakes bullet gains `docs-console-latency` (§6.8).
   - No edit to the box-token bullet (C4).
7. **`docs/superpowers/`:** this spec and its plans follow the same rules. A plan's deviations are minted by the allocator when they fire, never typed ahead. Contingencies are named by slug: `docs-chunked-reads`, `docs-fetch-keeplist`, `mockup-scripts-confirm`.

### 7.6 Pre-existing defects

There are three, found in §2's decisions and verified at `c62e22b9a`. This programme fixes what Docs depends on. The rest ships as two small PRs outside the Docs waves, after W3 (ruling U5).

| Defect | Inside the Docs waves | Outside the Docs waves (after W3) |
|---|---|---|
| 3. No error boundary (`main.tsx:13-17`; none in `pwa/src`) | **Fixed in W4** (root, detail, chat item; doc body in W5; §4.12). The Markdown renderer is shared with chat, so the fix is not deferred | — |
| 2. No security headers anywhere | **The Docs part is fixed:** every `/api/docs/*` response carries §5.3's set (W3), and the shell carries `frame-src 'none'` as a bundled meta (W6) | a second small PR: a global `onSend` baseline (`nosniff`, `Referrer-Policy: no-referrer`, `frame-ancestors 'self'`), registered beside `installGate` (`server.ts:528`), which never overwrites a header a route set. It adds no `frame-src` (the meta owns it) and no `script-src` |
| 1. A pre-existing route defect: an existing session-gated GET outside Docs that mutates git state on the fleet box. As in §0, this spec adds no further detail before disclosure | Docs does not touch it, and the Docs waves neither depend on it nor change it | reported privately through GitHub private vulnerability reporting (`SECURITY.md` asks for it). Fixed in its own small PR; disclosed once merged |

### 7.7 The implementation waves

There are seven waves. Each is one run row, with one worker and one reviewer run.

- **Dependencies:** **W1 → W2 → W3 → W5 → W6 → W7**, and **W1 → W4 → W5**. W4 runs in parallel with W2 and W3.
- **Releases:** every merge to `main` becomes a prerelease. Boxes move only through `ccrc rollout`, fleet first.
- **Outside the waves:** the two small PRs of 7.6 land after W3.

| Wave | Box | Ships | Rows | Gate / measurement | Rollout |
|---|---|---|---|---|---|
| **W1** ccd reads docs | fleet (ccd), L0 | `shared/docs.ts`: every §2 type with the §3 amendments, grammars, caps and class caps, `DOCS_FAILURES` (with the §3.7 and §5 words), `DOC_SECTIONS`, `contentClass` and the raster table, `admitDraft`/`entryView`, `DOCS_FAILURE_RETRY`, `resolveDocRef`, the page grammar and `docsApi`, `githubBlobUrl`, `DOCS_RESPONSE_HEADERS`. `ccd/ccd`: the four verbs at their final arity (`--ref`, `--max-bytes`), `_docs_py` with the framed encoding and listing bounds, the `github` field, the 3.8 floor probe, arms, usage, caps lines with `docs-v1`, and amended comments; **restamped last**. `ccd/ccrc-doctor-checks`: `docs` and the python3 reason | §2 rows 1-43, 45 (ccd half: the dispatcher arms and `docs-v1` in `KNOWN_CAPABILITY_TOKENS`), 48, 53 (L0 half: the `admitDraft`/`entryView` table and `DOCS_FAILURE_RETRY` exhaustive), 55-59, 61 (ccd half: `lockAgeMs`; its PWA rendering lands in W5), 62 (ccd half), 63-65; M3.1-M3.3, M3.11, M3.12; M5.3, M5.7 (their L0 cases, in a new `server/test/docs-shared.test.ts`; M5.3's leaf-routing half lands in W5 and M5.7's mockup-resolution half in W6); M6.6-M6.8; M7.3 (TS half), M7.4 (less its runner-budget clause), M7.6 (`docs`), M7.8 | R3 (lab) | optional `ccrc update --to <W1 tag>` on the fleet box. It is harmless, and its `ccrc doctor` is the first proof on a real box |
| **W2** grants and adapter | fleet (agent), server L1-L3 | `agent/src/whitelist.ts`: 4 `REQUIRED_VERB_FLAG` entries and grants, plus agent type tests. `server/src/ccdargv.ts`: `DOCS_CAP` and builders. `runner.ts`: 4 budget rows. `server/src/docs/policy.ts` (L1: query parser, provenance, lane admit, use of the headers table, cache-control, refreshDue, fetchBranchFor, `DOCS_FAILURE_HTTP`); `ports.ts` (L2, consumer-declared `DocsReader`/`DocsFetcher`); `ccdsource.ts` (L3: tri-state gate with C1, classification, redactor, checks 8-9). The docs ring guard appended to `single-definition.test.ts` | §2 rows 44, 45 (the gate cases, with `DOCS_CAP`), 46, 47, 53 (L1 half: the `refreshDue` table and `DOCS_FAILURE_HTTP` exhaustive), 62 (L3 half); M3.4 (L1 half), M3.9, M3.10; M6.1, M6.3-M6.5; M7.4 (runner-budget clause, with `docs-budget.test.ts`), M7.7, M7.10 | — | none needed; it rides a later rollout |
| **W3** routes | server | `server/src/docs/routes.ts`, `hooks.ts` (provenance, response policy), `lane.ts`, `cache.ts`; the plugin registration beside `registerUpdateRoutes`; wiring in `index.ts`; census updates; `docs-console-latency.test.ts` | §2 rows 49-52; M3.4-M3.8, M3.13-M3.15; M5.1, M5.2, M5.4-M5.6; M6.2, M6.9-M6.12 | **R2 and R1** on the real link, after the dark rollout | **dark rollout to both boxes required**, fleet first: the API is live and session-gated, with no UI door |
| **W4** PWA foundation | PWA + doctor file | golden test first; `lib/markdown.tsx` extraction with chat unchanged; iterative `remarkAlerts`; `RenderBoundary` (root, detail, chat item); `useLocation`; the `swDenylist` refusal with its prose and tests; `docs-sw`. Chat hardening (U3): the chat nesting pre-scan, the parse pipeline, the worker and runner for messages over 4 KiB, `renderHast`, the highlight cap, the five direct dependencies, and the chat refusal of root-relative and protocol-relative image sources | M4.R1, M4.R3, M4.M1, M4.M2, M4.P1-P8, M4.P10-P12, M4.H1, M4.B1, M4.B3, M4.B4, M4.C1-C3; M7.2, M7.3 (doctor half), M7.5, M7.6 (`docs-sw`), M7.9 | build verification: the worker chunk is emitted and precached | optional; phones update with no visible change beyond crash resilience |
| **W5** Docs screen | PWA | `DocsScreen`; `api.docs.*` with the marker header; views, truth line, banners, failures; the door and session links; `DocMarkdown` with the docs URL and image policy; the image queue; raster object URLs and SVG `data:` images; text/other leaves; `view=committed`; GitHub links; auto-refresh; re-fetch on sign-in; contrast and tap-target registrations; the required `browser (pwa)` job (U4) with M5.B5 and M5.B6 | §2 rows 54, 60, 61 (PWA half: the 3 s retry and the stale-lock rendering), 66, 67; M4.R2, M4.R4, M4.L1, M4.L2, M4.P9, M4.H2, M4.U1-U7, M4.T1-T7, M4.F1-F6, M4.A1-A3, M4.B2, M4.S1; M5.3 (leaf-routing half), M5.17, M5.18, M5.20; M5.B5, M5.B6 | merge gate: **R1 and R2 recorded as passing** in the plan | fleet-first rollout; the feature is live on the dev channel. Retiring a standalone docs server (7.4) follows W7, because HTML mockups land only in W6 |
| **W6** mockups | PWA | `MockupView`, `MockupFrame`, `mockup/{policy,prescan,parse,plan,css,load,origins}.ts`, `buildSrcdoc`, the click guard, the load watcher, the census, Source, Download, `frame=full` and New tab, and the per-view Load external opt-in (U2); the `frame-src 'none'` meta in `pwa/index.html` and the `build-pwa` grep step | M5.7 (mockup-resolution half), M5.8-M5.16, M5.19, M5.21, M5.22; M5.B1-B4, M5.B7, M5.B8 | DOMParser measured in Chromium on the worst deep shape at `MOCKUP_MAX_DEPTH`/`MOCKUP_MAX_TAGS`, with the limits lowered if it exceeds about 1 s; the committed mockups' counts recorded; one manual phone pass of the M5.B fixtures plus the busy-loop fixture (`mockup-scripts-confirm` if the phone does not isolate the frame) | fleet-first rollout |
| **W7** docs and release | docs | README and `CLAUDE.md` (7.5); the whole-branch review | topology-clean; README citations (`session-hook`); deviation-refs; `box-token-census` (proves the bullet is untouched) | — | promote to `stable` (needs a green `full-suite` on the commit, which now includes `browser (pwa)`), then `ccrc rollout`. The operator's 7.4 follows; it is not a wave |

**W1 is the largest wave.** The plan splits it into W1a (runner, discovery, grammar, `docs-index`, `docs-tree`) and W1b (`docs-show`, `docs-fetch`), each with its own restamp and citation re-measure. Both halves are tasks inside the one W1 run row, with one worker and one reviewer; they are not separate waves.

**W1 housekeeping, in order:**

1. the ccd edits;
2. restamp with `markGenerated` (exactly one marker line, `ownership.test.ts`);
3. re-measure the citation corpus (the caps lines shift every cited `ccd/ccd` anchor after the caps block);
4. run `session-hook.test.ts`.

Rebase often: two branches that edit `ccd/ccd` conflict on line 2.

### 7.8 Field measurements

**R3, status and worktree cost (W1, lab only; never against a live repo or HOME).**

- **Setup:**
  - a scratch HOME, seeded the way `makeCcdHarness` does;
  - a `git clone --shared` of the main checkout of the fleet project with the most worktrees (it reads the live object store and writes nothing to it);
  - as many `worktree add`s as a read-only `git worktree list --porcelain` counts on the live checkout;
  - 36 dirty docs in one holder.
- **Measure:** time `HOME=<scratch> ccd docs-tree --project <p> --ref <held branch>` once cold and 10 times warm.
- **Pass:** warm p95 at most 2 s, and the first run at most 8 s. Otherwise record the numbers and re-derive the read-lane wait before W3 merges.
- **Either way:** assert on the clone, with a lowered bound, that the draft phase degrades to `unreadable {step:'status'}` while the committed listing survives.

**R2, fetch authentication through the agent's environment (operator, after W3's dark rollout; the real `~/.gitconfig` is the thing measured).**

1. Group the projects by the shape of `remote.origin.url`, read-only: https with a credential helper, ssh, a `url.insteadOf` rewrite, other.
2. For one project per class, run the call below from the ccrc origin's devtools console. It is same-origin, so the cookie and `Origin` are right:

```js
await (await fetch('/api/docs/<project>/refresh', {method: 'POST', headers: {'content-type': 'application/json', 'x-ccrc-docs': '1'}, body: JSON.stringify({ref: null, reason: 'manual'})})).json()
```

Its only effects are to move that project's default remote-tracking ref (which the daily fetcher moves anyway) and to write one stamp.

- **Pass:** every class answers `fetch.state === 'ran'`.
- **Fail:** a `fetch-auth-failed` or `fetch-transport` fires `docs-fetch-keeplist`: widen §2's fetch-environment keep-list for that class, then re-measure.
- W5 does not merge until every class passes.

**R1, head-of-line blocking on the shared socket (operator, after W3's dark rollout).**

1. On the fleet box, `git init <ccd projects root>/docs-hol-probe`.
2. Commit 20 distinct files of exactly `DOCS_MAX_DOC_BYTES` of incompressible text, as `docs/superpowers/specs/p<n>.md`. Distinct blobs defeat the cache. The project may appear on the fleet's project list while it exists.
3. Pick a live session id. Sample `GET /api/sessions/<id>/pane/history` every 200 ms: for 30 s idle, then for 30 s while a loop fetches the 20 files through the file route with the marker header, 4 at a time (the lane serialises answers over 1 MiB). That route is an exec over the agent link, in no docs lane (`server.ts:1781+`).
4. Remove the scratch project.

- **Pass:** p95 under load minus p95 idle is at most 250 ms.
- **Fail:** §6.9's `docs-chunked-reads`: `docs-show-range` becomes a W5 precondition, and R1 is re-measured once it lands.

R1 is a lower bound for pty echo, which shares the socket. M6.12 proves the lane's ordering; R1 proves the real link.

### 7.9 Suites each wave runs

Run in the foreground, with a timeout of at least 600 000 ms, single files via `./node_modules/.bin/vitest run`. Run `git fetch origin main` first (deviation-refs).

- **Every wave:** `topology-clean`, `single-definition`, `deviation-refs`, `typecheck-tests`.
- **W1:**
  - new: `ccd-docs-{index,tree,show,fetch}`, `docs-parity`, `docs-grammar`, `docs-url`, `docs-shared`;
  - existing: `ccd-archive`, `caps-token-shape`, `ownership`, `wsaudit`, `macos-platform`, `ccd-harness-containment`, `session-hook` (after the re-measure), `ccrc-doctor`, `install-census` (proves no new bin or unit), `pool-name-parity`.

  The ccd suites are load-sensitive: re-run a red one in isolation first.
- **W2:**
  - the full agent suite (including `whitelist-structural` and `whitelist`);
  - server: `whitelist-subset`, `verb-gate`, `capsupported`, `ccdargv-brand`, `ccdargv-dec-parity`, `remote-runner`, `pr-timeout-budget`;
  - new: `docs-source`, `docs-policy`, `docs-budget`.
- **W3:**
  - new: `docs-routes`, `docs-cache`, `docs-lanes`, `docs-headers`, `docs-file-bytes`, `docs-console-latency`;
  - existing: `auth-gate`, `box-token-census`, `coord-routes-single-file`, `coord-pause-route`, `verb-gate`, `whitelist-subset`;
  - the full server suite (CI runs it anyway while `CCRC_SELECTION` reads `shadow`, `ci.yml:81`).
- **W4:**
  - the full PWA suite, especially `message-links` (unmodified), `app`, `app-pane-reset-timing`, `sw-denylist`, `contrast`, `tap-targets`, `shell-css`;
  - server: `ccrc-doctor`, `docs-parity`, `deploy-coordinates`.

  A `package.json` change runs the full CI suite by design.
- **W5:** the full PWA suite, especially `docs-screen`, `fleet-screen`, `settings-screen`, `contrast`, `tap-targets`, `shell-css`, `offline`, `push-sw`; plus `browser-leg` and the browser config.
- **W6:** the full PWA suite, especially `docs-mockup-prescan`; and the browser leg, including M5.B8.
- **W7:** `session-hook`, `box-token-census`, `topology-clean`.

### 7.10 Mutation rows (§7)

| # | Guard | Test | Mutation that goes red |
|---|---|---|---|
| M7.1 | A pre-Docs server's 404 is not a docs failure | = M4.F6 | map any 404 to a docs word |
| M7.2 | The build refuses an entry covering Docs; the default never denies `/docs` | `sw-denylist.test.ts`: throws, naming the entry and `CCRC_SW_DENYLIST`, for `/docs`, `docs`, ` /docs/ `, `/docs/x`, `/wiki,/docs`; `/docsy` and `/docs-archive` do not throw; the default does not deny `/docs/p/specs/a.md` and does deny `/api/docs/p/tree` | delete the throw; compare unnormalised; add `/docs` to the worker's own list |
| M7.3 | One prefix | `docs-parity.test.ts`: exactly one `DOCS_PAGE_PREFIX =` across the four TS roots and exactly one `CCRC_DOCS_PAGE_PREFIX=` in `ccd/ccrc-doctor-checks`, and they are equal | edit either side; add a TS copy |
| M7.4 | `docs` classification | a stubbed ccd per canned line: ok gives PASS; an unreadable row gives WARN; `helper-unavailable` gives FAIL with the python remedy; rc 1 `usage:` gives FAIL "predates"; a sleeping stub with a 1 s timeout gives FAIL "did not answer"; non-JSON gives FAIL; role `server` gives SKIP; the timeout default equals the runner budget | merge two arms; drop the rc check; edit the default |
| M7.5 | `docs-sw` | a `/docs` entry: FAIL; `/docs/x`: FAIL; `/docsy`: PASS; the default: PASS; two denylists: WARN; absent: FAIL; role `fleet`: SKIP | delete the grep; anchor it so `/docs/x` escapes; widen it so `/docsy` fails |
| M7.6 | Table and functions | the existing table-vs-functions cases pass with both names; `HEALTHY_SKIPS` is unchanged | omit a function or a table entry |
| M7.7 | A list without `caps` is unmeasured | `docs-source.test.ts`: `[]` gives `caps-unknown` with 0 execs; `['caps']` gives `unsupported`; `['caps','docs-v1',...]` execs | drop the `includes('caps')` arm |
| M7.8 | The python floor in ccd's bash front | `ccd-docs-index.test.ts`: a PATH `python3` stub exiting 3 on the probe gives rc 0 `helper-unavailable {detail:'python-too-old'}`; exit 127 gives `python-missing` | probe for presence only |
| M7.9 | ccrc does not know a standalone docs server | `docs-parity.test.ts`: across the shipped source (`ccd/`, `deploy/`, `server/src`, `pwa/src`, `agent/src`, `shared/`), the standalone server's directory name appears only inside the two existing ruling comments, in `ccd/ccrc` and `ccd/ccrc-doctor-checks`, located by their anchor sentence; the standalone server's own name appears nowhere in `pwa/src`. Tracked tests (`adopt`, `ccrc-doctor`, `ccrc-memory`) and docs also mention the name and are outside the scan | add a path or check naming it; keep the old `sw-denylist` comment |
| M7.10 | Docs ring | appended to `single-definition.test.ts`: files under `server/src/docs/` are classified by their imports (`policy.ts` imports only `shared/`; `ports.ts` is type-only; `ccdsource.ts` has no fastify and no `reply`; only `routes.ts`, `hooks.ts`, `lane.ts` and `cache.ts` import fastify or own timers); the file list comes from `readdirSync`; a planted `import 'fastify'` in a copy of `policy.ts` is detected | import fastify in L1; hand-list the files |
