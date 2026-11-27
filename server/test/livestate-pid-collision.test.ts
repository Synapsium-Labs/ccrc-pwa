// B8: the pid fast path of `readLiveStateMeasuredFor` returned whatever file the pane pid named. On Windows the pane
// pid is an MSYS pid and the file names are Windows pids, two number spaces, so a collision handed this session
// ANOTHER session's status. On Windows the pid read now counts only when its file names our uuid; otherwise the uuid
// scan runs. On POSIX the pid is the key and a file naming another uuid is lawful (a fork, a /clear's lag): unchanged.
import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { readLiveStateFor } from '../src/livestate.js';
import { localIO } from '../src/io.js';
import { mkTmp } from './tmpHelpers.js';

const UUID = '7'.repeat(36);
const OTHER = 'a'.repeat(36);

function seed(files: Record<number, unknown>): string {
  const configDir = path.join(mkTmp('ccrc-livecollide-'), '.claude');
  mkdirSync(path.join(configDir, 'sessions'), { recursive: true });
  for (const [pid, raw] of Object.entries(files)) {
    writeFileSync(path.join(configDir, 'sessions', `${pid}.json`), JSON.stringify(raw));
  }
  return configDir;
}
const file = (sessionId: string, status: string) =>
  ({ sessionId, status, cwd: '/w', name: 'n', statusUpdatedAt: 1, version: '2' });

describe.skipIf(process.platform !== 'win32')('readLiveStateFor on Windows: a pid that collides with another session\'s file (B8)', () => {
  it('the pane pid names another session\'s file: that file is not ours, the uuid scan finds ours', async () => {
    const cfg = seed({ 7956: file(OTHER, 'idle'), 56116: file(UUID, 'busy') });
    const live = await readLiveStateFor(localIO, cfg, 7956, UUID);
    expect(live?.sessionId).toBe(UUID);
    expect(live?.status).toBe('busy');
    expect(live?.pid).toBe(56116);
  });

  it('the pane pid names another session\'s file and ours is nowhere: no state, not the other\'s', async () => {
    const cfg = seed({ 7956: file(OTHER, 'busy') });
    expect(await readLiveStateFor(localIO, cfg, 7956, UUID)).toBeNull();
  });

  it('an empty uuid (a degraded record) keeps the pid read as before', async () => {
    const cfg = seed({ 7956: file(OTHER, 'busy') });
    expect((await readLiveStateFor(localIO, cfg, 7956, ''))?.status).toBe('busy');
  });
});

describe.skipIf(process.platform === 'win32')('readLiveStateFor on POSIX: the pane pid stays the key (B8 leaves it)', () => {
  it('the pane pid\'s file naming the pre-fork uuid is still the pane\'s state', async () => {
    const cfg = seed({ 7956: file(OTHER, 'busy') });
    expect((await readLiveStateFor(localIO, cfg, 7956, UUID))?.status).toBe('busy');
  });
});
