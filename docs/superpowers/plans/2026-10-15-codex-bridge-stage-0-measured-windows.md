# Codex bridge, Stage 0: measured context windows — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Every test step follows
> superpowers:test-driven-development: the red test first, seen failing for the reason named, then the change, then
> green, then the task's mutation rows RUN (never read). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a lane's `CLAUDE_CODE_MAX_CONTEXT_TOKENS` becomes the smallest MEASURED window among the models its classes
name, recorded per model by `ccrc models <id> set-window` and removed by `clear-window`, with today's
`min(catalogue context, 200000)` kept, byte for byte, wherever any of those models is unmeasured.

**Architecture:** the windows live in a sibling file, `~/.ccrc/models/<id>.windows.json`, never in the class registry
(D-5160). `shared/models.mjs` gains its reader (`parseWindows`) and the two bounds;
`shared/modelenv.mjs` gains the one decision (`contextWindowFor`), which `modelEnvBlock` writes and `show` reports;
`deploy/models-op.mjs` reads the file once per op (`readWindowsFile`, three states, no overloaded null), passes the
same reading to every `modelEnvBlock` caller, and owns the two new ops; `ccd/ccrc` dispatches them and prints the
summary. No lock, no doctor check, no bridge code: those are later stages or the auto-advance plan's.

**Tech Stack:** bare `node` `.mjs` modules with hand-written `.d.mts` declarations (`shared/`, `deploy/`), bash + jq
(`ccd/ccrc`), vitest in `server/`, TypeScript `tsc` projects in `server/` and `pwa/`.

**Spec:** `docs/superpowers/specs/2026-10-15-codex-bridge-design.md` — §2.7 (the measured-window rule), §4 (what it
amends), §5 (the measured-window tests) and §1.2 (the evidence). Everything else in that spec is a later stage and
out of scope here.

**Branch:** one PR, cut from `origin/main`. Every line number below is at `a3cebde1b`, the commit this plan was
written against; where an anchor moved, find the quoted text, not the number. The PR may merge before R-O9 (the
GPT-lane soak's final sample, spec §2.1): with no windows file on a lane, nothing a lane runs changes (Task 2's
regression row). Applying windows to live lanes is the operator's, after R-O9 (§After R-O9).

**Merge order: the docs first.** The spec this plan cites, and this plan, are not on `a3cebde1b`. They land together
in one docs PR, which merges BEFORE this branch is cut. So every "codex-bridge spec §2.7" comment this plan adds, and
the model-class-registry spec's amendment note (Task 2 Step 6), point at a file the base already holds. Step 1 of
"Before Task 1" checks the order before anything is branched.

**Rulings this plan builds on** (given with the brief, 2026-10-15; not re-decided here):
1. The windows live in the sibling file, not the registry, because `parseRegistry` refuses any unknown top-level key
   (`REGISTRY_KEYS`, `shared/models.mjs:89` and `:196-:203`). Defined here as D-5160.
2. File format `{"windows": {"<model id>": {"tokens": <integer>, "setAt": "<ISO-8601 UTC>"}}}`. `tokens` is an integer
   from 1000 to 1000000 inclusive; `setAt` is optional. Unknown keys, at the top level and inside entries, are
   tolerated, and the writer preserves them by read-modify-write on the raw parsed object.
3. Fixed names, consumed by the auto-advance plan drafted in parallel: `WINDOW_MIN`, `WINDOW_MAX`, `parseWindows`
   (`shared/models.mjs`); `modelEnvBlock(registry, catalogue, windows = null)` and `contextWindowFor(registry,
   catalogue, windows)` (`shared/modelenv.mjs`); `windowsPath(id)` and `readWindowsFile(id)` (`deploy/models-op.mjs`).
   Never rename them.
4. The rule: the class models are the distinct non-null slots among haiku, sonnet, opus and fable. All measured: the
   minimum, rounded down to a multiple of 1000, capped at 1000000, rule `measured`. Any unmeasured, or no readable
   windows: today's rule, unchanged, rule `default` (or `none` where today omits the key). The measured rule does
   not read the catalogue.
5. The verbs sit beside `set-effort`, through the same dispatcher and the same op contract. Both re-materialise.
   Clearing the last entry deletes the file, so absent means no measured windows (narrowed by D-5161).
6. An unreadable windows file: the two verbs refuse with a remedy; `materialise`, the hourly refresh and the drift
   check use the default rule and never block; `show` reports the state and reason. No new doctor WARN.
7. `rm` reaps the windows file. `show` reports the windows, the effective window, its rule and the unmeasured models.
8. Docs: `shared/modelenv.mjs`'s 196k comments rewritten, the README's `ccrc models` section, a note on the
   model-class-registry spec's §6.1.
9. Applying windows to live lanes is not a task (§After R-O9).
10. One PR from `main`. Out of scope: automatic lowering (D25), the bridge, any lock.

## Global Constraints

- **The rule, verbatim from spec §2.7:** "A value is an integer from 1,000 to 1,000,000." "The lane's
  `CLAUDE_CODE_MAX_CONTEXT_TOKENS` is the **smallest** measured window among the models the lane's classes name,
  rounded down to 1k and capped at 1,000,000." "If any of those models has no measured window, the lane keeps today's
  rule, `min(catalogue context, 200000)`." "The operator sets it from a measurement; a catalogue number never sets
  it."
- **Byte-identical default.** A lane with no windows file, or an unreadable one, or one that leaves any class model
  unmeasured, gets exactly today's env block: same keys, same order, same values. No existing assertion in
  `modelenv.test.ts`, `models-op.test.ts` or `ccrc-models.test.ts` is changed, except the two pins this plan names
  (the C7 tmp-site count, Task 4; the `MODELS_SUBS` list, Task 5). Tables gain rows; nothing else is edited.
- **Single definition.** `WINDOW_MIN` and `WINDOW_MAX` are defined once, in `shared/models.mjs`, and imported; no file
  re-spells 1000 or 1000000 as a window bound. The bash layer never validates the count: node does. `ANTHROPIC_MODEL`'s
  chain stays spelled once (`primaryModel`, Task 2). `.windows.json` is spelled only by `deploy/models-op.mjs` and
  `shared/models.mjs` (Task 3's `single-definition` row): never in `ccd/`, `shared/models.ts`, `shared/*.d.mts` or
  `shared/modelenv.mjs`.
- **The models-op contract** (`deploy/models-op.mjs:22-34`): exactly one JSON object on stdout on every path; exit 0
  answer, 1 refusal, 2 usage; re-validate before writing; re-materialise on success. `ccd/ccrc`'s `_models_answer`
  clamps the same contract and is not edited.
- **Rings.** `shared/models.mjs` imports nothing, not even `node:*`. `shared/modelenv.mjs` may import `node:*` and
  `./models.mjs`. `shared/models.ts` (bundled by the PWA) imports only `./models.mjs` and adds types only.
- **Fixture HOMEs only.** Every test runs against a `mkTmp` HOME through the existing harnesses (`op`/`plantCodex` in
  `models-op.test.ts`, `box`/`run`/`seedCodex` in `ccrc-models.test.ts`). Nothing runs `ccrc`, `ccd` or `models-op`
  against the live `$HOME`, and no step sets a window on a live lane.
- **Commands.** Run cd'd into `server/`, in the foreground, timeout at least 600000 ms, one file per command:
  `./node_modules/.bin/vitest run test/<file>.test.ts`. Never a bare `npx vitest`. `typecheck-tests` and the
  `ccrc-models` suite are load-sensitive: re-run a red one alone before calling it a break.
- **Mutation discipline.** Every new guard ships with a row that goes red when the guard is removed or weakened. Run
  each row one at a time on the shipped file, restore it, and prove the restore with `git diff --exit-code -- <file>`
  before the next row. Record each as `<row> → <n> failed (<titles>)` in the task's commit message body. Every count
  below is a prediction: measure it.
- **Public repository.** No lane, account or login names (use `lane-a`, `lane-b`), no hostnames, addresses, absolute
  home paths or private project names. New fixtures and prose use neutral model ids (`model-6.1-alpha`,
  `model-6.1-beta`, `model-9-omega`); a test that needs a fixture lane's model reads it off `SEEDED`/`CODEX` and never
  spells it, and reads roster ids by position (`ROSTER.accounts[2]!.id`), as the files already do (ruling R13).
- **Deviation numbers.** This plan defines two, both issued by the allocator on 2026-10-15: D-5160 (the windows
  live in a sibling file) and D-5161 (clearing the last window keeps a file holding a key this build does not know).
  The code cites them where this plan's code blocks do: D-5160 in `shared/models.mjs` (`parseWindows`' docstring),
  D-5161 in `deploy/models-op.mjs` (`windowOp`'s docstring). A worker never calls the allocator and never writes a
  number of its own: a further departure found while executing is written `D-TBD-<slug>` and named in the task's
  report (worker clause 11), and the coordinator issues its number.
- **Not touched:** `ccd/ccrc-doctor-checks` (no new WARN: a running soak gate allow-lists WARNs by name), the bridge,
  `shared/litellm.mjs`, any lock. Node floor `>=22.16.0` is unchanged.
- **Known stale, left for a follow-up.** Ruling 8 and spec §4 name the comments in `shared/modelenv.mjs` only (Task 2
  rewrites them). Eight more sites state the withdrawn 196k premise as fact, and this PR leaves them as they are:
  `ccd/ccd:1305-1306` (a GENERATED file: an edit needs a restamp, its own change); `shared/litellm.mjs:20` and `:54`
  and `deploy/litellm-config.template.yaml:22` (they argue the removed `[1m]` alias, a separate decision this plan
  does not revisit); `server/src/pane/statusline.ts:45` and `shared/api.ts:87` (the context-percentage notes); and
  the test comments `server/test/modelenv.test.ts:239` and `server/test/models-op.test.ts:679`. The PR body names
  them as one follow-up, so a reader of the merged tree who meets the old figure knows it is known.
- Plan and spec prose stays at most 120 characters a line (code blocks and table rows exempt). Commit on the
  workspace's own branch, never a separate feature branch.

## Review Focus

Five inputs the spec implies and no rule above spells out, the most likely to bite first. Each has its test in the
task that owns the code.

1. **A rollback to an older ccrc after windows were set.** The operator must be able to roll back without every
   lane's registry being refused. Expected: `set-window` and `clear-window` never touch `<id>.classes.json` (bytes and
   mtime unchanged), and the registry still refuses a `windows` key, so nothing can put one there. Pinned in Task 1
   ("the registry still refuses a windows key") and Task 4 ("never rewrites the class registry").
2. **A count written the way people write counts:** `400k`, `400,000`, `4e5`, `400000.0`, a leading space. Expected:
   `bad-window` at exit 1, the field `tokens`, a sentence naming the digits-only form, nothing written. Pinned in
   Task 4's `it.each` of nine spellings.
3. **A class name where a model id belongs** (`set-window opus 400000`). Expected: refused `unknown-window-model`, with
   "set-window takes a MODEL id, not a class" and the `show` remedy, never a silent entry that changes nothing.
   Pinned in Task 4.
4. **A stale entry** for a model no class names any more, after a class moved away. Expected: ignored by the rule
   (it never lowers the lane), still listed by `show`, and removable by `clear-window` although neither the catalogue
   nor the classes name it. Pinned in Task 2 ("a window for a model no class names is ignored") and Task 4 (two rows).
5. **A FIFO or a directory at the windows path.** Expected: `show` and `materialise` answer at once (windows
   `unreadable`, "not a regular file", the default rule), never a block, because the read is type-tested first;
   `set-window` and `clear-window` refuse `windows-unreadable`; `rm` reaps the lane's other four model files and
   stops at a directory with `unwritable`, the answer a directory at any of those four paths already gets. Pinned
   in Task 3's two FIFO rows (in the existing MF-2 describe) and its directory row, and in Task 4's directory row.

---

## File Structure

| File | Change | Task |
|---|---|---|
| `docs/superpowers/plans/2026-10-15-codex-bridge-stage-0-measured-windows.md` | this plan, on `main` from the docs PR; not edited | — |
| `shared/models.mjs` | `WINDOW_MIN`, `WINDOW_MAX`, `parseWindows` after `parseRegistry` | 1 |
| `shared/models.d.mts` | their declarations; `ModelWindows` in the type import/export | 1 |
| `shared/models.ts` | the `ModelWindows` type; three names added to the re-export | 1 |
| `server/test/models.test.ts` | the `parseWindows` describe; the registry-refuses-`windows` pin | 1 |
| `shared/modelenv.mjs` | `primaryModel`, `WINDOW_STEP`, `catalogueWindow`, `contextWindowFor`; `modelEnvBlock`'s third parameter; the 196k comments rewritten | 2 |
| `shared/modelenv.d.mts` | `ContextWindow`, `contextWindowFor`, `modelEnvBlock`'s third parameter, two comments | 2 |
| `server/test/modelenv.test.ts` | the rule's cases and the no-windows regression (Task 2); the C7 tmp-site count 3 → 4 (Task 4) | 2, 4 |
| `server/test/types/ok/legit-modelenv-composition.ts` | the three-argument composition and `contextWindowFor` compiled | 2 |
| `server/test/modelenv-types.test.ts` | one case pinning that the probe drives them | 2 |
| `docs/superpowers/specs/2026-09-08-model-class-registry-design.md` | §6.1: the amendment note | 2 |
| `deploy/models-op.mjs` | `windowsPath`, `readWindowsFile`, `windowsOf`, `windowsReport`, the windows argument to every `modelEnvBlock` caller, `show`'s two fields, `rm` (Task 3); `writeWindows`, `windowOp`, two `OPS` rows (Task 4) | 3, 4 |
| `server/test/models-op.test.ts` | module-scope window helpers, the read/apply/report/reap describe, two FIFO rows (Task 3); the verbs describe, two C6 rows (Task 4) | 3, 4 |
| `server/test/single-definition.test.ts` | one row in "the model files, and who reads each one" | 3 |
| `ccd/ccrc` | `MODELS_SUBS`, two `_models_lane_sub` arms, `_models_summary`'s lines, the `models` usage text | 5 |
| `server/test/ccrc-models.test.ts` | the `MODELS_SUBS` list; the verbs describe | 5 |
| `README.md` | "Model classes per lane: `ccrc models`": the verbs and the rule | 5 |

`modelEnvBlock` has exactly four shipped callers, all in `deploy/models-op.mjs`: `materialise` (`:360`),
`settingsDrift` (`:459`), `renderRefusal` (`:492`) and the mutation tail's routability check (`:1176`). Nothing under
`ccd/`, `server/src/`, `agent/` or `pwa/` calls it. Its test callers (`modelenv.test.ts`, the `test/types/ok/`
probe) pass two arguments and stay valid through the default.

## Before Task 1: the branch and the base

- [ ] **Step 1: Check the merge order, then branch**

First prove the spec and this plan are on the base (Merge order, above):

```bash
git fetch -q origin main
git cat-file -e origin/main:docs/superpowers/specs/2026-10-15-codex-bridge-design.md \
  && git cat-file -e origin/main:docs/superpowers/plans/2026-10-15-codex-bridge-stage-0-measured-windows.md \
  && echo docs-on-main
```

Expected: `docs-on-main`. If it prints nothing, STOP and report: the docs PR has not merged, and a branch cut now
would land comments and a note that point at files `main` does not have.

Cut the workspace branch from `origin/main`. The plan is already in the tree; workers do not edit it.

- [ ] **Step 2: Measure the base**

From `server/`, run each and keep its `Tests` line for the whole-branch checks:

```bash
./node_modules/.bin/vitest run test/models.test.ts
./node_modules/.bin/vitest run test/modelenv.test.ts
./node_modules/.bin/vitest run test/modelenv-types.test.ts
./node_modules/.bin/vitest run test/models-op.test.ts
./node_modules/.bin/vitest run test/ccrc-models.test.ts
./node_modules/.bin/vitest run test/single-definition.test.ts -t 'the model files'
./node_modules/.bin/vitest run test/ccrc-codex.test.ts
./node_modules/.bin/vitest run test/ccrc-codex-launcher.test.ts
./node_modules/.bin/vitest run test/ccgpt-usage.test.ts
```

Expected: every file green. The last three spawn `deploy/models-op.mjs` (directly, or through `ccd/ccrc`'s codex
verbs), so the whole-branch checks re-run them against these lines.

---

### Task 1: the windows file's reader and its bounds

**Files:**
- Modify: `shared/models.mjs` (insert after `parseRegistry`, which ends at `:359`)
- Modify: `shared/models.d.mts` (the type import/export at `:5-9`; declarations after `parseRegistry`'s at `:29`)
- Modify: `shared/models.ts` (a type after `DerivedModels` at `:149-154`; the re-export block at `:165-179`)
- Test: `server/test/models.test.ts` (imports at `:28-32`; a new describe before `describe('familyClassOf'` at `:399`)

**Interfaces:**
- Consumes: `RegistryInvalid(field, message)`, `isObj`, `MODEL_ID_RE` (all `shared/models.mjs`, defined above the
  insertion point).
- Produces:
  - `export const WINDOW_MIN = 1000;` and `export const WINDOW_MAX = 1000000;` (`shared/models.mjs`).
  - `export function parseWindows(json: unknown): ModelWindows` — a frozen, null-prototype object mapping model id to
    tokens (number). Throws `RegistryInvalid` naming the field (`''`, `'windows'`, `'windows.<id>'`,
    `'windows.<id>.tokens'`, `'windows.<id>.setAt'`).
  - `export type ModelWindows = Readonly<Record<string, number>>;` (`shared/models.ts`, re-exported by
    `shared/models.d.mts`).
  - All three values re-exported from `shared/models.ts`.

- [ ] **Step 1: Write the failing tests**

In `server/test/models.test.ts`, extend the value import (`:28-32`) to:

```ts
import {
  CLASSES, CatalogueInvalid, PROBE_KINDS, RegistryInvalid, UNAVAILABLE_PREFIX, WINDOW_MAX, WINDOW_MIN,
  availableFor, classOfModel, deriveModels, familyClassOf, parseCatalogue,
  parseRegistry, parseWindows, resolveDiscovery,
} from '../../shared/models.js';
```

Insert this describe immediately before `describe('familyClassOf', () => {`:

```ts
// ── codex-bridge spec §2.7: a lane's measured context windows ──────────────
// They live in a SIBLING of the registry, `<id>.windows.json`, read by
// `parseWindows`. Neutral model ids only: this repository is public.
describe('parseWindows (codex-bridge spec §2.7)', () => {
  const A = 'model-6.1-alpha';
  const B = 'model-6-beta';

  it('reads each model\'s tokens into a frozen, null-prototype map', () => {
    const w = parseWindows({ windows: {
      [A]: { tokens: 511000, setAt: '2026-10-15T00:00:00.000Z' }, [B]: { tokens: 1000 } } });
    expect({ ...w }).toEqual({ [A]: 511000, [B]: 1000 });
    expect(Object.getPrototypeOf(w)).toBeNull();
    expect(Object.isFrozen(w)).toBe(true);
  });

  it('an empty windows map is legal, and reads as no measured window', () => {
    expect(Object.keys(parseWindows({ windows: {} }))).toEqual([]);
  });

  it('the bounds are 1000 and 1000000, and both are accepted exactly', () => {
    expect(WINDOW_MIN).toBe(1000);
    expect(WINDOW_MAX).toBe(1000000);
    const w = parseWindows({ windows: { [A]: { tokens: WINDOW_MIN }, [B]: { tokens: WINDOW_MAX } } });
    expect({ ...w }).toEqual({ [A]: 1000, [B]: 1000000 });
  });

  it('TOLERATES unknown keys at the top level and inside an entry — the registry\'s opposite', () => {
    const w = parseWindows({ version: 2, future: { x: 1 },
      windows: { [A]: { tokens: 400000, setAt: '2026-10-15T00:00:00.000Z', source: 'probe', note: 'x' } } });
    expect({ ...w }).toEqual({ [A]: 400000 });
  });

  it.each([
    ['a top level that is an array', [], ''],
    ['a null top level', null, ''],
    ['no windows key', {}, 'windows'],
    ['a windows that is an array', { windows: [] }, 'windows'],
    ['a key that is not a model id', { windows: { 'bad id': { tokens: 5000 } } }, 'windows.bad id'],
    ['a __proto__ key', JSON.parse('{"windows":{"__proto__":{"tokens":5000}}}'), 'windows.__proto__'],
    ['an entry that is a bare number', { windows: { [A]: 400000 } }, `windows.${A}`],
    ['tokens as a string', { windows: { [A]: { tokens: '400000' } } }, `windows.${A}.tokens`],
    ['tokens missing', { windows: { [A]: { setAt: '2026-10-15T00:00:00.000Z' } } }, `windows.${A}.tokens`],
    ['a fractional tokens', { windows: { [A]: { tokens: 400000.5 } } }, `windows.${A}.tokens`],
    ['tokens one below the minimum', { windows: { [A]: { tokens: 999 } } }, `windows.${A}.tokens`],
    ['tokens one above the maximum', { windows: { [A]: { tokens: 1000001 } } }, `windows.${A}.tokens`],
    ['a setAt that is not a string', { windows: { [A]: { tokens: 400000, setAt: 1789000000 } } }, `windows.${A}.setAt`],
  ] as [string, unknown, string][])('refuses %s, as RegistryInvalid naming the field', (_why, json, field) => {
    try {
      parseWindows(json);
      expect.unreachable('parseWindows accepted it');
    } catch (e) {
      expect(e).toBeInstanceOf(RegistryInvalid);
      expect((e as RegistryInvalid).field).toBe(field);
    }
  });

  it('the registry still refuses a windows key — the reason the windows live in a sibling file', () => {
    // An older ccrc refuses any registry key it does not know, so a `windows`
    // key in `<id>.classes.json` would brick every lane after a rollback. If
    // this goes green-to-red, someone added `windows` to REGISTRY_KEYS: move
    // it back to the sibling file instead.
    const r = { ...(clone(SEEDED) as Record<string, unknown>), windows: {} };
    try {
      parseRegistry(r);
      expect.unreachable('parseRegistry accepted a windows key');
    } catch (e) {
      expect(e).toBeInstanceOf(RegistryInvalid);
      expect((e as RegistryInvalid).field).toBe('windows');
    }
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `./node_modules/.bin/vitest run test/models.test.ts`
Expected: FAIL. The new cases fail with `TypeError: … parseWindows is not a function` (or `expected undefined to be
1000`); "the registry still refuses a windows key" already passes, because it pins today's behaviour (its red is
mutation W6). Every pre-existing case passes.

- [ ] **Step 3: Write `parseWindows` and the bounds**

In `shared/models.mjs`, insert after the closing `}` of `parseRegistry` (`:359`), before the `resolveDiscovery`
docstring:

```js
/** The bounds of a measured context window, in tokens (codex-bridge spec
 *  §2.7: "an integer from 1,000 to 1,000,000"). `parseWindows` refuses a value
 *  outside them, `deploy/models-op.mjs`'s `set-window` refuses to write one,
 *  and `shared/modelenv.mjs`'s `contextWindowFor` caps at `WINDOW_MAX`. Defined
 *  here, once, and imported by every reader — never re-spelled. */
export const WINDOW_MIN = 1000;
export const WINDOW_MAX = 1000000;

/**
 * `(json: unknown) => ModelWindows` — a lane's MEASURED context windows, read
 * from `~/.ccrc/models/<id>.windows.json`:
 * `{"windows": {"<model id>": {"tokens": <integer>, "setAt": "<ISO-8601 UTC>"}}}`.
 * Returns a frozen, null-prototype object mapping each model id to its tokens.
 *
 * A SIBLING FILE, NOT A REGISTRY KEY (D-5160).
 * `parseRegistry` above refuses any key outside `REGISTRY_KEYS`, so a
 * `windows` key in `<id>.classes.json` would make an older ccrc, after a
 * rollback, refuse every lane's registry — and with it every verb on the
 * lane, the one that could remove the key included. An older ccrc never
 * opens this file, so its lanes fall back to the default window rule, the
 * safe direction.
 *
 * AND THE OPPOSITE POLICY ON UNKNOWN KEYS. The registry refuses them; this
 * file TOLERATES them, at the top level and inside every entry, because it is
 * forward-compatible by design (a later build may record more per model), and
 * `deploy/models-op.mjs`'s writer PRESERVES them by editing the raw parsed
 * object rather than this function's answer.
 *
 * What it refuses, naming the field the way `parseRegistry` does: a top level
 * that is not an object; a `windows` that is missing or not an object; a key
 * that is not a model id (`MODEL_ID_RE`, which refuses `__proto__` too); an
 * entry that is not an object; a `tokens` that is not an integer from
 * `WINDOW_MIN` to `WINDOW_MAX`; a `setAt` that is present and not a string.
 */
export function parseWindows(json) {
  if (!isObj(json)) {
    throw new RegistryInvalid('',
      'a windows file must be a JSON object: {"windows": {"<model id>": {"tokens": <integer>}}}.');
  }
  const raw = json['windows'];
  if (!isObj(raw)) {
    throw new RegistryInvalid('windows',
      `windows is missing or is not an object. It maps each model id to {"tokens": <integer from ${WINDOW_MIN} `
      + `to ${WINDOW_MAX}>}.`);
  }
  const out = Object.create(null);
  for (const [id, entry] of Object.entries(raw)) {
    if (!MODEL_ID_RE.test(id)) {
      throw new RegistryInvalid(`windows.${id}`,
        `windows has the key ${JSON.stringify(id)}, which is not a model id.`);
    }
    if (!isObj(entry)) {
      throw new RegistryInvalid(`windows.${id}`,
        `windows.${id} is ${JSON.stringify(entry)}: each entry is an object, {"tokens": <integer>}.`);
    }
    const tokens = entry['tokens'];
    if (typeof tokens !== 'number' || !Number.isInteger(tokens) || tokens < WINDOW_MIN || tokens > WINDOW_MAX) {
      throw new RegistryInvalid(`windows.${id}.tokens`,
        `windows.${id}.tokens is ${JSON.stringify(tokens)}: it must be an integer from ${WINDOW_MIN} to `
        + `${WINDOW_MAX}.`);
    }
    if (entry['setAt'] !== undefined && typeof entry['setAt'] !== 'string') {
      throw new RegistryInvalid(`windows.${id}.setAt`,
        `windows.${id}.setAt is ${JSON.stringify(entry['setAt'])}: when present it is an ISO-8601 time string.`);
    }
    out[id] = tokens;
  }
  return Object.freeze(out);
}
```

- [ ] **Step 4: Declare and re-export them**

In `shared/models.ts`, insert after the `DerivedModels` interface's closing `}` (`:154`), before the
`// ── EVERYTHING BELOW IS THE SINGLE IMPLEMENTATION` comment:

```ts
/** A lane's MEASURED context windows (codex-bridge spec §2.7): model id →
 *  tokens, as `parseWindows` reads them from the lane's sibling windows file.
 *  Frozen and null-prototype at runtime. Never a field of `Registry`: see
 *  `shared/models.mjs`'s `parseWindows` for why. */
export type ModelWindows = Readonly<Record<string, number>>;
```

and in its re-export block, after `  SUBAGENT_CLASSES,` add:

```ts
  parseWindows,
  WINDOW_MIN,
  WINDOW_MAX,
```

In `shared/models.d.mts`, replace the type import and re-export (`:5-9`) with:

```ts
import type {
  Catalogue, CatalogueModel, DerivedModels, ModelClass, ModelWindows, ProbeKind, Registry,
} from './models.js';

export type { Catalogue, CatalogueModel, DerivedModels, ModelClass, ModelWindows, ProbeKind, Registry };
```

and after `export declare function parseRegistry(json: unknown, catalogue?: Catalogue | null): Registry;` add:

```ts
// Codex-bridge spec §2.7: a lane's measured context windows — see
// `shared/models.mjs` for why they are a sibling file and not a registry key.
export declare const WINDOW_MIN: number;
export declare const WINDOW_MAX: number;
export declare function parseWindows(json: unknown): ModelWindows;
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `./node_modules/.bin/vitest run test/models.test.ts`
Expected: PASS, the base count plus 18.

Run: `./node_modules/.bin/vitest run test/typecheck-tests.test.ts`
Expected: PASS (the test file's new imports resolve through `shared/models.ts` and `shared/models.d.mts`).

- [ ] **Step 6: Measure the mutation rows**

One at a time on `shared/models.mjs` (W7 on `shared/models.d.mts`), each restored and `git diff --exit-code`-checked:
- W1 (drop `|| tokens > WINDOW_MAX`) → 1 failed (refuses tokens one above the maximum…).
- W2 (`tokens < WINDOW_MIN` → `tokens < 1`) → 1 failed (refuses tokens one below the minimum…).
- W3 (insert `for (const k of Object.keys(json)) if (k !== 'windows') throw new RegistryInvalid(k, 'x');` before the
  `raw` read) → 1 failed (TOLERATES unknown keys…).
- W4 (drop the `MODEL_ID_RE` check) → 2 failed (a key that is not a model id; a __proto__ key).
- W5 (`Object.create(null)` → `{}`) → 1 failed (reads each model's tokens into a frozen, null-prototype map).
- W6 (add `'windows'` to `REGISTRY_KEYS`) → 1 failed (the registry still refuses a windows key…).
- W7 (delete the `parseWindows` declaration line in `shared/models.d.mts`; run `typecheck-tests`) → 1 failed in
  `typecheck-tests.test.ts`.

- [ ] **Step 7: Commit**

```bash
git add shared/models.mjs shared/models.d.mts shared/models.ts server/test/models.test.ts
git commit -m "models: parseWindows and the window bounds (codex-bridge Stage 0, Task 1)"
```

---

### Task 2: the one decision — `contextWindowFor` — and `modelEnvBlock`'s third argument

**Files:**
- Modify: `shared/modelenv.mjs` (header `:22-31`; import `:34`; `CLIENT_DEFAULT_CONTEXT_TOKENS` `:58-60`; helpers after
  `slot` `:84-87`; `modelEnvBlock` `:89-238`)
- Modify: `shared/modelenv.d.mts` (`:3`, `:34-39`, `:47-50`)
- Modify: `server/test/types/ok/legit-modelenv-composition.ts`
- Modify: `docs/superpowers/specs/2026-09-08-model-class-registry-design.md` (§6.1, after `:380`)
- Test: `server/test/modelenv.test.ts` (imports `:11-16`; two describes after the end of
  `describe('modelEnvBlock'`, `:299`)
- Test: `server/test/modelenv-types.test.ts` (one case in its describe)

**Interfaces:**
- Consumes: `WINDOW_MIN`, `WINDOW_MAX`, `parseWindows`, `ModelWindows` (Task 1).
- Produces:
  - `export function contextWindowFor(registry, catalogue, windows): { tokens: number | null, rule: 'measured' |
    'default' | 'none', unmeasured: string[] }` — `windows` is a `ModelWindows` map, `null` or `undefined`.
    `unmeasured` lists the class models with no measured window, distinct, in `CLASSES` order.
  - `export function modelEnvBlock(registry, catalogue, windows = null)` — unchanged for a `null` third argument.
  - `export type ContextWindow = { tokens: number | null; rule: 'measured' | 'default' | 'none'; unmeasured:
    string[] }` (`shared/modelenv.d.mts`).

- [ ] **Step 1: Write the failing tests**

In `server/test/modelenv.test.ts`, replace the imports at `:11-16` with:

```ts
import {
  MODEL_ENV_KEYS, ModelEnvInvalid, classesTsv, clearSettingsEnv, contextWindowFor, effortFile, mergeSettingsEnv,
  modelEnvBlock,
} from '../../shared/modelenv.mjs';
import { CLASSES, parseRegistry, parseWindows } from '../../shared/models.js';
import type { Catalogue, ModelWindows, Registry } from '../../shared/models.js';
import { CODEX, CODEX_STALE, SEEDED, UNSEEDED, modelCases } from './fixtures/modelCases.js';
```

Insert after the `});` that closes `describe('modelEnvBlock', …)` (`:299`), before `describe('mergeSettingsEnv'`:

```ts
// ── codex-bridge spec §2.7: the measured-window rule ────────────────────────
// Neutral model ids only: this repository is public.
const ALPHA = 'model-6.1-alpha';
const BETA = 'model-6.1-beta';
const GAMMA = 'model-6.1-gamma';
const DELTA = 'model-6.2-delta';
const nrow = (id: string, context: number | null) => ({
  id, label: id, context, maxContext: context, efforts: [], hidden: false, priceIn: null, priceOut: null,
});
const NEUTRAL: Registry = {
  probe: 'codex',
  classes: { haiku: GAMMA, sonnet: BETA, opus: ALPHA, fable: null },
  subagent: 'sonnet',
  discovery: 'catalogue',
};
const NEUTRAL_CAT: Catalogue = {
  probe: 'codex', fetchedAt: 1789000000, stale: false,
  models: [nrow(ALPHA, 272000), nrow(BETA, 272000), nrow(GAMMA, 272000), nrow(DELTA, 128000)],
};
/** Windows as `parseWindows` reads them off disk — the on-disk shape, never a
 *  hand-built map, except where a case says it builds one in memory. */
const measured = (byModel: Record<string, number>): ModelWindows =>
  parseWindows({ windows: Object.fromEntries(Object.entries(byModel).map(([id, tokens]) => [id, { tokens }])) });
const withClasses = (classes: Partial<Registry['classes']>): Registry =>
  ({ ...NEUTRAL, classes: { ...NEUTRAL.classes, ...classes } });

describe('contextWindowFor — the measured-window rule (codex-bridge spec §2.7)', () => {
  it('every class model measured: the SMALLEST window, written as a string — above 200000 when measured so', () => {
    const w = measured({ [ALPHA]: 511000, [BETA]: 400000, [GAMMA]: 450000 });
    expect(contextWindowFor(NEUTRAL, NEUTRAL_CAT, w)).toEqual({ tokens: 400000, rule: 'measured', unmeasured: [] });
    expect(modelEnvBlock(NEUTRAL, NEUTRAL_CAT, w).CLAUDE_CODE_MAX_CONTEXT_TOKENS).toBe('400000');
  });

  it('rounds the smallest DOWN to a multiple of 1000', () => {
    const w = measured({ [ALPHA]: 600000, [BETA]: 511999, [GAMMA]: 512500 });
    expect(contextWindowFor(NEUTRAL, NEUTRAL_CAT, w).tokens).toBe(511000);
  });

  it('caps at WINDOW_MAX, for a map built in memory past what parseWindows admits', () => {
    const w: ModelWindows = { [ALPHA]: 1500000, [BETA]: 1200000, [GAMMA]: 1100000 };
    expect(contextWindowFor(NEUTRAL, NEUTRAL_CAT, w)).toEqual({ tokens: 1000000, rule: 'measured', unmeasured: [] });
  });

  it('ANY class model unmeasured keeps the default rule exactly, and names the unmeasured', () => {
    const w = measured({ [ALPHA]: 511000, [BETA]: 511000 });
    expect(contextWindowFor(NEUTRAL, NEUTRAL_CAT, w)).toEqual({ tokens: 200000, rule: 'default', unmeasured: [GAMMA] });
    expect(modelEnvBlock(NEUTRAL, NEUTRAL_CAT, w).CLAUDE_CODE_MAX_CONTEXT_TOKENS).toBe('200000');
  });

  it('a class that moves to an unmeasured model falls back to the default rule until it is measured', () => {
    const moved = withClasses({ opus: DELTA });
    // DELTA is now ANTHROPIC_MODEL's model, so the default rule reads ITS row.
    expect(contextWindowFor(moved, NEUTRAL_CAT, measured({ [ALPHA]: 511000, [BETA]: 511000, [GAMMA]: 511000 })))
      .toEqual({ tokens: 128000, rule: 'default', unmeasured: [DELTA] });
    expect(contextWindowFor(moved, NEUTRAL_CAT,
      measured({ [ALPHA]: 511000, [BETA]: 511000, [GAMMA]: 511000, [DELTA]: 300000 })))
      .toEqual({ tokens: 300000, rule: 'measured', unmeasured: [] });
  });

  it('fable counts when it is pinned: four class models need four windows', () => {
    const four = withClasses({ fable: DELTA });
    expect(contextWindowFor(four, NEUTRAL_CAT, measured({ [ALPHA]: 511000, [BETA]: 511000, [GAMMA]: 511000 })))
      .toEqual({ tokens: 200000, rule: 'default', unmeasured: [DELTA] });
  });

  it('two classes on one model need one window — the class models are DISTINCT', () => {
    const shared = withClasses({ haiku: BETA });
    expect(contextWindowFor(shared, NEUTRAL_CAT, measured({ [ALPHA]: 511000, [BETA]: 450000 })))
      .toEqual({ tokens: 450000, rule: 'measured', unmeasured: [] });
    expect(contextWindowFor(shared, NEUTRAL_CAT, measured({ [ALPHA]: 511000 })).unmeasured).toEqual([BETA]);
  });

  it('a window for a model no class names is ignored — it never lowers the lane', () => {
    const w = measured({ [ALPHA]: 300000, [BETA]: 300000, [GAMMA]: 300000, [DELTA]: 5000 });
    expect(contextWindowFor(NEUTRAL, NEUTRAL_CAT, w).tokens).toBe(300000);
  });

  it.each([['fresh', NEUTRAL_CAT], ['stale', { ...NEUTRAL_CAT, stale: true }], ['absent', null]] as
    [string, Catalogue | null][])('the measured rule reads no catalogue: %s alike', (_why, cat) => {
    const w = measured({ [ALPHA]: 400000, [BETA]: 400000, [GAMMA]: 400000 });
    expect(contextWindowFor(NEUTRAL, cat, w)).toEqual({ tokens: 400000, rule: 'measured', unmeasured: [] });
  });

  it('no windows and no catalogue: no key, rule none, every class model unmeasured in CLASSES order', () => {
    expect(contextWindowFor(NEUTRAL, null, null)).toEqual({ tokens: null, rule: 'none', unmeasured: [GAMMA, BETA, ALPHA] });
    expect(Object.keys(modelEnvBlock(NEUTRAL, null, null))).toHaveLength(7);
  });

  it('an unseeded registry is never "every class model measured": an empty set measures nothing', () => {
    expect(contextWindowFor(UNSEEDED, null, measured({}))).toEqual({ tokens: null, rule: 'none', unmeasured: [] });
  });

  it('an in-memory window below WINDOW_MIN, or not an integer, counts as unmeasured — never a window', () => {
    const w: ModelWindows = { [ALPHA]: 500, [BETA]: 400000.5, [GAMMA]: 400000 };
    expect(contextWindowFor(NEUTRAL, NEUTRAL_CAT, w))
      .toEqual({ tokens: 200000, rule: 'default', unmeasured: [BETA, ALPHA] });
  });
});

describe('with no measured windows the env block is today\'s, byte for byte (codex-bridge spec §2.7)', () => {
  /** The eighth key's rule before measured windows existed (§6.1, amended
   *  2026-09-08), restated as the ORACLE. Kept here rather than imported:
   *  importing the implementation would compare it with itself. */
  const before = (reg: Registry, cat: Catalogue | null): string | undefined => {
    const primary = reg.classes.opus ?? reg.classes.sonnet ?? reg.classes.haiku;
    const row = cat === null || cat.stale ? undefined : cat.models.find((m) => m.id === primary);
    return row !== undefined && typeof row.context === 'number' && Number.isInteger(row.context) && row.context > 0
      ? String(Math.min(row.context, 200000)) : undefined;
  };
  const narrow = CODEX.models.find((m) => m.context === 128000)!.id;
  const regs: Registry[] = [
    SEEDED,
    ...modelCases.map((c) => c.reg).filter((r): r is Registry => r !== null),
    // ANTHROPIC_MODEL's model on a 272000 row and haiku on a 128000 one, then
    // the reverse: a default rule that read any class but ANTHROPIC_MODEL's
    // would move one of the two.
    { ...SEEDED, classes: { ...SEEDED.classes, haiku: narrow } },
    { ...SEEDED, classes: { ...SEEDED.classes, opus: narrow } },
  ];
  const cats: (Catalogue | null)[] = [CODEX, CODEX_STALE, null];
  /** Every class model but the first measured: the reading a lane has while
   *  its operator is part-way through set-window. */
  const partial = (reg: Registry): ModelWindows => {
    const ids = [...new Set(CLASSES.map((c) => reg.classes[c]).filter((v): v is string => v !== null))];
    return measured(Object.fromEntries(ids.slice(1).map((id) => [id, 511000])));
  };

  it('every routable fixture, every catalogue: no reading, an empty one or a partial one changes nothing', () => {
    let compared = 0;
    for (const reg of regs) {
      for (const cat of cats) {
        let base: Record<string, string>;
        try { base = modelEnvBlock(reg, cat); } catch { continue; } // unroutable today too
        expect(base.CLAUDE_CODE_MAX_CONTEXT_TOKENS, JSON.stringify(reg.classes)).toBe(before(reg, cat));
        expect(Object.keys(base)).toEqual(MODEL_ENV_KEYS.filter((k) => k in base));
        for (const w of [null, measured({}), partial(reg)]) {
          expect(JSON.stringify(modelEnvBlock(reg, cat, w)), JSON.stringify(reg.classes)).toBe(JSON.stringify(base));
        }
        compared += 1;
      }
    }
    // Guards the guard: 11 routable registries × 3 catalogues today.
    expect(compared).toBeGreaterThanOrEqual(30);
  });
});
```

In `server/test/modelenv-types.test.ts`, add this case after
`it('the probe really does drive mergeSettingsEnv(p, modelEnvBlock(reg, cat)) and clearSettingsEnv(p, MODEL_ENV_KEYS)'`:

```ts
  it('the probe drives the measured-window surface: modelEnvBlock\'s third argument and contextWindowFor', () => {
    // Codex-bridge spec §2.7. Without these two lines in a compiled program,
    // a `.d.mts` that drifted from the `.mjs` would be invisible to tsc.
    const src = readFileSync(probePath, 'utf8');
    expect(src).toContain('mergeSettingsEnv(settingsPath, modelEnvBlock(reg, cat, win))');
    expect(src).toContain('contextWindowFor(reg, cat, win)');
  });
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `./node_modules/.bin/vitest run test/modelenv.test.ts`
Expected: FAIL. Every `contextWindowFor` case fails with `TypeError: … contextWindowFor is not a function`; the
regression describe PASSES (it pins today's behaviour; its red is mutation M10). Every pre-existing case passes.

Run: `./node_modules/.bin/vitest run test/modelenv-types.test.ts`
Expected: FAIL, 1 failed (the probe drives the measured-window surface…).

- [ ] **Step 3: Write the rule in `shared/modelenv.mjs`**

Replace the import at `:34` with:

```js
import {
  CLASSES, SUBAGENT_CLASSES, UNAVAILABLE_PREFIX, WINDOW_MAX, WINDOW_MIN, deriveModels,
} from './models.mjs';
```

Replace the `CLIENT_DEFAULT_CONTEXT_TOKENS` docstring at `:58-59` (the constant's line stays) with:

```js
/** The client's default window for a model id it does not know (spec §6.1).
 *  The DEFAULT window rule never writes more than this; only a measured window
 *  (`contextWindowFor`, codex-bridge spec §2.7) may. */
```

After the `slot` helper (`:84-87`), insert:

```js
/** `ANTHROPIC_MODEL`'s chain, opus ?? sonnet ?? haiku (§6.1), spelled ONCE:
 *  `modelEnvBlock` writes the model it names, and the default window rule
 *  reads that model's catalogue row. It never reaches `fable` — see
 *  `modelEnvBlock` for why. */
const primaryModel = (registry) => slot(registry, 'opus') ?? slot(registry, 'sonnet') ?? slot(registry, 'haiku');

/** A measured window is rounded DOWN to a multiple of this (codex-bridge spec
 *  §2.7: "rounded down to 1k"). */
const WINDOW_STEP = 1000;

/** The DEFAULT rule's number, or null when it has none: the 2026-09-08
 *  amendment's code, moved here unchanged from `modelEnvBlock` so the two rules
 *  sit side by side. Written ONLY when `catalogue` is non-null, NOT stale (§11:
 *  a stale catalogue is the previous one kept after a failed probe), lists the
 *  model `ANTHROPIC_MODEL` resolves to, and that row's `context` is a POSITIVE
 *  INTEGER. */
function catalogueWindow(registry, catalogue) {
  if (catalogue === null || catalogue === undefined || catalogue.stale) return null;
  const primary = primaryModel(registry);
  const row = catalogue.models.find((m) => m.id === primary);
  // A POSITIVE INTEGER only (fix round 1, M2): zero, a negative or a
  // fractional value is not a window — writing one of them verbatim ("0",
  // "-1", "131072.5") would put a number on disk with no window it describes.
  if (row !== undefined && typeof row.context === 'number'
    && Number.isInteger(row.context) && row.context > 0) {
    // min(), not the row's own number (§6.1, amended 2026-09-08): an
    // ADVERTISED context may lower the client's 200k default (a 128k model
    // still compacts at 128k) but never raises it. Raising is the measured
    // rule's job, never an advertised number's.
    return Math.min(row.context, CLIENT_DEFAULT_CONTEXT_TOKENS);
  }
  return null;
}

/**
 * `(registry, catalogue, windows) => { tokens, rule, unmeasured }` — the eighth
 * key, `CLAUDE_CODE_MAX_CONTEXT_TOKENS`, decided ONCE (the model-class-registry
 * spec §6.1, as amended by the codex-bridge spec §2.7). `modelEnvBlock` writes
 * `tokens` as a string, or omits the key when it is null, and `ccrc models <id>
 * show` reports all three fields. The key exists because Claude Code assumes a
 * 200k window for any model id it does not know and compacts proactively at
 * that window; the key replaces that assumption for EVERY model in the
 * session, subagents and quick tasks included.
 *
 * THE MEASURED RULE (`rule: 'measured'`). The lane's class models are the
 * distinct non-null slots among haiku, sonnet, opus and fable. When every one
 * of them has a measured window in `windows` (the lane's sibling windows file,
 * read by `parseWindows` in `shared/models.mjs`), the key is the SMALLEST of
 * them, rounded down to a multiple of 1000 and capped at `WINDOW_MAX`: Claude
 * Code applies the one value to every model in the session, so the smallest is
 * the only safe one. The rule reads no catalogue: a measured window is a fact
 * the operator measured about the backend, not a number a catalogue
 * advertised, so it holds whether the catalogue is fresh, stale or absent. A
 * window for a model no class names is ignored. An empty set of class models
 * (an unseeded registry) is never "every one measured". A value built in
 * memory that is not an integer, or is below `WINDOW_MIN`, counts as
 * unmeasured: `parseWindows` refuses both on disk, and this function never
 * writes a window of that shape, whoever built the object.
 *
 * THE DEFAULT RULE (`rule: 'default'`, or `'none'` when it yields nothing),
 * unchanged from 2026-09-08: when any class model has no measured window, or
 * there is no windows reading at all, the key is `catalogueWindow`'s
 * `min(catalogue context, 200000)` for `ANTHROPIC_MODEL`'s model, or OMITTED —
 * never sentinelled: there is no "unavailable" reading for a window, only
 * "unknown", and the client's own default already means "unknown". A class
 * that moves to a new model, by hand or by auto-advance, therefore falls back
 * here until the new model is measured.
 *
 * THE PREMISE THE MEASURED RULE REPLACES. The default rule's 200k cap was
 * first argued from a "196k wall", the largest prompt one home had ever had
 * accepted, in one July sample. A whole-fleet scan on 2026-10-15 withdrew it
 * (codex-bridge spec §1.2): prompts of 548,799 and 584,415 tokens had been
 * accepted on two different models in September, the six context refusals on
 * record sat near 373k and moved over time, and every model the lanes'
 * classes name accepted about 512k in a stepped probe that day. The cap stays
 * only where nothing is measured.
 *
 * `unmeasured` lists the class models with no measured window, distinct and in
 * `CLASSES` order. It is empty when `rule` is `measured`, and on an unseeded
 * registry.
 */
export function contextWindowFor(registry, catalogue, windows) {
  const models = [];
  for (const cls of CLASSES) {
    const id = slot(registry, cls);
    if (id !== null && !models.includes(id)) models.push(id);
  }
  const measuredOf = (id) => {
    if (windows === null || windows === undefined || !Object.prototype.hasOwnProperty.call(windows, id)) {
      return null;
    }
    const v = windows[id];
    return typeof v === 'number' && Number.isInteger(v) && v >= WINDOW_MIN ? v : null;
  };
  const unmeasured = models.filter((id) => measuredOf(id) === null);
  if (models.length > 0 && unmeasured.length === 0) {
    const least = Math.min(...models.map(measuredOf));
    return { tokens: Math.min(Math.floor(least / WINDOW_STEP) * WINDOW_STEP, WINDOW_MAX), rule: 'measured', unmeasured };
  }
  const tokens = catalogueWindow(registry, catalogue);
  return { tokens, rule: tokens === null ? 'none' : 'default', unmeasured };
}
```

In `modelEnvBlock`'s docstring, replace its first four lines (`:90-93`, from `` * `(registry: Registry, catalogue:
Catalogue | null) => Record<string, string>` `` to `` * it (§6.1, amended 2026-09-08). ``) with:

```js
 * `(registry: Registry, catalogue: Catalogue | null, windows?: ModelWindows | null) => Record<string, string>`
 * — the seven MANDATORY variables of §6.1, plus an eighth,
 * `CLAUDE_CODE_MAX_CONTEXT_TOKENS`, written whenever `contextWindowFor` yields
 * a window (§6.1, amended 2026-09-08 and by the codex-bridge spec §2.7).
```

Replace the docstring paragraph at `:149-173` (it begins `` * `CLAUDE_CODE_MAX_CONTEXT_TOKENS` exists because Claude
Code 2.1.263 assumes `` and ends `` * measured window from hitting the provider's own 400 instead. ``) with:

```js
 * `CLAUDE_CODE_MAX_CONTEXT_TOKENS` is `contextWindowFor(registry, catalogue,
 * windows)`'s answer: the smallest measured window when every class model has
 * one, else the default rule, else omitted. That function's docstring carries
 * both rules and the premise the measured one replaced. It is written as a
 * STRING: every other value in this block is one, env vars are always strings
 * on the wire, and a bare number here would be the one key that differs.
 * `windows` is the lane's measured windows (`parseWindows`) or null; null, the
 * default, gives exactly the block this function wrote before measured windows
 * existed. `CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT` is never
 * written by this function, or anywhere else in this design (§6.1): the
 * proactive compaction it would disable is what keeps a lane whose window is
 * set wrong from hitting the provider's own 400 instead.
```

Replace the signature line at `:178` and the `primary` line at `:183`:

```js
export function modelEnvBlock(registry, catalogue, windows = null) {
```

```js
  const primary = primaryModel(registry);
```

Replace the eighth-key block at `:217-236`, from
`  if (catalogue !== null && catalogue !== undefined && !catalogue.stale) {` to the closing `  }` before
`  return block;`, with:

```js
  // The eighth key: ONE decision, `contextWindowFor`'s, which `show` reports
  // too. Omitted, never sentinelled, when it yields no window.
  const room = contextWindowFor(registry, catalogue, windows);
  if (room.tokens !== null) block.CLAUDE_CODE_MAX_CONTEXT_TOKENS = String(room.tokens);
```

Replace the header comment at `:24-31`, from ``// The EIGHTH key, `CLAUDE_CODE_MAX_CONTEXT_TOKENS` (spec §6.1, amended``
to `// hitting the provider's 400 ("input exceeds the context window").`, with:

```js
// The EIGHTH key, `CLAUDE_CODE_MAX_CONTEXT_TOKENS` (`contextWindowFor` below:
// the model-class-registry spec §6.1, amended 2026-09-08 and again by the
// codex-bridge spec §2.7), gets neither treatment: it is OMITTED, never
// sentinelled, when neither the measured rule nor the default rule yields a
// window — there is no "unavailable" reading for a context size, only
// "unknown", and Claude Code's own 200k default already means "unknown" to the
// client. `CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT` is never set
// by this file or by anything this design writes: that proactive compaction is
// what keeps an unexpectedly large lane from hitting the provider's 400
// ("input exceeds the context window").
```

After these edits `git grep -n '196' shared/modelenv.mjs` prints only the docstring's "196k wall" sentence of the
premise paragraph, and `git grep -nE 'gpt-[0-9]' shared/modelenv.mjs` prints nothing.

- [ ] **Step 4: Declare it in `shared/modelenv.d.mts`**

Replace `:3` with:

```ts
import type { Catalogue, ModelWindows, Registry } from './models.js';
```

Replace the comment above `CLAUDE_CODE_MAX_CONTEXT_TOKENS?: string;` (`:34-39`) with:

```ts
  // The eighth key (§6.1, amended 2026-09-08; amended again by the
  // codex-bridge spec §2.7): `contextWindowFor(...).tokens` as a string — the
  // smallest measured window across the lane's class models when every one is
  // measured, else `min(catalogue context, 200000)` for ANTHROPIC_MODEL's
  // model when the catalogue is non-null, not stale and names it with a
  // POSITIVE INTEGER context; absent otherwise.
```

Replace `:47-50` (the `CLIENT_DEFAULT_CONTEXT_TOKENS` docstring, its declaration and `modelEnvBlock`'s declaration)
with:

```ts
/** The client's default window for a model id it does not know (spec §6.1).
 *  The DEFAULT window rule never writes more than this; a measured window may. */
export declare const CLIENT_DEFAULT_CONTEXT_TOKENS: number;
/** What decided the eighth key (codex-bridge spec §2.7): `tokens` is what
 *  `modelEnvBlock` writes (null: omitted); `unmeasured` is the class models with
 *  no measured window, in CLASSES order. */
export type ContextWindow = {
  tokens: number | null;
  rule: 'measured' | 'default' | 'none';
  unmeasured: string[];
};
export declare function contextWindowFor(
  registry: Registry, catalogue: Catalogue | null, windows: ModelWindows | null | undefined,
): ContextWindow;
export declare function modelEnvBlock(
  registry: Registry, catalogue: Catalogue | null, windows?: ModelWindows | null,
): ModelEnv;
```

- [ ] **Step 5: Compile the new surface in the positive-control probe**

In `server/test/types/ok/legit-modelenv-composition.ts`, replace the two imports and the three `declare const`
lines with:

```ts
import {
  MODEL_ENV_KEYS, clearSettingsEnv, contextWindowFor, mergeSettingsEnv, modelEnvBlock,
} from '../../../../shared/modelenv.mjs';
import type { ContextWindow } from '../../../../shared/modelenv.mjs';
import type { Catalogue, ModelWindows, Registry } from '../../../../shared/models.js';

declare const reg: Registry;
declare const cat: Catalogue | null;
declare const win: ModelWindows | null;
declare const settingsPath: string;
```

and append at the end of the file:

```ts

// Codex-bridge spec §2.7: the lane's measured windows, passed in
// modelEnvBlock's third argument, and the decision `show` reports. Compiled
// here, so a declaration that drifts from the `.mjs` is a red tsc, never a
// quiet gap.
export const mergedMeasured = mergeSettingsEnv(settingsPath, modelEnvBlock(reg, cat, win));
export const room: ContextWindow = contextWindowFor(reg, cat, win);
```

The probe must stay free of the substring `' as '` (space, "as", space), in comments too: an existing case of
`modelenv-types.test.ts` ("the probe really does drive mergeSettingsEnv…", `:71`) pins
`expect(src).not.toContain(' as ')` over the whole file, so a phrase such as "the windows as its third argument"
reds it. Check the edited file:

```bash
grep -c ' as ' server/test/types/ok/legit-modelenv-composition.ts
```

Expected: `0`.

- [ ] **Step 6: Note the amendment in the model-class-registry spec**

In `docs/superpowers/specs/2026-09-08-model-class-registry-design.md`, after the line
`2026-09-08, fleet-host measurement; Task 16c)` (`:380`), insert a blank line and:

```markdown
> **Amended by `2026-10-15-codex-bridge-design.md` §2.7 (2026-10-15).** The 196k premise above is withdrawn: it was
> the maximum of one July sample from one home, and a whole-fleet scan found prompts of 548,799 and 584,415 tokens
> accepted (that spec's §1.2). The "measured ceiling" this paragraph defers to now exists, as a sibling file of
> per-model windows, `~/.ccrc/models/<id>.windows.json`, never a registry key (an older ccrc would refuse one after a
> rollback). `ccrc models <id> set-window` and `clear-window` edit it. When every model the lane's classes name has a
> window, the key is the smallest, rounded down to 1,000 and capped at 1,000,000; when any lacks one,
> `min(catalogue.context, 200000)` above applies unchanged.
```

- [ ] **Step 7: Run the tests to see them pass**

Run: `./node_modules/.bin/vitest run test/modelenv.test.ts`
Expected: PASS, the base count plus 15.

Run: `./node_modules/.bin/vitest run test/modelenv-types.test.ts`
Expected: PASS (its first case runs `tsc` over `test/types/tsconfig.ok.json`, which now compiles the new probe lines;
its "no cast anywhere" assertion holds because Step 5's `grep -c` printed `0`).

Run: `./node_modules/.bin/vitest run test/single-definition.test.ts`
Expected: PASS (the SMALL_FAST chain pin at `:1925-1927` and the class-enumeration census still hold).

Run: `./node_modules/.bin/vitest run test/models-op.test.ts`
Expected: PASS, unchanged count (two-argument callers keep today's block).

- [ ] **Step 8: Measure the mutation rows**

One at a time on `shared/modelenv.mjs` (M13 on `shared/modelenv.d.mts`), each restored and checked:
- M1 (`Math.min(...models.map(measuredOf))` → `Math.max(…)`) → 4 failed (every class model measured: the SMALLEST…;
  rounds the smallest DOWN…; a class that moves…, its second call; two classes on one model…).
- M2 (`Math.floor(least / WINDOW_STEP) * WINDOW_STEP` → `least`) → 1 failed (rounds the smallest DOWN…).
- M3 (drop the outer `Math.min(…, WINDOW_MAX)`) → 1 failed (caps at WINDOW_MAX…).
- M4 (`unmeasured.length === 0` → `unmeasured.length < models.length`) → 5 failed (ANY class model unmeasured…; a
  class that moves…; fable counts…; an in-memory window below WINDOW_MIN…; every routable fixture…, on its partial
  reading).
- M5 (drop `models.length > 0 &&`) → 1 failed (an unseeded registry is never…).
- M6 (walk `['haiku', 'sonnet', 'opus']` instead of `CLASSES` for the class models) → 1 failed (fable counts…).
- M7 (gate the measured branch on `catalogue !== null && catalogue !== undefined && !catalogue.stale`) → 2 failed (the
  measured rule reads no catalogue: stale alike; absent alike).
- M8 (the minimum over `Object.values(windows)` instead of the class models) → 1 failed (a window for a model no class
  names…).
- M9 (`measuredOf` returns `v` for any number) → 1 failed (an in-memory window below WINDOW_MIN…).
- M10 (`catalogueWindow` reads the haiku slot's row: `slot(registry, 'haiku') ?? primaryModel(registry)`) → 2 failed
  (a class that moves…, its first call; every routable fixture, every catalogue…).
- M11 (`modelEnvBlock` calls `contextWindowFor(registry, catalogue, null)`) → 1 failed (every class model measured…, at
  its `modelEnvBlock` line).
- M12 (drop `&& !models.includes(id)`) → 1 failed (two classes on one model…).
- M13 (delete `contextWindowFor`'s declaration in `shared/modelenv.d.mts`) → 1 failed in `modelenv-types.test.ts`
  (the module's own canonical composition compiles clean).

- [ ] **Step 9: Commit**

```bash
git add shared/modelenv.mjs shared/modelenv.d.mts server/test/modelenv.test.ts server/test/modelenv-types.test.ts \
  server/test/types/ok/legit-modelenv-composition.ts docs/superpowers/specs/2026-09-08-model-class-registry-design.md
git commit -m "modelenv: the measured-window rule, contextWindowFor (codex-bridge Stage 0, Task 2)"
```

---

### Task 3: models-op reads the windows file once, applies it everywhere, reports it and reaps it

**Files:**
- Modify: `deploy/models-op.mjs` (header `:36-41`; imports `:60-67`; `ACCOUNT_ID_RE` docstring `:72-78`; path helpers
  `:112-121`; after `readRegistry` `:256`; `materialise` `:339-360`; `settingsDrift` `:452-459`; `renderRefusal`
  `:488-492`; `describe` `:500-516`; `orphanDescribe` `:525-538`; `main`'s C6 comment `:687`, `rm` `:742-765`,
  orphan show `:787-795`, registry read and `show` `:817-825`, `materialise` op `:909`, `init` `:930`, `:965`,
  `:967`, the tail `:1171-1193`)
- Test: `server/test/models-op.test.ts` (module helpers after `endpoints` `:145`; a describe after the `rm` describe
  ends `:1619`; two rows in the FIFO describe after its registry row `:1698`)
- Test: `server/test/single-definition.test.ts` (one row after "the REGISTRY file is named by exactly four files"
  `:1760`)

**Interfaces:**
- Consumes: `parseWindows`, `RegistryInvalid` (Task 1); `contextWindowFor`, `modelEnvBlock(…, windows)` (Task 2).
- Produces (all module-level in `deploy/models-op.mjs`, which is a script and exports nothing new):
  - `windowsPath(id: string): string` — `~/.ccrc/models/<id>.windows.json`.
  - `readWindowsFile(id)` — exactly one of `{ state: 'absent' }`, `{ state: 'ok', windows: ModelWindows, raw: object }`,
    `{ state: 'unreadable', reason: string }`.
  - `windowsOf(reading): ModelWindows | null` — the one place `absent` and `unreadable` fold, for the rule's input.
  - `windowsReport(reading)` — `{ state: 'absent' }`, `{ state: 'unreadable', reason }` or
    `{ state: 'ok', byModel: { [model]: { tokens: number, setAt: string | null } } }`.
  - `materialise(account, registry, catalogue, windows)`, `settingsDrift(account, registry, catalogue, windows)`,
    `renderRefusal(registry, catalogue, windows)` — `windows` is `windowsOf(reading)`.
  - `describe(account, registry, catalogue, reading)` and `orphanDescribe(id, registry, catalogue, reading)` — both
    add `windows: windowsReport(reading)` and `contextWindow: contextWindowFor(…) | null` (null with no registry).
  - In `main`, `const win = readWindowsFile(a.id)` once per op, after the registry read; Task 4's `windowOp` takes it.
  - **Callable only inside `deploy/models-op.mjs`.** The file is a script: its last line is
    `process.exit(main(process.argv))`, so importing it (as `ACCOUNT_ID_RE`'s existing `export` might suggest) runs
    `main` and exits the importer. The auto-advance plan, which consumes `windowsPath` and `readWindowsFile` (ruling 3),
    must therefore edit this same file and call them from code inside it, never import them. Tell that plan's
    author so before either plan executes.

- [ ] **Step 1: Write the failing tests**

In `server/test/models-op.test.ts`, add these module-scope helpers after the `endpoints` helper (`:141-145`):

```ts
// Codex-bridge spec §2.7: the lane's measured windows, a SIBLING of the
// registry. Model ids are read off the fixtures and roster ids by position,
// never spelled: this repository is public.
const winPath = (id: string): string => path.join(home, '.ccrc', 'models', `${id}.windows.json`);
/** The planted registry's class models, distinct and in CLASSES order: what the rule measures. */
const CLASS_MODELS: string[] = [...new Set(Object.values(SEEDED.classes).filter((v): v is string => v !== null))];
const windowsFor = (byModel: Record<string, number>): unknown =>
  ({ windows: Object.fromEntries(Object.entries(byModel).map(([m, tokens]) => [m, { tokens }])) });
const plantWindows = (id: string, body: unknown): void => {
  fs.mkdirSync(path.dirname(winPath(id)), { recursive: true });
  fs.writeFileSync(winPath(id), typeof body === 'string' ? body : `${JSON.stringify(body, null, 2)}\n`);
};
const LEGACY_SUFFIX = ROSTER.accounts[2]!.configDirSuffix;
const eighthKey = (): string | undefined => settingsOf(LEGACY_SUFFIX).env['CLAUDE_CODE_MAX_CONTEXT_TOKENS'];
```

Insert this describe after the `});` that closes `describe('rm (§4.1 Lifecycle, §10, §11) — reap, not a mutation'`:

```ts
describe('the measured windows file — read, applied, reported, reaped (codex-bridge spec §2.7)', () => {
  const ID = LEGACY_EXTERNAL_ID;
  const all = (tokens: number): unknown => windowsFor(Object.fromEntries(CLASS_MODELS.map((m) => [m, tokens])));
  const mat = (): Result => op('materialise', '--file', rosterPath(), '--id', ID);
  const show = (): Result => op('show', '--file', rosterPath(), '--id', ID);

  beforeEach(() => {
    writeCatalogue(ID);
    plantCodex(ID);
  });

  it('every class model measured: materialise writes the SMALLEST window — above 200000 when measured so', () => {
    const [m0, m1, m2] = CLASS_MODELS as [string, string, string];
    plantWindows(ID, windowsFor({ [m0]: 511000, [m1]: 450000, [m2]: 400000 }));
    const r = mat();
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(eighthKey()).toBe('400000');
  });

  it('one class model unmeasured: the key stays today\'s 200000', () => {
    const [m0, m1] = CLASS_MODELS as [string, string];
    plantWindows(ID, windowsFor({ [m0]: 511000, [m1]: 511000 }));
    expect(mat().code).toBe(0);
    expect(eighthKey()).toBe('200000');
  });

  it('with no windows file the env block is today\'s, every key', () => {
    const { haiku, sonnet, opus } = SEEDED.classes;
    expect(mat().code).toBe(0);
    expect(settingsOf(LEGACY_SUFFIX).env).toEqual({
      ANTHROPIC_DEFAULT_HAIKU_MODEL: haiku, ANTHROPIC_DEFAULT_SONNET_MODEL: sonnet,
      ANTHROPIC_DEFAULT_OPUS_MODEL: opus, ANTHROPIC_DEFAULT_FABLE_MODEL: 'ccrc-unavailable-fable',
      ANTHROPIC_MODEL: opus, ANTHROPIC_SMALL_FAST_MODEL: haiku, CLAUDE_CODE_SUBAGENT_MODEL: 'sonnet',
      CLAUDE_CODE_MAX_CONTEXT_TOKENS: '200000',
    });
  });

  it.each([
    ['not JSON', '{ this is not json'],
    ['an array', '[]'],
    ['a windows that is not an object', '{"windows": 7}'],
    ['a window below the minimum', JSON.stringify({ windows: { [SEEDED.classes.opus!]: { tokens: 5 } } })],
  ])('an unreadable windows file (%s) never blocks materialise: the default rule applies', (_why, body) => {
    plantWindows(ID, all(400000));
    expect(mat().code).toBe(0);
    expect(eighthKey()).toBe('400000');
    plantWindows(ID, body);
    const r = mat();
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(eighthKey()).toBe('200000');
  });

  it('show reports each measured window, the effective window, its rule and the unmeasured models', () => {
    const [m0, m1, m2] = CLASS_MODELS as [string, string, string];
    plantWindows(ID, { windows: { [m0]: { tokens: 511000, setAt: '2026-10-15T12:00:00.000Z' }, [m1]: { tokens: 450000 } } });
    const r = show();
    expect(r.code).toBe(0);
    expect(r.body['windows']).toEqual({ state: 'ok', byModel: {
      [m0]: { tokens: 511000, setAt: '2026-10-15T12:00:00.000Z' }, [m1]: { tokens: 450000, setAt: null } } });
    expect(r.body['contextWindow']).toEqual({ tokens: 200000, rule: 'default', unmeasured: [m2] });
  });

  it('show with every class model measured reports rule measured', () => {
    plantWindows(ID, all(400000));
    expect(show().body['contextWindow']).toEqual({ tokens: 400000, rule: 'measured', unmeasured: [] });
  });

  it('show with no windows file: state absent, every class model unmeasured', () => {
    const r = show();
    expect(r.body['windows']).toEqual({ state: 'absent' });
    expect(r.body['contextWindow']).toEqual({ tokens: 200000, rule: 'default', unmeasured: CLASS_MODELS });
  });

  it('show on an unreadable windows file answers ok, names the file and the reason, and reports the default rule', () => {
    plantWindows(ID, '{ this is not json');
    const r = show();
    expect(r.code).toBe(0);
    const w = r.body['windows'] as { state: string; reason: string };
    expect(w.state).toBe('unreadable');
    expect(w.reason).toContain(winPath(ID));
    expect(w.reason).toMatch(/is not valid JSON/);
    expect((r.body['contextWindow'] as { rule: string }).rule).toBe('default');
  });

  it('settingsDrift names the eighth key once the windows moved past the last materialise', () => {
    plantWindows(ID, all(400000));
    expect(show().body['settingsDrift']).toEqual(['CLAUDE_CODE_MAX_CONTEXT_TOKENS']);
    expect(mat().code).toBe(0);
    expect(show().body['settingsDrift']).toEqual([]);
  });

  it('an unreadable windows file adds no drift: the drift check reads it as the default rule', () => {
    plantWindows(ID, '[]');
    expect(show().body['settingsDrift']).toEqual([]);
  });

  it('a DIRECTORY at the windows path: show reports it unreadable, materialise carries on, rm stops at it', () => {
    fs.mkdirSync(winPath(ID), { recursive: true });
    const s = show();
    expect(s.code, s.stdout + s.stderr).toBe(0);
    expect(s.body['windows']).toMatchObject({ state: 'unreadable' });
    expect((s.body['windows'] as { reason: string }).reason).toMatch(/not a regular file/);
    const m = mat();
    expect(m.code, m.stdout + m.stderr).toBe(0);
    expect(eighthKey()).toBe('200000');
    // `rm -f` semantics per file, as for the other four: a directory is not a
    // file `rm` may unlink, so it reaps the four before it and stops there,
    // the answer a directory at any of those four paths already gets.
    const r = op('rm', '--file', rosterPath(), '--id', ID);
    expect(r.code).toBe(1);
    expect(r.body['error']).toBe('unwritable');
    expect(String(r.body['detail'])).toContain(`${winPath(ID)} could not be removed`);
    expect(fs.existsSync(regPath(ID))).toBe(false);
  });

  it('a class that moves to an unmeasured model drops the lane back to the default rule (spec §5)', () => {
    plantWindows(ID, all(400000));
    expect(mat().code).toBe(0);
    expect(eighthKey()).toBe('400000');
    const next = CODEX.models.find((m) => !m.hidden && !CLASS_MODELS.includes(m.id) && m.context === 272000)!.id;
    const r = op('set-class', '--file', rosterPath(), '--id', ID, '--class', 'opus', '--model', next);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(eighthKey()).toBe('200000');
    expect(r.body['contextWindow']).toEqual({ tokens: 200000, rule: 'default', unmeasured: [next] });
  });

  it('rm reaps the windows file with the lane\'s other model files, last', () => {
    plantWindows(ID, all(400000));
    const r = op('rm', '--file', rosterPath(), '--id', ID);
    expect(r.code).toBe(0);
    expect(r.body['removed'] as string[]).toHaveLength(5);
    expect((r.body['removed'] as string[]).slice(-1)).toEqual([winPath(ID)]);
    expect(fs.existsSync(winPath(ID))).toBe(false);
  });

  it('rm reaps an unreadable windows file too — rm -f semantics, not a validated read', () => {
    plantWindows(ID, '{ this is not json');
    expect(op('rm', '--file', rosterPath(), '--id', ID).code).toBe(0);
    expect(fs.existsSync(winPath(ID))).toBe(false);
  });

  it('an ORPHAN show reports its windows too', () => {
    fs.writeFileSync(regPath('ghost'), fs.readFileSync(regPath(ID), 'utf8'));
    plantWindows('ghost', all(400000));
    const r = op('show', '--file', rosterPath(), '--id', 'ghost');
    expect(r.body['orphan']).toBe(true);
    expect((r.body['windows'] as { state: string }).state).toBe('ok');
    expect((r.body['contextWindow'] as { rule: string }).rule).toBe('measured');
  });
});
```

In the FIFO describe (`describe('a FIFO at a lane file\'s path is that read\'s unreadable answer…'`), insert after the
`it('show with a FIFO registry answers registry-unreadable'` case:

```ts
  it('show with a FIFO windows file answers ok: the windows unreadable, never a block (codex-bridge spec §2.7)', () => {
    init();
    fifo(path.join(home, '.ccrc', 'models', `${CODEX_ROW.id}.windows.json`));
    const r = bounded('show', '--file', rosterPath(), '--id', CODEX_ROW.id);
    expect(r.code, r.stdout).toBe(0);
    expect(r.body['windows']).toMatchObject({ state: 'unreadable' });
    expect((r.body['windows'] as { reason: string }).reason).toMatch(/not a regular file/);
  }, 20_000);

  it('materialise with a FIFO windows file answers ok under the default rule — never a block (codex-bridge spec §2.7)', () => {
    init();
    fifo(path.join(home, '.ccrc', 'models', `${CODEX_ROW.id}.windows.json`));
    const r = bounded('materialise', '--file', rosterPath(), '--id', CODEX_ROW.id);
    expect(r.code, r.stdout).toBe(0);
  }, 20_000);
```

In `server/test/single-definition.test.ts`, inside `describe('the model files, and who reads each one'`, insert after
the `it('the REGISTRY file is named by exactly four files, and edited by one of them'` case:

```ts
  it('the WINDOWS file is named by exactly two files, and only models-op can write it (codex-bridge spec §2.7)', () => {
    // `<id>.windows.json`, the lane's measured context windows.
    // `deploy/models-op.mjs` builds its path (`windowsPath`) and is its one
    // writer; `shared/models.mjs` names it in `parseWindows`' docstring and
    // holds no fs call (it imports nothing). A bash tool or a server module
    // spelling it would be a second, unvalidated reader or editor.
    expect(spell('.windows.json')).toEqual(['deploy/models-op.mjs', 'shared/models.mjs']);
  });
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `./node_modules/.bin/vitest run test/models-op.test.ts`
Expected: FAIL. Red: the SMALLEST-window case (`expected '200000' to be '400000'`), the four unreadable rows (their
first half), every `show` case (`windows`/`contextWindow` undefined), the drift case, the class-move case, the two
`rm` cases (`removed` has 4 entries; the file survives), the directory row (`windows` undefined), the orphan case,
and the FIFO `show` row. Green already, because they pin today's behaviour, each with the Step 7 row that reddens
it: "one class model unmeasured" (M4, re-run against this file), "with no windows file…" (R10), "an unreadable
windows file adds no drift" (R11) and the FIFO `materialise` row (R7). Every pre-existing case passes.

Run: `./node_modules/.bin/vitest run test/single-definition.test.ts -t 'the model files'`
Expected: FAIL, 1 failed: `expected [ 'shared/models.mjs' ] to deeply equal
[ 'deploy/models-op.mjs', 'shared/models.mjs' ]`.

- [ ] **Step 3: The reading, in `deploy/models-op.mjs`**

Replace the two shared imports (`:60-67`) with:

```js
import {
  CLASSES, CatalogueInvalid, MODEL_ID_RE, PROBE_KINDS, RegistryInvalid, SUBAGENT_CLASSES, availableFor,
  deriveModels, parseCatalogue, parseRegistry, parseWindows,
} from '../shared/models.mjs';
import {
  MODEL_ENV_KEYS, ModelEnvInvalid, classesTsv, clearSettingsEnv, contextWindowFor, effortFile, mergeSettingsEnv,
  modelEnvBlock, readRegular,
} from '../shared/modelenv.mjs';
```

In the `ACCOUNT_ID_RE` docstring, replace these two lines (`:74-75`):

```js
 *  account id becomes a path segment below, in FIVE places (`registryPath`,
 *  `cataloguePath`, `classesTsvPath`, `effortPath`, `laneJsonPath`), so this
```

with these three:

```js
 *  account id becomes a path segment below, in SIX places (`registryPath`,
 *  `cataloguePath`, `classesTsvPath`, `effortPath`, `laneJsonPath`,
 *  `windowsPath`), so this
```

and in `main`'s C6 comment (`:687`), the same count: replace
`  // C6: at op entry, before any of the five per-account paths are built and` with
`  // C6: at op entry, before any of the six per-account paths are built and`.

After `const effortPath = …` (`:119`), insert:

```js
/** The lane's measured context windows (codex-bridge spec §2.7): a SIBLING of
 *  the registry, never a key in it — `shared/models.mjs`'s `parseWindows` says
 *  why. `readWindowsFile` reads it, `writeWindows` writes it, `rm` reaps it. */
const windowsPath = (id) => path.join(modelsDir(), `${id}.windows.json`);
```

After `readRegistry`'s closing `}` (`:256`), insert:

```js
/** The lane's measured windows, as EXACTLY ONE of three states — never an
 *  overloaded null:
 *   - `{ state: 'absent' }`: no file, so no model on this lane is measured.
 *   - `{ state: 'ok', windows, raw }`: `windows` is `parseWindows`' frozen map;
 *     `raw` is the parsed JSON as it was on disk, unknown keys and all, which
 *     `set-window`/`clear-window` edit and write back, so a key this build does
 *     not know survives (spec §2.7: the file is forward-compatible).
 *   - `{ state: 'unreadable', reason }`: a file that exists and cannot be read,
 *     is not JSON, or is not a windows file. `materialise`, the hourly refresh
 *     (which runs `materialise`) and the drift check treat it as NO windows,
 *     the default rule, so they never block on it; `show` names `reason`; the
 *     two window verbs refuse.
 *  Type-tested first (`readRegular`): a FIFO here is `unreadable`, never a
 *  block. */
function readWindowsFile(id) {
  const p = windowsPath(id);
  let text;
  try {
    text = readRegular(p);
  } catch (e) {
    if (e.code === 'ENOENT') return { state: 'absent' };
    return { state: 'unreadable', reason: `${p} could not be read: ${e.message}` };
  }
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { state: 'unreadable', reason: `${p} is not valid JSON: ${e.message}` };
  }
  try {
    return { state: 'ok', windows: parseWindows(raw), raw };
  } catch (e) {
    if (e instanceof RegistryInvalid) {
      return { state: 'unreadable', reason: `${p} is not a windows file this build reads: ${e.message}` };
    }
    throw e;
  }
}

/** The map `modelEnvBlock` and `contextWindowFor` take: an `ok` reading's
 *  windows, and null for `absent` and `unreadable` alike. Both mean "no
 *  measured window" to the RULE (spec §2.7), which is why this is the one
 *  place the two fold; every other reader keeps the three states apart. */
const windowsOf = (reading) => (reading.state === 'ok' ? reading.windows : null);

/** `show`'s report of a reading: each measured window with its `setAt` (null
 *  when the entry carries none), or the reason the file could not be read. */
function windowsReport(reading) {
  if (reading.state === 'absent') return { state: 'absent' };
  if (reading.state === 'unreadable') return { state: 'unreadable', reason: reading.reason };
  const byModel = {};
  for (const id of Object.keys(reading.windows)) {
    const setAt = reading.raw.windows[id].setAt;
    byModel[id] = { tokens: reading.windows[id], setAt: typeof setAt === 'string' ? setAt : null };
  }
  return { state: 'ok', byModel };
}
```

- [ ] **Step 4: Pass the windows to every `modelEnvBlock` caller**

Replace `materialise`'s docstring and signature (`:339-347`) with:

```js
/** §6.1 + §6.4 + §7's TSV, from a lane's registry, its catalogue and its
 *  measured windows — and, on a codex-kind lane, §5.4's `lane.json`
 *  (`laneManifest` above). `windows` is `windowsOf(reading)`: the map, or null
 *  when the windows file is absent or unreadable. An unreadable one never
 *  blocks a materialise (codex-bridge spec §2.7): the lane gets the default
 *  rule and `show` names the file. Returns the four paths, `settings` NULL when
 *  the registry is unseeded — such a lane has no env block to write ("a lane
 *  needs at least one class") but still gets its TSV, because ccd reads that
 *  file on every spawn and an ABSENT file is a different question from a lane
 *  with nothing assigned — and `lane` NULL when the account is not
 *  `exec.kind: 'codex'`, the same "legitimately not written" idiom. `wrote` is
 *  null only when there is no registry at all. */
function materialise(account, registry, catalogue, windows) {
```

and its comment and call at `:356-360` with:

```js
    // `catalogue` and `windows` are the SAME values the caller already loaded
    // to compute `derived`/`settingsDrift` (spec §6.1 amendment) — never a
    // second read of `<id>.json` or of the windows file, so a materialise never
    // disagrees with the `show` answer it is bundled with.
    block = modelEnvBlock(registry, catalogue, windows);
```

In `settingsDrift`'s docstring, replace its last paragraph (`:452-454`, which begins
``Takes the SAME `catalogue` the caller already parsed``) with:

```js
 *  Takes the SAME `catalogue` and `windows` the caller already read — never a
 *  second read — because `modelEnvBlock` needs both to know what the eighth
 *  key should be, and whether it belongs in `want` at all. */
```

and its signature and call (`:455`, `:459`):

```js
function settingsDrift(account, registry, catalogue, windows) {
```

```js
    want = modelEnvBlock(registry, catalogue, windows);
```

Replace `renderRefusal`'s signature and call (`:488`, `:492`):

```js
function renderRefusal(registry, catalogue, windows) {
```

```js
    modelEnvBlock(registry, catalogue, windows);
```

Replace `describe` and `orphanDescribe` (`:500-538`, from `/** The `show` answer,` to `orphanDescribe`'s closing
`}`) with:

```js
/** The `show` answer, which every mutation also returns so a caller sees the
 *  state it produced without a second call. `windows` is the measured-windows
 *  reading as `windowsReport` puts it, and `contextWindow` is the eighth key's
 *  decision (`contextWindowFor`: tokens, rule, unmeasured), null with no
 *  registry — an Anthropic lane, or one nobody has seeded. */
function describe(account, registry, catalogue, reading) {
  const anthropic = isAnthropicLane(account);
  const derived = deriveModels(registry, catalogue);
  const windows = windowsOf(reading);
  return {
    id: account.id,
    anthropic,
    registry,
    derived: { ...derived, available: availableFor(registry, catalogue, anthropic) },
    catalogue: catalogue === null
      ? null
      : { fetchedAt: catalogue.fetchedAt, stale: catalogue.stale, count: catalogue.models.length },
    settingsDrift: settingsDrift(account, registry, catalogue, windows),
    renderRefusal: renderRefusal(registry, catalogue, windows),
    windows: windowsReport(reading),
    contextWindow: registry === null ? null : contextWindowFor(registry, catalogue, windows),
  };
}

/** §11's ORPHAN: a registry file whose id is in no roster row — typically
 *  after `ccrc account remove`, which deliberately never deletes under
 *  ~/.ccrc/models/ and names `ccrc models <id> rm` as the remedy. There is no
 *  ACCOUNT here to read a `configDirSuffix` or a `telemetry` field from, so
 *  every class reads as UNAVAILABLE regardless of what the registry itself
 *  assigns — nothing routes a session to this id — and `settingsDrift` is
 *  meaningless with no settings.json to compare the registry against. The
 *  windows are reported as for any lane: `rm` reaps them with the rest. */
function orphanDescribe(id, registry, catalogue, reading) {
  const derived = deriveModels(registry, catalogue);
  return {
    id,
    orphan: true,
    anthropic: false,
    registry,
    derived: { ...derived, available: [] },
    catalogue: catalogue === null
      ? null
      : { fetchedAt: catalogue.fetchedAt, stale: catalogue.stale, count: catalogue.models.length },
    settingsDrift: [],
    windows: windowsReport(reading),
    contextWindow: contextWindowFor(registry, catalogue, windowsOf(reading)),
  };
}
```

- [ ] **Step 5: Read once in `main`, report in `show`, reap in `rm`**

In the `rm` arm's comment (`:743-756`), change the two counts: `deletes the four` becomes `deletes the five`, and
`to each of the four files on its own` becomes `to each of the five files on its own`. Replace the loop's head
(`:758`, `for (const p of [registryPath(a.id), cataloguePath(a.id), classesTsvPath(a.id), effortPath(a.id)]) {`) with:

```js
    for (const p of [registryPath(a.id), cataloguePath(a.id), classesTsvPath(a.id), effortPath(a.id),
      windowsPath(a.id)]) {
```

In the orphan `show` (`:792-795`), replace the `out(…orphanDescribe(…))` line with:

```js
        out({ ok: true, op: 'show',
          ...orphanDescribe(a.id, reg0.registry, cat0.catalogue, readWindowsFile(a.id)) });
```

Replace `:820-825` (from `  let registry = reg.registry;` to the `show` arm's `return 0;\n  }`) with:

```js
  let registry = reg.registry;
  // Codex-bridge spec §2.7: the lane's measured windows, read ONCE per op, so
  // the answer, the materialise and the drift check agree about them. An
  // unreadable file is a READING here, never a refusal: only the two window
  // verbs refuse on it.
  const win = readWindowsFile(a.id);

  if (opName === 'show') {
    out({ ok: true, op: 'show', ...describe(account, registry, catalogue, win) });
    return 0;
  }
```

Then thread `win` through the four remaining sites:
- the `materialise` op (`:909`): `const mat = materialise(account, registry, catalogue, windowsOf(win));`
- `init`'s existing-registry answer (`:930`): `...describe(account, registry, catalogue, win)`
- `init`'s create (`:965`, `:967`): `const mat = materialise(account, registry, catalogue, windowsOf(win));` and
  `...describe(account, registry, catalogue, win)`
- the mutation tail (`:1172-1176`), replacing the comment and the call:

```js
    try {
      // The eighth key can never throw (it is written or omitted, never
      // refused), so `catalogue` and the windows matter here only for
      // consistency with every other call — this check is purely "does the
      // lane route anywhere".
      modelEnvBlock(validated, catalogue, windowsOf(win));
```

- and its write-back (`:1191`, `:1193`): `const mat = materialise(account, validated, catalogue, windowsOf(win));` and
  `const answer = { ok: true, op: opName, ...extra, ...describe(account, validated, catalogue, win) };`

In the file header, replace these two lines (`:40-41`):

```js
// exists to clean up. It still obeys rule 1. It reaps the four MODEL files —
// registry, catalogue, TSV, effort map — and DELIBERATELY not `lane.json`,
```

with:

```js
// exists to clean up. It still obeys rule 1. It reaps the five MODEL files —
// registry, catalogue, TSV, effort map, measured windows — and DELIBERATELY
// not `lane.json`,
```

Check that no two-argument call is left: `git grep -n 'modelEnvBlock(\|materialise(account\|describe(account' --
deploy/models-op.mjs` shows the windows argument on every call.

- [ ] **Step 6: Run the tests to see them pass**

Run: `./node_modules/.bin/vitest run test/models-op.test.ts`
Expected: PASS, the base count plus 20 (18 cases in the new describe, 2 FIFO rows).

Run: `./node_modules/.bin/vitest run test/single-definition.test.ts`
Expected: PASS.

Run: `./node_modules/.bin/vitest run test/ccrc-models.test.ts`
Expected: PASS, unchanged count (`show` bodies gain two fields; every existing assertion reads others).

- [ ] **Step 7: Measure the mutation rows**

One at a time on `deploy/models-op.mjs` (M4 and R10 on `shared/modelenv.mjs`), each restored and checked:
- R1 (`materialise` passes `null` to `modelEnvBlock`) → 7 failed (every class model measured…; the four unreadable
  rows, on their first half's `'400000'`; settingsDrift names the eighth key…, whose second `show` still drifts; a
  class that moves…).
- R2 (`settingsDrift` passes `null`) → 1 failed (settingsDrift names the eighth key once the windows moved…).
- R3 (`rm` loop without `windowsPath(a.id)`) → 3 failed (the two `rm` cases; the directory row, whose `rm` now
  answers 0).
- R4 (`readWindowsFile`'s JSON `catch` rethrows instead of answering `unreadable`) → 2 failed (the `not JSON`
  unreadable row; show on an unreadable windows file…), each printing a stack instead of one JSON object.
- R5 (the `readRegular` catch answers `{ state: 'absent' }` for every error, not only ENOENT) → 2 failed (show with a
  FIFO windows file answers ok: the windows unreadable…; the directory row).
- R6 (`describe` reports `contextWindow: null` always) → 5 failed (show reports each measured window…; show with
  every class model measured…; show with no windows file…; show on an unreadable windows file…; a class that moves…).
- R7 (`readRegular(p)` → `readFileSync(p, 'utf8')` in `readWindowsFile`) → 3 failed: both FIFO rows ended at the
  bound (`did not exit by itself`), and the directory row, whose reason becomes `EISDIR`, not "not a regular file".
- R8 (the orphan `show` passes `{ state: 'absent' }`) → 1 failed (an ORPHAN show reports its windows too).
- R9 (add the code line `: "x.windows.json"` to `ccd/ccrc`; a COMMENT would not do, because the corpus strips bash
  comments) → 1 failed (the WINDOWS file is named by exactly two files…).
- R11 (`readWindowsFile`'s `RegistryInvalid` catch rethrows instead of answering `unreadable`) → 4 failed (the three
  unreadable rows whose body is JSON: an array, a windows that is not an object, a window below the minimum; an
  unreadable windows file adds no drift), each printing a stack instead of one JSON object.
- M4 (Task 2's row, `unmeasured.length === 0` → `unmeasured.length < models.length`, re-run against THIS file) → at
  least 3 failed (one class model unmeasured…, whose key becomes `'0'`; show reports each measured window…; a class
  that moves…). It is the red of "one class model unmeasured", which pins today's 200000 through the op.
- R10 (`catalogueWindow` returns `null` on its first line, so the default rule never yields a window) → at least 10
  failed, among them "one class model unmeasured…" and "with no windows file the env block is today's, every key"
  (the key goes missing), the four unreadable rows' second half, the three default-rule `show` rows and the
  class-move row; pre-existing rows that pin `'200000'` red too. It is the red of the no-windows-file row through
  the op: Task 2's M10 cannot be, because on this file's fixture lane the haiku and opus models both advertise
  272000, so reading the wrong row still gives 200000.

- [ ] **Step 8: Commit**

```bash
git add deploy/models-op.mjs server/test/models-op.test.ts server/test/single-definition.test.ts
git commit -m "models-op: read the measured windows once, apply, report and reap them (codex-bridge Stage 0, Task 3)"
```

---

### Task 4: the two verbs, `set-window` and `clear-window`, in models-op

**Files:**
- Modify: `deploy/models-op.mjs` (header rule 3 `:30-34`; imports; `writeWindows` after `writeRegistry` `:274`;
  `windowOp` after `materialiseCheck` `:650`; `OPS` `:579-597`; `main`'s no-registry gate `:977-983`)
- Test: `server/test/models-op.test.ts` (a describe after Task 3's; two rows in the C6 `it.each` `:1622-1627`)
- Test: `server/test/modelenv.test.ts` (the C7 static pin `:435-464`: three sites become four)

**Interfaces:**
- Consumes: `WINDOW_MIN`, `WINDOW_MAX`, `parseWindows`, `RegistryInvalid` (Task 1); `readWindowsFile`, `windowsPath`,
  `windowsOf`, `materialise(…, windows)`, `describe(…, reading)`, `const win` in `main` (Task 3).
- Produces:
  - op `set-window`, keys `--file --id --model --tokens`, all required. Answer: `{ ok: true, op: 'set-window', model,
    tokens: number, previous: number | null, ...describe }`.
  - op `clear-window`, keys `--file --id --model`, all required. Answer: `{ ok: true, op: 'clear-window', model,
    removed: boolean, ...describe }`.
  - refusals (exit 1): `bad-model-id` (field `model`), `bad-window` (field `tokens`), `unknown-window-model` (field
    `model`), `windows-unreadable`, `windows-unwritable`, `windows-invalid` (unreachable while the guards before it
    stand; Step 6 says why it has no red row of its own), `unroutable-lane` (the lane's env block cannot be
    rendered: the mutation tail's word, refused BEFORE anything is written), the existing `anthropic-lane`,
    `no-registry`, `no-such-account`, and whatever `materialise` answers after a successful write
    (`settings-unwritable`, `materialise-failed`), whose detail then says the windows file was already updated;
    usage (exit 2): `bad-argv`.
  - `writeWindows(id, raw): null | [code, detail]`.

- [ ] **Step 1: Write the failing tests**

In `server/test/models-op.test.ts`, insert this describe after Task 3's describe:

```ts
describe('set-window and clear-window (codex-bridge spec §2.7)', () => {
  const ID = LEGACY_EXTERNAL_ID;
  const OPUS = SEEDED.classes.opus!;
  const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
  const windowsFile = (): Record<string, unknown> & { windows: Record<string, Record<string, unknown>> } =>
    JSON.parse(fs.readFileSync(winPath(ID), 'utf8'));
  const setWindow = (model: string, tokens: string, id: string = ID): Result =>
    op('set-window', '--file', rosterPath(), '--id', id, '--model', model, '--tokens', tokens);
  const clearWindow = (model: string, id: string = ID): Result =>
    op('clear-window', '--file', rosterPath(), '--id', id, '--model', model);
  const showOf = (): Result => op('show', '--file', rosterPath(), '--id', ID);

  beforeEach(() => {
    writeCatalogue(ID);
    plantCodex(ID);
  });

  it('set-window records the window with a UTC setAt, answers previous: null, and re-materialises', () => {
    const r = setWindow(OPUS, '400000');
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.body).toMatchObject({ ok: true, op: 'set-window', model: OPUS, tokens: 400000, previous: null });
    const entry = windowsFile().windows[OPUS]!;
    expect(entry['tokens']).toBe(400000);
    expect(String(entry['setAt'])).toMatch(ISO_UTC);
    // Two class models are still unmeasured, so the rule is still the default.
    expect(eighthKey()).toBe('200000');
    expect(r.body['contextWindow']).toEqual({ tokens: 200000, rule: 'default',
      unmeasured: CLASS_MODELS.filter((m) => m !== OPUS) });
  });

  it('the LAST class model measured flips the lane to the smallest window, in that same call', () => {
    const [m0, m1, m2] = CLASS_MODELS as [string, string, string];
    expect(setWindow(m0, '511000').code).toBe(0);
    expect(setWindow(m1, '450000').code).toBe(0);
    expect(eighthKey()).toBe('200000');
    const r = setWindow(m2, '400000');
    expect(r.code).toBe(0);
    expect(eighthKey()).toBe('400000');
    expect(r.body['contextWindow']).toEqual({ tokens: 400000, rule: 'measured', unmeasured: [] });
    expect(r.body['settingsDrift']).toEqual([]);
  });

  it('set-window again replaces the value and answers the previous one', () => {
    expect(setWindow(OPUS, '400000').code).toBe(0);
    const r = setWindow(OPUS, '350000');
    expect(r.body).toMatchObject({ tokens: 350000, previous: 400000 });
    expect(windowsFile().windows[OPUS]!['tokens']).toBe(350000);
  });

  it.each(['1000', '1000000'])('accepts the bound %s exactly', (tokens) => {
    expect(setWindow(OPUS, tokens).code).toBe(0);
  });

  it.each(['400k', '400,000', '4e5', '400000.0', '-400000', ' 400000', '999', '1000001', ''])(
    'refuses %j as a window, naming the field and the digits-only form, and writes nothing', (tokens) => {
      const r = setWindow(OPUS, tokens);
      expect(r.code).toBe(1);
      expect(r.body['error']).toBe('bad-window');
      expect(r.body['field']).toBe('tokens');
      expect(String(r.body['detail'])).toMatch(/from 1000 to 1000000, written in digits only/);
      expect(fs.existsSync(winPath(ID))).toBe(false);
    });

  it('refuses a model neither in the catalogue nor a class model — the typo guard — and writes nothing', () => {
    const r = setWindow('model-9-omega', '400000');
    expect(r.code).toBe(1);
    expect(r.body['error']).toBe('unknown-window-model');
    expect(r.body['field']).toBe('model');
    expect(String(r.body['detail'])).toContain(`ccrc models ${ID} show`);
    expect(fs.existsSync(winPath(ID))).toBe(false);
  });

  it('refuses a CLASS name where a model id belongs, and says which it takes', () => {
    const r = setWindow('opus', '400000');
    expect(r.body['error']).toBe('unknown-window-model');
    expect(String(r.body['detail'])).toMatch(/takes a MODEL id, not a class/);
  });

  it('accepts a catalogue model no class names yet — measure it before a class moves to it', () => {
    const spare = CODEX.models.find((m) => !CLASS_MODELS.includes(m.id))!.id;
    const r = setWindow(spare, '400000');
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect((r.body['contextWindow'] as { rule: string }).rule).toBe('default');
  });

  it('accepts a class model on a lane no catalogue vouches for (never probed)', () => {
    fs.rmSync(path.join(home, '.ccrc', 'models', `${ID}.json`));
    expect(setWindow(OPUS, '400000').code).toBe(0);
  });

  it('refuses an id that is not a model id', () => {
    const r = setWindow('../escape', '400000');
    expect(r.code).toBe(1);
    expect(r.body['error']).toBe('bad-model-id');
  });

  it('never rewrites the class registry — bytes and mtime unchanged, the rollback property', () => {
    const before = fs.readFileSync(regPath(ID), 'utf8');
    const mtime = fs.statSync(regPath(ID)).mtimeMs;
    expect(setWindow(OPUS, '400000').code).toBe(0);
    expect(clearWindow(OPUS).code).toBe(0);
    expect(fs.readFileSync(regPath(ID), 'utf8')).toBe(before);
    expect(fs.statSync(regPath(ID)).mtimeMs).toBe(mtime);
    expect(Object.keys(registryOf(ID))).not.toContain('windows');
  });

  it('PRESERVES keys this build does not know, at the top level and inside an entry', () => {
    const [m0, m1] = CLASS_MODELS as [string, string];
    plantWindows(ID, { version: 2, windows: { [m0]: { tokens: 300000, source: 'probe' } } });
    expect(setWindow(m1, '400000').code).toBe(0);
    expect(setWindow(m0, '350000').code).toBe(0);
    const f = windowsFile();
    expect(f['version']).toBe(2);
    expect(f.windows[m0]).toMatchObject({ tokens: 350000, source: 'probe' });
    expect(f.windows[m1]).toMatchObject({ tokens: 400000 });
  });

  it('clear-window of an absent entry is ok with removed: false, and writes no file', () => {
    const r = clearWindow(OPUS);
    expect(r.code).toBe(0);
    expect(r.body).toMatchObject({ ok: true, op: 'clear-window', model: OPUS, removed: false });
    expect(fs.existsSync(winPath(ID))).toBe(false);
  });

  it('clear-window drops one entry and re-materialises: one class model unmeasured is the default rule again', () => {
    for (const m of CLASS_MODELS) expect(setWindow(m, '400000').code).toBe(0);
    expect(eighthKey()).toBe('400000');
    const r = clearWindow(OPUS);
    expect(r.body).toMatchObject({ removed: true });
    expect(eighthKey()).toBe('200000');
    expect(Object.keys(windowsFile().windows)).toEqual(CLASS_MODELS.filter((m) => m !== OPUS));
  });

  it('clearing the LAST entry deletes the file, so absent keeps meaning no measured window', () => {
    expect(setWindow(OPUS, '400000').code).toBe(0);
    expect(clearWindow(OPUS).body).toMatchObject({ removed: true });
    expect(fs.existsSync(winPath(ID))).toBe(false);
    expect(showOf().body['windows']).toEqual({ state: 'absent' });
  });

  it('clearing the last entry KEEPS a file that still holds a top-level key this build does not know', () => {
    plantWindows(ID, { version: 2, windows: { [OPUS]: { tokens: 300000 } } });
    expect(clearWindow(OPUS).body).toMatchObject({ removed: true });
    expect(windowsFile()).toEqual({ version: 2, windows: {} });
  });

  it('clear-window has no typo guard: a stale entry for a model the lane no longer names is removable', () => {
    plantWindows(ID, windowsFor({ 'model-9-omega': 5000 }));
    expect(clearWindow('model-9-omega').body).toMatchObject({ ok: true, removed: true });
    expect(fs.existsSync(winPath(ID))).toBe(false);
  });

  it('a stale entry for a model no class names is ignored by the rule and still listed by show', () => {
    plantWindows(ID, windowsFor({ ...Object.fromEntries(CLASS_MODELS.map((m) => [m, 400000])), 'model-9-omega': 5000 }));
    const r = showOf();
    expect(r.body['contextWindow']).toEqual({ tokens: 400000, rule: 'measured', unmeasured: [] });
    expect(Object.keys((r.body['windows'] as { byModel: Record<string, unknown> }).byModel)).toContain('model-9-omega');
  });

  it.each([
    ['not JSON', '{ this is not json'],
    ['an array', '[]'],
    ['a window too small', JSON.stringify({ windows: { 'model-9-omega': { tokens: 5 } } })],
  ])('an unreadable windows file (%s): both verbs refuse with the remedy, and the file is untouched', (_why, body) => {
    plantWindows(ID, body);
    for (const r of [setWindow(OPUS, '400000'), clearWindow(OPUS)]) {
      expect(r.code).toBe(1);
      expect(r.body['error']).toBe('windows-unreadable');
      expect(String(r.body['detail'])).toContain(winPath(ID));
      expect(String(r.body['detail'])).toMatch(/delete it to drop every measured window/);
    }
    expect(fs.readFileSync(winPath(ID), 'utf8')).toBe(body);
  });

  it('a DIRECTORY at the windows path: both verbs refuse windows-unreadable, never a block', () => {
    fs.mkdirSync(winPath(ID), { recursive: true });
    for (const r of [setWindow(OPUS, '400000'), clearWindow(OPUS)]) {
      expect(r.code).toBe(1);
      expect(r.body['error']).toBe('windows-unreadable');
      expect(String(r.body['detail'])).toMatch(/not a regular file/);
    }
    expect(fs.statSync(winPath(ID)).isDirectory()).toBe(true);
  });

  it('a lane whose env block cannot be rendered refuses both, as set-effort does, with nothing written', () => {
    // A legacy `subagent: opus` left on disk from before the 2026-09-09
    // narrowing: `parseRegistry` still reads it, `modelEnvBlock` refuses to
    // render it. Written first, the window would change on disk and the op
    // would then answer `materialise`'s refusal; refused first, nothing moves.
    plantWindows(ID, windowsFor({ [OPUS]: 300000 }));
    const before = fs.readFileSync(winPath(ID), 'utf8');
    const reg = JSON.parse(fs.readFileSync(regPath(ID), 'utf8'));
    reg.subagent = 'opus';
    fs.writeFileSync(regPath(ID), `${JSON.stringify(reg, null, 2)}\n`);
    for (const r of [setWindow(OPUS, '400000'), clearWindow(OPUS)]) {
      expect(r.code).toBe(1);
      expect(r.body['error']).toBe('unroutable-lane');
      expect(String(r.body['detail'])).toMatch(/set-subagent <haiku\|sonnet>/);
      expect(String(r.body['detail'])).toMatch(/No window was written/);
    }
    expect(fs.readFileSync(winPath(ID), 'utf8')).toBe(before);
  });

  it('a settings.json the materialise cannot rewrite: the refusal says the window was already recorded', () => {
    fs.writeFileSync(path.join(home, LEGACY_SUFFIX, 'settings.json'), '{ this is not json');
    const r = setWindow(OPUS, '400000');
    expect(r.code).toBe(1);
    expect(r.body['error']).toBe('settings-unwritable');
    expect(String(r.body['detail'])).toContain(`${winPath(ID)} itself was already updated`);
    expect(windowsFile().windows[OPUS]!['tokens']).toBe(400000);
  });

  it('an anthropic lane refuses both, as it refuses every op but show', () => {
    const anthropic = ROSTER.accounts[1]!.id;
    for (const r of [setWindow(OPUS, '400000', anthropic), clearWindow(OPUS, anthropic)]) {
      expect(r.code).toBe(1);
      expect(r.body['error']).toBe('anthropic-lane');
    }
  });

  it('a lane with no class registry refuses both, naming init', () => {
    const bare = ROSTER.accounts[3]!.id;
    for (const r of [setWindow(OPUS, '400000', bare), clearWindow(OPUS, bare)]) {
      expect(r.code).toBe(1);
      expect(r.body['error']).toBe('no-registry');
    }
  });

  it('writes the file 0600 under a permissive umask, and leaves no temp file', () => {
    const prev = process.umask(0o022);
    try {
      expect(setWindow(OPUS, '400000').code).toBe(0);
    } finally {
      process.umask(prev);
    }
    expect(fs.statSync(winPath(ID)).mode & 0o777).toBe(0o600);
    expect(fs.readdirSync(path.dirname(winPath(ID))).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  // Root ignores a directory's write bit, so this proves nothing there: a
  // visible skip, not a false red (the lane.json rename case's own reason).
  it.skipIf(typeof process.getuid === 'function' && process.getuid() === 0)(
    'a models directory it cannot write: both verbs answer windows-unwritable, and the file is unchanged', () => {
      expect(setWindow(OPUS, '400000').code).toBe(0);
      const before = fs.readFileSync(winPath(ID), 'utf8');
      const dir = path.dirname(winPath(ID));
      fs.chmodSync(dir, 0o555);
      try {
        const set = setWindow(OPUS, '350000');
        expect(set.code).toBe(1);
        expect(set.body['error']).toBe('windows-unwritable');
        expect(String(set.body['detail'])).toMatch(/could not be written/);
        // OPUS is the only entry, so clearing it is the unlink arm.
        const clear = clearWindow(OPUS);
        expect(clear.code).toBe(1);
        expect(clear.body['error']).toBe('windows-unwritable');
        expect(String(clear.body['detail'])).toMatch(/could not be removed/);
      } finally {
        fs.chmodSync(dir, 0o755);
      }
      expect(fs.readFileSync(winPath(ID), 'utf8')).toBe(before);
    });

  it('a missing --tokens or --model is a usage error at exit 2', () => {
    const r = op('set-window', '--file', rosterPath(), '--id', ID, '--model', OPUS);
    expect(r.code).toBe(2);
    expect(String(r.body['detail'])).toContain('--tokens');
    expect(op('clear-window', '--file', rosterPath(), '--id', ID).code).toBe(2);
  });
});
```

In the C6 describe's `it.each` (`:1622-1627`), add two rows after `['discovery', ['--action', 'catalogue']],`:

```ts
    ['set-window', ['--model', 'model-9-omega', '--tokens', '400000']],
    ['clear-window', ['--model', 'model-9-omega']],
```

In `server/test/modelenv.test.ts`, the static pin's describe comment wraps its count sentence across two comment
lines (`:442-443`), so replace the two lines, each whole:

```ts
// it unique per process, `${process.pid}`. Reverting any one of the five
// sites (two in shared/modelenv.mjs, three in deploy/models-op.mjs) reds
```

with:

```ts
// it unique per process, `${process.pid}`. Reverting any one of the six
// sites (two in shared/modelenv.mjs, four in deploy/models-op.mjs) reds
```

and its second case (`:460-464`, `it('all three tmp-name sites in deploy/models-op.mjs …` to its `});`) with:

```ts
  it('all four tmp-name sites in deploy/models-op.mjs (writeRegistry, materialise, litellm render, writeWindows) carry ${process.pid}', () => {
    const lines = tmpAssignmentLines(path.join(REPO_ROOT, 'deploy', 'models-op.mjs'));
    expect(lines.length, `expected 4 tmp-name sites, found: ${JSON.stringify(lines)}`).toBe(4);
    for (const l of lines) expect(l).toContain('${process.pid}');
  });
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `./node_modules/.bin/vitest run test/models-op.test.ts`
Expected: FAIL. Every case of the new describe that calls a verb is red with `bad-argv` (`unknown op "set-window"`),
exit 2 (as root, the models-directory row is skipped instead). The two new C6 rows are red too: `main` looks the op
up in `OPS` before it reads `--id`, so they answer `bad-argv` at exit 2, not `bad-account-id` at exit 1. Green
already, because it calls no verb: "a stale entry for a model no class names is ignored by the rule and still
listed by show". It pins Task 2's and Task 3's behaviour through `show`, and its reds are Task 2's M8 and Task 3's
R6, re-run against this file in Step 6. Every pre-existing case passes.

Run: `./node_modules/.bin/vitest run test/modelenv.test.ts -t "C7's tmp names"`
Expected: FAIL, 1 failed (`expected 4 tmp-name sites`, found 3).

- [ ] **Step 3: Write `writeWindows`**

In `deploy/models-op.mjs`, extend the models import with the bounds:

```js
import {
  CLASSES, CatalogueInvalid, MODEL_ID_RE, PROBE_KINDS, RegistryInvalid, SUBAGENT_CLASSES, WINDOW_MAX, WINDOW_MIN,
  availableFor, deriveModels, parseCatalogue, parseRegistry, parseWindows,
} from '../shared/models.mjs';
```

After `writeRegistry`'s closing `}` (`:274`), insert:

```js
/** The windows file's write: tmp + rename, 0600, 2-space JSON and a trailing
 *  newline — `writeRegistry`'s shape, for the same readers. `raw` is the parsed
 *  object `readWindowsFile` returned, edited in place, so keys this build does
 *  not know are written back as they were. */
function writeWindows(id, raw) {
  const p = windowsPath(id);
  const tmp = `${p}.${process.pid}.tmp`;
  try {
    mkdirSync(modelsDir(), { recursive: true });
    writeFileSync(tmp, `${JSON.stringify(raw, null, 2)}\n`, { mode: 0o600 });
    renameSync(tmp, p);
    return null;
  } catch (e) {
    try { unlinkSync(tmp); } catch { /* the tmp may never have been created */ }
    return ['windows-unwritable', `${p} could not be written: ${e.message}. Nothing was changed.`];
  }
}
```

- [ ] **Step 4: Write `windowOp` and register the two ops**

After `materialiseCheck`'s closing `}` (`:650`), insert:

```js
/** `set-window <model> <tokens>` and `clear-window <model>` (codex-bridge spec
 *  §2.7, Stage 0): the lane's measured context windows, in their own sibling
 *  file (`windowsPath`) and NEVER in the class registry. These two ops do not
 *  write `<id>.classes.json` at all, so an older ccrc, after a rollback, reads
 *  exactly the registry it wrote.
 *
 *  Both obey the file header's three rules: one JSON object on stdout; the
 *  edited object read back through `parseWindows`, and the lane's env block
 *  rendered, BEFORE anything is written; and a re-materialise on success, as
 *  `set-effort` does, so the lane's settings.json carries the rule's answer at
 *  once. The render comes first for the mutation tail's reason (it runs
 *  `modelEnvBlock` before `writeRegistry`): a lane whose block cannot be
 *  rendered, such as a legacy `subagent: opus|fable` that `parseRegistry`
 *  still reads, would otherwise have the windows file change and then
 *  `materialise` refuse. It is refused with the tail's own word,
 *  `unroutable-lane`, and nothing written. A materialise that still fails
 *  after the write (an I/O cause, such as a settings.json that is not JSON)
 *  says in its refusal that the windows file was already updated.
 *
 *  `set-window` refuses a `tokens` that is not digits only or lies outside
 *  `WINDOW_MIN`..`WINDOW_MAX`, and — the typo guard — a model that is neither in
 *  the lane's catalogue nor one of its class models: a window for such a model
 *  changes nothing, so writing it would hide the typo. `clear-window` has no
 *  typo guard: removing a stale entry for a model the lane no longer names is
 *  the point. Clearing an absent entry is ok with `removed: false` and writes
 *  nothing; clearing the LAST entry deletes the file, so "absent" keeps meaning
 *  "no measured window" — unless the file holds a top-level key this build does
 *  not know. That file is kept, with an empty `windows`, rather than destroyed
 *  (D-5161): the writer's preservation rule wins over
 *  the delete, and the rule reads an empty `windows` as no measured window,
 *  exactly as it reads an absent file.
 *
 *  An UNREADABLE file is refused by both, with the remedy: they rewrite that
 *  file and will not overwrite one they cannot read. Every other reader
 *  (`materialise`, the hourly refresh, the drift check) treats it as no windows
 *  and carries on. No lock here: the auto-advance plan wraps both verbs in the
 *  per-lane lock. */
function windowOp(opName, a, account, registry, catalogue, reading) {
  if (!MODEL_ID_RE.test(a.model)) {
    return refuse(1, 'bad-model-id',
      `"${a.model}" is not a model id: a letter or digit followed by up to 127 of letters, digits, ".", "_", `
      + '":", "/" and "-". Nothing was written.', 'model');
  }
  if (reading.state === 'unreadable') {
    return refuse(1, 'windows-unreadable',
      `${reading.reason} — ${opName} rewrites that file and will not overwrite one it cannot read. Fix it by hand, `
      + `or delete it to drop every measured window on account "${a.id}" (its lane then uses the default rule), `
      + 'then re-run. Nothing was written.');
  }
  if (opName === 'set-window') {
    if (!/^[0-9]+$/.test(a.tokens) || Number(a.tokens) < WINDOW_MIN || Number(a.tokens) > WINDOW_MAX) {
      return refuse(1, 'bad-window',
        `"${a.tokens}" is not a window: it is a whole number of tokens from ${WINDOW_MIN} to ${WINDOW_MAX}, written `
        + 'in digits only (400000, not 400k, 400,000 or 4e5). Nothing was written.', 'tokens');
    }
    const known = (catalogue !== null && catalogue.models.some((m) => m.id === a.model))
      || CLASSES.some((c) => registry.classes[c] === a.model);
    if (!known) {
      return refuse(1, 'unknown-window-model',
        `"${a.model}" is neither in account "${a.id}"'s catalogue nor one of its class models, so a window for it `
        + 'would change nothing. set-window takes a MODEL id, not a class. Run '
        + `'ccrc models ${a.id} show' to see the lane's class models, or 'ccrc models refresh ${a.id}' if the `
        + 'model is new. Nothing was written.', 'model');
    }
  }
  // RULE 2's render, before any write, under the mutation tail's own gate: an
  // unseeded registry renders no block and is not refused, as there. The
  // windows play no part in the answer (the eighth key is written or omitted,
  // never refused); they are passed for consistency with every other call.
  if (CLASSES.some((c) => registry.classes[c] !== null)) {
    try {
      modelEnvBlock(registry, catalogue, windowsOf(reading));
    } catch (e) {
      if (e instanceof ModelEnvInvalid) return refuse(1, 'unroutable-lane', `${e.message} No window was written.`);
      throw e;
    }
  }
  // The raw object, cloned: unknown keys, at the top level and inside each
  // entry, ride through untouched (spec §2.7: the file is forward-compatible).
  const raw = reading.state === 'ok' ? JSON.parse(JSON.stringify(reading.raw)) : { windows: {} };
  let extra;
  if (opName === 'set-window') {
    const tokens = Number(a.tokens);
    const previous = reading.state === 'ok' && Object.prototype.hasOwnProperty.call(reading.windows, a.model)
      ? reading.windows[a.model] : null;
    const prev = isObj(raw.windows[a.model]) ? raw.windows[a.model] : {};
    raw.windows[a.model] = { ...prev, tokens, setAt: new Date().toISOString() };
    extra = { model: a.model, tokens, previous };
  } else {
    const removed = Object.prototype.hasOwnProperty.call(raw.windows, a.model);
    if (removed) delete raw.windows[a.model];
    extra = { model: a.model, removed };
  }

  let next = reading;
  if (opName === 'set-window' || extra.removed === true) {
    if (Object.keys(raw.windows).length === 0 && Object.keys(raw).length === 1) {
      try {
        unlinkSync(windowsPath(a.id));
      } catch (e) {
        if (e.code !== 'ENOENT') {
          return refuse(1, 'windows-unwritable',
            `${windowsPath(a.id)} could not be removed: ${e.message}. Nothing was changed.`);
        }
      }
      next = { state: 'absent' };
    } else {
      // RULE 2: the edited object goes back through the reader before the
      // rename. Unreachable from these two ops while the guards above stand
      // (they only add an entry those guards checked, or drop one), and kept
      // for the next writer of this file, which this one cannot vouch for. It
      // has no red row of its own; mutations V1 and V2 reach it.
      let windows;
      try {
        windows = parseWindows(raw);
      } catch (e) {
        if (e instanceof RegistryInvalid) return refuse(1, 'windows-invalid', e.message, e.field);
        throw e;
      }
      const w = writeWindows(a.id, raw);
      if (w !== null) return refuse(1, w[0], w[1]);
      next = { state: 'ok', windows, raw };
    }
  }
  const mat = materialise(account, registry, catalogue, windowsOf(next));
  if (mat.err !== undefined) {
    // Unlike every refusal above, the windows file has moved by now (when
    // `next` is a new reading), so the sentence says so rather than leave the
    // operator to infer that nothing changed.
    const detail = next === reading ? mat.err[1]
      : `${mat.err[1]} (${windowsPath(a.id)} itself was already updated: the lane's settings.json takes the `
        + 'new window at the next materialise that succeeds.)';
    return refuse(1, mat.err[0], detail);
  }
  out({ ok: true, op: opName, ...extra, ...describe(account, registry, catalogue, next) });
  return 0;
}
```

In `OPS` (`:579-597`), after the `'set-effort'` row, add:

```js
  // Codex-bridge spec §2.7: a lane's measured context windows, in their own
  // sibling file (`windowOp`). `tokens` is checked against WINDOW_MIN and
  // WINDOW_MAX here, never in bash.
  'set-window': { keys: ['file', 'id', 'model', 'tokens'], required: ['file', 'id', 'model', 'tokens'] },
  'clear-window': { keys: ['file', 'id', 'model'], required: ['file', 'id', 'model'] },
```

In `main`, replace the comment `  // Every remaining op MUTATES an existing registry.` (`:977`) and add the
dispatch after the no-registry refusal's closing `}` (`:982`), so the block reads:

```js
  // Every remaining op needs an existing registry. All but the two window ops
  // MUTATE it; those two read its class models (their typo guard) and
  // re-materialise it, but write only the sibling windows file.
  if (registry === null) {
    return refuse(1, 'no-registry',
      `account "${a.id}" has no class registry yet. Run 'ccrc models ${a.id} init `
      + `<${PROBE_KINDS.join('|')}>' first — it creates ${registryPath(a.id)}.`);
  }
  if (opName === 'set-window' || opName === 'clear-window') {
    return windowOp(opName, a, account, registry, catalogue, win);
  }
```

In the file header's rule 3 (`:30-34`), append after its last line, ``//     them, so its `probeModel` follows every
reclassification.``:

```js
//     The two window ops (`set-window`, `clear-window`) obey all three against
//     their own sibling file (`windowOp`), and re-materialise the same way.
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `./node_modules/.bin/vitest run test/models-op.test.ts`
Expected: PASS, the base count plus 20 (Task 3) plus 40 (this task's 38 cases and 2 C6 rows). As root, one of the
38, the models-directory row, is reported skipped, not passed.

Run: `./node_modules/.bin/vitest run test/modelenv.test.ts`
Expected: PASS.

- [ ] **Step 6: Measure the mutation rows**

One at a time on `deploy/models-op.mjs` (M8 on `shared/modelenv.mjs`), each restored and checked:
- V1 (drop `!/^[0-9]+$/.test(a.tokens) ||`) → 5 failed (`"4e5"`, `"400000.0"` and `" 400000"` are accepted as 400000;
  `"400k"` and `"400,000"` are `NaN`, pass both range tests, and end as `windows-invalid`, not `bad-window`).
- V2 (drop `|| Number(a.tokens) > WINDOW_MAX`) → 1 failed (`"1000001"`: it answers `windows-invalid`, not `bad-window`).
- V3 (drop the typo guard: `const known = true;`) → 2 failed (the typo guard; a CLASS name).
- V4 (run the typo guard for `clear-window` too) → 1 failed (clear-window has no typo guard…).
- V5 (`raw` rebuilt from the parsed map: `{ windows: Object.fromEntries(Object.entries(reading.windows ?? {}).map(([k,
  v]) => [k, { tokens: v }])) }`) → 2 failed (PRESERVES…; clearing the last entry KEEPS…).
- V6 (never unlink: drop the `Object.keys(raw.windows).length === 0 && …` branch) → 3 failed (clearing the LAST entry
  deletes the file…; clear-window has no typo guard…, whose file survives; the models-directory row, whose clear now
  answers "could not be written"). As root, 2: that row is skipped.
- V7 (unlink whenever `windows` is empty, ignoring other keys) → 1 failed (clearing the last entry KEEPS…).
- V8 (skip `materialise` in `windowOp`) → 3 failed (the LAST class model measured flips…; clear-window drops one entry
  and re-materialises…; a settings.json the materialise cannot rewrite…, which now answers 0).
- V9 (treat `unreadable` as `absent`: drop the `reading.state === 'unreadable'` refusal) → 4 failed (the three
  unreadable rows; the directory row, whose set-window now ends `windows-unwritable` on the rename and whose
  clear-window answers 0).
- V10 (drop `{ mode: 0o600 }` in `writeWindows`) → 1 failed (writes the file 0600…).
- V11 (drop `setAt: new Date().toISOString()`) → 1 failed (set-window records the window with a UTC setAt…).
- V12 (after the write, also `writeRegistry(a.id, registry)`) → 1 failed (never rewrites the class registry…, on its
  mtime).
- V13 (drop the render check before the write: the `CLASSES.some(…)` block that runs `modelEnvBlock`) → 1 failed (a
  lane whose env block cannot be rendered…: set-window answers `settings-unwritable` from `materialise`, and the
  windows file has changed).
- V14 (the post-write `materialise` refusal passes `mat.err[1]` alone) → 1 failed (a settings.json the materialise
  cannot rewrite…).
- V15 (`writeWindows`' `catch` returns `null`) → 1 failed (the models-directory row: set-window goes on to
  `materialise`, which answers `materialise-failed`). As root, 0: that row is skipped.
- V16 (the unlink `catch` ignores every error, not only ENOENT) → 1 failed (the models-directory row, on its
  clear-window). As root, 0: that row is skipped.
- M8 (Task 2's row, the minimum over `Object.values(windows)`, re-run against THIS file) and R6 (Task 3's row,
  `describe` reports `contextWindow: null`, re-run) → each at least 1 failed: "a stale entry for a model no class
  names is ignored by the rule and still listed by show", which pins their behaviour through `show` and calls no
  verb of this task.

`windows-invalid` has no row of its own, deliberately. The re-validation before the rename is rule 2 of the file
header (`:22-34`), and from these two ops it fires only when a guard before it is weakened: V1 and V2 measure it
firing (`"400k"` and `"1000001"` end there). With every guard in place no input reaches it, so deleting it changes
no answer and no row can go red; the mutation rule ("every new guard ships with a row that goes red") is met by the
guards in front of it. Record that in the commit body beside the measured rows, so a reviewer does not hunt for a
missing one.

- [ ] **Step 7: Commit**

```bash
git add deploy/models-op.mjs server/test/models-op.test.ts server/test/modelenv.test.ts
git commit -m "models-op: set-window and clear-window (codex-bridge Stage 0, Task 4)"
```

---

### Task 5: `ccrc models <id> set-window | clear-window`, the summary, and the README

**Files:**
- Modify: `ccd/ccrc` (`MODELS_SUBS` `:2002`; the `models` usage text `:2066-2070`; `_models_summary` after its
  catalogue line `:9814-9815`; two arms in `_models_lane_sub` after `set-effort` `:10059-10068`)
- Modify: `README.md` ("Model classes per lane: `ccrc models`", `:1718-1763`)
- Test: `server/test/ccrc-models.test.ts` (the `MODELS_SUBS` list `:518`; a describe after
  `describe('ccrc models <id> set-effort'` ends `:1075`)

**Interfaces:**
- Consumes: Task 4's ops and answers; Task 3's `show` fields `windows` and `contextWindow`.
- Produces: `ccrc models <id> set-window <modelId> <tokens>` and `ccrc models <id> clear-window <modelId>`, with exit 2
  for a missing or extra argument (`missing-argument`, `unknown-argument`) before node, and the op's own answer and
  exit code otherwise. `show`'s stderr summary gains a `context window:` line and one `measured window:` line per
  entry, or the unreadable sentence.

- [ ] **Step 1: Write the failing tests**

In `server/test/ccrc-models.test.ts`, change the expected list in `it('spells its per-lane subcommand list once, at
file scope'` (`:518`) to:

```ts
      .toEqual(['clear-window', 'discovery', 'init', 'rm', 'set-class', 'set-effort', 'set-subagent', 'set-window', 'show']);
```

Insert this describe after the `});` that closes `describe('ccrc models <id> set-effort'`:

```ts
describe('ccrc models <id> set-window and clear-window (codex-bridge spec §2.7)', () => {
  // Model ids are read off SEEDED, and roster ids by position: this
  // repository is public.
  const ID = LEGACY_EXTERNAL_ID;
  const OPUS = SEEDED.classes.opus!;
  const CLASS_MODELS = [...new Set(Object.values(SEEDED.classes).filter((v): v is string => v !== null))];
  const winPath = (): string => join(home, '.ccrc', 'models', `${ID}.windows.json`);
  const settingsEnv = (): Record<string, string> =>
    JSON.parse(fs.readFileSync(join(home, ROSTER.accounts[2]!.configDirSuffix, 'settings.json'), 'utf8')).env;

  beforeEach(() => {
    writeCatalogue(ID);
    seedCodex(ID);
  });

  it('set-window reaches the op: one JSON object, the window recorded, the lane re-materialised', () => {
    for (const m of CLASS_MODELS) {
      const r = run(['models', ID, 'set-window', m, '400000']);
      expect(r.code, r.stdout + r.stderr).toBe(0);
      expect(oneObject(r)['op']).toBe('set-window');
    }
    expect(settingsEnv()['CLAUDE_CODE_MAX_CONTEXT_TOKENS']).toBe('400000');
    expect(fs.existsSync(winPath())).toBe(true);
  });

  it('clear-window reaches the op and answers removed', () => {
    expect(run(['models', ID, 'set-window', OPUS, '400000']).code).toBe(0);
    const r = run(['models', ID, 'clear-window', OPUS]);
    expect(r.code).toBe(0);
    expect(oneObject(r)['removed']).toBe(true);
  });

  it.each([
    [['set-window'], 'missing-argument'],
    [['set-window', 'model-9-omega'], 'missing-argument'],
    [['set-window', 'model-9-omega', '400000', 'extra'], 'unknown-argument'],
    [['clear-window'], 'missing-argument'],
    [['clear-window', 'model-9-omega', 'extra'], 'unknown-argument'],
  ] as [string[], string][])('%j is a usage error at exit 2, answered before node', (args, error) => {
    const r = run(['models', ID, ...args]);
    expect(r.code).toBe(2);
    expect(oneObject(r)['error']).toBe(error);
    expect(fs.existsSync(winPath())).toBe(false);
  });

  it('a refusal from the op passes through unchanged, at exit 1, with its sentence on stderr', () => {
    const r = run(['models', ID, 'set-window', OPUS, '400k']);
    expect(r.code).toBe(1);
    expect(oneObject(r)['error']).toBe('bad-window');
    expect(r.stderr).toMatch(/digits only/);
  });

  it('an anthropic lane refuses, as it refuses every change', () => {
    const r = run(['models', ROSTER.accounts[1]!.id, 'set-window', OPUS, '400000']);
    expect(r.code).toBe(1);
    expect(oneObject(r)['error']).toBe('anthropic-lane');
  });

  it('show summarises the effective window, its rule, and each measured window', () => {
    for (const m of CLASS_MODELS) expect(run(['models', ID, 'set-window', m, '400000']).code).toBe(0);
    const r = run(['models', ID, 'show']);
    expect(r.code).toBe(0);
    expect(r.stderr).toMatch(/context window: 400000 tokens, measured \(the smallest across the class models\)/);
    for (const m of CLASS_MODELS) expect(r.stderr).toContain(`measured window: ${m} 400000 tokens (set `);
  });

  it('show on a lane part-way measured names the default rule and the models still unmeasured', () => {
    expect(run(['models', ID, 'set-window', OPUS, '400000']).code).toBe(0);
    const r = run(['models', ID, 'show']);
    expect(r.stderr).toContain('context window: 200000 tokens, from the catalogue; not measured: '
      + CLASS_MODELS.filter((m) => m !== OPUS).join(', '));
  });

  it('show names an unreadable windows file and says the default rule applies', () => {
    fs.writeFileSync(winPath(), '{ this is not json');
    const r = run(['models', ID, 'show']);
    expect(r.code).toBe(0);
    expect(r.stderr).toMatch(/the windows file cannot be read, so the default rule applies: .*is not valid JSON/);
  });

  it('show --json still prints nothing on stderr', () => {
    expect(run(['models', ID, 'set-window', OPUS, '400000']).code).toBe(0);
    expect(run(['models', ID, 'show', '--json']).stderr).toBe('');
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `./node_modules/.bin/vitest run test/ccrc-models.test.ts -t 'set-window|per-lane subcommand list'`
Expected: FAIL. The list case reds on the missing two names; every verb case answers `unknown-subcommand` at exit 2;
the five usage rows answer `unknown-subcommand` instead of their own word, so they are red too.

- [ ] **Step 3: Dispatch the two verbs in `ccd/ccrc`**

Replace `MODELS_SUBS="discovery init rm set-class set-effort set-subagent show"` (`:2002`) with:

```bash
MODELS_SUBS="clear-window discovery init rm set-class set-effort set-subagent set-window show"
```

In `_models_lane_sub`, after the `set-effort)` arm's `;;` (`:10068`), insert:

```bash
    set-window)
      # Codex-bridge spec §2.7: a measured context window for one MODEL (not a
      # class), in the lane's sibling windows file. The count and its range are
      # node's to check (`deploy/models-op.mjs`, against shared/models.mjs's
      # bounds); this arm checks only that both words are there.
      local model="${1:-}" tokens="${2:-}"
      [ -n "$model" ] && [ -n "$tokens" ] \
        || _models_refuse missing-argument 2 "ccrc models $id set-window needs a model and a token count: ccrc models $id set-window <modelId> <tokens>"
      shift 2
      [ $# -eq 0 ] || _models_refuse unknown-argument 2 "ccrc models $id set-window takes a model and a token count, and got \"$1\""
      _models_answer set-window --file "$file" --id "$id" --model "$model" --tokens "$tokens" || exit $?
      return 0
      ;;
    clear-window)
      local model="${1:-}"
      [ -n "$model" ] \
        || _models_refuse missing-argument 2 "ccrc models $id clear-window needs a model: ccrc models $id clear-window <modelId>"
      shift
      [ $# -eq 0 ] || _models_refuse unknown-argument 2 "ccrc models $id clear-window takes one model, and got \"$1\""
      _models_answer clear-window --file "$file" --id "$id" --model "$model" || exit $?
      return 0
      ;;
```

- [ ] **Step 4: The summary lines**

In `_models_summary`, after the catalogue item (`:9814-9815`):

```
    (if .catalogue == null then "  catalogue: never probed — run: ccrc models refresh \(.id)"
     else "  catalogue: \(.catalogue.count) models\(if .catalogue.stale then " (STALE)" else "" end)" end),
```

insert (this is inside the single-quoted jq program: it holds no `'`):

```
    (if .contextWindow == null then empty
     elif .contextWindow.rule == "measured" then
       "  context window: \(.contextWindow.tokens) tokens, measured (the smallest across the class models)"
     else
       "  context window: \(if .contextWindow.rule == "default" then "\(.contextWindow.tokens) tokens, from the catalogue" else "not set, the client default applies" end)\(if (.contextWindow.unmeasured | length) > 0 then "; not measured: \(.contextWindow.unmeasured | join(", "))" else "" end)"
     end),
    (if .windows.state == "ok" then
       (.windows.byModel | to_entries[] | "  measured window: \(.key) \(.value.tokens) tokens\(if .value.setAt == null then "" else " (set \(.value.setAt))" end)")
     elif .windows.state == "unreadable" then
       "  the windows file cannot be read, so the default rule applies: \(.windows.reason)"
     else empty end),
```

- [ ] **Step 5: The usage text**

In `usage()`'s `models` entry, after the line `            change it — each re-writing that lane's own settings.json.`
(`:2070`), insert:

```
            set-window/clear-window record or drop a measured context
            window per model; once every class model has one, the lane's
            window is the smallest of them.
```

- [ ] **Step 6: The README**

In "Model classes per lane: `ccrc models`", the sentence about the env block wraps after "the" (`:1728-1729`), so
the find is the second line, whole. Replace `:1729`:

```markdown
subagent model, and a context-window key that never exceeds the client's 200k default — plus
```

with:

```markdown
subagent model, and a context-window key (below) — plus
```

In the command block, after `ccrc models <id> set-effort <class> <level|default>`, add:

```bash
ccrc models <id> set-window <modelId> <tokens>   # record a measured context window, 1000 to 1000000
ccrc models <id> clear-window <modelId>          # drop one
```

After the paragraph that ends `` `ccrc models` needs `node` and `jq`, and has no PWA surface in this build. ``, add:

```markdown
**The context window.** The eighth key, `CLAUDE_CODE_MAX_CONTEXT_TOKENS`, follows one rule. A lane may record a
measured window per model in `~/.ccrc/models/<id>.windows.json`, a sibling of the registry, never a key in it (an
older ccrc refuses registry keys it does not know, so a rollback stays safe): `set-window` writes one, a whole number
from 1,000 to 1,000,000 that you measured — a catalogue number never sets it — and `clear-window` drops one. When
every model the lane's classes name has a measured window, the key is the smallest of them, rounded down to 1,000
and capped at 1,000,000, because Claude Code applies one value to every model in the session, subagents included.
When any of them has none, the key keeps the default rule, `min(catalogue context, 200000)` for the lane's default
model, or is left out when the catalogue cannot say; so a class moved to a new model falls back to the default until
the new model is measured. `set-window` refuses a model that is neither in the lane's catalogue nor one of its class
models. A windows file that cannot be read counts as no measured windows: refresh, materialise and the drift check
carry on under the default rule, `show` names the reason, and both verbs refuse until the file is fixed or deleted.
`show` reports each measured window, the effective window, the rule that chose it and the models still unmeasured;
`rm` reaps the file with the rest. A running session keeps its window until it restarts or swaps.
```

- [ ] **Step 7: Run the tests to see them pass**

Run: `./node_modules/.bin/vitest run test/ccrc-models.test.ts`
Expected: PASS, the base count plus 13.

Run: `./node_modules/.bin/vitest run test/ccrc-cli.test.ts`
Expected: PASS (the usage line and the `models` entry's first line are unchanged).

- [ ] **Step 8: Measure the mutation rows**

One at a time on `ccd/ccrc`, each restored and checked:
- B1 (drop `set-window` from `MODELS_SUBS`) → 11 failed (the list case, and every case that runs `set-window`: they
  answer `unknown-subcommand` at exit 2).
- B2 (the `set-window` arm without its `[ $# -eq 0 ]` line) → 1 failed
  (`["set-window","model-9-omega","400000","extra"]`).
- B3 (the arm passes `--model "$tokens" --tokens "$model"`) → 5 failed (set-window reaches the op…; clear-window
  reaches the op…; show summarises…; show on a lane part-way measured…; show --json…). "a refusal from the op passes
  through" stays green: swapped, it is still `bad-window`.
- B4 (drop the `measured` branch of the summary's first new item) → 1 failed (show summarises the effective window…).
- B5 (drop the summary's `unreadable` branch) → 1 failed (show names an unreadable windows file…).
- B6 (the `clear-window` arm calls `_models_answer set-window …`) → 1 failed (clear-window reaches the op…).

- [ ] **Step 9: Commit**

```bash
git add ccd/ccrc server/test/ccrc-models.test.ts README.md
git commit -m "ccrc models: set-window and clear-window, and the window in show (codex-bridge Stage 0, Task 5)"
```

---

## Whole-branch checks (before the PR is marked ready)

- [ ] **Step 1: Every suite this branch touches, one file per command, from `server/`**

```bash
./node_modules/.bin/vitest run test/models.test.ts
./node_modules/.bin/vitest run test/modelenv.test.ts
./node_modules/.bin/vitest run test/modelenv-types.test.ts
./node_modules/.bin/vitest run test/modelenv-single-writer.test.ts
./node_modules/.bin/vitest run test/models-op.test.ts
./node_modules/.bin/vitest run test/ccrc-models.test.ts
./node_modules/.bin/vitest run test/ccrc-cli.test.ts
./node_modules/.bin/vitest run test/ccrc-codex.test.ts
./node_modules/.bin/vitest run test/ccrc-codex-launcher.test.ts
./node_modules/.bin/vitest run test/ccgpt-usage.test.ts
./node_modules/.bin/vitest run test/single-definition.test.ts
./node_modules/.bin/vitest run test/typecheck-tests.test.ts
./node_modules/.bin/vitest run test/topology-clean.test.ts
git fetch -q origin main && ./node_modules/.bin/vitest run test/deviation-refs.test.ts
./node_modules/.bin/vitest run test/dtbd.test.ts
./node_modules/.bin/tsc --noEmit -p .
```

Expected: every file green against its base `Tests` line plus the counts above. `dtbd.test.ts` is red only if a
departure was written `D-TBD-<slug>` while executing; that one is reported, and the coordinator issues its number
(Global Constraints). `deviation-refs.test.ts` must see D-5160 and D-5161 defined once, in this plan. Any other red
is re-run alone before it is called a break.

Left to CI's selection and the daily full run, not run here because the box is memory-tight and they are long:
`ccrc-doctor.test.ts`, `ccrc-account.test.ts` and `ccrc-install.test.ts`, which also spawn `deploy/models-op.mjs`
(the doctor's codex arms run `show` and `materialise`). No assertion found in them reads the two new `show` fields
or counts the summary's lines, and this branch adds no import to `deploy/models-op.mjs`'s closure, so
`ccrc-doctor.test.ts`'s copied `MODELS_OP_CLOSURE` and `installTreeFixture.ts`'s file list still hold. Before
marking the PR ready, check its `select tests` summary lists them; if one is not listed, run it here, alone.

- [ ] **Step 2: The PWA still compiles the shared types**

```bash
cd ../pwa && ./node_modules/.bin/tsc --noEmit -p .
```

Expected: exit 0 (`pwa/tsconfig.json` includes `../shared`, so the new `ModelWindows` type and re-exports are
checked there under `noUnusedLocals`).

- [ ] **Step 3: Nothing private, nothing real**

```bash
git diff origin/main -- . | grep -nE '^\+.*gpt-[0-9]' || echo clean
```

Expected: `clean` — no added line spells a real model id; the fixture lanes' models are read off `SEEDED` and
`CODEX`. Read every changed line of `README.md`, the spec note and this plan once for lane, host or account names.

- [ ] **Step 4: Report**

Report the wave-done with every task's measured mutation rows (from the commit bodies), any `D-TBD-<slug>`
written while executing, the known-stale sites (Global Constraints) for the PR body, and any departure by slug.

---

## After R-O9 (operator runbook)

Not a task, and not run by any agent. R-O9 is the GPT-lane soak's final sample (spec §2.1); the soak measures one
unchanged system, so nothing below starts until R-O9 closes. A merged and rolled-out build changes nothing on its
own: with no windows file, every lane's env block is the one it has today.

1. **Confirm R-O9 is closed** and pick the release that carries this PR.
2. **Roll it out** the usual way, fleet box first (`ccrc rollout --to vX.Y.Z`, or `ccrc update --to vX.Y.Z` per box).
   On each Codex lane, `ccrc models lane-a show --json | jq '.contextWindow'` answers `"rule": "default"` with
   `"tokens": 200000`, or `"rule": "none"` with `"tokens": null` when the lane's catalogue is stale, was never
   probed or does not list the lane's default model, and `jq '.windows'` answers `{"state": "absent"}`. Either way
   the build is in and no window is set; a field missing altogether means the box still runs the old build.
3. **Choose the value**, once, for the day: up to about 511k was measured on 2026-10-15 for every model the lanes'
   classes name (spec §1.2, D7). A larger window lets each call carry more context, so each call spends more of the
   plan; the value is chosen now, not by this plan.
4. **List each lane's class models:** `ccrc models lane-a show --json | jq -r '.contextWindow.unmeasured[]'`.
5. **Set one window per class model:** `ccrc models lane-a set-window <model> <tokens>` for each. The lane's key keeps
   its default-rule value (step 2's) until the LAST one is set, then moves to the smallest in that same call.
6. **Verify:** `show --json` gives `"rule": "measured"` with the chosen `tokens` and `"settingsDrift": []`, and the
   lane's `settings.json` carries `env.CLAUDE_CODE_MAX_CONTEXT_TOKENS`. Claude Code reads settings at launch, so a
   running session keeps its old window until it restarts or swaps.
7. **Repeat for lane-b.**
8. **Watch** for the first days: each lane's compaction rate, and any context refusal ("input exceeds the context
   window") in the lane's logs. Stage 0 never lowers a window by itself; automatic lowering is D25, with the bridge.
9. **Undo, at any time:** `ccrc models lane-a clear-window <model>` for any one class model puts the lane back on the
   default rule at once; clearing all of them deletes the file. A rollback of the build is safe too: an older ccrc
   never opens the windows file, and its next materialise (the hourly refresh runs one) writes 200000 again.
10. **When a class moves** (by hand, or by auto-advance once that ships), the lane falls back to 200000 until the new
    model is measured: set its window then.

## Deviations found

Two deviations are defined here, issued by the allocator on 2026-10-15 and defined in the same act. D-5160 is cited
by the codex-bridge spec's §2.7 and by `shared/models.mjs`; D-5161 by `deploy/models-op.mjs`. A further departure found
while executing is written `D-TBD-<slug>` and named in the task's report, never numbered by a worker.

### D-5160 — the measured windows live in a sibling file, not in the class registry

- **Departs from:** the codex-bridge spec as written before acceptance. §2.7 read "Each lane's registry may record a
  **measured window per model**", and §4 read "The registry file gains an optional per-model `windows` map".
- **What changed:** at acceptance (2026-10-15) the windows moved to `~/.ccrc/models/<id>.windows.json`, a sibling of
  `<id>.classes.json`; the spec's §2.7 and §4 were amended to say so, and §2.7 cites this entry (§4 does not). The
  file is `{"windows": {"<model id>": {"tokens": <integer>, "setAt": "<ISO-8601 UTC>"}}}`. Its reader TOLERATES
  unknown keys and its writer PRESERVES them, the opposite of the registry's policy, so a later build can add fields
  without the same hazard.
- **Why:** `parseRegistry` refuses any top-level key outside `REGISTRY_KEYS` (`shared/models.mjs:89`, `:196-:203`).
  A `windows` key would make an older ccrc, after a rollback, refuse every lane's registry, and with it every verb on
  the lane, including the one that could remove the key. An older ccrc never opens the sibling file, so its lanes
  fall back to the default rule, 200k at most: the safe direction. It is the auto-advance spec's D13 reasoning,
  applied to one more per-lane fact.
- **Pinned by:** `models.test.ts`, "the registry still refuses a windows key" (red if `windows` joins
  `REGISTRY_KEYS`, row W6); `models-op.test.ts`, "never rewrites the class registry — bytes and mtime unchanged"
  (row V12); and `single-definition.test.ts`, "the WINDOWS file is named by exactly two files" (one writer).
- **Cost if wrong:** one more file per lane, which `rm` reaps and `ccrc account remove` keeps (its `$id.*` glob over
  `~/.ccrc/models/` already covers it, and names `ccrc models <id> rm`). If a later build folds the windows back into
  the registry, it needs a migration and the rollback argument made again.

### D-5161 — clearing the last window keeps a file that holds a key this build does not know

- **Departs from:** ruling 5 (Rulings this plan builds on): "clearing the last entry deletes the file, so absent means
  no measured windows".
- **What changed:** `clear-window` deletes the file when its last entry goes AND `windows` was the file's only
  top-level key. When the file also holds a top-level key this build does not know (a later build's `version`, say),
  it writes `{…those keys…, "windows": {}}` instead. Pinned by `models-op.test.ts`, "clearing the last entry KEEPS a
  file that still holds a top-level key this build does not know" (rows V5, V7), beside "clearing the LAST entry
  deletes the file" (row V6), which keeps ruling 5's literal rule for every file this build writes. `windowOp`'s
  docstring cites this entry.
- **Why:** ruling 5's delete and ruling 2's preservation rule ("the writer PRESERVES them by read-modify-write")
  conflict only on this file, and deleting it would destroy what ruling 2 says the writer keeps. The purpose ruling 5
  gives still holds: `parseWindows` reads `{"windows": {}}` as no measured window, so the lane's rule is the default
  either way, as it is for an absent file.
- **Cost if wrong:** on such a file `show` answers `windows: {state: "ok", byModel: {}}` rather than
  `{state: "absent"}`, and the file stays until `rm` reaps it or the operator deletes it. If the ruling is that the
  delete wins, it is a one-line change in `windowOp` (drop `&& Object.keys(raw).length === 1`) plus that test's
  expectation, and the unknown keys are lost on the last clear.
