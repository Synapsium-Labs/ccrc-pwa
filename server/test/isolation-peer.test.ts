// The server's measurement of its own agent link's peer (Overlord W1, plan `w1-isolation.md` Task 2, questions 8 and 10):
// locality from the peer address, and the kernel's uid for the peer's socket from synthetic TCP tables. Addresses are from
// the documentation ranges only; nothing here reads the live host's tables or interfaces.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { measurePeer, PEER_TABLE_MAX, realPeerSeams, type PeerSeams } from '../src/isolationFacts.js';
import { mkTmp, removeTmpFixturesEachTest } from './tmpHelpers.js';

removeTmpFixturesEachTest();

const SERVER_LOCAL_PORT = 51234;   // the server's own (client) port
const AGENT_PORT = 7789;           // the agent's listening port: the server's remote port
const hex = (n: number): string => n.toString(16).toUpperCase().padStart(4, '0');

/** One /proc/net/tcp row: `sl local rem st queues tr retrnsmt uid timeout inode`. */
function row(local: number, remote: number, uid: number, st = '01'): string {
  return `   0: 0100007F:${hex(local)} 0100007F:${hex(remote)} ${st} 00000000:00000000 00:00000000 00000000  ${uid}        0 12345 1 0000000000000000 20 4 30 10 -1`;
}
const HEADER = '  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode';
const table = (...rows: string[]): string => [HEADER, ...rows].join('\n') + '\n';
/** The agent's row: its local port is the agent port, its remote port the server's. The server's own row is the mirror. */
const agentRow = (uid: number, st = '01'): string => row(AGENT_PORT, SERVER_LOCAL_PORT, uid, st);
const serverRow = (uid: number): string => row(SERVER_LOCAL_PORT, AGENT_PORT, uid);

const seams = (tables: readonly string[] | 'unmeasured', interfaces: readonly string[] = ['192.0.2.10', '2001:db8::10']): PeerSeams => ({
  interfaceAddresses: () => interfaces,
  tables: () => tables,
});
const sock = (remoteAddress: string | undefined, over: { remotePort?: number; localPort?: number } = {}) =>
  ({ remoteAddress, remotePort: AGENT_PORT, localPort: SERVER_LOCAL_PORT, ...over });

describe('measurePeer', () => {
  it('reads no remote address, or no port, as both facts unmeasured', () => {
    expect(measurePeer(sock(undefined), seams([table(agentRow(3000))]))).toEqual({ locality: 'unmeasured', uid: 'unmeasured' });
    expect(measurePeer(sock('127.0.0.1', { remotePort: undefined }), seams([table(agentRow(3000))]))).toEqual({ locality: 'unmeasured', uid: 'unmeasured' });
    expect(measurePeer(sock('127.0.0.1', { localPort: undefined }), seams([table(agentRow(3000))]))).toEqual({ locality: 'unmeasured', uid: 'unmeasured' });
  });

  for (const addr of ['127.0.0.1', '127.1.2.3', '::1', '::ffff:127.0.0.1', '0:0:0:0:0:0:0:1']) {
    it(`reads the loopback address ${addr} as local, and the agent row's uid`, () => {
      expect(measurePeer(sock(addr), seams([table(serverRow(1000), agentRow(3000))]))).toEqual({ locality: 'local', uid: 3000 });
    });
  }

  it("reads one of this host's interface addresses as local, in either spelling", () => {
    expect(measurePeer(sock('192.0.2.10'), seams([table(agentRow(3000))]))).toEqual({ locality: 'local', uid: 3000 });
    expect(measurePeer(sock('::ffff:192.0.2.10'), seams([table(agentRow(3000))]))).toEqual({ locality: 'local', uid: 3000 });
    expect(measurePeer(sock('2001:DB8::10'), seams([table(agentRow(3000))]))).toEqual({ locality: 'local', uid: 3000 });
    expect(measurePeer(sock('fe80::1%eth0'), seams([table(agentRow(3000))], ['fe80::1']))).toEqual({ locality: 'local', uid: 3000 });
  });

  it('reads any other address as not local, its uid unmeasured, whatever the tables say', () => {
    expect(measurePeer(sock('198.51.100.7'), seams([table(agentRow(3000))]))).toEqual({ locality: 'not-local', uid: 'unmeasured' });
    expect(measurePeer(sock('2001:db8::99'), seams([table(agentRow(3000))]))).toEqual({ locality: 'not-local', uid: 'unmeasured' });
  });

  it('finds the agent row across tables (tcp and tcp6)', () => {
    expect(measurePeer(sock('::1'), seams([table(serverRow(1000)), table(agentRow(3000))]))).toEqual({ locality: 'local', uid: 3000 });
  });

  it('reads the uid unmeasured when no row matches, or the matching row is not established', () => {
    expect(measurePeer(sock('127.0.0.1'), seams([table(serverRow(1000))]))).toEqual({ locality: 'local', uid: 'unmeasured' });
    expect(measurePeer(sock('127.0.0.1'), seams([table(agentRow(3000, '06'))]))).toEqual({ locality: 'local', uid: 'unmeasured' });
  });

  it('reads the uid unmeasured when the matching row stands twice, even with one uid', () => {
    expect(measurePeer(sock('127.0.0.1'), seams([table(agentRow(3000), agentRow(2000))]))).toEqual({ locality: 'local', uid: 'unmeasured' });
    expect(measurePeer(sock('127.0.0.1'), seams([table(agentRow(3000)), table(agentRow(3000))]))).toEqual({ locality: 'local', uid: 'unmeasured' });
  });

  it('reads an unreadable table set as unmeasured, never as no match', () => {
    expect(measurePeer(sock('127.0.0.1'), seams('unmeasured'))).toEqual({ locality: 'local', uid: 'unmeasured' });
  });

  it('reads a table over its bound as unmeasured', () => {
    const big = table(agentRow(3000)) + 'x'.repeat(PEER_TABLE_MAX);
    expect(measurePeer(sock('127.0.0.1'), seams([big]))).toEqual({ locality: 'local', uid: 'unmeasured' });
  });

  it('reads a malformed uid column as unmeasured', () => {
    expect(measurePeer(sock('127.0.0.1'), seams([table(agentRow(3000).replace(' 3000 ', ' x '))]))).toEqual({ locality: 'local', uid: 'unmeasured' });
  });

  it('never stores the address on what it answers', () => {
    expect(JSON.stringify(measurePeer(sock('192.0.2.10'), seams([table(agentRow(3000))])))).not.toContain('192.0.2.10');
  });
});

describe('realPeerSeams over a synthetic /proc', () => {
  const proc = (files: Record<string, string>): string => {
    const root = mkTmp('ccrc-peer-proc-');
    mkdirSync(path.join(root, 'net'), { recursive: true });
    for (const [name, text] of Object.entries(files)) writeFileSync(path.join(root, 'net', name), text);
    return root;
  };
  it.runIf(process.platform === 'linux')('reads tcp and tcp6, and a missing tcp6 is no table, not an unreadable one', () => {
    expect(realPeerSeams(proc({ tcp: table(agentRow(3000)), tcp6: table(serverRow(1000)) })).tables()).toHaveLength(2);
    expect(realPeerSeams(proc({ tcp: table(agentRow(3000)) })).tables()).toEqual([table(agentRow(3000))]);
  });
  it.runIf(process.platform === 'linux')('reads a missing tcp, or a table past its bound, as unmeasured', () => {
    expect(realPeerSeams(proc({ tcp6: table(agentRow(3000)) })).tables()).toBe('unmeasured');
    expect(realPeerSeams(proc({ tcp: 'x'.repeat(PEER_TABLE_MAX + 1) })).tables()).toBe('unmeasured');
  });
});
