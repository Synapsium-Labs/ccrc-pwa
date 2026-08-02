import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import fastifyMultipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import type { CcrcConfig } from './config.js';
import type { Tmux } from './exec.js';
import type { FleetIO } from './io.js';
import { assembleFleet, liveStatus } from './fleet.js';
import { readLimits, projectHome } from './limits.js';
import { defaultCachePath, loadSnapshot, type FleetState } from './fleetstate.js';
import { CCD_ARGV, verbSupported, type CcdArgv } from './ccdargv.js';
import { parsePrLines, prView, unknownView } from './prstate.js';
import { parseAudit, parseReap } from './wsaudit.js';
import { readTasks } from './tasks/read.js';
import { Bus, type Notice } from './bus.js';
import type { FleetWatcher } from './watch.js';
import { SessionStream, parseSince } from './sessionws.js';
import { KeyedQueue } from './inject/queue.js';
import { sendPrompt, answerDialog, interrupt, type SendDeps } from './inject/send.js';
import { readRegistry } from './registry.js';
import { listProjects, type CcdResult } from './lifecycle.js';
import { sessionCommands } from './commands.js';
import { CLIP_NAME_RE, clipPath, isSafeSessionId, stageUpload } from './clip.js';
import type { SpawnPty } from './pty.js';
import type { PushService } from './push.js';
import type { AccountUsage, FleetSession, SessionStreamMsg, TaskItem } from '../../shared/api.js';

const ACCOUNT_ORDER = ['claude', 'claude2', 'claude-corp', 'gpt'];

/** Post-downscale ceiling for one attachment. */
const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;
/** Ceiling on attachments per prompt — a sanity bound, not a UX limit. */
const MAX_ATTACHMENTS = 4;

/** Content-Type for the clip route, keyed by the (real) extension `clipName` wrote. */
const CLIP_MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
};

export interface Deps {
  cfg: CcrcConfig;
  /** The ONLY path to `ccd`. There is deliberately no raw `run` here: with one,
   *  "every ccd argv is built in ccdargv.ts" is enforceable only by scanning
   *  source text, which was defeated four times in four rounds. The parameter
   *  type is the enforcement now — see task 13S and `CcdArgv`. */
  runCcd: (argv: CcdArgv) => Promise<CcdResult>;
  tmux: Tmux; io: FleetIO; spawnPty?: SpawnPty;
  /** Remote-mode reachability, straight from `connectFleet().state` — absent
   *  (or ignored) in local mode, where the fleet is always "connected". */
  fleetState?: FleetState;
  /** Override for tests; defaults to `fleetstate.ts`'s `defaultCachePath()`. */
  stateCachePath?: string;
  /** Web Push — present only when VAPID keys are configured. */
  push?: PushService;
}

/** dist-pwa/ lives at the server package root (next to dist/); walk up from this
 *  module — src/ in dev, dist/server/src/ compiled — to the first package.json. */
function findPwaRoot(): string | null {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    if (existsSync(path.join(dir, 'package.json'))) {
      const pwa = path.join(dir, 'dist-pwa');
      return existsSync(path.join(pwa, 'index.html')) ? pwa : null;
    }
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return null;
}

export async function buildServer(deps: Deps, bus = new Bus(), watcher?: FleetWatcher): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(fastifyWebsocket);
  await app.register(fastifyMultipart, { limits: { fileSize: 25 * 1024 * 1024 } });

  app.get('/health', async () => ({ ok: true }));

  const stateCachePath = deps.stateCachePath ?? defaultCachePath();

  // Degraded mode: while the remote fleet host is unreachable, serve the
  // last-known-good snapshot (fleetstate.ts, written by FleetWatcher on every
  // successful poll) instead of a live assemble that would otherwise read as
  // an empty fleet. `stale`/`downSince` let the PWA bannner explain why.
  app.get('/api/fleet', async () => {
    if (deps.cfg.fleetMode === 'remote' && deps.fleetState && !deps.fleetState.connected) {
      const snap = await loadSnapshot(stateCachePath);
      if (snap) return { sessions: snap.sessions, stale: true, downSince: deps.fleetState.downSince };
    }
    return { sessions: await assembleFleet(deps.io, deps.cfg, deps.tmux, undefined, watcher?.currentPending(), watcher?.currentStatuslines(), watcher?.currentTaskProgress(), watcher?.currentPrStates()) };
  });

  app.get('/api/fleet/health', async () => {
    if (deps.cfg.fleetMode === 'remote' && deps.fleetState) {
      return { mode: 'remote', connected: deps.fleetState.connected, downSince: deps.fleetState.downSince };
    }
    return { mode: deps.cfg.fleetMode, connected: true, downSince: null };
  });

  // Fleet-host reboot: guarded to remote mode with Hetzner creds configured.
  // The fleet box is shared with the rp-llm stack — the PWA's confirm dialog
  // names that collateral before this ever fires.
  app.post('/api/fleet/reboot', async (req, reply) => {
    if (deps.cfg.fleetMode !== 'remote') return reply.code(409).send({ ok: false, error: 'not-remote' });
    const { hetznerToken, fleetServerId } = deps.cfg;
    if (!hetznerToken || !fleetServerId) return reply.code(501).send({ ok: false, error: 'not-configured' });
    try {
      const res = await fetch(`https://api.hetzner.cloud/v1/servers/${fleetServerId}/actions/reboot`, {
        method: 'POST',
        headers: { authorization: `Bearer ${hetznerToken}`, 'content-type': 'application/json' },
      });
      if (!res.ok) return reply.code(502).send({ ok: false, error: 'hetzner-error' });
      return reply.code(202).send({ ok: true });
    } catch {
      return reply.code(502).send({ ok: false, error: 'hetzner-error' });
    }
  });

  // Web Push: the PWA fetches the VAPID public key, then registers its push
  // subscription here. Notifications fire from the FleetWatcher on a new
  // question or a busy→idle finish. 501 when push isn't configured.
  app.get('/api/push/key', async (_req, reply) => {
    if (!deps.push) return reply.code(501).send({ error: 'not-configured' });
    return { key: deps.push.publicKey };
  });
  app.post('/api/push/subscribe', async (req, reply) => {
    if (!deps.push) return reply.code(501).send({ error: 'not-configured' });
    const sub = req.body as { endpoint?: unknown; keys?: unknown };
    if (typeof sub?.endpoint !== 'string' || typeof sub?.keys !== 'object' || sub.keys === null) {
      return reply.code(400).send({ error: 'bad-subscription' });
    }
    await deps.push.subscribe(sub as never);
    return reply.code(201).send({ ok: true });
  });
  app.post('/api/push/unsubscribe', async (req, reply) => {
    const ep = (req.body as { endpoint?: unknown })?.endpoint;
    if (deps.push && typeof ep === 'string') await deps.push.unsubscribe(ep);
    return { ok: true };
  });

  // Account usage read straight from telemetry (cc-limits), independent of which
  // sessions are running or where they've swapped — so it survives restarts,
  // respawns, and swaps. Ordered claude / claude2 / claude-corp / gpt.
  app.get('/api/accounts', async () => {
    const limits = await readLimits(deps.io, deps.cfg);
    const rank = (w: string) => { const i = ACCOUNT_ORDER.indexOf(w); return i < 0 ? 99 : i; };
    const accounts: AccountUsage[] = Object.entries(limits)
      .map(([wrapper, l]): AccountUsage => ({
        wrapper, five: l.five, seven: l.seven, ts: l.ts,
        fiveResetAt: l.fiveResetAt, sevenResetAt: l.sevenResetAt,
        fiveRolledOver: l.fiveRolledOver, sevenRolledOver: l.sevenRolledOver,
        disabled: l.disabled,
      }))
      .sort((a, b) => rank(a.wrapper) - rank(b.wrapper) || (a.wrapper < b.wrapper ? -1 : 1));
    // Where a new workspace would land, computed HERE from the same telemetry
    // rather than in the PWA: ccd's `_ws_least_loaded` is the routing rule and
    // this is already the second implementation of it — a third would drift
    // from both. The `+` only displays what this says.
    return { accounts, projected: projectHome(limits) };
  });

  app.get('/ws/fleet', { websocket: true }, (socket) => {
    const onFleet = (sessions: FleetSession[]) => socket.send(JSON.stringify({ type: 'fleet', sessions }));
    const onNotice = (n: Notice) => socket.send(JSON.stringify({ type: 'notice', ...n }));
    void assembleFleet(deps.io, deps.cfg, deps.tmux, undefined, watcher?.currentPending(), watcher?.currentStatuslines(), watcher?.currentTaskProgress(), watcher?.currentPrStates()).then(onFleet);
    bus.on('fleet', onFleet);
    bus.on('notice', onNotice);
    socket.on('close', () => {
      bus.off('fleet', onFleet);
      bus.off('notice', onNotice);
    });
  });

  // Swap-notice ingestion: ccd's ~/.cc-sessions/notify.sh hook POSTs here.
  // Every notice fans out fleet-wide; a `cc swap:` message also targets the
  // moved session's stream so its chat surfaces the account change inline.
  app.post('/api/notify', async (req, reply) => {
    const body = (req.body ?? {}) as { message?: unknown };
    if (typeof body.message !== 'string') {
      return reply.code(400).send({ ok: false, error: 'bad-request' });
    }
    const message = body.message;
    bus.emit('notice', { message });
    const swap = /^cc swap: (\S+) moved (\S+) -> (\S+)/.exec(message);
    if (swap) bus.emit(`session:${swap[1]}`, { type: 'notice', message });
    return { ok: true };
  });

  app.get('/ws/session/:id', { websocket: true }, (socket, req) => {
    const { id } = req.params as { id: string };
    const since = parseSince((req.query as { since?: string }).since);
    const stream = new SessionStream(deps, bus, id, (m: SessionStreamMsg) => socket.send(JSON.stringify(m)), since);
    void stream.start();
    socket.on('close', () => stream.stop());
  });

  // Terminal drawer: attach a pty to the session's tmux window. Lazy-import the
  // native node-pty binding only when no stub is injected (keeps tests hermetic).
  const spawnPty: SpawnPty = deps.spawnPty ?? (await import('./pty.js')).attachPty;
  const dim = (v: string | undefined, dflt: number): number => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : dflt;
  };

  app.get('/ws/pty/:id', { websocket: true }, (socket, req) => {
    const { id } = req.params as { id: string };
    const q = req.query as { cols?: string; rows?: string };
    const p = spawnPty(id, dim(q.cols, 80), dim(q.rows, 24));
    const sub = p.onData((data) => socket.send(data));   // server->client: raw utf8 frames
    socket.on('message', (raw) => {
      try {
        const m = JSON.parse(String(raw)) as { type?: unknown; data?: unknown; cols?: unknown; rows?: unknown };
        if (m.type === 'input' && typeof m.data === 'string') p.write(m.data);
        else if (m.type === 'resize' && typeof m.cols === 'number' && typeof m.rows === 'number') {
          p.resize(m.cols, m.rows);
        }
      } catch { /* ignore malformed frames */ }
    });
    socket.on('close', () => {
      sub.dispose();
      p.kill();
      // Restore the canonical size ccd spawned with — a phone-sized drawer must
      // not leave the session shrunken (wrapped panes break capture parsing).
      void deps.tmux.resizeWindow(id, 220, 50);
    });
  });

  // Write routes: serialized per session through one KeyedQueue; injection
  // errors map to 409 with the {ok:false,...} body, unknown session ids to 404.
  const sendDeps: SendDeps = { tmux: deps.tmux, queue: new KeyedQueue() };
  const knownId = async (id: string): Promise<boolean> =>
    (await readRegistry(deps.io, deps.cfg)).some((r) => r.id === id);

  app.post('/api/sessions/:id/prompt', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await knownId(id))) return reply.code(404).send({ ok: false, error: 'unknown-session' });
    const body = (req.body ?? {}) as { text?: unknown; replaceDraft?: unknown; attachments?: unknown };
    const raw = Array.isArray(body.attachments) ? body.attachments : [];
    if (raw.length > MAX_ATTACHMENTS) {
      return reply.code(400).send({ ok: false, error: 'bad-attachment' });
    }
    const attachments: string[] = [];
    for (const a of raw) {
      if (typeof a !== 'string') return reply.code(400).send({ ok: false, error: 'bad-attachment' });
      const name = a.slice(a.lastIndexOf('/') + 1);
      if (!CLIP_NAME_RE.test(name)) {
        return reply.code(400).send({ ok: false, error: 'bad-attachment' });
      }
      let resolved: string;
      try {
        resolved = clipPath(deps.cfg.clipsDir, id, name);
      } catch {
        return reply.code(400).send({ ok: false, error: 'bad-attachment' });
      }
      // The client must name the file that staging returned, in THIS session.
      if (resolved !== a) return reply.code(400).send({ ok: false, error: 'bad-attachment' });
      attachments.push(resolved);
    }
    if (typeof body.text !== 'string' || (body.text.length === 0 && attachments.length === 0)) {
      return reply.code(400).send({ ok: false, error: 'bad-request' });
    }
    const res = await sendPrompt(sendDeps, id, body.text, { replaceDraft: body.replaceDraft === true, attachments });
    return res.ok ? res : reply.code(409).send(res);
  });

  app.post('/api/sessions/:id/dialog', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await knownId(id))) return reply.code(404).send({ ok: false, error: 'unknown-session' });
    const body = (req.body ?? {}) as { dialogId?: unknown; optionIndex?: unknown };
    if (typeof body.dialogId !== 'string' || typeof body.optionIndex !== 'number') {
      return reply.code(400).send({ ok: false, error: 'bad-request' });
    }
    const res = await answerDialog(sendDeps, id, body.dialogId, body.optionIndex);
    return res.ok ? res : reply.code(409).send(res);
  });

  app.get('/api/sessions/:id/commands', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await knownId(id))) return reply.code(404).send({ ok: false, error: 'unknown-session' });
    return sessionCommands(deps, id);
  });

  app.post('/api/sessions/:id/interrupt', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await knownId(id))) return reply.code(404).send({ ok: false, error: 'unknown-session' });
    const res = await interrupt(sendDeps, id, async () => (await liveStatus(deps.io, deps.cfg, deps.tmux, id)) === 'busy');
    return res.ok ? res : reply.code(409).send(res);
  });

  // Lifecycle + projects routes: shell out to ccd; failures map to 502 with
  // stderr. Named for the response shape it adds, not for the call it makes —
  // `deps.runCcd` is the call, and routes needing another shape (a 200 carrying
  // `phase:unknown`, a parsed WsAudit/ReapResult, a 501 hoisted out of a queued
  // fn) compose from `deps.runCcd` directly rather than reaching for a runner.
  const runCcdOr502 = async (reply: FastifyReply, argv: CcdArgv) => {
    const res = await deps.runCcd(argv);
    return res.ok ? { ok: true } : reply.code(502).send({ ok: false, stderr: res.stderr });
  };

  app.get('/api/projects', async () => listProjects(deps.io, deps.cfg));

  app.post('/api/sessions', async (req, reply) => {
    const body = (req.body ?? {}) as { wrapper?: unknown; project?: unknown; workdir?: unknown; enable?: unknown };
    if (typeof body.wrapper !== 'string' || body.wrapper.length === 0
      || typeof body.project !== 'string' || body.project.length === 0) {
      return reply.code(400).send({ ok: false, error: 'bad-request' });
    }
    // enable = start + systemd enable. The ternary picks the ENTRY rather than
    // interpolating a verb into an array, so both spellings are enumerated by
    // whitelist-subset.test.ts and neither can drift out of the agent's list.
    const workdir = typeof body.workdir === 'string' && body.workdir.length > 0 ? body.workdir : undefined;
    return runCcdOr502(reply, body.enable === false
      ? CCD_ARGV.start(body.wrapper, body.project, workdir)
      : CCD_ARGV.enable(body.wrapper, body.project, workdir));
  });

  app.post('/api/sessions/:id/ensure', async (req, reply) => {
    const { id } = req.params as { id: string };
    return runCcdOr502(reply, CCD_ARGV.ensure(id));
  });

  app.post('/api/projects/:project/workspaces', async (req, reply) => {
    const { project } = req.params as { project: string };
    return runCcdOr502(reply, CCD_ARGV.wsAdd(project));
  });

  app.post('/api/sessions/:id/stop', async (req, reply) => {
    const { id } = req.params as { id: string };
    const rec = (await readRegistry(deps.io, deps.cfg)).find((r) => r.id === id);
    if (!rec) return reply.code(404).send({ ok: false, error: 'unknown-session' });
    // A workspace id is `<project>-<slug>` and encodes no wrapper at all, so
    // there is nothing to reverse: the prefix rule below would fall through to
    // rec.wrapper and ccd would recompute `<wrapper>-<project>` — a DIFFERENT,
    // live session, killed while the workspace kept running and the PWA
    // reported success. ccd stop's one-argument form takes the id whole.
    if (rec.workspace !== null) return runCcdOr502(reply, CCD_ARGV.stopId(id));
    // Legacy ids DO encode a wrapper, and ccd stop's two-argument form
    // recomputes them — so it needs the ORIGINAL wrapper baked into the id, not
    // rec.wrapper, which a prior swap flips to the new account while the
    // id/tmux name keep the old prefix.
    const originalWrapper = id.endsWith(`-${rec.project}`)
      ? id.slice(0, id.length - rec.project.length - 1)
      : rec.wrapper;
    return runCcdOr502(reply, CCD_ARGV.stopPair(originalWrapper, rec.project));
  });

  // Image upload: stage the bytes under ~/.cc-clips/<id>/ and return the path.
  // Nothing is typed into the session — the prompt route injects it at send.
  app.post('/api/sessions/:id/upload', async (req, reply) => {
    const { id } = req.params as { id: string };
    // Both gates run BEFORE req.file(). Replying without consuming the multipart
    // body can cost the client the JSON response, so drain first — same reason
    // the 415 path below calls part.file.resume().
    if (!isSafeSessionId(id)) {
      req.raw.resume();
      return reply.code(400).send({ ok: false, error: 'bad-session-id' });
    }
    if (!(await knownId(id))) {
      req.raw.resume();
      return reply.code(404).send({ ok: false, error: 'unknown-session' });
    }
    const part = await req.file();
    if (!part) return reply.code(400).send({ ok: false, error: 'bad-request' });
    const m = /\.(png|jpe?g|webp)$/i.exec(part.filename ?? '');
    if (!m) {
      part.file.resume();   // drain the rejected stream so the request finishes cleanly
      return reply.code(415).send({ ok: false, error: 'unsupported-type' });
    }
    const data = await part.toBuffer();
    if (data.byteLength > MAX_UPLOAD_BYTES) {
      return reply.code(413).send({ ok: false, error: 'too-large' });
    }
    const clip = await stageUpload(deps.io, deps.cfg, id, data, m[1]!.toLowerCase());
    return { ok: true, clip };
  });

  // Thumbnails for sent messages. Names are unique, so the bytes behind one can
  // never change — hence `immutable`.
  app.get('/api/sessions/:id/clip/:name', async (req, reply) => {
    const { id, name } = req.params as { id: string; name: string };
    if (!isSafeSessionId(id) || !CLIP_NAME_RE.test(name)) {
      return reply.code(400).send({ ok: false, error: 'bad-request' });
    }
    // `ccd stop` leaves the registry entry, so a stopped session's thumbnails
    // still resolve.
    if (!(await knownId(id))) return reply.code(404).send({ ok: false, error: 'unknown-session' });
    let file: string;
    try {
      file = clipPath(deps.cfg.clipsDir, id, name);
    } catch {
      return reply.code(400).send({ ok: false, error: 'bad-request' });
    }
    const b64 = await deps.io.readFileB64(file);
    if (b64 === null) return reply.code(404).send({ ok: false, error: 'not-found' });
    const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
    return reply
      .type(CLIP_MIME[ext] ?? 'application/octet-stream')
      .header('cache-control', 'private, max-age=31536000, immutable')
      .send(Buffer.from(b64, 'base64'));
  });

  app.post('/api/sessions/:id/swap', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { wrapper?: unknown };
    if (typeof body.wrapper !== 'string' || body.wrapper.length === 0) {
      return reply.code(400).send({ ok: false, error: 'bad-request' });
    }
    return runCcdOr502(reply, CCD_ARGV.swap(id, body.wrapper));
  });

  // ── PR lifecycle ────────────────────────────────────────────────
  // Every one of these calls isSafeSessionId FIRST: the deleted workspace
  // route did not, and an id is about to become part of an argv.
  const prTasks = async (id: string): Promise<TaskItem[] | null> => {
    const rec = (await readRegistry(deps.io, deps.cfg)).find((r) => r.id === id);
    const cfgDir = rec ? deps.cfg.wrappers[rec.wrapper] : undefined;
    return rec && cfgDir ? readTasks(deps.io, cfgDir, rec.uuid) : null;
  };

  app.get('/api/sessions/:id/pr', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!isSafeSessionId(id)) return reply.code(400).send({ ok: false, error: 'bad-session-id' });
    if (!(await knownId(id))) return reply.code(404).send({ ok: false, error: 'unknown-session' });
    const argv = CCD_ARGV.prStateSession(id);
    // Both of these are ANSWERS, not errors and never 502s: the cap must still
    // render, name the reason and offer Retry. `unknownView` is the only way
    // either is built — a branch returning a bare `{}` with no `pr` key is the
    // silence §2 forbids, and the client would render it as "no control" rather
    // than "we could not look".
    if (!verbSupported(deps.fleetState, argv)) return unknownView('unsupported');
    const res = await deps.runCcd(argv);
    if (!res.ok) return unknownView('agent-down');
    const [first] = parsePrLines(res.stdout);
    return prView(first ?? null, await prTasks(id), null);
  });

  app.post('/api/sessions/:id/pr', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!isSafeSessionId(id)) return reply.code(400).send({ ok: false, error: 'bad-session-id' });
    if (!(await knownId(id))) return reply.code(404).send({ ok: false, error: 'unknown-session' });
    const body = (req.body ?? {}) as { title?: unknown; body?: unknown; draft?: unknown };
    if (typeof body.title !== 'string' || body.title.trim() === ''
      || typeof body.body !== 'string' || body.body.trim() === '') {
      return reply.code(400).send({ ok: false, error: 'bad-request' });
    }
    const b64 = Buffer.from(body.body, 'utf8').toString('base64');
    const argv = CCD_ARGV.prOpen(id, body.title, b64, body.draft === true);
    // Hoisted OUT of the queued fn, mirroring the reap route below. A 501 sent
    // from inside the queue callback returns a FastifyReply, which has no `ok`,
    // so the old `'ok' in res` guard fell through and reply.code(502).send()
    // ran after send() had already fired — FST_ERR_REP_ALREADY_SENT.
    if (!verbSupported(deps.fleetState, argv)) {
      return reply.code(501).send({ ok: false, error: 'unsupported' });
    }
    // Through the per-session queue, so it serialises with every other write.
    const r = await sendDeps.queue.run(id, () => deps.runCcd(argv));
    return r.ok ? { ok: true } : reply.code(502).send({ ok: false, stderr: r.stderr });
  });

  app.post('/api/sessions/:id/archive', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!isSafeSessionId(id)) return reply.code(400).send({ ok: false, error: 'bad-session-id' });
    if (!(await knownId(id))) return reply.code(404).send({ ok: false, error: 'unknown-session' });
    const argv = CCD_ARGV.wsArchive(id);
    // `ws-archive` is the SAME verb generation as `ws-audit` and `ws-reap` —
    // all four were added by this branch and all four sit consecutively in
    // `ccd caps` — so a fleet host on an older ccd dies in the verb's own
    // usage check, and `runCcdOr502` renders that as a bare 502 "the archive
    // failed". Same 501 body as every sibling, so the client can tell
    // "this host cannot" from "it tried and could not".
    if (!verbSupported(deps.fleetState, argv)) {
      return reply.code(501).send({ ok: false, error: 'unsupported' });
    }
    return runCcdOr502(reply, argv);
  });

  app.post('/api/sessions/:id/restore', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!isSafeSessionId(id)) return reply.code(400).send({ ok: false, error: 'bad-session-id' });
    if (!(await knownId(id))) return reply.code(404).send({ ok: false, error: 'unknown-session' });
    const argv = CCD_ARGV.wsRestore(id);
    // Same generation, same skew, same answer as `/archive` above.
    if (!verbSupported(deps.fleetState, argv)) {
      return reply.code(501).send({ ok: false, error: 'unsupported' });
    }
    return runCcdOr502(reply, argv);
  });

  app.get('/api/sessions/:id/workspace/audit', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!isSafeSessionId(id)) return reply.code(400).send({ ok: false, error: 'bad-session-id' });
    if (!(await knownId(id))) return reply.code(404).send({ ok: false, error: 'unknown-session' });
    const argv = CCD_ARGV.wsAudit(id);
    // integration New Finding 10 — against a fleet host running a ccd without
    // `ws-audit`, the call went out anyway, ccd answered on stderr, `parseAudit`
    // returned null and the route 502'd — so version skew rendered as a failure
    // of the workspace rather than as the "unsupported" answer the rest of the
    // branch gives. Same shape and same body as the reap route below, which is
    // the route this one exists to feed: a 501 the client can tell apart from
    // "ccd tried and could not".
    //
    // ROUND-3 CORRECTION. The sentence that stood here claimed this was "the
    // ONE ccd route with no `verbSupported` gate (measured: server.ts:434,
    // :456, :499 had it, the audit route did not)". That was FALSE, and the
    // measurement it cited is why: it grepped for the routes that ALREADY HAD
    // a gate, not for the routes that NEEDED one. `/archive`, `/restore` and
    // `FleetWatcher.archiveMerged` were all missing theirs, all three are the
    // same verb generation as this route, and all three were added by this
    // same branch. All three are gated now. The claim of completeness is no
    // longer made in prose: `verb-gate.test.ts` parses `server/src` for every
    // `CCD_ARGV.*` call site and fails on an ungated one it has not been told
    // about, so the next omission breaks a test instead of being asserted away
    // by a comment.
    if (!verbSupported(deps.fleetState, argv)) {
      return reply.code(501).send({ ok: false, error: 'unsupported' });
    }
    const res = await deps.runCcd(argv);
    const audit = parseAudit(res.stdout);
    if (audit === null) return reply.code(502).send({ ok: false, stderr: res.stderr });
    return audit;
  });

  app.post('/api/sessions/:id/workspace/reap', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!isSafeSessionId(id)) return reply.code(400).send({ ok: false, error: 'bad-session-id' });
    if (!(await knownId(id))) return reply.code(404).send({ ok: false, error: 'unknown-session' });
    const body = (req.body ?? {}) as { expect?: unknown };
    // The shape check is a courtesy, not the guard: the guard is that ccd
    // recomputes the fingerprint and compares it there.
    if (typeof body.expect !== 'string' || !/^[0-9a-f]{64}$/.test(body.expect)) {
      return reply.code(400).send({ ok: false, error: 'bad-request' });
    }
    const argv = CCD_ARGV.wsReap(body.expect, id);
    if (!verbSupported(deps.fleetState, argv)) {
      return reply.code(501).send({ ok: false, error: 'unsupported' });
    }
    const res = await sendDeps.queue.run(id, () => deps.runCcd(argv));
    return parseReap(res.stdout, res.ok ? 0 : 1, res.stderr);
  });

  // Static PWA (populated by Plan 2's build): serve dist-pwa/ at / with SPA
  // fallback to index.html; absent -> skip (API-only mode).
  const pwaRoot = findPwaRoot();
  if (pwaRoot) {
    await app.register(fastifyStatic, { root: pwaRoot });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api') && !req.url.startsWith('/ws')) {
        return reply.type('text/html').sendFile('index.html');
      }
      return reply.code(404).send({ ok: false, error: 'not-found' });
    });
  }

  if (watcher) app.addHook('onClose', async () => { watcher.stop(); });
  return app;
}
