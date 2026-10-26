# ccd/lib/carry-dedupe.py — `ccd carry-dedupe`'s program (#317 items 3-4).
#
# Run only by `cmd_carry_dedupe` in ccd/ccd, whose header states the rules:
#   python3 carry-dedupe.py <reg> <apply 0|1> <uuid|-> <min-age-hours> <ccd path>
# with the account roots and registry rows on stdin, one per line:
#   A<TAB><account><TAB><config dir>      O<TAB><uuid><TAB><account><TAB>live|row
# It lives here, not in ccd/ccd's embedded `_carry_py`, so the god file does not
# grow (ARCH-01's growth check); the link route is NOT re-implemented here. On a
# link EXDEV refused it asks ccd's own `_carry_link_route` (#338, D-4500), once
# per tree pair, by sourcing the ccd that ran it: the one mount-table reader and
# its inode proof stay in one place.
import errno, fcntl, glob, hashlib, json, os, re, stat, subprocess, sys, time

# The refusals: a closed vocabulary, spelled once, here (`ccd-carry-dedupe.test.ts`
# pins it, and that every word a case produced is in it).
DEDUPE_REFUSALS = ('tie', 'diverged', 'recent', 'locked', 'keeperless', 'error')
(TIE, DIVERGED, RECENT, LOCKED, KEEPERLESS, IO_ERROR) = DEDUPE_REFUSALS
# The copy causes this program decides itself, words of ccd's CARRY_CAUSES: the
# walk's own two (any non-EXDEV refusal; a link through a proved alias that still
# failed) and the route's default when it could not be asked. The test pins all
# three as members of that tuple.
LINK_FAILED, ROOT_FAILED, ROUTE_ERROR = 'link-failed', 'root-failed', 'route-error'


def route(a, b):
    """ccd's `_carry_link_route a b` -> ('via', a2, b2) or ('none', cause); `route-error` when it cannot be asked."""
    p = subprocess.run(['bash', '-c', 'source "$1" && _carry_link_route "$2" "$3" && '
                        'printf "%s\\0%s\\0%s\\0" "$CARRY_ROUTE" "$CARRY_A2" "$CARRY_B2"', 'carry-dedupe', CCD, a, b],
                       stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    f = p.stdout.split(b'\0')
    if p.returncode != 0 or len(f) < 3:
        sys.stderr.write(p.stderr.decode('utf-8', 'replace'))
        return ('none', ROUTE_ERROR)
    kind, x, y = (os.fsdecode(v) for v in f[:3])
    return ('via', x, y) if kind == 'via' else ('none', kind)


reg, apply, only, cutoff, CCD = sys.argv[1], sys.argv[2] == '1', sys.argv[3], time.time() - int(sys.argv[4]) * 3600, sys.argv[5]
TMP_DD = '.ccd-carry-dedupe-'
UUID = r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
sys.stdout.reconfigure(errors='backslashreplace')
accts, live, rows, seen_root = [], {}, {}, set()
for line in sys.stdin:
    f = line.rstrip('\n').split('\t')
    if f[0] == 'A' and len(f) == 3 and f[2] and os.path.isdir(f[2]) and os.path.realpath(f[2]) not in seen_root:
        seen_root.add(os.path.realpath(f[2])); accts.append((f[1], f[2]))
    elif f[0] == 'O' and len(f) == 4:
        rows.setdefault(f[1], set()).add(f[2])
        if f[3] == 'live':
            live.setdefault(f[1], set()).add(f[2])
held = {}
for acct, cfg in accts:
    for p in sorted(glob.glob(os.path.join(glob.escape(cfg), 'projects', '*', '*'))):
        b = os.path.basename(p)
        u = b[:-6] if b.endswith('.jsonl') else b
        if not re.fullmatch(UUID, u) or (only != '-' and u != only):
            continue
        st = os.lstat(p)
        kind = 't' if b.endswith('.jsonl') and stat.S_ISREG(st.st_mode) else 's' if stat.S_ISDIR(st.st_mode) else None
        if kind:
            held.setdefault(u, {}).setdefault(acct, {'t': [], 's': []})[kind].append(p)
recent = set()
try:
    with open(os.path.join(reg, 'swap.log'), 'rb') as fh:
        for raw in fh:
            line = raw.decode('utf-8', 'replace')
            m = re.match(r'(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d) (?!carry-dedupe )', line)
            if m and time.mktime(time.strptime(m.group(1), '%Y-%m-%d %H:%M:%S')) >= cutoff:
                recent.update(re.findall(UUID, line))
except FileNotFoundError:
    pass

def same_prefix(a, b, n):
    with open(a, 'rb') as fa, open(b, 'rb') as fb:
        while n > 0:
            k = min(n, 1 << 20)
            x, y = fa.read(k), fb.read(k)
            if x != y or len(x) < k:
                return False
            n -= k
    return True

def index(p):
    ids, lines = set(), set()
    with open(p, 'rb') as fh:
        for raw in fh:
            raw = raw.rstrip(b'\n')
            try:
                o = json.loads(raw)
            except ValueError:
                o = None
            if isinstance(o, dict) and isinstance(o.get('uuid'), str):
                ids.add(o['uuid'])
            elif raw:
                lines.add(hashlib.sha256(raw).digest())
    return ids, lines

def proven(p, st, kp, kst, memo):
    if st.st_size <= kst.st_size and same_prefix(p, kp, st.st_size):
        return True
    if not memo:
        memo.append(index(kp))
    ids, lines = index(p)
    return ids <= memo[0][0] and lines <= memo[0][1]

def sha(p):
    h = hashlib.sha256()
    with open(p, 'rb') as fh:
        for blk in iter(lambda: fh.read(1 << 20), b''):
            h.update(blk)
    return h.digest()

def keeper(u, by):
    owners = live.get(u) or rows.get(u)
    if owners:
        if len(owners) != 1:
            return None, TIE
        k = next(iter(owners))
        return (k, None) if k in by and by[k]['t'] else (None, KEEPERLESS)
    top = sorted(((max(os.lstat(p).st_size for p in v['t']), max(os.lstat(p).st_mtime_ns for p in v['t']), a)
                  for a, v in by.items() if v['t']), reverse=True)
    if not top or (len(top) > 1 and (top[1][0] >= top[0][0] or max(t[1] for t in top[1:]) >= top[0][1])):
        return None, TIE
    return top[0][2], None

def link_same(kd, nd, rel, memo, out):
    np, kp = os.path.join(nd, rel), os.path.join(kd, rel)
    ns, ks = os.lstat(np), os.lstat(kp)
    tmp = os.path.join(os.path.dirname(np), f'{TMP_DD}{os.getpid()}-{out["n"]}')
    out['n'] += 1
    cause = None
    try:
        os.link(kp, tmp)
    except OSError as e:
        cause = LINK_FAILED
        if e.errno == errno.EXDEV:
            if not memo:
                memo.append(route(kd, nd))
            r = memo[0]
            cause = r[1] if r[0] != 'via' else None
            if r[0] == 'via':
                try:
                    os.link(os.path.join(r[1], rel), os.path.join(r[2], os.path.relpath(tmp, nd)))
                except OSError:
                    cause = ROOT_FAILED
    if cause:
        c = out['copy'].setdefault(cause, [0, 0])
        c[0] += 1; c[1] += ns.st_size
        return
    now = os.lstat(np)
    if (now.st_ino, now.st_size, now.st_mtime_ns) != (ns.st_ino, ns.st_size, ns.st_mtime_ns):
        os.unlink(tmp)
        return
    os.replace(tmp, np)
    out['linked'] += 1
    out['bytes'] += ns.st_size if ns.st_nlink == 1 else 0

def sidecars(k, by, out):
    ksides = {os.path.basename(os.path.dirname(d)): d for d in by[k]['s']}
    for a in sorted(by):
        for nd in [] if a == k else by[a]['s']:
            kd = ksides.get(os.path.basename(os.path.dirname(nd))) or (next(iter(ksides.values())) if len(ksides) == 1 else None)
            memo = []
            for dp, dns, fns in os.walk(nd) if kd else ():
                dns[:] = sorted(d for d in dns if not d.startswith('.ccd-carry-'))
                for fn in sorted(fns):
                    rel = os.path.relpath(os.path.join(dp, fn), nd)
                    np, kp = os.path.join(nd, rel), os.path.join(kd, rel)
                    try:
                        ns, ks = os.lstat(np), os.lstat(kp)
                    except FileNotFoundError:
                        continue
                    if fn.startswith('.ccd-carry-') or not (stat.S_ISREG(ns.st_mode) and stat.S_ISREG(ks.st_mode)) \
                            or (ns.st_dev, ns.st_ino) == (ks.st_dev, ks.st_ino) or ns.st_size != ks.st_size \
                            or ns.st_mtime_ns >= cutoff * 1e9 or sha(np) != sha(kp):
                        continue
                    if apply:
                        link_same(kd, nd, rel, memo, out)
                    else:
                        out['linked'] += 1
                        out['bytes'] += ns.st_size if ns.st_nlink == 1 else 0

def one(u, by, out):
    if u in recent:
        return RECENT
    lock = open(os.path.join(reg, '.carry.lock'), 'a')
    try:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return LOCKED
        k, why = keeper(u, by)
        if not k:
            return why
        out['kept'] = k
        kp = max(by[k]['t'], key=lambda p: (os.lstat(p).st_size, os.lstat(p).st_mtime_ns))
        kst = os.lstat(kp)
        kinos = {(os.lstat(p).st_dev, os.lstat(p).st_ino) for p in by[k]['t']}
        refused, plan, memo = None, {}, []
        for a in sorted(by):
            for p in [] if a == k else by[a]['t']:
                st = os.lstat(p)
                if (st.st_dev, st.st_ino) in kinos or os.path.realpath(p) == os.path.realpath(kp):
                    continue
                if st.st_mtime_ns >= cutoff * 1e9:
                    refused = refused or RECENT
                elif proven(p, st, kp, kst, memo):
                    plan.setdefault((st.st_dev, st.st_ino), []).append((p, st))
                else:
                    refused = refused or DIVERGED
        for names in plan.values():
            out['bytes'] += names[0][1].st_size if len(names) == names[0][1].st_nlink else 0
            for p, st in names:
                now = os.lstat(p)
                if apply and (now.st_ino, now.st_size, now.st_mtime_ns) == (st.st_ino, st.st_size, st.st_mtime_ns):
                    os.unlink(p)
                out['unlinked'] += 1
        sidecars(k, by, out)
        return refused
    finally:
        lock.close()

rc, tot = 0, {'uuids': 0, 'copies': 0, 'bytes': 0, 'refused': 0}
print('dedupe: --apply' if apply else 'dedupe: dry run, nothing changes (pass --apply to reclaim)')
print(f'{"UUID":<36} {"COPIES":>6} {"KEPT":<16} {"FILES":>5} {"LINKED":>6} {"BYTES":>14} REFUSED')
for u in sorted(u for u in held if len(held[u]) > 1):
    out = {'kept': '-', 'unlinked': 0, 'linked': 0, 'bytes': 0, 'copy': {}, 'n': 0}
    try:
        why = one(u, held[u], out)
    except OSError as e:
        print(f'ccd: carry-dedupe {u}: {e!r}', file=sys.stderr)
        why, rc = IO_ERROR, 1
    tot['uuids'] += 1; tot['copies'] += len(held[u]); tot['bytes'] += out['bytes']; tot['refused'] += 1 if why else 0
    print(f'{u:<36} {len(held[u]):>6} {out["kept"]:<16} {out["unlinked"]:>5} {out["linked"]:>6} {out["bytes"]:>14} {why or "-"}')
    if apply:
        cp = ''.join(f', copy: {c} {v[0]} files {v[1]} bytes' for c, v in sorted(out['copy'].items()))
        with open(os.path.join(reg, 'swap.log'), 'a') as fh:
            fh.write(f'{time.strftime("%Y-%m-%d %H:%M:%S")} carry-dedupe {u} kept={out["kept"]} unlinked={out["unlinked"]} '
                     f'bytes={out["bytes"]} refused={why or "-"} linked={out["linked"]}{cp}\n')
print(f'total: {tot["uuids"]} uuid(s), {tot["copies"]} copies, {tot["bytes"]} bytes {"reclaimed" if apply else "reclaimable"}, {tot["refused"]} refused')
sys.exit(rc)

