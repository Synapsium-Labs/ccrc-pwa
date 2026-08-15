/**
 * D1's locator, tested with no `cmd_swap` in sight.
 *
 * A session uuid is globally unique, so the transcript can be FOUND rather
 * than guessed — which is the whole fix. Today's swap munges the registry
 * workdir into one directory name and copies exactly that path; on 2026-08-11
 * the session had moved into a worktree, the guess missed, and a rate-limit
 * rescue traded 70MB of conversation for a reprieve.
 *
 * Everything below runs the REAL ccd functions against a fixture HOME whose
 * `.claude*` config dirs are planted by hand (spec §1's measured shapes: M1's
 * one-inode-three-names, M3's sidecar with no `.jsonl` sibling). ccd runs
 * under `set -uo pipefail` with NO `-e`, so a non-zero rc is something a test
 * must ASSERT — never something that shows up as a thrown exception.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-swap-carry-'); });
afterEach(() => { h.cleanup(); });

const UUID = 'b7001948-1111-4bcc-b60b-0cfc0dc3d199';
const SRC = '.claude';        // the `claude` account's config dir
const DST = '.claude-dev0';   // the `claude-dev0` account's config dir

/** A transcript at <cfg>/projects/<pdir>/<uuid>.jsonl. `mtime` in whole
 *  seconds, because §2.2's newest-wins rule reads `stat -c %Y`. */
const plant = (cfg: string, pdir: string, body: string, mtime?: number): string => {
  const dir = path.join(h.home, cfg, 'projects', pdir);
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, `${UUID}.jsonl`);
  fs.writeFileSync(f, body);
  if (mtime !== undefined) fs.utimesSync(f, mtime, mtime);
  return f;
};

/** A second NAME for an existing inode — M1's production shape, verbatim. */
const linkAt = (from: string, cfg: string, pdir: string): string => {
  const dir = path.join(h.home, cfg, 'projects', pdir);
  fs.mkdirSync(dir, { recursive: true });
  const to = path.join(dir, `${UUID}.jsonl`);
  fs.linkSync(from, to);
  return to;
};

/** A sidecar file at <cfg>/projects/<pdir>/<uuid>/<rel>. */
const sidecar = (cfg: string, pdir: string, rel: string, body: string): string => {
  const f = path.join(h.home, cfg, 'projects', pdir, UUID, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, body);
  return f;
};

const dst = (pdir: string): string =>
  path.join(h.home, DST, 'projects', pdir, `${UUID}.jsonl`);
const read = (p: string): string => fs.readFileSync(p, 'utf8');

/** Every transcript body the DESTINATION account holds, wherever it landed —
 *  the assertion that a superseded inode was not filed somewhere else. */
const dstBodies = (): string[] => {
  const root = path.join(h.home, DST, 'projects');
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root)
    .map((d) => path.join(root, d, `${UUID}.jsonl`))
    .filter((p) => fs.existsSync(p))
    .map(read);
};

/** `_swap_carry_jsonl` with its rc made visible as text. */
const carry = (mdir: string, sanitize = 0): string =>
  h.sh(`_swap_carry_jsonl "$HOME/${SRC}" "$HOME/${DST}" ${UUID} '${mdir}' ${sanitize} `
    + '&& echo RC0 || echo RC$?');

describe('_transcript_matches', () => {
  it('finds every match, in every project directory, not one guessed dir', () => {
    // Kills the "munge one directory and look there" mutant — i.e. today's
    // cmd_swap, and the 2026-08-11 incident.
    plant(SRC, '-data-projects-demo', 'A\n');
    plant(SRC, '-data-projects-demo--claude-worktrees-quiet-mesa', 'B\n');
    const out = h.sh(`_transcript_matches "$HOME/${SRC}" ${UUID}`).split('\n');
    expect(out).toHaveLength(2);
    expect(out.map((p) => path.basename(path.dirname(p))).sort()).toEqual([
      '-data-projects-demo',
      '-data-projects-demo--claude-worktrees-quiet-mesa',
    ]);
  });

  it('answers nothing — never a literal `*` path — when the uuid is absent', () => {
    // Kills the missing-nullglob mutant: without it the glob yields the
    // uninterpolated "<cfg>/projects/*/<uuid>.jsonl", which `[[ -f ]]` quietly
    // answers no to, so "found nothing" and "wrote nothing" become the same
    // silent shrug. §2.1: zero matches must be a TESTABLE state.
    fs.mkdirSync(path.join(h.home, SRC, 'projects'), { recursive: true });
    expect(h.sh(`_transcript_matches "$HOME/${SRC}" ${UUID}; echo END`)).toBe('END');
  });

  it('is scoped to the source config dir — never a sweep across accounts', () => {
    // M2: the incident uuid exists in FIVE config dirs at five different
    // sizes. A locator allowed to cross accounts would carry a stale copy.
    plant(SRC, '-data-projects-demo', 'MINE\n');
    plant('.claude-personal', '-data-projects-demo', 'STALE\n');
    const out = h.sh(`_transcript_matches "$HOME/${SRC}" ${UUID}`).split('\n');
    expect(out).toHaveLength(1);
    expect(out[0]).toContain(`/${SRC}/projects/`);
  });
});

describe('_sidecar_matches', () => {
  it('globs sidecars in their own right, including one with no .jsonl sibling', () => {
    // M3: two of the incident's sidecars sat in project dirs holding no
    // transcript at all. "Beside each jsonl" would carry neither.
    plant(SRC, '-data-projects-demo', 'A\n');
    sidecar(SRC, '-data-projects-demo', 'tool-results/r.json', 'R\n');
    sidecar(SRC, '-lonely-worktree', 'subagents/s.jsonl', 'S\n');
    const out = h.sh(`_sidecar_matches "$HOME/${SRC}" ${UUID}`).split('\n');
    expect(out).toHaveLength(2);
    expect(out.map((p) => path.basename(path.dirname(p))).sort())
      .toEqual(['-data-projects-demo', '-lonely-worktree']);
  });

  it('returns the directory with NO trailing slash', () => {
    // §2.3: `cp -a src/ dst` onto a directory a previous attempt half-created
    // nests the sidecar inside itself. The stripped slash is the fix, and it
    // belongs to the locator so no caller has to remember it.
    sidecar(SRC, '-data-projects-demo', 'tool-results/r.json', 'R\n');
    const out = h.sh(`_sidecar_matches "$HOME/${SRC}" ${UUID}`);
    expect(out.endsWith('/')).toBe(false);
    expect(out.endsWith(UUID)).toBe(true);
  });

  it('never returns the .jsonl file as if it were a sidecar', () => {
    // Kills the mutant that drops the trailing slash from the glob (and the
    // -d test with it): `<projects>/*/<uuid>` alone matches nothing here, but
    // `<projects>/*/<uuid>*` would match the transcript.
    plant(SRC, '-data-projects-demo', 'A\n');
    expect(h.sh(`_sidecar_matches "$HOME/${SRC}" ${UUID}; echo END`)).toBe('END');
  });
});

describe('_swap_carry_jsonl', () => {
  it('mirrors every match at its own relative dir, and covers mdir with the newest', () => {
    // Two distinct inodes, neither of them at mdir: both are genuinely
    // different files (a startup-directory transcript and the relocated one),
    // and §2.2 keeps them wherever keeping them costs nothing.
    plant(SRC, '-data-projects-demo', 'OLD\n', 1000);
    plant(SRC, '-w-quiet-mesa', 'NEW\n', 2000);
    expect(carry('-mdir-elsewhere')).toBe('RC0');
    expect(read(dst('-data-projects-demo'))).toBe('OLD\n');
    expect(read(dst('-w-quiet-mesa'))).toBe('NEW\n');
    // mdir is claimed by EVERY match — it is the address the resumed process
    // reads first — and the newest wins it.
    expect(read(dst('-mdir-elsewhere'))).toBe('NEW\n');
  });

  it('still returns a real rc when mdir is empty, instead of killing the shell', () => {
    // §ambiguity resolution's mdir flows straight from `_reg_get workdir`,
    // which is `cat … 2>/dev/null` — "" for a missing `.workdir` file. An
    // empty bash array subscript on WRITE (`winner[""]=...`) is a FATAL
    // interpreter error under `set -u`, not a recoverable one: no rc, nothing
    // after it runs. Task 2 calls this AFTER `systemctl stop` and `tmux
    // kill-session`, so a crash here would tear the session down and then die
    // mid-carry — wrapper never flipped, nothing restarted, nothing carried,
    // no rc to branch on. Every match must still land at its own mirrored
    // dir even though there is no mdir slot to cover.
    plant(SRC, '-data-projects-demo', 'A\n');
    plant(SRC, '-w-quiet-mesa', 'B\n');
    expect(carry('')).toBe('RC0');
    expect(read(dst('-data-projects-demo'))).toBe('A\n');
    expect(read(dst('-w-quiet-mesa'))).toBe('B\n');
  });

  it('breaks an equal-mtime tie the same way regardless of locale, via a C-collated sort', () => {
    // stat -c %Y is whole-second granularity, so ties are reachable, and ccd
    // runs from an interactive shell, `systemd-run --user`, and the auto-swap
    // dispatcher — three environments, three possible locales. Left to the
    // glob's own order the winner would follow LC_COLLATE and could flip
    // depending on who triggered the swap. Under the LC_ALL=C sort this
    // function now pins, '-B-dir' sorts before '-a-dir' (ASCII 'B' < 'a') —
    // the opposite of casefolded collations like en_US.UTF-8 — so the winner
    // is pinned to a specific, reproducible answer rather than merely
    // "consistent with itself".
    plant(SRC, '-a-dir', 'A\n', 1000);
    plant(SRC, '-B-dir', 'B\n', 1000);
    expect(carry('-mdir-elsewhere')).toBe('RC0');
    expect(read(dst('-a-dir'))).toBe('A\n');
    expect(read(dst('-B-dir'))).toBe('B\n');
    expect(read(dst('-mdir-elsewhere'))).toBe('B\n');
  });

  it('resolves a destination collision by newest source mtime, and drops the loser', () => {
    // The incident replayed WITH a full carry: the stale startup transcript
    // still sits at the old munge, which for many rows IS mdir. Copy both
    // while preserving directories and the stale one lands at mdir. Kills the
    // "last writer wins" and "mirror beats mdir" mutants.
    plant(SRC, '-data-projects-demo', 'OLD\n', 1000);
    plant(SRC, '-w-quiet-mesa', 'NEW\n', 2000);
    expect(carry('-data-projects-demo')).toBe('RC0');
    expect(read(dst('-data-projects-demo'))).toBe('NEW\n');
    expect(read(dst('-w-quiet-mesa'))).toBe('NEW\n');
    // "strictly superseded history for the same session, at the same address":
    // the older inode's only slot was one the newer match also claimed, so it
    // is not copied at all rather than filed where it was never written.
    expect(dstBodies()).not.toContain('OLD\n');
  });

  it('one inode wearing three names costs one copy and three links', () => {
    // M1, in production right now: `8828232 3 70906385` — one inode, three
    // names, 70MB. Without the inode grouping one recovered session costs
    // 210MB per swap.
    const a = plant(SRC, '-data-projects-x', `${'X'.repeat(70)}\n`);
    linkAt(a, SRC, '-mnt-projects-x');
    linkAt(a, SRC, '-w-x');
    expect(carry('-data-projects-x')).toBe('RC0');
    const inos = ['-data-projects-x', '-mnt-projects-x', '-w-x']
      .map((d) => fs.statSync(dst(d)).ino);
    expect(new Set(inos).size, 'three names must share ONE destination inode').toBe(1);
    expect(fs.statSync(dst('-data-projects-x')).nlink,
      'three destination names, one content copy').toBe(3);
    // And the destination is a COPY across config dirs, never a link back into
    // the source account: the transcript is APPENDED to, so an aliased source
    // would grow a conversation that account never had.
    expect(inos[0]).not.toBe(fs.statSync(a).ino);
    expect(read(a)).toBe(`${'X'.repeat(70)}\n`);
  });

  it('preserves the source mtime — two of this design\'s own rules read it', () => {
    // Kills the `cp` (no -p) mutant. A plain copy stamps every destination
    // with the time of the swap, so the OLDEST carried transcript looks like
    // the freshest thing in the account the moment it lands — which breaks
    // newest-wins here and the resolver's rung ordering in §5.1.
    plant(SRC, '-data-projects-demo', 'A\n', 1700000000);
    expect(carry('-data-projects-demo')).toBe('RC0');
    expect(Math.floor(fs.statSync(dst('-data-projects-demo')).mtimeMs / 1000))
      .toBe(1700000000);
  });

  it('unlinks the destination first, so a previous swap\'s sibling name is not rewritten', () => {
    // THE subtlest requirement in D1, measured on this box (coreutils 9.4).
    // Swapping back to an account a session lived on before is ordinary (M2:
    // 17 of 23 rows have residue elsewhere), and a previous swap left that
    // account's names HARDLINKED to each other. A plain `cp` onto one of them
    // writes THROUGH the shared inode and every sibling changes with it.
    const previous = plant(DST, '-data-projects-demo', 'PREVIOUS\n');
    linkAt(previous, DST, '-w-quiet-mesa');
    plant(SRC, '-data-projects-demo', 'CURRENT\n');
    expect(carry('-data-projects-demo')).toBe('RC0');
    expect(read(dst('-data-projects-demo'))).toBe('CURRENT\n');
    expect(read(dst('-w-quiet-mesa')),
      'the write went through a shared inode and rewrote a name this swap never claimed')
      .toBe('PREVIOUS\n');
  });

  it('links over a destination name that already exists', () => {
    // `ln` onto an existing name fails EEXIST, and ccd runs without `set -e`:
    // the script would sail past it and report success, leaving the residue
    // in place. Kills the missing `-f`.
    const a = plant(SRC, '-data-projects-demo', 'CURRENT\n');
    linkAt(a, SRC, '-w-quiet-mesa');
    plant(DST, '-w-quiet-mesa', 'RESIDUE\n');
    expect(carry('-data-projects-demo')).toBe('RC0');
    expect(read(dst('-w-quiet-mesa'))).toBe('CURRENT\n');
    expect(fs.statSync(dst('-w-quiet-mesa')).ino)
      .toBe(fs.statSync(dst('-data-projects-demo')).ino);
  });

  it('answers rc 2 when copies land but NOT at mdir — the one slot that matters', () => {
    // FINAL REVIEW. `(( carried > 0 )) || return 1` said "at least one copy
    // landed", but §2.2's own docstring says mdir is "the directory the resumed
    // process starts in, and the first address it reads". Measured before this
    // fix: two distinct source inodes, mdir's destination unwritable — a
    // warning on stderr, carried=1, rc 0, and cmd_swap went on to flip
    // `wrapper` and print `swapped …`. The resumed session then munges its cwd
    // to mdir, finds nothing, and reports no history: D1's exact symptom,
    // behind a success report.
    //
    // The mdir destination is made unwritable rather than the copy stubbed out,
    // so this is the real `cp`'s real EACCES.
    plant(SRC, '-data-projects-demo', 'OLD\n', 1000);
    plant(SRC, '-w-quiet-mesa', 'NEW\n', 2000);
    const locked = path.join(h.home, DST, 'projects', '-mdir-elsewhere');
    fs.mkdirSync(locked, { recursive: true });
    fs.chmodSync(locked, 0o500);
    try {
      expect(carry('-mdir-elsewhere')).toBe('RC2');
      // NOT a total failure — that is the whole point. The other two slots
      // landed, which is exactly why `carried > 0` could not see this.
      expect(read(dst('-data-projects-demo'))).toBe('OLD\n');
      expect(read(dst('-w-quiet-mesa'))).toBe('NEW\n');
      expect(fs.existsSync(path.join(locked, `${UUID}.jsonl`))).toBe(false);
    } finally {
      fs.chmodSync(locked, 0o700);
    }
  });

  it('answers rc 0 when a HARDLINK — not a copy — is what fills the mdir slot', () => {
    // The mutant this kills is the tempting one-liner: gate on `carried`
    // per-slot. `carried` counts distinct INODES copied, so M1's production
    // shape (one inode wearing several names) legitimately reports carried=1
    // while every slot is correctly filled — and mdir's is a `ln -f`, never a
    // `cp`. Reading the verdict off `carried` would refuse a perfect swap.
    const a = plant(SRC, '-data-projects-demo', 'HISTORY\n');
    linkAt(a, SRC, '-w-quiet-mesa');
    expect(carry('-mdir-elsewhere')).toBe('RC0');
    expect(read(dst('-mdir-elsewhere'))).toBe('HISTORY\n');
    expect(fs.statSync(dst('-mdir-elsewhere')).ino)
      .toBe(fs.statSync(dst('-data-projects-demo')).ino);
  });

  it('answers rc 1 and writes nothing at all when the uuid has no transcript', () => {
    // §2.4's precondition: an empty glob must not read as an empty copy, and
    // the refusal Task 3 builds on top of this needs a destination account
    // that was never touched. Kills "mkdir the slots first, decide later".
    fs.mkdirSync(path.join(h.home, SRC, 'projects'), { recursive: true });
    expect(carry('-data-projects-demo')).toBe('RC1');
    expect(fs.existsSync(path.join(h.home, DST, 'projects'))).toBe(false);
  });

  it('sanitizes the copy BEFORE the links are made, so every name is the sanitized file', () => {
    // _sanitize_anthropic rewrites through open(f+".tmp") + os.replace, which
    // gives the replaced name a NEW inode. Sanitize after linking and every
    // sibling keeps the unsanitized file — i.e. the empty-text-block 400 the
    // sanitize exists to prevent, on whichever name the CLI happens to open.
    const empty = '{"message":{"content":[{"type":"text","text":""}]}}';
    const a = plant(SRC, '-data-projects-demo', `${empty}\n`);
    linkAt(a, SRC, '-w-quiet-mesa');
    expect(carry('-data-projects-demo', 1)).toBe('RC0');
    for (const d of ['-data-projects-demo', '-w-quiet-mesa']) {
      expect(read(dst(d)), `${d} is not the sanitized file`).toContain('"..."');
    }
    expect(fs.statSync(dst('-data-projects-demo')).ino)
      .toBe(fs.statSync(dst('-w-quiet-mesa')).ino);
    // No move, ever: the source account keeps its own, untouched.
    expect(read(a)).toBe(`${empty}\n`);
  });

  it('leaves the transcript alone when sanitize is 0', () => {
    // The contract is unchanged from ccd:7044 — only `gpt` -> Anthropic
    // rewrites anything. Kills "sanitize everything, it is harmless".
    const empty = '{"message":{"content":[{"type":"text","text":""}]}}';
    plant(SRC, '-data-projects-demo', `${empty}\n`);
    expect(carry('-data-projects-demo', 0)).toBe('RC0');
    expect(read(dst('-data-projects-demo'))).toBe(`${empty}\n`);
  });
});
