// The epoch of the pool-membership projection THIS node actually has — what
// the agent reports on its `ready` frame, beside `rosterFp` and `build`.
//
// THE DISTINCTION THIS SUITE IS ABOUT: `observedEpoch` has three answers, and
// they must never fold. ABSENT from the wire means "this build cannot tell
// you" (an older agent that predates the field). `null` means "I have synced
// never" — this node holds no projection at all. A number means that epoch.
// `0` is a real, distinct answer from `null`: the control plane can validly
// issue epoch 0, and a node that has synced that is not the same as a node
// that has never synced.
//
// Unlike `rosterFp`/`build`, THIS build never omits the field: `readObservedEpoch`
// always has an answer (a number, or `null`), so the "absent" condition can
// only ever be produced by an agent build old enough to lack this code
// entirely — never by this one, which is why the unit-level tests below check
// `readObservedEpoch` directly (a number or `null`, never `undefined`) and the
// wire-level tests check that the `ready` frame always CARRIES the key.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { RunningAgent } from '../src/server.js';
import { readObservedEpoch } from '../src/server.js';
import type { AgentReady } from '../../shared/agent-protocol.js';
import { makeFixture, boot, TestClient, type Fixture } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

describe('readObservedEpoch — the reader', () => {
  it('reports the epoch it has actually got', () => {
    const home = mkTmp('ccrc-observed-epoch-');
    const reg = path.join(home, '.cc-sessions');
    mkdirSync(reg, { recursive: true });
    writeFileSync(path.join(reg, 'pool-epoch'), 'epoch 43\nissued 1\nlease 2\n', 'utf8');
    expect(readObservedEpoch(home)).toBe(43);
  });

  it('reports null — never undefined — when it has never synced', () => {
    const home = mkTmp('ccrc-observed-epoch-');
    mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
    expect(readObservedEpoch(home)).toBe(null);
  });

  it('reports null for a document with no epoch line', () => {
    const home = mkTmp('ccrc-observed-epoch-');
    const reg = path.join(home, '.cc-sessions');
    mkdirSync(reg, { recursive: true });
    writeFileSync(path.join(reg, 'pool-epoch'), 'acct a pool-a\n', 'utf8');
    expect(readObservedEpoch(home)).toBe(null);
  });

  it('reports epoch 0 as 0, not as "never synced" — a real, distinct answer from null', () => {
    const home = mkTmp('ccrc-observed-epoch-');
    const reg = path.join(home, '.cc-sessions');
    mkdirSync(reg, { recursive: true });
    writeFileSync(path.join(reg, 'pool-epoch'), 'epoch 0\nissued 1\nlease 2\nend\n', 'utf8');
    expect(readObservedEpoch(home)).toBe(0);
    expect(readObservedEpoch(home)).not.toBe(null);
  });

  it('answers null rather than a wrong number for a leading-zero epoch — off the grammar', () => {
    // `_acct_pool_state`'s own numeric grammar (`ccd/ccd`) is
    // `^(0|[1-9][0-9]*)$` — no leading zero, because the control plane's `%d`
    // can never emit one. A hand-edited or torn value off that grammar must
    // not be silently coerced into a number this reader does not recognise.
    const home = mkTmp('ccrc-observed-epoch-');
    const reg = path.join(home, '.cc-sessions');
    mkdirSync(reg, { recursive: true });
    writeFileSync(path.join(reg, 'pool-epoch'), 'epoch 007\nissued 1\nlease 2\nend\n', 'utf8');
    expect(readObservedEpoch(home)).toBe(null);
  });

  it('reports null when the whole directory is absent — never throws', () => {
    const home = mkTmp('ccrc-observed-epoch-');
    // No `.cc-sessions` at all.
    expect(readObservedEpoch(home)).toBe(null);
  });
});

describe('the ready frame carries observedEpoch', () => {
  let agent: RunningAgent | undefined;
  let fixture: Fixture | undefined;
  const clients: TestClient[] = [];
  const connect = (port: number): TestClient => {
    const c = new TestClient(port);
    clients.push(c);
    return c;
  };

  afterEach(async () => {
    for (const c of clients.splice(0)) c.ws.close();
    if (agent) await agent.close();
    agent = undefined;
    if (fixture) {
      rmSync(fixture.home, { recursive: true, force: true });
      rmSync(fixture.projectsRoot, { recursive: true, force: true });
      rmSync(fixture.outside, { recursive: true, force: true });
    }
    fixture = undefined;
  });

  it('always carries the key, as a number, when the projection has one — never omitted', async () => {
    fixture = makeFixture();
    writeFileSync(path.join(fixture.home, '.cc-sessions', 'pool-epoch'), 'epoch 7\nissued 1\nlease 2\nend\n', 'utf8');
    agent = await boot(fixture);

    const ready = await connect(agent.port).hello() as AgentReady;
    expect('observedEpoch' in ready).toBe(true);
    expect(ready.observedEpoch).toBe(7);
  });

  it('carries the key as null, not omitted, on a box that has never synced', async () => {
    // The whole point of the distinction: unlike `rosterFp`/`build`, THIS
    // build never treats "nothing to read" as a reason to drop the key —
    // that would put the field back into the same absence this build exists
    // to end. `null` is sent on the wire, explicitly.
    fixture = makeFixture();
    agent = await boot(fixture);

    const ready = await connect(agent.port).hello() as AgentReady;
    expect('observedEpoch' in ready).toBe(true);
    expect(ready.observedEpoch).toBe(null);
  });

  it('re-reads on every connection, so a resync is picked up without a restart', async () => {
    fixture = makeFixture();
    agent = await boot(fixture);

    expect((await connect(agent.port).hello() as AgentReady).observedEpoch).toBe(null);

    writeFileSync(path.join(fixture.home, '.cc-sessions', 'pool-epoch'), 'epoch 9\nissued 1\nlease 2\nend\n', 'utf8');
    expect((await connect(agent.port).hello() as AgentReady).observedEpoch).toBe(9);
  });
});
