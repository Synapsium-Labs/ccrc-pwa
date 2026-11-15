// The ccd file split's pure-move pin (docs/superpowers/plans/2026-11-06-ccd-file-split.md, Task 1; D-8048, D-8634).
// `ccd-split-pin.test.ts` holds these; `.github/ci/ccd-split.py` is the tool that makes the moves they judge, and the
// region rule has its one implementation there (`regionProblems` asks it).
//
// A TREE is ccd's program files by repo-relative path: `ccd/ccd` and each `ccd/lib/*.sh`. A library named `ccrc-*`
// is ccrc's, not ccd's (the sweeps source it, ccd does not), so it is not part of the program.
import { readFileSync, mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSyncGroup } from './spawnGroup.js';
import { seedAccountsSh, spliceCcd, ghContainedEnv } from './ccdWsHelpers.js';
import { addedFiles, fileAt, gitRead } from './growthCheck.js';

/** ccd's program files by repo-relative path. */
export type Tree = Readonly<Record<string, string>>;

export const CCD_SPLIT_TOOL = path.resolve(__dirname, '..', '..', '.github', 'ci', 'ccd-split.py');

/** The directory a slice's record sits in: `<NN>-<library>.json`, `{library, functions}`. */
export const CCD_SPLIT_RECORDS = 'server/test/ccd-split-records';

const LIB_RE = /^ccd\/lib\/([^/]+)\.sh$/;
const DEF_RE = /^([A-Za-z_][A-Za-z0-9_]*)\(\) *\{/gm;
const POINTER_RE = /^# @ccd-lib:(\w+)\b/;

/** The program's library files in `tree`, by word (the file's name without `.sh`), `ccrc-*` left out. */
function programLibs(tree: Tree): Map<string, string> {
  const out = new Map<string, string>();
  for (const [rel, text] of Object.entries(tree)) {
    const m = LIB_RE.exec(rel);
    if (m && !m[1]!.startsWith('ccrc-')) out.set(m[1]!, text);
  }
  return out;
}

/** `ccd/ccd` and every program library of the tree at `sha` in the repository at `root`. */
export function treeAt(sha: string, root: string): Tree {
  const out: Record<string, string> = {};
  const main = fileAt('ccd/ccd', sha, root);
  if (main !== null) out['ccd/ccd'] = main;
  let listed: string[] = [];
  try {
    listed = gitRead(['ls-tree', '--name-only', '-z', `${sha}:ccd/lib`], root).split('\0').filter((f) => f.endsWith('.sh'));
  } catch { /* no ccd/lib at this sha */ }
  for (const f of listed) {
    const rel = `ccd/lib/${f}`;
    if (f.startsWith('ccrc-')) continue;
    const text = fileAt(rel, sha, root);
    if (text !== null) out[rel] = text;
  }
  return out;
}

/** The words of the one `__CCD_LIBS=(` line, and the text without it; null words when there is no such line. */
function takeLibsLine(main: string): { words: string[] | null; rest: string } {
  const lines = main.split('\n');
  const at = lines.findIndex((l) => l.startsWith('__CCD_LIBS=('));
  if (at < 0) return { words: null, rest: main };
  const m = /^__CCD_LIBS=\(([a-z0-9 -]*)\)/.exec(lines[at]!);
  lines.splice(at, 1);
  return { words: m ? m[1]!.split(/\s+/).filter((w) => w !== '') : ['<malformed>'], rest: lines.join('\n') };
}

const pointerIds = (text: string): Set<string> =>
  new Set(text.split('\n').flatMap((l) => { const m = POINTER_RE.exec(l); return m ? [m[1]!] : []; }));

/** Each column-0 definition's text up to the next one, by name: what `differing` names when two splices differ. */
function definitionsOf(text: string): Map<string, string> {
  const out = new Map<string, string>();
  const starts = [...text.matchAll(DEF_RE)];
  starts.forEach((m, i) => {
    const end = i + 1 < starts.length ? starts[i + 1]!.index : text.length;
    out.set(m[1]!, text.slice(m.index, end));
  });
  return out;
}

/** Is `head` a pure move of `base`? Null when the diff adds no pointer line (a feature, not judged here). Otherwise the
 *  `__CCD_LIBS` line of `head` must hold the base's words plus exactly the libraries the diff adds, order kept, and the
 *  two splices, with that line and any pointer line left unspliced removed, must be equal byte for byte. `differing`
 *  names `__CCD_LIBS` for the first, and the functions whose text differs for the second (`spliced text` when the
 *  difference is in no function). */
export function pureMoveVerdict(base: Tree, head: Tree): { pure: boolean; differing: string[] } | null {
  const baseMain = base['ccd/ccd'] ?? '';
  const headMain = head['ccd/ccd'] ?? '';
  const before = pointerIds(baseMain);
  if (![...pointerIds(headMain)].some((id) => !before.has(id))) return null;
  const differing: string[] = [];
  const b = takeLibsLine(baseMain);
  const h = takeLibsLine(headMain);
  const baseLibs = programLibs(base);
  const headLibs = programLibs(head);
  const added = [...headLibs.keys()].filter((w) => !baseLibs.has(w));
  const wordsOk = h.words === null
    ? b.words === null && added.length === 0
    : JSON.stringify(h.words.filter((w) => !added.includes(w))) === JSON.stringify(b.words ?? [])
      && added.every((w) => h.words!.includes(w));
  if (!wordsOk) differing.push('__CCD_LIBS');
  const flat = (main: string, libs: Map<string, string>): string =>
    spliceCcd(main, [...libs.values()]).split('\n').filter((l) => !POINTER_RE.test(l)).join('\n');
  const bs = flat(b.rest, baseLibs);
  const hs = flat(h.rest, headLibs);
  if (bs !== hs) {
    const bd = definitionsOf(bs);
    const hd = definitionsOf(hs);
    const names = [...new Set([...bd.keys(), ...hd.keys()])].filter((n) => bd.get(n) !== hd.get(n));
    differing.push(...(names.length ? names : ['spliced text']));
  }
  return { pure: differing.length === 0, differing };
}

/** Function names defined more than once across the program: `ccd/ccd` and its libraries, in that order. */
export function duplicateDefinitions(tree: Tree): string[] {
  const texts = [tree['ccd/ccd'] ?? '', ...programLibs(tree).values()];
  const seen = new Map<string, number>();
  for (const t of texts) for (const m of t.matchAll(DEF_RE)) seen.set(m[1]!, (seen.get(m[1]!) ?? 0) + 1);
  return [...seen].filter(([, n]) => n > 1).map(([name]) => name);
}

/** The variables bash keeps for itself, and `__CCD_LIBS`: left out of the dump by name. bash reads it as an ERE, so no `(?:`. */
const NOT_THE_PROGRAM = /^(_|BASH.*|PIPESTATUS|FUNCNAME|GROUPS|LINENO|RANDOM|SRANDOM|SECONDS|EPOCHREALTIME|EPOCHSECONDS|HISTCMD|PPID|SHLVL|OLDPWD|PWD|COLUMNS|LINES|DIRSTACK|OPTIND|OPTERR|IFS|PS[0-4]|SHELLOPTS|COMP_WORDBREAKS|HISTFILE|HISTFILESIZE|HISTSIZE|MAILCHECK|HOSTNAME|HOSTTYPE|MACHTYPE|OSTYPE|UID|EUID|SHELL|TERM|HOME|PATH|LC_ALL|__CCD_LIBS|__dump_f|__dump_re|__dump_v)$/;

/** `declare -f` and `declare -p` of the tree sourced in a fresh bash on a fixture HOME, with the shell's own
 *  variables and `__CCD_LIBS` removed by name, and the tree's and HOME's paths written as `<TREE>` and `<HOME>`. */
export function programDump(tree: Tree): string {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'ccd-split-dump-')));
  try {
    const root = path.join(dir, 'tree');
    const home = path.join(dir, 'home');
    for (const [rel, text] of Object.entries(tree)) {
      mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      writeFileSync(path.join(root, rel), text, { mode: rel === 'ccd/ccd' ? 0o755 : 0o644 });
    }
    mkdirSync(home, { recursive: true });
    seedAccountsSh(home);
    // `$0` is not the program's path: ccd's own guard runs a verb when `BASH_SOURCE[0]` equals `$0`.
    const script = '__dump_f=$1 __dump_re=$2; set --; source "$__dump_f" >/dev/null 2>&1 </dev/null; echo "rc=$?"; declare -f; '
      + 'for __dump_v in $(compgen -v); do [[ $__dump_v =~ $__dump_re ]] || declare -p "$__dump_v"; done';
    const r = spawnSyncGroup('bash', ['--norc', '--noprofile', '-c', script, 'program-dump', path.join(root, 'ccd/ccd'), NOT_THE_PROGRAM.source],
      { encoding: 'utf8', timeout: 120_000, cwd: dir, maxBuffer: 256 * 1024 * 1024,
        env: ghContainedEnv(home, { HOME: home, PATH: process.env['PATH'] ?? '/usr/bin:/bin', LC_ALL: 'C' }, { systemd: true, tmux: true }) });
    if (r.status !== 0) throw new Error(`programDump: bash exited ${r.status}: ${r.stderr}`);
    return r.stdout.split(root).join('<TREE>').split(home).join('<HOME>');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The region rule's problems in a bash text, one string per problem (`two definitions`, `no definition`,
 *  `sets a variable: X`, …), from `ccd-split.py check-regions`: the tool's own rule, never a second copy. */
export function regionProblems(text: string): string[] {
  const r = spawnSyncGroup('python3', ['-I', CCD_SPLIT_TOOL, 'check-regions', '-'],
    { encoding: 'utf8', input: text, timeout: 600_000, maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0 && r.status !== 1) throw new Error(`ccd-split.py check-regions exited ${r.status}: ${r.stderr}`);
  return (JSON.parse(r.stdout) as { problems: { problem: string }[] }).problems.map((p) => p.problem);
}

/** The sha a run judges a move against. In a `merge_group` run, the queue's `merge_group.base_sha` from
 *  `GITHUB_EVENT_PATH`, the base `ci.yml` uses, so an entry ahead in the queue is not counted as part of a move;
 *  otherwise `merge-base(origin/main, HEAD)`. Throws when neither can be read. */
export function moveBase(env: NodeJS.ProcessEnv, root: string): string {
  if (env['GITHUB_EVENT_NAME'] === 'merge_group') {
    let sha: unknown;
    try {
      sha = (JSON.parse(readFileSync(env['GITHUB_EVENT_PATH'] ?? '', 'utf8')) as { merge_group?: { base_sha?: unknown } })
        .merge_group?.base_sha;
    } catch (e) {
      throw new Error(`moveBase: the merge_group event could not be read for its base_sha: ${(e as Error).message}`);
    }
    if (typeof sha !== 'string' || !/^[0-9a-f]{40}$/.test(sha)) throw new Error('moveBase: the merge_group event has no base_sha');
    return sha;
  }
  try {
    gitRead(['rev-parse', '--verify', '--quiet', 'origin/main^{commit}'], root);
  } catch {
    throw new Error('moveBase: no origin/main in this checkout');
  }
  try {
    return gitRead(['merge-base', 'origin/main', 'HEAD'], root).trim();
  } catch {
    throw new Error('moveBase: no merge-base between origin/main and HEAD');
  }
}

/** The records the diff `base..head` adds (as `waiversAdded` counts a waiver: only a file the base does not hold). */
export function recordsAdded(base: string, head: string, root: string): { library: string; functions: string[] }[] {
  return addedFiles(base, head, root)
    .filter((f) => f.startsWith(`${CCD_SPLIT_RECORDS}/`) && f.endsWith('.json'))
    .map((f) => JSON.parse(fileAt(f, head, root) ?? 'null') as { library: string; functions: string[] });
}
