import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { CCD } from './ccdWsHelpers.js';

const REPO = path.resolve(__dirname, '..', '..');
const table = JSON.parse(fs.readFileSync(path.join(REPO, 'core', 'entries.json'), 'utf8')) as
  { entries: Record<string, { owns: string[]; ownsSha256: string; ownsDigest?: string; tests: string[]; mode?: Record<string, string> }> };
const LIB = path.join(path.dirname(CCD), 'lib');
const HOOK = path.join(REPO, 'ccd', 'session-hook.sh');
const bashSources = [CCD, ...fs.readdirSync(LIB).filter((f) => f.endsWith('.sh')).map((f) => path.join(LIB, f)), HOOK]
  .map((p) => fs.readFileSync(p, 'utf8'));

function functionText(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error(`not a shell function name: ${name}`); // so no regex escaping is needed
  for (const src of bashSources) {
    const at = src.search(new RegExp('^' + name + '\\(\\) \\{', 'm'));
    if (at >= 0) return src.slice(at, src.indexOf('\n}\n', at) + 2);
  }
  throw new Error(`bash function ${name} not found in ccd/ccd, ccd/lib or ccd/session-hook.sh`);
}

// `ownsDigest: "shape"` pins the SHAPE of the owned bash, not its text: heredoc bodies, comment-only lines, trailing
// comments and lines made only of `echo <word>` items are removed before hashing, so a new word (a cap) changes
// nothing while a new control line does. The core reads those words at run time, and its parity test catches a
// changed list.
const ECHO_WORDS = /^\s*echo [a-z0-9:._-]+(\s*;\s*echo [a-z0-9:._-]+)*\s*$/;
function shapeOf(text: string): string {
  const out: string[] = [];
  let heredoc = false;
  for (const raw of text.split('\n')) {
    if (heredoc) { if (raw === 'EOF') heredoc = false; continue; }
    if (/^\s*#/.test(raw)) continue;
    const line = raw.replace(/\s+#.*$/, '');
    if (ECHO_WORDS.test(line)) continue;
    if (line.includes("<<'EOF'")) heredoc = true;
    out.push(line);
  }
  return out.join('\n');
}
// `ownsDigest: "file"` names whole files (repo-relative) in `owns` and pins their full text: the session hook's arms and
// its hookstate assembly are top-level statements, not functions (wave 2 inventory §5, "the table guard").
function ownedDigest(v: string, e: { owns: string[]; ownsDigest?: string }): string {
  if (e.ownsDigest !== undefined && e.ownsDigest !== 'shape' && e.ownsDigest !== 'file') {
    throw new Error(`core entry ${v}: ownsDigest must be "shape", "file" or absent, not ${JSON.stringify(e.ownsDigest)}`);
  }
  if (e.ownsDigest === 'file') {
    return createHash('sha256').update(e.owns.map((f) => fs.readFileSync(path.join(REPO, f), 'utf8')).join('\n')).digest('hex');
  }
  const texts = e.owns.map(functionText);
  return createHash('sha256').update((e.ownsDigest === 'shape' ? texts.map(shapeOf) : texts).join('\n')).digest('hex');
}

// The table's entries are the binary's entry points less `ccd` (each an `ccrc-core <entry>` case of main.go's switch)
// and ccd's verbs (the keys of app/ccd's verb table), and each kind has its own parity harness.
const ccdVerbs = (() => {
  const src = fs.readFileSync(path.join(REPO, 'core', 'internal', 'app', 'ccd', 'ccd.go'), 'utf8');
  const m = src.match(/var verbs = map\[string\]func\(\[\]string, IO\) int\{([^}]*)\}/);
  if (!m) throw new Error('app/ccd/ccd.go has no verb table');
  return [...m[1].matchAll(/"([^"]+)":/g)].map((x) => x[1]!);
})();
const entryPoints = (() => {
  const src = fs.readFileSync(path.join(REPO, 'core', 'cmd', 'ccrc-core', 'main.go'), 'utf8');
  const sw = src.slice(src.indexOf('\tswitch name {'), src.indexOf('\tdefault:', src.indexOf('\tswitch name {')));
  return [...sw.matchAll(/^\tcase "([^"]+)":/gm)].map((x) => x[1]!).filter((n) => n !== 'ccd');
})();
const TWINS: Record<string, { module: string; run: string; goRun?: string; both?: string }> = {
  hook: { module: 'hookTwin', run: 'runHook', goRun: 'runGoHook', both: 'hookBoth' },
};
const twinOf = (v: string) => TWINS[v] ?? { module: 'ccdTwin', run: 'runImpl' };

/** Why `src` (a test file's text) is not a parity test of its twin, or null when it is. It must import the twin, and
 *  reach both implementations in one of three recognisable forms (the third, the twin's `both` runner, runs each case
 *  through both and requires the same answer): the twin's runner called with each literal ('go' and
 *  'bash'), or a body run once per implementation (`.each(IMPLS)`, IMPLS imported from the twin) in a file that calls
 *  the twin's runner, or its Go form (`goRun`, which the twin defines on its runner). A file that only runs bash, with
 *  or without the import, is refused. */
function notParity(src: string, twin: { module: string; run: string; goRun?: string; both?: string }): string | null {
  const from = `from '\\./${twin.module}\\.js'`;
  if (!new RegExp(from).test(src)) return `it does not import ./${twin.module}.js`;
  const literal = new RegExp(`${twin.run}\\([^)]*'go'`).test(src) && new RegExp(`${twin.run}\\([^)]*'bash'`).test(src);
  const runners = [twin.run, ...(twin.goRun ? [twin.goRun] : [])].join('|');
  const each = /\.each\(IMPLS\)/.test(src) && new RegExp(`import \\{[^}]*\\bIMPLS\\b[^}]*\\} ${from}`).test(src)
    && new RegExp(`\\b(${runners})\\(`).test(src);
  const both = twin.both !== undefined && new RegExp(`import \\{[^}]*\\b${twin.both}\\b[^}]*\\} ${from}`).test(src)
    && new RegExp(`\\b${twin.both}\\(`).test(src);
  return literal || each || both ? null
    : `it neither calls ${twin.run} with 'go' and 'bash' nor runs a .each(IMPLS) body that calls ${runners}`;
}

describe('core/entries.json: the core table', () => {
  it('its entries are exactly the Go entry points (less ccd) and the keys of the ccd verb table', () => {
    expect(entryPoints).toContain('hook');
    expect([...ccdVerbs, ...entryPoints].sort()).toEqual(Object.keys(table.entries).sort());
  });
  it.each(Object.entries(table.entries))('%s names parity tests that run both implementations', (v, e) => {
    expect(e.tests.length).toBeGreaterThan(0);
    for (const t of e.tests) expect(notParity(fs.readFileSync(path.join(REPO, t), 'utf8'), twinOf(v)), t).toBeNull();
  });
  it('the parity form is recognised, and a file that runs only bash is refused, with the import or without it', () => {
    const hook = twinOf('hook');
    const imp = (names: string) => `import { ${names} } from './hookTwin.js';\n`;
    expect(notParity(`${imp('runHook')}runHook(h, 'bash', p); runHook(h, 'go', p);`, hook)).toBeNull();
    expect(notParity(`${imp('IMPLS, runGoHook')}describe.each(IMPLS)('x', (i) => { runGoHook(home, p, env); });`, hook)).toBeNull();
    expect(notParity(`${imp('IMPLS, runHook')}describe.each(IMPLS)('x', (impl) => { runHook(h, impl, p); });`, hook)).toBeNull();
    expect(notParity(`${imp('IMPLS')}describe.each(IMPLS)('x', () => { execFileSync("bash", [HOOK]); });`, hook)).not.toBeNull();
    expect(notParity(`${imp('runHook')}runHook(h, 'bash', p);`, hook)).not.toBeNull();
    expect(notParity(`describe.each(IMPLS)('x', () => { runGoHook(home, p, env); });`, hook)).not.toBeNull();
    expect(notParity(`${imp('hookBoth')}hookBoth(home, p, env);`, hook)).toBeNull();
    expect(notParity(`${imp('runHook')}hookBoth(home, p, env);`, hook)).not.toBeNull();
    // The Go form counts only because the twin defines it on its runner.
    expect(fs.readFileSync(path.join(__dirname, 'hookTwin.ts'), 'utf8'))
      .toMatch(/export function runGoHook\([^)]*\) \{\n\s*return runHook\(/);
  });
  it.each(Object.entries(table.entries))('%s: the bash it stands in for has not changed unseen', (v, e) => {
    const digest = ownedDigest(v, e);
    if (digest !== e.ownsSha256) {
      throw new Error(`the bash this core entry (${v}) stands in for changed: change the Go verb in core/ to match, or, `
        + `if the behaviour did not change, record that by setting ownsSha256 to ${digest} in core/entries.json`);
    }
  });
  it.each(Object.entries(table.entries))('%s: every mode is bash or go on linux, darwin or windows', (_v, e) => {
    for (const [os, m] of Object.entries(e.mode ?? {})) {
      expect(['linux', 'darwin', 'windows']).toContain(os);
      expect(['bash', 'go']).toContain(m);
    }
  });
});
