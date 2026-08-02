// Every ccd call the server makes has to survive VERSION SKEW: the fleet host
// runs its own ccd, and a verb this branch added does not exist there yet. The
// answer for that is a 501 `{ok:false,error:'unsupported'}` (routes) or a
// silent skip (the level-triggered sweep) — never the call going out to die in
// ccd's own `[[ $# -eq N ]] || die "usage: ..."` and surfacing as a 502 "the
// archive failed".
//
// This file exists because the round-2 fix for that closed ONE route and then
// wrote into server.ts that it was "the ONE ccd route with no `verbSupported`
// gate (measured: server.ts:434, :456, :499 had it, the audit route did not)".
// The measurement was a grep for the routes that ALREADY HAD a gate, so the
// sentence was false the moment it was written: `/archive`, `/restore` and
// `FleetWatcher.archiveMerged` were all missing theirs, all three the same
// verb generation, all three added by the same branch. A prose completeness
// claim is the expensive kind of wrong, because the next reader stops looking.
//
// So the claim is made here instead, by parse, and it is made in BOTH
// directions:
//   - no call site may be ungated unless its verb is in UNGATED_BY_DECISION;
//   - every verb in UNGATED_BY_DECISION must still have an ungated call site,
//     so the exemption list cannot rot into a lie either.
// The discovery half is a directory walk plus a scan of `server/src`, so a
// FOURTH forgotten call site fails this test rather than needing anyone to
// remember it.
//
// WHAT THIS DOES NOT COVER, stated plainly rather than left to be assumed: the
// scan recognises a call site by the literal text `CCD_ARGV.<name>(`, and a
// gate by the literal text `verbSupported(` somewhere in the enclosing
// function. Code that reaches `deps.runCcd` with an argv obtained some other
// way — a `CcdArgv` passed in as a parameter, an aliased `const A = CCD_ARGV`,
// a table lookup `CCD_ARGV[k]` — is invisible to it, and a `verbSupported`
// call in a sibling branch of the same function counts as a gate even if the
// call site's own path skips it. It catches the honest omission, which is the
// failure this branch actually shipped three times; it is not a proof against
// someone routing around it. `ccdargv-brand.test.ts` and
// `whitelist-subset.test.ts` are what police argv PROVENANCE; this only
// polices whether the site asked the skew question.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CCD_ARGV } from '../src/ccdargv.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.resolve(here, '..', 'src');

/**
 * The ccd verbs whose call sites are deliberately left ungated, keyed by VERB
 * (`argv[0]`) rather than by file:line so ordinary edits cannot rot the list.
 *
 * Every one of them predates this branch and has been in `ccd caps` since
 * before the fleet handshake carried a verb list at all, so there is no
 * deployed ccd that answers the handshake and lacks them — the gate would be
 * dead code. Everything this branch ADDED (`pr-state`, `pr-open`,
 * `ws-archive`, `ws-restore`, `ws-audit`, `ws-reap`) is skew-exposed and is
 * absent from this list on purpose.
 */
const UNGATED_BY_DECISION: ReadonlySet<string> = new Set([
  'start', 'enable', 'ensure', 'ws-add', 'stop', 'swap',
]);

/** `CCD_ARGV` key -> the verb it emits, taken from the table itself rather
 *  than from a second copy of the mapping that could disagree with it. */
const VERB_OF: Record<string, string> = Object.fromEntries(
  Object.entries(CCD_ARGV).map(([k, fn]) => {
    const built = (fn as (...a: unknown[]) => readonly string[])('x', 'x', 'x', 'x');
    return [k, built[0] ?? ''];
  }),
);

/** Blank out comments and string/template bodies, preserving every byte
 *  position and newline so line numbers and brace depth stay true. Without
 *  this, `CCD_ARGV.ensure('x')` inside ccdargv.ts's own doc comment reads as a
 *  call site, and prose mentioning `verbSupported` reads as a gate. */
function blankCommentsAndStrings(text: string): string {
  const out = text.split('');
  const blank = (a: number, b: number): void => {
    for (let k = a; k < b; k++) if (out[k] !== '\n') out[k] = ' ';
  };
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    const d = text[i + 1];
    if (c === '/' && d === '/') {
      const j = text.indexOf('\n', i);
      const e = j < 0 ? text.length : j;
      blank(i, e); i = e;
    } else if (c === '/' && d === '*') {
      const j = text.indexOf('*/', i + 2);
      const e = j < 0 ? text.length : j + 2;
      blank(i, e); i = e;
    } else if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      while (j < text.length) {
        if (text[j] === '\\') j += 2;
        else if (text[j] === c) break;
        else j++;
      }
      blank(i + 1, Math.min(j, text.length));
      i = Math.min(j + 1, text.length);
    } else i++;
  }
  return out.join('');
}

const CONTROL_KEYWORD = /^(if|for|while|switch|catch|do|try|else|return|typeof|await)$/;

/** Is this the header line of a function/method/route-handler body, as opposed
 *  to a `for`/`if` block? That distinction is what makes the enclosing scope a
 *  unit a gate can sensibly live in. */
function isHandlerHead(head: string): boolean {
  if (/app\.(get|post|put|patch|delete)\s*\(/.test(head)) return true;
  const m = /^\s*(?:export\s+)?(?:private\s+|public\s+|protected\s+)?(?:static\s+)?(?:async\s+)?(?:function\s+)?([A-Za-z_]\w*)\s*\(/.exec(head);
  if (!m || CONTROL_KEYWORD.test(m[1]!)) return false;
  return /\)\s*(?::[^{]*)?\{\s*$/.test(head);
}

interface Site { file: string; line: number; key: string; verb: string; gated: boolean; scope: string | null }

function scanCcdCallSites(text: string, file: string): Site[] {
  const code = blankCommentsAndStrings(text);
  const depthStack: number[] = [];
  const chains: number[][] = new Array(code.length);
  for (let i = 0; i < code.length; i++) {
    if (code[i] === '{') depthStack.push(i);
    else if (code[i] === '}') depthStack.pop();
    chains[i] = depthStack.slice();
  }
  const lineStart = (i: number): number => code.lastIndexOf('\n', i) + 1;
  const lineOf = (i: number): number => code.slice(0, i).split('\n').length;
  const sites: Site[] = [];
  const re = /CCD_ARGV\.([A-Za-z]\w*)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    const key = m[1]!;
    const chain = chains[m.index] ?? [];
    let open: number | null = null;
    for (let k = chain.length - 1; k >= 0; k--) {
      const b = chain[k]!;
      if (isHandlerHead(code.slice(lineStart(b), b + 1))) { open = b; break; }
    }
    if (open === null) {
      sites.push({ file, line: lineOf(m.index), key, verb: VERB_OF[key] ?? key, gated: false, scope: null });
      continue;
    }
    let depth = 0; let end = code.length;
    for (let i = open; i < code.length; i++) {
      if (code[i] === '{') depth++;
      else if (code[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
    }
    sites.push({
      file, line: lineOf(m.index), key, verb: VERB_OF[key] ?? key,
      gated: /verbSupported\s*\(/.test(code.slice(open, end)),
      scope: text.slice(text.lastIndexOf('\n', open) + 1, open + 1).trim(),
    });
  }
  return sites;
}

function tsFilesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (
    e.isDirectory() ? tsFilesUnder(path.join(dir, e.name))
      : e.name.endsWith('.ts') ? [path.join(dir, e.name)] : []
  ));
}

const ALL_SITES: Site[] = tsFilesUnder(srcRoot).sort().flatMap(
  (f) => scanCcdCallSites(readFileSync(f, 'utf8'), path.relative(srcRoot, f)),
);
const show = (s: Site): string => `${s.file}:${s.line} ${s.key} (${s.verb})`;

// ── The scanner has to be shown to work before its silence means anything ──
// A parse that matches nothing passes every completeness assertion below
// vacuously. These four run it over inputs whose answer is known by
// construction, so "no ungated sites" cannot mean "no sites".
describe('the scanner itself', () => {
  const wrap = (body: string): string => `import { CCD_ARGV, verbSupported } from './ccdargv.js';\nexport function build(deps: D) {\n${body}\n}\n`;

  it('sees an ungated call site', () => {
    const [s] = scanCcdCallSites(wrap(`  app.post('/x', async (req, reply) => {\n    return run(reply, CCD_ARGV.wsArchive(id));\n  });`), 'f.ts');
    expect(s!.key).toBe('wsArchive');
    expect(s!.verb).toBe('ws-archive');
    expect(s!.gated).toBe(false);
  });

  it('sees a gated call site', () => {
    const [s] = scanCcdCallSites(wrap(`  app.post('/x', async (req, reply) => {\n    const argv = CCD_ARGV.wsArchive(id);\n    if (!verbSupported(deps.fleetState, argv)) return reply.code(501).send({});\n    return run(reply, argv);\n  });`), 'f.ts');
    expect(s!.gated).toBe(true);
  });

  it('does not count a NEIGHBOURING route\'s gate as this route\'s gate', () => {
    // The scope is the handler, not the file: two adjacent routes are exactly
    // the shape that shipped broken, so a scanner that read file-wide would
    // have called the shipped bug clean.
    const sites = scanCcdCallSites(wrap(
      `  app.post('/a', async (req, reply) => {\n    const argv = CCD_ARGV.wsAudit(id);\n    if (!verbSupported(deps.fleetState, argv)) return reply.code(501).send({});\n    return run(reply, argv);\n  });\n`
      + `  app.post('/b', async (req, reply) => {\n    return run(reply, CCD_ARGV.wsRestore(id));\n  });`), 'f.ts');
    expect(sites.map((s) => [s.key, s.gated])).toEqual([['wsAudit', true], ['wsRestore', false]]);
  });

  it('ignores a call site and a gate that are only mentioned in a comment', () => {
    const sites = scanCcdCallSites(
      `/** Do not write CCD_ARGV.ensure('x') here. */\n// nor claim verbSupported() in prose\nexport const x = 1;\n`, 'f.ts');
    expect(sites).toEqual([]);
  });
});

describe('every ccd call site in server/src answers the version-skew question', () => {
  it('finds call sites in both files that make them, and resolves a scope for each', () => {
    expect(ALL_SITES.length).toBeGreaterThan(0);
    expect(ALL_SITES.filter((s) => s.file === 'server.ts').length).toBeGreaterThan(0);
    expect(ALL_SITES.filter((s) => s.file === 'watch.ts').length).toBeGreaterThan(0);
    // A site whose enclosing function the scanner could not identify is a
    // scanner failure, not a pass — it would otherwise report `gated: false`
    // and be silently absorbed by the exemption list.
    expect(ALL_SITES.filter((s) => s.scope === null).map(show)).toEqual([]);
    // Both verdicts occur, so neither is stuck.
    expect(ALL_SITES.some((s) => s.gated)).toBe(true);
    expect(ALL_SITES.some((s) => !s.gated)).toBe(true);
  });

  it('has no ungated call site outside UNGATED_BY_DECISION', () => {
    const offenders = ALL_SITES.filter((s) => !s.gated && !UNGATED_BY_DECISION.has(s.verb));
    expect(offenders.map(show)).toEqual([]);
  });

  it('does not carry an exemption that no longer has an ungated call site', () => {
    // The other direction. Without it the list decays into folklore, and the
    // next reader trusts a name in it that means nothing.
    const ungated = new Set(ALL_SITES.filter((s) => !s.gated).map((s) => s.verb));
    expect([...UNGATED_BY_DECISION].filter((v) => !ungated.has(v))).toEqual([]);
  });

  it('gates every verb this branch added, at every one of its call sites', () => {
    // The direct pin for NF10 and its round-3 reopening. Named explicitly (not
    // derived) because these six are the finding, and a derivation from
    // UNGATED_BY_DECISION would let a mistaken addition to that set silently
    // excuse one of them.
    const NEW_GENERATION = ['pr-state', 'pr-open', 'ws-archive', 'ws-restore', 'ws-audit', 'ws-reap'];
    for (const verb of NEW_GENERATION) {
      const sites = ALL_SITES.filter((s) => s.verb === verb);
      expect(sites.length, `${verb} has no call site at all`).toBeGreaterThan(0);
      expect(sites.filter((s) => !s.gated).map(show), verb).toEqual([]);
    }
  });
});
