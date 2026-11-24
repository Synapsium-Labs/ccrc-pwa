/**
 * Approvals plan 2026-11-18 §3.1 ("every approval push carries its source"), review 2638 F9a: both `kind: 'ask'` pushes
 * the watcher sends for a painted prompt (the raise, and the held prompt's "with coordinator" replacement) spread the
 * questions owner's sighting source (`pushSourceOf`) onto the push, so the outbox row carries it. A scan of `watch.ts`,
 * because the watcher's fixtures run no push outbox.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('every ask push the watcher sends carries the sighting\'s source', () => {
  it('both `kind: \'ask\'` pushes in watch.ts spread a source', () => {
    const text = readFileSync(path.resolve(__dirname, '../src/watch.ts'), 'utf8');
    const sites = [...text.matchAll(/this\.pushOne\(\{\n\s*kind: 'ask', sessionId: r\.id,[\s\S]*?\}, this\.activeProjects\)/g)].map((m) => m[0]);
    expect(sites).toHaveLength(2);
    for (const s of sites) expect(s).toMatch(/\.\.\.\(\w*[sS]ource !== undefined \? \{ source(: \w+)? \} : \{\}\)/);
  });
});
