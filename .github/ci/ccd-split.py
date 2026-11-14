#!/usr/bin/env python3
"""The ccd file split's slice tool (docs/superpowers/plans/2026-11-06-ccd-file-split.md, Task 1; D-8048, D-8634).

    ccd-split.py plan <slice> [--record]          functions, lines, runs and citations; --record writes the record
    ccd-split.py preflight <slice> --heads FILE   exit 0 only when no open PR head touches a function of the slice
    ccd-split.py move <slice> --heads FILE [--regenerate]
    ccd-split.py unmove <library>
    ccd-split.py check-regions FILE|-             every region of a bash text, checked alone (JSON on stdout)

<slice> is a library name or a move order from .github/ci/ccd-split-slices.tsv.

THE REGION RULE (Task 1 Step 4). A definition is a column-0 `name() {` line. Its end is the first line, before the
next definition, at which `bash -n` accepts the span with exit 0 and an empty stderr (an unclosed heredoc is only a
warning). Only a line where `}` can be a reserved word is tried: at the start of the line or after a blank, `;`, `&`
or `|`, and before the end of the line, a blank, `;`, `&`, `|`, `)` or a redirection. Its lead is the `#` block
directly above, stopping at a `# @ccd-lib:` pointer line. A RUN is the regions of one slice with only comment and
blank lines between them; a top-level statement, another region or a pointer line ends it. Each region is then
evaluated alone in an empty shell: it must define exactly one function, its own, and no variable.

THE YIELD CHECK (S1, D-8634). Open work goes first: `preflight` and `move` take `--heads FILE`, the open PR heads
the caller lists (one per line: a ref or sha, then an optional label such as `#2803`; `#` lines and blank lines
are skipped; an empty file says no PR is open). For each head, the diff from its merge-base with HEAD to the head
is read for ccd/ccd and every ccd/lib/*.sh, and each hunk is mapped to the functions whose region or lead it
touches at the merge-base (an insertion touches the functions on both sides of it). A slice that holds any of them
is refused, naming each blocking head and its functions. A head that is not in this repository refuses too: fetch
it first. The tool never calls gh and never fetches, so its tests stay offline.

`move` writes ccd/lib/<library>.sh, one pointer line per run, the library's word in `__CCD_LIBS` and the
reordered ccd/contexts.tsv rows, and refuses without exactly one `__CCD_LIBS=(` line (Task 4 adds it). `unmove`
puts each region back at its pointer. Both refuse `die`, `_roster_fp_to`, `_ccd_lib_load` and every K row.
"""
import argparse
import bisect
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

DEF_RE = re.compile(r'^([A-Za-z_][A-Za-z0-9_]*)\(\) *\{')
POINTER_RE = re.compile(r'^# @ccd-lib:(\w+)\b')
MARKER_RE = re.compile(r'^# @ccd-lib:(\w+)$')
CLOSER_RE = re.compile(r'(?:^|[\s;&|])\}(?=$|[\s;&|)<>])')
LIBS_RE = re.compile(r'^__CCD_LIBS=\(([a-z0-9 -]*)\)( .*)?$')
CITATION_RE = re.compile(r'ccd:[0-9]{3,5}\b|\.(?:ts|tsx|mjs|sh):[0-9]+\b')
LIBRARY_RE = re.compile(r'^[a-z0-9][a-z0-9-]*$')
SPINE = ('die', '_roster_fp_to', '_ccd_lib_load')
# Names bash sets for itself; a region that only touches these sets no variable.
SHELL_OWN = re.compile(r'^(?:_|BASH.*|PIPESTATUS|FUNCNAME|GROUPS|LINENO|RANDOM|SRANDOM|SECONDS|EPOCHREALTIME|'
                       r'EPOCHSECONDS|HISTCMD|PPID|SHLVL|OLDPWD|PWD|COLUMNS|LINES|DIRSTACK|OPTIND|OPTERR|IFS|'
                       r'PS[0-4]|SHELLOPTS|COMP_WORDBREAKS|HISTFILE|HISTFILESIZE|HISTSIZE|MAILCHECK|HOSTNAME|'
                       r'HOSTTYPE|MACHTYPE|OSTYPE|UID|EUID|SHELL|TERM|PATH|HOME|LC_ALL|f)$')

CCD = 'ccd/ccd'
CONTEXTS = 'ccd/contexts.tsv'
SLICES = '.github/ci/ccd-split-slices.tsv'
RECORDS = 'server/test/ccd-split-records'


class Refusal(Exception):
    """A refusal: printed as one `ccd-split: refused (...)` block, exit 1."""


def bash() -> str:
    b = shutil.which('bash')
    if not b:
        raise Refusal('no bash on PATH')
    return b


def bash_accepts(text: str) -> bool:
    r = subprocess.run([bash(), '-n'], input=text, capture_output=True, text=True, timeout=120)
    return r.returncode == 0 and r.stderr == ''


class Regions:
    """The regions of one bash text, found lazily: each definition's end costs `bash -n` runs, so a caller that
    needs a few definitions (the yield check maps a hunk to one or two) pays for those alone."""

    def __init__(self, text: str):
        self.lines = text.split('\n')
        self.defs = [i for i, line in enumerate(self.lines) if DEF_RE.match(line)]
        self.names = [DEF_RE.match(self.lines[d]).group(1) for d in self.defs]
        self._end: dict[int, int] = {}

    def end(self, k: int) -> int:
        if k not in self._end:
            d = self.defs[k]
            limit = self.defs[k + 1] if k + 1 < len(self.defs) else len(self.lines)
            for j in range(d, limit):
                if CLOSER_RE.search(self.lines[j]) and bash_accepts('\n'.join(self.lines[d:j + 1]) + '\n'):
                    self._end[k] = j
                    break
            else:
                raise Refusal(f'{self.names[k]}: no line before the next definition closes it (bash -n)')
        return self._end[k]

    def lead(self, k: int) -> int:
        i = self.defs[k]
        while i > 0:
            above = self.lines[i - 1]
            if not re.match(r'\s*#', above) or POINTER_RE.match(above) or above.startswith('#!') \
                    or above.startswith('# ccrc:stamp-at-install'):
                break
            i -= 1
        return i

    def function_at(self, line: int):
        """The function whose region or lead holds 0-based `line`, or None for a top-level line."""
        k = bisect.bisect_right(self.defs, line) - 1
        if k >= 0 and line <= self.end(k):
            return self.names[k]
        n = k + 1
        if n < len(self.defs) and self.lead(n) <= line:
            return self.names[n]
        return None


def region_problems(regions: list) -> list:
    """[(name, text)] -> [(name, problem)]: each region evaluated alone, in an empty shell with no PATH."""
    out = []
    with tempfile.TemporaryDirectory(prefix='ccd-split-') as d:
        files = []
        for i, (_name, text) in enumerate(regions):
            f = os.path.join(d, f'r{i}')
            with open(f, 'w', encoding='utf-8') as fh:
                fh.write(text + '\n')
            files.append(f)
        script = ('for f in "$@"; do ( compgen -v > "$f.v0"; . "$f" >/dev/null 2>&1; '
                  'compgen -v > "$f.v1"; declare -F > "$f.fn" ) </dev/null; done')
        subprocess.run([bash(), '--norc', '--noprofile', '-c', script, '_', *files], cwd=d, timeout=600,
                       env={'PATH': '/nonexistent', 'HOME': d, 'LC_ALL': 'C'}, capture_output=True)
        for (name, _text), f in zip(regions, files):
            try:
                v0 = set(open(f + '.v0').read().split())
                v1 = set(open(f + '.v1').read().split())
                fns = [ln.split()[-1] for ln in open(f + '.fn').read().splitlines() if ln.strip()]
            except OSError:
                out.append((name, 'did not finish'))
                continue
            if len(fns) >= 2:
                out.append((name, 'two definitions'))
            elif not fns:
                out.append((name, 'no definition'))
            elif fns[0] != name:
                out.append((name, f'defines {fns[0]}, not {name}'))
            new = sorted(v for v in v1 - v0 if not SHELL_OWN.match(v))
            if new:
                out.append((name, 'sets a variable: ' + ', '.join(new)))
    return out


# ── the tree ─────────────────────────────────────────────────────────────────────────────────────────────────────

def read(root: str, rel: str):
    p = os.path.join(root, rel)
    if not os.path.exists(p):
        return None
    with open(p, encoding='utf-8', newline='') as fh:
        return fh.read()


def write(root: str, rel: str, text: str) -> None:
    p = os.path.join(root, rel)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, 'w', encoding='utf-8', newline='') as fh:
        fh.write(text)


def libs_line(main: str):
    """(index, words) of the one `__CCD_LIBS=(` line, or None when there is none; more than one refuses."""
    hits = [(i, line) for i, line in enumerate(main.split('\n')) if line.startswith('__CCD_LIBS=(')]
    if not hits:
        return None
    if len(hits) > 1:
        raise Refusal(f'{CCD} holds {len(hits)} `__CCD_LIBS=(` lines, not one')
    i, line = hits[0]
    m = LIBS_RE.match(line)
    if not m:
        raise Refusal(f'{CCD} line {i + 1}: the `__CCD_LIBS=(` line is not one word list')
    return i, m.group(1).split()


def context_rows(root: str) -> dict:
    rows = {}
    for line in (read(root, CONTEXTS) or '').split('\n'):
        if line.strip() == '' or line.startswith('#'):
            continue
        parts = line.split('\t')
        if len(parts) == 2:
            rows[parts[0]] = parts[1]
    return rows


def slice_table(root: str) -> list:
    rows = []
    for n, line in enumerate((read(root, SLICES) or '').split('\n'), 1):
        if line.strip() == '' or line.startswith('#'):
            continue
        parts = line.split('\t')
        if len(parts) != 4 or not parts[0].isdigit() or not LIBRARY_RE.match(parts[1]):
            raise Refusal(f'{SLICES} line {n}: rows are <move-order>\\t<library>\\t<context>\\t<name-regex>')
        if parts[2] == 'K':
            raise Refusal(f'{SLICES} line {n}: K stays in the spine; no slice takes it')
        rows.append({'order': int(parts[0]), 'library': parts[1], 'context': parts[2], 're': re.compile(parts[3])})
    if not rows:
        raise Refusal(f'{SLICES} has no rows')
    return rows


def pick_slice(table: list, arg: str) -> dict:
    for row in table:
        if arg == row['library'] or (arg.isdigit() and int(arg) == row['order']):
            return row
    raise Refusal(f'no slice {arg} in {SLICES}')


def members(regions: Regions, contexts: dict, table: list, row: dict) -> list:
    """Definition indices of ccd/ccd whose first matching table row is `row`."""
    out = []
    for k, name in enumerate(regions.names):
        if name in SPINE:
            continue
        ctx = contexts.get(name)
        first = next((r for r in table if r['context'] == ctx and r['re'].search(name)), None)
        if first is row:
            out.append(k)
    return out


def runs_of(regions: Regions, ks: list) -> list:
    """[(lead, end, [k…])], 0-based inclusive, in file order."""
    runs = []
    for k in ks:
        lead, end = regions.lead(k), regions.end(k)
        if runs:
            plead, pend, pks = runs[-1]
            between = regions.lines[pend + 1:lead]
            if all((ln.strip() == '' or re.match(r'\s*#', ln)) and not POINTER_RE.match(ln) for ln in between):
                runs[-1] = (plead, end, pks + [k])
                continue
        runs.append((lead, end, [k]))
    return runs


def existing_ids(root: str, main: str) -> set:
    ids = {m.group(1) for line in main.split('\n') if (m := POINTER_RE.match(line))}
    lib_dir = os.path.join(root, 'ccd', 'lib')
    if os.path.isdir(lib_dir):
        for f in os.listdir(lib_dir):
            if f.endswith('.sh'):
                ids |= {m.group(1) for line in (read(root, f'ccd/lib/{f}') or '').split('\n')
                        if (m := MARKER_RE.match(line))}
    return ids


def program_order(root: str, main: str, words: list) -> list:
    names = [m.group(1) for line in main.split('\n') if (m := DEF_RE.match(line))]
    for w in words:
        if w.startswith('ccrc-'):
            continue
        names += [m.group(1) for line in (read(root, f'ccd/lib/{w}.sh') or '').split('\n') if (m := DEF_RE.match(line))]
    return names


def reorder_contexts(root: str, order: list) -> None:
    """The data rows follow the program's definition order; the comment header stays where it is."""
    text = read(root, CONTEXTS) or ''
    lines = text.rstrip('\n').split('\n')
    head = []
    while lines and (lines[0].startswith('#') or lines[0].strip() == ''):
        head.append(lines.pop(0))
    pos = {n: i for i, n in enumerate(order)}
    rows = sorted(lines, key=lambda ln: (pos.get(ln.split('\t')[0], len(pos)), lines.index(ln)))
    write(root, CONTEXTS, '\n'.join(head + rows) + '\n')


# ── the yield check (S1, D-8634) ─────────────────────────────────────────────────────────────────────────────────

def git(root: str, *args: str) -> str:
    return subprocess.run(['git', '--no-replace-objects', *args], cwd=root, capture_output=True, text=True,
                          check=True, timeout=300).stdout


def read_heads(path: str) -> list:
    heads = []
    with open(path, encoding='utf-8') as fh:
        for line in fh:
            s = line.strip()
            if s == '' or s.startswith('#'):
                continue
            ref, _, label = s.partition(' ')
            heads.append((label.strip() or ref, ref))
    return heads


HUNK_RE = re.compile(r'^@@ -(\d+)(?:,(\d+))? \+')


def touched_by(root: str, ref: str) -> dict:
    """{file: set(function names)} the diff merge-base(HEAD, ref)..ref touches in ccd's program files."""
    try:
        sha = git(root, 'rev-parse', '--verify', '--quiet', f'{ref}^{{commit}}').strip()
    except subprocess.CalledProcessError:
        raise Refusal(f'the head {ref} is not in this repository: fetch it first '
                      '(git fetch origin "+refs/pull/*/head:refs/remotes/origin/pr/*")') from None
    try:
        mb = git(root, 'merge-base', 'HEAD', sha).strip()
    except subprocess.CalledProcessError:
        raise Refusal(f'the head {ref} shares no history with HEAD') from None
    files = [f for f in git(root, 'diff', '--name-only', '--no-renames', mb, sha, '--', CCD, 'ccd/lib').split('\n')
             if f == CCD or (f.startswith('ccd/lib/') and f.endswith('.sh'))]
    out = {}
    for f in files:
        try:
            base_text = git(root, 'show', f'{mb}:{f}')
        except subprocess.CalledProcessError:
            continue    # a file the head adds holds none of the base's functions
        regions = Regions(base_text)
        names = set()
        for line in git(root, 'diff', '-U0', '--no-color', '--no-renames', mb, sha, '--', f).split('\n'):
            h = HUNK_RE.match(line)
            if not h:
                continue
            start, count = int(h.group(1)), 1 if h.group(2) is None else int(h.group(2))
            touched = range(start - 1, start - 1 + count) if count else (start - 1, start)
            for ln in touched:
                if 0 <= ln < len(regions.lines) and (name := regions.function_at(ln)):
                    names.add(name)
        if names:
            out[f] = names
    return out


def yield_check(root: str, heads_file: str, names: set, what: str) -> None:
    blocking = []
    for label, ref in read_heads(heads_file):
        hit = set()
        for fns in touched_by(root, ref).values():
            hit |= fns & names
        if hit:
            blocking.append(f'  {label} ({ref}): {", ".join(sorted(hit))}')
    if blocking:
        raise Refusal(f'{what}: open work goes first (S1, D-8634); these open PR heads touch its functions, so the '
                      'slice waits or another slice moves:\n' + '\n'.join(blocking))


# ── the verbs ────────────────────────────────────────────────────────────────────────────────────────────────────

def load_slice(root: str, arg: str):
    main = read(root, CCD)
    if main is None:
        raise Refusal(f'no {CCD} under {root}')
    table = slice_table(root)
    row = pick_slice(table, arg)
    regions = Regions(main)
    contexts = context_rows(root)
    ks = members(regions, contexts, table, row)
    for k in ks:
        name = regions.names[k]
        if name in SPINE or contexts.get(name) == 'K':
            raise Refusal(f'{name} stays in the spine')
    return main, row, regions, ks


def describe(row: dict, regions: Regions, ks: list) -> dict:
    runs = runs_of(regions, ks)
    lines = sum(e - s + 1 for s, e, _ in runs)
    cites = sum(1 for s, e, _ in runs for ln in regions.lines[s:e + 1] if CITATION_RE.search(ln))
    return {'library': row['library'], 'order': row['order'], 'functions': [regions.names[k] for k in ks],
            'lines': lines, 'runs': len(runs), 'citations': cites}


def record_path(row: dict) -> str:
    return f"{RECORDS}/{row['order']:02d}-{row['library']}.json"


def write_record(root: str, row: dict, functions: list) -> None:
    write(root, record_path(row), json.dumps({'library': row['library'], 'functions': functions}, indent=2) + '\n')


def cmd_plan(root: str, args) -> int:
    _main, row, regions, ks = load_slice(root, args.slice)
    d = describe(row, regions, ks)
    print(f"slice {d['order']} {d['library']}: {len(d['functions'])} functions, {d['lines']} lines, {d['runs']} runs, "
          f"{d['citations']} citation lines")
    for name in d['functions']:
        print(f'  {name}')
    if args.record:
        write_record(root, row, d['functions'])
        print(f'wrote {record_path(row)}')
    return 0


def cmd_preflight(root: str, args) -> int:
    _main, row, regions, ks = load_slice(root, args.slice)
    yield_check(root, args.heads, {regions.names[k] for k in ks}, f"slice {row['order']} {row['library']}")
    print(f"slice {row['order']} {row['library']}: clear, no open PR head touches its {len(ks)} functions")
    return 0


LIB_HEADER = """# ccd/lib/{library}.sh — functions of ccd/ccd moved here, byte for byte, by the file split (slice {order};
# docs/superpowers/plans/2026-11-06-ccd-file-split.md). Written by .github/ci/ccd-split.py move; edit the functions
# here like any other code.
#
# NOT AN EXECUTABLE and not sourceable on its own: ccd/ccd loads it at its foot, as the word `{library}` of
# `__CCD_LIBS`, after every other function and variable of ccd is defined. Each `# @ccd-lib:<id>` marker opens one
# run of functions, in the order ccd had them, and the pointer line of the same id in ccd/ccd marks where it sat.
"""


def cmd_move(root: str, args) -> int:
    main, row, regions, ks = load_slice(root, args.slice)
    lib_rel = f"ccd/lib/{row['library']}.sh"
    if not ks:
        raise Refusal(f"slice {row['order']} {row['library']}: no function of ccd/ccd belongs to it")
    found = libs_line(main)
    if found is None:
        raise Refusal(f'{CCD} has no `__CCD_LIBS=(` line, so a new library would not load (Task 4 adds the line)')
    li, words = found
    if os.path.exists(os.path.join(root, lib_rel)) and not args.regenerate:
        raise Refusal(f'{lib_rel} exists; --regenerate rebuilds it inside a merge')
    yield_check(root, args.heads, {regions.names[k] for k in ks}, f"slice {row['order']} {row['library']}")
    problems = region_problems([(regions.names[k], '\n'.join(regions.lines[regions.defs[k]:regions.end(k) + 1]))
                                for k in ks])
    if problems:
        raise Refusal('regions that fail the region rule:\n' + '\n'.join(f'  {n}: {p}' for n, p in problems))
    runs = runs_of(regions, ks)
    taken = existing_ids(root, main)
    if args.regenerate:
        taken -= {m.group(1) for line in (read(root, lib_rel) or '').split('\n') if (m := MARKER_RE.match(line))}
    stem = row['library'].replace('-', '_')
    ids = [f'{stem}_{i}' for i in range(1, len(runs) + 1)]
    clash = [i for i in ids if i in taken]
    if clash:
        raise Refusal('region ids already in use: ' + ', '.join(clash))
    lines = list(regions.lines)
    body = [LIB_HEADER.format(library=row['library'], order=row['order'])]
    for rid, (s, e, rks) in zip(ids, runs):
        body.append(f'# @ccd-lib:{rid}\n' + '\n'.join(regions.lines[s:e + 1]) + '\n')
    for rid, (s, e, rks) in reversed(list(zip(ids, runs))):
        names = [regions.names[k] for k in rks]
        shown = ', '.join(f'`{n}`' for n in names[:3]) + (f' and {len(names) - 3} more' if len(names) > 3 else '')
        lines[s:e + 1] = [f'# @ccd-lib:{rid} — {shown} moved to {lib_rel}']
    if row['library'] not in words:
        words = words + [row['library']]
    li = next(i for i, ln in enumerate(lines) if ln.startswith('__CCD_LIBS=('))
    m = LIBS_RE.match(lines[li])
    lines[li] = f"__CCD_LIBS=({' '.join(words)}){m.group(2) or ''}"
    new_main = '\n'.join(lines)
    write(root, lib_rel, '\n'.join(body))
    write(root, CCD, new_main)
    reorder_contexts(root, program_order(root, new_main, words))
    if args.regenerate:
        write_record(root, row, [regions.names[k] for k in ks])
    print(f"moved slice {row['order']} {row['library']}: {len(ks)} functions in {len(runs)} runs to {lib_rel}")
    return 0


def cmd_unmove(root: str, args) -> int:
    library = args.library
    lib_rel = f'ccd/lib/{library}.sh'
    lib = read(root, lib_rel)
    main = read(root, CCD)
    if lib is None or main is None:
        raise Refusal(f'no {lib_rel} to put back')
    parts = re.split(r'^# @ccd-lib:(\w+)\n', lib, flags=re.M)
    regions = {parts[i]: parts[i + 1].rstrip('\n') for i in range(1, len(parts) - 1, 2)}
    for text in regions.values():
        for line in text.split('\n'):
            m = DEF_RE.match(line)
            if m and m.group(1) in SPINE:
                raise Refusal(f'{m.group(1)} stays in the spine')
    lines = main.split('\n')
    seen = set()
    for i, line in enumerate(lines):
        m = POINTER_RE.match(line)
        if m and m.group(1) in regions:
            lines[i] = regions[m.group(1)]
            seen.add(m.group(1))
    missing = sorted(set(regions) - seen)
    if missing:
        raise Refusal(f'{lib_rel}: no pointer in {CCD} for ' + ', '.join(missing))
    new_main = '\n'.join(lines)
    found = libs_line(new_main)
    words = []
    if found is not None:
        li, words = found
        words = [w for w in words if w != library]
        out = new_main.split('\n')
        m = LIBS_RE.match(out[li])
        out[li] = f"__CCD_LIBS=({' '.join(words)}){m.group(2) or ''}"
        new_main = '\n'.join(out)
    write(root, CCD, new_main)
    os.remove(os.path.join(root, lib_rel))
    reorder_contexts(root, program_order(root, new_main, words))
    print(f'put {library} back: {len(regions)} runs')
    return 0


def cmd_check_regions(_root: str, args) -> int:
    text = sys.stdin.read() if args.file == '-' else open(args.file, encoding='utf-8').read()
    regions = Regions(text)
    found = [(regions.names[k], '\n'.join(regions.lines[regions.defs[k]:regions.end(k) + 1]))
             for k in range(len(regions.defs))]
    problems = region_problems(found)
    print(json.dumps({'regions': [{'name': n, 'lines': t.count('\n') + 1} for n, t in found],
                      'problems': [{'name': n, 'problem': p} for n, p in problems]}))
    return 1 if problems else 0


def main(argv) -> int:
    ap = argparse.ArgumentParser(prog='ccd-split.py', description=__doc__.split('\n')[0])
    ap.add_argument('--root', default=None, help='the repository root (default: the git top level of the cwd)')
    sub = ap.add_subparsers(dest='verb', required=True)
    p = sub.add_parser('plan')
    p.add_argument('slice')
    p.add_argument('--record', action='store_true')
    p = sub.add_parser('preflight')
    p.add_argument('slice')
    p.add_argument('--heads', required=True)
    p = sub.add_parser('move')
    p.add_argument('slice')
    p.add_argument('--heads', required=True)
    p.add_argument('--regenerate', action='store_true')
    p = sub.add_parser('unmove')
    p.add_argument('library')
    p = sub.add_parser('check-regions')
    p.add_argument('file')
    args = ap.parse_args(argv)
    root = args.root
    if root is None and args.verb != 'check-regions':
        root = subprocess.run(['git', 'rev-parse', '--show-toplevel'], capture_output=True, text=True,
                              check=True).stdout.strip()
    verbs = {'plan': cmd_plan, 'preflight': cmd_preflight, 'move': cmd_move, 'unmove': cmd_unmove,
             'check-regions': cmd_check_regions}
    try:
        return verbs[args.verb](root, args)
    except Refusal as e:
        print(f'ccd-split: refused: {e}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
