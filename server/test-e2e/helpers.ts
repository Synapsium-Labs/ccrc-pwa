import WebSocket from 'ws';

export const BASE = process.env.CCRC_BASE_URL ?? '';
export const WS_BASE = BASE.replace(/^http/, 'ws');

export async function post(path: string, body: unknown): Promise<{ status: number; body: any }> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  let parsed: any = null;
  try { parsed = await res.json(); } catch { /* empty body ok */ }
  return { status: res.status, body: parsed };
}

export async function get(path: string): Promise<{ status: number; body: any }> {
  const res = await fetch(`${BASE}${path}`);
  let parsed: any = null;
  try { parsed = await res.json(); } catch { /* */ }
  return { status: res.status, body: parsed };
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Poll a REST endpoint until pred(body) is truthy or timeout. Returns the last body. */
export async function pollUntil(
  path: string,
  pred: (b: any) => boolean,
  timeoutMs: number,
  intervalMs = 3000,
): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  let last: any = null;
  while (Date.now() < deadline) {
    const { body } = await get(path);
    last = body;
    if (pred(body)) return body;
    await sleep(intervalMs);
  }
  return last;
}

/**
 * Connect a WS, collect messages until pred(msg) is true (resolves with the
 * collected array) or timeout (rejects). Optionally fire `onOpen` once connected
 * (e.g. to POST the prompt that triggers the events being awaited).
 */
export function wsCollect(
  path: string,
  pred: (msg: any, all: any[]) => boolean,
  timeoutMs: number,
  onOpen?: () => void,
): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${WS_BASE}${path}`);
    const all: any[] = [];
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error(`wsCollect timeout after ${timeoutMs}ms on ${path}; collected ${all.length} msgs: ${JSON.stringify(all.slice(-4))}`));
    }, timeoutMs);
    ws.on('open', () => { if (onOpen) setTimeout(onOpen, 250); });
    ws.on('message', (d) => {
      let m: any;
      try { m = JSON.parse(d.toString()); } catch { return; }
      all.push(m);
      if (pred(m, all)) { clearTimeout(timer); ws.close(); resolve(all); }
    });
    ws.on('error', (e) => { clearTimeout(timer); reject(e); });
  });
}

/** Flatten all ChatEvent arrays out of session-stream messages. */
export function eventsOf(msgs: any[]): any[] {
  return msgs.flatMap((m) => (m.type === 'backlog' || m.type === 'events') ? m.events : []);
}

/**
 * Wait until the session is present and idle (not busy, not dead), then settle —
 * ccd clears first-run gates and injects/submits `/effort` at spawn and after a
 * swap, and a prompt fired mid-automation collides on the tmux pane. The settle
 * lets that automation's own busy→idle complete and the input box drain.
 */
export async function waitIdle(id: string, timeoutMs = 180_000, settleMs = 4000): Promise<void> {
  await pollUntil(
    '/api/fleet',
    (b) => b?.sessions?.find((s: any) => s.id === id)?.status === 'idle',
    timeoutMs,
  );
  await sleep(settleMs);
}
