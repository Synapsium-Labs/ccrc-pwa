/**
 * The Docs budgets and caps, pinned across the files that own their halves (spec 2026-10-01: section 2 (j) row 47,
 * section 6.10's M6.3, section 7.10's M7.4 runner-budget clause).
 *
 * Four relationships live in four different places, and no one of those places can import another's number:
 *   1. ccd's python helper bounds each docs verb itself (`HELPER_DEADLINE_S`, `KILL_GRACE_S`, in `ccd/ccd`), and the
 *      server's runner budget (`CCD_VERB_TIMEOUT_MS`, module-private in `server/src/remote/runner.ts`) must outlast
 *      it: helper deadline + 2 s grace + 5 s < runner budget, strictly. A budget at or under that sum lets the agent
 *      kill ccd while the helper is still waiting on git, and the agent's kill reaches only its direct child, so git's
 *      process group would be orphaned instead of reaped by the helper's own `killpg`. The helper's docs redactor (one
 *      node per verb, D-7077) has its own per-verb budget, `REDACT_BUDGET_MS`, outside the deadline (a spent deadline
 *      must still redact before it answers), so the sum includes it: deadline + grace + REDACT_BUDGET_MS + 5 s < budget.
 *   2. `ccrc doctor`'s `docs` check waits `CCRC_DOCTOR_DOCS_TIMEOUT` seconds (`ccd/ccrc-doctor-checks`), and that
 *      default equals the runner's docs-index budget, so doctor waits exactly as long as a Docs page would (M7.4).
 *   3. Every answer ccd will send fits both 8 MiB exec buffers (`EXEC_MAX_BUFFER` in `agent/src/server.ts`, the
 *      `maxBuffer` of `realRunner` in `server/src/exec.ts`): a cut stdout reads as code 1 (check 4's
 *      `answer-overflow`), so the chains are what keep that check unreachable.
 *   4. One show at a class cap, and one listing, each fit the read lane's byte budget alone, and the lane's queue
 *      holds one page of images plus the document and its tree (M6.3).
 *
 * Everything outside TypeScript is read as TEXT, never executed: no `ccd` runs here. Each extraction asserts that it
 * matched exactly once (the CONTROL describe at the end proves the extractors refuse zero and two), so a renamed or
 * doubled literal reds this file instead of letting it pass on nothing.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DOCS_MAX_ANSWER_BYTES, DOCS_MAX_DOC_BYTES, DOCS_MAX_FILE_BYTES, DOCS_MAX_IMAGE_BYTES, DOCS_MAX_IMAGES_PER_PAGE,
  DOCS_MAX_LISTING_WIRE_BYTES, DOCS_VERBS, type DocsVerb,
} from '../../shared/docs.js';
import { DOCS_LANE_BYTES, DOCS_LANE_QUEUE, showWire } from '../src/docs/policy.js';
import { docsHelperSource, pyLiteral } from './docsHelperPy.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..', '..');
const readRel = (rel: string): string => readFileSync(path.join(ROOT, rel), 'utf8');

/** Every docs verb has a helper deadline and a runner row: the list is shared/docs.ts's, never a copy (X2 P1: the
 *  range verb joined it rather than keeping a deadline of its own; the two folder verbs joined it in X2 P2.3). */
const DOCS_BUDGET_VERBS = DOCS_VERBS;
type DocsBudgetVerb = DocsVerb;

/** The one match of `re` (a `g` regex) in `text`; throws on zero or on more than one. */
function exactlyOne(text: string, re: RegExp, what: string): RegExpMatchArray {
  const hits = [...text.matchAll(re)];
  if (hits.length !== 1) throw new Error(`${what}: ${hits.length} matches; the contract is one`);
  return hits[0]!;
}

/** `CCD_VERB_TIMEOUT_MS['<verb>']` in ms, read from runner.ts's text: a quoted key at line start, underscored
 *  digits, a trailing comma (the shape `swap-timeout-budget.test.ts` reads). A commented-out row does not match. */
function runnerMsIn(src: string, verb: DocsBudgetVerb): number {
  const m = exactlyOne(src, new RegExp(`^[ \\t]*'${verb}':[ \\t]*([\\d_]+),`, 'gm'), `CCD_VERB_TIMEOUT_MS['${verb}']`);
  return Number(m[1]!.replace(/_/g, ''));
}

/** ccd's `HELPER_DEADLINE_S` dict literal, parsed. Throws unless it is `{'<verb>':<int>,...}` naming exactly the
 *  docs verbs, each once. */
function helperDeadlinesIn(helperSrc: string): Record<DocsBudgetVerb, number> {
  const lit = pyLiteral(helperSrc, 'HELPER_DEADLINE_S');
  if (!/^\{'[a-z-]+':\d+(?:,'[a-z-]+':\d+)*\}$/.test(lit)) {
    throw new Error(`HELPER_DEADLINE_S: ${JSON.stringify(lit)} is not a one-line dict of integer seconds`);
  }
  const pairs = [...lit.matchAll(/'([a-z-]+)':(\d+)/g)].map((m) => [m[1]!, Number(m[2]!)] as const);
  const keys = pairs.map(([k]) => k).sort();
  if (keys.join(',') !== [...DOCS_BUDGET_VERBS].sort().join(',')) {
    throw new Error(`HELPER_DEADLINE_S names ${JSON.stringify(keys)}; the contract is exactly the docs verbs`);
  }
  return Object.fromEntries(pairs) as Record<DocsBudgetVerb, number>;
}

/** A python integer binding of the helper (`NAME=<digits>`), as a number. */
function pyIntIn(helperSrc: string, name: string): number {
  const lit = pyLiteral(helperSrc, name);
  if (!/^\d+$/.test(lit)) throw new Error(`${name}: ${JSON.stringify(lit)} is not an integer literal`);
  return Number(lit);
}

/** The doctor's default wait for `ccd docs-index --all`, in seconds: its one `: "${CCRC_DOCTOR_DOCS_TIMEOUT:=N}"`
 *  line. Any second default-assignment of the knob, in any spelling, is refused first. */
function doctorDocsTimeoutSIn(src: string): number {
  exactlyOne(src, /CCRC_DOCTOR_DOCS_TIMEOUT:=/g, 'a default assignment of CCRC_DOCTOR_DOCS_TIMEOUT');
  const m = exactlyOne(src, /^: "\$\{CCRC_DOCTOR_DOCS_TIMEOUT:=(\d+)\}"$/gm, 'the CCRC_DOCTOR_DOCS_TIMEOUT default line');
  return Number(m[1]!);
}

/** A buffer size written as a product of integer literals (`8 * 1024 * 1024`), evaluated. Refuses anything else. */
function productOf(expr: string, what: string): number {
  if (!/^\d+(?: \* \d+)*$/.test(expr)) throw new Error(`${what}: ${JSON.stringify(expr)} is not a product of integer literals`);
  return expr.split(' * ').reduce((acc, f) => acc * Number(f), 1);
}

/** The agent's exec buffer: its one `const EXEC_MAX_BUFFER = ...;` line, and the one `runExec` call that uses it. */
function agentExecBufferIn(src: string): number {
  exactlyOne(src, /execFile\(cmd, args, \{ maxBuffer: EXEC_MAX_BUFFER, timeout: timeoutMs \}/g,
    "runExec's execFile with maxBuffer: EXEC_MAX_BUFFER");
  const m = exactlyOne(src, /^const EXEC_MAX_BUFFER = ([^;\n]+);$/gm, 'const EXEC_MAX_BUFFER');
  return productOf(m[1]!, 'EXEC_MAX_BUFFER');
}

/** local mode's buffer: the one `maxBuffer:` inside `realRunner`'s declaration, which ends at its first two-space
 *  `});` line. Anchored on the declaration, never on a count of the product: `localcaps.ts` and
 *  `update/catalogue.ts` spell the same `8 * 1024 * 1024` for other things. */
function serverExecBufferIn(src: string): number {
  const decl = exactlyOne(src, /^export const realRunner: Runner = [\s\S]*?^ {2}\}\);$/gm, 'the realRunner declaration');
  const m = exactlyOne(decl[0], /maxBuffer: ([^,}\n]+?) ?[,}]/g, "realRunner's maxBuffer");
  return productOf(m[1]!, "realRunner's maxBuffer");
}

const runnerSrc = (): string => readRel('server/src/remote/runner.ts');
const runnerMs = (verb: DocsBudgetVerb): number => runnerMsIn(runnerSrc(), verb);
const helperSrc = (): string => docsHelperSource();
/** The 2 s grace and the 5 s headroom of spec section 2 (a)'s invariant; the grace is ccd's `KILL_GRACE_S`. */
const HEADROOM_S = 5;

describe('docs runner budgets outlast the helper (row 47, spec section 2 (a) Budgets)', () => {
  it('the eight CCD_VERB_TIMEOUT_MS rows are 20 000 / 20 000 / 15 000 / 60 000 / 20 000 / 30 000 / 25 000 / 30 000 ms', () => {
    expect(DOCS_BUDGET_VERBS.map((v) => [v, runnerMs(v)])).toEqual([
      ['docs-index', 20_000], ['docs-tree', 20_000], ['docs-show', 15_000], ['docs-fetch', 60_000],
      ['docs-log', 20_000], ['docs-show-range', 30_000], ['docs-folder', 25_000], ['docs-folder-read', 30_000],
    ]);
  });

  it('the helper deadline table names exactly the docs verbs, and the grace is a whole-second integer', () => {
    const deadlines = helperDeadlinesIn(helperSrc());
    expect(Object.keys(deadlines).sort()).toEqual([...DOCS_BUDGET_VERBS].sort());
    expect(Number.isInteger(pyIntIn(helperSrc(), 'KILL_GRACE_S'))).toBe(true);
  });

  it.each(DOCS_BUDGET_VERBS)('%s: helper deadline + KILL_GRACE_S + 5 s < the runner budget, strictly', (verb) => {
    const deadlineS = helperDeadlinesIn(helperSrc())[verb];
    const graceS = pyIntIn(helperSrc(), 'KILL_GRACE_S');
    expect(
      deadlineS + graceS + HEADROOM_S,
      `${verb}: the agent may kill ccd before the helper's own killpg reaches git; raise the runner row or lower `
      + 'the helper deadline, never the reverse of what the spec states',
    ).toBeLessThan(runnerMs(verb) / 1000);
  });

  it('docs-show has the thinnest margin, exactly 1 s (15 - (7 + 2 + 5)): a change to either side is read here', () => {
    const margin = runnerMs('docs-show') / 1000
      - (helperDeadlinesIn(helperSrc())['docs-show'] + pyIntIn(helperSrc(), 'KILL_GRACE_S') + HEADROOM_S);
    expect(margin).toBe(1);
  });
});

describe('docs-show-range: one deadline bounds the whole verb, and the runner budget outlasts it (X2 P1)', () => {
  // The range verb's lock waits and its copy read the same Deadline as its git calls (the cache's `dl`), so its
  // helper deadline bounds the whole verb; a prepare that runs it out then waits at most RANGE_ABORT_LOCK_WAIT_S to give
  // its place back.
  it('docs-show-range: helper deadline + RANGE_ABORT_LOCK_WAIT_S + KILL_GRACE_S + 5 s < the runner budget, strictly', () => {
    const sumS = helperDeadlinesIn(helperSrc())['docs-show-range'] + pyIntIn(helperSrc(), 'RANGE_ABORT_LOCK_WAIT_S')
      + pyIntIn(helperSrc(), 'KILL_GRACE_S') + HEADROOM_S;
    expect(sumS, 'the agent may kill ccd before a range prepare ends on its own deadline').toBeLessThan(runnerMs('docs-show-range') / 1000);
  });

  // The real sequential worst case: the verb's deadline fires, the helper waits RANGE_ABORT_LOCK_WAIT_S to give the
  // prepare's place back, the redactor still runs (REDACT_BUDGET_MS, outside the deadline), the kill grace passes, and the
  // agent keeps its own 5 s: 20 + 2 + 1 + 0.9 + 5 = 28.9 s against 30 s. A 2.5 s abort wait would make it 30.4 s and red.
  it('docs-show-range: helper deadline + KILL_GRACE_S + RANGE_ABORT_LOCK_WAIT_S + REDACT_BUDGET_MS + 5 s < the runner budget, strictly', () => {
    const helper = helperSrc();
    const sumS = helperDeadlinesIn(helper)['docs-show-range'] + pyIntIn(helper, 'KILL_GRACE_S')
      + pyIntIn(helper, 'RANGE_ABORT_LOCK_WAIT_S') + pyIntIn(helper, 'REDACT_BUDGET_MS') / 1000 + HEADROOM_S;
    expect(sumS, 'the agent may kill ccd while a range prepare gives its place back or its redactor runs')
      .toBeLessThan(runnerMs('docs-show-range') / 1000);
  });

  it('the verb builds its one Deadline from its HELPER_DEADLINE_S row and hands it to the cache, and the lock wait and the copy read it', () => {
    const src = helperSrc();
    expect(src).toContain("dl = Deadline(HELPER_DEADLINE_S['docs-show-range'])");
    expect(src).toContain('cache = range_open_dir(range_cache_dir(ctx))._replace(dl=dl)');
    expect(src).toContain('        if deadline and cache.dl is not None:\n            wait = min(wait, cache.dl.left())');
    expect(src).toContain('            if cache.dl is not None and cache.dl.left() <= 0:\n                raise fail(\'prepare-busy\')');
    expect(src).not.toMatch(/\bRANGE_DEADLINE_S\b/);
  });
});

describe('docs-folder and docs-folder-read: one deadline bounds each verb, and the runner budget outlasts it (X2 P2)', () => {
  // docs-folder: its waits are the registry lock (FOLDER_LOCK_WAIT_S, at most 5 s) and, for a remove, the cache lock
  // (RANGE_LOCK_WAIT_S, 5 s) taken after it. Both are capped by what is left of the one Deadline (12 s: the two waits
  // and 2 s for the admissions, the purge and the fsyncs), so the verb ends inside its deadline plus the redactor.
  it('docs-folder: its two lock waits fit its helper deadline, with 2 s to spare for the work between them', () => {
    const src = helperSrc();
    expect(pyIntIn(src, 'FOLDER_LOCK_WAIT_S') + pyIntIn(src, 'RANGE_LOCK_WAIT_S') + 2).toBeLessThanOrEqual(helperDeadlinesIn(src)['docs-folder']);
  });

  it('docs-folder: helper deadline + KILL_GRACE_S + REDACT_BUDGET_MS + 5 s < the runner budget, with at least 5 s over', () => {
    const src = helperSrc();
    const sumS = helperDeadlinesIn(src)['docs-folder'] + pyIntIn(src, 'KILL_GRACE_S') + pyIntIn(src, 'REDACT_BUDGET_MS') / 1000 + HEADROOM_S;
    expect(sumS).toBeLessThan(runnerMs('docs-folder') / 1000);
    expect(runnerMs('docs-folder') / 1000 - sumS, 'a remove waits on two locks and a purge: the margin is a real 5 s').toBeGreaterThanOrEqual(5);
  });

  // docs-folder-read: ONE row for its four ops. A prepare is the longest (its copy budget DOCS_RANGE_PREPARE_BUDGET_MS plus
  // three cache-lock waits, each capped by the Deadline), and gives its place back within RANGE_ABORT_LOCK_WAIT_S after the
  // deadline: the same sequential worst case as docs-show-range's, 20 + 2 + 1 + 0.9 + 5 = 28.9 s against 30 s.
  it('docs-folder-read: helper deadline + KILL_GRACE_S + RANGE_ABORT_LOCK_WAIT_S + REDACT_BUDGET_MS + 5 s < the runner budget, strictly', () => {
    const src = helperSrc();
    const sumS = helperDeadlinesIn(src)['docs-folder-read'] + pyIntIn(src, 'KILL_GRACE_S') + pyIntIn(src, 'RANGE_ABORT_LOCK_WAIT_S')
      + pyIntIn(src, 'REDACT_BUDGET_MS') / 1000 + HEADROOM_S;
    expect(sumS, 'the agent may kill ccd while a folder prepare gives its place back or its redactor runs').toBeLessThan(runnerMs('docs-folder-read') / 1000);
  });

  it('docs-folder-read: the copy budget of a prepare fits inside its helper deadline, with the cache waits', () => {
    const src = helperSrc();
    expect(pyIntIn(src, 'DOCS_RANGE_PREPARE_BUDGET_MS') / 1000 + pyIntIn(src, 'RANGE_LOCK_WAIT_S')).toBeLessThanOrEqual(helperDeadlinesIn(src)['docs-folder-read']);
  });

  it('each verb builds its one Deadline from its own HELPER_DEADLINE_S row, and the folder waits read it', () => {
    const src = helperSrc();
    expect(src).toContain("dl = Deadline(HELPER_DEADLINE_S['docs-folder'])");
    expect(src).toContain("dl = Deadline(HELPER_DEADLINE_S['docs-folder-read'])");
    // The registry lock's wait is capped by the Deadline, and the cache the remove opens carries it (so its lock wait is too).
    expect(src).toContain('end = SYS.monotonic() + (FOLDER_LOCK_WAIT_S if dl is None else min(FOLDER_LOCK_WAIT_S, dl.left()))');
    expect(src).toContain('cache = range_open_dir(cdir)._replace(dl=dl)');
    // docs-folder-read hands its Deadline to the cache every op opens.
    expect(src).toContain('cache = range_open_dir(range_cache_dir(ctx))._replace(dl=dl)');
  });
});

describe('the docs redactor\'s per-verb budget fits inside every runner margin (D-7077; C5h)', () => {
  it.each(DOCS_BUDGET_VERBS)('%s: helper deadline + KILL_GRACE_S + REDACT_BUDGET_MS + 5 s < the runner budget, strictly', (verb) => {
    const sumS = helperDeadlinesIn(helperSrc())[verb] + pyIntIn(helperSrc(), 'KILL_GRACE_S')
      + pyIntIn(helperSrc(), 'REDACT_BUDGET_MS') / 1000 + HEADROOM_S;
    expect(sumS, `${verb}: the agent may kill ccd while its redactor still runs`).toBeLessThan(runnerMs(verb) / 1000);
  });

  it('REDACT_BUDGET_MS is an integer below the thinnest margin (1 s)', () => {
    const ms = pyIntIn(helperSrc(), 'REDACT_BUDGET_MS');
    expect(Number.isInteger(ms)).toBe(true);
    expect(ms).toBeGreaterThan(0);
    expect(ms).toBeLessThan(1000);
  });
});

describe('the doctor waits exactly as long as a Docs page (M7.4, the runner-budget clause)', () => {
  it("CCRC_DOCTOR_DOCS_TIMEOUT's default equals CCD_VERB_TIMEOUT_MS['docs-index'] / 1000", () => {
    const doctorS = doctorDocsTimeoutSIn(readRel('ccd/ccrc-doctor-checks'));
    expect(doctorS).toBe(runnerMs('docs-index') / 1000);
    expect(doctorS).toBe(20);
  });
});

describe('no answer ccd will send can be cut by an exec buffer (row 47, the cap chains)', () => {
  const agentBuf = (): number => agentExecBufferIn(readRel('agent/src/server.ts'));
  const serverBuf = (): number => serverExecBufferIn(readRel('server/src/exec.ts'));

  it('both 8 * 1024 * 1024 literals are found at their anchors and are 8 388 608', () => {
    expect(agentBuf()).toBe(8_388_608);
    expect(serverBuf()).toBe(8_388_608);
  });

  it('the ceiling chain: showWire(DOCS_MAX_FILE_BYTES) = 5 657 944 <= DOCS_MAX_ANSWER_BYTES < each buffer', () => {
    expect(showWire(DOCS_MAX_FILE_BYTES)).toBe(5_657_944);
    expect(showWire(DOCS_MAX_FILE_BYTES)).toBeLessThanOrEqual(DOCS_MAX_ANSWER_BYTES);
    expect(DOCS_MAX_ANSWER_BYTES).toBeLessThan(agentBuf());
    expect(DOCS_MAX_ANSWER_BYTES).toBeLessThan(serverBuf());
  });

  it('the listing chain: DOCS_MAX_LISTING_WIRE_BYTES < each buffer', () => {
    expect(DOCS_MAX_LISTING_WIRE_BYTES).toBeLessThan(agentBuf());
    expect(DOCS_MAX_LISTING_WIRE_BYTES).toBeLessThan(serverBuf());
  });

  it("parity: ccd's DOCS_MAX_FILE_BYTES and DOCS_MAX_ANSWER_BYTES are shared/docs.ts's", () => {
    expect(pyIntIn(helperSrc(), 'DOCS_MAX_FILE_BYTES')).toBe(DOCS_MAX_FILE_BYTES);
    expect(pyIntIn(helperSrc(), 'DOCS_MAX_ANSWER_BYTES')).toBe(DOCS_MAX_ANSWER_BYTES);
  });
});

describe('derived inequalities (M6.3, spec section 6.3)', () => {
  it('any single show at a class cap fits the read lane alone: showWire(2 097 152) = 2 861 740 <= DOCS_LANE_BYTES', () => {
    const classMax = Math.max(DOCS_MAX_DOC_BYTES, DOCS_MAX_IMAGE_BYTES);
    expect(showWire(classMax)).toBe(2_861_740);
    expect(showWire(classMax)).toBeLessThanOrEqual(DOCS_LANE_BYTES);
  });

  it('any single listing fits the read lane alone: DOCS_MAX_LISTING_WIRE_BYTES <= DOCS_LANE_BYTES', () => {
    expect(DOCS_MAX_LISTING_WIRE_BYTES).toBeLessThanOrEqual(DOCS_LANE_BYTES);
  });

  it("the read queue holds one page's images plus the document and its tree: DOCS_LANE_QUEUE >= DOCS_MAX_IMAGES_PER_PAGE + 2", () => {
    expect(DOCS_LANE_QUEUE).toBeGreaterThanOrEqual(DOCS_MAX_IMAGES_PER_PAGE + 2);
  });
});

describe('CONTROL: each extractor refuses zero and two, so no case above can pass on nothing', () => {
  it('runnerMsIn: a missing row, a doubled row and a commented-out row', () => {
    expect(() => runnerMsIn("  'docs-tree': 20_000,\n", 'docs-show')).toThrow(/0 matches/);
    expect(() => runnerMsIn("  'docs-show': 15_000,\n  'docs-show': 15_000,\n", 'docs-show')).toThrow(/2 matches/);
    expect(() => runnerMsIn("  // 'docs-show': 15_000,\n", 'docs-show')).toThrow(/0 matches/);
    expect(runnerMsIn("  'docs-show': 15_000,\n", 'docs-show')).toBe(15_000);
  });

  it('helperDeadlinesIn: a missing verb, an extra key, a non-integer and a second binding', () => {
    const ok = "HELPER_DEADLINE_S={'docs-index':12,'docs-tree':12,'docs-show':7,'docs-fetch':45,'docs-log':10,'docs-show-range':20,'docs-folder':12,'docs-folder-read':20}\n";
    expect(helperDeadlinesIn(ok)).toEqual({
      'docs-index': 12, 'docs-tree': 12, 'docs-show': 7, 'docs-fetch': 45, 'docs-log': 10, 'docs-show-range': 20,
      'docs-folder': 12, 'docs-folder-read': 20,
    });
    expect(() => helperDeadlinesIn("HELPER_DEADLINE_S={'docs-index':12,'docs-tree':12,'docs-show':7,'docs-fetch':45,'docs-log':10,'docs-show-range':20,'docs-folder':12}\n"))
      .toThrow(/exactly the docs verbs/);
    expect(() => helperDeadlinesIn(
      "HELPER_DEADLINE_S={'docs-index':12,'docs-tree':12,'docs-show':7,'docs-fetch':45,'docs-log':10,'docs-show-range':20,'docs-folder':12,'docs-folder-read':20,'docs-x':1}\n",
    )).toThrow(/exactly the docs verbs/);
    expect(() => helperDeadlinesIn(ok.replace(':7,', ':7.5,'))).toThrow(/integer seconds/);
    expect(() => helperDeadlinesIn(`${ok}HELPER_DEADLINE_S={}\n`)).toThrow(/bound 2 times/);
  });

  it('doctorDocsTimeoutSIn: a missing default and a second default-assignment', () => {
    const line = ': "${CCRC_DOCTOR_DOCS_TIMEOUT:=20}"\n';
    expect(doctorDocsTimeoutSIn(line)).toBe(20);
    expect(() => doctorDocsTimeoutSIn('')).toThrow(/0 matches/);
    expect(() => doctorDocsTimeoutSIn(`${line}x="\${CCRC_DOCTOR_DOCS_TIMEOUT:=30}"\n`)).toThrow(/2 matches/);
  });

  it('the buffer readers: a non-literal product, a second realRunner, and a runExec not using the constant', () => {
    expect(() => productOf('8 * 1024 * size', 'x')).toThrow(/product of integer literals/);
    const runner = 'export const realRunner: Runner = (cmd, args) =>\n'
      + '  new Promise((resolve) => {\n    execFile(cmd, args, { maxBuffer: 8 * 1024 * 1024 }, () => {});\n  });\n';
    expect(serverExecBufferIn(runner)).toBe(8_388_608);
    expect(() => serverExecBufferIn(`${runner}${runner}`)).toThrow(/2 matches/);
    const agent = 'const EXEC_MAX_BUFFER = 8 * 1024 * 1024;\n'
      + 'execFile(cmd, args, { maxBuffer: EXEC_MAX_BUFFER, timeout: timeoutMs }, cb);\n';
    expect(agentExecBufferIn(agent)).toBe(8_388_608);
    expect(() => agentExecBufferIn(agent.replace('maxBuffer: EXEC_MAX_BUFFER', 'maxBuffer: 1024')))
      .toThrow(/0 matches/);
  });
});
