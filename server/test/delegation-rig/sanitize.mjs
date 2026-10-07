#!/usr/bin/env node
// sanitize.mjs — the delegation capture rig's raw run bundles -> the committed fixture corpus
// (delegation broker wave 1, spec 2026-10-04 §8.2). The captures are SYNTHETIC (mock API, fixture
// HOME, fixture repo); what could still leak is the box they ran on. So every spelling of the run
// root becomes `/rig` (its munged form `-rig`) and the binaries' directory `/rig/versions`, and then the WHOLE corpus is scanned by ALLOWLIST:
// an absolute path whose first segment starts with `[A-Za-z0-9._-]` (a first segment that starts with anything else is not scanned:
// see KNOWN LIMITS) is residue unless that segment is `rig`, `usr` or `bin` -- the WHOLE segment, which must be
// followed by `/`, `:` (a PATH separator), the end, or a character that ends a URL or a word (whitespace, a quote, a
// closer `)` `]` `}`, `<`, `>`, `,` `;`): `/rig~/srv/x` and `/usr@h/x` are residue -- or it is exactly `/dev/null`
// (the same rule minus `/`: `/dev/null/x`, `/dev/nullx` and `/dev/null~/x` are residue); so is `ccrc-dlg-rig`, `sk-ant-`,
// and the running user's name or the host's first label as a whole word (4+ characters, case-insensitive, letters only
// as word characters). Also residue: a `..` path segment at the string's start or right after a `/` (`../srv/x`, `/rig/../srv/x`; a
// `..` anywhere else is a KNOWN LIMIT), the running user's home directory in its munged spelling, a munged
// foreign path whose top MUNGED_FOREIGN lists (`-mnt-…`, `-home-…`: a DENYLIST of ten tops, see KNOWN LIMITS), and a `//`-led
// host or path:
//   - `//` followed by a character that cannot start a name (`[`, `@`, `%`, `~`, `:`, `\`, `$`...) is residue
//     (`http://[fd00::abcd]:8080/x`, `http://@h/x`, `//~/x`); `//` followed by whitespace, a quote, a closer, `<`, `>`,
//     `,` `;` or the end stays allowed (a code comment `// x`), and `///` is a run of slashes, read where it ends;
//   - `///<top>/...` (the third slash starts the path) is that path, and its first segment follows the rule above;
//   - `//<name>` at a host position is residue unless the name is the placeholder loopback address (an optional
//     `:<digits>` may follow it) or an allowed top (NO port: `http://rig:4000/x` is residue, it is not a host), and what
//     follows is accepted only as the end of the URL or a `/`-path scanned like any absolute path: `http://127.0.0.1:4000/srv/x`,
//     `http://127.0.0.1@host/x`, `http://127.0.0.1:abc`, `http://127.0.0.1?x`, `http://rig@host/x` and `//rig/home/x` are
//     residue, a bare `http://127.0.0.1:4000` is not;
//   - and any of these in an escaped spelling: `\uXXXX`, EVERY percent escape `%XX` (two hex digits, either case: `cat%20%2Fhome…`,
//     `http%3A%2F%2Fsrv.corp%2Fx`) and `\/`, each decoded in ONE pass (both the string and its decoded form are scanned).
// KNOWN LIMITS (each is pinned by a row that reds when the limit closes, so closing one means rewriting its line here):
//   - base64 (or any other encoding) of residue is not decoded and not chased. The decode is ONE pass per kind, in the fixed order
//     `\uXXXX`, `%XX`, `\/`, so an escape is chased only where an earlier pass produces a later kind (`\u0025` then `2F`;
//     `%5C%2F`). Anything else is not: the same kind twice (`%252F` reads `%2F` afterwards, `\u005Cu002F` reads `\u002F`), and a
//     later kind producing an earlier one (`%5Cu002F` reads `\u002F`).
//   - A `/` glued straight after a letter, a digit, `.`, `_`, `~` or `-` is not scanned (ABS's lookbehind; a `/` after a `/` is a run
//     of slashes, read where it ends). So `x/srv/acme`, `1/srv/acme`, `./srv/acme`, `a_/srv/acme`, `a-/srv/acme`, a home-anchored
//     `~/srv/acme` and a scheme-less `127.0.0.1:4000/home/x` all pass. A `/` after ANY other character (a space, `=`, `:`, a quote, a
//     bracket, `@`...) is scanned, with two exceptions, this one and the next limit: the `/` of a COMPLETE closing tag `</name>` (`<`,
//     `/`, a plain name, `>`): `x </srv> y` passes, because that is a tag and not a path (it hides one bare segment at most: `</srv/x>`
//     and `</srv.corp>` are residue).
//   - A `/` followed by a character outside ABS's segment class `[A-Za-z0-9._-]` is not scanned, so the FIRST segment of an absolute path
//     that starts with one is not: `x /~someone-else/acme`, `"/~someone-else/acme"`, `cd /~someone-else/acme && ls`, `x /@scope/srv/acme`,
//     `x /$HOME/srv/acme`, `x /+x/srv/acme`, `x /=x/srv/acme` and `x /%7Esomeone-else/acme` all pass. A LATER `/` of the path is scanned like
//     any other, so the rest of the path escapes only where that `/` follows a name character (the glued-slash limit above), as it does in
//     each of those: `x /@/srv/acme`, `x /~x:/srv/acme`, `x /~x@/srv/acme` and `x /~x=/srv/acme` are residue, and so is `x //~someone/acme` (a
//     `//` before such a character is DOUBLE_ODD's). `x /srv/acme` is residue. So "a `/` after any other character is scanned", and the
//     allowlist rule above, hold of a path whose first segment starts inside the class.
//   - A `..` segment is caught only at the string's START or right after a `/` (DOTDOT is `/(^|\/)\.\.(\/|$)/`). A `..` anywhere else -- after a
//     space, `=`, a quote... (`x ../srv/acme`, `x=../srv/acme`, `"../srv/acme"` inside a longer string, `x ..`) -- is not, and the `/`
//     behind it follows a `.`, the glued-slash limit above, so the path after it is not scanned either. The committed corpus holds such strings:
//     raw-worktree's own ` ../raw-wt` (two in each version's `raw-worktree.json`: 18 in 9 files at `c51428ae8`, 20 in 10 once `3cad0d2cd`
//     added 2.1.292), the rig's relative path to its own raw worktree,
//     so closing this limit means respelling that command and re-capturing, which the versions no longer installed cannot do.
//   - MUNGED_FOREIGN is a DENYLIST of tops, not a class: a munged foreign path is caught only when its top is one of `home mnt tmp
//     srv opt var root Users private proc` (case-sensitive), so `-data-…`, `-media-…` and `-Home-…` pass. Inside an allowed `/rig`
//     path it is the only check on a munged spelling.
// Any finding exits 1 naming the bundle and a JSON pointer. A pointer prints a key as TEXT only when the key is
// SAFE_SEG-shaped (1-40 of `[A-Za-z0-9_.-]`) AND carries no residue itself (so the pointer stays locatable in a synthetic
// bundle, whose key names are placeholder vocabulary: `/disk/admin/agent-abc/gitdir`); any other key, every residue-bearing
// key included, prints as `#<index>`, never its text. A bundle
// that cannot be read as a bundle (bad version directory, no `root` file, bad scenario name) is a finding too, and
// NOTHING is written: fixtures are built in a sibling of <fixtures-dir>, EVERY destination is checked before the first
// file is moved (a directory or a link where a fixture file would go, a symbolic link where a version directory would go,
// and a destination directory that exists but cannot be written, refuse the run with nothing moved), and the files move in
// only once all of them passed.
// An exception prints one fixed line (never its message, which names a raw path) and exits 1.
// `--scan <fixtures-dir>` writes nothing and runs that same scan over the COMMITTED corpus (every `*.json` in the directory and in
// its version directories: the fixtures and matrix.json), so a fixture committed with residue in it is found; see `scanCorpus`.
// It names a file by `<version>/#<index>` (or `#<index>`), never by its name, and refuses a file name by the test `main` applies to a
// scenario name: the NAME shape AND no residue in it. The index counts the directory's `*.json` entries that are REGULAR FILES (a
// stat, so a link to one counts), in UTF-16 code-unit order, the same as `LC_ALL=C ls` gives over those entries only for names in the
// Basic Multilingual Plane (BMP-only names; a UTF-8 locale's `ls` may differ). An entry named `*.json` that is not a regular file is not
// counted, so a later file's index is not the one `ls` would give it, and no FILE finding names it: a directory of that name inside a
// version directory, and a dangling link anywhere, produce no finding at all, and one in the top directory is judged as a version
// directory, whose name fails VERSION (a finding `#<i> (version directory name)`). That finding `#<i>`, for a directory whose name fails
// VERSION, counts among the directories, a sequence of its own, told apart from a file finding only by its suffix; a directory whose
// name passes is named by its text.
// An entry whose NAME is not valid UTF-8, at the top or immediately inside a version directory, is none of those (review 318 F2): a file,
// a directory, a link, whatever its type or suffix, it is a finding `#<j> (entry name not UTF-8)` (`<version>/#<j> (entry name not UTF-8)`
// inside a version directory), `j` its place among THAT directory's such entries in byte order, a sequence of its own, told apart only by
// its suffix, listed ahead of that directory's other findings. Its bytes are never printed, it is counted among neither the `*.json` files
// nor the directories, and a version directory so named is not descended into. `scanCorpus` reads each directory's names as bytes and
// decodes them with a FATAL decoder for this: a string read turns such a name into U+FFFD, and a stat of that string answers "not a
// file" and "not a directory", so the entry was skipped.
// Usage: node sanitize.mjs <raw-root> <fixtures-dir>
//        node sanitize.mjs --scan <fixtures-dir>
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const SCAN = args[0] === '--scan';
const [raw, outDir] = args;
// An EMPTY directory argument is a usage error in both modes (review 304 F5): `--scan ''` once reached `readdirSync('')` and printed the
// internal-error line, so a usage error and an I/O fault gave the same answer.
if (SCAN ? (args.length !== 2 || !outDir) : (!raw || !outDir || args.length > 2)) {
  process.stderr.write('usage: node sanitize.mjs <raw-root> <fixtures-dir>\n       node sanitize.mjs --scan <fixtures-dir>\n');
  process.exit(2);
}

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
// Munged FOREIGN paths: `-mnt-<vol>-projects-…`, `-home-<user>-…`, `-Users-…`. A DENYLIST of these ten tops, case-sensitive, NOT the
// class (F12): `-data-…`, `-media-…` and `-Home-…` pass, and the header names that as a KNOWN LIMIT. An allowlist (only `-rig…`) would
// refuse ordinary flags such as `-data-dir`.
const MUNGED_FOREIGN = /(^|[^A-Za-z0-9])-(home|mnt|tmp|srv|opt|var|root|Users|private|proc)-/;
// `:` is a BOUNDARY, not a continuation: a PATH-like `/usr/bin:/home/<user>/.bin` carries a second absolute path.
// A COMPLETE closing tag (`</result>`: `<`, `/`, a plain name, `>`) is a tag, not the path `/result` (Claude Code's
// <task-notification> prompt). A name with `.` or `:` (`</srv.corp:8080>`) is a host:port, not a tag.
// `<` alone is NOT a boundary: `sort</srv/data/list` is a redirect from a real path.
const ABS = /(?<![A-Za-z0-9._~/-])(?!(?<=<)\/[A-Za-z][A-Za-z0-9_-]*>)\/([A-Za-z0-9._-]+)/g;
// A `//`-led name: `file:///srv/x`, `//fileserver/share`, `http://internal-host.corp/p`. At a host position only an
// allowed top, or the placeholder loopback address, may follow; a `//` INSIDE a path (`/rig//x`) is a join artefact, not a host.
const DOUBLE = /(?<![A-Za-z0-9._~-])\/\/([A-Za-z0-9._-]+)/g;
const ALLOWED_TOP = new Set(['rig', 'usr', 'bin']);
const ALLOWED_HOST = new Set(['127.0.0.1']);
// A path segment of `..` walks out of whatever allowed top precedes it (`/rig/../srv/x`, `../../srv/x`).
const DOTDOT = /(^|\/)\.\.(\/|$)/;
// The escaped spellings of `/` and of any character a JSON string may carry as `\uXXXX`, EVERY percent escape `%XX` (two hex digits,
// either case: F1, review 296 -- `cat%20%2Fhome…` shows its path only once the `%20` before it is decoded too, because a `/` glued
// after a name character is never scanned), and a JSON-escaped slash `\/` (N1: `http:\/\/[fd00::abcd]:8080` shows its `//` host
// only once decoded). Each is ONE pass over the string, in that order: `%252F` is `%2F` afterwards and is not chased. A `%` that is
// not followed by two hex digits stays as it is: this never throws (`decodeURIComponent` does, on `%E0%A4%A`).
const decode = (s) => s.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
  .replace(/%([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/\\\//g, '/');
// Characters that END a URL or a word, so nothing is hidden behind them: whitespace, a quote, a backtick, a closer `)` `]`
// `}`, `<`, `>`, `,` and `;`. `.`, `:`, `?`, `#`, `@`, `\`, `~`, `%`, `=`, `+` and the rest can CONTINUE one, so they are not here.
const END_CHARS = '\\s"\'`)\\]}<>,;';
const URL_END = new RegExp(`^(?:$|[${END_CHARS}])`);
// What may follow a path's WHOLE first segment (I1): `/`, `:` (a PATH separator: ABS reads what follows as a path of its own),
// the end, or a character that ends a URL or a word. ABS's segment class stops at `~`, `@`, `+`, `%`..., and a `/` after one of
// those is never scanned, so a segment glued to such a character is residue, not a first segment that happens to be allowed.
const AFTER_SEG = new RegExp(`^(?:$|[/:${END_CHARS}])`);
// `/dev/null` is exempt only as the WHOLE path (F1b/F2a/I1): AFTER_SEG's rule minus `/` (`/dev/null/srv/acme` is a path
// under it, whose tail would otherwise never be scanned), and anchored at the segment (`/dev/shm/null` is not it).
const DEV_NULL_REST = new RegExp(`^/null(?:$|[:${END_CHARS}])`);
// Is an absolute path whose first segment is `top`, and which continues with `rest` (the text after that segment), residue?
const topResidue = (top, rest) => (ALLOWED_TOP.has(top) ? !AFTER_SEG.test(rest) : !(top === 'dev' && DEV_NULL_REST.test(rest)));
// After an allowed loopback host: an optional numeric port, then the END of the URL or a `/`-path.
const LOOPBACK_PORT = /^:[0-9]+/;
// A `/`-path after an allowed host: slashes, then a first segment the allowlist accepts. Slashes with no segment after them
// are accepted only at the end of the URL (`http://127.0.0.1:4000/`); `/~/x`, `/@x/x` and `/?x/x` hide a path and are residue.
const SLASHES = /^\/+/;
const SEGMENT = /^[A-Za-z0-9._-]+/;
// `//` at a host position (DOUBLE's lookbehind) followed by a character that cannot start a name (I3b): `[`, `@`, `%`, `~`, `:`,
// `\`, `$`... A following name is DOUBLE's, a following `/` is a longer run of slashes (read where it ends), and whitespace, a
// quote, a closer, `<`, `>`, `,` `;` or the end leave nothing hidden (a code comment `// x`).
const DOUBLE_ODD = new RegExp(`(?<![A-Za-z0-9._~-])//(?![A-Za-z0-9._/-]|$|[${END_CHARS}])`);
// What follows an allowed `//<host>` (after its port, if it may have one) is residue unless it is the end of the URL or a
// `/`-path whose first segment the allowlist accepts.
function hostTailResidue(rest) {
  if (URL_END.test(rest)) return false;
  const slashes = SLASHES.exec(rest);
  if (slashes === null) return true;
  const after = rest.slice(slashes[0].length);
  const seg = SEGMENT.exec(after);
  if (seg === null) return !URL_END.test(after);
  return topResidue(seg[0], after.slice(seg[0].length));
}
function residue1(s) {
  for (const m of s.matchAll(ABS)) if (topResidue(m[1], s.slice(m.index + m[0].length))) return true;
  for (const m of s.matchAll(DOUBLE)) {
    const rest = s.slice(m.index + 2 + m[1].length);
    // `///x`: this `//` is the tail of a run of slashes and the path starts at the third (`file:///rig/x` is `/rig/x`).
    if (m.index > 0 && s[m.index - 1] === '/') { if (topResidue(m[1], rest)) return true; continue; }
    const loopback = ALLOWED_HOST.has(m[1]);
    if (!loopback && !ALLOWED_TOP.has(m[1])) return true;
    // An allowed host (I3a: an allowed TOP is read the same way, but has no port): ABS never starts a match at a `/` that follows
    // a digit or a letter, so what follows `host[:port]` is scanned HERE (F1a). The ONLY accepted continuations are the end of
    // the URL, `:<digits>` (loopback only) then the end or a `/`-path, or a `/`-path whose first segment the allowlist accepts;
    // ANY other continuation (`@` userinfo, `:abc`, `?`, `#`, `\`, a glued `%`...) is residue, however benign what follows it
    // reads. (A name glued on with `.`, `-` or `_` never gets here: DOUBLE's name class takes it into m[1], and
    // `127.0.0.1.x` is not an allowed host.)
    const port = loopback ? LOOPBACK_PORT.exec(rest) : null;
    if (hostTailResidue(port === null ? rest : rest.slice(port[0].length))) return true;
  }
  if (DOUBLE_ODD.test(s)) return true;
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
// `tally` (optional, `--scan` only) counts the strings and the keys this looked at.
const scan = (v, ptr, where, findings, tally = null) => {
  if (typeof v === 'string') { if (tally !== null) tally.strings += 1; if (residue(v)) findings.push(`${where} ${ptr || '/'}`); return; }
  if (Array.isArray(v)) { v.forEach((x, i) => scan(x, `${ptr}/${i}`, where, findings, tally)); return; }
  if (v !== null && typeof v === 'object') {
    Object.entries(v).forEach(([k, x], i) => {
      if (tally !== null) tally.keys += 1;
      const seg = SAFE_SEG.test(k) && !residue(k) ? k : `#${i}`;
      if (residue(k)) findings.push(`${where} ${ptr}/#${i} (key)`);
      scan(x, `${ptr}/${seg}`, where, findings, tally);
    });
  }
};

const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };
// A path that IS a symbolic link (lstat, not stat: a dangling link is one too). A path it cannot look at is not judged here:
// the checks that follow it look at the same path and throw to the fixed-line catch below, before anything moves.
const isLink = (p) => { try { return fs.lstatSync(p).isSymbolicLink(); } catch { return false; } };
// A directory this process may write into (a regular user's 0555 directory is not). Any failure to write is "not writable":
// the run refuses with a fixed line before anything moves.
const writable = (p) => { try { fs.accessSync(p, fs.constants.W_OK); return true; } catch { return false; } };
// 'absent' (ENOENT only), 'file' (a regular file, which a rename may replace) or 'other'. Any OTHER failure to look
// throws, to the fixed-line catch below, before anything moves: an unreadable destination is not an absent one.
const destKind = (p) => {
  try { return fs.lstatSync(p).isFile() ? 'file' : 'other'; } catch (e) { if (e !== null && typeof e === 'object' && e.code === 'ENOENT') return 'absent'; throw e; }
};

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
      // A version directory that is a symbolic link is refused (N2): followed, a link onto another filesystem half-moves
      // (EXDEV on the second rename) and a link on this one writes outside the fixtures directory.
      if (isLink(dest)) { process.stderr.write(`sanitize: ${v} in the fixtures directory is a symbolic link\n`); return 1; }
      if (fs.existsSync(dest) && !isDir(dest)) { process.stderr.write(`sanitize: ${v} exists in the fixtures directory and is not a directory\n`); return 1; }
      // A destination directory that exists but cannot be written would fail the rename AFTER the earlier versions moved in (M2):
      // the version directory itself, and the fixtures directory when this version's directory has to be created in it.
      if (isDir(dest) ? !writable(dest) : isDir(out) && !writable(out)) {
        process.stderr.write(isDir(dest) ? `sanitize: ${v} in the fixtures directory is not writable\n` : 'sanitize: the fixtures directory is not writable\n');
        return 1;
      }
      // EVERY destination file is checked before the first one moves (F13): a directory (or a link) where a fixture
      // would go refuses the run with nothing moved, not with the earlier versions already in place.
      for (const n of fs.readdirSync(path.join(tmp, v))) {
        if (destKind(path.join(dest, n)) === 'other') { process.stderr.write(`sanitize: ${v} holds an entry that is not a regular file where a fixture would go\n`); return 1; }
      }
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
// `--scan <fixtures-dir>` (F9, review 296): the committed corpus's own check. It reads `<dir>/*.json` (matrix.json) and
// `<dir>/<version>/*.json` and runs the SAME `scan` over each one -- `residue()` on every string value and every key, the
// same pointers -- that `main` runs over a bundle, so a fixture committed with residue in it is found by the scan that would
// have refused it. It writes nothing. A fixture file that is not JSON, a directory that is not a version and a file whose
// name is not a name (`main`'s own test for a scenario name: the NAME shape AND no residue in it) are findings, and so is a
// directory with no JSON file in it at all: a mistyped path must not pass as a clean corpus. EVERY finding names a file by
// `<version>/#<index>` (or `#<index>` for the top directory), never by its name: the index is its place among the directory's
// `*.json` entries that are REGULAR FILES (`jsonIn`: a stat), sorted by UTF-16 code unit (the same as `LC_ALL=C ls` gives over those
// entries only for BMP-only names; a UTF-8 locale's `ls` may differ). An entry named `*.json` that is not a regular file is not counted and
// no file finding names it (a directory of that name in a version directory, and a dangling link anywhere, give no finding at all; one in
// the top directory is judged as a version directory). A directory whose name FAILS VERSION is named `#<i>` among the directories, a
// sequence of its own, told apart from a file finding only by its suffix `(version directory name)`; one that passes is named by its
// digits-and-dots text, and only then. An entry whose NAME is not valid UTF-8 (review 318 F2), at the top or immediately inside a version
// directory, is neither counted nor skipped: whatever its type or suffix it is a finding `#<j> (entry name not UTF-8)` (`<version>/#<j> ...`
// inside a version directory), `j` its place among THAT directory's such entries in byte order, a sequence of its own told apart by its
// suffix, listed ahead of that directory's other findings, and its bytes are never printed. The names are read as Buffers (`namesIn`) and
// decoded with a fatal decoder, never as strings, which would turn the name into U+FFFD, a path that does not exist, for `isFile` and
// `isDir` to answer false about. A version directory so named is not descended into. The decoder keeps a leading BOM (`ignoreBOM`): a name
// that begins with U+FEFF is a valid name and must reach `isFile`/`isDir` as it is on disk, not with the BOM stripped.
function scanCorpus(dir) {
  const findings = [];
  const tally = { files: 0, strings: 0, keys: 0 };
  const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  // The names of `d` that are valid UTF-8, in code-unit order; every other entry, of any type, is a finding `<prefix>#<j> (entry name not
  // UTF-8)` (j counted among those entries, in byte order) and is in no sequence below. Its bytes are never printed.
  // `.sort(Buffer.compare)` fixes which entry `#j` means; no output shows it, since a finding carries only its j. The names' `.sort()`
  // keeps the index independent of the listing order; `readdirSync` happens to list in byte order already (libuv sorts), so no row reds its
  // removal.
  const namesIn = (d, prefix) => {
    const names = [];
    const bad = [];
    for (const b of fs.readdirSync(d, { encoding: 'buffer' })) {
      try { names.push(utf8.decode(b)); } catch { bad.push(b); }
    }
    bad.sort(Buffer.compare).forEach((_, j) => findings.push(`${prefix}#${j} (entry name not UTF-8)`));
    return names.sort();
  };
  const jsonIn = (d, names) => names.filter((n) => n.endsWith('.json') && isFile(path.join(d, n)));
  const readAll = (d, names, prefix) => names.forEach((n, i) => {
    const base = n.slice(0, -'.json'.length);
    if (!NAME.test(base) || residue(base)) { findings.push(`${prefix}#${i} (fixture file name)`); return; }
    let f;
    try { f = JSON.parse(fs.readFileSync(path.join(d, n), 'utf8')); } catch { findings.push(`${prefix}#${i} (unreadable JSON)`); return; }
    tally.files += 1;
    scan(f, '', `${prefix}#${i}`, findings, tally);
  });
  const top = namesIn(dir, '');
  readAll(dir, jsonIn(dir, top), '');
  top.filter((n) => isDir(path.join(dir, n))).forEach((v, vi) => {
    if (!VERSION.test(v)) { findings.push(`#${vi} (version directory name)`); return; }
    const vdir = path.join(dir, v);
    readAll(vdir, jsonIn(vdir, namesIn(vdir, `${v}/`)), `${v}/`);
  });
  if (findings.length > 0) {
    for (const x of findings) process.stderr.write(`sanitize: residue in ${x}\n`);
    return 1;
  }
  if (tally.files === 0) { process.stderr.write('sanitize: nothing to scan in the fixtures directory\n'); return 1; }
  process.stdout.write(`sanitize: scanned ${tally.files} file(s), ${tally.strings} string(s), ${tally.keys} key(s): no residue\n`);
  return 0;
}
try {
  process.exitCode = SCAN ? scanCorpus(outDir) : main();
} catch {
  // An I/O error's message names a raw path: print a fixed line, never the exception.
  process.stderr.write('sanitize: internal error (no detail printed)\n');
  process.exitCode = 1;
}
