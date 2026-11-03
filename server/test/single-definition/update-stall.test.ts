// Single-definition scanners, one area of the guard that used to be one file (see ./helpers.ts for the doctrine and the shared walkers).
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { ROUTE_WRITABLE_FIELDS, UPDATE_CHANNELS, UPDATE_STATES, UPDATE_PHASES, INSTALL_STATES, PROVENANCE_STATES, AUTO_MODES, NOTIFY_MODES, REQUEST_KINDS, STAMP_READS, NODE_OSES, TAG_FILE_READS, ARCHIVE_REFUSALS } from '../../../shared/api.js';
import { NODE_ROLES } from '../../../shared/node-role.js';
import { PROVIDER_IDS } from '../../../shared/providers.js';
import { ALL, BASH, REACH, ROOTS, ccrcRoot, here, holdersOf, prose, rel, sources, stallCode, stallCodeText } from './helpers.js';


// ROUTE_WRITABLE_FIELDS, routing spec 2026-09-14 §5.3 (slice 4, Task 3). The
// task brief's own docstring on the constant (`shared/api.ts`) claims
// "single-definition.test.ts scans for a hand-written sibling" — a claim
// that was FALSE from the commit that added it (fix round 1, finding #3):
// nothing in this file ever named `ROUTE_WRITABLE_FIELDS` or its five words
// until this describe. The idiom is `the provider table`'s above
// (:963-1027) — a declaration scan plus an array-literal scan, both over the
// same four ROOTS — applied to this list instead of `PROVIDER_IDS`.
describe('ROUTE_WRITABLE_FIELDS — one list, one home (routing spec §5.3, slice 4)', () => {
  // The positive control, same shape as `the name list this scans is real,
  // and is the roster` above: a scan for a field nothing spells passes
  // everything.
  const FIELDS = ROUTE_WRITABLE_FIELDS;

  it('the field list this scans is real, and is the routing record\'s own list', () => {
    expect(FIELDS.length).toBe(5);
    expect(FIELDS).toContain('class');
  });

  it('ROUTE_WRITABLE_FIELDS is declared in exactly one file under the four roots', () => {
    const RE = /^\s*(?:export\s+)?const\s+ROUTE_WRITABLE_FIELDS\b/m;
    const holders = ALL.filter((f) => RE.test(readFileSync(f, 'utf8'))).map(rel);
    expect(holders).toEqual(['shared/api.ts']);
  });

  // The fingerprint every historical copy in this file shares
  // (`enumeratesAsArray`, :859-865, and the provider table's own copy of it,
  // :998-1004): two or more of the five field names quoted inside the SAME
  // `[...]` array literal. `shared/api.ts`'s own definition trips this scan
  // too — it IS such a literal — so the assertion is "in exactly one file",
  // not "nowhere", exactly as the brief's Step 3 states it ("do not respell
  // them in a test either; import").
  //
  // ONE EXEMPTION, BY NAME, AND IT IS A DIFFERENT VOCABULARY — the same shape
  // as `PROBE_KINDS`'s exemption above (:989-1004). `server/src/commands.ts`'s
  // `BUILTINS` table (the PWA's slash-command picker, session-only keystrokes
  // per this slice's own constraints doc) lists `compact` and `effort` as
  // COMMAND NAMES a person can type, which is two of this list's five words —
  // measured, this trips the raw scan. It is not a restatement of the
  // routing record's writable-field vocabulary: `BUILTINS` names KEYSTROKES,
  // this list names RECORD FIELDS a body may set, and neither derives from
  // the other (`subagent`, `workflow` and `class` are not slash commands;
  // `model`, `clear`, `context`, `cost`, `resume` are not routable fields).
  // The exemption is the ARRAY LITERAL, not the file, in case a real second
  // copy of the routing list ever lands beside it.
  const EXEMPT_BUILTINS = /export const BUILTINS: SlashCommand\[\] = \[[\s\S]*?\n\];/;
  const scannable = (src: string): string => src.replace(EXEMPT_BUILTINS, '');
  const enumeratesAsArray = (src: string): boolean => {
    for (const m of src.matchAll(/\[[^\]]*\]/gs)) {
      const hits = FIELDS.filter((w) => new RegExp(`['"]${w}['"]`).test(m[0]));
      if (hits.length >= 2) return true;
    }
    return false;
  };

  it('the BUILTINS exemption is live — commands.ts trips the raw scan and not the exempted one', () => {
    // THE EXEMPTION IS CHECKED, not assumed (the provider table's own lesson,
    // :1017-1021): if `BUILTINS` is renamed, moved, or loses its two-word
    // overlap, this goes red rather than silently exempting a line that no
    // longer matches anything.
    const commands = readFileSync(path.join(ccrcRoot, 'server/src/commands.ts'), 'utf8');
    expect(enumeratesAsArray(commands),
      'BUILTINS no longer trips this scan — delete the exemption above it').toBe(true);
    expect(enumeratesAsArray(scannable(commands)),
      'server/src/commands.ts enumerates route fields somewhere OTHER than BUILTINS').toBe(false);
  });

  it('no source file under the four roots restates the five fields as an array literal, except shared/api.ts', () => {
    const holders = ALL.filter((f) => enumeratesAsArray(scannable(readFileSync(f, 'utf8')))).map(rel);
    expect(holders).toEqual(['shared/api.ts']);
  });
});


describe('the pane read is declared once, in L0', () => {
  // PANE_HISTORY_LINES is echoed back to the PWA in every history response and
  // will be read by stage 2's fit target (spec 2026-10-14 §6.2) beside
  // READER_MIN_COLS and STALL_BUDGET_LINES. A second copy is a second number
  // to keep in step.
  it('PANE_HISTORY_LINES is defined in shared/api.ts and nowhere else', () => {
    const holders = ALL.filter((f) => /^\s*export const PANE_HISTORY_LINES\b/m.test(readFileSync(f, 'utf8'))).map(rel);
    expect(holders).toEqual(['shared/api.ts']);
  });

  it('PaneProbe is declared in shared/api.ts and nowhere else', () => {
    const holders = ALL.filter((f) => /^\s*export type PaneProbe\b/m.test(readFileSync(f, 'utf8'))).map(rel);
    expect(holders).toEqual(['shared/api.ts']);
  });

  it('PaneHistoryReply is declared in shared/api.ts and nowhere else', () => {
    const holders = ALL.filter((f) => /^\s*export type PaneHistoryReply\b/m.test(readFileSync(f, 'utf8'))).map(rel);
    expect(holders).toEqual(['shared/api.ts']);
  });

  it('server.ts no longer spells the 2000 itself — it imports the name', () => {
    const src = readFileSync(path.join(ccrcRoot, 'server', 'src', 'server.ts'), 'utf8');
    expect(src, 'server.ts still defines its own PANE_HISTORY_LINES').not.toMatch(/const PANE_HISTORY_LINES\s*=/);
    expect(src, 'server.ts uses the constant without importing it').toMatch(/PANE_HISTORY_LINES/);
  });
});


// ── Design 2026-09-20 §6: the update control plane's vocabularies ──────────
// APPENDED, never inserted: `session-hook.test.ts`'s citation audit cites
// this file by line (its census carries a `server/test/single-definition.
// test.ts` entry), so an insert above a cited line moves the census.
describe('the update control plane — one definition per vocabulary and wire type (design 2026-09-20 §6)', () => {
  // The `RunState` shape (`Build 7 nouns`): one declaring file, and it is
  // shared/api.ts. A local, un-exported redeclaration counts too — it is the
  // same second copy with one fewer keyword.
  const TYPES = [
    'UpdateChannel', 'UpdateState', 'BusyUpdateState', 'SettledUpdateState', 'UpdatePhase', 'InstallState',
    'ProvenanceState', 'AutoMode', 'NotifyMode', 'RequestKind', 'StampRead', 'NodeOs', 'TagFileRead',
    'CatalogueErrorReason', 'ReleaseRefusalWire', 'ReleaseWire', 'NodeRequestWire', 'NodeReportWire',
    'NodeUpdateWire', 'NodeWire', 'UpdateIntentWire', 'CatalogueState', 'UpdatesView', 'UpdateRouteError',
    'UpdateRouteRefusal', 'IntentWriteAnswer', 'AckAnswer',
  ] as const;
  // NodeRole moved to shared/node-role.ts (a leaf module, re-exported from
  // api.ts) so server/src/config.ts does not pull in the ~10k-line api.ts at
  // runtime. Its single-definition assertion is separate, below.
  // The DECLARATION shape, not the bare keyword: `type <Name> [<…>] =` or
  // `interface <Name>`, `export`/`declare` optional. The bare `(?:type|
  // interface)\s+<Name>\b` form also matches an inline-type import specifier
  // that happens to open its line (`  type UpdateChannel,` inside a multi-line
  // `import { … }`), which is exactly how store.ts, update/inventory.ts and
  // update/routes.ts import these names in later tasks — every such file would
  // score as a second holder. `Build 7 nouns`' `export type RunState\b` avoids
  // it by requiring `export`; this scan keeps `export` optional (a local
  // un-exported copy is still a copy), so it requires the `=` instead.
  const DEF_OF = (name: string): RegExp =>
    new RegExp(`^\\s*(?:export\\s+)?(?:declare\\s+)?(?:type\\s+${name}\\b\\s*(?:<[^>\\n]*>)?\\s*=|interface\\s+${name}\\b)`, 'm');
  for (const name of TYPES) {
    it(`declares ${name} exactly once, in shared/api.ts`, () => {
      const DEF = DEF_OF(name);
      // Controls, per name, so a later loosening of DEF_OF reds every case:
      // an import specifier is not a declaration; an un-exported one is.
      expect(DEF.test(`import {\n  type ${name},\n} from '../../../shared/api.js';`), 'import specifier').toBe(false);
      expect(DEF.test(`type ${name} = 'a';`), 'un-exported local declaration').toBe(true);
      expect(ALL.filter((f) => DEF.test(readFileSync(f, 'utf8'))).map(rel)).toEqual(['shared/api.ts']);
    });
  }

  // NodeRole lives in shared/node-role.ts (re-exported from api.ts). Same
  // single-definition invariant, different file.
  it('declares NodeRole exactly once, in shared/node-role.ts', () => {
    const DEF = DEF_OF('NodeRole');
    expect(DEF.test(`import {\n  type NodeRole,\n} from '../../../shared/api.js';`), 'import specifier').toBe(false);
    expect(DEF.test(`type NodeRole = 'a';`), 'un-exported local declaration').toBe(true);
    expect(ALL.filter((f) => DEF.test(readFileSync(f, 'utf8'))).map(rel)).toEqual(['shared/node-role.ts']);
  });

  const VALUES = [
    'UPDATE_CHANNELS', 'UPDATE_STATES', 'BUSY_UPDATE_STATES', 'SETTLED_UPDATE_STATES', 'UPDATE_PHASES',
    'IN_FLIGHT_UPDATE_PHASES', 'INSTALL_STATES', 'PROVENANCE_STATES', 'AUTO_MODES', 'NOTIFY_MODES',
    'REQUEST_KINDS', 'STAMP_READS', 'NODE_OSES', 'TAG_FILE_READS', 'RELEASE_TAG', 'CAP_WORD', 'MAX_CAP_WORDS',
    'FLEET_SCOPE',   // ruling R4: shared/api.ts only — store.ts (Task 6) and resolve.ts/project.ts (Task 12) import it
    'UNIX_SECONDS_MAX',   // C5, final fix wave: resolve.ts and inventory.ts both import it; neither declares its own
  ] as const;
  const GUARDS = [
    'isUpdateChannel', 'isUpdateState', 'isUpdatePhase', 'isInstallState', 'isProvenanceState', 'isAutoMode',
    'isNotifyMode', 'isRequestKind', 'isStampRead', 'isNodeOs', 'isTagFileRead', 'isReleaseTag', 'validCapWords',
  ] as const;
  it('defines every array, pattern and guard exactly once, in shared/api.ts', () => {
    for (const name of VALUES) {
      const DEF = new RegExp(`^\\s*(?:export\\s+)?(?:const|let|var)\\s+${name}\\b`, 'm');
      expect(ALL.filter((f) => DEF.test(readFileSync(f, 'utf8'))).map(rel), name).toEqual(['shared/api.ts']);
    }
    for (const name of GUARDS) {
      const DEF = new RegExp(`^\\s*(?:export\\s+)?function\\s+${name}\\b`, 'm');
      expect(ALL.filter((f) => DEF.test(readFileSync(f, 'utf8'))).map(rel), name).toEqual(['shared/api.ts']);
    }
  });

  // NODE_ROLES and isNodeRole moved to shared/node-role.ts (re-exported from
  // api.ts). Same single-definition invariant, different file.
  it('defines NODE_ROLES and isNodeRole exactly once, in shared/node-role.ts', () => {
    const arrDEF = new RegExp('^\\s*(?:export\\s+)?(?:const|let|var)\\s+NODE_ROLES\\b', 'm');
    expect(ALL.filter((f) => arrDEF.test(readFileSync(f, 'utf8'))).map(rel)).toEqual(['shared/node-role.ts']);
    const fnDEF = new RegExp('^\\s*(?:export\\s+)?function\\s+isNodeRole\\b', 'm');
    expect(ALL.filter((f) => fnDEF.test(readFileSync(f, 'utf8'))).map(rel)).toEqual(['shared/node-role.ts']);
  });

  it('StampRead is DERIVED from its array — a hand-written union restates ReadFailure\'s pair', () => {
    // `'absent' | 'unreadable'` spelled in shared/api.ts would make it a second
    // holder in "one absent/unreadable read vocabulary" above, and this file
    // cannot import ReadFailure (peers-claims-l0.test.ts pins its three type
    // imports). So the union comes from STAMP_READS, and update-states.test.ts
    // holds its failure half equal to ReadFailure at compile time.
    const api = readFileSync(path.join(ccrcRoot, 'shared', 'api.ts'), 'utf8');
    expect(api).toMatch(/^export const STAMP_READS = \['ok', 'absent', 'unreadable', 'malformed'\] as const;$/m);
    expect(api).toMatch(/^export type StampRead = \(typeof STAMP_READS\)\[number\];$/m);
  });

  it('spells the tag shape once — every other reader calls isReleaseTag', () => {
    // The literal regex SOURCE, however delimited. `shared/semver.ts` checks
    // its precondition structurally and is held to agree with isReleaseTag by
    // `update-semver.test.ts`, so it is not a holder here either.
    const SHAPE_TEXT = 'v[0-9]+\\.[0-9]+\\.[0-9]+';
    const holders = ALL.filter((f) => readFileSync(f, 'utf8').includes(SHAPE_TEXT)).map(rel);
    expect(holders).toEqual(['shared/api.ts']);
  });

  // THE SQL-TUPLE SCANS — the `TERMINAL_ITEM_STATES` shape. Store code that
  // needs one of these sets in a `WHERE` builds it from the array by `.join`
  // (the `TERMINAL_DELIVERY_SQL` idiom), so the shipped source holds no
  // literal tuple at all; a hand-written `IN ('pending','applying','unknown')`
  // is a second definition of busy that nothing forces to agree.
  //
  // THE FINGERPRINT: a parenthesised list of TWO OR MORE quoted words, every
  // one of them a member, in any order — a copy from memory is as likely in
  // any order. Two or more, because a single `('stable')` states no set; a
  // whole list, because the §6 seed row `('*', 'stable', NULL, 'off',
  // 'channel', 0, 'migration')` carries members beside non-members and is not
  // a copy of any vocabulary (asserted below, since Task 3 ships it).
  // KNOWN WIDTH: a tuple of another vocabulary made only of words it shares
  // with one of these (`('done','failed')` is RunState's and UpdatePhase's)
  // also scores. Measured zero holders for every vocabulary at d759c914; if
  // such a tuple ever lands legitimately it is a hand-typed SQL list of THAT
  // vocabulary, which its own scan should be refusing.
  const esc = (w: string): string => w.replace(/[\\.*+?^${}()|[\]\-]/g, '\\$&');
  const tupleOf = (members: readonly string[]): RegExp => {
    const alt = `(?:${members.map(esc).join('|')})`;
    return new RegExp(`\\(\\s*['"]${alt}['"]\\s*(?:,\\s*['"]${alt}['"]\\s*)+\\)`);
  };
  const SQL_VOCABS: ReadonlyArray<readonly [string, readonly string[]]> = [
    ['UpdateChannel', UPDATE_CHANNELS], ['UpdateState', UPDATE_STATES], ['UpdatePhase', UPDATE_PHASES],
    ['InstallState', INSTALL_STATES], ['ProvenanceState', PROVENANCE_STATES], ['AutoMode', AUTO_MODES],
    ['NotifyMode', NOTIFY_MODES], ['RequestKind', REQUEST_KINDS], ['StampRead', STAMP_READS],
    ['NodeRole', NODE_ROLES], ['NodeOs', NODE_OSES], ['TagFileRead', TAG_FILE_READS],
  ];

  it('the tuple fingerprint catches a copy in any order and leaves non-copies alone', () => {
    const busy = tupleOf(UPDATE_STATES);
    expect(busy.test("WHERE updateState IN ('pending','applying','unknown')")).toBe(true);
    expect(busy.test("WHERE updateState IN ( 'unknown', \"pending\" )")).toBe(true);
    expect(busy.test("WHERE updateState IN ('idle')"), 'one word is not a set').toBe(false);
    expect(busy.test("WHERE updateState IN ('idle', 'paused')"), 'a non-member breaks the list').toBe(false);
    expect(busy.test("['pending', 'applying', 'unknown'] as const"), 'a TS array is the definition').toBe(false);
    const seed = "INSERT INTO update_intent VALUES ('*', 'stable', NULL, 'off', 'channel', 0, 'migration');";
    expect(tupleOf(AUTO_MODES).test(seed), 'the §6 seed row is not an AutoMode tuple').toBe(false);
    expect(tupleOf(NOTIFY_MODES).test(seed), 'the §6 seed row is not a NotifyMode tuple').toBe(false);
    expect(tupleOf(UPDATE_CHANNELS).test(seed), 'the §6 seed row is not an UpdateChannel tuple').toBe(false);
    expect(tupleOf(UPDATE_PHASES).test("('backing-up', 'installing')"), 'hyphenated members').toBe(true);
  });

  for (const [name, members] of SQL_VOCABS) {
    it(`no source hand-types an SQL tuple of ${name}`, () => {
      const TUPLE = tupleOf(members);
      expect(ALL.filter((f) => TUPLE.test(readFileSync(f, 'utf8'))).map(rel)).toEqual([]);
    });
  }
});


// ── Design 2026-09-20 §6: the update ring ─────────────────────────────────
// "W2 extends that describe to scan server/src/update with an EMPTY
// allowlist" — and D-3187 leans on it: the resolver stays
// L1 and the projection writer L3 BY THEIR IMPORTS, and no file there holds
// the handle. The coord ring (`describe('the coord ring — …')` above)
// allowlists five holders; this one allowlists NONE, so every read and write
// the update modules make goes through a `CoordStore` method.
// APPENDED, not nested inside the coord ring as the spec's sentence reads:
// `session-hook.test.ts`'s citation audit cites this file by line, so an
// insert above a cited line moves its census. It reads the coord ring's
// `REACH` — module-scope, declared under that describe — not a copy.
describe('the update ring — nothing under server/src/update holds the handle (design 2026-09-20 §6)', () => {
  const updateDir = path.join(ccrcRoot, 'server/src/update');
  /** Every file the ring is known to hold, appended by the task that
   *  creates it (W2: catalogue.ts, inventory.ts, resolve.ts, project.ts,
   *  routes.ts). A FLOOR, not a count: a new file raises it rather than
   *  breaking it, and a listed file that is gone — a moved or renamed
   *  directory — reds instead of disarming the scan. */
  const UPDATE_RING_FILES: readonly string[] = ['catalogue.ts', 'inventory.ts', 'resolve.ts', 'project.ts', 'routes.ts', 'notify.ts', 'dispatch.ts', 'converge.ts'];
  // A bare `import 'node:sqlite'` and a dynamic `import('node:sqlite')` count
  // too — the coord ring's `from\s+'node:sqlite'` sees neither. Either quote: a double-quoted specifier
  // (`from "node:sqlite"`) is valid TS and would otherwise pass this scan unseen (D-3407 fix round).
  const IMPORTS_SQLITE = /(?:\bfrom\s+|\bimport\s*\(?\s*)['"]node:sqlite['"]/;
  const IMPORTS_DB = /(?:\bfrom\s+|\bimport\s*\(?\s*)['"](?:\.{1,2}\/)+(?:coord\/)?db\.js['"]/;
  const IMPORTS_UPDATE = /\bfrom\s+['"](?:\.\/|(?:\.\.\/)+)update\//;
  /** Over `[name, source]` pairs, so the CONTROL below plants its shapes as
   *  text — no fixture directory, and so no new import line in this file. */
  const ringViolations = (files: readonly (readonly [string, string])[]): string[] =>
    files.flatMap(([name, src]) => [
      ...(IMPORTS_SQLITE.test(src) ? [`${name} imports node:sqlite`] : []),
      ...(IMPORTS_DB.test(src) ? [`${name} imports a coord db module`] : []),
      ...(REACH.test(src) ? [`${name} names a database handle on a coord/store receiver`] : []),
    ]);
  const onDisk = (dir: string): (readonly [string, string])[] =>
    sources(dir).map((f) => [path.relative(dir, f), readFileSync(f, 'utf8')] as const);

  it('covers the directory — absent means nothing expects it, present means every listed file is visited (never a skip)', () => {
    if (!existsSync(updateDir)) {
      expect(UPDATE_RING_FILES,
        'files are listed for an update ring that is not on disk — was the directory moved?').toEqual([]);
      const importers = sources(path.join(ccrcRoot, 'server/src'))
        .filter((f) => IMPORTS_UPDATE.test(readFileSync(f, 'utf8'))).map(rel);
      expect(importers, 'a server/src file imports from an update directory this scan cannot see').toEqual([]);
      return;
    }
    const names = sources(updateDir).map((p) => path.relative(updateDir, p));
    for (const f of UPDATE_RING_FILES) expect(names, `${f} is listed but not on disk`).toContain(f);
    expect(names.length).toBeGreaterThanOrEqual(UPDATE_RING_FILES.length);
  });

  it('no file there imports node:sqlite or a coord db module, or reaches for a handle — an EMPTY allowlist', () => {
    expect(existsSync(updateDir) ? ringViolations(onDisk(updateDir)) : []).toEqual([]);
  });

  it('CONTROL: each forbidden shape is caught on planted text, and a store import is not', () => {
    expect(ringViolations([
      ['a.ts', "import 'node:sqlite';\n"],
      ['b.ts', "import type { DatabaseSync } from 'node:sqlite';\n"],
      ['c.ts', "import { tx } from '../coord/db.js';\n"],
      ['d.ts', 'export const n = (coord: { db: unknown }) => tx(coord.db, () => 1);\n'],
      ['e.ts', "import type { CoordStore } from '../coord/store.js';\nexport const f = (s: CoordStore) => s.intents();\n"],
    ]).sort()).toEqual([
      'a.ts imports node:sqlite',
      'b.ts imports node:sqlite',
      'c.ts imports a coord db module',
      'd.ts names a database handle on a coord/store receiver',
    ]);
  });

  it('CONTROL: a double-quoted specifier is caught too — valid TS the single-quote-only scan would miss', () => {
    expect(ringViolations([
      ['f.ts', 'import { readFileSync } from "node:fs";\nimport type { DatabaseSync } from "node:sqlite";\n'],
      ['g.ts', 'import { tx } from "../coord/db.js";\n'],
    ]).sort()).toEqual([
      'f.ts imports node:sqlite',
      'g.ts imports a coord db module',
    ]);
  });
});


// — design 2026-09-20 §8: the ~/.ccrc node-file names, declared once —
// APPENDED, never inserted: `session-hook.test.ts`'s citation audit cites this
// file by line (`:32-37`, `:1274`, `:1303`), so an insert above those moves them.
describe('one NODE_FILES — the ~/.ccrc node-file basenames', () => {
  /** F16 (fix round 1, dispatch E, m2): DERIVED from the import of
   *  NODE_FILE_BASENAMES, never hand-typed — a hand-typed copy goes vacuous
   *  SILENTLY the moment a NODE_FILES value is renamed (it would simply stop
   *  matching anything, never redding the "declared once" case above, which
   *  scans for a DIFFERENT literal). A DYNAMIC import, not a static
   *  top-of-file one: this file's own lines above `NINE_BASENAMES` are
   *  `session-hook.test.ts`'s citation anchors (`:32-37`, `:1274`, `:1303`),
   *  and every edit in this describe stays END-OF-FILE only — a new
   *  top-of-file import line would shift every one of them. */
  let NINE_BASENAMES: readonly string[] = [];
  beforeAll(async () => {
    ({ NODE_FILE_BASENAMES: NINE_BASENAMES } = await import('../../../shared/agent-protocol.js'));
  });

  it('is declared in exactly one file, and that file is shared/agent-protocol.ts', () => {
    const holders = ALL.filter((f) => /^\s*export const NODE_FILES\b/m.test(readFileSync(f, 'utf8'))).map(rel);
    expect(holders).toEqual(['shared/agent-protocol.ts']);
  });

  /** Comment lines blanked before the QUOTED scan runs — this codebase's own
   *  convention is to name these basenames in BACKTICK-quoted PROSE inside a
   *  docstring (`` `update-intent` is in the agent's read set `` and the
   *  like), and F16's widened, quote-agnostic regex would otherwise read
   *  every one of those mentions as a second CODE definition. Same shape as
   *  `update-writer-groups.test.ts`'s `blankComments`, copied rather than
   *  imported — a test file does not import another test file's internals. */
  const blankComments = (src: string): string =>
    src.split('\n').map((l) => (/^\s*(\*|\/\*|\/\/)/.test(l) ? '' : l)).join('\n');

  // F16 (m2): hoisted to describe scope and shared by both the real case and
  // its own CONTROL below — a REDECLARED copy in the CONTROL tested nothing
  // about the case it claimed to control (measured: reverting the real
  // case's regex to single-quote-only stayed green, CONTROL included).
  const QUOTED = /(['"`])(?:ccrc-caps|update\.json|update-intent|box-token-generation)\1/;

  it('the four names no older code spells are quoted nowhere else — every reader goes through NODE_FILES', () => {
    // `build.json`, `installed`, `floor` and `previous` are ordinary words older
    // code already spells (`config.ts`'s `buildInfoPath`, the agent's own stamp
    // reader), and `node-id` is also a W1 CAP word (`ccd/ccrc`'s
    // `CCRC_CAP_WORDS`) a later task may test for; these three are new with the
    // control plane (and `box-token-generation` with the box-token lifecycle,
    // wave 1), so a second quoted copy is a second definition. F16: a
    // BACKREFERENCE, not a fixed `'…'` — a double-quoted or backtick re-list
    // is the same second definition, and the un-widened regex missed both.
    const holders = ALL.filter((f) => QUOTED.test(blankComments(readFileSync(f, 'utf8')))).map(rel);
    expect(holders).toEqual(['shared/agent-protocol.ts']);
  });

  it("CONTROL: the QUOTED case reads all three quote styles, not just single-quoted (F16)", () => {
    expect(QUOTED.test('const x = "ccrc-caps";'), 'double-quoted went unseen').toBe(true);
    expect(QUOTED.test('const x = `update-intent`;'), 'backtick-quoted went unseen').toBe(true);
    expect(QUOTED.test("const x = 'update.json';"), 'single-quoted (the original case) regressed').toBe(true);
    expect(QUOTED.test("const x = 'box-token-generation';"), 'the ninth name went unseen').toBe(true);
    expect(QUOTED.test('const x = "update.json`;'), 'mismatched quote characters falsely matched').toBe(false);
  });

  it("the agent's read grant imports NODE_FILE_BASENAMES", () => {
    // Renamed (F16): this checks only the import. Whether agent/src ALSO
    // carries a second, re-typed list beside it is the next case's job — a
    // title claiming "never re-lists it" was never itself checked here.
    const wl = readFileSync(path.join(ccrcRoot, 'agent', 'src', 'whitelist.ts'), 'utf8');
    expect(wl).toMatch(/import\s*\{[^}]*\bNODE_FILE_BASENAMES\b[^}]*\}\s*from\s*'\.\.\/\.\.\/shared\/agent-protocol\.js'/);
  });

  /** Every file under `agent/src` (any depth) that spells ALL NINE basenames
   *  as string literals (any quote style) — a file that does is a second
   *  list, whether or not it also imports `NODE_FILE_BASENAMES`. Takes
   *  fixture pairs so the CONTROL below can drive it without touching a real
   *  file (F16). */
  const agentBasenameHolders = (files: readonly { path: string; src: string }[]): string[] =>
    files
      .filter(({ src }) => NINE_BASENAMES.every((n) => new RegExp(`(['"\`])${n.replace('.', '\\.')}\\1`).test(src)))
      .map((f) => f.path);

  it('no file in agent/src re-lists all nine basenames beside the NODE_FILE_BASENAMES import (F16)', () => {
    // Anti-vacuity (F16, m2): the derived list really does carry all nine —
    // a NODE_FILES shrink or a broken import would otherwise let this
    // describe run over an empty or partial set and pass for the wrong reason.
    expect(NINE_BASENAMES, 'NODE_FILE_BASENAMES did not import, or the vocabulary shrank').toHaveLength(10);
    const files = ALL.filter((f) => rel(f).startsWith('agent/src/'))
      .map((f) => ({ path: rel(f), src: readFileSync(f, 'utf8') }));
    expect(files.length, 'the agent/src scan is over nothing').toBeGreaterThan(3);
    expect(agentBasenameHolders(files)).toEqual([]);
  });

  it('CONTROL: a planted re-list of all nine basenames beside the import reds the check above (F16)', () => {
    const real = readFileSync(path.join(ccrcRoot, 'agent', 'src', 'whitelist.ts'), 'utf8');
    const planted = `${real}\nconst ALSO = ["build.json", 'installed', \`ccrc-caps\`, 'floor', "previous", 'node-id', \`update.json\`, "update-intent", 'box-token-generation', 'tmp-sweep.json'];\n`;
    expect(agentBasenameHolders([{ path: 'agent/src/whitelist.ts', src: planted }]),
      'a planted re-list of all nine went unseen').toEqual(['agent/src/whitelist.ts']);
    expect(agentBasenameHolders([{ path: 'agent/src/whitelist.ts', src: real }]),
      'the real file false-reds with no re-list planted').toEqual([]);
  });

  it("the ready frame's ops field has ONE reader in server/src", () => {
    const hits = ALL.filter((f) => rel(f).startsWith('server/src/'))
      .flatMap((f) => [...readFileSync(f, 'utf8').matchAll(/\bframe\.ops\b/g)].map(() => rel(f)));
    expect(hits).toEqual(['server/src/remote/client.ts']);
  });
});


describe('the release summary clause is spelled once, in L0 (plan W3 Task 3)', () => {
  // D-3301: the release push's body (server) and the update banner (pwa) say the same
  // clause. A second spelling in either package is a sentence to keep in step by hand, so it has ONE holder
  // across the four TS roots — the L0 module both import.
  it("'fleet and server are on ' is spelled in shared/update-summary.ts and nowhere else", () => {
    const holders = ALL.filter((f) => readFileSync(f, 'utf8').includes('fleet and server are on ')).map(rel);
    expect(holders).toEqual(['shared/update-summary.ts']);
  });

  // Fix round 2 (review of def82cd4): `remoteSides` moved here from
  // `pwa/src/fleet/BuildLine.tsx` (D-3313) in fix round 1, but no case here ever pinned it as a single
  // holder — `update-summary.test.ts`'s own comment claimed this suite already did, falsely.
  it('remoteSides is declared once, in shared/update-summary.ts', () => {
    const holders = ALL.filter((f) => /^\s*export function remoteSides\b/m.test(readFileSync(f, 'utf8'))).map(rel);
    expect(holders).toEqual(['shared/update-summary.ts']);
  });

  // Fix round 2 (review of d5aefc4a, item 5): `statedOf` — the one predicate for "does this reading vouch
  // for its version" (measuredAt/stampRead/reachable) — is called from `pushRelease` (server), the banner,
  // BuildLine and FleetHostBanner's skew arm (PWA); none of them may re-derive the same three-clause fact
  // inline, the exact drift BuildLine's own narrower `reachable`-only form was before this fix.
  it('statedOf is declared once, in shared/update-summary.ts', () => {
    const holders = ALL.filter((f) => /^\s*export function statedOf\b/m.test(readFileSync(f, 'utf8'))).map(rel);
    expect(holders).toEqual(['shared/update-summary.ts']);
  });

  // W5 review 161 (F-J): the "one holder" scan above catches only a SECOND
  // `export function statedOf`, by name — it never caught `pendingTag`
  // (`pwa/src/fleet/useUpdatesView.ts`) re-deriving the exact same three
  // clauses inline, unnamed, which is the copy a reasonable author actually
  // writes (the file's own header explains why: a scan reads text, not
  // meaning). This widens the trap to that shape too — every one of the three
  // field names, PLUS a `=== 'ok'`/`!== 'ok'` stampRead comparison AND a
  // `=== true`/`!== true` reachable comparison, within a short window of each
  // other — outside `shared/update-summary.ts` itself. A plain fixture object
  // (`stampRead: 'ok', reachable: true,`) never trips it: those are property
  // assignments, not comparisons, so `ALL` (src only, no test fixtures) stays
  // clean today; `pendingTag` now reads `statedOf(n)` instead of restating it.
  it('no inline three-clause copy of statedOf\'s predicate (measuredAt + stampRead + reachable, compared) exists outside shared/update-summary.ts', () => {
    const WINDOW = 6;
    const offenders = ALL.filter((f) => {
      if (rel(f) === 'shared/update-summary.ts') return false;
      const lines = readFileSync(f, 'utf8').split('\n');
      for (let i = 0; i < lines.length; i++) {
        const w = lines.slice(i, i + WINDOW).join('\n');
        if (/measuredAt/.test(w) && /stampRead/.test(w) && /reachable/.test(w)
          && /(!==|===)\s*'ok'/.test(w) && /(!==|===)\s*true/.test(w)) return true;
      }
      return false;
    }).map(rel);
    expect(offenders).toEqual([]);
  });
});


// Design 2026-09-20 §9/§13 (programme wave 3, Task 7; D-3305):
// the ccrc-caps word the auto-install gate reads is spelled ONCE. W2 declared it
// in the server's L1 resolver, which the PWA cannot import — and the settings
// screen now disables its auto-install control on the same word
// (D-3297), so a second literal in pwa/src would be two
// spellings of one gate that nothing forces to agree. The declaration moved to
// L0 and `server/src/update/resolve.ts` re-exports it, so every W2 importer
// keeps its path. KNOWN WIDTH: the literal scan reads single- and double-quoted
// strings; a backticked mention is prose (`routes.ts`'s docstring names the word
// that way) and a template-literal copy in code would pass it. APPENDED after the
// file's last line: `session-hook.test.ts`'s citation audit cites this file by
// line, so nothing above may move (R13).
describe('the auto-install gate word is declared once, in L0 (programme wave 3)', () => {
  const LITERAL = /(['"])update-gate\1/;
  const DEF = /^\s*(?:export\s+)?(?:const|let|var)\s+UPDATE_GATE_CAP\b/m;

  it('CONTROL: the patterns see a declaration and a quoted copy, and not a re-export or a prose mention', () => {
    expect(DEF.test("export const UPDATE_GATE_CAP = 'update-gate';")).toBe(true);
    expect(DEF.test('const UPDATE_GATE_CAP = GATE;'), 'an un-exported copy is still a copy').toBe(true);
    expect(DEF.test('export { UPDATE_GATE_CAP };'), 'a re-export declares nothing').toBe(false);
    expect(DEF.test("import { UPDATE_GATE_CAP } from '../../../shared/api.js';"), 'an import declares nothing').toBe(false);
    expect(LITERAL.test("caps.includes('update-gate')")).toBe(true);
    expect(LITERAL.test('caps.includes("update-gate")')).toBe(true);
    expect(LITERAL.test('lacks `update-gate` in its measured caps'), 'a backticked prose mention').toBe(false);
    expect(LITERAL.test("'update-gates'"), 'another word').toBe(false);
  });

  it('UPDATE_GATE_CAP is declared in shared/api.ts and nowhere else — resolve.ts re-exports it', () => {
    expect(ALL.filter((f) => DEF.test(readFileSync(f, 'utf8'))).map(rel)).toEqual(['shared/api.ts']);
  });

  it('the word is quoted in shared/api.ts and nowhere else across the four roots', () => {
    expect(ALL.filter((f) => LITERAL.test(readFileSync(f, 'utf8'))).map(rel)).toEqual(['shared/api.ts']);
  });
});


describe('the feed archive\'s writer set (D-5859; ARCH-54 #789)', () => {
  // D-5859 (plan docs/superpowers/plans/2026-10-19-consolidation-w1a-switches-notify.md, Task C1e; ARCH-54 (#789);
  // spec §2.1 rule (f)). The feed archive's writer set reaches its W1a target: the funnel (`notice.ts`, `notify` and its
  // batch `notifyEach`, one archive call between them) and stop-done's own pair (`stopDoneSweep.ts`, which W4 moves).
  // D-7041 (ARCH-43; spec §5.7 "2 -> 1"): stop-done's pair goes through the funnel, so the funnel is the one writer.
  // May only shrink: a new hand-written `recordFeedEvent(` anywhere under server/src is red; raise a notice through
  // the funnel instead. Its own describe block, away from the
  // ARCH-40 tail and the file's end where other open slices append, and the census is loaded here, not at an import
  // line, so no other block's line moves.
  it('the feed archive has one writer, the funnel, and its call sites may only shrink (D-5859, D-7041)', async () => {
    const { feedRecordCallSites } = await import('../consolidationCensus.js');
    const sites = feedRecordCallSites();
    const where = sites.map((x) => `${x.file}:${x.line}`).join(', ');
    expect(sites.length, `the feed archive has one writer at most; found ${where}`).toBeLessThanOrEqual(1);
    expect(sites.filter((x) => x.file === 'server/src/notice.ts'), 'the funnel archives at exactly one site').toHaveLength(1);
    for (const x of sites) {
      expect(['server/src/notice.ts'], `${x.file}:${x.line}: a hand-written feed archive write — `
        + "raise it through notice.ts's notify").toContain(x.file);
    }
  });
});


// — design 2026-09-20 §10: the update op's refusal words and its launcher, declared once —
// APPENDED, never inserted: `session-hook.test.ts`'s citation audit cites this
// file by line (`:32-37`, `:1274`, `:1303`), so an insert above those moves them.
describe('the update op — its refusal words and its launcher are declared once', () => {
  it('UPDATE_OP_ERRORS and UpdateOpError are each declared in exactly one file, shared/agent-protocol.ts', () => {
    for (const re of [/^\s*export const UPDATE_OP_ERRORS\b/m, /^\s*export type UpdateOpError\b/m]) {
      const holders = ALL.filter((f) => re.test(readFileSync(f, 'utf8'))).map(rel);
      expect(holders, String(re)).toEqual(['shared/agent-protocol.ts']);
    }
  });

  it('the five words are listed together in one file, in any order or quote style — a second list is a second vocabulary', async () => {
    // The words alone don't prove a copy: `bad-tag` and `busy` are also
    // route and store words (`UpdateRouteError`, `UPDATE_STORE_REFUSE_CODES`),
    // and the dispatcher's answer mapping names `spawn-failed` in a `case`.
    // What proves a second vocabulary is all five TOGETHER — derived from
    // `UPDATE_OP_ERRORS` itself, so a reordered or double-quoted copy still
    // counts, not just this file's own single-quoted, in-order spelling. A
    // holder is a single line, or a single `[...]` array-literal span, that
    // quotes all five.
    // A dynamic import, not a static top-of-file line: an import line above `:32-37` shifts every
    // line the citation audit anchors (R13; the F16 `NODE_FILES` describe above does the same).
    const { UPDATE_OP_ERRORS } = await import('../../../shared/agent-protocol.js');
    const words = [...UPDATE_OP_ERRORS];
    const quoted = (w: string): RegExp => new RegExp(`(['"])${w}\\1`);
    const hasAllWords = (span: string): boolean => words.every((w) => quoted(w).test(span));
    const isListHolder = (text: string): boolean =>
      text.split('\n').some(hasAllWords) || (text.match(/\[[^[\]]*\]/g) ?? []).some(hasAllWords);
    const holders = ALL.filter((f) => isListHolder(readFileSync(f, 'utf8'))).map(rel);
    expect(holders).toEqual(['shared/agent-protocol.ts']);
  });

  // Both scans below must not fire on `shared/agent-protocol.ts`'s OWN
  // docstrings (around lines 379 and 386), which legitimately say
  // `` `$HOME/.local/bin/ccrc` `` / `` `<home>/.local/bin/ccrc` `` as prose —
  // so both read the source with every comment line (a trimmed start of
  // `//`, `/*` or `*`) stripped first.
  const stripCommentLines = (text: string): string =>
    text
      .split('\n')
      .filter((l) => {
        const t = l.trim();
        return !(t.startsWith('//') || t.startsWith('/*') || t.startsWith('*'));
      })
      .join('\n');

  it("the launcher's path parts are spelled in one file — the agent and the server-role spawn call updateLauncherPath", () => {
    // The three-arg array literal, and the two ways a `join(home, ...)` caller
    // could split it across two arguments instead: `'.local', 'bin/ccrc'` or
    // `'.local/bin', 'ccrc'`. Either quote style.
    const PARTS =
      /['"]\.local['"]\s*,\s*['"]bin['"]\s*,\s*['"]ccrc['"]|['"]\.local['"]\s*,\s*['"]bin\/ccrc['"]|['"]\.local\/bin['"]\s*,\s*['"]ccrc['"]/;
    const holders = ALL.filter((f) => PARTS.test(stripCommentLines(readFileSync(f, 'utf8')))).map(rel);
    expect(holders).toEqual(['shared/agent-protocol.ts']);
  });

  it('no TS root spells the launcher as one quoted path string', () => {
    // `'…/.local/bin/ccrc'`, `"…/.local/bin/ccrc/…"`, or a backtick template
    // (`` `${home}/.local/bin/ccrc` ``) — no leading `/` is required before
    // `.local`, so a bare `'.local/bin/ccrc'` counts too. `ccrc-api`'s path
    // (`coord/envelope.ts`) is a different binary and does not match: the
    // character after `ccrc` must be a quote, a slash, or the end of the line.
    const QUOTED = /['"`][^'"`\n]*\.local\/bin\/ccrc(?:['"`/]|$)/m;
    const holders = ALL.filter((f) => QUOTED.test(stripCommentLines(readFileSync(f, 'utf8')))).map(rel);
    expect(holders).toEqual([]);
  });
});


// ── Programme wave 5 (design 2026-09-20 §9/§10): the dispatcher's words and order ──
// APPENDED after the file's last line: `session-hook.test.ts`'s citation audit
// cites this file by line, so nothing above may move (R13). No import is
// added either — the twelve words are stated here as a LITERAL, on purpose (the
// opposite of W2's `SQL_VOCABS`, which imports its arrays): `update-dispatch.test.ts` holds L0's array equal to
// this same list, and the fingerprint below must find shared/api.ts's array,
// so a word added on one side alone reds one of the two.
//
// THE FINGERPRINT is W2's SQL-tuple shape widened to brackets: two or more
// quoted members and nothing else, in any order, parenthesised OR bracketed —
// a copy from memory is as likely a `['halted', 'not-newer']` filter as an SQL
// `IN (…)`. A Record keyed by the type (dispatch.ts's sentences, the PWA's
// UPDATE_ERROR_TEXT) is braced, held exhaustive by the compiler, and is not a
// copy. KNOWN WIDTH: a list spelled across a spread or a template is not seen.
describe('the dispatcher refusal words and the dispatch order are declared once, in L0 (programme wave 5)', () => {
  const WORDS = [
    'unknown-tag', 'not-newer', 'refused-by-node', 'stamp-unread', 'floor-unread', 'no-detach-cap',
    'no-update-gate', 'no-rollback-cap', 'agent-predates-update-op', 'halted', 'waiting-for-fleet', 'no-bundle',
  ];
  const alt = `(?:${WORDS.map((w) => w.replace(/[\\.*+?^${}()|[\]\-]/g, '\\$&')).join('|')})`;
  const item = `\\s*['"]${alt}['"]\\s*`;
  const LIST = new RegExp(`\\(${item}(?:,${item})+,?\\s*\\)|\\[${item}(?:,${item})+,?\\s*\\]`);
  const DEF = /^\s*(?:export\s+)?(?:declare\s+)?(?:type\s+DispatchRefusal\b\s*(?:<[^>\n]*>)?\s*=|interface\s+DispatchRefusal\b)/m;
  const VALUE = /^\s*(?:export\s+)?(?:const|let|var)\s+DISPATCH_REFUSALS\b/m;
  const FNS = ['isDispatchRefusal', 'dispatchRank', 'compareDispatchOrder'] as const;

  it('CONTROL: the list fingerprint sees a copy in any order, either bracket, and nothing that is not one', () => {
    expect(LIST.test("if (['halted', 'not-newer'].includes(w))")).toBe(true);
    expect(LIST.test("WHERE why IN ( 'waiting-for-fleet', \"halted\" )")).toBe(true);
    expect(LIST.test("[\n  'no-detach-cap',\n  'no-rollback-cap',\n]")).toBe(true);
    expect(LIST.test("['halted']"), 'one word states no set').toBe(false);
    expect(LIST.test("['halted', 'busy']"), 'a non-member breaks the list').toBe(false);
    expect(LIST.test("{ 'not-newer': 'a', halted: 'b' }"), 'a keyed record is not a list').toBe(false);
    expect(LIST.test("moveRefusal(view, 'halted')"), 'an argument list with a non-literal').toBe(false);
  });

  it('declares DispatchRefusal once, in shared/api.ts', () => {
    expect(DEF.test("import {\n  type DispatchRefusal,\n} from '../../../shared/api.js';"), 'import specifier').toBe(false);
    expect(DEF.test("type DispatchRefusal = 'halted';"), 'un-exported local declaration').toBe(true);
    expect(ALL.filter((f) => DEF.test(readFileSync(f, 'utf8'))).map(rel)).toEqual(['shared/api.ts']);
  });

  it('defines the array, its guard, the rank and the comparator once, in shared/api.ts', () => {
    expect(ALL.filter((f) => VALUE.test(readFileSync(f, 'utf8'))).map(rel)).toEqual(['shared/api.ts']);
    for (const name of FNS) {
      const FN = new RegExp(`^\\s*(?:export\\s+)?function\\s+${name}\\b`, 'm');
      expect(ALL.filter((f) => FN.test(readFileSync(f, 'utf8'))).map(rel), name).toEqual(['shared/api.ts']);
    }
  });

  it('no source across the four roots spells a second list of the words — shared/api.ts holds the one', () => {
    expect(ALL.filter((f) => LIST.test(readFileSync(f, 'utf8'))).map(rel)).toEqual(['shared/api.ts']);
  });
});


// WORKER STALL WATCH, WAVE 1 (design 2026-09-29 §4.2, "Spelled once"). APPENDED, not nested, for the reason stated
// at this file's other appended describes: `session-hook.test.ts`'s citation audit cites this file by line.
// The needles are anchored on BOTH sides by the same quote, single or double, for three reasons:
// - `stall-check:` must not be found inside `re stall-check:`;
// - `review-done` must not be found inside the review-rejection subject `close.ts` spells;
// - `stall` must not be found inside `stall-shadow`.
// KNOWN WIDTH: a copy written in backticks, or as the head of a longer template, is not seen. Backticks are left out
// ON PURPOSE: docstrings name these prefixes in backticks, and a pin that fired on a comment would be a false red.
describe('the stall watch spells its prefixes, its detail heads and the review-done subject once (design 2026-09-29 §4.2)', () => {
  const quoted = (needle: string): RegExp => {
    const escaped = needle.replace(/[.*+?^$()|[\]\\{}]/g, (c) => `\\${c}`);
    return new RegExp(`(['"])${escaped}\\1`);
  };
  const ONE_HOME: ReadonlyArray<readonly [string, string]> = [
    ['stall-check:', 'server/src/coord/stall.ts'],
    ['re stall-check:', 'server/src/coord/stall.ts'],
    ['re stall-check: waiting', 'server/src/coord/stall.ts'],
    ['stall:', 'server/src/coord/stall.ts'],
    ['wait:', 'server/src/coord/stall.ts'],
    ['stall', 'server/src/coord/stall.ts'],
    ['stall-shadow', 'server/src/coord/stall.ts'],
    ['review-done', 'shared/api.ts'],
  ];

  it('CONTROL: a quote-anchored needle finds either quote, and never a longer sibling or a backticked mention', () => {
    expect(quoted('stall-check:').test(`x = 're stall-check:'`)).toBe(false);
    expect(quoted('re stall-check:').test(`x = 're stall-check: waiting'`)).toBe(false);
    expect(quoted('review-done').test(`subject: 'review-done-rejected'`)).toBe(false);
    expect(quoted('stall').test(`'stall-shadow'`)).toBe(false);
    expect(quoted('stall-check:').test(`"stall-check:"`)).toBe(true);
    expect(quoted('stall-check:').test(`'stall-check:'`)).toBe(true);
    expect(quoted('stall-check:').test(`'stall-check:"`)).toBe(false);
    expect(quoted('wait:').test('a docstring naming `wait:`')).toBe(false);
  });

  for (const [needle, home] of ONE_HOME) {
    it(`'${needle}' is a quoted literal in exactly one source file, ${home}`, () => {
      const re = quoted(needle);
      const holders = ALL.filter((f) => re.test(readFileSync(f, 'utf8'))).map(rel);
      expect(holders).toEqual([home]);
    });
  }
});


describe('worker stall watch: the four operator-switch markers have no writer in the tree (spec §9.14)', () => {
  // Each marker is touched and removed BY HAND in the fleet box's
  // `~/.cc-sessions` — the `mail-disabled` precedent, whose own no-writer
  // claim nothing pins. So the only code that may spell one is the pure
  // module that READS it, in two halves: no non-comment line of shell (ccd/,
  // deploy/, install.sh — `holdersOf` above) names it at all, and across the
  // four TS roots exactly one file names it on a code line — its definer,
  // which reaches no `node:` module and so cannot write a file. A template
  // (`${reg}/stall-watch-live`) is seen: the TS half scans the bare name on
  // code lines, not a quoted literal. KNOWN WIDTH: a name assembled from pieces
  // (`'stall-watch-' + w`) is not seen; the bar is the ordinary copy.
  const MARKERS: [string, string][] = [
    ['mail-gate-strict', 'shared/switches.ts'], // its switchboard row since D-5855; turnidle.ts re-exports it
    ['stall-watch-disabled', 'server/src/coord/stall.ts'],
    ['stall-watch-live', 'server/src/coord/stall.ts'],
    ['stall-watch-escalate', 'server/src/coord/stall.ts'],
  ];

  it('CONTROL: both corpora were walked, and the filter keeps code and drops prose', () => {
    expect(BASH.length).toBeGreaterThan(10);
    expect(ALL.length).toBeGreaterThan(100);
    expect(stallCodeText("  // touch stall-watch-live\n   * stall-watch-live\n/* stall-watch-live */\nconst m = `${reg}/stall-watch-live`;"))
      .toBe('const m = `${reg}/stall-watch-live`;');
  });

  it.each(MARKERS)('%s: no shell line names it, and its one TS holder is its definer (%s)', (name, definer) => {
    expect(holdersOf(name), `${name}: a line of shell names it — a writer, or a reader this design never had`).toEqual([]);
    expect(ALL.filter((f) => stallCode(f).includes(name)).map(rel).sort(),
      `${name}: spelled on a code line outside ${definer}`).toEqual([definer]);
    expect(stallCode(path.join(ccrcRoot, definer)), `${definer} reaches a node: module or require — it could write the marker`)
      .not.toMatch(/from\s+['"]node:|import\s*\(\s*['"]node:|\brequire\s*\(/);
  });
});


describe('worker stall watch: the wave-done subject is spelled once (spec §4.2 "Whose turn it is")', () => {
  // `WAVE_DONE_SUBJECT` is L0's, and the stall ball rule compares it by
  // EQUALITY — so a second literal is a second rule. Task 4's appended pins
  // already hold the five prefixes, the detail heads and `REVIEW_DONE_SUBJECT`;
  // this row adds the one done subject that predates the watch.
  // QUOTE-ANCHORED at both ends for '…' and "…" — so `'re stall-check:'` never
  // counts as a copy of `'stall-check:'`, nor close.ts's `'review-done-rejected'`
  // as `'review-done'` — and at the open for a template, whose tail is
  // interpolated. Code lines only: prose names `wave-done` in backticks all
  // over the coord ring, and a sentence is not a definition. KNOWN WIDTH: a
  // literal assembled from pieces is not seen.
  const LITERALS: [string, string][] = [
    ['wave-done', 'shared/api.ts'],
  ];
  const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const spelling = (lit: string): RegExp => new RegExp(`'${esc(lit)}'|"${esc(lit)}"|\`${esc(lit)}`);

  it('CONTROL: the anchor tells a constant from its longer neighbours', () => {
    expect(spelling('stall-check:').test("const P = 're stall-check:';")).toBe(false);
    expect(spelling('re stall-check:').test("const P = 're stall-check: waiting';")).toBe(false);
    expect(spelling('review-done').test("subject: 'review-done-rejected'")).toBe(false);
    expect(spelling('wave-done').test('const S = "wave-done";')).toBe(true);
    expect(spelling('stall:').test('const d = `stall:${arm}`;')).toBe(true);
  });

  it.each(LITERALS)("'%s' is spelled on a code line in %s alone", (lit, home) => {
    expect(ALL.filter((f) => spelling(lit).test(stallCode(f))).map(rel).sort(), `a second '${lit}'`).toEqual([home]);
  });
});


describe('the stall watch words a duration once, in shared/stall-watch.ts (stall-watch-settings R37 follow-up)', () => {
  // The Settings section's `quietText` and the feed body's `stallQuietWords` were two copies of one formatter, and they
  // disagreed off the minute grid (3 570 000 ms read "1 h" in one and "60 min" in the other). The fingerprint is the
  // formatter's last arm, the hours-and-minutes template, on a code line. KNOWN WIDTH: a copy that builds the string
  // another way is not seen.
  const HOURS_AND_MINUTES = /`\$\{\w+\} h \$\{\w+\} min`/;
  it('CONTROL: the fingerprint sees the template and not another shape', () => {
    expect(HOURS_AND_MINUTES.test('return m === 0 ? `${h} h` : `${h} h ${m} min`;')).toBe(true);
    expect(HOURS_AND_MINUTES.test('return `${h}h${m}m`;')).toBe(false);
  });
  it('the template is spelled on a code line in shared/stall-watch.ts alone', () => {
    expect(ALL.filter((f) => HOURS_AND_MINUTES.test(stallCode(f))).map(rel).sort()).toEqual(['shared/stall-watch.ts']);
  });
  it('the section and the feed body import it from L0', () => {
    for (const r of ['pwa/src/screens/StallWatchSection.tsx', 'server/src/coord/stallsettings.ts']) {
      expect(stallCode(path.join(ccrcRoot, r)), r)
        .toMatch(/import\s*\{[^}]*\bstallDurationText\b[^}]*\}\s*from\s*'(?:\.\.\/)+shared\/stall-watch(?:\.js)?'/);
    }
  });
});


describe('the archive door\'s refusal codes are spelled once, in L0 (workspace lifecycle wave 2)', () => {
  // `ARCHIVE_REFUSALS` (spec §5.2) is the one declaration; the server sends `ARCHIVE_REFUSALS.<name>` and the PWA
  // compares against it. `run-open` was a bare literal written twice in `server.ts` and once in
  // `ArchiveConflictSheet.tsx` before this wave. Code lines only (`stallCode`): prose names the codes in backticks.
  // Four OTHER vocabularies share spellings, and each is excused here by name rather than by widening the scan:
  //   - `server/src/wsaudit.ts` keys its sentences by ccd's AUDIT verdict words, two of which ccd also dies with
  //     in `cmd_ws_archive` (`session-busy`, `status-unknown`) — the audit's seam, not the door's;
  //   - the temp-root collector's open-run hold word `run-open` (`server/src/collectLane.ts`,
  //     `server/src/coord/collectTempRoot.ts`) — the collector's seam, not the door's;
  //   - the docs reader's `worktree-gone` (`server/src/docs/policy.ts`, `shared/docs.ts`, `pwa/src/docs/docsText.ts`) — the reader's own word;
  //   - `className="run-open"` is the runs board's row button (D-287), a CSS identity — excluded by the pattern.
  // The collector's and the docs reader's excusals are by FILE (the `want` line below), a known width: a door code
  // spelled in one of those files is not seen.
  const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const literal = (code: string): RegExp => new RegExp(`(?<!className=)(['"\`])${esc(code)}\\1`);
  const AUDIT_WORDS = new Set(['session-busy', 'status-unknown']);

  it('CONTROL: the pattern sees a quoted code and passes over a class name and a longer word', () => {
    expect(literal('run-open').test("error: 'run-open',")).toBe(true);
    expect(literal('run-open').test('className="run-open"')).toBe(false);
    expect(literal('worktree-gone').test("'worktree-gone-later'")).toBe(false);
    expect(ALL.filter((f) => literal('coordinator-has-open-runs').test(stallCode(f))).map(rel))
      .toEqual(['shared/api.ts']);
  });

  // The codes as test DATA, bound to the declaration by the first case: a scan driven by `Object.values` alone would
  // scan nothing, and stay green, on a tree where the declaration is gone.
  const CODES = ['run-open', 'session-busy', 'coordinator-has-open-runs', 'programme-partly-ended', 'worktree-gone',
    'status-unknown', 'manifest-unbuildable'];

  it('scans every code the declaration holds', () => {
    expect(Object.values(ARCHIVE_REFUSALS ?? {}).sort()).toEqual([...CODES].sort());
  });

  it.each(CODES)("'%s' is a code-line literal in shared/api.ts alone", (code) => {
    const want = AUDIT_WORDS.has(code) ? ['server/src/wsaudit.ts', 'shared/api.ts'] : code === 'run-open' ? ['server/src/collectLane.ts', 'server/src/coord/collectTempRoot.ts', 'shared/api.ts'] : code === 'worktree-gone' ? ['pwa/src/docs/docsText.ts', 'server/src/docs/policy.ts', 'shared/api.ts', 'shared/docs.ts'] : ['shared/api.ts'];
    expect(ALL.filter((f) => literal(code).test(stallCode(f))).map(rel).sort(), `a second '${code}'`).toEqual(want);
  });
});


// WORKER STALL WATCH, WAVE 2 (design 2026-09-29 §5.2). APPENDED after the last describe, for the reason the wave-1
// blocks above state: `session-hook.test.ts`'s citation audit cites this file by line. The two self-wake prefixes
// join the spelled-once set: a second quoted copy is a second classifier (`stallMailClass`'s `self-wake`) in waiting.
// The needle is quote-anchored at both ends, as ONE_HOME's is, so the update lane's `failed: deadline` prose and a
// backticked docstring mention are not copies. KNOWN WIDTH: a copy in backticks, or at the head of a longer
// literal, is not seen.
describe('the stall watch spells its wave-2 self-wake prefixes once (design 2026-09-29 §5.2)', () => {
  const quotedW2 = (needle: string): RegExp => {
    const escaped = needle.replace(/[.*+?^$()|[\]\\{}]/g, (c) => `\\${c}`);
    return new RegExp(`(['"])${escaped}\\1`);
  };
  const ONE_HOME_W2: ReadonlyArray<readonly [string, string]> = [
    ['orphaned:', 'server/src/coord/stall.ts'],
    ['failed:', 'server/src/coord/stall.ts'],
  ];

  it('CONTROL: the needle finds a bare quoted prefix in either quote, never a longer literal or a backticked mention', () => {
    expect(quotedW2('failed:').test(`x = 'failed:'`)).toBe(true);
    expect(quotedW2('failed:').test(`x = "failed:"`)).toBe(true);
    expect(quotedW2('failed:').test(`detail: 'failed: deadline'`)).toBe(false);
    expect(quotedW2('orphaned:').test('a docstring naming `orphaned:`')).toBe(false);
  });

  for (const [needle, home] of ONE_HOME_W2) {
    it(`'${needle}' is a quoted literal in exactly one source file, ${home}`, () => {
      const holders = ALL.filter((f) => quotedW2(needle).test(readFileSync(f, 'utf8'))).map(rel);
      expect(holders).toEqual([home]);
    });
  }
});


describe('worker stall watch wave 2: the three new operator-switch markers have no writer in the tree (spec §5)', () => {
  // Wave 1's describe above, for the three markers wave 2 adds. It is appended, never merged into that one, because
  // this file is cited by line. SUBSTRING CAVEAT: both halves match with `includes`, and `mail-gate-busy` is a
  // substring of `mail-gate-busy-shadow`, so the `mail-gate-busy` row counts every holder of EITHER spelling: a
  // superset. That is sound only while both are spelled in ONE file (D-3607, `gate-markers-spelled-in-turnidle-only`;
  // `shared/switches.ts` since D-5855), and the CONTROL row states the superset so nobody reads the row as more.
  // `stall-watch-live` is not a substring of `stall-watch-w2-live`, so wave 1's row is untouched by this one.
  const MARKERS: [string, string][] = [
    ['stall-watch-w2-live', 'server/src/coord/stall.ts'],
    ['mail-gate-busy-shadow', 'shared/switches.ts'],
    ['mail-gate-busy', 'shared/switches.ts'],
  ];

  it('CONTROL: the match is a substring — a line spelling mail-gate-busy-shadow also holds mail-gate-busy, never the reverse', async () => {
    expect(stallCodeText("export const MAIL_GATE_BUSY_SHADOW_MARKER = 'mail-gate-busy-shadow';").includes('mail-gate-busy')).toBe(true);
    expect(stallCodeText("export const MAIL_GATE_BUSY_MARKER = 'mail-gate-busy';").includes('mail-gate-busy-shadow')).toBe(false);
    // From the SHIPPED names, never two literals (a literal against a literal can never fail): of every operator-switch
    // marker the two describes pin, the one pair where a name holds another is the busy pair the caveat names. Imported
    // here, not at the head of the file, because this file is cited by line.
    const { STALL_MARKERS } = await import('../../src/coord/stall.js');
    const gate = await import('../../src/turnidle.js');
    const names: string[] = [...STALL_MARKERS, gate.MAIL_GATE_STRICT_MARKER, gate.MAIL_GATE_BUSY_MARKER, gate.MAIL_GATE_BUSY_SHADOW_MARKER];
    expect(names.flatMap((a) => names.filter((b) => a !== b && a.includes(b)).map((b) => `${a} holds ${b}`)))
      .toEqual([`${gate.MAIL_GATE_BUSY_SHADOW_MARKER} holds ${gate.MAIL_GATE_BUSY_MARKER}`]);
  });

  it.each(MARKERS)('%s: no shell line names it, and its one TS holder is its definer (%s)', (name, definer) => {
    expect(holdersOf(name), `${name}: a line of shell names it — a writer, or a reader this design never had`).toEqual([]);
    expect(ALL.filter((f) => stallCode(f).includes(name)).map(rel).sort(),
      `${name}: spelled on a code line outside ${definer}`).toEqual([definer]);
    expect(stallCode(path.join(ccrcRoot, definer)), `${definer} reaches a node: module or require — it could write the marker`)
      .not.toMatch(/from\s+['"]node:|import\s*\(\s*['"]node:|\brequire\s*\(/);
  });
});


describe('worker stall watch wave 2: the self-wake prefixes are spelled once (spec §5.2)', () => {
  // `STALL_ORPHANED_PREFIX` and `STALL_FAILED_PREFIX`: `stallMailClass` reads an `operator` mail whose subject starts
  // with either as `self-wake` (recorded, never pushed), so a second literal is a second rule. The anchor is the
  // wave-done describe's, restated because that one's helpers are scoped to its own describe. QUOTE-ANCHORED, and at
  // the open for a template; code lines only. KNOWN WIDTH: a literal assembled from pieces is not seen.
  const LITERALS: [string, string][] = [
    ['orphaned:', 'server/src/coord/stall.ts'],
    ['failed:', 'server/src/coord/stall.ts'],
  ];
  const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const spelling = (lit: string): RegExp => new RegExp(`'${esc(lit)}'|"${esc(lit)}"|\`${esc(lit)}`);

  it('CONTROL: the anchor sees a constant and a template head, and not a longer neighbour', () => {
    expect(spelling('failed:').test("export const STALL_FAILED_PREFIX = 'failed:';")).toBe(true);
    expect(spelling('orphaned:').test('const s = `orphaned: ${n} background task(s)`;')).toBe(true);
    expect(spelling('failed:').test("const d = 'failed: provenance:';")).toBe(false);
    expect(spelling('failed:').test("const t = 'not failed:';")).toBe(false);
  });

  it.each(LITERALS)("'%s' is spelled on a code line in %s alone", (lit, home) => {
    expect(ALL.filter((f) => spelling(lit).test(stallCode(f))).map(rel).sort(), `a second '${lit}'`).toEqual([home]);
  });
});


describe('one releasedFromOf (workspace lifecycle wave 1)', () => {
  // `FleetSession.releasedFrom` has ONE reader, `releasedFromOf` in `shared/api.ts`. The live `fleet` frame is
  // CAST, not revived, so a raw property read anywhere else meets `undefined` from a server older than the field,
  // where the accessor answers `null` — the two-readers drift this suite exists to forbid. Comment LINES are
  // blanked first (the field is NAMED in prose across the tree), line by line — `blankComments`' shape above. A
  // block-comment regex is NOT safe here: a `/*` inside a string or a `//` line (`server.ts`'s `.cc-limits/*.json`)
  // opens a "comment" that swallows hundreds of lines of real code, the `/ws/fleet` handler among them (measured).
  const code = (f: string): string => readFileSync(f, 'utf8')
    .split('\n').map((l) => (/^\s*(\*|\/\*|\/\/)/.test(l) ? '' : l)).join('\n');
  const READ = /\.releasedFrom\b/;

  it('is read as a property in exactly one file, and that file is shared/api.ts', () => {
    expect(ALL.filter((f) => READ.test(code(f))).map(rel)).toEqual(['shared/api.ts']);
  });

  it('the scan sees the one read it licenses (a blanker that ate code would pass the pin above vacuously)', () => {
    expect(code(path.join(ccrcRoot, 'shared', 'api.ts'))).toMatch(/return s\.releasedFrom \?\? null;/);
  });
});


describe('worker stall watch wave 5: the largest epoch a Date holds is spelled once', () => {
  // The turn marker's reader bounds every epoch by it (`marker-epochs-bounded` (D-3662)) and the watch's formatter
  // refuses a value past it (`stallIso`). Two literals are two bounds that can drift apart; the reader's bound is
  // only a guarantee for the formatter while they are the same number. Code lines only, so a sentence about it is
  // not a second spelling.
  const SPELLING = /\b8\.64e15\b|\b8_?640_?000_?000_?000_?000\b/;

  it('CONTROL: the pattern sees both spellings of the number, and not a neighbour', () => {
    expect(SPELLING.test('export const STALL_EPOCH_MAX = 8.64e15;')).toBe(true);
    expect(SPELLING.test('const M = 8_640_000_000_000_000;')).toBe(true);
    expect(SPELLING.test('const M = 8.64e14;')).toBe(false);
  });

  it('is spelled on a code line in server/src/coord/stall.ts alone', () => {
    expect(ALL.filter((f) => SPELLING.test(stallCode(f))).map(rel).sort(), 'a second spelling').toEqual(['server/src/coord/stall.ts']);
  });
});
