# Wave 1e, Task 2: the project linking card's browser tests run as two files

Plan: `docs/superpowers/plans/2026-11-25-landing-order-wave1e-browser-shards.md`, Task 2. Base: `main` at
4e17ac96ee0d7e8f99f9dc24515b71f91d2e7190.

## Step 1: today's titles

`project-linking-card.browser.test.ts` on the base holds one `describe` of 22 cases. In the order queue run
45527962041 ran them (job 138915898216, shard 2/3), with each case's own time there and in the green queue run
45532069453 (job 138929574062, shard 2/3; corrected after review run 3750) 35 minutes later:

| # | title | ms, 45527962041 | ms, 45532069453 | after the split |
|---|---|---|---|---|
| 1 | the list as it opens at 360px: one line per linked project, waiting rows open and flagged, the rest behind the group; nothing overflows | 22,456 | 10,663 | -wide |
| 2 | every row opened at 360px: no horizontal overflow and no clipped text, in both skins and both themes | 59,694 | 26,127 | -wide |
| 3 | the list as it opens at 390px: one line per linked project, waiting rows open and flagged, the rest behind the group; nothing overflows | 20,666 | 10,734 | -wide |
| 4 | every row opened at 390px: no horizontal overflow and no clipped text, in both skins and both themes | 55,935 | 27,588 | -wide |
| 5 | the list as it opens at 1280px: one line per linked project, waiting rows open and flagged, the rest behind the group; nothing overflows | 23,877 | 10,856 | -wide |
| 6 | every row opened at 1280px: no horizontal overflow and no clipped text, in both skins and both themes | 82,843 | 32,589 | -wide |
| 7 | the list as it opens at 1470px: one line per linked project, waiting rows open and flagged, the rest behind the group; nothing overflows | 23,747 | 11,751 | -wide |
| 8 | every row opened at 1470px: no horizontal overflow and no clipped text, in both skins and both themes | 61,057 | 32,118 | -wide |
| 9 | the list as it opens at 1920px: one line per linked project, waiting rows open and flagged, the rest behind the group; nothing overflows | 20,081 | 10,677 | -wide |
| 10 | every row opened at 1920px: no horizontal overflow and no clipped text, in both skins and both themes | 49,627 | 32,957 | -wide |
| 11 | the keyboard alone opens a line and the group, and reaches the controls inside, at 390px | 52,459 | 38,497 | stays |
| 12 | the keyboard alone opens a line and the group, and reaches the controls inside, at 1280px | 93,879 | 40,777 | stays |
| 13 | a failed re-read after a write shows the stale note and Read again, contained, at 360px | 43,499 | 17,969 | stays |
| 14 | a failed re-read after a write shows the stale note and Read again, contained, at 1920px | 54,974 | 20,813 | stays |
| 15 | a key cleared on a linked row moves it into the group, which opens, and focus lands on its key field, at 390px | 20,822 | 9,849 | stays |
| 16 | a key cleared on a linked row moves it into the group, which opens, and focus lands on its key field, at 1280px | 26,052 | 11,716 | stays |
| 17 | at 1280 an opened row holds its three cells on one line wherever the card is 760 px or wider, and the template cell wraps under them elsewhere | 27,621 | 12,963 | stays |
| 18 | the workspace picker, candidates with workspaces and an Overlord link stay inside the key cell at 360px | 24,839 | 11,847 | stays |
| 19 | the workspace picker, candidates with workspaces and an Overlord link stay inside the key cell at 390px | 25,578 | 12,354 | stays |
| 20 | the workspace picker, candidates with workspaces and an Overlord link stay inside the key cell at 1280px | 26,919 | 14,144 | stays |
| 21 | the workspace picker, candidates with workspaces and an Overlord link stay inside the key cell at 1470px | 24,414 | 14,024 | stays |
| 22 | the workspace picker, candidates with workspaces and an Overlord link stay inside the key cell at 1920px | 22,194 | 13,563 | stays |

The 22 titles of the base file, expanded over their width loops, equal the run's 22 as a set, each once. The cases'
own times sum to 863,233 ms of the file's 869,850 ms (the rest is the file's setup).

## Steps 2 and 3: the move and the division

- **The move (its own commit).** Everything above the `describe` moved to `pwa/browser/projectLinkingCardRig.ts`
  (the fixture, the measures, `assertContained`, `open`, `openAll`), each exported. One change in what moved: `open`
  read the file's own `browser!` and `server!`, and now reads the pair the file hands to the module's `holdRig` from
  its `beforeAll`. The hooks stay in each test file, as the wheel-chain files keep theirs beside `wheel.ts` (whose
  `Rig` type the module reuses), because `test/browser-dist.test.ts` reads `*.browser.test.*` files only for the
  `dist = sharedDist(); server = await serveDist(dist);` pair: moved into the module, that pin would no longer see
  them. The module's name carries no `.browser.test.`, so the browser config does not collect it, and nothing under
  `pwa/src` imports it. The pwa typecheck (`ccrc test -- ./node_modules/.bin/tsc --noEmit` from `pwa/`) was green
  after the move and after the division.
- **The division.** The first `for (const width of WIDTHS)` loop, the per-width sweep of *the list as it opens* and
  *every row opened* (10 cases), moved whole, its loop unchanged, into `project-linking-card-wide.browser.test.ts`,
  under `describe('Settings › Integrations › Project linking, per width, skin and theme (D-8147, D-8932), second
  file')`. The other 12 stay. No body, no title and no loop header changed; the two headers say where each case lives.

| file | cases | ms, 45527962041 | share of 869.9 s | ms, 45532069453 |
|---|---|---|---|---|
| `project-linking-card.browser.test.ts` | 12 | 443,250 | 51.0% | 218,516 |
| `project-linking-card-wide.browser.test.ts` | 10 | 419,983 | 48.3% | 206,060 |

Both are inside the plan's 45% to 55%. The loop was the one whole block that lands there: any other division moves
parts of a loop, which changes its header.

## Step 4: measured

The title comparison, run from the repository root (exit 0 and `SAME` when the two files hold the base's 22 titles,
each once; exit 1 and `DIFF` with each `MISSING` or `EXTRA` title otherwise):

```bash
git show 4e17ac96ee:pwa/browser/project-linking-card.browser.test.ts > "$TMPDIR/plc-base.ts"
python3 -I - "$TMPDIR/plc-base.ts" -- pwa/browser/project-linking-card.browser.test.ts \
  pwa/browser/project-linking-card-wide.browser.test.ts <<'PY'
# The 22 titles: the base file's `it(` titles against the split files', each `${width}` expanded over its enclosing
# `for (const width of <list>)` loop. Usage: python3 -I - BASE -- SPLIT... ; prints SAME and exits 0, or DIFF and exits 1.
import re, sys
from collections import Counter
WIDTHS = [360, 390, 1280, 1470, 1920]
def titles(text):
    out, stack = [], []
    for line in text.split('\n'):
        f = re.match(r'^(\s*)for \(const width of (\[[^\]]*\]|WIDTHS)\) \{', line)
        if f:
            stack.append((len(f.group(1)), WIDTHS if f.group(2) == 'WIDTHS' else [int(x) for x in f.group(2).strip('[]').split(',')]))
            continue
        if stack and line.strip() == '}' and len(line) - len(line.lstrip()) == stack[-1][0]:
            stack.pop(); continue
        t = re.match(r"^\s*it\((`|')(.*?)\1,", line)
        if t:
            ws = stack[-1][1] if stack and '${width}' in t.group(2) else [None]
            out += [t.group(2) if w is None else t.group(2).replace('${width}', str(w)) for w in ws]
    return out
args = sys.argv[1:]; cut = args.index('--')
base = Counter(t for p in args[:cut] for t in titles(open(p).read()))
split = Counter(t for p in args[cut + 1:] for t in titles(open(p).read()))
print(f'base {sum(base.values())} titles ({len(base)} distinct), split {sum(split.values())} titles ({len(split)} distinct)')
if base == split and max(base.values()) == 1:
    print('SAME'); sys.exit(0)
for t in base - split: print('MISSING', t)
for t in split - base: print('EXTRA', t)
print('DIFF'); sys.exit(1)
PY
```

Its answer on this branch: `base 22 titles (22 distinct), split 22 titles (22 distinct)`, `SAME`, exit 0.
(`vitest list` does not serve here: on this vitest it lists the five `it(` sites with `${width}` unexpanded.)

- `browser-leg` from `pwa/`: green, 22 tests; the leg's include now matches 119 browser files.
- The two files in a real Chrome on this box (the Chromium already installed under the user's playwright cache,
  `CCRC_CHROME` pointing at it; nothing installed), through `ccrc test` with `--maxWorkers=2`: both passed, 22 tests,
  243 s of wall time for the pair. A second run with vitest's JSON reporter, to read each file's time: `project-linking-card.browser.test.ts` 268.1 s, `project-linking-card-wide.browser.test.ts` 240.3 s, the two side by side, 22 passed. The test slice reported one OOM kill during that run; both files passed
  and the run exited 0, and the slice is shared with other sessions' runs, so which process it killed is unmeasured.

## Step 5: the figures

`FILE_MS` gives `project-linking-card.browser.test.ts` 443,250 and `project-linking-card-wide.browser.test.ts` 419,983,
each the sum of its cases' own times in run 45527962041, and removes nothing else. The table now names 119 files.

## Found

- `linking-card-time-varies` (a departure, reported to the coordinator): this file's time is not steady. In run 45527962041 it took 869,850 ms; in the
  green run 45532069453 it took 425,156 ms, every case about half as long, in the same proportions. The table keeps
  the higher figure. At the lower one each half is about 210 s, so the four shards stay balanced either way (Task 3's
  simulation).
