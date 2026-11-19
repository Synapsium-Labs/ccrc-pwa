// ccd/door-process.mjs — the Overlord's door process (Overlord design spec §3.6 H1 "The door process (H9)", §3.3.11 H12 "The
// fence"; plan docs/superpowers/plans/2026-11-14-overlord-w1/w1-door-process.md, Tasks 5 and 6).
//
// AN MCP STDIO SERVER WITH NO DEPENDENCY: newline-delimited JSON-RPC 2.0 on stdin and stdout (`initialize`,
// `notifications/initialized`, `tools/list`, `tools/call`, and an error for anything else). Claude Code starts it as the session's
// tool server `door`, from the `--mcp-config` file ccd's spawn step writes (`_door_spawn`, ccd/lib/door.sh), so its tools reach the
// model as `mcp__door__<name>`. It exits when its stdin closes (ruled, F24), so it never outlives its session.
//
// `ccrc-api` INSIDE (plan question 13, slug door-process-wraps-the-one-client): every tool is one `ccrc-api` verb, run as a child
// process per call, so the route table, the server's address, the box token and the closed-client rules stay in one client. This
// file names no tmux, no systemd and nothing of Claude Code's on-disk layout, and reaches the server only through that client.
//
// THE SECRETS (ruled, F1). The launch nonce arrives in this process's initial environment (`CCRC_DOOR_NONCE`, from the 0600
// config), is copied into memory and deleted from the environment before any child starts, and leaves this process once, in the
// claim's body on the client's stdin (which the client puts on curl's stdin). The act key arrives in the claim's answer on the
// client's stdout, is held in memory only, and is handed to a fenced call's child in that child's environment (`CCRC_ACT_KEY`),
// which the client puts on curl's stdin as the fence's header. Neither is ever on an argv, in a tool result, on stdout outside
// the claim's own child, or on stderr. The claim checks neither the designation nor the term (A1's carry): the gate that
// consumes the key (gates B) checks both.
//
// ONE CALL AT A TIME (ruled, F7): every call, the claim and the delta's refresh included, runs through one promise chain, so at
// most one claim is in flight and writes reach the server in counter order. The counter rises by one before each fenced send and
// is never reused, even after a send that got no answer.
//
// Node built-ins only: `node:child_process`, `node:fs` and `node:path` (B1's witness key adds `node:crypto`).
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/** The claim's back-off while it answers `renewing`: from 1 s, doubling, to at most 30 s (`CLAIM_RETRY_MIN_MS`,
 *  `CLAIM_RETRY_MAX_MS` in shared/continuity-door.ts, held equal by door-tools.test.ts). */
export const CLAIM_RETRY_MIN_MS = 1_000;
export const CLAIM_RETRY_MAX_MS = 30_000;
/** The delta cache (C38): refreshed after each call and every minute, leased for three (`DELTA_REFRESH_MS`, `DELTA_LEASE_MS`). */
export const DELTA_REFRESH_MS = 60_000;
export const DELTA_LEASE_MS = 180_000;
/** One `ccrc-api` child's bound: the client's own curl bound is 30 s. */
export const CALL_TIMEOUT_MS = 35_000;
/** No tool input names an attribution field: the client fills the pane's pair itself. */
export const ATTRIBUTION_FIELDS = Object.freeze(['fromId', 'fromUuid', 'byId', 'byUuid']);

const HEX64 = /^[0-9a-f]{64}$/;
const isPage = (v) => Number.isInteger(v) && v >= 1 && v <= 999_999;
const isId = (v) => Number.isInteger(v) && v >= 1;
const pageSchema = { type: 'integer', minimum: 1, description: 'The page to read; 1 when absent.' };
const object = (properties, required = [], extra = false) => ({ type: 'object', properties, required, additionalProperties: extra });

/** Why an input refuses, before anything runs: a fixed phrase, never a quote of the input. */
class InputRefused extends Error {}
const need = (ok, why) => { if (!ok) throw new InputRefused(why); };

/** THE TOOL TABLE (plan Task 5): one row a door, `verb` a key of `ccrc-api`'s ROUTES, `input` the JSON schema the model sees,
 *  `argv(input, self)` the row's one argv builder (ruled, F3) and `body(input)` what goes on the client's stdin, if anything.
 *  `fenced` calls carry the act key, the generation and the counter; `card` is the one `view` row fenced, because the page that
 *  completes a full read is a write (gates B's `card-record`, F9) and this process cannot tell which page that is. */
export const DOOR_TOOLS = Object.freeze([
  {
    name: 'card', verb: 'sessions.card', class: 'view', fenced: true, reader: false,
    description: 'Read your card, one page per call. Page 1 names the card hash and the page count; read every page in turn, naming the hash.',
    input: object({ page: pageSchema, hash: { type: 'string', pattern: '^[0-9a-f]{64}$', description: "The card's hash, from page 1, for every later page." } }),
    argv: (i) => {
      need(i.page === undefined || isPage(i.page), 'page is a positive integer');
      need(i.hash === undefined || (typeof i.hash === 'string' && HEX64.test(i.hash)), 'hash is 64 lowercase hex characters');
      return ['card', '--door', ...(i.page === undefined ? [] : ['--page', String(i.page)]), ...(i.hash === undefined ? [] : ['--hash', i.hash])];
    },
  },
  {
    name: 'probe', verb: 'sessions.probe', class: 'view', fenced: false, reader: false,
    description: 'Read your open probe round, one page per call.',
    input: object({ page: pageSchema }),
    argv: (i) => { need(i.page === undefined || isPage(i.page), 'page is a positive integer'); return ['probe', '--door', ...(i.page === undefined ? [] : ['--page', String(i.page)])]; },
  },
  {
    name: 'probe_answer', verb: 'probe.answer', class: 'operate', fenced: true, reader: false,
    description: 'Answer every question of your open probe round in one call.',
    input: object({ roundId: { type: 'string' }, answers: { type: 'array' } }, ['roundId', 'answers'], true),
    argv: () => ['probe', 'answer', '--json', '-'], body: (i) => i,
  },
  {
    name: 'note_add', verb: 'note.add', class: 'operate', fenced: true, reader: false,
    description: 'Write one working note (name revises to supersede a note).',
    input: object({ key: { type: 'object' }, kind: { type: 'string' }, waitsOn: { type: 'string' }, next: { type: 'string' }, revises: { type: 'integer' } }, [], true),
    argv: (_i, self) => ['note', 'add', self, '--json', '-'], body: (i) => i,
  },
  {
    name: 'note_close', verb: 'note.close', class: 'operate', fenced: true, reader: false,
    description: 'Close one working note.',
    input: object({ revises: { type: 'integer', minimum: 1, description: 'The note to close.' } }, ['revises']),
    argv: (i, self) => { need(isId(i.revises), 'revises is a note id'); return ['note', 'close', self, '--json', '-']; },
    body: (i) => ({ revises: i.revises, closes: true }),
  },
  {
    name: 'note_list', verb: 'note.list', class: 'view', fenced: false, reader: false,
    description: 'List your live working notes, newest first, one page per call.',
    input: object({ before: { type: 'integer', minimum: 1 }, limit: { type: 'integer', minimum: 1 } }),
    argv: (i, self) => {
      need(i.before === undefined || isId(i.before), 'before is a note id');
      need(i.limit === undefined || isId(i.limit), 'limit is a positive integer');
      return ['note', 'list', self, ...(i.before === undefined ? [] : ['--before', String(i.before)]), ...(i.limit === undefined ? [] : ['--limit', String(i.limit)])];
    },
  },
  {
    name: 'note_handover', verb: 'note.handover', class: 'operate', fenced: true, reader: false,
    description: 'Write your handover note, while your generation is checkpointed.',
    input: object({}, [], true),
    argv: (_i, self) => ['note', 'handover', self, '--json', '-'], body: (i) => i,
  },
  {
    name: 'timer_set', verb: 'timer.set', class: 'operate', fenced: true, reader: false,
    description: 'Set a timer that wakes you with its note: after 90m, 2h, 3d and the like; on a run or a programme if you name one.',
    input: object({ after: { type: 'string', pattern: '^[1-9][0-9]{0,4}[mhd]$' }, note: { type: 'string' }, run: { type: 'integer', minimum: 1 }, programme: { type: 'string' } }, ['after', 'note']),
    argv: (i) => {
      need(typeof i.after === 'string' && /^[1-9][0-9]{0,4}[mhd]$/.test(i.after), 'after is a duration such as 90m, 2h or 3d');
      need(typeof i.note === 'string' && i.note.length > 0 && !i.note.startsWith('-'), 'note is text that does not begin with -');
      need(!(i.run !== undefined && i.programme !== undefined), 'name a run or a programme, not both');
      need(i.run === undefined || isId(i.run), 'run is a run id');
      need(i.programme === undefined || (typeof i.programme === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(i.programme)), 'programme is a programme slug');
      return ['timer', 'set', i.after, i.note, ...(i.run === undefined ? [] : ['--run', String(i.run)]), ...(i.programme === undefined ? [] : ['--programme', i.programme])];
    },
  },
  {
    name: 'timer_list', verb: 'timer.list', class: 'view', fenced: false, reader: false,
    description: 'List your timers.', input: object({}), argv: () => ['timer', 'list'],
  },
  {
    name: 'timer_cancel', verb: 'timer.cancel', class: 'operate', fenced: true, reader: false,
    description: 'Cancel one of your timers.',
    input: object({ id: { type: 'integer', minimum: 1 } }, ['id']),
    argv: (i) => { need(isId(i.id), 'id is a timer id'); return ['timer', 'cancel', String(i.id)]; },
  },
].map((r) => Object.freeze(r)));

/** The doors this table serves that the `ccrc-overlord` skill's table does not name (ruled, F26), each with its reason; the
 *  index passes both to the skill's owner. */
export const DOOR_ONLY_TOOLS = Object.freeze({
  probe: "starting.md's door table has no row for reading a probe round; the first line sends the Overlord to it",
  note_handover: "starting.md's door table has no row for the handover note, which the renewal asks for",
});

/** Does `v` name an attribution field as a key, at any depth? */
function namesAttribution(v) {
  if (Array.isArray(v)) return v.some(namesAttribution);
  if (v === null || typeof v !== 'object') return false;
  return Object.keys(v).some((k) => ATTRIBUTION_FIELDS.includes(k) || namesAttribution(v[k]));
}

/** One child of the client: its stdout, its exit code (`null` for a signal or a spawn failure) and nothing else. */
function runClient(api, argv, env, stdin) {
  return new Promise((resolve) => {
    const child = execFile(api, argv, { env, timeout: CALL_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8' },
      (err, stdout) => resolve({ code: err ? (typeof err.code === 'number' ? err.code : null) : 0, stdout: String(stdout ?? '') }));
    child.stdin?.on('error', () => {});
    child.stdin?.end(stdin ?? '');
  });
}

const parseJson = (s) => { try { return JSON.parse(s); } catch { return undefined; } };

/** The door: its state and its one chain. `opts`: `api` (the client's path), `self` (this session's id), `nonce`, `dir` (the
 *  delta cache's directory, or none), `env` (the children's base environment, the nonce already gone), `now` and `log`
 *  (a fixed line to stderr; never a value this process holds). */
export function createDoor(opts) {
  const { api, self, dir, env, now = () => Date.now(), log = () => {} } = opts;
  const st = { nonce: HEX64.test(opts.nonce ?? '') ? opts.nonce : null, key: null, generation: null, counter: 0,
    nextClaimAt: 0, backoff: CLAIM_RETRY_MIN_MS, who: null, refused: false };
  let chain = Promise.resolve();
  const serial = (fn) => { const p = chain.then(fn, fn); chain = p.then(() => {}, () => {}); return p; };
  /** A child's environment: the base with no nonce and no fence variable, then only the fence this call carries. */
  const childEnv = (extra) => {
    const e = { ...env };
    delete e.CCRC_DOOR_NONCE; delete e.CCRC_ACT_KEY; delete e.CCRC_ACT_GENERATION; delete e.CCRC_ACT_COUNTER;
    return { ...e, ...extra };
  };

  /** Start: `ccrc-api whoami` must name this process's session, or every call refuses. */
  const ready = serial(async () => {
    const r = await runClient(api, ['whoami'], childEnv({}), '');
    const w = parseJson(r.stdout);
    if (r.code === 0 && w && w.id === self && typeof w.uuid === 'string' && w.uuid !== '') st.who = { id: w.id };
    else { st.refused = true; log('door: whoami does not name this session; every call refuses'); }
  });

  /** The claim, while no key is held and a nonce is: once a back-off allows it. Never throws; the key stays in memory. */
  async function claim() {
    if (st.key !== null || st.nonce === null || now() < st.nextClaimAt) return;
    const w = parseJson((await runClient(api, ['whoami'], childEnv({}), '')).stdout);
    if (!w || w.id !== self || typeof w.uuid !== 'string') { st.nextClaimAt = now() + st.backoff; return; }
    const r = await runClient(api, ['sessions', 'act-key', self, '--json', '-'], childEnv({}),
      JSON.stringify({ fromId: self, fromUuid: w.uuid, nonce: st.nonce }));
    const a = parseJson(r.stdout);
    if (a && a.ok === true && typeof a.key === 'string' && HEX64.test(a.key) && Number.isInteger(a.generation)) {
      st.key = a.key; st.generation = a.generation; st.nonce = null; st.backoff = CLAIM_RETRY_MIN_MS;
      log('door: claimed the act key');
      return;
    }
    if (a && a.ok === false && a.error === 'renewing') {
      st.nextClaimAt = now() + st.backoff; st.backoff = Math.min(st.backoff * 2, CLAIM_RETRY_MAX_MS);
      log('door: the claim answered renewing; it retries after a back-off');
      return;
    }
    if (a && a.ok === false && a.error === 'stale-generation') { st.nonce = null; log('door: the claim answered stale-generation; reads only'); return; }
    // Anything else (no answer, unmeasured, a masked or malformed key) keeps the nonce and backs off: it fails closed.
    st.nextClaimAt = now() + st.backoff; st.backoff = Math.min(st.backoff * 2, CLAIM_RETRY_MAX_MS);
    log('door: the claim got no usable answer; it retries after a back-off');
  }

  /** The delta cache (C38, Task 6): `ccrc-api card --anchor --form delta`, written at 0600 through `delta.tmp` and a rename.
   *  A text answer writes its text, a dark answer an empty text; a failed fetch writes nothing, so the lease lapses. */
  async function refreshDelta() {
    if (!dir || st.refused) return;
    const r = await runClient(api, ['card', '--anchor', '--form', 'delta'], childEnv({}), '');
    const a = parseJson(r.stdout);
    if (r.code !== 0 || !a || a.ok !== true || a.part !== 'anchor' || a.form !== 'delta') return;
    const text = a.dark === true ? '' : typeof a.text === 'string' ? a.text : null;
    if (text === null) return;
    const at = now();
    const tmp = path.join(dir, 'delta.tmp');
    try {
      fs.rmSync(tmp, { force: true });
      fs.writeFileSync(tmp, `v=1 at=${at} until=${at + DELTA_LEASE_MS}\n${text}`, { mode: 0o600, flag: 'wx' });
      fs.renameSync(tmp, path.join(dir, 'delta'));
    } catch { try { fs.rmSync(tmp, { force: true }); } catch { /* the lease lapses */ } }
  }

  /** One tool call: `{ text, isError }`, or `null` for a tool this table does not serve. */
  async function call(name, input) {
    const row = DOOR_TOOLS.find((r) => r.name === name);
    if (!row) return null;
    const res = await serial(async () => {
      await ready;
      if (st.refused) return { text: 'door: this process does not serve this session (whoami named another); nothing was sent', isError: true };
      const i = input ?? {};
      if (i === null || typeof i !== 'object' || Array.isArray(i)) return { text: 'door: the input is not an object; nothing was sent', isError: true };
      if (namesAttribution(i)) return { text: 'door: the input names an attribution field; the client fills the pane\'s own, so nothing was sent', isError: true };
      let argv;
      try { argv = row.argv(i, self); } catch (e) {
        if (e instanceof InputRefused) return { text: `door: ${e.message}; nothing was sent`, isError: true };
        throw e;
      }
      const body = row.body ? JSON.stringify(row.body(i)) : '';
      let extra = {};
      if (row.fenced) {
        await claim();
        if (st.key !== null) {
          st.counter += 1;   // before the send, never reused (F7)
          extra = { CCRC_ACT_KEY: st.key, CCRC_ACT_GENERATION: String(st.generation), CCRC_ACT_COUNTER: String(st.counter) };
        }
      }
      const r = await runClient(api, argv, childEnv(extra), body);
      const j = parseJson(r.stdout);
      const isError = r.code !== 0 || (j !== undefined && j !== null && typeof j === 'object' && j.ok === false);
      return { text: r.stdout, isError };
    });
    void serial(refreshDelta);
    return res;
  }

  return { call, refreshDelta: () => serial(refreshDelta), ready, state: () => ({ claimed: st.key !== null, generation: st.generation,
    counter: st.counter, nonceHeld: st.nonce !== null, refused: st.refused }) };
}

/** The JSON-RPC server over stdin and stdout. Every answer is a fixed shape; a parse error quotes nothing. */
export function serve(door, input, output) {
  const send = (m) => output.write(`${JSON.stringify(m)}\n`);
  const tools = DOOR_TOOLS.map((r) => ({ name: r.name, description: r.description, inputSchema: r.input }));
  let buf = '';
  const handle = (line) => {
    if (line.trim() === '') return;
    const m = parseJson(line);
    if (!m || typeof m !== 'object' || Array.isArray(m)) { send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }); return; }
    const id = m.id;
    const hasId = typeof id === 'string' || typeof id === 'number';
    if (m.method === 'initialize') {
      const v = typeof m.params?.protocolVersion === 'string' ? m.params.protocolVersion : '2025-06-18';
      send({ jsonrpc: '2.0', id, result: { protocolVersion: v, capabilities: { tools: {} }, serverInfo: { name: 'door', version: '1' } } });
    } else if (m.method === 'notifications/initialized' || (!hasId && typeof m.method === 'string' && m.method.startsWith('notifications/'))) {
      // a notification is answered by nothing
    } else if (m.method === 'tools/list') {
      send({ jsonrpc: '2.0', id, result: { tools } });
    } else if (m.method === 'tools/call') {
      const name = m.params?.name;
      door.call(typeof name === 'string' ? name : '', m.params?.arguments).then((r) => {
        if (r === null) send({ jsonrpc: '2.0', id, error: { code: -32602, message: 'unknown tool' } });
        else send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: r.text }], isError: r.isError } });
      }, () => send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: 'door: the call failed inside the door process; nothing more is known' }], isError: true } }));
    } else if (hasId) {
      send({ jsonrpc: '2.0', id, error: { code: -32601, message: 'method not found' } });
    }
  };
  input.setEncoding('utf8');
  input.on('data', (d) => {
    buf += d;
    let n;
    while ((n = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, n); buf = buf.slice(n + 1); handle(line); }
  });
}

/** Started as a program (never when imported by a test): the nonce leaves the environment before anything else runs. */
function main() {
  const nonce = process.env.CCRC_DOOR_NONCE ?? '';
  delete process.env.CCRC_DOOR_NONCE;
  const self = process.env.CCRC_SESSION_ID ?? '';
  const api = process.env.CCRC_API ?? '';
  const dir = process.env.CCRC_DOOR_DIR ?? '';
  const log = (line) => { try { process.stderr.write(`${line}\n`); } catch { /* stderr closed */ } };
  const door = createDoor({ api, self, nonce, dir: dir === '' ? null : dir, env: { ...process.env }, log });
  serve(door, process.stdin, process.stdout);
  process.stdin.on('end', () => process.exit(0));
  process.stdin.on('close', () => process.exit(0));
  setInterval(() => { void door.refreshDelta(); }, DELTA_REFRESH_MS).unref();
}

const started = process.argv[1] !== undefined && path.resolve(process.argv[1]) === decodeURIComponent(new URL(import.meta.url).pathname);
if (started) main();
