// Overlord W1, journal kernel plan Task 4: the kinds census. Every chained journal uses ONE envelope and ONE pair of preimages,
// with no domain tag; a record's kind lives in `entry.kind`. So a record of one journal verifies in another exactly when the other's
// grammar accepts its entry. This census holds that from happening: the registered formats' `kinds` are pairwise disjoint, each
// grammar refuses every other format's kinds (as its own refusal class, and for the kind), and every format under server/src is
// registered: one declared as a `ChainedJournalFormat` or `satisfies` one, and one passed to a kernel export, or to the shared file adapter's `chainedJournalFileAt`, that takes a format.
import { describe, expect, it } from 'vitest';
import type { ChainedJournalFormat, ChainedRefusal } from '../src/chainedJournal.js';
import { DELEGATION_JOURNAL_FORMAT } from '../src/coord/delegation-journal.js';
import { PRIVACY_JOURNAL_FORMAT } from '../src/operatorModel/privacyJournal.js';
import { PROBE_JOURNAL_FORMAT, ProbeJournalError, ProbeJsonError } from './sim/chainedJournalSets.js';
import { walkSrc } from './rings/walkSrc.js';
import { parsedFile } from './scan/symbols.js';
import { parseSource, ts, type ParsedFile } from './scan/parse.js';

type AnyFormat = ChainedJournalFormat<unknown, ChainedRefusal>;

interface Registered {
  format: AnyFormat;
  /** `file#binding` of a production format; null for a fixture, which is not under server/src. */
  binding: string | null;
  /** One well-formed entry of this format, which its grammar accepts: the kinds check swaps only its `kind`. */
  sample: Record<string, unknown>;
}

/** Each chained-journal format, by name. A later journal's piece adds its own row here, with its binding and a sample entry. */
const FORMATS: Record<string, Registered> = {
  delegation: {
    format: DELEGATION_JOURNAL_FORMAT,
    binding: 'server/src/coord/delegation-journal.ts#DELEGATION_JOURNAL_FORMAT',
    sample: { kind: 'lease-carrier-seen', leaseId: 'lease-1', generation: 1, at: '2026-11-14T10:00:00.000Z' },
  },
  // Overlord W1 private store A: the privacy journal, bound through the shared file adapter by the store's open.
  privacy: {
    format: PRIVACY_JOURNAL_FORMAT,
    binding: 'server/src/operatorModel/privacyJournal.ts#PRIVACY_JOURNAL_FORMAT',
    sample: { kind: 'privacy-message-issued', id: 1, at: 1_800_000_000_000 },
  },
  probe: { format: PROBE_JOURNAL_FORMAT, binding: null, sample: { kind: 'probe', n: 1 } },
};

const KERNEL = 'server/src/chainedJournal.ts';
/** The shared file adapter (authority journal A0): a journal binds it with its format, so its format-taking exports are takers too. */
const FILE_ADAPTER = 'server/src/chainedJournalFile.ts';
const FORMAT_TYPE = 'ChainedJournalFormat';

/** Every `file#name` of a binding in the given files whose declared type names `ChainedJournalFormat`, or whose initialiser
 *  `satisfies` it. A binding has no type field, so this reads the declaration's own text, from the binding's start to where its
 *  initialiser begins, and the initialiser's text for a `satisfies`. Pure over parsed files. */
function declaredFormats(files: ReadonlyArray<{ file: string; parsed: ParsedFile }>): string[] {
  const annotated = new RegExp(`:\\s*${FORMAT_TYPE}\\b`);
  const satisfies = new RegExp(`\\bsatisfies\\s+${FORMAT_TYPE}\\b`);
  const out: string[] = [];
  for (const { file, parsed } of files) {
    for (const b of parsed.bindings) {
      if (annotated.test(parsed.text.slice(b.start, b.initStart)) || satisfies.test(b.init)) out.push(`${file}#${b.name}`);
    }
  }
  return [...new Set(out)].sort();
}

/** The kernel's exports whose first parameter is a format: each exported function's, and each exported class's constructor's,
 *  where the parameter's type is `ChainedJournalFormat` or one of the kernel's own aliases of it. Read from the kernel's
 *  declarations, so an export added later is seen. Pure over the parsed kernel. */
function formatTakingExports(kernel: ParsedFile): string[] {
  const sf = ts.createSourceFile(kernel.path, kernel.text, ts.ScriptTarget.Latest, true);
  const formatTypes = new Set([FORMAT_TYPE]);
  for (const st of sf.statements) {
    if (ts.isTypeAliasDeclaration(st) && ts.isTypeReferenceNode(st.type) && st.type.typeName.getText(sf) === FORMAT_TYPE) {
      formatTypes.add(st.name.text);
    }
  }
  const takesFormat = (params: ts.NodeArray<ts.ParameterDeclaration>): boolean => {
    const t = params[0]?.type;
    return t !== undefined && ts.isTypeReferenceNode(t) && formatTypes.has(t.typeName.getText(sf));
  };
  const exported = (n: ts.Node): boolean =>
    ts.canHaveModifiers(n) && (ts.getModifiers(n) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
  const out: string[] = [];
  for (const st of sf.statements) {
    if (!exported(st)) continue;
    if (ts.isFunctionDeclaration(st) && st.name && takesFormat(st.parameters)) out.push(st.name.text);
    if (ts.isClassDeclaration(st) && st.name && st.members.some((m) => ts.isConstructorDeclaration(m) && takesFormat(m.parameters))) {
      out.push(st.name.text);
    }
  }
  return out.sort();
}

/** Every `file#name` of a binding passed as the first argument to one of `takers` (a call, a `new`, or a namespace member
 *  such as `kernel.decodeChainedLine`), however it is declared: an unannotated `const F = makeFormat(…)` is found by its use.
 *  A parameter or any other name with no `const|let|var` behind it is not a binding, and is left out. Pure over parsed files. */
function passedFormats(files: ReadonlyArray<{ file: string; parsed: ParsedFile }>, takers: readonly string[]): string[] {
  const wanted = new Set(takers);
  const out: string[] = [];
  for (const { file, parsed } of files) {
    const sf = ts.createSourceFile(file, parsed.text, ts.ScriptTarget.Latest, true);
    const calleeName = (e: ts.Expression): string | null =>
      ts.isIdentifier(e) ? e.text : ts.isPropertyAccessExpression(e) ? e.name.text : null;
    const visit = (n: ts.Node): void => {
      if (ts.isCallExpression(n) || ts.isNewExpression(n)) {
        const name = calleeName(n.expression);
        const first = n.arguments?.[0];
        if (name !== null && wanted.has(name) && first !== undefined && ts.isIdentifier(first)) {
          const at = first.getStart(sf);
          const holders = parsed.bindings.filter((b) => b.name === first.text && b.scopeStart <= at && at < b.scopeEnd);
          const innermost = holders.sort((x, y) => (y.scopeStart - x.scopeStart) || (x.scopeEnd - y.scopeEnd))[0];
          if (innermost !== undefined) out.push(`${file}#${innermost.name}`);
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return [...new Set(out)].sort();
}

/** The discovered bindings no registry row names. */
const unregistered = (declared: readonly string[], registry: Record<string, Registered>): string[] => {
  const known = new Set(Object.values(registry).map((r) => r.binding));
  return declared.filter((d) => !known.has(d));
};

const refusalClassOf = (f: AnyFormat): Function => f.fail('bad-field', 'probe').constructor;

/** Every way a registered grammar fails to refuse another format's kind ON THE KIND: for each pair, the grammar is fed its OWN
 *  well-formed sample with only `kind` swapped to each of the other's kinds, so the kind is the only thing wrong with it. A pair
 *  is reported when the grammar accepts it, throws another class, or refuses with a message that does not name the kind (a
 *  refusal for some other reason). A sample its own grammar refuses is reported too, since it would prove nothing. Pure. */
function kindLeaks(registry: Record<string, Registered>): { leaks: string[]; pairs: number } {
  const leaks: string[] = [];
  let pairs = 0;
  const names = Object.keys(registry);
  for (const a of names) {
    const A = registry[a]!;
    try { A.format.entry(A.sample); } catch (e) { leaks.push(`${a}'s own sample is refused: ${(e as Error).message}`); continue; }
    const own = refusalClassOf(A.format);
    for (const b of names) {
      if (a === b) continue;
      for (const k of registry[b]!.format.kinds) {
        pairs++;
        let err: unknown = null;
        try { A.format.entry({ ...A.sample, kind: k }); } catch (e) { err = e; }
        if (err === null) leaks.push(`${a} accepts ${b}'s kind ${k}`);
        else if (!(err instanceof own)) leaks.push(`${a} refuses ${b}'s kind ${k} as another class`);
        else if (!(err as Error).message.includes(JSON.stringify(k))) leaks.push(`${a} refuses ${b}'s kind ${k} for another reason: ${(err as Error).message}`);
      }
    }
  }
  return { leaks, pairs };
}

describe('the kinds census', () => {
  const names = Object.keys(FORMATS);

  it('registers the delegation format, the privacy journal\'s and the fixture format', () => {
    expect(names.sort()).toEqual(['delegation', 'privacy', 'probe']);
    for (const n of names) expect(FORMATS[n]!.format.kinds.length, n).toBeGreaterThan(0);
  });

  it('the kinds tables are pairwise disjoint', () => {
    for (const a of names) for (const b of names) {
      if (a >= b) continue;
      const shared = FORMATS[a]!.format.kinds.filter((k) => FORMATS[b]!.format.kinds.includes(k));
      expect(shared, `${a} and ${b}`).toEqual([]);
    }
  });

  it('every format refuses every other format\'s kinds, as its own refusal class and for the kind: its own well-formed entry with only kind swapped', () => {
    const { leaks, pairs } = kindLeaks(FORMATS);
    expect(leaks).toEqual([]);
    expect(pairs).toBeGreaterThanOrEqual(names.length * (names.length - 1));
  });

  it('FIXTURE: a grammar that takes another kind, refuses it for another reason or as another class, or refuses its own sample, is reported', () => {
    const fixture = (entry: (raw: Record<string, unknown>) => unknown): AnyFormat => ({
      kinds: ['lax'],
      entry: (raw) => entry(raw as Record<string, unknown>),
      fail: (code, detail, where) => new ProbeJournalError(code, detail, where),
      jsonError: (detail) => new ProbeJsonError(detail),
    });
    const probe = FORMATS.probe!;
    const one = (format: AnyFormat, sample: Record<string, unknown>): string[] =>
      kindLeaks({ probe, x: { format, binding: null, sample } }).leaks;
    // Checks its field, then takes any kind: the old row fed `{ kind }` alone, so a missing field hid this.
    const fieldThenAnyKind = fixture((o) => { if (o['m'] !== 1) throw new ProbeJournalError('bad-field', 'a lax entry is missing "m"'); return o; });
    expect(one(fieldThenAnyKind, { kind: 'lax', m: 1 })).toEqual(['x accepts probe\'s kind probe']);
    const vague = fixture((o) => { if (o['kind'] !== 'lax') throw new ProbeJournalError('bad-field', 'a lax entry is wrong'); return o; });
    expect(one(vague, { kind: 'lax' })).toEqual(['x refuses probe\'s kind probe for another reason: probe journal bad-field: a lax entry is wrong']);
    const foreign = fixture((o) => { if (o['kind'] !== 'lax') throw new Error(`kind ${JSON.stringify(o['kind'])}`); return o; });
    expect(one(foreign, { kind: 'lax' })).toEqual(['x refuses probe\'s kind probe as another class']);
    expect(one(fieldThenAnyKind, { kind: 'lax' })).toEqual(['x\'s own sample is refused: probe journal bad-field: a lax entry is missing "m"']);
    const strict = fixture((o) => { if (o['kind'] !== 'lax') throw new ProbeJournalError('bad-field', `kind ${JSON.stringify(o['kind'])} is not lax`); return o; });
    expect(one(strict, { kind: 'lax' })).toEqual([]);
  });

  it('the refusal classes of two formats are not the same class', () => {
    const classes = names.map((n) => refusalClassOf(FORMATS[n]!.format));
    expect(new Set(classes).size).toBe(classes.length);
  });
});

describe('discovery: every format under server/src is registered, and every registered production format is found', () => {
  const real = walkSrc({ roots: ['server/src'], min: 100 }).map((file) => ({ file, parsed: parsedFile(file) }));
  const takers = [...new Set([KERNEL, FILE_ADAPTER].flatMap((f) => formatTakingExports(parsedFile(f))))].sort();
  const declared = declaredFormats(real);
  const passed = passedFormats(real, takers);
  const found = [...new Set([...declared, ...passed])].sort();

  it('the kernel\'s format-taking exports are read from its declarations', () => {
    expect(takers).toEqual(expect.arrayContaining(['ChainVerifier', 'buildChainedRecord', 'decodeChainedLine', 'encodeChainedRecord', 'verifyChainedBytes']));
    // the file adapter's binding call is a taker: a format passed only to it, unannotated, is still found
    expect(takers).toContain('chainedJournalFileAt');
    expect(takers).not.toContain('chainedTailHealPlan');
    expect(takers).not.toContain('findJsonDefect');
  });

  it('every binding declared as a ChainedJournalFormat, satisfying one, or passed to the kernel as one is registered', () => {
    expect(declared.length).toBeGreaterThan(0);
    expect(passed.length).toBeGreaterThan(0);
    expect(unregistered(found, FORMATS)).toEqual([]);
  });

  it('every registered production format is such a binding', () => {
    const production = Object.values(FORMATS).map((r) => r.binding).filter((b): b is string => b !== null);
    expect(production.filter((b) => !found.includes(b))).toEqual([]);
  });

  it('FIXTURE: a planted binding is seen, and reported when it is not registered', () => {
    const planted = parseSource([
      "import type { ChainedJournalFormat } from '../chainedJournal.js';",
      '// const NOT_CODE: ChainedJournalFormat<A, B> = x;',
      'export const NEXT_JOURNAL_FORMAT: ChainedJournalFormat<Entry, Refusal> = { kinds: [] } as never;',
      'export const OTHER: Readonly<{ a: 1 }> = { a: 1 };',
    ].join('\n'), 'server/src/next/next-journal.ts');
    const seen = declaredFormats([{ file: 'server/src/next/next-journal.ts', parsed: planted }]);
    expect(seen).toEqual(['server/src/next/next-journal.ts#NEXT_JOURNAL_FORMAT']);
    expect(unregistered(seen, FORMATS)).toEqual(seen);
    const withRow = { ...FORMATS, next: { format: PROBE_JOURNAL_FORMAT, binding: seen[0]!, sample: { kind: 'probe', n: 1 } } };
    expect(unregistered(seen, withRow)).toEqual([]);
  });

  it('FIXTURE: a binding that satisfies ChainedJournalFormat is seen', () => {
    const planted = parseSource([
      "import type { ChainedJournalFormat } from '../chainedJournal.js';",
      'export const SAT_FORMAT = { kinds: [] } as unknown satisfies ChainedJournalFormat<Entry, Refusal>;',
      'export const PLAIN = { kinds: [] };',
    ].join('\n'), 'server/src/next/sat-journal.ts');
    expect(declaredFormats([{ file: 'server/src/next/sat-journal.ts', parsed: planted }])).toEqual(['server/src/next/sat-journal.ts#SAT_FORMAT']);
  });

  it('FIXTURE: an unannotated binding passed to a format-taking export is seen, by call, by new, by namespace member and by the file adapter', () => {
    const planted = parseSource([
      "import * as kernel from '../chainedJournal.js';",
      "import { ChainVerifier, decodeChainedLine } from '../chainedJournal.js';",
      "import { chainedJournalFileAt } from '../chainedJournalFile.js';",
      'const CALLED = makeFormat();',
      'const NEWED = makeFormat();',
      'const MEMBER = makeFormat();',
      'const BOUND = makeFormat();',
      'const UNUSED = makeFormat();',
      'const NOT_A_TAKER = makeFormat();',
      'export const a = decodeChainedLine(CALLED, new Uint8Array(0));',
      'export const b = new ChainVerifier(NEWED);',
      'export const c = kernel.encodeChainedRecord(MEMBER, record);',
      "export const e = chainedJournalFileAt(BOUND, dir, 'next.jsonl');",
      'export const d = kernel.chainedTailHealPlan(NOT_A_TAKER, true);',
      'export function viaParameter(fmt: unknown): unknown { return decodeChainedLine(fmt, new Uint8Array(0)); }',
    ].join('\n'), 'server/src/next/passed-journal.ts');
    expect(passedFormats([{ file: 'server/src/next/passed-journal.ts', parsed: planted }], takers)).toEqual([
      'server/src/next/passed-journal.ts#BOUND', 'server/src/next/passed-journal.ts#CALLED', 'server/src/next/passed-journal.ts#MEMBER',
      'server/src/next/passed-journal.ts#NEWED',
    ]);
  });
});
