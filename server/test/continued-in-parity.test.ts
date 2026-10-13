// THREE READERS, ONE MARKER. `continuationInTail` (TypeScript,
// `server/src/transcript/parse.ts`), `_continued_in_of` (`ccd/ccd`) and
// `_dr_continued_in` (`ccd/ccrc-doctor-checks`, `ccrc doctor`'s `transcripts`
// check) each decide what a `continued-in` marker is, and bash cannot import
// TypeScript. So this file RUNS all three over one fixture table and requires
// one answer from each (D-4940) — the same shape `pool-name-parity.test.ts`
// uses for the pools directory name, and for the same reason: a drift in one
// of three spellings is a reader that disagrees with the thing it exists to
// agree with.
//
// IT USED TO PIN LITERALS, AND THAT WAS NOT PARITY (review finding F1). The
// earlier version asserted that both bash files CONTAINED `"type":"continued-in"`
// and `continuedInSessionId` — and passed while ccd followed a marker-shaped
// object nested in a tool call's input that the server refused, because no
// reader was ever run on any input. A table of transcripts, read by all three,
// is the only statement of "they agree" that a reader can fail.
//
// The doctor check is DELIBERATELY its own reader, not a call into
// `_continued_in_of` — `ccd/ccrc-doctor-checks` is sourced by `ccrc`, which
// does not source `ccd`, so `_continued_in_of` is not a name that file can
// reach (task-8-brief.md's own constraint). Both bash readers run ONE jq
// program, spelled in each file and held byte-equal here.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, readdirSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONTINUATION_TAIL_BYTES, continuationInTail } from '../src/transcript/parse.js';
import { localIO } from '../src/io.js';
// `CCD` is the ONE spelling of the path to ccd/ccd (single-definition.test.ts's
// "one path to the ccd script" scan pins ccdWsHelpers.ts as its sole holder,
// and that scan matches on sight — even inside a comment naming the literal
// it hunts for, which is why this note uses no quotes around the path at
// all) — imported rather than re-derived here with a second copy of it.
import { CCD, makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ccrcRoot = path.resolve(here, '..', '..');
const DOCTOR = path.join(ccrcRoot, 'ccd', 'ccrc-doctor-checks');

const ccd = readFileSync(CCD, 'utf8');
const doctor = readFileSync(DOCTOR, 'utf8');
const BASH = spawnSync('bash', ['-c', 'command -v bash'], { encoding: 'utf8' }).stdout.trim();

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

  it('the two bash readers run the same jq program, byte for byte (D-4940)', () => {
    // One rule, two spellings, because neither file may source the other. The
    // fixture table below proves the RULE agrees; this proves the TEXT does,
    // so a fix landed in one file and forgotten in the other is red even for
    // an input the table does not happen to cover.
    const prog = (src: string): string | undefined => /^CONTINUED_IN_JQ='([^']*)'$/m.exec(src)?.[1];
    expect(prog(ccd), 'ccd/ccd carries CONTINUED_IN_JQ').toBeDefined();
    expect(prog(doctor), 'ccd/ccrc-doctor-checks carries CONTINUED_IN_JQ').toBeDefined();
    expect(prog(doctor)).toBe(prog(ccd));
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

// ── THE RULE, RUN BY ALL THREE READERS (D-4940) ─────────────────────────────
// Within the last CONTINUATION_TAIL_BYTES of the file, lines are read
// NEWEST FIRST and the first DECISIVE one answers:
//   - a line carrying the compact literal `"type":"continued-in"` that parses
//     as a JSON object whose OWN top-level `type` is "continued-in" and whose
//     `continuedInSessionId` is a string: the marker. It names a successor
//     only when its `sessionId` is absent or this file's own uuid and its
//     successor is a lowercase 36-character uuid that is not this file's;
//     otherwise it answers "no successor" and the scan stops;
//   - a line carrying `"type":"user"` or `"type":"assistant"` that parses as an
//     object whose OWN top-level `type` is one of those: a conversational
//     record, so the file was written to after any older marker — "no
//     successor", and the scan stops;
//   - anything else is skipped: metadata Claude Code re-stamps after the
//     marker (last-prompt, ai-title, custom-title, tag, permission-mode,
//     summary, …), a line that does not parse (a half-written one, or the
//     window's cut first line), a line that is not an object.
// Claude Code 2.1.296's own reader scans backwards with the same two literal
// prefilters; where its rule and this one differ, the row says so.

const A = 'a'.repeat(36), B = 'b'.repeat(36), C = 'c'.repeat(36);
const TS = '2026-10-01T00:00:00.000Z';
const j = (o: unknown): string => `${JSON.stringify(o)}\n`;
/** Claude Code's own marker record, field for field (`pns` in 2.1.296). */
const marker = (from: string = A, to: string = B): string =>
  j({ type: 'continued-in', timestamp: TS, sessionId: from, continuedInSessionId: to });
const user = (text: string): string =>
  j({ parentUuid: null, isSidechain: false, type: 'user', message: { role: 'user', content: text }, uuid: 'u-1', timestamp: TS, sessionId: A });
const assistant = (text: string, stop: string | null = 'end_turn'): string =>
  j({ parentUuid: 'u-1', message: { id: 'msg_1', type: 'message', role: 'assistant', content: [{ type: 'text', text }], stop_reason: stop }, type: 'assistant', uuid: 'a-1', timestamp: TS, sessionId: A });
const meta = (type: string, extra: Record<string, unknown> = {}): string => j({ type, ...extra, sessionId: A });

interface Row { name: string; body: string; want: string | null }

const ROWS: Row[] = [
  { name: 'a marker as the last line', body: user('one') + marker(), want: B },
  { name: 'a marker followed by the metadata Claude Code re-stamps at exit (last-prompt, ai-title)',
    body: user('one') + marker() + meta('last-prompt', { lastPrompt: 'go on' }) + meta('ai-title', { aiTitle: 'a title' }),
    want: B },
  { name: 'a marker followed by custom-title, tag, permission-mode, summary, queue-operation, attachment and system records',
    body: user('one') + marker() + meta('custom-title', { customTitle: 't' }) + meta('tag', { tag: 'x' })
      + meta('permission-mode', { permissionMode: 'default' }) + j({ type: 'summary', summary: 's', leafUuid: 'a-1' })
      + meta('queue-operation', { operation: 'enqueue' }) + meta('attachment', { attachment: { type: 'x' } })
      + meta('system', { subtype: 'informational', content: 'note' }),
    want: B },
  { name: 'a user turn after the marker', body: marker() + user('back again'), want: null },
  { name: 'an assistant turn after the marker', body: marker() + assistant('still here'), want: null },
  { name: 'an assistant record with no stop_reason yet after the marker (Claude Code skips it; this rule stops — fail-closed)',
    body: marker() + assistant('streaming', null), want: null },
  { name: 'a tool call whose input is a marker-shaped object (message first, sessionId late, as Claude Code orders it)',
    body: user('one') + j({
      parentUuid: 'u-1',
      message: { id: 'msg_2', type: 'message', role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name: 'mcp__x__y',
        input: { type: 'continued-in', continuedInSessionId: B } }], stop_reason: 'tool_use' },
      type: 'assistant', uuid: 'a-2', timestamp: TS, sessionId: A,
    }),
    want: null },
  { name: 'a tool result whose toolUseResult object carries the marker keys',
    body: user('one') + j({
      parentUuid: 'a-2', type: 'user',
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'ok' }] },
      toolUseResult: { type: 'continued-in', sessionId: A, continuedInSessionId: B }, uuid: 'u-2', timestamp: TS, sessionId: A,
    }),
    want: null },
  { name: 'a marker-shaped object nested in a SKIPPED record type, above a user turn',
    body: user('one') + meta('attachment', { attachment: { type: 'continued-in', sessionId: A, continuedInSessionId: B } }),
    want: null },
  { name: 'duplicate continuedInSessionId keys: the LAST counts, as JSON.parse and jq both read an object',
    body: user('one') + `{"type":"continued-in","sessionId":"${A}","continuedInSessionId":"${B}","continuedInSessionId":"${C}"}\n`,
    want: C },
  { name: 'duplicate type keys, the last naming a user record',
    body: user('one') + `{"type":"continued-in","sessionId":"${A}","continuedInSessionId":"${B}","type":"user"}\n`,
    want: null },
  { name: 'CRLF line endings', body: (user('one') + marker()).replace(/\n/g, '\r\n'), want: B },
  { name: 'a marker that has scrolled out of the tail window behind metadata',
    body: user('one') + marker()
      + Array.from({ length: Math.ceil((CONTINUATION_TAIL_BYTES + 512) / 100) },
        (_, i) => meta('last-prompt', { lastPrompt: `p${i}`.padEnd(60, '.') })).join(''),
    want: null },
  { name: 'a last line longer than the window, whose tail is a marker record (the window cuts it)',
    body: user('one') + j({ pad: 'x'.repeat(CONTINUATION_TAIL_BYTES * 2), type: 'continued-in', sessionId: A, continuedInSessionId: B }),
    want: null },
  { name: 'a half-written metadata line after a marker', body: user('one') + marker() + '{"type":"last-prompt","lastPr', want: B },
  { name: 'a half-written marker after a user turn', body: user('one') + marker().slice(0, 40), want: null },
  { name: 'a marker another session wrote', body: user('one') + marker(C, B), want: null },
  { name: 'a marker that names no sessionId (absence permits)', body: user('one') + j({ type: 'continued-in', continuedInSessionId: B }), want: B },
  { name: 'a marker whose sessionId is present but malformed', body: user('one') + marker('not-a-uuid', B), want: null },
  { name: 'a marker whose sessionId is present but null', body: user('one') + j({ type: 'continued-in', sessionId: null, continuedInSessionId: B }), want: null },
  { name: 'a marker naming its own file', body: user('one') + marker(A, A), want: null },
  { name: 'a successor that is not a uuid', body: user('one') + marker(A, 'nope'), want: null },
  { name: 'a successor one character short of a uuid', body: user('one') + marker(A, B.slice(1)), want: null },
  { name: 'a successor carrying a trailing newline escape', body: user('one') + marker(A, `${B}\n`), want: null },
  { name: 'an uppercase successor (Claude Code writes lowercase; this rule refuses the rest)', body: user('one') + marker(A, B.toUpperCase()), want: null },
  { name: 'a marker spelled with spaces after its colons (Claude Code\'s own literal prefilter skips it)',
    body: user('one') + `{"type": "continued-in", "sessionId": "${A}", "continuedInSessionId": "${B}"}\n`, want: null },
  { name: 'a marker whose type key is spelled with a unicode escape (the prefilter skips it)',
    body: user('one') + `{"\\u0074ype":"continued-in","sessionId":"${A}","continuedInSessionId":"${B}"}\n`, want: null },
  { name: 'a user record spelled with spaces after a marker (the prefilter skips it)',
    body: marker() + `{"type": "user", "message": {"role": "user", "content": "x"}}\n`, want: B },
  { name: 'a continued-in record with a non-string successor is skipped, as Claude Code\'s schema skips it',
    body: user('one') + marker() + j({ type: 'continued-in', sessionId: A, continuedInSessionId: 123 }), want: B },
  { name: 'non-object JSON lines after a marker are skipped', body: marker() + j([{ type: 'user' }]) + j([{ type: 'assistant' }]), want: B },
  { name: 'blank lines after a marker', body: marker() + '\n   \n\n', want: B },
  { name: 'an empty file', body: '', want: null },
];

describe('continued-in parity: one rule, run by all three readers (D-4940)', () => {
  let h: CcdHarness;
  const files: string[] = [];
  let ccdAnswers: string[] = [];
  let doctorAnswers: { rc: string; next: string }[] = [];

  beforeAll(() => {
    h = makeCcdHarness('ci-parity');
    ROWS.forEach((r, i) => {
      const d = path.join(h.home, 'fx', String(i));
      mkdirSync(d, { recursive: true });
      const f = path.join(d, `${A}.jsonl`);
      writeFileSync(f, r.body, 'utf8');
      files.push(f);
    });
    // ONE process per bash reader, the whole table in a loop: sourcing either
    // file costs far more than a read, and the answers are printed one record
    // per row with a sentinel so an empty answer is still a row.
    const list = files.map((f) => `'${f}'`).join(' ');
    ccdAnswers = h.sh(`for f in ${list}; do printf '[%s]\\n' "$(_continued_in_of "$f" ${A})"; done`)
      .split('\n').map((l) => l.replace(/^\[(.*)\]$/, '$1'));
    const r = spawnSync(BASH, ['-c',
      '. "$1"; shift; u="$1"; shift; for f in "$@"; do _dr_continued_in "$f" "$u"; printf "%s|%s\\n" "$?" "${_DR_CI_NEXT-}"; done',
      '_', DOCTOR, A, ...files], { encoding: 'utf8', env: { ...process.env, HOME: h.home } });
    doctorAnswers = r.stdout.split('\n').filter((l) => l !== '').map((l) => {
      const [rc = '', next = ''] = l.split('|');
      return { rc, next };
    });
  });
  afterAll(() => { h.cleanup(); });

  ROWS.forEach((r, i) => {
    it(`${r.name} -> ${r.want === null ? 'no successor' : 'a successor'}`, async () => {
      const f = files[i]!;
      // The server's reader is handed exactly the window `continuationAt`
      // (resolve.ts) reads: the file's last CONTINUATION_TAIL_BYTES, decoded
      // as `localIO.readFileFrom` decodes them.
      const size = statSync(f).size;
      const tail = (await localIO.readFileFrom(f, Math.max(0, size - CONTINUATION_TAIL_BYTES)))?.data ?? '';
      const server = continuationInTail(tail, A);
      const fromCcd = ccdAnswers[i] === '' ? null : ccdAnswers[i];
      const dr = doctorAnswers[i];
      const fromDoctor = dr === undefined ? 'unanswered' : dr.rc === '0' ? dr.next : dr.rc === '1' ? null : `rc ${dr.rc}`;
      expect({ server, ccd: fromCcd, doctor: fromDoctor }).toEqual({ server: r.want, ccd: r.want, doctor: r.want });
    });
  });
});
