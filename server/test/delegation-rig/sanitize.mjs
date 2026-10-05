#!/usr/bin/env node
// sanitize.mjs — the delegation capture rig's raw run bundles -> the committed fixture corpus
// (delegation broker wave 1, spec 2026-10-04 §8.2). The captures are SYNTHETIC (mock API, fixture
// HOME, fixture repo); what could still leak is the box they ran on. So every spelling of the run
// root becomes `/rig` (its munged form `-rig`) and the binaries' directory `/rig/versions`, and then the WHOLE corpus is scanned by ALLOWLIST:
// an absolute path is residue unless its first segment is `rig`, `usr` or `bin`, or it is
// `/dev/null`; so is `ccrc-dlg-rig`, `sk-ant-`, and the running user's name or the host's first
// label as a whole word (4+ characters, case-insensitive, letters only as word characters). Also residue: a `..` path
// segment, a `//`-led host or path (`file:///srv/x`, `//share/x`), a munged foreign path (`-mnt-…`, `-home-…`), and
// any of these in a `\uXXXX`- or `%2F`-escaped spelling (both the string and its decoded form are scanned).
// KNOWN LIMIT: base64 (or any other encoding) of residue is not decoded and not chased.
// Any finding exits 1 naming the bundle and a JSON pointer — a key is named by its INDEX, never its text — a bundle
// that cannot be read as a bundle (bad version directory, no `root` file, bad scenario name) is a finding too, and
// NOTHING is written: fixtures are built in a sibling of <fixtures-dir> and moved in only once all of them passed.
// An exception prints one fixed line (never its message, which names a raw path) and exits 1.
// Usage: node sanitize.mjs <raw-root> <fixtures-dir>
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [raw, outDir] = process.argv.slice(2);
if (!raw || !outDir || process.argv.length > 4) { process.stderr.write('usage: node sanitize.mjs <raw-root> <fixtures-dir>\n'); process.exit(2); }

const CAP_NAME = /^([A-Za-z]{1,40})-([0-9]{1,16})-([0-9]{1,10})\.cap$/;
const NAME = /^[a-z0-9-]{1,40}$/;
const VERSION = /^[0-9]+\.[0-9]+\.[0-9]+$/;
const munge = (p) => p.replace(/[^A-Za-z0-9]/g, '-');
const readLines = (f) => { try { return fs.readFileSync(f, 'utf8').split('\n').filter((l) => l.length > 0); } catch { return []; } };
const readTrim = (f) => { try { return fs.readFileSync(f, 'utf8').trim(); } catch { return null; } };
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };

function replacer(roots, versionsDir) {
  const pairs = [];
  for (const r of roots) pairs.push([r, '/rig'], [munge(r), '-rig']);
  if (versionsDir) pairs.push([versionsDir, '/rig/versions'], [munge(versionsDir), '-rig-versions']);
  pairs.sort((a, b) => b[0].length - a[0].length);
  const fix = (s) => { let t = s; for (const [from, to] of pairs) t = t.split(from).join(to); return t; };
  const walk = (v) => {
    if (typeof v === 'string') return fix(v);
    if (Array.isArray(v)) return v.map(walk);
    if (v !== null && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [fix(k), walk(x)]));
    return v;
  };
  return walk;
}

function readTree(dir) {
  const out = {};
  const visit = (d, rel) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((x, y) => (x.name < y.name ? -1 : 1))) {
      const r = rel === '' ? e.name : `${rel}/${e.name}`;
      if (e.isDirectory()) visit(path.join(d, e.name), r);
      else out[r] = e.name.endsWith('.json') ? readJson(path.join(d, e.name)) : readLines(path.join(d, e.name));
    }
  };
  if (fs.existsSync(dir)) visit(dir, '');
  return out;
}

function bundle(dir) {
  const walk = replacer([...new Set(readLines(path.join(dir, 'root')))], readTrim(path.join(dir, 'versions-dir')));
  const capDir = path.join(dir, 'caps');
  const caps = (fs.existsSync(capDir) ? fs.readdirSync(capDir) : [])
    .map((name) => ({ name, m: CAP_NAME.exec(name) })).filter((c) => c.m !== null)
    .map((c) => ({ name: c.name, event: c.m[1], ms: Number(c.m[2]), pid: Number(c.m[3]) }))
    .sort((a, b) => a.ms - b.ms || a.pid - b.pid);
  const t0 = caps.length > 0 ? caps[0].ms : 0;
  const events = caps.map((c, i) => {
    const text = fs.readFileSync(path.join(capDir, c.name), 'utf8');
    const nl = text.indexOf('\n');
    let envSid = null;
    try { const m = JSON.parse(nl === -1 ? text : text.slice(0, nl)); envSid = typeof m.envSid === 'string' && m.envSid !== '' ? m.envSid : null; } catch { /* null */ }
    let payload = null;
    try { const p = JSON.parse(nl === -1 ? '' : text.slice(nl + 1)); payload = p !== null && typeof p === 'object' && !Array.isArray(p) ? p : null; } catch { /* null */ }
    return { seq: i + 1, dtMs: c.ms - t0, event: c.event, envSid, payload };
  });
  const admin = {};
  const admDir = path.join(dir, 'admin');
  for (const n of (fs.existsSync(admDir) ? fs.readdirSync(admDir).sort() : [])) {
    const a = path.join(admDir, n);
    admin[n] = {
      files: readLines(path.join(a, 'files')), gitdir: readTrim(path.join(a, 'gitdir')), head: readTrim(path.join(a, 'HEAD')),
      claudeBase: readTrim(path.join(a, 'CLAUDE_BASE')), locked: fs.existsSync(path.join(a, 'locked')),
      firstLogSha: readTrim(path.join(a, 'first-log-sha')),
    };
  }
  const metas = {};
  for (const [k, v] of Object.entries(readTree(path.join(dir, 'meta')))) if (k.endsWith('.meta.json')) metas[k] = v;
  const snapshots = {};
  for (const [k, v] of Object.entries(readTree(path.join(dir, 'snapshots')))) {
    const [name, file] = k.split('/');
    (snapshots[name] ??= {})[file === 'admin-records' ? 'adminRecords' : 'worktrees'] = v;
  }
  const labels = readJson(path.join(dir, 'labels'));
  return walk({
    v: 1, version: readTrim(path.join(dir, 'version')), scenario: readTrim(path.join(dir, 'scenario')),
    labels: Array.isArray(labels) ? labels : [], notes: readLines(path.join(dir, 'notes')), events,
    disk: {
      admin, worktreesLeft: readLines(path.join(dir, 'worktrees-left')), branches: readLines(path.join(dir, 'branches')),
      worktreeList: readTrim(path.join(dir, 'worktree-list')) ?? '', metas, snapshots,
    },
  });
}

const esc = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// A residue WORD is the user's name or the host's first label, 4+ characters, matched case-insensitively with
// LETTERS as the only word characters: `<user>2`, `x_<user>` and `<USER>` all fail; `<user>x` is a different word.
const WORDS = [os.userInfo().username, os.hostname().split('.')[0]]
  .filter((w) => typeof w === 'string' && w.length >= 4)
  .map((w) => new RegExp(`(^|[^A-Za-z])${esc(w)}($|[^A-Za-z])`, 'i'));
// The user's home directory in its munged spelling (every non-alphanumeric as `-`), as Claude Code names a project dir.
const HOME_MUNGED = (() => { const m = munge(os.homedir()); return m.length >= 4 ? m : null; })();
// Munged FOREIGN paths: `-mnt-<vol>-projects-…`, `-home-<user>-…`, `-Users-…`. Only `-rig` survives the replacer.
const MUNGED_FOREIGN = /(^|[^A-Za-z0-9])-(home|mnt|tmp|srv|opt|var|root|Users|private|proc)-/;
// `:` is a BOUNDARY, not a continuation: a PATH-like `/usr/bin:/home/<user>/.bin` carries a second absolute path.
// A COMPLETE closing tag (`</result>`: `<`, `/`, a plain name, `>`) is a tag, not the path `/result` (Claude Code's
// <task-notification> prompt). A name with `.` or `:` (`</srv.corp:8080>`) is a host:port, not a tag.
// `<` alone is NOT a boundary: `sort</srv/data/list` is a redirect from a real path.
const ABS = /(?<![A-Za-z0-9._~/-])(?!(?<=<)\/[A-Za-z][A-Za-z0-9_-]*>)\/([A-Za-z0-9._-]+)/g;
// A `//`-led name: `file:///srv/x`, `//fileserver/share`, `http://internal-host.corp/p`. Only an allowed top, or
// the placeholder loopback address, may follow; a `//` INSIDE a path (`/rig//x`) is a join artefact, not a host.
const DOUBLE = /(?<![A-Za-z0-9._~-])\/\/([A-Za-z0-9._-]+)/g;
const ALLOWED_TOP = new Set(['rig', 'usr', 'bin']);
const ALLOWED_HOST = new Set(['127.0.0.1']);
// A path segment of `..` walks out of whatever allowed top precedes it (`/rig/../srv/x`, `../../srv/x`).
const DOTDOT = /(^|\/)\.\.(\/|$)/;
// The escaped spellings of `/` and of any character a JSON string may carry as `\uXXXX`, and percent-encoded `/`.
const decode = (s) => s.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/%2[Ff]/g, '/');
function residue1(s) {
  for (const m of s.matchAll(ABS)) {
    if (ALLOWED_TOP.has(m[1])) continue;
    if (m[1] === 'dev' && s.startsWith('/null', m.index + m[0].length) && !/[A-Za-z0-9._-]/.test(s[m.index + m[0].length + 5] ?? '')) continue;
    return true;
  }
  for (const m of s.matchAll(DOUBLE)) if (!ALLOWED_TOP.has(m[1]) && !ALLOWED_HOST.has(m[1])) return true;
  if (DOTDOT.test(s)) return true;
  if (MUNGED_FOREIGN.test(s) || (HOME_MUNGED !== null && s.includes(HOME_MUNGED))) return true;
  return /ccrc-dlg-rig/i.test(s) || /sk-ant-/i.test(s) || WORDS.some((re) => re.test(s));
}
// Both the string as it stands and its decoded spelling are scanned. Base64 (or any other encoding) of residue is a
// KNOWN LIMIT: it is not decoded and not chased.
function residue(s) {
  const d = decode(s);
  return residue1(s) || (d !== s && residue1(d));
}
const SAFE_SEG = /^[A-Za-z0-9_.-]{1,40}$/;
const scan = (v, ptr, where, findings) => {
  if (typeof v === 'string') { if (residue(v)) findings.push(`${where} ${ptr || '/'}`); return; }
  if (Array.isArray(v)) { v.forEach((x, i) => scan(x, `${ptr}/${i}`, where, findings)); return; }
  if (v !== null && typeof v === 'object') {
    Object.entries(v).forEach(([k, x], i) => {
      const seg = SAFE_SEG.test(k) && !residue(k) ? k : `#${i}`;
      if (residue(k)) findings.push(`${where} ${ptr}/#${i} (key)`);
      scan(x, `${ptr}/${seg}`, where, findings);
    });
  }
};

const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };

function main() {
  const findings = [];
  const fixtures = [];
  const versionDirs = fs.readdirSync(raw).sort().filter((n) => isDir(path.join(raw, n)));
  versionDirs.forEach((v, vi) => {
    if (!VERSION.test(v)) { findings.push(`#${vi} (version directory name)`); return; }
    fs.readdirSync(path.join(raw, v)).sort().filter((n) => isDir(path.join(raw, v, n))).forEach((s, si) => {
      const d = path.join(raw, v, s);
      if (!fs.existsSync(path.join(d, 'root'))) { findings.push(`${v}/#${si} (bundle without a root file)`); return; }
      if (!NAME.test(s) || residue(s)) { findings.push(`${v}/#${si} (scenario directory name)`); return; }
      const f = bundle(d);
      scan(f, '', `${v}/${s}`, findings);
      fixtures.push({ v, s, f });
    });
  });
  if (findings.length > 0) {
    for (const x of findings) process.stderr.write(`sanitize: residue in ${x}\n`);
    return 1;
  }
  // Nothing reaches outDir until EVERY bundle has passed AND been written: build in a sibling, then move in.
  const out = path.resolve(outDir);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const tmp = fs.mkdtempSync(path.join(path.dirname(out), '.sanitize-tmp-'));
  try {
    for (const { v, s, f } of fixtures) {
      fs.mkdirSync(path.join(tmp, v), { recursive: true });
      fs.writeFileSync(path.join(tmp, v, `${s}.json`), `${JSON.stringify(f, null, 1)}\n`);
    }
    if (fs.existsSync(out) && !isDir(out)) { process.stderr.write('sanitize: the fixtures path exists and is not a directory\n'); return 1; }
    for (const v of fs.readdirSync(tmp)) {
      const dest = path.join(out, v);
      if (fs.existsSync(dest) && !isDir(dest)) { process.stderr.write(`sanitize: ${v} exists in the fixtures directory and is not a directory\n`); return 1; }
    }
    fs.mkdirSync(out, { recursive: true });
    for (const v of fs.readdirSync(tmp)) {
      fs.mkdirSync(path.join(out, v), { recursive: true });
      for (const n of fs.readdirSync(path.join(tmp, v))) fs.renameSync(path.join(tmp, v, n), path.join(out, v, n));
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  process.stdout.write(`sanitize: ${fixtures.length} fixture(s) written\n`);
  return 0;
}
try {
  process.exitCode = main();
} catch {
  // An I/O error's message names a raw path: print a fixed line, never the exception.
  process.stderr.write('sanitize: internal error (no detail printed)\n');
  process.exitCode = 1;
}
