// Single-definition scanners, one area of the guard that used to be one file (see ./helpers.ts for the doctrine and the shared walkers).
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { sourceOfSymbol } from '../scan/symbols.js';
import { SWITCHES } from '../../../shared/switches.js';
import { ALL, ALL_MJS, BASH, HISTORY_DIR, HISTORY_MJS, ccrcRoot, codeLines, here, holdersOf, mjsUnder, prose, rel, stallCode, stallCodeText } from './helpers.js';


// D-5841 (D3, #755; plan docs/superpowers/plans/2026-10-17-coordinator-first-routing.md, Durability). APPENDED. The
// brief watch has ONE home: its two timers, its decider and the wave brief's subject are defined in
// `server/src/coord/briefwatch.ts` alone, and the subject is spelled on no other source code line, so `dispatchRun`'s
// brief and the pass that looks for it cannot drift apart. Code lines only (`stallCode`).
describe('the brief watch is defined once (D-5841)', () => {
  const holders = (re: RegExp): string[] =>
    ALL.filter((f) => rel(f).startsWith('server/src/') && re.test(stallCode(f))).map(rel).sort();
  const defines = (name: string): RegExp =>
    new RegExp(`\\bfunction\\s+${name}\\b|\\b(?:const|let|var)\\s+${name}\\s*=`);
  const HOME = 'server/src/coord/briefwatch.ts';

  it('CONTROL: the patterns see a definition and pass over comment lines', () => {
    expect(defines('briefStep').test('export function briefStep(b: B, now: number): BriefStep {')).toBe(true);
    expect(stallCodeText("// the subject is 'wave-brief'\nconst x = 1;")).not.toMatch(/'wave-brief'/);
  });

  it('the two timers are 5 and 10 minutes, defined in briefwatch.ts alone', () => {
    const src = stallCode(path.join(ccrcRoot, HOME));
    expect(src).toMatch(/export const BRIEF_RETRY_MS = 5 \* 60_000;/);
    expect(src).toMatch(/export const BRIEF_NOTICE_MS = 10 \* 60_000;/);
    for (const name of ['BRIEF_RETRY_MS', 'BRIEF_NOTICE_MS', 'BRIEF_RETRY_DETAIL', 'BRIEF_NOTICE_DETAIL',
      'WAVE_BRIEF_SUBJECT', 'briefStep', 'briefNotTakenSubject', 'briefNotTakenTag']) {
      expect(holders(defines(name)), name).toEqual([HOME]);
    }
  });

  it("the wave brief's subject is spelled on one source code line", () => {
    expect(holders(/['"]wave-brief['"]/)).toEqual([HOME]);
    expect(stallCode(path.join(ccrcRoot, 'server/src/coord/dispatch.ts'))).toMatch(/subject: WAVE_BRIEF_SUBJECT\b/);
  });
});


// D-5513 (plan docs/superpowers/plans/2026-10-18-accounts-connect.md, Task A10). APPENDED. The credential shapes have
// one home, `CREDENTIAL_MASKS` in `shared/api.ts`, beside the mask's two words; the egress mask has one home,
// `server/src/accounts/mask.ts`; and `redact.ts`'s approval-row redactor reads its generic `sk-` and JWT shapes from
// the registry rather than keeping a second copy that could drift from the egress mask's.
describe('the credential shapes and the egress mask each have one home (D-5513)', () => {
  const holders = (re: RegExp): string[] => ALL.filter((f) => re.test(stallCode(f))).map(rel).sort();
  const decl = (c: string): RegExp => new RegExp(`\\b(?:const|let|var|function|class)\\s+${c}\\b|\\btype\\s+${c}\\s*=|\\binterface\\s+${c}\\b`);
  it('CONTROL: the pattern sees a declaration and passes over a use', () => {
    expect(decl('CREDENTIAL_MASKS').test('export const CREDENTIAL_MASKS = [')).toBe(true);
    expect(decl('CREDENTIAL_MASKS').test("import { CREDENTIAL_MASKS } from '../../../shared/api.js';")).toBe(false);
  });
  it('the shapes and the mask words are declared once, in shared/api.ts', () => {
    for (const c of ['CREDENTIAL_MASKS', 'CredentialMask', 'CredentialMaskId', 'credentialMaskSource', 'SECRET_MASK',
      'SECRET_MASK_TOO_LARGE']) {
      expect(holders(decl(c)), c).toEqual(['shared/api.ts']);
    }
  });
  it('the mask lives in its one file', () => {
    for (const c of ['SecretMasker', 'DrawerMask', 'SHAPE_ONLY_MASKER', 'fingerprintOf', 'fingerprintGeneration', 'shapeMatchers',
      'fingerprintRow', 'fingerprintAnswerOf']) {   // the last two: D-5996
      expect(holders(decl(c)), c).toEqual(['server/src/accounts/mask.ts']);
    }
  });
  it("maskSecretAssigns's file and mask.ts read the shapes from CREDENTIAL_MASKS, and no other file spells one", () => {
    expect(holders(/\bcredentialMaskSource\('genericSk'\)/)).toEqual(['server/src/coord/redact.ts']);
    expect(holders(/\bcredentialMaskSource\('jwt'\)/)).toEqual(['server/src/coord/redact.ts']);
    expect(holders(/\bCREDENTIAL_MASKS\b/).filter((f) => f !== 'shared/api.ts')).toEqual(['server/src/accounts/mask.ts']);
    // A second copy of a shape's source: the Anthropic family's prefix, the generic rule, or the JWT header pair.
    expect(holders(/sk-ant-\[|sk-\[A-Za-z0-9_-\]\{8,\}|eyJ\[A-Za-z0-9_-\]\+\\\.eyJ/)).toEqual(['shared/api.ts']);
  });
});


// Named workspaces review fixes: vocabularies the PWA and the server both read are declared ONCE in `shared/` and the
// other side imports them. Each was spelled twice before (the rename words' `BAD_TITLE_REASONS`; the Linear failure
// arms as the server's `LINEAR_FAILURES` beside the PWA's `LOOKUP_NOTE` keys, and the preview's wire type as a loose
// interface), which is how an arm gets added on one side only.
describe('the named-workspace vocabularies have one home each', () => {
  const holders = (re: RegExp): string[] => ALL.filter((f) => re.test(stallCode(f))).map(rel).sort();
  const decl = (c: string): RegExp => new RegExp(`\\b(?:const|let|var|function|class)\\s+${c}\\b|\\btype\\s+${c}\\s*=|\\binterface\\s+${c}\\b`);
  it('CONTROL: the pattern sees a declaration and passes over a use', () => {
    expect(decl('LINEAR_FAILURES').test("export const LINEAR_FAILURES = [")).toBe(true);
    expect(decl('LINEAR_FAILURES').test("import { LINEAR_FAILURES } from '../../../shared/linear';")).toBe(false);
  });
  it('the Linear failure arms and the preview answer are declared once, in shared/linear.ts', () => {
    for (const c of ['LINEAR_FAILURES', 'LinearFailure', 'ResolveAnswer']) expect(holders(decl(c)), c).toEqual(['shared/linear.ts']);
  });
  it('the bad-title reasons are declared once, in shared/refusal.ts, and no source spells the three words as a list', () => {
    for (const c of ['BAD_TITLE_REASONS', 'BadTitleReason']) expect(holders(decl(c)), c).toEqual(['shared/refusal.ts']);
    expect(holders(/'blank'\s*,\s*'control-characters'\s*,\s*'too-long'/)).toEqual(['shared/refusal.ts']);
  });
  it('the workspace id `${project}-${slug}` is spelled once, by workspaceId in shared/slug.ts', () => {
    const spelled = /`[^`]*\$\{\s*(?:ctx\.)?project\s*\}-\$\{\s*(?:ctx\.|preview\.|plan\.ask\.)?slug\s*\}/;
    expect(spelled.test('`${project}-${slug}`'), 'CONTROL: the pattern sees the spelling').toBe(true);
    expect(spelled.test('`new workspace ${project}-${preview.slug} · branch`'), 'CONTROL: and the preview line').toBe(true);
    expect(holders(spelled).filter((f) => f !== 'shared/slug.ts')).toEqual([]);
    expect(holders(/\bexport const workspaceId\b/)).toEqual(['shared/slug.ts']);
  });
});


// PATH IDENTITY W2 (spec 2026-10-12 §3.4). APPENDED, for the reason the blocks above state: `session-hook.test.ts`'s
// citation audit cites this file by line. A `collect` `done`'s leaf words (`meas.leaf`) are ONE L0 table's keys in
// `shared/api.ts`, and the runtime list derives from it. A second hand copy (a reader in `childReclaimSweep.ts` that
// lists the two words itself, say) would drift from ccd's emit census, which reads the L0 list. KNOWN WIDTH: the two
// words as a pair (a table, a union or an array) are seen; either word alone is ordinary copy and is not scanned.
describe('path identity W2: the collect leaf words are spelled once, in shared/api.ts', () => {
  const PAIR = /\bremoved:\s*true\b[^}]*\babsent:\s*true\b|\babsent:\s*true\b[^}]*\bremoved:\s*true\b|['"]removed['"]\s*[,|]\s*['"]absent['"]|['"]absent['"]\s*[,|]\s*['"]removed['"]/;
  const api = (): string => readFileSync(path.join(ccrcRoot, 'shared/api.ts'), 'utf8');

  it('CONTROL: the pair pattern sees a table, a union and an array, either way round, and passes over two comparisons', () => {
    expect(PAIR.test('const T = { removed: true, absent: true };')).toBe(true);
    expect(PAIR.test("type W = 'absent' | 'removed';")).toBe(true);
    expect(PAIR.test("const W = ['removed', 'absent'];")).toBe(true);
    expect(PAIR.test("x.word === 'removed' || x.word === 'absent'")).toBe(false);
  });

  it('COLLECT_LEAF_END_WORDS derives from its table', () => {
    expect(api()).toMatch(/export const COLLECT_LEAF_END_WORDS[^=]*=\s*\n?\s*Object\.keys\(COLLECT_LEAF_END_TABLE\)/);
    expect(api(), 'a hand-written array').not.toMatch(/export const COLLECT_LEAF_END_WORDS[^=]*=\s*\[/);
  });

  it('the two words are spelled as a vocabulary in shared/api.ts alone', () => {
    const holders = ALL.filter((f) => PAIR.test(readFileSync(f, 'utf8'))).map(rel).sort();
    expect(holders).toEqual(['shared/api.ts']);
  });
});


// W2-1 Task 1 (W2-D33): the exports the deploy lane reads are each defined once. APPENDED after the last describe, for
// the reason the CCRC HISTORY block above states; no import line is added. ALL_MJS, HISTORY_DIR, stallCode and rel are
// that block's.
describe('ccrc history: the deploy lane exports are each defined once (W2-D33; W2-1 Task 1)', () => {
  const DEFINES = (name: string): RegExp => new RegExp(`^\\s*(?:export\\s+)?function\\s+${name}\\s*\\(`);
  const definers = (name: string): string[] =>
    ALL_MJS.filter((f) => stallCode(f).split('\n').some((l) => DEFINES(name).test(l))).map(rel).sort();
  /** The body of the function whose head line `head` matches: from that line to the first line that is exactly `}`. */
  const bodyOfFn = (src: string, head: RegExp): string => {
    const lines = src.split('\n');
    const at = lines.findIndex((l) => head.test(l));
    if (at < 0) return '';
    const end = lines.findIndex((l, i) => i > at && l === '}');
    return lines.slice(at, end + 1).join('\n');
  };
  const DERIVE = path.join(HISTORY_DIR, 'derive.mjs');
  const RECALL = path.join(HISTORY_DIR, 'recall.mjs');
  const BLOB_SQL = ["'SELECT z FROM blobs WHERE blob_id = ?'", "'SELECT raw_len FROM blobs WHERE blob_id = ?'"] as const;

  it('CONTROL: the definition pattern sees a declaration, exported or not, and never a call or an import', () => {
    expect(DEFINES('stampAtOrBefore').test('export function stampAtOrBefore(rows, index) {')).toBe(true);
    expect(DEFINES('stampAtOrBefore').test('function stampAtOrBefore(copy, uuid) {')).toBe(true);
    expect(DEFINES('stampAtOrBefore').test('    fileAtEofAfterBoundary: eofAfterBoundary({ eofMs: holding.eof_ms, boundaryTsMs: stampAtOrBefore(copy.rows, copy.index.get(b.uuid)) }),')).toBe(false);
    expect(DEFINES('stampAtOrBefore').test('  secretUnits, summaryParts, stampAtOrBefore,')).toBe(false);
    expect(bodyOfFn('x\nfunction f(a) {\n  return a;\n}\ny', /^function f\(/)).toBe('function f(a) {\n  return a;\n}');
    expect(bodyOfFn('x\n', /^function f\(/), 'an absent head reads as no body').toBe('');
  });

  it('stampAtOrBefore is defined in lib.mjs alone, and derive.mjs imports it from lib', () => {
    expect(definers('stampAtOrBefore')).toEqual(['ccd/history/lib.mjs']);
    const block = /^import \{\n([^}]*)\} from '\.\/lib\.mjs';$/m.exec(stallCode(DERIVE));
    expect(block, 'derive.mjs has no multi-line named import from ./lib.mjs').not.toBeNull();
    expect(block![1]!.split(',').map((s) => s.trim())).toContain('stampAtOrBefore');
  });

  it('each blob SELECT is spelled once in shipped code, inside blobReadStmts, and stmts takes both from it', () => {
    for (const sql of BLOB_SQL) {
      expect(ALL_MJS.filter((f) => stallCode(f).includes(sql)).map(rel), sql).toEqual(['ccd/history/derive.mjs']);
      expect(stallCode(DERIVE).split(sql).length - 1, `${sql}: spelled more than once in derive.mjs`).toBe(1);
    }
    const reads = bodyOfFn(stallCode(DERIVE), /^export function blobReadStmts\(db\) \{$/);
    for (const sql of BLOB_SQL) expect(reads, `${sql} is not in blobReadStmts`).toContain(sql);
    expect((reads.match(/\.prepare\(/g) ?? []).length, 'blobReadStmts prepares exactly the two blob reads').toBe(2);
    expect(bodyOfFn(stallCode(DERIVE), /^function stmts\(db\) \{$/)).toContain('...blobReadStmts(db),');
  });

  it('pickExpandBody is called once in shipped code, by expandEntryBody, and expandEntryText reads through expandEntryBody', () => {
    const calls = ALL_MJS.flatMap((f) => stallCode(f).split('\n')
      .filter((l) => /\bpickExpandBody\(/.test(l) && !DEFINES('pickExpandBody').test(l)).map(() => rel(f)));
    expect(calls).toEqual(['ccd/history/recall.mjs']);
    const src = stallCode(RECALL);
    expect(bodyOfFn(src, /^export function expandEntryBody\(rc, e\) \{$/)).toMatch(/\bpickExpandBody\(/);
    const text = bodyOfFn(src, /^function expandEntryText\(rc, e\) \{$/);
    expect(text, 'expandEntryText is gone or its signature moved').not.toBe('');
    expect(text).toContain('expandEntryBody(rc, e)');
    expect(text, 'expandEntryText decodes no blob of its own').not.toMatch(/\bexpandBlob\(|\bexpandParse\(/);
  });
});


// CCRC HISTORY W2-1 TASK 2 (W2-D17): isSyntheticModel is the one angle-bracket model test. APPENDED, for the reason
// the blocks above state: session-hook.test.ts's citation audit cites this file by line. O14's `declares` reads const,
// let and var only, so a function needs its own scan: lib.mjs declares it and no other .mjs under ccd/history, deploy
// or shared does, and the angle-bracket test it holds is spelled on one code line of that corpus, its own.
describe('ccrc history W2-1 Task 2: isSyntheticModel is declared once, in lib.mjs, and holds the one angle-bracket test (W2-D17)', () => {
  const CORPUS = [...new Set([...HISTORY_MJS, ...mjsUnder(path.join(ccrcRoot, 'deploy')), ...mjsUnder(path.join(ccrcRoot, 'shared'))])];
  const declaresFn = (name: string): RegExp =>
    new RegExp(`(?:^|[\\s;])(?:export\\s+)?(?:(?:async\\s+)?function\\*?\\s+${name}\\b|(?:const|let|var)\\s+${name}\\b)`);
  const ANGLE_TEST = /startsWith\(\s*['"`]<['"`]\s*\)|endsWith\(\s*['"`]>['"`]\s*\)/;

  it('CONTROL: the corpus holds lib.mjs and the gate, and the two patterns see what they look for and nothing else', () => {
    expect(CORPUS.map(rel)).toEqual(expect.arrayContaining(['ccd/history/lib.mjs', 'deploy/history-gate.mjs']));
    expect(declaresFn('isSyntheticModel').test('export function isSyntheticModel(model) {')).toBe(true);
    expect(declaresFn('isSyntheticModel').test('function isSyntheticModel(m) {')).toBe(true);
    expect(declaresFn('isSyntheticModel').test("const isSyntheticModel = (m) => m === '<x>';")).toBe(true);
    expect(declaresFn('isSyntheticModel').test('    if (isSyntheticModel(row[5])) continue;')).toBe(false);
    expect(declaresFn('isSyntheticModel').test("import { EXIT, isSyntheticModel } from '../ccd/history/lib.mjs';")).toBe(false);
    expect(ANGLE_TEST.test("  return typeof model === 'string' && model.startsWith('<') && model.endsWith('>');")).toBe(true);
    expect(ANGLE_TEST.test("  if (leadText(content).trimStart().startsWith('<local-command-stdout>')) return 'harness';")).toBe(false);
  });

  it('lib.mjs is the one file of the corpus that declares isSyntheticModel', () => {
    expect(CORPUS.filter((f) => stallCode(f).split('\n').some((l) => declaresFn('isSyntheticModel').test(l))).map(rel).sort())
      .toEqual(['ccd/history/lib.mjs']);
  });

  it('the angle-bracket model test is spelled on one code line of the corpus, the return of lib.mjs\'s isSyntheticModel', () => {
    const hits = CORPUS.flatMap((f) => stallCode(f).split('\n').filter((l) => ANGLE_TEST.test(l)).map((l) => `${rel(f)}: ${l.trim()}`));
    expect(hits).toEqual(["ccd/history/lib.mjs: return typeof model === 'string' && model.startsWith('<') && model.endsWith('>');"]);
  });
});


// W2-2a Task 1 (W2-D38): the as-of cut is defined once, in lib.mjs. APPENDED after the last describe, for the reason the
// CCRC HISTORY block above states; no import line is added. ALL_MJS, stallCode and rel are that block's.
describe('ccrc history: the as-of cut is defined once, in lib.mjs (W2-D38; W2-2a Task 1)', () => {
  const DEFINES = (name: string): RegExp => new RegExp(`^\\s*(?:export\\s+)?(?:function\\s+${name}\\s*\\(|(?:const|let|var)\\s+${name}\\s*=)`);
  const definers = (name: string): string[] =>
    ALL_MJS.filter((f) => stallCode(f).split('\n').some((l) => DEFINES(name).test(l))).map(rel).sort();

  it('CONTROL: the pattern sees a function or binding declaration, exported or not, and never a call', () => {
    expect(DEFINES('asOfCut').test('export function asOfCut({ asof, boundary, copy, kept }) {')).toBe(true);
    expect(DEFINES('asOfCut').test('const asOfCut = (i) => i;')).toBe(true);
    expect(DEFINES('asOfEntrySql').test('function asOfEntrySql(alias) {')).toBe(true);
    expect(DEFINES('asOfCut').test('  const c = asOfCut({ asof, boundary, copy, kept });')).toBe(false);
    expect(DEFINES('asOfBinds').test('  const b = xlib.asOfBinds(cut);')).toBe(false);
  });

  it('asOfCut, asOfEntrySql, asOfBinds and the node, epoch and entry statements are each defined in lib.mjs alone', () => {
    for (const name of ['asOfCut', 'asOfEntrySql', 'asOfBinds', 'asOfHiddenNodesSql', 'asOfVisibleEpochsSql', 'asOfVisibleEntriesSql', 'asOfSummaryPickSql']) expect(definers(name), name).toEqual(['ccd/history/lib.mjs']);
  });
});


// ── W2-2a Task 5 (W2-D39): the three seam names, read once each, by name, in cli.mjs alone ─────────────────────────
// APPENDED after the file's last describe, for the reason the blocks above state: session-hook.test.ts's citation audit
// cites this file by line. The allow-list describe holds every read to a name it lists. This one holds the three seam
// names to their exact holders (spec §10.1, "pinned in exact-holders form"), so a second read, a read in another
// module, a computed read, a bracketed read or a quoted name each go red here.
describe('ccrc history W2-2a Task 5: the three CCRC_RECALL_ seam names are each read once, by name, in cli.mjs alone (W2-D39)', () => {
  const SEAM_NAME = /(process\.env\.)?(CCRC_RECALL_[A-Za-z0-9_]*)/g;
  const seamUses = (code: string): string[] =>
    [...code.matchAll(SEAM_NAME)].map((m) => `${m[1] === undefined ? 'named' : 'read'} ${m[2]}`);

  it('CONTROL: the needle tells a dotted read from a bare, bracketed or quoted name, and sees no comment line', () => {
    expect(seamUses('const a = process.env.CCRC_RECALL_ASOF ?? null;')).toEqual(['read CCRC_RECALL_ASOF']);
    expect(seamUses("const k = 'CCRC_RECALL_ARM'; const v = process.env[k];")).toEqual(['named CCRC_RECALL_ARM']);
    expect(seamUses("const s = process.env['CCRC_RECALL_SESSION'];")).toEqual(['named CCRC_RECALL_SESSION']);
    expect(seamUses(stallCodeText('  // CCRC_RECALL_ASOF is read below\n * CCRC_RECALL_ARM\nconst x = 1;'))).toEqual([]);
  });

  it('cli.mjs reads CCRC_RECALL_SESSION, CCRC_RECALL_ARM and CCRC_RECALL_ASOF once each, dotted, and no other history module names one', () => {
    const uses = HISTORY_MJS.flatMap((f) => seamUses(stallCode(f)).map((u) => `${rel(f)}: ${u}`)).sort();
    expect(uses).toEqual([
      'ccd/history/cli.mjs: read CCRC_RECALL_ARM',
      'ccd/history/cli.mjs: read CCRC_RECALL_ASOF',
      'ccd/history/cli.mjs: read CCRC_RECALL_SESSION',
    ]);
  });
});


// CODEX BRIDGE STAGE 1, TASK 5: the auth library's three side-file names (its checkpoint, its status file and its lock)
// are module constants in ccd/ccgpt-auth.py, and bash and node ask its CLI (`paths`, `secret-files`, `status`) rather
// than spell them. APPENDED, for the reason the blocks above state: session-hook.test.ts's citation audit cites this
// file by line. Tests, docs and README.md are prose about the names and are left out; the credential's own name,
// `auth.json`, is not covered (it is spelled in today's bash, tests and README).
describe('codex bridge Stage 1 Task 5: the auth library owns its side-file names', () => {
  it('the auth library\'s side-file names are spelled only in ccd/ccgpt-auth.py', () => {
    const r = spawnSync('git', ['-C', ccrcRoot, 'grep', '-l', '-e', 'auth.pending.json', '-e', 'auth.status.json',
      '-e', 'auth.json.lock', '--', ':!server/test', ':!docs', ':!README.md'], { encoding: 'utf8' });
    // git grep answers 1 for "no match" and above 1 for a failure: neither is the answer this row expects, and a
    // failure must never read as an empty list.
    if (r.status !== 0 && r.status !== 1) throw new Error(`git grep exited ${String(r.status)}: ${(r.stderr || '').trim()}`);
    expect(r.stdout.split('\n').filter(Boolean).sort()).toEqual(['ccd/ccgpt-auth.py']);
  });
});


// W2-2b Task 1 (W2-D42, W2-D44; O13, O14): the marker's parser, formatter and fold are defined once, in lib.mjs; the arm
// words are quoted once in ccd/history, on RECALL_ARMS' line; and every ccd/history code line naming headless-on's path
// is historyPaths' own field or the marker's one read, store.mjs's readBounded at HEADLESS_LIST_MAX_BYTES with no link
// followed. APPENDED after the last describe, for the reason the CCRC HISTORY block above states; no import line is
// added. HISTORY_MJS, ALL_MJS, stallCode and rel are that block's. KNOWN WIDTH: a path held in a variable, or
// destructured, on one line and read on a later line is not seen, as O13's own scans say of theirs.
describe('ccrc history: the headless marker and the arm words are defined once, in lib.mjs, and read one way (W2-D42, W2-D44; W2-2b Task 1)', () => {
  const DEFINES = (name: string): RegExp => new RegExp(`^\\s*(?:export\\s+)?(?:function\\s+${name}\\s*\\(|(?:const|let|var)\\s+${name}\\s*=)`);
  const definers = (name: string): string[] =>
    ALL_MJS.filter((f) => stallCode(f).split('\n').some((l) => DEFINES(name).test(l))).map(rel).sort();
  /** An arm word in quotes of any kind. */
  const ARM_WORD = /(['"`])(?:control|treatment)\1/;
  /** A code line naming the marker's path, through a historyPaths(...) result or SWITCHES. */
  const NAMES_MARKER = /\.headlessOn\b/;
  /** historyPaths' own field: the one line that may name the path without reading it. */
  const PATHS_FIELD = 'headlessOn: `${h}/${SWITCHES.headlessOn}`,';
  /** The marker's one read (W2-D44): readBounded at the marker's bound, no link followed. */
  const ONE_READ = /\breadBounded\([^,]*\.headlessOn, (?:[A-Za-z_$][\w$]*\.)?HEADLESS_LIST_MAX_BYTES, false\)/;
  const allowed = (l: string): boolean => !NAMES_MARKER.test(l) || l.trim() === PATHS_FIELD || ONE_READ.test(l);

  it('CONTROL: the patterns see a definition and not a call, a quoted arm word and not a longer one, and the one read and nothing else', () => {
    expect(DEFINES('parseHeadlessList').test('export function parseHeadlessList(text) {')).toBe(true);
    expect(DEFINES('headlessMarkerOf').test('const headlessMarkerOf = (r) => r;')).toBe(true);
    expect(DEFINES('formatHeadlessList').test('  const t = formatHeadlessList({ storeId, pairs });')).toBe(false);
    expect(ARM_WORD.test("export const RECALL_ARMS = Object.freeze(['control', 'treatment']);")).toBe(true);
    expect(ARM_WORD.test('if (arm === "treatment") return 8;')).toBe(true);
    expect(ARM_WORD.test("const c = 'controls';")).toBe(false);
    expect(ARM_WORD.test('if (RECALL_ARMS.includes(arm)) return null;')).toBe(false);
    expect(allowed('  const m = headlessMarkerOf(readBounded(P.headlessOn, HEADLESS_LIST_MAX_BYTES, false));')).toBe(true);
    expect(allowed('  const m = healthStore.readBounded(historyPaths(home).headlessOn, healthLib.HEADLESS_LIST_MAX_BYTES, false);')).toBe(true);
    expect(allowed(`    ${PATHS_FIELD}`)).toBe(true);
    expect(allowed('  const m = readBounded(P.headlessOn, CONTROL_FILE_MAX, false);')).toBe(false);
    expect(allowed('  const m = readBounded(P.headlessOn, HEADLESS_LIST_MAX_BYTES, true);')).toBe(false);
    expect(allowed("  const t = readFileSync(historyPaths(home).headlessOn, 'utf8');")).toBe(false);
    expect(allowed('  const armed = existsSync(P.headlessOn);')).toBe(false);
    expect(allowed('  const p = P.headlessOn;')).toBe(false);
  });

  it('parseHeadlessList, formatHeadlessList and headlessMarkerOf are each defined in lib.mjs alone', () => {
    for (const name of ['parseHeadlessList', 'formatHeadlessList', 'headlessMarkerOf']) expect(definers(name), name).toEqual(['ccd/history/lib.mjs']);
  });

  it('the arm words are quoted once in ccd/history, on RECALL_ARMS\' line in lib.mjs (W2-D42)', () => {
    const hits = HISTORY_MJS.flatMap((f) => stallCode(f).split('\n').filter((l) => ARM_WORD.test(l)).map((l) => `${rel(f)}: ${l.trim()}`));
    expect(hits).toEqual(["ccd/history/lib.mjs: export const RECALL_ARMS = Object.freeze(['control', 'treatment']);"]);
  });

  it('every ccd/history code line naming headless-on\'s path is historyPaths\' field or the marker\'s one bounded read (W2-D44; O13)', () => {
    const named = HISTORY_MJS.flatMap((f) => stallCode(f).split('\n').filter((l) => NAMES_MARKER.test(l)).map((l) => `${rel(f)}: ${l.trim()}`));
    expect(named, 'CONTROL: historyPaths names it').toContain(`ccd/history/lib.mjs: ${PATHS_FIELD}`);
    expect(named.filter((x) => !allowed(x.slice(x.indexOf(': ') + 2)))).toEqual([]);
  });
});


// D-5867 (plan docs/superpowers/plans/2026-10-20-consolidation-w1b-schedule-listing-redactor.md, Task C1l, Step 4;
// ARCH-66 (#801); spec §5.1 rule 3). The redactor ratchet, appended after the capability ratchet so no cited line above
// it moves. The JS/TS modules that spell redaction rule patterns of their own (`consolidationCensus.ts`'s
// `redactRuleTables`, `shared/redact.mjs` counted) were three: `coord/redact.ts`, `shared/docs.ts` and
// `ccd/history/lib.mjs`. PR 1 moved the first two into `shared/redact.mjs`; PR 2 moves the third, and then the bound
// is one. The set may only shrink. The census is loaded inside the row, so this block adds no import line.
describe('one redaction rule table (ARCH-66): shared/redact.mjs (D-5867)', () => {
  it('at most two modules spell redaction rule patterns, and no TypeScript module is one', async () => {
    const { redactRuleTables } = await import('../consolidationCensus.js');
    const tables = redactRuleTables();
    expect(tables.length, `a new redaction rule table: ${tables.join(', ')}; add the rules to shared/redact.mjs`).toBeLessThanOrEqual(2);
    expect(tables.filter((f) => /\.tsx?$/.test(f)), 'a TypeScript redaction table').toEqual([]);
    expect(tables).toContain('shared/redact.mjs');
  });
});


describe('the tmp sweep\'s live-arm marker has no writer in the tree (fleet disk retention DR-8, D-6620)', () => {
  // `~/.ccrc/tmp-sweep-live-arm` arms the live arm's moves and its budget removals; without it the arm only records
  // what it would take. Like the stall watch's markers it is touched by hand and removed by hand, so nothing in the
  // tree may create it. Three halves: exactly one shell file names it on a code line (the sweep, which READS it);
  // in that file the name is assigned once and the variable is only ever tested with `-e`; and in TypeScript exactly
  // one file names it, shared/lifecycle.ts, which says so in a row's text and imports no node: module, so it cannot
  // write the marker.
  const NAME = 'tmp-sweep-live-arm';
  const SWEEP = path.join(ccrcRoot, 'ccd', 'ccd-tmp-sweep');

  it('CONTROL: the shell corpus was walked and the sweep is in it', () => {
    expect(BASH.map(rel)).toContain('ccd/ccd-tmp-sweep');
  });
  it('the sweep is the one shell file that names it', () => {
    expect(holdersOf(NAME)).toEqual(['ccd/ccd-tmp-sweep']);
  });
  it('in the sweep it is assigned once and only ever tested with -e', () => {
    const lines = codeLines(SWEEP);
    expect(lines.filter((l) => l.includes(NAME)).map((l) => l.trim())).toEqual(['LIVE_ARM="$HOME/.ccrc/tmp-sweep-live-arm"']);
    const uses = lines.filter((l) => /\bLIVE_ARM\b/.test(l) && !l.includes(NAME)).map((l) => l.trim());
    expect(uses.length, 'CONTROL: the sweep reads it').toBeGreaterThan(0);
    for (const u of uses) expect(u, 'a use of LIVE_ARM that is not a -e test could write it').toMatch(/\[ -e "\$LIVE_ARM" \]/);
  });
  it('in TypeScript only the lifecycle manifest names it, and that file reaches no node: module', () => {
    expect(ALL.filter((f) => stallCode(f).includes(NAME)).map(rel)).toEqual(['shared/lifecycle.ts']);
    expect(stallCode(path.join(ccrcRoot, 'shared/lifecycle.ts'))).not.toMatch(/from\s+['"]node:|import\s*\(\s*['"]node:|\brequire\s*\(/);
  });
});


// CODEX BRIDGE STAGE 2, TASK 1: the upstream error codes (the seven sets) are module constants in
// ccd/codexbridge/errors.py, and every other reader imports errors.ALL_CODES rather than spell one. APPENDED, for the
// reason the blocks above state: session-hook.test.ts's citation audit cites this file by line. The codes are read from
// the module itself, so this row holds no second copy of them. ccd/ccgpt-usage.py and ccd/ccgpt-auth.py are left out:
// they classify other endpoints.
describe('codex bridge Stage 2 Task 1: the bridge owns the upstream error codes', () => {
  it('the upstream error codes are spelled once, in codexbridge/errors.py', () => {
    const py = spawnSync('python3', ['-I', '-c', [
      'import sys', 'sys.dont_write_bytecode = True', 'sys.path.insert(0, sys.argv[1])',
      'from codexbridge import errors', 'print("\\n".join(sorted(errors.ALL_CODES)))',
    ].join('\n'), path.join(ccrcRoot, 'ccd')], { encoding: 'utf8' });
    expect(py.status, py.stderr).toBe(0);
    const codes = py.stdout.split('\n').filter(Boolean);
    expect(codes.length).toBeGreaterThanOrEqual(16);
    const r = spawnSync('git', ['-C', ccrcRoot, 'grep', '-l', '-w', ...codes.flatMap((c) => ['-e', c]), '--',
      'ccd', 'shared', 'deploy', 'server/src', ':!ccd/ccgpt-usage.py', ':!ccd/ccgpt-auth.py'], { encoding: 'utf8' });
    // git grep answers 1 for "no match" and above 1 for a failure: neither is the answer this row expects, and a
    // failure must never read as an empty list.
    if (r.status !== 0 && r.status !== 1) throw new Error(`git grep exited ${String(r.status)}: ${(r.stderr || '').trim()}`);
    expect(r.stdout.split('\n').filter(Boolean).sort()).toEqual(['ccd/codexbridge/errors.py']);
  });
});


// The ack guard's single spelling (D-6777). Placed at the END of the file so
// the line anchors other documents cite in this file do not move. It reads
// `server/src/coord/store.ts` ALONE, never itself, so its needles are whole.
describe('one ack guard', () => {
  it('spells the ack guard ONCE — ackableDeliverySql, never a second copy of its clauses (D-6777)', () => {
    const store = readFileSync(path.join(ccrcRoot, 'server/src/coord/store.ts'), 'utf8');
    const CLAUSE = "AND ${prefix}rejectCode = 'undeliverable' AND ${prefix}lastError = ?";
    const BUILDER = 'const ackableDeliverySql = ';
    const EXCEPTION = "rejectCode = 'undeliverable' AND";
    expect(store.split(CLAUSE).length - 1, 'the ack guard clause is not written exactly once').toBe(1);
    expect(store.split(BUILDER).length - 1, 'the builder is not defined once').toBe(1);
    expect(store.split(EXCEPTION).length - 1, 'a second spelling of the replay-ceiling exception').toBe(1);
  });
});


// FLEET DISK RETENTION DR-15 (D-6627; spec 2026-10-23 §2.4). APPENDED, for the reason the blocks above state:
// `session-hook.test.ts`'s citation audit cites this file by line. The collector's LOOSE arm SHIPS SHADOWED: a loose
// `~/.cc-tmp` entry is removed only while `$REG/collect-loose-live` stands AND the lane itself is effectively live. The
// file is the operator's to touch BY HAND, as `collect-lane-live` is, so no line of shell names it and its one
// TypeScript spelling is its switchboard row, an L0 file that reaches no `node:` module and so cannot write it.
describe('fleet disk retention DR-15: the collector’s loose-arm marker has no writer in the tree', () => {
  const NAME = 'collect-loose-live';
  const DEFINER = 'shared/switches.ts';
  const WRITE = /\b(?:writeFile|appendFile|rename|symlink|copyFile|mkdir|truncate|unlink|rm)(?:Sync)?\s*\(|\.write\w*\s*\(/;

  it('no shell line names it, and its one TS holder is its definer', () => {
    expect(holdersOf(NAME), 'a line of shell names it — a writer, or a reader this design never had').toEqual([]);
    expect(ALL.filter((f) => stallCode(f).includes(NAME)).map(rel).sort(), `spelled on a code line outside ${DEFINER}`)
      .toEqual([DEFINER]);
    expect(stallCode(path.join(ccrcRoot, DEFINER)), `${DEFINER} reaches a node: module or require — it could write the marker`)
      .not.toMatch(/from\s+['"]node:|import\s*\(\s*['"]node:|\brequire\s*\(/);
  });

  it('the files that name its constant are the definer and the executor, which reads it from the registry listing alone', () => {
    expect(WRITE.test('await deps.io.writeFile(`${dir}/${m}`, "");'), 'CONTROL: the pattern sees a write').toBe(true);
    const holders = ALL.filter((f) => stallCode(f).includes('COLLECT_LOOSE_LIVE_MARKER')).map(rel).sort();
    expect(holders).toEqual(['server/src/coord/collectTempRoot.ts', DEFINER]);
    for (const f of holders) expect(stallCode(path.join(ccrcRoot, f)), `${f} reaches a write`).not.toMatch(WRITE);
  });

  it('it is read in ONE place, nearest the argv: the job consults it after the lane’s own switch and before the loose verb', () => {
    // D-6114: keyed on the job's symbol (scan/symbols.ts), never a literal slice of the file.
    const job = stallCodeText(sourceOfSymbol(path.join(ccrcRoot, 'server/src/coord/collectTempRoot.ts'), 'collectTempRoot'));
    expect(job.match(/\blooseMarker\b/g)?.length, 'the job reads the final listing’s marker once').toBe(1);
    const at = (needle: string): number => job.split('\n').findIndex((l) => l.includes(needle));
    const [live, marker, verb] = [at('collectLaneLive(lane)'), at('looseMarker'), at('wsCollectLoose(')];
    expect([live, marker, verb].every((i) => i > -1), 'an anchor is gone').toBe(true);
    expect(live).toBeLessThan(marker);
    expect(marker).toBeLessThan(verb);
  });
});


// FLEET DISK RETENTION (D-6643, spec 2026-10-23 §2.7.5). APPENDED, for the reason the blocks above state. The stale-archive
// arm SHIPS SHADOWED: until `$REG/stale-archive-live` exists it records "would archive" and never composes `ws-archive`.
// The file is the operator's to touch BY HAND on the fleet box, as `expire-lane-live` is, so no line of shell names it
// and its one TS holder is its definer, an L1 file that reaches no `node:` module and so cannot write it.
describe('fleet disk retention: the stale-archive arm’s live switch has no writer in the tree', () => {
  const NAME = 'stale-archive-live';
  const DEFINER = 'shared/switches.ts';

  it('no shell line names it, and its one TS holder is its definer', () => {
    expect(holdersOf(NAME), 'a line of shell names it — a writer, or a reader this design never had').toEqual([]);
    expect(ALL.filter((f) => stallCode(f).includes(NAME)).map(rel).sort(), `spelled on a code line outside ${DEFINER}`)
      .toEqual([DEFINER]);
    expect(stallCode(path.join(ccrcRoot, DEFINER)), `${DEFINER} reaches a node: module or require — it could write the marker`)
      .not.toMatch(/from\s+['"]node:|import\s*\(\s*['"]node:|\brequire\s*\(/);
  });

  it('the files that name its constant are the definer, its re-exporter and the arm, and none reaches a write', () => {
    const WRITE = /\b(?:writeFile|appendFile|rename|symlink|copyFile|mkdir|truncate|unlink|rm)(?:Sync)?\s*\(|\.write\w*\s*\(/;
    expect(WRITE.test('await deps.io.writeFile(`${dir}/${m}`, "");'), 'CONTROL: the pattern sees a write').toBe(true);
    const holders = ALL.filter((f) => stallCode(f).includes('STALE_ARCHIVE_LIVE_MARKER')).map(rel).sort();
    expect(holders).toEqual(['server/src/archivedExpiry.ts', 'server/src/coord/staleArchive.ts', DEFINER]);
    for (const f of holders) expect(stallCode(path.join(ccrcRoot, f)), `${f} reaches a write`).not.toMatch(WRITE);
  });

  it('the arm’s verb is composed in one place: only the arm sends ws-archive its --if-no-pane flag', () => {
    const senders = ALL.filter((f) => /ifNoPane\s*:\s*true/.test(stallCode(f))).map(rel).sort();
    expect(senders).toEqual(['server/src/coord/staleArchive.ts']);
  });
});


// ARCH-77 (#812). APPENDED, for the reason the blocks above state. Child reclaim's own off switch is the operator's to touch
// BY HAND: its absence means armed, and no line of shell names it, so its one TypeScript spelling is its switchboard row, an L0
// file that reaches no `node:` module and so cannot write it. Its ONE reader is `coord/childReclaimDisabled.ts`, landed ahead
// of ARCH-44 by operator need; the other cleanup lanes never read it.
describe('ARCH-77: child reclaim’s off switch has no writer in the tree, and one reader', () => {
  const NAME = 'child-reclaim-disabled';
  const DEFINER = 'shared/switches.ts';
  const READER = 'server/src/coord/childReclaimDisabled.ts';

  it('no shell line names it, and its one TS holder is its definer', () => {
    expect(holdersOf(NAME), 'a line of shell names it — a writer, or a reader this design never had').toEqual([]);
    expect(ALL.filter((f) => stallCode(f).includes(NAME)).map(rel).sort(), `spelled on a code line outside ${DEFINER}`)
      .toEqual([DEFINER]);
    expect(stallCode(path.join(ccrcRoot, DEFINER)), `${DEFINER} reaches a node: module or require — it could write the marker`)
      .not.toMatch(/from\s+['"]node:|import\s*\(\s*['"]node:|\brequire\s*\(/);
  });

  it('the files that name its constant reach no write', () => {
    const WRITE = /\b(?:writeFile|appendFile|rename|symlink|copyFile|mkdir|truncate|unlink|rm)(?:Sync)?\s*\(|\.write\w*\s*\(/;
    expect(WRITE.test('await deps.io.writeFile(`${dir}/${m}`, "");'), 'CONTROL: the pattern sees a write').toBe(true);
    const holders = ALL.filter((f) => stallCode(f).includes('CHILD_RECLAIM_DISABLED_MARKER')).map(rel).sort();
    expect(holders).toEqual([READER, DEFINER].sort());
    for (const f of holders) expect(stallCode(path.join(ccrcRoot, f)), `${f} reaches a write`).not.toMatch(WRITE);
  });

  it('no other cleanup lane names it: expiry, collect, the dead-coordinator lane and stop-done are stopped by reclaim-paused alone', () => {
    const LANES = ['server/src/archivedExpiry.ts', 'server/src/stopDoneSweep.ts', 'server/src/deadCoordinator.ts',
      'server/src/coord/expireArchived.ts', 'server/src/coord/endDeadCoordinator.ts', 'server/src/coord/collectTempRoot.ts',
      'server/src/coord/collectOrphanTree.ts', 'server/src/coord/staleArchive.ts'];
    for (const f of LANES) {
      const code = stallCode(path.join(ccrcRoot, f));
      expect(code, `${f} names the child-reclaim switch`).not.toMatch(/CHILD_RECLAIM_DISABLED|childReclaimDisabled|child-reclaim-disabled/);
    }
  });
});

// CODEX BRIDGE STAGE 2, TASK 10 (spec D20): the bridge's three file names are spelled once, in `laneManifest`
// (`deploy/models-op.mjs`), copied into `lane.json` as `bridgeFiles` and read from there by bash and Python; and the
// roster's two new exec fields reach bash only through that rendered file, never through a second `jq` over the
// roster. APPENDED, for the reason the block above states (session-hook.test.ts's citation audit cites this file by
// line). The file-name scan reads QUOTED literals only, over shipped code: a docstring that names a file in backticks
// is prose, and the test tree's fixtures plant the names on purpose.
describe('codex bridge Stage 2 Task 10: the bridge file names and the lane mode have one source each', () => {
  const BRIDGE_FILE_NAMES = ['bridge.stats.json', 'reasoning.sqlite', 'recordings'] as const;
  const shipped = (): string[] => {
    const r = spawnSync('git', ['-C', ccrcRoot, 'ls-files', '--', 'ccd', 'shared', 'deploy', 'server/src',
      'agent/src', 'pwa/src'], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`git ls-files exited ${String(r.status)}: ${(r.stderr || '').trim()}`);
    return r.stdout.split('\n').filter(Boolean).filter((f) => existsSync(path.join(ccrcRoot, f)));
  };

  it('the bridge file names are spelled once, in laneManifest', () => {
    const files = shipped();
    expect(files, 'CONTROL: the corpus holds the writer').toContain('deploy/models-op.mjs');
    for (const name of BRIDGE_FILE_NAMES) {
      const escaped = name.replace(/[.*+?^$()|[\]\\{}]/g, (c) => `\\${c}`);
      const quoted = new RegExp(`['"]${escaped}['"]`);
      const holders = files.filter((f) => quoted.test(readFileSync(path.join(ccrcRoot, f), 'utf8'))).sort();
      expect(holders, name).toEqual(['deploy/models-op.mjs']);
    }
    // ...and inside that file, in laneManifest's own body, exactly once each.
    const src = readFileSync(path.join(ccrcRoot, 'deploy', 'models-op.mjs'), 'utf8');
    const start = src.indexOf('function laneManifest(');
    expect(start, 'laneManifest must be findable').toBeGreaterThan(-1);
    const body = src.slice(start, src.indexOf('\n}\n', start));
    for (const name of BRIDGE_FILE_NAMES) {
      const escaped = name.replace(/[.*+?^$()|[\]\\{}]/g, (c) => `\\${c}`);
      const quoted = new RegExp(`['"]${escaped}['"]`, 'g');
      expect((body.match(quoted) ?? []).length, `${name} in laneManifest`).toBe(1);
      expect((src.match(quoted) ?? []).length, `${name} in models-op.mjs`).toBe(1);
    }
  });

  it('no ccd file reads exec.bridge from the roster', () => {
    // A bare `.bridge` or `.upstream` is lane.json's (`_codex_lane_mode`, `_codex_lane_upstream`) and is not scanned.
    const ccd = shipped().filter((f) => f.startsWith('ccd/'));
    expect(ccd, 'CONTROL: the corpus holds ccd/ccrc').toContain('ccd/ccrc');
    const holders = ccd.filter((f) => /\bexec\.(bridge|upstream)\b/.test(readFileSync(path.join(ccrcRoot, f), 'utf8')));
    expect(holders).toEqual([]);
    // CONTROL: the one bash reader of the mode reads lane.json's key, so the scan above is not vacuously empty of
    // a reader.
    expect(readFileSync(path.join(ccrcRoot, 'ccd', 'ccrc'), 'utf8')).toMatch(/^_codex_lane_mode\(\)\s+\{/m);
  });
});
