// THREE READERS, ONE MARKER. `continuationOf` (TypeScript,
// `server/src/transcript/parse.ts`), `_continued_in_of` (`ccd/ccd`) and
// `_dr_continued_in` (`ccd/ccrc-doctor-checks`, `ccrc doctor`'s `transcripts`
// check) each decide what a `continued-in` line is, and bash cannot import
// TypeScript. So the constants and the literals are pinned equal here — the
// same shape `pool-name-parity.test.ts` uses for the pools directory name,
// and for the same reason: a drift in one of three spellings is a reader
// that disagrees with the thing it exists to agree with.
//
// The doctor check is DELIBERATELY its own reader, not a call into
// `_continued_in_of` — `ccd/ccrc-doctor-checks` is sourced by `ccrc`, which
// does not source `ccd`, so `_continued_in_of` is not a name that file can
// reach (task-8-brief.md's own constraint). What is pinned here is that the
// doctor's OWN reader exists under its own name, that all three readers agree
// on the record's shape, and that no FOURTH copy of the marker's literals
// has crept into tracked source.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONTINUATION_TAIL_BYTES } from '../src/transcript/parse.js';
// `CCD` is the ONE spelling of the path to ccd/ccd (single-definition.test.ts's
// "one path to the ccd script" scan pins ccdWsHelpers.ts as its sole holder,
// and that scan matches on sight — even inside a comment naming the literal
// it hunts for, which is why this note uses no quotes around the path at
// all) — imported rather than re-derived here with a second copy of it.
import { CCD } from './ccdWsHelpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ccrcRoot = path.resolve(here, '..', '..');

const ccd = readFileSync(CCD, 'utf8');
const doctor = readFileSync(path.join(ccrcRoot, 'ccd', 'ccrc-doctor-checks'), 'utf8');

describe('continued-in parity', () => {
  it('ccd uses the same tail window as the server', () => {
    const m = /^CONTINUED_IN_TAIL_BYTES=(\d+)/m.exec(ccd);
    expect(m?.[1]).toBe(String(CONTINUATION_TAIL_BYTES));
  });

  it('the doctor check uses the same tail window as the server, spelled in its own file', () => {
    // A separate assertion, not a re-run of the one above against `doctor`:
    // the mutation table's two rows ("change it in ccd/ccd only" / "change it
    // in ccrc-doctor-checks only") must each have a DISTINCT case to catch
    // them — one assertion reading both files could pass with either one
    // wrong so long as the OTHER matched some incidental fallback.
    const m = /^CONTINUED_IN_TAIL_BYTES=(\d+)/m.exec(doctor);
    expect(m?.[1]).toBe(String(CONTINUATION_TAIL_BYTES));
  });

  it('every reader matches the same record type and field', () => {
    for (const src of [ccd, doctor]) {
      expect(src).toContain('"type":"continued-in"');
      expect(src).toContain('continuedInSessionId');
    }
  });

  it('the doctor check has its OWN reader, named for what it is, not a call into ccd\'s', () => {
    // `_continued_in_of` is ccd's name and ccd's function — out of scope for
    // a file `ccrc` sources without ever sourcing `ccd` (task-8-brief.md's
    // own constraint). The doctor's own reader is `_dr_continued_in`;
    // asserting its presence is the positive half. The negative half looks
    // for an actual CALL of ccd's function — `_continued_in_of` still
    // appears in this file's comments, naming what `_dr_continued_in`
    // mirrors and why, which is prose, not a third copy — so the pattern
    // requires the shell-call shape (the name immediately followed by an
    // argument list), which no comment produces.
    expect(doctor).toContain('_dr_continued_in');
    expect(doctor).not.toMatch(/[^_a-zA-Z]_continued_in_of\s+["$]/);
  });

  // ── exactly three readers exist ───────────────────────────────────────
  // The mutation this guards: a fourth copy of the marker's literals landing
  // anywhere in tracked, non-test source — a plausible slip, since the
  // record shape is three short string literals that are easy to retype
  // rather than import. Scoped to SOURCE roots, not `server/test/**`, which
  // legitimately plants the same literals to build fixture transcripts; a
  // fixture is data a reader consumes, not a fourth reader of its own.
  const SOURCE_ROOTS = [
    path.join(ccrcRoot, 'server', 'src'),
    path.join(ccrcRoot, 'shared'),
    path.join(ccrcRoot, 'agent', 'src'),
    path.join(ccrcRoot, 'pwa', 'src'),
  ];

  function tsSources(dir: string): string[] {
    const out: string[] = [];
    for (const e of readdirSync(dir)) {
      if (e.startsWith('__')) continue;
      const p = path.join(dir, e);
      if (statSync(p).isDirectory()) { out.push(...tsSources(p)); continue; }
      if (/\.tsx?$/.test(p)) out.push(p);
    }
    return out;
  }

  it('exactly three readers exist: no fourth copy of the marker literal in tracked TypeScript source', () => {
    const hits: string[] = [];
    for (const root of SOURCE_ROOTS) {
      for (const f of tsSources(root)) {
        const text = readFileSync(f, 'utf8');
        if (text.includes('continuedInSessionId')) hits.push(path.relative(ccrcRoot, f));
      }
    }
    expect(hits.sort()).toEqual(['server/src/transcript/parse.ts']);
  });

  // `git ls-files`, not a hand-listed pair — `ccd/` holds ~39 tracked files
  // (`ccrc-api`, `session-hook.sh`, `ccd-pool-sync`, `ccrc`, the skill
  // trees, …) and a fixed two-file guess is the exact "hand-maintained list
  // of files to scan" defect this test otherwise exists to refuse one level
  // up: a fourth copy landing in any OTHER file under `ccd/` — `session-
  // hook.sh` is the obvious candidate, since it is the other writer/reader
  // in this area of the marker's own neighbourhood — would leave this test
  // green while defeating the guarantee its name makes. Scoped to TRACKED
  // files (`git ls-files`) rather than every path on disk, matching the
  // TypeScript scan's own scope: build artefacts and scratch files are not
  // readers, tracked source is.
  function trackedFiles(dir: string): string[] {
    const out = execFileSync('git', ['-C', ccrcRoot, 'ls-files', '--', dir], { encoding: 'utf8' });
    return out.split('\n').filter(Boolean).map((f) => path.join(ccrcRoot, f));
  }

  it('exactly three readers exist: ccd/ccd and ccd/ccrc-doctor-checks are the only tracked files under ccd/ carrying it', () => {
    const hits: string[] = [];
    for (const f of trackedFiles('ccd')) {
      let text: string;
      try { text = readFileSync(f, 'utf8'); } catch { continue; }
      if (text.includes('continuedInSessionId')) hits.push(path.relative(ccrcRoot, f));
    }
    expect(hits.sort()).toEqual(['ccd/ccd', 'ccd/ccrc-doctor-checks']);
  });
});
