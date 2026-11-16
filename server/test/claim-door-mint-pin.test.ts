// D-7505 (ARCH-05): the claim door's mint, pinned before the door takes it through its options. A claim code is
// 32 random bytes in base64url (43 characters), minted exactly once per `issue`, and a claim with it matches once.
// Every door row builds its door through ONE local factory, `doorUnderTest()`, so the port commit edits the factory
// and never a row. The driver row builds the production door (no `door` override), so a production claim code's
// shape and randomness stay pinned where the driver decides which mint the door uses.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ClaimDoor } from '../src/token/door.js';
import { bootBoxToken } from '../src/token/boot.js';
import { BoxTokenDriver } from '../src/token/driver.js';
import { fileTokenStore, mintClaimCode, tokenPaths } from '../src/token/files.js';
import { generationReaderOver } from '../src/token/link.js';
import type { GateNode, SyncResult } from '../src/token/policy.js';
import type { TokenSyncLink } from '../src/token/ports.js';
import { localIO } from '../src/io.js';
import { mkTmp } from './tmpHelpers.js';

const NODE = '0e6a6c2e-3b1f-4c55-9a51-2f0f1c9f7d10';
const GEN = 'a1b2c3d4e5f60718';
const GEN2 = '0f1e2d3c4b5a6978';
const VALUE = 'c'.repeat(64);
const CODE = /^[A-Za-z0-9_-]{43}$/;

/** The one place a door row builds its door, and how it reads the mint's call count. */
function doorUnderTest(): { door: ClaimDoor; mintCalls: () => number } {
  const mint = vi.fn(mintClaimCode);
  const door = new ClaimDoor({ valueOf: () => VALUE, warn: () => {}, mintClaimCode: mint });
  return { door, mintCalls: () => mint.mock.calls.length };
}

describe('the claim door mints its code (D-7505)', () => {
  it('an issued code is 43 base64url characters (32 random bytes)', () => {
    const { door } = doorUnderTest();
    expect(door.issue(GEN, NODE, 1_000)).toMatch(CODE);
  });

  it('two issues give two different codes', () => {
    const { door } = doorUnderTest();
    const a = door.issue(GEN, NODE, 1_000);
    const b = door.issue(GEN2, NODE, 1_000);
    expect(a).not.toBe(b);
  });

  it('a claim with the issued code matches, and burns it', () => {
    const { door } = doorUnderTest();
    const code = door.issue(GEN, NODE, 1_000);
    expect(door.claimNow({ code, nodeId: NODE }, 1_001)).toEqual({ status: 200, generation: GEN, value: VALUE, nodeId: NODE });
    expect(door.claimNow({ code, nodeId: NODE }, 1_002)).toMatchObject({ status: 410, error: 'code-used' });
  });

  it('the mint is called exactly once per issue', () => {
    const { door, mintCalls } = doorUnderTest();
    expect(mintCalls()).toBe(0);
    door.issue(GEN, NODE, 1_000);
    expect(mintCalls()).toBe(1);
    door.issue(GEN, NODE, 1_000);
    expect(mintCalls()).toBe(2);
    door.issue(GEN2, NODE, 1_000);
    expect(mintCalls()).toBe(3);
  });
});

describe('the driver decides the production door\'s mint (D-7505)', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('a production claim code, as the link receives it, is 43 base64url characters and differs from the next', async () => {
    const home = mkTmp('ccrc-claim-mint-');
    const fleetHome = mkTmp('ccrc-claim-mint-fleet-');
    mkdirSync(path.join(home, '.ccrc'), { recursive: true });
    mkdirSync(path.join(fleetHome, '.ccrc'), { recursive: true });
    const paths = tokenPaths(path.join(home, '.ccrc', 'mail.token'), home);
    writeFileSync(paths.current, `${'e'.repeat(64)}\n`, { mode: 0o600 });   // an adopted value: a rotation is owed
    for (const m of ['warn', 'log', 'error'] as const) vi.spyOn(console, m).mockImplementation(() => {});
    const boot = await bootBoxToken({ mailTokenPath: paths.current, home, role: 'server', roleSource: 'recorded', fleetMode: 'remote', now: Date.now() });
    // The shortest drive to two sends: a ccrc without the verb is held after its first send, and a fresh ready
    // re-probes at once (token-rotation-e2e.test.ts's verb-missing row).
    const sent: string[] = [];
    const link: TokenSyncLink = {
      async send(code: string): Promise<SyncResult> {
        sent.push(code);
        return { kind: 'refused', word: 'spawn-failed', detail: 'ccrc: unknown argument: token' };
      },
    };
    const row: GateNode = {
      nodeId: NODE, nodeIdMeasured: true, label: 'fleet', role: 'fleet', reachable: true, os: 'linux',
      caps: ['token-sync'], agentOps: ['update', 'token-sync'], updateState: 'idle', reportedPhase: null,
    };
    const rows = { readyAt: 1 };
    const driver = new BoxTokenDriver({
      store: fileTokenStore(paths), holder: boot.holder, link,
      generation: generationReaderOver(localIO, path.join(fleetHome, '.ccrc'), Date.now),
      rows: { nodes: () => [row], linkUp: () => true, lastReadyAt: () => rows.readyAt },
      env: { fleetMode: 'remote', role: 'server', roleSource: 'recorded', agentEnvMarksFleet: false },
      bothWriter: null, warn: () => {},
    }, boot);
    await driver.tick();
    await driver.tick();
    expect(sent).toHaveLength(1);
    rows.readyAt = Date.now() + 10;
    await driver.tick();
    expect(sent).toHaveLength(2);
    for (const code of sent) expect(code).toMatch(CODE);
    expect(sent[0]).not.toBe(sent[1]);
  });
});
