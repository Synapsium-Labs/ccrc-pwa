# GPT lane ownership — Plan 1: the `codex` roster contract — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Teach ccrc a fourth roster execution kind, `codex`, and make every surface that switches on a kind answer for it — so a box can declare a ChatGPT/Codex lane, have ccrc write its launcher, and have doctor and the account verbs be honest about it.

**Architecture:** `exec.kind: 'codex'` joins the `ExecSpec` union in `shared/roster.ts` and its bare-Node mirror `shared/roster-json.mjs`, carrying the two loopback ports and the OAuth directory a public source file may not hold. The launcher it produces is the **existing** generated-wrapper grammar with `ccgpt` as its exec target, so `_wrap_parse_shape`, the marker, the witness index and `--adopt`/`--force` keep working unchanged. Nothing runs yet: this wave makes the contract real and leaves the runtime to Plan 2.

**Tech Stack:** TypeScript (`shared/*.ts`, import-free at L0), bare-Node ESM (`shared/*.mjs` + hand-written `.d.mts`), bash 5 (`ccd/ccrc`, `ccd/ccrc-doctor-checks`), Node CLIs (`deploy/*.mjs`), vitest (`server/test`).

**Spec:** `docs/superpowers/specs/2026-09-20-gpt-lane-ownership-design.md` (committed `b300d819`). Read §4 and §5.3 before Task 1; the whole plan argues from them.

## Wave structure

This plan is **Plan 1 of 3**. Each produces working, testable software on its own:

| Plan | Deliverable |
|---|---|
| **1 — the contract (this plan)** | a roster may declare a `codex` lane; `ccrc wrappers` writes its launcher; the account verbs and doctor answer for it |
| 2 — the runtime | `ccd/ccgpt`, `ccd/ccgpt-proxy.py`, `ccd/ccgpt-usage.py`, `ccd/ccgpt-runtime`, `_svc_run_supervised`, install/release/deploy placement — a lane can start, serve and stop |
| 3 — policy, health, removal | per-lane LiteLLM rendering, the probe's `authDir`, the usage instance timer, `_check_codex`, uninstall, doc amendments, cutover runbook |

Do not start Plan 2 from this document.

## Global Constraints

Copied from the spec and this repo's `CLAUDE.md`. Every task's requirements implicitly include this section.

- **`$REPO` is this worktree's root.** Every command below assumes it: `export REPO="$(git rev-parse --show-toplevel)"`. Absolute paths are never written into tracked text here — they carry the operator's username, which `topology-clean`'s operator-residue class bans (docs speak roles: `/home/you`, `you@<server-host>`).
- **This repository is PUBLIC.** No real account id, label, email address, host, selected machine port, credential, OAuth path or operator username may appear in any tracked byte. Fixtures speak the `team·…` vocabulary; test ids are `codex-a`, `codex-b`, `claude`, `claude2`.
- **No account-name list in any shipped source file.** The roster is runtime data in `~/.ccrc/accounts.json`.
- **Never print secret file CONTENTS.** Existence and mode only, via `ls`.
- **Fixture HOMEs only in tests.** Never run `ccd`, `ccrc`, `gen-wrappers.mjs` or `deploy.sh` against the real `$HOME`. Use `mkTmp` from `server/test/tmpHelpers.ts`.
- **Never run destructive `ccd` verbs** (`ws-rm`, `ws-reap`, `ws-gc --prune`, `ws-archive`, `ws-restore`), and never touch tmux, `~/.cc-sessions`, `~/.cc-limits` or `claude-session@*.service`.
- **Run suites in the FOREGROUND with `timeout ≥ 600000` ms**, from inside the package: `cd server && ./node_modules/.bin/vitest run test/<file>.test.ts`. Never bare `npx vitest`.
- **Ports in this plan's fixtures are synthetic** — `45010`/`45011`, `45020`/`45021`. They are not defaults and must never be written into shipped source as defaults.
- **Parser before mirror.** `shared/roster.ts` lands before `shared/roster-json.mjs`. The mirror may be STRICTER than the parser, never laxer: a kind in the mirror but not the parser gives `ccd` a projection from a roster `loadConfig` refuses, and `ccrc.service` crash-loops behind a green deploy.
- **Mutation discipline.** Every guard ships with a test that goes RED when the guard is deleted or mutated, measured before and after — not asserted in a comment.
- **Commit messages end with:** `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`
- **Deviation numbers are API-allocated.** Do not invent one. If a departure from this plan is needed, `POST /api/ledger/deviations` mints a block and you define the numbers in the same act; if the allocator is unreachable, write `D-TBD-<slug>` and report it.
- **The git identity in this worktree was a placeholder.** It has been set to the repository's authoring identity; check `git config user.email` before any push.

---

### Task 1: `exec.kind: 'codex'` exists and is accepted

**Files:**
- Modify: `shared/roster.ts` (the `ExecSpec` union at :136-142; `EXEC_KINDS` at :401; the `EXEC_KEYS_*` chain at :418-430; `parseExec`'s kind refusal at :555-561 and its arms from :598)
- Test: `server/test/roster.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `ExecSpec`'s fourth arm — `{ kind: 'codex'; provider: 'openai'; proxyPort: number; litellmPort: number; authDir: string; secretsFile?: string }`. Tasks 2–4 add its field gates; Tasks 5, 8, 9 read `execKind === 'codex'`.

- [ ] **Step 1: Write the failing test**

Append inside `describe('parseRoster', …)` in `server/test/roster.test.ts`:

```ts
  // ── the fourth exec kind (2026-09-20 GPT-lane ownership design §4.1) ──
  /** A minimal valid roster: the mandatory `upstream`, plus one `codex` lane
   *  whose `exec` is `over` — so each gate below names exactly one field. */
  const withCodex = (over: Record<string, unknown> = {}) => ({
    version: 1,
    accounts: [
      {
        id: 'claude', label: 'claude', configDirSuffix: '.claude',
        exec: { kind: 'upstream' }, homeAble: true, hue: 'cyan', telemetry: 'anthropic',
      },
      {
        id: 'codex-a', label: 'team·codex', configDirSuffix: '.claude-codex-a',
        exec: {
          kind: 'codex', provider: 'openai',
          proxyPort: 45010, litellmPort: 45011,
          authDir: '.local/share/ccrc/codex/codex-a',
          ...over,
        },
        homeAble: true, hue: 'violet', telemetry: 'codex',
      },
    ],
  });

  it('accepts a codex lane and keeps every field of its exec', () => {
    const r = parseRoster(withCodex());
    const e = r.byId.get('codex-a')!.exec;
    expect(e.kind).toBe('codex');
    expect(e).toEqual({
      kind: 'codex', provider: 'openai',
      proxyPort: 45010, litellmPort: 45011,
      authDir: '.local/share/ccrc/codex/codex-a',
    });
  });

  it('a codex lane may carry a secretsFile, like every other kind', () => {
    const r = parseRoster(withCodex({ secretsFile: '.cc-secrets/codex-a.env' }));
    expect((r.byId.get('codex-a')!.exec as { secretsFile?: string }).secretsFile)
      .toBe('.cc-secrets/codex-a.env');
  });

  it('names codex in the unknown-kind refusal, so the remedy lists every legal value', () => {
    expect(() => parseRoster(withCodex({ kind: 'wrapper' })))
      .toThrow(/"upstream", "generated", "external" or "codex"/);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd "$REPO/server"
./node_modules/.bin/vitest run test/roster.test.ts -t 'codex'
```

Expected: FAIL. The first two cases throw `RosterError: account "codex-a" has an invalid exec.kind "codex"`; the third fails because the refusal text still reads `"upstream", "generated" or "external"`.

- [ ] **Step 3: Add the union arm**

In `shared/roster.ts`, extend the union at :136-142:

```ts
export type ExecSpec =
  | { kind: 'upstream'; secretsFile?: string }
  | {
    kind: 'generated'; secretsFile?: string; provider: ProviderId;
    baseUrl?: string; models?: ApiKeyModels;
  }
  | { kind: 'external'; secretsFile?: string; provider?: ProviderId; baseUrl?: string }
  /** A ChatGPT/Codex subscription lane ccrc OWNS end to end: it writes the
   *  launcher, installs the runtime, renders the LiteLLM config, publishes the
   *  usage and removes all of it. Distinct from `external` — whose contract is
   *  "ccrc records this launcher and never writes it" — and from `generated`,
   *  whose contract is one wrapper in front of an API credential.
   *
   *  The three extra fields are TOPOLOGY: two loopback ports and the directory
   *  holding the lane's OAuth. None can be derived, none may be defaulted (the
   *  fallbacks in the shim this replaces are how one lane bound another lane's
   *  ports and spent another account's subscription), and none may appear as a
   *  real value in this public tree — they live in `~/.ccrc/accounts.json`. */
  | {
    kind: 'codex'; secretsFile?: string; provider: 'openai';
    proxyPort: number; litellmPort: number; authDir: string;
  };
```

- [ ] **Step 4: Add the kind to the runtime gate and the key map**

Still in `shared/roster.ts`, at :401:

```ts
const EXEC_KINDS: ReadonlySet<string> = new Set(['upstream', 'generated', 'external', 'codex']);
```

and in the `EXEC_KEYS_*` chain at :418-430, after `EXEC_KEYS_GENERATED`:

```ts
/** NOT in the containment chain above. A codex lane takes neither `baseUrl`
 *  (its upstream is its own LiteLLM, on `litellmPort` — a second spelling is a
 *  second thing to disagree) nor `models` (the class registry owns model
 *  policy), and it takes three fields no other kind has. */
const EXEC_KEYS_CODEX: ReadonlySet<string> =
  new Set([...EXEC_KEYS_UPSTREAM, 'provider', 'proxyPort', 'litellmPort', 'authDir']);
const EXEC_KEYS: Readonly<Record<ExecSpec['kind'], ReadonlySet<string>>> = {
  upstream: EXEC_KEYS_UPSTREAM,
  external: EXEC_KEYS_EXTERNAL,
  generated: EXEC_KEYS_GENERATED,
  codex: EXEC_KEYS_CODEX,
};
```

- [ ] **Step 5: Widen the kind refusal's wording and add the arm**

In `parseExec`, update both strings of the kind refusal (they currently read `'"upstream", "generated" or "external"'` — there are two, one in the message and one in the remedy, plus a third in the missing-`exec` refusal above it) to `'"upstream", "generated", "external" or "codex"'`.

Then add the arm. It goes **immediately after** the `upstream` early return at :598, before the `provider` block, because a codex lane's `provider` rule is its own (Task 4) and must not fall into the `generated`-defaults-to-anthropic ternary:

```ts
  if (kind === 'upstream') return { kind: 'upstream', ...withSecrets };

  if (kind === 'codex') {
    // Field gates arrive in Tasks 2-4; this arm exists first so the union has a
    // constructor and every later gate has one place to refuse from.
    return {
      kind: 'codex',
      provider: 'openai',
      proxyPort: raw['proxyPort'] as number,
      litellmPort: raw['litellmPort'] as number,
      authDir: raw['authDir'] as string,
      ...withSecrets,
    };
  }
```

- [ ] **Step 6: Run the test to verify it passes**

```bash
cd "$REPO/server"
./node_modules/.bin/vitest run test/roster.test.ts
```

Expected: PASS, whole file.

- [ ] **Step 7: Prove the compile-time gate is real (control measurement)**

Delete the `codex:` line from `EXEC_KEYS` and run:

```bash
cd "$REPO/server"
./node_modules/.bin/tsc --noEmit
```

Expected: a type error naming `EXEC_KEYS` — `Property 'codex' is missing`. Restore the line and re-run: clean. Record both outcomes in the commit body; this is the mutation control the spec's §18 first row calls for.

- [ ] **Step 8: Commit**

```bash
cd "$REPO"
git add shared/roster.ts server/test/roster.test.ts
git commit -m "$(cat <<'EOF'
feat(roster): a fourth exec kind, `codex`, for a lane ccrc owns end to end

The union arm, EXEC_KINDS and EXEC_KEYS_CODEX. Field gates follow. Measured:
removing the `codex:` key from EXEC_KEYS is a tsc error, not a silent
fall-through to the wrong key set — which is what that map is keyed for.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: the port pair is required, numeric, in range, and distinct

**Files:**
- Modify: `shared/roster.ts` (`parseExec`'s `codex` arm from Task 1)
- Test: `server/test/roster.test.ts`

**Interfaces:**
- Consumes: Task 1's `codex` arm and the `withCodex` test helper.
- Produces: `proxyPort` and `litellmPort` are guaranteed integers in `1024…65535`, and guaranteed different from each other, for every parsed `codex` account. Task 3 adds `authDir`; Task 5 mirrors all of it.

- [ ] **Step 1: Write the failing test**

Append to `server/test/roster.test.ts`, beside Task 1's cases:

```ts
  // Each refusal is measured by NAME, not by "it throws": the remedy has to
  // say which of the five things went wrong, because the operator's next
  // action differs for each.
  it.each([
    ['a missing proxyPort', { proxyPort: undefined }, /missing or invalid exec\.proxyPort/],
    ['a missing litellmPort', { litellmPort: undefined }, /missing or invalid exec\.litellmPort/],
    ['a non-integer port', { proxyPort: 45010.5 }, /missing or invalid exec\.proxyPort/],
    ['a string port', { proxyPort: '45010' }, /missing or invalid exec\.proxyPort/],
    ['a privileged port', { proxyPort: 80 }, /out of range/],
    ['a port above the TCP range', { litellmPort: 70000 }, /out of range/],
  ])('refuses %s', (_why, over, re) => {
    expect(() => parseRoster(withCodex(over))).toThrow(re);
  });

  it('refuses one port used twice in the same lane — the shim and LiteLLM need two', () => {
    expect(() => parseRoster(withCodex({ litellmPort: 45010 })))
      .toThrow(/exec\.proxyPort and exec\.litellmPort are both 45010/);
  });

  it('the remedy for an out-of-range port names the range, so the fix needs no second lookup', () => {
    try {
      parseRoster(withCodex({ proxyPort: 80 }));
      throw new Error('expected a refusal');
    } catch (e) {
      expect((e as RosterError).remedy).toMatch(/1024/);
      expect((e as RosterError).remedy).toMatch(/65535/);
    }
  });
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd "$REPO/server"
./node_modules/.bin/vitest run test/roster.test.ts -t 'port'
```

Expected: FAIL — every case parses, because Task 1's arm casts the raw values without inspecting them.

- [ ] **Step 3: Write the gate**

In `shared/roster.ts`, above `parseExec`, add the helper:

```ts
/** The unprivileged TCP range. A lane's tiers are started by a user systemd
 *  manager or a plain `nohup`, neither of which can bind below 1024, so a
 *  privileged port is not a preference here — it is a lane that cannot start,
 *  and saying so at parse time is the difference between one refusal and a
 *  tier that flaps on `Restart=always`. */
const PORT_MIN = 1024;
const PORT_MAX = 65535;

function parseLanePort(raw: unknown, id: string, field: 'proxyPort' | 'litellmPort'): number {
  if (typeof raw !== 'number' || !Number.isInteger(raw)) {
    throw new RosterError(
      `account "${id}" has a missing or invalid exec.${field}: it must be a whole number.`,
      `Set exec.${field} for account "${id}" in ${ROSTER_PATH} to a free TCP port between ` +
        `${PORT_MIN} and ${PORT_MAX}. It cannot be defaulted: two lanes sharing a port send one ` +
        "account's traffic through the other account's subscription.",
    );
  }
  if (raw < PORT_MIN || raw > PORT_MAX) {
    throw new RosterError(
      `account "${id}" has an exec.${field} of ${raw}, which is out of range.`,
      `Set exec.${field} for account "${id}" in ${ROSTER_PATH} to a free TCP port between ` +
        `${PORT_MIN} and ${PORT_MAX} — below ${PORT_MIN} needs privileges this lane never has.`,
    );
  }
  return raw;
}
```

and replace the `codex` arm's two casts:

```ts
  if (kind === 'codex') {
    const proxyPort = parseLanePort(raw['proxyPort'], id, 'proxyPort');
    const litellmPort = parseLanePort(raw['litellmPort'], id, 'litellmPort');
    if (proxyPort === litellmPort) {
      throw new RosterError(
        `account "${id}"'s exec.proxyPort and exec.litellmPort are both ${proxyPort}.`,
        `Give account "${id}" two different ports in ${ROSTER_PATH}: the shim Claude Code talks ` +
          'to and the LiteLLM behind it are two listeners.',
      );
    }
    return {
      kind: 'codex',
      provider: 'openai',
      proxyPort,
      litellmPort,
      authDir: raw['authDir'] as string,
      ...withSecrets,
    };
  }
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd "$REPO/server"
./node_modules/.bin/vitest run test/roster.test.ts
```

Expected: PASS, whole file.

- [ ] **Step 5: Measure the mutation**

Change `if (proxyPort === litellmPort)` to `if (false)`. Re-run the file: the "one port used twice" case must go RED. Restore it and confirm green. Do the same for the range branch (`if (false)` on the `raw < PORT_MIN` test): the two out-of-range cases must go RED.

- [ ] **Step 6: Commit**

```bash
cd "$REPO"
git add shared/roster.ts server/test/roster.test.ts
git commit -m "$(cat <<'EOF'
feat(roster): a codex lane's port pair is required, in range and distinct

Five named refusals rather than one, because the operator's next action differs
for each. No default is offered: the shim this replaces defaulted both ports,
and a lane started without them bound another lane's pair and spent another
account's subscription.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `authDir` is a validated path, and refused under `.ccrc/`

**Files:**
- Modify: `shared/roster.ts` (`parseExec`'s `codex` arm)
- Test: `server/test/roster.test.ts`

**Interfaces:**
- Consumes: Task 2's arm.
- Produces: `authDir` is a `$HOME`-relative directory path, never absolute, never escaping, never under `.ccrc/`. Plan 3's probe and Plan 2's launcher both read it and neither re-validates.

- [ ] **Step 1: Write the failing test**

```ts
  it.each([
    ['an absent authDir', { authDir: undefined }],
    ['a non-string authDir', { authDir: 7 }],
    ['an empty authDir', { authDir: '' }],
    ['an absolute authDir', { authDir: '/etc/codex' }],
    ['an authDir escaping $HOME', { authDir: '../elsewhere/auth' }],
    ['an authDir with a trailing slash', { authDir: '.local/share/x/' }],
    ['an authDir with a shell metacharacter', { authDir: '.local/$(id)' }],
  ])('refuses %s', (_why, over) => {
    expect(() => parseRoster(withCodex(over))).toThrow(/exec\.authDir/);
  });

  // The one refusal that is not a path-safety rule. `ccrc uninstall --purge`
  // empties ~/.ccrc except `memory`; a credential ccrc never obtained must not
  // be destroyable by ccrc's own uninstall, so the roster refuses to put one
  // there rather than documenting that it would be unwise.
  it.each([
    ['.ccrc/codex/codex-a/auth'],
    ['.ccrc/auth'],
  ])('refuses an authDir under ~/.ccrc (%s) — purge empties that tree', (dir) => {
    expect(() => parseRoster(withCodex({ authDir: dir })))
      .toThrow(/under \$HOME\/\.ccrc/);
  });

  it('a directory merely NAMED like .ccrc is not refused', () => {
    // `.ccrc-backups` is a real sibling on a live box; a prefix test that
    // caught it would refuse a legal path and send the operator hunting.
    expect(() => parseRoster(withCodex({ authDir: '.ccrc-codex/auth' }))).not.toThrow();
  });
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd "$REPO/server"
./node_modules/.bin/vitest run test/roster.test.ts -t 'authDir'
```

Expected: FAIL — every case parses; `authDir` is still an unchecked cast.

- [ ] **Step 3: Write the gate**

Beside `parseLanePort` in `shared/roster.ts`:

```ts
/** `exec.authDir` — the directory holding a codex lane's OAuth. Gated exactly
 *  as `exec.secretsFile` is (same charset, same four path refusals), plus one
 *  rule of its own: it may not sit under `~/.ccrc`. `_uninst_purge` empties
 *  that tree except `memory`, and this credential is one ccrc never obtained —
 *  a refusal here makes "uninstall cannot destroy it" structural rather than
 *  documented. The test compares against `.ccrc/` WITH the separator, so a
 *  sibling like `.ccrc-backups` is untouched. */
function parseAuthDir(raw: unknown, id: string): string {
  if (typeof raw !== 'string') {
    throw new RosterError(
      `account "${id}" has a missing or non-string exec.authDir.`,
      `Set exec.authDir for account "${id}" in ${ROSTER_PATH} to the directory holding that ` +
        'lane\'s ChatGPT OAuth, as a path relative to $HOME (e.g. ' +
        `".local/share/ccrc/codex/${id}"). ccrc records the path and never reads what is in it.`,
    );
  }
  if (
    raw === '' || raw.startsWith('/') || raw.endsWith('/')
    || raw.includes('..') || !SECRETS_SAFE_RE.test(raw)
  ) {
    throw new RosterError(
      `account "${id}" has an invalid exec.authDir ${JSON.stringify(raw)}.`,
      `Set exec.authDir for account "${id}" in ${ROSTER_PATH} to a path relative to $HOME using ` +
        'only letters, digits, ".", "-", "_" and "/" — never absolute, never containing "..", ' +
        'never ending in "/".',
    );
  }
  if (raw === '.ccrc' || raw.startsWith('.ccrc/')) {
    throw new RosterError(
      `account "${id}" has an exec.authDir under $HOME/.ccrc (${JSON.stringify(raw)}).`,
      `Move account "${id}"'s OAuth directory outside $HOME/.ccrc (e.g. ` +
        `".local/share/ccrc/codex/${id}") and set exec.authDir in ${ROSTER_PATH} to the new ` +
        'path. `ccrc uninstall --purge` empties $HOME/.ccrc, and a credential ccrc never ' +
        'obtained must not be destroyable by ccrc.',
    );
  }
  return raw;
}
```

and in the `codex` arm replace `authDir: raw['authDir'] as string,` with:

```ts
      authDir: parseAuthDir(raw['authDir'], id),
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd "$REPO/server"
./node_modules/.bin/vitest run test/roster.test.ts
```

Expected: PASS, whole file.

- [ ] **Step 5: Measure the mutation**

Replace the `.ccrc` branch's condition with `if (false)`. Re-run: the two "under ~/.ccrc" cases go RED, and the `.ccrc-codex/auth` case stays GREEN (it must, or the test is measuring the wrong thing). Restore.

- [ ] **Step 6: Commit**

```bash
cd "$REPO"
git add shared/roster.ts server/test/roster.test.ts
git commit -m "$(cat <<'EOF'
feat(roster): exec.authDir is a validated path, refused under ~/.ccrc

Same charset and the same four path refusals exec.secretsFile carries, plus one
rule of its own: `_uninst_purge` empties ~/.ccrc except `memory`, so a
credential ccrc never obtained may not live where ccrc's own uninstall can
reach it. The test uses the separator, so `.ccrc-backups` and friends are not
caught by a prefix that would refuse a legal path.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `provider` is required and exactly `openai`; no two lanes share a port

**Files:**
- Modify: `shared/roster.ts` (`parseExec`'s `codex` arm; `parseRoster`'s roster-level checks beside the `seenDirs` gate at :981-993)
- Test: `server/test/roster.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces: a parsed roster in which every `codex` account's `provider` is `'openai'` and no port value appears twice across the whole roster. Plan 3's doctor treats its own port check as belt-and-braces behind this.

- [ ] **Step 1: Write the failing test**

```ts
  it('refuses a codex lane with no provider — the kind means the backend it speaks to', () => {
    expect(() => parseRoster(withCodex({ provider: undefined })))
      .toThrow(/account "codex-a" has exec\.kind "codex" and .*exec\.provider/);
  });

  it('refuses a codex lane whose provider is not openai', () => {
    expect(() => parseRoster(withCodex({ provider: 'anthropic' })))
      .toThrow(/exec\.provider "anthropic".*"codex".*"openai"/);
  });

  // Whole-roster, not per-account: the collision is between two entries, so it
  // belongs beside the duplicate-configDirSuffix gate and nowhere else.
  const twoCodex = (bExec: Record<string, unknown>) => ({
    version: 1,
    accounts: [
      {
        id: 'claude', label: 'claude', configDirSuffix: '.claude',
        exec: { kind: 'upstream' }, homeAble: true, hue: 'cyan', telemetry: 'anthropic',
      },
      {
        id: 'codex-a', label: 'team·codex', configDirSuffix: '.claude-codex-a',
        exec: {
          kind: 'codex', provider: 'openai', proxyPort: 45010, litellmPort: 45011,
          authDir: '.local/share/ccrc/codex/codex-a',
        },
        homeAble: true, hue: 'violet', telemetry: 'codex',
      },
      {
        id: 'codex-b', label: 'alt·codex', configDirSuffix: '.claude-codex-b',
        exec: {
          kind: 'codex', provider: 'openai', proxyPort: 45020, litellmPort: 45021,
          authDir: '.local/share/ccrc/codex/codex-b', ...bExec,
        },
        homeAble: true, hue: 'amber', telemetry: 'codex',
      },
    ],
  });

  it('two codex lanes with disjoint port pairs parse', () => {
    expect(parseRoster(twoCodex({})).accounts).toHaveLength(3);
  });

  it.each([
    ["b's proxy collides with a's proxy", { proxyPort: 45010 }],
    ["b's proxy collides with a's litellm", { proxyPort: 45011 }],
    ["b's litellm collides with a's proxy", { litellmPort: 45010 }],
  ])('refuses when %s', (_why, over) => {
    expect(() => parseRoster(twoCodex(over)))
      .toThrow(/accounts "codex-a" and "codex-b" both use port/);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd "$REPO/server"
./node_modules/.bin/vitest run test/roster.test.ts -t 'codex'
```

Expected: FAIL — the provider cases parse (Task 1's arm hard-codes `'openai'` without looking), and the three collision cases parse.

- [ ] **Step 3: Gate the provider**

In the `codex` arm, before constructing the return value:

```ts
    const providerRaw = raw['provider'];
    if (providerRaw !== 'openai') {
      throw new RosterError(
        providerRaw === undefined
          ? `account "${id}" has exec.kind "codex" and no exec.provider.`
          : `account "${id}" has exec.provider ${JSON.stringify(providerRaw)}, and exec.kind ` +
            '"codex" accepts only "openai".',
        `Set exec.provider for account "${id}" in ${ROSTER_PATH} to "openai". The kind names a ` +
          'ChatGPT/Codex subscription lane, so the provider is not a choice — it is the one fact ' +
          'the kind already asserts, spelled where every other kind spells it.',
      );
    }
```

- [ ] **Step 4: Gate the roster-wide port uniqueness**

In `parseRoster`, immediately after the `seenDirs` loop (which ends at :993), add:

```ts
  // THE SAME SHAPE AS `seenDirs`, and for the same reason: a collision is a
  // fact about two entries, so it cannot be seen from inside either one.
  // Both fields of every codex lane go into ONE map, because the hazard is a
  // port serving two purposes, not a field colliding with its own name — a
  // lane whose shim port is another lane's LiteLLM port is just as wrong.
  const seenPorts = new Map<number, string>();
  for (const a of drafts) {
    if (a.exec.kind !== 'codex') continue;
    for (const port of [a.exec.proxyPort, a.exec.litellmPort]) {
      const owner = seenPorts.get(port);
      if (owner !== undefined && owner !== a.id) {
        throw new RosterError(
          `accounts "${owner}" and "${a.id}" both use port ${port}.`,
          `Give each codex lane in ${ROSTER_PATH} its own two ports. Two lanes on one port send ` +
            "one account's requests through the other account's OAuth, and the box cannot tell " +
            'you which turn went where afterwards.',
        );
      }
      seenPorts.set(port, a.id);
    }
  }
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd "$REPO/server"
./node_modules/.bin/vitest run test/roster.test.ts
```

Expected: PASS, whole file.

- [ ] **Step 6: Measure the mutation**

Replace the `seenPorts` loop's `continue` with `continue; // unreachable` — no. Instead: change `if (owner !== undefined && owner !== a.id)` to `if (false)`. Re-run: the three collision cases go RED and the disjoint case stays GREEN. Restore.

- [ ] **Step 7: Run the whole shared-facing suite set and commit**

```bash
cd "$REPO/server"
./node_modules/.bin/vitest run test/roster.test.ts test/single-definition.test.ts test/topology-clean.test.ts
```

Expected: all green.

```bash
cd "$REPO"
git add shared/roster.ts server/test/roster.test.ts
git commit -m "$(cat <<'EOF'
feat(roster): codex requires provider "openai", and no two lanes share a port

The port gate sits beside the duplicate-configDirSuffix gate, for the same
reason: a collision is a fact about two entries and cannot be seen from inside
either one. Both fields go into one map — a lane whose shim port is another
lane's LiteLLM port is just as wrong as two shims on one port.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: the bare-Node mirror, its type declaration, and a derived parity test

**Files:**
- Modify: `shared/roster-json.mjs` (`EXEC_KINDS` at :213; the exec block from :281)
- Modify: `shared/roster-json.d.mts` (the `telemetry` union at :16)
- Create: `server/test/roster-exec-parity.test.ts`
- Test: `server/test/gen-accounts.test.ts` (REJECT rows), `server/test/roster-exec-parity.test.ts`

**Interfaces:**
- Consumes: Tasks 1–4's refusals, which this mirrors.
- Produces: `rosterFromJson` accepts `codex` with the same gates, so `deploy/gen-wrappers.mjs`, `deploy/account-op.mjs` and `deploy/gen-accounts.mjs` all see the kind. `RosterJsonAccount.telemetry` gains `'codex'`.

- [ ] **Step 1: Write the failing parity test**

Create `server/test/roster-exec-parity.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** `shared/roster.ts` and `shared/roster-json.mjs` each declare their own
 *  `EXEC_KINDS`, by hand, and nothing compares them. `single-definition.test.ts`
 *  scans `/\.tsx?$/` over four TypeScript roots, so the `.mjs` copy is invisible
 *  to it. The asymmetry is what makes this worth a suite of its own:
 *
 *    - a kind in the PARSER but not the mirror → `ccrc install` refuses a
 *      roster the server boots on. Loud, and recoverable.
 *    - a kind in the MIRROR but not the parser → `ccd` gets a projection from a
 *      roster `loadConfig` refuses, and `ccrc.service` crash-loops behind a
 *      green deploy. That is the outcome the mirror's own header calls the
 *      worst available one.
 *
 *  So this extracts both literals from source text and compares the SETS. It
 *  deliberately does not import either module: importing `shared/roster.ts`
 *  would give the value, not the declaration, and a value cannot show that the
 *  two files were written to agree. */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function execKindsIn(file: string): string[] {
  const src = readFileSync(path.join(root, file), 'utf8');
  const m = src.match(/EXEC_KINDS[^=]*=\s*new Set\(\[([^\]]*)\]\)/);
  if (m === null) throw new Error(`no EXEC_KINDS declaration found in ${file} — re-read it`);
  return [...m[1]!.matchAll(/'([^']+)'/g)].map((x) => x[1]!).sort();
}

describe('EXEC_KINDS parity between the parser and its bare-Node mirror', () => {
  it('finds a declaration in both files', () => {
    expect(execKindsIn('shared/roster.ts').length).toBeGreaterThanOrEqual(4);
    expect(execKindsIn('shared/roster-json.mjs').length).toBeGreaterThanOrEqual(4);
  });

  it('the two sets are identical', () => {
    expect(execKindsIn('shared/roster-json.mjs')).toEqual(execKindsIn('shared/roster.ts'));
  });

  it('both name codex', () => {
    expect(execKindsIn('shared/roster.ts')).toContain('codex');
    expect(execKindsIn('shared/roster-json.mjs')).toContain('codex');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd "$REPO/server"
./node_modules/.bin/vitest run test/roster-exec-parity.test.ts
```

Expected: FAIL — the mirror's set is `['upstream','generated','external']` and the parser's now carries `codex`.

- [ ] **Step 3: Add the REJECT rows to the existing cross-side table**

In `server/test/gen-accounts.test.ts`, add to `CASES` (the array at :367) — these drive one malformed roster through the CLI and the parser and require BOTH to refuse:

```ts
    ['a codex lane with no ports', roster(acct({ id: 'codex-a', configDirSuffix: '.claude-codex-a', telemetry: 'codex', exec: { kind: 'codex', provider: 'openai', authDir: '.local/share/ccrc/codex/codex-a' } }), acct({ id: 'up' }))],
    ['a codex lane whose two ports are equal', roster(acct({ id: 'codex-a', configDirSuffix: '.claude-codex-a', telemetry: 'codex', exec: { kind: 'codex', provider: 'openai', proxyPort: 45010, litellmPort: 45010, authDir: '.local/share/ccrc/codex/codex-a' } }), acct({ id: 'up' }))],
    ['a codex lane with an authDir under .ccrc', roster(acct({ id: 'codex-a', configDirSuffix: '.claude-codex-a', telemetry: 'codex', exec: { kind: 'codex', provider: 'openai', proxyPort: 45010, litellmPort: 45011, authDir: '.ccrc/codex/codex-a' } }), acct({ id: 'up' }))],
    ['a codex lane whose provider is not openai', roster(acct({ id: 'codex-a', configDirSuffix: '.claude-codex-a', telemetry: 'codex', exec: { kind: 'codex', provider: 'anthropic', proxyPort: 45010, litellmPort: 45011, authDir: '.local/share/ccrc/codex/codex-a' } }), acct({ id: 'up' }))],
```

- [ ] **Step 4: Run them to verify they fail**

```bash
cd "$REPO/server"
./node_modules/.bin/vitest run test/gen-accounts.test.ts -t 'codex'
```

Expected: FAIL for all four on the CLI side — the mirror refuses `kind: 'codex'` outright with the *wrong* refusal (`invalid exec.kind`) rather than the specific one, and the table requires both sides to refuse for the reason under test. (If the table only asserts "both refuse", note in the commit that these rows are weaker than the parser-side cases in Tasks 2–4 and exist to prove the two sides agree about legality, not about wording.)

- [ ] **Step 5: Mirror the kind and every gate**

In `shared/roster-json.mjs` at :213:

```js
const EXEC_KINDS = new Set(['upstream', 'generated', 'external', 'codex']);
```

Update the kind refusal's remedy in the same file to name all four. Then, in the exec block, after the `secretsFile` gates and **before** the `if (exec['kind'] !== 'upstream')` provider/baseUrl/models block, insert:

```js
  // ── codex: the ports and the OAuth directory ──────────────────────────
  // Mirrors `parseExec`'s gates one for one (`shared/roster.ts`, 2026-09-20
  // GPT-lane ownership design §4.1). It must not fall through to the
  // provider/baseUrl/models block below: `baseUrl` and `models` are not legal
  // on this kind, and its `provider` rule is stricter than that block's.
  if (exec['kind'] === 'codex') {
    if (exec['provider'] !== 'openai') {
      bad(`account "${id}" has exec.kind "codex" and exec.provider ${JSON.stringify(exec['provider'])}.`,
        `Set exec.provider for account "${id}" to "openai".`);
    }
    for (const field of ['proxyPort', 'litellmPort']) {
      const v = exec[field];
      if (typeof v !== 'number' || !Number.isInteger(v)) {
        bad(`account "${id}" has a missing or invalid exec.${field}: it must be a whole number.`,
          `Set exec.${field} for account "${id}" to a free TCP port between 1024 and 65535.`);
      }
      if (v < 1024 || v > 65535) {
        bad(`account "${id}" has an exec.${field} of ${v}, which is out of range.`,
          `Set exec.${field} for account "${id}" to a free TCP port between 1024 and 65535.`);
      }
    }
    if (exec['proxyPort'] === exec['litellmPort']) {
      bad(`account "${id}"'s exec.proxyPort and exec.litellmPort are both ${exec['proxyPort']}.`,
        `Give account "${id}" two different ports: the shim and the LiteLLM behind it are two listeners.`);
    }
    const dir = exec['authDir'];
    if (typeof dir !== 'string') {
      bad(`account "${id}" has a missing or non-string exec.authDir.`,
        `Set exec.authDir for account "${id}" to the directory holding that lane's ChatGPT OAuth, relative to $HOME.`);
    }
    if (dir === '' || dir.startsWith('/') || dir.endsWith('/') || dir.includes('..') || !SECRETS_SAFE_RE.test(dir)) {
      bad(`account "${id}" has an invalid exec.authDir ${JSON.stringify(dir)}.`,
        `Set exec.authDir for account "${id}" to a path relative to $HOME using only letters, digits, ".", "-", "_" and "/".`);
    }
    if (dir === '.ccrc' || dir.startsWith('.ccrc/')) {
      bad(`account "${id}" has an exec.authDir under $HOME/.ccrc (${JSON.stringify(dir)}).`,
        `Move account "${id}"'s OAuth directory outside $HOME/.ccrc — 'ccrc uninstall --purge' empties that tree.`);
    }
  }
```

and change the block below it from `if (exec['kind'] !== 'upstream') {` to:

```js
  if (exec['kind'] !== 'upstream' && exec['kind'] !== 'codex') {
```

- [ ] **Step 6: Add the roster-wide port gate to the mirror**

Find `rosterFromJson`'s roster-level loop (the one that refuses a duplicate `configDirSuffix`) and add beside it:

```js
  // The mirror of `parseRoster`'s `seenPorts` gate. Both fields of every codex
  // lane, one map: the hazard is a port serving two purposes.
  const seenPorts = new Map();
  for (const a of out) {
    if (a.execKind !== 'codex') continue;
    for (const port of [a.proxyPort, a.litellmPort]) {
      const owner = seenPorts.get(port);
      if (owner !== undefined && owner !== a.id) {
        bad(`accounts "${owner}" and "${a.id}" both use port ${port}.`,
          'Give each codex lane its own two ports.');
      }
      seenPorts.set(port, a.id);
    }
  }
```

If `checkAccount`'s returned shape does not carry `proxyPort`/`litellmPort`, add them to the returned object for `codex` accounts only, and to `RosterJsonAccount` in Step 7. (The mirror's header states it returns only what downstream reads; this gate and Plan 2's launcher writer are the readers that make them worth returning.)

- [ ] **Step 7: Fix the type declaration**

In `shared/roster-json.d.mts`, line 16:

```ts
  telemetry: 'anthropic' | 'codex' | 'none';
```

`'codex'` has been admitted by both implementations since the telemetry field gained it; the declaration never followed, so typed test code reading this field through the `.d.mts` narrowed wrongly. Add the two port fields and `authDir` as optional properties with a docstring saying they are present only on a `codex` account.

- [ ] **Step 8: Run everything and verify green**

```bash
cd "$REPO/server"
./node_modules/.bin/vitest run test/roster-exec-parity.test.ts test/gen-accounts.test.ts test/roster.test.ts
./node_modules/.bin/tsc --noEmit
```

Expected: all green, no type errors.

- [ ] **Step 9: Measure the mutation**

Remove `'codex'` from the mirror's `EXEC_KINDS` only. Re-run `roster-exec-parity.test.ts`: the "two sets are identical" and "both name codex" cases go RED. Restore. This is the guard that did not exist before this task.

- [ ] **Step 10: Commit**

```bash
cd "$REPO"
git add shared/roster-json.mjs shared/roster-json.d.mts server/test/roster-exec-parity.test.ts server/test/gen-accounts.test.ts
git commit -m "$(cat <<'EOF'
feat(roster): the bare-Node mirror learns codex, and a derived parity test

The two EXEC_KINDS declarations are hand-kept copies that nothing compared:
single-definition scans .ts/.tsx only, so the .mjs one was invisible. The new
suite extracts both literals from source and compares the sets, because the
asymmetry matters — a kind in the mirror but not the parser crash-loops
ccrc.service behind a green deploy.

Also fixes roster-json.d.mts's telemetry union, which has been missing 'codex'
since the field gained it: typed test code reading that field narrowed wrongly.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: the provider table stops calling OpenAI somebody else's launcher

**Files:**
- Modify: `shared/providers.ts` (the `openai` row; the `generatable` docstring at :17)
- Test: `server/test/providers.test.ts` (or whichever suite pins the table — find it with `grep -rl "ChatGPT subscription" server/test`)

**Interfaces:**
- Consumes: nothing.
- Produces: `PROVIDERS.openai.label` and `.credential` describe a ccrc-owned lane. `generatable` stays `false` (see below) — Task 8 does not read it.

- [ ] **Step 1: Find and read every pin on the row**

```bash
cd "$REPO"
grep -rn "ChatGPT subscription\|held by the launcher\|openai-login" server/test pwa/test agent/test shared deploy ccd | grep -v node_modules
```

Record the list. Any test asserting the old strings must be updated in the same commit.

- [ ] **Step 2: Write the failing test**

In the suite that pins the table:

```ts
  it('the openai row describes a lane ccrc owns, not somebody else\'s launcher', () => {
    expect(PROVIDERS.openai.label).not.toMatch(/external launcher/i);
    expect(PROVIDERS.openai.credential).not.toMatch(/never by ccrc/i);
    expect(PROVIDERS.openai.credential).toMatch(/OAuth/i);
  });
```

- [ ] **Step 3: Run it to verify it fails**

```bash
cd "$REPO/server"
./node_modules/.bin/vitest run test/providers.test.ts -t 'openai row'
```

Expected: FAIL on all three assertions.

- [ ] **Step 4: Edit the row**

```ts
  openai: {
    label: 'ChatGPT subscription (Codex lane)',
    credential: "the lane's own OAuth directory, named by exec.authDir — ccrc records the path and never reads what is in it",
    envVar: null,
    connect: ['openai-login'],
    probe: 'inference',
    baseUrl: null,
    baseUrlRequired: false,
    // FALSE, and not an oversight. `generatable` is read by `shared/roster.ts`
    // and means "this provider may be the provider of a `generated` account" —
    // a wrapper in front of an API key. A Codex lane is `exec.kind: "codex"`,
    // whose launcher ccrc writes through a different arm of the same emitter
    // (`shared/wrapper.mjs`); nothing consults this column to decide that.
    // Setting it true here would make `openai` legal on a `generated` account,
    // which is the one thing this kind exists to stop being necessary.
    generatable: false,
    apiKeyModels: false,
    catalogue: null,
  },
```

Update the `generatable` docstring at :17 — it currently says "`openai` is `declare`-only: the launcher is somebody else's program" — to say that `openai` is the provider of the `codex` kind, whose launcher ccrc writes through `wrapper.mjs`'s codex arm, and that `generatable` still gates the `generated` kind only.

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd "$REPO/server"
./node_modules/.bin/vitest run test/providers.test.ts test/roster.test.ts
```

Expected: PASS. If any other suite from Step 1 reds on the old strings, update it in this commit.

- [ ] **Step 6: Commit**

```bash
cd "$REPO"
git add shared/providers.ts server/test/providers.test.ts
git commit -m "$(cat <<'EOF'
feat(providers): openai is a Codex lane ccrc owns, not an external launcher

`generatable` deliberately stays false: it gates the `generated` kind, and a
Codex lane is its own kind with its own emitter arm. Making openai generatable
would re-enable the exact shape the new kind exists to replace.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: the two silent `'anthropic'` provider defaults name codex

**Files:**
- Modify: `deploy/account-op.mjs` (`effectiveBaseUrl`'s ternary at :1031; the `lane` op's ternary at :1994)
- Test: `server/test/ccrc-account.test.ts`

**Interfaces:**
- Consumes: Task 5's mirror (this file parses through `rosterFromJson`).
- Produces: a `codex` account is never reported as an Anthropic lane by `ccrc account` or by the doctor's settings-env drift measurement.

- [ ] **Step 1: Write the failing test**

In `server/test/ccrc-account.test.ts`, following that file's existing fixture-HOME idiom (build the HOME with `mkTmp`, write `~/.ccrc/accounts.json`, run `ccrc account lane <id>` through the harness):

```ts
  it('a codex lane is not reported as an anthropic lane', () => {
    const home = fixtureHomeWith({
      id: 'codex-a', configDirSuffix: '.claude-codex-a', telemetry: 'codex',
      exec: {
        kind: 'codex', provider: 'openai', proxyPort: 45010, litellmPort: 45011,
        authDir: '.local/share/ccrc/codex/codex-a',
      },
    });
    const out = runAccountOp(home, ['lane', '--id', 'codex-a']);
    expect(JSON.parse(out).provider).toBe('openai');
  });
```

(Use the file's own helper names; `fixtureHomeWith`/`runAccountOp` above stand for whatever it already calls them — read the top of the file and reuse them rather than adding new ones.)

- [ ] **Step 2: Run it to verify it fails**

```bash
cd "$REPO/server"
./node_modules/.bin/vitest run test/ccrc-account.test.ts -t 'codex'
```

Expected: FAIL — `provider` reads `'openai'` here only if the row declares it; add a second case with the provider absent from the raw JSON to prove the ternary, or assert the doctor-side `effectiveBaseUrl` answer is `null` rather than Anthropic's default endpoint.

- [ ] **Step 3: Edit both ternaries**

At `deploy/account-op.mjs:1031`:

```js
  // §4.1's absence-permitting rule, the same one `lane` reads: an account that
  // names no provider is anthropic, EXCEPT an external one (genuinely
  // undeclared) and a codex one (whose provider is REQUIRED by the roster, so
  // an absent one here means this file is reading a hand-edit that never went
  // through the parser — answering "anthropic" for it would be a guess
  // presented as a fact).
  const p = exec.provider ?? (exec.kind === 'external' || exec.kind === 'codex' ? null : 'anthropic');
```

At `deploy/account-op.mjs:1994`, the same change to the raw-JSON copy:

```js
    const provider = e['provider'] ?? (e['kind'] === 'external' || e['kind'] === 'codex' ? null : 'anthropic');
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd "$REPO/server"
./node_modules/.bin/vitest run test/ccrc-account.test.ts
```

Expected: PASS, whole file.

- [ ] **Step 5: Commit**

```bash
cd "$REPO"
git add deploy/account-op.mjs server/test/ccrc-account.test.ts
git commit -m "$(cat <<'EOF'
fix(account-op): a codex lane is not silently an anthropic lane

The same `?? (kind === 'external' ? null : 'anthropic')` ternary is spelled
twice in this file — once in the doctor's settings-env drift measurement and
once in the `lane` op behind every `ccrc account` verb — and nothing pins the
two copies against each other. Both now name codex.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: `generateWrapperBody` writes a Codex launcher

**Files:**
- Modify: `shared/wrapper.mjs` (`generateWrapperBody`'s kind gate and its `return`)
- Test: `server/test/wrapper-roundtrip.test.ts`

**Interfaces:**
- Consumes: `account.execKind === 'codex'` from Task 5's mirror.
- Produces: for a `codex` account, `generateWrapperBody(account, upstreamId)` returns a body whose exec target is `ccgpt` rather than `upstreamId`. Task 9 stages it; Task 12's doctor expects it.

- [ ] **Step 1: Write the failing test**

In `server/test/wrapper-roundtrip.test.ts`, add to the `ACCOUNTS` fixture and add cases:

```ts
  { id: 'codex-a', configDirSuffix: '.claude-codex-a', execKind: 'codex', secretsFile: undefined },
```

```ts
  it('a codex launcher execs the common ccgpt, not the upstream account', () => {
    const body = generateWrapperBody(
      { id: 'codex-a', configDirSuffix: '.claude-codex-a', execKind: 'codex' }, 'claude');
    expect(body).toContain('exec "$HOME/.local/bin/ccgpt" "$@"');
    expect(body).not.toContain('/claude" "$@"');
  });

  // THE POINT OF THE WHOLE DESIGN: the file is the EXISTING generated grammar
  // with one different target, so every lock, the marker, the witness index
  // and --adopt/--force keep working with no change to the reader at all.
  it('a codex launcher round-trips through the shipped _wrap_parse_shape', () => {
    const body = markGenerated(generateWrapperBody(
      { id: 'codex-a', configDirSuffix: '.claude-codex-a', execKind: 'codex' }, 'claude'));
    expect(parseShape(body)).toEqual({
      ok: 'ok', target: 'ccgpt', suffix: '.claude-codex-a', secrets: '',
    });
  });

  it('a codex lane may still source a secrets file, and that arm parses too', () => {
    const body = markGenerated(generateWrapperBody(
      { id: 'codex-a', configDirSuffix: '.claude-codex-a', execKind: 'codex',
        secretsFile: '.cc-secrets/codex-a.env' }, 'claude'));
    expect(parseShape(body)).toEqual({
      ok: 'ok', target: 'ccgpt', suffix: '.claude-codex-a', secrets: '.cc-secrets/codex-a.env',
    });
  });

  it('still refuses upstream and external, verbatim', () => {
    for (const execKind of ['upstream', 'external']) {
      expect(() => generateWrapperBody(
        { id: 'x', configDirSuffix: '.x', execKind }, 'claude'))
        .toThrow(/ccrc never writes an upstream or external account/);
    }
  });
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd "$REPO/server"
./node_modules/.bin/vitest run test/wrapper-roundtrip.test.ts -t 'codex'
```

Expected: FAIL — `generateWrapperBody` throws `has exec.kind "codex", and ccrc writes a wrapper only for "generated"`.

- [ ] **Step 3: Widen the kind gate and choose the target**

In `shared/wrapper.mjs`, replace the kind gate:

```js
  // THE TWO KINDS ccrc OWNS. `upstream` is the Claude Code binary and
  // `external` is somebody else's launcher; writing either is data loss, so
  // this function cannot be talked into producing text for them at all.
  //
  // `codex` produces the SAME grammar with a different exec target — the
  // common `ccgpt`, which reads the lane's identity back out of the
  // CLAUDE_CONFIG_DIR this file exports. That is why nothing about
  // `_wrap_parse_shape`, the marker, the witness index or --adopt/--force has
  // to change for it: `ccgpt` is an id-shaped name and the reader does not
  // judge the target.
  if (account.execKind !== 'generated' && account.execKind !== 'codex') {
    bad(`account "${id}" has exec.kind ${JSON.stringify(account.execKind)}, and ccrc writes a `
      + 'wrapper only for "generated" and "codex".',
      `Leave $HOME/.local/bin/${id} alone — ccrc never writes an upstream or external account.`);
  }
  // The common launcher's name, spelled once. It is an account-id-shaped name
  // by construction, which is what lets it be an exec target at all.
  const CODEX_LAUNCHER = 'ccgpt';
  const target = account.execKind === 'codex' ? CODEX_LAUNCHER : upstreamId;
```

Keep the `upstreamId` validity check exactly where it is — a `generated` account still needs it — but guard it so a `codex` account is not refused for a roster problem that cannot affect it:

```js
  if (account.execKind !== 'codex' && (typeof upstreamId !== 'string' || !ID_RE.test(upstreamId))) {
```

and change the return's last line from `` `exec "$HOME/.local/bin/${upstreamId}" "$@"\n` `` to:

```js
    + `exec "$HOME/.local/bin/${target}" "$@"\n`;
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd "$REPO/server"
./node_modules/.bin/vitest run test/wrapper-roundtrip.test.ts
```

Expected: PASS, whole file — including every pre-existing `generated` case, whose bytes must be unchanged.

- [ ] **Step 5: Measure the mutation**

Change `const target = …` to `const target = upstreamId;`. Re-run: the three codex cases go RED and every generated case stays GREEN. Restore.

- [ ] **Step 6: Commit**

```bash
cd "$REPO"
git add shared/wrapper.mjs server/test/wrapper-roundtrip.test.ts
git commit -m "$(cat <<'EOF'
feat(wrapper): ccrc writes a codex lane's launcher — same grammar, one target

_wrap_parse_shape accepts any id-shaped exec target ("target not judged here"),
so a codex launcher is the existing generated shape execing the common `ccgpt`.
Locks 4 and 5, the staged read-back, the marker and --adopt/--force therefore
need no change at all, and the round-trip test proves it against the SHIPPED
reader rather than against a restatement of its rules.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: the manifest carries codex — producer and reader, one change

**Files:**
- Modify: `deploy/gen-wrappers.mjs` (`TOOLCHAIN_EXECUTABLES` at :201; `generated` at :327; `protectedLines`/`summaryLine` at :424-427)
- Modify: `ccd/ccrc` (the manifest read loop at :2870-2882; the numeric check at :2888; the two count gates at :2898 and :2907)
- Test: `server/test/gen-wrappers.test.ts`, `server/test/ccrc-wrappers.test.ts`

**Interfaces:**
- Consumes: Task 8's emitter.
- Produces: the manifest grammar `summary\t<total>\t<generated>\t<upstream>\t<external>\t<codex>`, with codex accounts appearing as `wrapper` records and NOT as `protected` records.

**Why producer and reader are one task:** the summary line's field count is read by a fixed-arity bash `read`. Splitting them leaves a commit in which the producer emits six fields and the reader binds five, so the last variable receives `"<external>\t<codex>"` and the numeric gate compares against a string that is not a number. A reviewer cannot sensibly approve one without the other.

- [ ] **Step 1: Write the failing tests**

In `server/test/gen-wrappers.test.ts`:

```ts
  it('a codex account gets a wrapper record and is NOT protected', () => {
    const { rosterFile, binDir, stagingDir } = fixture(codexFixtureJson);
    const r = run([rosterFile, binDir, stagingDir]);
    expect(r.code).toBe(0);
    const lines = r.stdout.trim().split('\n');
    expect(lines.filter((l) => l.startsWith('wrapper\tcodex-a'))).toHaveLength(1);
    expect(lines.filter((l) => l.startsWith('protected\tcodex-a'))).toHaveLength(0);
  });

  it('the summary carries a fifth count, and it counts codex lanes', () => {
    const { rosterFile, binDir, stagingDir } = fixture(codexFixtureJson);
    const [summary = ''] = run([rosterFile, binDir, stagingDir]).stdout.split('\n');
    const f = summary.split('\t');
    expect(f[0]).toBe('summary');
    expect(f).toHaveLength(6);
    expect(Number(f[5])).toBe(1);
  });

  it('TOOLCHAIN_EXECUTABLES names the GPT-lane binaries, so they are never orphan wrappers', () => {
    for (const name of ['ccgpt', 'ccgpt-runtime']) {
      expect(TOOLCHAIN_EXECUTABLES).toContain(name);
    }
  });
```

Define `codexFixtureJson` beside the existing `fixtureJson`: the same upstream `claude`, the three generated ids, plus one `codex-a` with `exec: { kind: 'codex', provider: 'openai', proxyPort: 45010, litellmPort: 45011, authDir: '.local/share/ccrc/codex/codex-a' }` and `telemetry: 'codex'`.

In `server/test/ccrc-wrappers.test.ts`, add a case proving the reader accepts the six-field summary and installs the codex launcher, and a case proving a truncated manifest (a summary claiming one codex lane with no matching wrapper record) is refused with the truncation message.

- [ ] **Step 2: Run them to verify they fail**

```bash
cd "$REPO/server"
./node_modules/.bin/vitest run test/gen-wrappers.test.ts test/ccrc-wrappers.test.ts -t 'codex'
```

Expected: FAIL — the codex account lands in `protected`, the summary has five fields, and the toolchain set lacks both names.

- [ ] **Step 3: Change the producer**

In `deploy/gen-wrappers.mjs`:

```js
const TOOLCHAIN_EXECUTABLES = new Set(['ccd', 'ccrc', 'ccd-cap-scopes', 'ccd-graph-sweep', 'ccd-account-health',
  'ccd-telemetry-keepalive', 'ccd-account-auth', 'ccd-usage-sweep', 'ccd-pool-sync',
  // The GPT lane's dotless common executables (Plan 2 places them; named here
  // first because the live box already carries a hand-installed `ccgpt`, and
  // because the assertion in `gen-wrappers.test.ts` runs one way only: every
  // name `_inst_bins` places must be here, never the converse).
  'ccgpt', 'ccgpt-runtime']);
```

```js
  // Both kinds ccrc writes. `generated` and `codex` differ only in the exec
  // target `shared/wrapper.mjs` chooses; from here they are the same act.
  const generated = roster.accounts.filter((a) => a.execKind === 'generated' || a.execKind === 'codex');
```

```js
  const upstreamCount = roster.accounts.filter((a) => a.execKind === 'upstream').length;
  const externalCount = roster.accounts.filter((a) => a.execKind === 'external').length;
  const codexCount = roster.accounts.filter((a) => a.execKind === 'codex').length;
  const protectedLines = roster.accounts
    .filter((a) => a.execKind !== 'generated' && a.execKind !== 'codex')
    .map((a) => `protected\t${a.id}`);
  // FIVE counts now. `<codex>` is its own column rather than folded into
  // `<generated>`: the reader's first gate counts wrapper records against
  // generated + codex and its second counts protected records against upstream
  // + external, and two locks that share one number are one lock.
  const summaryLine = `summary\t${roster.accounts.length}\t${generated.length - codexCount}\t${upstreamCount}\t${externalCount}\t${codexCount}`;
```

- [ ] **Step 4: Change the reader**

In `ccd/ccrc`, update the comment above the read loop (it currently argues "FIVE variables, not four") to say SIX and why, then:

```bash
  local kind a b c d e
  local sum_total="" sum_gen="" sum_up="" sum_ext="" sum_codex="" saw_summary=0
  local -a w_id=() w_class=() w_equal=() protected=() orphans=()
  while IFS=$'\t' read -r kind a b c d e; do
    case "$kind" in
      '') continue ;;
      summary)   saw_summary=1; sum_total="$a"; sum_gen="$b"; sum_up="$c"; sum_ext="$d"; sum_codex="$e" ;;
```

the numeric loop:

```bash
  for f in "$sum_gen" "$sum_up" "$sum_ext" "$sum_codex"; do
```

and the first count gate:

```bash
  [ "${#w_id[@]}" -eq "$((sum_gen + sum_codex))" ] \
    || _ccrc_die "the manifest from $gen is truncated: its summary claims $sum_gen generated + $sum_codex codex account(s) and it carries ${#w_id[@]} wrapper record(s). Nothing was written."
```

Leave the `protected` gate at `$((sum_up + sum_ext))` — codex is not protected, so that number is unchanged.

Also update the `printf` at :3341 if it renders the summary counts to the operator; add the codex count there so the verb's own report matches the manifest it read.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd "$REPO/server"
./node_modules/.bin/vitest run test/gen-wrappers.test.ts test/ccrc-wrappers.test.ts test/wrapper-roundtrip.test.ts
```

Expected: PASS. **`ccd/ccd` is a generated file and `ccd/ccrc` is not** — but if the repo's re-stamp rule applies to any edited `ccd/` file in this tree, run the re-stamp before committing (`grep -n 'restamp\|_stamp' ccd/ccrc | head`) and follow what it says.

- [ ] **Step 6: Measure the mutation**

Change the first gate back to `-eq "$sum_gen"`. Re-run `ccrc-wrappers.test.ts`: the codex install case must go RED with the truncation message. Restore.

- [ ] **Step 7: Commit**

```bash
cd "$REPO"
git add deploy/gen-wrappers.mjs ccd/ccrc server/test/gen-wrappers.test.ts server/test/ccrc-wrappers.test.ts
git commit -m "$(cat <<'EOF'
feat(wrappers): the manifest carries codex — a fifth count, and no protection

A codex account is one ccrc WRITES, so it produces a wrapper record and must
not appear in the protected list. The summary gains `<codex>` as its own column
rather than folding into `<generated>`: the reader's two gates count against
different walks of the roster, and two locks sharing one number are one lock.

Producer and reader move together because the summary's arity is read by a
fixed-arity bash `read` — split, the intermediate commit binds five variables
to six fields and compares a count against "<external>\t<codex>".

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: `_acct_credential` refuses codex; `_acct_remove` decides both branches

**Files:**
- Modify: `ccd/ccrc` (`_acct_credential`'s external gate at :7087; `_acct_remove`'s launcher branch at :7347 and its secrets branch at :7371)
- Test: `server/test/ccrc-account.test.ts`

**Interfaces:**
- Consumes: Task 5's mirror (`ACCT_KIND` comes from the `lane` op).
- Produces: a codex lane's credential is never written by ccrc, and removing one removes its launcher while keeping its OAuth.

- [ ] **Step 1: Write the failing test**

```ts
  it('refuses to rotate a codex lane\'s credential — its OAuth is a browser flow\'s, not a file ccrc writes', () => {
    const home = fixtureHomeWithCodex();
    const r = runCcrc(home, ['account', 'auth-start', 'codex-a']);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toMatch(/codex lane/);
    expect(r.stderr).toMatch(/Nothing was written/);
  });

  it('removing a codex lane removes its launcher and KEEPS its OAuth directory', () => {
    const home = fixtureHomeWithCodex();
    const authDir = path.join(home, '.local/share/ccrc/codex/codex-a');
    mkdirSync(authDir, { recursive: true });
    writeFileSync(path.join(authDir, 'auth.json'), '{}');
    // A marker-stamped launcher, exactly as `ccrc wrappers` would have left it.
    writeFileSync(path.join(home, '.local/bin/codex-a'),
      markGenerated(generateWrapperBody(
        { id: 'codex-a', configDirSuffix: '.claude-codex-a', execKind: 'codex' }, 'claude')),
      { mode: 0o755 });

    const r = runCcrc(home, ['account', 'remove', 'codex-a', '--yes']);
    expect(r.code).toBe(0);
    expect(existsSync(path.join(home, '.local/bin/codex-a'))).toBe(false);
    expect(existsSync(path.join(authDir, 'auth.json'))).toBe(true);
  });
```

Reuse the file's existing fixture and runner helpers; `fixtureHomeWithCodex` stands for its own `fixtureHomeWith`-style helper carrying the Task 1 roster row.

- [ ] **Step 2: Run them to verify they fail**

```bash
cd "$REPO/server"
./node_modules/.bin/vitest run test/ccrc-account.test.ts -t 'codex'
```

Expected: FAIL — `auth-start` passes the `!= external` gate and proceeds; removal already removes the launcher (correct, by falling into the `else`) but nothing pins it, and the OAuth-kept assertion is untested.

- [ ] **Step 3: Add the credential refusal**

At `ccd/ccrc:7087`, after the existing external gate, add its sibling:

```bash
  # THE SAME REFUSAL, A DIFFERENT REASON. An external lane's credential belongs
  # to a launcher ccrc does not write. A codex lane's launcher IS ccrc's — but
  # its credential is a ChatGPT OAuth directory a browser device flow owns, and
  # `exec.authDir` names where it lives precisely so that ccrc can pass the path
  # without ever opening it. The gate this mirrors was added after a hand-written
  # `external` entry naming a matching secretsFile was accepted and rotated at
  # exit 0, putting a live token in a 0600 file ccrc had promised never to write;
  # leaving `codex` to fall through here would reopen exactly that.
  [ "$ACCT_KIND" != codex ] \
    || _acct_refuse 1 codex-lane "account $id is a codex lane: its credential is the ChatGPT OAuth directory exec.authDir names, which a browser device flow writes and ccrc only ever passes the path of. This verb will not put a file on disk for it. Re-authenticate it with 'ccgpt login $id'. Nothing was written."
```

- [ ] **Step 4: Decide both `_acct_remove` branches explicitly**

At :7347 the launcher branch already does the right thing for codex by falling into the `else` — but "right by fall-through" is what the next reader has to re-derive. Make it explicit:

```bash
  # THREE answers, not two, and each is stated rather than inherited from an
  # `else`. `external` is somebody else's file and is KEPT. `generated` and
  # `codex` are both ccrc's and are removed through the marker check, which is
  # what refuses to delete a file ccrc did not write.
  if [ "$ACCT_KIND" = external ]; then
    f="$WRAPPER_BIN_DIR/$id"
    { [ -e "$f" ] || [ -L "$f" ]; } && kept+=("$f")
  else
    _acct_remove_wrapper "$id"
    case "$ACCT_WRAPPER_VERDICT" in
      absent) : ;;
      ccrc-unmodified) removed+=("$WRAPPER_BIN_DIR/$id") ;;
      *) kept+=("$WRAPPER_BIN_DIR/$id") ;;
    esac
  fi
```

At :7371 the secrets branch tests the same `external` literal. A codex lane's `exec.secretsFile`, when it declares one, is a file ccrc may have written for it; leave that branch's behaviour unchanged and add a comment saying the decision was made rather than inherited. **The OAuth directory is never named by this function at all** — add an explicit comment saying so, because "we never wrote code to delete it" and "we decided not to delete it" read identically in a diff:

```bash
  # `exec.authDir` IS NOT TOUCHED HERE, deliberately. Removing an account
  # removes what ccrc put on the box; a ChatGPT OAuth directory is not that,
  # and destroying it would end a subscription session ccrc never started.
  # The roster refuses an authDir under ~/.ccrc (shared/roster.ts) so that
  # `uninstall --purge` cannot reach one either.
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd "$REPO/server"
./node_modules/.bin/vitest run test/ccrc-account.test.ts
```

Expected: PASS, whole file.

- [ ] **Step 6: Measure the mutation**

Delete the new `[ "$ACCT_KIND" != codex ]` gate. Re-run: the auth-start case goes RED. Restore.

- [ ] **Step 7: Commit**

```bash
cd "$REPO"
git add ccd/ccrc server/test/ccrc-account.test.ts
git commit -m "$(cat <<'EOF'
feat(account): a codex lane's credential is not ccrc's to rotate

_acct_credential gated on `external` only, so every other kind was rotatable by
default — the hole whose last occurrence put a live token in a 0600 file ccrc
had promised never to write. `codex` now has its own refusal with its own
reason: a browser device flow owns that OAuth directory and ccrc only ever
passes its path.

_acct_remove's branches are now decided rather than inherited from an `else`,
and the fact that exec.authDir is deliberately untouched is written down —
"we never wrote the code" and "we decided not to" read identically in a diff.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: doctor answers for codex in all three of its arms

**Files:**
- Modify: `ccd/ccrc-doctor-checks` (`_check_wrappers`' counting `case` at :2440-2444; its shape arm's target comparison at :2640-2642; its `*)` arm at :2644-2646)
- Test: `server/test/ccrc-doctor.test.ts`

**Interfaces:**
- Consumes: Task 8's launcher shape (target `ccgpt`).
- Produces: a box with a correctly-installed codex lane passes `_check_wrappers`; a lane whose launcher execs anything else fails with a sentence naming both targets. Plan 3's `_check_codex` is separate and does not duplicate this.

- [ ] **Step 1: Write the failing test**

```ts
  it('a correctly installed codex lane passes the wrappers check', () => {
    const home = healthyCodexBox();
    const r = runDoctor(home, ['--only', 'wrappers']);
    expect(r.stdout).toMatch(/PASS .*wrappers/);
    expect(r.code).toBe(0);
  });

  it('a codex launcher execing the upstream account instead of ccgpt FAILs, and the line names both', () => {
    const home = healthyCodexBox();
    writeFileSync(path.join(home, '.local/bin/codex-a'),
      markGenerated(generateWrapperBody(
        { id: 'codex-a', configDirSuffix: '.claude-codex-a', execKind: 'generated' }, 'claude')),
      { mode: 0o755 });
    const r = runDoctor(home, ['--only', 'wrappers']);
    expect(r.stdout).toMatch(/execs \$HOME\/\.local\/bin\/claude, not ccgpt/);
    expect(r.code).toBe(1);
  });

  // The arm nothing pinned before this task. Deleting or widening it must be
  // visible; today it is a green mutation.
  it('an exec.kind the check does not understand is a hard failure that says so', () => {
    const home = healthyCodexBox();
    patchRosterKind(home, 'codex-a', 'someday-kind');
    const r = runDoctor(home, ['--only', 'wrappers']);
    expect(r.stdout).toMatch(/declares no exec\.kind this check understands/);
    expect(r.code).toBe(1);
  });
```

`healthyCodexBox` builds a fixture HOME with the roster row, a marker-stamped codex launcher and the `claude` upstream; `patchRosterKind` rewrites one account's `exec.kind` in the fixture's `accounts.json`. Both follow the file's existing fixture idiom — read `healthy()` at the top of `ccrc-doctor.test.ts` and extend it rather than writing a parallel one.

Note: the third case writes a kind the roster parser refuses. If `_check_wrappers` reads the roster through the parser, that case cannot be constructed and the arm is unreachable — in that case, assert instead that the `*)` arm exists in the shipped source by text and record in the commit that it is unreachable-by-construction, which is a different claim from "tested".

- [ ] **Step 2: Run them to verify they fail**

```bash
cd "$REPO/server"
./node_modules/.bin/vitest run test/ccrc-doctor.test.ts -t 'codex'
```

Expected: FAIL — the healthy box FAILs today, because the shape arm compares the parsed target against `upstream_id` and a codex launcher execs `ccgpt`.

- [ ] **Step 3: Teach the counting arm**

At `ccd/ccrc-doctor-checks:2440-2444`:

```bash
    case "$kind" in
      upstream)  n_up=$((n_up + 1)); [ -n "$upstream_id" ] || upstream_id="$id" ;;
      generated) n_gen=$((n_gen + 1)) ;;
      external)  n_ext=$((n_ext + 1)) ;;
      codex)     n_codex=$((n_codex + 1)) ;;
    esac
```

Declare `n_codex=0` beside the other three counters and include it wherever the check reports or totals them.

- [ ] **Step 4: Teach the shape arm**

The `generated` shape arm's target comparison at :2640 becomes kind-aware. Add a `codex)` arm beside `generated)` that reuses the same suffix and secrets comparisons and substitutes the target expectation:

```bash
        # A codex lane's launcher execs the COMMON `ccgpt`, which reads the
        # lane back out of the CLAUDE_CONFIG_DIR the same file exports. The
        # roster's upstream account is not its target and never was.
        if [ "$target" != ccgpt ]; then
          wr_hard+=("$id's wrapper execs \$HOME/.local/bin/$target, not ccgpt — a codex lane's launcher hands off to the common GPT-lane launcher")
        fi
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd "$REPO/server"
./node_modules/.bin/vitest run test/ccrc-doctor.test.ts
```

Expected: PASS, whole file. A doctor check must return the worst class it printed — confirm the failing case exits 1 and the healthy one exits 0, since a check whose code and printed verdict disagree is reported as a ccrc bug.

- [ ] **Step 6: Measure the mutation**

Change `if [ "$target" != ccgpt ]` to `if false`. Re-run: the wrong-target case goes RED. Restore. Then delete the `codex)` counting arm: confirm whatever the check reports about counts goes RED, or — if nothing does — say so in the commit rather than claiming coverage the suite does not have.

- [ ] **Step 7: Commit**

```bash
cd "$REPO"
git add ccd/ccrc-doctor-checks server/test/ccrc-doctor.test.ts
git commit -m "$(cat <<'EOF'
feat(doctor): _check_wrappers answers for codex in all three of its arms

The check answered an unknown kind three different ways — the shape arm refuses
by name, the counting arm silently counts nothing, and _dr_wr_note's b-only arm
says nothing — so "doctor refuses an unknown kind" was true of one of three
paths. All three now know codex, and the `*)` sentence gains its first test:
before this commit, deleting that arm was a green mutation.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: topology-clean gains an email class

**Files:**
- Modify: `server/test/topology-clean.test.ts` (the class list beside `operator residue` at :421)
- Test: `server/test/topology-clean.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: a repo-wide guard that reds when a commit introduces an email address outside a placeholder vocabulary. Plans 2 and 3 copy source out of a repository that has two real addresses committed in three of the files they read from; this class must exist before that work starts.

- [ ] **Step 1: Write the failing test**

Add a class to the rule list, following the file's existing `{ name, pattern, why, catches, passes }` shape. The `catches`/`passes` arrays are the suite's own self-test — it asserts each pattern catches its `catches` and passes its `passes`, so writing them IS writing the test:

```ts
  {
    name: 'email address',
    // Added 2026-09-20, ahead of the GPT-lane migration: the sources being
    // moved into this tree live in a repository with two real account
    // addresses committed in plaintext, and NO existing class here catches an
    // address — not `operator residue` (six fixed tokens), not `fleet account
    // label` (the roster residue set). A careless copy would ship green.
    //
    // The placeholder vocabulary is deliberately narrow. `example.com`,
    // `example.org` and `noreply@anthropic.com` are the only addresses this
    // tree has any business carrying: the first two are RFC 2606 reserved, and
    // the third is the commit trailer every commit here already ends with.
    pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
    why: 'an email address outside the reserved placeholder set names a real person or account',
    allowed: (token) =>
      token === 'noreply@anthropic.com'
      || /@(example\.(com|org|net)|localhost)$/.test(token),
    // RFC 2606 reserves `.example` as a TLD, so these look exactly like real
    // addresses and provably are not — which is what a `catches` row has to be:
    // it is written into this file, this plan, and every diff that touches
    // either. `example.com` is ALLOWED and `.example` is not, deliberately: the
    // allowed vocabulary is a short list of exact domains, not a TLD rule.
    catches: ['someone@acme.example', 'first.last@team.example', 'Someone@Acme.Example'],
    passes: ['you@example.com', 'dev@example.org', 'noreply@anthropic.com', '<your-email>', 'user@host'],
  },
```

- [ ] **Step 2: Run it to verify the class is alive**

```bash
cd "$REPO/server"
./node_modules/.bin/vitest run test/topology-clean.test.ts
```

Expected: the suite's own liveness rows prove the pattern catches each `catches` entry and passes each `passes` entry. If the scan over the real corpus now reds, **that is a finding, not a test bug**: read the reported `file:line: token`, and either the address is genuine residue to remove or the placeholder vocabulary needs widening with an argument. Do not widen it to make a red go away without saying which.

- [ ] **Step 3: Measure the mutation**

Delete the class from the list. Re-run: the suite's class-count or liveness assertions must go RED. If nothing reds, the class list has no cardinality pin and the class is decorative — add the pin in this task and say so in the commit.

- [ ] **Step 4: Commit**

```bash
cd "$REPO"
git add server/test/topology-clean.test.ts
git commit -m "$(cat <<'EOF'
test(topology): a class for email addresses, before the GPT-lane sources arrive

topology-clean scans every blob a commit range introduces against seven classes
and none of them catches an email address. The repository Plans 2 and 3 copy
from has two real account addresses committed in three of the files they read,
so a careless copy would ship green through the ratchet. Reserved placeholder
domains and the commit trailer's own address are the allowed vocabulary.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Wave-close gate

After Task 12, before opening the PR:

- [ ] **Fetch main, then run the cross-branch deviation guard**

```bash
cd "$REPO"
git fetch origin main
cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts
```

- [ ] **Run the FULL suite for every package, in the foreground**

```bash
cd "$REPO/server" && npm ci && ./node_modules/.bin/vitest run
cd "$REPO/agent"  && npm ci && ./node_modules/.bin/vitest run
cd "$REPO/pwa"    && npm ci && ./node_modules/.bin/vitest run
```

A task-scoped suite list misses the repo-wide guards; only the full run is the gate. Re-run any of the known load flakes (`ccd-ws-gc`, `pr-sweep`, `session-hook`, `typecheck-tests`, `ccd-session-state`, `ccd-bounded-reads`) **in isolation** before calling one a real break.

- [ ] **Typecheck**

```bash
cd "$REPO/server" && ./node_modules/.bin/tsc --noEmit
```

- [ ] **Check the author identity, then push and open the PR**

```bash
cd "$REPO"
git config user.name; git config user.email    # must NOT be the placeholder
git push -u origin ws/astra-system-message-error
```

The PR body ends with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`, links the spec by its **GitHub blob URL** (never a docserver URL), and states plainly that this wave ships no runtime and changes no box's behaviour until a roster declares a `codex` lane.

**Do not deploy.** The spec's §15 sequence is: land → release → separately authorised cutover → OpenClaw deletion. This plan ends at "land".

## Self-review of this plan

**Spec coverage.** §4.1 → Tasks 1–5. §4.2 (no minting verb) → stated in the spec, nothing to build. §4.3 → Tasks 1–5 (`lane.json` itself is Plan 2). §4.4 → Task 8's round-trip (identity via `CLAUDE_CONFIG_DIR`) plus the existing duplicate-suffix gate, unchanged. §4.5 → Tasks 5, 9, 11 and the wave ordering. §5.1's three declarations → Task 9 does `TOOLCHAIN_EXECUTABLES`; `_uninst_wrappers` and `_inst_bins` belong to Plan 2, which places the files. §5.3 → Tasks 8, 9, 11. §9's `_acct_credential`/`_acct_remove` → Task 10. §14's email class → Task 12. **Deferred to Plans 2 and 3, deliberately:** every executable, the runtime, the lifecycle, `_models_litellm*`, the probe's `authDir`, usage, `_check_codex`, uninstall, release/deploy placement, the doc amendments.

**Placeholder scan.** No "TBD" or "add error handling" steps; every code step carries the code. Three steps name a fixture helper generically (`fixtureHomeWith`, `runAccountOp`, `healthyCodexBox`) and instruct the implementer to reuse the file's own helper rather than inventing one — that is a deliberate instruction to read the existing file, not a gap, and each says so.

**Type consistency.** `proxyPort`, `litellmPort`, `authDir` are spelled identically in Tasks 1–5, 7 and 9. `CODEX_LAUNCHER`/`ccgpt` is the exec target in Tasks 8, 9 and 11. `sum_codex` is the bash variable in Task 9 only. `n_codex` is the doctor counter in Task 11 only.

**One risk this plan cannot resolve and hands to the implementer:** Task 11's third case may be unconstructible if `_check_wrappers` reads the roster through the parser, which refuses an unknown kind before doctor sees it. The step says so and gives the honest fallback rather than pretending the arm is testable.
