// D-8166 (plan docs/superpowers/plans/2026-11-10-test-box-connect.md, Task TC1): the ONE contract of the
// `ccrc testbox-admin` verb, `shared/testbox-admin.ts`. The sub table and its step-up marks; the argv builder's refusals
// (a field the sub does not take, a leading dash, a `..` segment, a C0 byte or DEL), one `--name=value` word a value, no
// bare flag, no `--force`, no `--replace`; the L0 copy of `_tb_shape` held equal to the bash function on one corpus; the
// 47 keys and their classes read from `ccd/testbox-knobs`; the repository row as base64url JSON; the status reader that
// names no address; the parity gate; and one plain sentence per code.
import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  TESTBOX_ADMIN_SUBS, TESTBOX_ADMIN_SUB_MAP, TESTBOX_ADMIN_CODES, TESTBOX_ADMIN_CODE_SENTENCE, TESTBOX_ADMIN_PHASES,
  TESTBOX_ACTS, TESTBOX_ACT_OUTCOMES, TESTBOX_BOX_KEYS, TESTBOX_HOST_KEYS, TESTBOX_FLEET_EDITABLE, TESTBOX_PAIRING_KEYS,
  TESTBOX_PAIRED_BOX_KEYS, TESTBOX_RUN_SHAPING, TESTBOX_SHAPE_CLASS, TESTBOX_SHAPE_SENTENCE, TESTBOX_REPO_ROW_MAX_BYTES,
  buildTestboxAdminArgv, fitsTestboxShape, isBoxAddress, isPrivateNetworkAddress, isSshPort, isLoginUser, isHostKeyFingerprint, isPrNumber,
  TESTBOX_STEP_UP_SETTINGS, parityArmable, parityCurrentOf, readTestboxAdminStatus, readTestboxParityRecord, readTestboxRepoArg,
  testboxAdminIsLong, testboxAdminNeedsStepUp,
  type TestboxAdminSub, type TestboxAdminFields, type TestboxParityRecord,
} from '../../shared/testbox-admin.js';
import { parseRepoRow } from '../../shared/testbox.js';
import { ghContainedEnv } from './ccdWsHelpers.js';
import { spawnSyncGroup } from './spawnGroup.js';
import { mkTmp, removeTmpFixturesEachTest } from './tmpHelpers.js';

removeTmpFixturesEachTest();

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CCRC = path.join(REPO, 'ccd', 'ccrc');
const KNOBS = path.join(REPO, 'ccd', 'testbox-knobs');
const KNOBS_TEXT = readFileSync(KNOBS, 'utf8');
const US = '\x1f';

const FP = `SHA256:${'A'.repeat(43)}`;
const SHA = 'a'.repeat(64);
const ROW = {
  name: 'project-a', fetchUrl: 'https://testbox.invalid/project-a.git', mirrorPath: '/srv/mirror/project-a.git',
  packages: [{ name: 'server', installInputs: ['server/package.json'], commands: ['./node_modules/.bin/vitest'] }],
  buildOutputs: [], systemTools: [],
};
const SUBS = Object.keys(TESTBOX_ADMIN_SUB_MAP) as TestboxAdminSub[];

/** Valid fields for each sub, the smallest call that builds. */
const MIN: Record<TestboxAdminSub, Record<string, unknown>> = {
  'status': {}, 'read': {}, 'key': { address: '192.0.2.10' }, 'probe': {}, 'pin': { fingerprint: FP },
  'preflight': {}, 'connect': { settings: { CCRC_TESTBOX_WORKERS: '3' }, repos: [ROW] },
  'settings-fleet': { settings: { CCRC_TESTBOX_POLL: '1m' } }, 'settings-box': { settings: { CCRC_TESTBOX_WORKERS: '3' } },
  'cancel': {}, 'parity': {}, 'repair': {}, 'apply-release': {}, 'disconnect': {},
};

const build = (sub: unknown, fields: unknown) => buildTestboxAdminArgv(sub, fields);
const refused = (sub: unknown, fields: unknown, why = 'bad-field') => {
  const r = build(sub, fields);
  expect(r.ok ? 'built' : r.why).toBe(why);
};
const b64 = (s: string): string => Buffer.from(s, 'utf8').toString('base64url');
/** Invalid dotted quads are assembled, never spelled, so no file the topology scanner reads holds an address. */
const q = (...p: (number | string)[]): string => p.join('.');
/** Addresses off the private and documentation ranges are assembled, never spelled, so no file the topology scanner reads holds one. */
const ip = (s: string): string => s.replace(/_/g, '.');

describe('the sub table', () => {
  it('every sub has a spec and every spec a sub', () => {
    expect(Object.keys(TESTBOX_ADMIN_SUBS).sort()).toEqual([...SUBS].sort());
    expect(SUBS).toHaveLength(14);
    expect(SUBS.sort()).toEqual([
      'apply-release', 'cancel', 'connect', 'disconnect', 'key', 'parity', 'pin', 'preflight', 'probe', 'read', 'repair',
      'settings-box', 'settings-fleet', 'status',
    ]);
    for (const s of SUBS) expect(MIN[s], s).toBeDefined();
  });
  it('step-up is exactly key, pin, connect and disconnect', () => {
    expect(SUBS.filter((s) => TESTBOX_ADMIN_SUBS[s].stepUp).sort()).toEqual(['connect', 'disconnect', 'key', 'pin']);
  });
  it('a call needs the step-up when its sub does, or when settings-fleet changes the setting that guards secrets (the deny list), whatever else the body holds', () => {
    expect([...TESTBOX_STEP_UP_SETTINGS]).toEqual(['CCRC_TESTBOX_DENY_GLOBS']);
    for (const s of SUBS) expect(testboxAdminNeedsStepUp(s, {}), s).toBe(TESTBOX_ADMIN_SUBS[s].stepUp);
    expect(testboxAdminNeedsStepUp('settings-fleet', { settings: { CCRC_TESTBOX_POLL: '1m' } })).toBe(false);
    expect(testboxAdminNeedsStepUp('settings-fleet', { settings: { CCRC_TESTBOX_DENY_GLOBS: '*.none' } })).toBe(true);
    expect(testboxAdminNeedsStepUp('settings-fleet', { settings: { CCRC_TESTBOX_POLL: '1m', CCRC_TESTBOX_DENY_GLOBS: '*.pem' } })).toBe(true);
    // a body that is no fields object asks for nothing more (the route refuses it by its own check)
    for (const bad of [null, undefined, 'x', [], { settings: null }, { settings: ['CCRC_TESTBOX_DENY_GLOBS'] }]) expect(testboxAdminNeedsStepUp('settings-fleet', bad)).toBe(false);
    expect(testboxAdminNeedsStepUp('settings-box', { settings: { CCRC_TESTBOX_DENY_GLOBS: '*.pem' } })).toBe(false);
  });
  it('settings-box takes no repository row: only a step-up Connect may put a command head on the fleet host\'s record', () => {
    expect(Object.keys(TESTBOX_ADMIN_SUBS['settings-box'].fields).sort()).toEqual(['settings', 'whenIdle']);
    refused('settings-box', { settings: { CCRC_TESTBOX_WORKERS: '2' }, repos: [ROW] });
    expect(build('connect', { settings: { CCRC_TESTBOX_WORKERS: '2' }, repos: [ROW] }).ok).toBe(true);
  });
  it('the long subs are connect, parity, repair, apply-release and settings-box: the box apply outruns a short sub\'s bound, so it always detaches', () => {
    expect(SUBS.filter((s) => TESTBOX_ADMIN_SUBS[s].long).sort()).toEqual(['apply-release', 'connect', 'parity', 'repair', 'settings-box']);
    expect(testboxAdminIsLong('settings-box', { settings: {} })).toBe(true);
    expect(testboxAdminIsLong('settings-box', { settings: {}, whenIdle: true })).toBe(true);
    expect(testboxAdminIsLong('status', { whenIdle: true })).toBe(false);
  });
  it('a read has no act and every other sub names an act the ledger knows', () => {
    for (const s of SUBS) {
      const act = TESTBOX_ADMIN_SUBS[s].act;
      if (act !== null) expect(TESTBOX_ACTS, s).toContain(act);
    }
    expect(SUBS.filter((s) => TESTBOX_ADMIN_SUBS[s].act === null).sort()).toEqual(['preflight', 'probe', 'read', 'status']);
  });
  it('the acts and outcomes are the ledger\'s closed vocabularies', () => {
    expect([...TESTBOX_ACTS]).toEqual([
      'connect', 'confirm-host-key', 'install', 'pair', 'settings-fleet', 'settings-box', 'parity', 'switch', 'repair',
      'replace', 'disconnect', 'apply-release', 'cancel',
    ]);
    expect([...TESTBOX_ACT_OUTCOMES]).toEqual(['ok', 'refused', 'failed', 'unknown']);
  });
  it('the phases are connect, repair and apply release, settings-box and parity as the plan names them', () => {
    expect(TESTBOX_ADMIN_PHASES.connect).toEqual(['verify', 'copy', 'settings', 'install', 'pair', 'check']);
    expect(TESTBOX_ADMIN_PHASES.repair).toEqual(['verify', 'copy', 'install']);
    expect(TESTBOX_ADMIN_PHASES['apply-release']).toEqual(['verify', 'copy', 'install']);
    expect(TESTBOX_ADMIN_PHASES['settings-box']).toEqual(['wait', 'settings', 'install']);
    expect(TESTBOX_ADMIN_PHASES.parity).toEqual(['legs', 'record']);
  });
});

describe('the argv builder', () => {
  it('builds each sub from its smallest valid fields, the verb and the sub first', () => {
    for (const s of SUBS) {
      const r = build(s, MIN[s]);
      expect(r.ok, s).toBe(true);
      if (r.ok) expect(r.argv.slice(0, 2)).toEqual(['testbox-admin', s]);
    }
  });
  it('a sub off the table is bad-sub', () => {
    for (const s of ['', 'nope', 'Status', null, 7, {}, '__proto__', 'constructor']) refused(s, {}, 'bad-sub');
  });
  it('a field the sub does not take is bad-field', () => {
    for (const s of SUBS) refused(s, { ...MIN[s], force: 'true' });
    refused('status', { address: '192.0.2.10' });
    refused('connect', { address: '192.0.2.10', settings: { CCRC_TESTBOX_WORKERS: '3' }, repos: [ROW] });
    refused('probe', { address: '192.0.2.10' }); refused('preflight', { port: 22 }); refused('pin', { address: '192.0.2.10', fingerprint: FP });
    refused('key', { address: '192.0.2.10', fingerprint: FP });
    refused('cancel', { replace: true });
  });
  it('fields that are not a plain object are bad-field', () => {
    for (const bad of [null, undefined, [], 'x', 3, new Map()]) refused('status', bad);
  });
  it('a required field missing is bad-field', () => {
    refused('key', {}); refused('pin', {});
    refused('settings-fleet', {}); refused('settings-box', {}); refused('connect', {});
    refused('connect', { settings: { CCRC_TESTBOX_WORKERS: '3' } }); refused('connect', { repos: [ROW] });
  });
  it('a value with a leading dash, a dot-dot segment, a C0 byte or DEL is bad-field', () => {
    for (const v of ['-oProxyCommand=x', '--help', '-1']) {
      refused('key', { address: v });
      refused('settings-fleet', { settings: { CCRC_TESTBOX_GIT_KEY: v } });
    }
    refused('settings-box', { settings: { CCRC_TESTBOX_ROOT: '/srv/../etc' } });
    refused('settings-box', { settings: { CCRC_TESTBOX_ROOT: '/srv/..' } });
    refused('settings-box', { settings: { CCRC_TESTBOX_ROOT: '~/a/../b' } });
    for (const c of ['\u0000', '\u0001', '\n', '\r', '\t', '\u001f', '\u007f']) {
      refused('key', { address: `host${c}x` });
      refused('settings-fleet', { settings: { CCRC_TESTBOX_DENY_GLOBS: `*.pem${c}*.key` } });
      refused('settings-box', { settings: { CCRC_TESTBOX_ROOT: `/srv/a${c}b` } });
    }
    expect(build('key', { address: 'host.invalid' }).ok).toBe(true);
  });
  it('each value rides one --name=value word', () => {
    const k = build('key', { address: 'box.invalid', port: 2222, user: 'root' });
    expect(k.ok && k.argv.slice(2)).toEqual(['--address=box.invalid', '--port=2222', '--login=root']);
    const r = build('connect', {
      settings: { CCRC_TESTBOX_EGRESS_ALLOW: 'github.com nodejs.org', CCRC_TESTBOX_WORKERS: '3' }, repos: [ROW],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const words = r.argv.slice(2);
    for (const w of words) expect(w).toMatch(/^--[a-z-]+=\S.*$/);
    expect(words).toEqual([
      '--set=CCRC_TESTBOX_WORKERS=3',
      '--set=CCRC_TESTBOX_EGRESS_ALLOW=github.com nodejs.org', `--repo=${b64(JSON.stringify(ROW))}`,
    ]);
  });
  it('the builder never yields a word that is --force, --replace or a bare flag', () => {
    const calls: [TestboxAdminSub, Record<string, unknown>][] = [
      ...SUBS.map((s) => [s, MIN[s]] as [TestboxAdminSub, Record<string, unknown>]),
      ['disconnect', { replace: true }], ['settings-box', { settings: { CCRC_TESTBOX_RUNS: '2' }, whenIdle: 'true' }],
      ['parity', { prs: [12, '40'] }],
    ];
    for (const [s, fields] of calls) {
      const r = build(s, fields);
      expect(r.ok, s).toBe(true);
      if (!r.ok) continue;
      for (const w of r.argv.slice(2)) {
        expect(w).not.toBe('--force'); expect(w).not.toBe('--replace');
        expect(w).toMatch(/^--[a-z-]+=.+$/);
      }
    }
    expect(build('disconnect', { replace: true })).toEqual({ ok: true, argv: ['testbox-admin', 'disconnect', '--replace=true'] });
    refused('disconnect', { replace: 'false' }); refused('disconnect', { replace: false }); refused('disconnect', { replace: 1 });
    refused('settings-box', { settings: { CCRC_TESTBOX_RUNS: '2' }, whenIdle: 'yes' });
    expect(build('settings-box', { settings: { CCRC_TESTBOX_RUNS: '2' }, whenIdle: true })).toEqual({
      ok: true, argv: ['testbox-admin', 'settings-box', '--set=CCRC_TESTBOX_RUNS=2', '--when-idle=true'],
    });
  });
  it('the caller\'s field cannot spell --from or any flag of its own', () => {
    refused('status', { from: 'agent' }); refused('status', { '--from': 'agent' }); refused('probe', { address: '192.0.2.10 --from=x' });
  });
  it('a settings key outside the sub\'s set is bad-field', () => {
    refused('settings-fleet', { settings: { CCRC_TESTBOX_URL: 'https://testbox.invalid' } });          // a pairing key
    for (const k of TESTBOX_PAIRING_KEYS) refused('settings-fleet', { settings: { [k]: 'x' } });
    refused('settings-fleet', { settings: { CCRC_TESTBOX_WORKERS: '3' } });                           // a box key
    refused('settings-box', { settings: { CCRC_TESTBOX_POLL: '1m' } });                               // a fleet key
    refused('settings-box', { settings: { CCRC_REVIEW_CAP_COORD_LIFT: '1' } });
    refused('settings-box', { settings: { __proto__x: '1' } });
    refused('settings-box', { settings: {} }); refused('settings-box', { settings: ['CCRC_TESTBOX_RUNS=2'] });
    refused('settings-box', { settings: 'CCRC_TESTBOX_RUNS=2' });
  });
  it('the four pairing settings are Connect\'s alone: settings-box refuses each, with a valid value, and connect takes them', () => {
    const valid: Record<string, string> = {
      CCRC_TESTBOX_LISTEN: '10.0.0.9:7443', CCRC_TESTBOX_SERVICE_TOKEN_FILE: '~/.ccrc/t.token', CCRC_TESTBOX_SERVICE_USER: 'svc', CCRC_TESTBOX_PUSH_USER: 'push',
    };
    expect([...TESTBOX_PAIRED_BOX_KEYS]).toEqual(Object.keys(valid));
    for (const k of TESTBOX_PAIRED_BOX_KEYS) {
      expect(fitsTestboxShape(k, valid[k]), k).toBe(true);
      refused('settings-box', { settings: { [k]: valid[k] } });
      refused('settings-box', { settings: { CCRC_TESTBOX_RUNS: '2', [k]: valid[k] } });
      expect(build('connect', { settings: { [k]: valid[k] }, repos: [ROW] }).ok, k).toBe(true);
    }
  });
  it('key takes an optional source, the address the box sees ccrc connect from, under the address grammar', () => {
    const r = build('key', { address: '10.0.0.9', source: '10.0.0.250' });
    expect(r.ok && r.argv).toEqual(['testbox-admin', 'key', '--address=10.0.0.9', '--source=10.0.0.250']);
    expect(build('key', { address: '10.0.0.9' }).ok).toBe(true);
    refused('key', { address: '10.0.0.9', source: '10.0.0.250:22' });
    refused('key', { address: '10.0.0.9', source: '' });
    refused('connect', { settings: { CCRC_TESTBOX_WORKERS: '3' }, repos: [ROW], source: '10.0.0.250' });
  });
  it('a settings value off its shape is bad-field', () => {
    refused('settings-box', { settings: { CCRC_TESTBOX_WORKERS: '0' } });
    refused('settings-box', { settings: { CCRC_TESTBOX_WORKERS: 3 } });
    refused('settings-box', { settings: { CCRC_TESTBOX_RUN_MEMORY_MAX: '4' } });
    refused('settings-box', { settings: { CCRC_TESTBOX_TMPFS: 'yes' } });
    refused('settings-box', { settings: { CCRC_TESTBOX_LISTEN: '192.0.2.10' } });
    refused('settings-box', { settings: { CCRC_TESTBOX_RUNS: '2', CCRC_TESTBOX_ROOT: 'relative/path' } });
    refused('settings-fleet', { settings: { CCRC_TESTBOX_FALLBACK_INSTALL: 'maybe' } });
    refused('settings-fleet', { settings: { CCRC_TESTBOX_POLL: '' } });
  });
  it('the connection fields obey their grammars', () => {
    for (const v of ['192.0.2.10', '2001:db8::1', 'box.example.invalid', 'localhost']) expect(build('key', { address: v }).ok, v).toBe(true);
    for (const v of ['192.0.2.10:22', 'root@box.invalid', 'http://box', '[::1]', q(999, 1, 1, 1), 'box..invalid', '', 3, null]) refused('key', { address: v });
    expect(build('key', { address: 'box.invalid', port: '22' }).ok).toBe(true);
    for (const v of ['0', '65536', '022', 'x', 22.5, -1]) refused('key', { address: 'box.invalid', port: v });
    refused('key', { address: 'box.invalid', user: 'Root' }); refused('key', { address: 'box.invalid', user: 'a b' });
    refused('pin', { fingerprint: 'SHA256:short' });
  });
  it('the builder takes the wire field type TestboxAdminFields as it stands, for every sub', () => {
    const wire: Record<TestboxAdminSub, TestboxAdminFields> = {
      'status': {}, 'read': {}, 'key': { address: 'box.invalid', port: 22, user: 'root' }, 'probe': {}, 'pin': { fingerprint: FP },
      'preflight': {}, 'connect': { settings: { CCRC_TESTBOX_WORKERS: '3' }, repos: [ROW] },
      'settings-fleet': { settings: { CCRC_TESTBOX_POLL: '1m' } },
      'settings-box': { settings: { CCRC_TESTBOX_RUNS: '2' }, whenIdle: true },
      'cancel': {}, 'parity': { prs: [1, '2'] }, 'repair': {}, 'apply-release': {}, 'disconnect': { replace: true },
    };
    for (const s of SUBS) expect(build(s, wire[s]).ok, s).toBe(true);
    // a list of K=V strings is not a settings map
    refused('settings-fleet', { settings: ['CCRC_TESTBOX_POLL=1m'] });
  });
  it('a pull request list is whole numbers, unique, at most twenty', () => {
    expect(build('parity', { prs: [12, '40'] })).toEqual({ ok: true, argv: ['testbox-admin', 'parity', '--pr=12', '--pr=40'] });
    refused('parity', { prs: [] }); refused('parity', { prs: [0] }); refused('parity', { prs: ['07'] }); refused('parity', { prs: [12, 12] });
    refused('parity', { prs: 12 }); refused('parity', { prs: Array.from({ length: 21 }, (_, i) => i + 1) });
    expect(build('parity', { prs: Array.from({ length: 20 }, (_, i) => i + 1) }).ok).toBe(true);
  });
  it('a repository row is base64url JSON that parseRepoRow takes, at most four, each at most 8 KiB', () => {
    const r = build('connect', { settings: { CCRC_TESTBOX_RUNS: '2' }, repos: [ROW, { ...ROW, name: 'project-b' }] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const reposWords = r.argv.filter((w) => w.startsWith('--repo='));
    expect(reposWords).toHaveLength(2);
    for (const w of reposWords) {
      const v = w.slice('--repo='.length);
      expect(v).toMatch(/^[A-Za-z0-9_-]+$/);
      const decoded = Buffer.from(v, 'base64url').toString('utf8');
      expect(parseRepoRow(decoded).ok).toBe(true);
      expect(readTestboxRepoArg(v)).toEqual(parseRepoRow(decoded));
    }
    const mk = (n: number) => Array.from({ length: n }, (_, i) => ({ ...ROW, name: `project-${i}` }));
    expect(build('connect', { settings: { CCRC_TESTBOX_WORKERS: '3' }, repos: mk(4) }).ok).toBe(true);
    refused('connect', { settings: { CCRC_TESTBOX_WORKERS: '3' }, repos: mk(5) });
    refused('connect', { settings: { CCRC_TESTBOX_WORKERS: '3' }, repos: [] });
    refused('connect', { settings: { CCRC_TESTBOX_WORKERS: '3' }, repos: [{ ...ROW, extra: 1 }] });
    refused('connect', { settings: { CCRC_TESTBOX_WORKERS: '3' }, repos: [{ ...ROW, fetchUrl: 'ftp://x/y' }] });
    refused('connect', { settings: { CCRC_TESTBOX_WORKERS: '3' }, repos: [JSON.stringify(ROW)] });
    refused('connect', { settings: { CCRC_TESTBOX_WORKERS: '3' }, repos: ROW });
    const big = { ...ROW, packages: [{ ...ROW.packages[0], commands: Array.from({ length: 40 }, (_, i) => `./node_modules/.bin/vitest-${i}${'x'.repeat(240)}`) }] };
    expect(JSON.stringify(big).length).toBeGreaterThan(TESTBOX_REPO_ROW_MAX_BYTES);
    refused('connect', { settings: { CCRC_TESTBOX_WORKERS: '3' }, repos: [big] });
  });
  it('a repository row survives the round trip through its base64url word, multibyte text included', () => {
    const row = { ...ROW, packages: [{ ...ROW.packages[0], commands: ['./bin/prüfen-日本語-\u{1F600}'] }] };
    const r = build('connect', { settings: { CCRC_TESTBOX_WORKERS: '3' }, repos: [row] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const word = r.argv.find((w) => w.startsWith('--repo='))!.slice(7);
    expect(word).toBe(b64(JSON.stringify(row)));
    const back = readTestboxRepoArg(word);
    expect(back.ok && back.value.packages[0]!.commands).toEqual(row.packages[0]!.commands);
    expect(readTestboxRepoArg('!!').ok).toBe(false);
    expect(readTestboxRepoArg('a').ok).toBe(false);
    expect(readTestboxRepoArg(b64('not json')).ok).toBe(false);
    expect(readTestboxRepoArg(Buffer.from([0xff, 0xfe, 0x41]).toString('base64url')).ok).toBe(false);
  });
});

describe('the keys and their shapes', () => {
  /** `_tb_shape_class`'s case arms: key to class. */
  function bashClasses(): Record<string, string> {
    const body = KNOBS_TEXT.slice(KNOBS_TEXT.indexOf('_tb_shape_class() {'), KNOBS_TEXT.indexOf('_tb_shape() {'));
    const out: Record<string, string> = {};
    for (const m of body.matchAll(/^\s+([A-Z0-9_|]+)\) echo (\w+) ;;/gm)) for (const k of m[1]!.split('|')) out[k] = m[2]!;
    return out;
  }
  const tableKeys = (fn: string): string[] => {
    const start = KNOBS_TEXT.indexOf(`${fn}() {`);
    const end = KNOBS_TEXT.indexOf('\n}\n', start);
    return [...KNOBS_TEXT.slice(start, end).matchAll(/_ccrc_knob (CCRC_TESTBOX_[A-Z0-9_]+) /g)].map((m) => m[1]!);
  };

  it('the shape table names exactly the 47 keys (D-8290 adds the live probes\' three) and each class _tb_shape_class names', () => {
    const bash = bashClasses();
    expect(Object.keys(bash)).toHaveLength(47);
    expect(Object.keys(TESTBOX_SHAPE_CLASS).sort()).toEqual(Object.keys(bash).sort());
    expect({ ...TESTBOX_SHAPE_CLASS }).toEqual(bash);
    expect([...TESTBOX_HOST_KEYS, ...TESTBOX_BOX_KEYS].sort()).toEqual(Object.keys(bash).sort());
  });
  it('the host keys are the 16 and the box keys the 31 of the two tables, in order', () => {
    expect([...TESTBOX_HOST_KEYS]).toEqual(tableKeys('_tb_host_table'));
    expect([...TESTBOX_BOX_KEYS]).toEqual(tableKeys('_tb_box_table'));
    expect(TESTBOX_HOST_KEYS).toHaveLength(16);
    expect(TESTBOX_BOX_KEYS).toHaveLength(31);
  });
  it('the shape sentences are _tb_shape_says, class for class', () => {
    const body = KNOBS_TEXT.slice(KNOBS_TEXT.indexOf('_tb_shape_says() {'), KNOBS_TEXT.indexOf('# ── the defaults table'));
    const bash: Record<string, string> = {};
    for (const m of body.matchAll(/^\s+(\w+)\) echo "([^"]*)" ;;/gm)) bash[m[1]!] = m[2]!;
    delete bash['*'];
    expect({ ...TESTBOX_SHAPE_SENTENCE }).toEqual(bash);
  });
  it('the fleet-editable set is the sixteen host keys less the four pairing keys', () => {
    expect(TESTBOX_PAIRING_KEYS).toHaveLength(4);
    expect(TESTBOX_FLEET_EDITABLE).toHaveLength(12);
    expect([...TESTBOX_FLEET_EDITABLE]).toEqual(tableKeys('_tb_host_table').filter((k) => !TESTBOX_PAIRING_KEYS.includes(k)));
    for (const k of TESTBOX_PAIRING_KEYS) expect(TESTBOX_HOST_KEYS).toContain(k);
  });
  it('the run-shaping keys are seven box keys', () => {
    expect([...TESTBOX_RUN_SHAPING].sort()).toEqual([
      'CCRC_TESTBOX_RUNS', 'CCRC_TESTBOX_RUN_CPU_QUOTA', 'CCRC_TESTBOX_RUN_MEMORY_MAX', 'CCRC_TESTBOX_RUN_SWAP_MAX',
      'CCRC_TESTBOX_RUN_TMPDIR', 'CCRC_TESTBOX_TMPFS', 'CCRC_TESTBOX_WORKERS',
    ]);
    for (const k of TESTBOX_RUN_SHAPING) expect(TESTBOX_BOX_KEYS).toContain(k);
  });

  /** One corpus of fits and misses per class. Printable ASCII and one C0 byte; no newline or tab (one value a line). */
  const CORPUS: string[] = [
    '', ' ', 'x', 'https://testbox.invalid', 'https://testbox.invalid:7790/a', 'ssh://ccrc-tb-push@testbox.invalid/', 'ftp://', '://x',
    'https:// x', 'HTTPS://x.invalid', 'a b', 'https://x\u0001y',
    '/srv/x', '~/x', '~/', '/', '/a/./b', '/a/../b', '/a/..', '~/..', 'relative', '/a b', '/a\u0001b', '~x', '/a//b',
    '5M', '1G', '64K', '0M', '05M', '5m', '5', 'M', '1T', '10G',
    '3s', '2m', '24h', '7d', '0s', '03s', '3', 's', '3w', '60S',
    '2m 10m 1h 1d', '2m  10m', '  2m  ', '2m 10', '2m,10m', '1d',
    'local', 'fail', 'Local', 'install', 'refuse', 'both', 'on', 'off', 'On', 'yes',
    '200%', '1%', '9999%', '10000%', '0%', '200', '2 00%',
    '1', '99', '100', '0', '01', '9', '10',
    '127.0.0.2:4873', '[::1]:7790', 'box.invalid:1', 'box.invalid:65535', 'box.invalid:65536', 'box.invalid:0', 'box.invalid:07',
    'box.invalid', ':22', 'a:b:22', '[::1]', '192.0.2.10:7790',
    '*.pem *.key .env .env.* id_* *.p12', '*.pem', '*.pem\u0001x', '  ',
    'github.com nodejs.org', 'github.com', '-bad.invalid', 'bad-.invalid', 'a_b.invalid', 'a.b-c.d', 'x y z',
    'CCRC_HISTORY_BASE CCRC_LEDGER_BASE', 'CCRC_X', 'ccrc_x', '1X', '_X', 'X-Y', 'A B',
    'ccrc-tb-push', 'ccrc-tb-', 'Root', 'a', '_a', '-a', 'a b', 'a.b', 'a_b-c9', '9a',
  ];

  it('fitsTestboxShape agrees with _tb_shape on the shared corpus', () => {
    const home = mkTmp('tbadmin-home-');
    const env = ghContainedEnv(home, { HOME: home, PATH: process.env['PATH'] ?? '/usr/bin:/bin', LANG: 'C' });
    const keys = Object.keys(TESTBOX_SHAPE_CLASS);
    const lines: string[] = [];
    for (const k of keys) for (const v of CORPUS) lines.push(`${k}${US}${v}`);
    const input = path.join(home, 'corpus.txt');
    writeFileSync(input, lines.join('\n') + '\n');
    const script = [
      '. "$1" || exit 90', 'PROG="ccrc test"', '. "$2" || exit 91',
      'while IFS="$(printf "\\037")" read -r k v; do',
      '  if _tb_shape "$k" "$v"; then echo 1; else echo 0; fi',
      'done < "$3"',
    ].join('\n');
    const r = spawnSyncGroup('bash', ['-c', script, 'driver', CCRC, KNOBS, input], { env, encoding: 'utf8', timeout: 120_000 });
    expect(r.status, r.stderr).toBe(0);
    const bash = r.stdout.trim().split('\n');
    expect(bash).toHaveLength(lines.length);
    const mismatches: string[] = [];
    let fits = 0;
    let i = 0;
    for (const k of keys) {
      for (const v of CORPUS) {
        const want = bash[i++] === '1';
        if (want) fits += 1;
        if (fitsTestboxShape(k, v) !== want) mismatches.push(`${k}=${JSON.stringify(v)} bash ${want}`);
      }
    }
    expect(mismatches).toEqual([]);
    expect(fits, 'the corpus has fits').toBeGreaterThan(100);
    expect(fits, 'the corpus has misses').toBeLessThan(lines.length - 500);
    // Every class has at least one fit and one miss in the corpus.
    for (const cls of new Set(Object.values(TESTBOX_SHAPE_CLASS))) {
      const k = keys.find((x) => TESTBOX_SHAPE_CLASS[x] === cls)!;
      expect(CORPUS.some((v) => fitsTestboxShape(k, v)), `${cls} has a fit`).toBe(true);
      expect(CORPUS.some((v) => !fitsTestboxShape(k, v)), `${cls} has a miss`).toBe(true);
    }
  });
  it('an unknown key or a non-string value fits nothing', () => {
    expect(fitsTestboxShape('CCRC_NOT_A_KEY', '1')).toBe(false);
    expect(fitsTestboxShape('__proto__', '1')).toBe(false);
    expect(fitsTestboxShape('CCRC_TESTBOX_RUNS', 2)).toBe(false);
  });
});

describe('the connection grammars', () => {
  it('isBoxAddress takes an IP literal or a host name and nothing else', () => {
    for (const v of ['10.0.0.1', q(255, 255, 255, 255), '::1', '2001:db8::1', '2001:db8:0:0:0:0:0:1', 'fe80::', 'a.b', 'box-1.example.invalid', 'x']) expect(isBoxAddress(v), v).toBe(true);
    for (const v of [q(256, 1, 1, 1), '1.2.3', q(1, 2, 3, 4, 5), q('01', 2, 3, 4), 'a:b', '1:2:3:4:5:6:7:8:9', ':::', '1::2::3', 'g::1', 'box:22', 'a@b', ' a', 'a b', '-a', 'a-', 'a..b', '.a', 'a.', '[::1]', 'a/b', '', 'é.invalid', 'a'.repeat(64) + '.invalid', ('a.'.repeat(130)) + 'b', 4, null, undefined]) expect(isBoxAddress(v), String(v)).toBe(false);
  });
  it('isPrivateNetworkAddress is RFC 1918, 100.64/10 and fc00::/7, for IP literals only', () => {
    for (const v of ['10.0.0.1', '10.255.255.255', '172.16.0.1', '172.31.255.255', '192.168.0.1', ip('100_64_0_1'), ip('100_127_255_255'), 'fc00::1', 'fd7a:115c:a1e0::1', 'fdff::']) {
      expect(isPrivateNetworkAddress(v), v).toBe(true);
    }
    for (const v of [ip('172_15_255_255'), ip('172_32_0_1'), ip('192_169_0_1'), ip('100_63_255_255'), ip('100_128_0_1'), ip('11_0_0_1'), ip('8_8_8_8'), '127.0.0.1', ip('169_254_1_1'),
      'fbff::1', 'fe80::1', '2001:db8::1', '::1', '::', 'box.invalid', '', 5, null, `${q(10, 0, 0)}`]) {
      expect(isPrivateNetworkAddress(v), String(v)).toBe(false);
    }
  });
  it('isSshPort is 1 to 65535', () => {
    for (const v of [1, 22, 65535, '1', '22', '65535']) expect(isSshPort(v), String(v)).toBe(true);
    for (const v of [0, 65536, -1, 1.5, '0', '65536', '022', '1e3', ' 22', '22 ', '', null, undefined, NaN]) expect(isSshPort(v), String(v)).toBe(false);
  });
  it('isLoginUser is a POSIX user name', () => {
    for (const v of ['root', 'ubuntu', 'a', '_svc', 'ccrc-admin', 'u1', 'a'.repeat(32)]) expect(isLoginUser(v), v).toBe(true);
    for (const v of ['Root', '1a', '-a', 'a b', 'a:b', 'a@b', '', 'a'.repeat(33), 'a.b', null, 1]) expect(isLoginUser(v), String(v)).toBe(false);
  });
  it('isHostKeyFingerprint is SHA256: and 43 base64 characters', () => {
    expect(isHostKeyFingerprint(FP)).toBe(true);
    expect(isHostKeyFingerprint(`SHA256:${'a+/Z9'.repeat(8)}abc`)).toBe(true);
    for (const v of ['SHA256:' + 'A'.repeat(42), 'SHA256:' + 'A'.repeat(44), 'SHA256:' + 'A'.repeat(42) + '=', 'MD5:' + 'A'.repeat(43), 'sha256:' + 'A'.repeat(43), 'SHA256:' + 'A'.repeat(42) + '-', '', null]) expect(isHostKeyFingerprint(v), String(v)).toBe(false);
  });
  it('isPrNumber is a whole number from 1 to 999999', () => {
    for (const v of [1, 12, 999999, '1', '4321']) expect(isPrNumber(v), String(v)).toBe(true);
    for (const v of [0, 1_000_000, -1, 1.5, '0', '07', '1000000', 'x', '', null, NaN]) expect(isPrNumber(v), String(v)).toBe(false);
  });
});

const STATUS = {
  v: 1, connected: true, addressSet: true, login: 'root', fingerprint: FP, hostKey: 'pinned', boxFileSha256: SHA,
  act: null, boxSettings: null, boxSettingsAt: null, parity: null,
};
const PARITY: TestboxParityRecord = {
  v: 1, result: 'pass', prs: [{ repo: 'project-a', number: 7, rev: 'b'.repeat(40) }],
  fixtures: [{ name: 'git-state', result: 'pass' }, { name: 'socket', result: 'pass' }, { name: 'workers', result: 'pass' }],
  release: 'v1.2.3', toolsKey: 'tools-abc123', fingerprint: FP, boxFileSha256: SHA, at: 1_700_000_000_000,
};
const ACT = {
  id: 'c'.repeat(32), sub: 'connect', phase: 'install', phases: [{ name: 'verify', ms: 1200 }, { name: 'copy', ms: 800 }],
  outcome: 'running', code: null, startedAt: 1_700_000_000_000, endedAt: null,
};
const read = (v: unknown) => readTestboxAdminStatus(JSON.stringify(v));

describe('the status reader', () => {
  it('installedTag is a release tag or null, and a status without it (an older verb) reads as null', () => {
    const ok = read({ ...STATUS, installedTag: 'v1.2.3' });
    expect(ok.ok && ok.value.installedTag).toBe('v1.2.3');
    const old = read(STATUS);
    expect(old.ok && old.value.installedTag).toBeNull();
    for (const bad of ['1.2.3', 'v1.2', '/etc/x', 'v01.2.3', 5]) expect(read({ ...STATUS, installedTag: bad }).ok, String(bad)).toBe(false);
  });

  it('endedActs is a list of at most six act states, and a status without it (an older verb) reads as none', () => {
    const old = read(STATUS);
    expect(old.ok && old.value.endedActs).toEqual([]);
    const some = read({ ...STATUS, endedActs: [ACT, { ...ACT, id: 'e'.repeat(32) }] });
    expect(some.ok && some.value.endedActs?.map((a) => a.id)).toEqual([ACT.id, 'e'.repeat(32)]);
    expect(read({ ...STATUS, endedActs: Array.from({ length: 7 }, () => ACT) }).ok).toBe(false);
    expect(read({ ...STATUS, endedActs: [{ ...ACT, address: '10.0.0.9' }] }).ok).toBe(false);
    expect(read({ ...STATUS, endedActs: 'none' }).ok).toBe(false);
  });

  it('reads the document the verb prints', () => {
    const r = read({ ...STATUS, act: ACT, parity: PARITY, boxSettingsAt: 1_700_000_000_000, boxSettings: [
      { key: 'CCRC_TESTBOX_WORKERS', state: 'ok', value: '3', from: 'file' },
      { key: 'CCRC_TESTBOX_ROOT', state: 'ok', from: 'default' },
      { key: 'CCRC_TESTBOX_RUN_MEMORY_MAX', state: 'refused', from: 'file', why: TESTBOX_SHAPE_SENTENCE.size },
      { key: 'CCRC_TESTBOX_LISTEN', state: 'unmeasured', why: 'the box did not answer' },
    ] });
    expect(r.ok, r.ok ? '' : r.reason).toBe(true);
    expect(readTestboxAdminStatus(JSON.stringify(STATUS)).ok).toBe(true);
    expect(read({ ...STATUS, connected: false, addressSet: false, login: null, fingerprint: null, hostKey: 'none', boxFileSha256: null }).ok).toBe(true);
  });
  it('readTestboxAdminStatus refuses an unknown field and any address text', () => {
    for (const bad of [
      { ...STATUS, address: '192.0.2.10' }, { ...STATUS, host: 'box.invalid' }, { ...STATUS, port: 22 },
      { ...STATUS, fingerprint: '192.0.2.10' }, { ...STATUS, fingerprint: 'box.invalid' },
      { ...STATUS, boxFileSha256: '192.0.2.10' }, { ...STATUS, login: 'ubuntu' }, { ...STATUS, hostKey: 'maybe' },
      { ...STATUS, act: { ...ACT, address: '192.0.2.10' } }, { ...STATUS, act: { ...ACT, id: 'box.invalid' } },
      { ...STATUS, act: { ...ACT, code: 'unreachable at 192.0.2.10' } }, { ...STATUS, act: { ...ACT, phase: 'whatever' } },
      { ...STATUS, parity: { ...PARITY, release: '192.0.2.10' } }, { ...STATUS, parity: { ...PARITY, address: 'x' } },
      { ...STATUS, parity: { ...PARITY, prs: [{ repo: 'p', number: 1, rev: 'b'.repeat(40), url: 'x' }] } },
      { ...STATUS, boxSettings: [{ key: 'CCRC_TESTBOX_LISTEN', state: 'ok', value: '192.0.2.10:7790', from: 'file' }] },
      { ...STATUS, boxSettings: [{ key: 'CCRC_TESTBOX_ROOT', state: 'ok', value: '/srv/x', from: 'file' }] },
      { ...STATUS, boxSettings: [{ key: 'CCRC_TESTBOX_EGRESS_ALLOW', state: 'ok', value: 'box.invalid', from: 'file' }] },
      { ...STATUS, boxSettings: [{ key: 'CCRC_TESTBOX_WORKERS', state: 'ok', from: 'file' }] },
      { ...STATUS, boxSettings: [{ key: 'CCRC_TESTBOX_WORKERS', state: 'ok', value: 'ten', from: 'file' }] },
      { ...STATUS, boxSettings: [{ key: 'CCRC_TESTBOX_POLL', state: 'ok', value: '1m', from: 'file' }] },
      { ...STATUS, boxSettings: [{ key: 'CCRC_TESTBOX_ROOT', state: 'refused', from: 'file', why: 'not /srv/x' }] },
      { ...STATUS, boxSettings: [{ key: 'CCRC_TESTBOX_ROOT', state: 'refused', from: 'file', why: TESTBOX_SHAPE_SENTENCE.path, value: '/srv/x' }] },
      { ...STATUS, boxSettings: [{ key: 'CCRC_TESTBOX_ROOT', state: 'unmeasured', why: 'see 192.0.2.10' }] },
      { ...STATUS, boxSettings: [
        { key: 'CCRC_TESTBOX_ROOT', state: 'ok', from: 'file' }, { key: 'CCRC_TESTBOX_ROOT', state: 'ok', from: 'file' }] },
    ]) {
      const r = read(bad);
      expect(r.ok, JSON.stringify(bad).slice(0, 120)).toBe(false);
    }
    const { act: _a, ...short } = STATUS;
    expect(read(short).ok).toBe(false);
    expect(read({ ...STATUS, v: 2 }).ok).toBe(false);
    expect(readTestboxAdminStatus('not json').ok).toBe(false);
    expect(readTestboxAdminStatus('[]').ok).toBe(false);
    expect(readTestboxAdminStatus('null').ok).toBe(false);
  });
  it('the parity record reader holds the record to its shape', () => {
    expect(readTestboxParityRecord(JSON.stringify(PARITY))).toEqual({ ok: true, value: PARITY });
    expect(readTestboxParityRecord(JSON.stringify({ ...PARITY, result: 'maybe' })).ok).toBe(false);
    expect(readTestboxParityRecord(JSON.stringify({ ...PARITY, fixtures: [{ name: 'other', result: 'pass' }] })).ok).toBe(false);
    expect(readTestboxParityRecord(JSON.stringify({ ...PARITY, at: -1 })).ok).toBe(false);
    expect(readTestboxParityRecord('{').ok).toBe(false);
  });
});

describe('the parity gate', () => {
  const cur = { fingerprint: FP, boxFileSha256: SHA, stale: false };
  it('the stale mark rides the status (parityStale), read as false when absent and set only when true, and every consumer feeds it to the gate', () => {
    const old = read(STATUS);
    expect(old.ok && old.value.parityStale).toBeUndefined();
    const stale = read({ ...STATUS, parity: PARITY, parityStale: true });
    expect(stale.ok && stale.value.parityStale).toBe(true);
    const clear = read({ ...STATUS, parity: PARITY, parityStale: false });
    expect(clear.ok && clear.value.parityStale).toBeUndefined();
    expect(read({ ...STATUS, parityStale: 'yes' }).ok).toBe(false);
    // the digest and the pin still match the record (an edit and its undo), and the mark alone makes it unarmable
    const s = { fingerprint: FP, boxFileSha256: SHA };
    expect(parityArmable(PARITY, parityCurrentOf(s))).toBe(true);
    expect(parityArmable(PARITY, parityCurrentOf({ ...s, parityStale: false }))).toBe(true);
    expect(parityArmable(PARITY, parityCurrentOf({ ...s, parityStale: true }))).toBe(false);
  });
  it('parityArmable is false with no record, a failed record, a stale mark, a moved fingerprint or a moved box file sha256, and true only when all match', () => {
    expect(parityArmable(null, cur)).toBe(false);
    expect(parityArmable({ ...PARITY, result: 'fail' }, cur)).toBe(false);
    expect(parityArmable(PARITY, { ...cur, stale: true })).toBe(false);
    expect(parityArmable(PARITY, { ...cur, fingerprint: `SHA256:${'B'.repeat(43)}` })).toBe(false);
    expect(parityArmable(PARITY, { ...cur, fingerprint: null })).toBe(false);
    expect(parityArmable(PARITY, { ...cur, boxFileSha256: 'c'.repeat(64) })).toBe(false);
    expect(parityArmable(PARITY, { ...cur, boxFileSha256: null })).toBe(false);
    expect(parityArmable(PARITY, cur)).toBe(true);
  });
});

describe('the codes', () => {
  it('every code has a sentence of one line that names no value', () => {
    expect(Object.keys(TESTBOX_ADMIN_CODE_SENTENCE).sort()).toEqual([...TESTBOX_ADMIN_CODES].sort());
    for (const c of [
      'busy', 'unsupported-os', 'no-access-key', 'foreign-key', 'unreachable', 'auth-refused', 'host-key-unknown', 'host-key-changed',
      'fingerprint-mismatch', 'from-mismatch', 'no-root', 'no-sudo', 'os-mismatch', 'systemd-too-old', 'no-nftables', 'not-xfs-reflink',
      'address-not-ip', 'no-egress', 'other-release', 'verify-failed', 'copy-failed', 'box-value-refused', 'install-refused',
      'install-failed', 'pair-failed', 'status-not-ok', 'pairing-keys-in-ccrc-env', 'key-in-ccrc-env', 'runs-in-progress',
      'idle-deadline', 'cancelled', 'gh-signed-out', 'parity-differs', 'not-connected', 'box-side-skipped',
      'interrupted',
    ]) expect(TESTBOX_ADMIN_CODES, c).toContain(c);
    expect(TESTBOX_ADMIN_CODES.length).toBeGreaterThanOrEqual(35);
    for (const c of TESTBOX_ADMIN_CODES) {
      const s = TESTBOX_ADMIN_CODE_SENTENCE[c];
      expect(s, c).toMatch(/^[A-Za-z][^\n\r]{10,160}[.]$/);
      expect(s, c).not.toMatch(/[0-9/@:\\]|CCRC_|https?|~/);
      expect(s, c).not.toContain('\n');
    }
  });
});
