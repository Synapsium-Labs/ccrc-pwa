"""A small explicit-state explorer, shared by every machine of round three (copied unchanged from round two).

Python 3 standard library only. Breadth first, so the first trace found for a check is a
shortest one. A machine module gives:

  DEFAULT            a dict of bounds, switches (readings of the text) and MUTATION
  init(c)            the initial state (a hashable namedtuple)
  succ(s, c)         yields (label, next_state, info); info is a dict the edge checks read
  fmt(s)             one line (or a few) describing a state
  STATE_CHECKS       [(name, f(s, c) -> message or None)]
  EDGE_CHECKS        [(name, f(s, label, info, s2, c) -> message or None)]
  LIVE_CHECKS        [(name, needs(s, c) -> bool, good(s, c) -> bool, allowed(label) -> bool)]
                     "from every reachable state where `needs` holds, a state where `good`
                     holds can be reached along edges whose label `allowed` accepts".
                     It is EF on the bounded graph: a path exists. It is not fairness.
  FACTS              [(name, f(s, c) -> bool)]  reachability facts, reported yes or no

A state bound stops a run that grows past it (MAX_STATES); the run then reports BOUND.
"""
import time
from array import array
from collections import deque

MAX_STATES = 600_000


class Cfg(dict):
    __getattr__ = dict.__getitem__


def make_cfg(default, **kw):
    d = dict(default)
    for k in kw:
        if k not in d:
            raise KeyError('unknown bound or switch: %s' % k)
    d.update(kw)
    return Cfg(d)


def explore(m, c, max_states=MAX_STATES):
    s0 = m.init(c)
    ids = {s0: 0}
    states = [s0]
    parent = array('i', [-1])
    plabel = ['init']
    src, dst, elab = array('i'), array('i'), []
    viol = {}
    dq = deque([0])
    ntrans = 0
    t0 = time.time()
    bound = False
    while dq:
        sid = dq.popleft()
        s = states[sid]
        for name, f in m.STATE_CHECKS:
            if name not in viol:
                msg = f(s, c)
                if msg:
                    viol[name] = ('state', sid, msg)
        for lbl, s2, info in m.succ(s, c):
            ntrans += 1
            for name, f in m.EDGE_CHECKS:
                if name not in viol:
                    msg = f(s, lbl, info, s2, c)
                    if msg:
                        viol[name] = ('edge', sid, msg, lbl, s2)
            nid = ids.get(s2)
            if nid is None:
                nid = len(states)
                ids[s2] = nid
                states.append(s2)
                parent.append(sid)
                plabel.append(lbl)
                dq.append(nid)
                if len(states) > max_states:
                    bound = True
                    dq.clear()
                    break
            src.append(sid)
            dst.append(nid)
            elab.append(lbl)
        if bound:
            break
    return dict(states=states, parent=parent, plabel=plabel, src=src, dst=dst, elab=elab,
                viol=viol, ntrans=ntrans, secs=time.time() - t0, bound=bound)


def path_to(g, sid):
    p = []
    while sid != -1:
        p.append(sid)
        sid = g['parent'][sid]
    return list(reversed(p))


def trace(m, g, sid, extra=None):
    out = []
    p = path_to(g, sid)
    for k, x in enumerate(p):
        out.append('%2d. %s\n      %s' % (k, g['plabel'][x], m.fmt(g['states'][x])))
    if extra is not None:
        lbl, s2 = extra
        out.append('%2d. %s\n      %s' % (len(p), lbl, m.fmt(s2)))
    return '\n'.join(out)


def can_reach(g, good, allowed):
    """mark[k] = 1 when a state where `good` holds is reachable from state k along allowed edges."""
    n = len(g['states'])
    src, dst, elab = g['src'], g['dst'], g['elab']
    ok = {}
    rev = [[] for _ in range(n)]
    for k in range(len(dst)):
        lb = elab[k]
        a = ok.get(lb)
        if a is None:
            a = ok[lb] = bool(allowed(lb))
        if a:
            rev[dst[k]].append(src[k])
    mark = bytearray(n)
    dq = deque()
    for k in range(n):
        if good[k]:
            mark[k] = 1
            dq.append(k)
    while dq:
        x = dq.popleft()
        for y in rev[x]:
            if not mark[y]:
                mark[y] = 1
                dq.append(y)
    return mark


def liveness(m, g, c):
    res = []
    st = g['states']
    for name, needs, good, allowed in m.LIVE_CHECKS:
        goodv = bytearray(1 if good(s, c) else 0 for s in st)
        mark = can_reach(g, goodv, allowed)
        bad = [k for k, s in enumerate(st) if needs(s, c) and not mark[k]]
        if bad:
            # the first in BFS order has a shortest path from the start
            res.append((name, bad[0], len(bad)))
    return res


def run(m, c, max_states=MAX_STATES):
    """Explore, then return {name: (message, trace, steps)} for every violated check."""
    g = explore(m, c, max_states)
    found = {}
    for name, v in g['viol'].items():
        if v[0] == 'edge':
            _, sid, msg, lbl, s2 = v
            found[name] = (msg, trace(m, g, sid, (lbl, s2)), len(path_to(g, sid)))
        else:
            _, sid, msg = v
            found[name] = (msg, trace(m, g, sid), len(path_to(g, sid)) - 1)
    if not g['bound']:
        for name, sid, cnt in liveness(m, g, c):
            found[name] = ('no path to a good state from here [%d such states]' % cnt,
                           trace(m, g, sid), len(path_to(g, sid)) - 1)
    facts = {}
    for name, f in getattr(m, 'FACTS', ()):
        k = next((k for k, s in enumerate(g['states']) if f(s, c)), None)
        facts[name] = None if k is None else (len(path_to(g, k)) - 1, trace(m, g, k))
    if g['bound']:
        found['BOUND'] = ('state bound of %d exceeded' % max_states, '', 0)
    return dict(states=len(g['states']), trans=g['ntrans'], secs=g['secs'], found=found, facts=facts)
