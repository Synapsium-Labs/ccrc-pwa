// The one holder of the last logged isolation reading (Overlord W1, plan `w1-isolation.md` question 20, ruled F12). Ring L4,
// context C1: it is asked at boot and after each change of the fleet link's state, reads the reader, and logs only a
// change, by word and cause or by reason. It decides no word, and no line names an address, a digest, an id or a uid.
import type { FleetState } from './fleetstate.js';
import { makeIsolationReader, type IsolationReader, type MeasuredServer } from './isolationFacts.js';

export class IsolationWordLog {
  private last: string | null = null;
  constructor(private readonly reader: Pick<IsolationReader, 'read'>, private readonly warn: (line: string) => void) {}

  note(): void {
    const r = this.reader.read();
    const line = r.kind === 'measured'
      ? `ccrc-server: isolation: ${r.word} (${r.cause})`
      : `ccrc-server: isolation: unmeasured (${r.why})`;
    if (line === this.last) return;
    this.last = line;
    this.warn(line);
  }
}

/** The fleet link as the wiring reads it: its live state object and its two listeners (a `FleetClient`). */
export interface IsolationLink {
  readonly state: Pick<FleetState, 'connected' | 'hostReport' | 'peer' | 'readySerial'>;
  onStateChange(fn: () => void): unknown;
  onConnected(fn: () => void): unknown;
}

/** The isolation word's wiring, called once, by the composition root: the reader over the link's live state object, never
 *  a copy, then the one log, noted at boot and after every state change and every ready. A ready re-sent on one socket
 *  changes neither `connected` nor `downSince`, so only the ready listener carries its reading. `link` is null in local
 *  mode, where there is no link to ask. */
export function wireIsolation(mode: 'local' | 'remote', server: MeasuredServer, bearer: string | null, link: IsolationLink | null,
  warn: (line: string) => void): IsolationReader {
  const reader = makeIsolationReader(mode, server, bearer, link === null ? null : link.state);
  const log = new IsolationWordLog(reader, warn);
  log.note();
  link?.onStateChange(() => log.note());
  link?.onConnected(() => log.note());
  return reader;
}
