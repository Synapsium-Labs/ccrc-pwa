// D-8636 (plan docs/superpowers/plans/2026-11-14-large-file-step0-split-tool.md; spec
// docs/superpowers/specs/2026-11-13-large-file-programme-design.md §2 items 2 and 4, §4 "Parallelism", D-8615).
// The pure-move pin of the TypeScript and `.mjs` slice tool. FIXTURE rows judge the library (`fileSplit.ts`) on
// small trees; the end-to-end rows run `.github/ci/file-split.mjs` in a fixture git repository (git environment
// scrubbed, so nothing writes into this checkout); the REAL row judges this branch's own diff against `moveBase`:
// a pull request that moves a declaration must be a pure move, and one that moves none answers null.
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp } from './tmpHelpers.js';
import { isGitRedirectVar } from './scrub-git-env.mjs';
import { spawnSyncGroup } from './spawnGroup.js';
import { SPEC_FILE, readContextTable } from './rings/ringContextMap.js';
import {
  contextOf, duplicateDefinitions, mjsNamespace, moveBase, parseHunks, planMove, preflightVerdict, pureMoveVerdict,
  touchedDeclarations, branchVerdict, type Tree,
} from './fileSplit.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TOOL = path.join(REPO, '.github', 'ci', 'file-split.mjs');

const LIB = `export type Shape = 'round' | 'square';
export const helper = (n: number): string => String(n);
`;

const A = `/** The fixture's source file. */
import path from 'node:path';
import { helper, type Shape } from './lib.js';

/** The limit. */
export const LIMIT = 3;

function privateHelper(x: number): number { return x + LIMIT; }

/** A box. */
export interface Box { shape: Shape; size: number }

// A class that moves.
export class Mover {
  run(b: Box): string { return path.join(helper(b.size), String(privateHelper(b.size))); }
}

export function stays(): number { return LIMIT; }
`;

const USER = `import { Mover, stays, type Box } from './a.js';
export const go = (b: Box): string => new Mover().run(b) + String(stays());
`;

const base = (): Tree => new Map([['src/a.ts', A], ['src/lib.ts', LIB], ['src/user.ts', USER]]);
const req = { source: 'src/a.ts', dest: 'src/b.ts', names: ['Box', 'Mover'] };

/** The move of `Box` and `Mover`, as the tool writes it. */
const moved = (): Map<string, string> => {
  const plan = planMove(req, base());
  expect(plan.problems).toEqual([]);
  return plan.files;
};
/** The changed files of a move on both sides, for the verdict. */
const sides = (head: ReadonlyMap<string, string>): { b: Map<string, string>; h: Map<string, string> } => {
  const b = new Map<string, string>();
  const h = new Map<string, string>();
  for (const [f, t] of head) { const was = base().get(f); if (was !== undefined) b.set(f, was); h.set(f, t); }
  return { b, h };
};
const edit = (files: Map<string, string>, file: string, from: string, to: string): Map<string, string> => {
  const t = files.get(file)!;
  expect(t.includes(from), `${file} holds ${from}`).toBe(true);
  return new Map([...files, [file, t.replace(from, to)]]);
};

describe('file-split: the move (D-8636)', () => {
  it('FIXTURE: moves the named declarations byte for byte, imports what they use, repoints the importer', () => {
    const files = moved();
    expect([...files.keys()].sort()).toEqual(['src/a.ts', 'src/b.ts', 'src/user.ts']);
    expect(files.get('src/b.ts')).toBe(`/** Moved out of \`src/a.ts\` by \`.github/ci/file-split.mjs\`: a pure move (D-8636). */

import path from 'node:path';
import { helper, type Shape } from './lib.js';
import { privateHelper } from './a.js';

/** A box. */
export interface Box { shape: Shape; size: number }

// A class that moves.
export class Mover {
  run(b: Box): string { return path.join(helper(b.size), String(privateHelper(b.size))); }
}
`);
    expect(files.get('src/a.ts')).toBe(`/** The fixture's source file. */

/** The limit. */
export const LIMIT = 3;

export function privateHelper(x: number): number { return x + LIMIT; }

export function stays(): number { return LIMIT; }
`);
    expect(files.get('src/user.ts')).toBe(`import { stays } from './a.js';
import { Mover, type Box } from './b.js';
export const go = (b: Box): string => new Mover().run(b) + String(stays());
`);
  });

  it('FIXTURE: the move\'s own output is a pure move, with the helper it had to export named', () => {
    const { b, h } = sides(moved());
    expect(pureMoveVerdict(b, h)).toEqual({
      pure: true, differing: [], newlyExported: ['src/a.ts#privateHelper'],
      moved: [{ name: 'Box', from: 'src/a.ts', to: 'src/b.ts' }, { name: 'Mover', from: 'src/a.ts', to: 'src/b.ts' }],
    });
  });

  it('FIXTURE: a type-only edge back to the destination is allowed and imported as a type', () => {
    const src = A.replace('export function stays(): number { return LIMIT; }',
      'export function stays(b?: Box): number { return b?.size ?? LIMIT; }');
    const plan = planMove(req, new Map([...base(), ['src/a.ts', src]]));
    expect(plan.problems).toEqual([]);
    expect(plan.files.get('src/a.ts')).toContain("import type { Box } from './b.js';");
  });

  it('FIXTURE: value references across the cut both ways are refused as a cycle', () => {
    const src = A.replace('export function stays(): number { return LIMIT; }',
      'export function stays(): number { return new Mover() ? LIMIT : 0; }');
    const plan = planMove(req, new Map([...base(), ['src/a.ts', src]]));
    expect(plan.problems).toEqual(['cycle: the destination uses privateHelper from the source, and the source uses Mover from the destination']);
    expect(plan.files.size).toBe(0);
  });

  it('FIXTURE: a statement that declares a name not asked for, a default export and a missing name are refused', () => {
    const tree = new Map([['src/v.ts', 'export const a = 1, b = 2;\nexport default function main(): void {}\n']]);
    expect(planMove({ source: 'src/v.ts', dest: 'src/w.ts', names: ['a'] }, tree).problems)
      .toEqual(['a: its statement also declares b; name every one']);
    expect(planMove({ source: 'src/v.ts', dest: 'src/w.ts', names: ['main'] }, tree).problems)
      .toEqual(['main: a default export does not move']);
    expect(planMove({ source: 'src/v.ts', dest: 'src/w.ts', names: ['nope'] }, tree).problems)
      .toEqual(['nope: not a top-level declaration of src/v.ts']);
  });

  it('FIXTURE: a namespace import that uses a moved name is refused', () => {
    const tree = new Map([...base(), ['src/ns.ts', "import * as a from './a.js';\nexport const m = new a.Mover();\n"]]);
    expect(planMove(req, tree).problems).toEqual(['src/ns.ts: a namespace import of src/a.ts uses Mover; repoint it by hand first']);
  });

  it('FIXTURE: an existing destination gets the regions appended, and a name it already binds is refused', () => {
    const dest = "import { helper } from './lib.js';\n\nexport const OTHER = helper(1);\n";
    const plan = planMove(req, new Map([...base(), ['src/b.ts', dest]]));
    expect(plan.problems).toEqual([]);
    const out = plan.files.get('src/b.ts')!;
    expect(out.startsWith("import { helper } from './lib.js';\nimport path from 'node:path';\nimport { type Shape } from './lib.js';\n"))
      .toBe(true);
    expect(out).toContain('export const OTHER = helper(1);\n\n/** A box. */\nexport interface Box');
    const { b, h } = sides(plan.files);
    b.set('src/b.ts', dest);
    expect(pureMoveVerdict(b, h)?.pure).toBe(true);
    const clash = planMove(req, new Map([...base(), ['src/b.ts', 'export const Mover = 1;\n']]));
    expect(clash.problems).toEqual(['Mover: src/b.ts already binds that name']);
  });

  it('FIXTURE: a mention of the source module outside an import is reported, not repointed', () => {
    const tree = new Map([...base(), ['src/t.test.ts', "vi.mock('./a.js');\n"]]);
    const plan = planMove(req, tree);
    expect(plan.mentions).toEqual(['src/t.test.ts:1']);
    expect(plan.files.has('src/t.test.ts')).toBe(false);
  });
});

describe('file-split: the pure-move verdict (D-8636)', () => {
  it('FIXTURE: a diff that moves no declaration is not judged', () => {
    const head = new Map([['src/a.ts', A.replace('return LIMIT;', 'return LIMIT + 1;')]]);
    expect(pureMoveVerdict(new Map([['src/a.ts', A]]), head)).toBeNull();
  });

  it('FIXTURE: an edited moved body is not pure', () => {
    const { b, h } = sides(edit(moved(), 'src/b.ts', 'String(privateHelper', 'String(1 + privateHelper'));
    expect(pureMoveVerdict(b, h)).toMatchObject({ pure: false, differing: ['text:Mover'] });
  });

  it('FIXTURE: a dropped lead comment is not pure', () => {
    const { b, h } = sides(edit(moved(), 'src/b.ts', '/** A box. */\n', ''));
    expect(pureMoveVerdict(b, h)).toMatchObject({ pure: false, differing: ['text:Box'] });
  });

  it('FIXTURE: an edit to a statement that stays is not pure', () => {
    const { b, h } = sides(edit(moved(), 'src/a.ts', 'return LIMIT;', 'return LIMIT * 2;'));
    expect(pureMoveVerdict(b, h)).toMatchObject({ pure: false, differing: ['rest:src/a.ts'] });
  });

  it('FIXTURE: a side-effect import is a statement, not an import line', () => {
    const { b, h } = sides(edit(moved(), 'src/a.ts', '/** The limit. */', "import './boot.js';\n/** The limit. */"));
    expect(pureMoveVerdict(b, h)).toMatchObject({ pure: false, differing: ['rest:src/a.ts'] });
  });

  it('FIXTURE: a rebase that keeps the old copy reds as a name defined twice', () => {
    const files = new Map([...moved(), ['src/a.ts', A]]);
    const { b, h } = sides(files);
    const v = pureMoveVerdict(b, h)!;
    expect(v.pure).toBe(false);
    expect(v.moved).toEqual([]);
    expect(v.differing).toEqual(expect.arrayContaining(['defined-twice:Box', 'defined-twice:Mover']));
    expect(duplicateDefinitions(new Map([['src/a.ts', A], ['src/b.ts', files.get('src/b.ts')!]]))).toEqual(['Box', 'Mover']);
    expect(duplicateDefinitions(moved())).toEqual([]);
  });

  it('FIXTURE: a moved declaration that loses its export changes the surface and strands its importer', () => {
    const { b, h } = sides(edit(moved(), 'src/b.ts', 'export class Mover', 'class Mover'));
    expect(pureMoveVerdict(b, h)).toMatchObject({
      pure: false, differing: ['surface:src/a.ts#Mover', 'unresolved:src/user.ts#Mover'] });
  });

  it('FIXTURE: an importer left pointing at the source is unresolved', () => {
    const { b, h } = sides(new Map([...moved(), ['src/user.ts', USER]]));
    expect(pureMoveVerdict(b, h)).toMatchObject({ pure: false, differing: ['unresolved:src/user.ts#Box', 'unresolved:src/user.ts#Mover'] });
  });

  it('FIXTURE: an importer outside the changed files is resolved too', () => {
    const { b, h } = sides(moved());
    const other: Tree = new Map([['src/other.ts', "import { Mover } from './a.js';\nexport const o = Mover;\n"]]);
    expect(pureMoveVerdict(b, h, other)).toMatchObject({ pure: false, differing: ['unresolved:src/other.ts#Mover'] });
  });

  it('FIXTURE: a name exported only now that nothing imports is not pure', () => {
    const { b, h } = sides(edit(moved(), 'src/a.ts', 'function stays', 'function stays2(): void {}\nexport function stays'));
    expect(pureMoveVerdict(b, h)?.pure).toBe(false);
    const { b: b2, h: h2 } = sides(edit(moved(), 'src/a.ts', 'export const LIMIT', 'const LIMIT'));
    expect(pureMoveVerdict(b2, h2)).toMatchObject({ pure: false, differing: ['surface:src/a.ts#LIMIT'] });
    const files = moved();
    const loose = edit(files, 'src/b.ts', "import { privateHelper } from './a.js';\n", '');
    const { b: b3, h: h3 } = sides(loose);
    expect(pureMoveVerdict(b3, h3)).toMatchObject({ pure: false, differing: ['export-unused:src/a.ts#privateHelper'] });
  });

  it('FIXTURE: .mjs modules compare by namespace keys and the text of each export', async () => {
    const dir = mkTmp('file-split-mjs-');
    const put = (rel: string, text: string): string => { const p = path.join(dir, rel); mkdirSync(path.dirname(p), { recursive: true }); writeFileSync(p, text); return p; };
    const before = put('base/a.mjs', 'export const K = 1;\nexport function f(x) { return x + K; }\nexport function g() { return 2; }\n');
    const plan = planMove({ source: 'a.mjs', dest: 'b.mjs', names: ['g'] }, new Map([['a.mjs', readFileSync(before, 'utf8')]]));
    expect(plan.problems).toEqual([]);
    const a = put('head/a.mjs', plan.files.get('a.mjs')!);
    const b = put('head/b.mjs', plan.files.get('b.mjs')!);
    const was = await mjsNamespace(before);
    const now = { ...(await mjsNamespace(a)), ...(await mjsNamespace(b)) };
    expect(now).toEqual(was);
    expect(Object.keys(was)).toEqual(['K', 'f', 'g']);
  });
});

describe('file-split: preflight (D-8636)', () => {
  it('FIXTURE: a -U0 diff gives the old side\'s ranges, an insertion as a zero count', () => {
    const diff = 'diff --git a/x b/x\n@@ -3,2 +3,4 @@ ctx\n-a\n+b\n@@ -9 +11 @@\n-c\n+d\n@@ -20,0 +23,2 @@\n+e\n';
    expect(parseHunks(diff)).toEqual([{ start: 3, count: 2 }, { start: 9, count: 1 }, { start: 20, count: 0 }]);
  });

  it('FIXTURE: a hunk touches the declaration whose region holds it, lead comment included', () => {
    const lines = A.split('\n');
    const line = (s: string): number => lines.findIndex((l) => l.includes(s)) + 1;
    expect(touchedDeclarations(A, 'src/a.ts', [{ start: line('path.join'), count: 1 }])).toEqual(['Mover']);
    expect(touchedDeclarations(A, 'src/a.ts', [{ start: line('A box.'), count: 1 }])).toEqual(['Box']);
    expect(touchedDeclarations(A, 'src/a.ts', [{ start: line('A class that moves'), count: 0 }])).toEqual(['Mover']);
    // An insertion after a declaration's last line, between two declarations, touches neither.
    expect(touchedDeclarations(A, 'src/a.ts', [{ start: line('export const LIMIT'), count: 0 }])).toEqual([]);
    expect(touchedDeclarations(A, 'src/a.ts', [{ start: 1, count: 0 }])).toEqual([]);
  });

  it('FIXTURE: a source file takes its context from the spec\'s table; a file no row reaches has none', () => {
    const rows = readContextTable();
    expect(contextOf(rows, 'server/src/coord/delegation-durability.ts')).toBe('C5');
    expect(contextOf(rows, 'server/src/coord/approvalThing.ts')).toBe('C6');
    expect(contextOf(rows, 'shared/api.ts')).toBeNull();
  });

  it('FIXTURE: refuses an unmapped destination, a second move of the file, a held slot and a touched declaration', () => {
    const ctx = (f: string): string | null => (f.startsWith('server/src/coord/') ? 'C5' : f.startsWith('server/src/auth/') ? 'C8' : null);
    const input = {
      source: 'server/src/coord/big.ts', dests: ['server/src/coord/part.ts'], names: ['A', 'B'], contextOf: ctx,
      heads: [
        { pr: 1, head: 'h1', move: { source: 'server/src/coord/store.ts', dests: ['server/src/coord/runsStore.ts'] } },
        { pr: 2, head: 'h2', move: { source: 'server/src/server.ts', dests: ['server/src/auth/routes.ts'] } },
        { pr: 3, head: 'h3', move: { source: 'server/src/coord/big.ts', dests: ['server/src/coord/other.ts'] } },
        { pr: 4, head: 'h4' },
      ],
      touched: new Map<number, readonly string[]>([[4, ['B', 'Z']], [2, []]]),
    };
    expect(preflightVerdict(input)).toEqual({
      ok: false, slots: ['C5'],
      refusals: ['slot-held C5 #1', 'file-has-open-move #3', 'touched #4 B'],
    });
    expect(preflightVerdict({ ...input, self: 3, heads: input.heads.filter((h) => h.pr === 2 || h.pr === 3) }))
      .toEqual({ ok: true, slots: ['C5'], refusals: [] });
    expect(preflightVerdict({ ...input, dests: ['shared/x.ts'], heads: [] }))
      .toEqual({ ok: false, slots: [], refusals: ['unmapped shared/x.ts'] });
  });
});

// ---- End to end: the script in a fixture git repository ----

const cleanEnv = (): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!isGitRedirectVar(k)) env[k] = v;
  return env;
};
const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', ['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', ...args],
    { cwd, encoding: 'utf8', env: cleanEnv(), stdio: 'pipe' });
const tool = (cwd: string, ...args: string[]): { status: number | null; out: string; err: string } => {
  const r = spawnSyncGroup(process.execPath, [TOOL, ...args, '--root', cwd], { cwd, encoding: 'utf8', env: cleanEnv(), timeout: 120_000 });
  return { status: r.status, out: r.stdout, err: r.stderr };
};

describe('file-split: the script, end to end (D-8636)', () => {
  it('FIXTURE: move writes a pure move, verdict says so, and preflight yields to an open PR in a moved declaration', () => {
    const dir = mkTmp('file-split-e2e-');
    const put = (rel: string, text: string): void => {
      mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      writeFileSync(path.join(dir, rel), text);
    };
    git(dir, 'init', '-q', '-b', 'main');
    put(SPEC_FILE, readFileSync(path.join(REPO, SPEC_FILE), 'utf8'));
    put('server/src/coord/a.ts', A);
    put('server/src/coord/lib.ts', LIB);
    put('server/src/coord/user.ts', USER);
    git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', 'base');
    const baseSha = git(dir, 'rev-parse', 'HEAD').trim();
    // Two open heads: one edits Mover's body, one edits `stays`.
    git(dir, 'checkout', '-q', '-b', 'pr-7');
    put('server/src/coord/a.ts', A.replace('String(privateHelper', 'String(2 * privateHelper'));
    git(dir, 'commit', '-q', '-am', 'feature in Mover');
    const h7 = git(dir, 'rev-parse', 'HEAD').trim();
    git(dir, 'checkout', '-q', '-b', 'pr-8', baseSha);
    put('server/src/coord/a.ts', A.replace('return LIMIT; }\n', 'return LIMIT + 0; }\n'));
    git(dir, 'commit', '-q', '-am', 'feature in stays');
    const h8 = git(dir, 'rev-parse', 'HEAD').trim();
    git(dir, 'checkout', '-q', 'main');

    const args = ['--source', 'server/src/coord/a.ts', '--dest', 'server/src/coord/b.ts', '--names', 'Box,Mover'];
    const plan = tool(dir, 'plan', ...args);
    expect(plan.status, plan.err).toBe(0);
    expect(JSON.parse(plan.out)).toMatchObject({ moved: ['Box', 'Mover'], destContexts: ['C5'], problems: [] });

    writeFileSync(path.join(dir, 'heads.json'), JSON.stringify([{ pr: 7, head: h7 }, { pr: 8, head: h8 }]));
    const refused = tool(dir, 'preflight', ...args, '--heads', 'heads.json', '--base', 'main');
    expect(refused.status).toBe(1);
    expect(JSON.parse(refused.out)).toEqual({ ok: false, slots: ['C5'], refusals: ['touched #7 Mover'] });
    writeFileSync(path.join(dir, 'heads.json'), JSON.stringify([{ pr: 8, head: h8 }]));
    expect(tool(dir, 'preflight', ...args, '--heads', 'heads.json', '--base', 'main').status).toBe(0);

    const move = tool(dir, 'move', ...args);
    expect(move.status, move.err).toBe(0);
    expect(existsSync(path.join(dir, 'server/src/coord/b.ts'))).toBe(true);
    expect(readFileSync(path.join(dir, 'server/src/coord/user.ts'), 'utf8')).toContain("from './b.js'");
    git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', 'move');
    const verdict = tool(dir, 'verdict', '--base', baseSha);
    expect(verdict.status, verdict.err).toBe(0);
    expect(JSON.parse(verdict.out)).toMatchObject({ pure: true, differing: [] });

    // An edit made in the move commit is caught by the same verdict.
    put('server/src/coord/b.ts', readFileSync(path.join(dir, 'server/src/coord/b.ts'), 'utf8').replace('b.size)))', 'b.size + 1)))'));
    git(dir, 'commit', '-q', '-am', 'edit while moving');
    const impure = tool(dir, 'verdict', '--base', baseSha);
    expect(impure.status).toBe(1);
    expect(JSON.parse(impure.out)).toMatchObject({ pure: false, differing: ['text:Mover'] });
  });

  it('FIXTURE: moveBase reads the queue\'s base in a merge_group run', () => {
    const dir = mkTmp('file-split-base-');
    const ev = path.join(dir, 'event.json');
    writeFileSync(ev, JSON.stringify({ merge_group: { base_sha: 'abc123' } }));
    expect(moveBase({ GITHUB_EVENT_NAME: 'merge_group', GITHUB_EVENT_PATH: ev }, dir)).toBe('abc123');
  });
});

describe('file-split: this branch (D-8636)', () => {
  it('REAL: this diff, against moveBase, is a pure move whenever it moves a declaration', (ctx) => {
    let baseSha: string;
    try {
      baseSha = moveBase(process.env, REPO);
    } catch {
      console.log('file-split-pin: no origin/main in this checkout, the REAL row skips');
      ctx.skip();
      return;
    }
    const v = branchVerdict(REPO, baseSha, 'HEAD');
    if (v !== null) expect(v, JSON.stringify(v.differing)).toMatchObject({ pure: true, differing: [] });
  });
});
