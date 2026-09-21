# GPT lane ownership — Plan 2a: the request path, ported and pinned — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the ChatGPT/Codex request path into ccrc as two shipped, tested Python files — `ccd/ccgpt-proxy.py` (the Anthropic→Codex request adapter) and `ccd/ccgpt-usage.py` (the usage-window publisher) — closing the two transport holes that are open today, and gate both from vitest without adding a Python leg to CI.

**Architecture:** Both files land under `ccd/` and are tested by spawning `python3` against the shipped file over a fixture HOME — the idiom `ccd/ccd-usage-sweep.py` already uses (`server/test/usage-sweep.test.ts`). Neither file is placed by the install spine in this wave, and nothing on any box changes: a `ccd/` file with no `_inst_bins` line is a measured, precedented state (`ccclip` and `compact-card.d.mts` are referenced **zero** times in `ccd/ccrc`). That decoupling is what lets ~91 migrated test cases land on their own review surface, away from the two exact `toEqual` bin-listing assertions that Plan 2b must move.

**Tech Stack:** Python 3 (stdlib only — `http.server`, `urllib`, `json`, `gzip`, `zlib`), vitest (`server/test`), Node's `spawnSync`.

**Spec:** `docs/superpowers/specs/2026-09-20-gpt-lane-ownership-design.md` (committed `b300d819`). Read §6 (the proxy), §10 (usage publication) and §14 (tests that move) before Task 1. §18's mutation table is the acceptance bar.

## Wave structure

This plan is **Plan 2a of four remaining**. Plan 1 (`2026-09-20-gpt-lane-ownership-1-roster-contract.md`) is **MERGED** (`592cb109`, released `v0.0.10`).

| Plan | Deliverable | State |
|---|---|---|
| 1 — the contract | a roster may declare a `codex` lane; `ccrc wrappers` writes its launcher | **MERGED `592cb109`** |
| **2a — the request path (this plan)** | `ccd/ccgpt-proxy.py` + `ccd/ccgpt-usage.py`, both gated from vitest; both transport holes closed. Nothing is placed, nothing starts. | this plan |
| 2b — the lane runs | `ccd/ccgpt`, `ccd/ccgpt-runtime`, `_svc_run_supervised`, `runtime.env` + key generation, `lane.json`'s writer, `_inst_bins`/`_inst_units`/`_inst_enable`, the uninstall censuses + their derived guard, `installTreeFixture.ts`, `deploy/deploy.sh` | owed |
| 3 — policy, health, removal | per-lane `litellm.yaml` (§8's `_models_litellm*` rework), the probe's `authDir`, the usage instance **timer**'s enablement, `_check_codex`, uninstall behaviour, doc amendments, cutover runbook | owed |

**Why 2 is split, and why the cut is here.** Three measured reasons, none of them "it is big":

1. **Placement is indivisible.** `server/test/ccrc-install.test.ts` asserts an exact `toEqual` over `$HOME/.local/bin`'s listing with **two arms** (a Darwin set and a longer non-Darwin set), and a second test derives `_inst_bins`' own closing `echo` census against the same directory. Placing two of the four executables in one plan and two in another moves both assertions twice, and the second PR's diff becomes unreviewable against the first's baseline. So all four placements live in one plan — 2b, because `ccd/ccgpt` and `ccd/ccgpt-runtime` must exist to be placed. **2a therefore carries no placement at all.**
2. **2a's files are fully testable unplaced; 2b's are not testable yet.** `server/test/usage-sweep.test.ts` resolves its subject from the **test file's own path**, not from an installed fixture HOME — so a shipped `ccd/` file with no install line is already a complete, gated subject. Every high-risk thing 2b owns needs an instrument that does not exist yet (a fake-venv seam for the runtime builder; a poisoned-`systemd-run` argv assertion for the lifecycle, because `ghContainedEnv` plants stubs that exit 97 for `systemctl`/`systemd-run`). A single plan mixing ~91 transcribable cases with undesigned instruments gets its instrument design done last, by a worker who has spent the wave transcribing.
3. **The migrated-test payload alone is a wave.** Of 101 methods in the OpenClaw suite, only ~24 are text scans that port cleanly; ~41 call a private Python function in-process, ~11 `exec()` the publisher with injected `sys.modules` and a swapped `urlopen`, and ~4 bind sockets. None of the ~52 in the middle survives a plain `spawnSync python3` without a new seam — which is why Task 1 designs that seam before any case is written.

**What does NOT force the split, stated so nobody sequences around it:** the OpenClaw suite's SHA-256 pin over the publisher's bytes. Its subject resolves to `infra/handoff/ccgpt-usage` in the **other** repository; `ccd/ccgpt-usage.py` is a new path in a different repo. It constrains step 4 of the cutover only.

**One scope correction against Plan 1's committed table.** Plan 1 assigned "the usage instance timer" to wave 3 and the file `ccd/ccgpt-usage.py` to wave 2. Both stand: **this plan ships the publisher FILE; wave 3 ships `ccgpt-usage@<id>.timer`'s enablement, together with `_check_codex`.** The reason is a real gap, not tidiness — `_check_services`' `known` list is a fixed seven-name array and deliberately not a glob, so a timer enabled in wave 2 would be watched by nothing until wave 3. Do not pull the timer forward.

Do not start Plan 2b from this document.

## Global Constraints

Copied from the spec and this repo's `CLAUDE.md`. Every task's requirements implicitly include this section.

- **`$REPO` is this worktree's root.** Every command assumes `export REPO="$(git rev-parse --show-toplevel)"`. Absolute paths are never written into tracked text — they carry the operator's username, which `topology-clean`'s operator-residue class bans.
- **This repository is PUBLIC, and this wave copies from a private tree.** No real account id, label, email address, host, selected machine port, credential, OAuth path, session codename or operator username may reach any tracked byte. **Scrub at every copy, not once.** Known residue in the sources, by location — re-grep before each copy, never trust these coordinates:
  - the OpenClaw suite's `TestOneWrapperManyLanes` docstring (a real address), and one occurrence each in `infra/handoff/ccgpt` and `infra/handoff/lanes/gpt2`;
  - the **installed** launcher carries an address+domain near its header and a session codename near its exec block.
  Rewrite all of it to roster-id vocabulary (`codex-a`, `codex-b`) before the bytes are staged.
- **`topology-clean`'s email class is already live** (landed in Plan 1, Task 12). It scans every blob a commit range introduces, and its `allowed()` exempts systemd instance syntax by unit suffix — so `ccgpt-usage@codex-a.timer` passes while a real address fails. No red-first sequencing is owed for it; the obligation is content, not ordering.
- **Fixture vocabulary:** account ids are `codex-a`, `codex-b`, `claude`, `claude2`. Synthetic ports are `45010`/`45011` and `45020`/`45021`. They are **not defaults** and must never appear in shipped source as defaults.
- **Never print secret file CONTENTS.** Existence and mode only. Never assert over a real token; fixture tokens are literal strings like `test-token-not-a-secret`.
- **Fixture HOMEs only.** Never run either Python file, `ccd`, or `ccrc` against the real `$HOME`. Use `mkTmp` from `server/test/tmpHelpers.ts`.
- **Never run destructive `ccd` verbs** (`ws-rm`, `ws-reap`, `ws-gc --prune`, `ws-archive`, `ws-restore`), and never touch tmux, `~/.cc-sessions`, `~/.cc-limits` or `claude-session@*.service`. **This box runs two live Codex lanes right now** — do not stop, restart or reconfigure them.
- **This plan edits no `ccd/ccd`, no `ccd/ccrc`, no `deploy/deploy.sh`, no `installTreeFixture.ts`, and adds no systemd unit.** If a task seems to need one, that is a signal the cut is wrong — stop and report, do not widen. (The one permitted exception is Task 12's re-read of a wave-1 refusal sentence, which changes prose only if it has gone false.)
- **The publisher stays Python and keeps `json.dump`'s default separators.** `ccd`'s `_limit_json_num` reads the row with a `grep -oE` that tolerates whitespace after the colon *because* this producer writes `": "`. A compact writer makes `ccd` read the lane as entirely unknown.
- **`fiveResetAt` and `sevenResetAt` are emitted on every poll, null included.** `_limit_has_key` asks whether the keys are *present*, whatever their value; that presence is the only thing separating this publisher's row from the compact three-key 429 exclusion `ccd` writes itself.
- **Absent and zero are different answers** for `x-codex-secondary-window-minutes`. Folding them changes what the fleet believes about a lane's capacity. Two readers (`server/src/limits.ts` and `ccd`'s `_limit_score`) share one rule and must not drift.
- **Mutation discipline.** Every guard ships with a test that goes RED when the guard is deleted or mutated, measured before and after — not asserted in a comment. For the two folds, **mutate the call site, not only the helper**: a correct fold that nothing calls is the exact failure this pair of doors already produced once in production.
- **Run suites in the FOREGROUND with `timeout ≥ 600000` ms**, from inside the package: `cd server && ./node_modules/.bin/vitest run test/<file>.test.ts`. Never bare `npx vitest`.
- **Line numbers in this plan are deliberately absent.** Locate every subject by **name plus a grep command**, at execution time. Two agents measuring the same five lines of `ccd/ccrc` on the same tree disagreed by up to five; the spec's own citations are stale by +22 and +53 lines. A copied line number is a defect class here.
- **Commit messages end with:** `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`
- **Deviation numbers are API-allocated.** Do not invent one. `POST /api/ledger/deviations` mints a block and you define the numbers in the same act; if the allocator is unreachable, write `D-TBD-<slug>` and report it. Do not write a concrete `D-TBD-<n>` token into this plan — name a contingency by slug.

---

## Source of truth for the port

The OpenClaw tree holds the sources. **For the shim and the publisher the repo copy and the installed copy are byte-identical** (measured: `diff` clean for both), so either may be read. This is *not* true of the launcher — `ccgpt` diverges by 82 lines and only the installed copy carries production lifecycle — but the launcher is Plan 2b's subject, not this plan's.

Locate the sources once, at the top of the wave:

```bash
export OC="$(cd ~/worktrees/OpenClawHetzner/astra-system/infra/handoff 2>/dev/null && pwd)"
[ -n "$OC" ] || { echo "OpenClaw handoff tree not found — stop and report"; exit 1; }
ls "$OC/ccgpt-proxy" "$OC/ccgpt-usage" "$OC/test_ccgpt_proxy.py"
diff -q "$OC/ccgpt-proxy" "$HOME/.local/bin/ccgpt-proxy" && echo "shim: repo == installed"
diff -q "$OC/ccgpt-usage" "$HOME/.local/bin/ccgpt-usage" && echo "publisher: repo == installed"
```

**How the port is done, and why not by wholesale copy.** Each behaviour task below builds its slice of the file with its own failing test first. The OpenClaw source is the **reference** — cited per task, read before implementing — not a blob to paste. A wholesale copy in Task 2 would make every later task green on arrival, which is the "tests written after pass immediately" failure this repo's TDD rule exists to prevent, and it would carry residue and the two open transport holes along with it. Where the reference's logic is correct, reproduce it deliberately and say so in the commit.

---

### Task 1: the vitest-over-python3 seam, designed before any case is written

**Files:**
- Create: `server/test/ccgptHarness.ts`
- Create: `server/test/fixtures/pystub/litellm/__init__.py`
- Create: `server/test/fixtures/pystub/litellm/llms/__init__.py`
- Create: `server/test/fixtures/pystub/litellm/llms/chatgpt/__init__.py`
- Create: `server/test/fixtures/pystub/litellm/llms/chatgpt/authenticator.py`
- Test: `server/test/ccgpt-harness.test.ts`

**Interfaces:**
- Consumes: `mkTmp` from `server/test/tmpHelpers.ts`.
- Produces — every later task uses these exact signatures:
  - `pythonOrSkip(): string | null` — absolute path to a usable `python3`, or `null`.
  - `ccgptFile(name: string): string` — repo-relative resolve of a shipped file, e.g. `ccgptFile('ccgpt-proxy.py')`.
  - `runPy(file: string, opts: {home: string, args?: string[], env?: Record<string,string>, stdin?: string, timeoutMs?: number}): {status: number|null, stdout: string, stderr: string}`
  - `PYSTUB_DIR: string` — absolute path to the stub package root, for `PYTHONPATH`.

**Why this task exists first.** The migrated cases do three incompatible things: some scan text, some call private functions in-process, and ~11 drive the publisher with four fake modules injected into `sys.modules` and `urllib.request.urlopen` swapped. A subprocess can do none of that. The publisher hard-imports `litellm.llms.chatgpt.authenticator`, and **this box's ambient `python3` has no litellm at all** — so without a seam those cases are silently dropped or a worker invents an unreviewed one mid-task.

**The seam, decided here:** a **test-only stub package on `PYTHONPATH`** satisfies the hard import, and the publisher gains **one** production configuration seam — its endpoint may be overridden by `CCGPT_USAGE_ENDPOINT`, **honoured only when the value is a loopback URL**. The loopback restriction is what keeps this a configuration seam rather than a credential-redirection hazard: the publisher sends a bearer token to that endpoint, so a non-loopback override is refused outright. The production default is pinned by its own test.

- [ ] **Step 1: Write the failing test**

```ts
// server/test/ccgpt-harness.test.ts
import { describe, it, expect } from 'vitest';
import { pythonOrSkip, runPy, PYSTUB_DIR } from './ccgptHarness';
import { mkTmp } from './tmpHelpers';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

describe('the ccgpt python harness', () => {
  it('runs a python file in a fixture HOME and reports its exit status', () => {
    const py = pythonOrSkip();
    if (!py) return;                       // a box with no python3 skips, loudly in the name
    const home = mkTmp('ccgpt-harness-');
    const f = join(home, 'probe.py');
    writeFileSync(f, 'import os,sys\nprint(os.environ["HOME"])\nsys.exit(7)\n');
    const r = runPy(f, { home });
    expect(r.status).toBe(7);
    expect(r.stdout.trim()).toBe(home);    // HOME is the fixture, never the real one
  });

  it('puts the litellm stub on PYTHONPATH so a hard import resolves', () => {
    const py = pythonOrSkip();
    if (!py) return;
    const home = mkTmp('ccgpt-harness-stub-');
    const f = join(home, 'imp.py');
    writeFileSync(f,
      'from litellm.llms.chatgpt.authenticator import Authenticator\n' +
      'print(Authenticator().get_access_token())\n');
    const r = runPy(f, { home, env: { PYTHONPATH: PYSTUB_DIR } });
    expect(r.stderr).toBe('');
    expect(r.stdout.trim()).toBe('stub-token-not-a-secret');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd "$REPO/server" && ./node_modules/.bin/vitest run test/ccgpt-harness.test.ts
```

Expected: FAIL — `Cannot find module './ccgptHarness'`.

- [ ] **Step 3: Write the harness and the stub package**

Read `server/test/usage-sweep.test.ts` first and copy how it resolves its subject from the test file's own path; do not invent a second convention.

```ts
// server/test/ccgptHarness.ts
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..', '..');

/** The stub package root. On PYTHONPATH it satisfies the publisher's hard
 *  `from litellm.llms.chatgpt.authenticator import Authenticator` on a box
 *  whose ambient python3 has no litellm — which is every box in CI. */
export const PYSTUB_DIR = path.join(here, 'fixtures', 'pystub');

/** The shipped file under ccd/, resolved from THIS file's path — the same way
 *  usage-sweep.test.ts resolves ccd-usage-sweep.py. A file with no install
 *  line is still a complete subject. */
export function ccgptFile(name: string): string {
  return path.join(REPO, 'ccd', name);
}

/** An absolute python3, or null when the box has none. Callers return early on
 *  null rather than failing: a missing interpreter is an environment fact, and
 *  a false red is worse than an unpinned claim. */
export function pythonOrSkip(): string | null {
  const r = spawnSync('python3', ['-c', 'import sys; print(sys.executable)'], { encoding: 'utf8' });
  if (r.status !== 0) return null;
  const exe = (r.stdout || '').trim();
  return exe && existsSync(exe) ? exe : null;
}

export function runPy(
  file: string,
  opts: { home: string; args?: string[]; env?: Record<string, string>; stdin?: string; timeoutMs?: number },
): { status: number | null; stdout: string; stderr: string } {
  const py = pythonOrSkip();
  if (!py) throw new Error('runPy called with no python3 — guard with pythonOrSkip() first');
  const r = spawnSync(py, [file, ...(opts.args ?? [])], {
    encoding: 'utf8',
    input: opts.stdin,
    timeout: opts.timeoutMs ?? 20_000,
    // A CLOSED env: the fixture HOME and nothing inherited. The publisher reads
    // its output directory from HOME, so an inherited HOME would write into the
    // operator's real ~/.cc-limits.
    env: { HOME: opts.home, PATH: process.env.PATH ?? '/usr/bin:/bin', ...(opts.env ?? {}) },
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}
```

The stub package — four files, each minimal:

```python
# server/test/fixtures/pystub/litellm/__init__.py
# Test-only stub. Satisfies the publisher's hard import on a box with no
# litellm. It is NOT a mock of litellm's behaviour and must never grow one.
```

```python
# server/test/fixtures/pystub/litellm/llms/__init__.py
```

```python
# server/test/fixtures/pystub/litellm/llms/chatgpt/__init__.py
```

```python
# server/test/fixtures/pystub/litellm/llms/chatgpt/authenticator.py
class Authenticator:
    """Returns a fixed non-secret string so a test can assert the publisher
    passed SOMETHING as a bearer token without any real credential existing."""
    def get_access_token(self):
        return "stub-token-not-a-secret"
```

- [ ] **Step 4: Run it and watch it pass**

```bash
cd "$REPO/server" && ./node_modules/.bin/vitest run test/ccgpt-harness.test.ts
```

Expected: PASS, 2 tests.

- [ ] **Step 5: Prove the HOME containment is real, not decorative**

Temporarily change `runPy`'s `env` to spread `process.env` before `HOME`. Re-run. The first test must go RED (`stdout` is the real HOME, not the fixture). Restore the closed env and confirm GREEN again. Record both numbers in the commit body.

- [ ] **Step 6: Commit**

```bash
cd "$REPO"
git add server/test/ccgptHarness.ts server/test/fixtures/pystub server/test/ccgpt-harness.test.ts
git commit -m "$(cat <<'EOF'
test(ccgpt): a vitest-over-python3 harness with a closed fixture HOME

The migrated GPT-lane cases cannot run in-process: ~11 of them inject four
fake modules into sys.modules and swap urlopen, which a subprocess cannot do,
and this box's ambient python3 has no litellm to import at all. The seam is a
test-only stub package on PYTHONPATH plus a closed env whose HOME is the
fixture — measured: spreading process.env instead reds the containment case.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `ccd/ccgpt-proxy.py` exists and passes non-`/messages` paths through byte-identically

**Files:**
- Create: `ccd/ccgpt-proxy.py`
- Test: `server/test/ccgpt-proxy.test.ts`

**Interfaces:**
- Consumes: `pythonOrSkip`, `runPy`, `ccgptFile`, `PYSTUB_DIR` (Task 1).
- Produces: the shim binds `127.0.0.1:$CCGPT_PROXY_PORT`, forwards to `127.0.0.1:$CCGPT_LITELLM_PORT`, and answers `GET /ccgpt/lane` with `{"lane": "<CCGPT_ACCOUNT_ID>"}`. Later tasks add behaviour to the `/v1/messages` path only.

**Reference:** `$OC/ccgpt-proxy` — read its request-handler class and its `_relay` before implementing. Reproduce its structure deliberately; do not paste it.

**Note on the lane endpoint:** `/ccgpt/lane` is not decoration. Plan 2b's lifecycle refuses to adopt a listener that answers another lane's id, and that refusal prevents a dated incident in which a lane silently attached to another lane's gateway and billed the wrong account. It ships here because the shim owns it.

- [ ] **Step 1: Write the failing test**

```ts
// server/test/ccgpt-proxy.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { pythonOrSkip, ccgptFile, PYSTUB_DIR } from './ccgptHarness';
import { mkTmp } from './tmpHelpers';

const LANE = 'codex-a';
const PROXY_PORT = 45010;
const UPSTREAM_PORT = 45011;

let proc: ChildProcess | null = null;
let upstream: Server | null = null;

afterEach(async () => {
  if (proc) { proc.kill('SIGKILL'); proc = null; }
  if (upstream) { await new Promise<void>((r) => upstream!.close(() => r())); upstream = null; }
});

/** Starts a recording upstream plus the shim. Returns the request the upstream saw. */
async function startPair(home: string, handler: (req: any, body: Buffer, res: any) => void) {
  upstream = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => handler(req, Buffer.concat(chunks), res));
  });
  await new Promise<void>((r) => upstream!.listen(UPSTREAM_PORT, '127.0.0.1', () => r()));

  const py = pythonOrSkip()!;
  proc = spawn(py, [ccgptFile('ccgpt-proxy.py')], {
    env: {
      HOME: home, PATH: process.env.PATH ?? '/usr/bin:/bin', PYTHONPATH: PYSTUB_DIR,
      CCGPT_ACCOUNT_ID: LANE,
      CCGPT_PROXY_PORT: String(PROXY_PORT),
      CCGPT_LITELLM_PORT: String(UPSTREAM_PORT),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  // Poll the lane endpoint rather than sleeping: a fixed sleep is a flake.
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PROXY_PORT}/ccgpt/lane`);
      if (r.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('shim did not come up');
}

describe('ccgpt-proxy: identity and passthrough', () => {
  it('answers /ccgpt/lane with its own lane id', async () => {
    if (!pythonOrSkip()) return;
    const home = mkTmp('ccgpt-proxy-lane-');
    await startPair(home, (_req, _body, res) => { res.writeHead(200); res.end('{}'); });
    const r = await fetch(`http://127.0.0.1:${PROXY_PORT}/ccgpt/lane`);
    expect(await r.json()).toEqual({ lane: LANE });
  });

  it('forwards a non-/messages path byte-identically', async () => {
    if (!pythonOrSkip()) return;
    const home = mkTmp('ccgpt-proxy-pass-');
    let seen: Buffer | null = null;
    let seenPath = '';
    await startPair(home, (req, body, res) => {
      seen = body; seenPath = req.url;
      res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}');
    });
    const payload = '{"weird":"\\u00e9 bytes","n":1}';
    const r = await fetch(`http://127.0.0.1:${PROXY_PORT}/v1/models`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: payload,
    });
    expect(r.status).toBe(200);
    expect(seenPath).toBe('/v1/models');
    expect(seen!.toString('utf8')).toBe(payload);   // byte-identical, not re-serialised
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd "$REPO/server" && ./node_modules/.bin/vitest run test/ccgpt-proxy.test.ts
```

Expected: FAIL — the shim file does not exist, so `startPair` times out with "shim did not come up".

- [ ] **Step 3: Write the minimal shim**

Create `ccd/ccgpt-proxy.py` with: a shebang, a module docstring naming ccrc as owner, env reading (`CCGPT_ACCOUNT_ID`, `CCGPT_PROXY_PORT`, `CCGPT_LITELLM_PORT` — **refuse with a clear message and a non-zero exit when any is unset**; there are no defaults, because a defaulted port is how one lane reaches another lane's gateway), a `ThreadingHTTPServer`, a handler that answers `GET /ccgpt/lane`, and `_relay` forwarding everything else unchanged with hop-by-hop headers dropped.

Keep `/v1/messages` on the same passthrough path for now — Task 3 is what makes it different.

- [ ] **Step 4: Run it and watch it pass**

```bash
cd "$REPO/server" && ./node_modules/.bin/vitest run test/ccgpt-proxy.test.ts
```

Expected: PASS, 2 tests.

- [ ] **Step 5: Prove the no-default refusal**

Add a case asserting the shim exits non-zero with a message naming the missing variable when `CCGPT_LITELLM_PORT` is unset. Then mutate the shim to default that port to `4001` and confirm the case goes RED. Restore.

- [ ] **Step 6: Check the new blob for residue, then commit**

```bash
cd "$REPO"
grep -nE '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}' ccd/ccgpt-proxy.py || echo "no address-shaped token"
git add ccd/ccgpt-proxy.py server/test/ccgpt-proxy.test.ts
git commit -m "$(cat <<'EOF'
feat(ccgpt): the shim's identity endpoint and byte-identical passthrough

Ports, lane id and upstream port are required with no defaults: a defaulted
port is the mechanism by which one lane reaches another lane's gateway, and
/ccgpt/lane is the probe Plan 2b's adoption check relies on to refuse exactly
that. Non-/messages traffic is forwarded unparsed.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: mid-conversation `system` turns are folded to `user`, in place

**Files:**
- Modify: `ccd/ccgpt-proxy.py`
- Test: `server/test/ccgpt-proxy.test.ts`

**Interfaces:**
- Produces: `_fold_midturn_system(data: dict) -> dict` — every `messages[*]` whose `role` is `"system"` becomes `"user"`, **in place, preserving order and content shape**.

**Why in place.** The `mid-conversation-system-2026-04-07` beta exists because the *position* carries meaning. Hoisting a mid-conversation system turn to the top changes what was said. Codex answers such an entry with `400 {"detail":"System messages are not allowed"}`, and because the entry is replayed with the history, one injection fails **every later turn** — sticky, not flaky. This is the defect that started the whole migration.

**Both content shapes convert**, not only the content-block shape that 400s today: the sender draws no distinction, and the string arm survives only because a layer below happens to hoist it.

- [ ] **Step 1: Write the failing test**

```ts
describe('ccgpt-proxy: the mid-conversation system door', () => {
  it('converts a mid-conversation system turn to user, in place, both content shapes', async () => {
    if (!pythonOrSkip()) return;
    const home = mkTmp('ccgpt-proxy-mid-');
    let seen: any = null;
    await startPair(home, (_req, body, res) => {
      seen = JSON.parse(body.toString('utf8'));
      res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}');
    });
    await fetch(`http://127.0.0.1:${PROXY_PORT}/v1/messages`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-x', messages: [
          { role: 'user', content: 'first' },
          { role: 'system', content: 'a plain string instruction' },
          { role: 'assistant', content: 'ok' },
          { role: 'system', content: [{ type: 'text', text: 'a block instruction' }] },
        ],
      }),
    });
    expect(seen.messages.map((m: any) => m.role)).toEqual(['user', 'user', 'assistant', 'user']);
    expect(seen.messages[1].content).toBe('a plain string instruction');          // content untouched
    expect(seen.messages[3].content).toEqual([{ type: 'text', text: 'a block instruction' }]);
    expect(JSON.stringify(seen).includes('"role": "system"')).toBe(false);
    expect(JSON.stringify(seen).includes('"role":"system"')).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd "$REPO/server" && ./node_modules/.bin/vitest run test/ccgpt-proxy.test.ts -t 'mid-conversation system door'
```

Expected: FAIL — roles come through as `['user','system','assistant','system']`.

- [ ] **Step 3: Implement the fold and call it**

```python
def _fold_midturn_system(data):
    """Every messages[*] with role 'system' becomes 'user', IN PLACE.

    The beta that produces these entries exists because position carries
    meaning, so this never hoists. Both content shapes convert: the sender
    draws no distinction between a plain string and a content-block list, and
    the string arm survives today only because a layer below happens to hoist
    it. Codex refuses either, and the entry is replayed with the history, so
    one unfolded injection fails every later turn.
    """
    msgs = data.get("messages")
    if not isinstance(msgs, list):
        return data
    for m in msgs:
        if isinstance(m, dict) and m.get("role") == "system":
            m["role"] = "user"
    return data
```

Call it on the `/v1/messages` rewrite path. The call site is as load-bearing as the function.

- [ ] **Step 4: Run it and watch it pass**

```bash
cd "$REPO/server" && ./node_modules/.bin/vitest run test/ccgpt-proxy.test.ts
```

Expected: PASS.

- [ ] **Step 5: Mutate the FUNCTION, then mutate the CALL SITE**

Two separate measurements, both required, recorded with their counts:
1. Replace the loop body with `pass`. Re-run: the case must go RED. Restore; GREEN.
2. Restore the function and **delete the call** instead (leave the function defined and unused). Re-run: the case must go RED again.

The second is the one that matters. A correct fold that nothing calls is exactly the failure this pair of doors produced in production.

- [ ] **Step 6: Commit**

```bash
cd "$REPO"
git add ccd/ccgpt-proxy.py server/test/ccgpt-proxy.test.ts
git commit -m "$(cat <<'EOF'
fix(ccgpt): fold mid-conversation system turns to user, in place

Codex refuses role:"system" inside messages, and the entry is replayed with
the history, so one injection fails every later turn. Converted in place
because the beta's whole point is that position carries meaning. Measured
both mutations: neutering the loop reds the case, and so does deleting only
the call — a correct fold nothing calls is the failure this door already had.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: the top-level `system` folds after the mid-turn pass, and lands above a converted first turn

**Files:**
- Modify: `ccd/ccgpt-proxy.py`
- Test: `server/test/ccgpt-proxy.test.ts`

**Interfaces:**
- Produces: `_fold_system(data: dict) -> dict` — removes the top-level `system` key and prepends its content as a leading `user` turn.

**Order is the whole point.** Mid-turn conversion runs **first**, then the top-level fold. Reversed, a top-level instruction would be prepended before conversion and a converted first turn could end up above it — silently changing which instruction the model reads first.

- [ ] **Step 1: Write the failing test**

```ts
it('folds the top-level system ABOVE a converted first turn', async () => {
  if (!pythonOrSkip()) return;
  const home = mkTmp('ccgpt-proxy-top-');
  let seen: any = null;
  await startPair(home, (_req, body, res) => {
    seen = JSON.parse(body.toString('utf8'));
    res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}');
  });
  await fetch(`http://127.0.0.1:${PROXY_PORT}/v1/messages`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-x',
      system: 'TOP LEVEL',
      messages: [{ role: 'system', content: 'WAS MID TURN' }],
    }),
  });
  expect('system' in seen).toBe(false);                       // the key is gone, not emptied
  expect(seen.messages.map((m: any) => m.role)).toEqual(['user', 'user']);
  // Order proves the sequence: the top-level instruction is FIRST.
  expect(JSON.stringify(seen.messages[0])).toContain('TOP LEVEL');
  expect(JSON.stringify(seen.messages[1])).toContain('WAS MID TURN');
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd "$REPO/server" && ./node_modules/.bin/vitest run test/ccgpt-proxy.test.ts -t 'ABOVE a converted first turn'
```

Expected: FAIL — `system` is still present on the forwarded body.

- [ ] **Step 3: Implement, in the stated order**

```python
data = _fold_midturn_system(data)   # first: convert in place
if "system" in data:
    data = _fold_system(data)       # then: the top-level instruction lands above
```

- [ ] **Step 4: Run it and watch it pass**

Expected: PASS.

- [ ] **Step 5: Mutate the ORDER, not just the function**

Swap the two calls so `_fold_system` runs first. Re-run: the order assertion must go RED while the "no system key" assertion stays green — proving the test binds the sequence and not merely the outcome. Restore. Then delete the `_fold_system` call and confirm RED again.

- [ ] **Step 6: Commit**

```bash
cd "$REPO"
git add ccd/ccgpt-proxy.py server/test/ccgpt-proxy.test.ts
git commit -m "$(cat <<'EOF'
fix(ccgpt): fold the top-level system after the mid-turn pass

Order is load-bearing: converting mid-turn entries first keeps a top-level
instruction above a converted first turn. Measured by swapping the two calls
— the order assertion reds while the key-absence assertion stays green, so
the test binds the sequence rather than the outcome.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: a chunked request body is decoded, rewritten and forwarded with a correct length

**Files:**
- Modify: `ccd/ccgpt-proxy.py`
- Test: `server/test/ccgpt-proxy.test.ts`

**The hole being closed.** `_relay` reads `Content-Length` only. A request with `Transfer-Encoding: chunked` therefore forwards **with no body at all** — measured: the sink received 0 bytes. The hazard is the *silent* arm, not the encoding.

Node's `fetch` sends a stream body chunked, which is how the test produces the shape without hand-framing.

- [ ] **Step 1: Write the failing test**

```ts
it('decodes a chunked body, rewrites it, and forwards a correct length', async () => {
  if (!pythonOrSkip()) return;
  const home = mkTmp('ccgpt-proxy-chunked-');
  let seen: Buffer | null = null; let seenTE = ''; let seenCL = '';
  await startPair(home, (req, body, res) => {
    seen = body;
    seenTE = String(req.headers['transfer-encoding'] ?? '');
    seenCL = String(req.headers['content-length'] ?? '');
    res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}');
  });
  const payload = JSON.stringify({ model: 'gpt-x', system: 'TOP', messages: [{ role: 'system', content: 'MID' }] });
  const stream = new ReadableStream({
    start(c) { c.enqueue(new TextEncoder().encode(payload.slice(0, 20)));
               c.enqueue(new TextEncoder().encode(payload.slice(20))); c.close(); },
  });
  const r = await fetch(`http://127.0.0.1:${PROXY_PORT}/v1/messages`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: stream, duplex: 'half',
  } as any);
  expect(r.status).toBe(200);
  expect(seen!.length).toBeGreaterThan(0);                    // the hole: this was 0
  const got = JSON.parse(seen!.toString('utf8'));
  expect('system' in got).toBe(false);                        // it was rewritten, not just relayed
  expect(got.messages.every((m: any) => m.role !== 'system')).toBe(true);
  expect(seenCL).toBe(String(seen!.length));                  // correct length, not the original
  expect(seenTE).toBe('');                                    // re-framed, not re-chunked
});
```

- [ ] **Step 2: Run it and watch it fail**

Expected: FAIL — `seen.length` is `0`.

- [ ] **Step 3: Implement chunked decoding**

Read the framing yourself (size line in hex, CRLF, bytes, CRLF, terminating `0`), or use the handler's `rfile` with a documented reader. After rewriting, set `Content-Length` and drop `Transfer-Encoding` from the forwarded headers.

- [ ] **Step 4: Run it and watch it pass**

Expected: PASS.

- [ ] **Step 5: Mutate**

Restore the `Content-Length`-only read. The case must go RED with `seen.length === 0` — the exact production symptom. Restore.

- [ ] **Step 6: Commit**

---

### Task 6: a gzip or deflate body is decoded, rewritten and re-encoded

**Files:**
- Modify: `ccd/ccgpt-proxy.py`
- Test: `server/test/ccgpt-proxy.test.ts`

**The hole being closed.** On a gzip body, `json.loads` raises, and the `except ValueError: return body` arm passes the body through **with `system` intact**. Again the silent arm is the hazard.

- [ ] **Step 1: Write the failing test**

```ts
import { gzipSync, gunzipSync, deflateSync, inflateSync } from 'node:zlib';

it.each([
  ['gzip', gzipSync, gunzipSync],
  ['deflate', deflateSync, inflateSync],
])('decodes a %s body, rewrites it, and re-encodes it', async (enc, pack, unpack) => {
  if (!pythonOrSkip()) return;
  const home = mkTmp(`ccgpt-proxy-${enc}-`);
  let seen: Buffer | null = null; let seenEnc = '';
  await startPair(home, (req, body, res) => {
    seen = body; seenEnc = String(req.headers['content-encoding'] ?? '');
    res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}');
  });
  const body = pack(Buffer.from(JSON.stringify({
    model: 'gpt-x', system: 'TOP', messages: [{ role: 'system', content: 'MID' }],
  })));
  const r = await fetch(`http://127.0.0.1:${PROXY_PORT}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'content-encoding': enc },
    body,
  });
  expect(r.status).toBe(200);
  expect(seenEnc).toBe(enc);                                  // re-encoded, not silently decompressed
  const got = JSON.parse(unpack(seen!).toString('utf8'));
  expect('system' in got).toBe(false);                        // the hole: this used to survive
  expect(got.messages.every((m: any) => m.role !== 'system')).toBe(true);
});
```

- [ ] **Step 2: Run it and watch it fail**

Expected: FAIL — `'system' in got` is `true` (the body was forwarded unrewritten).

- [ ] **Step 3: Implement decode/re-encode** for `gzip` and `deflate`.

- [ ] **Step 4: Run it and watch it pass**

- [ ] **Step 5: Mutate**

Restore the `except ValueError: return body` passthrough. The case must go RED with `system` present. Restore.

- [ ] **Step 6: Commit**

---

### Task 7: an encoding the shim cannot decode is refused explicitly, never forwarded

**Files:**
- Modify: `ccd/ccgpt-proxy.py`
- Test: `server/test/ccgpt-proxy.test.ts`

**The rule:** a body carrying a system message is **never forwarded unexamined**. An unknown `Content-Encoding` is answered with an explicit error; it does not fall through.

- [ ] **Step 1: Write the failing test**

```ts
it('refuses an undecodable encoding instead of forwarding it unexamined', async () => {
  if (!pythonOrSkip()) return;
  const home = mkTmp('ccgpt-proxy-badenc-');
  let reached = false;
  await startPair(home, (_req, _body, res) => {
    reached = true; res.writeHead(200); res.end('{}');
  });
  const r = await fetch(`http://127.0.0.1:${PROXY_PORT}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'content-encoding': 'br' },
    body: Buffer.from([0x1b, 0x00, 0x00, 0x00]),
  });
  expect(r.status).toBe(415);
  expect((await r.json()).error).toMatch(/content-encoding/i);
  expect(reached).toBe(false);                                // upstream never saw it
});
```

- [ ] **Step 2: Run it and watch it fail** — today it forwards and `reached` is `true`.

- [ ] **Step 3: Implement** a 415 with a body naming the offending encoding.

- [ ] **Step 4: Run it and watch it pass**

- [ ] **Step 5: Mutate** the refusal into a passthrough; confirm `reached` becomes `true` and the case reds. Restore.

- [ ] **Step 6: Commit**

---

### Task 8: effort precedence, and the single-slot `(path, mtime)` cache

**Files:**
- Modify: `ccd/ccgpt-proxy.py`
- Test: `server/test/ccgpt-proxy.test.ts`

**Precedence, unchanged from today:** an explicit client `output_config.effort`, else ccrc's per-model lane default from `~/.ccrc/models/<id>.effort.json`, else the provider default. The shim strips **both** `output_config` and `thinking` before forwarding, so nothing below it reinterprets effort independently.

The effort map is reloaded by `(path, mtime)` in a **single-slot** cache. One key, one value; the materialiser's tmp-then-rename write is what makes that sound.

- [ ] **Step 1: Write the failing test** — four cases:
  1. explicit `output_config.effort` wins over the lane default;
  2. with no explicit effort, the lane default from `~/.ccrc/models/codex-a.effort.json` is applied;
  3. `output_config` and `thinking` are absent from the forwarded body in every case;
  4. rewriting the effort file with a **new mtime** changes the applied default on the next request (the cache re-reads), and rewriting identical bytes at the same mtime does not.

- [ ] **Step 2: Run it and watch it fail**

- [ ] **Step 3: Implement** `_apply_effort` and the single-slot cache keyed on `(path, mtime)`.

- [ ] **Step 4: Run it and watch it pass**

- [ ] **Step 5: Mutate — two measurements**
  1. Reorder precedence so the lane default wins over an explicit request. Case 1 reds.
  2. Drop `mtime` from the cache key. Case 4 reds (a changed file is not re-read).
  Restore after each and record both.

- [ ] **Step 6: Commit**

---

### Task 9: streaming, tools and headers survive the port

**Files:**
- Modify: `ccd/ccgpt-proxy.py`
- Test: `server/test/ccgpt-proxy.test.ts`

**Spec §6.4 — what does not change:** SSE streaming relay, tool definitions and tool results, byte-identical forwarding of non-`/messages` paths, and the hop-by-hop header set.

- [ ] **Step 1: Write the failing tests**
  1. an SSE response streams through with its `data:` frames intact and is not buffered whole;
  2. a request carrying `tools` and a `tool_result` content block forwards with both intact;
  3. hop-by-hop headers (`connection`, `keep-alive`, `transfer-encoding`, `upgrade`, `proxy-authorization`, `te`, `trailer`) are dropped from the forwarded request, and end-to-end headers survive.

- [ ] **Step 2: Run and watch each fail**

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run and watch pass**

- [ ] **Step 5: Mutate** the hop-by-hop list to forward `connection`; confirm the header case reds. Restore.

- [ ] **Step 6: Commit**

---

### Task 10: `ccd/ccgpt-usage.py` publishes a limits row that `ccd` can read

**Files:**
- Create: `ccd/ccgpt-usage.py`
- Test: `server/test/ccgpt-usage.test.ts`

**Interfaces:**
- Consumes: `runPy`, `ccgptFile`, `PYSTUB_DIR` (Task 1); the `CCGPT_USAGE_ENDPOINT` loopback-only seam (Task 1's decision).
- Produces: writes `~/.cc-limits/<id>.json` atomically (tmp-then-rename).

**Reference:** `$OC/ccgpt-usage`. Read it before implementing — in particular its output-directory derivation (it already follows `HOME`, so the output assertions port unchanged) and its 429 handling.

**Five consumer-facing properties, each with its own case:**

| Property | Why it is load-bearing |
|---|---|
| written with `json.dump`'s **default separators** | `ccd`'s `_limit_json_num` greps with a pattern that tolerates whitespace after the colon *because* this producer writes `": "`. A compact writer makes `ccd` read the lane as entirely unknown. |
| `fiveResetAt` and `sevenResetAt` **present on every poll, null included** | `_limit_has_key` asks whether the keys exist at all; that presence is the only thing separating this row from the compact three-key 429 exclusion `ccd` writes itself. Omitting a null renders a weekly cap as a five-hour cooldown. |
| **absent ≠ zero** for the secondary-window minutes | `server/src/limits.ts` keeps `fiveWindowMinutes` only when present and reads explicit `0` as "no 5h window at all". Two readers share one rule and must not drift. |
| a **429 carrying the rate-limit headers is a valid measurement** | The publisher reads the headers off the error response and publishes, rather than treating the poll as failed. |
| the write is **atomic** | tmp-then-rename; a reader never sees a half-written row. |

**And one thing that changes:** the probe **model** comes from `~/.ccrc/codex/<id>/lane.json`, not a hard-coded id — a model frozen into a publisher is a second model policy. `lane.json` has **no writer until Plan 2b**, so this wave's behaviour is: read it if present; if absent, **refuse with a remedy naming the verb that will create it**. Pin the refusal. Do not invent a default.

**And one default that is removed:** the `CCGPT_ACCOUNT_ID` fallback to "the first lane". An unnamed lane is an **error**, not lane one.

- [ ] **Step 1: Write the failing test**

```ts
// server/test/ccgpt-usage.test.ts — shape of the first case
it('writes a limits row with json.dump default separators', () => {
  if (!pythonOrSkip()) return;
  const home = mkTmp('ccgpt-usage-sep-');
  // ... plant ~/.ccrc/codex/codex-a/lane.json, start a loopback endpoint that
  // answers with the rate-limit headers, point CCGPT_USAGE_ENDPOINT at it ...
  const r = runPy(ccgptFile('ccgpt-usage.py'), {
    home,
    env: { PYTHONPATH: PYSTUB_DIR, CCGPT_ACCOUNT_ID: 'codex-a', CCGPT_USAGE_ENDPOINT: endpoint },
  });
  expect(r.status).toBe(0);
  const raw = readFileSync(join(home, '.cc-limits', 'codex-a.json'), 'utf8');
  expect(raw).toMatch(/": /);            // the separator ccd's grep depends on
  expect(raw).not.toMatch(/":[^ ]/);     // never compact
});
```

Write one case per row of the table above, plus the two refusals (absent `lane.json`; unset `CCGPT_ACCOUNT_ID`) and one asserting `CCGPT_USAGE_ENDPOINT` is **ignored** when it is not loopback.

- [ ] **Step 2: Run and watch them fail** — the file does not exist.

- [ ] **Step 3: Implement the publisher**

- [ ] **Step 4: Run and watch them pass**

- [ ] **Step 5: Mutate — one per property, each restored**
  1. `json.dump(..., separators=(',', ':'))` → the separator case reds.
  2. Omit `fiveResetAt` when null → the presence case reds.
  3. Fold absent into zero → the absent-vs-zero case reds.
  4. Treat a 429 as a failed poll → the 429 case reds.
  5. Write directly instead of tmp-then-rename → the atomicity case reds.
  6. Restore the first-lane default → the unset-id refusal case reds.
  7. Honour a non-loopback `CCGPT_USAGE_ENDPOINT` → the loopback case reds.

  Record all seven before/after counts in the commit body. A green mutation needs a control: if any one does not red, say so rather than claiming it did.

- [ ] **Step 6: Check for residue, then commit**

---

### Task 11: the pinned default endpoint, and the seam's own guard

**Files:**
- Modify: `server/test/ccgpt-usage.test.ts`

**Why separate from Task 10.** The `CCGPT_USAGE_ENDPOINT` seam exists so a test can point the publisher at a loopback server. That is a production configuration surface, and it needs its own guard or it becomes an unpinned claim: nothing yet asserts that the **default** — what runs when the variable is unset — is the real production endpoint.

- [ ] **Step 1: Write the failing test** asserting that, with `CCGPT_USAGE_ENDPOINT` unset, the publisher's compiled-in default is the production URL, and that the override is refused for any non-loopback host (`http://example.com`, `https://127.0.0.1.evil.test`, a bare hostname).

- [ ] **Step 2: Run and watch it fail**

- [ ] **Step 3: Implement** the default assertion and tighten the loopback check to reject look-alike hosts.

- [ ] **Step 4: Run and watch it pass**

- [ ] **Step 5: Mutate** the loopback check to a substring test (`'127.0.0.1' in url`); the look-alike case must red. Restore.

- [ ] **Step 6: Commit**

---

### Task 12: the split bookkeeping, and one wave-1 sentence that may have gone false

**Files:**
- Modify: `docs/superpowers/plans/2026-09-21-gpt-lane-ownership-2a-request-path.md` (this file — the count table below)
- Possibly modify: `ccd/ccrc` **prose only**, and only if the re-read below shows the sentence is now false

**A. The count, measured on both sides.** §14 requires the split state its counts before and after, so a reviewer can check that a smaller green suite is still green. Fill this table by measurement, not recollection:

```bash
# ccrc side — how many cases the two new suites carry
cd "$REPO/server"
./node_modules/.bin/vitest run test/ccgpt-proxy.test.ts test/ccgpt-usage.test.ts --reporter=verbose | tail -5

# OpenClaw side — the population being split (read-only; nothing is edited there in this wave)
grep -c '    def test_' "$OC/test_ccgpt_proxy.py"
```

| Population | Before | After |
|---|---|---|
| OpenClaw `test_ccgpt_proxy.py` methods | 101 | unchanged this wave (101, measured Task 12) |
| ccrc `ccgpt-proxy.test.ts` cases | 0 | 83 |
| ccrc `ccgpt-usage.test.ts` cases | 0 | 31 (29 through Task 11 + 2 from Task 12 item E's accept-side loopback cases) |

**Nothing is deleted in the OpenClaw repository in this wave.** Its deletion is step 4 of the cutover, after a separately authorised rollout. Record the counts; do not act on them.

**B. Two stale pins, recorded for whoever does the OpenClaw side.** Two of that suite's cases positively pin `nohup "$LITELLM_BIN"` launch lines. Measured: that string occurs **zero** times in the installed launcher — they pin behaviour production replaced a lane-generation ago. Copied as-is they are red on arrival, or worse, green against a `ccd/ccgpt` someone shaped to satisfy them. **Plan 2b replaces them; this plan only records that they must be replaced, not copied.** One of the two also uses an unguarded `next(...)` over a generator, which raises `StopIteration` instead of failing with a message when its needle is absent — give the replacement an explicit assertion.

**C. Re-read the wave-1 refusal sentence.** Plan 1 shipped a refusal in `ccd/ccrc`'s `_acct_credential` saying reauthentication "is unavailable in this release and will use ccrc's Codex login flow once the runtime ships". Locate it and judge whether it is still true after this wave:

```bash
cd "$REPO" && grep -n 'codex lane' ccd/ccrc | head
```

This plan ships **no login flow and no runtime** — only the request path — so the sentence is expected to remain true, and the correct outcome is **no change plus a recorded judgement**. If it has gone false, amend the prose and the test that pins it in the same commit. Do not leave it unexamined: a prose pin against prose is green while both lie.

- [x] **Step 1: Measure the counts and fill the table**
- [x] **Step 2: Record B and C's judgements in the commit body**
- [x] **Step 3: Commit**

---

## Wave-close gate

After Task 12, before opening the PR:

- [ ] **Confirm the cut held — this plan must have touched none of these**

```bash
cd "$REPO"
git diff --name-only origin/main...HEAD | grep -E '^(ccd/ccd|ccd/ccrc|deploy/deploy\.sh|deploy/systemd/|server/test/installTreeFixture\.ts)' \
  && echo "SCOPE BREACH — stop and report" || echo "cut held"
```

`ccd/ccrc` appears only if Task 12C found the sentence false. Any other hit means the cut was wrong; stop and report rather than widening.

- [ ] **Fetch main, then run the cross-branch deviation guard**

```bash
cd "$REPO" && git fetch origin main
cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts
```

- [ ] **Run the FULL server suite as the bounded sequential shard union**

A whole `--shard=2/3` now runs ~630s — past the 600s foreground ceiling, where the tool detaches it and its tail is lost, which reads exactly like a red. Split that third:

```bash
cd "$REPO/server" && npm ci
for s in 1/3 3/6 4/6 5/6 6/6; do ./node_modules/.bin/vitest run --shard=$s || echo "RED in $s"; done
```

Run them **sequentially**, never in parallel: the timing cases red under concurrent load and clear in isolation. Re-run any known load flake (`ccd-ws-gc`, `pr-sweep`, `session-hook`, `typecheck-tests`, `ccd-session-state`, `ccd-bounded-reads`) **in isolation** before calling it a real break.

- [ ] **Run the agent and PWA suites, and typecheck**

```bash
cd "$REPO/agent" && npm ci && ./node_modules/.bin/vitest run
cd "$REPO/pwa"   && npm ci && ./node_modules/.bin/vitest run
cd "$REPO/server" && ./node_modules/.bin/tsc --noEmit
```

- [ ] **Prove no residue reached a tracked byte**

```bash
cd "$REPO"
git diff origin/main...HEAD -- ccd/ server/test/ | grep -nE '^\+.*[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}' \
  && echo "ADDRESS-SHAPED TOKEN ADDED — stop" || echo "clean"
cd server && ./node_modules/.bin/vitest run test/topology-clean.test.ts
```

- [ ] **Check the author identity, then push and open the PR**

```bash
cd "$REPO"
git config user.name; git config user.email    # must NOT be a placeholder
git push -u origin ws/gpt-lane-runtime
```

The PR body ends with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`, links the spec by its **GitHub blob URL** (never a docserver URL), carries Task 12's count table, and states plainly that this wave **places nothing, starts nothing and changes no box** — the two files ship in the release tarball and are referenced by no install line, exactly as `ccclip` is today.

**Do not deploy.** The spec's §15 sequence is: land → release → separately authorised cutover → OpenClaw deletion. This plan ends at "land".

## Self-review of this plan

**Spec coverage.** §6.1 both doors → Tasks 3–4. §6.2 effort and the single-slot cache → Task 8. §6.3 the two transport holes → Tasks 5–6, with §6.3's "silent arm is the hazard" as Task 7. §6.4 what does not change → Tasks 2 and 9. §10's five consumer properties and the probe-model change → Task 10. §14's per-method split and its counts → Task 12, and §14's "stale source-shape assertions are replaced, not copied" → Task 12B. §18's mutation rows owned by this wave — both folds *and their call site*, chunked, gzip, unsupported encoding, effort precedence and cache key, `json.dump` defaults, the always-present null reset keys, absent≠zero — each has a named mutation step. **Deliberately deferred:** every row about placement, units, the runtime probe, the role gate, unit properties and secrets-in-argv belongs to Plan 2b; `_check_codex`, the timer and per-lane `litellm.yaml` to Plan 3.

**Placeholder scan.** No "TBD" or "add error handling" step. Tasks 8, 9 and 10 describe their cases as enumerated lists rather than full code blocks — that is deliberate and bounded: each names the exact property, the exact mutation, and the reference file to read, and the code shape is established by the fully-written blocks in Tasks 1–7. Task 12's table is intentionally blank because it must be **measured**, and the step that measures it is written.

**Type consistency.** `pythonOrSkip`, `runPy`, `ccgptFile`, `PYSTUB_DIR` are spelled identically in Tasks 1, 2 and 10. `_fold_midturn_system` and `_fold_system` are spelled identically in Tasks 3 and 4, in that call order. `CCGPT_ACCOUNT_ID`, `CCGPT_PROXY_PORT`, `CCGPT_LITELLM_PORT` and `CCGPT_USAGE_ENDPOINT` are the only environment names this wave introduces.

**Two risks this plan cannot resolve, handed to the implementer explicitly.** First, `lane.json` has no writer until Plan 2b, so Task 10's probe-model path can only be tested via a planted fixture and an absent-file refusal — the plan says so and pins the refusal rather than pretending the happy path is covered. Second, the `CCGPT_USAGE_ENDPOINT` seam is a production surface added partly for testability; Task 11 exists precisely because that trade needs its own guard, and the loopback restriction is what keeps it from being a credential-redirection hazard. If a reviewer judges the seam unacceptable, the fallback is a stub HTTP layer injected through `PYTHONPATH` — more test machinery, no production surface — and that decision belongs in Task 1's review, before eleven cases are written against it.

## Deviations found

Numbers here were **issued** by `POST /api/ledger/deviations` and defined in the same act. Never invent one.

- **D-3150 — Task 1 Step 5's containment mutation was inert.** The step instructed the implementer to
  prove the closed fixture HOME by spreading `process.env` **before** `HOME`. Read literally that is
  `{ ...process.env, HOME: opts.home }`, in which the later explicit key wins — so the child still saw
  the fixture, the mutation could not go red, and it proved nothing. Measured by the implementer, then
  independently re-measured by the task reviewer across all five env orderings against a real
  interpreter. The order that actually leaks is `{ HOME: opts.home, ...process.env }`. The plan text
  was the defect; the substitution is what the step's own stated intent required. Wherever a later
  plan or brief repeats this idiom, the leaking order is the one that measures.

  A rider worth carrying: that mutation proves containment only for the **default** call. The task
  review then found (C1) that a caller supplying `opts.env` could revoke containment entirely, with no
  red anywhere — which is precisely the gap a mutation over one call shape cannot see. A mutation
  measures the axis it moves, and no other.

- **D-3151 — `ccgpt-proxy.py` carries three silent passthroughs on the `/messages`-suffixed rewrite
  path, deliberately, until Task 7.** The fact: `_rewrite_messages_body`'s `except (TypeError,
  ValueError, RecursionError)` arm, its own `not isinstance(data, dict)` arm, and
  `_fold_midturn_system`'s `not isinstance(msgs, list)` arm each return the body (or the unmodified
  `data`) unrewritten rather than refusing — three call sites, not one. Spec §6.3 forbids exactly this
  shape: a body carrying a system message, forwarded unexamined, is the sticky-replay hazard this whole
  task exists to close.

  Why accepted: gzip/deflate decoding lands in Task 6 and the explicit refusal for everything else lands
  in Task 7; until then, a body this shim cannot parse at all has to do *something*, and forwarding is
  what keeps the lane working in the meantime.

  Why safe today, measured (Task 3's fix-round review, against the real upstream LiteLLM parser rather
  than this shim's own behaviour): every body that reaches any of the three arms is a body the upstream
  parser also rejects — malformed JSON, truncated JSON, invalid UTF-8, and JSON nested past the
  decoder's own limit all come back as a 400 or a decode error from LiteLLM, not a processed request.
  The one body class the shim is silent on and upstream is not — a top-level JSON array — carries no
  `messages` key and cannot be routed as an Anthropic request by any downstream reader, so it cannot
  become the sticky replay hazard either. No body reaching these three arms today can realise the
  hazard, but the argument rests on a third-party parser's behaviour, which is an unpinned claim that
  can drift — this entry, and the corrected reasoning it now carries in the interim ruling, are what a
  later reader should trust over a memory of the earlier premise (chunked bodies do **not** reach these
  arms at all — `if body` is false first — that is a separate hole, and Task 5's to close).

  Who removes it: Task 7, which must **replace** these three arms with an explicit refusal rather than
  adding a fourth branch beside them. A grep for `return body` alone will not see the third arm (it
  returns `data`), so Task 7's wave-close check needs a behavioural case — an unparseable body carrying
  a `system`-shaped entry must leave the upstream recorder unhit — not a text scan for the current
  wording of the silent arms.

  **CLOSED by Task 7a (task-7a-rulings.md).** All three arms were replaced, not joined by a fourth: a new
  `_UnusableBody` exception (`ccd/ccgpt-proxy.py`, following `_BadEncoding`'s own precedent — raised
  where the condition is detected, caught once in `_relay`, turned into one explicit response) is now
  raised where each of the three used to `return`. Arms 1 and 2 (`_rewrite_messages_body`'s "not valid
  JSON at all" and "valid JSON, non-object top level") now raise it from the same `except`/`if` sites;
  arm 3 (`_fold_midturn_system`'s `not isinstance(msgs, list)`) raises it too. `_relay` catches
  `_UnusableBody` (and `_BadEncoding`) once and answers an HTTP 400 via the new `Handler._refuse` — the
  one refusal shape D-3153 unifies across the file. Closure evidence is behavioural, per this entry's own
  instruction: `server/test/ccgpt-proxy.test.ts` gained a dedicated case per arm (a deeply-nested body for
  arm 1, a bare top-level array for arm 2, a `messages` field that is a dict for arm 3), each asserting
  both the exact status/body **and** that the recording upstream handler was never reached — the
  behavioural proof a `grep` for `return body` could not have produced for arm 3. A regression case
  (non-`/messages` path, malformed JSON body) pins that the fix did not over-correct into refusing
  traffic this task was never chartered to touch.

- **D-3152 — Task 4's brief specified an unsatisfiable pair of requirements: an insert-only top-level
  `system` fold, plus a mutation proving call order is load-bearing.** The brief's Step 1 test asserted
  the top-level instruction and a converted mid-turn `system` entry as two SEPARATE messages —
  `messages[0]` carrying `TOP LEVEL`, `messages[1]` carrying `WAS MID TURN` — which only an
  unconditional `msgs.insert(0, …)` can produce. Step 5 then demanded a mutation swapping the call
  order (`_fold_system` before `_fold_midturn_system`) and required the order assertions to go red.

  Measurement (an independent agent, `task-4-commutativity.md` — D-3152, this entry — ten varied bodies against the real
  shipped file) showed these two requirements are **mutually unsatisfiable**: an unconditional insert
  makes `_fold_midturn_system` (an in-place, whole-list role flip) and `_fold_system` (a front-insert)
  commute regardless of call order — 10/10 inputs byte-identical under both orderings. No order mutation
  can ever bind against that shape.

  The implementer's first attempt discovered this empirically — ran the swap against an unconditional
  insert, observed no assertion redden, and reported it rather than claiming a red that was never
  observed. The first attempt's own resolution (a skip-loop stepping over still-unconverted leading
  `role: "system"` entries to manufacture order-sensitivity) was ALSO wrong: measured dead on the
  documented call path (advance count 0 across all ten inputs; confirmed live by advancing 3 times when
  called in the reversed order directly), i.e. correct-but-unreachable code kept alive only to satisfy a
  mutation the plan demanded.

  The resolution: adopt the production reference's own hybrid `_fold_system` — MERGE the folded
  top-level text into an existing leading `role: "user"` message when there is one, otherwise INSERT a
  new one (matches spec §6.1 item 2, "folds into the leading user turn"). This makes the ordering
  genuinely load-bearing with no dead code: mid-turn-first converts a leading `system` entry to `user`
  before `_fold_system` runs, so the merge branch fires and the top-level text lands first inside that
  turn; reversed, `messages[0].role` is still `"system"`, the merge branch's check is false, and the
  insert branch fires instead — a structurally different forwarded body, measured to diverge on the same
  three of ten inputs (all with a leading mid-turn `system` entry) that the insert-only variant could
  never distinguish. It also avoids an untestable risk this suite cannot measure: unconditional insert
  can leave two consecutive `user` messages where production sends one, and whether the Responses
  translation on the real Codex backend tolerates that has no answer in a suite with no Codex backend to
  ask — production already answers it, and the answer is merge-when-possible.

  Transferable lesson: **a plan that demands a mutation must first be sure the behaviour it names can
  actually differ under the implementation the plan itself specifies** — otherwise the only paths through
  are a false claim of a red never observed, or manufactured dead code kept alive solely to satisfy the
  mutation, which is what this task's first attempt produced and flagged rather than shipped quietly.

- **D-3153 — Task 6 shipped a refusal shape its brief never specified, unreported, and it contradicts
  the shape Task 7's brief prescribes for the sibling condition.** Task 6's brief asks for exactly two
  things: decode/re-encode `gzip` and `deflate`, and one mutation. The implementer additionally shipped
  `_BadEncoding`, a `send_error(400, …)` arm in `_relay`, and two tests for it — a defensible addition,
  consistent with spec §6.3's "the hazard is the silent arm, not the encoding", and argued at length in
  `_decode_body`'s docstring. It then died on a model spend limit mid-`tsc --noEmit`, leaving the work
  uncommitted and writing no report, so the addition was never declared and no number was issued for it
  at the time. The controller verified and committed the abandoned diff; this entry is the declaration
  that was owed.

  Why it matters beyond bookkeeping: the two refusals disagree on the wire. Task 6 answers
  `400` with an HTML body and the exception text in the **status-line reason phrase**
  (measured: `HTTP/1.1 400 ccgpt-proxy: invalid gzip body: …`, `Content-Type: text/html;charset=utf-8`),
  while Task 7's brief prescribes `415` with a JSON body (`expect((await r.json()).error)`). Implemented
  as written, one function would end the wave answering two incompatible shapes for one problem class —
  "I cannot use this body" — and no client could parse both uniformly. Task 6's own assertions are a
  bare `400 ≤ status < 500` range with no body check, so nothing would have gone red when it happened.

  The resolution, ruled by the controller and carried into Task 7: **one refusal shape for the whole
  file.** A single helper emits `{"error": …}` as `application/json`; `415` means "this shim does not
  implement that content-encoding", `400` means "what you sent is malformed" — and Task 6's existing
  arm is retrofitted to it rather than left as a second dialect. Each refusal case pins its exact status
  code, replacing the range assertions that made the divergence invisible.

  Transferable lesson: an addition beyond the brief is not the defect — Task 6's was the right call and
  closed a carry-forward. **The defect is an addition that pre-empts a decision another task was
  chartered to make, without saying so.** A worker that widens its own scope owes the declaration in the
  same act, and a worker that dies before reporting leaves its controller to reconstruct what it chose
  and why — which is only possible when the code argues for itself, as this one's docstrings did.

- **D-3154 — raw-deflate (RFC 1951) request bodies are now refused rather than forwarded; the fallback
  is declined deliberately.** `zlib.decompress(body)` accepts only the zlib-wrapped RFC 1950 form, so a
  `Content-Encoding: deflate` body in the raw form now earns an explicit refusal (measured:
  `400 … invalid deflate body: Error -3 … incorrect header check`). Before Task 6 the same body was
  forwarded unrewritten through a D-3151 arm. `deflate` is famously ambiguous in the wild and the usual
  remedy is a `zlib.decompress(body, -zlib.MAX_WBITS)` fallback.

  Declined, on two grounds. First, the fallback needs a matching re-encode decision — `_encode_body`
  emits the wrapped form, so a raw-in/wrapped-out round trip changes the encoding the forwarded
  `Content-Encoding` header describes, and the alternative is remembering which form arrived. Second,
  and deciding: **this shim's only client is Claude Code**, whose request bodies are plain JSON; the
  whole gzip/deflate path is defensive. An explicit refusal that names the encoding is strictly better
  than a silent forward here, because if a real client ever does send raw deflate we will be told,
  rather than discovering it as a sticky replay failure. Revisit only with a measured client that sends
  it. Cost if wrong: one refused request, named at the wire, instead of one silently-unfolded body.

- **D-3155 — the request read path accepts an unbounded declared chunk size and an unbounded
  decompressed size; both caps are deferred, accepted open.** `_read_chunked_body` honours whatever
  chunk-size the client declares, and `_decode_body` hands a body to `gzip.decompress`/
  `zlib.decompress` with no output ceiling, so a ~1 KB compression bomb expands unbounded in the
  handler's memory. `readline()` on the chunk-size and trailer lines is bounded by Task 7b
  (`readline(65537)`, the bound `BaseHTTPRequestHandler.handle_one_request` uses for the same hazard)
  and the handler gains a socket timeout there; the two SIZE caps are what this entry holds open.

  Why deferred rather than fixed: both need a number, and picking one wrong breaks the lane in the
  direction that matters. Claude Code sends whole conversations, which grow without a documented
  ceiling, and a cap below the largest real body turns a working lane into a refusing one — the exact
  failure this wave's over-correction guard exists to prevent. Picking that number is a measurement of
  real traffic, not a guess available to this wave.

  Why it is tolerable meanwhile: the listener binds `127.0.0.1` only, on a single-user box, and its
  only client is the local Claude Code process — an attacker who can send it a bomb can already run
  code as that user. This is a robustness ceiling, not an exposed attack surface. Revisit if the lane
  ever binds anything but loopback, at which point it stops being deferrable.

- **D-3156 — the top-level `system` fold prepends its text AHEAD of a leading `tool_result` block, and
  that is accepted.** Measured in Task 9, which was told to measure and report rather than fix: with
  `system: "be concise"` and `messages[0]` a `user` turn whose content list begins with a `tool_result`
  block, the forwarded body comes back with `content[0]` the folded system text and `content[1]` the
  original `tool_result`. D-3152's hybrid fold is what puts the text in that turn at all — it MERGES
  into a leading `user` turn rather than inserting a new one — and the merge prepends.

  Why this is worth a number: the Anthropic API requires `tool_result` blocks to come **first** in a
  user message, so on the Anthropic wire this shape is ill-formed. Nothing in this repo reads it as
  Anthropic and neither spec mentions the constraint, so a future reader measuring the shim against
  Anthropic's own rules would reasonably file it as a bug. This entry is the answer they should find.

  **Why it is accepted rather than fixed**, in order of weight. This ordering was corrected after the
  Task 9 review audited the entry's first draft; what the draft ranked first was the weakest clause in
  it, and the correction is recorded here rather than silently applied because the draft's own argument
  is the thing a later reader would otherwise inherit.

  1. **A well-formed `messages` array cannot begin with a `tool_result` at all.** The constraint is a
     property of the wire, not an assumption about any client: a `tool_result` block must reference a
     `tool_use` that appears EARLIER in the same array, so a `tool_result` at `messages[0]` has nothing
     to refer to and is already ill-formed before this shim touches it. The shape the fold mishandles is
     one that cannot legitimately arrive.
  2. **The alternative placements are each worse for a stated reason.** Two repairs exist, and the entry
     names both because the first draft named only the risky one and so read as though no cheap repair
     existed:
     - *Insert a new leading `user` turn instead of merging.* Rejected: it reintroduces the
       two-consecutive-`user`-messages question D-3152 measured as **untestable in this suite** — there
       is no Codex backend in it — and resolved by deferring to production.
     - *Keep the merge, but place the text AFTER the leading `tool_result` run.* This is cheap and
       creates no consecutive user messages, so it is the repair a reader will reach for. It is
       rejected on D-3152's own stated intent: the fold exists so the top-level instruction **reads
       first**, and text placed after a tool-result run no longer does. That is a real reason, but it is
       a weaker one than (1), and if (1) ever stops holding this is the repair to take.
  3. **D-3152 does not source the prepend to production, and this entry must not pretend it does.** What
     D-3152 established as production's behaviour is the **branch choice** — merge into a leading `user`
     turn versus insert a new one. It says nothing about where within that turn the text lands, and no
     production reference exists in this tree to check the intra-turn ordering against. So the prepend is
     **this shim's own implementation of the merge**, not an inherited behaviour, and the migration
     argument that carries so much weight elsewhere in this plan does not reach it.

  What would reopen it — and the likeliest trigger is not the one the first draft named. It is not a
  conversation that *opens* with a tool result; it is an array that begins with a `tool_result` because
  earlier turns were **dropped** — history truncation, or a compaction that cuts between a `tool_use`
  and its result. Such an array is ill-formed on the Anthropic wire for the same reason as (1), so the
  shim would not be the only thing objecting, but it is the path by which the shape actually reaches a
  request. Also reopening: a LiteLLM version whose Anthropic adapter validates block ordering and
  rejects it. Either makes this a live defect, and the remedy is then (2)'s second repair, with the
  production reference consulted on intra-turn placement first.

- **D-3157 — `runPy` cannot be used with a same-process mock server, and this plan's own Task 10 example
  deadlocks because of it.** `runPy` is built on `spawnSync`, which blocks Node's entire event loop for
  the child's lifetime. A test that starts a `node:http` mock in the same process and then calls `runPy`
  can never answer the child: the server's accept callback cannot run until `spawnSync` returns, and
  `spawnSync` cannot return until the child — which is waiting on that server — exits. Measured by Task
  10's implementer, not inferred: a first draft written to the plan's own Step 1 shape **timed out on
  5 of 10 cases**.

  The plan's Task 10 Step 1 code block is therefore unrunnable as written. It is the same class as
  D-3150 and D-3152 — plan text that specifies something the implementation cannot satisfy — and the
  third instance in this plan, which is worth saying plainly: **illustrative code in a brief is
  untested code, and an implementer meeting it should expect to measure it rather than transcribe it.**

  The resolution: `runPyAsync`, built on the harness's existing async `spawnPy` so it inherits the same
  `HOME` containment guards, awaiting the child's `close` while the event loop stays free to serve the
  mock. Task 10 wrote it locally; it is hoisted into `server/test/ccgptHarness.ts` beside `runPy` and
  `spawnPy` in that task's fix round.

  *(Two corrections to this entry's first draft, from the Task 10 review, because the argument it gave
  for the hoist was partly wrong.)* `runPy` declares **no named outcome type** — it writes the same
  literal inline — so "share `runPy`'s declared type" describes something that does not exist, and the
  hoist needs an **extraction** step first. And the claim that a second inline declaration is "exactly
  what this repo's single-definition rule exists to stop" is **false**: that guard's roots exclude
  `server/test` and it scans named enumerations only, so it would never have fired. The real argument is
  stronger than the one it replaces: **`ccgpt-harness.test.ts` pins containment per exported helper**, so
  a hoisted `runPyAsync` inherits that table automatically, while a local copy has no containment case at
  all — and containment is the single guard standing between this suite and the live limits registry.

  `runPy` itself stays: it is correct and simpler for the many cases that need no server, and its
  docstring now carries the limitation so the next author does not rediscover it by timeout.

  **A second face of the same trap, found in Task 10's fix round and worth stating separately because it
  is invisible until you mutate:** a case may use `runPy` safely while the code is CORRECT — because the
  publisher refuses before it ever contacts the mock — and then deadlock under the very mutation that
  removes that refusal. The mutation makes the child reach the server, the server cannot answer, and the
  result reads as a TIMEOUT rather than as the red the mutation was supposed to produce. So a
  `spawnSync`-based case can pass its own mutation table by accident and report a guard as unpinned when
  it is pinned, or as pinned when it merely hung. Three such cases were switched to `runPyAsync`. The
  rule that follows: **if a case's mutation would make the child talk to a server, the case needs the
  async runner even if the unmutated code never does.**

- **D-3158 — `lane.json`'s probe-model field name was chosen by an implementer, with no authority to
  check it against, and Plan 2b's writer must honour it.** The spec says the probe model comes from
  `~/.ccrc/codex/<id>/lane.json` and that the file is written by the same materialiser that writes the
  lane's model files (`deploy/models-op.mjs`), but **names no field**. `lane.json` has no writer at all
  until Plan 2b, so there was nothing in the tree to read the name off.

  Task 10 chose **`probeModel`** and flagged the choice rather than presenting it as derived. Recorded
  because the consequence is cross-plan: **Plan 2b's materialiser must emit exactly this key**, and a
  mismatch would be invisible to every test in this wave — Task 10's reader is pinned against a planted
  fixture that this same task wrote, so fixture and reader would agree with each other while disagreeing
  with the only real producer.

  What to do at Plan 2b: make the materialiser and this reader derive the name from one place, or, if
  that is impractical across a JS writer and a Python reader, pin the spelling in both and add a case
  that reads a fixture generated BY the materialiser rather than hand-written — `server/test/fixtures/
  rollover.ts` is the in-repo precedent for a fixture produced by its real writer. Until then this entry
  is the only thing recording that the key is a choice rather than a contract.

  *(Two additions from the Task 10 review, both of which make the entry worse reading than its first
  draft admitted.)* First, the consequence of a mismatch is not merely "the probe model is missing": the
  publisher **refuses with a remedy telling the operator to run `ccrc doctor --fix`**, and that verb
  re-renders `lane.json` with the same wrong key — **a remedy that provably cannot work**, looping the
  operator through a fix that restores the fault. Second, the gap is wider than the NAME: the review
  measured that hard-coding the probe model into the publisher leaves the suite entirely green, so
  nothing asserts the value read from `lane.json` is used at all. Plan 2b inherits both; the second is
  closed in Task 10's own fix round.

- **D-3159 — the spec's stated REASON for the `json.dump` separator rule is measurably false; the rule is
  kept for a different reason.** Spec §6 said `ccd`'s `_limit_json_num` tolerates whitespace after the
  colon *because* this producer writes `": "`, and that a compact writer had once cost ccd the ability to
  read a lane at all. Measured against the real predicates by Task 10's reviewer:

      grep -oE "\\"five\\"[[:space:]]*:[[:space:]]*[0-9]+" compact.json  -> 17
      grep -q  "\\"fiveResetAt\\"[[:space:]]*:"            compact.json  -> YES

  Both `_limit_json_num` and `_limit_has_key` match with `[[:space:]]*` — **zero** or more — so a compact
  row reads key-for-key identically to a spaced one, and `server/src/limits.ts` uses `JSON.parse` and is
  separator-agnostic by construction. The historical defect ccd's own comment records ran the OTHER way: a
  compact *pattern* against a spaced *file*.

  The claim reached three shipped comments in Task 10 before it was caught, because it came from the spec
  and the plan's own table rather than from a measurement. **The property is kept** — it matches the
  reference producer byte-for-byte and holds the producer stable for a stricter future reader, and it costs
  nothing — but every statement of the reason is corrected to that, in the spec, in `ccd/ccgpt-usage.py`
  and in its test.

  The transferable lesson, and the reason this is a numbered deviation rather than a quiet edit: **a
  dependency claim about a consumer is a measurement, and an unmeasured one propagates at the speed of
  copy-paste.** Two sibling claims in the same table — `_limit_has_key`'s presence test and
  `limits.ts`'s absent-versus-zero rule — were measured by the same reviewer and both HOLD, which is
  exactly why the false one was worth finding: the table's other rows earned their trust.

- **D-3160 — `ChatGPT-Account-Id` is dropped from the usage probe, because deriving it requires reading
  an OAuth file's contents.** The production reference sends five request headers beyond
  `content-type`/`accept`: `Authorization`, `originator`, `user-agent`, `session_id` and
  `ChatGPT-Account-Id`. Task 10's port dropped all but `Authorization`; its fix round restored the three
  constants (Task 10 review C-2), and this entry records the fifth, which is not a constant.

  The reference derives it by reading `auth.json`'s **contents**, and spec line 497 forbids exactly that:
  *"Nothing in ccrc — doctor, installer, publisher, probe or test — ever reads the contents of an OAuth
  file. Existence and mode only."* So the header cannot be restored the way the reference obtains it, and
  `lane.json` — the one file the publisher is allowed to read for per-lane facts — does not carry an
  account id and is not specified to.

  **The gap this leaves, stated rather than papered over:** a ChatGPT token valid across more than one
  workspace cannot be disambiguated by this publisher. Which workspace's usage the backend reports is
  then the backend's choice, not ccrc's, and a lane whose token spans workspaces could publish a row
  describing a window the operator is not actually spending against. Nothing in this repo can detect
  that today — the row looks ordinary.

  Accepted for this wave because the alternative is worse: restoring the header means reading OAuth
  contents, which is a rule this project holds deliberately and which no telemetry convenience should
  buy out.

  **The remedy this entry first named was wrong, and the Task 10 re-review refuted it.** It said
  `lane.json` should gain a non-secret account id "written by Plan 2b's materialiser, which already
  knows the lane's identity without reading any credential". That equivocates on *identity*: the
  materialiser knows **ccrc's** lane id — the roster id, which spec line 698 confirms is what a lane's
  identity means here — while the header needs the **ChatGPT backend's** `account_id`, which exists
  only inside `auth.json`. So that remedy resolves to committing the same spec-497 violation one layer
  up, and it contradicts `_fetch_headers`' own docstring.

  **The remedy that actually works is operator-supplied, not derived:** a field on the account's roster
  entry in `~/.ccrc/accounts.json`, which is runtime DATA the operator already maintains (see
  `shared/roster.ts`). Nothing reads a credential — the operator writes the workspace id they already
  know, the materialiser copies it into `lane.json`, and the publisher sends it. Take that if a
  multi-workspace token ever appears on a real lane; until one does, the gap above is the honest state.
  See also **D-3161**, which records that the rule this entry rests on is already broken elsewhere in
  the tree — that is an argument for fixing the other violation, not for adding a second.


- **D-3161 — spec line 497's "never reads the contents of an OAuth file" is already violated by a
  shipped ccrc file.** The rule reads: *"Nothing in ccrc — doctor, installer, publisher, probe or test —
  ever reads the contents of an OAuth file. Existence and mode only."* It names **probe** explicitly.
  `ccd/ccrc-models-probe` does exactly that:

      account_id = json.load(open(os.path.join(token_dir, "auth.json"))).get("account_id", "")

  Found by the Task 10 re-review while auditing D-3160, which rests on that same rule. Not introduced by
  this wave — the line predates Plan 2a — but Task 10's fix round added a comment six lines below the
  call that *names the conflict in passing* while recording it nowhere, which is how a known violation
  becomes an unknown one.

  Recorded, not fixed, and deliberately so: `ccd/ccrc-models-probe` is outside Plan 2a's scope (this plan
  ships two Python files and touches that one only to keep a comment true), and the fix is not a
  one-liner — the probe needs the `account_id` for the same reason the publisher would, so removing the
  read means answering the same question D-3160 answers, in a file this plan does not own.

  **What this does NOT do is weaken D-3160.** A rule broken in one place is an argument for repairing
  that place, not for breaking it in a second — and the publisher is the file with the better
  alternative available, since D-3160's roster-field remedy would serve the probe too. The right
  sequence is: adopt the roster field, then retire this read. Until then the tree contains one measured
  violation and one documented abstention, and this entry is what stops the first from being cited as
  precedent for undoing the second.
