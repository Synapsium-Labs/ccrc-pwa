# The stub's _rebuild_code, with the pinned 0.9.9 signature (graphify/watch.py `_rebuild_code`):
#   _rebuild_code(watch_path, *, changed_paths=None, follow_symlinks=False, force=False, no_cluster=False,
#                 acquire_lock=True, block_on_lock=False) -> bool
# What it keeps of the real engine, because ccd/graph-build's checks exist for exactly these behaviours:
#   - GRAPHIFY_OUT comes from graphify.paths, read once at import; the output is watch_path / GRAPHIFY_OUT;
#   - the project root is the cwd's realpath for a relative watch path, and every source_file is relative to it;
#   - built_at_commit is `git rev-parse HEAD` run in the process's cwd;
#   - a directory named like GRAPHIFY_OUT's basename is skipped everywhere in the scan;
#   - acquire_lock=True takes <out>/.rebuild.lock and, for an incremental call, queues <out>/.pending_changes;
#   - changed_paths re-extracts only those files and evicts the ones missing on disk;
#   - an extraction worker is forked from the calling process.
# Its corpus is `git ls-files` (the real engine walks the disk; the sweep's checkout is exactly the tracked files).
#
# Environment knobs (all optional):
#   GRAPH_STUB_RECORD        the record file (graphify/_record.py)
#   GRAPH_STUB_DROP          changed_paths | force | acquire_lock: the signature lacks that parameter
#   GRAPH_STUB_MODE          false (return False) | untouched (print the engine's message, write nothing, return
#                            True) | raise (raise an exception)
#   GRAPH_STUB_ALLOC_MB      the forked worker allocates and touches this many MiB before it exits
#   GRAPH_STUB_EXTRA_SOURCES a JSON list of extra source_file values, one node each (the saved-result rows)
import json
import os
import subprocess
from pathlib import Path

from graphify import _record
from graphify.paths import GRAPHIFY_OUT as _GRAPHIFY_OUT
from graphify.paths import GRAPHIFY_OUT_NAME as _OUT_NAME


def _git(*args):
    env = {k: v for k, v in os.environ.items() if not k.startswith('GIT_')}
    return subprocess.run(['git', *args], capture_output=True, check=True, env=env).stdout


def _worker():
    pid = os.fork()
    if pid == 0:
        try:
            _record.append({'event': 'worker', 'oom_score_adj': _record.oom_score_adj()})
            mb = int(os.environ.get('GRAPH_STUB_ALLOC_MB') or 0)
            if mb:
                block = bytearray(mb * 1024 * 1024)
                for i in range(0, len(block), 4096):
                    block[i] = 1
        finally:
            os._exit(0)
    _, status = os.waitpid(pid, 0)
    if os.WIFSIGNALED(status):
        # As the engine's process pool does when a worker dies (BrokenProcessPool): the call raises.
        raise RuntimeError('extraction worker %d killed by signal %d' % (pid, os.WTERMSIG(status)))
    return pid


def _impl(watch_path, changed_paths, follow_symlinks, force, no_cluster, acquire_lock, block_on_lock):
    out = Path(watch_path) / _GRAPHIFY_OUT
    rec = {
        'event': 'call', 'watch_path': str(watch_path), 'cwd': os.getcwd(),
        'changed_paths': None if changed_paths is None else [str(p) for p in changed_paths],
        'follow_symlinks': follow_symlinks, 'force': force, 'no_cluster': no_cluster,
        'acquire_lock': acquire_lock, 'block_on_lock': block_on_lock,
        'graphify_out': _GRAPHIFY_OUT, 'oom_score_adj': _record.oom_score_adj(),
    }
    if acquire_lock:
        out.mkdir(parents=True, exist_ok=True)
        (out / '.rebuild.lock').write_text('')
        if changed_paths is not None and not block_on_lock:
            with open(out / '.pending_changes', 'a', encoding='utf-8') as f:
                f.write(''.join(str(p) + '\n' for p in changed_paths))
    rec['worker_pid'] = _worker()
    _record.append(rec)
    mode = os.environ.get('GRAPH_STUB_MODE', '')
    if mode == 'raise':
        raise RuntimeError('stub engine failure')
    if mode == 'false':
        return False
    if mode == 'untouched':
        print('[graphify watch] No code-graph topology changes detected; outputs left untouched.')
        return True

    root = Path.cwd().resolve() if not Path(watch_path).is_absolute() else Path(watch_path).resolve()
    tracked = [p for p in _git('ls-files', '-z').decode().split('\0') if p]
    corpus = {p for p in tracked if _OUT_NAME not in Path(p).parts[:-1]}
    graph = out / 'graph.json'
    nodes = {}
    if changed_paths is not None and graph.exists():
        for n in json.loads(graph.read_text())['nodes']:
            nodes[n['source_file']] = n
    if changed_paths is None:
        targets = sorted(corpus)
        nodes = {}
    else:
        targets = []
        for p in changed_paths:
            absolute = Path(p) if Path(p).is_absolute() else root / p
            rel = os.path.relpath(os.path.abspath(absolute), root)
            nodes.pop(rel, None)
            if absolute.exists() and rel in corpus:
                targets.append(rel)
    kind = 'full' if changed_paths is None else 'incremental'
    for rel in targets:
        nodes[rel] = {'id': rel, 'label': os.path.basename(rel), 'source_file': rel, 'by': kind}
    for extra in json.loads(os.environ.get('GRAPH_STUB_EXTRA_SOURCES') or '[]'):
        nodes[extra] = {'id': 'saved:' + extra, 'label': os.path.basename(extra), 'source_file': extra, 'by': kind}
    ordered = [nodes[k] for k in sorted(nodes)]
    links = [{'source': a['id'], 'target': b['id'], 'source_file': a['source_file']} for a, b in zip(ordered, ordered[1:])]
    data = {'directed': False, 'nodes': ordered, 'links': links, 'hyperedges': [],
            'built_at_commit': _git('rev-parse', 'HEAD').decode().strip()}
    out.mkdir(parents=True, exist_ok=True)
    graph.write_text(json.dumps(data, indent=2, ensure_ascii=False) + '\n')
    return True


_DROP = os.environ.get('GRAPH_STUB_DROP', '')

if _DROP == 'changed_paths':
    def _rebuild_code(watch_path, *, follow_symlinks=False, force=False, no_cluster=False, acquire_lock=True,
                      block_on_lock=False):
        return _impl(watch_path, None, follow_symlinks, force, no_cluster, acquire_lock, block_on_lock)
elif _DROP == 'force':
    def _rebuild_code(watch_path, *, changed_paths=None, follow_symlinks=False, no_cluster=False, acquire_lock=True,
                      block_on_lock=False):
        return _impl(watch_path, changed_paths, follow_symlinks, False, no_cluster, acquire_lock, block_on_lock)
elif _DROP == 'acquire_lock':
    def _rebuild_code(watch_path, *, changed_paths=None, follow_symlinks=False, force=False, no_cluster=False,
                      block_on_lock=False):
        return _impl(watch_path, changed_paths, follow_symlinks, force, no_cluster, True, block_on_lock)
else:
    def _rebuild_code(watch_path, *, changed_paths=None, follow_symlinks=False, force=False, no_cluster=False,
                      acquire_lock=True, block_on_lock=False):
        return _impl(watch_path, changed_paths, follow_symlinks, force, no_cluster, acquire_lock, block_on_lock)
