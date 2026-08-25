import { describe, it, expect } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { localIO } from '../src/io.js';
import { resolveTranscript, transcriptPath, type TranscriptResolution } from '../src/transcript/resolve.js';
import { parseTranscriptLine } from '../src/transcript/parse.js';
import type { ChatEvent } from '../../shared/api.js';

const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'transcript-sample.jsonl');

describe('transcriptPath', () => {
  it('munges the project dir and appends <uuid>.jsonl', () => {
    expect(transcriptPath('/h/.claude', '/data/projects/foo.bar', 'u'.repeat(36))).toBe(
      `/h/.claude/projects/-data-projects-foo-bar/${'u'.repeat(36)}.jsonl`,
    );
  });
});

/**
 * The symlink-munge mismatch, fixed where it bit: Claude Code munges its
 * PHYSICAL cwd (`process.cwd()` resolves symlinks), while the registry keeps
 * the path ccd wrote — on the production box `~/projects -> /data/projects ->
 * /mnt/...`, so a dead session's transcript lived under the `-mnt-…` munge
 * while the chat looked under `-data-…` and rendered "Can't find this
 * session's transcript" over a file that existed the whole time. (Live
 * sessions were saved by the live cwd, which is already physical — which is
 * exactly why only dead sessions showed the banner.)
 */
describe('resolveTranscript — the symlink-munge mismatch it was born fixing', () => {
  /** A miniature of the production chain: `<root>/data -> <root>/volume`,
   *  registry workdir through the link, transcript under the physical munge. */
  const build = (): { root: string; cfg: string; linkDir: string; realDir: string } => {
// RESOLVED — see tmpHelpers' mkTmp: on macOS the temp root lives under a
// symlink (/var -> /private/var), and ccd resolves paths deliberately, so an
// unresolved fixture path compares two spellings of one directory.
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'ccrc-resolve-')));
    const realDir = path.join(root, 'volume', 'projects', 'demo');
    mkdirSync(realDir, { recursive: true });
    symlinkSync(path.join(root, 'volume'), path.join(root, 'data'));
    return { root, cfg: path.join(root, '.claude'), linkDir: path.join(root, 'data', 'projects', 'demo'), realDir };
  };
  const plant = (file: string): void => {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, '{}\n');
  };
  /** The pre-ladder call shape: one directory doubling as the registry workdir,
   *  no foreign accounts — so these five cases still say exactly what they said
   *  before the ladder existed. */
  const at = (cfg: string, dir: string, uuid: string): Promise<TranscriptResolution> =>
    resolveTranscript(localIO, { configDir: cfg, dir, registryWorkdir: dir, uuid });

  it('finds the transcript behind a symlinked workdir — the munge Claude actually wrote', async () => {
    const { root, cfg, linkDir, realDir } = build();
    try {
      const real = transcriptPath(cfg, realDir, 'u-1');
      plant(real);
      expect(await at(cfg, linkDir, 'u-1')).toEqual(
        { kind: 'found', path: real, rung: 'live-resolved', account: null });
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('prefers the raw munge whenever the transcript actually lives there', async () => {
    const { root, cfg, linkDir } = build();
    try {
      const raw = transcriptPath(cfg, linkDir, 'u-1');
      plant(raw);
      expect((await at(cfg, linkDir, 'u-1')).path).toBe(raw);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('resolves through the longest existing prefix when the leaf directory is gone', async () => {
    // A reaped worktree behind a symlink: the workdir itself no longer exists,
    // but its parent does and resolves — the transcript is still findable.
    const { root, cfg } = build();
    try {
      const real = transcriptPath(cfg, path.join(root, 'volume', 'projects', 'gone'), 'u-1');
      plant(real);
      expect((await at(cfg, path.join(root, 'data', 'projects', 'gone'), 'u-1')).path).toBe(real);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('leaves a workdir with no symlink anywhere in it exactly alone', async () => {
    const raw = transcriptPath('/h/.claude', '/nonexistent-ccrc/projects/x', 'u-1');
    expect(await at('/h/.claude', '/nonexistent-ccrc/projects/x', 'u-1')).toEqual(
      { kind: 'fallback', path: raw, complete: false });
  });

  it('keeps the raw path when neither candidate exists — no behavior change for a truly missing transcript', async () => {
    const { root, cfg, linkDir } = build();
    try {
      expect((await at(cfg, linkDir, 'u-1')).path).toBe(transcriptPath(cfg, linkDir, 'u-1'));
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});

describe('parseTranscriptLine', () => {
  const lines = readFileSync(fixture, 'utf8').split('\n').filter(Boolean);
  const events = lines.flatMap((l) => parseTranscriptLine(l));

  it('parses the fixture into 5 events, kinds in order', () => {
    expect(events).toHaveLength(5);
    expect(events.map((e) => e.kind)).toEqual(['user', 'system', 'assistant', 'tool_use', 'tool_result']);
  });

  it('sidechain and caveat lines produce []', () => {
    const sidechain = lines.find((l) => l.includes('"isSidechain":true'))!;
    expect(parseTranscriptLine(sidechain)).toEqual([]);
    const caveat = lines.find((l) => l.includes('local-command-caveat'))!;
    expect(parseTranscriptLine(caveat)).toEqual([]);
  });

  it('command-name content becomes a system event with the command text', () => {
    const sys = events.find((e): e is Extract<ChatEvent, { kind: 'system' }> => e.kind === 'system')!;
    expect(sys.text).toContain('/clear');
    expect(sys.uuid).toBe('u3');
  });

  it('assistant text joined without thinking blocks', () => {
    const asst = events.find((e): e is Extract<ChatEvent, { kind: 'assistant' }> => e.kind === 'assistant')!;
    expect(asst.text).toBe("I'll use the brainstorming skill first.");
    expect(asst.text).not.toContain('secret');
  });

  it('tool_use carries name and stringified input', () => {
    const use = events.find((e): e is Extract<ChatEvent, { kind: 'tool_use' }> => e.kind === 'tool_use')!;
    expect(use.name).toBe('Bash');
    expect(use.toolId).toBe('toolu_01');
    expect(use.input).toBe(JSON.stringify({ command: 'ls /' }));
  });

  it('tool_result carries toolId and flattened text', () => {
    const res = events.find((e): e is Extract<ChatEvent, { kind: 'tool_result' }> => e.kind === 'tool_result')!;
    expect(res.toolId).toBe('toolu_01');
    expect(res.text).toContain('bin');
    expect(res.isError).toBe(false);
  });

  it('malformed lines never throw, they return []', () => {
    expect(parseTranscriptLine('not json at all')).toEqual([]);
    expect(parseTranscriptLine('{"type":"user"}')).toEqual([]);
    expect(parseTranscriptLine('null')).toEqual([]);
  });
});

// — Build 4 Task 16: a cut result says it was cut —
//
// `TOOL_RESULT_MAX`/`TOOL_INPUT_MAX` have always cut silently, and the PWA has
// always rendered the fragment as if it were the whole thing. `truncatedBytes`
// has THREE documented states and the third is the one that matters: absent =
// *this server did not report*, `0` = not truncated, `>0` = this many bytes
// were cut. An old server can only ever produce "absent", which renders no cue
// — never a false claim of completeness.
//
// The caps are CHARACTER caps and the report is in BYTES (D-B4-12), because a
// byte count is what an operator can compare against a file on disk. These
// tests pin that difference directly: a multi-byte tail must report MORE bytes
// than characters cut, which is the assertion a `s.length - max` mutant fails.
describe('truncatedBytes', () => {
  const resultLine = (text: string): string => JSON.stringify({
    type: 'user', uuid: 'u1', timestamp: '2026-08-13T10:00:00Z',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: text }] },
  });
  const useLine = (input: unknown): string => JSON.stringify({
    type: 'assistant', uuid: 'a1', timestamp: '2026-08-13T10:00:00Z',
    message: { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input }] },
  });

  const resultOf = (text: string): Extract<ChatEvent, { kind: 'tool_result' }> =>
    parseTranscriptLine(resultLine(text))[0] as Extract<ChatEvent, { kind: 'tool_result' }>;
  const useOf = (input: unknown): Extract<ChatEvent, { kind: 'tool_use' }> =>
    parseTranscriptLine(useLine(input))[0] as Extract<ChatEvent, { kind: 'tool_use' }>;

  it('reports 0 on a result under the cap', () => {
    const res = resultOf('tests: 41 passed');
    expect(res.text).toBe('tests: 41 passed');
    expect(res.truncatedBytes).toBe(0);
  });

  it('reports the BYTES cut, not the characters, on a multi-byte tail', () => {
    // 20_000 ASCII chars fill the cap exactly; the tail is 500 three-byte
    // characters, so 500 CHARACTERS were dropped and 1500 BYTES were cut. A
    // `s.length - max` implementation reports 500 and passes every other
    // assertion in this file.
    const tail = '→'.repeat(500);
    expect(Buffer.byteLength(tail, 'utf8')).toBe(1500);
    const res = resultOf('a'.repeat(20_000) + tail);
    expect(res.text.length).toBe(20_000);
    expect(res.truncatedBytes).toBe(1500);
    expect(res.truncatedBytes).not.toBe(500);
  });

  it('reports the plain byte count when the tail is ASCII', () => {
    const res = resultOf('a'.repeat(20_000 + 37));
    expect(res.truncatedBytes).toBe(37);
  });

  it('reports on tool_use input too', () => {
    // `input` is the JSON of the call, capped at TOOL_INPUT_MAX (4000).
    const small = useOf({ command: 'ls /' });
    expect(small.truncatedBytes).toBe(0);

    const big = useOf({ command: 'x'.repeat(5_000) });
    expect(big.input.length).toBe(4_000);
    expect(big.truncatedBytes).toBeGreaterThan(0);
  });

  it('never omits the field — absence can only come from an older server', () => {
    // The field is OPTIONAL on the wire so an old server's silence is
    // representable; THIS server always answers. A parser that emitted the
    // field only when it cut something would make `0` and "did not report"
    // indistinguishable, which is precisely the collapse the three states
    // exist to prevent.
    for (const ev of [resultOf(''), resultOf('short'), useOf({ a: 1 })]) {
      expect(Object.hasOwn(ev, 'truncatedBytes'), ev.kind).toBe(true);
      expect(typeof ev.truncatedBytes).toBe('number');
    }
  });

  it('reports 0 at exactly the cap — the boundary is not a cut', () => {
    const res = resultOf('a'.repeat(20_000));
    expect(res.text.length).toBe(20_000);
    expect(res.truncatedBytes).toBe(0);
  });
});
