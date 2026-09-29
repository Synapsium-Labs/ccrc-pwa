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

**1. A line in the plan task** — prose, zero code:

```markdown
### Task 7: SessionLine → props
Design: required            # required | offer | none
Brief: docs/design/briefs/session-line.md
```

**2. A clause in each skill.** The coordinator reads `Design:` before dispatching a wave:

- `required` → the wave brief must carry the brief path; the worker's wave-done must name
  a `CANVASES.md` line
- `offer` → the coordinator raises an ask (`POST /api/asks`) and waits. This is
  deliberately the ask lane and not a mail note: asks are one of the four **ungated**
  operator doors (D-282), so the question still reaches the operator's phone when the box
  token is gone — which is exactly the wedge a design gate could otherwise create.
- `none` → silence

Both skills' clauses are pinned verbatim by `coordinator-skill.test.ts` and
`worker-skill.test.ts`, so a softened clause is already a red suite. That protection is
free; it comes from where the text lives.

**3. A guard test.** *"A comment is a request; a red suite is a mechanism."* A scan over
`docs/superpowers/plans/`: a task whose text names a path under `pwa/src/**/*.tsx` or
`ui/src/**` and carries no `Design:` line goes red. This is the only thing in lane C that
makes the policy a mechanism rather than a preference, and it ships with the mutation
test that goes red when it is deleted.

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
   pass surfaces every converter trap cheaply, and wave 2's ~45 components then arrive as
   an incremental re-sync where verified components cost nothing.
2. `docs/design/` — brief template, `CANVASES.md` register.
3. The two skill clauses + the guard test. **AGENT-FIRST**: anything under `ccd/` ships to
   the fleet host before the server.

## Open, carried forward

- Wave 2 (~45 domain components) is scoped and not started.
- Wave 1 plus the three earlier pwa fixes are uncommitted on `design-system`.
