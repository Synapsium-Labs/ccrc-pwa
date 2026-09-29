# Design sync — the design system in Claude Design, canvases driven from the repo

**Status:** design approved in chat 2026-09-29 ("dzialaj"), no code written yet.
Operator ask, verbatim: *"czy możesz przygotować claude sync dla design systemu ccrc.
Chce w taki sposób mieć to realizowane że masz to w Claude Design ale że również mam
możliwość budowania canvasów/artefaktów z claude design za pomocą instrukcji z kodu,
podczas pisania zadań, albo nawet orchestrator long term powinien móc wymuszać bądź at
least pytać czy robić taki design."*

**Verdict in one sentence:** three lanes, and only one of them needs new machinery —
the sync lane needs a build script `@ccrc/ui` does not have, the canvas lane needs two
markdown conventions and nothing else, and the orchestrator lane needs prose in two
skills plus one guard test, because this repo's own doctrine says a policy without a red
suite is a wish.

## What was measured, 2026-09-29

Everything below was checked in this session, not remembered.

| Mechanism | Measured state |
|---|---|
| `DesignSync` tool (`list_projects`/`get_file`/`finalize_plan`/`write_files`/…) | schema loads, callable |
| `/design-sync` skill, storybook shape | on disk at bundled-skills **2.1.283**; this session runs **2.1.270** — arrives on next CLI restart |
| `/design` skill (`seed-canvas.mjs`, `.dc.html` artboards) | available, already used once this branch (15 artboards) |
| `@ccrc/ui` | 7 primitives, 31 stories, Storybook builds clean |
| `ui/package.json` `scripts` | `storybook`, `build-storybook` — **no `build`** |
| `ui/package.json` `exports['.']` | `./src/index.ts` — TypeScript source, no `dist/` |
| Playwright chromium | cached at `~/Library/Caches/ms-playwright/chromium-1234` |
| contrast gate | `ALL 482 PASS` |

The storybook shape is the one this repo qualifies for, and it is the good one.
Storybook is the **fidelity oracle**: the converter screenshots every story in the repo's
own Storybook and in the generated preview, side by side, and the run iterates until they
match. The package shape — the fallback when there is no Storybook — has *no reference
render to verify against* and falls back to a "floor card" built from `.d.ts` exports.
Wave 1 bought this qualification without knowing it.

## Lane A — sync: the repo is the source, Claude Design is a mirror

`@ccrc/ui` is the only package the sync sees. `.design-sync/config.json` is committed,
`projectId` pinned in it, and every later re-sync is one driver run in which untouched
components cost nothing.

### The one blocker, and why the fix is cheap

The converter bundles the package's compiled `dist/` into `window.<Global>`.
`@ccrc/ui` ships source, deliberately: `pwa` consumes it over `file:../ui`, Tailwind's
`@source '../../src/**/*.{ts,tsx}'` scans the `.tsx`, and `pwa/vite.config.ts` carries
`server: { deps: { inline: [..., '@ccrc/ui'] } }` so vitest does not externalize it.

So the build is **added beside** the source entry, never in front of it:

```jsonc
// ui/package.json
"scripts": {
  "build": "vite build && tsc -p tsconfig.build.json --emitDeclarationOnly"
}
// exports['.'] STAYS "./src/index.ts" — untouched
```

and the converter is pointed at the built entry explicitly (`--entry dist/index.js`),
which the skill documents for exactly this case: *"If `package.json` `module`/`exports['.']`
points at TS source, find the actual built entry and pass it via `--entry`."*

Consequence, stated so a later reader does not re-derive it: **nothing `pwa` resolves
changes.** The 82 test files, the 2280 tests, the contrast gate and the production build
all keep resolving `./src/index.ts`. `dist/` exists only for the converter, and
`ui/.gitignore` keeps it out of the tree.

### The invariant that must not be lost

The Claude Design project is a **mirror**. Ground truth stays `ui/src` plus
`pwa/design/audit.mjs`. This is the same shape as `~/.ccrc/coord.db` against ccd's flat
files — a server-side re-measurement that reconstructs from the files, never the other
way. A lost design project re-syncs from the repo in one command; a lost `ui/src` is not
recoverable from the design project and nothing should ever imply otherwise.

**The sync is one-directional by construction.** Edits made in the Claude Design GUI do
not flow back as code. They come back as a brief for the next wave (lane B), which is a
deliberate choke point: it keeps the contrast gate the only thing that can admit a colour
pair into this product.

## Lane B — canvases built from instructions that live in the repo

The design brief is a file, not a memory. Two paths:

```
docs/design/briefs/<slug>.md     the brief: what is being designed, which screens,
                                 which viewports, what must not change
docs/design/CANVASES.md          the register: URL | what it covers | the commit sha
                                 the canvas matched when it was made
```

`/design`'s step 0 already reads `ui/src/styles/tokens.css` and the existing components
and holds itself to pixel-exact reproduction of them — so "instructions from code" needs
no new machinery at all. What it needs is a brief that names the package, and a register
line that carries the **commit sha**. Without the sha a canvas drifts from the code
silently and nobody can say when it stopped being true.

A brief is written while the task is written, by whoever writes the task. That is the
whole of "podczas pisania zadań".

## Lane C — the orchestrator forces, or asks

Restraint is the design here. `CLAUDE.md` forbids new `ccd` verbs for coordination, and
the wire is additive-only with `FLEET_PROTO` pinned at 1. None of that needs to move.

**1. A section in the plan** — prose, zero code. Two shapes were tried; the first was
wrong. A per-task `Design:` line does not fit: plans list tasks as bullets under
`## Tasks` (`- [x] **Task 4 — ...**`), and an inline field there reads as noise. The
declaration is therefore per PLAN, in the same section vocabulary the plans already have
beside `## Deviations found` and `## Measurements`:

```markdown
## Design

**Posture:** required            # required | offer | none
**Brief:** docs/design/briefs/session-line.md
```

**2. A clause in each skill — and it turns out neither needs one.** The worker's clause 6
already reads *"Your requirements are the brief plus the plan file it names"*, so a design
brief named in the wave brief is already binding. What was missing was on the
coordinator's side, and it belongs in the wave lifecycle's dispatch step rather than in
the pinned contract: read the posture before `POST /api/runs/:id/dispatch`.

- `required` → the brief path from that section goes INTO the wave brief
- `offer` → **ask with the AskUserQuestion tool** and wait. The first draft of this spec
  said `POST /api/asks`; that route does not exist, and `coordinator-skill.test.ts`'s
  route-linkage check caught it. Asks are *created* by the tool through the session hook,
  not posted. The reasoning survives the correction intact and is in fact stronger: an ask
  reaches the operator's phone and needs no box token to answer, so a design gate cannot
  become a wedge with no door.
- `none` → dispatch says nothing about design

Adding no clause means the pinned `CONTRACT` arrays and their count-word check do not
move, which is the cheapest possible diff for this lane.

**3. A guard test.** *"A comment is a request; a red suite is a mechanism."*
`server/test/design-declaration.test.ts` scans `docs/superpowers/plans/` and reds a plan
that names `ui/src/**` or a `pwa/src/**.tsx` and carries no `## Design` section with a
valid posture.

Three properties of it are deliberate:

- It checks that the question was **answered**, never which answer was given. `none`
  passes exactly as `required` does. A guard that demanded canvases would be a guard that
  lies about what it measures.
- The floor is a **filename date** (`2026-09-29`), not an exemption list. 101 plans
  predate the convention and none will grow the section; a list of 101 names would rot,
  a date is a boundary anyone can see.
- Three of its six cases are the guards-the-guard: today no in-scope UI plan exists, so
  the corpus scan passes vacuously, and fixtures carry the real assertions. The scan half
  was mutation-checked separately — an in-scope UI plan with no section reds and names
  itself in the failure.

## What this design deliberately does NOT build

- **No `designPolicy` field on the run row, and nothing on the wire.** Prose plus the
  guard test covers "force or ask" without touching a protocol whose whole discipline is
  that it does not move.
- **No new `ccd` verb.** Forbidden, and unnecessary.
- **No two-way sync.** See lane A's invariant.
- **No second contrast authority.** The Claude Design project renders what the gate
  already passed; it never admits a pair the gate refused.

## Order of work — each step independently revertable

1. `ui` build script + `tsconfig.build.json` + `.design-sync/config.json`; first sync;
   `projectId` recorded. **On wave 1's 7 primitives**, not after wave 2: a small first
   pass surfaces every converter trap cheaply, and wave 2 then arrives as an incremental
   re-sync where verified components cost nothing.

   (The "~45 components" this paragraph originally named was wrong — see the wave 2
   plan's measured scope. Wave 2 turned out to add no components to the design system at
   all: it migrated CALL SITES onto the existing seven, so the re-sync re-verified seven
   and added none. The ordering argument held anyway, and for a better reason than the
   one given: the traps a first sync surfaces are per-repo, not per-component.)
2. `docs/design/` — brief template, `CANVASES.md` register.
3. The two skill clauses + the guard test. **AGENT-FIRST**: anything under `ccd/` ships to
   the fleet host before the server.

## What landed, 2026-09-29

All three lanes shipped the same day this was written. Recorded here because the section
this replaces said the opposite and was false within hours.

| Lane | Commit |
|---|---|
| B + C — briefs, register, posture, guard, coordinator clause | `887239e1` |
| A — first sync, plus the Storybook defect it found | `e68f1d58` |
| wave 2 — call sites take the primitives, `legacy.css` retires | `b816c1ce` |
| A — re-sync after wave 2 | `e5a40d22` |

**Two corrections to this document's own claims:**

1. Lane C proposed a per-task `Design:` line. That did not fit — plans list tasks as
   bullets under `## Tasks`, so the declaration became a per-plan `## Design` section.
   Corrected in the lane C text above.
2. Lane C proposed `POST /api/asks` for the `offer` posture. **That route does not
   exist**, and `coordinator-skill.test.ts`'s route-linkage check caught it before it
   shipped. Asks are created by the AskUserQuestion tool through the session hook. The
   argument survived the correction and got stronger; the mechanism named was simply
   wrong.

**The gate moved as lane A predicted it would, and in the direction wave 1 warned about:**
`ALL 482 PASS` -> `ALL 462 PASS` when `legacy.css` retired. Twenty pairs left the census
because they were duplicate rules, not because anything regressed. 462 is the honest
number.

## Open

- **`ccd/coordinator-skill/SKILL.md` changed (`887239e1`, 18 lines) -> AGENT-FIRST.** It
  ships to the fleet host before the server. Not done: it is the operator's call, and
  separately `~/.ccrc/deploy.env` does not exist on this machine, so `deploy.sh` would
  refuse with exit 2 rather than guess coordinates.
- **The branch is not merged.** Six commits on `design-system`, nothing pushed.
- **The contrast gate does not reach Claude Design.** `pwa/design/audit.mjs` runs over
  this repo's stylesheets; designs the agent produces there are outside it, so a canvas
  can show a pair the gate would refuse. Caught at the code step, not the design step.
