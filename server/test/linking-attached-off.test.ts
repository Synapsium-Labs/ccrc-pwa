// D-8808 (Linear hierarchy wave 8, Task 8.3): the attached-issues read is OFF by default, pinned at the wiring site.
// `readAttachedIssues` is built and tested on a constructed fixture only; nothing may call it, and nothing may hand the
// team link an `attached` input, until the operator gives the go for one live capture of its answer. This test reads
// `server/src` as text (as `single-definition/*.test.ts` does), so a wiring in `watch.ts` or anywhere else goes red.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOTS, ccrcRoot, sources } from './single-definition/helpers.js';

const SERVER_SRC = ROOTS.find((r) => r.endsWith(path.join('server', 'src')))!;
const rel = (f: string): string => path.relative(ccrcRoot, f).split(path.sep).join('/');
const FILES = sources(SERVER_SRC).map((f) => ({ file: rel(f), text: readFileSync(f, 'utf8') }));
const WAIT = 'the attached-issues read waits for the operator\'s go for one live capture of its answer; the go-ahead commit '
  + 'updates this test deliberately (D-8808)';

describe('the attached-issues read is off by default (D-8808)', () => {
  it('no server/src file but its own names readAttachedIssues', () => {
    const holders = FILES.filter((f) => /\breadAttachedIssues\b/.test(f.text)).map((f) => f.file);
    expect(holders, WAIT).toEqual(['server/src/linking/attachedIssues.ts']);
  });

  it('no file that builds the team link\'s inputs passes an `attached` input to it', () => {
    // visibilityLane.ts DECLARES the optional input and reads it; every other file that names the inputs builds them.
    const builders = FILES.filter((f) => /\bTeamLinkInputs\b/.test(f.text) && f.file !== 'server/src/linking/visibilityLane.ts');
    expect(builders.map((f) => f.file), 'the builder of the inputs is watch.ts').toContain('server/src/watch.ts');
    const passing = builders.filter((f) => /\battached\s*[:(,}]/.test(f.text)).map((f) => f.file);
    expect(passing, WAIT).toEqual([]);
  });

  it('the guard sees the wiring site: server/src/watch.ts is among the files scanned', () => {
    expect(FILES.map((f) => f.file)).toContain('server/src/watch.ts');
  });
});
