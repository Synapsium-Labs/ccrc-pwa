"""Shared helpers for the model3a checks. Standard library only.

Every script reads the spec read-only and prints its counterexamples as lines that start with `CE <tag>:`.
A line that starts with `ok` is a check that passed. A line that starts with `note` is context.
"""
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
# The edition these checks ran against: the spec as #2538 merged it. Set OVERLORD_SPEC to a file to read another.
SPEC_REV = '13b0b359cbbfbea252c849bb48114a55cb78ec71'
SPEC_FILE = 'docs/superpowers/specs/2026-11-09-overlord-design.md'
if os.environ.get('OVERLORD_SPEC'):
    SPEC = open(os.environ['OVERLORD_SPEC'], encoding='utf-8').read()
else:
    import subprocess
    SPEC = subprocess.check_output(['git', 'show', SPEC_REV + ':' + SPEC_FILE], cwd=HERE).decode('utf-8')
LINES = SPEC.split('\n')
# The same text with every run of white space (line breaks and list indents included) as one space.
FLAT = re.sub(r'\s+', ' ', SPEC)

_count = {'ce': 0, 'ok': 0}


def ce(tag, msg):
    """Print one counterexample."""
    _count['ce'] += 1
    print('CE %s: %s' % (tag, msg))


def ok(msg):
    _count['ok'] += 1
    print('ok  %s' % msg)


def note(msg):
    print('note %s' % msg)


def anchor(phrase, at_least=1):
    """The spec must contain this phrase. It ties an encoded rule to the text it was read from."""
    n = FLAT.count(re.sub(r'\s+', ' ', phrase))
    if n < at_least:
        print('ANCHOR MISSING (%d): %r' % (n, phrase))
        sys.exit(2)
    return n


def summary(name, domain):
    print('== %s: domain %s; counterexamples %d; checks passed %d' % (name, domain, _count['ce'], _count['ok']))


def table_rows(caption_start):
    """Rows of the Markdown table that ends just above the line starting with `caption_start`.

    Returns a list of lists of cell strings, header first. A row broken over several lines is joined.
    """
    idx = [i for i, ln in enumerate(LINES) if ln.startswith(caption_start)]
    if len(idx) != 1:
        print('CAPTION %r found %d times' % (caption_start, len(idx)))
        sys.exit(2)
    i = idx[0] - 1
    while i >= 0 and LINES[i].strip() == '':
        i -= 1
    end = i
    while i >= 0 and LINES[i].strip() != '':
        i -= 1
    block = LINES[i + 1:end + 1]
    rows, cur = [], None
    for ln in block:
        if ln.startswith('|'):
            if cur is not None:
                rows.append(cur)
            cur = ln
        else:
            cur = (cur or '') + ' ' + ln
    if cur is not None:
        rows.append(cur)
    out = []
    for r in rows:
        cells = [c.strip() for c in re.split(r'(?<!\\)\|', r.strip().strip('|'))]
        if all(re.fullmatch(r':?-+:?', c) for c in cells):
            continue
        out.append(cells)
    return out


def section(start_heading, end_heading):
    a = SPEC.index('\n' + start_heading)
    b = SPEC.index('\n' + end_heading, a + 1)
    return SPEC[a:b]


def ticks(s):
    return re.findall(r'`([^`]+)`', s)
