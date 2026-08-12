# Stage 2a — The Account Roster Becomes Data — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the account roster out of the compile-time `ACCOUNTS` literal in `shared/api.ts` into a runtime `~/.ccrc/accounts.json` with free-form account ids, with ccd's case statements, the two install scripts' home arrays, and the PWA's labels and colours all generated from it or served from it.

**Architecture:** `shared/roster.ts` holds pure types plus `parseRoster` (it may not import `node:*`, so callers read the file). `shared/generate.mjs` is a dependency-free ESM generator so `deploy/gen-accounts.mjs` can run it locally with no build step, and so the emitter has exactly one definition shared by deploy, the migration and the tests. The server loads the roster in `loadConfig` and hands it down on `CcrcConfig`; the PWA receives it over `GET /api/accounts`; ccd sources the generated `~/.ccrc/accounts.sh`, whose `case` arms are emitted in descending id length so the arm-order invariant belongs to the generator rather than to a maintainer's care.

**Tech Stack:** TypeScript (Node `>=22.13.0`, ESM), vitest, bash 5, Fastify, React + Vite, systemd --user.

## Global Constraints

- Node engine floor `>=22.13.0`, pinned in `agent/package.json:5`, `pwa/package.json:6`, `server/package.json:5`. No root `package.json` — four workspaces.
- **`shared/*.ts` imports nothing, not even `node:*`** — the PWA bundles those files, and that is the rule's actual reason. `shared/*.mjs` (`generate.mjs`, `mark.mjs`) is deploy-side tooling that the PWA never imports; it may use `node:*`, and `mark.mjs` uses `node:crypto`. File IO stays in `server/` and in `deploy/gen-accounts.mjs`. A reviewer seeing `node:crypto` under `shared/` should check which of the two rules applies before flagging it.
- Account id: `^[a-z][a-z0-9-]{0,31}$`, unique. **Load-bearing:** ccd's `_default_pool` (ccd:6558) joins ids with `"${VALID_WRAPPERS[*]}"` and `_swap_target` (ccd:6709) consumes them through an unquoted `for cand in $(_pool_for "$id")`. Whitespace in an id would word-split silently.
- `configDirSuffix` begins with `.`, contains no `/` and no `..`.
- Exactly one account has `exec.kind === 'upstream'`.
- Unknown *fields* warn; an unknown `version` fails.
- Invalid roster → refuse to boot, in the server and in ccd, naming the account and the remedy. Never a silently-empty roster.
- Generated files carry `# ccrc:generated 1 sha256=<hash of body below>` as line 2.
- A writer writes, skips, or refuses. It never deletes.
- `~/.local/bin/claude` is the 304,282,632-byte Claude Code binary. Never generate, overwrite or back it up.
- `~/.ccrc/accounts.sh` lands **before** `ccd` on a fleet host.
- New colours in `tokens.css` carry a contrast ratio **measured** against their tint in both themes.
- `loadConfig` must stay **synchronous** — `server/src/index.ts:21` calls it at module top level with no await. Use `readFileSync`.
- Run all three suites (`server`, `agent`, `pwa`) before any push. `server/test/typecheck-tests.test.ts` is the gate that catches missed call sites; `npm run build` does **not** typecheck `test/`.
- Commit after every task.

## File Structure

**Create**
- `shared/roster.ts` — `AccountDef`, `Hue`, `Roster`, `RosterError`, `parseRoster`, `assignHues`.
- `shared/generate.mjs` + `shared/generate.d.mts` — `generateAccountsSh(roster)`. Dependency-free ESM so deploy can run it with bare `node`.
- `shared/mark.mjs` + `shared/mark.d.mts` — `markGenerated`, `verifyMarker`. (The path classifier and the install manifest move to 2b with the installer that calls them — see Task 4.)
- `deploy/gen-accounts.mjs` — CLI: accounts.json → accounts.sh on stdout.
- `deploy/accounts.default.json` — shipped single-`claude` default.
- `deploy/accounts.migration.json` — today's five accounts, verbatim.
- `ccd/ccrc-adopt` — reads the box, writes accounts.json, nothing else.
- Tests: `server/test/roster.test.ts`, `roster-generate.test.ts`, `ownership.test.ts`, `adopt.test.ts`.

**Modify** `shared/api.ts`, `server/src/{config,limits,fleet,server}.ts`, `pwa/src/lib/{accounts,api}.ts`, `pwa/src/screens/{SessionScreen,AccountsScreen}.tsx`, `pwa/src/fleet/SwapSheet.tsx`, `pwa/src/styles/{tokens,base}.css`, `pwa/src/session/chat.css`, `pwa/design/{contrast-check.mjs,DIRECTION.md,mockup.html}`, `ccd/{ccd,install-session-hooks.sh,install-coordinator-skill.sh,statusline-command.sh}`, `deploy/deploy.sh`, `server/test/{ccdWsHelpers,helpers,config,limits,fleet,single-definition,accounts-route,install-session-hooks,install-coordinator-skill,wrapper-roster-fixture}.ts`, `agent/test/deploy-verify.test.ts`, `README.md`.

---

### Task 1: Correct the stale roster prose

The roster's docstrings contradict the roster after `claude-dev0`'s promotion. These comments are what a maintainer reads before touching arm order, so they are corrected first, as their own reviewable commit, before any structural edit. No behaviour changes.

**Files:**
- Modify: `shared/api.ts:1203-1205, 1224-1226, 1253-1256, 1260-1263, 1319-1321, 1341, 1346, 1353-1355`
- Modify: `server/src/fleet.ts:71-80`
- Modify: `server/src/server.ts:235`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing. Prose only.

- [ ] **Step 1: Verify each claimed contradiction before editing**

```bash
cd /home/you/worktrees/ccrc-pwa/calm-mesa
grep -n "ccdValid\|homeAble" shared/api.ts | sed -n '1,40p'
# Expect: line 1323 shows claude-dev0 with ccdValid: true, homeAble: true
grep -n "is not ccd-valid\|Three today\|is false\|The three accounts" shared/api.ts
grep -n "ccdValid\` is \`false\`" server/src/fleet.ts
```

- [ ] **Step 2: Fix `shared/api.ts`**

Replace each stale sentence. The six edits, by line:
- `1203-1205`: `homeAble`/`ccdValid`/`hooksAble` are no longer "three genuinely different subsets" — only `homeAble` still narrows (4 of 5). Say so.
- `1224-1226`: delete the "not ccd-valid, so ccd cannot mint an id under that prefix" clause; ccd mints `claude-dev0-*` ids for real.
- `1253-1256`: "Three today, not four or five" → **four** today: `claude`, `claude2`, `claude-corp`, `claude-dev0`; only `gpt` is excluded.
- `1260-1263`: delete "`claude-dev0` is false"; all five are ccd-valid, and the fixture test asserts exactly that.
- `1319-1321`: `colorVar: '--ink-tertiary'` is no longer "the fallback for a wrapper it didn't recognise" — dev0 is recognised and simply has no hue assigned yet.
- `1341`/`1346`/`1353-1355`: "The three accounts" → four; and `claude-dev0` is no longer "a wrapper NOT in this list".

- [ ] **Step 3: Fix `server/src/fleet.ts:71-80`**

The docstring states `ACCOUNTS['claude-dev0'].ccdValid` is `false` and that the fixture test pins ccd rejecting it. Both are false. Rewrite to state that dev0 is home-able and ccd-valid, so ccd mints `claude-dev0-*` ids, which is exactly why longest-prefix-wins is load-bearing rather than prophylactic.

- [ ] **Step 4: Fix `server/src/server.ts:235`**

```ts
  // Account usage read straight from telemetry (cc-limits), independent of which
  // sessions are running or where they've swapped — so it survives restarts,
  // respawns, and swaps. Ordered by ACCOUNT_ORDER (the roster's declaration order).
```

- [ ] **Step 5: Run the suites — nothing should change**

Run: `cd server && ./node_modules/.bin/vitest run`
Expected: PASS, same count as before the task.

- [ ] **Step 6: Commit**

```bash
git add shared/api.ts server/src/fleet.ts server/src/server.ts
git commit -m "docs(shared,server): the roster's prose catches up with the roster

claude-dev0's promotion to a first-class account left six docstrings asserting
the opposite of the data — that it is not ccd-valid, that ccdValid is false,
that HOME_ABLE_WRAPPERS is three accounts. fleet.ts repeated the ccdValid claim
and cited a fixture test that now asserts the reverse. These comments are what
a maintainer reads before touching _id_wrapper's arm order, so they are
corrected before the roster moves rather than carried into the new file."
```

---

### Task 2: `shared/roster.ts` — types, parsing, validation

Pure, no consumers yet. Nothing else in the tree changes, so this task cannot break anything.

**Files:**
- Create: `shared/roster.ts`
- Test: `server/test/roster.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type Hue = 'cyan' | 'violet' | 'blue' | 'magenta' | 'amber' | 'green'`
  - `interface AccountDef { id: string; label: string; configDirSuffix: string; exec: ExecSpec; homeAble: boolean; hue: Hue; telemetry: 'anthropic' | 'none' }`
  - `type ExecSpec = { kind: 'upstream' } | { kind: 'generated'; secretsFile?: string } | { kind: 'external' }`
  - `interface Roster { version: 1; accounts: readonly AccountDef[]; byId: ReadonlyMap<string, AccountDef>; byIdLengthDesc: readonly AccountDef[]; homeAble: readonly AccountDef[]; upstreamId: string }`
  - `class RosterError extends Error { readonly remedy: string }`
  - `function parseRoster(json: unknown): Roster`

`byIdLengthDesc` is precomputed at parse time on purpose: `fleet.ts`'s `idHomeWrapper` runs once per registry row inside `assembleFleet`'s `recs.map`, so re-sorting per call would be O(rows × accounts log accounts) per tick. It also solves the module-load problem — today's `BY_ID_PREFIX_LENGTH_DESC` is a module-level const, which cannot exist once the roster is runtime data.

- [ ] **Step 1: Write the failing tests**

```ts
// server/test/roster.test.ts
import { describe, it, expect } from 'vitest';
import { parseRoster, RosterError } from '../../shared/roster.js';

const one = (over: Record<string, unknown> = {}) => ({
  version: 1,
  accounts: [{
    id: 'claude', label: 'claude', configDirSuffix: '.claude',
    exec: { kind: 'upstream' }, homeAble: true, hue: 'cyan', telemetry: 'anthropic',
    ...over,
  }],
});

describe('parseRoster', () => {
  it('parses the shipped single-account default', () => {
    const r = parseRoster(one());
    expect(r.accounts.map((a) => a.id)).toEqual(['claude']);
    expect(r.upstreamId).toBe('claude');
    expect(r.homeAble.map((a) => a.id)).toEqual(['claude']);
    expect(r.byId.get('claude')!.configDirSuffix).toBe('.claude');
  });

  it('orders byIdLengthDesc longest-first so a prefix id never wins over a longer one', () => {
    const r = parseRoster({ version: 1, accounts: [
      { id: 'a', label: 'a', configDirSuffix: '.a', exec: { kind: 'upstream' }, homeAble: true, hue: 'cyan', telemetry: 'anthropic' },
      { id: 'a-b-c', label: 'abc', configDirSuffix: '.abc', exec: { kind: 'generated' }, homeAble: true, hue: 'violet', telemetry: 'anthropic' },
      { id: 'a-b', label: 'ab', configDirSuffix: '.ab', exec: { kind: 'generated' }, homeAble: true, hue: 'blue', telemetry: 'anthropic' },
    ] });
    expect(r.byIdLengthDesc.map((a) => a.id)).toEqual(['a-b-c', 'a-b', 'a']);
    // declaration order is preserved separately — the accounts strip depends on it
    expect(r.accounts.map((a) => a.id)).toEqual(['a', 'a-b-c', 'a-b']);
  });

  it('assigns hues by position when absent, and never leaves one unset', () => {
    const r = parseRoster({ version: 1, accounts: [
      { id: 'x', label: 'x', configDirSuffix: '.x', exec: { kind: 'upstream' }, homeAble: true, telemetry: 'anthropic' },
      { id: 'y', label: 'y', configDirSuffix: '.y', exec: { kind: 'generated' }, homeAble: true, telemetry: 'anthropic' },
    ] });
    expect(r.accounts.map((a) => a.hue)).toEqual(['cyan', 'violet']);
  });

  it.each([
    ['unknown version', { version: 2, accounts: [] }, /version/i],
    ['no upstream', { version: 1, accounts: [{ ...one().accounts[0], exec: { kind: 'generated' } }] }, /upstream/i],
    ['two upstreams', { version: 1, accounts: [one().accounts[0], { ...one().accounts[0], id: 'other', configDirSuffix: '.other' }] }, /upstream/i],
    ['duplicate id', { version: 1, accounts: [one().accounts[0], { ...one().accounts[0], exec: { kind: 'generated' } }] }, /duplicate/i],
    ['bad id charset', one({ id: 'Claude' }), /id/i],
    ['id with whitespace', one({ id: 'my claude' }), /id/i],
    ['suffix without dot', one({ configDirSuffix: 'claude' }), /configDirSuffix/i],
    ['suffix with slash', one({ configDirSuffix: '.a/b' }), /configDirSuffix/i],
    ['suffix with dotdot', one({ configDirSuffix: '../x' }), /configDirSuffix/i],
    ['empty roster', { version: 1, accounts: [] }, /at least one/i],
  ])('refuses %s', (_name, bad, pattern) => {
    expect(() => parseRoster(bad)).toThrow(RosterError);
    try { parseRoster(bad); } catch (e) { expect((e as RosterError).message).toMatch(pattern); expect((e as RosterError).remedy).toBeTruthy(); }
  });

  it('warns but does not fail on an unknown field', () => {
    const r = parseRoster({ version: 1, accounts: [{ ...one().accounts[0], futureThing: 42 }] });
    expect(r.accounts).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd server && ./node_modules/.bin/vitest run test/roster.test.ts`
Expected: FAIL — cannot resolve `../../shared/roster.js`.

- [ ] **Step 3: Implement `shared/roster.ts`**

Key requirements the tests pin: `accounts` keeps declaration order; `byIdLengthDesc` sorts by `id.length` descending with `id` as a secondary key so equal-length ids get a deterministic order (today's comparator has no tie-break and two 12-character prefixes exist); `RosterError` always carries a non-empty `remedy`; hue auto-assignment walks `HUES` in order, skipping hues already claimed explicitly, and cycles once exhausted.

```ts
export const HUES = ['cyan', 'violet', 'blue', 'magenta', 'amber', 'green'] as const;
export type Hue = (typeof HUES)[number];

export class RosterError extends Error {
  constructor(message: string, readonly remedy: string) { super(message); this.name = 'RosterError'; }
}

const ID_RE = /^[a-z][a-z0-9-]{0,31}$/;
```

- [ ] **Step 4: Run to verify they pass**

Run: `cd server && ./node_modules/.bin/vitest run test/roster.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add shared/roster.ts server/test/roster.test.ts
git commit -m "feat(shared): a parsed, validated account roster with no consumers yet"
```

---

### Task 3: `shared/generate.mjs` — the accounts.sh emitter

Plain ESM with no imports so `deploy/gen-accounts.mjs` can run it with bare `node`, no build and no `tsx`. One definition, shared by deploy, the migration, and the round-trip test.

**Files:**
- Create: `shared/generate.mjs`, `shared/generate.d.mts`
- Test: `server/test/roster-generate.test.ts`

**Interfaces:**
- Consumes: `Roster` from Task 2 (structurally — `generate.mjs` takes a plain object with `accounts`, `homeAble`, `byIdLengthDesc`).
- Produces: `generateAccountsSh(roster: Roster): string` — the file **body**, without the provenance marker. Task 4 adds the marker.

- [ ] **Step 1: Write the failing test**

```ts
// server/test/roster-generate.test.ts
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { parseRoster } from '../../shared/roster.js';
import { generateAccountsSh } from '../../shared/generate.mjs';
import { mkTmp } from './helpers.js';

const roster = parseRoster({ version: 1, accounts: [
  { id: 'a', label: 'A', configDirSuffix: '.a', exec: { kind: 'upstream' }, homeAble: true, hue: 'cyan', telemetry: 'anthropic' },
  { id: 'a-b-c', label: 'ABC', configDirSuffix: '.abc', exec: { kind: 'generated' }, homeAble: true, hue: 'violet', telemetry: 'anthropic' },
  { id: 'a-b', label: 'AB', configDirSuffix: '.ab', exec: { kind: 'external' }, homeAble: false, hue: 'blue', telemetry: 'none' },
] });

/** Source the generated file in a real bash and evaluate one snippet. */
function sh(home: string, snippet: string): string {
  return execFileSync('bash', ['-c', `source "$HOME/.ccrc/accounts.sh"; ${snippet}`],
    { cwd: home, env: { ...process.env, HOME: home }, encoding: 'utf8' }).trim();
}

describe('generateAccountsSh', () => {
  const home = mkTmp('roster-gen-');
  mkdirSync(path.join(home, '.ccrc'), { recursive: true });
  writeFileSync(path.join(home, '.ccrc', 'accounts.sh'), generateAccountsSh(roster));

  it('exposes ids in declaration order and home-able as a subset', () => {
    expect(sh(home, 'echo "${CCRC_ACCOUNTS[@]}"')).toBe('a a-b-c a-b');
    expect(sh(home, 'echo "${CCRC_HOME_ABLE[@]}"')).toBe('a a-b-c');
  });

  it('resolves every config dir against the LIVE $HOME, not a baked path', () => {
    for (const acc of roster.accounts) {
      expect(sh(home, `_ccrc_cfg_dir '${acc.id}'`)).toBe(path.join(home, acc.configDirSuffix));
    }
    // the generated text must not contain the generating machine's home
    expect(generateAccountsSh(roster)).not.toContain(home);
  });

  it('answers empty at exit 0 for an unknown id — five ccd call sites depend on that silence', () => {
    expect(sh(home, "_ccrc_cfg_dir 'nope' ; echo \"rc=$?\"")).toBe('rc=0');
  });

  it('resolves a session id to its account, longest prefix first', () => {
    expect(sh(home, "_ccrc_id_wrapper 'a-b-c-quiet-basin'")).toBe('a-b-c');
    expect(sh(home, "_ccrc_id_wrapper 'a-b-quiet-basin'")).toBe('a-b');
    expect(sh(home, "_ccrc_id_wrapper 'a-quiet-basin'")).toBe('a');
  });

  it('falls back to the upstream id for an id matching nothing', () => {
    expect(sh(home, "_ccrc_id_wrapper 'zzz-quiet-basin'")).toBe('a');
  });

  it('emits _ccrc_id_wrapper arms in descending id length', () => {
    const body = generateAccountsSh(roster);
    const arms = [...body.matchAll(/^\s{4}([a-z0-9-]+)-\*\)/gm)].map((m) => m[1]!);
    expect(arms).toEqual(['a-b-c', 'a-b', 'a']);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/roster-generate.test.ts`
Expected: FAIL — cannot resolve `shared/generate.mjs`.

- [ ] **Step 3: Implement the generator**

The emitted body, for the fixture above:

```bash
#!/usr/bin/env bash
# Generated from ~/.ccrc/accounts.json. Do not edit — `ccrc install` rewrites it.
CCRC_ACCOUNTS=(a a-b-c a-b)
CCRC_HOME_ABLE=(a a-b-c)
CCRC_UPSTREAM=a
_ccrc_cfg_dir() {
  case "$1" in
    a-b-c) echo "$HOME/.abc" ;;
    a-b) echo "$HOME/.ab" ;;
    a) echo "$HOME/.a" ;;
  esac
}
_ccrc_id_wrapper() {
  case "$1" in
    a-b-c-*) echo a-b-c ;;
    a-b-*) echo a-b ;;
    a-*) echo a ;;
    *) echo "$CCRC_UPSTREAM" ;;
  esac
}
```

`$HOME` stays **unexpanded** inside the case bodies — both installer test suites relocate `HOME` to a tmpdir, so a generator that baked the generating machine's home would pass locally and write to the wrong directory everywhere else. `_ccrc_cfg_dir` has no default arm, matching today's `_cfg_dir` contract: empty output at exit 0, which five of its six ccd call sites depend on.

- [ ] **Step 4: Run to verify it passes**

Run: `cd server && ./node_modules/.bin/vitest run test/roster-generate.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Write `shared/generate.d.mts`**

```ts
import type { Roster } from './roster.js';
export function generateAccountsSh(roster: Roster): string;
```

- [ ] **Step 6: Commit**

```bash
git add shared/generate.mjs shared/generate.d.mts server/test/roster-generate.test.ts
git commit -m "feat(shared): generate ccd's bash roster projection, arms sorted by descending id length

The ordering hazard stops being a comment asking maintainers not to reorder and
becomes a property of the emitter. Today's arms are not actually
length-descending — claude-corp- and claude-dev0- tie at 12, and claude2-
precedes claude- by hand-authoring luck — so the test asserts behaviour through
a real bash subshell rather than comparing generated text to today's."
```

---

### Task 4: `shared/mark.mjs` — the provenance marker

**Scope deviation from the spec, deliberate.** Spec §5–§6 put the whole ownership mechanism — marker, classifier, manifest — in 2a. Only the marker has a consumer here: 2a's single writer is `deploy.sh`, which is bash, so a TypeScript `classify()` and manifest writer would be code with no caller until 2b's installer exists. They move to 2b, landing with the thing that uses them. The marker ships now because `gen-accounts.mjs` genuinely needs it.

It lives in `shared/mark.mjs`, not `server/src/`, for the same reason the generator does: `deploy/gen-accounts.mjs` must run it with bare `node`, no build. `node:crypto` is allowed here — the "imports nothing" rule binds `shared/*.ts`, which the PWA bundles; these two `.mjs` files are deploy-side tooling that the server and tests also import.

**Files:**
- Create: `shared/mark.mjs`, `shared/mark.d.mts`
- Test: `server/test/ownership.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `function markGenerated(body: string): string` — inserts `# ccrc:generated 1 sha256=<hex of the body>` as line 2, after the shebang if present.
  - `function verifyMarker(text: string): 'ccrc-unmodified' | 'ccrc-edited' | 'foreign'` — used by the test now, by 2b's installer later.

- [ ] **Step 1: Write the failing test**

```ts
// server/test/ownership.test.ts
import { describe, it, expect } from 'vitest';
import { markGenerated, verifyMarker } from '../../shared/mark.mjs';

describe('provenance marker', () => {
  const body = '#!/usr/bin/env bash\necho hi\n';

  it('keeps the shebang first — the file must stay executable', () => {
    const text = markGenerated(body);
    expect(text.split('\n')[0]).toBe('#!/usr/bin/env bash');
    expect(text.split('\n')[1]).toMatch(/^# ccrc:generated 1 sha256=[0-9a-f]{64}$/);
  });

  it('round-trips its own output as unmodified', () => {
    expect(verifyMarker(markGenerated(body))).toBe('ccrc-unmodified');
  });

  it('detects a hand edit', () => {
    expect(verifyMarker(markGenerated(body) + 'echo tampered\n')).toBe('ccrc-edited');
  });

  it('calls an unmarked file foreign', () => {
    expect(verifyMarker(body)).toBe('foreign');
  });

  it('marks a body with no shebang on line 1', () => {
    expect(markGenerated('CCRC_ACCOUNTS=(a)\n').split('\n')[0])
      .toMatch(/^# ccrc:generated 1 sha256=/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/ownership.test.ts`
Expected: FAIL — cannot resolve `../../shared/mark.mjs`.

- [ ] **Step 3: Implement**

Hash the body **excluding** the marker line, so `verifyMarker` can recompute and compare. Both functions must agree on exactly which bytes are hashed — the body with the marker line removed, shebang retained.

- [ ] **Step 4: Run to verify it passes**

Run: `cd server && ./node_modules/.bin/vitest run test/ownership.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add shared/mark.mjs shared/mark.d.mts server/test/ownership.test.ts
git commit -m "feat(shared): provenance markers so a writer can tell its own output from a hand edit

Only the marker lands in 2a — its consumer is deploy/gen-accounts.mjs. The
classifier over real paths and the install manifest move to 2b, where the
installer that calls them exists; building them here would be code with no
caller."
```

---

### Task 5: `loadConfig` reads the roster

The blocking task for everything server-side. `cfg.wrappers` is deleted rather than migrated: it is **read by nothing** in `shared/`, `server/src`, `pwa/src` or `agent/src` — only `config.test.ts` asserts on it.

**Files:**
- Modify: `server/src/config.ts:1-4, 8-44, 46-60, 62-100`
- Modify: `server/test/helpers.ts:32-39`
- Modify: `server/test/config.test.ts:7-17, 19-44, 107-121`
- Modify: `server/test/dialog.test.ts:380, 526`

**Interfaces:**
- Consumes: `parseRoster`, `Roster`, `RosterError` (Task 2).
- Produces:
  - `CcrcConfig` gains `roster: Roster` and `accountsPath: string`; loses `wrappers`.
  - `function configDirFor(cfg: CcrcConfig, wrapper: string): string | undefined`
  - `server/test/helpers.ts` gains `seedRoster(home: string, roster?: unknown): void`, which writes `<home>/.ccrc/accounts.json`. **Every** test that calls `loadConfig({ CCRC_HOME: home })` must seed first — there are 127 such calls across 16 files.

- [ ] **Step 1: Write the failing tests**

```ts
// server/test/config.test.ts — replacing the two roster-set tests at 19-44
it('loads the roster from ~/.ccrc/accounts.json', () => {
  const home = mkTmp('cfg-');
  seedRoster(home);
  const cfg = loadConfig({ CCRC_HOME: home });
  expect(cfg.roster.accounts.map((a) => a.id)).toEqual(['claude']);
  expect(configDirFor(cfg, 'claude')).toBe(path.join(home, '.claude'));
});

it('answers undefined for a wrapper the roster does not have', () => {
  const home = mkTmp('cfg-');
  seedRoster(home);
  expect(configDirFor(loadConfig({ CCRC_HOME: home }), 'ghost-wrapper')).toBeUndefined();
});

it('refuses to boot on a malformed roster, naming the remedy', () => {
  const home = mkTmp('cfg-');
  mkdirSync(path.join(home, '.ccrc'), { recursive: true });
  writeFileSync(path.join(home, '.ccrc', 'accounts.json'), '{"version":1,"accounts":[]}');
  expect(() => loadConfig({ CCRC_HOME: home })).toThrow(RosterError);
});

it('refuses to boot when accounts.json is absent, rather than running an empty roster', () => {
  const home = mkTmp('cfg-');
  expect(() => loadConfig({ CCRC_HOME: home })).toThrow(/accounts\.json/);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd server && ./node_modules/.bin/vitest run test/config.test.ts`
Expected: FAIL — `seedRoster` is not exported; `cfg.roster` undefined.

- [ ] **Step 3: Add `seedRoster` to `server/test/helpers.ts`**

```ts
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const DEFAULT_TEST_ROSTER = {
  version: 1,
  accounts: [
    { id: 'claude', label: 'claude', configDirSuffix: '.claude', exec: { kind: 'upstream' }, homeAble: true, hue: 'cyan', telemetry: 'anthropic' },
  ],
};

/** Every loadConfig({ CCRC_HOME: home }) needs this first — loadConfig refuses
 *  to boot without a roster, by design. */
export function seedRoster(home: string, roster: unknown = DEFAULT_TEST_ROSTER): void {
  mkdirSync(path.join(home, '.ccrc'), { recursive: true });
  writeFileSync(path.join(home, '.ccrc', 'accounts.json'), JSON.stringify(roster, null, 2));
}
```

Then make `testDeps(home)` (helpers.ts:32-39) call `seedRoster(home)` before `loadConfig`, which covers every test routed through it in one edit.

- [ ] **Step 4: Rewrite `config.ts`**

`loadConfig` gains one statement before its return literal (it has exactly one today, `const home = ...`):

```ts
export function loadConfig(env: NodeJS.ProcessEnv = process.env): CcrcConfig {
  const home = env.CCRC_HOME ?? os.homedir();
  const accountsPath = env.CCRC_ACCOUNTS ?? path.join(home, '.ccrc', 'accounts.json');
  const roster = loadRoster(accountsPath);
  return { /* … , roster, accountsPath, and NO wrappers field … */ };
}
```

`loadRoster` uses `readFileSync` — `server/src/index.ts:21` calls `loadConfig()` at module top level with no await, so this must not become async. A missing file throws with the remedy `run \`ccrc install\` (or ship deploy/accounts.default.json to ~/.ccrc/accounts.json)`.

Delete the `wrappers` field (18-24) and its derivation (74-84). **Preserve** the load-bearing prose at 46-57 (why `configDirFor` answers `undefined`) and adapt 74-81's `claude-dev0` outage note into `configDirFor`'s docstring — it is the reason this function exists.

- [ ] **Step 5: Seed the roster in every direct `loadConfig` caller**

16 files call `loadConfig` directly against a bare `mkTmp` dir: `dialog`, `registry`, `clip`, `commands`, `config`, `hold-gate`, `fleet-health`, `fleet`, `fleetws`, `lifecycle`, `limits`, `projected-home`, `sessionws`, `routes`, `helpers`, `accounts-route`. Add `seedRoster(home)` immediately after each `mkTmp`.

Run: `cd server && ./node_modules/.bin/vitest run 2>&1 | tail -30`
Expected: iterate until green. `typecheck-tests.test.ts` is what catches a missed `configDirFor` call site.

- [ ] **Step 6: Repoint the nine `configDirFor` call sites**

`fleet.ts:114`, `fleet.ts:189`, `server.ts:691`, `dialog.test.ts:380`, `dialog.test.ts:526`, and the rest — all mechanical, `cfg.home` → `cfg`, with `cfg` already in scope at every one.

- [ ] **Step 7: Run all three suites and commit**

```bash
cd server && ./node_modules/.bin/vitest run && cd ../agent && ./node_modules/.bin/vitest run && cd ../pwa && ./node_modules/.bin/vitest run
git add -A server shared
git commit -m "feat(server): loadConfig reads ~/.ccrc/accounts.json and refuses to boot without it

cfg.wrappers is deleted rather than migrated — it was read by nothing in
shared/, server/src, pwa/src or agent/src; only its own test asserted on it.
That also dissolves the ordering trap where configDirFor was called from
inside loadConfig's own return literal."
```

---

### Task 6: Widen `Wrapper`, rewire the server, fix the placement magnet

The one task where the compiler stops helping. The break set is enumerable: `Wrapper` appears 34 times but in **type position** in only three non-test files.

**Files:**
- Modify: `shared/api.ts:1234, 1236-1279, 1298-1365`
- Modify: `server/src/limits.ts:4, 25-33, 35-73`
- Modify: `server/src/fleet.ts:13, 53-58, 85-88, 216`
- Modify: `server/src/server.ts:37-41, 233-252`
- Test: `server/test/{limits,projected-home,fleet,accounts-route}.test.ts`

**Interfaces:**
- Consumes: `Roster` (Task 2), `cfg.roster` (Task 5).
- Produces:
  - `type Wrapper = string` (documented alias; the 35-line docstring survives)
  - `interface AccountsResponse { accounts: AccountUsage[]; projected: ProjectedHome | null; roster: RosterWire[] }`
  - `interface RosterWire { id: string; label: string; hue: Hue; homeAble: boolean }`
  - `function idHomeWrapper(roster: Roster, id: string): string`
  - `function projectHome(roster: Roster, limits: Record<string, AccountLimits>): ProjectedHome | null`

- [ ] **Step 1: Write the failing tests for the placement fix**

```ts
// server/test/projected-home.test.ts
const r = parseRoster({ version: 1, accounts: [
  { id: 'a', label: 'A', configDirSuffix: '.a', exec: { kind: 'upstream' }, homeAble: true, hue: 'cyan', telemetry: 'anthropic' },
  { id: 'b', label: 'B', configDirSuffix: '.b', exec: { kind: 'generated' }, homeAble: true, hue: 'violet', telemetry: 'anthropic' },
  { id: 'g', label: 'G', configDirSuffix: '.g', exec: { kind: 'external' }, homeAble: true, hue: 'blue', telemetry: 'none' },
] });
const L = (five: number | null, seven: number | null) => ({ five, seven, ts: 1, fiveResetAt: null, sevenResetAt: null, fiveRolledOver: false, sevenRolledOver: false, disabled: false });

it('an unmeasured account never beats a measured one', () => {
  // today this returns { wrapper: 'b', score: 0 } — b has no row at all
  expect(projectHome(r, { a: L(5, 5) })).toEqual({ wrapper: 'a', score: 5 });
});

it('a telemetry:none account is never scored', () => {
  expect(projectHome(r, { a: L(90, 90), b: L(80, 80), g: L(null, 0) })).toEqual({ wrapper: 'b', score: 80 });
});

it('a five:null account is unmeasured, not zero — gpt\'s real on-disk shape', () => {
  expect(projectHome(r, { a: L(5, 5), b: L(null, 0) })).toEqual({ wrapper: 'a', score: 5 });
});

it('falls back to the first home-able account when NOTHING is measured — a fresh install must still place work', () => {
  expect(projectHome(r, {})).toEqual({ wrapper: 'a', score: 0 });
});

it('still returns null when every home-able lane is disabled', () => {
  expect(projectHome(r, { a: { ...L(1, 1), disabled: true }, b: { ...L(1, 1), disabled: true }, g: { ...L(1, 1), disabled: true } })).toBeNull();
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd server && ./node_modules/.bin/vitest run test/projected-home.test.ts`
Expected: FAIL — `projectHome` takes one argument; the unmeasured cases return the wrong account.

- [ ] **Step 3: Implement the scoring change**

```ts
const measured = (l: AccountLimits | undefined): number | null =>
  !l || l.five === null || l.seven === null ? null : Math.max(l.five, l.seven);

export function projectHome(roster: Roster, limits: Record<string, AccountLimits>): ProjectedHome | null {
  const live = roster.homeAble.filter((a) => limits[a.id]?.disabled !== true);
  if (live.length === 0) return null;
  const scorable = live.filter((a) => a.telemetry !== 'none');
  const scored = scorable
    .map((a) => ({ wrapper: a.id, score: measured(limits[a.id]) }))
    .filter((s): s is { wrapper: string; score: number } => s.score !== null);
  // Unknown must not mean unplaceable: on a fresh install nothing has reported
  // yet, and returning null there would tell the user no account can take a
  // workspace — the exact first-run path this stage exists to make work.
  if (scored.length === 0) return { wrapper: (scorable[0] ?? live[0]!).id, score: 0 };
  return scored.reduce((best, cand) => (cand.score < best.score ? cand : best));
}
```

The `<` (not `<=`) tie-break is preserved: `ccd-workspaces.test.ts:231` and `projected-home.test.ts:105` both depend on the earliest home-able account winning a tie.

- [ ] **Step 4: Widen the type and rewire the three server modules**

- `shared/api.ts:1234` → `export type Wrapper = string;`, docstring rewritten to explain that the roster is now runtime data and this alias survives for readability at call sites.
- Delete `ACCOUNTS` (1298-1325), `ALL_WRAPPERS` (1331). Replace `HOME_ABLE_WRAPPERS`/`ACCOUNT_ORDER`/`KNOWN_WRAPPERS` with roster functions. Replace `isWrapper` — once `Wrapper === string` its `v is Wrapper` predicate narrows nothing, so keeping the signature would read as a guard the compiler no longer enforces. It becomes `inRoster(roster: Roster, v: unknown): boolean`, and its two consumers move onto it: `configDirFor` (`config.ts:59`) and `isKnownWrapper` (`limits.ts:33`), the latter losing its module-scope const form since it can no longer be built at import time. `limits.ts:141` is its only call site.

  Keep `isKnownWrapper`'s docstring point: it is what stops `autocompact-disabled` — a fleet-wide kill switch that is not an account — from becoming a phantom row on `GET /api/accounts`. `accounts-route.test.ts` pins that.
- `fleet.ts`: delete the module-level `BY_ID_PREFIX_LENGTH_DESC` (it evaluates at import time, before any roster exists) and use `roster.byIdLengthDesc`; `idHomeWrapper` falls back to `roster.upstreamId`; call site at `:216`.
- `server.ts:238`: rebuild `rank()` from `deps.cfg.roster` inside the handler, preserving the `i < 0 ? 99` unknown-wrapper fallback — it is load-bearing, and `accounts-route.test.ts` pins that an unknown wrapper sorts last rather than disappearing.
- `server.ts:251`: add `roster: deps.cfg.roster.accounts.map((a) => ({ id: a.id, label: a.label, hue: a.hue, homeAble: a.homeAble }))`.

- [ ] **Step 5: Name the wire type once**

`{ accounts, projected }` is restated by hand in three places today (`server.ts:251`, `pwa/src/lib/api.ts:191`, `accounts-route.test.ts:28,33`). Export `AccountsResponse` from `shared/api.ts` and use it in all three, so the fourth field cannot be added to one and missed in another.

- [ ] **Step 6: Add the fleet prefix-collision test**

```ts
it('resolves the longer id when one account id is a prefix of another', () => {
  const r = parseRoster({ version: 1, accounts: [
    { id: 'claude', label: 'c', configDirSuffix: '.claude', exec: { kind: 'upstream' }, homeAble: true, hue: 'cyan', telemetry: 'anthropic' },
    { id: 'claude-dev0', label: 'd', configDirSuffix: '.claude-dev0', exec: { kind: 'generated' }, homeAble: true, hue: 'violet', telemetry: 'anthropic' },
  ] });
  expect(idHomeWrapper(r, 'claude-dev0-quiet-basin')).toBe('claude-dev0');
  expect(idHomeWrapper(r, 'claude-quiet-basin')).toBe('claude');
  // the fallback branch — no test covers it today
  expect(idHomeWrapper(r, 'zzz-quiet-basin')).toBe('claude');
});
```

- [ ] **Step 7: Run all three suites and commit**

```bash
cd server && ./node_modules/.bin/vitest run && cd ../agent && ./node_modules/.bin/vitest run && cd ../pwa && ./node_modules/.bin/vitest run
git add -A shared server
git commit -m "feat(shared,server): the roster becomes runtime data, and placement stops treating unmeasured as free

projectHome scored an account with no telemetry row as 0 and therefore picked
it over every measured account — confirmed against the current tree, where
{claude:5, claude2:6, claude-corp:7} projects onto claude-dev0 at score 0.
Latent only because dev0 reports honestly and gpt is held out by homeAble.
Unknown now ranks below measured, with a first-home-able fallback so a fresh
install with no telemetry anywhere still has somewhere to put work."
```

---

### Task 7: The PWA reads the roster; account hues become colour names

**Files:**
- Modify: `pwa/src/lib/accounts.ts`, `pwa/src/lib/api.ts:190-191`
- Modify: `pwa/src/screens/SessionScreen.tsx:120-121`, `pwa/src/screens/AccountsScreen.tsx:56`, `pwa/src/fleet/SwapSheet.tsx:123-127`
- Modify: `pwa/src/styles/tokens.css:85-95, 123-137, 329-336, 367-374`, `pwa/src/styles/base.css:48-58`, `pwa/src/session/chat.css:1072-1074`
- Modify: `pwa/design/contrast-check.mjs:49-52, 149-159`, `pwa/design/DIRECTION.md:65-75, 260-264`, `pwa/design/mockup.html`

**Interfaces:**
- Consumes: `AccountsResponse`, `RosterWire` (Task 6).
- Produces: `accountLabel(roster, wrapper)`, `accountHue(roster, wrapper)` returning `Hue | undefined`, `homeAbleLabelList(roster)`.

- [ ] **Step 1: Add the two new hues to `tokens.css` with measured contrast**

Amber and green need hue+tint pairs in **both** blocks. Measure, do not guess — every existing entry carries a computed ratio, and `pwa/design/contrast-check.mjs` enforces it.

Run: `cd pwa && node design/contrast-check.mjs`
Expected: PASS with the four new rows (amber/green × dark/light) reporting real ratios.

- [ ] **Step 2: Rename the tokens, keeping every hex and every ratio comment verbatim**

`--acct-claude` → `--acct-cyan`, `--acct-claude2` → `--acct-violet`, `--acct-corp` → `--acct-blue`, `--acct-gpt` → `--acct-magenta`, plus each `-tint`, in the dark block (123-130) and the light block (329-336).

Do **not** rename `--acct-active` / `--acct-active-tint` (136-137) — they are the alias layer components actually style against, and they are deliberately not redeclared in the light block. Update `--pr-merged` (95) to `var(--acct-violet)` and the rationale comment at 85-94 that names the old token twice.

**Ordering trap:** `contrast-check.mjs`'s `resolveColor` throws on a missing custom property and `pwa/test/contrast.test.ts` runs the gate at module load, so a rename in `tokens.css` without the matching rename in `contrast-check.mjs` fails the whole PWA file, not one test.

- [ ] **Step 3: Rewrite the `[data-acct]` selectors to key on hue names**

`tokens.css:371-374` currently keys on token *suffixes* (`claude-corp` → `--acct-corp` → `data-acct='corp'`), which works only by coincidence of naming. They become `[data-acct='cyan']`, `[data-acct='violet']`, `[data-acct='blue']`, `[data-acct='magenta']`, plus amber and green.

- [ ] **Step 4: Fix the two `--acct-` string inspections**

`SessionScreen.tsx:121` is `const acct = acctVar.startsWith('--acct-') ? acctVar.slice('--acct-'.length) : undefined;`. Since `claude-dev0`'s `colorVar` is `--ink-tertiary`, `acct` is `undefined` and dev0 renders in `claude`'s cyan. Replace with a direct `accountHue(roster, wrapper)` lookup. Do the same at `SwapSheet.tsx:126`, keeping the `--bg-raised` fallback for a wrapper not in the roster.

- [ ] **Step 5: Make `accounts.ts` a projection of runtime data**

Eight component modules import these as pure synchronous functions. Thread the roster from the `/api/accounts` poll through the existing store; keep the unknown-wrapper fallbacks (raw name, `--ink-tertiary`) so an unarrived roster degrades rather than flashing wrong values. `AccountsScreen.tsx:56`'s `rowOrder` is never empty today — decide and comment what it returns before the first poll.

- [ ] **Step 6: Run the PWA suite and commit**

```bash
cd pwa && ./node_modules/.bin/vitest run && npm run build
git add -A pwa
git commit -m "feat(pwa): account colours become hue names, and dev0 stops rendering in claude's cyan

data-acct was derived by stripping --acct- off the colour token, so an account
whose token was not an --acct-* name (claude-dev0, --ink-tertiary) fell through
to the default and painted itself cyan. The hue is now looked up, not parsed."
```

---

### Task 8: ccd sources the generated roster

**Files:**
- Modify: `ccd/ccd:14, 21, 24, 104, 1003, 1053, 6526-6534, 6558, 6658-6674, 6762`
- Modify: `ccd/install-session-hooks.sh:23-25`, `ccd/install-coordinator-skill.sh:11-19, 32-34`
- Modify: `server/test/ccdWsHelpers.ts:9, 74-91`, `server/test/ccd-limits.test.ts:25-33`, `server/test/ccd-clip.test.ts:28`

**Interfaces:**
- Consumes: `~/.ccrc/accounts.sh` (Task 3).
- Produces: `CCRC_ACCOUNTS`, `CCRC_HOME_ABLE`, `CCRC_UPSTREAM`, `_ccrc_cfg_dir`, `_ccrc_id_wrapper` in ccd's scope.

- [ ] **Step 1: Teach `makeCcdHarness` to materialise a roster first**

`ccdWsHelpers.ts:74-91` — drop the `HOME_ABLE_WRAPPERS` import (line 9), take a fixture roster, and write `<home>/.ccrc/accounts.sh` from `generateAccountsSh` **before** anything sources ccd. Fifteen test files depend on this harness. `ccd-limits.test.ts` and `ccd-clip.test.ts` predate it and build their own HOME — they need the same seeding.

Keep `cwd: home` in the `execFileSync` call (ccdWsHelpers.ts:130). Its comment records a measured incident: without it a relative path in ccd created 74 directories under `server/`.

- [ ] **Step 2: Source the roster at the top of ccd**

After `mkdir -p "$REG"` (ccd:24), before the first function that reads it:

```bash
# The roster, generated from ~/.ccrc/accounts.json by `ccrc install` (deploy.sh
# until then). Path derived from $HOME with no env override, exactly as REG and
# WRAPPER_DIR are: $HOME is the single isolation boundary the test harness sets.
# ABSENT IS FATAL, unlike ~/.ccrc/build.json which `ccd version` answers
# honestly for — a missing build stamp costs a label, a missing roster would
# mean silently running a roster that does not match the box's accounts.
CCRC_ACCOUNTS_SH="$HOME/.ccrc/accounts.sh"
[ -r "$CCRC_ACCOUNTS_SH" ] || die "no account roster at $CCRC_ACCOUNTS_SH — run \`ccrc install\`"
# shellcheck source=/dev/null
source "$CCRC_ACCOUNTS_SH" || die "account roster unreadable: $CCRC_ACCOUNTS_SH"
```

`set -uo pipefail` at ccd:4 has no `-e`, so a `source` of a syntactically broken file does not abort on its own — it surfaces later as an unbound-variable error. The explicit `|| die` is what makes it loud.

- [ ] **Step 3: Replace the surfaces**

`VALID_WRAPPERS` (14) is deleted; its readers become `CCRC_HOME_ABLE`: `_is_valid_wrapper` (104, membership over `CCRC_ACCOUNTS` — the separate hardcoded `gpt` disappears because every rostered account is valid), `_ws_least_loaded` (1003), `cmd_ws_add`'s all-excluded preflight (1053), `_default_pool` (6558). `_cfg_dir` (6526-6534) and `_id_wrapper` (6658-6674) become one-line delegates to the generated functions. Move `_id_wrapper`'s 8-line arm-order comment into the generator, rewritten as a statement about the emitter rather than a plea to the reader.

- [ ] **Step 4: Apply the same telemetry fix to `_ws_least_loaded`**

`ccd:1005` is `sc=$(_limit_score "$w"); [[ -z "$sc" ]] && sc=0` — the identical unmeasured-is-free hole. `server/test/projected-home.test.ts` asserts per fixture that `projectHome` and a real `bash -c 'source ccd; _ws_least_loaded'` agree, so this must change in the same commit or that suite goes red.

- [ ] **Step 5: Derive both installers' homes from the roster**

`install-session-hooks.sh:23-25` and `install-coordinator-skill.sh:32-34` are byte-identical blocks today:

```bash
homes=()
if [[ "${1:-}" == --homes ]]; then shift; homes=("$@")
else
  source "$HOME/.ccrc/accounts.sh" || { echo "install-session-hooks: no account roster — run 'ccrc install'" >&2; exit 1; }
  for _a in "${CCRC_ACCOUNTS[@]}"; do homes+=("$(_ccrc_cfg_dir "$_a")"); done
fi
```

There is no hooks-able array: both installers now target every account's config dir, and both already `continue` past a home whose directory is absent.

- [ ] **Step 6: Run the server suite and commit**

Run: `cd server && ./node_modules/.bin/vitest run`
Expected: PASS. `wrapper-roster-fixture.test.ts` will still be red — Task 9 replaces it.

```bash
git add ccd server/test
git commit -m "feat(ccd): the roster arrives from ~/.ccrc/accounts.sh instead of four hand-kept copies"
```

---

### Task 9: Replace the cross-language mirror with a bash round-trip

**Files:**
- Rewrite: `server/test/wrapper-roster-fixture.test.ts`

**Interfaces:**
- Consumes: `generateAccountsSh` (Task 3), `idHomeWrapper` (Task 6), `makeCcdHarness` (Task 8).
- Produces: nothing.

- [ ] **Step 1: Delete the 60-line header and the obsolete describes**

Its central claim — that this increment does *not* change ccd's bash to read the roster at runtime — is exactly what Task 8 did. Delete `parseDefaultHomes`/`wantHooksAbleHomes` (200-206) and both installer describes (208-224): their regex `/else homes=\(([^)]*)\); fi/` hard-fails the moment the block changes shape. Delete the `ccdValid` describe (91-120) and the `ccdValid ⊆ hooksAble` invariant (271-280) — both fields are gone.

**Keep** the `install-coordinator-skill.sh REQUIRED_REFS` describe (240-253) unchanged; it reads no roster field.

- [ ] **Step 2: Write the round-trip against two rosters**

```ts
it.each([['migration', MIGRATION_ROSTER], ['adversarial', PREFIX_COLLISION_ROSTER]])(
  '%s roster: bash and TypeScript agree on every id and every session id', (_n, spec) => {
    const roster = parseRoster(spec);
    const home = mkTmp('roundtrip-');
    mkdirSync(path.join(home, '.ccrc'), { recursive: true });
    writeFileSync(path.join(home, '.ccrc', 'accounts.sh'), generateAccountsSh(roster));
    // ONE bash process for the whole matrix — the old file spawned 13 for 14 tests
    const probes = roster.accounts.flatMap((a) => [`_ccrc_cfg_dir '${a.id}'`, `_ccrc_id_wrapper '${a.id}-quiet-basin'`]);
    const out = execFileSync('bash', ['-c', `source "$HOME/.ccrc/accounts.sh"; ${probes.join('; ')}`],
      { cwd: home, env: { ...process.env, HOME: home }, encoding: 'utf8' }).trim().split('\n');
    roster.accounts.forEach((a, i) => {
      expect(out[i * 2], `_ccrc_cfg_dir ${a.id}`).toBe(path.join(home, a.configDirSuffix));
      expect(out[i * 2 + 1], `_ccrc_id_wrapper ${a.id}-…`).toBe(idHomeWrapper(roster, `${a.id}-quiet-basin`));
    });
  });
```

`PREFIX_COLLISION_ROSTER` uses ids `a`, `a-b`, `a-b-c`. This asserts **behaviour**, never the literal arm order — today's arms are not length-descending, so a golden-file comparison would fail against a correct generator.

- [ ] **Step 3: Run and commit**

```bash
cd server && ./node_modules/.bin/vitest run test/wrapper-roster-fixture.test.ts
git add server/test/wrapper-roster-fixture.test.ts
git commit -m "test(server): the roster mirror stops comparing two hand-written lists and executes the bash"
```

---

### Task 10: Deploy ships the roster, before ccd

**Files:**
- Create: `deploy/gen-accounts.mjs`, `deploy/accounts.default.json`, `deploy/accounts.migration.json`
- Modify: `deploy/deploy.sh:171-182, 315-318`, `ccd/ccd:2`
- Modify: `agent/test/deploy-verify.test.ts:289-306`, and one new `it()` after the stamp test

**Interfaces:**
- Consumes: `generateAccountsSh` (Task 3), `markGenerated` (Task 4).
- Produces: `~/.ccrc/accounts.sh` on the box, before ccd.

- [ ] **Step 1: Write the failing ordering test**

Copy the shape of the existing `stamp_build` ordering assertion verbatim. **Note the measured trap:** `deploySh.indexOf('stamp_build', agentBranchStart)` resolves to a *comment* mentioning the helper, not the call — anchor on the `install_atomic` invocations themselves.

```ts
it('~/.ccrc/accounts.sh lands BEFORE ccd — every ccd invocation in the gap would die', () => {
  const shIdx = agentBranch.indexOf('install_atomic "$ACCOUNTS_SH" .ccrc/accounts.sh 644');
  const ccdIdx = agentBranch.indexOf('install_atomic ccd/ccd .local/bin/ccd 755');
  expect(shIdx, 'deploy.sh never installs ~/.ccrc/accounts.sh').toBeGreaterThan(-1);
  expect(ccdIdx).toBeGreaterThan(-1);
  expect(shIdx, 'accounts.sh must be installed before ccd').toBeLessThan(ccdIdx);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd agent && ./node_modules/.bin/vitest run test/deploy-verify.test.ts`
Expected: FAIL — "deploy.sh never installs ~/.ccrc/accounts.sh".

- [ ] **Step 3: Add the generation step to deploy.sh**

Mirror `stamp_build`: build a local temp file, `install_atomic` it, remove it. Placed between the rsync (ends 173) and `install_atomic ccd/ccd` (182).

```bash
write_accounts_sh() {
  local src="${CCRC_ACCOUNTS_JSON:-deploy/accounts.migration.json}"
  [ -f "$src" ] || die "no roster at $src — copy deploy/accounts.default.json and edit it"
  ACCOUNTS_SH="$(mktemp)"
  node deploy/gen-accounts.mjs "$src" > "$ACCOUNTS_SH" || die "roster generation failed: $src"
  "${SSH[@]}" "$BOX" 'mkdir -p ~/.ccrc'
  install_atomic "$ACCOUNTS_SH" .ccrc/accounts.sh 644
  rm -f "$ACCOUNTS_SH"
}
```

`install_atomic` does not create its destination directory, and the only unconditional `mkdir -p ~/.ccrc` on the agent path is inside `stamp_build`, which runs *after* ccd — hence the explicit `mkdir` here.

**Do not add a third rsync.** `deploy-verify.test.ts:539` permits exactly two of that shape, and the reachability test parses `~/ccrc/<dir>/` paths out of each branch's remote commands.

- [ ] **Step 4: Ship `accounts.json` to both boxes as user-owned config**

It is user-owned per spec §5, so it goes through `ship_env`-style create-if-missing, never `install_atomic` overwrite, and lands on the server box too — in remote mode the server serves labels and hues for the fleet host's accounts from its own copy.

- [ ] **Step 5: Add the marker to the committed ccd, and the server-side guard**

`ccd/ccd` gains `# ccrc:generated 1 sha256=…` as line 2 (after the shebang). Add an `accounts.json` guard on the server branch modelled on the existing `ccrc.env` guard at 315-318.

- [ ] **Step 6: Extend the atomic-install test**

`deploy-verify.test.ts:289-306` — add `.ccrc/accounts.sh` to the banned-direct-scp `dest` list and to the `install_atomic` roster.

- [ ] **Step 7: Run agent + server suites and commit**

```bash
cd agent && ./node_modules/.bin/vitest run && cd ../server && ./node_modules/.bin/vitest run
git add deploy ccd/ccd agent/test/deploy-verify.test.ts
git commit -m "feat(deploy): the roster lands before ccd, or every ccd call in the gap dies"
```

---

### Task 11: `ccrc adopt`

Last, so it runs against a codebase that already works. It writes `accounts.json` and nothing else.

**Files:**
- Create: `ccd/ccrc-adopt`, `server/test/adopt.test.ts`

**Interfaces:**
- Consumes: `parseRoster` (Task 2) for validation of its own output.
- Produces: `~/.ccrc/accounts.json`.

- [ ] **Step 1: Write the failing test against a synthetic box**

Build a fixture `HOME` containing: a non-script `~/.local/bin/claude` (write a few binary bytes — the real one is a 304 MB ELF), three generated-shape wrappers, one bespoke script that sets `CLAUDE_CONFIG_DIR` but does not match the generated shape, and the matching `~/.claude*` directories.

```ts
it('classifies the binary as upstream, the shaped scripts as generated, and the bespoke one as external', () => {
  const roster = parseRoster(JSON.parse(runAdopt(home)));
  expect(roster.upstreamId).toBe('claude');
  expect(roster.byId.get('claude2')!.exec).toEqual({ kind: 'generated', secretsFile: '.cc-secrets/claude2-oauth.env' });
  expect(roster.byId.get('gpt')!.exec.kind).toBe('external');
});

it('writes id-as-label, since it cannot invent a friendly name', () => {
  const roster = parseRoster(JSON.parse(runAdopt(home)));
  expect(roster.byId.get('claude2')!.label).toBe('claude2');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/adopt.test.ts`
Expected: FAIL — `ccd/ccrc-adopt` does not exist.

- [ ] **Step 3: Implement**

Classification must require a **full shape match** for `generated`, never a substring: anything ambiguous is `external`, which is the safe direction, because ccrc then never writes it. Cross-check discovered ids against `~/.claude*` directories, `~/.cc-limits/*.json` and the session registry.

- [ ] **Step 4: Run to verify it passes, then run it against the real box**

```bash
cd server && ./node_modules/.bin/vitest run test/adopt.test.ts
bash ccd/ccrc-adopt > /tmp/adopted.json && cat /tmp/adopted.json
```

Expected: five accounts — `claude` upstream, `claude2`/`claude-corp`/`claude-dev0` generated (two with secrets files), `gpt` external.

- [ ] **Step 5: Commit**

```bash
git add ccd/ccrc-adopt server/test/adopt.test.ts
git commit -m "feat(ccd): ccrc adopt rediscovers a hand-built box's accounts from disk"
```

---

## Proof gates

Run in order once all tasks are green:

1. `cd server && ./node_modules/.bin/vitest run` — includes the generator round-trip with the `a`/`a-b`/`a-b-c` fixture.
2. A malformed `accounts.json` refuses to boot in the server **and** in ccd, each naming its remedy.
3. `deploy/accounts.migration.json` reproduces today's five accounts verbatim — labels byte-exact including U+00B7 — and all three suites pass.
4. `bash ccd/ccrc-adopt` on openclaw independently rediscovers those same five from disk alone.
5. Both boxes deploy; `/health` reports the shipped sha; `claude-dev0` still resolves; no live session loses its account.

## Notes carried out of recon

- `server/test/single-definition.test.ts` is the architectural gate and breaks early and loudly: it derives `WRAPPER_NAMES` from `Object.keys(ACCOUNTS)` (296) and asserts by **regex over source text** that `server.ts` imports the literal name `ACCOUNT_ORDER` (331-350). Expect it red from Task 5 until Task 6 lands.
- `pwa/test/contrast.test.ts`'s mutation proofs edit real files by exact anchor string and throw "the anchor moved" if the anchor is gone. Three target `chat.css` callout rules that reference account tokens by name.
- Two `deploy-verify` assertions slice on the bare substring `'else'`; `deploy.sh` contains exactly one today (line 303). A new comment containing that word breaks them.
- `deploy.sh:164-170` carries a twice-measured warning: a comment containing the coordinator skill's directory name shadows the real rsync and fails the suite. Do not spell it in any new comment.
- Out of scope, confirmed present: `server/src/config.ts:73`'s `/data/projects` default still disagrees with ccd's `$HOME/projects` — that is 2b.
