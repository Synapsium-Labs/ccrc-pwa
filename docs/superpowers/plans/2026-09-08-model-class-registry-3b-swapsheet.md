# Model-class registry — Plan 3b: the SwapSheet downgrade choice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A swap to a lane that cannot run this session's class says so in the operator's own words, and the downgrade is their explicit choice — `ccd swap <id> <wrapper> --as-class <c>` — never something rotation does silently.

**Architecture:** Plan 2 already teaches `ccd` to record a session's class, to skip a lane whose available classes do not include it, and to parse `--as-class`. This plan carries that class to the browser and back: the registry `class` field reaches `FleetSession.modelClass`, `CCD_ARGV.swap` gains a third argument, `POST /api/sessions/:id/swap` accepts `asClass`, and `SwapSheet` names the substitute before it moves anything. It is a SEPARATE plan from 3a because account-pools **wave 4** rewrites `SwapSheet.tsx`, `NewSessionSheet.tsx`, `pwa/src/stores/fleet.ts` and `pwa/src/lib/api.ts` (mail 279), and every file this plan touches in the browser is one of those.

**Tech Stack:** TypeScript (server: Fastify + node 22; PWA: React 18 + zustand + vite), vitest.

**Spec:** `docs/superpowers/specs/2026-09-08-model-class-registry-design.md`, at `d3048253` on branch `feat/model-class-registry` (`git -C <spec-worktree> log -1 --oneline` → `d3048253 docs(models): registry is its own per-account file until account-connections merges; subagent is an explicit class-to-slot choice; discovery scope named apart from selectable; Plan 3 splits behind wave 4`). This plan implements spec §7's "Manual swap may downgrade, explicitly" and §8's third bullet.

**Skeleton:** the locked skeleton for the plans is `/tmp/claude-1000/-mnt-HC-Volume-105751470-projects-OpenClawHetzner/fd959665-5e5f-424f-89b3-be8b37bda191/scratchpad/mcr-skeleton.md`. Its **"Rulings round 2"** (mails 279 and 280, 2026-09-08) OVERRIDES the "Locked interfaces" section above it, and this plan implements the round-2 shape: item 9 is what split the old Plan 3 into `…-3a-surfaces.md` and this file, and put this file behind account-pools wave 4's merge; `discovery`, the explicit `subagent`, the top-level `ccrc models` group and the three-column `.classes.tsv` are the round-2 names every sentence here uses.

---

## Gating and ordering (BINDING — spec §14)

1. **Plan 3b starts only after account-pools WAVE 4 is merged into `origin/main`.** Task 1 is a measured gate; the merge sha arrives by mail from the account-pools coordinator, session `ccrc-pwa-amber-summit`. Nothing in this plan is written before that gate passes.
2. **Plan 2 must have landed** on the implementation branch — this plan's browser sentence is only true because `cmd_swap` validates `--as-class` against the destination's available classes, and because `ccd` records a session's class at all. If Plan 2 has not landed, stop: there is no `class` registry field for Task 3 to read.
3. **Plan 3a must have landed** — this plan reads `AccountModels` off the wire through `accountModelsOf` and imports `CLASS_ORDER`/`CLASS_TITLE` from `pwa/src/lib/models.ts`, all of which are 3a's.
4. **This plan touches exactly these files** and no others: `shared/api.ts` (one `FleetSession` field), `server/src/registry.ts`, `server/src/fleet.ts`, `server/src/ccdargv.ts`, `server/src/server.ts` (the swap route), `pwa/src/lib/api.ts` (`swap`'s third argument), `pwa/src/fleet/SwapSheet.tsx`, and their tests. `NewSessionSheet.tsx`, `pwa/src/stores/fleet.ts` and `pwa/src/lib/pools.ts` stay untouched.

---

## Global Constraints

Copied verbatim from the spec and the skeleton. Every task's requirements implicitly include this section.

- **Repo root.** All paths are relative to the implementation worktree's repo root, `<repo>` — `feat/model-class-registry-impl`, created by Plan 1 Task 1 off `origin/main`. Read-only elsewhere: `/home/mfastovets/worktrees/ccrc-pwa/plain-hollow` and `/home/mfastovets/worktrees/ccrc-pwa/clear-meadow` are other sessions' live worktrees.
- **Fixture HOMEs only.** Never run `ccd`, `ccrc`, `systemctl` or `deploy/deploy.sh` against the real `$HOME`; never touch the live `~/.ccrc`. Server tests use `testDeps`/`seedRoster`/`seedSession` (`server/test/helpers.ts`) and `mkTmp` (`server/test/tmpHelpers.ts`).
- **TDD, red first, with a measured mutation check per guard.** The idiom to copy is `server/test/ccd-default-pool.test.ts:20-52`.
- **Tests are vitest.** Run one file with `npx vitest run <path>` from the package directory (`server/`, `pwa/`).
- **Commits.** `type(scope): one sentence in the tree's voice`, trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. One commit per task; never `git add -A` across unrelated files.
- **No `D-<n>` markers.** `server/test/deviation-refs.test.ts` forbids a `D-` number that was not allocated. This plan allocates none.
- **`shared/` is L0**, and `shared/api.ts` keeps exactly ONE import line, `import type { Hue } from './roster.js';` (`server/test/peers-claims-l0.test.ts:155-161`). `FleetSession.modelClass` is therefore a `string | null` on the wire, narrowed at each read site with `isModelClass` (`shared/models.ts`) — the doctrine `Wrapper` already documents in that file and Plan 3a's `AccountModels` follows.
- **The registry FIELD ccd writes is spelled `class`** (Plan 2); `modelClass` is the WIRE name only, and the two are joined in exactly one place, `server/src/registry.ts`.
- **Spec §15.2:** auto-swap for a session whose class is unavailable on a lane **skips the lane** — never a silent downgrade. A downgrade is only ever this sheet's confirmed `--as-class`.
- **`ccd/ccd` is not edited by this plan** (Plan 2 owns it), so the `# ccrc:generated` re-stamp does not apply.
- **PWA design contract.** `pwa/design/DIRECTION.md`; run `npx vitest run test/contrast.test.ts` from `pwa/` after any stylesheet edit. This plan adds no new CSS rule.
- **Do not run `deploy/deploy.sh`.**
- **This plan document is already on the branch.** Plan 1 Task 17 commits all four plans plus the spec into `docs/superpowers/plans/` and `docs/superpowers/specs/` of the implementation worktree, so a reviewer of this plan's PR reads the plan the diff argues from rather than a path in another session's scratchpad. If this file is revised while executing it, re-copy it from `<S>/mcr/docs/superpowers/plans/` and include it in this plan's LAST commit — never in a commit that also carries code.

---

### Task 1: the measured gate — account-pools wave 4 is on `origin/main`

Nothing in this plan may be written before this task passes. It is a READ-ONLY check and it changes no file.

**Files:**
- Modify: none. This task produces a recorded measurement, not a diff.

**Interfaces:**
- Consumes: the wave-4 merge sha, which arrives by mail from `ccrc-pwa-amber-summit` (the account-pools coordinator).
- Produces: a go/no-go, and the sha Task 2 rebases onto.

- [ ] **Step 1: Read the sha out of the coordinator's mail**

Run: `~/.local/bin/ccrc-api mail list --to "$CCRC_SESSION" --limit 20`
Then read the wave-4 message in full: `~/.local/bin/ccrc-api mail show <id>`
Expected: a message from `ccrc-pwa-amber-summit` naming account-pools wave 4 as merged, with a 40-hex merge sha. Record that sha as `<W4>` for the rest of this plan. If no such mail has arrived, STOP — this plan does not start, and asking the coordinator is the next action, not writing code.

- [ ] **Step 2: Fetch, and measure that the sha is really an ancestor of `origin/main`**

Run from `<repo>`:

```bash
git fetch origin main
git -C . merge-base --is-ancestor <W4> origin/main && echo "wave 4 is on main" || echo "NOT on main"
```

Expected: `wave 4 is on main` (exit 0). `NOT on main` means the mail is ahead of the merge, or the sha names a commit on the wave's own branch rather than the merge — STOP and ask the coordinator which sha to gate on. A claim in a message is not a measurement; this command is.

- [ ] **Step 3: Measure that wave 4's own files really moved**

Run from `<repo>`:

```bash
git show --stat <W4> | grep -E 'SwapSheet|NewSessionSheet|stores/fleet|lib/api|lib/pools'
```

Expected: at least `pwa/src/fleet/SwapSheet.tsx` among the changed paths. If the sha touches none of them, it is not the wave this plan is gated on — STOP and ask. This is the guard against gating on a sha that merged cleanly and merged the wrong thing.

- [ ] **Step 4: Confirm Plan 2 has landed on this branch**

Run from `<repo>`: `grep -n "_reg_read_class" ccd/ccd | head -3`
Expected: at least one hit — Plan 2's dedicated measured read of the registry `class` field. No hit means Plan 2 has not landed and this plan cannot read a class that nothing writes: STOP.

- [ ] **Step 5: Record the measurement in the branch, not in a memory**

```bash
git -C . log -1 --format='%H %s' <W4>
```
Paste that line into this task's checkbox when ticking it, so the next reader of this plan knows exactly which merge it was executed against. No commit is made by this task.

---

### Task 2: rebase the implementation branch onto wave 4's merge

**Files:**
- Modify: whatever the rebase touches. No hand-written change beyond conflict resolution.

**Interfaces:**
- Consumes: Task 1's `<W4>`.
- Produces: `feat/model-class-registry-impl` rebased, with every suite green.

- [ ] **Step 1: Rebase**

Run from `<repo>`:

```bash
git status --porcelain          # must be empty before starting
git rebase <W4>
```

Expected: a clean rebase, or conflicts in the files both waves touch. **Conflicts are resolved in favour of wave 4's structure** — it is the merged, shipped shape and this branch is the one that must fit around it. Plan 3a touched none of wave 4's four files, so the likely conflicts are none at all; if `pwa/src/lib/api.ts` conflicts, keep wave 4's version of every line and re-apply Plan 3a's three model methods on top.

- [ ] **Step 2: Re-run every suite, because a green rebase is not a green tree**

Run from `server/`: `npx vitest run` — PASS.
Run from `pwa/`: `npx vitest run` — PASS.
Run from `agent/`: `npx vitest run` — PASS.
Run from `<repo>`: `npx tsc -p server --noEmit && npx tsc -p pwa --noEmit && npx tsc -p agent --noEmit` — no output.

Anything red here is a rebase result, not a bug this plan introduced: fix it before Task 3, and say in the fix's commit message which wave-4 change caused it.

- [ ] **Step 3: Read wave 4's SwapSheet before writing a line of Task 4**

Run from `<repo>`: `sed -n '1,80p' pwa/src/fleet/SwapSheet.tsx` and then read the whole file.
Expected: the post-wave-4 shape — the target rows, the `AccountRow` props, the confirm's `consequence` string, and whatever pool copy wave 4 added. Task 4's edits are written against THAT file, not against the one this plan's author read.

- [ ] **Step 4: Commit only if the rebase needed a fix**

If Step 1 resolved a conflict or Step 2 required a repair:

```bash
git add -u
git commit -m "chore(rebase): fit the model-class branch onto account-pools wave 4

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

If the rebase was clean and every suite passed untouched, there is nothing to commit and that is the expected outcome.

---

### Task 3: the session's class reaches the wire, and `--as-class` reaches the verb

Spec §7's last two bullets, server side. `ccd` records a class (Plan 2); this task carries it to the browser and accepts the operator's explicit downgrade back.

**Files:**
- Modify: `shared/api.ts` (`FleetSession` gains one field; `reviveFleetSession` gains one line)
- Modify: `server/src/registry.ts` (`SessionRecord` gains one field; `buildRecord` reads one more registry file)
- Modify: `server/src/fleet.ts` (carry it onto `FleetSession`)
- Modify: `server/src/ccdargv.ts` (`swap` gains a third argument)
- Modify: `server/src/server.ts:1851-1858` (the swap route accepts `asClass`)
- Modify: `server/test/whitelist-subset.test.ts` (the `swap` sample and one prefix assertion)
- Modify: `server/test/fleet.test.ts` (two cases)
- Create: `server/test/swap-class-route.test.ts`
- Modify: `pwa/src/lib/api.ts` (`swap` gains a third argument)
- Idiom copied from: `server/src/ccdargv.ts:203-208` (`stopId`'s "the flag rides as an argv flag, and `null` yields the bare argv token for token"); `server/test/whitelist-subset.test.ts:196-210` (the `stop`-is-a-bare-one-token-grant assertion, which is why `swap --as-class` needs no widening); `server/src/registry.ts:333-336` (`field()`, the reader every non-triple registry field uses); `shared/api.ts:2477-2530` (`Wrapper`'s "a string on the wire, narrowed at the read site" doctrine)

**Interfaces:**
- Consumes: Plan 2's ccd half — the registry `class` field written by `_session_class`, and `cmd_swap`'s `--as-class <c>` parse and validation. `shared/models.ts`'s `isModelClass` (Plan 3a Task 1). **`CCD_ARGV.swap`'s widening is THIS task's, not Plan 2's:** Plan 2 edits `ccd/ccd`, `ccd/statusline-command.sh` and their bash suites and touches no server TypeScript at all (its File Structure names `server/src/*` nowhere and its "Not touched by this plan" paragraph names "every server route"), so `server/src/ccdargv.ts` still has the two-argument `swap` when this task runs.
- Produces:
  - `shared/api.ts`: `FleetSession` gains `modelClass?: string | null`
  - `server/src/registry.ts`: `SessionRecord.modelClass: string | null`
  - `server/src/ccdargv.ts`: `CCD_ARGV.swap(id: string, w: string, asClass: string | null)`
  - Route `POST /api/sessions/:id/swap` body `{ wrapper: string; asClass?: string }` → `400 {ok:false,error:'bad-class'}` for a word that is not a class
  - `pwa/src/lib/api.ts`: `swap(id, wrapper, asClass?)`

- [ ] **Step 1: Write the failing server test**

Create `server/test/swap-class-route.test.ts`:

```ts
// `--as-class` is the ONLY way a swap may downgrade (spec §7, §15.2): rotation
// skips a lane whose available classes do not include the session's, and a
// manual swap to such a lane refuses without the flag. This file pins the two
// halves the server owns — the argv it builds, and the body it will accept.
import { describe, it, expect } from 'vitest';
import { CCD_ARGV } from '../src/ccdargv.js';
import { EXEC_WHITELIST, isExecAllowed } from '../../agent/src/whitelist.js';
import { buildServer } from '../src/server.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import type { Runner } from '../src/exec.js';

describe('CCD_ARGV.swap', () => {
  it('is byte-identical to what it always was when no class is named', () => {
    expect([...CCD_ARGV.swap('demo-quiet-basin', 'claude2', null)])
      .toEqual(['swap', 'demo-quiet-basin', 'claude2']);
  });

  it('appends the flag AFTER the positionals, where every other builder here puts one', () => {
    expect([...CCD_ARGV.swap('demo-quiet-basin', 'gpt', 'opus')])
      .toEqual(['swap', 'demo-quiet-basin', 'gpt', '--as-class', 'opus']);
  });

  it('crosses the existing one-token grant with no widening — `stop --surface`\'s own rule', () => {
    expect(EXEC_WHITELIST.ccd.filter((p) => p[0] === 'swap')).toEqual([['swap']]);
    expect(isExecAllowed('ccd', [...CCD_ARGV.swap('demo-quiet-basin', 'gpt', 'opus')])).toBe(true);
  });
});

describe('POST /api/sessions/:id/swap', () => {
  const box = () => {
    const calls: string[][] = [];
    const run: Runner = async (cmd, args) => {
      calls.push([cmd.split('/').pop() ?? cmd, ...args]);
      return { code: 0, stdout: '', stderr: '' };
    };
    return { calls, deps: testDeps(mkTmp('ccrc-swap-class-'), run) };
  };

  it('passes a class through to the verb', async () => {
    const b = box();
    const app = await buildServer(b.deps);
    try {
      const res = await app.inject({
        method: 'POST', url: '/api/sessions/demo-quiet-basin/swap',
        payload: { wrapper: 'gpt', asClass: 'opus' },
      });
      expect(res.statusCode).toBe(200);
      expect(b.calls[0]).toEqual(['ccd', 'swap', 'demo-quiet-basin', 'gpt', '--as-class', 'opus']);
    } finally { await app.close(); }
  });

  it('sends the bare argv when no class is named, as every caller before today did', async () => {
    const b = box();
    const app = await buildServer(b.deps);
    try {
      await app.inject({
        method: 'POST', url: '/api/sessions/demo-quiet-basin/swap', payload: { wrapper: 'gpt' },
      });
      expect(b.calls[0]).toEqual(['ccd', 'swap', 'demo-quiet-basin', 'gpt']);
    } finally { await app.close(); }
  });

  it('refuses a class that is not one, before it becomes an argv token', async () => {
    const b = box();
    const app = await buildServer(b.deps);
    try {
      for (const asClass of ['ultra', '', '--reason', 42]) {
        const res = await app.inject({
          method: 'POST', url: '/api/sessions/demo-quiet-basin/swap',
          payload: { wrapper: 'gpt', asClass },
        });
        expect(res.statusCode, String(asClass)).toBe(400);
      }
      expect(b.calls).toEqual([]);
    } finally { await app.close(); }
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run from `server/`: `npx vitest run test/swap-class-route.test.ts`
Expected: FAIL — `TS2554: Expected 2 arguments, but got 3` under `tsc`, and under vitest's transform (which does not enforce arity) the third argument is dropped, so the flagged case receives the bare argv: `expected [ 'ccd', 'swap', 'demo-quiet-basin', 'gpt' ] to deeply equal [ …, '--as-class', 'opus' ]`.

- [ ] **Step 3: Read the registry field and carry it onto the session**

`shared/api.ts`, in `FleetSession` directly under `model: string | null;`:

```ts
  /** The class ccd last recorded for this session (Plan 2's registry `class`
   *  field, written by `_session_class` at every swap, `ensure` and `stop`), or
   *  `null` when ccd carries none — a session that has never rendered a
   *  statusline, a lane whose id is in no `classes` map, or a build of ccd that
   *  predates the field.
   *
   *  A `string`, NOT a class union, and that is `Wrapper`'s own doctrine two
   *  hundred lines below rather than laziness: this file may hold exactly one
   *  import and it must be a type, so no runtime list can reach the reviver
   *  here. Every read site narrows with `isModelClass` (`shared/models.ts`) —
   *  `SwapSheet` is the only one today.
   *
   *  OPTIONAL, on `RosterWire.models`' terms (Plan 3a): a server built before
   *  this field omits it, and the sheet's single reader answers "no class
   *  recorded" for both absence and `null`, which is the permissive direction —
   *  no downgrade sentence, no substitute, no claim. */
  modelClass?: string | null;
```

In `reviveFleetSession`'s literal, directly under `model: optStr(o, 'model'),`:

```ts
      // Absent -> null, `optStr`'s own rule and the right degrade: a snapshot
      // written before ccd recorded a class is IGNORANT of it, not a witness
      // that there is none. Present-but-non-string throws inside `optStr`,
      // which this function's catch turns into "reject the whole session" —
      // the same rule `held` follows.
      modelClass: optStr(o, 'modelClass'),
```

`server/src/registry.ts`, in `SessionRecord` beside `workspace`:

```ts
  /** The class ccd last recorded for this session (Plan 2's `class` field), or
   *  `null` when there is none — ccd carries nothing for a session it cannot
   *  class.
   *
   *  `field()`, not `fieldMeasured()`: an unreadable class file and an absent
   *  one lead to the same behaviour at every reader ON THIS SIDE (no downgrade
   *  sentence, no substitute), so the measured ladder would buy a distinction
   *  nobody here acts on — the same ruling `home`/`pool`/`workspace` already
   *  carry. ccd itself reads the field through `_reg_read_class`, which DOES
   *  distinguish, because ccd is the side that routes on it (spec §7). */
  modelClass: string | null;
```

In `buildRecord`'s `Promise.all`, add `field(io, cfg.registryDir, id, 'class')` at the end of the array and `classRaw` at the end of the destructuring; in the returned record:

```ts
    // Empty reads as ABSENT: `_reg_set "$id" class ""` is how ccd CLEARS a
    // class, and `field()` returns `''` for it — which is not a class name and
    // must not travel as one.
    modelClass: classRaw === null || classRaw === '' ? null : classRaw,
```

`server/src/fleet.ts`, on the assembled row beside `model:`:

```ts
      model: sl?.model ?? null, effort: sl?.effort ?? null, modelClass: r.modelClass,
```

Add the fleet cases that measure it, in `server/test/fleet.test.ts`:

```ts
describe('FleetSession.modelClass', () => {
  it('carries the class ccd recorded for a session onto the wire', async () => {
    // The one fact the SwapSheet's downgrade sentence rests on. Without it the
    // browser would have to re-derive a class from a statusline display NAME,
    // which is a THIRD implementation of `_session_class` — the drift spec §3
    // and §12's agreement test exist to prevent.
    //
    // `seedSession`'s extra-fields map writes the class the way ccd writes it:
    // one registry file, `<id>.class`.
    const home = mkTmp('ccrc-fleet-class-');
    seedRoster(home);
    seedSession(home, 'claude-a-MekWarLive', 'claude-a', { class: 'fable' });
    const run: Runner = async () => ({ code: 1, stdout: '', stderr: '' });
    const cfg = loadConfig({ CCRC_HOME: home });
    const fleet = await assembleFleet(localIO, cfg, new Tmux(run), 1784600000);
    expect(fleet.find((s) => s.id === 'claude-a-MekWarLive')?.modelClass).toBe('fable');
  });

  it('reads an EMPTY class file as no class — that is how ccd clears one', async () => {
    const home = mkTmp('ccrc-fleet-class-empty-');
    seedRoster(home);
    seedSession(home, 'claude-a-MekWarLive', 'claude-a', { class: '' });
    const run: Runner = async () => ({ code: 1, stdout: '', stderr: '' });
    const fleet = await assembleFleet(localIO, loadConfig({ CCRC_HOME: home }), new Tmux(run), 1784600000);
    expect(fleet.find((s) => s.id === 'claude-a-MekWarLive')?.modelClass).toBeNull();
  });
});
```

- [ ] **Step 4: Widen the swap argv and the route**

`server/src/ccdargv.ts`:

```ts
  /** `asClass` is REQUIRED and nullable, on `stopId`'s exact terms: `null`
   *  OMITS the flag entirely and the argv is byte-identical to the one that
   *  shipped before this wave. It carries the operator's EXPLICIT downgrade
   *  (spec §7) — rotation never downgrades, because `_swap_target` skips a lane
   *  whose available classes do not include the session's, and a manual swap to
   *  such a lane refuses without this flag.
   *
   *  NO CAPABILITY GATE, and that is a deliberate difference from `--surface`.
   *  An old ccd meeting `swap <id> <w> --as-class opus` sees a five-argument
   *  swap where `cmd_swap` takes two, dies with its own usage message and exits
   *  non-zero — a LOUD failure this route renders as a 502 — rather than
   *  `stop`'s silent success on a session named `<id>---surface`. Loud is the
   *  safe direction, so no `ccd caps` token is minted for it. */
  swap: (id: string, w: string, asClass: string | null) =>
    argv(asClass === null ? ['swap', id, w] : ['swap', id, w, '--as-class', asClass]),
```

`server/src/server.ts`, the swap route:

```ts
  app.post('/api/sessions/:id/swap', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { wrapper?: unknown; asClass?: unknown };
    if (typeof body.wrapper !== 'string' || body.wrapper.length === 0) {
      return reply.code(400).send({ ok: false, error: 'bad-request' });
    }
    // The class is about to become an argv token, so it is NARROWED against the
    // runtime list rather than cast: `isModelClass` is the only way to obtain a
    // class from an untrusted value, and `undefined` (an ordinary swap) stays
    // distinguishable from a wrong one.
    if (body.asClass !== undefined && !isModelClass(body.asClass)) {
      return reply.code(400).send({ ok: false, error: 'bad-class' });
    }
    return runCcdOr502(reply, CCD_ARGV.swap(id, body.wrapper, body.asClass ?? null));
  });
```

with `isModelClass` added to `server.ts`'s `../../shared/models.js` import.

Update `server/test/whitelist-subset.test.ts`'s sample:

```ts
  // CARRIES A CLASS: a bare sample would leave layer 2 proving only the
  // unflagged shape reachable, and the flagged one is what the SwapSheet's
  // explicit downgrade actually sends.
  swap: ['demo-quiet-basin', 'claude2', 'opus'],
```

and add, beside the `stop` assertion:

```ts
  it('swap is a bare one-token grant, so --as-class crosses with no widening', () => {
    expect(EXEC_WHITELIST.ccd.filter((p) => p[0] === 'swap')).toEqual([['swap']]);
    expect(isExecAllowed('ccd', ['swap', 'demo-quiet-basin', 'gpt', '--as-class', 'opus'])).toBe(true);
  });
```

- [ ] **Step 5: Widen the PWA client**

`pwa/src/lib/api.ts`, the `swap` method (whatever line wave 4 left it on):

```ts
    /** `asClass` is the operator's EXPLICIT downgrade and is OMITTED when
     *  absent, so an ordinary swap posts the byte-identical body it always did.
     *  Rotation never downgrades — ccd skips a lane whose available classes do
     *  not include this session's (spec §7) — so this argument exists only for
     *  the sheet's confirmed substitution. */
    swap: (id: string, wrapper: string, asClass?: string) =>
      post(`${sid(id)}/swap`, asClass === undefined ? { wrapper } : { wrapper, asClass }),
```

- [ ] **Step 6: Run the server tests**

Run from `server/`: `npx vitest run test/swap-class-route.test.ts test/whitelist-subset.test.ts test/registry.test.ts test/fleet.test.ts`
Expected: PASS. A `TS2554` elsewhere names another `CCD_ARGV.swap(` call site — pass `null` there.

Run from `<repo>`: `npx tsc -p server --noEmit && npx tsc -p pwa --noEmit` — no output.

- [ ] **Step 7: Measured mutation #1 — the class really reaches the wire**

Edit `server/src/fleet.ts` and change `modelClass: r.modelClass` to `modelClass: null`.
Run from `server/`: `npx vitest run test/fleet.test.ts -t "carries the class"`
Expected: FAIL — `expected null to be 'fable'`.
Restore. Re-run: PASS.

- [ ] **Step 8: Measured mutation #2 — an empty class file is not a class**

Edit `server/src/registry.ts` and change the record line to `modelClass: classRaw`.
Run from `server/`: `npx vitest run test/fleet.test.ts -t "EMPTY class file"`
Expected: FAIL — `expected '' to be null`: the empty string would travel as a class word and the sheet would try to title-case it.
Restore. Re-run: PASS.

- [ ] **Step 9: Measured mutation #3 — the route narrows rather than casts**

Edit `server/src/server.ts` and delete the `isModelClass` guard from the swap route.
Run from `server/`: `npx vitest run test/swap-class-route.test.ts -t "refuses a class that is not one"`
Expected: FAIL — `expected 200 to be 400` for `'ultra'`, and `ccd swap … --as-class ultra` reaches the recorded calls: a word ccd will refuse becomes an argv token, and the operator gets a 502 instead of a sentence.
Restore. Re-run: PASS.

- [ ] **Step 10: Commit**

```bash
git add shared/api.ts server/src/registry.ts server/src/fleet.ts server/src/ccdargv.ts server/src/server.ts server/test/swap-class-route.test.ts server/test/whitelist-subset.test.ts server/test/fleet.test.ts pwa/src/lib/api.ts
git commit -m "feat(swap): a session's class reaches the browser, and an explicit --as-class reaches the verb

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: the SwapSheet names the downgrade and requires the choice

Spec §7's "Manual swap may downgrade, explicitly" and §8's third bullet. The one surface sequenced behind account-pools wave 4.

**Files:**
- Modify: `pwa/src/fleet/SwapSheet.tsx`
- Modify: `pwa/test/swap-sheet.test.tsx` (new describe)
- Idiom copied from: `pwa/src/fleet/SwapSheet.tsx`'s own three-state `held` copy (whose shape the downgrade sentence follows — a fact, then what it means for this session); `pwa/src/components/QuickConfirm.tsx` (a consequence sentence before a commitment); `pwa/test/swap-sheet.test.tsx`'s existing `storeWith`/`fleetSession` fixtures

**Interfaces:**
- Consumes: Task 3's `FleetSession.modelClass` and `api.swap`'s third argument; Plan 3a's `accountModelsOf` (`pwa/src/lib/accounts.ts`), `CLASS_ORDER`/`CLASS_TITLE` (`pwa/src/lib/models.ts`); `shared/models.ts`'s `isModelClass`, `type ModelClass`.
- Produces:
  - `pwa/src/fleet/SwapSheet.tsx`: `export function downgradeFor(roster: readonly RosterWire[], wrapper: string, cls: string | null): { cls: ModelClass; sub: ModelClass | null; subLabel: string | null } | null` and `export function downgradeSentence(d: NonNullable<ReturnType<typeof downgradeFor>>, lane: string): string`

- [ ] **Step 1: Write the failing sheet test**

Append to `pwa/test/swap-sheet.test.tsx`:

```tsx
describe('SwapSheet names the downgrade when the session\'s class is unavailable on a lane', () => {
  /** A roster where gpt carries three classes and NO Fable — today's fleet,
   *  before anyone classes Astra (spec §1, §13.1). */
  const CLASSED = TEST_ROSTER.map((a) => a.id !== 'gpt' ? a : {
    ...a,
    models: {
      probe: 'codex',
      classes: { haiku: 'gpt-5.6-luna', sonnet: 'gpt-5.6-terra', opus: 'gpt-5.6-sol', fable: null },
      subagent: 'sonnet', discovery: 'catalogue' as const, effort: {},
      catalogue: { fetchedAt: 1789000000, stale: false, count: 4 },
      unclassified: ['gpt-6-astra'], retired: [],
      available: ['haiku', 'sonnet', 'opus'],
      labels: { 'gpt-5.6-sol': 'GPT-5.6 Sol' },
    },
  });

  it('says what the session would run as, naming the substitute model', async () => {
    const s = fleetSession({ wrapper: 'claude', home: 'claude', modelClass: 'fable' });
    render(<SwapSheet session={s} open onClose={vi.fn()} fleet={storeWith([s], CLASSED)} />);
    const row = await screen.findByRole('button', { name: /gpt/ });
    expect(row.textContent).toMatch(/no Fable-class model on gpt/i);
    expect(row.textContent).toMatch(/run as Opus-class \(GPT-5\.6 Sol\)/i);
  });

  it('requires the explicit choice, and sends --as-class when it is made', async () => {
    const swap = vi.spyOn(api, 'swap').mockResolvedValue(undefined);
    const s = fleetSession({ wrapper: 'claude', home: 'claude', modelClass: 'fable' });
    render(<SwapSheet session={s} open onClose={vi.fn()} fleet={storeWith([s], CLASSED)} />);
    fireEvent.click(await screen.findByRole('button', { name: /gpt/ }));
    // Spec §7: "Without the flag the swap refuses with the same sentence" — so
    // the confirm has to state the substitution, not merely the move.
    expect(screen.getByText(/run as Opus-class/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Move' }));
    expect(swap).toHaveBeenCalledWith(s.id, 'gpt', 'opus');
  });

  it('an ordinary swap still sends no class at all', async () => {
    const swap = vi.spyOn(api, 'swap').mockResolvedValue(undefined);
    const s = fleetSession({ wrapper: 'claude', home: 'claude', modelClass: 'sonnet' });
    render(<SwapSheet session={s} open onClose={vi.fn()} fleet={storeWith([s], CLASSED)} />);
    fireEvent.click(await screen.findByRole('button', { name: /gpt/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Move' }));
    expect(swap).toHaveBeenCalledWith(s.id, 'gpt', undefined);
  });

  it('says nothing about classes when ccd recorded none, or recorded a word this build cannot read', () => {
    // `null` is "nobody measured", and inventing a downgrade sentence for it
    // would tell an operator their Fable session is about to become an Opus one
    // when nothing knows it is a Fable session. A word from a LATER ccd that
    // this build's class list does not contain gets the same silence — the
    // alternative is a sentence built from `CLASS_TITLE[undefined]`.
    for (const modelClass of [null, 'ultra']) {
      const s = fleetSession({ wrapper: 'claude', home: 'claude', modelClass });
      const { unmount } = render(<SwapSheet session={s} open onClose={vi.fn()} fleet={storeWith([s], CLASSED)} />);
      expect(screen.queryByText(/-class model on gpt/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/undefined/i)).not.toBeInTheDocument();
      unmount();
    }
  });

  it('says nothing for a lane with NO registry — its four classes are the client\'s own', () => {
    // `models` absent (the fixture's default) means no registry file: an
    // Anthropic lane, where all four classes exist by construction, or one
    // nobody has seeded. Neither can be claimed to lack a class.
    const s = fleetSession({ wrapper: 'gpt', home: null, modelClass: 'fable' });
    render(<SwapSheet session={s} open onClose={vi.fn()} fleet={storeWith([s], TEST_ROSTER)} />);
    expect(screen.queryByText(/-class model on/i)).not.toBeInTheDocument();
  });

  it('offers no substitute at all when the lane has no available class to fall back to', () => {
    const empty = CLASSED.map((a) => a.id !== 'gpt' ? a : {
      ...a,
      models: { ...a.models!, classes: { haiku: null, sonnet: null, opus: null, fable: null }, available: [] },
    });
    const s = fleetSession({ wrapper: 'claude', home: 'claude', modelClass: 'fable' });
    render(<SwapSheet session={s} open onClose={vi.fn()} fleet={storeWith([s], empty)} />);
    const row = screen.getByRole('button', { name: /gpt/ });
    expect(row.textContent).toMatch(/no classified model on gpt/i);
    expect(row.textContent).not.toMatch(/run as/i);
  });
});
```

`storeWith` already takes a roster as its second argument. Add `import { api } from '../src/lib/api';` if the file does not already have it, and add `modelClass` to `fleetSession`'s accepted overrides if wave 4's fixture builds a total `FleetSession` literal (the field is optional, so a fixture that spreads its overrides needs no change).

- [ ] **Step 2: Run it and watch it fail**

Run from `pwa/`: `npx vitest run test/swap-sheet.test.tsx`
Expected: FAIL — `expected '…team·max…' to match /no Fable-class model on gpt/i`, and `expected "swap" to have been called with [ …, 'gpt', 'opus' ]`.

- [ ] **Step 3: Add the two pure functions**

`pwa/src/fleet/SwapSheet.tsx`, at module scope:

```tsx
/**
 * What a swap to `wrapper` would do to this session's class, or `null` when
 * there is nothing to say: no class was recorded (or one this build cannot
 * read), the destination has NO REGISTRY (an Anthropic lane, where all four
 * classes exist by construction, or one nobody has seeded), or the class is
 * available there.
 *
 * THE SUBSTITUTE IS THE STRONGEST AVAILABLE CLASS, because that is what "run as
 * X instead" should mean and because ccd will refuse anything else: `cmd_swap`
 * validates `--as-class` against the destination's own available classes.
 * `sub: null` is a real fourth answer — a lane with NO classified model cannot
 * take this session under any class, and naming a substitute there would name
 * one that does not exist.
 */
export function downgradeFor(
  roster: readonly RosterWire[], wrapper: string, cls: string | null,
): { cls: ModelClass; sub: ModelClass | null; subLabel: string | null } | null {
  if (!isModelClass(cls)) return null;
  const models = accountModelsOf(roster, wrapper);
  if (models === null) return null;
  if (models.available.includes(cls)) return null;
  const sub = CLASS_ORDER.find((c) => models.available.includes(c)) ?? null;
  const subId = sub === null ? null : models.classes[sub];
  return { cls, sub, subLabel: subId === null ? null : (models.labels[subId] ?? subId) };
}

/** The sentence, built ONCE and read in two places — the target row and the
 *  confirm — because they are one claim about one lane and two spellings would
 *  let a reader be told different things before and after the tap. */
export function downgradeSentence(
  d: NonNullable<ReturnType<typeof downgradeFor>>, lane: string,
): string {
  return d.sub === null || d.subLabel === null
    ? `no classified model on ${lane} — this session cannot run there yet`
    : `no ${CLASS_TITLE[d.cls]}-class model on ${lane} — run as ${CLASS_TITLE[d.sub]}-class (${d.subLabel})?`;
}
```

with `accountModelsOf` added to the `../lib/accounts` import, `import { CLASS_ORDER, CLASS_TITLE } from '../lib/models';` (imported, never respelled — one reading order in three files is the drift `single-definition.test.ts` exists for), and `import { isModelClass, type ModelClass } from '../../../shared/models';`.

- [ ] **Step 4: Render it on the target rows and in the confirm**

`AccountRow` gains one optional prop (`note?: string`) and renders it beside the gauges:

```tsx
      {note !== undefined && <span className="acct-unknown">{note}</span>}
```

The sheet's `session` prop type gains the field it now reads (keep every field wave 4 put there):

```tsx
  session: Pick<FleetSession, 'id' | 'wrapper' | 'project'>
    & { home: string | null }
    & Partial<Pick<FleetSession, 'held' | 'modelClass'>>;
```

The move helper takes the class:

```tsx
  const move = (wrapper: string, asClass?: string): void => {
    void (async () => {
      try {
        await api.swap(session.id, wrapper, asClass);
        toast(`Moving ${session.project} to ${accountLabel(roster, wrapper)}…`);
      } catch (err) {
        toast(`Couldn't move — ${apiErrorText(err)}`, 'error');
      }
    })();
    onClose();
  };

  // `?? null` for the same reason `held` is read through one test: an ABSENT
  // `modelClass` (a synthetic row, or a server built before the field) is
  // "nobody measured", which `downgradeFor` answers `null` for — no sentence,
  // no substitute, no claim.
  const down = target === null ? null : downgradeFor(roster, target, session.modelClass ?? null);
```

The target rows:

```tsx
          {wrappers.map((w) => {
            const d = downgradeFor(roster, w, session.modelClass ?? null);
            return (
              <AccountRow
                key={w}
                wrapper={w}
                limits={limitsFor(sessions, w)}
                suggested={w === suggested}
                onPick={setTarget}
                roster={roster}
                note={d === null ? undefined : downgradeSentence(d, accountLabel(roster, w))}
              />
            );
          })}
```

and the confirm — the downgrade clause goes FIRST, before the existing temporariness paragraph, because it is the fact that changes what the session IS while the rest is about where it lives. **Insert exactly one clause and change nothing else in that string.** The three-way `held` ternary below is the shape as of `origin/main` before wave 4 (`pwa/src/fleet/SwapSheet.tsx:338-351`); if wave 4 reworded it, keep WAVE 4's wording verbatim and insert the same one clause in the same position:

```tsx
        consequence={`The session restarts under ${targetLabel}. Anyone attached is briefly `
          + 'disconnected. '
          // The downgrade clause. It goes here rather than after the
          // temporariness one: "you will come back to claude" is about WHERE
          // this session lives, and "it will run as Opus-class" is about WHAT
          // it is — a reader deciding whether to tap needs the second fact
          // before the first.
          + (down === null ? '' : `${downgradeSentence(down, targetLabel)} `)
          + (held === undefined
            ? `This is normally temporary — ccrc moves it back to ${backTo} once ${whenRoom} `
              + 'has room — but a program hold defers that, and whether one stands was not '
              + 'measured from here.'
            : held !== null
              ? `This session is held — ${held} — and ccrc does not move a held session back on `
                + `its own: it stays under ${targetLabel} until the hold is released.`
              : `This is temporary — ccrc moves it back to ${backTo} once ${whenRoom} has room.`)}
        confirmLabel="Move"
        onConfirm={() => {
          if (target !== null) move(target, down?.sub ?? undefined);
        }}
```

- [ ] **Step 5: Run the sheet tests**

Run from `pwa/`: `npx vitest run test/swap-sheet.test.tsx test/api.test.ts test/session-actions-sheet.test.tsx`
Expected: PASS.

Run from `pwa/`: `npx vitest run test/contrast.test.ts test/tap-targets.test.tsx`
Expected: PASS — this task adds no CSS rule; `.acct-unknown` is an existing one.

- [ ] **Step 6: Measured mutation #1 — the flag is omitted when there is no downgrade**

Edit `pwa/src/fleet/SwapSheet.tsx` and change `move(target, down?.sub ?? undefined)` to `move(target, 'opus')`.
Run from `pwa/`: `npx vitest run test/swap-sheet.test.tsx -t "an ordinary swap"`
Expected: FAIL — `expected "swap" to have been called with [ …, 'gpt', undefined ] but got [ …, 'gpt', 'opus' ]`: every swap would silently pin a class ccd was never asked for.
Restore. Re-run: PASS.

- [ ] **Step 7: Measured mutation #2 — an unreadable class word says nothing**

Edit `pwa/src/fleet/SwapSheet.tsx` and change `downgradeFor`'s first line to `if (cls === null) return null;`, casting `cls as ModelClass` below.
Run from `pwa/`: `npx vitest run test/swap-sheet.test.tsx -t "recorded a word this build cannot read"`
Expected: FAIL — the `'ultra'` iteration renders `no undefined-class model on gpt`, so `expect(screen.queryByText(/undefined/i)).not.toBeInTheDocument()` fails.
Restore. Re-run: PASS.

- [ ] **Step 8: Measured mutation #3 — a lane with no registry makes no claim**

Edit `pwa/src/fleet/SwapSheet.tsx` and change `if (models === null) return null;` to `if (models === null) return { cls, sub: null, subLabel: null };`.
Run from `pwa/`: `npx vitest run test/swap-sheet.test.tsx -t "no registry"`
Expected: FAIL — the sheet says `no classified model on gpt` about a lane whose four classes are Claude Code's own defaults.
Restore. Re-run: PASS.

- [ ] **Step 9: Typecheck, run everything, commit**

Run from `<repo>`: `npx tsc -p server --noEmit && npx tsc -p pwa --noEmit && npx tsc -p agent --noEmit` — no output.
Run from `pwa/`: `npx vitest run` — PASS. Run from `server/`: `npx vitest run` — PASS.

```bash
git add pwa/src/fleet/SwapSheet.tsx pwa/test/swap-sheet.test.tsx
git commit -m "feat(swap): a lane that cannot run this session's class says so, and the downgrade is the operator's explicit choice

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## What this plan does NOT do

- **The ccd half of `--as-class`** — `cmd_swap`'s flag parse and its validation against `_lane_classes`, the registry `class` field's writer `_session_class`, `_reg_read_class`, `_spawn_start`'s `--model <class>`, and the class predicate in `_swap_target`'s composed chain: **Plan 2**, gated on account-pools PR #62.
- **Everything else on the surfaces** — the wire's `AccountModels`, `server/src/models.ts`, the three model routes, the agent's `ccrc` grant, the Models section, the session picker and the doctor check: **Plan 3a**.
- **`NewSessionSheet.tsx`, `pwa/src/stores/fleet.ts`, `pwa/src/lib/pools.ts`** — account-pools wave 4's, and untouched here beyond the rebase.
- **Auto-swap downgrades.** Spec §15.2: rotation SKIPS a lane whose available classes do not include the session's. This plan adds no path by which a downgrade happens without a human confirming it.
