# The stub's detect(), for the sweep's corpus guard (ccd/ccd-graph-sweep `_gs_guard`, D-7350). As the pinned engine's
# detect() does where the sweep relies on it: the corpus is the files under the scan root (here `git ls-files`, since
# the sweep's checkout is exactly the tracked files), less a `.graphifyignore` line's path or directory prefix, less
# any directory named like GRAPHIFY_OUT's basename, PLUS every file under GRAPHIFY_OUT/memory whatever the ignore rules
# say (the engine's saved-result re-add). Paths come back absolute.
#   GRAPH_STUB_DETECT_EXTRA  a JSON list of extra paths, relative to the scan root, reported as corpus (a breach)
import json
import os
import subprocess
from pathlib import Path

from graphify import _record
from graphify.paths import GRAPHIFY_OUT as _GRAPHIFY_OUT
from graphify.paths import GRAPHIFY_OUT_NAME as _OUT_NAME


def rules(root):
    """The scan root's .graphifyignore, as the stub reads it: one path or one directory prefix per line."""
    out = []
    ign = Path(root) / '.graphifyignore'
    if ign.exists():
        for line in ign.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith('#'):
                out.append(line.lstrip('/'))
    return out


def ignored(rel, rs):
    return any(rel == r or (r.endswith('/') and rel.startswith(r)) for r in rs)


def detect(root):
    root = Path(root).resolve()
    env = {k: v for k, v in os.environ.items() if not k.startswith('GIT_')}
    out = subprocess.run(['git', 'ls-files', '-z'], cwd=root, capture_output=True, check=True, env=env).stdout
    rs = rules(root)
    files = []
    for rel in [p for p in out.decode().split('\0') if p] + json.loads(os.environ.get('GRAPH_STUB_DETECT_EXTRA') or '[]'):
        parts = Path(rel).parts
        if _OUT_NAME in parts[:-1] or ignored(rel, rs):
            continue
        files.append(str(root / rel))
    mem = Path(_GRAPHIFY_OUT) / 'memory'
    if mem.is_dir():
        for dirpath, _, names in os.walk(mem, followlinks=True):
            files.extend(os.path.join(dirpath, n) for n in names)
    _record.append({'event': 'detect', 'root': str(root), 'files': len(files)})
    return {'files': {'code': sorted(files), 'document': [], 'paper': [], 'image': [], 'video': []}}
