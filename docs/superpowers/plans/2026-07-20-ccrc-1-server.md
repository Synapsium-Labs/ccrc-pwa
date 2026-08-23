# ccrc Plan 1/3 — Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `ccrc-server` — the Node/TypeScript process on the <server-host> box that reads the ccd fleet's files, streams transcripts and dialogs over WebSockets, and drives sessions via tmux/ccd.

**Architecture:** One Fastify process, one port: REST + WebSockets + (later) static PWA. No database — the filesystem is the state. Every filesystem/exec dependency is injected (config `home` override + `Runner` interface) so the whole server is unit-testable on the Mac against fixtures; the real box is only needed in Plan 3.

**Tech Stack:** Node ≥22, TypeScript strict ESM, Fastify 5, @fastify/websocket, @fastify/static, @fastify/multipart, node-pty, vitest.

**Spec:** `docs/superpowers/specs/2026-07-20-ccrc-remote-control-app-design.md`

## Global Constraints

- Working dir for all tasks: `infra/ccrc/server` (paths below relative to repo root).
- Node ≥22, `"type": "module"`, TypeScript `strict: true`. Tests: vitest.
- Wrapper → config dir map (from `ccd _cfg_dir`): `claude`→`~/.claude`, `claude2`→`~/.claude-personal`, `claude-corp`→`~/.claude-corp`, `gpt`→`~/.claude-gpt`.
- Munge rule (from `ccd cmd_swap`): replace every `/`, `.`, `_` in a path with `-`.
- Registry: flat files `~/.cc-sessions/<id>.<field>`; sessions enumerated via `*.uuid`; known fields `wrapper project workdir uuid started home pool lastswap`.
- Limits files `~/.cc-limits/<wrapper>.json`: `{"five":INT,"seven":INT,"ts":EPOCH_SECONDS}`. Decay (from `ccd _limit_field`): `five`→0 when `now-ts > 18000`; `seven`→0 when `now-ts > 604800`.
- Live state `<configdir>/sessions/<panePid>.json`: `{pid,sessionId,cwd,name,status,"statusUpdatedAt":EPOCH_MS,...}`; `status` is `"busy"`/`"idle"`.
- tmux session name = `cc-<id>`. Busy marker in pane: `esc to interrupt`. Input prompt marker: line starting `❯ `. Menu footer marker: regex `/Enter to (confirm|select)/`.
- Server binds `CCRC_HOST` (default `127.0.0.1`; box uses `203.0.113.7`) — **never** `0.0.0.0`. Port `CCRC_PORT` default `7788`.
- Commit after every task: `feat(ccrc): <what>`.
- Never call `ccd`/`tmux` directly in logic modules — always through the injected `Runner`.

## File Structure

```
infra/ccrc/
  shared/api.ts            — types shared with the PWA (single source of truth)
  server/
    package.json tsconfig.json vitest.config.ts
    src/
      config.ts            — CcrcConfig + loadConfig(env)
      munge.ts             — mungePath()
      exec.ts              — Runner interface + realRunner + tmux helpers
      registry.ts          — readRegistry()
      limits.ts            — readLimits() with decay
      livestate.ts         — panePid() + readLiveState()
      fleet.ts             — assembleFleet()
      transcript/resolve.ts— transcriptPath()
      transcript/parse.ts  — parseTranscriptLine()
      transcript/tail.ts   — readBacklog() + TranscriptTailer
      pane/dialog.ts       — parseDialog()
      inject/queue.ts      — KeyedQueue
      inject/send.ts       — sendPrompt() / answerDialog() / interrupt()
      lifecycle.ts         — ccd wrappers + listProjects()
      clip.ts              — saveUploadAndClip()
      bus.ts               — typed EventEmitter singleton
      watch.ts             — FleetWatcher (poll loop → bus)
      sessionws.ts         — per-session WS stream logic
      pty.ts               — drawer PTY bridge
      server.ts            — buildServer(cfg, deps) route wiring
      index.ts             — entrypoint
    test/                  — *.test.ts + test/fixtures/**
  deploy/
    ccrc.service notify.sh deploy.sh   (Task 17; executed in Plan 3)
```

---

### Task 1: Scaffold + health route

**Files:**
- Create: `infra/ccrc/server/package.json`, `infra/ccrc/server/tsconfig.json`, `infra/ccrc/server/vitest.config.ts`, `infra/ccrc/server/src/server.ts`, `infra/ccrc/server/src/index.ts`
- Test: `infra/ccrc/server/test/health.test.ts`

**Interfaces:**
- Produces: `buildServer(): Promise<FastifyInstance>` (extended with `(cfg, deps)` in later tasks); npm scripts `test`, `build`, `dev`.

- [ ] **Step 1: Scaffold the package**

```bash
mkdir -p infra/ccrc/server/src infra/ccrc/server/test infra/ccrc/shared
cd infra/ccrc/server
npm init -y
npm i fastify @fastify/websocket @fastify/static @fastify/multipart ws
npm i -D typescript vitest tsx @types/node @types/ws
npm i node-pty
```

Edit `package.json` — set:

```json
{
  "name": "ccrc-server",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx src/index.ts",
    "build": "tsc",
    "test": "vitest run"
  }
}
```

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022", "module": "NodeNext", "moduleResolution": "NodeNext",
    "strict": true, "outDir": "dist", "rootDir": "..", "skipLibCheck": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*.ts", "../shared/**/*.ts"]
}
```

`vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['test/**/*.test.ts'] } });
```

- [ ] **Step 2: Write the failing test**

`test/health.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildServer } from '../src/server.js';

describe('health', () => {
  it('GET /health returns ok', async () => {
    const app = await buildServer();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    await app.close();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run` — Expected: FAIL (cannot find `../src/server.js`).

- [ ] **Step 4: Minimal implementation**

`src/server.ts`:

```ts
import Fastify, { type FastifyInstance } from 'fastify';

export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.get('/health', async () => ({ ok: true }));
  return app;
}
```

`src/index.ts`:

```ts
import { buildServer } from './server.js';

const app = await buildServer();
const host = process.env.CCRC_HOST ?? '127.0.0.1';
const port = Number(process.env.CCRC_PORT ?? 7788);
await app.listen({ host, port });
console.log(`ccrc-server on ${host}:${port}`);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run` — Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add infra/ccrc && git commit -m "feat(ccrc): scaffold server with health route"
```

---

### Task 2: Config + munge

**Files:**
- Create: `infra/ccrc/server/src/config.ts`, `infra/ccrc/server/src/munge.ts`
- Test: `infra/ccrc/server/test/config.test.ts`

**Interfaces:**
- Produces:
  - `interface CcrcConfig { host: string; port: number; home: string; registryDir: string; limitsDir: string; clipsDir: string; uploadsDir: string; ccdBin: string; projectsRoot: string; wrappers: Record<string, string> }`
  - `loadConfig(env?: NodeJS.ProcessEnv): CcrcConfig`
  - `mungePath(p: string): string`

- [ ] **Step 1: Write the failing test**

`test/config.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config.js';
import { mungePath } from '../src/munge.js';

describe('loadConfig', () => {
  it('derives all paths from CCRC_HOME', () => {
    const cfg = loadConfig({ CCRC_HOME: '/fake/home' });
    expect(cfg.registryDir).toBe('/fake/home/.cc-sessions');
    expect(cfg.limitsDir).toBe('/fake/home/.cc-limits');
    expect(cfg.ccdBin).toBe('/fake/home/.local/bin/ccd');
    expect(cfg.wrappers['claude2']).toBe('/fake/home/.claude-personal');
    expect(cfg.wrappers['gpt']).toBe('/fake/home/.claude-gpt');
    expect(cfg.host).toBe('127.0.0.1');
    expect(cfg.port).toBe(7788);
  });
  it('honours env overrides', () => {
    const cfg = loadConfig({ CCRC_HOME: '/h', CCRC_HOST: '203.0.113.7', CCRC_PORT: '9000', CCRC_PROJECTS_ROOT: '/data/projects' });
    expect(cfg.host).toBe('203.0.113.7');
    expect(cfg.port).toBe(9000);
    expect(cfg.projectsRoot).toBe('/data/projects');
  });
});

describe('mungePath', () => {
  it('replaces / . _ with - (ccd cmd_swap rule)', () => {
    expect(mungePath('/data/projects/acme-platform-ts')).toBe('-data-projects-acme-platform-ts');
    expect(mungePath('/data/projects/foo/.claude/worktrees/ui')).toBe('-data-projects-foo--claude-worktrees-ui');
    expect(mungePath('/a/b_c.d')).toBe('-a-b-c-d');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/config.test.ts` — Expected: FAIL (modules missing).

- [ ] **Step 3: Implement**

`src/munge.ts`:

```ts
export const mungePath = (p: string): string => p.replace(/[/._]/g, '-');
```

`src/config.ts`:

```ts
import os from 'node:os';
import path from 'node:path';

export interface CcrcConfig {
  host: string;
  port: number;
  home: string;
  registryDir: string;
  limitsDir: string;
  clipsDir: string;
  uploadsDir: string;
  ccdBin: string;
  projectsRoot: string;
  wrappers: Record<string, string>;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): CcrcConfig {
  const home = env.CCRC_HOME ?? os.homedir();
  return {
    host: env.CCRC_HOST ?? '127.0.0.1',
    port: Number(env.CCRC_PORT ?? 7788),
    home,
    registryDir: path.join(home, '.cc-sessions'),
    limitsDir: path.join(home, '.cc-limits'),
    clipsDir: path.join(home, '.cc-clips'),
    uploadsDir: path.join(home, '.cc-clips', 'uploads'),
    ccdBin: path.join(home, '.local', 'bin', 'ccd'),
    projectsRoot: env.CCRC_PROJECTS_ROOT ?? '/data/projects',
    wrappers: {
      claude: path.join(home, '.claude'),
      claude2: path.join(home, '.claude-personal'),
      'claude-corp': path.join(home, '.claude-corp'),
      gpt: path.join(home, '.claude-gpt'),
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/config.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(ccrc): config loading and ccd munge rule"
```

---

### Task 3: Runner + tmux helpers

**Files:**
- Create: `infra/ccrc/server/src/exec.ts`
- Test: `infra/ccrc/server/test/exec.test.ts`

**Interfaces:**
- Produces:
  - `interface ExecResult { code: number; stdout: string; stderr: string }`
  - `type Runner = (cmd: string, args: string[]) => Promise<ExecResult>` — resolves (never rejects) with `code: 127`-style failures encoded in the result.
  - `realRunner: Runner`
  - `class Tmux { constructor(run: Runner); hasSession(id): Promise<boolean>; panePid(id): Promise<number | null>; capture(id): Promise<string | null>; sendLiteral(id, text): Promise<boolean>; sendKey(id, key): Promise<boolean> }` — all take the ccd session id (not the tmux name); tmux target is `cc-<id>`.

- [ ] **Step 1: Write the failing test** (fake runner records calls)

`test/exec.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { Tmux, type Runner, type ExecResult } from '../src/exec.js';

const fake = (responses: Record<string, ExecResult>): { run: Runner; calls: string[][] } => {
  const calls: string[][] = [];
  const run: Runner = async (cmd, args) => {
    calls.push([cmd, ...args]);
    return responses[args[0]] ?? { code: 0, stdout: '', stderr: '' };
  };
  return { run, calls };
};

describe('Tmux', () => {
  it('hasSession true on code 0, false otherwise', async () => {
    const ok = new Tmux(fake({ 'has-session': { code: 0, stdout: '', stderr: '' } }).run);
    expect(await ok.hasSession('claude2-MekWarLive')).toBe(true);
    const no = new Tmux(fake({ 'has-session': { code: 1, stdout: '', stderr: '' } }).run);
    expect(await no.hasSession('claude2-MekWarLive')).toBe(false);
  });
  it('panePid parses first pane pid', async () => {
    const t = new Tmux(fake({ 'list-panes': { code: 0, stdout: '40613\n', stderr: '' } }).run);
    expect(await t.panePid('x')).toBe(40613);
  });
  it('targets cc-<id> and sends literals with -l', async () => {
    const f = fake({});
    await new Tmux(f.run).sendLiteral('myid', 'hello');
    expect(f.calls[0]).toEqual(['tmux', 'send-keys', '-t', 'cc-myid', '-l', 'hello']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/exec.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement**

`src/exec.ts`:

```ts
import { execFile } from 'node:child_process';

export interface ExecResult { code: number; stdout: string; stderr: string }
export type Runner = (cmd: string, args: string[]) => Promise<ExecResult>;

export const realRunner: Runner = (cmd, args) =>
  new Promise((resolve) => {
    execFile(cmd, args, { maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      const code = err ? ((err as NodeJS.ErrnoException & { code?: number }).code as number | undefined ?? 1) : 0;
      resolve({ code: typeof code === 'number' ? code : 1, stdout: String(stdout), stderr: String(stderr) });
    });
  });

const target = (id: string) => `cc-${id}`;

export class Tmux {
  constructor(private run: Runner) {}
  async hasSession(id: string): Promise<boolean> {
    return (await this.run('tmux', ['has-session', '-t', target(id)])).code === 0;
  }
  async panePid(id: string): Promise<number | null> {
    const r = await this.run('tmux', ['list-panes', '-t', target(id), '-F', '#{pane_pid}']);
    if (r.code !== 0) return null;
    const pid = parseInt(r.stdout.trim().split('\n')[0] ?? '', 10);
    return Number.isFinite(pid) ? pid : null;
  }
  async capture(id: string): Promise<string | null> {
    const r = await this.run('tmux', ['capture-pane', '-t', target(id), '-p']);
    return r.code === 0 ? r.stdout : null;
  }
  async sendLiteral(id: string, text: string): Promise<boolean> {
    return (await this.run('tmux', ['send-keys', '-t', target(id), '-l', text])).code === 0;
  }
  async sendKey(id: string, key: string): Promise<boolean> {
    return (await this.run('tmux', ['send-keys', '-t', target(id), key])).code === 0;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/exec.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(ccrc): injectable runner and tmux helpers"
```

---

### Task 4: Registry reader

**Files:**
- Create: `infra/ccrc/server/src/registry.ts`
- Test: `infra/ccrc/server/test/registry.test.ts` (+ fixtures written by the test into a temp dir)

**Interfaces:**
- Produces:
  - `interface SessionRecord { id: string; wrapper: string; project: string; workdir: string; uuid: string; started: boolean; home: string | null; pool: string[] | null; lastswap: number | null }`
  - `readRegistry(cfg: CcrcConfig): Promise<SessionRecord[]>` — enumerates `<registryDir>/*.uuid`; id = basename minus `.uuid`; missing optional fields → null; sorted by id.

- [ ] **Step 1: Write the failing test**

`test/registry.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { readRegistry } from '../src/registry.js';

const seed = (dir: string, id: string, fields: Record<string, string>) => {
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(dir, `${id}.${k}`), v);
};

describe('readRegistry', () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(path.join(tmpdir(), 'ccrc-'));
    mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  });

  it('reads sessions enumerated by *.uuid with optional fields', async () => {
    const reg = path.join(home, '.cc-sessions');
    seed(reg, 'claude2-MekWarLive', {
      wrapper: 'claude2', project: 'MekWarLive', workdir: '/data/projects/MekWarLive',
      uuid: 'a0b5791d-0000-0000-0000-000000000001', started: '1',
      pool: 'claude claude2', lastswap: '1784500000',
    });
    seed(reg, 'claude-corp-acme-platform-ts', {
      wrapper: 'claude-corp', project: 'acme-platform-ts',
      workdir: '/data/projects/acme-platform-ts', uuid: 'b'.repeat(36), started: '1',
    });
    writeFileSync(path.join(reg, 'gpt-disabled'), '');   // noise: not a session file
    writeFileSync(path.join(reg, 'swap.log'), 'x');      // noise

    const out = await readRegistry(loadConfig({ CCRC_HOME: home }));
    expect(out.map((s) => s.id)).toEqual(['claude-corp-acme-platform-ts', 'claude2-MekWarLive']);
    const mek = out[1];
    expect(mek.pool).toEqual(['claude', 'claude2']);
    expect(mek.lastswap).toBe(1784500000);
    expect(out[0].pool).toBeNull();
    expect(out[0].home).toBeNull();
  });

  it('returns [] when registry dir missing', async () => {
    const out = await readRegistry(loadConfig({ CCRC_HOME: path.join(home, 'nope') }));
    expect(out).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/registry.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement**

`src/registry.ts`:

```ts
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { CcrcConfig } from './config.js';

export interface SessionRecord {
  id: string; wrapper: string; project: string; workdir: string; uuid: string;
  started: boolean; home: string | null; pool: string[] | null; lastswap: number | null;
}

async function field(dir: string, id: string, name: string): Promise<string | null> {
  try { return (await readFile(path.join(dir, `${id}.${name}`), 'utf8')).trim(); }
  catch { return null; }
}

export async function readRegistry(cfg: CcrcConfig): Promise<SessionRecord[]> {
  let names: string[];
  try { names = await readdir(cfg.registryDir); } catch { return []; }
  const ids = names.filter((n) => n.endsWith('.uuid')).map((n) => n.slice(0, -'.uuid'.length)).sort();
  const out: SessionRecord[] = [];
  for (const id of ids) {
    const [wrapper, project, workdir, uuid, started, home, pool, lastswap] = await Promise.all([
      field(cfg.registryDir, id, 'wrapper'), field(cfg.registryDir, id, 'project'),
      field(cfg.registryDir, id, 'workdir'), field(cfg.registryDir, id, 'uuid'),
      field(cfg.registryDir, id, 'started'), field(cfg.registryDir, id, 'home'),
      field(cfg.registryDir, id, 'pool'), field(cfg.registryDir, id, 'lastswap'),
    ]);
    if (!wrapper || !workdir || !uuid) continue;   // incomplete registry entry — skip, don't crash
    out.push({
      id, wrapper, project: project ?? id, workdir, uuid,
      started: started === '1',
      home, pool: pool ? pool.split(/\s+/).filter(Boolean) : null,
      lastswap: lastswap ? parseInt(lastswap, 10) : null,
    });
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/registry.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(ccrc): cc-sessions registry reader"
```

---

### Task 5: Limits reader with decay

**Files:**
- Create: `infra/ccrc/server/src/limits.ts`
- Test: `infra/ccrc/server/test/limits.test.ts`

**Interfaces:**
- Produces:
  - `interface AccountLimits { five: number | null; seven: number | null; ts: number | null }` — decayed values; `null` = no file/unparseable.
  - `readLimits(cfg: CcrcConfig, now?: number): Promise<Record<string, AccountLimits>>` — keyed by wrapper; `now` in epoch seconds, injectable for tests.

- [ ] **Step 1: Write the failing test**

`test/limits.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { readLimits } from '../src/limits.js';

describe('readLimits', () => {
  it('reads fresh values and decays stale ones per ccd rules', async () => {
    const home = mkdtempSync(path.join(tmpdir(), 'ccrc-'));
    const dir = path.join(home, '.cc-limits');
    mkdirSync(dir, { recursive: true });
    const now = 1784600000;
    writeFileSync(path.join(dir, 'claude.json'), JSON.stringify({ five: 42, seven: 61, ts: now - 60 }));
    writeFileSync(path.join(dir, 'claude2.json'), JSON.stringify({ five: 99, seven: 80, ts: now - 20000 }));  // 5h window rolled
    writeFileSync(path.join(dir, 'claude-corp.json'), JSON.stringify({ five: 94, seven: 94, ts: now - 700000 })); // both rolled
    writeFileSync(path.join(dir, 'gpt.json'), 'not json');

    const l = await readLimits(loadConfig({ CCRC_HOME: home }), now);
    expect(l['claude']).toEqual({ five: 42, seven: 61, ts: now - 60 });
    expect(l['claude2'].five).toBe(0);
    expect(l['claude2'].seven).toBe(80);
    expect(l['claude-corp']).toMatchObject({ five: 0, seven: 0 });
    expect(l['gpt']).toEqual({ five: null, seven: null, ts: null });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/limits.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement**

`src/limits.ts`:

```ts
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { CcrcConfig } from './config.js';

export interface AccountLimits { five: number | null; seven: number | null; ts: number | null }

const FIVE_WINDOW = 18000;      // ccd: a five reading older than its own 5h window has rolled over
const SEVEN_WINDOW = 604800;

export async function readLimits(cfg: CcrcConfig, now = Math.floor(Date.now() / 1000)): Promise<Record<string, AccountLimits>> {
  let names: string[] = [];
  try { names = await readdir(cfg.limitsDir); } catch { /* no dir yet */ }
  const out: Record<string, AccountLimits> = {};
  for (const n of names.filter((n) => n.endsWith('.json') && !n.startsWith('.'))) {
    const wrapper = n.slice(0, -'.json'.length);
    try {
      const raw = JSON.parse(await readFile(path.join(cfg.limitsDir, n), 'utf8')) as { five?: number; seven?: number; ts?: number };
      const ts = typeof raw.ts === 'number' ? raw.ts : null;
      let five = typeof raw.five === 'number' ? raw.five : null;
      let seven = typeof raw.seven === 'number' ? raw.seven : null;
      if (ts !== null) {
        if (five !== null && now - ts > FIVE_WINDOW) five = 0;
        if (seven !== null && now - ts > SEVEN_WINDOW) seven = 0;
      }
      out[wrapper] = { five, seven, ts };
    } catch {
      out[wrapper] = { five: null, seven: null, ts: null };
    }
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/limits.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(ccrc): account limits reader with ccd decay rules"
```

---

### Task 6: Live state + fleet assembly

**Files:**
- Create: `infra/ccrc/server/src/livestate.ts`, `infra/ccrc/server/src/fleet.ts`, `infra/ccrc/shared/api.ts`
- Test: `infra/ccrc/server/test/fleet.test.ts`

**Interfaces:**
- Consumes: `readRegistry`, `readLimits`, `Tmux`, `CcrcConfig`.
- Produces (in `shared/api.ts` — the PWA imports these):

```ts
export type SessionStatus = 'busy' | 'idle' | 'dead';
export interface FleetSession {
  id: string; wrapper: string; home: string; project: string; workdir: string;
  name: string | null;                       // live display name from sessions/<pid>.json
  status: SessionStatus;
  statusUpdatedAt: number | null;            // epoch ms
  limits: { five: number | null; seven: number | null } | null;  // account of current wrapper
  dialogPending: boolean;                    // set by the watcher (Task 11); false here
  version: string | null;
}
```

- Produces (in `src/livestate.ts`): `interface LiveState { pid: number; sessionId: string; cwd: string; name: string | null; status: string; statusUpdatedAt: number | null; version: string | null }`, `readLiveState(configDir: string, pid: number): Promise<LiveState | null>`.
- Produces (in `src/fleet.ts`): `assembleFleet(cfg: CcrcConfig, tmux: Tmux, now?: number): Promise<FleetSession[]>`. Home fallback when no `home` field: longest-prefix of id among `claude-corp- claude2- claude- gpt-` (ccd `_id_wrapper`).

- [ ] **Step 1: Write the failing test**

`test/fleet.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { assembleFleet, idHomeWrapper } from '../src/fleet.js';
import { Tmux, type Runner } from '../src/exec.js';

const seedSession = (home: string, id: string, wrapper: string, extra: Record<string, string> = {}) => {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const fields = { wrapper, project: id, workdir: `/data/projects/${id}`, uuid: '1'.repeat(36), started: '1', ...extra };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${k}`), v);
};

describe('idHomeWrapper', () => {
  it('longest prefix wins', () => {
    expect(idHomeWrapper('claude-corp-acme-platform-ts')).toBe('claude-corp');
    expect(idHomeWrapper('claude2-MekWarLive')).toBe('claude2');
    expect(idHomeWrapper('claude-synapsium-platform')).toBe('claude');
    expect(idHomeWrapper('gpt-foo')).toBe('gpt');
  });
});

describe('assembleFleet', () => {
  it('joins registry, live state, limits, and tmux aliveness', async () => {
    const home = mkdtempSync(path.join(tmpdir(), 'ccrc-'));
    seedSession(home, 'claude2-MekWarLive', 'claude2');
    seedSession(home, 'claude-dead-proj', 'claude');
    mkdirSync(path.join(home, '.claude-personal', 'sessions'), { recursive: true });
    writeFileSync(path.join(home, '.claude-personal', 'sessions', '40613.json'), JSON.stringify({
      pid: 40613, sessionId: '1'.repeat(36), cwd: '/data/projects/MekWarLive',
      name: 'mekwar-a1', status: 'busy', statusUpdatedAt: 1784582728369, version: '2.1.210',
    }));
    mkdirSync(path.join(home, '.cc-limits'), { recursive: true });
    const now = 1784600000;
    writeFileSync(path.join(home, '.cc-limits', 'claude2.json'), JSON.stringify({ five: 55, seven: 70, ts: now - 60 }));

    const run: Runner = async (_cmd, args) => {
      if (args[0] === 'has-session') return { code: args.includes('cc-claude2-MekWarLive') ? 0 : 1, stdout: '', stderr: '' };
      if (args[0] === 'list-panes') return { code: 0, stdout: '40613\n', stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    };

    const fleet = await assembleFleet(loadConfig({ CCRC_HOME: home }), new Tmux(run), now);
    const mek = fleet.find((s) => s.id === 'claude2-MekWarLive')!;
    expect(mek.status).toBe('busy');
    expect(mek.name).toBe('mekwar-a1');
    expect(mek.limits).toEqual({ five: 55, seven: 70 });
    expect(mek.home).toBe('claude2');
    const dead = fleet.find((s) => s.id === 'claude-dead-proj')!;
    expect(dead.status).toBe('dead');
    expect(dead.name).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/fleet.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement**

`../shared/api.ts` (create with the FleetSession types from the Interfaces block above, plus a placeholder comment that ChatEvent/Dialog land in Tasks 8/11).

`src/livestate.ts`:

```ts
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export interface LiveState {
  pid: number; sessionId: string; cwd: string; name: string | null;
  status: string; statusUpdatedAt: number | null; version: string | null;
}

export async function readLiveState(configDir: string, pid: number): Promise<LiveState | null> {
  try {
    const raw = JSON.parse(await readFile(path.join(configDir, 'sessions', `${pid}.json`), 'utf8'));
    if (typeof raw.sessionId !== 'string') return null;
    return {
      pid, sessionId: raw.sessionId, cwd: String(raw.cwd ?? ''),
      name: typeof raw.name === 'string' ? raw.name : null,
      status: String(raw.status ?? 'idle'),
      statusUpdatedAt: typeof raw.statusUpdatedAt === 'number' ? raw.statusUpdatedAt : null,
      version: typeof raw.version === 'string' ? raw.version : null,
    };
  } catch { return null; }
}
```

`src/fleet.ts`:

```ts
import type { CcrcConfig } from './config.js';
import type { Tmux } from './exec.js';
import { readRegistry } from './registry.js';
import { readLimits } from './limits.js';
import { readLiveState } from './livestate.js';
import type { FleetSession, SessionStatus } from '../../shared/api.js';

export function idHomeWrapper(id: string): string {
  for (const w of ['claude-corp', 'claude2', 'claude', 'gpt']) if (id.startsWith(`${w}-`)) return w;
  return 'claude';
}

export async function assembleFleet(cfg: CcrcConfig, tmux: Tmux, now = Math.floor(Date.now() / 1000)): Promise<FleetSession[]> {
  const [records, limits] = await Promise.all([readRegistry(cfg), readLimits(cfg, now)]);
  return Promise.all(records.map(async (r): Promise<FleetSession> => {
    const alive = await tmux.hasSession(r.id);
    let status: SessionStatus = 'dead';
    let name: string | null = null, statusUpdatedAt: number | null = null, version: string | null = null;
    if (alive) {
      status = 'idle';
      const pid = await tmux.panePid(r.id);
      const cfgDir = cfg.wrappers[r.wrapper];
      if (pid && cfgDir) {
        const live = await readLiveState(cfgDir, pid);
        if (live) {
          status = live.status === 'busy' ? 'busy' : 'idle';
          name = live.name; statusUpdatedAt = live.statusUpdatedAt; version = live.version;
        }
      }
    }
    const acct = limits[r.wrapper];
    return {
      id: r.id, wrapper: r.wrapper, home: r.home ?? idHomeWrapper(r.id),
      project: r.project, workdir: r.workdir, name, status, statusUpdatedAt,
      limits: acct ? { five: acct.five, seven: acct.seven } : null,
      dialogPending: false, version,
    };
  }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/fleet.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(ccrc): live state reader and fleet assembly"
```

---

### Task 7: Fleet REST + WebSocket

**Files:**
- Create: `infra/ccrc/server/src/bus.ts`, `infra/ccrc/server/src/watch.ts`
- Modify: `infra/ccrc/server/src/server.ts` (accept `(cfg, deps)`, register websocket plugin, add routes), `infra/ccrc/server/src/index.ts` (pass real deps)
- Test: `infra/ccrc/server/test/fleetws.test.ts`

**Interfaces:**
- Consumes: `assembleFleet`, `Tmux`, `CcrcConfig`.
- Produces:
  - `interface Deps { cfg: CcrcConfig; run: Runner; tmux: Tmux }`
  - `buildServer(deps: Deps): Promise<FastifyInstance>` — **signature change**; the Task 1 health test updates to `buildServer(testDeps())`.
  - `class Bus extends EventEmitter` (`src/bus.ts`) — events: `'fleet' (FleetSession[])`, `'notice' ({ message: string })`, `'session:<id>' (SessionStreamMsg)` (typed in Task 10).
  - `class FleetWatcher { constructor(deps: Deps, bus: Bus, intervalMs = 2000); start(): void; stop(): void; tick(): Promise<void> }` — `tick()` assembles fleet, emits `'fleet'` only when JSON changed (plus always on first tick).
  - Routes: `GET /api/fleet` → `{ sessions: FleetSession[] }`; `GET /ws/fleet` (WS) → on connect send `{type:'fleet', sessions}`, then push on every bus `'fleet'`/`'notice'` event as `{type:'fleet'|'notice', ...}`.
- Test approach: build server with fixture home + fake runner; call `watcher.tick()` manually; use `app.inject` for REST and a real `ws` client against `app.listen({port:0})` for the WS path.

- [ ] **Step 1: Write the failing test** — REST returns fleet; WS receives initial snapshot and a pushed update after registry change + `tick()`.
- [ ] **Step 2: Run** `npx vitest run test/fleetws.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** `bus.ts` (plain `EventEmitter` subclass with typed `emit`/`on` overloads), `watch.ts` (interval + JSON-diff), and route wiring in `server.ts`:

```ts
// server.ts core shape after this task
export interface Deps { cfg: CcrcConfig; run: Runner; tmux: Tmux }
export async function buildServer(deps: Deps, bus = new Bus(), watcher?: FleetWatcher): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(fastifyWebsocket);
  app.get('/health', async () => ({ ok: true }));
  app.get('/api/fleet', async () => ({ sessions: await assembleFleet(deps.cfg, deps.tmux) }));
  app.get('/ws/fleet', { websocket: true }, (socket) => {
    const onFleet = (sessions: FleetSession[]) => socket.send(JSON.stringify({ type: 'fleet', sessions }));
    const onNotice = (n: { message: string }) => socket.send(JSON.stringify({ type: 'notice', ...n }));
    void assembleFleet(deps.cfg, deps.tmux).then(onFleet);
    bus.on('fleet', onFleet); bus.on('notice', onNotice);
    socket.on('close', () => { bus.off('fleet', onFleet); bus.off('notice', onNotice); });
  });
  return app;
}
```

- [ ] **Step 4: Run all tests** `npx vitest run` — Expected: PASS (health test updated for new signature).
- [ ] **Step 5: Commit** `git add -A && git commit -m "feat(ccrc): fleet REST + websocket with poll watcher"`

---

### Task 8: Transcript resolve + parse

**Files:**
- Create: `infra/ccrc/server/src/transcript/resolve.ts`, `infra/ccrc/server/src/transcript/parse.ts`
- Modify: `infra/ccrc/shared/api.ts` (add ChatEvent)
- Test: `infra/ccrc/server/test/transcript-parse.test.ts`, `infra/ccrc/server/test/fixtures/transcript-sample.jsonl`

**Interfaces:**
- Produces (`shared/api.ts`):

```ts
export type ChatEvent =
  | { kind: 'user'; uuid: string; ts: string; text: string }
  | { kind: 'assistant'; uuid: string; ts: string; text: string }
  | { kind: 'tool_use'; uuid: string; ts: string; toolId: string; name: string; input: string }
  | { kind: 'tool_result'; ts: string; toolId: string; text: string; isError: boolean }
  | { kind: 'system'; uuid: string; ts: string; text: string };
```

- Produces (`src/transcript/resolve.ts`): `transcriptPath(configDir: string, dir: string, uuid: string): string` → `<configDir>/projects/<munge(dir)>/<uuid>.jsonl`. Caller passes live `cwd` when available, else registry `workdir`.
- Produces (`src/transcript/parse.ts`): `parseTranscriptLine(line: string): ChatEvent[]` — rules:
  - Skip: unparseable JSON, `isSidechain === true`, envelope `type` not in {`user`,`assistant`}, `thinking` blocks, empty text.
  - `user` + string content: skip if it starts with `<local-command-caveat>`; content starting `<command-name>` → `system` event with the command text (e.g. `/clear`); else `user` event.
  - `user` + array content: each `tool_result` block → `tool_result` event (`text` = flattened string of block content, truncated to 20 000 chars; `isError` = `is_error === true`); each `text` block → `user` event.
  - `assistant`: joined `text` blocks (non-empty) → one `assistant` event; each `tool_use` block → `tool_use` event with `input` = `JSON.stringify(input)` truncated to 4 000 chars.

**Fixture** `test/fixtures/transcript-sample.jsonl` — real shapes (captured 2026-07-20, Mac, v2.1.210; refresh from box in Plan 3):

```jsonl
{"type":"mode","mode":"normal","sessionId":"126c369b-75eb-4c43-904b-ca081ab9449e"}
{"type":"file-history-snapshot","messageId":"m1","snapshot":{}}
{"uuid":"u1","parentUuid":null,"isSidechain":false,"timestamp":"2026-07-20T21:04:17.669Z","type":"user","message":{"role":"user","content":"I want to talk to you about building our own /rc app"}}
{"uuid":"u2","parentUuid":"u1","isSidechain":false,"timestamp":"2026-07-20T21:04:18.000Z","type":"user","message":{"role":"user","content":"<local-command-caveat>Caveat: ...</local-command-caveat>"}}
{"uuid":"u3","parentUuid":"u2","isSidechain":false,"timestamp":"2026-07-20T21:04:19.000Z","type":"user","message":{"role":"user","content":"<command-name>/clear</command-name>\n<command-message>clear</command-message>"}}
{"uuid":"a1","parentUuid":"u3","isSidechain":false,"timestamp":"2026-07-20T21:04:27.717Z","type":"assistant","message":{"model":"claude-fable-5","id":"msg_1","role":"assistant","content":[{"type":"thinking","thinking":"secret","signature":"x"},{"type":"text","text":"I'll use the brainstorming skill first."}]}}
{"uuid":"a2","parentUuid":"a1","isSidechain":false,"timestamp":"2026-07-20T21:04:30.000Z","type":"assistant","message":{"id":"msg_2","role":"assistant","content":[{"type":"tool_use","id":"toolu_01","name":"Bash","input":{"command":"ls /"}}]}}
{"uuid":"u4","parentUuid":"a2","isSidechain":false,"timestamp":"2026-07-20T21:04:31.000Z","type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_01","content":"bin\netc\nhome"}]}}
{"uuid":"s1","parentUuid":"a2","isSidechain":true,"timestamp":"2026-07-20T21:04:32.000Z","type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"subagent noise"}]}}
```

- [ ] **Step 1: Write the failing test** — feed each fixture line through `parseTranscriptLine`; assert: 5 events total; kinds in order `user, system, assistant, tool_use, tool_result`; sidechain and caveat lines produce `[]`; `tool_use` has `name:'Bash'`; `tool_result` has `toolId:'toolu_01'` and text containing `'bin'`. Plus `transcriptPath('/h/.claude','/data/projects/foo.bar','u'.repeat(36))` === `/h/.claude/projects/-data-projects-foo-bar/` + uuid + `.jsonl`.
- [ ] **Step 2: Run** `npx vitest run test/transcript-parse.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** both modules exactly per the rules above (parse defensively: every field access behind optional chaining; a malformed line returns `[]`, never throws).
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `git add -A && git commit -m "feat(ccrc): transcript path resolution and JSONL parser"`

---

### Task 9: Backlog + tailer

**Files:**
- Create: `infra/ccrc/server/src/transcript/tail.ts`
- Test: `infra/ccrc/server/test/transcript-tail.test.ts`

**Interfaces:**
- Consumes: `parseTranscriptLine`.
- Produces:
  - `readBacklog(file: string, lastN: number): Promise<{ events: ChatEvent[]; offset: number }>` — parses whole file, returns last `lastN` events + end-of-file byte offset. Missing file → `{ events: [], offset: 0 }`.
  - `class TranscriptTailer extends EventEmitter { constructor(file: string, fromOffset: number); start(): void; stop(): void }` — emits `('events', ChatEvent[], newOffset: number)`. Mechanics: `fs.watch` on the file's directory (rename-safe) **plus** a 1500 ms poll fallback; on each trigger, `stat` the file — if `size > offset`, read `[offset, size)`, split on `\n`, keep a partial-line carry buffer, parse complete lines, advance offset. If `size < offset` (truncation/rotation) emit `('rotated')` and stop.

- [ ] **Step 1: Write the failing test** — three cases: (1) `readBacklog` on a 6-line fixture with `lastN: 2` returns the last 2 events and `offset` = file size; (2) tailer started at end-of-file emits exactly the appended entry's events after `appendFileSync` (await via a promise with 3 s timeout); (3) a partial line (append without `\n`) emits nothing until the closing `\n` arrives, then emits one event.
- [ ] **Step 2: Run** `npx vitest run test/transcript-tail.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** (single read loop guarded by an `inFlight` flag so watch + poll can't double-read; always `createReadStream(file, { start: offset, end: size - 1 })` collected to a string).
- [ ] **Step 4: Run** — Expected: PASS (run it twice to shake out timing flakes).
- [ ] **Step 5: Commit** `git add -A && git commit -m "feat(ccrc): transcript backlog and offset tailer"`

---

### Task 10: Session WebSocket

**Files:**
- Create: `infra/ccrc/server/src/sessionws.ts`
- Modify: `infra/ccrc/server/src/server.ts` (route `GET /ws/session/:id`), `infra/ccrc/shared/api.ts` (add SessionStreamMsg)
- Test: `infra/ccrc/server/test/sessionws.test.ts`

**Interfaces:**
- Consumes: `readRegistry`, `readLiveState`, `transcriptPath`, `readBacklog`, `TranscriptTailer`, `Tmux`, `Bus`.
- Produces (`shared/api.ts`):

```ts
export type SessionStreamMsg =
  | { type: 'backlog'; uuid: string; events: ChatEvent[]; offset: number; file: string; missing: boolean }  // missing=true → transcript file not found at `file`; UI shows a diagnostic banner
  | { type: 'events'; uuid: string; events: ChatEvent[]; offset: number }
  | { type: 'status'; status: SessionStatus; statusUpdatedAt: number | null }
  | { type: 'dialog'; dialog: Dialog }            // Dialog lands in Task 11; declare placeholder now
  | { type: 'dialog_cleared' }
  | { type: 'rotated'; uuid: string }             // transcript switched (clear/compact/swap) — client refetches
  | { type: 'notice'; message: string };
```

- Produces (`src/sessionws.ts`): `class SessionStream { constructor(deps: Deps, bus: Bus, id: string, send: (m: SessionStreamMsg) => void, since?: { uuid: string; offset: number }); start(): Promise<void>; stop(): void }` — behavior:
  1. Resolve transcript: registry record for `id`; live cwd via `panePid` + `readLiveState` (fallback registry workdir); path via `transcriptPath`.
  2. `since` matching current uuid → tail from `since.offset` (no backlog); otherwise send `backlog` (last 50) with the resolved `file` path and `missing: true` when the transcript doesn't exist yet (spec's diagnostic-card case — the stream stays up and the tailer starts once the file appears).
  3. Start `TranscriptTailer`; forward as `events` messages.
  4. Every 2 s: re-read registry uuid + live status; on uuid change → send `rotated`, re-resolve, restart tailer from 0 with fresh backlog; on status change → send `status`.
  5. Forward bus `'notice'` and `'session:<id>'` messages to `send`.
- Route: `GET /ws/session/:id?since=<uuid>:<offset>` wires a `SessionStream` per connection; `stop()` on close.

- [ ] **Step 1: Write the failing test** — fixture home with registry + transcript; fake runner (`has-session` 0, `list-panes` → pid whose livestate file exists). Connect real WS client: assert `backlog` arrives with parsed events; append a line to the transcript → assert `events` arrives; flip the registry `.uuid` file to a second transcript file → assert `rotated` then new `backlog`-equivalent behavior (fresh `backlog` message allowed); reconnect with `?since=<uuid>:<offset>` → assert no backlog, only subsequent events.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `git add -A && git commit -m "feat(ccrc): per-session websocket stream with rotation follow"`

---

### Task 11: Dialog parser + watcher integration

**Files:**
- Create: `infra/ccrc/server/src/pane/dialog.ts`, `infra/ccrc/server/test/fixtures/panes/` (5 fixtures below)
- Modify: `infra/ccrc/server/src/watch.ts` (dialog detection in tick), `infra/ccrc/server/src/fleet.ts` (accept `dialogPending` map), `infra/ccrc/shared/api.ts` (Dialog type)
- Test: `infra/ccrc/server/test/dialog.test.ts`

**Interfaces:**
- Produces (`shared/api.ts`):

```ts
export interface Dialog {
  id: string;               // sha1 of the option block text
  title: string;            // nearest non-empty line above the options
  options: { index: number; label: string }[];
  selectedIndex: number;    // option with the ❯ marker
  parsed: boolean;          // false → render raw + point to terminal drawer
  raw: string;              // full pane tail for the unparsed case
}
```

- Produces (`src/pane/dialog.ts`):
  - `parseDialog(pane: string): Dialog | null` — null when no menu present.
  - `paneState(pane: string): 'busy' | 'prompt' | 'menu' | 'other'` — `busy` if `/esc to interrupt/`; `menu` if `/Enter to (confirm|select)/`; `prompt` if a line starts `❯ ` (after menu check — menus also use ❯); else `other`.
- Parsing rules: option lines match `/^\s*(❯)?\s*(\d+)\.\s+(.+)$/`; require ≥2 consecutive option lines AND `menu` footer in pane; `selectedIndex` from the `❯` line (default 1); title = nearest non-empty line above the first option, stripped of leading `●`/`✻` decoration; `id` = sha1 (node:crypto) of the joined option labels + title. Multi-select menus (footer contains `Space to select`) → return `{ parsed: false, raw }` dialog (terminal-drawer territory in v1). `menu` state with no parseable options → `{ parsed: false, raw }`.
- Watcher integration (`watch.ts` tick): for each alive session, `tmux.capture`; if `paneState` is `menu` → `parseDialog`; emit `bus.emit('session:<id>', {type:'dialog', dialog})` when the dialog id changed since last tick; emit `{type:'dialog_cleared'}` when a previously-reported dialog vanished; pass `dialogPending: true` into the fleet assembly for that session (add optional `pendingDialogs: Set<string>` argument to `assembleFleet`).

**Pane fixtures** (author from the known TUI shapes; refresh with real captures in Plan 3):
- `ask-user-question.txt`:

```
● Which architecture should we go with?

❯ 1. A + B drawer (Recommended)
  2. A pure
  3. B first, A later
  4. Other

Enter to confirm · Esc to cancel
```

- `trust-folder.txt` — `Do you trust the files in this folder?` + 2 options + `Enter to confirm`.
- `resume-full.txt` — the 2.1.198 gate: `❯ 1. Resume from summary (recommended)` / `2. Resume full session as-is` / `3. Don't ask me again` + `Enter to confirm`.
- `multiselect.txt` — options with `[ ]` checkboxes + footer `Space to select · Enter to confirm` (must yield `parsed:false`).
- `busy.txt` — mid-turn pane containing `esc to interrupt` (must yield `paneState 'busy'`, `parseDialog` null).

- [ ] **Step 1: Write the failing test** — per fixture: `ask-user-question` parses 4 options, selectedIndex 1, title `Which architecture should we go with?`; `resume-full` parses 3 options; `multiselect` → `parsed:false`; `busy` → state `busy` + null dialog; stable `id` across identical panes, different across fixtures. Watcher test: fake runner returning the ask-user-question pane for an idle session → `tick()` emits `session:<id>` dialog once (not re-emitted on second tick), and fleet has `dialogPending: true`.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `git add -A && git commit -m "feat(ccrc): pane dialog parser and watcher integration"`

---

### Task 12: Keyed queue + sendPrompt

**Files:**
- Create: `infra/ccrc/server/src/inject/queue.ts`, `infra/ccrc/server/src/inject/send.ts`
- Test: `infra/ccrc/server/test/send.test.ts`

**Interfaces:**
- Consumes: `Tmux`, `paneState`.
- Produces:
  - `class KeyedQueue { run<T>(key: string, fn: () => Promise<T>): Promise<T> }` — FIFO per key, keys independent.
  - `interface SendDeps { tmux: Tmux; queue: KeyedQueue; sleep?: (ms: number) => Promise<void> }` (`sleep` injectable → tests pass a no-op).
  - `sendPrompt(d: SendDeps, id: string, text: string, opts?: { replaceDraft?: boolean }): Promise<SendResult>` where `type SendResult = { ok: true } | { ok: false; error: 'not-alive' | 'draft-present' | 'draft-clear-failed' | 'verify-failed'; draft?: string; pane?: string }`.
- `sendPrompt` algorithm (inside `queue.run(id, ...)`):
  1. `capture` → null ⇒ `not-alive`.
  2. Draft = text after `❯ ` on the prompt line, trimmed. Non-empty and `!replaceDraft` ⇒ `draft-present` with the draft text.
  3. If replacing: `sendKey('C-u')`, sleep 150 ms, re-capture; draft still non-empty ⇒ `draft-clear-failed`.
  4. Inject: split `text` on `\n`; for each part `sendLiteral(part)`; between parts `sendKey('M-Enter')` (Alt+Enter = newline in the Claude Code input box).
  5. Verify: sleep 200 ms, capture; pane must contain the first 30 chars of the first non-empty line of `text`; else ⇒ `verify-failed` with pane tail.
  6. `sendKey('Enter')` ⇒ `{ ok: true }`.

- [ ] **Step 1: Write the failing test** — KeyedQueue ordering (two async fns same key resolve in submit order; different keys interleave). sendPrompt against a scripted fake `Tmux` (capture returns a pane with `❯ ` then a pane echoing the draft): happy path sends `-l` literal, then Enter, returns ok; draft-present path returns the draft and sends nothing; multiline `"a\nb"` sends `M-Enter` between literals; verify-failure (capture never echoes text) returns `verify-failed` and never sends Enter.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `git add -A && git commit -m "feat(ccrc): serialized prompt injection with draft guard and verify"`

---

### Task 13: answerDialog + interrupt + write routes

**Files:**
- Modify: `infra/ccrc/server/src/inject/send.ts`, `infra/ccrc/server/src/server.ts`
- Test: `infra/ccrc/server/test/answer.test.ts`, extend `infra/ccrc/server/test/routes.test.ts` (create)

**Interfaces:**
- Produces (in `send.ts`):
  - `answerDialog(d: SendDeps, id: string, dialogId: string, optionIndex: number): Promise<{ ok: true } | { ok: false; error: 'not-alive' | 'stale-dialog' | 'walk-failed' }>` — capture → `parseDialog`; null or `dialog.id !== dialogId` ⇒ `stale-dialog`; delta = `optionIndex - selectedIndex`; send `Down`/`Up` × |delta| with 150 ms sleeps; re-capture + re-parse; `selectedIndex !== optionIndex` ⇒ `walk-failed` (no Enter!); else `Enter` ⇒ ok.
  - `interrupt(d: SendDeps, id: string): Promise<{ ok: true } | { ok: false; error: 'not-alive' | 'not-busy' }>` — capture; `paneState !== 'busy'` ⇒ `not-busy`; else send `Escape`.
- Routes (all JSON; errors → `409` with the `{ok:false,...}` body; unknown id → `404`):
  - `POST /api/sessions/:id/prompt` body `{ text: string; replaceDraft?: boolean }`
  - `POST /api/sessions/:id/dialog` body `{ dialogId: string; optionIndex: number }`
  - `POST /api/sessions/:id/interrupt` body `{}`

- [ ] **Step 1: Write the failing tests** — answerDialog walk-down-2 happy path (scripted captures: selected 1 → after walk selected 3 → Enter sent); stale id ⇒ `stale-dialog`, no keys sent; walk lands wrong ⇒ `walk-failed`, no Enter. interrupt: busy pane ⇒ Escape sent; idle pane ⇒ `not-busy`. Routes: `app.inject` POST prompt happy ⇒ 200; draft-present ⇒ 409 with draft in body.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `git add -A && git commit -m "feat(ccrc): dialog answering, interrupt, and write routes"`

---

### Task 14: Lifecycle + projects routes

**Files:**
- Create: `infra/ccrc/server/src/lifecycle.ts`
- Modify: `infra/ccrc/server/src/server.ts`
- Test: `infra/ccrc/server/test/lifecycle.test.ts`

**Interfaces:**
- Consumes: `Runner`, `CcrcConfig`, `readRegistry`.
- Produces:
  - `interface CcdResult { ok: boolean; stdout: string; stderr: string }`
  - `ccd(run: Runner, cfg: CcrcConfig, args: string[]): Promise<CcdResult>` — spawns `cfg.ccdBin` with `args`; `ok = code === 0`.
  - `listProjects(cfg: CcrcConfig): Promise<{ roots: string[]; projects: { name: string; workdir: string }[] }>` — directories under `cfg.projectsRoot` (skip dotfiles) unioned with registry workdirs, deduped by workdir.
- Routes:
  - `GET /api/projects` → listProjects
  - `POST /api/sessions` `{ wrapper, project, workdir? }` → `ccd ['start', wrapper, project, ...(workdir?[workdir]:[])]`; also `ccd ['enable', ...]`? **No** — call `enable` (it runs start + systemd enable) — body `{ enable?: boolean }` default `true` picks `enable` vs `start`.
  - `POST /api/sessions/:id/ensure` → `ccd ['ensure', id]`
  - `POST /api/sessions/:id/stop` → wrapper+project derived from registry record → `ccd ['stop', wrapper, project]`
  - `POST /api/sessions/:id/swap` `{ wrapper }` → `ccd ['swap', id, wrapper]`
  - Failure mapping: `ok:false` ⇒ HTTP `502` with `{ ok: false, stderr }`.

- [ ] **Step 1: Write the failing test** — fake runner asserts exact argv for each route (e.g. swap POST → `[ccdBin, 'swap', 'claude2-MekWarLive', 'claude']`); stop resolves wrapper/project from a seeded registry; failing runner (`code:1, stderr:'boom'`) ⇒ 502 with `stderr:'boom'`; listProjects merges a temp projects root + registry entries without duplicates.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `git add -A && git commit -m "feat(ccrc): lifecycle and project listing routes"`

---

### Task 15: Image upload → clip

**Files:**
- Create: `infra/ccrc/server/src/clip.ts`
- Modify: `infra/ccrc/server/src/server.ts` (register @fastify/multipart; route)
- Test: `infra/ccrc/server/test/clip.test.ts`

**Interfaces:**
- Produces: `saveUploadAndClip(run: Runner, cfg: CcrcConfig, id: string, data: Buffer, ext: string): Promise<{ ok: boolean; stderr?: string }>` — writes `cfg.uploadsDir/upload-<epochms>-<rand6>.<ext>` (mkdir -p first), then `ccd ['clip', file, id]` (ccd moves the file into `~/.cc-clips/<id>/` and types its path into the prompt).
- Route: `POST /api/sessions/:id/upload` (multipart, field `file`, 25 MB cap; accept png/jpg/jpeg/webp by filename ext, else `415`) → 200 `{ ok: true }` / 502 on ccd failure.

- [ ] **Step 1: Write the failing test** — multipart inject with a small PNG buffer: file lands under uploadsDir before runner call (runner asserts existence + argv `['clip', <path>, <id>]`); `.txt` upload ⇒ 415.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `git add -A && git commit -m "feat(ccrc): image upload through ccd clip"`

---

### Task 16: Notify ingestion

**Files:**
- Create: `infra/ccrc/deploy/notify.sh`
- Modify: `infra/ccrc/server/src/server.ts`
- Test: extend `infra/ccrc/server/test/routes.test.ts`

**Interfaces:**
- Route: `POST /api/notify` body `{ message: string }` → `bus.emit('notice', { message })`; if the message matches `/^cc swap: (\S+) moved (\S+) -> (\S+)/`, also `bus.emit('session:<id>', { type: 'notice', message })`. Returns `{ ok: true }`. (Session WS already forwards notices — Task 10; fleet WS already forwards notices — Task 7. The next `FleetWatcher` tick redraws wrapper/limits after a swap; the session stream's 2 s uuid/status re-check follows the transcript to the new config dir.)
- `deploy/notify.sh` (installed as `~/.cc-sessions/notify.sh` in Plan 3):

```bash
#!/usr/bin/env bash
# ccd swap hook -> ccrc. $1 = human-readable message.
curl -fsS -m 5 -X POST "http://${CCRC_ADDR:-203.0.113.7:7788}/api/notify" \
  -H 'content-type: application/json' \
  -d "$(jq -cn --arg m "$1" '{message:$m}')" >/dev/null 2>&1 || true
```

- [ ] **Step 1: Write the failing test** — POST /api/notify with a swap message ⇒ 200, bus received both `notice` and `session:claude2-MekWarLive` events (subscribe in test); non-swap message ⇒ only `notice`.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** route + commit the shell hook file (`chmod +x`).
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `git add -A && git commit -m "feat(ccrc): swap notice ingestion and notify hook script"`

---

### Task 17: PTY drawer bridge + static serving + deploy artifacts

**Files:**
- Create: `infra/ccrc/server/src/pty.ts`, `infra/ccrc/deploy/ccrc.service`, `infra/ccrc/deploy/deploy.sh`
- Modify: `infra/ccrc/server/src/server.ts` (route `GET /ws/pty/:id`; static serving), `infra/ccrc/server/src/index.ts`
- Test: `infra/ccrc/server/test/pty.test.ts`

**Interfaces:**
- Produces (`src/pty.ts`): `attachPty(id: string, cols: number, rows: number): IPty` — `pty.spawn('tmux', ['attach', '-t', 'cc-<id>'], { name: 'xterm-256color', cols, rows, env: process.env })`.
- WS protocol `GET /ws/pty/:id?cols=N&rows=N`: server→client = raw utf8 text frames (terminal output); client→server = JSON `{ type: 'input', data: string }` | `{ type: 'resize', cols: number, rows: number }`. On socket close: `pty.kill()` **and** `tmux resize-window -t cc-<id> -x 220 -y 50` via Runner (restore the canonical size ccd spawned with — a phone-sized drawer must not leave the session shrunken, it would wrap panes and break capture parsing).
- Static: if `dist-pwa/` exists next to `dist/` (populated by Plan 2's build), serve it at `/` with SPA fallback to `index.html`; absent → skip (API-only mode).
- `deploy/ccrc.service`:

```ini
[Unit]
Description=ccrc — self-hosted remote control for Claude Code sessions
After=network-online.target

[Service]
Environment=CCRC_HOST=203.0.113.7
Environment=CCRC_PORT=7788
ExecStart=/usr/bin/node %h/ccrc/server/dist/server/src/index.js
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
```

- `deploy/deploy.sh` (run from repo root on the Mac; box alias per existing infra: `ssh -p 2222 -i ~/.ssh/<your-key> you@<server-host>`):

```bash
#!/usr/bin/env bash
set -euo pipefail
BOX="${CCRC_BOX:-you@<server-host>}"
SSH=(ssh -p 2222 -i "$HOME/.ssh/<your-key>")
rsync -az --delete -e "${SSH[*]}" --exclude node_modules --exclude dist \
  infra/ccrc/server infra/ccrc/shared infra/ccrc/deploy "$BOX":ccrc/
"${SSH[@]}" "$BOX" 'cd ~/ccrc/server && npm ci && npm run build \
  && mkdir -p ~/.config/systemd/user && cp ~/ccrc/deploy/ccrc.service ~/.config/systemd/user/ \
  && export XDG_RUNTIME_DIR=/run/user/$(id -u) \
  && systemctl --user daemon-reload && systemctl --user enable --now ccrc.service \
  && systemctl --user restart ccrc.service && sleep 1 && curl -fsS http://203.0.113.7:7788/health'
```

- [ ] **Step 1: Write the failing test** — pty ws route test with a stub in place of node-pty (inject a `spawnPty` dep into buildServer's Deps, default `attachPty`): connect, receive a queued "output" frame from the stub, send `{type:'input',data:'ls\r'}` and assert the stub received it; close and assert kill + resize-window runner call.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** (`Deps` gains optional `spawnPty`; static-serving block; write both deploy files, `chmod +x deploy.sh`).
- [ ] **Step 4: Run full suite** `npx vitest run` — Expected: ALL PASS. Also `npm run build` — Expected: clean tsc.
- [ ] **Step 5: Commit** `git add -A && git commit -m "feat(ccrc): pty drawer bridge, static serving, deploy artifacts"`

---

## Plan-level acceptance

- `npx vitest run` green; `npm run build` clean.
- `CCRC_HOME=<fixture-tree> npm run dev` on the Mac serves a working `/api/fleet` against fixtures (manual smoke).
- Deployment itself is **Plan 3** — nothing in this plan touches the box.
