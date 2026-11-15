// D-8641 (the large-file pilot, Task 1): the characterization pin over `delegation-checkpoint.ts`'s PROGRAM.
//
// The pilot splits the file into four modules by pure moves (`.github/ci/file-split.mjs`, D-8636). A scanner that reads
// the file's text would go red when its code moves, or, worse, stay green while reading less code. So every scan of
// the file reads its program instead (`scan/programView.ts`): the file plus the destination modules that exist, or the
// one member that declares a name. These rows pin the view itself, and the 104 top-level names the file declares on
// the day of the pin: each one keeps exactly one home in the program, and each exported one stays exported there. A
// feature that adds a declaration does not red this; one that removes a declaration updates the list in its own PR.
import { describe, it, expect } from 'vitest';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  declaringFile, PROGRAM_VIEWS, programFiles, programMembers, programSource, programTexts,
} from './scan/programView.js';
import { ts } from './scan/parse.js';
import { REPO_ROOT } from './scan/symbols.js';
import { mkTmp } from './tmpHelpers.js';

const SRC = 'server/src/coord/delegation-checkpoint.ts';
const DESTS = ['server/src/coord/delegation-recovery.ts', 'server/src/coord/delegation-durability.ts', 'server/src/coord/delegation-db-projection.ts'];

/** The 104 top-level names `delegation-checkpoint.ts` declares on the pin's base, by the module the pilot moves each to
 *  (the plan's Tasks 3 to 6). A `*` marks the 58 the file exports. */
const NAMES: Readonly<Record<string, readonly string[]>> = {
  // Task 6: what stays, the codec, projectability and the builder (59)
  stays: [
    'DELEGATION_CHECKPOINT_FILE*', 'COORDINATION_RESTORE_MARKER_FILE*', 'DELEGATION_RESTORE_IN_PROGRESS*',
    'DelegationCheckpointErrorCode*', 'DelegationCheckpointError*', 'refuse', 'isRecord', 'isMember', 'Fields',
    'INTERVAL_STATES', 'HOLD_REASONS', 'readSession', 'readAttempt', 'readActivity', 'readLease', 'readLineage',
    'readCursor', 'readInterval', 'readAttemptMark', 'readLeaseCarrier', 'readHold', 'CHECKPOINT_KEYS', 'instantOk',
    'readCheckpoint', 'UTF8', 'encodeDelegationCheckpoint*', 'decodeDelegationCheckpoint*', 'unprojectable',
    'LEASE_CLOCKS', 'assertDelegationCheckpointProjectable*', 'DelegationLeaseEntryFact*', 'DelegationLeaseRecordFact*',
    'assertLeaseJournalProof*', 'validateDelegationCheckpoint*', 'DelegationNamedUpstream*', 'workflowLaunchRunId*',
    'namedAgentsOf*', 'DelegationActivityCandidate*', 'DelegationBashCallFact*', 'maxInstant', 'minInstant', 'DueEntry',
    'dueLess', 'duePush', 'duePop', 'bashListingOf*', 'delegationRecordNaming*', 'sessionKeyOf', 'cursorKeyOf',
    'intervalKeyOf', 'byCodeUnits', 'sortedBy', 'sortedMap', 'mergeDelegationObservationInterval*', 'leaseRowOfEntry',
    'DelegationMetaOpenResult*', 'DelegationWorkflowLaunchFact', 'sameActivity', 'DelegationCheckpointBuilder*',
  ],
  // Task 3: the applier, the file side of recovery and the words block (26)
  durability: [
    'recoverDelegationFromFiles*', 'DELEGATION_DURABILITY_EDGES*', 'DELEGATION_COMPACTION_EDGES*',
    'DelegationDurabilityEdge*', 'DelegationCompactionOutcome*', 'DelegationUpkeepRequest*', 'DelegationUpkeepOutcome*',
    'DelegationDurabilityDeps*', 'DelegationDurabilityFailure*', 'DelegationDurableBatch*', 'DelegationApplyOutcome*',
    'DelegationLeaseRefusalReason*', 'DelegationLeaseOutcome*', 'DelegationLeaseTransitionRequest*',
    'DelegationLeaseReleaseRequest*', 'DelegationLeaseActOutcome*', 'DelegationMetaOutcome*',
    'DelegationCheckpointChange*', 'nowInstant', 'DelegationDurability*', 'DELEGATION_CHECKPOINT_ERROR_CODES',
    'DELEGATION_OWN_FAILURE_CODES', 'DELEGATION_LEASE_REFUSAL_REASONS', 'DELEGATION_META_OPEN_KINDS',
    'DELEGATION_FAILURE_PHASES', 'isDelegationCheckpointKebab*',
  ],
  // Task 4: the SQLite projection port and its repair (8)
  dbProjection: [
    'DelegationProjectionPort*', 'DelegationProjectionRepairReport*', 'DELEGATION_REPAIR_FULL_MS*', 'yieldToEventLoop',
    'DELEGATION_EVENTS_DELETE_CHUNK*', 'deleteEventsInGaps', 'checkpointWithoutSessions', 'repairDelegationProjection*',
  ],
  // Task 5: recovery (11)
  recovery: [
    'DELEGATION_RECOVERY_PHASES*', 'DelegationRecoveryPhaseName*', 'DelegationRecoveryFailure*',
    'DelegationOwnFailureCode*', 'DelegationEvidenceCounts*', 'DelegationEvidenceIndex*', 'DelegationRecoveryFacts*',
    'DelegationRecoveryReport*', 'DelegationRecovery*', 'recoverDelegation*', 'recoverDelegationState*',
  ],
};
const ALL = Object.values(NAMES).flat();
const nameOf = (n: string): string => n.replace(/\*$/, '');

/** Whether `file`'s top-level statements export `name`: by the declaration's own `export`, or a local `export { … }`. */
function exportsName(file: string, name: string): boolean {
  const sf = ts.createSourceFile(file, readFileSync(path.join(REPO_ROOT, file), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  for (const s of sf.statements) {
    if (ts.isExportDeclaration(s) && s.moduleSpecifier === undefined && s.exportClause && ts.isNamedExports(s.exportClause)) {
      if (s.exportClause.elements.some((e) => (e.propertyName ?? e.name).text === name)) return true;
      continue;
    }
    const exported = ts.canHaveModifiers(s) && (ts.getModifiers(s) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (!exported) continue;
    if (ts.isVariableStatement(s)) {
      if (s.declarationList.declarations.some((d) => ts.isIdentifier(d.name) && d.name.text === name)) return true;
    } else if ((ts.isFunctionDeclaration(s) || ts.isClassDeclaration(s) || ts.isInterfaceDeclaration(s)
      || ts.isTypeAliasDeclaration(s) || ts.isEnumDeclaration(s)) && s.name?.text === name) {
      return true;
    }
  }
  return false;
}

describe('the program view (D-8641)', () => {
  it('has one row, the pilot: delegation-checkpoint.ts and its three destinations, in the plan\'s order', () => {
    expect(PROGRAM_VIEWS).toEqual({ [SRC]: DESTS });
    expect(programMembers(SRC)).toEqual([SRC, ...DESTS]);
    expect(() => programMembers('server/src/coord/store.ts'), 'a source with no row').toThrow(/no program view/);
  });

  it('reads the members that exist, in row order; with no destination yet, the program is the file', () => {
    const existing = programMembers(SRC).filter((f) => existsSync(path.join(REPO_ROOT, f)));
    expect(programFiles(SRC)).toEqual(existing);
    expect(programTexts(SRC).map((t) => t.file)).toEqual(existing);
    for (const t of programTexts(SRC)) expect(t.text).toBe(readFileSync(path.join(REPO_ROOT, t.file), 'utf8'));
    if (existing.length === 1) {
      expect(programFiles(SRC)).toEqual([SRC]);
      expect(programSource(SRC)).toBe(readFileSync(path.join(REPO_ROOT, SRC), 'utf8'));
    }
  });

  it('declaringFile names the one member that declares a name, and throws for none', () => {
    expect(programMembers(SRC)).toContain(declaringFile(SRC, 'DelegationDurability'));
    expect(() => declaringFile(SRC, 'nope')).toThrow(/0 members declare nope/);
  });

  it('CONTROL (fixture): the joined text ends each member in exactly one LF, and a name declared twice throws', () => {
    const root = mkTmp('program-view-');
    const put = (rel: string, text: string): void => {
      mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      writeFileSync(path.join(root, rel), text);
    };
    put(SRC, 'export const a = 1;');                         // no final LF
    put(DESTS[1]!, 'export function b(): void {}\n\n\n');    // three
    expect(programFiles(SRC, root), 'the destinations that exist, in row order').toEqual([SRC, DESTS[1]]);
    expect(programSource(SRC, root)).toBe('export const a = 1;\nexport function b(): void {}\n');
    expect(declaringFile(SRC, 'b', root)).toBe(DESTS[1]);
    for (const decl of ['const b = 2;', 'function b() {}', 'class b {}', 'interface b {}', 'type b = 1;', 'enum b { x }']) {
      put(DESTS[0]!, `${decl}\n`);
      expect(() => declaringFile(SRC, 'b', root), decl).toThrow(/2 members declare b/);
    }
    put(DESTS[0]!, 'function c() { const b = 1; return b; }\n');
    expect(declaringFile(SRC, 'b', root), 'a nested binding is not a top-level declaration').toBe(DESTS[1]);
  });

  it('the characterization: each of the 104 names has exactly one home in the program, and each of the 58 exported stays exported there', () => {
    expect(ALL).toHaveLength(104);
    expect(new Set(ALL.map(nameOf)).size).toBe(104);
    expect(ALL.filter((n) => n.endsWith('*'))).toHaveLength(58);
    const members = programMembers(SRC);
    const homeless: string[] = [];
    const unexported: string[] = [];
    for (const n of ALL) {
      let home: string;
      try { home = declaringFile(SRC, nameOf(n)); } catch (e) { homeless.push(`${n}: ${(e as Error).message}`); continue; }
      expect(members).toContain(home);
      if (n.endsWith('*') && !exportsName(home, nameOf(n))) unexported.push(`${nameOf(n)} (${home})`);
    }
    expect(homeless, 'a name with no home, or two').toEqual([]);
    expect(unexported, 'an exported name its home no longer exports').toEqual([]);
  });

  // Step 7 (ARCH-06's row for the file is gone): the reads through the view may only shrink. KNOWN WIDTH: this counts the
  // reads, not the pins on them, so a new literal pin on an existing read is not counted; the pure-move review checks it.
  it('the reads through the view may only shrink: programSource( and programTexts( call sites under server/test', () => {
    const testRoot = path.join(REPO_ROOT, 'server', 'test');
    const skip = new Set(['scan/programView.ts', 'program-view.test.ts']);
    const sites: string[] = [];
    const walk = (d: string): void => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p); continue; }
        const rel = path.relative(testRoot, p).split(path.sep).join('/');
        if (!/\.ts$/.test(e.name) || skip.has(rel)) continue;
        for (const m of readFileSync(p, 'utf8').matchAll(/\bprogram(?:Source|Texts)\(/g)) sites.push(`${rel} ${m[0]}`);
      }
    };
    walk(testRoot);
    expect(sites.length, `the call sites (lower this when a read leaves): ${sites.join(', ')}`).toBe(READS);
  });
});

/** The call sites this PR measures. Lower it when a read leaves; a new region to pin goes onto `scan/symbols.ts`. */
const READS = 7;
