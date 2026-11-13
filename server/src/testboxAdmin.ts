import { spawn } from 'node:child_process';
import { constants as osConstants } from 'node:os';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  TESTBOX_ADMIN_CAP, TESTBOX_PARITY_REQUIRED_SENTENCE, type BoxSettingRow, type TestboxAdminActAnswer, type TestboxAdminAnswer, type TestboxAdminResult,
} from '../../shared/api.js';
import {
  TESTBOX_ADMIN_DRAIN_MS, TESTBOX_ADMIN_KILL_GRACE_MS, TESTBOX_ADMIN_LONG_TIMEOUT_MS, TESTBOX_ADMIN_OUTPUT_MAX_BYTES,
  TESTBOX_ADMIN_SHORT_TIMEOUT_MS, updateLauncherPath, type TestboxAdminAsked,
} from '../../shared/agent-protocol.js';
import type { RouteRefusal } from '../../shared/refusal.js';
import {
  TESTBOX_ADMIN_CODES, TESTBOX_ADMIN_SUBS, TESTBOX_BOX_KEYS, TESTBOX_HOST_KEYS, TESTBOX_LINE_CODES, buildTestboxAdminArgv, isHostKeyFingerprint,
  isTestboxAdminSub, parityArmable, parityCurrentOf, readTestboxAdminStatus, readTestboxLedgerChanges, testboxAdminIsLong, testboxAdminNeedsStepUp,
  testboxLedgerShowsValue, testboxLedgerValueOf, testboxLedgerValueOfRow,
  type TestboxAct, type TestboxActOutcome, type TestboxAdminCode, type TestboxAdminFields, type TestboxAdminStatus, type TestboxAdminSub,
  type TestboxLedgerValue, type TestboxSettingChange,
} from '../../shared/testbox-admin.js';
import { boundedStdinSpawn } from '../../shared/spawn.mjs';
import { accountSpawnEnv } from './accounts/ops.js';
import { actorOf, type AccountActor } from './accounts/audit.js';
import { parseCookies, SESSION_COOKIE } from './auth/cookie.js';
import { sessionIdHash } from './auth/sessions.js';
import { capSupported } from './ccdargv.js';
import type { FleetState } from './fleetstate.js';
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
 *    fleet's measured `testbox-admin-v1` cap, and, for the subs whose spec says so (`key`, `pin`, `connect`,
 *    `disconnect`, and D-8337's `key-rotate` and `key-revoke`: they put, replace or remove a credential or a pin), a recent step-up. The gate runs before the body is
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
 *  - A SETTINGS ACT'S ROW CARRIES ITS OLD AND NEW VALUES (D-8399): `settings-fleet`'s from the verb's own answer (`before` and
 *    `settings`, the one reader's rows either side of the write); `settings-box`'s old values from the status's box settings,
 *    read before the act, and its new ones from the sent values read through their shapes, staged by the act's id for the lane's
 *    end row. Each value goes through `testboxLedgerValueOf`, so a secret-bearing setting, a path, an address or a list is a
 *    presence word. A refused act records none.
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
const LINE_CODE_SET: ReadonlySet<string> = new Set(TESTBOX_LINE_CODES);
const KEY_SET: ReadonlySet<string> = new Set([...TESTBOX_HOST_KEYS, ...TESTBOX_BOX_KEYS]);

/** What one run means for the route. */
export type Decision =
  | { kind: 'ok'; json: Record<string, unknown> }
  | { kind: 'refuse'; word: RouteRefusal; extra: Readonly<Record<string, unknown>>; audit: 'refused' | 'failed' | 'unknown'; code: TestboxAdminCode | RouteRefusal };

/** One printable ASCII line, 1 to 1024 characters: the shape of a public access line. */
const lineOf = (v: unknown): string | undefined =>
  typeof v === 'string' && v.length >= 1 && v.length <= 1024 && /^[\x20-\x7e]+$/.test(v) ? v : undefined;

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
        // D-8337: a refusal that leaves a line on the box for the operator to remove names that key's PUBLIC words, one line.
        const line = LINE_CODE_SET.has(j['code']) ? lineOf(j['line']) : undefined;
        return {
          kind: 'refuse', word: 'testbox-admin-refused', audit: 'refused', code: j['code'] as TestboxAdminCode,
          extra: { code: j['code'], ...(keys.length > 0 ? { keys } : {}), ...(line === undefined ? {} : { line }) },
        };
      }
      if (j !== null && j['ok'] === true && ran.code === 0) return { kind: 'ok', json: j };
      return { kind: 'refuse', word: 'fleetFailed', extra: {}, audit: 'failed', code: 'fleetFailed' };
    }
  }
}

const CHECK_RE = /^[a-z][a-z-]{0,23}$/;

/** What `sub`'s answer may say beyond the status: each piece held to its grammar, anything else dropped. */
export function resultOf(sub: TestboxAdminSub, j: Record<string, unknown>): TestboxAdminResult {
  const out: TestboxAdminResult = {};
  if (sub === 'key' || sub === 'key-rotate') {
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

// ── a settings act's old and new values (D-8399) ─────────────────────────────────────────────────────────────────────

/** The keys a settings call changes and the keys it resets, in the builder's order (the sent settings, then the resets). */
function settingsKeysOf(fields: TestboxAdminFields): { set: [string, string][]; unset: string[] } {
  const set = fields['settings'];
  const unset = fields['unset'];
  return {
    set: typeof set === 'object' && set !== null && !Array.isArray(set)
      ? Object.entries(set as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === 'string') : [],
    unset: Array.isArray(unset) ? (unset as unknown[]).filter((k): k is string => typeof k === 'string') : [],
  };
}

/** The list the ledger takes, or undefined for none or for one its reader refuses (the row is then written without it). */
const changesOrNone = (c: TestboxSettingChange[]): TestboxSettingChange[] | undefined =>
  c.length > 0 && readTestboxLedgerChanges(c) !== null ? c : undefined;

/** One of the verb's settings rows (`{key, set, value?}`) for `key`, as a ledger value: `unknown` when the verb named no row. */
function answerValueOf(key: string, rows: unknown): TestboxLedgerValue {
  const row = Array.isArray(rows)
    ? (rows as unknown[]).find((r): r is Record<string, unknown> => typeof r === 'object' && r !== null && (r as Record<string, unknown>)['key'] === key)
    : undefined;
  if (row === undefined || typeof row['set'] !== 'boolean') return { presence: 'unknown' };
  if (!row['set']) return { presence: 'not-set' };
  return testboxLedgerShowsValue(key) && typeof row['value'] === 'string' ? testboxLedgerValueOf(key, row['value']) : { presence: 'set' };
}

/** `settings-fleet`'s changes, from the verb's answer: `before` is the old side (an older verb sends none: `unknown`), `settings`
 *  the new side as the reader reads it after the write; a reset key's new side is `default`. */
export function fleetChangesOf(fields: TestboxAdminFields, answer: Record<string, unknown>): TestboxSettingChange[] | undefined {
  const { set, unset } = settingsKeysOf(fields);
  return changesOrNone([
    ...set.map(([key]) => ({ key, old: answerValueOf(key, answer['before']), new: answerValueOf(key, answer['settings']) })),
    ...unset.map((key) => ({ key, old: answerValueOf(key, answer['before']), new: { presence: 'default' as const } })),
  ]);
}

/** `settings-box`'s changes: the old side from the status's box settings rows read before the act (null: `unknown`), the new side
 *  the sent value read through its key's shape, a reset key's `default`. */
export function boxChangesOf(fields: TestboxAdminFields, rows: readonly BoxSettingRow[] | null): TestboxSettingChange[] | undefined {
  const { set, unset } = settingsKeysOf(fields);
  const old = (key: string): TestboxLedgerValue => testboxLedgerValueOfRow(key, rows?.find((r) => r.key === key));
  return changesOrNone([
    ...set.map(([key, v]) => ({ key, old: old(key), new: testboxLedgerValueOf(key, v) })),
    ...unset.map((key) => ({ key, old: old(key), new: { presence: 'default' as const } })),
  ]);
}

/** The ledger act a call records, or null for a read. `disconnect --replace` is `replace`. */
function actOf(sub: TestboxAdminSub, fields: TestboxAdminFields): TestboxAct | null {
  if (sub === 'disconnect' && (fields['replace'] === true || fields['replace'] === 'true')) return 'replace';
  return TESTBOX_ADMIN_SUBS[sub].act;
}

// ── the status read and the switch's gate (TC13) ─────────────────────────────────────────────────────────────────────

/** A `status` run and read by the one reader (its document has no `ok`), or the decision to refuse with. */
export type StatusRead = { ok: true; status: TestboxAdminStatus } | { ok: false; d: Extract<Decision, { kind: 'refuse' }> };

/** Runs `status` through `ops` and reads it. Shared by the connect routes, the switch's gate and the lane. Never throws. */
export async function readAdminStatus(ops: Pick<TestboxAdminOps, 'run'>): Promise<StatusRead> {
  let ran: TestboxAdminOutcome;
  try { ran = await ops.run('status', {}); } catch { ran = { kind: 'lost' }; }
  if (ran.kind === 'exited' && ran.code === 0) {
    const text = ran.stdout.trim();
    const read = readTestboxAdminStatus(text.slice(text.lastIndexOf('\n') + 1));
    if (read.ok) return { ok: true, status: read.value };
  }
  const d = decisionOf(ran);
  return { ok: false, d: d.kind === 'refuse' ? d : { kind: 'refuse', word: 'fleetFailed', extra: {}, audit: 'failed', code: 'fleetFailed' } };
}

/** What the switch's `{on: true}` gate answers when it refuses: the route word, its extra fields and the ledger's outcome and code. */
export type SwitchRefusal = Extract<Decision, { kind: 'refuse' }>;

/**
 * The switch's parity gate (spec §2.8, T9): the fleet's `status`, asked FRESH (never the lane's cache), and `parityArmable` over
 * its record, its pin and its box file. `null` when the record lets the switch arm. A fleet without the connect surface (no
 * `testbox-admin-v1` cap, no ops port, an agent that does not carry the op) is `unsupported`; a status that did not come back is
 * the read's own refusal. The verb's `parity_stale` mark rides the status (`parityStale`), so an edit and its undo, which return the
 * box file's digest to the record's, still refuse here as `ccd testbox-remote --state on` does (`parityRefusedByCcd`).
 */
export async function switchOnGate(
  ops: Pick<TestboxAdminOps, 'run'> | undefined, fleetState: Pick<FleetState, 'ccdVerbs'> | undefined,
): Promise<SwitchRefusal | null> {
  if (ops === undefined || !capSupported(fleetState, TESTBOX_ADMIN_CAP)) {
    return { kind: 'refuse', word: 'unsupported', extra: {}, audit: 'refused', code: 'unsupported' };
  }
  const s = await readAdminStatus(ops);
  if (!s.ok) return s.d;
  if (parityArmable(s.status.parity, parityCurrentOf(s.status))) return null;
  return { kind: 'refuse', word: 'parity-required', extra: { detail: TESTBOX_PARITY_REQUIRED_SENTENCE }, audit: 'refused', code: 'parity-required' };
}

/** Whether `ccd testbox-remote --state on` died on its own parity check (its words begin `parity-required`). */
export const parityRefusedByCcd = (stderr: string): boolean => /(^|\s)parity-required\b/.test(stderr);

/** The `switch` ledger row for one request: the actor from the session the gate measured, the fleet from its identity cell. A
 *  failed write is an answer, never a throw. */
export function writeSwitchRow(
  deps: { audit: Pick<TestboxAudit, 'write'> | undefined; fleetIdentity: () => string | null },
  actor: AccountActor, outcome: TestboxActOutcome, code?: TestboxAdminCode | RouteRefusal,
): void {
  deps.audit?.write({ act: 'switch', outcome, ...(code === undefined ? {} : { code }), fleetIdentity: deps.fleetIdentity(), actor });
}

/** The actor of a switch request: the device label of the session and 8 hex characters of its id hash; a request with no
 *  session cookie (auth off) is the unlabelled actor. */
export function switchActorOf(req: FastifyRequest, device: string | null): AccountActor {
  const token = parseCookies(req.headers.cookie).get(SESSION_COOKIE);
  return actorOf(device, token === undefined || token === '' ? '' : sessionIdHash(token));
}

// ── the routes ───────────────────────────────────────────────────────────────────────────────────────────────────────

export interface TestboxAdminRouteDeps {
  /** The account gate (`accounts/gate.ts`). REQUIRED: a route with no gate is a fleet act any reader could run. */
  gate: AccountGate;
  /** The ONE `TestboxAdminOps` arm. */
  ops: Pick<TestboxAdminOps, 'run'>;
  /** The ledger, absent in a test or script that wants none. */
  audit?: Pick<TestboxAudit, 'write' | 'recent' | 'stage'>;
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

  const readStatus = (): Promise<StatusRead> => readAdminStatus(deps.ops);

  app.get('/api/testbox/admin', async (req: FastifyRequest, reply: FastifyReply): Promise<unknown> => {
    const g = deps.gate(req, reply, { cap: TESTBOX_ADMIN_CAP });
    if (!g.pass) return reply;
    const s = await readStatus();
    if (!s.ok) return refuseRoute(reply, s.d.word, s.d.extra);
    return { ok: true, status: s.status, events: events() } satisfies TestboxAdminAnswer;
  });

  app.post('/api/testbox/admin/:sub', credentialBodyRoute(BODY_LIMIT), async (req: FastifyRequest, reply: FastifyReply): Promise<unknown> => {
    // The sub is a PATH parameter, so the gate can ask the right step-up of it before the body is checked. A body that names a
    // setting that guards secrets (`testboxAdminNeedsStepUp`) asks for it too: the body is read only to ask MORE of the caller.
    const raw = (req.params as { sub?: unknown }).sub;
    const sub = isTestboxAdminSub(raw) && raw !== 'status' ? raw : null;
    const g = deps.gate(req, reply, { cap: TESTBOX_ADMIN_CAP, stepUp: sub !== null && testboxAdminNeedsStepUp(sub, fieldsOf(req)) });
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

    // D-8399: a box settings edit's old values are the status's box settings as they stand before the act.
    const boxBefore = sub === 'settings-box' && deps.audit !== undefined ? await readStatus() : null;
    const d = decisionOf(await deps.ops.run(sub, typed));
    if (d.kind === 'refuse') {
      row({ outcome: d.audit, code: d.code });
      return refuseRoute(reply, d.word, d.extra);
    }
    // A short act writes its row on answer; a long act that started writes none (the lane writes its end row by act id), and a
    // box settings edit stages its changes for that row.
    if (!long) row({ outcome: 'ok', ...(sub === 'settings-fleet' ? { changes: fleetChangesOf(typed, d.json) } : {}) });
    const actId = resultOf(sub, d.json).act;
    if (sub === 'settings-box' && actId !== undefined && boxBefore !== null) {
      const changes = boxChangesOf(typed, boxBefore.ok ? boxBefore.status.boxSettings : null);
      if (changes !== undefined) deps.audit?.stage(actId, changes);
    }
    const after = await readStatus();
    if (!after.ok) return refuseRoute(reply, after.d.word, { ...after.d.extra, acted: true });
    return { ok: true, status: after.status, events: events(), result: resultOf(sub, d.json) } satisfies TestboxAdminActAnswer;
  });
}
