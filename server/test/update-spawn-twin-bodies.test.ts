// The two bounded-spawn bodies — the agent's `makeUpdateSpawn` (`agent/src/server.ts`) and the server role's
// `boundedUpdateSpawn` (`server/src/update/spawn.ts`) — are ONE algorithm spelled twice, because the agent package
// cannot import the server's (and `shared/` is L0, no `node:child_process`). Nothing else keeps two ~70-line copies in
// step, and a fix made to one (I1's drain deadline, M2's error handlers, M4's signal code) would otherwise leave the
// other quietly wrong. Each carries its body between two sentinel comments, and this pin holds the two regions equal
// line for line. Only indentation is normalised: the bodies deliberately use the same names (`file`, `args`, `env`,
// `timeoutMs`), so anything else that differs IS drift. Same idiom as `macos-platform.test.ts`'s platform-block pin.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BEGIN = '// ── BEGIN bounded-spawn body';
const END = '// ── END bounded-spawn body';
const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

/** The body between the sentinels, one entry per line, indentation stripped, the sentinel lines themselves excluded. */
function region(src: string, label: string): string[] {
  const starts = src.split('\n').flatMap((l, i) => (l.trim().startsWith(BEGIN) ? [i] : []));
  const ends = src.split('\n').flatMap((l, i) => (l.trim().startsWith(END) ? [i] : []));
  expect(starts, `${label}: exactly one BEGIN sentinel`).toHaveLength(1);
  expect(ends, `${label}: exactly one END sentinel`).toHaveLength(1);
  expect(ends[0], `${label}: END after BEGIN`).toBeGreaterThan(starts[0]!);
  return src.split('\n').slice(starts[0]! + 1, ends[0]).map((l) => l.trim());
}

describe('the two bounded-spawn bodies are one text', () => {
  const agent = region(read('../../agent/src/server.ts'), 'agent/src/server.ts');
  const server = region(read('../src/update/spawn.ts'), 'server/src/update/spawn.ts');

  it('each region is the whole algorithm, not a stub (the spawn, the kill, the drain, the exit handler)', () => {
    for (const body of [agent, server]) {
      const text = body.join('\n');
      expect(body.length).toBeGreaterThan(50);
      for (const needle of ['spawn(file, [...args]', "process.kill(-child.pid, 'SIGKILL')", 'armDrain', "child.once('exit'"]) {
        expect(text, needle).toContain(needle);
      }
    }
  });

  it('the agent\'s region equals the server\'s, line for line (indentation aside)', () => {
    expect(agent).toEqual(server);
  });
});

// D-4390 (box-token lifecycle wave 1): the `token-sync` op's spawn is its OWN bounded body in `agent/src/tokensync.ts`
// (stdin piped, an explicit {HOME, PATH, LANG}, SIGTERM then SIGKILL), not a third twin and not the twin with stdin
// as a parameter. The twins stay two; the third body stays visibly separate, so an edit that copies the twin into it
// (or folds it into the twin) is a red here rather than a silent fourth way to read the pair above.
describe('the token-sync spawn is not a third twin (D-4390)', () => {
  const tokensync = read('../../agent/src/tokensync.ts');
  const count = (src: string, sentinel: string): number => src.split('\n').filter((l) => l.trim().startsWith(sentinel)).length;

  it('agent/src/tokensync.ts carries no bounded-spawn sentinel, and agent/src/server.ts still carries exactly one pair', () => {
    expect(count(tokensync, BEGIN), 'a twin sentinel in tokensync.ts').toBe(0);
    expect(count(tokensync, END), 'a twin sentinel in tokensync.ts').toBe(0);
    const agentSrc = read('../../agent/src/server.ts');
    expect(count(agentSrc, BEGIN)).toBe(1);
    expect(count(agentSrc, END)).toBe(1);
  });

  it('its body is its own: stdin piped, an explicit env, SIGTERM before SIGKILL; the twins pipe no stdin', () => {
    expect(tokensync).toContain("stdio: ['pipe', 'pipe', 'pipe'], env: childEnv");
    expect(tokensync).toContain("signalGroup('SIGTERM')");
    expect(tokensync).toContain("signalGroup('SIGKILL')");
    expect(tokensync.indexOf("signalGroup('SIGTERM')")).toBeLessThan(tokensync.indexOf("signalGroup('SIGKILL')"));
    expect(region(read('../../agent/src/server.ts'), 'agent/src/server.ts').join('\n')).toContain("stdio: ['ignore', 'pipe', 'pipe']");
  });
});
