"""Round two of the Overlord model check: the machines round one left out.

Python 3 standard library only.

  python3 check.py --list                          machines, scenarios, readings, mutations
  python3 check.py MACHINE SCENARIO [KEY=VALUE..]  one run; prints each violated check with a trace
  python3 check.py --matrix [MACHINE]              every scenario under the safe readings, then every
                                                   other reading on its scenario
  python3 check.py --mutations [MACHINE]           planted bugs; each should be caught
  python3 check.py --traces                        writes traces/<name>.txt for the report's findings
"""
import importlib
import os
import sys
import time

import explore as X

MACHINES = ['grant', 'restore', 'request', 'command', 'outbox', 'practice']
HERE = os.path.dirname(os.path.abspath(__file__))


def load(name):
    try:
        return importlib.import_module('m_' + name)
    except ModuleNotFoundError:
        return None


def parse_val(v):
    if v in ('True', 'False'):
        return v == 'True'
    if v == 'None':
        return None
    try:
        return int(v)
    except ValueError:
        pass
    if ',' in v or v == '()':
        return tuple(x for x in v.strip('()').split(',') if x)
    return v


def run(m, scen, over):
    kw = dict(m.SCEN[scen])
    kw.update(over)
    c = X.make_cfg(m.DEFAULT, **kw)
    return X.run(m, c)


def show(mname, m, scen, over, out=sys.stdout, only=None):
    r = run(m, scen, over)
    w = out.write
    w('machine %s, scenario %s, %s\n' % (mname, scen, ' '.join('%s=%s' % kv for kv in over.items()) or
                                         'the safe readings'))
    w('%d states, %d transitions, %.1fs\n' % (r['states'], r['trans'], r['secs']))
    for name, v in r['facts'].items():
        w('%s: %s\n' % ('reachable' if v else 'NOT reachable', name))
        if v and only is not None and name in only:
            w('--- shortest trace to it (%d steps):\n%s\n' % (v[0], v[1]))
    names = [n for n, _ in m.STATE_CHECKS] + [n for n, _ in m.EDGE_CHECKS] + [x[0] for x in m.LIVE_CHECKS]
    for n in names + ['BOUND']:
        if n in r['found'] and (only is None or n in only):
            msg, tr, steps = r['found'][n]
            w('\n=== %s VIOLATED: %s\n--- shortest trace (%d steps):\n%s\n' % (n, msg, steps, tr))
    w('\nholds within bounds: %s\n' % (' '.join(n for n in names if n not in r['found']) or '-'))
    return r


def main(argv):
    mods = [(n, load(n)) for n in MACHINES]
    mods = [(n, m) for n, m in mods if m is not None]
    if not argv or argv[0] == '--list':
        for n, m in mods:
            print('machine %s' % n)
            print('  scenarios: %s' % ', '.join(m.SCEN))
            print('  checks: %s' % ' '.join([x[0] for x in m.STATE_CHECKS] + [x[0] for x in m.EDGE_CHECKS] +
                                            [x[0] for x in m.LIVE_CHECKS]))
            for k, v, sc, exp in m.READINGS:
                print('  reading %s=%s (scenario %s; expected to break: %s)' % (k, v, sc, exp or 'nothing'))
            print('  mutations: %s' % ', '.join(x[0] for x in m.MUTATIONS))
        return 0
    if argv[0] == '--matrix':
        t0 = time.time()
        total = 0
        print('| machine | scenario | reading | states | transitions | secs | violated |')
        print('|---|---|---|---|---|---|---|')
        for n, m in mods:
            if len(argv) > 1 and n not in argv[1:]:
                continue
            for sc in m.SCEN:
                r = run(m, sc, {})
                total += r['states']
                print('| %s | %s | safe | %d | %d | %.1f | %s |' % (n, sc, r['states'], r['trans'], r['secs'],
                                                                 ' '.join(sorted(r['found'])) or '-'))
                sys.stdout.flush()
            for k, v, sc, exp in m.READINGS:
                over = {k: v} if not isinstance(k, tuple) else dict(zip(k, v))
                r = run(m, sc, over)
                total += r['states']
                print('| %s | %s | %s | %d | %d | %.1f | %s |' % (
                    n, sc, ' '.join('%s=%s' % kv for kv in over.items()), r['states'], r['trans'], r['secs'],
                    ' '.join(sorted(r['found'])) or '-'))
                sys.stdout.flush()
        print('\ntotal states %d, %.1fs' % (total, time.time() - t0))
        return 0
    if argv[0] == '--mutations':
        print('| machine | mutation | scenario | expected | caught by | states |')
        print('|---|---|---|---|---|---|')
        missed = 0
        for n, m in mods:
            if len(argv) > 1 and n not in argv[1:]:
                continue
            base = {}
            for mut, sc, over, exp in m.MUTATIONS:
                key = (sc, tuple(sorted(over.items())))
                if key not in base:
                    base[key] = set(run(m, sc, over)['found'])
                o = dict(over)
                o['MUTATION'] = mut
                r = run(m, sc, o)
                new = sorted(set(r['found']) - base[key])
                if not new:
                    missed += 1
                print('| %s | %s | %s %s | %s | %s | %d |' % (
                    n, mut, sc, ' '.join('%s=%s' % kv for kv in over.items()), exp or 'none (a gap)',
                    ' '.join(new) or 'NOT CAUGHT', r['states']))
                sys.stdout.flush()
        print('\nnot caught: %d' % missed)
        return 0
    if argv[0] == '--traces':
        os.makedirs(os.path.join(HERE, 'traces'), exist_ok=True)
        for n, m in mods:
            for name, sc, over, only in getattr(m, 'TRACES', ()):
                path = os.path.join(HERE, 'traces', name + '.txt')
                with open(path, 'w') as f:
                    r = show(n, m, sc, over, out=f, only=only)
                hit = [x for x in (only or r['found']) if x in r['found'] or r['facts'].get(x)]
                print('%s: %s' % (name, ' '.join(hit) or 'NOTHING FOUND'))
        return 0
    mname, scen = argv[0], argv[1]
    m = dict(mods)[mname]
    over = {}
    for a in argv[2:]:
        k, v = a.split('=', 1)
        over[k] = parse_val(v)
    show(mname, m, scen, over)
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
