# The stub's record file: one JSON object per line, appended to the path in GRAPH_STUB_RECORD (no file, no record).
import json
import os


def oom_score_adj():
    try:
        with open('/proc/self/oom_score_adj', encoding='ascii') as f:
            return int(f.read().strip())
    except OSError:
        return None


def append(rec):
    path = os.environ.get('GRAPH_STUB_RECORD')
    if not path:
        return
    rec = dict(rec, pid=os.getpid())
    with open(path, 'a', encoding='utf-8') as f:
        f.write(json.dumps(rec) + '\n')
