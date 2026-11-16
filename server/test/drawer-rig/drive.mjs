#!/usr/bin/env node
// drive.mjs — one scenario of the terminal drawer capture rig (spec
// docs/superpowers/specs/2026-10-14-terminal-drawer-every-width-design.md §9,
// plan docs/superpowers/plans/2026-10-14-terminal-drawer-every-width-stage1.md
// Task 6, D-5006). Drives one mock-scripted Claude Code session inside a private
// tmux server, records the 220x51 node-pty attach byte stream and the matching
// 220x50 capture-pane output, and writes one fixture JSON. The captures are
// SYNTHETIC (mock API, fixture HOME, fixture repo under /rig); no live session.
//
// Usage:
//   node drive.mjs --check <scenario.json>
//   node drive.mjs <scenario.json> <out.json>
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

// The window is shared/api.ts's PINNED_WINDOW_COLS x PINNED_WINDOW_ROWS; tmux's one default status line
// (`ccd/tmux.conf` leaves it on) takes one more row from every client, so the drawer's client is 220x51
// (the plan's TMUX_STATUS_ROWS; spec W6, W8). Spelled here because this script runs under plain node in the
// container, where shared/'s TypeScript is not importable; each fixture records `cols` and `rows`.
const COLS = 220;
const WINDOW_ROWS = 50;
const STATUS_ROWS = 1;
const CLIENT_ROWS = WINDOW_ROWS + STATUS_ROWS;

const SOCK = 'drawerrig';
const SESSION = 'cc-demo';
const TARGET = '=cc-demo:';

const QUIET_MS = 300;
const READ_CAP_MS = 2000;
const SECOND_CAPTURE_MS = 200;
const MAX_ANIMATED = 2;
const READY_RE = /\? for shortcuts|(manual|plan|auto) mode on|accept edits on/;
const WAIT_S = 90;

const MOCK = '/rig/src/mockapi.mjs';
const CONF = '/rig/src/tmux.conf';
const RUN = '/rig/run';
const HOME = '/rig/home';

const NAME_RE = /^[a-z0-9-]{1,40}$/;
const KEY_RE = /^[A-Za-z][A-Za-z0-9-]{0,15}$/;
// A model id spliced into the pane's shell command: lower-case letters, digits, dots and dashes only.
const MODEL_RE = /^[a-z][a-z0-9.-]{0,59}$/;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
/** Wait up to 10 s for `pid` to exit, then SIGKILL it (this scenario's own Claude Code, by its pid only). */
async function waitGone(pid) {
  for (let i = 0; i < 100 && alive(pid); i += 1) await sleep(100);
  if (alive(pid)) { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } }
}

function isLine(s) {
  if (typeof s !== 'string' || s.length === 0) return false;
  if (/[\n\r]/.test(s)) return false;
  for (let i = 0; i < s.length; i += 1) {
    const cp = s.codePointAt(i);
    if (cp === undefined) return false;
    if (cp < 0x20 || cp === 0x7f) return false;
  }
  return true;
}

function checkScenario(file) {
  if (!file) return { ok: false, reason: 'missing scenario file' };
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch { return { ok: false, reason: 'cannot read file' }; }
  let s;
  try { s = JSON.parse(raw); } catch (e) { return { ok: false, reason: `invalid JSON: ${e.message}` }; }
  if (!s || typeof s !== 'object' || Array.isArray(s)) return { ok: false, reason: 'not an object' };
  const allowed = new Set(['name', 'covers', 'model', 'prompt', 'marker', 'keys', 'paste', 'entries', 'default']);
  for (const k of Object.keys(s)) {
    if (!allowed.has(k)) return { ok: false, reason: `unknown key: ${k}` };
  }
  if (typeof s.name !== 'string' || !NAME_RE.test(s.name)) return { ok: false, reason: 'bad name' };
  const base = path.basename(file, '.json');
  if (s.name !== base) return { ok: false, reason: `name ${s.name} does not match file ${base}` };
  if (!Array.isArray(s.covers) || s.covers.length === 0 || !s.covers.every((x) => typeof x === 'string' && x.length > 0)) {
    return { ok: false, reason: 'bad covers' };
  }
  if (s.model !== undefined && (typeof s.model !== 'string' || !MODEL_RE.test(s.model))) return { ok: false, reason: 'bad model' };
  if (!isLine(s.prompt)) return { ok: false, reason: 'bad prompt' };
  if (!isLine(s.marker)) return { ok: false, reason: 'bad marker' };
  if (s.keys !== undefined && (!Array.isArray(s.keys) || !s.keys.every((k) => typeof k === 'string' && KEY_RE.test(k)))) {
    return { ok: false, reason: 'bad keys' };
  }
  if (s.paste !== undefined) {
    if (!Array.isArray(s.paste) || s.paste.length !== 2 || !s.paste.every((x) => isLine(x))) {
      return { ok: false, reason: 'bad paste' };
    }
  }
  if (!Array.isArray(s.entries) || s.entries.length === 0) return { ok: false, reason: 'bad entries' };
  return { ok: true, scenario: s };
}

// Every tmux call: the rig's private server only (`-L`), the fleet's own config. A failed call throws, so a
// pane that died (Claude Code exited) fails the scenario at once instead of timing out on a marker.
function tmux(...args) {
  const r = spawnSync('tmux', ['-L', SOCK, '-f', CONF, ...args], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`tmux ${args[0]} failed (status ${r.status}): ${(r.stderr || '').trim()}`);
  return r.stdout;
}

/** `capture-pane -p`: the window's rows, trailing spaces trimmed by tmux. `at` is when the capture STARTED. */
function capturePane() {
  const at = Date.now();
  const rows = tmux('capture-pane', '-p', '-t', TARGET).replace(/\n$/, '').split('\n');
  return { rows, at };
}

async function waitForMarker(re, label) {
  const deadline = Date.now() + WAIT_S * 1000;
  while (Date.now() < deadline) {
    const { rows } = capturePane();
    if (rows.some((r) => re.test(r))) return;
    await sleep(250);
  }
  throw new Error(`${label} not reached`);
}

/** Read the attach stream until it has been quiet for QUIET_MS since the later of `startedAt` and its last
 *  chunk (and something has arrived), or READ_CAP_MS has passed since `startedAt`: an animated screen
 *  (`busy`'s spinner) never goes quiet, so the cap ends its read. `rec` is the live recorder the pty's
 *  onData appends to. Resolves with the time the read ended. */
function readUntilQuiet(rec, startedAt) {
  return new Promise((resolve) => {
    const iv = setInterval(() => {
      const now = Date.now();
      const quiet = rec.data.length > 0 && now - Math.max(rec.last, startedAt) >= QUIET_MS;
      if (quiet || now - startedAt >= READ_CAP_MS) { clearInterval(iv); resolve(now); }
    }, 10);
  });
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === '--check') {
    const file = args[1];
    const r = checkScenario(file);
    if (!r.ok) {
      console.error(`drive: ${file || '<missing>'}: ${r.reason}`);
      process.exit(2);
    }
    process.exit(0);
  }

  const [scenarioPath, outPath] = args;
  if (!scenarioPath || !outPath) {
    console.error('usage: node drive.mjs --check <scenario.json>');
    console.error('       node drive.mjs <scenario.json> <out.json>');
    process.exit(2);
  }

  const checked = checkScenario(scenarioPath);
  if (!checked.ok) {
    console.error(`drive: ${scenarioPath}: ${checked.reason}`);
    process.exit(2);
  }
  const scenario = checked.scenario;

  for (const v of ['RIG_CLAUDE', 'RIG_NODE_PTY', 'RIG_FAKETIME_LIB', 'RIG_CC_VERSION', 'RIG_TMUX_VERSION']) {
    if (!process.env[v]) {
      console.error(`drive: ${scenario.name}: missing env ${v}`);
      process.exit(2);
    }
  }

  let mock = null;
  let pty = null;
  let mockPort = '';
  let panePid = 0;
  let lastCaptureRows = [];
  const rec = { data: '', last: 0 };

  try {
    // Start the scripted mock API.
    mock = spawn(process.execPath, [MOCK], {
      env: {
        PATH: process.env.PATH,
        MOCK_PORT: '0',
        MOCK_SCRIPT: scenarioPath,
        MOCK_LOG: path.join(RUN, 'mock.log'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    mockPort = await new Promise((resolve, reject) => {
      let out = '';
      let err = '';
      const t = setTimeout(() => reject(new Error(`mock did not start: ${err || out}`)), 10_000);
      mock.stderr.on('data', (b) => { err += b.toString(); });
      mock.on('error', reject);
      mock.on('exit', (code) => { clearTimeout(t); reject(new Error(`mock exited ${code}: ${err}`)); });
      mock.stdout.on('data', (b) => {
        out += b.toString();
        const m = /^mock listening 127\.0\.0\.1:(\d+)$/m.exec(out);
        if (m) { clearTimeout(t); resolve(m[1]); }
      });
    });

    // The pane's command: Claude Code with a clean env. Measured on 2.1.299: it prints the wall clock
    // ("done 2:49 PM"), so it runs under libfaketime from a fixed instant and no real clock is recorded; the
    // key is read from its 0600 file by the pane's shell, so it is on no argv; COLORTERM as ccd's spawn sets it.
    const paneCmd = [
      'cd /rig/project-a && exec env -i',
      `PATH=${path.dirname(process.execPath)}:/usr/bin:/bin`,
      `LD_PRELOAD=${process.env.RIG_FAKETIME_LIB}`,
      "FAKETIME='@2026-01-01 12:00:00'",
      'TZ=UTC',
      'TERM=tmux-256color',
      'LANG=C.UTF-8',
      'LC_ALL=C.UTF-8',
      'HOME=/rig/home',
      'CLAUDE_CONFIG_DIR=/rig/home/.claude',
      'COLORTERM=truecolor',
      'ANTHROPIC_API_KEY="$(cat /rig/run/key)"',
      `ANTHROPIC_BASE_URL=http://127.0.0.1:${mockPort}`,
      'DISABLE_AUTOUPDATER=1',
      'DISABLE_TELEMETRY=1',
      'DISABLE_ERROR_REPORTING=1',
      'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1',
      process.env.RIG_CLAUDE,
      // THE EFFORT HINT. For a model with effort levels, a screen that shows the input box carries a right-aligned
      // `◐ medium · /effort`, and the delegation rig's allowlist scanner reads ` /effort` as an absolute path
      // outside `/rig`: measured, it refused the busy, markdown-table-code and reply-done recordings whole. Those
      // scenarios name `claude-sonnet-4-5`, for which 2.1.299 shows no effort hint. The dialog scenarios keep the
      // default model: their dialog covers the box, and on claude-sonnet-4-5 the Bash prompt loses its "switch to
      // auto mode" option (4 options become 3). The right-aligned shape is the synthetic screens' to cover.
      ...(scenario.model ? ['--model', scenario.model] : []),
    ].join(' ');

    // The status line stays on (one row, as ccd/tmux.conf leaves it), but tmux's default status-right draws
    // the pane title, a clock and a date: both sides are neutral literals, set in the SAME invocation that
    // creates the session, so no redraw ever shows the defaults. Then the spawn as ccd's `_spawn_start` does
    // it: 220x50, titles, pin, then `latest`.
    tmux('start-server', ';', 'set-option', '-g', 'status-left', '[cc-demo] ', ';', 'set-option', '-g', 'status-right', '', ';', 'new-session', '-d', '-s', SESSION, '-x', String(COLS), '-y', String(WINDOW_ROWS), paneCmd);

    tmux('set-option', '-t', TARGET, 'set-titles', 'on');
    tmux('set-option', '-t', TARGET, 'set-titles-string', '#S');
    tmux('resize-window', '-t', TARGET, '-x', String(COLS), '-y', String(WINDOW_ROWS));
    tmux('set-option', '-t', TARGET, 'window-size', 'latest');

    // The fleet's panes are on the alternate screen (spec W1). Measured on 2.1.299: a seeded config gets it only
    // from the fullscreen renderer (`"tui": "fullscreen"` in the seeded settings), so a pane off it is refused.
    await waitForMarker(READY_RE, 'ready prompt');
    // The pane's process IS Claude Code (the pane command execs it): remembered so teardown can wait for it.
    panePid = Number(tmux('display-message', '-p', '-t', TARGET, '#{pane_pid}').trim()) || 0;
    const alternate = tmux('display-message', '-p', '-t', TARGET, "#{alternate_on}").trim();
    if (alternate !== '1') {
      throw new Error('Claude Code is not on the alternate screen (spec W1)');
    }

    // Type the scenario prompt and submit it.
    tmux('send-keys', '-t', TARGET, '-l', '--', scenario.prompt);
    await sleep(300);
    tmux('send-keys', '-t', TARGET, 'Enter');

    // Wait for the marker that says the screen we want is rendered.
    await waitForMarker(new RegExp(scenario.marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'marker');

    // Send any additional tmux key names (Space, Down, ...).
    if (scenario.keys) {
      for (const k of scenario.keys) {
        tmux('send-keys', '-t', TARGET, k);
        await sleep(400);
      }
    }
    await sleep(500);

    // The mock's request count before the attach: a paste must start no turn after it (checked below).
    const stateBefore = await (await fetch(`http://127.0.0.1:${mockPort}/__rig/state`)).json();
    const requestsBefore = stateBefore.requests;

    // The drawer's attach (server/src/pty.ts's attachPty): node-pty, `tmux attach -t =<name>:`, xterm-256color,
    // at the window's size plus the status row. Measured: a client whose locale is not UTF-8 is sent `_` for
    // every non-ASCII cell, so the env names C.UTF-8 (and carries no TMUX/TMUX_PANE).
    const nodePty = createRequire(path.join(process.env.RIG_NODE_PTY, 'package.json'))('node-pty');
    pty = nodePty.spawn('tmux', ['-L', SOCK, 'attach', '-t', TARGET], {
      name: 'xterm-256color',
      cols: COLS,
      rows: CLIENT_ROWS,
      cwd: HOME,
      env: {
        PATH: process.env.PATH,
        HOME,
        TERM: 'xterm-256color',
        LANG: 'C.UTF-8',
        LC_ALL: 'C.UTF-8',
      },
    });

    pty.onData((data) => { rec.data += data; rec.last = Date.now(); });
    let readEnd = await readUntilQuiet(rec, Date.now());

    // reply-done: the draft typed through the client exactly as the drawer's field frames it (bracketed paste,
    // `\r` between lines). It must land as two lines and stay unsubmitted (spec W11): checked below.
    if (scenario.paste) {
      pty.write(`\x1b[200~${scenario.paste.join('\r')}\x1b[201~`);
      readEnd = await readUntilQuiet(rec, Date.now());
    }

    // First capture: taken immediately after the read ends (no await in between). `attach` is frozen at the
    // same instant, so the pair describes one screen, outside the rows measured as animated below.
    const capture1 = capturePane();
    const attach = rec.data;
    lastCaptureRows = capture1.rows;
    if (capture1.rows.length !== WINDOW_ROWS) {
      throw new Error(`capture has ${capture1.rows.length} rows, expected ${WINDOW_ROWS}`);
    }
    process.stderr.write(`drive: ${scenario.name}: ${Buffer.byteLength(attach)} attach bytes; capture ${capture1.at - readEnd} ms after the read ended\n`);

    // Second capture, after a short sleep, to measure animated rows.
    await sleep(SECOND_CAPTURE_MS);
    const capture2 = capturePane();
    const animatedRows = [];
    for (let i = 0; i < WINDOW_ROWS; i += 1) {
      if (capture1.rows[i] !== capture2.rows[i]) animatedRows.push(i);
    }

    // Checks.
    const clients = tmux('list-clients', '-t', TARGET, '-F', '#{client_width} #{client_height}').trim();
    if (clients !== `${COLS} ${CLIENT_ROWS}`) {
      throw new Error(`list-clients is "${clients}", expected "${COLS} ${CLIENT_ROWS}"`);
    }

    const dims = tmux('display-message', '-p', '-t', TARGET, '#{window_width} #{window_height} #{alternate_on}').trim();
    if (dims !== `${COLS} ${WINDOW_ROWS} 1`) {
      throw new Error(`window dims are "${dims}", expected "${COLS} ${WINDOW_ROWS} 1"`);
    }

    if (attach.length === 0) {
      throw new Error('attach stream is empty');
    }
    if (!capture1.rows.some((r) => r.includes(scenario.marker))) {
      throw new Error('marker not present in capture');
    }
    if (animatedRows.length > MAX_ANIMATED) {
      throw new Error(`too many animated rows: ${animatedRows.length} > ${MAX_ANIMATED}`);
    }

    if (scenario.paste) {
      for (const line of scenario.paste) {
        if (!capture1.rows.some((r) => r.includes(line))) {
          throw new Error(`paste line not present in capture: ${line}`);
        }
      }
      // Unsubmitted: no turn request after the paste. Claude Code still makes SIDE requests (no tools offered)
      // after a reply on its own (measured: one arrived in this window on 2.1.299), so the count alone is not
      // the measure; the mock's log names each request's kind and prompt.
      const after = fs.readFileSync(path.join(RUN, 'mock.log'), 'utf8').split('\n')
        .map((l) => /#(\d+) MESSAGES kind=(\w+) .*prompt="(.*)"$/.exec(l))
        .filter((m) => m !== null && Number(m[1]) > requestsBefore);
      const turns = after.filter((m) => m[2] !== 'side' || m[3].includes(scenario.paste[0]));
      if (turns.length > 0) {
        throw new Error(`the paste was submitted: request(s) ${turns.map((m) => `#${m[1]} ${m[2]}`).join(', ')} after it`);
      }
    }

    const out = {
      scenario: scenario.name,
      covers: scenario.covers,
      claudeCode: process.env.RIG_CC_VERSION,
      tmux: process.env.RIG_TMUX_VERSION,
      cols: COLS,
      rows: CLIENT_ROWS,
      attach,
      capture: capture1.rows,
      animatedRows,
    };
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, `${JSON.stringify(out, null, 1)}\n`);
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    console.error(`drive: ${scenario.name}: ${reason}`);
    try { lastCaptureRows = capturePane().rows; } catch { /* the pane or the server is gone */ }
    for (let i = 0; i < lastCaptureRows.length; i += 1) {
      const r = lastCaptureRows[i];
      if (r && r.length > 0) console.error(`  ${i}: ${r}`);
    }
    process.exitCode = 1;
  } finally {
    if (pty) try { pty.kill(); } catch { /* ignore */ }
    try { tmux('kill-server'); } catch { /* ignore */ }
    // Measured: Claude Code outlives the server's SIGHUP for a moment and keeps writing under /rig/home, and the
    // next scenario's seed then failed to remove it. Wait (bounded) for this scenario's own Claude Code to exit.
    if (panePid > 0) await waitGone(panePid);
    if (mock) try { mock.kill(); } catch { /* ignore */ }
  }
}

main().catch((e) => {
  console.error(`drive: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});
