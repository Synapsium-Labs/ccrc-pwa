// The real-browser leg's app half (foundations follow-up F-e; D-5570, D-5576): the production PWA, built once by the
// app's own `vite build`, served from loopback, and opened in a Chrome context whose `/api` and `/ws` answer from a
// fixture. No server, no ccd, no tmux: a row-fit measure needs the shipped markup and the shipped stylesheet laid out
// by a real engine, which jsdom cannot do, and nothing else. `harness.ts` stays the docs rows' three things; this is
// the second thing a browser row can need, so it is a module of its own.
import { execFileSync } from 'node:child_process';
import { createReadStream, existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Browser, BrowserContext, Page, WebSocketRoute } from 'playwright-core';
import { SKIN_STORAGE_KEY, THEME_STORAGE_KEY } from '@ccrc/ui';
import type { FleetSession } from '../../shared/api';
import { fleetSession } from '../test/fleetFixture';

const PWA = path.join(import.meta.dirname, '..');

// Runs in a node child, cwd the PWA package, as `test/markdown-worker-built.test.ts` builds: the app's own config, a
// production build (vitest's NODE_ENV=test would build the `development` export conditions), into argv[1]. Not in
// this file's jsdom realm, whose URL the PWA plugin's file writes reject.
const BUILDER = `
import { build } from 'vite';
await build({ configFile: 'vite.config.ts', logLevel: 'error', build: { outDir: process.argv[1], emptyOutDir: true } });
`;

/** Build the PWA into a fresh temporary directory and return it. The caller removes it (`removeDist`). */
export function buildDist(): string {
  const out = mkdtempSync(path.join(tmpdir(), 'ccrc-browser-dist-'));
  const env: Record<string, string> = { PATH: process.env['PATH'] ?? '', NODE_ENV: 'production' };
  if (process.env['HOME'] !== undefined) env['HOME'] = process.env['HOME'];
  execFileSync(process.execPath, ['--input-type=module', '-e', BUILDER, out],
    { cwd: PWA, env, encoding: 'utf8', timeout: 170_000, stdio: ['ignore', 'pipe', 'pipe'] });
  return out;
}

export function removeDist(dist: string | undefined): void {
  if (dist !== undefined) rmSync(dist, { recursive: true, force: true });
}

const TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json',
};

export interface DistServer {
  /** `http://127.0.0.1:<port>`. */
  readonly origin: string;
  close(): Promise<void>;
}

/** Serve `dist` on an ephemeral loopback port. A path that is not a file answers `index.html`, as the server's own
 *  SPA fallback does, so a deep link such as `/s/<id>` boots the app. `/api` and `/ws` never reach it: the context
 *  routes them (`openApp`). */
export async function serveDist(dist: string): Promise<DistServer> {
  const root = path.resolve(dist);
  const server: Server = createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://dist.invalid').pathname);
    let file = path.resolve(root, `.${pathname}`);
    if (!file.startsWith(root + path.sep) || !existsSync(file) || statSync(file).isDirectory()) file = path.join(root, 'index.html');
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
    createReadStream(file).pipe(res);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  return {
    origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: () => new Promise((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    }),
  };
}

/** What the app's `/api` and `/ws` answer. `api` is keyed by pathname; any other `/api` path answers `{}`, which every
 *  poller the shell mounts reads as "nothing to say". `/ws/fleet` sends each of `fleetFrames` once it opens; every
 *  other socket opens and stays silent, unless `socketFrames` names its pathname: each frame listed there is sent once the
 *  socket opens (a session's backlog, for `/ws/session/<id>`). */
export interface AppFixture {
  readonly api: Readonly<Record<string, unknown>>;
  readonly fleetFrames: readonly unknown[];
  readonly socketFrames?: Readonly<Record<string, readonly unknown[]>>;
}

export interface AppView {
  readonly width: number;
  readonly skin: string;
  readonly theme: string;
  /** A touch screen (a coarse pointer) at a desk width too; below 900 there always is one. */
  readonly touch?: boolean;
}

export interface OpenedApp {
  readonly ctx: BrowserContext;
  readonly page: Page;
  /** Every uncaught page error, in order. */
  readonly errors: string[];
  /** Send `frame` (as JSON) to the NEWEST socket opened on `path` (a pathname such as `/ws/fleet`) and throw when none
   *  is open. Test code only: a frame-cost measure drives the app's own socket exactly as the server would. */
  send(path: string, frame: unknown): void;
  /** The harness's own order log (R104): every `/api` request's interception and fulfilment, and the meter's reads,
   *  in one monotonic sequence on the test side. Test code only; the page never sees it. */
  readonly events: readonly HarnessEvent[];
  /** Call `listener` with each new event, synchronously as it is logged; returns the unsubscribe. A listener runs
   *  inside the `/api` handler, so it must not throw: a throw there leaves that request unanswered. */
  watch(listener: (event: HarnessEvent) => void): () => void;
  /** Log a meter read, with the number of `/api` fulfilments still in flight at that moment. */
  mark(kind: 'readA' | 'readB'): void;
  /** Hold `path`'s fulfilment until `gate` settles: it is in flight (logged `fulfil-start`) from the moment its turn
   *  comes until then. A self-test's controlled boundary, never a gate case's. */
  answerAfter(path: string, gate: Promise<void>): void;
  /** Park every `/api` request intercepted from now on, unanswered, until a flush (R104: `frameCost`'s drains). */
  holdApi(): void;
  /** Answer every parked request, in arrival order, and keep parking new ones. Resolves once each released request
   *  has logged its `fulfil-start`, so the in-flight count is current when it returns. */
  flushApi(): Promise<void>;
  /** Wait until no fulfilment is in flight, or throw `drain-inflight-timeout` (naming the paths) after `capMs`. */
  settleApi(capMs: number): Promise<void>;
  /** Stop parking and answer whatever is parked. Waits for nothing, so a failed attempt's cleanup cannot hang. */
  releaseApi(): void;
}

/** One entry of `OpenedApp.events`. `fulfil-start` is logged when a request's answer is due (it then counts as in
 *  flight), before `route.fulfill` is called; `fulfil-done` once that call has settled. */
export type HarnessEvent =
  | { readonly seq: number; readonly kind: 'intercept' | 'fulfil-start' | 'fulfil-done'; readonly path: string }
  | { readonly seq: number; readonly kind: 'readA' | 'readB' | 'drainWait'; readonly inFlight: number }
  | { readonly seq: number; readonly kind: 'flush' };
type Unsequenced<E> = E extends HarnessEvent ? Omit<E, 'seq'> : never;

/** A context at `view.width` (844 tall below 900, as a phone; 900 above), with a touch screen below 900 or when
 *  `view.touch` asks, the skin and
 *  the theme stored before the first paint (the keys the app itself reads), service workers blocked, and the fixture
 *  answering `/api` and `/ws`. The page is not navigated yet. */
export async function openApp(browser: Browser, view: AppView, fixture: AppFixture): Promise<OpenedApp> {
  const phone = view.width < 900;
  const ctx = await browser.newContext({
    viewport: { width: view.width, height: phone ? 844 : 900 }, hasTouch: phone || view.touch === true, serviceWorkers: 'block',
  });
  await ctx.addInitScript(([skinKey, skin, themeKey, theme]) => {
    try {
      localStorage.setItem(skinKey, skin);
      localStorage.setItem(themeKey, theme);
    } catch { /* a context without storage boots the defaults; the measure then says which skin it drew */ }
  }, [SKIN_STORAGE_KEY, view.skin, THEME_STORAGE_KEY, view.theme] as const);
  const events: HarnessEvent[] = [];
  const listeners = new Set<(event: HarnessEvent) => void>();
  const log = (entry: Unsequenced<HarnessEvent>): void => {
    const event = { ...entry, seq: events.length } as HarnessEvent;
    events.push(event);
    for (const listener of listeners) listener(event);
  };
  const inFlight = new Map<number, string>();
  const gates = new Map<string, Promise<void>>();
  // `null` until `holdApi`: then each request waits here for its turn (a flush or the release).
  let parked: { readonly turn: () => void; readonly started: Promise<void> }[] | null = null;
  const settled = new Set<() => void>();
  await ctx.route('**/api/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    log({ kind: 'intercept', path: pathname });
    const body = Object.hasOwn(fixture.api, pathname) ? fixture.api[pathname] : {};
    let begun = (): void => undefined;
    if (parked !== null) {
      const started = new Promise<void>((done) => { begun = done; });
      await new Promise<void>((turn) => { parked!.push({ turn, started }); });
    }
    const id = events.length;
    inFlight.set(id, pathname);
    log({ kind: 'fulfil-start', path: pathname });
    begun();
    try {
      await gates.get(pathname);
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    } finally {
      inFlight.delete(id);
      log({ kind: 'fulfil-done', path: pathname });
      for (const check of [...settled]) check();
    }
  });
  // Every routed socket, per pathname, in the order it opened: `send` talks to the newest one, and a socket that closed
  // (a reconnect replaced it) leaves the list.
  const sockets = new Map<string, WebSocketRoute[]>();
  await ctx.routeWebSocket(/\/ws\//, (ws) => {
    const pathname = new URL(ws.url()).pathname;
    sockets.set(pathname, [...(sockets.get(pathname) ?? []), ws]);
    ws.onClose(() => { sockets.set(pathname, (sockets.get(pathname) ?? []).filter((x) => x !== ws)); });
    const frames = pathname === '/ws/fleet' ? fixture.fleetFrames : (fixture.socketFrames?.[pathname] ?? []);
    for (const frame of frames) ws.send(JSON.stringify(frame));
  });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => { errors.push(e.message); });
  const send = (path: string, frame: unknown): void => {
    const open = sockets.get(path) ?? [];
    const newest = open.at(-1);
    if (newest === undefined) throw new Error(`no socket is open on ${path} (open: ${[...sockets.keys()].join(', ') || 'none'})`);
    newest.send(JSON.stringify(frame));
  };
  return {
    ctx, page, errors, send, events,
    watch: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    mark: (kind) => { log({ kind, inFlight: inFlight.size }); },
    answerAfter: (path, gate) => { gates.set(path, gate); },
    holdApi: () => { parked ??= []; },
    flushApi: async () => {
      const due = parked?.splice(0) ?? [];
      log({ kind: 'flush' });
      for (const entry of due) entry.turn();
      await Promise.all(due.map((entry) => entry.started));
    },
    settleApi: async (capMs) => {
      if (inFlight.size === 0) return;
      log({ kind: 'drainWait', inFlight: inFlight.size });
      await new Promise<void>((done, fail) => {
        const check = (): void => {
          if (inFlight.size > 0) return;
          clearTimeout(timer);
          settled.delete(check);
          done();
        };
        const timer = setTimeout(() => {
          settled.delete(check);
          fail(new Error(`drain-inflight-timeout: ${[...inFlight.values()].join(', ')} still in flight after ${capMs} ms`));
        }, capMs);
        settled.add(check);
        check();
      });
    },
    releaseApi: () => {
      const due = parked ?? [];
      parked = null;
      if (due.length > 0) log({ kind: 'flush' });
      for (const entry of due) entry.turn();
    },
  };
}

// ---- frame cost: the fleet fixture and the meter (D-6438, C6; C7 and C9 reuse them) --------------------------------
// Test code only. A fleet frame is the whole session list on every change, so what a frame COSTS is the main thread's
// time between the socket delivering it and the page being idle again. `fleetFixture` builds a deterministic fleet of
// C0's shape (15 projects, 17 lanes, neutral names), `fleetFrameAt` returns the frame after `k` steps of about nine
// rows changing each, and `frameCost` sends frames to the app's own socket and reads Chrome's TaskDuration and
// ScriptDuration around each one.

/** The page clock the cost and render cases fix, and the base of every time field in the fixture (epoch ms). */
export const FIXTURE_NOW_MS = 1_792_362_479_000;
export const FIXTURE_PROJECTS = 15;
export const FIXTURE_LANES = 17;
/** How many rows one step of `fleetFrameAt` changes. */
export const ROWS_PER_STEP = 9;

const letter = (i: number): string => String.fromCharCode(97 + i);
const HUE_CYCLE = ['cyan', 'violet', 'blue', 'magenta', 'amber', 'green'] as const;

export interface FleetFixtureData {
  readonly sessions: readonly FleetSession[];
  /** `/api/accounts`'s `roster`: 17 entries, `lane-a` ... `lane-q`. */
  readonly roster: readonly object[];
  /** `/api/accounts`'s `accounts`: one usage reading per lane. */
  readonly usage: readonly object[];
  /** `/api/projects`'s rows: `project-a` ... `project-o`. */
  readonly projects: readonly { readonly name: string; readonly workdir: string }[];
}

/** `n` workspace rows spread over 15 projects and 17 lanes, in a mix of buckets (working, idle, a few asking). Ids are
 *  `ws-<i>`; the same `n` always gives the same rows. */
export function fleetFixture(n: number): FleetFixtureData {
  const projects = Array.from({ length: FIXTURE_PROJECTS }, (_, i) => ({ name: `project-${letter(i)}`, workdir: `/w/project-${letter(i)}` }));
  const lanes = Array.from({ length: FIXTURE_LANES }, (_, i) => `lane-${letter(i)}`);
  const roster = lanes.map((id, i) => ({ id, label: id, hue: HUE_CYCLE[i % HUE_CYCLE.length]!, pool: null, homeAble: true, hidden: false }));
  const usage = lanes.map((wrapper, i) => ({
    wrapper, five: 10 + ((i * 7) % 80), seven: 20 + ((i * 11) % 70), ts: FIXTURE_NOW_MS / 1000,
    fiveResetAt: FIXTURE_NOW_MS / 1000 + 7_800, sevenResetAt: FIXTURE_NOW_MS / 1000 + 259_800,
    fiveRolledOver: false, sevenRolledOver: false, disabled: false, authDead: false,
  }));
  const sessions = Array.from({ length: n }, (_, i): FleetSession => {
    const project = projects[i % FIXTURE_PROJECTS]!.name;
    const lane = lanes[i % FIXTURE_LANES]!;
    const kind = i % 6; // 0,3 working; 1,2,4 idle; 5 asking
    const working = kind === 0 || kind === 3;
    return fleetSession({
      id: `ws-${i}`, wrapper: lane, home: lane, project, workdir: `/w/${project}/ws-${i}`, workspace: `ws-${i}`,
      name: `task ${i}`, branch: `ws/task-${i}`, status: working ? 'busy' : 'idle', bucket: kind === 5 ? 'attention' : working ? 'working' : 'idle',
      statusUpdatedAt: FIXTURE_NOW_MS - (60 + i * 37) * 1000, ctxPct: (i * 13) % 90, model: 'Model A (1M context)', effort: 'high',
    });
  });
  return { sessions, roster, usage, projects };
}

/** The `AppFixture.api` entries a fleet of `data` needs, over any extra the case adds. */
export function fleetApi(data: FleetFixtureData, extra: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    '/api/accounts': { accounts: data.usage, projected: null, roster: data.roster },
    '/api/projects': { roots: ['/w'], projects: data.projects },
    '/api/runs': [], '/api/claims': [],
    ...extra,
  };
}

/** The `/ws/fleet` frame that carries `sessions`. */
export const fleetFrame = (sessions: readonly FleetSession[]): { type: 'fleet'; sessions: readonly FleetSession[] } => ({ type: 'fleet', sessions });

/** The fleet after `k` steps (k = 0 is `base`). Step j changes rows `(j-1)*9 ... (j-1)*9+8` (mod n): a working row goes
 *  idle and an idle one works, an asking one stays asking, and every touched row moves its `statusUpdatedAt` and its
 *  `ctxPct`. Cumulative, so each frame differs from the one before it in exactly those nine rows. */
export function fleetFrameAt(base: readonly FleetSession[], k: number): FleetSession[] {
  const rows = base.map((s) => ({ ...s }));
  const n = rows.length;
  for (let j = 1; j <= k; j += 1) {
    for (let r = 0; r < ROWS_PER_STEP; r += 1) {
      const row = rows[((j - 1) * ROWS_PER_STEP + r) % n]!;
      if (row.bucket === 'working') { row.bucket = 'idle'; row.status = 'idle'; }
      else if (row.bucket === 'idle') { row.bucket = 'working'; row.status = 'busy'; }
      row.statusUpdatedAt = FIXTURE_NOW_MS - 30_000 + j * 1000;
      row.ctxPct = ((row.ctxPct ?? 0) + 7 + j) % 100;
    }
  }
  return rows;
}

/** About `count` neutral transcript events for a session's backlog: user text, assistant text with a code block, and
 *  tool calls with their results, in a fixed rotation. */
export function longTranscript(count: number): object[] {
  const ts = new Date(FIXTURE_NOW_MS - 3_600_000).toISOString();
  const events: object[] = [];
  let t = 0;
  while (events.length < count) {
    t += 1;
    events.push({ kind: 'user', uuid: `q${t}`, ts, text: `Step ${t}: please check the module and report what you find.` });
    events.push({ kind: 'assistant', uuid: `a${t}`, ts, text:
      `Looking at step ${t}. The helper returns early when the list is empty:\n\n\`\`\`ts\nexport function pick(items: string[]): string | null {\n  return items.length === 0 ? null : items[0] ?? null;\n}\n\`\`\`\n\nI will read the file, then run the checks.` });
    events.push({ kind: 'tool_use', uuid: `u${t}`, ts, toolId: `t${t}`, name: t % 2 === 0 ? 'Read' : 'Bash',
      input: JSON.stringify(t % 2 === 0 ? { file_path: `/w/project-a/src/module-${t}.ts` } : { command: `npm run check -- --filter module-${t}` }) });
    events.push({ kind: 'tool_result', ts, toolId: `t${t}`, text: `checked module-${t}: 12 passed`, isError: false });
    events.push({ kind: 'assistant', uuid: `b${t}`, ts, text: `Step ${t} is clean: nothing to change.` });
  }
  return events.slice(0, count);
}

/** The frame a session socket sends on open. */
export const backlogFrame = (events: readonly object[]): object => ({
  type: 'backlog', uuid: 'u-1', events, offset: 1, file: '/w/t.jsonl', missing: false, searchComplete: true, fileMeasured: true,
});

export interface Cost { readonly taskMs: number; readonly scriptMs: number }
export interface FrameCost {
  /** One window of `gapMs` with no frame sent: what the page costs doing nothing. */
  readonly idle: Cost;
  /** One entry per frame: the main thread's TaskDuration and ScriptDuration over the `gapMs` after it was sent. */
  readonly frames: readonly Cost[];
  readonly median: Cost;
  readonly mean: Cost;
  /** Per window, the idle one first: how many `/api` requests the harness intercepted between its two reads. */
  readonly deferred: readonly number[];
  /** Per window, the idle one first: whether the drain before it saw the main thread go quiet. */
  readonly drainQuiet: readonly boolean[];
}

/** What `frameCost` has measured so far, filled in place, one entry per COMPLETED window (the idle one first), so a
 *  caller still has it when the attempt fails: a window whose drain or reads fail is not in it. The caller creates it
 *  (`{ windows: [] }`). */
export interface FrameCostRecord {
  readonly windows: { readonly cost: Cost; readonly deferred: number; readonly drainQuiet: boolean }[];
}

/** `frameCost`'s options. `during` runs inside each frame's window, after the frame is sent and before the wait, with
 *  the frame's index; `quiet: false` skips the drain's quiet wait. Both are the self-test's, never a gate case's.
 *  `record` is filled window by window (`FrameCostRecord`); a gate case passes one and keeps it whether the attempt
 *  passes or fails. */
export interface FrameCostOptions {
  readonly during?: (index: number) => Promise<void>;
  readonly quiet?: boolean;
  readonly record?: FrameCostRecord;
}

const medianOf = (xs: readonly number[]): number => {
  const v = [...xs].sort((a, b) => a - b);
  if (v.length === 0) return 0;
  return v.length % 2 === 1 ? v[(v.length - 1) / 2]! : (v[v.length / 2 - 1]! + v[v.length / 2]!) / 2;
};
const meanOf = (xs: readonly number[]): number => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);

/** The median and the mean of `costs`, each of the two figures on its own. */
export function summarize(costs: readonly Cost[]): { readonly median: Cost; readonly mean: Cost } {
  return {
    median: { taskMs: medianOf(costs.map((c) => c.taskMs)), scriptMs: medianOf(costs.map((c) => c.scriptMs)) },
    mean: { taskMs: meanOf(costs.map((c) => c.taskMs)), scriptMs: meanOf(costs.map((c) => c.scriptMs)) },
  };
}

/** The drain's caps (R104). An in-flight fulfilment past `INFLIGHT_CAP_MS` fails the attempt; a quiet wait past
 *  `QUIET_CAP_MS` is only recorded (`FrameCost.drainQuiet`). */
export const INFLIGHT_CAP_MS = 5000;
export const QUIET_CAP_MS = 3000;
const QUIET_STEP_MS = 100;
const QUIET_STEPS = 3;
const QUIET_TASK_MS = 1;

/** Send each of `frames` to the newest socket on `path`, `gapMs` apart, and read Chrome's `TaskDuration` and
 *  `ScriptDuration` (`Performance.getMetrics`, seconds) before and after each window. One idle window of `gapMs` with
 *  no frame is measured first, on the page as it stands before `frames`: it is not matched to a page that has taken
 *  them (an identical frame re-sent after many changes is measured against this one idle window). Nothing runs in the
 *  page: the meter is a CDP session on the test side.
 *
 *  The fixture's `/api` answers are deferred out of the windows (the operator's R104 contract): every request is
 *  parked from the start, and a DRAIN before each window (the idle one too) answers the parked ones, waits for their
 *  fulfilments (capped: `drain-inflight-timeout` fails the attempt), then waits for a quiet main thread (capped, and
 *  only recorded). So no answer of this handler is FULFILLED inside a window (a route a test adds on the context
 *  itself answers outside it; the frame-cost gates add none). That is a mitigation, not an isolation: the page's
 *  parsing and rendering of an answer, and its timers, can still run into the next window, and the app's pollers keep
 *  their own times (a poll's `fetch` call itself lands in whichever window it falls in). The `finally` releases
 *  whatever is still parked and waits for nothing. */
export async function frameCost(
  app: OpenedApp, path: string, frames: readonly unknown[], gapMs: number, options: FrameCostOptions = {},
): Promise<FrameCost> {
  const cdp = await app.ctx.newCDPSession(app.page);
  const deferred: number[] = [];
  const drainQuiet: boolean[] = [];
  app.holdApi();
  try {
    await cdp.send('Performance.enable');
    const read = async (): Promise<Cost> => {
      const { metrics } = await cdp.send('Performance.getMetrics');
      const get = (name: string): number => metrics.find((m) => m.name === name)?.value ?? Number.NaN;
      return { taskMs: get('TaskDuration') * 1000, scriptMs: get('ScriptDuration') * 1000 };
    };
    // The main thread is quiet when TaskDuration grows by less than QUIET_TASK_MS over QUIET_STEPS reads
    // QUIET_STEP_MS apart; the wait gives up at QUIET_CAP_MS. A disclosure, not a proof that the page is done.
    const quiet = async (): Promise<boolean> => {
      const end = Date.now() + QUIET_CAP_MS;
      let last = (await read()).taskMs;
      for (let still = 0; Date.now() < end; ) {
        await app.page.waitForTimeout(QUIET_STEP_MS);
        const now = (await read()).taskMs;
        still = now - last < QUIET_TASK_MS ? still + 1 : 0;
        last = now;
        if (still === QUIET_STEPS) return true;
      }
      return false;
    };
    const drain = async (): Promise<boolean> => {
      await app.flushApi();
      await app.settleApi(INFLIGHT_CAP_MS);
      return options.quiet === false ? false : quiet();
    };
    const window = async (frame: { readonly frame: unknown; readonly index: number } | null): Promise<Cost> => {
      const wentQuiet = await drain();
      drainQuiet.push(wentQuiet);
      const a = await read();
      app.mark('readA');
      const from = app.events.length;
      if (frame !== null) {
        app.send(path, frame.frame);
        await options.during?.(frame.index);
      }
      await app.page.waitForTimeout(gapMs);
      const b = await read();
      app.mark('readB');
      const intercepted = app.events.slice(from).filter((e) => e.kind === 'intercept').length;
      deferred.push(intercepted);
      const cost = { taskMs: b.taskMs - a.taskMs, scriptMs: b.scriptMs - a.scriptMs };
      options.record?.windows.push({ cost, deferred: intercepted, drainQuiet: wentQuiet });
      return cost;
    };
    const idle = await window(null);
    const costs: Cost[] = [];
    for (const [index, frame] of frames.entries()) costs.push(await window({ frame, index }));
    return { idle, frames: costs, ...summarize(costs), deferred, drainQuiet };
  } finally {
    app.releaseApi();
    await cdp.detach().catch(() => { /* the context closing first is fine */ });
  }
}
