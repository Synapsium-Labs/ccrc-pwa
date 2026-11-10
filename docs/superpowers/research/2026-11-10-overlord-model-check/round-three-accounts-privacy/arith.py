"""The reservation arithmetic of §3.4, swept exhaustively at one percentage point.

Source: docs/superpowers/specs/2026-11-09-overlord-design.md as #2538 merged it, §3.4 (C46, H16, C57) and Table 3.4c. Python 3 standard library only.

  python3 arith.py            the checks, each with its first witness, under the text and under the fix
  python3 arith.py --traces   writes traces/arith-*.txt

One reserved account. Its figures are percentages of a window:
  S7  the seven-day figure          S5  the five-hour figure
  F   Fable's part of the seven-day window (the seven-day figure times the share reading)
  R   reservePct                    fresh  the share reading is under eight hours old
The sweep covers R in 10..100 by 10, F in 0..50, S7 in F..100, six five-hour figures, a fresh and a stale
reading, and two guest classes: about 930,000 answers.
"""
import os
import sys

CEIL = 98          # the seven-day ceiling (§3.4, "the seven-day ceiling (98)")
FCEIL = 40         # FABLE_SHARE_CEILING_PCT (§3.4)
SOFT = 70          # C57: the soft line
HARD = 85          # C57: the harder line
HERE = os.path.dirname(os.path.abspath(__file__))


def left(R, F, fresh):
    # "What is left is the reserve minus the Fable the account has used in the window, never below zero.
    #  An unmeasured or stale reading counts as nothing used, so the whole reserve is kept."
    return R if not fresh else max(0, R - F)


def ceiling7(R, F, fresh, base):
    # the text: "the seven-day ceiling (98) minus what is left of the reserve"
    # the fix:  the soft line minus what is left, while anything is left
    lf = left(R, F, fresh)
    if base == 'text':
        return CEIL - lf
    return CEIL if lf == 0 else SOFT - lf


def ceiling5(R, F, fresh, base, five_follows):
    # the text: "The five-hour figure meets the same line. No Fable reading exists for that window, so the whole
    # reserve is set aside in it."
    if five_follows and fresh and left(R, F, fresh) == 0:
        return CEIL
    return (CEIL if base == 'text' else SOFT) - R


def second7(R, F, fresh, base, stale_second):
    # "Once either window's figure is past the guest's ceiling by half of what is left of the reserve, ccd moves
    # the guest as it does on a hard block, in the middle of its turn."
    if not fresh and not stale_second:
        return None                     # the fix: a stale reading moves no guest in the middle of its turn
    return ceiling7(R, F, fresh, base) + left(R, F, fresh) / 2.0


def overlord_fable(S7, F, fresh):
    # "the Fable arm therefore compares Fable's part of the window with the ceiling"
    # "Unmeasured keeps the current class."
    if not fresh:
        return 'unmeasured'
    if F >= FCEIL or S7 >= CEIL:
        return 'unservable'
    return 'servable'


def guest(cls, S7, S5, F, R, fresh, base, five_follows, reason_all):
    """The answer and its reason for a guest on a reserved account."""
    if cls == 'fable':
        return 'unservable', 'reserved'             # "Fable is unservable, with the reason `reserved`"
    c7 = ceiling7(R, F, fresh, base)
    c5 = ceiling5(R, F, fresh, base, five_follows)
    if S7 >= CEIL or S5 >= CEIL:
        return 'unservable', 'limit'                # today's ceiling, today's word
    if S7 >= c7 or S5 >= c5:
        # the text names a reason for Fable and for an unmeasured figure only
        return 'unservable', ('reserved' if reason_all else None)
    return 'servable', None


def sweep(base, five_follows, stale_second, reason_all):
    out = {}

    def hit(name, msg):
        if name not in out:
            out[name] = msg

    for R in [40] + [r for r in range(10, 101, 10) if r != 40]:
        for F in range(0, 51):
            for fresh in (True, False):
                lf = left(R, F, fresh)
                c7 = ceiling7(R, F, fresh, base)
                s2 = second7(R, F, fresh, base, stale_second)
                # ---- A1: guests never spend the reserve. The first line keeps it whole, the second half of it
                if fresh and lf > 0:
                    top = c7 + lf / 2.0            # the most the figure reaches before ccd moves a guest mid-turn
                    room = CEIL - top              # what the Overlord still has under the seven-day ceiling
                    if room < lf / 2.0 - 1e-9:
                        hit('A1', 'R=%d F=%d: guests can take the figure to %.1f, leaving %.1f of the %d left' % (
                            R, F, top, room, lf))
                    # ---- A2: with reserve left, guests' use alone never takes the account past the Overlord's lines
                    g_first = c7                    # guests stop being placed here
                    if g_first >= SOFT:
                        hit('A2-soft', 'R=%d F=%d: left %d, the guest ceiling is %d, at or past the soft line of %d: '
                            'guests fill the account to the line the Overlord`s own pick passes over' % (
                                R, F, lf, g_first, SOFT))
                    if g_first >= HARD:
                        hit('A2-hard', 'R=%d F=%d: left %d, the guest ceiling is %d, at or past the harder line of %d: '
                            'guests` use alone makes the Overlord`s renewal due' % (R, F, lf, g_first, HARD))
                    if top >= SOFT:
                        hit('A2-second', 'R=%d F=%d: left %d, a guest in a long turn takes the figure to %.0f before '
                            'ccd moves it, past the soft line of %d' % (R, F, lf, top, SOFT))
                for S7 in range(max(F, 0), 101):
                    # ---- A3: a stale share reading never raises a guest's ceiling
                    if not fresh and ceiling7(R, F, False, base) > ceiling7(R, F, True, base):
                        hit('A3', 'R=%d F=%d: a stale reading raises the guest ceiling' % (R, F))
                    # ---- A4: a stale reading moves no guest in the middle of its turn
                    if not fresh and s2 is not None:
                        ok_fresh = S7 < ceiling7(R, F, True, base)
                        if ok_fresh and S7 > s2:
                            hit('A4', 'R=%d F=%d S7=%d: with a fresh reading the guest is servable (ceiling %d). The '
                                'reading goes stale: the ceiling is %d and the second line %.0f, so ccd moves the '
                                'guest in the middle of its turn' % (R, F, S7, ceiling7(R, F, True, base),
                                                                     ceiling7(R, F, False, base), s2))
                    for S5 in (0, 30, 59, 60, 79, 97):
                        if S5 > S7 + 100:
                            continue
                        for cls in ('opus', 'default'):
                            ans, why = guest(cls, S7, S5, F, R, fresh, base, five_follows, reason_all)
                            # ---- A5: a refusal the reservation causes says `reserved`
                            if ans == 'unservable' and why is None:
                                hit('A5', 'R=%d F=%d S7=%d S5=%d, a guest on %s: unservable with no reason word '
                                    '(the figure is under today`s ceiling of %d)' % (R, F, S7, S5, cls, CEIL))
                            # ---- A6: once nothing is left of the reserve, the reservation refuses nothing
                            if fresh and lf == 0 and S7 < CEIL and S5 < CEIL and ans == 'unservable':
                                hit('A6', 'R=%d F=%d S7=%d S5=%d: nothing is left of the reserve, yet the five-hour '
                                    'line (%d) refuses the guest; its second line is the same figure, so ccd moves '
                                    'it in the middle of its turn' % (R, F, S7, S5,
                                                                      ceiling5(R, F, fresh, base, five_follows)))
                    # ---- A7: the Overlord's Fable arm does not read guests' use
                    if fresh and F < FCEIL and S7 < CEIL and overlord_fable(S7, F, fresh) != 'servable':
                        hit('A7', 'R=%d F=%d S7=%d: Fable refused the Overlord under its ceiling' % (R, F, S7))
    return out


def table_3_4c():
    """Table 3.4c, with a reserve of 40."""
    rows = [
        # S7, F, fresh, the Overlord's Fable, the guest ceiling, a guest on Opus
        (30, 10, True, 'servable', 68, 'servable'),
        (70, 10, True, 'servable', 68, 'unservable'),
        (70, 40, True, 'unservable', 98, 'servable'),
        (30, 0, False, 'unmeasured', 58, 'servable'),
    ]
    bad = []
    for S7, F, fresh, ov, ceil, g in rows:
        got = (overlord_fable(S7, F, fresh), ceiling7(40, F, fresh, 'text'),
               guest('opus', S7, 0, F, 40, fresh, 'text', False, False)[0])
        if got != (ov, ceil, g):
            bad.append((S7, F, fresh, got))
    return bad


def budget_table(base):
    """What a reserve of R leaves the Overlord under each line when guests stand at their ceiling."""
    lines = ['| reservePct | guests` ceiling at F=0 | Fable the Overlord can use before the soft line (70) '
             '| before the harder line (85) | a long guest turn can reach |', '|---|---|---|---|---|']
    for R in (20, 30, 40, 50, 68):
        c0 = ceiling7(R, 0, True, base)
        # guests hold the account at their ceiling; the Overlord's Fable then adds point for point: S7 = c0 + F,
        # and the ceiling rises with it, so guests never move
        def reach(line):
            for F in range(0, FCEIL + 1):
                g = (CEIL - R) if base == 'text' else (SOFT - R)
                if g + F >= line:
                    return F
            return FCEIL
        top = c0 + R / 2.0
        lines.append('| %d | %d | %d | %d | %.0f |' % (R, c0, reach(SOFT), reach(HARD), top))
    return '\n'.join(lines)


CHECKS = [
    ('A1', 'guests never spend more than half of what is left of the reserve'),
    ('A2-soft', 'with reserve left, guests at their ceiling leave the account under the soft line'),
    ('A2-hard', 'with reserve left, guests at their ceiling leave the account under the harder line'),
    ('A2-second', 'with reserve left, a guest in a long turn does not take the account past the soft line'),
    ('A3', 'a stale share reading never raises a guest`s ceiling'),
    ('A4', 'a stale share reading moves no guest in the middle of its turn'),
    ('A5', 'a refusal the reservation causes carries the reason `reserved`'),
    ('A6', 'once nothing is left of the reserve, the reservation refuses no guest'),
    ('A7', 'guests` use never refuses the Overlord Fable under its own ceiling'),
]

READINGS = [
    ('the text', dict(base='text', five_follows=False, stale_second=True, reason_all=False)),
    ('the fix', dict(base='soft', five_follows=True, stale_second=False, reason_all=True)),
]


def report(out=sys.stdout):
    w = out.write
    bad = table_3_4c()
    w('Table 3.4c reproduces: %s\n\n' % ('yes' if not bad else 'NO %r' % bad))
    for name, kw in READINGS:
        res = sweep(**kw)
        w('== %s (%s)\n' % (name, ', '.join('%s=%s' % kv for kv in kw.items())))
        for k, text in CHECKS:
            w('  %-9s %-8s %s\n' % (k, 'VIOLATED' if k in res else 'holds', text))
            if k in res:
                w('            first witness: %s\n' % res[k])
        w('\n%s\n\n' % budget_table(kw['base']))
    return 0


def traces():
    res = sweep(**READINGS[0][1])
    groups = {
        'arith-reserve-under-the-lines': ('A2-soft', 'A2-hard', 'A2-second'),
        'arith-stale-reading-moves-guests': ('A4',),
        'arith-no-reason-word': ('A5',),
        'arith-five-hour-line-after-the-reserve': ('A6',),
    }
    for fn, keys in groups.items():
        with open(os.path.join(HERE, 'traces', fn + '.txt'), 'w') as f:
            f.write('arith.py, the text as written (the seven-day ceiling less what is left of the reserve)\n\n')
            for k in keys:
                f.write('%s VIOLATED: %s\n  witness: %s\n\n' % (k, dict(CHECKS)[k], res.get(k, 'none')))
            if fn == 'arith-reserve-under-the-lines':
                f.write('What a reserve leaves the Overlord, the text:\n%s\n\nThe fix (the guest ceiling counted '
                        'from the soft line):\n%s\n' % (budget_table('text'), budget_table('soft')))
        print('%s: %s' % (fn, ' '.join(k for k in keys if k in res) or 'NOTHING FOUND'))


if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == '--traces':
        traces()
    else:
        sys.exit(report())
