// `ccrc update`'s test box signal (test box TB11, D-7413, D-7567; spec §2.10): after a roll whose health gate PASSED,
// and only when CCRC_TESTBOX_URL is set, exactly one `ccrc-api testbox tools-sync` call, the action the Settings card's
// button sends. With no URL there is no call; a gate that failed (and restored) makes none; a failed call is one WARN
// line and the update still exits 0. The box and the release are the update suite's STUB fixtures (update's own logic);
// `~/.local/bin/ccrc-api` is a recorder, so nothing leaves the fixture HOME.
import { describe, expect, it } from 'vitest';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { removeTmpFixturesEachTest } from './tmpHelpers.js';
import { REPO, freshUpdateBox, packRelease, plantOldBox, plantRestoreBox, runUpdate, stubTree } from './ccrc-updateFixture.js';

removeTmpFixturesEachTest();

/** The recorder: one argv line per call to `ccrc-api-argv`, then the planted body and `http <code>`, or exit `exit`
 *  with nothing (the client's no-response exit is 3). Shell builtins only. */
function plantApi(home: string, text: string, code = 200, exit = 0): void {
  writeFileSync(join(home, 'testbox-sync-answer'), `${text}\n`);
  mkdirSync(join(home, '.local', 'bin'), { recursive: true });
  writeFileSync(join(home, '.local', 'bin', 'ccrc-api'), [
    '#!/bin/sh',
    'printf \'%s\\n\' "$*" >> "$HOME/ccrc-api-argv"',
    `[ ${exit} -eq 0 ] || exit ${exit}`,
    'while IFS= read -r l; do printf \'%s\\n\' "$l"; done < "$HOME/testbox-sync-answer"',
    `printf 'http %s\\n' ${code} >&2`,
    '',
  ].join('\n'), { mode: 0o755 });
}
const SENT = JSON.stringify({ ok: true, outcome: 'sent' });
const calls = (home: string): string[] => (existsSync(join(home, 'ccrc-api-argv'))
  ? readFileSync(join(home, 'ccrc-api-argv'), 'utf8').split('\n').filter((l) => l !== '') : []);
const configure = (home: string): void => {
  mkdirSync(join(home, '.ccrc'), { recursive: true });
  appendFileSync(join(home, '.ccrc', 'ccrc.env'), 'CCRC_TESTBOX_URL=https://testbox.invalid:7790\n');
};
/** A box on v1.0.0 with the STUB v2.0.0 published: `ccrc update` moves it and its gate passes. */
function movingBox(prefix: string): string {
  const home = freshUpdateBox(prefix);
  plantOldBox(home, { version: 'v1.0.0' });
  packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
  return home;
}

describe('ccrc update: one tools sync to the test box after a passed gate, configured only (D-7413)', () => {
  it('no URL: the update moves and makes no call', () => {
    const home = movingBox('ccrc-upd-tbox-nourl-');
    plantApi(home, SENT);
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(calls(home)).toEqual([]);
    expect(r.stdout).not.toMatch(/test box/);
  });

  it('with a URL: exactly one call, after the gate passed', () => {
    const home = movingBox('ccrc-upd-tbox-sent-');
    configure(home);
    plantApi(home, SENT);
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(calls(home)).toEqual(['testbox tools-sync']);
    const lines = r.stdout.split('\n');
    const gate = lines.findIndex((l) => /^update: gate: .* answers on v2\.0\.0/.test(l));
    const sent = lines.indexOf('update: test box: tools sync sent');
    expect(gate, 'the gate passed').toBeGreaterThanOrEqual(0);
    expect(sent, 'the signal is said').toBeGreaterThan(gate);
  });

  it('a failed call is one WARN line and the update still exits 0: no answer, a refusal, a sync not sent', () => {
    const dead = movingBox('ccrc-upd-tbox-dead-');
    configure(dead);
    plantApi(dead, '', 200, 3);
    let r = runUpdate(dead);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(calls(dead)).toEqual(['testbox tools-sync']);
    expect(r.stdout).toContain('update: WARN: test box: tools sync not sent — the server did not answer (ccrc-api exited 3)');

    const refused = movingBox('ccrc-upd-tbox-501-');
    configure(refused);
    plantApi(refused, JSON.stringify({ ok: false, error: 'unsupported', detail: 'agent has no testbox-tools-sync op' }), 501);
    r = runUpdate(refused);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(calls(refused)).toHaveLength(1);
    expect(r.stdout).toContain('update: WARN: test box: tools sync not sent — the server answered 501: unsupported: agent has no testbox-tools-sync op');

    const notSent = movingBox('ccrc-upd-tbox-busy-');
    configure(notSent);
    plantApi(notSent, JSON.stringify({ ok: false, outcome: 'unconfigured' }));
    r = runUpdate(notSent);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).toContain('update: WARN: test box: tools sync not sent — the server answered 200: unconfigured');
  });

  it('with a URL but no client: a WARN line, no failure', () => {
    const home = movingBox('ccrc-upd-tbox-noapi-');
    configure(home);
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).toContain('update: WARN: test box: tools sync not sent — no ccrc-api at ~/.local/bin/ccrc-api');
  });

  it('a gate that failed and restored makes no call, and its exit is unchanged (4)', () => {
    const home = freshUpdateBox('ccrc-upd-tbox-gatefail-');
    plantRestoreBox(home);
    configure(home);
    plantApi(home, SENT);
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(4);
    expect(calls(home)).toEqual([]);
  });

  it('--no-gate measured nothing, so it makes no call', () => {
    const home = movingBox('ccrc-upd-tbox-nogate-');
    configure(home);
    plantApi(home, SENT);
    const r = runUpdate(home, ['--no-gate']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(calls(home)).toEqual([]);
  });

  it('ccd/ccrc spells the call once, and cmd_update reaches it from one line', () => {
    const src = readFileSync(join(REPO, 'ccd', 'ccrc'), 'utf8').split('\n').filter((l) => !/^\s*#/.test(l));
    expect(src.filter((l) => /\btestbox tools-sync\b/.test(l))).toHaveLength(1);
    expect(src.filter((l) => /\b_upd_testbox_signal\b/.test(l) && !/^_upd_testbox_signal\(\)/.test(l)))
      .toEqual(['  if [ "$gate_passed" -eq 1 ] && [ "$UPD_FROM" != restore ]; then _upd_testbox_signal "$role"; fi']);
  });
});
