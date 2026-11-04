// Box settings view, Task 3 (D-6916, D-7861; spec 2026-10-25 §2.2, §2.4, §2.6): the console reads each node's
// `~/.ccrc/box-settings.json`. The pure L1 parse and view (`update/boxSettings.ts`), the lane that reads the file inside the
// inventory run (`update/boxSettingsLane.ts`), FleetWatcher's held state and the `GET /api/updates` join.
//
// Every case runs in a mkTmp fixture HOME. The corpus row runs the REAL `bash ccd/ccrc settings` there, with `date`, `df` and `du`
// stubbed by PATH so the bytes are the same on every box; nothing reaches the live HOME. Neutral names only: this repository is public.
//
// To regenerate server/test/fixtures/box-settings/ after the verb's output legitimately changes:
//   BOX_SETTINGS_FIXTURES=write ~/.local/bin/ccrc test -- ./node_modules/.bin/vitest run test/box-settings-read.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { mkTmp } from './tmpHelpers.js';
import { ccrcContainedEnv } from './ccrcContainment.js';
import { assertNoRealTool } from './containedTools.js';
import { ccrcSettingsNames } from './ccrcSettingsLine.js';
import {
  parseBoxSettings, boxSettingsView, boxSettingsGate, boxSettingsReadOf, SETTINGS_CAP, type BoxSettingsHeld,
} from '../src/update/boxSettings.js';
import { BoxSettingsLane } from '../src/update/boxSettingsLane.js';
import { FLEET_LABEL, SERVER_LABEL, type InventoryDeps, type SweepOutcome } from '../src/update/inventory.js';
import { NODE_FILES } from '../../shared/agent-protocol.js';
import { localIO, type FleetIO } from '../src/io.js';
import { buildServer, type Deps } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { Tmux, type Runner } from '../src/exec.js';
import { ccdRunner } from '../src/lifecycle.js';
import { KeyedQueue } from '../src/inject/queue.js';
import { Bus } from '../src/bus.js';
import { FleetWatcher } from '../src/watch.js';
import { openCoordDb } from '../src/coord/db.js';
import { COORD_SCHEMA_VERSION } from '../src/coord/schema.js';
import { CoordStore, type NodeRow } from '../src/coord/store.js';
import { seedRoster } from './helpers.js';
import {
  BOX_SETTINGS_CLOCK_AHEAD_S, BOX_SETTINGS_FAILURES, BOX_SETTINGS_KEYS, BOX_SETTINGS_READERS, BOX_SETTINGS_STALE_S, BOX_SETTINGS_TIMER_S,
  BOX_SETTING_SOURCES, BOX_SETTING_STATES, BOX_SETTINGS_V1_REFUSED_WHY, BOX_SETTINGS_V1_UNFIT_WHY, type BoxSettingsDoc, type UpdatesView,
} from '../../shared/api.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const CCRC = path.resolve(here, '..', '..', 'ccd', 'ccrc');
const CCRC_SRC = readFileSync(CCRC, 'utf8');
const FIX = join(here, 'fixtures', 'box-settings');
const BASH = spawnSync('bash', ['-c', 'command -v bash'], { encoding: 'utf8' }).stdout.trim();
const REAL = (name: string): string => spawnSync('bash', ['-c', `command -v ${name}`], { encoding: 'utf8' }).stdout.trim();
const NOW = 1_792_948_000;
const FLEET_ID = '0f0e0d0c-0b0a-4908-8706-050403020100';

// ── the verb, run for real in a fixture HOME ─────────────────────────────────────────────────────────────────────────────────

interface Scenario {
  name: string;
  env?: Record<string, string>;
  /** The box's ccrc.env, if it has one. */
  envFile?: string | Buffer;
  /** Make ~/ccrc-backups hold dirs (names), or be a file (`'file'`). */
  backups?: string[] | 'file';
  /** `df` fails when set. */
  dfFails?: boolean;
  reader?: 'timer';
}

const KEYS_NOT_SET = [...BOX_SETTINGS_KEYS, 'CCRC_EXPOSURE_FILE'];

/** The corpus: every `ok` fixture is the verb's own answer to one of these, byte for byte. */
const SCENARIOS: readonly Scenario[] = [
  { name: 'defaults' },
  { name: 'timer-reader', reader: 'timer' },
  { name: 'sources', env: { CCRC_BACKUP_KEEP: '5' }, envFile: 'CCRC_BACKUP_DATA_KEEP=4\nCCRC_VERSIONS_KEEP=\n' },
  { name: 'custom-base-url', env: { CCRC_RELEASE_BASE_URL: 'https://user:secret@releases.example.invalid/path?token=abc' } },
  { name: 'refused', env: { CCRC_BACKUP_KEEP: 'abc', CCRC_UPDATE_HEALTH_S: 'ninety', CCRC_UPDATE_DEADLINE_MS: '6e5', CCRC_MODELS_ADVANCE_BUDGET_S: '99999' } },
  { name: 'unmeasured-nul', envFile: Buffer.from('NOTE=x\u0000y\n', 'utf8') },
  { name: 'long-sentence', envFile: 'CCRC_BACKUP_KEEP="5\nCCRC_X=1"\n' },
  { name: 'with-backups', backups: ['20250101-000000', '20250102-000000', 'pre-x'] },
  { name: 'backups-and-disk-unmeasured', backups: 'file', dfFails: true },
];

function runVerb(s: Scenario): string {
  const home = mkTmp(`bsr-verb-${s.name}-`.slice(0, 40));
  mkdirSync(join(home, '.ccrc'), { recursive: true });
  mkdirSync(join(home, 'tmp'), { recursive: true });
  if (s.envFile !== undefined) writeFileSync(join(home, '.ccrc', 'ccrc.env'), s.envFile);
  if (s.backups === 'file') writeFileSync(join(home, 'ccrc-backups'), 'not a directory');
  else if (s.backups !== undefined) for (const d of s.backups) mkdirSync(join(home, 'ccrc-backups', d), { recursive: true });
  const bin = join(home, 'stubbin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'date'), `#!/bin/sh\nif [ "$1" = +%s ]; then echo ${NOW}; else exec ${REAL('date')} "$@"; fi\n`, { mode: 0o755 });
  writeFileSync(join(bin, 'df'), s.dfFails
    ? '#!/bin/sh\nexit 1\n'
    : '#!/bin/sh\nprintf "Filesystem 1024-blocks Used Available Capacity Mounted on\\n/dev/fixture 157286400 138412032 18874368 88%% /\\n"\n', { mode: 0o755 });
  writeFileSync(join(bin, 'du'), '#!/bin/sh\nprintf "12694000000\\t%s\\n" "$3"\n', { mode: 0o755 });
  const env = ccrcContainedEnv(home, process.env, { managers: true, curl: 'poison' });
  for (const k of KEYS_NOT_SET) delete env[k];
  env['TMPDIR'] = join(home, 'tmp');
  Object.assign(env, s.env ?? {});
  env['PATH'] = `${bin}:${env['PATH'] ?? ''}`;
  assertNoRealTool(env, home);
  const r = spawnSync(BASH, [CCRC, 'settings', '--json', ...(s.reader === 'timer' ? ['--from', 'timer'] : [])],
    { env, encoding: 'utf8', input: '', timeout: 60_000 });
  expect(r.status, `stderr: ${r.stderr}`).toBe(0);
  return r.stdout;
}

// ── the fixtures: each file name is `<verdict>--<what>.json`, the verdict `ok` or the failure word the parse gives ──────────────

const fixtureFiles = (): string[] => readdirSync(FIX).filter((f) => f.endsWith('.json')).sort();
const verdictOf = (file: string): string => file.slice(0, file.indexOf('--'));

describe('parseBoxSettings: the corpus, each file with its verdict', () => {
  it('the corpus is not empty and holds both verdicts', () => {
    const verdicts = new Set(fixtureFiles().map(verdictOf));
    expect([...verdicts].sort()).toEqual(['malformed', 'ok']);
    expect(fixtureFiles().filter((f) => verdictOf(f) === 'ok').length).toBeGreaterThanOrEqual(SCENARIOS.length);
    expect(fixtureFiles().filter((f) => verdictOf(f) === 'malformed').length).toBeGreaterThanOrEqual(15);
  });

  it('the frozen version-1 corpus parses to exactly what wave 1 held', () => {
    const frozen = fixtureFiles().filter((f) => f.startsWith('ok--v1-'));
    expect(frozen).toHaveLength(9);
    const out: Record<string, string> = {};
    for (const f of frozen) out[f] = JSON.stringify(parseBoxSettings(readFileSync(join(FIX, f), 'utf8')));
    // Rewritten in the commit of D-7911: the refused and long-sentence documents now parse to the server's sentences; every other document is as wave 1 held it.
    expect(out).toMatchInlineSnapshot(`
      {
        "ok--v1-backups-and-disk-unmeasured.json": "{"v":1,"at":1792948000,"reader":"shell","settings":[{"key":"CCRC_BACKUP_KEEP","state":"ok","value":"10","from":"default"},{"key":"CCRC_BACKUP_DATA_KEEP","state":"ok","value":"3","from":"default"},{"key":"CCRC_VERSIONS_KEEP","state":"ok","value":"3","from":"default"},{"key":"CCRC_UPDATE_HEALTH_S","state":"ok","value":"90","from":"default"},{"key":"CCRC_UPDATE_DEADLINE_MS","state":"ok","value":"900000","from":"default"},{"key":"CCRC_RELEASE_BASE_URL","state":"ok","value":"default","from":"default"},{"key":"CCRC_MODELS_ADVANCE_BUDGET_S","state":"ok","value":"250","from":"default"}],"deadline":{"plainMs":900000,"minMs":900000,"maxMs":900000},"backups":{"state":"unmeasured","why":"~/ccrc-backups is not a readable directory"},"disk":{"state":"unmeasured","why":"the filesystem holding the home directory could not be measured (df did not answer in time, or failed)"}}",
        "ok--v1-custom-base-url.json": "{"v":1,"at":1792948000,"reader":"shell","settings":[{"key":"CCRC_BACKUP_KEEP","state":"ok","value":"10","from":"default"},{"key":"CCRC_BACKUP_DATA_KEEP","state":"ok","value":"3","from":"default"},{"key":"CCRC_VERSIONS_KEEP","state":"ok","value":"3","from":"default"},{"key":"CCRC_UPDATE_HEALTH_S","state":"ok","value":"90","from":"default"},{"key":"CCRC_UPDATE_DEADLINE_MS","state":"ok","value":"900000","from":"default"},{"key":"CCRC_RELEASE_BASE_URL","state":"ok","value":"custom https://releases.example.invalid","from":"environment"},{"key":"CCRC_MODELS_ADVANCE_BUDGET_S","state":"ok","value":"250","from":"default"}],"deadline":{"plainMs":900000,"minMs":900000,"maxMs":900000},"backups":{"state":"ok","kept":0,"withData":0,"bytes":0},"disk":{"state":"ok","availBytes":19327352832,"sizeBytes":161061273600}}",
        "ok--v1-defaults.json": "{"v":1,"at":1792948000,"reader":"shell","settings":[{"key":"CCRC_BACKUP_KEEP","state":"ok","value":"10","from":"default"},{"key":"CCRC_BACKUP_DATA_KEEP","state":"ok","value":"3","from":"default"},{"key":"CCRC_VERSIONS_KEEP","state":"ok","value":"3","from":"default"},{"key":"CCRC_UPDATE_HEALTH_S","state":"ok","value":"90","from":"default"},{"key":"CCRC_UPDATE_DEADLINE_MS","state":"ok","value":"900000","from":"default"},{"key":"CCRC_RELEASE_BASE_URL","state":"ok","value":"default","from":"default"},{"key":"CCRC_MODELS_ADVANCE_BUDGET_S","state":"ok","value":"250","from":"default"}],"deadline":{"plainMs":900000,"minMs":900000,"maxMs":900000},"backups":{"state":"ok","kept":0,"withData":0,"bytes":0},"disk":{"state":"ok","availBytes":19327352832,"sizeBytes":161061273600}}",
        "ok--v1-long-sentence.json": "{"v":1,"at":1792948000,"reader":"shell","settings":[{"key":"CCRC_BACKUP_KEEP","state":"unmeasured","why":"CCRC_BACKUP_KEEP cannot be measured: ~/.ccrc/ccrc.env names CCRC_BACKUP_KEEP in a shape this reader does not decide (a space around '=', an export prefix, a backslash, a quote that is not one whole pair, a quote left open on an earlier l..."},{"key":"CCRC_BACKUP_DATA_KEEP","state":"ok","value":"3","from":"default"},{"key":"CCRC_VERSIONS_KEEP","state":"ok","value":"3","from":"default"},{"key":"CCRC_UPDATE_HEALTH_S","state":"ok","value":"90","from":"default"},{"key":"CCRC_UPDATE_DEADLINE_MS","state":"ok","value":"900000","from":"default"},{"key":"CCRC_RELEASE_BASE_URL","state":"ok","value":"default","from":"default"},{"key":"CCRC_MODELS_ADVANCE_BUDGET_S","state":"ok","value":"250","from":"default"}],"deadline":{"plainMs":900000,"minMs":900000,"maxMs":900000},"backups":{"state":"ok","kept":0,"withData":0,"bytes":0},"disk":{"state":"ok","availBytes":19327352832,"sizeBytes":161061273600}}",
        "ok--v1-refused.json": "{"v":1,"at":1792948000,"reader":"shell","settings":[{"key":"CCRC_BACKUP_KEEP","state":"refused","from":"environment","why":"refused by its check; this box's build words the refusal with the value, so it is not shown here until the box is updated"},{"key":"CCRC_BACKUP_DATA_KEEP","state":"ok","value":"3","from":"default"},{"key":"CCRC_VERSIONS_KEEP","state":"ok","value":"3","from":"default"},{"key":"CCRC_UPDATE_HEALTH_S","state":"refused","from":"environment","why":"refused by its check; this box's build words the refusal with the value, so it is not shown here until the box is updated"},{"key":"CCRC_UPDATE_DEADLINE_MS","state":"refused","from":"environment","why":"refused by its check; this box's build words the refusal with the value, so it is not shown here until the box is updated"},{"key":"CCRC_RELEASE_BASE_URL","state":"ok","value":"default","from":"default"},{"key":"CCRC_MODELS_ADVANCE_BUDGET_S","state":"refused","from":"environment","why":"refused by its check; this box's build words the refusal with the value, so it is not shown here until the box is updated"}],"deadline":{"plainMs":900000,"minMs":0,"maxMs":900000},"backups":{"state":"ok","kept":0,"withData":0,"bytes":0},"disk":{"state":"ok","availBytes":19327352832,"sizeBytes":161061273600}}",
        "ok--v1-sources.json": "{"v":1,"at":1792948000,"reader":"shell","settings":[{"key":"CCRC_BACKUP_KEEP","state":"ok","value":"5","from":"environment"},{"key":"CCRC_BACKUP_DATA_KEEP","state":"ok","value":"4","from":"file"},{"key":"CCRC_VERSIONS_KEEP","state":"ok","value":"3","from":"empty"},{"key":"CCRC_UPDATE_HEALTH_S","state":"ok","value":"90","from":"default"},{"key":"CCRC_UPDATE_DEADLINE_MS","state":"ok","value":"900000","from":"default"},{"key":"CCRC_RELEASE_BASE_URL","state":"ok","value":"default","from":"default"},{"key":"CCRC_MODELS_ADVANCE_BUDGET_S","state":"ok","value":"250","from":"default"}],"deadline":{"plainMs":900000,"minMs":900000,"maxMs":900000},"backups":{"state":"ok","kept":0,"withData":0,"bytes":0},"disk":{"state":"ok","availBytes":19327352832,"sizeBytes":161061273600}}",
        "ok--v1-timer-reader.json": "{"v":1,"at":1792948000,"reader":"timer","settings":[{"key":"CCRC_BACKUP_KEEP","state":"ok","value":"10","from":"default"},{"key":"CCRC_BACKUP_DATA_KEEP","state":"ok","value":"3","from":"default"},{"key":"CCRC_VERSIONS_KEEP","state":"ok","value":"3","from":"default"},{"key":"CCRC_UPDATE_HEALTH_S","state":"ok","value":"90","from":"default"},{"key":"CCRC_UPDATE_DEADLINE_MS","state":"ok","value":"900000","from":"default"},{"key":"CCRC_RELEASE_BASE_URL","state":"ok","value":"default","from":"default"},{"key":"CCRC_MODELS_ADVANCE_BUDGET_S","state":"ok","value":"250","from":"default"}],"deadline":{"plainMs":900000,"minMs":900000,"maxMs":900000},"backups":{"state":"ok","kept":0,"withData":0,"bytes":0},"disk":{"state":"ok","availBytes":19327352832,"sizeBytes":161061273600}}",
        "ok--v1-unmeasured-nul.json": "{"v":1,"at":1792948000,"reader":"shell","settings":[{"key":"CCRC_BACKUP_KEEP","state":"unmeasured","why":"CCRC_BACKUP_KEEP cannot be measured: ~/.ccrc/ccrc.env could not be scanned"},{"key":"CCRC_BACKUP_DATA_KEEP","state":"unmeasured","why":"CCRC_BACKUP_DATA_KEEP cannot be measured: ~/.ccrc/ccrc.env could not be scanned"},{"key":"CCRC_VERSIONS_KEEP","state":"unmeasured","why":"CCRC_VERSIONS_KEEP cannot be measured: ~/.ccrc/ccrc.env could not be scanned"},{"key":"CCRC_UPDATE_HEALTH_S","state":"unmeasured","why":"CCRC_UPDATE_HEALTH_S cannot be measured: ~/.ccrc/ccrc.env could not be scanned - using 90"},{"key":"CCRC_UPDATE_DEADLINE_MS","state":"unmeasured","why":"CCRC_UPDATE_DEADLINE_MS cannot be measured: ~/.ccrc/ccrc.env could not be scanned"},{"key":"CCRC_RELEASE_BASE_URL","state":"unmeasured","why":"CCRC_RELEASE_BASE_URL cannot be measured: ~/.ccrc/ccrc.env could not be scanned"},{"key":"CCRC_MODELS_ADVANCE_BUDGET_S","state":"unmeasured","why":"CCRC_MODELS_ADVANCE_BUDGET_S cannot be measured: ~/.ccrc/ccrc.env could not be scanned, so the advance step is off for this run"}],"deadline":{"plainMs":900000,"minMs":0,"maxMs":900000},"backups":{"state":"ok","kept":0,"withData":0,"bytes":0},"disk":{"state":"ok","availBytes":19327352832,"sizeBytes":161061273600}}",
        "ok--v1-with-backups.json": "{"v":1,"at":1792948000,"reader":"shell","settings":[{"key":"CCRC_BACKUP_KEEP","state":"ok","value":"10","from":"default"},{"key":"CCRC_BACKUP_DATA_KEEP","state":"ok","value":"3","from":"default"},{"key":"CCRC_VERSIONS_KEEP","state":"ok","value":"3","from":"default"},{"key":"CCRC_UPDATE_HEALTH_S","state":"ok","value":"90","from":"default"},{"key":"CCRC_UPDATE_DEADLINE_MS","state":"ok","value":"900000","from":"default"},{"key":"CCRC_RELEASE_BASE_URL","state":"ok","value":"default","from":"default"},{"key":"CCRC_MODELS_ADVANCE_BUDGET_S","state":"ok","value":"250","from":"default"}],"deadline":{"plainMs":900000,"minMs":900000,"maxMs":900000},"backups":{"state":"ok","kept":2,"withData":0,"bytes":12694000000},"disk":{"state":"ok","availBytes":19327352832,"sizeBytes":161061273600}}",
      }
    `);
  });

  it.each(fixtureFiles())('%s', (file) => {
    const doc = parseBoxSettings(readFileSync(join(FIX, file), 'utf8'));
    if (verdictOf(file) === 'ok') {
      expect(doc, file).not.toBeNull();
      expect(doc!.v).toBe(1);
      expect(doc!.settings.map((s) => s.key), 'the seven, once each, in order').toEqual([...BOX_SETTINGS_KEYS]);
    } else {
      expect(doc, file).toBeNull();
    }
  });

  // Linux only: the snapshot is written only on Linux (the timer is Linux's, spec D6), and the ok corpus is that writer's output. On
  // macOS `_ccrc_knob` reads ccrc.env by a different rule on purpose (launchd sources the whole file with bash, so one line that is
  // not a plain NAME=value makes the keys that job reads unmeasured, not only the key on that line), so the same scenario prints a
  // different, correct, document there.
  it.skipIf(process.platform === 'darwin')('a fixture a bash writer made is what the verb prints now: the corpus regenerates from the real verb (the deferred Task 1 row)', () => {
    const write = process.env['BOX_SETTINGS_FIXTURES'] === 'write';
    for (const s of SCENARIOS) {
      const file = join(FIX, `ok--${s.name}.json`);
      const out = runVerb(s);
      if (write) writeFileSync(file, out);
      expect(readFileSync(file, 'utf8'), `${s.name}: regenerate with BOX_SETTINGS_FIXTURES=write`).toBe(out);
    }
  });

  it('the live verb\'s own output parses, a long `why` included, and keeps what it said', () => {
    const out = runVerb({ name: 'live-long', envFile: 'CCRC_BACKUP_KEEP="5\nCCRC_X=1"\n' });
    const doc = parseBoxSettings(out);
    expect(doc).not.toBeNull();
    const row = doc!.settings.find((r) => r.key === 'CCRC_BACKUP_KEEP')!;
    expect(row.state).toBe('unmeasured');
    expect('why' in row && row.why.length, 'the sentence is long and kept whole').toBeGreaterThan(150);
    expect(doc!.settings.map((r) => r.key)).toEqual([...BOX_SETTINGS_KEYS]);
  });
});

describe('parseBoxSettings: forged and broken documents are null, whole', () => {
  const base = (): Record<string, unknown> => JSON.parse(readFileSync(join(FIX, 'ok--v1-refused.json'), 'utf8')) as Record<string, unknown>;
  const rows = (d: Record<string, unknown>): Record<string, unknown>[] => d['settings'] as Record<string, unknown>[];
  const cases: Record<string, (d: Record<string, unknown>) => unknown> = {
    'a missing key': (d) => { rows(d).pop(); },
    'a duplicated key': (d) => { rows(d)[1]!['key'] = rows(d)[0]!['key']; },
    'an unknown key': (d) => { rows(d)[2]!['key'] = 'CCRC_NOT_A_SETTING'; },
    'version 2 with the seven rows of version 1': (d) => { d['v'] = 2; },
    'an unknown row state': (d) => { rows(d)[0]!['state'] = 'maybe'; },
    'an unknown from': (d) => { rows(d)[0]!['from'] = 'cloud'; },
    'an unknown reader': (d) => { d['reader'] = 'cron'; },
    'a 513-character string': (d) => { rows(d)[0]!['why'] = 'x'.repeat(513); },
    'a non-ASCII byte': (d) => { rows(d)[0]!['why'] = 'café'; },
    'a control character': (d) => { rows(d)[0]!['why'] = 'a\u0007b'; },
    'a negative integer': (d) => { (d['deadline'] as Record<string, unknown>)['minMs'] = -1; },
    'an unsafe integer': (d) => { (d['deadline'] as Record<string, unknown>)['maxMs'] = 2 ** 53; },
    'a fractional integer': (d) => { (d['deadline'] as Record<string, unknown>)['plainMs'] = 1.5; },
    'a string where a number goes': (d) => { d['at'] = '1792948000'; },
    'a missing section': (d) => { delete d['disk']; },
    'an unknown top-level key': (d) => { d['extra'] = 1; },
    'a refused row with no why': (d) => { delete rows(d).find((r) => r['state'] === 'refused')!['why']; },
    'an ok row carrying a why': (d) => { rows(d)[1]!['why'] = 'unexpected'; },
    'settings that is not a list': (d) => { d['settings'] = {}; },
    'a state word on the backups section that is not its own': (d) => { d['backups'] = { state: 'refused', kept: 1, withData: 1, bytes: 1 }; },
  };
  it.each(Object.keys(cases))('%s', (name) => {
    const d = base();
    cases[name]!(d);
    expect(parseBoxSettings(JSON.stringify(d))).toBeNull();
    // The control: the same document before the forgery parses, so a null above is the forgery's.
    expect(parseBoxSettings(JSON.stringify(base()))).not.toBeNull();
  });

  it.each([['an empty file', ''], ['junk', 'not json {'], ['an array', '[]'], ['null', 'null'], ['a number', '7'], ['a truncated document', '{"v":1,"at":17']])(
    '%s', (_n, text) => { expect(parseBoxSettings(text)).toBeNull(); });

  it('a string of exactly 512 characters is kept, and one of 513 is not (the bound is the spec\'s)', () => {
    const d = base();
    rows(d)[0]!['why'] = 'x'.repeat(512);
    expect(parseBoxSettings(JSON.stringify(d))).not.toBeNull();
  });
});

// ── the vocabularies equal the writer's, as sets ─────────────────────────────────────────────────────────────────────────────

/** The body of `cmd_settings` in ccd/ccrc, from its `cmd_settings() {` line to the first `}` at column 0. */
function cmdSettingsBody(src: string): string {
  const i = src.indexOf('\ncmd_settings() {');
  if (i < 0) return '';
  const end = src.indexOf('\n}\n', i);
  return src.slice(i, end < 0 ? undefined : end);
}
/** The words `cmd_settings` assigns to the variables with this prefix (`s_ok=ok`, `f_env=environment`, `r_timer=timer`). */
const wordsOf = (body: string, prefix: 's' | 'f' | 'r'): string[] =>
  [...body.matchAll(new RegExp(`\\b${prefix}_[a-z]+=([a-z-]+)`, 'g'))].map((m) => m[1]!);
const sameSet = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && new Set(a).size === a.length && a.every((w) => b.includes(w)) && b.every((w) => a.includes(w));
/** The verb's own `BOX_SETTINGS_KEYS=(…)` line. */
const verbKeys = (src: string): string[] | null => {
  const m = /^BOX_SETTINGS_KEYS=\(([A-Z0-9_ ]+)\)$/m.exec(src);
  return m ? m[1]!.split(' ') : null;
};

describe('the vocabularies are held equal to the verb\'s, in both directions (D-6916, spec 2.2)', () => {
  const body = cmdSettingsBody(CCRC_SRC);

  it('the extractor finds the body, and a CONTROL: a planted extra or missing word is seen', () => {
    expect(body.length).toBeGreaterThan(500);
    expect(wordsOf(body, 's')).toHaveLength(3);
    expect(wordsOf(body, 'f')).toHaveLength(4);
    expect(wordsOf(body, 'r')).toHaveLength(2);
    const extra = body.replace('r_shell=shell', 'r_shell=shell r_cron=cron');
    expect(sameSet(wordsOf(extra, 'r'), BOX_SETTINGS_READERS), 'a planted extra reader went unseen').toBe(false);
    const missing = body.replace('f_empty=empty ', '');
    expect(sameSet(wordsOf(missing, 'f'), BOX_SETTING_SOURCES), 'a dropped source went unseen').toBe(false);
    expect(sameSet(wordsOf(body, 'r'), BOX_SETTINGS_READERS), 'the real body is equal, so the two lines above are the plant\'s').toBe(true);
  });

  it('the setting states cmd_settings emits are the state map, both ways', () => {
    expect(sameSet(wordsOf(body, 's'), BOX_SETTING_STATES)).toBe(true);
  });
  it('the sources (`from`) cmd_settings emits are the source map, both ways', () => {
    expect(sameSet(wordsOf(body, 'f'), BOX_SETTING_SOURCES)).toBe(true);
  });
  it('the readers cmd_settings emits are the reader map, both ways', () => {
    expect(sameSet(wordsOf(body, 'r'), BOX_SETTINGS_READERS)).toBe(true);
  });

  it('the seven keys: the verb\'s own literal, each once in CCRC_SETTINGS, and what the live verb lists (D-7861, not set-equality with all of them)', () => {
    expect(verbKeys(CCRC_SRC)).toEqual([...BOX_SETTINGS_KEYS]);
    const all = ccrcSettingsNames(CCRC_SRC);
    expect(all, 'ccd/ccrc has no CCRC_SETTINGS=(…) line').not.toBeNull();
    for (const k of BOX_SETTINGS_KEYS) expect(all!.filter((n) => n === k), `${k} appears once in CCRC_SETTINGS`).toHaveLength(1);
    const live = parseBoxSettings(readFileSync(join(FIX, 'ok--defaults.json'), 'utf8'));
    expect(live!.settings.map((s) => s.key)).toEqual([...BOX_SETTINGS_KEYS]);
    // The control: a verb whose literal lost a key reads unequal.
    const dropped = CCRC_SRC.replace('CCRC_MODELS_ADVANCE_BUDGET_S)\nBOX_SETTINGS_JSON', ')\nBOX_SETTINGS_JSON');
    expect(verbKeys(dropped)).not.toEqual([...BOX_SETTINGS_KEYS]);
  });

  it('the failure words are spelled once, as a map the lane and the view both draw from', () => {
    expect([...BOX_SETTINGS_FAILURES].sort()).toEqual(
      ['absent', 'caps-unmeasured', 'clock-ahead', 'malformed', 'not-supported', 'too-large', 'unmeasured', 'unreadable']);
  });

  it('the stale bound is three timer periods, and the clock-ahead bound is 5 minutes', () => {
    expect(BOX_SETTINGS_STALE_S).toBe(3 * BOX_SETTINGS_TIMER_S);
    expect(BOX_SETTINGS_STALE_S).toBe(900);
    expect(BOX_SETTINGS_CLOCK_AHEAD_S).toBe(300);
  });
});

// ── the view ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────

describe('boxSettingsView: age, stale and clock-ahead are judged at the request\'s clock', () => {
  const doc = parseBoxSettings(readFileSync(join(FIX, 'ok--v1-defaults.json'), 'utf8')) as BoxSettingsDoc;
  const held = (at: number): BoxSettingsHeld => ({ read: { state: 'ok', doc: { ...doc, at } } });

  it('a 10-minute-old read is not stale, a 16-minute-old one is', () => {
    expect(boxSettingsView(held(NOW - 600), NOW)).toMatchObject({ state: 'ok', ageS: 600, stale: false });
    expect(boxSettingsView(held(NOW - 960), NOW)).toMatchObject({ state: 'ok', ageS: 960, stale: true });
  });
  it('exactly 15 minutes is not yet stale; one second over is', () => {
    expect(boxSettingsView(held(NOW - 900), NOW)).toMatchObject({ stale: false });
    expect(boxSettingsView(held(NOW - 901), NOW)).toMatchObject({ stale: true });
  });
  it('an ok read held while the clock moves past 15 minutes serves stale: the lane stopping never freezes a fresh verdict', () => {
    const h = held(NOW);
    expect(boxSettingsView(h, NOW + 600)).toMatchObject({ state: 'ok', stale: false });
    expect(boxSettingsView(h, NOW + 960)).toMatchObject({ state: 'ok', stale: true });
  });
  it('an `at` an hour ahead is clock-ahead; one inside the 5-minute bound is ok with an age of 0', () => {
    expect(boxSettingsView(held(NOW + 3600), NOW)).toEqual({ state: 'clock-ahead' });
    expect(boxSettingsView(held(NOW + 300), NOW)).toMatchObject({ state: 'ok', ageS: 0, stale: false });
    expect(boxSettingsView(held(NOW + 301), NOW)).toEqual({ state: 'clock-ahead' });
  });
  it('a held failure is served as its word; a node never read is `unmeasured`, and a read that failed stays `unreadable` (D-7874)', () => {
    for (const state of BOX_SETTINGS_FAILURES.filter((w) => w !== 'clock-ahead')) {
      expect(boxSettingsView({ read: { state } }, NOW)).toEqual({ state });
    }
    expect(boxSettingsView(undefined, NOW)).toEqual({ state: 'unmeasured' });
    expect(boxSettingsView({ read: { state: 'unreadable' } }, NOW)).toEqual({ state: 'unreadable' });
    expect(boxSettingsView(undefined, NOW)).not.toEqual(boxSettingsView({ read: { state: 'unreadable' } }, NOW));
  });
});

// ── the gate and the mapping, as pure functions (A11, D-6916) ───────────────────────────────────────────────────────────────

describe('boxSettingsGate and boxSettingsReadOf: the lane\'s two judgements are policy', () => {
  it('the cap word is `settings`', () => {
    expect(SETTINGS_CAP).toBe('settings');
  });
  it('an unknown os is caps-unmeasured whatever the caps hold; measured caps without the word are not-supported; with it, no gate', () => {
    expect(boxSettingsGate({ os: 'unknown', caps: [] })).toBe('caps-unmeasured');
    expect(boxSettingsGate({ os: 'unknown', caps: ['settings'] })).toBe('caps-unmeasured');
    expect(boxSettingsGate({ os: 'linux', caps: ['verify'] })).toBe('not-supported');
    expect(boxSettingsGate({ os: 'darwin', caps: ['verify'] })).toBe('not-supported');
    expect(boxSettingsGate({ os: 'linux', caps: [] })).toBe('not-supported');
    expect(boxSettingsGate({ os: 'linux', caps: ['verify', 'settings'] })).toBeNull();
  });
  it('a failed file read is its own reason; content the parse rejects is malformed; a document is ok', () => {
    for (const reason of ['absent', 'unreadable', 'too-large'] as const) {
      expect(boxSettingsReadOf({ ok: false, reason })).toEqual({ state: reason });
    }
    expect(boxSettingsReadOf({ ok: true, content: 'not json {' })).toEqual({ state: 'malformed' });
    expect(boxSettingsReadOf({ ok: true, content: '{}' })).toEqual({ state: 'malformed' });
    expect(boxSettingsReadOf({ ok: true, content: okText() })).toEqual({ state: 'ok', doc: parseBoxSettings(okText()) });
  });
});

// ── the lane ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** A fixture ~/.ccrc with a caps file and, optionally, the settings record. */
function ccrcWith(prefix: string, o: { caps?: string[]; os?: 'linux' | 'darwin'; file?: string | Buffer | 'symlink' | 'big' } = {}): string {
  const dir = join(mkTmp(prefix), '.ccrc');
  mkdirSync(dir, { recursive: true });
  const f = join(dir, NODE_FILES.boxSettings);
  if (o.file === 'symlink') {
    writeFileSync(join(dir, 'elsewhere.json'), readFileSync(join(FIX, 'ok--v1-defaults.json')));
    symlinkSync(join(dir, 'elsewhere.json'), f);
  } else if (o.file === 'big') {
    writeFileSync(f, ' '.repeat(70 * 1024));
  } else if (o.file !== undefined) {
    writeFileSync(f, o.file);
  }
  return dir;
}

const nodeRow = (nodeId: string, os: NodeRow['os'], caps: string[]): Pick<NodeRow, 'nodeId' | 'os' | 'caps'> => ({ nodeId, os, caps });
const measuredOutcome = (label: string, nodeId: string): SweepOutcome => ({ label, result: 'measured', nodeId, lease: 'none', refused: false });
const deps = (ccrcDir: string, io: FleetIO = localIO): Pick<InventoryDeps, 'localIo' | 'ccrcDir' | 'fleet'> => ({ localIo: io, ccrcDir, fleet: null });
const okText = (): string => readFileSync(join(FIX, 'ok--v1-defaults.json'), 'utf8');

/** `io` that records every path it is asked about, and answers as the real local one does. */
function countingIO(): { io: FleetIO; paths: string[] } {
  const paths: string[] = [];
  const io: FleetIO = {
    ...localIO,
    lstatMeasured: (p) => { paths.push(p); return localIO.lstatMeasured(p); },
  };
  return { io, paths };
}

describe('the lane: what each node\'s read comes to', () => {
  it('a node whose measured caps lack `settings` reads not-supported, and no read is issued', async () => {
    const dir = ccrcWith('bsr-lane-ns-', { file: okText() });
    const { io, paths } = countingIO();
    const lane = new BoxSettingsLane();
    await lane.run(deps(dir, io), () => [nodeRow('n1', 'linux', ['verify'])], [measuredOutcome(SERVER_LABEL, 'n1')]);
    expect(lane.held().get('n1')).toEqual({ read: { state: 'not-supported' } });
    expect(paths).toEqual([]);
  });

  it('a node whose os is unknown reads caps-unmeasured (never not-supported), and no read is issued', async () => {
    const dir = ccrcWith('bsr-lane-cu-', { file: okText() });
    const { io, paths } = countingIO();
    const lane = new BoxSettingsLane();
    await lane.run(deps(dir, io), () => [nodeRow('n1', 'unknown', [])], [measuredOutcome(SERVER_LABEL, 'n1')]);
    expect(lane.held().get('n1')).toEqual({ read: { state: 'caps-unmeasured' } });
    expect(paths).toEqual([]);
  });

  it('a macOS node has no `settings` word and reads not-supported', async () => {
    const lane = new BoxSettingsLane();
    await lane.run(deps(ccrcWith('bsr-lane-mac-')), () => [nodeRow('n1', 'darwin', ['verify'])], [measuredOutcome(SERVER_LABEL, 'n1')]);
    expect(lane.held().get('n1')!.read).toEqual({ state: 'not-supported' });
  });

  const withCap = (id: string): Pick<NodeRow, 'nodeId' | 'os' | 'caps'> => nodeRow(id, 'linux', ['verify', 'settings']);
  const readOf = async (dir: string): Promise<BoxSettingsHeld | undefined> => {
    const lane = new BoxSettingsLane();
    await lane.run(deps(dir), () => [withCap('n1')], [measuredOutcome(SERVER_LABEL, 'n1')]);
    return lane.held().get('n1');
  };

  it('with the cap: no file reads absent', async () => {
    expect((await readOf(ccrcWith('bsr-lane-abs-')))!.read).toEqual({ state: 'absent' });
  });
  it('with the cap: a symlink reads unreadable', async () => {
    expect((await readOf(ccrcWith('bsr-lane-sym-', { file: 'symlink' })))!.read).toEqual({ state: 'unreadable' });
  });
  it('with the cap: 70 KiB reads too-large', async () => {
    expect((await readOf(ccrcWith('bsr-lane-big-', { file: 'big' })))!.read).toEqual({ state: 'too-large' });
  });
  it('with the cap: junk reads malformed', async () => {
    expect((await readOf(ccrcWith('bsr-lane-junk-', { file: 'not json {' })))!.read).toEqual({ state: 'malformed' });
  });
  it('with the cap: a valid document reads ok, and what the lane holds is the parsed document', async () => {
    const h = await readOf(ccrcWith('bsr-lane-ok-', { file: okText() }));
    expect(h!.read).toEqual({ state: 'ok', doc: parseBoxSettings(okText()) });
  });
  it.each(fixtureFiles())('every corpus file through the lane: %s', async (file) => {
    const h = await readOf(ccrcWith('bsr-lane-corpus-', { file: readFileSync(join(FIX, file)) }));
    expect(h!.read.state).toBe(verdictOf(file) === 'ok' ? 'ok' : 'malformed');
  });

  it('a node the sweep could not reach keeps its last read, which then shows as stale', async () => {
    const dir = ccrcWith('bsr-lane-keep-', { file: okText() });
    const lane = new BoxSettingsLane();
    await lane.run(deps(dir), () => [withCap('n1')], [measuredOutcome(SERVER_LABEL, 'n1')]);
    const first = lane.held().get('n1');
    expect(first!.read.state).toBe('ok');
    for (const outcome of [
      { label: SERVER_LABEL, result: 'unreachable', nodeId: 'n1' }, { label: SERVER_LABEL, result: 'refused', why: 'x' },
      { label: SERVER_LABEL, result: 'error', message: 'boom' },
    ] as SweepOutcome[]) {
      await lane.run(deps(ccrcWith('bsr-lane-gone-')), () => [withCap('n1')], [outcome]);
      expect(lane.held().get('n1'), `an outcome of ${outcome.result} leaves the held read as it was`).toEqual(first);
    }
    expect(boxSettingsView(lane.held().get('n1'), NOW + 1200)).toMatchObject({ state: 'ok', stale: true });
  });

  it('a run that reaches the node overwrites the read, and a rekeyed node\'s old id is gone after the next sweep', async () => {
    const dir = ccrcWith('bsr-lane-rekey-', { file: okText() });
    const lane = new BoxSettingsLane();
    const inv = { ...deps(dir), fleet: { io: localIO, state: {} as never } };
    await lane.run(inv, () => [withCap(FLEET_LABEL)], [measuredOutcome(FLEET_LABEL, FLEET_LABEL)]);
    expect([...lane.held().keys()]).toEqual([FLEET_LABEL]);
    // The sweep re-keyed the row: the label's id is no longer a live node, the uuid is.
    await lane.run(inv, () => [withCap(FLEET_ID)], [measuredOutcome(FLEET_LABEL, FLEET_ID)]);
    expect([...lane.held().keys()]).toEqual([FLEET_ID]);
    expect(lane.held().get(FLEET_ID)!.read.state).toBe('ok');
    // An id no longer in the node list is dropped even when no outcome reached it.
    await lane.run(inv, () => [], []);
    expect(lane.held().size).toBe(0);
  });

  it('a node-id collision is a reached node: it is read', async () => {
    const dir = ccrcWith('bsr-lane-coll-', { file: okText() });
    const lane = new BoxSettingsLane();
    const o: SweepOutcome = { label: FLEET_LABEL, result: 'node-id-collision', nodeId: FLEET_LABEL, lease: 'none', refused: false };
    await lane.run({ localIo: localIO, ccrcDir: dir, fleet: { io: localIO, state: {} as never } }, () => [withCap(FLEET_LABEL)], [o]);
    expect(lane.held().get(FLEET_LABEL)!.read.state).toBe('ok');
  });

  it('the fleet node is read through the fleet io, the server\'s through the local one', async () => {
    const dir = ccrcWith('bsr-lane-two-', { file: okText() });
    const server = countingIO();
    const fleet = countingIO();
    const lane = new BoxSettingsLane();
    await lane.run({ localIo: server.io, ccrcDir: dir, fleet: { io: fleet.io, state: {} as never } },
      () => [withCap('s1'), withCap('f1')], [measuredOutcome(SERVER_LABEL, 's1'), measuredOutcome(FLEET_LABEL, 'f1')]);
    expect(server.paths).toHaveLength(1);
    expect(fleet.paths).toHaveLength(1);
    expect(lane.held().get('s1')!.read.state).toBe('ok');
    expect(lane.held().get('f1')!.read.state).toBe('ok');
  });

  it('it never throws into the sweep: an io that throws keeps the last held read', async () => {
    const dir = ccrcWith('bsr-lane-throw-', { file: okText() });
    const lane = new BoxSettingsLane();
    await lane.run(deps(dir), () => [withCap('n1')], [measuredOutcome(SERVER_LABEL, 'n1')]);
    const first = lane.held().get('n1');
    const bad: FleetIO = { ...localIO, lstatMeasured: () => { throw new Error('boom'); } };
    await expect(lane.run(deps(dir, bad), () => [withCap('n1')], [measuredOutcome(SERVER_LABEL, 'n1')])).resolves.toBeUndefined();
    expect(lane.held().get('n1')).toEqual(first);
    const worse = { get ccrcDir(): string { throw new Error('boom'); } } as unknown as Pick<InventoryDeps, 'localIo' | 'ccrcDir' | 'fleet'>;
    await expect(lane.run(worse, () => [withCap('n1')], [measuredOutcome(SERVER_LABEL, 'n1')])).resolves.toBeUndefined();
    // A store that throws (a locked coord.db) is asked inside the guard too: it must not reach the sweep's caller.
    const locked = (): never => { throw new Error('database is locked'); };
    await expect(lane.run(deps(dir), locked, [measuredOutcome(SERVER_LABEL, 'n1')])).resolves.toBeUndefined();
    expect(lane.held().get('n1')).toEqual(first);
  });

  it('a FIRST read that throws stores unreadable, never nothing: the read was tried and failed (D-7874, review 1396 F12)', async () => {
    const dir = ccrcWith('bsr-lane-throw-first-', { file: okText() });
    const lane = new BoxSettingsLane();
    const bad: FleetIO = { ...localIO, lstatMeasured: () => { throw new Error('boom'); } };
    await expect(lane.run(deps(dir, bad), () => [withCap('n1')], [measuredOutcome(SERVER_LABEL, 'n1')])).resolves.toBeUndefined();
    expect(lane.held().get('n1')).toEqual({ read: { state: 'unreadable' } });
    expect(boxSettingsView(lane.held().get('n1'), 0).state, 'the view answers the tried read, not unmeasured').toBe('unreadable');
    // A later good read replaces it, and a throw after that keeps the good one (the fail-toward-keeping row above).
    await lane.run(deps(dir), () => [withCap('n1')], [measuredOutcome(SERVER_LABEL, 'n1')]);
    expect(lane.held().get('n1')!.read.state).toBe('ok');
    await lane.run(deps(dir, bad), () => [withCap('n1')], [measuredOutcome(SERVER_LABEL, 'n1')]);
    expect(lane.held().get('n1')!.read.state).toBe('ok');
  });

  it('asking what it holds issues no read: the read happens on a run, never between runs', async () => {
    const dir = ccrcWith('bsr-lane-between-', { file: okText() });
    const { io, paths } = countingIO();
    const lane = new BoxSettingsLane();
    await lane.run(deps(dir, io), () => [withCap('n1')], [measuredOutcome(SERVER_LABEL, 'n1')]);
    const after = paths.length;
    expect(after).toBeGreaterThan(0);
    for (let i = 0; i < 5; i += 1) lane.held();
    expect(paths.length).toBe(after);
  });

  it('two lanes never see each other\'s reads', async () => {
    const a = new BoxSettingsLane();
    const b = new BoxSettingsLane();
    await a.run(deps(ccrcWith('bsr-lane-a-', { file: okText() })), () => [withCap('n1')], [measuredOutcome(SERVER_LABEL, 'n1')]);
    expect(a.held().get('n1')!.read.state).toBe('ok');
    expect(b.held().size).toBe(0);
    await b.run(deps(ccrcWith('bsr-lane-b-')), () => [withCap('n1')], [measuredOutcome(SERVER_LABEL, 'n1')]);
    expect(b.held().get('n1')!.read.state).toBe('absent');
    expect(a.held().get('n1')!.read.state, 'b\'s run left a\'s read alone').toBe('ok');
  });
});

// ── FleetWatcher and the route ───────────────────────────────────────────────────────────────────────────────────────────────

const failingRunner: Runner = async () => ({ ran: true, code: 1, stdout: '', stderr: '' });
const opened: { app: FastifyInstance; coord: CoordStore }[] = [];
afterEach(async () => {
  for (const o of opened.splice(0)) { await o.app.close(); o.coord.db.close(); }
});

interface Box { app: FastifyInstance; coord: CoordStore; watcher: FleetWatcher | undefined; ccrcDir: string }
/** A local-mode server on a fixture HOME whose own ~/.ccrc holds `files`. `watcher: false` builds the server with no watcher. */
async function box(o: { watcher: boolean; files?: Record<string, string> }): Promise<Box> {
  const home = mkTmp('bsr-box-');
  seedRoster(home);
  const cfg = loadConfig({ CCRC_HOME: home });
  mkdirSync(cfg.ccrcDir, { recursive: true });
  for (const [name, text] of Object.entries(o.files ?? {})) writeFileSync(join(cfg.ccrcDir, name), text);
  const coord = new CoordStore(openCoordDb(join(cfg.ccrcDir, 'coord.db')));
  const d: Deps = {
    cfg, runCcd: ccdRunner(failingRunner, cfg), tmux: new Tmux(failingRunner), io: localIO,
    queue: new KeyedQueue(), mailToken: 'f'.repeat(64), coord,
  };
  const bus = new Bus();
  const watcher = o.watcher ? new FleetWatcher(d, bus, 10_000, join(cfg.ccrcDir, 'state-cache.json')) : undefined;
  const app = await buildServer(d, bus, watcher);
  await app.ready();
  opened.push({ app, coord });
  return { app, coord, watcher, ccrcDir: cfg.ccrcDir };
}
const CAPS_WITH = 'os linux\nverify\nsettings\n';
const docAt = (at: number): string => JSON.stringify({ ...(JSON.parse(okText()) as object), at });

describe('FleetWatcher holds the lane state and runs the read inside the inventory run', () => {
  it('inventoryNow reads the server node\'s file, and a file written after the run is read on the NEXT run only', async () => {
    const b = await box({ watcher: true, files: { 'ccrc-caps': CAPS_WITH } });
    const w = b.watcher!;
    expect(w.boxSettingsHeld().size, 'nothing is read before a run').toBe(0);
    const out = await w.inventoryNow();
    const id = out.find((o) => o.label === SERVER_LABEL && o.result === 'measured')!;
    expect(id).toBeDefined();
    expect([...w.boxSettingsHeld().values()].map((h) => h.read.state)).toEqual(['absent']);
    writeFileSync(join(b.ccrcDir, NODE_FILES.boxSettings), docAt(Math.floor(Date.now() / 1000)));
    expect([...w.boxSettingsHeld().values()].map((h) => h.read.state), 'between runs the held read does not move').toEqual(['absent']);
    await w.inventoryNow();
    expect([...w.boxSettingsHeld().values()].map((h) => h.read.state)).toEqual(['ok']);
  });

  it('a node without the cap word reads not-supported through the watcher too', async () => {
    const b = await box({ watcher: true, files: { 'ccrc-caps': 'os linux\nverify\n', [NODE_FILES.boxSettings]: okText() } });
    await b.watcher!.inventoryNow();
    expect([...b.watcher!.boxSettingsHeld().values()].map((h) => h.read.state)).toEqual(['not-supported']);
  });

  it('two servers in one process never see each other\'s reads', async () => {
    const a = await box({ watcher: true, files: { 'ccrc-caps': CAPS_WITH, [NODE_FILES.boxSettings]: docAt(Math.floor(Date.now() / 1000)) } });
    const c = await box({ watcher: true, files: { 'ccrc-caps': CAPS_WITH } });
    await a.watcher!.inventoryNow();
    await c.watcher!.inventoryNow();
    expect([...a.watcher!.boxSettingsHeld().values()].map((h) => h.read.state)).toEqual(['ok']);
    expect([...c.watcher!.boxSettingsHeld().values()].map((h) => h.read.state)).toEqual(['absent']);
  });
});

describe('GET /api/updates carries each node\'s settings from the watcher\'s held state', () => {
  it('a node with a fresh record serves ok with its age at the request\'s clock', async () => {
    const at = Math.floor(Date.now() / 1000) - 120;
    const b = await box({ watcher: true, files: { 'ccrc-caps': CAPS_WITH, [NODE_FILES.boxSettings]: docAt(at) } });
    const view = (await b.app.inject({ method: 'GET', url: '/api/updates' })).json() as UpdatesView;
    expect(view.nodes).toHaveLength(1);
    const s = view.nodes[0]!.settings!;
    expect(s.state).toBe('ok');
    if (s.state === 'ok') {
      expect(s.stale).toBe(false);
      expect(s.ageS).toBeGreaterThanOrEqual(120);
      expect(s.ageS).toBeLessThan(180);
      expect(s.doc.settings.map((r) => r.key)).toEqual([...BOX_SETTINGS_KEYS]);
    }
  });

  it('a record older than 15 minutes serves stale: true, and one an hour ahead serves clock-ahead', async () => {
    const old = await box({ watcher: true, files: { 'ccrc-caps': CAPS_WITH, [NODE_FILES.boxSettings]: docAt(Math.floor(Date.now() / 1000) - 960) } });
    const a = (await old.app.inject({ method: 'GET', url: '/api/updates' })).json() as UpdatesView;
    expect(a.nodes[0]!.settings).toMatchObject({ state: 'ok', stale: true });
    const ahead = await box({ watcher: true, files: { 'ccrc-caps': CAPS_WITH, [NODE_FILES.boxSettings]: docAt(Math.floor(Date.now() / 1000) + 3600) } });
    const c = (await ahead.app.inject({ method: 'GET', url: '/api/updates' })).json() as UpdatesView;
    expect(c.nodes[0]!.settings).toEqual({ state: 'clock-ahead' });
  });

  it('a node the watcher has not read yet reads `unmeasured` on the wire (D-7874), and the field is set on every node', async () => {
    const b = await box({ watcher: true, files: { 'ccrc-caps': CAPS_WITH } });
    // Plant a second live row the lane never reached.
    const id = '1f1e1d1c-1b1a-4918-9716-151413121110';
    const r = b.coord.upsertNodeMeasurement({
      nodeId: id, role: 'fleet', label: FLEET_LABEL, currentVersion: null, currentSha: null, currentRef: null, currentBuiltAt: null,
      currentDirty: null, stampRead: 'absent', installState: 'unknown', provenance: 'unknown', caps: [], agentOps: [],
      highestVersion: null, previousVersion: null, floorRead: 'unmeasured', previousRead: 'unmeasured', os: 'unknown',
      measuredAt: 1000, report: null,
    });
    expect(r.ok).toBe(true);
    const view = (await b.app.inject({ method: 'GET', url: '/api/updates' })).json() as UpdatesView;
    expect(view.nodes).toHaveLength(2);
    for (const n of view.nodes) expect(n.settings, n.label).toBeDefined();
    expect(view.nodes.find((n) => n.nodeId === id)!.settings).toEqual({ state: 'unmeasured' });
    expect(view.nodes.find((n) => n.label === SERVER_LABEL)!.settings).toEqual({ state: 'absent' });
  });

  it('with no watcher, no field is set on any node', async () => {
    const b = await box({ watcher: false, files: { 'ccrc-caps': CAPS_WITH, [NODE_FILES.boxSettings]: okText() } });
    b.coord.upsertNodeMeasurement({
      nodeId: SERVER_LABEL, role: 'both', label: SERVER_LABEL, currentVersion: null, currentSha: null, currentRef: null, currentBuiltAt: null,
      currentDirty: null, stampRead: 'absent', installState: 'unknown', provenance: 'unknown', caps: ['settings'], agentOps: null,
      highestVersion: null, previousVersion: null, floorRead: 'unmeasured', previousRead: 'unmeasured', os: 'linux',
      measuredAt: 1000, report: null,
    });
    const view = (await b.app.inject({ method: 'GET', url: '/api/updates' })).json() as UpdatesView;
    expect(view.nodes.length).toBeGreaterThan(0);
    for (const n of view.nodes) expect('settings' in n, n.label).toBe(false);
  });

  it('coord.db is unchanged: no pending migration, and no settings column on nodes', async () => {
    const b = await box({ watcher: true, files: { 'ccrc-caps': CAPS_WITH } });
    expect((b.coord.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(COORD_SCHEMA_VERSION);
    const cols = (b.coord.db.prepare('PRAGMA table_info(nodes)').all() as { name: string }[]).map((c) => c.name);
    expect(cols.filter((c) => /setting/i.test(c))).toEqual([]);
  });
});

describe('the node file name', () => {
  it('NODE_FILES.boxSettings is box-settings.json, the name the verb writes', () => {
    expect(NODE_FILES.boxSettings).toBe('box-settings.json');
    expect(CCRC_SRC).toContain('BOX_SETTINGS_JSON="$HOME/.ccrc/box-settings.json"');
  });
});

// ── version 1 is read as wave 1 wrote it, and rewritten where it would carry a value (D-7911, D-7912; review L4) ──────────────

const v1Text = (name: string): string => readFileSync(join(FIX, `ok--v1-${name}.json`), 'utf8');
type RowObj = Record<string, unknown>;
const v1Doc = (name: string): Record<string, unknown> => JSON.parse(v1Text(name)) as Record<string, unknown>;
const v1Rows = (d: Record<string, unknown>): RowObj[] => d['settings'] as RowObj[];
const rowOfKey = (d: Record<string, unknown>, key: string): RowObj => v1Rows(d).find((r) => r['key'] === key)!;
const RAW_REFUSED = ['abc', 'ninety', '6e5', '99999'];

describe('version 1: still exactly as strict in the file, rewritten on the way out', () => {
  it('characterization: a version-1 refused row with no value is still null (the file must carry value and why)', () => {
    const d = v1Doc('refused');
    delete rowOfKey(d, 'CCRC_BACKUP_KEEP')['value'];
    expect(parseBoxSettings(JSON.stringify(d))).toBeNull();
    expect(parseBoxSettings(v1Text('refused'))).not.toBeNull();
  });

  it('characterization: the ok and unmeasured rows of version 1 that fit are untouched', () => {
    for (const f of fixtureFiles().filter((n) => n.startsWith('ok--v1-'))) {
      const text = readFileSync(join(FIX, f), 'utf8');
      const doc = parseBoxSettings(text)!;
      const raw = (JSON.parse(text) as { settings: { key: string; state: string; why?: string }[] }).settings;
      // Excluded on both sides, by key: the parse cuts a long why, so a filter on its own output would not see it.
      const out = new Set(raw.filter((r) => r.state === 'refused' || (r.state === 'unmeasured' && r.why!.length > 240)).map((r) => r.key));
      expect(doc.settings.filter((r) => !out.has(r.key)), f).toEqual(raw.filter((r) => !out.has(r.key)));
    }
  });

  it('a version-1 refused row parses with no value and the server\'s own sentence', () => {
    const doc = parseBoxSettings(v1Text('refused'))!;
    const refused = doc.settings.filter((r) => r.state === 'refused');
    expect(refused).toHaveLength(4);
    for (const r of refused) {
      expect(r).toEqual({ key: r.key, state: 'refused', from: 'environment', why: BOX_SETTINGS_V1_REFUSED_WHY });
      expect('value' in r).toBe(false);
    }
  });

  it('no raw text of a version-1 refused row survives the parse', () => {
    const out = JSON.stringify(parseBoxSettings(v1Text('refused')));
    for (const raw of RAW_REFUSED) expect(out, raw).not.toContain(raw);
  });

  const unfit: [string, string][] = [
    ['CCRC_BACKUP_KEEP', 'zz-leak secret'], ['CCRC_BACKUP_KEEP', '/etc/x'], ['CCRC_BACKUP_KEEP', '1'.repeat(33)],
    ['CCRC_RELEASE_BASE_URL', 'custom https://u:p@h'], ['CCRC_RELEASE_BASE_URL', 'custom https://tok:secret'],
    ['CCRC_RELEASE_BASE_URL', 'custom https://h/r'], ['CCRC_RELEASE_BASE_URL', 'custom https://'],
  ];
  it.each(unfit)('a version-1 ok row outside the envelope is rewritten unmeasured: %s = %s', (key, value) => {
    const name = 'defaults';
    const d = v1Doc(name);
    rowOfKey(d, key)['value'] = value;
    const text = JSON.stringify(d);
    const doc = parseBoxSettings(text);
    expect(doc).not.toBeNull();
    expect(doc!.settings.find((r) => r.key === key)).toEqual({ key, state: 'unmeasured', why: BOX_SETTINGS_V1_UNFIT_WHY });
    const out = JSON.stringify(doc);
    for (const leak of ['zz-leak', 'secret', 'etc', 'u:p', 'tok']) expect(out, leak).not.toContain(leak);
    const base = parseBoxSettings(v1Text(name))!;
    expect(doc!.settings.filter((r) => r.key !== key)).toEqual(base.settings.filter((r) => r.key !== key));
  });

  it('a version-1 unmeasured why is bounded at 240 by a cut', () => {
    const raw = v1Doc('long-sentence');
    const long = rowOfKey(raw, 'CCRC_BACKUP_KEEP')['why'] as string;
    expect(long.length).toBeGreaterThan(240);
    const row = parseBoxSettings(v1Text('long-sentence'))!.settings.find((r) => r.key === 'CCRC_BACKUP_KEEP')!;
    expect(row.state).toBe('unmeasured');
    const why = (row as { why: string }).why;
    expect(why).toBe(`${long.slice(0, 237)}...`);
    expect(why.length).toBe(240);
  });

  it('the lane never holds a version-1 refused or unfit value', async () => {
    const lane = new BoxSettingsLane();
    const run = async (text: string): Promise<string> => {
      await lane.run(deps(ccrcWith('bsr-v1-lane-', { file: text })), () => [nodeRow('n1', 'linux', ['verify', 'settings'])], [measuredOutcome(SERVER_LABEL, 'n1')]);
      return JSON.stringify(lane.held().get('n1'));
    };
    const held = await run(v1Text('refused'));
    expect(held).toContain('"state":"ok"');
    for (const raw of RAW_REFUSED) expect(held, raw).not.toContain(raw);
    const d = v1Doc('defaults');
    rowOfKey(d, 'CCRC_BACKUP_KEEP')['value'] = 'zz-leak secret';
    const forged = await run(JSON.stringify(d));
    expect(forged).toContain('"state":"ok"');
    expect(forged).not.toContain('zz-leak');
  });

  it('GET /api/updates never serves a version-1 refused value', async () => {
    const b = await box({ watcher: true, files: { 'ccrc-caps': CAPS_WITH, [NODE_FILES.boxSettings]: JSON.stringify({ ...v1Doc('refused'), at: Math.floor(Date.now() / 1000) }) } });
    await b.watcher!.inventoryNow();
    const res = await b.app.inject({ method: 'GET', url: '/api/updates' });
    expect(res.body).toContain('"state":"refused"');
    for (const raw of RAW_REFUSED) expect(res.body, raw).not.toContain(raw);
    expect(res.body).not.toContain("='");
  });
});
