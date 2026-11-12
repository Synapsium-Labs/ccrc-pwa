// Landing order wave 5e: the landing line's entry has ONE writer. Keyed on symbols and call sites (`scan/symbols.ts`),
// never a literal source pin, so the store's growth ceiling is not touched. A later sub-wave that adds a writer of
// `landing_entries` adds it here by name.
// Wave 5f (task 1) adds ONE named exception: the live, genuine no-run creation INSERT in `writeLandingAuthority`'s apply
// step. `advanceLanding` stays the owner of pin, repin, ejection and the verified-pin witness; replay writes none of
// them; the journal-derived overlay (subjects, authority, cursor) has one SQL writer, the private
// `applyLandingRecord`; and one allocator (`nextId`, in `landingEntry.ts`) names every new entry id.
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import path from 'node:path';
import { identifierReferences, parseSource, type ImportEdge, type ParsedFile } from './scan/parse.js';
import { callsIn, inlinedSourceOf, parsedFile, sqlStatementsInFile, symbolOf, REPO_ROOT } from './scan/symbols.js';
import { walkSrc } from './rings/walkSrc.js';

const STORE = 'server/src/coord/store.ts';
const ROUTES = 'server/src/coord/routes.ts';
const WRITER = 'CoordStore.advanceLanding';
const ADVANCE_ACT = 'registerCoordRoutes.advanceAct';
const FILES = walkSrc({ roots: ['server/src'], min: 150 });
const inWriter = (q: { file: string; start: number }) => {
  const s = symbolOf(STORE, WRITER);
  return q.file.endsWith(STORE) && q.start >= s.start && q.start < s.end;
};
const AUTHORITY = 'CoordStore.writeLandingAuthority';
const REPLAY = 'CoordStore.replayLandingJournal';
const APPLY = 'CoordStore.applyLandingRecord';
const inSymbol = (name: string) => (q: { file: string; start: number }) => {
  const s = symbolOf(STORE, name);
  return q.file.endsWith(STORE) && q.start >= s.start && q.start < s.end;
};
/** Migration 39 (and any later one) is DDL and the overlay's one seed row, in `schema.ts` template text that the
 *  statement scanner splits into several rows: it is not a runtime writer. The scan leaves that ONE file out, and a
 *  test below pins what it may hold, so the exclusion is narrow and checked rather than a weakened writer query. */
const SCHEMA = 'server/src/coord/schema.ts';
const isSchema = (q: { file: string }) => q.file.endsWith(SCHEMA);
const writes = (re: RegExp) => FILES.flatMap((f) => sqlStatementsInFile(f))
  .filter((q) => !isSchema(q) && ['INSERT', 'UPDATE', 'REPLACE'].includes(q.verb) && re.test(q.source));
const allWrites = (tableRe: RegExp) => FILES.flatMap((f) => sqlStatementsInFile(f))
  .filter((q) => !isSchema(q) && ['INSERT', 'UPDATE', 'REPLACE', 'DELETE'].includes(q.verb) && tableRe.test(q.table ?? ''));

describe('the landing line has one writer (landing order wave 5e, D-7614)', () => {
  it('pinnedSha has one writer, advanceLanding, but for the genuine no-run creation INSERT (5f)', () => {
    expect(writes(/\bpinnedSha\b/i).length).toBeGreaterThanOrEqual(2);
    const outside = writes(/\bpinnedSha\b/i).filter((q) => !inWriter(q));
    expect(outside.map((q) => `${q.verb} ${q.table}`)).toEqual(['INSERT landing_entries']);
    expect(outside.every(inSymbol(AUTHORITY))).toBe(true);
  });

  it('ejections has one writer, advanceLanding', () => {
    expect(writes(/\bejections\b/i).length).toBeGreaterThanOrEqual(1);
    expect(writes(/\bejections\b/i).filter((q) => !inWriter(q)).map((q) => `${q.file}:${q.text}`)).toEqual([]);
  });

  it('every write of landing_entries is advanceLanding\'s, but for the narrow live no-run creation INSERT in writeLandingAuthority (5e, 5f)', () => {
    const all = allWrites(/^landing_entries$/);
    expect(all.length).toBeGreaterThanOrEqual(4);
    const outside = all.filter((q) => !inWriter(q));
    expect(outside.map((q) => `${q.verb}:${inSymbol(AUTHORITY)(q)}`)).toEqual(['INSERT:true']);
    // the exception creates a no-run projection only: a NULL runId, state 'pinned', and nothing else
    expect(outside[0]!.source.replace(/\s+/g, ' ')).toMatch(/VALUES \(\?, \?, \?, \?, \?, NULL, 'pinned', \?, \?\)/);
  });

  it('every write of landing_intents is an INSERT inside dispatchRun, the one writer (5g)', () => {
    const all = allWrites(/^landing_intents$/);
    expect(all.length).toBeGreaterThanOrEqual(1);
    expect(all.filter((q) => !inSymbol('CoordStore.dispatchRun')(q)).map((q) => `${q.verb} ${q.file}:${q.text}`)).toEqual([]);
    expect(all.map((q) => q.verb)).toEqual(['INSERT']);
  });

  it('quarantineKind has one writer, advanceLanding: the quarantine UPDATE marks it and the verified re-pin clears it (5f Task 3)', () => {
    const marks = writes(/\bquarantineKind\b/i);
    expect(marks.map((q) => q.verb), 'the quarantine UPDATE and the re-pin UPDATE').toEqual(['UPDATE', 'UPDATE']);
    expect(marks.filter((q) => !inWriter(q)).map((q) => `${q.file}:${q.text}`)).toEqual([]);
    const flat = marks.map((q) => q.source.replace(/\s+/g, ' '));
    expect(flat.filter((t) => /quarantineKind = 'stale-episode-head'/.test(t))).toHaveLength(1);
    expect(flat.filter((t) => /quarantineKind = NULL/.test(t))).toHaveLength(1);
    // the decision is made in the pure decider and acted on inside the one writer: nothing else calls it
    const calls = FILES.flatMap((f) => parsedFile(f).calls.filter((c) => c.name === 'decideLandingWrite').map((c) => ({ file: f, start: c.start })));
    expect(calls).toHaveLength(1);
    expect(calls.every(inWriter)).toBe(true);
  });

  it('advanceLanding owns pin, repin, ejection and quarantine on landing_entries and the one witness write; replay owns neither', () => {
    expect(allWrites(/^landing_entries$/).filter(inWriter).map((q) => q.verb).sort()).toEqual(['INSERT', 'UPDATE', 'UPDATE', 'UPDATE', 'UPDATE']);
    const witness = allWrites(/^landing_projection_witness$/);
    expect(witness.length).toBe(1);
    expect(witness.every(inWriter)).toBe(true);
    // replay: no landing_entries write, no witness write, and it never calls the creation or the witness writer
    const replaySql = FILES.flatMap((f) => sqlStatementsInFile(f)).filter((q) => !isSchema(q) && inSymbol(REPLAY)(q));
    expect(replaySql.filter((q) => ['INSERT', 'UPDATE', 'REPLACE', 'DELETE'].includes(q.verb) && /landing_(entries|projection_witness)/.test(q.source)).map((q) => q.text)).toEqual([]);
    const replayCalls = callsIn(symbolOf(STORE, REPLAY)).map((c) => c.name);
    expect(replayCalls).toContain('applyLandingRecord');
    expect(replayCalls).not.toContain('advanceLanding');
    expect(replayCalls).not.toContain('writeLandingAuthority');
    expect(replayCalls).not.toContain('appendThenApply');
  });

  it('the overlay has one SQL writer, the private applyLandingRecord, called only by writeLandingAuthority and replay', () => {
    const overlay = allWrites(/^landing_(subjects|authority|journal_cursor)$/);
    expect(overlay.map((q) => q.table).sort()).toEqual(['landing_authority', 'landing_journal_cursor', 'landing_subjects']);
    expect(overlay.filter((q) => !inSymbol(APPLY)(q)).map((q) => `${q.file}:${q.text}`)).toEqual([]);
    const callers = FILES.flatMap((f) => parsedFile(f).calls.filter((c) => c.name === 'applyLandingRecord').map((c) => ({ file: f, start: c.start })));
    expect(callers.length).toBe(2);
    expect(callers.filter((c) => !inSymbol(AUTHORITY)(c) && !inSymbol(REPLAY)(c))).toEqual([]);
  });

  it('migration DDL is not a runtime writer: schema.ts holds only DDL on the landing tables and the cursor\'s one seed', () => {
    const inSchema = FILES.flatMap((f) => sqlStatementsInFile(f)).filter((q) => isSchema(q) && /landing_/.test(q.source));
    expect(inSchema.length).toBeGreaterThan(0);
    const dml = inSchema.filter((q) => ['INSERT', 'UPDATE', 'REPLACE', 'DELETE'].includes(q.verb)).map((q) => `${q.verb} ${q.table}`);
    expect(dml.every((d) => d === 'INSERT landing_journal_cursor')).toBe(true);
  });

  it('one allocator: the entry id is the facts\' nextId, produced in landingEntry.ts and consumed by landingWrites.ts and the store', () => {
    const NAMES = new Set(['nextId']);
    // other contexts keep an unrelated `nextId` (the remote client's request counter): the question is the coordination one
    const holders = FILES.filter((f) => /\/coord\/[^/]+$/.test(f) && identifierReferences(parsedFile(f).text, f, NAMES).length > 0)
      .map((f) => path.basename(f)).sort();
    expect(holders).toEqual(['landingEntry.ts', 'landingWrites.ts', 'store.ts']);
    // and no second allocator under another name: every landing_entries INSERT binds its id first, from the reserved
    // id (advanceLanding) or the decided mutation's id (writeLandingAuthority), and no landing SQL takes a MAX itself
    const store = parsedFile('server/src/coord/store.ts').text;
    const inserts = [...store.matchAll(/INSERT INTO landing_entries \(([^)]*)\)[\s\S]*?\.run\(([^,]+),/g)];
    expect(inserts.length).toBe(2);
    for (const m of inserts) {
      expect(m[1]!.split(',')[0]!.trim()).toBe('id');
      expect(['reserved', 'mutation.id']).toContain(m[2]!.trim());
    }
    expect(store.match(/MAX\([^)]*\)[^'"`]*FROM landing_/g) ?? []).toEqual([]);
  });

  it("landingFactsInner reads its own project's rows whole and every other project's rows as id, project and pr only", () => {
    const inner = symbolOf(STORE, 'CoordStore.landingFactsInner');
    const reads = FILES.flatMap((f) => sqlStatementsInFile(f))
      .filter((q) => !isSchema(q) && q.verb === 'SELECT' && q.table === 'landing_entries' && q.file.endsWith(STORE) && q.start >= inner.start && q.start < inner.end);
    const flat = reads.map((q) => q.source.replace(/\s+/g, ' ').trim());
    expect(flat).toHaveLength(2);
    const own = flat.filter((x) => /WHERE project = \?/.test(x));
    const foreign = flat.filter((x) => /WHERE project <> \?/.test(x));
    expect(own).toHaveLength(1);
    expect(own[0]).toMatch(/SELECT id, project, pr, pinnedSha, /);
    expect(foreign).toHaveLength(1);
    expect(foreign[0]).toMatch(/SELECT id, project, pr FROM landing_entries WHERE project <> \?/);
  });

  it('the merging-at detail is built only inside advanceLanding', () => {
    const calls = FILES.flatMap((f) => parsedFile(f).calls.filter((c) => c.name === 'mergingAtDetail').map((c) => ({ file: f, start: c.start })));
    expect(calls.length).toBeGreaterThanOrEqual(1);
    expect(calls.filter((q) => !inWriter(q))).toEqual([]);
  });

  it('advanceAct reaches the store through advanceLanding only', () => {
    const names = callsIn(symbolOf(ROUTES, ADVANCE_ACT)).map((c) => c.name);
    expect(names).toContain('advanceLanding');
    expect(names).not.toContain('advance');
  });

  it('detail has two statements, both inside advanceLanding: the land UPDATE writes state and detail and nothing else, and the re-pin UPDATE clears it', () => {
    const marks = writes(/\bdetail\b/i).filter((q) => /^landing_entries$/.test(q.table ?? ''));
    expect(marks.map((q) => q.verb)).toEqual(['UPDATE', 'UPDATE']);
    expect(marks.filter((q) => !inWriter(q)).map((q) => `${q.file}:${q.text}`)).toEqual([]);
    const flat = marks.map((q) => q.source.replace(/\s+/g, ' '));
    expect(flat.filter((t) => /SET state = \?, detail = \? WHERE id = \?/.test(t))).toHaveLength(1);
    expect(flat.filter((t) => /\bdetail = NULL\b/.test(t))).toHaveLength(1);
  });

  it('advanceLanding is declared once', () => {
    expect(() => symbolOf(STORE, WRITER)).not.toThrow();
    const text = parsedFile(STORE).text;
    expect(text.match(/^\s*advanceLanding[<(]/gm) ?? []).toHaveLength(1);
  });

  it('decideLandingLand has one call, inside advanceLanding', () => {
    const calls = FILES.flatMap((f) => parsedFile(f).calls.filter((c) => c.name === 'decideLandingLand').map((c) => ({ file: f, start: c.start })));
    expect(calls).toHaveLength(1);
    expect(calls.every(inWriter)).toBe(true);
  });

  // Only code may satisfy the land-arm check: a comment is a request, a red suite is a mechanism.
  const stripComments = (t: string): string => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

  const CLOSE = 'server/src/coord/close.ts';
  const LANE = 'server/src/coord/landedLane.ts';
  const CLOSE_LAND = 'landOnClose';
  const LANE_PASS = 'landedPass';

  it('advanceLanding has three callers, each named by symbol: advanceAct, the close\'s landOnClose and the lane\'s landedPass; only advanceAct passes a run arm', () => {
    const calls = FILES.flatMap((f) => parsedFile(f).calls.filter((c) => c.name === 'advanceLanding')
      .map((c) => ({ file: f, start: c.start })));
    expect(calls).toHaveLength(3);
    const within = (file: string, name: string) => {
      const s = symbolOf(file, name);
      return calls.filter((c) => c.file.endsWith(file) && c.start >= s.start && c.start < s.end);
    };
    expect(within(ROUTES, ADVANCE_ACT), 'advanceAct').toHaveLength(1);
    expect(within(CLOSE, CLOSE_LAND), 'close.ts#landOnClose').toHaveLength(1);
    expect(within(LANE, LANE_PASS), 'landedLane.ts#landedPass').toHaveLength(1);
    const act = symbolOf(ROUTES, ADVANCE_ACT);
    const actText = stripComments(parsedFile(ROUTES).text.slice(within(ROUTES, ADVANCE_ACT)[0]!.start, act.end).slice(0, 400));
    expect(actText).not.toMatch(/kind: 'land'/);
    // the other two compose a land command: the lane spells it, the close takes it from the one builder
    const lane = symbolOf(LANE, LANE_PASS);
    expect(stripComments(parsedFile(LANE).text.slice(within(LANE, LANE_PASS)[0]!.start, within(LANE, LANE_PASS)[0]!.start + 400))).toMatch(/kind: 'land'/);
    expect(lane.end).toBeGreaterThan(lane.start);
    expect(stripComments(symbolOf(CLOSE, CLOSE_LAND).text)).toMatch(/closeLandingOf\(/);
  });

  it('advanceLanding decides the edge before it writes, in one tx', () => {
    const src = inlinedSourceOf(symbolOf(STORE, WRITER));
    const at = (n: string) => { const i = src.indexOf(n); expect(i, n).toBeGreaterThan(-1); return i; };
    expect(at('transitionsFor(')).toBeLessThan(at('this.advanceInner('));
    expect(at('this.advanceInner(')).toBeLessThan(at('INSERT INTO landing_entries'));
    expect(src.split('tx(this.db').length - 1).toBe(1);
  });
});

describe('CLAUDE.md names the landing line among what a lost coord.db loses (D-7620)', () => {
  const flat = (s: string): string => s.replace(/\s+/g, ' ');
  const passage = (name: string, text: string, from: string, to: string): string => {
    const a = text.indexOf(from);
    expect(a, `${name}: the opening anchor is gone`).toBeGreaterThan(-1);
    const b = text.indexOf(to, a + from.length);
    expect(b, `${name}: the closing anchor is gone`).toBeGreaterThan(a);
    return flat(text.slice(a, b));
  };

  const claude = (): string => readFileSync(path.join(REPO_ROOT, 'CLAUDE.md'), 'utf8');

  it('landing-journal-prose: the recovery exception is stated, and the loss list and collector prose still stand', () => {
    const exception = passage('the recovery exception', claude(), 'The landing line has an authority-recovery exception', 'The switch\'s `collect-lane-generation.log`');
    for (const phrase of [
      '`~/.ccrc/landing.log` restores no-run creation evidence, order edges, `fixesMain` and setter attribution before service starts',
      'Replay never fabricates a measured pin, landed state or current run association',
      'remain visible as unmeasured and hold their project\'s line',
      'identity conflicts hold every affected project without deleting or rekeying either identity',
      'Only a verified pin may supply an exact DB-only witness',
      'replay never mints it',
      'This cannot detect a wholly unjournalled change lost with a snapshot',
      'Invalid or unreadable history refuses startup; missing projections or binding mismatches alone do not',
      'fences every landing read and mutation until durable replay succeeds at a clean transaction boundary; an uncertain rollback requires restart',
      'quarantines its pin as unknown, not ejected; only a verified repin with readable retained data clears that quarantine',
    ]) expect(exception, phrase).toContain(phrase);
    const collector = passage('the collector sentence', claude(), 'The switch\'s `collect-lane-generation.log`', 'collector');
    expect(collector).toContain('is never copied into a snapshot or restored with one: leave it in place, so a database restored alone never re-arms the');
  });

  it('landing-journal-left-in-place: the prose says so, and no backup set, restore pair or snapshot capture names landing.log', () => {
    const exception = passage('the leave-in-place rule', claude(), 'Leave it in place when restoring coord.db', 'Replay never fabricates');
    expect(exception).toContain('no backup copies it or restores an older copy over it');
    const ccrc = readFileSync(path.join(REPO_ROOT, 'ccd/ccrc'), 'utf8');
    const a = ccrc.indexOf('\n_upd_backup_set() {');
    expect(a, '_upd_backup_set is gone').toBeGreaterThan(-1);
    const set = ccrc.slice(a, ccrc.indexOf('\n}\n', a));
    expect(set).toContain('_upd_backup_copy');
    expect(set).not.toContain('landing.log');
    // arm 3's pairs are the same list (one list, two readers), so a restore copies nothing the backup set does not hold
    const b = ccrc.indexOf('\n_upd_backup_pairs() {');
    expect(b, '_upd_backup_pairs is gone').toBeGreaterThan(-1);
    const pairs = ccrc.slice(b, ccrc.indexOf('\n}\n', b));
    expect(pairs).toContain('_upd_backup_set');
    expect(pairs).not.toContain('landing.log');
    for (const f of ['deploy/backup-coord.mjs', 'deploy/coordination-snapshot.mjs']) {
      expect(existsSync(path.join(REPO_ROOT, f)), `${f} is gone: a moved file must turn this red`).toBe(true);
      expect(readFileSync(path.join(REPO_ROOT, f), 'utf8'), f).not.toContain('landing.log');
    }
  });

  it('the coord.db bullet lists the landing line first', () => {
    const bullet = passage('the coord.db bullet', readFileSync(path.join(REPO_ROOT, 'CLAUDE.md'), 'utf8'),
      'what it adds on top', 'is gone without the snapshot');
    expect(bullet).toContain('what it adds on top — the landing line, mail, claims');
  });
});

describe('the server boots the landing journal once, in both fleet modes, before anything consumes it (5f)', () => {
  const INDEX = 'server/src/index.ts';
  const calls = (): ReturnType<typeof parsedFile>['calls'] => parsedFile(INDEX).calls;

  it('boot-replay-before-consumers: the store is replayed before the server, the watcher and every timer', () => {
    const replay = calls().filter((c) => c.name === 'replayLandingJournal');
    expect(replay).toHaveLength(1);
    const consumers = calls().filter((c) => c.name !== null && ['buildServer', 'listen', 'setInterval', 'setTimeout', 'start', 'FleetWatcher'].includes(c.name));
    expect(consumers.length).toBeGreaterThan(3);
    expect(consumers.filter((c) => c.start < replay[0]!.start).map((c) => `${c.line} ${c.name}`)).toEqual([]);
  });

  it('local-mode-has-store-journal and remote-mode-has-store-journal: ONE CoordStore, built above the mode branch, with the journal', () => {
    // `new` is not a call to the scan library, so the construction is read from the parsed text: one `new CoordStore(`, whose
    // option object carries the journal and the fail-stop callback, and the first test of the fleet mode comes after it.
    const text = parsedFile(INDEX).text;
    const made = [...text.matchAll(/new CoordStore\(/g)];
    expect(made).toHaveLength(1);
    const at = made[0]!.index!;
    const replayAt = calls().find((c) => c.name === 'replayLandingJournal')!.start;
    // the constructor's own argument list, by paren depth, so a journal named anywhere else before the replay cannot satisfy it
    let depth = 0; let end = at;
    for (let i = text.indexOf('(', at); i < text.length; i++) {
      if (text[i] === '(') depth++;
      else if (text[i] === ')' && --depth === 0) { end = i + 1; break; }
    }
    expect(end).toBeLessThan(replayAt);
    const construction = text.slice(at, end);
    expect(construction).toContain('landingJournal: createLandingJournal(');
    expect(construction).toContain('onUnusableConnection');
    expect(text.indexOf('cfg.fleetMode ===')).toBeGreaterThan(at);
  });
});

describe('landingEntry.ts is the pure L1 module its header says it is (no fs, no node:sqlite, no clock)', () => {
  // Keyed on the scan library (scan/parse.ts through scan/symbols.ts), never a literal source pin: the file is parsed, so a
  // comment that names what the header promises not to use cannot trip a check. KNOWN WIDTH: the parse is syntax only, so the
  // clock is read through `identifierReferences` (`new Date()` and `Date.now()` alike); a clock reached through an alias
  // bound from another module or a computed name is out of width. `coord-policy-rings` keeps the runtime path to node:sqlite.
  const FILE = 'server/src/coord/landingEntry.ts';
  const NODE_BUILTINS = new Set(builtinModules.map((m) => m.replace(/^node:/, '')));
  const isNodeBuiltin = (specifier: string): boolean =>
    specifier.startsWith('node:') || NODE_BUILTINS.has(specifier.split('/')[0]!);
  const bindsValue = (edge: ImportEdge): boolean => {
    if (edge.kind === 'type-query' || edge.typeOnly) return false;
    if (edge.names.length === 0) return true;
    return !edge.names.every((n) => (edge.typeNames ?? []).includes(n));
  };
  const valueSpecifiers = (p: ParsedFile): string[] => p.imports.filter(bindsValue).map((x) => x.specifier);
  const nodeBuiltinSpecifiers = (p: ParsedFile): string[] => p.imports.map((x) => x.specifier).filter(isNodeBuiltin);
  const CLOCK_AND_FS = new Set(['Date', 'performance', 'fs', 'require', 'readFileSync', 'writeFileSync', 'readFile', 'writeFile']);
  const clockAndFsReferences = (p: ParsedFile): string[] =>
    identifierReferences(p.text, p.path, CLOCK_AND_FS).map((x) => `${x.line} ${x.name}`);
  const probe = (src: string): ParsedFile => parseSource(src, 'probe.ts');

  it('the scan is over real code, not an empty string', () => {
    const p = parsedFile(FILE);
    const fns = p.symbols.filter((x) => x.kind === 'function' || x.kind === 'variable-function').map((x) => x.name);
    expect(fns).toContain('decideLandingWrite');
    expect(fns).toContain('landingEntryOfRow');
    expect(p.calls.length).toBeGreaterThan(5);
    expect(p.imports.length).toBeGreaterThan(0);
  });

  it('CONTROL: the scans see a builtin in either quote, a value import, a clock and an fs use', () => {
    expect(nodeBuiltinSpecifiers(probe('import { readFileSync } from "node:fs";'))).toEqual(['node:fs']);
    expect(nodeBuiltinSpecifiers(probe("import { DatabaseSync } from 'node:sqlite';"))).toEqual(['node:sqlite']);
    expect(nodeBuiltinSpecifiers(probe("import { join } from 'path';"))).toEqual(['path']);
    expect(nodeBuiltinSpecifiers(probe("import { x } from '../../../shared/landingLine.js';"))).toEqual([]);
    expect(valueSpecifiers(probe("import { a } from './store.js';\nimport type { B } from './db.js';"))).toEqual(['./store.js']);
    expect(clockAndFsReferences(probe('const t = Date.now();'))).toEqual(['1 Date']);
    expect(clockAndFsReferences(probe('const t = new Date(1);'))).toEqual(['1 Date']);
    expect(clockAndFsReferences(probe("const b = readFileSync('x');"))).toEqual(['1 readFileSync']);
    expect(clockAndFsReferences(probe('// Date.now() is not used\nconst t = 1;'))).toEqual([]);
  });

  it('reads no clock and no filesystem', () => {
    expect(clockAndFsReferences(parsedFile(FILE)), 'landingEntry.ts reads the clock or reaches for a filesystem').toEqual([]);
  });

  it('the 5f L1 siblings (the write decider and the journal parser) read no clock, no filesystem and import no node builtin', () => {
    for (const f of ['server/src/coord/landingWrites.ts', 'server/src/coord/landingJournalPolicy.ts']) {
      const p = parsedFile(f);
      expect(p.calls.length, `${f} parses to nothing`).toBeGreaterThan(0);
      expect(clockAndFsReferences(p), `${f} reads the clock or reaches for a filesystem`).toEqual([]);
      expect(nodeBuiltinSpecifiers(p), `${f} imports a node builtin`).toEqual([]);
    }
  });

  it('imports no node builtin, and values only from shared/ (L0)', () => {
    const p = parsedFile(FILE);
    expect(nodeBuiltinSpecifiers(p), 'landingEntry.ts imports a node builtin').toEqual([]);
    expect(valueSpecifiers(p)).toEqual(['../../../shared/landingLine.js']);
  });
});
