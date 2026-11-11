// D-7669, D-7682 R7 (#1444, spec §5.4, §6.4, §14's single-definition census; Linear central key plan task LK8). The
// operation table has one home: `LINEAR_OPS`, the verb list and every GraphQL document the key can run are declared
// once, in `linear/ops.ts`, and no other source holds a mutation or a document of its own (the one other document, the
// key check's, is `client.ts`'s, held by `linear-refresher.test.ts`). The provenance line's bytes are written once. The
// directory is declared once, in `linear/directory.ts`, and constructed by the one refresher alone, its only writer.
// Test files are not sources here.
import { describe, it, expect } from 'vitest';
import { ALL, rel, stallCode } from './helpers.js';

describe('the Linear operation table has one home (D-7669)', () => {
  const holders = (re: RegExp): string[] => ALL.filter((f) => re.test(stallCode(f))).map(rel).sort();
  const decl = (c: string): RegExp => new RegExp(`\\b(?:const|let|var|function|class)\\s+${c}\\b|\\btype\\s+${c}\\s*=|\\binterface\\s+${c}\\b`);

  it('CONTROL: the patterns see a declaration, a mutation and the line, and pass over a use', () => {
    expect(decl('LINEAR_OPS').test('export const LINEAR_OPS = Object.freeze({')).toBe(true);
    expect(decl('LINEAR_OPS').test('const row = LINEAR_OPS[op];')).toBe(false);
    expect(/\b(?:issueCreate|issueUpdate|commentCreate)\(/.test('mutation X { issueCreate(input: $input) { success } }')).toBe(true);
    expect(/written by a ccrc fleet session/.test("'— written by a ccrc fleet session'")).toBe(true);
  });

  it('the table, the verb list, the documents, the provenance line and the strip column are declared once, in linear/ops.ts', () => {
    for (const c of ['LINEAR_OPS', 'LINEAR_VERBS', 'LinearVerb', 'LINEAR_DOCUMENTS', 'LINEAR_DIRECTORY_DOCUMENTS',
      'LINEAR_PROVENANCE_LINE', 'LINEAR_STRIPS', 'LINEAR_ERROR_CODES', 'validateLinearCall', 'lookupLinearName', 'linearOutbound']) {
      expect(holders(decl(c)), c).toEqual(['server/src/linear/ops.ts']);
    }
  });

  it('a mutation is written in linear/ops.ts and nowhere else in the sources', () => {
    expect(holders(/\b(?:issueCreate|issueUpdate|commentCreate)\(/)).toEqual(['server/src/linear/ops.ts']);
    expect(holders(/['`]mutation\s/)).toEqual(['server/src/linear/ops.ts']);
  });

  it('the provenance line\'s words are written once', () => {
    expect(holders(/written by a ccrc fleet session/)).toEqual(['server/src/linear/ops.ts']);
  });

  it('the directory is declared once, and constructed by the refresher alone', () => {
    for (const c of ['LinearDirectory', 'LinearDirectoryRead']) {
      expect(holders(decl(c)), c).toEqual(['server/src/linear/directory.ts']);
    }
    expect(holders(/\bnew LinearDirectory\(/)).toEqual(['server/src/linear/refresher.ts']);
    expect(holders(decl('LINEAR_DIRECTORY_REFRESH_MS'))).toEqual(['server/src/linear/refresher.ts']);
  });

  // D-8180 (Linear hierarchy plan, Global Constraints: a row for each new list). The hierarchy documents, the ccrc
  // provenance line and the shared grammars in linear/ops.ts; the ccrc operation table and its journal-op list in
  // linear/hierarchyOps.ts, which holds no GraphQL and no grammar of its own.
  it('the hierarchy documents, the ccrc provenance line and the grammars are declared once, in linear/ops.ts', () => {
    for (const c of ['LINEAR_HIERARCHY_DOCUMENTS', 'LINEAR_CCRC_PROVENANCE_LINE', 'LINEAR_IDENTIFIER_SHAPE', 'isLinearIdentifier',
      'LINEAR_STATE_TYPE_SHAPE', 'isLinearStateType', 'statusOfType', 'readLinearProjectStatusesPage']) {
      expect(holders(decl(c)), c).toEqual(['server/src/linear/ops.ts']);
    }
  });

  it('the ccrc operation table and its journal-op list are declared once, in linear/hierarchyOps.ts', () => {
    for (const c of ['LINEAR_CCRC_OPS', 'LINEAR_CCRC_JOURNAL_OPS', 'LinearCcrcJournalOp', 'CcrcOpName', 'CcrcOpRow', 'CcrcOpInput',
      'CcrcShaped', 'withCcrcProvenance', 'readInitiativesProbe']) {
      expect(holders(decl(c)), c).toEqual(['server/src/linear/hierarchyOps.ts']);
    }
  });

  it("the ccrc provenance line's words are written once", () => {
    expect(holders(/kept by ccrc from its plan/)).toEqual(['server/src/linear/ops.ts']);
  });

  it('the identifier, team-key and status-type grammars are each spelled once', () => {
    // CONTROL: the patterns see the grammar's text.
    expect(/-\[0-9\]\{1,9\}\$/.test('/^[A-Za-z][A-Za-z0-9_]{0,15}-[0-9]{1,9}$/')).toBe(true);
    expect(/\[A-Za-z0-9_?\]\{0,15\}\$|\[A-Z0-9_?\]\{0,15\}\$/.test('/^[A-Za-z][A-Za-z0-9]{0,15}$/')).toBe(true);
    expect(/\[a-z_?\]\{1,32\}/.test('/^[a-z]{1,32}$/')).toBe(true);
    expect(holders(/-\[0-9\]\{1,9\}\$/)).toEqual(['server/src/linear/ops.ts']);
    expect(holders(/\[A-Za-z0-9_?\]\{0,15\}\$|\[A-Z0-9_?\]\{0,15\}\$/)).toEqual(['shared/linear.ts']);
    expect(holders(/\[a-z_?\]\{1,32\}/)).toEqual(['server/src/linear/ops.ts']);
  });
});
