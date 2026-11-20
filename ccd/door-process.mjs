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
// Node built-ins only: `node:child_process`, `node:crypto`, `node:fs`, `node:path` and `node:url` (`node:crypto` is B1's witness key).
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** The claim's back-off while it answers `renewing`: from 1 s, doubling, to at most 30 s (`CLAIM_RETRY_MIN_MS`,
 *  `CLAIM_RETRY_MAX_MS` in shared/continuity-door.ts, held equal by door-tools.test.ts). */
export const CLAIM_RETRY_MIN_MS = 1_000;
export const CLAIM_RETRY_MAX_MS = 30_000;
/** The delta cache (C38): refreshed after each call and every minute, leased for three (`DELTA_REFRESH_MS`, `DELTA_LEASE_MS`). */
export const DELTA_REFRESH_MS = 60_000;
export const DELTA_LEASE_MS = 180_000;
/** One `ccrc-api` child's bound: the client's own curl bound is 30 s. */
export const CALL_TIMEOUT_MS = 35_000;
/** One JSON-RPC line's bound: a longer one with no newline is dropped whole and answered with a parse error (review 2735 F7). */
export const MAX_LINE_BYTES = 1024 * 1024;
/** The protocol versions `initialize` agrees to; any other request is answered with the first (review 2735 F7). */
export const PROTOCOL_VERSIONS = Object.freeze(['2025-06-18', '2025-03-26', '2024-11-05']);
/** A door tool's full name as the session hook sees it (`DOOR_TOOL_PREFIX` in shared/continuity-reports.ts, held equal by door-tools.test.ts). */
export const DOOR_TOOL_PREFIX = 'mcp__door__';
/** No tool input names an attribution field: the client fills the pane's pair itself. */
export const ATTRIBUTION_FIELDS = Object.freeze(['fromId', 'fromUuid', 'byId', 'byUuid']);

const HEX64 = /^[0-9a-f]{64}$/;
/** Every call's answer once a whoami has named another session. */
const NOT_THIS_SESSION = Object.freeze({ text: 'door: this process does not serve this session (whoami named another); nothing was sent', isError: true });
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
const BASE_TOOLS = [
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
      need(typeof i.note === 'string' && i.note.length > 0 && !i.note.startsWith('-') && !i.note.includes('\0'), 'note is text that does not begin with - and holds no NUL');
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
];

/** THE READ TOOL (plan Task 7 "The read tool", question 9): the one door a reader (a subagent, whose only tool is `mcp__door__read`)
 *  may use. `door` is an enum of the rows marked `reader: true`, and the call runs THAT row's argv builder and body, so it never
 *  serves a row without the mark. It has no verb of its own. No row is marked in B1 (board and history B add theirs), so until then
 *  the enum is empty and every call answers that no door is readable yet. */
export function readToolOver(rows) {
  const names = rows.filter((r) => r.reader === true).map((r) => r.name);
  const readerOf = (i) => {
    need(typeof i.door === 'string', 'door is the name of a readable door');
    const row = rows.find((r) => r.reader === true && r.name === i.door);
    need(row !== undefined, names.length === 0 ? 'no door is readable yet' : 'door is not a readable door');
    need(row.fenced === false && row.class === 'view', 'a readable door is an unfenced view');
    need(i.args === undefined || (i.args !== null && typeof i.args === 'object' && !Array.isArray(i.args)), 'args is an object');
    return row;
  };
  return {
    name: 'read', verb: null, class: 'view', fenced: false, reader: false,
    description: names.length === 0 ? 'Read one of the doors a reader may read. No door is readable yet.'
      : `Read one of the doors a reader may read: ${names.join(', ')}.`,
    input: object({
      door: names.length === 0 ? { type: 'string', description: 'No door is readable yet.' } : { type: 'string', enum: names },
      args: { type: 'object', description: "The chosen door's own input." },
    }, ['door']),
    argv: (i, self) => readerOf(i).argv(i.args ?? {}, self),
    body: (i) => { const r = readerOf(i); return r.body ? r.body(i.args ?? {}) : undefined; },
  };
}
export const DOOR_TOOLS = Object.freeze([...BASE_TOOLS, readToolOver(BASE_TOOLS)].map((r) => Object.freeze(r)));

/** The doors this table serves that the `ccrc-overlord` skill's table does not name (ruled, F26), each with its reason; the
 *  index passes both to the skill's owner. */
export const DOOR_ONLY_TOOLS = Object.freeze({
  read: "starting.md's door table is the Overlord's; the read tool is the readers' one door, and the Overlord itself never calls it",
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

/** THE WITNESS KEY (plan question 6, slug `witness-key-is-the-call-digest`): the sha256, as 64 lowercase hex, of the tool's full
 *  name, one newline, and the arguments printed by `jq -cS` with the trailing newline removed (`{}` for absent). The session hook
 *  computes the same from the `PreToolUse` payload's `tool_input`, so the two agree for large integers, floats, unicode escapes
 *  and key order because the SAME jq canonicalises both. jq runs as a child with the input on its STDIN, never its argv; a jq that
 *  cannot run gives `null` and the call goes without a key (the gate reads it as unwitnessed). `name` is the row's own name. */
export function witnessKeyOf(name, input, env = process.env) {
  return new Promise((resolve) => {
    const child = execFile('jq', ['-cS', '.'], { env, timeout: 10_000, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8' }, (err, stdout) => {
      if (err) { resolve(null); return; }
      const canon = String(stdout).replace(/\n$/, '');
      const key = createHash('sha256').update(`${DOOR_TOOL_PREFIX}${name}\n${canon}`).digest('hex');
      resolve(HEX64.test(key) && canon !== '' ? key : null);
    });
    child.stdin?.on('error', () => {});
    child.stdin?.end(JSON.stringify(input ?? {}));
  });
}

/** The door: its state and its one chain. `opts`: `api` (the client's path), `self` (this session's id), `nonce`, `dir` (the
 *  delta cache's directory, or none), `env` (the children's base environment, the nonce already gone), `now` and `log`
 *  (a fixed line to stderr; never a value this process holds). */
export function createDoor(opts) {
  const { api, self, dir, env, now = () => Date.now(), log = () => {} } = opts;
  const st = { nonce: HEX64.test(opts.nonce ?? '') ? opts.nonce : null, key: null, generation: null, counter: 0,
    nextClaimAt: 0, backoff: CLAIM_RETRY_MIN_MS, who: null, refused: false, nextWhoAt: 0, whoBackoff: CLAIM_RETRY_MIN_MS,
    refreshQueued: false };
  let chain = Promise.resolve();
  /** @type {<T>(fn: () => Promise<T>) => Promise<T>} */
  const serial = (fn) => { const p = chain.then(fn, fn); chain = p.then(() => {}, () => {}); return p; };
  /** A child's environment: the base with no nonce and no fence variable, then only the fence this call carries. */
  const childEnv = (extra) => {
    const e = { ...env };
    delete e.CCRC_DOOR_NONCE; delete e.CCRC_ACT_KEY; delete e.CCRC_ACT_GENERATION; delete e.CCRC_ACT_COUNTER; delete e.CCRC_WITNESS_KEY;
    return { ...e, ...extra };
  };

  /** The identity (ruled, review 2735 F4): `ccrc-api whoami` must name this process's session. A whoami that names another
   *  session refuses every call for the life of the process; one that fails (an exit, a timeout, an unreadable answer)
   *  refuses only the call that asked, and the next call asks again after the claim's back-off. */
  async function identify() {
    if (st.refused || st.who !== null || now() < st.nextWhoAt) return;
    const w = await askWho();
    if (w.kind === 'self') { st.who = { id: self }; st.whoBackoff = CLAIM_RETRY_MIN_MS; return; }
    if (w.kind === 'other') return;
    st.nextWhoAt = now() + st.whoBackoff; st.whoBackoff = Math.min(st.whoBackoff * 2, CLAIM_RETRY_MAX_MS);
    log('door: whoami could not be read; this call refuses, and a later one asks again after a back-off');
  }
  const ready = serial(identify);

  /** One whoami, read one way for the identity and the claim (review 2756 F6): `self` with the pane's uuid; `other`, which
   *  refuses every call for the life of the process; or `failed` (an exit, an unreadable answer, an empty uuid). */
  async function askWho() {
    const r = await runClient(api, ['whoami'], childEnv({}), '');
    const w = parseJson(r.stdout);
    if (r.code !== 0 || !w || typeof w.id !== 'string' || typeof w.uuid !== 'string' || w.uuid === '') return { kind: 'failed', uuid: '' };
    if (w.id === self) return { kind: 'self', uuid: w.uuid };
    if (!st.refused) { st.refused = true; log('door: whoami does not name this session; every call refuses'); }
    return { kind: 'other', uuid: '' };
  }

  /** The claim, while no key is held and a nonce is: once a back-off allows it. Never throws; the key stays in memory. */
  async function claim() {
    if (st.key !== null || st.nonce === null || now() < st.nextClaimAt) return;
    const w = await askWho();
    if (w.kind !== 'self') { st.nextClaimAt = now() + st.backoff; return; }   // `other` is already the permanent refusal
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
    if (!dir) return;
    await identify();   // a whoami that failed at the start is asked again here too, under its back-off (review 2756 F1)
    if (st.who === null) return;
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

  /** One tool call: `{ text, isError }`, or `null` for a tool this table does not serve.
   *  @param {string} name @param {unknown} input @returns {Promise<{ text: string, isError: boolean } | null>} */
  async function call(name, input) {
    const row = DOOR_TOOLS.find((r) => r.name === name);
    if (!row) return null;
    const res = await serial(async () => {
      await identify();
      if (st.refused) return NOT_THIS_SESSION;
      if (st.who === null) return { text: 'door: whoami could not be read, so this session is unconfirmed; nothing was sent, and a later call asks again', isError: true };
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
        const wk = await witnessKeyOf(row.name, input, childEnv({}));   // the call's digest, for the hook's witness to match (B1)
        if (wk !== null) extra = { CCRC_WITNESS_KEY: wk };
        await claim();
        if (st.refused) return NOT_THIS_SESSION;
        if (st.key !== null) {
          st.counter += 1;   // before the send, never reused (F7)
          extra = { ...extra, CCRC_ACT_KEY: st.key, CCRC_ACT_GENERATION: String(st.generation), CCRC_ACT_COUNTER: String(st.counter) };
        }
      }
      const r = await runClient(api, argv, childEnv(extra), body);
      const j = parseJson(r.stdout);
      const isError = r.code !== 0 || (j !== undefined && j !== null && typeof j === 'object' && j.ok === false);
      return { text: r.stdout, isError };
    });
    void requestRefresh();
    return res;
  }

  /** One refresh on the chain unless one is already queued, so calls sent together are followed by one refresh, not one each
   *  (review 2735 F7). */
  function requestRefresh() {
    if (st.refreshQueued) return Promise.resolve();
    st.refreshQueued = true;
    return serial(async () => { st.refreshQueued = false; await refreshDelta(); });
  }
  // A respawn's first prompt never reads the last process's lease (review 2735 F2): the cache is written once at the start.
  void requestRefresh();

  return { call, refreshDelta: requestRefresh, ready, state: () => ({ claimed: st.key !== null, generation: st.generation,
    counter: st.counter, nonceHeld: st.nonce !== null, refused: st.refused, identified: st.who !== null }) };
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
      const asked = m.params?.protocolVersion;
      const v = typeof asked === 'string' && PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0];
      send({ jsonrpc: '2.0', id, result: { protocolVersion: v, capabilities: { tools: {} }, serverInfo: { name: 'door', version: '1' } } });
    } else if (m.method === 'notifications/initialized' || (!hasId && typeof m.method === 'string' && m.method.startsWith('notifications/'))) {
      // a notification is answered by nothing
    } else if (m.method === 'ping' && hasId) {
      send({ jsonrpc: '2.0', id, result: {} });
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
  let dropping = false;   // inside a line past MAX_LINE_BYTES: everything up to its newline is dropped
  input.setEncoding('utf8');
  input.on('data', (d) => {
    buf += d;
    let n;
    while ((n = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, n); buf = buf.slice(n + 1);
      if (dropping) dropping = false; else handle(line);
    }
    if (buf.length > MAX_LINE_BYTES) {
      buf = '';
      if (!dropping) { dropping = true; send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }); }
    }
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

/** Started as a program: real paths on both sides (review 2735 F1), since `import.meta.url` is the real path and the spawn's
 *  path may run through a linked ancestor (a linked `~/.local`, which the entry installer supports). */
function startedAsProgram() {
  try { return process.argv[1] !== undefined && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href; } catch { return false; }
}
if (startedAsProgram()) main();
