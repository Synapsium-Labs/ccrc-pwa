#!/usr/bin/env node
// D-8636 (plan docs/superpowers/plans/2026-11-14-large-file-step0-split-tool.md; spec
// docs/superpowers/specs/2026-11-13-large-file-programme-design.md §2 item 4, §4, D-8615). The slice tool for the
// large-file programme's TypeScript and `.mjs` files. Every decision is `server/test/fileSplit.ts`'s; this script only
// reads arguments, files and git, and writes. It makes no `gh` call: the caller writes the heads file.
//
//   file-split.mjs plan      --source <file> --dest <file> --names a,b [--root <dir>]
//   file-split.mjs preflight --source <file> --dest <file> --names a,b --heads <json> [--base <ref>] [--self <n>]
//   file-split.mjs move      --source <file> --dest <file> --names a,b [--root <dir>]
//   file-split.mjs verdict   --base <ref> [--head <ref>] [--root <dir>]
//
// Paths are relative to --root (default: the working directory). Each verb prints one JSON document and exits 0 when it
// passes, 1 when it refuses, 2 on a usage error. `move` writes nothing unless its own output is a pure move. `verdict`
// prints null for a diff that adds no move marker (the comment `move` writes in front of what it moves).
// The heads file is `[{ "pr": <n>, "head": "<sha>", "move"?: { "source": "<file>", "dests": ["<file>", ...] } }]`:
// each head must be a commit the repository holds (`git fetch origin pull/<n>/head`).
import { registerHooks } from 'node:module';
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const usage = (msg) => {
  process.stderr.write(`file-split: ${msg}\n`);
  process.exit(2);
};

if (!process.features?.typescript) usage('this Node does not strip TypeScript types; use Node 22.18 or later');
if (typeof registerHooks !== 'function') usage('this Node has no module.registerHooks; use Node 22.18 or later');
// The library is TypeScript that imports its siblings as `./x.js`, the compiler's convention: map each to its source.
registerHooks({
  resolve(spec, ctx, next) {
    try {
      return next(spec, ctx);
    } catch (e) {
      if (e?.code === 'ERR_MODULE_NOT_FOUND' && /^\.\.?\//.test(spec) && spec.endsWith('.js')) return next(`${spec.slice(0, -3)}.ts`, ctx);
      throw e;
    }
  },
});
const lib = await import('../../server/test/fileSplit.ts');
const { readContextTable } = await import('../../server/test/rings/ringContextMap.ts');

const [verb, ...rest] = process.argv.slice(2);
const opts = {};
for (let i = 0; i < rest.length; i += 2) {
  const k = rest[i];
  if (!k?.startsWith('--') || rest[i + 1] === undefined) usage(`bad argument ${k ?? ''}`);
  opts[k.slice(2)] = rest[i + 1];
}
const root = path.resolve(opts.root ?? process.cwd());
const print = (doc, ok) => {
  process.stdout.write(`${JSON.stringify(doc, null, 2)}\n`);
  process.exit(ok ? 0 : 1);
};
const need = (...keys) => { for (const k of keys) if (opts[k] === undefined) usage(`${verb} needs --${k}`); };
const git = (...args) => execFileSync('git', ['--no-replace-objects', ...args], { cwd: root, encoding: 'utf8', stdio: 'pipe', maxBuffer: 256 * 1024 * 1024 });

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'coverage']);
/** Every code file under the root that names the source's stem, with the source and the destination. */
function program(source, dest) {
  const stem = path.basename(source).replace(/\.(?:ts|tsx|mts|mjs)$/, '');
  const out = new Map();
  const walk = (dir) => {
    for (const d of readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = dir === '' ? d.name : `${dir}/${d.name}`;
      if (d.isDirectory()) { if (!SKIP_DIRS.has(d.name)) walk(rel); continue; }
      if (!d.isFile() || !lib.isCodeFile(rel)) continue;
      const text = readFileSync(path.join(root, rel), 'utf8');
      if (rel === source || rel === dest || text.includes(stem)) out.set(rel, text);
    }
  };
  walk('');
  return out;
}
const request = () => {
  need('source', 'dest', 'names');
  return { source: opts.source, dest: opts.dest, names: opts.names.split(',').map((s) => s.trim()).filter(Boolean) };
};
const contextRows = () => { try { return readContextTable(root); } catch { return []; } };

if (verb === 'plan') {
  const req = request();
  const p = lib.planMove(req, program(req.source, req.dest));
  const rows = contextRows();
  print({
    source: req.source, dest: req.dest, moved: p.moved, destContexts: [lib.contextOf(rows, req.dest)].filter(Boolean),
    destUsesSource: p.destUsesSource, sourceUsesDest: p.sourceUsesDest, repointed: p.repointed, mentions: p.mentions,
    problems: p.problems,
  }, p.problems.length === 0);
} else if (verb === 'preflight') {
  const req = request();
  need('heads');
  const heads = JSON.parse(readFileSync(path.resolve(root, opts.heads), 'utf8'));
  if (!Array.isArray(heads)) usage('the heads file is a JSON array');
  const base = opts.base ?? 'origin/main';
  const touched = new Map();
  const unreadable = [];
  for (const h of heads) {
    try {
      const mb = git('merge-base', base, h.head).trim();
      const diff = git('diff', '-U0', '--no-color', '--no-ext-diff', mb, h.head, '--', req.source);
      let text = null;
      try { text = git('show', `${mb}:${req.source}`); } catch { /* the file is new on that head's base */ }
      touched.set(h.pr, text === null ? [] : lib.touchedDeclarations(text, req.source, lib.parseHunks(diff)));
    } catch {
      unreadable.push(h.pr);
    }
  }
  const rows = contextRows();
  const v = lib.preflightVerdict({
    source: req.source, dests: [req.dest], names: req.names, heads, touched, unreadable,
    contextOf: (f) => lib.contextOf(rows, f), self: opts.self === undefined ? undefined : Number(opts.self),
  });
  print(v, v.ok);
} else if (verb === 'move') {
  const req = request();
  const prog = program(req.source, req.dest);
  const p = lib.planMove(req, prog);
  if (p.problems.length > 0) print({ moved: [], problems: p.problems }, false);
  const before = new Map([...p.files.keys()].filter((f) => prog.has(f)).map((f) => [f, prog.get(f)]));
  const v = lib.pureMoveVerdict(before, p.files, new Map([...prog, ...p.files]));
  if (v === null || !v.pure) print({ moved: [], problems: ['the planned move is not pure; nothing was written'], verdict: v }, false);
  for (const [f, t] of p.files) {
    const abs = path.join(root, f);
    if (!existsSync(path.dirname(abs))) mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, t);
  }
  print({ moved: p.moved, files: [...p.files.keys()].sort(), repointed: p.repointed, mentions: p.mentions, verdict: v }, true);
} else if (verb === 'verdict') {
  need('base');
  const v = lib.branchVerdict(root, opts.base, opts.head ?? 'HEAD');
  print(v, v === null || v.pure);
} else {
  usage(`unknown verb ${verb ?? ''}: plan, preflight, move or verdict`);
}
