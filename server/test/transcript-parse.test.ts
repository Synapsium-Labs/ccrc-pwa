import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { transcriptPath } from '../src/transcript/resolve.js';
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
