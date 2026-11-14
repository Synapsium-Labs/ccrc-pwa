# ccd/lib/inflight-manifest.py — the restart manifest's program (session-continuity 6b, D-8368).
#
# Run only by ccd's `_inflight_write` (Task 3), as `python3 -I`, under `_plat_timeout`:
#   python3 -I inflight-manifest.py <reg> <id> <cfg> <uuid> <site> <now> <scan-budget> <max-bytes> <tail-bytes> <recent-s>
#           <abandon-s> <reset|-> <jq-lib> <log|-> <log-from|-> <record-max>
# All 16 are required. A malformed one is rc 2, and so is a <site> outside MANIFEST_SITES.
#
# It answers one question: which background launches of this session were still running, or stopped short, when the session
# ended? It READS the launch record (`<reg>/<id>.deleg`, the hook's evidence) and the session's sidecars under
# `<cfg>/projects/*/<uuid>/` (workflow journals and summaries, agent transcript tails), and WRITES NOTHING: ccd compacts
# the record from the `row` lines it prints.
#
# EVERY PATH is `os.lstat`ed first and opened only when S_ISREG, with O_RDONLY | O_NOFOLLOW | O_NONBLOCK, so a FIFO, a device
# or a link is never opened (`carry-dedupe.py`'s S_ISREG checks are the precedent). The record present and not a regular file
# is rc 4 with `record <type>`; any other path that is not a regular file makes its item UNREAD. Before reading the first
# byte past the record it prices the read from `lstat` alone; over <scan-budget> is rc 3 with `budget <bytes>`.
#
# ONE `jq` CALL, `jq -L <jq-lib> -c 'include "transcript"; map(agent_end)'`, with a JSON array of tail windows on stdin
# (`agent_end`, ccd/lib/transcript.jq, is the one place a transcript is parsed). A window read from mid-file is cut at its
# first LF here. No jq, or a jq that fails, leaves the items that needed a tail unread.
#
# stdout at rc 0: `summary verdict=<…> items=N in-flight=N … retired=N`, the item lines, then the record's kept rows as
# `row <json>` lines in file order. UNREAD FIRST: an item whose deciding files cannot be read is unread before any class is
# tried (D-8371), kept until its newest row is older than <abandon-s>, then retired as unread-expired; never listed, never
# abandoned. FINISHED is D-5561's rule made stricter (D-8370): a summary that parses with status completed or failed, and a
# journal no newer than it; the server reads any summary file no older than the journal as finished
# (`server/src/workflows/model.ts#decideRun`). The journal fold is that file's `foldJournal`, parseLine's head search included;
# `server/test/inflight-manifest-parity.test.ts` runs both over one table. Compaction and the counts: D-8373.
#
# THE VOCABULARIES are spelled once below, and once more, named as a second spelling, in `deploy/measure-continuity.py`, which
# Task 4's test holds equal by reading both texts (D-8376): the instrument runs from the tree on any box and does not import
# this program. The program names a class, verdict, site or drop word only through them.
import json, os, re, stat, subprocess, sys

MANIFEST_CLASSES = ('in-flight', 'holed', 'stopped-agent', 'diverged', 'deferred-until-reset', 'abandoned')
(IN_FLIGHT, HOLED, STOPPED_AGENT, DIVERGED, DEFERRED, ABANDONED) = MANIFEST_CLASSES
MANIFEST_VERDICTS = ('listed', 'none', 'unread', 'not-applicable', 'unmeasured')
(V_LISTED, V_NONE, V_UNREAD, _V_NA, _V_UNMEASURED) = MANIFEST_VERDICTS
MANIFEST_WHY = ('busy', 'budget', 'time', 'error')
MANIFEST_SITES = ('swap', 'limit-resume', 'revival')
MANIFEST_DROP_WHY = ('id', 'path', 'budget', 'shape')
(DROP_ID, DROP_PATH, DROP_BUDGET, DROP_SHAPE) = MANIFEST_DROP_WHY

ID_RE = re.compile(r'[A-Za-z0-9_-]{1,64}\Z')
# The session id is ccd's registry id, not the claude-side id class: `ccd/ccd#_reg_id_ok` (`[A-Za-z0-9._-]+`, not dash-leading)
# plus `_ws_tmproot_id_ok`'s not-dot-leading, capped at `_REG_ID_MAX` (128, the hook's CCRC_ID_MAX). A project name may carry dots.
SID_RE = re.compile(r'[A-Za-z0-9_][A-Za-z0-9._-]{0,127}\Z')
WRAPPER_RE = re.compile(r'[A-Za-z0-9._-]{1,64}\Z')
BYTE_RE = re.compile(r'[A-Za-z0-9._/@+-]+\Z')      # the hook's `lrbyte` class
NAME_STEM_RE = re.compile(r'[A-Za-z0-9_-][A-Za-z0-9._-]{0,127}\Z')
PDIR_RE = re.compile(r'[A-Za-z0-9._@+-]+\Z')
KEY_RE = re.compile(r'v[0-9]+:[0-9a-f]{64}\Z')
LINE_KEEP_BYTES = 65536                              # model.ts's, for the journal reader's cut line
ROW_KINDS = ('workflow', 'resume', 'agent', 'send', 'drop')
(K_WORKFLOW, K_RESUME, K_AGENT, K_SEND, K_DROP) = ROW_KINDS
SHAPES = {K_WORKFLOW: ('v', 't', 'k', 'w', 'uuid', 'run', 'task', 'script'),
          K_RESUME: ('v', 't', 'k', 'w', 'uuid', 'run', 'task', 'script'),
          K_AGENT: ('v', 't', 'k', 'w', 'uuid', 'agent'),
          K_SEND: ('v', 't', 'k', 'w', 'uuid', 'agent'),
          K_DROP: ('v', 't', 'k', 'why')}
OPEN_FLAGS = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK
OK, ABSENT, BAD = 'ok', 'absent', 'bad'              # a path's three conditions


def usage(msg):
    sys.stderr.write('inflight-manifest: %s\n' % msg)
    sys.exit(2)


def num(s, name, low=0):
    if not re.fullmatch(r'[0-9]{1,15}', s) or int(s) < low:
        usage('%s is not a number' % name)
    return int(s)


def probe(p):
    """-> (OK|ABSENT|BAD, lstat or None). OK is a regular file; BAD is anything else that exists, or an lstat that failed."""
    try:
        st = os.lstat(p)
    except (FileNotFoundError, NotADirectoryError):
        return ABSENT, None
    except OSError:
        return BAD, None
    return (OK if stat.S_ISREG(st.st_mode) else BAD), st


def kind_word(st):
    m = st.st_mode
    for test, word in ((stat.S_ISFIFO, 'fifo'), (stat.S_ISLNK, 'link'), (stat.S_ISDIR, 'dir'), (stat.S_ISSOCK, 'socket'),
                       (stat.S_ISCHR, 'char'), (stat.S_ISBLK, 'block')):
        if test(m):
            return word
    return 'other'


def read_bytes(p, cap=None, tail=None, start=None, limit=None, seen=None):
    """The bytes of a regular file, or None. `cap`: at most that many from the front. `tail`: the last that many (from mid-file the
    partial first line is cut at its first LF). `start`: from that offset to the end, no cut (the swap log's tail past
    <log-from>; nothing below it is read). `limit`: never more than that many bytes, the size the file was priced at (a file that
    grew since its lstat is not read past its price; with `tail` the window shrinks to the price and stays the NEWEST bytes).
    `seen`: a list that gets the fresh fstat size, so a caller can tell a file that grew past what it read. Opened only after lstat says regular, no-follow, non-blocking, then fstat again."""
    st, fd = probe(p), None
    if st[0] != OK:
        return None
    try:
        fd = os.open(p, OPEN_FLAGS)
        if not stat.S_ISREG(os.fstat(fd).st_mode):
            return None
        size = os.fstat(fd).st_size
        if seen is not None:
            seen.append(size)
        off, want = 0, (size if cap is None else min(size, cap))
        if tail is not None:
            want = min(size, tail, size if limit is None else limit)
            off = size - want
        if start is not None:
            off = min(start, size)
            want = size - off
        if limit is not None:
            want = min(want, limit)
        off0 = off
        chunks = []
        while want > 0:
            b = os.pread(fd, min(want, 1 << 20), off)
            if not b:
                break
            chunks.append(b)
            off += len(b)
            want -= len(b)
        data = b''.join(chunks)
        if tail is not None and off0 > 0:
            i = data.find(b'\n')
            data = data[i + 1:] if i >= 0 else b''
        return data
    except OSError:
        return None
    finally:
        if fd is not None:
            os.close(fd)


def listdir(p):
    """The sorted names in a directory: [] when it is absent (FileNotFoundError, NotADirectoryError), None when it cannot be
    listed for any other reason. The two are never folded: an absent directory is no evidence, an unlistable one is unread."""
    try:
        return sorted(os.listdir(p))
    except (FileNotFoundError, NotADirectoryError):
        return []
    except OSError:
        return None


# ---------------------------------------------------------------- arguments
if len(sys.argv) != 17:
    usage('16 arguments are required')
(REG, SID, CFG, UUID, SITE) = sys.argv[1:6]
if not SID_RE.match(SID) or not ID_RE.match(UUID) or not REG or not CFG or SITE not in MANIFEST_SITES:
    usage('a malformed id, uuid, root or site')
NOW = num(sys.argv[6], 'now')
SCAN_BUDGET = num(sys.argv[7], 'scan-budget')
MAX_BYTES = num(sys.argv[8], 'max-bytes')
TAIL_BYTES = num(sys.argv[9], 'tail-bytes', 1)
RECENT_S = num(sys.argv[10], 'recent-s')
ABANDON_S = num(sys.argv[11], 'abandon-s')
RESET_ARG = sys.argv[12]
if RESET_ARG != '-' and not re.fullmatch(r'[0-9]{1,15}', RESET_ARG):
    usage('reset is not a number or -')
JQ_LIB, LOG = sys.argv[13], sys.argv[14]
LOG_FROM = None if sys.argv[15] == '-' else num(sys.argv[15], 'log-from')
RECORD_MAX = num(sys.argv[16], 'record-max', 1)
if not JQ_LIB or not LOG:
    usage('jq-lib and log are required')
sys.stdout.reconfigure(errors='backslashreplace')

# ---------------------------------------------------------------- the record
RECORD = os.path.join(REG, SID + '.deleg')
rstate, rst = probe(RECORD)
if rstate == BAD:
    print('record %s' % (kind_word(rst) if rst is not None else 'other'))
    sys.exit(4)
record_size = rst.st_size if rst is not None else 0
price = min(record_size, RECORD_MAX)
if price > SCAN_BUDGET:
    print('budget %d' % price)
    sys.exit(3)

drops = {w: 0 for w in MANIFEST_DROP_WHY}
n_read = n_readpath = n_retired = n_over = 0


def valid_int(v):
    return isinstance(v, int) and not isinstance(v, bool) and v >= 0


def no_const(c):
    raise ValueError(c)


def valid_row(o):
    """A row of the hook's grammar: exact keys per kind, v 1, ids in the grammar, a drop's why in MANIFEST_DROP_WHY."""
    if not isinstance(o, dict) or o.get('k') not in ROW_KINDS:
        return False
    k = o['k']
    if set(o) != set(SHAPES[k]) or o['v'] != 1 or isinstance(o['v'], bool) or not valid_int(o['t']):
        return False
    if k == K_DROP:
        return o['why'] in MANIFEST_DROP_WHY
    if not (isinstance(o['uuid'], str) and ID_RE.match(o['uuid'])):
        return False
    if not (o['w'] is None or (isinstance(o['w'], str) and WRAPPER_RE.match(o['w']))):
        return False
    ids = ('run', 'task') if k in (K_WORKFLOW, K_RESUME) else ('agent',)
    if not all(isinstance(o[x], str) and ID_RE.match(o[x]) for x in ids):
        return False
    return o.get('script') is None or isinstance(o.get('script'), str)


rows = []      # (file index, row dict)
seen = []
data = read_bytes(RECORD, cap=RECORD_MAX, limit=price, seen=seen) if rstate == OK else b''
if data is None:
    data = b''
    print('record other')   # a regular file that would not open or read: none of its rows is judged
    sys.exit(4)
parts = data.split(b'\n')
# overflow: the record held more than the program may read (its price) -- larger than RECORD_MAX at the lstat, or grown past what was read since
overflow = record_size > RECORD_MAX or (bool(seen) and seen[0] > len(data))
if overflow:
    parts = parts[:-1]                        # the last piece is the cut line (or empty): budget overflow, not an invalid line
    drops[DROP_BUDGET] += 1
elif parts and parts[-1] == b'':
    parts = parts[:-1]
for i, raw in enumerate(parts):
    try:
        o = json.loads(raw.decode('utf-8'), parse_constant=no_const)
    except (ValueError, RecursionError):      # a line nested past the recursion limit is an invalid line, never a crash
        o = None
    if not valid_row(o):
        n_read += 1
    elif o['k'] == K_DROP:
        drops[o['why']] += 1
    elif o['uuid'] != UUID:
        n_retired += 1
    else:
        rows.append((i, o))


def row_s(o):
    return o['t'] // 1000


# ---------------------------------------------------------------- items from rows
class Item:
    def __init__(self, kind, key, src):
        self.kind, self.key, self.src = kind, key, src
        self.rows = []             # (index, row)
        self.attempts = 0
        self.task = '-'
        self.script = '-'
        self.cls = None            # a class word, or None (retired / unread)
        self.unread = False
        self.reset = '-'
        self.longer = '-'
        self.since = 0
        self.status = None         # a workflow's parsed summary status
        self.last_resume_ms = 0
        self.finished = False
        self.tails = []
        self.keys = {}
        self.run = None


wf, ag = {}, {}
sends = []
for i, o in rows:
    if o['k'] in (K_WORKFLOW, K_RESUME):
        wf.setdefault(o['run'], Item(K_WORKFLOW, o['run'], 'record')).rows.append((i, o))
    elif o['k'] == K_AGENT:
        ag.setdefault(o['agent'], Item(K_AGENT, o['agent'], 'record')).rows.append((i, o))
    else:
        sends.append((i, o))
for i, o in sends:
    if o['agent'] in ag:
        ag[o['agent']].rows.append((i, o))
    else:
        n_retired += 1
for it in wf.values():
    first = min((i for i, o in it.rows if o['k'] == K_WORKFLOW), default=-1)
    res = [(i, o) for i, o in it.rows if o['k'] == K_RESUME and i > first]
    it.attempts = len(res)
    it.last_resume_ms = max((o['t'] for i, o in res), default=0)
    task = [o['task'] for i, o in it.rows if o['k'] == K_WORKFLOW]
    it.task = task[0] if task else '-'
for it in ag.values():
    first = min(i for i, o in it.rows if o['k'] == K_AGENT)
    it.attempts = len([1 for i, o in it.rows if o['k'] == K_SEND and i > first])

# ---------------------------------------------------------------- sidecars
PROJECTS = os.path.join(CFG, 'projects')
sidecars = []
n_lost = 0         # directories that could not be measured at all: each counts one unread, so the verdict is never none
_pd = listdir(PROJECTS)
if _pd is None:
    n_lost += 1
for pdir in _pd or []:
    d = os.path.join(PROJECTS, pdir, UUID)
    try:
        if stat.S_ISDIR(os.lstat(d).st_mode):
            sidecars.append(d)
    except (FileNotFoundError, NotADirectoryError):
        pass
    except OSError:
        n_lost += 1


def first_of(rel):
    """The newest regular file at `rel` under any sidecar -> (path, lstat) | ('bad', None) | (None, None)."""
    best, bad = None, False
    for d in sidecars:
        p = os.path.join(d, rel)
        s, st = probe(p)
        if s == OK and (best is None or st.st_mtime_ns > best[1].st_mtime_ns):
            best = (p, st)
        elif s == BAD:
            bad = True
    if best is not None:
        return best
    return (BAD, None) if bad else (None, None)


class Run:
    pass


runs = {}


def run_of(r):
    if r in runs:
        return runs[r]
    x = Run()
    runs[r] = x
    j, jst = first_of('subagents/workflows/%s/journal.jsonl' % r)
    x.journal, x.jst = j, jst
    x.dir = os.path.dirname(j) if (j is not None and j != BAD) else None
    x.sidecar = x.dir[:-len('/subagents/workflows/' + r)] if x.dir else None
    x.summary = x.sst = x.sbad = None
    if x.sidecar:
        sp = os.path.join(x.sidecar, 'workflows', r + '.json')
        s, st = probe(sp)
        x.sbad = (s == BAD)
        if s == OK:
            x.summary, x.sst = sp, st
    x.nolist = False   # the run directory exists and could not be listed: its items are unread
    x.agents = {}      # agent id -> (jsonl path, size, mtime_ns) for the run directory's agent-*.jsonl
    x.metas = {}       # agent id -> meta mtime_ns
    if x.dir:
        names = listdir(x.dir)
        x.nolist = names is None
        for name in names or []:
            m = re.fullmatch(r'agent-(.+)\.(jsonl|meta\.json)', name)
            if not m or not ID_RE.match(m.group(1)):
                continue
            s, st = probe(os.path.join(x.dir, name))
            if m.group(2) == 'jsonl':
                x.agents[m.group(1)] = (os.path.join(x.dir, name), st.st_size if st is not None else 0, st.st_mtime_ns if st is not None else 0, s)
            elif s == OK:
                x.metas[m.group(1)] = st.st_mtime_ns
    return x


for r in list(wf):
    run_of(r)
# Sidecar-only runs: a run directory whose journal changed within <recent-s> and that no row names.
for d in sidecars:
    base = os.path.join(d, 'subagents', 'workflows')
    names = listdir(base)
    if names is None:
        n_lost += 1
    for r in names or []:
        if r in wf or not ID_RE.match(r):
            continue
        j = os.path.join(base, r, 'journal.jsonl')
        s, st = probe(j)
        if s != ABSENT and st is None:
            n_lost += 1                      # a path that could not even be lstat'ed: counted, no run to name
        elif s != ABSENT and st.st_mtime >= NOW - RECENT_S:
            run_of(r)                        # a journal that is not a regular file makes an unread item, never a skip
            wf[r] = Item(K_WORKFLOW, r, 'sidecar')
for it in ag.values():
    it.path, it.st = first_of('subagents/agent-%s.jsonl' % it.key)

# ---------------------------------------------------------------- the swap log
diverged = []     # (uuid, kept, longer)
LOGLINE = re.compile(r'[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9:]{8} sidecar (\S+) diverged (.+) longer (.+)\Z')
log_bytes, log_off = 0, 0
if LOG != '-' and LOG_FROM is not None:
    ls, lst = probe(LOG)
    if ls == OK:
        log_off = LOG_FROM if lst.st_size >= LOG_FROM else 0
        log_bytes = lst.st_size - log_off

# ---------------------------------------------------------------- the pricing
total = price + log_bytes
tail_price = {}     # transcript path -> the bytes its tail window was priced at
for r, x in runs.items():
    if x.journal in (None, BAD):
        continue
    total += x.jst.st_size
    if x.sst is not None:
        total += x.sst.st_size
    for (_p, sz, _m, s) in x.agents.values():
        if s == OK:
            tail_price[_p] = min(sz, TAIL_BYTES)
            total += tail_price[_p]
for it in ag.values():
    if it.st is not None:
        tail_price[it.path] = min(it.st.st_size, TAIL_BYTES)
        total += tail_price[it.path]
if total > SCAN_BUDGET:
    print('budget %d' % total)
    sys.exit(3)

if LOG != '-' and LOG_FROM is not None and log_bytes > 0:
    blob = read_bytes(LOG, start=log_off, limit=log_bytes)
    if blob is not None:
        for line in blob.decode('utf-8', 'replace').split('\n'):
            m = LOGLINE.match(line)
            if m and m.group(1) == UUID:
                diverged.append((m.group(2), m.group(3)))


# ---------------------------------------------------------------- the script path check (D-8365)
def script_ok(s):
    """A script path's tail after its LAST /projects/ must be <pdir>/<uuid>/workflows/scripts/<name>. -> the re-rooted path or None."""
    if not isinstance(s, str) or len(s.encode('utf-8', 'replace')) > 512:
        return None
    i = s.rfind('/projects/')
    if i < 0:
        return None
    tail = s[i + len('/projects/'):]
    p = tail.split('/')
    if len(p) != 5 or p[1] != UUID or p[2] != 'workflows' or p[3] != 'scripts':
        return None
    if not p[0] or p[0] in ('.', '..') or not PDIR_RE.match(p[0]) or not p[4].endswith('.js') or not NAME_STEM_RE.match(p[4][:-3]):
        return None
    if not BYTE_RE.match(tail):
        return None
    rooted = os.path.join(PROJECTS, tail)
    base = os.path.realpath(os.path.join(PROJECTS, p[0], UUID)) + '/workflows/scripts/'
    if not os.path.realpath(rooted).startswith(base):
        return None
    if probe(rooted)[0] != OK:
        return None
    return rooted


# ---------------------------------------------------------------- the journal fold (model.ts#foldJournal, parseLine)
def parse_line(text):
    try:
        o = json.loads(text, parse_constant=no_const)
    except (ValueError, RecursionError):
        t = re.search(r'"type"\s*:\s*"(started|result|failed)"', text)
        k = re.search(r'"key"\s*:\s*"(v[0-9]+:[0-9a-f]{64})"', text)
        a = re.search(r'"agentId"\s*:\s*"([^"\\]*)"', text)
        if not (t and k and a):
            return None
        return t.group(1), k.group(1), a.group(1)
    if not isinstance(o, dict):
        return None
    t, k = o.get('type'), o.get('key')
    if not isinstance(t, str) or not isinstance(k, str) or not KEY_RE.match(k):
        return None
    a = o.get('agentId')
    return t, k, a if isinstance(a, str) else ''


def fold(raw):
    """-> {key: [latest agent id, last state]}. Whole lines only (the unterminated last piece is the reader's carry)."""
    keys = {}
    pieces = raw.split(b'\n')[:-1]
    for p in pieces:
        text = p[:LINE_KEEP_BYTES].decode('utf-8', 'replace')
        if text.strip() == '':
            continue
        got = parse_line(text)
        if got is None:
            continue
        t, k, a = got
        prev = keys.get(k)
        if t == 'started':
            keys[k] = [a, t]
        elif t in ('result', 'failed'):
            keys[k] = [prev[0] if prev else a, t]
    return keys


# ---------------------------------------------------------------- read what the workflow items decide on
need = []      # transcript paths whose tails agent_end reads, in order
need_of = {}   # path -> index in `need`


def want(path):
    if path not in need_of:
        need_of[path] = len(need)
        need.append(path)
    return need_of[path]


for it in wf.values():
    x = runs[it.key]
    it.run = x
    if x.journal in (None, BAD) or x.sbad or x.nolist:
        it.unread = True
        continue
    raw = read_bytes(x.journal, limit=x.jst.st_size)
    if raw is None:
        it.unread = True
        continue
    it.keys = fold(raw)
    it.summary_final = False
    if x.summary is not None:
        sraw = read_bytes(x.summary, limit=x.sst.st_size)
        if sraw is None:
            it.unread = True
            continue
        try:
            so = json.loads(sraw.decode('utf-8'), parse_constant=no_const)
        except (ValueError, RecursionError):
            so = None
        st = so.get('status') if isinstance(so, dict) else None
        it.status = st if isinstance(st, str) else None
        it.summary_final = it.status in ('completed', 'failed') and x.jst.st_mtime_ns <= x.sst.st_mtime_ns
    it.finished = it.summary_final
    mt = [x.jst.st_mtime_ns // 10**9]
    if x.sst is not None:
        mt.append(x.sst.st_mtime_ns // 10**9)
    mt += [m // 10**9 for (_p, _s, m, s) in x.agents.values() if s == OK]
    it.since = max([row_s(o) for i, o in it.rows] + mt)
    it.tails = []     # (agent id, path, meta mtime ns or None)
    if it.finished:
        for k, (aid, _last) in sorted(it.keys.items()):
            ent = x.agents.get(aid) if ID_RE.match(aid) else None
            if ent is not None and ent[3] != ABSENT:
                it.tails.append((aid, ent[0], None, ent[3]))
            else:
                it.unread = True      # the latest attempt's agent transcript is absent (or its id cannot name one): no class from absent evidence
    elif it.attempts >= 1:
        for aid, mns in sorted(x.metas.items()):
            ent = x.agents.get(aid)
            if ent is not None and mns >= it.last_resume_ms * 10**6:
                it.tails.append((aid, ent[0], mns, ent[3]))
    for t in it.tails:
        if t[3] == BAD:
            it.unread = True
        elif t[3] == OK:
            want(t[1])

for it in ag.values():
    if it.path in (None, BAD):
        it.unread = True
        continue
    it.since = max([row_s(o) for i, o in it.rows] + [it.st.st_mtime_ns // 10**9])
    want(it.path)

# ---------------------------------------------------------------- the one jq call
ends = None
if need:
    wins = []
    for p in need:
        b = read_bytes(p, tail=TAIL_BYTES, limit=tail_price[p])
        wins.append(b.decode('utf-8', 'replace') if b is not None else None)
    ok_idx = [i for i, w in enumerate(wins) if w is not None]
    try:
        r = subprocess.run(['jq', '-L', JQ_LIB, '-c', 'include "transcript"; map(agent_end)'],
                           input=json.dumps([wins[i] for i in ok_idx]).encode('ascii'),
                           stdin=None, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        out = json.loads(r.stdout.decode('utf-8')) if r.returncode == 0 else None
        if isinstance(out, list) and len(out) == len(ok_idx) and all(isinstance(v, str) for v in out):
            ends = [None] * len(wins)
            for i, v in zip(ok_idx, out):
                ends[i] = v
    except (OSError, ValueError, RecursionError):
        ends = None


def end_of(path):
    """-> (word, reset digits or '') | None when it could not be read."""
    if ends is None or path not in need_of:
        return None
    v = ends[need_of[path]]
    if v is None:
        return None
    w, _, rs = v.partition(' ')
    return w, rs


RATE, FINISHED_W, OPEN_W = 'rate-limit', 'finished', 'open'      # agent_end's other answer, none, is every other word


def diverged_hit(it):
    if it.kind == K_WORKFLOW:
        hit = [lg for kept, lg in diverged
               if ('/subagents/workflows/%s/' % it.key) in kept or kept.endswith('/workflows/%s.json' % it.key)]
    else:
        hit = [lg for kept, lg in diverged if kept.endswith('/subagents/agent-%s.jsonl' % it.key)]
    return hit


# ---------------------------------------------------------------- classify
retired_items = []
for it in list(wf.values()) + list(ag.values()):
    # an item whose needed tails could not be read, or whose agent answers none, is unread before any class is tried
    if not it.unread:
        if it.kind == K_AGENT:
            e = end_of(it.path)
            if e is None or e[0] not in (RATE, FINISHED_W, OPEN_W):
                it.unread = True
        else:
            for aid, path, mns, s in it.tails:
                if s == OK and end_of(path) is None:
                    it.unread = True
    if it.unread:
        it.cls = None
        continue
    hit = diverged_hit(it)
    if it.kind == K_WORKFLOW:
        lim = [(mns if mns is not None else 0, end_of(path)) for aid, path, mns, s in it.tails if s == OK]
        limited = [(m, e) for m, e in lim if e is not None and e[0] == RATE]
        if not it.finished and it.since < NOW - ABANDON_S:
            it.cls = ABANDONED
        elif hit:
            it.cls = DIVERGED
        elif it.attempts >= 1 and not it.finished and limited:
            it.cls = DEFERRED
            it.reset = max(limited, key=lambda me: me[0])[1][1] or RESET_ARG
        elif it.finished and limited:
            it.cls = HOLED
        elif not it.finished:
            it.cls = IN_FLIGHT
    else:
        e = end_of(it.path)
        fin = e[0] == FINISHED_W
        if not fin and it.since < NOW - ABANDON_S:
            it.cls = ABANDONED
        elif hit:
            it.cls = DIVERGED
        elif it.attempts >= 1 and e[0] == RATE:
            it.cls = DEFERRED
            it.reset = e[1] or RESET_ARG
        elif e[0] in (RATE, OPEN_W):
            it.cls = STOPPED_AGENT
    if it.cls == DIVERGED:
        lg = hit[-1]
        it.longer = lg if BYTE_RE.match(lg) else '-'
    if it.cls is None:
        retired_items.append(it)

# ---------------------------------------------------------------- scripts of workflow rows (D-8365)
for it in wf.values():
    if it.src != 'record':
        continue
    good = None
    for i, o in it.rows:
        if o['k'] in (K_WORKFLOW, K_RESUME) and o.get('script') is not None:
            p = script_ok(o['script'])
            if p is None:
                n_readpath += 1
                o['script'] = None
            else:
                good = p
    it.script = good or '-'
for it in wf.values():
    if it.src == 'sidecar' and it.cls is not None:
        cands = [n for n in (listdir(os.path.join(it.run.sidecar, 'workflows', 'scripts')) or []) if n.endswith('-%s.js' % it.key)] if it.run.sidecar else []
        rooted = None
        if len(cands) == 1:
            rooted = script_ok(os.path.join(it.run.sidecar, 'workflows', 'scripts', cands[0]))
        it.script = rooted or '-'

# ---------------------------------------------------------------- assemble
ORDER = {c: n for n, c in enumerate((IN_FLIGHT, STOPPED_AGENT, HOLED, DEFERRED, DIVERGED, ABANDONED))}
allitems = [it for it in list(wf.values()) + list(ag.values())]
found = sorted([it for it in allitems if it.cls is not None], key=lambda it: (ORDER[it.cls], -it.since, it.key))
unread_items = [it for it in allitems if it.unread]
keep_idx = set()
counts = {c: 0 for c in MANIFEST_CLASSES}
killed = resumed = 0
for it in found:
    counts[it.cls] += 1
    if it.cls == IN_FLIGHT and it.status == 'killed':
        killed += 1
n_unread = n_expired = 0
for it in unread_items:
    newest = max((row_s(o) for i, o in it.rows), default=0)
    if it.rows and newest < NOW - ABANDON_S:
        n_expired += 1
    else:
        n_unread += 1       # a sidecar-only item has no rows to keep or expire; it leaves when its journal ages past recent-s
        keep_idx.update(i for i, o in it.rows)
n_unread += n_lost
for it in retired_items:
    n_retired += len(it.rows)
    if it.attempts >= 1:
        resumed += 1


def line_of(it):
    return 'item class=%s kind=%s run=%s task=%s agent=%s script=%s attempts=%d since=%d reset=%s longer=%s src=%s' % (
        it.cls, it.kind, it.key if it.kind == K_WORKFLOW else '-', it.task if it.kind == K_WORKFLOW else '-',
        it.key if it.kind == K_AGENT else '-', it.script if it.kind == K_WORKFLOW else '-', it.attempts, it.since,
        it.reset if it.cls == DEFERRED else '-', it.longer, it.src)


lines, used = [], 0
for it in found:
    if it.attempts >= 1:
        resumed += 1
    ln = line_of(it)
    if used + len(ln.encode('utf-8', 'replace')) + 1 <= MAX_BYTES and n_over == 0:
        lines.append(ln)
        used += len(ln.encode('utf-8', 'replace')) + 1
        if it.cls == ABANDONED:
            n_retired += len(it.rows)
        else:
            keep_idx.update(i for i, o in it.rows)
    else:
        n_over += 1
        keep_idx.update(i for i, o in it.rows)

nitems = len(found)
verdict = V_LISTED if nitems >= 1 else (V_NONE if n_unread == 0 else V_UNREAD)
head = ['verdict=%s' % verdict, 'items=%d' % nitems] + ['%s=%d' % (c, counts[c]) for c in MANIFEST_CLASSES]
head += ['unread=%d' % n_unread, 'unread-expired=%d' % n_expired, 'killed=%d' % killed, 'resumed=%d' % resumed]
head += ['drop-%s=%d' % (w, drops[w]) for w in MANIFEST_DROP_WHY]
head += ['drop-read=%d' % n_read, 'drop-readpath=%d' % n_readpath, 'drop-over=%d' % n_over, 'retired=%d' % n_retired]
print('summary ' + ' '.join(head))
for ln in lines:
    print(ln)
for i, o in rows:
    if i in keep_idx:
        print('row ' + json.dumps(o, separators=(',', ':')))
