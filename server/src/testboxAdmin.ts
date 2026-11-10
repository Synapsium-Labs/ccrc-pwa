import { spawn } from 'node:child_process';
import { constants as osConstants } from 'node:os';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  TESTBOX_ADMIN_CAP, type TestboxAdminActAnswer, type TestboxAdminAnswer, type TestboxAdminResult,
} from '../../shared/api.js';
import {
  TESTBOX_ADMIN_DRAIN_MS, TESTBOX_ADMIN_KILL_GRACE_MS, TESTBOX_ADMIN_LONG_TIMEOUT_MS, TESTBOX_ADMIN_OUTPUT_MAX_BYTES,
  TESTBOX_ADMIN_SHORT_TIMEOUT_MS, updateLauncherPath, type TestboxAdminAsked,
} from '../../shared/agent-protocol.js';
import type { RouteRefusal } from '../../shared/refusal.js';
import {
  TESTBOX_ADMIN_CODES, TESTBOX_ADMIN_SUBS, TESTBOX_BOX_KEYS, TESTBOX_HOST_KEYS, buildTestboxAdminArgv, isHostKeyFingerprint,
  isTestboxAdminSub, readTestboxAdminStatus, testboxAdminIsLong,
  type TestboxAct, type TestboxAdminCode, type TestboxAdminFields, type TestboxAdminStatus, type TestboxAdminSub,
} from '../../shared/testbox-admin.js';
import { boundedStdinSpawn } from '../../shared/spawn.mjs';
import { accountSpawnEnv } from './accounts/ops.js';
import { credentialBodyRoute, type AccountGate } from './accounts/gate.js';
import type { CcrcConfig } from './config.js';
import type { FleetIO } from './io.js';
import { refuseRoute } from './refuse.js';
import type { TestboxAudit, TestboxEventInput } from './testboxAudit.js';

/**
 * THE TEST BOX CONNECT ROUTES (spec §2.1, §2.6, §2.10, §2.11, C14, T3, T10; plan TC12, D-8166): `GET /api/testbox/admin` and
 * `POST /api/testbox/admin/:sub`, and the `TestboxAdminOps` port they run the `ccrc testbox-admin` verb through. L4 over L2
 * ports, on `accounts/routes.ts`'s shape.
 *
 *  - SESSION-ONLY, behind the account gate (`accounts/gate.ts`): auth off, an insecure origin, any verdict but a session, the
 *    fleet's measured `testbox-admin-v1` cap, and, for the four subs whose spec says so (`key`, `pin`, `connect`,
 *    `disconnect`: they put, replace or remove a credential or a pin), a recent step-up. The gate runs before the body is
 *    read or the fleet asked. No box token reaches these routes, and no route is in `EXEMPT`.
 *  - THE BODY IS `{fields}` ONLY. `fields` passes `buildTestboxAdminArgv` (the ONE bounded builder both arms and the agent
 *    call) before any op; a field off its grammar is a 400 and nothing runs. No caller field can name `--from`.
 *  - THE ANSWER IS RE-READ, NEVER INFERRED. After an act that ran, the route asks `status` again and answers that, with the
 *    ten newest ledger rows and the one thing the act may say (`TestboxAdminResult`: the PUBLIC access line, the fingerprint
 *    the box presented, the preflight rows, a long act's id). A status the one reader refuses is a fleet failure.
 *  - A REFUSAL IS A WORD, NEVER THE VERB'S SENTENCE. The verb's JSON names a closed code; only a code in
 *    `TESTBOX_ADMIN_CODES` crosses, as `testbox-admin-refused` with `code` (and `keys`, the settings it names, in the two
 *    key lists). Anything else is `fleetFailed`.
 *  - AN UNKNOWN OUTCOME IS SAID SO. A timeout, a lost answer or an output past its cap is `outcome-unknown`; the route never
 *    retries (D-5518).
 *  - Every short act writes one `testbox_events` row (`testboxAudit.ts`); a long act writes one only when it never started
 *    (its end row comes from the lane, keyed by `actId`). A failed ledger write is an answer, never a throw.
 *  - NOTHING SECRET IS READ OR SAID. The routes never open the token, the push key or the access key; the verb's JSON never
 *    carries them, and a field outside the closed result shapes is dropped.
 */

/** What one run answered: the node's outcome, or one of the link's two (`TestboxAdminAsked`). */
export type TestboxAdminOutcome = TestboxAdminAsked;

/** The port. */
export interface TestboxAdminOps {
  /** Which arm this is, for the composition root's own check and the tests. Never a decision input for a route. */
  readonly arm: 'local' | 'remote';
  /** Runs `ccrc testbox-admin <sub>` with `fields`. Never throws. */
  run(sub: TestboxAdminSub, fields: TestboxAdminFields): Promise<TestboxAdminOutcome>;
}

export interface LocalTestboxAdminOpsOpts {
  /** `cfg.home`: the launcher is `<home>/.local/bin/ccrc`, the unit's PATH lacking `~/.local/bin`. */
  home: string;
  /** Tests only: the SIGTERM to SIGKILL grace. */
  killGraceMs?: number;
  /** Tests only: a call's bound. Production reads the agent protocol's (60 s for a short sub, 30 s for a long sub's detach). */
  timeoutMs?: (long: boolean) => number;
  /** Tests only: the stdout cap. */
  maxOutputBytes?: number;
}

/**
 * The local arm: the verb spawned on this box, which in local fleet mode IS the fleet node. The builder's argv and the
 * template's own `--from pwa`; NO stdin (empty, then EOF); the explicit `{HOME, PATH, LANG}` environment, never the server's
 * own (which carries `CCRC_AGENT_TOKEN`, `CCRC_VAPID_PRIVATE` and `CCRC_HETZNER_TOKEN`); stdout capped at 1 MiB; the group
 * gets SIGTERM at the bound and SIGKILL after the grace (`shared/spawn.mjs#boundedStdinSpawn`, the agent arm's body too).
 */
export function localTestboxAdminOps(opts: LocalTestboxAdminOpsOpts): TestboxAdminOps {
  const env = accountSpawnEnv(opts.home);
  const run: TestboxAdminOps['run'] = async (sub, fields) => {
    const built = buildTestboxAdminArgv(sub, fields);
    if (!built.ok) return { kind: 'refused', why: built.why };
    // Resolved per call, as the account arm does, so a home it refuses answers `not-started` and never crashes the boot.
    let launcher: string;
    try { launcher = updateLauncherPath(opts.home); } catch { return { kind: 'not-started' }; }
    const long = testboxAdminIsLong(sub, fields);
    const timeoutMs = opts.timeoutMs?.(long) ?? (long ? TESTBOX_ADMIN_LONG_TIMEOUT_MS : TESTBOX_ADMIN_SHORT_TIMEOUT_MS);
    return boundedStdinSpawn({ spawn, signals: osConstants.signals }, launcher, [...built.argv, '--from', 'pwa'], null, {
      env: { ...env }, timeoutMs, killGraceMs: opts.killGraceMs ?? TESTBOX_ADMIN_KILL_GRACE_MS,
      maxOutputBytes: opts.maxOutputBytes ?? TESTBOX_ADMIN_OUTPUT_MAX_BYTES, drainMs: TESTBOX_ADMIN_DRAIN_MS,
    });
  };
  return { arm: 'local', run };
}

/** The agent arm: `FleetIO.testboxAdmin`, which builds, gates on `ready.ops` and sends the typed frame. */
export function agentTestboxAdminOps(io: Pick<FleetIO, 'testboxAdmin'>): TestboxAdminOps {
  return { arm: 'remote', run: async (sub, fields) => { try { return await io.testboxAdmin(sub, fields); } catch { return { kind: 'lost' }; } } };
}

/** THE ONE CHOICE: `cfg.fleetMode` and nothing else. A remote fleet never gets the local spawner. */
export function testboxAdminOpsFor(cfg: Pick<CcrcConfig, 'fleetMode' | 'home'>, io: Pick<FleetIO, 'testboxAdmin'>): TestboxAdminOps {
  return cfg.fleetMode === 'remote' ? agentTestboxAdminOps(io) : localTestboxAdminOps({ home: cfg.home });
}

// ── reading what the verb printed ────────────────────────────────────────────────────────────────────────────────────

/** The verb's one JSON line, read whole or by its last line; null when neither is a JSON object. */
function jsonOf(stdout: string): Record<string, unknown> | null {
  const text = stdout.trim();
  for (const candidate of [text, text.slice(text.lastIndexOf('\n') + 1)]) {
    try {
      const j: unknown = JSON.parse(candidate);
      if (typeof j === 'object' && j !== null && !Array.isArray(j)) return j as Record<string, unknown>;
    } catch { /* not this candidate */ }
  }
  return null;
}

const CODE_SET: ReadonlySet<string> = new Set(TESTBOX_ADMIN_CODES);
const KEY_SET: ReadonlySet<string> = new Set([...TESTBOX_HOST_KEYS, ...TESTBOX_BOX_KEYS]);

/** What one run means for the route. */
export type Decision =
  | { kind: 'ok'; json: Record<string, unknown> }
  | { kind: 'refuse'; word: RouteRefusal; extra: Readonly<Record<string, unknown>>; audit: 'refused' | 'failed' | 'unknown'; code: TestboxAdminCode | RouteRefusal };

/** The settings a refusal names: only keys this build knows, each once. */
const keysOf = (v: unknown): string[] =>
  Array.isArray(v) ? [...new Set(v.filter((k): k is string => typeof k === 'string' && KEY_SET.has(k)))] : [];

/** Pure: an outcome as the route's decision. The verb's JSON is read, never its sentence. */
export function decisionOf(ran: TestboxAdminOutcome): Decision {
  switch (ran.kind) {
    case 'refused': return { kind: 'refuse', word: 'bad-request', extra: {}, audit: 'refused', code: 'bad-request' };
    case 'unsupported': return { kind: 'refuse', word: 'unsupported', extra: {}, audit: 'refused', code: 'unsupported' };
    case 'not-started': return { kind: 'refuse', word: 'fleetFailed', extra: {}, audit: 'failed', code: 'fleetFailed' };
    case 'timeout': case 'too-large': case 'lost':
      return { kind: 'refuse', word: 'outcome-unknown', extra: {}, audit: 'unknown', code: 'outcome-unknown' };
    case 'exited': {
      const j = jsonOf(ran.stdout);
      if (j !== null && j['ok'] === false && typeof j['code'] === 'string' && CODE_SET.has(j['code'])) {
        const keys = keysOf(j['keys']);
        return {
          kind: 'refuse', word: 'testbox-admin-refused', audit: 'refused', code: j['code'] as TestboxAdminCode,
          extra: keys.length > 0 ? { code: j['code'], keys } : { code: j['code'] },
        };
      }
      if (j !== null && j['ok'] === true && ran.code === 0) return { kind: 'ok', json: j };
      return { kind: 'refuse', word: 'fleetFailed', extra: {}, audit: 'failed', code: 'fleetFailed' };
    }
  }
}

/** One printable ASCII line, 1 to 1024 characters: the shape of a public access line. */
const lineOf = (v: unknown): string | undefined =>
  typeof v === 'string' && v.length >= 1 && v.length <= 1024 && /^[\x20-\x7e]+$/.test(v) ? v : undefined;
const CHECK_RE = /^[a-z][a-z-]{0,23}$/;

/** What `sub`'s answer may say beyond the status: each piece held to its grammar, anything else dropped. */
export function resultOf(sub: TestboxAdminSub, j: Record<string, unknown>): TestboxAdminResult {
  const out: TestboxAdminResult = {};
  if (sub === 'key') {
    const line = lineOf(j['line']);
    if (line !== undefined) out.line = line;
  } else if (sub === 'probe' || sub === 'pin') {
    if (isHostKeyFingerprint(j['fingerprint'])) out.fingerprint = j['fingerprint'];
  } else if (sub === 'preflight') {
    if (typeof j['pass'] === 'boolean') out.pass = j['pass'];
    if (Array.isArray(j['checks']) && j['checks'].length <= 16) {
      const rows: NonNullable<TestboxAdminResult['checks']> = [];
      for (const c of j['checks'] as unknown[]) {
        if (typeof c !== 'object' || c === null) continue;
        const r = c as Record<string, unknown>;
        const code = r['code'];
        if (typeof r['check'] !== 'string' || !CHECK_RE.test(r['check']) || typeof r['ok'] !== 'boolean') continue;
        if (code !== null && !(typeof code === 'string' && CODE_SET.has(code))) continue;
        rows.push({ check: r['check'], ok: r['ok'], code: code as TestboxAdminCode | null });
      }
      out.checks = rows;
    }
    const fix = lineOf(j['line']);
    if (fix !== undefined) out.fixLine = fix;
  } else if (sub === 'cancel') {
    if (typeof j['cancelled'] === 'boolean') out.cancelled = j['cancelled'];
  }
  if (TESTBOX_ADMIN_SUBS[sub].long || sub === 'settings-box') {
    if (typeof j['act'] === 'string' && /^[0-9a-f]{32}$/.test(j['act'])) out.act = j['act'];
  }
  return out;
}

/** The ledger act a call records, or null for a read. `disconnect --replace` is `replace`. */
function actOf(sub: TestboxAdminSub, fields: TestboxAdminFields): TestboxAct | null {
  if (sub === 'disconnect' && (fields['replace'] === true || fields['replace'] === 'true')) return 'replace';
  return TESTBOX_ADMIN_SUBS[sub].act;
}

// ── the routes ───────────────────────────────────────────────────────────────────────────────────────────────────────

export interface TestboxAdminRouteDeps {
  /** The account gate (`accounts/gate.ts`). REQUIRED: a route with no gate is a fleet act any reader could run. */
  gate: AccountGate;
  /** The ONE `TestboxAdminOps` arm. */
  ops: Pick<TestboxAdminOps, 'run'>;
  /** The ledger, absent in a test or script that wants none. */
  audit?: Pick<TestboxAudit, 'write' | 'recent'>;
  /** The node-id of the fleet the act ran against, or null when it is not known. */
  fleetIdentity: () => string | null;
}

/** The ledger rows the answer carries. */
const EVENTS_SHOWN = 10;
/** The body cap: up to four repository rows of 8 KiB, their settings, and the JSON around them. */
const BODY_LIMIT = 128 * 1024;

/** The body's `fields`, or null for a body that is not exactly `{fields}` (an absent body is no fields). */
function fieldsOf(req: FastifyRequest): Record<string, unknown> | null {
  const b = req.body;
  if (b === undefined || b === null) return {};
  if (typeof b !== 'object' || Array.isArray(b)) return null;
  const proto = Object.getPrototypeOf(b) as unknown;
  if (proto !== Object.prototype && proto !== null) return null;
  const keys = Object.keys(b);
  if (keys.length === 0) return {};
  if (keys.length !== 1 || keys[0] !== 'fields') return null;
  const f = (b as { fields: unknown }).fields;
  return typeof f === 'object' && f !== null && !Array.isArray(f) ? f as Record<string, unknown> : null;
}

export function registerTestboxAdminRoutes(app: FastifyInstance, deps: TestboxAdminRouteDeps): void {
  const events = () => deps.audit?.recent(EVENTS_SHOWN) ?? [];

  /** `status`, run and read by the one reader (its document has no `ok`), or the decision to refuse with. */
  const readStatus = async (): Promise<{ ok: true; status: TestboxAdminStatus } | { ok: false; d: Extract<Decision, { kind: 'refuse' }> }> => {
    const ran = await deps.ops.run('status', {});
    if (ran.kind === 'exited' && ran.code === 0) {
      const text = ran.stdout.trim();
      const read = readTestboxAdminStatus(text.slice(text.lastIndexOf('\n') + 1));
      if (read.ok) return { ok: true, status: read.value };
    }
    const d = decisionOf(ran);
    return { ok: false, d: d.kind === 'refuse' ? d : { kind: 'refuse', word: 'fleetFailed', extra: {}, audit: 'failed', code: 'fleetFailed' } };
  };

  app.get('/api/testbox/admin', async (req: FastifyRequest, reply: FastifyReply): Promise<unknown> => {
    const g = deps.gate(req, reply, { cap: TESTBOX_ADMIN_CAP });
    if (!g.pass) return reply;
    const s = await readStatus();
    if (!s.ok) return refuseRoute(reply, s.d.word, s.d.extra);
    return { ok: true, status: s.status, events: events() } satisfies TestboxAdminAnswer;
  });

  app.post('/api/testbox/admin/:sub', credentialBodyRoute(BODY_LIMIT), async (req: FastifyRequest, reply: FastifyReply): Promise<unknown> => {
    // The sub is a PATH parameter, so the gate can ask the right step-up of it before any body is read.
    const raw = (req.params as { sub?: unknown }).sub;
    const sub = isTestboxAdminSub(raw) && raw !== 'status' ? raw : null;
    const g = deps.gate(req, reply, { cap: TESTBOX_ADMIN_CAP, stepUp: sub !== null && TESTBOX_ADMIN_SUBS[sub].stepUp });
    if (!g.pass) return reply;
    if (sub === null) return refuseRoute(reply, 'bad-request');
    const fields = fieldsOf(req);
    if (fields === null || !buildTestboxAdminArgv(sub, fields).ok) return refuseRoute(reply, 'bad-request');
    const typed = fields as TestboxAdminFields;
    const long = testboxAdminIsLong(sub, typed);
    const act = actOf(sub, typed);
    const row = (e: Omit<TestboxEventInput, 'act' | 'fleetIdentity' | 'actor'>): void => {
      if (act === null || deps.audit === undefined) return;
      const pinned = sub === 'pin' && isHostKeyFingerprint(typed['fingerprint']) ? { fingerprint: typed['fingerprint'] } : {};
      deps.audit.write({ ...e, ...pinned, act, fleetIdentity: deps.fleetIdentity(), actor: g.actor });
    };

    const d = decisionOf(await deps.ops.run(sub, typed));
    if (d.kind === 'refuse') {
      row({ outcome: d.audit, code: d.code });
      return refuseRoute(reply, d.word, d.extra);
    }
    // A short act writes its row on answer; a long act that started writes none (the lane writes its end row by act id).
    if (!long) row({ outcome: 'ok' });
    const after = await readStatus();
    if (!after.ok) return refuseRoute(reply, after.d.word, { ...after.d.extra, acted: true });
    return { ok: true, status: after.status, events: events(), result: resultOf(sub, d.json) } satisfies TestboxAdminActAnswer;
  });
}
