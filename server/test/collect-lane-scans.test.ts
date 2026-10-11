// Child reclamation wave 9: the temp-root collector's lane, read as TEXT (spec 2026-09-22 §5.10). These are the
// fences a type cannot draw:
//   - the collect token reaches `ws-collect` only from the act job's own audit document, and the act asks its
//     capability again after the job's last await;
//   - no `ws-reclaim` or `ws-expire` site is handed a collector value (a `CollectToken` is a `string`, so tsc lets one
//     through: this is the half the brand cannot hold);
//   - the lane never reads `~/.cc-tmp`;
//   - the collect readers never borrow reclaim's.
// KNOWN WIDTH, stated: an alias (`const A = CCD_ARGV`), a table lookup, a value routed through a helper in another
// file, and a shadowing destructure are not seen. The bar is the ordinary composer, as it is in `verb-gate.test.ts`.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { codeOnly } from './sourceScan.js';

const ccrcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const rel = (p: string): string => path.relative(ccrcRoot, p).split(path.sep).join('/');
const walk = (dir: string): string[] => readdirSync(dir).flatMap((e) => {
  if (e.startsWith('__')) return [];   // a parallel suite's transient mutant (single-definition.test.ts's reason)
  const p = path.join(dir, e);
  return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(p) ? [p] : [];
});
const SERVER = walk(path.join(ccrcRoot, 'server', 'src'));
const codeAt = (r: string): string => codeOnly(readFileSync(path.join(ccrcRoot, r), 'utf8'));
const LANE = 'server/src/collectLane.ts';
const EXECUTOR = 'server/src/coord/collectTempRoot.ts';

interface Fn { readonly name: string; readonly start: number; readonly body: string }
/** The top-level function around `at`: from its head line (`function name(` or `const name = (`, at column 0, with
 *  `export` and `async` allowed) to the first later line that opens with `}` at column 0. This tree writes every
 *  top-level function that way. A head this cannot find answers null, and every case below reads null as a red. */
function enclosingFunction(text: string, at: number): Fn | null {
  const HEAD = /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)|^(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/gm;
  let head: RegExpMatchArray | null = null;
  for (const m of text.matchAll(HEAD)) {
    if (m.index! > at) break;
    head = m;
  }
  if (head === null) return null;
  const close = /^\}/gm;
  close.lastIndex = head.index!;
  const end = close.exec(text);
  if (end === null || end.index < at) return null;
  return { name: head[1] ?? head[2]!, start: head.index!, body: text.slice(head.index!, end.index + 1) };
}

/** The first argument of the call whose `(` ends just before `open`: the text up to its first comma at depth 0. */
function firstArg(text: string, open: number): string {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i]!;
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') { if (depth === 0) return text.slice(open, i).trim(); depth--; }
    else if (c === ',' && depth === 0) return text.slice(open, i).trim();
  }
  return text.slice(open).trim();
}

interface CallSite { readonly file: string; readonly text: string; readonly at: number; readonly open: number }
const sitesOf = (key: string): CallSite[] => SERVER.flatMap((f) => {
  const text = codeOnly(readFileSync(f, 'utf8'));
  return [...text.matchAll(new RegExp(`\\bCCD_ARGV\\s*\\.\\s*${key}\\s*\\(`, 'g'))]
    .map((m) => ({ file: rel(f), text, at: m.index!, open: m.index! + m[0].length }));
});
const collectGate = (): RegExp => /capSupported\s*\(\s*[\w.]+\s*,\s*COLLECT_CAP\s*\)/g;
/** The identifier whose `.token` the one ws-collect site spends, or null. */
const spentObservation = (): string | null => {
  const [c] = sitesOf('wsCollect');
  return c === undefined ? null : /^([A-Za-z_$][\w$]*)\.token$/.exec(firstArg(c.text, c.open))?.[1] ?? null;
};

describe('the collect token reaches ws-collect only from the act job’s own audit (spec §5.10)', () => {
  it('CONTROL: the readers find the function and its first argument, and miss nothing outside a function', () => {
    const planted = [
      'export async function collectTempRoot(deps: D, job: J): Promise<void> {',
      '  const obs1 = deps.lane.observation(job.id);',
      '  await deps.runCcd(CCD_ARGV.wsCollect(obs1.token, job.id, sweepDec(deps.fleetState, `collect ${job.id}`)));',
      '}',
      '',
    ].join('\n');
    const at = planted.indexOf('CCD_ARGV.wsCollect(');
    expect(enclosingFunction(planted, at)?.name).toBe('collectTempRoot');
    expect(firstArg(planted, at + 'CCD_ARGV.wsCollect('.length)).toBe('obs1.token');
    expect(enclosingFunction('const x = 1;\nvoid CCD_ARGV.wsCollect(t, i, d);\n', 18), 'no function, no scope').toBeNull();
  });

  it('there is ONE CCD_ARGV.wsCollect( site in server/src, inside collectTempRoot', () => {
    const sites = sitesOf('wsCollect');
    expect(sites.map((s) => s.file)).toEqual([EXECUTOR]);
    expect(enclosingFunction(sites[0]!.text, sites[0]!.at)?.name).toBe('collectTempRoot');
  });

  it('its first argument is <obs>.token, <obs> bound ONCE as <answer>.value, <answer> the job’s one collectAudit( answer, before the act', () => {
    const [s] = sitesOf('wsCollect');
    const fn = enclosingFunction(s!.text, s!.at)!;
    const site = s!.at - fn.start;
    const arg = firstArg(s!.text, s!.open);
    const m = /^([A-Za-z_$][\w$]*)\.token$/.exec(arg);
    expect(m, `the first argument is ${JSON.stringify(arg)}, not <identifier>.token`).not.toBeNull();
    const obs = m![1]!;
    const binds = [...fn.body.matchAll(new RegExp(`\\bconst\\s+${obs}\\s*(?::[^=;]+)?=\\s*([A-Za-z_$][\\w$]*)\\.value\\s*;`, 'g'))];
    expect(binds.length, `${obs} is bound as <answer>.value exactly once in ${fn.name}`).toBe(1);
    expect([...fn.body.matchAll(new RegExp(`\\b(?:const|let|var)\\s+${obs}\\b`, 'g'))].length, `${obs} is declared more than once`).toBe(1);
    const bindAt = binds[0]!.index! + binds[0]![0].search(new RegExp(`\\b${obs}\\b`));
    expect(new RegExp(`(?<![\\w$.])${obs}\\b`).exec(fn.body)!.index, `${obs} is named before its binding: a parameter, or an earlier value`).toBe(bindAt);
    // <answer> is the binding of the job's ONE audit call, or ONE alias of it, both in this function and before <obs>.
    const asks = [...fn.body.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*(?::[^=;]+)?=\s*await\s+collectAudit\s*\(\s*deps\s*,\s*job\.id\s*\)\s*;/g)];
    expect(asks.length, `${fn.name} binds its own audit, await collectAudit(deps, job.id), exactly once`).toBe(1);
    expect(fn.body.match(/\bcollectAudit\s*\(/g)?.length ?? 0, `${fn.name} calls collectAudit( more than once`).toBe(1);
    const asked = asks[0]![1]!;
    const answer = binds[0]![1]!;
    const via = answer === asked ? asks[0]! : new RegExp(`\\bconst\\s+${answer}\\s*(?::[^=;]+)?=\\s*${asked}\\s*;`).exec(fn.body);
    expect(via, `${answer} is neither ${asked}, the audit call's binding, nor one alias of it`).not.toBeNull();
    expect([...fn.body.matchAll(new RegExp(`\\b(?:const|let|var)\\s+${answer}\\b`, 'g'))].length, `${answer} is declared more than once`).toBe(1);
    expect(asks[0]!.index!, 'the alias names an answer the function had not yet asked for').toBeLessThanOrEqual(via!.index!);
    expect(via!.index!, `${obs} reads an answer bound after it`).toBeLessThan(binds[0]!.index!);
    expect(binds[0]!.index!, 'the act composed before its observation').toBeLessThan(site);
  });

  it('the act asks COLLECT_CAP again after the job’s last await, before the statement that composes the argv', () => {
    const [s] = sitesOf('wsCollect');
    const fn = enclosingFunction(s!.text, s!.at)!;
    const site = s!.at - fn.start;
    const stmt = Math.max(fn.body.lastIndexOf(';', site), fn.body.lastIndexOf('{', site), fn.body.lastIndexOf('}', site));
    const gates = [...fn.body.slice(0, stmt).matchAll(collectGate())];
    expect(gates.length, 'asked at the job’s start and again before the act').toBeGreaterThanOrEqual(2);
    expect(fn.body.slice(gates.at(-1)!.index!, stmt), 'an await stands between the last capability check and the argv')
      .not.toMatch(/\bawait\b/);
  });
});

describe('no other destructive builder is handed a collector value (spec §5.10)', () => {
  const COLLECTOR = /\b(?:Collect(?:Token|Audit|Result|Entry|Listing|Population)|parseCollect(?:Audit|Result)|collectTempRoot|learnCollect|collectOpenRunHold)\b/;
  const LANE_IMPORT = /\bfrom\s*['"][^'"]*\/(?:collectLane|collectTempRoot)\.js['"]/;
  /** A collector name anywhere in a scanned file's CODE: the site's function, a same-file caller that hands it a value,
   *  or a type. Strictly stronger than the function's body alone, which cannot see a caller. */
  const fileHit = (code: string): string | null => code.match(COLLECTOR)?.[0] ?? null;

  it('CONTROL: a collector type in a signature and a lane import are seen; a plain string is not', () => {
    expect(COLLECTOR.test('async function childReclaimAct(deps: D, req: R, token: CollectToken) {')).toBe(true);
    expect(COLLECTOR.test('async function childReclaimAct(deps: D, req: R, token: string) {')).toBe(false);
    expect(LANE_IMPORT.test("import { learnCollect } from './collectTempRoot.js';")).toBe(true);
  });

  it('CONTROL: a collector type at a same-file CALLER is unseen by the site’s function and seen by the whole-file read', () => {
    const planted = [
      'export async function childReclaimOutcome(deps: D, req: R, audit: { token: CollectToken }) {',
      '  return childReclaimAct(deps, req, audit.token);',
      '}',
      'async function childReclaimAct(deps: D, req: R, token: string) {',
      '  await deps.runCcd(CCD_ARGV.wsReclaim(token, req.id));',
      '}',
      '',
    ].join('\n');
    const fn = enclosingFunction(planted, planted.indexOf('CCD_ARGV.wsReclaim('));
    expect(fn?.name).toBe('childReclaimAct');
    expect(fn!.body.match(COLLECTOR)?.[0] ?? null, 'the site’s function alone names nothing').toBeNull();
    expect(fileHit(planted), 'the file names the brand at its caller').toBe('CollectToken');
    expect(fileHit(planted.replace('CollectToken', 'string')), 'a plain string is not').toBeNull();
  });

  it('each ws-reclaim and ws-expire site lies in a file that imports no lane module and names no collector type or reader anywhere, and none spends the act’s observation', () => {
    const obs = spentObservation();
    const sites = [...sitesOf('wsReclaim'), ...sitesOf('wsExpire')];
    expect(sites.map((s) => s.file).sort()).toEqual(['server/src/coord/childReclaim.ts', 'server/src/coord/expireArchived.ts']);
    for (const s of sites) {
      expect(LANE_IMPORT.test(s.text), `${s.file} imports a collector module`).toBe(false);
      const fn = enclosingFunction(s.text, s.at);
      expect(fn, `${s.file}: the site's function was not found`).not.toBeNull();
      expect(fn!.body.match(COLLECTOR)?.[0] ?? null, `${s.file} ${fn!.name}`).toBeNull();
      expect(fileHit(s.text), `${s.file}: a collector name in the file, a same-file caller included`).toBeNull();
      if (obs !== null) {
        expect(new RegExp(`(?<![\\w$.])${obs}\\b`).test(firstArg(s.text, s.open)), `${s.file} spends ${obs}`).toBe(false);
      }
    }
  });
});

describe('the lane never reads ~/.cc-tmp (spec §5.10)', () => {
  const FILES = [LANE, EXECUTOR, 'server/src/watch.ts'];
  const IO_OR_JOIN = /\bio\s*\.\s*\w+\s*\(|\.\s*(?:join|resolve)\s*\(/;
  /** Every `cc-tmp` spelling that is NOT the display form `~/.cc-tmp`, with a little context. */
  const loose = (code: string): string[] => [...code.matchAll(/cc-tmp/g)]
    .filter((m) => code.slice(m.index! - 3, m.index!) !== '~/.')
    .map((m) => code.slice(Math.max(0, m.index! - 30), m.index! + 10));
  const ioLines = (code: string): string[] => code.split('\n').filter((l) => l.includes('cc-tmp') && IO_OR_JOIN.test(l));

  it('CONTROL: a built path and an io read are seen; a display sentence is not', () => {
    expect(loose('const p = `${registryDir}/../.cc-tmp`;')).toHaveLength(1);
    expect(loose("const p = path.join(home, '.cc-tmp', id);")).toHaveLength(1);
    expect(loose("const s = 'its temp root ~/.cc-tmp/' + id;")).toEqual([]);
    expect(ioLines("await io.readdir('~/.cc-tmp');")).toHaveLength(1);
    expect(ioLines('const s = `the leaf under ~/.cc-tmp`;')).toEqual([]);
  });

  it('the pass, the lane and the executor spell .cc-tmp only as the display form, never beside an io call or a path join', () => {
    for (const f of FILES) {
      const code = codeAt(f);
      expect(loose(code), `${f}: a path spelling of .cc-tmp`).toEqual([]);
      expect(ioLines(code), `${f}: .cc-tmp beside an io call or a join`).toEqual([]);
    }
  });

  it('the lane and the executor never read the home directory, the only root a ~/.cc-tmp path is built from', () => {
    for (const f of [LANE, EXECUTOR]) {
      expect(codeAt(f), f).not.toMatch(/\bhomedir\s*\(|\bprocess\s*\.\s*env\s*(?:\.\s*HOME\b|\[\s*['"]HOME['"]\s*\])/);
    }
  });
});

describe('the collect readers never borrow reclaim’s (spec §5.10)', () => {
  const RECLAIM_READERS = /\b(?:parseChildReclaimResult|parseChildReclaimAuditFailed|parseChildReclaimAudit|childReclaimFailedResume|isChildReclaimPreCrumbFailed|childReclaimFailedTail)\b/;

  it('CONTROL: a reclaim reader is seen, a collect reader is not', () => {
    expect(RECLAIM_READERS.test("import { parseChildReclaimAuditFailed } from './coord/childReclaim.js';")).toBe(true);
    expect(RECLAIM_READERS.test('const r = parseCollectResult(id, res.ok, res.stdout, res.stderr);')).toBe(false);
  });

  it('neither the lane nor the executor imports or calls a reclaim reader, and the L1 file imports nothing from coord/', () => {
    for (const f of [LANE, EXECUTOR]) expect(codeAt(f).match(RECLAIM_READERS)?.[0] ?? null, f).toBeNull();
    expect(codeAt(LANE)).not.toMatch(/\bfrom\s*['"]\.\/coord\//);
  });

  it('the two collect readers are defined in the lane’s L1 file alone, and only the lane and the executor name a call of them', () => {
    for (const name of ['parseCollectAudit', 'parseCollectResult']) {
      const DEF = new RegExp(`^\\s*(?:export\\s+)?(?:function\\s+${name}\\b|const\\s+${name}\\s*=)`, 'm');
      expect(SERVER.filter((f) => DEF.test(codeOnly(readFileSync(f, 'utf8')))).map(rel), name).toEqual([LANE]);
      expect(SERVER.filter((f) => new RegExp(`\\b${name}\\s*\\(`).test(codeOnly(readFileSync(f, 'utf8')))).map(rel).sort(), name)
        .toEqual([LANE, EXECUTOR]);
    }
  });
});
