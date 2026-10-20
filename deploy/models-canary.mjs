#!/usr/bin/env node
// models-canary — ONE request through a Codex lane's own proxy, for one
// candidate model, before the hourly refresh moves a class to it (auto-advance
// spec §2.3 step 3, D2 and D22; plan W2 Task 10). `ccd/ccrc`'s `_models_canary`
// is its one caller.
//
// FIRST, THE LANE PROBE (D-5210). A port is only a
// number (`ccd/ccgpt-proxy.py`'s own rule): before the key goes anywhere, this
// program asks `GET /ccgpt/lane` on the lane's proxy port, with no key, and
// sends the keyed request only when the listener answers as THIS lane. Another
// lane's leftover shim, a stray listener or a foreign process on that port gets
// nothing: the answer is `unavailable`, and no request carrying the key is made.
//
// WHAT IT SENDS. `POST http://127.0.0.1:<proxyPort>/v1/messages`, the path a
// session's requests take: a "reply OK" prompt, `max_tokens` 512, streamed, and
// the lowest effort the model lists (`output_config.effort`, omitted when it
// lists none, or when that level is literally named `none`: the sentinel and a
// level of that name both send the provider's own default, which still tests
// the model). Streamed, because every lane LiteLLM entry is `mode: responses`,
// which parses only streamed answers (`deploy/litellm-config.template.yaml`).
// 512 tokens, so a low-effort reasoning pass still has room before its text.
// Reading stops at the first non-empty text delta, or at READ_CAP bytes.
//
// WHAT IT ANSWERS. Exactly one JSON object on stdout, and nothing on stderr:
// `{"ok":true,"op":"canary","result":R,"status":S,"reason":T}` at exit 0, R one of
//   passed       a 200 whose stream carried a non-empty text delta in time;
//   failed       a real refusal: any other status, a 200 with no text or with
//                an error event, a socket error on the keyed request other
//                than a refused connect;
//   not-ready    the lane is not up yet: the shim's D-4933 502 (a refused
//                gateway connection it waited out), a refused connect on the
//                shim's own port, or this program's own deadline (D22) — a
//                deadline that passes after a 200 still answers not-ready, and
//                its reason says the lane answered;
//   unavailable  the lane's files are absent, unreadable or malformed, or the
//                port does not answer as this lane; no keyed request was sent.
// A usage error is `{"ok":false,"error":"bad-argv",…}` at exit 2.
//
// THE KEY. The lane's gateway key is read from `runtime.env` in THIS process and
// lives in one local variable and one request header. It never reaches argv,
// the environment, stdout, stderr or a `reason`: every reason is scrubbed of it
// (`scrub`), because an upstream refusal may echo the key back (a LiteLLM 401
// names the key it received). This program spawns no process.
//
// NO PROXY. `node:http` with a FRESH `Agent` to the literal `127.0.0.1`: no proxy
// variable in the environment applies, and no name is resolved.

import { Agent, request } from 'node:http';
import { statSync } from 'node:fs';
import path from 'node:path';
// REASON_MAX: the advance file's one cap on a history reason (W1's
// `shared/model-advance.mjs`, a pure module). A failed canary's reason becomes
// `advance-commit`'s `--reason`, so it is cut to the number the file's reader
// holds it to, imported and never spelled again here.
import { REASON_MAX } from '../shared/model-advance.mjs';
import { MODEL_ID_RE, MODELS_LANE_ID_RE } from '../shared/models.mjs';
import { readRegular } from '../shared/modelenv.mjs';

/** This program's own deadline in seconds when `--timeout-s` is absent. LONGER
 *  than the shim's 60 s refused-connect wait (`UPSTREAM_WAIT_DEFAULT_S`,
 *  `ccd/ccgpt-proxy.py`, D-4933), so a restarting gateway answers the shim's own
 *  502 (not ready) before this deadline does. `ccd/ccrc`'s
 *  `_models_canary_secs` defaults to the same number. */
const CANARY_TIMEOUT_S = 90;
const TIMEOUT_MAX_S = 600;
/** The shim's 502 text for a refused gateway connection it waited out
 *  (`ccd/ccgpt-proxy.py`, D-4933); `models-canary.test.ts` reads it out of
 *  that file and compares. */
const D4933_PREFIX = 'ccgpt-proxy: upstream unreachable: connection refused for';
const READ_CAP = 256 * 1024;
const ERROR_BODY_CAP = 64 * 1024;
const LANE_PROBE_CAP = 4 * 1024;
const RUNTIME_ENV_MAX = 256;
const LANE_JSON_MAX = 64 * 1024;
/** `runtime.env`'s one line (`_codex_runtime_env_ensure`, `ccd/ccrc`). */
const KEY_LINE = /^LITELLM_MASTER_KEY=(sk-[0-9a-f]{48})\n?$/;
/** An effort level as a catalogue may carry it (`parseCatalogue` keeps any
 *  non-empty string): printable ASCII, 1 to 64 characters, no space at either
 *  end. It only ever enters a JSON-encoded body, so this bounds it and no more. */
const EFFORT_RE = /^[\x21-\x7e](?:[\x20-\x7e]{0,62}[\x21-\x7e])?$/;
const KEYS = ['id', 'model', 'effort', 'timeout-s'];
const HOME = process.env['HOME'] ?? '';

let answered = false;
/** The one answer. Exits once stdout has taken it. */
function answer(o, code) {
  if (answered) return;
  answered = true;
  process.stdout.write(`${JSON.stringify(o)}\n`, () => process.exit(code));
}
const usage = (detail) => answer({ ok: false, error: 'bad-argv', detail }, 2);

/** A reason as it may leave this process: the key and its hex, and anything
 *  shaped like a gateway key (an `sk-` that starts a word), replaced; printable
 *  ASCII; at most REASON_MAX. An ordinary word that merely contains `sk-`
 *  ("risk-free", "task-queue") is left as it is. */
function scrub(text, key) {
  let s = String(text);
  if (key !== null) s = s.split(key).join('sk-<redacted>').split(key.slice(3)).join('<redacted>');
  s = s.replace(/(?<![A-Za-z0-9])sk-[A-Za-z0-9._-]{4,}/g, 'sk-<redacted>');
  return s.replace(/[^\x20-\x7e]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, REASON_MAX);
}

/** A lane file, size-bounded before it is read, then read by `readRegular`,
 *  which refuses a FIFO or a directory at once (`ENOTREG`), never opening it. */
function readSmall(p, max) {
  if (statSync(p).size > max) throw Object.assign(new Error(`larger than ${max} bytes`), { code: 'ETOOBIG' });
  return readRegular(p);
}

/** The lane's proxy port and key, or `{why}`. A `why` never quotes a file. */
function laneInputs(id) {
  const dir = path.join(HOME, '.ccrc', 'codex', id);
  let port;
  try {
    const j = JSON.parse(readSmall(path.join(dir, 'lane.json'), LANE_JSON_MAX));
    port = j !== null && typeof j === 'object' ? j.proxyPort : undefined;
  } catch (e) {
    return { why: `lane.json could not be read (${typeof e.code === 'string' ? e.code : 'not JSON'})` };
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) return { why: 'lane.json names no proxyPort from 1 to 65535' };
  let text;
  try {
    text = readSmall(path.join(dir, 'runtime.env'), RUNTIME_ENV_MAX);
  } catch (e) {
    return { why: `runtime.env could not be read (${typeof e.code === 'string' ? e.code : 'unreadable'})` };
  }
  const m = KEY_LINE.exec(text);
  if (m === null) return { why: 'runtime.env is not one LITELLM_MASTER_KEY line' };
  return { port, key: m[1] };
}

/** `{error: "…"}` (the shim's one refusal shape) or `{error: {message}}`
 *  (LiteLLM's and the Anthropic API's), or null. */
function errorText(text) {
  try {
    const j = JSON.parse(text);
    if (j !== null && typeof j === 'object') {
      if (typeof j.error === 'string') return j.error;
      if (j.error !== null && typeof j.error === 'object' && typeof j.error.message === 'string') return j.error.message;
    }
  } catch { /* not JSON: the body itself is the reason */ }
  return null;
}

/** The lane a `GET /ccgpt/lane` answer names, or null: a 200, `application/json`,
 *  and an object whose only key is a string `lane` (`ccd/ccrc`'s
 *  `_codex_lane_answer` reads the same shape). */
function laneOf(status, type, text) {
  if (status !== 200 || !/^\s*application\/json\s*(;.*)?$/i.test(type)) return null;
  try {
    const j = JSON.parse(text);
    if (j === null || typeof j !== 'object' || Array.isArray(j)) return null;
    const keys = Object.keys(j);
    return keys.length === 1 && keys[0] === 'lane' && typeof j.lane === 'string' ? j.lane : null;
  } catch {
    return null;
  }
}

function send(port, key, id, model, effort, timeoutS) {
  const agent = new Agent({ keepAlive: false, maxSockets: 1 });
  const body = JSON.stringify({
    model, max_tokens: 512, stream: true,
    messages: [{ role: 'user', content: 'Reply with the single word OK.' }],
    ...(effort === null ? {} : { output_config: { effort } }),
  });
  let req = null;
  let timer = null;
  let got200 = false;
  const finish = (result, status, reason) => {
    if (timer !== null) clearTimeout(timer);
    answer({ ok: true, op: 'canary', result, status, reason: reason === null ? null : scrub(reason, key) }, 0);
    if (req !== null) req.destroy();
    agent.destroy();
  };
  const refusedOr = (e, otherwise) => {
    if (e.code === 'ECONNREFUSED') finish('not-ready', null, `the lane's proxy on 127.0.0.1:${port} refused the connection`);
    else otherwise(e);
  };
  timer = setTimeout(() => finish('not-ready', got200 ? 200 : null, got200
    ? `the lane answered 200 but sent no text within ${timeoutS}s`
    : `no text from the lane within ${timeoutS}s`), timeoutS * 1000);

  // 1. THE LANE PROBE: no key, and nothing keyed unless it answers as `id`.
  req = request({
    host: '127.0.0.1', port, method: 'GET', path: '/ccgpt/lane', agent, headers: { accept: 'application/json' },
  });
  req.on('error', (e) => refusedOr(e, (x) => finish('unavailable', null,
    `the lane probe on 127.0.0.1:${port} failed (socket: ${x.code ?? x.message}), so the key was not sent`)));
  req.on('response', (res) => {
    const status = res.statusCode ?? 0;
    const type = String(res.headers['content-type'] ?? '');
    let text = '';
    res.setEncoding('utf8');
    res.on('error', (e) => finish('unavailable', null,
      `the lane probe on 127.0.0.1:${port} failed (socket: ${e.code ?? e.message}), so the key was not sent`));
    res.on('data', (c) => { if (text.length < LANE_PROBE_CAP) text += c.slice(0, LANE_PROBE_CAP - text.length); });
    res.on('end', () => {
      if (laneOf(status, type, text) !== id) {
        finish('unavailable', null, `127.0.0.1:${port} does not answer as ${id}'s shim, so the key was not sent`);
        return;
      }
      post();
    });
  });
  req.end();

  // 2. THE KEYED REQUEST, to a listener that just answered as this lane.
  function post() {
    req = request({
      host: '127.0.0.1', port, method: 'POST', path: '/v1/messages', agent,
      headers: {
        Authorization: `Bearer ${key}`, 'content-type': 'application/json', 'anthropic-version': '2023-06-01',
        accept: 'text/event-stream', 'content-length': Buffer.byteLength(body),
      },
    });
    req.on('error', (e) => refusedOr(e, (x) => finish('failed', null, `socket: ${x.code ?? x.message}`)));
    req.on('response', (res) => {
      const status = res.statusCode ?? 0;
      res.setEncoding('utf8');
      res.on('error', (e) => finish('failed', status, `socket: ${e.code ?? e.message}`));
      if (status !== 200) {
        let text = '';
        res.on('data', (c) => { if (text.length < ERROR_BODY_CAP) text += c.slice(0, ERROR_BODY_CAP - text.length); });
        res.on('end', () => {
          const err = errorText(text);
          if (status === 502 && err !== null && err.startsWith(D4933_PREFIX)) finish('not-ready', 502, err);
          else finish('failed', status, `http ${status}: ${err ?? text}`);
        });
        return;
      }
      got200 = true;
      const type = String(res.headers['content-type'] ?? '');
      let buf = '';
      let seen = 0;
      let stop = null;
      res.on('data', (chunk) => {
        seen += chunk.length;
        buf += chunk;
        let nl = buf.indexOf('\n');
        while (nl !== -1) {
          const line = buf.slice(0, nl).replace(/\r$/, '');
          buf = buf.slice(nl + 1);
          nl = buf.indexOf('\n');
          if (!line.startsWith('data:')) continue;
          let ev;
          try { ev = JSON.parse(line.slice(5)); } catch { continue; }
          if (ev === null || typeof ev !== 'object') continue;
          if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta'
              && typeof ev.delta.text === 'string' && ev.delta.text.trim() !== '') {
            finish('passed', 200, null);
            return;
          }
          if (ev.type === 'error') {
            finish('failed', 200, `stream-error: ${typeof ev.error?.type === 'string' ? ev.error.type : 'unknown'}`);
            return;
          }
          if (ev.type === 'message_delta' && typeof ev.delta?.stop_reason === 'string') stop = ev.delta.stop_reason;
        }
        if (seen > READ_CAP) finish('failed', 200, `no-text: no text in the first ${READ_CAP} bytes`);
      });
      res.on('end', () => finish('failed', 200, /text\/event-stream/.test(type)
        ? `no-text: the stream ended${stop === null ? '' : ` (stop_reason ${stop})`} before any text`
        : `no-text: the answer was not a stream (${type === '' ? 'no content-type' : type})`));
    });
    req.end(body);
  }
}

function main(argv) {
  const got = {};
  for (let i = 2; i < argv.length; i += 2) {
    const k = argv[i];
    if (typeof k !== 'string' || !k.startsWith('--') || !KEYS.includes(k.slice(2))) {
      return usage(`${JSON.stringify(k ?? '')} is not one of --${KEYS.join(', --')}`);
    }
    const v = argv[i + 1];
    if (typeof v !== 'string' || v.startsWith('--')) return usage(`${k} needs a value`);
    got[k.slice(2)] = v;
  }
  const { id, model } = got;
  const effort = got.effort ?? 'none';
  if (typeof id !== 'string' || !MODELS_LANE_ID_RE.test(id)) return usage('--id must be a lane id');
  if (typeof model !== 'string' || !MODEL_ID_RE.test(model)) return usage('--model must be a model id');
  if (!EFFORT_RE.test(effort)) return usage('--effort must be 1 to 64 printable characters, or none');
  let timeoutS = CANARY_TIMEOUT_S;
  if (got['timeout-s'] !== undefined) {
    const t = got['timeout-s'];
    if (!/^[0-9]{1,3}$/.test(t) || Number(t) < 1 || Number(t) > TIMEOUT_MAX_S) {
      return usage(`--timeout-s must be a whole number from 1 to ${TIMEOUT_MAX_S}`);
    }
    timeoutS = Number(t);
  }
  const lane = laneInputs(id);
  if (lane.why !== undefined) {
    return answer({ ok: true, op: 'canary', result: 'unavailable', status: null, reason: lane.why }, 0);
  }
  return send(lane.port, lane.key, id, model, effort === 'none' ? null : effort, timeoutS);
}

main(process.argv);
