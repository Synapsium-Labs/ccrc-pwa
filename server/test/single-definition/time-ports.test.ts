import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parsedFile, sqlStatementsInFile } from '../scan/symbols.js';
import { ambientUses, SQL_CLOCK } from '../scan/ambient.js';
import { parseSource, type ParsedFile } from '../scan/parse.js';
import { codeOnly, serverRing } from '../rings/ring.js';
import { REPO, walkSrc } from '../rings/walkSrc.js';

/** The NEW Overlord and continuity modules (spec §11.5). A new directory or file family joins by an edit here, in the
 *  pull request that creates it. Today's code is outside it and is not rewritten. */
const TIME_PORT_FAMILIES = new RegExp('^(?:server/src/(?:time|overlord|continuity|operatorModel)/'
  + '|server/src/(?:[\\w-]+/)*(?:overlord|continuity)[\\w-]*\\.ts$'
  + '|shared/(?:overlord|continuity)[\\w-]*\\.(?:ts|mjs)$)');
/** Single files of the programme that sit outside those families (the coordinator's ruling on run 1776: the W1a
 *  pieces that land later add their own files here, in their own pull request). The one list; nothing else names
 *  scoped files. */
const TIME_PORT_FILES: readonly string[] = [
  'server/src/coord/casesLane.ts',
  'server/src/coord/practiceCases.ts',
  'server/src/coord/practiceCasesStore.ts',
  'shared/practice-triggers.ts',
  'server/src/roleOf.ts',
  'shared/fleetRoles.ts',
];
const TIME_PORT_SCOPE = { test: (f: string): boolean => TIME_PORT_FAMILIES.test(f) || TIME_PORT_FILES.includes(f) };
/** The one file allowed to read the ambient sources: the system adapters. */
const THE_ADAPTER = 'server/src/time/system.ts';

describe('the time ports (Overlord spec §11.5, §3.6 H2): one definition, in the clock kernel', () => {
  it('ports.ts is types only, so L2 by its facts, not by its header', () => {
    expect(serverRing('server/src/time/ports.ts')).toEqual({ ring: 'L2', why: 'every top-level statement is a type' });
  });

  it('the two-clock shape is declared once: the lane runner takes Clock and declares no clock of its own', () => {
    const shape = /\binterface\s+\w+\s*\{[^}]*\bwall\(\)\s*:\s*number[^}]*\bmono\(\)\s*:\s*number/;
    const holders = walkSrc({ roots: ['server/src'], min: 150 })
      .filter((f) => shape.test(codeOnly(readFileSync(path.join(REPO, f), 'utf8'))));
    expect(holders).toEqual(['server/src/time/ports.ts']);
    const edge = parsedFile('server/src/laneRunner.ts').imports.find((e) => e.specifier === './time/ports.js');
    expect(edge?.names).toContain('Clock');
  });

  it('the Node timer ceiling is spelled once, in time/rules.ts', () => {
    const spelled = /\b2_?147_?483_?647\b/;
    const holders = walkSrc({ roots: ['server/src', 'shared'], min: 300 })
      .filter((f) => spelled.test(codeOnly(readFileSync(path.join(REPO, f), 'utf8'))));
    expect(holders).toEqual(['server/src/time/rules.ts']);
  });

  it('rules.ts is L1 by its facts: pure, with no import and no timer', () => {
    expect(serverRing('server/src/time/rules.ts').ring).toBe('L1');
  });

  it('system.ts is L3, and its chance comes from node:crypto alone', () => {
    expect(serverRing('server/src/time/system.ts').ring).toBe('L3');
    const p = parsedFile('server/src/time/system.ts');
    const crypto = p.imports.filter((e) => e.specifier === 'node:crypto').flatMap((e) => e.names);
    expect(crypto).toEqual(expect.arrayContaining(['randomBytes', 'randomUUID', 'randomInt']));
    expect(p.calls.map((c) => c.callee)).not.toContain('Math.random');
  });

  it('only the composition root takes the system adapters, and it builds them once', () => {
    const ADAPTER = 'server/src/time/system.ts';
    const target = (f: string, spec: string): string =>
      path.posix.join(path.posix.dirname(f), spec.replace(/\.js$/, '.ts'));
    const files = walkSrc({ roots: ['server/src'], min: 150 });
    expect(files.filter((f) => parsedFile(f).imports.some((e) => target(f, e.specifier) === ADAPTER)))
      .toEqual(['server/src/index.ts']);
    expect(parsedFile('server/src/index.ts').calls.filter((c) => c.callee === 'systemTimePorts')).toHaveLength(1);
    expect(files.filter((f) => parsedFile(f).imports.some((e) => /(^|\/)test\//.test(e.specifier)))).toEqual([]);
  });
});

describe('time and chance come through the ports in new Overlord and continuity code (spec §11.5)', () => {
  const RED: ReadonlyArray<readonly [string, string]> = [
    ['Date.now()', 'Date.now'], ['const f = Date.now;', 'Date.now'], ['new Date()', 'new Date()'], ['Date()', 'Date()'],
    ['performance.now()', 'performance'], ['process.hrtime.bigint()', 'process.hrtime'], ['process.uptime()', 'process.uptime'],
    ['setTimeout(f, 1)', 'setTimeout'], ['setInterval(f, 1)', 'setInterval'], ['Math.random()', 'Math.random'],
    ["import { randomUUID } from 'node:crypto';", 'randomUUID'], ['crypto.randomUUID()', 'randomUUID'],
    ['randomBytes(8)', 'randomBytes'], ['randomInt(8)', 'randomInt'], ['crypto.getRandomValues(a)', 'getRandomValues'],
    ["import { setTimeout as wait } from 'node:timers/promises';", 'setTimeout'],
    ["import { setTimeout as wait } from 'node:timers/promises';\nawait wait(5);", 'setTimeout'],
    ["import { scheduler } from 'node:timers/promises';", 'node:timers/promises'],
    ["import * as timers from 'node:timers';", 'node:timers'],
    ['await fetch(u, { signal: AbortSignal.timeout(5000) });', 'AbortSignal.timeout'],
    ['globalThis.process.hrtime()', 'process.hrtime'], ['process?.uptime()', 'process.uptime'],
    ['globalThis?.process?.hrtime.bigint()', 'process.hrtime'], ['globalThis.Math.random()', 'Math.random'],
    ['Math?.random()', 'Math.random'], ['globalThis.AbortSignal.timeout(5)', 'AbortSignal.timeout'],
    ['AbortSignal?.timeout(5)', 'AbortSignal.timeout'],
    ["import { hrtime } from 'node:process';", 'node:process'], ["import * as p from 'node:process';", 'node:process'],
    ["import proc from 'node:process';", 'node:process'],
    ['global.process.hrtime()', 'process.hrtime'], ['global.Math.random()', 'Math.random'],
    ['(process).hrtime()', 'process.hrtime'], ['(Math).random()', 'Math.random'], ['process!.hrtime()', 'process.hrtime'],
    ['(globalThis.AbortSignal)!.timeout(5)', 'AbortSignal.timeout'],
  ];
  const GREEN = ['new Date(ms).toISOString()', 'Date.parse(s)', 'Date.UTC(2026, 0, 1)', 'let d: Date | null = null;',
    'clock.wall()', 'scheduler.after(5, f)', 'entropy.uuid()', 'setImmediate(f)', 'if (x instanceof Date) f(x);',
    "import process from 'node:process';\nconst home = process.env.HOME;", "import type { hrtime } from 'node:process';",
    'const o = { random: 1, timeout: 2 }; o.random;',
    "import { timeout as t } from './x.js';\nt();", "import { random as pick } from './rng.js';\npick();",
    "import { uptime as up } from './sys.js';\nup();", "import { type hrtime } from 'node:process';",
    'const r = process.random();', 'foo.process.hrtime()', 'f(process).hrtime()'];

  it.each(RED)('CONTROL: %s is ambient (%s)', (code, what) => {
    expect(ambientUses('fixture.ts', code).map((u) => u.what)).toContain(what);
  });
  it.each(GREEN)('CONTROL: %s is not ambient', (code) => { expect(ambientUses('fixture.ts', code)).toEqual([]); });
  it('CONTROL: a call through an aliased timer import is reported by the name the import brings in', () => {
    expect(ambientUses('fixture.ts', "import { setTimeout as wait } from 'node:timers/promises';\nawait wait(5);")
      .filter((u) => u.line === 2)).toEqual([{ line: 2, what: 'setTimeout' }]);
  });

  it('CONTROL: the scope', () => {
    for (const f of ['server/src/time/rules.ts', 'server/src/overlord/doors.ts', 'server/src/continuity/lane.ts',
      'server/src/operatorModel/store.ts', 'server/src/coord/overlordActs.ts', 'shared/overlord.ts']) {
      expect(TIME_PORT_SCOPE.test(f), f).toBe(true);
    }
    for (const f of ['server/src/watch.ts', 'server/src/coord/store.ts', 'shared/api.ts']) expect(TIME_PORT_SCOPE.test(f), f).toBe(false);
  });

  it('every single file the scope names exists, so a rename cannot leave the scan reading nothing', () => {
    const tree = new Set(walkSrc({ roots: ['server/src', 'shared'], min: 300 }));
    expect(TIME_PORT_FILES.filter((f) => !tree.has(f))).toEqual([]);
  });

  it('no scoped file reads an ambient clock, timer or chance', () => {
    const files = walkSrc({ roots: ['server/src', 'shared'], min: 300 })
      .filter((f) => TIME_PORT_SCOPE.test(f) && f !== THE_ADAPTER);
    expect(files.length, 'the scope matched nothing: the walk is over the wrong tree').toBeGreaterThanOrEqual(2);
    const uses = files.flatMap((f) => ambientUses(f, readFileSync(path.join(REPO, f), 'utf8'))
      .map((u) => `${f}:${u.line} ${u.what}`));
    expect(uses).toEqual([]);
  });

  /** Ambient uses inside `CoordStore` methods named for the Overlord or continuity, as `<line> <what>`. */
  const storeMethodUses = (p: ParsedFile): string[] => {
    const spans = p.symbols.filter((s) => /^CoordStore\.\w*(?:overlord|continuity)/i.test(s.name));
    return ambientUses(p.path, p.text).filter((u) => spans.some((s) => s.line <= u.line && u.line <= s.endLine))
      .map((u) => `${u.line} ${u.what}`);
  };
  it('CONTROL: a CoordStore method named for the Overlord that reads Date.now is found; others are not', () => {
    const p = parseSource('class CoordStore {\n  overlordStamp(): number { return Date.now(); }\n'
      + '  other(): number { return Date.now(); }\n}\n', 'store.ts');
    expect(storeMethodUses(p)).toEqual(['2 Date.now']);
  });
  it('CoordStore\'s Overlord and continuity methods read no clock: they take the time as an argument', () => {
    expect(storeMethodUses(parsedFile('server/src/coord/store.ts'))).toEqual([]);
  });
});

describe('SQL never reads the clock or chance (spec §11.5)', () => {
  it.each(["UPDATE t SET at = CURRENT_TIMESTAMP WHERE id = ?", "SELECT strftime('%s','now') FROM t",
    'SELECT unixepoch() FROM t', 'SELECT id FROM t ORDER BY random()', 'INSERT INTO t (k) VALUES (randomblob(16))',
    'INSERT INTO t (at) VALUES (datetime())', "SELECT strftime('%s') FROM t", 'SELECT date() FROM t',
    'SELECT time( ) FROM t', 'SELECT julianday() FROM t', "SELECT unixepoch('subsec') FROM t",
    "SELECT datetime( 'subsecond' ) FROM t", "SELECT strftime('%s','subsec') FROM t",
    "SELECT datetime('subsec','localtime') FROM t", "SELECT unixepoch('subsec', '+1 day') FROM t",
    "SELECT strftime('%s','subsec','utc') FROM t", "SELECT date('subsec', 'start of month') FROM t",
    "SELECT unixepoch('subsec', ?) FROM t"])(
    'CONTROL: %s reads one', (sql) => expect(SQL_CLOCK.test(sql)).toBe(true));
  it.each(['UPDATE t SET at = ? WHERE id = ?', 'SELECT now_ms FROM t', 'SELECT datetime(at, \'unixepoch\') FROM t',
    "SELECT strftime('%s', at) FROM t", 'SELECT date(at) FROM t', "SELECT unixepoch(at, 'subsec') FROM t",
    "SELECT strftime('%s', at, 'subsec') FROM t", "SELECT unixepoch('+1 day','subsec') FROM t"])('CONTROL: %s reads none',
    (sql) => expect(SQL_CLOCK.test(sql)).toBe(false));
  it('no statement in server/src', () => {
    const hits = walkSrc({ roots: ['server/src'], min: 150 })
      .flatMap((f) => sqlStatementsInFile(f).filter((s) => SQL_CLOCK.test(s.text)).map((s) => `${f}:${s.line}`));
    expect(hits).toEqual([]);
  });
});
