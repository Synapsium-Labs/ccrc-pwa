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
// The caps are CHARACTER caps and the report is in BYTES (D-285 (was D-B4-12)), because a
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

describe('the harness resume pair is system, not a conversation (D-2228)', () => {
  const metaPrompt = JSON.stringify({
    parentUuid: 'p', isSidechain: false, type: 'user',
    message: { role: 'user', content: [{ type: 'text', text: 'Continue from where you left off. Note: ccd restarted this session.' }] },
    isMeta: true, uuid: 'm1', timestamp: '2026-09-09T11:25:31.906Z',
  });
  const synthetic = JSON.stringify({
    parentUuid: 'm1', isSidechain: false, type: 'assistant', uuid: 'a1', timestamp: '2026-09-09T11:25:31.906Z',
    message: { model: '<synthetic>', role: 'assistant', content: [{ type: 'text', text: 'No response requested.' }] },
  });
  it('the META resume prompt is a system event with origin resume-prompt, text the prefix only', () => {
    expect(parseTranscriptLine(metaPrompt)).toEqual([
      { kind: 'system', uuid: 'm1', ts: '2026-09-09T11:25:31.906Z', text: 'Continue from where you left off.', origin: 'resume-prompt' },
    ]);
  });
  it('the synthetic No response requested. is a system event with origin no-response', () => {
    expect(parseTranscriptLine(synthetic)).toEqual([
      { kind: 'system', uuid: 'a1', ts: '2026-09-09T11:25:31.906Z', text: 'No response requested.', origin: 'no-response' },
    ]);
  });
  // WAS `a META user message with other content is still a user event
  // (unchanged)`. That title fenced D-2228's scope rather than ruling on this,
  // and the text it reached for to stand in for "other content" turns out to be
  // the FIRST LINE of a 17,141-byte SKILL.md body the harness injects into the
  // user channel — 5 occurrences here, beside 7 more at 92,395-92,401 bytes. So
  // the assertion in force was that an injected reference document is the
  // operator's speech. It is not, and `isMeta` is what says so: 99 of 99
  // non-sidechain user records carrying the flag are harness-written, 0 human.
  it('a META user message with other content is the HARNESS, not the operator', () => {
    const other = metaPrompt.replace('Continue from where you left off. Note: ccd restarted this session.', '# Workflow authoring reference');
    expect(parseTranscriptLine(other)).toEqual([
      { kind: 'system', uuid: 'm1', ts: '2026-09-09T11:25:31.906Z', text: '# Workflow authoring reference' },
    ]);
  });
  it('a real model saying the same words is still an assistant event (unchanged)', () => {
    const real = synthetic.replace('"model":"<synthetic>"', '"model":"claude-fable-5-1"');
    expect(parseTranscriptLine(real).map((e) => e.kind)).toEqual(['assistant']);
  });
  it('a human typing the sentence is a user event — isMeta decides, not the words', () => {
    const human = metaPrompt.replace('"isMeta":true', '"isMeta":false');
    expect(parseTranscriptLine(human).map((e) => e.kind)).toEqual(['user']);
  });
});

describe('the limit banner is a system event, not the model speaking (D-2365)', () => {
  const banner = (over: Record<string, unknown> = {}) => JSON.stringify({
    parentUuid: 'p', isSidechain: false, type: 'assistant', uuid: 'b1', timestamp: '2026-09-10T10:12:21.199Z',
    message: { model: '<synthetic>', role: 'assistant', content: [{ type: 'text', text: "You've hit your weekly limit · resets Sep 15, 12am (UTC)" }] },
    isApiErrorMessage: true, error: 'rate_limit', apiErrorStatus: 429,
    quotaLimits: { status: 'rejected', resetsAt: 1789430400, rateLimitType: 'seven_day' },
    ...over,
  });
  it('origin limit, the sentence as text, resetsAt in epoch seconds exactly as written', () => {
    expect(parseTranscriptLine(banner())).toEqual([
      { kind: 'system', uuid: 'b1', ts: '2026-09-10T10:12:21.199Z', text: "You've hit your weekly limit · resets Sep 15, 12am (UTC)", origin: 'limit', resetsAt: 1789430400 },
    ]);
  });
  it('no quotaLimits: origin limit with no resetsAt key at all (absence-permits)', () => {
    const [e] = parseTranscriptLine(banner({ quotaLimits: undefined }));
    expect(e).toMatchObject({ kind: 'system', origin: 'limit' });
    expect(e).not.toHaveProperty('resetsAt');
  });
  it('a resetsAt that is not a number is dropped, not coerced', () => {
    const [e] = parseTranscriptLine(banner({ quotaLimits: { resetsAt: '1789430400' } }));
    expect(e).not.toHaveProperty('resetsAt');
  });
  it('an API error that is not a rate limit stays an assistant event', () => {
    expect(parseTranscriptLine(banner({ error: 'overloaded' })).map((e) => e.kind)).toEqual(['assistant']);
  });
  it('the sentence on an ordinary assistant row stays an assistant event — the field decides', () => {
    expect(parseTranscriptLine(banner({ isApiErrorMessage: undefined, error: undefined })).map((e) => e.kind)).toEqual(['assistant']);
  });
  it('a rate_limit error with no isApiErrorMessage flag stays an assistant event — both fields decide', () => {
    expect(parseTranscriptLine(banner({ isApiErrorMessage: undefined })).map((e) => e.kind)).toEqual(['assistant']);
  });
});

// — the harness stops wearing the operator's face —
//
// Measured 2026-09-11 over this box's 18 session transcripts under
// `~/.claude/projects` (1892 `type:"user"`, `isSidechain!==true` records whose
// `message.content` is a string or an array; the other 310 `.jsonl` files there
// are subagent sidechains, every record `isSidechain:true`, dropped at
// `parse.ts:68` and never rendered).
//
//   family                             n     bytes   renders today   isMeta
//   injected SKILL body (array)       13   746,871   USER BUBBLE     yes
//   <task-notification>               12   166,976   USER BUBBLE     no
//   <local-command-stdout>            64    10,440   USER BUBBLE     no
//   [Image: original NxN …] note      14     1,490   USER BUBBLE     yes
//   command envelope, MESSAGE-first    7     1,380   USER BUBBLE     no
//   command envelope, MESSAGE-first    5       675   USER BUBBLE     yes
//   -------------------------------------------------------------------
//   leaking                          115   927,832
//   genuine human turns              129   169,217   (6 of them /compact
//                                                     recaps the PWA folds;
//                                                     largest TYPED is 4,034 B)
//
// TWO signals, because neither alone closes it. `isMeta` is Claude Code's own
// marker and is decisive where it appears — 99 of 99 non-sidechain user records
// carrying it are harness-written, ZERO are human — but 83 of the 115 leaks do
// not carry it. Those are ENVELOPES, and the envelope read is anchored to the
// WHOLE record: a record that is nothing but `<tag>…</tag>` blocks, one of them
// named. Measured: no human turn in the corpus so much as BEGINS with `<`, and
// the one human record that quotes `<command-name>` at itself — a 26,861-byte
// /compact recap — carries prose outside the blocks and stays a user turn.
describe('a harness-written user record is not the operator speaking', () => {
  const TS = '2026-09-11T09:14:02.113Z';
  const rec = (content: unknown, over: Record<string, unknown> = {}): string => JSON.stringify({
    parentUuid: 'p', isSidechain: false, type: 'user', uuid: 'h1', timestamp: TS,
    message: { role: 'user', content }, ...over,
  });
  const kinds = (line: string): string[] => parseTranscriptLine(line).map((e) => e.kind);
  const sys = (line: string): Extract<ChatEvent, { kind: 'system' }> => {
    const [e] = parseTranscriptLine(line);
    expect(e?.kind).toBe('system');
    return e as Extract<ChatEvent, { kind: 'system' }>;
  };

  // — isMeta: the flag the harness writes and nobody else does —

  it('an injected SKILL body is a system row carrying its text verbatim, byte for byte', () => {
    // The largest single record in the corpus is 92,401 bytes and this shape
    // recurs 7 times. It RE-ATTRIBUTES, it never drops: `isMeta` belongs to a
    // harness this tree does not version, so a record it ever mis-stamps still
    // renders IN FULL under the wrong label, which a reader can see through.
    const body = `Base directory for this skill: /home/x/.claude/skills/review-pr\n\n# Review PR\n${'x'.repeat(4000)}`;
    expect(parseTranscriptLine(rec([{ type: 'text', text: body }], { isMeta: true }))).toEqual([
      { kind: 'system', uuid: 'h1', ts: TS, text: body },
    ]);
  });

  it('an image-scaling note is a system row — STRING content, which an array-only rule would miss', () => {
    const note = '[Image: original 3122x1532, displayed at 2000x981. Multiply coordinates by 1.56 to map to original image.]';
    expect(parseTranscriptLine(rec(note, { isMeta: true }))).toEqual([
      { kind: 'system', uuid: 'h1', ts: TS, text: note },
    ]);
  });

  it('an isMeta record carrying a tool_result still emits its tool_result — the arm relabels per BLOCK', () => {
    // The relabel lives inside the array loop, beside the push it replaces, so
    // it cannot swallow a block it does not understand. A guard hoisted above
    // that loop and fed through `flattenContent` would: that helper reads
    // `b.text`, and a tool_result block carries `.content`.
    const line = rec([
      { type: 'tool_result', tool_use_id: 'toolu_9', content: 'exit 0\nok' },
      { type: 'text', text: 'and a note' },
    ], { isMeta: true });
    expect(kinds(line)).toEqual(['tool_result', 'system']);
    expect(parseTranscriptLine(line)[0]).toMatchObject({ kind: 'tool_result', toolId: 'toolu_9', text: 'exit 0\nok' });
  });

  it('only the literal true relabels — a truthy flag is not the harness flag', () => {
    for (const over of [{}, { isMeta: false }, { isMeta: 'true' }, { isMeta: 1 }]) {
      expect(kinds(rec('ship it', over)), JSON.stringify(over)).toEqual(['user']);
      expect(kinds(rec([{ type: 'text', text: 'ship it' }], over)), JSON.stringify(over)).toEqual(['user']);
    }
  });

  it('NOTHING without the flag becomes a system row, however much it reads like an injection', () => {
    for (const body of [
      '# Workflow authoring reference',
      'Base directory for this skill: /home/x/.claude/skills/review-pr',
      '[Image: original 2044x1636, displayed at 1092x874]',
      'Continue from where you left off.',
    ]) {
      expect(kinds(rec(body)), body).toEqual(['user']);
      expect(kinds(rec([{ type: 'text', text: body }])), body).toEqual(['user']);
    }
  });

  // — the command envelope: same record, two tag orders —

  const NAME_FIRST = '<command-name>/effort</command-name>\n<command-message>effort</command-message>\n<command-args>ultracode</command-args>';
  const MSG_FIRST = '<command-message>review-pr</command-message>\n<command-name>/review-pr</command-name>\n<command-args>https://example.test/pr/1</command-args>';
  const MSG_FIRST_META = '<command-message>workflow-authoring</command-message>\n<command-name>workflow-authoring</command-name>\n<skill-format>true</skill-format>';

  it('reads a MESSAGE-first envelope as the same row as a NAME-first one — 12 of 76 are that order', () => {
    expect(parseTranscriptLine(rec(MSG_FIRST))).toEqual([{ kind: 'system', uuid: 'h1', ts: TS, text: '/review-pr' }]);
    expect(parseTranscriptLine(rec(NAME_FIRST))).toEqual([{ kind: 'system', uuid: 'h1', ts: TS, text: '/effort' }]);
  });

  it('and reads the isMeta half of that pair the same way — the envelope is read BEFORE the flag', () => {
    // 5 of the 12 MESSAGE-first records carry `isMeta`. Reading the flag first
    // would render the same operator action two ways: 64 siblings as a clean
    // `/name` pill and these 5 as a fold of raw XML.
    expect(parseTranscriptLine(rec(MSG_FIRST_META, { isMeta: true })))
      .toEqual([{ kind: 'system', uuid: 'h1', ts: TS, text: 'workflow-authoring' }]);
  });

  it('a human who QUOTES an envelope keeps every word — prose outside the blocks is the tell', () => {
    // The one human record in the corpus that contains `<command-name>` is a
    // 26,861-byte /compact recap quoting the whole exchange. It must stay a
    // user turn, and `startsWith` could not have told it from the real thing.
    const quoting = '<command-name>/clear</command-name>\nwhat does this render as? I never typed it';
    expect(parseTranscriptLine(rec(quoting))).toEqual([{ kind: 'user', uuid: 'h1', ts: TS, text: quoting }]);
  });

  it('a human pasting markup keeps every word — the MEMBER NAME decides, not the shape', () => {
    // A purely structural "entirely tag blocks" rule has zero false positives
    // on this corpus and still silences every one of these, because no human
    // turn measured here so much as begins with `<`. The corpus never exercised
    // the predicate; the named member is what makes it safe, not the corpus.
    for (const paste of [
      '<p>one</p>\n<p>two</p>',
      '<div>the thing I want changed</div>',
      '<details><summary>the failing run</summary>stack trace</details>',
      '<config>\n  <name>prod</name>\n  <port>8080</port>\n</config>',
      '<svg><circle></circle></svg>',
    ]) {
      expect(kinds(rec(paste)), paste).toEqual(['user']);
      expect(parseTranscriptLine(rec(paste))[0], paste).toMatchObject({ text: paste });
    }
  });

  it('an envelope whose command-name is empty keeps the raw record — nothing vanishes', () => {
    const empty = '<command-name></command-name>\n<command-message>x</command-message>';
    expect(parseTranscriptLine(rec(empty))).toEqual([{ kind: 'system', uuid: 'h1', ts: TS, text: empty }]);
  });

  // — a slash command's own stdout: the ANSWER to the row above it —

  const EFFORT = 'Set effort level to ultracode (this session only): xhigh + dynamic workflow orchestration';

  it('renders a command\'s stdout as a system row rather than as the operator', () => {
    expect(parseTranscriptLine(rec(`<local-command-stdout>${EFFORT}</local-command-stdout>`)))
      .toEqual([{ kind: 'system', uuid: 'h1', ts: TS, text: EFFORT }]);
  });

  it('strips the ANSI it arrives wrapped in, and keeps the line structure', () => {
    // Verbatim: 6 of the 64 stdout records are `/compact`'s hook chatter wrapped
    // in dim/reset runs. Measured across all 64, the ONLY control codepoints
    // present are ESC (x36, every one of them `\e[2m` or `\e[22m`) and LF (x12)
    // — no cursor moves, no erase, no OSC, no CR — which is why SGR is stripped
    // and nothing else is.
    const raw = '<local-command-stdout>\x1b[2mCompacted (ctrl+o to see full summary)\x1b[22m\n'
      + '\x1b[2mPreCompact [bash "$HOME/.cc-sessions/session-hook.sh"] completed successfully\x1b[22m</local-command-stdout>';
    expect(sys(rec(raw)).text).toBe(
      'Compacted (ctrl+o to see full summary)\n'
      + 'PreCompact [bash "$HOME/.cc-sessions/session-hook.sh"] completed successfully',
    );
    expect(sys(rec(raw)).text).not.toContain('\x1b');
  });

  it('a human who leads with the stdout tag and then types keeps the whole message', () => {
    // The likeliest shape this tag will ever take in a human turn: pasting the
    // offending row to ask about it. The read is anchored to the whole record
    // (`^…$`), so anything after the closing tag disqualifies it — measured,
    // all 64 real records are the envelope whole and entire.
    const paste = `<local-command-stdout>${EFFORT}</local-command-stdout>\n\nwhy does this render as me? I never typed it.`;
    expect(parseTranscriptLine(rec(paste))).toEqual([{ kind: 'user', uuid: 'h1', ts: TS, text: paste }]);
  });

  it('an unterminated stdout tag is a user turn, not a pill — it is a human mid-paste', () => {
    expect(kinds(rec('<local-command-stdout>half a li'))).toEqual(['user']);
  });

  it('stdout that printed nothing still emits a row — a record never disappears', () => {
    expect(parseTranscriptLine(rec('<local-command-stdout></local-command-stdout>')))
      .toEqual([{ kind: 'system', uuid: 'h1', ts: TS, text: '' }]);
  });

  // — the harness reporting a background task it finished —

  const NOTIF = '<task-notification>\n<task-id>w0s3mcrji</task-id>\n'
    + '<tool-use-id>toolu_01Qj6Dyd</tool-use-id>\n<status>completed</status>\n'
    + '<summary>Dynamic workflow "resolve the six design forks" completed</summary>\n'
    + '<result>{"verdict":"shippable"}</result>\n</task-notification>';

  it('a task notification is a system row carrying the record VERBATIM', () => {
    // The parser says WHAT the record is. What it SAYS is read by
    // `parseTaskNotification` in `shared/` and rendered by the delivery layer,
    // the same three-part split mail already has — so no reformatting happens
    // here, and a reader that cannot render the card still gets every byte.
    expect(parseTranscriptLine(rec(NOTIF))).toEqual([{ kind: 'system', uuid: 'h1', ts: TS, text: NOTIF }]);
  });

  it('reads it WITHOUT the harness flag — 12 of 13 carry no isMeta at all', () => {
    // The envelope is the whole signal here. `isMeta` would have caught one of
    // the thirteen, which is why the member name is what decides.
    expect(kinds(rec(NOTIF))).toEqual(['system']);
    expect(kinds(rec(NOTIF, { isMeta: true }))).toEqual(['system']);
  });

  it('a human who quotes one keeps every word — prose outside the block is the tell', () => {
    const asking = NOTIF + '\n\nwhy is this whole wall attributed to me?';
    expect(parseTranscriptLine(rec(asking))).toEqual([{ kind: 'user', uuid: 'h1', ts: TS, text: asking }]);
  });

  it('an unterminated notification is a user turn — a human mid-paste is not a record', () => {
    expect(kinds(rec('<task-notification>\n<task-id>w0s3</task-id>'))).toEqual(['user']);
  });

  // — and the families that already read correctly, unchanged —

  it('the caveat is still DROPPED, not relabelled', () => {
    // All 64 in the corpus carry `isMeta`, but the fixture's own caveat row
    // (`transcript-sample.jsonl` line 4) does NOT, so this check is load-bearing
    // and stays ahead of both new reads.
    expect(parseTranscriptLine(rec('<local-command-caveat>Caveat: …</local-command-caveat>'))).toEqual([]);
    expect(parseTranscriptLine(rec('<local-command-caveat>Caveat: …</local-command-caveat>', { isMeta: true }))).toEqual([]);
  });

  it('an empty record still produces nothing', () => {
    expect(parseTranscriptLine(rec('   ', { isMeta: true }))).toEqual([]);
    expect(parseTranscriptLine(rec([{ type: 'text', text: '  ' }], { isMeta: true }))).toEqual([]);
  });
});
