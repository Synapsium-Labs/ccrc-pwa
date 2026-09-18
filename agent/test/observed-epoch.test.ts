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

/** Plant `~/.cc-sessions/pool-epoch` with the given body EXACTLY as given —
 *  no terminator added. Used only where a test needs precise control over
 *  whether `end` is present — the terminator's OWN tests (review T8-R2, I1:
 *  same `plant`/`plantRaw` split `ccd-acct-pool-state.test.ts:19-40` already
 *  uses, for the same reason — a fixture missing `end` silently stops
 *  exercising the condition its own test claims to cover, since the
 *  terminator guard now returns `null` first for ANY reason). */
function plantRaw(home: string, body: string): void {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  writeFileSync(path.join(reg, 'pool-epoch'), body, 'utf8');
}

/** Plant the projection with the given body PLUS its required `end`
 *  terminator — every fixture in this file EXCEPT the terminator's own tests
 *  wants a well-formed document. */
function plant(home: string, body: string): void {
  plantRaw(home, body.endsWith('\n') ? `${body}end\n` : `${body}\nend\n`);
}

describe('readObservedEpoch — the reader', () => {
  it('reports the epoch it has actually got', () => {
    const home = mkTmp('ccrc-observed-epoch-');
    plant(home, 'epoch 43\nissued 1\nlease 2');
    expect(readObservedEpoch(home)).toBe(43);
  });

  it('reports null for a document missing its end terminator — the number cannot be proven to come from a whole document', () => {
    // Review T8-R1, F1/F3: `_acct_pool_state` (`ccd/ccd:2203-2225`) refuses
    // ANY document whose last line is not exactly `end`, structurally,
    // before it parses a single field — because a line-oriented reader has
    // no other way to tell a torn final row from a complete one. This is a
    // PROVENANCE check, not a usability one: an unterminated document may be
    // a FRAGMENT of a previous one, so a number read off it is not proven to
    // be the epoch this node currently holds. Direction of error is why this
    // must be `null` and not, say, `stale`: reporting a number here
    // UNDER-reports lag — Task 9's indicator goes silent exactly where a
    // node is refusing tagged placement, and nobody goes looking for a
    // silence. This is the exact document test 1 above writes, minus `end`.
    const home = mkTmp('ccrc-observed-epoch-');
    plantRaw(home, 'epoch 43\nissued 1\nlease 2\n');
    expect(readObservedEpoch(home)).toBe(null);
  });

  it('reports null for a document with a SECOND trailing newline after end — the last line is empty, not "end"', () => {
    // `_acct_pool_state` tolerates ONE trailing newline (the writer's own
    // convention) but refuses a second: content after the terminator, even a
    // blank line, means the true last line is empty, not `end`. Proves the
    // reader strips at most one trailing `\n` before taking the last line,
    // matching `ccd/ccd:2218-2225`'s own algorithm exactly, rather than
    // trimming all trailing whitespace (which would wrongly accept this).
    const home = mkTmp('ccrc-observed-epoch-');
    plantRaw(home, 'epoch 43\nissued 1\nlease 2\nend\n\n');
    expect(readObservedEpoch(home)).toBe(null);
  });

  it('reports null — never undefined — when it has never synced', () => {
    const home = mkTmp('ccrc-observed-epoch-');
    mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
    expect(readObservedEpoch(home)).toBe(null);
  });

  it('reports null for a document with no epoch line', () => {
    // Review T8-R2, I1: this fixture used to have no `end` terminator either,
    // which meant the F1 terminator guard returned `null` first and this
    // test never actually exercised "no epoch line" — measured: mutating the
    // reader so a TERMINATED document with no epoch line answered `0` left
    // this suite 11/11 green. `plant()` supplies the terminator this
    // condition needs to be tested on its own.
    const home = mkTmp('ccrc-observed-epoch-');
    plant(home, 'acct a pool-a');
    expect(readObservedEpoch(home)).toBe(null);
  });

  it('reports epoch 0 as 0, not as "never synced" — a real, distinct answer from null', () => {
    const home = mkTmp('ccrc-observed-epoch-');
    plant(home, 'epoch 0\nissued 1\nlease 2');
    expect(readObservedEpoch(home)).toBe(0);
    expect(readObservedEpoch(home)).not.toBe(null);
  });

  it('answers null rather than a wrong number for a leading-zero epoch — off the grammar', () => {
    // `_acct_pool_state`'s own numeric grammar (`ccd/ccd`) is
    // `^(0|[1-9][0-9]*)$` — no leading zero, because the control plane's `%d`
    // can never emit one. A hand-edited or torn value off that grammar must
    // not be silently coerced into a number this reader does not recognise.
    const home = mkTmp('ccrc-observed-epoch-');
    plant(home, 'epoch 007\nissued 1\nlease 2');
    expect(readObservedEpoch(home)).toBe(null);
  });

  it('reports null for a document with a duplicate epoch line — nothing says which value is true', () => {
    // Ruling T8-R2, I2. `ccd/ccd:2246-2252`'s own reason for refusing a
    // second `epoch` line is a statement about the epoch ITSELF — "nothing
    // says which value is true" — not one of the placement-trust questions
    // this reader otherwise defers to `_acct_pool_state` (a duplicate
    // `issued`/`lease`/`acct` line, a second `end`, …). Direction of error is
    // the same one F1 established: reporting EITHER number off a
    // self-contradictory document risks under-reporting lag on a node that
    // is, per bash, refusing all tagged placement.
    const home = mkTmp('ccrc-observed-epoch-');
    plant(home, 'epoch 43\nepoch 7\nissued 1\nlease 2');
    expect(readObservedEpoch(home)).toBe(null);
  });

  it('reports null for a huge epoch that cannot round-trip through Number — never a fabricated, imprecise value', () => {
    // Ruling T8-R2, M1. `Number('99999999999999999999')` silently becomes
    // `1e20`, a DIFFERENT number than the document states — bash answers
    // `named pool-a` (a healthy, placement-serving node) for this same
    // document. Sending the imprecise number as-is would let the server's F4
    // validator (`remote/client.ts`, `Number.isSafeInteger`) discard it as
    // off-grammar and record `undefined` — "this build cannot tell you" — for
    // a node that plainly can. Refusing HERE, at the agent (where the file
    // is), means the wire carries `null` — a fact this box CAN prove — never
    // a fabricated one read downstream as absence.
    const home = mkTmp('ccrc-observed-epoch-');
    plant(home, 'epoch 99999999999999999999\nissued 1\nlease 2');
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
    plant(fixture.home, 'epoch 7\nissued 1\nlease 2');
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

    plant(fixture.home, 'epoch 9\nissued 1\nlease 2');
    expect((await connect(agent.port).hello() as AgentReady).observedEpoch).toBe(9);
  });
});
