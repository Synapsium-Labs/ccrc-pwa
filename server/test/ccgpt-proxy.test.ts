// server/test/ccgpt-proxy.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { pythonOrSkip, ccgptFile, PYSTUB_DIR } from './ccgptHarness';
import { mkTmp } from './tmpHelpers';

const LANE = 'codex-a';
const PROXY_PORT = 45010;
const UPSTREAM_PORT = 45011;

// Probed once at module scope, same shape as ccgpt-harness.test.ts: a
// missing interpreter must be a visible skip, not every case below quietly
// `return`ing and vitest reporting a green checkmark for work that never ran.
const PY = pythonOrSkip();

it('this box has a usable python3', () => {
  if (process.env.CI) expect(PY).toBeTruthy();
});

let proc: ChildProcess | null = null;
let upstream: Server | null = null;

afterEach(async () => {
  if (proc) { proc.kill('SIGKILL'); proc = null; }
  if (upstream) { await new Promise<void>((r) => upstream!.close(() => r())); upstream = null; }
});

/** Starts a recording upstream plus the shim. Returns once the shim answers
 *  its own /ccgpt/lane. `env` lets a later task's case override or omit one
 *  of the three required variables without duplicating this whole function. */
async function startPair(
  home: string,
  handler: (req: any, body: Buffer, res: any) => void,
  env: Record<string, string> = {},
) {
  upstream = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => handler(req, Buffer.concat(chunks), res));
  });
  await new Promise<void>((r) => upstream!.listen(UPSTREAM_PORT, '127.0.0.1', () => r()));

  const py = PY!;
  proc = spawn(py, [ccgptFile('ccgpt-proxy.py')], {
    env: {
      HOME: home, PATH: process.env.PATH ?? '/usr/bin:/bin', PYTHONPATH: PYSTUB_DIR,
      CCGPT_ACCOUNT_ID: LANE,
      CCGPT_PROXY_PORT: String(PROXY_PORT),
      CCGPT_LITELLM_PORT: String(UPSTREAM_PORT),
      ...env,
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

describe.skipIf(!PY)('ccgpt-proxy: identity and passthrough', () => {
  it('answers /ccgpt/lane with its own lane id', async () => {
    const home = mkTmp('ccgpt-proxy-lane-');
    await startPair(home, (_req, _body, res) => { res.writeHead(200); res.end('{}'); });
    const r = await fetch(`http://127.0.0.1:${PROXY_PORT}/ccgpt/lane`);
    expect(await r.json()).toEqual({ lane: LANE });
  });

  it('forwards a non-/messages path byte-identically', async () => {
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

  // Step 5: a defaulted port is the exact mechanism by which one lane's shim
  // reaches another lane's gateway and bills the wrong account (module
  // docstring). This proves the refusal exists rather than asserting the
  // absence of a default by reading the source.
  it('refuses to start when CCGPT_LITELLM_PORT is unset, naming the missing variable', async () => {
    const home = mkTmp('ccgpt-proxy-nodefault-');
    const child = spawn(PY!, [ccgptFile('ccgpt-proxy.py')], {
      env: {
        HOME: home, PATH: process.env.PATH ?? '/usr/bin:/bin', PYTHONPATH: PYSTUB_DIR,
        CCGPT_ACCOUNT_ID: LANE,
        CCGPT_PROXY_PORT: String(PROXY_PORT),
        // CCGPT_LITELLM_PORT deliberately omitted.
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    proc = child;
    let stderr = '';
    child.stderr?.on('data', (c) => { stderr += c.toString(); });
    const [code] = await new Promise<[number | null, NodeJS.Signals | null]>((resolve) => {
      child.on('exit', (c, s) => resolve([c, s]));
    });
    proc = null;
    expect(code).not.toBe(0);
    expect(stderr).toMatch(/CCGPT_LITELLM_PORT/);
  });
});
