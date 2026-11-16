// Doctor's `testbox` check (test box TB11, D-7413, D-7444, D-7567): the server's test box block, read through the closed
// client (`ccrc-api testbox status`), on one line that names the state and the switch separately, the box's queue depth
// and the version cells that differ. SKIP with no URL (`off`) and when the block cannot be read; WARN on `degraded`,
// `down` or `unreachable` with the switch on; PASS otherwise, so `ok, switch off` is a PASS. Each row starts from
// `healthy()` and plants one answer. The blocks are the server's own decider's (`testboxBlock`), never hand-typed JSON.
import { describe, expect, it } from 'vitest';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TestboxHostTools, TestboxOpReply } from '../../shared/agent-protocol.js';
import { TESTBOX_REMOTE_LIVE_MARKER } from '../../shared/switches.js';
import { TESTBOX_PROTO, type StatusAnswer } from '../../shared/testbox.js';
import { testboxBlock, type TestboxAnswer } from '../src/testbox.js';
import { removeTmpFixturesEachTest } from './tmpHelpers.js';
import { installDoctorHooks, healthy, runDoctor } from './ccrc-doctorFixture.js';

removeTmpFixturesEachTest();
installDoctorHooks();

const NOW = Date.parse('2026-10-30T12:00:00Z');
const TOOLS = { node: '22.11.0', npm: '10.9.0', tmux: '3.4', git: '2.43.0', python3: '3.12.3', chrome: '131.0.6778.85' };
const HOST = { tools: TOOLS as TestboxHostTools, release: 'v0.0.900', measuredAt: '2026-10-30T11:59:59Z' };
const STATUS: StatusAnswer = {
  t: 'status', state: 'ok', reason: null, serviceVersion: '1.0.0', proto: TESTBOX_PROTO, release: 'v0.0.900', tools: TOOLS,
  sync: { state: 'idle', detail: null, at: null }, runs: { inProgress: 0, limit: 2 }, queueDepth: 3, pristine: [],
  failedKeys: [], heldRunUsers: [], repositories: [],
};
const reply = (box: TestboxOpReply['box']): TestboxAnswer => ({ ok: true, reply: { host: HOST, pollMs: 30_000, box } });
const status = (over: Partial<StatusAnswer>): TestboxAnswer => reply({ ok: true, status: { ...STATUS, ...over } });
/** `GET /api/testbox`'s body for an answer, with the switch on or off, as the route sends it. */
const body = (answer: TestboxAnswer, on: boolean): string =>
  JSON.stringify({ ok: true, testbox: testboxBlock({ answer, listing: on ? [TESTBOX_REMOTE_LIVE_MARKER] : [], logs: ['', ''], now: NOW }) });

/** `~/.local/bin/ccrc-api` as a recorder: argv to `ccrc-api-argv`, the planted body on stdout and `http <code>` on
 *  stderr, as the closed client speaks. Shell builtins only: the fixture's PATH holds no system tool. */
function plantApi(home: string, text: string, code = 200, exit = 0): void {
  writeFileSync(join(home, 'testbox-answer'), `${text}\n`);
  mkdirSync(join(home, '.local', 'bin'), { recursive: true });
  writeFileSync(join(home, '.local', 'bin', 'ccrc-api'), [
    '#!/bin/sh',
    'printf \'%s\\n\' "$*" >> "$HOME/ccrc-api-argv"',
    `[ ${exit} -eq 0 ] || exit ${exit}`,
    'while IFS= read -r l; do printf \'%s\\n\' "$l"; done < "$HOME/testbox-answer"',
    `printf 'http %s\\n' ${code} >&2`,
    '',
  ].join('\n'), { mode: 0o755 });
}
const configure = (home: string): void => appendFileSync(join(home, '.ccrc', 'ccrc.env'), 'CCRC_TESTBOX_URL=https://testbox.invalid:7790\n');

const verdict = (home: string): { line: string; remedy: string } => {
  const lines = runDoctor(home).stdout.split('\n');
  const i = lines.findIndex((l) => / testbox: /.test(l));
  expect(i, 'a testbox line').toBeGreaterThanOrEqual(0);
  return { line: lines[i]!, remedy: lines[i + 1] ?? '' };
};

describe('testbox: the server\'s test box block, the state and the switch on one line (D-7413, D-7444)', () => {
  it('SKIP with no URL: the state is off, and the client is never asked', () => {
    const home = healthy('ccrc-doctor-tbox-nourl-');
    plantApi(home, body(status({}), true));
    expect(verdict(home).line).toBe('SKIP testbox: off: no test box is configured (CCRC_TESTBOX_URL is unset in ~/.ccrc/ccrc.env)');
    expect(existsSync(join(home, 'ccrc-api-argv')), 'no URL asks nothing').toBe(false);
  });

  it('SKIP when the server itself answers off (its URL reads unset)', () => {
    const home = healthy('ccrc-doctor-tbox-srvoff-');
    configure(home);
    plantApi(home, body(reply({ ok: false, failure: 'unconfigured', detail: null }), true));
    expect(verdict(home).line).toMatch(/^SKIP testbox: off: the server's test box answer reads no URL/);
  });

  it('PASS: ok with the switch off is a PASS that names both fields, the queue and the versions', () => {
    const home = healthy('ccrc-doctor-tbox-okoff-');
    configure(home);
    plantApi(home, body(status({}), false));
    expect(verdict(home).line).toBe('PASS testbox: ok, switch off; queue 3; versions match');
    expect(readFileSync(join(home, 'ccrc-api-argv'), 'utf8')).toBe('testbox status\n');
  });

  it('PASS: ok with the switch on', () => {
    const home = healthy('ccrc-doctor-tbox-okon-');
    configure(home);
    plantApi(home, body(status({}), true));
    expect(verdict(home).line).toBe('PASS testbox: ok, switch on; queue 3; versions match');
  });

  it('PASS: degraded with the switch off still says what the box is', () => {
    const home = healthy('ccrc-doctor-tbox-degoff-');
    configure(home);
    plantApi(home, body(status({ tools: { ...TOOLS, node: '22.12.0' } }), false));
    expect(verdict(home).line).toBe('PASS testbox: degraded (tools differ (node 22.11.0 vs 22.12.0)), switch off; queue 3; versions differ: node');
  });

  it('WARN: degraded with the switch on, with its remedy', () => {
    const home = healthy('ccrc-doctor-tbox-degon-');
    configure(home);
    plantApi(home, body(status({ tools: { ...TOOLS, node: '22.12.0' }, release: 'v0.0.899' }), true));
    const v = verdict(home);
    expect(v.line).toBe('WARN testbox: degraded (tools differ (node 22.11.0 vs 22.12.0); tools differ (release v0.0.900 vs v0.0.899)), switch on; queue 3; versions differ: node, release');
    expect(v.remedy).toMatch(/^ {2}remedy: every ccrc test run falls back to the local slice while the box is degraded: /);
  });

  it('WARN: down with the switch on', () => {
    const home = healthy('ccrc-doctor-tbox-downon-');
    configure(home);
    plantApi(home, body(status({ state: 'down', reason: 'missing mirror project-a' }), true));
    expect(verdict(home).line).toBe('WARN testbox: down (missing mirror project-a), switch on; queue 3; versions match');
  });

  it('WARN: unreachable with the switch on; the box\'s fields read unknown', () => {
    const home = healthy('ccrc-doctor-tbox-unron-');
    configure(home);
    plantApi(home, body(reply({ ok: false, failure: 'unreachable', detail: 'no status answer within 3000 ms' }), true));
    expect(verdict(home).line).toBe('WARN testbox: unreachable (no status answer within 3000 ms), switch on; queue unknown; versions unknown');
  });

  it('PASS: unreachable with the switch off', () => {
    const home = healthy('ccrc-doctor-tbox-unroff-');
    configure(home);
    plantApi(home, body({ ok: false, reason: 'no-op' }, false));
    expect(verdict(home).line).toBe('PASS testbox: unreachable (agent has no testbox op), switch off; queue unknown; versions unknown');
  });

  it('SKIP: the server has not polled yet (a null block)', () => {
    const home = healthy('ccrc-doctor-tbox-pending-');
    configure(home);
    plantApi(home, JSON.stringify({ ok: true, testbox: null }));
    expect(verdict(home).line).toBe('SKIP testbox: the server has not polled the test box yet');
  });

  it('SKIP: no client, no answer, and an answer that is not a block (D-7567)', () => {
    const none = healthy('ccrc-doctor-tbox-noapi-');
    configure(none);
    expect(verdict(none).line).toBe('SKIP testbox: no ccrc-api at ~/.local/bin/ccrc-api, so the server\'s test box block cannot be read');
    const dead = healthy('ccrc-doctor-tbox-dead-');
    configure(dead);
    plantApi(dead, '', 200, 3);
    expect(verdict(dead).line).toBe('SKIP testbox: the server did not answer GET /api/testbox (ccrc-api exited 3)');
    const refused = healthy('ccrc-doctor-tbox-401-');
    configure(refused);
    plantApi(refused, JSON.stringify({ ok: false, error: 'unauthenticated' }), 401);
    expect(verdict(refused).line).toBe('SKIP testbox: the server\'s answer to GET /api/testbox is not a test box block (http 401)');
  });

  it('the check sits in the memory group, right after test-slice', () => {
    const home = healthy('ccrc-doctor-tbox-order-');
    const names = runDoctor(home).stdout.split('\n').map((l) => /^(?:PASS|WARN|FAIL|SKIP) ([^:]+):/.exec(l)?.[1]).filter((n): n is string => n !== undefined);
    expect(names.slice(names.indexOf('test-slice'), names.indexOf('test-slice') + 2)).toEqual(['test-slice', 'testbox']);
  });
});
