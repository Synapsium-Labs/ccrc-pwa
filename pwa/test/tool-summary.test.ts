// The per-tool summariser and the tool-run fold (D-5475, W2 plan Task S13a).
// A pure model: its readers are Refined's grouped rows (S13b) and Instrument's
// log rows (S14); nothing here renders.
import { describe, expect, it } from 'vitest';
import type { ChatEvent } from '../../shared/api';
import { buildChatItems, type ChatItem } from '../src/session/chatItems';
import { groupToolRun, toolSummary, SUMMARY_OBJECT_MAX, type ToolGroupItem } from '../src/session/toolSummary';

type ToolItem = Extract<ChatItem, { kind: 'tool' }>;
type Use = Extract<ChatEvent, { kind: 'tool_use' }>;
type Result = Extract<ChatEvent, { kind: 'tool_result' }>;

let n = 0;
function use(name: string, input: unknown, raw?: string): Use {
  n += 1;
  return {
    kind: 'tool_use',
    uuid: `u${n}`,
    ts: '2026-10-18T10:00:00.000Z',
    toolId: `t${n}`,
    name,
    input: raw ?? JSON.stringify(input),
  };
}
function result(u: Use, isError = false): Result {
  return { kind: 'tool_result', ts: '2026-10-18T10:00:01.000Z', toolId: u.toolId, text: 'ok', isError };
}
/** A finished tool entry, as `buildChatItems` makes one. */
function done(name: string, input: unknown, isError = false): ToolItem {
  const u = use(name, input);
  return { kind: 'tool', key: u.toolId, use: u, result: result(u, isError) };
}
function sentence(item: ToolItem): string {
  return toolSummary(item).sentence;
}

describe('toolSummary', () => {
  it('each known tool reads as its sentence; an unknown tool is its own name', () => {
    expect(sentence(done('Read', { file_path: '/a/b/chat.css' }))).toBe('Read chat.css');
    expect(sentence(done('Edit', { file_path: '/a/b/chat.css', old_string: 'x', new_string: 'y' }))).toBe('Edited chat.css');
    expect(sentence(done('Write', { file_path: '/a/plan.md', content: '…' }))).toBe('Edited plan.md');
    expect(sentence(done('Bash', { command: 'npm run themes && git status', description: 'x' }))).toBe('Ran npm');
    expect(sentence(done('Grep', { pattern: 'useSkin\\(', path: '/a/src' }))).toBe('Searched for useSkin\\(');
    expect(sentence(done('Glob', { pattern: '*.tsx' }))).toBe('Searched for *.tsx');
    expect(sentence(done('Agent', { description: 'Audit the palette', prompt: 'long' }))).toBe('Delegated: Audit the palette');
    expect(sentence(done('Task', { description: 'Audit the palette', prompt: 'long' }))).toBe('Delegated: Audit the palette');
    expect(sentence(done('TodoWrite', { todos: [] }))).toBe('Updated the task list');
    expect(sentence(done('TaskCreate', { subject: 'x' }))).toBe('Updated the task list');
    // A command's leading `cd <dir> &&` (or `;`) and its VAR=value words are
    // not the command: the first word after them is (D-5475).
    expect(sentence(done('Bash', { command: 'cd /a/pwa && npm test' }))).toBe('Ran npm');
    expect(sentence(done('Bash', { command: 'cd "/a b/pwa"; git status' }))).toBe('Ran git');
    expect(sentence(done('Bash', { command: 'cd /a && cd pwa && npx vitest run' }))).toBe('Ran npx');
    expect(sentence(done('Bash', { command: 'PATH=/usr/bin:/bin npm test' }))).toBe('Ran npm');
    expect(sentence(done('Bash', { command: 'GITHUB_TOKEN=x A="b c" gh pr list' }))).toBe('Ran gh');
    // A Grep pattern is a regex and stays whole: its slash is a character.
    expect(sentence(done('Grep', { pattern: 'a/b' }))).toBe('Searched for a/b');

    const unknown = toolSummary(done('mcp__linear__get_issue', { id: 'ABC-1' }));
    expect(unknown.sentence).toBe('mcp__linear__get_issue');
    expect(unknown.verb).toBe('mcp__linear__get_issue');
    expect(unknown.object).toBe('');
    expect(sentence(done('WebFetch', { url: 'https://example.com' }))).toBe('WebFetch');

    const read = toolSummary(done('Read', { file_path: '/x/y.ts' }));
    expect(read).toMatchObject({ verb: 'Read', object: 'y.ts', failed: false, live: false });
  });

  it('a path is reduced to its file name and cut with an ellipsis', () => {
    expect(toolSummary(done('Read', { file_path: '/Users/me/projects/ccrc/pwa/src/session/chat.css' })).object).toBe('chat.css');
    expect(toolSummary(done('Edit', { file_path: 'C:\\work\\ccrc\\app.tsx' })).object).toBe('app.tsx');
    // The command's first word is a path too, sometimes.
    expect(toolSummary(done('Bash', { command: './node_modules/.bin/vitest run' })).object).toBe('vitest');
    // A glob's directories go; its name pattern stays.
    expect(toolSummary(done('Glob', { pattern: 'pwa/src/**/*.tsx' })).object).toBe('*.tsx');

    const long = 'a'.repeat(SUMMARY_OBJECT_MAX + 20) + '.ts';
    const cut = toolSummary(done('Read', { file_path: `/deep/${long}` })).object;
    expect(cut.length).toBe(SUMMARY_OBJECT_MAX);
    expect(cut.endsWith('…')).toBe(true);
    expect(long.startsWith(cut.slice(0, -1))).toBe(true);

    const desc = 'Audit every stylesheet for literal durations and report each one'.repeat(2);
    const agent = toolSummary(done('Agent', { description: desc })).object;
    expect(agent.length).toBe(SUMMARY_OBJECT_MAX);
    expect(agent.endsWith('…')).toBe(true);
    // The cut counts code points, so an astral character is never split.
    const astral = toolSummary(done('Agent', { description: '\u{1F600}'.repeat(SUMMARY_OBJECT_MAX + 5) })).object;
    expect(Array.from(astral)).toHaveLength(SUMMARY_OBJECT_MAX);
    expect(astral).toBe('\u{1F600}'.repeat(SUMMARY_OBJECT_MAX - 1) + '…');
    expect(astral).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);

    // An input cut at TOOL_INPUT_MAX upstream is not JSON; the field is still read.
    const u = use('Edit', null, '{"file_path":"/a/b/c/ChatList.tsx","old_string":"' + 'x'.repeat(50));
    expect(toolSummary({ use: u }).object).toBe('ChatList.tsx');
    // Nothing readable: the verb with a plain object word, never raw JSON.
    const junk = use('Read', null, '{"fi');
    expect(toolSummary({ use: junk, result: result(junk) }).sentence).toBe('Read a file');
  });

  it('a failed entry says failed; an entry with no result is live', () => {
    const failed = toolSummary(done('Bash', { command: 'npm test' }, true));
    expect(failed.failed).toBe(true);
    expect(failed.live).toBe(false);
    expect(failed.sentence).toBe('Ran npm — failed');

    const u = use('Bash', { command: 'npm test' });
    const live = toolSummary({ use: u });
    expect(live.live).toBe(true);
    expect(live.failed).toBe(false);
    expect(live.sentence).toBe('Ran npm');
    // A null result is no result either.
    expect(toolSummary({ use: u, result: null }).live).toBe(true);

    expect(toolSummary(done('Bash', { command: 'npm test' })).live).toBe(false);
  });
});

/** Items for a transcript, through the real producer — less the opening
 *  timestamp divider, which every fixture's first event draws. */
function items(events: ChatEvent[], busy = false): ChatItem[] {
  return buildChatItems(events, [], busy).filter((i) => i.kind !== 'divider');
}
function msg(text: string, kind: 'user' | 'assistant' = 'assistant'): ChatEvent {
  n += 1;
  return { kind, uuid: `m${n}`, ts: '2026-10-18T10:00:00.000Z', text } as ChatEvent;
}
function pair(name: string, input: unknown, isError = false): ChatEvent[] {
  const u = use(name, input);
  return [u, result(u, isError)];
}
/** The i-th element, which the test asserts is there. */
function at<T>(xs: readonly T[], i: number): T {
  const x = xs[i];
  if (x === undefined) throw new Error(`no element ${i}`);
  return x;
}
function groups(out: ReturnType<typeof groupToolRun>): ToolGroupItem[] {
  return out.filter((i): i is ToolGroupItem => i.kind === 'tool-group');
}

describe('groupToolRun', () => {
  it('a run of tool entries folds into one group with the counted sentence', () => {
    const src = items([
      msg('Looking.'),
      ...pair('Read', { file_path: '/r/a.ts' }),
      ...pair('Read', { file_path: '/r/b.ts' }),
      ...pair('Read', { file_path: '/r/c.ts' }),
      ...pair('Edit', { file_path: '/r/pwa/src/session/chat.css' }),
      ...pair('Bash', { command: 'npm test' }),
      ...pair('Bash', { command: 'npm run build' }),
      msg('Done.'),
    ]);
    const out = groupToolRun(src);
    expect(out.map((i) => i.kind)).toEqual(['message', 'tool-group', 'message']);
    const g = at(groups(out), 0);
    expect(g.entries).toHaveLength(6);
    expect(g.entries.map((e) => e.use.name)).toEqual(['Read', 'Read', 'Read', 'Edit', 'Bash', 'Bash']);
    expect(g.sentence).toBe('Read 3 files · Edited chat.css · Ran 2 commands');
    expect(g.key).toBe(`group-${at(g.entries, 0).key}`);

    // Plurals per verb, in the order each verb first appears.
    const mixed = groupToolRun(items([
      ...pair('Bash', { command: 'git status' }),
      ...pair('Grep', { pattern: 'a' }),
      ...pair('Bash', { command: 'npm test' }),
      ...pair('Grep', { pattern: 'b' }),
      ...pair('Agent', { description: 'one' }),
      ...pair('Agent', { description: 'two' }),
      ...pair('TodoWrite', { todos: [] }),
      ...pair('TodoWrite', { todos: [] }),
      ...pair('WebFetch', { url: 'x' }),
      ...pair('WebFetch', { url: 'y' }),
    ]));
    expect(at(groups(mixed), 0).sentence).toBe(
      'Ran 2 commands · Searched for 2 patterns · Delegated 2 tasks · Updated the task list · WebFetch ×2',
    );

    // A non-tool item between two entries ends the run.
    const split = groupToolRun(items([
      ...pair('Read', { file_path: '/a.ts' }),
      msg('Hm.'),
      ...pair('Read', { file_path: '/b.ts' }),
    ]));
    expect(split.map((i) => i.kind)).toEqual(['tool-group', 'message', 'tool-group']);
    // Nothing else is touched: same items, same order, same objects.
    const plain = items([msg('hi', 'user'), msg('there')]);
    expect(groupToolRun(plain)).toEqual(plain);
  });

  it('a clause counts distinct calls by their full input, not by the words it shows', () => {
    const sentenceOf = (es: ChatEvent[]): string => at(groups(groupToolRun(items(es))), 0).sentence;
    // Three commands, two first words: three ran.
    expect(sentenceOf([
      ...pair('Bash', { command: 'git status' }),
      ...pair('Bash', { command: 'npm test' }),
      ...pair('Bash', { command: 'git diff' }),
    ])).toBe('Ran 3 commands');
    // Two files sharing a base name are two files.
    expect(sentenceOf([
      ...pair('Read', { file_path: '/a/pwa/src/index.ts' }),
      ...pair('Read', { file_path: '/a/server/src/index.ts' }),
    ])).toBe('Read 2 files');
    // Edit and Write are one clause, counted by full path.
    expect(sentenceOf([
      ...pair('Edit', { file_path: '/a/pwa/index.ts' }),
      ...pair('Write', { file_path: '/b/index.ts' }),
      ...pair('Edit', { file_path: '/c/x.ts' }),
    ])).toBe('Edited 3 files');
    // The same file read twice is one file; the same command twice, one command.
    expect(sentenceOf([
      ...pair('Read', { file_path: '/a/index.ts' }),
      ...pair('Read', { file_path: '/a/index.ts' }),
      ...pair('Bash', { command: 'npm test' }),
      ...pair('Bash', { command: 'npm test' }),
    ])).toBe('Read index.ts · Ran npm');
    // A repeat inside a plural clause is still one call: two files, not three reads.
    expect(sentenceOf([
      ...pair('Read', { file_path: '/a/index.ts' }),
      ...pair('Read', { file_path: '/a/index.ts' }),
      ...pair('Read', { file_path: '/b/index.ts' }),
    ])).toBe('Read 2 files');
    // Patterns and tasks count by their full strings too.
    expect(sentenceOf([
      ...pair('Agent', { description: 'Audit the palette for contrast' }),
      ...pair('Agent', { description: 'Audit the palette for motion' }),
    ])).toBe('Delegated 2 tasks');
  });

  it('an ask, a failed entry and a live entry each stand alone', () => {
    const ask = use('AskUserQuestion', { questions: [{ question: 'Which?', options: [] }] });
    const live = use('Bash', { command: 'npm test' });
    const out = groupToolRun(items([
      ...pair('Read', { file_path: '/a.ts' }),
      ...pair('Read', { file_path: '/b.ts' }),
      ask, result(ask),
      ...pair('Read', { file_path: '/c.ts' }),
      ...pair('Bash', { command: 'npm test' }, true),
      ...pair('Read', { file_path: '/d.ts' }),
      ...pair('Read', { file_path: '/e.ts' }),
      live,
    ], true));
    expect(out.map((i) => (i.kind === 'tool' ? `tool:${i.use.name}` : i.kind))).toEqual([
      'tool-group', 'tool:AskUserQuestion', 'tool-group', 'tool:Bash', 'tool-group', 'tool:Bash', 'working',
    ]);
    const standing = out.filter((i): i is ToolItem => i.kind === 'tool');
    expect(at(standing, 1).result?.isError).toBe(true);
    expect(at(standing, 2).result).toBeUndefined();
    // None of the three is inside any fold.
    for (const g of groups(out)) {
      for (const e of g.entries) {
        expect(e.use.name).not.toBe('AskUserQuestion');
        expect(toolSummary(e).failed).toBe(false);
        expect(toolSummary(e).live).toBe(false);
      }
    }
  });

  it('the sentence never contains a directory', () => {
    const deep = '/Users/someone/projects/ccrc-pwa/pwa/src/session/very/deep/tree/ChatList.tsx';
    const winDeep = 'D:\\repos\\ccrc\\ui\\src\\tokens.css';
    const entries = [
      done('Read', { file_path: deep }),
      done('Edit', { file_path: deep }),
      done('Write', { file_path: winDeep }),
      done('Bash', { command: '/usr/local/bin/node scripts/x.mjs' }),
      done('Glob', { pattern: 'pwa/src/**/deep/*.css' }),
      done('Bash', { command: 'cd /a/pwa/src/session && npm test' }),
      // An Agent description is prose: a path-like word in it goes to its file name.
      done('Agent', { description: 'Fix pwa/src/session/ChatList.tsx and C:\\x\\session\\y.ts' }),
    ];
    // Grep is the one exception (D-5475): its pattern is a regex, kept whole,
    // so it is not in this list.
    for (const e of entries) {
      const s = sentence(e);
      expect(s).not.toMatch(/[\\/]/);
      expect(s).not.toContain('session');
    }
    const g = groups(groupToolRun(entries));
    expect(g).toHaveLength(1);
    expect(at(g, 0).sentence).not.toMatch(/[\\/]/);
  });
});
