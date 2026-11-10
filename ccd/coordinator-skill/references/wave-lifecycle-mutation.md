# The wave lifecycle: mutation testing

One part of the wave lifecycle. `wave-lifecycle.md` lists every part.

## Mutation testing — through the helper, never by hand

`references/mutation-run.py` (stdlib-only Python 3; `--help` shows the rest) is the way a
guard's test is proven to go red. It compiles each mutant in memory, so no mutant file exists;
runs the tests in a per-mutant temp directory under a RAM-backed root that it removes after
every mutant, even on failure or interrupt; runs only the tests that execute the mutated lines
(from one traced baseline); and, given the previous round's `--out` file and a `--diff`,
re-runs only mutants on changed lines. Output is one line per mutant and a summary.

- Never write a mutant to disk and never leave a per-run temp tree behind: a round of
  thousands of mutants once filled most of a fleet volume's inodes with directories nobody
  removed.
- A heavy round (hundreds of mutants, or a slow suite) belongs in a child workspace, not in
  this session's scratch: dispatch it as a wave, and take its result line, not its files.
